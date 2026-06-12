const vscode = require("vscode");
const https = require("https");

const SECRET_KEY_ID = "deepseek-api-key";
const CURRENCY_STATE_KEY = "deepseek-currency";
const WARNED_STATE_KEY = "deepseek-warned-thresholds";
const HISTORY_STATE_KEY = "deepseek-balance-history";
const HOST = "api.deepseek.com";
const DEFAULT_REFRESH_MINUTES = 5;
const DASHBOARD_URL = "https://platform.deepseek.com/usage";
const TOP_UP_URL = "https://platform.deepseek.com/top_up";

// Mandatory low-credit floor per currency. The alert for crossing this level
// cannot be disabled, so the user never silently runs out of credits.
const MANDATORY_FLOOR = { USD: 1, CNY: 7 };
// Non-numeric markers stored alongside warned thresholds in globalState.
const FLOOR_MARK = "floor";
const DEPLETED_MARK = "depleted";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_MAX_AGE_MS = 14 * DAY_MS;
const HISTORY_MAX_SAMPLES = 500;
// Below this observation window a spend estimate would be mostly noise.
const MIN_ESTIMATE_SPAN_MS = 30 * 60 * 1000;

let updatingBalance = false;
let statusBar;
let lastBalance = null;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "deepseek-usage.click";
  statusBar.show();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("deepseek-usage.click", async () => {
      const apiKey = await context.secrets.get(SECRET_KEY_ID);
      if (!apiKey) {
        await promptForApiKey(context);
        return;
      }
      await showBalancePopUp(context);
    }),
    vscode.commands.registerCommand("deepseek-usage.refresh", () => updateStatusBar(context)),
    vscode.commands.registerCommand("deepseek-usage.setApiKey", () => promptForApiKey(context)),
    vscode.commands.registerCommand("deepseek-usage.configureWarnings", () =>
      showThresholdConfig(context),
    ),
  );

  updateStatusBar(context);
  let timer = setInterval(() => updateStatusBar(context), getRefreshIntervalMs());
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration("deepseek-usage.refreshIntervalMinutes")) {
        clearInterval(timer);
        timer = setInterval(() => updateStatusBar(context), getRefreshIntervalMs());
      }
      if (event.affectsConfiguration("deepseek-usage.warningThresholds")) {
        await resetWarnedNumericThresholds(context);
        updateStatusBar(context);
      }
    }),
  );
}

function getRefreshIntervalMs() {
  const config = vscode.workspace.getConfiguration("deepseek-usage");
  const minutes = config.get("refreshIntervalMinutes", DEFAULT_REFRESH_MINUTES);
  const clamped = Number.isFinite(minutes)
    ? Math.min(Math.max(minutes, 1), 120)
    : DEFAULT_REFRESH_MINUTES;
  return clamped * 60 * 1000;
}

function getCurrencySymbol(currency) {
  switch (currency) {
    case "CNY":
      return "¥";
    case "USD":
    default:
      return "$";
  }
}

function getPreferredCurrency(context) {
  return context.globalState.get(CURRENCY_STATE_KEY, "USD");
}

async function setPreferredCurrency(context, currency) {
  await context.globalState.update(CURRENCY_STATE_KEY, currency);
  // Threshold numbers and the mandatory floor are interpreted in the active
  // currency, so re-arm all warnings when it changes.
  await clearWarnedThresholds(context);
}

function findBalanceInfo(balance, preferredCurrency) {
  if (!balance || !balance.balance_infos || balance.balance_infos.length === 0) return null;
  const match = balance.balance_infos.find((info) => info.currency === preferredCurrency);
  return match || balance.balance_infos[0];
}

function getWarningThresholds() {
  const config = vscode.workspace.getConfiguration("deepseek-usage");
  return config.get("warningThresholds", [10, 5, 1]);
}

function getWarnedThresholds(context) {
  return context.globalState.get(WARNED_STATE_KEY, []);
}

async function setWarnedThresholds(context, thresholds) {
  await context.globalState.update(WARNED_STATE_KEY, thresholds);
}

async function clearWarnedThresholds(context) {
  await context.globalState.update(WARNED_STATE_KEY, []);
}

// Re-arm the user-configured thresholds after they change, but keep the
// mandatory floor/depleted marks so editing settings does not re-fire modals.
async function resetWarnedNumericThresholds(context) {
  const warned = getWarnedThresholds(context);
  await setWarnedThresholds(
    context,
    warned.filter((w) => typeof w === "string"),
  );
}

function getMandatoryFloor(currency) {
  return MANDATORY_FLOOR[currency] !== undefined ? MANDATORY_FLOOR[currency] : MANDATORY_FLOOR.USD;
}

/**
 * Parses comma-separated threshold input like "15, 7.50, 2".
 * Returns a deduplicated, descending array of positive numbers, or null if invalid.
 */
function parseThresholdInput(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const values = parts.map((p) => Number(p));
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return [...new Set(values)].sort((a, b) => b - a);
}

/**
 * Classifies a balance into a severity level.
 * "depleted"  — no usable credits (zero balance or API reports unavailable)
 * "critical"  — below the mandatory floor ($1 / ¥7)
 * "warning"   — below a user-configured threshold
 * "ok"        — none of the above
 */
function classifyBalance(amount, currency, thresholds, isAvailable) {
  if (!isAvailable || amount <= 0) return "depleted";
  if (amount < getMandatoryFloor(currency)) return "critical";
  if (thresholds.some((t) => amount < t)) return "warning";
  return "ok";
}

/**
 * Appends a balance sample to the per-currency history in globalState,
 * pruning entries older than 14 days. Returns the updated sample list.
 */
async function recordBalanceSample(context, currency, amount) {
  const history = context.globalState.get(HISTORY_STATE_KEY, {});
  const samples = Array.isArray(history[currency]) ? history[currency] : [];
  const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
  const pruned = samples.filter((s) => s.t >= cutoff);
  pruned.push({ t: Date.now(), a: amount });
  history[currency] = pruned.slice(-HISTORY_MAX_SAMPLES);
  await context.globalState.update(HISTORY_STATE_KEY, history);
  return history[currency];
}

/**
 * Estimates daily spend from balance samples ({t: epoch ms, a: amount}).
 * Balance increases (top-ups) are excluded from the spend total, so the rate
 * reflects consumption only. Returns { perDay, daysLeft } or null when there
 * is not enough data for a meaningful estimate.
 */
function estimateSpendRate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const sorted = [...samples].sort((x, y) => x.t - y.t);
  const spanMs = sorted[sorted.length - 1].t - sorted[0].t;
  if (spanMs < MIN_ESTIMATE_SPAN_MS) return null;
  let spent = 0;
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i - 1].a - sorted[i].a;
    if (delta > 0) spent += delta;
  }
  if (spent <= 0) return null;
  const perDay = spent / (spanMs / DAY_MS);
  return { perDay, daysLeft: sorted[sorted.length - 1].a / perDay };
}

async function showThresholdConfig(context) {
  const current = getWarningThresholds();
  const currency = getPreferredCurrency(context);
  const symbol = getCurrencySymbol(currency);
  const floor = getMandatoryFloor(currency);
  const presetValues = currency === "CNY" ? [150, 75, 35, 7] : [20, 10, 5, 1];
  const values = [...new Set([...presetValues, ...current])].sort((a, b) => b - a);

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = vscode.l10n.t(
    "Warning Thresholds ({0}) — alert below {1} is always on",
    currency,
    symbol + floor.toFixed(2),
  );
  quickPick.canPickMany = true;
  quickPick.placeholder = vscode.l10n.t(
    "Check the balance levels that should warn you, then press Enter",
  );

  quickPick.items = values.map((val) => ({
    label: `${symbol}${val.toFixed(2)}`,
    description:
      (presetValues.includes(val) ? "" : vscode.l10n.t("(custom)") + " ") +
      vscode.l10n.t("Warn when balance drops below {0}", symbol + val.toFixed(2)),
    picked: current.includes(val),
    value: val,
  }));
  quickPick.selectedItems = quickPick.items.filter((item) => item.picked);

  const customButton = {
    iconPath: new vscode.ThemeIcon("edit"),
    tooltip: vscode.l10n.t("Enter Custom Values"),
  };
  const disableButton = {
    iconPath: new vscode.ThemeIcon("close-all"),
    tooltip: vscode.l10n.t("Disable All Warnings"),
  };
  quickPick.buttons = [customButton, disableButton];

  const saveThresholds = async (selected) => {
    const config = vscode.workspace.getConfiguration("deepseek-usage");
    await config.update(
      "warningThresholds",
      [...selected].sort((a, b) => b - a),
      vscode.ConfigurationTarget.Global,
    );
    await resetWarnedNumericThresholds(context);
    vscode.window.showInformationMessage(
      selected.length > 0
        ? vscode.l10n.t(
            "Low-balance warnings set: {0}",
            selected.map((v) => symbol + v.toFixed(2)).join(", "),
          )
        : vscode.l10n.t(
            "Optional warnings disabled. The mandatory alert below {0} stays on.",
            symbol + floor.toFixed(2),
          ),
    );
  };

  const done = new Promise((resolve) => {
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems.map((item) => item.value);
      quickPick.hide();
      await saveThresholds(selected);
      resolve();
    });

    quickPick.onDidTriggerButton(async (button) => {
      if (button === disableButton) {
        quickPick.hide();
        await saveThresholds([]);
        resolve();
      } else if (button === customButton) {
        quickPick.hide();
        const input = await vscode.window.showInputBox({
          title: vscode.l10n.t("Custom Warning Thresholds ({0})", currency),
          prompt: vscode.l10n.t("Comma-separated balance amounts, e.g. 15, 7.50, 2"),
          value: current.join(", "),
          ignoreFocusOut: true,
          validateInput: (value) =>
            parseThresholdInput(value)
              ? null
              : vscode.l10n.t("Enter positive numbers separated by commas"),
        });
        const parsed = parseThresholdInput(input);
        if (parsed) {
          await saveThresholds(parsed);
        }
        resolve();
      }
    });

    quickPick.onDidHide(() => resolve());
  });

  quickPick.show();
  return done;
}

function shouldWarn(balanceAmount, thresholds, warnedThresholds) {
  return thresholds.filter((t) => balanceAmount < t && !warnedThresholds.includes(t));
}

function showCriticalAlert(message) {
  const topUp = vscode.l10n.t("Top Up");
  // Modal so it cannot scroll by unnoticed in the notification toasts.
  vscode.window.showWarningMessage(message, { modal: true }, topUp).then((result) => {
    if (result === topUp) {
      vscode.env.openExternal(vscode.Uri.parse(TOP_UP_URL));
    }
  });
}

function showLowBalanceAlert(context, message) {
  const topUp = vscode.l10n.t("Top Up");
  const configure = vscode.l10n.t("Configure Thresholds");
  vscode.window.showWarningMessage(message, topUp, configure).then(async (result) => {
    if (result === topUp) {
      vscode.env.openExternal(vscode.Uri.parse(TOP_UP_URL));
    } else if (result === configure) {
      await showThresholdConfig(context);
    }
  });
}

/**
 * Fires low-balance alerts and returns the severity for status bar styling.
 * Each level alerts once per crossing and re-arms when the balance recovers
 * above it. State is persisted before any notification is shown, so a window
 * reload or overlapping refresh can neither drop nor duplicate an alert.
 */
async function checkBalanceWarnings(context, amount, currency, isAvailable) {
  const symbol = getCurrencySymbol(currency);
  const floor = getMandatoryFloor(currency);
  const thresholds = getWarningThresholds();
  const severity = classifyBalance(amount, currency, thresholds, isAvailable);
  const depleted = severity === "depleted";
  const critical = depleted || severity === "critical";

  const warned = getWarnedThresholds(context);
  const newThresholds = shouldWarn(amount, thresholds, warned);
  const newFloor = critical && !warned.includes(FLOOR_MARK);
  const newDepleted = depleted && !warned.includes(DEPLETED_MARK);

  const crossed = thresholds.filter((t) => amount < t);
  if (critical) crossed.push(FLOOR_MARK);
  if (depleted) crossed.push(DEPLETED_MARK);
  await setWarnedThresholds(context, crossed);

  if (newDepleted) {
    showCriticalAlert(
      vscode.l10n.t(
        "You have no usable DeepSeek credits left ({0}). API calls will fail until you top up.",
        symbol + amount.toFixed(2),
      ),
    );
  } else if (newFloor) {
    showCriticalAlert(
      vscode.l10n.t(
        "DeepSeek balance is critically low: {0} remaining (below {1}).",
        symbol + amount.toFixed(2),
        symbol + floor.toFixed(2),
      ),
    );
  } else if (newThresholds.length > 0) {
    const lowest = Math.min(...newThresholds);
    showLowBalanceAlert(
      context,
      vscode.l10n.t(
        "DeepSeek balance is below {0} ({1} remaining).",
        symbol + lowest.toFixed(2),
        symbol + amount.toFixed(2),
      ),
    );
  }

  return severity;
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function promptForApiKey(context) {
  const apiKey = await vscode.window.showInputBox({
    title: vscode.l10n.t("DeepSeek API Key"),
    prompt: vscode.l10n.t("Enter your DeepSeek API Key (get it from platform.deepseek.com)"),
    password: true,
    placeHolder: "sk-...",
    ignoreFocusOut: true,
    validateInput: (value) =>
      value && value.trim() ? null : vscode.l10n.t("API Key cannot be empty"),
  });

  if (!apiKey) return;

  await context.secrets.store(SECRET_KEY_ID, apiKey.trim());
  await updateStatusBar(context);
  vscode.window.showInformationMessage(vscode.l10n.t("DeepSeek API key saved."));
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function updateStatusBar(context) {
  if (updatingBalance) return;
  updatingBalance = true;
  try {
    const apiKey = await context.secrets.get(SECRET_KEY_ID);

    if (!apiKey) {
      statusBar.text = "$(key) " + vscode.l10n.t("DeepSeek: Not logged in");
      statusBar.tooltip = vscode.l10n.t("Click to enter your DeepSeek API key");
      statusBar.backgroundColor = undefined;
      lastBalance = null;
      return;
    }

    const balance = await fetchBalance(apiKey);
    lastBalance = balance;

    // is_available flips to false when credits run out, but balance_infos is
    // still returned — keep showing numbers and let the warning logic fire.
    if (balance.balance_infos && balance.balance_infos.length > 0) {
      const currency = getPreferredCurrency(context);
      const info = findBalanceInfo(balance, currency);
      const total = info ? parseFloat(info.total_balance) : NaN;

      if (info && Number.isFinite(total)) {
        const symbol = getCurrencySymbol(info.currency);
        const money = symbol + total.toFixed(2);

        const severity = await checkBalanceWarnings(
          context,
          total,
          info.currency,
          balance.is_available !== false,
        );

        const samples = await recordBalanceSample(context, info.currency, total);
        const rate = estimateSpendRate(samples);

        if (severity === "depleted") {
          statusBar.text = "$(error) " + vscode.l10n.t("DeepSeek: {0} — out of credits", money);
        } else {
          const icon = severity === "ok" ? "$(graph)" : "$(warning)";
          statusBar.text = icon + " " + vscode.l10n.t("DeepSeek: {0} left", money);
        }
        statusBar.backgroundColor =
          severity === "depleted" || severity === "critical"
            ? new vscode.ThemeColor("statusBarItem.errorBackground")
            : severity === "warning"
              ? new vscode.ThemeColor("statusBarItem.warningBackground")
              : undefined;

        const tooltipLines = [
          vscode.l10n.t("Display: {0}", info.currency),
          vscode.l10n.t("Total balance:   {0}", symbol + info.total_balance),
          vscode.l10n.t("Topped-up:       {0}", symbol + info.topped_up_balance),
          vscode.l10n.t("Granted:         {0}", symbol + info.granted_balance),
        ];

        if (balance.balance_infos.length > 1) {
          tooltipLines.push("");
          for (const bi of balance.balance_infos) {
            const s = getCurrencySymbol(bi.currency);
            tooltipLines.push(
              vscode.l10n.t(
                "{0}: {1} (topped-up {2}, granted {3})",
                bi.currency,
                s + parseFloat(bi.total_balance).toFixed(2),
                s + bi.topped_up_balance,
                s + bi.granted_balance,
              ),
            );
          }
        }

        if (rate) {
          const perDayStr = rate.perDay >= 0.01 ? rate.perDay.toFixed(2) : "<0.01";
          tooltipLines.push("");
          tooltipLines.push(vscode.l10n.t("Est. spend: {0}/day", symbol + perDayStr));
          if (rate.daysLeft < 1) {
            tooltipLines.push(vscode.l10n.t("At this rate, credits run out within a day"));
          } else if (rate.daysLeft <= 365) {
            tooltipLines.push(
              vscode.l10n.t(
                "At this rate, credits run out in about {0} days",
                Math.round(rate.daysLeft),
              ),
            );
          }
        }

        tooltipLines.push("", vscode.l10n.t("Click for options"));
        statusBar.tooltip = tooltipLines.join("\n");
      } else {
        statusBar.text = "$(warning) " + vscode.l10n.t("DeepSeek: No data");
        statusBar.tooltip = vscode.l10n.t("Balance returned but no currency data found");
        statusBar.backgroundColor = undefined;
      }
    } else {
      statusBar.text = "$(warning) " + vscode.l10n.t("DeepSeek: Unavailable");
      statusBar.tooltip = vscode.l10n.t(
        "Balance info is not available — you may be out of credits",
      );
      statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  } catch {
    statusBar.text = "$(error) " + vscode.l10n.t("DeepSeek: Error");
    statusBar.tooltip = vscode.l10n.t("Failed to fetch balance. Click to retry.");
    statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
  } finally {
    updatingBalance = false;
  }
}

function makePopUpButtons(otherCurrency, showSwitch) {
  const buttons = [];
  if (showSwitch) {
    buttons.push({
      id: "switch",
      iconPath: new vscode.ThemeIcon("arrow-swap"),
      tooltip: vscode.l10n.t(
        "Switch to {0} ({1})",
        otherCurrency,
        getCurrencySymbol(otherCurrency),
      ),
    });
  }
  buttons.push({
    id: "dashboard",
    iconPath: new vscode.ThemeIcon("globe"),
    tooltip: vscode.l10n.t("Open Dashboard"),
  });
  return buttons;
}

/**
 * Shows the balance pop-up anchored to the status bar.
 * @param {vscode.ExtensionContext} context
 */
async function showBalancePopUp(context) {
  const apiKey = await context.secrets.get(SECRET_KEY_ID);
  if (!apiKey) return;

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = vscode.l10n.t("DeepSeek Account Balance");
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;
  quickPick.placeholder = vscode.l10n.t("Select an action or use buttons above to switch currency");

  renderQuickPickItems(quickPick, context, lastBalance);

  const currency = getPreferredCurrency(context);
  const otherCurrency = currency === "USD" ? "CNY" : "USD";
  const hasOther =
    lastBalance &&
    lastBalance.balance_infos &&
    lastBalance.balance_infos.some((info) => info.currency === otherCurrency);

  quickPick.buttons = makePopUpButtons(otherCurrency, hasOther);

  let resolved = false;
  const disposables = [];

  const resolveOnce = (fn) => {
    if (resolved) return;
    resolved = true;
    fn();
  };

  const done = new Promise((resolve) => {
    disposables.push(
      quickPick.onDidAccept(() => {
        const [selected] = quickPick.selectedItems;
        if (selected && selected.action) {
          resolveOnce(() => {
            quickPick.hide();
            handleAction(context, selected.action);
            resolve();
          });
        }
      }),
      quickPick.onDidTriggerButton(async (button) => {
        if (button.id === "dashboard") {
          resolveOnce(() => {
            quickPick.hide();
            vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
            resolve();
          });
        } else if (button.id === "switch") {
          resolveOnce(async () => {
            quickPick.hide();
            await setPreferredCurrency(context, otherCurrency);
            await updateStatusBar(context);
            vscode.window.showInformationMessage(
              vscode.l10n.t("Display currency switched to {0}.", otherCurrency),
            );
            resolve();
          });
        }
      }),
      quickPick.onDidHide(() => resolveOnce(() => resolve())),
    );
  });

  quickPick.show();

  fetchBalance(apiKey)
    .then((balance) => {
      lastBalance = balance;
      renderQuickPickItems(quickPick, context, balance);
      updateStatusBar(context);

      const newHasOther =
        balance.balance_infos &&
        balance.balance_infos.some((info) => info.currency === otherCurrency);
      quickPick.buttons = makePopUpButtons(otherCurrency, newHasOther);
    })
    .catch(() => {});

  await done;
  disposables.forEach((d) => d.dispose());
}

function renderQuickPickItems(quickPick, context, balance) {
  const currency = getPreferredCurrency(context);
  const items = [];

  if (!balance || !balance.balance_infos || balance.balance_infos.length === 0) {
    items.push({
      label: "$(loading~spin) " + vscode.l10n.t("Loading balance..."),
      description: "",
      detail: "",
      alwaysShow: true,
    });
  } else {
    for (const info of balance.balance_infos) {
      const symbol = getCurrencySymbol(info.currency);
      const isActive = info.currency === currency;
      const total = parseFloat(info.total_balance).toFixed(2);

      items.push({
        label: `${symbol}${total}`,
        description: info.currency + (isActive ? " " + vscode.l10n.t("(active)") : ""),
        detail: vscode.l10n.t(
          "Topped-up: {0}  |  Granted: {1}",
          symbol + info.topped_up_balance,
          symbol + info.granted_balance,
        ),
        alwaysShow: true,
      });
    }
  }

  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

  const otherCurrency = currency === "USD" ? "CNY" : "USD";
  const otherSymbol = getCurrencySymbol(otherCurrency);
  items.push({
    label: "$(arrow-swap) " + vscode.l10n.t("Switch to {0} ({1})", otherCurrency, otherSymbol),
    description: vscode.l10n.t("Change display currency"),
    alwaysShow: true,
    action: "switch-currency",
  });

  items.push(
    {
      label: "$(sync) " + vscode.l10n.t("Refresh"),
      description: vscode.l10n.t("Fetch latest balance"),
      alwaysShow: true,
      action: "refresh",
    },
    {
      label: "$(gear) " + vscode.l10n.t("Warning Thresholds"),
      description: vscode.l10n.t("Configure low-balance warning settings"),
      alwaysShow: true,
      action: "warning-thresholds",
    },
    {
      label: "$(key) " + vscode.l10n.t("Change API Key"),
      description: vscode.l10n.t("Update your DeepSeek key"),
      alwaysShow: true,
      action: "change",
    },
    {
      label: "$(sign-out) " + vscode.l10n.t("Clear API Key"),
      description: vscode.l10n.t("Remove stored key"),
      alwaysShow: true,
      action: "clear",
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(credit-card) " + vscode.l10n.t("Top Up"),
      description: "platform.deepseek.com/top_up",
      alwaysShow: true,
      action: "top-up",
    },
    {
      label: "$(globe) " + vscode.l10n.t("Open Dashboard"),
      description: "platform.deepseek.com/usage",
      alwaysShow: true,
      action: "dashboard",
    },
  );

  quickPick.items = items;
}

async function handleAction(context, action) {
  switch (action) {
    case "switch-currency": {
      const currency = getPreferredCurrency(context);
      const other = currency === "USD" ? "CNY" : "USD";
      await setPreferredCurrency(context, other);
      await updateStatusBar(context);
      vscode.window.showInformationMessage(
        vscode.l10n.t("Display currency switched to {0}.", other),
      );
      break;
    }
    case "refresh":
      await updateStatusBar(context);
      vscode.window.showInformationMessage(vscode.l10n.t("DeepSeek balance refreshed."));
      break;
    case "warning-thresholds":
      await showThresholdConfig(context);
      break;
    case "change":
      await promptForApiKey(context);
      break;
    case "clear":
      await context.secrets.delete(SECRET_KEY_ID);
      lastBalance = null;
      await updateStatusBar(context);
      vscode.window.showInformationMessage(vscode.l10n.t("DeepSeek API key cleared."));
      break;
    case "top-up":
      vscode.env.openExternal(vscode.Uri.parse(TOP_UP_URL));
      break;
    case "dashboard":
      vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL));
      break;
  }
}

/**
 * Fetches balance from the DeepSeek API.
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
function fetchBalance(apiKey) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: HOST,
        path: "/user/balance",
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("Failed to parse response JSON"));
            }
          } else {
            try {
              const parsed = JSON.parse(data);
              reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  fetchBalance,
  getCurrencySymbol,
  getPreferredCurrency,
  setPreferredCurrency,
  findBalanceInfo,
  shouldWarn,
  getMandatoryFloor,
  classifyBalance,
  parseThresholdInput,
  estimateSpendRate,
};
