# ADR-017 F3/F4 整改方案（签发权威与引导信任）

日期：2026-09-26。起草：Claude。依据：[ADR-017](./ADR-017-Console-Tenant-Data-Plane-Separation.md) §2.4/§2.8/§8，[2026-09-16 分支代码审查](./ADR-017%20and%20ADR-018%20实施分支代码审查.md) F3/F4。
用途：Console 批次 C（凭证保险箱、服务客户端、集成、运行时配置、系统设置、激活、`admin/**`）迁入 Enterprise Host 的前置门禁之一。本文是实施方案，不代表已实施或已验收。

## 1. 现状核对

审查之后，2026-09-16 已有两条修复提交，均已包含在本机 Runtime `0.3.244`（`4d332b64`）的构建基线中：

| 审查项 | 已修复（提交） | 证据 |
| --- | --- | --- |
| F3 用户令牌 | `8e8554203`：`/v1/console/auth/oidc/sign` 按 `sid` 解析 `local_sessions`（active、未撤销、未过期，用户 active），并要求 `sub`、`hzy.uid` 都与会话一致 | `auth_signing_authority_test.go` |
| F3 服务令牌 | 同上：签发前复用 `VerifyOIDCServiceTokenState`，要求 credential 为 current/active/未过期，每个 scope 都有 active grant；`sub == client:<hzy.clientCode>` | 同上 |
| F4 | `6d5f0aade`：`PersistJWTTrustOverlay` 只写一次（值相同则幂等，不同则 409，内存与磁盘都不变）；JTI 通过 `console_mutation_receipts` 持久消费（跨重启、跨实例） | `config_test.go` |

以下是逐行复核当前代码后仍存在的缺口。

### 1.1 F3 剩余缺口

Runtime 一共有三条签发路径，都会用私钥签名：

- A：通用签名，`/v1/console/auth/oidc/sign`（`SignOIDCToken`），Console 的 `signJwt`/`signServiceAccessJwt` 使用；
- B：`/v1/console/auth/service-tokens/issue`（`IssueConsoleRuntimeServiceToken`），Console 自身的服务令牌；
- C：`/v1/console/auth/service-tokens/exchange`（`ExchangeGatewayServiceToken`），Gateway 断言交换。

| 编号 | 缺口 | 路径 | 影响 |
| --- | --- | --- | --- |
| G1 | `iss` 取自调用方入参，只校验是绝对 HTTP(S) URL | A、B、C | 获准的 workload 可以用客户私钥签出任意 issuer 的令牌；ADR-017 要求 issuer 来自受控租户配置 |
| G2 | 服务令牌的身份字段未与凭据行绑定：`hzy.clientCode`、`sub`、`hzy.appCode`、`source_app`、`clientName`、`clientType` 均取自入参；只有 `client_id` 和 `credentialId` 查了库 | A | 可以用 X 的有效凭据签出声称是客户端 Y、应用 Z 的令牌；读取 `sub`/`hzy.clientCode`/`source_app` 的消费方会被误导 |
| G3 | 服务令牌的 `aud` 与 `target_app` 未校验：grant 只按 `resource:action` 匹配，忽略 `scope_json.audience`，也不要求 `target_app == aud` | A（需复核 B、C） | 一个 audience 下的 grant 可以签出另一个 audience 的令牌，与 v2.22/v2.23 的 audience 分行模型不一致 |
| G4 | `deployment` 只检查非空 | A（需复核 B、C） | 用户令牌和服务令牌都可以声称任意部署；服务令牌应等于 grant 或凭据绑定的部署 |
| G5 | 用户令牌的 `aud`/`azp` 未校验是否为 active 的 `auth_clients` | A | 可以为有效会话签出未登记或已停用客户端的令牌 |
| G6 | `policy_ver`/`caps` 取自入参 | A、C | 这两项只用于新鲜度和缓存，不参与授权，风险低；本轮只记录 |

通用签名入口（A）本身仍存在，Console 的授权码兑换和刷新流程仍是“先在 Runtime 消费 code/refresh，再另调 sign”。ADR-017 §2.4 的目标形态是由领域操作直接生成 claims（见 §3 阶段 2）。

另外：`console/server/utils/serviceAccessTokenClaims.ts` 的 `signServiceAccessTokenWithContext` 在 Console 本地持钥签名，目前服务端无调用方，只在 `console/test/consoleRuntimeServiceIdentity.test.ts` 中使用。

### 1.2 F4 剩余缺口

| 编号 | 缺口 | 影响 |
| --- | --- | --- |
| H1 | “已初始化”状态只存在于每个实例本地磁盘的 `auth-jwt-trust.json`。共享 receipt 只阻止重用同一个 JTI，不阻止用**新 JTI**携带**不同 trust** | 第二个实例、换盘或重新部署后，本地文件为空的实例会接受一个新的有效信封，改写 issuer/JWKS，两实例信任根分叉 |
| H2 | 顺序问题：`BootstrapOIDCSigningKeyToVault` 在 trust 一致性检查之前执行 | 信封的 trust 不同、将要被 409 拒绝时，也可能已在全新实例上生成并存入签名密钥 |
| H3 | 没有正式的 issuer/JWKS 迁移操作 | 目前不需要；更换只能走人工批准的运维流程 |

## 2. 阶段 1：批次 C 前置（本轮实施）

负责人：Codex-sol（Runtime/Go 与授权核心）。Claude 复审每批提交。只在本机 hzy0 和本机 C000001 Runtime 验证；不上云，不改生产，不改 grant。

### F3-1 签发 issuer 由 Runtime 决定（G1）
- Adapter 注入 Runtime 自身的受信 issuer，即 Runtime 验证 Console 令牌所用的 `cfg.Auth.JWT.Issuer`（env 或引导后 overlay 中的同一个值）。
- A、B、C 三条路径统一使用一个 helper：入参 `iss`/`issuer` 与受信 issuer 不同时返回 403 `oidc_signing_issuer_mismatch`；签出的 claims 一律写入受信值，不使用入参。
- 未配置受信 issuer 时签发失败关闭（503），不回退为采用入参。
- 实施前先核对本机：hzy0 facade 的 `getOidcIssuer` 与本机 Runtime trust 的 issuer 必须一致。不一致时修正本机 profile，不放宽代码。

### F3-2 服务身份字段由凭据行决定（G2）
- 在 `authorizeServiceSigningClaims` 中按 `credentialId + client_id` 读取 `service_clients` 的 `client_code`、`client_name`、`client_type`、`app_code`。
- 覆盖写入 `sub=client:<client_code>`、`hzy.subjectCode`、`hzy.clientCode`、`hzy.clientName`、`hzy.clientType`、`hzy.appCode`、`source_app`。
- 入参中出现且与凭据行不一致的任何一项都返回 403，不静默改写，以便暴露调用方错误。
- `app_code` 为 NULL（工具类客户端）时，`source_app`/`hzy.appCode` 必须为空或缺省。

### F3-3 服务令牌 audience 与 grant 一致（G3）
- 要求 `target_app` 缺省或等于 `aud`；签出时写入 `target_app=aud`。
- 每个 scope 必须有一条 active grant 覆盖 `(aud, scope)`：
  - 先读 Console 当前签发代码中 grant → (audience, semanticScope) 的映射（v2.22/v2.23 模式，`scope_json.audience`/`semanticScope` 与 audience 前缀物理行），在 Runtime 中按**同一规则**实现；
  - 规则写入 `MODULE_CONTRACTS.md` 的服务令牌章节，并加 TS/Go 共同夹具测试，防止两边漂移；
  - 不引入第二套 capability 清单，事实仍是 `service_client_grants`。
- 如果映射规则只能在 Console 侧表达，先停下报告 Claude，不自行设计新格式。
- 同时复核 B、C 两条路径是否已按 grant 限定 audience，补齐缺失部分。
- 已裁定的阶段1兼容：22个精确 `(client, audience, scope)` + `console.runtime/data-runtime/console:` 前缀；仅覆盖已有 active grant，表外无audience旧行403。集合与来源见 MODULE_CONTRACTS 服务签发 audience 映射和 Go 合同夹具；不改授权数据。
- 2026-09-26 本机C000001已批准并完成93行audience/semanticScope合并迁移（3行排除项不变），逐行核验及23个原组合真实签发通过、跨audience反例403；兼容表收紧为空并保留历史夹具。其它环境迁移仍需独立批准，升级前核对grant事实。通知外部渠道与Collab保持原开关。

### F3-4 部署绑定（G4）
- 服务令牌：`deployment` 必须等于该 grant 或凭据绑定的部署（与 Console `bindServiceAccessTokenPolicyToServiceClient` 同一事实）。
- 用户令牌：`deployment` 必须属于本 Runtime 已登记的部署集合（`cfg.DeploymentBindings` 的值或 `DeploymentForApp`），否则返回 403。

### F3-5 用户令牌客户端（G5）
- `aud` 必须是 active 的 `auth_clients.client_id`；`azp` 若出现必须等于 `aud`。
- 不要求会话与客户端绑定：会话是 SSO 会话，`local_sessions` 没有 client 字段。

### F4-1 共享的初始化事实（H1、H2）
- 首次成功引导时，在共享库中持久记录 trust 初始化事实，按 (tenant, console deployment, runtimeCode) 唯一，内容为 issuer/audience/jwksUrl 的规范化值及摘要。
  - 优先复用 `console_mutation_receipts`：用固定的操作键承载；
  - 需要新表时，按根 CLAUDE.md 同步 schema 文档与迁移，并先报告 Claude。
- 引导顺序改为：验签与绑定 → 读取共享初始化事实，不同则 409（在消费 JTI 与密钥引导**之前**）→ 消费 JTI → 密钥引导 → 写磁盘 overlay → 更新内存。
- 启动时：共享事实存在而本地 overlay 缺失，允许仅以完全相同的值重新引导；本地 overlay 与共享事实不同，则认证子系统失败关闭并给出明确错误码，不自动覆盖任一方。

### 可选清理
删除无服务端调用方的 `signServiceAccessTokenWithContext`，或将其限定为测试专用。在报告中说明选择。

### 阶段 1 回归矩阵（对应 ADR-017 SEC-02）
合法 Console workload 身份下，以下情况都必须被拒绝：
- 错误的 `iss`；
- 不存在、已撤销或已过期的 sid；
- `sub` 或 `hzy.uid` 与会话不符；
- 未登记或已停用的用户令牌 `aud`；
- `azp` 与 `aud` 不一致；
- 服务令牌的 `clientCode`/`appCode`/`source_app`/`sub` 与凭据行不符；
- `target_app` 与 `aud` 不同；
- grant 属于另一个 audience；
- 未授权的 scope；
- 停用或非当前的 credential；
- 服务令牌的 deployment 不是其绑定部署；
- 用户令牌的 deployment 未登记。

正例：Enterprise 登录、授权码兑换、刷新、Console 自身的服务令牌、Gateway 断言交换、Aims/Workflow/Enterprise 现有服务调用的令牌签发不受影响。

F4 回归：
- 首次成功；
- 相同内容重试无副作用；
- 新 JTI 携带不同 trust 时，已初始化实例和“本地为空的第二实例”都返回 409，且都不生成密钥；
- 已消费的 JTI 在重启后和第二实例上继续失效；
- 被拒绝时内存与磁盘 trust 保持原值；
- 启动时本地与共享事实冲突则失败关闭。

需要真实 MySQL 的用例使用现有隔离 MySQL 夹具。缺少环境时如实标注 skip，不能把普通 `go test` 通过当作已验证。

### 阶段 1 本机验收
- 更新本机 Runtime（按 `deploy/test-env/LOCAL_RUNTIME.md` 升版本并备份）。
- hzy0 浏览器正例：登录 → 进入工作台 → 打开项目页与文档列表 → 打开审批通知，全程无 401/403。
- 用实际 service client 对 enterprise/workflow/aims 现有组合 scope 各做一次签发探测，结果为 200。
- 按根 CLAUDE.md 更新 `MODULE_CONTRACTS.md` 的签发合同与 Console API 文档，并在台账记录证据。

## 3. 阶段 2：领域化签发（ADR-017 §2.4 目标形态，排期在批次 C 之后）

- 授权码兑换：`ConsumeOIDCAuthorizationCode` 与签名合并为一个 Runtime 操作。`aud`、`sid`、`sub`、`nonce`、`scope` 都从 code 记录与会话推导，Console 不再提交 claims。
- 刷新：`ConsumeOIDCRefreshToken` 轮换与签名合并。
- 客户端凭据：凭据消费（`ConsumeServiceClientCredential`）与签名合并，claims 全部来自凭据行和 grant。
- 以上完成后，通用 `/oidc/sign` 只保留经登记的迁移期调用，最终移除。
- 属于 Auth 协议变更，需执行 ADR-017 SEC-08 回归矩阵（issuer/client/redirect/cookie/session）。

## 4. 与批次 C 的关系

批次 C 页面迁移的门禁：
- 阶段 1 全部合入且本机验收通过；
- 每个批次 C 页面单独满足 SEC-03：凭据、密钥和令牌不进入 Host 的缓存、日志、Trace、错误采集或浏览器存储；保险箱只允许写入与掩码展示，不回显明文。

阶段 2 不阻塞批次 C，但阻塞把 ADR-017 标记为整体验收完成。
