/* ============================================
   NT ELEGANZ — DATABASE ABSTRACTION LAYER
   ============================================ */

(function () {
  'use strict';

  const CONFIG_KEY = 'nte_db_config';
  const LS_PREFIX = 'nte_';
  const PRODUCTS_SEEDED_KEY = 'nte_products_seeded';
  const ASSET_DB_NAME = 'nte_media_assets';
  const ASSET_STORE = 'assets';
  let assetDatabasePromise = null;

  // O catálogo (dados dos produtos) vive em data/products.json na Hostinger,
  // servido por api/products.php. As IMAGENS também ficam na Hostinger, em
  // assets/images/products/, enviadas por upload.php. O Supabase continua
  // sendo usado apenas para autenticar o admin e autorizar a escrita.
  const DEPLOYED_DB_CONFIG = Object.freeze({
    mode: 'hostinger',
    hostinger: Object.freeze({
      endpoint: '/api/products.php',
    }),
    supabase: Object.freeze({
      url: 'https://erpyzjxtxztokpxxpirq.supabase.co',
      anonKey: 'sb_publishable_vvD9OIWTX6dzYm9fFTa4yw_aRLZfYwU',
    }),
  });

  const BUILTIN_CUTOUTS = {
    'assets/images/product-polo.webp': 'assets/images/product-polo-cutout.webp',
    'assets/images/product-moncler.webp': 'assets/images/product-moncler-cutout.webp',
    'assets/images/product-birkenstock.webp': 'assets/images/product-birkenstock-cutout.webp',
    'assets/images/product-sundek.webp': 'assets/images/product-sundek-cutout.webp',
    'assets/images/product-allsaints.webp': 'assets/images/product-allsaints-cutout.webp',
  };

  const upgradeBuiltinImage = image => BUILTIN_CUTOUTS[image] || image;

  function normalizeRecord(item) {
    if (!item) return item;
    const record = { ...item };
    if (!record.createdAt && record.created_at) record.createdAt = record.created_at;
    if (!record.updatedAt && record.updated_at) record.updatedAt = record.updated_at;
    if (!record.productName && record.product_name) record.productName = record.product_name;
    if (!record.productBrand && record.product_brand) record.productBrand = record.product_brand;
    if (!record.imageUrl && record.image_url) record.imageUrl = record.image_url;
    if (record.image) record.image = upgradeBuiltinImage(record.image);
    if (Array.isArray(record.images)) record.images = record.images.map(upgradeBuiltinImage);

    // Normalização robusta para itens de pedidos (quando items vem como array, string JSON ou em raw_data)
    let orderItems = Array.isArray(record.items) ? record.items : [];
    if (!orderItems.length && typeof record.items === 'string') {
      try { orderItems = JSON.parse(record.items); } catch (_) {}
    }
    if (!orderItems.length && record.raw_data && record.raw_data.items) {
      try {
        orderItems = Array.isArray(record.raw_data.items) ? record.raw_data.items : JSON.parse(record.raw_data.items);
      } catch (_) {}
    }
    if (Array.isArray(orderItems) && orderItems.length > 0) {
      record.items = orderItems;
      const first = orderItems[0];
      if (!record.productName || record.productName === '—') {
        record.productName = orderItems.length > 1 ? (orderItems.length + ' itens no pedido') : (first.name || first.title || '');
      }
      if (!record.productBrand && first.brand) record.productBrand = first.brand;
      if (!record.size && first.size) record.size = first.size;
      if (!record.color && first.color) record.color = first.color;
      if (!record.imageUrl && (first.image || first.imageUrl)) record.imageUrl = first.image || first.imageUrl;
    }

    const stk = Number(record.stock);
    const isSingle = Number.isFinite(stk) && stk === 1 && record.available !== false && record.active !== false;
    record.singlePiece = isSingle;
    record.pecaUnica = isSingle;
    record.peca_unica = isSingle;
    record.single_piece = isSingle;

    return record;
  }

  function toRemoteRecord(item, isUpdate = false) {
    const record = { ...item };
    if (!isUpdate && !record.created_at) record.created_at = record.createdAt || new Date().toISOString();
    if (!isUpdate) delete record.createdAt;
    record.updated_at = record.updatedAt || new Date().toISOString();
    delete record.updatedAt;
    return record;
  }

  // ── Config ──
  function getConfig() {
    // A configuração implantada tem precedência: é o que garante que a vitrine
    // e o painel apontem para a mesma origem de dados em qualquer dispositivo.
    if (DEPLOYED_DB_CONFIG.hostinger?.endpoint) {
      return DEPLOYED_DB_CONFIG;
    }
    try {
      const c = localStorage.getItem(CONFIG_KEY);
      return c ? JSON.parse(c) : { mode: 'local' };
    } catch { return { mode: 'local' }; }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  // Imagens não devem ocupar o limite reduzido do LocalStorage. No modo local,
  // elas ficam no IndexedDB e o catálogo guarda apenas a referência da mídia.
  function getAssetDatabase() {
    if (assetDatabasePromise) return assetDatabasePromise;
    assetDatabasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('Armazenamento de mídia indisponível neste navegador.'));
      const request = indexedDB.open(ASSET_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(ASSET_STORE)) request.result.createObjectStore(ASSET_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento de mídia.'));
    });
    return assetDatabasePromise;
  }

  async function putAsset(key, value) {
    const database = await getAssetDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(ASSET_STORE, 'readwrite');
      transaction.objectStore(ASSET_STORE).put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível salvar a imagem.'));
    });
  }

  async function getAsset(key) {
    const database = await getAssetDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(ASSET_STORE, 'readonly').objectStore(ASSET_STORE).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Não foi possível carregar a imagem.'));
    });
  }

  async function deleteAsset(key) {
    const database = await getAssetDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(ASSET_STORE, 'readwrite');
      transaction.objectStore(ASSET_STORE).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Não foi possível excluir a imagem.'));
    });
  }

  function productImages(product) {
    const values = Array.isArray(product?.images) && product.images.length
      ? product.images
      : [product?.imageBase64 || product?.image];
    return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
  }

  async function getSupabaseAuthHeader() {
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

  async function uploadImageToServer(dataUrl, productId, index) {
    const uploadEndpoint = '/upload.php';
    const authHeader = await getSupabaseAuthHeader();
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

  async function prepareLocalProduct(item) {
    const product = { ...item };
    const images = productImages(product);
    const storedImages = [];

    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      if (image.startsWith('data:image/')) {
        try {
          const url = await uploadImageToServer(image, product.id, index);
          storedImages.push(url);
        } catch (error) {
          console.warn(`Falha ao fazer upload da imagem ${index}:`, error);
          storedImages.push(image);
        }
      } else {
        storedImages.push(image);
      }
    }

    product.images = storedImages.filter(Boolean);
    product.image = storedImages[0] || '';
    delete product.imageBase64;
    delete product.imageAssetIds;
    delete product.imageAssetId;
    return product;
  }

  async function hydrateLocalProduct(item) {
    const product = { ...item };
    const storedImages = Array.isArray(product.images) && product.images.length ? product.images : [product.image || ''];
    product.images = storedImages.filter(Boolean).map(upgradeBuiltinImage);
    product.image = product.images[0] || product.image || '';
    product.image = upgradeBuiltinImage(product.image);
    delete product.imageAssetIds;
    delete product.imageAssetId;
    return product;
  }

  function prepareSupabaseProduct(item) {
    const product = { ...item };
    // These values are derived by the storefront or duplicated in `image` and
    // are intentionally absent from the public.products schema.
    delete product.priceNum;
    delete product.imageBase64;
    delete product.imageAssetId;
    delete product.imageAssetIds;
    delete product.destaque;
    return product;
  }

  async function migrateLocalProductAssets(products) {
    let changed = false;
    const migrated = [];
    for (const product of products) {
      if ((typeof product.image === 'string' && product.image.startsWith('data:image/')) || (typeof product.imageBase64 === 'string' && product.imageBase64.startsWith('data:image/'))) {
        try {
          migrated.push(await prepareLocalProduct(product));
          changed = true;
        } catch (error) {
          console.warn('A imagem antiga não pôde ser migrada agora:', error);
          migrated.push(product);
        }
      } else {
        migrated.push(product);
      }
    }
    if (changed) {
      try { localDB.set('products', migrated); }
      catch (error) { console.warn('A migração das imagens será tentada novamente:', error); }
    }
    return migrated;
  }

  // ══════════════════════════════════════════
  //  LOCAL STORAGE BACKEND
  // ══════════════════════════════════════════

  const localDB = {
    get(collection) {
      try {
        const data = localStorage.getItem(LS_PREFIX + collection);
        return data ? JSON.parse(data) : [];
      } catch { return []; }
    },

    set(collection, data) {
      localStorage.setItem(LS_PREFIX + collection, JSON.stringify(data));
    },

    async getAll(collection, options = {}) {
      const { limit, offset } = options;
      const all = this.get(collection);
      if (limit !== undefined || offset !== undefined) {
        const start = offset || 0;
        const end = limit !== undefined ? start + limit : undefined;
        return all.slice(start, end);
      }
      return all;
    },

    async getAllCount(collection) {
      return this.get(collection).length;
    },

    async getById(collection, id) {
      const all = this.get(collection);
      return all.find(item => item.id === id) || null;
    },

    async add(collection, item) {
      const all = this.get(collection);
      const newItem = { ...item, id: item.id || generateId(), createdAt: new Date().toISOString() };
      all.push(newItem);
      this.set(collection, all);
      return newItem;
    },

    async update(collection, id, updates) {
      const all = this.get(collection);
      const idx = all.findIndex(item => item.id === id);
      if (idx === -1) throw new Error('Item não encontrado');
      all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
      this.set(collection, all);
      return all[idx];
    },

    async delete(collection, id) {
      const all = this.get(collection);
      if (!all.some(item => item.id === id)) throw new Error('Item não encontrado');
      const filtered = all.filter(item => item.id !== id);
      this.set(collection, filtered);
      if (this.get(collection).some(item => item.id === id)) throw new Error('Não foi possível concluir a exclusão');
      return true;
    },

    async clear(collection) {
      localStorage.removeItem(LS_PREFIX + collection);
    },

    async exportAll() {
      const products = this.get('products');
      const orders = this.get('orders');
      const leads = this.get('leads');
      const settings = this.get('settings');
      return { products, orders, leads, settings, exportedAt: new Date().toISOString() };
    },

    async importAll(data) {
      if (data.products) this.set('products', data.products);
      if (data.orders) this.set('orders', data.orders);
      if (data.leads) this.set('leads', data.leads);
      if (data.settings) this.set('settings', data.settings);
    },
  };

  // ══════════════════════════════════════════
  //  FIREBASE BACKEND (lazy loaded)
  // ══════════════════════════════════════════

  let firebaseApp = null;
  let firestoreDb = null;
  let lastInitError = null;

  async function initFirebase(config) {
    if (firebaseApp) return true;
    try {
      // Load Firebase SDKs dynamically
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');

      firebaseApp = firebase.initializeApp(config);
      firestoreDb = firebase.firestore();
      return true;
    } catch (e) {
      console.error('Firebase init error:', e);
      lastInitError = e;
      return false;
    }
  }

  const firebaseDB = {
    async getAll(collection, options = {}) {
      let query = firestoreDb.collection(collection);
      const { limit, offset } = options;
      if (limit !== undefined) query = query.limit(limit);
      if (offset !== undefined) query = query.offset(offset);
      const snap = await query.get();
      return snap.docs.map(d => normalizeRecord({ id: d.id, ...d.data() }));
    },

    async getAllCount(collection) {
      const snap = await firestoreDb.collection(collection).count().get();
      return snap.data().count;
    },

    async getById(collection, id) {
      const doc = await firestoreDb.collection(collection).doc(id).get();
      return doc.exists ? normalizeRecord({ id: doc.id, ...doc.data() }) : null;
    },

    async add(collection, item) {
      const data = { ...item, createdAt: new Date().toISOString() };
      const ref = await firestoreDb.collection(collection).add(data);
      return normalizeRecord({ id: ref.id, ...data });
    },

    async update(collection, id, updates) {
      await firestoreDb.collection(collection).doc(id).update({
        ...updates, updatedAt: new Date().toISOString()
      });
      return this.getById(collection, id);
    },

    async delete(collection, id) {
      await firestoreDb.collection(collection).doc(id).delete();
    },

    async clear(collection) {
      const snap = await firestoreDb.collection(collection).get();
      const batch = firestoreDb.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    },

    async exportAll() {
      const products = await this.getAll('products');
      const orders = await this.getAll('orders');
      const leads = await this.getAll('leads');
      const settings = await this.getAll('settings');
      return { products, orders, leads, settings, exportedAt: new Date().toISOString() };
    },

    async importAll(data) {
      if (data.products) {
        for (const p of data.products) {
          await firestoreDb.collection('products').doc(p.id).set(p);
        }
      }
      if (data.orders) {
        for (const o of data.orders) {
          await firestoreDb.collection('orders').doc(o.id).set(o);
        }
      }
      if (data.leads) {
        for (const lead of data.leads) await firestoreDb.collection('leads').doc(lead.id).set(lead);
      }
      if (data.settings) {
        for (const setting of data.settings) await firestoreDb.collection('settings').doc(setting.id).set(setting);
      }
    },
  };

  // ══════════════════════════════════════════
  //  SUPABASE BACKEND (lazy loaded)
  // ══════════════════════════════════════════

  let supabaseClient = null;
  let supabaseInitPromise = null;

  async function initSupabase(config) {
    if (supabaseClient) return true;
    if (supabaseInitPromise) return supabaseInitPromise;

    // Several storefront modules may initialize the database at once. Share a
    // single loading promise so none of them tries to use the SDK before its
    // external script has finished loading.
    supabaseInitPromise = (async () => {
      try {
        if (window.ntAuth?.getClient) {
          const sharedClient = await window.ntAuth.getClient();
          if (sharedClient) {
            supabaseClient = sharedClient;
            return true;
          }
        }
        if (!window.supabase?.createClient) {
          await loadScript('/js/vendor/supabase.min.js');
        }
        if (!window.supabase?.createClient) throw new Error('A biblioteca do Supabase não foi carregada.');
        supabaseClient = window.supabase.createClient(config.url, config.anonKey);
        return true;
      } catch (e) {
        console.error('Supabase init error:', e);
        lastInitError = e;
        return false;
      } finally {
        supabaseInitPromise = null;
      }
    })();

    return supabaseInitPromise;
  }

  const supabaseDB = {
    async getAll(collection, options = {}) {
      let query = supabaseClient.from(collection).select('*', { count: 'exact' });
      const { limit, offset } = options;
      if (limit !== undefined) query = query.limit(limit);
      if (offset !== undefined) query = query.range(offset, offset + (limit || 1000) - 1);
      const { data, error, count } = await query;
      if (error) throw error;
      return { data: (data || []).map(normalizeRecord), count: count || 0 };
    },

    async getAllCount(collection) {
      const { count, error } = await supabaseClient.from(collection).select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },

    async getById(collection, id) {
      const { data, error } = await supabaseClient.from(collection).select('*').eq('id', id).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (error) return null;
      return normalizeRecord(data);
    },

    async add(collection, item) {
      const newItem = toRemoteRecord({ ...item, id: item.id || generateId() });
      const { data, error } = await supabaseClient.from(collection).insert(newItem).select().single();
      if (error) throw error;
      return normalizeRecord(data);
    },

    async submit(collection, item) {
      const newItem = toRemoteRecord({ ...item, id: item.id || generateId() });
      const { error } = await supabaseClient.from(collection).insert(newItem);
      if (error) throw error;
      return normalizeRecord(newItem);
    },

    async update(collection, id, updates) {
      const { data, error } = await supabaseClient
        .from(collection).update(toRemoteRecord(updates, true))
        .eq('id', id).select().single();
      if (error) throw error;
      return normalizeRecord(data);
    },

    async delete(collection, id) {
      const { data, error } = await supabaseClient
        .from(collection)
        .delete()
        .eq('id', id)
        .select();
      if (error) throw error;
      if (data && data.length > 0) return true;
      // O DELETE não devolveu a linha via RETURNING. Pode ser que a exclusão
      // tenha funcionado e o retorno tenha sido filtrado pelo RLS, ou que o RLS
      // tenha bloqueado. Verifica se o registro ainda existe para diferenciar.
      const { data: remaining, error: readError } = await supabaseClient
        .from(collection)
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (readError && readError.code !== 'PGRST116') throw readError;
      if (remaining) {
        throw new Error('A exclusão foi bloqueada pelas regras de segurança (RLS): o registro continua no banco. Confirme se você está logado como admin ou se o SQL database/supabase-schema.sql foi executado.');
      }
      return true;
    },

    async clear(collection) {
      const { error } = await supabaseClient.from(collection).delete().neq('id', '');
      if (error) throw error;
    },

    async exportAll() {
      const products = await this.getAll('products');
      const orders = await this.getAll('orders');
      const leads = await this.getAll('leads');
      const settings = await this.getAll('settings');
      return { products, orders, leads, settings, exportedAt: new Date().toISOString() };
    },

    async importAll(data) {
      if (data.products) {
        const { error } = await supabaseClient.from('products').upsert(data.products.map(item => toRemoteRecord(item)));
        if (error) throw error;
      }
      if (data.orders) {
        const { error } = await supabaseClient.from('orders').upsert(data.orders.map(item => toRemoteRecord(item)));
        if (error) throw error;
      }
      if (data.leads) {
        const { error } = await supabaseClient.from('leads').upsert(data.leads.map(item => toRemoteRecord(item)));
        if (error) throw error;
      }
      if (data.settings) {
        const { error } = await supabaseClient.from('settings').upsert(data.settings.map(item => toRemoteRecord(item)));
        if (error) throw error;
      }
    },
  };

  // ══════════════════════════════════════════
  //  HOSTINGER BACKEND (catálogo em JSON)
  //
  //  Os produtos ficam em data/products.json na hospedagem, expostos por
  //  api/products.php. A leitura é pública; a escrita exige a sessão do
  //  admin, que continua sendo autenticada pelo Supabase — por isso este
  //  backend também precisa do cliente Supabase, apenas para enviar o JWT.
  // ══════════════════════════════════════════

  let hostingerEndpoint = DEPLOYED_DB_CONFIG.hostinger.endpoint;
  const hostingerETags = new Map();

  function productsUrl(extra) {
    const base = hostingerEndpoint.split('?')[0];
    const query = new URLSearchParams(hostingerEndpoint.split('?')[1] || '');
    Object.entries(extra || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, value);
    });
    const suffix = query.toString();
    return suffix ? `${base}?${suffix}` : base;
  }

  /** Token do admin logado, para autorizar escrita. Ausente na vitrine. */
  async function adminAccessToken() {
    try {
      const localToken = localStorage.getItem('nte_admin_token');
      if (localToken) return localToken;
      const client = await window.ntAuth?.getClient?.();
      const { data } = await client?.auth?.getSession?.() ?? {};
      return data?.session?.access_token || '';
    } catch (error) {
      console.warn('Não foi possível obter a sessão do admin:', error);
      return '';
    }
  }

  function httpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
  }

  function readHttpError(status, payload) {
    const server = typeof payload === 'object' ? payload?.error : null;
    if (server) return server;
    if (status === 401) return 'Sessão expirada. Faça login novamente no painel.';
    if (status === 403) return 'Acesso negado: apenas administradores podem alterar o catálogo.';
    if (status === 404) return 'Produto não encontrado.';
    if (status === 409) return 'Já existe um produto com este id.';
    if (status === 429) return 'Muitas alterações em pouco tempo. Aguarde alguns minutos.';
    return `Falha na comunicação com o catálogo (HTTP ${status}).`;
  }

  async function parseResponse(response) {
    if (response.status === 204) return null;
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch (error) { payload = null; }
    }
    if (!response.ok) throw httpError(response.status, readHttpError(response.status, payload));
    return payload;
  }

    function ordersUrl(query = {}) {
      const base = '/api/orders.php';
      const params = new URLSearchParams();
      if (query.id) params.set('id', query.id);
      const qs = params.toString();
      return qs ? `${base}?${qs}` : base;
    }

    // A API de pedidos só entrega a lista completa e só aceita alterar/apagar com o admin logado. No painel
    // vai a sessão; na loja (sem sessão de admin) não vai header nenhum e as chamadas públicas seguem iguais.
    async function ordersAuthHeaders() {
      const token = await adminAccessToken();
      return token ? { Authorization: `Bearer ${token}`, 'X-Upload-Token': token } : {};
    }

  const hostingerDB = {
    async getAll(collection, options = {}) {
      if (collection === 'orders') {
        const response = await fetch(ordersUrl(), { cache: 'no-store', headers: await ordersAuthHeaders() });
        const payload = await parseResponse(response);
        return Array.isArray(payload?.orders) ? payload.orders.map(normalizeRecord) : [];
      }

      if (collection !== 'products') {
        throw new Error(`A API da Hostinger não atende a coleção "${collection}".`);
      }

      const { limit, offset, reload } = options;
      const url = productsUrl({ limit, offset });
      const headers = {};
      // `reload` desliga a revalidação por ETag quando o corpo é obrigatório.
      const etag = reload ? null : hostingerETags.get('products');
      if (etag) headers['If-None-Match'] = etag;

      const response = await fetch(url, { headers, cache: 'no-store' });
      const fresh = response.headers.get('ETag');
      if (fresh) hostingerETags.set('products', fresh);

      if (response.status === 304) {
        return { data: null, count: undefined, notModified: true };
      }

      const payload = await parseResponse(response);
      const products = Array.isArray(payload?.products) ? payload.products : [];
      if (limit === undefined && offset === undefined) return products;

      const start = offset || 0;
      const end = limit !== undefined ? start + limit : undefined;
      return { data: products.slice(start, end), count: products.length };
    },

    async getAllCount(collection) {
      const result = await this.getAll(collection);
      return Array.isArray(result) ? result.length : (result?.count ?? 0);
    },

    async getById(collection, id) {
      if (collection === 'orders') {
        const all = await this.getAll('orders');
        return all.find(o => String(o.id) === String(id) || String(o.code) === String(id)) || null;
      }
      if (collection !== 'products') return null;
      const response = await fetch(productsUrl({ id }), { cache: 'no-store' });
      if (response.status === 404) return null;
      const payload = await parseResponse(response);
      return payload?.product ? normalizeRecord(payload.product) : null;
    },

    async add(collection, item) {
      if (collection === 'orders') {
        const response = await fetch(ordersUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await ordersAuthHeaders()) },
          body: JSON.stringify(item),
        });
        const payload = await parseResponse(response);
        return normalizeRecord(payload?.order || item);
      }
      if (collection !== 'products') throw new Error('A API da Hostinger só grava produtos.');
      const token = await adminAccessToken();
      if (!token) {
        throw httpError(401, 'Faça login no painel para criar produtos.');
      }
      const response = await fetch(productsUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(item),
      });
      const payload = await parseResponse(response);
      hostingerETags.delete('products');
      return normalizeRecord(payload?.product);
    },

    async submit(collection, item) {
      if (collection === 'orders') {
        return await this.add('orders', item);
      }
      return await this.add(collection, item);
    },

    async update(collection, id, updates) {
      if (collection === 'orders') {
        const response = await fetch(ordersUrl({ id }), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(await ordersAuthHeaders()) },
          body: JSON.stringify({ ...updates, id }),
        });
        const payload = await parseResponse(response);
        return normalizeRecord(payload?.order || { id, ...updates });
      }
      if (collection !== 'products') throw new Error('A API da Hostinger só grava produtos.');
      const token = await adminAccessToken();
      if (!token) {
        throw httpError(401, 'Faça login no painel para editar produtos.');
      }
      const response = await fetch(productsUrl(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...updates, id }),
      });
      const payload = await parseResponse(response);
      hostingerETags.delete('products');
      return normalizeRecord(payload?.product);
    },

    async delete(collection, id) {
      if (collection === 'orders') {
        const response = await fetch(ordersUrl({ id }), {
          method: 'DELETE',
          headers: await ordersAuthHeaders(),
        });
        await parseResponse(response);
        return true;
      }
      if (collection !== 'products') throw new Error('A API da Hostinger só apaga produtos.');
      const token = await adminAccessToken();
      if (!token) {
        throw httpError(401, 'Faça login no painel para excluir produtos.');
      }
      const response = await fetch(productsUrl({ id }), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      await parseResponse(response);
      hostingerETags.delete('products');
      return true;
    },

    async clear(collection) {
      if (collection !== 'products') throw new Error('A API da Hostinger só apaga produtos.');
      const existing = await this.getAll(collection);
      for (const product of existing) {
        await this.delete(collection, product.id);
      }
    },

    async exportAll() {
      const products = await this.getAll('products');
      return { products, exportedAt: new Date().toISOString() };
    },

    async importAll(data) {
      const incoming = Array.isArray(data?.products) ? data.products : [];
      const existing = await this.getAll('products');
      const byId = new Map(existing.map(product => [product.id, product]));
      for (const product of incoming) {
        if (byId.has(product.id)) {
          await this.update('products', product.id, product);
        } else {
          await this.add('products', product);
        }
      }
    },
  };

  // ══════════════════════════════════════════
  //  ACTIVE BACKEND SELECTOR
  // ══════════════════════════════════════════

  let activeBackend = localDB;
  let syncChannel = null;
  let supabaseAvailable = false;
  // Falso até init() terminar de descobrir qual backend está ativo. Enquanto
  // isso, um snapshot em memória tem precedência sobre o modo local provisório.
  let backendResolved = false;

  // Os produtos vivem na Hostinger (api/products.php). Pedidos, leads e
  // conteúdo editorial continuam no Supabase, junto com a autenticação. Sem
  // este roteador, o modo `hostinger` mandaria também essas coleções para a
  // API da Hostinger, que não as atende, e o admin perderia pedidos/leads.
  function backendFor(collection) {
    if (activeBackend !== hostingerDB) return activeBackend;
    if (collection === 'products' || collection === 'orders') return hostingerDB;
    if (supabaseAvailable) return supabaseDB;
    throw new Error(
      `A coleção "${collection}" continua no Supabase, mas o SDK não pôde ser inicializado. ` +
      'Verifique as credenciais em DEPLOYED_DB_CONFIG.supabase.'
    );
  }

  try {
    if ('BroadcastChannel' in window) {
      syncChannel = new BroadcastChannel('nte-data-sync');
      syncChannel.addEventListener('message', event => {
        const collection = event.data?.collection;
        if (!/^[a-z][a-z0-9_-]*$/i.test(collection || '')) return;
        window.dispatchEvent(new CustomEvent(`nte:${collection}-changed`, {
          detail: { external: true, source: 'broadcast' },
        }));
      });
    }
  } catch (error) {
    console.warn('Sincronização entre abas indisponível:', error);
  }

  // ══════════════════════════════════════════
  //  HYDRATION LAYER (remote backends only)
  //
  //  A primeira leitura de uma coleção busca tudo no servidor e guarda em
  //  memória + LocalStorage para a vitrine abrir instantaneamente. O snapshot
  //  em disco é stale-while-revalidate: pinta a tela primeiro e é revalidado em
  //  segundo plano já no carregamento, sem esperar TTL. A requisição é
  //  condicional (If-None-Match), então quando nada mudou o custo é um 304 sem
  //  corpo. Se a assinatura do conteúdo divergir, o snapshot é reescrito e
  //  `nte:<collection>-changed` é disparado; edições feitas em outra aba
  //  chegam pelo mesmo evento (BroadcastChannel) ou pela revalidação.
  //  O modo local ignora o cache e lê direto do LocalStorage/IndexedDB.
  // ══════════════════════════════════════════

  const hydratedMemory = new Map();

  function hydrationEntry(name) {
    if (!hydratedMemory.has(name)) {
      hydratedMemory.set(name, { data: undefined, promise: null, refreshing: null, fresh: false });
    }
    return hydratedMemory.get(name);
  }

  function snapshotKeyFor(name) {
  return name === 'products'
    ? 'nte_hydrated_products_v2'
    : `nte_hydrated_${name}`;
}

  function loadSnapshot(name) {
    try {
      const raw = localStorage.getItem(snapshotKeyFor(name));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Formato atual: { savedAt, data }. O array puro de versões antigas é
      // aceito e tratado como expirado, para forçar um re-fetch.
      // Novo formato inclui opcionalmente etag para revalidação condicional.
      if (Array.isArray(parsed)) {
        return { savedAt: 0, data: parsed, legacy: true };
      }
      if (parsed && Array.isArray(parsed.data)) {
        return { savedAt: Number(parsed.savedAt) || 0, data: parsed.data, etag: parsed.etag, legacy: false };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  function saveSnapshot(name, data, etag) {
    if (activeBackend === localDB) return;
    try {
      const tag = name === 'products'
        ? (etag || hostingerETags.get('products'))
        : undefined;
      localStorage.setItem(snapshotKeyFor(name), JSON.stringify({
        savedAt: Date.now(), data, etag: tag
      }));
    } catch (error) {
      console.warn(`Falha ao salvar snapshot de ${name}`, error);
    }
  }

  /**
   * Assinatura do conteúdo. Precisa refletir qualquer campo que a vitrine
   * renderiza: comparar apenas id/updatedAt/active deixaria passar edições de
   * preço, nome, imagem ou estoque, que são justamente o que não re-renderiza.
   */
  function hydrateSignature(items) {
    const rows = Array.isArray(items) ? items : [];
    const keys = new Set();
    rows.forEach(row => {
      if (row && typeof row === 'object') Object.keys(row).forEach(key => keys.add(key));
    });
    const ordered = [...keys].sort();
    return rows
      .map(row => ordered.map(key => `${key}=${row?.[key] === undefined ? '' : JSON.stringify(row[key])}`).join(';'))
      .join('|');
  }

  async function fetchProducts(options = {}) {
    const result = await activeBackend.getAll('products', options);
    if (result && typeof result === 'object' && result.notModified) {
      return null; // 304: o ETag não mudou, o cache local continua válido.
    }
    const products = Array.isArray(result) ? result : (result?.data || []);
    const localProducts = activeBackend === localDB ? await migrateLocalProductAssets(products) : products;
    const resolved = activeBackend === localDB ? await Promise.all(localProducts.map(hydrateLocalProduct)) : localProducts;
    return resolved.map(normalizeRecord);
  }

  async function fetchFinalCollection(name, options = {}) {
    if (name === 'products') return fetchProducts(options);
    const result = await backendFor(name).getAll(name, options);
    const rows = Array.isArray(result) ? result : (result?.data || []);
    return rows.map(normalizeRecord);
  }

  function invalidateHydration(name) {
    const entry = hydrationEntry(name);
    entry.data = undefined;
    entry.promise = null;
    entry.refreshing = null;
    entry.fresh = false;
  }

  // Aplica um corpo recém-buscado ao cache de memória e ao snapshot em disco.
  // Notifica a vitrine só quando a assinatura do conteúdo muda de fato — é o
  // que impede o grid de ser remontado a cada polling sem motivo.
  function applyFresh(name, fresh) {
    const entry = hydrationEntry(name);
    const changed = hydrateSignature(entry.data) !== hydrateSignature(fresh);
    entry.data = fresh;
    entry.fresh = true;
    entry.promise = null;
    saveSnapshot(name, fresh);
    if (changed) notifyCollectionChanged(name);
    return changed;
  }

  function scheduleHydration(name, force = false) {
    if (activeBackend === localDB) return null;
    const entry = hydrationEntry(name);
    if (entry.refreshing) return entry.refreshing;
    if (!force && entry.data !== undefined) return null;
    entry.refreshing = fetchFinalCollection(name)
      .then(fresh => {
        // 304: nada mudou no servidor. Mantém o cache e encerra, sem re-render.
        if (fresh === null) {
          entry.fresh = true;
          return;
        }
        applyFresh(name, fresh);
      })
      .catch(error => console.warn(`Não foi possível atualizar "${name}" em segundo plano:`, error))
      .finally(() => { entry.refreshing = null; });
    return entry.refreshing;
  }

  // Carrega o snapshot do disco para a memória. Não agenda rede: quem sabe qual
  // backend está ativo é initDB(), que dispara a revalidação em seguida. Manter
  // as duas coisas separadas permite aquecer o cache antes de `init()` resolver.
  function primeHydration(name) {
    const entry = hydrationEntry(name);
    if (entry.data !== undefined || entry.promise) return;
    const snapshot = loadSnapshot(name);
    if (snapshot && Array.isArray(snapshot.data)) {
      entry.data = snapshot.data;
    }
  }

  // Uma alteração vinda de OUTRA aba (ou de outro dispositivo, via revalidação
  // por TTL) precisa invalidar o cache: os dados locais estão velhos.
  // Quando a alteração é desta própria aba, o cache JÁ foi atualizado por
  // updateHydrated() antes do evento; invalidar aqui jogaria fora a escrita
  // otimista e forçaria um re-fetch desnecessário. Por isso o evento só
  // invalida quando não é de origem local.
  ['products', 'orders', 'leads', 'settings'].forEach(collection => {
    window.addEventListener(`nte:${collection}-changed`, event => {
      if (event?.detail && event.detail.source === 'current-window') return;
      invalidateHydration(collection);
    });
  });

  async function hydratedRead(name, options = {}) {
    const entry = hydrationEntry(name);
    // Antes de init() resolver o modo ainda é desconhecido, e `activeBackend`
    // vale localDB só por omissão. Um snapshot em memória é dado real do
    // servidor, então serve melhor do que a lista local de desenvolvimento: é o
    // que permite pintar a vitrine sem esperar o probe de products.php.
    if (!backendResolved) {
      return entry.data !== undefined ? entry.data : fetchFinalCollection(name, options);
    }
    if (activeBackend === localDB) return fetchFinalCollection(name, options);
    // `reload` ignora o cache: usado pela vitrine no visibilitychange e no
    // poller, para enxergar edições feitas em outro dispositivo.
    if (options.reload) {
      entry.promise = null;
      const fresh = await fetchFinalCollection(name, { reload: true });
      if (fresh === null) return entry.data; // 304: o cache local está correto
      entry.data = fresh;
      entry.fresh = true;
      saveSnapshot(name, fresh);
      return fresh;
    }
    if (entry.data !== undefined) {
      return entry.data;
    }
    if (entry.promise) return entry.promise;
    entry.promise = fetchFinalCollection(name, options)
      .then(data => {
        if (data === null) {
          // 304 sem cache em memória (aba nova que só tinha o ETag salvo).
          // Repete uma vez sem o If-None-Match para obter o corpo.
          entry.promise = null;
          return fetchFinalCollection(name, { reload: true }).then(body => {
            entry.data = body;
            entry.fresh = true;
            saveSnapshot(name, body);
            return body;
          });
        }
        entry.data = data;
        entry.fresh = true;
        entry.promise = null;
        saveSnapshot(name, data);
        return data;
      })
      .catch(error => { entry.promise = null; throw error; });
    return entry.promise;
  }

  function updateHydrated(name, updater) {
    if (activeBackend === localDB) return;
    const entry = hydrationEntry(name);
    // Sem cache carregado ainda não há o que atualizar: o próximo getAll()
    // busca do servidor, que é a fonte da verdade. Persistir aqui criaria
    // um snapshot contendo só o registro alterado e apagaria o resto.
    if (entry.data === undefined) return;
    entry.data = updater(entry.data);
    entry.promise = null;
    saveSnapshot(name, entry.data);
  }

  async function hydrateRefresh(name) {
    if (activeBackend === localDB) return null;
    return scheduleHydration(name, true);
  }

  /**
   * Confere que a API da Hostinger responde. Sem isso, um endpoint não
   * publicado cairia silenciosamente no modo local e o admin gravaria no
   * LocalStorage do navegador, achando que salvou no servidor.
   *
   * Devolve o catálogo junto. O probe já pagou o download, então descartar o
   * corpo seria desperdício — e, pior, guardar o ETag sem aplicar o corpo
   * deixaria a revalidação seguinte receber 304 e manter o snapshot velho para
   * sempre, porque o 304 significa "o que você tem já é o que eu tenho".
   */
  async function initHostinger(config) {
    hostingerEndpoint = config.endpoint || DEPLOYED_DB_CONFIG.hostinger.endpoint;
    try {
      const snapshot = loadSnapshot('products');
      let products;
      if (snapshot && snapshot.data && Array.isArray(snapshot.data)) {
        products = snapshot.data;
      }
      const storedEtag = snapshot?.etag;
      const ifNoneMatch = Array.isArray(products)
        ? storedEtag
        : null;
      const headers = {};
      if (ifNoneMatch) headers['If-None-Match'] = ifNoneMatch;
      const response = await fetch(productsUrl(), { headers, cache: 'no-store' });
      const freshETag = response.headers.get('ETag');
      if (response.status === 304) {
        if (!products && snapshot) products = snapshot.data;
        if (!Array.isArray(products)) {
          // Se não houver esse array, refaça a busca sem If-None-Match para obter o corpo completo.
          delete headers['If-None-Match'];
          const retryResponse = await fetch(productsUrl(), { headers, cache: 'no-store' });
          const retryFreshETag = retryResponse.headers.get('ETag');
          if (!retryResponse.ok) {
            throw new Error(`HTTP ${retryResponse.status}`);
          }
          const retryPayload = await parseResponse(retryResponse);
          const newProducts = Array.isArray(retryPayload) ? retryPayload : (retryPayload?.products);
          if (!Array.isArray(newProducts)) {
            throw new Error('Formato de resposta inválido da API da Hostinger');
          }
          products = newProducts.map(normalizeRecord);
          if (retryFreshETag) {
            hostingerETags.set('products', retryFreshETag);
          } else {
            hostingerETags.delete('products');
          }
          saveSnapshot('products', products, retryFreshETag);
          return { ok: true, products };
        }
        if (freshETag) {
          hostingerETags.set('products', freshETag);
        } else {
          hostingerETags.delete('products');
        }
        return { ok: true, products, notModified: true };
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await parseResponse(response);
      const newProducts = Array.isArray(payload) ? payload : (payload?.products);
      if (!Array.isArray(newProducts)) {
        throw new Error('Formato de resposta inválido da API da Hostinger');
      }
      products = newProducts.map(normalizeRecord);
      if (freshETag) {
        hostingerETags.set('products', freshETag);
      } else {
        hostingerETags.delete('products');
      }
      saveSnapshot('products', products, freshETag);
      return { ok: true, products };
    } catch (error) {
      lastInitError = new Error(
        `Não foi possível acessar ${hostingerEndpoint} (${error.message}). ` +
        'Confirme se api/products.php e data/products.json foram publicados na public_html.'
      );
      return { ok: false };
    }
  }

  // `init()` é chamado por vários módulos da mesma página (main, catalog, faq,
  // editorial, whatsapp, cart). Sem memoizar, cada chamada reexecutava o probe
  // `no-store` contra products.php: a home disparava o mesmo request quatro
  // vezes e a revalidação por ETag do catálogo virava inútil.
  let initPromise = null;

  function initDB() {
    if (initPromise) return initPromise;
    initPromise = runInit()
      .catch(error => {
        // Falha não é memoizada: um retry precisa conseguir reconectar.
        initPromise = null;
        throw error;
      })
      .finally(() => { backendResolved = true; });
    return initPromise;
  }

  async function runInit() {
    const config = getConfig();
    lastInitError = null;

    if (config.mode === 'hostinger') {
      const probe = await initHostinger(config.hostinger || DEPLOYED_DB_CONFIG.hostinger);
      if (probe?.ok) {
        activeBackend = hostingerDB;
        // Produtos na Hostinger; pedidos, leads e settings no Supabase.
        // Carrega o Supabase em segundo plano para não atrasar a renderização da vitrine (economiza ~500ms).
        initSupabase(config.supabase || DEPLOYED_DB_CONFIG.supabase)
          .then(ok => { supabaseAvailable = ok; })
          .catch(() => { supabaseAvailable = false; });
        primeHydration('products');
        primeHydration('settings');
        applyFresh('products', probe.products);
        scheduleHydration('settings', false);
        return { mode: 'hostinger', ok: true };
      }
      throw new Error(lastInitError?.message || 'Não foi possível conectar à API de produtos da Hostinger.');
    }

    if (config.mode === 'firebase' && config.firebase) {
      const ok = await initFirebase(config.firebase);
      if (ok) {
        activeBackend = firebaseDB;
        primeHydration('products');
        primeHydration('settings');
        scheduleHydration('products', true);
        scheduleHydration('settings', true);
        return { mode: 'firebase', ok: true };
      }
    } else if (config.mode === 'supabase' && config.supabase) {
      const ok = await initSupabase(config.supabase);
      if (ok) {
        activeBackend = supabaseDB;
        primeHydration('products');
        primeHydration('settings');
        scheduleHydration('products', true);
        scheduleHydration('settings', true);
        return { mode: 'supabase', ok: true };
      }
      throw new Error(lastInitError?.message || 'Não foi possível conectar ao Supabase. O painel admin não funcionará sem a conexão.');
    }

    activeBackend = localDB;
    // O snapshot pré-aquecido veio de um backend remoto. No modo local a fonte
    // da verdade é o LocalStorage/IndexedDB, então descartá-lo para não servir
    // catálogo de outra origem como se fosse o local.
    invalidateHydration('products');
    invalidateHydration('settings');
    return { mode: 'local', ok: !lastInitError, error: lastInitError?.message || null };
  }

  // Seed default products if first time
  async function seedDefaults() {
    // Desabilitado: catálogo inicia vazio (sem produtos demo)
    return;
  }

  // ── Helpers ──
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Não foi possível carregar ${src}`)), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { s.dataset.loaded = 'true'; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function notifyCollectionChanged(collection) {
    window.dispatchEvent(new CustomEvent(`nte:${collection}-changed`, {
      detail: { external: false, source: 'current-window' },
    }));
    try {
      syncChannel?.postMessage({ collection, changedAt: Date.now() });
    } catch (error) {
      console.warn('Não foi possível avisar as outras abas:', error);
    }
  }

  // ── Export / Import ──
  // No modo `hostinger` o backup precisa misturar as duas origens: produtos
  // vêm da API da Hostinger e o resto do Supabase. Exportar só os produtos
  // daria a impressão de um backup completo quando pedidos e leads ficariam
  // de fora.
  async function exportAllData() {
    if (activeBackend !== hostingerDB) return activeBackend.exportAll();
    const data = await hostingerDB.exportAll();
    if (supabaseAvailable) {
      const rest = await supabaseDB.exportAll();
      return { ...data, ...rest, exportedAt: new Date().toISOString() };
    }
    return data;
  }

  async function importAllData(data) {
    if (activeBackend !== hostingerDB) return activeBackend.importAll(data);
    if (data?.products) await hostingerDB.importAll({ products: data.products });
    if (supabaseAvailable) await supabaseDB.importAll(data);
  }

  async function exportData() {
    const data = await exportAllData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nte-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = JSON.parse(e.target.result);
          await importAllData(data);
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  // ── Save DB config ──
  function setDBConfig(config) {
    saveConfig(config);
    hydratedMemory.clear();
    // Trocar de modo invalida a init memoizada: o probe e o backend precisam
    // rodar de novo contra a origem recém-escolhida.
    initPromise = null;
    backendResolved = false;
    // Reinit
    firebaseApp = null;
    firestoreDb = null;
    supabaseClient = null;
    supabaseInitPromise = null;
    supabaseAvailable = false;
    return initDB();
  }

  // ── Public API ──
  // O snapshot do catálogo já está no LocalStorage antes de qualquer request.
  // Carregá-lo aqui aquece o cache em memória no parse do arquivo, de modo que
  // `products.getAll()` devolve dados reais mesmo antes de `init()` resolver.
  // Só o snapshot entra aqui; a revalidação é agendada por initDB(), que é quem
  // sabe qual backend está ativo. No modo local hydratedRead ignora esse cache.
  primeHydration('products');
  primeHydration('settings');

  window.ntDB = {
    init: initDB,
    seed: seedDefaults,
    config: getConfig,
    setConfig: setDBConfig,
    refresh: hydrateRefresh,

    // Products
    products: {
      getCached: () => {
        const inMem = hydratedMemory.get('products')?.data;
        if (Array.isArray(inMem) && inMem.length) return inMem;
        const snap = loadSnapshot('products');
        if (snap && Array.isArray(snap.data) && snap.data.length) return snap.data;
        return null;
      },
      // `getAll({ reload: true })` desliga o cache e vai direto ao servidor.
      getAll: (options) => hydratedRead('products', options),
      // Atalho explícito para os pontos de chamada que sempre querem dado novo.
      reload: () => hydratedRead('products', { reload: true }),
      getPaginated: async (options = {}) => {
        const { limit = 20, offset = 0 } = options;
        if (activeBackend === localDB) {
          const all = await activeBackend.getAll('products', { limit, offset });
          return { data: all.map(hydrateLocalProduct), total: await activeBackend.getAllCount?.('products') || all.length };
        }
        const result = await activeBackend.getAll('products', { limit, offset });
        if (result && typeof result === 'object' && 'data' in result) {
          return { data: result.data.map(normalizeRecord), total: result.count };
        }
        return { data: result.map(normalizeRecord), total: await activeBackend.getAllCount?.('products') || result.length };
      },
      getById: async (id) => {
        if (activeBackend === localDB) {
          const product = await activeBackend.getById('products', id);
          return product ? hydrateLocalProduct(product) : null;
        }
        const list = await hydratedRead('products');
        return list.find(product => product.id === id) || null;
      },
      add: async (item) => {
        const itemWithId = { ...item, id: item.id || generateId() };
        const storedItem = activeBackend === localDB
          ? await prepareLocalProduct(itemWithId)
          : activeBackend === supabaseDB ? prepareSupabaseProduct(itemWithId) : itemWithId;
        const product = await activeBackend.add('products', storedItem);
        const result = normalizeRecord(activeBackend === localDB ? hydrateLocalProduct(product) : product);
        // A escrita já retornou o registro definitive: aplica no cache antes
        // de avisar, para que quem re-renderiza na mesma aba leia dado novo.
        updateHydrated('products', list => [...list.filter(item => item.id !== result.id), result]);
        notifyCollectionChanged('products');
        return result;
      },
      update: async (id, data) => {
        const storedData = activeBackend === localDB
          ? await prepareLocalProduct({ ...data, id })
          : activeBackend === supabaseDB ? prepareSupabaseProduct(data) : data;
        const product = await activeBackend.update('products', id, storedData);
        const result = normalizeRecord(activeBackend === localDB ? hydrateLocalProduct(product) : product);
        updateHydrated('products', list => list.map(item => item.id === id ? result : item));
        notifyCollectionChanged('products');
        return result;
      },
      delete: async (id) => {
        if (activeBackend === hostingerDB) {
          // O endpoint já confirma a exclusão com 404/200 e mantém backup,
          // então não há por que fazer a verificação por releitura.
          await activeBackend.delete('products', id);
          updateHydrated('products', list => list.filter(item => item.id !== id));
          notifyCollectionChanged('products');
          return true;
        }
        const product = await activeBackend.getById('products', id);
        if (!product) throw new Error('Produto não encontrado ou já excluído.');
        await activeBackend.delete('products', id);
        const remaining = await activeBackend.getById('products', id);
        if (remaining) throw new Error('A exclusão não foi confirmada pelo banco de dados.');
        updateHydrated('products', list => list.filter(item => item.id !== id));
        notifyCollectionChanged('products');
        return true;
      },
    },

    // Collections shared by the storefront and administration
    orders: {
      ...createCollectionAPI('orders'),
      // Storefront orders are inserted without reading the row back: anonymous
      // visitors may create orders but must never list other customers' orders.
      submit: async (item) => {
        const orders = backendFor('orders');
        const result = normalizeRecord(
          typeof orders.submit === 'function'
            ? await orders.submit('orders', item)
            : await orders.add('orders', item)
        );
        notifyCollectionChanged('orders');
        return result;
      },
      // Verify after removing: a previously-listed order still here means the
      // remote delete was filtered out (RLS / session) or the row is gone.
      delete: async (id) => {
        const orders = backendFor('orders');
        await orders.delete('orders', id);
        const remaining = await orders.getById('orders', id);
        if (remaining) {
          throw new Error('A exclusão não foi confirmada pelo banco de dados (RLS ou sessão expirada).');
        }
        notifyCollectionChanged('orders');
      },
    },
    leads: createCollectionAPI('leads'),

    // Content managed by the dashboard (home sections, campaigns, etc.)
    settings: {
      getAll: () => hydratedRead('settings'),
      getById: async (id) => {
        if (activeBackend === localDB) return normalizeRecord(await activeBackend.getById('settings', id));
        const list = await hydratedRead('settings');
        return list.find(setting => setting.id === id) || null;
      },
      add: async (item) => {
        const result = normalizeRecord(await backendFor('settings').add('settings', item));
        updateHydrated('settings', list => [...list, result]);
        notifyCollectionChanged('settings');
        return result;
      },
      update: async (id, data) => {
        const result = normalizeRecord(await backendFor('settings').update('settings', id, data));
        updateHydrated('settings', list => list.map(setting => setting.id === id ? result : setting));
        notifyCollectionChanged('settings');
        return result;
      },
      delete: async (id) => {
        await backendFor('settings').delete('settings', id);
        updateHydrated('settings', list => list.filter(setting => setting.id !== id));
        notifyCollectionChanged('settings');
      },
    },

    // Data
    export: exportData,
    import: importData,
  };

  function createCollectionAPI(collection) {
    return {
      getAll: async (options) => {
        const result = await backendFor(collection).getAll(collection, options);
        // Handle both array and { data, count } formats
        const data = Array.isArray(result) ? result : (result?.data || []);
        return data.map(normalizeRecord);
      },
      getById: async (id) => normalizeRecord(await backendFor(collection).getById(collection, id)),
      add: async (item) => {
        const result = normalizeRecord(await backendFor(collection).add(collection, item));
        notifyCollectionChanged(collection);
        return result;
      },
      update: async (id, data) => {
        const result = normalizeRecord(await backendFor(collection).update(collection, id, data));
        notifyCollectionChanged(collection);
        return result;
      },
      delete: async (id) => {
        await backendFor(collection).delete(collection, id);
        notifyCollectionChanged(collection);
      },
    };
  }
})();
