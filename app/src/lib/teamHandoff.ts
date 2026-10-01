/**
 * A team picked on one screen for the builder on another (a Rankings row's "Load", for instance).
 * Held in the module rather than in app state: it is read exactly once, by the builder that mounts next, and a
 * team of the other size is not for that builder.
 */
let pending: { size: number; refs: string[] } | null = null;

export function handOffTeam(refs: string[], size: number): void {
  pending = { size, refs: [...refs] };
}

export function takeHandedOffTeam(size: number): string[] | null {
  const p = pending;
  if (!p || p.size !== size) return null;
  pending = null;
  return p.refs;
}
