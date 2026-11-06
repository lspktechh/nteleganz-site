<?php
/**
 * NT Eleganz - API Gateway de Pedidos
 * Conecta o Storefront e o Painel Admin ao PostgreSQL na VPS
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

const VPS_API_ORDERS = 'https://137-131-233-254.sslip.io/nteleganz/api/orders';
const ORDERS_FILE = __DIR__ . '/../data/orders.json';

function callVpsOrders(string $method, string $url, ?array $body = null): ?array {
    $ch = curl_init($url);
    if (!$ch) return null;

    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
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

function readLocalOrders(): array {
    if (!file_exists(ORDERS_FILE)) return [];
    $raw = @file_get_contents(ORDERS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    return (is_array($data) && isset($data['orders']) && is_array($data['orders'])) ? $data['orders'] : [];
}

function saveLocalOrders(array $orders): void {
    $dir = dirname(ORDERS_FILE);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    @file_put_contents(ORDERS_FILE, json_encode([
        'updatedAt' => date('c'),
        'orders' => $orders
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

$method = $_SERVER['REQUEST_METHOD'];
$orderId = isset($_GET['id']) ? trim((string)$_GET['id']) : '';
$orderCode = isset($_GET['code']) ? trim((string)$_GET['code']) : '';
$clientPhone = isset($_GET['client_phone']) ? trim((string)$_GET['client_phone']) : '';
$clientEmail = isset($_GET['client_email']) ? trim((string)$_GET['client_email']) : '';

$rawBody = file_get_contents('php://input');
$input = $rawBody ? json_decode($rawBody, true) : null;

switch ($method) {
    case 'GET':
        // Busca pedidos de um cliente específico por telefone ou e-mail
        if ($clientPhone !== '' || $clientEmail !== '') {
            $queryParams = http_build_query(array_filter([
                'client_phone' => $clientPhone,
                'client_email' => $clientEmail
            ]));
            $vps = callVpsOrders('GET', VPS_API_ORDERS . '?' . $queryParams);
            if ($vps !== null && isset($vps['orders']) && is_array($vps['orders'])) {
                echo json_encode(['success' => true, 'orders' => $vps['orders']]);
                exit;
            }

            // Fallback local: busca por sufixo do telefone ou e-mail
            $cleanPhoneDigits = preg_replace('/\D/', '', $clientPhone);
            $suffix = strlen($cleanPhoneDigits) >= 8 ? substr($cleanPhoneDigits, -8) : $cleanPhoneDigits;
            $cleanEmail = strtolower($clientEmail);

            $local = readLocalOrders();
            $matches = [];
            foreach ($local as $o) {
                $oPhone = preg_replace('/\D/', '', (string)($o['phone'] ?? ''));
                $oEmail = strtolower((string)($o['email'] ?? ($o['raw_data']['email'] ?? '')));

                $matchPhone = ($suffix !== '' && $oPhone !== '' && (strpos($oPhone, $suffix) !== false));
                $matchEmail = ($cleanEmail !== '' && $oEmail === $cleanEmail);

                if ($matchPhone || $matchEmail) {
                    $matches[] = $o;
                }
            }

            echo json_encode(['success' => true, 'orders' => $matches]);
            exit;
        }

        // Busca pedido específico por código (#NTE-XXXX / NTE-XXXX) ou ID
        if ($orderCode !== '' || $orderId !== '') {
            $searchCode = strtoupper(ltrim($orderCode, '#'));
            $searchId = strtolower($orderId);

            $local = readLocalOrders();
            $found = null;
            foreach ($local as $o) {
                $c = strtoupper(ltrim((string)($o['code'] ?? ''), '#'));
                $i = strtolower((string)($o['id'] ?? ''));
                if (($searchCode !== '' && $c === $searchCode) || ($searchId !== '' && $i === $searchId)) {
                    $found = $o;
                    break;
                }
            }

            if (!$found) {
                $vps = callVpsOrders('GET', VPS_API_ORDERS);
                if ($vps !== null && isset($vps['orders']) && is_array($vps['orders'])) {
                    saveLocalOrders($vps['orders']);
                    foreach ($vps['orders'] as $o) {
                        $c = strtoupper(ltrim((string)($o['code'] ?? ''), '#'));
                        $i = strtolower((string)($o['id'] ?? ''));
                        if (($searchCode !== '' && $c === $searchCode) || ($searchId !== '' && $i === $searchId)) {
                            $found = $o;
                            break;
                        }
                    }
                }
            }

            if ($found) {
                echo json_encode(['success' => true, 'order' => $found]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Pedido não encontrado', 'code' => $orderCode ?: $orderId]);
            }
            exit;
        }

        $vps = callVpsOrders('GET', VPS_API_ORDERS);
        if ($vps !== null && isset($vps['orders'])) {
            saveLocalOrders($vps['orders']);
            echo json_encode(['orders' => $vps['orders']]);
            exit;
        }
        // Fallback local
        $local = readLocalOrders();
        echo json_encode(['orders' => $local]);
        exit;

    case 'POST':
        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['error' => 'Envie o corpo em JSON']);
            exit;
        }

        // Garante código amigável do pedido se não enviado
        if (empty($input['code'])) {
            $input['code'] = '#NTE-' . rand(1000, 9999);
        }

        $vps = callVpsOrders('POST', VPS_API_ORDERS, $input);
        if ($vps !== null && isset($vps['order'])) {
            $created = array_merge($input, $vps['order']);
            if (empty($created['items']) && !empty($input['items'])) {
                $created['items'] = $input['items'];
            }
            $local = readLocalOrders();
            array_unshift($local, $created);
            saveLocalOrders($local);
            http_response_code(201);
            echo json_encode(['success' => true, 'order' => $created]);
            exit;
        }

        // Fallback local se VPS indisponível
        $id = $input['id'] ?? ('ord_' . time() . '_' . substr(md5(uniqid()), 0, 5));
        $now = date('c');
        $created = array_merge($input, [
            'id' => $id,
            'createdAt' => $input['createdAt'] ?? $now,
            'updatedAt' => $now,
        ]);
        $local = readLocalOrders();
        array_unshift($local, $created);
        saveLocalOrders($local);
        http_response_code(201);
        echo json_encode(['success' => true, 'order' => $created]);
        exit;

    case 'PUT':
        $id = $orderId !== '' ? $orderId : ($input['id'] ?? '');
        $code = $orderCode !== '' ? $orderCode : ($input['code'] ?? '');

        if ($id === '' && $code !== '') {
            $searchCode = strtoupper(ltrim($code, '#'));
            $local = readLocalOrders();
            foreach ($local as $item) {
                $c = strtoupper(ltrim((string)($item['code'] ?? ''), '#'));
                if ($c === $searchCode) {
                    $id = (string)($item['id'] ?? '');
                    break;
                }
            }
            if ($id === '') {
                $vps = callVpsOrders('GET', VPS_API_ORDERS);
                if ($vps !== null && isset($vps['orders']) && is_array($vps['orders'])) {
                    foreach ($vps['orders'] as $item) {
                        $c = strtoupper(ltrim((string)($item['code'] ?? ''), '#'));
                        if ($c === $searchCode) {
                            $id = (string)($item['id'] ?? '');
                            break;
                        }
                    }
                }
            }
        }

        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID ou código do pedido']);
            exit;
        }

        $vps = callVpsOrders('PUT', VPS_API_ORDERS . '/' . urlencode($id), $input);
        if ($vps !== null && isset($vps['order'])) {
            $updated = $vps['order'];
            $local = readLocalOrders();
            foreach ($local as $idx => $item) {
                if (($item['id'] ?? '') === $id) {
                    $local[$idx] = array_merge($item, $updated);
                    break;
                }
            }
            saveLocalOrders($local);
            echo json_encode(['success' => true, 'order' => $updated]);
            exit;
        }

        // Fallback local
        $local = readLocalOrders();
        $found = null;
        foreach ($local as $idx => $item) {
            if (($item['id'] ?? '') === $id) {
                $local[$idx] = array_merge($item, $input, ['updatedAt' => date('c')]);
                $found = $local[$idx];
                break;
            }
        }
        if (!$found) {
            http_response_code(404);
            echo json_encode(['error' => 'Pedido não encontrado']);
            exit;
        }
        saveLocalOrders($local);
        echo json_encode(['success' => true, 'order' => $found]);
        exit;

    case 'DELETE':
        $id = $orderId !== '' ? $orderId : ($input['id'] ?? '');
        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID do pedido']);
            exit;
        }

        callVpsOrders('DELETE', VPS_API_ORDERS . '/' . urlencode($id));
        $local = readLocalOrders();
        $filtered = array_filter($local, fn($item) => ($item['id'] ?? '') !== $id);
        saveLocalOrders(array_values($filtered));
        echo json_encode(['success' => true, 'id' => $id]);
        exit;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Método não permitido']);
        exit;
}
