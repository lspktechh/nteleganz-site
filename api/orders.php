<?php
/**
 * NT Eleganz - API Gateway de Pedidos
 * Conecta o Storefront e o Painel Admin com armazenamento atômico e VPS PostgreSQL
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

require_once __DIR__ . '/orders_helper.php';

$method = $_SERVER['REQUEST_METHOD'];
$orderId = isset($_GET['id']) ? trim((string)$_GET['id']) : '';
$orderCode = isset($_GET['code']) ? trim((string)$_GET['code']) : '';
$clientPhone = isset($_GET['client_phone']) ? trim((string)$_GET['client_phone']) : '';
$clientEmail = isset($_GET['client_email']) ? trim((string)$_GET['client_email']) : '';
$channelFilter = isset($_GET['channel']) ? strtolower(trim((string)$_GET['channel'])) : '';

$rawBody = file_get_contents('php://input');
$input = $rawBody ? json_decode($rawBody, true) : null;

switch ($method) {
    case 'GET':
        // Busca pedidos de um cliente específico por telefone ou e-mail
        if ($clientPhone !== '' || $clientEmail !== '') {
            $all = getMergedOrders();
            $cleanPhoneDigits = preg_replace('/\D/', '', $clientPhone);
            $suffix = strlen($cleanPhoneDigits) >= 8 ? substr($cleanPhoneDigits, -8) : $cleanPhoneDigits;
            $cleanEmail = strtolower($clientEmail);

            $matches = [];
            foreach ($all as $o) {
                $oPhone = preg_replace('/\D/', '', (string)($o['phone'] ?? ''));
                $oEmail = strtolower((string)($o['email'] ?? ($o['customer']['email'] ?? '')));

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

            $all = getMergedOrders();
            $found = null;
            foreach ($all as $o) {
                $c = strtoupper(ltrim((string)($o['code'] ?? ''), '#'));
                $i = strtolower((string)($o['id'] ?? ''));
                if (($searchCode !== '' && $c === $searchCode) || ($searchId !== '' && $i === $searchId)) {
                    $found = $o;
                    break;
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

        // Retorna todos os pedidos mesclados (com filtro opcional de canal)
        $all = getMergedOrders();
        if ($channelFilter !== '') {
            $all = array_values(array_filter($all, function($o) use ($channelFilter) {
                return strtolower($o['channel'] ?? '') === $channelFilter;
            }));
        }

        echo json_encode(['orders' => $all]);
        exit;

    case 'POST':
        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['error' => 'Envie o corpo em JSON']);
            exit;
        }

        $created = persistOrder($input);
        http_response_code(201);
        echo json_encode(['success' => true, 'order' => $created]);
        exit;

    case 'PUT':
        $target = $orderCode !== '' ? $orderCode : ($orderId !== '' ? $orderId : ($input['id'] ?? ($input['code'] ?? '')));
        if ($target === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID ou código do pedido']);
            exit;
        }

        $updated = updateOrder($target, is_array($input) ? $input : []);
        if (!$updated) {
            http_response_code(404);
            echo json_encode(['error' => 'Pedido não encontrado para atualização']);
            exit;
        }

        echo json_encode(['success' => true, 'order' => $updated]);
        exit;

    case 'DELETE':
        $id = $orderId !== '' ? $orderId : ($orderCode !== '' ? $orderCode : ($input['id'] ?? ''));
        if ($id === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID ou código do pedido']);
            exit;
        }

        callVpsOrders('DELETE', VPS_API_ORDERS . '/' . urlencode($id));
        $local = readLocalOrders();
        $searchCode = strtoupper(ltrim($id, '#'));
        $filtered = array_filter($local, function($item) use ($id, $searchCode) {
            $itemCode = strtoupper(ltrim((string)($item['code'] ?? ''), '#'));
            $itemId = (string)($item['id'] ?? '');
            return ($itemId !== $id && $itemCode !== $searchCode);
        });
        saveLocalOrders(array_values($filtered));
        echo json_encode(['success' => true, 'id' => $id]);
        exit;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Método não permitido']);
        exit;
}
