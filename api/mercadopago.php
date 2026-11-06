<?php
/**
 * NT Eleganz — Integração de Checkout Oficial Mercado Pago
 * Cria preferências de pagamento com PIX, Cartão em até 12x e boleto,
 * registra o pedido no banco de dados e direciona para o ambiente seguro do Mercado Pago.
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

const MP_SETTINGS_FILE = __DIR__ . '/../data/mercadopago_settings.json';
const MP_PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';

function defaultMercadoPagoSettings(): array {
    return [
        'publicKey' => 'APP_USR-c8d843d2-e8c4-4509-93a5-6c7a38be819e',
        'accessToken' => 'APP_USR-4148777530483800-110522-7c2732adbccc669d7ba002abde4ccd4c-662355896',
        'webhookSecret' => '74640e6bb99781ef1584a29001c59d60d7a785fed72f309a92005e5ca5f5df0d',
        'webhookUrl' => 'https://nteleganz.com.br/api/mercadopago_webhook.php',
        'statementDescriptor' => 'NT ELEGANZ',
        'autoReturn' => 'approved',
        'binaryMode' => false,
        'updatedAt' => date('c')
    ];
}

function readMercadoPagoSettings(): array {
    $data = nte_live_read(MP_SETTINGS_FILE);
    if ($data === null || !is_array($data)) {
        $defaults = defaultMercadoPagoSettings();
        if (!nte_live_exists(MP_SETTINGS_FILE)) {
            nte_live_write(MP_SETTINGS_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }
        return $defaults;
    }
    return array_merge(defaultMercadoPagoSettings(), $data);
}

function saveMercadoPagoSettings(array $settings): bool {
    return nte_live_write(
        MP_SETTINGS_FILE,
        json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
}

function parsePriceToFloat($price): float {
    if (is_numeric($price)) {
        return round((float)$price, 2);
    }
    $cleaned = preg_replace('/[^\d,.]/', '', (string)$price);
    if (strpos($cleaned, ',') !== false) {
        $cleaned = str_replace('.', '', $cleaned);
        $cleaned = str_replace(',', '.', $cleaned);
    }
    return round((float)$cleaned, 2);
}

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: Consulta de Configurações ──
if ($method === 'GET') {
    $settings = readMercadoPagoSettings();
    $isAdmin = isset($_GET['admin']) || isset($_GET['full']);

    if ($isAdmin) {
        echo json_encode([
            'success' => true,
            'settings' => [
                'publicKey' => $settings['publicKey'] ?? '',
                'accessToken' => $settings['accessToken'] ?? '',
                'webhookSecret' => $settings['webhookSecret'] ?? '',
                'webhookUrl' => $settings['webhookUrl'] ?? 'https://nteleganz.com.br/api/mercadopago_webhook.php',
                'statementDescriptor' => $settings['statementDescriptor'] ?? 'NT ELEGANZ',
                'updatedAt' => $settings['updatedAt'] ?? null
            ]
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } else {
        echo json_encode([
            'success' => true,
            'publicKey' => $settings['publicKey'] ?? '',
            'webhookUrl' => $settings['webhookUrl'] ?? 'https://nteleganz.com.br/api/mercadopago_webhook.php'
        ]);
    }
    exit;
}

// ── POST ──
$rawInput = file_get_contents('php://input');
$data = $rawInput ? json_decode($rawInput, true) : null;

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Corpo da requisição deve ser um JSON válido.']);
    exit;
}

// ── Ação de Admin: Salvar Configurações ──
if (isset($data['action']) && $data['action'] === 'save_settings') {
    $current = readMercadoPagoSettings();
    $pub = trim((string)($data['publicKey'] ?? $current['publicKey']));
    $sec = trim((string)($data['accessToken'] ?? $current['accessToken']));
    $desc = trim((string)($data['statementDescriptor'] ?? $current['statementDescriptor']));

    if ($pub === '' || $sec === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Public Key e Access Token são obrigatórios.']);
        exit;
    }

    $updated = array_merge($current, [
        'publicKey' => $pub,
        'accessToken' => $sec,
        'webhookSecret' => trim((string)($data['webhookSecret'] ?? $current['webhookSecret'] ?? '')),
        'statementDescriptor' => !empty($desc) ? mb_substr($desc, 0, 16) : 'NT ELEGANZ',
        'updatedAt' => date('c')
    ]);

    if (saveMercadoPagoSettings($updated)) {
        echo json_encode(['success' => true, 'message' => 'Credenciais do Mercado Pago salvas com sucesso.']);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Falha ao gravar configurações do Mercado Pago no servidor.']);
    }
    exit;
}

// ── Criação de Checkout / Preferência Mercado Pago ──
if (empty($data['items']) || empty($data['customer'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Dados incompletos. Forneça "items" e "customer".']);
    exit;
}

$settings = readMercadoPagoSettings();
$accessToken = trim((string)($settings['accessToken'] ?? ''));

if ($accessToken === '') {
    http_response_code(500);
    echo json_encode(['error' => 'Access Token do Mercado Pago não configurado.']);
    exit;
}

$customer = $data['customer'];
$items = $data['items'];
$shipping = $data['shipping'] ?? null;

// Código amigável do pedido (#NTE-XXXX)
$orderCode = !empty($data['code']) ? strtoupper(ltrim((string)$data['code'], '#')) : 'NTE-' . rand(1000, 9999);
$displayCode = '#' . $orderCode;

// Monta lista de itens para a API do Mercado Pago
$mpItems = [];
$totalAmount = 0.0;

foreach ($items as $item) {
    $qty = max(1, (int)($item['qty'] ?? 1));
    $unitPrice = parsePriceToFloat($item['price'] ?? 0);
    if ($unitPrice <= 0) $unitPrice = 1.00;

    $descParts = [];
    if (!empty($item['brand'])) $descParts[] = $item['brand'];
    $descParts[] = $item['name'] ?? 'Produto NT Eleganz';
    if (!empty($item['size'])) $descParts[] = 'Tam: ' . $item['size'];
    if (!empty($item['color'])) $descParts[] = 'Cor: ' . $item['color'];

    $title = mb_substr(implode(' - ', array_filter($descParts)), 0, 120);

    $mpItems[] = [
        'id' => (string)($item['id'] ?? uniqid('item_')),
        'title' => $title,
        'description' => $title,
        'quantity' => $qty,
        'unit_price' => $unitPrice,
        'currency_id' => 'BRL'
    ];
    $totalAmount += ($unitPrice * $qty);
}

// Frete como item adicional
$effectiveShippingPrice = 0.0;
if (is_array($shipping) && isset($shipping['price'])) {
    $isFree = !empty($shipping['freeAbove']) && $totalAmount >= (float)$shipping['freeAbove'];
    if (!$isFree && (float)$shipping['price'] > 0) {
        $effectiveShippingPrice = parsePriceToFloat($shipping['price']);
        $shipName = $shipping['name'] ?? 'Frete Especial Segurado';
        $mpItems[] = [
            'id' => 'shipping_cost',
            'title' => 'Frete: ' . mb_substr($shipName, 0, 50),
            'quantity' => 1,
            'unit_price' => $effectiveShippingPrice,
            'currency_id' => 'BRL'
        ];
        $totalAmount += $effectiveShippingPrice;
    }
}

// Dados do pagador (Payer)
$custName = trim((string)($customer['name'] ?? ''));
$nameParts = explode(' ', $custName, 2);
$firstName = $nameParts[0] ?: 'Cliente';
$lastName = $nameParts[1] ?? 'NT Eleganz';

$rawPhone = preg_replace('/\D/', '', (string)($customer['phone'] ?? ''));
$areaCode = strlen($rawPhone) >= 10 ? substr($rawPhone, 0, 2) : '11';
$phoneNum = strlen($rawPhone) >= 10 ? substr($rawPhone, 2) : $rawPhone;

$rawCpf = preg_replace('/\D/', '', (string)($customer['cpf'] ?? ''));

$addr = is_array($customer['address'] ?? null) ? $customer['address'] : [];
$cleanCep = preg_replace('/\D/', '', (string)($addr['cep'] ?? ''));
$streetNumber = (int)preg_replace('/\D/', '', (string)($addr['number'] ?? '0')) ?: 1;

$payer = [
    'name' => $firstName,
    'surname' => $lastName,
    'email' => trim((string)($customer['email'] ?? 'sac@nteleganz.com.br')),
    'phone' => [
        'area_code' => $areaCode,
        'number' => $phoneNum
    ],
    'address' => [
        'zip_code' => $cleanCep,
        'street_name' => trim((string)($addr['street'] ?? 'Endereço')),
        'street_number' => $streetNumber
    ]
];

if (strlen($rawCpf) === 11) {
    $payer['identification'] = [
        'type' => 'CPF',
        'number' => $rawCpf
    ];
}

$redirectSuccess = "https://nteleganz.com.br/pedido/?code={$orderCode}&status=success";
$redirectFailure = "https://nteleganz.com.br/pedido/?code={$orderCode}&status=failure";
$redirectPending = "https://nteleganz.com.br/pedido/?code={$orderCode}&status=pending";
$webhookUrl = "https://nteleganz.com.br/api/mercadopago_webhook.php";

$preferencePayload = [
    'items' => $mpItems,
    'payer' => $payer,
    'back_urls' => [
        'success' => $redirectSuccess,
        'failure' => $redirectFailure,
        'pending' => $redirectPending
    ],
    'auto_return' => 'approved',
    'notification_url' => $webhookUrl,
    'external_reference' => $orderCode,
    'statement_descriptor' => !empty($settings['statementDescriptor']) ? $settings['statementDescriptor'] : 'NT ELEGANZ'
];

// Chamada para a API Oficial de Preferences do Mercado Pago
$ch = curl_init(MP_PREFERENCES_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($preferencePayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_TIMEOUT => 15,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $accessToken
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$resData = $response ? json_decode($response, true) : null;
$checkoutUrl = $resData['init_point'] ?? null;

if (!$checkoutUrl || $httpCode >= 400) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Falha ao gerar sessão de pagamento no Mercado Pago.',
        'details' => $resData['message'] ?? $resData['error'] ?? 'Erro de comunicação com o Mercado Pago'
    ]);
    exit;
}

// Formata total monetário
$formattedTotal = 'R$ ' . number_format($totalAmount, 2, ',', '.');

// Registra pedido localmente e na VPS como 'novo' / 'pending'
$orderRecord = [
    'id' => 'ord_' . time() . '_' . substr(md5($orderCode), 0, 5),
    'code' => $displayCode,
    'status' => 'novo',
    'value' => $formattedTotal,
    'clientName' => $customer['name'] ?? '',
    'phone' => $customer['phone'] ?? '',
    'email' => $customer['email'] ?? '',
    'customer' => $customer,
    'items' => $items,
    'shipping' => $shipping,
    'paymentMethod' => 'mercadopago',
    'paymentStatus' => 'pending',
    'checkoutUrl' => $checkoutUrl,
    'preferenceId' => $resData['id'] ?? '',
    'tracking' => is_array($data['tracking'] ?? null) ? $data['tracking'] : [],
    'clientIp' => $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '',
    'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
    'createdAt' => date('c'),
    'updatedAt' => date('c')
];

// Grava no endpoint de pedidos (local e PostgreSQL na VPS)
$chOrder = curl_init('https://nteleganz.com.br/api/orders.php');
curl_setopt_array($chOrder, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($orderRecord, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 4,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json']
]);
@curl_exec($chOrder);
@curl_close($chOrder);

echo json_encode([
    'success' => true,
    'orderCode' => $orderCode,
    'displayCode' => $displayCode,
    'checkoutUrl' => $checkoutUrl,
    'total' => $formattedTotal
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
