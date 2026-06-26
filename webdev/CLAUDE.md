# webdev/CLAUDE.md

Module-specific guidance for `webdev/`. Root-level guidance still applies.

## Module Role

`webdev/` is the ADR-015 remote development agent control console. It is a
tenant application based on `@hzy/foundation`.

Owns:

- WebDev console UI: overview, task workspace, issue inbox, diff review,
  deploy view, agent fleet and history.
- BFF routes under `/api/webdev/**` that authenticate Console users and proxy
  allowed operations to Dev Agent or data-runtime.
- File/image attachment upload routes that forward to Dev Agent without
  exposing the Dev Agent token to browsers.
- Issue intake APIs used by Foundation report helpers.

Does not own:

- Job metadata database writes directly; WebDev uses data-runtime
  `/v1/webdev/**` APIs.
- Dev Agent command execution internals; those belong to `dev-agent/`.
- Platform authorization governance; WebDev consumes Console/Foundation auth
  and app grants.

## Boundary Rules

- Keep `nuxt.config.ts` extending Foundation. Do not duplicate auth, layout or
  integration helpers already provided by Foundation.
- Production routes must require Console OIDC and app grants, except for a
  deliberate temporary `HZY_WEBDEV_ALLOWED_UIDS` bootstrap allowlist.
- Browser clients must never receive `HZY_WEBDEV_DEV_AGENT_TOKEN` or
  data-runtime credentials.
- Managed Cloudflare deployments must use `managed-cloud-agent`; do not bind
  Hyperdrive or add direct DB access.
- Metadata persistence goes through `hzy-data-runtime` WebDev adapter. If an
  endpoint is missing, add it to data-runtime rather than writing SQL here.

## Commands

```bash
pnpm --dir webdev dev
pnpm --dir webdev lint
pnpm --dir webdev typecheck
pnpm --dir webdev test
pnpm --dir webdev build:cloudflare
pnpm --dir webdev cloudflare:config
```

Local full flow usually needs `dev-agent/` first:

```bash
cd /Users/gavin/Dev/huizhi-yun/dev-agent
cp .env.example .env
go run ./cmd/hzy-dev-agent
```

## Key Docs

- `README.md`
- `../docs/WebDev-PoC-Runbook.md`
- `../docs/ADR-015-WebDev-Remote-Development-Agent.md`
- `docs/WebDev-Issue-Inbox-Design.md`
- `../data-runtime/CLAUDE.md`

## Development Notes

- UI work should follow the project Nuxt UI V4 patterns and the root frontend
  verification workflow.
- Issue notifications should go through Foundation `publishNotification()` and
  Console unified notifications.
- Keep example-data sections clearly separated from production-backed data
  paths until the backend capability exists.
