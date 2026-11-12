<?php
/**
 * NT Eleganz — chave compartilhada com a API da VPS (header X-NTE-Secret).
 *
 * O repositório é PÚBLICO, então a chave não pode estar no código. Ordem de leitura:
 *   1. variável de ambiente NTE_INTERNAL_SECRET (se a hospedagem permitir);
 *   2. arquivo data/vps_secret.txt — fora do git (.gitignore) e bloqueado na web por data/.htaccess.
 *      Criar pelo gerenciador de arquivos da Hostinger com a MESMA chave configurada na VPS;
 *   3. chave antiga (pública), só para não quebrar a integração antes de a chave nova existir
 *      nos dois lados. Depois de configurar a nova, esta deixa de funcionar na VPS sozinha.
 */

declare(strict_types=1);

const NTE_VPS_LEGACY_SECRET = 'nte_sec_2026_isolated_vault';

function nte_vps_secret(): string
{
    static $secret = null;
    if ($secret !== null) return $secret;

    $env = getenv('NTE_INTERNAL_SECRET');
    if (is_string($env) && trim($env) !== '') return $secret = trim($env);

    $file = __DIR__ . '/../../data/vps_secret.txt';
    if (is_readable($file)) {
        $value = trim((string)@file_get_contents($file));
        if ($value !== '') return $secret = $value;
    }

    return $secret = NTE_VPS_LEGACY_SECRET;
}

/** Header pronto para o cURL. */
function nte_vps_secret_header(): string
{
    return 'X-NTE-Secret: ' . nte_vps_secret();
}
