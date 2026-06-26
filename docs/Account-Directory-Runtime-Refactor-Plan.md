# Account 目录能力向 Console Directory Runtime 迁移清单

状态：Draft  
日期：2026-04-26  
定位：迁移设计，配套 `Directory-Runtime-Contract.md`、`Console-Directory-Runtime-Integration-Plan.md`、`Huizhi-yun-Platform-Target-Architecture.md`

---

## 0. 文档目标

本文档回答三个具体问题：

- 当前 `account` 哪些能力要迁入 `console.directory-runtime`
- 哪些职责必须迁出到 `platform`
- 哪些历史能力只做兼容，不应继续在 `account` 上扩张

本文档是**改造清单**，不是一次性重写方案。

基本判断：

- **短中期保留 `account` 模块**
- **不再把它当平台控制面中心**
- **逐步把目录能力迁入 `console.directory-runtime`**
- **迁移完成后，`account` 只保留兼容 facade / fallback，或直接下线**

---

## 1. 当前现状快照

当前 `account` 公开和承载的能力，已经混合了四类不同职责：

1. 组织目录
2. 平台 IAM / 授权治理
3. 平台级支撑服务
4. 若干历史沉积的跨模块工具能力

从当前文档与代码看，Foundation 和业务模块实际仍在大量消费 `account`：

- Foundation store / composable：
  - `foundation/app/stores/account.ts`
  - `foundation/app/composables/useAccount.ts`
- 当前稳定消费接口：
  - `GET /api/v1/users`
  - `GET /api/v1/users/{uid}`
  - `POST /api/v1/users/batch`
  - `GET /api/v1/departments`
  - `GET /api/v1/dept-members`
  - `GET /api/v1/user-departments`
  - `GET /api/v1/projects`
  - `GET /api/v1/users/{uid}/projects`
  - `GET /api/v1/business-domains`

因此改造策略必须是：

- **保留现有消费者**
- **先收窄边界，再迁移职责**
- **最后再考虑改名或物理拆分**

---

## 2. 目标定位

`account` 的目标角色不再是“统一身份与访问管理大一统模块”，也不再是长期必选的企业端基础运行时，而是：

**`console.directory-runtime` 的迁移源、兼容 facade 和 fallback。**

一句话定义：

- `console.directory-runtime` 负责“人、部门、岗位、项目注册表长什么样”
- `account` 在迁移期继续提供现有目录数据和兼容 API
- `platform` 负责“这些主体对哪些应用有什么权限”
- 业务应用从 `platform` 取授权结果，通过 Foundation directory adapter 从 `console.directory-runtime` 取目录信息；迁移期可 fallback account

---

## 3. 迁入 Console Directory Runtime 的能力

以下能力短期继续由 `account` 提供，目标迁入 `console.directory-runtime`，并逐步按 `directory-runtime` 契约标准化。

### 3.1 目录主数据与同步

迁入：

- 用户目录
- 部门树
- 用户与部门关系
- 委员会 / 特殊组织节点
- 岗位、汇报线等可扩展组织结构
- LDAP / HR / 企业微信 / 钉钉等目录源同步

目标接口：

- `GET /api/v1/directory/users`
- `GET /api/v1/directory/users/:uid`
- `GET /api/v1/directory/departments`
- `GET /api/v1/directory/dept-members`
- `GET /api/v1/directory/user-departments`

兼容策略：

- 现有 `/api/v1/users*`、`/api/v1/departments*` 先保留
- 新契约优先补到 console `directory/*`
- Foundation 继续通过 adapter 屏蔽 account/console 切换，避免业务模块大面积改动

### 3.2 项目注册表

迁入 console，但必须明确是**注册表**而不是业务项目系统：

- `project_code`
- 项目名称
- 上下级项目组结构
- 负责人 / 所属部门 / 参与人等基础归属
- 跨模块需要共享的最小项目元数据

可以继续保留的接口：

- `GET /api/v1/projects`
- `GET /api/v1/projects/{project_code}`
- `GET /api/v1/users/{uid}/projects`
- 必要时保留最小的项目注册表写接口：`POST/PUT/DELETE /api/v1/projects/*`

边界要求：

- `account` 只管项目注册表，不管研发执行、经营过程、文档协同等业务状态
- GitLab 文档同步、冲突解决等不属于目录服务核心能力，应逐步剥离

### 3.3 目录管理页面

租户侧仍然需要目录管理页。迁移期继续由 `account` 提供，目标由 `console.directory-runtime admin` 承接。

页面职责包括：

- 数据源接入配置
- 同步开关与全量/增量同步
- 字段映射、组织映射
- 异常记录、冲突处理、手工校正
- 项目注册表维护

注意：

- 这是**租户侧目录运营页**
- 不是 `platform` 托管目录明细的页面

### 3.4 目录服务自身的运行摘要

迁入 console 后继续对接平台治理：

- `contractVersion`
- `snapshotHash`
- `syncCursor`
- `userCount / departmentCount / projectCount`
- `syncLagSeconds`

这些信息通过 heartbeat 上报给 `platform`，但目录明细不出客户侧。

---

## 4. 必须迁出到 Platform 的能力

以下能力不应继续留在 `account`，而应由 `platform` 接管。

### 4.1 角色、权限、资源模型

当前接口：

- `GET /api/v1/users/{uid}/permissions`
- `POST /api/v1/permissions/check`
- `POST /api/v1/resources/sync`

目标去向：

- `platform_roles / platform_resources / platform_role_permissions`
- `tenant_roles / tenant_role_permissions / tenant_subject_roles / tenant_account_roles`
- `policy_bundles`

改造要求：

- 新应用不得再新增对 `account` 权限接口的依赖
- 应用鉴权结果优先来自 `platform` 下发的 token claims / policy bundle / runtime 配置
- `account` 不再作为跨应用授权裁决中心

### 4.2 应用注册与应用可见性

当前接口：

- `GET /api/v1/applications?uid={uid}`
- `POST /api/v1/resources/sync`

目标去向：

- `platform_applications`
- `platform_app_manifests`
- `subscriptions`
- `deployments`

改造要求：

- 应用入口、应用清单、manifest 审核、租户开通状态统一由 `platform` 管理
- `AppLauncher` 最终应从 `platform` 的租户上下文获取可访问应用，而不是继续查 `account`

### 4.3 平台身份与登录信任链

当前 `account` 仍承载部分统一认证与登录桥能力。

目标去向：

- `platform_accounts`
- `platform_sessions`
- `platform_account_identities`
- 平台 Identity Plane

改造要求：

- 控制面账户登录统一由 `platform` 管理
- 客户 IdP federation、Token 签发和平台信任链逐步转到 `platform`
- `account` 可以保留上游目录同步适配，但不再作为平台主登录中心

### 4.4 订阅、License、Capability、Revocation

这些能力属于控制面治理，不应继续沉积在 `account`。

目标去向：

- `subscriptions`
- `licenses`
- `license_capabilities`
- `policy_bundles`
- `revocation_snapshots`

---

## 5. 不属于 Directory Runtime 核心、应拆出或封存的能力

这些能力可以短期兼容保留，但不应继续作为 `account` 的核心方向。

| 当前能力 | 当前接口 / 形态 | 处理建议 |
|---|---|---|
| GitLab 文档同步与冲突处理 | `/api/v1/projects/{project_code}/gitlab-*` | 迁往 Codocs / Aims 或独立 Git 集成服务 |
| 企业微信消息发送 | `/api/v1/wecom/send` | 拆到通知服务或 Foundation `notify` 背后的 supporting service |
| AI 网关 | `/api/v1/ai/*` | 拆成独立 `ai-gateway` supporting service |
| 登录/操作审计汇聚 | `/api/v1/login-logs`、`/api/v1/operation-logs` | 迁向 `platform` 审计体系，迁移期兼容保留 |
| 在线心跳 / 在线用户 | `/api/v1/heartbeat*` | 短期保留；中期拆成 presence / runtime 支撑服务 |
| 公司管理 | `/api/v1/companies*` | 迁向 `console` 的 `org-profile` 子域；仅平台租户台账留在 `platform` Boundary Domain |
| 业务领域 / 区域管理 | `/api/v1/business-domains`、`/api/v1/companies/:code/regions*` | 短期保留；中期收敛到 `console` 的 `org-profile` / `system-settings` 子域 |
| 跨模块粘贴板 | `/api/v1/clipboard` | 工具能力，独立为 Foundation 支撑能力或轻量 utility service |

原则：

- 可以保留兼容
- 不应继续增强
- 新平台能力禁止再接到这些旧入口上

---

## 6. API 改造清单

### 6.1 继续保留并标准化

| 当前 API | 目标状态 | 说明 |
|---|---|---|
| `GET /api/v1/users` | 保留 + 新增别名 `GET /api/v1/directory/users` | 用户列表 |
| `GET /api/v1/users/{uid}` | 保留 + 新增别名 `GET /api/v1/directory/users/{uid}` | 用户详情 |
| `POST /api/v1/users/batch` | 保留 | Foundation 现有批量解析仍依赖 |
| `GET /api/v1/departments` | 保留 + 新增别名 `GET /api/v1/directory/departments` | 部门树 |
| `GET /api/v1/dept-members` | 保留 + 新增别名 `GET /api/v1/directory/dept-members` | 部门成员 |
| `GET /api/v1/user-departments` | 保留 + 新增别名 `GET /api/v1/directory/user-departments` | 用户-部门关系 |
| `GET /api/v1/projects` | 保留 + 新增别名 `GET /api/v1/directory/projects` | 项目注册表 |
| `GET /api/v1/users/{uid}/projects` | 保留 + 新增别名 `GET /api/v1/directory/users/{uid}/projects` | 用户项目归属 |

### 6.2 停止新增依赖，迁到 Platform

| 当前 API | 后续策略 |
|---|---|
| `GET /api/v1/users/{uid}/permissions` | 冻结；后续由 `platform` 授权结果替代 |
| `POST /api/v1/permissions/check` | 冻结；应用本地基于 bundle / token 判定 |
| `POST /api/v1/resources/sync` | 停止新增；改由 `platform` manifest 注册链路承接 |
| `GET /api/v1/applications?uid=` | 停止新增；改由 `platform` 租户应用入口提供 |
| `POST /api/v1/auth/verify-token` | 仅 legacy bridge 兼容；新平台能力不再依赖 |

### 6.3 仅兼容，不再扩展

| 当前 API 组 | 后续策略 |
|---|---|
| `/api/v1/wecom/*` | 兼容保留，禁止新增目录无关能力 |
| `/api/v1/ai/*` | 兼容保留，准备外拆 |
| `/api/v1/login-logs` / `/api/v1/operation-logs` | 兼容保留，准备迁平台审计 |
| `/api/v1/heartbeat*` | 兼容保留，准备收口到独立 presence/runtime 支撑能力 |
| `/api/v1/companies*` / `/business-domains*` / `/regions*` | 短期保留，后续迁到 `console` 的 `org-profile` / `system-settings` |
| `/api/v1/clipboard` | 兼容保留，不作为目录服务主能力继续发展 |

---

## 7. Foundation 改造要求

Foundation 是这次迁移的关键适配层。

### 7.1 必须保持兼容的现有消费面

当前 Foundation 直接依赖 `account` 的能力包括：

- `useAccount`
- `useAccountStore`
- `UserTreeSelector`
- `UserMenu`
- `WorkflowTimeline`
- `notify`（通过 `wecom/send`）
- `reportLoginAudit` / `reportOperationAudit`

### 7.2 改造方向

1. `useAccount*()` 在语义上视为目录适配层，不再承担平台权限语义。
2. 后续可以逐步增加 `useDirectory*()`，但短期内保留 `useAccount*()` 作为兼容别名。
3. 新平台能力统一走：
   - `platform-sdk`
   - 新的 platform client / adapter
   - `usePermissions`
4. 不再往 `foundation/server/utils/accountApi.ts` 中塞新的 `hzy_platform` 控制面能力。

这和 `foundation/docs/Legacy-Auth-Bridge.md` 的约束一致：

- 旧 `account` 桥可保留
- 新平台 token / bundle / revocation / deployment heartbeat 不得继续走旧桥

---

## 8. 分阶段实施建议

### Phase 0：冻结边界

- 禁止再往 `account` 新增角色、授权、应用治理、license 等平台能力
- 新需求若属于目录能力，按 `directory-runtime` 契约设计
- 新目录能力默认落到 `console`，确需 account 承接时必须标注为迁移期兼容
- 新需求若属于授权治理，直接落到 `platform`

### Phase 1：补目录契约别名与 Console 目录域

- 在 `console` 中建立 `directory-runtime` 逻辑域与本地目录表/缓存
- 在 `account` 中补齐迁移期 `/api/v1/directory/*`
- 保持旧 `/api/v1/users*`、`/departments*`、`/projects*` 继续可用
- Foundation 不强制一次性改消费者，但新增 directory adapter

### Phase 2：平台接管授权

- 应用资源注册改走 `platform_app_manifests`
- 应用授权改走 `platform` policy bundle / runtime
- 租户控制台应用入口改由 `platform` 返回
- Foundation 停止再调用 `account` 权限接口

### Phase 3：Console mirror account 目录数据

- console 定时从 account 拉取用户、部门、项目注册表
- console 生成 `directory_subject_exports`
- platform `subject_sync` 从 console 最小投影同步
- 业务读取进入 shadow compare：console 结果与 account 结果比对

### Phase 4：Console 成为目录主读入口

- Foundation directory adapter 默认读 console
- account 仅 fallback
- 新应用不得新增 account 直接依赖

### Phase 5：拆出非目录能力

- AI 网关独立
- 通知能力独立
- 审计上报迁平台
- 在线心跳从 `account` 剥离
- GitLab 文档同步迁到更合适的业务侧

### Phase 6：account 退场

- 若无历史消费者，停止部署 account
- 若仍有历史消费者，保留薄 facade，内部反向代理到 console directory-runtime
- 不再维护 account 自己的目录写路径

---

## 9. 明确不做的事

- 不做“大爆炸式”重写
- 不要求立刻把 `account` 拆成多个新服务
- 不要求马上替换所有 Foundation `useAccount*()` 调用点
- 不让业务模块同时直连 `account` 表和 `platform` 表
- 不把 `account` 继续当成新平台控制面的唯一入口
- 不把 account 作为新的长期目录服务终态继续扩大

---

## 10. 结论

最务实的路线不是马上推倒 `account`，而是：

1. **保留它**
2. **把它重新定性为迁移源和兼容层**
3. **把平台治理能力迁走**
4. **把目录主读入口迁到 console**
5. **把非目录历史能力逐步拆走**

最后留下来的 `account`，本质上只应是：

**一个可删除的兼容 facade；真正的目录运行时在 `console.directory-runtime`。**

---

## 11. 实施记录

### 2026-04-26：Console Directory Runtime 只读 API 与兼容 facade

已完成：

- 在 `console` 增加 `server/utils/directoryRuntime.ts`，统一从 `directory_users / directory_departments / directory_projects / directory_subject_exports` 读取目录数据。
- 在 `console` 增加标准目录接口：`/api/v1/console/directory/**`。
- 在 `console` 增加迁移期别名：`/api/v1/directory/**` 与 Account 稳定读接口 `/api/v1/users* / departments / projects / user-departments`。
- 将 Console 内部 `/api/account/**` 兼容入口从“反向代理 Account”改为“读取 Console directory-runtime”。
- 将 Console 登录回调中的用户资料补齐改为读取本地 Directory Runtime，不再通过 Account 查询用户详情。

本次完成的是 Phase 1 的读取面与兼容 facade，不包含：

- 目录管理页面迁移。
- LDAP / 企业微信 / 钉钉等目录源同步任务迁移。
- 通知、审计、心跳、AI 网关等非目录能力拆分。
- Platform 授权治理接管的业务模块切换。

### 2026-04-26：Console 目录用户 / 部门只读管理页

已完成：

- 在 `console` 新增 `/directory/users`，用于查看 `directory_users` 中的用户、主部门、邮箱、手机尾号、用户类型与状态。
- 在 `console` 新增 `/directory/departments`，用于查看 `directory_departments` 的组织树、负责人、Leader 和父级关系。
- 在 `console` 的菜单、路由权限和 `app.manifest.json` 中新增 `directory_users` / `directory_departments` 资源。

边界说明：

- 本阶段页面为只读镜像视图，不承接 Account 原页面中的 LDAP 同步、企业微信绑定、部门编辑、委员会成员编辑等写操作。
- 写操作后续必须先落到 Console Directory Sync Job / Directory Admin API，再逐步开放 UI，避免直接复刻 Account 的旧写路径。

### 2026-04-26：Console Directory Sync Job 最小框架

已完成：

- 在 `console` 增加 `server/utils/directorySyncJobs.ts`，统一管理目录同步任务创建、查询与执行结果写入。
- 新增 `GET /api/v1/console/directory/sync-jobs`，用于查询最近同步任务。
- 新增 `POST /api/v1/console/directory/sync-jobs`，用于触发同步任务。
- 新增 `GET /api/v1/console/directory/sync-jobs/{jobCode}`，用于查询单个任务状态。
- 新增 `/directory/sync` 页面，展示同步任务并支持手动重建 `directory_subject_exports`。
- 当前已实现的 provider/scope：`providerCode=console|manual` + `objectScope=subjects|all`，用于从本地 `directory_*` 表生成 Platform subject sync 所需的最小投影。

边界说明：

- `ldap / wecom / dingtalk / account` provider 已作为任务模型枚举预留，但真实拉取逻辑暂不开放。
- 外部目录源同步必须先接入 `integrations + vault`，再实现 provider runner，避免继续依赖 Account 环境变量和散落的同步 API。
- `/directory/sync` 只面向 Console 管理端，业务应用不得直接调用同步任务接口。

### 2026-04-26：Console Directory Source 配置层

已完成：

- 在 `console` 增加 `server/utils/directorySources.ts`，统一管理 LDAP / 企业微信 / 钉钉目录源配置。
- 新增 `/api/v1/console/directory/sources` 查询与创建接口。
- 新增 `/api/v1/console/directory/sources/{providerCode}` 查询与更新接口。
- 新增 `/directory/sources` 管理页，用于维护目录源名称、状态、Base URL、非敏感 provider 配置与 secret 引用。
- 在 `console` 的菜单、路由权限和 `app.manifest.json` 中新增 `directory_sources` 资源。
- 目录源 credential 只写入 `vault_secrets / vault_secret_versions / integration_credentials` 的引用和摘要，不保存明文 secret。

边界说明：

- 本阶段只是目录源配置层，尚未实现 LDAP / 企业微信 / 钉钉真实同步 runner。
- 同步 runner 后续必须从 `integrations + vault` 解析配置，不再读取 Account 模块环境变量。
- 页面中的 `backendSecretRef` 是环境变量、Docker Secret 或 Kubernetes Secret 的引用，不是密钥明文。

### 2026-04-26：Console Directory Provider Runner（第一阶段）

已完成：

- 在 `console` 增加 `server/utils/directoryProviderRunners.ts`，把外部目录源同步执行逻辑从 Account API 形态迁到 Console Directory Runtime。
- `directory_sync_jobs` 已接入 `wecom / dingtalk / ldap` provider 分派：
  - `wecom`：从企业微信通讯录拉取部门和用户，写入 `directory_departments / directory_users / directory_user_departments / directory_identities`。
  - `dingtalk`：从钉钉拉取部门和用户，写入同一组 Console Directory Runtime 表。
  - `ldap`：第一阶段只接入任务模型；真实用户同步已在后续记录补齐。
- 企业微信 / 钉钉同步完成后自动重建 `directory_subject_exports`，保证 Platform subject sync 读取的是最新最小投影。
- `/directory/sync` 页面新增“同步企业微信 / 同步钉钉 / LDAP 操作”入口。
- 运行时凭证从 `integrations + integration_credentials + vault_secrets + vault_secret_versions` 解析；当前支持 `storage_backend=env_ref`，不读取 Account 模块环境变量。

边界说明：

- 本阶段不迁移 Account 中的消息发送、JSSDK、邮箱回写等非目录能力。
- 目录同步采用 Console 表为目标，不再写 Account 的 `system_users / departments / user_status_cache`。
- 由于 Directory Runtime 外键要求用户所属部门先存在，provider runner 会先同步部门，再同步用户和身份映射。

### 2026-04-26：Console LDAP Provider Runner

已完成：

- `console` 声明 `ldapjs / @types/ldapjs` 依赖，LDAP 同步不再依赖 Account 模块实现。
- `directoryProviderRunners.ts` 已实现 LDAP 用户拉取：从 `integrations + vault` 读取 `host / port / bindDN / baseDN / userBase / useTLS` 与 bind secret。
- LDAP 同步写入 `directory_users / directory_identities`，并保留 LDAP DN 到 `directory_identities.provider_dn`。
- `objectScope=all` 时，会将本次 LDAP 中缺失且 `source_provider='ldap'` 的用户标记为 `deleted`，不影响手工用户或企业微信/钉钉用户。
- `/directory/sync` 中 LDAP 操作从“校验 LDAP”改为“同步 LDAP”。

边界说明：

- 当前 LDAP runner 只迁移用户与身份映射，不臆造部门；如果后续 LDAP 中有稳定部门属性，需要单独设计 LDAP 部门映射规则。
- 当前只支持 `storage_backend=env_ref` 的 secret 解析，Docker Secret / Kubernetes Secret 后续需补 resolver。

### 2026-04-26：Console Directory Sync Job 详情与事件查看

已完成：

- 新增 `GET /api/v1/console/directory/sync-jobs/{jobCode}/events`，用于查询指定同步任务的 `directory_sync_events`。
- 新增 `/directory/sync/{jobCode}` 任务详情页，展示任务状态、计数器、错误信息、时间线和最近同步事件。
- `/directory/sync` 列表中的 jobCode 已可点击进入详情。
- `directory_sync_jobs` 失败时会写入一条 `summary / __sync_failed__` 失败事件，避免真实联调失败时只有 job 错误但没有事件记录。

边界说明：

- 当前 provider runner 主要写 summary event；对象级 create/update/delete/error 事件后续可在真实联调后按噪声水平逐步打开。
- 详情页只读，不提供重试/取消；重试仍通过同步列表页重新触发，取消需要异步 worker 化后再设计。

### 2026-04-26：Console 项目注册表只读管理页

已完成：

- 新增 `/directory/projects` 页面，读取 `GET /api/v1/console/directory/projects` 展示 `directory_projects` 项目、项目组、模板、父级、部门、负责人和仓库 URL。
- 新增项目成员只读查询：`GET /api/v1/console/directory/projects/members?projectCode=...`，读取 `directory_project_members` 并关联 `directory_users` 显示成员基础信息。
- 在 Console 菜单、路由权限和 `app.manifest.json` 中新增 `directory_projects` 资源。
- 项目注册表页面只承接 Account `/admin/git-projects` 中的“项目注册表”部分，不迁入 GitLab fork、文档同步、冲突解决等非 Directory Runtime 能力。

边界说明：

- 当前页面只读；项目注册表写接口需要先明确手工维护、外部同步源和业务应用回写之间的优先级后再开放。
- 该页面面向租户侧目录运营，不替代 AIMS / Codocs 等业务应用内的项目过程管理。
