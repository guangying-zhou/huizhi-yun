# Local Enterprise test stack

## Local Console facade (2026-09-21; login/read chain verified, not G1)

Opt-in `identity.consoleFacadeMode: "local-canonical-facade"` adds the owned
`hzy0-console` Dev process on `127.0.0.1:23100`. Browser authentication uses
`https://hzy0.isme.dev/console`; canonical issuer stays `https://hzy-test.huizhi.yun`.
Private egress dials local Console without changing canonical backchannel names.
Only registered auth pages/resources are public; public token POST accepts Enterprise
code/refresh exchanges, never service credentials. Console receives the local Gateway
secret and formal short-lived Runtime bootstrap, not remote Gateway/Platform credentials
or signing keys. Runtime, Platform and Wiztek SSO remain dependencies; this is not offline auth.

Avatars: Foundation builds `/api/oss/avatar?path=…` on the current origin. Managed
gateways send that root path to Console (no Host session; G-12). With the local facade,
hzy0 mirrors only GET/HEAD `/api/oss/avatar` onto `/console/api/oss/avatar`; Console still
validates the object path (avatars/ prefix, no traversal, image types only).

SSO client `hzy_local_console` has the approved exact hzy0
`/console/api/auth/oidc-callback` and `/console/api/auth/oidc-post-logout` callbacks.
Original callbacks and other client settings are preserved.

**Historical blocker, now resolved locally:** browser SSO/code exchange completed, but session `policyVersion` was null
and Enterprise refused entry. Runtime policy integrity uses the existing Gateway key,
distinct from the local secret. Do not copy the remote key into Console, bypass HMAC,
or overwrite shared policy records with local signatures. Local policy failure now
returns 503 before token issuance. The 2026-09-21 contract audit confirmed the mismatch
against the real record: remote MAC, Platform signature and payload hash pass; local MAC
fails. Do not build a Gateway verification relay. The selected next implementation is a
versioned signed policy envelope plus Runtime-owned freshness/revision state, consumed
by the Console module inside Enterprise. See `docs/Console-Enterprise-Policy-Verification-Contract.md`.
The new signed-envelope chain now passes login, navigation and document-list reads;
full document write/collaboration and G1 validation remain outstanding. The optional diagnostic
`node deploy/test-env/local-enterprise/inspect-policy-contract.mjs --live-read` obtains a
short-lived exact read token (normal auth audit) and reads only the pinned test record;
it prints booleans/age, never secrets or policy bodies, and does not synchronize policy.

Policy sync (2026-09-22, outage-grace plan stage E): every minute the Gateway fetches the
Platform `hzy-policy-revision.v1` probe, and the full envelope only when the revision changed,
Console's stored envelope is due for renewal on this or the next wake (Console returns
`renewAfter` from each successful sync), the probe failed, or the previous wake failed. It always
wakes Console, even when Platform failed, so Console records `refused`/`platform_unavailable`.
The private egress serves `/__hzy0/platform-policy` and `/__hzy0/platform-policy-revision`;
authenticated Platform 4xx (except 408/429) keep their status and a sanitized code, everything
else becomes 503. The revision probe is opt-in (`HZY0_POLICY_REVISION_PROBE=true` in the
Gateway environment) and must stay off until the target Platform serves `hzy-policy-revision.v1`:
an older Platform routes the unknown format to its legacy bundle branch, which is slow and may
generate bundles. With the probe off, every wake prepares the full envelope as before.
For the local Workflow service authorization reads only, Console uses the separate exact
`/__hzy0/platform-policy-revision-live` private route. It fetches only the bounded revision
response and never consumes the scheduled wake's prepared response or fetches a full envelope.
Console fails closed if that probe is unavailable; the existing prepared-only envelope route
remains unchanged. The live probe has an 8-second Gateway deadline. The deployed development Platform must answer this revision query within the
interactive caller's timeout; a slow revision query keeps approvals unavailable rather than
authorizing against an unchecked cache.
The local Console runner adds `HZY_CONSOLE_LOCAL_WORKFLOW_DEPLOYMENT=C000001-test-workflow-local`
only when both Workflow and Runtime use pinned loopback listeners. For subject-eligibility
only, a trusted C000001 Console request may compare a signed `workflow` service actor against
that exact local deployment. Other applications keep the normal binding, wrong Workflow
deployments are refused, and no cloud Console process sets this override.
For local Aims project-document service reads, the runner also sets
`HZY_CONSOLE_LOCAL_AIMS_DEPLOYMENT=C000001-test-aims` only with the approved
loopback Workflow/Aims stack. Console retains its own verified-policy owner
context; the subject-scoped route selects the exact signed Aims caller binding
under the local facade, trusted Gateway, C000001 and pinned Console deployment
gates. The actor/binding equality check, fixed purpose registry and user/object
permissions remain enforced. Private egress admits only the exact Aims config
GET, `console:subject-authorization:read` token request and ten registered
project-document purposes with a strict subjectUid/purpose body. Cloud runners
never set this override. This does not install or change grants.

See `docs/Policy-Sync-Cadence-Assessment-20260922.md`.

Cutover preflight: `node deploy/test-env/local-enterprise/verified-policy-readiness.mjs --live-read`
checks the pinned local Runtime health/config, the public-key overlay and Console schema/grants
inside a read-only transaction. Optional `--service-probes` issues short-lived exact policy
tokens for both Runtime audiences (normal auth audit), reads the new route, and checks the
Platform format guard with a fixed nonempty version to prevent legacy on-demand generation.
It performs no policy writes, migration, grant update or process control. Partial failures
retain sanitized evidence; database grants are never reported as successful token probes.
The initial 2026-09-21 check found the old Runtime artifact, no new table/Enterprise read grant,
and the legacy Platform branch (§10). A subsequent explicit approval allowed only the development
Platform delivery/issuer update: published at 21:41 UTC, with public signature and dual-deployment
verification (§11). Production and other cloud apps were not deployed. The subsequent local
cutover (§12) installed a pinned Runtime, separate table, Enterprise read grant and its two
Runtime audience mappings. `identity.policyBackend: "verified-runtime"` selects the new
Console backend and Host gate. Gateway delivers only the fixed signed envelope through
the private `/__hzy0/platform-policy` egress; it never verifies on behalf of consumers.
The formal signed Console wake runs immediately and 120 seconds after each successful completion.
Failures retry after 15/30/60 seconds (capped), without overlap; success resets the delay.
Validity remains five minutes and failures do not extend it. This is a
writer for the separate new store, not another writer of legacy shared HMAC records.
Exact token probes, cross-identity rejection, real receipt replay and browser login/menu/
document-list evidence are recorded in the policy contract. The Runtime still pins its
configured data-runtime audience; successful alternate-audience issuance does not make
that token acceptable to this instance.
This local runbook itself does not authorize cloud publication.

Rollback: set `identity.policyBackend` to `runtime` and restore `identity.consoleFacadeMode` to `existing-canonical-console` in the
private profile and use CLI scoped restart for `gateway` and `enterprise`. This restores
the prior cloud dependency, not cloud availability. Also restart `console` if retaining
its local process; changing only the profile does not change a running child's backend.
The idle owned Console can remain
until controlled `down`; no shared Runtime/database/SSO change is required.

Current batch: LET-01–04 Dev chain with an approved product-edit exercise, not G1 release. The private
`gatewayInternal` port is fixed at 23121 in this phase and doctor rejects other
ports. `/enterprise` is the registered Host home; `/` and `/enterprise/` provide
GET/HEAD-only temporary redirects, while non-read methods are rejected.
Error mapping is an explicit reviewed code/status allowlist, with a 64 KiB bound,
fixed messages and constrained retry/cookie-clear headers. Unknown errors remain
redacted; register future write errors with their authorized use-case contract.
Unregistered 401/403/404 keep their status and get fixed codes
`authentication_required`/`permission_denied`/`not_found` (fixed messages, no upstream
text), so pages can show sign-in, no-permission and not-found states. Host
business outcomes at 400/409/410/412/422 in the Host error envelope (matching
`statusCode` + bounded snake_case `data.code`, e.g. Runtime 409
`weekly_reporting_period_required`) keep that code with the same fixed per-status
message the Host itself renders on managed/self-hosted ingress
(`foundation/shared/utils/enterpriseBusinessError.ts`); other statuses still fall
back to `hzy0_upstream_error`.

The icon GET allowlist accepts `/api/_nuxt_icon/<collection>.json` (Nuxt Icon's
actual client request) and the extensionless form. It does not open other root
API paths or write methods. Smoke verifies SVG bodies for menu/search, not just
an extensionless endpoint's status.

In `mode: dev`, Gateway makes source/virtual `/enterprise/_nuxt/**` responses
`no-store` and removes conditional request validators. Only JS in this checkout's
Vite `client/deps` directory with an exact optimizer `?v=<8 hex>` or a hashed
`chunk-XXXXXXXX.js` filename can retain private browser immutable caching, and
only when Vite itself returns an immutable 200 without cookies. CDN caching stays
disabled for all Dev resources; errors, unversioned files and source maps are not
cacheable. This avoids mixing source generations after a restart while reusing
unchanged prebundles on ordinary reloads. Preview caching is unchanged. For a tab
already affected by old immutable source responses, perform one hard reload;
no cookies or login storage need to be cleared.

The local Enterprise client explicitly prebundles Vue's runtime family and the
large UI/VueUse dependency barrels after Nuxt module exclusions are applied. It
keeps Nuxt's existing resolution aliases and source HMR. This is scoped to
`HZY0_LOCAL_ENTERPRISE=true`; cloud builds are unaffected. The Host layout owns
one navigation discovery lease shared with descendant pages, including the home
page, so they do not issue separate permission requests and refresh timers.
The local Vite post-transform also discards source maps only for Nuxt's extracted
`?macro=true` route metadata: those tiny modules otherwise embed the entire page
source map for every registered route at startup. Metadata code, route HMR and
actual page component debugging remain intact.

With explicit approval, `identity.credentialProviderRef: "protected-file:test-gateway"`
enables a loopback-only Console egress on the profile's gatewayInternal listener
(Host adapter currently pins `127.0.0.1:23121`). Only Gateway reads the existing
0600 test Gateway credential file; the Host retains its separate local secret.
Startup checks the live test registry binding. Egress pins the remote origin and
Enterprise identity, permits only enumerated queries/OIDC exchanges, read
service scopes and exact locally approved product-edit, Codocs and FE-2 request/version/handoff scopes for `data-runtime`,
and never follows redirects. The write exceptions use existing exact Console grants
for the user-approved test-data exercise; Runtime actor/object permits and
idempotency still apply. This capability also covers product creation/linking
under the existing contract; it is not a field-level permission. Other write
scopes remain denied. It is not a generic outbound proxy.
Restore the prior provider reference and restart
both hzy0 processes to disable it. No cloud secret or grant is modified.

This directory provides the Dev scaffold plus initial HTTP/WS hardening. G1
browser/business acceptance is still pending. It starts `hzy0-gateway`,
`hzy0-enterprise`, and the local editor-shell worker `hzy0-codocs-editor`, all
on loopback addresses. The editor process has no Gateway credential and is
reachable publicly only through the existing Access-protected hzy0 Gateway's
GET/HEAD shell/asset allowlist. Document APIs remain with Enterprise. Rebuild
the local Codocs artifact with `node deploy/test-env/build-cloudflare-worker.mjs codocs`
before starting the editor after a source change; this command does not deploy.
The stack never starts, stops, enrolls,
or configures the shared Runtime, database, Caddy or Tunnel. The explicit verified-policy
mode adds only the fixed signed policy wake described above, not a business scheduler.
The one-off pinned `install-verified-policy-runtime.mjs` (dry-run by default, `--apply`
required) is separate from stack lifecycle; it keeps protected binary/config backups and
does not drop schema or policy watermarks on rollback. Live `probe-verified-policy.mjs`
uses approved identities, reads policy and replays the exact committed envelope; it writes
only sanitized evidence, never credentials or policy bodies.

Copy `profile.example.json` outside the repository and fill it from approved,
non-secret deployment facts. Credentials remain in the approved provider; the
gateway token is supplied only as `HZY0_GATEWAY_INTERNAL_TOKEN` when starting
the dedicated PM2 stack.

```sh
PROFILE="$HOME/.config/huizhi-yun/hzy0/profile.json"

node deploy/test-env/local-enterprise.mjs plan --profile "$PROFILE"
node deploy/test-env/local-enterprise.mjs doctor --profile "$PROFILE"
node deploy/test-env/local-enterprise.mjs up --profile "$PROFILE" --mode dev
node deploy/test-env/local-enterprise.mjs status --profile "$PROFILE"
node deploy/test-env/local-enterprise/smoke.mjs --profile "$PROFILE"
```

`plan` reports pending approval blockers. `doctor` reports owned running processes
separately from occupied ports; `ready` is not business acceptance. `status` emits
only a process summary, never PM2's raw environment. `up`, `restart`, and `down`
check the exact cwd, runner, profile and mode in the dedicated `hzy0/pm2`
directory before managing any named process. Restart retains the existing PM2
credential environment; it does not require re-exporting secrets. A fresh `up`
still requires the approved credential provider. Dev explicitly uses
`--dotenv /dev/null`, and Nuxt HMR uses the public WSS port instead of localhost fallback.

`build`/Node mode currently fails closed: isolated artifacts are not
implemented. Loopback Runtime mode (`runtime.transportMode: "loopback"`) dials
only the pinned `http://127.0.0.1:18084` while keeping the canonical public
Runtime endpoint for signing and binding, and has no automatic public fallback.
The runner sets `NODE_OPTIONS=--network-family-autoselection-attempt-timeout=1000`
for all Node processes. This Mac has no IPv6 route, so Node's default 250 ms
Happy Eyeballs attempt budget aborts slow IPv4 handshakes to Cloudflare with
`ETIMEDOUT`, and those failures surface as authorization 503s.
The local Console egress allows the exact `codocs:personal-documents:edit`
service scope for document saves; Console grants, the Host `documents:edit`
check, and the Runtime document ACL still decide each write. Restart only
`hzy0-gateway` after changing the egress code.
Company weekly-summary archive delivery is separately opt-in. The private
profile needs `features.workflowLocal=true`,
`features.companySummaryCodocsDelivery=true`, and
`identity.codocsDeployment=C000001-test-codocs`. The Aims runner then pins
`HZY_CODOCS_TARGET_DEPLOYMENT` and `HZY_CODOCS_SERVICE_BASE_URL` to the local
Codocs editor worker. The Gateway egress admits only `aims.runtime` with
`audience=codocs` and `scope=codocs:company-weekly-summary:publish`; Codocs
still validates the service token and deployment. Verify the existing Aims and
Codocs Runtime grants and `oss.default` before enabling the switch. Apply
private-profile and process changes only through the approved hzy0 runbook.
The same boundary allows `codocs:document-shares:create` for an owner's share
request and `codocs:document-shares:mark-read` for a recipient opening their
shared document. Share list reads still require the owner's document access;
other share mutations remain outside the local allowlist.
Notifications remain closed by default. Set the private hzy0 profile's
`features.notificationsInAppOnly` to `true` and restart both `hzy0-gateway`
and `hzy0-enterprise` to enable the exact `audience=notifications`,
`scope=notifications:publish` service-token exchange and Console
`POST /api/v1/console/notifications/publish` egress. The gateway rejects
publish bodies unless `channels` is exactly `["in_app"]`; the Enterprise
notification orchestrator returns `external: skipped` after the in-app
publish and never calls notification-runtime or Connector Runtime. This
switch does not change cloud workers or Console's C000001 notification
settings. Turn it off in the profile and restart both processes to restore
the previous closed egress. A share already committed before this switch
does not need a retry; check its share list and receipt instead.
The current C000001 `enterprise.runtime` service-token probe for this exact
notification scope returns `403 insufficient_scope`; enabling the local
switch alone does not complete live in-app publishing. Any grant change needs
separate environment approval. Enterprise Host Codocs notification producers
also declare `sourceAppCode: codocs`, while the Host's service identity is
`enterprise`; reconcile that identity contract before a live publish probe.

Stage B v2 collaboration is opt-in and off in the example profile. Set both
`features.codocsSnapshotV2` and `features.codocsCollaborationV2` to `true` only
after the Runtime schema/switches and the exact `collab.runtime` registration,
credential and grants have been verified. The profile must use the local Console
facade and add `listeners.collab: {"host":"127.0.0.1","port":23131}`. The
dedicated PM2 process `hzy0-collab` binds only this loopback port; the Gateway
accepts only `/codocs/ws` WebSocket upgrades from the exact hzy0 Origin and
forwards no browser cookie, Authorization header or Gateway credential. Ordinary
HTTP on that path returns 426 when enabled and 404 when disabled.

Department document collaboration is a further opt-in, `features.codocsDepartmentCollaborationV2` (requires `codocsCollaborationV2`; example profile: `false`). It only adds `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2=true` to the Host process; the Runtime `apps.codocs.departmentCollaborationV2Enabled` switch and the `20260929_department_collaboration.sql` Codocs migration are separate, separately approved steps (`docs/Codocs-Collaboration-hzy0-Enablement-Plan.md`). No new listener, credential, grant or Gateway route is involved.

The Collab runner and Gateway token bridge read only `collab-client-secret.json`
beside the private profile. It must be a regular owner-owned file with mode
0600 and exactly one nonempty string field: `COLLAB_SERVICE_CLIENT_SECRET`.
The runner supplies only this service client secret to the Collab child and
pins the client ID to `collab.runtime`. V2 snapshot bytes pass through the
Runtime's `collaboration-snapshots:upload` and `:download` routes; Collab
receives no OSS credentials. The child uses the local Gateway's
local-Host-restricted `/__hzy0/collab-token` bridge to the local Console and
disables dotenv loading. That bridge accepts only the exact Collab client,
`data-runtime` audience and one of the two collaboration snapshot scopes; it
checks the dedicated client secret, supplies the fixed Collab deployment context,
and never logs or forwards arbitrary request headers. It remains closed while
the collaboration profile flag is off.
CLI preflight rejects a missing or unsafe client-secret file. The Gateway credential,
Console vault master key and DB environment are never inherited. The runner
fails before spawning when the file is absent or unsafe. Provision the file
through the approved credential process; this repository does not create it.
Enabling the profile and restarting processes does not substitute for the
two-person edit, reconnect, revoke and HTTP-conflict acceptance in the
[write coordination contract](../../../docs/Codocs-Document-Write-Coordination.md).
Raw `logs` is also disabled pending a redacted log adapter. Do not circumvent
these checks by invoking the old `.output` directly.

The read-only smoke probe checks local ingress status codes and the actual Vite
WebSocket handshake, without user cookies or business writes. It is not proof
of browser HMR, login, permissions, or a completed business workflow.

Before `up`, an operator must separately approve and perform the exact OIDC
callback registration, Caddy site merge, Tunnel ingress change, and outer
access protection specified in
`docs/Huizhi-Yun-Local-Enterprise-Test-Plan-v1.0-20260920/`. Those operations
are intentionally not hidden in this CLI.

### Private Workflow test process

The optional `features.workflowLocal` profile switch starts `hzy0-workflow` on
`127.0.0.1:23140` and its Aims callback/drain receiver on `127.0.0.1:23141`.
Neither receiver is exposed through the public Gateway. Both require the local
Console facade, loopback Runtime, and a separate, newly
initialized Workflow database in the local Runtime. The hzy0 Enterprise runner
sets the explicit Host topology `HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED=true` and
`HZY_ENTERPRISE_WORKFLOW_ORIGIN=http://127.0.0.1:23140` (and `...ENABLED=false`
when the switch is off, so the bridge stays closed instead of using discovery).
The Host validates that loopback origin at startup and before every Workflow
request (see `enterprise/shared/host-workflow-config.mjs`). The Gateway exposes only
the six registered Host BFF methods, never the Workflow service itself.
Console egress permits the corresponding exact `workflow:proxy` service token
only while the switch is enabled. Do not edit the tenant-wide Console
`workflow.apiUrl`: other test clients share it. Before enabling the switch,
prepare the isolated Workflow schema, the exact local service grants and real
issuance probes, then verify no hzy0 Workflow write reaches the cloud worker.
The Workflow runner sets `HZY0_LOCAL_AIMS_URL` only to the pinned Aims loopback
receiver. Its `workflow.runtime` secret is read from an owner-only private file
beside the hzy0 profile; Aims reads its existing owner-only test client file.
The manually triggered Aims drain must carry a signed scheduler wake and an
explicit loopback Workflow route. Do not submit a completion request until the
receiver, route, grants and local Runtime have passed their preflight probes.


## Dev 组合结构重载

Enterprise 的 `composition/registry.mjs` 与各应用 `layer/entry.mjs`、Console
`layer/navigation.mjs` 在配置加载时冻结 pages/navigation/manifest 事实。Nuxt 原生
pages watcher 能更新 SFC，不能使这些启动时导入的外部 ESM/JSON 快照自动变新。
hzy0 dev 的 `composition/dev-watch.mjs` 因此对以下结构输入触发
`restart({ hard: true })`，让配置和 ESM 依赖在新 worker 内重读；控制台打印固定提示，
不输出文件内容或凭据。首次加载本修复需重启 `hzy0-enterprise`。

| 变更 | 本机动作 |
| --- | --- |
| Enterprise composition `.mjs`、已登记贡献模块的 layer `.mjs`、manifest；Host pages 新增/删除 | Enterprise 在2秒无新结构事件后按最终内容去重，单次 hard reload（仅 hzy0 dev）；页面短暂加载后刷新 |
| 已有 Vue 页/组件内容、样式 | 常规 Vite HMR，不触发本守卫重启 |
| Host Nuxt 配置/模块注册 | Nuxt 自有配置重载；若启动失败，修复后 scoped restart enterprise |
| gateway topology/transport/egress/facade/登记路由表 | 明确 scoped restart gateway（不会自动扩大公开路由） |
| 私有 profile 或 runner 注入 env | scoped restart 受影响进程；Workflow/Console/Aims 各自独立 |
| Go Runtime、schema、grant | 仍按 LOCAL_RUNTIME 与批准流程；不属于 dev watcher |

新增 API 仍需 `generate:api-readiness --check`，新增公开路径仍需登记 topology 和测试。
自动重载不授予权限、不更新 grant、不重提 completion/outbox，也不部署 Worker。
普通 source 错误（例如 Node Nitro 外部化 workspace `.mjs`）必须修复构建依赖；
不能把所有 500 都归因于 watcher 或仅靠重启掩盖。

结构监听只覆盖实际启动输入（registry/host-native-pages/business-areas、贡献layer与manifest、Host Vue页面增删），不再递归监听各应用整目录或API就绪生成物。相同内容重写、空目录、普通页面编辑与短暂新增后删除不会触发hard reload；关闭时取消定时器。重载及上游错误日志包含UTC时间和固定事件类别，不记录查询串/头/正文；旧日志未含时间戳，不能精确追溯每次503。登录入口GET浏览器导航在503时显示固定重试页，dev返回Retry-After: 2；API保持安全JSON，写操作不自动重试。
