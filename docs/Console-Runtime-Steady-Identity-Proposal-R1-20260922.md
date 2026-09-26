# R1 方案草案：Console 稳态服务身份与 Platform 解耦

日期：2026-09-22。状态：**已决策并实现代码**（方案 A；公钥自动登记，不需人工确认；G1 放行前完成）。落地合同见 [策略验证合同 §15](./Console-Enterprise-Policy-Verification-Contract.md#15-console-稳态服务身份r12026-09-22-决策代码已实现)。来源：策略续签评审 R1。

## 1. 问题

“60 分钟有效期 + 24 小时故障宽限”（[评估](./Policy-Sync-Cadence-Assessment-20260922.md)）只解决了策略信封续签。Console 访问自己的 Runtime 时还有一条更早的依赖：

1. Console 访问 Runtime 需要 Console 服务令牌，而令牌只能由 Runtime 的 `console:service-token:issue` 签发；
2. 调用这个签发接口，只能出示 Platform 签发的 `platform_runtime_bootstrap` 令牌（受众 `data-runtime-bootstrap`，有效期不超过 2 分钟；`foundation/server/utils/tenantRuntimeClient.ts` `requestPlatformRuntimeBootstrapToken`，`data-runtime/internal/auth/auth.go` `authenticatePlatformBootstrap`）；
3. 启动令牌由 Platform 按需签发，由 Tenant Gateway（hzy0 为本机 Gateway 的 Console facade）取得后转发给 Console，缓存约 90 秒；取不到时整个请求失败。

因此 Platform 整体不可用约 2 分钟后，Console 拿不到新的服务令牌，登录、目录、策略读取都会 503，24 小时策略宽限实际用不上。现有验收（策略接口故障开关）没有覆盖这种情况，文档已收窄为“策略接口故障宽限”。

本次盘点中，Console 请求路径上的 Platform 依赖只有两处：启动令牌和策略续签（已有宽限）。`platformLifecycleOperation` 是后台补偿任务，故障期间延后执行即可，不在本方案范围。

## 2. 目标与约束

- Platform 整体不可用时，Console 可以继续服务，最长到策略宽限的上限（签发后 24 小时，且不超过许可到期），与已接受的决策 2 保持一致。
- 撤权语义不变：签名的停用、撤销信封立即生效；`refused/invalid` 不给宽限；调度器停摆 30 分钟后失去宽限。
- 不引入长效 Bearer 令牌、共享静态密钥或“内网默认可信”（根 `CLAUDE.md` 内部服务认证规则），不把启动令牌延长到 24 小时。
- Runtime 仍然是 Console 服务令牌的唯一签发方；精确 capability、`source_app/target_app`、tenant/deployment 校验全部保留。
- 平台正常时行为与现在一致，新增路径只作为 Platform 不可用时的替代。

## 3. 方案

### 方案 A（推荐）：Console 部署密钥 + 签名信封授权

Console 每个部署持有一把 Ed25519 私钥，公钥由 Platform 写进签名策略信封，Runtime 用“当前有效（含宽限）的信封”来认这把钥匙。

1. **登记**：Console 部署安装时生成密钥对（云端存为 Worker Secret，本机存在运行目录 `0600` 文件）。Console 在策略同步时自动把公钥登记到 Platform（用户决定不需人工确认，以 90 天有效期、每部署最多 2 把和撤销不可恢复作约束）。私钥不离开 Console。
2. **授权**：Platform 在信封正文加入可选字段 `serviceKeys: [{ deployment, kid, publicKey, notAfter }]`（放在签名正文而非 payload，登记公钥不需要生成新策略修订；没有公钥时省略，旧正文不变）。Platform 撤销密钥只需签发新信封。
3. **使用**：Console 调用 `console:service-token:issue` 时，先用启动令牌（现状）；Platform 不可达而取不到启动令牌时，改为出示用私钥签名的短期断言（`iss=sub=console:{deployment}`，`aud=hzy-runtime-service-token-issue`，有效期不超过 60 秒，带 `jti`）。
4. **Runtime 校验**：断言签名 → 在 `verified_policy_snapshots` 当前信封中找到同 `kid` 的公钥 → `EvaluateValidity` 结果为 `valid` 或 `grace` → tenant/deployment 绑定一致 → `jti` 在有效期内未用过（存数据库，失败关闭）。通过后只签发 `console:service-token:issue` 原本允许的令牌，权限不扩大。（实现时去掉了 runtimeCode：Console 不掌握它，而信封本身已绑定该 Runtime 保存的 Console 部署。）
5. **失效**：信封过期且不在宽限内、状态非 `active`、续签状态为 `refused/invalid`、公钥从新信封中移除或过了 `notAfter`，断言即被拒绝。宽限本身的边界（24 小时、30 分钟调度活性、许可到期）自动传递到身份上。

优点：没有新的有状态凭据，信任根仍是 Platform 签名；撤权沿用信封机制；Runtime 已经具备所需的信封和续签状态。代价：信封 payload 新增字段，四个读取方需要容忍它（authz-core 与 Go 契约用例同步）；需要新增密钥登记和轮换流程；私钥是长期机密，泄露后在信封撤销并送达前一直可用（与现有 Worker Secret 风险同级）。

### 方案 B：Runtime 签发的可轮换续期凭据

Console 每次用启动令牌换服务令牌时，Runtime 额外签发一个不透明续期凭据（Runtime 只存哈希，绑定部署，每次使用即轮换，有效期上限为当前信封的宽限上限）。Platform 不可用时，用续期凭据换服务令牌。

优点：不改信封格式，不需要密钥登记。缺点：Console 需要持久化一个不断轮换的凭据——云端 Worker 没有合适的本地持久化（多实例并发轮换会互相作废，需要 Durable Object 或 KV 协调），这正是 Console 当前刻意避免的状态；凭据泄露后可被重放直到下一次轮换。**本机和私有部署可行，云端复杂度高**，不推荐作为统一方案。

### 不采用

- 延长启动令牌有效期到 24 小时：等于 24 小时 Bearer 令牌，Platform 无法提前撤销。
- Gateway 内部令牌直接作为 Runtime 身份：共享静态密钥，违反内部服务认证规则。
- Platform 不可用时放宽 Runtime 鉴权：违反失败关闭原则。

## 4. 实施阶段（方案 A）

| 阶段 | 内容 | 验证 |
| --- | --- | --- |
| R1-1 | authz-core / Go：信封 Console 部署条目增加 `serviceKeys` 的解析和契约用例；未知字段兼容 | TS/Go 共享用例 |
| R1-2 | Platform：部署密钥登记表、自动登记、写入信封；轮换（新旧 `kid` 并存）和撤销 | Platform 测试 + 开发环境部署 |
| R1-3 | Runtime：断言认证分支（只开放给 `console:service-token:issue`）、`jti` 防重放表与迁移、`EvaluateValidity` 门槛 | 正确断言、错 `kid`、过期信封、宽限内、`refused`、停用信封、重放、错 tenant/deployment、断言过期的完整矩阵 |
| R1-4 | Foundation：`resolveBearerToken` 在启动令牌不可用时改用断言；私钥读取只走受控配置 | 单元测试 + 故障注入 |
| R1-5 | hzy0 验收：阻断 Console → Platform 全部出口（不只是策略接口），确认服务持续、宽限告警出现、恢复后回到启动令牌；再验 `refused` 与停用信封 | 验收记录。**2026-09-23 完成**（停用信封仍待实测）；R1-1～R1-4 代码与测试完成，R1-2 已发布开发 Platform |
| R1-6 | 云端：Worker Secret 配置与 Gateway 路径，**生产另行批准** | 目标环境 grant 与令牌签发探测 |

## 5. 用户决定（2026-09-22）

1. 采用方案 A。
2. Console 公钥自动登记，不需要 Platform 管理员人工确认。
3. 在 G1 放行前完成。
