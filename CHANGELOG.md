# Changelog

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
