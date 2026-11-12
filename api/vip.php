<?php
/**
 * NT Eleganz — VIP Area & Subscription Management API
 * Gerencia planos, configurações, assinaturas e acesso antecipado VIP com segurança estrita no backend.
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

const VIP_SETTINGS_FILE = __DIR__ . '/../data/vip_settings.json';
const VIP_SUBSCRIPTIONS_FILE = __DIR__ . '/../data/vip_subscriptions.json';
const MP_SETTINGS_FILE = __DIR__ . '/../data/mercadopago_settings.json';
const MP_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments';

function defaultVipSettings(): array {
    return [
        'enabled' => true,
        'monthlyPrice' => 29.90,
        'lifetimePrice' => 69.90,
        'vipCouponCode' => 'VIP10',
        'vipCouponDiscount' => 10,
        'whatsappGroupLink' => 'https://chat.whatsapp.com/invite/nteleganz-vip',
        'defaultEarlyAccessHours' => 48,
        'title' => 'NT ELEGANZ VIP',
        'subtitle' => 'A comunidade de quem garimpa antes. Peças raras primeiro pra você, descontos exclusivos e um grupo fechado de achados.',
        'updatedAt' => date('c')
    ];
}

function readVipSettings(): array {
    if (!file_exists(VIP_SETTINGS_FILE)) {
        $defaults = defaultVipSettings();
        @file_put_contents(VIP_SETTINGS_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        return $defaults;
    }
    $raw = @file_get_contents(VIP_SETTINGS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    return is_array($data) ? array_merge(defaultVipSettings(), $data) : defaultVipSettings();
}

function saveVipSettings(array $settings): bool {
    $settings['updatedAt'] = date('c');
    $payload = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return (bool)@file_put_contents(VIP_SETTINGS_FILE, $payload, LOCK_EX);
}

function readVipSubscriptions(): array {
    if (!file_exists(VIP_SUBSCRIPTIONS_FILE)) {
        return [];
    }
    $raw = @file_get_contents(VIP_SUBSCRIPTIONS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    return (is_array($data) && isset($data['subscriptions']) && is_array($data['subscriptions']))
        ? $data['subscriptions']
        : [];
}

function saveVipSubscriptions(array $subs): bool {
    $payload = json_encode([
        'updatedAt' => date('c'),
        'count' => count($subs),
        'subscriptions' => $subs
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return (bool)@file_put_contents(VIP_SUBSCRIPTIONS_FILE, $payload, LOCK_EX);
}

function getMercadoPagoAccessToken(): string {
    if (file_exists(MP_SETTINGS_FILE)) {
        $raw = @file_get_contents(MP_SETTINGS_FILE);
        $data = $raw ? @json_decode($raw, true) : null;
        if (is_array($data) && !empty($data['accessToken'])) {
            return (string)$data['accessToken'];
        }
    }
    return 'APP_USR-4148777530483800-110522-7c2732adbccc669d7ba002abde4ccd4c-662355896';
}

function callMercadoPago(string $url, string $method, ?array $body, string $accessToken): array {
    $ch = curl_init($url);
    $headers = [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $accessToken
    ];
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 12);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        }
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = $response ? json_decode($response, true) : null;
    return [
        'httpCode' => $httpCode,
        'data' => is_array($decoded) ? $decoded : []
    ];
}

$action = strtolower(trim((string)($_GET['action'] ?? '')));
$method = $_SERVER['REQUEST_METHOD'];

// ── 1. CONFIGURAÇÕES PÚBLICAS (Para a landing page / modal) ──
if ($action === 'settings' || ($action === '' && $method === 'GET')) {
    $settings = readVipSettings();
    echo json_encode([
        'success' => true,
        'enabled' => !empty($settings['enabled']),
        'monthlyPrice' => (float)($settings['monthlyPrice'] ?? 29.90),
        'lifetimePrice' => (float)($settings['lifetimePrice'] ?? 69.90),
        'defaultEarlyAccessHours' => (int)($settings['defaultEarlyAccessHours'] ?? 48),
        'title' => (string)($settings['title'] ?? 'NT ELEGANZ VIP'),
        'subtitle' => (string)($settings['subtitle'] ?? 'A comunidade de quem garimpa antes.')
    ]);
    exit;
}

// ── 2. CONFIGURAÇÕES ADMINISTRATIVAS (Somente Admin) ──
if ($action === 'admin_settings') {
    if (!nte_is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso não autorizado. Faça login no painel.']);
        exit;
    }
    $settings = readVipSettings();
    echo json_encode([
        'success' => true,
        'settings' => $settings
    ]);
    exit;
}

// ── 3. SALVAR CONFIGURAÇÕES (Somente Admin) ──
if ($action === 'save_settings' && $method === 'POST') {
    if (!nte_is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso não autorizado. Faça login no painel.']);
        exit;
    }

    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;
    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Dados inválidos.']);
        exit;
    }

    $current = readVipSettings();
    $monthlyPrice = isset($input['monthlyPrice']) ? (float)$input['monthlyPrice'] : (float)$current['monthlyPrice'];
    $lifetimePrice = isset($input['lifetimePrice']) ? (float)$input['lifetimePrice'] : (float)$current['lifetimePrice'];

    if ($monthlyPrice <= 0 || $lifetimePrice <= 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Os valores do plano mensal e vitalício devem ser maiores que zero.']);
        exit;
    }

    $updated = [
        'enabled' => isset($input['enabled']) ? (bool)$input['enabled'] : $current['enabled'],
        'monthlyPrice' => round($monthlyPrice, 2),
        'lifetimePrice' => round($lifetimePrice, 2),
        'vipCouponCode' => strtoupper(trim((string)($input['vipCouponCode'] ?? $current['vipCouponCode']))),
        'vipCouponDiscount' => max(0, (float)($input['vipCouponDiscount'] ?? $current['vipCouponDiscount'])),
        'whatsappGroupLink' => trim((string)($input['whatsappGroupLink'] ?? $current['whatsappGroupLink'])),
        'defaultEarlyAccessHours' => max(1, (int)($input['defaultEarlyAccessHours'] ?? $current['defaultEarlyAccessHours'])),
        'title' => trim((string)($input['title'] ?? $current['title'])),
        'subtitle' => trim((string)($input['subtitle'] ?? $current['subtitle'])),
        'updatedAt' => date('c')
    ];

    saveVipSettings($updated);

    echo json_encode([
        'success' => true,
        'message' => 'Configurações da Área VIP salvas com sucesso!',
        'settings' => $updated
    ]);
    exit;
}

// ── 4. ASSINATURA VIP (Processamento Seguro com Valor Calculado no Backend) ──
if ($action === 'subscribe' && $method === 'POST') {
    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Requisição inválida.']);
        exit;
    }

    $plan = strtolower(trim((string)($input['plan'] ?? 'monthly')));
    if ($plan !== 'monthly' && $plan !== 'lifetime') {
        $plan = 'monthly';
    }

    $customer = $input['customer'] ?? [];
    $custName = trim((string)($customer['name'] ?? ''));
    $custEmail = strtolower(trim((string)($customer['email'] ?? '')));
    $custPhone = trim((string)($customer['phone'] ?? ''));
    $custCpf = preg_replace('/\D/', '', (string)($customer['cpf'] ?? ''));

    if ($custName === '' || $custPhone === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Por favor, informe seu nome e WhatsApp.']);
        exit;
    }

    // BLINDAGEM DE PREÇO NO BACKEND:
    // O valor cobrado é LIDO E CALCULADO ESTRITAMENTE do arquivo oficial de configurações do servidor!
    // NENHUM valor enviado pelo frontend é considerado.
    $settings = readVipSettings();
    if (empty($settings['enabled'])) {
        http_response_code(400);
        echo json_encode(['error' => 'A Área VIP está temporariamente indisponível para novas assinaturas.']);
        exit;
    }

    $amount = ($plan === 'lifetime')
        ? (float)$settings['lifetimePrice']
        : (float)$settings['monthlyPrice'];

    if ($amount <= 0) $amount = 29.90;
    $amount = round($amount, 2);

    $paymentMethod = strtolower(trim((string)($input['paymentMethod'] ?? 'pix'))); // 'pix' ou 'card'
    $token = trim((string)($input['token'] ?? ''));
    $paymentMethodId = strtolower(trim((string)($input['paymentMethodId'] ?? 'visa')));
    $installments = max(1, (int)($input['installments'] ?? 1));

    $subCode = 'VIP-' . rand(1000, 9999) . '-' . substr(md5(uniqid()), 0, 4);
    $subId = 'sub_' . time() . '_' . substr(md5(uniqid()), 0, 6);
    $accessToken = getMercadoPagoAccessToken();
    $webhookUrl = 'https://nteleganz.com.br/api/mercadopago_webhook.php';

    $cleanPhoneDigits = preg_replace('/\D/', '', $custPhone);
    $areaCode = strlen($cleanPhoneDigits) >= 10 ? substr($cleanPhoneDigits, 0, 2) : '11';
    $phoneNum = strlen($cleanPhoneDigits) >= 10 ? substr($cleanPhoneDigits, 2) : $cleanPhoneDigits;

    $payer = [
        'email' => $custEmail ?: 'cliente@nteleganz.com.br',
        'first_name' => explode(' ', $custName)[0],
        'last_name' => explode(' ', $custName)[1] ?? 'VIP',
        'phone' => [
            'area_code' => $areaCode,
            'number' => $phoneNum
        ]
    ];
    if ($custCpf !== '') {
        $payer['identification'] = [
            'type' => 'CPF',
            'number' => $custCpf
        ];
    }

    $planLabel = ($plan === 'lifetime') ? 'Vitalício' : 'Mensal';
    $description = "Assinatura NT VIP ({$planLabel}) - {$custName}";

    if ($paymentMethod === 'pix') {
        $pixPayload = [
            'transaction_amount' => $amount,
            'description' => $description,
            'payment_method_id' => 'pix',
            'payer' => $payer,
            'external_reference' => $subCode,
            'notification_url' => $webhookUrl,
            'statement_descriptor' => 'NT VIP'
        ];

        $res = callMercadoPago(MP_PAYMENTS_URL, 'POST', $pixPayload, $accessToken);
        $payData = $res['data'] ?? [];

        if ($res['httpCode'] >= 400 || empty($payData['id'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => $payData['message'] ?? 'Erro ao gerar Pix do plano VIP.'
            ]);
            exit;
        }

        $paymentId = (string)$payData['id'];
        $poi = $payData['point_of_interaction']['transaction_data'] ?? [];
        $qrCode = $poi['qr_code'] ?? '';
        $qrCodeBase64 = $poi['qr_code_base64'] ?? '';
        $ticketUrl = $poi['ticket_url'] ?? '';

        // Registra assinatura pendente
        $newSub = [
            'id' => $subId,
            'subCode' => $subCode,
            'customer' => [
                'name' => $custName,
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => $custCpf
            ],
            'plan' => $plan,
            'amount' => $amount,
            'paymentMethod' => 'pix',
            'status' => 'pending',
            'mercadopagoPaymentId' => $paymentId,
            'vipToken' => null,
            'startedAt' => null,
            'expiresAt' => null,
            'createdAt' => date('c'),
            'updatedAt' => date('c')
        ];

        $allSubs = readVipSubscriptions();
        $allSubs[] = $newSub;
        saveVipSubscriptions($allSubs);

        echo json_encode([
            'success' => true,
            'isApproved' => false,
            'paymentMethod' => 'pix',
            'subCode' => $subCode,
            'paymentId' => $paymentId,
            'amount' => $amount,
            'amountFormatted' => 'R$ ' . number_format($amount, 2, ',', '.'),
            'qrCode' => $qrCode,
            'qrCodeBase64' => $qrCodeBase64,
            'ticketUrl' => $ticketUrl
        ]);
        exit;
    }

    if ($paymentMethod === 'card') {
        if ($token === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Token do cartão de crédito obrigatório.']);
            exit;
        }

        $cardPayload = [
            'transaction_amount' => $amount,
            'token' => $token,
            'description' => $description,
            'installments' => $installments,
            'payment_method_id' => $paymentMethodId,
            'payer' => $payer,
            'external_reference' => $subCode,
            'notification_url' => $webhookUrl,
            'statement_descriptor' => 'NT VIP'
        ];

        $res = callMercadoPago(MP_PAYMENTS_URL, 'POST', $cardPayload, $accessToken);
        $payData = $res['data'] ?? [];

        if ($res['httpCode'] >= 400 || empty($payData['id'])) {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => $payData['message'] ?? 'Falha ao processar cartão para o plano VIP.',
                'details' => $payData
            ]);
            exit;
        }

        $paymentId = (string)$payData['id'];
        $mpStatus = strtolower((string)($payData['status'] ?? 'pending'));
        $isApproved = ($mpStatus === 'approved');

        $vipToken = bin2hex(random_bytes(24));
        $now = date('c');
        $expiresAt = ($plan === 'lifetime') ? null : date('c', strtotime('+30 days'));

        $newSub = [
            'id' => $subId,
            'subCode' => $subCode,
            'customer' => [
                'name' => $custName,
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => $custCpf
            ],
            'plan' => $plan,
            'amount' => $amount,
            'paymentMethod' => 'credit_card',
            'status' => $isApproved ? 'active' : ($mpStatus === 'rejected' ? 'rejected' : 'pending'),
            'mercadopagoPaymentId' => $paymentId,
            'vipToken' => $isApproved ? $vipToken : null,
            'startedAt' => $isApproved ? $now : null,
            'expiresAt' => $isApproved ? $expiresAt : null,
            'createdAt' => $now,
            'updatedAt' => $now
        ];

        $allSubs = readVipSubscriptions();
        $allSubs[] = $newSub;
        saveVipSubscriptions($allSubs);

        echo json_encode([
            'success' => true,
            'isApproved' => $isApproved,
            'status' => $mpStatus,
            'paymentMethod' => 'credit_card',
            'subCode' => $subCode,
            'vipToken' => $isApproved ? $vipToken : null,
            'whatsappGroupLink' => $isApproved ? $settings['whatsappGroupLink'] : null,
            'vipCouponCode' => $isApproved ? $settings['vipCouponCode'] : null,
            'expiresAt' => $expiresAt
        ]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Método de pagamento não suportado.']);
    exit;
}

// ── 5. CONSULTA DE STATUS DO PAGAMENTO (Polling do Pix) ──
if ($action === 'check_payment') {
    $paymentId = trim((string)($_GET['id'] ?? ''));
    $subCode = trim((string)($_GET['code'] ?? ''));

    if ($paymentId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'ID do pagamento não informado.']);
        exit;
    }

    $accessToken = getMercadoPagoAccessToken();
    $res = callMercadoPago("https://api.mercadopago.com/v1/payments/{$paymentId}", 'GET', null, $accessToken);
    $payData = $res['data'] ?? [];
    $mpStatus = strtolower((string)($payData['status'] ?? ''));
    $isApproved = ($mpStatus === 'approved');

    if ($isApproved) {
        $settings = readVipSettings();
        $allSubs = readVipSubscriptions();
        $found = false;
        $matchedSub = null;

        foreach ($allSubs as &$s) {
            if ($s['mercadopagoPaymentId'] === $paymentId || ($subCode !== '' && $s['subCode'] === $subCode)) {
                if ($s['status'] !== 'active') {
                    $s['status'] = 'active';
                    $s['vipToken'] = bin2hex(random_bytes(24));
                    $s['startedAt'] = date('c');
                    $s['expiresAt'] = ($s['plan'] === 'lifetime') ? null : date('c', strtotime('+30 days'));
                    $s['updatedAt'] = date('c');
                }
                $matchedSub = $s;
                $found = true;
                break;
            }
        }
        unset($s);

        if ($found) {
            saveVipSubscriptions($allSubs);
        }

        echo json_encode([
            'success' => true,
            'isApproved' => true,
            'status' => 'approved',
            'vipToken' => $matchedSub['vipToken'] ?? '',
            'plan' => $matchedSub['plan'] ?? 'monthly',
            'whatsappGroupLink' => $settings['whatsappGroupLink'],
            'vipCouponCode' => $settings['vipCouponCode'],
            'expiresAt' => $matchedSub['expiresAt'] ?? null
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'isApproved' => false,
        'status' => $mpStatus ?: 'pending'
    ]);
    exit;
}

// ── 6. VERIFICAÇÃO DE MEMBRO VIP ATIVO (Sessão do Cliente) ──
if ($action === 'check_member') {
    $token = trim((string)($_GET['token'] ?? ''));
    $phone = preg_replace('/\D/', '', (string)($_GET['phone'] ?? ''));
    $email = strtolower(trim((string)($_GET['email'] ?? '')));

    if ($token === '' && $phone === '' && $email === '') {
        echo json_encode(['isVip' => false]);
        exit;
    }

    $allSubs = readVipSubscriptions();
    $now = time();
    $activeSub = null;

    foreach ($allSubs as $s) {
        if ($s['status'] !== 'active') continue;

        // Verifica validade (se não for vitalício)
        if (!empty($s['expiresAt'])) {
            $exp = strtotime($s['expiresAt']);
            if ($exp < $now) continue; // Expirado
        }

        $matchToken = ($token !== '' && !empty($s['vipToken']) && hash_equals($s['vipToken'], $token));
        $sPhone = preg_replace('/\D/', '', (string)($s['customer']['phone'] ?? ''));
        $matchPhone = ($phone !== '' && strlen($phone) >= 8 && substr($sPhone, -8) === substr($phone, -8));
        $sEmail = strtolower(trim((string)($s['customer']['email'] ?? '')));
        $matchEmail = ($email !== '' && $sEmail === $email);

        if ($matchToken || $matchPhone || $matchEmail) {
            $activeSub = $s;
            break;
        }
    }

    if ($activeSub) {
        $settings = readVipSettings();
        echo json_encode([
            'isVip' => true,
            'plan' => $activeSub['plan'] ?? 'monthly',
            'name' => $activeSub['customer']['name'] ?? 'Membro VIP',
            'startedAt' => $activeSub['startedAt'],
            'expiresAt' => $activeSub['expiresAt'],
            'whatsappGroupLink' => $settings['whatsappGroupLink'],
            'vipCouponCode' => $settings['vipCouponCode'],
            'vipCouponDiscount' => $settings['vipCouponDiscount']
        ]);
        exit;
    }

    echo json_encode(['isVip' => false]);
    exit;
}

// ── 7. LISTAGEM DE MEMBROS VIP (Somente Admin) ──
if ($action === 'list_members') {
    if (!nte_is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso não autorizado.']);
        exit;
    }

    $subs = readVipSubscriptions();
    $now = time();
    $activeCount = 0;
    $totalRevenue = 0.0;
    $monthlyCount = 0;
    $lifetimeCount = 0;

    foreach ($subs as &$s) {
        $isActive = ($s['status'] === 'active');
        if ($isActive && !empty($s['expiresAt'])) {
            if (strtotime($s['expiresAt']) < $now) {
                $isActive = false;
                $s['status'] = 'expired';
            }
        }
        if ($isActive) {
            $activeCount++;
            if ($s['plan'] === 'lifetime') $lifetimeCount++;
            else $monthlyCount++;
        }
        if ($s['status'] === 'active' || !empty($s['startedAt'])) {
            $totalRevenue += (float)($s['amount'] ?? 0);
        }
    }
    unset($s);

    echo json_encode([
        'success' => true,
        'kpis' => [
            'totalMembers' => count($subs),
            'activeMembers' => $activeCount,
            'monthlyMembers' => $monthlyCount,
            'lifetimeMembers' => $lifetimeCount,
            'totalRevenue' => round($totalRevenue, 2)
        ],
        'members' => array_reverse($subs)
    ]);
    exit;
}

// ── 8. ATIVAÇÃO / CANCELAMENTO MANUAL DE MEMBRO (Somente Admin) ──
if ($action === 'toggle_member' && $method === 'POST') {
    if (!nte_is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso não autorizado.']);
        exit;
    }

    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;
    $subId = trim((string)($input['id'] ?? ''));
    $newStatus = trim((string)($input['status'] ?? 'active')); // 'active' ou 'cancelled'

    $allSubs = readVipSubscriptions();
    $found = false;

    foreach ($allSubs as &$s) {
        if ($s['id'] === $subId) {
            $s['status'] = $newStatus;
            $s['updatedAt'] = date('c');
            if ($newStatus === 'active') {
                if (empty($s['vipToken'])) $s['vipToken'] = bin2hex(random_bytes(24));
                if (empty($s['startedAt'])) $s['startedAt'] = date('c');
                $s['expiresAt'] = ($s['plan'] === 'lifetime') ? null : date('c', strtotime('+30 days'));
            }
            $found = true;
            break;
        }
    }
    unset($s);

    if (!$found && !empty($input['manualAdd'])) {
        // Criando membro manualmente pelo admin
        $custName = trim((string)($input['name'] ?? 'Cliente VIP'));
        $custPhone = trim((string)($input['phone'] ?? ''));
        $custEmail = trim((string)($input['email'] ?? ''));
        $plan = ($input['plan'] === 'lifetime') ? 'lifetime' : 'monthly';

        $allSubs[] = [
            'id' => 'sub_manual_' . time(),
            'subCode' => 'VIP-MANUAL-' . rand(1000, 9999),
            'customer' => [
                'name' => $custName,
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => ''
            ],
            'plan' => $plan,
            'amount' => 0.0,
            'paymentMethod' => 'manual_admin',
            'status' => 'active',
            'mercadopagoPaymentId' => 'manual',
            'vipToken' => bin2hex(random_bytes(24)),
            'startedAt' => date('c'),
            'expiresAt' => ($plan === 'lifetime') ? null : date('c', strtotime('+30 days')),
            'createdAt' => date('c'),
            'updatedAt' => date('c')
        ];
        $found = true;
    }

    if ($found) {
        saveVipSubscriptions($allSubs);
        echo json_encode(['success' => true, 'message' => 'Status do membro atualizado com sucesso!']);
        exit;
    }

    http_response_code(404);
    echo json_encode(['error' => 'Assinatura não localizada.']);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Ação não encontrada.']);
