<?php
/**
 * NT Eleganz — Integração de Checkout Seguro InfinitePay
 * Cria o pedido, registra a sessão na API da InfinitePay e dispara confirmação por e-mail
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/send_order_email.php';
require_once __DIR__ . '/lib/vip_auth.php';

const INFINITE_API_KEY = 'inchk_NN5xxnfdy3fprsmHaHcIOgXVqP2GfE6_pUcseRD7JBQ';
const INFINITE_HANDLE = 'nteleganz';
const INFINITE_LINKS_URL = 'https://api.checkout.infinitepay.io/links';

function parsePriceToCents($price): int {
    if (is_numeric($price)) {
        return (int)round((float)$price * 100);
    }
    $cleaned = preg_replace('/[^\d,.]/', '', (string)$price);
    // Se formato brasileiro: 1.250,00 -> 1250.00
    if (strpos($cleaned, ',') !== false) {
        $cleaned = str_replace('.', '', $cleaned);
        $cleaned = str_replace(',', '.', $cleaned);
    }
    return (int)round(((float)$cleaned) * 100);
}

function getInfiniteCatalogMap(): array {
    $productsFile = __DIR__ . '/../data/products.json';
    if (!file_exists($productsFile)) return [];
    $raw = @file_get_contents($productsFile);
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    if (!is_array($data) || empty($data['products']) || !is_array($data['products'])) return [];

    $map = [];
    foreach ($data['products'] as $p) {
        if (!empty($p['id'])) $map[(string)$p['id']] = $p;
        if (!empty($p['slug'])) $map[(string)$p['slug']] = $p;
    }
    return $map;
}

/** É membro VIP ativo? Só o token prova (ver lib/vip_auth.php). */
function isCustomerVipInfinite(?string $token, ?string $phone = null, ?string $email = null, ?string $instagram = null): bool {
    return nte_vip_token_is_valid($token);
}

$rawInput = file_get_contents('php://input');
$data = $rawInput ? json_decode($rawInput, true) : null;

if (!is_array($data) || empty($data['items']) || empty($data['customer'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Dados incompletos. Forneça "items" e "customer".']);
    exit;
}

$customer = $data['customer'];
$items = $data['items'];
$shipping = $data['shipping'] ?? null;

// Garante código único amigável do pedido
$orderCode = !empty($data['code']) ? strtoupper(ltrim((string)$data['code'], '#')) : 'NTE-' . rand(1000, 9999);
$displayCode = '#' . $orderCode;

// Monta lista de itens para a API da InfinitePay com validação estrita no catálogo
$infiniteCatalog = getInfiniteCatalogMap();
$infiniteItems = [];
$totalCents = 0;

// Membro VIP (token válido) paga o preço com o desconto VIP de cada produto — decidido no servidor.
$buyerIsVip = nte_vip_token_is_valid(trim((string)($data['vipToken'] ?? ($customer['vipToken'] ?? ''))));

foreach ($items as $item) {
    $qty = max(1, (int)($item['qty'] ?? 1));
    $itemId = (string)($item['id'] ?? $item['productId'] ?? '');

    // Preço oficial do banco de dados tem precedência absoluta
    if ($itemId !== '' && isset($infiniteCatalog[$itemId])) {
        $catProduct = $infiniteCatalog[$itemId];

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
                $clientPhone = (string)($customer['phone'] ?? '');
                $clientEmail = (string)($customer['email'] ?? '');
                $clientInsta = (string)($customer['instagram'] ?? ($data['vipInstagram'] ?? ''));
                if (!isCustomerVipInfinite($clientVipToken, $clientPhone, $clientEmail, $clientInsta)) {
                    http_response_code(403);
                    echo json_encode([
                        'error' => 'O produto "' . ($catProduct['name'] ?? 'exclusivo') . '" está em período de acesso exclusivo para membros NT VIP.',
                        'vipRequired' => true
                    ]);
                    exit;
                }
            }
        }

        $unitPriceCents = !empty($catProduct['priceNum']) ? (int)round((float)$catProduct['priceNum'] * 100) : parsePriceToCents($catProduct['price'] ?? 0);
        // Desconto VIP só no item que veio da Coleção VIP (vipPricing) E com token válido.
        if ($buyerIsVip && !empty($item['vipPricing']) && nte_vip_discount_percent($catProduct) > 0) {
            $unitPriceCents = (int)round(nte_vip_apply_discount($unitPriceCents / 100, $catProduct) * 100);
        }
        $item['name'] = $catProduct['name'] ?? ($item['name'] ?? 'Produto NT Eleganz');
        if (!empty($catProduct['brand'])) $item['brand'] = $catProduct['brand'];
    } else {
        $unitPriceCents = parsePriceToCents($item['price'] ?? 0);
    }

    if ($unitPriceCents <= 0) $unitPriceCents = 100; // Mínimo 1 real

    $descParts = [];
    if (!empty($item['brand'])) $descParts[] = $item['brand'];
    $descParts[] = $item['name'] ?? 'Produto NT Eleganz';
    if (!empty($item['size'])) $descParts[] = '(' . $item['size'] . ')';
    if (!empty($item['color'])) $descParts[] = '[' . $item['color'] . ']';

    $desc = implode(' ', $descParts);
    if (mb_strlen($desc) > 80) $desc = mb_substr($desc, 0, 77) . '...';

    $infiniteItems[] = [
        'name' => mb_substr($item['name'] ?? 'Produto NT Eleganz', 0, 80),
        'quantity' => $qty,
        'price' => $unitPriceCents,
        'description' => $desc
    ];
    $totalCents += ($unitPriceCents * $qty);
}

// Adiciona frete selecionado se houver valor
if (is_array($shipping) && !empty($shipping['price']) && (float)$shipping['price'] > 0) {
    $shippingCents = (int)round((float)$shipping['price'] * 100);
    $shipName = $shipping['name'] ?? 'Frete Especial Segurado';
    $infiniteItems[] = [
        'name' => 'Frete: ' . mb_substr($shipName, 0, 50),
        'quantity' => 1,
        'price' => $shippingCents,
        'description' => 'Frete: ' . mb_substr($shipName, 0, 60)
    ];
    $totalCents += $shippingCents;
}

// Formata telefone para o padrão E.164 exigido pela InfinitePay (+55...)
$rawPhone = preg_replace('/\D/', '', (string)($customer['phone'] ?? ''));
if (strlen($rawPhone) === 10 || strlen($rawPhone) === 11) {
    $formattedPhone = '+55' . $rawPhone;
} elseif (strlen($rawPhone) > 11) {
    $formattedPhone = '+' . $rawPhone;
} else {
    $formattedPhone = '';
}

$infiniteCustomer = [
    'name' => trim((string)($customer['name'] ?? '')),
    'email' => trim((string)($customer['email'] ?? ''))
];
if ($formattedPhone !== '') {
    $infiniteCustomer['phone_number'] = $formattedPhone;
}

// Endereço de entrega para pré-preenchimento
$addr = is_array($customer['address'] ?? null) ? $customer['address'] : [];
$cleanCep = preg_replace('/\D/', '', (string)($addr['cep'] ?? ''));

$infiniteAddress = [
    'cep' => $cleanCep,
    'street' => trim((string)($addr['street'] ?? '')),
    'neighborhood' => trim((string)($addr['neighborhood'] ?? '')),
    'number' => trim((string)($addr['number'] ?? '')),
    'complement' => trim((string)($addr['complement'] ?? '')),
    'city' => trim((string)($addr['city'] ?? '')),
    'state' => strtoupper(trim((string)($addr['state'] ?? '')))
];

$redirectUrl = "https://nteleganz.com.br/pedido/?code={$orderCode}";
$webhookUrl = "https://nteleganz.com.br/api/infinitepay_webhook.php";

$payload = [
    'handle' => INFINITE_HANDLE,
    'items' => $infiniteItems,
    'order_nsu' => $orderCode,
    'order_id' => $orderCode,
    'redirect_url' => $redirectUrl,
    'webhook_url' => $webhookUrl,
    'customer' => $infiniteCustomer,
    'address' => $infiniteAddress
];

// Chamada para a API Oficial da InfinitePay
$ch = curl_init(INFINITE_LINKS_URL);
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . INFINITE_API_KEY
    ]
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$resData = $response ? json_decode($response, true) : null;
$checkoutUrl = $resData['url'] ?? null;

if (!$checkoutUrl || $httpCode >= 400) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Falha ao gerar checkout na InfinitePay.',
        'details' => $resData['message'] ?? $resData['error'] ?? 'Erro desconhecido'
    ]);
    exit;
}

// Salva o pedido localmente e na VPS como 'novo' / 'pending'
$formattedTotal = 'R$ ' . number_format($totalCents / 100, 2, ',', '.');
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
    'paymentMethod' => 'infinitepay',
    'paymentStatus' => 'pending',
    'checkoutUrl' => $checkoutUrl,
    'tracking' => is_array($data['tracking'] ?? null) ? $data['tracking'] : [],
    'clientIp' => $_SERVER['HTTP_CF_CONNECTING_IP'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '',
    'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? '',
    'createdAt' => date('c'),
    'updatedAt' => date('c')
];

// Grava no endpoint de pedidos
$chOrder = curl_init('https://nteleganz.com.br/api/orders.php');
curl_setopt_array($chOrder, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($orderRecord),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 4,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json']
]);
@curl_exec($chOrder);
@curl_close($chOrder);

// Nota: o e-mail de confirmação é disparado exclusivamente pelo webhook após a aprovação do pagamento.

echo json_encode([
    'success' => true,
    'orderCode' => $orderCode,
    'displayCode' => $displayCode,
    'checkoutUrl' => $checkoutUrl,
    'total' => $formattedTotal
]);
