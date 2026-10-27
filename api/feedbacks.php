<?php
/**
 * NT Eleganz — API de Feedbacks & Depoimentos
 * Sincronização Dupla: PostgreSQL na VPS (Fonte de Verdade Primária) + Cache JSON Local na Hostinger
 * Auto-cura de imagens com failover imediato para VPS.
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

require_once __DIR__ . '/lib/image_store.php';
require_once __DIR__ . '/lib/live_data.php';

// Semente versionada. O que o gestor cadastra é gravado em feedbacks.live.json (fora do git).
const FEEDBACKS_FILE = __DIR__ . '/../data/feedbacks.json';
const FEEDBACKS_IMG_DIR = __DIR__ . '/../assets/images/feedbacks/';
const PRODUCTS_IMG_DIR = __DIR__ . '/../assets/images/products/';

const VPS_API_BASE = 'https://137-131-233-254.sslip.io/nteleganz/api';
const VPS_UPLOAD_URL = 'https://137-131-233-254.sslip.io/nteleganz/api/upload';
const VPS_UPLOADS_URL = 'https://137-131-233-254.sslip.io/nteleganz/uploads/';
const NTE_INTERNAL_SECRET = 'nte_sec_2026_isolated_vault';

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

/**
 * Chamada à API da VPS (PostgreSQL) com timeout curto para resiliência máxima
 */
function callVpsFeedbackApi(string $method, string $path, ?array $body = null): ?array {
    $url = VPS_API_BASE . $path;
    $ch = curl_init($url);
    if (!$ch) return null;

    $headers = [
        'Accept: application/json',
        'X-NTE-Secret: ' . NTE_INTERNAL_SECRET
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }

    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 6,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
    ]);

    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($resp === false || $code < 200 || $code >= 400) {
        return null;
    }

    $decoded = json_decode($resp, true);
    return is_array($decoded) ? $decoded : null;
}

/**
 * Auto-cura de imagens ausentes na Hostinger:
 * Se um feedback apontar para uma foto que não existe (ou está corrompida) no disco da Hostinger,
 * copia uma cópia íntegra da VPS. Só copia, nunca apaga. Fotos que já estão no disco (inclusive as
 * fotos-padrão em /assets/images/) nem chegam a gerar requisição à VPS.
 */
function autoCureFeedbackImages(array $feedbacks): void {
    $attempts = 0;
    foreach ($feedbacks as $fb) {
        if ($attempts >= 4) break;
        $img = $fb['image'] ?? '';
        if (!$img || strpos($img, 'data:') === 0) continue;

        $path = (string)parse_url((string)$img, PHP_URL_PATH);
        $filename = nte_img_safe_name($path);
        if ($filename === null) continue;

        // Arquivo exatamente como a loja o referencia
        if (nte_img_local_ok(__DIR__ . '/..' . $path)) continue;

        $attempts++;
        $bytes = nte_img_fetch_from_vps($filename, 4);
        if ($bytes !== null) {
            nte_write_atomic(FEEDBACKS_IMG_DIR . $filename, $bytes);
            nte_write_atomic(PRODUCTS_IMG_DIR . $filename, $bytes);
        }
    }
}

/** Lista salva localmente (arquivo vivo; na 1ª leitura, a semente). Vazia se nada foi gravado ainda. */
function readLocalFeedbacks(): array {
    $data = nte_live_read(FEEDBACKS_FILE);
    return is_array($data) ? array_values(array_filter($data, 'is_array')) : [];
}

/**
 * Junta a lista da VPS com a local: o que existir só no cache local (ex.: cadastrado enquanto a VPS
 * estava fora do ar) é preservado. Um feedback só deixa de existir quando o gestor o exclui pelo painel.
 */
function mergeLocalOnlyFeedbacks(array $vpsList, array $localList): array {
    $known = [];
    foreach ($vpsList as $fb) {
        if (is_array($fb) && isset($fb['id'])) $known[(string)$fb['id']] = true;
    }
    foreach ($localList as $fb) {
        if (!isset($fb['id']) || isset($known[(string)$fb['id']])) continue;
        $vpsList[] = $fb;
    }
    return $vpsList;
}

function normalizeFeedbackList(array $list): array {
    foreach ($list as &$item) {
        if (isset($item['image'])) {
            $item['image'] = normalizeFeedbackImg((string)$item['image']);
        }
        $item['order'] = isset($item['order']) ? (int)$item['order'] : 999;
        $item['active'] = !isset($item['active']) || (bool)$item['active'];
    }
    unset($item);
    usort($list, fn($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    return $list;
}

function readFeedbacks(bool $includeInactive = true): array {
    // 1. Tenta obter da VPS (PostgreSQL) primeiro. Pede SEMPRE a lista completa e filtra aqui: ao mesclar
    //    com o cache local, "inativo" nunca pode ser confundido com "não existe".
    $vps = callVpsFeedbackApi('GET', '/feedbacks?all=1');
    if ($vps !== null && isset($vps['feedbacks']) && is_array($vps['feedbacks']) && !empty($vps['feedbacks'])) {
        // O cache local nunca é simplesmente substituído: o que existir só nele é preservado
        $list = normalizeFeedbackList(mergeLocalOnlyFeedbacks($vps['feedbacks'], readLocalFeedbacks()));

        // Atualiza o cache local silenciosamente
        saveLocalFeedbacksFile($list);
        // Auto-cura de imagens ausentes
        autoCureFeedbackImages($list);

        if (!$includeInactive) {
            $list = array_values(array_filter($list, fn($f) => !empty($f['active'])));
        }
        return $list;
    }

    // 2. Fallback de Segurança: se a VPS estiver offline, lê do arquivo local
    $list = readLocalFeedbacks();
    if (empty($list)) {
        $list = defaultFeedbacks();
        if (!nte_live_exists(FEEDBACKS_FILE)) {
            saveLocalFeedbacksFile($list);
        }
    }
    $list = normalizeFeedbackList($list);

    if (!$includeInactive) {
        $list = array_values(array_filter($list, fn($f) => !empty($f['active'])));
    }
    return $list;
}

function saveLocalFeedbacksFile(array $feedbacks): bool {
    usort($feedbacks, fn($a, $b) => ($a['order'] ?? 0) <=> ($b['order'] ?? 0));
    $orderIndex = 1;
    foreach ($feedbacks as &$fb) {
        $fb['order'] = $orderIndex++;
    }
    unset($fb);

    return nte_live_write(
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

    if (!is_dir(FEEDBACKS_IMG_DIR)) @mkdir(FEEDBACKS_IMG_DIR, 0755, true);
    if (!is_dir(PRODUCTS_IMG_DIR)) @mkdir(PRODUCTS_IMG_DIR, 0755, true);

    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $id) ?: 'fb';
    $filename = sprintf('feedback-%s-%d.webp', $cleanId, time());
    $destPath = FEEDBACKS_IMG_DIR . $filename;
    $altDestPath = PRODUCTS_IMG_DIR . $filename;
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
                @imagewebp($im, $altDestPath, 82);
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

    if (@file_put_contents($destPath, $binary)) {
        @file_put_contents($altDestPath, $binary);
        mirrorToVps($destPath, $filename);
        return $publicPath;
    }

    return null;
}

function mirrorToVps(string $filepath, string $filename): void {
    try {
        // Cópia conferida na VPS; se falhar, o sync-images.php completa depois (a foto segue salva aqui)
        nte_img_push_to_vps($filepath, $filename);
    } catch (\Throwable $t) {
        // Falha silenciosa de redundância
    }
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $all = isset($_GET['all']) && $_GET['all'] === '1';
    $feedbacks = readFeedbacks($all);
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

    // 1. Excluir Feedback
    if ($action === 'delete') {
        $targetId = trim((string)($input['id'] ?? ''));
        if ($targetId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'ID do feedback é obrigatório para exclusão.']);
            exit;
        }

        // Tenta remover na VPS (PostgreSQL)
        callVpsFeedbackApi('POST', '/feedbacks', ['action' => 'delete', 'id' => $targetId]);

        // Remove do cache local
        $feedbacks = readFeedbacks(true);
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
        saveLocalFeedbacksFile($filtered);
        echo json_encode(['success' => true, 'feedbacks' => readFeedbacks(true)]);
        exit;
    }

    // 2. Mover Posição (up / down / left / right)
    if ($action === 'move') {
        $targetId = trim((string)($input['id'] ?? ''));
        $direction = (int)($input['direction'] ?? 0);

        if ($targetId === '' || $direction === 0) {
            http_response_code(400);
            echo json_encode(['error' => 'ID e direção (-1 ou 1) são obrigatórios.']);
            exit;
        }

        $feedbacks = readFeedbacks(true);
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
            $temp = $feedbacks[$currentIndex];
            $feedbacks[$currentIndex] = $feedbacks[$newIndex];
            $feedbacks[$newIndex] = $temp;

            $orderedIds = [];
            foreach ($feedbacks as $idx => &$fb) {
                $fb['order'] = $idx + 1;
                $orderedIds[] = $fb['id'];
            }
            unset($fb);

            // Persiste na VPS (PostgreSQL)
            callVpsFeedbackApi('POST', '/feedbacks', [
                'action' => 'reorder',
                'order' => $orderedIds
            ]);

            saveLocalFeedbacksFile($feedbacks);
            echo json_encode(['success' => true, 'feedbacks' => readFeedbacks(true)]);
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

        // Persiste na VPS (PostgreSQL)
        callVpsFeedbackApi('POST', '/feedbacks', [
            'action' => 'reorder',
            'order' => $orderedIds
        ]);

        $feedbacks = readFeedbacks(true);
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
        foreach ($byId as $remaining) {
            $remaining['order'] = $orderCounter++;
            $newOrderList[] = $remaining;
        }

        saveLocalFeedbacksFile($newOrderList);
        echo json_encode(['success' => true, 'feedbacks' => readFeedbacks(true)]);
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

        $feedbacks = readFeedbacks(true);

        if ($id === '') {
            $id = 'fb-' . time() . '-' . substr(md5(uniqid('', true)), 0, 5);
        }

        if ($title === '') {
            $title = 'Feedback ' . (count($feedbacks) + 1);
        }

        $finalImg = null;
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

        // Tenta salvar na VPS (PostgreSQL) primeiro
        $vpsRes = callVpsFeedbackApi('POST', '/feedbacks', [
            'action' => 'save',
            'feedback' => [
                'id' => $id,
                'title' => $title,
                'image' => $finalImg ?: '/assets/images/feedback-1.webp',
                'order' => $order,
                'active' => $active
            ]
        ]);

        if ($vpsRes !== null && isset($vpsRes['feedbacks']) && is_array($vpsRes['feedbacks'])) {
            // O cache local não é substituído pela lista da VPS: o que existir só nele é preservado
            $synced = normalizeFeedbackList(mergeLocalOnlyFeedbacks($vpsRes['feedbacks'], readLocalFeedbacks()));
            saveLocalFeedbacksFile($synced);
            echo json_encode([
                'success' => true,
                'feedbacks' => $synced,
                'item' => [
                    'id' => $id,
                    'title' => $title,
                    'image' => $finalImg,
                    'active' => $active
                ]
            ]);
            exit;
        }

        // Fallback local se VPS não responder
        $existingIndex = -1;
        foreach ($feedbacks as $idx => $fb) {
            if ($fb['id'] === $id) {
                $existingIndex = $idx;
                break;
            }
        }

        if ($existingIndex >= 0) {
            $feedbacks[$existingIndex]['title'] = $title;
            $feedbacks[$existingIndex]['active'] = $active;
            if ($finalImg) {
                $feedbacks[$existingIndex]['image'] = $finalImg;
            }
            if ($order !== null && $order > 0) {
                $feedbacks[$existingIndex]['order'] = $order;
            }
        } else {
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
                array_splice($feedbacks, $order - 1, 0, [$newItem]);
            } else {
                $feedbacks[] = $newItem;
            }
        }

        if (saveLocalFeedbacksFile($feedbacks)) {
            echo json_encode([
                'success' => true,
                'feedbacks' => readFeedbacks(true),
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
