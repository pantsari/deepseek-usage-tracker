const {
  DEEPSEEK_SURGE_WINDOWS_SHANGHAI,
  getDeepSeekPricingState,
  formatDuration,
  isChineseLocale,
} = require("../pricing.js");

// Asia/Shanghai is UTC+8 year-round, so Shanghai wall time hh:mm equals
// UTC hh-8:mm. All instants below are constructed in UTC to stay independent
// of the machine running the tests.
const utc = (h, m = 0, d = 5) => new Date(Date.UTC(2026, 6, d, h, m));

describe("getDeepSeekPricingState — window detection", () => {
  it("[DU-PRICE-UNIT-001] is normal before the first surge window", () => {
    const state = getDeepSeekPricingState(utc(0, 30)); // 08:30 Shanghai
    expect(state.isSurge).toBe(false);
    expect(state.nextTransitionType).toBe("surge-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-05T01:00:00.000Z"); // 09:00 SH
    expect(state.timeUntilTransitionMs).toBe(30 * 60 * 1000);
    expect(state.currentWindowEndAt).toBeUndefined();
  });

  it("[DU-PRICE-UNIT-002] is surge inside the morning window", () => {
    const state = getDeepSeekPricingState(utc(2, 0)); // 10:00 Shanghai
    expect(state.isSurge).toBe(true);
    expect(state.nextTransitionType).toBe("surge-end");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-05T04:00:00.000Z"); // 12:00 SH
    expect(state.currentWindowEndAt.toISOString()).toBe("2026-07-05T04:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-003] is normal between the two windows", () => {
    const state = getDeepSeekPricingState(utc(5, 0)); // 13:00 Shanghai
    expect(state.isSurge).toBe(false);
    expect(state.nextTransitionType).toBe("surge-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-05T06:00:00.000Z"); // 14:00 SH
  });

  it("[DU-PRICE-UNIT-004] is surge inside the afternoon window", () => {
    const state = getDeepSeekPricingState(utc(8, 0)); // 16:00 Shanghai
    expect(state.isSurge).toBe(true);
    expect(state.nextTransitionType).toBe("surge-end");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-05T10:00:00.000Z"); // 18:00 SH
  });

  it("[DU-PRICE-UNIT-005] after the last window the next surge is tomorrow morning", () => {
    const state = getDeepSeekPricingState(utc(12, 0)); // 20:00 Shanghai
    expect(state.isSurge).toBe(false);
    expect(state.nextTransitionType).toBe("surge-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T01:00:00.000Z"); // 09:00 SH next day
  });

  it("[DU-PRICE-UNIT-006] handles the date boundary when Shanghai is already tomorrow", () => {
    // 23:00 UTC Jul 5 = 07:00 Shanghai Jul 6 — before that day's first window.
    const state = getDeepSeekPricingState(utc(23, 0));
    expect(state.isSurge).toBe(false);
    expect(state.nextTransitionType).toBe("surge-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T01:00:00.000Z");
    expect(state.timeUntilTransitionMs).toBe(2 * 60 * 60 * 1000);
  });

  it("[DU-PRICE-UNIT-007] treats window start as surge and window end as normal", () => {
    expect(getDeepSeekPricingState(utc(1, 0)).isSurge).toBe(true); // exactly 09:00 SH
    const atEnd = getDeepSeekPricingState(utc(4, 0)); // exactly 12:00 SH
    expect(atEnd.isSurge).toBe(false);
    expect(atEnd.nextTransitionAt.toISOString()).toBe("2026-07-05T06:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-008] windows stay anchored to Shanghai in northern winter too", () => {
    // Jan 5, 02:00 UTC = 10:00 Shanghai. If the machine's own DST rules
    // leaked in, summer and winter results would differ.
    const state = getDeepSeekPricingState(new Date(Date.UTC(2026, 0, 5, 2, 0)));
    expect(state.isSurge).toBe(true);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-01-05T04:00:00.000Z");
  });
});

describe("getDeepSeekPricingState — localized display", () => {
  it("[DU-PRICE-UNIT-009] English shows transition times in UTC", () => {
    const state = getDeepSeekPricingState(utc(0, 30), "en");
    expect(state.displayTimezone).toBe("UTC");
    expect(state.displayTimeLabel).toBe("01:00 UTC");
    expect(state.currentStateLabel).toBe("Normal pricing");
  });

  it("[DU-PRICE-UNIT-010] Chinese shows transition times in Shanghai time", () => {
    const state = getDeepSeekPricingState(utc(0, 30), "zh-cn");
    expect(state.displayTimezone).toBe("Asia/Shanghai");
    expect(state.displayTimeLabel).toBe("09:00 上海时间");
    expect(state.currentStateLabel).toBe("普通价格");
  });

  it("[DU-PRICE-UNIT-011] Chinese surge state labels", () => {
    const state = getDeepSeekPricingState(utc(2, 0), "zh-cn");
    expect(state.currentStateLabel).toBe("高峰价格");
    expect(state.displayTimeLabel).toBe("12:00 上海时间");
  });
});

describe("formatDuration", () => {
  it("[DU-PRICE-UNIT-012] formats English durations", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 14 * 60 * 1000, "en")).toBe("2h 14m");
    expect(formatDuration(37 * 60 * 1000, "en")).toBe("37m");
  });

  it("[DU-PRICE-UNIT-013] formats Chinese durations", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 14 * 60 * 1000, "zh-cn")).toBe("2小时14分钟");
    expect(formatDuration(37 * 60 * 1000, "zh-cn")).toBe("37分钟");
  });

  it("[DU-PRICE-UNIT-014] rounds up and never shows less than a minute", () => {
    expect(formatDuration(36 * 60 * 1000 + 1000, "en")).toBe("37m");
    expect(formatDuration(500, "en")).toBe("1m");
  });
});

describe("isChineseLocale", () => {
  it("[DU-PRICE-UNIT-015] matches zh variants only", () => {
    expect(isChineseLocale("zh-cn")).toBe(true);
    expect(isChineseLocale("zh-TW")).toBe(true);
    expect(isChineseLocale("en")).toBe(false);
    expect(isChineseLocale(undefined)).toBe(false);
  });
});

describe("surge window config", () => {
  it("[DU-PRICE-UNIT-016] windows are ordered and non-overlapping", () => {
    const toMin = (hm) => {
      const [h, m] = hm.split(":").map(Number);
      return h * 60 + m;
    };
    let prevEnd = -1;
    for (const w of DEEPSEEK_SURGE_WINDOWS_SHANGHAI) {
      expect(toMin(w.start)).toBeGreaterThan(prevEnd);
      expect(toMin(w.end)).toBeGreaterThan(toMin(w.start));
      prevEnd = toMin(w.end);
    }
  });
});
