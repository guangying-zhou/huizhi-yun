# Module Index

This workspace is a single Git monorepo. Use this index to choose the right module, command
and validation scope before editing.

The accepted consolidation target and phased TODO are in [ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md) and the [implementation plan](./Unified-Enterprise-Implementation-Plan.md). The module table below describes the existing layout, not a completed migration.

## Workspace Notes

- `account/` is listed for orientation, but is excluded by default.
- `insights/` is included in `pnpm-workspace.yaml`; module-local commands can
  still use `pnpm --dir insights ...`.
- `data-runtime/` and `notification-runtime/` are Go runtimes tracked by the
  root repository, not pnpm workspace packages.
- All modules share the root Git history. Use `<component>/vX.Y.Z` release Tags
  and path-scoped Git commands when inspecting a single module.

## Modules

| Directory | Role | Port | Git owner | Workspace | Data path | Common commands | Key docs |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `platform/` | Control plane for tenants, subscriptions, deployments, license and policy bundle governance | 3011 | monorepo | yes | Platform DB | `pnpm --dir platform dev`, `lint`, `typecheck`, `test` | `platform/CLAUDE.md`, `platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql` |
| `console/` | Customer-side base runtime: directory, auth, settings, integration config, vault and collab embedding | 3000 | monorepo | yes | `hzy_console` | `pnpm --dir console dev`, `lint`, `typecheck`, `test` | `console/CLAUDE.md`, `console/docs/Console-API-Contract-v1.md` |
| `foundation/` | Shared Nuxt layer for auth, directory, permissions, workflow proxy, integrations and UI | - | monorepo | yes | no app DB | `pnpm --dir foundation lint`, `typecheck`, `test` | `foundation/CLAUDE.md`, `FOUNDATION_CAPABILITIES.md` |
| `codocs/` | Collaborative documents and knowledge management | 3001 | monorepo | yes | Tenant-runtime migration; OSS content via BFF | `pnpm --dir codocs dev`, `lint`, `typecheck` | `codocs/CLAUDE.md`, `codocs/docs/` |
| `collab/` | Realtime collaboration runtime, embedded by Console by default | 3021 | monorepo | yes | Codocs tenant-runtime APIs | `pnpm --dir collab dev`, `typecheck`, `build` | `collab/CLAUDE.md`, `collab/docs/Collab-Runtime-Architecture.md` |
| `workflow/` | Generic approval workflow engine | 3020 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir workflow dev`, `lint`, `typecheck`, `test` | `workflow/CLAUDE.md`, `console/docs/Console-Workflow-Runtime-Integration-Plan.md` |
| `aims/` | Product and project delivery management | 3002 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir aims dev`, `lint`, `typecheck` | `aims/CLAUDE.md`, `aims/docs/AIMS-Integration-and-Authorization-Implementation-Plan.md` |
| `altoc/` | LTC commercial contracts and fulfillment | 3003 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir altoc dev`, `lint`, `typecheck`, `test` | `altoc/CLAUDE.md`, `altoc/docs/` |
| `assets/` | Assets, resources, products and delivery instance management | 3004 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir assets dev`, `lint`, `typecheck`, `test` | `assets/CLAUDE.md`, `assets/docs/` |
| `finance/` | Operating finance, invoices, receipts, expenses and project accounting | 3006 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir finance dev`, `lint`, `typecheck` | `finance/CLAUDE.md`, `finance/docs/` |
| `people/` | People facts, assignments, costs, contribution and performance snapshots | 3007 | monorepo | yes | Tenant-runtime/data-runtime | `pnpm --dir people dev`, `lint`, `typecheck` | `people/CLAUDE.md`, `people/docs/People-Module-Design-and-Implementation-Plan.md` |
| `align/` | Optional deep organization collaboration module | 3008 | monorepo | yes | module DB / planned integration | `pnpm --dir align dev`, `lint`, `typecheck` | `align/CLAUDE.md`, `align/docs/` |
| `insights/` | Repository analysis and development metrics | 3009 | monorepo | yes | local MySQL + Python backend | `pnpm --dir insights dev`, `lint`, `typecheck`, `test` | `insights/CLAUDE.md`, `insights/docs/` |
| `webdev/` | Remote development agent control console | 3090 | monorepo | yes | WebDev adapter in data-runtime | `pnpm --dir webdev dev`, `lint`, `typecheck`, `test` | `webdev/CLAUDE.md`, `webdev/docs/WebDev-PoC-Runbook.md` |
| `data-runtime/` | Go tenant-runtime business API agent deployed near customer databases | 18080 | monorepo | no | App adapter DBs | `go run ./cmd/hzy-data-runtime`, `go test ./...` | `data-runtime/CLAUDE.md`, `Tenant-Runtime-API-Contract-v1.md` |
| `notification-runtime/` | Go notification runtime with fixed customer egress | 18081 | monorepo | no | Console integration/vault APIs | `go run ./cmd/hzy-notification-runtime`, `go test ./...` | `notification-runtime/CLAUDE.md`, `notification-runtime/docs/Notification-Runtime-Deployment.md` |
| `dev-agent/` | Local remote-development execution agent used by WebDev | 19090 | monorepo | no | local agent config | `go run ./cmd/hzy-dev-agent` | `ADR-015-WebDev-Remote-Development-Agent.md`, `webdev/README.md` |
| `account/` | Legacy Account facade and migration source | 3000 | monorepo | yes | legacy Account DB | only when explicitly requested | `account/CLAUDE.md`, `Account-Directory-Runtime-Refactor-Plan.md` |

## Root Commands

Prefer module-local validation for implementation work. Use root commands for
workspace or runtime tasks:

```bash
pnpm lint:active
pnpm typecheck:active
pnpm test:active
pnpm dev-stack:local
pnpm dev-stack:local:status
pnpm dev-stack:local:logs
pnpm dev-stack:local:doctor
```

Use `lint:all` and `typecheck:all` only when the task intentionally includes
legacy `account/`.
