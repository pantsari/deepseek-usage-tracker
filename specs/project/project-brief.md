# DeepSeek Usage Tracker — Project Brief

Last updated: 2026-08-25
Status: implemented
Audience: AI agents, human reviewers, the project owner

## 1. Executive Summary

DeepSeek Usage Tracker is a minimal VS Code extension that displays DeepSeek
API account balance in the editor status bar. The user can see at a glance how
many credits remain, without leaving the editor.

## 2. Problem

Users of the DeepSeek API who use VS Code as their primary editor have no way
to see their remaining balance without switching context to a browser. This
friction leads to unexpected "insufficient balance" errors during development.

## 3. User

A VS Code user who has a DeepSeek API key and wants to monitor remaining
credits without leaving the editor.

## 4. Scope

### 4.1 In Scope (v1)

- Display total_balance from the DeepSeek `/user/balance` API in the status bar
- Status bar format: `DeepSeek: $X.XX · Off-peak · Peak in 2h 14m` (or the
  equivalent active-peak state)
- No key: `DeepSeek: Not logged in`
- Click: QuickPick with Refresh, View Details, Change Key, Clear Key
- View Details: modal with full balance breakdown + link to platform.deepseek.com/usage
- API key via password-masked input, stored in SecretStorage
- Direct HTTPS to api.deepseek.com, no intermediary
- Auto-refresh every 5 minutes
- Display the current DeepSeek API Peak/Off-peak tier and a live countdown to
  the next pricing transition
- Apply peak windows from 09:00–12:00 and 14:00–18:00 Beijing time on Monday
  through Friday; treat Saturday and Sunday as off-peak all day
- Notify when peak pricing starts or ends, including a weekend-specific
  message after Friday's final peak window
- Share one in-flight balance request between concurrent refresh callers and
  between balance-menu and status-bar updates
- Distinguish invalid credentials, rate limits, timeouts, network failures,
  malformed responses, and DeepSeek service failures in the UI
- English and Simplified Chinese UI

### 4.2 Out of Scope (v1)

- Usage history (no DeepSeek usage API exists)
- Per-request token metering or cost calculator
- Webview panel
- TypeScript compilation
- Any backend or external services

## 5. Data Model

GET https://api.deepseek.com/user/balance — returns:

- is_available (boolean)
- balance_infos[].currency (USD or CNY)
- balance_infos[].total_balance
- balance_infos[].granted_balance
- balance_infos[].topped_up_balance

## 6. Architecture

`extension.js` contains the VS Code integration and `pricing.js` contains the
pure pricing-schedule calculation. Both use only the VS Code Extension API and
Node.js built-ins. Zero runtime dependencies. API key in SecretStorage (macOS
Keychain).

The Marketplace package ID is `pantsari.deepseek-credit-status`. Commands and
settings intentionally retain the historical `deepseek-usage.*` namespace so
updates do not break existing settings, keybindings, walkthrough events, or
integrations.

## 7. Acceptance Criteria

- AC-1: No key → "DeepSeek: Not logged in"
- AC-2: Click when no key → password input box
- AC-3: Valid key → "DeepSeek: $X.XX left"
- AC-4: Click when key exists → QuickPick menu
- AC-5: Refresh → re-fetches and updates
- AC-6: View Details → modal with full breakdown
- AC-7: Change Key → replaces the stored key and confirms it only after a balance
  request made with that same key succeeds
- AC-8: Clear Key → deletes the key, returns to not-logged-in, and prevents a
  superseded request from restoring balance state
- AC-9: Auto-refresh every 5 minutes
- AC-10: Concurrent request guard
- AC-11: Monday–Friday peak windows are 09:00–12:00 and 14:00–18:00 Beijing
  time, with start instants inclusive and end instants exclusive
- AC-12: Saturday and Sunday are off-peak all day, based on the Beijing date
- AC-13: After Friday's final peak window, the next transition points to
  Monday at 09:00 Beijing time
- AC-14: The UI uses Peak/Off-peak terminology and formats countdowns of at
  least one day using days and hours
- AC-15: Activating the extension does not fire a pricing notification;
  subsequent peak-tier changes fire at most one notification
- AC-16: Friday's peak-end notification states that off-peak pricing remains
  active through the weekend
- AC-17: English transition times use UTC; Simplified Chinese transition times
  use Beijing time
- AC-18: Marketplace copy states that the extension supports DeepSeek's
  pricing rules effective August 23, 2026 and includes the current price table
- AC-19: Opening the balance menu performs at most one new balance request;
  its result also updates status, warnings, and spend history only while its
  credential generation is current
- AC-20: Concurrent balance refresh callers share one in-flight request and a
  later refresh starts a new request after it settles; credential mutations
  supersede stale requests without changing ordinary single-flight behavior
- AC-21: Authentication, insufficient-balance, rate-limit, timeout, network,
  invalid-response, and service errors have distinct, safe user-facing messages;
  malformed successful payloads, including empty balance arrays, are invalid
- AC-22: A failed balance-menu refresh shows an error row rather than an
  indefinite loading row and does not render stale balance figures
- AC-23: A failed manual refresh does not show a success notification
- AC-24: The `deepseek-usage.*` command and setting namespace remains stable
  for backwards compatibility

## 8. Test Plan

| Test ID               | Category       | Covers                              |
| --------------------- | -------------- | ----------------------------------- |
| DU-API-UNIT-001       | unit-api       | Successful balance parse            |
| DU-API-UNIT-002       | unit-api       | Unavailable balance                 |
| DU-API-UNIT-003       | unit-api       | CNY currency                        |
| DU-API-UNIT-004       | unit-api       | High-precision values               |
| DU-API-UNIT-005–017   | unit-api       | HTTPS request and typed failures    |
| DU-ERR-UNIT-001–005   | unit-errors    | Error presentations and popup state |
| DU-REFRESH-UNIT-001   | unit-refresh   | Shared in-flight refresh operation  |
| DU-KEY-UNIT-001–003   | unit-api-key   | Credential mutation races           |
| DU-SB-UNIT-001        | unit-statusbar | Balance format                      |
| DU-SB-UNIT-002        | unit-statusbar | Zero balance format                 |
| DU-SB-UNIT-003        | unit-statusbar | Large balance format                |
| DU-SB-UNIT-004        | unit-statusbar | Not-logged-in state                 |
| DU-SB-UNIT-005        | unit-statusbar | Error state                         |
| DU-SB-UNIT-006        | unit-statusbar | Unavailable state                   |
| DU-SMOKE-001          | smoke          | Module exports                      |
| DU-PRICE-UNIT-001–008 | unit-pricing   | Weekday peak windows and boundaries |
| DU-PRICE-UNIT-009–012 | unit-pricing   | Weekend and Monday transitions      |
| DU-PRICE-UNIT-013–015 | unit-pricing   | Localized pricing display           |
| DU-PRICE-UNIT-016–020 | unit-pricing   | Countdown formatting                |
| DU-PRICE-UNIT-021–022 | unit-pricing   | Locale and schedule configuration   |
