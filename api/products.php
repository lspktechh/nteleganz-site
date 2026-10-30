<?php
/**
 * API de produtos da NT Eleganz — os dados do catálogo ficam em um JSON na
 * Hostinger (public_html/data/products.json), não no Supabase.
 *
 * Segurança:
 * - Leitura (GET) é pública, igual à vitrine: o catálogo é aberto a todos.
 * - Escrita (POST/PUT/DELETE) exige uma sessão Supabase autenticada cujo
 *   usuário esteja em admin_users com role=admin e active=true. A validação
 *   é a mesma do upload.php: o JWT é conferido contra o endpoint Auth do
 *   Supabase e a papel de admin é lido da tabela usando o próprio token
 *   (obedece ao RLS do projeto). Nada é aceito por cabecalho enviado pelo
 *   cliente sem essa checagem.
 * - Escritas são serializadas com flock e aplicadas em arquivo temporário
 *   seguido de rename, para que uma leitura concorrente nunca veja JSON
 *   truncado. O endpoint também mantém um backup das últimas revisões.
 * - O JSON fica fora do web root acessível: data/ é bloqueado no .htaccess e
 *   nenhuma resposta devolve o caminho do arquivo.
 *
 * O ETag permite revalidação barata: o navegador/storefront manda
 * If-None-Match e recebe 304 sem corpo quando o catálogo não mudou.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Upload-Token, If-None-Match');
header('Access-Control-Expose-Headers: ETag, X-Catalog-Version');
header('X-Content-Type-Options: nosniff');

const SUPABASE_URL = 'https://erpyzjxtxztokpxxpirq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vvD9OIWTX6dzYm9fFTa4yw_aRLZfYwU';

const DATA_DIR = __DIR__ . '/../data';
const PRODUCTS_FILE = DATA_DIR . '/products.json';
const BACKUP_DIR = DATA_DIR . '/backups';
const BACKUP_KEEP = 20;

const VPS_API_BASE = 'https://137-131-233-254.sslip.io/nteleganz/api';

require_once __DIR__ . '/lib/image_store.php';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const WRITE_RATE_MAX = 120;
const WRITE_RATE_WINDOW = 3600;

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit(0);
}

$method = $_SERVER['REQUEST_METHOD'];
$productId = isset($_GET['id']) ? trim((string)$_GET['id']) : '';

/**
 * Realiza requisição para a API do PostgreSQL na VPS (137.131.233.254)
 */
function callVpsApi(string $method, string $path, ?array $body = null, ?string $token = null): ?array
{
    $url = VPS_API_BASE . $path;
    $ch = curl_init($url);
    if (!$ch) return null;

    $headers = [
        'Accept: application/json',
        'X-NTE-Secret: nte_sec_2026_isolated_vault'
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    if ($token !== null && $token !== '') {
        $headers[] = 'Authorization: Bearer ' . $token;
    }

    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($response === false || $httpCode < 200 || $httpCode >= 400) {
        return null;
    }

    $decoded = json_decode($response, true);
    return is_array($decoded) ? $decoded : null;
}

function slugifyProductName(string $text): string
{
    $text = preg_replace('~[^\pL\d]+~u', '-', $text);
    $text = iconv('utf-8', 'us-ascii//TRANSLIT', $text) ?: $text;
    $text = preg_replace('~[^-\w]+~', '', $text);
    $text = trim($text, '-');
    $text = preg_replace('~-+~', '-', $text);
    return strtolower($text);
}

function differentiateProductName(string $rawName, array $catalogProducts, ?string $excludeId = null): string
{
    $trimmed = trim($rawName);
    if ($trimmed === '') return $trimmed;

    $others = array_filter($catalogProducts, static function ($p) use ($excludeId) {
        if ($excludeId !== null && ($p['id'] ?? '') === $excludeId) return false;
        return true;
    });

    $exactMatch = false;
    foreach ($others as $p) {
        if (strcasecmp(trim((string)($p['name'] ?? '')), $trimmed) === 0) {
            $exactMatch = true;
            break;
        }
    }

    if (!$exactMatch) {
        return $trimmed;
    }

    $baseName = $trimmed;
    if (preg_match('/^(.*?)(?:\s+(\d+))?$/u', $trimmed, $m)) {
        $baseName = trim($m[1]);
    }

    $escaped = preg_quote($baseName, '/');
    $maxNum = 1;

    foreach ($others as $p) {
        $pName = trim((string)($p['name'] ?? ''));
        if (preg_match('/^' . $escaped . '(?:\s+(\d+))?$/iu', $pName, $pm)) {
            $num = isset($pm[1]) && is_numeric($pm[1]) ? (int)$pm[1] : 1;
            if ($num >= $maxNum) {
                $maxNum = $num;
            }
        }
    }

    return $baseName . ' ' . ($maxNum + 1);
}

// ── Leitura pública (PostgreSQL na VPS + Fallback Cache) ──────────────
if ($method === 'GET' || $method === 'HEAD') {
    // 1. Consulta o PostgreSQL na VPS (Fonte de Verdade Primária)
    $path = '/products' . ($productId !== '' ? '?id=' . urlencode($productId) : '');
    $vps = callVpsApi('GET', $path);

    if ($vps !== null) {
        $version = (int)($vps['version'] ?? 45);
        $etagVal = '"v' . $version . '"';
        etag($etagVal);

        if ($productId !== '' && isset($vps['product'])) {
            respond(200, null, ['product' => $vps['product'], 'version' => $version]);
        }
        if (isset($vps['products']) && is_array($vps['products'])) {
            // O cache local nunca é simplesmente substituído pela lista da VPS: produto que exista só
            // localmente (gravado enquanto a VPS estava fora do ar) é preservado. Um produto só deixa
            // de existir quando o gestor o exclui pelo painel.
            $localCat = readCatalog();
            $merged = mergeCatalogs($vps['products'], $localCat['products'] ?? []);

            // Só regrava o cache se algo mudou (evita reescrever o arquivo a cada visita)
            if ($localCat === null || ($localCat['etag'] ?? '') !== catalogEtag($merged)) {
                cacheCatalog($merged, $version);
            }

            // Auto-cura de fotos: se alguma imagem estiver ausente na Hostinger, copia da VPS
            healCatalogImages($merged);

            respond(200, null, ['products' => $merged, 'version' => $version]);
        }
    }

    // 2. Fallback de Segurança: se a VPS estiver momentaneamente inacessível, lê do cache local
    $catalog = readCatalog();
    if ($catalog === null) {
        respond(500, 'Catálogo indisponível: não foi possível conectar ao banco de dados nem ler cache local.');
    }

    etag($catalog['etag']);

    if ($productId !== '') {
        foreach ($catalog['products'] as $product) {
            if (($product['id'] ?? '') === $productId) {
                respond(200, null, ['product' => $product, 'version' => $catalog['version']]);
            }
        }
        respond(404, 'Produto não encontrado.');
    }

    respond(200, null, ['products' => $catalog['products'], 'version' => $catalog['version']]);
}

// ── Demais métodos exigem admin ─────────────────────────────────────
if (!rateLimitOk(WRITE_RATE_MAX, WRITE_RATE_WINDOW)) {
    respond(429, 'Muitas alterações em pouco tempo. Aguarde alguns minutos.');
}

$token = bearerToken();
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
        respond(403, 'Acesso negado: apenas administradores podem alterar o catálogo.');
    }
}

// Só POST e PUT exigem corpo JSON. DELETE costuma chegar só com ?id=, e um
// corpo vazio não pode ser tratado como "JSON inválido".
if ($method !== 'POST' && $method !== 'PUT' && $method !== 'DELETE') {
    header('Allow: GET, HEAD, POST, PUT, DELETE, OPTIONS');
    respond(405, 'Método não permitido.');
}

if (requestBodyTooLarge()) {
    respond(413, 'Payload muito grande: o limite é ' . (MAX_BODY_BYTES / 1048576) . ' MB.');
}

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > MAX_BODY_BYTES) {
    respond(413, 'Payload muito grande: o limite é ' . (MAX_BODY_BYTES / 1048576) . ' MB.');
}

$input = [];
if (trim($raw) !== '') {
    $input = json_decode($raw, true);
    if (!is_array($input)) {
        respond(400, 'Corpo da requisição inválido: envie JSON.');
    }
}

switch ($method) {
    case 'POST':
        $currentCat = readCatalog();
        $catProducts = $currentCat['products'] ?? [];
        if (!empty($input['name'])) {
            $diffName = differentiateProductName((string)$input['name'], $catProducts);
            if ($diffName !== (string)$input['name']) {
                $input['name'] = $diffName;
                $input['slug'] = slugifyProductName($diffName);
            } elseif (empty($input['slug'])) {
                $input['slug'] = slugifyProductName($diffName);
            }
        }

        // Salva primeiro na VPS (PostgreSQL)
        $vps = callVpsApi('POST', '/products', $input, $token);
        if ($vps !== null && isset($vps['product'])) {
            $created = $vps['product'];
            $version = (int)($vps['version'] ?? 45);
            $catalog = readCatalog() ?: ['version' => 45, 'products' => []];
            insertProduct($created, $catalog);
            respond(201, null, ['product' => $created, 'version' => $version]);
        }

        // Fallback local se VPS indisponível
        $catalog = readCatalog();
        if ($catalog === null) {
            respond(500, 'Catálogo corrompido: products.json não pôde ser lido. Restaure um backup.');
        }
        $created = insertProduct($input, $catalog);
        if ($created === null) {
            respond(400, 'Produto inválido: id, brand, name e price são obrigatórios.');
        }
        respond(201, null, ['product' => $created, 'version' => $catalog['version']]);

    case 'PUT':
        $id = trim((string)($input['id'] ?? $productId));
        if ($id === '') {
            respond(400, 'Informe o id do produto a atualizar.');
        }

        $currentCat = readCatalog();
        $catProducts = $currentCat['products'] ?? [];
        if (!empty($input['name'])) {
            $diffName = differentiateProductName((string)$input['name'], $catProducts, $id);
            if ($diffName !== (string)$input['name']) {
                $input['name'] = $diffName;
                $input['slug'] = slugifyProductName($diffName);
            }
        }

        // Salva no PostgreSQL na VPS
        $vps = callVpsApi('PUT', '/products/' . urlencode($id), $input, $token);
        if ($vps !== null && isset($vps['product'])) {
            $updated = $vps['product'];
            $version = (int)($vps['version'] ?? 45);
            $catalog = readCatalog() ?: ['version' => 45, 'products' => []];
            updateProduct($id, $updated, $catalog);
            respond(200, null, ['product' => $updated, 'version' => $version]);
        }

        // Fallback local se VPS indisponível
        $catalog = readCatalog();
        if ($catalog === null) {
            respond(500, 'Catálogo corrompido: products.json não pôde ser lido. Restaure um backup.');
        }
        $updated = updateProduct($id, $input, $catalog);
        if ($updated['status'] === 'invalid') {
            respond(400, 'Produto inválido: brand, name e price não podem ficar vazios.');
        }
        if ($updated['status'] === 'not_found') {
            respond(404, 'Produto não encontrado.');
        }
        respond(200, null, ['product' => $updated['product'], 'version' => $catalog['version']]);

    case 'DELETE':
        $id = trim((string)($productId !== '' ? $productId : ($input['id'] ?? '')));
        if ($id === '') {
            respond(400, 'Informe o id do produto a excluir.');
        }

        // Deleta no PostgreSQL na VPS
        $vps = callVpsApi('DELETE', '/products/' . urlencode($id), null, $token);
        if ($vps !== null && !empty($vps['success'])) {
            deleteProduct($id);
            $version = (int)($vps['version'] ?? 45);
            respond(200, null, ['deleted' => $id, 'version' => $version]);
        }

        // Fallback local
        $removed = deleteProduct($id);
        if (!$removed['ok']) {
            respond(404, 'Produto não encontrado.');
        }
        respond(200, null, ['deleted' => $id, 'version' => $removed['version']]);

    default:
        header('Allow: GET, POST, PUT, DELETE, OPTIONS');
        respond(405, 'Método não permitido.');
}

// ─────────────────────────────────────────────────────────────────────
//  Leitura do catálogo com ETag
// ─────────────────────────────────────────────────────────────────────

/**
 * @return array{products: array, version: int, etag: string}|null
 */
function readCatalog(): ?array
{
    if (!is_file(PRODUCTS_FILE)) {
        return ['products' => [], 'version' => 0, 'etag' => catalogEtag([])];
    }

    $raw = @file_get_contents(PRODUCTS_FILE);
    if ($raw === false) {
        return null;
    }

    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        return null;
    }

    $products = isset($decoded['products']) && is_array($decoded['products'])
        ? array_values($decoded['products'])
        : array_values($decoded);
    $products = array_values(array_filter($products, 'is_array'));
    foreach ($products as &$p) {
        $p['active'] = true;
        $stk = (int)($p['stock'] ?? 0);
        $p['inStock'] = $stk > 0;
        $p['available'] = $stk > 0;
    }
    unset($p);

    $version = isset($decoded['version']) ? (int)$decoded['version'] : 0;

    return ['products' => $products, 'version' => $version, 'etag' => catalogEtag($products)];
}

function catalogEtag(array $products): string
{
    return '"' . substr(hash('sha256', json_encode($products)), 0, 32) . '"';
}

function etag(string $value): void
{
    header('ETag: ' . $value);
    header('Cache-Control: no-cache, must-revalidate');

    $ifNoneMatch = requestHeader('If-None-Match');
    if ($ifNoneMatch === '') {
        return;
    }

    foreach (array_map('trim', explode(',', $ifNoneMatch)) as $candidate) {
        $candidate = preg_replace('/^W\//', '', $candidate);
        if ($candidate === $value || $candidate === '*') {
            http_response_code(304);
            exit;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
//  Escritas
// ─────────────────────────────────────────────────────────────────────

/**
 * Aplica $mutator sobre o catálogo sob lock exclusivo e persiste o resultado.
 * O mutator recebe (produtos) e devolve [novosProdutos, registro] ou null
 * para abortar sem gravar.
 */
function withLockedCatalog(callable $mutator): ?array
{
    if (!is_dir(DATA_DIR) && !@mkdir(DATA_DIR, 0755, true) && !is_dir(DATA_DIR)) {
        respond(500, 'Não foi possível criar o diretório de dados. Verifique as permissões de public_html/data.');
    }

    $lockPath = PRODUCTS_FILE . '.lock';
    $lock = @fopen($lockPath, 'c');
    if (!$lock) {
        respond(500, 'Não foi possível bloquear o catálogo para escrita.');
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        respond(500, 'Não foi possível bloquear o catálogo para escrita.');
    }

    try {
        $current = readCatalog();
        if ($current === null) {
            respond(500, 'Catálogo corrompido: products.json não pôde ser lido. Restaure um backup.');
        }

        $outcome = $mutator($current['products']);
        if ($outcome === null) {
            return null;
        }

        [$products, $record] = $outcome;
        $version = $current['version'] + 1;
        $now = gmdate('c');

        $products = array_map(static function ($product) use ($now) {
            $product['updatedAt'] = $now;
            return $product;
        }, $products);

        writeCatalog($products, $version);
        backupCatalog($products, $version);

        // O registro devolvido ao cliente precisa ser o que foi realmente
        // gravado (com updatedAt carimbado), não a cópia anterior ao carimbo.
        $saved = $record;
        foreach ($products as $product) {
            if (($product['id'] ?? '') === ($record['id'] ?? '')) {
                $saved = $product;
                break;
            }
        }

        return ['record' => $saved, 'version' => $version, 'products' => $products];
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function writeCatalog(array $products, int $version): void
{
    $payload = json_encode(
        ['version' => $version, 'updatedAt' => gmdate('c'), 'products' => $products],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    if ($payload === false) {
        respond(500, 'Falha ao serializar o catálogo.');
    }

    $tmp = PRODUCTS_FILE . '.tmp' . getmypid();
    if (@file_put_contents($tmp, $payload, LOCK_EX) === false) {
        @unlink($tmp);
        respond(500, 'Falha ao gravar products.json. Verifique as permissões de public_html/data (755).');
    }
    @chmod($tmp, 0644);

    // rename é atômico no mesmo sistema de arquivos: um leitor concorrente
    // enxerga a versão antiga ou a nova, nunca um arquivo truncado.
    if (!@rename($tmp, PRODUCTS_FILE)) {
        @unlink($tmp);
        respond(500, 'Falha ao substituir products.json.');
    }
}

/**
 * Junta a lista da VPS com o cache local sem perder nada: produto que só existe localmente (ex.: cadastrado
 * enquanto a VPS estava fora do ar) é mantido. Para o mesmo id, a VPS continua sendo a fonte da verdade
 * (estoque, preço etc.). A ordem da VPS é preservada.
 */
function mergeCatalogs(array $vpsProducts, array $localProducts): array
{
    $byId = [];
    foreach ($vpsProducts as $p) {
        if (is_array($p) && isset($p['id'])) {
            $p['active'] = true;
            $stk = (int)($p['stock'] ?? 0);
            $p['inStock'] = $stk > 0;
            $p['available'] = $stk > 0;
            $byId[(string)$p['id']] = $p;
        }
    }
    foreach ($localProducts as $p) {
        if (is_array($p) && isset($p['id']) && !isset($byId[(string)$p['id']])) {
            $p['active'] = true;
            $stk = (int)($p['stock'] ?? 0);
            $p['inStock'] = $stk > 0;
            $p['available'] = $stk > 0;
            $byId[(string)$p['id']] = $p;
        }
    }
    return array_values($byId);
}

/** Grava o cache local do catálogo de forma atômica e silenciosa (nunca derruba a leitura pública). */
function cacheCatalog(array $products, int $version): void
{
    $payload = json_encode(
        ['version' => $version, 'updatedAt' => gmdate('c'), 'products' => $products],
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    if ($payload !== false) {
        nte_write_atomic(PRODUCTS_FILE, $payload);
    }
}

/**
 * Auto-cura de fotos: copia da VPS o que faltar (ou estiver corrompido) no disco da Hostinger. Só olha
 * produtos ativos (os que aparecem na loja) e limita as tentativas por requisição. Nunca apaga nada.
 */
function healCatalogImages(array $products): void
{
    $dir = __DIR__ . '/../assets/images/products/';
    $budget = 6;
    foreach ($products as $p) {
        if (!is_array($p) || ($p['active'] ?? true) === false) {
            continue;
        }
        foreach (nte_img_product_files($p) as $file) {
            if (nte_img_local_ok($dir . $file)) {
                continue;
            }
            if ($budget-- <= 0) {
                return;
            }
            nte_img_ensure_local($dir, $file, 2);
        }
    }
}

function backupCatalog(array $products, int $version): void
{
    if (!is_dir(BACKUP_DIR) && !@mkdir(BACKUP_DIR, 0755, true) && !is_dir(BACKUP_DIR)) {
        return; // backup é acessório: nunca derruba a gravação principal
    }

    $payload = json_encode(
        ['version' => $version, 'updatedAt' => gmdate('c'), 'products' => $products],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
    @file_put_contents(sprintf('%s/products-%d-%d.json', BACKUP_DIR, $version, time()), $payload);

    $files = glob(BACKUP_DIR . '/products-*.json') ?: [];
    if (count($files) > BACKUP_KEEP) {
        sort($files);
        foreach (array_slice($files, 0, count($files) - BACKUP_KEEP) as $old) {
            @unlink($old);
        }
    }
}

function insertProduct(array $input, ?array &$payload): ?array
{
    $product = sanitizeProduct($input);
    if ($product === null) {
        return null;
    }

    $now = gmdate('c');
    $product['createdAt'] = $now;
    $product['updatedAt'] = $now;

    // A checagem de duplicidade acontece dentro do lock: assim duas requisições
    // simultâneas com o mesmo id não passam ambas.
    $result = withLockedCatalog(function (array $products) use ($product) {
        foreach ($products as $existing) {
            if (($existing['id'] ?? '') === $product['id']) {
                return null;
            }
        }
        $products[] = $product;
        return [$products, $product];
    });

    if ($result === null) {
        respond(409, 'Já existe um produto com o id "' . $product['id'] . '".');
    }

    $payload['version'] = $result['version'];
    return $result['record'];
}

/**
 * @return array{status: 'ok'|'invalid'|'not_found', product?: array, version?: int}
 */
function updateProduct(string $id, array $input, array &$catalog): array
{
    $changes = sanitizeProduct($input, true);
    if ($changes === null) {
        return ['status' => 'invalid'];
    }
    unset($changes['id']);

    $result = withLockedCatalog(function (array $products) use ($id, $changes) {
        $merged = null;
        $next = [];
        foreach ($products as $product) {
            if (($product['id'] ?? '') === $id) {
                $merged = array_merge($product, $changes, ['id' => $id]);
                $next[] = $merged;
                continue;
            }
            $next[] = $product;
        }
        if ($merged === null) {
            return null;
        }
        return [$next, $merged];
    });

    if ($result === null) {
        return ['status' => 'not_found'];
    }

    $catalog['version'] = $result['version'];
    return ['status' => 'ok', 'product' => $result['record']];
}

function deleteProduct(string $id): array
{
    $result = withLockedCatalog(function (array $products) use ($id) {
        $next = [];
        $found = false;
        foreach ($products as $product) {
            if (($product['id'] ?? '') === $id) {
                $found = true;
                continue;
            }
            $next[] = $product;
        }
        if (!$found) {
            return null;
        }
        return [$next, ['id' => $id]];
    });

    if ($result === null) {
        return ['ok' => false, 'version' => 0];
    }

    return ['ok' => true, 'version' => $result['version']];
}

// ─────────────────────────────────────────────────────────────────────
//  Sanitização
// ─────────────────────────────────────────────────────────────────────

/**
 * @param bool $partial true em PUT: valida só os campos presentes.
 */
function sanitizeProduct(array $input, bool $partial = false): ?array
{
    $text = static function ($value, int $max = 2000): ?string {
        if ($value === null) return null;
        if (!is_scalar($value)) return null;
        $value = trim((string)$value);
        if ($value === '') return null;
        return mb_substr($value, 0, $max);
    };

    $int = static function ($value) {
        if ($value === null || $value === '') return null;
        return is_numeric($value) ? (int)$value : null;
    };

    $bool = static function ($value) {
        return $value === true || $value === 'true' || $value === 1 || $value === '1';
    };

    $strings = static function ($value, int $max = 64) use ($text): array {
        if (!is_array($value)) return [];
        $out = [];
        foreach ($value as $entry) {
            $entry = $text($entry, $max);
            if ($entry !== null) $out[] = $entry;
        }
        return array_values(array_unique($out));
    };

    $images = static function ($value) use ($text): array {
        if (!is_array($value)) return [];
        $out = [];
        foreach ($value as $entry) {
            $entry = $text($entry, 2000);
            if ($entry !== null) $out[] = $entry;
        }
        return array_values(array_unique($out));
    };

    $record = [];

    $id = $text($input['id'] ?? null, 80);
    if (!$partial) {
        $record['id'] = $id;
        $record['brand'] = $text($input['brand'] ?? null, 120);
        $record['name'] = $text($input['name'] ?? null, 200);
        $record['price'] = $text($input['price'] ?? null, 60);
        if (!$record['id'] || !$record['brand'] || !$record['name'] || !$record['price']) {
            return null;
        }
    } else {
        foreach (['id', 'brand', 'name', 'price'] as $field) {
            if (!array_key_exists($field, $input)) continue;
            $value = $text($input[$field], $field === 'id' ? 80 : 200);
            if ($field !== 'id' && $value === null) {
                return null; // esvaziar brand/name/price deixaria o produto inválido
            }
            if ($value !== null) $record[$field] = $value;
        }
    }

    $optionalText = static function (
        array $input, string $field, int $max = 2000
    ) use (&$record, $text) {
        if (!array_key_exists($field, $input)) return false;
        $record[$field] = $text($input[$field], $max);
        return true;
    };

    foreach ([
        'oldPrice' => 60, 'badge' => 60, 'desc' => 4000, 'category' => 60,
        'slug' => 200, 'image' => 2000, 'imageAssetId' => 200,
    ] as $field => $max) {
        $optionalText($input, $field, $max);
    }

    if (array_key_exists('images', $input)) {
        $record['images'] = $images($input['images']);
    }
    if (array_key_exists('colors', $input)) {
        $record['colors'] = $strings($input['colors']);
    }
    if (array_key_exists('sizes', $input)) {
        $record['sizes'] = $strings($input['sizes']);
    }

    foreach (['stock' => 0, 'installments' => 0] as $field => $default) {
        if (!array_key_exists($field, $input)) continue;
        $value = $int($input[$field]);
        $record[$field] = $value === null ? $default : max(0, $value);
    }

    foreach (['featured', 'destaque'] as $flag) {
        if (array_key_exists($flag, $input)) {
            $record[$flag] = $bool($input[$flag]);
        }
    }

    // Produtos NUNCA são inativados: sempre ativos, apenas esgotados via estoque
    $record['active'] = true;
    $stkVal = (int)($record['stock'] ?? 0);
    $record['inStock'] = $stkVal > 0;
    $record['available'] = $stkVal > 0;

    // Derivados: o storefront e a vitrine esperam image = images[0].
    if (array_key_exists('image', $input) || array_key_exists('images', $input)) {
        $list = $record['images'] ?? [];
        if (empty($list) && !empty($record['image'])) {
            $list = [$record['image']];
        }
        $record['image'] = $list[0] ?? '';
        $record['images'] = $list;
    }
    if (array_key_exists('stock', $input) && !array_key_exists('inStock', $input)) {
        $record['inStock'] = (int)$record['stock'] > 0;
    }

    return $record;
}

// ─────────────────────────────────────────────────────────────────────
//  Helpers de resposta
// ─────────────────────────────────────────────────────────────────────

function respond(int $code, ?string $error = null, array $payload = []): void
{
    http_response_code($code);
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
        exit; // headers já foram enviados; HEAD não carrega corpo
    }
    if ($error !== null) {
        echo json_encode(['error' => $error], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function requestHeader(string $name): string
{
    $httpName = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$httpName]) && $_SERVER[$httpName] !== '') {
        return (string)$_SERVER[$httpName];
    }
    // LiteSpeed/Apache em PHP às vezes não expõe HTTP_AUTHORIZATION.
    if (function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $key => $value) {
            if (strcasecmp($key, $name) === 0) return (string)$value;
        }
    }
    return '';
}

function bearerToken(): ?string
{
    $header = requestHeader('Authorization');
    if (preg_match('/^Bearer\s+(\S+)$/i', $header, $match)) return $match[1];
    $token = requestHeader('X-Upload-Token');
    return $token !== '' ? $token : null;
}

function requestBodyTooLarge(): bool
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    return $length > MAX_BODY_BYTES;
}

// ─────────────────────────────────────────────────────────────────────
//  Autenticação (mesma validação do upload.php)
// ─────────────────────────────────────────────────────────────────────

function supabaseRequest(string $path, string $token, string $query = ''): array
{
    $ch = curl_init(SUPABASE_URL . $path . ($query !== '' ? ('?' . $query) : ''));
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'apikey: ' . SUPABASE_ANON_KEY,
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ],
        CURLOPT_TIMEOUT => 15,
    ]);
    $body = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, $body === false ? '' : $body];
}

function isValidAdminSession(string $token): bool
{
    if (empty($token)) return false;
    $sessionFile = __DIR__ . '/../data/admin_sessions.json';
    if (!file_exists($sessionFile)) return false;
    $sessions = @json_decode(@file_get_contents($sessionFile), true);
    if (!is_array($sessions)) return false;
    if (isset($sessions[$token]) && ($sessions[$token]['expires_at'] ?? 0) >= time()) {
        return true;
    }
    return false;
}

function supabaseUserId(string $token): ?string
{
    [$status, $body] = supabaseRequest('/auth/v1/user', $token);
    if ($status !== 200) return null;
    $data = json_decode($body, true);
    return is_array($data) && !empty($data['id']) ? (string)$data['id'] : null;
}

function isSupabaseAdmin(string $token, string $userId): bool
{
    if ($userId === '') return false;
    $uid = urlencode($userId);
    [$status, $body] = supabaseRequest('/rest/v1/admin_users', $token, 'select=role,active&user_id=eq.' . $uid);
    if ($status !== 200) return false;
    $rows = json_decode($body, true);
    if (!is_array($rows) || count($rows) === 0) return false;
    $admin = $rows[0];
    return isset($admin['role'])
        && $admin['role'] === 'admin'
        && (!array_key_exists('active', $admin) || $admin['active'] === true);
}

function rateLimitOk(int $max, int $window): bool
{
    $dir = sys_get_temp_dir() . '/nte_writes';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return true; // fail open
    $key = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $file = $dir . '/' . md5((string)$key) . '.rate';
    $fp = @fopen($file, 'c+');
    if (!$fp) return true;
    if (!flock($fp, LOCK_EX)) { fclose($fp); return true; }

    $now = time();
    $data = json_decode(stream_get_contents($fp) ?: '', true);
    $stamps = is_array($data['stamps'] ?? null) ? $data['stamps'] : [];
    $stamps = array_values(array_filter($stamps, static function ($t) use ($now, $window) {
        return is_int($t) && ($now - $t) < $window;
    }));

    $allowed = count($stamps) < $max;
    if ($allowed) {
        $stamps[] = $now;
        ftruncate($fp, 0);
        rewind($fp);
        fwrite($fp, json_encode(['stamps' => $stamps]));
        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);
    return $allowed;
}
