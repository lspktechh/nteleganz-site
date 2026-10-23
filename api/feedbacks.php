<?php
/**
 * NT Eleganz — API de Feedbacks & Depoimentos
 * Permite listar, adicionar, editar, reordenar e excluir depoimentos de clientes.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Cache-Control: no-cache, no-store, must-revalidate');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

const FEEDBACKS_FILE = __DIR__ . '/../data/feedbacks.json';
const FEEDBACKS_IMG_DIR = __DIR__ . '/../assets/images/feedbacks/';

function defaultFeedbacks(): array {
    $list = [];
    for ($i = 1; $i <= 13; $i++) {
        $list[] = [
            'id' => 'fb-' . $i,
            'title' => 'Feedback ' . $i,
            'image' => '/assets/images/feedback-' . $i . '.webp',
            'order' => $i,
            'active' => true
        ];
    }
    return $list;
}

function normalizeFeedbackImg(string $img): string {
    $img = trim($img);
    if ($img === '') return '/assets/images/feedback-1.webp';
    if (strpos($img, 'data:') === 0 || strpos($img, 'http://') === 0 || strpos($img, 'https://') === 0 || strpos($img, '/') === 0) {
        return $img;
    }
    return '/' . ltrim($img, './');
}

function readFeedbacks(): array {
    if (!file_exists(FEEDBACKS_FILE)) {
        $defs = defaultFeedbacks();
        saveFeedbacks($defs);
        return $defs;
    }
    $raw = @file_get_contents(FEEDBACKS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    $list = is_array($data) && !empty($data) ? $data : defaultFeedbacks();
    
    foreach ($list as &$item) {
        if (isset($item['image'])) {
            $item['image'] = normalizeFeedbackImg((string)$item['image']);
        }
        $item['order'] = isset($item['order']) ? (int)$item['order'] : 999;
        $item['active'] = !isset($item['active']) || (bool)$item['active'];
    }
    unset($item);

    // Ordena por ordem crescente
    usort($list, fn($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    return $list;
}

function saveFeedbacks(array $feedbacks): bool {
    $dir = dirname(FEEDBACKS_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);

    // Re-indexa ordens de 1 a N
    usort($feedbacks, fn($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    $orderIndex = 1;
    foreach ($feedbacks as &$fb) {
        $fb['order'] = $orderIndex++;
    }
    unset($fb);

    return (bool)@file_put_contents(
        FEEDBACKS_FILE,
        json_encode(array_values($feedbacks), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
}

/**
 * Salva e otimiza imagem base64 diretamente para WebP
 * Redimensiona para max width 720px / max height 1440px mantendo proporção
 * e comprime com qualidade 82% para não pesar no carregamento.
 */
function saveOptimizedFeedbackImage(string $base64Data, string $id): ?string {
    if (!preg_match('#^data:image/(webp|jpeg|png|jpg|gif);base64,#i', $base64Data, $m)) {
        return null;
    }

    $raw = preg_replace('#^data:image/\w+;base64,#i', '', $base64Data);
    $binary = base64_decode($raw, true);
    if ($binary === false || strlen($binary) === 0) {
        return null;
    }

    if (!is_dir(FEEDBACKS_IMG_DIR)) {
        @mkdir(FEEDBACKS_IMG_DIR, 0755, true);
    }

    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $id) ?: 'fb';
    $filename = sprintf('feedback-%s-%d.webp', $cleanId, time());
    $destPath = FEEDBACKS_IMG_DIR . $filename;
    $publicPath = '/assets/images/feedbacks/' . $filename;

    if (function_exists('imagecreatefromstring')) {
        $im = @imagecreatefromstring($binary);
        if ($im !== false) {
            $width = imagesx($im);
            $height = imagesy($im);
            $maxWidth = 720;
            $maxHeight = 1440;

            if ($width > $maxWidth || $height > $maxHeight) {
                $scale = min($maxWidth / $width, $maxHeight / $height);
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
                $saved = @imagewebp($im, $destPath, 82);
                imagedestroy($im);
                if ($saved) {
                    mirrorToVps($destPath, $filename);
                    return $publicPath;
                }
            } else {
                $jpgDest = str_replace('.webp', '.jpg', $destPath);
                $saved = @imagejpeg($im, $jpgDest, 82);
                imagedestroy($im);
                if ($saved) {
                    $jpgPublic = str_replace('.webp', '.jpg', $publicPath);
                    mirrorToVps($jpgDest, basename($jpgDest));
                    return $jpgPublic;
                }
            }
        }
    }

    // Fallback: grava binário direto caso GD não esteja ativo
    if (@file_put_contents($destPath, $binary)) {
        mirrorToVps($destPath, $filename);
        return $publicPath;
    }

    return null;
}

function mirrorToVps(string $filepath, string $filename): void {
    try {
        $vpsUploadUrl = 'https://137-131-233-254.sslip.io/nteleganz/api/upload';
        $ch = curl_init($vpsUploadUrl);
        $cfile = curl_file_create($filepath, 'image/webp', $filename);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => ['image' => $cfile],
            CURLOPT_HTTPHEADER => ['x-filename: ' . $filename],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => 0
        ]);
        @curl_exec($ch);
        @curl_close($ch);
    } catch (\Throwable $t) {
        // Falha silenciosa de redundância
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $all = isset($_GET['all']) && $_GET['all'] === '1';
    $feedbacks = readFeedbacks();
    if (!$all) {
        $feedbacks = array_values(array_filter($feedbacks, fn($f) => !empty($f['active'])));
    }
    echo json_encode([
        'success' => true,
        'feedbacks' => $feedbacks
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
    $feedbacks = readFeedbacks();

    // 1. Excluir Feedback
    if ($action === 'delete') {
        $targetId = trim((string)($input['id'] ?? ''));
        if ($targetId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'ID do feedback é obrigatório para exclusão.']);
            exit;
        }

        // Se imagem foi salva na pasta feedbacks/, tenta remover o arquivo
        foreach ($feedbacks as $fb) {
            if ($fb['id'] === $targetId && !empty($fb['image'])) {
                if (strpos($fb['image'], '/assets/images/feedbacks/') !== false) {
                    $localFile = __DIR__ . '/..' . $fb['image'];
                    if (file_exists($localFile)) @unlink($localFile);
                }
                break;
            }
        }

        $filtered = array_values(array_filter($feedbacks, fn($f) => ($f['id'] ?? '') !== $targetId));
        if (saveFeedbacks($filtered)) {
            echo json_encode(['success' => true, 'feedbacks' => readFeedbacks()]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Erro ao salvar exclusão do feedback.']);
        }
        exit;
    }

    // 2. Mover Posição (up / down / left / right)
    if ($action === 'move') {
        $targetId = trim((string)($input['id'] ?? ''));
        $direction = (int)($input['direction'] ?? 0); // -1 (para cima/esquerda) ou +1 (para baixo/direita)

        if ($targetId === '' || $direction === 0) {
            http_response_code(400);
            echo json_encode(['error' => 'ID e direção (-1 ou 1) são obrigatórios.']);
            exit;
        }

        $currentIndex = -1;
        foreach ($feedbacks as $idx => $fb) {
            if ($fb['id'] === $targetId) {
                $currentIndex = $idx;
                break;
            }
        }

        if ($currentIndex === -1) {
            http_response_code(404);
            echo json_encode(['error' => 'Feedback não encontrado.']);
            exit;
        }

        $newIndex = $currentIndex + $direction;
        if ($newIndex >= 0 && $newIndex < count($feedbacks)) {
            // Troca de posição
            $temp = $feedbacks[$currentIndex];
            $feedbacks[$currentIndex] = $feedbacks[$newIndex];
            $feedbacks[$newIndex] = $temp;

            // Re-indexa ordem
            foreach ($feedbacks as $idx => &$fb) {
                $fb['order'] = $idx + 1;
            }
            unset($fb);

            if (saveFeedbacks($feedbacks)) {
                echo json_encode(['success' => true, 'feedbacks' => readFeedbacks()]);
            } else {
                http_response_code(500);
                echo json_encode(['error' => 'Erro ao salvar nova posição.']);
            }
        } else {
            echo json_encode(['success' => true, 'feedbacks' => $feedbacks]);
        }
        exit;
    }

    // 3. Reordenar Lote (Array de IDs)
    if ($action === 'reorder') {
        $orderedIds = $input['order'] ?? $input['ids'] ?? null;
        if (!is_array($orderedIds)) {
            http_response_code(400);
            echo json_encode(['error' => 'Lista de IDs ordenados obrigatória.']);
            exit;
        }

        $byId = [];
        foreach ($feedbacks as $fb) {
            $byId[$fb['id']] = $fb;
        }

        $newOrderList = [];
        $orderCounter = 1;
        foreach ($orderedIds as $id) {
            if (isset($byId[$id])) {
                $item = $byId[$id];
                $item['order'] = $orderCounter++;
                $newOrderList[] = $item;
                unset($byId[$id]);
            }
        }
        // Sobras que não foram enviadas na lista
        foreach ($byId as $remaining) {
            $remaining['order'] = $orderCounter++;
            $newOrderList[] = $remaining;
        }

        if (saveFeedbacks($newOrderList)) {
            echo json_encode(['success' => true, 'feedbacks' => readFeedbacks()]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Erro ao salvar reordenação.']);
        }
        exit;
    }

    // 4. Salvar / Criar / Editar Feedback Individual
    if ($action === 'save') {
        $feedbackData = $input['feedback'] ?? $input;
        $id = trim((string)($feedbackData['id'] ?? ''));
        $title = trim((string)($feedbackData['title'] ?? ''));
        $active = isset($feedbackData['active']) ? (bool)$feedbackData['active'] : true;
        $order = isset($feedbackData['order']) ? (int)$feedbackData['order'] : null;
        $imgRaw = trim((string)($feedbackData['image'] ?? ''));

        if ($id === '') {
            $id = 'fb-' . time() . '-' . substr(md5(uniqid('', true)), 0, 5);
        }

        if ($title === '') {
            $title = 'Feedback ' . (count($feedbacks) + 1);
        }

        $finalImg = null;
        // Se imagem for base64, otimiza e salva em WebP
        if (strpos($imgRaw, 'data:image/') === 0) {
            $finalImg = saveOptimizedFeedbackImage($imgRaw, $id);
            if (!$finalImg) {
                http_response_code(500);
                echo json_encode(['error' => 'Falha ao processar e otimizar imagem do feedback.']);
                exit;
            }
        } elseif ($imgRaw !== '') {
            $finalImg = normalizeFeedbackImg($imgRaw);
        }

        // Verifica se já existe
        $existingIndex = -1;
        foreach ($feedbacks as $idx => $fb) {
            if ($fb['id'] === $id) {
                $existingIndex = $idx;
                break;
            }
        }

        if ($existingIndex >= 0) {
            // Edição
            $feedbacks[$existingIndex]['title'] = $title;
            $feedbacks[$existingIndex]['active'] = $active;
            if ($finalImg) {
                $feedbacks[$existingIndex]['image'] = $finalImg;
            }
            if ($order !== null && $order > 0) {
                $feedbacks[$existingIndex]['order'] = $order;
            }
        } else {
            // Novo
            if (!$finalImg) {
                http_response_code(400);
                echo json_encode(['error' => 'Uma foto de feedback é obrigatória.']);
                exit;
            }

            $newItem = [
                'id' => $id,
                'title' => $title,
                'image' => $finalImg,
                'order' => ($order !== null && $order > 0) ? $order : (count($feedbacks) + 1),
                'active' => $active,
                'createdAt' => date('c')
            ];

            if ($order !== null && $order > 0 && $order <= count($feedbacks)) {
                // Insere na posição desejada
                array_splice($feedbacks, $order - 1, 0, [$newItem]);
            } else {
                $feedbacks[] = $newItem;
            }
        }

        if (saveFeedbacks($feedbacks)) {
            echo json_encode([
                'success' => true,
                'feedbacks' => readFeedbacks(),
                'item' => [
                    'id' => $id,
                    'title' => $title,
                    'image' => $finalImg,
                    'active' => $active
                ]
            ]);
        } else {
            http_response_code(500);
            echo json_encode(['error' => 'Erro ao salvar feedback no disco.']);
        }
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Ação desconhecida.']);
    exit;
}
