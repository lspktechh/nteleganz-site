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
// Fila de sincronização com a VPS (cópia de segurança): id => 'upsert' | 'delete'.
const VPS_QUEUE_FILE = DATA_DIR . '/vps_product_queue.json';

const VPS_API_BASE = 'https://137-131-233-254.sslip.io/nteleganz/api';

require_once __DIR__ . '/lib/image_store.php';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
// Só o admin logado grava; 120/h travava o dono editando vários produtos seguidos.
const WRITE_RATE_MAX = 600;
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
function callVpsApi(string $method, string $path, ?array $body = null, ?string $token = null, int $timeout = 3, ?int &$httpStatus = null): ?array
{
    $url = VPS_API_BASE . $path;
    $ch = curl_init($url);
    if (!$ch) return null;

    $headers = [
        'Accept: application/json',
        nte_vps_secret_header()
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
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, min(2, $timeout));
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

    $response = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $httpStatus = $response === false ? 0 : $httpCode;

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
    // 1. Fast ETag Check: se o cliente enviou If-None-Match e o cache local existe,
    // confere instantaneamente em ~1ms sem precisar fazer round-trip na VPS!
    $localCat = readCatalog();
    if ($localCat !== null && !empty($localCat['etag'])) {
        $clientEtag = trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
        if ($clientEtag !== '' && ($clientEtag === $localCat['etag'] || $clientEtag === 'W/' . $localCat['etag'])) {
            header('ETag: ' . $localCat['etag']);
            header('X-Catalog-Source: cache-etag-hit');
            http_response_code(304);
            exit;
        }
    }

    // 2. O catálogo LOCAL é a fonte da verdade. Antes, depois de 30s a lista da VPS era mesclada
    // por cima dele: se uma gravação não tinha chegado à VPS (lenta, 0,5–7s), a versão antiga
    // voltava — produto esgotado "voltava ao estoque", tamanho novo sumia, excluído reaparecia.
    // A VPS agora é só cópia de segurança (sincronizada depois de cada gravação, com fila).
    if ($localCat === null) {
        $localCat = readCatalog();
    }
    if ($localCat !== null && !empty($localCat['products'])) {
        etag($localCat['etag']);
        header('X-Catalog-Source: local');
        // Mesma normalização de antes (estoque -> inStock/available, janela VIP ainda ativa e
        // segundos restantes): calculada na hora, sobre o catálogo local.
        $normalized = mergeCatalogs([], $localCat['products']);
        if ($productId !== '') {
            foreach ($normalized as $product) {
                if (($product['id'] ?? '') === $productId) {
                    respond(200, null, ['product' => $product, 'version' => $localCat['version']]);
                }
            }
            respond(404, 'Produto não encontrado.');
        }
        respondThenHeal($normalized, (int)$localCat['version']);
    }

    // 3. Sem catálogo local (primeira subida ou arquivo perdido): recupera da VPS
    $path = '/products' . ($productId !== '' ? '?id=' . urlencode($productId) : '');
    $vps = callVpsApi('GET', $path, null, null, 2);

    if ($vps !== null) {
        $version = (int)($vps['version'] ?? 45);
        $etagVal = '"v' . $version . '"';
        etag($etagVal);

        if ($productId !== '' && isset($vps['product'])) {
            respond(200, null, ['product' => $vps['product'], 'version' => $version]);
        }
        if (isset($vps['products']) && is_array($vps['products'])) {
            if ($localCat === null) {
                $localCat = readCatalog();
            }
            $merged = mergeCatalogs($vps['products'], $localCat['products'] ?? []);

            if ($localCat === null || ($localCat['etag'] ?? '') !== catalogEtag($merged)) {
                cacheCatalog($merged, $version);
            }

            respondThenHeal($merged, $version);
        }
    }

    // 4. Fallback de Segurança: lê do cache local
    if ($localCat === null) {
        $localCat = readCatalog();
    }
    if ($localCat === null) {
        respond(500, 'Catálogo indisponível: não foi possível conectar ao banco de dados nem ler cache local.');
    }

    etag($localCat['etag']);

    if ($productId !== '') {
        foreach ($localCat['products'] as $product) {
            if (($product['id'] ?? '') === $productId) {
                respond(200, null, ['product' => $product, 'version' => $localCat['version']]);
            }
        }
        respond(404, 'Produto não encontrado.');
    }

    respond(200, null, ['products' => $localCat['products'], 'version' => $localCat['version']]);
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

        // Grava no catálogo local (fonte da verdade) e responde na hora; a VPS é atualizada depois.
        if (empty($input['id'])) {
            $input['id'] = 'prod_' . round(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(4)), 0, 5);
        }
        $catalog = readCatalog();
        if ($catalog === null) {
            respond(500, 'Catálogo corrompido: products.json não pôde ser lido. Restaure um backup.');
        }
        $created = insertProduct($input, $catalog);
        if ($created === null) {
            respond(400, 'Produto inválido: marca, nome e preço são obrigatórios.');
        }
        respondThenSyncVps(201, ['product' => $created, 'version' => $catalog['version']], (string)$created['id'], 'upsert');

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

        $catalog = readCatalog();
        if ($catalog === null) {
            respond(500, 'Catálogo corrompido: products.json não pôde ser lido. Restaure um backup.');
        }
        $updated = updateProduct($id, $input, $catalog);
        if ($updated['status'] === 'invalid') {
            respond(400, 'Produto inválido: marca, nome e preço não podem ficar vazios.');
        }
        if ($updated['status'] === 'not_found') {
            respond(404, 'Produto não encontrado.');
        }
        respondThenSyncVps(200, ['product' => $updated['product'], 'version' => $catalog['version']], $id, 'upsert');

    case 'DELETE':
        $id = trim((string)($productId !== '' ? $productId : ($input['id'] ?? '')));
        if ($id === '') {
            respond(400, 'Informe o id do produto a excluir.');
        }

        $removed = deleteProduct($id);
        if (!$removed['ok']) {
            respond(404, 'Produto não encontrado.');
        }
        respondThenSyncVps(200, ['deleted' => $id, 'version' => $removed['version']], $id, 'delete');

    default:
        header('Allow: GET, POST, PUT, DELETE, OPTIONS');
        respond(405, 'Método não permitido.');
}

// ─────────────────────────────────────────────────────────────────────
//  Leitura do catálogo com ETag
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
//  Espelho na VPS (cópia de segurança) com fila de nova tentativa
// ─────────────────────────────────────────────────────────────────────

/** Lê/atualiza a fila sob lock. $mutator recebe a fila e devolve a nova. */
function withVpsQueue(callable $mutator): array
{
    $fh = @fopen(VPS_QUEUE_FILE, 'c+');
    if (!$fh) return [];
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $queue = $raw ? json_decode($raw, true) : [];
    if (!is_array($queue)) $queue = [];
    $next = $mutator($queue);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($next, JSON_UNESCAPED_SLASHES));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $next;
}

function enqueueVpsSync(string $id, string $op): void
{
    withVpsQueue(static function (array $queue) use ($id, $op): array {
        $queue[$id] = $op; // a última operação sobre o produto é a que vale
        return $queue;
    });
}

/** Envia para a VPS o estado ATUAL do produto (ou a exclusão). true = VPS em dia. */
function pushProductToVps(string $id, string $op, array $localProducts): bool
{
    $current = null;
    foreach ($localProducts as $product) {
        if (($product['id'] ?? '') === $id) { $current = $product; break; }
    }
    if ($op === 'upsert' && $current === null) {
        $op = 'delete'; // foi excluído depois de entrar na fila
    }

    $status = 0;
    if ($op === 'delete') {
        $res = callVpsApi('DELETE', '/products/' . urlencode($id), null, null, 5, $status);
        return ($res !== null && !empty($res['success'])) || $status === 404;
    }
    // POST da VPS é upsert pelo id: manda o registro completo, não só o que mudou.
    $res = callVpsApi('POST', '/products', $current, null, 5, $status);
    if ($res !== null && isset($res['product'])) return true;
    // A VPS recusou o registro (4xx que não é limite/timeout): reenviar não muda nada.
    // Sai da fila para não ficar tentando para sempre; o catálogo local continua certo.
    if ($status >= 400 && $status < 500 && $status !== 408 && $status !== 429) {
        error_log("[products] VPS recusou o produto {$id} (HTTP {$status}); removido da fila de espelho.");
        return true;
    }
    return false;
}

/** Tenta esvaziar a fila (até $max itens). Roda depois de a resposta já ter saído. */
function drainVpsQueue(int $max = 5): void
{
    $queue = withVpsQueue(static function (array $q): array { return $q; });
    if (!$queue) return;
    $catalog = readCatalog();
    $products = $catalog['products'] ?? [];
    $done = [];
    foreach (array_slice($queue, 0, $max, true) as $id => $op) {
        if (pushProductToVps((string)$id, (string)$op, $products)) {
            $done[(string)$id] = $op;
        }
    }
    if ($done) {
        withVpsQueue(static function (array $q) use ($done): array {
            foreach ($done as $id => $op) {
                if (($q[$id] ?? null) === $op) unset($q[$id]); // não remove se mudou nesse meio-tempo
            }
            return $q;
        });
    }
}

/**
 * Responde ao painel IMEDIATAMENTE (a gravação local já aconteceu) e só depois espelha na VPS.
 * Antes a resposta esperava a VPS (até 3s) e, se ela falhasse, a VPS ficava com a versão antiga.
 */
function respondThenSyncVps(int $code, array $payload, string $id, string $op): void
{
    enqueueVpsSync($id, $op);
    $finish = function_exists('fastcgi_finish_request') ? 'fastcgi_finish_request'
        : (function_exists('litespeed_finish_request') ? 'litespeed_finish_request' : null);

    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    ignore_user_abort(true);
    http_response_code($code);
    echo $body;
    if ($finish !== null) {
        $finish();
        drainVpsQueue();
    }
    // Sem como liberar a conexão antes: não segura o painel esperando a VPS; a fila é
    // processada nas próximas leituras do catálogo (respondThenHeal).
    exit;
}

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
 * (estoque, preço etc.). A ordem da VPS é preservada e nada que a VPS devolveu é descartado (nem item sem
 * id, nem id repetido); do cache local só entra o que a VPS não tem.
 */
function mergeCatalogs(array $vpsProducts, array $localProducts): array
{
    // Produtos nunca são inativados: sempre ativos, esgotados apenas pelo estoque
    $normalize = static function (array $p): array {
        $p['active'] = true;
        $stk = (int)($p['stock'] ?? 0);
        $p['inStock'] = $stk > 0;
        $p['available'] = $stk > 0;
        $isSingle = ($stk === 1) && ($p['active'] !== false) && ($p['available'] !== false);
        $p['singlePiece'] = $isSingle;
        $p['pecaUnica'] = $isSingle;
        $p['peca_unica'] = $isSingle;
        $p['single_piece'] = $isSingle;

        // Acesso Antecipado / Exclusividade VIP
        $isVip = !empty($p['isVipExclusive']) || !empty($p['vipExclusive']) || !empty($p['vipOnly']);
        $p['isVipExclusive'] = $isVip;
        $p['vipExclusive'] = $isVip;
        $p['vipEarlyAccessActive'] = false;
        $p['vipRemainingSeconds'] = 0;
        $p['vipDiscountPercent'] = max(0, min(90, (int)round((float)($p['vipDiscountPercent'] ?? 0))));

        if ($isVip) {
            $duration = (string)($p['vipReleaseDuration'] ?? '48');
            if ($duration === 'forever') {
                $p['vipEarlyAccessActive'] = true;
                $p['vipRemainingSeconds'] = 999999999;
            } elseif (!empty($p['vipEarlyAccessUntil'])) {
                $untilTs = strtotime((string)$p['vipEarlyAccessUntil']);
                $nowTs = time();
                if ($untilTs > $nowTs) {
                    $p['vipEarlyAccessActive'] = true;
                    $p['vipRemainingSeconds'] = max(0, $untilTs - $nowTs);
                } else {
                    $p['vipEarlyAccessActive'] = false;
                }
            }
        }

        return $p;
    };

    $merged = [];
    $seen = [];
    foreach ($vpsProducts as $p) {
        if (!is_array($p)) {
            continue;
        }
        $merged[] = $normalize($p);
        if (isset($p['id'])) {
            $seen[(string)$p['id']] = true;
        }
    }
    // Item local sem id não volta: não dá para saber se a VPS já o devolveu, e voltaria duplicado a cada visita
    foreach ($localProducts as $p) {
        if (is_array($p) && isset($p['id']) && !isset($seen[(string)$p['id']])) {
            $merged[] = $normalize($p);
            $seen[(string)$p['id']] = true;
        }
    }
    return $merged;
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
 * produtos ativos (os que aparecem na loja) e limita as tentativas por requisição. Foto que falhou na VPS
 * não é tentada de novo antes de NTE_IMG_MISSING_TTL: sem isso, uma foto que não existe em lugar nenhum
 * custaria uma ida à VPS a cada visita ao catálogo. Nunca apaga nada.
 */
function healCatalogImages(array $products): void
{
    $dir = __DIR__ . '/../assets/images/products/';
    $missing = nte_img_missing_load();
    $now = time();

    $todo = [];
    foreach ($products as $p) {
        if (!is_array($p) || ($p['active'] ?? true) === false) {
            continue;
        }
        foreach (nte_img_product_files($p) as $file) {
            if (isset($todo[$file]) || nte_img_local_ok($dir . $file)) {
                continue;
            }
            if (isset($missing[$file]) && $now - (int)$missing[$file] < NTE_IMG_MISSING_TTL) {
                continue;
            }
            $todo[$file] = true;
            if (count($todo) >= 6) {
                break 2;
            }
        }
    }
    if (!$todo) {
        return;
    }

    // Marca antes de tentar: visitas simultâneas não repetem as mesmas idas à VPS
    foreach ($todo as $file => $_) {
        $missing[$file] = $now;
    }
    nte_img_missing_save($missing);

    $healed = false;
    foreach ($todo as $file => $_) {
        if (nte_img_ensure_local($dir, $file, 2)) {
            unset($missing[$file]);
            $healed = true;
        }
    }
    if ($healed) {
        nte_img_missing_save($missing);
    }
}

/**
 * Responde o catálogo e só então cura as fotos: o visitante não espera a ida à VPS. Sem
 * fastcgi_finish_request/litespeed_finish_request não há como liberar a conexão antes, então a cura (já
 * limitada pelo cache de falhas) roda antes da resposta. HEAD não cura.
 */
function respondThenHeal(array $products, int $version): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') {
        respond(200);
    }

    $finish = function_exists('fastcgi_finish_request') ? 'fastcgi_finish_request'
        : (function_exists('litespeed_finish_request') ? 'litespeed_finish_request' : null);
    if ($finish === null) {
        respond(200, null, ['products' => $products, 'version' => $version]);
    }

    $body = json_encode(['products' => $products, 'version' => $version], JSON_UNESCAPED_UNICODE);
    if ($body === false) {
        respond(500, 'Falha ao serializar o catálogo.');
    }
    ignore_user_abort(true);
    http_response_code(200);
    echo $body;
    $finish();
    drainVpsQueue(3);
    healCatalogImages($products);
    exit;
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

    // Campos derivados do estoque só são recalculados quando o estoque veio na requisição.
    // Antes, uma atualização parcial sem "stock" (ex.: marcar Mais Vendidos) gravava
    // inStock/available = false e o produto aparecia esgotado mesmo tendo estoque.
    $hasStock = !$partial || array_key_exists('stock', $input);
    if ($hasStock) {
        $stkInput = (int)($record['stock'] ?? 0);
        $singleVal = ($stkInput === 1);
        $record['singlePiece'] = $singleVal;
        $record['pecaUnica'] = $singleVal;
        $record['peca_unica'] = $singleVal;
        $record['single_piece'] = $singleVal;
    }

    // Acesso Antecipado / Exclusividade VIP
    if (array_key_exists('isVipExclusive', $input) || array_key_exists('vipExclusive', $input) || array_key_exists('vipOnly', $input)) {
        $isVip = $bool($input['isVipExclusive'] ?? $input['vipExclusive'] ?? $input['vipOnly'] ?? false);
        $record['isVipExclusive'] = $isVip;
        $record['vipExclusive'] = $isVip;

        $duration = (string)($input['vipReleaseDuration'] ?? '48');
        $record['vipReleaseDuration'] = $duration;

        if ($isVip) {
            if (!empty($input['vipEarlyAccessUntil'])) {
                $record['vipEarlyAccessUntil'] = (string)$input['vipEarlyAccessUntil'];
            } elseif ($duration === 'forever') {
                $record['vipEarlyAccessUntil'] = null; // Sempre exclusivo
            } else {
                $hours = is_numeric($duration) ? (int)$duration : 48;
                $record['vipEarlyAccessUntil'] = date('c', time() + ($hours * 3600));
            }
        } else {
            $record['vipEarlyAccessUntil'] = null;
        }
    }

    // Desconto exclusivo para membros VIP (% inteiro, 0 a 90). Aplicado no servidor de
    // pagamento só para quem tem token VIP válido (ver lib/vip_auth.php).
    if (array_key_exists('vipDiscountPercent', $input)) {
        $record['vipDiscountPercent'] = max(0, min(90, (int)round((float)$input['vipDiscountPercent'])));
    }

    // Produtos NUNCA são inativados: sempre ativos, apenas esgotados via estoque
    $record['active'] = true;
    if ($hasStock) {
        $stkVal = (int)($record['stock'] ?? 0);
        $record['inStock'] = $stkVal > 0;
        $record['available'] = $stkVal > 0;
    }

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
    if ($status !== 200) return true;
    $rows = json_decode($body, true);
    if (!is_array($rows) || count($rows) === 0) return true;
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
