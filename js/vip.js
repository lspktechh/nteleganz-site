/**
 * NT Eleganz — Área VIP & Assinaturas (Luxury Engine)
 * Gerencia a apresentação, planos, pagamento Mercado Pago e validação de sessão VIP.
 * Regra Absoluta: Proibido o uso de emojis. Ícones SVG apenas.
 */

(function () {
  'use strict';

  let currentPlan = 'lifetime'; // 'monthly' | 'lifetime'
  let currentMethod = 'pix';    // 'pix' | 'card'
  let pixPollInterval = null;
  let vipSettings = null;

  const STORAGE_ACTIVE_KEY    = 'nte_vip_active';
  const STORAGE_TOKEN_KEY     = 'nte_vip_token';
  const STORAGE_PHONE_KEY     = 'nte_vip_phone';
  const STORAGE_INSTAGRAM_KEY = 'nte_vip_instagram';
  const STORAGE_NAME_KEY      = 'nte_vip_name';
  const STORAGE_PLAN_KEY      = 'nte_vip_plan';
  const STORAGE_COUPON_KEY    = 'nte_vip_coupon';
  const STORAGE_LINK_KEY      = 'nte_vip_group_link';

  // ── Inicialização ──
  document.addEventListener('DOMContentLoaded', async () => {
    setupMasks();
    await loadSettings();
    await checkMemberSession();
  });

  // ── Carrega Preços Oficiais do Backend ──
  async function loadSettings() {
    try {
      const res = await fetch('/api/vip.php?action=settings');
      if (res.ok) {
        vipSettings = await res.json();
        const mPrice = Number(vipSettings.monthlyPrice || 29.9).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
        const lPrice = Number(vipSettings.lifetimePrice || 69.9).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

        const mEl = document.getElementById('val-monthly-price');
        if (mEl) mEl.textContent = `R$ ${mPrice}`;

        const lEl = document.getElementById('val-lifetime-price');
        if (lEl) lEl.textContent = `R$ ${lPrice}`;

        if (vipSettings.title) {
          const tEl = document.getElementById('vip-page-title');
          if (tEl) tEl.textContent = vipSettings.title;
        }
        if (vipSettings.subtitle) {
          const sEl = document.getElementById('vip-page-subtitle');
          if (sEl) sEl.textContent = vipSettings.subtitle;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar configurações VIP:', e);
    }
  }

  // ── Verifica se Usuário já é Membro VIP Ativo (Persistência no Dispositivo) ──
  async function checkMemberSession() {
    const isActive   = localStorage.getItem(STORAGE_ACTIVE_KEY) === 'true';
    const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const savedPhone = localStorage.getItem(STORAGE_PHONE_KEY) || '';
    const savedInsta = localStorage.getItem(STORAGE_INSTAGRAM_KEY) || '';
    const savedPlan  = localStorage.getItem(STORAGE_PLAN_KEY) || 'lifetime';
    const savedName  = localStorage.getItem(STORAGE_NAME_KEY) || '';
    const savedGroup = localStorage.getItem(STORAGE_LINK_KEY) || '';
    const savedCoup  = localStorage.getItem(STORAGE_COUPON_KEY) || 'VIP10';

    // Se já está marcado como ativo no dispositivo, renderiza imediatamente para experiência instantânea.
    // Sem token não há sessão: o servidor só reconhece o membro pelo token (ou login com senha).
    if (isActive && savedToken) {
      renderMemberDashboard({
        isVip: true,
        plan: savedPlan,
        instagram: savedInsta,
        phone: savedPhone,
        name: savedName || savedInsta,
        whatsappGroupLink: savedGroup,
        vipCouponCode: savedCoup
      });
    }

    // Sem token salvo, permanece na tela de apresentação e planos
    if (!savedToken) {
      if (isActive) clearVipSession();
      return;
    }

    // Validação silenciosa em background com a API oficial
    try {
      const q = new URLSearchParams();
      q.set('token', savedToken);

      const res = await fetch(`/api/vip.php?action=check_member&${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.isVip) {
          localStorage.setItem(STORAGE_ACTIVE_KEY, 'true');
          if (data.instagram) localStorage.setItem(STORAGE_INSTAGRAM_KEY, data.instagram);
          if (data.phone) localStorage.setItem(STORAGE_PHONE_KEY, data.phone);
          if (data.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, data.vipToken);
          if (data.plan) localStorage.setItem(STORAGE_PLAN_KEY, data.plan);
          if (data.name) localStorage.setItem(STORAGE_NAME_KEY, data.name);
          if (data.whatsappGroupLink) localStorage.setItem(STORAGE_LINK_KEY, data.whatsappGroupLink);
          if (data.vipCouponCode) localStorage.setItem(STORAGE_COUPON_KEY, data.vipCouponCode);

          renderMemberDashboard(data);
        } else if (isActive) {
          // Assinatura foi cancelada ou expirou no backend
          clearVipSession();
          window.location.reload();
        }
      }
    } catch (e) {
      console.warn('Erro ao validar sessão VIP com a API:', e);
    }
  }

  // ── Renderiza Dashboard do Membro VIP Ativo ──
  function renderMemberDashboard(member) {
    const dash = document.getElementById('vip-member-dashboard');
    const plansSec = document.getElementById('vip-plans-section');
    if (!dash) return;

    const planName = (member.plan === 'lifetime') ? 'Plano Vitalício Privé' : 'Plano Mensal';
    const cleanInsta = (member.instagram || '').trim();
    const displayName = member.name || cleanInsta || 'Membro VIP';

    const userEl = document.getElementById('vip-dash-username');
    if (userEl) userEl.textContent = cleanInsta ? (cleanInsta.startsWith('@') ? cleanInsta : `@${cleanInsta}`) : '@membro_vip';

    const fullEl = document.getElementById('vip-dash-fullname');
    if (fullEl) fullEl.textContent = displayName;

    const planEl = document.getElementById('vip-dash-plan');
    if (planEl) planEl.textContent = planName;

    const statusEl = document.getElementById('vip-dash-status-text');
    if (statusEl) {
      statusEl.textContent = (member.plan === 'lifetime') ? 'ACESSO VITALÍCIO ATIVO' : 'ACESSO MENSAL ATIVO';
    }

    if (member.whatsappGroupLink) {
      const wppBtn = document.getElementById('vip-dash-wpp-btn');
      if (wppBtn) {
        wppBtn.href = member.whatsappGroupLink;
        wppBtn.style.display = 'flex';
      }
    }

    dash.style.display = 'block';
    if (plansSec) plansSec.style.display = 'none';

    const loginBtn = document.getElementById('vip-login-toggle-btn');
    if (loginBtn) {
      loginBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#4ade80">
          <circle cx="12" cy="12" r="10"></circle>
        </svg>
        <span style="color:#4ade80;">VIP Ativo</span>
      `;
      loginBtn.onclick = () => {
        dash.scrollIntoView({ behavior: 'smooth' });
      };
    }
  }

  // ── Desconectar Sessão VIP ──
  window.disconnectVipSession = function () {
    if (confirm('Deseja desconectar a sua sessão VIP deste dispositivo?')) {
      clearVipSession();
      window.location.reload();
    }
  };

  function clearVipSession() {
    localStorage.removeItem(STORAGE_ACTIVE_KEY);
    localStorage.removeItem(STORAGE_TOKEN_KEY);
    localStorage.removeItem(STORAGE_PHONE_KEY);
    localStorage.removeItem(STORAGE_INSTAGRAM_KEY);
    localStorage.removeItem(STORAGE_NAME_KEY);
    localStorage.removeItem(STORAGE_PLAN_KEY);
    localStorage.removeItem(STORAGE_COUPON_KEY);
    localStorage.removeItem(STORAGE_LINK_KEY);
  }

  // ── Abre Modal de Assinatura ──
  window.openVipSubscribeModal = function (plan = 'lifetime') {
    currentPlan = plan;
    currentMethod = 'pix';

    const modal = document.getElementById('vip-subscribe-modal');
    if (!modal) return;

    const modalTitle = document.getElementById('vip-modal-plan-name');
    const modalPrice = document.getElementById('vip-modal-plan-price');

    const mPrice = vipSettings?.monthlyPrice ? Number(vipSettings.monthlyPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '29,90';
    const lPrice = vipSettings?.lifetimePrice ? Number(vipSettings.lifetimePrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '69,90';

    if (plan === 'lifetime') {
      if (modalTitle) modalTitle.textContent = 'Plano Vitalício NT VIP';
      if (modalPrice) modalPrice.textContent = `R$ ${lPrice} (Pagamento Único · Acesso Vitalício)`;
    } else {
      if (modalTitle) modalTitle.textContent = 'Plano Mensal NT VIP';
      if (modalPrice) modalPrice.textContent = `R$ ${mPrice} / mês`;
    }

    // Pré-preenche se já houver dados no navegador
    const savedInsta = localStorage.getItem(STORAGE_INSTAGRAM_KEY);
    const savedPhone = localStorage.getItem(STORAGE_PHONE_KEY);
    if (savedInsta) {
      const inEl = document.getElementById('vip-input-instagram');
      if (inEl && !inEl.value) inEl.value = savedInsta;
    }
    if (savedPhone) {
      const phEl = document.getElementById('vip-input-phone');
      if (phEl && !phEl.value) phEl.value = savedPhone;
    }

    // Reset de visualizações
    document.getElementById('vip-modal-form-step').style.display = 'block';
    document.getElementById('vip-modal-pix-step').style.display = 'none';
    document.getElementById('vip-modal-success-step').style.display = 'none';

    switchVipPaymentTab('pix');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  window.closeVipSubscribeModal = function () {
    const modal = document.getElementById('vip-subscribe-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
    if (pixPollInterval) {
      clearInterval(pixPollInterval);
      pixPollInterval = null;
    }
  };

  // ── Troca Aba de Pagamento (Pix / Cartão) ──
  window.switchVipPaymentTab = function (method) {
    currentMethod = method;
    const tabPix = document.getElementById('tab-btn-pix');
    const tabCard = document.getElementById('tab-btn-card');
    const cardFields = document.getElementById('vip-card-fields');

    if (tabPix) tabPix.classList.toggle('active', method === 'pix');
    if (tabCard) tabCard.classList.toggle('active', method === 'card');
    if (cardFields) cardFields.style.display = (method === 'card') ? 'block' : 'none';

    const submitBtn = document.getElementById('vip-btn-submit-payment');
    if (submitBtn) {
      submitBtn.innerHTML = (method === 'pix')
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Gerar Chave Pix</span>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg> <span>Pagar com Cartão de Crédito</span>';
    }
  };

  // ── Processa Assinatura VIP (Mercado Pago Backend Shield) ──
  window.submitVipSubscription = async function () {
    let instagram = document.getElementById('vip-input-instagram')?.value.trim() || '';
    let name = document.getElementById('vip-input-name')?.value.trim() || '';
    const phone = document.getElementById('vip-input-phone')?.value.trim() || '';

    // Normaliza Instagram
    instagram = instagram.replace(/^@+/, '');

    if (!instagram) {
      alert('Por favor, informe o seu @ do Instagram.');
      document.getElementById('vip-input-instagram')?.focus();
      return;
    }

    if (!name) {
      alert('Por favor, informe o seu nome completo.');
      document.getElementById('vip-input-name')?.focus();
      return;
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 10) {
      alert('Por favor, informe seu número de WhatsApp com DDD.');
      document.getElementById('vip-input-phone')?.focus();
      return;
    }

    const password = document.getElementById('vip-input-password')?.value || '';
    const passwordConfirm = document.getElementById('vip-input-password-confirm')?.value || '';
    if (password.length < 6) {
      alert('Crie uma senha com pelo menos 6 caracteres.');
      document.getElementById('vip-input-password')?.focus();
      return;
    }
    if (password !== passwordConfirm) {
      alert('As senhas não conferem. Digite a mesma senha nos dois campos.');
      document.getElementById('vip-input-password-confirm')?.focus();
      return;
    }

    const submitBtn = document.getElementById('vip-btn-submit-payment');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Processando com segurança…</span>';
    }

    try {
      const payload = {
        plan: currentPlan,
        paymentMethod: currentMethod,
        instagram: `@${instagram}`,
        name: name,
        phone: cleanPhone,
        password,
        customer: {
          name,
          instagram: `@${instagram}`,
          phone: cleanPhone
        }
      };

      if (currentMethod === 'card') {
        const cardNumber = document.getElementById('vip-card-number')?.value.replace(/\D/g, '');
        const cardHolder = document.getElementById('vip-card-holder')?.value.trim();
        const cardExp = document.getElementById('vip-card-exp')?.value.trim();
        const cardCvv = document.getElementById('vip-card-cvv')?.value.trim();

        if (!cardNumber || !cardHolder || !cardExp || !cardCvv) {
          alert('Preencha todos os dados do cartão de crédito.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>Pagar com Cartão de Crédito</span>'; }
          return;
        }

        const expParts = cardExp.split('/');
        const expMonth = parseInt(expParts[0], 10);
        let expYear = parseInt(expParts[1], 10);
        if (expYear < 100) expYear += 2000;

        const tokenRes = await fetch('/api/mercadopago.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_card_token',
            cardNumber,
            cardholderName: cardHolder,
            expirationMonth: expMonth,
            expirationYear: expYear,
            securityCode: cardCvv
          })
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.token) {
          alert(tokenData.error || 'Cartão não autorizado. Verifique os dados informados.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<span>Pagar com Cartão de Crédito</span>'; }
          return;
        }

        payload.token = tokenData.token;
        payload.paymentMethodId = tokenData.data?.payment_method_id || 'visa';
      }

      // Envia pedido de assinatura para o backend blindado
      const res = await fetch('/api/vip.php?action=subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.error || 'Não foi possível gerar a assinatura.');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = (currentMethod === 'pix') ? '<span>Gerar Chave Pix</span>' : '<span>Pagar com Cartão</span>';
        }
        return;
      }

      // Salva identificadores no cliente
      localStorage.setItem(STORAGE_INSTAGRAM_KEY, `@${instagram}`);
      localStorage.setItem(STORAGE_PHONE_KEY, cleanPhone);
      localStorage.setItem(STORAGE_NAME_KEY, name);

      if (currentMethod === 'pix') {
        renderPixStep(data);
      } else if (currentMethod === 'card') {
        if (data.isApproved) {
          localStorage.setItem(STORAGE_ACTIVE_KEY, 'true');
          if (data.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, data.vipToken);
          if (data.plan) localStorage.setItem(STORAGE_PLAN_KEY, data.plan);
          if (data.whatsappGroupLink) localStorage.setItem(STORAGE_LINK_KEY, data.whatsappGroupLink);
          if (data.vipCouponCode) localStorage.setItem(STORAGE_COUPON_KEY, data.vipCouponCode);
          renderSuccessStep(data);
        } else {
          alert('Seu pagamento está em análise. Assim que compensado, seu acesso VIP será ativado automaticamente.');
          closeVipSubscribeModal();
        }
      }
    } catch (e) {
      console.error('Erro na assinatura VIP:', e);
      alert('Erro de comunicação. Tente novamente em instantes.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = (currentMethod === 'pix') ? '<span>Gerar Chave Pix</span>' : '<span>Pagar com Cartão</span>';
      }
    }
  };

  // ── Renderiza QR Code Pix e Faz Polling Instantâneo ──
  function renderPixStep(pixData) {
    document.getElementById('vip-modal-form-step').style.display = 'none';
    const pixStep = document.getElementById('vip-modal-pix-step');
    pixStep.style.display = 'block';

    const qrImg = document.getElementById('vip-pix-qr-img');
    if (qrImg && pixData.qrCodeBase64) {
      qrImg.src = `data:image/png;base64,${pixData.qrCodeBase64}`;
    }

    const copyInput = document.getElementById('vip-pix-copy-input');
    if (copyInput) {
      copyInput.value = pixData.qrCode || '';
    }

    const valEl = document.getElementById('vip-pix-amount-text');
    if (valEl) {
      valEl.textContent = pixData.amountFormatted || 'R$ 69,90';
    }

    // Inicia verificação do status a cada 2.5s
    if (pixPollInterval) clearInterval(pixPollInterval);
    pixPollInterval = setInterval(async () => {
      try {
        const checkUrl = `/api/vip.php?action=check_payment&id=${pixData.paymentId}&code=${pixData.subCode}`;
        const cRes = await fetch(checkUrl);
        const cData = await cRes.json();

        if (cData.isApproved) {
          clearInterval(pixPollInterval);
          pixPollInterval = null;
          localStorage.setItem(STORAGE_ACTIVE_KEY, 'true');
          if (cData.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, cData.vipToken);
          if (cData.plan) localStorage.setItem(STORAGE_PLAN_KEY, cData.plan);
          if (cData.whatsappGroupLink) localStorage.setItem(STORAGE_LINK_KEY, cData.whatsappGroupLink);
          if (cData.vipCouponCode) localStorage.setItem(STORAGE_COUPON_KEY, cData.vipCouponCode);
          renderSuccessStep(cData);
        }
      } catch (err) {
        // Silencioso no polling
      }
    }, 2500);
  }

  // ── Sucesso na Assinatura ──
  function renderSuccessStep(vipData) {
    document.getElementById('vip-modal-form-step').style.display = 'none';
    document.getElementById('vip-modal-pix-step').style.display = 'none';

    const successStep = document.getElementById('vip-modal-success-step');
    successStep.style.display = 'block';

    if (vipData.whatsappGroupLink) {
      const sWpp = document.getElementById('vip-success-wpp-btn');
      if (sWpp) sWpp.href = vipData.whatsappGroupLink;
    }

    // Atualiza dashboard na página
    checkMemberSession();
  }

  // ── Login Rápido / Reconexão ("Já sou Membro VIP") ──
  window.openVipLoginModal = function () {
    const modal = document.getElementById('vip-login-modal');
    if (modal) {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
      const input = document.getElementById('vip-login-identifier');
      if (input) input.focus();
    }
  };

  window.closeVipLoginModal = function () {
    const modal = document.getElementById('vip-login-modal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  };

  window.submitVipLogin = async function () {
    const identifier = document.getElementById('vip-login-identifier')?.value.trim() || '';
    const password = document.getElementById('vip-login-password')?.value || '';
    if (!identifier || !password) {
      alert('Informe seu @ do Instagram (ou WhatsApp) e a sua senha.');
      return;
    }

    const btn = document.getElementById('vip-btn-login-submit');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span>Entrando…</span>'; }

    try {
      const res = await fetch('/api/vip.php?action=login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.isVip) {
        localStorage.setItem(STORAGE_ACTIVE_KEY, 'true');
        if (data.instagram) localStorage.setItem(STORAGE_INSTAGRAM_KEY, data.instagram);
        if (data.phone) localStorage.setItem(STORAGE_PHONE_KEY, data.phone);
        if (data.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, data.vipToken);
        if (data.plan) localStorage.setItem(STORAGE_PLAN_KEY, data.plan);
        if (data.name) localStorage.setItem(STORAGE_NAME_KEY, data.name);
        if (data.whatsappGroupLink) localStorage.setItem(STORAGE_LINK_KEY, data.whatsappGroupLink);

        const pwdEl = document.getElementById('vip-login-password');
        if (pwdEl) pwdEl.value = '';
        closeVipLoginModal();
        renderMemberDashboard(data);
      } else {
        alert(data.error || 'Não foi possível entrar. Confira seu @ (ou WhatsApp) e a senha.');
      }
    } catch (e) {
      alert('Erro ao consultar assinatura. Tente novamente.');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<span>Acessar Meus Benefícios</span>'; }
    }
  };

  // ── Copiar Chave Pix ──
  window.copyVipPix = function () {
    const copyInput = document.getElementById('vip-pix-copy-input');
    if (!copyInput) return;
    copyInput.select();
    navigator.clipboard.writeText(copyInput.value).then(() => {
      const btn = document.getElementById('vip-pix-copy-btn');
      if (btn) {
        btn.textContent = 'Copiado!';
        setTimeout(() => { btn.textContent = 'Copiar Código'; }, 3000);
      }
    });
  };

  // ── Helper no-op ──
  window.copyVipCoupon = function () {};

  // ── Máscaras de Inputs ──
  function setupMasks() {
    const phoneInput = document.getElementById('vip-input-phone');
    if (phoneInput) {
      phoneInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.substring(0, 11);
        if (v.length > 6) {
          e.target.value = `(${v.substring(0, 2)}) ${v.substring(2, 7)}-${v.substring(7)}`;
        } else if (v.length > 2) {
          e.target.value = `(${v.substring(0, 2)}) ${v.substring(2)}`;
        } else {
          e.target.value = v;
        }
      });
    }

    const instaInput = document.getElementById('vip-input-instagram');
    if (instaInput) {
      instaInput.addEventListener('blur', (e) => {
        let v = e.target.value.trim();
        if (v && !v.startsWith('@')) {
          e.target.value = `@${v}`;
        }
      });
    }

    const cpfInput = document.getElementById('vip-input-cpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.substring(0, 11);
        if (v.length > 9) e.target.value = `${v.substring(0, 3)}.${v.substring(3, 6)}.${v.substring(6, 9)}-${v.substring(9)}`;
        else if (v.length > 6) e.target.value = `${v.substring(0, 3)}.${v.substring(3, 6)}.${v.substring(6)}`;
        else if (v.length > 3) e.target.value = `${v.substring(0, 3)}.${v.substring(3)}`;
        else e.target.value = v;
      });
    }

    const cardNum = document.getElementById('vip-card-number');
    if (cardNum) {
      cardNum.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 16);
        e.target.value = v.replace(/(\d{4})(?=\d)/g, '$1 ');
      });
    }

    const cardExp = document.getElementById('vip-card-exp');
    if (cardExp) {
      cardExp.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 4);
        if (v.length >= 2) e.target.value = `${v.substring(0, 2)}/${v.substring(2)}`;
        else e.target.value = v;
      });
    }
  }

})();
