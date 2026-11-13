/* ============================================================
   NT ELEGANZ — Área VIP: efeitos visuais (só apresentação).
   - entrada suave das seções ao rolar ([data-reveal])
   - cartão de metal que inclina e reflete a luz seguindo o mouse/dedo ([data-tilt]),
     e o giroscópio no Android
   - cabeçalho que ganha borda ao rolar
   - barra fixa "Ver planos" no celular (some na seção de planos, no rodapé e para membros)
   A lógica de assinatura/login continua toda em js/vip.js.
   ============================================================ */
(function () {
  'use strict';

  window.__vipFx = true;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Entrada ao rolar ──
  const revealItems = document.querySelectorAll('[data-reveal]');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(el => el.classList.add('is-in'));
  } else {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealItems.forEach(el => revealObserver.observe(el));
  }

  // ── Cabeçalho ──
  const header = document.getElementById('vip-header');
  const onScroll = () => {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Cartão: inclinação + reflexo ──
  const MAX_TILT = 10; // graus
  const cards = Array.from(document.querySelectorAll('[data-tilt]'));

  function setTilt(card, x, y) {
    // x e y de 0 a 1 (posição do ponteiro sobre o cartão)
    card.style.setProperty('--ry', ((x - 0.5) * 2 * MAX_TILT).toFixed(2) + 'deg');
    card.style.setProperty('--rx', ((0.5 - y) * 2 * MAX_TILT).toFixed(2) + 'deg');
    card.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
    card.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  }

  function resetTilt(card) {
    card.classList.remove('is-tilting');
    ['--rx', '--ry', '--mx', '--my'].forEach(p => card.style.removeProperty(p));
  }

  if (!reduceMotion) {
    cards.forEach(card => {
      let frame = 0;
      card.addEventListener('pointerenter', (e) => {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') card.classList.add('is-tilting');
      });
      card.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        const rect = card.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => setTilt(card, x, y));
      });
      card.addEventListener('pointerleave', () => resetTilt(card));

      // Toque: um toque faz o cartão "balançar" e refletir a luz
      card.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        if (!t) return;
        const rect = card.getBoundingClientRect();
        card.classList.add('is-tilting');
        setTilt(card, (t.clientX - rect.left) / rect.width, (t.clientY - rect.top) / rect.height);
      }, { passive: true });
      card.addEventListener('touchend', () => {
        setTimeout(() => resetTilt(card), 160);
      }, { passive: true });
    });

    // Giroscópio (Android). No iPhone exige permissão explícita, então não usamos.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const needsPermission = typeof window.DeviceOrientationEvent !== 'undefined'
      && typeof window.DeviceOrientationEvent.requestPermission === 'function';
    if (coarse && 'DeviceOrientationEvent' in window && !needsPermission && cards.length) {
      let frame = 0;
      window.addEventListener('deviceorientation', (e) => {
        if (e.gamma == null || e.beta == null) return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          // celular segurado em pé (~45° de inclinação) é a posição neutra
          const x = Math.min(1, Math.max(0, 0.5 + e.gamma / 60));
          const y = Math.min(1, Math.max(0, 0.5 + (e.beta - 45) / 60));
          cards.forEach(card => {
            if (card.classList.contains('is-tilting')) return;
            const r = card.getBoundingClientRect();
            if (r.bottom < 0 || r.top > window.innerHeight || !r.width) return;
            setTilt(card, x, y);
          });
        });
      }, { passive: true });
    }
  }

  // ── Barra fixa "Ver planos" (celular) ──
  const sticky = document.getElementById('vip-sticky-cta');
  const hero = document.getElementById('vip-hero');
  const plans = document.getElementById('vip-plans-section');
  const footer = document.querySelector('footer.site-footer');
  let heroVisible = true;
  let plansVisible = false;
  let footerVisible = false;

  function updateSticky() {
    if (!sticky) return;
    const isMember = document.body.classList.contains('is-vip-member') || (plans && plans.style.display === 'none');
    const show = !heroVisible && !plansVisible && !footerVisible && !isMember;
    sticky.classList.toggle('is-visible', show);
    sticky.setAttribute('aria-hidden', String(!show));
    const link = sticky.querySelector('a');
    if (link) link.tabIndex = show ? 0 : -1;
  }

  if (sticky && 'IntersectionObserver' in window) {
    const stickyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.target === hero) heroVisible = entry.isIntersecting;
        if (entry.target === plans) plansVisible = entry.isIntersecting;
        if (entry.target === footer) footerVisible = entry.isIntersecting;
      });
      updateSticky();
    }, { threshold: 0 });
    if (hero) stickyObserver.observe(hero);
    if (plans) stickyObserver.observe(plans);
    if (footer) stickyObserver.observe(footer);
  }

  // Preço da barra acompanha o preço mensal vindo do painel (js/vip.js atualiza #val-monthly-price)
  const monthly = document.getElementById('val-monthly-price');
  const stickyPrice = document.getElementById('vip-sticky-price');
  if (monthly && stickyPrice) {
    const syncPrice = () => { stickyPrice.textContent = monthly.textContent.trim(); };
    syncPrice();
    if ('MutationObserver' in window) {
      new MutationObserver(syncPrice).observe(monthly, { childList: true, characterData: true, subtree: true });
    }
  }
})();
