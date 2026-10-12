import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { FinanceRepository } from './finance-repository.js';
import { ManagedRepository } from './managed-repository.js';
import { validateFinance } from './finance-domain.js';

const Context = createContext(null);
const repo = new ManagedRepository(new FinanceRepository(), 'finance');

export function FinanceProvider({ children }) {
  const [state, setState] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [previous, setPrevious] = useState(null);
  const ref = useRef(null);
  const queue = useRef(Promise.resolve());
  useEffect(() => { let alive = true; repo.load().then(value => {
    if (alive) { ref.current = value; setState(value); setStatus('ready'); }
  }).catch(e => { if (alive) { setError(e.message); setStatus('error'); } });
    return () => { alive = false; };
  }, []);

  function save(updater, { remember = true } = {}) {
    const pending = queue.current.catch(() => {}).then(async () => {
      if (!ref.current) throw new Error('Archivio finanziario non disponibile.');
      const before = ref.current;
      setStatus('saving'); setError('');
      try {
        const next = validateFinance(typeof updater === 'function' ? updater(before) : updater);
        await repo.save(next);
        ref.current = next; setState(next); setStatus('ready');
        if (remember) setPrevious(before);
        return next;
      } catch (e) { setError(e.message); setStatus('error'); throw e; }
    });
    queue.current = pending;
    return pending;
  }
  async function undo() {
    if (!previous) return;
    const value = previous;
    await save(value, { remember: false }); setPrevious(null);
  }
  return <Context.Provider value={{ state, status, error, save, undo, canUndo: !!previous, storageMode: repo.mode, current: () => ref.current }}>{children}</Context.Provider>;
}

export function useFinance() { return useContext(Context); }
