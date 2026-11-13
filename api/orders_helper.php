<?php
/**
 * NT Eleganz - Helper Unificado de Persistência de Pedidos
 * Garante salvamento atômico local em data/orders.json e sincronização com VPS PostgreSQL
 */

date_default_timezone_set('America/Sao_Paulo');

require_once __DIR__ . '/lib/vps_secret.php';
require_once __DIR__ . '/lib/live_data.php';

/**
 * De quanto em quanto tempo (segundos) a lista de pedidos é mesclada com a VPS.
 * Antes, TODA listagem (o painel lista ao abrir e a cada 25s) consultava a VPS, que leva de 0,5s a 7s,
 * e regravava o arquivo inteiro de pedidos. Os pedidos são gravados primeiro no arquivo local
 * (saveOrder), então a VPS só acrescenta o que foi criado fora daqui.
 */
if (!defined('NTE_ORDERS_VPS_SYNC_INTERVAL')) {
    define('NTE_ORDERS_VPS_SYNC_INTERVAL', 120);
}

if (!defined('ORDERS_FILE')) {
    define('ORDERS_FILE', __DIR__ . '/../data/orders.json');
}
if (!defined('VPS_API_ORDERS')) {
    define('VPS_API_ORDERS', 'https://137-131-233-254.sslip.io/nteleganz/api/orders');
}

function callVpsOrders(string $method, string $url, ?array $body = null): ?array {
    $ch = curl_init($url);
    if (!$ch) return null;

    // A API de pedidos da VPS exige a chave interna (dados pessoais de clientes).
    $headers = ['Accept: application/json', nte_vps_secret_header()];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
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

/*
 * Pedidos ficam em data/orders.live.json, fora do git (ver lib/live_data.php). data/orders.json é
 * versionado: antes era gravado direto e cada deploy (a Hostinger puxa o repositório) o voltava para
 * a cópia do git — pedidos recentes só voltavam pela mesclagem com a VPS.
 */
function readLocalOrders(): array {
    $data = nte_live_read(ORDERS_FILE);
    return (is_array($data) && isset($data['orders']) && is_array($data['orders'])) ? $data['orders'] : [];
}

function saveLocalOrders(array $orders): bool {
    $payload = json_encode([
        'updatedAt' => date('c'),
        'count' => count($orders),
        'orders' => array_values($orders)
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return $payload !== false && nte_live_write(ORDERS_FILE, $payload);
}

function normalizeOrderChannel(array $order): array {
    // Normaliza canal
    if (empty($order['channel'])) {
        $pm = strtolower((string)($order['paymentMethod'] ?? ''));
        $notes = (string)($order['notes'] ?? '');
        $source = strtolower((string)($order['source'] ?? ''));

        if ($pm === 'whatsapp' || $source === 'whatsapp' || stripos($notes, 'WhatsApp') !== false) {
            $order['channel'] = 'whatsapp';
        } else if ($pm === 'pix' || $pm === 'credit_card' || $pm === 'cartao' || $pm === 'mercadopago' || $pm === 'infinitepay') {
            $order['channel'] = 'checkout';
        } else {
            $order['channel'] = 'checkout';
        }
    }

    // Normaliza nome do cliente se estiver genérico
    $currentClient = trim((string)($order['client'] ?? ''));
    if ($currentClient === '' || $currentClient === 'Cliente do site' || $currentClient === 'Cliente') {
        $candidate = trim((string)($order['clientName'] ?? ($order['customer']['name'] ?? '')));
        if ($candidate !== '') {
            $order['client'] = $candidate;
        }
    }

    // Normaliza telefone se estiver vazio no topo mas existir no customer
    if (empty($order['phone']) && !empty($order['customer']['phone'])) {
        $order['phone'] = $order['customer']['phone'];
    }

    // Normaliza email se estiver vazio no topo mas existir no customer
    if (empty($order['email']) && !empty($order['customer']['email'])) {
        $order['email'] = $order['customer']['email'];
    }

    // Normaliza produtos/itens e preenche productName, brand, size, color, imageUrl
    $rawItems = $order['items'] ?? [];
    if (is_string($rawItems)) {
        $decoded = @json_decode($rawItems, true);
        if (is_array($decoded)) {
            $rawItems = $decoded;
            $order['items'] = $decoded;
        }
    }
    if ((empty($rawItems) || !is_array($rawItems)) && !empty($order['raw_data']['items'])) {
        $rawItems = is_array($order['raw_data']['items']) ? $order['raw_data']['items'] : (@json_decode($order['raw_data']['items'], true) ?: []);
        if (!empty($rawItems) && is_array($rawItems)) {
            $order['items'] = $rawItems;
        }
    }
    if (is_array($rawItems) && !empty($rawItems)) {
        $firstItem = $rawItems[0] ?? [];
        if (empty($order['productName']) || $order['productName'] === '—') {
            if (count($rawItems) > 1) {
                $order['productName'] = count($rawItems) . ' itens no pedido';
            } else {
                $order['productName'] = $firstItem['name'] ?? ($firstItem['title'] ?? '');
            }
        }
        if (empty($order['productBrand']) && !empty($firstItem['brand'])) {
            $order['productBrand'] = $firstItem['brand'];
        }
        if (empty($order['size']) && !empty($firstItem['size'])) {
            $order['size'] = $firstItem['size'];
        }
        if (empty($order['color']) && !empty($firstItem['color'])) {
            $order['color'] = $firstItem['color'];
        }
        if (empty($order['imageUrl']) && !empty($firstItem['image'])) {
            $order['imageUrl'] = $firstItem['image'];
        }
    }

    return $order;
}

/**
 * Retorna todos os pedidos mesclando local com a VPS.
 * Nenhum pedido local é apagado caso a VPS falhe ou retorne lista incompleta.
 */
function getMergedOrders(): array {
    // Primeira leitura depois de migrar para o arquivo vivo: ele nasce da semente (cópia antiga do
    // git), então mescla com a VPS já nesta chamada em vez de esperar o intervalo.
    $firstLiveRead = !is_file(nte_live_path(ORDERS_FILE));
    $local = readLocalOrders();
    $indexed = [];

    // Indexa locais por ID e por Código
    foreach ($local as $item) {
        $key = !empty($item['id']) ? (string)$item['id'] : (!empty($item['code']) ? (string)$item['code'] : uniqid());
        $indexed[$key] = normalizeOrderChannel($item);
    }

    // Consulta VPS com timeout rápido — no máximo uma vez a cada NTE_ORDERS_VPS_SYNC_INTERVAL.
    $vps = ($firstLiveRead || nteOrdersVpsSyncDue()) ? callVpsOrders('GET', VPS_API_ORDERS) : null;
    if ($vps !== null && isset($vps['orders']) && is_array($vps['orders'])) {
        foreach ($vps['orders'] as $vItem) {
            $vKey = !empty($vItem['id']) ? (string)$vItem['id'] : (!empty($vItem['code']) ? (string)$vItem['code'] : null);
            if ($vKey && isset($indexed[$vKey])) {
                // Mescla mantendo dados locais novos se existirem
                $indexed[$vKey] = normalizeOrderChannel(array_merge($vItem, $indexed[$vKey]));
            } else if ($vKey) {
                $indexed[$vKey] = normalizeOrderChannel($vItem);
            }
        }
    }

    $orders = array_values($indexed);
    // Ordena por data decrescente
    usort($orders, function($a, $b) {
        $tA = strtotime($a['createdAt'] ?? $a['updatedAt'] ?? 'now');
        $tB = strtotime($b['createdAt'] ?? $b['updatedAt'] ?? 'now');
        return $tB <=> $tA;
    });

    // Regrava o arquivo só se algo mudou: com ~150 pedidos são centenas de KB a cada listagem.
    if (json_encode(array_values($orders)) !== json_encode(array_values($local))) {
        saveLocalOrders($orders);
    }
    return $orders;
}

/** Hora de mesclar com a VPS? Marca o horário ANTES de chamar, para requisições simultâneas não irem todas. */
function nteOrdersVpsSyncDue(): bool {
    $stamp = dirname(ORDERS_FILE) . '/.orders_vps_sync_at';
    $last = (int)@file_get_contents($stamp);
    if (time() - $last < NTE_ORDERS_VPS_SYNC_INTERVAL) return false;
    @file_put_contents($stamp, (string)time(), LOCK_EX);
    return true;
}

/**
 * Campos do pedido que as páginas públicas (pedido/ e "meus pedidos") de fato usam. Quem não é admin
 * recebe só isto: sem telefone, e-mail, endereço, CPF, IP, user agent nem dados de rastreamento.
 */
const NTE_PUBLIC_ORDER_FIELDS = [
    'id', 'code', 'status', 'value', 'items', 'createdAt', 'created_at', 'updatedAt',
    'productId', 'productName', 'productBrand', 'size', 'color', 'quantity', 'imageUrl',
    'channel', 'paymentMethod', 'paymentStatus',
];

function publicOrderView(array $order): array {
    return array_intersect_key($order, array_flip(NTE_PUBLIC_ORDER_FIELDS));
}

/** Pedido pelo código (#NTE-1234 ou NTE-1234) na lista local + VPS; null se não existir. */
function findOrderByCode(string $code): ?array {
    $search = strtoupper(ltrim(trim($code), '#'));
    if ($search === '') return null;
    foreach (getMergedOrders() as $order) {
        if (strtoupper(ltrim((string)($order['code'] ?? ''), '#')) === $search) {
            return $order;
        }
    }
    return null;
}

/**
 * Salva ou cria um novo pedido de forma atômica no arquivo local e na VPS.
 *
 * $existingMergeKeys: para chamadas não confiáveis (navegador do cliente). Se o pedido já existir, só
 * estes campos são aplicados, e o restante (status, valor, telefone, id...) é ignorado. null = tudo
 * (uso do servidor e do admin).
 */
function persistOrder(array $input, ?array $existingMergeKeys = null): array {
    if (empty($input['code'])) {
        $input['code'] = '#NTE-' . rand(1000, 9999);
    } else if (substr($input['code'], 0, 1) !== '#') {
        $input['code'] = '#' . $input['code'];
    }

    $input = normalizeOrderChannel($input);

    $now = date('c');
    if (empty($input['id'])) {
        $input['id'] = 'ord_' . time() . '_' . substr(md5(uniqid(mt_rand(), true)), 0, 6);
    }
    if (empty($input['createdAt'])) {
        $input['createdAt'] = $now;
    }
    $input['updatedAt'] = $now;

    // 1. Salva localmente IMEDIATAMENTE (nunca perde o pedido)
    $local = readLocalOrders();
    // Verifica se já existe para atualizar ou inserir no topo
    $foundIdx = -1;
    $cleanCode = strtoupper(ltrim($input['code'], '#'));
    foreach ($local as $idx => $existing) {
        $existCode = strtoupper(ltrim((string)($existing['code'] ?? ''), '#'));
        $existId = (string)($existing['id'] ?? '');
        if (($existId !== '' && $existId === $input['id']) || ($cleanCode !== '' && $existCode === $cleanCode)) {
            $foundIdx = $idx;
            break;
        }
    }

    if ($foundIdx >= 0) {
        if ($existingMergeKeys !== null) {
            $input = array_intersect_key($input, array_flip($existingMergeKeys));
            $input['updatedAt'] = $now;
        }
        $local[$foundIdx] = array_merge($local[$foundIdx], $input);
        $finalRecord = $local[$foundIdx];
    } else {
        array_unshift($local, $input);
        $finalRecord = $input;
    }
    saveLocalOrders($local);

    // 2. Tenta sincronizar com a VPS
    $vps = callVpsOrders('POST', VPS_API_ORDERS, $finalRecord);
    if ($vps !== null && isset($vps['order']) && is_array($vps['order'])) {
        $merged = array_merge($finalRecord, $vps['order']);
        if (empty($merged['items']) && !empty($finalRecord['items'])) {
            $merged['items'] = $finalRecord['items'];
        }
        $finalRecord = normalizeOrderChannel($merged);
        // Atualiza local com IDs retornados pela VPS se houver
        if ($foundIdx >= 0) {
            $local[$foundIdx] = $finalRecord;
        } else {
            $local[0] = $finalRecord;
        }
        saveLocalOrders($local);
    }

    return $finalRecord;
}

/**
 * Atualiza um pedido existente por ID ou Código
 */
function updateOrder(string $idOrCode, array $updateData): ?array {
    $searchCode = strtoupper(ltrim($idOrCode, '#'));
    $searchId = strtolower($idOrCode);
    $local = readLocalOrders();
    $foundIdx = -1;

    foreach ($local as $idx => $item) {
        $c = strtoupper(ltrim((string)($item['code'] ?? ''), '#'));
        $i = strtolower((string)($item['id'] ?? ''));
        if (($searchCode !== '' && $c === $searchCode) || ($searchId !== '' && $i === $searchId)) {
            $foundIdx = $idx;
            break;
        }
    }

    if ($foundIdx < 0) {
        return null;
    }

    $updateData['updatedAt'] = date('c');
    $local[$foundIdx] = normalizeOrderChannel(array_merge($local[$foundIdx], $updateData));
    $updated = $local[$foundIdx];
    saveLocalOrders($local);

    // Sincroniza Meio Caminho se o pedido foi pago / concluído
    $st = strtolower((string)($updated['status'] ?? ''));
    $pst = strtolower((string)($updated['paymentStatus'] ?? ''));
    if ($st === 'pago' || $st === 'confirmado' || $pst === 'approved' || $pst === 'paid') {
        try {
            $liveFile = __DIR__ . '/../data/abandoned_checkouts.live.json';
            $baseFile = __DIR__ . '/../data/abandoned_checkouts.json';
            $targetFile = file_exists($liveFile) ? $liveFile : $baseFile;
            if (file_exists($targetFile)) {
                $raw = @file_get_contents($targetFile);
                $d = $raw ? @json_decode($raw, true) : null;
                if (is_array($d) && !empty($d['checkouts'])) {
                    $changed = false;
                    $codeClean = strtoupper(ltrim((string)($updated['code'] ?? ''), '#'));
                    foreach ($d['checkouts'] as &$chk) {
                        $chkCode = strtoupper(ltrim((string)($chk['orderCode'] ?? ''), '#'));
                        if ($codeClean !== '' && $chkCode === $codeClean && empty($chk['recovered'])) {
                            $chk['status'] = 'recuperado';
                            $chk['recovered'] = true;
                            $chk['finalizado'] = true;
                            $chk['orderCode'] = $updated['code'] ?? '';
                            $chk['finalizedAt'] = date('c');
                            $changed = true;
                        }
                    }
                    unset($chk);
                    if ($changed) {
                        $newPayload = json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                        @file_put_contents($liveFile, $newPayload, LOCK_EX);
                        @file_put_contents($baseFile, $newPayload, LOCK_EX);
                    }
                }
            }
        } catch (\Throwable $e) {}
    }

    // Atualiza na VPS
    $vpsId = $updated['id'] ?? $idOrCode;
    callVpsOrders('PUT', VPS_API_ORDERS . '/' . urlencode($vpsId), $updateData);

    return $updated;
}
