# Console → Enterprise：策略验证合同核查

日期：2026-09-21。范围：用户批准的第 1 步，核查策略签名、持久化完整性及
Runtime 读取合同。基于当前未提交工作区，不是固定制品验收或迁移完成声明。

**当前状态：hzy0 已切换完整签名策略链，浏览器登录、主导航和“我的文档”列表
已现场通过。** 开发 Platform 已发布（第 11 节）；本机固定 Runtime、新表、Enterprise
精确只读授权、Console 新后端、Host 独立读取校验和两分钟同步已启用（第 12 节）。
生产及其他云端应用未发布，其他环境默认关闭。仍不是 G1/完整业务验收。
下文第 1～11 节保留各批次历史事实，不代表最新阻塞状态。

2026-09-21 前置只读预检见第 10 节，获准 Platform 发布见第 11 节。上游新格式
缺口已解除；最新本机切换与剩余验收项见第 12 节。

## 1. 结论与现场证据

`policyVersion=null` 的故障链已确认：

1. 本地 Console 通过正式 Runtime 身份读取当前策略记录。
2. 持久化封包由既有 Gateway 完整性密钥封装，本地 Console 使用独立入口密钥。
3. `readPolicyBundle()` 的 HMAC 验证失败，旧 `loadOidcPolicyDigest()` catch
   将失败折叠成空摘要，因而可产生 authenticated=true、policyVersion=null。
4. Enterprise `validatedSessionScope()` 正确拒绝空版本；先前本地候选已改为
   策略读取失败时签发前返回 503，不再生成此类不完整令牌。

本次真实只读探针结果（只输出布尔值，不落盘策略内容或凭据）：

| 检查 | 结果 |
| --- | --- |
| 正式精确 `console:policy-bundle:read` 签发、Runtime GET | 成功 / 200 |
| 记录存在、外层及 payload 租户 C000001、环境 test、scope | 匹配 |
| 策略版本 | 存在 |
| Platform kid、公钥签名、`sha256_` payload 哈希 | 全部通过 |
| 既有 Gateway 密钥 HMAC | 通过 |
| 本地 Console 密钥 HMAC | 失败 |
| 探针时同步年龄 | 约 1511 分钟，仍在已配置 1560 分钟测试窗口内 |

年龄只是探针时事实，不是持续有效保证。过期后仍须失败关闭，不提高现有窗口、
不重写 syncedAt；本次未执行策略同步。正式短期服务令牌签发会产生正常认证审计，
除此之外未写业务数据、策略、grant、数据库配置或云端部署。

复核工具：`node deploy/test-env/local-enterprise/inspect-policy-contract.mjs --live-read`。
工具只适用当前固定 hzy0 测试 profile，并校验保护文件权限与 PM2 进程归属；
不会输出令牌、密钥、原始封包或用户内容。它是诊断工具，不是运行期验证旁路。

## 2. 目前实际签了什么

| 内容 | 当前保护者 | 不能误认为 |
| --- | --- | --- |
| payload 中 tenant、environment、deployments、policyRevision、角色/授权、enterpriseEntitlement 等 | Platform Ed25519 对规范化 payload 签名 | 外层 metadata 同样被签名 |
| 外层 bundleVersion、status、expiresAt、signedAt、deploymentCode 等，以及 scope/syncedAt/cachedAt | 受信同步器从 Platform 响应取得后，HMAC 封住整条持久记录 | 仅验 payload 公钥签名即可相信这些字段 |
| 同步新鲜度 | 已校验封包的 syncedAt、cachedAt 与测试/正式窗口 | payload.generatedAt 等于最近同步成功时间 |
| 最新版本与防回退 | 当前持久记录、Console CAS/修订水位校验及刷新合同 | 有效签名天然证明它是最新策略 |
| Runtime 数据访问 | 精确 service claims、tenant/deployment、实时 credential/grant 检查 | 获准读取意味着 Runtime 已替客户端验证封包密码学完整性 |

Platform `generatePolicyBundle()` 在签 payload **之后**才生成外层 bundleVersion。
`expiresAt`、行 status 和 signedAt 也不在这份签名输入内。payload 中虽有自身
schemaVersion、generatedAt 和授权有效期，它们不能替代全部外层生命周期字段。

来源：`platform/server/utils/policyBundle.ts` 的 generatePolicyBundle；
`console/server/utils/platformRuntime.ts` 的 fetchAndVerifyPolicyBundle；
`console/server/utils/persistentPolicyBundle.ts` 的 encode/decode 及读写时效合同。

## 3. Runtime 当前能力与缺口

`GET/PUT /v1/console/policy-bundle` 是存储合同，不是已验证策略投影合同：

- GET 按已认证 tenant、Console deployment、object key 读 `envelope/etag`。
- PUT 校验结构、绑定、同步时间和 CAS，要求精确 write scope；不验证 Platform
  Ed25519 或封包 HMAC，现有代码明确依赖 Console 同步器事先验证。
- 路由拒绝缺 scope、错 issuer/audience/source/tenant/deployment、失效凭据。
- 读取 token 的既有精确例外不先读取策略摘要，避免启动循环；不能扩大到其他 scope。
- 当前来源固定 console、存储行绑定 Console deployment。不能简单把调用方改成
  enterprise、伪造 Console header 或加宽 source allowlist，宣称已经完成组合。

因此，不能直接把该 GET 改名为“可信策略接口”后忽略 HMAC，也不能让 Host
自填 policyVersion 作为 Runtime 权威授权证据。现有 token 中摘要字段由门面
提供，不代表 Runtime 对整份策略进行了独立验证。

来源：`data-runtime/internal/apps/console/policy_bundle.go`、
`data-runtime/internal/server/server.go` policy-bundle 分支及
`console/server/plugins/service-token-issuer.ts`。

## 4. 最小安全修复合同（代码内核已实现，尚未启用）

采用明确版本的新策略交付合同，而非为本地独立 Console 增加 Gateway 验证通道：

1. **Platform 签完整策略信封。** 新 schema 的签名输入同时包含用途/版本、
   tenant/environment、适用部署范围、bundleVersion、policyRevision、payload
   哈希、状态、签发/到期时间与 payload。固定规范化算法、alg/kid 与受信公钥来源；
   不从封包提供的任意 URL 下载密钥。旧 payload 签名不能冒充新信封签名。
2. **Runtime 管可信持久状态。** 新入口在接纳时验证签名与绑定，记录 Runtime
   自己的成功同步时间/最新修订水位，执行 CAS 和防回退。读取提供完整签名信封及
   当前受控状态；不能把 Host 上传的 syncedAt 当权威，也不能把旧 opaque 行
   未经重新验证直接提升成新格式。Platform 暂不可用时不重置同步年龄。
3. **Enterprise 内 Console 模块验证并消费。** 用公开密钥验证信封，检查本次
   受信租户/环境/部署、状态、时间及版本；结合正式 Runtime 当前状态控制缓存时效。
   不持有 Gateway HMAC 密钥、Platform 私钥或通用策略重签能力。普通业务页面
   仍消费统一权限 helper，不分别解析策略。
4. **精确组合身份。** 明确 enterprise workload 对该 Console 安全域读接口的
   正式 capability、目标安全域 binding 和审计主体；保持 Host 物理来源 enterprise，
   不能因为同进程而继承全部 Console 权限。日常 workload 与 enrollment 分开。
5. **兼容而非覆盖。** 新旧版本显式登记、分别验证。旧消费者继续旧 HMAC 合同；
   新消费者不在失败后退回无校验旧包。需要新存储格式/路径时与旧记录隔离，
   不用本地密钥覆盖共享封包，不改变 OIDC issuer/client/回调。

这一步需要 Platform 签名合同和 Runtime 接纳/读取合同的小范围增量，不能只改
Enterprise 配置就安全修复。实现可先在隔离夹具里完成；真实切换是后续发布动作。
不要求同时迁移 Console 页面、数据库、OIDC 协议模块或全部策略授权算法。

## 5. 第 1 步核查验证与后续放行门槛

已执行：新增 5 项密码学覆盖测试、24 项 Console 持久化/缓存/启动例外/失败关闭
测试全部通过；Go `go test ./internal/apps/console ./internal/server -run TestPolicy
-count=1` 两个包通过，使用夹具/SQLmock，未连接真实 MySQL。

新增测试明确证明：修改外层版本/状态/到期/同步时间不破坏旧 payload 签名，
但会破坏 HMAC；修改 payload 同时破坏 hash/signature/MAC；错 key、绑定、时效
分别拒绝。这些是合同证据，不是新合同已实现的证据。

下一批必须覆盖：正确新包、错签名/kid/算法、metadata 篡改、错租户/环境/部署、
过期/未来同步、旧包重放/并发落后写、撤销 writer/read grant、Runtime 不可用、
新旧读取兼容，以及登录→有版本会话→导航的真实链路。既有 26 小时测试窗口
不能自动沿用到生产（生产默认 5 分钟），也不能作为删除同步机制的理由。

本轮完成了原因验证与修复合同核查，**尚未恢复本地登录闭环**；维持 503
失败关闭，不宣称策略验证迁移或 G1 完成。没有启动协议模块组合、停止进程、
部署云端、提交 Git 或更改任何安全配置。

## 6. 后续实现批次：完整信封与接纳规则内核

2026-09-21 第一实现批次记录（后续持久化进展见第 7 节）。代码与正式运行路径明确分开：

| 位置 | 已实现 | 尚未实现 |
| --- | --- | --- |
| `platform/packages/authz-core/src/policy-envelope.ts` | server-only Ed25519 验签、严格字段/绑定/生命周期校验 | 动态密钥轮换协议，不接受包内密钥 URL |
| `platform/server/utils/policyEnvelope.ts` | 通过显式受信 signer 签完整信封；签名前检查大小 | 从正式当前策略记录生成并接入 Platform 交付路由 |
| `data-runtime/internal/policyenvelope` | Go 独立验签与 `Prepare` 接纳规则 | 持久表、事务锁/CAS、新 HTTP 路由、正式身份与实时 grant 检查 |
| `foundation/server/utils/verifiedPolicySnapshot.ts` | Host 复验签名、绑定、回执一致性与缓存截止时间 | 经正式受认证 Runtime transport 读取并替换 Console 消费路径 |

### 字节与字段合同

- 外层只允许 `schema/alg/kid/body/signature`，schema 为 `hzy-policy-envelope.v1`，
  alg 固定 Ed25519，kid 必须命中服务端钉住的公开信任锚。
- 签名输入为 UTF-8 的 `hzy-policy-envelope.v1\n` 加 `body` 原始字符串，
  不在验签端重新序列化。payload 也保存为原始 JSON 字符串，哈希为
  `sha256_` 加这些 UTF-8 字节的 SHA-256；Node/Go 用同一 Unicode 夹具验证。
- body 仅含 13 项：`purpose/issuer/tenant/environment/deployments/bundleVersion/`
  `policyRevision/status/issuedAt/expiresAt/policyExpiresAt/payloadHash/payload`。
  purpose 固定 `enterprise-policy`；issuer 为受信 HTTPS origin。
  所有时间使用安全整数 epoch 毫秒，`policyExpiresAt` 必须出现，可为 null。
- body 上限 4 MiB；payload 内 tenant/environment/revision/active deployment 与
  信封一致。有效窗口默认 5 分钟，仅 test 可显式选择既有 26 小时测试窗口，
  不自动扩展任何运行实例的配置。信封到期不能超过原策略到期。
- suspended/revoked 可接纳为 Runtime 当前状态，但 Host 不得用于授权。

### 当前状态与防回退合同

`Prepare` 输入是已认证配置派生的 context 和可信持久旧行，输出 tenant/env/
deployment、完整信封、ETag、Runtime acceptedAt、revision/issuedAt/hash。
ETag 计算 kid、原始 body 和 signature，不依赖外层 JSON 排序或转义。
相同 ETag 的重放返回原 acceptedAt，不能续鲜；新包拒绝修订回退或签发时间不递增。
同一 revision 续签只允许新签发/到期窗口，payload 字节、bundleVersion、status、
deployments 和 policyExpiresAt 都必须保持一致。包括 payload.generatedAt 在内的
事实变化必须由正式生产者推进 revision，不能重新生成不同 payload 却复用旧修订。

**这些目前是纯函数规则，不是已落盘的防回退保障。** 后续必须在数据库事务内
读取旧行并持锁/CAS 写入，过期行仍保留修订水位，不能靠进程内状态替代。
签名证明来源和内容，不证明“最新”；Host helper 只接受受认证 Runtime 当前读取
结果，回执元数据本身不是可交给浏览器携带的授权证明，也不是单独签名的回执。
旧 opaque GET 不可直接传入此 helper，网络失败不降级旧包。

### 验证与剩余实施

已通过 Platform/Foundation 9 项 Node 测试、Node→Go 同夹具互通与篡改/绑定/
生命周期/重放/同修订冲突测试；Go 目标包竞争检测通过。Platform 与 Enterprise
类型检查通过。测试使用临时生成密钥；跨语言夹具只保存公钥和测试信封，无私钥。
未连接真实 MySQL，未修改任何运行实例、schema、grant 或云端配置。

后续顺序仍是：Runtime 持久化及精确读写合同 → Platform 正式交付与 Host 正式
读取接线 → 真实 grant/依赖/失败路径核验 → hzy0 登录、版本、导航验收。
并发 CAS、撤权、重启、依赖不可用、新旧兼容和真实登录仍未取得闭环证据。
当前不能宣布策略迁移完成、本地登录恢复或 G1 放行。

## 7. Runtime 持久化与接口批次（代码验证完成，环境未启用）

2026-09-21，当前未提交工作区。新增 `GET/PUT /v1/console/verified-policy`，
保留 `/v1/console/policy-bundle` 不变。新表 `verified_policy_snapshots` 仅存完整
信封及 Runtime 回执，以 tenant/environment/Console deployment 唯一绑定；不拷贝
旧 HMAC 行。单独迁移 SQL 已提供，未在任何现有环境执行。

### 入口与部署合同

- 仅正式 service JWT，严格 issuer/audience/token_use/source/target/tenant/deployment/
  credential/expiry 校验，要求已登记 Console deployment binding；静态令牌和
  disabled auth 均不能访问。当前仅 Console source，尚未开放 Enterprise source。
- 复用 `console:policy-bundle:read|write` 精确 capability，已补 manifest 声明，
  不增加 grant、自动安装或扩大策略签发启动例外。每次调用实时检查凭据与 grant。
- 仅本地配置 `apps.console.policyEnvelope = {enabled:true, environment:"test",
  maxAgeMs:300000}` 显式启用；默认关闭。环境不从 body/query/header 推导。
  信任锚复用受信 `control.platformUrl/platformSigningKeyId/platformSigningPublicKey`。
  prod/dev 最大 5 分钟；test 的更长窗口必须显式配置，上限 26 小时。
- 新表不进入旧实例必需 schema gate，避免未启用功能影响既有环境。
  启用前必须单独安装/核验迁移；缺表不自建，接口返回脱敏 503。

### 读写语义

PUT 只接受 `{envelope, expectedEtag}`：首次为空 ETag，后续使用 GET 或成功 PUT
回执中的 ETag。完整验签后，事务内用占位插入及 `SELECT ... FOR UPDATE` 串行化
首次与后续写入，持锁期间重新检查时间；未通过验证、CAS 或数据库错误均回滚。
相同签名内容的重试返回原回执，相当于稳定内容键幂等，不另设可复用的任意请求键。
新包 CAS 失败 409，错误/回退包 400，缺权或撤权 403，依赖/配置不可用 503。
读取与更新复用 Runtime 的 requestId/主体/operation 结构化审计，不记录包内容。

GET 返回当前回执，重新验证签名、租户绑定和接纳时有效性，且不改变 acceptedAt。
**允许返回已过期或撤销信封，以便获准同步器拿到 ETag 后恢复；HTTP 200 不代表
策略可用于授权。** Host 必须继续使用完整信封 verifier 校验当前时间和 active
状态。两端都不把过期水位删除或变成空行，也不在缺依赖时读取旧表降级。
新旧接口响应均为 no-store。

### 本批验证证据

`node data-runtime/scripts/test-enterprise-policy-store-mysql.mjs` 使用新建临时
MySQL 8.0.34、随机 loopback 端口和测试密钥，执行新旧两个 HTTP 集成测试并开启
Go race detector。覆盖：精确权限、错误 source/target/tenant/deployment/audience/
issuer、过期 Token、缺 credential、初次写、读回、同键重放、服务器对象重建后
持久回读、并发唯一胜出、CAS 冲突、过期水位防回退及恢复、即时撤权、配置关闭/
缺失、生产窗口拒绝、存储缺失；全部通过。测试清理了其一次性数据库和临时目录，
未连接或更改 hzy0 现有数据库。

`go test ./internal/auth ./internal/config ./internal/apps/console ./internal/server
./internal/policyenvelope` 五包通过。临时 MySQL 实测独立执行，不将普通测试中的
环境依赖 skip 算作联调通过。下一批仍须完成 Platform 正式交付、Enterprise 的精确
读取身份与 Host 在线消费，再进行获准 hzy0 切换和真实登录验收；不能据此声称登录恢复。

## 8. Platform 交付与 Enterprise 只读路径（候选接线，未启用）

2026-09-21 当前未提交工作区：

- 原正式 `/api/platform/internal/console/tenants/{tenantCode}/bundle` 和
  `/api/v1/runtime/deployments/{deploymentCode}/bundle` 的鉴权入口不变，新增显式
  `format=hzy-policy-envelope.v1` 分支。拒绝 version/bundleVersion 历史选择，
  不返回旧 ETag 304，不生成策略，也不查询更早的 active 包作为回退。
- 新查询按 tenant/environment 选择最大 bundle id，要求目标部署/租户 active、
  target 关系存在、tenant_policy_revisions 当前修订一致，再验证 payload 哈希与
  内外绑定。最新记录缺失、撤销、过期或正文不一致均不能续签。既有策略生成流程
  仍负责产出当前事实，本分支不将过时事实改名为新策略。
- 使用现有 Platform 正式 signer；issuer 仅取受信服务端配置
  `HZY_PLATFORM_POLICY_ENVELOPE_ISSUER`（默认空，缺失失败关闭），不取 Host header。
  每次续签最多 5 分钟且不越过原到期，同一修订的正文/版本不变；生产私钥不进入 Host。
- 新 `GET /v1/enterprise/console-policy` 要求额外开启 Runtime
  `apps.console.policyEnvelope.enterpriseReadEnabled`，保留真实 Enterprise source、
  deployment 和精确 `console:policy-bundle:read`。从本地登记的 Console deployment
  当前行读取，并要求同一签名同时覆盖 Console 与 Enterprise 部署；只向调用方投影
  deployment，ETag/acceptedAt/正文保持原值。不接受路径/query 选择任意租户/目标。
  PUT 等方法 405，Console 身份不能调用 Enterprise 路径。该读口只返回当前有效
  active 策略；与同步器可读过期水位的 Console GET 不同。
- Foundation `readEnterprisePolicySnapshot()` 经共享 tenantRuntimeClient 请求上述
  唯一 GET，以 enterprise 自身运行身份获取短期 token，随后复验信封/当前时间/
  回执。无 fallback、不吞 403、不缓存续鲜、不新增 Gateway 策略验证通道。
- Enterprise 导航在 `HZY_ENTERPRISE_VERIFIED_POLICY_ENABLED=true` 时，先从受信
  Gateway 获取 Host tenant/deployment，再使用服务端 issuer/kid/publicKey/environment
  校验，要求用户会话 policyVersion 与当前 bundleVersion 相同。版本变化 401、
  验证依赖错误 503。默认关闭，其他部署不受影响。**这是附加放行检查，不是已完成
  Console 权限算法、协议模块或全部 API 的迁移**；既有角色/数据范围判定保留。

精确 read grant seed/verify 已提供但未执行，保留已禁用 grant，不为 Enterprise
授予 write。复用既有两种 Runtime audience 的策略存储签发例外，不扩大 scope；
启用前须以真实客户端验证两种 audience 的签发及 Runtime 的绑定/撤权。

验证：Platform 9 项签名/续签/拒绝旧记录测试，Foundation 4 项回执/实际 loopback
HTTP transport 测试，Host gate 组件依赖替换测试通过；Runtime 临时 MySQL/race
测试新增真实 Enterprise JWT、显式启用、部署双覆盖、只读、撤权验证通过。Platform
与 Enterprise 类型检查通过。Platform 当前行 SQL/路由分支另有源码合同断言，
尚无真实 Platform DB/签名密钥/已部署路由证据，不冒充完整现场联调。

本批当时剩余主项：同步器请求新格式并 CAS 写入新表、Console 当前消费者改用新签名回执
（后续代码进展见第 9 节）；之后才准备获准环境的安装、身份核验、hzy0 登录/导航验收。此次未部署云端、
修改运行配置/凭据、注册 Console 页面或提交 Git。

## 9. 同步与 Console 消费者候选接线（未切换运行环境）

Console 仅在 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND=verified-runtime` 时使用新路径：

1. 现有受保护同步入口及 Platform transport 不变，托管/独立两种 bundle 请求都
   显式协商完整信封；以私有配置的 Platform origin、kid、公钥、tenant/environment/
   Console deployment 复验。不接受旧格式响应，不以信封提供的地址查钥。
2. Foundation 使用 Console 自身 `service-client-policy` 身份和精确 read/write，
   请求固定 `/v1/console/verified-policy`，不发送可选租户、部署或任意存储 key。
   仅 `404 policy_snapshot_missing` 表示首次未建行；路由 404、缺表、503、403
   均不是空状态。Runtime 缺表保持 503，Enterprise 缺状态仍保持 503。
3. 同步器验证旧回执在接纳时有效，保留已过期/撤销水位作 CAS 前提；它不能供授权。
   写入使用原始信封和 expectedEtag；409 只读取并验证当前胜出记录，不强写。
   相同信封丢响应后重试由 Runtime 返回原 acceptedAt，不续鲜、不重新签名重试。
   后续一次定时调度可以从 Platform 获取新签发信封，仍须通过同修订/时序约束。
4. Console 读取时验证 Runtime 回执和当前时刻；不读旧 HMAC 表，不命中旧进程缓存，
   不复制 Gateway 密钥，不给兼容 `CachedPolicyBundle` 自造新鲜时间。
   同步成功后使用实际持久化胜出记录报告版本，避免 CAS 失败输入被误报为当前值。
   2026-09-22 用户决定接受更长的撤权生效时间后，已验证的结果可在当前 isolate/进程内
   跨请求复用（`verifiedPolicyReadCache.ts`）。复用时长取 `HZY_PLATFORM_BUNDLE_MEMORY_TTL_MS`
   （默认 30 秒），且不超过策略最大有效期；按信任密钥和绑定上下文分别缓存，任何时候
   都不越过签名截止时间。失败和缺失不缓存。同步写入会立即替换缓存，更早发起的读取
   不能覆盖它。因此撤权或策略变更最多延迟一个 TTL 生效（其他 isolate 同样如此）。
5. 新后端下策略缺失、过期、损坏均不能签发无 policyVersion 会话；本地门面原有
   失败关闭逻辑保留，未选择新后端的历史路径不自动改变。

验证：Console 全量 493 项测试通过（含同步/旧缓存/门面/实际 fetch 函数分支回归），
Foundation 5 项实际 loopback HTTP 错误映射及签名回执测试通过；Console 类型检查、相关文件 lint，以及 Runtime 临时
MySQL/race 新旧存储测试通过。核心同步测试使用临时 Ed25519 测试密钥与内存 store；
HTTP transport 使用假 Runtime/测试 token；MySQL 测试单独验证真实 Go 路由、JWT
与事务。**这些不是一条已部署 Platform→Console→Runtime→浏览器的端到端证据。**

下一批准备仅针对 hzy0：固定候选源码/制品，核对 Platform 新格式交付是否实际可用、
签名覆盖两个部署及 issuer/kid 一致；核对目标 Runtime 版本、独立表、绑定、正式
双 audience 精确 grant 和同步调度。现有本地 runner 仍固定 legacy `runtime`，
尚未增加 profile 切换选项；云端 renderer 不开放新后端。不能只改一项环境变量
就视为可以启用。随后安排显式本地配置切换、登录/导航/撤权与恢复验证。

本批没有执行 hzy0 DDL、grant seed、运行配置变更、进程重启或云端部署；没有
关闭旧服务或提交 Git。当前仍是代码候选，本地登录问题尚未现场验证解除。

## 10. hzy0 切换前置现场核验（2026-09-21，未发布）

受保护配置及本机数据库只读事务核验时间约 20:01–20:05 UTC；探针仅输出
状态、版本及布尔比较，不输出密钥、令牌、原始策略或人员数据。

| 前置项 | 现场结果 |
| --- | --- |
| hzy0 Gateway / Enterprise / Codocs editor / Console | 专用 PM2 清单均 online；未重启 |
| 本机 Runtime | health 正常；`0.3.219-test.product-edit-audit.1` / `7d42abd12f04-audit`；未升级 |
| Runtime / Console 信任公钥 | 读取 Runtime 正式 `platform-signing-key.json` overlay，比对 kid 与 Ed25519 公钥一致；不能因 config.json 未内嵌公钥就判断缺失 |
| Runtime 策略开关 | policyEnvelope / enterpriseReadEnabled 未开启 |
| 持久表 | 旧表存在；`verified_policy_snapshots` 不存在 |
| 当前 Console 客户端与精确 grant | active 凭据，policy-bundle read/write 均 active |
| 正式 Console token | data-runtime、tenant-runtime 两种 audience × read、write、组合 scope，共 6 次 200 且拿到短期 token；未执行业务写入 |
| Enterprise 策略 grant | 没有 active read，也没有 active write；未执行 seed |
| Platform 新格式 | 固定历史版本兼容探测仍落入旧查询路径，404、识别到旧 `bundle not found`；未命中新格式的历史选择拒绝分支 |

Platform 探针始终携带非空固定 `version=hzy0-readiness-no-generation`，防止旧
GET 在无包时按需生成策略。新实现应返回 `400 Historical policy envelopes cannot
be renewed`；现网以 45 秒诊断预算得到旧查询 404，耗时约 **38688ms**。此前
15 秒预算超时；首页独立只读连接约 1.59 秒，不能将此问题归结为整个域名断网。
这个探针证明现网未使用预期新分支，不证明新策略可正常签发，也不把旧 404 当作
数据库缺表证据。原短期 bootstrap 及令牌签发会产生正常认证审计。

复核工具：`node deploy/test-env/local-enterprise/verified-policy-readiness.mjs --live-read`。
加 `--service-probes` 才进行正式短期签发及固定版本兼容探测；内置 15 秒上游预算，
超时时保留已完成的去敏签发证据。45 秒样本为本次单独诊断，不修改运行期超时。
该工具固定本机 test 租户/部署/库/回环地址并开启只读事务；不做 DDL、grant 修改、
策略 PUT、同步、进程管理或部署。新增 4 项工具测试及本地栈全部 48 项测试通过。

**阻塞与最小解锁动作：** 需要用户批准对既有 `https://hzy.wiztek.cn` Platform
发布完整信封交付分支及对应受信 issuer 配置；这超出“只处理本机、不处理云端”
的当前边界。不能改为复制共享密钥、接受旧 payload-only 签名、延长新信封有效期，
也不能擅自把真实 Platform 数据/签名私钥复制到本机。

获得该项批准并验证新格式后，再安排本机 Runtime 固定制品、新表、Enterprise
精确读 grant、同步传输/频率和 profile 切换；新信封最多 5 分钟，旧每日同步不能
直接复用。仅新增本地表/开关不会解决当前上游缺口，因此本批未先行部分切换。
本批未改变数据库、授权记录、运行配置、Cloudflare/SSO、进程或 Git 提交。

## 11. 获准开发 Platform 最小发布（2026-09-21）

用户批准仅更新 `hzy.wiztek.cn` 完整信封接口及 issuer，不发布其他云端应用或修改
业务数据。实际目标为 `hzy-platform-dev` / 3011 / `hzy_platform_dev`，不是
`huizhi.yun` 的 Cloudflare 生产 Platform。

- 以服务器当前制品 `review-ui-paste-158c9b41` 的源码为基底，仅覆盖 11 个策略
  相关源码/配置/测试文件。比对基准提交 `52ed822b` 的 641 个源码文件，服务器
  已有的两处 Runtime heartbeat/enrollment 修复原样保留；没有部署整个脏工作区。
- Node 24.18.0 定向 lint、Platform 类型检查、9 项信封测试和 Node 构建通过。
  修正了一处新代码的 ternary 格式。重用已安装依赖，未执行安装/升级。
- 新进程于 **21:41:50 UTC** 核验完成；仅增加 issuer
  `HZY_PLATFORM_POLICY_ENVELOPE_ISSUER=https://hzy.wiztek.cn`，保留原数据库与签名
  密钥配置。新入口摘要 `2844da3f…2200c`；完整制品摘要及源码摘要见发布记录。
- 正式公网新格式 `200`（一次样本 3629ms）、`no-store`；本机既定公钥验签通过，
  同一信封覆盖 `wiztek-test-console` 与 `C000001-test-enterprise`。版本仍为
  `pv_test_20260914161219_0014`、revision 14，有效窗口 300000ms。
- 历史版本新格式请求 `400`；无凭据内部接口沿用既有 `403`，公开 Runtime 接口
  `401`；本地验签拒绝错租户、错环境、错部署及过期上下文。旧格式固定已有版本
  `200`，不执行缺包生成；策略行指纹与其他 PM2 进程保持不变。
- 两次前置切换检查失败均已恢复原进程：一次探针误期待内部接口返回 401，另一次
  旧格式耗时超出 10 秒探针预算。只读隔离比较确认旧版/候选均返回 200，样本
  17.1/37.2 秒；发布探针改为 60 秒，**没有改变应用运行期超时**。新格式随后通过。

证据：[部署回执](../deploy/test-env/artifacts/C000001.platform-policy-envelope-deployment.json)、
[构建/源码摘要](../deploy/test-env/artifacts/C000001.platform-policy-envelope-checks.json)、
[公网回读](../deploy/test-env/artifacts/C000001.platform-policy-envelope-public-probe.json)。
回退到回执中的 `rollbackEntry`/受保护 `rollbackConfig`，仍连接当前开发数据库；
不做数据回滚。PM2 保存清单也仅更新目标进程条目，其他已保存条目不变；原清单
受保护备份留在远端，回退时同样只恢复该进程条目，不恢复整个进程清单。

**尚未完成：** 本机 Runtime 固定制品、独立表、Enterprise 精确 read grant、
Console 新后端及至多五分钟窗口内的正式同步调度、真实登录/导航验收。同步器不能
直接沿用每日任务，也不能把 Gateway 新增为策略验证代理。此次未修改本机运行配置、
SSO/Access、其他云端应用或 Git 提交；上游发布成功不等于 hzy0/G1 验收通过。

## 12. 本机固定 Runtime 与正式策略链切换（2026-09-21）

用户继续授权后，仅修改本机 C000001 测试环境；本轮没有再发布云端。

- Runtime `0.3.219-test.verified-policy.1` / `7d42abd12f04-audit-policy`：以原运行
  `7d42abd12f04` 基线加已上线产品审计修复构建，另加策略存储/API/config；没有
  带入未完成 Codocs 变更。SHA-256 `426b747bea29d29729e8b73d81d5f1ffb6494e1b99d99a5b9e1241ee1cb197ec`。
  隔离候选 `go test ./...` 通过；外部源码/schema 合同夹具取相同基线。
- 新增独立 `verified_policy_snapshots`；旧 HMAC 表未迁移、覆盖或删除。
  Runtime 新开关仅在本机显式启用，窗口 300000ms，原 JWT/issuer/数据库绑定不变。
- Enterprise 安装 `console:policy-bundle:read` 业务 grant 及 `data-runtime`、
  `tenant-runtime` 两个精确 semanticScope 映射；不恢复 disabled grant，不授 write。
  **只有业务 grant 不足以证明可签发**：现场发现缺少 audience 映射返回 invalid_scope，
  已补 seed/verify，并以两个实际调用方签发验证。两个 audience 均可签发；本实例
  信任配置固定 `data-runtime`，另一个 audience 在读取端正确返回 401，并未放宽校验。
- 私有 profile 显式 `identity.policyBackend=verified-runtime`。Gateway 仅持有原已批准
  传输凭据，固定转发开发 Platform 完整信封；不验签代判、不改时间、不缓存 verdict。
  本机 Console 通过仅 loopback、独立凭据保护、固定 URL 的出口读取；响应限 8MiB+2048，
  禁止重定向和任意目标，不转发诊断错误、Cookie 或远端凭据给 Console/Host。
- Gateway 复用正式 scheduler HMAC，每次结束后 120000ms 唤醒固定 Console sync，
  不重叠；失败不延长策略有效期。它只写新独立表，不消费业务 outbox/旧刷新任务。
  Console/Runtime/Enterprise 分别完整验签；企业撤权与短期 JWT 检查仍在正式链路执行。
- 现场修正两处接线：新格式 managed 请求必须携带目标部署；Console 自有策略绑定
  不可误用 `/oauth/token` 的 Enterprise 入站部署。本机受信路由目录补 Console 项，
  新读取核验目录中的 Console owner，同时保留原调用方身份，不通过改 Header 冒充。
- 真实探针：两个调用方 GET 200、双部署验签；身份串用 403；Enterprise PUT 405，
  申请 write 被拒绝；Console 原信封重放 200，ETag 与 acceptedAt 不变。
  23:42 UTC 另行确认周期刷新：同一 revision 14 生成新的有效签名信封，issuedAt
  与 acceptedAt 前进；原信封重放不续鲜与周期重新签发的语义分别得到验证。
- 修正 managed Console 启动时无租户请求上下文却读取持久策略的异常：进程启动
  不再 patch 全局租户状态；实际请求仍要求受信上下文、有效签名和 Runtime 回执。
  runtime/verified-runtime 两后端不进行启动租户 I/O，memory/file 保留原 pending
  状态初始化。四项实际插件执行回归通过；本机热重启新增日志确认正确后端，
  未再出现无请求上下文异常或 unhandled rejection。
- 浏览器沿正常 hzy0 入口复用已登录会话，完成本机 Console → Enterprise 回调；
  企业工作台、完整左侧菜单和“我的文档”存量列表可见。早期切换中出现的回调错误
  不计成功；修正后重新从正常入口完成。未修改 Access/SSO/浏览器安全设置。

证据：[Runtime 安装回执](../deploy/test-env/artifacts/C000001.local-verified-policy-runtime.json)、
[实际签发/读取/重放探针](../deploy/test-env/artifacts/C000001.local-verified-policy-probes.json)。
代码检查：本地网关/调度 68 项、Console 类型检查、Host gate 测试通过；Console 全量
500 项测试通过。全量 lint 有既有错误，本次文件定向 lint 通过，不宣称全仓 lint 通过。

回退：先在私有 profile 关闭 `policyBackend` 新路径，再按需恢复原 Console 门面模式，
通过 CLI 只重启拥有的 hzy0 进程。Runtime 原二进制、原配置及 profile 备份在
`test-runtime/deployments/verified-policy-20260921/`；只恢复对应文件并重启
`cn.wiztek.hzy-test-runtime`，不回滚数据库、不删除新表水位。回退到旧本机门面
可能重现原 HMAC 不兼容，不承诺其可用性；授权若需撤回，仅按本批确切新增 grant 处理。

剩余：完整岗位/撤权/跨标签与依赖失败矩阵、正式回退演练、Console 门面最终同进程组合；
本轮读取成功不替代文档写入、协作或 G1 联合验收。未提交 Git。

## 13. hzy0 test 策略窗口切换（2026-09-22）

用户要求减少五分钟窗口导致的测试中断。代码候选允许开发 Platform **仅在**
`C000001/test/wiztek-test-console` 且服务端显式配置
`HZY_PLATFORM_POLICY_ENVELOPE_TEST_MAX_AGE_MS=93600000` 时签发至多 26 小时的
完整信封；原策略到期时间仍是更严格的上界。其他租户、部署和 prod/dev 仍按
五分钟上限。Runtime、Console、Enterprise 的 test 验证窗口必须同步配置，
否则长信封会被拒绝；既有信封不改时间，失败同步不续鲜，周期同步不停止。

2026-09-22 获用户批准后完成限定切换：隔离构建 Platform dev 候选，定向策略测试
10/10 与类型检查通过；备份并只修改共享 test Runtime 的
`apps.console.policyEnvelope.maxAgeMs` 为 93600000，重启
`cn.wiztek.hzy-test-runtime` 后健康探测 200；仅重启 hzy0 Console、Enterprise
和 Gateway。Platform 只切换 `hzy-platform-dev` / 3011 /
`hzy_platform_dev`，并设置上述 test-only 签发开关。现场签名验收确认
`pv_test_20260914161219_0014`、revision 14 的新信封窗口为 93600000ms，
匿名内部接口仍 403、历史格式请求仍 400；其他 PM2 进程未变。
Gateway 手动触发的一轮同步 `ready=true`（8533ms），浏览器正式账号的菜单
与项目列表首次读取及整页刷新后再次读取均成功，控制台无 error 级记录。Platform 新制品与只改该目标的 PM2 持久化记录留在
`/wiztek/hzy-test/platform-candidates/policy-lease-20260922/`，不含凭据的
[本地验收摘要](../deploy/test-env/artifacts/C000001.platform-policy-lease-deployment.json)
可供审查；Runtime 原配置留在
`test-runtime/config.json.pre-policy-lease-20260922`。此处不是 G1 或撤权全矩阵放行。

该窗口意味着 Platform 不可用且无法取得新签名时，已签发的旧授权事实可能最多
保留 26 小时。手动触发同步只有在 Platform 可用时才会取得新策略，不能替代
撤权通知或短期用户会话校验。继续保持周期同步与失败关闭；明确撤权、跨多个
有效窗口和全部业务允许/拒绝场景仍须单独验收。

## 14. 续签状态与故障宽限（阶段 A 已落地判定核心，尚未接线）

决策与完整计划见 [策略同步频率评估与实施计划](./Policy-Sync-Cadence-Assessment-20260922.md)。本节是判定规则的合同，四个消费方（Foundation Console 读取、Foundation Enterprise 读取、Enterprise 导航门、Runtime Go）接入时都必须引用同一实现，不得各自重写。

- 常量（authz-core `policy-envelope.ts` 与 Go `internal/policyenvelope/validity.go` 同值）：
  `POLICY_ENVELOPE_LONG_MAX_AGE_MS = 3600000`（目标签发有效期；消费方全部切换后 Platform 才签发）、
  `POLICY_ENVELOPE_OUTAGE_GRACE_MS = 86400000`、`POLICY_ENVELOPE_RENEWAL_LIVENESS_MS = 1800000`。
- 判定函数 `evaluatePolicyEnvelopeValidity(body, renewal, now)` / `EvaluateValidity` 只处理时间和状态，前提是签名、绑定和正文已经通过原有校验。返回 `valid | grace | expired | inactive` 及 `validUntil`。
- `status` 不是 `active` 时一律返回 `inactive`，故障期间也一样，用于让签名的停用、撤销通知立即生效。
- `now < min(expiresAt, policyExpiresAt)` 时为 `valid`；此时续签状态不影响结果，`refused` 不会提前缩短有效期。
- 过了 `expiresAt` 之后，只有同时满足以下条件才为 `grace`：续签状态为 `platform_unavailable`；`issuedAt ≤ attemptedAt ≤ now`；`now < attemptedAt + 30 分钟`；`now < min(issuedAt + 24 小时, policyExpiresAt)`。`validUntil` 取后两个上限中较早的一个。其他情况（没有状态、`ok`、`refused`、`invalid`、未知状态、调度器停摆、尝试时间晚于当前或早于签发）一律为 `expired`。
- 续签失败的分类（阶段 C/D 实现，2026-09-22 按评审 R2/R3 收紧）：只有 Platform 调用本身产生的结果才算续签证据。Console 在调用点标注失败阶段（`policyStage`）：
  - `platform` 阶段：网络错误、超时、408/429、5xx 记为 `platform_unavailable`；其余 4xx，**包括 401 凭据被拒**，记为 `refused`（2026-09-22 用户确认）。
  - `protocol` 阶段：Platform 已应答但响应格式不对、验签或绑定校验失败，记为 `invalid`，不给宽限——这不是“Platform 不可用”，而是收到了不可信的内容。
  - 其他失败（Runtime 读写失败、本地异常）不代表 Platform 状态，**不写**续签状态。
- **拒绝是粘性的**：`refused` 和 `invalid` 写入后，同一信封（同一 ETag）上之后的 `platform_unavailable` 或 `ok` 不会覆盖它，重放同一信封也不会清除；只有接纳一个更新的签名信封才重置为 `ok`。两个粘性状态之间以最新一次为准。修订查询返回明确拒绝时直接记为 `refused` 并结束本轮，不再用后续完整拉取的结果覆盖。
- **宽限的适用范围**：宽限只覆盖“策略接口不可用”。Console 每次访问 Runtime 仍需要 Platform 签发的启动令牌（`platform_runtime_bootstrap`），Platform 整体不可用时该令牌也拿不到，未配置 Console 服务密钥时，Platform 整体故障仍会中断服务；配置后由 §15 的稳态服务身份承接。
- 非整数或越界的时间一律失败关闭。
- 契约用例：`data-runtime/internal/policyenvelope/testdata/validity-vectors.json`，TS（`authz-core/src/policyEnvelopeValidity.test.ts`）和 Go（`validity_test.go`）逐条断言结果一致，并核对常量。修改规则时必须同时更新用例和两端实现。
- **续签状态存储（阶段 B，已实现，环境未迁移）**：`verified_policy_snapshots` 新增可空列 `renewal_state`、`renewal_attempted_at`（迁移脚本为 `console/docs/sql/Console-SQL-Migration-verified-policy-renewal-state.sql`）。`PUT /v1/console/verified-policy/renewal` 只接受 Console 的写 capability 和当前 ETag，尝试时间由 Runtime 取且只会向后推进；接纳新信封会重置为 `ok`，重放同一信封不改变续签状态。`state` 取 `ok|platform_unavailable|refused|invalid`。两个 GET 返回 `renewal` 字段。**Runtime 的 Enterprise 读取路由暂不采用宽限判定**：四个消费方要在阶段 D 统一切换，避免只有一方提前放宽。
- **Platform 签发与轻量查询（阶段 C，已实现，未部署）**：`findCurrentPolicyEnvelopeRow` 不再按租户、部署状态过滤，改为返回这两个状态。租户 `suspended/disabled`（或未知状态）签发当前修订的 `suspended/revoked` 信封；部署停用、当前策略缺失、撤销、许可到期返回固定的 4xx 拒绝码；完整性、签名和配置问题返回 503。新增 `format=hzy-policy-revision.v1`。签发有效期可配置，默认 5 分钟。
- **Runtime 接纳规则调整（阶段 C）**：同一修订号内允许 Platform 签名的状态变化（停用、撤销、恢复），仍要求 `IssuedAt` 严格递增；payload、bundleVersion、deployments、policyExpiresAt 仍必须一致。现有 Console 同步器在阶段 D 之前会拒收非 active 信封，旧信封按原有效期失效，与此前收到 503 的效果相同。
- **四个读取方统一接入（阶段 D，已实现，未部署）**：
  - **接收上限**：authz-core 非 test 环境的接收上限放宽到 60 分钟（Platform 默认仍签 5 分钟）；Console verified 后端生产使用 60 分钟，test 仍用配置窗口；Enterprise 默认 `HZY_ENTERPRISE_POLICY_MAX_AGE_MS=3600000`；Runtime 默认和上限都是 `LongMaxAgeMS`。
  - **判定**：Foundation `verifyRuntimePolicySnapshot`（Console 读取和 Enterprise 导航门共用）与 Runtime `GET /v1/enterprise/console-policy`（Go `VerifyAuthenticity` 加 `EvaluateValidity`）使用同一判定。宽限期内记录 `console-policy-outage-grace` / `enterprise-policy-outage-grace` 告警，Console 管理首页显示“策略处于故障宽限”提示。
  - **同步检查模式**：`/api/internal/policy-bundle/sync` 先读 Runtime 当前快照，再发 `hzy-policy-revision.v1` 修订查询。修订号、哈希、状态都没变，且签发不满 15 分钟时，只写入 `ok`；否则完整拉取。修订查询失败只会回退到完整拉取。修订查询的明确拒绝直接记为 `refused`；修订查询的其他失败回退到完整拉取。完整拉取失败按上文阶段分类记录，本地失败不记录。续签状态写入失败只记告警。
  - **停用信封**：同步器允许写入签名的 `suspended/revoked` 信封，写入后清空跨请求缓存，读取立即拒绝。
  - **旧新鲜度规则**：verified 读取结果（带 `policyValidity`）不再套用旧后端“距上次同步不超过 5 分钟”的企业权益新鲜度检查，生命周期完全由签名信封的 `expiresAt` 决定。

## 15. Console 稳态服务身份（R1，2026-09-22 决策，代码已实现）

决策：方案 A；Console 公钥自动登记，不需要 Platform 管理员人工确认；G1 放行前完成。方案背景见 [R1 方案](./Console-Runtime-Steady-Identity-Proposal-R1-20260922.md)。

- **登记**：Console 每个部署持有 Ed25519 私钥（`HZY_CONSOLE_SERVICE_KEY` PKCS8 PEM，或本机 `HZY_CONSOLE_SERVICE_KEY_FILE`）。策略同步时若当前信封没有自己的 `kid`，或剩余有效期不足 30 天，调用 `POST /api/platform/internal/console/tenants/{tenantCode}/service-keys`（Platform 内部凭据，body 仅 `environment/deploymentCode/publicKey`），成功后立即完整续签，使新公钥随信封到达 Runtime；失败只告警，不影响续签状态，同一 `kid` 15 分钟内不重试。
- **Platform 存储**：`console_service_keys`（迁移 `platform/docs/sql/migrations/20260923-console-service-keys.sql`）。`kid = csk_` + SHA-256(原始公钥) 前 16 位十六进制，不能为别的公钥认领；有效期 90 天，同一部署最多 2 把 active，超出时撤销最旧的；撤销后的 `kid` 不能重新登记。表不存在时信封不带公钥，登记接口返回 503。
- **信封字段**：正文可选 `serviceKeys: [{deployment, kid, publicKey, notAfter}]`，只含请求部署自己未过期的公钥；没有公钥时省略该字段，使旧正文逐字节不变。存在时必须非空、最多 4 个、`deployment` 在 `deployments` 内、`kid` 与公钥一致、`notAfter > issuedAt`。TS（authz-core）与 Go 用共享用例 `testdata/service-key-vectors.json` 校验。
- **断言**：头 `{alg: EdDSA, typ: hzy-console-assertion+jwt, kid}`；声明恰为 `iss=sub=console:{deployment}`、`aud=hzy-runtime-service-token-issue`、`token_use=console_service_assertion`、`tenant`、`deployment`、`scope=console:service-token:issue`、`iat`、`exp`（不超过 60 秒）、`jti`，额外字段拒绝。每次签发调用生成新断言。
- **Runtime 校验**：只在 `POST /v1/console/auth/service-tokens/issue` 接受。先读 Console 部署的已验证信封与续签状态，`EvaluateValidity` 必须为 `valid` 或 `grace`，公钥须在信封中且未过 `notAfter`，再验签名与声明；`jti` 写入 `console_service_assertion_replay`（迁移 `console/docs/sql/Console-SQL-Migration-console-service-assertion-replay.sql`，可选表），重复使用返回 `401 console_assertion_replayed`。错误码：签名/声明/未登记公钥 `401 console_assertion_invalid`；信封过期且无宽限、`refused/invalid`、停用、调度器停摆 `403 console_assertion_policy_inactive`；未迁移 `503 console_assertion_not_migrated`。签发结果与启动令牌路径相同，权限不扩大。
- **何时使用**：平台正常时仍用启动令牌。只有 Platform 不可达（网络错误、超时、5xx、408、429）才改用断言；Platform 4xx 或响应无效仍失败关闭。Gateway 取启动令牌失败且属于不可达时，不再让请求失败，而是加受信头 `x-hzy-runtime-bootstrap-unavailable: platform`（入站同名头一律剥离，只在 Gateway 凭据校验通过时生效）。Enterprise 等调用方经 Console 换取令牌时，断言绑定受信服务路由目录中的 Console 部署。
- **边界**：宽限的所有上限（签发后 24 小时、许可到期、30 分钟调度活性、拒绝与无效不给宽限、停用信封立即生效）自动传递到 Console 身份。私钥泄露后可用到公钥被撤销且新信封送达为止；与原先持有 Platform 内部凭据可签发任意租户启动令牌相比，影响范围缩小到单个 Console 部署。
- **验收（2026-09-23，hzy0 + 开发 Platform）**：自动登记与信封送达、Platform 整体故障下有效期内与宽限期内持续签发、`refused` 后失败关闭且不被后续故障覆盖、恢复后回到启动令牌均已实测；2026-09-23 签名停用信封在有效期内立即使 Enterprise 失败关闭，停用期间服务密钥断言以 `verdict=inactive` 被拒；恢复依赖 Platform 启动令牌可达（本次约 5 分钟）。见本机验收记录。
- **未覆盖**：云端 Tenant Gateway 自身仍需 Platform 解析租户注册表（`/resolve`，有缓存），云端完整故障演练和 Worker Secret 配置属于 R1-6，生产另行批准。
