# C000001 外部消费者排空准备

当前已部署并注册测试入口记录 wrapper，服务仍开放；尚未关闭入口或完成最终排空认可。`ingressDrained` 与 `externalReceiptsVerified` 是两项不同证据，不能用前者替代后者。旧版本无 wrapper，不能把旧版本的请求记录视为已覆盖。

## 实际消费者边界

- Aims 有 integration-operations、due notifications、milestone rollover 的 Nitro scheduled declarations；Assets 有 due notifications、delivery asset status declarations。现测试配置禁止 app triggers，因此声明本身不证明线上 Cron 存在，需读取实际 CF schedules 和版本 handler。
- Assets activate API 可立即发送 delivery asset status，不受 scheduled 开关约束。所有 Aims/Assets fetch 必须纳入边界，不能只停定时器。
- Aims 冻结 command 的外部目标包括 Finance、Altoc、Codocs、People；另有 dead-letter actionable/closure 和 Console 通知。通知 source ACK 可能已完成而 WeCom 投递仍失败，不可据 source ACK 推断外部通知成功。
- Console/Finance/Aims/Assets 的直接 Service Binding 可绕过 Gateway。测试 wrapper 包装实际 Worker fetch/scheduled，并在响应流关闭和捕获的 waitUntil 全部结算之后记录 finish。
- Runtime 直接业务入口和其他应用队列不受 CF wrapper 控制。源库 fence 仍是事务写入边界；远端未决命令/receipt 必须按冻结目标核对。
- 崩溃、丢失 finish、5xx、后台任务失败或流取消均不能通过时间推断成功；记录保持 active/uncertain，禁止 seal。

## 可执行准备

1. `node deploy/test-env/drain/control.mjs prepare`：生成内部 DO 的 Wrangler 配置，无公网 route、无 workers.dev。
2. 本次只部署记录边界使用下文原在线版本导出候选，避免夹带本地业务改动。后续正常业务构建可显式使用 `build-cloudflare-worker.mjs <app> --with-drain`；产物 actor hash 必须重新审阅，不可覆盖已登记合同。
3. 候选 coordinator 需专用 `HZY_DRAIN_CONTROL_TOKEN` 和现有 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`；不把值写入文件。业务 token 不能调用控制接口。
4. Gateway 需显式 `HZY_TEST_DRAIN_CONTROL_ENABLED=true`、独立 control token 和 `HZY_DRAIN_COORDINATOR` binding。代理只接收真实 `hzy-test.huizhi.yun`、C000001/test，默认 404。
5. register 输入文件记录两 app 的真实部署 artifact、requestId。`node deploy/test-env/drain/control.mjs register --input <file>` 默认只输出计划；加 `--apply` 才调用远端。register 初始 closed，首次 open 需 expectedRevision=1 且无未决活动。
6. 部署覆盖验收需记录 coordinator、Gateway、两 app 实际 100% 版本、actor artifact 和所有直接 binding；本地构建不代表远端已覆盖。对旧实例的在途请求需另有真实完成证据。
7. `node deploy/test-env/drain/control.mjs snapshot --output <file>` 只读并核验 HMAC。close 输入必须带 requestId/expectedRevision；seal 另需 cutoverKey 和规范 uint64 字符串 targetGeneration。缺失/错 actor 或 admission revision 的 finish 被拒绝。

## 2026-09-13 接续实现与实际试点顺序

已实现 `enterpriseProviderReceipts.mjs` 自动证据归类、Platform 不可变认可记录、Go 同事务重查 verifier，以及真正 Go TLS HTTP → Platform HTTP/SQL/Ed25519 → SQLite coordinator 联合测试。`externalReceiptsVerified:false` 仍有意保留：它表示单个 ingress 快照不能替外部证据背书。实际启用必须使用完整的外部报告及签名认可，不能修改此布尔字段冒充证明。

### Closed 逐条结清

`/reconcile` 只接受 Platform pinned Ed25519 的 `enterprise-drain-activity-resolution.v1`。绑定 tenant/environment、closedRevision、活动完整行与行 hash、admission revision、actor/deployment/artifact、审核人及不可变认可 hash；不删除活动，事务内转 settled 并追加 audit。相同 request 重放只生效一次，任何载荷漂移拒绝。活动仍 active 时，除外部 terminal/not-sent 证据，还必须有该执行实际结束的单独证据。没有这份事实就继续保留 active；超时、空队列、进程“可能停止”不能代替。

先部署 Platform SQL `20260913-enterprise-external-drain-approval.sql`，再部署 `20260914-enterprise-drain-activity-approval.sql` 及相应 API。两者仅新增审计表，不修改收费、源业务记录或普通权限。认可沿用实际 `ops.deployments:admin`，默认 plan，明确 approve 才写审计及签名。

```sh
node deploy/test-env/drain/control.mjs snapshot --output /protected/closed.json
node deploy/test-env/drain/activity-review-request.mjs /protected/closed.json /protected/activity-review.json /protected/activity-plan.json
node deploy/test-env/drain/activity-review-request.mjs /protected/closed.json /protected/activity-review.json /protected/activity-resolution.json --approve
node deploy/test-env/drain/control.mjs reconcile --input /protected/reconcile.json
```

`activity-review.json` 包含 `activityId/requestId/decision`；decision 包含 `outcome`（verified-terminal 或 verified-not-sent）、`evidenceKind`（provider-query/provider-export/activity-ledger）、真实 `reference/explanation/evidencePath`。active 额外要求 `executionEndedReference/executionEndedEvidencePath`。CLI 从实际非空文件计算 hash；不会制造外部证据。`reconcile.json` 是 `{requestId,expectedRevision,resolution:<认可响应>}`。最后命令仍为 dry-run；实际执行另加 `--apply`。逐条完成后重新读取 snapshot，确认 closed 且 ingressDrained，才准备 seal。随后按 provider 报告的具体 manual-required 项收集不可恢复的外部结果，使用 `review-request.mjs`；已自动核实及有具体未启用证据的 not-applicable 项不再增加人工关卡。

### 只部署记录边界，保持服务开放

本阶段**不 close、不 seal、不激活库**。候选来自 Cloudflare 当前 100% 版本的原始模块导出，保留静态资产、secret bindings、兼容配置及原 handler，不重建本地未发布业务变动：

- 候选目录：`deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only`。
- Aims 回退版本：`8d573b11-b6cf-4052-a4a0-d0d6bf7b5a41`。
- Assets 回退版本：`c6ae2f23-286f-4bb6-95a4-679d456f13b9`。
- 每个候选的 config、原始模块字节 hash、固定 actor artifact 及 register/open 输入均在目录 manifest 中。导出观察时间为 2026-09-13；若部署前原应用已换版本，重新运行 `prepare-live-wrappers.mjs <新目录>`，不能强行回退业务版本。
- Coordinator 配置：`.cloudflare-workers/drain-coordinator/wrangler.json`；Gateway 叠加候选：`.cloudflare-workers/gateway/wrangler.enterprise-auth-drain.json`，由现 enterprise-auth 配置添加唯一 drain binding 和显式开关，未代替父任务的最新 Gateway 发布审阅。

执行顺序：

1. 只读核对两 app 的当前 deployments/versions 与 manifest，保存当前 Gateway 和应用的回退版本。Coordinator 配置专用控制 token、已有内部 Worker token（两者必须不同）、Platform pinned kid/public key；秘密经 Wrangler secret 输入，不写配置文件。Gateway 配同一专用控制 token。公开公钥和 kid 使用受控配置。
2. 先发布 coordinator，再发布包含精确 `/__test/drain/` 控制代理和绑定的 Gateway；此时旧业务 Worker 尚未接入，因此 register 的初始 closed 不会暂停旧业务。
3. 使用候选 `register.json` 完成登记，随后使用 `open.json` 在 revision 1 开门。已有登记只允许完全相同 actor 重放；冲突不能覆盖。已经有活动的协调器不应重新初始化。
4. 执行下面只读 gate，必须得到 `mode:open`、准确两 actor 和 `workerCredentialConfigured:true`，才允许发布任何 wrapper。每个 app 发布前再读一次，不拿旧离线快照当当前状态。
5. 部署 Aims wrapper，再次 gate，然后部署 Assets wrapper。fetch、scheduled、queue、email、tail、trace 都进入记录边界；响应流和 waitUntil 完成后才 finish。
6. 记录两 app 实际 100% 新版本和实际 bindings；检查 Gateway 普通入口及直接 Service Binding 均正常，快照仍 open。重新运行消费者只读采集，才把“部署覆盖”作为事实。旧版本在途活动及未经过 wrapper 的历史外部发送不会被自动追认。

```sh
node deploy/test-env/drain/control.mjs prepare
# 以下是执行者审阅后的实际发布命令；本任务没有执行。
pnpm --dir enterprise exec wrangler deploy --config ../deploy/test-env/.cloudflare-workers/drain-coordinator/wrangler.json
pnpm --dir enterprise exec wrangler deploy --config ../deploy/test-env/.cloudflare-workers/gateway/wrangler.enterprise-auth-drain.json
node deploy/test-env/drain/control.mjs register --input deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/register.json --apply
node deploy/test-env/drain/control.mjs open --input deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/open.json --apply
node deploy/test-env/drain/verify-open.mjs deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/manifest.json
pnpm --dir enterprise exec wrangler deploy --config ../deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/aims/wrangler.json
node deploy/test-env/drain/verify-open.mjs deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/manifest.json
pnpm --dir enterprise exec wrangler deploy --config ../deploy/test-env/.cloudflare-workers/drain-candidates/20260913-wrapper-only/assets/wrangler.json
```

回退仅在本阶段尚未 close/切库时，将 app rollback 到上述保存的原版本（`wrangler rollback <version-id> --config <对应候选config>`），coordinator 保持 open 且保留全部证据；恢复旧 wrapper 版本后需重新核定覆盖。不删除 DO 或 audit，不把此应用版本回退当数据恢复。若已经 sealed 或统一库产生新写入，须走现有恢复协议，不能照抄此步骤。

### 验证边界

- `node --test deploy/test-env/drain/*.test.mjs`：真实 SQLite、流/waitUntil、遗失记录、签名/actor/代际，以及必须先 open 的部署 gate。
- `node platform/scripts/test-cutover-activation-e2e.mjs`：实际 H3 认可 API + 实际 ops RBAC + 专属 MySQL 审计 + SQLite reconcile/seal + 真正 Go TLS HTTP 回执 + Platform 路由验证和签名 + coordinator release。拒绝未授权、timeout、wrong actor/代际/行 hash、无结束证据的 active；重放不重复写入。测试外部结果使用明确 fixture，不冒称已核实真实第三方发送。
- `node platform/scripts/test-external-provider-receipts-mysql.mjs`：真实 collector → Platform 认可 → Go SQL 重查及迁移 CLI；缺 probe/替换 source/未知 classification/篡改 decision hash/实际行漂移被拒绝。

候选 dry-run/联合测试不等于真实覆盖、真实外部 receipt 完成或业务切库批准。当前没有执行上述部署、认可、close/seal 或 ActivateFinalCopy。

## 2026-09-14 实际签名信任准备

通过已认证 SSH，从 `hzy-platform-dev` 进程配置及其独立 `hzy_platform_dev` 数据库
读取唯一 active Ed25519 公钥；按 Platform 相同的文件/环境变量解析及配置回退规则，
核对私钥导出的公钥一致，并完成随机挑战签名/验签，私钥未离开服务器。
[脱敏公钥及校验证据](../deploy/test-env/artifacts/C000001.platform-drain-signing-key.json)。
这证明当前配置的密钥对匹配，不代替实际 cutover/activity HTTP 接口的部署验收。
专用控制令牌已在受保护 Runtime 目录 `drain-control-token` 创建（0600），与 Gateway
内部凭据不同；尚未注入远端 secret、部署 coordinator 或操作实际排空状态。

## 2026-09-14 测试控制面实际就绪

测试 coordinator 与 Gateway 的精确 `/__test/drain/` 控制代理已部署；首次 snapshot 为
`not_registered`（HTTP 503），随后只登记既有 Aims/Assets 两个候选 actor 并打开至 revision 2。
签名 snapshot 已验证 `mode=open`、两个精确 actor 和独立 worker credential。Aims/Assets
仍保留原 100% 版本，未部署 wrapper；没有 close、seal、业务库迁移或外部排空操作。Gateway
根路径、Enterprise 登录和已认证 registry digest 均返回 200。完整脱敏版本、保留项及状态见
[C000001 drain 控制面部署 receipt](../deploy/test-env/artifacts/C000001.drain-control-plane-20260914.json)。

同日，Aims 与 Assets 的 exact 在线代码 wrapper 已在每次签名 open gate 后分别发布，保留
原模块、secret/assets/bindings，并显式关闭 workers.dev 和 preview URL。两条既有产品入口均
返回 200，各自产生一条已 settle 的控制记录；snapshot 仍为 open revision 2 且没有
active/uncertain 记录。该结果只证明记录边界可完成，`ingressDrained:false` 和
`externalReceiptsVerified:false` 仍保持，不能作为外部排空、close/seal 或业务库切换的依据。
[wrapper 部署 receipt](../deploy/test-env/artifacts/C000001.drain-wrapper-deployment-20260914.json) 记录
当前 100% 版本和可回退版本。

## Wrapper 部署后的只读复核（2026-09-14）

2026-09-14T04:48:38.892Z 重新采集实际 Worker 版本、绑定、定时任务和本地回执，报告为2项自动核验、2项不适用、5项待补证、0项 blocked；`ready=false`。当前两个实际版本与部署回执一致，均已绑定排空协调器。旧的“wrapper未部署”阻碍已消除，但不能据此声明排空完成。

待补证项及下一步：

- Assets 源 outbox 表不存在：核对实际出站实现与源表映射，证明不适用或补充实际使用的任务表证据，不能将缺表直接解释为零任务。
- People 回执表不存在：核对源端是否存在 People 目标及实际直连调用，再确定适用性。
- 已部署制品和直连绑定覆盖：已有两个 wrapper 的版本、原模块摘要和注册制品摘要；需按认可接口要求绑定为可重查证据。
- wrapper 安装前的在途请求：需要当时执行结果或提供方记录；当前协调器无未结束请求不能追溯证明历史结果。
- 外部通知提供方：需核对实际渠道与发送历史；本地投递表零行不能替代外部结果。

报告见 [实际提供方回执](../deploy/test-env/artifacts/C000001.enterprise-provider-receipts.json)。尚未关闭入口、seal、源端栅栏或正式切库。

源码复核补充：不能把两项缺表直接标记为不适用。`assets/docs/assets_schema.sql` 明确引用 `20260710_assets_integration_operations.sql`，`assets/server/utils/deliveryAssetStatusOperation.ts` 存在 Assets→Altoc 状态同步出站执行器；当前测试源库缺表与代码契约存在差异，需要按实际启用路径确认并修复。`aims/server/utils/peopleContributionOperationExecutor.ts` 存在 Aims→People 贡献替换命令，`data-runtime/internal/apps/people/contribution_receipt.go` 实现对应持久回执。因此 People 缺表也不能仅因当前 Aims outbox 为零而排除。下一步先核对这两条路径的测试部署与schema迁移清单，再决定补迁移或明确该环境的未启用证据。

2026-09-14T04:52:10.349Z 实际元数据复核确认：Assets已有3个 `altoc_status_sync_*` 列和接收回执表，但缺两张出站任务表；People已有两张出站任务表及贡献水位表，但缺接收回执表。该观察说明是部分schema缺失，不能以某条整体迁移已完成代替逐表核验。[只读证据](../deploy/test-env/artifacts/C000001.external-path-schema-gaps.json)。

People缺表已修复：补充 `people/docs/migrations/20260914_service_command_receipt.sql` 并同步完整schema。隔离MySQL验证建表、重复执行、35列和2项CHECK生效后，已在精确绑定的测试People库创建该空表，未写业务行；[执行回执](../deploy/test-env/artifacts/C000001.people-receipt-schema-application.json)。新增空表只能修复后续接收与采集，不能追溯证明此前的外部调用结果；旧提供方报告保留采集时缺表事实，下一次采集会读取新状态。

Assets缺表已补齐：既有20260710与20260711迁移的CREATE语句在隔离MySQL重复执行通过（3表、5项CHECK生效），随后仅在精确测试Assets库创建3张空表，未改动已有3个同步列或业务行。[执行回执](../deploy/test-env/artifacts/C000001.assets-outbox-schema-application.json)。正式源计划已刷新为150表/478行；新增表不能追溯证明历史外部发送结果。

补齐表后已重新采集提供方报告：2项automatic、2项not-applicable、3项manual-required、0项blocked。剩余项是制品/直连覆盖、wrapper前在途历史、外部通知历史；`ready=false`，入口仍open。

2026-09-14T04:58:37.496Z只读核对Console测试库：`portal_notifications`总数0，跨全部来源的投递分组为空，见[通知历史观察](../deploy/test-env/artifacts/C000001.notification-history-observation.json)。该结果只描述当前数据库，不能证明外部渠道历史；已向环境负责人询问是否存在真实发送及既有日志位置，同时继续核对当前渠道配置。

当前渠道配置只读核验：Console测试库未发现wecom/dingtalk/smtp/webhook外部渠道行，`externalChannelEnabled=false`；详情随[Console实际发布证据](../deploy/test-env/artifacts/C000001.console-entitlement-release-20260914.json)保存。此状态与零通知记录一致，但不替代历史发送事实的确认。

当前制品/直连覆盖证据已落地：[签名快照与实际绑定核验](../deploy/test-env/artifacts/C000001.deployed-worker-versions-and-direct-bindings-evidence.json)。复用verify-open校验revision=2及精确演员/制品摘要，两应用当前版本100%、各66绑定，实际入口200。该包可作为后续认可流程的当前部署证据输入，尚未提交认可；历史在途与外部发送范围仍单独待证。

### 环境负责人历史确认

用户在本任务中明确确认：

> 仅内部测试，未发送外部通知或调用真实外部业务系统

[确认记录及支持证据摘要](../deploy/test-env/artifacts/C000001.external-history-owner-confirmation.json)保存该原话、当前零通知记录、未启用外部渠道及部署核验的引用。该证据来源是环境负责人确认，不冒充提供方查询或导出。可据此准备两项历史外发的verified-not-sent认可输入；仍需后续闭合的排空快照、Platform实际认可及最终源端核验，当前未提交认可、未关闭入口。

三项人工证据的[认可输入准备文件](../deploy/test-env/artifacts/C000001.external-drain-review-preparation.json)已生成，逐项引用真实制品/绑定证据和环境负责人声明。尚无最终 seal，因此未提交 Platform plan/approve；切库前必须使用最终采集报告及实际 seal 组装请求。
