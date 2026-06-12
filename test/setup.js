// Mock vscode module before any test requires extension.js
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "vscode") {
    return {
      window: {
        createStatusBarItem: () => ({ show: () => {}, dispose: () => {} }),
        createQuickPick: () => ({
          show: () => {},
          hide: () => {},
          dispose: () => {},
          onDidAccept: () => ({ dispose: () => {} }),
          onDidTriggerButton: () => ({ dispose: () => {} }),
          onDidHide: () => ({ dispose: () => {} }),
          items: [],
        }),
        showQuickPick: () => undefined,
        showInputBox: () => undefined,
        showInformationMessage: () => undefined,
        showWarningMessage: () => undefined,
        showErrorMessage: () => undefined,
      },
      l10n: {
        t: (message, ...args) => message.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])),
      },
      StatusBarAlignment: { Right: 1, Left: 2 },
      QuickPickItemKind: { Separator: -1 },
      ThemeIcon: class {},
      ThemeColor: class {},
      ConfigurationTarget: { Global: 1 },
      commands: { registerCommand: () => ({ dispose: () => {} }) },
      env: { openExternal: () => undefined },
      Uri: { parse: (s) => s },
      workspace: {
        getConfiguration: () => ({
          get: (_key, fallback) => fallback,
          update: () => Promise.resolve(),
        }),
        onDidChangeConfiguration: () => ({ dispose: () => {} }),
      },
    };
  }
  return originalRequire.apply(this, arguments);
};
