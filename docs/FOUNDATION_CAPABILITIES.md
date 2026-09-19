# Foundation 基础能力清单

项目文档服务委托：`verifyServiceCommandRuntimeHeaders({ event, ... })` 完成 HMAC、时效和 payload hash 校验后保存 request-local actor 证明；`verifiedServiceCommandActor(event, targetApp)` 将其重新绑定当前 service principal 与精确 capability。`maybeCallTenantRuntime` 自动用此 actor 重签目标应用自己的 Runtime 请求；不能用任意 event.context/header 伪造证明。验证失败清除旧证明。调用者仍须先验证入站服务身份、固定命令与用户业务权限。

`serviceAppFetch` 支持 FormData / Blob / ArrayBuffer / typed array 原始请求体；仅序列化普通 JSON，multipart boundary 由 Fetch 生成。目标 app/deployment/prefix 仍原子重写。

对象存储：`server/utils/objectStorage.ts` 的 `put(..., { forbidOverwrite: true })` 按 provider 选择防覆盖条件：原生 OSS 和 OSS S3 兼容接口使用 `x-oss-forbid-overwrite`，S3/R2 使用 `If-None-Match: *`。业务调用方不应同时传入两类条件。OSS 的该条件仅在 bucket 未启用版本控制时生效。

策略包持久层：`server/utils/consolePolicyStore.ts` 提供 Console 专用 Runtime GET/PUT CAS adapter，复用 `callConsoleTenantRuntime`、精确 `console:policy-bundle:read|write` 与 service-client-policy，生成写入幂等键。不允许业务 Worker 直接读写该存储。

> `@hzy/foundation` 是汇智云平台的 Nuxt Layer 共享层，提供统一认证、账号/部门/权限/审批数据访问、通用 UI 组件、服务端代理等能力。当前 Console 与业务模块（codocs/aims/altoc/assets/workflow/finance/people/align/webdev）通过 `extends: ['@hzy/foundation']` 接入；Platform、Insights 不继承该 Layer，Account 仅保留为 legacy 迁移源与兼容 facade。
>
> **使用前请先读本文档**：优先复用 Foundation 的能力，避免在各模块中重复实现。
>
> 最后更新：2026-07-24

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
| `consoleOidc.transientTtlSeconds` / `HZY_CONSOLE_OIDC_TRANSIENT_TTL_SECONDS` | OIDC state / nonce / PKCE 临时 Cookie 有效期，默认 `1800` 秒；每次授权按 state 使用独立 Cookie，避免并发登录互相覆盖；登录入口与回调响应强制 `no-store` |
| `workflowApiUrl` | Workflow 服务地址 |
| `hzy.tenantRuntime.endpoint` / `HZY_TENANT_RUNTIME_URL` | Tenant Runtime endpoint；迁移期兼容 `hzy.dataRuntime.endpoint` / `HZY_DATA_RUNTIME_URL` |
| `hzy.tenantRuntime.token` / `HZY_TENANT_RUNTIME_TOKEN` | Tenant Runtime static token 兼容入口；优先使用 Console service token，迁移期兼容 `HZY_DATA_RUNTIME_TOKEN` |
| `hzy.tenantRuntime.audience` / `HZY_TENANT_RUNTIME_AUDIENCE` | Data Runtime service token audience，默认 `data-runtime`，迁移期兼容旧变量名 |
| `dataAccessMode` / `HZY_DATA_ACCESS_MODE` | 数据访问模式：`tenant-runtime`、`direct-db`、`fallback`；未设置时按部署 profile 判断 |

`tenantRuntimeClient` 默认把 service token 绑定到已验证的入站 Tenant Gateway 来源。跨应用目标 BFF 在完成来源 service token 与签名命令校验后，如需以目标应用自己的 runtime client 访问 data-runtime，必须显式使用 `serviceTokenSourceBinding: 'service-client-policy'`；该模式不转发来源 gateway 绑定，只接受精确的 `<app>.runtime` 凭证，并由 Console 根据自身 tenant policy 与平台生产部署命名规则生成 `<tenant>-<app>` deployment claim，调用方不能传入 tenant/deployment。
| `public.rum.enabled` | 前端 RUM 采集开关，默认 `true`；可用 `NUXT_PUBLIC_RUM_ENABLED=false` 关闭 |
| `public.rum.endpoint` | RUM 上报地址，默认 `/api/rum`，统一租户域下由 tenant gateway 转发到 Observability Worker |
| `public.rum.sampleRate` | 普通性能事件客户端会话采样率，默认 `0.05`；错误事件强制上报，再由服务端配置二次采样 |

`runtimeConfig.public` 建议注入：`appCode`、`consoleUrl`、`authMode`、`deploymentProfile`、`deploymentPublicUrl`、`appBasePath`、`appHomeUrl`。迁移期 fallback 才需要 `accountUrl`、`casEnable`、`casBaseUrl`、`serviceUrl`。

Cloudflare 构建/运行（`HZY_CLOUDFLARE_BUILD` 或 `HZY_CLOUDFLARE_RUNTIME=true`）不在 Nitro isolate 启动时预取 Console Runtime 配置；请求期消费者按可信租户上下文和 Console Service Binding 懒加载，避免全局作用域 I/O 与无租户预热。Node 部署保留既有启动预取。

> **Nuxt Layer 规则**：Composables / Components / Server API 都按同名覆盖，业务模块可定制同名文件。Types 因 Layer 限制需在各模块 `app/types/account.ts` 重导出 `export type { ... } from '@hzy/foundation/app/types/account'`。

---

## 1. Composables（自动 import，无需手动引入）

| Composable | 职责 | 关键 API |
|-----------|------|----------|
| `useAuth()` | 当前用户信息 + Console OIDC 登录、token/session 数据源、登出；legacy bridge 仅显式 fallback | `user`、`token`、`tenant`、`subjectCode`、`policyVersion`、`logout()` |
| `useDirectory*()` | Console Directory Runtime 读取入口；用户列表由 Foundation BFF 按 runtime 单页上限 100 自动分页合并，业务页面可继续请求不超过 1000 人的姓名映射窗口 | `useDirectoryUsers()`、`useDirectoryDepartments()`、`useDirectoryProjects()`、`useDirectoryUser(uid)`、`useDirectoryGitGroups()`、`useDirectoryUserProjects(uid)`、`useDirectoryBusinessDomains()` |
| `useAccount*()` | 兼容旧 Account 命名，内部委托 `useDirectory*()` | `useAccountUsers()`、`useAccountDepartments()`、`useAccountProjects()`、`useAccountUser(uid)`、`useAccountGitGroups()`、`useAccountUserProjects(uid)`、`useBusinessDomains()` |
| `usePermissions()` | 角色/资源权限检查，基于 Console policy bundle 授权快照；普通运行默认合并全部有效企业角色，`activeRoleCode` 仅作为展示/显式模拟提示，并展开为当前应用权限 | `hasRole(role)`、`canAccess(resource, action)` |
| `useWorkflow` 模块 | Workflow API 封装（查询/审批/发起） | `fetchPendingTasks()`、`fetchTaskDetail()`、`approveTask()`、`rejectTask()`、`createInstance()`、`prepareInstance()`、`fetchInstanceByBiz()` |
| `useNotifications()` | Console 统一消息中心前端封装；未读摘要按 `uid + tenant + policyVersion` 在当前页签缓存 30 秒，写操作后强制刷新 | `loadSummary()`、`loadNotifications()`、`markRead()`、`markAllRead()`、`archive()` |
| `usePageWorkflow({ ... })` | **页面级审批声明**：注册当前页面可用的审批动作（立项/暂停/结项…），支持透传 `formData` 与 `callbackUrl` | 传入 `appCode` / `resourceCode` / `bizId` / `actions` |
| `useApprovalMode()` | 审批中心进入业务页面时的只读模式 | `isApprovalMode`、`enterApprovalMode()`、`exitApprovalMode()` |
| `useAppInfo()` | 当前应用名称/Logo；复用 `useUserApplications()` 的共享列表与 session 缓存，不独立请求应用目录 | `appName`、`appLogo`、`appCode` |
| `useAvatar` / `resolveAvatarSrc(path)` | 头像 OSS 路径解析；业务应用优先使用 `public.consoleUrl` 的 Console OSS 代理，迁移期兼容 Account URL，Console 自身使用本地代理 | 返回可访问的 URL |
| `useHeartbeat(appCode?)` | Console 统一在线状态心跳（active/idle），仅在 layout 调用一次；业务应用经本地 Foundation BFF 固定服务端 appCode 后写 Console tenant-runtime，Console 自身直写 `/api/v1/heartbeat` | 无需返回值 |
| `useDashboard()` | 侧边栏折叠状态、通知面板开关（`createSharedComposable`） | `isSidebarCollapsed`、`toggleSidebarCollapsed()` |
| `usePageTitle(title?)` | 读取/设置 LayoutSidebar 头部标题 | 支持 `Ref<string>` |
| `usePageActions()` | 注册页面刷新回调，供顶栏刷新按钮调用 | `setRefresh(fn)` / `clearRefresh()` |
| `useListPage({ ... })` | 标准服务端列表状态：页码、筛选变化归一、重置与 URL query 双向同步 | `page`、`pageSize`、`resetPage()`、`resetFilters()` |
| `useApiErrorAlert(error, options?)` | 将页面级加载错误归一为可直接绑定 `UAlert` 的安全展示模型 | 计算属性 `{ color, icon, title, description }`；纯函数 `resolveApiErrorAlert()` |
| `useAppUrls()` | 统一域名部署 URL helper，按当前应用 `baseURL/homeUrl` 生成绝对 URL 或 basePath 内路径 | `appBasePath`、`appHomeUrl`、`resolveCurrentAppUrl(path)`、`resolveCurrentAppPath(path)` |
| `useCookieOptions()` | 跨子域 Cookie 选项（SSO 必用） | 返回 `{ domain, path, sameSite, secure }` |
| `useIssueReporter(options?)` | WebDev Issue 报告组件逻辑：采集页面/路由/环境/控制台错误并脱敏、默认提交到当前应用 `/api/webdev-report/issues`；Console Shell 可通过受信 `targetBasePath/targetPageUrl/targetRoutePattern` 把请求交给当前业务应用自己的 BFF，拉取「我已提报」 | `collectContext()`、`submit(payload)`、`fetchMine(query)`、`currentRoutePattern()` |
| `useFeedbackReporter()` | 读取 Console 系统参数 `feedback.reporter.enabled`（经 `/api/runtime/feedback-reporter`），决定是否展示反馈浮动按钮；按用户授权指纹在当前页签缓存 5 分钟，Console 不可达时回退启用 | `enabled`（ref）、`load()` |

### 通用格式化

`app/utils/format.ts` 提供 `formatDate()`、`formatDateTime()`、`formatMoney()`；默认中文格式、人民币两位小数，空值或非法值统一显示 `-`。业务模块有特殊币种、精度或 locale 时通过 options 显式覆盖，不再新增同语义的页面内 helper。

整行可点击的 `UTable` 使用 `:ui="selectableTableUi"`，在 Nuxt UI 原有 hover/focus 状态上补充指针光标，不自行覆盖表格主题。

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
| `<LayoutSidebar>` | 页面主框架（当前应用侧边栏 + 内容区 + 响应式应用导航）。所有业务页默认继承此布局；企业 Shell iframe 内自动隐藏重复的应用品牌、全局应用入口、通知、用户菜单和反馈入口 |
| `<UserMenu>` | 顶栏用户菜单（头像/姓名/主题切换/登出）；普通运行使用合并权限，不再暴露日常企业角色切换入口 |
| `<NotificationBell>` | 顶栏通知按钮，展示 Console 消息中心未读角标，点击打开通知抽屉 |
| `<NotificationsSlideover>` | Console 统一消息中心抽屉，支持未读筛选、在当前应用弹窗查看实时授权详情、标记已读、归档，并仅在用户点击“前往处理”时导航业务目标；外部通知使用 Console `/notifications/{notificationId}` 深链进入统一消息中心 |
| Console `/notifications`、`/notifications/{notificationId}` | 面向所有已登录用户的完整消息中心：桌面端列表与实时授权详情双栏展示，移动端列表/详情分层切换；企业微信、钉钉、邮件等外部通知可直接选中目标消息，无需跳转通知运行时配置页 |
| `<IssueReporter>` | 业务应用内嵌「反馈」浮动入口（默认右下角，可 `:floating="false"` 仅暴露 `open()`）；自动采集页面/环境/控制台错误，提交前展示「我已提报」去重，经当前业务应用 `/api/webdev-report/issues` 上报到 WebDev。Console Shell 使用 `target-base-path/target-page-url/target-route-pattern` 将外层入口绑定到当前授权业务应用，使 WebDev 来源由目标 Worker 的 service token 确定，不能由浏览器声明。浮动按钮仅在已登录且系统参数 `feedback.reporter.enabled` 启用时展示（见 `useFeedbackReporter()`） |
| `<AppLauncher>` | 窄屏应用启动器（九宫格图标），通过 `/api/user/applications` 读取当前用户可访问应用，支持 manifest `icon` 图标名或图标 URL；与 AppRail 共用 Shell 路由和导航预热 |
| `<AppRail>` | 宽屏左侧常驻应用轨道；与当前应用侧边栏并列，企业 Shell 中由父容器唯一渲染；Shell 导航同时检查应用目录中的 Console/工作台来源，独立端口业务应用不承载 Console Shell |

`<LayoutSidebar>` 默认 `app-navigation="rail"`：宽屏显示 AppRail，窄屏只显示 AppLauncher。`app-navigation="popover"` 始终使用 AppLauncher，`none` 隐藏应用层入口。带 `hzy_embed=1` 且由 Console 企业 Shell 承载的业务页面会通过 `useApplicationShell()` 保持嵌入状态，完整隐藏侧边栏中重复的应用品牌行，以及 AppRail/AppLauncher、NotificationBell、UserMenu、NotificationsSlideover 和 IssueReporter；Shell 外层只保留一个 IssueReporter，并从当前授权应用的同源 `homeUrl/basePath` 计算业务端点和页面上下文，请求仍由目标业务 Worker 鉴权、签发 service token 和上报。业务侧栏菜单随即上移到侧栏顶部，页面标题、业务动作和内容不变。审批中心打开同应用绝对业务链接时转换为应用内路由，打开其他应用业务链接时切换父级 Shell，禁止在当前 iframe 中整页载入一个丢失嵌入标记的独立应用页面。

`/api/user/applications` 由 Foundation 在业务应用本地提供：优先转发到 Console 的当前用户应用列表，并以 Console 授权结果作为唯一应用可见性事实源。生产和共享测试环境下 Console 用户应用接口不可用时返回 503，不再读取业务应用本地 policy bundle 做可见性 fallback；仅显式 local-dev 应用目录可作为离线开发入口。业务应用不再直接调用 Platform runtime applications。应用列表按用户全部有效企业角色的应用权限并集过滤并按 Platform 下发的 `sortOrder` 升序展示；旧 `activeRoleCode` Cookie / Header / Query 不再参与应用可见性过滤。当前应用和 `workspace` 入口始终保留；`console` 管理入口固定为 `/admin`，只对具备 `console_overview:view` 的用户展示。应用切换可恢复目标应用的上次业务页面，但权限拒绝页 `/no-access` 不得保存或恢复；Console 工作台的 `/profile`、`/settings/profile`、`/todos`、`/approval/**` 也不得覆盖控制台管理入口。

`useUserApplications()` 会把已验证的最终应用列表写入当前页签的 `sessionStorage`，先恢复菜单、再后台重新请求。缓存新鲜期为 60 秒、stale-while-revalidate 可见期为 24 小时，并绑定当前 `uid + tenant + policyVersion` 授权指纹；退出登录或真实用户/租户/策略变化时清除。临时 401/403 不清空已经呈现的菜单，目标应用和服务端接口仍执行实时授权检查，因此该缓存不是授权依据。

应用导航在 pointer/focus 意图阶段同时预取目标业务文档和 Shell 文档。同源入口先以内部 `/shell/{appCode}?target=...` 启动，子应用通过受校验消息确认目标后，地址栏使用 History API 展示 `/aims/**`、`/assets/**` 等规范业务路径；顶层刷新规范业务路径时，Foundation 根据当前用户授权应用目录恢复 Console Shell。只有 URL 显式携带 `standalone=1` 才进入独立应用模式，Shell 的“在新窗口打开”会自动追加该标记并在独立应用内部导航期间保留。Shell 顶栏统一提供“刷新当前应用”，按当前规范目标重新装载 iframe 并强制保留 `hzy_embed=1`，业务应用不再为单一刷新动作保留重复标题栏。Console Shell 最多保留最近两个 iframe，并通过严格同源、授权应用 home path、消息来源窗口和 `hzy:shell:navigation` v1 校验同步标题、深链及应用运行时 `appLogo`；Shell 品牌位优先使用该 Logo，不写死应用资源路径。跨源部署始终保留直接 URL。

本地开发应用目录默认包含 Codocs `3001/codocs/`、Aims `3002/aims/`、Altoc `3003/altoc/`、Assets `3004/assets/`、Finance `3006/finance/`、Workflow `3020/workflow/`、Insights `3009`。可用 `HZY_DEV_APPLICATIONS` JSON 数组覆盖；`HZY_CONSOLE_DEV_APPLICATIONS` 仅保留为 Console 旧配置兼容别名。

业务模块不要自定义同名 `/api/user/applications` 覆盖 Foundation 实现，否则 AppLauncher 可能退回本应用 logo 或漏掉按授权可见的 Console / 业务应用入口。应用入口使用 manifest `icon`；当前应用侧边栏品牌位仍使用 `appLogo`。

### 数据选择器

| 组件 | 用途 |
|------|------|
| `<DeptTreeSelector>` | 部门树**单选**（递归节点） |
| `<UserTreeSelector>` | **员工树选择**（按部门树组织，支持委员会，支持多选/单选，复选框联动）。见下节 |
| `<GitGroupTreeSelector>` / `<GitGroupTreeNode>` | GitLab 群组树单选，带搜索与路径高亮 |

### 审批流相关

| 组件 | 用途 |
|------|------|
| `<WorkflowPanel>` | 流程操作面板，支持 `task` / `instance` / `launch` 三种输入模式；launch payload 支持 `bizContext`、`formData`、`callbackUrl`。launch 模式直接消费 `by-biz` 返回的实例、任务、动作与 capabilities，审批历史独立异步加载，不再串行重复请求实例详情 |
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
| `POST /api/auth/refresh` | 使用 refresh token 轮换本地 OIDC token；session 已过期/撤销或缺少 refresh token 时以 `200` 返回 `reauthenticationRequired=true`，由前端进入一次正常授权；上游不可用等基础设施错误保持原状态码；失败不得删除可能已被另一并发请求轮换的 Cookie |
| `GET/POST /api/auth/logout` | 清理本地 OIDC Cookie，默认跳转 Console 全局 `/oauth/logout`；显式传 `redirect` 时才使用应用级 `post_logout_redirect_uri` |
| `GET /api/auth/oidc-post-logout` | 可选的 Console OIDC 应用级登出回调，清理本地 Cookie 并回到登录页 |
| `GET /api/auth/me` | 返回当前 verified token 上下文与本应用是否存在可尝试续期的 HttpOnly refresh cookie；不返回 refresh token 内容；legacy fallback 下返回旧 Cookie 用户 |
| `GET /api/directory/me` | 带当前请求上下文读取 Console `/auth/me` 的本人展示资料；未认证返回 401，`mobileTail4` 仅为验证过的四位数字或 `null`，`mobile` 始终为 `null`。不扩展共享目录用户投影，也不从 Cookie 推断手机号 |
| `POST /api/heartbeat` | 业务应用在线状态 BFF；先验证当前 Console 用户会话，以服务端 `public.appCode` 覆盖来源应用，再转发 Console `/api/v1/heartbeat`。不接受浏览器 uid/sourceApp，Console 不使用该兼容入口而直接写自身端点 |
| `GET /api/auth/cas-login` | 迁移期 CAS 登录入口；仅显式 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 启用，否则在读取请求参数或构造重定向前返回 `410` |
| `GET /api/auth/cas-callback` | 迁移期 CAS 回调入口；仅显式 legacy bridge 校验 ticket、查询 Account、写认证 Cookie 和审计，否则在读取请求参数、网络或副作用前返回 `410` |
| `GET /api/workflow-proxy/**` / mutating methods | Workflow API 代理；先校验当前业务应用用户，再以本应用 runtime service client 请求 `audience=workflow`、`scope=workflow:proxy` 的短期 token 转发。代理会用服务端 `public.appCode` 覆盖 `request_app_code` 并写入同值 `x-hzy-request-app-code`，同时把目标 Worker runtime app identity 固定为 `workflow`；缺 appCode、token source app 不一致或无 actor 均失败关闭。Workflow 再以 `service-client-policy` 获取绑定 `<tenant>-workflow` 的 data-runtime token 并重签 actor；任务列表错误必须原样传播，不能伪装成空列表。代理必须保留 Workflow 4xx 的稳定业务 `code/message`，但对上游 5xx 和网络错误统一脱敏为 503，不得泄露内部错误细节。需要 server-side 直调 Workflow 用户路径的既有 BFF 也必须写入与其 service token source app 精确相等的 header，不能由浏览器决定 |
| `GET /api/account/user-departments` | 全量 user-dept 关联（含委员会），供 UserTreeSelector 使用；迁移期 Account 命名 BFF，必须先有已验证的 Console 用户会话 |
| `GET /api/account/dept-members?deptCode=xxx` | 指定部门/委员会的成员列表（回退路径）；迁移期 Account 命名 BFF，必须先有已验证的 Console 用户会话 |
| `GET /api/git-integration/commits` | GitLab commit 列表；支持 `projectCode/repoUrl/repoPath/ref/since/until/page/perPage`，凭证从 Console integration/vault 解析 |
| `GET /api/git-integration/commit-diff` | GitLab commit diff；支持 `projectCode/repoUrl/repoPath/sha` |
| `GET /api/git-integration/markdown-tree` | 仓库根目录与 `docs/` 下的 Markdown 文件树 |
| `GET /api/git-integration/file` | 读取 GitLab 仓库文件内容 |
| `POST /api/git-integration/commit` | 通过 GitLab commits API 创建提交，供 Codocs/Aims 等模块复用 |
| `POST /api/webdev-report/issues` | 业务应用 Issue 上报入口；派生当前用户身份后经 Console service token 转发到 WebDev `intake`（业务应用前端不直连 WebDev）。转发成功后按系统参数 `feedback.notify.wecomUsers` 经 `sendNotification()` 向配置的企业微信号推送提醒（失败不影响提交） |
| `GET /api/webdev-report/issues` | 报告组件「我已提报」列表；按当前用户 + 层级（`scope`/`pageKey`）过滤，供提交前自行判断是否重复 |
| `GET /api/runtime/feedback-reporter` | 解析 Console 系统参数 `feedback.reporter.enabled`（经 service token + runtime settings 缓存），返回 `{ enabled }` 决定是否展示反馈浮动按钮；Console 不可达时回退启用 |
| `GET /api/platform-activation/status` | 查看当前应用 Platform runtime 激活、license、bundle、heartbeat 状态 |
| `POST /api/platform-activation/retry` | 手动重试 license 校验、policy bundle 拉取与 heartbeat 上报；正常启动会刷新本地 bundle，heartbeat 返回 `download_bundle` action 时会自动拉取；未激活初始化阶段可用，已激活后要求当前用户具备 Console `system_settings:admin` |

> 业务模块如需用户、部门、项目等目录 API，请在自己的 `server/api/account/*.ts` 兼容路由或 `server/api/directory/*.ts` 薄代理中调用 Foundation `directoryApi.ts`；不要直连 Account 或 Console 数据库。浏览器 BFF 必须先建立已验证的 Console 用户会话；应用 Directory 凭证只用于下游调用，不能单独授权匿名浏览器读取目录。非 Console 应用读取 `/api/directory/users`、`/api/directory/users/{uid}` 或 `/api/directory/departments` 时，Foundation 使用调用应用 runtime 的 `console:directory-users:read` service capability 请求 Console 最小共享投影，不复用 Console 人类 UI 角色；用户投影只含共享识别字段，部门投影只含组织树字段，该 service grant 不产生 Console 菜单 entitlement。Aims 读取 `/api/directory/business-domains` 时同样使用 `aims.runtime` 的精确 `console:business-domain:view` service capability，而不是 Console `org_profile:view` 人类权限。Foundation 的成员关系 BFF（`/api/account/**` 兼容别名及 `/api/directory/**` 标准路径）已通过 `requireFoundationSessionUid()` 实施该边界；`user-departments` 是目录树的全量关系投影而非 self-service 查询，保留其已登录协作视图语义。

---

## 5. Server Utils（服务端工具，`import` 使用）

| 工具 | 用途 |
|------|------|
| `getConsoleOidcConfig()` / `resolveConsoleAuthContext()` / `requireConsoleAuthContext()` | Console OIDC 配置、JWKS/JWT 验证与 request context 解析；会调用 Console `/oauth/userinfo` 校验 `sid` 是否仍有效；服务令牌 `/oauth/introspect` 在托管云业务 Worker 中优先通过 `HZY_CONSOLE_SERVICE` Service Binding 直达 Console，Console 自身保持 Nitro local fetch，非 Cloudflare 环境才使用外部 HTTP；`server/middleware/console-auth.ts` 会写入 `event.context.consoleAuth` |
| `resolveConsoleSessionBridge(event)` / `fetchConsoleSessionApi(event, path, options)` | Session Bridge 的 `auth/me` 结果只在同一 `H3Event.context` 内以 Promise 合并并发调用，不跨请求、用户或进程缓存；用户态 API helper 以当前请求中已经验证的 Console 用户会话和可信 Tenant Gateway 上下文调用 Console，用于在线状态等低风险用户态 BFF，不接受浏览器 actor/source 覆盖，不替代跨应用 service-token 契约 |
| `server/middleware/console-auth.ts` Console service-token allowlist | 仅对由目标 handler 自行验签、校验当前 credential/grant 与 capability 的 Console 内部服务端点跳过浏览器会话认证；包含 `/api/v1/console/service/directory-connector/**`，不得放宽为整个 `/api/v1/console/service/**` |
| `requestServiceAccessToken({ audience, scope, event? })` | 获取 Console 短期 `token_use=service` JWT；优先使用显式 service client，缺少本地 client secret 时只可凭已验证 Gateway token 的 runtime app identity 换取。缓存键包含可信 tenant/deployment/environment/app，未验证的内部头既不转发也不能命中共享缓存。同一缓存键的未完成换票 Promise 会合并，成功后仍按原到期时间缓存，失败会清除 flight；这只消除并发重复签发，不延长任何授权或 permit。 |
| `loadSubjectScopedAuthorizationByService({ event, subjectUid, purpose, resourceCode, action })` | 使用精确 `console:subject-authorization:read` 服务令牌和 Console Service Binding 请求固定用途原用户范围授权；请求仅 UID/purpose，resource/action 只用于校验响应。校验用户、应用、用途、merged 模式与 grant 资源；调用方必须先验签用户委托。AIMS 产品反馈已接入，真实租户 grants/联调待验收。 |
| `checkSubjectEligibility({ event, subjectUid, purpose })` | 调用 Console purpose-bound 用户资格检查。调用方只提交 subject UID 与服务端固定 purpose；target app、tenant/deployment 由 Console runtime config 和受信 Gateway 上下文派生，使用目标应用 `aud=console`、`console:authorization:subject-eligibility` service capability。Console registry 决定唯一 `resource:action`，通知流固定为最小 `view`，Workflow 代理审批动作固定为 `approve/reject/delegate/cancel/resubmit`；响应仅 active/allowed/reason/policyRevision，不提供任意权限 oracle、对象范围、角色或 simulation 参数。Aims、Assets、People、Finance、Altoc due/offboarding、Workflow runtime 通知及 Workflow 跨应用用户动作已接入；部署需先执行 v1.42 grant seed/verify。 |
| `resolveTrustedTenantGatewayContext(event)` / `requireTenantGatewaySchedulerRequest(event, appCode)` | 常量时序验证 Gateway internal token 后读取 tenant/deployment/environment/app/forwarded host；scheduler wake 额外要求固定 kind、request ID、Runtime endpoint、60 秒 issued-at 和覆盖固定 POST 路径及全部绑定字段的 HMAC。用户/admin 会话不能替代该内部信任边界 |
| `classifyServiceOperationFailure(error, options?)` / `resolveServiceOperationConflictDisposition(error)` / `extractServiceOperationStatus()` / `extractServiceOperationCode()` / `sanitizeServiceOperationErrorSummary()` | 跨应用 operation 的 BFF 纯函数错误标准化：从 ofetch/H3/unknown 错误保留真实 upstream HTTP status 与稳定 code，分类 authentication/authorization/contract/conflict/transient；HTTP 409 强制显式 disposition，resolver 只按稳定 code 保守映射 idempotent success、processing、payload mismatch、binding conflict，未知冲突永久失败且不读取自然语言消息；timeout、网络错误、408/425/429/5xx 标记可重试，401/403 原样保留且绝不泛化为 502；持久化前统一脱敏 URL、Bearer/JWT、token、Cookie、password 等并限长。helper 不发网络、不决定 operation 路由 |
| `isEnterpriseRoleRecord(role)` | Policy bundle 角色记录的企业角色有效性适配器；调用 `@hzy/authz-core` 的 `isEnterpriseRole`，统一按 `app_code/appCode` 为空、`status=active`、`is_assignable/isAssignable` 可分配判断，避免租户自定义企业角色被 `systemRoleCodes/sourceRoleCode` 过滤 |
| `buildAllowedAppCodesFromPolicyBundle({ payload, uid, requestedRoleCode, authorizationMode?, allowRoleSimulation?, includeBaseline? })` | 从 Platform policy bundle payload 计算当前用户可访问应用集合；普通运行默认合并全部有效企业角色，并按 `subjectMemberships` 继承 active 部门/职位主体角色；兼容期优先读取 v2 `roleAssignments` / `rolePermissionGrants` / `baselineGrants`，缺失时回退 v1 `subjectRoles` / `rolePermissions` / `baselinePermissions`；只有服务端显式允许的 `role_simulation` 才按 `requestedRoleCode` 收窄，模拟器可选择本人尚未持有但仍有效可分配的企业角色，无效模拟角色不得回退到其他角色，`includeBaseline=false` 时应用菜单也不会混入基础应用；Console `/api/user/applications` 先消费服务端模拟会话再调用该 helper，Foundation 只把当前应用当作已授权条目的地址/图标回退信息，不得把当前应用重新补成授权来源。模拟开始、结束或过期时客户端会清空旧应用缓存并强制重载，授权结果为空时也按权威空集 fail closed |
| `evaluateFoundationScopedAuthorization({ grants, required, object, policyOf? })` / `foundationScopeSetMatches()` | Foundation 数据范围 evaluator。按同一授权单元内同维度 OR、跨维度 AND，多授权单元 OR 判定；角色默认范围、授权具体范围和附加范围必须在同一 grant 内共同满足，权限与范围不得跨 grant 拼接。动作蕴含默认使用 `@hzy/authz-core` 保守层级，也可通过 `policyOf` 消费 v2 `actionImplications` 构造的 action policy。项目范围中只有显式 `project:code:<code>` 可仅凭项目编码匹配；`project:member/owner` 必须同时提供并命中成员/所有者关系事实，缺失谓词的 legacy project scope 仍按 `member` 归一化并 fail closed。产品范围支持显式 `product:code`、`product:member`、`product:manager`；关系谓词要求非空 productCode、actorUid 和业务服务端提供的 productMemberUids／productManagerUids，不借用项目关系或通用 owner，未知产品谓词拒绝。另支持 `tenant:global`、`subject:self`、`department:self/tree`、`customer:owner/team`、`object:assigned`、`relation:*`、`environment:*` 等基础谓词，业务 API 接入时仍需按列表/详情/写入/导出分别调用 |
| `evaluateFoundationProductAuthorization()` / `compileFoundationProductScope()` | 产品详情与列表共用的有限事实授权适配。仅接受产品／租户和已知产品关系范围；仍由统一 evaluator 判断动作与同 grant 范围，不复制角色算法。列表枚举非成员／成员／经理三种状态，将默认与具体编码匹配位交给 Runtime 在当前成员关系上过滤；相关具体编码最多 512 个，超限显式失败，不截断。 |
| `buildScopedAuthorizationGrantsFromPolicyBundle()` / `evaluatePolicyBundleScopedAuthorization()` | 将 Platform policy bundle 兼容 payload 标准化为 Foundation grant 并调用 evaluator；兼容期优先读取 v2 `roleAssignments`、`rolePermissionGrants`、`assignmentScopes`、`roleDefaultScopes`、`baselineGrants`，缺失时回退 v1 `subjectRoles.assignmentId`、`rolePermissions`、`subjectRoleScopes`、`roleScopes`、`baselinePermissions`，并从 v2 `actionImplications` 构造 `@hzy/authz-core` action policy。支持普通 merged、服务端显式允许的 role simulation、active 部门/职位 membership 继承、assignment scope 的 `inherit/intersect/replace`，并保留同一 assignment 上的权限与范围绑定；模拟本人未持有但有效可分配的企业角色时只生成承载角色默认范围的 synthetic grant，若本人已持有该角色则继续使用真实 assignment grant/scope，非法角色保持 fail closed；业务 API 传入对象上下文后可直接用于详情/写入/导出范围判定 |
| `loadAuthorizationSnapshotFromConsoleRuntime(uid, appCode, event, options?)` / `loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, options?)` / `loadInstanceConflictExplanationFromConsoleRuntime(event, uid, appCode, options?)` / `normalizeAuthorizationResources()` | 业务应用服务端授权入口：普通权限快照、对象级 scoped authorization 和实例级职责冲突解释均通过 Foundation 调 Console runtime，返回 active role、authorization mode、bundleVersion/bundleHash、v2 `policyRevision`、resources、资源级 `actionPolicies`、scoped grants/actionPolicy/decision 或自审批/同人经办风险解释。托管云 Worker 检测到 `HZY_CONSOLE_SERVICE` 时，三类请求都必须经 Service Binding 调用 Console；不得用普通 `$fetch` 经公共租户域名绕回 Gateway/WAF。`authorizationResourcesAllow()` / `authorizationActionsAllow()` 是业务端唯一动作判定适配器，内部委托 `@hzy/authz-core`；业务模块不得手写层级。实例冲突解释由 Console 优先使用本地已验签 bundle 的 v2 `conflictRules` 和 Foundation `explainPolicyBundleInstanceConflicts()` 计算，旧 bundle 或本地解释不可用时才回退 Platform internal API。Console 不可用时生产 fail closed 为 503，不再回退业务应用本地 policy bundle，也不得由业务 `checkPermission` 吞掉并伪装为用户缺权的 403；仅显式 local-dev bypass 可返回本地开发资源清单。旧 `loadAuthorizationFromCachedPlatformBundle()` 只作为兼容别名保留，有请求上下文时委托 Console runtime，无请求上下文时不再读取本地 bundle；旧 `listUserCodesByRoleFromCachedPlatformBundle()` 已禁用本地读取 |
| `finalizeScopedDataAccess({ sawPermission, allowSelf, deptCodes })` | 业务应用数据范围 BFF 收口规则。业务模块在 grant 循环中遇到 `all` 提前返回，剩余 dept/self/none 尾部统一交本函数：解析到部门返回 `dept` 并去重，否则只要用户已通过权限校验（`sawPermission`）或解析到 self 就降级为 `self`，**绝不对已认证且有权限的用户返回 `none`**。防止数据范围解析未命中被 data-runtime 翻译成 403（单条）或静默空列表，对齐 altoc 修复样板；finance（expenses/performance）和 people（employees）已接入，altoc/aims 继续收敛。Assets 目标对象因需保留 direct/department/project 的 grant 内 AND，不使用此扁平收口，而复用 Foundation scoped grant 与 Directory tree 生成有界 unit。 |
| `getIntegrationConfig(integrationCode)` / `resolveIntegrationSecret({ integrationCode, purpose })` / `get*RuntimeConfig()` | Tenant Runtime Integration adapter。业务模块使用自身短期 service identity 直达 `/v1/console/service/integrations/**`，Runtime 再校验本地 grant allowlist；Console BFF 不读取 grant/Vault 表，也不接触返回的 credential。不得直接读取 `integration_credentials`、Console 内部 credential id 或旧 Console `/vault/resolve` |
| `requireEnterpriseUser()` / `prepareEnterpriseRuntime()` / `enterpriseRuntimePermitExpiresAt()` / `callEnterpriseRuntime()` | ADR-018 Host 专用调用入口；固定物理 enterprise 身份，从已验证 OIDC 用户会话提取租户/主体；只允许已注册操作，经现有 tenantRuntimeClient 以 service-client-policy 申请精确业务 capability、签名 actor。`prepareEnterpriseRuntime()` 仅为随后同一注册操作预取相同 Runtime service token。`enterpriseRuntimePermitExpiresAt()` 发行14秒 permit，`callEnterpriseRuntime()`只把明确定义 permit 字段中原本合法的14～15秒值收紧至该期限；已过期或超过15秒的异常值保持原样交 Runtime 拒绝，facts/input 不会改写。Runtime的15秒接受上界、身份、范围和权限算法均不变。该1秒余量基于跨 Worker/Runtime 时钟差的诊断推断，不把它表述为已确认的过期原因。`capabilityFormat: business` 不添加旧 audience 前缀；未迁移调用保持原格式。注册操作现覆盖产品规划、项目/工作项及资产等已迁路径；精确 path/capability 的唯一注册源为 enterpriseRuntimeClient，候选与已启用环境分别核验。接口与未完成项见 [Enterprise API](../enterprise/docs/API_SPEC.md)。 已登记操作表现覆盖产品目录列表与批量名称解析（`assets.product-directory` / `assets.product-directory-resolve`）、Aims 工作项创建/编辑/关联/完成/状态流转/删除（`aims.work-item-*`，其中 `delete` 使用独立 capability）、数字资产与 IP 资产读写；新增操作必须同时在此表登记路径与精确 capability，Host 路由不得自拼 Runtime 路径。 |
| `maybeCallTenantRuntime()` / `maybeCallCurrentAppTenantRuntime()` / `isTenantRuntimeEnabled()` / `buildServiceCommandRuntimeHeaders()` / `verifyServiceCommandRuntimeHeaders()` / `hashServiceCommandPayload()` | Tenant Runtime HTTP client；优先读取 `HZY_TENANT_RUNTIME_*` / `x-hzy-tenant-runtime-*`，兼容旧 `HZY_DATA_RUNTIME_*` / `x-hzy-data-runtime-*`，用于新模块 runtime proxy；只有 `x-hzy-gateway-token` 匹配 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）时才接受 Tenant Gateway 注入的 runtime URL/token/tenant/deployment 头；调用时只从已验证的 Console 用户会话（含经 Console `auth/me` 确认的 legacy session bridge）提取用户/部门 actor，并用 runtime bearer token 做 HMAC 签名，runtime 侧不得信任未签名的普通 actor header。`build`/`verify` 共用完全相同的 canonical header 与 HMAC 语义，供跨 BFF 的首跳 service-command 以短时目标 service token 绑定 method、path、tenant/deployment、source/target app+client、operation/capability/idempotency/schema、command hash、request ID 与时限；目标 BFF 必须在读取 runtime/OSS 前 verify，随后由自身 runtime bearer 重签第二跳。仅 Workflow 内部可传 `workflowProxyActor`：helper 会再次验证入站 service token 的精确 `workflow:proxy`、source app 与 `x-hzy-request-app-code`、target `workflow` 及 tenant/deployment 后才以 Workflow runtime bearer 重签；其他模块不得把它当作通用 actor override。`scope` 可为空格分隔多个值；旧路径按 audience 添加兼容前缀（Console capability 除外），新注册路径使用 `capabilityFormat: business` 保留精确冒号业务 capability 并拒绝宽 scope。仅 AA-04 Aims milestone receivable callback 可使用 `capabilityFormat: 'aims-milestone-receivable'`，它只接受 `data-runtime` / `tenant-runtime` 且只保留固定原始组合 `aims.write altoc:receivable:mark-billable`，不是通用 raw scope 入口。|
| `callConsoleTenantRuntime()` 及 `get/updateConsoleTenantProfile()`、settings/organization/work-calendar/audit/notification/Connector Runtime helpers | Console 租户数据专用 Runtime client；固定 `appCode=console`、`/v1/console/**` 和 `console:*` capability 类型，Runtime 未启用或未配置时 fail closed，不回退 Console 本地数据库。当前已冻结企业资料、系统参数、业务领域、行政区域、工作日历、operation/login/lifecycle 审计视图、当前用户通知读状态，以及 Enterprise Connector Runtime metadata/enrollment/heartbeat/revoke 的语义路径与精确 capability；mutation 透传 BFF 的 `Idempotency-Key` 和签名用户 actor，版本化写入携带 `expectedRevision`。Cloudflare Gateway 与 PM2 loopback 使用同一 HTTP 合同 |
| `projectIntegrationOperationList()` / `projectIntegrationOperationAttempts()` / `projectIntegrationOperationReplay()` | 跨应用 operation 管理端的浏览器安全投影。Aims、Altoc、Assets、Finance、People 的 BFF 只能在 runtime 返回后调用这一 allow-list：列表和 attempt timeline 只允许稳定业务身份、状态/次数/版本、稳定错误码与类别、目标业务键及时间/耗时；绝不返回 operation/correlation/idempotency key、capability、command/hash、锁/fencing、原始错误正文、request/response 或认证材料。受控重放只对浏览器保留 `{operationId,expectedVersion,reason}`。 |
| `maybeProxyCurrentApiToTenantRuntime()` | 通用 Nuxt API 到 tenant-runtime proxy；按 `/api/v1/** -> /v1/{appCode}/**` 转发，支持 app 级转发白名单、scope resolver 和已验证用户/部门上下文透传（`current_user_dept_code(s)`）；scope resolver 可返回传输 scope + 资源/动作 capability 的组合（如 `altoc.write altoc:lead:edit`），用于同时满足 runtime 入口认证和 adapter 内部领域授权；会清理浏览器传入的 `current_user` / `operator_uid` / `current_user_scopes` 等认证上下文字段后重建；是否允许 direct DB fallback 由模块中间件显式决定，Assets/Altoc/Aims 阶段 2 主路径不回退 |
| `reportOperationAudit(payload, { event?, idempotencyKey? })` | 复用 Console audit audience 与 audit:write 合同。请求内调用应传 event，配置、令牌及 Console Service Binding 使用同一请求上下文，不退回 eventless 请求；可传稳定幂等键。sourceApp 必须匹配实际物理服务身份，逻辑业务域可记录在 action/detail。保持原 best-effort 语义，失败仅固定脱敏日志；不把它用作必须持久成功的业务审计门禁。无 event 的 legacy 调用行为保留 |
| `readRequestBodyCompat(event)` | 跨运行时请求体读取。Nitro 的 Cloudflare 入口通常为 POST/PUT/PATCH 缓冲 body（`requestHasBody` = `/post|put|patch/i`），但带 body 的 DELETE 以及少数未暴露预期缓冲体的 POST/PUT/PATCH 进入 Worker 后，`event.node.req.body` 仍可能为 null 而 `content-length` 仍在。h3 `readRawBody` 此时会退回 node-mock-http 的 mock Readable 等待永不触发的 `'end'`，Promise 永不 settle，Worker 被 Cloudflare 以「code had hung and would never generate a response」取消。该 helper 只要发现缓冲体缺失，就从平台原始 Request 取回 body 并预置到 h3 优先读取的 `event._requestBody`，解析语义与 `readBody` 完全一致。所有可能收到带 body 的转发点（`tenantRuntimeProxy`、`tenantRuntimeClient`、`dataRuntimeClient`、`workflow-proxy`）必须使用它，不得直接调用 `readBody` |
| `listGitCommits()` / `getGitCommitDiff()` / `listGitMarkdownTree()` / `getGitRepositoryFile()` / `createGitCommit()` / `upsertGitIssue()` | Git integration fixed-operation service。GitLab baseUrl/token 只在 Console tenant-runtime 从 `gitlab.default` integration 和 vault 解析，业务 BFF 不读取凭证。`upsertGitIssue()` 要求服务端幂等键，并以稳定 Aims item-key marker 创建/更新 Issue；Console 会在更新已有 IID 前复验 marker，禁止覆盖其他工作项的 Issue |
| `aiProviderFetch()` / `getAiProviderIntegrationConfig()` / `getWecomIntegrationAccessToken()` / `getOssIntegrationConfig()` | AI Provider、企业微信、OSS runtime integration helpers。服务端按 `integrationCode` 消费 Console integration + vault，不在业务模块直接读取 secret 或 Console vault resolve |
| `getAccountApiConfig()` / `requireAccountApiConfig()` / `getAccountApiAuthHeaders()` | 读取/校验 Account API 配置，生成 Authorization Header |
| `fetchDirectoryActiveStatuses(event, uids)` | 通过现有 `console:directory-users:read` service capability 请求 `projection=active-status`，按 1～100 个显式 UID 返回最小 `uid/active`；不存在／停用／未知状态为 false。严格校验响应完整 UID 集合和布尔类型，旧版身份展示响应不能代替状态校验；不缓存，不授予用户产品动作。Aims 产品成员写入前校验目标及接管经理，每次最多两人 |
| `getDirectoryConfig()` / `requireDirectoryConfig()` / `getDirectoryAuthHeaders()` / `fetchDirectoryApi()` / `fetchConsoleBusinessDomainsByService()` / `isConsoleDirectoryProvider()` | 读取/校验 Console Directory 配置，调用 Console Directory API；不提供 Account fallback；非 Console 应用的用户列表、单用户共享身份和部门树读取通过调用应用 runtime 的 `console:directory-users:read` service token 请求最小共享投影，不要求或授予 Console UI 权限；Aims 业务领域字典通过精确 `console:business-domain:view` 服务权限读取；其他 `/api/directory/users/**` 路径会在代理前本地解析 `system` 等内置服务身份 |
| `resolveDeploymentProfile()` / `isManagedCloudProfile()` / `isSelfHostedProfile()` | 解析当前部署 profile；Cloudflare runtime 默认归入托管云 profile，生产未显式配置时默认 `self-hosted`，本地默认 `dev` |
| `resolveHzyDevApplications()` / `DEFAULT_HZY_DEV_APPLICATIONS` | 本地开发应用目录；Console 和业务应用共用，支持 `HZY_DEV_APPLICATIONS` JSON 数组覆盖 |
| `loadHzyLocalDevRuntimeMode()` | 本地开发模式 helper；供应用入口、runtime fallback 等路径判断是否允许使用开发目录或跳过生产 runtime 副作用 |
| `loadPlatformActivationConfig()` / `readAndVerifyPlatformLicense()` / `refreshPlatformPolicyBundle()` / `postPlatformRuntimeHeartbeat()` | Platform runtime 激活工具：读取 `HZY_PLATFORM_*` 配置、验签 license、启动时拉取/刷新签名 policy bundle、上报 deployment heartbeat，并消费 heartbeat `download_bundle` action 自动刷新 |
| `readPlatformActivationStatus()` / `patchPlatformActivationStatus()` / `readCachedPlatformBundle()` | Platform runtime 本地状态与 policy bundle 缓存工具，默认缓存目录 `.data/platform-runtime`；`readCachedPlatformBundle()` 仅用于 Platform runtime 激活、heartbeat 刷新和诊断，不作为业务应用授权事实源 |
| `resolveCurrentAppHomeUrl()` / `resolveCurrentAppUrl()` / `derive*CallbackUrl()` / `buildAppHomeUrl()` | 统一域名部署 URL helper，按 `HZY_DEPLOYMENT_PUBLIC_URL + HZY_APP_BASE_PATH`、`NUXT_APP_BASE_URL`、显式 homeUrl 或 request origin 派生应用 URL、OIDC/CAS/企微回调和应用入口 |
| `fetchConsoleServiceJson(event, url, options)` / `resolveServiceAppBaseUrl(event, appCode, { directTarget: true })` / `resolveTrustedServiceAppRoute()` / `trustedServiceRequestHeaders(event, targetAppCode)` | 托管云调用 Console 时优先经 `HZY_CONSOLE_SERVICE` Service Binding 发送 JSON 请求，避免共享 Worker 重新进入公共 WAF；非 Cloudflare 环境保持标准 HTTP fallback，并保留真实状态码。Tenant Gateway 会把注册表中非 secret 的目标 Worker origin、deployment 与 base path 作为 `x-hzy-service-routes` 注入已签名请求，并剥离浏览器同名伪造头。托管云跨应用同步 BFF 必须显式 `directTarget` 直达目标 Worker，避免在 Gateway 等待来源 Worker 时重新进入同一 tenant host；下游头会把 app/deployment/prefix 改写为目标应用，同时保留已验证 tenant、Runtime bootstrap 与来源 service token。缺少可信 Gateway 绑定或目标注册项时失败关闭。本地开发仍按配置/端口表回退；默认无 `directTarget` 的解析保持既有 Gateway 控制链路语义 |
| `resolveNotificationActionUrl()` / `loadNotificationActionTargetCatalog()` | 通知浏览器目标绑定能力。shared 纯函数按已解析 application `homeUrl` 的 exact origin/home path 规范化相对或绝对 URL；server helper 只接受 Console runtime 的签名 policy bundle applications，显式本地 dev 模式才回退 dev catalog。Console 在泛用 publish 中对所有 `metadata.actionableState='pending'`（以及既有 Workflow）在 hash/persist 前调用该能力，统一重写 target aliases 并写入 `catalog-v1` binding marker；Foundation 只透传业务 metadata，不能自行猜测 URL/目标或伪造该 marker。不得用 `resolveServiceAppBaseUrl()` 或 appCode 域名猜测代替浏览器导航事实源。 |
| `proxyCurrentAppPath()` / `buildCurrentAppProxyUrl()` | 统一域名 API 收敛兼容代理工具，保留当前应用 basePath 转发到本地既有 API |
| `getUserByUid()` / `reportLoginAudit()` / `getRequestIp()` | 统一认证流程中的用户补全、登录审计与来源 IP 解析 |
| `handleCasLogin()` / `handleCasCallback()` | 迁移期 legacy CAS 登录重定向与回调处理；仅 `HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 可执行，默认 Console OIDC 模式 fail-closed 为 `410` |
| `getAuthCookieOptions()` | 统一认证 Cookie 的 domain/path/sameSite 配置 |
| `reportWebDevIssue(event, payload)` / `listMyWebDevIssues(event, query)` | 业务应用 → WebDev Issue 上报/查询代理；内部用 `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write\|read' })` + `resolveServiceAppBaseUrl(event,'webdev')` 调 WebDev intake/mine |
| `publishNotification({ recipients, title, summary, actionUrl, event? })` | 发布站内消息到 Console 统一消息中心；使用 Console service token `audience=notifications`、`scope=notifications:publish`；作为低层站内通道 primitive，普通业务通知应调用 `sendNotification()` |
| `sendNotification({ touser, externalRecipients?, channel?, title, description, url, inAppUrl?, idempotencyKey, ... })` | 统一双通道通知入口；先以 Console `in_app` 作为耐久事实源，成功后才通过客户侧 notification/connector runtime 发送企业微信或钉钉。`touser` 是站内 canonical UID，`externalRecipients` 可固定为外部 provider subject；`inAppUrl` 用于凭据型外部 URL 的安全站内替代，禁止把 bearer token 写入持久通知。缺省来源从 Console runtime config 推断，并把稳定幂等键传给 runtime；空收件人和 `@all` 在网络调用前拒绝。外部失败抛出保留站内成功结果的部分交付错误。Delivery ledger 只保存请求哈希和脱敏结果，不保存通知正文或 URL。 |
| `drainIntegrationOperationDeadLetterNotifications()` / `publishIntegrationOperationDeadLetter()` | Aims/Altoc/Assets/Finance/People dead-letter actionable 适配器。新路径只消费 source 冻结的 generation、actionable key 和 object version，发布成功后将 Console 实际过滤的 `recipientUids` 与 notification ID 回写 source CAS；随后扫描 source closure，以 expected/next version 调 Console lifecycle，再确认 closure ack。publish 或 closure ack 丢失均可重放，Console 失败不改变 source 事实。旧 failure-notification endpoint 仅在新 API 明确 404/405/501 时回退，且 legacy payload 不生成 actionable。 |
| `parseNotificationDetailAuthorizationRequest()` / `requireNotificationDetailAuthorizationCaller()` | 来源应用通知详情实时重验的服务边界：统一要求服务端 `notificationId/descriptor/subject.uid/tenantId/deploymentId`，只接受 Console service token、精确 `<source-app>:notification-details:authorize` scope，并要求 tenant/deployment 与已验证 token claim 完全一致；拒绝浏览器身份、非 Console 来源、缺失上下文和客户端直接声明 actor。Console 会在任何非 Console 来源调用前先按 persisted descriptor 的静态 source+resource registry 做 active Directory + fresh normal-merged 固定 `resource:view` 资格检查；来源不可传入或覆盖该 resource/action，拒绝和基础设施不可用都不会调用来源 verifier。Aims 可通过 `maybeCallTenantRuntime()` 的专用 `notificationDetailActor` 选项生成绑定精确 app/path/scope/tenant/deployment 和固定 purpose 的短时 HMAC runtime actor；普通调用不能启用该 delegation。业务对象当前访问权仍必须由来源应用自身 runtime/授权规则判定，来源不可用时 fail closed。 |
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

- Console session bridge 的 auth/me 和 session API 使用 `consoleServiceFetch`，通过 Binding 转发 Cookie 和受信 Console 目标上下文，保留 query 和 401/403/503 语义。`resolveConsoleAuthContext` 仅在同一个 HTTP event 内、相同 Token/配置/网关上下文下复用检查；新请求或身份变化必须重新校验，不延迟跨请求撤销生效。

- OIDC 后端换票、刷新、用户会话校验统一复用 `consoleServiceFetch`；JWKS 的 JOSE fetch 优先走 Console Binding。userinfo/JWKS 使用 Console 受信目标上下文，换票保留来源客户端上下文，所有原有身份与撤销检查保留。
- `/oauth/userinfo` 与 introspect 一样由专用 handler 承担鉴权；跳过重复的通用 Console audience 校验，不跳过 handler 的用户 Token 验签、token_use、有效期及实时会话撤销检查。

- `NUXT_PUBLIC_WORKFLOW_ENABLED=false` 可在未部署 Workflow 的环境关闭共享侧栏审批入口和待办角标查询；默认启用。该开关不是授权边界，不改变 Workflow API 的权限检查，也不伪造空待办。
- 用户应用目录使用 Console Service Binding；`NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS` 可调整该次读取的期限（1000–15000 ms，默认或非法值回落至 3000 ms）。超时仍返回 503，不返回本地权限目录。

1. **不要绕过 Foundation 直连 Account/Workflow 数据库**——必须走 API；
2. **不要重复实现**已存在的组件/composable——有需求先提 issue 扩展 Foundation；
3. **组件遵循 Nuxt UI V4 规范**：颜色用 `primary`/`success`/`warning`/`error`/`info`/`neutral`；
4. 本地文件可覆盖 Layer 同名文件，但请先评估是否应反哺回 Foundation；
5. 修改 Foundation 后必须：`pnpm typecheck` + `pnpm lint` 双绿，再回各业务模块回归。

---

## 变更记录

Gateway scheduler trust：`requireTenantGatewaySchedulerRequest(event, appCode, path?)` 的第三参数由服务端处理器固定给定，默认仍为 integration drain；policy sync 固定 `/api/internal/policy-bundle/sync`，沿用 Gateway token、完整上下文 HMAC 与 60 秒窗口。不得从用户 query/body 选择签名路径。统一调度的 `x-hzy-scheduler-storage/generation` 选择仅对 `aims`、`assets` 接受（`unified/recovered/disabled` + 规范 uint64 generation），并纳入同一 HMAC；其他应用携带选择一律 403。`maybeCallTenantRuntime(event, path, { enterpriseScheduler: { generation } })` 只接受封闭统一调度路由表中的路径（Aims outbox、Aims 周期里程碑滚动、Aims 到期通知、Assets 到期通知），且 `appCode`、精确 scope 必须与该路由一致；它按路由所属 app 重新校验签名唤醒、固定唤醒携带的 Runtime 端点与 generation，并禁止用户会话、actor 委托、query 或静态 token。业务 Worker 的统一调度调用不得改用静态 Runtime 配置。

统一 Aims scheduler transport 在签发服务令牌或请求 Runtime 前，核对实际解析出的 endpoint 与已验证 wake 的 `runtimeEndpoint` 完全一致；两个 Runtime URL header 的优先级差异不能覆盖签名目标，不一致返回 403。

性能诊断：`server/utils/performanceTiming.ts` 的 `measureRequestStage(event, stage, run)` 在 Worker env 显式 `HZY_PERF_TIMING_ENABLED=true` 时追加 Server-Timing，只含代码内固定阶段名及耗时，不记录身份、Token 或地址。默认关闭，保留回调结果及异常；当前用于 People 权限/范围、Runtime 调用、OIDC 与 Console scoped 诊断，不改变鉴权策略。

| 时间 | 变更 |
|------|------|
| 2026-04-16 | 新增本文档；`UserTreeSelector` + `/api/account/user-departments` + `/api/account/dept-members` |
| 2026-04-15 | `GitGroupTreeSelector` / `GitGroupTreeNode` |
| 2026-04-14 | `reportOperationAudit` 审计日志回传（见 Account）|
| 2026-04 | `usePageWorkflow` 多动作模式 |

共享 `ConfirmDialog` 将 message（为空时用 title）绑定为 Modal description，并以 sr-only 保留辅助技术关联；正文仍在原确认区域显示。

`UserTreeSelector` 通过消费应用的 `#ui/composables/useFormField` 绑定外层字段到选择按钮，并隔离弹层内部 input ID 上下文；搜索框和每个树复选框使用独立 ID 与明确名称，避免多份 Nuxt UI 实例造成字段注入键不一致。

- 用户通知代理 `fetchConsoleNotificationsForUser` 统一通过 `consoleServiceFetch` 消费 Console Service Binding，保留已验证用户凭证、查询参数和写操作幂等键；托管云不经公网回源读取通知。
