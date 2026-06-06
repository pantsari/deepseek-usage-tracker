# DeepSeek Usage Tracker — Agent Guide

This file is the model-neutral operating guide for AI-assisted work in this
repository.

## Project

DeepSeek Usage Tracker is a minimal VS Code extension that displays DeepSeek
API account balance in the editor status bar.

## How Agents Should Work

1. Read `specs/project/project-brief.md` before any implementation.
2. Follow test-driven development: write a failing test first, verify it fails
   for the expected reason, then implement.
3. Keep changes small and coherent. Do not add abstraction without clear need.
4. Zero external runtime dependencies unless an ADR approves one.
5. Use `eslint .` and `prettier --check .` before considering work complete.

## Scripts

- `npx eslint .` — lint
- `npx prettier --check .` — format check
- `npx prettier --write .` — format
- `npx vitest run` — run unit tests

## Documentation Rules

- Project specs live in `specs/`.
- Architectural decisions live in `specs/decisions/`.
- `AGENTS.md` is the entry point for all coding agents.

## Engineering Principles

- Read existing specs before changing direction.
- Treat code as a liability: prefer less custom code.
- No external runtime npm packages without an ADR.
- API key security is paramount: SecretStorage only, never logged.
