<?php
/**
 * NT Eleganz — armazenamento resiliente de imagens (fonte única dos endpoints PHP).
 *
 * As fotos vivem em duas cópias: disco da Hostinger (servido ao cliente) e volume da VPS
 * (cópia de segurança). Regras deste módulo, que valem para todos os endpoints:
 *
 *  - NUNCA apaga imagem. Só copia (VPS -> Hostinger e Hostinger -> VPS). Remover uma foto
 *    é decisão exclusiva do gestor, pelo painel.
 *  - Só aceita conteúdo que seja de fato uma imagem (cabeçalho e tamanho conferidos). Uma
 *    página de erro HTML ou um arquivo truncado salvo como .webp seria servido com
 *    "cache de 1 ano" e ficaria quebrado para o cliente.
 *  - Gravação atômica (arquivo temporário + rename): nenhum visitante enxerga arquivo pela metade.
 */

const NTE_IMG_VPS_UPLOADS_URL = 'https://137-131-233-254.sslip.io/nteleganz/uploads/';
const NTE_IMG_VPS_UPLOAD_API = 'https://137-131-233-254.sslip.io/nteleganz/api/upload';

/** Nome de arquivo de imagem seguro (sem diretório), ou null se for inválido. */
function nte_img_safe_name($name): ?string
{
    if (!is_string($name)) {
        return null;
    }
    $name = basename($name);
    return preg_match('/^[A-Za-z0-9_.-]+\.(webp|png|jpe?g|avif|gif)$/i', $name) ? $name : null;
}

/** MIME real da imagem pelos primeiros bytes, ou null se não for um formato de imagem conhecido. */
function nte_img_mime_from_bytes(string $bytes): ?string
{
    if (strlen($bytes) < 12) {
        return null;
    }
    if (substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') {
        return 'image/webp';
    }
    if (substr($bytes, 0, 8) === "\x89PNG\r\n\x1a\n") {
        return 'image/png';
    }
    if (substr($bytes, 0, 3) === "\xFF\xD8\xFF") {
        return 'image/jpeg';
    }
    if (substr($bytes, 0, 3) === 'GIF') {
        return 'image/gif';
    }
    if (substr($bytes, 4, 4) === 'ftyp' && in_array(substr($bytes, 8, 4), ['avif', 'avis'], true)) {
        return 'image/avif';
    }
    return null;
}

/** Tamanho total que o cabeçalho WebP declara (0 se não for WebP). Usado para detectar arquivo truncado. */
function nte_img_webp_declared_size(string $head): int
{
    if (strlen($head) < 12 || substr($head, 0, 4) !== 'RIFF' || substr($head, 8, 4) !== 'WEBP') {
        return 0;
    }
    $unpacked = unpack('V', substr($head, 4, 4));
    return $unpacked ? ((int)$unpacked[1] + 8) : 0;
}

/** Conteúdo em memória é uma imagem íntegra? */
function nte_img_is_valid(string $bytes): bool
{
    $len = strlen($bytes);
    if ($len < 100 || nte_img_mime_from_bytes($bytes) === null) {
        return false;
    }
    $declared = nte_img_webp_declared_size($bytes);
    return $declared === 0 || $len >= $declared;
}

/** Arquivo no disco existe e é uma imagem íntegra? (não carrega o arquivo inteiro na memória) */
function nte_img_local_ok(string $path): bool
{
    if (!is_file($path)) {
        return false;
    }
    $size = @filesize($path);
    if ($size === false || $size < 100) {
        return false;
    }
    $fh = @fopen($path, 'rb');
    if (!$fh) {
        return false;
    }
    $head = (string)fread($fh, 16);
    fclose($fh);
    if (nte_img_mime_from_bytes($head) === null) {
        return false;
    }
    $declared = nte_img_webp_declared_size($head);
    return $declared === 0 || $size >= $declared;
}

/**
 * Grava de forma atômica: escreve num temporário do mesmo diretório e troca com rename().
 * O único arquivo removido aqui é o próprio temporário, se a gravação falhar.
 */
function nte_write_atomic(string $path, string $bytes): bool
{
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
        return false;
    }
    $tmp = $path . '.tmp' . getmypid() . '-' . mt_rand(1000, 9999);
    if (@file_put_contents($tmp, $bytes, LOCK_EX) !== strlen($bytes)) {
        @unlink($tmp);
        return false;
    }
    @chmod($tmp, 0644);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

/** Requisição HTTP curta para a VPS. Retorna [código HTTP, corpo]; código 0 = falha de rede. */
function nte_img_http(string $url, int $connectTimeout, int $timeout, array $extra = []): array
{
    $ch = curl_init($url);
    if (!$ch) {
        return [0, ''];
    }
    curl_setopt_array($ch, $extra + [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => $connectTimeout,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    $body = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, is_string($body) ? $body : ''];
}

/** Baixa a imagem da VPS. Só devolve conteúdo se for uma imagem íntegra. */
function nte_img_fetch_from_vps(string $filename, int $timeout = 8): ?string
{
    $name = nte_img_safe_name($filename);
    if ($name === null) {
        return null;
    }
    [$code, $body] = nte_img_http(NTE_IMG_VPS_UPLOADS_URL . rawurlencode($name), 3, $timeout);
    return ($code === 200 && nte_img_is_valid($body)) ? $body : null;
}

/** A VPS serve esta imagem agora? (pede só o começo do arquivo) */
function nte_img_vps_has(string $filename): bool
{
    $name = nte_img_safe_name($filename);
    if ($name === null) {
        return false;
    }
    [$code, $body] = nte_img_http(
        NTE_IMG_VPS_UPLOADS_URL . rawurlencode($name),
        3,
        6,
        [CURLOPT_HTTPHEADER => ['Range: bytes=0-31']]
    );
    return ($code === 200 || $code === 206) && nte_img_mime_from_bytes($body) !== null;
}

/**
 * Envia uma cópia para a VPS e CONFERE que ela passou a servir o arquivo.
 * Retorna false (sem apagar nada) se a VPS estiver fora do ar; o sync-images.php completa depois.
 */
function nte_img_push_to_vps(string $path, string $filename): bool
{
    $name = nte_img_safe_name($filename);
    if ($name === null || !nte_img_local_ok($path) || !function_exists('curl_file_create')) {
        return false;
    }
    $mime = (string)nte_img_mime_from_bytes((string)file_get_contents($path, false, null, 0, 16));
    $ch = curl_init(NTE_IMG_VPS_UPLOAD_API);
    if (!$ch) {
        return false;
    }
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => ['image' => curl_file_create($path, $mime, $name)],
        CURLOPT_HTTPHEADER => ['x-filename: ' . $name],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
    ]);
    curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300 && nte_img_vps_has($name);
}

/**
 * Garante uma cópia local íntegra: se faltar (ou estiver corrompida), baixa da VPS e grava de
 * forma atômica. Se a VPS também não tiver, deixa tudo como está (não apaga o arquivo existente).
 */
function nte_img_ensure_local(string $dir, string $filename, int $timeout = 8): bool
{
    $name = nte_img_safe_name($filename);
    if ($name === null) {
        return false;
    }
    $path = rtrim($dir, '/') . '/' . $name;
    if (nte_img_local_ok($path)) {
        return true;
    }
    $bytes = nte_img_fetch_from_vps($name, $timeout);
    return $bytes !== null && nte_write_atomic($path, $bytes);
}

/** Nomes de arquivo de todas as fotos referenciadas por um produto (image + images[]). */
function nte_img_product_files(array $product): array
{
    $urls = [];
    if (!empty($product['image'])) {
        $urls[] = $product['image'];
    }
    if (!empty($product['images']) && is_array($product['images'])) {
        foreach ($product['images'] as $u) {
            if (!empty($u)) {
                $urls[] = $u;
            }
        }
    }
    $files = [];
    foreach ($urls as $u) {
        $name = nte_img_safe_name((string)parse_url((string)$u, PHP_URL_PATH));
        if ($name !== null) {
            $files[$name] = true;
        }
    }
    return array_keys($files);
}
