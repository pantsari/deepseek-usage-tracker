const {
  DEEPSEEK_PEAK_WINDOWS_BEIJING,
  getDeepSeekPricingState,
  formatDuration,
  isChineseLocale,
} = require("../pricing.js");

// Beijing time is UTC+8 year-round, so Beijing wall time hh:mm equals
// UTC hh-8:mm. July 6, 2026 is a Monday. All instants are constructed in UTC
// so results stay independent of the machine running the tests.
const utc = (h, m = 0, d = 6) => new Date(Date.UTC(2026, 6, d, h, m));

describe("getDeepSeekPricingState — weekday window detection", () => {
  it("[DU-PRICE-UNIT-001] is off-peak before Monday's first peak window", () => {
    const state = getDeepSeekPricingState(utc(0, 30)); // Monday 08:30 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionType).toBe("peak-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T01:00:00.000Z");
    expect(state.timeUntilTransitionMs).toBe(30 * 60 * 1000);
    expect(state.currentPeakEndAt).toBeUndefined();
  });

  it("[DU-PRICE-UNIT-002] is peak inside the Monday morning window", () => {
    const state = getDeepSeekPricingState(utc(2, 0)); // Monday 10:00 Beijing
    expect(state.isPeak).toBe(true);
    expect(state.nextTransitionType).toBe("peak-end");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T04:00:00.000Z");
    expect(state.currentPeakEndAt.toISOString()).toBe("2026-07-06T04:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-003] is off-peak between Monday's two windows", () => {
    const state = getDeepSeekPricingState(utc(5, 0)); // Monday 13:00 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionType).toBe("peak-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T06:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-004] is peak inside the Monday afternoon window", () => {
    const state = getDeepSeekPricingState(utc(8, 0)); // Monday 16:00 Beijing
    expect(state.isPeak).toBe(true);
    expect(state.nextTransitionType).toBe("peak-end");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-06T10:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-005] after Monday's final window targets Tuesday morning", () => {
    const state = getDeepSeekPricingState(utc(12, 0)); // Monday 20:00 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionType).toBe("peak-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-07T01:00:00.000Z");
    expect(state.nextTransitionDayOffset).toBe(1);
  });

  it("[DU-PRICE-UNIT-006] handles the Beijing date boundary", () => {
    // 23:00 UTC Jul 6 = 07:00 Beijing Jul 7.
    const state = getDeepSeekPricingState(utc(23, 0));
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-07T01:00:00.000Z");
    expect(state.timeUntilTransitionMs).toBe(2 * 60 * 60 * 1000);
  });

  it("[DU-PRICE-UNIT-007] treats window starts as peak and ends as off-peak", () => {
    expect(getDeepSeekPricingState(utc(1, 0)).isPeak).toBe(true); // 09:00 Beijing
    const atEnd = getDeepSeekPricingState(utc(4, 0)); // 12:00 Beijing
    expect(atEnd.isPeak).toBe(false);
    expect(atEnd.nextTransitionAt.toISOString()).toBe("2026-07-06T06:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-008] windows stay anchored to Beijing time in winter", () => {
    // Jan 5, 02:00 UTC = Monday 10:00 Beijing.
    const state = getDeepSeekPricingState(new Date(Date.UTC(2026, 0, 5, 2, 0)));
    expect(state.isPeak).toBe(true);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-01-05T04:00:00.000Z");
  });
});

describe("getDeepSeekPricingState — weekend pricing", () => {
  it("[DU-PRICE-UNIT-009] keeps Saturday entirely off-peak", () => {
    const state = getDeepSeekPricingState(utc(2, 0, 11)); // Saturday 10:00 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionType).toBe("peak-start");
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-13T01:00:00.000Z");
    expect(state.nextTransitionDayOffset).toBe(2);
  });

  it("[DU-PRICE-UNIT-010] keeps the August 23 effective-date Sunday off-peak", () => {
    const state = getDeepSeekPricingState(new Date(Date.UTC(2026, 7, 23, 8, 0)));
    // 08:00 UTC = Sunday 16:00 Beijing on the announced effective date.
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-08-24T01:00:00.000Z");
    expect(state.nextTransitionDayOffset).toBe(1);
  });

  it("[DU-PRICE-UNIT-011] uses the Beijing weekday at the UTC date boundary", () => {
    const state = getDeepSeekPricingState(utc(16, 30, 10)); // Saturday 00:30 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-13T01:00:00.000Z");
  });

  it("[DU-PRICE-UNIT-012] Friday peak end targets Monday and yields a 63-hour countdown", () => {
    const state = getDeepSeekPricingState(utc(10, 0, 10)); // Friday 18:00 Beijing
    expect(state.isPeak).toBe(false);
    expect(state.nextTransitionAt.toISOString()).toBe("2026-07-13T01:00:00.000Z");
    expect(state.nextTransitionDayOffset).toBe(3);
    expect(state.timeUntilTransitionMs).toBe(63 * 60 * 60 * 1000);
  });
});

describe("getDeepSeekPricingState — localized display", () => {
  it("[DU-PRICE-UNIT-013] English shows off-peak transitions in UTC", () => {
    const state = getDeepSeekPricingState(utc(0, 30), "en");
    expect(state.displayTimezone).toBe("UTC");
    expect(state.displayTimeLabel).toBe("01:00 UTC");
    expect(state.currentStateLabel).toBe("Off-peak pricing");
  });

  it("[DU-PRICE-UNIT-014] Chinese shows transitions in Beijing time", () => {
    const state = getDeepSeekPricingState(utc(0, 30), "zh-cn");
    expect(state.displayTimezone).toBe("Asia/Shanghai");
    expect(state.displayTimeLabel).toBe("09:00 北京时间");
    expect(state.currentStateLabel).toBe("非峰时价格");
  });

  it("[DU-PRICE-UNIT-015] Chinese uses the peak state label", () => {
    const state = getDeepSeekPricingState(utc(2, 0), "zh-cn");
    expect(state.currentStateLabel).toBe("峰时价格");
    expect(state.displayTimeLabel).toBe("12:00 北京时间");
  });
});

describe("formatDuration", () => {
  it("[DU-PRICE-UNIT-016] formats English durations below one day", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 14 * 60 * 1000, "en")).toBe("2h 14m");
    expect(formatDuration(37 * 60 * 1000, "en")).toBe("37m");
  });

  it("[DU-PRICE-UNIT-017] formats Chinese durations below one day", () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 14 * 60 * 1000, "zh-cn")).toBe("2小时14分钟");
    expect(formatDuration(37 * 60 * 1000, "zh-cn")).toBe("37分钟");
  });

  it("[DU-PRICE-UNIT-018] formats long weekend countdowns as days and hours", () => {
    expect(formatDuration(63 * 60 * 60 * 1000, "en")).toBe("2d 15h");
    expect(formatDuration(63 * 60 * 60 * 1000, "zh-cn")).toBe("2天15小时");
    expect(formatDuration(48 * 60 * 60 * 1000, "en")).toBe("2d");
  });

  it("[DU-PRICE-UNIT-019] rounds long durations up to the next hour", () => {
    expect(formatDuration(62 * 60 * 60 * 1000 + 59 * 60 * 1000 + 1000, "en")).toBe("2d 15h");
  });

  it("[DU-PRICE-UNIT-020] rounds short durations up to at least one minute", () => {
    expect(formatDuration(36 * 60 * 1000 + 1000, "en")).toBe("37m");
    expect(formatDuration(500, "en")).toBe("1m");
  });
});

describe("isChineseLocale", () => {
  it("[DU-PRICE-UNIT-021] matches zh variants only", () => {
    expect(isChineseLocale("zh-cn")).toBe(true);
    expect(isChineseLocale("zh-TW")).toBe(true);
    expect(isChineseLocale("en")).toBe(false);
    expect(isChineseLocale(undefined)).toBe(false);
  });
});

describe("peak window config", () => {
  it("[DU-PRICE-UNIT-022] keeps weekday windows ordered and non-overlapping", () => {
    const toMin = (hm) => {
      const [h, m] = hm.split(":").map(Number);
      return h * 60 + m;
    };
    let prevEnd = -1;
    for (const window of DEEPSEEK_PEAK_WINDOWS_BEIJING) {
      expect(toMin(window.start)).toBeGreaterThan(prevEnd);
      expect(toMin(window.end)).toBeGreaterThan(toMin(window.start));
      prevEnd = toMin(window.end);
    }
  });
});
