/**
 * Panel ordering, persisted per section.
 *
 * The report screen is a stack of independent readouts, and which one matters
 * most depends entirely on what you are doing: someone tuning a spread wants
 * the heatmap first, someone checking a matchup wants the opponent board first.
 * Rather than guess an order for everyone, the order is theirs to set and it
 * survives a reload.
 *
 * Stored as a list of ids rather than a list of nodes, so a saved layout keeps
 * working when panels are added or removed. Unknown ids are dropped and new
 * ones appended in their declared position — a release that adds a panel does
 * not wipe a layout, and one that removes a panel does not leave a hole.
 */

const PREFIX = 'paragon.layout.';

/** Read a saved order, reconciled against the panels that currently exist. */
export function loadOrder(key: string, defaults: readonly string[]): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) saved = JSON.parse(raw) as string[];
  } catch {
    // A corrupt or unavailable store is not worth failing a render over —
    // private-mode browsers throw on access alone. Fall through to defaults.
  }
  if (!Array.isArray(saved) || saved.length === 0) return [...defaults];
  const known = new Set(defaults);
  const kept = saved.filter((id) => known.has(id));
  // Anything new since the layout was saved goes back where it was declared,
  // which keeps a new panel next to the panels it belongs with.
  const missing = defaults.filter((id) => !kept.includes(id));
  for (const id of missing) kept.splice(defaults.indexOf(id), 0, id);
  return kept;
}

export function saveOrder(key: string, order: readonly string[]): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(order));
  } catch {
    // Same reasoning as loadOrder: losing a layout is survivable, throwing
    // during a drag is not.
  }
}

export function clearOrder(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* see loadOrder */
  }
}

/** Move one item to another index, returning a new list. */
export function reorder(list: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
