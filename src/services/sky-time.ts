/**
 * The moment and clock every view computes and prints with.
 *
 * A deep link (?date=…&time=…&tz=…) fixes the moment and, with `tz`, the
 * clock its times are shown on. Without a link the moment is "now" on the
 * device's own clock. Views must use these helpers instead of `new Date()`
 * and bare `toLocaleTimeString()`, or a Perth link opened in Sydney shows
 * Sydney times under a Perth banner.
 *
 * Pure: no DOM, so it can be tested in Node.
 */

export interface SkyMoment {
  at?: Date | null;
  atZone?: string | null;
}

/** The instant the page should be computed for: the link's, else now. */
export function viewTime(ctx: SkyMoment): Date {
  return ctx.at ? new Date(ctx.at.getTime()) : new Date();
}

/** The IANA zone times should be printed in, or undefined for the device's. */
export function viewZone(ctx: SkyMoment): string | undefined {
  return ctx.atZone ?? undefined;
}

/** "09:30 pm" on the given clock (device clock when zone is undefined). */
export function formatClock(
  d: Date | null | undefined,
  zone?: string,
  locale?: string | string[],
): string {
  if (!d) return "—";
  return d.toLocaleTimeString(locale ?? [], {
    hour: "2-digit",
    minute: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  });
}

/** "Sat 20 Jun, 12:00 pm" on the given clock. */
export function formatWhen(
  d: Date,
  zone?: string,
  locale?: string | string[],
): string {
  return d.toLocaleString(locale ?? [], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  });
}

/** Calendar month (1-12) and day on the given clock. */
export function zonedMonthDay(
  d: Date,
  zone?: string,
): { month: number; day: number } {
  if (!zone) return { month: d.getMonth() + 1, day: d.getDate() };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { month: get("month"), day: get("day") };
}

/** "YYYY-MM-DD" on the given clock, for per-night cache keys. */
export function zonedDayKey(d: Date, zone?: string): string {
  if (!zone)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
