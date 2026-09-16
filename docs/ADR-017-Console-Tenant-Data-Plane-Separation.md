# ADR-017: Console 租户数据面完全收敛到 Tenant Runtime

状态：Accepted

日期：2026-07-17

决策范围：Console 数据库访问、企业用户认证运行时、Cloudflare/PM2/Self-hosted 部署、Tenant Runtime Console adapter、平台支持访问

## 1. 背景

ADR-014 和 ADR-016 已确定“平台提供应用与治理，客户自行托管数据与服务”的主线，并把业务模块的数据访问逐步迁入 tenant-runtime。Console 因承担 Directory、OIDC、Session、Vault、Service Client 和企业基础配置等启动闭环，第一阶段被明确允许继续直连 `hzy_console`。

当前 Console 因此同时存在两种性质：

- 产品定位上是企业基础运行服务；
- 实现上，Cloudflare Worker 或 PM2 进程仍可使用数据库账号直接访问 `hzy_console`。

在平台托管场景下，只要平台运行的 Console 进程持有 Hyperdrive、数据库 DSN、Vault 主密钥或 OIDC 私钥，平台仍具备绕过 tenant-runtime 读取或处理租户私有数据的技术能力。这与目标数据边界不一致。为 PM2/Self-hosted 保留直连实现还会长期形成两套数据路径、两套事务语义和回退逻辑。

此前提出的中央 `hzy_console_control` 方案把 Session、Refresh Token、OIDC 私钥和 Service Client 凭证保留在平台托管数据库，以保证 Agent 离线时仍可登录。该方案虽然改善了部分业务数据隔离，但仍让平台持有可恢复的租户认证事实和密钥，不能满足本次确认的边界。

## 2. 决策

### 2.1 平台不保留可直连的 Console 数据库

Platform、Cloudflare Console、PM2 Console、Self-hosted Console UI/BFF 均不得持有：

- `hzy_console` 或后续租户核心库的数据库账号、DSN、Hyperdrive binding；
- Console Vault 主密钥或可恢复的租户 Secret；
- Console OIDC/JWT 签名私钥；
- 企业用户 Refresh Token、Authorization Code、Session 权威记录；
- 可绕过 tenant-runtime 使用的租户级数据库运维通道。

Platform 数据库只保存平台控制面事实：

- 租户、订阅、应用、部署、License；
- Manifest、角色授权、Policy Bundle；
- Runtime enrollment、版本、健康状态和发布治理；
- 平台生成且已知内容的签名缓存或必要脱敏投影；
- 平台自身管理员和租户管理员控制面账户，不包含企业应用用户会话。

### 2.2 所有部署模式使用同一数据访问边界

Console 无论部署在 Cloudflare、PM2 还是企业本地服务器，均使用同一条调用链：

```text
Browser
  -> Tenant Gateway
  -> Console UI / Auth Protocol Facade / BFF
  -> tenant-runtime console/auth/directory/audit adapters
  -> customer-owned hzy_console
```

PM2/Self-hosted 场景可以通过 loopback 或客户内网调用 tenant-runtime，但不得恢复 Console 直连数据库实现。开发环境允许使用本地 tenant-runtime 或 fixture；不得以开发便利为由保留生产可达的 DB fallback。

### 2.3 Tenant Runtime 承担 Console 的全部持久化域

现有 `hzy_console` 初期可以继续作为物理 Schema，避免先搬数据再改访问路径；但只有 tenant-runtime 拥有数据库凭证。Tenant Runtime 增加 Console 相关领域 adapter，承载：

- 企业资料、系统设置、字典、工作日历；
- Directory、外部身份映射、Connector 和同步任务；
- Vault、Integration、Service Client 与凭证轮换；
- 企业用户 Session、OIDC、Authorization Code、Refresh Token 和签名密钥；
- Portal 通知、可靠操作、Receipt；
- 登录、Vault、业务操作和统一审计日志。

Tenant Runtime 不是 SQL over REST 代理。所有 API 必须是有业务语义、字段白名单、分页、权限、幂等和审计约束的领域接口。

### 2.4 企业用户 Auth Runtime 下沉客户侧

Console 继续对外表现为企业应用用户 IdP，但持久化状态和密码学私钥位于客户侧 tenant-runtime：

- OIDC discovery/JWKS 可由 Console/Gateway 缓存公开响应；
- authorize、上游 IdP callback、token、refresh、revoke、logout 的权威处理位于 tenant-runtime auth adapter；
- Console 只代理协议、维护浏览器 Cookie 的传输属性，不保存权威 Session；
- OIDC/JWT 私钥只在客户侧生成和使用，API 只暴露签名结果与公钥；
- Service Client 的校验、授权和短期 Token 签发在客户侧完成；
- Platform 只保存 Runtime 公钥、指纹、版本和健康摘要，不保存私钥或可恢复密文。

为避免启动循环，Runtime enrollment、Auth Runtime 初始化和 Console workload 身份使用独立的引导信任链。引导凭证只能完成一次性 enrollment、密钥注册和受限健康检查，不能授权 Directory、Vault、Session 或业务数据访问。

### 2.5 Runtime 离线时失败关闭

不再以“Agent 离线仍可登录”为目标保留中央 Console 数据库：

- Tenant Runtime 离线时，新登录、Token 刷新、服务令牌签发和租户数据操作明确返回不可用；
- 已签发且未过期的短期 Access Token 可在业务应用按缓存 JWKS 离线验签，但要求实时 Session/撤销状态的操作必须失败关闭；
- Console 不回退 Hyperdrive、数据库直连、跨租户共享库或 Platform 内部接口读取租户数据；
- 恢复后通过幂等 Operation、Receipt 和审计水位继续处理，不重复 mutation。

企业用户认证可用性属于客户侧 Runtime 的 SLO，应通过双实例、进程守护、数据库高可用和网络冗余解决，而不是复制租户认证事实到平台数据库。

### 2.6 平台支持使用受控 API，不使用数据库

平台支持人员如需协助租户，只能使用：

- 租户管理员显式批准的 JIT support grant；
- 精确 capability、对象范围和有效期；
- 强制 MFA/工单号/原因；
- 全程 tenant-runtime 审计；
- 可随时撤销且默认不可导出、不可 reveal Secret。

不得提供平台共享数据库账号、租户库只读账号、通用 SQL 控制台或绕过租户授权的“超级支持接口”。

## 3. 数据归属

| 数据类别 | 权威位置 | 平台可见范围 |
| --- | --- | --- |
| 租户、订阅、部署、应用、License、Policy Bundle | Platform DB | 完整控制面事实 |
| Runtime 路由、版本、健康、Schema 摘要 | Platform DB | endpoint 引用和健康摘要；无数据库 DSN |
| 最小授权主体投影 | Platform DB | 稳定 subject code、状态、membership/授权所需脱敏字段 |
| Directory、企业配置、通知、审计 | Tenant Runtime / 客户数据库 | 默认不可见；仅租户授权 API |
| Session、Refresh Token、OIDC/Service Token 私钥与凭证 | Tenant Runtime / 客户数据库或客户 KMS | 仅公钥、指纹和健康摘要 |
| Policy Bundle/JWKS 边缘缓存 | 可重建边缘缓存 | 仅 Platform 已知签名内容和公开公钥 |

## 4. 迁移原则

1. 先改变访问路径，再考虑物理改库名或拆 Schema。
2. 每个领域只有一个写入事实源，不做长期双写。
3. 迁移期只允许显式、按租户和领域的人工切换；禁止运行时自动 DB fallback。
4. 已切到 runtime-only 的领域只能回滚 Tenant Runtime 版本或路由，不能回滚为 Console 直连数据库。
5. 每迁出一个领域，立即撤销 Console/Hyperdrive 对相应表的权限。
6. 最终删除 Console 的 MySQL 驱动、`server/utils/db.ts`、Hyperdrive 和 `DB_*` 配置。
7. 所有写操作保留 actor、授权上下文、幂等键、Trace 和审计证据。

## 5. 被替代的旧结论

本 ADR 替代以下旧结论：

- 为企业应用用户保留平台托管 `hzy_console_control`；
- Agent 离线时依靠中央 Session/OIDC 数据继续登录和刷新；
- PM2/Self-hosted Console 可以长期直连本地 `hzy_console`；
- Console Auth/Vault/OIDC 永久排除在 tenant-runtime 范围外；
- Hyperdrive 可以作为生产应急数据回退。

ADR-014/ADR-016 的 Platform 控制面边界、Tenant Runtime 业务 API、禁止 SQL 代理和按应用 adapter 隔离等其他决策继续有效。

## 6. 影响

正向影响：

- 平台不再拥有租户数据库级访问能力；
- Cloudflare、PM2 和 Self-hosted 共用一套安全与事务语义；
- Auth、Vault、Directory 和审计真正成为客户侧能力；
- Console 可收敛为 UI、协议门面和薄 BFF；
- 数据导出、支持授权和访问审计均由租户控制。

代价：

- Tenant Runtime 成为登录和服务令牌签发的关键依赖，需要更高可用性；
- Auth Runtime 迁移涉及 Session、Refresh Token、上游 IdP callback 和密钥轮换，风险高于普通 CRUD 迁移；
- Console 现有大量直接 DB 调用需要按领域逐步替换；
- Cloudflare/PM2 发布、Runtime 版本和数据库 Schema 需要严格兼容窗口。

## 7. 落地文档

- 执行计划：`console/docs/Console-Database-Split-and-Data-Runtime-Migration-Task-List.md`
- 表归属：`console/docs/Console-Database-Table-Inventory.md`
- API 契约：`console/docs/Console-Tenant-Runtime-API-Contract-v1.md`
- 跨模块事实源：`MODULE_CONTRACTS.md`
