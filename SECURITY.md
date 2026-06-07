# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this extension, please report it
privately via [GitHub Security
Advisories](https://github.com/pantsari/deepseek-usage-tracker/security/advisories/new).

Do not open a public issue. I will respond within 48 hours and work with you
on a fix and coordinated disclosure timeline.

## Scope

This extension stores your DeepSeek API key using VS Code
[SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage).
The key is never logged, written to disk in plaintext, or sent to any server
other than `api.deepseek.com` over HTTPS.

If you find a code path that could leak the API key — for example into an error
message, log output, clipboard, or any third-party service — please report it.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
