/** Runs one server call for the host panel: one at a time, failures surfaced, `true` on success. */
export type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
