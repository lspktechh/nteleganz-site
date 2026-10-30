/**
 * NT Eleganz — Live Instant Search (Busca ao vivo em tempo real)
 * Dispara busca e renderiza resultados instantâneos a cada letra digitada.
 */
(function () {
  'use strict';

  let catalogCache = null;
  let isLoadingCatalog = false;
  let selectedIndex = -1;
  let searchDebounceTimer = null;

  // Normalização de texto (remove acentos, pontuação e converte para minúsculas)
  function normalizeText(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Carrega catálogo de produtos para pesquisa em qualquer página
  async function getCatalog() {
    if (catalogCache && catalogCache.length > 0) return catalogCache;

    // 1. Usa catálogo já em memória na página se disponível
    if (Array.isArray(window.NT_PRODUCTS) && window.NT_PRODUCTS.length > 0) {
      catalogCache = window.NT_PRODUCTS;
      return catalogCache;
    }

    if (isLoadingCatalog) {
      // Aguarda até 1s se já estiver carregando
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (catalogCache && catalogCache.length > 0) return catalogCache;
      }
    }

    isLoadingCatalog = true;
    try {
      // 2. Tenta via camada de dados unificada
      if (window.ntDB?.products?.getAll) {
        const dbItems = await window.ntDB.products.getAll();
        if (Array.isArray(dbItems) && dbItems.length > 0) {
          catalogCache = dbItems.filter(p => p.active !== false);
          window.NT_PRODUCTS = catalogCache;
          return catalogCache;
        }
      }

      // 3. Fallback: API oficial de produtos
      try {
        const res = await fetch('/api/products.php');
        if (res.ok) {
          const json = await res.json();
          const items = Array.isArray(json) ? json : (json.products || []);
          if (items.length > 0) {
            catalogCache = items.filter(p => p.active !== false);
            window.NT_PRODUCTS = catalogCache;
            return catalogCache;
          }
        }
      } catch (_) {}

      // 4. Fallback 2: arquivo estático de produtos
      try {
        const res2 = await fetch('/data/products.json');
        if (res2.ok) {
          const json2 = await res2.json();
          const items2 = Array.isArray(json2) ? json2 : (json2.products || []);
          if (items2.length > 0) {
            catalogCache = items2.filter(p => p.active !== false);
            window.NT_PRODUCTS = catalogCache;
            return catalogCache;
          }
        }
      } catch (_) {}
    } catch (err) {
      console.warn('[NTSearch] Falha ao carregar catálogo para busca:', err);
    } finally {
      isLoadingCatalog = false;
    }

    return catalogCache || [];
  }

  // Resolução da foto do produto com suporte a recuperação e fallback
  function resolveImg(product) {
    const raw = product.image || (Array.isArray(product.images) && product.images[0]) || '';
    if (window.NTImages?.resolve) {
      return window.NTImages.resolve(raw);
    }
    if (!raw) return '/assets/images/placeholder.webp';
    if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) return raw;
    return '/assets/images/products/' + raw;
  }

  // URL canônica da página do produto
  function getProductUrl(product) {
    if (window.ntWpp?.getProductUrl) {
      try {
        const u = window.ntWpp.getProductUrl(product);
        if (u) return u;
      } catch (_) {}
    }
    if (product.slug) {
      return `/products/?p=${encodeURIComponent(product.slug)}`;
    }
    return `/products/?id=${encodeURIComponent(product.id || '')}`;
  }

  function isOutOfStock(product) {
    return (product.stock !== undefined && Number(product.stock) <= 0)
      || product.inStock === false
      || product.available === false;
  }

  // Filtra produtos por múltiplos tokens (ex: "shorts vile", "camisa preta")
  function filterProducts(query, products) {
    const rawTokens = normalizeText(query).split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) return [];

    return products.filter(p => {
      if (p.active === false) return false;

      const searchable = normalizeText([
        p.name,
        p.brand,
        p.category,
        p.desc,
        p.badge,
        Array.isArray(p.sizes) ? p.sizes.join(' ') : '',
        Array.isArray(p.colors) ? p.colors.join(' ') : '',
        p.slug
      ].filter(Boolean).join(' '));

      return rawTokens.every(tok => searchable.includes(tok));
    });
  }

  // Sincroniza em tempo real com a vitrine de catálogo caso a página atual seja collections
  function syncCatalogView(query) {
    const catSearch = document.getElementById('catalog-search');
    if (catSearch && catSearch.value !== query) {
      catSearch.value = query;
    }
    if (window.ntCatalog?.setSearch) {
      window.ntCatalog.setSearch(query);
    }
  }

  // Sugestões populares quando a barra é aberta sem texto
  function renderInitialSuggestions(container) {
    const popularTerms = [
      'Shorts Vilebrequin',
      'Camisetas',
      'Shorts',
      'Calçados',
      'Hoodies',
      'Gucci',
      'Nike'
    ];

    container.innerHTML = `
      <div class="search-initial-view">
        <div class="search-popular-heading">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--text-muted); vertical-align:-1px; margin-right:5px;">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span>Buscas Populares</span>
        </div>
        <div class="search-quick-tags">
          ${popularTerms.map(term => `<button type="button" class="search-quick-tag" data-term="${escHtml(term)}">${escHtml(term)}</button>`).join('')}
        </div>
      </div>
    `;

    container.querySelectorAll('.search-quick-tag').forEach(btn => {
      btn.addEventListener('click', () => {
        const term = btn.dataset.term;
        const input = document.getElementById('search-input');
        if (input) {
          input.value = term;
          input.focus();
          handleInput(term);
        }
      });
    });
  }

  // Renderiza a lista de produtos encontrados
  function renderResults(query, matches, container) {
    if (matches.length === 0) {
      container.innerHTML = `
        <div class="search-empty-view">
          <p>Nenhum produto encontrado para "<strong>${escHtml(query)}</strong>"</p>
          <span class="search-empty-hint">Verifique a ortografia ou explore nossas categorias principais:</span>
          <div class="search-quick-tags" style="margin-top:14px;">
            <a href="/collections/shorts/" class="search-quick-tag">Shorts</a>
            <a href="/collections/camisetas/" class="search-quick-tag">Camisetas</a>
            <a href="/collections/calcados/" class="search-quick-tag">Calçados</a>
            <a href="/collections/hoodies/" class="search-quick-tag">Hoodies</a>
          </div>
        </div>
      `;
      return;
    }

    const maxItems = 8;
    const itemsToShow = matches.slice(0, maxItems);
    const hasMore = matches.length > maxItems;
    const countLabel = matches.length === 1 ? '1 produto encontrado' : `${matches.length} produtos encontrados`;

    container.innerHTML = `
      <div class="search-results-header">
        <span class="search-results-count">${countLabel} para <strong>"${escHtml(query)}"</strong></span>
        ${matches.length > 2 ? `<a href="/collections/?q=${encodeURIComponent(query)}" class="search-header-link">Ver catálogo completo (${matches.length}) →</a>` : ''}
      </div>
      <div class="search-results-grid" role="listbox" aria-label="Resultados da pesquisa">
        ${itemsToShow.map((p, idx) => {
          const out = isOutOfStock(p);
          const imgUrl = resolveImg(p);
          const link = getProductUrl(p);
          const price = String(p.price || '').startsWith('R$') ? p.price : `R$ ${p.price || ''}`;
          const oldPrice = p.oldPrice ? (String(p.oldPrice).startsWith('R$') ? p.oldPrice : `R$ ${p.oldPrice}`) : '';

          return `
            <a href="${escHtml(link)}" class="search-item-card" data-index="${idx}" role="option">
              <div class="search-item-thumb-box">
                <img src="${escHtml(imgUrl)}" alt="${escHtml(p.brand || '')} ${escHtml(p.name || '')}" class="search-item-img" loading="lazy" onerror="if(window.handleProductImgError)window.handleProductImgError(this);" />
                ${out ? '<span class="search-badge-out-tag">ESGOTADO</span>' : ''}
              </div>
              <div class="search-item-details">
                <span class="search-item-brand">${escHtml(p.brand || 'NT Eleganz')}</span>
                <span class="search-item-title">${escHtml(p.name || '')}</span>
                <div class="search-item-prices">
                  <span class="search-item-price">${escHtml(price)}</span>
                  ${oldPrice ? `<span class="search-item-old-price">${escHtml(oldPrice)}</span>` : ''}
                  ${out ? '<span class="search-pill-badge badge-esgotado">Esgotado</span>' : (p.badge ? `<span class="search-pill-badge badge-destaque">${escHtml(p.badge)}</span>` : '')}
                </div>
              </div>
            </a>
          `;
        }).join('')}
      </div>
      ${hasMore ? `
        <div class="search-results-footer">
          <a href="/collections/?q=${encodeURIComponent(query)}" class="search-more-btn">
            <span>Ver todos os <strong>${matches.length}</strong> produtos no catálogo</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:middle; margin-left:4px;">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </a>
        </div>
      ` : ''}
    `;
  }

  // Handler de digitação: responde a CADA letra digitada
  async function handleInput(val) {
    const query = String(val || '').trim();
    const clearBtn = document.getElementById('search-clear-btn');
    if (clearBtn) clearBtn.hidden = !query;

    const container = document.getElementById('search-live-results');
    if (!container) return;

    selectedIndex = -1;

    // Sincroniza em tempo real com a vitrine de catálogo caso o usuário já esteja nela
    syncCatalogView(query);

    if (!query) {
      renderInitialSuggestions(container);
      return;
    }

    // Carrega catálogo imediatamente
    const catalog = await getCatalog();
    const matches = filterProducts(query, catalog);
    renderResults(query, matches, container);
  }

  // Navegação por teclado dentro dos resultados
  function handleKeyDown(e) {
    const container = document.getElementById('search-live-results');
    if (!container) return;
    const items = container.querySelectorAll('.search-item-card');

    if (e.key === 'ArrowDown') {
      if (items.length === 0) return;
      e.preventDefault();
      selectedIndex = (selectedIndex + 1) % items.length;
      highlightItem(items);
    } else if (e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      highlightItem(items);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && items[selectedIndex]) {
        e.preventDefault();
        items[selectedIndex].click();
      } else {
        const input = document.getElementById('search-input');
        const q = input?.value?.trim();
        if (q) {
          e.preventDefault();
          window.location.href = `/collections/?q=${encodeURIComponent(q)}`;
        }
      }
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  }

  function highlightItem(items) {
    items.forEach((item, i) => {
      if (i === selectedIndex) {
        item.classList.add('is-focused');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('is-focused');
      }
    });
  }

  function openSearch() {
    const bar = document.getElementById('search-bar');
    const input = document.getElementById('search-input');
    const backdrop = document.getElementById('overlay-backdrop');
    if (!bar) return;

    bar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');

    // Pré-carrega catálogo em segundo plano se ainda não tiver
    getCatalog();

    setTimeout(() => {
      if (input) {
        input.focus();
        handleInput(input.value);
      }
    }, 80);
  }

  function closeSearch() {
    const bar = document.getElementById('search-bar');
    const backdrop = document.getElementById('overlay-backdrop');
    if (bar) bar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }

  // Garante a infraestrutura de elementos dentro da barra de pesquisa
  function setupDOM() {
    const bar = document.getElementById('search-bar');
    if (!bar) return;

    const inner = bar.querySelector('.search-inner');
    if (!inner) return;

    // Botão de limpar campo
    let clearBtn = document.getElementById('search-clear-btn');
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.id = 'search-clear-btn';
      clearBtn.className = 'search-clear-btn';
      clearBtn.type = 'button';
      clearBtn.setAttribute('aria-label', 'Limpar pesquisa');
      clearBtn.innerHTML = '×';
      clearBtn.hidden = true;
      const closeBtn = document.getElementById('search-close');
      if (closeBtn) {
        inner.insertBefore(clearBtn, closeBtn);
      } else {
        inner.appendChild(clearBtn);
      }
    }

    // Container de resultados ao vivo
    let liveResults = document.getElementById('search-live-results');
    if (!liveResults) {
      liveResults = document.createElement('div');
      liveResults.id = 'search-live-results';
      liveResults.className = 'search-live-results';
      liveResults.setAttribute('aria-live', 'polite');
      bar.appendChild(liveResults);
    }

    // Configura eventos
    const btn = document.getElementById('search-btn');
    const closeBtn = document.getElementById('search-close');
    const input = document.getElementById('search-input');
    const backdrop = document.getElementById('overlay-backdrop');

    btn?.addEventListener('click', openSearch);
    closeBtn?.addEventListener('click', closeSearch);
    backdrop?.addEventListener('click', () => {
      if (bar.classList.contains('open')) closeSearch();
    });

    clearBtn.addEventListener('click', () => {
      if (input) {
        input.value = '';
        input.focus();
        handleInput('');
      }
    });

    if (input) {
      // Resposta instantânea a cada tecla/letra digitada
      input.addEventListener('input', () => {
        handleInput(input.value);
      });

      input.addEventListener('keydown', handleKeyDown);

      input.addEventListener('focus', () => {
        if (!input.value.trim() && liveResults.children.length === 0) {
          renderInitialSuggestions(liveResults);
        }
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && bar.classList.contains('open')) {
        closeSearch();
      }
    });
  }

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDOM);
  } else {
    setupDOM();
  }

  // Exporta para a janela global
  window.NTSearch = {
    init: setupDOM,
    open: openSearch,
    close: closeSearch,
    search: handleInput,
    getCatalog: getCatalog
  };

})();
