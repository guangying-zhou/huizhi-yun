# hzy-data-runtime

> Terminology note: ADR-016 upgrades the product architecture from
> `data-runtime` to `tenant-runtime`. This package remains named
> `hzy-data-runtime` during the compatibility window, but it is the current
> implementation base for the future tenant-runtime business API runtime.

Customer-side Data Runtime Agent PoC for ADR-014.

Connector Runtime 的钉钉 People 批次按“Directory 部门参照 → People 员工/任职事实 →
durable Directory lifecycle”处理。入职日期来自钉钉员工资料；离职只接受钉钉 HR 离职接口
给出的明确状态、最后工作日和原因。既有钉钉身份或唯一且无歧义的邮箱用于安全匹配；
当前/待离职新员工可以建立稳定本地 uid，未知历史离职人员不会反向创建 Directory 账号。

钉钉部门 ID 通过 Console `directory_department_identities` 映射到 canonical
`dept_code`；存量 `DT-*` 重复树通过 `directory_department_aliases` 归并。新部门使用
opaque `DPT-*` 编码，供应商 ID 不进入业务键。LDAP 遇到 People/HR 所有的人员事实时
只维护认证侧字段，不覆盖中文姓名、正式主部门、职位或在离职状态。每次组织批次记录
`last_snapshot_revision` 和规范化部门摘要；只有 final marker、根部门、部门计数与聚合快照 hash
全部吻合才冻结缺失差异。缺失数量/比例超过租户阈值或根部门变化时标记高风险，所有部门停用仍须
People 管理员逐项确认，并在事务中重新检查活跃主归属和未纳入子部门。

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
- `GET /runtime/schema/status?app=console`
- `GET /runtime/schema/status?app=console&mode=cutover`
- `GET /runtime/schema/status?app=finance`
- `GET /runtime/schema/status?app=workflow`
- `GET /runtime/schema/status?app=webdev`
- `GET /runtime/schema/status?app=assets`
- `GET /runtime/schema/status?app=people`
- `GET /runtime/schema/status?app=altoc`
- `GET /runtime/schema/status?app=aims`
- `GET /runtime/schema/status?app=codocs`
- `GET /v1/console/cutover/dispositions`
- `POST /v1/console/cutover/dispositions`
- `POST /v1/console/cutover/service-clients/{id}/retire`
- `POST /runtime/update`
- `GET /runtime/update/status`
- `GET|POST /v1/console/directory/hr-sources/dingtalk/department-mappings`
- `GET|POST /v1/console/directory/hr-sources/dingtalk/department-changes`
- `POST /v1/people/service/hr-source-sync/dingtalk/departments:remap`
- `GET|PATCH /v1/people/employees/{employeeUid}/private-profile`（People `employees/edit`，按员工数据范围校验；身份证号只返回掩码）
- `POST /v1/people/employee-private-profiles:import`（People BFF 的 OA CSV 预检/导入目标）

Console schema status is backed by the generated
`internal/apps/console/schema_manifest.json` embedded in the binary. Regenerate
it from `../console/docs/hzy_console_schema.sql` and verify drift before release:

```bash
node ../scripts/generate-console-runtime-schema-manifest.mjs
node ../scripts/generate-console-runtime-schema-manifest.mjs --check
```

The `mode=cutover` response additionally checks tenant/deployment bindings,
database least privilege, credential and signing-key pointers, stale receipts,
reliable-operation and notification backlogs, Directory export integrity, and
source-fingerprint-bound cutover dispositions. Dispositions preserve the
original failed records and become ineffective automatically when any relevant
source state changes. The verifier requires the exact `console.schema.read`
scope and is ready only when `status=ready` and `blockers=[]`.

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
  under `/v1/people/*`. Large employee filters use the read-only
  `POST /v1/people/employees:search` contract: department and employee ID lists
  are carried in the JSON body, while the BFF and Runtime authorize the request
  with `people.read` and apply the same employee-scope filtering and sensitive
  cost-field redaction as the list endpoint. Rank changes are accepted only by
  `POST /v1/people/assignments:change`; generic employee or assignment writes
  cannot set rank fields or create a `rank_change` fact.
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
  `POST /v1/aims/admin/projects/batch-create-routine` requires the same trusted
  system-admin marker and atomically creates/reuses the system routine portfolio,
  then idempotently creates one active routine project per Directory department
  and year with the supplied server-resolved manager and active member snapshot.
- Codocs: documents, folders, shares, versions, department shares, cabinet files
  and folders, legacy document-review reads, Workflow-backed publish requests,
  post-approval archive/seal/send/receive commands, dashboard counts, and
  collaboration context/version APIs under `/v1/codocs/*`. Publish flow
  definitions, routes, and nodes are owned by Workflow; the Codocs adapter owns
  only the transactional publication execution facts after Workflow approval.

The compatibility adapters deliberately return current Nuxt API-compatible
envelopes where the migrated app requires them. Codocs collaboration APIs use
`success`/`data` because they are consumed by Codocs/Collab server code first.
These adapters cover common CRUD/list/detail paths first. Module-specific
contracts cover selected workflow callbacks and post-approval publication
execution; OSS copying, import/export, and notification orchestration remain in
the application BFF.

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

## Signed Install / Upgrade

The release public key is provisioned independently from R2. Download the
installer and detached signature, verify them locally, then run the verified
file. Do not pipe an unverified remote installer directly into a root shell:

```bash
curl -fsSLO https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh
curl -fsSLO https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh.sig
openssl pkeyutl -verify -rawin -pubin \
  -inkey /secure/release-signing-public.pem \
  -in install.sh \
  -sigfile install.sh.sig
sudo bash ./install.sh \
  --release-public-key /secure/release-signing-public.pem
```

Pin a specific version:

```bash
curl -fsSLO https://downloads.huizhi.yun/packages/hzy-data-runtime/0.2.8/install.sh
curl -fsSLO https://downloads.huizhi.yun/packages/hzy-data-runtime/0.2.8/install.sh.sig
openssl pkeyutl -verify -rawin -pubin \
  -inkey /secure/release-signing-public.pem \
  -in install.sh \
  -sigfile install.sh.sig
sudo bash ./install.sh \
  --release-public-key /secure/release-signing-public.pem \
  --version 0.2.8
```

On first install, the installer prompts for the shared database host, port,
user, password, and each enabled app adapter database name. It runs a database
connectivity check before writing `/etc/hzy-data-runtime/.env`.
Platform-generated installs use `HZY_DATA_RUNTIME_ENROLLMENT_CODE` rather than
placing a long-lived runtime token in the copied command. After the local
database check succeeds, the signature-verified binary redeems the code once,
stores the returned runtime/control credentials with the local `0600` config,
and discards the enrollment code. The Agent then reports its signed release
version, key ID, database readiness and per-app schema status to Platform.
Later upgrades keep the existing database settings unless `--reconfigure` is
passed, but Platform-provided activation variables such as
`HZY_DATA_RUNTIME_STATIC_TOKEN` and `HZY_*_AGENT_ENABLED` are synchronized when
they are present in the install command.
The installer also enables `hzy-data-runtime-update.timer` by default. The
timer runs every 5 minutes and executes `hzy-data-runtime update`, which checks
the R2 `latest` pointer, downloads the exact-version manifest, verifies its
detached signature plus the selected archive signature and SHA-256, replaces
the binary, and restarts `hzy-data-runtime.service` when a newer version exists.
The installer also writes and enables `hzy-data-runtime-update-request.path`.
When Console calls `POST /runtime/update`, the running `hzy-data-runtime`
process writes `/etc/hzy-data-runtime/update-request.env`; systemd then runs
the root-owned update request service so the HTTP process does not need write
permission to `/opt/hzy-data-runtime`.
Servers installed before `0.2.7` should run the installer once to install the
timer; later updates are handled by the timer.

For non-interactive installation, first verify `install.sh` as shown above,
then pass the initial config to that local verified file:

```bash
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
    HZY_CONSOLE_RUNTIME_ENABLED=true \
    HZY_CONSOLE_DB_NAME=hzy_console \
    HZY_CONSOLE_VAULT_MASTER_KEY='<existing-customer-vault-key>' \
    bash ./install.sh \
      --release-public-key /secure/release-signing-public.pem
```

`HZY_DATA_RUNTIME_DB_HOST` / `PORT` / `USER` / `PASSWORD` /
`CONNECTION_LIMIT` are the default database connection parameters for all
enabled app adapters. Only set `HZY_FINANCE_DB_HOST` or
`HZY_WORKFLOW_DB_HOST` / `HZY_WEBDEV_DB_HOST` / `HZY_ASSETS_DB_HOST` /
`HZY_ALTOC_DB_HOST` / `HZY_AIMS_DB_HOST` / `HZY_CODOCS_DB_HOST` /
`HZY_CONSOLE_DB_HOST` and related
per-app variables when an app needs a different database connection.

`HZY_CONSOLE_RUNTIME_ENABLED=true` enables `/v1/console/**` and makes the
Runtime the owner of the tenant `hzy_console` credential. When Directory
Runtime is also enabled, `HZY_CONSOLE_DB_*` and `HZY_DIRECTORY_DB_*` must
resolve to the same values; both adapters then share one connection pool.
`HZY_CONSOLE_VAULT_MASTER_KEY` is customer-held Runtime configuration. During
migration it must be the same key that produced existing `db_encrypted`
Vault rows; once Vault and all resolve callers are Runtime-only, remove this key
from Console/Worker/PM2 configuration. It is never supplied by Platform
activation metadata or returned by health/schema endpoints.

For managed Cloudflare deployments, `HZY_DATA_RUNTIME_STATIC_TOKEN` must be
generated by the platform and included in the tenant's install command. The
tenant does not configure Cloudflare secrets directly. If no token is provided
while `HZY_DATA_RUNTIME_AUTH_MODE=static_token`, the installer stops before
writing `.env`.

Tunnel configuration is intentionally not handled by this installer yet.

Reconfigure database settings on an installed server:

```bash
sudo bash ./install.sh \
  --release-public-key /secure/release-signing-public.pem \
  --reconfigure
```

Disable automatic updates during install:

```bash
sudo bash ./install.sh \
  --release-public-key /secure/release-signing-public.pem \
  --no-auto-update
```

Manual update check:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime update
```

Manual rollback is a preview by default. It verifies both binaries and prints
their SHA-256 digests without changing files or restarting the service:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime rollback
```

After reviewing the digests and change approval, explicitly execute the binary
swap and service restart:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime rollback \
  --execute \
  --confirm hzy-data-runtime.previous \
  --change-id <approved-change-id>
```

The command swaps `hzy-data-runtime` and `hzy-data-runtime.previous`, so the
former current version remains available for a forward restore. If the rolled
back binary fails to restart, the command swaps the original version back and
tries to restore the service. This operation changes runtime binaries only; it
does not modify or roll back any application database or business master data.

All installer, timer, API update, manual update, and rollback operations share
one execution lock. API updates accept only an exact semantic version; package
origin, install directory, service name, restart, and force behavior are
server-owned and cannot be overridden by the HTTP request. Cross-process status
is persisted in `/etc/hzy-data-runtime/update-journal.json` with mode `0600`.
When a privileged timer or request executor recreates a missing journal, the
file inherits the config directory owner so the unprivileged Agent remains
able to inspect it. Operators should quarantine a corrupt journal rather than
editing it in place; the next release operation will create a fresh document
while the quarantined copy remains available for audit.
Ordinary installer, timer, API, and manual updates refuse semantic-version
downgrades; only the guarded `rollback --execute` workflow may move to an older
binary.

Inspect the effective automatic-update state. `effectiveState=pinned` is
reported only when both the policy and installed timer unit are policy-aware:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime auto-update status
```

Pin before an approved release or rollback. Pin is idempotent and installer
reruns preserve it:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime auto-update pin \
  --change-id <approved-change-id> \
  --confirm pin:<approved-change-id>
```

Installer reruns preserve a pinned policy, but reconcile every unpinned policy
to the install command's current tracking/disabled state and target version.
This prevents a stale timer policy from reverting a newly installed release.

Restoring tracking is a separate approved action; rollback never performs it:

```bash
sudo /opt/hzy-data-runtime/hzy-data-runtime auto-update unpin \
  --state tracking \
  --target-version latest \
  --change-id <approved-change-id> \
  --confirm unpin:<approved-change-id>:tracking:latest
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

Create the long-lived Ed25519 release key pair once in an access-controlled
directory. The generator refuses to overwrite either key and prints only the
public key ID, never private material:

```bash
./scripts/generate-release-signing-key.sh /secure/hzy-data-runtime-release
```

Back up the private key through the approved secret-management process. Put the
public PEM into Platform `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM` (literal PEM,
`\n`-escaped PEM, or `base64:<PEM-base64>`); only the
private file path is supplied to the packaging environment.

The workspace `./update_dr.sh` wrapper validates that private key before
running tests or changing `VERSION`. It previews immutable staging and channel
promotion separately, parses each `confirmationSha256`, and passes that exact
digest to the matching execution command automatically. The lower-level upload
script still rejects an execution whose digest differs from its preview plan.

`HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE` stores the private key's file path,
not the private key itself. A shell `export` is local to that shell session, so
opening a new terminal or rebooting the workstation requires exporting it
again. Otherwise `./update_dr.sh` exits with
`HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE is required before tests or VERSION changes`.

```bash
cd /Users/gavin/Dev/huizhi-yun
export HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE="$HOME/Dev/secure/hzy-data-runtime-release/release-signing-private.pem"
./update_dr.sh
```

The wrapper builds and publishes `linux/amd64` by default. Add
`--linux-arm64` (or `--linux-arm64=true`) when the release also needs the
`linux/arm64` artifact:

```bash
./update_dr.sh --linux-arm64
```

On a dedicated release workstation, the same `export` line may be added to
`~/.zshrc`; run `source ~/.zshrc` in an already open terminal. Persist only the
file path, never private key material, and keep the private key mode at `0600`
or `0400`.

If staging or promotion is interrupted after the immutable package was created,
resume that exact package instead of packaging the same version again:

```bash
cd /Users/gavin/Dev/huizhi-yun
export HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE="$HOME/Dev/secure/hzy-data-runtime-release/release-signing-private.pem"
./update_dr.sh --resume
```

Resume mode verifies the manifest version and signing-key ID before continuing.
It then repeats the safe stage preflight and promotion flow; already staged
objects must match the local SHA-256 hashes exactly.

Every published build that should be picked up by auto-update must increment
`VERSION`. Agents compare their local runtime version against
`latest/version.txt`; republishing different bits under the same version will not
trigger an automatic client update.

```bash
cd /Users/gavin/Dev/huizhi-yun/data-runtime
HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE=/secure/release-signing-private.pem \
  ./scripts/package-release.sh 0.3.0
./scripts/upload-r2.sh 0.3.0 --stage
```

Packages are written to an immutable
`build/packages/hzy-data-runtime/<version>/` directory. The version directory
contains the selected architecture archives, checksums, manifest, release inventory,
detached Ed25519 signatures, and the installer used for that exact release.
The signing private key is never copied into the package or uploaded to R2;
manifest `keyId` is the SHA-256 fingerprint of the independently provisioned
public key. Repackaging an existing version with different hashes fails without
changing the existing directory.

R2 publication is deliberately split into two confirmed actions. Both commands
default to preview and make no Wrangler or network calls. First review and stage
the immutable version directory using the printed `confirmationSha256`:

```bash
./scripts/upload-r2.sh 0.3.0 --stage
./scripts/upload-r2.sh 0.3.0 --stage \
  --execute --confirm '<stage-preview-sha256>'
```

Stage inspects every existing remote version object before the first write. It
skips identical objects and refuses to overwrite any object whose hash differs.
After staging, an exact-version install or rollback can use the installer
frozen with that release instead of the mutable channel installer:

```bash
curl -fsSL \
  https://downloads.huizhi.yun/packages/hzy-data-runtime/0.3.0/install.sh \
  | sudo bash -s -- --version 0.3.0
```

After the pinned package has been verified, preview and confirm promotion:

```bash
./scripts/upload-r2.sh 0.3.0 --promote
./scripts/upload-r2.sh 0.3.0 --promote \
  --execute --confirm '<promote-preview-sha256>'
```

Promotion verifies the complete pinned version again, uploads the mutable
`latest` aliases, and writes `latest/version.txt` last. A failure before that
final pointer write does not activate the new auto-update version. The default
command uses `pnpm dlx wrangler@4.110.0`; `WRANGLER_BIN` is reserved for an
explicitly reviewed executable or test double. The public installer URL remains
`https://downloads.huizhi.yun/packages/hzy-data-runtime/install.sh` after a
successful promotion.

Wrangler may report an uploaded multipart object as missing during remote read
verification even while the public R2 domain serves it correctly. For the pinned
Wrangler path, the script falls back only for that missing-object response to
downloading the same key from `HZY_R2_PUBLIC_BASE_URL`, then applies the normal
SHA-256 comparison. Set `HZY_R2_PUBLIC_VERIFY_FALLBACK=0` to disable this
fallback. Injected `WRANGLER_BIN` commands never use it.

The local release-chain regression suite uses fake Go and Wrangler executables
and never contacts R2:

```bash
node --test scripts/release-scripts.test.mjs
```

For Cloudflare Tunnel mode, expose only the local Agent port to `cloudflared`;
do not expose the database port to the public internet.

## Directory Connector

The signed `hzy-data-runtime` package also contains an optional outbound
Directory Connector. The installer runs it as a separate
`hzy-data-runtime-directory.service` with its own unprivileged Linux user and
private RSA-3072 key. It does not open an inbound port and it does not receive
any database credential. Directory database access is owned by a Directory
adapter in the main data-runtime process (`HZY_DIRECTORY_RUNTIME_ENABLED=true`,
database default `hzy_console`).

Platform-generated tenant install commands enable and enroll the connector
automatically. The install command pins the Platform Ed25519 signing key in the
protected Runtime environment. Enrollment verifies the original signed payload,
tenant, Console deployment, validity window and single-use `jti` inside
data-runtime, then atomically registers the Connector RSA-3072 public key. It
returns only connector identity and never issues a Console OAuth credential.

After enrollment, configuration reads, command leasing, command completion and
LDAP sync payloads all use the loopback-only data-runtime API. Every local
request is signed with the Connector RSA key and bound to its enrolled tenant
and Console deployment. Runtime resolves the customer-side Vault Secret and
returns only RSA-OAEP-SHA256 ciphertext to the Connector. The main runtime
applies Directory mutations locally and submits only the minimal PII-free
subject/membership projection to Platform. This keeps LDAP scanning, Secret
resolution, per-user SQL work and the three-second command poll outside
Cloudflare Workers.

The Connector persists its connector id and the RSA-encrypted configuration in
`/etc/hzy-data-runtime/directory/state-cache.json` (mode `0600`). It never stores
the decrypted LDAP bind password. A temporary Console outage therefore does not
stop already queued synchronization or directory commands; local configuration
retries use a five-minute backoff instead of the command poll interval.

The connector supports:

- OpenLDAP and Active Directory over LDAPS or StartTLS.
- User synchronization only after an authorized administrator explicitly clicks
  the LDAP sync action; startup and periodic ticks never scan LDAP.
- Idempotent LDAP user creation from Console Directory management.
- Self-service password changes from Console Profile after verifying the
  current LDAP password.

The LDAP bind password remains encrypted in Console Vault. Initial, current and
new user passwords are never stored as plaintext in Console tables or connector
logs; durable operation rows contain ciphertext only.
