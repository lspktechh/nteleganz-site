<?php
/**
 * NT Eleganz — Webhook Oficial de Notificações Mercado Pago
 * Recebe notificações instantâneas de pagamento (PIX / Cartão),
 * valida o status diretamente na API do Mercado Pago, atualiza o pedido para 'pago'
 * e dispara a confirmação de compra por e-mail e mensuração de conversão Meta CAPI.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/lib/live_data.php';

const MP_SETTINGS_FILE = __DIR__ . '/../data/mercadopago_settings.json';

function getMercadoPagoAccessToken(): string {
    $data = nte_live_read(MP_SETTINGS_FILE);
    if (is_array($data) && !empty($data['accessToken'])) {
        return (string)$data['accessToken'];
    }
    return 'APP_USR-4148777530483800-110522-7c2732adbccc669d7ba002abde4ccd4c-662355896';
}

function getMercadoPagoWebhookSecret(): string {
    $data = nte_live_read(MP_SETTINGS_FILE);
    if (is_array($data) && !empty($data['webhookSecret'])) {
        return (string)$data['webhookSecret'];
    }
    return '74640e6bb99781ef1584a29001c59d60d7a785fed72f309a92005e5ca5f5df0d';
}

function verifyMercadoPagoSignature(?string $dataId): bool {
    $secret = getMercadoPagoWebhookSecret();
    if (empty($secret)) return true;
    $xSignature = $_SERVER['HTTP_X_SIGNATURE'] ?? '';
    if (empty($xSignature)) return true;

    $parts = explode(',', $xSignature);
    $ts = null;
    $v1 = null;
    foreach ($parts as $p) {
        $kv = explode('=', trim($p), 2);
        if (count($kv) === 2) {
            if ($kv[0] === 'ts') $ts = $kv[1];
            if ($kv[0] === 'v1') $v1 = $kv[1];
        }
    }
    if (!$ts || !$v1) return true;

    $requestId = $_SERVER['HTTP_X_REQUEST_ID'] ?? '';
    $manifest = 'id:' . ($dataId ?? '') . ';request-id:' . $requestId . ';ts:' . $ts . ';';
    $calculated = hash_hmac('sha256', $manifest, $secret);
    return hash_equals($calculated, $v1);
}

$rawPayload = file_get_contents('php://input');
$payload = $rawPayload ? json_decode($rawPayload, true) : null;

// Log silencioso para auditoria e histórico
$logDir = __DIR__ . '/../data/logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
$queryLog = !empty($_SERVER['QUERY_STRING']) ? ' [QUERY: ' . $_SERVER['QUERY_STRING'] . ']' : '';
@file_put_contents(
    $logDir . '/mercadopago_webhooks_' . date('Y-m') . '.log',
    "[" . date('c') . "]" . $queryLog . " " . ($rawPayload ?: 'EMPTY') . "\n",
    FILE_APPEND
);

// Responde OPTIONS se necessário
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Identifica o ID do pagamento enviado pelo Mercado Pago
$paymentId = null;

if (is_array($payload)) {
    if (isset($payload['data']['id'])) {
        $paymentId = (string)$payload['data']['id'];
    } elseif (isset($payload['id']) && (!isset($payload['type']) || $payload['type'] === 'payment')) {
        $paymentId = (string)$payload['id'];
    }
}

// Fallback por parâmetros GET (notificações IPN tradicionais)
if (!$paymentId) {
    if (isset($_GET['data_id'])) {
        $paymentId = trim((string)$_GET['data_id']);
    } elseif (isset($_GET['id']) && (isset($_GET['topic']) && $_GET['topic'] === 'payment' || isset($_GET['type']) && $_GET['type'] === 'payment')) {
        $paymentId = trim((string)$_GET['id']);
    }
}

// Se a notificação for de merchant_order, extrai pagamentos associados
if (!$paymentId && (isset($_GET['topic']) && $_GET['topic'] === 'merchant_order' || isset($payload['type']) && $payload['type'] === 'merchant_order')) {
    $orderId = trim((string)($_GET['id'] ?? ($payload['data']['id'] ?? ($payload['id'] ?? ''))));
    if ($orderId !== '') {
        $token = getMercadoPagoAccessToken();
        $chMo = curl_init("https://api.mercadopago.com/merchant_orders/{$orderId}");
        curl_setopt_array($chMo, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 6,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Accept: application/json'
            ]
        ]);
        $resMo = curl_exec($chMo);
        curl_close($chMo);
        $moData = $resMo ? json_decode($resMo, true) : null;
        if (is_array($moData) && !empty($moData['payments'])) {
            foreach ($moData['payments'] as $p) {
                if (isset($p['status']) && $p['status'] === 'approved' && !empty($p['id'])) {
                    $paymentId = (string)$p['id'];
                    break;
                }
            }
        }
    }
}

if (!$paymentId) {
    http_response_code(200);
    echo json_encode(['status' => 'ignored', 'reason' => 'No payment ID found in notification']);
    exit;
}

// Consulta oficial do pagamento diretamente na API do Mercado Pago
$accessToken = getMercadoPagoAccessToken();
$chPay = curl_init("https://api.mercadopago.com/v1/payments/{$paymentId}");
curl_setopt_array($chPay, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $accessToken,
        'Accept: application/json'
    ]
]);

$payResponse = curl_exec($chPay);
$payHttpCode = curl_getinfo($chPay, CURLINFO_HTTP_CODE);
curl_close($chPay);

$payment = $payResponse ? json_decode($payResponse, true) : null;

if (!is_array($payment) || $payHttpCode >= 400) {
    // Retorna 200 para evitar que o Mercado Pago fique reenviando eternamente erro de consulta
    http_response_code(200);
    echo json_encode(['status' => 'error_fetching_payment', 'http_code' => $payHttpCode]);
    exit;
}

$status = strtolower((string)($payment['status'] ?? ''));
$orderCode = trim((string)($payment['external_reference'] ?? ''));
$isApproved = ($status === 'approved');

if ($orderCode !== '' && $isApproved) {
    $cleanCode = strtoupper(ltrim($orderCode, '#'));
    $paymentMethod = $payment['payment_method_id'] ?? 'mercadopago';
    $dateApproved = $payment['date_approved'] ?? date('c');

    $updateData = [
        'status' => 'pago',
        'paymentStatus' => 'approved',
        'paidAt' => $dateApproved,
        'paymentMethod' => 'mercadopago',
        'paymentMethodDetail' => 'mercadopago_' . $paymentMethod,
        'mercadopagoPaymentId' => (string)$paymentId
    ];

    // Atualiza status do pedido
    $chPut = curl_init("https://nteleganz.com.br/api/orders.php?code={$cleanCode}");
    curl_setopt_array($chPut, [
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => json_encode($updateData, JSON_UNESCAPED_SLASHES),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json']
    ]);
    @curl_exec($chPut);
    @curl_close($chPut);

    // Busca dados completos do pedido para enviar e-mail e CAPI
    $chGet = curl_init("https://nteleganz.com.br/api/orders.php?code={$cleanCode}");
    curl_setopt_array($chGet, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Accept: application/json']
    ]);
    $resGet = @curl_exec($chGet);
    @curl_close($chGet);

    $orderObj = $resGet ? json_decode($resGet, true) : null;
    $orderData = $orderObj['order'] ?? $orderObj ?? null;

    if (is_array($orderData)) {
        // Dispara e-mail de confirmação ao cliente
        try {
            require_once __DIR__ . '/send_order_email.php';
            sendOrderConfirmationEmail($orderData);
        } catch (\Throwable $e) {
            // Silencioso
        }

        // Dispara evento Purchase para o Meta Ads CAPI
        try {
            require_once __DIR__ . '/tracking.php';
            sendMetaConversionsApiPurchase($orderData);
        } catch (\Throwable $e) {
            // Silencioso
        }
    }
}

http_response_code(200);
echo json_encode([
    'success' => true,
    'payment_id' => $paymentId,
    'status' => $status,
    'order_code' => $orderCode
]);
