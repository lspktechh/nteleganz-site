/**
 * NT Eleganz — Dynamic Checkout Controller
 * Roteamento Dinâmico de Checkout: WhatsApp (Expediente) vs. Banco/InfinitePay (Fora de Expediente)
 * Respeita o Horário Oficial de Brasília e configurações salvas no Painel Admin.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'nte_checkout_settings';
  const DEFAULT_SETTINGS = {
    mode: 'schedule', // 'schedule' | 'always_wpp' | 'always_bank'
    wppStartTime: '09:00',
    wppEndTime: '19:00',
    wppActiveDays: [1, 2, 3, 4, 5, 6], // 1=Seg a 6=Sáb
    timezone: 'America/Sao_Paulo',
    wppButtonText: 'Finalizar pedido no WhatsApp',
    bankButtonText: 'Finalizar Pedido Seguro'
  };

  let currentSettings = { ...DEFAULT_SETTINGS };

  // Lê cache do localStorage para resposta imediata
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === 'object') {
        currentSettings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    }
  } catch (_) {}

  /**
   * Obtém as horas e minutos atuais no fuso de Brasília (America/Sao_Paulo)
   */
  function getBrasiliaTime(dateObj = new Date()) {
    try {
      const parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: currentSettings.timezone || 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false
      }).formatToParts(dateObj);

      let hour = 0, minute = 0;
      for (const p of parts) {
        if (p.type === 'hour') hour = parseInt(p.value, 10);
        if (p.type === 'minute') minute = parseInt(p.value, 10);
      }

      // Dia da semana de Brasília (0=Dom, 1=Seg, ..., 6=Sáb)
      const dayMap = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6, 'sáb': 6 };
      const weekdayPart = parts.find(p => p.type === 'weekday')?.value?.toLowerCase()?.replace('.', '') || '';
      const dayOfWeek = dayMap[weekdayPart] !== undefined ? dayMap[weekdayPart] : dateObj.getDay();

      return {
        hour,
        minute,
        totalMinutes: (hour * 60) + minute,
        dayOfWeek
      };
    } catch (_) {
      // Fallback básico caso o navegador antigo falhe no Intl
      const d = new Date(dateObj.getTime() - (3 * 3600000));
      return {
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        totalMinutes: (d.getUTCHours() * 60) + d.getUTCMinutes(),
        dayOfWeek: d.getUTCDay()
      };
    }
  }

  /**
   * Determina se o atendimento via WhatsApp está ativo no momento
   */
  function isWhatsAppActive() {
    const mode = currentSettings.mode || 'schedule';

    if (mode === 'always_wpp') return true;
    if (mode === 'always_bank') return false;

    // Modo dinâmico por horário (schedule)
    const bsb = getBrasiliaTime();

    // Valida dia da semana
    const activeDays = Array.isArray(currentSettings.wppActiveDays)
      ? currentSettings.wppActiveDays
      : [1, 2, 3, 4, 5, 6];

    if (!activeDays.includes(bsb.dayOfWeek)) {
      return false; // Dia desmarcado -> Checkout do Banco
    }

    const [startH, startM] = (currentSettings.wppStartTime || '09:00').split(':').map(Number);
    const startMinutes = (startH * 60) + (startM || 0);

    const [endH, endM] = (currentSettings.wppEndTime || '19:00').split(':').map(Number);
    const endMinutes = (endH * 60) + (endM || 0);

    if (startMinutes <= endMinutes) {
      return bsb.totalMinutes >= startMinutes && bsb.totalMinutes < endMinutes;
    } else {
      // Atravessa meia-noite (ex: 20:00 às 06:00)
      return bsb.totalMinutes >= startMinutes || bsb.totalMinutes < endMinutes;
    }
  }

  function getActiveCheckout() {
    return isWhatsAppActive() ? 'whatsapp' : 'bank';
  }

  /**
   * SVG de ícones para troca dinâmica nos botões
   */
  const WPP_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px;">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
    </svg>
  `;

  const BANK_ICON_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;vertical-align:-3px;margin-right:6px;">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  `;

  /**
   * Atualiza a interface gráfica dos botões na página atual
   */
  function applyDynamicCheckoutUI() {
    const isWpp = isWhatsAppActive();

    // 1. Botão de Checkout no Carrinho Lateral (#cart-checkout-btn)
    const cartBtn = document.getElementById('cart-checkout-btn');
    if (cartBtn) {
      if (isWpp) {
        cartBtn.className = 'btn btn-whatsapp';
        cartBtn.innerHTML = `${WPP_ICON_SVG}<span>${currentSettings.wppButtonText || 'Finalizar pedido no WhatsApp'}</span>`;
        // Subtítulo do carrinho
        const cartSub = cartBtn.nextElementSibling;
        if (cartSub && cartSub.tagName === 'P') {
          cartSub.textContent = 'Revise os itens e conclua o atendimento com nossa equipe.';
        }
      } else {
        cartBtn.className = 'btn btn-gold';
        cartBtn.innerHTML = `${BANK_ICON_SVG}<span>${currentSettings.bankButtonText || 'Finalizar Pedido Seguro'}</span>`;
        // Subtítulo do carrinho
        const cartSub = cartBtn.nextElementSibling;
        if (cartSub && cartSub.tagName === 'P') {
          cartSub.textContent = 'Ambiente 100% seguro • Pix ou Cartão em até 12x via InfinitePay';
        }
      }
    }

    // 2. Botão de Ação Direta na Página do Produto (#buy-whatsapp-btn)
    const buyBtn = document.getElementById('buy-whatsapp-btn');
    if (buyBtn) {
      if (isWpp) {
        buyBtn.className = 'btn btn-whatsapp btn-lg';
        buyBtn.innerHTML = `${WPP_ICON_SVG}<span>Pedir pelo WhatsApp</span>`;
      } else {
        buyBtn.className = 'btn btn-gold btn-lg';
        buyBtn.innerHTML = `${BANK_ICON_SVG}<span>Comprar Agora (Checkout Seguro)</span>`;
      }
    }
  }

  /**
   * Roteamento oficial de finalização de pedido
   */
  function routeCheckout(items, totalFormatted) {
    if (!items || items.length === 0) return;

    if (isWhatsAppActive()) {
      // ── MODO WHATSAPP: atendimento direto com equipe ──
      if (window.ntWpp?.checkout) {
        window.ntWpp.checkout(items, totalFormatted);
      } else {
        window.location.href = `https://wa.me/5575999283496?text=${encodeURIComponent('Olá! Vim pelo site da NT Eleganz e gostaria de finalizar meu pedido.')}`;
      }
    } else {
      // ── MODO CHECKOUT BANCO (InfinitePay): checkout online dedicado ──
      window.location.href = '/checkout/';
    }
  }

  /**
   * Compra imediata na PDP (adiciona ao carrinho e já manda pro checkout)
   */
  function routeDirectBuy(product, size, color, qty) {
    if (!product) return;

    if (isWhatsAppActive()) {
      window.ntWpp?.orderProduct(product, size, color, qty);
    } else {
      // No modo checkout banco: adiciona o item ao carrinho e já redireciona para /checkout/
      const itemToAdd = { ...product, size: size || '', color: color || '', qty: qty || 1 };
      window.ntCart?.add(itemToAdd);
      window.location.href = '/checkout/';
    }
  }

  /**
   * Atualiza as configurações em segundo plano a partir da API
   */
  async function fetchSettings() {
    try {
      const res = await fetch('/api/checkout_settings.php', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && data.settings) {
          currentSettings = { ...DEFAULT_SETTINGS, ...data.settings };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
          applyDynamicCheckoutUI();
        }
      }
    } catch (_) {}
  }

  // Intercepta e aprimora a função de checkout do carrinho
  function hookCart() {
    if (window.ntCart && !window.ntCart.__dynamicHooked) {
      const originalCheckout = window.ntCart.checkout;
      window.ntCart.checkout = function () {
        const items = window.ntCart.items() || [];
        if (items.length === 0) return;
        const total = typeof window.ntCart.getTotal === 'function'
          ? (new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(window.ntCart.getTotal() || 0))
          : 'R$ 0,00';
        routeCheckout(items, total);
        window.ntCart.close();
      };
      window.ntCart.__dynamicHooked = true;
    }

    const cartBtn = document.getElementById('cart-checkout-btn');
    if (cartBtn && !cartBtn.__dynamicClickHooked) {
      cartBtn.addEventListener('click', function (e) {
        if (!isWhatsAppActive()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          const items = (typeof window.ntCart?.items === 'function') ? window.ntCart.items() : [];
          if (items.length > 0) {
            window.location.href = '/checkout/';
          }
        }
      }, true);
      cartBtn.__dynamicClickHooked = true;
    }
  }

  // Intercepta o botão de comprar na página do produto se for checkout banco
  function hookProductPage() {
    const buyBtn = document.getElementById('buy-whatsapp-btn');
    if (buyBtn && !buyBtn.__dynamicHooked) {
      const originalClick = buyBtn.onclick;
      buyBtn.onclick = function (e) {
        if (!isWhatsAppActive()) {
          e?.preventDefault?.();
          e?.stopPropagation?.();
          // Simula compra imediata indo para /checkout/
          const addBtn = document.getElementById('add-to-cart-btn');
          if (addBtn) addBtn.click();
          window.location.href = '/checkout/';
          return false;
        } else if (typeof originalClick === 'function') {
          return originalClick.call(this, e);
        }
      };
      buyBtn.__dynamicHooked = true;
    }
  }

  function init() {
    applyDynamicCheckoutUI();
    hookCart();
    hookProductPage();
    fetchSettings();

    // Revalidação a cada 60 segundos (para virada exata de horário)
    setInterval(() => {
      applyDynamicCheckoutUI();
    }, 60000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Observa aberturas de carrinho ou re-renderizações da PDP
  window.addEventListener('load', () => {
    applyDynamicCheckoutUI();
    hookCart();
    hookProductPage();
  });

  // Exportação global
  window.NTDynamicCheckout = {
    isWhatsAppActive,
    getActiveCheckout,
    getSettings: () => ({ ...currentSettings }),
    getStatus: () => ({
      isWhatsAppActive: isWhatsAppActive(),
      activeCheckout: getActiveCheckout(),
      bsbTime: getBrasiliaTime(),
      mode: currentSettings.mode
    }),
    apply: applyDynamicCheckoutUI,
    checkout: routeCheckout,
    buyDirect: routeDirectBuy,
    refresh: fetchSettings
  };

})();
