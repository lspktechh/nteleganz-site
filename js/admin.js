/* ============================================
   NT ELEGANZ — ADMIN DASHBOARD LOGIC
   ============================================ */

(function () {
  'use strict';

  // ── State ──
  let allProducts = [];
  let allOrders = [];
  let allLeads = [];
  let knownLeadIds = new Set();
  let leadsInitialized = false;
  let editingSizes = [];
  let editingColors = [];
  let pendingImages = [];
  let confirmCallback = null;
  let currentDBMode = 'local';
  let productCurrentPage = 1;
  let productPageSize = 500;

  // ── Loader ──
  let loaderTimer = null;
  const LOADER_DELAY_MS = 300;

  function showLoader() {
    const loader = document.getElementById('admin-loader');
    if (loader) loader.classList.remove('hidden');
  }

  function hideLoader() {
    const loader = document.getElementById('admin-loader');
    if (loader) loader.classList.add('hidden');
  }

  function scheduleLoader() {
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(showLoader, LOADER_DELAY_MS);
  }

  function cancelLoader() {
    clearTimeout(loaderTimer);
    hideLoader();
  }

  // ── Format helpers ──
  const fmt = {
    currency(val) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
    },
    parsePrice(str) {
      if (!str) return 0;
      return parseFloat(String(str).replace(/[^\d,]/g, '').replace(',', '.')) || 0;
    },
    date(iso) {
      if (!iso) return '—';
      return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    },
  };

  function setupPriceInput(inputId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.priceFormatted) return;
    input.dataset.priceFormatted = 'true';

    function rawOf(value) {
      const s = String(value || '').replace(/[^\d,]/g, '');
      const i = s.indexOf(',');
      if (i === -1) return s;
      return s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, '');
    }

    function toDisplay(raw) {
      if (!raw) return '';
      const i = raw.indexOf(',');
      const wholeRaw = i === -1 ? raw : raw.slice(0, i);
      const cents = i === -1 ? '' : raw.slice(i + 1);
      const wholeNum = parseInt(wholeRaw.replace(/\D/g, '') || '0', 10);
      const whole = (Number.isFinite(wholeNum) ? wholeNum : 0).toLocaleString('pt-BR');
      return 'R$ ' + whole + (i === -1 ? ',00' : ',' + cents);
    }

    let raw = rawOf(input.value);

    function render() {
      input.value = toDisplay(raw);
      const c = input.value.length;
      input.setSelectionRange(c, c);
    }

    input.addEventListener('beforeinput', function (e) {
      if (e.inputType === 'deleteContentBackward') {
        e.preventDefault();
        raw = raw.slice(0, -1);
        render();
        return;
      }
      const d = e.data;
      if (d === null || d === undefined) return;
      e.preventDefault();
      const i = raw.indexOf(',');
      const isComma = d === ',';
      if (isComma) {
        if (i !== -1) return;
        raw += ',';
      } else if (/^\d$/.test(d)) {
        if (i !== -1) {
          if (raw.slice(i + 1).length >= 2) return;
        } else if (raw.length >= 9) {
          return;
        }
        raw += d;
      } else {
        return;
      }
      render();
    });

    input.addEventListener('input', function () {
      const next = rawOf(this.value);
      if (next !== raw) { raw = next; }
      render();
    });

    input.addEventListener('blur', function () {
      if (raw && raw.includes(',')) {
        const i = raw.indexOf(',');
        let cents = raw.slice(i + 1);
        if (cents.length === 1) raw = raw + '0';
        else if (cents.length === 0) raw = raw + '00';
      }
      render();
    });

    input.addEventListener('focus', function () {
      raw = rawOf(this.value);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') this.blur();
    });

    render();
  }

  function productCategory(product) {
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    const explicit = normalize(product?.category);
    if (explicit && explicit !== 'todos') return explicit;
    const text = normalize(`${product?.name || ''} ${product?.category || ''}`);
    if (/calcado|sandalia|tenis|sapato|sneaker|birkenstock/.test(text)) return 'calcados';
    if (/short|bermuda|swim|trunk/.test(text)) return 'shorts';
    if (/hood|moletom|puffer|jaqueta|jacket|biker|leather/.test(text)) return 'hoodies';
    return 'camisetas';
  }

  const categoryLabel = value => {
    if (typeof allCategories !== 'undefined' && Array.isArray(allCategories) && allCategories.length) {
      const match = allCategories.find(c => c.id === value);
      if (match && match.name) return match.name;
    }
    return ({ camisetas: 'Camisetas', shorts: 'Shorts', calcados: 'Calçados', hoodies: 'Hoodies' })[value] || value;
  };

  // ── Panel Navigation ──
  const PANEL_TITLES = {
    overview: 'Visão Geral',
    financeiro: 'Financeiro',
    produtos: 'Produtos',
    categorias: 'Categorias',
    feedbacks: 'Feedbacks de Clientes',
    faq: 'Perguntas frequentes',
    pedidos: 'Pedidos',
    clientes: 'Base de Clientes',
    leads: 'Leads do WhatsApp',
    marketing: 'Marketing, Pixels & Tráfego',
    configuracoes: 'Configurações',
  };

  window.showPanel = async function (panelId, navEl) {
    // Update panels
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('panel-' + panelId)?.classList.add('active');

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');

    // Update topbar title
    document.getElementById('topbar-title').textContent = PANEL_TITLES[panelId] || '';
    document.getElementById('sidebar')?.classList.remove('mobile-open');
    document.body.classList.remove('admin-menu-open');
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    mobileMenuButton?.setAttribute('aria-expanded', 'false');

    // Show loader for slow panel loads
    scheduleLoader();

    try {
      // Load panel data
      if (panelId === 'overview') await loadOverview();
      if (panelId === 'financeiro') await loadFinanceiro();
      if (panelId === 'produtos') syncProducts();
      if (panelId === 'categorias') loadCategories();
      if (panelId === 'feedbacks') loadFeedbacks();
      if (panelId === 'faq') loadFaq();

      if (panelId === 'pedidos') refreshOrders();
      if (panelId === 'clientes') renderCustomersTable();
      if (panelId === 'leads') {
        renderLeadsTable();
        markLeadsRead();
      }
      if (panelId === 'marketing') loadTrackingSettings();
      if (panelId === 'configuracoes') loadSettings();
    } finally {
      cancelLoader();
    }
  };

  // ── FAQ ──
  const FAQ_ID = 'faq-content';
  const DEFAULT_FAQ = [
    { question: 'Como funciona o processo de compra?', answer: 'É simples! Escolha o produto que deseja, adicione ao carrinho e clique em "Finalizar via WhatsApp". Você será redirecionado diretamente para uma conversa conosco com os detalhes do seu pedido já preenchidos. Nosso especialista confirma a disponibilidade e formas de pagamento.' },
    { question: 'As peças são originais e autenticadas?', answer: 'Sim, 100%. Trabalhamos apenas com peças originais de procedência comprovada. Todas as nossas grifes são autenticadas antes de chegar até você.' },
    { question: 'Quais são as formas de pagamento disponíveis?', answer: 'Aceitamos PIX e cartão de crédito. As condições de pagamento são confirmadas diretamente pelo WhatsApp após a seleção do produto.' },
    { question: 'Enviam para todo Brasil?', answer: 'Sim, o envio é realizado pelos correios para todo território nacional, consulte opções de envios disponíveis no fechamento da sua compra.' },
  ];
  let faqItems = [];

  function renderFaqEditor() {
    const list = document.getElementById('faq-admin-list');
    if (!list) return;
    if (!faqItems.length) {
      list.innerHTML = '<div class="empty-state"><p>Nenhuma pergunta cadastrada</p><small>Adicione a primeira pergunta para exibi-la no site.</small></div>';
      return;
    }
    list.innerHTML = faqItems.map((item, index) => `
      <article class="faq-admin-item">
        <div class="faq-admin-item__header">
          <span class="faq-admin-number">${String(index + 1).padStart(2, '0')}</span>
          <strong>${escHtml(item.question || 'Nova pergunta')}</strong>
          <div class="faq-admin-actions">
            <button class="btn btn-secondary btn-sm btn-icon-only" type="button" onclick="moveFaqItem(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="Mover para cima" aria-label="Mover pergunta para cima">↑</button>
            <button class="btn btn-secondary btn-sm btn-icon-only" type="button" onclick="moveFaqItem(${index}, 1)" ${index === faqItems.length - 1 ? 'disabled' : ''} title="Mover para baixo" aria-label="Mover pergunta para baixo">↓</button>
            <button class="btn btn-danger btn-sm" type="button" onclick="removeFaqItem(${index})">Excluir</button>
          </div>
        </div>
        <div class="faq-admin-fields">
          <div class="form-group"><label for="faq-question-${index}">Pergunta</label><input class="form-control" id="faq-question-${index}" value="${escHtml(item.question)}" oninput="updateFaqItem(${index}, 'question', this.value)"></div>
          <div class="form-group"><label for="faq-answer-${index}">Resposta</label><textarea class="form-control" id="faq-answer-${index}" rows="4" oninput="updateFaqItem(${index}, 'answer', this.value)">${escHtml(item.answer)}</textarea></div>
        </div>
      </article>`).join('');
  }

  async function loadFaq() {
    try {
      const data = await window.ntDB?.settings.getById(FAQ_ID);
      faqItems = (Array.isArray(data?.items) ? data.items : DEFAULT_FAQ).map(item => ({ question: item.question || '', answer: item.answer || '' }));
      renderFaqEditor();
    } catch (error) {
      showToast('!', 'Não foi possível carregar o FAQ', error.message);
    }
  }

  window.updateFaqItem = (index, field, value) => { if (faqItems[index]) faqItems[index][field] = value; };
  window.addFaqItem = () => { faqItems.push({ question: '', answer: '' }); renderFaqEditor(); document.getElementById(`faq-question-${faqItems.length - 1}`)?.focus(); };
  window.removeFaqItem = index => { faqItems.splice(index, 1); renderFaqEditor(); };
  window.moveFaqItem = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= faqItems.length) return;
    [faqItems[index], faqItems[target]] = [faqItems[target], faqItems[index]];
    renderFaqEditor();
  };
  window.saveFaq = async function () {
    const items = faqItems.map(item => ({ question: item.question.trim(), answer: item.answer.trim() }));
    if (!items.length || items.some(item => !item.question || !item.answer)) {
      showToast('!', 'Preencha todas as perguntas e respostas', 'Nenhum campo pode ficar vazio.');
      return;
    }
    const button = document.getElementById('faq-save-button');
    if (button) { button.disabled = true; button.textContent = 'Salvando…'; }
    try {
      const existing = await window.ntDB.settings.getById(FAQ_ID);
      if (existing) await window.ntDB.settings.update(FAQ_ID, { items });
      else await window.ntDB.settings.add({ id: FAQ_ID, items });
      faqItems = items;
      renderFaqEditor();
      showToast('check', 'FAQ atualizado', `${items.length} pergunta${items.length === 1 ? '' : 's'} publicada${items.length === 1 ? '' : 's'}.`);
    } catch (error) {
      showToast('!', 'Não foi possível salvar o FAQ', error.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Salvar alterações'; }
    }
  };

  // Completa em segundo plano a segunda cópia das fotos (Hostinger <-> VPS). Só copia, nunca apaga.
  function syncImagesInBackground() {
    try {
      const last = Number(localStorage.getItem('nte_img_sync_at') || 0);
      if (Date.now() - last < 30 * 60 * 1000) return;
      localStorage.setItem('nte_img_sync_at', String(Date.now()));
    } catch (e) { /* sem localStorage: sincroniza mesmo assim */ }
    fetch('/api/sync-images.php', { cache: 'no-store' }).catch(() => {});
  }

  // ── Init ──
  async function init() {
    scheduleLoader();

    try {
      // Force modal visibility via global CSS (last resort against CSS conflicts)
      if (!document.getElementById('admin-modal-force-css')) {
        const style = document.createElement('style');
        style.id = 'admin-modal-force-css';
        style.textContent = `
          .modal-overlay.open,
          .modal-overlay.active {
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .modal-overlay:not(.open):not(.active) {
            opacity: 0 !important;
            visibility: hidden !important;
            pointer-events: none !important;
          }
          .modal-overlay .modal {
            display: flex !important;
            flex-direction: column !important;
            max-height: 90vh !important;
            overflow: hidden !important;
            position: relative !important;
            background: var(--bg-surface) !important;
            border: 1px solid var(--border) !important;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2) !important;
          }
          .modal-overlay .modal .modal-header,
          .modal-overlay .modal .modal-footer {
            flex-shrink: 0 !important;
          }
          .modal-overlay .modal .modal-body {
            flex: 1 1 auto !important;
            overflow-y: auto !important;
          }
          #product-modal { z-index: 200 !important; }
          #category-modal { z-index: 202 !important; }
          #order-modal { z-index: 205 !important; }
          #customer-modal { z-index: 210 !important; }
          #whatsapp-modal { z-index: 300 !important; }
          #confirm-modal { z-index: 400 !important; }
        `;
        document.head.appendChild(style);
      }
      // Init db
      const dbResult = await window.ntDB?.init();
      if (dbResult) {
        currentDBMode = dbResult.mode;
        const labels = { local: 'LocalStorage', firebase: 'Firebase', supabase: 'Supabase', hostinger: 'Hostinger (produtos)' };
        document.getElementById('db-mode-label').textContent = labels[dbResult.mode] || 'Local';
        if (dbResult.mode !== 'supabase' && window.ntDB.config?.().mode === 'supabase') {
          throw new Error(dbResult.error || 'Não foi possível conectar ao Supabase. O painel não será salvo no LocalStorage.');
        }
      }

      // Set username
      const username = window.ntAuth?.getUsername() || 'admin';
      const el = document.getElementById('sidebar-username');
      const avatar = document.getElementById('sidebar-avatar');
      if (el) el.textContent = username;
      if (avatar) avatar.textContent = username.charAt(0).toUpperCase();

      // Load data. Os produtos vêm com force para o painel abrir mostrando o
      // estado real do servidor, não o snapshot em cache do navegador.
      allProducts = await window.ntDB?.products.reload() || [];
      allOrders = await window.ntDB?.orders.getAll() || [];
      await refreshLeads(false);
      loadCategories().catch(e => console.warn('Falha ao inicializar categorias:', e));
      syncImagesInBackground();

      // Load overview
      loadOverview();

    // Mobile sidebar toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-button');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.querySelector('.mobile-sidebar-backdrop');
    if (mobileMenuBtn && sidebar && backdrop) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = sidebar.classList.toggle('mobile-open');
        backdrop.classList.toggle('open', isOpen);
        mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
        document.body.classList.toggle('admin-menu-open', isOpen);
      });
      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
        backdrop.classList.remove('open');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('admin-menu-open');
      });
    }

    // Desktop sidebar collapse/expand toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const adminMain = document.querySelector('.admin-main');
    if (sidebarToggle && sidebar && adminMain) {
      sidebarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = sidebar.classList.toggle('collapsed');
        adminMain.classList.toggle('sidebar-collapsed', isCollapsed);
        sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    // Nav items - event delegation (works with inline onclick as fallback)
    const sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
      sidebarNav.addEventListener('click', (e) => {
        const navItem = e.target.closest('.nav-item');
        if (navItem && !navItem.classList.contains('nav-section-label')) {
          const panelId = navItem.dataset.panel;
          if (panelId) showPanel(panelId, navItem);
        }
      });
    }

  } catch (error) {
    console.error('Erro ao inicializar admin:', error);
    showToast('!', 'Erro ao carregar painel', error.message);
  } finally {
    cancelLoader();
  }
  }

  // ══════════════════════════════════════════
  //  WHATSAPP LEADS
  // ══════════════════════════════════════════
  function unreadLeads() {
    return allLeads.filter(lead => !lead.readAt).length;
  }

  function updateLeadNotifications() {
    const count = unreadLeads();
    ['leads-nav-badge', 'leads-topbar-badge'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.hidden = count === 0;
      badge.textContent = count > 99 ? '99+' : String(count);
    });
    document.getElementById('leads-topbar-button')?.classList.toggle('has-notifications', count > 0);
  }

  function leadInterest(lead) {
    if (lead.productName) return lead.productBrand ? `${lead.productBrand} — ${lead.productName}` : lead.productName;
    if (lead.type === 'atendimento') return 'Atendimento geral';
    if (lead.type === 'carrinho') return `${lead.itemCount || ''} item(ns) no carrinho`;
    return 'Contato pelo site';
  }

  function renderLeadsTable() {
    const tbody = document.getElementById('leads-tbody');
    if (!tbody) return;
    const filter = document.getElementById('lead-filter-status')?.value || '';
    const leads = [...allLeads]
      .filter(lead => !filter || lead.status === filter)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><p>Nenhum lead encontrado</p><small>Os contatos iniciados pelo WhatsApp aparecerão aqui.</small></div></td></tr>';
      return;
    }
    tbody.innerHTML = leads.map(lead => `
      <tr>
        <td><strong style="color:var(--text-primary); font-weight:500;">${escHtml(lead.client || 'Novo contato')}</strong><br><span style="font-size:11px;color:var(--text-muted);">${escHtml(lead.page || 'Site')}</span></td>
        <td>${escHtml(leadInterest(lead))}${lead.value ? `<br><span style="font-size:11px;color:var(--text-muted);">${escHtml(lead.value)}</span>` : ''}</td>
        <td><span class="badge badge-info">WhatsApp</span></td>
        <td><select class="admin-select" style="font-size:10px; padding:4px 24px 4px 6px;" onchange="updateLeadStatus('${escHtml(lead.id)}', this.value)">${['novo','em_atendimento','convertido','arquivado'].map(status => `<option value="${status}" ${lead.status === status ? 'selected' : ''}>${status === 'em_atendimento' ? 'Em atendimento' : status.charAt(0).toUpperCase() + status.slice(1)}</option>`).join('')}</select></td>
        <td style="font-size:11px;">${fmt.date(lead.createdAt)}</td>
      </tr>`).join('');
  }

  async function markLeadsRead() {
    const unread = allLeads.filter(lead => !lead.readAt);
    if (!unread.length) return;
    const readAt = new Date().toISOString();
    unread.forEach(lead => { lead.readAt = readAt; });
    updateLeadNotifications();
    try { await Promise.all(unread.map(lead => window.ntDB.leads.update(lead.id, { readAt }))); }
    catch (error) { console.warn('Não foi possível confirmar a leitura dos leads:', error); }
  }

  window.refreshLeads = async function (manual = false) {
    try {
      const leads = await window.ntDB?.leads?.getAll() || [];
      const ids = new Set(leads.map(lead => lead.id));
      const newLeads = leads.filter(lead => !knownLeadIds.has(lead.id));
      allLeads = leads;
      knownLeadIds = ids;
      updateLeadNotifications();
      renderLeadsTable();
      if (leadsInitialized && newLeads.length) showToast('bell', `${newLeads.length} novo${newLeads.length > 1 ? 's' : ''} lead${newLeads.length > 1 ? 's' : ''}`, leadInterest(newLeads[0]));
      if (manual) showToast('info', 'Leads atualizados', `${leads.length} contato(s) registrado(s)`);
      leadsInitialized = true;
    } catch (error) {
      console.warn('Não foi possível carregar os leads:', error);
      if (manual) showToast('error', 'Falha ao atualizar leads', 'Verifique a conexão do banco de dados.');
    }
  };

  window.filterLeads = renderLeadsTable;
  window.updateLeadStatus = async function (id, status) {
    const lead = allLeads.find(item => item.id === id);
    if (!lead) return;
    try {
      await window.ntDB.leads.update(id, { status });
      lead.status = status;
      renderLeadsTable();
      showToast('check', 'Lead atualizado', status === 'em_atendimento' ? 'Em atendimento' : status);
    } catch (error) { showToast('error', 'Não foi possível atualizar o lead', error.message); }
  };

  // ══════════════════════════════════════════
  //  OVERVIEW PANEL
  // ══════════════════════════════════════════

  async function loadOverview() {
    const totalRevenue = allOrders
      .filter(o => o.status !== 'cancelado')
      .reduce((sum, o) => sum + fmt.parsePrice(o.value), 0);

    const activeProducts = allProducts.filter(p => p.active !== false).length;
    const ticketMedio = allOrders.length > 0 ? totalRevenue / allOrders.filter(o => o.status !== 'cancelado').length : 0;

    // KPI Cards
    setText('kpi-revenue', fmt.currency(totalRevenue));
    setText('kpi-orders', allOrders.length);
    setText('kpi-products', activeProducts);
    setText('kpi-ticket', fmt.currency(ticketMedio));

    // Month orders trend
    const thisMonth = allOrders.filter(o => {
      const d = new Date(o.createdAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    setText('kpi-orders-trend', `${thisMonth} este mês`);

    // Revenue chart
    await drawRevenueChart('revenue-chart');

    // Recent orders
    renderRecentOrders();
  }

  function getOrderThumbnail(o) {
    if (!o) return '';
    let found = '';
    if (o.imageUrl && typeof o.imageUrl === 'string' && o.imageUrl.trim() !== '') {
      found = o.imageUrl;
    } else if (Array.isArray(o.items) && o.items[0]?.image) {
      found = o.items[0].image;
    } else if (o.productId && allProducts.length) {
      const p = allProducts.find(x => String(x.id) === String(o.productId));
      if (p) found = p.image || (Array.isArray(p.images) && p.images[0]) || '';
    } else if (o.productName && allProducts.length) {
      const p = allProducts.find(x => x.name && x.name.toLowerCase() === o.productName.toLowerCase());
      if (p) found = p.image || (Array.isArray(p.images) && p.images[0]) || '';
    }
    return found ? (typeof resolveAdminProductImg === 'function' ? resolveAdminProductImg(found) : found) : '';
  }

  function renderRecentOrders() {
    const tbody = document.getElementById('recent-orders-body');
    if (!tbody) return;

    const recent = [...allOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>Nenhum pedido registrado</p><small>Registre o primeiro pedido na seção Pedidos</small></div></td></tr>`;
      return;
    }

    tbody.innerHTML = recent.map(o => {
      const code = escHtml(o.code || ('#NTE-' + String(o.id).slice(-4).toUpperCase()));
      const thumb = getOrderThumbnail(o);
      const thumbHtml = thumb
        ? `<img src="${escHtml(thumb)}" alt="" style="width:36px; height:36px; border-radius:6px; object-fit:cover; border:1px solid rgba(201,168,76,0.3); background:#111; cursor:pointer;" onclick="window.open('${escHtml(thumb)}', '_blank')" onerror="this.onerror=null; this.src='../assets/images/logo.png'; this.style.opacity='0.4';" />`
        : `<div style="width:36px; height:36px; border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
      return `
        <tr onclick="openOrderModal('${escHtml(o.id)}')" style="cursor:pointer;" title="Clique para ver os detalhes do pedido">
          <td><span class="badge badge-gold" style="font-family:monospace; font-size:11px; font-weight:700;">${code}</span></td>
          <td>${thumbHtml}</td>
          <td style="color:var(--text-primary); font-weight:500;">${escHtml(o.client || '—')}</td>
          <td>${escHtml(o.productName || '—')}</td>
          <td style="color:var(--gold); font-weight:600;">${escHtml(o.value || '—')}</td>
          <td>${statusBadge(o.status)}</td>
          <td>${fmt.date(o.createdAt)}</td>
        </tr>
      `;
    }).join('');
  }

  // ══════════════════════════════════════════
  //  FINANCEIRO PANEL
  // ══════════════════════════════════════════

  async function loadFinanceiro() {
    const now = new Date();
    const confirmed = allOrders.filter(o => o.status === 'confirmado' || o.status === 'enviado' || o.status === 'entregue');

    // This month revenue
    const mesRevenue = confirmed.filter(o => {
      const d = new Date(o.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((sum, o) => sum + fmt.parsePrice(o.value), 0);

    setText('fin-mes', fmt.currency(mesRevenue));
    setText('fin-confirmados', confirmed.length);

    // Top product
    const productCounts = {};
    allOrders.forEach(o => {
      if (o.productName) productCounts[o.productName] = (productCounts[o.productName] || 0) + 1;
    });
    const topProduct = Object.entries(productCounts).sort((a, b) => b[1] - a[1])[0];
    setText('fin-top', topProduct ? topProduct[0] : '—');

    // Chart
    await drawRevenueChart('fin-chart');

    // Status breakdown
    const statusBreak = document.getElementById('status-breakdown');
    const statuses = ['novo', 'confirmado', 'enviado', 'entregue', 'cancelado'];
    statusBreak.innerHTML = statuses.map(s => {
      const count = allOrders.filter(o => o.status === s).length;
      const pct = allOrders.length > 0 ? Math.round((count / allOrders.length) * 100) : 0;
      return `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${statusBadge(s)}
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex:1;">
            <div style="flex:1; height:4px; background:var(--border); border-radius:2px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:var(--gold); transition:width 0.5s ease;"></div>
            </div>
            <span style="font-size:12px; color:var(--text-secondary); min-width:30px; text-align:right;">${count}</span>
          </div>
        </div>
      `;
    }).join('');

    // Brand breakdown
    const brandBreak = document.getElementById('brand-breakdown');
    const brandCounts = {};
    allOrders.forEach(o => {
      if (o.productBrand) brandCounts[o.productBrand] = (brandCounts[o.productBrand] || 0) + 1;
    });
    const sorted = Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxCount = sorted[0]?.[1] || 1;
    brandBreak.innerHTML = sorted.length > 0
      ? sorted.map(([brand, count]) => `
          <div style="display:flex; align-items:center; gap:12px;">
            <span style="font-size:10px; text-transform:uppercase; letter-spacing:0.1em; color:var(--gold); min-width:120px;">${escHtml(brand)}</span>
            <div style="flex:1; height:4px; background:var(--border); border-radius:2px; overflow:hidden;">
              <div style="height:100%; width:${Math.round((count / maxCount) * 100)}%; background:linear-gradient(90deg, var(--gold-dark), var(--gold)); transition:width 0.5s ease;"></div>
            </div>
            <span style="font-size:12px; color:var(--text-secondary);">${count}</span>
          </div>
        `).join('')
      : '<div class="empty-state" style="padding:20px;"><small>Nenhum pedido ainda</small></div>';
  }

  // ── Revenue Chart ──
  let revenueChartInstance = null;
  let finChartInstance = null;
  let chartJsLoaded = false;
  let chartJsLoading = null;

  async function loadChartJs() {
    if (chartJsLoaded) return true;
    if (chartJsLoading) return chartJsLoading;

    chartJsLoading = (async () => {
      try {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Falha ao carregar Chart.js'));
          document.head.appendChild(script);
        });
        chartJsLoaded = true;
        return true;
      } catch (error) {
        console.warn('Chart.js não pôde ser carregado:', error);
        chartJsLoaded = false;
        return false;
      } finally {
        chartJsLoading = null;
      }
    })();

    return chartJsLoading;
  }

  async function drawRevenueChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Lazy-load Chart.js
    const loaded = await loadChartJs();
    if (!loaded) return;

    // Build last 6 months
    const months = [];
    const revenues = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
      const revenue = allOrders
        .filter(o => {
          const od = new Date(o.createdAt);
          return od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear() && o.status !== 'cancelado';
        })
        .reduce((sum, o) => sum + fmt.parsePrice(o.value), 0);
      revenues.push(revenue);
    }

    // Destroy existing
    if (canvasId === 'revenue-chart' && revenueChartInstance) { revenueChartInstance.destroy(); }
    if (canvasId === 'fin-chart' && finChartInstance) { finChartInstance.destroy(); }

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Receita (R$)',
          data: revenues,
          borderColor: '#c9a84c',
          backgroundColor: 'rgba(201, 168, 76, 0.08)',
          pointBackgroundColor: '#c9a84c',
          pointBorderColor: '#080808',
          pointBorderWidth: 2,
          pointRadius: 5,
          fill: true,
          tension: 0.4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#141414',
            borderColor: 'rgba(201,168,76,0.3)',
            borderWidth: 1,
            titleColor: '#c9a84c',
            bodyColor: '#8a8784',
            callbacks: {
              label: ctx => `R$ ${ctx.parsed.y.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(201,168,76,0.05)', borderColor: 'rgba(201,168,76,0.1)' },
            ticks: { color: '#4a4846', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(201,168,76,0.05)', borderColor: 'rgba(201,168,76,0.1)' },
            ticks: {
              color: '#4a4846',
              font: { size: 11 },
              callback: v => 'R$ ' + v.toLocaleString('pt-BR'),
            },
            beginAtZero: true,
          },
        },
      },
    });

    if (canvasId === 'revenue-chart') revenueChartInstance = chart;
    if (canvasId === 'fin-chart') finChartInstance = chart;
  }

  // ══════════════════════════════════════════
  //  PRODUCTS TABLE
  // ══════════════════════════════════════════

  window.filterProducts = function () {
    const search = (document.getElementById('product-search')?.value || '').toLowerCase();
    const brand = document.getElementById('product-filter-brand')?.value || '';
    const cat = document.getElementById('product-filter-cat')?.value || '';
    const status = document.getElementById('product-filter-status')?.value || '';

    const filtered = allProducts.filter(p => {
      const matchSearch = !search || [p.name, p.brand, p.desc].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(search);
      const matchBrand = !brand || p.brand === brand;
      const matchCat = !cat || productCategory(p) === cat;
      const matchStatus = !status
        || (status === 'active' && p.active !== false)
        || (status === 'inactive' && p.active === false)
        || (status === 'featured' && (p.featured || p.destaque));
      return matchSearch && matchBrand && matchCat && matchStatus;
    });

    setText('products-result-count', `${filtered.length} ${filtered.length === 1 ? 'resultado' : 'resultados'}`);
    const clearButton = document.getElementById('product-clear-filters');
    if (clearButton) clearButton.hidden = !(search || brand || cat || status);

    // Reset to first page when filters change
    productCurrentPage = 1;
    renderProductsTableData(filtered);
    updatePaginationControls(filtered.length);
  };

  window.clearProductFilters = function () {
    ['product-search', 'product-filter-brand', 'product-filter-cat', 'product-filter-status'].forEach(id => {
      const field = document.getElementById(id);
      if (field) field.value = '';
    });
    filterProducts();
  };

  function renderProductsTable() {
    // Populate brand filter
    const brandFilter = document.getElementById('product-filter-brand');
    if (brandFilter) {
      const brands = [...new Set(allProducts.map(p => p.brand))].sort();
      brandFilter.innerHTML = `<option value="">Todas as marcas</option>` + brands.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
    }
    setText('products-summary-total', allProducts.length);
    setText('products-summary-active', allProducts.filter(p => p.active !== false).length);
    setText('products-summary-featured', allProducts.filter(p => p.featured || p.destaque).length);
    setText('products-summary-inactive', allProducts.filter(p => p.active === false).length);
    filterProducts();
  }

  async function syncProducts(showLoaderFlag = false, options = {}) {
    if (showLoaderFlag) scheduleLoader();
    try {
      // `force` desliga o cache: um produto salvo (ou alterado em outro
      // dispositivo) precisa aparecer na tabela, não o que está em memória.
      allProducts = options.force
        ? await window.ntDB?.products.reload() || []
        : await window.ntDB?.products.getAll() || [];
      renderProductsTable();
      setText('kpi-products', allProducts.filter(p => p.active !== false).length);
    } finally {
      if (showLoaderFlag) cancelLoader();
    }
  }

  async function refreshOrders() {
    try {
      allOrders = await window.ntDB?.orders.getAll() || [];
    } catch (error) {
      console.warn('Não foi possível carregar os pedidos:', error);
      showToast('!', 'Falha ao carregar pedidos', error.message);
      return;
    }
    renderOrdersTable();
    loadOverview();
    if (typeof aggregateCustomersFromOrders === 'function') {
      allCustomers = aggregateCustomersFromOrders(allOrders);
      updateCustomersKpis(allCustomers);
    }
  }

  // ── Resolução e Fallback Resiliente de Imagens do Catálogo ──
  const VPS_IMG_BASE = 'https://137-131-233-254.sslip.io/nteleganz/uploads/';
  const HOSTINGER_IMG_BASE = 'https://nteleganz.com.br/assets/images/products/';
  const PLACEHOLDER_IMG = '/assets/images/placeholder-product.svg';

  function resolveAdminProductImg(raw) {
    if (!raw || typeof raw !== 'string') return PLACEHOLDER_IMG;
    const trimmed = raw.trim();
    if (!trimmed) return PLACEHOLDER_IMG;
    if (trimmed.startsWith('data:image/')) return trimmed;
    // Normaliza qualquer URL da VPS ou de terceiros para o domínio oficial de 1º nível da NT Eleganz
    const match = trimmed.match(/([a-zA-Z0-9_\-\.]+\.webp)/i);
    if (match) {
      return HOSTINGER_IMG_BASE + match[1];
    }
    return trimmed;
  }

  window.handleAdminThumbError = function (img) {
    if (!img) return;
    const currentSrc = img.src || '';
    const match = currentSrc.match(/([a-zA-Z0-9_\-\.]+\.webp)/i);
    const filename = match ? match[1] : '';

    // Tentativa 1: se falhou no domínio principal (Hostinger), tenta a VPS
    if (filename && !img.dataset.triedVps) {
      img.dataset.triedVps = '1';
      img.src = VPS_IMG_BASE + filename;
      return;
    }

    // Tentativa 2: fallback visual com o placeholder oficial elegante da NT Eleganz
    img.onerror = null;
    img.src = PLACEHOLDER_IMG;
    img.style.objectFit = 'contain';
    img.style.background = '#18181b';
    img.title = 'Foto temporariamente indisponível - clique em Editar para atualizar';
  };

  // ── Dicas e Validação Inteligente de Estoque no Painel ──
  window.updateStockHint = function () {
    const stockInput = document.getElementById('p-stock');
    const hint = document.getElementById('p-stock-hint');
    const activeSelect = document.getElementById('p-active');
    if (!stockInput || !hint) return;

    const val = Number(stockInput.value);
    const isActive = activeSelect?.value === 'true';

    if (stockInput.value !== '' && val <= 0) {
      hint.innerHTML = `<span style="color:#ef4444; font-weight:600;">⚠️ Atenção: Com estoque 0, o produto será exibido com selo de ESGOTADO na loja.</span>`;
    } else if (val > 0) {
      hint.innerHTML = `<span style="color:#22c55e; font-weight:600;">✅ Em estoque (${val} ${val === 1 ? 'unidade' : 'unidades'}) — Disponível para compra imediata.</span>`;
    } else {
      hint.textContent = 'Estoque disponível para venda. Use 0 apenas se o produto estiver esgotado.';
    }
  };

  window.handleActiveStatusChange = function () {
    const activeSelect = document.getElementById('p-active');
    const stockInput = document.getElementById('p-stock');
    if (!activeSelect || !stockInput) return;

    if (activeSelect.value === 'true') {
      const currentStock = Number(stockInput.value);
      // Se o usuário ativar o produto e o estoque estiver zerado ou vazio,
      // define automaticamente como 1 para evitar que fique como 'ESGOTADO' por acidente!
      if (!stockInput.value || currentStock <= 0) {
        stockInput.value = '1';
        stockInput.style.borderColor = '#22c55e';
        setTimeout(() => { if (stockInput) stockInput.style.borderColor = ''; }, 1200);
      }
    }
    window.updateStockHint();
  };

  function renderProductsTableData(products) {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    if (products.length === 0) {
      const hasFilters = ['product-search', 'product-filter-brand', 'product-filter-cat', 'product-filter-status'].some(id => document.getElementById(id)?.value);
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/></svg><p>${hasFilters ? 'Nenhum produto corresponde aos filtros' : 'Seu catálogo está vazio'}</p><small>${hasFilters ? 'Ajuste ou limpe os filtros para ver outros itens.' : 'Crie o primeiro produto para publicá-lo na loja.'}</small>${hasFilters ? '<button class="btn btn-secondary btn-sm empty-state__action" onclick="clearProductFilters()">Limpar filtros</button>' : '<button class="btn btn-primary btn-sm empty-state__action" onclick="openProductModal()">Criar produto</button>'}</div></td></tr>`;
      updatePaginationControls(0);
      return;
    }

    // Pagination
    const start = (productCurrentPage - 1) * productPageSize;
    const end = start + productPageSize;
    const pageProducts = products.slice(start, end);

    tbody.innerHTML = pageProducts.map(p => {
      const isOutOfStock = (p.stock !== undefined && Number(p.stock) <= 0) || p.inStock === false || p.available === false;
      const imgSrc = resolveAdminProductImg(p.image);
      return `
      <tr data-id="${p.id}">
        <td>
          <div style="position:relative; display:inline-block;">
            <img class="product-thumb ${isOutOfStock ? 'is-out-of-stock' : ''}" src="${escHtml(imgSrc)}" alt="${escHtml(p.name)}"
              style="${isOutOfStock ? 'filter: grayscale(100%); opacity: 0.55;' : ''}"
              onerror="window.handleAdminThumbError(this);" />
            ${isOutOfStock ? '<span style="position:absolute; bottom:2px; left:50%; transform:translateX(-50%); background:#dc2626; color:#fff; font-size:8px; font-weight:800; padding:1px 4px; border-radius:3px; letter-spacing:0.5px; white-space:nowrap; box-shadow:0 1px 3px rgba(0,0,0,0.4); text-transform:uppercase;">ESGOTADO</span>' : ''}
          </div>
        </td>
        <td>
          <div class="table-brand">${escHtml(p.brand || '—')}</div>
          <div class="table-name">${escHtml(p.name || '—')}</div>
        </td>
        <td>
          <span style="color:var(--text-primary); font-weight:600;">${escHtml(p.price || '—')}</span>
          ${p.oldPrice ? `<br><span style="font-size:11px; color:var(--text-muted); text-decoration:line-through;">${escHtml(p.oldPrice)}</span>` : ''}
        </td>
        <td>${escHtml(categoryLabel(productCategory(p)))}</td>
        <td>
          ${p.featured ? '<span class="badge badge-gold" title="Mais Vendidos"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:2px;"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>Mais</span> ' : ''}
          ${p.destaque ? '<span class="badge badge-gold" title="Destaque"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:middle;margin-right:2px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>Dest.</span>' : ''}
          ${!p.featured && !p.destaque ? '<span style="color:var(--text-muted);font-size:11px;">—</span>' : ''}
        </td>
        <td>
          ${isOutOfStock
            ? '<span class="badge" style="background:#dc2626; color:#fff; font-weight:700; text-transform:uppercase;">ESGOTADO</span>'
            : (p.active !== false
                ? '<span class="badge badge-success">Ativo</span>'
                : '<span class="badge badge-muted">Inativo</span>')}
          ${isOutOfStock && p.active === false ? '<br><span class="badge badge-muted" style="margin-top:4px;">Inativo</span>' : ''}
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-secondary btn-sm btn-icon-only" type="button" onclick="editProduct(this.dataset.productId)" data-product-id="${escHtml(p.id)}" title="Editar" aria-label="Editar ${escHtml(p.name || 'produto')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-danger btn-sm btn-icon-only" type="button" onclick="deleteProduct(this.dataset.productId)" data-product-id="${escHtml(p.id)}" title="Excluir definitivamente" aria-label="Excluir ${escHtml(p.name || 'produto')} definitivamente">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
            </button>
          </div>
        </td>
      </tr>
      `;
    }).join('');

    updatePaginationControls(products.length);
  }

  function updatePaginationControls(totalItems) {
    const totalPages = Math.ceil(totalItems / productPageSize) || 1;
    const prevBtn = document.getElementById('pagination-prev');
    const nextBtn = document.getElementById('pagination-next');
    const info = document.getElementById('pagination-info');

    if (prevBtn) {
      prevBtn.disabled = productCurrentPage <= 1;
      prevBtn.style.display = totalPages <= 1 ? 'none' : 'inline-flex';
    }
    if (nextBtn) {
      nextBtn.disabled = productCurrentPage >= totalPages;
      nextBtn.style.display = totalPages <= 1 ? 'none' : 'inline-flex';
    }
    if (info) {
      if (totalPages <= 1) {
        info.textContent = `Exibindo todos os ${totalItems} produtos em página única`;
      } else {
        info.textContent = `Página ${productCurrentPage} de ${totalPages} (${totalItems} itens)`;
      }
    }
  }

  window.changeProductPage = function (delta) {
    const totalItems = parseInt(document.getElementById('pagination-info')?.textContent?.match(/\((\d+) itens\)/)||[0,0])[1] || 0;
    const totalPages = Math.ceil(totalItems / productPageSize) || 1;
    const newPage = productCurrentPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
      productCurrentPage = newPage;
      filterProducts(); // Re-render with new page
    }
  };

  window.changeProductPageSize = function (size) {
    productPageSize = parseInt(size, 10);
    productCurrentPage = 1;
    filterProducts();
  };

  // ── Diferenciação Automática de Nomes e Slugs de Produtos ──
  function adminSlugify(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getDifferentiatedProductName(rawName, excludeId = null) {
    if (!rawName || typeof rawName !== 'string') return '';
    const trimmed = rawName.trim();
    if (!trimmed) return '';

    const others = (allProducts || []).filter(p => !excludeId || String(p.id) !== String(excludeId));

    // Se o nome não colide com nenhum outro produto, mantém como digitado
    const exactMatch = others.some(p => (p.name || '').trim().toLowerCase() === trimmed.toLowerCase());
    if (!exactMatch) {
      return trimmed;
    }

    // Se já existe colisão exata, extrai a raiz do nome sem o número final
    const match = trimmed.match(/^(.*?)(?:\s+(\d+))?$/);
    const baseName = (match && match[1]) ? match[1].trim() : trimmed;

    // Encontra o maior número já atribuído a essa base
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const baseRegex = new RegExp('^' + escapedBase + '(?:\\s+(\\d+))?$', 'i');

    let maxNum = 1;
    others.forEach(p => {
      const pName = (p.name || '').trim();
      const m = pName.match(baseRegex);
      if (m) {
        const num = m[1] ? parseInt(m[1], 10) : 1;
        if (num >= maxNum) {
          maxNum = num;
        }
      }
    });

    const nextNum = maxNum + 1;
    return `${baseName} ${nextNum}`;
  }

  function setupProductNameInput() {
    const input = document.getElementById('p-name');
    if (!input || input._differentiatedBound) return;
    input._differentiatedBound = true;

    input.addEventListener('blur', function () {
      const val = input.value;
      const editId = document.getElementById('product-edit-id')?.value || null;
      const diff = getDifferentiatedProductName(val, editId);
      if (diff && diff !== val.trim()) {
        input.value = diff;
        showToast('info', 'Nome ajustado', `Nome diferenciado para "${diff}" para evitar duplicidade no catálogo.`);
      }
    });
  }

  window.getDifferentiatedProductName = getDifferentiatedProductName;

  // ── Product Modal ──
  window.openProductModal = function (productId = null) {
    setupProductNameInput();
    syncCategoryDropdowns();
    editingSizes = [];
    editingColors = [];
    pendingImages = [];

    document.getElementById('product-edit-id').value = productId || '';
    document.getElementById('product-modal-title').textContent = productId ? 'Editar Produto' : 'Novo Produto';

    // Clear form
    ['p-brand', 'p-name', 'p-price', 'p-old-price', 'p-badge', 'p-desc', 'p-image-url'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('p-category').value = allCategories[0]?.id || 'camisetas';
    document.getElementById('p-stock').value = '1'; // Padrão seguro de 1 unidade para produtos novos
    document.getElementById('p-active').value = 'true';
    renderImagePreviews();
    updateSizeSuggestions();
    const pFeat = document.getElementById('p-featured');
    const pDest = document.getElementById('p-destaque');
    if (pFeat) pFeat.checked = false;
    if (pDest) pDest.checked = false;

    clearTagsInput('sizes');
    clearTagsInput('colors');

    setupPriceInput('p-price');
    setupPriceInput('p-old-price');

    if (productId) {
      const p = allProducts.find(p => p.id === productId);
      if (p) fillProductForm(p);
    } else {
      if (window.updateStockHint) window.updateStockHint();
    }

    // Apply modern minimalist styles (matching order modals)
    const modal = document.getElementById('product-modal');
    if (modal) {
      modal.classList.add('open');
      modal.style.cssText = `
        position: fixed !important;
        inset: 0 !important;
        z-index: 9999 !important;
        background: rgba(0, 0, 0, 0.55) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: clamp(16px, 4vw, 24px) !important;
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;
        animation: fadeIn 0.2s ease-out !important;
      `;
      
      const modalChild = modal.querySelector('.modal');
      if (modalChild) {
        modalChild.style.cssText = `
          background: var(--bg-surface, #0f0f0f) !important;
          border: 1px solid var(--border, rgba(201, 168, 76, 0.3)) !important;
          border-radius: 16px !important;
          max-width: min(900px, 95vw) !important;
          width: 100% !important;
          max-height: min(90vh, 820px) !important;
          overflow: hidden !important;
          box-shadow: 
            0 4px 24px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(201, 168, 76, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
          color: var(--text-primary, #f2efe9) !important;
          animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
          display: flex !important;
          flex-direction: column !important;
        `;
        
        // Style header
        const header = modalChild.querySelector('.modal-header');
        if (header) {
          header.style.cssText = `
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 18px 24px !important;
            border-bottom: 1px solid var(--border, rgba(201, 168, 76, 0.2)) !important;
            background: rgba(201, 168, 76, 0.03) !important;
            flex-shrink: 0 !important;
          `;
          const title = header.querySelector('.modal-title');
          if (title) {
            title.style.cssText = `
              margin: 0 !important;
              font-size: 1.05rem !important;
              font-weight: 600 !important;
              color: var(--text-primary, #f2efe9) !important;
              letter-spacing: 0.01em !important;
            `;
          }
          const closeBtn = header.querySelector('.modal-close');
          if (closeBtn) {
            closeBtn.style.cssText = `
              width: 36px !important;
              height: 36px !important;
              border: none !important;
              border-radius: 10px !important;
              background: var(--bg-hover, rgba(255,255,255,0.04)) !important;
              color: var(--text-muted, #888) !important;
              font-size: 1.35rem !important;
              cursor: pointer !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              transition: all 0.15s ease !important;
            `;
            closeBtn.setAttribute('onmouseover', "this.style.background='var(--bg-hover,rgba(255,255,255,0.08))'");
            closeBtn.setAttribute('onmouseout', "this.style.background='var(--bg-hover,rgba(255,255,255,0.04))'");
          }
        }
        
        // Style body (make scrollable)
        const body = modalChild.querySelector('.modal-body');
        if (body) {
          body.style.cssText = `
            flex: 1 !important;
            overflow-y: auto !important;
            overflow-x: hidden !important;
            padding: 24px !important;
            min-height: 0 !important;
          `;
        }
        
        // Style footer
        const footer = modalChild.querySelector('.modal-footer');
        if (footer) {
          footer.style.cssText = `
            display: flex !important;
            justify-content: flex-end !important;
            gap: 12px !important;
            padding: 18px 24px !important;
            border-top: 1px solid var(--border, rgba(201, 168, 76, 0.2)) !important;
            background: rgba(201, 168, 76, 0.03) !important;
            flex-shrink: 0 !important;
          `;
          const cancelBtn = footer.querySelector('.btn-secondary');
          if (cancelBtn) {
            cancelBtn.style.cssText = `
              padding: 12px 24px !important;
              border: 1px solid rgba(201, 168, 76, 0.2) !important;
              border-radius: 10px !important;
              background: transparent !important;
              color: #bbb !important;
              cursor: pointer !important;
              font-size: .9rem !important;
              font-weight: 500 !important;
              transition: all 0.15s ease !important;
            `;
            cancelBtn.setAttribute('onmouseover', "this.style.borderColor='#c9a84c'; this.style.color='#c9a84c'");
            cancelBtn.setAttribute('onmouseout', "this.style.borderColor='rgba(201, 168, 76, 0.2)'; this.style.color='#bbb'");
          }
          const saveBtn = footer.querySelector('#product-save-button, .btn-primary');
          if (saveBtn) {
            saveBtn.style.cssText = `
              padding: 12px 24px !important;
              border: none !important;
              border-radius: 10px !important;
              background: #c9a84c !important;
              color: #0f0f0f !important;
              font-weight: 600 !important;
              cursor: pointer !important;
              font-size: .9rem !important;
              box-shadow: 0 2px 8px rgba(201, 168, 76, 0.3) !important;
              transition: background-color 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease !important;
            `;
            saveBtn.setAttribute('onmouseover', "this.style.backgroundColor='#b8963e'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 16px rgba(201,168,76,0.4)'");
            saveBtn.setAttribute('onmouseout', "this.style.backgroundColor='#c9a84c'; this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 8px rgba(201,168,76,0.3)'");
          }
        }
      }
    }
  };

  function fillProductForm(p) {
    setValue('p-brand', p.brand);
    setValue('p-name', p.name);
    setValue('p-price', p.price && !String(p.price).startsWith('R$') ? 'R$ ' + String(p.price).replace(/^R\$\s*/, '') : p.price);
    setValue('p-old-price', p.oldPrice && !String(p.oldPrice).startsWith('R$') ? 'R$ ' + String(p.oldPrice).replace(/^R\$\s*/, '') : p.oldPrice || '');
    setValue('p-badge', p.badge || '');
    setValue('p-desc', p.desc || '');
    setValue('p-category', productCategory(p));
    setValue('p-stock', Number.isFinite(Number(p.stock)) ? p.stock : 1);
    setValue('p-active', String(p.active !== false));

    // Images: Normaliza URLs legadas/VPS para a URL canônica oficial
    const rawImages = (Array.isArray(p.images) && p.images.length ? p.images : [p.image]).filter(Boolean);
    pendingImages = [...new Set(rawImages.map(resolveAdminProductImg))];
    setValue('p-image-url', pendingImages.filter(image => !image.startsWith('data:image/')).join('\n'));
    renderImagePreviews();

    // Sizes
    editingSizes = Array.isArray(p.sizes) ? [...p.sizes] : [];
    renderTags('sizes', editingSizes);
    updateSizeSuggestions();

    // Colors
    editingColors = Array.isArray(p.colors) ? [...p.colors] : [];
    renderTags('colors', editingColors);

    // Sections
    const pFeat = document.getElementById('p-featured');
    const pDest = document.getElementById('p-destaque');
    if (pFeat) pFeat.checked = !!p.featured;
    if (pDest) pDest.checked = !!p.destaque;

    if (window.updateStockHint) window.updateStockHint();
  }

  window.closeProductModal = function () {
    const modal = document.getElementById('product-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.style.cssText = '';
      const modalChild = modal.querySelector('.modal');
      if (modalChild) modalChild.style.cssText = '';
    }
  };

  window.saveProduct = async function () {
    const id = document.getElementById('product-edit-id').value;
    syncImageUrls();

    const productId = id || (Date.now().toString(36) + Math.random().toString(36).slice(2));
    const saveButton = document.getElementById('product-save-button');
    const storedImages = [];
    for (let i = 0; i < pendingImages.length; i++) {
      const image = pendingImages[i];
      if (typeof image === 'string' && image.startsWith('data:image/')) {
        try {
          if (saveButton) { saveButton.disabled = true; saveButton.textContent = `Enviando foto ${i + 1} de ${pendingImages.length}…`; }
          const uploadedUrl = await uploadProductImage(image, productId, i);
          storedImages.push(uploadedUrl);
        } catch (error) {
          console.error(`Erro ao subir foto ${i + 1}:`, error);
          alert(`Não foi possível enviar a foto ${i + 1}: ${error.message}\nVerifique sua conexão ou tente novamente. O produto não foi salvo para evitar imagens quebradas.`);
          if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Salvar Produto'; }
          return;
        }
      } else if (typeof image === 'string' && image.trim().length > 0) {
        if (!image.startsWith('data:image/')) {
          storedImages.push(image.trim());
        }
      }
    }

    const rawName = getVal('p-name');
    const finalName = getDifferentiatedProductName(rawName, id);
    const finalSlug = adminSlugify(finalName);
    if (finalName && finalName !== rawName.trim()) {
      setValue('p-name', finalName);
    }

    const rawStock = getVal('p-stock');
    let stockNum = Number(rawStock);
    const isActive = getVal('p-active') === 'true';

    // Proteção definitiva: se o status for Ativo mas o estoque for 0,
    // confirma a intenção do dono para evitar esgotamento/inativação acidental
    if (isActive && stockNum === 0) {
      const confirmZero = confirm(
        'Atenção:\n\n' +
        'O status deste produto está como "Ativo", mas o estoque está definido como 0.\n' +
        'Isso fará o produto aparecer com o selo vermelho de "ESGOTADO" na vitrine da loja.\n\n' +
        'Deseja colocar Estoque = 1 para deixá-lo disponível para venda agora?\n\n' +
        '• Clique em OK para colocar Estoque = 1 (Disponível para venda)\n' +
        '• Clique em Cancelar para manter Estoque = 0 (Esgotado)'
      );
      if (confirmZero) {
        stockNum = 1;
        setValue('p-stock', 1);
        if (window.updateStockHint) window.updateStockHint();
      }
    }

    // Normaliza todas as imagens salvas para o domínio oficial de 1º nível (nteleganz.com.br)
    const normalizedImages = storedImages.map(resolveAdminProductImg);

    const productData = {
      id: productId,
      brand: getVal('p-brand'),
      name: finalName,
      price: getVal('p-price'),
      oldPrice: getVal('p-old-price') || null,
      badge: getVal('p-badge') || null,
      desc: getVal('p-desc'),
      category: getVal('p-category'),
      stock: stockNum,
      inStock: stockNum > 0,
      available: isActive && stockNum > 0,
      priceNum: fmt.parsePrice(getVal('p-price')),
      active: isActive,
      sizes: [...editingSizes],
      colors: [...editingColors],
      image: normalizedImages[0] || '',
      images: [...normalizedImages],
      slug: finalSlug,
      featured: document.getElementById('p-featured')?.checked || false,
      destaque: document.getElementById('p-destaque')?.checked || false,
    };

    if (!productData.brand || !productData.name || !productData.price || getVal('p-stock') === '' || !Number.isInteger(productData.stock) || productData.stock < 0) {
      alert('Preencha Marca, Nome, Preço e um estoque válido (zero ou maior).');
      return;
    }

    try {
      if (saveButton) { saveButton.disabled = true; saveButton.textContent = 'Salvando produto…'; }
      let savedProduct;
      if (id) {
        savedProduct = await window.ntDB.products.update(id, productData);
      } else {
        savedProduct = await window.ntDB.products.add(productData);
      }

      closeProductModal();
      // Aplica na hora o registro devolvido pela API, inclusive no update: sem
      // isso a linha antiga continuava na tela até o próximo sync.
      if (savedProduct) {
        if (id) {
          allProducts = allProducts.map(p => (p.id === id ? savedProduct : p));
        } else {
          allProducts = [savedProduct, ...allProducts.filter(p => p.id !== savedProduct.id)];
        }
      }
      if (!id) clearProductFilters();
      try {
        await syncProducts(true, { force: true });
      } catch (syncError) {
        renderProductsTable();
        console.warn('Produto salvo, mas a lista não pôde ser sincronizada:', syncError);
      }
      showToast('check', id ? 'Produto atualizado!' : 'Produto adicionado!', productData.name);
    } catch (e) {
      alert('Erro ao salvar produto: ' + e.message);
    } finally {
      const saveButton = document.getElementById('product-save-button');
      if (saveButton) { saveButton.disabled = false; saveButton.textContent = 'Salvar Produto'; }
    }
  };

  window.editProduct = function (id) {
    openProductModal(id);
  };

  window.deleteProduct = async function (id) {
    const p = allProducts.find(product => product.id === id);
    if (!p) { alert('Produto não encontrado.'); return; }
    try {
      await window.ntDB.products.delete(id);
      allProducts = allProducts.filter(product => product.id !== id);
      renderProductsTable();
      setText('kpi-products', allProducts.filter(product => product.active !== false).length);
      showToast('trash', 'Produto excluído', p.name || '');
    } catch (e) {
      console.error('Falha ao excluir produto:', e);
      alert('Não foi possível excluir: ' + e.message);
    }
  };

  // ── Tags Input ──
  window.addTag = function (e, type) {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const input = document.getElementById(type + '-input');
    const val = input.value.trim();
    if (!val) return;

    if (type === 'sizes') {
      editingSizes.push(val);
      renderTags('sizes', editingSizes);
      renderStockBySize();
    } else if (type === 'colors') {
      editingColors.push(val);
      renderTags('colors', editingColors);
    }
    input.value = '';
  };

  function renderTags(type, tags) {
    const container = document.getElementById(type + '-tags');
    const input = document.getElementById(type + '-input');
    const tagEls = container.querySelectorAll('.tag');
    tagEls.forEach(t => t.remove());

    tags.forEach((tag, i) => {
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = `${escHtml(tag)}<span class="tag-remove" onclick="removeTag('${type}', ${i})">×</span>`;
      container.insertBefore(el, input);
    });

    // Update color preview
    if (type === 'colors') {
      const preview = document.getElementById('color-chips-preview');
      if (preview) {
        preview.innerHTML = tags.map((c, i) => `
          <div class="color-chip" style="background:${escHtml(c)}; border-color:${escHtml(c)};" title="${escHtml(c)}">
            <span class="remove-chip" onclick="removeTag('colors', ${i})">×</span>
          </div>
        `).join('');
      }
    }
  }

  window.removeTag = function (type, idx) {
    if (type === 'sizes') {
      editingSizes.splice(idx, 1);
      renderTags('sizes', editingSizes);
    } else {
      editingColors.splice(idx, 1);
      renderTags('colors', editingColors);
    }
  };

  const SIZE_PRESETS = {
    camisetas: { label: 'Tamanhos',  options: ['PP', 'P', 'M', 'G', 'GG', 'XG'] },
    shorts: { label: 'Tamanhos', options: ['PP', 'P', 'M', 'G', 'GG', 'XG'] },
    hoodies: { label: 'Tamanhos', options: ['PP', 'P', 'M', 'G', 'GG', 'XG'] },
    calcados: { label: 'Numeração', options: ['33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'] },
  };

  function updateSizeSuggestions() {
    const container = document.getElementById('size-suggestions');
    if (!container) return;
    const category = document.getElementById('p-category')?.value || 'camisetas';
    const preset = SIZE_PRESETS[category] || SIZE_PRESETS.camisetas;
    const label = document.getElementById('sizes-label');
    if (label) label.textContent = `${preset.label} Disponíveis`;
    container.setAttribute('aria-label', `Sugestões de ${preset.label.toLowerCase()}`);
    container.innerHTML = preset.options.map(size => `<button type="button" class="size-suggestion" onclick="addSuggestedSize('${size}')">${size}</button>`).join('');
  }

  window.addSuggestedSize = function (size) {
    if (!editingSizes.includes(size)) editingSizes.push(size);
    renderTags('sizes', editingSizes);
  };

  function clearTagsInput(type) {
    const container = document.getElementById(type + '-tags');
    if (!container) return;
    container.querySelectorAll('.tag').forEach(t => t.remove());
    const input = document.getElementById(type + '-input');
    if (input) input.value = '';
    if (type === 'colors') {
      const prev = document.getElementById('color-chips-preview');
      if (prev) prev.innerHTML = '';
    }
  }

  // ── Image Upload ──
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  function resizeImageToWebP(dataUrl, maxSide = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          if (dataUrl.startsWith('data:image/webp') && img.naturalWidth <= maxSide && img.naturalHeight <= maxSide) {
            return resolve(dataUrl);
          }
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const width = Math.max(1, Math.round(img.naturalWidth * scale));
          const height = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/webp', quality));
        } catch (error) {
          reject(error);
        }
      };
      img.onerror = () => reject(new Error('Não foi possível decodificar a imagem para redimensionamento.'));
      img.src = dataUrl;
    });
  }

  async function getUploadAuthHeader() {
    try {
      const localToken = localStorage.getItem('nte_admin_token') || (window.ntAuth?.getToken && window.ntAuth.getToken());
      if (localToken) {
        return {
          Authorization: `Bearer ${localToken}`,
          'X-Upload-Token': localToken
        };
      }
      const client = window.ntAuth?.getClient && await window.ntAuth.getClient();
      const session = client?.auth?.getSession && await client.auth.getSession();
      const token = session?.data?.session?.access_token;
      return token ? {
        Authorization: `Bearer ${token}`,
        'X-Upload-Token': token
      } : null;
    } catch (error) {
      console.warn('Sem sessão para autenticar o upload:', error);
      return null;
    }
  }

  async function uploadProductImage(dataUrl, productId, index) {
    const uploadEndpoint = '/upload.php';
    const authHeader = await getUploadAuthHeader();
    const token = localStorage.getItem('nte_admin_token') || (window.ntAuth?.getToken && window.ntAuth.getToken()) || '';
    
    const headers = { 'Content-Type': 'application/json' };
    if (authHeader) Object.assign(headers, authHeader);
    
    const response = await fetch(uploadEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ image: dataUrl, productId, index, token })
    });
    
    const result = await response.json();
    
    if (!response.ok || result.error) {
      throw new Error(result.error || `Erro no upload (HTTP ${response.status})`);
    }
    
    return result.url;
  }

  function imageUrlsFromField() {
    return (document.getElementById('p-image-url')?.value || '')
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  }

  function syncImageUrls() {
    const existing = pendingImages.filter(image => typeof image === 'string' && image.trim().length > 0);
    const fromField = imageUrlsFromField();
    pendingImages = [...new Set([...existing, ...fromField])].slice(0, 8);
    renderImagePreviews();
  }

  function renderImagePreviews() {
    const grid = document.getElementById('img-preview-grid');
    if (!grid) return;
    grid.innerHTML = pendingImages.map((image, index) => {
      const displaySrc = resolveAdminProductImg(image);
      return `
      <div class="img-preview-item" style="position:relative;">
        <img src="${escHtml(displaySrc)}" alt="Foto ${index + 1} do produto" style="width:100%; height:100%; object-fit:cover; border-radius:8px;" onerror="window.handleAdminThumbError(this);" />
        ${index === 0 
          ? '<span class="img-preview-primary" style="position:absolute; top:6px; left:6px; bottom:auto !important; right:auto !important; width:auto !important; height:auto !important; display:inline-block !important; background:#c9a84c; color:#000; font-size:9px; font-weight:800; padding:3px 7px; border-radius:4px; text-transform:uppercase; z-index:2; line-height:1.2 !important; box-shadow:0 2px 4px rgba(0,0,0,0.3);">Principal</span>' 
          : `<button type="button" class="btn btn-secondary btn-sm" onclick="setPrimaryProductImage(${index})" style="position:absolute; bottom:6px; left:6px; font-size:10px; padding:2px 6px; height:auto; background:rgba(0,0,0,0.8); color:#c9a84c; border:1px solid rgba(201,168,76,0.5); border-radius:4px; cursor:pointer; z-index:2;" title="Definir como foto principal na vitrine">Tornar Principal</button>`}
        <button type="button" class="img-preview-remove" onclick="removeProductImage(${index})" aria-label="Remover foto ${index + 1}" title="Excluir foto" style="z-index:3;">×</button>
      </div>
      `;
    }).join('');
  }

  window.setPrimaryProductImage = function (index) {
    if (index <= 0 || index >= pendingImages.length) return;
    const [selected] = pendingImages.splice(index, 1);
    pendingImages.unshift(selected);
    renderImagePreviews();
  };

  window.handleImageUpload = async function (e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    if (pendingImages.length + files.length > 8) {
      alert('Você pode cadastrar até 8 imagens por produto.');
      e.target.value = '';
      return;
    }
    const oversized = files.find(file => file.size > 20 * 1024 * 1024);
    if (oversized) {
      alert(`A imagem ${oversized.name} ultrapassa o limite de 20MB.`);
      e.target.value = '';
      return;
    }
    try {
      const processedImages = [];
      for (const file of files) {
        const dataUrl = await readImage(file);
        processedImages.push(await resizeImageToWebP(dataUrl));
      }
      pendingImages.push(...processedImages);
      pendingImages = [...new Set(pendingImages)].slice(0, 8);
      renderImagePreviews();
    } catch (error) { alert(error.message); }
    e.target.value = '';
  };

  window.previewImageUrl = function () { syncImageUrls(); };

  window.removeProductImage = function (index) {
    if (index >= 0 && index < pendingImages.length) {
      pendingImages.splice(index, 1);
      renderImagePreviews();
    }
  };

  // ══════════════════════════════════════════
  //  ORDERS TABLE
  // ══════════════════════════════════════════

  window.filterOrders = function () {
    const status = document.getElementById('order-filter-status')?.value || '';
    const filtered = allOrders.filter(o => !status || o.status === status);
    renderOrdersTableData(filtered);
  };

  function renderOrdersTable() {
    renderOrdersTableData([...allOrders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  function renderOrdersTableData(orders) {
    const tbody = document.getElementById('orders-tbody');
    if (!tbody) return;

    if (orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M14 2H6a2 2 0 0 0-2 2v16"/></svg><p>Nenhum pedido encontrado</p><small>Registre pedidos recebidos pelo WhatsApp</small></div></td></tr>`;
      return;
    }

    tbody.innerHTML = orders.map((o) => {
      const code = escHtml(o.code || ('#NTE-' + String(o.id).slice(-4).toUpperCase()));
      const thumb = getOrderThumbnail(o);
      const hasMultiple = Array.isArray(o.items) && o.items.length > 1;
      const thumbHtml = thumb 
        ? `<div style="position:relative; width:44px; height:44px; flex-shrink:0;">
             <img src="${escHtml(thumb)}" alt="" style="width:44px; height:44px; border-radius:8px; object-fit:cover; border:1px solid rgba(201,168,76,0.3); background:#111; cursor:pointer;" onclick="window.open('${escHtml(thumb)}', '_blank')" onerror="this.onerror=null; this.src='../assets/images/logo.png'; this.style.opacity='0.4';" />
             ${hasMultiple ? `<span style="position:absolute; bottom:-3px; right:-3px; background:var(--gold,#c9a84c); color:#000; font-size:9px; font-weight:800; border-radius:10px; padding:1px 5px; line-height:1.2;">+${o.items.length}</span>` : ''}
           </div>`
        : `<div style="width:44px; height:44px; border-radius:8px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;

      let productDetails = '';
      if (hasMultiple) {
        productDetails = `<span style="color:var(--gold); font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:600;">${o.items.length} itens no pedido</span><br>`;
        productDetails += `<span style="font-size:12px; color:var(--text-secondary);">${escHtml(o.items.map(it => `${it.qty || 1}x ${it.name}`).join(', '))}</span>`;
      } else {
        if (o.productBrand) {
          productDetails += `<span style="color:var(--gold); font-size:11px; text-transform:uppercase; letter-spacing:0.08em; font-weight:600;">${escHtml(o.productBrand)}</span><br>`;
        }
        productDetails += `<span style="color:var(--text-primary); font-weight:500;">${escHtml(o.productName || '—')}</span>`;
      }

      return `
      <tr onclick="openOrderModal('${escHtml(o.id)}')" style="cursor:pointer;" title="Clique para ver os detalhes do pedido">
        <td>
          <span class="badge badge-gold" style="font-family:monospace; font-size:11px; font-weight:700; letter-spacing:0.05em;">${code}</span>
        </td>
        <td>${thumbHtml}</td>
        <td>
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
            ${o.source === 'site' ? '<span class="badge badge-gold" title="Pedido feito pelo site" style="font-size:10px; padding:1px 6px;">Site</span>' : ''}
            ${(() => {
              const trk = o.tracking || (o.raw_data && o.raw_data.tracking) || null;
              if (!trk) return '';
              const src = trk.utm_campaign || trk.utm_source || (trk.fbclid ? 'Meta Ads' : (trk.gclid ? 'Google Ads' : (trk.ttclid ? 'TikTok' : '')));
              if (!src) return '';
              return `<span class="badge" style="background:rgba(201,168,76,0.12); color:var(--gold,#c9a84c); border:1px solid rgba(201,168,76,0.25); font-size:10px; padding:1px 6px;" title="Campanha / Origem: ${escHtml(src)}">🎯 ${escHtml(src)}</span>`;
            })()}
            <span style="color:var(--text-primary); font-weight:600; font-size:13px;">${escHtml(o.client || 'Cliente')}</span>
          </div>
          ${(() => {
            const rawPhone = o.phone || (o.raw_data && o.raw_data.phone) || '';
            const digits = String(rawPhone).replace(/\D/g, '');
            if (!digits) return '<span style="font-size:11px; color:var(--text-muted); opacity:0.6;">Sem telefone</span>';
            return `
              <button type="button" onclick="event.stopPropagation(); openWhatsAppModalForOrder('${escHtml(o.id)}')" style="background:rgba(37,211,102,0.12); color:#168a3f; border:1px solid rgba(37,211,102,0.3); font-size:11px; font-weight:600; display:inline-flex; align-items:center; gap:5px; padding:3px 8px; border-radius:6px; margin-top:2px; cursor:pointer;" title="Opções de mensagem no WhatsApp">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                <span>${escHtml(rawPhone)}</span>
              </button>
            `;
          })()}
        </td>
        <td>${productDetails}</td>
        <td>${escHtml([o.size, o.color].filter(Boolean).join(' / ') || '—')}</td>
        <td style="color:var(--gold, #c9a84c); font-weight:600;">${escHtml(o.value || '—')}</td>
        <td>
          <select class="admin-select" style="font-size:11px; padding:4px 24px 4px 6px;" onclick="event.stopPropagation()" onchange="updateOrderStatus('${o.id}', this.value)">
            ${['novo','confirmado','enviado','entregue','cancelado'].map(s =>
              `<option value="${s}" ${o.status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
            ).join('')}
          </select>
        </td>
        <td style="font-size:11px;">${fmt.date(o.createdAt)}</td>
        <td>
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:nowrap;">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); editOrder('${o.id}')" title="Ver / Editar" style="padding:6px 10px; font-size:12px; white-space:nowrap;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; vertical-align:middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Ver</span>
            </button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); confirmDeleteOrder('${o.id}')" title="Excluir" style="padding:6px 10px; font-size:12px; white-space:nowrap;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              <span>Excluir</span>
            </button>
          </div>
        </td>
      </tr>
    `}).join('');
  }

  window.updateOrderStatus = async function (id, status) {
    await window.ntDB.orders.update(id, { status });
    const o = allOrders.find(o => String(o.id) === String(id));
    if (o) o.status = status;
    showToast('check', 'Status atualizado', status);
  };

  // ── Order Modal ──
  window.openOrderModal = function (orderId = null) {
    const modal = document.getElementById('order-modal');
    const title = document.getElementById('order-modal-title');
    const body = document.getElementById('order-modal-body');
    if (!modal || !body) return;

    let orderData = {};
    if (orderId !== null && orderId !== undefined && orderId !== '') {
      const found = allOrders.find(o => String(o.id) === String(orderId));
      if (found) orderData = found;
    }

    const code = orderData.code || (orderId ? ('#NTE-' + String(orderId).slice(-4).toUpperCase()) : '');
    if (title) {
      title.textContent = orderId ? `Detalhes do Pedido ${code}` : 'Registrar Pedido';
    }

    const productsHtml = allProducts.filter(p => p.active !== false).map(p =>
      `<option value="${p.id}" ${String(p.id) === String(orderData.productId) ? 'selected' : ''} data-brand="${escHtml(p.brand)}" data-name="${escHtml(p.name)}" data-price="${escHtml(p.price)}" data-image="${escHtml(p.image || (p.images && p.images[0]) || '')}">${escHtml(p.brand)} — ${escHtml(p.name)}</option>`
    ).join('');

    const orderThumb = getOrderThumbnail(orderData);
    const cleanPhoneDigits = String(orderData.phone || (orderData.raw_data && orderData.raw_data.phone) || '').replace(/\D/g, '');

    const headerPreview = (code || orderThumb) ? `
      <div style="display:flex; align-items:center; gap:14px; margin-bottom:18px; padding:14px 16px; border-radius:12px; background:var(--bg-hover, #f8f8f8); border:1px solid var(--border);">
        ${orderThumb ? `<img src="${escHtml(orderThumb)}" alt="" style="width:48px; height:48px; border-radius:8px; object-fit:cover; border:1px solid var(--border); background:#f4f4f5; cursor:pointer;" onclick="window.open('${escHtml(orderThumb)}', '_blank')" title="Clique para ver imagem">` : ''}
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            ${code ? `<span class="badge badge-gold" style="font-family:monospace; font-size:12px; font-weight:700;">${escHtml(code)}</span>` : ''}
            <span style="font-size:12px; color:var(--text-muted);">${orderData.createdAt ? fmt.date(orderData.createdAt) : ''}</span>
            ${orderData.source === 'site' ? '<span class="badge badge-gold" style="font-size:10px;">Site</span>' : ''}
            ${orderData.code ? `<a href="/order/${encodeURIComponent(orderData.code.replace('#',''))}" target="_blank" class="badge" style="background:transparent; color:var(--text-primary); text-decoration:none; font-size:11px; padding:2px 8px; border:1px solid var(--border); border-radius:6px; display:inline-flex; align-items:center; gap:4px;" title="Abrir página detalhada do pedido"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Ver no Site</a>` : ''}
          </div>
          <div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-top:4px;">${escHtml(orderData.productName || 'Detalhes do Pedido')}</div>
        </div>
      </div>
    ` : '';

    const itemsPreview = (Array.isArray(orderData.items) && orderData.items.length > 0) ? `
      <div style="background:var(--bg-hover, #f8f8f8); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); margin-bottom:12px;">Itens do Pedido (${orderData.items.length})</div>
        <div style="display:grid; gap:10px;">
          ${orderData.items.map((it, idx) => `
            <div style="display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:${idx < orderData.items.length - 1 ? '1px solid var(--border)' : 'none'};">
              ${it.image ? `<img src="${escHtml(it.image)}" style="width:44px; height:44px; border-radius:6px; object-fit:cover; border:1px solid var(--border); background:#f4f4f5; cursor:pointer;" onclick="window.open('${escHtml(it.image)}', '_blank')">` : `<div style="width:44px; height:44px; border-radius:6px; background:var(--bg-surface); border:1px solid var(--border); display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`}
              <div style="flex:1;">
                <div style="font-weight:600; font-size:13px; color:var(--text-primary);">${escHtml(it.brand ? it.brand + ' — ' : '')}${escHtml(it.name || 'Produto')}</div>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
                  ${it.size ? `Tam: <strong>${escHtml(it.size)}</strong> ` : ''}
                  ${it.color ? `| Cor: <strong>${escHtml(it.color)}</strong> ` : ''}
                  | Qtd: <strong>${escHtml(String(it.qty || 1))}</strong>
                </div>
              </div>
              <div style="font-weight:700; color:var(--text-primary); font-size:13px;">${escHtml(it.price || '')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const followUpCard = cleanPhoneDigits.length >= 8 ? `
      <div style="background:rgba(37,211,102,0.06); border:1px solid rgba(37,211,102,0.3); border-radius:12px; padding:14px 16px; margin:4px 0 16px 0;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:6px;">
          <div style="font-size:13px; font-weight:700; color:#168a3f; display:flex; align-items:center; gap:6px;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>Atendimento & Follow-up no WhatsApp</span>
          </div>
          ${orderData.lgpdConsent || (orderData.raw_data && orderData.raw_data.lgpdConsent) ? '<span style="font-size:11px; background:rgba(22,163,74,0.1); color:#16a34a; padding:2px 8px; border-radius:4px; font-weight:600;">LGPD Aceito</span>' : ''}
        </div>
        <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
          Converse diretamente com o cliente escolhendo mensagens de confirmação, recuperação ou acompanhamento de envio:
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm" onclick="openWhatsAppModalForOrder('${escHtml(orderData.id || orderId || '')}')" style="background:#25d366; color:#05260f; font-weight:700; display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border-radius:8px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>Opções de Mensagem WhatsApp</span>
          </button>
        </div>
      </div>
    ` : '';

    const trackingCard = (() => {
      const trk = orderData.tracking || (orderData.raw_data && orderData.raw_data.tracking) || null;
      if (!trk) return '';
      const hasAny = trk.utm_source || trk.utm_medium || trk.utm_campaign || trk.fbclid || trk.gclid || trk.ttclid || trk.referrer;
      if (!hasAny) return '';

      const utmSource = trk.utm_source || (trk.fbclid ? 'Meta / Instagram (fbclid)' : (trk.gclid ? 'Google Ads (gclid)' : (trk.ttclid ? 'TikTok Ads (ttclid)' : 'Direto')));
      const utmMedium = trk.utm_medium || 'cpc / ads';
      const utmCampaign = trk.utm_campaign || '—';
      const utmContent = trk.utm_content || '—';
      const utmTerm = trk.utm_term || '—';
      const clickId = trk.fbclid ? `fbclid: ${trk.fbclid.slice(0, 16)}...` : (trk.gclid ? `gclid: ${trk.gclid.slice(0, 16)}...` : (trk.ttclid ? `ttclid: ${trk.ttclid.slice(0, 16)}...` : ''));

      return `
        <div style="background:var(--bg-hover, #f8f8f8); border:1px solid rgba(201,168,76,0.3); border-radius:12px; padding:14px 16px; margin:4px 0 16px 0;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--gold, #c9a84c); display:flex; align-items:center; gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
              <span>Origem de Tráfego & Campanha (Ads / UTMs)</span>
            </div>
            <span class="badge badge-gold" style="font-size:10px; padding:2px 8px;">Trackeado</span>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; font-size:12px;">
            <div>
              <span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Origem (Source):</span>
              <strong style="color:var(--text-primary);">${escHtml(utmSource)}</strong>
            </div>
            <div>
              <span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Mídia (Medium):</span>
              <strong style="color:var(--text-primary);">${escHtml(utmMedium)}</strong>
            </div>
            <div>
              <span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Campanha:</span>
              <strong style="color:var(--gold, #c9a84c);">${escHtml(utmCampaign)}</strong>
            </div>
            ${utmContent !== '—' ? `<div><span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Conteúdo:</span><strong style="color:var(--text-primary);">${escHtml(utmContent)}</strong></div>` : ''}
            ${utmTerm !== '—' ? `<div><span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Termo:</span><strong style="color:var(--text-primary);">${escHtml(utmTerm)}</strong></div>` : ''}
            ${clickId ? `<div><span style="color:var(--text-muted); display:block; font-size:10px; text-transform:uppercase;">Click ID:</span><span style="font-family:monospace; font-size:11px; color:var(--text-secondary);">${escHtml(clickId)}</span></div>` : ''}
          </div>
        </div>
      `;
    })();

    body.innerHTML = `
      <input type="hidden" id="order-edit-id" value="${orderId || ''}">
      <div style="display:grid; gap:16px;">
        ${headerPreview}
        ${itemsPreview}
        ${followUpCard}
        ${trackingCard}
        <div class="form-grid">
          <div class="form-group form-col-full">
            <label>Nome do Cliente *</label>
            <input type="text" class="form-control" id="o-client" value="${escHtml(orderData.client || '')}" placeholder="João Silva" required>
          </div>
          <div class="form-group">
            <label>WhatsApp do Cliente</label>
            <input type="text" class="form-control" id="o-phone" value="${escHtml(orderData.phone || '')}" placeholder="5511999999999">
          </div>
          <div class="form-group">
            <label>E-mail do Cliente</label>
            <input type="email" class="form-control" id="o-email" value="${escHtml(orderData.email || (orderData.raw_data && orderData.raw_data.email) || '')}" placeholder="cliente@email.com">
          </div>
          <div class="form-group form-col-full">
            <label>Produto *</label>
            <select class="form-control" id="o-product">${productsHtml}</select>
          </div>
          <div class="form-group">
            <label>Tamanho</label>
            <input type="text" class="form-control" id="o-size" value="${escHtml(orderData.size || '')}" placeholder="M">
          </div>
          <div class="form-group">
            <label>Cor</label>
            <input type="text" class="form-control" id="o-color" value="${escHtml(orderData.color || '')}" placeholder="Preto">
          </div>
          <div class="form-group">
            <label>Valor (R$) *</label>
            <input type="text" class="form-control" id="o-value" value="${escHtml((orderData.value || '').replace('R$ ', ''))}" placeholder="649,00" required>
          </div>
          <div class="form-group">
            <label>Status</label>
            <select class="form-control" id="o-status">
              <option value="novo" ${orderData.status === 'novo' ? 'selected' : ''}>Novo</option>
              <option value="confirmado" ${orderData.status === 'confirmado' ? 'selected' : ''}>Confirmado</option>
              <option value="enviado" ${orderData.status === 'enviado' ? 'selected' : ''}>Enviado</option>
              <option value="entregue" ${orderData.status === 'entregue' ? 'selected' : ''}>Entregue</option>
              <option value="cancelado" ${orderData.status === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select>
          </div>
          <div class="form-group form-col-full">
            <label>Observações</label>
            <textarea class="form-control" id="o-notes" placeholder="Notas sobre o pedido...">${escHtml(orderData.notes || '')}</textarea>
          </div>
        </div>
      </div>
    `;

    // Auto-fill value on product select
    const sel = document.getElementById('o-product');
    if (sel) {
      sel.onchange = () => {
        const opt = sel.selectedOptions[0];
        if (opt && opt.dataset.price && !orderId) {
          document.getElementById('o-value').value = opt.dataset.price.replace('R$ ', '');
        }
      };
      if (orderData.productId) {
        sel.value = orderData.productId;
      }
    }

    modal.classList.add('open');
    modal.classList.add('active');
  };

  window.closeOrderModal = function () {
    const modal = document.getElementById('order-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
  };

  window.editOrder = function (id) {
    openOrderModal(id);
  };

  window.saveOrder = async function () {
    const id = document.getElementById('order-edit-id')?.value;
    const sel = document.getElementById('o-product');
    const opt = sel?.selectedOptions[0];

    const orderData = {
      client: getVal('o-client'),
      phone: getVal('o-phone'),
      email: getVal('o-email'),
      productId: sel?.value || '',
      productName: opt?.dataset.name || '',
      productBrand: opt?.dataset.brand || '',
      imageUrl: opt?.dataset.image || '',
      size: getVal('o-size'),
      color: getVal('o-color'),
      value: getVal('o-value'),
      status: getVal('o-status'),
      notes: getVal('o-notes'),
    };

    if (!orderData.client || !orderData.value) {
      alert('Preencha Nome do Cliente e Valor.');
      return;
    }

    try {
      if (id) {
        const existing = allOrders.find(o => String(o.id) === String(id)) || {};
        const merged = { ...existing, ...orderData };
        if (existing.imageUrl && !orderData.imageUrl) merged.imageUrl = existing.imageUrl;
        await window.ntDB.orders.update(id, merged);
        const idx = allOrders.findIndex(o => String(o.id) === String(id));
        if (idx !== -1) allOrders[idx] = { ...allOrders[idx], ...merged };
      } else {
        const newO = await window.ntDB.orders.add(orderData);
        allOrders.push(newO);
      }

      closeOrderModal();
      renderOrdersTable();
      showToast('box', id ? 'Pedido atualizado!' : 'Pedido registrado!', orderData.client);
    } catch (e) {
      alert('Erro ao salvar pedido: ' + e.message);
    }
  };

  window.confirmDeleteOrder = function (id) {
    const o = allOrders.find(o => String(o.id) === String(id));
    if (!o) {
      showToast('error', 'Pedido não encontrado', 'Recarregue a página e tente novamente.');
      return;
    }
    showConfirm(`Excluir pedido de "${o.client || ''}"?`, async () => {
      try {
        await window.ntDB.orders.delete(id);
        allOrders = allOrders.filter(o => String(o.id) !== String(id));
        renderOrdersTable();
        showToast('trash', 'Pedido excluído', o.client || '');
      } catch (e) {
        console.error('Falha ao excluir o pedido:', e);
        showToast('error', 'Falha ao excluir', e.message);
        alert('Erro ao excluir: ' + e.message);
      }
    });
  };

  // ── WhatsApp Modal (Modelos e Envio) ──
  window.__activeWhatsAppTarget = null;

  window.openWhatsAppModalForOrder = function (orderId) {
    const o = allOrders.find(item => String(item.id) === String(orderId));
    if (o) {
      openWhatsAppModal({
        client: o.client,
        phone: o.phone || (o.raw_data && o.raw_data.phone),
        email: o.email || (o.raw_data && o.raw_data.email),
        orderCode: o.code,
        items: o.items,
        status: o.status,
        value: o.value,
        orderId: o.id
      });
    } else {
      openWhatsAppModal({ orderId });
    }
  };

  window.openWhatsAppModalForCustomer = function (customerKey) {
    const c = allCustomers.find(item => item.key === customerKey);
    if (c) {
      openWhatsAppModal({
        client: c.name,
        phone: c.cleanPhone || c.phone,
        email: c.email
      });
    }
  };

  window.openWhatsAppModal = function (options = {}) {
    const modal = document.getElementById('whatsapp-modal');
    const title = document.getElementById('whatsapp-modal-title');
    const subtitle = document.getElementById('whatsapp-modal-subtitle');
    const body = document.getElementById('whatsapp-modal-body');
    if (!modal || !body) return;

    const client = (options.client || 'Cliente').trim();
    const clientFirstName = client.split(' ')[0] || 'Cliente';
    const phone = options.phone || '';
    const cleanPhone = String(phone).replace(/\D/g, '');
    const orderCode = options.orderCode || '';
    const items = options.items || [];
    const status = options.status || '';
    const value = options.value || '';

    let itemsText = '';
    if (Array.isArray(items) && items.length > 0) {
      itemsText = items.map(it => `${it.qty || 1}x ${it.brand ? escHtml(it.brand) + ' — ' : ''}${escHtml(it.name || 'peça')}${it.size ? ' (Tam: ' + escHtml(it.size) + ')' : ''}${it.color ? ' (' + escHtml(it.color) + ')' : ''}`).join(', ');
    } else if (typeof items === 'string' && items) {
      itemsText = items;
    } else {
      itemsText = 'peças exclusivas NT Eleganz';
    }

    const orderRef = orderCode ? ` ${orderCode}` : '';
    const valText = value ? `\nValor total: ${value}` : '';

    const templates = {
      confirmacao: `Olá, ${clientFirstName}! Tudo bem?\n\nAqui é da equipe NT Eleganz. Confirmamos com sucesso o recebimento do seu pedido${orderRef} em nosso sistema:\n${itemsText}${valText}\n\nJá estamos cuidando da preparação das suas peças com todo o padrão de excelência e exclusividade da nossa marca. Caso tenha alguma preferência ou dúvida sobre o envio, estamos à sua total disposição por aqui!`,
      
      followup: `Olá, ${clientFirstName}! Tudo bem?\n\nAqui é da equipe NT Eleganz. Notamos que você iniciou o pedido${orderRef} em nosso site com as peças:\n${itemsText}.\n\nComo trabalhamos com coleções exclusivas e tiragem limitada, separamos o seu pedido com prioridade especial.\n\nGostaria de tirar alguma dúvida sobre tamanho, caimento, prazo de envio ou formas de pagamento para concluirmos seu pedido? Estamos à sua total disposição!`,
      
      envio: `Olá, ${clientFirstName}! Tudo bem?\n\nTemos ótimas notícias sobre o seu pedido${orderRef} na NT Eleganz: suas peças já foram preparadas com todo cuidado e já estão em fase de despacho e entrega!\n\nLogo você receberá seu pacote no conforto da sua casa. Qualquer dúvida ou se precisar do código de rastreamento detalhado, estamos aqui para te ajudar.`,
      
      posvenda: `Olá, ${clientFirstName}! Tudo bem?\n\nVimos que seu pedido${orderRef} na NT Eleganz foi entregue com sucesso! Esperamos que as peças tenham atendido plenamente suas expectativas em sofisticação, conforto e caimento.\n\nComo foi sua experiência com a nossa loja? Adoraríamos ouvir seu feedback. Conte sempre conosco para suas próximas escolhas!`,
      
      atendimento: `Olá, ${clientFirstName}! Tudo bem?\n\nAqui é da equipe de atendimento da NT Eleganz. Em que podemos te ajudar hoje a respeito das suas compras ou dúvidas em nossa loja? Estamos à sua total disposição!`,
      
      personalizada: `Olá, ${clientFirstName}!\n\n`
    };

    window.__activeWhatsAppTarget = { client, phone: cleanPhone, orderCode, templates };

    let defaultKey = 'confirmacao';
    if (status === 'enviado') defaultKey = 'envio';
    else if (status === 'entregue') defaultKey = 'posvenda';
    else if (options.isFollowUp || (!status && orderCode)) defaultKey = 'followup';

    title.innerHTML = `Mensagem WhatsApp: <span style="color:var(--text-primary); font-weight:700;">${escHtml(client)}</span>`;
    if (subtitle) {
      subtitle.textContent = orderCode ? `Pedido ${orderCode} — Selecione um modelo ou edite antes de enviar` : 'Selecione um modelo de mensagem ou edite antes de enviar';
    }

    body.innerHTML = `
      <div style="background:var(--bg-hover, #f8f8f8); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; border-radius:50%; background:rgba(37,211,102,0.12); color:#168a3f; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
          </div>
          <div>
            <div style="font-weight:600; font-size:14px; color:var(--text-primary);">${escHtml(client)}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">
              ${orderCode ? `<span class="badge badge-gold" style="font-family:monospace; margin-right:6px; font-size:11px;">${escHtml(orderCode)}</span>` : ''}
              <span>${escHtml(phone || 'Telefone não informado')}</span>
            </div>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:11px; font-weight:600; color:var(--text-muted); text-transform:uppercase;">WhatsApp:</label>
          <input type="text" id="whatsapp-target-phone" value="${escHtml(cleanPhone)}" placeholder="Ex: 5511999999999" class="form-control" style="width:160px; padding:6px 10px; font-size:12px; font-family:monospace;">
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <label style="display:block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted); margin-bottom:8px;">Modelos Prontos de Mensagem:</label>
        <div style="display:flex; gap:8px; flex-wrap:wrap;" id="whatsapp-template-pills">
          <button type="button" class="btn btn-sm ${defaultKey === 'confirmacao' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('confirmacao', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:4px;"><polyline points="20 6 9 17 4 12"/></svg>
            Confirmação de Pedido
          </button>
          <button type="button" class="btn btn-sm ${defaultKey === 'followup' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('followup', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            Follow-up de Venda
          </button>
          <button type="button" class="btn btn-sm ${defaultKey === 'envio' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('envio', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
            Atualização de Envio
          </button>
          <button type="button" class="btn btn-sm ${defaultKey === 'posvenda' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('posvenda', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            Pós-Venda / Conclusão
          </button>
          <button type="button" class="btn btn-sm ${defaultKey === 'atendimento' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('atendimento', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Atendimento Geral
          </button>
          <button type="button" class="btn btn-sm ${defaultKey === 'personalizada' ? 'btn-primary' : 'btn-outline'}" onclick="selectWhatsAppTemplate('personalizada', this)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Personalizada
          </button>
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-muted);">Mensagem (Edite livremente se desejar):</label>
          <span style="font-size:11px; color:var(--text-muted);" id="whatsapp-char-count">0 caracteres</span>
        </div>
        <textarea id="whatsapp-custom-message" class="form-control" style="min-height:180px; font-size:13.5px; line-height:1.55; padding:14px; resize:vertical; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border);" oninput="updateWhatsAppCharCount()">${escHtml(templates[defaultKey] || '')}</textarea>
      </div>
    `;

    updateWhatsAppCharCount();
    modal.classList.add('open');
    modal.classList.add('active');
  };

  window.selectWhatsAppTemplate = function (key, btnEl) {
    if (!window.__activeWhatsAppTarget || !window.__activeWhatsAppTarget.templates) return;
    const txt = window.__activeWhatsAppTarget.templates[key] || '';
    const textarea = document.getElementById('whatsapp-custom-message');
    if (textarea) {
      textarea.value = txt;
      updateWhatsAppCharCount();
    }
    const container = document.getElementById('whatsapp-template-pills');
    if (container) {
      container.querySelectorAll('button').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline');
      });
    }
    if (btnEl) {
      btnEl.classList.remove('btn-outline');
      btnEl.classList.add('btn-primary');
    }
  };

  window.updateWhatsAppCharCount = function () {
    const el = document.getElementById('whatsapp-custom-message');
    const countEl = document.getElementById('whatsapp-char-count');
    if (el && countEl) {
      countEl.textContent = `${el.value.length} caracteres`;
    }
  };

  window.closeWhatsAppModal = function () {
    const modal = document.getElementById('whatsapp-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
  };

  window.copyWhatsAppMessage = function () {
    const text = document.getElementById('whatsapp-custom-message')?.value || '';
    if (!text) {
      alert('Nenhuma mensagem para copiar.');
      return;
    }
    navigator.clipboard.writeText(text);
    showToast('check', 'Mensagem copiada!', 'Cole diretamente na conversa com o cliente.');
  };

  window.sendWhatsAppMessage = function () {
    let rawPhone = document.getElementById('whatsapp-target-phone')?.value || '';
    let digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 8) {
      alert('Por favor, informe um número de telefone WhatsApp válido com DDD.');
      document.getElementById('whatsapp-target-phone')?.focus();
      return;
    }
    const countryPhone = digits.startsWith('55') ? digits : ('55' + digits);
    const text = document.getElementById('whatsapp-custom-message')?.value || '';
    const encoded = encodeURIComponent(text);
    window.open(`https://wa.me/${countryPhone}?text=${encoded}`, '_blank');
    closeWhatsAppModal();
    showToast('whatsapp', 'WhatsApp aberto!', 'Conversa iniciada com o cliente.');
  };

  // ══════════════════════════════════════════
  //  CUSTOMERS (CLIENTES) MANAGEMENT
  // ══════════════════════════════════════════
  let allCustomers = [];

  function aggregateCustomersFromOrders(orders) {
    const map = new Map();

    (orders || []).forEach(order => {
      const phoneDigits = String(order.phone || '').replace(/\D/g, '');
      const rawEmail = (order.email || (order.raw_data && order.raw_data.email) || '').trim();
      const emailNorm = rawEmail.toLowerCase();
      const clientName = (order.client || 'Cliente do site').trim();

      let key = '';
      if (phoneDigits && phoneDigits.length >= 8) {
        key = `phone:${phoneDigits.slice(-8)}`;
      } else if (emailNorm) {
        key = `email:${emailNorm}`;
      } else if (clientName && clientName.toLowerCase() !== 'cliente do site') {
        key = `name:${clientName.toLowerCase()}`;
      } else {
        key = `order:${order.id || order.code || Math.random()}`;
      }

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: clientName,
          phone: order.phone || '',
          cleanPhone: phoneDigits,
          email: rawEmail,
          orders: [],
          totalSpent: 0,
          lastOrderDate: order.createdAt || order.created_at || '',
          lastOrderCode: order.code || '',
          hasLGPD: Boolean(order.lgpdConsent || (order.raw_data && order.raw_data.lgpdConsent)),
        });
      }

      const cust = map.get(key);
      if (cust.name === 'Cliente do site' && clientName !== 'Cliente do site') {
        cust.name = clientName;
      }
      if (!cust.phone && order.phone) {
        cust.phone = order.phone;
        cust.cleanPhone = phoneDigits;
      }
      if (!cust.email && rawEmail) {
        cust.email = rawEmail;
      }
      if (order.lgpdConsent || (order.raw_data && order.raw_data.lgpdConsent)) {
        cust.hasLGPD = true;
      }

      cust.orders.push(order);

      const valStr = String(order.value || '0').replace(/[^\d,]/g, '').replace(',', '.');
      const valNum = parseFloat(valStr) || 0;
      cust.totalSpent += valNum;

      const orderTime = new Date(order.createdAt || order.created_at || 0).getTime();
      const lastTime = new Date(cust.lastOrderDate || 0).getTime();
      if (orderTime >= lastTime) {
        cust.lastOrderDate = order.createdAt || order.created_at;
        cust.lastOrderCode = order.code || '';
      }
    });

    const list = Array.from(map.values());
    list.sort((a, b) => new Date(b.lastOrderDate || 0) - new Date(a.lastOrderDate || 0));
    return list;
  }

  function updateCustomersKpis(customers) {
    const totalCount = customers.length;
    const withWpp = customers.filter(c => c.cleanPhone && c.cleanPhone.length >= 8).length;
    const totalRevenue = customers.reduce((sum, c) => sum + (c.totalSpent || 0), 0);
    const avgTicket = totalCount > 0 ? (totalRevenue / totalCount) : 0;

    setText('kpi-clients-total', totalCount);
    setText('kpi-clients-wpp', withWpp);
    setText('kpi-clients-revenue', fmt.currency(totalRevenue));
    setText('kpi-clients-ticket', fmt.currency(avgTicket));

    const badge = document.getElementById('clientes-nav-badge');
    if (badge) {
      badge.textContent = totalCount;
      badge.hidden = totalCount === 0;
    }
  }

  function renderCustomersTable(filteredList = null) {
    allCustomers = aggregateCustomersFromOrders(allOrders);
    updateCustomersKpis(allCustomers);

    const tbody = document.getElementById('customers-tbody');
    if (!tbody) return;

    const list = filteredList !== null ? filteredList : allCustomers;

    if (!list.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty">
            <div class="empty-state" style="padding:40px 20px; text-align:center;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px auto; display:block; opacity:0.6;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <p style="font-weight:600; font-size:1rem; margin-bottom:4px; color:var(--text-primary);">Nenhum cliente encontrado</p>
              <small style="color:var(--text-muted);">Os clientes que gerarem pedidos no site aparecerão aqui automaticamente com WhatsApp e histórico.</small>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = list.map(c => {
      const initials = (c.name || 'C').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'C';
      const hasPhone = c.cleanPhone && c.cleanPhone.length >= 8;

      return `
        <tr onclick="openCustomerHistoryModal('${escHtml(c.key)}')">
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <div style="width:34px; height:34px; border-radius:50%; background:rgba(201,168,76,0.15); border:1px solid rgba(201,168,76,0.3); color:#c9a84c; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex-shrink:0;">
                ${escHtml(initials)}
              </div>
              <div>
                <strong style="color:var(--text-primary); cursor:pointer;">${escHtml(c.name)}</strong>
                ${c.hasLGPD ? '<span class="badge" style="background:rgba(37,211,102,0.12);color:#25d366;font-size:10px;padding:2px 6px;margin-left:6px;border-radius:4px;display:inline-flex;align-items:center;gap:3px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> LGPD</span>' : ''}
              </div>
            </div>
          </td>
          <td>
            ${hasPhone ? `
              <button type="button" class="btn btn-sm btn-ghost" style="color:#25d366; padding:4px 8px; font-weight:500; display:inline-flex; align-items:center; gap:6px; background:rgba(37,211,102,0.08); border:1px solid rgba(37,211,102,0.25); border-radius:6px; cursor:pointer;" onclick="event.stopPropagation(); openWhatsAppModalForCustomer('${escHtml(c.key)}')" title="Enviar mensagem via WhatsApp com modelos prontos">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                <span>${escHtml(c.phone || c.cleanPhone)}</span>
              </button>
            ` : '<span style="color:var(--text-muted); font-size:0.88rem;">-</span>'}
          </td>
          <td>
            ${c.email ? `<span style="color:var(--text-secondary); font-size:0.88rem;">${escHtml(c.email)}</span>` : '<span style="color:var(--text-muted);">-</span>'}
          </td>
          <td>
            <span class="badge badge-gold" style="font-weight:600;">${c.orders.length} pedido${c.orders.length > 1 ? 's' : ''}</span>
          </td>
          <td style="font-weight:600; color:var(--text-primary);">
            ${fmt.currency(c.totalSpent)}
          </td>
          <td>
            <div style="font-size:0.85rem; color:var(--text-secondary);">
              ${c.lastOrderDate ? fmt.date(c.lastOrderDate) : '-'}
            </div>
            ${c.lastOrderCode ? `<div style="font-family:monospace; font-size:11px; color:#c9a84c;">${escHtml(c.lastOrderCode)}</div>` : ''}
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); openCustomerHistoryModal('${escHtml(c.key)}')">
                Ver Pedidos
              </button>
              ${hasPhone ? `
                <button type="button" class="btn btn-sm" style="background:#25d366; color:#05260f; border:none; display:inline-flex; align-items:center; justify-content:center; padding:6px 10px; border-radius:6px; cursor:pointer;" onclick="event.stopPropagation(); openWhatsAppModalForCustomer('${escHtml(c.key)}')" title="Conversar no WhatsApp">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.renderCustomersTable = renderCustomersTable;

  window.filterCustomers = function () {
    const term = (document.getElementById('customer-search-input')?.value || '').toLowerCase().trim();
    if (!term) {
      renderCustomersTable(allCustomers);
      return;
    }
    const filtered = allCustomers.filter(c =>
      (c.name || '').toLowerCase().includes(term) ||
      (c.phone || '').includes(term) ||
      (c.cleanPhone || '').includes(term) ||
      (c.email || '').toLowerCase().includes(term)
    );
    renderCustomersTable(filtered);
  };

  window.__activeCustomerKey = null;
  window.__activeCustomerFilter = 'todos';

  window.filterCustomerModalOrders = function (filter, btnEl) {
    window.__activeCustomerFilter = filter;
    const cust = allCustomers.find(c => c.key === window.__activeCustomerKey);
    if (!cust) return;

    const tabsContainer = document.getElementById('customer-modal-tabs');
    if (tabsContainer) {
      tabsContainer.querySelectorAll('button').forEach(b => {
        b.classList.remove('btn-primary');
        b.classList.add('btn-outline');
      });
    }
    if (btnEl) {
      btnEl.classList.remove('btn-outline');
      btnEl.classList.add('btn-primary');
    }

    renderCustomerModalOrdersList(cust, filter);
  };

  function renderCustomerModalOrdersList(cust, filter = 'todos') {
    const listContainer = document.getElementById('customer-modal-orders-list');
    if (!listContainer) return;

    let orders = [...cust.orders].sort((a, b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));

    if (filter === 'concluidos') {
      orders = orders.filter(o => o.status === 'entregue' || o.status === 'concluido');
    } else if (filter === 'andamento') {
      orders = orders.filter(o => o.status === 'novo' || o.status === 'confirmado' || o.status === 'enviado');
    } else if (filter === 'cancelados') {
      orders = orders.filter(o => o.status === 'cancelado');
    }

    if (!orders.length) {
      listContainer.innerHTML = `
        <div style="text-align:center; padding:32px 16px; background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; color:var(--text-muted);">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 10px auto; display:block; opacity:0.5;"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
          <div style="font-weight:600; font-size:0.95rem; color:var(--text-primary); margin-bottom:4px;">Nenhum pedido neste filtro</div>
          <div style="font-size:0.85rem;">Não há pedidos com o status selecionado para este cliente.</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = orders.map(order => {
      const thumb = getOrderThumbnail(order);
      const orderCode = order.code || `#NTE-${String(order.id).slice(-4).toUpperCase()}`;
      const cleanCode = orderCode.replace('#', '');
      const items = Array.isArray(order.items) ? order.items : [];
      const orderValue = order.value ? (String(order.value).startsWith('R$') ? order.value : fmt.currency(order.value)) : '—';
      const orderDate = fmt.date(order.createdAt || order.created_at || new Date().toISOString());

      return `
        <div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; padding:18px; transition:border-color 0.15s; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:14px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${thumb ? `
                <img src="${escHtml(thumb)}" style="width:48px; height:48px; border-radius:8px; object-fit:cover; border:1px solid var(--border); background:var(--bg-card);">
              ` : `
                <div style="width:48px; height:48px; border-radius:8px; background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.25); display:flex; align-items:center; justify-content:center; color:#c9a84c;">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                </div>
              `}
              <div>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span class="badge badge-gold" style="font-family:monospace; font-weight:700;">${escHtml(orderCode)}</span>
                  <span style="font-size:12px; color:var(--text-muted);">${escHtml(orderDate)}</span>
                </div>
                <div style="font-size:0.95rem; font-weight:600; color:var(--text-primary); margin-top:4px;">
                  ${escHtml(order.productName || (items[0] && items[0].name) || 'Pedido da Loja')}
                </div>
              </div>
            </div>

            <div style="text-align:right;">
              <div style="font-weight:700; color:#c9a84c; font-size:1.1rem;">${escHtml(orderValue)}</div>
              <div style="margin-top:4px;">${statusBadge(order.status)}</div>
            </div>
          </div>

          ${items.length > 0 ? `
            <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin-bottom:14px; font-size:0.84rem;">
              <div style="font-weight:600; color:var(--text-secondary); margin-bottom:8px; text-transform:uppercase; letter-spacing:0.04em; font-size:11px;">Itens do Pedido (${items.length}):</div>
              ${items.map(it => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.03);">
                  <div style="color:var(--text-primary);">
                    <span style="color:#c9a84c; font-weight:600;">•</span>
                    ${escHtml(it.brand ? `${it.brand} — ` : '')}${escHtml(it.name || 'Produto')}
                    ${it.size ? `<span style="color:var(--text-muted); font-size:12px; margin-left:4px;">(Tam: ${escHtml(it.size)})</span>` : ''}
                    ${it.color ? `<span style="color:var(--text-muted); font-size:12px; margin-left:4px;">(Cor: ${escHtml(it.color)})</span>` : ''}
                    <span style="font-weight:700; color:var(--text-secondary); margin-left:6px;">x${escHtml(String(it.qty || 1))}</span>
                  </div>
                  <strong style="color:#c9a84c; font-size:0.85rem;">${escHtml(it.price || '')}</strong>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div style="display:flex; justify-content:flex-end; align-items:center; gap:8px; flex-wrap:wrap; border-top:1px solid var(--border); padding-top:12px;">
            <a href="/order/${encodeURIComponent(cleanCode)}" target="_blank" class="btn btn-sm btn-outline" style="text-decoration:none; display:inline-flex; align-items:center; gap:5px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>Ver no Site</span>
            </a>

            <button type="button" class="btn btn-sm" style="background:#25d366; color:#05260f; font-weight:700; border:none; display:inline-flex; align-items:center; gap:5px; cursor:pointer;" onclick="openWhatsAppModalForOrder('${escHtml(String(order.id))}')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              <span>WhatsApp</span>
            </button>

            <button type="button" class="btn btn-sm btn-primary" onclick="closeCustomerModal(); openOrderModal('${escHtml(order.id)}');">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Ver Detalhes</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  window.openCustomerHistoryModal = function (customerKey) {
    const cust = allCustomers.find(c => c.key === customerKey);
    if (!cust) return;

    window.__activeCustomerKey = customerKey;
    window.__activeCustomerFilter = 'todos';

    const modal = document.getElementById('customer-modal');
    const title = document.getElementById('customer-modal-title');
    const body = document.getElementById('customer-modal-body');
    if (!modal || !body) return;

    title.innerHTML = `Histórico do Cliente: <span style="color:#c9a84c;">${escHtml(cust.name)}</span>`;

    const initials = (cust.name || 'C').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'C';
    const totalOrders = cust.orders.length;
    const completedOrders = cust.orders.filter(o => o.status === 'entregue' || o.status === 'concluido').length;
    const inProgressOrders = cust.orders.filter(o => o.status === 'novo' || o.status === 'confirmado' || o.status === 'enviado').length;
    const cancelledOrders = cust.orders.filter(o => o.status === 'cancelado').length;
    const hasPhone = cust.cleanPhone && cust.cleanPhone.length >= 8;

    body.innerHTML = `
      <!-- Customer Profile Header Card -->
      <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:20px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px;">
        <div style="display:flex; align-items:center; gap:14px;">
          <div style="width:48px; height:48px; border-radius:50%; background:rgba(201,168,76,0.15); border:1.5px solid rgba(201,168,76,0.4); color:#c9a84c; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; flex-shrink:0;">
            ${escHtml(initials)}
          </div>
          <div>
            <div style="font-size:1.15rem; font-weight:700; color:var(--text-primary);">${escHtml(cust.name)}</div>
            <div style="display:flex; align-items:center; gap:14px; margin-top:5px; font-size:0.86rem; color:var(--text-muted); flex-wrap:wrap;">
              ${cust.phone ? `
                <span style="display:inline-flex; align-items:center; gap:5px; color:var(--text-secondary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  ${escHtml(cust.phone)}
                </span>
              ` : ''}
              ${cust.email ? `
                <span style="display:inline-flex; align-items:center; gap:5px; color:var(--text-secondary);">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  ${escHtml(cust.email)}
                </span>
              ` : ''}
              ${cust.hasLGPD ? `
                <span style="color:#25d366; font-size:11px; display:inline-flex; align-items:center; gap:4px; background:rgba(37,211,102,0.1); padding:2px 8px; border-radius:4px; border:1px solid rgba(37,211,102,0.2);">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  LGPD Ativo
                </span>
              ` : ''}
            </div>
          </div>
        </div>

        <div>
          ${hasPhone ? `
            <button type="button" class="btn" style="background:#25d366; color:#05260f; font-weight:700; border:none; display:inline-flex; align-items:center; gap:7px; padding:9px 16px; border-radius:8px; font-size:13px; cursor:pointer;" onclick="openWhatsAppModalForCustomer('${escHtml(cust.key)}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              <span>Mensagem no WhatsApp</span>
            </button>
          ` : ''}
        </div>
      </div>

      <!-- Customer KPI Summary Grid -->
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:12px; margin-bottom:20px;">
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; text-align:center;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:4px;">Total Pedidos</div>
          <div style="font-size:1.3rem; font-weight:700; color:var(--text-primary);">${totalOrders}</div>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; text-align:center;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:4px;">Total Gasto</div>
          <div style="font-size:1.3rem; font-weight:700; color:#c9a84c;">${fmt.currency(cust.totalSpent)}</div>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; text-align:center;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:4px;">Concluídos</div>
          <div style="font-size:1.3rem; font-weight:700; color:#16a34a;">${completedOrders}</div>
        </div>
        <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; text-align:center;">
          <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-muted); margin-bottom:4px;">Em Andamento</div>
          <div style="font-size:1.3rem; font-weight:700; color:#eab308;">${inProgressOrders}</div>
        </div>
      </div>

      <!-- Filter Tabs by Status -->
      <div id="customer-modal-tabs" style="display:flex; gap:8px; margin-bottom:16px; border-bottom:1px solid var(--border); padding-bottom:12px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-primary" onclick="filterCustomerModalOrders('todos', this)">
          Todos (${totalOrders})
        </button>
        <button type="button" class="btn btn-sm btn-outline" onclick="filterCustomerModalOrders('concluidos', this)">
          Concluídos (${completedOrders})
        </button>
        <button type="button" class="btn btn-sm btn-outline" onclick="filterCustomerModalOrders('andamento', this)">
          Em Andamento (${inProgressOrders})
        </button>
        ${cancelledOrders > 0 ? `
          <button type="button" class="btn btn-sm btn-outline" onclick="filterCustomerModalOrders('cancelados', this)">
            Cancelados (${cancelledOrders})
          </button>
        ` : ''}
      </div>

      <!-- Orders List Container -->
      <div id="customer-modal-orders-list"></div>
    `;

    renderCustomerModalOrdersList(cust, 'todos');

    modal.classList.add('open');
    modal.classList.add('active');
  };

  window.closeCustomerModal = function () {
    const modal = document.getElementById('customer-modal');
    if (modal) {
      modal.classList.remove('open');
      modal.classList.remove('active');
    }
  };

  // ══════════════════════════════════════════
  //  SETTINGS
  // ══════════════════════════════════════════

  function loadSettings() {
    const config = window.ntDB?.config() || {};
    const wppSettings = JSON.parse(localStorage.getItem('nte_wpp_settings') || '{}');

    // Set current DB mode
    currentDBMode = config.mode || 'local';
    document.querySelectorAll('.db-mode-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.mode === currentDBMode);
    });
    selectDBMode(currentDBMode, null, false);

    // Fill Firebase fields
    if (config.firebase) {
      setValue('fb-api-key', config.firebase.apiKey || '');
      setValue('fb-auth-domain', config.firebase.authDomain || '');
      setValue('fb-project-id', config.firebase.projectId || '');
      setValue('fb-storage-bucket', config.firebase.storageBucket || '');
      setValue('fb-app-id', config.firebase.appId || '');
    }

    // Fill Supabase fields
    if (config.supabase) {
      setValue('sb-url', config.supabase.url || '');
      setValue('sb-anon-key', config.supabase.anonKey || '');
    }

    // WhatsApp
    setValue('wpp-number', wppSettings.number || '5575999283496');
    setValue('wpp-greeting', wppSettings.greeting || 'Olá! Vim pelo site da NT Eleganz e gostaria de saber mais sobre os produtos.');

    // Username
    setValue('new-username', window.ntAuth?.getUsername() || 'admin');

    // Carrega formas de entrega configuradas
    if (typeof window.loadAdminShippingMethods === 'function') {
      window.loadAdminShippingMethods();
    }
  }

  window.selectDBMode = function (mode, el, updateDOM = true) {
    currentDBMode = mode;
    if (el && updateDOM) {
      document.querySelectorAll('.db-mode-option').forEach(opt => opt.classList.remove('active'));
      el.classList.add('active');
    }

    document.getElementById('firebase-fields').classList.toggle('visible', mode === 'firebase');
    document.getElementById('supabase-fields').classList.toggle('visible', mode === 'supabase');
  };

  window.saveDBConfig = async function () {
    const alertEl = document.getElementById('db-alert');
    let config = { mode: currentDBMode };

    if (currentDBMode === 'firebase') {
      config.firebase = {
        apiKey: getVal('fb-api-key'),
        authDomain: getVal('fb-auth-domain'),
        projectId: getVal('fb-project-id'),
        storageBucket: getVal('fb-storage-bucket'),
        appId: getVal('fb-app-id'),
      };
    } else if (currentDBMode === 'supabase') {
      config.supabase = {
        url: getVal('sb-url'),
        anonKey: getVal('sb-anon-key'),
      };
    }

    try {
      const result = await window.ntDB.setConfig(config);
      if (currentDBMode !== 'local' && (!result?.ok || result.mode !== currentDBMode)) {
        throw new Error(result?.error || 'Não foi possível conectar ao banco selecionado. Revise as credenciais.');
      }
      allProducts = await window.ntDB.products.getAll();
      await syncProducts(true);
      const labels = { local: 'LocalStorage', firebase: 'Firebase', supabase: 'Supabase', hostinger: 'Hostinger (produtos)' };
      document.getElementById('db-mode-label').textContent = labels[currentDBMode];
      alertEl.innerHTML = `<div class="alert alert-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Configuração salva! Banco: ${labels[currentDBMode]}</div>`;
      showToast('check', 'DB configurado!', labels[currentDBMode]);
    } catch (e) {
      alertEl.innerHTML = `<div class="alert alert-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Erro: ${e.message}</div>`;
    }
  };

  window.testDBConnection = async function () {
    const btn = document.getElementById('test-db-btn');
    btn.textContent = 'Testando...';
    btn.disabled = true;
    const alertEl = document.getElementById('db-alert');

    try {
      const products = await window.ntDB.products.getAll();
      alertEl.innerHTML = `<div class="alert alert-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Conexão OK! ${products.length} produto(s) encontrado(s).</div>`;
    } catch (e) {
      alertEl.innerHTML = `<div class="alert alert-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>Falha na conexão: ${e.message}</div>`;
    } finally {
      btn.textContent = 'Testar Conexão';
      btn.disabled = false;
    }
  };

  window.saveCredentials = async function () {
    const alertEl = document.getElementById('cred-alert');
    const newUser = getVal('new-username');
    const currentPass = getVal('current-pass');
    const newPass = getVal('new-pass');
    const confirmPass = getVal('confirm-pass');

    if (!currentPass) {
      alertEl.innerHTML = '<div class="alert alert-danger">Informe a senha atual.</div>';
      return;
    }

    if (newPass && newPass !== confirmPass) {
      alertEl.innerHTML = '<div class="alert alert-danger">As novas senhas não coincidem.</div>';
      return;
    }

    let result = { success: true };

    if (newUser && newUser !== window.ntAuth?.getUsername()) {
      result = await window.ntAuth.changeUsername(currentPass, newUser);
    }

    if (result.success && newPass) {
      result = await window.ntAuth.changePassword(currentPass, newPass);
    }

    if (result.success) {
      alertEl.innerHTML = '<div class="alert alert-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>Credenciais atualizadas com sucesso!</div>';
      document.getElementById('sidebar-username').textContent = newUser || window.ntAuth?.getUsername();
      document.getElementById('sidebar-avatar').textContent = (newUser || 'A').charAt(0).toUpperCase();
      setValue('current-pass', '');
      setValue('new-pass', '');
      setValue('confirm-pass', '');
    } else {
      alertEl.innerHTML = `<div class="alert alert-danger">${result.error}</div>`;
    }
  };

  window.saveWhatsApp = function () {
    const alertEl = document.getElementById('wpp-alert');
    const settings = {
      number: getVal('wpp-number'),
      greeting: getVal('wpp-greeting'),
    };
    localStorage.setItem('nte_wpp_settings', JSON.stringify(settings));
    alertEl.innerHTML = '<div class="alert alert-success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>WhatsApp atualizado!</div>';
    showToast('whatsapp', 'WhatsApp salvo!', settings.number);
  };

  // ── Gestão de Formas de Envio (Checkout de Luxo) ──
  let adminShippingMethods = [];

  window.loadAdminShippingMethods = async function () {
    const container = document.getElementById('shipping-methods-container');
    if (!container) return;
    try {
      const res = await fetch('/api/shipping_methods.php?all=1', { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.methods)) {
        adminShippingMethods = data.methods;
      } else {
        adminShippingMethods = [];
      }
    } catch (e) {
      console.warn('Erro ao carregar métodos de frete:', e);
      adminShippingMethods = [
        { id: 'sedex', name: 'Sedex Express (Seguro Especial Incluso)', price: 38.0, deadline: '2 a 4 dias úteis', freeAbove: 1000, active: true },
        { id: 'pac', name: 'Standard Nobre (PAC)', price: 22.0, deadline: '5 a 8 dias úteis', freeAbove: 600, active: true },
        { id: 'concierge', name: 'Entrega Concierge / Agendamento VIP', price: 60.0, deadline: 'Até 24h ou agendado', freeAbove: null, active: true }
      ];
    }
    renderAdminShippingMethods();
  };

  window.renderAdminShippingMethods = function () {
    const container = document.getElementById('shipping-methods-container');
    if (!container) return;
    if (adminShippingMethods.length === 0) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">Nenhuma forma de entrega cadastrada. Clique em "+ Nova Forma de Envio".</div>';
      return;
    }

    container.innerHTML = adminShippingMethods.map((m, idx) => `
      <div style="background:var(--bg-secondary, #f4f2ee);border:1px solid var(--border-color, #e5e0d8);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:600;font-size:14px;color:var(--text-primary, #111);">
            #${idx + 1} — ${m.name || 'Nova Opção'}
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
              <input type="checkbox" ${m.active !== false ? 'checked' : ''} onchange="toggleShippingActive(${idx}, this.checked)" />
              Ativo
            </label>
            <button type="button" class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:11px;" onclick="removeShippingMethod(${idx})">Remover</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;">
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Nome do Método</label>
            <input type="text" class="form-control" value="${m.name || ''}" placeholder="Ex: Sedex Express" oninput="updateShippingField(${idx}, 'name', this.value)" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Valor (R$)</label>
            <input type="number" step="0.5" class="form-control" value="${m.price !== undefined ? m.price : 0}" placeholder="38.00" oninput="updateShippingField(${idx}, 'price', parseFloat(this.value) || 0)" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Prazo Estimado</label>
            <input type="text" class="form-control" value="${m.deadline || ''}" placeholder="2 a 4 dias úteis" oninput="updateShippingField(${idx}, 'deadline', this.value)" />
          </div>
          <div>
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:3px;">Grátis Acima de (R$) <span style="font-size:10px;">(opcional)</span></label>
            <input type="number" step="10" class="form-control" value="${m.freeAbove || ''}" placeholder="Deixe vazio se não houver" oninput="updateShippingField(${idx}, 'freeAbove', this.value ? parseFloat(this.value) : null)" />
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px dashed var(--border-color, #e5e0d8);">
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;background:${m.singleItemOnly ? 'rgba(201,168,76,0.15)' : '#fff'};padding:5px 12px;border-radius:6px;border:1px solid ${m.singleItemOnly ? '#c9a84c' : 'var(--border-color, #d5cfc5)'};color:${m.singleItemOnly ? '#855f17' : 'var(--text-secondary, #555)'};font-weight:600;transition:all 0.2s ease;">
            <input type="checkbox" ${m.singleItemOnly ? 'checked' : ''} onchange="updateShippingField(${idx}, 'singleItemOnly', this.checked); renderAdminShippingMethods();" />
            <span>Apenas para 1 peça</span>
            <small style="font-size:10px;font-weight:400;color:var(--text-muted);">(Exclusivo para pedidos com apenas 1 item no carrinho)</small>
          </label>
          ${m.singleItemOnly ? '<span style="font-size:10px;background:#c9a84c;color:#000;font-weight:800;padding:2px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">1 Peça Apenas</span>' : ''}
        </div>
      </div>
    `).join('');
  };

  window.addNewShippingMethod = function () {
    adminShippingMethods.push({
      id: 'ship_' + Date.now().toString(36),
      name: 'Nova Entrega Personalizada',
      price: 25.0,
      deadline: '3 a 5 dias úteis',
      freeAbove: null,
      active: true,
      singleItemOnly: false
    });
    renderAdminShippingMethods();
  };

  window.removeShippingMethod = function (idx) {
    if (confirm('Deseja realmente remover esta opção de frete?')) {
      adminShippingMethods.splice(idx, 1);
      renderAdminShippingMethods();
    }
  };

  window.toggleShippingActive = function (idx, active) {
    if (adminShippingMethods[idx]) {
      adminShippingMethods[idx].active = active;
    }
  };

  window.updateShippingField = function (idx, field, val) {
    if (adminShippingMethods[idx]) {
      adminShippingMethods[idx][field] = val;
    }
  };

  window.saveAllShippingMethods = async function () {
    const alertEl = document.getElementById('shipping-alert');
    const saveBtn = document.getElementById('btn-save-shipping');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';
    }
    try {
      const token = window.ntAuth?.getToken?.() || '';
      const res = await fetch('/api/shipping_methods.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ methods: adminShippingMethods })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao salvar configurações de frete');
      }
      if (alertEl) {
        alertEl.innerHTML = '<div class="alert alert-success" style="margin-top:8px;">Formas de entrega atualizadas com sucesso!</div>';
        setTimeout(() => { if (alertEl) alertEl.innerHTML = ''; }, 4000);
      }
      showToast('check', 'Frete atualizado!', `${adminShippingMethods.length} formas de envio salvas`);
    } catch (err) {
      if (alertEl) {
        alertEl.innerHTML = `<div class="alert alert-danger" style="margin-top:8px;">${err.message}</div>`;
      }
      showToast('!', 'Erro ao salvar frete', err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Formas de Envio';
      }
    }
  };

  // ── Marketing & Tracking (Pixels & Conversions API) ──
  window.loadTrackingSettings = async function () {
    const alertEl = document.getElementById('tracking-alert');
    if (alertEl) alertEl.innerHTML = '';
    try {
      const authHeader = await getUploadAuthHeader();
      const res = await fetch('/api/tracking.php', {
        headers: authHeader ? { ...authHeader } : {},
        cache: 'no-store'
      });
      const data = await res.json();
      if (data && data.success && data.settings) {
        const s = data.settings;
        setValue('meta-pixel-id', s.meta_pixel_id || '');
        setValue('meta-pageview-pixel-id', s.meta_pageview_pixel_id || '');
        const pvEnabledCheck = document.getElementById('meta-pageview-enabled');
        if (pvEnabledCheck) pvEnabledCheck.checked = s.meta_pageview_enabled !== false;
        const pvMainCheck = document.getElementById('meta-pageview-main-also');
        if (pvMainCheck) pvMainCheck.checked = s.meta_pageview_on_main !== false;
        setValue('meta-capi-token', s.meta_capi_token || '');
        setValue('meta-test-code', s.meta_test_event_code || '');
        setValue('gtm-id', s.gtm_id || '');
        setValue('ga4-id', s.ga4_id || '');
        setValue('gads-id', s.google_ads_conversion_id || '');
        setValue('gads-label', s.google_ads_conversion_label || '');
        setValue('tiktok-pixel-id', s.tiktok_pixel_id || '');
        const activeCheck = document.getElementById('tracking-active');
        if (activeCheck) activeCheck.checked = s.active !== false;
      }
    } catch (err) {
      console.warn('Erro ao carregar configurações de tracking:', err);
    }
  };

  window.saveTrackingSettings = async function () {
    const alertEl = document.getElementById('tracking-alert');
    const saveBtn = document.getElementById('btn-save-tracking');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';
    }

    const payload = {
      meta_pixel_id: document.getElementById('meta-pixel-id')?.value.trim() || '',
      meta_pageview_pixel_id: document.getElementById('meta-pageview-pixel-id')?.value.trim() || '',
      meta_pageview_enabled: document.getElementById('meta-pageview-enabled')?.checked ?? true,
      meta_pageview_on_main: document.getElementById('meta-pageview-main-also')?.checked ?? true,
      meta_capi_token: document.getElementById('meta-capi-token')?.value.trim() || '',
      meta_test_event_code: document.getElementById('meta-test-code')?.value.trim() || '',
      gtm_id: document.getElementById('gtm-id')?.value.trim() || '',
      ga4_id: document.getElementById('ga4-id')?.value.trim() || '',
      google_ads_conversion_id: document.getElementById('gads-id')?.value.trim() || '',
      google_ads_conversion_label: document.getElementById('gads-label')?.value.trim() || '',
      tiktok_pixel_id: document.getElementById('tiktok-pixel-id')?.value.trim() || '',
      active: document.getElementById('tracking-active')?.checked ?? true
    };

    try {
      const authHeader = await getUploadAuthHeader();
      const res = await fetch('/api/tracking.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader || {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (alertEl) {
          alertEl.innerHTML = `
            <div class="alert alert-success" style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-radius:8px;margin-bottom:16px;background:rgba(39,174,96,0.12);color:#27ae60;border:1px solid rgba(39,174,96,0.3);">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Configurações de tráfego e pixels salvas com sucesso! O rastreamento já está ativo na loja.</span>
            </div>
          `;
        }
        showToast('check', 'Pixels Salvos!', 'Rastreamento atualizado com sucesso.');
      } else {
        throw new Error(data.error || 'Erro ao salvar configurações.');
      }
    } catch (err) {
      if (alertEl) {
        alertEl.innerHTML = `
          <div class="alert alert-danger" style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-radius:8px;margin-bottom:16px;background:rgba(235,87,87,0.12);color:#eb5757;border:1px solid rgba(235,87,87,0.3);">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>Falha ao salvar: ${err.message}</span>
          </div>
        `;
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Configurações de Tráfego';
      }
    }
  };

  window.testMetaCapi = async function () {
    const testResultEl = document.getElementById('meta-test-result');
    const testBtn = document.getElementById('btn-test-capi');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Enviando disparo teste...';
    }
    if (testResultEl) {
      testResultEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">Enviando evento de teste para a Graph API da Meta...</span>';
    }

    try {
      const authHeader = await getUploadAuthHeader();
      const res = await fetch('/api/tracking.php?test=meta', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader || {})
        },
        body: JSON.stringify({
          clientName: 'Teste Gestor Tráfego',
          email: 'teste.gestor@nteleganz.com.br',
          phone: '11999998888'
        })
      });
      const data = await res.json();
      const capiRes = data.capi_result;
      if (capiRes && capiRes.success) {
        testResultEl.innerHTML = `
          <div style="background:rgba(39,174,96,0.1); border:1px solid rgba(39,174,96,0.3); color:#27ae60; padding:10px 14px; border-radius:6px; font-size:12px; margin-top:10px;">
            <strong>✓ Sucesso!</strong> Evento Purchase recebido pelos servidores da Meta (HTTP ${capiRes.http_code}).
            <br><small style="opacity:0.85;">Event ID: ${capiRes.event_id}. Se você inseriu o Código de Teste, o evento já apareceu na aba "Testar Eventos" do Gerenciador de Eventos da Meta.</small>
          </div>
        `;
      } else {
        const errMsg = capiRes?.response?.error?.message || capiRes?.reason || 'Falha no teste';
        testResultEl.innerHTML = `
          <div style="background:rgba(235,87,87,0.1); border:1px solid rgba(235,87,87,0.3); color:#eb5757; padding:10px 14px; border-radius:6px; font-size:12px; margin-top:10px;">
            <strong>✕ Erro na API da Meta:</strong> ${errMsg}
            <br><small style="opacity:0.85;">Certifique-se de salvar o Pixel ID e o Token da API de Conversões antes de testar.</small>
          </div>
        `;
      }
    } catch (err) {
      if (testResultEl) {
        testResultEl.innerHTML = `<div style="color:#eb5757; font-size:12px; margin-top:8px;">Erro na requisição: ${err.message}</div>`;
      }
    } finally {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = 'Testar Disparo na API da Meta (CAPI)';
      }
    }
  };

  // ── CATEGORIAS DA LOJA (Gestão de Coleções) ──
  let allCategories = [];

  function resolveCategoryImg(img) {
    if (!img) return '/assets/images/category-camisetas.webp';
    if (img.startsWith('data:') || img.startsWith('http://') || img.startsWith('https://')) return img;
    if (img.startsWith('/')) return img;
    return '/' + img.replace(/^\.\.\//, '').replace(/^\.\//, '');
  }

  window.loadCategories = async function (forceRefresh = false) {
    const grid = document.getElementById('categories-grid');
    const countEl = document.getElementById('categories-result-count');
    const alertEl = document.getElementById('category-alert');
    if (alertEl) alertEl.innerHTML = '';

    if (grid && (!allCategories.length || forceRefresh)) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 12px;"></div>Carregando categorias...</div>';
    }

    try {
      const res = await fetch('/api/categories.php?all=1', { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.categories)) {
        allCategories = data.categories;
      }
    } catch (e) {
      console.warn('Erro ao carregar categorias da API:', e);
      if (!allCategories.length) {
        allCategories = [
          { id: 'camisetas', name: 'Camisetas', image: '/assets/images/category-camisetas.webp', active: true },
          { id: 'shorts', name: 'Shorts', image: '/assets/images/category-shorts.webp', active: true },
          { id: 'calcados', name: 'Calçados', image: '/assets/images/category-calcados.webp', active: true },
          { id: 'hoodies', name: 'Hoodies', image: '/assets/images/category-hoodies.webp', active: true }
        ];
      }
    }

    renderCategoriesGrid();
    syncCategoryDropdowns();
  };

  function renderCategoriesGrid() {
    const grid = document.getElementById('categories-grid');
    const countEl = document.getElementById('categories-result-count');
    if (!grid) return;

    if (countEl) {
      countEl.textContent = `${allCategories.length} ${allCategories.length === 1 ? 'categoria cadastrada' : 'categorias cadastradas'}`;
    }

    if (!allCategories.length) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: var(--bg-surface); border-radius: var(--radius-lg); border: 1px dashed var(--border);">
          <div style="font-size: 32px; margin-bottom: 8px;">📁</div>
          <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">Nenhuma categoria encontrada</h3>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Crie categorias para organizar seus produtos na vitrine.</p>
          <button type="button" class="btn btn-primary" onclick="openCategoryModal()">+ Adicionar Categoria</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = allCategories.map(cat => {
      const imgSrc = resolveCategoryImg(cat.image);
      const safeName = (cat.name || '').replace(/"/g, '&quot;');
      const safeId = (cat.id || '').replace(/"/g, '&quot;');

      return `
        <div class="category-admin-card" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm);">
          <div style="position: relative; width: 100%; aspect-ratio: 3/4; background: #0a0a0a; overflow: hidden;">
            <img src="${imgSrc}" alt="${safeName}" style="width: 100%; height: 100%; object-fit: cover; display: block;" onerror="this.onerror=null; this.src='/assets/images/category-camisetas.webp';" />
            <div style="position: absolute; top: 12px; right: 12px;">
              <span class="badge ${cat.active !== false ? 'badge-success' : 'badge-inactive'}" style="font-size: 10px; font-weight: 600; padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.65); color: #fff; backdrop-filter: blur(4px);">
                ${cat.active !== false ? 'Ativa' : 'Inativa'}
              </span>
            </div>
            <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 70%, transparent 100%); padding: 24px 16px 12px;">
              <h3 style="color: #ffffff; margin: 0 0 2px 0; font-size: 18px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,0.8);">${safeName}</h3>
              <span style="color: rgba(255,255,255,0.7); font-size: 11px; font-family: monospace;">slug: ${safeId}</span>
            </div>
          </div>
          <div style="padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-card); border-top: 1px solid var(--border); gap: 8px;">
            <a href="/collections/?categoria=${encodeURIComponent(cat.id)}" target="_blank" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 6px 10px; display: inline-flex; align-items: center; gap: 4px;" title="Ver na loja">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
              Ver Loja
            </a>
            <div style="display: flex; gap: 6px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="openCategoryModal('${safeId}')" style="font-size: 11px; padding: 6px 10px;" title="Editar Categoria">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar
              </button>
              <button type="button" class="btn btn-secondary btn-sm" onclick="deleteCategory('${safeId}', '${safeName}')" style="font-size: 11px; padding: 6px 10px; color: var(--danger);" title="Excluir Categoria">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function syncCategoryDropdowns() {
    const productCategorySelect = document.getElementById('p-category');
    const filterCategorySelect = document.getElementById('product-filter-cat');
    if (!allCategories.length) return;

    if (productCategorySelect) {
      const currentVal = productCategorySelect.value;
      productCategorySelect.innerHTML = allCategories.map(cat => `
        <option value="${cat.id}">${cat.name}</option>
      `).join('');
      if (currentVal && allCategories.some(c => c.id === currentVal)) {
        productCategorySelect.value = currentVal;
      }
    }

    if (filterCategorySelect) {
      const currentFilter = filterCategorySelect.value;
      filterCategorySelect.innerHTML = '<option value="">Todas categorias</option>' + allCategories.map(cat => `
        <option value="${cat.id}">${cat.name}</option>
      `).join('');
      if (currentFilter) {
        filterCategorySelect.value = currentFilter;
      }
    }
  }

  window.openCategoryModal = function (categoryId = null) {
    const modal = document.getElementById('category-modal');
    const titleEl = document.getElementById('category-modal-title');
    const idInput = document.getElementById('cat-edit-id');
    const nameInput = document.getElementById('cat-name');
    const imgValInput = document.getElementById('cat-image-val');
    const previewBox = document.getElementById('cat-preview-box');
    const previewImg = document.getElementById('cat-preview-img');
    const previewLabel = document.getElementById('cat-preview-label');
    const fileInput = document.getElementById('cat-image-file');

    if (!modal) return;
    if (fileInput) fileInput.value = '';

    if (categoryId && typeof categoryId === 'string') {
      const cat = allCategories.find(c => c.id === categoryId);
      if (cat) {
        if (titleEl) titleEl.textContent = 'Editar Categoria';
        if (idInput) idInput.value = cat.id;
        if (nameInput) nameInput.value = cat.name || '';
        if (imgValInput) imgValInput.value = cat.image || '';
        if (previewImg) previewImg.src = resolveCategoryImg(cat.image);
        if (previewLabel) previewLabel.textContent = 'Imagem Atual';
        if (previewBox) previewBox.style.display = cat.image ? 'block' : 'none';
      }
    } else {
      if (titleEl) titleEl.textContent = 'Nova Categoria';
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (imgValInput) imgValInput.value = '';
      if (previewBox) previewBox.style.display = 'none';
    }

    modal.classList.add('active');
    setTimeout(() => nameInput?.focus(), 100);
  };

  window.closeCategoryModal = function () {
    const modal = document.getElementById('category-modal');
    if (modal) modal.classList.remove('active');
  };

  window.handleCategoryImageSelect = async function (event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecione um arquivo de imagem válido (PNG, JPG, WebP).');
      return;
    }

    try {
      const dataUrl = await readImage(file);
      const optimizedWebp = await resizeImageToWebP(dataUrl, 1000, 0.82);
      const imgValInput = document.getElementById('cat-image-val');
      const previewBox = document.getElementById('cat-preview-box');
      const previewImg = document.getElementById('cat-preview-img');
      const previewLabel = document.getElementById('cat-preview-label');

      if (imgValInput) imgValInput.value = optimizedWebp;
      if (previewImg) previewImg.src = optimizedWebp;
      if (previewLabel) previewLabel.textContent = 'Nova imagem selecionada';
      if (previewBox) previewBox.style.display = 'block';
    } catch (err) {
      alert('Erro ao processar imagem: ' + err.message);
    }
  };

  window.removeCategorySelectedImage = function () {
    const fileInput = document.getElementById('cat-image-file');
    const imgValInput = document.getElementById('cat-image-val');
    const previewBox = document.getElementById('cat-preview-box');
    if (fileInput) fileInput.value = '';
    if (imgValInput) imgValInput.value = '';
    if (previewBox) previewBox.style.display = 'none';
  };

  window.saveCategory = async function () {
    const idInput = document.getElementById('cat-edit-id');
    const nameInput = document.getElementById('cat-name');
    const imgValInput = document.getElementById('cat-image-val');
    const saveBtn = document.getElementById('btn-save-category');

    const name = nameInput?.value.trim() || '';
    if (!name) {
      alert('Por favor, informe o nome da categoria.');
      nameInput?.focus();
      return;
    }

    const image = imgValInput?.value.trim() || '';
    if (!image) {
      alert('Por favor, selecione uma imagem para a categoria.');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Salvando...';
    }

    const payload = {
      id: idInput?.value.trim() || '',
      name: name,
      image: image,
      active: true
    };

    try {
      const res = await fetch('/api/categories.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao salvar categoria');
      }

      showToast('check', 'Categoria Salva!', `A categoria "${name}" foi salva com sucesso.`);
      closeCategoryModal();
      await loadCategories(true);
    } catch (err) {
      alert('Falha ao salvar categoria: ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Categoria';
      }
    }
  };

  window.deleteCategory = async function (id, name) {
    if (!confirm(`Deseja realmente excluir a categoria "${name}"? Os produtos vinculados a ela não serão excluídos.`)) {
      return;
    }

    try {
      const res = await fetch('/api/categories.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao excluir categoria');
      }

      showToast('trash', 'Categoria Excluída', `A categoria "${name}" foi removida.`);
      await loadCategories(true);
    } catch (err) {
      alert('Erro ao excluir: ' + err.message);
    }
  };

  // ══════════════════════════════════════════
  //  FEEDBACKS DE CLIENTES (ADMIN)
  // ══════════════════════════════════════════
  let allFeedbacks = [];

  function resolveFeedbackImg(img) {
    if (!img) return '../assets/images/feedback-1.webp';
    if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:')) return img;
    const clean = img.replace(/^\/+/, '');
    return clean.startsWith('assets/') ? '../' + clean : '../assets/images/' + clean;
  }

  window.loadFeedbacks = async function (forceRefresh = false) {
    const grid = document.getElementById('feedbacks-grid');
    const countEl = document.getElementById('feedbacks-result-count');
    const alertEl = document.getElementById('feedback-alert');
    if (alertEl) alertEl.innerHTML = '';

    if (grid && (!allFeedbacks.length || forceRefresh)) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 12px;"></div>Carregando feedbacks...</div>';
    }

    try {
      const res = await fetch('/api/feedbacks.php?all=1', { cache: 'no-store' });
      const data = await res.json();
      if (data && Array.isArray(data.feedbacks)) {
        allFeedbacks = data.feedbacks;
      }
    } catch (e) {
      console.warn('Erro ao carregar feedbacks da API:', e);
      if (!allFeedbacks.length) {
        allFeedbacks = Array.from({ length: 13 }, (_, i) => ({
          id: `fb-${i + 1}`,
          title: `Feedback ${i + 1}`,
          image: `/assets/images/feedback-${i + 1}.webp`,
          order: i + 1,
          active: true
        }));
      }
    }

    renderFeedbacksGrid();
  };

  function renderFeedbacksGrid() {
    const grid = document.getElementById('feedbacks-grid');
    const countEl = document.getElementById('feedbacks-result-count');
    if (!grid) return;

    if (countEl) {
      countEl.textContent = `${allFeedbacks.length} ${allFeedbacks.length === 1 ? 'feedback cadastrado' : 'feedbacks cadastrados'} (exibidos no carrossel)`;
    }

    if (!allFeedbacks.length) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: var(--bg-surface); border-radius: var(--radius-lg); border: 1px dashed var(--border);">
          <div style="font-size: 32px; margin-bottom: 8px;">💬</div>
          <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">Nenhum feedback cadastrado</h3>
          <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">Adicione fotos de conversas e depoimentos para exibir no carrossel da vitrine.</p>
          <button type="button" class="btn btn-primary" onclick="openFeedbackModal()">+ Adicionar Feedback</button>
        </div>
      `;
      return;
    }

    allFeedbacks.sort((a, b) => (a.order || 0) - (b.order || 0));

    grid.innerHTML = allFeedbacks.map((fb, idx) => {
      const imgSrc = resolveFeedbackImg(fb.image);
      const safeTitle = (fb.title || `Feedback ${idx + 1}`).replace(/"/g, '&quot;');
      const safeId = (fb.id || '').replace(/"/g, '&quot;');
      const isFirst = idx === 0;
      const isLast = idx === allFeedbacks.length - 1;

      return `
        <div class="feedback-admin-card" data-id="${safeId}" style="background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm); position: relative;">
          <!-- Top indicators -->
          <div style="position: relative; width: 100%; aspect-ratio: 9/16; background: #0f0f10; overflow: hidden; display: flex; align-items: center; justify-content: center;">
            <img src="${imgSrc}" alt="${safeTitle}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="if(!this.dataset.vpsTried){this.dataset.vpsTried='1';this.src='https://137-131-233-254.sslip.io/nteleganz/uploads/'+this.src.split('/').pop();}else{this.src='../assets/images/feedback-1.webp';}" />
            
            <!-- Badge de Posição / Ordem -->
            <span style="position: absolute; top: 10px; left: 10px; background: rgba(10,10,10,0.88); color: #fff; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.18);">
              #${idx + 1}
            </span>

            <!-- Status de Visibilidade -->
            <button type="button" onclick="toggleFeedbackActive('${safeId}')" title="${fb.active ? 'Ocultar na vitrine' : 'Exibir na vitrine'}" style="position: absolute; top: 10px; right: 10px; background: ${fb.active ? 'rgba(22,163,74,0.92)' : 'rgba(120,120,120,0.92)'}; color: #fff; border: none; border-radius: 9999px; padding: 3px 8px; font-size: 10px; font-weight: 700; cursor: pointer; text-transform: uppercase;">
              ${fb.active ? 'Ativo' : 'Oculto'}
            </button>
          </div>

          <!-- Informações e Ações -->
          <div style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; flex: 1; justify-content: space-between; border-top: 1px solid var(--border);">
            <div>
              <div style="font-weight: 600; font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeTitle}">
                ${safeTitle}
              </div>
              <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                Posição: ${idx + 1} de ${allFeedbacks.length}
              </div>
            </div>

            <!-- Controles de Posição (Mover Frente / Trás) -->
            <div style="display: flex; gap: 6px; align-items: center; justify-content: space-between; padding-top: 4px; border-top: 1px dashed var(--border);">
              <div style="display: flex; gap: 4px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="moveFeedback('${safeId}', -1)" ${isFirst ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''} title="Mover para frente (posição anterior)" style="padding: 5px 9px;">
                  ◀
                </button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="moveFeedback('${safeId}', 1)" ${isLast ? 'disabled style="opacity:0.35; cursor:not-allowed;"' : ''} title="Mover para trás (próxima posição)" style="padding: 5px 9px;">
                  ▶
                </button>
              </div>

              <!-- Editar e Excluir -->
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="openFeedbackModal('${safeId}')" title="Editar informações ou foto" style="padding: 5px 9px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button type="button" class="btn btn-sm" onclick="deleteFeedback('${safeId}', '${safeTitle}')" title="Excluir feedback" style="padding: 5px 9px; color: var(--danger); background: var(--danger-bg); border: 1px solid rgba(220,38,38,0.2);">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.moveFeedback = async function (id, direction) {
    try {
      const res = await fetch('/api/feedbacks.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', id, direction })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao alterar posição');
      }
      allFeedbacks = data.feedbacks;
      renderFeedbacksGrid();
      showToast('check', 'Posição Atualizada', 'A ordem dos feedbacks no carrossel foi salva.');
    } catch (err) {
      alert('Erro ao mover feedback: ' + err.message);
    }
  };

  window.toggleFeedbackActive = async function (id) {
    const item = allFeedbacks.find(f => f.id === id);
    if (!item) return;
    const newActive = !item.active;
    try {
      const res = await fetch('/api/feedbacks.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          feedback: {
            id: item.id,
            title: item.title,
            image: item.image,
            active: newActive
          }
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Erro ao alterar visibilidade');
      allFeedbacks = data.feedbacks;
      renderFeedbacksGrid();
      showToast('check', newActive ? 'Feedback Ativado' : 'Feedback Ocultado', `O feedback agora está ${newActive ? 'visível' : 'oculto'} no carrossel.`);
    } catch (err) {
      alert('Erro: ' + err.message);
    }
  };

  window.openFeedbackModal = function (editId = null) {
    const modal = document.getElementById('feedback-modal');
    const titleEl = document.getElementById('feedback-modal-title');
    const idInput = document.getElementById('fb-edit-id');
    const titleInput = document.getElementById('fb-title');
    const posSelect = document.getElementById('fb-position-select');
    const imageVal = document.getElementById('fb-image-val');
    const previewBox = document.getElementById('fb-preview-box');
    const previewImg = document.getElementById('fb-preview-img');
    const previewLabel = document.getElementById('fb-preview-label');

    if (!modal) return;

    if (editId) {
      const item = allFeedbacks.find(f => f.id === editId);
      if (!item) return;
      if (titleEl) titleEl.textContent = 'Editar Feedback';
      if (idInput) idInput.value = item.id;
      if (titleInput) titleInput.value = item.title || '';
      if (imageVal) imageVal.value = item.image || '';
      if (posSelect) posSelect.style.display = 'none';

      if (previewBox && previewImg) {
        previewImg.onerror = function() {
          if (!this.dataset.vpsTried) {
            this.dataset.vpsTried = '1';
            this.src = 'https://137-131-233-254.sslip.io/nteleganz/uploads/' + this.src.split('/').pop();
          }
        };
        previewImg.src = resolveFeedbackImg(item.image);
        if (previewLabel) previewLabel.textContent = 'Foto Atual';
        previewBox.style.display = 'block';
      }
    } else {
      if (titleEl) titleEl.textContent = 'Novo Feedback de Cliente';
      if (idInput) idInput.value = '';
      if (titleInput) titleInput.value = `Feedback ${allFeedbacks.length + 1}`;
      if (imageVal) imageVal.value = '';
      if (posSelect) posSelect.style.display = 'block';
      if (previewBox) previewBox.style.display = 'none';
      if (previewImg) previewImg.src = '';
    }

    modal.classList.add('active');
  };

  window.closeFeedbackModal = function () {
    const modal = document.getElementById('feedback-modal');
    if (modal) modal.classList.remove('active');
    const fileInput = document.getElementById('fb-image-file');
    if (fileInput) fileInput.value = '';
  };

  window.handleFeedbackImageSelect = function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
      const rawBase64 = e.target.result;
      
      const img = new Image();
      img.onload = function () {
        const maxWidth = 720;
        const maxHeight = 1440;
        let w = img.width;
        let h = img.height;

        if (w > maxWidth || h > maxHeight) {
          const scale = Math.min(maxWidth / w, maxHeight / h);
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        let optimizedBase64 = canvas.toDataURL('image/webp', 0.82);
        if (!optimizedBase64.startsWith('data:image/webp')) {
          optimizedBase64 = canvas.toDataURL('image/jpeg', 0.85);
        }

        const previewBox = document.getElementById('fb-preview-box');
        const previewImg = document.getElementById('fb-preview-img');
        const previewLabel = document.getElementById('fb-preview-label');
        const imageVal = document.getElementById('fb-image-val');

        if (previewImg) previewImg.src = optimizedBase64;
        if (imageVal) imageVal.value = optimizedBase64;
        const approxKb = Math.round((optimizedBase64.length * 3 / 4) / 1024);
        if (previewLabel) previewLabel.textContent = `Pronta (~${approxKb} KB otimizada)`;
        if (previewBox) previewBox.style.display = 'block';
      };
      img.src = rawBase64;
    };
    reader.readAsDataURL(file);
  };

  window.removeFeedbackSelectedImage = function () {
    const previewBox = document.getElementById('fb-preview-box');
    const previewImg = document.getElementById('fb-preview-img');
    const imageVal = document.getElementById('fb-image-val');
    const fileInput = document.getElementById('fb-image-file');

    if (previewBox) previewBox.style.display = 'none';
    if (previewImg) previewImg.src = '';
    if (imageVal) imageVal.value = '';
    if (fileInput) fileInput.value = '';
  };

  window.saveFeedback = async function () {
    const idInput = document.getElementById('fb-edit-id');
    const titleInput = document.getElementById('fb-title');
    const posSelect = document.getElementById('fb-position-select');
    const imageVal = document.getElementById('fb-image-val');
    const saveBtn = document.getElementById('btn-save-feedback');

    const image = imageVal?.value.trim();
    if (!image) {
      alert('Por favor, selecione uma foto de feedback do seu computador ou celular.');
      return;
    }

    const editId = idInput?.value.trim() || '';
    const title = titleInput?.value.trim() || `Feedback ${allFeedbacks.length + 1}`;
    const position = posSelect ? posSelect.value : 'end';

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Otimizando e Salvando…';
    }

    const payload = {
      action: 'save',
      feedback: {
        id: editId,
        title: title,
        image: image,
        order: (!editId && position === 'start') ? 1 : null,
        active: true
      }
    };

    try {
      const res = await fetch('/api/feedbacks.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao salvar feedback');
      }

      showToast('check', 'Feedback Salvo!', `"${title}" foi salvo com sucesso e adicionado ao carrossel.`);
      closeFeedbackModal();
      await loadFeedbacks(true);
    } catch (err) {
      alert('Falha ao salvar feedback: ' + err.message);
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Salvar Feedback';
      }
    }
  };

  window.deleteFeedback = async function (id, title) {
    if (!confirm(`Deseja realmente excluir o feedback "${title}"? Ele será removido permanentemente do carrossel.`)) {
      return;
    }

    try {
      const res = await fetch('/api/feedbacks.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao excluir feedback');
      }

      showToast('trash', 'Feedback Removido', `O feedback foi excluído do carrossel.`);
      await loadFeedbacks(true);
    } catch (err) {
      alert('Erro ao excluir: ' + err.message);
    }
  };

  // ── Export / Import ──
  window.exportData = function () {
    window.ntDB?.export();
    showToast('save', 'Exportando dados...', 'arquivo JSON sendo baixado');
  };

  window.importData = async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await window.ntDB?.import(file);
      allProducts = await window.ntDB.products.getAll();
      allOrders = await window.ntDB.orders.getAll();
      showToast('check', 'Dados importados!', `${allProducts.length} produtos, ${allOrders.length} pedidos`);
      loadOverview();
    } catch (err) {
      alert('Erro ao importar: ' + err.message);
    }
  };

  // ══════════════════════════════════════════
  //  UTILITIES
  // ══════════════════════════════════════════

  function statusBadge(status) {
    const map = {
      novo: 'badge-info',
      confirmado: 'badge-warning',
      enviado: 'badge-gold',
      entregue: 'badge-success',
      cancelado: 'badge-danger',
    };
    const cls = map[status] || 'badge-muted';
    const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : '—';
    return `<span class="badge ${cls}">${escHtml(label)}</span>`;
  }

  window.statusBadge = statusBadge;
  window.orderStatusBadge = statusBadge;

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function getVal(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
  }

  // ── Confirm Modal ──
window.showConfirm = function (msg, callback) {
    
    // Remove any existing dynamic confirm modal
    const existing = document.getElementById('dynamic-confirm-modal');
    if (existing) existing.remove();
    
    confirmCallback = callback;
    
    // Build modal dynamically (bypass all CSS)
    const overlay = document.createElement('div');
    overlay.id = 'dynamic-confirm-modal';
    overlay.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      z-index: 99999 !important;
      background: rgba(0,0,0,0.6) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 20px !important;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;
    `;
    overlay.onclick = (e) => { if (e.target === overlay) closeDynamicConfirmModal(); };
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      background: var(--bg-surface, #0f0f0f) !important;
      border: 1px solid var(--border, rgba(201, 168, 76, 0.3)) !important;
      border-radius: 16px !important;
      max-width: min(420px, 90vw) !important;
      width: 100% !important;
      overflow: hidden !important;
      box-shadow: 
        0 4px 24px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(201, 168, 76, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
      color: var(--text-primary, #f2efe9) !important;
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
    `;
    
    // Header
    const overlayEl = document.createElement('div');
    overlayEl.id = 'dynamic-confirm-modal';
    overlayEl.style.cssText = `
      position: fixed !important;
      inset: 0 !important;
      z-index: 99999 !important;
      background: rgba(0, 0, 0, 0.55) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: clamp(16px, 4vw, 24px) !important;
      font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif) !important;
      animation: fadeIn 0.2s ease-out !important;
    `;
    overlayEl.onclick = (e) => { if (e.target === overlayEl) closeDynamicConfirmModal(); };
    
    const modalEl = document.createElement('div');
    modalEl.style.cssText = `
      background: var(--bg-surface, #1a1a1a) !important;
      border: 2px solid var(--gold, #c9a84c) !important;
      border-radius: var(--radius-xl, 12px) !important;
      max-width: 420px !important;
      width: 100% !important;
      overflow: hidden !important;
      box-shadow: var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.7)) !important;
      color: var(--text-primary, #f2efe9) !important;
    `;
    
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 16px 20px !important;
      border-bottom: 1px solid var(--border, rgba(201, 168, 76, 0.2)) !important;
      background: rgba(201, 168, 76, 0.03) !important;
    `;
    header.innerHTML = `
      <h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text-primary, #f2efe9);letter-spacing:0.01em;">Confirmar</h3>
      <button onclick="closeDynamicConfirmModal()" style="
        width: 32px !important;
        height: 32px !important;
        border: none !important;
        border-radius: 8px !important;
        background: var(--bg-hover, rgba(255,255,255,0.04)) !important;
        color: var(--text-muted, #888) !important;
        font-size: 1.25rem !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.15s ease !important;
      " onmouseover="this.style.background='var(--bg-hover,rgba(255,255,255,0.08))'" onmouseout="this.style.background='var(--bg-hover,rgba(255,255,255,0.04))'">×</button>
    `;
    
    // Body
    const body = document.createElement('div');
    body.style.cssText = `padding: 20px 24px !important; text-align: center !important;`;
    body.innerHTML = `
      <p style="margin:0;color:var(--text-secondary, #bbb);line-height:1.6;font-size:.9rem;">${escHtml(msg)}</p>
    `;
    
    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
      display:flex !important; justify-content:center !important; gap:10px !important;
      padding:16px 20px !important; border-top:1px solid var(--border, rgba(201,168,76,0.2)) !important;
      background: rgba(201, 168, 76, 0.03) !important;
    `;
    footer.innerHTML = `
      <button onclick="closeDynamicConfirmModal()" style="
        padding:10px 20px !important;
        border:1px solid rgba(201,168,76,0.2) !important;
        border-radius:8px !important;
        background:transparent !important;
        color:#bbb !important;
        cursor:pointer !important;
        font-size:.85rem !important;
        font-weight:500 !important;
        transition:all 0.15s ease !important;
      " onmouseover="this.style.borderColor='#c9a84c';this.style.color='#c9a84c'" onmouseout="this.style.borderColor='rgba(201,168,76,0.2)';this.style.color='#bbb'">Cancelar</button>
      <button onclick="confirmDynamicConfirm()" style="
        padding:10px 20px !important;
        border:none !important;
        border-radius:8px !important;
        background:#e03e3e !important;
        color:#fff !important;
        font-weight:600 !important;
        cursor:pointer !important;
        font-size:.85rem !important;
        box-shadow:0 2px 8px rgba(224,62,62,0.3) !important;
        transition:background-color 0.15s ease !important;
      " onmouseover="this.style.backgroundColor='#c02e2e'" onmouseout="this.style.backgroundColor='#e03e3e'">Confirmar exclusão</button>
    `;
    
    modalEl.style.cssText = `
      background: var(--bg-surface, #1a1a1a) !important;
      border: 2px solid var(--gold, #c9a84c) !important;
      border-radius: var(--radius-xl, 12px) !important;
      max-width: 420px !important;
      width: 100% !important;
      overflow: hidden !important;
      box-shadow: var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.7)) !important;
      color: var(--text-primary, #f2efe9) !important;
    `;
    
    modalEl.appendChild(header);
    modalEl.appendChild(body);
    modalEl.appendChild(footer);
    
    overlayEl.appendChild(modalEl);
    document.body.appendChild(overlayEl);
    
    return true;
  };

  window.closeDynamicConfirmModal = function () {
    const modal = document.getElementById('dynamic-confirm-modal');
    if (modal) modal.remove();
  };

  window.confirmDynamicConfirm = async function () {
    const cb = confirmCallback;
    if (cb) {
      closeDynamicConfirmModal();
      try { await cb(); } catch (e) { console.error('Confirm callback error:', e); alert('Erro: ' + e.message); }
    }
  };

  window.closeConfirm = function () {
    const modal = document.getElementById('confirm-modal');
    if (modal) {
      modal.classList.remove('open');
      // Clear inline styles we forced with !important
      modal.style.removeProperty('opacity');
      modal.style.removeProperty('visibility');
      modal.style.removeProperty('pointer-events');
      // Clear child modal styles
      const modalChild = modal.querySelector('.modal');
      if (modalChild) {
        modalChild.style.removeProperty('opacity');
        modalChild.style.removeProperty('visibility');
        modalChild.style.removeProperty('position');
        modalChild.style.removeProperty('z-index');
      }
      const parent = modal.parentElement;
      if (parent) {
        parent.style.removeProperty('opacity');
        parent.style.removeProperty('visibility');
      }
      document.body.style.removeProperty('opacity');
      document.body.style.removeProperty('visibility');
    }
    confirmCallback = null;
  };

  // ── Toast (SVG Vectors — Zero Emojis) ──
  const toastIcons = {
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    bell: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    box: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
    whatsapp: '<svg width="18" height="18" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
    save: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c9a84c" stroke-width="2.2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'
  };

  const mapIcon = {
    '✓': toastIcons.check,
    'check': toastIcons.check,
    '🔔': toastIcons.bell,
    'bell': toastIcons.bell,
    '✦': toastIcons.info,
    'info': toastIcons.info,
    '!': toastIcons.info,
    '📦': toastIcons.box,
    'box': toastIcons.box,
    '🗑️': toastIcons.trash,
    '🗑': toastIcons.trash,
    'trash': toastIcons.trash,
    '✘': toastIcons.error,
    'error': toastIcons.error,
    '💬': toastIcons.whatsapp,
    'whatsapp': toastIcons.whatsapp,
    '💾': toastIcons.save,
    'save': toastIcons.save
  };

  function showToast(icon, title, msg) {
    let container = document.getElementById('admin-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'admin-toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toastIcon = mapIcon[icon] || (String(icon).startsWith('<svg') ? icon : toastIcons.info);

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <span class="toast-icon" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;">${toastIcon}</span>
      <div>
        <div class="toast-title">${escHtml(title)}</div>
        ${msg ? `<div class="toast-desc">${escHtml(msg)}</div>` : ''}
      </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── Start ──
  // Uma alteração feita nesta aba já foi aplicada em allProducts, então
  // sincronizar de novo aqui seria trabalho duplicado. Alterações vindas de
  // outra aba/dispositivo chegam com detail.external e precisam ser buscadas.
  window.addEventListener('nte:products-changed', event => {
    if (event?.detail?.source === 'current-window') return;
    syncProducts(false, { force: true });
  });
  window.addEventListener('nte:leads-changed', () => { refreshLeads(); });
  window.addEventListener('nte:orders-changed', () => { refreshOrders(); });
  window.addEventListener('storage', event => {
    if (event.key === 'nte_hydrated_products' || event.key === 'nte_products') syncProducts(false, { force: true });
    if (event.key === 'nte_leads') refreshLeads();
    if (event.key === 'nte_orders') refreshOrders();
  });
  document.addEventListener('DOMContentLoaded', () => {
    setupProductNameInput();
    document.getElementById('p-category')?.addEventListener('change', updateSizeSuggestions);
    document.querySelectorAll('.nav-item').forEach(item => {
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');
      item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          item.click();
        }
      });
    });
    Promise.resolve(window.ntAuth?.requireAuth?.()).then(authenticated => {
      if (!authenticated) return;
      return init();
    }).then(() => {
      if (!window.ntAuth?.getUsername()) return;
      // Cloud data sources do not share the browser storage event. Polling keeps
      // an open dashboard current without needing an additional realtime service.
      window.setInterval(() => refreshLeads(), 30000);
      window.setInterval(() => {
        if (!document.hidden && currentDBMode !== 'local') syncProducts(false, { force: true });
      }, 20000);
      window.setInterval(() => {
        if (!document.hidden && currentDBMode !== 'local') refreshOrders();
      }, 25000);
    }).catch(error => {
      console.error('Não foi possível iniciar a dashboard:', error);
      hideLoader();
      showToast('!', 'Falha ao iniciar a dashboard', error?.message || 'Verifique a configuração do banco de dados.');
    });
  });

  // Watchdog: em redes móveis a autenticação/Supabase pode pendurar e manter o
  // loader infinito sem nenhuma explicação. Se o boot não concluir em 12s,
  // esconde o spinner e expõe o erro real (ou orientação) na tela.
  window.setTimeout(() => {
    const loader = document.getElementById('admin-loader');
    if (!loader || loader.classList.contains('hidden')) return;
    hideLoader();
    const errEl = document.getElementById('login-error') || document.querySelector('.login-error');
    const msg = 'A autenticação está demorando mais que o esperado. Verifique sua conexão (rede móvel) e tente novamente.';
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add('visible');
      return;
    }
    showToast('!', 'Conexão lenta', msg);
  }, 12000);

})();
