# connector-runtime/CLAUDE.md

Customer-side Enterprise Connector Runtime. Root guidance applies.

## Role

- Executes only compiled, versioned enterprise provider capabilities from a customer fixed egress.
- Uses Console JWT/introspection, Integration/Vault and the shared durable operation ledger.
- Keeps `/v1/notifications/send` compatible with Notification Runtime during explicit migration.
- Never accepts arbitrary URL, method, headers, scripts or provider plugins.
- Never connects directly to a business database; People/Directory writes must use the configured typed data-runtime API. Cross-server targets require HTTPS; loopback HTTP is allowed only for an explicit co-located deployment.

## Current phase

Phase 0–5 are implemented offline. The runtime advertises only the implemented, versioned notification,
identity, explicit People sync, job-read and aggregate-diagnostics capabilities under exact
`connector-runtime:*` scopes. Production activation still requires the controlled migration/seed,
Cloudflare/R2 release and real-provider acceptance sequence documented by the design and SLO runbook.

## Validation

```bash
cd ../notification-runtime
go test ./...
cd ../connector-runtime
node --test scripts/*.test.mjs
./scripts/package-release.sh
```

## Contracts

- `../memory/2026-07-14-enterprise-connector-runtime-design.md`
- `docs/Enterprise-Connector-Runtime-Migration.md`
- `../docs/MODULE_CONTRACTS.md`
