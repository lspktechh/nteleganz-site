/**
 * NT Eleganz — Área VIP & Assinaturas
 * Gerencia a apresentação, planos, pagamento Mercado Pago e validação de sessão VIP.
 * Regra: Proibido o uso de emojis. Ícones SVG apenas.
 */

(function () {
  'use strict';

  let currentPlan = 'lifetime'; // 'monthly' | 'lifetime'
  let currentMethod = 'pix';    // 'pix' | 'card'
  let pixPollInterval = null;
  let vipSettings = null;

  const STORAGE_TOKEN_KEY = 'nte_vip_token';
  const STORAGE_PHONE_KEY = 'nte_vip_phone';

  // ── Inicialização ──
  document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    await checkMemberSession();
    setupMasks();
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

  // ── Verifica se Usuário já é Membro VIP Ativo ──
  async function checkMemberSession() {
    const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    const savedPhone = localStorage.getItem(STORAGE_PHONE_KEY) || '';

    if (!savedToken && !savedPhone) return;

    try {
      const url = `/api/vip.php?action=check_member&token=${encodeURIComponent(savedToken)}&phone=${encodeURIComponent(savedPhone)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data.isVip) {
        renderMemberDashboard(data);
      }
    } catch (e) {
      console.warn('Erro ao checar sessão VIP:', e);
    }
  }

  // ── Renderiza Dashboard do Membro VIP Ativo ──
  function renderMemberDashboard(member) {
    const dash = document.getElementById('vip-member-dashboard');
    const plansSec = document.getElementById('vip-plans-section');
    if (!dash) return;

    const planName = (member.plan === 'lifetime') ? 'Plano Vitalício' : 'Plano Mensal';
    const memberName = member.name ? `Olá, ${member.name}!` : 'Olá, Membro VIP!';
    const expText = (member.plan === 'lifetime')
      ? 'Acesso Permanente e Ilimitado'
      : (member.expiresAt ? `Válido até ${new Date(member.expiresAt).toLocaleDateString('pt-BR')}` : 'Ativo');

    document.getElementById('vip-dash-greeting').textContent = memberName;
    document.getElementById('vip-dash-plan').textContent = planName;
    document.getElementById('vip-dash-exp').textContent = expText;

    if (member.whatsappGroupLink) {
      const wppBtn = document.getElementById('vip-dash-wpp-btn');
      if (wppBtn) {
        wppBtn.href = member.whatsappGroupLink;
        wppBtn.style.display = 'flex';
      }
    }

    if (member.vipCouponCode) {
      const cBox = document.getElementById('vip-dash-coupon-box');
      const cCode = document.getElementById('vip-dash-coupon-code');
      const cDisc = document.getElementById('vip-dash-coupon-desc');
      if (cBox && cCode) {
        cCode.textContent = member.vipCouponCode;
        if (cDisc) cDisc.textContent = `Aproveite ${member.vipCouponDiscount || 10}% de desconto em qualquer compra no site.`;
        cBox.style.display = 'flex';
      }
    }

    dash.style.display = 'block';
    if (plansSec) plansSec.style.display = 'none';

    const loginBtn = document.getElementById('vip-login-toggle-btn');
    if (loginBtn) {
      loginBtn.textContent = 'Membro Ativo';
      loginBtn.style.color = 'var(--vip-gold)';
      loginBtn.onclick = null;
    }
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
      if (modalPrice) modalPrice.textContent = `R$ ${lPrice} (Pagamento Único)`;
    } else {
      if (modalTitle) modalTitle.textContent = 'Plano Mensal NT VIP';
      if (modalPrice) modalPrice.textContent = `R$ ${mPrice} / mês`;
    }

    // Reset views
    document.getElementById('vip-modal-form-step').style.display = 'block';
    document.getElementById('vip-modal-pix-step').style.display = 'none';
    document.getElementById('vip-modal-card-step').style.display = 'none';
    document.getElementById('vip-modal-success-step').style.display = 'none';

    // Tabs
    switchVipPaymentTab('pix');

    modal.classList.add('open');
  };

  window.closeVipSubscribeModal = function () {
    const modal = document.getElementById('vip-subscribe-modal');
    if (modal) modal.classList.remove('open');
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
      submitBtn.textContent = (method === 'pix') ? 'Gerar Chave Pix' : 'Pagar com Cartão de Crédito';
    }
  };

  // ── Processa Assinatura VIP ──
  window.submitVipSubscription = async function () {
    const name = document.getElementById('vip-input-name')?.value.trim();
    const phone = document.getElementById('vip-input-phone')?.value.trim();
    const email = document.getElementById('vip-input-email')?.value.trim();
    const cpf = document.getElementById('vip-input-cpf')?.value.trim();

    if (!name || !phone) {
      alert('Por favor, informe seu Nome e WhatsApp.');
      return;
    }

    const submitBtn = document.getElementById('vip-btn-submit-payment');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processando com segurança…';
    }

    try {
      const payload = {
        plan: currentPlan,
        paymentMethod: currentMethod,
        customer: { name, phone, email, cpf }
      };

      if (currentMethod === 'card') {
        const cardNumber = document.getElementById('vip-card-number')?.value.replace(/\D/g, '');
        const cardHolder = document.getElementById('vip-card-holder')?.value.trim();
        const cardExp = document.getElementById('vip-card-exp')?.value.trim();
        const cardCvv = document.getElementById('vip-card-cvv')?.value.trim();

        if (!cardNumber || !cardHolder || !cardExp || !cardCvv) {
          alert('Preencha os dados do cartão de crédito.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Pagar com Cartão de Crédito'; }
          return;
        }

        const expParts = cardExp.split('/');
        const expMonth = parseInt(expParts[0], 10);
        let expYear = parseInt(expParts[1], 10);
        if (expYear < 100) expYear += 2000;

        // Tokeniza cartão via proxy Mercado Pago
        const tokenRes = await fetch('/api/mercadopago.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_card_token',
            cardNumber,
            cardholderName: cardHolder,
            cpf,
            expirationMonth: expMonth,
            expirationYear: expYear,
            securityCode: cardCvv
          })
        });

        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.token) {
          alert(tokenData.error || 'Cartão não autorizado. Verifique os dados e tente novamente.');
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Pagar com Cartão de Crédito'; }
          return;
        }

        payload.token = tokenData.token;
        payload.paymentMethodId = tokenData.data?.payment_method_id || 'visa';
      }

      // Envia pedido de assinatura para o backend
      // O valor da transação é lido e blindado diretamente pelo servidor no endpoint vip.php
      const res = await fetch('/api/vip.php?action=subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.error || 'Não foi possível processar a assinatura.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = (currentMethod === 'pix') ? 'Gerar Chave Pix' : 'Pagar com Cartão'; }
        return;
      }

      // Salva WhatsApp no navegador para reconexão futura
      localStorage.setItem(STORAGE_PHONE_KEY, phone);

      if (currentMethod === 'pix') {
        renderPixStep(data);
      } else if (currentMethod === 'card') {
        if (data.isApproved) {
          if (data.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, data.vipToken);
          renderSuccessStep(data);
        } else {
          alert('O pagamento com cartão está em análise ou pendente. Assim que for compensado sua assinatura será liberada.');
          closeVipSubscribeModal();
        }
      }
    } catch (e) {
      console.error('Erro na assinatura VIP:', e);
      alert('Erro de comunicação. Tente novamente em instantes.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = (currentMethod === 'pix') ? 'Gerar Chave Pix' : 'Pagar com Cartão';
      }
    }
  };

  // ── Exibe QR Code Pix e Inicia Polling ──
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
      valEl.textContent = pixData.amountFormatted || 'R$ 29,90';
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
          if (cData.vipToken) localStorage.setItem(STORAGE_TOKEN_KEY, cData.vipToken);
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

    if (vipData.vipCouponCode) {
      const sCoup = document.getElementById('vip-success-coupon-code');
      if (sCoup) sCoup.textContent = vipData.vipCouponCode;
    }

    // Atualiza dashboard em background
    checkMemberSession();
  }

  // ── Login Rápido ("Já sou Membro VIP") ──
  window.openVipLoginModal = function () {
    const modal = document.getElementById('vip-login-modal');
    if (modal) modal.classList.add('open');
  };

  window.closeVipLoginModal = function () {
    const modal = document.getElementById('vip-login-modal');
    if (modal) modal.classList.remove('open');
  };

  window.submitVipLogin = async function () {
    const phoneInput = document.getElementById('vip-login-phone');
    const phone = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';

    if (!phone || phone.length < 10) {
      alert('Informe um número de WhatsApp válido com DDD.');
      return;
    }

    const btn = document.getElementById('vip-btn-login-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }

    try {
      const res = await fetch(`/api/vip.php?action=check_member&phone=${phone}`);
      const data = await res.json();

      if (data.isVip) {
        localStorage.setItem(STORAGE_PHONE_KEY, phone);
        closeVipLoginModal();
        renderMemberDashboard(data);
      } else {
        alert('Não encontramos uma assinatura VIP ativa para este número. Garanta seu acesso escolhendo um dos planos!');
      }
    } catch (e) {
      alert('Erro ao consultar assinatura.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Acessar Área VIP'; }
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
        setTimeout(() => { btn.textContent = 'Copiar Código Pix'; }, 3000);
      }
    });
  };

  // ── Copiar Cupom VIP ──
  window.copyVipCoupon = function (code) {
    navigator.clipboard.writeText(code).then(() => {
      alert(`Cupom ${code} copiado com sucesso! Use no checkout para obter seu desconto.`);
    });
  };

  // ── Máscaras de Inputs ──
  function setupMasks() {
    const phoneInputs = document.querySelectorAll('#vip-input-phone, #vip-login-phone');
    phoneInputs.forEach(input => {
      input.addEventListener('input', (e) => {
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
    });

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
