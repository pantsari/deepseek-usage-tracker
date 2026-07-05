# DeepSeek Credit Status — API Balance Monitor

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

## What's new in 1.2.0

- **Surge-pricing awareness** — the status bar now shows whether DeepSeek's
  V4 surge pricing is active, with a live countdown to the next change
  (e.g. `DeepSeek: $0.92 · Normal · Surge in 2h 14m`)
- **Amber status bar during surge** — instantly see when higher API prices
  apply; critical low-balance red always takes precedence
- **Surge start/end notifications** — a small popup when surge pricing begins
  or ends while VS Code is running
- **Pricing row in the balance menu** — the next surge transition shown in
  UTC (English) or Shanghai time (中文)
- All computed locally from the published surge windows (09:00–12:00 and
  14:00–18:00 Asia/Shanghai) — no extra API calls

## Features

- **Live balance in the status bar** — your DeepSeek credits displayed at a
  glance, auto-refreshed at a configurable interval (default 5 minutes). The
  status bar turns yellow when your balance is low and red when it is
  critically low or depleted
- **Surge-pricing awareness** — the status bar shows the current DeepSeek V4
  pricing state (normal or surge) with a live countdown to the next
  transition, turns amber while surge pricing is active, and pops up a
  notification when surge starts or ends. Transition times are shown in UTC
  for English and Shanghai time for Chinese. Computed locally from the
  official surge windows (09:00–12:00 and 14:00–18:00 Asia/Shanghai) — no
  extra API calls
- **Mandatory low-credit alert** — a modal warning always fires below $1 / ¥7
  and when credits run out, so you can never silently hit an empty balance.
  Every alert includes a one-click "Top Up" button
- **Low-balance warnings** — configurable alerts when your credits drop below
  preset thresholds ($20, $10, $5, $1) or any custom amounts you enter. Tap
  the notification to adjust settings immediately
- **Spend-rate estimate** — the tooltip shows your estimated daily spend and
  roughly how long your credits will last, computed locally from balance
  history (no extra API calls)
- **Multi-currency support** — USD and CNY balances, switchable with one click
- **Available in English and 简体中文** — the UI follows VS Code's display
  language
- **Command Palette integration** — `DeepSeek: Refresh Balance`, `DeepSeek:
Set API Key`, `DeepSeek: Configure Warning Thresholds`, and `DeepSeek: Open
Balance Menu`
- **QuickPick menu** — click the status bar to refresh balance, switch
  currencies, configure warning thresholds, change or clear your API key, top
  up, or open the DeepSeek billing dashboard
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
   (adjustable via the `deepseek-usage.refreshIntervalMinutes` setting)

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
