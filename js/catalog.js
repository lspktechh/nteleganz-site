
/* ============================================
   CATALOG PAGE JS — lightweight, responsive UI
   ============================================ */
(function () {
  'use strict';

  // ── Default products ──
  const PRODUCTS = [
    { id: 'polo-001', brand: 'Polo Ralph Lauren', name: 'Polo Custom Slim Fit', price: 'R$ 649,00', priceNum: 649, oldPrice: 'R$ 849,00', badge: 'DESTAQUE', image: 'assets/images/product-polo-cutout.webp', sizes: ['P','M','G','GG'], category: 'camisetas', featured: true, slug: 'polo-ralph-lauren-custom-slim' },
    { id: 'moncler-001', brand: 'Moncler', name: 'Doudoune Maya Puffer', price: 'R$ 8.990,00', priceNum: 8990, oldPrice: null, badge: 'LUXO', image: 'assets/images/product-moncler-cutout.webp', sizes: ['P','M','G','GG'], category: 'hoodies', featured: true, slug: 'moncler-doudoune-maya' },
    { id: 'birkenstock-001', brand: 'Birkenstock', name: 'Arizona Leather', price: 'R$ 899,00', priceNum: 899, oldPrice: 'R$ 1.099,00', badge: 'OFERTA', image: 'assets/images/product-birkenstock-cutout.webp', sizes: ['38','39','40','41','42','43'], category: 'calcados', slug: 'birkenstock-arizona-leather' },
    { id: 'sundek-001', brand: 'Sundek', name: 'Short Classic Swim', price: 'R$ 429,00', priceNum: 429, oldPrice: null, badge: null, image: 'assets/images/product-sundek-cutout.webp', sizes: ['P','M','G','GG'], category: 'shorts', slug: 'sundek-short-classic' },
    { id: 'allsaints-001', brand: 'All Saints', name: 'Kino Leather Biker', price: 'R$ 3.299,00', priceNum: 3299, oldPrice: 'R$ 3.899,00', badge: 'BEST SELLER', image: 'assets/images/product-allsaints-cutout.webp', sizes: ['P','M','G','GG'], category: 'hoodies', featured: true, slug: 'allsaints-kino-leather-biker' },
    { id: 'villebrequin-001', brand: 'Vilebrequin', name: 'Moorea Swim Trunks', price: 'R$ 1.190,00', priceNum: 1190, oldPrice: null, badge: null, image: 'assets/images/product-sundek-cutout.webp', sizes: ['P','M','G','GG'], category: 'shorts', slug: 'vilebrequin-moorea-swim' },
  ];
  // Catálogo de desenvolvimento, só de referência. Não é fonte de verdade: os
  // preços aqui são fictícios e não devem chegar ao cliente.
  window.NT_PRODUCT_DEFAULTS = PRODUCTS;

  // Começa vazio: o catálogo vem do ntDB. Antes vinha [...PRODUCTS], que
  // sobrevivia a uma falha de carregamento e arrivava ao cliente como se fosse
  // a loja.
  let ALL_PRODUCTS = [];
  let activeCategory = 'todos';
  let activeSort = 'default';
  let priceMin = 0, priceMax = 99999;
  let searchQuery = '';
  let page = 1;
  const PER_PAGE = 500;
  const CATEGORY_LABELS = { todos:'Collections', camisetas:'Camisetas', shorts:'Shorts', calcados:'Calçados', hoodies:'Hoodies' };
  const getCategoryLabel = cat => CATEGORY_LABELS[cat] || (cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : 'Collections');
  let currentGridCols = 4;
  const rules = window.NTCatalogFilters;
  const selected = { brands: [], sizes: [], stock: false, sale: false };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  priceMax = Infinity;
  const pathCategory = location.pathname.match(/\/collections\/([^/]+)(?:\/|$)/)?.[1];
  const categoryParam = (pathCategory && pathCategory !== 'index.html' ? pathCategory : null) || new URLSearchParams(location.search).get('categoria');
  if (categoryParam && categoryParam !== 'todos') activeCategory = categoryParam;

  const urlSearchParam = new URLSearchParams(location.search).get('q')
    || new URLSearchParams(location.search).get('busca')
    || new URLSearchParams(location.search).get('search');
  if (urlSearchParam) {
    searchQuery = urlSearchParam.trim().toLocaleLowerCase('pt-BR');
  }

  function filterState() { return { ...selected, category: activeCategory, sort: activeSort, min: priceMin, max: priceMax, query: searchQuery }; }
  function resetFilters() {
    selected.brands = []; selected.sizes = []; selected.stock = false; selected.sale = false;
    priceMin = 0; priceMax = Infinity; searchQuery = ''; activeCategory = 'todos'; page = 1;
    history.pushState({}, '', '/collections/');
    document.querySelectorAll('#search-input, #catalog-search').forEach(input => input.value = '');
    syncControls(); render();
  }
  function syncControls() {
    if (searchQuery) {
      document.querySelectorAll('#search-input, #catalog-search').forEach(input => {
        if (!input.value) input.value = searchQuery;
      });
    }
    document.querySelectorAll('[data-filter-group]').forEach(input => {
      const group = input.dataset.filterGroup;
      input.checked = Array.isArray(selected[group]) ? selected[group].includes(input.value) : selected[group];
    });
    document.querySelectorAll('[data-price]').forEach(input => input.value = input.dataset.price === 'min' ? priceMin || '' : Number.isFinite(priceMax) ? priceMax : '');
    document.querySelectorAll('.cat-pill').forEach(button => {
      button.classList.toggle('active', button.dataset.cat === activeCategory);
      button.setAttribute('aria-pressed', String(button.dataset.cat === activeCategory));
    });
    const heading = document.querySelector('.catalog-hero__title');
    if (heading) heading.textContent = getCategoryLabel(activeCategory);
    const hero = document.getElementById('catalog-hero');
    if (hero) hero.hidden = activeCategory !== 'todos';
    document.title = `${getCategoryLabel(activeCategory)} — NT Eleganz`;
    document.querySelectorAll('.menu-orb-nav .orb-link').forEach(link => {
      const target = new URL(link.href, location.origin).pathname.replace(/\/$/, '');
      link.classList.toggle('active', target === location.pathname.replace(/\/$/, ''));
    });
  }
  function buildFilterControls() {
    const brands = [...new Set(ALL_PRODUCTS.map(p => p.brand).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    const sizes = [...new Set(ALL_PRODUCTS.flatMap(p => (p.sizes || []).map(String)))].sort((a,b) => {
      const order = ['PP','P','M','G','GG','XG','XGG'];
      return order.includes(a) && order.includes(b) ? order.indexOf(a)-order.indexOf(b) : a.localeCompare(b, 'pt-BR', {numeric:true});
    });
    const check = (group, value, label, count) => `<label class="sidebar-check"><input type="checkbox" data-filter-group="${group}" value="${esc(value)}"><span>${esc(label)}</span>${count == null ? '' : `<span class="sidebar-check-count">${count}</span>`}</label>`;
    const group = (title, body) => `<fieldset class="sidebar-section"><legend class="sidebar-section__title">${title}</legend>${body}</fieldset>`;
    const content = group('Marca', brands.map(brand => check('brands', rules.normalize(brand), brand, ALL_PRODUCTS.filter(p => p.brand === brand).length)).join('') || '<p class="filter-hint">Nenhuma marca cadastrada.</p>')
      + group('Disponibilidade', check('stock', 'stock', 'Em estoque') + check('sale', 'sale', 'Em oferta'))
      + group('Tamanho', `<div class="filter-size-grid">${sizes.map(size => check('sizes', size, size)).join('')}</div>`)
      + group('Faixa de preço', '<div class="filter-price-inputs"><label>De (R$)<input data-price="min" type="number" min="0" step="0.01" placeholder="0" inputmode="decimal"></label><span aria-hidden="true">—</span><label>Até (R$)<input data-price="max" type="number" min="0" step="0.01" placeholder="Sem limite" inputmode="decimal"></label></div><p class="filter-hint">Combine os filtros para encontrar sua peça.</p>')
      + '<button class="filter-reset" data-clear-filters>Limpar todos os filtros</button>';
    const sidebar = document.querySelector('.catalog-sidebar');
    if (sidebar) sidebar.innerHTML = '<div class="filter-heading">Refine sua seleção</div>' + content;
    document.querySelector('.filter-drawer__body').innerHTML = content;
    syncControls();
  }

  // ══════════════════════════════════════════
  //  1. TOOLBAR SHADOW ON SCROLL
  // ══════════════════════════════════════════
  function initToolbarScroll() {
    const toolbar = document.querySelector('.catalog-toolbar');
    if (!toolbar) return;
    const update = () => toolbar.classList.toggle('shadowed', window.scrollY > 200);
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ══════════════════════════════════════════
  //  5. noUiSlider PRICE RANGE
  // ══════════════════════════════════════════
  function initPriceSlider() {
    const sliderEl = document.getElementById('price-slider');
    const minEl = document.getElementById('price-display-min');
    const maxEl = document.getElementById('price-display-max');
    if (!sliderEl || typeof noUiSlider === 'undefined') return;

    const maxPrice = Math.max(...ALL_PRODUCTS.map(p => p.priceNum || 0), 10000);

    noUiSlider.create(sliderEl, {
      start: [0, maxPrice],
      connect: true,
      step: 50,
      tooltips: [
        { to: v => 'R$' + Math.round(v).toLocaleString('pt-BR') },
        { to: v => 'R$' + Math.round(v).toLocaleString('pt-BR') },
      ],
      range: { min: 0, max: maxPrice },
    });

    sliderEl.noUiSlider.on('update', (values) => {
      priceMin = parseFloat(values[0]);
      priceMax = parseFloat(values[1]);
      if (minEl) minEl.textContent = 'R$ ' + Math.round(priceMin).toLocaleString('pt-BR');
      if (maxEl) maxEl.textContent = 'R$ ' + Math.round(priceMax).toLocaleString('pt-BR');
    });
    sliderEl.noUiSlider.on('change', () => { page = 1; render(); });
  }

  // ══════════════════════════════════════════
  //  6. GRID VIEW TOGGLE
  // ══════════════════════════════════════════
  function initGridToggle() {
    const grid = document.getElementById('catalog-grid');
    document.querySelectorAll('.grid-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cols = parseInt(btn.dataset.cols);
        currentGridCols = cols;
        document.querySelectorAll('.grid-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        grid.className = `catalog-grid grid-${cols}`;

      });
    });
  }

  // ══════════════════════════════════════════
  //  7. FILTER BADGE COUNT
  // ══════════════════════════════════════════
  function updateFilterBadge() {
    const badge = document.getElementById('filter-badge');
    if (!badge) return;
    const checked = selected.brands.length + selected.sizes.length + Number(selected.stock) + Number(selected.sale) + Number(priceMin > 0 || Number.isFinite(priceMax)) + Number(Boolean(searchQuery));
    badge.textContent = checked;
    badge.classList.toggle('visible', checked > 0);
  }
  document.addEventListener('change', e => {
    if (e.target.matches('.sidebar-check input')) updateFilterBadge();
  });

  // ══════════════════════════════════════════
  //  8. FILTER DRAWER (GSAP animated)
  // ══════════════════════════════════════════
  function initFilterDrawer() {
    const openBtn  = document.getElementById('filter-drawer-btn');
    const closeBtn = document.getElementById('filter-drawer-close');
    const overlay  = document.getElementById('filter-drawer-overlay');
    const drawer   = document.getElementById('filter-drawer');
    const applyBtn = document.getElementById('filter-apply-btn');
    const clearBtn = document.getElementById('filter-clear-btn');

    function openDrawer() {
      drawer.inert = false;
      drawer.classList.add('open');
      overlay.classList.add('open');
      document.body.classList.add('catalog-drawer-open');
      openBtn?.setAttribute('aria-expanded', 'true');
      closeBtn.focus();
    }

    function closeDrawer() {
      drawer.classList.remove('open');
      overlay.classList.remove('open');
      document.body.classList.remove('catalog-drawer-open');
      openBtn?.setAttribute('aria-expanded', 'false');
      drawer.inert = true;
      openBtn.focus();
    }

    openBtn?.addEventListener('click', openDrawer);
    closeBtn?.addEventListener('click', closeDrawer);
    overlay?.addEventListener('click', closeDrawer);
    applyBtn?.addEventListener('click', closeDrawer);
    clearBtn?.addEventListener('click', resetFilters);
    drawer.inert = true;
    document.addEventListener('keydown', event => {
      if (!drawer.classList.contains('open')) return;
      if (event.key === 'Escape') closeDrawer();
      if (event.key === 'Tab') {
        const focusable = [...drawer.querySelectorAll('button, input, a[href]')].filter(el => !el.disabled);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

  }

  // ══════════════════════════════════════════
  //  9. QUICK-ADD RIPPLE
  // ══════════════════════════════════════════
  document.addEventListener('click', e => {
    const btn = e.target.closest('.catalog-card__quick-add');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = (e.clientX - rect.left - 15) + 'px';
    ripple.style.top = (e.clientY - rect.top - 15) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });

  // ══════════════════════════════════════════
  //  11. RENDER GRID
  // ══════════════════════════════════════════
  function getVisible() {
    return rules.filter(ALL_PRODUCTS, filterState());
  }

  function cardSrcset(src) {
    if (!src || src.includes('products/')) return '';
    if (src.includes('cutout')) {
      const base = src.replace(/\.webp(\?.*)?$/, '');
      return ` srcset="${esc(base)}-400.webp 1x, ${esc(base)}-800.webp 2x"`;
    }
    return '';
  }

  // Resolução e recuperação das fotos de produto: js/image-loader.js (fonte única)
  const resolveProductImg = window.NTImages.resolve;

  function renderCard(p, index = 0) {
    const isOutOfStock = (p.stock !== undefined && Number(p.stock) <= 0) || p.inStock === false || p.available === false;
    const badgeClass = p.badge === 'OFERTA' ? 'catalog-card__badge--sale' : p.badge === 'LUXO' ? 'catalog-card__badge--new' : '';
    const brand = esc(p.brand || '');
    const name = esc(p.name || '');
    const rawImg = p.image || (Array.isArray(p.images) && p.images[0]) || '';
    const vpsUrl = resolveProductImg(rawImg);
    const image = esc(vpsUrl);
    const productUrl = (window.ntWpp?.getProductUrl ? window.ntWpp.getProductUrl(p) : `/products/?id=${esc(p.id)}`);
    const isAboveFold = (index < 4);
    const loadAttrs = isAboveFold ? 'loading="eager" fetchpriority="high"' : 'loading="lazy" decoding="async"';

    return `
      <article class="catalog-card ${isOutOfStock ? 'is-out-of-stock' : ''}" role="listitem" data-product-id="${esc(p.id)}">
        <a href="${productUrl}" class="catalog-card__img-wrap" aria-label="Ver ${name}">
          <img src="${image}" alt="${brand} — ${name}" ${loadAttrs}
            style="${isOutOfStock ? 'filter: grayscale(100%); opacity: 0.6;' : ''}"
            onload="this.classList.add('is-loaded');if(this.parentElement)this.parentElement.classList.add('is-loaded');"
            onerror="window.handleProductImgError(this);" />
          <button type="button" class="nte-img-retry-btn" aria-label="Recarregar imagem" title="Recarregar imagem" onclick="event.preventDefault();event.stopPropagation();window.nteRetryImage(this, event);">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
            </svg>
            <span>Recarregar</span>
          </button>
          ${isOutOfStock
            ? '<span class="catalog-card__badge badge-out-of-stock" style="display:inline-flex !important; position:absolute; top:12px; left:12px; background:#dc2626 !important; color:#ffffff !important; font-size:11px !important; font-weight:700 !important; letter-spacing:0.8px !important; padding:4px 10px !important; border-radius:4px !important; text-transform:uppercase !important; z-index:5 !important; box-shadow:0 2px 6px rgba(0,0,0,0.3) !important;">ESGOTADO</span>'
            : (p.badge ? `<span class="catalog-card__badge ${badgeClass}">${esc(p.badge)}</span>` : '')}
          ${!isOutOfStock ? `
          <button class="catalog-card__quick-add" onclick="event.preventDefault();event.stopPropagation();catalogAddToCart('${esc(p.id)}')">
            Adicionar ao Carrinho
          </button>
          ` : ''}
        </a>
        <div class="catalog-card__info">
          <span class="catalog-card__brand">${brand}</span>
          <a href="${productUrl}" style="text-decoration:none;">
            <span class="catalog-card__name">${name}</span>
          </a>
          <div class="catalog-card__price-row">
            <span class="catalog-card__price">${esc(p.price)}</span>
            ${p.oldPrice ? `<span class="catalog-card__price-old">${esc(p.oldPrice)}</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  let firstRender = true;

  function render() {
    const grid = document.getElementById('catalog-grid');
    const countEl = document.getElementById('catalog-total-count');
    const showEl  = document.getElementById('showing-count');
    const loadWrap = document.getElementById('load-more-wrap');

    const visible = getVisible();
    const slice = visible.slice(0, page * PER_PAGE);

    if (visible.length === 0) {
      grid.innerHTML = `<div class="catalog-empty" style="grid-column:1/-1;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <p>Nenhum produto encontrado.<br>Tente ajustar os filtros.</p><button class="filter-reset" data-clear-filters>Limpar filtros e ver produtos</button>
        </div>`;
    } else {
      grid.innerHTML = slice.map((p, idx) => renderCard(p, idx)).join('');
      grid.className = `catalog-grid grid-${currentGridCols}`;
    }

    firstRender = false;

    const total = visible.length;
    const fmtTotal = `${total} produto${total !== 1 ? 's' : ''}`;
    const fmtShow  = `${slice.length} de ${total} produto${total !== 1 ? 's' : ''}`;

    if (countEl) countEl.textContent = fmtTotal;
    if (showEl) showEl.textContent = fmtShow;

    loadWrap.style.display = slice.length < total ? 'block' : 'none';
    updateFilterBadge();
    syncControls();
    document.getElementById('filter-apply-btn').textContent = `Ver ${total} produto${total !== 1 ? 's' : ''}`;
    const chips = [];
    const chip = (label, group, value = '') => chips.push(`<button class="filter-chip" data-remove-group="${group}" data-remove-value="${esc(value)}" aria-label="Remover filtro ${esc(label)}">${esc(label)} <span aria-hidden="true">×</span></button>`);
    selected.brands.forEach(brand => chip(ALL_PRODUCTS.find(p => rules.normalize(p.brand) === brand)?.brand || brand, 'brands', brand));
    selected.sizes.forEach(size => chip(`Tamanho ${size}`, 'sizes', size));
    if (selected.stock) chip('Em estoque', 'stock');
    if (selected.sale) chip('Em oferta', 'sale');
    if (searchQuery) chip(`Busca: ${searchQuery}`, 'query');
    if (priceMin > 0 || Number.isFinite(priceMax)) chip(`R$ ${priceMin.toLocaleString('pt-BR')} — ${Number.isFinite(priceMax) ? 'R$ ' + priceMax.toLocaleString('pt-BR') : 'sem limite'}`, 'price');
    const bar = document.getElementById('active-filters-bar');
    bar.innerHTML = chips.join('') + (chips.length ? '<button class="filter-reset" data-clear-filters>Limpar tudo</button>' : '');
    bar.style.display = chips.length ? 'flex' : 'none';
  }

  // ══════════════════════════════════════════
  //  12. CATEGORY PILLS
  // ══════════════════════════════════════════
  function initCatPills() {
    document.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const prev = document.querySelector('.cat-pill.active');
        if (prev) prev.classList.remove('active');
        btn.classList.add('active');
        activeCategory = btn.dataset.cat;
        history.pushState({}, '', activeCategory === 'todos' ? '/collections/' : `/collections/${activeCategory}/`);
        page = 1;
        render();
      });
    });
  }

  // ══════════════════════════════════════════
  //  14. SORT + LOAD MORE
  // ══════════════════════════════════════════
  function initSort() {
    const sel = document.getElementById('sort-select');
    sel?.addEventListener('change', () => { activeSort = sel.value; page = 1; render(); });
  }

  function initFilters() {
    document.addEventListener('change', event => {
      const input = event.target;
      if (input.matches('[data-filter-group]')) {
        const group = input.dataset.filterGroup;
        if (Array.isArray(selected[group])) selected[group] = input.checked ? [...new Set([...selected[group], input.value])] : selected[group].filter(value => value !== input.value);
        else selected[group] = input.checked;
      } else if (input.matches('[data-price]')) {
        const value = Math.max(0, Number(input.value) || 0);
        if (input.dataset.price === 'min') { priceMin = value; if (priceMin > priceMax) priceMax = priceMin; }
        else { priceMax = input.value === '' ? Infinity : value; if (priceMax < priceMin) priceMin = priceMax; }
      } else return;
      page = 1; syncControls(); render();
    });
    document.addEventListener('click', event => {
      if (event.target.closest('[data-clear-filters]')) return resetFilters();
      const button = event.target.closest('[data-remove-group]');
      if (!button) return;
      const group = button.dataset.removeGroup;
      if (Array.isArray(selected[group])) selected[group] = selected[group].filter(value => value !== button.dataset.removeValue);
      else if (group === 'category') { activeCategory = 'todos'; history.pushState({}, '', '/collections/'); }
      else if (group === 'query') { searchQuery = ''; document.querySelectorAll('#search-input, #catalog-search').forEach(input => input.value = ''); }
      else if (group === 'price') { priceMin = 0; priceMax = Infinity; }
      else selected[group] = false;
      page = 1; syncControls(); render();
    });
  }

  function initLoadMore() {
    const btn = document.getElementById('load-more-btn');
    if (!btn) return;
    btn.setAttribute('type', 'button');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const currentScroll = window.scrollY;
      const prevCount = page * PER_PAGE;
      page++;

      const visible = getVisible();
      const newItems = visible.slice(prevCount, page * PER_PAGE);
      const grid = document.getElementById('catalog-grid');

      if (grid && newItems.length > 0) {
        const fragment = document.createRange().createContextualFragment(newItems.map(renderCard).join(''));
        const firstNewEl = fragment.firstElementChild;
        grid.appendChild(fragment);

        const total = visible.length;
        const currentTotalShowing = Math.min(page * PER_PAGE, total);
        const countEl = document.getElementById('catalog-total-count');
        const showEl  = document.getElementById('showing-count');
        const loadWrap = document.getElementById('load-more-wrap');

        if (countEl) countEl.textContent = `${total} produto${total !== 1 ? 's' : ''}`;
        if (showEl) showEl.textContent = `${currentTotalShowing} de ${total} produto${total !== 1 ? 's' : ''}`;
        if (loadWrap) loadWrap.style.display = currentTotalShowing < total ? 'block' : 'none';

        // Evita salto de scroll do navegador no mobile
        window.scrollTo({ top: currentScroll, behavior: 'instant' });

        // Ajusta suavemente o scroll para os novos produtos sem jogar a pessoa pro rodapé
        if (firstNewEl) {
          setTimeout(() => {
            const rect = firstNewEl.getBoundingClientRect();
            if (rect.top > window.innerHeight - 100) {
              firstNewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 60);
        }
      } else {
        render();
      }
    });
  }

  // ══════════════════════════════════════════
  //  15. STICKY HEADER + SEARCH
  // ══════════════════════════════════════════
  function initStickyHeader() {
    const header = document.querySelector('.site-header');
    if (!header) return;
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 60);
    }, { passive: true });
  }

  function initSearch() {
    if (window.NTSearch?.init) {
      window.NTSearch.init();
    }
    const catSearch = document.getElementById('catalog-search');
    catSearch?.addEventListener('input', event => {
      searchQuery = event.target.value.trim().toLocaleLowerCase('pt-BR');
      const headerInput = document.getElementById('search-input');
      if (headerInput && headerInput.value !== event.target.value) {
        headerInput.value = event.target.value;
      }
      page = 1;
      render();
    });
  }

  // ══════════════════════════════════════════
  //  16. PAGE LOADER
  // ══════════════════════════════════════════
  function hideLoader() {
    const loader = document.getElementById('page-loader');
    if (!loader) return;
    setTimeout(() => {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 300);
    }, 250);
  }

  // ══════════════════════════════════════════
  //  17. ADD TO CART
  // ══════════════════════════════════════════
  window.catalogAddToCart = function(productId) {
    const p = ALL_PRODUCTS.find(x => x.id === productId);
    if (!p) return;
    const variant = window.ntCart?.defaultVariant?.(p) || {};
    window.ntCart?.add({ ...p, size: variant.size, color: variant.color });

    // Bounce cart badge
    const badge = document.getElementById('cart-badge');
    if (badge) {
      badge.classList.remove('catalog-badge-pop');
      requestAnimationFrame(() => badge.classList.add('catalog-badge-pop'));
    }
  };

  // ══════════════════════════════════════════
  //  18. LOAD PRODUCTS FROM DB
  // ══════════════════════════════════════════
  async function loadProducts(options = {}) {
    if (window.ntDB) {
      const requestedMode = window.ntDB.config?.().mode || 'local';
      try {
        const result = await window.ntDB.init();
        if (requestedMode !== 'local' && result?.mode !== requestedMode) {
          ALL_PRODUCTS = [];
          buildFilterControls();
          render();
          return;
        }

        // Sempre pela camada de dados: ela decide entre memória, revalidação
        // por ETag e servidor. Ler o snapshot do LocalStorage direto aqui
        // impedia a vitrine de enxergar um produto recém-salvo no painel.
        const dbProducts = await window.ntDB.products.getAll(options);

        if (Array.isArray(dbProducts)) {
          ALL_PRODUCTS = dbProducts
            .filter(p => p.active !== false)
            .map(p => ({
              ...p,
              catalogCategory: rules.category(p),
              priceNum: rules.price(p.price),
            }));
        }
      } catch (e) {
        console.warn('DB fallback:', e);
        if (requestedMode !== 'local') ALL_PRODUCTS = [];
      }
    }
    buildFilterControls();
    render();
  }

  // O evento só chega quando o conteúdo mudou, e o dado novo já está no cache
  // de memória: renderiza sem buscar de novo.
  window.addEventListener('nte:products-changed', () => { loadProducts(); });
  // Chave do snapshot em modo servidor. `nte_products` é a chave do modo local.
  window.addEventListener('storage', event => {
    if (event.key === 'nte_hydrated_products' || event.key === 'nte_products') loadProducts();
  });
  // Revalidação por ETag: 304 sem corpo quando nada mudou. `reload: true`
  // desligaria o ETag (db.js:628) e faria cada aba baixar o catálogo inteiro a
  // cada 20s, alem de remontar a grade inteira mesmo sem alteracao.
  const revalidateCatalog = () => { window.ntDB?.refresh?.('products'); };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revalidateCatalog();
  });

  // ══════════════════════════════════════════
  //  19. DOMContentLoaded — BOOTSTRAP
  // ══════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', async () => {
    hideLoader();
    initStickyHeader();
    initToolbarScroll();
    initSearch();
    initCatPills();
    initSort();
    initFilters();
    initLoadMore();
    initFilterDrawer();
    initGridToggle();

    await loadProducts();

    // WhatsApp settings
    try {
      const wpp = JSON.parse(localStorage.getItem('nte_wpp_settings') || '{}');
      if (wpp.number && window.ntWpp) window.ntWpp._number = wpp.number;
    } catch(e) {}
  });

  window.ntCatalog = {
    setSearch: function (q) {
      searchQuery = String(q || '').trim().toLocaleLowerCase('pt-BR');
      const catSearch = document.getElementById('catalog-search');
      if (catSearch && catSearch.value !== q) catSearch.value = q;
      page = 1;
      render();
    },
    resetFilters: resetFilters,
    render: render
  };

  window.addEventListener('popstate', () => location.reload());

})();
