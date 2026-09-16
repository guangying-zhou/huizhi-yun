# Directory Connector enrollment returned HTTP 503

Date: 2026-08-23

## Symptom

Running the Platform-generated tenant Runtime installation command on
`C000001/prod` redeemed both the signed package and the one-time Runtime
enrollment code, updated `/etc/hzy-data-runtime/.env`, then failed before the
service restart:

```text
[hzy-data-runtime] directory connector enrollment failed:
Directory Connector enrollment returned HTTP 503
```

The shell used `set -e`, so the non-zero installer exit also closed the user's
interactive SSH session.

## Root cause

The failure was a chain of three state and sequencing defects:

1. Tenant Gateway did not attach a Platform-issued Runtime bootstrap token to
   the special `/directory-connector/**` proxy path. Console therefore could
   not exchange for its scoped Runtime service token.
2. A re-enrollment changed the previously healthy Runtime instance from
   `ready` to `enrolled`. Platform's tenant registry intentionally withholds the
   Runtime endpoint and bootstrap-token binding unless the Runtime and Console
   app binding are ready, so the next request failed with
   `Console tenant-runtime is required for tenant data access`.
3. The installer redeemed Directory Connector enrollment before restarting the
   main Runtime. The `.env` had the rotated control token and current Platform
   signing key, but the running process still held the old values. In addition,
   protected `platform-signing-key.json` and `deployment-bindings.json`
   overlays take precedence over `.env`; stale overlays could survive a simple
   restart. A valid Platform bootstrap JWT consequently fell through to the
   ordinary Console JWT/JWKS verifier and timed out or returned `invalid_jwt`.

The third defect is the direct installer-ordering root cause. The first two
defects masked it until the gateway and registry state were repaired.

## Production recovery

- Deployed the Tenant Gateway bootstrap-token forwarding fix as Worker version
  `4c432bf5-3324-4ee5-ac18-c0ef4deb4738`.
- Verified all nine Runtime app bindings were `schema_ready` or `active`, the
  public Runtime health endpoint was healthy, and current/desired versions were
  both `0.3.162`.
- Performed an exact guarded state repair for Runtime instance `1`, changing
  only `status=enrolled` to `status=ready`, and wrote audit action
  `tenant_runtime.status_repair`. No heartbeat was fabricated.
- Restarted only `hzy-data-runtime` on the tenant server so it loaded the
  rotated activation values. Its first successful heartbeat persisted the
  current protected signing-key overlay and triggered the expected automatic
  second restart.
- Both `hzy-data-runtime` and `hzy-data-runtime-directory` are active.

## Code fix

- Tenant Gateway now obtains and forwards a short-lived Runtime bootstrap token
  for Directory Connector enrollment.
- Runtime re-enrollment preserves an already-`ready` instance.
- Platform-generated install commands run inside a subshell so installer
  failure does not terminate the enclosing SSH shell.
- The Runtime installer now:
  - backs up protected control-plane overlays after successful re-enrollment;
  - starts the main Runtime and waits for health before redeeming the Directory
    Connector token;
  - restarts the isolated Connector only after enrollment succeeds;
  - rejects `--no-start` before consuming a Connector token when activation is
    required.

## Evidence

- Before recovery, an empty enrollment probe returned HTTP 503 with
  `Console tenant-runtime is required for tenant data access`.
- After the registry repair, the same request reached the public Runtime but
  timed out while the old process rejected Platform bootstrap trust.
- Tenant-server hashes proved `.env` and the running process differed for the
  control token, Platform signing Key ID, and public key.
- After restart and overlay convergence, Runtime audit logs recorded
  `console.auth.service_token.issue` with `status=200` and subject
  `platform:tenant-gateway`.
- The final no-token probe completed in 0.66 seconds with the expected HTTP 400
  `directory_connector_enrollment_token_required`, proving the complete
  Gateway -> Console -> Runtime path.
- Production registry reports `status=ready`, endpoint present, and
  `currentVersion=desiredVersion=0.3.162`.
- `bash -n deploy/install.sh`, all 14 release-script tests, and `go test ./...`
  passed.

## Related

- `memory/2026-07-12-platform-install-command-503.md`
- `memory/2026-07-22-platform-runtime-approval-stale-target.md`
- `memory/2026-07-23-console-data-runtime-update-bootstrap-token.md`

## Status

DONE_WITH_CONCERNS: production Runtime and the existing Directory Connector are
healthy, and the original 503 path is repaired. The failed one-time enrollment
code cannot be reused. If re-installation is still desired, generate a fresh
command after confirming it targets approved version `0.3.162`. The installer
ordering fix must be included in the next signed Runtime release before it is
available to other tenants.
