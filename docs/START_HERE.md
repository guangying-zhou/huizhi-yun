# Start Here

Use this page as the first routing point for Codex and human maintainers. Keep
long plans and history in their existing documents; this page only tells you
where to look next.

## First Checks

- Read root `CLAUDE.md` first, then the target module's `CLAUDE.md`.
- Default to excluding `account/` unless the task explicitly names Account or
  legacy Account API.
- This is a multi-repo workspace. Many modules have their own `.git`; check git
  status in the module you will edit.
- Root `.gitignore` ignores module directories, so root-level `rg --files` can
  miss module files. Search inside the target module or use explicit paths.

## Task Routing

| Task type | Read first | Then read if needed |
| --- | --- | --- |
| Module-local UI/API change | Root `CLAUDE.md` + target module `CLAUDE.md` | Module `docs/`, local components, local server utils |
| Non-trivial Nuxt UI work | Root `CLAUDE.md`, target module `CLAUDE.md`, project `nuxt-ui` skill | Existing pages/components in the target module |
| Cross-module API or callback | `MODULE_CONTRACTS.md` | Target app API docs, service grant SQL seeds, module manifests |
| Foundation helper or shared UI | `FOUNDATION_CAPABILITIES.md` | `foundation/CLAUDE.md`, relevant Foundation source |
| Env/runtime/secrets cleanup | `ENV_SIMPLIFICATION_PLAN.md` | Console/Platform runtime docs and scripts |
| Platform/Console deployment, PM2, Cloudflare, signing, diagnostics | `Platform-Console-Prod-Dev-Isolation-Plan.md` | Root `validate:*`, `probe:*`, `verify:*`, `accept:*` scripts |
| Tenant-runtime/data-runtime work | `data-runtime/CLAUDE.md` | `Tenant-Runtime-API-Contract-v1.md`, `Tenant-Runtime-Migration-Boundary-Status.md`, app adapter code |
| Notification runtime work | `notification-runtime/CLAUDE.md` | `Notification-Runtime-Deployment.md`, `Notification-Runtime-Tenant-Runbook.md` |
| WebDev / remote dev agent | `webdev/CLAUDE.md` | `WebDev-PoC-Runbook.md`, `ADR-015-WebDev-Remote-Development-Agent.md` |
| Product roadmap / gap review | `Huizhi-yun-Integrated-Operations-Roadmap.md` | `Implementation-Backlog.md`, module plans |

## Validation Defaults

- Docs-only change: run Markdown/whitespace checks when practical; no code test
  required.
- Single module change: run `pnpm --dir <module> lint` and
  `pnpm --dir <module> typecheck` when the module has those scripts.
- Module with tests: also run `pnpm --dir <module> test`.
- Go runtime change: run `go test ./...` from the runtime directory.
- Cross-module/runtime/deployment change: add the relevant root `validate:*`,
  `probe:*`, `verify:*`, or `accept:*` script.

## Helpful Indexes

- Module map: `MODULE_INDEX.md`
- Cross-module contracts: `MODULE_CONTRACTS.md`
- Foundation capabilities: `FOUNDATION_CAPABILITIES.md`
- Environment cleanup plan: `ENV_SIMPLIFICATION_PLAN.md`
