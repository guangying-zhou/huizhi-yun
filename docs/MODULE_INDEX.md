# Module Index

This workspace keeps a monorepo-like working tree while many modules remain
independent git repositories. Use this index to choose the right module, command
and validation scope before editing.

## Workspace Notes

- `account/` is listed for orientation, but is excluded by default.
- `insights/` is an independent module and currently not included in
  `pnpm-workspace.yaml`; use `pnpm --dir insights ...`.
- `data-runtime/` and `notification-runtime/` are Go runtimes tracked by the
  root repository, not pnpm workspace packages.
- Root search can miss module files because module directories are ignored by
  the root gitignore. Search inside the target module.

## Modules

| Directory | Role | Port | Git owner | Workspace | Data path | Common commands | Key docs |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| `platform/` | Control plane for tenants, subscriptions, deployments, license and policy bundle governance | 3011 | independent | yes | Platform DB | `pnpm --dir platform dev`, `lint`, `typecheck`, `test` | `platform/CLAUDE.md`, `HZY-Platform-SQL-DDL-Draft-v2.sql` |
| `console/` | Customer-side base runtime: directory, auth, settings, integration config, vault and collab embedding | 3000 | independent | yes | `hzy_console` | `pnpm --dir console dev`, `lint`, `typecheck`, `test` | `console/CLAUDE.md`, `Console-API-Contract-v1.md` |
| `foundation/` | Shared Nuxt layer for auth, directory, permissions, workflow proxy, integrations and UI | - | root | yes | no app DB | `pnpm --dir foundation lint`, `typecheck`, `test` | `foundation/CLAUDE.md`, `FOUNDATION_CAPABILITIES.md` |
| `codocs/` | Collaborative documents and knowledge management | 3001 | independent | yes | Tenant-runtime migration; OSS content via BFF | `pnpm --dir codocs dev`, `lint`, `typecheck` | `codocs/CLAUDE.md`, `codocs/docs/` |
| `collab/` | Realtime collaboration runtime, embedded by Console by default | 3021 | independent | yes | Codocs tenant-runtime APIs | `pnpm --dir collab dev`, `typecheck`, `build` | `collab/CLAUDE.md`, `Collab-Runtime-Architecture.md` |
| `workflow/` | Generic approval workflow engine | 3020 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir workflow dev`, `lint`, `typecheck`, `test` | `workflow/CLAUDE.md`, `Console-Workflow-Runtime-Integration-Plan.md` |
| `aims/` | Product and project delivery management | 3002 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir aims dev`, `lint`, `typecheck` | `aims/CLAUDE.md`, `AIMS-Integration-and-Authorization-Implementation-Plan.md` |
| `altoc/` | LTC commercial contracts and fulfillment | 3003 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir altoc dev`, `lint`, `typecheck`, `test` | `altoc/CLAUDE.md`, `altoc/docs/` |
| `assets/` | Assets, resources, products and delivery instance management | 3004 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir assets dev`, `lint`, `typecheck`, `test` | `assets/CLAUDE.md`, `assets/docs/` |
| `finance/` | Operating finance, invoices, receipts, expenses and project accounting | 3006 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir finance dev`, `lint`, `typecheck` | `finance/CLAUDE.md`, `finance/docs/` |
| `people/` | People facts, assignments, costs, contribution and performance snapshots | 3007 | independent | yes | Tenant-runtime/data-runtime | `pnpm --dir people dev`, `lint`, `typecheck` | `people/CLAUDE.md`, `People-Module-Design-and-Implementation-Plan.md` |
| `align/` | Optional deep organization collaboration module | 3008 | independent | yes | module DB / planned integration | `pnpm --dir align dev`, `lint`, `typecheck` | `align/CLAUDE.md`, `align/docs/` |
| `insights/` | Repository analysis and development metrics | 3009 | independent | no | local MySQL + Python backend | `pnpm --dir insights dev`, `lint`, `typecheck`, `test` | `insights/CLAUDE.md`, `insights/docs/` |
| `webdev/` | Remote development agent control console | 3090 | independent | yes | WebDev adapter in data-runtime | `pnpm --dir webdev dev`, `lint`, `typecheck`, `test` | `webdev/CLAUDE.md`, `WebDev-PoC-Runbook.md` |
| `data-runtime/` | Go tenant-runtime business API agent deployed near customer databases | 18080 | root | no | App adapter DBs | `go run ./cmd/hzy-data-runtime`, `go test ./...` | `data-runtime/CLAUDE.md`, `Tenant-Runtime-API-Contract-v1.md` |
| `notification-runtime/` | Go notification runtime with fixed customer egress | 18081 | root | no | Console integration/vault APIs | `go run ./cmd/hzy-notification-runtime`, `go test ./...` | `notification-runtime/CLAUDE.md`, `Notification-Runtime-Deployment.md` |
| `dev-agent/` | Local remote-development execution agent used by WebDev | 19090 | root | no | local agent config | `go run ./cmd/hzy-dev-agent` | `ADR-015-WebDev-Remote-Development-Agent.md`, `webdev/README.md` |
| `account/` | Legacy Account facade and migration source | 3000 | independent | yes | legacy Account DB | only when explicitly requested | `account/CLAUDE.md`, `Account-Directory-Runtime-Refactor-Plan.md` |

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
