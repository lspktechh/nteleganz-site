/**
 * NT Eleganz — carregamento resiliente de imagens (fonte única para loja, catálogo e página de produto).
 *
 * Antes cada página tinha a sua cópia desta lógica, sem nenhuma nova tentativa: uma falha momentânea de
 * rede (comum no 4G) já mandava a foto direto para o placeholder com o botão "Recarregar". Agora:
 *   1. a própria página tenta de novo, sozinha, duas vezes (com pequena espera);
 *   2. depois tenta a cópia de segurança na VPS;
 *   3. só então mostra o placeholder com o botão "Recarregar" (mesmo visual de antes);
 *   4. quando a conexão volta ("online"), as fotos que falharam são recarregadas automaticamente.
 *
 * O HTML e o CSS das fotos não mudam: este arquivo só decide o que acontece quando uma foto falha.
 */
(function () {
  'use strict';

  if (window.NTImages) return;

  const LOCAL_IMG_DIR = '/assets/images/products/';
  const VPS_IMG_BASE = 'https://137-131-233-254.sslip.io/nteleganz/uploads/';
  const PLACEHOLDER_IMG = '/assets/images/placeholder-product.svg';
  const RETRY_DELAYS = [700, 2200]; // ms de espera antes de cada nova tentativa automática
  const OWN_HOSTS = ['nteleganz.com.br', 'www.nteleganz.com.br', '137-131-233-254.sslip.io'];
  const WRAP_SELECTOR = '.product-card__image-wrap, .catalog-card__img-wrap, .swiper-slide';
  const CARD_WRAP_SELECTOR = '.product-card__image-wrap, .catalog-card__img-wrap';

  // ── Resolve a URL de uma foto de produto ──
  // Fotos de produto são sempre pedidas à mesma origem da página (não dependem do domínio gravado no
  // catálogo). Imagens do site fora da pasta de produtos e URLs de outros domínios ficam como estão.
  function resolve(raw) {
    if (!raw || typeof raw !== 'string') return PLACEHOLDER_IMG;
    const src = raw.trim();
    if (!src) return PLACEHOLDER_IMG;
    if (/^(data|blob):/i.test(src)) return src;

    let url;
    try {
      url = new URL(src, location.origin);
    } catch (e) {
      return src;
    }
    if (url.origin !== location.origin && OWN_HOSTS.indexOf(url.hostname) === -1) return src;

    const match = url.pathname.match(/\/([A-Za-z0-9_.\-]+\.webp)$/i);
    if (!match) return src;
    if (/^\/assets\/images\/(?!products\/)/.test(url.pathname)) return url.pathname;
    return LOCAL_IMG_DIR + match[1];
  }

  function wrapOf(el) {
    return el.closest(WRAP_SELECTOR) || el.parentElement;
  }

  // Estado de recuperação guardado no próprio <img> (data-*): nome do arquivo, pasta e etapa atual
  function originalFile(img) {
    if (!img.dataset.origFile) {
      img.dataset.origFile = (img.getAttribute('src') || '').split('?')[0].split('/').pop();
    }
    return img.dataset.origFile;
  }

  function originalDir(img) {
    if (!img.dataset.nteDir) {
      const url = new URL(img.src, location.href);
      img.dataset.nteDir = url.origin + url.pathname.replace(/[^/]+$/, '');
    }
    return img.dataset.nteDir;
  }

  function resetState(img) {
    delete img.dataset.origFile;
    delete img.dataset.nteDir;
    delete img.dataset.nteStage;
    delete img.dataset.nteFailed;
  }

  // ── Fotos de produto: nova tentativa -> VPS -> placeholder com botão "Recarregar" ──
  function createRetryButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nte-img-retry-btn';
    btn.setAttribute('aria-label', 'Recarregar imagem');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19"/>
      </svg>
      <span>Recarregar</span>
    `;
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      window.nteRetryImage(this, e);
    };
    return btn;
  }

  function showFailure(img) {
    img.dataset.nteFailed = '1';
    img.onerror = null;
    img.src = PLACEHOLDER_IMG;
    img.classList.add('has-error');

    const wrap = wrapOf(img);
    if (!wrap) return;
    wrap.classList.add('has-img-error');
    wrap.classList.remove('is-loaded');
    let retryBtn = wrap.querySelector('.nte-img-retry-btn');
    if (!retryBtn) {
      retryBtn = createRetryButton();
      wrap.appendChild(retryBtn);
    }
    retryBtn.style.display = 'inline-flex';
  }

  window.handleProductImgError = function (img) {
    if (!img || img.dataset.nteFailed) return;
    const file = originalFile(img);
    if (!file || /placeholder/i.test(file)) {
      showFailure(img);
      return;
    }

    const dir = originalDir(img);
    const stage = parseInt(img.dataset.nteStage || '0', 10);
    img.dataset.nteStage = String(stage + 1);

    if (stage < RETRY_DELAYS.length) {
      // Falha momentânea (rede móvel, servidor ocupado): tenta de novo sozinha
      setTimeout(function () {
        if (!img.dataset.nteFailed) img.src = dir + file + '?r=' + Date.now();
      }, RETRY_DELAYS[stage]);
      return;
    }
    if (stage === RETRY_DELAYS.length) {
      // Último recurso: a cópia de segurança na VPS
      img.src = VPS_IMG_BASE + file;
      return;
    }
    showFailure(img);
  };

  window.nteRetryImage = function (btn, evt) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    const wrap = wrapOf(btn);
    if (!wrap) return;
    const img = wrap.querySelector('img');
    if (!img) return;

    btn.classList.add('is-retrying');
    const label = btn.querySelector('span');
    if (label) label.textContent = 'Carregando...';

    const file = originalFile(img);
    const dir = img.dataset.nteDir || (location.origin + LOCAL_IMG_DIR);

    // Clique manual: sem esperas automáticas, vai direto para nova tentativa -> VPS -> placeholder
    delete img.dataset.nteFailed;
    img.dataset.nteStage = String(RETRY_DELAYS.length);
    img.classList.remove('has-error', 'is-loaded');
    wrap.classList.remove('is-loaded');

    img.onload = function () {
      // Se a nova tentativa também falhou, o placeholder dispara "load": isso não é sucesso
      if (img.dataset.nteFailed) return;
      img.classList.add('is-loaded');
      wrap.classList.add('is-loaded');
      wrap.classList.remove('has-img-error');
      btn.classList.remove('is-retrying');
      if (label) label.textContent = 'Recarregar';
      btn.style.display = 'none';
    };

    img.onerror = function () {
      btn.classList.remove('is-retrying');
      if (label) label.textContent = 'Recarregar';
      window.handleProductImgError(img);
    };

    img.src = dir + file + '?t=' + Date.now();
  };

  // ── Fotos de feedback: nova tentativa -> VPS -> foto padrão (sem botão) ──
  window.nteFeedbackImgError = function (img, fallback) {
    if (!img || img.dataset.nteFailed) return;
    const file = originalFile(img);
    if (!file) return;

    const dir = originalDir(img);
    const stage = parseInt(img.dataset.nteStage || '0', 10);
    img.dataset.nteStage = String(stage + 1);

    if (stage < RETRY_DELAYS.length) {
      setTimeout(function () {
        if (!img.dataset.nteFailed) img.src = dir + file + '?r=' + Date.now();
      }, RETRY_DELAYS[stage]);
      return;
    }
    if (stage === RETRY_DELAYS.length) {
      img.src = VPS_IMG_BASE + file;
      return;
    }
    img.dataset.nteFailed = '1';
    img.onerror = null;
    if (fallback) img.src = fallback;
  };

  // ── Rede de segurança ──
  // As fotos dos cards ficam com opacity:0 até receberem .is-loaded. Marca no momento em que a foto de
  // fato carrega, mesmo que o HTML do card não tenha o atributo onload.
  document.addEventListener('load', function (e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.nteFailed) return;
    if (/placeholder/i.test(img.currentSrc || img.src)) return;

    delete img.dataset.nteStage; // carregou: uma falha futura recomeça a recuperação do zero
    const wrap = img.closest(CARD_WRAP_SELECTOR);
    if (!wrap) return;
    img.classList.add('is-loaded');
    img.classList.remove('has-error');
    wrap.classList.add('is-loaded');
    wrap.classList.remove('has-img-error');
  }, true);

  // Quando a conexão volta, recarrega sozinhas as fotos que tinham falhado
  window.addEventListener('online', function () {
    document.querySelectorAll('img.has-error').forEach(function (img) {
      const wrap = wrapOf(img);
      const btn = wrap && wrap.querySelector('.nte-img-retry-btn');
      if (btn) window.nteRetryImage(btn);
    });
  });

  window.NTImages = { resolve: resolve, reset: resetState, PLACEHOLDER: PLACEHOLDER_IMG };
})();
