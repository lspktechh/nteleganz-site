/* Shared catalog rules, independent of desktop/mobile controls. */
(() => {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const normalizeSize = value => String(value ?? '').trim().toUpperCase();
  const price = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let text = String(value ?? '').replace(/[^\d,.-]/g, '');
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    return Number(text) || 0;
  };
  const inStock = p => p.active !== false && p.available !== false && p.inStock !== false && Number.isFinite(Number(p.stock)) && Number(p.stock) > 0;
  const onSale = p => price(p.oldPrice) > price(p.price);
  const category = p => {
    const explicit = normalize(p.category);
    if (explicit && explicit !== 'todos') return explicit;
    const text = normalize(`${p.name} ${p.category}`);
    if (/calcado|sandalia|tenis|sapato|sneaker|birkenstock/.test(text)) return 'calcados';
    if (/short|bermuda|swim|trunk/.test(text)) return 'shorts';
    if (/hood|moletom|puffer|jaqueta|jacket|biker|leather/.test(text)) return 'hoodies';
    return 'camisetas';
  };
  function filter(products, state) {
    return products.filter(p => {
      if (p.active === false) return false;
      if (state.category !== 'todos' && category(p) !== normalize(state.category)) return false;
      const amount = price(p.price);
      if (amount < state.min || amount > state.max) return false;
      if (state.brands.length && !state.brands.includes(normalize(p.brand))) return false;
      if (state.sizes.length && !state.sizes.some(size => {
        const target = normalizeSize(size);
        return (p.sizes || []).some(s => normalizeSize(s) === target);
      })) return false;
      if (state.stock && !inStock(p)) return false;
      if (state.sale && !onSale(p)) return false;
      return normalize(`${p.brand} ${p.name} ${p.category} ${category(p)}`).includes(normalize(state.query));
    }).sort((a, b) => {
      if (state.sort === 'price-asc') return price(a.price) - price(b.price);
      if (state.sort === 'price-desc') return price(b.price) - price(a.price);
      if (state.sort === 'name') return String(a.name).localeCompare(String(b.name), 'pt-BR');
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    });
  }
  window.NTCatalogFilters = { normalize, normalizeSize, price, filter, inStock, onSale, category };
})();
