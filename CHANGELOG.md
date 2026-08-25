# Changelog

## [1.3.0] - 2026-08-25

### Added

- Weekend-aware pricing status: Saturday and Sunday are off-peak all day in
  Beijing time, and Friday's final transition points to Monday morning
- Typed balance-request error classification for authentication, insufficient
  balance, rate limits, timeouts, network failures, invalid responses, and
  DeepSeek service failures

### Changed

- Updated pricing awareness for DeepSeek's billing rules effective August 23,
  2026: peak windows now apply Monday–Friday only (Beijing time)
- Replaced Normal/Surge wording with DeepSeek's official Peak/Off-peak
  terminology throughout the English and Simplified Chinese UI
- Weekend countdowns now skip directly to Monday's first peak window and use
  compact day/hour formatting (for example, `2d 15h`)
- Friday's peak-end notification now confirms that off-peak pricing remains
  active through the weekend
- Opening the balance menu and updating the status bar now share one balance
  request; concurrent refreshes reuse the same in-flight request
- The historical `deepseek-usage.*` command and setting IDs remain unchanged
  for compatibility with existing settings and keybindings
- Updated the Marketplace description, README feature copy, screenshot
  caption, keywords, and current API price table for the new billing rules

### Fixed

- Response-stream failures after HTTP headers now settle as network errors
  instead of wedging all future refreshes behind a dead in-flight request
- Changing or clearing an API key now supersedes old-key requests before they
  can update the status bar, warning state, cached balance, or balance history;
  key-save confirmation is tied to a successful check of that exact key
- Successful HTTP responses are now validated as usable balance payloads;
  malformed objects, `null`, and empty balance arrays report an invalid response,
  while unavailable accounts with populated balances remain supported
- HTTP 402 insufficient-balance responses now point to the existing Top Up
  option instead of appearing as generic service failures
- Failed balance-menu requests show only the error state, without stale account
  figures or an indefinite loading row, and failed manual refreshes do not
  report success
- Invalid-key tooltips now accurately say that clicking opens the options menu

## [1.2.2] - 2026-07-18

### Added

- GitHub Actions CI workflow (Prettier, ESLint, unit tests) and clickable
  badges in the README

## [1.2.1] - 2026-07-05

### Changed

- Marketplace listing: added AI and Machine Learning categories, refreshed
  description and screenshots for the surge-pricing feature

## [1.2.0] - 2026-07-05

### Added

- **Surge-pricing awareness** — the extension now tracks DeepSeek's V4 surge
  windows (09:00–12:00 and 14:00–18:00 Asia/Shanghai) locally, with no extra
  API calls:
  - Status bar shows the current pricing state and a live countdown to the
    next transition (e.g. `DeepSeek: $0.92 · Normal · Surge in 2h 14m`),
    refreshed every 30 seconds
  - Amber status bar background during surge pricing; critical low-balance
    red always takes precedence
  - Pricing row in the balance menu with the next transition time (UTC for
    English, Shanghai time for Chinese)
  - Notification when surge pricing starts or ends while VS Code is running
    (never on activation, at most one after waking from sleep)

## [1.1.0] - 2026-06-13

### Added

- **Mandatory low-credit alert** — a modal warning always fires when the
  balance drops below $1 (USD) or ¥7 (CNY), even with all optional thresholds
  disabled, with a one-click "Top Up" button
- Out-of-credits modal alert when the balance hits zero or DeepSeek reports the
  account as unavailable
- Status bar background colors: yellow below a warning threshold, red when
  credits are critically low or depleted
- Custom warning thresholds — enter any comma-separated amounts (e.g.
  `15, 7.50, 2`) via the new pencil button in the threshold picker; custom
  values now appear in the picker alongside presets
- Command Palette commands: `DeepSeek: Refresh Balance`, `DeepSeek: Set API
Key`, `DeepSeek: Configure Warning Thresholds`, `DeepSeek: Open Balance Menu`
- `deepseek-usage.refreshIntervalMinutes` setting (1–120 minutes, default 5)
- "Top Up" shortcut in the status bar menu and in every low-balance
  notification
- **Chinese (Simplified) localization** — the full UI, commands, and settings
  are translated for VS Code's `zh-cn` display language
- **Spend-rate estimate** — the status bar tooltip now shows your estimated
  daily spend and roughly how long your credits will last, computed locally
  from balance history (top-ups are excluded; no extra API calls)
- Getting-started walkthrough shown after install (set key, view balance,
  configure warnings)

### Fixed

- Warnings were silently skipped when DeepSeek reported `is_available: false` —
  exactly when credits run out. The balance and alerts now also work in that
  state
- Warned-threshold state is now persisted before notifications are shown, so a
  window reload or overlapping refresh can no longer drop or duplicate alerts
- Clicking "Configure Thresholds" in a warning notification no longer loses the
  warned-threshold state
- Crossing several thresholds at once now shows a single consolidated warning
  instead of a chain of stacked notifications
- Warnings re-arm correctly when switching the display currency
- The status bar menu no longer shows a perpetual "Loading balance..." when
  DeepSeek reports the account as unavailable

## [1.0.0] - 2026-06-07

Initial release.

### Added

- Status bar display of DeepSeek API balance, auto-refreshed every 5 minutes
- Secure API key storage via VS Code SecretStorage (macOS Keychain, Windows
  Credential Manager, Linux libsecret)
- Multi-currency support (USD and CNY), switchable with one click
- QuickPick menu with Refresh, Change Key, Clear Key, and Open Dashboard
- Configurable low-balance warning thresholds via multi-select QuickPick
  (presets: $20, $10, $5, $1 for USD; ¥150, ¥75, ¥35, ¥7 for CNY)
- Actionable warning notifications — tap "Configure Thresholds" to adjust
  settings immediately
- $0 balance special alert ("You have no more credits remaining")
- Zero runtime dependencies — uses only VS Code Extension API and Node.js
  built-in `https` module
