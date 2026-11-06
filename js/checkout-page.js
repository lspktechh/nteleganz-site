/**
 * NT Eleganz — Luxury Dedicated Checkout Controller
 * Architecture: Standalone Page (/checkout/)
 * Integration: InfinitePay API Link Prefill • ViaCEP • Dynamic Shipping • Progress Tracker
 */

(function () {
  'use strict';

  // ── Constantes & Estado ──
  const CART_STORAGE_KEY = 'ntCartItems';
  const CUSTOMER_STORAGE_KEY = 'nte_saved_customer';
  const WHATSAPP_NUMBER = '5511993466170';

  let cartItems = [];
  let subtotal = 0;
  let shippingMethods = [];
  let selectedShipping = null;

  // ── Utilitários Monetários ──
  function fmtMoney(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  }

  function parsePrice(val) {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const clean = String(val).replace(/[^\d,.]/g, '');
    if (clean.includes(',')) {
      return parseFloat(clean.replace(/\./g, '').replace(',', '.')) || 0;
    }
    return parseFloat(clean) || 0;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ── Máscaras de Input ──
  function maskPhone(v) {
    v = v.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length > 10) return v.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (v.length > 6) return v.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
    if (v.length > 2) return v.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
    return v;
  }

  function maskCPF(v) {
    v = v.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
            .replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3')
            .replace(/(\d{3})(\d{1,3})/, '$1.$2');
  }

  function maskCEP(v) {
    v = v.replace(/\D/g, '');
    if (v.length > 8) v = v.substring(0, 8);
    return v.replace(/^(\d{5})(\d)/, '$1-$2');
  }

  // ── IndexedDB para Hidratação de Imagens Salvas no Carrinho ──
  async function loadIndexedDbImage(key) {
    if (!window.indexedDB || !key) return '';
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('nte_cart_images', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('images')) return resolve('');
          const tx = db.transaction('images', 'readonly');
          const getReq = tx.objectStore('images').get(key);
          getReq.onsuccess = () => resolve(getReq.result || '');
          getReq.onerror = () => resolve('');
        };
        req.onerror = () => resolve('');
      } catch (e) {
        resolve('');
      }
    });
  }

  // ── Carregamento do Carrinho ──
  async function loadCart() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      cartItems = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(cartItems)) cartItems = [];
    } catch (e) {
      cartItems = [];
    }

    if (cartItems.length === 0) {
      document.getElementById('chk-layout-grid').style.display = 'none';
      document.getElementById('chk-empty-card').style.display = 'block';
      return false;
    }

    // Hidrata imagens persistidas no IndexedDB se necessário
    await Promise.all(cartItems.map(async item => {
      if (!item.image && item.imageAssetKey) {
        const dbImg = await loadIndexedDbImage(item.imageAssetKey);
        if (dbImg) item.image = dbImg;
      }
    }));

    // Calcula subtotal
    subtotal = cartItems.reduce((acc, item) => {
      const p = parsePrice(item.price);
      const q = Math.max(1, Number(item.qty) || 1);
      return acc + (p * q);
    }, 0);

    renderCartSummary();

    // Rastreamento: InitiateCheckout para Meta Ads / GA4
    if (window.nteTracking && typeof window.nteTracking.trackInitiateCheckout === 'function') {
      window.nteTracking.trackInitiateCheckout(cartItems, subtotal);
    }

    return true;
  }

  // ── Renderização do Resumo dos Itens ──
  function renderCartSummary() {
    const listEl = document.getElementById('chk-items-container');
    const countEl = document.getElementById('chk-items-count');
    const subtotalEl = document.getElementById('chk-val-subtotal');

    if (!listEl) return;

    const totalQty = cartItems.reduce((acc, item) => acc + (Math.max(1, Number(item.qty) || 1)), 0);
    if (countEl) countEl.textContent = `${totalQty} ${totalQty === 1 ? 'item' : 'itens'}`;
    if (subtotalEl) subtotalEl.textContent = fmtMoney(subtotal);

    listEl.innerHTML = cartItems.map(item => {
      const img = item.image || (Array.isArray(item.images) ? item.images[0] : '') || '/assets/images/logo-black.png';
      const brand = escapeHtml(item.brand || 'NT ELEGANZ');
      const name = escapeHtml(item.name || 'Peça Exclusiva');
      const qty = Math.max(1, Number(item.qty) || 1);
      const priceUnit = parsePrice(item.price);
      const priceTotal = priceUnit * qty;

      const metaParts = [];
      if (item.size) metaParts.push(`Tam: ${escapeHtml(item.size)}`);
      if (item.color) metaParts.push(`Cor: ${escapeHtml(item.color)}`);
      metaParts.push(`Qtd: ${qty}`);

      return `
        <div class="chk-item-row">
          <img src="${escapeHtml(img)}" alt="${name}" class="chk-item-thumb" onerror="this.src='/assets/images/logo-black.png'" />
          <div class="chk-item-details">
            <div class="chk-item-brand">${brand}</div>
            <div class="chk-item-name" title="${name}">${name}</div>
            <div class="chk-item-meta">${metaParts.join(' • ')}</div>
          </div>
          <div class="chk-item-price">${fmtMoney(priceTotal)}</div>
        </div>
      `;
    }).join('');

    updateTotals();
  }

  // ── Carregamento Dinâmico das Formas de Entrega ──
  async function loadShippingMethods() {
    const listEl = document.getElementById('chk-shipping-list');
    const totalQty = cartItems.reduce((acc, item) => acc + (Math.max(1, Number(item.qty) || 1)), 0);
    try {
      const res = await fetch('/api/shipping_methods.php', { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.methods) && data.methods.length > 0) {
        shippingMethods = data.methods.filter(m => {
          if (m.active === false) return false;
          if (m.singleItemOnly && totalQty > 1) return false;
          return true;
        });
      }
    } catch (e) {
      console.warn('Usando métodos padrão de contingência:', e);
    }

    if (!shippingMethods || shippingMethods.length === 0) {
      shippingMethods = [
        { id: 'sedex', name: 'Sedex Express (Seguro Especial Incluso)', price: 38.00, deadline: '2 a 4 dias úteis', freeAbove: 1000 },
        { id: 'pac', name: 'Standard Nobre (PAC)', price: 22.00, deadline: '5 a 8 dias úteis', freeAbove: 600 }
      ];
    }

    renderShippingMethods();
  }

  function renderShippingMethods() {
    const listEl = document.getElementById('chk-shipping-list');
    if (!listEl) return;

    if ((!selectedShipping || !shippingMethods.some(m => m.id === selectedShipping.id)) && shippingMethods.length > 0) {
      selectedShipping = shippingMethods[0];
    }

    listEl.innerHTML = shippingMethods.map(m => {
      const isFree = m.freeAbove && subtotal >= m.freeAbove;
      const effectivePrice = isFree ? 0 : Number(m.price || 0);
      const isSelected = selectedShipping && selectedShipping.id === m.id;
      const priceDisplay = isFree
        ? '<span class="chk-shipping-free-tag">Cortesia</span>'
        : fmtMoney(effectivePrice);
      const singleItemTag = m.singleItemOnly
        ? '<span class="chk-shipping-badge-single" style="display:inline-block;margin-left:6px;font-size:10px;font-weight:700;color:#c9a84c;background:rgba(201,168,76,0.15);padding:1px 6px;border-radius:3px;border:1px solid rgba(201,168,76,0.3);letter-spacing:0.5px;text-transform:uppercase;">1 Peça</span>'
        : '';

      return `
        <div class="chk-shipping-item ${isSelected ? 'selected' : ''}" data-ship-id="${escapeHtml(m.id)}">
          <div class="chk-shipping-left">
            <div class="chk-radio-box">
              <span class="chk-radio-dot"></span>
            </div>
            <div class="chk-shipping-info">
              <h4>${escapeHtml(m.name)}${singleItemTag}</h4>
              <p>${escapeHtml(m.deadline || 'Prazo rápido')}</p>
            </div>
          </div>
          <div class="chk-shipping-price">${priceDisplay}</div>
        </div>
      `;
    }).join('');

    // Listener de clique nas opções
    listEl.querySelectorAll('.chk-shipping-item').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.shipId;
        const found = shippingMethods.find(m => m.id === id);
        if (found) {
          selectedShipping = found;
          renderShippingMethods();
          updateTotals();
          updateProgress();
        }
      });
    });

    updateTotals();
  }

  // ── Atualização dos Totais Gerais ──
  function updateTotals() {
    const shipValEl = document.getElementById('chk-val-shipping');
    const totalEl = document.getElementById('chk-val-total');

    let shipPrice = 0;
    if (selectedShipping) {
      const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
      shipPrice = isFree ? 0 : Number(selectedShipping.price || 0);
      if (shipValEl) {
        shipValEl.innerHTML = isFree ? '<span class="chk-shipping-free-tag">Cortesia</span>' : fmtMoney(shipPrice);
      }
    } else {
      if (shipValEl) shipValEl.textContent = 'A calcular';
    }

    const finalTotal = subtotal + shipPrice;
    if (totalEl) totalEl.textContent = fmtMoney(finalTotal);
  }

  // ── Consulta Instantânea de CEP via ViaCEP ──
  async function handleCepLookup(cepVal) {
    const clean = (cepVal || '').replace(/\D/g, '');
    if (clean.length !== 8) return;

    const spinner = document.getElementById('chk-cep-spinner');
    if (spinner) spinner.style.display = 'block';

    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setVal('chk-street', data.logradouro || '');
        setVal('chk-neighborhood', data.bairro || '');
        setVal('chk-city', data.localidade || '');
        setVal('chk-state', data.uf || '');

        // Auto-foco inteligente no número da residência
        const numInput = document.getElementById('chk-number');
        if (numInput && !numInput.value) {
          numInput.focus();
        }
      }
    } catch (e) {
      console.warn('Erro ao consultar ViaCEP:', e);
    } finally {
      if (spinner) spinner.style.display = 'none';
      updateProgress();
    }
  }

  // ── Barra de Progresso & Indicadores das Etapas ──
  function updateProgress() {
    const nameVal = getVal('chk-name');
    const emailVal = getVal('chk-email');
    const phoneVal = getVal('chk-phone').replace(/\D/g, '');
    const cpfVal = getVal('chk-cpf').replace(/\D/g, '');
    const cepVal = getVal('chk-cep').replace(/\D/g, '');
    const streetVal = getVal('chk-street');
    const numberVal = getVal('chk-number');

    const step1Ok = nameVal.length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal) && phoneVal.length >= 10 && cpfVal.length === 11;
    const step2Ok = cepVal.length === 8 && streetVal.length >= 2 && numberVal.length >= 1;
    const step3Ok = Boolean(selectedShipping);

    const stepNode1 = document.getElementById('step-node-1');
    const stepNode2 = document.getElementById('step-node-2');
    const stepNode3 = document.getElementById('step-node-3');
    const stepNode4 = document.getElementById('step-node-4');
    const fillEl = document.getElementById('chk-progress-fill');

    let percent = 20;
    if (step1Ok) percent = 45;
    if (step1Ok && step2Ok) percent = 75;
    if (step1Ok && step2Ok && step3Ok) percent = 100;

    if (fillEl) fillEl.style.width = `${percent}%`;

    if (stepNode1) {
      stepNode1.classList.toggle('completed', step1Ok);
      stepNode1.classList.toggle('active', !step1Ok);
    }
    if (stepNode2) {
      stepNode2.classList.toggle('completed', step2Ok);
      stepNode2.classList.toggle('active', step1Ok && !step2Ok);
    }
    if (stepNode3) {
      stepNode3.classList.toggle('completed', step3Ok);
      stepNode3.classList.toggle('active', step2Ok && !step3Ok);
    }
    if (stepNode4) {
      stepNode4.classList.toggle('active', step1Ok && step2Ok && step3Ok);
    }
  }

  // ── Obtenção e Validação dos Dados do Cliente ──
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  function validateCheckoutForm() {
    const name = getVal('chk-name');
    const email = getVal('chk-email');
    const phone = getVal('chk-phone').replace(/\D/g, '');
    const cpf = getVal('chk-cpf').replace(/\D/g, '');
    const cep = getVal('chk-cep').replace(/\D/g, '');
    const street = getVal('chk-street');
    const number = getVal('chk-number');

    if (name.length < 3) {
      alert('Por favor, informe seu Nome Completo.');
      document.getElementById('chk-name')?.focus();
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Por favor, informe um endereço de E-mail válido.');
      document.getElementById('chk-email')?.focus();
      return false;
    }
    if (phone.length < 10) {
      alert('Por favor, informe seu WhatsApp / Celular completo com DDD.');
      document.getElementById('chk-phone')?.focus();
      return false;
    }
    if (cpf.length !== 11) {
      alert('Por favor, informe um CPF válido (11 dígitos) para a nota fiscal e seguro do transporte.');
      document.getElementById('chk-cpf')?.focus();
      return false;
    }
    if (cep.length !== 8) {
      alert('Por favor, informe um CEP válido com 8 dígitos.');
      document.getElementById('chk-cep')?.focus();
      return false;
    }
    if (!street || !number) {
      alert('Por favor, preencha o logradouro e o número para a entrega.');
      document.getElementById('chk-number')?.focus();
      return false;
    }
    if (!selectedShipping) {
      alert('Por favor, selecione uma modalidade de frete.');
      return false;
    }
    return true;
  }

  function getCustomerPayload() {
    return {
      name: getVal('chk-name'),
      email: getVal('chk-email'),
      phone: getVal('chk-phone'),
      cpf: getVal('chk-cpf'),
      address: {
        cep: getVal('chk-cep'),
        street: getVal('chk-street'),
        number: getVal('chk-number'),
        complement: getVal('chk-complement'),
        neighborhood: getVal('chk-neighborhood'),
        city: getVal('chk-city'),
        state: getVal('chk-state')
      }
    };
  }

  // ── Finalização Oficial via Mercado Pago (PIX e Cartão até 12x) ──
  async function submitInfinitePay() {
    if (!validateCheckoutForm()) return;

    const btn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    const originalContent = btn ? btn.innerHTML : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="chk-btn-main-text" style="display:flex;align-items:center;gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite;"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
          Gerando Sessão Segura Mercado Pago...
        </span>
      `;
    }

    const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
    const effectiveShippingPrice = isFree ? 0 : Number(selectedShipping.price || 0);

    const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};

    const payload = {
      customer: getCustomerPayload(),
      items: cartItems,
      shipping: {
        ...selectedShipping,
        effectivePrice: effectiveShippingPrice
      },
      value: fmtMoney(subtotal + effectiveShippingPrice),
      tracking: trackingData
    };

    try {
      const res = await fetch('/api/mercadopago.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.checkoutUrl) {
        throw new Error(data.error || data.details || 'Falha ao comunicar com o gateway do Mercado Pago.');
      }

      // Salva dados do cliente para preenchimento futuro
      try {
        localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(payload.customer));
      } catch (e) {}

      // Limpa a mala de compras
      try {
        localStorage.removeItem(CART_STORAGE_KEY);
      } catch (e) {}

      // Redireciona imediatamente para o checkout pré-preenchido do Mercado Pago
      window.location.href = data.checkoutUrl;

    } catch (err) {
      console.error('Erro ao gerar checkout:', err);
      alert('Não foi possível gerar a sessão de pagamento no momento: ' + err.message + '\n\nVocê também pode concluir via Concierge no WhatsApp.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    }
  }

  // ── Finalização via Concierge no WhatsApp (Fallback Nobre) ──
  async function submitWhatsApp() {
    if (!validateCheckoutForm()) return;

    const customer = getCustomerPayload();
    const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
    const effectiveShippingPrice = isFree ? 0 : Number(selectedShipping.price || 0);
    const totalVal = fmtMoney(subtotal + effectiveShippingPrice);
    const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};

    // Registra pedido prévio na API
    const orderCode = 'NTE-' + Math.floor(1000 + Math.random() * 9000);
    const orderRecord = {
      code: '#' + orderCode,
      status: 'novo',
      value: totalVal,
      clientName: customer.name,
      phone: customer.phone,
      email: customer.email,
      customer: customer,
      items: cartItems,
      shipping: {
        ...selectedShipping,
        effectivePrice: effectiveShippingPrice
      },
      paymentMethod: 'whatsapp',
      paymentStatus: 'pending',
      tracking: trackingData
    };

    try {
      await fetch('/api/orders.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderRecord)
      });
    } catch (e) {}

    // Monta texto formatado e polido para a Concierge
    const lines = [
      `*NT ELEGANZ — NOVO PEDIDO #${orderCode}*`,
      ``,
      `*Cliente:* ${customer.name}`,
      `*WhatsApp:* ${customer.phone}`,
      `*E-mail:* ${customer.email}`,
      `*CPF:* ${customer.cpf}`,
      ``,
      `*Endereço de Entrega:*`,
      `${customer.address.street}, Nº ${customer.address.number}${customer.address.complement ? ' (' + customer.address.complement + ')' : ''}`,
      `${customer.address.neighborhood} — ${customer.address.city}/${customer.address.state}`,
      `CEP: ${customer.address.cep}`,
      ``,
      `*Itens Selecionados:*`
    ];

    cartItems.forEach(item => {
      const brand = item.brand ? `[${item.brand}] ` : '';
      const size = item.size ? ` (Tam: ${item.size})` : '';
      const color = item.color ? ` [Cor: ${item.color}]` : '';
      const qty = item.qty || 1;
      lines.push(`• ${brand}${item.name}${size}${color} — ${qty}x ${fmtMoney(parsePrice(item.price))}`);
    });

    lines.push(``);
    lines.push(`*Entrega:* ${selectedShipping.name} (${effectiveShippingPrice === 0 ? 'Cortesia' : fmtMoney(effectiveShippingPrice)})`);
    lines.push(`*Total a Pagar:* ${totalVal}`);
    lines.push(``);
    lines.push(`Gostaria de concluir meu pedido com o suporte da Concierge!`);

    // Limpa a mala
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch (e) {}

    const textEncoded = encodeURIComponent(lines.join('\n'));
    window.location.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${textEncoded}`;
  }

  // ── Preenchimento com Dados Salvos Anteriormente ──
  function restoreSavedCustomer() {
    try {
      const raw = localStorage.getItem(CUSTOMER_STORAGE_KEY);
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c.name) setVal('chk-name', c.name);
      if (c.email) setVal('chk-email', c.email);
      if (c.phone) setVal('chk-phone', maskPhone(c.phone));
      if (c.cpf) setVal('chk-cpf', maskCPF(c.cpf));
      if (c.address) {
        if (c.address.cep) setVal('chk-cep', maskCEP(c.address.cep));
        if (c.address.street) setVal('chk-street', c.address.street);
        if (c.address.number) setVal('chk-number', c.address.number);
        if (c.address.complement) setVal('chk-complement', c.address.complement);
        if (c.address.neighborhood) setVal('chk-neighborhood', c.address.neighborhood);
        if (c.address.city) setVal('chk-city', c.address.city);
        if (c.address.state) setVal('chk-state', c.address.state);
      }
    } catch (e) {}
  }

  // ── Inicialização ──
  document.addEventListener('DOMContentLoaded', async () => {
    const hasCart = await loadCart();
    if (!hasCart) return;

    restoreSavedCustomer();
    await loadShippingMethods();

    // Eventos de máscara e validação em tempo real
    const phoneInput = document.getElementById('chk-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', e => {
        e.target.value = maskPhone(e.target.value);
        updateProgress();
      });
    }

    const cpfInput = document.getElementById('chk-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', e => {
        e.target.value = maskCPF(e.target.value);
        updateProgress();
      });
    }

    const cepInput = document.getElementById('chk-cep');
    if (cepInput) {
      cepInput.addEventListener('input', e => {
        e.target.value = maskCEP(e.target.value);
        if (e.target.value.replace(/\D/g, '').length === 8) {
          handleCepLookup(e.target.value);
        }
        updateProgress();
      });
    }

    ['chk-name', 'chk-email', 'chk-street', 'chk-number', 'chk-neighborhood', 'chk-city', 'chk-state'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateProgress);
    });

    // Botões de submissão
    const btnInfinite = document.getElementById('chk-submit-infinitepay');
    if (btnInfinite) btnInfinite.addEventListener('click', submitInfinitePay);

    const btnWpp = document.getElementById('chk-submit-whatsapp');
    if (btnWpp) btnWpp.addEventListener('click', submitWhatsApp);

    updateProgress();
  });

})();
