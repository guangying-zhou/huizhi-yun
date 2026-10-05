# DEBUG REPORT — People 跨应用操作长期保持 pending 0/8

日期：2026-09-01
环境：生产租户 `C000001`，People 部署 `C000001-people`

## Symptom

- 清理测试操作后，共享 Tenant Gateway 在 2026-09-02 08:11（数据库本地时间）重新生成
  92 条 Directory lifecycle 操作。
- 页面全部显示 `pending`、尝试次数 `0/8`，后续 Gateway 唤醒也未领取。

## Root cause

People 的 Directory lifecycle 和 Assets offboarding 两处 `integration_operation` INSERT 未显式
写入 `next_attempt_at`、`created_at` 和 `updated_at`，因此使用列默认
`CURRENT_TIMESTAMP(3)`。生产 MySQL 会话处于 CST/UTC+8，而可靠操作 Repository 使用 Go
`time.Now().UTC()` 判断是否到期，并使用 `created_at` 作为 24 小时重试窗口的起点。

现场同一查询显示 `NOW(3)=2026-09-02 08:15`、
`UTC_TIMESTAMP(3)=2026-09-02 00:15`。新操作的 `next_attempt_at` 是 08:11，和 UTC 领取时钟
相比位于未来约 8 小时，所以 `claim-next` 返回空，尝试次数始终为 0。只修复
`next_attempt_at` 后，第一跳虽可领取，但正常的 `platform_lifecycle_pending` 短暂失败会因
`created_at` 仍在 UTC 未来而触发 `current time must not precede first attempt`。

People 的两个专属 Worker 开关不是本生产路径的控制点：共享 Tenant Gateway 每 5 分钟仍会调用
受信 scheduler wake。`HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED` 只控制专属 People Worker
自己的 cron。

Console 侧还有第二个独立根因：Cloudflare Worker 的 `scheduled()` 会触发 Nitro
`cloudflare:scheduled` hook，但原生产包只有 hook 调用，没有任何 hook 注册。`nuxt.config.ts` 中
声明的 `integrations:platform-lifecycle` Nitro task 在 Cloudflare 构建时并未注册，构建日志也明确
提示 task 未定义。因此即使开关已经为 true、Cloudflare cron 正常返回 Ok，投递仍是空跑。

补上 hook 后的生产验证又确认直接 Console cron 本身不符合共享 Worker 边界：01:00 UTC hook
确实运行，但在 claim 前以 `Scheduled Console lifecycle drain requires an enrolled Tenant Runtime
endpoint and static/gateway token` 失败。共享 Console 同时服务多个租户，按设计不能配置单租户
Runtime URL/token；只有 Tenant Gateway 的逐租户 scheduler wake 才携带经过 HMAC 绑定的 tenant、
deployment、Runtime endpoint 和短期 bootstrap token。Platform scheduler registry 和 Gateway
允许清单此前又都漏了 `console`，所以正确的 event-bound 路径从未存在。

event-bound 路径上线后又暴露出嵌套令牌交换缺陷：Gateway 已经为当前 tenant/deployment 注入
90 秒 Platform bootstrap JWT，但 `requireStaticRuntimeToken` 分支仍先向 Platform 再申请一枚，
只有刷新失败后才会考虑现有 token。生产第二次申请返回 409，于是 Console 在真正 claim 前返回
`Platform Runtime bootstrap token is unavailable`。现有短期 token 已受 Gateway HMAC 绑定，且
Tenant Runtime 会再次验证 EdDSA 签名和精确 claims，重复申请既无必要也会引入额外故障点。

bootstrap 复用上线后，Console 已能领取操作，但 lifecycle 命令仍使用普通公网 `fetchExternal`
调用 Platform。生产 `huizhi.yun` 公共边缘的 geo WAF 会拦截 cron 来源的 Worker 子请求；01:51 和
01:56 UTC 两次金丝雀均在进入 Platform Worker 前收到边缘 403。Console Wrangler 实际已声明
`HZY_PLATFORM_SERVICE -> hzy-platform`，`platformRuntime.ts` 的 policy bundle 路径也已有经过验证的
Service Binding helper，但 lifecycle 投递没有复用它，形成同一模块内两条不同的出站边界。

## Fix

- Directory lifecycle INSERT 显式写入 `next_attempt_at=UTC_TIMESTAMP(3)`。
- Assets offboarding INSERT 同样显式写入 UTC，避免同类故障。
- 两处 INSERT 同时显式写入 `created_at/updated_at=UTC_TIMESTAMP(3)`，保证重试窗口和
  Repository 的 UTC 时钟一致。
- 从仓库级 `knownClockDomainDebt` 中移除两项 People 豁免，使后续遗漏直接导致测试失败。
- 增加 People 专项回归护栏，要求三个调度时间列都显式使用 `UTC_TIMESTAMP(3)`。
- 移除共享 Console 自有 Cloudflare cron 和失效 Nitro task 映射，不给多租户 Worker 注入单租户
  Runtime 凭据。
- 新增 Console 私有 `/api/internal/integration-operations/drain`，先验证 Tenant Gateway scheduler
  HMAC，再通过 event-bound Runtime binding 执行 Platform lifecycle operation/actionable drain。
- 把 `console` 同时加入 Platform scheduler registry 和 Tenant Gateway 允许清单，增加
  `HZY_CONSOLE_SERVICE -> hzy-console-prod` 同账号 Service Binding；Console 使用根 wake 路径，
  其他应用继续使用 app 前缀路径。
- 扩展私有路径拦截，普通浏览器对 Console 根 wake 以及既有 Finance wake 一律 404。
- 增加 Console、Platform、Tenant Gateway 三侧回归护栏，锁定清单一致性、逐租户注入、服务绑定
  和普通 HTTP 禁止规则。
- `requireStaticRuntimeToken` 优先复用可信 Gateway 已注入的 Platform bootstrap JWT；仅在缺失或
  仍为 legacy token 时请求 Platform 刷新，之后仍只允许该 token 调用固定 service-token issuer。
- 导出并复用既有 `platformRuntimeFetch`，使 Console lifecycle 命令通过同账号
  `HZY_PLATFORM_SERVICE` binding 调 Platform；公网 fallback 仍保留现有 Worker UA，避免再次绕回
  cron 子请求的 geo WAF 路径。

## Evidence

- 生产库共有 79 条 employment、13 条 offboarding 操作，均为 `pending`、`attempt_count=0`、
  无错误信息，创建时间集中在 08:11:07–08:11:09。
- data-runtime 日志显示同一 Gateway 请求完成五页 `directory-lifecycle:prepare-due`，随后
  `claim-next` 返回成功但没有产生 attempt。
- 修改护栏后，旧代码聚焦测试先失败并准确指出两处 People INSERT。
- 修复后 `go test ./internal/integrationoperation ./internal/apps/people`、`go test ./...`、
  `go vet ./...` 与 `git diff --check` 全部通过。
- `next_attempt_at` 修复此前已存在于未合入 main 的分支提交 `964fd3d2`；本次把该修复带回当前
  工作树，并根据生产金丝雀进一步补齐 `created_at/updated_at`。
- Data Runtime `0.3.205`（构建时间 `2026-09-02T00:19:48Z`）已发布，二进制已包含
  `next_attempt_at` 修复；现场金丝雀因此能在 00:26 UTC 被领取。
- 92 条存量操作的 `created_at` 均为 08:11 本地墙钟。已按现场时差 28,800 秒归一为
  00:11 UTC，更新 92 条，复查 `created_at` 位于 UTC 未来的记录为 0。
- 上次测试清理删除了 People 源版本，却保留 Console 的 92 条旧 `r1` 水位：79 条会报
  `lifecycle_source_version_hash_mismatch`，13 条虽哈希相同也不会重建已删除的 Platform 操作。
  金丝雀 Console 水位置零后，People→Console 已返回 200 并生成成功回执；Console→Platform
  操作也已生成。
- Cloudflare 当前部署版本 298 的运行时 binding 显示
  `HZY_CONSOLE_PLATFORM_LIFECYCLE_SYNC_ENABLED=true`，但 00:40 scheduled 事件执行后仍无 claim。
  原因是 23:33 构建时生成配置为 false，值已被烘焙进 Worker；00:21 仅通过 Dashboard 修改
  binding 无法改变已构建代码。`.env.cloudflare` 已补上 true，重新渲染后生成配置为 true。
- Data Runtime `0.3.206` 已于 00:43 UTC 构建并发布，生产二进制已包含三个 UTC 时间列修复。
- Console Worker 版本 299 已于 00:48 UTC 发布，生成配置与生产 binding 都为 true；00:50 UTC
  新版本 cron 后操作仍保持 `pending 0`。检查生产包确认只有 `cloudflare:scheduled` 调用而无注册，
  且缺少 Platform lifecycle drain 路径，排除了开关和旧构建缓存假设。
- 补齐 scheduled plugin 的 Console 版本 `78d4d786-008f-43c5-a045-69055881da0c` 于 00:58 UTC
  100% 生效；01:00 UTC scheduled 日志明确在 claim 前报缺少 Tenant Runtime endpoint/token，证实
  直接 cron 架构不适用于共享 Worker，操作仍为 `pending 0`。
- event-bound 修复的回归测试先分别因缺少 Console route、registry app code、Gateway allowlist 和
  service binding 失败；实现后 Console 427 项、Platform 252 项、Tenant Gateway 7 项测试全部通过，
  两模块 lint/typecheck、两个 Cloudflare build 和 Gateway Wrangler dry-run 全部成功。
- 重新生成的 Console Wrangler 配置不再包含 cron；Gateway dry-run 确认
  `HZY_CONSOLE_SERVICE (hzy-console-prod)` binding 存在，且未嵌入 Runtime 凭据。
- Console `27f14540-0cc1-42d1-b95b-bce991104ade`、Gateway
  `62124e8c-1471-4dd7-97ac-057c6cfc1080`、Platform
  `18091957-45a1-4bee-a889-9e787b4cf331` 已在 01:09–01:10 UTC 100% 生效。01:15 UTC Gateway
  已枚举并成功进入 Console 私有 route，但 scoped token 交换因重复 bootstrap 申请返回 503；
  Console→Platform 金丝雀复查仍为 `pending 0`，证明未消耗 attempt。
- 新增与生产 scheduler 同型的嵌套令牌测试，旧代码先稳定失败并命中
  `Platform Runtime bootstrap token is unavailable`；调整选择顺序后通过。Foundation 340 项、
  Console 427 项测试以及两侧 lint/typecheck、Console Cloudflare build 全部通过。
- 01:20 UTC 后声称重新发布时，Cloudflare `deployments list` 与 `versions list` 均确认
  `hzy-console-prod` 最新版本仍是 01:09 UTC 的
  `27f14540-0cc1-42d1-b95b-bce991104ade`，没有包含 bootstrap 复用修复的新版本。
  01:25 UTC Gateway live tail 再次记录 Console wake 返回 503，错误仍为
  `Platform Runtime bootstrap token is unavailable`，证明实际运行包未更新；失败仍发生在 claim 前，
  没有消耗 Console→Platform 金丝雀的 attempt。
- Console `edb1e0af-e534-4cda-b5ba-683d121d53fb` 于 01:48:38 UTC 以 100% 流量生效；01:50
  Gateway wake 不再出现 Console bootstrap 503，证明嵌套令牌修复生效。金丝雀被领取后却以
  `failed_permanent / http_403` 结束；01:56 受控重试得到同样结果，保留了 attempt 1、2。
- Platform 生产库确认 `C000001-console` 为 active，且两次失败均没有生成
  `service_command_receipt`；同一生产 token 对 bundle API 返回 200。随后使用同型 HMAC 发送故意
  错误 command hash 的无写入探针，Platform Worker 按预期返回
  `409 idempotency_payload_mismatch`，同时 live tail 可见该 POST；反之两次 Console lifecycle POST
  均未进入 Platform tail。这组对照将 403 精确定位为公网边缘 WAF，而非 token、principal、HMAC
  或 deployment 绑定问题。
- lifecycle Service Binding 回归在旧代码上先失败；改用 `platformRuntimeFetch` 后聚焦测试通过，
  Console 全量 427 项、lint、typecheck、Cloudflare build 与 `git diff --check` 全部通过。
- Console `58da3f84-8db5-4c15-996e-42225737d687` 于 02:02:50 UTC 以 100% 流量生效。
  02:25 Gateway wake 后，Console→Platform 金丝雀在第 3 次尝试成功，Platform 回执为
  `d0043bfd-9f7e-441c-8a9d-c25e907b4040`，水位推进至 revision 1；Platform live tail 同时确认
  lifecycle POST 已通过 Service Binding 进入 Worker。
- 02:30 Gateway wake 后，People 金丝雀在第 5 次尝试成功，Console 回执为
  `21cc39c5-fa16-4832-8356-0eef3ec8f129`。至此 People→Console→Platform 两跳闭环已在生产验证。
- 金丝雀成功后，按精确租户、deployment、operation code 和初始状态条件放行其余 91 条测试操作，
  并仅将对应 91 条 Console 水位置零；People attempt/status 与历史 attempt 保持原样，由可靠投递协议
  和每 5 分钟 Gateway scheduler 正常推进。
- 06:55 UTC 排空完成。People 92 条 operation 全部 succeeded（79 employment、13 offboarding），
  92 个 Console 回执和 92 个目标用户均唯一且无缺失；Console 92 条派生 operation 全部 succeeded
  （79 employment、13 offboarding），92 个 Platform 回执和 92 个 authorization subject 均唯一且无缺失。
- Platform 02:20 UTC 后的本批 92 个 `service_command_receipt` 全部 succeeded、completed_at 非空，
  对应 92 个唯一 operation/target；`platform_lifecycle_scope_versions` 与 Console
  `directory_lifecycle_scope_versions` 均为 79 条 employment revision 1、13 条 offboarding revision 1，
  不再存在 revision 0。
- operation 最终状态中不存在 pending、processing、retry_wait、dead_letter 或 failed_permanent。
  attempt 表仍追加保留此前金丝雀的 2 次 WAF 403、一次旧水位 409 和一次 lease_expired 诊断历史；
  这些记录没有被覆盖或删除，且对应 operation 最终均为 succeeded。

## Regression test

- `data-runtime/internal/integrationoperation/clock_domain_repo_scan_test.go`
- `console/test/directoryLifecycleReliability.test.ts`
- `platform/test/tenantGatewaySchedulerRegistry.test.ts`
- `deploy/cloudflare/tenant-gateway/test/scheduler.test.mjs`
- `foundation/test/tenantRuntimeClient.test.ts`

## Production follow-up

- Console、Platform、Tenant Gateway 的 event-bound scheduler、Foundation bootstrap 复用和
  lifecycle Service Binding 修复均已发布；生产金丝雀两跳闭环成功。
- 其余 91 条测试操作已通过受信 Gateway scheduler 的有界批次排空；People、Console、Platform
  三侧均已达到 92 条一致成功、92 条水位 revision 1，且当前 operation 无任何积压或失败。

## Production backups

- People 操作与源版本：
  `/var/backups/hzy/people-integration-pending-clock-repair-20260902-0023.sql.gz`
  （SHA-256 `a3360df388e2544801714a6d40b2ad85c51515480d5b07ab822db82d99c1ed4d`）。
- Console 92 条生命周期水位：
  `/var/backups/hzy/console-lifecycle-watermarks-before-replay-20260902-0030-v2.sql.gz`
  （92 条 INSERT，SHA-256
  `ad41c396f8964ef5a0fbcf6da1d3749c4b3f67f22ecd9bebd24be95bb0a02711`）。
- Console→Platform 金丝雀第二次重试前后的精确 operation/attempt 快照：
  `/var/backups/hzy/console-platform-canary-after-auth-retry-reset-20260902-0154.sql.gz`
  （2 条 INSERT，SHA-256
  `93734e0fec1891cd50820c4c426a8679ccd186e69c2fcb7f3274239d43d768a4`）。
- Console→Platform 金丝雀 Service Binding 重试前快照：
  `/var/backups/hzy/console-platform-canary-before-binding-retry-20260902-0223.sql.gz`
  （SHA-256 `0c78da8e6712df36839e7d60d6de53068b9a7d021765ca0c579bbb47fba9bcc3`）。
- People 金丝雀恢复完整链路前快照：
  `/var/backups/hzy/people-canary-before-full-chain-resume-20260902-0228.sql.gz`
  （SHA-256 `2ebb8035aa38f7f28a8731aa3e1b9cfba355f47ca13e859eb294c0e034d0283b`）。
- 91 条批量放行前的 People 92 条操作快照：
  `/var/backups/hzy/people-92-operations-before-bulk-release-20260902-0233.sql.gz`
  （SHA-256 `77692f76dd605e5f580cde623e6e10cd44b9ee038fbedc765c96abb6fc1455f5`）。
- 91 条批量放行前的 Console 92 条水位快照：
  `/var/backups/hzy/console-92-lifecycle-watermarks-before-bulk-release-20260902-0233.sql.gz`
  （SHA-256 `12454881aaf3bf0d49889b2d548decd348651e6a502c777e648cc032e8379db8`）。

## Status

DONE：Console Service Binding 修复已随 `58da3f84-8db5-4c15-996e-42225737d687` 发布，
Console→Platform 与 People→Console→Platform 金丝雀均成功。其余 91 条测试操作已通过共享
Gateway scheduler 安全排空；People、Console 和 Platform 三侧 92 条操作/回执/水位全部一致成功，
当前 operation 的 pending、processing、retry_wait、dead_letter 和 failed_permanent 均为 0。
