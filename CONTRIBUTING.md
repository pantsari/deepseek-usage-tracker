# Contributing

Thanks for considering a contribution.

## Setup

```bash
git clone https://github.com/pantsari/deepseek-usage-tracker.git
cd deepseek-usage-tracker
npm install
```

## Scripts

| Command                  | Purpose               |
| ------------------------ | --------------------- |
| `npx vitest run`         | Run unit tests        |
| `npx eslint .`           | Lint                  |
| `npx prettier --check .` | Format check          |
| `npx prettier --write .` | Fix formatting        |
| `npx vsce package`       | Package the extension |

## Code style

- Write failing tests first, then implement (see `test/extension.test.js` for
  patterns).
- Keep changes small. Do not add abstraction without clear need.
- Zero runtime dependencies — no new npm packages without an ADR in
  `specs/decisions/`.
- All API calls go directly to `api.deepseek.com` over HTTPS.

## Pull requests

1. Fork the repo and create a branch.
2. Add tests for new behavior.
3. Run `npx vitest run`, `npx eslint .`, and `npx prettier --check .` before
   pushing.
4. Open a PR with a clear description and link any related issues.

PRs that fail CI (lint, format, or tests) will not be reviewed.
