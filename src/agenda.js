import { todayKey } from './domain.js';
export const taskDay = task => !task.dueAt ? null : task.dueAt.length === 10 ? task.dueAt : todayKey(new Date(task.dueAt));
export function agendaWindow(state, date = todayKey()) {
  const stop = new Date(date + 'T12:00:00Z'); stop.setUTCDate(stop.getUTCDate() + 7);
  const end = stop.toISOString().slice(0,10);
  return state.tasks.filter(t => t.status !== 'done' && !t.archived && taskDay(t) && taskDay(t) <= end).sort((a,b) => taskDay(a).localeCompare(taskDay(b)) || a.dueAt.localeCompare(b.dueAt));
}
