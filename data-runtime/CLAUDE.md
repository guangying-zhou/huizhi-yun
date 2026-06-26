# data-runtime/CLAUDE.md

Tenant-runtime business API agent. Root-level guidance still applies.

## Module Role

`data-runtime/` is the Go implementation base for the customer-side
tenant-runtime business API runtime. The package name remains
`hzy-data-runtime` during the compatibility window.

Owns:

- Business API adapters under `/v1/<app>/**` for Finance, Workflow, WebDev,
  Assets, People, Altoc, Aims and Codocs.
- Runtime management endpoints such as `/runtime/healthz`,
  `/runtime/schema/status`, `/runtime/update` and update status.
- Database access for tenant-runtime migrated business modules.
- Standalone migration commands that need controlled access to source and
  target databases, such as WizBiz/OA incremental migration.

Does not own:

- Browser sessions, Console OIDC login, user-facing Nuxt pages or app BFF
  orchestration.
- Cross-application service-token issuance; Console issues tokens and the
  runtime verifies configured audiences/scopes.
- External integration secrets; those stay in Console integration config and
  vault.

## Boundary Rules

- This runtime is not a SQL-over-REST proxy. Add business endpoints that enforce
  module invariants instead of exposing generic table writes for complex flows.
- Tenant-runtime migrated Nuxt apps must not regain local DB repositories or DB
  fallback paths when an endpoint is missing. Add or extend the adapter here.
- Validate runtime auth before database work. `auth=disabled` is local
  development only; production/shared environments must use JWT or an explicit
  compatible static-token mode.
- Keep app adapters scoped to their app schemas. Cross-module writes belong in
  the caller app BFF plus target app service API contract, not direct database
  joins here.
- Migration commands must default to dry-run and require an explicit `--apply`
  or equivalent for writes.

## Commands

Run locally:

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
cp .env.example .env
go run ./cmd/hzy-data-runtime
```

Validate:

```bash
go test ./...
go test ./internal/apps/finance ./internal/apps/workflow
```

Package:

```bash
./scripts/package-release.sh 0.3.0
./scripts/upload-r2.sh 0.3.0
```

## Key Docs

- `README.md`
- `../docs/ADR-016-Tenant-Runtime-Business-API-Architecture.md`
- `../docs/Tenant-Runtime-API-Contract-v1.md`
- `../docs/Tenant-Runtime-Migration-Boundary-Status.md`
- `../docs/MODULE_CONTRACTS.md`

## Development Notes

- Finance, Workflow and WebDev are mature pilots; Assets, People, Altoc, Aims
  and Codocs use compatibility adapters for migration.
- App-specific complex operations should live in dedicated adapter files with
  transaction boundaries and idempotency where writes can be repeated.
- Keep response envelopes compatible with the consuming Nuxt app until the app
  contract is intentionally changed.
- When adding or changing app API behavior, update the app module docs and the
  relevant cross-module contract if other modules consume it.
