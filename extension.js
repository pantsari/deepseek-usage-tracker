const vscode = require("vscode");
const https = require("https");

const SECRET_KEY_ID = "deepseek-api-key";
const HOST = "api.deepseek.com";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let updatingBalance = false;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "deepseek-usage.click";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const clickCmd = vscode.commands.registerCommand("deepseek-usage.click", async () => {
    const apiKey = await context.secrets.get(SECRET_KEY_ID);
    if (!apiKey) {
      await promptForApiKey(context, statusBar);
      return;
    }

    const action = await vscode.window.showQuickPick(
      [
        { label: "$(sync) Refresh", id: "refresh" },
        { label: "$(info) View Details", id: "details" },
        { label: "$(key) Change Key", id: "change" },
        { label: "$(sign-out) Clear Key", id: "clear" },
      ],
      { placeHolder: "DeepSeek Usage Tracker" },
    );

    if (!action) return;

    switch (action.id) {
      case "refresh":
        await updateStatusBar(context, statusBar);
        vscode.window.showInformationMessage("DeepSeek balance refreshed.");
        break;
      case "details":
        await showDetails(context);
        break;
      case "change":
        await promptForApiKey(context, statusBar);
        break;
      case "clear":
        await context.secrets.delete(SECRET_KEY_ID);
        await updateStatusBar(context, statusBar);
        vscode.window.showInformationMessage("DeepSeek API key cleared.");
        break;
    }
  });
  context.subscriptions.push(clickCmd);

  updateStatusBar(context, statusBar);
  const timer = setInterval(() => updateStatusBar(context, statusBar), REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {vscode.StatusBarItem} statusBar
 */
async function promptForApiKey(context, statusBar) {
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
  await updateStatusBar(context, statusBar);
  vscode.window.showInformationMessage("DeepSeek API key saved.");
}

/**
 * @param {vscode.ExtensionContext} context
 * @param {vscode.StatusBarItem} statusBar
 */
async function updateStatusBar(context, statusBar) {
  if (updatingBalance) return;
  updatingBalance = true;
  try {
    const apiKey = await context.secrets.get(SECRET_KEY_ID);

    if (!apiKey) {
      statusBar.text = "$(key) DeepSeek: Not logged in";
      statusBar.tooltip = "Click to enter your DeepSeek API key";
      return;
    }

    const balance = await fetchBalance(apiKey);

    if (balance.is_available && balance.balance_infos && balance.balance_infos.length > 0) {
      const info = balance.balance_infos[0];
      const total = parseFloat(info.total_balance);

      statusBar.text = `$(graph) DeepSeek: $${total.toFixed(2)} left`;
      statusBar.tooltip = [
        `Total: $${info.total_balance}`,
        `Topped-up: $${info.topped_up_balance}`,
        `Granted: $${info.granted_balance}`,
        `Currency: ${info.currency}`,
        `Status: ${balance.is_available ? "Available" : "Unavailable"}`,
        "Click for options",
      ].join("\n");
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
 * @param {vscode.ExtensionContext} context
 */
async function showDetails(context) {
  const apiKey = await context.secrets.get(SECRET_KEY_ID);
  if (!apiKey) {
    vscode.window.showInformationMessage("No API key configured. Click the status bar to set one.");
    return;
  }

  try {
    const balance = await fetchBalance(apiKey);

    if (balance.is_available && balance.balance_infos && balance.balance_infos.length > 0) {
      const info = balance.balance_infos[0];
      const message = [
        `Total balance: $${info.total_balance}`,
        `Topped-up: $${info.topped_up_balance}`,
        `Granted: $${info.granted_balance}`,
        `Currency: ${info.currency}`,
        `Account active: ${balance.is_available ? "Yes" : "No"}`,
        "",
        "View usage details at: https://platform.deepseek.com/usage",
      ].join("\n");

      vscode.window
        .showInformationMessage(message, { modal: true }, "Open Dashboard")
        .then((selection) => {
          if (selection === "Open Dashboard") {
            vscode.env.openExternal(vscode.Uri.parse("https://platform.deepseek.com/usage"));
          }
        });
    } else {
      vscode.window.showInformationMessage("Balance info is not available.");
    }
  } catch (err) {
    vscode.window.showErrorMessage(`Failed to fetch balance: ${err.message}`);
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

module.exports = { activate, deactivate, fetchBalance };
