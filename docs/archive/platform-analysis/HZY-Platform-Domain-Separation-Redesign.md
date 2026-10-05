# hzy_platform 双域重设计：平台域 vs 租户域

状态：Draft
日期：2026-04-22
定位：**根因诊断**。本文档是 `HZY-Platform-Schema-Critique-and-Fix.md` 的前置前提，提出对整个 schema 的**结构性**重审视角，而不是字段级修补。

---

## 0. 一句话结论

> 当前 `hzy_platform` schema 几乎**每张表都带 `tenant_code`**，它描述的是"租户里的世界"；但"平台"作为 SaaS 运营方本身是一个独立的域，有自己的用户、角色、资源、计费、审计、运营流程——这套模型在 schema 里完全是缺失的。
>
> 现在的设计不是"平台控制面"，而是"托管给平台的一份超级租户"。

这是为什么再怎么补 `tenants / subjects / deployments / licenses`，始终觉得"平台管理能力"不对味——因为**平台自己**根本没在数据模型里存在过。

---

## 1. 判据：为什么说平台域在 schema 里是缺的

用几个日常会问到的问题来反推。只要下面任一个问题在当前 DDL 里没有答案，就说明平台域缺失。

| 平台运营的日常问题 | 当前 DDL 能回答吗？ |
|---|---|
| 汇智云公司的员工（如运维、客服、销售）是谁？他们用什么账号登录平台后台？ | ❌ `users` 表强制要 `tenant_code`，平台员工不属于任何租户 |
| 销售给哪家租户开了哪个 plan 的订单？收款到账了吗？ | ❌ 没有订单/收款表 |
| 平台后台菜单"租户管理 / 应用市场 / 订阅 / 财务"这些资源谁定义、谁授权？ | ❌ 只有一条 seed `resources (tenant_code=NULL, app_code='platform')` 硬写死 |
| 平台工单：租户 A 报了个 bug，客服 B 在跟进，升级给工程师 C —— 记录在哪？ | ❌ 无 |
| 平台灰度：feature flag `new_bundle_format=on` 对哪些 deployment 打开？ | ❌ 无 |
| 平台公告：节假日维护通知推送给所有租户的超级管理员 | ❌ 无 |
| 产品目录：哪些 plan 存在、包含哪些 capability、单价多少？ | ❌ `license_capabilities` 存"已开通"，没有产品主表 |
| 平台 API 密钥：第三方供应商调用 hzy 公开 API 用的凭证 | ❌ 无 |
| 平台级审计：某运维人员在 10:05 把租户 X 的 license 从 enterprise 降到 pro | ❌ `authorization_audit_logs` 是租户内授权审计，不是平台运营审计 |

可以看到：**当前 schema 只回答"租户内部怎么运转"，不回答"平台本身怎么运转"。**

---

## 2. 两个域的定位

先把两个域的边界讲清楚，后面所有取舍都从这里推。

### 2.1 Platform Domain（平台域）

**对象**：汇智云这家公司本身。  
**角色**：售前 / 销售 / 客服 / 交付 / 运维 / SRE / 财务 / 产品 / 运营 / 超级管理员。  
**诉求**：卖产品、开租户、收钱、交付、运维、支持、合规审计、公告、灰度。

**关键特征**：
- 员工跨所有租户可见（只读或受控写入）
- 数据天然是全局的，不归属任何租户
- 是"对 tenant 的行为"的记录方（订单、审计、工单）
- 在 Self-Hosted Enterprise 模式下，这个域**不随产品交付给客户**（参考 ADR-006：Tenancy/Billing 可剥离）

### 2.2 Tenant Domain（租户域）

**对象**：每个客户公司内部。  
**角色**：租户内的用户 / 部门 / 岗位 / 角色 / 权限。  
**诉求**：登录、授权、订阅 app、部署、运行时运作。

**关键特征**：
- 所有对象带 `tenant_code`，物理/逻辑上按租户隔离
- 任何一行数据一定能回答"属于哪个租户"
- 在 Self-Hosted Enterprise 模式下，这个域**随产品交付给客户**

### 2.3 两个域的接壤面

有一小批对象天然**跨域**，它们是两个域的接触点：

- `tenants` 表本身：平台视角是"我的一个客户记录"，租户视角是"我是谁"。  
- `deployments` 表：平台签发给某租户的一份运行时实例。  
- `licenses / subscriptions`：平台卖给租户的授权。  
- `identity_providers`：租户用哪家 IdP 登录，平台侧要知道，租户侧也要知道。  

这些对象可以归到"Boundary 层"，规则是：**由平台创建、租户只读（或受限修改）**。

---

## 3. 当前 schema 的错位清单

以下是当前 DDL 里"实际上是平台级、但被塞到租户域里"的对象，以及"本应存在但没有"的平台域对象。

### 3.1 被错归为租户级的表（应该上浮到平台域）

| 表 | 现状 | 问题 | 正确归属 |
|---|---|---|---|
| `applications` | `tenant_code` 可空，seed 全 NULL | 产品目录是**平台资产**，不是租户拥有物；租户只"订阅" | Platform：`platform.applications` |
| `app_manifests` | 同上 | manifest 是产品内部契约，每个租户不该有自己的版本 | Platform：`platform.app_manifests` |
| `resources` | 系统级 seed 挂 tenant_code=NULL | 应用内资源定义来自产品（manifest），不是租户定义 | Platform（由 manifest 推导） |
| `roles` (当 `is_system=1`) | 混在 roles 里 | 系统级 role（super_admin、internal_user、aims:member 等）是产品定义 | Platform：`platform.system_roles` 或保留但 `tenant_code NOT NULL` 拆开 |
| `role_permissions` 系统级部分 | 混在同一张表 | 系统角色的权限本质是产品代码 | Platform |
| `permission_templates` 系统级部分 | 混在同一张表 | 同上 | Platform |
| `capabilities`（目前没有主表） | 以字符串散落在 `license_capabilities` | capability 是产品定义 | Platform：新建 `platform.capabilities` |

### 3.2 完全缺失的平台域表

**身份与访问控制（平台自己的）**

- `platform_accounts` — 平台员工的账户（uid / email / display_name / password_hash or oidc_sub）
- `platform_account_roles` — 平台员工的角色授予（关联 `platform_roles`）
- `platform_roles` — 平台内置角色（ops_admin / billing_viewer / support_agent / sre / super_admin）
- `platform_role_permissions` — 平台角色对平台资源的权限
- `platform_resources` — 平台后台功能资源（tenants / subscriptions / billing / audit / announcements ...）
- `platform_sessions` — 平台员工的登录会话

**产品目录**

- `platform_applications`（从当前 `applications` 拆出来）
- `platform_plans` — plan 主表（Starter / Pro / Enterprise）
- `platform_plan_capabilities` — plan 包含哪些 capability
- `platform_capabilities` — capability 定义
- `platform_app_manifests`（从当前 `app_manifests` 拆出来）

**商业 / 运营**

- `platform_orders` — 订单（租户 × plan × 数量 × 金额 × 状态）
- `platform_invoices` — 发票
- `platform_payments` — 收款
- `platform_tenant_lifecycle_events` — 租户生命周期事件（申请、激活、续费、降级、退订、迁移、删除）
- `platform_tickets` — 客户工单
- `platform_announcements` — 平台公告
- `platform_feature_flags` — 灰度开关

**审计 / 可观测**

- `platform_audit_logs` — **平台员工对租户 / 配置的操作审计**（与 `authorization_audit_logs` 区分开）
- `platform_api_keys` — 供平台管理后台/第三方集成使用的 API 凭证
- `platform_webhooks` — 平台对外推送事件

### 3.3 当前混在一起的审计表

`authorization_audit_logs` 目前有两类事实都往里塞：
1. 租户内管理员改了自家某人的角色（应属租户域）
2. 平台运维给租户发了一份新 license（应属平台域）

这两类事件合规要求、保留期、检索维度全不同，必须分表。

---

## 4. 目标架构：双域 + 边界表

### 4.1 物理分层建议

**推荐方案：同库双 schema 前缀**

```
hzy_platform (MySQL database)
├── platform_*           —— 平台域表（不带 tenant_code）
├── tenant_*             —— 租户域表（带 tenant_code NOT NULL）
└── boundary_*           —— 跨域接壤表（tenants / subscriptions / deployments / licenses）
```

理由：
- 一份部署（Managed SaaS）两域都在
- Self-Hosted Enterprise 交付时，只打包 `tenant_*` + `boundary_*`（按客户侧需要子集），把 `platform_*` 留在汇智云自己的云端
- 跨 schema 查询在同一 MySQL 实例上没代价
- 不强行拆库，运维复杂度低

如果未来规模大，可以平滑拆成两个数据库：`hzy_platform_ops`（平台域）+ `hzy_platform_tenancy`（租户+边界）。

### 4.2 修正后的顶层表分组

```
┌────────────────────────────────────────────────────────────────┐
│ Platform Domain                                                 │
│  platform_accounts          平台员工账户                         │
│  platform_account_roles     员工角色授予                         │
│  platform_sessions          员工登录会话                         │
│  platform_roles             平台内置角色                         │
│  platform_role_permissions  平台角色权限                         │
│  platform_resources         平台后台资源                         │
│  platform_applications      产品目录：应用                       │
│  platform_app_manifests     应用 manifest                        │
│  platform_capabilities      能力定义                             │
│  platform_plans             套餐定义                             │
│  platform_plan_capabilities 套餐能力                             │
│  platform_system_roles      系统级角色模板（下发到租户）          │
│  platform_system_resources  系统级资源模板                       │
│  platform_orders            订单                                 │
│  platform_invoices          发票                                 │
│  platform_payments          收款                                 │
│  platform_tenant_lifecycle  租户生命周期事件                     │
│  platform_tickets           工单                                 │
│  platform_announcements     公告                                 │
│  platform_feature_flags     灰度                                 │
│  platform_audit_logs        平台运营审计                         │
│  platform_api_keys          平台集成凭证                         │
│  platform_webhooks          平台事件推送                         │
├────────────────────────────────────────────────────────────────┤
│ Boundary Domain                                                 │
│  tenants                    租户主表                             │
│  subscriptions              租户 × 应用的订阅事实                 │
│  deployments                运行时实例 + 签名根                   │
│  deployment_signing_keys    签名密钥                             │
│  licenses                   授权凭证                             │
│  license_capabilities       授权内能力开通                       │
│  policy_bundles             策略包（tenant 级）                   │
│  policy_bundle_targets      bundle 下发关系                      │
│  revocation_snapshots       吊销快照                             │
│  deployment_heartbeats      心跳                                 │
├────────────────────────────────────────────────────────────────┤
│ Tenant Domain                                                   │
│  tenant_users               租户内用户（薄壳，无 PII）            │
│  tenant_subjects            租户内授权主体（user/dept/job）       │
│  tenant_subject_identities  上游 IdP 映射                        │
│  tenant_sessions            用户会话                             │
│  tenant_roles               租户自定义角色                       │
│  tenant_role_permissions    租户角色权限                         │
│  tenant_subject_roles       主体 → 角色                          │
│  tenant_permission_templates 租户模板                            │
│  tenant_template_roles      模板 → 角色                          │
│  tenant_template_bindings   模板绑定                             │
│  tenant_template_overrides  模板例外                             │
│  tenant_role_scopes         范围规则                             │
│  tenant_identity_providers  本租户接入的 IdP 配置                 │
│  tenant_audit_logs          租户内授权/行为审计                   │
└────────────────────────────────────────────────────────────────┘
```

关键点：

- **`tenant_*` 所有表 `tenant_code` 一律 NOT NULL**，不存在"系统级 NULL"
- **"系统级角色/模板"被上浮到平台域** 作为模板，租户创建时由平台按 plan 下发到自己的 `tenant_roles / tenant_permission_templates`
- **Boundary 表**是"平台签发给租户"的契约产物，两边都读，只有平台写
- **审计分家**：`platform_audit_logs`（谁动了租户配置）vs `tenant_audit_logs`（租户内谁动了什么）

### 4.3 系统级角色的新下发模型

旧模型：seed 一把 `tenant_code=NULL` 的系统级 role，所有租户共享引用。  
新模型：

1. 平台域 `platform_system_roles` 存"产品内置角色模板"（super_admin、internal_user、aims:member、...）
2. 租户创建时（或订阅某 app 时），由租户生命周期编排器把相关模板**复制**到 `tenant_roles`（用同名 role_code，但 `tenant_code=该租户`）
3. 后续租户可以在自己的副本上做 `is_overridden=1` 的定制（不影响平台模板）
4. 平台升级模板时，用一个单独的"模板升级"动作重新下发（差异以补丁形式呈现给租户管理员）

这样做的好处：
- 所有授权查询 `tenant_code NOT NULL`，无歧义
- 租户可安全定制，不污染平台模板
- 平台升级 = 可审计的推送动作，不是"改 seed"

---

## 5. 对现有 DDL / 文档的影响清单

这是从"字段级修补"升级到"结构级重构"后，需要一起动的地方。

### 5.1 DDL 层

**删除/改造**
- `users` → 拆成 `platform_accounts`（平台员工）+ `tenant_users`（租户用户，仅 uid+status）
- `subjects` → `tenant_subjects`，`tenant_code NOT NULL`
- `subject_identities` → `tenant_subject_identities`
- `roles` → 拆成 `platform_roles` + `platform_system_roles` + `tenant_roles`
- `role_permissions` → 同样三分
- `permission_templates` → 拆 `platform_system_templates` + `tenant_permission_templates`
- `template_bindings / template_overrides / role_scopes` → 全部加 `tenant_` 前缀，`tenant_code NOT NULL`
- `applications / app_manifests` → 上浮到平台域，去掉 `tenant_code`
- `resources` → 上浮到平台域（由 manifest 驱动）
- `authorization_audit_logs` → 拆 `platform_audit_logs` + `tenant_audit_logs`

**新增**
- `platform_accounts / platform_account_roles / platform_sessions`
- `platform_resources / platform_role_permissions`
- `platform_capabilities / platform_plans / platform_plan_capabilities`
- `platform_orders / platform_invoices / platform_payments`
- `platform_tenant_lifecycle / platform_tickets / platform_announcements / platform_feature_flags`
- `platform_api_keys / platform_webhooks`
- `platform_audit_logs`
- `subscriptions`（边界层）
- `deployment_signing_keys`（边界层）
- `tenant_sessions`
- `tenant_identity_providers`

### 5.2 API 层

`HZY-Platform-API-Draft-v1.md` 里统一前缀是 `/api/platform/admin/...`，但语义全是"管理租户的东西"。需要拆成：

- `/api/platform/ops/...` —— 平台运营后台（平台员工用）
  - `/api/platform/ops/accounts`（平台员工）
  - `/api/platform/ops/orders`
  - `/api/platform/ops/plans`
  - `/api/platform/ops/tenants`（从平台视角看租户）
  - `/api/platform/ops/tickets`
  - `/api/platform/ops/audit`
- `/api/platform/tenant-admin/...` —— 租户管理员后台（每家客户的 admin 用）
  - `/api/platform/tenant-admin/users`
  - `/api/platform/tenant-admin/roles`
  - `/api/platform/tenant-admin/subscriptions`
- `/api/platform/runtime/...` —— 应用运行时（不变）
- `/api/platform/internal/...` —— Identity Plane 内部（不变）

这样前端菜单、后端路由守卫、权限模型都能清晰地按角色分流。

### 5.3 Frontend 层

`Platform-Frontend-Product-Plan.md` 里的"平台管理后台"是**两个产品**的混装：

- "汇智云运营后台"（平台域）：我们自己团队用
- "企业管理员控制台"（租户域）：客户的 admin 用

必须拆成两个 entry，登录路径、鉴权模型、菜单都不一样。

### 5.4 Backlog 层

Epic 1 "hzy_platform 基础建设"的 T1~T5 都需要扩充任务：

- T1 schema：新增平台域/边界域/租户域三组
- T3 应用骨架：要区分 `apps/ops-console` vs `apps/tenant-console`
- T4 Identity Plane：要区分平台员工登录 vs 租户用户登录
- T5 Control Plane API：要按 ops / tenant-admin / runtime 分组

---

## 6. 平台域最小闭环（v1 可落地的子集）

不是要一口吃成胖子。v1 平台域最小闭环只做这些：

**P0（必做）**
- `platform_accounts` + `platform_sessions`：先让"汇智云运营人员登录后台"这件事成立
- `platform_roles` + `platform_role_permissions` + `platform_resources`：只做固定三个内置角色（`super_admin / ops_admin / support_agent`），够用
- `platform_applications` + `platform_app_manifests` + `platform_capabilities` + `platform_plans`：产品目录能描述"卖什么"
- `platform_audit_logs`：至少记录平台员工对租户的关键动作

**P1（紧接着）**
- `subscriptions`（边界层）：租户订阅事实
- `platform_tenant_lifecycle`：申请/激活/续费/降级
- `platform_system_roles / platform_system_templates` + 租户创建时复制下发

**P2（后置）**
- 订单/发票/收款（如果初期人工 Excel 记账也能扛）
- 工单/公告/灰度
- API keys / webhooks

**明确不做（v1 外）**
- 多币种/税务/复杂计费
- 客服知识库
- 平台内部 OKR / 工时 / HR

---

## 7. 和前一份 Critique 文档的关系

`HZY-Platform-Schema-Critique-and-Fix.md` 列的 P0~P2 问题**都仍然成立**，但本质上是在现有"单域"模型上打补丁。本文档的结论是：

- 本文档的"双域重构"是**根因方案**
- Critique 文档的"字段级修补"是**在双域重构没落地前的止血**
- Critique 里的第 4 节"今天就能落的 hotfix"仍可先做，让现网不 500
- Critique 里的主干 A~D（订阅、subjects 收敛、零 PII、签名/session/capability 底座）在双域重构里**全部仍然需要**，只是要落到正确的域（租户域或边界域或平台域）

两份文档配合起来，大致是：

```
本文档（Domain-Separation）        ←  根因 + 目标形态
          ↓
Critique-and-Fix                  ←  从现状到目标的修补动作清单
          ↓
Batch-6-SQL-Migration-Draft.sql   ←  可执行的 DDL 迁移（尚未产出）
```

---

## 8. 风险与争议点

以下问题需要决策：

1. **Self-Hosted Enterprise 模式下 `platform_*` 是否完全剥离？**  
   建议：是。企业版交付物里只有 `tenant_*` + `boundary_*`（其中 boundary 也只保留本部署用的那份 license / signing_key / bundle）。`platform_*` 留在汇智云云端。

2. **系统级角色"下发到租户副本"会不会导致规模膨胀？**  
   按 100 租户 × 10 个系统 role = 1000 行，可控；关键是能让授权查询无歧义。

3. **`platform_applications` 和 `app_manifests` 上浮，那 application_code 怎么保证全局唯一？**  
   上浮后就是全局唯一（直接 primary key），不需要 tenant_code。租户侧引用时一律视为外部常量。

4. **租户的自定义角色、模板命名如何避免和系统模板冲突？**  
   约定：系统模板 role_code 以 `sys:` 前缀，租户自定义不得以此前缀；`tenant_roles` 上加 CHECK 约束。

5. **平台员工 SSO 怎么做？**  
   建议 v1 自建密码 + 2FA，后续接自家 IdP（复用 Identity Plane，但走独立 realm，不和任何租户混）。

---

## 9. 下一步建议

1. 本文档过一次团队评审，锁定双域边界
2. 把 `HZY-Platform-Schema-Draft-v1.md` 和 `HZY-Platform-SQL-DDL-Draft-v1.sql` 按第 4.2 节的分组全面重写（不是增量 patch，是 v2 重写）
3. 同步改 API 草案，按 `/ops` / `/tenant-admin` / `/runtime` / `/internal` 四段
4. 把 Implementation-Backlog 里 Epic 1 的 `[x]` 退回 `[~]`，新增 Epic 1B「平台域建设」
5. 前端 `platform/app` 骨架按两个 entry 拆：ops-console / tenant-console
6. `Batch-6-SQL-Migration-Draft.sql` 按第 5.1 节列表产出

---

## 10. 附录：判断一张表属于哪个域的简易决策树

```
这张表里一行数据回答"属于哪个租户"时——

├── 答案是「这就是汇智云公司的事」         → 平台域（platform_*）
├── 答案是「属于租户 X」                 → 租户域（tenant_*）
└── 答案是「是平台签给租户 X 的东西」     → 边界域（tenants / subscriptions / deployments / licenses）
```

这条决策树贴上会议室墙，后续讨论任何新表的归属都按它走。
