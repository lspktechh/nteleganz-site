<?php
/**
 * NT Eleganz — API de Categorias
 * Permite listar, adicionar, editar e excluir categorias de produtos no Painel Admin e Storefront.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/live_data.php';

// Semente versionada. O que o gestor cadastra é gravado em categories.live.json (fora do git).
const CATEGORIES_FILE = __DIR__ . '/../data/categories.json';
const CATEGORIES_IMG_DIR = __DIR__ . '/../assets/images/categories/';

function defaultCategories(): array {
    return [
        [
            'id' => 'camisetas',
            'name' => 'Camisetas',
            'image' => '/assets/images/category-camisetas.webp',
            'active' => true
        ],
        [
            'id' => 'shorts',
            'name' => 'Shorts',
            'image' => '/assets/images/category-shorts.webp',
            'active' => true
        ],
        [
            'id' => 'calcados',
            'name' => 'Calçados',
            'image' => '/assets/images/category-calcados.webp',
            'active' => true
        ],
        [
            'id' => 'hoodies',
            'name' => 'Hoodies',
            'image' => '/assets/images/category-hoodies.webp',
            'active' => true
        ]
    ];
}

function normalizeCategoryImg(string $img): string {
    $img = trim($img);
    if ($img === '') return '/assets/images/category-camisetas.webp';
    if (strpos($img, 'data:') === 0 || strpos($img, 'http://') === 0 || strpos($img, 'https://') === 0 || strpos($img, '/') === 0) {
        return $img;
    }
    return '/' . ltrim($img, './');
}

function readCategories(): array {
    $data = nte_live_read(CATEGORIES_FILE);
    if ($data === null) {
        $defs = defaultCategories();
        if (!nte_live_exists(CATEGORIES_FILE)) {
            saveCategories($defs);
        }
        return $defs;
    }
    $list = $data;
    foreach ($list as &$item) {
        if (isset($item['image'])) {
            $item['image'] = normalizeCategoryImg((string)$item['image']);
        }
    }
    unset($item);
    return $list;
}

function saveCategories(array $categories): bool {
    return nte_live_write(
        CATEGORIES_FILE,
        json_encode(array_values($categories), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
}

function slugify(string $text): string {
    $text = transliterator_transliterate('Any-Latin; Latin-ASCII; Lower()', $text) ?: strtolower($text);
    $text = preg_replace('/[^a-z0-9]+/i', '-', $text);
    $text = trim((string)$text, '-');
    return $text !== '' ? $text : 'categoria-' . time();
}

/**
 * Salva imagem base64 diretamente em assets/images/categories/
 */
function saveBase64Image(string $base64Data, string $slug): ?string {
    if (!preg_match('#^data:image/(webp|jpeg|png|jpg|gif);base64,#i', $base64Data, $m)) {
        return null;
    }

    $raw = preg_replace('#^data:image/\w+;base64,#i', '', $base64Data);
    $binary = base64_decode($raw, true);
    if ($binary === false || strlen($binary) === 0) {
        return null;
    }

    if (!is_dir(CATEGORIES_IMG_DIR)) {
        @mkdir(CATEGORIES_IMG_DIR, 0755, true);
    }

    $filename = sprintf('category-%s-%d.webp', $slug, time());
    $destPath = CATEGORIES_IMG_DIR . $filename;
    $publicPath = '/assets/images/categories/' . $filename;

    // Converte para WebP com GD se disponível
    if (function_exists('imagecreatefromstring')) {
        $im = @imagecreatefromstring($binary);
        if ($im !== false) {
            // Limita dimensão máxima a 1200px mantendo proporção
            $width = imagesx($im);
            $height = imagesy($im);
            $maxSide = 1200;
            if ($width > $maxSide || $height > $maxSide) {
                $scale = min(1.0, $maxSide / max($width, $height));
                $newW = max(1, (int)round($width * $scale));
                $newH = max(1, (int)round($height * $scale));
                $resized = imagecreatetruecolor($newW, $newH);
                imagealphablending($resized, false);
                imagesavealpha($resized, true);
                imagecopyresampled($resized, $im, 0, 0, 0, 0, $newW, $newH, $width, $height);
                imagedestroy($im);
                $im = $resized;
            }

            if (function_exists('imagewebp')) {
                $saved = @imagewebp($im, $destPath, 85);
                imagedestroy($im);
                if ($saved) return $publicPath;
            } else {
                $saved = @imagejpeg($im, str_replace('.webp', '.jpg', $destPath), 85);
                imagedestroy($im);
                if ($saved) return str_replace('.webp', '.jpg', $publicPath);
            }
        }
    }

    // Fallback: salva binário bruto se GD não estiver ativo
    $ext = strtolower($m[1] ?? 'webp');
    $rawFilename = sprintf('category-%s-%d.%s', $slug, time(), $ext);
    $rawPath = CATEGORIES_IMG_DIR . $rawFilename;
    if (@file_put_contents($rawPath, $binary)) {
        return '/assets/images/categories/' . $rawFilename;
    }

    return null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $all = isset($_GET['all']) && $_GET['all'] === '1';
    $categories = readCategories();
    if (!$all) {
        $categories = array_values(array_filter($categories, fn($c) => !empty($c['active'])));
    }
    echo json_encode([
        'success' => true,
        'categories' => $categories
    ]);
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Dados inválidos. Envie corpo JSON.']);
        exit;
    }

    $action = $input['action'] ?? 'save';
    $categories = readCategories();

    // 1. Exclusão de Categoria
    if ($action === 'delete') {
        $targetId = trim((string)($input['id'] ?? ''));
        if ($targetId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'ID da categoria é obrigatório para exclusão.']);
            exit;
        }

        $filtered = array_values(array_filter($categories, fn($c) => ($c['id'] ?? '') !== $targetId));
        if (saveCategories($filtered)) {
            echo json_encode(['success' => true, 'categories' => $filtered]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Erro ao salvar remoção da categoria.']);
        }
        exit;
    }

    // 2. Salvar em lote (reordenação ou lista inteira)
    if (isset($input['categories']) && is_array($input['categories'])) {
        $sanitizedList = [];
        foreach ($input['categories'] as $item) {
            if (!is_array($item)) continue;
            $name = trim((string)($item['name'] ?? ''));
            if ($name === '') continue;
            $id = trim((string)($item['id'] ?? '')) ?: slugify($name);
            $img = trim((string)($item['image'] ?? 'assets/images/category-camisetas.webp'));
            $sanitizedList[] = [
                'id' => $id,
                'name' => $name,
                'image' => $img,
                'active' => isset($item['active']) ? (bool)$item['active'] : true
            ];
        }

        if (saveCategories($sanitizedList)) {
            echo json_encode(['success' => true, 'categories' => $sanitizedList]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Erro ao salvar categorias.']);
        }
        exit;
    }

    // 3. Adicionar ou Editar uma Categoria Individual
    $name = trim((string)($input['name'] ?? ''));
    if ($name === '') {
        http_response_code(400);
        echo json_encode(['error' => 'O nome da categoria é obrigatório.']);
        exit;
    }

    $id = trim((string)($input['id'] ?? ''));
    $isNew = ($id === '');
    $slug = $isNew ? slugify($name) : $id;

    // Se for nova, garante unicidade do slug
    if ($isNew) {
        $existingIds = array_map(fn($c) => $c['id'] ?? '', $categories);
        $candidateSlug = $slug;
        $counter = 1;
        while (in_array($candidateSlug, $existingIds, true)) {
            $candidateSlug = $slug . '-' . $counter;
            $counter++;
        }
        $slug = $candidateSlug;
        $id = $slug;
    }

    // Processa a imagem (se for base64, salva no disco; se já for URL/caminho, mantém)
    $rawImage = trim((string)($input['image'] ?? ''));
    $finalImagePath = $rawImage;

    if (strpos($rawImage, 'data:image/') === 0) {
        $savedPath = saveBase64Image($rawImage, $slug);
        if ($savedPath) {
            $finalImagePath = $savedPath;
        }
    }

    if ($finalImagePath === '') {
        // Imagem padrão se nenhuma foi enviada
        $finalImagePath = 'assets/images/category-camisetas.webp';
    }

    $active = isset($input['active']) ? (bool)$input['active'] : true;

    $categoryData = [
        'id' => $id,
        'name' => $name,
        'image' => $finalImagePath,
        'active' => $active
    ];

    $foundIndex = -1;
    foreach ($categories as $idx => $cat) {
        if (($cat['id'] ?? '') === $id) {
            $foundIndex = $idx;
            break;
        }
    }

    if ($foundIndex >= 0) {
        $categories[$foundIndex] = array_merge($categories[$foundIndex], $categoryData);
    } else {
        $categories[] = $categoryData;
    }

    if (saveCategories($categories)) {
        echo json_encode([
            'success' => true,
            'category' => $categoryData,
            'categories' => $categories
        ]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Não foi possível salvar a categoria.']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método não permitido']);
