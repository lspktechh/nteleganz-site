/**
 * NT Eleganz — VIP Modal / Bottom Sheet Script
 * Inspirado fielmente na referência FYND VIP (Image 4)
 * Fornece API global para abertura em qualquer página (Home, Catálogo, Produto).
 * Regra: Proibido o uso de emojis. Ícones SVG apenas.
 */

(function () {
  'use strict';

  const STORAGE_ACTIVE_KEY    = 'nte_vip_active';
  const STORAGE_TOKEN_KEY     = 'nte_vip_token';
  const STORAGE_PHONE_KEY     = 'nte_vip_phone';
  const STORAGE_INSTAGRAM_KEY = 'nte_vip_instagram';

  let isInitialized = false;
  let cachedSettings = null;

  function updateHeaderVipButtons() {
    const isAct = localStorage.getItem(STORAGE_ACTIVE_KEY) === 'true';
    const btns = document.querySelectorAll('.header-vip-btn');
    btns.forEach(btn => {
      if (isAct) {
        btn.classList.add('is-vip-active');
        btn.setAttribute('title', 'Você é Membro VIP Ativo · Acesso Privé');
        let dot = btn.querySelector('.header-vip-btn__dot');
        if (!dot) {
          btn.insertAdjacentHTML('afterbegin', '<span class="header-vip-btn__dot" aria-hidden="true"></span>');
        }
      } else {
        btn.classList.remove('is-vip-active');
        let dot = btn.querySelector('.header-vip-btn__dot');
        if (dot) dot.remove();
      }
    });
  }

  async function fetchSettings() {
    if (cachedSettings) return cachedSettings;
    try {
      const res = await fetch('/api/vip.php?action=settings');
      if (res.ok) {
        cachedSettings = await res.json();
      }
    } catch (e) {
      cachedSettings = { monthlyPrice: 29.9, lifetimePrice: 69.9 };
    }
    return cachedSettings;
  }

  function injectModalHtml(settings) {
    if (document.getElementById('nte-vip-bottom-sheet')) return;

    const mPrice = Number(settings?.monthlyPrice || 29.9).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const lPrice = Number(settings?.lifetimePrice || 69.9).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const html = `
      <div class="nte-vip-modal-backdrop" id="nte-vip-bottom-sheet" onclick="if(event.target===this)window.nteCloseVipModal()">
        <div class="nte-vip-modal-sheet" role="dialog" aria-modal="true">
          <div class="nte-vip-modal__handle"></div>
          <button class="nte-vip-modal__close" onclick="window.nteCloseVipModal()" aria-label="Fechar modal">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <!-- Top Brand Badge (Coroa Real + NT VIP) -->
          <div class="nte-vip-modal__top-badge">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#b8932b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2.5 18h19v2.5h-19z" fill="#fbf3df"></path>
              <path d="M4 16 2 6l5.5 4.5L12 3l4.5 7.5L22 6l-2 10z" fill="rgba(184, 147, 43, 0.14)"></path>
              <circle cx="2" cy="6" r="1.2" fill="#b8932b"></circle>
              <circle cx="7.5" cy="10.5" r="1" fill="#b8932b"></circle>
              <circle cx="12" cy="3" r="1.4" fill="#b8932b"></circle>
              <circle cx="16.5" cy="10.5" r="1" fill="#b8932b"></circle>
              <circle cx="22" cy="6" r="1.2" fill="#b8932b"></circle>
            </svg>
            <span class="nte-vip-modal__top-badge-text">NT VIP</span>
          </div>

          <div class="nte-vip-modal__kicker">COMUNIDADE NT ELEGANZ</div>
          <h2 class="nte-vip-modal__title">Entre para o NT VIP</h2>
          <p class="nte-vip-modal__subtitle">
            Peças raras antes de todo mundo, curadoria de luxo e prioridade absoluta em lançamentos.
          </p>

          <div class="nte-vip-modal__list">
            <!-- 1: Acesso Antecipado -->
            <div class="nte-vip-modal__item">
              <div class="nte-vip-modal__item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                </svg>
              </div>
              <div>
                <div class="nte-vip-modal__item-title">Acesso antecipado</div>
                <div class="nte-vip-modal__item-desc">Peças liberadas para VIP antes de todo mundo.</div>
              </div>
            </div>

            <!-- 2: Selo de Membro -->
            <div class="nte-vip-modal__item">
              <div class="nte-vip-modal__item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 16 2 6l5.5 4.5L12 3l4.5 7.5L22 6l-2 10z"></path>
                  <path d="M2.5 18h19v2.5h-19z"></path>
                </svg>
              </div>
              <div>
                <div class="nte-vip-modal__item-title">Selo de membro VIP</div>
                <div class="nte-vip-modal__item-desc">Acesso prive e prioridade absoluta no atendimento.</div>
              </div>
            </div>

            <!-- 3: Provador Virtual -->
            <div class="nte-vip-modal__item">
              <div class="nte-vip-modal__item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"></path>
                  <path d="m14.5 4.5 2 2"></path>
                  <path d="m11.5 7.5 2 2"></path>
                  <path d="m8.5 10.5 2 2"></path>
                  <path d="m5.5 13.5 2 2"></path>
                </svg>
              </div>
              <div>
                <div class="nte-vip-modal__item-title">Provador virtual &amp; consultoria</div>
                <div class="nte-vip-modal__item-desc">Seu tamanho de roupa e seu número de calçado confirmados.</div>
              </div>
            </div>

            <!-- 4: Comunidade no WhatsApp -->
            <div class="nte-vip-modal__item">
              <div class="nte-vip-modal__item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div>
                <div class="nte-vip-modal__item-title">Comunidade no WhatsApp</div>
                <div class="nte-vip-modal__item-desc">Drops e avisos de peças raras em primeira mão.</div>
              </div>
            </div>

            <!-- 5: Curadoria Garantida -->
            <div class="nte-vip-modal__item">
              <div class="nte-vip-modal__item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <polyline points="9 12 11 14 15 10"></polyline>
                </svg>
              </div>
              <div>
                <div class="nte-vip-modal__item-title">Curadoria garantida</div>
                <div class="nte-vip-modal__item-desc">Toda peça autenticada e conferida antes de enviar.</div>
              </div>
            </div>
          </div>

          <!-- Price Box Highlight -->
          <div class="nte-vip-modal__price-box">
            <div class="nte-vip-modal__price-main">
              A partir de <strong id="nte-vip-price-m">R$ ${mPrice}/mês</strong>
            </div>
            <div class="nte-vip-modal__price-sub" id="nte-vip-price-l">
              ou R$ ${lPrice} vitalício, pague uma vez
            </div>
          </div>

          <!-- Main Action Button -->
          <a href="/vip/" class="nte-vip-modal__btn-cta">
            <span>QUERO SER VIP</span>
          </a>

          <button type="button" class="nte-vip-modal__btn-dismiss" onclick="window.nteCloseVipModal()">
            Agora não
          </button>

          <a href="/vip/" class="nte-vip-modal__login-link">
            Já é membro VIP? Acesse sua área exclusiva &rarr;
          </a>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
  }

  window.nteOpenVipModal = async function () {
    const settings = await fetchSettings();
    injectModalHtml(settings);

    const sheet = document.getElementById('nte-vip-bottom-sheet');
    if (sheet) {
      document.body.style.overflow = 'hidden';
      sheet.classList.add('is-open');
    }
  };

  window.nteCloseVipModal = function () {
    const sheet = document.getElementById('nte-vip-bottom-sheet');
    if (sheet) {
      sheet.classList.remove('is-open');
      document.body.style.overflow = '';
    }
  };

  window.isVipMember = async function () {
    const isAct = localStorage.getItem(STORAGE_ACTIVE_KEY) === 'true';
    const token = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const phone = localStorage.getItem(STORAGE_PHONE_KEY) || '';
    const insta = localStorage.getItem(STORAGE_INSTAGRAM_KEY) || '';

    // A sessão VIP é o token (o servidor não aceita mais @/telefone como prova).
    // Marcado ativo com token local: resposta instantânea para não atrasar a interface.
    if (isAct && token) {
      updateHeaderVipButtons();
      return true;
    }

    if (!token) {
      if (isAct) localStorage.removeItem(STORAGE_ACTIVE_KEY);
      updateHeaderVipButtons();
      return false;
    }

    try {
      const q = new URLSearchParams();
      q.set('token', token);

      const res = await fetch(`/api/vip.php?action=check_member&${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.isVip) {
          localStorage.setItem(STORAGE_ACTIVE_KEY, 'true');
          if (data.instagram) localStorage.setItem(STORAGE_INSTAGRAM_KEY, data.instagram);
          if (data.phone) localStorage.setItem(STORAGE_PHONE_KEY, data.phone);
          if (data.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, data.vipToken);
          updateHeaderVipButtons();
          return true;
        } else {
          localStorage.removeItem(STORAGE_ACTIVE_KEY);
          updateHeaderVipButtons();
          return false;
        }
      }
      return isAct;
    } catch (e) {
      return isAct;
    }
  };

  window.getVipToken = function () {
    return localStorage.getItem(STORAGE_TOKEN_KEY) || '';
  };

  window.getVipPhone = function () {
    return localStorage.getItem(STORAGE_PHONE_KEY) || '';
  };

  window.getVipInstagram = function () {
    return localStorage.getItem(STORAGE_INSTAGRAM_KEY) || '';
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      updateHeaderVipButtons();
      window.isVipMember().catch(() => {});
    });
  } else {
    updateHeaderVipButtons();
    window.isVipMember().catch(() => {});
  }

})();
