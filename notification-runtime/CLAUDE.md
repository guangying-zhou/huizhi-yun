# notification-runtime/CLAUDE.md

Customer-side notification runtime. Root-level guidance still applies.

## Module Role

`notification-runtime/` is a Go runtime that gives Cloudflare-hosted business
apps a fixed customer-side egress path for notifications. The first phase sends
WeCom textcard notifications.

Owns:

- `/runtime/health` and notification send APIs.
- Verification of inbound Console service tokens for
  `aud=notification-runtime` and `scope=notification-runtime:send`.
- Reading Console integration config and resolving vault secrets through
  Console service-client credentials.
- Runtime packaging and update scripts for customer-side installation.

Does not own:

- Business notification decisions, recipient selection or workflow semantics.
- WeCom credentials as local plaintext app config; those belong in Console
  integration config and vault.
- Console service-client/grant governance; Console owns grants and issuance.

## Boundary Rules

- Business apps should call through Foundation notification helpers instead of
  direct runtime-specific HTTP code when possible.
- Do not add app-specific allowlists in this runtime for business
  authorization. The caller must present a valid Console service token.
- Keep integration access scoped to the requested `integrationCode`; do not
  expose generic credential reveal or resolve APIs.
- Production installs should use Console-generated commands and JWT auth.
  `auth=disabled` style development bypasses must stay local-only.

## Commands

Run locally:

```bash
cd /Users/gavin/Dev/huizhi-yun/notification-runtime
cp .env.example .env
go run ./cmd/hzy-notification-runtime
curl http://127.0.0.1:18081/runtime/health
```

Validate:

```bash
go test ./...
```

Package:

```bash
./scripts/package-release.sh
./scripts/upload-r2.sh
```

## Key Docs

- `README.md`
- `../docs/Notification-Runtime-Deployment.md`
- `../docs/Notification-Runtime-Tenant-Runbook.md`
- `../docs/MODULE_CONTRACTS.md`

## Development Notes

- Keep WeCom-specific mapping isolated so later channels can be added without
  changing the service-token contract.
- Error responses must not leak Console service-client secrets, resolved vault
  values or upstream private endpoint details.
