// DeepSeek API peak-pricing windows, defined in Beijing wall-clock time.
// There is no pricing-schedule API, so these published windows are maintained
// by hand. They apply Monday through Friday; weekends are entirely off-peak.
const DEEPSEEK_PEAK_WINDOWS_BEIJING = [
  { start: "09:00", end: "12:00" },
  { start: "14:00", end: "18:00" },
];

// Beijing uses the IANA Asia/Shanghai zone and stays on UTC+8 year-round.
const BEIJING_TZ = "Asia/Shanghai";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function isChineseLocale(locale) {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh");
}

function parseHmToMs(hm) {
  const [h, m] = hm.split(":").map(Number);
  return h * HOUR_MS + m * MINUTE_MS;
}

/**
 * Offset of `timeZone` from UTC at the given instant, in ms (UTC+8 → +8h).
 * Derived through Intl so the machine's local time zone and its daylight
 * saving rules can never leak into the calculation.
 */
function getTimeZoneOffsetMs(date, timeZone) {
  const parts = {};
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  for (const { type, value } of formatted) parts[type] = value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // Intl only carries second precision, so compare on whole seconds.
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a Beijing wall-clock target (day offset from `wall`'s date plus
 * ms-of-day) back to a UTC instant.
 */
function wallClockToInstant(wall, dayOffset, msOfDay, offsetMsGuess) {
  const wallMidnightUtc = Date.UTC(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate() + dayOffset,
  );
  let instantMs = wallMidnightUtc + msOfDay - offsetMsGuess;
  // Re-derive the offset at the target instant in case it differs from now's.
  instantMs = wallMidnightUtc + msOfDay - getTimeZoneOffsetMs(new Date(instantMs), BEIJING_TZ);
  return new Date(instantMs);
}

/**
 * Formats a duration for countdown display: "2h 14m" / "37m" in English,
 * "2小时14分钟" / "37分钟" in Chinese. Durations of a day or more use days
 * and hours to keep long weekend countdowns compact.
 */
function formatDuration(ms, locale) {
  const totalMinutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  if (totalMinutes >= 24 * 60) {
    const totalHours = Math.ceil(ms / HOUR_MS);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    if (isChineseLocale(locale)) {
      return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
    }
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (isChineseLocale(locale)) {
    return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Determines the current DeepSeek pricing state from the weekday peak
 * windows, evaluated in Beijing time regardless of the machine's time zone.
 *
 * Transition times are displayed in UTC for English and in Beijing time for
 * Chinese. The two state labels here deliberately mirror the l10n bundle —
 * this module stays free of any vscode dependency so it is unit-testable.
 *
 * @param {Date} [now]
 * @param {string} [locale] VS Code UI language, e.g. "en" or "zh-cn"
 */
function getDeepSeekPricingState(now = new Date(), locale = "en") {
  const offsetMs = getTimeZoneOffsetMs(now, BEIJING_TZ);
  // Beijing wall clock, read via the getUTC* accessors.
  const wall = new Date(now.getTime() + offsetMs);
  const msOfDay =
    wall.getUTCHours() * HOUR_MS +
    wall.getUTCMinutes() * MINUTE_MS +
    wall.getUTCSeconds() * 1000 +
    wall.getUTCMilliseconds();

  const wallWeekday = wall.getUTCDay();
  const isWeekday = wallWeekday >= 1 && wallWeekday <= 5;

  let isPeak = false;
  let nextTransitionType = null;
  let targetMsOfDay = null;
  let targetDayOffset = 0;

  if (isWeekday) {
    for (const window of DEEPSEEK_PEAK_WINDOWS_BEIJING) {
      const startMs = parseHmToMs(window.start);
      const endMs = parseHmToMs(window.end);
      if (msOfDay < startMs) {
        nextTransitionType = "peak-start";
        targetMsOfDay = startMs;
        break;
      }
      if (msOfDay < endMs) {
        isPeak = true;
        nextTransitionType = "peak-end";
        targetMsOfDay = endMs;
        break;
      }
    }
  }

  // On weekends, or after the final weekday window, find the next weekday's
  // first peak start. The loop is bounded because a weekday is at most three
  // calendar days away (Friday evening to Monday morning).
  if (targetMsOfDay === null) {
    nextTransitionType = "peak-start";
    targetMsOfDay = parseHmToMs(DEEPSEEK_PEAK_WINDOWS_BEIJING[0].start);
    for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
      const targetWeekday = (wallWeekday + dayOffset) % 7;
      if (targetWeekday >= 1 && targetWeekday <= 5) {
        targetDayOffset = dayOffset;
        break;
      }
    }
  }

  const nextTransitionAt = wallClockToInstant(wall, targetDayOffset, targetMsOfDay, offsetMs);

  const chinese = isChineseLocale(locale);
  const displayTimezone = chinese ? BEIJING_TZ : "UTC";
  const timeText = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(nextTransitionAt);

  return {
    isPeak,
    currentStateLabel: chinese
      ? isPeak
        ? "峰时价格"
        : "非峰时价格"
      : isPeak
        ? "Peak pricing"
        : "Off-peak pricing",
    nextTransitionAt,
    nextTransitionType,
    nextTransitionDayOffset: targetDayOffset,
    timeUntilTransitionMs: nextTransitionAt.getTime() - now.getTime(),
    currentPeakEndAt: isPeak ? nextTransitionAt : undefined,
    displayTimezone,
    displayTimeLabel: chinese ? `${timeText} 北京时间` : `${timeText} UTC`,
  };
}

module.exports = {
  DEEPSEEK_PEAK_WINDOWS_BEIJING,
  getDeepSeekPricingState,
  formatDuration,
  isChineseLocale,
};
