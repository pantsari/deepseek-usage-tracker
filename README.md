# DeepSeek Usage Tracker

Track your DeepSeek API account balance and remaining credits right from the
VS Code status bar. Never get caught with an empty balance during a coding
session again.

Ideal for developers using [DeepSeek](https://platform.deepseek.com) with
[OpenCode](https://opencode.ai) or any other AI coding tool inside VS Code.
Monitor your usage without leaving the editor.

The extension talks only to DeepSeek's
[`/user/balance`](https://api.deepseek.com/user/balance) endpoint over HTTPS.
No other APIs, analytics, telemetry, or third-party services are involved.

![Status bar showing DeepSeek balance](https://raw.githubusercontent.com/pantsari/deepseek-usage-tracker/main/Deepseek%20usage%20bar.png)

![Command palette with settings and actions](https://raw.githubusercontent.com/pantsari/deepseek-usage-tracker/main/Command%20palette%20settings.png)

## Features

- **Live balance in the status bar** — your DeepSeek credits displayed at a
  glance, auto-refreshed every 5 minutes
- **Low-balance warnings** — configurable alerts when your credits drop below
  preset thresholds ($20, $10, $5, or $1). Tap the notification to adjust
  settings immediately
- **$0 alert** — a dedicated warning fires when you have no credits remaining,
  regardless of threshold settings
- **Multi-currency support** — USD and CNY balances, switchable with one click
- **QuickPick command palette** — click the status bar to refresh balance,
  switch currencies, configure warning thresholds, change or clear your API key,
  or open the DeepSeek billing dashboard
- **Secure by default** — your API key is stored in VS Code SecretStorage (macOS
  Keychain, Windows Credential Manager, or Linux libsecret/gnome-keyring)
- **Zero runtime dependencies** — built entirely on the VS Code Extension API
  and Node.js `https` module. No npm packages at runtime, nothing phoning home

## Usage

1. Install the extension
2. Click `DeepSeek: Not logged in` in the status bar
3. Enter your DeepSeek API key (from
   [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys))
4. Your balance appears in the status bar and refreshes every 5 minutes

Click the status bar at any time to refresh, switch currencies, configure
warning thresholds, change or clear your key, or open the DeepSeek usage
dashboard.

## Privacy

This extension makes exactly one outbound network call:
`GET https://api.deepseek.com/user/balance` with your API key in the
`Authorization` header. Your key never leaves your machine except for that
single request to DeepSeek. No analytics, telemetry, or third-party services
are involved.

## Requirements

- VS Code 1.85+
- A [DeepSeek API key](https://platform.deepseek.com/api_keys)

## License

[MIT](LICENSE)
