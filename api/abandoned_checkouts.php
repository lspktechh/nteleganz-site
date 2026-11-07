<?php
/**
 * NT Eleganz - API de Meio Caminho (Recuperação de Checkout Abandonado)
 * Registra clientes que iniciam o preenchimento dos passos do checkout mas não concluem.
 * Histórico permanente por tempo indeterminado com hora e data exatas de Brasília.
 */

date_default_timezone_set('America/Sao_Paulo');

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Cache-Control: no-cache, no-store, must-revalidate');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

const ABANDONED_FILE = __DIR__ . '/../data/abandoned_checkouts.json';

function readAbandonedCheckouts(): array {
    if (!file_exists(ABANDONED_FILE)) return [];
    $raw = @file_get_contents(ABANDONED_FILE);
    if (!$raw) return [];
    $data = @json_decode($raw, true);
    return (is_array($data) && isset($data['checkouts']) && is_array($data['checkouts'])) ? $data['checkouts'] : [];
}

function saveAbandonedCheckouts(array $list): bool {
    $dir = dirname(ABANDONED_FILE);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $payload = json_encode([
        'updatedAt' => date('c'),
        'count' => count($list),
        'checkouts' => array_values($list)
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    return @file_put_contents(ABANDONED_FILE, $payload, LOCK_EX) !== false;
}

$method = $_SERVER['REQUEST_METHOD'];
$rawBody = file_get_contents('php://input');
$input = $rawBody ? json_decode($rawBody, true) : null;
$idParam = isset($_GET['id']) ? trim((string)$_GET['id']) : '';
$statusFilter = isset($_GET['status']) ? trim((string)$_GET['status']) : '';

switch ($method) {
    case 'GET':
        $list = readAbandonedCheckouts();

        if ($idParam !== '') {
            $found = null;
            foreach ($list as $item) {
                if (($item['id'] ?? '') === $idParam) {
                    $found = $item;
                    break;
                }
            }
            if ($found) {
                echo json_encode(['success' => true, 'checkout' => $found]);
            } else {
                http_response_code(404);
                echo json_encode(['error' => 'Registro não encontrado']);
            }
            exit;
        }

        if ($statusFilter !== '') {
            $list = array_values(array_filter($list, function($item) use ($statusFilter) {
                if ($statusFilter === 'pendente') {
                    return ($item['status'] ?? 'pendente') === 'pendente' && empty($item['recovered']);
                }
                return ($item['status'] ?? '') === $statusFilter;
            }));
        }

        // Ordena por data de atualização mais recente
        usort($list, function($a, $b) {
            $tA = strtotime($a['updatedAt'] ?? $a['createdAt'] ?? 'now');
            $tB = strtotime($b['updatedAt'] ?? $b['createdAt'] ?? 'now');
            return $tB <=> $tA;
        });

        echo json_encode([
            'success' => true,
            'count' => count($list),
            'checkouts' => $list
        ]);
        exit;

    case 'POST':
        if (!is_array($input)) {
            http_response_code(400);
            echo json_encode(['error' => 'Corpo JSON inválido']);
            exit;
        }

        $phone = preg_replace('/\D/', '', (string)($input['phone'] ?? ''));
        $email = strtolower(trim((string)($input['email'] ?? '')));
        $name = trim((string)($input['name'] ?? ''));

        // Requer ao menos telefone ou email ou nome para identificar o cliente
        if ($phone === '' && $email === '' && $name === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe ao menos nome, telefone ou e-mail']);
            exit;
        }

        $list = readAbandonedCheckouts();
        $now = date('c');
        $exactTime = date('H:i:s');
        $exactDate = date('d/m/Y');
        $fullDateTime = date('d/m/Y \à\s H:i:s');

        // Procura por registro prévio deste checkout APENAS na mesma sessão ativa
        // e que ainda esteja em andamento (não sobrescreve pedidos já finalizados ou de outras sessões)
        $sessionId = trim((string)($input['sessionId'] ?? ''));
        $foundIdx = -1;

        if ($sessionId !== '') {
            foreach ($list as $idx => $item) {
                $itemSession = trim((string)($item['sessionId'] ?? ''));
                if ($itemSession === $sessionId) {
                    $foundIdx = $idx;
                    break;
                }
            }
        }

        $step = intval($input['step'] ?? 1);
        $stepNames = [
            1 => 'Etapa 1: Identificação',
            2 => 'Etapa 2: Endereço & Frete',
            3 => 'Etapa 3: Resumo & Pagamento'
        ];
        $stepName = $stepNames[$step] ?? "Etapa {$step}";

        if ($foundIdx >= 0) {
            // Atualiza existente na mesma sessão ativa
            $existing = $list[$foundIdx];
            $updated = array_merge($existing, $input, [
                'updatedAt' => $now,
                'lastTime' => $exactTime,
                'lastDate' => $exactDate,
                'step' => max(intval($existing['step'] ?? 1), $step),
                'stepName' => $stepName,
            ]);
            // Preserva data e hora de criação original intactas
            $updated['createdAt'] = $existing['createdAt'] ?? $now;
            $updated['exactTime'] = $existing['exactTime'] ?? $exactTime;
            $updated['exactDate'] = $existing['exactDate'] ?? $exactDate;
            $updated['fullDateTime'] = $existing['fullDateTime'] ?? $fullDateTime;

            // Se for marcada como finalizada/recuperada
            if (!empty($input['finalizado']) || ($input['status'] ?? '') === 'finalizado' || ($input['status'] ?? '') === 'recuperado') {
                $updated['status'] = 'recuperado';
                $updated['recovered'] = true;
                $updated['finalizado'] = true;
                $updated['orderCode'] = $input['orderCode'] ?? ($updated['orderCode'] ?? '');
                $updated['finalizedAt'] = $now;
                $updated['finalizedTime'] = $exactTime;
            }

            $list[$foundIdx] = $updated;
            saveAbandonedCheckouts($list);
            http_response_code(200);
            echo json_encode(['success' => true, 'checkout' => $updated]);
            exit;
        }

        // Novo registro permanente no histórico
        $id = 'mc_' . time() . '_' . substr(md5(uniqid(mt_rand(), true)), 0, 5);
        $newRecord = array_merge($input, [
            'id' => $id,
            'sessionId' => $sessionId ?: $id,
            'step' => $step,
            'stepName' => $stepName,
            'status' => ($input['status'] ?? 'pendente'),
            'recovered' => !empty($input['finalizado']) || ($input['status'] ?? '') === 'recuperado',
            'finalizado' => !empty($input['finalizado']),
            'createdAt' => $now,
            'updatedAt' => $now,
            'exactTime' => $exactTime,
            'exactDate' => $exactDate,
            'fullDateTime' => $fullDateTime,
        ]);

        array_unshift($list, $newRecord);
        saveAbandonedCheckouts($list);
        http_response_code(201);
        echo json_encode(['success' => true, 'checkout' => $newRecord]);
        exit;

    case 'PUT':
        $targetId = $idParam !== '' ? $idParam : ($input['id'] ?? '');
        if ($targetId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID para atualização']);
            exit;
        }

        $list = readAbandonedCheckouts();
        $found = false;
        $updatedItem = null;

        foreach ($list as $idx => $item) {
            if (($item['id'] ?? '') === $targetId) {
                $list[$idx] = array_merge($item, is_array($input) ? $input : [], [
                    'updatedAt' => date('c')
                ]);
                $updatedItem = $list[$idx];
                $found = true;
                break;
            }
        }

        if (!$found) {
            http_response_code(404);
            echo json_encode(['error' => 'Registro não encontrado']);
            exit;
        }

        saveAbandonedCheckouts($list);
        echo json_encode(['success' => true, 'checkout' => $updatedItem]);
        exit;

    case 'DELETE':
        $targetId = $idParam !== '' ? $idParam : ($input['id'] ?? '');
        if ($targetId === '') {
            http_response_code(400);
            echo json_encode(['error' => 'Informe o ID para exclusão']);
            exit;
        }

        $list = readAbandonedCheckouts();
        $filtered = array_filter($list, fn($it) => ($it['id'] ?? '') !== $targetId);
        saveAbandonedCheckouts(array_values($filtered));
        echo json_encode(['success' => true, 'id' => $targetId]);
        exit;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Método não permitido']);
        exit;
}
