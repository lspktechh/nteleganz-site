<?php
// NT ELEGANZ — Proxy e Cache Inteligente de Imagens
// Se o arquivo não existir (ou estiver corrompido) no disco da Hostinger, busca na VPS, valida que é uma
// imagem de verdade, grava de forma atômica e devolve HTTP 200. Não apaga nada.
require_once __DIR__ . '/../../../api/lib/image_store.php';

$img = nte_img_safe_name($_GET['img'] ?? null);
if ($img === null) {
    http_response_code(404);
    exit('Imagem inválida');
}

$localPath = __DIR__ . '/' . $img;
if (nte_img_local_ok($localPath)) {
    $bytes = (string)file_get_contents($localPath);
} else {
    $bytes = nte_img_fetch_from_vps($img);
    if ($bytes !== null) {
        nte_write_atomic($localPath, $bytes);
    }
}

if (!is_string($bytes) || !nte_img_is_valid($bytes)) {
    http_response_code(404);
    header('Cache-Control: no-store');
    exit('Imagem não encontrada');
}

header('Content-Type: ' . nte_img_mime_from_bytes($bytes));
header('Cache-Control: public, max-age=31536000, immutable');
header('Content-Length: ' . strlen($bytes));
echo $bytes;
