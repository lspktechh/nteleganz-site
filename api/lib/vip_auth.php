<?php
/**
 * NT Eleganz — regras de VIP compartilhadas (vip.php, mercadopago.php, infinitepay.php).
 *
 * IDENTIDADE VIP = SÓ O TOKEN. O token (vipToken) é entregue ao membro depois do pagamento aprovado ou de
 * um login com senha. Antes, telefone, e-mail ou @ do Instagram também valiam como prova de assinatura —
 * dados que qualquer um descobre —, então quem soubesse o @ de um membro levava o acesso antecipado e o
 * desconto. Esta é a única função que decide "é VIP?" no servidor.
 */

declare(strict_types=1);

if (!defined('NTE_VIP_SUBSCRIPTIONS_FILE')) {
    define('NTE_VIP_SUBSCRIPTIONS_FILE', __DIR__ . '/../../data/vip_subscriptions.json');
}

/** Lista de assinaturas como está no arquivo. */
function nte_vip_subscriptions(): array
{
    if (!file_exists(NTE_VIP_SUBSCRIPTIONS_FILE)) return [];
    $raw = @file_get_contents(NTE_VIP_SUBSCRIPTIONS_FILE);
    $data = $raw ? @json_decode($raw, true) : null;
    return (is_array($data) && isset($data['subscriptions']) && is_array($data['subscriptions']))
        ? $data['subscriptions']
        : [];
}

/** Assinatura ativa e dentro da validade (vitalícia não expira). */
function nte_vip_is_active(array $sub, ?int $now = null): bool
{
    if (($sub['status'] ?? '') !== 'active') return false;
    if (!empty($sub['expiresAt']) && strtotime((string)$sub['expiresAt']) < ($now ?? time())) return false;
    return true;
}

/** Assinatura ativa dona deste token, ou null. */
function nte_vip_active_sub_by_token(?string $token): ?array
{
    $token = trim((string)$token);
    if ($token === '') return null;
    $now = time();
    foreach (nte_vip_subscriptions() as $sub) {
        if (!nte_vip_is_active($sub, $now)) continue;
        if (!empty($sub['vipToken']) && hash_equals((string)$sub['vipToken'], $token)) return $sub;
    }
    return null;
}

function nte_vip_token_is_valid(?string $token): bool
{
    return nte_vip_active_sub_by_token($token) !== null;
}

/** Desconto VIP do produto, em % inteiro de 0 a 90 (0 = sem desconto). */
function nte_vip_discount_percent(array $product): int
{
    $pct = (int)round((float)($product['vipDiscountPercent'] ?? 0));
    return max(0, min(90, $pct));
}

/** Preço unitário com o desconto VIP aplicado (2 casas). */
function nte_vip_apply_discount(float $unitPrice, array $product): float
{
    $pct = nte_vip_discount_percent($product);
    if ($pct <= 0) return $unitPrice;
    return round($unitPrice * (100 - $pct) / 100, 2);
}

/** Normaliza @ do Instagram para comparação: minúsculas, sem @ e sem espaços. */
function nte_vip_clean_instagram(string $value): string
{
    return strtolower(ltrim(trim($value), '@'));
}
