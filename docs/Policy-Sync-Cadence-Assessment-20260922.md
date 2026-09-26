# 策略同步频率评估与实施计划

日期：2026-09-22。状态：**已决策，阶段 A–D 已完成，阶段 E–F 待实施**。起因：用户提出测试和生产环境都不需要高频策略同步。

## 1. 决策记录（2026-09-22，用户确认）

1. 信封有效期定为 **60 分钟**（生产与测试一致）。
2. 接受“Platform 故障期间撤权延迟变长”；**Platform 故障时 Console 最多继续服务 24 小时**。
3. 采用“60 分钟有效期 + 24 小时故障宽限”：只有连不上 Platform 时才能用宽限；Platform 明确拒绝续签时不给宽限。
4. 四个步骤合并排期，先出实施计划，确认后再动手。生产配置和部署另行批准。
5. Platform 返回 401（凭据被拒）按 `refused` 处理，不给宽限。
6. 2026-09-22 确认从阶段 A 开始实施。

> **2026-09-22 评审修正**：当前实现只覆盖“Platform **策略接口**不可用”的宽限。Console 每次访问 Runtime 仍需 Platform 签发的短期启动令牌，Platform 整体不可用时服务仍会中断，决策 2 的“Platform 故障时继续服务 24 小时”要等评审 R1（稳态服务身份与 Platform 解耦）落地后才成立。**2026-09-23 更新**：R1 已实现并在 hzy0 实测 Platform 整体故障下的有效期与宽限期服务（策略验证合同 §15）；云端仍待 R1-6。续签失败分类同时收紧：响应无法验证记为 `invalid`（无宽限），本地失败不记录，`refused/invalid` 在同一信封上粘性保留。

## 2. 为什么现在同步这么频繁

现在的签名信封只有 5 分钟有效期，同步的主要作用是**续期**，并顺带传递变更。只把定时调慢，信封会先过期，Console 会失败关闭。所以要把同步承担的职责拆开：

| 职责 | 现状 | 目标 |
| --- | --- | --- |
| 传递变更（角色、授权、权益） | 1 分钟一次全量同步顺带完成 | **每分钟轻量检查**，修订号变了才下载 |
| 续期 | 每次都下载完整信封（约 727 KB） | **有效期 60 分钟**，距签发满 15 分钟才续签 |
| 租户停用、撤销 | 等 5 分钟后信封自然过期 | Platform **签发非 active 状态的信封**，下一次检查时立即生效 |
| Platform 故障 | 5 分钟后所有租户失败关闭 | 用最后一份真实信封继续服务，**最长到签发后 24 小时** |

### 现状依据（仓库代码，生产实际部署值未核实）

- Platform `policyEnvelopeDelivery.ts`：`expiresAt = min(now + maxAgeMs(默认 300000), policyExpiresAt)`，而且只给 `active` 行签发。
- 有效期上限写在四处，需要一起改：`platform/packages/authz-core/src/policy-envelope.ts`（`POLICY_ENVELOPE_MAX_AGE_MS=300000`，test 为 `93600000`）；Console `persistentPolicyBundle.ts` 的 `POLICY_MAX_AGE_MS`，以及 `bundleCache.ts` 的 `policyMaxAgeMs()`（非 test 环境强制 5 分钟）；Runtime Go 端 `internal/policyenvelope` 的 `MaxAgeMS/TestMaxAgeMS`，`internal/server/verified_policy.go` 读写时都会用到。
- 信封消费方有 4 个，都要实现同一套宽限规则：Foundation `verifiedPolicySnapshot.ts`（Console 读取）、Foundation `enterprisePolicyReader.ts` 和 Enterprise `enterprisePolicyGate.ts`（导航）、Runtime Go `policyenvelope`（`GET /v1/enterprise/console-policy` 只返回当前有效的策略）。
- 本机 hzy0：Gateway `policy-sync.mjs` 每 60 秒全量同步一次，每轮约 25–63 秒，瓶颈在 Platform 接口（首字节 8–60 秒）。
- Cloudflare Tenant Gateway：`runScheduledPolicyBundleSync` 只在 `* * * * *` 触发时执行，而 `wrangler.jsonc` 只配了 `*/5 * * * *`，`HZY_POLICY_SYNC_HOSTS` 默认为空。**按仓库配置，云端独立同步目前没有运行。**
- 心跳 `download_bundle` 由 Console 进程内的定时循环驱动，Cloudflare Workers 上跑不起来。因此版本检查统一改由 Gateway 定时任务驱动，不依赖心跳。
- `policyBundleV2` 包含 `roleAssignments`、`rolePermissionGrants` 等，**用户撤权也依赖策略传递**。

## 3. 目标设计

### 3.1 信封与宽限（签名内容的格式不变）

- Platform 签发：`expiresAt = min(issuedAt + 60 分钟, policyExpiresAt)`。
- 正常有效：`now < expiresAt`，且处于 `active` 状态。
- **故障宽限**：`expiresAt ≤ now < min(issuedAt + 24 小时, policyExpiresAt)` 时，只有满足以下全部条件才可以继续使用：
  1. Runtime 记录的续签状态为 `platform_unavailable`（调用 Platform 时网络错误、超时、408/429 或 5xx；Platform 应答但无法验证记为 `invalid`，本地失败不记录）；
  2. 最近一次续签尝试在 30 分钟以内，用来证明调度器还活着；调度器停摆不算 Platform 故障，60 分钟后照常失败关闭；
  3. 信封本身验签通过、绑定一致、状态为 `active`。
- **明确拒绝不给宽限**：Platform 返回经过认证的 4xx（租户停用、撤销、当前策略缺失、凭据被拒）时，状态记为 `refused`，信封按 60 分钟正常到期。
- **停用和撤销立即生效**：Platform 对 `suspended/revoked` 的租户签发对应状态的信封（`status` 字段已有），同步写入后 Console 读取时因为不是 `active` 立即拒绝。不需要另建推送通道。
- 宽限期内每次请求都记一条带固定阶段、不含凭据的告警日志，并在 Console 管理端显示“策略处于故障宽限”提示。
- 任何情况下都不超过 `policyExpiresAt`（许可到期）。宽限上限写成 authz-core 常量 `POLICY_ENVELOPE_OUTAGE_GRACE_MS = 86400000`，四个消费方统一引用。

### 3.2 检查与续签节奏

Gateway 定时任务**每分钟**调用一次 Console 同步端点，改成“检查模式”：

1. 用本地快照的 `policyRevision + payloadHash` 向 Platform 发起**轻量修订查询**（新增接口，或对现有接口做条件请求：未变化返回 304，不签名、不返回正文）。
2. 修订号变了、状态变了，或信封签发已满 15 分钟，才下载并写入完整信封。
3. 查询失败时，按失败类型写入续签状态（`platform_unavailable`、`refused` 或 `invalid`），并更新最近尝试时间。`refused/invalid` 在同一信封上是粘性的，不会被之后的故障或成功检查覆盖。

结果：完整信封传输约每 15 分钟一次（现在是每分钟一次），角色变更约 1 分钟加 30 秒复用时长后生效。

### 3.3 最坏情况对比

| 场景 | 现状 | 目标 |
| --- | --- | --- |
| 角色、授权变更 | ≤ 1 分钟 | ≤ 1 分钟 + 30 秒复用 |
| 租户停用、撤销（Platform 可达） | ≤ 5 分钟 | ≤ 1 分钟 + 30 秒复用 |
| Platform 故障期间的撤权 | 服务在 5 分钟后中断 | 最长延迟 24 小时（已接受） |
| Platform 故障期间的可用性 | 5 分钟后所有租户 503 | 最长 24 小时正常服务 |
| 调度器停摆 | 5 分钟后失败关闭 | 60 分钟后失败关闭 |
| 私有部署客户阻断 Platform 网络 | 5 分钟 | 最长 24 小时（已接受） |

## 4. 实施计划

各阶段按依赖顺序排列，每个阶段结束都要达到可验证的状态。

### 阶段 A：合同与共享核心（无行为变化）

**状态：2026-09-22 已完成（未提交，未接线）。** authz-core 新增常量与 `evaluatePolicyEnvelopeValidity`，Go 新增 `validity.go`，两端共用 `data-runtime/internal/policyenvelope/testdata/validity-vectors.json` 中的 17 条用例；合同见 `docs/Console-Enterprise-Policy-Verification-Contract.md` 第 14 节。验证：authz-core 40 项测试和 tsc 通过；Go `policyenvelope` 定向测试、gofmt 和 `go test ./...`（32 个包）通过。


- authz-core：新增 `POLICY_ENVELOPE_OUTAGE_GRACE_MS`，以及生产上限 `3600000` 的新常量；增加 `evaluatePolicyEnvelopeValidity(body, context, renewalState)` 纯函数，返回 `valid | grace | expired`。先不接线。
- Go `internal/policyenvelope`：实现同样的判定和常量，与 TS 共用一组跨语言契约向量（JSON 夹具）。
- 更新 `docs/Console-Enterprise-Policy-Verification-Contract.md`，新增一节：续签状态、宽限判定、失败分类和上限。
- 测试：TS 与 Go 契约向量逐项一致，覆盖正常、刚到期、宽限内、宽限到期、超过 `policyExpiresAt`、`refused`、调度器停摆、非 active 状态。

### 阶段 B：Runtime 续签状态（schema 变更）

**状态：2026-09-22 已完成（未提交，环境未迁移）。** 与原计划的差异：①存量行不回填，保持 NULL，含义等同“没有续签状态”，不给宽限；②`GET /v1/enterprise/console-policy` 暂不采用宽限判定，推迟到阶段 D 与其他三个消费方同时切换；③表未迁移时 GET 照常返回（`renewal` 为 null），只有续签写入返回 503，所以 Runtime 可以先于迁移发布。验证：隔离 MySQL 8.0.34 集成测试 31 个子测试通过（含续签路径的 10 项 Service Token 矩阵），变异检查能抓到“写入后不重置为 ok”，`go test ./...` 32 个包通过，schema 清单 `--check` 通过。


- `verified_policy_snapshots` 增加 `renewal_state`（`ok/platform_unavailable/refused/invalid`）和 `renewal_attempted_at`。补迁移，更新 `schema_manifest.json` 和对应的 `docs/*_schema.sql`。
- 新增只写续签状态的命令，要求精确 capability `console:policy-bundle:write`，并做 CAS/幂等（沿用现有 ETag 语义）。状态只能由同步器写入，不能被业务调用方设置。
- GET 回执带上续签状态；`GET /v1/enterprise/console-policy` 改用阶段 A 的判定函数。
- 测试：Go 全量测试；隔离 MySQL 迁移；存量行回填为 `ok`；按根规则执行 Service Token 回归矩阵（缺 capability、错 audience、错来源应用、错 tenant/deployment、过期、写入幂等重放）。

### 阶段 C：Platform 签发与轻量查询

**状态：2026-09-22 已完成（未提交，未部署）。** 与原计划的差异：①签发有效期没有直接改为 60 分钟，而是改为可配置，默认仍 5 分钟，到阶段 F 按发布顺序再切换；authz-core 生产上限没放宽之前，签发 60 分钟生产信封会在签名前被拒绝。②发现租户停用时原查询直接查不到行，返回 503，按新规则会被误判为 Platform 故障而获得宽限；现已改为签发状态信封。③Runtime 接纳规则同步放开同修订号内的状态变化（Go），否则停用信封会被拒收。验证：Platform 策略信封 9 项测试通过（含拒绝码分类、停用签发、修订查询、生产 60 分钟被拦截、路由与查询源码约束），Platform 全量 322 项中 320 项通过，2 项失败（企业目录、调度器清单同步）在本次改动之前的提交上同样失败；Platform typecheck 通过；Go `policyenvelope` 新增停用/恢复用例，`go test ./...` 32 个包通过。


- `policyEnvelopeDelivery.ts`：默认 `maxAgeMs` 改为 60 分钟；允许给 `suspended/revoked` 签发对应状态的信封（正文仍须与当前修订一致）。
- 新增轻量修订查询（鉴权与现有信封接口相同，只返回修订号、状态和 payloadHash，或对现有接口做 304 条件请求），不签名，也不返回正文。
- 失败分类：Platform 对“租户停用、撤销、当前策略缺失”返回稳定的 4xx 错误码，便于 Console 判定为 `refused`。
- 测试：Platform 信封契约测试；非 active 状态签发；条件请求命中和不命中；在测试环境核验签名密钥（沿用现有 signer）。

### 阶段 D：Console、Foundation 与 Enterprise 消费方

**状态：2026-09-22 已完成（未提交，未部署；hzy0 的 Console/Enterprise 因 dev 热更新已在运行新代码，Runtime 仍是旧版本）。** 与原计划的差异和补充：①修复了一个原计划没发现的生产问题：旧后端的企业权益新鲜度检查（生产 5 分钟）会让 60 分钟信封和宽限失效；②修订查询失败时回退到完整拉取，所以 hzy0 在阶段 E 之前行为不变；③同步器写入续签状态失败时只记告警，不再让同步端点返回 500（由新测试发现）；④管理端提示放在 Console 管理首页。验证：authz-core 40 项、Console 553 项（含新增续签与宽限 9 项、新鲜度 1 项）、Foundation 623 项、本机环境 65 项、Tenant Gateway 45 项全部通过；Platform 320/322 项、Enterprise 171/181 项，失败项与基线一致，没有新增；Console、Foundation、Enterprise、Platform typecheck 通过；Go `go test ./...` 32 个包通过，隔离 MySQL 集成测试新增 Enterprise 读取宽限 4 个场景，变异检查能抓到“放行过期信封”。hzy0 热更新后同步照常 `ready=true`（`mode=renewed`）。**未完成**：宽限提示的浏览器视觉验收，要在阶段 F 模拟 Platform 不可达时进行。


- Console 同步端点新增检查模式（第 3.2 节），按失败类型写入续签状态。
- Foundation `verifiedPolicySnapshot.ts`：`validUntil` 按判定结果计算，宽限期内返回宽限截止时间并带宽限标记；已上线的 30 秒复用缓存继续以这个截止时间为界。
- Foundation `enterprisePolicyReader.ts` 和 Enterprise `enterprisePolicyGate.ts` 采用同一套判定。
- Console `policyMaxAgeMs()` 的生产上限改为 60 分钟，test 仍允许配置但不超过宽限上限。
- 宽限告警日志和管理端提示。
- 测试：Console、Foundation、Enterprise 全量测试和 typecheck；按根规则执行授权完整回归矩阵（角色合并、模拟隔离、自定义角色、动作蕴含、数据范围、过期授权），外加新增的宽限、拒绝和停用场景。

### 阶段 E：调度

**状态：2026-09-22 本机部分已完成（未提交），云端部分按既有回滚规则暂不启用。**

- 本机：Gateway 每分钟先做修订查询，只有修订变化、Console 回报的续签时间（`renewAfter`，签发后 15 分钟）已到或下一轮就到、查询失败或上一轮失败时，才预取完整信封；**不论 Platform 成败都唤醒 Console**，否则故障期间 Console 永远记录不到 `platform_unavailable`，宽限不会生效（原实现预取失败时直接跳过唤醒）。私有通道新增修订路径，Platform 的 4xx（不含 408/429）保留状态码和经过清洗的错误码交给 Console，其余返回 503（原实现一律 503，会把拒绝误判为故障）。Console 本机插件放行修订格式。修订查询默认关闭，由 Gateway 环境变量 `HZY0_POLICY_REVISION_PROBE=true` 开启：旧版 Platform 不认识该格式，会落到旧策略包分支（很慢，且可能现场生成策略包）。2026-09-22 18:32:57–18:34:31 UTC 间，启用了修订查询的 Gateway 向开发环境 Platform 实际发出过一次这样的请求（返回 526KB 旧版策略包，耗时约 38 秒），18:52Z 在服务器上用只读事务核查开发环境 Platform 库：C000001 最新策略包仍是 2026-09-14 创建的第 14 号，`tenant_policy_revisions` 也停在 09-14，**这次请求没有生成策略包**。之后已关闭修订查询并重启 Gateway，同步照常 `ready=true`。验证：本机环境 67 项、Console 553 项通过。
- 云端：`runScheduledPolicyBundleSync` 仍然只在 `* * * * *` 触发时执行，而 `wrangler.jsonc` 自 2026-09-07 起有意只保留 `*/5 * * * *`：当天生产的分钟级同步让 Console Worker 超出 Workers Free 10ms CPU 上限（`exceededCpu`），已回滚到 memory 后端，运行手册要求“未经实际容量及持续运行验证不得重新启用”。verified 后端完整续签一次要对约 727KB 信封验签和解析多遍（本机实测单次 18–20ms CPU），检查模式只能省掉大多数分钟的完整拉取，省不掉每 15 分钟一次的续签，所以在 Free 计划下必然超限。**重新启用前需要决定**：升级 Workers 付费计划（CPU 上限可配置到 30 秒），或缩小信封（例如按应用拆分），然后完成容量测试和持续运行验收（连续跨多个续签窗口、快照持续推进、登录与授权正反例）。

- 本机 `policy-sync.mjs`：每分钟调用检查模式，失败退避不变；去掉“每分钟全量”的假设。
- Cloudflare Tenant Gateway：让策略检查真正运行。在 `wrangler.jsonc` 增加 `* * * * *`，或改为按 `*/1` 执行检查分支；配置 `HZY_POLICY_SYNC_HOSTS`。按租户数核算单轮预算：检查模式很轻，100 个租户在 45 秒内可以完成。
- 更新 `validate:business-cloudflare` 和相关配置校验测试。

### 阶段 F：环境切换与验收

**状态：第 1 项（hzy0 本机）已在 2026-09-22 18:45Z 切换，正在观察，详见本机验收记录。第 2 项（阶段 C 发布到开发环境 Platform）已在 18:58Z 完成并持久化，本机 Gateway 已打开修订查询。第 3 项待决策。**

2026-09-22 21:19Z 完成故障宽限的实际验收（过期后进入宽限、明确拒绝时失败关闭、恢复后自动续签），详见本机验收记录；管理首页提示的视觉验收留到云端测试环境。

打开修订查询后，前 4 轮仍然每轮都预取完整信封：Gateway 原本只在 Console 取走信封时记为已交付，而 Console 走的是修订号不变的轻量路径、不取信封，所以 Gateway 一直没有交付记录。已改为由 Console 同步结果回报 `renewAfter`，Gateway 据此确认交付并决定何时预取（本机环境 68 项、Console 553 项通过）。

第 2 项：用户批准后，以线上候选 `policy-lease-20260922` 为基础，只覆盖 7 个文件（修改前的哈希与仓库 HEAD 一致，authz-core 为阶段 A 之前的版本），经 `deploy/test-env/platform-policy-renewal-release.mjs` 的 prepare/check/cutover/persist 四步发布。服务器端 lint（首次运行发现测试文件一处引号风格问题，本地修复后重新执行）、typecheck、15 项信封测试和 node 构建通过。切换探测：health 200、匿名 403、信封 200 且仍是 26 小时测试有效期、修订查询 200 且与信封一致、不存在的部署返回 `409 policy_envelope_current_missing`、历史版本 400、策略包行数据未变、其他进程未变。只更新了目标进程的 PM2 保存条目。回执：`deploy/test-env/artifacts/C000001.platform-policy-renewal-deployment.json`；回滚配置在回执的 `rollbackConfig`。通用签发有效期变量仍未设置（默认 5 分钟）。

1. **hzy0 本机**：先切换并观察至少 2 小时，跨两个续签窗口。验收项：角色变更约 1.5 分钟内在导航中生效；模拟 Platform 不可达（关掉本机到 Platform 的出站）后，60 分钟以后仍能服务且日志进入宽限；模拟明确拒绝后，60 分钟后失败关闭；把租户设为 suspended 后约 1.5 分钟内拒绝。
2. **云端测试租户**：部署 Platform、Runtime、Console、Gateway（需要批准），用实际 service client 对 `console:policy-bundle:read|write` 做签发探测，重复上述验收。
3. **生产**：单独批准。按 Runtime → Console/Enterprise → Platform 轻量查询与非 active 签发 → Gateway 检查调度 → 最后改 Platform 签发 60 分钟的顺序发布（见下方“发布顺序与兼容”）；发布前确认生产实际的 cron、`HZY_POLICY_SYNC_HOSTS` 和后端选择。

### 发布顺序与兼容

- 先发 Runtime（新字段可空，与旧版兼容）和 authz-core 判定，最后再改 Platform 的签发有效期。旧消费方会拒绝有效期超过 5 分钟的信封，所以 **Platform 改为签发 60 分钟信封，必须在所有消费方（Runtime、Console、Enterprise）都支持新上限之后**，否则会造成全面失败关闭。
- 回滚：Platform 改回签发 5 分钟信封即可，新消费方兼容更短的有效期；Runtime 的新字段保留不用。

## 5. 待确认与风险

- 生产实际的后端（`memory`、`runtime` 还是 `verified-runtime`）、cron 和 `HZY_POLICY_SYNC_HOSTS` 需要在云端核实，这决定阶段 E 的具体改法。
- 私有部署客户可以伪造 Platform 5xx 来换取 24 小时宽限，这属于已接受的风险（决策 2）。
- 工作量（相对）：阶段 A 小、B 中（Go 加迁移）、C 中、D 大（多消费方加完整回归）、E 小、F 按环境逐步推进。
