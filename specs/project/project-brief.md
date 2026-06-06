# DeepSeek Usage Tracker — Project Brief

Last updated: 2026-06-06
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
- Status bar format: `DeepSeek: $X.XX left`
- No key: `DeepSeek: Not logged in`
- Click: QuickPick with Refresh, View Details, Change Key, Clear Key
- View Details: modal with full balance breakdown + link to platform.deepseek.com/usage
- API key via password-masked input, stored in SecretStorage
- Direct HTTPS to api.deepseek.com, no intermediary
- Auto-refresh every 5 minutes

### 4.2 Out of Scope (v1)

- Usage history (no DeepSeek usage API exists)
- Model list, pricing info
- Webview panel
- i18n (English only)
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

Single file `extension.js` using only VS Code Extension API + Node.js `https` module.
Zero runtime dependencies. API key in SecretStorage (macOS Keychain).

## 7. Acceptance Criteria

- AC-1: No key → "DeepSeek: Not logged in"
- AC-2: Click when no key → password input box
- AC-3: Valid key → "DeepSeek: $X.XX left"
- AC-4: Click when key exists → QuickPick menu
- AC-5: Refresh → re-fetches and updates
- AC-6: View Details → modal with full breakdown
- AC-7: Change Key → replaces stored key
- AC-8: Clear Key → deletes key, returns to not-logged-in
- AC-9: Auto-refresh every 5 minutes
- AC-10: Concurrent request guard

## 8. Test Plan

| Test ID         | Category       | Covers                   |
| --------------- | -------------- | ------------------------ |
| DU-API-UNIT-001 | unit-api       | Successful balance parse |
| DU-API-UNIT-002 | unit-api       | Unavailable balance      |
| DU-API-UNIT-003 | unit-api       | CNY currency             |
| DU-API-UNIT-004 | unit-api       | High-precision values    |
| DU-SB-UNIT-001  | unit-statusbar | Balance format           |
| DU-SB-UNIT-002  | unit-statusbar | Zero balance format      |
| DU-SB-UNIT-003  | unit-statusbar | Large balance format     |
| DU-SB-UNIT-004  | unit-statusbar | Not-logged-in state      |
| DU-SB-UNIT-005  | unit-statusbar | Error state              |
| DU-SB-UNIT-006  | unit-statusbar | Unavailable state        |
| DU-SMOKE-001    | smoke          | Module exports           |
