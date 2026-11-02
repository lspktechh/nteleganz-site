<?php
/**
 * NT Eleganz — API de Configurações de Checkout Dinâmico
 * Controla o roteamento dinâmico entre WhatsApp e Checkout do Banco (InfinitePay)
 * por horário de funcionamento configurável no Painel Admin.
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

const CHECKOUT_SETTINGS_FILE = __DIR__ . '/../data/checkout_settings.json';

function defaultCheckoutSettings(): array {
    return [
        'mode' => 'schedule', // 'schedule' | 'always_wpp' | 'always_bank'
        'wppStartTime' => '09:00',
        'wppEndTime' => '19:00',
        'wppActiveDays' => [1, 2, 3, 4, 5, 6], // 1=Seg a 6=Sáb (0=Dom desmarcado)
        'timezone' => 'America/Sao_Paulo',
        'wppButtonText' => 'Finalizar pedido no WhatsApp',
        'bankButtonText' => 'Finalizar Pedido Seguro',
        'updatedAt' => date('c')
    ];
}

function readCheckoutSettings(): array {
    $data = nte_live_read(CHECKOUT_SETTINGS_FILE);
    if ($data === null || !is_array($data)) {
        $defaults = defaultCheckoutSettings();
        if (!nte_live_exists(CHECKOUT_SETTINGS_FILE)) {
            saveCheckoutSettings($defaults);
        }
        return $defaults;
    }
    return array_merge(defaultCheckoutSettings(), $data);
}

function saveCheckoutSettings(array $settings): bool {
    return nte_live_write(
        CHECKOUT_SETTINGS_FILE,
        json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );
}

/**
 * Calcula se no momento atual de Brasília o WhatsApp está ativo ou se deve ir para o Checkout do Banco
 */
function computeCheckoutStatus(array $settings): array {
    $mode = $settings['mode'] ?? 'schedule';
    $tzString = $settings['timezone'] ?? 'America/Sao_Paulo';

    try {
        $tz = new DateTimeZone($tzString);
    } catch (\Throwable $e) {
        $tz = new DateTimeZone('America/Sao_Paulo');
    }

    $now = new DateTime('now', $tz);
    $currH = (int)$now->format('H');
    $currM = (int)$now->format('i');
    $currMinutes = ($currH * 60) + $currM;
    $currDay = (int)$now->format('w'); // 0 (Domingo) a 6 (Sábado)
    $formattedTime = $now->format('H:i');

    $isWppActive = true;
    $reason = '';

    if ($mode === 'always_wpp') {
        $isWppActive = true;
        $reason = 'Modo fixo: Sempre WhatsApp ativado manualmente.';
    } elseif ($mode === 'always_bank') {
        $isWppActive = false;
        $reason = 'Modo fixo: Sempre Checkout Banco ativado manualmente.';
    } else {
        // Modo 'schedule' (Horário Dinâmico)
        $activeDays = is_array($settings['wppActiveDays'] ?? null)
            ? array_map('intval', $settings['wppActiveDays'])
            : [1, 2, 3, 4, 5, 6];

        if (!in_array($currDay, $activeDays, true)) {
            $isWppActive = false;
            $reason = 'Hoje não há expediente de atendimento no WhatsApp. Direcionando para Checkout do Banco.';
        } else {
            $startTime = (string)($settings['wppStartTime'] ?? '09:00');
            $endTime = (string)($settings['wppEndTime'] ?? '19:00');

            $startParts = explode(':', $startTime);
            $endParts = explode(':', $endTime);

            $startMin = ((int)($startParts[0] ?? 9) * 60) + (int)($startParts[1] ?? 0);
            $endMin = ((int)($endParts[0] ?? 19) * 60) + (int)($endParts[1] ?? 0);

            if ($startMin <= $endMin) {
                $isWppActive = ($currMinutes >= $startMin && $currMinutes < $endMin);
            } else {
                // Atravessa meia-noite (ex: 20:00 às 06:00)
                $isWppActive = ($currMinutes >= $startMin || $currMinutes < $endMin);
            }

            if ($isWppActive) {
                $reason = "Dentro do horário de atendimento WhatsApp ({$startTime} às {$endTime}).";
            } else {
                $reason = "Fora do horário de atendimento WhatsApp (ativo das {$startTime} às {$endTime}). Direcionando para Checkout do Banco.";
            }
        }
    }

    return [
        'isWhatsAppActive' => $isWppActive,
        'activeCheckout' => $isWppActive ? 'whatsapp' : 'bank',
        'serverTime' => $formattedTime,
        'serverDay' => $currDay,
        'timezone' => $tz->getName(),
        'reason' => $reason
    ];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $settings = readCheckoutSettings();
    $status = computeCheckoutStatus($settings);

    echo json_encode([
        'success' => true,
        'settings' => $settings,
        'currentStatus' => $status
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($method === 'POST') {
    $raw = file_get_contents('php://input');
    $input = $raw ? json_decode($raw, true) : null;

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['error' => 'Formato JSON inválido.']);
        exit;
    }

    $current = readCheckoutSettings();

    $mode = trim((string)($input['mode'] ?? $current['mode']));
    if (!in_array($mode, ['schedule', 'always_wpp', 'always_bank'], true)) {
        $mode = 'schedule';
    }

    $startTime = trim((string)($input['wppStartTime'] ?? $current['wppStartTime']));
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $startTime)) {
        $startTime = '09:00';
    }

    $endTime = trim((string)($input['wppEndTime'] ?? $current['wppEndTime']));
    if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $endTime)) {
        $endTime = '19:00';
    }

    $days = [];
    if (isset($input['wppActiveDays']) && is_array($input['wppActiveDays'])) {
        foreach ($input['wppActiveDays'] as $d) {
            $val = (int)$d;
            if ($val >= 0 && $val <= 6 && !in_array($val, $days, true)) {
                $days[] = $val;
            }
        }
    } else {
        $days = [1, 2, 3, 4, 5, 6];
    }
    sort($days);

    $updated = [
        'mode' => $mode,
        'wppStartTime' => $startTime,
        'wppEndTime' => $endTime,
        'wppActiveDays' => $days,
        'timezone' => 'America/Sao_Paulo',
        'wppButtonText' => trim((string)($input['wppButtonText'] ?? $current['wppButtonText'] ?? 'Finalizar pedido no WhatsApp')),
        'bankButtonText' => trim((string)($input['bankButtonText'] ?? $current['bankButtonText'] ?? 'Finalizar Pedido Seguro')),
        'updatedAt' => date('c')
    ];

    if (saveCheckoutSettings($updated)) {
        $status = computeCheckoutStatus($updated);
        echo json_encode([
            'success' => true,
            'message' => 'Configurações de checkout dinâmico salvas com sucesso.',
            'settings' => $updated,
            'currentStatus' => $status
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code(500);
        echo json_encode(['error' => 'Falha ao salvar configurações de checkout no servidor.']);
    }
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método não permitido']);
