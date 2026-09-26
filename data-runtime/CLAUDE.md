# data-runtime/CLAUDE.md

Tenant-runtime business API agent. Root-level guidance still applies.

## Module Role

`data-runtime/` is the Go implementation base for the customer-side
tenant-runtime business API runtime. The package name remains
`hzy-data-runtime` during the compatibility window.

Owns:

- Business API adapters under `/v1/<app>/**` for Finance, Workflow, WebDev,
  Assets, People, Altoc, Aims and Codocs.
- Console tenant-data adapters under `/v1/console/**`. The first migrated
  domain is `org-profile`; subsequent Console/Auth/Directory/Vault/Audit
  domains follow ADR-017 and must reuse the same customer-side Runtime
  database boundary.
- Runtime management endpoints such as `/runtime/healthz`,
  `/runtime/schema/status`, `/runtime/update` and update status.
- Platform enrollment redemption, per-app deployment bindings and coarse control-plane heartbeat; control credentials never authorize business APIs.
- Database access for tenant-runtime migrated business modules.
- Standalone migration commands that need controlled access to source and
  target databases, such as WizBiz/OA incremental migration.
- The optional `directory-connector` process, shipped in the same signed
  package but isolated as its own Linux user/systemd service. It performs
  outbound LDAP/AD sync, user creation and self-service password changes on
  commands leased from the local Directory adapter through an RSA-signed
  loopback contract; it has no Console OAuth or database credential.

Does not own:

- User-facing Nuxt pages or app BFF orchestration. During the ADR-017 migration,
  existing Console protocol facades may still terminate OIDC and browser
  cookies, but their durable Session/Token/Key state must move into the
  customer-side Auth Runtime rather than remain a Console DB exception.
- Platform policy, subscription, license or deployment governance.
  Console's already-verified policy snapshots can be persisted through
  `/v1/console/policy-bundle` in `policy_bundle_snapshots`; this does not move
  policy governance or evaluation into Runtime. Storage requires exact read/write
  capabilities, full service claims and current credential/grant validation.
  `internal/policyenvelope` verifies full Platform envelopes and persists current
  snapshots under transaction locks/CAS. The opt-in `/v1/console/verified-policy`
  requires strict JWT, explicit Console deployment and live credential/grant
  checks; `apps.console.policyEnvelope` defaults disabled. Its separate migration
  is not installed automatically or required by the legacy schema gate. GET may
  return expired/revoked state for synchronizer CAS recovery: consumers must check
  current validity/status, not treat HTTP 200 as authorization. `PUT /v1/console/verified-policy/renewal`
  records the syncer's Runtime-timed renewal outcome (`ok/platform_unavailable/
  refused/invalid`; refused/invalid are sticky per ETag) for the current ETag; GET returns it as `renewal` (null before its
  separate migration). It is metadata for the outage-grace rule, not a verdict. It does not upgrade
  legacy opaque rows; policy evaluation stays outside Runtime. The separately
  gated GET `/v1/enterprise/console-policy` retains Enterprise source/deployment,
  exact policy read scope and live grant checks, reads the registered Console
  row and verifies signed coverage of both deployments. No Enterprise policy
  writer exists. `enterpriseReadEnabled` defaults false; only the pinned local
  C000001 test Runtime enabled it on 2026-09-21. The hzy0 reader has exact read
  grants plus both audience mappings; this instance still only accepts its
  configured data-runtime audience. See the policy verification contract §12.
- Console steady service identity (R1): `POST /v1/console/auth/service-tokens/issue`
  also accepts a Console deployment key assertion, only while the Console
  envelope is valid or in outage grace and carries the key in `serviceKeys`;
  each `jti` is consumed once (optional `console_service_assertion_replay`).
  Other routes never accept it. See the policy verification contract §15.
- Exportable external integration secrets. The target Vault adapter keeps
  ciphertext and key operations customer-side; Directory Connector receives
  only RSA-OAEP encrypted command secrets and never a database credential.
- Platform-supplied Vault keys. `HZY_CONSOLE_VAULT_MASTER_KEY` is installed and
  held by the customer-side Runtime only; Platform enrollment and activation
  metadata must never carry, log, or return it.

## Boundary Rules

- This runtime is not a SQL-over-REST proxy. Add business endpoints that enforce
  module invariants instead of exposing generic table writes for complex flows.
- Tenant-runtime migrated Nuxt apps must not regain local DB repositories or DB
  fallback paths when an endpoint is missing. Add or extend the adapter here.
- Validate runtime auth before database work. `auth=disabled` is local
  development only; production/shared environments must use JWT or an explicit
  compatible static-token mode.
- Console OIDC service signing uses the Runtime's exact `deploymentBindings`
  for other application deployments, with matching `<app>.runtime` client,
  subject and source app. An explicit map must not fall back to `<tenant>-<app>`
  for missing or mismatched bindings; that naming fallback is legacy-only.
- Console's own service-token issuer uses its authenticated Console deployment
  in both source-binding modes; it must not invent `<tenant>-console` when the
  authenticated binding has a custom site/environment code.
- Existing unmigrated adapters keep their app-schema and service API contracts.
  The accepted [ADR-018](../docs/ADR-018-Unified-Enterprise-Application-and-Data.md)
  target permits scoped cross-domain queries, owning-domain service calls and
  shared transactions inside Runtime for explicitly migrated business paths.
  Follow the [implementation plan](../docs/Unified-Enterprise-Implementation-Plan.md)
  and update the actual API/identity/transaction contracts before switching paths;
  no current path is migrated by adding this documentation. Nuxt/BFF DB access,
  arbitrary cross-domain writes and tenant/actor authorization bypass remain disallowed.
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

AA-04 milestone callback coordination is opt-in via `enterprise.enableMilestoneReceivable` (default false). Only the authenticated Aims milestone-completion subtype is coordinated; the disabled setting preserves the legacy adapter. See the Runtime API contract and `docs/Unified-Enterprise-Altoc-Aims-Expansion.md` for strict service identity, exact capability and shared transaction requirements.

Codocs v2 snapshot routes (`/v1/enterprise/codocs/personal-documents:snapshot-{prepare,publish,read}`) are opt-in via `apps.codocs.snapshotV2Enabled` (default false). They reuse the exact personal-documents edit/read capabilities, verify bucket write-once retention and exact provider versions before publishing, and must not be enabled before the snapshot tables, Host writer, Collab epoch coordination and environment grant/retention checks are in place. See `docs/Codocs-Document-Write-Coordination.md`.
