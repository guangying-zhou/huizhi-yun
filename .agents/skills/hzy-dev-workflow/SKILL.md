---
name: hzy-dev-workflow
description: Lightweight default workflow for day-to-day development in the huizhi-yun workspace. Use for implementing, debugging, reviewing local changes, or choosing validation scope when no heavier gstack workflow was explicitly requested.
---

# HZY Dev Workflow

Use this as the default lightweight project workflow. It is intentionally smaller than gstack and should not turn ordinary code work into a full QA, design-review, or ship process.

## Scope

- Start from the module named by the user or implied by touched files.
- Exclude `account/` by default unless the user explicitly names `account`, `account/`, legacy Account API, or asks for all modules including Account.
- In this multi-repo workspace, check git status in the relevant module repo before editing when the task may touch tracked files.
- Do not edit unrelated modules to “clean up” nearby issues.

## Context Loading

- Read root `CLAUDE.md` and the target module `CLAUDE.md`; do not pre-load broad docs.
- Use `rg` / `rg --files` for discovery before opening large files.
- Load docs only when the change touches that contract:
  - Foundation reuse: `docs/FOUNDATION_CAPABILITIES.md`
  - Cross-module API: `docs/MODULE_CONTRACTS.md`
  - Env/runtime policy: `docs/ENV_SIMPLIFICATION_PLAN.md`
  - Module schema/API docs when schema or API changes
- For Platform/Console deployment, runtime isolation, PM2, Cloudflare, diagnostics, or signing keys, switch to the relevant runbook/scripts before acting.

## Implementation Rules

- Prefer existing local helpers, patterns, and module boundaries.
- Keep changes narrow and directly traceable to the request.
- Do not add abstractions for single-use code.
- For tenant-runtime migrated modules, do not restore local DB repositories or DB fallback paths.
- New directory/auth/permission/service-token paths should go through Console, Platform policy bundle, and Foundation adapters.
- Cross-module writes/callbacks must use Console service tokens; do not add static secrets or shared webhook keys.

## Validation

- Match validation to risk:
  - Docs-only: no code test required; mention not run.
  - Narrow frontend or server change: run the module’s lint/typecheck or a focused test when practical.
  - Schema/API/cross-module/runtime change: run stronger checks and update docs.
- Use Browser/Chrome tools for local UI verification. Use gstack `/qa`, `/qa-only`, `/design-review`, or `/ship` only when the user explicitly asks for report-style QA, design audit, or shipping workflow.

## When Not To Use

- Use `nuxt-ui` for non-trivial Nuxt UI component/API work.
- Use GitHub plugin skills for PR/CI/GitHub issue work.
- Use Documents/Spreadsheets/Presentations plugin skills for those file types.
- Use gstack skills only for explicit heavy workflows: QA reports, design audits, plan reviews, shipping, retros, guard/freeze modes, or second-opinion reviews.
