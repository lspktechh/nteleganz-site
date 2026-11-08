<?php
/**
 * NT Eleganz — guarda de admin para endpoints sensíveis.
 *
 * Reaproveita a validação de api/tracking.php, a mesma que a tela de pixels já usa: token de sessão local
 * (data/admin_sessions.json, emitido por api/admin_auth.php) OU JWT do Supabase de um usuário com role=admin.
 * O token vem em "Authorization: Bearer" ou em "X-Upload-Token" (o painel manda os dois).
 */

require_once __DIR__ . '/../tracking.php';

function nte_is_admin(): bool
{
    return isAdminAuthenticated();
}

/** Responde 401 e encerra. */
function nte_deny_admin(): void
{
    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Não autorizado. Faça login como administrador.'], JSON_UNESCAPED_UNICODE);
    exit;
}

/** Encerra com 401 se a requisição não vier de um admin autenticado. */
function nte_require_admin(): void
{
    if (!isAdminAuthenticated()) {
        nte_deny_admin();
    }
}
