# hzy_platform 第一版 Schema 诊断与修正建议

状态：Draft
日期：2026-04-22
作者：Claude（代 gavin 分析）
关联文档：
- `HZY-Platform-SQL-DDL-Draft-v1.sql`
- `HZY-Platform-Schema-Draft-v1.md`
- `HZY-Platform-Seed-Draft-v1.sql`
- `Huizhi-yun-Platform-Target-Architecture.md`
- `Identity-Plane-Design.md`
- `HZY-Platform-API-Draft-v1.md`

---

## 0. 一句话结论

当前 `hzy_platform` 第一版 DDL 虽然把目标架构里要求的"表"大致摆出来了，但在几个关键维度上偏离了目标架构的 ADR，还踩了两类真实可复现的 bug：

1. **直接导致现在 500 的 bug**：`deployments` 表没有 `app_code` 字段，而 `subscriptions` 业务逻辑却按 `(tenant_code, app_code)` 去 JOIN；`租户-应用订阅` 这个概念根本没落到 DDL 里。
2. **MySQL NULL 唯一约束陷阱**：`applications / roles / resources / users` 的 unique key 都以可空的 `tenant_code` 打头，在 MySQL 里 NULL ≠ NULL，系统级记录的唯一性其实从未被强制，seed 跑两次就能重复插入。
3. **架构偏离**：和 `Huizhi-yun-Platform-Target-Architecture.md` 里写的 ADR-001（`token.iss = deployment_id`）、ADR-002（控制面不存 PII）、ADR-009（License + Signed Bundle + Heartbeat）在 DDL 层面基本没落实——没有 deployment 签名密钥、没有 session、没有 capability 注册表、`users` 里直接塞了 PII。

> 所以当前"Epic 1 已完成"的状态更接近"表摆上去了，但形状不对"。这份文档目的就是把问题系统列出来，并给出一版可以直接进入 DDL 迭代的建议。

---

## 1. 当前 Schema 问题清单

以下按严重程度分级。每条都给出：**问题 → 为什么是问题 → 建议修法**。

### P0-1 `deployments` 没有 `app_code`，和业务代码直接冲突

**问题**
`HZY-Platform-SQL-DDL-Draft-v1.sql` 里 `deployments` 字段是：
```
id / tenant_code / deployment_code / deployment_name / deployment_mode / status / license_status / last_heartbeat_at / ...
```
但 `platform/server/utils/subscriptions.ts` 里 SQL 是：
```sql
LEFT JOIN deployments d
  ON d.tenant_code = ?
 AND d.app_code = a.app_code
```
`d.app_code` 根本不存在，所以 `/api/platform/admin/tenants` 页里一旦拉 subscriptions 聚合就是 500（上次 session 里看到的就是这个症状）。

**为什么是问题**
业务上的心智模型是：一个租户 **按应用** 订阅；每个 `(tenant, app)` 一份运行实例。但 DDL 里 `deployments` 被抽象成"按 `deployment_code` 裸命名的运行单元"，不跟 app 绑。`subscriptions.ts` 又自己按 `(tenant, app)` 反推 deployment，自然对不上。

**建议**

- 语义选一条落地：
  - **A 方案（推荐）**：deployments 就是"租户 × 应用"的运行实例。给 `deployments` 加 `app_code VARCHAR(64) NOT NULL`，唯一键改 `(tenant_code, app_code, deployment_code)` 或者直接 `(tenant_code, app_code)`（一个租户一个应用只留一条"当前"记录）。
  - **B 方案**：deployments 是"部署实例主表"（不跟 app 绑），另起一张 `deployment_apps(deployment_id, app_code, status)` 描述一个部署里装了哪些 app。这更贴近"一个私有化部署里同时跑 aims+codocs"的真实场景。
- 推荐 **B 方案**：更贴合 Self-Hosted Enterprise 的拓扑（客户买一个"汇智云部署"，里面包多个 app），也能表达 Managed SaaS 下"每个 app 一份独立 deployment"这种极端情况——只是 deployment 里只挂一个 app。

### P0-2 唯一约束依赖可空 `tenant_code`，实际没强制唯一

**问题**
这些 unique key 打头都是 NULL-able 的 `tenant_code`：

| 表 | Unique Key |
|---|---|
| `applications` | `(tenant_code, app_code)` |
| `resources` | `(tenant_code, app_code, resource_code)` |
| `roles` | `(tenant_code, role_code)` |
| `permission_templates` | `(tenant_code, template_code)` |
| `users` | `(tenant_code, uid)`、`(tenant_code, email)` |

MySQL 的 UNIQUE 约束里 NULL 之间互不相等，所以 **系统级（tenant_code=NULL）的记录可以无限插同样的 `role_code='super_admin'`**。Seed 脚本当前靠 `WHERE NOT EXISTS` 保护，其实是在用 SQL 写幂等，不是数据库层面保证。

**为什么是问题**
- 任何写入新系统级 role / app / resource 的接口如果没自己做 `EXISTS` 判断，就会静默制造重复数据。
- 一旦未来引入租户自定义 app、tenant 自己建 role，"系统级 vs 租户级"的命名冲突无法在 DB 层拒绝。

**建议**
两条路选一条：

1. **取消"tenant_code=NULL 表示系统级"这种语义**，改用一个保留值，例如常量 `'__system__'` 或 `'_platform'`，把所有 tenant_code 设 `NOT NULL DEFAULT '__system__'`。唯一约束立刻有效。
2. **用 MySQL 8 的 GENERATED 列** 把 NULL 归一：
   ```sql
   tenant_scope VARCHAR(64) AS (IFNULL(tenant_code, '__system__')) STORED,
   UNIQUE KEY uk_x (tenant_scope, app_code)
   ```
   这样旧字段语义不变，但唯一性被强制。

推荐 **1**，命名约定更清晰，也方便后续 `tenant_code` 做 partition key。

### P0-3 `subject_identities` 跨租户全局唯一，拆多租户会爆

**问题**
```sql
UNIQUE KEY uk_subject_identities_provider_subject (provider_type, provider_subject_key)
```
如果 Acme 公司有个 LDAP 用户 `uid=zhangsan`，Beta 公司也有 `uid=zhangsan`，第二家入驻时直接冲突。

**建议**
改为 `(tenant_code, provider_type, provider_subject_key)` 唯一；把 `tenant_code` 改回 NOT NULL（系统级身份源目前没必要存）。

### P1-1 违反 ADR-002：Control Plane 里存了 PII

**问题**
`Huizhi-yun-Platform-Target-Architecture.md` 第 3.2 / 3.3 和 ADR-002 反复强调：

> 平台**不存**姓名、邮箱、手机、照片、详细通讯录资料。

但 DDL 里 `users` 表直接把这些字段都拿进来了：

```sql
users: username / display_name / email / mobile / avatar_url
```

`Schema-Draft-v1.md` 6.2 节甚至自我解释成"users 是平台用户主表"——这和 ADR-002 直接对立。

**为什么是问题**
- 目标架构的核心价值主张之一是"合规负担低、客户数据主权强"，PII 进 Control Plane 直接把这个卖点废掉。
- 私有化客户把平台信任锚点部署在客户侧（Enterprise）时，`hzy_platform` 理论上只要最小主体目录；如果 PII 进去，私有化交付物要额外处理一份跟 IdP 同步的用户全量库，复杂度翻倍。

**建议**
三选一，按项目节奏取：

1. **彻底对齐 ADR-002（推荐）**：
   - 删除 `users` 表里的 `display_name / email / mobile / avatar_url`，只保留 `id / tenant_code / uid / status / source_type / last_login_at`。
   - 显示用名/头像由 `subject_identities.provider_metadata` 或后续的 tenant 本地用户库提供，平台不落盘。
2. **妥协方案**：`users` 保留，但所有 PII 字段改成 `NULL DEFAULT NULL` 且在 seed / API 文档里明确"只在 Managed SaaS 模式下回填，Enterprise 模式下必须留空"。这条需要配 CI 静态检查，不然会漂回去。
3. **干脆合并**：把 `users` 并入 `subjects`，用 `subject_type='user'` 表达，PII 就完全没落点。

大多数团队最后都会走 **1**，否则后续每张有 FK 指向 `users` 的表都会被 PII 污染。

### P1-2 `users` / `subjects` 边界重叠，ID 多了一套

**问题**
现在同一个 `张三` 会同时有：
- `users.id`（数字自增）
- `users.uid`（字符串稳定）
- `subjects.id`（数字自增）
- `subjects.subject_code`（字符串稳定，约定和 uid 相等）

而且：
- `subjects.user_id` 指 `users.id`（可空）
- `user_roles` 又用 `uid` 字符串而不是 subject_id

**为什么是问题**
- 四个 ID 之间的一致性全靠代码维护，任何一条链路漏更新都会产生漂移（例如改 uid 不同步改 subject_code）。
- `template_bindings` / `template_overrides` 已经用 `subject_id`，但 `user_roles` 偏偏用 `uid`，**授权解析要同时走两套 ID 语义**：按 uid 查直接 role，按 subject_id 查模板 role，合并时还要再 join 一次 subjects。权限解析器负担大，缓存 key 也不统一。

**建议**
把"用户"作为一种 subject 收敛：

- 保留 `subjects` 作为唯一授权主体表。
- `users` 若保留，只当作登录帐号的薄壳（uid+credential+status），**不参与授权计算**；所有授权表（`user_roles`、`template_bindings`、`template_overrides`、`role_scopes` 间接）全部挂 `subject_id`。
- `user_roles` 改名 `subject_roles`，主键 `(tenant_code, subject_id, role_id, source_type, source_id)`。
- 对外 API 返回里 uid 仍可暴露给业务方，但内部解析链路只认 subject_id。

### P1-3 违反 ADR-001：deployment 没有信任根字段

**问题**
ADR-001 + Identity-Plane 4.1：

> 每个部署实例有且仅有一套签名密钥对。`token.iss = deployment_id`。

`deployments` DDL 里完全没有：
- `public_key`
- `private_key_ref / kid`
- `jwks_uri`

**为什么是问题**
这直接让 `platform-sdk` 里 `verifyToken()` 无从下手——SDK 要拿 `iss`（deployment_id）回查 JWKS，但平台侧根本没存密钥对的元数据。所以现在的 SDK 验签要么在走死代码，要么仍依赖 legacy `account` 的签名配置——这就解释了为什么 backlog E1-T4 / E2-T2 都打 `[x]` 但主链路还跑在 legacy bridge 上。

**建议**
新增一张签名密钥表，支持轮换：

```sql
CREATE TABLE deployment_signing_keys (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  deployment_id BIGINT UNSIGNED NOT NULL,
  kid VARCHAR(64) NOT NULL,
  alg VARCHAR(16) NOT NULL,             -- RS256 / ES256
  public_key TEXT NOT NULL,              -- PEM 或 JWK JSON
  private_key_ref VARCHAR(255) NOT NULL, -- 引用到 KMS / Vault，不直接存私钥
  valid_from DATETIME NOT NULL,
  valid_until DATETIME NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- active / retiring / revoked
  ...
  UNIQUE KEY uk (deployment_id, kid)
);
```
以及在 `deployments` 上加 `current_kid VARCHAR(64)` 指向"目前签发用的 key"。

### P1-4 缺 `sessions` 表，`token.sid` 无落点

**问题**
`Identity-Plane-Design.md` 第 4.3、10.1 节要求有 Session 对象（session_id / idp_type / issued_at / expires_at / status），token 里要签 `sid`；但 DDL 里没有任何 session 表。

**建议**
v1 最小 session 表：

```sql
CREATE TABLE sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  session_uuid CHAR(36) NOT NULL,         -- 对外暴露
  tenant_code VARCHAR(64) NOT NULL,
  deployment_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  idp_type VARCHAR(32) NOT NULL,          -- cas / wecom / oidc / saml / ldap
  issued_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  refreshed_at DATETIME NULL,
  status VARCHAR(16) NOT NULL,            -- active / refreshed / expired / revoked
  ...
  UNIQUE KEY uk_session_uuid (session_uuid),
  KEY idx_subject_status (tenant_code, subject_id, status)
);
```
revocation 时把 session 设 revoked，`revocation_snapshots` 里打包 session_uuid 列表下发。

### P1-5 缺 `capabilities` 注册表，capability_code 是自由字符串

**问题**
`license_capabilities.capability_code` 就是 VARCHAR，没有主表。也就是说：
- 系统里存在哪些 capability，从 DDL 看不出来
- 一处写 `aims_enabled`，另一处写 `aims.enabled`，DB 完全不阻止
- Identity-Plane-Design 说要在 token 里塞 `caps`（capability 摘要），计算摘要得先枚举，现在枚举只能靠约定俗成

**建议**
补一张：

```sql
CREATE TABLE capabilities (
  capability_code VARCHAR(128) PRIMARY KEY,
  capability_name VARCHAR(255) NOT NULL,
  capability_type VARCHAR(32) NOT NULL,      -- feature / quota / app
  value_schema_json JSON NULL,               -- 描述 capability_value 的合法形态
  description VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```
然后 `license_capabilities.capability_code` 加 FK，避免孤儿。

### P1-6 缺 `tenant_app_subscriptions` 表，业务概念只在代码里

**问题**
backlog 里 E1-T5 写"subscriptions 可用"，但 DDL 里没有 subscription 表。现在 `subscriptions.ts` 靠 `applications + deployments + licenses` 三表 LEFT JOIN 倒推——然后又因为 deployments 没 app_code 而 500。

**为什么是问题**
- "租户订阅 aims" 这件事是业务含义，生命周期是：选中 → 部署 → 授权 → 激活 → 宽限 → 失效。把这份 state 让前端从 3 张表 LEFT JOIN 推，既脆弱又不可审计。
- Signed Policy Bundle 的生成天然需要一个入口："这个 tenant 订了哪些 app"；如果没有 subscription 这张主表，bundle 生成器得反查 deployments+licenses，无法区分"历史有过但退订了"和"现在还在订"。

**建议**

```sql
CREATE TABLE tenant_app_subscriptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  tenant_code VARCHAR(64) NOT NULL,
  app_code VARCHAR(64) NOT NULL,
  plan_code VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,          -- selected / active / grace / suspended / terminated
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  source VARCHAR(32) NOT NULL,           -- self_service / ops_grant / trial
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk (tenant_code, app_code),
  KEY idx_status (status)
);
```
然后：
- `deployments` 挂 `subscription_id`（或 `(tenant_code, app_code)` 复合 FK）
- `licenses` 挂 `subscription_id`
- subscription 是"商业事实"，deployment 是"运行时实例"，license 是"本次授权的签名载体"——三层职责清晰。

### P1-7 授权计算不闭环：`role_scopes.scope_value='project_member'` 没注册协议

**问题**
Seed 里 `role_scopes` 插入 `scope_type='relation', scope_value='project_member'`；目标架构说这种关系型 scope 由 app runtime resolver 解释。但 DDL 里：
- 没有 scope 类型注册表
- 没有 `app_resolvers` 或类似的表记录"aims 声明它能解释哪些关系型 scope"
- manifest 里 `supported_scopes` 字段也没落到 `app_manifests` 的检索列上（都糊在 `manifest_json` JSON 里）

**为什么是问题**
平台生成 policy bundle 时，没法 assert "当前 bundle 里所有 `scope_value` 都被某个 app runtime 声明过"。一旦 aims runtime 没注册 `project_member`，scope 会静默失败——这是 P0 级的运营坑（"明明配了权限，就是不生效"）。

**建议**

1. 给 `app_manifests` 增加冗余列，把 manifest 里的 supported_scopes 抽到关系表：

   ```sql
   CREATE TABLE app_supported_scopes (
     app_code VARCHAR(64) NOT NULL,
     manifest_id BIGINT UNSIGNED NOT NULL,
     scope_type VARCHAR(32) NOT NULL,
     scope_value VARCHAR(255) NOT NULL,
     resolver_endpoint VARCHAR(500) NULL,
     PRIMARY KEY (manifest_id, scope_type, scope_value)
   );
   ```

2. 后台在保存 `role_scopes` 时做校验：若 `scope_type='relation'`，必须在目标 app 的 current manifest 的 `app_supported_scopes` 里存在。

### P1-8 `applications` 的 tenant_code 语义摇摆

**问题**
`applications.tenant_code`：
- DDL 允许 NULL（"系统级应用"）
- seed 全部插 NULL
- API 草案里 `POST /applications` 请求体允许传 `tenantCode: 'acme'`（"租户级应用"）

如果未来允许租户自建 app，那么 `app_code='aims'` 就不是全局稳定键；platform-sdk 里以 `app_code` 查 bundle / manifest 就会歧义。如果不允许租户自建，tenant_code 根本不该存在。

**建议**
v1 明确：**applications 全部是系统级**，直接把 `applications.tenant_code` 删掉，改为系统全局表，unique key 就是 `(app_code)`。租户"开不开这个 app"由 `tenant_app_subscriptions` 表达。

### P2-1 `tenant_code` 冗余字段与 FK 可能不一致

**问题**
`role_permissions` 同时有 `tenant_code` 和 `role_id`；如果写入时 `tenant_code='acme'` 但 `role_id` 指向的 role 属于 tenant `'beta'`，DB 不拒。

**建议**
两种路径：
- 去掉冗余 `tenant_code`，查询走 `role_id -> roles.tenant_code`
- 保留冗余（为分区/查询性能），用 trigger 或应用层在写入时断言一致。

倾向前者——冗余得不偿失。

### P2-2 `subjects.parent_subject_id` 树结构混用

**问题**
部门父子是一种树（dept_code 父子），岗位"分组"是另一种树，两类挂同一个 parent 字段，查询部门子树时必须额外 `AND subject_type='department'`，永远不能漏。

**建议**
要么按 subject_type 拆成 `departments` / `jobs` 专表，要么保留 subjects 但增加约束：`parent_subject_id` 只允许指向同 `subject_type` 的 subject——MySQL 没法直接约束，靠应用层保证并加 check 脚本。

### P2-3 license 按 deployment、bundle 也按 deployment，但策略是 tenant 级

**问题**
- `licenses.deployment_id` NOT NULL → 一份 license 绑一个 deployment
- `policy_bundles.deployment_id` NOT NULL → 一份 bundle 绑一个 deployment
- 但 `roles / permission_templates / template_bindings` 是 tenant 级

于是：同 tenant 下 aims+codocs 两个 deployment，bundle 内容实质相同；若以 deployment 维度生成，两份 bundle 彼此不一致时反而是 bug。

**建议**
- bundle 按 `(tenant_code, bundle_version)` 生成，deployments 只是分发渠道：给 `policy_bundles` 去掉 `deployment_id`，换成 `tenant_code` 主 key；另加 `deployment_bundle_targets(deployment_id, bundle_version, status)` 做分发关系。
- license 保持按 deployment 发，但通过 `subscription_id` 上溯到 tenant，以便运营后台按租户查"全部许可"。

### P2-4 审计覆盖不全

**问题**
DDL 只有 `authorization_audit_logs`，Identity-Plane-Design 10.2 要求至少覆盖：
- 登录成功/失败
- federation 成功/失败
- token 签发
- bundle 生成
- bundle 拉取
- heartbeat 成功/失败
- revocation 下发
- license 状态变化

**建议**
v1 可以继续只有一张审计表，但把 `target_type` 规范成枚举 `authz / login / token / bundle / heartbeat / revocation / license`，并加索引 `(target_type, created_at)`；将来必要时再分表。当前 DDL 里 `target_type` 已经是 VARCHAR，所以是"规范化"而非"改结构"。

### P2-5 缺 `heartbeat` 高频表治理

**问题**
`deployment_heartbeats` 是高频写入表，没有分区、没有 TTL。按 5 分钟一次心跳、1000 客户 × 10 个 app 算，一年 10 亿行，很快就要爆。

**建议**
- 表名后缀 `_raw`，保留 N 天原始
- 加 `PARTITION BY RANGE (TO_DAYS(heartbeat_at))`
- 聚合 `deployment_heartbeat_daily` 做后台展示

v1 不必立刻做，但 DDL 注释里要标记。

---

## 2. 架构层面的一次收敛建议

问题清单堆一起会让人眼花，所以把修正建议归拢成四条主干，按这四条改就能把 Epic 1 真正走通。

### 主干 A：把"租户 / 部署 / 订阅 / 许可"四层分清

```
tenants                  商业实体、计费对象
  └── tenant_app_subscriptions  租户 × 应用的订阅事实
        └── deployments           运行时实例（tenant × app × env）
              ├── deployment_signing_keys  签名密钥（支持轮换）
              ├── licenses                  授权凭证
              │     └── license_capabilities
              ├── policy_bundle_targets     bundle 分发关系
              └── deployment_heartbeats     心跳
```

`tenants ─ subscription ─ deployment ─ license` 四层用 FK 串起来，bundle 按租户生成、按 deployment 分发。

### 主干 B：身份与授权主体完全收敛到 `subjects`

- 无论 `user / department / job`，一律在 subjects 表里（按 subject_type 区分）。
- `users` 作为可选薄壳（仅存登录 uid 与状态，不存 PII）。
- 所有授权相关表（`subject_roles` / `template_bindings` / `template_overrides`）都挂 `subject_id`。
- `subject_identities` 加 tenant_code 进唯一键；只存 "provider subject → subject_id" 的映射，不再回存姓名/邮箱。

### 主干 C：Control Plane 0 PII

- DDL 删除 `users.email / mobile / avatar_url / display_name / username`；保留 uid 作稳定标识。
- 显示用名/头像由 tenant 侧业务应用自己维护；平台 API 返回里如需 display_name，走 Identity Plane 的 federation 断言（请求当场解析，不落盘）。
- 同步一条约束进 CI：`hzy_platform/**` 里的 schema 不得出现 email/mobile/avatar 字段名。

### 主干 D：Token / Bundle / Revocation 的底座补齐

新增三张表，补 Identity Plane 的骨架：

1. `deployment_signing_keys` — 签名信任根
2. `sessions` — `token.sid` 落点 + 强制下线入口
3. `capabilities` — `license_capabilities.capability_code` 的父引用

然后：

- `policy_bundles` 去掉 `deployment_id`，改挂 `tenant_code`；加 `policy_bundle_targets(deployment_id, bundle_version)` 做分发。
- `revocation_snapshots` 同样改挂 tenant_code，分发关系拆一张 `revocation_snapshot_targets`。

---

## 3. 修正后的关键 DDL 变更清单（建议进 Batch-6 迁移草案）

下面按"加/改/删"整理成一份可评审的清单，每条都可直接转成 migration：

### 3.1 新增表

- `tenant_app_subscriptions`
- `capabilities`
- `deployment_signing_keys`
- `sessions`
- `app_supported_scopes`
- `policy_bundle_targets`
- `revocation_snapshot_targets`

### 3.2 字段调整

| 表 | 变更 |
|---|---|
| `applications` | 删除 `tenant_code` 列；unique 改 `(app_code)` |
| `users` | 删除 `display_name / email / mobile / avatar_url / username` |
| `user_roles` | 重命名为 `subject_roles`；`uid` 列改 `subject_id BIGINT`；unique 重建 |
| `subjects` | `tenant_code` 改 `NOT NULL`；所有 `tenant_code NULL` 的系统级 subject 迁移到 `tenant_code='__system__'` |
| `subject_identities` | unique 改 `(tenant_code, provider_type, provider_subject_key)`；`tenant_code` 改 `NOT NULL` |
| `roles / resources / permission_templates` | `tenant_code NULL` 语义统一替换为 `'__system__'`；unique 保持原列顺序即可生效 |
| `deployments` | 增 `subscription_id BIGINT UNSIGNED NOT NULL`（FK `tenant_app_subscriptions.id`）；增 `app_code VARCHAR(64) NOT NULL`；增 `current_kid VARCHAR(64)` |
| `licenses` | 增 `subscription_id`；允许查询时不强依赖 `deployment_id` |
| `license_capabilities` | `capability_code` 加 FK → `capabilities.capability_code` |
| `policy_bundles` | 去 `deployment_id`；加 `tenant_code` 非空；unique 改 `(tenant_code, bundle_version)` |
| `revocation_snapshots` | 同 `policy_bundles` 的处理 |

### 3.3 删除/弃用

- `users.tenant_code NULL` 这种系统级用户不应存在，统一删掉。
- 旧 `user_roles` 在 `subject_roles` 迁移完成后弃用。

---

## 4. 对当前实现的立刻可执行 fix（今天就能落）

如果只想先让"进 tenants 页面不 500"，不用等整个架构重构，有两个最小修复：

1. **deployments 加 app_code**
   ```sql
   ALTER TABLE deployments
     ADD COLUMN app_code VARCHAR(64) NOT NULL DEFAULT '' AFTER tenant_code,
     ADD KEY idx_deployments_tenant_app (tenant_code, app_code);
   ```
   已有数据按 `deployment_code` 拆出 app 字段回填，然后把默认值 `''` 去掉。

2. **subscriptions.ts 在 SQL 里加 fallback**
   ```sql
   LEFT JOIN deployments d
     ON d.tenant_code = ?
    AND (d.app_code = a.app_code OR d.app_code = '')
   ```
   作为 1 完成前的临时保护。

这两步做完，tenants / subscriptions 页就能恢复；然后再按主干 A~D 正经推重构。

---

## 5. 建议的下一步行动

1. 把本文档过一下 `planner` / 团队评审，确认主干 A~D 的方向（最敏感的是"删除 users PII"和"applications 取消 tenant_code"）。
2. 产出 `Batch-6-SQL-Migration-Draft.sql`，包含第 3 节的结构变更和数据迁移脚本。
3. 同步更新：
   - `HZY-Platform-SQL-DDL-Draft-v1.sql`（主 DDL）
   - `HZY-Platform-Schema-Draft-v1.md`（schema 说明）
   - `HZY-Platform-API-Draft-v1.md`（涉及 subscriptions / capabilities / sessions 新端点）
   - `Identity-Plane-Design.md` 附录：补充 signing_keys / sessions 表映射
4. 修掉 `platform/server/utils/subscriptions.ts` 的 `d.app_code` 依赖。
5. 把 backlog Epic 1 的 `[x]` 标记退回到 `[~]`（部分完成），避免给团队造成"已经可用"的错觉。

---

## 6. 风险与取舍

- **取消 `users` 的 PII** 会让"平台管理后台列用户"的能力变弱。取舍：平台后台只展示 uid+status，名字从 tenant 侧 identity assertion 临时渲染，不落盘。
- **取消 `applications.tenant_code`** 意味着未来"租户自建应用"能力要重新设计，但 v1 没这个需求，净收益。
- **`sessions / signing_keys` 都是高频/敏感表**，建议一开始就规划 KMS 集成与分区策略，别落到"先裸存，后面再说"。
- **subject 全面替代 uid 作为授权主体**，对 `user_roles` 等表是破坏性迁移，需要一次性 backfill，否则新旧语义并存会长期坑到人。

---

## 附录：和现有文档的差异速查

| 主题 | 现 DDL/Schema | 本文档建议 |
|---|---|---|
| 系统级 tenant_code | NULL | `'__system__'` 保留值 |
| users PII | 有 | 删除 |
| 授权主体 | uid + subject_id 并存 | 只留 subject_id |
| 订阅 | 无 | 新增 `tenant_app_subscriptions` |
| 签名密钥 | 无 | 新增 `deployment_signing_keys` |
| session | 无 | 新增 `sessions` |
| capability 注册表 | 无 | 新增 `capabilities` |
| policy_bundle 维度 | deployment | tenant + 分发关系表 |
| deployments 是否带 app | 否 | 是（并拆 subscription） |
| subject_identities 唯一键 | 全局 | 租户内 |
