# G3 real HTTP harness input checklist

This directory contains only the tracked, non-secret six-process contract. The
harness is a local lifecycle/readiness foundation; it does not perform the G3
business transaction or produce acceptance evidence.

Before an executable preview can produce a confirmation digest:

- [ ] Build the current `data-runtime` source into
  `.local/g3-real-http/hzy-data-runtime`; record its SHA-256 in
  `HZY_G3_DATA_RUNTIME_BINARY_SHA256`.
- [ ] Create a local CA plus a server certificate valid for `127.0.0.1`; keep
  the private key mode at `0600` under `.local/g3-real-http/`.
- [ ] Start a loopback-only MySQL instance and import the current Console,
  Aims, and Altoc schemas/seeds into `hzy_console`, `hzy_aims`, and
  `hzy_altoc`. Provide the three reviewed seed SHA-256 receipts through the
  corresponding `HZY_G3_*_SEED_SHA256` variables.
- [ ] Seed active Console OIDC signing state, current Aims/Altoc service-client
  credentials, required grants, and tenant/deployment bindings.
- [ ] Provide only the fixed `HZY_G3_*` DB, service-client, and Gateway token
  variables listed by `G3_REQUIRED_ENVIRONMENT` in
  `scripts/g3-real-http-harness.mjs`; do not create `.env` or `.env.dev`.
- [ ] Run preview, review the six-process order and exact digest, then use
  `--execute --confirm <digest>` only for local process readiness.
- [ ] Keep every command in the foreground. The confirmation digest binds the
  PATH-resolved executable's canonical path and file SHA-256, plus the
  inherited dynamic-library environment without printing its values. Any
  executable, PATH, or dynamic-library change requires a new preview and
  confirmation. The supervisor terminates its own process groups on timeout or
  cancellation, but an application that deliberately daemonizes/double-forks
  out of that group is outside this local harness contract and must not be used.
- [ ] Add a separate, bounded callback for the real source-operation → target
  BFF → target runtime → receipt → source-checkpoint assertion before claiming
  G3 vertical acceptance. That callback is intentionally not implemented here.

The fixed startup order is Aims runtime, Altoc runtime, Console, Aims, Altoc,
then the HTTPS Tenant Gateway. Runtime readiness uses `/runtime/healthz`; the
three Nuxt modules currently have no dedicated readiness endpoint, so their
application shell HTTP 200 checks prove only that the local server is serving.
