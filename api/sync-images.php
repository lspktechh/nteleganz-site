<?php
/**
 * NT Eleganz - Sincronizador de Imagens (nos dois sentidos, sem apagar nada)
 *
 *  - VPS -> Hostinger: baixa as fotos que faltarem (ou estiverem corrompidas) no disco da Hostinger.
 *  - Hostinger -> VPS: envia para a VPS as fotos que ela não tiver, garantindo sempre duas cópias.
 *
 * Pode ser aberto no navegador ou agendado (cron da Hostinger, ex.: a cada 15 minutos).
 * Esta rotina só copia: remover uma foto é decisão exclusiva do gestor, pelo painel.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

require_once __DIR__ . '/lib/image_store.php';

const VPS_API_PRODUCTS = 'https://137-131-233-254.sslip.io/nteleganz/api/products';
const LOCAL_IMG_DIR = __DIR__ . '/../assets/images/products/';
const LOCAL_PRODUCTS_FILE = __DIR__ . '/../data/products.json';
const SYNC_STAMP_FILE = __DIR__ . '/../data/.sync_images_stamp';
const SYNC_MIN_INTERVAL = 30;  // segundos entre execuções (endpoint público: evita abuso)
const SYNC_TIME_BUDGET = 40;   // segundos de trabalho por execução; o resto fica para a próxima

ignore_user_abort(true);
@set_time_limit(SYNC_TIME_BUDGET + 20);

if (is_file(SYNC_STAMP_FILE)) {
    $age = time() - (int)@filemtime(SYNC_STAMP_FILE);
    if ($age >= 0 && $age < SYNC_MIN_INTERVAL) {
        echo json_encode(['ok' => true, 'throttled' => true, 'retry_in_seconds' => SYNC_MIN_INTERVAL - $age]);
        exit;
    }
}
@touch(SYNC_STAMP_FILE);

// 1. Produtos: união do catálogo da VPS com o cache local (nenhuma foto referenciada fica de fora)
$products = [];
[$code, $raw] = nte_img_http(VPS_API_PRODUCTS, 3, 6);
if ($code === 200) {
    $data = json_decode($raw, true);
    if (!empty($data['products']) && is_array($data['products'])) {
        $products = $data['products'];
    }
}
if (is_file(LOCAL_PRODUCTS_FILE)) {
    $localData = json_decode((string)@file_get_contents(LOCAL_PRODUCTS_FILE), true);
    if (!empty($localData['products']) && is_array($localData['products'])) {
        $products = array_merge($products, $localData['products']);
    }
}

// 2. Todas as fotos referenciadas (sem repetição)
$filenames = [];
foreach ($products as $p) {
    if (!is_array($p)) {
        continue;
    }
    foreach (nte_img_product_files($p) as $name) {
        $filenames[$name] = true;
    }
}

// 3. Garante as duas cópias de cada foto
$deadline = microtime(true) + SYNC_TIME_BUDGET;
$downloaded = 0;
$uploaded = 0;
$alreadyOk = 0;
$missing = 0;
$deferred = 0;
$details = [];

foreach (array_keys($filenames) as $filename) {
    if (microtime(true) > $deadline) {
        $deferred++;
        continue;
    }

    $path = LOCAL_IMG_DIR . $filename;
    $hadLocal = nte_img_local_ok($path);

    if (!$hadLocal) {
        // Falta na Hostinger: copia da VPS (se a VPS também não tiver, não há o que copiar)
        if (nte_img_ensure_local(LOCAL_IMG_DIR, $filename, 6)) {
            $downloaded++;
            $details[] = ['file' => $filename, 'status' => 'downloaded_from_vps'];
        } else {
            $missing++;
            $details[] = ['file' => $filename, 'status' => 'missing_on_both'];
        }
        continue;
    }

    // Está na Hostinger: confere se a VPS também tem; se não, envia
    if (nte_img_vps_has($filename)) {
        $alreadyOk++;
    } elseif (nte_img_push_to_vps($path, $filename)) {
        $uploaded++;
        $details[] = ['file' => $filename, 'status' => 'uploaded_to_vps'];
    } else {
        $details[] = ['file' => $filename, 'status' => 'vps_unreachable_will_retry'];
    }
}

echo json_encode([
    'ok' => true,
    'total_unique_images' => count($filenames),
    'already_on_both' => $alreadyOk,
    'synced_from_vps' => $downloaded,
    'uploaded_to_vps' => $uploaded,
    'not_found_on_vps' => $missing,
    'deferred_to_next_run' => $deferred,
    'details' => $details,
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
