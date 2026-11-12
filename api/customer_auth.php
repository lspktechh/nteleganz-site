<?php
/**
 * NT Eleganz — Customer Auth & Security API
 * Gerencia status de cadastro e definição de senha de acesso do cliente.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/vps_secret.php';

$vpsBaseUrl = 'https://137-131-233-254.sslip.io/nteleganz';
$dataFile = __DIR__ . '/../data/customers.json';

// Função para requisições seguras à VPS
function callVps($endpoint, $method = 'GET', $data = null) {
    global $vpsBaseUrl;
    $url = $vpsBaseUrl . $endpoint;
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
    // Rotas de clientes na VPS exigem a chave interna (senha e dados pessoais).
    $headers = [nte_vps_secret_header()];
    
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
            $headers[] = 'Content-Type: application/json';
        }
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode >= 200 && $httpCode < 300 && $response) {
        $decoded = json_decode($response, true);
        if ($decoded !== null) return $decoded;
    }
    return null;
}

// Fallback local: data/customers.json
function getLocalCustomers() {
    global $dataFile;
    if (!file_exists($dataFile)) return [];
    $raw = @file_get_contents($dataFile);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function saveLocalCustomers($list) {
    global $dataFile;
    $dir = dirname($dataFile);
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    @file_put_contents($dataFile, json_encode($list, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// 1. Status de cadastro (se tem senha definida)
if ($action === 'status' || ($method === 'GET' && isset($_GET['phone']))) {
    $phone = $_GET['phone'] ?? '';
    $email = $_GET['email'] ?? '';
    
    if (!$phone && !$email) {
        http_response_code(400);
        echo json_encode(['error' => 'Informe o telefone ou e-mail.']);
        exit;
    }
    
    // Tenta VPS primeiro
    $vpsParams = [];
    if ($phone) $vpsParams['phone'] = $phone;
    if ($email) $vpsParams['email'] = $email;
    $vpsRes = callVps('/api/customers/status?' . http_build_query($vpsParams));
    if ($vpsRes && isset($vpsRes['success'])) {
        echo json_encode($vpsRes);
        exit;
    }
    
    // Fallback local
    $customers = getLocalCustomers();
    $cleanPhone = preg_replace('/\D/', '', $phone);
    $lastDigits = substr($cleanPhone, -8);
    $cleanEmail = strtolower(trim($email));
    
    foreach ($customers as $c) {
        $cPhone = preg_replace('/\D/', '', $c['phone'] ?? '');
        $cEmail = strtolower(trim($c['email'] ?? ''));
        
        $matchPhone = ($lastDigits && strpos($cPhone, $lastDigits) !== false);
        $matchEmail = ($cleanEmail && $cEmail === $cleanEmail);
        
        if ($matchPhone || $matchEmail) {
            echo json_encode([
                'success' => true,
                'exists' => true,
                'hasPassword' => !empty($c['has_password']),
                'name' => $c['name'] ?? '',
                'phone' => $c['phone'] ?? '',
                'email' => $c['email'] ?? ''
            ]);
            exit;
        }
    }
    
    echo json_encode(['success' => true, 'exists' => false, 'hasPassword' => false]);
    exit;
}

// 2. Definir / Atualizar Senha do Cliente
if ($action === 'set_password' || ($method === 'POST' && $action === 'password')) {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) $input = $_POST;
    
    $phone = trim($input['phone'] ?? '');
    $email = trim($input['email'] ?? '');
    $name = trim($input['name'] ?? 'Cliente');
    $password = trim($input['password'] ?? '');
    
    if (!$phone && !$email) {
        http_response_code(400);
        echo json_encode(['error' => 'Telefone ou e-mail é obrigatório.']);
        exit;
    }
    
    if (strlen($password) < 6) {
        http_response_code(400);
        echo json_encode(['error' => 'A senha deve conter no mínimo 6 caracteres.']);
        exit;
    }
    
    // Salva na VPS
    $vpsRes = callVps('/api/customers/password', 'POST', [
        'phone' => $phone,
        'email' => $email,
        'name' => $name,
        'password' => $password
    ]);
    
    // Salva também localmente para redundância
    $customers = getLocalCustomers();
    $cleanPhone = preg_replace('/\D/', '', $phone);
    $cleanEmail = strtolower(trim($email));
    $found = false;
    
    foreach ($customers as &$c) {
        $cPhone = preg_replace('/\D/', '', $c['phone'] ?? '');
        $cEmail = strtolower(trim($c['email'] ?? ''));
        if (($cleanPhone && $cPhone === $cleanPhone) || ($cleanEmail && $cEmail === $cleanEmail)) {
            $c['name'] = $name ?: ($c['name'] ?? '');
            $c['phone'] = $phone ?: ($c['phone'] ?? '');
            $c['email'] = $email ?: ($c['email'] ?? '');
            $c['password_hash'] = password_hash($password, PASSWORD_BCRYPT);
            $c['has_password'] = true;
            $c['updated_at'] = date('c');
            $found = true;
            break;
        }
    }
    unset($c);
    
    if (!$found) {
        $customers[] = [
            'id' => 'cust_' . time() . '_' . substr(md5(uniqid()), 0, 5),
            'name' => $name,
            'phone' => $phone,
            'email' => $email,
            'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            'has_password' => true,
            'created_at' => date('c'),
            'updated_at' => date('c')
        ];
    }
    saveLocalCustomers($customers);
    
    echo json_encode([
        'success' => true,
        'message' => 'Senha cadastrada com sucesso! Seu acesso está protegido.',
        'hasPassword' => true
    ]);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Ação não encontrada.']);
