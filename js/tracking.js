/**
 * NT Eleganz — Motor Global de Rastreamento & Marketing
 * Suporte a: Meta Ads Pixel (CAPI & Navegador) • Google Tag Manager / GA4 • Google Ads • TikTok Ads
 * Captura Automática de UTMs & Parâmetros de Campanhas
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'nte_tracking_data';
  let trackingConfig = null;
  let isInitialized = false;

  // ── 1. Captura & Persistência de UTMs ──
  function captureUtms() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];
      let foundAny = false;
      const current = {};

      keys.forEach(k => {
        const val = urlParams.get(k);
        if (val) {
          current[k] = val.trim();
          foundAny = true;
        }
      });

      // Se veio com UTMs ou IDs de clique, grava nova sessão de campanha
      if (foundAny) {
        current.referrer = document.referrer || '';
        current.landing_page = window.location.pathname;
        current.captured_at = new Date().toISOString();

        // Se houver fbclid, prepara o cookie _fbc padrão da Meta
        if (current.fbclid) {
          current.fbc = `fb.1.${Date.now()}.${current.fbclid}`;
          try {
            document.cookie = `_fbc=${current.fbc};path=/;max-age=${90 * 86400};SameSite=Lax`;
          } catch (e) {}
        }

        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) {}
      } else {
        // Se não há UTMs nesta URL, mas já existiam em sessionStorage/localStorage, mantém os anteriores
        const stored = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
        if (!stored && document.referrer && !document.referrer.includes(window.location.hostname)) {
          const refData = {
            referrer: document.referrer,
            landing_page: window.location.pathname,
            captured_at: new Date().toISOString()
          };
          try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(refData));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[Tracking] Erro ao capturar UTMs:', err);
    }
  }

  function getStoredTracking() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return '';
  }

  // ── 2. Injeção dos Scripts de Pixel e Tags Oficiais ──
  function ensureMetaScript() {
    if (window.fbq) return;
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  }

  // Normaliza um Pixel ID: aceita o numero puro, OU extrai o numero caso
  // alguem cole o snippet inteiro do Pixel (fbq('init','<num>')) ou um
  // trecho com ...tr?id=<num>. Evita um fbq('init') invalido por engano.
  function cleanPixelId(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (/^\d{6,20}$/.test(v)) return v;
    const init = v.match(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,20})['"]/i);
    if (init) return init[1];
    const idp = v.match(/[?&]id=(\d{6,20})/);
    if (idp) return idp[1];
    const long = v.match(/\d{13,20}/);
    return long ? long[0] : '';
  }

  function setupMetaPixels(cfg) {
    const basePixelId = (cfg.meta_pixel_id || '').trim();
    const pageviewPixelId = (cfg.meta_pageview_pixel_id || '').trim();
    const pageviewEnabled = cfg.meta_pageview_enabled !== false;
    const pageviewOnMain = cfg.meta_pageview_on_main !== false;

    if (!basePixelId && !pageviewPixelId) return;

    ensureMetaScript();

    // Inicializa o Pixel Principal se configurado
    if (basePixelId) {
      window.fbq('init', basePixelId);
    }

    // Inicializa o Pixel de PageView dedicado (se diferente do principal)
    if (pageviewPixelId && pageviewPixelId !== basePixelId) {
      window.fbq('init', pageviewPixelId);
    }

    // Dispara o evento PageView
    if (pageviewEnabled) {
      if (pageviewPixelId) {
        window.fbq('trackSingle', pageviewPixelId, 'PageView');
        if (basePixelId && pageviewPixelId !== basePixelId && pageviewOnMain) {
          window.fbq('trackSingle', basePixelId, 'PageView');
        }
      } else if (basePixelId) {
        window.fbq('trackSingle', basePixelId, 'PageView');
      }
    }
  }

  function injectMetaPixel(pixelId) {
    setupMetaPixels({ meta_pixel_id: pixelId, meta_pageview_enabled: true });
  }

  function injectGoogleTagManager(gtmId) {
    if (!gtmId || window.google_tag_manager) return;
    (function (w, d, s, l, i) {
      w[l] = w[l] || [];
      w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      var f = d.getElementsByTagName(s)[0],
        j = d.createElement(s),
        dl = l != 'dataLayer' ? '&l=' + l : '';
      j.async = true;
      j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
      f.parentNode.insertBefore(j, f);
    })(window, document, 'script', 'dataLayer', gtmId);
  }

  function injectGoogleGtag(ga4Id, gAdsId) {
    const mainId = ga4Id || gAdsId;
    if (!mainId || window.gtag) return;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag('js', new Date());

    if (ga4Id) gtag('config', ga4Id);
    if (gAdsId && gAdsId !== ga4Id) gtag('config', gAdsId);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(mainId)}`;
    document.head.appendChild(script);
  }

  function injectTikTokPixel(ttId) {
    if (!ttId || window.ttq) return;
    (function (w, d, t) {
      w.TiktokAnalyticsObject = t;
      var ttq = (w[t] = w[t] || []);
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
      ttq.setAndDefer = function (t, e) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.load = function (e, n) {
        var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        var o = d.createElement('script');
        o.type = 'text/javascript';
        o.async = !0;
        o.src = r + '?sdkid=' + e + '&lib=' + t;
        var a = d.getElementsByTagName('script')[0];
        a.parentNode.insertBefore(o, a);
      };
      ttq.load(ttId);
      ttq.page();
    })(window, document, 'ttq');
  }

  // ── 3. Fila & Disparo dos Eventos Padrão ──
  const eventQueue = [];
  let isReady = false;

  function trackEvent(metaName, ga4Name, data) {
    if (!isReady) {
      eventQueue.push({ metaName, ga4Name, data });
      return;
    }
    dispatchTrackEvent(metaName, ga4Name, data);
  }

  function dispatchTrackEvent(metaName, ga4Name, data) {
    // Meta Ads Pixel
    if (window.fbq && metaName) {
      const targetPixelId = trackingConfig && (trackingConfig.meta_pixel_id || trackingConfig.meta_pageview_pixel_id);
      if (targetPixelId) {
        if (data && data.eventId) {
          window.fbq('trackSingle', targetPixelId, metaName, data.metaPayload || {}, { eventID: data.eventId });
        } else {
          window.fbq('trackSingle', targetPixelId, metaName, data ? (data.metaPayload || data) : {});
        }
      } else {
        if (data && data.eventId) {
          window.fbq('track', metaName, data.metaPayload || {}, { eventID: data.eventId });
        } else {
          window.fbq('track', metaName, data ? (data.metaPayload || data) : {});
        }
      }
    }

    // Google Tag / GA4
    if (window.gtag && ga4Name) {
      window.gtag('event', ga4Name, data ? (data.gaPayload || data) : {});
    }

    // TikTok Pixel
    if (window.ttq && metaName) {
      window.ttq.track(metaName, data ? (data.metaPayload || data) : {});
    }

    // Disparo específico do Google Ads Conversion para compra
    if (data && data.isPurchase && trackingConfig && trackingConfig.google_ads_conversion_id && trackingConfig.google_ads_conversion_label && window.gtag) {
      window.gtag('event', 'conversion', {
        send_to: `${trackingConfig.google_ads_conversion_id}/${trackingConfig.google_ads_conversion_label}`,
        value: data.purchaseValue,
        currency: 'BRL',
        transaction_id: data.orderCode
      });
    }
  }

  function flushEventQueue() {
    isReady = true;
    while (eventQueue.length > 0) {
      const ev = eventQueue.shift();
      dispatchTrackEvent(ev.metaName, ev.ga4Name, ev.data);
    }
  }

  // ── 4. API Pública da NT Eleganz ──
  window.nteTracking = {
    getTrackingData() {
      const data = getStoredTracking();
      // Inclui cookies nativos da Meta se disponíveis
      data.fbp = getCookie('_fbp') || data.fbp || '';
      data.fbc = getCookie('_fbc') || data.fbc || '';
      return data;
    },

    // Visualização de Produto (PDP)
    trackViewContent(product) {
      if (!product) return;
      const price = typeof product.price === 'number' ? product.price : parseFloat(String(product.price || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const id = String(product.id || product.slug || 'prod');
      const name = product.name || 'Produto';

      trackEvent('ViewContent', 'view_item', {
        metaPayload: {
          content_name: name,
          content_ids: [id],
          content_type: 'product',
          value: price,
          currency: 'BRL'
        },
        gaPayload: {
          currency: 'BRL',
          value: price,
          items: [{ item_id: id, item_name: name, price: price }]
        }
      });
    },

    // Adição ao Carrinho
    trackAddToCart(item) {
      if (!item) return;
      const price = typeof item.price === 'number' ? item.price : parseFloat(String(item.price || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const id = String(item.id || item.slug || 'prod');
      const name = item.name || 'Produto';
      const qty = Math.max(1, Number(item.qty) || 1);

      trackEvent('AddToCart', 'add_to_cart', {
        metaPayload: {
          content_name: name,
          content_ids: [id],
          content_type: 'product',
          value: price * qty,
          currency: 'BRL'
        },
        gaPayload: {
          currency: 'BRL',
          value: price * qty,
          items: [{ item_id: id, item_name: name, price: price, quantity: qty }]
        }
      });
    },

    // Entrada no Checkout
    trackInitiateCheckout(items, totalValue) {
      const total = typeof totalValue === 'number' ? totalValue : parseFloat(String(totalValue || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const contentIds = Array.isArray(items) ? items.map(i => String(i.id || i.slug || 'prod')) : [];
      const numItems = Array.isArray(items) ? items.reduce((a, b) => a + (Number(b.qty) || 1), 0) : 1;

      trackEvent('InitiateCheckout', 'begin_checkout', {
        metaPayload: {
          content_ids: contentIds,
          content_type: 'product',
          value: total,
          currency: 'BRL',
          num_items: numItems
        },
        gaPayload: {
          currency: 'BRL',
          value: total,
          items: Array.isArray(items) ? items.map(i => ({
            item_id: String(i.id || ''),
            item_name: i.name || '',
            price: i.price,
            quantity: i.qty || 1
          })) : []
        }
      });
    },

    // Compra Concluída (Página de Pedido / Thank You)
    trackPurchase(order, destination = 'checkout') {
      if (!order) return;
      const dest = destination || (order && order.channel) || 'checkout';
      const code = String(order.code || order.id || '').replace('#', '').toUpperCase();
      const storageLockKey = `nte_tracked_purchase_${code}_${dest}`;

      // Evita duplicação se o comprador atualizar (F5) a tela do pedido
      if (sessionStorage.getItem(storageLockKey)) {
        return;
      }
      sessionStorage.setItem(storageLockKey, '1');

      const total = typeof order.value === 'number' ? order.value : parseFloat(String(order.value || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const items = Array.isArray(order.items) ? order.items : [];
      const contentIds = items.map(i => String(i.id || i.slug || 'prod'));
      const eventId = `order_${dest}_${code}`;

      trackEvent('Purchase', 'purchase', {
        eventId: eventId,
        isPurchase: true,
        purchaseValue: total,
        orderCode: code,
        metaPayload: {
          content_ids: contentIds,
          content_type: 'product',
          value: total,
          currency: 'BRL',
          order_id: code,
          num_items: items.length || 1,
          destination: dest,
          channel: dest
        },
        gaPayload: {
          transaction_id: code,
          value: total,
          currency: 'BRL',
          destination: dest,
          items: items.map(i => ({
            item_id: String(i.id || ''),
            item_name: i.name || '',
            price: i.price,
            quantity: i.qty || 1
          }))
        }
      });
    },

    /**
     * Disparo oficial de Finalização de Compra (Checkout vs WhatsApp)
     * Informa ao Meta Ads exatamente para onde o cliente foi:
     * - destination: 'checkout' (Mercado Pago / Pix / Cartão no site)
     * - destination: 'whatsapp' (Finalização do pedido pelo WhatsApp)
     */
    trackOrderDispatch(destination, orderData = {}) {
      const dest = destination === 'whatsapp' ? 'whatsapp' : 'checkout';
      const rawVal = orderData.value ?? orderData.total ?? 0;
      const total = typeof rawVal === 'number'
        ? rawVal
        : parseFloat(String(rawVal || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const items = Array.isArray(orderData.items) ? orderData.items : [];
      const contentIds = items.map(i => String(i.id || i.slug || 'prod'));
      const code = String(orderData.code || orderData.orderCode || orderData.id || '').replace('#', '').toUpperCase();
      const numItems = items.reduce((a, b) => a + (Number(b.qty) || 1), 0) || 1;
      const eventId = code ? `dispatch_${dest}_${code}` : `dispatch_${dest}_${Date.now()}`;

      const metaPayload = {
        content_name: dest === 'whatsapp' ? 'Finalização via WhatsApp' : 'Finalização Checkout Site',
        content_ids: contentIds,
        content_type: 'product',
        value: total,
        currency: 'BRL',
        order_id: code || undefined,
        num_items: numItems,
        destination: dest,
        channel: dest
      };

      // Dispara Purchase com destination
      trackEvent('Purchase', 'purchase', {
        eventId: eventId,
        isPurchase: true,
        purchaseValue: total,
        orderCode: code,
        metaPayload: metaPayload,
        gaPayload: {
          transaction_id: code || undefined,
          value: total,
          currency: 'BRL',
          destination: dest,
          items: items.map(i => ({
            item_id: String(i.id || ''),
            item_name: i.name || '',
            price: i.price,
            quantity: i.qty || 1
          }))
        }
      });

      // Dispara eventos customizados para segmentação direta no Meta Ads
      if (window.fbq) {
        const targetPixelId = trackingConfig && (trackingConfig.meta_pixel_id || trackingConfig.meta_pageview_pixel_id);
        const customData = {
          destination: dest,
          value: total,
          currency: 'BRL',
          order_code: code,
          num_items: numItems
        };

        if (targetPixelId) {
          window.fbq('trackSingleCustom', targetPixelId, 'OrderDispatch', customData);
          window.fbq('trackSingleCustom', targetPixelId, dest === 'whatsapp' ? 'FinalizarWhatsApp' : 'FinalizarCheckout', customData);
        } else {
          window.fbq('trackCustom', 'OrderDispatch', customData);
          window.fbq('trackCustom', dest === 'whatsapp' ? 'FinalizarWhatsApp' : 'FinalizarCheckout', customData);
        }

        if (dest === 'whatsapp') {
          if (targetPixelId) {
            window.fbq('trackSingle', targetPixelId, 'Contact', { destination: 'whatsapp', value: total, currency: 'BRL' });
          } else {
            window.fbq('track', 'Contact', { destination: 'whatsapp', value: total, currency: 'BRL' });
          }
        }
      }
    },

    // Contato via WhatsApp — a conversão principal deste negócio ("a pessoa
    // selecionou o produto e foi para o WhatsApp"). Dispara Meta Lead +
    // Contact e GA4 generate_lead. É este evento que o tráfego pago otimiza.
    trackWhatsAppContact(data) {
      const payload = data || {};
      const value = typeof payload.value === 'number'
        ? payload.value
        : parseFloat(String(payload.value || 0).replace(/[^\d,.]/g, '').replace(',', '.')) || 0;
      const items = Array.isArray(payload.items) ? payload.items : [];
      const contentIds = items.map(i => String(i.id || i.slug || 'prod'));
      const numItems = items.reduce((a, b) => a + (Number(b.qty) || 1), 0) || 1;

      trackEvent('Lead', 'generate_lead', {
        metaPayload: {
          content_name: payload.productName || 'Pedido WhatsApp',
          content_ids: contentIds,
          content_type: 'product',
          value: value,
          currency: 'BRL',
          num_items: numItems,
          destination: 'whatsapp',
          channel: 'whatsapp'
        },
        gaPayload: { currency: 'BRL', value: value, destination: 'whatsapp' }
      });

      // Evento 'Contact' padrão da Meta — recomendado para campanhas de
      // mensagens/WhatsApp. Só dispara se o pixel estiver carregado.
      if (window.fbq) {
        const targetPixelId = trackingConfig && (trackingConfig.meta_pixel_id || trackingConfig.meta_pageview_pixel_id);
        const contactData = { destination: 'whatsapp', value: value, currency: 'BRL' };
        if (targetPixelId) {
          window.fbq('trackSingle', targetPixelId, 'Contact', contactData);
        } else {
          window.fbq('track', 'Contact', contactData);
        }
      }
    },

    // Disparo manual ou de rota de PageView
    trackPageView() {
      if (!window.fbq) return;
      const basePixelId = (trackingConfig && trackingConfig.meta_pixel_id || '').trim();
      const pageviewPixelId = (trackingConfig && trackingConfig.meta_pageview_pixel_id || '').trim();
      const pageviewEnabled = trackingConfig ? trackingConfig.meta_pageview_enabled !== false : true;
      const pageviewOnMain = trackingConfig ? trackingConfig.meta_pageview_on_main !== false : true;

      if (!pageviewEnabled) return;

      if (pageviewPixelId) {
        window.fbq('trackSingle', pageviewPixelId, 'PageView');
        if (basePixelId && pageviewPixelId !== basePixelId && pageviewOnMain) {
          window.fbq('trackSingle', basePixelId, 'PageView');
        }
      } else if (basePixelId) {
        window.fbq('trackSingle', basePixelId, 'PageView');
      }
    }
  };

  // ── 5. Inicialização ──
  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    captureUtms();

    try {
      const res = await fetch('/api/tracking.php', { cache: 'default' });
      const data = await res.json();
      if (data && data.success && data.settings && data.settings.active) {
        trackingConfig = data.settings;
        // Blinda contra ID colado como snippet/HTML: mantem so o numero.
        trackingConfig.meta_pixel_id = cleanPixelId(trackingConfig.meta_pixel_id);
        trackingConfig.meta_pageview_pixel_id = cleanPixelId(trackingConfig.meta_pageview_pixel_id);

        if (trackingConfig.meta_pixel_id || trackingConfig.meta_pageview_pixel_id) {
          setupMetaPixels(trackingConfig);
        }

        if (trackingConfig.gtm_id) {
          injectGoogleTagManager(trackingConfig.gtm_id);
        } else if (trackingConfig.ga4_id || trackingConfig.google_ads_conversion_id) {
          injectGoogleGtag(trackingConfig.ga4_id, trackingConfig.google_ads_conversion_id);
        }

        if (trackingConfig.tiktok_pixel_id) {
          injectTikTokPixel(trackingConfig.tiktok_pixel_id);
        }
      }
    } catch (e) {
      console.warn('[Tracking] Falha ao carregar configurações de pixels:', e);
    } finally {
      flushEventQueue();
    }
  }

  // Inicia imediatamente para paralelizar busca de configurações
  init();

})();
