<?php
/**
 * Upload de imagens de produtos para Hostinger
 * Coloque este arquivo na raiz do site (public_html/upload.php)
 * Requer PHP 7.4+ com extensões curl, fileinfo e gd.
 *
 * Segurança:
 * - Exige uma sessão Supabase autenticada de um admin. O token JWT é validado
 *   de verdade contra o endpoint Auth do Supabase e a tabela admin_users é
 *   consultada com o próprio token do usuário (obedece o RLS do projeto).
 * - Rate limit por IP.
 * - Recusa qualquer payload que não seja uma imagem decodificável (não grava
 *   conteúdo arbitrário no disco).
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Upload-Token');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/api/lib/image_store.php';

// Configuração pública do Supabase (mesma de js/db.js). A chave é publicável:
// a proteção real está nas políticas RLS + na checagem de admin abaixo.
const SUPABASE_URL = 'https://erpyzjxtxztokpxxpirq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vvD9OIWTX6dzYm9fFTa4yw_aRLZfYwU';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, 'Método não permitido');
}

if (!rateLimitOk()) {
    respond(429, 'Muitos uploads feitos agora. Tente novamente em alguns minutos.');
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

$token = bearerToken($data);
if (!$token) {
    respond(401, 'Acesso não autenticado: informe a sessão do administrador.');
}

$isAdmin = isValidAdminSession($token);
if (!$isAdmin) {
    $userId = supabaseUserId($token);
    if (!$userId) {
        respond(401, 'Sessão inválida ou expirada. Faça login novamente no painel.');
    }

    if (!isSupabaseAdmin($token, $userId)) {
        respond(403, 'Acesso negado: apenas administradores podem enviar imagens.');
    }
}

if (!isset($data['image'], $data['productId'], $data['index'])) {
    respond(400, 'Dados inválidos: image, productId e index são obrigatórios');
}

// Validar e decodificar base64
$base64 = $data['image'];
if (!preg_match('#^data:image/(webp|jpeg|png|gif);base64,#', $base64)) {
    respond(400, 'Formato de imagem inválido. Use WebP, JPEG, PNG ou GIF');
}

$base64 = preg_replace('#^data:image/\w+;base64,#', '', $base64);
$binary = base64_decode($base64, true);
if ($binary === false) {
    respond(400, 'Base64 inválido');
}

// Limitar tamanho (20MB)
if (strlen($binary) > 20 * 1024 * 1024) {
    respond(400, 'Imagem excede 20MB');
}

// Converter para WebP — recusa conteúdo não decodificável (sem fallback cru).
$im = imagecreatefromstring($binary);
if ($im === false) {
    respond(400, 'O arquivo enviado não é uma imagem válida.');
}

// Diretório de destino
$targetDir = __DIR__ . '/assets/images/products/';
if (!is_dir($targetDir) && !mkdir($targetDir, 0755, true)) {
    respond(500, 'Não foi possível criar diretório de upload');
}

// Gerar nome único: productId-index-timestamp.webp
$productId = preg_replace('/[^a-zA-Z0-9_-]/', '', $data['productId']);
$index = max(0, (int)$data['index']);
$filename = sprintf('%s-%d-%d.webp', $productId, $index, time());
$filepath = $targetDir . $filename;

// Redimensionar se maior que 1200px no lado maior
$width = imagesx($im);
$height = imagesy($im);
$maxSide = 1200;
if ($width > $maxSide || $height > $maxSide) {
    $scale = min(1, $maxSide / max($width, $height));
    $newWidth = max(1, (int)round($width * $scale));
    $newHeight = max(1, (int)round($height * $scale));
    $resized = imagecreatetruecolor($newWidth, $newHeight);
    imagealphablending($resized, false);
    imagesavealpha($resized, true);
    imagecopyresampled($resized, $im, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
    imagedestroy($im);
    $im = $resized;
}

$saved = imagewebp($im, $filepath, 80);
imagedestroy($im);

if (!$saved) {
    respond(500, 'Falha ao salvar imagem como WebP');
}

// Armazenamento com sincronização dupla: Hostinger (local) + VPS (remoto).
// A cópia na VPS é conferida de verdade (a VPS precisa estar servindo o arquivo). Se falhar, a foto
// continua salva na Hostinger e o api/sync-images.php completa a segunda cópia depois.
$vpsSaved = false;
try {
    $vpsSaved = nte_img_push_to_vps($filepath, $filename);
} catch (\Throwable $t) {
    // Falha silenciosa para não travar o cliente caso a VPS esteja ocupada
}

// Retornar SEMPRE a URL canônica primária oficial do domínio nteleganz.com.br.
// Isso evita que fotos fiquem invisíveis para clientes ou donos em redes/dispositivos
// que bloqueiam domínios curinga como *.sslip.io (redes universitárias, corporativas, pi-hole, etc.).
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'https';
$host = !empty($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'nteleganz.com.br';
$publicUrl = sprintf('%s://%s/assets/images/products/%s', $protocol, $host, $filename);

echo json_encode([
    'url' => $publicUrl,
    'filename' => $filename,
    'vpsSynced' => $vpsSaved
]);

// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────

function respond($code, $message) {
    http_response_code($code);
    echo json_encode(['error' => $message]);
    exit;
}

function requestHeader($name) {
    $httpName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$httpName]) && $_SERVER[$httpName] !== '') {
        return $_SERVER[$httpName];
    }
    // LiteSpeed/Apache módulo php não costuma expor HTTP_AUTHORIZATION.
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $key => $value) {
            if (strcasecmp($key, $name) === 0) return $value;
        }
    }
    return '';
}

function bearerToken($data = null) {
    $header = requestHeader('Authorization');
    if (preg_match('/^Bearer\s+(\S+)$/i', $header, $match)) return $match[1];
    $token = requestHeader('X-Upload-Token');
    if ($token !== '') return $token;
    if (is_array($data) && !empty($data['token'])) return trim((string)$data['token']);
    if (!empty($_GET['token'])) return trim((string)$_GET['token']);
    return null;
}

function supabaseRequest($path, $token, $query = '') {
    $ch = curl_init(SUPABASE_URL . $path . ($query !== '' ? ('?' . $query) : ''));
    curl_setopt_array($ch, array(
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => array(
            'apikey: ' . SUPABASE_ANON_KEY,
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ),
        CURLOPT_TIMEOUT => 15,
    ));
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return array($status, $body);
}

function isValidAdminSession($token) {
    if (empty($token)) return false;
    $sessionFile = __DIR__ . '/data/admin_sessions.json';
    if (!file_exists($sessionFile)) return false;
    $sessions = @json_decode(@file_get_contents($sessionFile), true);
    if (!is_array($sessions)) return false;
    if (isset($sessions[$token]) && ($sessions[$token]['expires_at'] ?? 0) >= time()) {
        return true;
    }
    return false;
}

function supabaseUserId($token) {
    list($status, $body) = supabaseRequest('/auth/v1/user', $token);
    if ($status !== 200) return null;
    $data = json_decode($body, true);
    return is_array($data) && !empty($data['id']) ? $data['id'] : null;
}

function isSupabaseAdmin($token, $userId) {
    if (!$userId) return false;
    $uid = urlencode($userId);
    list($status, $body) = supabaseRequest('/rest/v1/admin_users', $token, 'select=role,active&user_id=eq.' . $uid);
    if ($status !== 200) return false;
    $rows = json_decode($body, true);
    if (!is_array($rows) || count($rows) === 0) return false;
    $admin = $rows[0];
    return isset($admin['role'])
        && $admin['role'] === 'admin'
        && (!array_key_exists('active', $admin) || $admin['active'] === true);
}

function rateLimitOk($max = 60, $window = 3600) {
    $dir = sys_get_temp_dir() . '/nte_uploads';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) return true; // fail open
    $key = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    $file = $dir . '/' . md5($key) . '.rate';
    $fp = @fopen($file, 'c+');
    if (!$fp) return true;
    if (!flock($fp, LOCK_EX)) { fclose($fp); return true; }

    $now = time();
    $raw = stream_get_contents($fp);
    $data = json_decode($raw, true);
    $stamps = is_array($data) && isset($data['stamps']) && is_array($data['stamps']) ? $data['stamps'] : array();
    $stamps = array_values(array_filter($stamps, function ($t) use ($now, $window) {
        return is_int($t) && ($now - $t) < $window;
    }));

    $allowed = count($stamps) < $max;
    if ($allowed) {
        $stamps[] = $now;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode(array('stamps' => $stamps)));
        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);
    return $allowed;
}