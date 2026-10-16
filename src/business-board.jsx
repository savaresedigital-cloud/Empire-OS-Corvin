import { EmpireMark } from './empire-icons.jsx';
import React, { useState } from 'react';
import { ArrowRight, Boxes, Plus, Archive } from 'lucide-react';
import { businessMetrics, euro } from './empire-metrics.js';
import { RingChart } from './empire-charts.jsx';

const privateImage = url => typeof url === 'string' && url.startsWith('/api/media/');

export function BusinessBoard({ state, period, edit, renderDetail, execute }) {
  const [scope, setScope] = useState('history');
  const [selected, setSelected] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const interval = scope === 'history' ? { start: '0000-01-01', end: '9999-12-31' } : period;
  const allRows = businessMetrics(state, interval);

  const activeBizSet = new Set(state.businesses.filter(b => b.active !== false).map(b => b.id));
  const rows = allRows.filter(r => showArchived || activeBizSet.has(r.id));
  const archivedCount = allRows.filter(r => !activeBizSet.has(r.id)).length;

  const revenue = rows.reduce((n, r) => n + Math.max(r.revenueCents, r.collectedCents), 0);
  const margin = rows.reduce((n, r) => n + (r.revenueCents > 0 ? r.marginCents : r.collectedCents), 0);
  const orderCount = rows.reduce((n, r) => n + (scope === 'history' ? r.historicalCount : r.count), 0);

  const business = state.businesses.find(b => b.id === selected);
  const products = business?.sourceData?.products || [];

  async function toggleArchiveBusiness(bizId, e) {
    e.stopPropagation();
    const target = state.businesses.find(b => b.id === bizId);
    if (!target || !execute) return;
    await execute({ type: 'upsert', args: { collection: 'businesses', record: { ...target, active: target.active === false } } }, target.active === false ? 'Business riattivato' : 'Business archiviato');
  }

  const rankedRows = [...rows].sort((a, b) => Math.max(b.revenueCents, b.collectedCents) - Math.max(a.revenueCents, a.collectedCents));

  return (
    <div className="business-board">
      <div className="business-intro">
        <div>
          <span className="section-eyebrow">MY BUSINESS EMPIRE</span>
          <h2>I tuoi progetti & canali</h2>
          <p>Vendite, prodotti e incassi reali. Archivia con un clic i progetti chiusi o in pausa.</p>
        </div>
        <div className="button-row">
          <div className="segmented">
            <button className={scope === 'history' ? 'active' : ''} onClick={() => setScope('history')}>Storico Totale</button>
            <button className={scope === 'period' ? 'active' : ''} onClick={() => setScope('period')}>Periodo scelto</button>
          </div>
          <button className="button secondary btn-sm" onClick={() => edit('businesses')}><Plus size={14}/> Nuovo canale</button>
        </div>
      </div>

      <div className="business-summary">
        <div><small>VOLUME GENERATO</small><strong>{euro(revenue)}</strong></div>
        <div><small>UTILE / NETTO</small><strong>{euro(margin)}</strong></div>
        <div><small>ORDINI REGISTRATI</small><strong>{orderCount}</strong></div>
      </div>

      <div className="business-top" style={{ marginTop: 18 }}>
        <RingChart
          rows={rankedRows.map(r => ({ id: r.id, name: r.name, value: Math.max(r.revenueCents, r.collectedCents) }))}
          title="Distribuzione per canale"
          subtitle="PESO ATTIVITÀ"
          center="TOTALE"
          onSelect={setSelected}
        />
        <section className="panel business-ranking">
          <span className="section-eyebrow">CLASSIFICA CANALI ATTIVI</span>
          <h2>Rendimento per progetto</h2>
          {rankedRows.filter(r => Math.max(r.revenueCents, r.collectedCents) > 0).slice(0, 6).map((r, i) => (
            <button key={r.id} onClick={() => setSelected(r.id)}>
              <span className="ranking-number">{String(i + 1).padStart(2, '0')}</span>
              <span>{r.name}<small>{r.historicalCount} ordini · {r.products.length} prodotti</small></span>
              <strong>{euro(Math.max(r.revenueCents, r.collectedCents))}</strong>
              <ArrowRight size={14} />
            </button>
          ))}
        </section>
      </div>

      <div className="finance-toolbar" style={{ marginTop: 14 }}>
        <span className="finance-muted">{rankedRows.length} canali visibili</span>
        {archivedCount > 0 && (
          <button type="button" className="text-button" onClick={() => setShowArchived(!showArchived)}>
            <Archive size={13}/> {showArchived ? 'Nascondi canali archiviati' : `Mostra archiviati (${archivedCount})`}
          </button>
        )}
      </div>

      <div className="business-cards">
        {rankedRows.map(r => {
          const val = Math.max(r.revenueCents, r.collectedCents);
          const isArch = !activeBizSet.has(r.id);
          const bizObj = state.businesses.find(b => b.id === r.id);
          const logoUrl = bizObj?.sourceData?.logoUrl;
          const hasPhoto = privateImage(logoUrl) || (typeof logoUrl === 'string' && logoUrl.startsWith('http'));
          return (
            <div key={r.id} className={`business-card panel ${selected === r.id ? 'selected' : ''}`} onClick={() => setSelected(selected === r.id ? '' : r.id)} style={{ cursor: 'pointer', opacity: isArch ? 0.6 : 1 }}>
              <div className="business-cover-banner">
                {hasPhoto ? (
                  <img className="business-cover-img" src={logoUrl} alt="" />
                ) : (
                  <div className="business-cover-fallback"><EmpireMark size={40} /></div>
                )}
                <div className="business-cover-gradient" />
                <h3>{r.name}</h3>
              </div>
              <div className="business-card-stats">
                <div className="biz-stat-box">
                  <small>FATTURATO</small>
                  <strong className="gold-num">{euro(val)}</strong>
                </div>
                <div className="biz-stat-box">
                  <small>ATTIVITÀ</small>
                  <strong>{r.historicalCount} ordini · {r.products.length} prod.</strong>
                </div>
              </div>
              <div className="business-card-foot">
                <button type="button" className="text-button" style={{ fontSize: 10 }} onClick={e => toggleArchiveBusiness(r.id, e)}>
                  {isArch ? 'Riattiva' : 'Archivia'}
                </button>
                <ArrowRight size={15} />
              </div>
            </div>
          );
        })}
      </div>

      {business && (
        <section className="panel business-products">
          <header>
            <div>
              <span className="section-eyebrow">{business.name}</span>
              <h2>Prodotti, listino e ordini</h2>
            </div>
            <button className="text-button" onClick={() => edit('businesses', business)}>Modifica</button>
          </header>
          {products.length ? (
            <div className="product-cards">
              {products.map(p => {
                const hasProdImg = privateImage(p.imageUrl) || (typeof p.imageUrl === 'string' && p.imageUrl.startsWith('http'));
                return (
                  <article key={p.id}>
                    {hasProdImg ? <img className="product-image" src={p.imageUrl} alt=""/> : <Boxes size={18} />}
                    <div>
                      <strong>{p.name}</strong>
                      <small>{p.category || p.description || 'Prodotto a catalogo'}</small>
                    </div>
                    <span>{p.price != null ? euro(Math.round(Number(p.price) * 100)) : '—'}</span>
                    {p.stock != null && <small>Stock: {p.stock}</small>}
                  </article>
                );
              })}
            </div>
          ) : (
            <p>Nessun prodotto a listino per questo canale.</p>
          )}
          <details open style={{ marginTop: 14 }}>
            <summary>Ordini e registrazioni di {business.name}</summary>
            {renderDetail(selected, interval)}
          </details>
        </section>
      )}
    </div>
  );
}
