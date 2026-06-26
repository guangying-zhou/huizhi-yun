# hzy-data-runtime

> Terminology note: ADR-016 upgrades the product architecture from
> `data-runtime` to `tenant-runtime`. This package remains named
> `hzy-data-runtime` during the compatibility window, but it is the current
> implementation base for the future tenant-runtime business API runtime.

Customer-side Data Runtime Agent PoC for ADR-014.

This package is the first implementation of the Data Runtime Agent contract.
Finance, Workflow, and the WebDev metadata adapter are the mature pilot
modules. Assets, People, Altoc, Aims, and Codocs now have compatibility adapters
for the tenant-runtime migration path. The Agent is intentionally a business API
runtime, not a SQL-over-REST proxy. It is implemented in Go so it can be shipped
as a single binary or a small Docker image on the customer's database server.

## Endpoints

Runtime:

- `GET /runtime/health`
- `GET /runtime/healthz`
- `GET /runtime/enrollment`
- `GET /runtime/schema/status?app=finance`
- `GET /runtime/schema/status?app=workflow`
- `GET /runtime/schema/status?app=webdev`
- `GET /runtime/schema/status?app=assets`
- `GET /runtime/schema/status?app=people`
- `GET /runtime/schema/status?app=altoc`
- `GET /runtime/schema/status?app=aims`
- `GET /runtime/schema/status?app=codocs`
- `POST /runtime/update`
- `GET /runtime/update/status`

Finance pilot:

- `GET /v1/finance/dashboard/summary`
- `GET /v1/finance/contracts/summaries?contractCodes=C001,C002`
- `GET /v1/finance/contracts/{contractCode}/summary`
- `GET /v1/finance/bank-accounts?showAll=true&keyword=...&status=active`
- `GET /v1/finance/bank-accounts/{code}`
- `GET /v1/finance/bank-accounts/balances`
- `GET /v1/finance/bank-accounts/balance-changes`
- `GET /v1/finance/bank-accounts/{code}/balance-snapshots`
- Finance ledger, request, settings, project accounting, performance, report,
  audit, approval-instance, reconciliation, approval callback, and mutation
  endpoints used by Finance Cloudflare Workers.

For approval submit endpoints, the Finance Worker creates the Workflow instance
first, then passes `workflowInstanceId` to the Agent so the Agent only owns the
business database update.

`migrations/wizbizdb/import` is intentionally not part of the normal managed
runtime path; run one-off imports from a controlled migration environment.

## WizBiz Incremental Migration

Use the standalone migration command for repeatable OA/WizBiz operating and
finance data imports. It runs in `data-runtime` because the source OA database
and target app databases are migration infrastructure, not Finance/Altoc Nuxt
server dependencies.

The command is safe to run as a dry-run by default:

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
go run ./cmd/wizbiz-incremental-migrate \
  --env .env \
  --since 2026-06-01 \
  --targets all
```

Apply the import only in a controlled migration window:

```bash
go run ./cmd/wizbiz-incremental-migrate \
  --env .env \
  --apply \
  --batch-code MIG_INC_20260624 \
  --since 2026-06-01 \
  --targets customers,contacts,contracts,contract-owners,bank-accounts,account-balances,invoices,receipts,unclassified-income,expenses,finance-summary
```

The command uses `legacy_source='wizbizdb'` plus source primary keys for
idempotent upserts. It also writes `legacy_migration_map` in Altoc and
`finance_migration_map` in Finance when `--apply` is used, then refreshes
`finance_contract_summary` so contract pages see updated invoice and receipt
amounts.

Environment variables:

- Source OA database: `HZY_WIZBIZ_DB_HOST`, `HZY_WIZBIZ_DB_PORT`,
  `HZY_WIZBIZ_DB_USER`, `HZY_WIZBIZ_DB_PASSWORD`, `HZY_WIZBIZ_DB_NAME`.
- Target default database connection: `HZY_DATA_RUNTIME_DB_HOST`,
  `HZY_DATA_RUNTIME_DB_PORT`, `HZY_DATA_RUNTIME_DB_USER`,
  `HZY_DATA_RUNTIME_DB_PASSWORD`.
- Target database names: `HZY_ALTOC_DB_NAME`, `HZY_FINANCE_DB_NAME`.

Supported targets:

- `customers`: `wb_organization` -> `hzy_altoc.customer`
- `contacts`: `wb_contactman` -> `hzy_altoc.contact`
- `contracts`: `wb_contract` -> `hzy_altoc.contract`
- `contract-owners`: backfill `hzy_altoc.contract.owner_user_id` from
  `wb_contract.employee_id`; unmapped employees fall back to `zhouguangying`
- `bank-accounts`: `wb_bank_account` -> `hzy_finance.finance_bank_account`
- `account-balances`: `wb_account_balance` ->
  `hzy_finance.finance_account_balance_snapshot`
- `invoices`: `wb_invoice` -> `hzy_finance.finance_invoice`
- `receipts`: contract-linked `wb_project_income` ->
  `hzy_finance.finance_receipt`
- `unclassified-income`: non-contract `wb_project_income` ->
  `hzy_finance.finance_unclassified_income`
- `expenses`: `wb_project_payment` -> `hzy_finance.finance_expense`
- `finance-summary`: refresh `hzy_finance.finance_contract_summary`

Workflow pilot:

- `POST /v1/workflow/action-defs/sync`
- `GET /v1/workflow/actions`
- `POST /v1/workflow/instances/prepare`
- `POST /v1/workflow/instances`
- `GET /v1/workflow/instances/{id}`
- `GET /v1/workflow/instances/by-biz`
- `GET /v1/workflow/instances/by-biz-history`
- `POST /v1/workflow/instances/{id}/cancel`
- `POST /v1/workflow/instances/{id}/resubmit`
- `GET /v1/workflow/tasks/pending`
- `GET /v1/workflow/tasks/done`
- `GET /v1/workflow/tasks/initiated`
- `GET /v1/workflow/tasks/{id}`
- `POST /v1/workflow/tasks/{id}/approve`
- `POST /v1/workflow/tasks/{id}/reject`
- `POST /v1/workflow/tasks/{id}/delegate`
- `/v1/workflow/admin/action-defs`
- `/v1/workflow/admin/flow-schemas`
- `/v1/workflow/admin/form-schemas`
- `/v1/workflow/admin/routes`

The Workflow Worker still owns login/session validation, Console directory
context collection, notification dispatch, and callback HTTP calls; the Agent
owns Workflow DB queries, route matching, instance persistence, task state
transitions, and admin configuration writes.

WebDev metadata pilot:

- `GET /v1/webdev/projects`
- `GET /v1/webdev/agents`
- `GET /v1/webdev/jobs?page=1&pageSize=20&status=running&keyword=...`
- `POST /v1/webdev/jobs`
- `GET /v1/webdev/jobs/{id}`
- `PATCH /v1/webdev/jobs/{id}`
- `POST /v1/webdev/jobs/{id}/events`
- `GET /v1/webdev/jobs/{id}/events`

WebDev Workers must use these fixed APIs for metadata persistence instead of
Hyperdrive or direct database connections. The schema is maintained in
`webdev/docs/webdev_schema.sql`.

Tenant-runtime compatibility adapters:

- Assets: `GET/POST /v1/assets/{resource}`, `GET/PATCH/DELETE
  /v1/assets/{resource}/{id}`, dashboard/report count endpoints, and nested
  read endpoints such as `/v1/assets/assets/{asset_id}/events`.
- People: employee facts, assignment changes, cost snapshots, performance
  cycles, contribution snapshots, dashboard overview, employee profiles,
  project people cost aggregation, contribution sync, and workflow callbacks
  under `/v1/people/*`.
- Altoc: customers, contacts, leads, opportunities, activities, quotes,
  contracts, invoices, payments, audit logs, config dictionaries, and dashboard
  count endpoints under `/v1/altoc/*`.
- Aims: projects, admin projects, portfolios, project members/repos/milestones,
  work items, comments, documents, requirements, deliverables, approvals,
  favorites, personal work item views, user time entries, and dashboard/workspace
  count endpoints under `/v1/aims/*`. Product version management is implemented
  in the Aims adapter with dedicated endpoints for project product bindings,
  releases, release items, release features, release ownership claims, and
  service-only product version summaries:
  `GET/POST /v1/aims/projects/{id}/products`,
  `PUT/PATCH/DELETE /v1/aims/projects/{id}/products/{productCode}`,
  `PUT /v1/aims/projects/{id}/products/{productCode}/primary`,
  `GET/POST /v1/aims/projects/{id}/releases`,
  `GET/PUT/PATCH/DELETE /v1/aims/projects/{id}/releases/{versionId}`,
  `POST /v1/aims/projects/{id}/releases/{versionId}/(claim|transition|items)`,
  `DELETE /v1/aims/projects/{id}/releases/{versionId}/items/{workItemId}`,
  `GET/POST /v1/aims/projects/{id}/releases/{versionId}/features`,
  `PUT/PATCH/DELETE /v1/aims/projects/{id}/releases/{versionId}/features/{featureId}`,
  and `GET /v1/aims/service/products/{productCode}/versions`. The generic
  work item compatibility resource intentionally denies direct writes to
  `version_id` and `feature_id`; those fields are written only through the Aims
  business adapter so project/product/version constraints are enforced.
  Requirement review batch actions are
  dedicated business endpoints:
  `POST /v1/aims/requirement-reviews/{id}/(approve|reject|withdraw|create-tasks|append-requirements)`
  (baseline/change versioning, status reverts, batch task generation; called by
  the Aims Nuxt-only handlers via `forwardAimsRuntimePost`). Other dedicated
  business endpoints: work-item breakdown/append/distribute confirmations,
  milestone review approval, requirement change targets/drafts/task creation,
  spec import, and GitLab commit ingestion
  (`GET /v1/aims/projects/{id}/gitlab-sync-context` +
  `POST /v1/aims/projects/{id}/gitlab-commits/ingest`; the GitLab API fetch
  itself stays in the Aims Nuxt server via Foundation integrations).
  Project deletion uses dedicated handlers
  (not the generic soft delete): `DELETE /v1/aims/projects/{id}` hard-deletes
  draft projects only and requires the caller to be a project manager or have
  `current_user_is_project_admin=1`; `DELETE /v1/aims/admin/projects/{id}`
  hard-deletes any status with a `confirmText` body matching the project code
  or name. Both cascade-delete all project-related rows in one transaction.
- Codocs: documents, folders, shares, versions, department shares, cabinet files
  and folders, review templates, document reviews, publish requests, dashboard
  counts, and collaboration context/version APIs under `/v1/codocs/*`.

The compatibility adapters deliberately return current Nuxt API-compatible
envelopes where the migrated app requires them. Codocs collaboration APIs use
`success`/`data` because they are consumed by Codocs/Collab server code first.
These adapters cover common CRUD/list/detail paths first; complex workflow,
OSS, import/export, and callback actions remain module-specific follow-up APIs.

## Run Locally

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
cp .env.example .env
/usr/local/go/bin/go run ./cmd/hzy-data-runtime
```

Then verify:

```bash
curl http://127.0.0.1:18080/runtime/health
curl -H 'Authorization: Bearer platform-provided-token' \
  http://127.0.0.1:18080/runtime/schema/status?app=finance
```

## One-line Install / Upgrade

Recommended server install and upgrade path:

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash
```

Pin a specific version:

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --version 0.2.8
```

On first install, the installer prompts for the shared database host, port,
user, password, and each enabled app adapter database name. It runs a database
connectivity check before writing `/etc/hzy-data-runtime/.env`.
Later upgrades keep the existing database settings unless `--reconfigure` is
passed, but Platform-provided activation variables such as
`HZY_DATA_RUNTIME_STATIC_TOKEN` and `HZY_*_AGENT_ENABLED` are synchronized when
they are present in the install command.
The installer also enables `hzy-data-runtime-update.timer` by default. The
timer runs every 5 minutes and executes `hzy-data-runtime update`, which checks
the R2 `latest` manifest, verifies the package checksum, replaces the binary,
and restarts `hzy-data-runtime.service` when a newer version exists.
The installer also writes and enables `hzy-data-runtime-update-request.path`.
When Console calls `POST /runtime/update`, the running `hzy-data-runtime`
process writes `/etc/hzy-data-runtime/update-request.env`; systemd then runs
the root-owned update request service so the HTTP process does not need write
permission to `/opt/hzy-data-runtime`.
Servers installed before `0.2.7` should run the installer once to install the
timer; later updates are handled by the timer.

For non-interactive installation, pass the initial config through
`sudo env ... bash`:

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | \
  sudo env \
    HZY_DATA_RUNTIME_PORT=18080 \
    HZY_DATA_RUNTIME_TENANT=tenant-code \
    HZY_DATA_RUNTIME_DEPLOYMENT=deployment-code \
    HZY_DATA_RUNTIME_STATIC_TOKEN='platform-provided-token' \
    HZY_DATA_RUNTIME_DB_HOST=127.0.0.1 \
    HZY_DATA_RUNTIME_DB_USER=cf_app \
    HZY_DATA_RUNTIME_DB_PASSWORD='change-me' \
    HZY_FINANCE_DB_NAME=hzy_finance \
    HZY_WORKFLOW_AGENT_ENABLED=false \
    HZY_WORKFLOW_DB_NAME=hzy_workflow \
    HZY_WEBDEV_AGENT_ENABLED=false \
    HZY_WEBDEV_DB_NAME=hzy_webdev \
    HZY_ASSETS_AGENT_ENABLED=false \
    HZY_ASSETS_DB_NAME=hzy_assets \
    HZY_PEOPLE_AGENT_ENABLED=false \
    HZY_PEOPLE_DB_NAME=hzy_people \
    HZY_ALTOC_AGENT_ENABLED=false \
    HZY_ALTOC_DB_NAME=hzy_altoc \
    HZY_AIMS_AGENT_ENABLED=false \
    HZY_AIMS_DB_NAME=hzy_aims \
    HZY_CODOCS_AGENT_ENABLED=false \
    HZY_CODOCS_DB_NAME=hzy_codocs \
    bash
```

`HZY_DATA_RUNTIME_DB_HOST` / `PORT` / `USER` / `PASSWORD` /
`CONNECTION_LIMIT` are the default database connection parameters for all
enabled app adapters. Only set `HZY_FINANCE_DB_HOST` or
`HZY_WORKFLOW_DB_HOST` / `HZY_WEBDEV_DB_HOST` / `HZY_ASSETS_DB_HOST` /
`HZY_ALTOC_DB_HOST` / `HZY_AIMS_DB_HOST` / `HZY_CODOCS_DB_HOST` and related
per-app variables when an app needs a different database connection.

For managed Cloudflare deployments, `HZY_DATA_RUNTIME_STATIC_TOKEN` must be
generated by the platform and included in the tenant's install command. The
tenant does not configure Cloudflare secrets directly. If no token is provided
while `HZY_DATA_RUNTIME_AUTH_MODE=static_token`, the installer stops before
writing `.env`.

Tunnel configuration is intentionally not handled by this installer yet.

Reconfigure database settings on an installed server:

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --reconfigure
```

Disable automatic updates during install:

```bash
curl -fsSL https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh | sudo bash -s -- --no-auto-update
```

Manual update check:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime update
```

## Auth

`HZY_DATA_RUNTIME_AUTH_MODE` supports:

- `disabled`: local development only.
- `static_token`: first Cloudflare Tunnel PoC.
- `jwt`: verifies `aud=data-runtime` or the configured tenant-runtime audience,
  tenant/deployment/app claims, scope, and JWKS from
  `HZY_DATA_RUNTIME_JWKS_URL` or `HZY_DATA_RUNTIME_JWKS_JSON`.

Workflow may receive Console-issued audience-scoped scopes such as
`data-runtime:workflow:read` / `data-runtime:workflow:write` or
`tenant-runtime:workflow:read` / `tenant-runtime:workflow:write`; these are
accepted as equivalents of the adapter's internal `workflow.read` /
`workflow.write` requirements.

In managed Cloudflare deployments, Platform owns tenant/deployment/runtime
metadata. `hzy-tenant-gateway` resolves the request host, injects the Agent
endpoint and static-token PoC credential into internal headers, and business app
Workers do not carry a global `HZY_DATA_RUNTIME_URL` / `HZY_DATA_RUNTIME_TOKEN`.
When Console service-token issuance for `aud=data-runtime` is ready, omit the
static token and the Worker will request a short-lived service token.

Finance Worker pilot configuration:

```bash
cd /Users/gavin/Dev/huizhi-yun/finance
HZY_DEPLOYMENT_PROFILE=managed-cloud-agent \
pnpm run cloudflare:config
```

## Package

Every published build that should be picked up by auto-update must increment
`VERSION`. Agents compare their local runtime version against
`latest/version.txt`; republishing different bits under the same version will not
trigger an automatic client update.

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
./scripts/package-release.sh 0.3.0
./scripts/upload-r2.sh 0.3.0
```

Packages are written to `build/packages/hzy-data-runtime` and uploaded to the
R2 bucket prefix `packages/hzy-data-runtime`. The public installer URL is
`https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh`.

For Cloudflare Tunnel mode, expose only the local Agent port to `cloudflared`;
do not expose the database port to the public internet.
