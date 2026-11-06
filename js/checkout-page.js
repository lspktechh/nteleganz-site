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

  function detectCardBrand(num) {
    const clean = num.replace(/\D/g, '');
    if (/^4/.test(clean)) return { id: 'visa', name: 'VISA' };
    if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[01]|2720)/.test(clean)) return { id: 'master', name: 'MASTERCARD' };
    if (/^(4011|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(clean)) return { id: 'elo', name: 'ELO' };
    if (/^3[47]/.test(clean)) return { id: 'amex', name: 'AMEX' };
    if (/^(606282|3841)/.test(clean)) return { id: 'hipercard', name: 'HIPERCARD' };
    return { id: 'visa', name: 'CARTÃO' };
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
        });
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

  // ── Simulação Dinâmica de Parcelamento (1x a 12x) ──
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
          return `<option value="${c.installments}">${escapeHtml(c.recommended_message)}</option>`;
        }).join('');
        if (curVal && select.querySelector(`option[value="${curVal}"]`)) {
          select.value = curVal;
        }
        return;
      }
    } catch (_) {}

    // Fallback padrão de cálculo local de 1x a 12x
    const rates = [0, 0, 5.41, 6.98, 8.56, 9.94, 11.39, 12.82, 14.28, 15.69, 17.15, 18.59, 20.00];
    const opts = [];
    for (let i = 1; i <= 12; i++) {
      const rate = rates[i] || 0;
      const totalComTaxa = total * (1 + (rate / 100));
      const parcela = totalComTaxa / i;
      const msg = `${i}x de ${fmtMoney(parcela)} ${rate === 0 ? 'sem juros' : `(Total: ${fmtMoney(totalComTaxa)})`}`;
      opts.push(`<option value="${i}">${msg}</option>`);
    }
    select.innerHTML = opts.join('');
  }

  // ── Alternância de Método de Pagamento (Pix vs Cartão) ──
  function setupPaymentMethodTabs() {
    const tabPix = document.getElementById('tab-method-pix');
    const tabCard = document.getElementById('tab-method-card');
    const panelPix = document.getElementById('panel-pix');
    const panelCard = document.getElementById('panel-card');

    function selectMethod(method) {
      selectedPaymentMethod = method;
      if (method === 'pix') {
        if (tabPix) tabPix.classList.add('active');
        if (tabCard) tabCard.classList.remove('active');
        if (panelPix) panelPix.style.display = 'block';
        if (panelCard) panelCard.style.display = 'none';
      } else {
        if (tabCard) tabCard.classList.add('active');
        if (tabPix) tabPix.classList.remove('active');
        if (panelCard) panelCard.style.display = 'block';
        if (panelPix) panelPix.style.display = 'none';
        updateInstallmentsSimulation();
      }
      updatePaymentButtonText();
      updateProgress();
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

    let step4Ok = false;
    if (selectedPaymentMethod === 'pix') {
      step4Ok = true;
    } else {
      const cardNum = getVal('chk-card-number').replace(/\D/g, '');
      const cardName = getVal('chk-card-name');
      const cardExp = getVal('chk-card-expiry');
      const cardCvv = getVal('chk-card-cvv');
      step4Ok = cardNum.length >= 15 && cardName.length >= 3 && cardExp.length === 5 && cardCvv.length >= 3;
    }

    const stepNode1 = document.getElementById('step-node-1');
    const stepNode2 = document.getElementById('step-node-2');
    const stepNode3 = document.getElementById('step-node-3');
    const stepNode4 = document.getElementById('step-node-4');
    const fillEl = document.getElementById('chk-progress-fill');

    let percent = 20;
    if (step1Ok) percent = 45;
    if (step1Ok && step2Ok) percent = 70;
    if (step1Ok && step2Ok && step3Ok) percent = 85;
    if (step1Ok && step2Ok && step3Ok && step4Ok) percent = 100;

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
      currentOrderCode = data.orderCode;

      // Salva dados do cliente no storage
      try {
        localStorage.setItem(CUSTOMER_STORAGE_KEY, JSON.stringify(payload.customer));
      } catch (e) {}

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

      // Sucesso na hora!
      showSuccessScreen(data.orderCode || currentOrderCode, data.total || fmtMoney(getFinalTotalNumber()));

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
        if (badge) badge.textContent = brand.name;
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
            if (textSpan) textSpan.textContent = '✓ Código Pix Copiado!';
            setTimeout(() => {
              copyPixBtn.classList.remove('copied');
              if (textSpan) textSpan.textContent = 'Copiar Código Pix';
            }, 3000);
          } catch (e) {
            input.select();
            document.execCommand('copy');
            if (textSpan) textSpan.textContent = '✓ Copiado!';
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
        const submitBtn = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
        if (submitBtn) submitBtn.disabled = false;
        updatePaymentButtonText();
        window.scrollTo({ top: 400, behavior: 'smooth' });
      });
    }

    // Botões principais de submissão
    const btnSubmit = document.getElementById('chk-submit-infinitepay') || document.getElementById('chk-submit-mercadopago');
    if (btnSubmit) btnSubmit.addEventListener('click', submitTransparentPayment);

    const btnWpp = document.getElementById('chk-submit-whatsapp');
    if (btnWpp) btnWpp.addEventListener('click', submitWhatsApp);

    updateProgress();
    updateInstallmentsSimulation();
  });

})();
