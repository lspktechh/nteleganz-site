/**
 * NT ELEGANZ — MEUS PEDIDOS (Área do Cliente)
 * Permite ao cliente consultar seus pedidos, proteger sua conta com senha e acompanhar entregas.
 */

(function () {
  'use strict';

  function formatPhoneBR(value) {
    let raw = String(value || '').trim();
    raw = raw.replace(/^(\+?55|0055)/, '');
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('55') && (digits.length >= 12 || (digits.length === 11 && digits[2] !== '9'))) {
      digits = digits.slice(2);
    }
    if (digits.length > 11) digits = digits.slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }

  function formatDateBR(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  function getStatusBadge(status) {
    const s = String(status || 'novo').toLowerCase();
    switch (s) {
      case 'confirmado':
        return `
          <span style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:4px 9px;border-radius:6px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Confirmado
          </span>`;
      case 'enviado':
        return `
          <span style="background:#fefce8;color:#a16207;border:1px solid #fef08a;padding:4px 9px;border-radius:6px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Enviado
          </span>`;
      case 'entregue':
        return `
          <span style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;padding:4px 9px;border-radius:6px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Entregue
          </span>`;
      case 'cancelado':
        return `
          <span style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:4px 9px;border-radius:6px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Cancelado
          </span>`;
      default:
        return `
          <span style="background:#faf8f5;color:#9c7a28;border:1px solid #ebd9b5;padding:4px 9px;border-radius:6px;font-size:0.75rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Em Separação
          </span>`;
    }
  }

  function getCustomerSession() {
    try {
      return JSON.parse(localStorage.getItem('nte_customer_profile') || 'null');
    } catch {
      return null;
    }
  }

  function saveCustomerSession(data) {
    try {
      const existing = getCustomerSession() || {};
      localStorage.setItem('nte_customer_profile', JSON.stringify({ ...existing, ...data }));
    } catch {}
  }

  function clearCustomerSession() {
    try {
      localStorage.removeItem('nte_customer_profile');
    } catch {}
  }

  function injectStyles() {
    if (document.getElementById('nte-customer-orders-styles')) return;
    const style = document.createElement('style');
    style.id = 'nte-customer-orders-styles';
    style.textContent = `
      .nte-co-overlay {
        position: fixed !important;
        inset: 0 !important;
        z-index: 999998 !important;
        background: rgba(0, 0, 0, 0.75) !important;
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
      .nte-co-card {
        background: #ffffff !important;
        border: 1px solid rgba(0, 0, 0, 0.08) !important;
        border-radius: 16px !important;
        max-width: 580px !important;
        width: 100% !important;
        max-height: 90vh !important;
        display: flex !important;
        flex-direction: column !important;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(0, 0, 0, 0.06) !important;
        color: #1a1a1a !important;
        animation: nteSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
      }
      .nte-co-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 18px 22px !important;
        border-bottom: 1px solid #f0ede6 !important;
        background: #faf8f5 !important;
      }
      .nte-co-title {
        margin: 0 !important;
        font-size: 1.1rem !important;
        font-weight: 600 !important;
        color: #111111 !important;
        letter-spacing: -0.01em !important;
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
      .nte-co-close {
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
      .nte-co-close:hover {
        background: #e5e0d5 !important;
        color: #111111 !important;
      }
      .nte-co-body {
        padding: 22px !important;
        overflow-y: auto !important;
        box-sizing: border-box !important;
        flex: 1 !important;
        background: #ffffff !important;
      }
      .nte-co-order-card {
        background: #ffffff !important;
        border: 1px solid #eae6de !important;
        border-radius: 12px !important;
        padding: 16px !important;
        margin-bottom: 14px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02) !important;
        transition: border-color 0.15s ease, box-shadow 0.15s ease !important;
      }
      .nte-co-order-card:hover {
        border-color: #c9a84c !important;
        box-shadow: 0 4px 14px rgba(201, 168, 76, 0.12) !important;
      }
      .nte-co-order-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: flex-start !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
        margin-bottom: 12px !important;
      }
      .nte-co-items-list {
        display: grid !important;
        gap: 10px !important;
        margin-bottom: 14px !important;
      }
      .nte-co-item-row {
        display: flex !important;
        align-items: center !important;
        gap: 12px !important;
        padding: 6px 0 !important;
      }
      .nte-co-item-thumb {
        width: 44px !important;
        height: 44px !important;
        border-radius: 8px !important;
        object-fit: cover !important;
        border: 1px solid #ebd9b5 !important;
        background: #fafaf9 !important;
        flex-shrink: 0 !important;
      }
      .nte-co-footer-actions {
        display: flex !important;
        justify-content: flex-end !important;
        gap: 10px !important;
        flex-wrap: wrap !important;
        padding-top: 10px !important;
        border-top: 1px solid #f0ede6 !important;
      }
      .nte-co-btn {
        padding: 8px 14px !important;
        border-radius: 8px !important;
        font-size: 0.85rem !important;
        font-weight: 600 !important;
        text-decoration: none !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        transition: all 0.15s ease !important;
      }
      .nte-co-btn--gold {
        background: #c9a84c !important;
        color: #111111 !important;
        border: none !important;
      }
      .nte-co-btn--gold:hover {
        background: #dfbe65 !important;
      }
      .nte-co-btn--outline {
        background: #ffffff !important;
        color: #111111 !important;
        border: 1px solid #d5d0c7 !important;
      }
      .nte-co-btn--outline:hover {
        border-color: #111111 !important;
        background: #111111 !important;
        color: #ffffff !important;
      }
      .nte-co-btn--wpp {
        background: #25d366 !important;
        color: #ffffff !important;
        border: none !important;
      }
      .nte-co-btn--wpp:hover {
        background: #20ba59 !important;
      }
      .nte-co-input {
        width: 100% !important;
        padding: 12px 14px !important;
        background: #fafaf9 !important;
        border: 1px solid #dcd8d0 !important;
        border-radius: 10px !important;
        color: #111111 !important;
        font-size: 0.95rem !important;
        outline: none !important;
        box-sizing: border-box !important;
        margin-bottom: 12px !important;
        transition: border-color 0.2s, box-shadow 0.2s, background 0.2s !important;
      }
      .nte-co-input:focus {
        background: #ffffff !important;
        border-color: #c9a84c !important;
        box-shadow: 0 0 0 3px rgba(201, 168, 76, 0.18) !important;
      }
      .nte-co-security-alert {
        background: #fffbeb !important;
        border: 1px solid #fde68a !important;
        border-radius: 12px !important;
        padding: 14px 16px !important;
        margin-bottom: 18px !important;
        box-shadow: 0 2px 6px rgba(217, 119, 6, 0.05) !important;
      }
      .nte-co-security-badge {
        background: #f0fdf4 !important;
        border: 1px solid #bbf7d0 !important;
        border-radius: 10px !important;
        padding: 12px 14px !important;
        margin-bottom: 18px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 10px !important;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  async function fetchCustomerOrders(contact) {
    const isEmail = contact.includes('@');
    const param = isEmail
      ? `client_email=${encodeURIComponent(contact.trim().toLowerCase())}`
      : `client_phone=${encodeURIComponent(contact.replace(/\D/g, ''))}`;

    const res = await fetch(`/api/orders.php?${param}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Não foi possível consultar os pedidos no momento.');
    const data = await res.json();
    return Array.isArray(data.orders) ? data.orders : [];
  }

  async function checkCustomerSecurityStatus(contact) {
    try {
      const isEmail = contact.includes('@');
      const param = isEmail
        ? `email=${encodeURIComponent(contact.trim().toLowerCase())}`
        : `phone=${encodeURIComponent(contact.replace(/\D/g, ''))}`;

      const res = await fetch(`/api/customer_auth.php?action=status&${param}`, { cache: 'no-store' });
      if (!res.ok) return { hasPassword: false };
      return await res.json();
    } catch {
      return { hasPassword: false };
    }
  }

  async function saveCustomerPassword(contact, name, password) {
    const isEmail = contact.includes('@');
    const payload = {
      phone: isEmail ? '' : contact,
      email: isEmail ? contact : '',
      name: name || 'Cliente',
      password: password
    };

    const res = await fetch('/api/customer_auth.php?action=set_password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao cadastrar senha.');
    }
    return data;
  }

  window.nteOpenCustomerOrders = function () {
    injectStyles();
    const existing = document.getElementById('nte-customer-orders-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nte-customer-orders-modal';
    overlay.className = 'nte-co-overlay';

    const session = getCustomerSession();
    const contactValue = session?.phone || session?.cleanPhone || session?.email || '';

    overlay.innerHTML = `
      <div class="nte-co-card">
        <div class="nte-co-header">
          <h3 class="nte-co-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="1.8">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>Meus Pedidos</span>
          </h3>
          <button class="nte-co-close" id="nte-co-close-btn">×</button>
        </div>
        <div class="nte-co-body" id="nte-co-body">
          <!-- Rendered dynamically -->
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#nte-co-close-btn')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const bodyEl = overlay.querySelector('#nte-co-body');

    if (contactValue) {
      loadAndRenderOrders(contactValue, session?.name || '');
    } else {
      renderLoginForm();
    }

    function renderLoginForm(errorMsg = '') {
      bodyEl.innerHTML = `
        <div style="text-align:center; padding:10px 0 20px 0;">
          <div style="width:52px; height:52px; border-radius:50%; background:#faf8f4; border:1px solid #ebd9b5; color:#9c7a28; display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <h4 style="margin:0 0 6px 0; font-size:1.15rem; color:#111111;">Consulte seus Pedidos</h4>
          <p style="margin:0; font-size:0.85rem; color:#666666; line-height:1.4;">
            Informe o número de WhatsApp ou E-mail utilizado na sua compra para acompanhar o status e detalhes do pedido.
          </p>
        </div>

        ${errorMsg ? `
          <div style="background:#fef2f2; border:1px solid #fecaca; color:#b91c1c; padding:10px 14px; border-radius:8px; font-size:0.83rem; margin-bottom:14px;">
            ${errorMsg}
          </div>
        ` : ''}

        <div>
          <label style="display:block; font-size:0.78rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:#555555; margin-bottom:6px;">
            WhatsApp ou E-mail
          </label>
          <input type="text" id="nte-co-contact-input" class="nte-co-input" placeholder="(00) 00000-0000 ou seu@email.com" />
          <button id="nte-co-search-btn" class="nte-co-btn nte-co-btn--gold" style="width:100%; padding:13px; font-size:0.95rem; justify-content:center; margin-top:4px;">
            <span>Consultar Pedidos</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      `;

      const input = bodyEl.querySelector('#nte-co-contact-input');
      const searchBtn = bodyEl.querySelector('#nte-co-search-btn');

      input?.addEventListener('input', (e) => {
        const val = e.target.value;
        if (!val.includes('@') && /^\d/.test(val)) {
          e.target.value = formatPhoneBR(val);
        }
      });

      const handleSearch = () => {
        const raw = (input?.value || '').trim();
        if (!raw || raw.length < 4) {
          renderLoginForm('Por favor, informe seu WhatsApp com DDD ou e-mail válido.');
          return;
        }
        saveCustomerSession({ phone: raw });
        loadAndRenderOrders(raw);
      };

      searchBtn?.addEventListener('click', handleSearch);
      input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });
      setTimeout(() => input?.focus(), 100);
    }

    async function loadAndRenderOrders(contact, customerName = '') {
      bodyEl.innerHTML = `
        <div style="text-align:center; padding:40px 20px;">
          <div style="display:inline-block; width:32px; height:32px; border:2px solid rgba(201,168,76,0.3); border-top-color:#c9a84c; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
          <p style="margin-top:12px; font-size:0.88rem; color:#666;">Buscando seus pedidos com segurança...</p>
        </div>
      `;

      try {
        const [orders, secStatus] = await Promise.all([
          fetchCustomerOrders(contact),
          checkCustomerSecurityStatus(contact)
        ]);

        const hasPassword = Boolean(secStatus?.hasPassword || getCustomerSession()?.hasPassword);

        if (!orders.length) {
          bodyEl.innerHTML = `
            <div style="text-align:center; padding:30px 10px;">
              <div style="width:52px; height:52px; border-radius:50%; background:#faf8f4; border:1px solid #ebd9b5; color:#9c7a28; display:flex; align-items:center; justify-content:center; margin:0 auto 12px auto;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
              </div>
              <h4 style="margin:0 0 6px 0; color:#111111;">Nenhum pedido encontrado</h4>
              <p style="font-size:0.85rem; color:#666666; margin:0 0 18px 0; line-height:1.45;">
                Não localizamos pedidos registrados para <strong>${contact}</strong>.<br />
                Certifique-se de que digitou o mesmo número ou e-mail usado ao comprar.
              </p>
              <div style="display:flex; justify-content:center; gap:10px;">
                <button id="nte-co-retry-btn" class="nte-co-btn nte-co-btn--outline">
                  Tentar outro número
                </button>
                <a href="/collections/" class="nte-co-btn nte-co-btn--gold" onclick="close()">
                  Ver Coleção
                </a>
              </div>
            </div>
          `;
          bodyEl.querySelector('#nte-co-retry-btn')?.addEventListener('click', () => {
            clearCustomerSession();
            renderLoginForm();
          });
          return;
        }

        const nameToDisplay = customerName || orders[0]?.client || secStatus?.name || 'Cliente';

        // Render Panel Header & Alert Section
        bodyEl.innerHTML = `
          <!-- Header de Identificação -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #f0ede6;">
            <div>
              <div style="font-size:0.95rem; font-weight:700; color:#111111;">
                Olá, ${nameToDisplay !== 'Cliente do site' ? nameToDisplay : 'Cliente'}!
              </div>
              <div style="font-size:0.8rem; color:#777777;">
                ${orders.length} pedido${orders.length > 1 ? 's' : ''} localizado${orders.length > 1 ? 's' : ''} para ${contact}
              </div>
            </div>
            <button id="nte-co-switch-btn" style="background:none; border:none; color:#9c7a28; font-size:0.8rem; text-decoration:underline; cursor:pointer; padding:4px 0;">
              Trocar contato / Sair
            </button>
          </div>

          <!-- Notificação Superior de Segurança / Criação de Senha -->
          <div id="nte-security-section-container">
            ${renderSecuritySection(hasPassword)}
          </div>

          <!-- Lista de Pedidos -->
          <div style="display:grid; gap:12px;">
            ${orders.map(order => {
              const code = order.code || `#NTE-${String(order.id).slice(-4).toUpperCase()}`;
              const cleanCode = code.replace('#', '');
              const items = Array.isArray(order.items) && order.items.length > 0 ? order.items : [{
                name: order.productName || 'Produto',
                brand: order.productBrand || '',
                size: order.size || '',
                color: order.color || '',
                qty: order.quantity || 1,
                price: order.value || '',
                image: order.imageUrl || ''
              }];

              return `
                <div class="nte-co-order-card">
                  <div class="nte-co-order-header">
                    <div>
                      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-family:monospace; font-weight:700; color:#9c7a28; font-size:0.95rem;">${code}</span>
                        <span style="font-size:0.75rem; color:#777777;">${formatDateBR(order.createdAt || order.created_at)}</span>
                      </div>
                    </div>
                    <div>
                      ${getStatusBadge(order.status)}
                    </div>
                  </div>

                  <div class="nte-co-items-list">
                    ${items.map(it => `
                      <div class="nte-co-item-row">
                        ${it.image ? `<img src="${it.image}" alt="" class="nte-co-item-thumb">` : `
                          <div class="nte-co-item-thumb" style="display:flex;align-items:center;justify-content:center;color:#9c7a28;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/>
                              <path d="M3 6h18"/>
                              <path d="M16 10a4 4 0 0 1-8 0"/>
                            </svg>
                          </div>
                        `}
                        <div style="flex:1; min-width:0;">
                          <div style="font-size:0.85rem; font-weight:600; color:#111111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                            ${it.brand ? `${it.brand} — ` : ''}${it.name || 'Produto'}
                          </div>
                          <div style="font-size:0.78rem; color:#666666; margin-top:2px;">
                            ${it.size ? `Tam: <strong>${it.size}</strong> ` : ''}
                            ${it.color ? `| Cor: <strong>${it.color}</strong> ` : ''}
                            ${Number(it.qty) > 1 ? `| Qtd: <strong>${it.qty}</strong>` : ''}
                          </div>
                        </div>
                        <div style="font-size:0.85rem; font-weight:600; color:#9c7a28;">
                          ${it.price || ''}
                        </div>
                      </div>
                    `).join('')}
                  </div>

                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding:8px 0; border-top:1px dashed #eae6de;">
                    <span style="font-size:0.82rem; color:#666666;">Total do Pedido:</span>
                    <strong style="color:#9c7a28; font-size:1rem;">${order.value || ''}</strong>
                  </div>

                  <div class="nte-co-footer-actions">
                    <a href="/order/${encodeURIComponent(cleanCode)}" target="_blank" class="nte-co-btn nte-co-btn--outline">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span>Ver Detalhes e Fotos</span>
                    </a>
                    <a href="https://wa.me/5575999283496?text=${encodeURIComponent(`Olá! Gostaria de informações sobre o meu pedido ${code}.`)}" target="_blank" class="nte-co-btn nte-co-btn--wpp">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                      </svg>
                      <span>Dúvidas no WhatsApp</span>
                    </a>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        setupSecurityEventListeners(contact, nameToDisplay);

        bodyEl.querySelector('#nte-co-switch-btn')?.addEventListener('click', () => {
          clearCustomerSession();
          renderLoginForm();
        });

      } catch (err) {
        renderLoginForm(err.message || 'Erro ao carregar pedidos.');
      }
    }

    function renderSecuritySection(hasPassword) {
      if (hasPassword) {
        return `
          <div class="nte-co-security-badge">
            <div style="display:flex;align-items:center;gap:10px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
              <div style="font-size:0.83rem;color:#166534;font-weight:600;">
                Cadastro protegido com senha de acesso exclusivo.
              </div>
            </div>
            <button id="nte-change-password-trigger" style="background:none;border:none;color:#15803d;font-size:0.8rem;text-decoration:underline;cursor:pointer;padding:0;">
              Alterar senha
            </button>
          </div>
        `;
      }

      return `
        <div id="nte-co-security-alert-box" class="nte-co-security-alert">
          <div style="display:flex;align-items:flex-start;gap:12px;">
            <div style="color:#d97706;margin-top:2px;flex-shrink:0;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.92rem;font-weight:700;color:#92400e;margin-bottom:3px;">
                Complete seu cadastro para mais segurança
              </div>
              <p style="margin:0 0 10px 0;font-size:0.82rem;color:#78350f;line-height:1.45;">
                Crie uma senha de acesso exclusivo para proteger seu histórico de pedidos e agilizar futuras compras em qualquer dispositivo.
              </p>
              <button type="button" id="nte-toggle-password-form-btn" class="nte-co-btn nte-co-btn--gold" style="padding:7px 14px;font-size:0.82rem;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>Criar Senha de Acesso</span>
              </button>
            </div>
          </div>

          <!-- Formulário expansível de senha -->
          <div id="nte-co-password-form" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid #fde68a;">
            <div style="display:grid;gap:10px;">
              <div>
                <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#78350f;margin-bottom:4px;">
                  Nova Senha (mínimo 6 dígitos)
                </label>
                <input type="password" id="nte-new-password" class="nte-co-input" style="margin-bottom:0;background:#ffffff;border-color:#fde68a;" placeholder="Digite sua senha" />
              </div>
              <div>
                <label style="display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;color:#78350f;margin-bottom:4px;">
                  Confirmar Nova Senha
                </label>
                <input type="password" id="nte-confirm-password" class="nte-co-input" style="margin-bottom:0;background:#ffffff;border-color:#fde68a;" placeholder="Repita a nova senha" />
              </div>
              <div id="nte-pwd-error" style="color:#b91c1c;font-size:0.8rem;display:none;"></div>
              <div style="display:flex;gap:8px;margin-top:4px;">
                <button type="button" id="nte-save-password-btn" class="nte-co-btn nte-co-btn--gold" style="padding:8px 16px;font-size:0.85rem;">
                  Salvar Senha
                </button>
                <button type="button" id="nte-cancel-password-btn" class="nte-co-btn nte-co-btn--outline" style="padding:8px 12px;font-size:0.85rem;">
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    function setupSecurityEventListeners(contact, nameToDisplay) {
      const container = document.getElementById('nte-security-section-container');
      if (!container) return;

      const toggleBtn = container.querySelector('#nte-toggle-password-form-btn');
      const formEl = container.querySelector('#nte-co-password-form');
      const cancelBtn = container.querySelector('#nte-cancel-password-btn');
      const saveBtn = container.querySelector('#nte-save-password-btn');
      const pwdInput = container.querySelector('#nte-new-password');
      const confirmInput = container.querySelector('#nte-confirm-password');
      const errEl = container.querySelector('#nte-pwd-error');
      const changeTrigger = container.querySelector('#nte-change-password-trigger');

      if (changeTrigger) {
        changeTrigger.addEventListener('click', () => {
          container.innerHTML = renderSecuritySection(false);
          setupSecurityEventListeners(contact, nameToDisplay);
          const newForm = container.querySelector('#nte-co-password-form');
          if (newForm) newForm.style.display = 'block';
        });
      }

      if (toggleBtn && formEl) {
        toggleBtn.addEventListener('click', () => {
          formEl.style.display = formEl.style.display === 'none' ? 'block' : 'none';
          if (formEl.style.display === 'block') pwdInput?.focus();
        });
      }

      if (cancelBtn && formEl) {
        cancelBtn.addEventListener('click', () => {
          formEl.style.display = 'none';
          if (errEl) errEl.style.display = 'none';
        });
      }

      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const p1 = (pwdInput?.value || '').trim();
          const p2 = (confirmInput?.value || '').trim();

          const showErr = (msg) => {
            if (errEl) {
              errEl.textContent = msg;
              errEl.style.display = 'block';
            }
          };

          if (!p1 || p1.length < 6) {
            showErr('A senha deve conter no mínimo 6 caracteres.');
            return;
          }

          if (p1 !== p2) {
            showErr('As senhas não coincidem. Digite a mesma senha em ambos os campos.');
            return;
          }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Salvando...';

          try {
            await saveCustomerPassword(contact, nameToDisplay, p1);
            saveCustomerSession({ hasPassword: true });
            container.innerHTML = renderSecuritySection(true);
            setupSecurityEventListeners(contact, nameToDisplay);
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar Senha';
            showErr(err.message || 'Erro ao salvar senha.');
          }
        });
      }
    }
  };
})();
