<?php
/**
 * NT ELEGANZ — Página Oficial de Detalhes do Pedido
 * Permite ao cliente e ao lojista conferirem todos os itens, fotos, tamanhos, cores e valores.
 */

$codeQuery = isset($_GET['code']) ? trim((string)$_GET['code']) : (isset($_GET['id']) ? trim((string)$_GET['id']) : '');
if ($codeQuery === '') {
    $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if (preg_match('#/(?:pedido|order)/([^/?]+)#', $uriPath, $m)) {
        $codeQuery = trim($m[1]);
    }
}

$cleanCode = strtoupper(ltrim($codeQuery, '#'));

function callVpsOrders(string $method, string $url): ?array {
    $ch = curl_init($url);
    if (!$ch) return null;
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($response === false || $httpCode < 200 || $httpCode >= 400) return null;
    $decoded = json_decode($response, true);
    return is_array($decoded) ? $decoded : null;
}

function readLocalOrders(): array {
    $file = __DIR__ . '/../data/orders.json';
    if (!file_exists($file)) return [];
    $raw = @file_get_contents($file);
    $data = $raw ? @json_decode($raw, true) : null;
    return (is_array($data) && isset($data['orders']) && is_array($data['orders'])) ? $data['orders'] : [];
}

$order = null;
if ($cleanCode !== '') {
    $local = readLocalOrders();
    foreach ($local as $o) {
        $c = strtoupper(ltrim((string)($o['code'] ?? ''), '#'));
        $i = strtolower((string)($o['id'] ?? ''));
        if ($c === $cleanCode || $i === strtolower($cleanCode) || strpos($i, strtolower($cleanCode)) !== false) {
            $order = $o;
            break;
        }
    }

    if (!$order) {
        $vps = callVpsOrders('GET', 'https://137-131-233-254.sslip.io/nteleganz/api/orders');
        if ($vps !== null && isset($vps['orders']) && is_array($vps['orders'])) {
            foreach ($vps['orders'] as $o) {
                $c = strtoupper(ltrim((string)($o['code'] ?? ''), '#'));
                $i = strtolower((string)($o['id'] ?? ''));
                if ($c === $cleanCode || $i === strtolower($cleanCode) || strpos($i, strtolower($cleanCode)) !== false) {
                    $order = $o;
                    break;
                }
            }
        }
    }
}

// Normaliza itens do pedido se encontrado
$items = [];
if ($order) {
    if (!empty($order['items']) && is_array($order['items'])) {
        $items = $order['items'];
    } else {
        $items[] = [
            'id' => $order['productId'] ?? '',
            'brand' => $order['productBrand'] ?? 'NT Eleganz',
            'name' => $order['productName'] ?? 'Produto',
            'size' => $order['size'] ?? '',
            'color' => $order['color'] ?? '',
            'qty' => $order['quantity'] ?? 1,
            'price' => $order['value'] ?? '',
            'image' => $order['imageUrl'] ?? '',
        ];
    }
}

$displayCode = $order['code'] ?? ($cleanCode !== '' ? '#' . $cleanCode : '#NTE-PEDIDO');
$status = strtolower((string)($order['status'] ?? 'novo'));
$totalValue = $order['value'] ?? '';
$createdAt = $order['createdAt'] ?? date('c');

$statusLabels = [
    'novo' => ['label' => 'Aguardando Atendimento', 'class' => 'status-badge--pending', 'icon' => '⏳'],
    'pendente' => ['label' => 'Aguardando Atendimento', 'class' => 'status-badge--pending', 'icon' => '⏳'],
    'aprovado' => ['label' => 'Pedido Confirmado', 'class' => 'status-badge--success', 'icon' => '✓'],
    'pago' => ['label' => 'Pagamento Aprovado', 'class' => 'status-badge--success', 'icon' => '✓'],
    'preparando' => ['label' => 'Em Separação', 'class' => 'status-badge--info', 'icon' => '📦'],
    'enviado' => ['label' => 'Enviado / A Caminho', 'class' => 'status-badge--purple', 'icon' => '🚚'],
    'entregue' => ['label' => 'Entregue', 'class' => 'status-badge--success', 'icon' => '🎉'],
    'cancelado' => ['label' => 'Cancelado', 'class' => 'status-badge--danger', 'icon' => '✕'],
];
$statusInfo = $statusLabels[$status] ?? $statusLabels['novo'];

$pageTitle = "Pedido {$displayCode} | NT Eleganz";
$metaDesc = "Detalhes e fotos do pedido {$displayCode} na NT Eleganz. Grifes originais autenticadas.";
$firstItemImg = !empty($items[0]['image']) ? $items[0]['image'] : 'https://nteleganz.com.br/assets/images/banner.webp';
if (strpos($firstItemImg, 'http') !== 0) {
    $firstItemImg = 'https://nteleganz.com.br/' . ltrim($firstItemImg, '/');
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <base href="/" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
  <meta name="description" content="<?= htmlspecialchars($metaDesc, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="robots" content="noindex, follow" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="NT Eleganz" />
  <meta property="og:title" content="<?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?>" />
  <meta property="og:description" content="<?= htmlspecialchars($metaDesc, ENT_QUOTES, 'UTF-8') ?>" />
  <meta property="og:image" content="<?= htmlspecialchars($firstItemImg, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="<?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="twitter:description" content="<?= htmlspecialchars($metaDesc, ENT_QUOTES, 'UTF-8') ?>" />
  <meta name="twitter:image" content="<?= htmlspecialchars($firstItemImg, ENT_QUOTES, 'UTF-8') ?>" />

  <link rel="icon" type="image/webp" href="assets/images/logonz.webp?v=20260930" />
  <link rel="apple-touch-icon" href="assets/images/logonz-400.webp" />

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

  <!-- CSS Base -->
  <link rel="stylesheet" href="css/variables.css" />
  <link rel="stylesheet" href="css/reset.css" />
  <link rel="stylesheet" href="css/animations.css" />
  <link rel="stylesheet" href="css/components.css?v=20261110-peca-v4" />

  <style>
    :root {
      --order-bg: #f7f5f0;
      --order-card: #ffffff;
      --order-border: rgba(0, 0, 0, 0.08);
      --order-border-strong: rgba(0, 0, 0, 0.16);
      --order-accent: #0a0a0a;
      --order-gold: #c29b38;
      --order-gold-bg: rgba(194, 155, 56, 0.08);
      --order-gold-border: rgba(194, 155, 56, 0.25);
    }

    body {
      background-color: var(--order-bg);
      color: var(--text-primary);
      font-family: var(--font-sans);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }

    /* Announcement Top Bar */
    .top-strip {
      background: #0a0a0a;
      color: #ffffff;
      text-align: center;
      padding: 8px 16px;
      font-size: 0.72rem;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      font-weight: 600;
    }

    /* Minimal Header */
    .order-header {
      background: #ffffff;
      border-bottom: 1px solid var(--order-border);
      padding: 14px 20px;
      position: sticky;
      top: 0;
      z-index: 100;
      backdrop-filter: blur(8px);
    }
    .order-header-inner {
      max-width: 820px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .order-brand {
      display: inline-flex;
      align-items: center;
      text-decoration: none;
    }
    .order-brand img {
      height: 28px;
      width: auto;
      display: block;
    }
    .order-header-nav {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .order-header-link {
      font-size: 0.82rem;
      color: var(--text-secondary);
      text-decoration: none;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }
    .order-header-link:hover {
      background: rgba(0, 0, 0, 0.04);
      color: #000;
    }

    /* Page Container */
    .order-main {
      flex: 1;
      max-width: 820px;
      width: 100%;
      margin: 0 auto;
      padding: clamp(16px, 4vw, 32px) clamp(14px, 3vw, 24px) 60px;
      box-sizing: border-box;
    }

    /* Hero / Status Card */
    .order-card {
      background: var(--order-card);
      border: 1px solid var(--order-border);
      border-radius: 16px;
      padding: clamp(18px, 4vw, 28px);
      margin-bottom: 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
    }

    .order-hero-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--order-border);
    }

    .order-code-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .order-code-badge {
      font-family: monospace;
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: 0.03em;
      background: #0a0a0a;
      color: #ffffff;
      padding: 6px 14px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-copy-code {
      background: rgba(0, 0, 0, 0.05);
      border: 1px solid var(--order-border);
      border-radius: 8px;
      padding: 7px 12px;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s ease;
    }
    .btn-copy-code:hover {
      background: rgba(0, 0, 0, 0.09);
      color: #000;
    }

    /* Status Badges */
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 6px 14px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-badge--pending {
      background: #fff8e6;
      color: #996800;
      border: 1px solid #f1d289;
    }
    .status-badge--pending::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #e59c00;
      box-shadow: 0 0 0 3px rgba(229, 156, 0, 0.25);
      animation: pulseDot 1.8s infinite;
    }
    .status-badge--success {
      background: #edfbf2;
      color: #1b793f;
      border: 1px solid #b8ebca;
    }
    .status-badge--info {
      background: #f0f7ff;
      color: #1d61a8;
      border: 1px solid #bee0ff;
    }
    .status-badge--purple {
      background: #f8f0ff;
      color: #6c2eb9;
      border: 1px solid #e1c5fc;
    }
    .status-badge--danger {
      background: #fef0f0;
      color: #b32626;
      border: 1px solid #fcc;
    }

    @keyframes pulseDot {
      0% { transform: scale(0.9); opacity: 0.8; }
      50% { transform: scale(1.3); opacity: 1; }
      100% { transform: scale(0.9); opacity: 0.8; }
    }

    .order-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-top: 16px;
    }
    .order-date {
      font-size: 0.86rem;
      color: var(--text-muted);
    }
    .order-total-preview {
      text-align: right;
    }
    .order-total-label {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      font-weight: 600;
      display: block;
    }
    .order-total-val {
      font-size: 1.45rem;
      font-weight: 700;
      color: #0a0a0a;
      letter-spacing: -0.02em;
    }

    /* Notice Banner */
    .order-notice {
      background: var(--order-gold-bg);
      border: 1px solid var(--order-gold-border);
      border-radius: 12px;
      padding: 14px 18px;
      margin: 18px 0 0;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .order-notice-icon {
      font-size: 1.25rem;
      line-height: 1;
    }
    .order-notice-text {
      font-size: 0.85rem;
      line-height: 1.55;
      color: #4a3c18;
      margin: 0;
    }

    /* Section Titles */
    .section-title {
      font-family: var(--font-serif);
      font-size: 1.45rem;
      font-weight: 600;
      color: #0a0a0a;
      margin: 0 0 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-title-badge {
      font-family: var(--font-sans);
      font-size: 0.72rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-muted);
      background: rgba(0, 0, 0, 0.05);
      padding: 3px 10px;
      border-radius: 999px;
    }

    /* Products List */
    .items-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .item-card {
      display: flex;
      gap: clamp(14px, 3vw, 20px);
      padding: 16px;
      background: #faf9f6;
      border: 1px solid var(--order-border);
      border-radius: 12px;
      transition: border-color 0.2s ease, transform 0.15s ease;
    }
    .item-card:hover {
      border-color: var(--order-border-strong);
    }
    .item-thumb-wrapper {
      position: relative;
      width: clamp(80px, 18vw, 110px);
      height: clamp(80px, 18vw, 110px);
      border-radius: 10px;
      overflow: hidden;
      background: #ffffff;
      border: 1px solid var(--order-border);
      flex-shrink: 0;
      cursor: pointer;
    }
    .item-thumb-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      padding: 6px;
      box-sizing: border-box;
      transition: transform 0.3s ease;
    }
    .item-thumb-wrapper:hover img {
      transform: scale(1.08);
    }
    .item-thumb-zoom {
      position: absolute;
      bottom: 4px;
      right: 4px;
      background: rgba(0,0,0,0.65);
      color: #fff;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .item-thumb-wrapper:hover .item-thumb-zoom {
      opacity: 1;
    }

    .item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 0;
    }
    .item-brand {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: #888;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .item-name {
      font-size: clamp(0.95rem, 2vw, 1.1rem);
      font-weight: 600;
      color: #0a0a0a;
      line-height: 1.35;
      margin: 0 0 8px;
      word-break: break-word;
    }
    .item-specs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .spec-pill {
      font-size: 0.76rem;
      background: #ffffff;
      border: 1px solid var(--order-border);
      padding: 3px 8px;
      border-radius: 6px;
      color: var(--text-secondary);
    }
    .spec-pill strong {
      color: #0a0a0a;
      font-weight: 600;
    }
    .item-price-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px dashed rgba(0,0,0,0.08);
    }
    .item-qty-tag {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .item-price-val {
      font-size: 1.05rem;
      font-weight: 700;
      color: #0a0a0a;
    }

    /* Financial Summary Card */
    .summary-table {
      width: 100%;
      border-collapse: collapse;
    }
    .summary-table tr td {
      padding: 10px 0;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }
    .summary-table tr td:last-child {
      text-align: right;
      font-weight: 500;
      color: #0a0a0a;
    }
    .summary-table tr.total-row {
      border-top: 1px solid var(--order-border);
      border-bottom: 1px solid var(--order-border);
    }
    .summary-table tr.total-row td {
      padding: 16px 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: #0a0a0a;
    }
    .summary-table tr.total-row td:last-child {
      font-size: 1.45rem;
      color: #0a0a0a;
    }

    /* Steps Timeline */
    .timeline {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 20px 0 6px;
    }
    .timeline-step {
      text-align: center;
      position: relative;
    }
    .timeline-circle {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #eeeeee;
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.82rem;
      font-weight: 700;
      margin: 0 auto 8px;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 5px rgba(0,0,0,0.06);
    }
    .timeline-step.active .timeline-circle {
      background: #0a0a0a;
      color: #ffffff;
    }
    .timeline-step.completed .timeline-circle {
      background: #1b793f;
      color: #ffffff;
    }
    .timeline-label {
      font-size: 0.74rem;
      color: var(--text-muted);
      line-height: 1.3;
      font-weight: 500;
    }
    .timeline-step.active .timeline-label {
      color: #0a0a0a;
      font-weight: 600;
    }

    /* Action Buttons */
    .order-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 24px;
    }
    .btn-wpp-primary {
      background: #25D366;
      color: #ffffff;
      border: none;
      border-radius: 12px;
      padding: 16px 24px;
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      cursor: pointer;
      text-decoration: none;
      box-shadow: 0 4px 16px rgba(37, 211, 102, 0.28);
      transition: all 0.2s ease;
    }
    .btn-wpp-primary:hover {
      background: #20bd5a;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(37, 211, 102, 0.36);
    }
    .btn-secondary {
      background: #ffffff;
      color: #0a0a0a;
      border: 1px solid var(--order-border-strong);
      border-radius: 12px;
      padding: 14px 20px;
      font-size: 0.92rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .btn-secondary:hover {
      background: #f4f2ee;
    }

    /* Lightbox Modal */
    .lightbox-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.88);
      z-index: 99999;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .lightbox-modal.open {
      display: flex;
    }
    .lightbox-modal img {
      max-width: 90vw;
      max-height: 85vh;
      border-radius: 12px;
      object-fit: contain;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      border: none;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Footer */
    .order-footer {
      background: #ffffff;
      border-top: 1px solid var(--order-border);
      padding: 30px 20px;
      text-align: center;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
    .order-footer a {
      color: #0a0a0a;
      text-decoration: none;
      font-weight: 500;
    }

    @media (max-width: 600px) {
      .timeline {
        grid-template-columns: repeat(2, 1fr);
        gap: 14px;
      }
      .item-price-row {
        flex-direction: column;
        gap: 4px;
      }
    }
  </style>
</head>
<body>

  <!-- Top Strip -->
  <div class="top-strip">NT ELEGANZ — COMPROVANTE OFICIAL DE PEDIDO</div>

  <!-- Header -->
  <header class="order-header">
    <div class="order-header-inner">
      <a href="/" class="order-brand" aria-label="Ir para página inicial">
        <img src="assets/images/logonz-400.webp" alt="NT Eleganz" width="120" height="48" />
      </a>
      <nav class="order-header-nav">
        <a href="/collections/" class="order-header-link">Catálogo</a>
        <a href="javascript:void(0)" onclick="openStoreWhatsApp()" class="order-header-link" style="color:#1b793f;">Suporte</a>
      </nav>
    </div>
  </header>

  <!-- Main Content -->
  <main class="order-main">

    <!-- Card 1: Status & Top Info -->
    <div class="order-card">
      <div class="order-hero-top">
        <div class="order-code-group">
          <span class="order-code-badge" id="order-code-display"><?= htmlspecialchars($displayCode, ENT_QUOTES, 'UTF-8') ?></span>
          <button type="button" class="btn-copy-code" id="btn-copy-code" onclick="copyOrderCode()" title="Copiar código do pedido">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span id="copy-code-text">Copiar</span>
          </button>
        </div>

        <div class="status-badge <?= $statusInfo['class'] ?>" id="order-status-badge">
          <?= htmlspecialchars($statusInfo['label'], ENT_QUOTES, 'UTF-8') ?>
        </div>
      </div>

      <div class="order-meta-row">
        <div class="order-date" id="order-date-display">
          📅 Pedido realizado em <strong id="order-date-text"><?= date('d/m/Y \à\s H:i', strtotime($createdAt)) ?></strong>
        </div>
        <div class="order-total-preview">
          <span class="order-total-label">Total do Pedido</span>
          <span class="order-total-val" id="order-total-preview-val"><?= htmlspecialchars($totalValue ?: 'A calcular', ENT_QUOTES, 'UTF-8') ?></span>
        </div>
      </div>

      <div class="order-notice">
        <span class="order-notice-icon">💬</span>
        <p class="order-notice-text">
          <strong>Comprovante salvo com sucesso!</strong> Tanto você quanto nossa equipe de atendimento na NT Eleganz podem consultar este comprovante para conferir as peças, tamanhos, cores e fotos de alta resolução.
        </p>
      </div>

      <!-- Timeline de Acompanhamento -->
      <div class="timeline">
        <div class="timeline-step completed">
          <div class="timeline-circle">1</div>
          <div class="timeline-label">Pedido Registrado</div>
        </div>
        <div class="timeline-step <?= in_array($status, ['novo', 'pendente']) ? 'active' : 'completed' ?>">
          <div class="timeline-circle">2</div>
          <div class="timeline-label">Confirmação & Estoque</div>
        </div>
        <div class="timeline-step <?= in_array($status, ['aprovado', 'pago', 'preparando', 'enviado', 'entregue']) ? 'completed' : '' ?>">
          <div class="timeline-circle">3</div>
          <div class="timeline-label">Pagamento</div>
        </div>
        <div class="timeline-step <?= in_array($status, ['enviado', 'entregue']) ? 'completed' : '' ?>">
          <div class="timeline-circle">4</div>
          <div class="timeline-label">Envio & Rastreio</div>
        </div>
      </div>
    </div>

    <!-- Card 2: Lista Detalhada de Itens -->
    <div class="order-card">
      <div class="section-title">
        <span>Itens do Pedido</span>
        <span class="section-title-badge" id="items-count-badge"><?= count($items) ?> <?= count($items) === 1 ? 'item' : 'itens' ?></span>
      </div>

      <div class="items-list" id="items-container">
        <?php if (!empty($items)): ?>
          <?php foreach ($items as $item): 
            $itemBrand = htmlspecialchars($item['brand'] ?? 'NT Eleganz', ENT_QUOTES, 'UTF-8');
            $itemName = htmlspecialchars($item['name'] ?? 'Produto', ENT_QUOTES, 'UTF-8');
            $itemSize = htmlspecialchars($item['size'] ?? '', ENT_QUOTES, 'UTF-8');
            $itemColor = htmlspecialchars($item['color'] ?? '', ENT_QUOTES, 'UTF-8');
            $itemQty = (int)($item['qty'] ?? 1);
            $itemPrice = htmlspecialchars($item['price'] ?? '', ENT_QUOTES, 'UTF-8');
            $itemImg = !empty($item['image']) ? $item['image'] : 'assets/images/banner.webp';
            if (strpos($itemImg, 'http') !== 0 && strpos($itemImg, '/') !== 0) {
                $itemImg = '/' . $itemImg;
            }
          ?>
            <div class="item-card">
              <div class="item-thumb-wrapper" onclick="openLightbox('<?= htmlspecialchars($itemImg, ENT_QUOTES, 'UTF-8') ?>')">
                <img src="<?= htmlspecialchars($itemImg, ENT_QUOTES, 'UTF-8') ?>" alt="<?= $itemName ?>" loading="lazy" />
                <span class="item-thumb-zoom">🔍 Zoom</span>
              </div>
              <div class="item-info">
                <div>
                  <div class="item-brand"><?= $itemBrand ?></div>
                  <h3 class="item-name"><?= $itemName ?></h3>
                  <div class="item-specs">
                    <?php if ($itemSize !== ''): ?>
                      <span class="spec-pill">Tamanho: <strong><?= $itemSize ?></strong></span>
                    <?php endif; ?>
                    <?php if ($itemColor !== ''): ?>
                      <span class="spec-pill">Cor: <strong><?= $itemColor ?></strong></span>
                    <?php endif; ?>
                    <span class="spec-pill">Qtd: <strong><?= $itemQty ?> un</strong></span>
                  </div>
                </div>
                <div class="item-price-row">
                  <span class="item-qty-tag"><?= $itemQty ?>x <?= $itemPrice ?></span>
                  <span class="item-price-val"><?= $itemPrice ?></span>
                </div>
              </div>
            </div>
          <?php endforeach; ?>
        <?php else: ?>
          <div style="text-align:center; padding: 30px; color: var(--text-muted);" id="loading-state">
            <div style="font-size: 28px; margin-bottom: 8px;">⏳</div>
            <p>Carregando detalhes do pedido...</p>
          </div>
        <?php endif; ?>
      </div>
    </div>

    <!-- Card 3: Resumo Financeiro -->
    <div class="order-card">
      <div class="section-title">
        <span>Resumo Financeiro</span>
      </div>
      <table class="summary-table">
        <tbody>
          <tr>
            <td>Subtotal dos produtos</td>
            <td id="summary-subtotal"><?= htmlspecialchars($totalValue ?: 'A calcular', ENT_QUOTES, 'UTF-8') ?></td>
          </tr>
          <tr>
            <td>Envio / Frete</td>
            <td><span style="color:#1b793f; font-weight:600;">A combinar via WhatsApp</span></td>
          </tr>
          <tr>
            <td>Formas de Pagamento</td>
            <td>Pix com aprovação imediata ou Cartão</td>
          </tr>
          <tr class="total-row">
            <td>Valor Total</td>
            <td id="summary-total"><?= htmlspecialchars($totalValue ?: 'A calcular', ENT_QUOTES, 'UTF-8') ?></td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Card 4: Ações Imediatas -->
    <div class="order-actions">
      <a href="javascript:void(0)" onclick="openStoreWhatsApp()" class="btn-wpp-primary">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
        </svg>
        <span>Conversar sobre este Pedido no WhatsApp</span>
      </a>

      <button type="button" class="btn-secondary" onclick="shareOrderLink()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="18" cy="5" r="3"></circle>
          <circle cx="6" cy="12" r="3"></circle>
          <circle cx="18" cy="19" r="3"></circle>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>
        <span id="share-btn-text">Copiar Link do Comprovante</span>
      </button>

      <a href="/collections/" class="btn-secondary">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        <span>Continuar Comprando no Site</span>
      </a>
    </div>

  </main>

  <!-- Lightbox Modal -->
  <div class="lightbox-modal" id="lightbox-modal" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()" aria-label="Fechar">&times;</button>
    <img id="lightbox-img" src="" alt="Foto ampliada da peça" onclick="event.stopPropagation()" />
  </div>

  <!-- ══════════════════════════════════════════
       FOOTER
  ══════════════════════════════════════════ -->
  <footer class="site-footer" role="contentinfo">
    <div class="container container--wide">
      <div class="footer-top">

        <div class="footer-brand-col">
          <a href="/" class="footer-logo" aria-label="NT Eleganz"><img src="assets/images/logonz-400.webp" width="1983"
              height="793" alt="NT Eleganz" /></a>
          <p class="footer-tagline">
            Grifes 100% originais e autenticadas. Moda de luxo com atendimento exclusivo via WhatsApp.
          </p>
          <div class="footer-social-row">
            <a href="https://www.instagram.com/nteleganz/" class="footer-social-link"
              aria-label="Instagram da NT Eleganz" target="_blank" rel="noopener noreferrer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <a href="#" class="footer-social-link" aria-label="WhatsApp"
              onclick="window.ntWpp?.openGreeting(); return false;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
              </svg>
            </a>
          </div>
        </div>

        <div class="footer-col">
          <div class="footer-col-title">Navegação</div>
          <nav class="footer-links" aria-label="Links do footer">
            <a href="/" class="footer-link">Início</a>
            <a href="/collections/" class="footer-link">Collections</a>
            <a href="/collections/calcados/" class="footer-link">Calçados</a>
            <a href="/#faq" class="footer-link">FAQ</a>
            <a href="/#clausula-de-compra" class="footer-link">Cláusula de compra</a>
          </nav>
        </div>

        <div class="footer-col">
          <div class="footer-col-title">Marcas</div>
          <nav class="footer-links" aria-label="Marcas disponíveis">
            <span class="footer-link">Moncler</span>
            <span class="footer-link">Polo Ralph Lauren</span>
            <span class="footer-link">All Saints</span>
            <span class="footer-link">Birkenstock</span>
            <span class="footer-link">Sundek</span>
            <span class="footer-link">Vilebrequin</span>
          </nav>
        </div>

        <div class="footer-col">
          <div class="footer-col-title">Contato</div>
          <div class="footer-links">
            <a href="#" class="footer-link footer-link--icon" onclick="window.ntWpp?.openGreeting(); return false;">
              <svg class="footer-contact-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor"
                  d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
              </svg>
            </a>
            <span class="footer-link" style="color: var(--text-muted);">Seg–Sex: 9h às 18h</span>
            <span class="footer-link" style="color: var(--text-muted);">Sáb: 9h às 13h</span>
          </div>
        </div>

      </div>

      <div class="footer-bottom">
        <p class="footer-copyright">© 2026 NT Eleganz. Todos os direitos reservados. CNPJ: 69.640.668/0001-08.</p>
        <div class="footer-dev">
          <span class="footer-dev-label">Desenvolvido por</span>
          <a href="https://www.instagram.com/lspktech" target="_blank" rel="noopener noreferrer" class="footer-dev-link" title="LSPK Technology no Instagram">
            <img src="assets/images/lspk-logo.svg" width="420" height="104" alt="LSPK Technology" class="footer-dev-logo">
          </a>
        </div>
        <div class="footer-bottom-links">
          <a href="#">Política de Privacidade</a>
          <a href="#">Termos de Uso</a>
          <a href="#">Trocas e Devoluções</a>
        </div>
      </div>
    </div>
  </footer>

  <script>
    // Parâmetros e estado
    const currentCode = <?= json_encode($cleanCode) ?>;
    const currentDisplayCode = <?= json_encode($displayCode) ?>;
    let orderData = <?= json_encode($order) ?>;
    const defaultWhatsApp = '5575999283496';

    function getStoreWhatsApp() {
      try {
        const s = JSON.parse(localStorage.getItem('nte_wpp_settings') || '{}');
        if (s && s.number) return String(s.number).replace(/\D/g, '') || defaultWhatsApp;
      } catch (e) {}
      return defaultWhatsApp;
    }

    function openStoreWhatsApp() {
      const num = getStoreWhatsApp();
      const code = orderData?.code || currentDisplayCode;
      const msg = `Olá! Gostaria de falar sobre o meu pedido *${code}* na NT Eleganz: ${window.location.href}`;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
    }

    function copyOrderCode() {
      const code = orderData?.code || currentDisplayCode;
      navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copy-code-text');
        if (btn) {
          const old = btn.textContent;
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = old; }, 2000);
        }
      }).catch(() => {
        alert('Código: ' + code);
      });
    }

    function shareOrderLink() {
      const url = window.location.href;
      if (navigator.share) {
        navigator.share({
          title: `Pedido ${orderData?.code || currentDisplayCode} — NT Eleganz`,
          text: `Confira os detalhes e fotos do pedido ${orderData?.code || currentDisplayCode} na NT Eleganz:`,
          url: url,
        }).catch(() => {});
      } else {
        navigator.clipboard.writeText(url).then(() => {
          const btn = document.getElementById('share-btn-text');
          if (btn) {
            const old = btn.textContent;
            btn.textContent = 'Link Copiado com Sucesso!';
            setTimeout(() => { btn.textContent = old; }, 2500);
          }
        });
      }
    }

    function openLightbox(src) {
      const modal = document.getElementById('lightbox-modal');
      const img = document.getElementById('lightbox-img');
      if (modal && img && src) {
        img.src = src;
        modal.classList.add('open');
      }
    }

    function closeLightbox() {
      const modal = document.getElementById('lightbox-modal');
      if (modal) modal.classList.remove('open');
    }

    // Client-side hydration se não renderizado pelo PHP ou atualizado em tempo real
    async function hydrateFromClient() {
      if (!orderData && currentCode) {
        // 1. Tenta recuperar do localStorage (instantâneo se o pedido acabou de ser enviado pelo próprio cliente)
        try {
          const cached = localStorage.getItem(`nte_order_${currentCode}`) || localStorage.getItem('nte_last_order');
          if (cached) {
            const parsed = JSON.parse(cached);
            const parsedCode = (parsed.code || '').replace('#', '').toUpperCase();
            if (parsedCode === currentCode || !currentCode) {
              renderOrderUI(parsed);
              orderData = parsed;
            }
          }
        } catch (e) {}

        // 2. Busca na API de pedidos da Hostinger
        try {
          const res = await fetch(`/api/orders.php?code=${encodeURIComponent(currentCode)}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data && data.order) {
              orderData = data.order;
              renderOrderUI(data.order);
            }
          }
        } catch (err) {
          console.warn('Tentativa de busca do pedido:', err);
        }
      }
    }

    function renderOrderUI(order) {
      if (!order) return;
      
      const code = order.code || currentDisplayCode;
      document.getElementById('order-code-display').textContent = code;
      
      if (order.createdAt) {
        try {
          const d = new Date(order.createdAt);
          document.getElementById('order-date-text').textContent = d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        } catch(e) {}
      }

      if (order.value) {
        document.getElementById('order-total-preview-val').textContent = order.value;
        document.getElementById('summary-subtotal').textContent = order.value;
        document.getElementById('summary-total').textContent = order.value;
      }

      // Renderiza itens
      const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [{
        brand: order.productBrand || 'NT Eleganz',
        name: order.productName || 'Produto',
        size: order.size || '',
        color: order.color || '',
        qty: order.quantity || 1,
        price: order.value || '',
        image: order.imageUrl || 'assets/images/banner.webp'
      }];

      document.getElementById('items-count-badge').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;

      const container = document.getElementById('items-container');
      container.innerHTML = items.map(item => {
        const brand = item.brand || 'NT Eleganz';
        const name = item.name || 'Produto';
        const size = item.size ? `<span class="spec-pill">Tamanho: <strong>${item.size}</strong></span>` : '';
        const color = item.color ? `<span class="spec-pill">Cor: <strong>${item.color}</strong></span>` : '';
        const qty = item.qty || 1;
        const price = item.price || '';
        let img = item.image || 'assets/images/banner.webp';
        if (!img.startsWith('http') && !img.startsWith('/')) img = '/' + img;

        return `
          <div class="item-card">
            <div class="item-thumb-wrapper" onclick="openLightbox('${img}')">
              <img src="${img}" alt="${name}" loading="lazy" />
              <span class="item-thumb-zoom">🔍 Zoom</span>
            </div>
            <div class="item-info">
              <div>
                <div class="item-brand">${brand}</div>
                <h3 class="item-name">${name}</h3>
                <div class="item-specs">
                  ${size}
                  ${color}
                  <span class="spec-pill">Qtd: <strong>${qty} un</strong></span>
                </div>
              </div>
              <div class="item-price-row">
                <span class="item-qty-tag">${qty}x ${price}</span>
                <span class="item-price-val">${price}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    document.addEventListener('DOMContentLoaded', hydrateFromClient);
  </script>
  <!-- Rastreamento & Marketing (Purchase Tracking) -->
  <script src="/js/tracking.js?v=20261107-dedup"></script>
  <script>
    (function () {
      const orderPayload = <?= json_encode([
        'code' => $displayCode,
        'value' => $totalValue,
        'items' => $items
      ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?>;

      function firePurchaseTrack() {
        if (window.nteTracking && typeof window.nteTracking.trackPurchase === 'function') {
          window.nteTracking.trackPurchase(orderPayload);
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', firePurchaseTrack);
      } else {
        firePurchaseTrack();
      }
    })();
  </script>
</body>
</html>
