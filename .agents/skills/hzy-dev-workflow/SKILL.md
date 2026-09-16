---
name: hzy-dev-workflow
description: Project routing and validation guidance for implementation, debugging, and code review in huizhi-yun.
---

# HZY Dev Workflow

Project implementation index. The root [CLAUDE.md](../../../CLAUDE.md), especially **Execution Style**, owns autonomy, clarification, authorization, scope, and completion. This skill adds project routing, not a second approval process.

## Context and Scope

- Start with the module named by the user or implied by the task; load missing root/module guidance and reuse unchanged context. A plan or backlog alone does not authorize implementation; honor existing user authorization for the requested items without asking again.
- Exclude `account/` under the root Scope Defaults. Necessary changes to other modules, Foundation helpers, contracts, callers, and tests belong to the task when required for its result.
- Inspect root Git status before editing; preserve existing work and use path-scoped diffs. A dirty tree alone is not a blocker.
- Use `rg` / `rg --files` before opening broad documents. Load only the relevant references:
  - Shared capabilities: `docs/FOUNDATION_CAPABILITIES.md`
  - Cross-module calls: `docs/MODULE_CONTRACTS.md`
  - Env/runtime policy: `docs/ENV_SIMPLIFICATION_PLAN.md`
  - Schema/API changes: the affected module's schema/API docs
  - Deployment, runtime isolation, PM2, Cloudflare, diagnostics, signing keys: the matching runbook/scripts

## Implementation and Validation

- Reuse existing helpers and module patterns. Root and module architecture/security rules apply; do not restore local DB fallbacks in tenant-runtime modules or invent parallel authentication paths.
- Use the smallest meaningful validation that covers the affected behavior. Consult module package scripts; narrow changes need focused checks, while authorization, runtime, schema/API and cross-module changes retain the required contract and regression coverage in CLAUDE.md.
- Reuse or extend existing tests where they prove the required invariants. Update documents whose facts changed; avoid creating duplicate tests or editing unchanged contracts merely to satisfy a checklist.
- For docs-only changes, inspect content, references and formatting; no application test is required.
- Root checks, when warranted, use `pnpm lint:active`, `pnpm typecheck:active`, and `pnpm test:active`. Codocs builds need `NODE_OPTIONS='--max-old-space-size=4096'`.
- Frontend validation follows the root Frontend section; choose browser interactions and viewport coverage for the behavior changed, and report unavailable validation accurately.
- Fix task-caused failures within scope. Deliver the requested result with evidence; distinguish implementation status, verification limits, and any pending authorized external action.

## Skill Composition and Git

- Use `nuxt-ui` when substantial component work or uncertain APIs need its guidance; it can also be used independently.
- Use an applicable specialist for Git hosting or document artifacts when it materially helps. Do not assume a specific provider or installed plugin.
- Use formal gstack QA, design/plan reviews, shipping, retrospectives, or guard/freeze workflows when requested; basic debugging, code review and browser verification do not require the whole workflow.
- When a commit is part of the requested workflow, operate in the root monorepo, include only relevant changes, and group commits logically under `docs/Git提交规范指南.md`. Reading this skill does not itself require a commit or push.
