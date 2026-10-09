# ADR-017: Console 租户数据面完全收敛到 Tenant Runtime

状态：原决策 Accepted；本次为配套修订稿，新增条款待审阅纳入。本文不声明任何运行路径已经完成迁移。

原决策日期：2026-07-17。修订日期：2026-09-15。修订版本：1.1。

依据：用户提供的 ADR-017 原稿、ADR-018 原稿及本轮架构评审；未将未提供的实施文档或线上配置视为已经核验。原主体和迁移顺序保留，本次补充安全目标、信任链、故障与恢复、Host 职责及验收门槛。

配套决策：[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)、[ADR-019](./ADR-019-Enterprise-Business-Frontend-Integration.md)。

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

Platform、Cloudflare Console、PM2 Console、Self-hosted Console UI/BFF，以及 ADR-018/019 的 Enterprise Host，均不得持久保存或配置下列租户权威状态、长期秘密及直接访问能力：

- `hzy_console` 或后续租户核心库的数据库账号、DSN、Hyperdrive binding；
- Console Vault 主密钥、可恢复的租户 Secret 副本，或可脱离 Runtime 重复使用的租户集成长期凭据；
- Console OIDC/JWT 签名私钥；
- 企业用户 Refresh Token、Authorization Code、Session 的权威记录或平台侧可复用副本；协议中的受控瞬时转发按 §2.7 执行；
- 可绕过 tenant-runtime 使用的租户级数据库运维通道。

Platform 数据库只保存平台控制面事实：

- 租户、订阅、应用、部署、License；
- Manifest、角色授权、Policy Bundle；
- Runtime enrollment、版本、健康状态和发布治理；
- 平台生成且已知内容的签名缓存或必要脱敏投影；
- 平台自身管理员和租户管理员控制面账户，不包含企业应用用户会话。

### 2.2 所有部署模式使用同一数据访问边界

Console/Enterprise Host 无论部署在 Cloudflare、PM2 还是企业本地服务器，均使用同一条数据访问边界。独立 Console 门面可以与 Host 同进程组合；下图不要求额外增加一跳 HTTP：

```text
Browser
  -> Tenant Gateway
  -> Enterprise Host / Console Auth Protocol Facade / 薄 BFF
  -> tenant-runtime console/auth/directory/audit adapters
  -> customer-owned Console 安全域存储（初期保留 hzy_console）
```

PM2/Self-hosted 场景可以通过 loopback 或客户内网调用 tenant-runtime，但不得恢复 Console 直连数据库实现。开发环境允许使用本地 tenant-runtime 或 fixture；不得以开发便利为由保留生产可达的 DB fallback。

### 2.3 Tenant Runtime 承担 Console 的全部持久化域

现有 `hzy_console` 初期继续作为客户侧物理数据库，避免先搬数据再改访问路径；本 ADR 涉及的应用组件中，只有 tenant-runtime 的相应安全域 adapter 拥有该数据库访问身份。客户自己的受控数据库运维不等于给平台发放运维通道。Tenant Runtime 增加 Console 相关领域 adapter，承载：

- 企业资料、系统设置、字典、工作日历；
- Directory、外部身份映射、Connector 和同步任务；
- Vault、Integration、Service Client 与凭证轮换；
- 企业用户 Session、OIDC、Authorization Code、Refresh Token 和签名密钥；
- Portal 通知、可靠操作、Receipt；
- 登录、Vault、业务操作和统一审计日志。

Tenant Runtime 不是 SQL over REST 代理。所有 API 必须是有业务语义、字段白名单、分页、权限、幂等和审计约束的领域接口。

Console 安全域不因为 ADR-018 的业务合库而成为普通 JOIN 对象。第一轮保留 `hzy_console` 及独立最小权限访问身份；Directory 的必要业务身份字段通过受控契约提供，不能连带暴露 Session、Refresh Token、Vault 或签名密钥。后续是否调整物理布局另行评审，不以前端统一作为理由。

同一进程内的 package、adapter 或不同连接账户主要提供职责与最小权限约束，不宣称可以隔离任意进程内恶意代码。需要更强密钥隔离时，可选客户 KMS 或独立安全服务；不把新增 KMS 平台作为所有客户首轮迁移的前置条件。

### 2.4 企业用户 Auth Runtime 下沉客户侧

Console 继续对外表现为企业应用用户 IdP，但持久化状态和密码学私钥位于客户侧 tenant-runtime：

- OIDC discovery/JWKS 可由 Console/Gateway 缓存公开响应；
- authorize、上游 IdP callback、token、refresh、revoke、logout 的权威处理位于 tenant-runtime auth adapter；
- Console/Host 只代理协议、维护浏览器 Cookie 的传输属性，不保存权威 Session，不把长期租户令牌放入自建会话库或可由平台解密的持久 Cookie；
- OIDC/JWT 私钥只在客户侧生成和使用；API 只返回经过授权、固定令牌用途下的签发结果及公钥，不提供任意 payload/subject/scope 的通用签名服务；
- Service Client 的校验、授权和短期 Token 签发在客户侧完成；
- Platform 只保存 Runtime 公钥、指纹、版本和健康摘要，不保存私钥或可恢复密文。

为避免启动循环，Runtime enrollment、Auth Runtime 初始化和 Console/Host workload 身份使用独立的引导信任链。引导凭证只能完成一次性 enrollment、密钥注册和受限健康检查，不能授权 Directory、Vault、Session 或业务数据访问。引导结束后必须失效；日常 workload 凭证不能直接沿用引导凭证。具体信任契约见 §2.8。

### 2.5 Runtime 离线时失败关闭

不再以“Agent 离线仍可登录”为目标保留中央 Console 数据库：

- Tenant Runtime 离线时，新登录、Token 刷新、服务令牌签发和租户数据操作明确返回不可用；
- 已签发且未过期的短期 Access Token 可在业务应用按缓存 JWKS 离线验签，但要求实时 Session/撤销状态的操作必须失败关闭；
- Console 不回退 Hyperdrive、数据库直连、跨租户共享库或 Platform 内部接口读取租户数据；
- 恢复后通过幂等 Operation、Receipt 和审计水位继续处理，不重复 mutation。

企业用户认证可用性属于客户侧 Runtime 的 SLO。按客户部署等级选择进程守护、冗余实例、数据库高可用和网络冗余；不要求每个小规模客户第一阶段都采购完整高可用设施，但必须明确其可用性与恢复目标，不能通过复制租户认证事实到平台数据库提高可用性。

离线验签只证明令牌的密码学校验可完成，不证明租户数据服务可用，也不代替需要实时检查的撤销状态。故障与恢复规则见 §2.9。

### 2.6 平台支持使用受控 API，不使用数据库

平台支持人员如需协助租户，只能使用：

- 租户管理员显式批准的 JIT support grant；
- 精确 capability、对象范围和有效期；
- 强制 MFA/工单号/原因；
- 全程 tenant-runtime 审计；
- 可随时撤销且默认不可导出、不可 reveal Secret。

不得提供平台共享数据库账号、租户库只读账号、通用 SQL 控制台或绕过租户授权的“超级支持接口”。

### 2.7 安全目标：禁止直接控制，不虚报端到端不可见

本架构的默认目标是：平台不掌握租户数据库级访问能力、权威企业认证状态及长期密码学秘密；所有租户数据操作经客户侧 Runtime 的业务接口授权与审计。

**该目标不等于“平台绝对看不到任何租户明文数据”。** 在平台托管的 UI、TLS 终止点或 BFF 正常代理请求时，平台运行的软件仍可能处理经用户授权的响应、Cookie 或协议参数。租户数据主权、经授权的瞬时处理和端到端内容不可见是不同保证，不混同宣传。

| 数据/能力 | 平台侧允许的处理 | 禁止事项 |
| --- | --- | --- |
| 数据库凭据、Vault 主密钥、签名私钥 | 无   | 配置、传输给 Host、持久保存、平台可恢复备份 |
| Session/Code/Refresh Token 权威状态 | Runtime 维护；Host 仅转发正式协议所需信息 | 在 Platform/Console/Host 创建第二事实源或持久可复用副本 |
| 浏览器 Session 句柄及协议参数 | 仅按正式协议、指定接收方、必要请求生命周期转发；句柄权威验证仍在 Runtime | 写日志、落共享缓存、放 URL 埋点或错误采集；作为任意用户身份声明 |
| 用户授权业务响应 | 必要 UI/BFF 处理；按字段白名单返回 | 额外沉淀成平台业务副本，或绕过授权二次使用 |
| JWKS 与已知签名控制面内容 | 按 issuer、租户及版本缓存 | 将秘密、用户令牌或非公开业务响应伪装成可重建公开缓存 |

敏感协议端点与响应使用明确的禁止缓存策略；访问日志、Trace、错误上报和会话回放默认排除 Cookie、Authorization、Code、Refresh Token、Secret 和完整敏感正文。不要以加密日志或可解密 Cookie 规避禁止持有长期秘密的规则。

代理层清理来自浏览器的不可信身份/租户头，使用经验证的路由和会话建立下游上下文；代理到 Runtime 的链路必须具有机密性、完整性和适用的重放防护。Cookie 的 Secure/HttpOnly、域与路径、SameSite、CSRF 及 redirect URI 约束在 Auth API 契约中逐端点落实。[R1]

若客户要求连平台托管前端也不能接触明文，需要另行设计客户端、浏览器到客户侧的通信和软件交付信任；不声称当前 BFF 模式已经满足。

### 2.8 引导、工作负载、用户委托与控制面信任

| 身份  | 可以证明/执行 | 不得被替代成 |
| --- | --- | --- |
| 一次性 enrollment 身份 | 注册部署、绑定客户认可的 Runtime 公钥、受限健康检查 | Directory/Session/Vault/业务读写身份 |
| Console/Host workload 身份 | 请求来自获准部署中的正式宿主；申请已授权用途的短期服务访问 | 任意企业用户、租户管理员或全业务 scope |
| 用户身份/委托 | 经 Auth 验证的用户，在限定租户、环境、对象和动作内操作 | Host 自填的 subject、部门或管理员标志 |
| 后台任务身份 | 执行登记的任务、回调与必要范围内的访问 | 因“内部任务”而获得任意业务或密钥权限 |
| JIT support grant | 租户批准的临时支持访问 | 平台服务账户自行生成的永久支持权限 |

首轮以现有正式令牌合同为兼容基线，补齐类型区分，不借本次修订强行更换全部认证协议。各令牌 profile 必须冻结 issuer、audience、用途、tenant/environment/deployment 绑定、scope、有效期、验证算法和撤销/重放规则；错误类型的 JWT 必须拒绝，不能仅凭签名正确即接受。[R2]

Runtime 根据已验证身份、有效策略、服务白名单及适用的对象约束形成签发结果。Host 只能请求受限权限，不得指定未经核验的用户身份；授权判断不能仅依赖浏览器或 Host 传入的 `current_user`、部门、scope 或管理员布尔值。

Platform 继续作为租户委托的控制面治理与策略发布者，不迁移其既有主责。策略变更须有可追溯的管理主体、委托权限、版本、生效范围和审计；平台 workload 身份本身不授予企业用户或支持权限。JIT support grant 必须在客户侧保留或验证租户批准事实，普通 Policy Bundle 不能替代该支持批准。

**默认信任假设：**租户信任已授权的控制面治理和获准的软件发布链。客户侧保管私钥并不自动防御恶意控制面策略、被篡改的平台前端或恶意 Runtime 更新。要求抵抗这些威胁时，应另行定义客户侧授权上限、独立批准/签名与软件交付约束，不把加强模式作为当前已经实现的保证。

Runtime 更新须具备制品来源与完整性验证、兼容窗口、回退版本和审计。租户能依据交付模式选择受控自动更新、批准更新或版本固定策略；只验证 checksum 不等于已经验证发布者身份。策略时效、更新权与人工恢复主体在部署合同中登记。

### 2.9 故障矩阵与认证恢复

| 场景  | 允许的有限行为 | 必须失败关闭的行为 |
| --- | --- | --- |
| 整个客户 Runtime 不可用 | 公共外壳、离线说明、公开 JWKS；展示经过批准的非敏感状态 | 新登录、刷新、服务签发和租户数据读写，不假装业务正常 |
| Auth 不可用而业务 adapter 仍可用 | 经风险分类允许的、有效 Access Token 下的有限操作 | 需要实时 Session/撤销校验的操作、提权和新签发 |
| Platform 不可用而 Runtime 正常 | 在预先约定有效窗口内使用已验证策略，且路由/依赖仍可达 | 新增未验证策略、默认延长资格、策略过期后自动永久放行 |
| 客户数据库不可用 | 不依赖数据库的公开健康状态 | 需要持久状态的认证及业务操作，不恢复第二数据源 |
| 上游 IdP 不可用 | 已有会话按合同运行；客户自己控制且预先配置的受限恢复途径 | 平台支持账户冒充企业用户、临时关闭验证 |
| 从旧备份恢复 Auth | 按恢复手册核对密钥、策略与撤销状态后有序开通 | 不核对即恢复旧 Session/Refresh Token 的可用性 |

在实施台账中冻结认证 SLO、RTO、RPO、Access Token 有效窗口和撤销传播要求。无可靠撤销证据时，优先强制相关会话重新认证；采用会话代次或恢复后轮换策略时，必须说明如何避免代次随同旧备份一起回退。恢复演练涵盖密钥/数据库备份一致性、旧凭证失效、回调幂等和审计连续性。

### 2.10 Enterprise Host、Console 与后台任务责任

Enterprise Host 是企业用户的唯一主 Shell，负责公共导航、页面容器及统一会话体验；Console 是 Auth 协议与企业基础能力的责任域。Console 管理页面可以注册进 Host，但不能再创建第二个主 Shell、企业切换状态或权威 Session。

Host 统一登记前端 middleware、plugins 与 HTTP/BFF 路由。已迁入 Runtime 的租户持久化、可靠操作、Outbox drain、Directory/Connector 同步等任务由 Runtime 或明确登记的独立服务执行；Host 不因组合 Layers 而自动启动这些任务。仍在旧服务的任务按台账保留唯一执行者，迁移后才停止旧执行者。

每个租户/环境/任务记录执行主体、权限、幂等操作身份、租约/执行代次及切换水位。双实例、旧回调和至少一次重放必须不产生重复业务效果；不声称消息网络能够“只投递一次”。

## 3. 数据归属

| 数据类别 | 权威位置 | 平台可见范围 |
| --- | --- | --- |
| 租户、订阅、部署、应用、License、Policy Bundle | Platform DB | 完整控制面事实 |
| Runtime 路由、版本、健康、Schema 摘要 | Platform DB | endpoint 引用和健康摘要；无数据库 DSN |
| 最小授权主体投影 | Platform DB | 稳定 subject code、状态、membership/授权所需脱敏字段 |
| Directory、企业配置、通知、审计 | Tenant Runtime / 客户数据库 | 无数据库直达权限；授权请求中可能经 UI/BFF 瞬时处理，按 §2.7 最小化 |
| Session、Refresh Token、OIDC/Service Token 私钥与凭证 | Tenant Runtime / 客户数据库或客户 KMS | 无权威记录/长期秘密副本；仅公开密钥摘要及 §2.7 必要协议瞬时转发 |
| Policy Bundle/JWKS 边缘缓存 | 可重建边缘缓存 | 仅 Platform 已知签名内容和公开公钥 |

## 4. 迁移原则

1. 先改变访问路径，再考虑物理改库名或拆 Schema。
2. 每个领域只有一个写入事实源，不做长期双写。
3. 迁移期只允许显式、按租户和领域的人工切换；禁止运行时自动 DB fallback。
4. 已切到 runtime-only 的领域只能回滚 Tenant Runtime 版本或路由，不能回滚为 Console 直连数据库。
5. 每迁出一个领域，立即撤销 Console/Hyperdrive 对相应表的权限。
6. 最终删除 Console 的 MySQL 驱动、`server/utils/db.ts`、Hyperdrive 和 `DB_*` 配置。
7. 所有写操作保留 actor、授权上下文、幂等键、Trace 和审计证据；审计不记录凭据明文。
8. Auth 迁移优先保持 issuer、subject 语义、客户端注册和回调兼容；必须变更时单独提供登记、重定向、令牌兼容和会话再认证方案，不能在 Host 合并中隐式改变。
9. Auth/Vault 迁移、业务物理合库及全量 UI 路由切换不得作为同一不可拆分上线动作；按租户、领域独立验收。
10. 代码删去凭据引用不等于权限已撤销；验收包含旧 Secret/Hyperdrive 绑定清理、凭据轮换、实际连接权限验证、日志/备份副本排查。
11. 对任何事务外部副作用执行结果不确定的请求，通过稳定 Operation/Receipt 查询并恢复，不自动重发第二次业务动作。

## 5. 被替代的旧结论

本 ADR 替代以下旧结论：

- 为企业应用用户保留平台托管 `hzy_console_control`；
- Agent 离线时依靠中央 Session/OIDC 数据继续登录和刷新；
- PM2/Self-hosted Console 可以长期直连本地 `hzy_console`；
- Console Auth/Vault/OIDC 永久排除在 tenant-runtime 范围外；
- Hyperdrive 可以作为生产应急数据回退。

ADR-014/ADR-016 的 Platform 控制面边界、Tenant Runtime 业务 API、禁止 SQL 代理等决策继续有效。按业务域保留 adapter 与数据主责；ADR-018 对已经登记并验收的普通业务域另行允许统一库、受控内部查询与事务，不据此开放 Console 安全域。ADR-019 定义前端业务整合，不更改本 ADR 的数据与信任边界。

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

## 8. 迁移验收门槛

| 编号  | 验收内容 | 必须保留的证据 |
| --- | --- | --- |
| SEC-01 | 平台/Host/Console 无已迁移领域的 DB 直达及长期秘密能力 | 依赖与绑定扫描、数据库权限撤销、实际拒绝测试；无 DB fallback |
| SEC-02 | 引导、workload、用户与支持身份不可混用 | 错 issuer/audience/tenant/用途、伪造 subject、超范围签发的拒绝用例 |
| SEC-03 | 敏感请求不进入隐性持久副本 | 缓存/日志/Trace/错误采集/浏览器存储检查 |
| SEC-04 | 故障不会回退或无限登录重定向 | §2.9 各场景的失败关闭和恢复测试 |
| SEC-05 | Auth 恢复不复活已撤销凭证 | 备份恢复演练、会话失效与密钥恢复证据 |
| SEC-06 | 只有一个权威写入方和任务执行责任 | Operation/Receipt/Outbox 水位、重放与重复执行测试 |
| SEC-07 | JIT 支持可批准、限制、撤销和审计 | 租户批准记录、到期拒绝、禁止导出/Secret reveal 的测试 |
| SEC-08 | Host 变更不破坏 Auth 协议兼容 | issuer/client/redirect/cookie/session 回归矩阵 |

通过架构评审不等于通过本表。实际进度、负责人、证据路径和上线批次继续只在现有实施台账维护。

## 9. 参考与交叉约束

外部资料只支撑协议安全规则；项目数据归属和目标部署由本 ADR 决定。核对日期：2026-09-15。

- [R1] IETF, [RFC 9700 — OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)：特别参考反向代理保护及协议处理要求。
- [R2] IETF, [RFC 8725 — JSON Web Token Best Current Practices](https://www.rfc-editor.org/info/rfc8725/)：issuer/audience、算法白名单和不同用途 JWT 的互斥验证。
- [ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)：普通业务库与 Runtime 服务整合。
- [ADR-019](./ADR-019-Enterprise-Business-Frontend-Integration.md)：企业用户工作台、业务导航和前端组合。
- [修订说明](./ADR-017-019-Revision-Notes.md)：本次保留、调整和新增内容；文档包不是部署完成记录。