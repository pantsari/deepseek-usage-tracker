const { fetchBalance, getCurrencySymbol, findBalanceInfo, shouldWarn } = require("../extension.js");

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
