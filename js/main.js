/* ============================================
   NT ELEGANZ — MAIN JS
   ============================================ */

(function () {
  'use strict';

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ── Product Data ──
  const PRODUCTS = [
    {
      id: 'polo-001',
      brand: 'Polo Ralph Lauren',
      name: 'Polo Custom Slim Fit',
      price: 'R$ 649,00',
      oldPrice: 'R$ 849,00',
      badge: 'DESTAQUE',
      image: 'assets/images/product-polo-cutout.webp',
      colors: ['#1a3a5c', '#000000', '#8b2020'],
      sizes: ['P', 'M', 'G', 'GG'],
      category: 'roupas',
      featured: true,
      desc: 'Polo clássica em piquet de algodão premium. Corte slim com bordado Polo Player em destaque.',
      slug: 'polo-ralph-lauren-custom-slim',
    },
    {
      id: 'moncler-001',
      brand: 'Moncler',
      name: 'Doudoune Maya Puffer',
      price: 'R$ 8.990,00',
      oldPrice: null,
      badge: 'LUXO',
      image: 'assets/images/product-moncler-cutout.webp',
      colors: ['#1c2b3a', '#000000', '#3a1c1c'],
      sizes: ['P', 'M', 'G', 'GG'],
      category: 'roupas',
      featured: true,
      desc: 'Jaqueta puffer icônica da Moncler, preenchida com pluma de ganso premium. Acabamento impecável.',
      slug: 'moncler-doudoune-maya',
    },
    {
      id: 'birkenstock-001',
      brand: 'Birkenstock',
      name: 'Arizona Leather',
      price: 'R$ 899,00',
      oldPrice: 'R$ 1.099,00',
      badge: 'OFERTA',
      image: 'assets/images/product-birkenstock-cutout.webp',
      colors: ['#8b6b3d', '#000000', '#d4c4a8'],
      sizes: ['38', '39', '40', '41', '42', '43'],
      category: 'calcados',
      desc: 'Sandália Arizona em couro genuíno com palmilha anatômica de cortiça e látex natural.',
      slug: 'birkenstock-arizona-leather',
    },
    {
      id: 'sundek-001',
      brand: 'Sundek',
      name: 'Short Classic Swim',
      price: 'R$ 429,00',
      oldPrice: null,
      badge: null,
      image: 'assets/images/product-sundek-cutout.webp',
      colors: ['#1a7a8a', '#1a3a8a', '#ffffff'],
      sizes: ['P', 'M', 'G', 'GG'],
      category: 'roupas',
      desc: 'Short de banho clássico Sundek com amarração ajustável e bolsos laterais com zíper.',
      slug: 'sundek-short-classic',
    },
    {
      id: 'allsaints-001',
      brand: 'All Saints',
      name: 'Kino Leather Biker',
      price: 'R$ 3.299,00',
      oldPrice: 'R$ 3.899,00',
      badge: 'BEST SELLER',
      image: 'assets/images/product-allsaints-cutout.webp',
      colors: ['#000000', '#3d2b1f'],
      sizes: ['P', 'M', 'G', 'GG'],
      category: 'roupas',
      featured: true,
      desc: 'Jaqueta biker em couro legítimo com hardware prateado. O ícone da marca All Saints.',
      slug: 'allsaints-kino-leather-biker',
    },
    {
      id: 'villebrequin-001',
      brand: 'Vilebrequin',
      name: 'Moorea Swim Trunks',
      price: 'R$ 1.190,00',
      oldPrice: null,
      badge: null,
      image: 'assets/images/product-sundek-cutout.webp',
      colors: ['#1a5c3a', '#1a3a5c', '#8b2020'],
      sizes: ['P', 'M', 'G', 'GG'],
      category: 'roupas',
      desc: 'Shorts de banho Moorea com estampa exclusiva e tecido de secagem rápida. Made in France.',
      slug: 'vilebrequin-moorea-swim',
    },
  ];
  // Catálogo de desenvolvimento. NÃO é fonte de verdade e não deve chegar ao
  // cliente: preços e imagens aqui são fictícios. Serve só de referência para
  // desenvolvimento offline e para o carrinho identificar produtos sem backend.
  window.NT_PRODUCT_DEFAULTS = PRODUCTS;

  // ── State ──
  let currentFilter = 'todos';
  // Começa vazio de propósito. Antes vinha [...PRODUCTS], e o primeiro render
  // mostrava esses produtos fictícios até o banco responder — o cliente via
  // Polo/Moncler com preço de demonstração por um instante. Enquanto o
  // catálogo não chegou, o grid mostra o skeleton do HTML.
  let ACTIVE_PRODUCTS = [];
  // Separa "ainda não carregou" de "carregou e está realmente vazio": no
  // primeiro caso o skeleton fica, no segundo a seção é escondida.
  let productsLoaded = false;

  function catalogCategory(product) {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const explicit = normalize(product.category);
    if (['camisetas', 'shorts', 'calcados', 'hoodies'].includes(explicit)) return explicit;
    const text = normalize(`${product.name || ''} ${product.category || ''}`);
    if (/calcado|sandalia|tenis|sapato|sneaker|birkenstock/.test(text)) return 'calcados';
    if (/short|bermuda|swim|trunk/.test(text)) return 'shorts';
    if (/hood|moletom|puffer|jaqueta|jacket|biker|leather/.test(text)) return 'hoodies';
    return 'camisetas';
  }

  // ── Load products from DB (if available) ──
  async function loadProductsFromDB(options = {}) {
    if (window.ntDB) {
      const requestedMode = window.ntDB.config?.().mode || 'local';
      try {
        const result = await window.ntDB.init();
        if (requestedMode !== 'local' && result?.mode !== requestedMode) {
          ACTIVE_PRODUCTS = [];
          window.NT_PRODUCTS = ACTIVE_PRODUCTS;
          productsLoaded = true;
          return;
        }

        // Pela camada de dados, nunca lendo o snapshot do LocalStorage direto:
        // era assim que a home continuava mostrando o catálogo antigo depois
        // de um produto ser criado ou editado no painel.
        const dbProducts = await window.ntDB.products.getAll(options);

        if (Array.isArray(dbProducts)) {
          // Só o que o servidor devolveu. A lista estática local ficaria de fora
          // de propósito: ela é catálogo de demonstração, não o da loja.
          ACTIVE_PRODUCTS = dbProducts.filter(p => p.active !== false);
        }
      } catch (e) {
        console.warn('DB load failed:', e);
        if (requestedMode !== 'local') ACTIVE_PRODUCTS = [];
      }
    } else {
      ACTIVE_PRODUCTS = [];
    }
    // Catálogo consultado (com sucesso ou não): a partir daqui o skeleton sai e
    // a seção passa a refletir a resposta real, inclusive quando ela é vazia.
    productsLoaded = true;
    window.NT_PRODUCTS = ACTIVE_PRODUCTS;
  }

  // ── Get products by filter ──
  function getFilteredProducts() {
    if (currentFilter === 'todos') return ACTIVE_PRODUCTS;
    return ACTIVE_PRODUCTS.filter(p => p.category === currentFilter);
  }

  // ── Render product card HTML ──
  // Resolução e recuperação das fotos de produto: js/image-loader.js (fonte única)
  const resolveProductImg = window.NTImages.resolve;

  function respSrcset(src) {
    if (!src || src.includes('products/')) return '';
    if (src.includes('cutout')) {
      const base = src.replace(/\.webp(\?.*)?$/, '');
      return ` srcset="${escHtml(base)}-400.webp 1x, ${escHtml(base)}-800.webp 2x"`;
    }
    return '';
  }

  function renderProductCard(product, index = 0) {
    const isOutOfStock = (product.stock !== undefined && Number(product.stock) <= 0) || product.inStock === false || product.available === false;
    const rawImage = product.image || (Array.isArray(product.images) && product.images[0]) || '';
    const vpsUrl = resolveProductImg(rawImage);
    const image = escHtml(vpsUrl);
    const brand = escHtml(product.brand || '');
    const name = escHtml(product.name || '');
    const productUrl = (window.ntWpp?.getProductUrl ? window.ntWpp.getProductUrl(product) : `/products/?id=${escHtml(product.id)}`);
    const isAboveFold = (index < 4);
    const loadAttrs = isAboveFold ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" decoding="async"';

    return `
      <a class="product-card ${isOutOfStock ? 'is-out-of-stock' : ''}" href="${productUrl}" data-product-id="${escHtml(product.id)}" aria-label="Ver ${name}">
        <div class="product-card__image-wrap">
          <img src="${image}" alt="${brand} ${name}" ${loadAttrs}
            style="${isOutOfStock ? 'filter: grayscale(100%); opacity: 0.6;' : ''}"
            onload="this.classList.add('is-loaded');if(this.parentElement)this.parentElement.classList.add('is-loaded');"
            onerror="window.handleProductImgError(this);">
          <button type="button" class="nte-img-retry-btn" aria-label="Recarregar imagem" title="Recarregar imagem" onclick="event.preventDefault();event.stopPropagation();window.nteRetryImage(this, event);">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
            </svg>
            <span>Recarregar</span>
          </button>
          ${isOutOfStock ? '<span class="product-card__badge badge-out-of-stock" style="display:inline-flex !important; position:absolute; top:12px; left:12px; background:#dc2626 !important; color:#ffffff !important; font-size:11px !important; font-weight:700 !important; letter-spacing:0.8px !important; padding:4px 10px !important; border-radius:4px !important; text-transform:uppercase !important; z-index:5 !important; box-shadow:0 2px 6px rgba(0,0,0,0.3) !important;">ESGOTADO</span>' : (product.badge ? `<span class="product-card__badge">${escHtml(product.badge)}</span>` : '')}
        </div>
        <div class="product-card__info">
          <span class="product-card__brand">${brand}</span>
          <h3 class="product-card__name" style="transition: color var(--transition-fast);">${name}</h3>
          <div class="product-card__price-row">
            <span class="product-card__price">${escHtml(product.price)}</span>
            ${product.oldPrice ? `<span class="product-card__price--old">${escHtml(product.oldPrice)}</span>` : ''}
          </div>
        </div>
      </a>
    `;
  }

  // ── Render products grid (legacy, unused) ──
  function renderProductsGrid() {
    const grid = document.getElementById('products-grid');
    if (!grid) return;
    const filtered = getFilteredProducts();
    grid.innerHTML = filtered.map((p, i) => renderProductCard(p, i)).join('');
}

// ── Render Mais Vendidos (bestsellers) ──
  function renderBestsellers() {
    const grid = document.getElementById('bestsellers-grid');
    const section = document.querySelector('.bestsellers-section');
    if (!grid) return;
    // Catálogo ainda não chegou: deixa os skeleton cards do HTML no lugar em vez
    // de esconder a seção. Esconder agora causaria um salto de layout, porque a
    // seção voltaria some milissegundos depois com os produtos reais.
    if (!productsLoaded) return;
    let featured = ACTIVE_PRODUCTS.filter(p => p.featured === true && p.active !== false);
    if (featured.length === 0) {
      // Sem destaque marcado, mostra os ativos do servidor: assim um produto
      // recém-criado aparece mesmo sem ter sido marcado como destaque.
      featured = ACTIVE_PRODUCTS.slice(0, 8);
    }
    if (featured.length === 0) {
      // Catálogo confirmado e vazio. Não se recorre a NT_PRODUCT_DEFAULTS aqui:
      // é catálogo fictício, e um cliente nunca deve ver preço de demonstração.
      if (section) section.style.display = 'none';
      return;
    }
    if (section) section.style.display = '';
    grid.innerHTML = featured.map((p, i) => renderProductCard(p, i)).join('');
  }

  let activeStorefrontFeedbacks = [];
  let currentFeedbackLightboxIndex = 0;
  let feedbackStageIndex = 0;
  let feedbackAutoPlayTimer = null;
  let isFeedbackHovered = false;

  function defaultStorefrontFeedbacks() {
    const list = Array.from({ length: 13 }, (_, index) => ({
      id: `fb-${index + 1}`,
      title: `Feedback ${index + 1}`,
      image: `assets/images/feedback-${index + 1}.webp`,
      order: index + 1
    }));
    list.push(
      { id: 'fb-1792764945-313d8', title: 'Feedback 14 - Jaqueta Moncler', image: '/assets/images/products/feedback-fb-1792764945-313d8-1792764945.webp', order: 14 },
      { id: 'fb-1792764983-c98cc', title: 'Feedback 15 - Camiseta CDG Play', image: '/assets/images/products/feedback-fb-1792764983-c98cc-1792764983.webp', order: 15 },
      { id: 'fb-1792765021-b6911', title: 'Feedback 16 - Camiseta CDG Play', image: '/assets/images/products/feedback-fb-1792765021-b6911-1792765021.webp', order: 16 },
      { id: 'fb-1792765096-77ca7', title: 'Feedback 17 - Bermuda Sundek', image: '/assets/images/products/feedback-fb-1792765096-77ca7-1792765096.webp', order: 17 }
    );
    return list;
  }

  function setFeedbackIndex(newIndex) {
    const count = activeStorefrontFeedbacks.length;
    if (!count) return;
    feedbackStageIndex = (newIndex % count + count) % count;
    updateFeedbackPositions();
  }

  function startFeedbackAutoPlay() {
    stopFeedbackAutoPlay();
    if (isFeedbackHovered) return;
    feedbackAutoPlayTimer = setInterval(() => {
      setFeedbackIndex(feedbackStageIndex + 1);
    }, 2000);
  }

  function stopFeedbackAutoPlay() {
    if (feedbackAutoPlayTimer) {
      clearInterval(feedbackAutoPlayTimer);
      feedbackAutoPlayTimer = null;
    }
  }

  function updateFeedbackPositions() {
    const stage = document.getElementById('feedback-stage');
    if (!stage) return;
    const cards = stage.querySelectorAll('.feedback-card');
    const count = activeStorefrontFeedbacks.length;
    if (!count || !cards.length) return;

    cards.forEach((card) => {
      const idx = parseInt(card.dataset.index, 10);
      let diff = (idx - feedbackStageIndex) % count;
      while (diff > count / 2) diff -= count;
      while (diff < -count / 2) diff += count;

      if (diff === 0) {
        card.className = 'feedback-card is-center';
        card.setAttribute('aria-hidden', 'false');
        card.setAttribute('tabindex', '0');
      } else if (diff === -1) {
        card.className = 'feedback-card is-left-1';
        card.setAttribute('aria-hidden', 'false');
        card.setAttribute('tabindex', '0');
      } else if (diff === 1) {
        card.className = 'feedback-card is-right-1';
        card.setAttribute('aria-hidden', 'false');
        card.setAttribute('tabindex', '0');
      } else if (diff === -2) {
        card.className = 'feedback-card is-left-2';
        card.setAttribute('aria-hidden', 'false');
        card.setAttribute('tabindex', '0');
      } else if (diff === 2) {
        card.className = 'feedback-card is-right-2';
        card.setAttribute('aria-hidden', 'false');
        card.setAttribute('tabindex', '0');
      } else if (diff === -3) {
        card.className = 'feedback-card is-hidden-left';
        card.setAttribute('aria-hidden', 'true');
        card.setAttribute('tabindex', '-1');
      } else if (diff === 3) {
        card.className = 'feedback-card is-hidden-right';
        card.setAttribute('aria-hidden', 'true');
        card.setAttribute('tabindex', '-1');
      } else if (diff < -3) {
        card.className = 'feedback-card is-hidden is-far-left';
        card.setAttribute('aria-hidden', 'true');
        card.setAttribute('tabindex', '-1');
      } else {
        card.className = 'feedback-card is-hidden is-far-right';
        card.setAttribute('aria-hidden', 'true');
        card.setAttribute('tabindex', '-1');
      }
    });

    const dots = document.querySelectorAll('.feedback-dot');
    dots.forEach((dot, idx) => {
      dot.classList.toggle('is-active', idx === feedbackStageIndex);
    });
  }

  function renderCatalogSections(feedbacksList = null) {
    const holder = document.getElementById('feedbacks-showcase-section') || document.getElementById('catalog-product-sections');
    if (!holder) return;

    if (Array.isArray(feedbacksList) && feedbacksList.length) {
      activeStorefrontFeedbacks = feedbacksList.filter(f => f.active !== false);
    }
    if (!activeStorefrontFeedbacks.length) {
      activeStorefrontFeedbacks = defaultStorefrontFeedbacks();
    }

    // Ordena os feedbacks conforme a ordem definida no admin
    activeStorefrontFeedbacks.sort((a, b) => (a.order || 0) - (b.order || 0));

    const count = activeStorefrontFeedbacks.length;
    if (feedbackStageIndex >= count) feedbackStageIndex = 0;

    // Renderiza os cards do carrossel 3D com fallback automático para VPS se imagem falhar
    const cardsHtml = activeStorefrontFeedbacks.map((item, index) => {
      const src = item.image || item;
      const title = item.title || `Feedback ${index + 1}`;
      return `<button type="button" class="feedback-card" data-index="${index}" aria-label="${title}">
        <img class="feedback-card__img" src="${src}" alt="${title}" loading="lazy" onerror="window.nteFeedbackImgError(this,'/assets/images/feedback-1.webp');" />
        <span class="feedback-card__badge" aria-hidden="true">✓ Cliente Verificado</span>
      </button>`;
    }).join('');

    // Renderiza os dots indicadores
    const dotsHtml = activeStorefrontFeedbacks.map((_, index) => {
      return `<button type="button" class="feedback-dot ${index === feedbackStageIndex ? 'is-active' : ''}" data-index="${index}" aria-label="Depoimento ${index + 1}"></button>`;
    }).join('');

    holder.innerHTML = `<section class="feedback-section" aria-labelledby="feedback-title">
      <header class="feedback-section__head">
        <div>
          <span class="feedback-section__eyebrow">Quem escolhe a NT</span>
          <h2 id="feedback-title" class="feedback-section__title">Feedbacks reais</h2>
        </div>
        <div class="feedback-section__actions">
          <span class="feedback-section__hint">Passe o mouse para pausar e ampliar</span>
          <div class="feedback-section__nav">
            <button type="button" class="feedback-nav-btn feedback-nav-btn--prev" id="feedback-nav-prev" aria-label="Depoimento anterior">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button type="button" class="feedback-nav-btn feedback-nav-btn--next" id="feedback-nav-next" aria-label="Próximo depoimento">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
          </div>
        </div>
      </header>

      <div class="feedback-showcase" id="feedback-showcase">
        <div class="feedback-showcase__stage" id="feedback-stage" role="region" aria-label="Carrossel de feedbacks de clientes">
          ${cardsHtml}
        </div>
        <div class="feedback-showcase__dots" id="feedback-dots">
          ${dotsHtml}
        </div>
      </div>

      <!-- Lightbox Modal para ampliação de qualquer feedback -->
      <div class="feedback-lightbox-modal" id="feedback-lightbox-modal" role="dialog" aria-modal="true" aria-label="Depoimento ampliado" hidden>
        <div class="feedback-lightbox-modal__backdrop" onclick="closeFeedbackLightbox()"></div>
        <button type="button" class="feedback-lightbox-modal__close" onclick="closeFeedbackLightbox()" aria-label="Fechar">×</button>
        <button type="button" class="feedback-lightbox-modal__nav feedback-lightbox-modal__nav--prev" onclick="stepFeedbackLightbox(-1)" aria-label="Feedback anterior">‹</button>
        <div class="feedback-lightbox-modal__content">
          <img class="feedback-lightbox-modal__img" id="feedback-lightbox-img" src="" alt="Feedback de cliente" loading="lazy" />
          <span class="feedback-lightbox-modal__counter" id="feedback-lightbox-counter">1 / ${activeStorefrontFeedbacks.length}</span>
        </div>
        <button type="button" class="feedback-lightbox-modal__nav feedback-lightbox-modal__nav--next" onclick="stepFeedbackLightbox(1)" aria-label="Próximo feedback">›</button>
      </div>
    </section>`;

    initFeedbackShowcase();
  }

  window.openFeedbackLightbox = function (index) {
    if (!activeStorefrontFeedbacks.length) return;
    stopFeedbackAutoPlay();
    currentFeedbackLightboxIndex = (index + activeStorefrontFeedbacks.length) % activeStorefrontFeedbacks.length;
    const item = activeStorefrontFeedbacks[currentFeedbackLightboxIndex];
    const modal = document.getElementById('feedback-lightbox-modal');
    const img = document.getElementById('feedback-lightbox-img');
    const counter = document.getElementById('feedback-lightbox-counter');

    if (!modal || !img) return;
    // A mesma <img> é reaproveitada a cada foto: zera o estado de recuperação da anterior
    window.NTImages.reset(img);
    img.onerror = function() {
      window.nteFeedbackImgError(this, '/assets/images/feedback-1.webp');
    };
    img.src = item.image || item;
    img.alt = item.title || `Feedback ${currentFeedbackLightboxIndex + 1}`;
    if (counter) counter.textContent = `${currentFeedbackLightboxIndex + 1} / ${activeStorefrontFeedbacks.length}`;

    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.classList.add('lightbox-open');
  };

  window.closeFeedbackLightbox = function () {
    const modal = document.getElementById('feedback-lightbox-modal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.hidden = true;
    }
    document.body.classList.remove('lightbox-open');
    if (!isFeedbackHovered) {
      startFeedbackAutoPlay();
    }
  };

  window.stepFeedbackLightbox = function (direction) {
    window.openFeedbackLightbox(currentFeedbackLightboxIndex + direction);
  };

  function initFeedbackShowcase() {
    const stage = document.getElementById('feedback-stage');
    if (!stage) return;

    // Atualiza posições dos cards
    updateFeedbackPositions();

    // Eventos nos cards
    const cards = stage.querySelectorAll('.feedback-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.index, 10);
        if (card.classList.contains('is-center')) {
          window.openFeedbackLightbox(idx);
        } else if (card.classList.contains('is-left-1')) {
          setFeedbackIndex(feedbackStageIndex - 1);
          startFeedbackAutoPlay();
        } else if (card.classList.contains('is-right-1')) {
          setFeedbackIndex(feedbackStageIndex + 1);
          startFeedbackAutoPlay();
        } else if (card.classList.contains('is-left-2')) {
          setFeedbackIndex(feedbackStageIndex - 2);
          startFeedbackAutoPlay();
        } else if (card.classList.contains('is-right-2')) {
          setFeedbackIndex(feedbackStageIndex + 2);
          startFeedbackAutoPlay();
        } else {
          setFeedbackIndex(idx);
          startFeedbackAutoPlay();
        }
      });
    });

    // Hover pausando o carrossel no stage e na imagem central
    stage.addEventListener('mouseenter', () => {
      isFeedbackHovered = true;
      stopFeedbackAutoPlay();
    });

    stage.addEventListener('mouseleave', () => {
      isFeedbackHovered = false;
      startFeedbackAutoPlay();
    });

    // Botões de navegação prev / next
    const prevBtn = document.getElementById('feedback-nav-prev');
    const nextBtn = document.getElementById('feedback-nav-next');
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        setFeedbackIndex(feedbackStageIndex - 1);
        startFeedbackAutoPlay();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        setFeedbackIndex(feedbackStageIndex + 1);
        startFeedbackAutoPlay();
      });
    }

    // Dots de navegação
    const dotsHolder = document.getElementById('feedback-dots');
    if (dotsHolder) {
      dotsHolder.addEventListener('click', (e) => {
        const dot = e.target.closest('.feedback-dot');
        if (!dot) return;
        const idx = parseInt(dot.dataset.index, 10);
        if (!isNaN(idx)) {
          setFeedbackIndex(idx);
          startFeedbackAutoPlay();
        }
      });
    }

    // Suporte a swipe touch no mobile
    let touchStartX = 0;
    stage.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
      }
      stopFeedbackAutoPlay();
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const touchEndX = e.changedTouches[0].clientX;
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 40) {
          if (diff < 0) {
            setFeedbackIndex(feedbackStageIndex + 1);
          } else {
            setFeedbackIndex(feedbackStageIndex - 1);
          }
        }
      }
      if (!isFeedbackHovered) {
        startFeedbackAutoPlay();
      }
    }, { passive: true });

    // Inicia autoplay de 2 em 2 segundos
    startFeedbackAutoPlay();

    // Eventos de teclado para fechar/navegar no lightbox
    if (!window._feedbackKeyHandlerAttached) {
      window._feedbackKeyHandlerAttached = true;
      document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('feedback-lightbox-modal');
        if (!modal || modal.hidden || !modal.classList.contains('is-open')) return;

        if (e.key === 'Escape') window.closeFeedbackLightbox();
        if (e.key === 'ArrowLeft') window.stepFeedbackLightbox(-1);
        if (e.key === 'ArrowRight') window.stepFeedbackLightbox(1);
      });
    }

    // Pausar autoplay quando a aba vai para background
    if (!window._feedbackVisibilityAttached) {
      window._feedbackVisibilityAttached = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          stopFeedbackAutoPlay();
        } else if (!isFeedbackHovered) {
          startFeedbackAutoPlay();
        }
      });
    }

    // Carrega feedbacks da API/JSON de forma assíncrona
    if (!window._feedbacksFetched) {
      window._feedbacksFetched = true;
      fetch('/api/feedbacks.php', { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          if (data && Array.isArray(data.feedbacks) && data.feedbacks.length) {
            renderCatalogSections(data.feedbacks);
          }
        })
        .catch(() => {
          fetch('/data/feedbacks.json', { cache: 'no-store' })
            .then(res => res.json())
            .then(list => {
              if (Array.isArray(list) && list.length) {
                renderCatalogSections(list);
              }
            })
            .catch(() => {});
        });
    }
  }

  const initFeedbackGallery = initFeedbackShowcase;

  // ── Get product by ID ──
  function getProduct(id) {
    return ACTIVE_PRODUCTS.find(p => p.id === id);
  }

  // ── Add to cart ──
  window.addToCart = function (productId, size = null, color = null) {
    const product = getProduct(productId);
    if (!product) return;
    const variant = window.ntCart?.defaultVariant?.(product) || {};
    window.ntCart?.add({ ...product, size: size || variant.size, color: color || variant.color });
  };

  // ── Buy now via WhatsApp ──
  window.buyNow = function (productId, size = null, color = null) {
    const product = getProduct(productId);
    if (!product) return;
    window.ntWpp?.orderProduct(
      product,
      size || product.sizes[0],
      color || 'Padrão'
    );
  };

  // ── Filter tabs ──
  function initFilterTabs() {
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentFilter = tab.dataset.filter || 'todos';
        renderProductsGrid();
      });
    });
  }

  // ── Sticky header ──
  function initStickyHeader() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 60);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Search bar ──
  function initSearch() {
    if (window.NTSearch?.init) {
      window.NTSearch.init();
      return;
    }
    const searchBar = document.getElementById('search-bar');
    const searchBtn = document.getElementById('search-btn');
    const searchClose = document.getElementById('search-close');
    const searchInput = document.getElementById('search-input');

    if (!searchBar) return;

    searchBtn?.addEventListener('click', () => {
      searchBar.classList.add('open');
      setTimeout(() => searchInput?.focus(), 100);
    });

    searchClose?.addEventListener('click', () => {
      searchBar.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchBar.classList.remove('open');
        window.ntMenu?.close();
        window.ntCart?.close();
      }
    });
  }

  // ── FAQ Accordion ──
  function initFAQ() {
    const items = document.querySelectorAll('.faq-item');
    items.forEach((item, i) => {
      item.style.setProperty('--i', i);
      const trigger = item.querySelector('.faq-trigger');
      if (!trigger) return;
      trigger.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        // Close all
        items.forEach(it => it.classList.remove('open'));
        // Toggle current
        if (!isOpen) item.classList.add('open');
      });
    });
  }

  // ── Page loader ──
  function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 500);
  }

  // ── Scroll reveal (GSAP or fallback) ──
  function initScrollReveal() {
    const revealWithObserver = () => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('revealed');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.15 }
      );
      document.querySelectorAll('[data-reveal]').forEach(el => observer.observe(el));
    };

    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
      try {
        gsap.registerPlugin(ScrollTrigger);

        // Reveal sections. The base CSS starts these elements invisible, so the
        // animation must explicitly finish at the visible state.
        gsap.utils.toArray('[data-reveal]').forEach((el) => {
          gsap.fromTo(el,
            { opacity: 0, y: 40 },
            {
              opacity: 1,
              y: 0,
              duration: 0.8,
              ease: 'power2.out',
              scrollTrigger: {
                trigger: el,
                start: 'top 85%',
                toggleActions: 'play none none none',
              },
              onComplete: () => {
                el.classList.add('revealed');
                gsap.set(el, { clearProps: 'opacity,transform' });
              },
            }
          );
        });

        // Stagger product cards
        gsap.utils.toArray('.products-grid').forEach((grid) => {
          const cards = grid.querySelectorAll('.product-card');
          if (!cards.length) return;
          gsap.from(cards, {
            opacity: 0,
            y: 30,
            stagger: 0.08,
            duration: 0.6,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: grid,
              start: 'top 80%',
            },
          });
        });

      } catch (error) {
        // A CDN dep loaded partially or failed (Chrome with blocked network):
        // never leave [data-reveal] hidden. Fall back to the observer below.
        revealWithObserver();
      }
    } else {
      // Fallback: IntersectionObserver
      revealWithObserver();
    }
  }

  function initHeroCoverScroll() {
    const hero = document.querySelector('.hero-static');
    const image = hero?.querySelector('.hero-static__img-wrap img');
    const content = hero?.querySelector('.hero-quote-right');
    if (!hero || typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.to(image, { scale: 1.09, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to(content, { y: -42, opacity: .35, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom 25%', scrub: true } });
  }

  // ── Mouse glow on buttons ──
  function initButtonGlow() {
    document.querySelectorAll('.btn-glow-hover').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        btn.style.setProperty('--mx', `${x}%`);
        btn.style.setProperty('--my', `${y}%`);
      });
    });
  }

  // ── WhatsApp float button ──
  function initWhatsAppFloat() {
    const btn = document.getElementById('whatsapp-float');
    if (btn) {
      btn.addEventListener('click', () => window.ntWpp?.openGreeting());
    }
  }

  // ── Init all ──
  document.addEventListener('DOMContentLoaded', async () => {
    hideLoader();
    initStickyHeader();
    initSearch();
    initFAQ();
    initFilterTabs();

    // Hydration: o HTML já vem com os skeleton cards no lugar, e a galeria de
    // feedback é estática (depende só das imagens em assets/), então entra
    // agora. O grid de produtos fica no skeleton até o catálogo chegar.
    renderCatalogSections();
    initFeedbackGallery();
    document.dispatchEvent(new Event('nte:feedbacks-ready'));

    //products.getAll() devolve o snapshot do LocalStorage sem esperar a rede,
    // então o grid real aparece já no primeiro paint de verdade.
    await loadProductsFromDB();
    renderBestsellers();

    initScrollReveal();
    initHeroCoverScroll();
    initButtonGlow();
    initWhatsAppFloat();

    // Load WhatsApp settings from storage
    try {
      const wppSettings = JSON.parse(localStorage.getItem('nte_wpp_settings') || '{}');
      if (wppSettings.number && window.ntWpp) {
        window.ntWpp._number = wppSettings.number;
      }
    } catch (e) { /* ignore */ }

  });

  // Desenha o grid com o que já está em memória. NÃO busca nada: quem traga o
  // dado novo é a camada de dados, e ela só avisa quando o conteúdo mudou de
  // fato. Assim o grid não é reconstruído a toa a cada 20s.
  const refreshStorefrontProducts = async () => {
    await loadProductsFromDB();
    // Só o grid de produtos depende do catálogo. A galeria de feedback é
    // estática e NÃO é reconstruída aqui: re-injectá-la a cada mudança
    // descartaria a seleção do visualizador de imagens.
    renderBestsellers();
  };

  // Revalidação barata: envia If-None-Match e o servidor responde 304 sem corpo
  // quando o catálogo não mudou. `reload: true` desliga justamente esse
  // mecanismo (db.js:628) e obriga a baixar o catálogo inteiro de novo — era o
  // que fazia cada aba rebaixar a lista completa a cada 20 segundos.
  const revalidateCatalog = () => { window.ntDB?.refresh?.('products'); };

  // O evento só é disparado quando a assinatura do conteúdo divergiu, e o dado
  // novo já está no cache de memória quando chega aqui. Por isso o handler
  // renderiza sem `reload`: um `reload` aqui seria um segundo download do
  // catálogo logo depois do primeiro.
  window.addEventListener('nte:products-changed', () => { refreshStorefrontProducts(); });
  window.addEventListener('storage', event => {
    if (event.key === 'nte_hydrated_products' || event.key === 'nte_products') {
      refreshStorefrontProducts();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revalidateCatalog();
  });

})();
