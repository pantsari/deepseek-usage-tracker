// DeepSeek V4 surge-pricing windows, defined in Shanghai wall-clock time.
// There is no official pricing API — these windows are maintained by hand.
const DEEPSEEK_SURGE_WINDOWS_SHANGHAI = [
  { start: "09:00", end: "12:00" },
  { start: "14:00", end: "18:00" },
];

const SHANGHAI_TZ = "Asia/Shanghai";

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
 * Converts a Shanghai wall-clock target (day offset from `wall`'s date plus
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
  instantMs = wallMidnightUtc + msOfDay - getTimeZoneOffsetMs(new Date(instantMs), SHANGHAI_TZ);
  return new Date(instantMs);
}

/**
 * Formats a duration for countdown display: "2h 14m" / "37m" in English,
 * "2小时14分钟" / "37分钟" in Chinese. Rounds up so the countdown never
 * promises more time than is actually left.
 */
function formatDuration(ms, locale) {
  const totalMinutes = Math.max(1, Math.ceil(ms / MINUTE_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (isChineseLocale(locale)) {
    return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Determines the current DeepSeek pricing state from the surge windows,
 * evaluated in Shanghai time regardless of the machine's time zone.
 *
 * Transition times are displayed in UTC for English and in Shanghai time for
 * Chinese. The two state labels here deliberately mirror the l10n bundle —
 * this module stays free of any vscode dependency so it is unit-testable.
 *
 * @param {Date} [now]
 * @param {string} [locale] VS Code UI language, e.g. "en" or "zh-cn"
 */
function getDeepSeekPricingState(now = new Date(), locale = "en") {
  const offsetMs = getTimeZoneOffsetMs(now, SHANGHAI_TZ);
  // Shanghai wall clock, read via the getUTC* accessors.
  const wall = new Date(now.getTime() + offsetMs);
  const msOfDay =
    wall.getUTCHours() * HOUR_MS +
    wall.getUTCMinutes() * MINUTE_MS +
    wall.getUTCSeconds() * 1000 +
    wall.getUTCMilliseconds();

  let isSurge = false;
  let nextTransitionType = null;
  let targetMsOfDay = null;
  let targetDayOffset = 0;

  for (const window of DEEPSEEK_SURGE_WINDOWS_SHANGHAI) {
    const startMs = parseHmToMs(window.start);
    const endMs = parseHmToMs(window.end);
    if (msOfDay < startMs) {
      nextTransitionType = "surge-start";
      targetMsOfDay = startMs;
      break;
    }
    if (msOfDay < endMs) {
      isSurge = true;
      nextTransitionType = "surge-end";
      targetMsOfDay = endMs;
      break;
    }
  }

  // Past the last window: the next transition is tomorrow's first surge start.
  if (targetMsOfDay === null) {
    nextTransitionType = "surge-start";
    targetMsOfDay = parseHmToMs(DEEPSEEK_SURGE_WINDOWS_SHANGHAI[0].start);
    targetDayOffset = 1;
  }

  const nextTransitionAt = wallClockToInstant(wall, targetDayOffset, targetMsOfDay, offsetMs);

  const chinese = isChineseLocale(locale);
  const displayTimezone = chinese ? SHANGHAI_TZ : "UTC";
  const timeText = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(nextTransitionAt);

  return {
    isSurge,
    currentStateLabel: chinese
      ? isSurge
        ? "高峰价格"
        : "普通价格"
      : isSurge
        ? "Surge pricing"
        : "Normal pricing",
    nextTransitionAt,
    nextTransitionType,
    timeUntilTransitionMs: nextTransitionAt.getTime() - now.getTime(),
    currentWindowEndAt: isSurge ? nextTransitionAt : undefined,
    displayTimezone,
    displayTimeLabel: chinese ? `${timeText} 上海时间` : `${timeText} UTC`,
  };
}

module.exports = {
  DEEPSEEK_SURGE_WINDOWS_SHANGHAI,
  getDeepSeekPricingState,
  formatDuration,
  isChineseLocale,
};
