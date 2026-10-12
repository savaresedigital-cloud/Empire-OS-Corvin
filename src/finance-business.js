/** Legacy business records are profitability history, never opening bank balances. */
export function legacyMoneyCents(value) {
  const text = String(value ?? '');
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error('Importo commerciale non valido o precisione superiore a due decimali.');
  const cents = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Importo commerciale fuori intervallo.');
  return match[1] ? -cents : cents;
}

function sanitizeLegacy(record, excludedAssets) {
  const result = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.startsWith('data:')) {
      excludedAssets.push({ sourceId: record.id, field: key, mime: value.slice(5, value.indexOf(';')), characters: value.length });
      result[key] = { excluded: true, reason: 'Immagine incorporata esclusa dall’importazione', mime: value.slice(5, value.indexOf(';')), characters: value.length };
    } else result[key] = value;
  }
  return result;
}

export function migrateLegacyBusiness(data, { batchId, now = new Date().toISOString(), idPrefix = 'legacy' } = {}) {
  if (!data || !['channels', 'products', 'orders'].every(key => Array.isArray(data[key]))) throw new Error('Backup My Empire incompleto: channels, products e orders sono obbligatori.');
  for (const key of ['channels', 'products', 'orders']) {
    const ids = new Set();
    for (const record of data[key]) {
      if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)) throw new Error(`Identificativi non validi o duplicati in ${key}.`);
      ids.add(record.id);
    }
  }
  const excludedAssets = [], warnings = [], errors = [], importRows = [];
  const channels = new Map(data.channels.map(record => [record.id, record]));
  const products = new Map(data.products.map(record => [record.id, record]));
  const businessId = id => `${idPrefix}_business_${id}`;
  const common = record => ({ ownerId: 'local', source: 'my-empire', sourceId: record.id, importBatchId: batchId, createdAt: now, updatedAt: now });
  const businesses = data.channels.map(channel => {
    const raw = sanitizeLegacy(channel, excludedAssets);
    // Preserve products as private source metadata; no invented asset valuation.
    raw.products = data.products.filter(product => product.channelId === channel.id).map(product => sanitizeLegacy(product, excludedAssets));
    return { ...common(channel), id: businessId(channel.id), name: String(channel.name || 'Canale senza nome').trim(), description: String(channel.notes || ''), active: false, sourceData: raw };
  });
  const orphanProducts = data.products.filter(product => !channels.has(product.channelId));
  if (orphanProducts.length) {
    warnings.push({ code: 'orphan-products', count: orphanProducts.length, message: `${orphanProducts.length} prodotti con canale originale assente: conservati tra i riferimenti da assegnare.` });
    // A historical unassigned archive is not silently attributed to a real shop.
    businesses.push({ id: `${idPrefix}_unassigned`, sourceId: '__unassigned_legacy_products__', name: 'Archivio My Empire · da assegnare', description: 'Prodotti con riferimenti originali non risolti', active: false, ownerId: 'local', source: 'my-empire', importBatchId: batchId, createdAt: now, updatedAt: now, sourceData: { orphanProducts: orphanProducts.map(product => sanitizeLegacy(product, excludedAssets)) } });
  }
  const orders = [], businessCosts = [];
  for (const [index, order] of data.orders.entries()) {
    const rowNumber = index + 1;
    const raw = sanitizeLegacy(order, excludedAssets);
    try {
      if (!channels.has(order.channelId)) throw new Error('Canale dell’ordine assente: associazione manuale necessaria.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(order.date) || new Date(`${order.date}T12:00:00Z`).toISOString().slice(0, 10) !== order.date) throw new Error('Data ordine non valida.');
      if (!Number.isSafeInteger(order.quantity) || order.quantity <= 0) throw new Error('Quantità ordine non valida.');
      const grossCents = legacyMoneyCents(order.grossRevenue), directCostCents = legacyMoneyCents(order.expenses), reportedProfit = legacyMoneyCents(order.profit);
      if (grossCents < 0 || directCostCents < 0) throw new Error('Ricavo o costo negativo: revisione necessaria.');
      if (grossCents - directCostCents !== reportedProfit) throw new Error('Utile originale diverso da ricavi meno spese.');
      if (order.productId && !products.has(order.productId)) warnings.push({ row: rowNumber, code: 'orphan-product', message: 'Riferimento prodotto non risolto, conservato nei metadati.' });
      const base = { ...common(order), id: `${idPrefix}_order_${order.id}`, businessId: businessId(order.channelId), date: order.date, currency: 'EUR', description: String(order.clientNotes || ''), sourceData: raw };
      if (order.type === 'SALE') {
        orders.push({ ...base, grossCents, discountCents: 0, refundCents: 0, feesCents: null, directCostCents, status: 'completed', productName: products.get(order.productId)?.name || '', quantity: order.quantity, costCompleteness: 'legacy-aggregate', legacyProfitCents: reportedProfit });
      } else if (order.type === 'EXPENSE') {
        if (grossCents !== 0) throw new Error('Spesa storica con ricavo non nullo: revisione necessaria.');
        businessCosts.push({ ...base, id: `${idPrefix}_cost_${order.id}`, amountCents: directCostCents, kind: 'legacy-expense', orderId: null, transactionId: null });
      } else throw new Error(`Tipo ordine non supportato: ${order.type}.`);
      importRows.push({ id: `${batchId}_business_row_${rowNumber}`, importBatchId: batchId, rowNumber, collection: 'orders', sourceId: order.id, raw, status: 'valid' });
    } catch (error) {
      errors.push({ row: rowNumber, code: 'invalid-order', message: error.message });
      importRows.push({ id: `${batchId}_business_row_${rowNumber}`, importBatchId: batchId, rowNumber, collection: 'orders', sourceId: order.id, raw, status: 'error', error: error.message });
    }
  }
  warnings.push({ code: 'historical-only', message: 'Ordini e costi storici: nessun saldo, incasso bancario o payout viene creato. Commissioni non distinguibili dalle spese aggregate: utile da verificare.' });
  if (excludedAssets.length) warnings.push({ code: 'excluded-images', count: excludedAssets.length, message: `${excludedAssets.length} immagini incorporate escluse. Il backup originale resta necessario per recuperarle.` });
  return { payload: { businesses, orders, businessCosts, importRows }, errors, warnings, excludedAssets, counts: { channels: data.channels.length, products: data.products.length, orders: data.orders.length, sales: orders.length, expenses: businessCosts.length, orphanProducts: orphanProducts.length } };
}

/** Exact known legacy margin. Missing fee breakdown remains explicitly incomplete. */
export function legacyBusinessReport(state, { businessId, start = '0000-01-01', end = '9999-12-31', currency = 'EUR' } = {}) {
  const inPeriod = record => (!businessId || record.businessId === businessId) && record.date >= start && record.date <= end && record.currency === currency;
  const orders = (state.orders || []).filter(inPeriod).filter(order => order.status !== 'cancelled');
  const costs = (state.businessCosts || []).filter(inPeriod);
  let revenueCents = 0, knownCostsCents = 0, incompleteCosts = 0;
  for (const order of orders) {
    revenueCents += (order.grossCents || 0) - (order.discountCents || 0) - (order.refundCents || 0);
    knownCostsCents += (order.directCostCents || 0) + (order.feesCents || 0);
    if (order.directCostCents == null || order.feesCents == null) incompleteCosts++;
  }
  for (const cost of costs) knownCostsCents += cost.amountCents;
  return { currency, start, end, revenueCents, knownCostsCents, marginCents: revenueCents - knownCostsCents, incompleteCosts, complete: incompleteCosts === 0, payoutsCents: (state.payouts || []).filter(inPeriod).reduce((sum, payout) => sum + payout.amountCents, 0), bankLiquidityCents: null };
}
