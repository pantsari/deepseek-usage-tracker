// Mock vscode module before any test requires extension.js
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "vscode") {
    return {
      window: {
        createStatusBarItem: () => ({ show: () => {}, dispose: () => {} }),
        showQuickPick: () => undefined,
        showInputBox: () => undefined,
        showInformationMessage: () => undefined,
        showErrorMessage: () => undefined,
      },
      StatusBarAlignment: { Right: 1, Left: 2 },
      commands: { registerCommand: () => ({ dispose: () => {} }) },
      env: { openExternal: () => undefined },
      Uri: { parse: (s) => s },
    };
  }
  return originalRequire.apply(this, arguments);
};
