/* ============================================
   NT ELEGANZ — WHATSAPP LOGIC
   ============================================ */

const DEFAULT_WHATSAPP_NUMBER = '5575999283496';
let whatsappNumber = DEFAULT_WHATSAPP_NUMBER;

function normalizePhoneNumber(value) {
  return String(value || '').replace(/\D/g, '') || DEFAULT_WHATSAPP_NUMBER;
}

function loadConfiguredNumber() {
  try {
    const settings = JSON.parse(localStorage.getItem('nte_wpp_settings') || '{}');
    whatsappNumber = normalizePhoneNumber(settings.number);
  } catch { whatsappNumber = DEFAULT_WHATSAPP_NUMBER; }
}

/**
 * Generates a WhatsApp URL with a pre-filled message
 * @param {string} message - The message to pre-fill
 * @returns {string} - The WhatsApp URL
 */
function generateWhatsAppUrl(message) {
  return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
}

/**
 * Resumo de onde a pessoa veio (UTMs / clique de anúncio), lido do tracking.js.
 * Serve para o lojista ver a origem de cada lead/pedido no painel.
 */
function getCampaignOrigin() {
  try {
    const t = (window.nteTracking && typeof window.nteTracking.getTrackingData === 'function')
      ? window.nteTracking.getTrackingData() : {};
    const parts = [];
    if (t.utm_source) parts.push(`origem: ${t.utm_source}`);
    if (t.utm_medium) parts.push(`mídia: ${t.utm_medium}`);
    if (t.utm_campaign) parts.push(`campanha: ${t.utm_campaign}`);
    if (t.utm_content) parts.push(`criativo: ${t.utm_content}`);
    if (t.utm_term) parts.push(`termo: ${t.utm_term}`);
    if (!parts.length) {
      if (t.fbclid) parts.push('origem: facebook/meta (clique de anúncio)');
      else if (t.gclid) parts.push('origem: google ads (clique de anúncio)');
      else if (t.referrer) parts.push(`origem: ${t.referrer}`);
    }
    return parts.join(' · ');
  } catch (e) { return ''; }
}

function registerLead(data) {
  const lead = {
    source: 'whatsapp',
    status: 'novo',
    readAt: null,
    page: `${location.pathname}${location.search}`,
    ...data,
  };
  // Anexa a origem da campanha ao lead (coluna messagePreview já existe).
  const origin = getCampaignOrigin();
  if (origin) lead.messagePreview = `${lead.messagePreview ? lead.messagePreview + '\n\n' : ''}📍 ${origin}`;
  // The popup is opened synchronously by the caller; tracking must never stop contact.
  Promise.resolve(window.ntDB?.init())
    .then(() => window.ntDB?.leads?.add(lead))
    .catch(error => console.warn('Não foi possível registrar o lead:', error));
}

function registerOrder(data) {
  const order = {
    source: 'site',
    status: 'novo',
    client: 'Cliente do site',
    phone: '',
    size: '',
    color: '',
    ...data,
  };
  // Anexa a origem da campanha ao pedido (coluna notes já existe).
  const origin = getCampaignOrigin();
  if (origin) order.notes = `${order.notes ? order.notes + '\n' : ''}📍 ${origin}`;

  // Cache instantâneo local para que se o cliente ou lojista clicar no link imediatamente
  // a página de detalhes já encontre os dados em 0ms
  try {
    const cleanCode = (order.code || '').replace('#', '').toUpperCase();
    if (cleanCode) {
      localStorage.setItem(`nte_order_${cleanCode}`, JSON.stringify(order));
      localStorage.setItem('nte_last_order', JSON.stringify(order));
    }
  } catch (e) {}

  // The popup is opened synchronously by the caller; registering the order must
  // never block contact. Failures are silent (e.g. when the storefront is offline).
  Promise.resolve(window.ntDB?.init())
    .then(() => window.ntDB?.orders?.submit(order))
    .catch(error => {
      console.error('Falha ao registrar pedido via WhatsApp:', error);
      // Toast visível se houver admin logado
      if (window.showToast) showToast('⚠', 'Pedido não salvo', error.message);
    });
}

function getAbsoluteImageUrl(imagePath) {
  if (!imagePath || typeof imagePath !== 'string') return '';
  const trimmed = imagePath.trim();
  if (!trimmed || trimmed.startsWith('data:')) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  const cleanPath = trimmed.startsWith('/') ? trimmed.substring(1) : trimmed;
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://nteleganz.com.br';
  return `${origin}/${cleanPath}`;
}

function getProductImageUrl(product) {
  if (!product) return '';
  const candidate = product.image
    || (Array.isArray(product.images) && product.images[0])
    || product.imageUrl
    || '';
  return getAbsoluteImageUrl(candidate);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getProductCleanSlug(p, all) {
  if (!p) return '';
  const base = p.slug ? slugify(p.slug) : slugify(p.name);
  const catalog = Array.isArray(all) && all.length ? all : (window.NT_PRODUCTS || []);
  if (!catalog.length) return base;

  // Encontra todos os itens no catálogo com o mesmo base slug
  const duplicates = catalog.filter(item => (item.slug ? slugify(item.slug) : slugify(item.name)) === base);
  if (duplicates.length <= 1) {
    return base;
  }

  // Desempata por cor e tamanho
  const color = p.colors && p.colors[0] ? slugify(p.colors[0]) : '';
  const size = p.sizes && p.sizes[0] ? slugify(p.sizes[0]) : '';

  let candidate = base;
  if (color && size) candidate = `${base}-${color}-${size}`;
  else if (color) candidate = `${base}-${color}`;
  else if (size) candidate = `${base}-${size}`;

  const sameCandidate = catalog.filter(item => {
    const itemBase = item.slug ? slugify(item.slug) : slugify(item.name);
    const iColor = item.colors && item.colors[0] ? slugify(item.colors[0]) : '';
    const iSize = item.sizes && item.sizes[0] ? slugify(item.sizes[0]) : '';
    let c = itemBase;
    if (iColor && iSize) c = `${itemBase}-${iColor}-${iSize}`;
    else if (iColor) c = `${itemBase}-${iColor}`;
    else if (iSize) c = `${itemBase}-${iSize}`;
    return c === candidate;
  });

  if (sameCandidate.length <= 1) {
    return candidate;
  }

  // Se ainda houver duplicata idêntica, usa sufixo curto de 3 caracteres do ID
  const suffix = String(p.id || '').slice(-3);
  return suffix ? `${candidate}-${suffix}` : candidate;
}

function getProductPageUrl(product) {
  if (!product) return '';
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://nteleganz.com.br';

  if (typeof product === 'string') {
    const catalog = window.NT_PRODUCTS || [];
    const matched = catalog.find(p => String(p.id).toLowerCase() === product.toLowerCase());
    const slug = matched ? getProductCleanSlug(matched, catalog) : slugify(product);
    return `${origin}/products/?p=${encodeURIComponent(slug)}`;
  }

  const slug = getProductCleanSlug(product, window.NT_PRODUCTS);
  return `${origin}/products/?p=${encodeURIComponent(slug || product.id || '')}`;
}

function getProductCleanPhotoUrl(product) {
  if (!product) return '';
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://nteleganz.com.br';

  if (typeof product === 'string') {
    const catalog = window.NT_PRODUCTS || [];
    const matched = catalog.find(p => String(p.id).toLowerCase() === product.toLowerCase());
    const slug = matched ? getProductCleanSlug(matched, catalog) : slugify(product);
    return `${origin}/foto/${encodeURIComponent(slug)}.jpg`;
  }

  const slug = getProductCleanSlug(product, window.NT_PRODUCTS);
  if (slug) {
    return `${origin}/foto/${encodeURIComponent(slug)}.jpg`;
  }
  return getProductImageUrl(product);
}

/**
 * Opens WhatsApp with a direct greeting message
 */
function openWhatsAppGreeting() {
  const message = `Olá! Vim pelo site da NT Eleganz e gostaria de saber mais sobre os produtos.`;
  window.open(generateWhatsAppUrl(message), '_blank');
  registerLead({ type: 'atendimento', messagePreview: message });
}

/**
 * Opens WhatsApp with a specific product inquiry
/**
 * Customer Profile storage helpers
 */
function getSavedCustomerProfile() {
  try {
    return JSON.parse(localStorage.getItem('nte_customer_profile') || 'null');
  } catch (e) {
    return null;
  }
}

function saveCustomerProfile(profile) {
  try {
    if (profile && typeof profile === 'object') {
      localStorage.setItem('nte_customer_profile', JSON.stringify(profile));
    }
  } catch (e) {}
}

function formatPhoneBR(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

/**
 * Injects modal styles once into the page
 */
function injectCheckoutModalStyles() {
  if (document.getElementById('nte-checkout-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'nte-checkout-modal-styles';
  style.textContent = `
    .nte-modal-overlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 999999 !important;
      background: rgba(0, 0, 0, 0.78) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: clamp(12px, 3vw, 24px) !important;
      box-sizing: border-box !important;
      animation: nteFadeIn 0.2s ease-out !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    }
    .nte-modal-card {
      background: #ffffff !important;
      border: 1px solid rgba(0, 0, 0, 0.08) !important;
      border-radius: 16px !important;
      max-width: 480px !important;
      width: 100% !important;
      max-height: 90vh !important;
      overflow-y: auto !important;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.06) !important;
      color: #1a1a1a !important;
      animation: nteSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
      box-sizing: border-box !important;
    }
    .nte-modal-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 18px 22px !important;
      border-bottom: 1px solid #f0ede6 !important;
      background: #faf8f5 !important;
    }
    .nte-modal-title {
      margin: 0 !important;
      font-size: 1.05rem !important;
      font-weight: 600 !important;
      color: #111111 !important;
      letter-spacing: -0.01em !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
    }
    .nte-modal-close {
      background: #f2efe9 !important;
      border: none !important;
      color: #666666 !important;
      width: 32px !important;
      height: 32px !important;
      border-radius: 8px !important;
      font-size: 1.2rem !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      transition: all 0.15s ease !important;
    }
    .nte-modal-close:hover {
      background: #e5e0d5 !important;
      color: #111111 !important;
    }
    .nte-modal-body {
      padding: 22px !important;
      box-sizing: border-box !important;
      background: #ffffff !important;
    }
    .nte-item-summary-box {
      background: #fcfbf9 !important;
      border: 1px solid #ebd9b5 !important;
      border-radius: 12px !important;
      padding: 12px 14px !important;
      margin-bottom: 18px !important;
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
    }
    .nte-item-summary-thumb {
      width: 48px !important;
      height: 48px !important;
      border-radius: 8px !important;
      object-fit: cover !important;
      border: 1px solid #e5dcce !important;
      background: #f5f5f5 !important;
      flex-shrink: 0 !important;
    }
    .nte-form-group {
      margin-bottom: 14px !important;
    }
    .nte-form-label {
      display: block !important;
      font-size: 0.78rem !important;
      font-weight: 600 !important;
      text-transform: uppercase !important;
      letter-spacing: 0.05em !important;
      color: #555555 !important;
      margin-bottom: 6px !important;
    }
    .nte-form-label span.req {
      color: #b38e2d !important;
    }
    .nte-form-input {
      width: 100% !important;
      padding: 12px 14px !important;
      background: #fafaf9 !important;
      border: 1px solid #dcd8d0 !important;
      border-radius: 10px !important;
      color: #111111 !important;
      font-size: 0.95rem !important;
      outline: none !important;
      box-sizing: border-box !important;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s !important;
    }
    .nte-form-input:focus {
      background: #ffffff !important;
      border-color: #c9a84c !important;
      box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.18) !important;
    }
    .nte-form-hint {
      font-size: 0.75rem !important;
      color: #777777 !important;
      margin-top: 4px !important;
      display: block !important;
    }
    .nte-lgpd-box {
      background: #faf8f5 !important;
      border: 1px solid #ebd9b5 !important;
      border-radius: 10px !important;
      padding: 12px !important;
      margin: 16px 0 20px 0 !important;
    }
    .nte-lgpd-label {
      display: flex !important;
      align-items: flex-start !important;
      gap: 10px !important;
      cursor: pointer !important;
      font-size: 0.82rem !important;
      color: #444444 !important;
      line-height: 1.45 !important;
      user-select: none !important;
    }
    .nte-lgpd-label input[type="checkbox"] {
      margin-top: 2px !important;
      width: 17px !important;
      height: 17px !important;
      accent-color: #c9a84c !important;
      cursor: pointer !important;
      flex-shrink: 0 !important;
    }
    .nte-lgpd-link {
      color: #9c7a28 !important;
      text-decoration: underline !important;
      font-weight: 600 !important;
      cursor: pointer !important;
    }
    .nte-lgpd-link:hover {
      color: #7a5e19 !important;
    }
    .nte-btn-submit-wpp {
      width: 100% !important;
      padding: 14px 20px !important;
      background: #25d366 !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 10px !important;
      font-size: 0.98rem !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 10px !important;
      transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease !important;
      box-shadow: 0 4px 15px rgba(37, 211, 102, 0.28) !important;
    }
    .nte-btn-submit-wpp:hover {
      background: #20ba59 !important;
      transform: translateY(-1px) !important;
      box-shadow: 0 6px 20px rgba(37, 211, 102, 0.38) !important;
    }
    .nte-form-alert {
      background: #fef2f2 !important;
      border: 1px solid #fecaca !important;
      color: #b91c1c !important;
      padding: 10px 14px !important;
      border-radius: 8px !important;
      font-size: 0.82rem !important;
      margin-bottom: 14px !important;
      display: none;
    }
    @keyframes nteFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes nteSlideUp {
      from { opacity: 0; transform: translateY(12px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Opens LGPD Terms Modal
 */
function openLGPDModal() {
  injectCheckoutModalStyles();
  const existing = document.getElementById('nte-lgpd-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'nte-lgpd-modal-overlay';
  overlay.className = 'nte-modal-overlay';
  overlay.style.zIndex = '1000001';

  overlay.innerHTML = `
    <div class="nte-modal-card" style="max-width:540px;">
      <div class="nte-modal-header">
        <h3 class="nte-modal-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="1.8">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <span>Termos de Privacidade e LGPD</span>
        </h3>
        <button class="nte-modal-close" id="nte-lgpd-close">×</button>
      </div>
      <div class="nte-modal-body" style="font-size:0.88rem;line-height:1.6;color:#333;">
        <p style="margin-top:0;">
          A <strong>NT Eleganz</strong> preza pela transparência, privacidade e segurança dos seus dados, atuando em total conformidade com a <strong>Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 - LGPD)</strong>.
        </p>

        <div style="background:#faf8f4;border:1px solid #ebd9b5;border-radius:10px;padding:14px;margin:16px 0;">
          <strong style="color:#9c7a28;display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:0.92rem;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9c7a28" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Compromisso Expresso Anti-Telemarketing:
          </strong>
          <span style="color:#333;">
            Garantimos formal e expressamente que <strong>seus dados e número de telefone NUNCA serão comercializados, vendidos, alugados ou compartilhados</strong> com empresas de telemarketing, birôs de dados ou quaisquer terceiros. Seu contato é estritamente confidencial.
          </span>
        </div>

        <p><strong style="color:#111;">Finalidades Exclusivas do Uso:</strong></p>
        <ul style="padding-left:20px;margin:8px 0;display:grid;gap:6px;">
          <li>Processar a reserva e o atendimento do seu pedido com segurança;</li>
          <li>Enviar atualizações de status de envio, rastreio e confirmação via WhatsApp;</li>
          <li>Prestar atendimento personalizado e follow-up caso haja dúvidas sobre os produtos selecionados;</li>
          <li>Enviar novidades selecionadas e lançamentos exclusivos da NT Eleganz diretamente para você.</li>
        </ul>

        <p style="margin-top:14px;"><strong style="color:#111;">Seus Direitos (Art. 18 LGPD):</strong></p>
        <p style="font-size:0.82rem;color:#666;margin-bottom:18px;">
          Você pode a qualquer momento revogar o consentimento, solicitar a confirmação de tratamento ou a exclusão total dos seus dados de nossa base. Basta nos informar no WhatsApp respondendo "CANCELAR" ou entrando em contato com nosso time de atendimento.
        </p>

        <button id="nte-lgpd-accept-btn" style="
          width:100%;padding:12px;background:#c9a84c;color:#111;border:none;border-radius:10px;
          font-weight:700;font-size:0.92rem;cursor:pointer;transition:background 0.15s;
        " onmouseover="this.style.background='#dfbe65'" onmouseout="this.style.background='#c9a84c'">
          Entendi e Concordo
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    const cb = document.getElementById('nte-customer-lgpd');
    if (cb) cb.checked = true;
  };

  overlay.querySelector('#nte-lgpd-close')?.addEventListener('click', close);
  overlay.querySelector('#nte-lgpd-accept-btn')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

/**
 * Opens Customer Identification Modal before redirecting to WhatsApp
 */
function openCustomerCheckoutModal({ title, items, total, onConfirm }) {
  // Checkout SEM formulario: o cliente nao preenche mais nome/telefone/email.
  // Clicou em finalizar -> vai direto pro WhatsApp. A identificacao passa a
  // acontecer no proprio WhatsApp (o numero e o nome do cliente aparecem para
  // a loja), e o pedido continua rastreavel pelo numero do pedido + link de
  // conferencia que seguem na mensagem. A assinatura antiga foi mantida para
  // nao precisar mexer nos chamadores (orderProductViaWhatsApp / checkoutViaWhatsApp).
  if (typeof onConfirm === 'function') {
    onConfirm({ name: '', phone: '', cleanPhone: '', email: '' });
  }
}

/**
 * Opens WhatsApp with a direct greeting message
 */
function openWhatsAppGreeting() {
  const message = `Olá! Vim pelo site da NT Eleganz e gostaria de saber mais sobre os produtos.`;
  window.open(generateWhatsAppUrl(message), '_blank');
  registerLead({ type: 'atendimento', messagePreview: message });
}

/**
 * Opens WhatsApp with a specific product inquiry after customer identification
 * @param {Object} product - The product object
 * @param {string} size - Selected size
 * @param {string} color - Selected color
 * @param {number} qty - Selected quantity
 */
function orderProductViaWhatsApp(product, size = null, color = null, qty = null) {
  const quantity = Math.max(1, Math.floor(Number(qty) || 1));
  const orderNum = Math.floor(1000 + Math.random() * 9000);
  const orderCode = `#NTE-${orderNum}`;
  const cleanCode = `NTE-${orderNum}`;
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://nteleganz.com.br';
  const orderPageUrl = `${origin}/order/${cleanCode}`;
  const itemPhoto = getProductImageUrl(product) || getProductCleanPhotoUrl(product);

  const brand = product?.brand ? `${product.brand} — ` : '';
  const name = product?.name || 'Produto';

  const specs = [];
  if (size) specs.push(`Tamanho: ${size}`);
  if (color) specs.push(`Cor: ${color}`);
  if (quantity > 1) specs.push(`Qtd: ${quantity}`);
  const specsText = specs.length > 0 ? specs.join(' | ') : '';

  // Intercept with identification modal
  openCustomerCheckoutModal({
    title: 'Finalizar Pedido',
    items: [{
      id: product?.id || '',
      brand: product?.brand || '',
      name: product?.name || '',
      size: size,
      color: color,
      qty: quantity,
      price: product?.price || '',
      image: itemPhoto
    }],
    total: product?.price || '',
    onConfirm: (customer) => {
      let message = `Olá! Gostaria de fechar o seguinte pedido:\n\n`;
      message += `*Pedido:* ${orderCode}\n\n`;
      message += `*Produto:*\n`;
      message += `${brand}${name}\n`;
      if (specsText) message += `${specsText}\n`;
      if (product?.price) message += `Valor: ${product.price}\n`;
      message += `\n*Total:* ${product?.price || 'A combinar'}\n\n`;
      message += `*Fotos e detalhes completos do pedido:*\n`;
      message += `${orderPageUrl}\n\n`;
      message += `Poderia me confirmar a disponibilidade e o envio?`;

      // Open WhatsApp directly on customer submit click (synchronous to click)
      window.open(generateWhatsAppUrl(message), '_blank');

      // Conversão "foi pro WhatsApp" para Meta/Google (otimização do tráfego).
      if (window.nteTracking && typeof window.nteTracking.trackWhatsAppContact === 'function') {
        window.nteTracking.trackWhatsAppContact({
          items: [{ id: product?.id || '', name: product?.name || '', price: product?.price || '', qty: quantity }],
          value: product?.price || 0,
          productName: product?.name || ''
        });
      }

      registerLead({
        type: 'produto',
        client: customer.name,
        phone: customer.phone,
        email: customer.email,
        productId: product?.id || '',
        productName: product?.name || '',
        productBrand: product?.brand || '',
        size: size || '',
        color: color || '',
        quantity: quantity,
        value: product?.price || '',
        imageUrl: itemPhoto || '',
        messagePreview: message,
      });

      registerOrder({
        code: orderCode,
        client: customer.name,
        phone: customer.phone,
        email: customer.email,
        lgpdConsent: true,
        lgpdDate: customer.consentedAt || new Date().toISOString(),
        productId: product?.id || '',
        productBrand: product?.brand || '',
        productName: product?.name || '',
        size: size || '',
        color: color || '',
        quantity: quantity,
        value: product?.price || '',
        imageUrl: itemPhoto || '',
        items: [{
          id: product?.id || '',
          brand: product?.brand || '',
          name: product?.name || '',
          size: size || '',
          color: color || '',
          qty: quantity,
          price: product?.price || '',
          image: itemPhoto || '',
        }],
        notes: `Pedido direto pelo site${quantity > 1 ? ` — Qtd: ${quantity}` : ''}`,
      });
    }
  });
}

/**
 * Opens WhatsApp with the entire cart after customer identification
 * @param {Array} cartItems - Array of cart items
 * @param {string} total - Formatted total
 */
function checkoutViaWhatsApp(cartItems, total) {
  if (!cartItems || cartItems.length === 0) return;

  const orderNum = Math.floor(1000 + Math.random() * 9000);
  const orderCode = `#NTE-${orderNum}`;
  const cleanCode = `NTE-${orderNum}`;
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin
    : 'https://nteleganz.com.br';
  const orderPageUrl = `${origin}/order/${cleanCode}`;

  const formattedItems = cartItems.map(item => ({
    id: item.id || '',
    brand: item.brand || '',
    name: item.name || 'Produto',
    size: item.size || '',
    color: item.color || '',
    qty: Number(item.qty) || 1,
    price: item.price || '',
    image: getProductImageUrl(item) || getProductCleanPhotoUrl(item) || '',
  }));

  // Intercept with identification modal
  openCustomerCheckoutModal({
    title: 'Finalizar Pedido do Carrinho',
    items: formattedItems,
    total: total,
    onConfirm: (customer) => {
      let message = `Olá! Gostaria de fechar o meu pedido:\n\n`;
      message += `*Pedido:* ${orderCode}\n\n`;
      message += `*Itens do Pedido (${cartItems.length}):*\n\n`;

      cartItems.forEach((item, i) => {
        const quantity = Math.max(1, Math.floor(Number(item.qty) || 1));
        const brand = item.brand ? `${item.brand} — ` : '';
        const name = item.name || 'Produto';

        const specs = [];
        if (item.size) specs.push(`Tamanho: ${item.size}`);
        if (item.color) specs.push(`Cor: ${item.color}`);
        if (quantity > 1) specs.push(`Qtd: ${quantity}`);
        const specsText = specs.length > 0 ? specs.join(' | ') : '';

        message += `${i + 1}. ${brand}${name}\n`;
        if (specsText) message += `${specsText}\n`;
        if (item.price) message += `Valor: ${item.price}\n`;
        message += `\n`;
      });

      message += `*Total:* ${total}\n\n`;
      message += `*Fotos e detalhes completos do pedido:*\n`;
      message += `${orderPageUrl}\n\n`;
      message += `Aguardo a confirmação de disponibilidade e o pagamento. Obrigado!`;

      // Open WhatsApp directly on customer submit click (synchronous to click)
      window.open(generateWhatsAppUrl(message), '_blank');

      // Conversão "foi pro WhatsApp" para Meta/Google (otimização do tráfego).
      if (window.nteTracking && typeof window.nteTracking.trackWhatsAppContact === 'function') {
        window.nteTracking.trackWhatsAppContact({
          items: formattedItems,
          value: total,
          productName: 'Pedido do carrinho'
        });
      }

      registerLead({
        type: 'carrinho',
        client: customer.name,
        phone: customer.phone,
        email: customer.email,
        productName: cartItems.map(item => `${item.brand || 'NT Eleganz'} — ${item.name || 'Produto'}`).join(', '),
        value: total || '',
        itemCount: cartItems.length,
        messagePreview: message,
      });

      registerOrder({
        code: orderCode,
        client: customer.name,
        phone: customer.phone,
        email: customer.email,
        lgpdConsent: true,
        lgpdDate: customer.consentedAt || new Date().toISOString(),
        productId: cartItems[0]?.id || '',
        productBrand: cartItems[0]?.brand || '',
        productName: cartItems.map(item => `${item.brand || 'NT Eleganz'} — ${item.name || 'Produto'}`).join(' | '),
        size: cartItems.map(item => item.size).filter(Boolean).join(', ') || '',
        color: cartItems.map(item => item.color).filter(Boolean).join(', ') || '',
        quantity: cartItems.reduce((acc, it) => acc + (Number(it.qty) || 1), 0),
        value: total || '',
        imageUrl: formattedItems[0]?.image || '',
        items: formattedItems,
        notes: [
          ...cartItems.map((item, i) => {
            return `${i + 1}. ${item.brand || 'NT Eleganz'} — ${item.name || 'Produto'}${item.size ? ` | Tam: ${item.size}` : ''}${item.color ? ` | Cor: ${item.color}` : ''} | ${item.price}`;
          }),
          '',
          'Origem: checkout do carrinho (WhatsApp)',
        ].join('\n'),
      });
    }
  });
}

// Export globally
loadConfiguredNumber();
const api = {
  openGreeting: openWhatsAppGreeting,
  orderProduct: orderProductViaWhatsApp,
  checkout: checkoutViaWhatsApp,
  openCustomerModal: openCustomerCheckoutModal,
  openLGPDModal: openLGPDModal,
  getSavedProfile: getSavedCustomerProfile,
  saveProfile: saveCustomerProfile,
  formatPhoneBR: formatPhoneBR,
  url: generateWhatsAppUrl,
  getImageUrl: getProductImageUrl,
  getCleanPhotoUrl: getProductCleanPhotoUrl,
  getProductUrl: getProductPageUrl,
  getCleanSlug: getProductCleanSlug,
  slugify: slugify,
};
Object.defineProperty(api, '_number', { get: () => whatsappNumber, set: value => { whatsappNumber = normalizePhoneNumber(value); } });
Object.defineProperty(api, 'number', { get: () => whatsappNumber, set: value => { whatsappNumber = normalizePhoneNumber(value); } });
window.ntWpp = api;

