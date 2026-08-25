const https = require("https");
const vscode = require("vscode");

const {
  BalanceFetchError,
  activate,
  fetchBalance,
  getBalanceErrorPresentation,
  createSingleFlight,
  renderQuickPickItems,
  promptForApiKey,
  handleAction,
  getCurrencySymbol,
  findBalanceInfo,
  shouldWarn,
  getMandatoryFloor,
  classifyBalance,
  parseThresholdInput,
  estimateSpendRate,
} = require("../extension.js");

function mockHttpsRequest({
  statusCode = 200,
  body = "",
  requestError,
  responseError,
  timeout = false,
  defer = false,
  responses,
}) {
  const pendingResponses = [];
  const requests = [];
  let responseIndex = 0;

  const requestSpy = vi.spyOn(https, "request").mockImplementation((_options, callback) => {
    const responseOptions = {
      statusCode,
      body,
      requestError,
      responseError,
      timeout,
      ...(responses?.[responseIndex] || {}),
    };
    responseIndex += 1;

    const requestHandlers = {};
    const request = {
      on: vi.fn((event, handler) => {
        requestHandlers[event] = handler;
        return request;
      }),
      destroy: vi.fn((error) => {
        if (error) requestHandlers.error?.(error);
      }),
      end: vi.fn(() => {
        if (responseOptions.requestError) {
          requestHandlers.error?.(responseOptions.requestError);
          return;
        }
        if (responseOptions.timeout) {
          requestHandlers.timeout?.();
          return;
        }

        const responseHandlers = {};
        const response = {
          statusCode: responseOptions.statusCode,
          on: (event, handler) => {
            responseHandlers[event] = handler;
            return response;
          },
        };
        callback(response);

        const respond = () => {
          if (responseOptions.body) {
            responseHandlers.data?.(Buffer.from(responseOptions.body));
          }
          if (responseOptions.responseError) {
            responseHandlers.error?.(responseOptions.responseError);
            return;
          }
          responseHandlers.end?.();
        };

        if (defer) {
          pendingResponses.push(respond);
        } else {
          respond();
        }
      }),
    };
    requests.push(request);
    return request;
  });

  return {
    requests,
    requestSpy,
    get pendingCount() {
      return pendingResponses.length;
    },
    respondNext() {
      const respond = pendingResponses.shift();
      if (!respond) throw new Error("No deferred HTTPS response is pending");
      respond();
    },
  };
}

function makeBalanceBody(total, isAvailable = true) {
  return JSON.stringify({
    is_available: isAvailable,
    balance_infos: [
      {
        currency: "USD",
        total_balance: total,
        granted_balance: "0.00",
        topped_up_balance: total,
      },
    ],
  });
}

function createExtensionContext(initialApiKey) {
  let apiKey = initialApiKey;
  const state = new Map();
  const context = {
    secrets: {
      get: vi.fn(async () => apiKey),
      store: vi.fn(async (_key, value) => {
        apiKey = value;
      }),
      delete: vi.fn(async () => {
        apiKey = undefined;
      }),
    },
    globalState: {
      get: (key, fallback) => (state.has(key) ? state.get(key) : fallback),
      update: vi.fn(async (key, value) => {
        state.set(key, value);
      }),
    },
    subscriptions: [],
  };
  return { context, state, getApiKey: () => apiKey };
}

function activateForTest(context) {
  const statusBar = { show: vi.fn(), dispose: vi.fn() };
  vi.spyOn(vscode.window, "createStatusBarItem").mockReturnValue(statusBar);
  activate(context);
  return statusBar;
}

function disposeExtension(context) {
  for (const subscription of context.subscriptions) {
    subscription.dispose?.();
  }
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Condition was not reached after flushing promises");
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("fetchBalance — transport errors", () => {
  it("[DU-API-UNIT-005] sends the key securely and parses a successful response", async () => {
    const body = makeBalanceBody("12.34");
    const { requestSpy } = mockHttpsRequest({ body });

    await expect(fetchBalance("sk-test-secret")).resolves.toMatchObject({
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "12.34",
          granted_balance: "0.00",
          topped_up_balance: "12.34",
        },
      ],
    });

    expect(requestSpy).toHaveBeenCalledOnce();
    expect(requestSpy.mock.calls[0][0]).toMatchObject({
      hostname: "api.deepseek.com",
      path: "/user/balance",
      headers: { Authorization: "Bearer sk-test-secret" },
    });
  });

  it("[DU-API-UNIT-006] classifies rejected credentials", async () => {
    mockHttpsRequest({
      statusCode: 401,
      body: JSON.stringify({ error: { message: "Authentication failed" } }),
    });

    await expect(fetchBalance("bad-key")).rejects.toMatchObject({
      name: "BalanceFetchError",
      kind: "auth",
      statusCode: 401,
    });
  });

  it("[DU-API-UNIT-007] classifies rate limiting", async () => {
    mockHttpsRequest({ statusCode: 429, body: "Too many requests" });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "rate-limit",
      statusCode: 429,
    });
  });

  it("[DU-API-UNIT-008] classifies malformed successful responses", async () => {
    mockHttpsRequest({ body: "not-json" });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("[DU-API-UNIT-009] classifies request timeouts", async () => {
    mockHttpsRequest({ timeout: true });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({ kind: "timeout" });
  });

  it("[DU-API-UNIT-010] classifies network failures", async () => {
    mockHttpsRequest({ requestError: new Error("socket unavailable") });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({ kind: "network" });
  });

  it("[DU-API-UNIT-011] settles when the response stream aborts", async () => {
    mockHttpsRequest({
      body: '{"is_available":',
      responseError: new Error("aborted"),
    });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      name: "BalanceFetchError",
      kind: "network",
      message: "aborted",
    });
  });

  it("[DU-API-UNIT-012] rejects an empty successful payload", async () => {
    mockHttpsRequest({ body: "{}" });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "invalid-response",
      statusCode: 200,
    });
  });

  it("[DU-API-UNIT-013] rejects a null successful payload", async () => {
    mockHttpsRequest({ body: "null" });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "invalid-response",
      statusCode: 200,
    });
  });

  it("[DU-API-UNIT-014] accepts unavailable accounts with populated balance data", async () => {
    mockHttpsRequest({ body: makeBalanceBody("0.00", false) });

    await expect(fetchBalance("sk-test")).resolves.toMatchObject({
      is_available: false,
      balance_infos: [{ currency: "USD", total_balance: "0.00" }],
    });
  });

  it("[DU-API-UNIT-015] rejects an empty balance_infos array", async () => {
    mockHttpsRequest({
      body: JSON.stringify({ is_available: false, balance_infos: [] }),
    });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "invalid-response",
      statusCode: 200,
    });
  });

  it("[DU-API-UNIT-016] classifies insufficient balance", async () => {
    mockHttpsRequest({
      statusCode: 402,
      body: JSON.stringify({ error: { message: "Insufficient Balance" } }),
    });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "insufficient-balance",
      statusCode: 402,
    });
  });

  it("[DU-API-UNIT-017] classifies mocked HTTP 5xx responses as service failures", async () => {
    mockHttpsRequest({ statusCode: 503, body: "Service Unavailable" });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "service",
      statusCode: 503,
    });
  });

  // The status bar reads amounts with parseFloat and treats a missing
  // is_available as available, so validation must not reject payloads those
  // consumers already handle — otherwise a benign API change breaks every
  // refresh instead of degrading gracefully.
  it("[DU-API-UNIT-018] accepts numeric balance amounts", async () => {
    mockHttpsRequest({
      body: JSON.stringify({
        is_available: true,
        balance_infos: [
          { currency: "USD", total_balance: 12.5, granted_balance: 0, topped_up_balance: 12.5 },
        ],
      }),
    });

    await expect(fetchBalance("sk-test")).resolves.toMatchObject({
      balance_infos: [{ currency: "USD", total_balance: 12.5 }],
    });
  });

  it("[DU-API-UNIT-019] accepts a payload without is_available", async () => {
    mockHttpsRequest({
      body: JSON.stringify({
        balance_infos: [
          {
            currency: "USD",
            total_balance: "12.50",
            granted_balance: "0.00",
            topped_up_balance: "12.50",
          },
        ],
      }),
    });

    await expect(fetchBalance("sk-test")).resolves.toMatchObject({
      balance_infos: [{ currency: "USD", total_balance: "12.50" }],
    });
  });

  it("[DU-API-UNIT-020] accepts a payload without display-only amount fields", async () => {
    mockHttpsRequest({
      body: JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "12.50" }],
      }),
    });

    await expect(fetchBalance("sk-test")).resolves.toMatchObject({
      balance_infos: [{ currency: "USD", total_balance: "12.50" }],
    });
  });

  it("[DU-API-UNIT-021] still rejects a balance with an unreadable total", async () => {
    mockHttpsRequest({
      body: JSON.stringify({
        is_available: true,
        balance_infos: [{ currency: "USD", total_balance: "" }],
      }),
    });

    await expect(fetchBalance("sk-test")).rejects.toMatchObject({
      kind: "invalid-response",
      statusCode: 200,
    });
  });
});

describe("Balance errors — user-facing presentation", () => {
  it("[DU-ERR-UNIT-001] gives rejected credentials an actionable message", () => {
    const presentation = getBalanceErrorPresentation(
      new BalanceFetchError("auth", "server detail", 401),
    );

    expect(presentation.statusText).toContain("Invalid API key");
    expect(presentation.tooltip).toContain("Open options to change it");
    expect(presentation.popupDescription).toContain("change your DeepSeek API key");
    expect(JSON.stringify(presentation)).not.toContain("server detail");
  });

  it.each([
    ["rate-limit", "Rate limited"],
    ["timeout", "Timed out"],
    ["network", "Network error"],
    ["invalid-response", "Invalid response"],
    ["service", "Service error"],
  ])("[DU-ERR-UNIT-002] distinguishes %s failures", (kind, expected) => {
    const presentation = getBalanceErrorPresentation(
      new BalanceFetchError(kind, "internal detail", 500),
    );
    expect(presentation.statusText).toContain(expected);
  });

  it("[DU-ERR-UNIT-003] replaces the popup loading row with the failure", () => {
    const quickPick = { items: [] };
    const context = { globalState: { get: (_key, fallback) => fallback } };
    const presentation = getBalanceErrorPresentation(
      new BalanceFetchError("network", "internal detail"),
    );

    renderQuickPickItems(quickPick, context, null, presentation);

    expect(quickPick.items[0]).toMatchObject({
      label: expect.stringContaining("Could not reach DeepSeek"),
      description: expect.stringContaining("Check your connection"),
    });
    expect(quickPick.items.some((item) => item.label?.includes("Loading balance"))).toBe(false);
  });

  it("[DU-ERR-UNIT-004] points insufficient-balance failures at the Top Up affordance", () => {
    const presentation = getBalanceErrorPresentation(
      new BalanceFetchError("insufficient-balance", "server detail", 402),
    );

    expect(presentation.statusText).toContain("Insufficient balance");
    expect(presentation.tooltip).toContain("top up");
    expect(presentation.popupDescription).toContain("Top up");
    expect(JSON.stringify(presentation)).not.toContain("server detail");
  });

  it("[DU-ERR-UNIT-005] does not render stale balance figures beside an error", () => {
    const quickPick = { items: [] };
    const context = { globalState: { get: (_key, fallback) => fallback } };
    const staleBalance = JSON.parse(makeBalanceBody("99.00"));
    const presentation = getBalanceErrorPresentation(
      new BalanceFetchError("network", "internal detail"),
    );

    renderQuickPickItems(quickPick, context, staleBalance, presentation);

    expect(quickPick.items.some((item) => item.label?.includes("$99.00"))).toBe(false);
    expect(quickPick.items.some((item) => item.label?.includes("Loading balance"))).toBe(false);
  });
});

describe("Balance refresh — concurrent request guard", () => {
  it("[DU-REFRESH-UNIT-001] shares one in-flight operation and resets after completion", async () => {
    const resolvers = [];
    const task = vi.fn(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const singleFlight = createSingleFlight(task);

    const first = singleFlight("first");
    const second = singleFlight("second");
    await Promise.resolve();

    expect(task).toHaveBeenCalledOnce();
    expect(task).toHaveBeenCalledWith("first");
    resolvers[0]("shared");
    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);

    const third = singleFlight("third");
    await Promise.resolve();
    expect(task).toHaveBeenCalledTimes(2);
    resolvers[1]("fresh");
    await expect(third).resolves.toBe("fresh");
  });
});

describe("API key changes — request supersession", () => {
  it("[DU-KEY-UNIT-001] verifies a changed key with a fresh request and suppresses old-key state", async () => {
    const oldBody = makeBalanceBody("5.00");
    const newBody = makeBalanceBody("50.00");
    const httpsMock = mockHttpsRequest({
      defer: true,
      responses: [{ body: oldBody }, { body: newBody }],
    });
    const { context, state, getApiKey } = createExtensionContext("old-key");
    const statusBar = activateForTest(context);
    const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
    const warningSpy = vi
      .spyOn(vscode.window, "showWarningMessage")
      .mockReturnValue(Promise.resolve(undefined));
    vi.spyOn(vscode.window, "showInputBox").mockResolvedValue("new-key");

    try {
      await waitUntil(() => httpsMock.pendingCount === 1);
      const change = promptForApiKey(context);
      await waitUntil(() => getApiKey() === "new-key");

      httpsMock.respondNext();
      await waitUntil(() => httpsMock.pendingCount === 1);
      httpsMock.respondNext();
      await change;

      expect(httpsMock.requestSpy).toHaveBeenCalledTimes(2);
      expect(
        httpsMock.requestSpy.mock.calls.map(([options]) => options.headers.Authorization),
      ).toEqual(["Bearer old-key", "Bearer new-key"]);
      expect(statusBar.text).toContain("$50.00");
      expect(state.get("deepseek-balance-history").USD.map((sample) => sample.a)).toEqual([50]);
      expect(warningSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledOnce();
      expect(infoSpy).toHaveBeenCalledWith("DeepSeek API key saved.");
    } finally {
      disposeExtension(context);
    }
  });

  it("[DU-KEY-UNIT-002] clearing a key suppresses the old request and ends logged out", async () => {
    const httpsMock = mockHttpsRequest({ defer: true, body: makeBalanceBody("5.00") });
    const { context, state, getApiKey } = createExtensionContext("old-key");
    const statusBar = activateForTest(context);
    const warningSpy = vi
      .spyOn(vscode.window, "showWarningMessage")
      .mockReturnValue(Promise.resolve(undefined));

    try {
      await waitUntil(() => httpsMock.pendingCount === 1);
      const clear = handleAction(context, "clear");
      await waitUntil(() => getApiKey() === undefined);

      httpsMock.respondNext();
      await clear;

      expect(httpsMock.requestSpy).toHaveBeenCalledOnce();
      expect(statusBar.text).toContain("Not logged in");
      expect(state.has("deepseek-balance-history")).toBe(false);
      expect(warningSpy).not.toHaveBeenCalled();
    } finally {
      disposeExtension(context);
    }
  });

  it("[DU-KEY-UNIT-003] overlapping key changes verify and confirm only their own key", async () => {
    const httpsMock = mockHttpsRequest({
      defer: true,
      responses: [
        { body: makeBalanceBody("5.00") },
        { body: makeBalanceBody("10.00") },
        { statusCode: 401, body: JSON.stringify({ error: { message: "Authentication failed" } }) },
      ],
    });
    const { context, getApiKey } = createExtensionContext("old-key");
    const statusBar = activateForTest(context);
    const infoSpy = vi.spyOn(vscode.window, "showInformationMessage");
    vi.spyOn(vscode.window, "showWarningMessage").mockReturnValue(Promise.resolve(undefined));
    vi.spyOn(vscode.window, "showInputBox")
      .mockResolvedValueOnce("first-new-key")
      .mockResolvedValueOnce("second-new-key");

    try {
      await waitUntil(() => httpsMock.pendingCount === 1);
      const firstChange = promptForApiKey(context);
      const secondChange = promptForApiKey(context);
      await waitUntil(() => getApiKey() === "first-new-key");

      httpsMock.respondNext();
      await waitUntil(() => httpsMock.pendingCount === 1);
      httpsMock.respondNext();
      await waitUntil(() => getApiKey() === "second-new-key" && httpsMock.pendingCount === 1);
      httpsMock.respondNext();
      await Promise.all([firstChange, secondChange]);

      expect(
        httpsMock.requestSpy.mock.calls.map(([options]) => options.headers.Authorization),
      ).toEqual(["Bearer old-key", "Bearer first-new-key", "Bearer second-new-key"]);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith("DeepSeek API key saved.");
      expect(statusBar.text).toContain("Invalid API key");
    } finally {
      disposeExtension(context);
    }
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
