<?php
/**
 * NT Eleganz — Integração de Checkout Oficial Mercado Pago (Checkout Transparente)
 * Processa PIX (QR Code + Copia e Cola) e Cartão de Crédito (até 12x) diretamente no site,
 * sem redirecionamento para fora do checkout.
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
require_once __DIR__ . '/lib/admin_guard.php';

const MP_SETTINGS_FILE = __DIR__ . '/../data/mercadopago_settings.json';
const MP_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';
const MP_PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';
const MP_CARD_TOKENS_URL = 'https://api.mercadopago.com/v1/card_tokens';
const MP_INSTALLMENTS_URL = 'https://api.mercadopago.com/v1/payment_methods/installments';

function defaultMercadoPagoSettings(): array {
    return [
        'publicKey' => 'APP_USR-c8d843d2-e8c4-4509-93a5-6c7a38be819e',
        'accessToken' => 'APP_USR-4148777530483800-110522-7c2732adbccc669d7ba002abde4ccd4c-662355896',
        'webhookSecret' => '74640e6bb99781ef1584a29001c59d60d7a785fed72f309a92005e5ca5f5df0d',
        'webhookUrl' => 'https://nteleganz.com.br/api/mercadopago_webhook.php',
        'statementDescriptor' => 'NT ELEGANZ',
        'autoReturn' => 'approved',
        'binaryMode' => false,
        'applePay' => [
            'enabled' => false,
            'merchantIdentifier' => 'merchant.com.nteleganz',
            'certificatePublicHash' => '',
            'domainName' => 'nteleganz.com.br',
            'displayName' => 'NT Eleganz'
        ],
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

function getCatalogProductsMap(): array {
    $productsFile = __DIR__ . '/../data/products.json';
    if (!file_exists($productsFile)) return [];
    $raw = @file_get_contents($productsFile);
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    if (!is_array($data) || empty($data['products']) || !is_array($data['products'])) return [];

    $map = [];
    foreach ($data['products'] as $p) {
        if (!empty($p['id'])) {
            $map[(string)$p['id']] = $p;
        }
        if (!empty($p['slug'])) {
            $map[(string)$p['slug']] = $p;
        }
    }
    return $map;
}

function getOfficialShippingMethods(): array {
    $shippingMethodsFile = __DIR__ . '/../data/shipping_methods.json';
    if (!file_exists($shippingMethodsFile)) return [];
    $raw = @file_get_contents($shippingMethodsFile);
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function isCustomerVip(?string $token, ?string $phone, ?string $email, ?string $instagram = null): bool {
    $file = __DIR__ . '/../data/vip_subscriptions.json';
    if (!file_exists($file)) return false;
    $raw = @file_get_contents($file);
    if (!$raw) return false;
    $data = @json_decode($raw, true);
    $subs = (is_array($data) && isset($data['subscriptions']) && is_array($data['subscriptions']))
        ? $data['subscriptions']
        : [];
    $now = time();
    $cleanPhone = preg_replace('/\D/', '', (string)$phone);
    $cleanEmail = strtolower(trim((string)$email));
    $cleanInsta = strtolower(ltrim(trim((string)$instagram), '@'));

    foreach ($subs as $s) {
        if (($s['status'] ?? '') !== 'active') continue;
        if (!empty($s['expiresAt']) && strtotime($s['expiresAt']) < $now) continue;

        if (!empty($token) && !empty($s['vipToken']) && hash_equals($s['vipToken'], $token)) {
            return true;
        }
        if (!empty($cleanEmail) && strtolower(trim((string)($s['customer']['email'] ?? ''))) === $cleanEmail) {
            return true;
        }
        if (!empty($cleanInsta)) {
            $sInsta = strtolower(ltrim(trim((string)($s['customer']['instagram'] ?? '')), '@'));
            if ($sInsta !== '' && $sInsta === $cleanInsta) return true;
        }
        $sPhone = preg_replace('/\D/', '', (string)($s['customer']['phone'] ?? ''));
        if (strlen($cleanPhone) >= 8 && substr($sPhone, -8) === substr($cleanPhone, -8)) {
            return true;
        }
    }
    return false;
}

function callMercadoPagoApi(string $url, string $method, ?array $body, string $accessToken, ?string $idempotencyKey = null): array {
    $ch = curl_init($url);
    $headers = [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $accessToken
    ];
    if ($idempotencyKey) {
        $headers[] = 'X-Idempotency-Key: ' . $idempotencyKey;
    }

    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $headers
    ];

    if ($method === 'POST') {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } elseif ($method === 'GET') {
        $opts[CURLOPT_HTTPGET] = true;
    }

    curl_setopt_array($ch, $opts);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    $decoded = $response ? json_decode($response, true) : null;
    return [
        'httpCode' => $httpCode,
        'data' => is_array($decoded) ? $decoded : null,
        'raw' => $response,
        'error' => $curlError
    ];
}

require_once __DIR__ . '/orders_helper.php';

function registerOrderInDatabase(array $orderRecord): void {
    try {
        persistOrder($orderRecord);
    } catch (\Throwable $e) {
        error_log("Erro ao persistir pedido via registerOrderInDatabase: " . $e->getMessage());
    }
}

function updateOrderStatusInDatabase(string $orderCode, array $updateData): void {
    try {
        updateOrder($orderCode, $updateData);
    } catch (\Throwable $e) {
        error_log("Erro ao atualizar status do pedido via updateOrderStatusInDatabase: " . $e->getMessage());
    }
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// ── GET REQUESTS ──
if ($method === 'GET') {
    $settings = readMercadoPagoSettings();
    $accessToken = trim((string)($settings['accessToken'] ?? ''));

    // 1. Consulta de Status de Pagamento (Polling para aprovação do Pix ou Cartão)
    if ($action === 'check_payment') {
        $paymentId = trim((string)($_GET['id'] ?? ''));
        $orderCode = trim((string)($_GET['code'] ?? ''));

        if ($paymentId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Parâmetro "id" do pagamento é obrigatório.']);
            exit;
        }

        $res = callMercadoPagoApi("https://api.mercadopago.com/v1/payments/{$paymentId}", 'GET', null, $accessToken);
        $paymentData = $res['data'] ?? [];
        $status = strtolower((string)($paymentData['status'] ?? 'pending'));
        $statusDetail = (string)($paymentData['status_detail'] ?? '');

        if ($status === 'approved' && $orderCode !== '') {
            updateOrderStatusInDatabase($orderCode, [
                'status' => 'pago',
                'paymentStatus' => 'approved',
                'paidAt' => $paymentData['date_approved'] ?? date('c'),
                'mercadopagoPaymentId' => $paymentId
            ]);
        }

        echo json_encode([
            'success' => true,
            'paymentId' => $paymentId,
            'status' => $status,
            'statusDetail' => $statusDetail,
            'isApproved' => ($status === 'approved')
        ]);
        exit;
    }

    // 2. Consulta de Parcelas do Cartão
    if ($action === 'installments') {
        $amount = parsePriceToFloat($_GET['amount'] ?? 0);
        $bin = preg_replace('/\D/', '', (string)($_GET['bin'] ?? ''));
        $paymentMethodId = trim((string)($_GET['payment_method_id'] ?? ''));

        if ($amount <= 0) $amount = 100.00;

        $url = MP_INSTALLMENTS_URL . "?amount={$amount}";
        if ($bin !== '') $url .= "&bin=" . substr($bin, 0, 6);
        if ($paymentMethodId !== '') $url .= "&payment_method_id={$paymentMethodId}";

        // Consulta Mercado Pago para verificar eventuais parcelas com taxa zero (sem juros oficial)
        $res = callMercadoPagoApi($url, 'GET', null, $accessToken);
        $livePayerCosts = ($res['httpCode'] === 200 && is_array($res['data']) && !empty($res['data'][0]['payer_costs']))
            ? $res['data'][0]['payer_costs']
            : null;

        // Tabela oficial alinhada com as taxas da loja (1x a 12x: 4.25% a 12.35%)
        $interestRates = [
            1 => 0.0,
            2 => 4.25,
            3 => 5.10,
            4 => 5.95,
            5 => 6.80,
            6 => 7.65,
            7 => 8.10,
            8 => 8.95,
            9 => 9.80,
            10 => 10.65,
            11 => 11.50,
            12 => 12.35
        ];

        $costs = [];
        for ($i = 1; $i <= 12; $i++) {
            $rate = $interestRates[$i] ?? 0.0;
            // Se o Mercado Pago indicar taxa 0 (parcelamento sem juros oficial), honra 0%
            if ($livePayerCosts) {
                foreach ($livePayerCosts as $lpc) {
                    if ((int)($lpc['installments'] ?? 0) === $i && (float)($lpc['installment_rate'] ?? 99) === 0.0) {
                        $rate = 0.0;
                        break;
                    }
                }
            }
            $total = $amount * (1 + ($rate / 100));
            $instAmount = round($total / $i, 2);
            $costs[] = [
                'installments' => $i,
                'installment_rate' => $rate,
                'installment_amount' => $instAmount,
                'total_amount' => round($total, 2),
                'recommended_message' => "{$i}x de R$ " . number_format($instAmount, 2, ',', '.') . ($rate == 0 ? " sem juros" : "")
            ];
        }

        echo json_encode([
            'success' => true,
            'payerCosts' => $costs
        ]);
        exit;
    }

    // 3. Consulta de Configurações
    // As credenciais completas (access token e segredo do webhook) só saem para o painel. Antes bastava
    // acrescentar ?admin na URL, sem nenhum login.
    $isAdmin = isset($_GET['admin']) || isset($_GET['full']);
    if ($isAdmin) {
        nte_require_admin();
        echo json_encode([
            'success' => true,
            'settings' => [
                'publicKey' => $settings['publicKey'] ?? '',
                'accessToken' => $settings['accessToken'] ?? '',
                'webhookSecret' => $settings['webhookSecret'] ?? '',
                'webhookUrl' => $settings['webhookUrl'] ?? 'https://nteleganz.com.br/api/mercadopago_webhook.php',
                'statementDescriptor' => $settings['statementDescriptor'] ?? 'NT ELEGANZ',
                'applePay' => $settings['applePay'] ?? [
                    'enabled' => false,
                    'merchantIdentifier' => 'merchant.com.nteleganz',
                    'certificatePublicHash' => '',
                    'domainName' => 'nteleganz.com.br',
                    'displayName' => 'NT Eleganz'
                ],
                'updatedAt' => $settings['updatedAt'] ?? null
            ]
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } else {
        $apConfig = $settings['applePay'] ?? [];
        echo json_encode([
            'success' => true,
            'publicKey' => $settings['publicKey'] ?? '',
            'webhookUrl' => $settings['webhookUrl'] ?? 'https://nteleganz.com.br/api/mercadopago_webhook.php',
            'applePay' => [
                'enabled' => !empty($apConfig['enabled']) && !empty($apConfig['certificatePublicHash']),
                'merchantIdentifier' => $apConfig['merchantIdentifier'] ?? 'merchant.com.nteleganz',
                'certificatePublicHash' => $apConfig['certificatePublicHash'] ?? '',
                'domainName' => $apConfig['domainName'] ?? 'nteleganz.com.br',
                'displayName' => $apConfig['displayName'] ?? 'NT Eleganz'
            ]
        ]);
    }
    exit;
}

// ── POST REQUESTS ──
$rawInput = file_get_contents('php://input');
$data = $rawInput ? json_decode($rawInput, true) : null;

if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Corpo da requisição deve ser um JSON válido.']);
    exit;
}

// Ação de Admin: Salvar Configurações
if (isset($data['action']) && $data['action'] === 'save_settings') {
    nte_require_admin();
    $current = readMercadoPagoSettings();
    $pub = trim((string)($data['publicKey'] ?? $current['publicKey']));
    $sec = trim((string)($data['accessToken'] ?? $current['accessToken']));
    $desc = trim((string)($data['statementDescriptor'] ?? $current['statementDescriptor']));
    // Campo do segredo vazio não apaga o que já está salvo (o HTML do painel não vem mais pré-preenchido)
    $webhookSecret = trim((string)($data['webhookSecret'] ?? ''));
    if ($webhookSecret === '') {
        $webhookSecret = trim((string)($current['webhookSecret'] ?? ''));
    }

    if ($pub === '' || $sec === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Public Key e Access Token são obrigatórios.']);
        exit;
    }

    $updated = array_merge($current, [
        'publicKey' => $pub,
        'accessToken' => $sec,
        'webhookSecret' => $webhookSecret,
        'statementDescriptor' => !empty($desc) ? mb_substr($desc, 0, 16) : 'NT ELEGANZ',
        'updatedAt' => date('c')
    ]);

    if (isset($data['applePay']) && is_array($data['applePay'])) {
        $updated['applePay'] = array_merge($current['applePay'] ?? [], $data['applePay']);
    }

    if (saveMercadoPagoSettings($updated)) {
        echo json_encode(['success' => true, 'message' => 'Credenciais do Mercado Pago salvas com sucesso.', 'settings' => $updated]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Falha ao gravar configurações do Mercado Pago no servidor.']);
    }
    exit;
}

// ── UTILITÁRIO 1: GERAR CSR APPLE PAY NO MERCADO PAGO ──
if (isset($data['action']) && $data['action'] === 'apple_pay_csr_generate') {
    nte_require_admin();
    $merchantId = trim((string)($data['merchantIdentifier'] ?? ($settings['applePay']['merchantIdentifier'] ?? 'merchant.com.nteleganz')));
    $org = trim((string)($data['organization'] ?? 'NT Eleganz'));

    $csrPayload = [
        'type' => 'merchant',
        'flow' => 'apple_pay',
        'merchantIdentifier' => $merchantId,
        'organization' => $org,
        'country' => 'BR'
    ];

    $res = callMercadoPagoApi('https://api.mercadopago.com/certificates/csr/generate', 'POST', $csrPayload, $accessToken);
    if ($res['httpCode'] >= 400 || empty($res['data'])) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'Falha ao gerar CSR na API do Mercado Pago.',
            'details' => $res['data'] ?? []
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => 'CSR gerado com sucesso pelo Mercado Pago. Salve o arquivo .pem e faça o upload no portal Apple Developer.',
        'data' => $res['data']
    ]);
    exit;
}

// ── UTILITÁRIO 2: UPLOAD DO CERTIFICADO ASSINADO DA APPLE NO MERCADO PAGO ──
if (isset($data['action']) && $data['action'] === 'apple_pay_cert_upload') {
    nte_require_admin();
    $certificateBase64 = trim((string)($data['certificate'] ?? ''));
    $certificateId = trim((string)($data['certificateId'] ?? ''));

    if ($certificateBase64 === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Certificado assinado (Base64) é obrigatório.']);
        exit;
    }

    $uploadPayload = [
        'certificate' => $certificateBase64
    ];
    if ($certificateId !== '') {
        $uploadPayload['certificate_id'] = $certificateId;
    }

    $res = callMercadoPagoApi('https://api.mercadopago.com/certificates/certificate/upload', 'POST', $uploadPayload, $accessToken);
    if ($res['httpCode'] >= 400 || empty($res['data'])) {
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => 'Falha ao fazer upload do certificado assinado no Mercado Pago.',
            'details' => $res['data'] ?? []
        ]);
        exit;
    }

    $publicHash = $res['data']['public_hash'] ?? $res['data']['id'] ?? '';
    if (!empty($publicHash)) {
        $settings['applePay']['certificatePublicHash'] = $publicHash;
        $settings['applePay']['enabled'] = true;
        $settings['updatedAt'] = date('c');
        saveMercadoPagoSettings($settings);
    }

    echo json_encode([
        'success' => true,
        'message' => 'Certificado Apple Pay vinculado com sucesso no Mercado Pago!',
        'publicHash' => $publicHash,
        'data' => $res['data']
    ]);
    exit;
}

// Ação: Gerar Token de Cartão via API Mercado Pago (Proxy seguro)
if (isset($data['action']) && $data['action'] === 'create_card_token') {
    $settings = readMercadoPagoSettings();
    $pub = $settings['publicKey'];
    $url = MP_CARD_TOKENS_URL . '?public_key=' . urlencode($pub);

    $cardPayload = [
        'card_number' => preg_replace('/\D/', '', (string)($data['cardNumber'] ?? '')),
        'cardholder' => [
            'name' => trim((string)($data['cardholderName'] ?? '')),
            'identification' => [
                'type' => 'CPF',
                'number' => preg_replace('/\D/', '', (string)($data['cpf'] ?? ''))
            ]
        ],
        'expiration_month' => (int)($data['expirationMonth'] ?? 0),
        'expiration_year' => (int)($data['expirationYear'] ?? 0),
        'security_code' => preg_replace('/\D/', '', (string)($data['securityCode'] ?? ''))
    ];

    $chToken = curl_init($url);
    curl_setopt_array($chToken, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($cardPayload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json']
    ]);
    $resToken = curl_exec($chToken);
    $codeToken = curl_getinfo($chToken, CURLINFO_HTTP_CODE);
    curl_close($chToken);

    $tokenData = $resToken ? json_decode($resToken, true) : null;
    if ($codeToken === 201 && !empty($tokenData['id'])) {
        echo json_encode(['success' => true, 'token' => $tokenData['id'], 'data' => $tokenData]);
    } else {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => $tokenData['message'] ?? 'Dados do cartão inválidos.', 'details' => $tokenData]);
    }
    exit;
}

$settings = readMercadoPagoSettings();
$accessToken = trim((string)($settings['accessToken'] ?? ''));

if ($accessToken === '') {
    http_response_code(500);
    echo json_encode(['error' => 'Access Token do Mercado Pago não configurado.']);
    exit;
}

$customer = $data['customer'] ?? [];
$items = $data['items'] ?? [];
$shipping = $data['shipping'] ?? null;
$action = $data['action'] ?? 'process_pix'; // 'process_pix' | 'process_card' | 'create_preference'

// Código do pedido
$orderCode = !empty($data['code']) ? strtoupper(ltrim((string)$data['code'], '#')) : 'NTE-' . rand(1000, 9999);
$displayCode = '#' . $orderCode;

// Calcula Total no Backend com Validação Estrita contra o Catálogo Oficial da Loja
$catalogMap = getCatalogProductsMap();
$itemsSubtotal = 0.0;
$validatedItems = [];

foreach ($items as $item) {
    $qty = max(1, (int)($item['qty'] ?? $item['quantity'] ?? 1));
    $itemId = (string)($item['id'] ?? $item['productId'] ?? '');

    // Blindagem de segurança: o preço oficial cadastrado no sistema SEMPRE prevalece sobre o frontend
    $unitPrice = 0.0;
    if ($itemId !== '' && isset($catalogMap[$itemId])) {
        $catProduct = $catalogMap[$itemId];

        // Verificação de Acesso Antecipado VIP
        $isVipExclusive = !empty($catProduct['isVipExclusive']) || !empty($catProduct['vipExclusive']);
        if ($isVipExclusive) {
            $duration = (string)($catProduct['vipReleaseDuration'] ?? '48');
            $isStillVip = false;
            if ($duration === 'forever') {
                $isStillVip = true;
            } elseif (!empty($catProduct['vipEarlyAccessUntil'])) {
                $untilTs = strtotime((string)$catProduct['vipEarlyAccessUntil']);
                if ($untilTs > time()) {
                    $isStillVip = true;
                }
            }
            if ($isStillVip) {
                $clientVipToken = trim((string)($data['vipToken'] ?? ($customer['vipToken'] ?? '')));
                $clientPhone = (string)($customer['phone'] ?? ($customer['whatsapp'] ?? ''));
                $clientEmail = (string)($customer['email'] ?? '');
                $clientInsta = (string)($customer['instagram'] ?? ($data['vipInstagram'] ?? ''));
                if (!isCustomerVip($clientVipToken, $clientPhone, $clientEmail, $clientInsta)) {
                    http_response_code(403);
                    echo json_encode([
                        'success' => false,
                        'error' => 'O produto "' . ($catProduct['name'] ?? 'exclusivo') . '" está em período de acesso exclusivo para membros NT VIP.',
                        'vipRequired' => true
                    ]);
                    exit;
                }
            }
        }

        $unitPrice = !empty($catProduct['priceNum']) ? (float)$catProduct['priceNum'] : parsePriceToFloat($catProduct['price'] ?? 0);
        $item['price'] = 'R$ ' . number_format($unitPrice, 2, ',', '.');
        $item['name'] = $catProduct['name'] ?? ($item['name'] ?? 'Produto NT Eleganz');
        if (!empty($catProduct['brand'])) {
            $item['brand'] = $catProduct['brand'];
        }
    } else {
        // Fallback apenas se o produto não for localizado pelo ID
        $unitPrice = parsePriceToFloat($item['price'] ?? 0);
    }

    if ($unitPrice <= 0) $unitPrice = 1.00;
    $itemsSubtotal += ($unitPrice * $qty);
    $validatedItems[] = $item;
}
$items = $validatedItems;

// Validação de frete contra a tabela oficial de métodos de envio
$effectiveShipping = 0.0;
if (is_array($shipping)) {
    $officialMethods = getOfficialShippingMethods();
    $shipId = (string)($shipping['id'] ?? '');
    $matchedMethod = null;
    foreach ($officialMethods as $m) {
        if (($m['id'] ?? '') === $shipId && !empty($m['active'])) {
            $matchedMethod = $m;
            break;
        }
    }

    if ($matchedMethod) {
        $isFree = !empty($matchedMethod['freeAbove']) && $itemsSubtotal >= (float)$matchedMethod['freeAbove'];
        $effectiveShipping = $isFree ? 0.0 : (float)($matchedMethod['price'] ?? 0);
        $shipping['price'] = $matchedMethod['price'];
        $shipping['name'] = $matchedMethod['name'];
        $shipping['effectivePrice'] = $effectiveShipping;
    } else {
        $isFree = !empty($shipping['freeAbove']) && $itemsSubtotal >= (float)$shipping['freeAbove'];
        if (!$isFree && (float)($shipping['price'] ?? 0) > 0) {
            $effectiveShipping = parsePriceToFloat($shipping['price']);
        }
    }
}

$totalAmount = round($itemsSubtotal + $effectiveShipping, 2);
if ($totalAmount <= 0) $totalAmount = 1.00;
$formattedTotal = 'R$ ' . number_format($totalAmount, 2, ',', '.');

// Dados do Pagador
$custName = trim((string)($customer['name'] ?? ''));
$nameParts = explode(' ', $custName, 2);
$firstName = $nameParts[0] ?: 'Cliente';
$lastName = $nameParts[1] ?? 'NT Eleganz';
$cleanCpf = preg_replace('/\D/', '', (string)($customer['cpf'] ?? ''));
$cleanPhone = preg_replace('/\D/', '', (string)($customer['phone'] ?? ''));
$areaCode = strlen($cleanPhone) >= 10 ? substr($cleanPhone, 0, 2) : '11';
$phoneNum = strlen($cleanPhone) >= 10 ? substr($cleanPhone, 2) : $cleanPhone;

$addr = is_array($customer['address'] ?? null) ? $customer['address'] : [];
$cleanCep = preg_replace('/\D/', '', (string)($addr['cep'] ?? ''));
$streetNumber = (int)preg_replace('/\D/', '', (string)($addr['number'] ?? '0')) ?: 1;

$payer = [
    'email' => trim((string)($customer['email'] ?? 'sac@nteleganz.com.br')),
    'first_name' => $firstName,
    'last_name' => $lastName,
    'phone' => [
        'area_code' => $areaCode,
        'number' => $phoneNum
    ],
    'address' => [
        'zip_code' => $cleanCep,
        'street_name' => trim((string)($addr['street'] ?? 'Endereço')),
        'street_number' => $streetNumber,
        'neighborhood' => trim((string)($addr['neighborhood'] ?? 'Bairro')),
        'city' => trim((string)($addr['city'] ?? 'São Paulo')),
        'federal_unit' => trim((string)($addr['state'] ?? 'SP'))
    ]
];

if (strlen($cleanCpf) === 11) {
    $payer['identification'] = [
        'type' => 'CPF',
        'number' => $cleanCpf
    ];
}

$webhookUrl = 'https://nteleganz.com.br/api/mercadopago_webhook.php';

// ── FLUXO 1: PROCESSAR PIX TRANSPARENTE ──
if ($action === 'process_pix') {
    $pixPayload = [
        'transaction_amount' => $totalAmount,
        'description' => "Pedido NT Eleganz {$displayCode}",
        'payment_method_id' => 'pix',
        'payer' => $payer,
        'external_reference' => $orderCode,
        'notification_url' => $webhookUrl,
        'statement_descriptor' => !empty($settings['statementDescriptor']) ? $settings['statementDescriptor'] : 'NT ELEGANZ'
    ];

    $idempotencyKey = 'pix-' . $orderCode . '-' . time();
    $res = callMercadoPagoApi(MP_PAYMENTS_URL, 'POST', $pixPayload, $accessToken, $idempotencyKey);
    $payData = $res['data'] ?? [];

    if ($res['httpCode'] >= 400 || empty($payData['id'])) {
        $msg = $payData['message'] ?? 'Erro ao processar Pix com o Mercado Pago.';
        $cause = $payData['cause'][0]['description'] ?? $payData['cause'][0]['code'] ?? '';

        // Detecta conta sem chave Pix cadastrada
        if (strpos($msg, 'key enabled for QR') !== false || strpos($cause, 'Financial Identity') !== false) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error_type' => 'pix_key_required',
                'error' => 'Chave Pix não cadastrada na conta do Mercado Pago.',
                'message' => 'Para ativar o Pix automático no checkout, o dono da conta deve cadastrar uma chave Pix no Mercado Pago (Área Pix > Minhas Chaves). Escolha a opção Cartão de Crédito ou finalize com o Concierge no WhatsApp.',
                'canPayCard' => true
            ]);
            exit;
        }

        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => $msg,
            'details' => $payData
        ]);
        exit;
    }

    $paymentId = (string)$payData['id'];
    $txData = $payData['point_of_interaction']['transaction_data'] ?? [];
    $qrCode = $txData['qr_code'] ?? '';
    $qrCodeBase64 = $txData['qr_code_base64'] ?? '';
    $ticketUrl = $txData['ticket_url'] ?? '';
    $status = strtolower((string)($payData['status'] ?? 'pending'));

    // Registra pedido
    $orderRecord = [
        'id' => 'ord_' . time() . '_' . substr(md5($orderCode), 0, 5),
        'code' => $displayCode,
        'status' => 'novo',
        'value' => $formattedTotal,
        'clientName' => $customer['name'] ?? '',
        'client' => !empty($customer['name']) ? $customer['name'] : 'Cliente do site',
        'phone' => $customer['phone'] ?? '',
        'email' => $customer['email'] ?? '',
        'customer' => $customer,
        'items' => $items,
        'shipping' => $shipping,
        'channel' => 'checkout',
        'paymentMethod' => 'pix',
        'paymentStatus' => $status,
        'mercadopagoPaymentId' => $paymentId,
        'pixQrCode' => $qrCode,
        'pixQrCodeBase64' => $qrCodeBase64,
        'ticketUrl' => $ticketUrl,
        'clientIp' => $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '',
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'createdAt' => date('c'),
        'updatedAt' => date('c')
    ];
    registerOrderInDatabase($orderRecord);

    echo json_encode([
        'success' => true,
        'paymentId' => $paymentId,
        'orderCode' => $orderCode,
        'displayCode' => $displayCode,
        'status' => $status,
        'qrCode' => $qrCode,
        'qrCodeBase64' => $qrCodeBase64,
        'ticketUrl' => $ticketUrl,
        'total' => $formattedTotal,
        'expiresAt' => $payData['date_of_expiration'] ?? null
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// ── FLUXO 2: PROCESSAR CARTÃO DE CRÉDITO TRANSPARENTE ──
if ($action === 'process_card') {
    $token = trim((string)($data['token'] ?? ''));
    $paymentMethodId = strtolower(trim((string)($data['paymentMethodId'] ?? 'visa')));
    $installments = max(1, (int)($data['installments'] ?? 1));
    $issuerId = !empty($data['issuerId']) ? (string)$data['issuerId'] : null;

    if ($token === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Token do cartão de crédito é obrigatório.']);
        exit;
    }

    $cardPayload = [
        'transaction_amount' => $totalAmount,
        'token' => $token,
        'description' => "Pedido NT Eleganz {$displayCode}",
        'installments' => $installments,
        'payment_method_id' => $paymentMethodId,
        'payer' => $payer,
        'external_reference' => $orderCode,
        'notification_url' => $webhookUrl,
        'statement_descriptor' => !empty($settings['statementDescriptor']) ? $settings['statementDescriptor'] : 'NT ELEGANZ'
    ];
    if ($issuerId) {
        $cardPayload['issuer_id'] = $issuerId;
    }

    $idempotencyKey = 'card-' . $orderCode . '-' . time();
    $res = callMercadoPagoApi(MP_PAYMENTS_URL, 'POST', $cardPayload, $accessToken, $idempotencyKey);
    $payData = $res['data'] ?? [];

    if ($res['httpCode'] >= 400 || empty($payData['id'])) {
        $errMsg = $payData['message'] ?? 'Falha ao processar pagamento com cartão.';
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => $errMsg,
            'details' => $payData
        ]);
        exit;
    }

    $paymentId = (string)$payData['id'];
    $status = strtolower((string)($payData['status'] ?? 'pending'));
    $statusDetail = (string)($payData['status_detail'] ?? '');
    $isApproved = ($status === 'approved');

    // Mapeia mensagens amigáveis de status
    $statusMessages = [
        'accredited' => 'Pagamento aprovado com sucesso!',
        'pending_contingency' => 'Pagamento em análise pelo Mercado Pago. Confirmação em instantes.',
        'pending_review_manual' => 'Pagamento em análise de segurança. Avisaremos por e-mail.',
        'cc_rejected_bad_filled_card_number' => 'Número do cartão incorreto.',
        'cc_rejected_bad_filled_date' => 'Data de validade incorreta.',
        'cc_rejected_bad_filled_other' => 'Dados do cartão incorretos.',
        'cc_rejected_bad_filled_security_code' => 'Código de segurança (CVV) inválido.',
        'cc_rejected_blacklist' => 'Pagamento não autorizado.',
        'cc_rejected_call_for_authorize' => 'Cartão não autorizado. Ligue para o banco emissor.',
        'cc_rejected_card_disabled' => 'Cartão bloqueado. Ligue para o banco emissor.',
        'cc_rejected_duplicated_payment' => 'Você já efetuou um pagamento semelhante recentemente.',
        'cc_rejected_high_risk' => 'Pagamento recusado por segurança.',
        'cc_rejected_insufficient_amount' => 'Saldo insuficiente no cartão.',
        'cc_rejected_invalid_installments' => 'Número de parcelas não suportado para este cartão.'
    ];
    $userMsg = $statusMessages[$statusDetail] ?? ($isApproved ? 'Pagamento aprovado!' : 'Pagamento não concluído. Verifique os dados ou tente outro cartão.');

    // Registra pedido
    $orderRecord = [
        'id' => 'ord_' . time() . '_' . substr(md5($orderCode), 0, 5),
        'code' => $displayCode,
        'status' => $isApproved ? 'pago' : 'novo',
        'value' => $formattedTotal,
        'clientName' => $customer['name'] ?? '',
        'client' => !empty($customer['name']) ? $customer['name'] : 'Cliente do site',
        'phone' => $customer['phone'] ?? '',
        'email' => $customer['email'] ?? '',
        'customer' => $customer,
        'items' => $items,
        'shipping' => $shipping,
        'channel' => 'checkout',
        'paymentMethod' => 'credit_card',
        'paymentMethodDetail' => 'cartao_' . $paymentMethodId,
        'paymentStatus' => $status,
        'statusDetail' => $statusDetail,
        'mercadopagoPaymentId' => $paymentId,
        'installments' => $installments,
        'paidAt' => $isApproved ? ($payData['date_approved'] ?? date('c')) : null,
        'clientIp' => $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '',
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
        'createdAt' => date('c'),
        'updatedAt' => date('c')
    ];
    registerOrderInDatabase($orderRecord);

    if ($isApproved) {
        try {
            require_once __DIR__ . '/send_order_email.php';
            sendOrderConfirmationEmail($orderRecord);
        } catch (\Throwable $e) {}

        try {
            require_once __DIR__ . '/tracking.php';
            sendMetaConversionsApiPurchase($orderRecord);
        } catch (\Throwable $e) {}
    }

    echo json_encode([
        'success' => $isApproved,
        'status' => $status,
        'statusDetail' => $statusDetail,
        'message' => $userMsg,
        'paymentId' => $paymentId,
        'orderCode' => $orderCode,
        'displayCode' => $displayCode,
        'total' => $formattedTotal
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// ── FLUXO 4: PROCESSAR APPLE PAY TRANSPARENTE ──
if ($action === 'process_apple_pay') {
    $token = trim((string)($data['token'] ?? ''));
    $paymentMethodId = strtolower(trim((string)($data['paymentMethodId'] ?? 'visa')));
    if ($token === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Token do Apple Pay é obrigatório.']);
        exit;
    }

    // Tenta primeiro via Orders API (recomendada oficialmente pelo Mercado Pago para Apple Pay)
    $ordersPayload = [
        'type' => 'online',
        'processing_mode' => 'automatic',
        'total_amount' => number_format($totalAmount, 2, '.', ''),
        'currency_id' => 'BRL',
        'external_reference' => $orderCode,
        'payer' => [
            'email' => $payer['email'] ?? 'cliente@nteleganz.com.br',
            'identification' => [
                'type' => 'CPF',
                'number' => preg_replace('/\D/', '', (string)($customer['cpf'] ?? '00000000000'))
            ]
        ],
        'transactions' => [
            'payments' => [
                [
                    'amount' => number_format($totalAmount, 2, '.', ''),
                    'payment_method' => [
                        'id' => $paymentMethodId,
                        'type' => 'credit_card',
                        'token' => $token,
                        'installments' => 1
                    ]
                ]
            ]
        ]
    ];

    $idempotencyKey = 'applepay-' . $orderCode . '-' . time();
    $res = callMercadoPagoApi('https://api.mercadopago.com/v1/orders', 'POST', $ordersPayload, $accessToken, $idempotencyKey);
    $payData = $res['data'] ?? [];

    // Fallback para Payments API caso necessário
    if ($res['httpCode'] >= 400 || empty($payData['id'])) {
        $paymentsPayload = [
            'transaction_amount' => $totalAmount,
            'token' => $token,
            'description' => "Pedido NT Eleganz {$displayCode} (Apple Pay)",
            'installments' => 1,
            'payment_method_id' => $paymentMethodId,
            'payer' => $payer,
            'external_reference' => $orderCode,
            'notification_url' => $webhookUrl,
            'statement_descriptor' => !empty($settings['statementDescriptor']) ? $settings['statementDescriptor'] : 'NT ELEGANZ'
        ];
        $res = callMercadoPagoApi(MP_PAYMENTS_URL, 'POST', $paymentsPayload, $accessToken, $idempotencyKey . '-fb');
        $payData = $res['data'] ?? [];
    }

    if ($res['httpCode'] >= 400 || empty($payData['id'])) {
        $errMsg = $payData['message'] ?? 'Falha ao processar pagamento com Apple Pay.';
        http_response_code(400);
        echo json_encode([
            'success' => false,
            'error' => $errMsg,
            'details' => $payData
        ]);
        exit;
    }

    $paymentId = (string)$payData['id'];
    $status = strtolower((string)($payData['status'] ?? 'pending'));
    $statusDetail = (string)($payData['status_detail'] ?? '');
    $isApproved = ($status === 'approved' || $status === 'authorized');

    // Registra pedido
    $orderRecord = [
        'id' => 'ord_' . time() . '_' . substr(md5($orderCode), 0, 5),
        'code' => $displayCode,
        'status' => $isApproved ? 'pago' : 'novo',
        'value' => $formattedTotal,
        'clientName' => $customer['name'] ?? '',
        'clientEmail' => $customer['email'] ?? '',
        'clientPhone' => $customer['phone'] ?? '',
        'clientCpf' => $customer['cpf'] ?? '',
        'shippingAddress' => $address,
        'shippingMethod' => $shipping['name'] ?? 'Frete Especial',
        'shippingCost' => number_format($effectiveShipping, 2, ',', '.'),
        'paymentMethod' => 'apple_pay',
        'paymentStatus' => $status,
        'paymentDetails' => [
            'provider' => 'mercadopago',
            'method' => 'apple_pay',
            'cardBrand' => $paymentMethodId,
            'paymentId' => $paymentId,
            'statusDetail' => $statusDetail,
            'installments' => 1
        ],
        'items' => $items,
        'createdAt' => date('c'),
        'paidAt' => $isApproved ? date('c') : null,
        'mercadopagoPaymentId' => $paymentId
    ];

    saveOrderToDatabase($orderRecord);

    if ($isApproved) {
        try {
            require_once __DIR__ . '/send_order_email.php';
            sendOrderConfirmationEmail($orderRecord);
        } catch (\Throwable $e) {}

        try {
            require_once __DIR__ . '/tracking.php';
            sendMetaConversionsApiPurchase($orderRecord);
        } catch (\Throwable $e) {}
    }

    echo json_encode([
        'success' => $isApproved,
        'status' => $status,
        'statusDetail' => $statusDetail,
        'message' => $isApproved ? 'Pagamento Apple Pay aprovado com sucesso!' : 'Pagamento Apple Pay em análise.',
        'paymentId' => $paymentId,
        'orderCode' => $orderCode,
        'displayCode' => $displayCode,
        'total' => $formattedTotal
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// ── FLUXO 3: CRIAR PREFERÊNCIA (FALLBACK CHECKOUT PRO) ──
$mpItems = [];
foreach ($items as $item) {
    $qty = max(1, (int)($item['qty'] ?? 1));
    $unitPrice = parsePriceToFloat($item['price'] ?? 0);
    if ($unitPrice <= 0) $unitPrice = 1.00;
    $descParts = array_filter([$item['brand'] ?? '', $item['name'] ?? 'Produto NT Eleganz']);
    $title = mb_substr(implode(' - ', $descParts), 0, 120);

    $mpItems[] = [
        'id' => (string)($item['id'] ?? uniqid('item_')),
        'title' => $title,
        'description' => $title,
        'quantity' => $qty,
        'unit_price' => $unitPrice,
        'currency_id' => 'BRL'
    ];
}
if ($effectiveShipping > 0) {
    $mpItems[] = [
        'id' => 'shipping_cost',
        'title' => 'Frete: ' . mb_substr($shipping['name'] ?? 'Frete Especial', 0, 50),
        'quantity' => 1,
        'unit_price' => $effectiveShipping,
        'currency_id' => 'BRL'
    ];
}

$prefPayload = [
    'items' => $mpItems,
    'payer' => $payer,
    'back_urls' => [
        'success' => "https://nteleganz.com.br/pedido/?code={$orderCode}&status=success",
        'failure' => "https://nteleganz.com.br/pedido/?code={$orderCode}&status=failure",
        'pending' => "https://nteleganz.com.br/pedido/?code={$orderCode}&status=pending"
    ],
    'auto_return' => 'approved',
    'notification_url' => $webhookUrl,
    'external_reference' => $orderCode,
    'statement_descriptor' => !empty($settings['statementDescriptor']) ? $settings['statementDescriptor'] : 'NT ELEGANZ'
];

$res = callMercadoPagoApi(MP_PREFERENCES_URL, 'POST', $prefPayload, $accessToken);
$resData = $res['data'] ?? [];
$checkoutUrl = $resData['init_point'] ?? null;

if (!$checkoutUrl || $res['httpCode'] >= 400) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Falha ao gerar sessão de pagamento no Mercado Pago.',
        'details' => $resData['message'] ?? 'Erro de comunicação'
    ]);
    exit;
}

echo json_encode([
    'success' => true,
    'orderCode' => $orderCode,
    'displayCode' => $displayCode,
    'checkoutUrl' => $checkoutUrl,
    'total' => $formattedTotal
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
