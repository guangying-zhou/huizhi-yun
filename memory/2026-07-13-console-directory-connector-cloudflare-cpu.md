# Console directory connector Cloudflare CPU exhaustion

Date: 2026-07-13
Status: resolved and accepted in production with data-runtime 0.3.103

## Symptom

`hzy-data-runtime directory-connector` remained active but its three-second
poll repeatedly failed with HTTP 503 from:

```text
POST /api/v1/console/service/directory-connector/commands/lease
```

The LDAP connection test also failed while posting its sync result to Console.
Direct authentication with the same LDAP endpoint and Bind DN succeeded via
`ldapwhoami`.

## Root cause

Production Cloudflare tail events for Worker `hzy-console-prod` showed
`outcome=exceededCpu` and `Worker exceeded CPU time limit.` The lease request
reached a temporary marker immediately after service-token verification, then
exceeded the limit before completing the command lease. The request repeatedly
reported exactly 10 ms CPU time.

The test-triggered directory sync request used approximately 899 ms CPU time
before it was terminated. This means the connector workflow cannot reliably run
within the Workers Free 10 ms CPU allowance, even if the empty lease path is
micro-optimized.

An attempted deployment with `limits.cpu_ms=30000` was rejected by the
Cloudflare API with code `100328`:

```text
CPU limits are not supported for the Free plan.
```

LDAP host, LDAPS transport, Bind DN and password are not the cause.

## Resolution

The data plane was moved off Cloudflare instead of requiring a paid CPU tier:

- Directory Connector now leases/completes commands and submits LDAP sync data
  to a loopback-only Directory adapter in the tenant's data-runtime.
- The adapter owns the `hzy_console` database credential and performs local
  transactions; the separate Connector Linux user never receives that secret.
- Local calls use the enrolled Connector RSA key for PSS-SHA256 request
  signatures with tenant/deployment binding, timestamp and nonce replay checks.
- After a local commit, data-runtime submits only the PII-free subject and
  membership projection to Platform using its enrolled tenant Runtime Token.
- Cloudflare Console remains the control plane for enrollment, encrypted LDAP
  configuration, operation triggering and status display. Legacy service lease,
  complete and sync routes remain temporarily available for rollback only.
- The remaining encrypted configuration response is cached on the enterprise
  server as ciphertext only. Console refresh failure no longer blocks local
  sync or commands, and retries back off for five minutes rather than firing on
  every three-second poll. The cache also restores the connector id when an old
  installer configuration preserved `HZY_DIRECTORY_CONNECTOR_ID` as empty.
- Console now performs RSA-OAEP-SHA256 secret wrapping through Cloudflare Web
  Crypto instead of synchronous Node RSA, removing the main CPU-heavy step from
  the first configuration fetch before the local cache exists.

Increasing the old connector polling interval would only reduce request
frequency; it would not make the old lease or sync path fit the 10 ms limit.

Release/deployment evidence:

- `hzy-data-runtime 0.3.102` was signed, staged immutably, promoted to R2
  `latest`, and verified through the public download URLs.
- Platform approved runtime version was changed to `0.3.102` and production
  Worker version `76fd18a6-0370-4eba-8654-ca9173c7048b` was deployed.
- Platform `/api/health` returned HTTP 200 after deployment.
- Corrective release `hzy-data-runtime 0.3.103` is public `latest`; Platform
  production Worker `b02c907b-de0e-4445-9c49-0f0b0288db2f` approves 0.3.103.
- Console production Worker `c23622ad-e03e-4010-aa75-a8cda96809e0` uses native
  Web Crypto for Connector secret wrapping.
- Platform production Worker `2132d3bd-df02-447f-a8f2-86ab1296b2e3` added
  verification for enrolled instance runtime tokens (`hzy_dr_*`). The first
  tenant acceptance still returned 401 because enrollment had omitted the
  Console deployment from the instance deployment bindings.
- Platform production Worker `07f1e1a4-5024-47d0-a3db-63f44443ed28` fixes that
  binding model: Console is enrolled as a control-plane binding with
  `schema_ready/not_applicable`, remains subject to exact deployment-token
  verification, and is excluded from adapter schema heartbeat updates.
- The existing C000001 production instance was backfilled idempotently with its
  active `C000001-console` binding. No runtime token was rotated.

## Evidence

- Direct LDAP bind succeeded for `cn=Manager,dc=wiztek,dc=cn` over
  `ldaps://ldap.wiztek.cn:636`.
- Production Worker version `e76e0932-a3cc-4cfe-bce5-f2c7a1b7cd72` emitted the
  post-auth marker and then ended the lease request with `exceededCpu`.
- The directory sync request ended with `exceededCpu` after about 899 ms CPU and
  17.3 seconds wall time.
- Cloudflare rejected an explicit 30-second Worker CPU limit on the current Free
  plan with API error `100328`.
- Tenant acceptance completed on the next automatic Connector tick. Platform
  changed the Console deployment projection from `syncing` to `healthy`, kept
  119 subjects, and finalized 131 active runtime memberships. This proves all 25
  projection chunks passed runtime-token and exact deployment binding checks.

## Cleanup

The temporary stage markers were removed after diagnosis. No LDAP credential or
service token was logged or persisted in this report.
