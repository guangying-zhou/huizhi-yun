# Platform install-command 503 debug report

Date: 2026-07-12

## Symptom

Tenant owner `C000001` received HTTP 503 from
`POST /api/platform/tenant-admin/deployment-settings/install-command` when
clicking **生成指令** in the production enterprise console.

The production response was:

```text
HZY_DATA_RUNTIME_APPROVED_VERSION must be an exact semantic version
```

## Root cause

The new tenant-runtime enrollment flow requires an approved immutable
data-runtime version and its Ed25519 release public key. The production
Cloudflare Worker did not have either binding. In addition,
`dataRuntimeReleaseSettings()` only read build-time Nuxt runtime config, so a
later Wrangler runtime binding was not guaranteed to be visible to the helper.

## Fix

- Resolve data-runtime release settings from request/global Cloudflare runtime
  bindings, then process environment and Nuxt runtime config.
- Set the production approved version to `0.3.96`, the package base URL, and the
  900-second enrollment TTL in `platform/wrangler.jsonc`.
- Upload the matching Ed25519 public PEM as Cloudflare Worker secret
  `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM`; private key material was not
  uploaded.
- Add a regression contract test for Cloudflare runtime binding resolution and
  keeping the PEM out of `wrangler.jsonc`.

## Evidence

- Production database contains all four tenant-runtime tables and all columns
  used by the enrollment transaction.
- `C000001/prod` has eight active tenant-runtime application deployments.
- Platform lint, typecheck, all 189 tests, Cloudflare build and dry-run passed.
- Production Worker deployment succeeded as version
  `1ff9d331-3836-4ba9-84f9-35eb70f74260`.
- `GET /api/v1/runtime/release-public-key` returns HTTP 200; its response header
  and PEM-derived SHA-256 key ID both equal the key ID in the 0.3.96 manifest.

## Status

DONE_WITH_CONCERNS: the configuration failure and public-key path are verified
fixed in production. The controlled Chrome session did not have an authenticated
enterprise-console session, so the final authenticated button click must be
repeated by the tenant owner after refreshing the page.
