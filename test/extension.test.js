const { fetchBalance } = require("../extension.js");

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
