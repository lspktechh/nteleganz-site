/* ============================================
   NT ELEGANZ — CART MODULE
   ============================================ */

(function () {
  'use strict';

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ── State ──
  const localStorageKey = 'ntCartItems';
  const cartImageDatabase = 'nte_cart_images';
  const cartImageStore = 'images';
  let cartImageDatabasePromise = null;

  function getCartImageDatabase() {
    if (cartImageDatabasePromise) return cartImageDatabasePromise;
    cartImageDatabasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponível.'));
      const request = indexedDB.open(cartImageDatabase, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(cartImageStore)) request.result.createObjectStore(cartImageStore);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de imagens.'));
    });
    return cartImageDatabasePromise;
  }

  async function saveCartImage(key, image) {
    const database = await getCartImageDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(cartImageStore, 'readwrite');
      transaction.objectStore(cartImageStore).put(image, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar a imagem.'));
    });
  }

  async function loadCartImage(key) {
    const database = await getCartImageDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(cartImageStore, 'readonly').objectStore(cartImageStore).get(key);
      request.onsuccess = () => resolve(request.result || '');
      request.onerror = () => reject(request.error || new Error('Não foi possível carregar a imagem.'));
    });
  }

  const cartStorage = {
    compactItem(item, index) {
      const image = item.image || (Array.isArray(item.images) ? item.images[0] : '') || item.imageUrl || '';
      const imageAssetKey = typeof image === 'string' && image.startsWith('data:')
        ? `cart-image-${item.id || item.slug || index}`
        : item.imageAssetKey || '';
      return {
        id: item.id,
        brand: item.brand || '',
        name: item.name || '',
        price: item.price || '',
        image: typeof image === 'string' && !image.startsWith('data:') ? image : '',
        imageAssetKey,
        size: item.size || 'Único',
        color: item.color || 'Padrão',
        type: item.type || '',
        category: item.category || '',
        qty: Math.max(1, Number(item.qty) || 1),
        // Item adicionado pela Coleção VIP: preço VIP (o servidor confere o token antes de aplicar).
        vipPricing: item.vipPricing === true,
        vipDiscountPercent: item.vipPricing === true ? Number(item.vipDiscountPercent) || 0 : 0,
      };
    },
    load() {
      try {
        const stored = localStorage.getItem(localStorageKey);
        const parsed = stored ? JSON.parse(stored) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async save(items) {
      const compactItems = items.map((item, index) => this.compactItem(item, index));
      await Promise.all(items.map(async (item, index) => {
        const image = item.image || (Array.isArray(item.images) ? item.images[0] : '') || item.imageUrl || '';
        const compactItem = compactItems[index];
        if (compactItem.imageAssetKey && typeof image === 'string' && image.startsWith('data:')) {
          await saveCartImage(compactItem.imageAssetKey, image);
        }
      })).catch(error => console.warn('Não foi possível salvar imagens do carrinho:', error));
      try {
        localStorage.setItem(localStorageKey, JSON.stringify(compactItems));
      } catch (error) {
        try {
          localStorage.setItem(localStorageKey, JSON.stringify(compactItems.map(item => ({ ...item, image: '' }))));
        } catch (fallbackError) {
          console.warn('Não foi possível persistir o carrinho:', fallbackError);
        }
      }
    },
    clear() {
      localStorage.removeItem(localStorageKey);
    },
  };

  let cartItems = cartStorage.load();
  let isOpen = false;
  const cartChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('nte-cart');

  function dispatchCartChange() {
    document.dispatchEvent(new CustomEvent('nte:cart-changed', { detail: { items: cartItems } }));
  }

  function announceCartChange() {
    cartChannel?.postMessage({ type: 'cart-updated' });
    dispatchCartChange();
  }

  function syncExternalCart(items) {
    cartItems = Array.isArray(items) ? items : [];
    updateBadge();
    renderCart();
    hydrateCartImages().finally(dispatchCartChange);
  }

  // ── DOM refs (lazy) ──
  function getDOM() {
    return {
      drawer: document.getElementById('cart-drawer'),
      backdrop: document.getElementById('overlay-backdrop'),
      badge: document.getElementById('cart-badge'),
      itemsList: document.getElementById('cart-items-list'),
      emptyState: document.getElementById('cart-empty'),
      totalEl: document.getElementById('cart-total'),
      checkoutBtn: document.getElementById('cart-checkout-btn'),
      checkoutOnlineBtn: document.getElementById('cart-checkout-online-btn'),
    };
  }

  // ── Format currency ──
  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  }

  // ── Parse price string to number ──
  function parsePrice(priceStr) {
    if (!priceStr) return 0;
    return parseFloat(priceStr.replace(/[^\d,]/g, '').replace(',', '.')) || 0;
  }

  // ── Calculate total ──
  function getTotal() {
    return cartItems.reduce((sum, item) => sum + parsePrice(item.price) * (item.qty || 1), 0);
  }

  function normalizeVariantValue(value, fallback = '') {
    return String(value ?? fallback).trim().toLowerCase();
  }

  const COLOR_NAMES = {
    '#1a3a5c': 'Navy', '#000000': 'Preto', '#8b2020': 'Bordô',
    '#1c2b3a': 'Azul Escuro', '#3a1c1c': 'Vinho', '#8b6b3d': 'Tabaco',
    '#d4c4a8': 'Areia', '#1a7a8a': 'Turquesa', '#1a3a8a': 'Azul Royal',
    '#ffffff': 'Branco', '#3d2b1f': 'Marrom', '#1a5c3a': 'Verde',
  };

  function defaultColor(product) {
    const colors = (product && Array.isArray(product.colors) && product.colors.length) ? product.colors : ['#000000'];
    const firstColor = colors[0];
    return COLOR_NAMES[String(firstColor)] || String(firstColor || '');
  }

  function defaultVariant(product) {
    return {
      size: (product && Array.isArray(product.sizes) && product.sizes.length) ? String(product.sizes[0]) : 'Único',
      color: defaultColor(product) || 'Preto',
    };
  }

  function isPlaceholderColor(value) {
    const color = normalizeVariantValue(value, 'padrao');
    return !color || color === 'padrao' || color === 'padrão' || color === 'default';
  }

  function isPlaceholderSize(value) {
    const size = normalizeVariantValue(value, 'unico');
    return !size || size === 'unico' || size === 'único';
  }

  function resolveCatalogProduct(item, catalogProduct) {
    if (catalogProduct && productIdentity(catalogProduct) === productIdentity(item)) return catalogProduct;
    if (!Array.isArray(window.NT_PRODUCTS)) return null;
    const identity = productIdentity(item);
    return window.NT_PRODUCTS.find(p => productIdentity(p) === identity) || null;
  }

  function canonicalColor(item, catalogProduct) {
    const color = normalizeVariantValue(item.color, 'padrao');
    if (!isPlaceholderColor(color)) return color;
    const product = resolveCatalogProduct(item, catalogProduct);
    return product ? normalizeVariantValue(defaultColor(product), 'padrao') : color;
  }

  function canonicalSize(item, catalogProduct) {
    const size = normalizeVariantValue(item.size, 'unico');
    if (!isPlaceholderSize(size)) return size;
    const product = resolveCatalogProduct(item, catalogProduct);
    if (!product || !Array.isArray(product.sizes) || !product.sizes.length) return size;
    const defaultSize = normalizeVariantValue(String(product.sizes[0]), 'unico');
    return isPlaceholderSize(defaultSize) ? 'unico' : defaultSize;
  }

  function productIdentity(item) {
    return normalizeVariantValue(
      item.id || item.slug || [item.brand, item.name].filter(Boolean).join('|')
    );
  }

  function imageSource(item) {
    const image = item.image || (Array.isArray(item.images) ? item.images[0] : '') || item.imageUrl;
    if (typeof image !== 'string' || !image.trim()) {
      return 'assets/images/product-polo.webp';
    }
    try {
      return new URL(image, document.baseURI).href;
    } catch {
      return image;
    }
  }

  async function hydrateCartImages() {
    await Promise.all(cartItems.map(async item => {
      if (!item.imageAssetKey || item.image) return;
      try {
        item.image = await loadCartImage(item.imageAssetKey);
      } catch (error) {
        console.warn('Não foi possível carregar a imagem persistida do carrinho:', error);
      }
    }));
    renderCart();
  }

  function sameVariant(firstItem, secondItem, catalogProduct) {
    const firstIdentity = productIdentity(firstItem);
    const secondIdentity = productIdentity(secondItem);
    if (!firstIdentity || !secondIdentity) return false;
    // The product page and the home/catalog cards can describe the same product
    // with different type/category fields, so identity + size + color is what
    // defines a variant here.
    return firstIdentity === secondIdentity
      // Mesmo produto com preço normal e com preço VIP são linhas diferentes no carrinho.
      && (firstItem.vipPricing === true) === (secondItem.vipPricing === true)
      && canonicalSize(firstItem, catalogProduct) === canonicalSize(secondItem, catalogProduct)
      && canonicalColor(firstItem, catalogProduct) === canonicalColor(secondItem, catalogProduct);
  }

  function findVariantIndex(product) {
    return cartItems.findIndex(item => sameVariant(item, product, product));
  }

  // ── Update badge ──
  function updateBadge() {
    const dom = getDOM();
    if (!dom.badge) return;
    const count = cartItems.reduce((sum, i) => sum + (i.qty || 1), 0);
    dom.badge.textContent = count;
    dom.badge.classList.toggle('visible', count > 0);
  }

  // ── Render cart items ──
  function renderCart() {
    const dom = getDOM();
    if (!dom.itemsList) return;

    if (cartItems.length === 0) {
      dom.itemsList.innerHTML = '';
      if (dom.emptyState) dom.emptyState.style.display = 'flex';
      if (dom.totalEl) dom.totalEl.textContent = 'R$ 0,00';
      if (dom.checkoutBtn) dom.checkoutBtn.disabled = true;
      if (dom.checkoutOnlineBtn) dom.checkoutOnlineBtn.disabled = true;
      return;
    }

    if (dom.emptyState) dom.emptyState.style.display = 'none';
    if (dom.checkoutBtn) dom.checkoutBtn.disabled = false;
    if (dom.checkoutOnlineBtn) dom.checkoutOnlineBtn.disabled = false;

    dom.itemsList.innerHTML = cartItems.map((item, idx) => `
      <div class="cart-item" data-idx="${idx}">
        <img class="cart-item__img" src="${escHtml(imageSource(item))}" alt="${escHtml(item.name || 'Produto')}" loading="eager" onerror="this.onerror=null;this.src='/assets/images/product-polo.webp';">
        <div class="cart-item__info">
          <span class="cart-item__brand">${escHtml(item.brand || '')}</span>
          <span class="cart-item__name">${escHtml(item.name)}</span>
          <span class="cart-item__meta">${escHtml([item.size, item.color].filter(Boolean).join(' · '))}</span>
          <span class="cart-item__price">${escHtml(item.price)}</span>
          <div class="cart-item__quantity" aria-label="Quantidade de ${escHtml(item.name)}">
            <button type="button" class="cart-item__quantity-btn" data-cart-action="decrease" data-cart-index="${idx}" aria-label="Diminuir quantidade de ${escHtml(item.name)}">−</button>
            <span aria-live="polite">${escHtml(item.qty) || 1}</span>
            <button type="button" class="cart-item__quantity-btn" data-cart-action="increase" data-cart-index="${idx}" aria-label="Aumentar quantidade de ${escHtml(item.name)}">+</button>
          </div>
        </div>
        <button type="button" class="cart-item__remove" data-cart-action="remove" data-cart-index="${idx}" aria-label="Remover todas as unidades de ${escHtml(item.name)}">×</button>
      </div>
    `).join('');

    if (dom.totalEl) dom.totalEl.textContent = formatCurrency(getTotal());
  }

  // ── Add item ──
  function addItem(product) {
    const qty = Math.max(1, Math.floor(Number(product.qty) || 1));
    const index = findVariantIndex(product);
    const existing = index === -1 ? null : cartItems[index];

    if (existing) {
      existing.qty = (existing.qty || 1) + qty;
      const fallbackVariant = defaultVariant(product);
      if (isPlaceholderColor(existing.color)) {
        const realColor = isPlaceholderColor(product.color) ? fallbackVariant.color : product.color;
        if (!isPlaceholderColor(realColor)) existing.color = realColor;
      }
      if (isPlaceholderSize(existing.size)) {
        const realSize = isPlaceholderSize(product.size) ? fallbackVariant.size : product.size;
        if (!isPlaceholderSize(realSize)) existing.size = realSize;
      }
    } else {
      cartItems.push({ ...product, qty });
    }

    cartStorage.save(cartItems);
    announceCartChange();
    updateBadge();
    renderCart();
    openCart();
    showToast(null, 'Produto adicionado ao carrinho', [product.brand, product.name].filter(Boolean).join(' — '));

    // Rastreamento: AddToCart para Meta Ads / GA4 / TikTok
    if (window.nteTracking && typeof window.nteTracking.trackAddToCart === 'function') {
      window.nteTracking.trackAddToCart(product);
    }
  }

  // ── Remove item ──
  function removeItem(idx) {
    cartItems.splice(idx, 1);
    cartStorage.save(cartItems);
    announceCartChange();
    updateBadge();
    renderCart();
  }

  function increaseItem(idx) {
    const item = cartItems[idx];
    if (!item) return;
    item.qty = (item.qty || 1) + 1;
    cartStorage.save(cartItems);
    announceCartChange();
    updateBadge();
    renderCart();
  }

  function decreaseItem(idx) {
    const item = cartItems[idx];
    if (!item) return;
    if ((item.qty || 1) <= 1) {
      removeItem(idx);
      return;
    }
    item.qty -= 1;
    cartStorage.save(cartItems);
    announceCartChange();
    updateBadge();
    renderCart();
  }

  function getItemQuantity(product) {
    const index = findVariantIndex(product);
    return index === -1 ? 0 : cartItems[index].qty || 1;
  }

  function changeVariantQuantity(product, change) {
    const index = findVariantIndex(product);
    if (index === -1) {
      if (change > 0) addItem(product);
      return;
    }
    if (change > 0) increaseItem(index);
    else if (change < 0) decreaseItem(index);
  }

  function removeVariant(product) {
    const index = findVariantIndex(product);
    if (index !== -1) removeItem(index);
  }

  // ── Clear cart ──
  function clearCart() {
    cartStorage.clear();
    cartItems = [];
    announceCartChange();
    updateBadge();
    renderCart();
  }

  // ── Open / Close ──
  function openCart() {
    const dom = getDOM();
    if (!dom.drawer) return;
    isOpen = true;
    dom.drawer.classList.add('open');
    if (dom.backdrop) dom.backdrop.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeCart() {
    const dom = getDOM();
    if (!dom.drawer) return;
    isOpen = false;
    dom.drawer.classList.remove('open');
    if (dom.backdrop) dom.backdrop.classList.remove('active');
    document.body.style.overflow = '';
  }

  function toggleCart() {
    isOpen ? closeCart() : openCart();
  }

  // ── Checkout via WhatsApp (Atendimento direto com equipe) ──
  function checkoutWhatsApp() {
    if (cartItems.length === 0) return;
    const total = formatCurrency(getTotal());
    window.ntWpp?.checkout(cartItems, total);
    closeCart();
  }

  // ── Checkout Online Oficial (Mercado Pago • Pix e Cartão até 12x) ──
  function checkoutOnline() {
    if (cartItems.length === 0) return;
    closeCart();
    window.location.href = '/checkout/';
  }

  function checkout() {
    checkoutOnline();
  }

  // ── Toast notification ──
  function showToast(icon, title, msg) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const currentToast = container.querySelector('.toast');
    if (currentToast) currentToast.remove();

    const escapeHTML = value => String(value || '').replace(/[&<>"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    })[character]);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <div class="toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4 4L19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div class="toast-content">
        <div class="toast-title">${escapeHTML(title)}</div>
        ${msg ? `<div class="toast-msg">${escapeHTML(msg)}</div>` : ''}
      </div>
      <button class="toast-action" type="button">Ver carrinho</button>
      <button class="toast-close" type="button" aria-label="Fechar notificação">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>
      <span class="toast-progress" aria-hidden="true"></span>
    `;

    container.appendChild(toast);

    let removalTimer;
    const dismiss = () => {
      clearTimeout(removalTimer);
      if (!toast.isConnected || toast.classList.contains('removing')) return;
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 280);
    };

    toast.querySelector('.toast-action').addEventListener('click', () => {
      openCart();
      dismiss();
    });
    toast.querySelector('.toast-close').addEventListener('click', dismiss);

    removalTimer = setTimeout(dismiss, 4200);
  }

  // ── Public API ──
  window.ntCart = {
    add: addItem,
    remove: removeItem,
    removeItem,
    increaseItem,
    decreaseItem,
    getItemQuantity,
    changeVariantQuantity,
    removeVariant,
    clear: clearCart,
    open: openCart,
    close: closeCart,
    toggle: toggleCart,
    checkout,
    checkoutOnline,
    checkoutWhatsApp,
    items: () => cartItems,
    defaultVariant,
    showToast,
  };

  // ── Init ──
  document.addEventListener('DOMContentLoaded', () => {
    renderCart();
    updateBadge();
    hydrateCartImages();

    // Close on backdrop click
    const backdrop = document.getElementById('overlay-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => {
        closeCart();
        window.ntMenu?.close();
      });
    }

    // Cart button
    const cartBtn = document.getElementById('cart-open-btn');
    if (cartBtn) cartBtn.addEventListener('click', toggleCart);

    // Checkout Online button (Mercado Pago • Site)
    const checkoutOnlineBtn = document.getElementById('cart-checkout-online-btn');
    if (checkoutOnlineBtn) checkoutOnlineBtn.addEventListener('click', checkoutOnline);

    // Checkout WhatsApp button (Atendimento com equipe)
    const checkoutBtn = document.getElementById('cart-checkout-btn');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkoutWhatsApp);

    // Close button
    const closeBtn = document.getElementById('cart-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeCart);

    const itemsList = document.getElementById('cart-items-list');
    if (itemsList) {
      itemsList.addEventListener('click', event => {
        const button = event.target.closest('[data-cart-action]');
        if (!button) return;
        const index = Number(button.dataset.cartIndex);
        if (!Number.isInteger(index)) return;
        const actions = {
          increase: increaseItem,
          decrease: decreaseItem,
          remove: removeItem,
        };
        actions[button.dataset.cartAction]?.(index);
      });
    }
  });

  window.addEventListener('storage', event => {
    if (event.key !== localStorageKey) return;
    syncExternalCart(cartStorage.load());
  });

  cartChannel?.addEventListener('message', event => {
    if (event.data?.type !== 'cart-updated') return;
    syncExternalCart(cartStorage.load());
  });
})();
