<?php
// NT ELEGANZ — Clean Image Proxy
// Permite acessar a foto da peça por slug limpo: /foto/camiseta-polo-bear-rl-grey-g.jpg ou /foto/?p=...
require_once __DIR__ . '/../api/lib/image_store.php';

$productQuery = isset($_GET['p']) ? trim((string)$_GET['p']) : (isset($_GET['slug']) ? trim((string)$_GET['slug']) : (isset($_GET['id']) ? trim((string)$_GET['id']) : ''));

if ($productQuery === '') {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if (preg_match('#/foto/([^/?]+)#', $uriPath, $m)) {
        $productQuery = trim($m[1]);
    }
}

if ($productQuery === '') {
    http_response_code(404);
    exit('Imagem não encontrada');
}

$dataPath = __DIR__ . '/../data/products.json';
if (!file_exists($dataPath)) {
    http_response_code(404);
    exit('Catálogo não encontrado');
}

$json = @file_get_contents($dataPath);
$data = @json_decode($json, true);
$products = (is_array($data) && isset($data['products']) && is_array($data['products'])) ? $data['products'] : [];

function slugify(string $text): string {
    $text = preg_replace('~[^\pL\d]+~u', '-', $text);
    $text = iconv('utf-8', 'us-ascii//TRANSLIT', $text);
    $text = preg_replace('~[^-\w]+~', '', $text);
    $text = trim($text, '-');
    $text = preg_replace('~-+~', '-', $text);
    return strtolower($text);
}

function getProductCleanSlug(array $p, array $all): string {
    $base = !empty($p['slug']) ? slugify((string)$p['slug']) : slugify((string)($p['name'] ?? ''));
    if (empty($all) || count($all) <= 1) return $base;

    $duplicates = 0;
    foreach ($all as $item) {
        $itemBase = !empty($item['slug']) ? slugify((string)$item['slug']) : slugify((string)($item['name'] ?? ''));
        if ($itemBase === $base) $duplicates++;
    }
    if ($duplicates <= 1) return $base;

    $color = (!empty($p['colors']) && is_array($p['colors']) && !empty($p['colors'][0])) ? slugify((string)$p['colors'][0]) : '';
    $size = (!empty($p['sizes']) && is_array($p['sizes']) && !empty($p['sizes'][0])) ? slugify((string)$p['sizes'][0]) : '';

    $candidate = $base;
    if ($color !== '' && $size !== '') $candidate = "{$base}-{$color}-{$size}";
    elseif ($color !== '') $candidate = "{$base}-{$color}";
    elseif ($size !== '') $candidate = "{$base}-{$size}";

    $sameCandidate = 0;
    foreach ($all as $item) {
        $itemBase = !empty($item['slug']) ? slugify((string)$item['slug']) : slugify((string)($item['name'] ?? ''));
        $iColor = (!empty($item['colors']) && is_array($item['colors']) && !empty($item['colors'][0])) ? slugify((string)$item['colors'][0]) : '';
        $iSize = (!empty($item['sizes']) && is_array($item['sizes']) && !empty($item['sizes'][0])) ? slugify((string)$item['sizes'][0]) : '';
        $c = $itemBase;
        if ($iColor !== '' && $iSize !== '') $c = "{$itemBase}-{$iColor}-{$iSize}";
        elseif ($iColor !== '') $c = "{$itemBase}-{$iColor}";
        elseif ($iSize !== '') $c = "{$itemBase}-{$iSize}";
        if ($c === $candidate) $sameCandidate++;
    }

    if ($sameCandidate <= 1) return $candidate;

    $suffix = substr((string)($p['id'] ?? ''), -3);
    return $suffix !== '' ? "{$candidate}-{$suffix}" : $candidate;
}

$requestedExt = strtolower(pathinfo($productQuery, PATHINFO_EXTENSION));
$cleanSlug = preg_replace('/\.(jpe?g|png|webp|avif)$/i', '', $productQuery);

$candidates = array_unique(array_filter([
    strtolower($productQuery),
    strtolower($cleanSlug),
    urldecode(strtolower($productQuery)),
    urldecode(strtolower($cleanSlug)),
]));

$product = null;
foreach ($products as $p) {
    $pId = strtolower((string)($p['id'] ?? ''));
    if (in_array($pId, $candidates, true)) {
        $product = $p;
        break;
    }
}
if (!$product) {
    foreach ($products as $p) {
        $pClean = getProductCleanSlug($p, $products);
        if (in_array($pClean, $candidates, true)) {
            $product = $p;
            break;
        }
    }
}
if (!$product) {
    foreach ($products as $p) {
        $pSlug = isset($p['slug']) ? strtolower((string)$p['slug']) : '';
        if ($pSlug !== '' && in_array($pSlug, $candidates, true)) {
            $product = $p;
            break;
        }
    }
}

if (!$product) {
    http_response_code(404);
    exit('Produto não encontrado');
}

$img = $product['image'] ?? ($product['images'][0] ?? '');
if (empty($img)) {
    http_response_code(404);
    exit('Imagem não encontrada');
}

$parsed = parse_url($img, PHP_URL_PATH);
$relPath = ltrim((string)$parsed, '/');
$filePath = __DIR__ . '/../' . $relPath;

$rawImageBytes = null;
if (nte_img_local_ok($filePath)) {
    $rawImageBytes = @file_get_contents($filePath);
} else {
    // Falta (ou está corrompida) no disco: busca na VPS, confere que é uma imagem de verdade e salva
    // em cache local de forma atômica
    $vpsName = nte_img_safe_name(basename($img));
    $rawImageBytes = $vpsName !== null ? nte_img_fetch_from_vps($vpsName) : null;
    if ($rawImageBytes !== null) {
        nte_write_atomic($filePath, $rawImageBytes);
    }
}

if (!$rawImageBytes) {
    if (strpos($img, 'http://') === 0 || strpos($img, 'https://') === 0) {
        header('Location: ' . $img, true, 302);
    } else {
        header('Location: https://137-131-233-254.sslip.io/nteleganz/uploads/' . basename($img), true, 302);
    }
    exit;
}

$fileExt = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
$isSocialCrawler = (stripos($ua, 'WhatsApp') !== false || stripos($ua, 'facebookexternalhit') !== false || stripos($ua, 'Twitterbot') !== false);
$isJpegRequested = in_array($requestedExt, ['jpg', 'jpeg'], true) || $isSocialCrawler;

// Se solicitado JPEG ou detectado crawler do WhatsApp/redes sociais,
// converte on-the-fly para JPEG para gerar preview e compatibilidade total
if ($isJpegRequested && function_exists('imagecreatefromstring') && function_exists('imagejpeg')) {
    $im = @imagecreatefromstring($rawImageBytes);
    if ($im) {
        header('Content-Type: image/jpeg');
        header('Cache-Control: public, max-age=31536000, immutable');
        imagejpeg($im, null, 90);
        imagedestroy($im);
        exit;
    }
}

$mimeMap = [
    'webp' => 'image/webp',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
    'avif' => 'image/avif',
];
$mime = $mimeMap[$fileExt] ?? 'image/webp';

header('Content-Type: ' . $mime);
header('Cache-Control: public, max-age=31536000, immutable');
header('Content-Length: ' . strlen($rawImageBytes));
echo $rawImageBytes;
exit;
