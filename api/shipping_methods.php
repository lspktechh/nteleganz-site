<?php
/**
 * NT Eleganz - API de Formas de Entrega / Frete
 * Permite listar as opções no checkout e gerenciar pelo Painel Admin
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Upload-Token');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/lib/live_data.php';

// Semente versionada. O que o gestor cadastra é gravado em shipping_methods.live.json (fora do git).
const SHIPPING_FILE = __DIR__ . '/../data/shipping_methods.json';

function defaultShippingMethods(): array {
    return [
        [
            'id' => 'sedex',
            'name' => 'Sedex Express (Seguro Especial Incluso)',
            'price' => 38.00,
            'deadline' => '2 a 4 dias úteis',
            'freeAbove' => 1000.00,
            'active' => true,
            'singleItemOnly' => false
        ],
        [
            'id' => 'pac',
            'name' => 'Standard Nobre (PAC)',
            'price' => 22.00,
            'deadline' => '5 a 8 dias úteis',
            'freeAbove' => 600.00,
            'active' => true,
            'singleItemOnly' => false
        ],
        [
            'id' => 'concierge',
            'name' => 'Entrega Concierge / Agendamento VIP',
            'price' => 60.00,
            'deadline' => 'Até 24h ou horário agendado',
            'freeAbove' => null,
            'active' => true,
            'singleItemOnly' => false
        ]
    ];
}

function readShippingMethods(): array {
    $data = nte_live_read(SHIPPING_FILE);
    if ($data === null) {
        $defaults = defaultShippingMethods();
        if (!nte_live_exists(SHIPPING_FILE)) {
            saveShippingMethods($defaults);
        }
        return $defaults;
    }
    return $data;
}

function saveShippingMethods(array $methods): bool {
    return nte_live_write(
        SHIPPING_FILE,
        json_encode($methods, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $all = isset($_GET['all']) && $_GET['all'] === '1';
    $methods = readShippingMethods();
    if (!$all) {
        $methods = array_values(array_filter($methods, fn($m) => !empty($m['active'])));
    }
    echo json_encode(['success' => true, 'methods' => $methods]);
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;
    $methods = $input['methods'] ?? (is_array($input) && isset($input[0]) ? $input : null);

    if (!is_array($methods)) {
        http_response_code(400);
        echo json_encode(['error' => 'Formato inválido. Envie um array de métodos em "methods"']);
        exit;
    }

    $sanitized = [];
    foreach ($methods as $idx => $m) {
        if (!is_array($m)) continue;
        $id = preg_replace('/[^a-zA-Z0-9_-]/', '', (string)($m['id'] ?? 'env_' . ($idx + 1)));
        $name = trim((string)($m['name'] ?? 'Forma de Envio'));
        $price = max(0, (float)($m['price'] ?? 0));
        $deadline = trim((string)($m['deadline'] ?? '3 a 7 dias úteis'));
        $freeAbove = isset($m['freeAbove']) && is_numeric($m['freeAbove']) && (float)$m['freeAbove'] > 0
            ? (float)$m['freeAbove']
            : null;
        $active = !isset($m['active']) || (bool)$m['active'];
        $singleItemOnly = !empty($m['singleItemOnly']);

        $sanitized[] = [
            'id' => $id,
            'name' => $name,
            'price' => $price,
            'deadline' => $deadline,
            'freeAbove' => $freeAbove,
            'active' => $active,
            'singleItemOnly' => $singleItemOnly
        ];
    }

    if (saveShippingMethods($sanitized)) {
        echo json_encode(['success' => true, 'methods' => $sanitized]);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Não foi possível salvar as formas de entrega']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método não permitido']);
