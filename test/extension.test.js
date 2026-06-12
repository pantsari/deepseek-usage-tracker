const {
  fetchBalance,
  getCurrencySymbol,
  findBalanceInfo,
  shouldWarn,
  getMandatoryFloor,
  classifyBalance,
  parseThresholdInput,
  estimateSpendRate,
} = require("../extension.js");

describe("fetchBalance — API parsing", () => {
  it("[DU-API-UNIT-001] parses successful balance response", () => {
    const result = {
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "25.13",
          granted_balance: "0.00",
          topped_up_balance: "25.13",
        },
      ],
    };

    expect(result.is_available).toBe(true);
    expect(result.balance_infos).toHaveLength(1);
    expect(result.balance_infos[0].currency).toBe("USD");
    expect(result.balance_infos[0].total_balance).toBe("25.13");
    expect(result.balance_infos[0].granted_balance).toBe("0.00");
    expect(result.balance_infos[0].topped_up_balance).toBe("25.13");
  });

  it("[DU-API-UNIT-002] handles unavailable balance", () => {
    const result = {
      is_available: false,
      balance_infos: [],
    };

    expect(result.is_available).toBe(false);
    expect(result.balance_infos).toHaveLength(0);
  });

  it("[DU-API-UNIT-003] handles CNY currency", () => {
    const info = {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    };

    expect(info.currency).toBe("CNY");
    expect(parseFloat(info.total_balance)).toBe(110);
  });

  it("[DU-API-UNIT-004] handles high-precision balance values", () => {
    const info = {
      currency: "USD",
      total_balance: "0.0042",
      granted_balance: "0.0001",
      topped_up_balance: "0.0041",
    };

    expect(parseFloat(info.total_balance).toFixed(2)).toBe("0.00");
    expect(parseFloat(info.total_balance).toFixed(4)).toBe("0.0042");
  });
});

describe("Status bar — text formatting", () => {
  it("[DU-SB-UNIT-001] formats balance text correctly", () => {
    const total = 25.13;
    const text = "$(graph) DeepSeek: $" + total.toFixed(2) + " left";

    expect(text).toBe("$(graph) DeepSeek: $25.13 left");
  });

  it("[DU-SB-UNIT-002] formats zero balance correctly", () => {
    const total = 0;
    const text = "$(graph) DeepSeek: $" + total.toFixed(2) + " left";

    expect(text).toBe("$(graph) DeepSeek: $0.00 left");
  });

  it("[DU-SB-UNIT-003] formats large balance correctly", () => {
    const total = 9999.999;
    const text = "$(graph) DeepSeek: $" + total.toFixed(2) + " left";

    expect(text).toBe("$(graph) DeepSeek: $10000.00 left");
  });
});

describe("Status bar — state transitions", () => {
  it("[DU-SB-UNIT-004] shows not-logged-in state with key icon", () => {
    const text = "$(key) DeepSeek: Not logged in";

    expect(text).toContain("Not logged in");
    expect(text).toContain("$(key)");
  });

  it("[DU-SB-UNIT-005] shows error state with error icon", () => {
    const text = "$(error) DeepSeek: Error";

    expect(text).toContain("Error");
    expect(text).toContain("$(error)");
  });

  it("[DU-SB-UNIT-006] shows unavailable state with warning icon", () => {
    const text = "$(warning) DeepSeek: Unavailable";

    expect(text).toContain("Unavailable");
    expect(text).toContain("$(warning)");
  });
});

describe("Extension — module exports", () => {
  it("[DU-SMOKE-001] exports activate, deactivate, and fetchBalance", () => {
    expect(typeof fetchBalance).toBe("function");
    expect(typeof require("../extension.js").deactivate).toBe("function");
    expect(typeof require("../extension.js").activate).toBe("function");
  });
});

describe("Currency — symbols", () => {
  it("[DU-CUR-UNIT-001] returns $ for USD", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
  });

  it("[DU-CUR-UNIT-002] returns ¥ for CNY", () => {
    expect(getCurrencySymbol("CNY")).toBe("¥");
  });

  it("[DU-CUR-UNIT-003] defaults to $ for unknown currency", () => {
    expect(getCurrencySymbol("EUR")).toBe("$");
  });
});

describe("Currency — findBalanceInfo", () => {
  const balance = {
    is_available: true,
    balance_infos: [
      {
        currency: "USD",
        total_balance: "50.00",
        granted_balance: "10.00",
        topped_up_balance: "40.00",
      },
      {
        currency: "CNY",
        total_balance: "350.00",
        granted_balance: "70.00",
        topped_up_balance: "280.00",
      },
    ],
  };

  it("[DU-CUR-UNIT-004] finds USD balance when preferred", () => {
    const info = findBalanceInfo(balance, "USD");
    expect(info.currency).toBe("USD");
    expect(info.total_balance).toBe("50.00");
  });

  it("[DU-CUR-UNIT-005] finds CNY balance when preferred", () => {
    const info = findBalanceInfo(balance, "CNY");
    expect(info.currency).toBe("CNY");
    expect(info.total_balance).toBe("350.00");
  });

  it("[DU-CUR-UNIT-006] falls back to first available when preferred not found", () => {
    const info = findBalanceInfo(balance, "EUR");
    expect(info.currency).toBe("USD");
  });

  it("[DU-CUR-UNIT-007] returns null for empty balance_infos", () => {
    expect(findBalanceInfo({ is_available: true, balance_infos: [] }, "USD")).toBeNull();
  });

  it("[DU-CUR-UNIT-008] returns null for null balance", () => {
    expect(findBalanceInfo(null, "USD")).toBeNull();
  });
});

describe("Warnings — shouldWarn", () => {
  it("[DU-WARN-UNIT-001] warns when balance below single threshold", () => {
    const result = shouldWarn(8.0, [10], []);
    expect(result).toEqual([10]);
  });

  it("[DU-WARN-UNIT-002] does not warn when balance above threshold", () => {
    const result = shouldWarn(15.0, [10], []);
    expect(result).toEqual([]);
  });

  it("[DU-WARN-UNIT-003] does not re-warn for already warned threshold", () => {
    const result = shouldWarn(8.0, [10], [10]);
    expect(result).toEqual([]);
  });

  it("[DU-WARN-UNIT-004] warns for multiple thresholds when balance is very low", () => {
    const result = shouldWarn(0.5, [10, 5, 1], []);
    expect(result).toEqual([10, 5, 1]);
  });

  it("[DU-WARN-UNIT-005] only warns for new thresholds, skips already warned", () => {
    const result = shouldWarn(0.5, [10, 5, 1], [10]);
    expect(result).toEqual([5, 1]);
  });

  it("[DU-WARN-UNIT-006] does not warn when balance equals threshold exactly", () => {
    const result = shouldWarn(10.0, [10], []);
    expect(result).toEqual([]);
  });

  it("[DU-WARN-UNIT-007] returns empty array for empty thresholds", () => {
    const result = shouldWarn(5.0, [], []);
    expect(result).toEqual([]);
  });

  it("[DU-WARN-UNIT-008] warns for unwarned thresholds below balance", () => {
    const result = shouldWarn(0.5, [10, 5, 1], [5]);
    expect(result).toEqual([10, 1]);
  });
});

describe("Warnings — getMandatoryFloor", () => {
  it("[DU-FLOOR-UNIT-001] returns 1 for USD", () => {
    expect(getMandatoryFloor("USD")).toBe(1);
  });

  it("[DU-FLOOR-UNIT-002] returns 7 for CNY", () => {
    expect(getMandatoryFloor("CNY")).toBe(7);
  });

  it("[DU-FLOOR-UNIT-003] falls back to USD floor for unknown currency", () => {
    expect(getMandatoryFloor("EUR")).toBe(1);
  });
});

describe("Warnings — classifyBalance", () => {
  it("[DU-SEV-UNIT-001] returns ok when balance is healthy", () => {
    expect(classifyBalance(50, "USD", [10, 5, 1], true)).toBe("ok");
  });

  it("[DU-SEV-UNIT-002] returns warning below a configured threshold", () => {
    expect(classifyBalance(8, "USD", [10, 5, 1], true)).toBe("warning");
  });

  it("[DU-SEV-UNIT-003] returns critical below the mandatory USD floor", () => {
    expect(classifyBalance(0.5, "USD", [10, 5, 1], true)).toBe("critical");
  });

  it("[DU-SEV-UNIT-004] returns critical below the mandatory CNY floor", () => {
    expect(classifyBalance(6.5, "CNY", [], true)).toBe("critical");
  });

  it("[DU-SEV-UNIT-005] returns depleted at zero balance", () => {
    expect(classifyBalance(0, "USD", [10, 5, 1], true)).toBe("depleted");
  });

  it("[DU-SEV-UNIT-006] returns depleted when API reports unavailable", () => {
    expect(classifyBalance(5, "USD", [10, 5, 1], false)).toBe("depleted");
  });

  it("[DU-SEV-UNIT-007] critical floor applies even with all thresholds disabled", () => {
    expect(classifyBalance(0.5, "USD", [], true)).toBe("critical");
  });

  it("[DU-SEV-UNIT-008] balance exactly at floor is not critical", () => {
    expect(classifyBalance(1, "USD", [], true)).toBe("ok");
  });
});

describe("Thresholds — parseThresholdInput", () => {
  it("[DU-PARSE-UNIT-001] parses comma-separated values sorted descending", () => {
    expect(parseThresholdInput("5, 15, 2.50")).toEqual([15, 5, 2.5]);
  });

  it("[DU-PARSE-UNIT-002] deduplicates repeated values", () => {
    expect(parseThresholdInput("10, 10, 5")).toEqual([10, 5]);
  });

  it("[DU-PARSE-UNIT-003] rejects non-numeric input", () => {
    expect(parseThresholdInput("10, abc")).toBeNull();
  });

  it("[DU-PARSE-UNIT-004] rejects zero and negative values", () => {
    expect(parseThresholdInput("10, 0")).toBeNull();
    expect(parseThresholdInput("-5")).toBeNull();
  });

  it("[DU-PARSE-UNIT-005] rejects empty and undefined input", () => {
    expect(parseThresholdInput("")).toBeNull();
    expect(parseThresholdInput("   ")).toBeNull();
    expect(parseThresholdInput(undefined)).toBeNull();
  });

  it("[DU-PARSE-UNIT-006] tolerates trailing commas and extra whitespace", () => {
    expect(parseThresholdInput(" 20 , 1 , ")).toEqual([20, 1]);
  });
});

describe("Spend rate — estimateSpendRate", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("[DU-RATE-UNIT-001] returns null with fewer than two samples", () => {
    expect(estimateSpendRate([])).toBeNull();
    expect(estimateSpendRate([{ t: 0, a: 10 }])).toBeNull();
    expect(estimateSpendRate(undefined)).toBeNull();
  });

  it("[DU-RATE-UNIT-002] returns null when the observation window is too short", () => {
    const samples = [
      { t: 0, a: 10 },
      { t: 5 * 60 * 1000, a: 9 },
    ];
    expect(estimateSpendRate(samples)).toBeNull();
  });

  it("[DU-RATE-UNIT-003] computes daily spend and days left over one day", () => {
    const samples = [
      { t: 0, a: 10 },
      { t: DAY, a: 8 },
    ];
    const rate = estimateSpendRate(samples);
    expect(rate.perDay).toBeCloseTo(2);
    expect(rate.daysLeft).toBeCloseTo(4);
  });

  it("[DU-RATE-UNIT-004] excludes top-ups from the spend total", () => {
    const samples = [
      { t: 0, a: 10 },
      { t: DAY / 2, a: 8 },
      { t: DAY, a: 20 },
    ];
    const rate = estimateSpendRate(samples);
    expect(rate.perDay).toBeCloseTo(2);
    expect(rate.daysLeft).toBeCloseTo(10);
  });

  it("[DU-RATE-UNIT-005] returns null when there is no spending", () => {
    const flat = [
      { t: 0, a: 10 },
      { t: DAY, a: 10 },
    ];
    const onlyTopUps = [
      { t: 0, a: 10 },
      { t: DAY, a: 30 },
    ];
    expect(estimateSpendRate(flat)).toBeNull();
    expect(estimateSpendRate(onlyTopUps)).toBeNull();
  });

  it("[DU-RATE-UNIT-006] sorts unordered samples before computing", () => {
    const samples = [
      { t: DAY, a: 8 },
      { t: 0, a: 10 },
    ];
    const rate = estimateSpendRate(samples);
    expect(rate.perDay).toBeCloseTo(2);
  });
});
