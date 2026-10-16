import { EmpireMark } from './empire-icons.jsx';
import React, { useEffect, useState } from 'react';
import { suggestDay, taskProgress } from './empire-metrics.js';
import { agendaWindow, taskDay } from './agenda.js';
import {
  ArrowRight,
  Check,
  Coffee,
  Feather,
  Landmark,
  Moon,
  Plus,
  CalendarDays,
  Mic,
  MicOff,
  Sparkles,
  FolderOpen,
  Flame,
  Target,
  ListChecks,
  Wallet,
} from 'lucide-react';
import { getAreas, getAreaName, todayKey } from './domain.js';
import { inferArea, generateSubtasksForTask, buildDailyCounsel } from './empire-agent.js';
import { useFinance } from './finance-context.jsx';
import { financialReport } from './finance-domain.js';

const areaDetails = {
  personale: { icon: Moon, subtitle: 'Tempo per te, casa e vita quotidiana' },
  zerilli: { icon: Coffee, subtitle: 'Attività, fornitori e clienti' },
  rep: { icon: Landmark, subtitle: 'Cantieri, gare e prossimi passi' },
  business: { icon: Feather, subtitle: 'Creazioni, ordini e progetti' },
};

const money = value =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format((value || 0) / 100);

function FinanceGlance({ navigate }) {
  const { state } = useFinance();
  if (!state) return null;
  const today = todayKey();
  const report = financialReport(state, {
    start: today.slice(0, 7) + '-01',
    end: today,
    currency: 'EUR',
  });
  return (
    <button className="home-finance" onClick={() => navigate('finance')}>
      <span className="home-finance-icon">
        <Wallet size={20} strokeWidth={1.4} />
      </span>
      <span>
        <small>REGISTRO · MESE CORRENTE</small>
        <strong>
          Entrate {money(report.incomeCents)} · Spese {money(report.expenseCents)}
        </strong>
        <em>Apri movimenti, conti e liquidità</em>
      </span>
      <ArrowRight size={17} />
    </button>
  );
}

export function QuickCaptureBar({
  state,
  commit,
  useSpeech,
  openOrb,
  defaultArea = '',
  defaultProject = '',
}) {
  const [text, setText] = useState('');
  const [manualArea, setManualArea] = useState(defaultArea);
  const [manualProject, setManualProject] = useState(defaultProject);
  const [manualDue, setManualDue] = useState('');
  const [manualPriority, setManualPriority] = useState('');
  const [withSteps, setWithSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  const speech = useSpeech(setText, () => text);
  const areas = getAreas(state);

  useEffect(() => {
    if (defaultArea !== undefined) setManualArea(defaultArea);
  }, [defaultArea]);
  useEffect(() => {
    if (defaultProject !== undefined) setManualProject(defaultProject);
  }, [defaultProject]);

  const today = todayKey();
  const tomorrow = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const detectedArea =
    manualArea ||
    (manualProject ? state.projects.find(p => p.id === manualProject)?.areaId : '') ||
    (text.trim() ? inferArea(text, state) : 'personale');

  const detectedProject =
    manualProject !== ''
      ? manualProject
      : text.trim()
      ? state.projects.find(
          p =>
            p.status === 'active' &&
            p.title
              .toLowerCase()
              .split(/\s+/)
              .filter(w => w.length >= 4)
              .some(w => text.toLowerCase().includes(w))
        )?.id || ''
      : '';

  const detectedDue =
    manualDue !== ''
      ? manualDue
      : /\bdomani\b/i.test(text)
      ? tomorrow
      : /\boggi\b/i.test(text)
      ? today
      : '';

  const detectedPriority =
    manualPriority ||
    (/\b(urgente|priorit[aà]|subito|importante)\b|!+/i.test(text) ? 'high' : 'normal');

  async function handleQuickSave(e) {
    e.preventDefault();
    const raw = text.trim();
    if (!raw || busy) return;
    if (speech.listening) speech.stop ? speech.stop() : speech.toggle();

    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    setBusy(true);
    try {
      if (lines.length >= 2) {
        const actions = lines.slice(0, 20).map(line => {
          const clean = line.replace(/^(?:[-*•▪▸▹→>]|\d+[.)]|\[[ xX]?\])\s+/, '').trim();
          const areaId = manualArea || inferArea(clean, state);
          const dueAt =
            manualDue ||
            (/\bdomani\b/i.test(clean) ? tomorrow : /\boggi\b/i.test(clean) ? today : null);
          const priority =
            manualPriority ||
            (/\b(urgente|priorit[aà]|subito|importante)\b|!+/i.test(clean) ? 'high' : 'normal');
          const title = clean.charAt(0).toUpperCase() + clean.slice(1);
          const subtasks = withSteps ? generateSubtasksForTask({ title, areaId }) : [];
          return {
            type: 'create_task',
            args: {
              title,
              areaId,
              projectId: detectedProject || null,
              dueAt,
              priority,
              subtasks,
              source: 'quick-capture',
            },
          };
        });
        await commit(actions, `${actions.length} attività aggiunte`);
      } else {
        const cleanTitle =
          raw
            .replace(/\b(oggi|domani)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || raw;
        const title = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
        const subtasks = withSteps ? generateSubtasksForTask({ title, areaId: detectedArea }) : [];
        await commit(
          [
            {
              type: 'create_task',
              args: {
                title,
                areaId: detectedArea,
                projectId: detectedProject || null,
                dueAt: detectedDue || null,
                priority: detectedPriority,
                subtasks,
                source: 'quick-capture',
              },
            },
          ],
          'Attività aggiunta'
        );
      }
      setText('');
      if (!defaultArea) setManualArea('');
      if (!defaultProject) setManualProject('');
      setManualDue('');
      setManualPriority('');
      setWithSteps(false);
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="quick-capture-card panel" aria-label="Aggiungi attività">
      <form onSubmit={handleQuickSave} className="quick-capture-form">
        {speech.listening && (
          <div className="voice-live-banner" role="status">
            <span className="pulse-dot" />
            <strong>In ascolto continuo…</strong>
            <small>Parla liberamente · premi il microfono o Aggiungi quando hai finito</small>
          </div>
        )}
        <div className={`quick-capture-input-row ${speech.listening ? 'is-listening' : ''}`}>
          <span className="quick-capture-plus" aria-hidden="true">
            <Plus size={18} />
          </span>
          <input
            type="text"
            aria-label="Aggiungi un’attività"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={speech.listening ? 'Detta pure…' : 'Aggiungi un’attività…'}
            autoComplete="off"
          />
          <button
            type="button"
            className={`icon-button mic-btn ${speech.listening ? 'listening' : ''}`}
            onClick={speech.toggle}
            aria-label={speech.listening ? 'Ferma microfono' : 'Detta con la voce'}
            title={speech.listening ? 'Ferma microfono' : 'Detta con la voce'}
          >
            {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button type="submit" className="quick-capture-submit" disabled={!text.trim() || busy}>
            <span>Aggiungi</span>
          </button>
        </div>

        <div className="quick-capture-tags">
          <label className="tag-chip" title="Dominio">
            <span className={`area-dot ${detectedArea}`} />
            <select
              aria-label="Dominio"
              value={detectedArea}
              onChange={e => {
                setManualArea(e.target.value);
                if (
                  manualProject &&
                  state.projects.find(p => p.id === manualProject)?.areaId !== e.target.value
                ) {
                  setManualProject('');
                }
              }}
            >
              {areas.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <label className="tag-chip" title="Progetto">
            <FolderOpen size={12} />
            <select
              aria-label="Progetto"
              value={detectedProject}
              onChange={e => {
                const pid = e.target.value;
                setManualProject(pid);
                const proj = state.projects.find(p => p.id === pid);
                if (proj) setManualArea(proj.areaId);
              }}
            >
              <option value="">Da sistemare</option>
              {state.projects
                .filter(p => p.status === 'active' && (!detectedArea || p.areaId === detectedArea))
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </label>

          <div className="tag-date-pills">
            <button
              type="button"
              className={`tag-pill ${detectedDue === today ? 'active' : ''}`}
              onClick={() => setManualDue(detectedDue === today ? null : today)}
            >
              Oggi
            </button>
            <button
              type="button"
              className={`tag-pill ${detectedDue === tomorrow ? 'active' : ''}`}
              onClick={() => setManualDue(detectedDue === tomorrow ? null : tomorrow)}
            >
              Domani
            </button>
            <input
              type="date"
              aria-label="Scadenza"
              className="tag-date-input"
              value={detectedDue || ''}
              onChange={e => setManualDue(e.target.value)}
            />
          </div>

          <button
            type="button"
            className={`tag-pill ${detectedPriority === 'high' ? 'active priority-high-pill' : ''}`}
            onClick={() => setManualPriority(detectedPriority === 'high' ? 'normal' : 'high')}
          >
            Alta priorità
          </button>

          <button
            type="button"
            className={`tag-pill ${withSteps ? 'active' : ''}`}
            onClick={() => setWithSteps(!withSteps)}
          >
            <ListChecks size={12} /> Passaggi
          </button>

          <button
            type="button"
            className="tag-ai-trigger"
            onClick={() => openOrb?.(text.trim() ? `Organizza queste note: ${text}` : '')}
          >
            <Feather size={13} /> Merlino
          </button>
        </div>
        {speech.error && (
          <p role="alert" className="form-error">
            {speech.error}
          </p>
        )}
      </form>
    </section>
  );
}

export function TodayWorkspace({
  state,
  commit,
  onEdit,
  onToggle,
  onPriority,
  navigate,
  choose,
  WeeklyChart,
  useSpeech,
  openOrb,
}) {
  const progress = taskProgress(state);
  const today = todayKey();
  const limit = state.settings.priorityCount === 5 ? 5 : 3;
  const [showCompletedToday, setShowCompletedToday] = useState(false);
  const areas = getAreas(state);

  useEffect(() => {
    if (state.settings.lastDailyPlan === today) return;
    const tasks = suggestDay(state, { date: today, count: limit });
    commit([], null, current => {
      if (current.settings.lastDailyPlan === today) return current;
      const next = structuredClone(current);
      if (!(next.plans[today] || []).length) next.plans[today] = tasks.map(t => t.id);
      next.settings.lastDailyPlan = today;
      return next;
    }).catch(() => {});
  }, [today]);

  const ids = state.plans[today] || [];
  const selected = ids.map(id => state.tasks.find(t => t.id === id)).filter(Boolean);
  const donePriorities = selected.filter(t => t.status === 'done').length;
  const completedTodayList = state.tasks.filter(
    t => t.status === 'done' && t.completedAt && todayKey(new Date(t.completedAt)) === today
  );
  const completedTodayTotal = completedTodayList.length;
  const pending = state.tasks.filter(t => t.status !== 'done' && !t.archived);
  const inboxCount = pending.filter(t => !t.projectId).length;
  const dates = agendaWindow(state, today);
  const counsel = buildDailyCounsel(state);

  const formattedDate = new Intl.DateTimeFormat('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Rome',
  }).format(new Date());

  const dateText = task => {
    const day = taskDay(task);
    const label =
      day < today
        ? 'Da recuperare'
        : day === today
        ? 'Oggi'
        : new Intl.DateTimeFormat('it-IT', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            timeZone: 'UTC',
          }).format(new Date(day + 'T12:00:00Z'));
    return (
      label +
      (task.dueAt.length > 10
        ? ' · ' +
          new Intl.DateTimeFormat('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Rome',
          }).format(new Date(task.dueAt))
        : '')
    );
  };

  async function toggleSubtask(task, subId, checked) {
    const nextSubs = (task.subtasks || []).map(s =>
      s.id === subId ? { ...s, done: checked } : s
    );
    try {
      await commit([{ type: 'update_task', args: { id: task.id, subtasks: nextSubs } }], null);
    } catch {}
  }

  async function autoBreakdownTask(task) {
    const subs = generateSubtasksForTask(task);
    try {
      await commit(
        [{ type: 'update_task', args: { id: task.id, subtasks: subs } }],
        'Passaggi aggiunti'
      );
    } catch {}
  }

  async function postponeTomorrow(task) {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const tom = d.toISOString().slice(0, 10);
    try {
      await commit(
        [{ type: 'update_task', args: { id: task.id, dueAt: tom } }],
        'Spostata a domani'
      );
    } catch {}
  }

  async function applyCounselPriorities() {
    if (!counsel.suggestedIds.length) return;
    try {
      await commit(
        [{ type: 'set_daily_priorities', args: { date: today, taskIds: counsel.suggestedIds } }],
        'Priorità aggiornate'
      );
    } catch {}
  }

  return (
    <div className="home-world personal-home">
      {/* SFONDO SANTUARIO FANTASY */}
      <div className="home-sanctuary" aria-hidden="true" />

      {/* HERO CON SFONDO ILLUSTRATO + CONSIGLIO GIORNALIERO DI MERLINO */}
      <section className="world-hero">
        <div className="world-hero-art" aria-hidden="true" />
        <div className="world-hero-content">
          <div className="world-date">
            <span />
            <span>{formattedDate}</span>
            <i>
              <EmpireMark size={14} />
            </i>
          </div>
          <h1>Oggi</h1>
          {counsel.topTask ? (
            <div className="merlino-counsel-box">
              <div className="merlino-counsel-head">
                <Feather size={15} />
                <span>CONSIGLIO DI MERLINO</span>
              </div>
              <p className="merlino-counsel-headline">{counsel.headline}</p>
              <p className="merlino-counsel-body">{counsel.advice}</p>
              <div className="merlino-counsel-actions">
                <button
                  type="button"
                  className="button primary btn-sm"
                  onClick={() => onEdit(counsel.topTask)}
                >
                  Apri attività
                </button>
                {!(counsel.topTask.subtasks || []).length && (
                  <button
                    type="button"
                    className="button secondary btn-sm"
                    onClick={() => autoBreakdownTask(counsel.topTask)}
                  >
                    <ListChecks size={14} /> Dividi in passaggi
                  </button>
                )}
                <button
                  type="button"
                  className="button ghost btn-sm"
                  onClick={() => openOrb?.()}
                >
                  <Feather size={14} /> Parla con Merlino
                </button>
              </div>
            </div>
          ) : (
            <p className="merlino-counsel-body">{counsel.advice}</p>
          )}
        </div>
      </section>

      {/* INSERIMENTO RAPIDO */}
      <QuickCaptureBar state={state} commit={commit} useSpeech={useSpeech} openOrb={openOrb} />

      {/* GRIGLIA PRINCIPALE: OGGI + SCADENZE */}
      <div className="home-main-grid">
        <section className="panel home-priorities">
          <div className="home-panel-heading">
            <div>
              <span className="section-eyebrow">
                <CalendarDays size={13} /> AGENDA
              </span>
              <h2>Oggi</h2>
            </div>
            <span className="quiet-badge">
              {donePriorities} / {selected.length} completate
            </span>
          </div>

          <div className="home-priority-options">
            <button className="text-button" onClick={choose}>
              Scegli attività
            </button>
            <label>
              Fino a
              <select
                aria-label="Numero di priorità giornaliere"
                value={limit}
                onChange={e => {
                  const n = Number(e.target.value);
                  commit([], null, current => ({
                    ...current,
                    settings: { ...current.settings, priorityCount: n },
                    plans: { ...current.plans, [today]: (current.plans[today] || []).slice(0, n) },
                  })).catch(() => {});
                }}
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
              </select>
            </label>
          </div>

          <div className="home-priority-list">
            {selected.map((task, index) => {
              const proj = state.projects.find(p => p.id === task.projectId);
              const hasSubs = task.subtasks?.length > 0;
              return (
                <div
                  className={`home-priority-slot-wrap ${
                    task.status === 'done' ? 'is-complete' : ''
                  }`}
                  key={task.id}
                >
                  <div
                    className={`home-priority-slot ${task.status === 'done' ? 'is-complete' : ''}`}
                  >
                    <span className="home-priority-number">
                      {['I', 'II', 'III', 'IV', 'V'][index]}
                    </span>
                    <button className="home-priority-task" onClick={() => onEdit(task)}>
                      <strong>{task.title}</strong>
                      <span>
                        <i className={`area-dot ${task.areaId}`} />
                        {getAreaName(state, task.areaId)}
                        {proj && ` · ${proj.title}`}
                        {task.dueAt && ' · ' + dateText(task)}
                        {hasSubs &&
                          ` · ${task.subtasks.filter(s => s.done).length}/${
                            task.subtasks.length
                          } passaggi`}
                      </span>
                    </button>
                    <button
                      className="task-check"
                      aria-label={`${task.status === 'done' ? 'Riapri' : 'Completa'} ${task.title}`}
                      onClick={() => onToggle(task)}
                    >
                      {task.status === 'done' && <Check size={16} />}
                    </button>
                    <div className="home-priority-controls">
                      {!hasSubs && task.status !== 'done' && (
                        <button
                          type="button"
                          className="mini-action-btn"
                          onClick={() => autoBreakdownTask(task)}
                          title="Dividi in passaggi"
                        >
                          Passaggi
                        </button>
                      )}
                      {task.status !== 'done' && (
                        <button
                          type="button"
                          className="mini-action-btn muted"
                          onClick={() => postponeTomorrow(task)}
                          title="Sposta a domani"
                        >
                          Domani
                        </button>
                      )}
                      <button
                        className="icon-button"
                        aria-label={`Sposta priorità ${task.title} in alto`}
                        disabled={index === 0}
                        onClick={() => {
                          const order = [...ids];
                          [order[index - 1], order[index]] = [order[index], order[index - 1]];
                          commit(
                            [{ type: 'set_daily_priorities', args: { date: today, taskIds: order } }],
                            null
                          ).catch(() => {});
                        }}
                      >
                        ↑
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Rimuovi ${task.title} dalle priorità`}
                        onClick={() => onPriority(task)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {hasSubs && task.status !== 'done' && (
                    <div className="task-inline-subtasks priority-subtasks">
                      {task.subtasks.map(s => (
                        <label key={s.id} className={`inline-subtask ${s.done ? 'done' : ''}`}>
                          <input
                            type="checkbox"
                            checked={!!s.done}
                            onChange={e => toggleSubtask(task, s.id, e.target.checked)}
                          />
                          <span>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!selected.length && (
            <p className="agenda-empty">
              Nessuna attività scelta per oggi.{' '}
              {counsel.suggestedIds.length > 0 && (
                <button type="button" className="text-button" onClick={applyCounselPriorities}>
                  Usa i suggerimenti di Merlino
                </button>
              )}
            </p>
          )}

          <div className="home-panel-footer">
            {inboxCount > 0 ? (
              <button
                className="text-button"
                onClick={() => navigate('projects', { project: '__inbox__' })}
              >
                Da sistemare ({inboxCount}) <ArrowRight size={14} />
              </button>
            ) : (
              <button className="text-button" onClick={() => onEdit({})}>
                <Plus size={14} /> Nuova attività
              </button>
            )}
            <button className="text-button" onClick={() => navigate('focus')}>
              Tutte le attività <ArrowRight size={14} />
            </button>
          </div>
        </section>

        <section className="panel agenda-dates">
          <header>
            <span className="section-eyebrow">SCADENZE</span>
            <h2>Prossimi 7 giorni</h2>
          </header>
          {dates.length ? (
            <div>
              {dates.slice(0, 6).map(task => (
                <button key={task.id} onClick={() => onEdit(task)}>
                  <time className={taskDay(task) < today ? 'is-late' : ''}>{dateText(task)}</time>
                  <strong>{task.title}</strong>
                  <small>{getAreaName(state, task.areaId)}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="agenda-empty">Nessuna scadenza nei prossimi 7 giorni.</p>
          )}
          <button
            className="text-button"
            onClick={() => navigate('focus', { view: 'upcoming' })}
          >
            Apri scadenze <ArrowRight size={14} />
          </button>
        </section>
      </div>

      {/* I DOMINI (CON PAESAGGI FANTASY ILLUSTRATI + SIGILLI) */}
      <section className="home-atlas" aria-labelledby="atlas-title">
        <div className="home-section-heading">
          <div>
            <h2 id="atlas-title">I domini</h2>
          </div>
          <span className="atlas-line" aria-hidden="true">
            <EmpireMark size={20} />
          </span>
        </div>
        <div className="home-area-grid">
          {areas.map(area => {
            const detail = areaDetails[area.id] || areaDetails.personale;
            const Icon = detail.icon;
            const count = pending.filter(t => t.areaId === area.id).length;
            const areaProjects = state.projects.filter(
              p => p.areaId === area.id && p.status === 'active'
            );
            return (
              <button
                className={`home-area ${area.id}`}
                key={area.id}
                onClick={() => navigate('projects', { area: area.id })}
              >
                <div className="area-landscape" aria-hidden="true">
                  <span className="area-sigil">
                    <Icon size={38} strokeWidth={0.9} />
                  </span>
                  <i />
                  <b />
                  <span className="area-horizon" />
                </div>
                <div className="home-area-body">
                  <span className="home-area-icon">
                    <Icon size={18} strokeWidth={1.35} />
                  </span>
                  <h3>{area.name}</h3>
                  <p>{area.subtitle || detail.subtitle}</p>
                  <div>
                    <span>
                      {count} {count === 1 ? 'attività' : 'attività'} · {areaProjects.length}{' '}
                      {areaProjects.length === 1 ? 'progetto' : 'progetti'}
                    </span>
                    <ArrowRight size={15} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <FinanceGlance navigate={navigate} />

      {/* PROGRESSI & GAMIFICATION */}
      <details className="panel personal-progress" open>
        <summary>
          <span>
            <Flame size={15} style={{ verticalAlign: 'middle', marginRight: 7, color: 'var(--gold)' }} />
            Progressi ·{' '}
            {completedTodayTotal > 0
              ? `${completedTodayTotal} completate oggi`
              : 'Attività completate'}
          </span>
          <span>
            {progress.total}{' '}
            {progress.total === 1 ? 'completata in totale' : 'completate in totale'}
          </span>
        </summary>
        <div className="task-milestones">
          <div>
            <h2>Traguardo: {progress.next} attività</h2>
            <p>
              {completedTodayTotal > 0
                ? `Oggi hai completato ${completedTodayTotal} ${
                    completedTodayTotal === 1 ? 'attività' : 'attività'
                  }.`
                : 'Ogni attività completata fa avanzare il tuo traguardo.'}
            </p>
          </div>
          <div>
            <span>
              {progress.total} / {progress.next}
            </span>
            <progress
              max={progress.next}
              value={progress.total}
              aria-label="Progresso verso il prossimo traguardo"
            />
          </div>
        </div>
        {completedTodayTotal > 0 && (
          <div className="completed-today-drawer">
            <button
              type="button"
              className="text-button"
              onClick={() => setShowCompletedToday(!showCompletedToday)}
            >
              <Check size={14} />{' '}
              {showCompletedToday
                ? 'Nascondi completate di oggi'
                : `Completate oggi (${completedTodayTotal})`}
            </button>
            {showCompletedToday && (
              <ul className="completed-today-list">
                {completedTodayList.map(t => (
                  <li key={t.id}>
                    <Check size={13} />
                    <span>{t.title}</span>
                    <small>{getAreaName(state, t.areaId)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <WeeklyChart tasks={state.tasks} />
      </details>
    </div>
  );
}
