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
require_once __DIR__ . '/lib/vip_auth.php';

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

// Configurações e membros ficam nos arquivos VIVOS (data/*.live.json, fora do git — ver
// lib/live_data.php). Os .json versionados são só a semente: antes eram gravados direto e cada
// deploy os substituía pela cópia do repositório, apagando membros e o link do grupo.
function readVipSettings(): array {
    $data = nte_live_read(VIP_SETTINGS_FILE);
    if (!is_array($data)) {
        $defaults = defaultVipSettings();
        nte_live_write(VIP_SETTINGS_FILE, json_encode($defaults, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        return $defaults;
    }
    return array_merge(defaultVipSettings(), $data);
}

function saveVipSettings(array $settings): bool {
    $settings['updatedAt'] = date('c');
    $payload = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return $payload !== false && nte_live_write(VIP_SETTINGS_FILE, $payload);
}

function readVipSubscriptions(): array {
    return nte_vip_subscriptions();
}

function saveVipSubscriptions(array $subs): bool {
    return nte_vip_save_subscriptions($subs);
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

function callMercadoPago(string $url, string $method, ?array $body, string $accessToken, ?string $idempotencyKey = null, array $extraHeaders = []): array {
    $ch = curl_init($url);
    $headers = [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $accessToken
    ];
    // O Mercado Pago recusa POST /v1/payments sem este cabeçalho ("Header X-Idempotency-Key can't be null")
    if ($idempotencyKey) {
        $headers[] = 'X-Idempotency-Key: ' . $idempotencyKey;
    }
    foreach ($extraHeaders as $k => $v) {
        $headers[] = "{$k}: {$v}";
    }
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

const VIP_PASSWORD_MIN = 6;
const VIP_PASSWORD_MAX = 72; // limite do bcrypt
const VIP_LOGIN_ATTEMPTS_FILE = __DIR__ . '/../data/vip_login_attempts.json';
const VIP_LOGIN_MAX_FAILURES = 8;
const VIP_LOGIN_WINDOW_SECONDS = 900;

/** Mensagem de erro se a senha não serve, ou null se ela é aceita. */
function vipPasswordError(string $password): ?string {
    $len = strlen($password);
    if ($len < VIP_PASSWORD_MIN) return 'A senha deve ter pelo menos ' . VIP_PASSWORD_MIN . ' caracteres.';
    if ($len > VIP_PASSWORD_MAX) return 'A senha pode ter no máximo ' . VIP_PASSWORD_MAX . ' caracteres.';
    return null;
}

/** Chave anônima do cliente para o limite de tentativas (o IP não é gravado em claro). */
function vipLoginClientKey(): string {
    return hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'desconhecido'));
}

function vipReadLoginAttempts(): array {
    $raw = @file_get_contents(VIP_LOGIN_ATTEMPTS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    if (!is_array($data)) return [];
    $now = time();
    // Descarta janelas vencidas para o arquivo não crescer para sempre.
    return array_filter($data, static function ($row) use ($now): bool {
        return is_array($row) && ($row['until'] ?? 0) > $now;
    });
}

function vipLoginBlocked(): bool {
    $row = vipReadLoginAttempts()[vipLoginClientKey()] ?? null;
    return is_array($row) && (int)($row['failures'] ?? 0) >= VIP_LOGIN_MAX_FAILURES;
}

function vipRegisterLoginFailure(): void {
    $all = vipReadLoginAttempts();
    $key = vipLoginClientKey();
    $row = $all[$key] ?? ['failures' => 0, 'until' => time() + VIP_LOGIN_WINDOW_SECONDS];
    $row['failures'] = (int)$row['failures'] + 1;
    $all[$key] = $row;
    @file_put_contents(VIP_LOGIN_ATTEMPTS_FILE, json_encode($all), LOCK_EX);
}

function vipClearLoginFailures(): void {
    $all = vipReadLoginAttempts();
    unset($all[vipLoginClientKey()]);
    @file_put_contents(VIP_LOGIN_ATTEMPTS_FILE, json_encode($all), LOCK_EX);
}

/** O que o membro logado recebe: nunca o hash da senha. */
function vipMemberResponse(array $sub, array $settings): array {
    return [
        'isVip' => true,
        'plan' => $sub['plan'] ?? 'monthly',
        'name' => $sub['customer']['name'] ?? 'Membro VIP',
        'instagram' => $sub['customer']['instagram'] ?? '',
        'phone' => $sub['customer']['phone'] ?? '',
        'vipToken' => $sub['vipToken'] ?? '',
        'startedAt' => $sub['startedAt'] ?? null,
        'expiresAt' => $sub['expiresAt'] ?? null,
        'whatsappGroupLink' => $settings['whatsappGroupLink'] ?? '',
    ];
}

/** Assinatura ativa com este @ ou WhatsApp (para impedir cadastro duplicado). */
function vipFindActiveByIdentity(array $subs, string $instagram, string $phoneDigits): ?array {
    $insta = nte_vip_clean_instagram($instagram);
    $phone = substr(preg_replace('/\D/', '', $phoneDigits), -10);
    foreach ($subs as $s) {
        if (!nte_vip_is_active($s)) continue;
        $sInsta = nte_vip_clean_instagram((string)($s['customer']['instagram'] ?? ''));
        $sPhone = substr(preg_replace('/\D/', '', (string)($s['customer']['phone'] ?? '')), -10);
        if (($insta !== '' && $sInsta === $insta) || (strlen($phone) >= 10 && $sPhone === $phone)) return $s;
    }
    return null;
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
    $custInstagram = ltrim(trim((string)($customer['instagram'] ?? ($input['instagram'] ?? ''))), '@');
    $custPhone = trim((string)($customer['phone'] ?? ($input['phone'] ?? '')));
    $custName = trim((string)($customer['name'] ?? ($input['name'] ?? '')));
    if ($custName === '') {
        $custName = $custInstagram !== '' ? '@' . $custInstagram : 'Membro VIP';
    }
    $custEmail = strtolower(trim((string)($customer['email'] ?? ($input['email'] ?? ''))));
    $custCpf = preg_replace('/\D/', '', (string)($customer['cpf'] ?? ($input['cpf'] ?? '')));

    if ($custInstagram === '' || $custPhone === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Por favor, informe seu @ do Instagram e seu WhatsApp com DDD.']);
        exit;
    }

    // Senha de acesso à Área VIP: obrigatória, guardada só como hash (bcrypt).
    $custPassword = (string)($input['password'] ?? '');
    $passwordError = vipPasswordError($custPassword);
    if ($passwordError !== null) {
        http_response_code(400);
        echo json_encode(['error' => $passwordError]);
        exit;
    }
    $custPasswordHash = password_hash($custPassword, PASSWORD_DEFAULT);

    if (vipFindActiveByIdentity(readVipSubscriptions(), $custInstagram, $custPhone) !== null) {
        http_response_code(409);
        echo json_encode(['error' => 'Já existe uma assinatura VIP ativa com este @ ou WhatsApp. Use "Já sou membro" para entrar.']);
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

    $deviceId = trim((string)($input['deviceId'] ?? ''));
    $clientIp = $_SERVER['HTTP_CF_CONNECTING_IP']
        ?? $_SERVER['HTTP_X_FORWARDED_FOR']
        ?? $_SERVER['HTTP_CLIENT_IP']
        ?? $_SERVER['REMOTE_ADDR']
        ?? '';
    if (strpos($clientIp, ',') !== false) {
        $clientIp = trim(explode(',', $clientIp)[0]);
    }

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

    // Texto que a cliente vê no app do banco / comprovante do Mercado Pago
    $planLabel = ($plan === 'lifetime') ? 'Vitalício' : 'Mensal';
    $planDetail = ($plan === 'lifetime') ? 'pagamento único, acesso vitalício' : '30 dias de acesso';
    $description = "NT Eleganz - Plano VIP {$planLabel} ({$planDetail})";
    $additionalInfo = [
        'items' => [[
            'id' => 'nt-vip-' . $plan,
            'title' => "Plano VIP {$planLabel} - NT Eleganz",
            'description' => "Assinatura da Área VIP NT Eleganz: {$planDetail}",
            'category_id' => 'services',
            'quantity' => 1,
            'unit_price' => $amount
        ]],
        'payer' => [
            'first_name' => explode(' ', $custName)[0],
            'last_name' => explode(' ', $custName)[1] ?? 'VIP',
            'phone' => [
                'area_code' => $areaCode,
                'number' => $phoneNum
            ]
        ]
    ];
    if (!empty($clientIp)) {
        $additionalInfo['ip_address'] = $clientIp;
    }

    $extraHeaders = [];
    if ($deviceId !== '') {
        $extraHeaders['X-Meli-Session-Id'] = $deviceId;
    }

    if ($paymentMethod === 'pix') {
        $pixPayload = [
            'transaction_amount' => $amount,
            'description' => $description,
            'additional_info' => $additionalInfo,
            'payment_method_id' => 'pix',
            'payer' => $payer,
            'external_reference' => $subCode,
            'notification_url' => $webhookUrl,
            'statement_descriptor' => 'NT VIP'
        ];

        $res = callMercadoPago(MP_PAYMENTS_URL, 'POST', $pixPayload, $accessToken, 'vip-pix-' . $subCode, $extraHeaders);
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
                'instagram' => '@' . $custInstagram,
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => $custCpf
            ],
            'passwordHash' => $custPasswordHash,
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
            'additional_info' => $additionalInfo,
            'installments' => $installments,
            'payment_method_id' => $paymentMethodId,
            'payer' => $payer,
            'external_reference' => $subCode,
            'notification_url' => $webhookUrl,
            'statement_descriptor' => 'NT VIP'
        ];

        $res = callMercadoPago(MP_PAYMENTS_URL, 'POST', $cardPayload, $accessToken, 'vip-card-' . $subCode, $extraHeaders);
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
                'instagram' => '@' . $custInstagram,
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => $custCpf
            ],
            'passwordHash' => $custPasswordHash,
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
// Só o token prova a assinatura. Antes, telefone/e-mail/@ também valiam — e qualquer um que soubesse o
// @ de um membro entrava na Área VIP. Para entrar num dispositivo novo existe o login com senha (action=login).
if ($action === 'check_member') {
    $sub = nte_vip_active_sub_by_token((string)($_GET['token'] ?? ''));
    echo json_encode($sub ? vipMemberResponse($sub, readVipSettings()) : ['isVip' => false]);
    exit;
}

// ── 6b. LOGIN DO MEMBRO VIP (@ ou WhatsApp + senha) ──
if ($action === 'login' && $method === 'POST') {
    if (vipLoginBlocked()) {
        http_response_code(429);
        echo json_encode(['error' => 'Muitas tentativas. Aguarde 15 minutos e tente de novo.']);
        exit;
    }

    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;
    $identifier = trim((string)($input['identifier'] ?? ''));
    $password = (string)($input['password'] ?? '');
    if ($identifier === '' || $password === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Informe seu @ ou WhatsApp e a sua senha.']);
        exit;
    }

    $digits = preg_replace('/\D/', '', $identifier);
    $insta = nte_vip_clean_instagram($identifier);
    $allSubs = readVipSubscriptions();
    $matched = null;
    foreach ($allSubs as $s) {
        if (!nte_vip_is_active($s) || empty($s['passwordHash'])) continue;
        $sInsta = nte_vip_clean_instagram((string)($s['customer']['instagram'] ?? ''));
        $sPhone = preg_replace('/\D/', '', (string)($s['customer']['phone'] ?? ''));
        $byInsta = $insta !== '' && $sInsta !== '' && $sInsta === $insta;
        $byPhone = strlen($digits) >= 10 && strlen($sPhone) >= 10 && substr($sPhone, -10) === substr($digits, -10);
        if (($byInsta || $byPhone) && password_verify($password, (string)$s['passwordHash'])) {
            $matched = $s;
            break;
        }
    }

    if ($matched === null) {
        vipRegisterLoginFailure();
        http_response_code(401);
        // Mensagem única: não revela se o @ existe ou se só a senha está errada.
        echo json_encode(['error' => 'Dados de acesso inválidos ou assinatura inativa.']);
        exit;
    }

    vipClearLoginFailures();
    echo json_encode(vipMemberResponse($matched, readVipSettings()));
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
        'members' => array_reverse(array_map(static function (array $sub): array {
            $sub['hasPassword'] = !empty($sub['passwordHash']);
            unset($sub['passwordHash'], $sub['vipToken']);
            return $sub;
        }, $subs))
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
        $custInstagram = ltrim(trim((string)($input['instagram'] ?? '')), '@');
        $custName = trim((string)($input['name'] ?? ''));
        if ($custName === '') {
            $custName = $custInstagram !== '' ? '@' . $custInstagram : 'Cliente VIP';
        }
        $custPhone = trim((string)($input['phone'] ?? ''));
        $custEmail = trim((string)($input['email'] ?? ''));
        $plan = (($input['plan'] ?? '') === 'lifetime') ? 'lifetime' : 'monthly';
        $manualPassword = (string)($input['password'] ?? '');
        $manualPasswordError = vipPasswordError($manualPassword);
        if ($manualPasswordError !== null) {
            http_response_code(400);
            echo json_encode(['error' => $manualPasswordError . ' Defina a senha que o membro vai usar para entrar.']);
            exit;
        }

        $allSubs[] = [
            'id' => 'sub_manual_' . time(),
            'subCode' => 'VIP-MANUAL-' . rand(1000, 9999),
            'customer' => [
                'name' => $custName,
                'instagram' => $custInstagram !== '' ? '@' . $custInstagram : '',
                'email' => $custEmail,
                'phone' => $custPhone,
                'cpf' => ''
            ],
            'passwordHash' => password_hash($manualPassword, PASSWORD_DEFAULT),
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

// ── 9. REDEFINIR SENHA DE UM MEMBRO (Somente Admin) ──
// Para o membro que esqueceu a senha: o dono define uma nova e combina com ele pelo WhatsApp.
if ($action === 'set_password' && $method === 'POST') {
    if (!nte_is_admin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Acesso não autorizado.']);
        exit;
    }
    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;
    $subId = trim((string)($input['id'] ?? ''));
    $newPassword = (string)($input['password'] ?? '');
    $passwordError = vipPasswordError($newPassword);
    if ($passwordError !== null) {
        http_response_code(400);
        echo json_encode(['error' => $passwordError]);
        exit;
    }

    $allSubs = readVipSubscriptions();
    $found = false;
    foreach ($allSubs as &$s) {
        if (($s['id'] ?? '') === $subId) {
            $s['passwordHash'] = password_hash($newPassword, PASSWORD_DEFAULT);
            $s['updatedAt'] = date('c');
            $found = true;
            break;
        }
    }
    unset($s);

    if (!$found) {
        http_response_code(404);
        echo json_encode(['error' => 'Assinatura não localizada.']);
        exit;
    }
    saveVipSubscriptions($allSubs);
    echo json_encode(['success' => true, 'message' => 'Senha do membro atualizada.']);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Ação não encontrada.']);
