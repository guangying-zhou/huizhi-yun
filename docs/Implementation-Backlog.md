# 汇智云平台 Implementation Backlog

> 口径收敛说明（2026-06-15）：本文是早期 Platform / Foundation / AIMS 接入阶段的实施 backlog，保留为历史执行记录和已完成事项索引。当前主线已经从“先建平台接入层”推进到“Platform + Console 基座上跑通软件企业完整运营闭环”。新的执行基线见 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md`，跨模块事实源与调用规则见 `docs/MODULE_CONTRACTS.md`。

## 1. 目标

本文档用于记录早期已经形成的架构、权限、Foundation 拆分、AIMS 接入、Codocs 兼容等方案，并作为历史 backlog 与实施复盘资料。

本 backlog 的目的不是替代详细方案文档，而是回答三个执行问题：

- 先做什么，后做什么
- 哪些任务属于同一个 Epic
- 哪些任务是前置依赖，哪些任务可以并行

任务跟踪约定：

- `[x]` 表示已完成并已落文档或代码
- `[ ]` 表示尚未完成或仅完成部分前置准备
- 若某项只完成了局部能力，会在任务后补充当前边界说明

---

## 2. 历史实施主线

本文原始建议采用以下主线：

1. `hzy_platform` 绿地建设
2. `foundation` 拆分为 `platform-sdk / platform-adapter-nuxt / foundation-ui / legacy-auth-bridge`
3. `AIMS` 成为首个新平台接入应用
4. `Codocs` 在平台稳定后做兼容接入

一句话原则：

`先建新平台和新接入层，再让 AIMS 试跑，最后让 Codocs 兼容。`

当前执行口径已经调整为：

1. 巩固 `platform` 控制面、`console` 企业基础运行服务、`foundation` adapter 和 Console service token 主路径
2. 以 `docs/MODULE_CONTRACTS.md` 为准收敛事实源、稳定业务键与跨模块 API
3. 优先跑通“产品/方案 → 商机/报价/合同 → Aims 交付项目 → Codocs 交付文档 → Assets 成果/环境/资产 → Finance 发票/到账/核销”的首条闭环
4. 再扩展到交付运维、知识资产、项目财务指标、绩效金额财务口径和经营分析

---

## 3. 里程碑

## Milestone A：平台骨架确定

完成标准：

- `hzy_platform` 绿地方案确认
- `platform-sdk` / `platform-adapter-nuxt` API 草案确认
- `foundation` 拆分方案确认
- `AIMS` 首批接入改造点确认

## Milestone B：Foundation 新接入层可运行

完成标准：

- `platform-sdk` 第一版可独立运行
- `platform-adapter-nuxt` 第一版可供 Nuxt app 接入
- `foundation` 旧桥接路径未被打断

## Milestone C：AIMS 首条新链路跑通

完成标准：

- `AIMS` 不再依赖旧 `/api/auth/permissions` 作为主权限来源
- `AIMS` 路由守卫、layout、基础权限消费已接入 adapter
- `AIMS` 至少一条核心项目链路已接入统一权限 helper

## Milestone D：hzy_platform 最小控制面可用

完成标准：

- 平台最小 schema 可用
- 最小 Identity Plane 可用
- 最小 Control Plane API 可用
- app manifest 注册可用

## Milestone E：Codocs 兼容接入启动

完成标准：

- `Codocs` 能消费平台 token
- `Codocs` 有最小 manifest
- `Codocs` 基础入口已可接入 foundation 新桥

---

## 4. 优先级分层

## P0：必须先做

- `hzy_platform` 第一版 schema 草案
- `hzy_platform` 第一版 API 草案
- `platform-sdk` 第一版实现骨架
- `platform-adapter-nuxt` 第一版实现骨架
- `foundation` 权限消费入口拆分
- `AIMS` 首批接入点切换

## P1：紧随其后

- `foundation` auth facade 拆分
- `foundation` 全局 auth middleware 拆分
- `AIMS` 服务端统一权限入口
- `AIMS` manifest 注册
- `hzy_platform` 最小管理后台

## P2：平台稳定后推进

- `Codocs` 兼容接入
- `foundation-ui` 清理
- 旧 CAS / account bridge 收口
- 更细粒度 scope 和对象级治理

---

## 5. Epic 列表

## Epic 1：hzy_platform 基础建设

目标：

- 新建 `hzy_platform`
- 不再继续把新平台核心能力堆进 `account`

任务：

- [x] E1-T1：定义 `hzy_platform` 第一版 schema
- [x] E1-T2：定义 `hzy_platform` 第一版 API
- [x] E1-T3：初始化平台应用骨架
- [x] E1-T4：实现最小 Identity Plane
- [x] E1-T5：实现最小 Control Plane API
  当前已完成 `tenants / users / subjects / subject-identities / resolve-subject` 的主体与身份映射链路，以及 `applications / manifests / deployments / licenses / subscriptions / bundle / revocation / heartbeat / runtime status` 的最小控制面接口；`admin/dashboard` 也已有 `tenants / applications / subscriptions / deployments / licenses / roles / templates / users / subjects` 的最小管理页。后续主要收口登录态租户上下文与接入鉴权。

前置依赖：

- 无

产出文档基础：

- `archive/platform-analysis/HZY-Platform-Greenfield-Build-Plan.md`

---

## Epic 2：platform-sdk 建设

目标：

- 实现平台协议 core

任务：

- [x] E2-T1：建立 `platform-sdk` package 骨架
- [x] E2-T2：实现 token 验签接口
- [x] E2-T3：实现 bundle / revocation 加载接口
- [x] E2-T4：实现 `AuthorizationSnapshot` 与 `checkPermission()`
- [x] E2-T5：实现 heartbeat client
- [x] E2-T6：实现 manifest 解析与校验
  当前 `platform-sdk` 已有 workspace 包骨架、JWT/JWKS 验签、runtime HTTP client、bundle/revocation/heartbeat wrapper、authorization snapshot / permission check wrapper、manifest 基础校验；下一步主要是把它接入 foundation 和 app。

前置依赖：

- Epic 1 的 API 契约基础稳定

产出文档基础：

- `Platform-SDK-API-Draft.md`

---

## Epic 3：platform-adapter-nuxt 建设

目标：

- 让 Nuxt/Nitro 应用可统一消费新平台

任务：

- [x] E3-T1：建立 `platform-adapter-nuxt` package 骨架
- [x] E3-T2：实现 request context 注入
- [x] E3-T3：实现服务端 `requireAuthenticated`
- [x] E3-T4：实现服务端 `requirePlatformPermission`
- [x] E3-T5：实现 `useAuth / useAuthorization / usePermission / useCapabilities`
- [x] E3-T6：实现 auth / permission / capability middleware
- [x] E3-T7：实现菜单过滤辅助
  当前已通过 `useAuthorization / usePlatformPermission / useCapabilities / usePermissionAccess`、`useRouteAccess` 以及 `createAuthGuard / createPermissionGuard / createCapabilityGuard` 打通前端消费层；控制台菜单也已支持 `requiredPermissions / requiredRoles / tenantScoped` 过滤。后续只需把底层数据源从 legacy bridge 切到真正的 platform token / authorization snapshot。

前置依赖：

- Epic 2

产出文档基础：

- `Platform-Adapter-Nuxt-API-Draft.md`

---

## Epic 4：Foundation 权限消费入口拆分

目标：

- 从现有 `foundation` 里先把权限消费入口和 auth facade 拆出来

任务：

- [x] E4-T1：拆 `usePermissions.ts`
- [x] E4-T2：新增 adapter 版 `useAuthorization / usePermission`
- [x] E4-T3：保留兼容版 `usePermissions()` facade
- [x] E4-T4：拆 `useAuth.ts`
- [x] E4-T5：拆 `auth.global.ts`
- [x] E4-T6：处理 `useCookieOptions.ts`
- [x] E4-T7：处理 `useHeartbeat.ts`
  当前已把认证与权限消费拆成 `useAuthState + useLegacyAuthBridge + useAuth facade` 以及 `useAuthorization + usePlatformPermission + usePermissions facade` 两层；`auth.global.ts` 也已改为桥接 facade。数据源仍是旧 `/api/auth/permissions` 和旧 `auth_*` Cookie，后续只需把 facade 数据源切到 adapter/context。

前置依赖：

- Epic 2
- Epic 3

产出文档基础：

- `Foundation-Split-and-Transition-Plan.md`
- `Foundation-Auth-Code-Split-Checklist.md`
- `Foundation-File-Migration-Task-List.md`

---

## Epic 5：Legacy Auth Bridge 封存

目标：

- 明确旧 CAS / account 逻辑只作为 bridge 存在

任务：

- [x] E5-T1：封存 `casAuth.ts`
- [x] E5-T2：封存 CAS API 入口
- [x] E5-T3：封存 `accountApi.ts`
- [x] E5-T4：建立 `legacy-auth-bridge` 目录与说明
  当前已通过代码注释和 `Legacy-Auth-Bridge.md` 明确旧 `CAS / account` 入口的 bridge 定位；运行逻辑保持不变，新平台能力不再继续进入这些文件。

前置依赖：

- Epic 4 基础 auth facade 已可用

---

## Epic 6：AIMS 首批接入

目标：

- 让 `AIMS` 成为新平台第一个真实消费者

任务：

- [x] E6-T1：重构 `app/config/permissions.ts` 为 manifest 视角
- [x] E6-T2：layout 切到 adapter context
- [x] E6-T3：路由守卫切到 adapter middleware
- [x] E6-T4：旧 `/api/auth/permissions` 退化为兼容路径
- [x] E6-T5：`sync-resources` 改为 manifest 注册
- [x] E6-T6：新增平台级 permission helper
- [x] E6-T7：新增项目级 permission helper
- [x] E6-T8：改造项目详情/更新/成员管理/仓库接口
- [x] E6-T9：统一项目成员角色语义
  当前 `AIMS` 已将项目成员角色统一收敛为 `manager / member / viewer`，并通过共享 `normalizeProjectRole()` 兼容旧 `developer / tester` 数据；前端成员管理、类型定义、接口返回和新增成员入口已全部切到新语义。

前置依赖：

- Epic 1
- Epic 2
- Epic 3
- Epic 4

产出文档基础：

- `AIMS-Integration-and-Authorization-Implementation-Plan.md`
- `AIMS-Initial-Integration-Change-Points.md`

---

## Epic 7：Codocs 兼容接入

目标：

- 在不影响现网的前提下，让 `Codocs` 逐步接上新平台协议

当前状态：

- 已完成主体接入（2026-06 核对）

任务：

- [x] E7-T1：梳理登录与会话链路
  当前 Codocs 登录与会话已切到 foundation 注入的 `event.context.consoleAuth`（Console OIDC 会话），legacy 链路仅保留 `HZY_AUTH_MODE=legacy` / `HZY_LEGACY_AUTH_BRIDGE` 桥接开关。
- [x] E7-T2：引入平台 token 识别
  服务端通过 `consoleAuth` 上下文识别用户态身份；跨模块服务端调用（如 Aims 预览访问）使用 Console 签发的 `token_use=service` JWT。
- [x] E7-T3：接入 foundation 新 bridge / adapter
  `nuxt.config.ts` 已 `extends: ['@hzy/foundation']`，bundle/runtime 能力消费 foundation `platformActivationCache` / `consoleRuntime` 等 server utils。
- [x] E7-T4：补最小 manifest
  根目录 `app.manifest.json` 已包含 appCode/entry/runtimeRequirements/resources/actions 完整定义。
- [x] E7-T5：关键入口增加统一授权包装
  `checkPermission` 已改为消费本地缓存 platform bundle；公司资产、部门资产等管理入口已包装。文档协作链路按设计走 `documentAccess` / `collaborationAuth` 自有访问控制，不在统一包装范围内。
- [x] E7-T6：验证新旧链路并存
  新链路已是主路径并随近期 tenant-runtime / 预览访问集成持续运行；legacy 桥接开关保留，专项回归未单独留档。

前置依赖：

- Epic 6 至少完成 Milestone C

产出文档基础：

- `Codocs-Compatibility-Integration-Plan.md`

---

## Epic 8：Platform 角色权限治理与 Console 权限消费

目标：

- Admin 定义全局标准角色与默认授权
- Dashboard 使用全局角色为租户用户/部门/岗位赋权
- Console 从签名 policy bundle 本地消费权限，不再回查 Account
- 后续允许 Dashboard 创建租户自定义角色

分层原则：

- Admin 管 `platform_system_roles` 与默认授权，是平台标准角色母版
- Dashboard 不直接把全局角色绑给用户，而是先物化为租户角色，再写 `tenant_subject_roles`
- Console 只消费已签名 bundle 中的租户态授权结果，不理解全局角色继承逻辑
- 租户自定义角色只写 `tenant_roles(source='custom')` 及对应权限/scope

### Epic 8A：Admin 全局角色与默认授权

任务：

- [x] E8-T1：梳理并确认现有全局角色接口/UI 能力边界
  - 涉及：`platform_app_roles`、`platform_app_role_permissions`、`platform_app_role_scopes`
  - 输出：缺口清单，明确哪些接口可复用、哪些需要补
- [x] E8-T2：完善 Admin 全局角色 CRUD
  - 支持 `roleCode / roleName / appCode / description / isRequired / status`
  - `platform_system_roles.role_type` 固定为 `system`，不在 UI 暴露；列表按应用过滤
  - 禁止删除仍被租户物化引用的系统角色，改用 disabled/suspended
- [x] E8-T3：完善全局角色默认权限配置
  - 从 manifest resources/actions 选择 app/resource/action
  - 优先写 `manifest_action_id`
  - 避免管理员手写 `resource_code/action` 导致漂移
- [x] E8-T4：完善全局角色默认 scope 配置
  - 支持按 app/resource/action 配置 `scope_type / scope_value`
  - 写 `platform_app_role_scopes`
- [x] E8-T5：实现权限覆盖检查
  - 对 `requires_grant=1` 的 manifest action 检查是否被至少一个全局角色覆盖
  - 只做 warning，不阻断 release publish
- [x] E8-T6：seed 首批 Console 全局角色
  - 建议角色：`console.admin`、`console.directory_manager`、`console.security_admin`、`console.viewer`
  - 默认覆盖 Console manifest 中的 org、directory、settings、integration、vault、service client 等资源

当前进度：E8A 已完成。已补全系统角色更新 API、默认权限替换 API、默认 scope 替换 API、权限覆盖检查 API；系统角色列表展示覆盖 warning，支持按应用过滤，详情页支持编辑基础信息、默认权限和默认 scope；`platform_system_roles.role_type` 已收敛为后端固定 `system`；Console app seed 会注册与 `console/app.manifest.json` 对齐的资源，并初始化 `console.viewer / console.directory_manager / console.security_admin / console.admin` 四个全局角色及默认授权。

验收：

- Admin 能创建/编辑全局角色，并通过 manifest action selector 配置默认授权
- Console 内置全局角色有可用默认权限
- 应用详情或 release gate 能看到权限覆盖 warning

### Epic 8B：Dashboard 使用全局角色赋权

任务：

- [x] E8-T7：实现“启用全局角色到租户”的物化接口
  - 输入：`tenantCode / systemRoleCode`
  - 写入：`tenant_roles(source='system', source_role_code=...)`
  - 同步默认权限到 `tenant_role_permissions`
  - 同步默认 scope 到 `tenant_role_scopes`
- [x] E8-T8：实现系统角色同步策略
  - 未 override 的租户系统角色可自动同步默认授权
  - 已 `is_overridden=1` 的角色只展示 diff，需人工确认合并
  - 保留 `source_manifest_action_id`，避免同步后权限漂移
- [x] E8-T9：实现 Dashboard 用户/部门/岗位角色分配 API
  - 写 `tenant_subject_roles`
  - 支持 `subjectType=user|department|committee|job`，其中 `committee` 仅作目录容器，不进入授权 UI
  - 支持 `grantedAt / expiredAt / sourceType / sourceId`
- [x] E8-T10：实现 Dashboard 授权 UI
  - 在用户/主体详情或独立授权页中选择已启用租户角色
  - 展示角色来源：system/custom/template
  - 支持撤销授权、查看过期授权
- [x] E8-T11：权限变更后触发/提示生成新 policy bundle
  - 可先提供“生成 bundle”按钮
  - 后续再做自动生成与 heartbeat action 通知

验收：

- 租户管理员能把 `console.admin` 物化到租户
- 租户管理员能给某个 user subject 授予该角色
- 生成 bundle 后能看到 `roles / rolePermissions / subjectRoles` 包含对应数据

当前进度：E8B 已完成。已新增 tenant-admin 全局角色启用/同步/diff API、租户可分配角色查询 API、主体角色授权/撤销 API、租户侧生成 policy bundle API；Dashboard 新增 `/dashboard/authorizations` 授权分配页，可启用 `console.*` 全局角色、查看 overridden diff、确认同步、给 user 授权并生成新 bundle；department/job/committee 仅作为目录与选择上下文。

### Epic 8C：Console 本地权限获取与消费

任务：

- [x] E8-T12：实现 Console 本地 bundle 授权解析器
  - 新增 `console/server/utils/policyAuthorization.ts`
  - 读取 `.data/platform-runtime` 已验签缓存 bundle
  - 通过 `auth_user` 匹配 `subjects(subjectType='user')`
  - 汇总 direct roles、template roles、template overrides
  - 输出兼容结构：`{ uid, roles, resources }`
- [x] E8-T13：替换 `console/server/api/auth/permissions.get.ts`
  - 不再请求 Account `/api/v1/users/:uid/permissions`
  - 改为调用本地 bundle 授权解析器
  - 保留 dev fallback，但生产缺 bundle 时返回空权限或明确 403
- [x] E8-T14：替换 `console/server/utils/checkPermission.ts`
  - 与 `/api/auth/permissions` 共用同一解析器
  - 保持 `view/edit/admin` 向下包含关系
- [x] E8-T15：处理 bundle 缺失/过期/未激活场景
  - activation 未完成时只放行 `/activation` 与登录
  - 权限 API 返回明确错误原因，避免静默全量放权
- [ ] E8-T16：补 Console 权限消费验证
  - 给测试用户授权 `console.org_profile:view`
  - 验证菜单过滤、路由守卫、服务端 `requirePermission`
  - 验证未授权用户无法进入受控页面

验收：

- Console `/api/auth/permissions` 不再依赖 Account
- 前端 `usePermissions()` 不需要大改即可消费 Platform bundle 权限
- 权限变更后重新生成/拉取 bundle，Console 菜单和路由守卫随之变化

当前进度：E8-T12 至 E8-T15 已完成。Console 新增本地 policy bundle 授权解析器，`/api/auth/permissions` 与服务端 `checkPermission/requirePermission` 已切换为读取本地已验签 bundle，不再依赖 Account 权限 API；启动流程会在有缓存时主动刷新 bundle，并根据 heartbeat `download_bundle` action 拉取新版本。E8-T16 的验收脚本与运行手册已就绪（`docs/Console-Policy-Authorization-Acceptance-Runbook.md`，配套 `accept:platform-policy-roles` / `accept:console-policy-consumption`），剩余动作是在真实授权数据环境执行一次端到端验收并按手册第 6 节留档。

### Epic 8D：Dashboard 租户自定义角色

任务：

- [x] E8-T17：开放 Dashboard 自定义租户角色 CRUD
  已实现 `tenant-admin/roles` POST/PATCH（写 `tenant_roles(source='custom')`，支持 roleType/status/isAssignable），Dashboard `RolesManager` 提供「新建自定义角色」入口。边界：创建时 `app_code` 固定为 NULL，应用归属通过 app-role 映射表达。
- [x] E8-T18：开放自定义角色权限与 scope 编辑
  v2.15 角色模型重构后形态调整：主路径为 `roles/{id}/app-roles` PUT（`tenant_role_app_role_maps` 映射应用权限角色，不再展开进 `tenant_role_permissions`）；高级权限仍可经 `roles/{id}/permissions|scopes` PUT 写入，且 manifest action 为必选来源。
- [ ] E8-T19：支持“复制全局角色为自定义角色”
  尚未实现。v2.15 引入 `tenant_role_app_role_maps` 后，自定义角色可直接组合应用权限角色，复制场景明显收窄；是否仍需该功能待产品确认，暂缓。
- [x] E8-T20：支持系统角色租户级 override
  `roles/{id}` PATCH 编辑系统来源角色时置 `is_overridden=1`；`system-roles/{code}/diff` 与 `/sync` 提供同步 diff 与确认合并。

验收：

- 租户管理员能创建 custom role 并授予用户
- custom role 能进入 policy bundle 并被 Console 本地鉴权消费
- 系统角色和自定义角色在 UI 与 bundle 中来源清晰

当前进度：E8-T17、E8-T18、E8-T20 已完成（按 v2.15 企业角色 / 应用权限角色拆分后的模型落地，见 `HZY-Platform-SQL-Migration-v2.15-enterprise-role-split.sql`）。E8-T19 暂缓，待确认必要性。

### Epic 8E：契约、迁移与测试

任务：

- [ ] E8-T21：更新权限治理相关文档
  部分完成：权限治理设计已收敛到 `docs/Platform-Role-Permission-Design.md`（覆盖 v2.15 企业角色模型），`Huizhi-yun-Platform-Target-Architecture.md` 已部分提及。剩余范围：`Platform-Console-MVP-Integration-Plan.md` 与 `Control-Plane-API-Contract.md` 尚未同步 v2.15 后的角色/bundle 契约。
- [x] E8-T22：补充必要 SQL migration/seed
  已完成：`HZY-Platform-SQL-Migration-v2.15-enterprise-role-split.sql`（含 resume 脚本）、`HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`（企业标准角色与 console 旧角色清理）、`HZY-Platform-SQL-Migration-v2.9-role-policy-hashes.sql`。
- [x] E8-T23：补 Platform API 测试/验收脚本
  已完成：`scripts/accept-platform-policy-roles.mjs`（`pnpm run accept:platform-policy-roles`），覆盖全局角色存在性、物化到租户、可分配角色、subject 授权、bundle 生成与 payload 断言。用法见 `docs/Console-Policy-Authorization-Acceptance-Runbook.md`。
- [x] E8-T24：补 Console 权限消费测试/验收脚本
  已完成：`scripts/accept-console-policy-consumption.mjs`（`pnpm run accept:console-policy-consumption`），覆盖未登录 401、bundle resolver 权限快照、`requirePermission` 保护接口与未授权用户反向验证；菜单过滤/路由守卫消费同一权限快照，UI 行为按 runbook 第 5 节手工核对。

依赖关系：

- E8A 依赖 app manifest resources/actions 已可用
- E8B 依赖 subject 最小投影已经同步到 `tenant_subjects`
- E8C 依赖 policy bundle 能生成并被 Console 拉取/cache
- E8D 依赖 E8B 的角色分配链路

推荐实施顺序：

1. E8-T1 ~ E8-T6：先让 Admin 能定义标准角色
2. E8-T7 ~ E8-T11：再让 Dashboard 能给用户赋予标准角色
3. E8-T12 ~ E8-T16：切 Console 到本地 bundle 权限消费
4. E8-T17 ~ E8-T20：最后开放 Dashboard 自定义角色
5. E8-T21 ~ E8-T24：文档、seed、测试贯穿每个阶段同步更新

---

## 6. 推荐执行顺序

建议按下面顺序推进：

1. Epic 1：`hzy_platform` 基础建设
2. Epic 2：`platform-sdk`
3. Epic 3：`platform-adapter-nuxt`
4. Epic 4：Foundation 权限消费入口拆分
5. Epic 6：AIMS 首批接入
6. Epic 5：Legacy bridge 封存
7. Epic 8：Platform 角色权限治理与 Console 权限消费
8. Epic 7：Codocs 兼容接入

说明：

- Epic 5 理论上依赖 Epic 4，但不需要等 `AIMS` 全部完成后再做文档和目录层封存
- Epic 8 是 Console 权限切换的前置主线，应优先于 Codocs 兼容接入
- Epic 7 必须后置，避免现网应用成为底层平台试验田

---

## 7. 并行建议

可并行推进的任务：

### 可并行组 A

- E1-T1：`hzy_platform` schema
- E1-T2：`hzy_platform` API
- E2-T1：`platform-sdk` package 骨架

### 可并行组 B

- E2-T2 ~ E2-T6：SDK 核心能力
- E3-T1：adapter 骨架

### 可并行组 C

- E4-T1：拆 `usePermissions.ts`
- E6-T1：AIMS 权限定义重构

### 可并行组 D

- E4-T4：拆 `useAuth.ts`
- E5-T1 ~ E5-T4：legacy bridge 封存准备

---

## 8. 近期建议排期

当前围绕 Platform ↔ Console 权限打通，下一组任务建议收敛为：

### Sprint E8-1

- E8-T1：梳理并确认现有全局角色接口/UI 能力边界
- E8-T2：完善 Admin 全局角色 CRUD
- E8-T3：完善全局角色默认权限配置
- E8-T6：seed 首批 Console 全局角色

### Sprint E8-2

- E8-T7：实现“启用全局角色到租户”的物化接口
- E8-T9：实现 Dashboard 用户/部门/岗位角色分配 API
- E8-T10：实现 Dashboard 授权 UI
- E8-T11：权限变更后触发/提示生成新 policy bundle

### Sprint E8-3

- E8-T12：实现 Console 本地 bundle 授权解析器
- E8-T13：替换 `console/server/api/auth/permissions.get.ts`
- E8-T14：替换 `console/server/utils/checkPermission.ts`
- E8-T16：补 Console 权限消费验证

历史两周排期参考：

如果只排未来两周，我建议收敛为：

### Sprint 1

- E1-T1：`hzy_platform` schema 草案
- E1-T2：`hzy_platform` API 草案
- E2-T1：`platform-sdk` package 骨架
- E3-T1：`platform-adapter-nuxt` package 骨架
- E4-T1：拆 `usePermissions.ts`

### Sprint 2

- E2-T2：token 验签
- E2-T3：bundle / revocation
- E2-T4：`checkPermission()`
- E3-T2：request context
- E3-T3：`requireAuthenticated`
- E3-T4：`requirePlatformPermission`
- E6-T1：`AIMS` 权限定义重构
- E6-T2：`AIMS` layout 切 adapter context

---

## 9. 风险项

### 风险 1：`hzy_platform` 和 `account` 双轨继续同时长新能力

控制：

- 所有新平台能力只进 `hzy_platform`
- `account` 只做现网兼容

### 风险 2：Foundation 拆分先动 UI，导致范围失控

控制：

- 先拆权限消费入口和 auth facade
- UI 清理后置

### 风险 3：AIMS 继续依赖旧 `/api/auth/permissions`

控制：

- 该接口只保留为兼容 fallback
- 新链路必须通过 adapter context

### 风险 4：Codocs 过早介入

控制：

- 不在 Milestone C 前启动 Codocs 实施

---

## 10. 验收方式

backlog 本身的验收标准不是“文档写完”，而是：

- 每个 Epic 都能继续拆成开发任务
- 能明确区分当前 Sprint 和后续 Sprint
- 不再需要围绕先后顺序反复争论

---

## 11. 结论

本节为历史结论，适用于早期 Platform 接入层建设阶段，不再作为当前排期依据。

历史推荐顺序如下：

- 先建 `hzy_platform`
- 再落 `platform-sdk`
- 再落 `platform-adapter-nuxt`
- 再拆 Foundation 权限消费入口
- 再让 `AIMS` 跑通首条新链路
- 再完成 Platform 全局角色、Dashboard 授权与 Console 本地 bundle 权限消费
- 最后启动 `Codocs` 兼容接入

这条主线的大部分成果已经沉淀为当前 Platform / Console / Foundation 基座。后续新增实施项应优先进入 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 所描述的业务闭环路线，而不是继续按本文追加 P0/P1。
