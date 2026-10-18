/** the next time (after `from`) a cron line "M H * * *" fires, in UTC: the nightly draft's (wrangler.jsonc). Only a
    fixed minute and hour; anything else in the line is refused rather than read wrong. */
export function nextRun(line, from) {
  const m = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*\s*$/.exec(line || '');
  if (!m || +m[1] > 59 || +m[2] > 23) throw new Error(`NIGHTLY_CRON 只支持「分 时 * * *」（UTC），比如 30 15 * * *：${line}`);
  const t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), +m[2], +m[1]));
  if (t <= from) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}
