<?php
/**
 * NT Eleganz — Webhook de Notificações de Pagamento InfinitePay
 * Atualiza automaticamente o status do pedido para 'pago' / 'aprovado'
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

$rawPayload = file_get_contents('php://input');
$payload = $rawPayload ? json_decode($rawPayload, true) : null;

// Log silencioso do evento recebido para auditoria
$logDir = __DIR__ . '/../data/logs';
if (!is_dir($logDir)) @mkdir($logDir, 0755, true);
@file_put_contents(
    $logDir . '/infinitepay_webhooks_' . date('Y-m') . '.log',
    "[" . date('c') . "] " . ($rawPayload ?: 'EMPTY') . "\n",
    FILE_APPEND
);

if (!is_array($payload)) {
    http_response_code(200);
    echo json_encode(['status' => 'ignored']);
    exit;
}

$orderId = $payload['order_id'] ?? ($payload['orderId'] ?? ($payload['metadata']['order_id'] ?? null));
$status = strtolower((string)($payload['status'] ?? ($payload['event'] ?? '')));

// Se aprovado / pago
$isApproved = in_array($status, ['approved', 'payment_approved', 'paid', 'completed'], true);

if ($orderId && $isApproved) {
    $cleanCode = strtoupper(ltrim((string)$orderId, '#'));

    // Atualiza o pedido direto no armazenamento. Antes era um PUT HTTP sem login na API pública de pedidos,
    // que agora só aceita admin.
    $updateData = [
        'status' => 'pago',
        'paymentStatus' => 'approved',
        'paidAt' => date('c')
    ];

    require_once __DIR__ . '/orders_helper.php';
    updateOrder($cleanCode, $updateData);

    // Dispara e-mail oficial de confirmação de compra após pagamento aprovado
    require_once __DIR__ . '/send_order_email.php';
    $orderData = findOrderByCode($cleanCode);

    if (is_array($orderData)) {
        try {
            sendOrderConfirmationEmail($orderData);
        } catch (\Throwable $e) {
            // Log de erro de envio de e-mail silencioso
        }

        // Dispara evento Purchase na API de Conversões da Meta (CAPI) para 100% de mensuração
        try {
            require_once __DIR__ . '/tracking.php';
            sendMetaConversionsApiPurchase($orderData);
        } catch (\Throwable $e) {
            // Log silencioso CAPI
        }
    }
}

http_response_code(200);
echo json_encode(['success' => true]);
