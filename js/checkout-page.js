/**
 * NT Eleganz — Luxury Dedicated Checkout Controller (Checkout Transparente)
 * Processamento Direto no Checkout (Mercado Pago: Pix com QR Code na tela & Cartão em até 12x)
 * Sem redirecionamento para fora do site.
 */

(function () {
  'use strict';

  // ── Constantes & Estado ──
  const CART_STORAGE_KEY = 'ntCartItems';
  const CUSTOMER_STORAGE_KEY = 'nte_saved_customer';
  const WHATSAPP_NUMBER = '5575999283496';
  const MP_PUBLIC_KEY = 'APP_USR-c8d843d2-e8c4-4509-93a5-6c7a38be819e';

  let cartItems = [];
  let subtotal = 0;
  let shippingMethods = [];
  let selectedShipping = null;
  let selectedPaymentMethod = 'pix'; // 'pix' | 'card'

  let mpInstance = null;
  let pollingInterval = null;
  let countdownInterval = null;
  let currentPaymentId = null;
  let currentOrderCode = null;

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

  // ── Sanitizador Global Anti-Emoji (Checkout 100% Livre de Emojis) ──
  function stripEmojis(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/[\u{10000}-\u{10ffff}\u{2600}-\u{27bf}\u{fe00}-\u{fe0f}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Máscaras de Input ──
  function maskPhone(v) {
    let raw = String(v || '').trim();
    raw = raw.replace(/^(\+?55|0055)/, '');
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('55') && (digits.length >= 12 || (digits.length === 11 && digits[2] !== '9'))) {
      digits = digits.slice(2);
    }
    if (digits.length > 11) digits = digits.slice(0, 11);
    if (!digits) return '';
    if (digits.length > 10) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
    if (digits.length > 6) return digits.replace(/^(\d{2})(\d{4})(\d{0,4})$/, '($1) $2-$3');
    if (digits.length > 2) return digits.replace(/^(\d{2})(\d{0,5})$/, '($1) $2');
    return digits;
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

  function maskCardNumber(v) {
    v = v.replace(/\D/g, '');
    if (v.length > 16) v = v.substring(0, 16);
    return v.replace(/(\d{4})(?=\d)/g, '$1 ');
  }

  function maskExpiry(v) {
    v = v.replace(/\D/g, '');
    if (v.length > 4) v = v.substring(0, 4);
    if (v.length >= 3) return v.replace(/^(\d{2})(\d{1,2})$/, '$1/$2');
    return v;
  }

  const BRAND_BADGES_HTML = {
    visa: `<svg viewBox="0 0 32 20" width="22" height="14" style="vertical-align:middle;border-radius:2px;"><rect width="32" height="20" rx="2" fill="#fff"/><path d="M13 6l-2 8H9.3L7.7 8c-.1-.3-.2-.4-.4-.5-.6-.3-1.3-.5-1.9-.7l.1-.2h3c.4 0 .7.2.8.7l.7 4.1 1.9-4.8h2zm7.4 4.8c0-1.9-2.5-2-2.5-2.8 0-.2.2-.5.7-.6.3 0 1 .1 1.8.3l.3-1.5c-.4-.2-1-.3-1.7-.3-1.8 0-3 1-3 2.3 0 1 .8 1.6 1.5 1.9.7.3 1 .5 1 .9 0 .5-.6.7-1.1.7-.9 0-1.5-.2-1.9-.4l-.3 1.5c.4.2 1.2.3 2 .3 1.9 0 3.1-1 3.2-2.4zm4.7 2.3h1.9L25.6 6h-1.5c-.3 0-.6.2-.7.5L20.8 13h1.9l.4-1h2.3l.1 1.1zm-2-2.5l1-2.6.6 2.6h-1.6zm-7.6-4.6l-1.5 7.1H12.4L13.9 6h1.6z" fill="#1434cb"/></svg> <span>VISA</span>`,
    master: `<svg viewBox="0 0 32 20" width="22" height="14" style="vertical-align:middle;border-radius:2px;"><rect width="32" height="20" rx="2" fill="#1a1a1a"/><circle cx="12" cy="10" r="6" fill="#eb001b"/><circle cx="20" cy="10" r="6" fill="#f79e1b"/><path d="M16 6a5.9 5.9 0 0 0-2.2 4 5.9 5.9 0 0 0 2.2 4 5.9 5.9 0 0 0 2.2-4A5.9 5.9 0 0 0 16 6z" fill="#ff5f00"/></svg> <span>MASTERCARD</span>`,
    elo: `<svg viewBox="0 0 32 20" width="22" height="14" style="vertical-align:middle;border-radius:2px;"><rect width="32" height="20" rx="2" fill="#000"/><path d="M11 7c.4-.1.8-.2 1.2-.2 1.6 0 3 1.1 3.2 2.6l2.3-.4c-.5-2.5-2.8-4.4-5.5-4.4-.6 0-1.2.1-1.8.3l.6 2.1z" fill="#FFF100"/><path d="M8.3 14l1.5-1.7c-.7-.6-1.1-1.4-1.1-2.4s.4-1.8 1.1-2.4L8.3 5.8C7.1 6.8 6.4 8.3 6.4 10s.7 3.2 1.9 4z" fill="#00A3DF"/><path d="M15.4 10.5c-.3 1.5-1.6 2.6-3.2 2.6-.3 0-.7-.1-1-.2l-.7 2.1c.6.2 1.2.3 1.7.3 2.7 0 5-1.9 5.5-4.4l-2.3-.4z" fill="#EE4023"/><text x="21" y="12" fill="#fff" font-family="sans-serif" font-weight="900" font-size="6.5" text-anchor="middle">elo</text></svg> <span>ELO</span>`,
    amex: `<svg viewBox="0 0 32 20" width="22" height="14" style="vertical-align:middle;border-radius:2px;"><rect width="32" height="20" rx="2" fill="#006fcf"/><path d="M6 12h1.6l.3-.7h1.8l.3.7h1.7L9.9 6.5H7.8L6 12zm2.5-2.1l.6-1.4.6 1.4H8.5zm5.4 2.1h1.6V8.2l1.4 3.8h1.1l1.4-3.8v3.8h1.6V6.5h-2.3l-1.3 3.4-1.3-3.4H13.9V12zm8.2 0H26v-1.3h-2.6v-.9h2.3v-1.3h-2.3V7.8H26V6.5h-3.9v5.5z" fill="#fff"/></svg> <span>AMEX</span>`,
    hipercard: `<svg viewBox="0 0 32 20" width="22" height="14" style="vertical-align:middle;border-radius:2px;"><rect width="32" height="20" rx="2" fill="#b3131b"/><text x="16" y="13" fill="#fff" font-family="sans-serif" font-weight="800" font-style="italic" font-size="6" text-anchor="middle">HIPER</text></svg> <span>HIPERCARD</span>`,
    default: `<span>Cartão de Crédito</span>`
  };

  function detectCardBrand(num) {
    const clean = (num || '').replace(/\D/g, '');
    if (/^4/.test(clean)) return { id: 'visa', name: 'VISA', badgeHtml: BRAND_BADGES_HTML.visa };
    if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(clean)) return { id: 'master', name: 'MASTERCARD', badgeHtml: BRAND_BADGES_HTML.master };
    if (/^(4011|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(clean)) return { id: 'elo', name: 'ELO', badgeHtml: BRAND_BADGES_HTML.elo };
    if (/^3[47]/.test(clean)) return { id: 'amex', name: 'AMEX', badgeHtml: BRAND_BADGES_HTML.amex };
    if (/^(606282|3841)/.test(clean)) return { id: 'hipercard', name: 'HIPERCARD', badgeHtml: BRAND_BADGES_HTML.hipercard };
    return { id: 'visa', name: 'CARTÃO', badgeHtml: BRAND_BADGES_HTML.default };
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
      const img = item.image || (Array.isArray(item.images) ? item.images[0] : '') || '/assets/images/placeholder-product.svg';
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
          <img src="${escapeHtml(img)}" alt="${name}" class="chk-item-thumb" onerror="this.src='/assets/images/placeholder-product.svg'" />
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
        }).map(m => ({
          ...m,
          name: stripEmojis(m.name),
          deadline: stripEmojis(m.deadline)
        }));
      } else {
        // Fallback padrão
        shippingMethods = [
          { id: 'sedex', name: 'Sedex Express (Seguro Especial Incluso)', deadline: '2 a 4 dias úteis', price: 0, freeAbove: 0 },
          { id: 'pac', name: 'Standard Nobre (PAC)', deadline: '5 a 8 dias úteis', price: 0, freeAbove: 0 }
        ];
      }
    } catch (e) {
      shippingMethods = [
        { id: 'sedex', name: 'Sedex Express (Seguro Especial Incluso)', deadline: '2 a 4 dias úteis', price: 0, freeAbove: 0 }
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
      const cleanName = stripEmojis(m.name);
      const cleanDeadline = stripEmojis(m.deadline || 'Prazo rápido');
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
              <h4>${escapeHtml(cleanName)}${singleItemTag}</h4>
              <p>${escapeHtml(cleanDeadline)}</p>
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

  function getFinalTotalNumber() {
    let shipPrice = 0;
    if (selectedShipping) {
      const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
      shipPrice = isFree ? 0 : Number(selectedShipping.price || 0);
    }
    return Math.max(1, subtotal + shipPrice);
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

    updatePaymentButtonText();
    updateInstallmentsSimulation();
  }

  // ── Atualiza o texto do botão principal conforme o método ──
  function updatePaymentButtonText() {
    const btn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    if (!btn) return;

    const totalStr = fmtMoney(getFinalTotalNumber());
    if (selectedPaymentMethod === 'pix') {
      btn.innerHTML = `
        <span class="chk-btn-main-text">GERAR PIX DIRETO NO CHECKOUT (${totalStr})</span>
        <span class="chk-btn-sub-text">QR Code e Copia e Cola na tela • Confirmação instantânea</span>
      `;
    } else {
      const instSelect = document.getElementById('chk-card-installments');
      const instVal = instSelect ? instSelect.value : '1';
      btn.innerHTML = `
        <span class="chk-btn-main-text">PAGAR COM CARTÃO EM ATÉ 12X (${totalStr})</span>
        <span class="chk-btn-sub-text">Processamento seguro 256-Bit SSL • Mercado Pago</span>
      `;
    }
  }

  // ── Simulação Dinâmica de Parcelamento (1x a 12x com Cálculo de Juros Detalhado) ──
  async function updateInstallmentsSimulation() {
    const select = document.getElementById('chk-card-installments');
    if (!select) return;

    const total = getFinalTotalNumber();
    const cardInput = document.getElementById('chk-card-number');
    const cleanNum = cardInput ? cardInput.value.replace(/\D/g, '') : '';
    const bin = cleanNum.length >= 6 ? cleanNum.substring(0, 6) : '';
    const brand = detectCardBrand(cleanNum).id;

    try {
      const url = `/api/mercadopago.php?action=installments&amount=${total.toFixed(2)}` +
                  (bin ? `&bin=${bin}` : '') + `&payment_method_id=${brand}`;
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();

      if (data && data.success && Array.isArray(data.payerCosts) && data.payerCosts.length > 0) {
        const curVal = select.value;
        select.innerHTML = data.payerCosts.slice(0, 12).map(c => {
          const totalParcelado = Number(c.total_amount) || (c.installment_amount * c.installments);
          const diffJuros = totalParcelado - total;
          let msg;
          if (c.installments === 1 || diffJuros <= 0.05) {
            msg = `${c.installments}x de ${fmtMoney(c.installment_amount)} sem juros (Total: ${fmtMoney(totalParcelado)} à vista)`;
          } else {
            msg = `${c.installments}x de ${fmtMoney(c.installment_amount)} (+${fmtMoney(diffJuros)} de juros • Total: ${fmtMoney(totalParcelado)})`;
          }
          return `<option value="${c.installments}">${escapeHtml(msg)}</option>`;
        }).join('');
        if (curVal && select.querySelector(`option[value="${curVal}"]`)) {
          select.value = curVal;
        }
        return;
      }
    } catch (_) {}

    // Fallback padrão com juros oficiais do Mercado Pago repassados ao comprador
    const rates = [0, 0, 5.41, 6.98, 8.56, 9.94, 11.39, 12.82, 14.28, 15.69, 17.15, 18.59, 20.00];
    const opts = [];
    for (let i = 1; i <= 12; i++) {
      const rate = rates[i] || 0;
      const totalComTaxa = total * (1 + (rate / 100));
      const parcela = totalComTaxa / i;
      const diffJuros = totalComTaxa - total;
      let msg;
      if (i === 1 || diffJuros <= 0.05) {
        msg = `${i}x de ${fmtMoney(parcela)} sem juros (Total: ${fmtMoney(totalComTaxa)} à vista)`;
      } else {
        msg = `${i}x de ${fmtMoney(parcela)} (+${fmtMoney(diffJuros)} de juros • Total: ${fmtMoney(totalComTaxa)})`;
      }
      opts.push(`<option value="${i}">${msg}</option>`);
    }
    select.innerHTML = opts.join('');
  }

  // ── Alternância de Método de Pagamento (Pix vs Cartão vs Apple Pay) ──
  function setupPaymentMethodTabs() {
    const tabPix = document.getElementById('tab-method-pix');
    const tabCard = document.getElementById('tab-method-card');
    const tabApplePay = document.getElementById('tab-method-applepay');
    const panelPix = document.getElementById('panel-pix');
    const panelCard = document.getElementById('panel-card');
    const panelApplePay = document.getElementById('panel-applepay');

    function selectMethod(method) {
      selectedPaymentMethod = method;
      [tabPix, tabCard, tabApplePay].forEach(t => t && t.classList.remove('active'));
      [panelPix, panelCard, panelApplePay].forEach(p => p && (p.style.display = 'none'));

      if (method === 'pix') {
        if (tabPix) tabPix.classList.add('active');
        if (panelPix) panelPix.style.display = 'block';
      } else if (method === 'apple_pay') {
        if (tabApplePay) tabApplePay.classList.add('active');
        if (panelApplePay) panelApplePay.style.display = 'block';
        initOrRenderApplePay();
      } else {
        if (tabCard) tabCard.classList.add('active');
        if (panelCard) panelCard.style.display = 'block';
        updateInstallmentsSimulation();
      }
      updatePaymentButtonText();
      updateProgress();
      populateReviewCard();
    }

    if (tabPix) {
      tabPix.addEventListener('click', (e) => {
        e.preventDefault();
        selectMethod('pix');
      });
    }
    if (tabCard) {
      tabCard.addEventListener('click', (e) => {
        e.preventDefault();
        selectMethod('card');
      });
    }
    if (tabApplePay) {
      tabApplePay.addEventListener('click', (e) => {
        e.preventDefault();
        selectMethod('apple_pay');
      });
    }

    const cardAppleBtn = document.getElementById('chk-card-btn-applepay');
    if (cardAppleBtn) {
      cardAppleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submitApplePayTrigger();
      });
    }

    const instSelect = document.getElementById('chk-card-installments');
    if (instSelect) {
      instSelect.addEventListener('change', () => {
        populateReviewCard();
      });
    }

    checkApplePaySupport();
  }

  let applePaySettings = null;
  let applePayRendered = false;

  async function checkApplePaySupport() {
    const tabApplePay = document.getElementById('tab-method-applepay');
    if (!tabApplePay) return;

    try {
      const res = await fetch('/api/mercadopago.php?action=settings', { cache: 'no-store' });
      const data = await res.json();
      if (data && data.applePay) {
        applePaySettings = data.applePay;
      }
    } catch (_) {}

    // O Apple Pay só é exibido aos compradores quando a conta da Apple estiver homologada e ativa no backend
    const isConfiguredAndEnabled = Boolean(applePaySettings && applePaySettings.enabled && applePaySettings.certificatePublicHash);
    const hasApplePay = window.ApplePaySession && (
      typeof ApplePaySession.canMakePayments === 'function' && ApplePaySession.canMakePayments()
    );

    if (isConfiguredAndEnabled && hasApplePay) {
      tabApplePay.style.display = 'inline-flex';
    } else {
      tabApplePay.style.display = 'none';
    }
  }

  async function initOrRenderApplePay() {
    const container = document.getElementById('payment-container-applepay');
    const notice = document.getElementById('applepay-pending-notice');
    const triggerWrap = document.getElementById('chk-applepay-trigger-wrap');
    if (!container) return;

    // Se o certificado da Apple ainda não foi vinculado ao Mercado Pago:
    if (!applePaySettings || !applePaySettings.certificatePublicHash || !applePaySettings.enabled) {
      if (notice) notice.style.display = 'block';
      if (container) container.style.display = 'none';
      if (triggerWrap) triggerWrap.style.display = 'none';
      return;
    }

    if (applePayRendered) return;

    if (notice) notice.style.display = 'none';
    if (container) container.style.display = 'block';

    const total = getFinalTotalNumber();

    try {
      if (!mpInstance && window.MercadoPago) {
        mpInstance = new window.MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
      }

      if (mpInstance && typeof mpInstance.quickCheckout === 'function') {
        const quickCheckoutBuilder = mpInstance.quickCheckout();
        const settings = {
          checkoutTypes: ['applePay'],
          applePay: {
            paymentRequest: {
              countryCode: 'BR',
              currencyCode: 'BRL',
              merchantCapabilities: ['supports3DS'],
              supportedNetworks: ['visa', 'masterCard'],
              total: {
                label: applePaySettings.displayName || 'NT Eleganz',
                amount: total.toFixed(2)
              }
            },
            sessionRequest: {
              id: applePaySettings.certificatePublicHash,
              merchantIdentifier: applePaySettings.merchantIdentifier || 'merchant.com.nteleganz',
              domainName: applePaySettings.domainName || window.location.hostname,
              displayName: applePaySettings.displayName || 'NT Eleganz',
              initiative: 'web',
              initiativeContext: applePaySettings.domainName || window.location.hostname
            },
            customization: {
              buttonStyle: 'black',
              buttonType: 'pay',
              locale: 'pt-BR'
            },
            callbacks: {
              onReady: () => {
                console.log('Apple Pay Brick pronto');
              },
              onTokenGenerated: async (token, bin, paymentMethodId) => {
                await processApplePayOrder(token, bin, paymentMethodId);
              },
              onCancel: () => {
                console.log('Pagamento cancelado pelo comprador no Apple Pay.');
              },
              onError: (error) => {
                console.error('Erro na tokenização Apple Pay:', error);
                showToast('Falha no Apple Pay. Selecione Pix ou Cartão para concluir.');
              }
            }
          }
        };

        window.applePayBrickController = await quickCheckoutBuilder.create('payment-container-applepay', settings);
        applePayRendered = true;
      }
    } catch (err) {
      console.warn('Erro ao inicializar Brick do Apple Pay:', err);
      if (notice) notice.style.display = 'block';
    }
  }

  async function submitApplePayTrigger() {
    if (!applePaySettings || !applePaySettings.certificatePublicHash || !applePaySettings.enabled) {
      showToast('Aguardando ativação do certificado Apple. Selecione Pix ou Cartão para pagar agora.');
      return;
    }
    const container = document.getElementById('payment-container-applepay');
    if (container && container.querySelector('button, iframe')) {
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast('Confirme o pagamento no botão do Apple Pay acima com Touch ID ou Face ID.');
    }
  }

  async function processApplePayOrder(token, bin, paymentMethodId) {
    const payload = buildOrderPayload();
    if (!payload) return;

    showLoading('Processando autorização Apple Pay...');
    try {
      const res = await fetch('/api/mercadopago.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process_apple_pay',
          token: token,
          bin: bin,
          paymentMethodId: paymentMethodId || 'visa',
          customer: payload.customer,
          address: payload.address,
          shipping: payload.shipping,
          items: payload.items
        })
      });
      const data = await res.json();
      hideLoading();

      if (data && data.success) {
        clearCart();
        window.location.href = `/pedido/?code=${encodeURIComponent(data.orderCode)}&status=approved`;
      } else {
        showToast(data.message || data.error || 'Não foi possível aprovar a compra via Apple Pay.');
      }
    } catch (e) {
      hideLoading();
      showToast('Erro de comunicação ao processar o Apple Pay. Tente novamente.');
    }
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

  // ── Navegação & Validação Multi-Etapas (Step-by-Step Wizard) ──
  let currentStep = 1;
  let maxVisitedStep = 1;

  function validateStep1() {
    const name = getVal('chk-name');
    const email = getVal('chk-email');
    const phone = getVal('chk-phone').replace(/\D/g, '');
    const cpf = getVal('chk-cpf').replace(/\D/g, '');

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
      alert('Por favor, informe um CPF válido (11 dígitos) para o seguro e envio do pedido.');
      document.getElementById('chk-cpf')?.focus();
      return false;
    }
    return true;
  }

  function validateStep2() {
    const cep = getVal('chk-cep').replace(/\D/g, '');
    const street = getVal('chk-street');
    const number = getVal('chk-number');
    const neighborhood = getVal('chk-neighborhood');
    const city = getVal('chk-city');
    const state = getVal('chk-state');

    if (cep.length !== 8) {
      alert('Por favor, informe um CEP válido com 8 dígitos.');
      document.getElementById('chk-cep')?.focus();
      return false;
    }
    if (!street || !number) {
      alert('Por favor, preencha a Rua/Logradouro e o Número para a entrega.');
      document.getElementById('chk-number')?.focus();
      return false;
    }
    if (!neighborhood || !city || !state) {
      alert('Por favor, confirme Bairro, Cidade e Estado para a entrega.');
      return false;
    }
    return true;
  }

  function validateStep3() {
    if (!selectedShipping) {
      alert('Por favor, selecione uma modalidade de frete.');
      return false;
    }
    return true;
  }

  function validateStep4() {
    if (selectedPaymentMethod === 'card') {
      const cardNum = getVal('chk-card-number').replace(/\D/g, '');
      const cardName = getVal('chk-card-name');
      const cardExp = getVal('chk-card-expiry');
      const cardCvv = getVal('chk-card-cvv');
      const cardCpf = (getVal('chk-card-cpf') || getVal('chk-cpf')).replace(/\D/g, '');

      if (cardNum.length < 13) {
        alert('Por favor, informe o número completo do cartão de crédito.');
        document.getElementById('chk-card-number')?.focus();
        return false;
      }
      if (cardName.length < 3) {
        alert('Por favor, informe o nome do titular como impresso no cartão.');
        document.getElementById('chk-card-name')?.focus();
        return false;
      }
      if (cardExp.length !== 5 || !cardExp.includes('/')) {
        alert('Por favor, informe a validade no formato MM/AA.');
        document.getElementById('chk-card-expiry')?.focus();
        return false;
      }
      if (cardCvv.length < 3) {
        alert('Por favor, informe o código de segurança (CVV) do cartão.');
        document.getElementById('chk-card-cvv')?.focus();
        return false;
      }
      if (cardCpf.length !== 11) {
        alert('Por favor, informe o CPF do titular do cartão.');
        document.getElementById('chk-card-cpf')?.focus();
        return false;
      }
    }
    return true;
  }

  // ── Sincronização em Tempo Real com Meio Caminho (Carrinhos Abandonados) ──
  let meioCaminhoSessionId = null;
  try {
    meioCaminhoSessionId = sessionStorage.getItem('nte_meio_caminho_session');
    if (!meioCaminhoSessionId) {
      meioCaminhoSessionId = 'mc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      sessionStorage.setItem('nte_meio_caminho_session', meioCaminhoSessionId);
    }
  } catch (_) {
    meioCaminhoSessionId = 'mc_' + Date.now();
  }

  async function syncMeioCaminho(step, finalizado = false, orderCode = '', customStatus = '') {
    try {
      const name = getVal('chk-name');
      const email = getVal('chk-email');
      const phone = getVal('chk-phone');
      const cpf = getVal('chk-cpf');

      // Se não tiver pelo menos nome, telefone ou email, não há como recuperar
      if (!name && !phone && !email) return;

      const isFree = selectedShipping && selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
      const effectiveShippingPrice = isFree ? 0 : Number((selectedShipping && selectedShipping.price) || 0);
      const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};

      const currentStatus = finalizado ? 'recuperado' : (customStatus || 'pendente');

      const payload = {
        sessionId: meioCaminhoSessionId,
        name: name,
        email: email,
        phone: phone,
        cpf: cpf,
        step: step || currentStep,
        address: {
          cep: getVal('chk-cep'),
          street: getVal('chk-street'),
          number: getVal('chk-number'),
          complement: getVal('chk-complement'),
          neighborhood: getVal('chk-neighborhood'),
          city: getVal('chk-city'),
          state: getVal('chk-state')
        },
        shipping: selectedShipping ? {
          name: selectedShipping.name,
          price: effectiveShippingPrice,
          deadline: selectedShipping.deadline
        } : null,
        items: cartItems.map(it => ({
          id: it.id || '',
          name: it.name || '',
          brand: it.brand || '',
          price: it.price || '',
          qty: it.qty || 1,
          size: it.size || '',
          color: it.color || '',
          image: it.image || ''
        })),
        subtotal: fmtMoney(subtotal),
        total: fmtMoney(subtotal + effectiveShippingPrice),
        tracking: trackingData,
        status: currentStatus,
        paymentMethod: selectedPaymentMethod || 'pix',
        finalizado: !!finalizado,
        orderCode: orderCode || currentOrderCode || ''
      };

      await fetch('/api/abandoned_checkouts.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (finalizado) {
        // Rotaciona a sessão para que uma nova compra futura gere outro registro separado sem sobrescrever o histórico
        try {
          sessionStorage.removeItem('nte_meio_caminho_session');
          meioCaminhoSessionId = 'mc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
          sessionStorage.setItem('nte_meio_caminho_session', meioCaminhoSessionId);
        } catch (_) {}
      }
    } catch (e) {
      // Ignora falhas para não interferir na experiência do usuário
    }
  }

  function goToStep(targetStep, skipValidation = false) {
    if (targetStep < 1 || targetStep > 3) return;

    if (!skipValidation && targetStep > currentStep) {
      if (currentStep === 1 && !validateStep1()) return;
      if (currentStep === 2 && (!validateStep2() || !validateStep3())) return;

      if (targetStep >= 2 && !validateStep1()) return;
      if (targetStep >= 3 && (!validateStep2() || !validateStep3())) return;
    }

    currentStep = targetStep;
    if (currentStep > maxVisitedStep) {
      maxVisitedStep = currentStep;
    }

    // Registra imediatamente avanço no funil (Meio Caminho)
    syncMeioCaminho(currentStep);

    const stage1 = document.getElementById('stage-identificacao');
    const stage2 = document.getElementById('stage-frete');
    const stage3 = document.getElementById('stage-pagamento');

    if (stage1) stage1.style.display = (currentStep === 1) ? 'block' : 'none';
    if (stage2) stage2.style.display = (currentStep === 2) ? 'block' : 'none';
    if (stage3) stage3.style.display = (currentStep === 3) ? 'block' : 'none';

    // Garante que os cards internos fiquem visíveis dentro de seus respectivos stages
    const cardEnd = document.getElementById('card-endereco');
    const cardFrete = document.getElementById('card-frete');
    const cardRev = document.getElementById('card-revisao');
    const cardPag = document.getElementById('card-pagamento');

    if (cardEnd) cardEnd.style.display = 'block';
    if (cardFrete) cardFrete.style.display = 'block';
    if (cardRev) cardRev.style.display = 'block';
    if (cardPag) cardPag.style.display = 'block';

    // Gerenciamento da largura e centralização do layout
    const gridEl = document.getElementById('chk-layout-grid') || document.querySelector('.chk-layout-grid');
    if (gridEl) {
      gridEl.classList.remove('chk-step-1-active', 'chk-step-2-active', 'chk-step-3-active', 'chk-single-col', 'chk-review-col');
      gridEl.classList.add(`chk-step-${currentStep}-active`);
    }

    // Coluna lateral desabilitada: tudo fica centralizado e focado
    const summaryCol = document.querySelector('.chk-summary-column');
    if (summaryCol) summaryCol.style.setProperty('display', 'none', 'important');

    if (currentStep === 2) {
      const cepVal = getVal('chk-cep').replace(/\D/g, '');
      if (cepVal.length === 8 && !getVal('chk-street')) {
        handleCepLookup(cepVal);
      }
      if (cepVal.length === 8 && (!shippingMethods || shippingMethods.length === 0)) {
        loadShippingMethods(cepVal);
      }
    }

    if (currentStep === 3) {
      populateReviewCard();
      updateInstallmentsSimulation();
    }

    updateStepTrackerUI();
    updatePaymentButtonText();

    const mainEl = document.querySelector('.chk-main-content') || document.getElementById('chk-layout-grid');
    if (mainEl) {
      const topOffset = mainEl.getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: Math.max(0, topOffset), behavior: 'smooth' });
    }
  }

  function updateStepTrackerUI() {
    const nodes = [
      document.getElementById('step-node-1'),
      document.getElementById('step-node-2'),
      document.getElementById('step-node-3')
    ];
    nodes.forEach((node, idx) => {
      if (!node) return;
      const stepNum = idx + 1;
      node.classList.toggle('active', stepNum === currentStep);
      node.classList.toggle('completed', stepNum < currentStep);
    });

    const fillEl = document.getElementById('chk-progress-fill');
    if (fillEl) {
      const percents = { 1: 33.3, 2: 66.6, 3: 100 };
      fillEl.style.width = `${percents[currentStep] || 33.3}%`;
    }
  }

  function updatePaymentButtonText() {
    const total = getFinalTotalNumber();
    const formattedTotal = fmtMoney(total);

    document.querySelectorAll('.chk-action-total-val').forEach(el => {
      el.textContent = formattedTotal;
    });

    const cardBtnPix = document.getElementById('chk-card-pix-btn-text');
    const cardBtnCard = document.getElementById('chk-card-card-btn-text');
    const cardBtnApplePay = document.getElementById('chk-card-applepay-btn-text');
    if (cardBtnPix) cardBtnPix.textContent = 'Finalizar pedido';
    if (cardBtnCard) cardBtnCard.textContent = 'Finalizar pedido';
    if (cardBtnApplePay) cardBtnApplePay.textContent = 'Finalizar pedido';

    const btn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    const mainTxt = document.getElementById('chk-main-btn-text');
    const subTxt = document.getElementById('chk-main-btn-sub');

    if (!btn) return;

    if (currentStep === 1) {
      if (mainTxt) mainTxt.textContent = 'CONTINUAR PARA FRETE & ENDEREÇO →';
      if (subTxt) subTxt.textContent = 'Etapa 1 de 3 • Dados de identificação';
    } else if (currentStep === 2) {
      if (mainTxt) mainTxt.textContent = 'CONTINUAR PARA RESUMO & PAGAMENTO →';
      if (subTxt) subTxt.textContent = 'Etapa 2 de 3 • Endereço e opções de entrega';
    } else if (currentStep === 3) {
      if (mainTxt) mainTxt.textContent = `FINALIZAR PEDIDO (${formattedTotal})`;
      if (subTxt) subTxt.textContent = 'Etapa 3 de 3 • Revisão e pagamento';
    }
  }

  function updateProgress() {
    updateStepTrackerUI();
    updatePaymentButtonText();
  }

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
      alert('Por favor, informe um CPF válido (11 dígitos) para o seguro e envio do transporte.');
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

    if (selectedPaymentMethod === 'card') {
      const cardNum = getVal('chk-card-number').replace(/\D/g, '');
      const cardName = getVal('chk-card-name');
      const cardExp = getVal('chk-card-expiry');
      const cardCvv = getVal('chk-card-cvv');
      const cardCpf = (getVal('chk-card-cpf') || getVal('chk-cpf')).replace(/\D/g, '');

      if (cardNum.length < 15) {
        alert('Por favor, informe o número completo do cartão de crédito.');
        document.getElementById('chk-card-number')?.focus();
        return false;
      }
      if (cardName.length < 3) {
        alert('Por favor, informe o nome do titular como impresso no cartão.');
        document.getElementById('chk-card-name')?.focus();
        return false;
      }
      if (cardExp.length !== 5 || !cardExp.includes('/')) {
        alert('Por favor, informe a validade no formato MM/AA.');
        document.getElementById('chk-card-expiry')?.focus();
        return false;
      }
      if (cardCvv.length < 3) {
        alert('Por favor, informe o código de segurança (CVV) do cartão.');
        document.getElementById('chk-card-cvv')?.focus();
        return false;
      }
      if (cardCpf.length !== 11) {
        alert('Por favor, informe o CPF do titular do cartão.');
        document.getElementById('chk-card-cpf')?.focus();
        return false;
      }
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

  // ── Roteador de Pagamento Transparente ──
  async function submitTransparentPayment() {
    if (!validateCheckoutForm()) return;

    if (selectedPaymentMethod === 'pix') {
      await submitPixPayment();
    } else if (selectedPaymentMethod === 'apple_pay') {
      await submitApplePayTrigger();
    } else {
      await submitCardPayment();
    }
  }

  // ── 1. FLUXO PIX TRANSPARENTE NA TELA ──
  async function submitPixPayment() {
    const btn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    const originalContent = btn ? btn.innerHTML : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="chk-btn-main-text" style="display:flex;align-items:center;justify-content:center;gap:8px;">
          <div class="chk-spinner-sm" style="border-top-color:#fff;"></div>
          Gerando Pix Mercado Pago...
        </span>
      `;
    }

    const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
    const effectiveShippingPrice = isFree ? 0 : Number(selectedShipping.price || 0);
    const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};

    currentOrderCode = 'NTE-' + Math.floor(1000 + Math.random() * 9000);

    const payload = {
      action: 'process_pix',
      customer: getCustomerPayload(),
      items: cartItems,
      shipping: {
        ...selectedShipping,
        effectivePrice: effectiveShippingPrice
      },
      code: currentOrderCode,
      tracking: trackingData
    };

    try {
      const res = await fetch('/api/mercadopago.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.error_type === 'pix_key_required') {
          alert('Atenção: ' + data.message);
          // Alterna para o cartão automaticamente para facilitar a compra
          const tabCard = document.getElementById('tab-method-card');
          if (tabCard) tabCard.click();
          if (btn) {
            btn.disabled = false;
            updatePaymentButtonText();
          }
          return;
        }
        throw new Error(data.error || 'Falha ao gerar o Pix com o Mercado Pago.');
      }

      currentPaymentId = data.paymentId;
      currentOrderCode = data.orderCode || currentOrderCode;

      // Salva dados do cliente no storage
      try {
        localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(payload.customer));
      } catch (e) {}

      // Registra como Pagamento Pendente no Meio Caminho (aguardando confirmação do banco)
      syncMeioCaminho(3, false, currentOrderCode, 'pagamento_pendente');

      // Disparo oficial para Meta Ads (indicando destino Checkout)
      if (window.nteTracking && typeof window.nteTracking.trackOrderDispatch === 'function') {
        window.nteTracking.trackOrderDispatch('checkout', {
          code: currentOrderCode,
          items: cartItems,
          value: getFinalTotalNumber()
        });
      }
      if (window.nteTracking && typeof window.nteTracking.trackPurchase === 'function') {
        window.nteTracking.trackPurchase({
          code: currentOrderCode,
          items: cartItems,
          value: getFinalTotalNumber(),
          channel: 'checkout'
        }, 'checkout');
      }

      // Garantia de gravação no backend de pedidos do site
      try {
        await fetch('/api/orders.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: currentOrderCode,
            channel: 'checkout',
            paymentMethod: 'pix',
            client: getVal('chk-name'),
            clientName: getVal('chk-name'),
            phone: getVal('chk-phone'),
            email: getVal('chk-email'),
            customer: getCustomerPayload(),
            value: fmtMoney(getFinalTotalNumber()),
            items: cartItems,
            shipping: {
              ...selectedShipping,
              effectivePrice: effectiveShippingPrice
            },
            status: 'novo',
            pixQrCode: data.qrCode,
            pixQrCodeBase64: data.qrCodeBase64,
            ticketUrl: data.ticketUrl,
            tracking: trackingData
          })
        });
      } catch (_) {}

      // Exibe container do Pix diretamente na tela
      displayPixScreen(data);

    } catch (err) {
      console.error('Erro ao gerar Pix:', err);
      alert('Não foi possível gerar o Pix no momento: ' + err.message + '\n\nVocê pode pagar com Cartão de Crédito ou concluir com a equipe no WhatsApp.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    }
  }

  function displayPixScreen(data) {
    const layoutGrid = document.getElementById('chk-layout-grid');
    const pixCard = document.getElementById('chk-pix-active-card');
    const qrImg = document.getElementById('chk-pix-qr-img');
    const codeInput = document.getElementById('chk-pix-code-input');

    if (layoutGrid) layoutGrid.style.display = 'none';
    if (pixCard) pixCard.style.display = 'block';

    window.scrollTo({ top: 120, behavior: 'smooth' });

    if (qrImg && data.qrCodeBase64) {
      qrImg.src = `data:image/png;base64,${data.qrCodeBase64}`;
    }
    if (codeInput && data.qrCode) {
      codeInput.value = data.qrCode;
    }

    // Inicia cronômetro regressivo (15 minutos)
    startPixTimer(15 * 60);

    // Inicia polling de aprovação automática a cada 3 segundos
    startPaymentStatusPolling(data.paymentId, data.orderCode, data.total);
  }

  function startPixTimer(durationSeconds) {
    clearInterval(countdownInterval);
    let remaining = durationSeconds;
    const timerEl = document.getElementById('chk-pix-timer');

    countdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdownInterval);
        if (timerEl) timerEl.textContent = 'Expirado';
        return;
      }
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      if (timerEl) {
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }, 1000);
  }

  // ── Polling de Verificação de Pagamento ──
  function startPaymentStatusPolling(paymentId, orderCode, totalFormatted) {
    clearInterval(pollingInterval);
    let attempts = 0;

    pollingInterval = setInterval(async () => {
      attempts++;
      if (attempts > 300) { // 15 minutos (300 x 3s)
        clearInterval(pollingInterval);
        return;
      }

      try {
        const res = await fetch(`/api/mercadopago.php?action=check_payment&id=${paymentId}&code=${orderCode}`, {
          cache: 'no-store'
        });
        const check = await res.json();

        if (check && check.isApproved) {
          clearInterval(pollingInterval);
          clearInterval(countdownInterval);
          // Marca definitivamente como Concluído / Recuperado no Meio Caminho
          syncMeioCaminho(3, true, orderCode, 'recuperado');
          showSuccessScreen(orderCode, totalFormatted);
        }
      } catch (e) {
        console.warn('Erro ao verificar status do pagamento:', e);
      }
    }, 3000);
  }

  // ── 2. FLUXO CARTÃO DE CRÉDITO TRANSPARENTE ──
  async function submitCardPayment() {
    const btn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    const originalContent = btn ? btn.innerHTML : '';

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `
        <span class="chk-btn-main-text" style="display:flex;align-items:center;justify-content:center;gap:8px;">
          <div class="chk-spinner-sm" style="border-top-color:#fff;"></div>
          Validando Cartão com Mercado Pago...
        </span>
      `;
    }

    const cardNum = getVal('chk-card-number').replace(/\D/g, '');
    const cardName = getVal('chk-card-name');
    const cardExp = getVal('chk-card-expiry');
    const [expMonth, expYearShort] = cardExp.split('/');
    const expYear = 2000 + parseInt(expYearShort, 10);
    const cardCvv = getVal('chk-card-cvv');
    const cardCpf = (getVal('chk-card-cpf') || getVal('chk-cpf')).replace(/\D/g, '');
    const installments = parseInt(document.getElementById('chk-card-installments')?.value || '1', 10);
    const brand = detectCardBrand(cardNum).id;

    let cardToken = null;

    // Tentativa 1: SDK Oficial do Mercado Pago
    if (window.MercadoPago) {
      try {
        if (!mpInstance) mpInstance = new window.MercadoPago(MP_PUBLIC_KEY, { locale: 'pt-BR' });
        const tokenRes = await mpInstance.createCardToken({
          cardNumber: cardNum,
          cardholderName: cardName,
          cardExpirationMonth: expMonth,
          cardExpirationYear: String(expYear),
          securityCode: cardCvv,
          identificationType: 'CPF',
          identificationNumber: cardCpf
        });
        if (tokenRes && tokenRes.id) {
          cardToken = tokenRes.id;
        }
      } catch (sdkErr) {
        console.warn('Tentando fallback via proxy de token:', sdkErr);
      }
    }

    // Tentativa 2: Fallback direto via API Proxy no servidor
    if (!cardToken) {
      try {
        const tokenFetch = await fetch('/api/mercadopago.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_card_token',
            cardNumber: cardNum,
            cardholderName: cardName,
            expirationMonth: parseInt(expMonth, 10),
            expirationYear: expYear,
            securityCode: cardCvv,
            cpf: cardCpf
          })
        });
        const tokenData = await tokenFetch.json();
        if (tokenData && tokenData.success && tokenData.token) {
          cardToken = tokenData.token;
        } else {
          throw new Error(tokenData.error || 'Cartão não autorizado pela operadora.');
        }
      } catch (tokenErr) {
        alert('Atenção: Não foi possível validar os dados do cartão. Verifique o número, validade (MM/AA) e o código CVV.');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = originalContent;
        }
        return;
      }
    }

    if (btn) {
      btn.innerHTML = `
        <span class="chk-btn-main-text" style="display:flex;align-items:center;justify-content:center;gap:8px;">
          <div class="chk-spinner-sm" style="border-top-color:#fff;"></div>
          Processando Pagamento Seguro...
        </span>
      `;
    }

    const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
    const effectiveShippingPrice = isFree ? 0 : Number(selectedShipping.price || 0);
    const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};
    currentOrderCode = 'NTE-' + Math.floor(1000 + Math.random() * 9000);

    const payload = {
      action: 'process_card',
      token: cardToken,
      paymentMethodId: brand,
      installments: installments,
      customer: getCustomerPayload(),
      items: cartItems,
      shipping: {
        ...selectedShipping,
        effectivePrice: effectiveShippingPrice
      },
      code: currentOrderCode,
      tracking: trackingData
    };

    try {
      const res = await fetch('/api/mercadopago.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || 'Pagamento com cartão recusado pela operadora.');
      }

      const finalCode = data.orderCode || currentOrderCode;

      // Marca o carrinho como recuperado/concluído no Meio Caminho
      syncMeioCaminho(3, true, finalCode);

      // Disparo oficial para Meta Ads (indicando destino Checkout)
      if (window.nteTracking && typeof window.nteTracking.trackOrderDispatch === 'function') {
        window.nteTracking.trackOrderDispatch('checkout', {
          code: finalCode,
          items: cartItems,
          value: getFinalTotalNumber()
        });
      }
      if (window.nteTracking && typeof window.nteTracking.trackPurchase === 'function') {
        window.nteTracking.trackPurchase({
          code: finalCode,
          items: cartItems,
          value: getFinalTotalNumber(),
          channel: 'checkout'
        }, 'checkout');
      }

      // Garantia de gravação no backend de pedidos do site
      try {
        await fetch('/api/orders.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: finalCode,
            channel: 'checkout',
            paymentMethod: 'credit_card',
            client: getVal('chk-name'),
            clientName: getVal('chk-name'),
            phone: getVal('chk-phone'),
            email: getVal('chk-email'),
            customer: getCustomerPayload(),
            value: data.total || fmtMoney(getFinalTotalNumber()),
            items: cartItems,
            shipping: {
              ...selectedShipping,
              effectivePrice: effectiveShippingPrice
            },
            status: 'pago',
            tracking: trackingData
          })
        });
      } catch (_) {}

      // Sucesso na hora!
      showSuccessScreen(finalCode, data.total || fmtMoney(getFinalTotalNumber()));

    } catch (err) {
      console.error('Erro ao processar cartão:', err);
      alert('Não foi possível aprovar a transação: ' + err.message + '\n\nVerifique o limite disponível, os dados preenchidos ou tente pagar via Pix.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalContent;
      }
    }
  }

  // ── Exibição da Tela de Sucesso ──
  function showSuccessScreen(orderCode, totalStr) {
    const layoutGrid = document.getElementById('chk-layout-grid');
    const pixCard = document.getElementById('chk-pix-active-card');
    const successScreen = document.getElementById('chk-success-screen');

    if (layoutGrid) layoutGrid.style.display = 'none';
    if (pixCard) pixCard.style.display = 'none';
    if (successScreen) successScreen.style.display = 'block';

    const cleanCode = '#' + String(orderCode).replace('#', '');
    const codeEl = document.getElementById('chk-success-order-code');
    if (codeEl) codeEl.textContent = cleanCode;

    const totalEl = document.getElementById('chk-success-total');
    if (totalEl) totalEl.textContent = totalStr || fmtMoney(getFinalTotalNumber());

    const emailEl = document.getElementById('chk-success-email');
    const emailVal = getVal('chk-email');
    if (emailEl && emailVal) {
      emailEl.textContent = emailVal;
    }

    const wppLink = document.getElementById('chk-success-wpp-link');
    if (wppLink) {
      wppLink.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Olá! Acabei de finalizar meu pedido ${cleanCode} no site da NT Eleganz.`)}`;
    }

    window.scrollTo({ top: 80, behavior: 'smooth' });

    // Limpa carrinho
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch (_) {}
  }

  // ── Finalização via Concierge no WhatsApp (Alternativa) ──
  async function submitWhatsApp() {
    if (!validateCheckoutForm()) return;

    const customer = getCustomerPayload();
    const isFree = selectedShipping.freeAbove && subtotal >= selectedShipping.freeAbove;
    const effectiveShippingPrice = isFree ? 0 : Number(selectedShipping.price || 0);
    const totalVal = fmtMoney(subtotal + effectiveShippingPrice);
    const trackingData = window.nteTracking ? window.nteTracking.getTrackingData() : {};

    const orderCode = 'NTE-' + Math.floor(1000 + Math.random() * 9000);
    const orderRecord = {
      code: '#' + orderCode,
      status: 'novo',
      channel: 'whatsapp',
      value: totalVal,
      client: customer.name,
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

    // Marca o carrinho como concluído/recuperado no Meio Caminho
    syncMeioCaminho(3, true, orderCode);

    // Disparo oficial para Meta Ads (indicando destino WhatsApp)
    if (window.nteTracking && typeof window.nteTracking.trackOrderDispatch === 'function') {
      window.nteTracking.trackOrderDispatch('whatsapp', {
        code: orderCode,
        items: cartItems,
        value: subtotal + effectiveShippingPrice
      });
    }
    if (window.nteTracking && typeof window.nteTracking.trackWhatsAppContact === 'function') {
      window.nteTracking.trackWhatsAppContact({
        items: cartItems,
        value: subtotal + effectiveShippingPrice,
        productName: 'Pedido Checkout WhatsApp'
      });
    }

    try {
      await fetch('/api/orders.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderRecord)
      });
    } catch (e) {}

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
      if (c.cpf) {
        setVal('chk-cpf', maskCPF(c.cpf));
        setVal('chk-card-cpf', maskCPF(c.cpf));
      }
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

  // ── Busca de CEP Nativa Direto no Checkout (ViaCEP Rua/Cidade/UF) ──
  function setupInlineCepSearch() {
    const toggleBtn = document.getElementById('chk-btn-search-cep-toggle');
    const searchBox = document.getElementById('chk-cep-search-box');
    const closeBtn = document.getElementById('chk-btn-close-cep-search');
    const actionBtn = document.getElementById('chk-btn-search-cep-action');
    const resultsContainer = document.getElementById('chk-cep-search-results');

    if (toggleBtn && searchBox) {
      toggleBtn.addEventListener('click', () => {
        const isHidden = (searchBox.style.display === 'none' || !searchBox.style.display);
        searchBox.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
          const curUf = getVal('chk-state').toUpperCase();
          if (curUf) setVal('chk-search-uf', curUf);
          const curCity = getVal('chk-city');
          if (curCity) setVal('chk-search-cidade', curCity);
        }
      });
    }

    if (closeBtn && searchBox) {
      closeBtn.addEventListener('click', () => {
        searchBox.style.display = 'none';
      });
    }

    if (actionBtn && resultsContainer) {
      actionBtn.addEventListener('click', async () => {
        const uf = getVal('chk-search-uf');
        const cidade = getVal('chk-search-cidade');
        const rua = getVal('chk-search-rua');

        if (!uf) {
          alert('Por favor, selecione o Estado (UF).');
          document.getElementById('chk-search-uf')?.focus();
          return;
        }
        if (cidade.length < 3) {
          alert('Por favor, informe a Cidade (mínimo 3 letras).');
          document.getElementById('chk-search-cidade')?.focus();
          return;
        }
        if (rua.length < 3) {
          alert('Por favor, informe a Rua / Logradouro (mínimo 3 letras).');
          document.getElementById('chk-search-rua')?.focus();
          return;
        }

        actionBtn.disabled = true;
        actionBtn.innerHTML = '<span>LOCALIZANDO...</span>';
        resultsContainer.style.display = 'block';
        resultsContainer.innerHTML = '<div style="padding:14px; text-align:center; color:#777; font-size:12px;">Consultando base dos Correios via ViaCEP...</div>';

        try {
          const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(cidade)}/${encodeURIComponent(rua)}/json/`;
          const resp = await fetch(url);
          const data = await resp.json();

          if (!Array.isArray(data) || data.length === 0) {
            resultsContainer.innerHTML = `
              <div style="padding:14px; text-align:center; color:#888; font-size:12px;">
                Nenhum CEP encontrado para "<strong>${rua}</strong>" em ${cidade}/${uf}. Verifique o nome da rua ou tente um termo mais amplo.
              </div>
            `;
            return;
          }

          resultsContainer.innerHTML = data.slice(0, 15).map(item => {
            const cepFmt = item.cep || '';
            const logradouro = item.logradouro || '';
            const bairro = item.bairro || '';
            const loc = item.localidade || cidade;
            const ufItem = item.uf || uf;

            return `
              <div class="chk-cep-result-item" data-cep="${cepFmt}" data-logradouro="${logradouro}" data-bairro="${bairro}" data-cidade="${loc}" data-uf="${ufItem}">
                <div class="chk-cep-result-info">
                  <div class="chk-cep-result-street">${logradouro || 'Logradouro'}</div>
                  <div class="chk-cep-result-district">${bairro ? bairro + ' • ' : ''}${loc}/${ufItem}</div>
                </div>
                <span class="chk-cep-result-badge">${cepFmt}</span>
              </div>
            `;
          }).join('');

          // Evento de seleção de CEP
          resultsContainer.querySelectorAll('.chk-cep-result-item').forEach(el => {
            el.addEventListener('click', () => {
              const cep = el.getAttribute('data-cep');
              const logradouro = el.getAttribute('data-logradouro');
              const bairro = el.getAttribute('data-bairro');
              const cid = el.getAttribute('data-cidade');
              const ufVal = el.getAttribute('data-uf');

              if (cep) setVal('chk-cep', cep);
              if (logradouro) setVal('chk-street', logradouro);
              if (bairro) setVal('chk-neighborhood', bairro);
              if (cid) setVal('chk-city', cid);
              if (ufVal) setVal('chk-state', ufVal);

              searchBox.style.display = 'none';

              const cleanCep = (cep || '').replace(/\D/g, '');
              if (cleanCep.length === 8) {
                loadShippingMethods(cleanCep);
              }

              const numInput = document.getElementById('chk-number');
              if (numInput) {
                numInput.focus();
                numInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            });
          });

        } catch (err) {
          resultsContainer.innerHTML = '<div style="padding:14px; text-align:center; color:#c00; font-size:12px;">Falha ao consultar CEP. Tente novamente em instantes.</div>';
        } finally {
          actionBtn.disabled = false;
          actionBtn.innerHTML = '<span>LOCALIZAR CEP</span>';
        }
      });
    }
  }

  // ── Preenchimento Dinâmico da Etapa 5 (Revisão Completa do Pedido) ──
  function populateReviewCard() {
    // 1. Identificação
    const nameEl = document.getElementById('chk-rev-name');
    const emailEl = document.getElementById('chk-rev-email');
    const phoneEl = document.getElementById('chk-rev-phone');
    const cpfEl = document.getElementById('chk-rev-cpf');

    if (nameEl) nameEl.textContent = getVal('chk-name') || 'Nome não informado';
    if (emailEl) emailEl.textContent = getVal('chk-email') || 'E-mail não informado';
    if (phoneEl) phoneEl.textContent = getVal('chk-phone') || 'WhatsApp não informado';
    if (cpfEl) cpfEl.textContent = getVal('chk-cpf') || 'CPF não informado';

    // 2. Endereço
    const streetEl = document.getElementById('chk-rev-street');
    const compEl = document.getElementById('chk-rev-complement');
    const cityEl = document.getElementById('chk-rev-district-city');
    const cepEl = document.getElementById('chk-rev-cep');

    const num = getVal('chk-number');
    const street = getVal('chk-street');
    const comp = getVal('chk-complement');
    const neigh = getVal('chk-neighborhood');
    const city = getVal('chk-city');
    const state = getVal('chk-state');

    if (streetEl) streetEl.textContent = street ? `${street}, nº ${num || 'S/N'}` : 'Endereço não informado';
    if (compEl) {
      if (comp) {
        compEl.textContent = `Complemento: ${comp}`;
        compEl.style.display = 'block';
      } else {
        compEl.style.display = 'none';
      }
    }
    if (cityEl) cityEl.textContent = `${neigh ? neigh + ' • ' : ''}${city || ''} - ${state || ''}`;
    if (cepEl) cepEl.textContent = getVal('chk-cep') || '—';

    // 3. Frete
    const shipNameEl = document.getElementById('chk-rev-shipping-name');
    const shipDeadEl = document.getElementById('chk-rev-shipping-deadline');
    const shipPriceEl = document.getElementById('chk-rev-shipping-price');

    if (selectedShipping) {
      if (shipNameEl) shipNameEl.textContent = stripEmojis(selectedShipping.name) || 'Frete Selecionado';
      if (shipDeadEl) shipDeadEl.textContent = stripEmojis(selectedShipping.deadline) || 'Prazo padrão dos Correios';
      if (shipPriceEl) shipPriceEl.textContent = selectedShipping.price > 0 ? fmtMoney(selectedShipping.price) : 'Grátis';
    } else {
      if (shipNameEl) shipNameEl.textContent = 'Frete Padrão';
      if (shipDeadEl) shipDeadEl.textContent = 'Calculado na entrega';
      if (shipPriceEl) shipPriceEl.textContent = 'R$ 0,00';
    }

    // 4. Pagamento
    const payTitleEl = document.getElementById('chk-rev-payment-title');
    const paySubEl = document.getElementById('chk-rev-payment-sub');

    if (selectedPaymentMethod === 'pix') {
      if (payTitleEl) payTitleEl.innerHTML = '<span style="display:inline-flex; align-items:center; gap:6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path fill="#32BCAD" d="M5.283 18.36a3.505 3.505 0 0 0 2.493-1.032l3.6-3.6a.684.684 0 0 1 .946 0l3.613 3.613a3.504 3.504 0 0 0 2.493 1.032h.71l-4.56 4.56a3.647 3.647 0 0 1-5.156 0L4.85 18.36ZM18.428 5.627a3.505 3.505 0 0 0-2.493 1.032l-3.613 3.614a.67.67 0 0 1-.946 0l-3.6-3.6A3.505 3.505 0 0 0 5.283 5.64h-.434l4.573-4.572a3.646 3.646 0 0 1 5.156 0l4.559 4.559ZM1.068 9.422 3.79 6.699h1.492a2.483 2.483 0 0 1 1.744.722l3.6 3.6a1.73 1.73 0 0 0 2.443 0l3.614-3.613a2.482 2.482 0 0 1 1.744-.723h1.767l2.737 2.737a3.646 3.646 0 0 1 0 5.156l-2.736 2.736h-1.768a2.482 2.482 0 0 1-1.744-.722l-3.613-3.613a1.77 1.77 0 0 0-2.444 0l-3.6 3.6a2.483 2.483 0 0 1-1.744.722H3.791l-2.723-2.723a3.646 3.646 0 0 1 0-5.156"/></svg> Pix Instantâneo (Aprovação Imediata)</span>';
      if (paySubEl) paySubEl.textContent = 'O código Pix Copia e Cola e o QR Code serão exibidos ao clicar em Finalizar Compra.';
    } else if (selectedPaymentMethod === 'apple_pay') {
      if (payTitleEl) payTitleEl.textContent = 'Apple Pay';
      if (paySubEl) paySubEl.textContent = 'Aprovação biométrica com 1 toque.';
    } else {
      const cardNum = getVal('chk-card-number').replace(/\D/g, '');
      const last4 = cardNum.slice(-4) || '••••';
      const brandData = detectCardBrand(cardNum);
      const brandName = (brandData && brandData.brand !== 'unknown') ? brandData.brand.toUpperCase() : 'CRÉDITO';
      const instSelect = document.getElementById('chk-card-installments');
      const instCount = instSelect ? parseInt(instSelect.value, 10) || 1 : 1;
      const baseTotal = subtotal + (selectedShipping ? (selectedShipping.price || 0) : 0);
      const instList = calculateInstallments(baseTotal);
      const instData = instList.find(i => i.installment === instCount) || { total: baseTotal, value: baseTotal, interestAmount: 0 };

      if (payTitleEl) payTitleEl.textContent = cardNum ? `Cartão ${brandName} final •••• ${last4}` : 'Cartão de Crédito';
      if (paySubEl) {
        if (instCount === 1) {
          paySubEl.textContent = `1x de ${fmtMoney(instData.value)} à vista (Sem juros)`;
        } else {
          paySubEl.textContent = `${instCount}x de ${fmtMoney(instData.value)} (${instData.interestAmount > 0 ? '+ juros' : 'sem juros'})`;
        }
      }
    }

    // 5. Itens do Pedido
    const itemsCountEl = document.getElementById('chk-rev-items-count');
    const itemsListEl = document.getElementById('chk-review-products-list');
    const items = cartItems || [];

    const totalItemsQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || Number(it.quantity) || 1)), 0);
    if (itemsCountEl) itemsCountEl.textContent = `${totalItemsQty} ${totalItemsQty === 1 ? 'item' : 'itens'}`;

    if (itemsListEl) {
      if (items.length === 0) {
        itemsListEl.innerHTML = '<div style="padding: 16px; text-align: center; color: #888; font-size: 13px;">Nenhum produto encontrado.</div>';
      } else {
        itemsListEl.innerHTML = items.map(it => {
          const title = escapeHtml(stripEmojis(it.name || it.title || 'Produto NT Eleganz'));
          const img = it.image || (Array.isArray(it.images) ? it.images[0] : '') || '/assets/images/placeholder-product.svg';
          const price = parsePrice(it.price);
          const qty = Math.max(1, Number(it.qty) || Number(it.quantity) || 1);
          const variantText = [it.size ? `Tam: ${escapeHtml(it.size)}` : '', it.color ? `Cor: ${escapeHtml(it.color)}` : ''].filter(Boolean).join(' • ');

          return `
            <div class="chk-review-product-item">
              <img src="${escapeHtml(img)}" alt="${title}" class="chk-review-prod-img" onerror="this.src='/assets/images/placeholder-product.svg'" />
              <div class="chk-review-prod-info">
                <div class="chk-review-prod-title">${title}</div>
                ${variantText ? `<div class="chk-review-prod-sub">${variantText}</div>` : ''}
                <div class="chk-review-prod-qty">Quantidade: <strong>${qty}</strong></div>
              </div>
              <div class="chk-review-prod-price">${fmtMoney(price * qty)}</div>
            </div>
          `;
        }).join('');
      }
    }

    // 6. Detalhamento Financeiro
    const baseSubtotal = subtotal;
    const shippingPrice = selectedShipping ? (selectedShipping.price || 0) : 0;
    let finalOrderTotal = baseSubtotal + shippingPrice;
    let interestAmount = 0;

    if (selectedPaymentMethod === 'card') {
      const instSelect = document.getElementById('chk-card-installments');
      const instCount = instSelect ? parseInt(instSelect.value, 10) || 1 : 1;
      const instList = calculateInstallments(baseSubtotal + shippingPrice);
      const instData = instList.find(i => i.installment === instCount);
      if (instData) {
        finalOrderTotal = instData.total;
        interestAmount = instData.interestAmount;
      }
    }

    const finSubtotalEl = document.getElementById('chk-rev-fin-subtotal');
    const finShippingLabel = document.getElementById('chk-rev-fin-shipping-name');
    const finShippingVal = document.getElementById('chk-rev-fin-shipping-val');
    const finInterestRow = document.getElementById('chk-rev-fin-interest-row');
    const finInterestVal = document.getElementById('chk-rev-fin-interest');
    const finTotalEl = document.getElementById('chk-rev-fin-total');
    const finPayCond = document.getElementById('chk-rev-fin-pay-condition');
    const btnFinishSub = document.getElementById('chk-btn-finish-subtitle');

    if (finSubtotalEl) finSubtotalEl.textContent = fmtMoney(baseSubtotal);
    if (finShippingLabel) finShippingLabel.textContent = `Frete (${selectedShipping ? selectedShipping.name : 'Padrão'})`;
    if (finShippingVal) finShippingVal.textContent = shippingPrice > 0 ? fmtMoney(shippingPrice) : 'Grátis';

    if (finInterestRow && finInterestVal) {
      if (interestAmount > 0) {
        finInterestRow.style.display = 'flex';
        finInterestVal.textContent = `+ ${fmtMoney(interestAmount)}`;
      } else {
        finInterestRow.style.display = 'none';
      }
    }

    if (finTotalEl) finTotalEl.textContent = fmtMoney(finalOrderTotal);
    document.querySelectorAll('.chk-action-total-val').forEach(el => {
      el.textContent = fmtMoney(finalOrderTotal);
    });

    if (finPayCond) {
      if (selectedPaymentMethod === 'pix') {
        finPayCond.textContent = 'Pagamento instantâneo via Pix • Liberação imediata';
      } else {
        const instSelect = document.getElementById('chk-card-installments');
        const instCount = instSelect ? parseInt(instSelect.value, 10) || 1 : 1;
        finPayCond.textContent = `Em ${instCount}x de ${fmtMoney(finalOrderTotal / instCount)} no Cartão de Crédito`;
      }
    }

    if (btnFinishSub) {
      btnFinishSub.textContent = `Pagar ${fmtMoney(finalOrderTotal)} com segurança Mercado Pago`;
    }
  }

  // ── Inicialização ──
  document.addEventListener('DOMContentLoaded', async () => {
    const hasCart = await loadCart();
    if (!hasCart) return;

    restoreSavedCustomer();
    await loadShippingMethods();
    setupPaymentMethodTabs();

    // Eventos de máscara e validação em tempo real
    const phoneInput = document.getElementById('chk-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', e => {
        e.target.value = maskPhone(e.target.value);
        updateProgress();
      });
    }

    // Captura inicial para o painel Meio Caminho caso o cliente preencha e hesite
    ['chk-name', 'chk-email', 'chk-phone', 'chk-cpf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('blur', () => {
          const ph = getVal('chk-phone').replace(/\D/g, '');
          const nm = getVal('chk-name');
          if (nm.length >= 3 && ph.length >= 10) {
            syncMeioCaminho(1);
          }
        });
      }
    });

    const cpfInput = document.getElementById('chk-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', e => {
        e.target.value = maskCPF(e.target.value);
        // Auto preenche o CPF do cartão
        const cardCpfInput = document.getElementById('chk-card-cpf');
        if (cardCpfInput && !cardCpfInput.value) {
          cardCpfInput.value = e.target.value;
        }
        updateProgress();
      });
    }

    const cardCpfInput = document.getElementById('chk-card-cpf');
    if (cardCpfInput) {
      cardCpfInput.addEventListener('input', e => {
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

    // Máscaras do Cartão
    const cardNumInput = document.getElementById('chk-card-number');
    if (cardNumInput) {
      cardNumInput.addEventListener('input', e => {
        e.target.value = maskCardNumber(e.target.value);
        const brand = detectCardBrand(e.target.value);
        const badge = document.getElementById('chk-card-brand-badge');
        if (badge) badge.innerHTML = brand.badgeHtml;
        if (e.target.value.replace(/\D/g, '').length >= 6) {
          updateInstallmentsSimulation();
        }
        updateProgress();
      });
    }

    const cardExpInput = document.getElementById('chk-card-expiry');
    if (cardExpInput) {
      cardExpInput.addEventListener('input', e => {
        e.target.value = maskExpiry(e.target.value);
        updateProgress();
      });
    }

    const cardCvvInput = document.getElementById('chk-card-cvv');
    if (cardCvvInput) {
      cardCvvInput.addEventListener('input', e => {
        e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
        updateProgress();
      });
    }

    ['chk-name', 'chk-email', 'chk-street', 'chk-number', 'chk-neighborhood', 'chk-city', 'chk-state', 'chk-card-name'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateProgress);
    });

    // ── Botões de Navegação dos Cards de Cada Etapa (Checkout em 3 Etapas) ──
    const btnStep1 = document.getElementById('chk-btn-step-1');
    if (btnStep1) btnStep1.addEventListener('click', () => goToStep(2));

    const btnBack1 = document.getElementById('chk-btn-back-1');
    if (btnBack1) btnBack1.addEventListener('click', () => goToStep(1, true));

    const btnStep2 = document.getElementById('chk-btn-step-2');
    if (btnStep2) btnStep2.addEventListener('click', () => goToStep(3));

    const btnBack2 = document.getElementById('chk-btn-back-2');
    if (btnBack2) btnBack2.addEventListener('click', () => goToStep(2, true));

    // Botões de Pagamento Direto na Etapa 3
    const btnCardPix = document.getElementById('chk-card-btn-pix');
    if (btnCardPix) {
      btnCardPix.addEventListener('click', () => {
        selectedPaymentMethod = 'pix';
        submitPixPayment();
      });
    }

    const btnCardCard = document.getElementById('chk-card-btn-card');
    if (btnCardCard) {
      btnCardCard.addEventListener('click', () => {
        selectedPaymentMethod = 'card';
        if (validateStep4()) {
          submitCardPayment();
        }
      });
    }

    const btnCardApplePay = document.getElementById('chk-card-btn-applepay');
    if (btnCardApplePay) {
      btnCardApplePay.addEventListener('click', () => {
        selectedPaymentMethod = 'apple_pay';
        submitTransparentPayment();
      });
    }

    // Botões de Alteração dentro da Revisão (Etapa 3)
    const editStep1 = document.getElementById('chk-edit-step-1');
    if (editStep1) editStep1.addEventListener('click', () => goToStep(1, true));

    const editStep2 = document.getElementById('chk-edit-step-2');
    if (editStep2) editStep2.addEventListener('click', () => goToStep(2, true));

    const editStep3 = document.getElementById('chk-edit-step-3');
    if (editStep3) editStep3.addEventListener('click', () => goToStep(2, true));

    // Botão Final de Finalizar Compra
    const btnFinishOrder = document.getElementById('chk-btn-finish-order');
    if (btnFinishOrder) {
      btnFinishOrder.addEventListener('click', () => {
        if (selectedPaymentMethod === 'pix') {
          submitPixPayment();
        } else if (selectedPaymentMethod === 'card') {
          if (validateStep4()) {
            submitCardPayment();
          } else {
            const cardEl = document.getElementById('card-pagamento');
            if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth' });
          }
        } else {
          submitTransparentPayment();
        }
      });
    }

    // Inicializa a Busca Nativa de CEP
    setupInlineCepSearch();

    // Navegação por clique nos passos do topo (Steps Tracker - 3 Etapas)
    [1, 2, 3].forEach(stepNum => {
      const node = document.getElementById(`step-node-${stepNum}`);
      if (node) {
        node.addEventListener('click', () => {
          if (stepNum < currentStep || stepNum <= maxVisitedStep) {
            goToStep(stepNum, true);
          } else {
            goToStep(stepNum);
          }
        });
      }
    });

    // Botão de Copiar Código Pix
    const copyPixBtn = document.getElementById('chk-pix-copy-btn');
    if (copyPixBtn) {
      copyPixBtn.addEventListener('click', async () => {
        const input = document.getElementById('chk-pix-code-input');
        const textSpan = document.getElementById('chk-pix-copy-text');
        if (input && input.value) {
          try {
            await navigator.clipboard.writeText(input.value);
            copyPixBtn.classList.add('copied');
            if (textSpan) textSpan.textContent = 'Código Pix Copiado!';
            setTimeout(() => {
              copyPixBtn.classList.remove('copied');
              if (textSpan) textSpan.textContent = 'Copiar Código Pix';
            }, 3000);
          } catch (e) {
            input.select();
            document.execCommand('copy');
            if (textSpan) textSpan.textContent = 'Copiado com Sucesso!';
          }
        }
      });
    }

    // Botão de Cancelar Pix e Voltar para os Métodos
    const cancelPixBtn = document.getElementById('chk-pix-cancel-btn');
    if (cancelPixBtn) {
      cancelPixBtn.addEventListener('click', () => {
        clearInterval(pollingInterval);
        clearInterval(countdownInterval);
        const layoutGrid = document.getElementById('chk-layout-grid');
        const pixCard = document.getElementById('chk-pix-active-card');
        if (pixCard) pixCard.style.display = 'none';
        if (layoutGrid) layoutGrid.style.display = 'grid';
        goToStep(3, true);
        const submitBtn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
        if (submitBtn) submitBtn.disabled = false;
        updatePaymentButtonText();
      });
    }

    // Botão unificado na coluna da direita (caso ainda referenciado)
    const btnSubmit = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => {
        if (currentStep === 1) {
          goToStep(2);
        } else if (currentStep === 2) {
          goToStep(3);
        } else if (currentStep === 3) {
          submitTransparentPayment();
        }
      });
    }

    // Inicializa na Etapa 1
    goToStep(1, true);
    updateInstallmentsSimulation();
  });

  // Previne zoom por gesto em Safari iOS / Mobile para não quebrar a dimensão
  document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
  });

})();
