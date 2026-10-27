<?php
/**
 * NT Eleganz — dados cadastrados pelo gestor no painel (categorias, feedbacks, fretes).
 *
 * O que o gestor cadastra é gravado num arquivo "vivo" (data/<nome>.live.json) que NÃO é versionado
 * no git. O arquivo versionado (data/<nome>.json) é só a semente inicial: um deploy pode trocá-lo à
 * vontade sem apagar nem reverter nada do que foi cadastrado. Itens só saem daqui quando o gestor
 * os exclui pelo painel.
 */

require_once __DIR__ . '/image_store.php'; // nte_write_atomic()

/** data/categories.json -> data/categories.live.json */
function nte_live_path(string $seedPath): string
{
    return preg_replace('/\.json$/', '.live.json', $seedPath);
}

/**
 * Lê a lista cadastrada: o arquivo vivo; se ainda não existir, a semente (e já congela uma cópia viva,
 * para que um deploy posterior não mude o que está no ar). Retorna null se não houver nada gravado.
 */
function nte_live_read(string $seedPath): ?array
{
    $live = nte_live_path($seedPath);
    foreach ([$live, $seedPath] as $file) {
        if (!is_file($file)) {
            continue;
        }
        $raw = @file_get_contents($file);
        $data = $raw ? @json_decode($raw, true) : null;
        if (!is_array($data)) {
            continue;
        }
        if ($file === $seedPath) {
            nte_write_atomic($live, $raw);
        }
        return $data;
    }
    return null;
}

/** Já existe algo gravado (vivo ou semente), mesmo que ilegível? Evita sobrescrever dado existente com padrões. */
function nte_live_exists(string $seedPath): bool
{
    return is_file(nte_live_path($seedPath)) || is_file($seedPath);
}

/** Grava no arquivo vivo (nunca na semente versionada). */
function nte_live_write(string $seedPath, string $json): bool
{
    return nte_write_atomic(nte_live_path($seedPath), $json);
}
