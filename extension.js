const vscode = require("vscode");
const https = require("https");

const SECRET_KEY_ID = "deepseek-api-key";
const CURRENCY_STATE_KEY = "deepseek-currency";
const WARNED_STATE_KEY = "deepseek-warned-thresholds";
const HOST = "api.deepseek.com";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

  const clickCmd = vscode.commands.registerCommand("deepseek-usage.click", async () => {
    const apiKey = await context.secrets.get(SECRET_KEY_ID);
    if (!apiKey) {
      await promptForApiKey(context);
      return;
    }
    await showBalancePopUp(context);
  });
  context.subscriptions.push(clickCmd);

  updateStatusBar(context);
  const timer = setInterval(() => updateStatusBar(context), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function getCurrencySymbol(currency) {
  switch (currency) {
    case "CNY":
      return "\u00A5";
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

async function showThresholdConfig(context) {
  const current = getWarningThresholds();
  const currency = getPreferredCurrency(context);
  const symbol = getCurrencySymbol(currency);
  const presetValues = currency === "CNY" ? [150, 75, 35, 7] : [20, 10, 5, 1];

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = `Warning Thresholds (${currency})`;
  quickPick.canPickMany = true;
  quickPick.placeholder =
    "Select balance thresholds for low-balance warnings (uncheck all to disable)";

  quickPick.items = presetValues.map((val) => ({
    label: `${symbol}${val.toFixed(2)}`,
    description: `Warn when balance drops below ${symbol}${val.toFixed(2)}`,
    picked: current.includes(val),
    value: val,
  }));

  quickPick.buttons = [
    {
      iconPath: new vscode.ThemeIcon("close-all"),
      tooltip: "Disable All Warnings",
    },
  ];

  const done = new Promise((resolve) => {
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems.map((item) => item.value);
      const config = vscode.workspace.getConfiguration("deepseek-usage");
      await config.update(
        "warningThresholds",
        selected.sort((a, b) => b - a),
        vscode.ConfigurationTarget.Global,
      );
      await clearWarnedThresholds(context);
      quickPick.hide();
      resolve();
    });

    quickPick.onDidTriggerButton(async (button) => {
      if (button.tooltip === "Disable All Warnings") {
        const config = vscode.workspace.getConfiguration("deepseek-usage");
        await config.update("warningThresholds", [], vscode.ConfigurationTarget.Global);
        await clearWarnedThresholds(context);
        quickPick.hide();
        vscode.window.showInformationMessage("Warning thresholds disabled.");
      }
      resolve();
    });

    quickPick.onDidHide(() => resolve());
  });

  quickPick.show();
  return done;
}

function shouldWarn(balanceAmount, thresholds, warnedThresholds) {
  return thresholds.filter((t) => balanceAmount < t && !warnedThresholds.includes(t));
}

async function checkBalanceWarnings(context, amount, currency) {
  if (amount <= 0) {
    const symbol = getCurrencySymbol(currency);
    const result = await vscode.window.showWarningMessage(
      `DeepSeek: You have no more credits remaining (${symbol}${amount.toFixed(2)}).`,
      "Configure Thresholds",
    );
    if (result === "Configure Thresholds") {
      await showThresholdConfig(context);
    }
    return;
  }

  const thresholds = getWarningThresholds();
  if (!thresholds || thresholds.length === 0) return;

  const warned = getWarnedThresholds(context);
  const newWarnings = shouldWarn(amount, thresholds, warned);

  const stillCrossed = thresholds.filter(
    (t) => amount < t && (warned.includes(t) || newWarnings.includes(t)),
  );

  for (const threshold of newWarnings) {
    const symbol = getCurrencySymbol(currency);
    const result = await vscode.window.showWarningMessage(
      `DeepSeek balance is below ${symbol}${threshold.toFixed(2)} (${symbol}${amount.toFixed(2)} remaining).`,
      "Configure Thresholds",
    );
    if (result === "Configure Thresholds") {
      await showThresholdConfig(context);
      return;
    }
  }

  await setWarnedThresholds(context, stillCrossed);
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function promptForApiKey(context) {
  const apiKey = await vscode.window.showInputBox({
    title: "DeepSeek API Key",
    prompt: "Enter your DeepSeek API Key (get it from platform.deepseek.com)",
    password: true,
    placeHolder: "sk-...",
    ignoreFocusOut: true,
    validateInput: (value) => (value && value.trim() ? null : "API Key cannot be empty"),
  });

  if (!apiKey) return;

  await context.secrets.store(SECRET_KEY_ID, apiKey.trim());
  await updateStatusBar(context);
  vscode.window.showInformationMessage("DeepSeek API key saved.");
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
      statusBar.text = "$(key) DeepSeek: Not logged in";
      statusBar.tooltip = "Click to enter your DeepSeek API key";
      lastBalance = null;
      return;
    }

    const balance = await fetchBalance(apiKey);
    lastBalance = balance;

    if (balance.is_available && balance.balance_infos && balance.balance_infos.length > 0) {
      const currency = getPreferredCurrency(context);
      const info = findBalanceInfo(balance, currency);

      if (info) {
        const total = parseFloat(info.total_balance);
        const symbol = getCurrencySymbol(info.currency);

        checkBalanceWarnings(context, total, info.currency);

        statusBar.text = `$(graph) DeepSeek: ${symbol}${total.toFixed(2)} left`;

        const tooltipLines = [
          `Display: ${info.currency}`,
          `Total balance:   ${symbol}${info.total_balance}`,
          `Topped-up:       ${symbol}${info.topped_up_balance}`,
          `Granted:         ${symbol}${info.granted_balance}`,
        ];

        if (balance.balance_infos.length > 1) {
          tooltipLines.push("");
          for (const bi of balance.balance_infos) {
            const s = getCurrencySymbol(bi.currency);
            tooltipLines.push(
              `${bi.currency}: ${s}${parseFloat(bi.total_balance).toFixed(2)} (topped-up ${s}${bi.topped_up_balance}, granted ${s}${bi.granted_balance})`,
            );
          }
        }

        tooltipLines.push("", "Click for options");
        statusBar.tooltip = tooltipLines.join("\n");
      } else {
        statusBar.text = "$(warning) DeepSeek: No data";
        statusBar.tooltip = "Balance returned but no currency data found";
      }
    } else {
      statusBar.text = "$(warning) DeepSeek: Unavailable";
      statusBar.tooltip = "Balance info is not available";
    }
  } catch {
    statusBar.text = "$(error) DeepSeek: Error";
    statusBar.tooltip = "Failed to fetch balance. Click to retry.";
  } finally {
    updatingBalance = false;
  }
}

/**
 * Shows the balance pop-up anchored to the status bar.
 * @param {vscode.ExtensionContext} context
 */
async function showBalancePopUp(context) {
  const apiKey = await context.secrets.get(SECRET_KEY_ID);
  if (!apiKey) return;

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = "DeepSeek Account Balance";
  quickPick.matchOnDescription = false;
  quickPick.matchOnDetail = false;
  quickPick.placeholder = "Select an action or use buttons above to switch currency";

  renderQuickPickItems(quickPick, context, lastBalance);

  const currency = getPreferredCurrency(context);
  const otherCurrency = currency === "USD" ? "CNY" : "USD";
  const hasOther =
    lastBalance &&
    lastBalance.balance_infos &&
    lastBalance.balance_infos.some((info) => info.currency === otherCurrency);

  const buttons = [];
  if (hasOther) {
    buttons.push({
      iconPath: new vscode.ThemeIcon("arrow-swap"),
      tooltip: `Switch to ${otherCurrency} (${getCurrencySymbol(otherCurrency)})`,
    });
  }
  buttons.push({
    iconPath: new vscode.ThemeIcon("globe"),
    tooltip: "Open Dashboard",
  });
  quickPick.buttons = buttons;

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
        if (button.tooltip === "Open Dashboard") {
          resolveOnce(() => {
            quickPick.hide();
            vscode.env.openExternal(vscode.Uri.parse("https://platform.deepseek.com/usage"));
            resolve();
          });
        } else if (hasOther && button.tooltip.startsWith("Switch to")) {
          resolveOnce(async () => {
            quickPick.hide();
            await setPreferredCurrency(context, otherCurrency);
            await updateStatusBar(context);
            vscode.window.showInformationMessage(`Display currency switched to ${otherCurrency}.`);
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

      const newOther = otherCurrency;
      const newHasOther =
        balance.balance_infos && balance.balance_infos.some((info) => info.currency === newOther);

      const newButtons = [];
      if (newHasOther) {
        newButtons.push({
          iconPath: new vscode.ThemeIcon("arrow-swap"),
          tooltip: `Switch to ${newOther} (${getCurrencySymbol(newOther)})`,
        });
      }
      newButtons.push({
        iconPath: new vscode.ThemeIcon("globe"),
        tooltip: "Open Dashboard",
      });
      quickPick.buttons = newButtons;
    })
    .catch(() => {});

  await done;
  disposables.forEach((d) => d.dispose());
}

function renderQuickPickItems(quickPick, context, balance) {
  const currency = getPreferredCurrency(context);
  const items = [];

  if (
    !balance ||
    !balance.is_available ||
    !balance.balance_infos ||
    balance.balance_infos.length === 0
  ) {
    items.push({
      label: "$(loading~spin) Loading balance...",
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
        description: `${info.currency}${isActive ? " (active)" : ""}`,
        detail: `Topped-up: ${symbol}${info.topped_up_balance}  |  Granted: ${symbol}${info.granted_balance}`,
        alwaysShow: true,
      });
    }
  }

  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

  const otherCurrency = currency === "USD" ? "CNY" : "USD";
  const otherSymbol = getCurrencySymbol(otherCurrency);
  items.push({
    label: `$(arrow-swap) Switch to ${otherCurrency} (${otherSymbol})`,
    description: "Change display currency",
    alwaysShow: true,
    action: "switch-currency",
  });

  items.push(
    {
      label: "$(sync) Refresh",
      description: "Fetch latest balance",
      alwaysShow: true,
      action: "refresh",
    },
    {
      label: "$(gear) Warning Thresholds",
      description: "Configure low-balance warning settings",
      alwaysShow: true,
      action: "warning-thresholds",
    },
    {
      label: "$(key) Change API Key",
      description: "Update your DeepSeek key",
      alwaysShow: true,
      action: "change",
    },
    {
      label: "$(sign-out) Clear API Key",
      description: "Remove stored key",
      alwaysShow: true,
      action: "clear",
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    {
      label: "$(globe) Open Dashboard",
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
      vscode.window.showInformationMessage(`Display currency switched to ${other}.`);
      break;
    }
    case "refresh":
      await updateStatusBar(context);
      vscode.window.showInformationMessage("DeepSeek balance refreshed.");
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
      vscode.window.showInformationMessage("DeepSeek API key cleared.");
      break;
    case "dashboard":
      vscode.env.openExternal(vscode.Uri.parse("https://platform.deepseek.com/usage"));
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
};
