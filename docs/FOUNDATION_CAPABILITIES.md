# Foundation 基础能力清单

> `@hzy/foundation` 是汇智云平台的 Nuxt Layer 共享层，提供统一认证、账号/部门/权限/审批数据访问、通用 UI 组件、服务端代理等能力。所有业务模块（account/codocs/aims/altoc/assets/workflow/insights）通过 `extends: ['@hzy/foundation']` 接入即可自动享用。
>
> **使用前请先读本文档**：优先复用 Foundation 的能力，避免在各模块中重复实现。
>
> 最后更新：2026-06-21

---

## 接入方式

在业务模块 `nuxt.config.ts`：

```ts
export default defineNuxtConfig({
  extends: ['@hzy/foundation']
})
```

`runtimeConfig.hzy` 需提供以下键（已在各模块配置）：

| 键 | 用途 |
|----|------|
| `deploymentProfile` | 当前部署模式，例如 `dev`、`self-hosted`、`managed-cloud-agent`、`managed-cloud-direct-db`、`managed-cloud-d1` |
| `apiBaseUrl` | Account 服务地址（legacy） |
| `apiKey` / `apiSecret` | Account API 认证凭据（legacy） |
| `consoleRuntime.consoleApiUrl` | Console Runtime API 地址；默认开发环境 `http://localhost:3000`，统一网关可用 `HZY_DEPLOYMENT_PUBLIC_URL` |
| `directory.provider` | 目录来源；新接入模块固定为 `console` |
| `directory.consoleApiUrl` | Console Directory API 地址；优先来自 Console runtime config |
| `directory.consoleClientId` / `directory.consoleClientSecret` | Console Directory API 服务凭据；当前可选，后续 internal API 强鉴权后启用 |
| `hzy.integration.consoleApiUrl` | Console Integration Config / Vault API 地址；未配置时回退 Console runtime config |
| `hzy.serviceClient.clientId` / `hzy.serviceClient.clientSecret` | 仅作为特殊离线部署兼容入口；业务应用本地 env 不再新增跨模块 client secret，缺失时不再回退 app 级 license bootstrap |
| `consoleOidc.issuer` | Console OIDC issuer，默认由 Console runtime config / `public.consoleUrl` / `directory.consoleApiUrl` 推导 |
| `consoleOidc.clientId` | OIDC client id，默认使用 `public.appCode` |
| `consoleOidc.redirectUri` | OIDC 回调地址；未显式配置时由当前应用 `homeUrl` 派生 |
| `consoleOidc.transientTtlSeconds` / `HZY_CONSOLE_OIDC_TRANSIENT_TTL_SECONDS` | OIDC state / nonce / PKCE 临时 Cookie 有效期，默认 `1800` 秒；登录入口与回调响应强制 `no-store` |
| `workflowApiUrl` | Workflow 服务地址 |
| `hzy.tenantRuntime.endpoint` / `HZY_TENANT_RUNTIME_URL` | Tenant Runtime endpoint；迁移期兼容 `hzy.dataRuntime.endpoint` / `HZY_DATA_RUNTIME_URL` |
| `hzy.tenantRuntime.token` / `HZY_TENANT_RUNTIME_TOKEN` | Tenant Runtime static token 兼容入口；优先使用 Console service token，迁移期兼容 `HZY_DATA_RUNTIME_TOKEN` |
| `hzy.tenantRuntime.audience` / `HZY_TENANT_RUNTIME_AUDIENCE` | Data Runtime service token audience，默认 `data-runtime`，迁移期兼容旧变量名 |
| `dataAccessMode` / `HZY_DATA_ACCESS_MODE` | 数据访问模式：`tenant-runtime`、`direct-db`、`fallback`；未设置时按部署 profile 判断 |
| `public.rum.enabled` | 前端 RUM 采集开关，默认 `true`；可用 `NUXT_PUBLIC_RUM_ENABLED=false` 关闭 |
| `public.rum.endpoint` | RUM 上报地址，默认 `/api/rum`，统一租户域下由 tenant gateway 转发到 Observability Worker |
| `public.rum.sampleRate` | 普通性能事件客户端会话采样率，默认 `0.05`；错误事件强制上报，再由服务端配置二次采样 |

`runtimeConfig.public` 建议注入：`appCode`、`consoleUrl`、`authMode`、`deploymentProfile`、`deploymentPublicUrl`、`appBasePath`、`appHomeUrl`。迁移期 fallback 才需要 `accountUrl`、`casEnable`、`casBaseUrl`、`serviceUrl`。

> **Nuxt Layer 规则**：Composables / Components / Server API 都按同名覆盖，业务模块可定制同名文件。Types 因 Layer 限制需在各模块 `app/types/account.ts` 重导出 `export type { ... } from '@hzy/foundation/app/types/account'`。

---

## 1. Composables（自动 import，无需手动引入）

| Composable | 职责 | 关键 API |
|-----------|------|----------|
| `useAuth()` | 当前用户信息 + Console OIDC 登录、token/session 数据源、登出；legacy bridge 仅显式 fallback | `user`、`token`、`tenant`、`subjectCode`、`policyVersion`、`logout()` |
| `useDirectory*()` | Console Directory Runtime 读取入口 | `useDirectoryUsers()`、`useDirectoryDepartments()`、`useDirectoryProjects()`、`useDirectoryUser(uid)`、`useDirectoryGitGroups()`、`useDirectoryUserProjects(uid)`、`useDirectoryBusinessDomains()` |
| `useAccount*()` | 兼容旧 Account 命名，内部委托 `useDirectory*()` | `useAccountUsers()`、`useAccountDepartments()`、`useAccountProjects()`、`useAccountUser(uid)`、`useAccountGitGroups()`、`useAccountUserProjects(uid)`、`useBusinessDomains()` |
| `usePermissions()` | 角色/资源权限检查，基于 Console policy bundle 授权快照；普通运行默认合并全部有效企业角色，`activeRoleCode` 仅作为展示/显式模拟提示，并展开为当前应用权限 | `hasRole(role)`、`canAccess(resource, action)` |
| `useWorkflow` 模块 | Workflow API 封装（查询/审批/发起） | `fetchPendingTasks()`、`fetchTaskDetail()`、`approveTask()`、`rejectTask()`、`createInstance()`、`prepareInstance()`、`fetchInstanceByBiz()` |
| `useNotifications()` | Console 统一消息中心前端封装 | `loadSummary()`、`loadNotifications()`、`markRead()`、`markAllRead()`、`archive()` |
| `usePageWorkflow({ ... })` | **页面级审批声明**：注册当前页面可用的审批动作（立项/暂停/结项…），支持透传 `formData` 与 `callbackUrl` | 传入 `appCode` / `resourceCode` / `bizId` / `actions` |
| `useApprovalMode()` | 审批中心进入业务页面时的只读模式 | `isApprovalMode`、`enterApprovalMode()`、`exitApprovalMode()` |
| `useAppInfo()` | 当前应用名称/Logo（一次拉取、全局缓存） | `appName`、`appIcon`、`appCode` |
| `useAvatar` / `resolveAvatarSrc(path)` | 头像 OSS 路径解析 | 返回可访问的 URL |
| `useHeartbeat(appCode?)` | 在线状态心跳（active/idle），仅在 layout 调用一次 | 无需返回值 |
| `useDashboard()` | 侧边栏折叠状态、通知面板开关（`createSharedComposable`） | `isSidebarCollapsed`、`toggleSidebarCollapsed()` |
| `usePageTitle(title?)` | 读取/设置 LayoutSidebar 头部标题 | 支持 `Ref<string>` |
| `usePageActions()` | 注册页面刷新回调，供顶栏刷新按钮调用 | `setRefresh(fn)` / `clearRefresh()` |
| `useAppUrls()` | 统一域名部署 URL helper，按当前应用 `baseURL/homeUrl` 生成绝对 URL 或 basePath 内路径 | `appBasePath`、`appHomeUrl`、`resolveCurrentAppUrl(path)`、`resolveCurrentAppPath(path)` |
| `useCookieOptions()` | 跨子域 Cookie 选项（SSO 必用） | 返回 `{ domain, path, sameSite, secure }` |
| `useIssueReporter()` | WebDev Issue 报告组件逻辑：采集页面/路由/环境/控制台错误并脱敏、提交到 `/api/webdev-report/issues`、拉取「我已提报」 | `collectContext()`、`submit(payload)`、`fetchMine(query)`、`currentRoutePattern()` |
| `useFeedbackReporter()` | 读取 Console 系统参数 `feedback.reporter.enabled`（经 `/api/runtime/feedback-reporter`），决定是否展示反馈浮动按钮；模块级缓存，只请求一次，Console 不可达时回退启用 | `enabled`（ref）、`load()` |

## 1.1 Client Plugins

| 插件 | 职责 | 配置 |
|------|------|------|
| `rum.client.ts` | 自动上报页面加载、Web Vital、同源 API 耗时、JS error / unhandled rejection。上报前会去掉 URL query/hash，不采集 Cookie、Authorization、请求体或用户输入内容。 | `public.rum.enabled`、`public.rum.endpoint`、`public.rum.sampleRate` |
| `issue-console-capture.client.ts` | 维护最近控制台错误 / `window.error` / `unhandledrejection` 的环形缓冲，供 `IssueReporter` 采集（提交前脱敏） | 无 |

### 使用示例

```ts
// 获取当前用户
const { user, userRealname, logout } = useAuth()

// 加载部门树（带缓存）
const { tree, loading } = useAccountDepartments()

// 注册页面级审批动作
usePageWorkflow({
  appCode: 'aims',
  resourceCode: 'projects',
  bizId: computed(() => String(projectId.value)),
  bizTitle: computed(() => projectName.value),
  actions: computed(() => [
    { actionCode: 'submit-launch', name: '立项', available: status.value === 'draft' },
    { actionCode: 'suspend', name: '暂停', available: status.value === 'active' }
  ])
})
```

---

## 2. Components（自动注册，无需 import）

### 布局 & 导航

| 组件 | 用途 |
|------|------|
| `<LayoutSidebar>` | 页面主框架（AppRail 应用层入口 + 当前应用侧边栏 + 内容区 + 头部）。所有业务页默认继承此布局 |
| `<UserMenu>` | 顶栏用户菜单（头像/姓名/主题切换/登出）；普通运行使用合并权限，不再暴露日常企业角色切换入口 |
| `<NotificationBell>` | 顶栏通知按钮，展示 Console 消息中心未读角标，点击打开通知抽屉 |
| `<NotificationsSlideover>` | Console 统一消息中心抽屉，支持未读筛选、打开详情、标记已读和归档 |
| `<IssueReporter>` | 业务应用内嵌「反馈」浮动入口（默认右下角，可 `:floating="false"` 仅暴露 `open()`）；自动采集页面/环境/控制台错误，提交前展示「我已提报」去重，经 `/api/webdev-report/issues` 上报到 WebDev。浮动按钮仅在已登录且系统参数 `feedback.reporter.enabled` 启用时展示（见 `useFeedbackReporter()`）。已在共享 `LayoutSidebar` 全局挂载一次，所有使用该布局的 Foundation 应用自动获得，无需在 `app.vue` 重复挂载 |
| `<AppLauncher>` | 应用启动器（九宫格图标），通过 `/api/user/applications` 读取当前用户可访问应用，支持 manifest `icon` 图标名或图标 URL |
| `<AppRail>` | 左侧应用层图标入口，与 `AppLauncher` 共用 `/api/user/applications` 数据源，图标下方展示应用短名称；支持通过 `fixedItems` / `appOverrides` / `hiddenAppCodes` 适配 Console 等特殊壳层 |

`<LayoutSidebar app-navigation="rail">` 会在桌面端展示 AppRail + 当前应用菜单，让独立业务应用看起来像同一平台内的功能区；`popover` 仅保留顶栏 AppLauncher；`none` 隐藏应用层入口。

`/api/user/applications` 由 Foundation 在业务应用本地提供：优先转发到 Console 的当前用户应用列表，并以 Console 授权结果作为唯一应用可见性事实源。生产和共享测试环境下 Console 用户应用接口不可用时返回 503，不再读取业务应用本地 policy bundle 做可见性 fallback；仅显式 local-dev 应用目录可作为离线开发入口。业务应用不再直接调用 Platform runtime applications。应用列表按用户全部有效企业角色的应用权限并集过滤并按 Platform 下发的 `sortOrder` 升序展示；旧 `activeRoleCode` Cookie / Header / Query 不再参与应用可见性过滤。当前应用和 `workspace` 入口始终保留，`console` 管理入口只在合并后的企业角色权限中具备显式 Console 授权时展示。

本地开发应用目录默认包含 Codocs `3001/codocs/`、Aims `3002/aims/`、Altoc `3003/altoc/`、Assets `3004/assets/`、Finance `3006/finance/`、Workflow `3020/workflow/`、Insights `3009`。可用 `HZY_DEV_APPLICATIONS` JSON 数组覆盖；`HZY_CONSOLE_DEV_APPLICATIONS` 仅保留为 Console 旧配置兼容别名。

业务模块不要自定义同名 `/api/user/applications` 覆盖 Foundation 实现，否则 AppRail/AppLauncher 可能退回本应用 logo 或漏掉按授权可见的 Console / 业务应用入口。应用入口使用 manifest `icon`；当前应用侧边栏品牌位仍使用 `appLogo`。

### 数据选择器

| 组件 | 用途 |
|------|------|
| `<DeptTreeSelector>` | 部门树**单选**（递归节点） |
| `<UserTreeSelector>` | **员工树选择**（按部门树组织，支持委员会，支持多选/单选，复选框联动）。见下节 |
| `<GitGroupTreeSelector>` / `<GitGroupTreeNode>` | GitLab 群组树单选，带搜索与路径高亮 |

### 审批流相关

| 组件 | 用途 |
|------|------|
| `<WorkflowPanel>` | 流程操作面板，支持 `task` / `instance` / `launch` 三种输入模式；launch payload 支持 `bizContext`、`formData`、`callbackUrl` |
| `<WorkflowBusinessView>` | 业务详情容器（根据 `business_view.mode` 选 local/iframe/external-link） |
| `<WorkflowTimeline>` | 审批进度时间线（快照节点 + 动作记录 + 任务） |
| `<WorkflowBadge>` | 审批状态徽章，支持直接传 `status` 或通过 `biz_key` 查询 |

### 文档嵌入

| 组件 | 用途 |
|------|------|
| `<CodocsEditor uuid>` | 通过 iframe 嵌入 Codocs 编辑器（可读写） |
| `<CodocsPreview uuid>` | 只读预览，适合列表/卡片内嵌 |

### UserTreeSelector 用法

```vue
<!-- 仅取 uid 列表 -->
<UserTreeSelector v-model="uids" />

<!-- 同时拿到完整用户对象 -->
<UserTreeSelector v-model="uids" v-model:users="users" />

<!-- 单选 -->
<UserTreeSelector v-model="uids" selection-mode="single" />

<!-- 隐藏委员会 -->
<UserTreeSelector v-model="uids" hide-committees />

<!-- 显示根部门 + 排除自己 + 限定到某个部门子树 -->
<UserTreeSelector
  v-model="uids"
  show-root-dept
  :exclude-uids="[currentUid]"
  scope-dept-code="R1"
/>
```

**特性**：
- 部门显示顺序与数据库 `sort_order` 一致；委员会统一排在部门之后
- 可通过 `hide-committees` 隐藏委员会节点
- 委员会成员自动加载（优先 `/api/account/user-departments`，不可用时回退 `/api/account/dept-members`）
- 点击部门名称/图标仅展开/折叠；checkbox 点击才勾选，`propagate-select` + `bubble-select` 级联
- 支持搜索（姓名/uid/部门名）、已选 chip 列表、一键清空

---

## 3. Pages（Layer 提供的通用页面）

| 路径 | 功能 |
|------|------|
| `/approval/tasks` | **审批中心**列表页（我的待办 / 我发起的） |
| `/approval/tasks/:taskId` | 审批处理页（左业务详情 + 右操作面板，支持 `?mode=instance`） |

> 各模块**无需**自行实现审批列表/详情页，直接跳转到 `/approval/tasks` 即可。

---

## 4. Server API（Nitro 路由，所有模块共享）

| 路径 | 用途 |
|------|------|
| `GET /api/auth/oidc-login` | Console OIDC 登录入口，生成 PKCE/state/nonce 后跳转 Console `/oauth/authorize` |
| `GET /api/auth/oidc-callback` | Console OIDC 回调，换取 token 并优先写入按 appCode 分名的 `hzy_*` Cookie；兼容读取迁移期共享 Cookie |
| `POST /api/auth/refresh` | 使用 refresh token 轮换本地 OIDC token；refresh 失败会清理本地 OIDC Cookie |
| `GET/POST /api/auth/logout` | 清理本地 OIDC Cookie，默认跳转 Console 全局 `/oauth/logout`；显式传 `redirect` 时才使用应用级 `post_logout_redirect_uri` |
| `GET /api/auth/oidc-post-logout` | 可选的 Console OIDC 应用级登出回调，清理本地 Cookie 并回到登录页 |
| `GET /api/auth/me` | 返回当前 verified token 上下文；legacy fallback 下返回旧 Cookie 用户 |
| `GET /api/auth/cas-login` | 统一 CAS 登录入口，基于当前应用 `homeUrl` 派生回调地址与目标跳转 |
| `GET /api/auth/cas-callback` | 统一 CAS 回调入口，校验 ticket 并写入认证 Cookie |
| `GET /api/workflow-proxy/**` / mutating methods | Workflow API 代理；先校验当前业务应用用户，再以本应用 runtime service client 请求 `audience=workflow`、`scope=workflow:proxy` 的短期 token 转发，并自动注入 `request_app_code` |
| `GET /api/account/user-departments` | 全量 user-dept 关联（含委员会），供 UserTreeSelector 使用 |
| `GET /api/account/dept-members?deptCode=xxx` | 指定部门/委员会的成员列表（回退路径） |
| `GET /api/git-integration/commits` | GitLab commit 列表；支持 `projectCode/repoUrl/repoPath/ref/since/until/page/perPage`，凭证从 Console integration/vault 解析 |
| `GET /api/git-integration/commit-diff` | GitLab commit diff；支持 `projectCode/repoUrl/repoPath/sha` |
| `GET /api/git-integration/markdown-tree` | 仓库根目录与 `docs/` 下的 Markdown 文件树 |
| `GET /api/git-integration/file` | 读取 GitLab 仓库文件内容 |
| `POST /api/git-integration/commit` | 通过 GitLab commits API 创建提交，供 Codocs/Aims 等模块复用 |
| `POST /api/webdev-report/issues` | 业务应用 Issue 上报入口；派生当前用户身份后经 Console service token 转发到 WebDev `intake`（业务应用前端不直连 WebDev）。转发成功后按系统参数 `feedback.notify.wecomUsers` 经 `sendNotification()` 向配置的企业微信号推送提醒（失败不影响提交） |
| `GET /api/webdev-report/issues` | 报告组件「我已提报」列表；按当前用户 + 层级（`scope`/`pageKey`）过滤，供提交前自行判断是否重复 |
| `GET /api/runtime/feedback-reporter` | 解析 Console 系统参数 `feedback.reporter.enabled`（经 service token + runtime settings 缓存），返回 `{ enabled }` 决定是否展示反馈浮动按钮；Console 不可达时回退启用 |
| `GET /api/platform-activation/status` | 查看当前应用 Platform runtime 激活、license、bundle、heartbeat 状态 |
| `POST /api/platform-activation/retry` | 手动重试 license 校验、policy bundle 拉取与 heartbeat 上报；正常启动会刷新本地 bundle，heartbeat 返回 `download_bundle` action 时会自动拉取 |

> 业务模块如需用户、部门、项目等目录 API，请在自己的 `server/api/account/*.ts` 兼容路由或 `server/api/directory/*.ts` 薄代理中调用 Foundation `directoryApi.ts`；不要直连 Account 或 Console 数据库。

---

## 5. Server Utils（服务端工具，`import` 使用）

| 工具 | 用途 |
|------|------|
| `getConsoleOidcConfig()` / `resolveConsoleAuthContext()` / `requireConsoleAuthContext()` | Console OIDC 配置、JWKS/JWT 验证与 request context 解析；会调用 Console `/oauth/userinfo` 校验 `sid` 是否仍有效；`server/middleware/console-auth.ts` 会写入 `event.context.consoleAuth` |
| `requestServiceAccessToken({ audience, scope, event? })` | 获取 Console 短期 `token_use=service` JWT；优先使用显式 service client，缺少本地 client secret 时可凭 Tenant Gateway 注入的 runtime app identity 换取 token；自动缓存到过期前刷新 |
| `isEnterpriseRoleRecord(role)` | Policy bundle 角色记录的企业角色有效性适配器；调用 `@hzy/authz-core` 的 `isEnterpriseRole`，统一按 `app_code/appCode` 为空、`status=active`、`is_assignable/isAssignable` 可分配判断，避免租户自定义企业角色被 `systemRoleCodes/sourceRoleCode` 过滤 |
| `buildAllowedAppCodesFromPolicyBundle({ payload, uid, requestedRoleCode, authorizationMode?, allowRoleSimulation? })` | 从 Platform policy bundle payload 计算当前用户可访问应用集合；普通运行默认合并全部有效企业角色，并按 `subjectMemberships` 继承 active 部门/职位主体角色；只有服务端显式允许的 `role_simulation` 才按 `requestedRoleCode` 收窄，未授权模拟请求会降级为 `merged`，无效模拟角色不得回退到其他角色；Console 与 Foundation 的应用列表过滤共用该 helper |
| `evaluateFoundationScopedAuthorization({ grants, required, object })` / `foundationScopeSetMatches()` | Foundation 数据范围 evaluator。按同一授权单元内同维度 OR、跨维度 AND，多授权单元 OR 判定；角色默认范围、授权具体范围和附加范围必须在同一 grant 内共同满足，权限与范围不得跨 grant 拼接。已支持 `tenant:global`、`subject:self`、`department:self/tree`、`project:member/owner`、`customer:owner/team`、`object:assigned`、`relation:*`、`environment:*` 等基础谓词，业务 API 接入时仍需按列表/详情/写入/导出分别调用 |
| `buildScopedAuthorizationGrantsFromPolicyBundle()` / `evaluatePolicyBundleScopedAuthorization()` | 将 Platform policy bundle v1 的 `subjectRoles.assignmentId`、`subjectMemberships`、`subjectRoleScopes`、`rolePermissions`、`roleScopes` 标准化为 Foundation grant 并调用 evaluator。支持普通 merged、显式 role simulation、active 部门/职位 membership 继承、assignment scope 的 `inherit/intersect/replace`，并保留同一 assignment 上的权限与范围绑定；业务 API 传入对象上下文后可直接用于详情/写入/导出范围判定 |
| `loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, options?)` / `loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, options?)` / `normalizeAuthorizationResources()` | 业务应用服务端授权入口：普通权限快照和对象级 scoped authorization 均通过 Foundation 调 Console runtime，返回 active role、authorization mode、bundleVersion/bundleHash、resources 或 scoped grants/decision。Console 不可用时生产 fail closed 为 503，不再回退业务应用本地 policy bundle；仅显式 local-dev bypass 可返回本地开发资源清单。旧 `loadAuthorizationFromCachedPlatformBundle()` 只作为兼容别名保留，有请求上下文时委托 Console runtime，无请求上下文时不再读取本地 bundle；旧 `listUserCodesByRoleFromCachedPlatformBundle()` 已禁用本地读取 |
| `finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes })` | 业务应用数据范围 BFF 收口规则。业务模块在 grant 循环中遇到 `all` 提前返回，剩余 dept/self/none 尾部统一交本函数：解析到部门返回 `dept` 并去重，否则只要用户已通过权限校验（`sawPermission`）或解析到 self 就降级为 `self`，**绝不对已认证且有权限的用户返回 `none`**。防止数据范围解析未命中被 data-runtime 翻译成 403（单条）或静默空列表，对齐 altoc 修复样板；finance（expenses/performance）、people（employees）已接入，altoc/aims/assets 后续收敛 |
| `getIntegrationConfig(integrationCode)` / `resolveIntegrationSecret({ integrationCode, purpose })` / `get*RuntimeConfig()` | Console Integration Config adapter，含 GitLab、OSS、AI Provider、企业微信等运行时配置 helper。业务模块只按 `integrationCode` 获取非 secret 配置和授权 secret；不得直接读取 `integration_credentials`、Console 内部 credential id 或调用 `/vault/resolve` |
| `maybeCallTenantRuntime()` / `maybeCallCurrentAppTenantRuntime()` / `isTenantRuntimeEnabled()` | Tenant Runtime HTTP client；优先读取 `HZY_TENANT_RUNTIME_*` / `x-hzy-tenant-runtime-*`，兼容旧 `HZY_DATA_RUNTIME_*` / `x-hzy-data-runtime-*`，用于新模块 runtime proxy；只有 `x-hzy-gateway-token` 匹配 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）时才接受 Tenant Gateway 注入的 runtime URL/token/tenant/deployment 头；调用时只从已验证的 Console 用户会话（含经 Console `auth/me` 确认的 legacy session bridge）提取用户/部门 actor，并用 runtime bearer token 做 HMAC 签名，runtime 侧不得信任未签名的普通 actor header；`scope` 可为空格分隔多个值，点号传输 scope（如 `altoc.write`）会按 audience 归一化，冒号业务 capability 保持原样 |
| `maybeProxyCurrentApiToTenantRuntime()` | 通用 Nuxt API 到 tenant-runtime proxy；按 `/api/v1/** -> /v1/{appCode}/**` 转发，支持 app 级转发白名单、scope resolver 和已验证用户/部门上下文透传（`current_user_dept_code(s)`）；scope resolver 可返回传输 scope + 资源/动作 capability 的组合（如 `altoc.write altoc:lead:edit`），用于同时满足 runtime 入口认证和 adapter 内部领域授权；会清理浏览器传入的 `current_user` / `operator_uid` / `current_user_scopes` 等认证上下文字段后重建；是否允许 direct DB fallback 由模块中间件显式决定，Assets/Altoc/Aims 阶段 2 主路径不回退 |
| `listGitCommits()` / `getGitCommitDiff()` / `listGitMarkdownTree()` / `getGitRepositoryFile()` / `createGitCommit()` | Git integration runtime service。GitLab baseUrl/token 从 Console `gitlab.default` integration 和 vault 解析；仅迁移期回退 `GITLAB_BASE_URL` + `GITLAB_BOT_TOKEN/GITLAB_API_TOKEN` |
| `aiProviderFetch()` / `getAiProviderIntegrationConfig()` / `getWecomIntegrationAccessToken()` / `getOssIntegrationConfig()` | AI Provider、企业微信、OSS runtime integration helpers。服务端按 `integrationCode` 消费 Console integration + vault，不在业务模块直接读取 secret 或 Console vault resolve |
| `getAccountApiConfig()` / `requireAccountApiConfig()` / `getAccountApiAuthHeaders()` | 读取/校验 Account API 配置，生成 Authorization Header |
| `getDirectoryConfig()` / `requireDirectoryConfig()` / `getDirectoryAuthHeaders()` / `fetchDirectoryApi()` / `isConsoleDirectoryProvider()` | 读取/校验 Console Directory 配置，调用 Console Directory API；不提供 Account fallback；`/api/directory/users/**` 会在代理前本地解析 `system` 等内置服务身份 |
| `resolveDeploymentProfile()` / `isManagedCloudProfile()` / `isSelfHostedProfile()` | 解析当前部署 profile；Cloudflare runtime 默认归入托管云 profile，生产未显式配置时默认 `self-hosted`，本地默认 `dev` |
| `resolveHzyDevApplications()` / `DEFAULT_HZY_DEV_APPLICATIONS` | 本地开发应用目录；Console 和业务应用共用，支持 `HZY_DEV_APPLICATIONS` JSON 数组覆盖 |
| `loadHzyLocalDevRuntimeMode()` | 本地开发模式 helper；供应用入口、runtime fallback 等路径判断是否允许使用开发目录或跳过生产 runtime 副作用 |
| `loadPlatformActivationConfig()` / `readAndVerifyPlatformLicense()` / `refreshPlatformPolicyBundle()` / `postPlatformRuntimeHeartbeat()` | Platform runtime 激活工具：读取 `HZY_PLATFORM_*` 配置、验签 license、启动时拉取/刷新签名 policy bundle、上报 deployment heartbeat，并消费 heartbeat `download_bundle` action 自动刷新 |
| `readPlatformActivationStatus()` / `patchPlatformActivationStatus()` / `readCachedPlatformBundle()` | Platform runtime 本地状态与 policy bundle 缓存工具，默认缓存目录 `.data/platform-runtime`；`readCachedPlatformBundle()` 仅用于 Platform runtime 激活、heartbeat 刷新和诊断，不作为业务应用授权事实源 |
| `resolveCurrentAppHomeUrl()` / `resolveCurrentAppUrl()` / `derive*CallbackUrl()` / `buildAppHomeUrl()` | 统一域名部署 URL helper，按 `HZY_DEPLOYMENT_PUBLIC_URL + HZY_APP_BASE_PATH`、`NUXT_APP_BASE_URL`、显式 homeUrl 或 request origin 派生应用 URL、OIDC/CAS/企微回调和应用入口 |
| `resolveServiceAppBaseUrl(event, appCode)` | 服务端跨应用调用 URL helper；不读取 Console 租户应用配置，Cloudflare 托管云按 `https://<appCode>.huizhi.yun/<appCode>/` 推导共享应用 origin，本地开发按端口表回退，可用运营级 `HZY_<APP>_SERVICE_BASE_URL` / `HZY_<APP>_ORIGIN` 覆盖 |
| `proxyCurrentAppPath()` / `buildCurrentAppProxyUrl()` | 统一域名 API 收敛兼容代理工具，保留当前应用 basePath 转发到本地既有 API |
| `getUserByUid()` / `reportLoginAudit()` / `getRequestIp()` | 统一认证流程中的用户补全、登录审计与来源 IP 解析 |
| `handleCasLogin()` / `handleCasCallback()` | 迁移期 legacy CAS 登录重定向与回调处理 |
| `getAuthCookieOptions()` | 统一认证 Cookie 的 domain/path/sameSite 配置 |
| `reportWebDevIssue(event, payload)` / `listMyWebDevIssues(event, query)` | 业务应用 → WebDev Issue 上报/查询代理；内部用 `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write\|read' })` + `resolveServiceAppBaseUrl(event,'webdev')` 调 WebDev intake/mine |
| `publishNotification({ recipients, title, summary, actionUrl, event? })` | 发布站内消息到 Console 统一消息中心；使用 Console service token `audience=notifications`、`scope=notifications:publish` |
| `sendNotification({ touser, title, description, url, event? })` | 统一通知入口；优先调用客户侧 `notification-runtime` 发送企业微信 textcard，未配置 runtime 时才走 legacy 直连企业微信；自动支持 `NOTIFY_REDIRECT_TO` 测试重定向 |
| `syncApprovalActions(items)` | 启动时同步业务模块的审批动作清单到 Workflow 服务 |

### 使用示例

```ts
// server/api/custom-legacy.get.ts
import { getAccountApiAuthHeaders, requireAccountApiConfig } from '#imports'

export default defineEventHandler(async () => {
  const { apiBaseUrl } = requireAccountApiConfig()
  return $fetch(`${apiBaseUrl}/api/v1/projects`, { headers: getAccountApiAuthHeaders() })
})
```

```ts
// server/api/directory/users.get.ts
import { fetchDirectoryApi } from '#imports'

// 新目录能力：只读 Console Directory API
export default defineEventHandler(async event => fetchDirectoryApi('/api/v1/directory/users', {
  params: getQuery(event)
}))
```

---

## 6. Stores

| Store | 说明 |
|-------|------|
| `useDirectoryStore()` | Console Directory 数据的 Pinia 缓存（用户/部门/项目/Git 群组），避免重复请求 |
| `useAccountStore()` | 兼容旧 Account store 命名，导出同一个 Directory store |

---

## 7. Types（需重导出）

Nuxt Layer 的类型不能直接 auto-import，各模块需在 `app/types/` 下创建重导出：

```ts
// app/types/account.ts
export type {
  AccountUser, Department, DepartmentResponse, Project, UserProjects,
  BusinessDomain, ApiResponse
} from '@hzy/foundation/app/types/account'

// app/types/workflow.ts
export type {
  WorkflowStatus, WorkflowTaskDetail, WorkflowInstanceDetail,
  WorkflowAction, WorkflowSnapshotNode, WorkflowLaunchPayload,
  WorkflowBusinessView
} from '@hzy/foundation/app/types/workflow'
```

---

## 8. Plugins（自动加载）

| Plugin | 作用 |
|--------|------|
| `color-mode-sync.client.ts` | 跨应用同步深/浅色主题（通过 localStorage + storage 事件） |
| `error-handler.client.ts` | 全局 error 捕获与友好提示 |

---

## 开发约束

1. **不要绕过 Foundation 直连 Account/Workflow 数据库**——必须走 API；
2. **不要重复实现**已存在的组件/composable——有需求先提 issue 扩展 Foundation；
3. **组件遵循 Nuxt UI V4 规范**：颜色用 `primary`/`success`/`warning`/`error`/`info`/`neutral`；
4. 本地文件可覆盖 Layer 同名文件，但请先评估是否应反哺回 Foundation；
5. 修改 Foundation 后必须：`pnpm typecheck` + `pnpm lint` 双绿，再回各业务模块回归。

---

## 变更记录

| 时间 | 变更 |
|------|------|
| 2026-04-16 | 新增本文档；`UserTreeSelector` + `/api/account/user-departments` + `/api/account/dept-members` |
| 2026-04-15 | `GitGroupTreeSelector` / `GitGroupTreeNode` |
| 2026-04-14 | `reportOperationAudit` 审计日志回传（见 Account）|
| 2026-04 | `usePageWorkflow` 多动作模式 |
