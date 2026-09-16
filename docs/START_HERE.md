# Start Here

Use this page as the first routing point for Codex and human maintainers. Keep
long plans and history in their existing documents; this page only tells you
where to look next.

## First Checks

- Read root `CLAUDE.md` first, then the target module's `CLAUDE.md`.
- Default to excluding `account/` unless the task explicitly names Account or
  legacy Account API.
- This is a Git monorepo. Check root status and use path-scoped diffs for the
  module you will edit.
- All module files are visible to root search; use explicit paths when a task
  should remain module-local.

## Task Routing

| Task type | Read first | Then read if needed |
| --- | --- | --- |
| Module-local UI/API change | Root `CLAUDE.md` + target module `CLAUDE.md` | Module `docs/`, local components, local server utils |
| Non-trivial Nuxt UI work | Root `CLAUDE.md`, target module `CLAUDE.md`, project `nuxt-ui` skill | Existing pages/components in the target module |
| Cross-module API or callback | `MODULE_CONTRACTS.md` | Target app API docs, service grant SQL seeds, module manifests |
| Foundation helper or shared UI | `FOUNDATION_CAPABILITIES.md` | `foundation/CLAUDE.md`, relevant Foundation source |
| Env/runtime/secrets cleanup | `ENV_SIMPLIFICATION_PLAN.md` | Console/Platform runtime docs and scripts |
| Platform/Console deployment, PM2, Cloudflare, signing, diagnostics | `Platform-Console-Prod-Dev-Isolation-Plan.md` | Root `validate:*`, `probe:*`, `verify:*`, `accept:*` scripts |
| Wiztek Keycloak / upstream OIDC / LDAP production operations | `Keycloak-Wiztek-Production-Configuration-Runbook.md` | `Identity-Plane-Design.md`, `console/docs/Console-Auth-Runtime-IdP-Implementation-Plan.md` |
| Tenant-runtime/data-runtime work | `data-runtime/CLAUDE.md` | `Tenant-Runtime-API-Contract-v1.md`, `Tenant-Runtime-Migration-Boundary-Status.md`, app adapter code |
| Console database removal / Console-to-runtime migration | `ADR-017-Console-Tenant-Data-Plane-Separation.md` | `console/docs/Console-Database-Split-and-Data-Runtime-Migration-Task-List.md`, `console/docs/Console-Database-Table-Inventory.md`, `console/docs/Console-Tenant-Runtime-API-Contract-v1.md` |
| Notification runtime work | `notification-runtime/CLAUDE.md` | `notification-runtime/docs/Notification-Runtime-Deployment.md`, `notification-runtime/docs/Notification-Runtime-Tenant-Runbook.md` |
| WebDev / remote dev agent | `webdev/CLAUDE.md` | `webdev/docs/WebDev-PoC-Runbook.md`, `ADR-015-WebDev-Remote-Development-Agent.md` |
| Current execution / September–October landing | `设计评审与落地执行计划-2026-09-05.md` | Root `NEXT.md`, `双月落地计划-2026-09-10.md`, linked acceptance evidence |
| Product roadmap / gap review | `设计评审与落地执行计划-2026-09-05.md` | `Huizhi-yun-Integrated-Operations-Roadmap.md`, `Implementation-Backlog.md`, module plans; check each document's evidence date |
| AIMS product center implementation | [`Aims-Product-Center-Implementation-Plan.md`](../aims/docs/Aims-Product-Center-Implementation-Plan.md) | Product workspace, discovery, priorities, roadmap and releases; follow [implementation evidence](../aims/docs/Aims-Product-Center-Implementation-Status.md) for actual progress |
| SME pilot landing priorities (2026-07) | `SME-Landing-Priority-Directions-2026-07.md` | Roadmap Phase 3–5 sections, module CLAUDE.md files |

## Validation Defaults

- Docs-only change: run Markdown/whitespace checks when practical; no code test
  required.
- Single module change: run `pnpm --dir <module> lint` and
  `pnpm --dir <module> typecheck` when the module has those scripts.
- Module with tests: also run `pnpm --dir <module> test`.
- Go runtime change: run `go test ./...` from the runtime directory.
- Cross-module/runtime/deployment change: add the relevant root `validate:*`,
  `probe:*`, `verify:*`, or `accept:*` script.

## Where Docs Live

- `docs/` (this directory): cross-module material only — ADRs, `MODULE_CONTRACTS.md`,
  product/architecture papers, UI conventions, tenant operation runbooks, end-user
  manuals under `user/`.
- `<module>/docs/`: documents owned by a single module (design, API spec, plans).
  Example: Console design contracts are in `console/docs/`, Platform schema papers
  in `platform/docs/`.
- `<module>/docs/sql/`: DDL / Migration / Seed / Verify scripts for that module's
  database. Console grant seeds live in `console/docs/sql/`; Platform control-plane
  scripts in `platform/docs/sql/`.
- `docs/sql/`: only tenant-specific operation scripts that belong to no single module.

Inside a module's own `CLAUDE.md` / `README.md`, a bare `docs/X` path means that
module's `docs/`. Use `../docs/X` to point at the repository-root `docs/`.

## Helpful Indexes

- End-user manuals (运营方 / 企业客户): `user/README.md`
- Module map: `MODULE_INDEX.md`
- Cross-module contracts: `MODULE_CONTRACTS.md`
- Foundation capabilities: `FOUNDATION_CAPABILITIES.md`
- UI/UX specification: `UI_UX_SPEC.md`（平台级前端规范）
- Environment cleanup plan: `ENV_SIMPLIFICATION_PLAN.md`
