/**
 * The minimum age for a Paragon account.
 *
 * Under-13s are refused outright rather than given a restricted account.
 * Verifiable parental consent under COPPA is a compliance apparatus of its own,
 * and once messaging exists a restricted-minor tier means a permission system
 * across every social surface. The refusal is a screen; the alternative is a
 * sub-project.
 */
export const MINIMUM_AGE = 13;

/**
 * Whether someone born on `birthDate` (an ISO `YYYY-MM-DD` day) has reached
 * `minimum` years by `now`.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so the
 * boundary — thirteen exactly today passes, one day short fails — can be tested
 * against a fixed clock instead of a suite that starts failing on a birthday.
 *
 * The date is split by hand rather than passed to `new Date(string)`, which
 * parses a bare `YYYY-MM-DD` as UTC midnight and therefore lands on the
 * previous day for anyone west of Greenwich. A gate that moves someone's
 * birthday by a day is wrong in exactly the place it matters.
 */
/**
 * Whether `value` is a real `YYYY-MM-DD` day.
 *
 * Separate from the age question so the screen can tell a typo from a refusal.
 * They are very different messages: one asks the person to check what they
 * typed, the other tells them they cannot have an account.
 */
export function isRealDate(value: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  // A day that does not exist rolls forward silently — 2001-02-30 becomes the
  // 2nd of March — so a date is only accepted if it survives the round trip.
  const born = new Date(year, month - 1, day);
  return born.getFullYear() === year && born.getMonth() === month - 1 && born.getDate() === day;
}

export function isOldEnough(birthDate: string, now: Date, minimum = MINIMUM_AGE): boolean {
  if (!isRealDate(birthDate)) return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)!;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);

  // The day they turn `minimum`. A 29 February birthday rolls to 1 March in
  // non-leap years, which makes the gate a day stricter for them once every
  // four years — the harmless direction, and the one that needs no special case.
  const eligibleOn = new Date(year + minimum, month - 1, day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return eligibleOn.getTime() <= today.getTime();
}
