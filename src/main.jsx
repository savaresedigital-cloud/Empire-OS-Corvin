import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BarChart3,
  Check,
  CircleHelp,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Menu,
  Mic,
  MicOff,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Feather,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import {
  AREAS,
  getAreas,
  getAreaName,
  todayKey,
  emptyState,
  validateState,
  applyActions,
  exportTasksCsv,
  importCsvState,
  mergeImport,
  parseRomeDateTime,
} from './domain.js';
import { LocalRepository } from './repository.js';
import './styles.css';
import './identity.css';
import { FinanceProvider, useFinance } from './finance-context.jsx';
import { FinanceWorkspace } from './finance-ui.jsx';
import { AssistantWorkspace } from './agent-hub.jsx';
import { ManagedRepository } from './managed-repository.js';
import { TodayWorkspace, QuickCaptureBar } from './home.jsx';
import { generateSubtasksForTask } from './empire-agent.js';
import './fantasy.css';
import './hub.css';

const repository = new ManagedRepository(new LocalRepository(), 'tasks');
const nav = [
  { id: 'today', label: 'Oggi', icon: LayoutDashboard },
  { id: 'focus', label: 'Agenda', icon: Inbox },
  { id: 'projects', label: 'Progetti', icon: FolderOpen },
  { id: 'finance', label: 'Finanze', icon: Wallet },
  { id: 'business', label: 'Business', icon: BarChart3 },
  { id: 'settings', label: 'Impostazioni', icon: Settings2 },
];

const dayLabel = value =>
  value
    ? new Intl.DateTimeFormat('it-IT', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Europe/Rome',
      }).format(new Date(value.length === 10 ? `${value}T12:00:00+02:00` : value))
    : 'Senza scadenza';
const uuid = () => crypto.randomUUID();
const dueDay = value => (!value ? null : value.length === 10 ? value : todayKey(new Date(value)));
const localDateInput = value => {
  if (!value) return '';
  if (value.length === 10) return value;
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return parts.replace(' ', 'T');
};
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <img src="/empire-portal.svg" alt="" />
    </span>
  );
}
function Empty({ icon: Icon = Inbox, title, text, children }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef();
  useEffect(() => {
    const el = ref.current;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      onCancel={onClose}
      onClick={e => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Chiudi finestra" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

/**
 * Continuous Italian voice dictation.
 * Never stops after a few words: uses continuous=true + automatic continuation
 * across pauses until the user explicitly presses Stop or submits.
 */
function useSpeech(onTranscript, getInitialText) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const recognitionRef = useRef(null);
  const wantListeningRef = useRef(false);
  const committedRef = useRef('');
  const latestSessionRef = useRef('');
  const callbackRef = useRef(onTranscript);
  const getInitialRef = useRef(getInitialText);
  callbackRef.current = onTranscript;
  getInitialRef.current = getInitialText;

  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = !!Speech && window.isSecureContext;

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {}
    };
  }, []);

  const stop = () => {
    wantListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setStatus(old => (['listening', 'permission'].includes(old) ? 'transcribed' : old));
  };

  const startSession = () => {
    if (!wantListeningRef.current) return;
    const r = new Speech();
    r.lang = 'it-IT';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    recognitionRef.current = r;
    latestSessionRef.current = '';

    r.onstart = () => {
      if (wantListeningRef.current) setStatus('listening');
    };

    r.onresult = event => {
      let sessionText = '';
      for (let i = 0; i < event.results.length; i++) {
        sessionText += event.results[i][0].transcript + ' ';
      }
      latestSessionRef.current = sessionText.trim();
      const combined = [committedRef.current, latestSessionRef.current]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      callbackRef.current(combined);
      setStatus('listening');
    };

    r.onerror = event => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted' && !wantListeningRef.current) return;
      wantListeningRef.current = false;
      recognitionRef.current = null;
      setError(
        {
          'not-allowed':
            'Permesso microfono negato. Consenti il microfono nelle impostazioni del browser.',
          network: 'Il servizio vocale non è raggiungibile. Puoi continuare a scrivere.',
          'audio-capture': 'Nessun microfono disponibile.',
        }[event.error] || `Trascrizione interrotta (${event.error}).`
      );
      setStatus('error');
    };

    r.onend = () => {
      if (latestSessionRef.current) {
        committedRef.current = [committedRef.current, latestSessionRef.current]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        latestSessionRef.current = '';
      }
      if (wantListeningRef.current) {
        setTimeout(() => {
          if (!wantListeningRef.current) return;
          try {
            startSession();
          } catch {
            wantListeningRef.current = false;
            recognitionRef.current = null;
            setStatus('transcribed');
          }
        }, 60);
      } else {
        recognitionRef.current = null;
        setStatus(old => (['listening', 'permission'].includes(old) ? 'transcribed' : old));
      }
    };

    try {
      r.start();
    } catch {
      wantListeningRef.current = false;
      recognitionRef.current = null;
      setStatus('error');
      setError('Impossibile avviare il microfono. Usa il campo di testo.');
    }
  };

  const toggle = () => {
    setError('');
    if (!supported) {
      setError('Trascrizione vocale non disponibile in questo browser. Usa HTTPS o localhost.');
      return;
    }
    if (wantListeningRef.current || recognitionRef.current) {
      stop();
      return;
    }
    const existing = typeof getInitialRef.current === 'function' ? getInitialRef.current() : '';
    committedRef.current = (existing || '').trim();
    latestSessionRef.current = '';
    wantListeningRef.current = true;
    setStatus('permission');
    startSession();
  };

  return {
    status,
    error,
    supported,
    toggle,
    stop,
    listening: wantListeningRef.current || ['permission', 'listening'].includes(status),
  };
}

function TaskRow({ task, state, commit, onToggle, onEdit, onPriority, showPin = true }) {
  const selected = (state.plans[todayKey()] || []).includes(task.id);
  const overdue = task.status !== 'done' && task.dueAt && dueDay(task.dueAt) < todayKey();
  const project = state.projects.find(p => p.id === task.projectId);
  const hasSubs = task.subtasks?.length > 0;

  async function toggleSubtask(subId, checked) {
    if (!commit) return;
    const nextSubs = (task.subtasks || []).map(s =>
      s.id === subId ? { ...s, done: checked } : s
    );
    try {
      await commit([{ type: 'update_task', args: { id: task.id, subtasks: nextSubs } }], null);
    } catch {}
  }

  async function autoBreakdown(e) {
    e.stopPropagation();
    if (!commit) return;
    const subs = generateSubtasksForTask(task);
    try {
      await commit(
        [{ type: 'update_task', args: { id: task.id, subtasks: subs } }],
        'Passaggi aggiunti'
      );
    } catch {}
  }

  return (
    <div className={`task-row-wrap ${task.status === 'done' ? 'is-done' : ''}`}>
      <div className={`task-row ${task.status === 'done' ? 'is-done' : ''}`}>
        <button
          className="task-check"
          aria-label={`${task.status === 'done' ? 'Riapri' : 'Completa'} ${task.title}`}
          onClick={() => onToggle(task)}
        >
          {task.status === 'done' && <Check size={15} />}
        </button>
        <button className="task-content" onClick={() => onEdit(task)}>
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            <span className={`area-dot ${task.areaId}`} />
            {getAreaName(state, task.areaId)}
            {project ? (
              <>
                <i>·</i>
                <strong>{project.title}</strong>
              </>
            ) : (
              <>
                <i>·</i>
                <span>Da sistemare</span>
              </>
            )}
            {task.dueAt && (
              <>
                <i>·</i>
                <span className={overdue ? 'overdue' : ''}>
                  {overdue ? 'Scaduta · ' : ''}
                  {dayLabel(task.dueAt)}
                </span>
              </>
            )}
            {hasSubs && (
              <>
                <i>·</i>
                {task.subtasks.filter(t => t.done).length}/{task.subtasks.length} passaggi
              </>
            )}
          </span>
        </button>
        {task.priority === 'high' && <span className="priority-tag">Alta</span>}
        {!hasSubs && task.status !== 'done' && commit && (
          <button
            type="button"
            className="mini-action-btn"
            onClick={autoBreakdown}
            title="Dividi in passaggi"
          >
            Passaggi
          </button>
        )}
        {showPin && (
          <button
            className={`icon-button pin ${selected ? 'selected' : ''}`}
            onClick={() => onPriority(task)}
            aria-label={
              selected
                ? `Rimuovi ${task.title} dalle priorità`
                : `Scegli ${task.title} come priorità`
            }
            title={selected ? 'Tra le priorità di oggi' : 'Priorità di oggi'}
          >
            <Target size={17} />
          </button>
        )}
        <button
          className="icon-button task-edit"
          onClick={() => onEdit(task)}
          aria-label={`Modifica ${task.title}`}
        >
          <Pencil size={15} />
        </button>
      </div>
      {hasSubs && task.status !== 'done' && (
        <div className="task-inline-subtasks">
          {task.subtasks.map(s => (
            <label key={s.id} className={`inline-subtask ${s.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                checked={!!s.done}
                onChange={e => toggleSubtask(s.id, e.target.checked)}
              />
              <span>{s.title}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressRing({ done, total }) {
  const p = total ? done / total : 0;
  return (
    <div className="progress-ring">
      <svg viewBox="0 0 150 150" role="img" aria-label={`${done} di ${total} priorità completate`}>
        <circle cx="75" cy="75" r="63" fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="75"
          cy="75"
          r="63"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="7"
          strokeDasharray={`${p * 396} 396`}
          strokeLinecap="round"
          transform="rotate(-90 75 75)"
        />
      </svg>
      <div>
        <strong>
          {done}
          <span> / {total}</span>
        </strong>
        <small>completate</small>
      </div>
    </div>
  );
}

function WeeklyChart({ tasks }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = todayKey(d);
    return {
      key,
      label: new Intl.DateTimeFormat('it-IT', { weekday: 'short', timeZone: 'Europe/Rome' })
        .format(d)
        .slice(0, 3),
      value: tasks.filter(
        t => t.status === 'done' && t.completedAt && todayKey(new Date(t.completedAt)) === key
      ).length,
    };
  });
  const max = Math.max(3, ...days.map(d => d.value));
  return (
    <div
      className="weekly-chart"
      role="img"
      aria-label={`Attività completate negli ultimi sette giorni: ${days
        .map(d => `${d.label} ${d.value}`)
        .join(', ')}`}
    >
      <div className="chart-grid">
        <span>{max}</span>
        <span>0</span>
      </div>
      {days.map((d, i) => (
        <div className="bar-column" key={d.key}>
          <div className="bar-track">
            <div
              className={`bar ${i === 6 ? 'current' : ''}`}
              style={{ height: `${(d.value / max) * 100}%` }}
              title={`${d.key}: ${d.value} completate`}
            />
          </div>
          <small className={i === 6 ? 'current-label' : ''}>{d.label}</small>
        </div>
      ))}
    </div>
  );
}

function GroupedByDateTaskList({ tasks, state, commit, onToggle, onEdit, onPriority, areaFilter }) {
  const [copied, setCopied] = useState(false);
  const sorted = [...tasks].sort((a, b) => (a.dueAt || a.createdAt || '').localeCompare(b.dueAt || b.createdAt || ''));
  const groups = [];
  for (const t of sorted) {
    const key = dueDay(t.dueAt) || 'senza-data';
    let g = groups.find(x => x.key === key);
    if (!g) {
      g = { key, label: key === 'senza-data' ? 'Senza data' : dayLabel(key), items: [] };
      groups.push(g);
    }
    g.items.push(t);
  }
  const doneCount = tasks.filter(t => t.status === 'done').length;

  function copyLogText() {
    const text = groups
      .map(g => `${g.label}\n` + g.items.map(i => `- ${i.title}`).join('\n'))
      .join('\n\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  }

  return (
    <div className="daily-log-view">
      <div className="list-heading">
        <span>
          {tasks.length} attività nel registro ({doneCount} svolte · {tasks.length - doneCount} da fare)
          {areaFilter ? ` · ${getAreaName(state, areaFilter)}` : ''}
        </span>
        <button type="button" className="text-button" onClick={copyLogText}>
          {copied ? 'Registro copiato' : 'Copia registro per data'}
        </button>
      </div>
      {groups.map(group => (
        <div className="log-day-group" key={group.key}>
          <div className="log-day-header">
            <strong>{group.label}</strong>
            <small>{group.items.length} {group.items.length === 1 ? 'attività' : 'attività'}</small>
          </div>
          <div className="log-day-items">
            {group.items.map(task => (
              <TaskRow key={task.id} {...{ task, state, commit, onToggle, onEdit, onPriority }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Today(props) {
  return (
    <TodayWorkspace
      {...props}
      TaskRow={TaskRow}
      ProgressRing={ProgressRing}
      WeeklyChart={WeeklyChart}
    />
  );
}

function Focus({
  state,
  commit,
  onToggle,
  onEdit,
  onPriority,
  create,
  filters,
  setFilters,
  useSpeech,
  openOrb,
}) {
  const [query, setQuery] = useState('');
  const view = filters.view || 'all';
  const areas = getAreas(state);
  const tasks = state.tasks
    .filter(t => {
      if (
        query &&
        !`${t.title} ${t.notes}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))
      )
        return false;
      if (filters.area && t.areaId !== filters.area) return false;
      if (filters.project && t.projectId !== filters.project) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (view === 'log') return true;
      if (view === 'done') return t.status === 'done';
      if (t.status === 'done') return false;
      if (view === 'inbox') return !t.projectId;
      if (view === 'today')
        return (
          (state.plans[todayKey()] || []).includes(t.id) || dueDay(t.dueAt) === todayKey()
        );
      if (view === 'overdue') return t.dueAt && dueDay(t.dueAt) < todayKey();
      if (view === 'upcoming') return t.dueAt && dueDay(t.dueAt) > todayKey();
      return true;
    })
    .sort(
      (a, b) =>
        (a.dueAt || 'z').localeCompare(b.dueAt || 'z') || b.createdAt.localeCompare(a.createdAt)
    );
  const project = state.projects.find(p => p.id === filters.project);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{project ? project.title : 'Agenda'}</h1>
          {project?.goal && <p>{project.goal}</p>}
        </div>
        <button className="button primary" onClick={create}>
          <Plus size={18} />
          Nuova attività
        </button>
      </div>

      <QuickCaptureBar
        state={state}
        commit={commit}
        useSpeech={useSpeech}
        openOrb={openOrb}
        defaultArea={filters.area || project?.areaId || ''}
        defaultProject={filters.project || ''}
      />

      <div className="tabs" role="tablist" aria-label="Vista attività">
        {[
          ['all', 'Da fare'],
          ['log', 'Registro per data'],
          ['inbox', 'Da sistemare'],
          ['today', 'Oggi'],
          ['upcoming', 'Prossime'],
          ['overdue', 'Scadute'],
          ['done', 'Completate'],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'active' : ''}
            onClick={() => setFilters({ ...filters, view: id })}
          >
            {label}
            {id === 'inbox' && (
              <span>{state.tasks.filter(t => !t.projectId && t.status !== 'done').length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Cerca attività"
            placeholder="Cerca…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Filtra per dominio"
          value={filters.area || ''}
          onChange={e => setFilters({ ...filters, area: e.target.value })}
        >
          <option value="">Tutti i domini</option>
          {areas.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtra per priorità"
          value={filters.priority || ''}
          onChange={e => setFilters({ ...filters, priority: e.target.value })}
        >
          <option value="">Tutte le priorità</option>
          <option value="high">Alta</option>
          <option value="normal">Normale</option>
          <option value="low">Bassa</option>
        </select>
        <select
          aria-label="Filtra per progetto"
          value={filters.project || ''}
          onChange={e => setFilters({ ...filters, project: e.target.value })}
        >
          <option value="">Tutti i progetti</option>
          {state.projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <section className="panel task-list">
        {view === 'log' && tasks.length ? (
          <GroupedByDateTaskList
            tasks={tasks}
            state={state}
            commit={commit}
            onToggle={onToggle}
            onEdit={onEdit}
            onPriority={onPriority}
            areaFilter={filters.area}
          />
        ) : (
          <>
            <div className="list-heading">
              <span>
                {tasks.length} {tasks.length === 1 ? 'attività' : 'attività'}
              </span>
              <span>
                <ListFilter size={14} />
                Per scadenza
              </span>
            </div>
            {tasks.length ? (
              tasks.map(task => (
                <TaskRow key={task.id} {...{ task, state, commit, onToggle, onEdit, onPriority }} />
              ))
            ) : (
              <Empty
                title={
                  query || filters.area || filters.priority || filters.project
                    ? 'Nessuna corrispondenza'
                    : view === 'done'
                    ? 'Nessuna attività completata'
                    : 'Nessuna attività'
                }
                text={
                  query || filters.area || filters.priority || filters.project
                    ? 'Prova a cambiare ricerca o filtri.'
                    : view === 'done'
                    ? 'Le attività completate compariranno qui.'
                    : 'Aggiungi un’attività qui sopra.'
                }
              >
                <button className="button secondary" onClick={create}>
                  <Plus size={16} />
                  Aggiungi
                </button>
              </Empty>
            )}
          </>
        )}
      </section>
    </>
  );
}

function Projects({
  state,
  commit,
  onToggle,
  onEdit,
  onPriority,
  create,
  createTask,
  edit,
  filters,
  useSpeech,
  openOrb,
}) {
  const [area, setArea] = useState(filters.area || '');
  const [selectedProject, setSelectedProject] = useState(filters.project || '');
  const [view, setView] = useState(filters.view || 'all');
  const [query, setQuery] = useState('');
  const areas = getAreas(state);

  useEffect(() => {
    setArea(filters.area || '');
    if (filters.project !== undefined) setSelectedProject(filters.project || '');
    if (filters.view) setView(filters.view);
  }, [filters.area, filters.project, filters.view]);

  const projects = state.projects.filter(p => !area || p.areaId === area);
  const activeProject = state.projects.find(p => p.id === selectedProject);
  const filteredTasks = state.tasks
    .filter(t => {
      if (
        query &&
        !`${t.title} ${t.notes}`.toLocaleLowerCase('it').includes(query.toLocaleLowerCase('it'))
      )
        return false;
      if (area && t.areaId !== area) return false;
      if (selectedProject === '__inbox__' && t.projectId) return false;
      if (selectedProject && selectedProject !== '__inbox__' && t.projectId !== selectedProject)
        return false;
      if (view === 'log') return true;
      if (view === 'done') return t.status === 'done';
      if (t.status === 'done') return false;
      if (view === 'today')
        return (
          (state.plans[todayKey()] || []).includes(t.id) || dueDay(t.dueAt) === todayKey()
        );
      if (view === 'overdue') return t.dueAt && dueDay(t.dueAt) < todayKey();
      if (view === 'upcoming') return t.dueAt && dueDay(t.dueAt) >= todayKey();
      return true;
    })
    .sort(
      (a, b) =>
        (a.dueAt || 'z').localeCompare(b.dueAt || 'z') || b.createdAt.localeCompare(a.createdAt)
    );

  const inboxCount = state.tasks.filter(
    t => !t.projectId && t.status !== 'done' && (!area || t.areaId === area)
  ).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {activeProject
              ? activeProject.title
              : selectedProject === '__inbox__'
              ? 'Da sistemare'
              : area
              ? getAreaName(state, area)
              : 'Progetti'}
          </h1>
          {activeProject?.goal && <p>{activeProject.goal}</p>}
        </div>
        <div className="button-row">
          <button className="button secondary" onClick={create}>
            <FolderOpen size={16} />
            Nuovo progetto
          </button>
          <button
            className="button primary"
            onClick={() =>
              createTask(
                selectedProject && selectedProject !== '__inbox__' ? selectedProject : ''
              )
            }
          >
            <Plus size={18} />
            Nuova attività
          </button>
        </div>
      </div>

      <QuickCaptureBar
        state={state}
        commit={commit}
        useSpeech={useSpeech}
        openOrb={openOrb}
        defaultArea={activeProject?.areaId || area || ''}
        defaultProject={selectedProject && selectedProject !== '__inbox__' ? selectedProject : ''}
      />

      <div className="area-tabs">
        <button
          className={!area ? 'active' : ''}
          onClick={() => {
            setArea('');
            setSelectedProject('');
          }}
        >
          Tutti ({state.tasks.filter(t => t.status !== 'done').length})
        </button>
        {areas.map(a => {
          const count = state.tasks.filter(t => t.areaId === a.id && t.status !== 'done').length;
          return (
            <button
              className={area === a.id ? 'active' : ''}
              key={a.id}
              onClick={() => {
                setArea(a.id);
                if (activeProject && activeProject.areaId !== a.id) setSelectedProject('');
              }}
            >
              <span className={`area-dot ${a.id}`} />
              {a.name} <small>({count})</small>
            </button>
          );
        })}
      </div>

      {projects.length > 0 && (
        <div className="project-grid unified-project-grid">
          {projects.map(project => {
            const tasks = state.tasks.filter(t => t.projectId === project.id);
            const openTasks = tasks.filter(t => t.status !== 'done');
            const done = tasks.filter(t => t.status === 'done').length;
            const next = openTasks[0];
            const isSelected = selectedProject === project.id;
            return (
              <article
                className={`panel project-card ${isSelected ? 'is-selected-project' : ''}`}
                key={project.id}
                onClick={() => setSelectedProject(isSelected ? '' : project.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="project-top">
                  <span className={`project-icon ${project.areaId}`}>
                    <FolderOpen size={22} />
                  </span>
                  <div className="button-row" onClick={e => e.stopPropagation()}>
                    <button
                      className="icon-button"
                      onClick={() => createTask(project.id)}
                      title="Nuova attività"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => edit(project)}
                      aria-label={`Modifica progetto ${project.title}`}
                    >
                      <Pencil size={15} />
                    </button>
                  </div>
                </div>
                <span className="eyebrow">{getAreaName(state, project.areaId)}</span>
                <h2>{project.title}</h2>
                <p>{project.goal || 'Nessun obiettivo indicato'}</p>
                <div className="project-progress">
                  <span>
                    {done} di {tasks.length} completate
                  </span>
                  <span>{tasks.length ? Math.round((done / tasks.length) * 100) : 0}%</span>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%`,
                    }}
                  />
                </div>
                <div className="next-action">
                  <small>PROSSIMA ATTIVITÀ</small>
                  <span>{next?.title || 'Nessuna attività aperta'}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="panel unified-tasks-section">
        <div className="unified-tasks-header">
          <div
            className="tabs"
            role="tablist"
            aria-label="Vista attività"
            style={{ marginBottom: 0, borderBottom: 0 }}
          >
            {[
              ['', 'Tutte'],
              ['__inbox__', `Da sistemare (${inboxCount})`],
              ...projects.map(p => [p.id, p.title]),
            ].map(([id, label]) => (
              <button
                key={id || 'all'}
                type="button"
                className={selectedProject === id ? 'active' : ''}
                onClick={() => setSelectedProject(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-bar" style={{ marginTop: 14 }}>
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Cerca attività"
              placeholder="Cerca…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
          <div className="segmented">
            {[
              ['all', 'Da fare'],
              ['log', 'Registro per data'],
              ['today', 'Oggi'],
              ['upcoming', 'Con scadenza'],
              ['done', 'Completate'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={view === id ? 'active' : ''}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="task-list">
          {view === 'log' && filteredTasks.length ? (
            <GroupedByDateTaskList
              tasks={filteredTasks}
              state={state}
              commit={commit}
              onToggle={onToggle}
              onEdit={onEdit}
              onPriority={onPriority}
              areaFilter={area}
            />
          ) : filteredTasks.length ? (
            filteredTasks.map(task => (
              <TaskRow key={task.id} {...{ task, state, commit, onToggle, onEdit, onPriority }} />
            ))
          ) : (
            <Empty title="Nessuna attività" text="Aggiungi un’attività qui sopra.">
              <button
                className="button secondary"
                onClick={() =>
                  createTask(
                    selectedProject && selectedProject !== '__inbox__' ? selectedProject : ''
                  )
                }
              >
                <Plus size={16} />
                Aggiungi
              </button>
            </Empty>
          )}
        </div>
      </section>
    </>
  );
}

function Settings({ state, backend, storage, exportJson, exportCsv, onImport, commit }) {
  const [name, setName] = useState(state.settings?.name || 'Alex');
  const [saved, setSaved] = useState(false);
  const currentAreas = getAreas(state);
  const [areaDrafts, setAreaDrafts] = useState(() =>
    Object.fromEntries(currentAreas.map(a => [a.id, { name: a.name, subtitle: a.subtitle || '' }]))
  );
  const [areasSaved, setAreasSaved] = useState(false);

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Impostazioni</h1>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel settings-card">
          <div className="panel-heading">
            <h2>
              <ShieldCheck size={19} />
              Archivio
            </h2>
            <span className="status-badge">
              <span />
              {storage === 'saving' ? 'Salvataggio…' : 'Attivo'}
            </span>
          </div>
          <dl>
            <div>
              <dt>Stato</dt>
              <dd>
                {storage === 'saving'
                  ? 'Salvataggio in corso…'
                  : storage === 'error'
                  ? 'Verifica salvataggio'
                  : 'Sincronizzato'}
              </dd>
            </div>
            <div>
              <dt>Contenuto</dt>
              <dd>
                {state.tasks.length} attività · {state.projects.length} progetti
              </dd>
            </div>
          </dl>
          <div className="button-row">
            <button className="button secondary" onClick={exportJson}>
              <ArrowDownToLine size={16} />
              Backup JSON
            </button>
            <button className="button ghost" onClick={exportCsv}>
              <ArrowDownToLine size={16} />
              Attività CSV
            </button>
          </div>
          <label className="import-button button ghost">
            <ArrowUpFromLine size={16} />
            Importa JSON o CSV
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              onChange={e => {
                if (e.target.files[0]) onImport(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
        </section>

        <section className="panel settings-card">
          <div className="panel-heading">
            <h2>
              <Settings2 size={19} />
              Profilo & Merlino
            </h2>
            <span className="quiet-badge">Attivo</span>
          </div>
          <dl>
            <div>
              <dt>Consigliere</dt>
              <dd>Merlino ({backend?.model || 'gemini-3.5-flash-lite'})</dd>
            </div>
            <div>
              <dt>Voce</dt>
              <dd>
                {(window.SpeechRecognition || window.webkitSpeechRecognition) &&
                window.isSecureContext
                  ? 'Dettatura continua attiva'
                  : 'Usa testo'}
              </dd>
            </div>
          </dl>
          <form
            onSubmit={async e => {
              e.preventDefault();
              try {
                await commit([], 'Preferenze salvate', current => ({
                  ...current,
                  settings: { ...current.settings, name: name.trim() },
                }));
                setSaved(true);
              } catch {}
            }}
          >
            <label>
              Nome
              <input
                value={name}
                maxLength={60}
                onChange={e => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                placeholder="Nome"
              />
            </label>
            <button className="button secondary" type="submit">
              <Check size={16} />
              {saved ? 'Salvato' : 'Salva'}
            </button>
          </form>
        </section>

        <section className="panel settings-card" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-heading">
            <h2>
              <FolderOpen size={19} />
              Nomi dei Domini
            </h2>
            <span className="quiet-badge">Personalizzabili</span>
          </div>
          <p>
            Puoi rinominare i domini in qualsiasi momento se cambiano i tuoi progetti o le tue
            attività.
          </p>
          <form
            onSubmit={async e => {
              e.preventDefault();
              try {
                await commit([], 'Domini aggiornati', current => ({
                  ...current,
                  settings: { ...current.settings, areaLabels: areaDrafts },
                }));
                setAreasSaved(true);
              } catch {}
            }}
          >
            <div className="form-grid" style={{ marginTop: 14 }}>
              {AREAS.map(a => (
                <label key={a.id}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <i className={`area-dot ${a.id}`} /> Nome dominio
                  </span>
                  <input
                    value={areaDrafts[a.id]?.name || ''}
                    maxLength={80}
                    required
                    onChange={e => {
                      setAreasSaved(false);
                      setAreaDrafts(d => ({
                        ...d,
                        [a.id]: { ...d[a.id], name: e.target.value },
                      }));
                    }}
                  />
                </label>
              ))}
            </div>
            <button className="button secondary" type="submit">
              <Check size={16} />
              {areasSaved ? 'Domini salvati' : 'Salva nomi domini'}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}

function TaskModal({ task, state, onClose, onSave, onDelete, initialProject }) {
  const areas = getAreas(state);
  const [draft, setDraft] = useState(
    task
      ? { ...task, subtasks: (task.subtasks || []).map(s => ({ ...s })) }
      : {
          title: '',
          notes: '',
          areaId: state.projects.find(p => p.id === initialProject)?.areaId || 'personale',
          projectId: initialProject || '',
          priority: 'normal',
          dueAt: '',
          reminderAt: '',
          recurrenceRule: '',
          subtasks: [],
        }
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState('');
  const [remove, setRemove] = useState(false);
  const set = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const {
        id,
        title,
        notes,
        areaId,
        projectId,
        priority,
        dueAt,
        reminderAt,
        recurrenceRule,
        subtasks,
      } = draft;
      await onSave({
        ...(id ? { id } : {}),
        title,
        notes,
        areaId,
        projectId: projectId || null,
        priority,
        dueAt: dueAt || null,
        reminderAt: reminderAt
          ? /(?:Z|[+-]\d{2}:\d{2})$/.test(reminderAt)
            ? reminderAt
            : parseRomeDateTime(reminderAt)
          : null,
        recurrenceRule: recurrenceRule || null,
        subtasks,
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={task ? 'Modifica attività' : 'Nuova attività'} onClose={onClose}>
      <form onSubmit={save} className="edit-form">
        <label>
          Attività
          <input
            autoFocus
            required
            maxLength={240}
            value={draft.title}
            onChange={e => set('title', e.target.value)}
            placeholder="Titolo"
          />
        </label>
        <label>
          Note
          <textarea
            rows={3}
            maxLength={10000}
            value={draft.notes || ''}
            onChange={e => set('notes', e.target.value)}
            placeholder="Note…"
          />
        </label>
        <div className="form-grid">
          <label>
            Dominio
            <select value={draft.areaId} onChange={e => set('areaId', e.target.value)}>
              {areas.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Progetto
            <select
              value={draft.projectId || ''}
              onChange={e => {
                const p = state.projects.find(p => p.id === e.target.value);
                setDraft(d => ({
                  ...d,
                  projectId: e.target.value,
                  areaId: p?.areaId || d.areaId,
                }));
              }}
            >
              <option value="">Da sistemare</option>
              {state.projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priorità
            <select value={draft.priority} onChange={e => set('priority', e.target.value)}>
              <option value="low">Bassa</option>
              <option value="normal">Normale</option>
              <option value="high">Alta</option>
            </select>
          </label>
          <label>
            Scadenza
            <input
              type="date"
              value={dueDay(draft.dueAt) || ''}
              onChange={e => set('dueAt', e.target.value)}
              onInput={e => set('dueAt', e.currentTarget.value)}
            />
          </label>
          <label>
            Promemoria
            <input
              type="datetime-local"
              value={localDateInput(draft.reminderAt)}
              onChange={e => set('reminderAt', e.target.value)}
              onInput={e => set('reminderAt', e.currentTarget.value)}
            />
          </label>
          <label>
            Ripetizione
            <select
              value={draft.recurrenceRule || ''}
              onChange={e => set('recurrenceRule', e.target.value)}
            >
              <option value="">Non ripetere</option>
              <option value="daily">Ogni giorno</option>
              <option value="weekly">Ogni settimana</option>
              <option value="monthly">Ogni mese</option>
            </select>
          </label>
        </div>

        <div className="subtasks">
          <div className="subtasks-header-row">
            <label>Passaggi</label>
            {draft.title.trim() && !draft.subtasks.length && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  set(
                    'subtasks',
                    generateSubtasksForTask({ title: draft.title, areaId: draft.areaId })
                  )
                }
              >
                <Sparkles size={13} /> Genera passaggi
              </button>
            )}
          </div>
          {draft.subtasks.map((s, i) => (
            <div key={s.id}>
              <input
                type="checkbox"
                aria-label={`Completa sottoattività ${s.title}`}
                checked={!!s.done}
                onChange={e =>
                  set(
                    'subtasks',
                    draft.subtasks.map((item, n) =>
                      n === i ? { ...item, done: e.target.checked } : item
                    )
                  )
                }
              />
              <span>{s.title}</span>
              <button
                className="icon-button"
                type="button"
                aria-label={`Elimina sottoattività ${s.title}`}
                onClick={() =>
                  set(
                    'subtasks',
                    draft.subtasks.filter((_, n) => n !== i)
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <div className="subtask-add">
            <input
              aria-label="Nuova sottoattività"
              value={sub}
              maxLength={240}
              onChange={e => setSub(e.target.value)}
              placeholder="Aggiungi passaggio…"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (sub.trim()) {
                    set('subtasks', [
                      ...draft.subtasks,
                      { id: uuid(), title: sub.trim(), done: false },
                    ]);
                    setSub('');
                  }
                }
              }}
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Aggiungi sottoattività"
              disabled={!sub.trim()}
              onClick={() => {
                set('subtasks', [
                  ...draft.subtasks,
                  { id: uuid(), title: sub.trim(), done: false },
                ]);
                setSub('');
              }}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {remove && (
          <div className="delete-confirm">
            <p>Eliminare “{task.title}”?</p>
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete(task);
                  onClose();
                } catch (e) {
                  setError(e.message);
                  setBusy(false);
                }
              }}
            >
              Conferma
            </button>
            <button type="button" className="button ghost" onClick={() => setRemove(false)}>
              Annulla
            </button>
          </div>
        )}
        <footer>
          {task && (
            <button
              className="icon-button danger-text"
              type="button"
              aria-label="Elimina attività"
              onClick={() => setRemove(true)}
            >
              <Trash2 size={18} />
            </button>
          )}
          {task && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() + 1);
                set('dueAt', todayKey(d));
              }}
            >
              Sposta a domani
            </button>
          )}
          <div className="spacer" />
          <button className="button ghost" type="button" onClick={onClose}>
            Annulla
          </button>
          <button className="button primary" disabled={busy || !draft.title.trim()}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ProjectModal({ project, state, onClose, onSave }) {
  const areas = getAreas(state);
  const [title, setTitle] = useState(project?.title || '');
  const [goal, setGoal] = useState(project?.goal || '');
  const [areaId, setArea] = useState(project?.areaId || 'personale');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={project ? 'Modifica progetto' : 'Nuovo progetto'} onClose={onClose}>
      <form
        className="edit-form"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({ ...(project ? { id: project.id } : {}), title, goal, areaId });
            onClose();
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <label>
          Nome progetto
          <input
            autoFocus
            value={title}
            maxLength={160}
            required
            onChange={e => setTitle(e.target.value)}
            placeholder="Nome del progetto"
          />
        </label>
        <label>
          Obiettivo
          <textarea
            value={goal}
            maxLength={3000}
            onChange={e => setGoal(e.target.value)}
            rows={3}
            placeholder="Obiettivo…"
          />
        </label>
        <label>
          Dominio
          <select value={areaId} onChange={e => setArea(e.target.value)}>
            {areas.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <div className="spacer" />
          <button className="button ghost" type="button" onClick={onClose}>
            Annulla
          </button>
          <button className="button primary" disabled={busy || !title.trim()}>
            {busy ? 'Salvataggio…' : 'Salva'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function App() {
  const [state, setState] = useState(null);
  const stateRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const [bootError, setBootError] = useState('');
  const [page, setPage] = useState(() =>
    nav.some(n => n.id === location.hash.slice(1)) ? location.hash.slice(1) : 'today'
  );
  const [filters, setFilters] = useState({});
  const [storage, setStorage] = useState('ready');
  const [taskModal, setTaskModal] = useState(null);
  const [projectModal, setProjectModal] = useState(null);
  const [priorityModal, setPriorityModal] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [orbOpen, setOrbOpen] = useState(false);
  const [orbDocked, setOrbDocked] = useState(false);
  const [orbDraft, setOrbDraft] = useState('');
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [backend, setBackend] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const mainRef = useRef();
  const financeCtx = useFinance();

  useEffect(() => {
    let active = true;
    repository
      .load()
      .then(data => {
        if (active) {
          const valid = validateState(data || emptyState());
          stateRef.current = valid;
          setState(valid);
        }
      })
      .catch(e => {
        if (active) setBootError(e.message);
      });
    fetch(`${import.meta.env.VITE_API_BASE_URL || ''}/api/status`)
      .then(r =>
        r.ok && r.headers.get('content-type')?.includes('application/json') ? r.json() : null
      )
      .then(data => {
        if (active) setBackend(data);
      })
      .catch(() => {});
    const changed = () => {
      const id = location.hash.slice(1);
      if (id === 'assistant') {
        setOrbOpen(true);
      } else if (nav.some(n => n.id === id)) {
        setPage(id);
      }
    };
    window.addEventListener('hashchange', changed);
    return () => {
      active = false;
      window.removeEventListener('hashchange', changed);
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.error) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handler = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setTaskModal({});
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  function navigate(id, nextFilters = {}) {
    if (id === 'assistant') {
      setOrbOpen(true);
      return;
    }
    location.hash = id;
    setPage(id);
    setFilters(nextFilters);
    setMobile(false);
    mainRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }

  function openOrb(draft = '') {
    if (typeof draft === 'string' && draft.trim()) setOrbDraft(draft);
    setOrbOpen(true);
  }

  function commit(actions, message = 'Salvato', transform) {
    const operationId = uuid();
    const pending = queue.current
      .catch(() => {})
      .then(async () => {
        setStorage('saving');
        const before = stateRef.current;
        let writeStarted = false;
        try {
          const next = validateState(
            transform ? transform(before) : applyActions(before, actions, operationId)
          );
          writeStarted = true;
          await repository.save(next);
          stateRef.current = next;
          setState(next);
          setStorage('ready');
          setUndo(before);
          if (message) setToast({ text: message });
          return next;
        } catch (e) {
          setStorage(writeStarted ? 'error' : 'ready');
          setToast({ text: `Non salvato: ${e.message}`, error: true });
          throw e;
        }
      });
    queue.current = pending;
    return pending;
  }

  async function toggle(task) {
    try {
      await commit(
        [{ type: 'complete_task', args: { id: task.id, completed: task.status !== 'done' } }],
        task.status === 'done' ? 'Attività riaperta' : 'Completata'
      );
    } catch {}
  }

  async function priority(task) {
    try {
      await commit([], 'Priorità aggiornate', current => {
        const ids = current.plans[todayKey()] || [];
        if (!ids.includes(task.id) && ids.length >= (current.settings.priorityCount || 3))
          throw new Error('Rimuovi una priorità per aggiungerne un’altra.');
        return applyActions(
          current,
          [
            {
              type: 'set_daily_priorities',
              args: {
                date: todayKey(),
                taskIds: ids.includes(task.id)
                  ? ids.filter(id => id !== task.id)
                  : [...ids, task.id],
              },
            },
          ],
          uuid()
        );
      });
    } catch {}
  }

  function exportJson() {
    download(
      `empire-os-backup-${todayKey()}.json`,
      JSON.stringify(stateRef.current, null, 2),
      'application/json'
    );
  }

  async function inspectImport(file) {
    try {
      if (file.size > 40 * 1024 * 1024) throw new Error('Il file supera il limite di 40 MB.');
      const text = await file.text();
      let incoming;
      if (file.name.toLowerCase().endsWith('.csv')) {
        incoming = importCsvState(text);
      } else {
        const parsed = JSON.parse(text);
        if (parsed.empireUnifiedBundle === 1 && parsed.tasks && parsed.finance) {
          const nextTasks = mergeImport(stateRef.current, validateState(parsed.tasks));
          setImportPreview({
            incoming: validateState(parsed.tasks),
            incomingFinance: parsed.finance,
            filename: file.name,
            tasks: nextTasks.tasks.length - stateRef.current.tasks.length,
            projects: nextTasks.projects.length - stateRef.current.projects.length,
            financeCount: parsed.finance.transactions?.length || 0,
          });
          return;
        }
        incoming = validateState(parsed);
      }
      const next = mergeImport(stateRef.current, incoming);
      setImportPreview({
        incoming,
        filename: file.name,
        tasks: next.tasks.length - stateRef.current.tasks.length,
        projects: next.projects.length - stateRef.current.projects.length,
      });
    } catch (e) {
      setToast({
        text: `Importazione fermata: ${e.message}. Nessun dato modificato.`,
        error: true,
      });
    }
  }

  if (bootError)
    return (
      <div className="boot-screen">
        <Logo />
        <h1>Archivio non disponibile</h1>
        <p>{bootError}</p>
        <button className="button primary" onClick={() => location.reload()}>
          Riprova
        </button>
      </div>
    );
  if (!state)
    return (
      <div className="boot-screen">
        <Logo />
        <h1>Empire OS</h1>
        <LoaderCircle className="spin" />
        <p>Caricamento…</p>
      </div>
    );

  const common = {
    state,
    commit,
    onToggle: toggle,
    onEdit: setTaskModal,
    onPriority: priority,
    navigate,
    backend,
    useSpeech,
    openOrb,
  };
  const pendingCount = state.tasks.filter(t => t.status !== 'done' && !t.projectId).length;
  const areas = getAreas(state);

  return (
    <div className={`app-shell ${orbOpen && orbDocked ? 'has-docked-ai' : ''}`}>
      <a className="skip-link" href="#main">
        Vai al contenuto
      </a>

      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <a
          className="brand"
          href="#today"
          onClick={e => {
            e.preventDefault();
            navigate('today');
          }}
        >
          <Logo />
          <span>
            EMPIRE <b>OS</b>
            <small>IL MONDO DI {state.settings?.name || 'Alex'}</small>
          </span>
        </a>

        <div className="workspace-label">SPAZIO</div>
        <nav aria-label="Navigazione principale">
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} strokeWidth={1.65} />
                <span>{item.label}</span>
                {item.id === 'focus' && pendingCount > 0 && <small>{pendingCount}</small>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-areas">
          <span className="workspace-label">DOMINI</span>
          {areas.map(area => (
            <button key={area.id} onClick={() => navigate('projects', { area: area.id })}>
              <span className={`area-dot ${area.id}`} />
              {area.name}
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-seal" aria-hidden="true">
            <img src="/empire-seal.svg" alt="" />
          </div>
          <button className="storage-indicator" onClick={() => navigate('settings')}>
            <span className={storage === 'error' ? 'red' : ''} />
            <div>
              <strong>
                {storage === 'saving'
                  ? 'Salvataggio…'
                  : storage === 'error'
                  ? 'Verifica salvataggio'
                  : 'Archivio personale'}
              </strong>
              <small>Sincronizzato</small>
            </div>
            <ShieldCheck size={16} />
          </button>
        </div>
      </aside>

      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="Chiudi menu"
          onClick={() => setMobile(false)}
        />
      )}

      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button menu-button"
              aria-label="Apri menu"
              onClick={() => setMobile(!mobile)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              {state.settings?.name || 'Alex'} <span>/</span>{' '}
              <strong>{nav.find(n => n.id === page)?.label || 'Oggi'}</strong>
            </span>
          </div>
          <div>
            <span className="top-date">
              {new Intl.DateTimeFormat('it-IT', {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
                timeZone: 'Europe/Rome',
              }).format(new Date())}
            </span>
            <button
              type="button"
              className={`quick-add merlino-top-btn ${orbOpen ? 'active' : ''}`}
              onClick={() => setOrbOpen(!orbOpen)}
            >
              <Feather size={15} />
              <span>Merlino</span>
            </button>
            <button className="quick-add" onClick={() => setTaskModal({})}>
              <Plus size={16} />
              <span>Aggiungi</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="avatar"
              onClick={() => navigate('settings')}
              aria-label="Apri preferenze"
            >
              {state.settings?.name?.slice(0, 1).toUpperCase() || 'A'}
            </button>
          </div>
        </header>

        <div className="workspace-body">
          <main id="main" ref={mainRef} className="workspace-main">
            <div className={`content page-${page}`}>
              {page === 'today' && (
                <Today {...common} choose={() => setPriorityModal(true)} />
              )}
              {page === 'focus' && (
                <Focus
                  {...common}
                  filters={filters}
                  setFilters={setFilters}
                  create={() => setTaskModal({})}
                />
              )}
              {page === 'projects' && (
                <Projects
                  {...common}
                  filters={filters}
                  setFilters={setFilters}
                  create={() => setProjectModal({})}
                  createTask={projId => {
                    setFilters(f => ({ ...f, project: projId || '' }));
                    setTaskModal({});
                  }}
                  edit={setProjectModal}
                />
              )}
              {page === 'finance' && (
                <FinanceWorkspace
                  key={
                    'finance:' +
                    (filters.financeView || 'overview') +
                    ':' +
                    (filters.financeAction || '')
                  }
                  initialView={filters.financeView || 'overview'}
                  initialAction={filters.financeAction || null}
                />
              )}
              {page === 'business' && <FinanceWorkspace key="business" businessMode />}
              {page === 'settings' && (
                <Settings
                  {...common}
                  backend={backend}
                  storage={storage}
                  exportJson={exportJson}
                  exportCsv={() =>
                    download(
                      `empire-os-attivita-${todayKey()}.csv`,
                      exportTasksCsv(stateRef.current),
                      'text/csv;charset=utf-8'
                    )
                  }
                  onImport={inspectImport}
                />
              )}
            </div>
            <footer className="app-footer">
              <span>
                EMPIRE OS <i>·</i> {state.settings?.name || 'Alex'}
              </span>
              <span>Europe/Rome</span>
            </footer>
          </main>

          {orbOpen && orbDocked && (
            <aside className="docked-ai-panel" aria-label="Pannello Merlino">
              <AssistantWorkspace
                {...common}
                initialDraft={orbDraft}
                docked={true}
                onToggleDock={() => setOrbDocked(false)}
                onClose={() => setOrbOpen(false)}
              />
            </aside>
          )}
        </div>
      </div>

      {/* PALLINO MERLINO */}
      <button
        className={`ai-orb-button ${orbOpen ? 'is-open' : ''}`}
        onClick={() => setOrbOpen(!orbOpen)}
        aria-label="Apri Merlino"
        title="Merlino"
      >
        <Feather size={20} />
        <span>Merlino</span>
      </button>

      {orbOpen && !orbDocked && (
        <div className="ai-orb-backdrop" onClick={() => setOrbOpen(false)}>
          <div className="ai-orb-drawer" onClick={e => e.stopPropagation()}>
            <AssistantWorkspace
              {...common}
              initialDraft={orbDraft}
              docked={false}
              onToggleDock={() => setOrbDocked(true)}
              onClose={() => setOrbOpen(false)}
            />
          </div>
        </div>
      )}

      <nav className="mobile-nav" aria-label="Navigazione mobile">
        {nav
          .filter(n => ['today', 'focus', 'projects', 'finance', 'business'].includes(n.id))
          .map(n => {
            const Icon = n.icon;
            return (
              <button
                className={page === n.id ? 'active' : ''}
                key={n.id}
                onClick={() => navigate(n.id)}
              >
                <Icon size={20} />
                <span>{n.label}</span>
              </button>
            );
          })}
        <button
          onClick={() => setTaskModal({})}
          className="mobile-add"
          aria-label="Nuova attività"
        >
          <Plus size={22} />
        </button>
      </nav>

      {taskModal && (
        <TaskModal
          task={taskModal.id ? taskModal : null}
          state={state}
          initialProject={filters.project}
          onClose={() => setTaskModal(null)}
          onSave={args =>
            commit(
              [{ type: taskModal.id ? 'update_task' : 'create_task', args }],
              'Salvato'
            )
          }
          onDelete={t =>
            commit([{ type: 'delete_task', args: { id: t.id } }], 'Eliminata')
          }
        />
      )}

      {projectModal && (
        <ProjectModal
          project={projectModal.id ? projectModal : null}
          state={state}
          onClose={() => setProjectModal(null)}
          onSave={args =>
            commit(
              [{ type: projectModal.id ? 'update_project' : 'create_project', args }],
              'Progetto salvato'
            )
          }
        />
      )}

      {priorityModal && (
        <Modal
          title="Priorità di oggi"
          subtitle={`Scegli fino a ${state.settings.priorityCount || 3} attività.`}
          onClose={() => setPriorityModal(false)}
        >
          {state.tasks.filter(t => t.status !== 'done').length ? (
            <div className="priority-picker">
              {state.tasks
                .filter(t => t.status !== 'done')
                .map(t => (
                  <TaskRow key={t.id} {...common} task={t} />
                ))}
            </div>
          ) : (
            <Empty title="Nessuna attività" text="Aggiungi un’attività.">
              <button
                className="button primary"
                onClick={() => {
                  setPriorityModal(false);
                  setTaskModal({});
                }}
              >
                Aggiungi
              </button>
            </Empty>
          )}
          <div className="modal-bottom">
            <button className="button primary" onClick={() => setPriorityModal(false)}>
              Fatto
            </button>
          </div>
        </Modal>
      )}

      {importPreview && (
        <Modal
          title="Controlla l’importazione"
          subtitle={importPreview.filename}
          onClose={() => setImportPreview(null)}
        >
          <div className="guide-body">
            <h3>
              {importPreview.tasks} nuove attività · {importPreview.projects} nuovi progetti
              {importPreview.financeCount
                ? ` · ${importPreview.financeCount} movimenti finanziari`
                : ''}
            </h3>
            <p>
              Gli ID già presenti vengono conservati. Prima di unire verrà scaricato un backup
              dell’archivio attuale.
            </p>
            <div className="button-row">
              <button
                className="button primary"
                onClick={async () => {
                  const incoming = importPreview.incoming;
                  const incomingFinance = importPreview.incomingFinance;
                  exportJson();
                  try {
                    await commit([], 'Dati uniti', current => mergeImport(current, incoming));
                    if (incomingFinance && financeCtx?.save)
                      await financeCtx.save(incomingFinance);
                    setImportPreview(null);
                  } catch {}
                }}
              >
                Conferma
              </button>
              <button className="button ghost" onClick={() => setImportPreview(null)}>
                Annulla
              </button>
            </div>
          </div>
        </Modal>
      )}

      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          {undo && !toast.error && (
            <button
              disabled={storage === 'saving'}
              onClick={async () => {
                const previous = undo;
                try {
                  await commit([], 'Annullato', () => previous);
                  setUndo(null);
                } catch {}
              }}
            >
              Annulla
            </button>
          )}
          <button
            className="icon-button"
            aria-label="Chiudi messaggio"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: false };
  }
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="boot-screen">
        <Logo />
        <h1>Impossibile visualizzare la schermata</h1>
        <p>I dati già salvati sono conservati nell’archivio.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Ricarica
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <FinanceProvider>
      <App />
    </FinanceProvider>
  </ErrorBoundary>
);
if ('serviceWorker' in navigator) {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}
