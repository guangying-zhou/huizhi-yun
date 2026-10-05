# Console 批次 A 只读盘点

日期：2026-09-26。执行者：Codex-sol2。依据 `.git/codex-brief-console-batch-a.md`。

仅静态读取仓库文件并生成本报告；未修改代码、重启进程、调用环境 API、查询数据库、提交或部署。文件位置与行号为本次工作区快照；其他代理可能继续修改工作区。运行环境、实际 grants、浏览器行为均 **unverified**。S/M/L 是实现工作量相对估计，不含环境验收或批次 C。

已读取根、Console、Enterprise CLAUDE.md，迁移分波计划 §4、ADR-017 §2.10、ADR-019。Host 只提供一个主 Shell；Console 保持身份、会话、策略权威。以下 (a)/(b)/(c) 为建议，不是实施或环境切换授权。

## 1. 共用边界与已有 Host 能力

- `enterprise/app/pages/**` 当前只有 `index.vue`、`login.vue`、`enterprise/approvals/index.vue` 和 `enterprise/approvals/[id].vue`。其他业务页通过显式组合注册；搜索 `enterprise/composition/**` 与 `deploy/test-env/enterprise-host-routes.mjs` 未发现本批次页面登记。不能把 Foundation 通知抽屉等同完整通知页已迁入。
- Host 顶栏已有 `NotificationBell` 与 `NotificationsSlideover`（`enterprise/app/layouts/default.vue:129,148`），个人下拉当前仅退出登录（同文件 `:131`）；没有发现该顶栏到个人资料页的链接。工作台已使用 `useNotifications`（`enterprise/app/pages/index.vue:86,101`）。`/enterprise/approvals` 为审批工作流页，不是 Console 四种 todoKind 的聚合列表。
- Foundation 已有 `useNotifications`、`useUserApplications`、`useAuth`、`usePermissions`/`useAuthorization`、`usePageTitle`、`resolveAvatarSrc`、`resolveNotificationActionUrl`、`useApplicationShell`、`UserMenu`。Host 当前没有使用 Foundation `UserMenu`；后者自己的资料入口为 `/settings/profile`（`foundation/app/components/UserMenu.vue:304`），不可据此推断 Host 已提供该页。
- Foundation `server/api/notifications/**` 已有 list/summary/detail/read/archive/read-all 用户代理；`foundation/server/utils/notifications.ts:notificationUserForwardHeaders` 只接受已验证 user 上下文，通过 `fetchConsoleNotificationsForUser` → `consoleServiceFetch` 转发用户凭据。不是新 Service API，也不以服务 token 替代用户授权。对应 helper 在 `foundation/server/utils/consoleServiceBinding.ts:106`，绑定解析 `:48`、去 `/console` 前缀 `:65`。Binding 是传输能力，不授予业务权限。
- Foundation `GET /api/directory/me` 已有，只取 `/api/v1/console/auth/me` 返回的当前 Directory 用户投影（`foundation/server/api/directory/me.get.ts:25`）；由 `fetchConsoleApi` 的 Console 本地分派或 `fetchDirectoryApi` → `consoleServiceFetch` 实现。接口需要 Console session；Host OIDC access-token 与 Console cookie 的适配是否足够，**unverified**，不得默认无条件可用。
- `enterprise/server/**` 未发现本批次专用 BFF。已有 `/aims/api/work-calendars/:calendarCode/days`（`enterprise/server/routes/aims/api/work-calendars/[calendarCode]/days.get.ts`）是 Aims 合同，不能代替 Console 日历目录、月汇总、导入和编辑 API。
- Host 只 extends Foundation（`enterprise/nuxt.config.ts`），配置 `authMode=console-oidc`、directory/provider=console（`:138-146`）。不要导入 Console 整个 nuxt.config、app.vue、布局、全局插件或后台 worker。Console 独有 `dashboardPanelUi` / `NotificationCenter` 需显式注册或提取。

### 当前链接与 Shell

Console 独立布局有 `/profile`、`/notifications`（`console/app/layouts/default.vue:23,28`）；配置有 `/org-profile`、`/work-calendar`（`console/app/config/permissions.ts:52,106`），Gateway Console 前缀下对应 `/console/...`。Foundation 通知 action URL 的 Console 原生白名单含 `/org-profile`、`/work-calendar`、`/notifications`（`foundation/shared/utils/notificationActionUrl.ts:3-9`）。`useApplicationShell` 是共享嵌入状态/导航协议，不代表这些原生 Console 页已登记为 Host 页面。

搜索 Host 页面、布局、composition 没发现对本批次 `/console/...` 的逐页硬编码链接；**不能声称 Host 当前全部通过旧 Shell 链接这些页**。通知铃铛直接打开抽屉，正文 action URL 依授权应用目录解析；Console 原生路径与同源非原生应用的 `/shell/{appCode}` 规则不同。后续迁移必须调整受控 URL 投影和深链接，不能全局重定向写 API。当前环境 Gateway 最终路由与生成导航中的租户链接 **unverified**。

### 数据与身份通用链

下文 Runtime 行的调用均经 `foundation/server/utils/consoleTenantRuntimeClient.ts:57-79` → `maybeCallTenantRuntime`，无 Runtime 时 503，没有 Console 本地 DB fallback。`foundation/server/utils/tenantRuntimeClient.ts:1298,1404` 从原请求读取并转发 Idempotency-Key。表数据权威为 Tenant Runtime/客户数据库，不是 Console 本地 DB；本次未发现批次业务 handler 直连 DB。

Console 用户身份 helper：`console/server/utils/notifications.ts:requireNotificationUserUid` 接受已验证 user 上下文，或验证 access token，再读取正式 session（禁 legacy fallback），并绑定用户委托；`console/server/utils/requestIdentity.ts:5` 经 `resolveConsoleSession` 获取当前 uid。session 本身也在 Runtime：`console/server/utils/authSession.ts:275-280` 调 `resolveConsoleAuthSession`，对应 `POST /v1/console/auth/sessions/resolve`、`console:auth-session:read`（Foundation client `:478-487`），默认可能 touch lastSeen。所有身份解析/Token/会话写入属于 **batch C** 权威实现，批次 A 只能复用既有认证边界。

## 2. 通知列表与详情

### 页面、组件与 composables

- `console/app/pages/notifications/index.vue:2` 只渲染 Console 自有 `NotificationCenter`。
- `console/app/pages/notifications/[notificationId].vue:2-7` 用 `useRoute`、`computed` 解析 ID，再把 ID 传给同一个 `NotificationCenter`。
- `console/app/components/NotificationCenter.vue:1-65` 使用 Console `dashboardPanelUi`；Foundation `usePageTitle`、`useUserApplications`、`useNotifications`、`resolveNotificationActionUrl`；Nuxt/Vue `useRouter`、`navigateTo`、ref/computed/watch/onMounted、props/defaults。Nuxt UI：UDashboardPanel、UDashboardNavbar、UDashboardSidebarCollapse、UBadge、UButton、UIcon、UCard、UAlert。
- 两页共用整个通知 API 集；详情页也初始化目录、汇总、列表（组件的 onMounted 初始化处）。详情成功自动 markRead（见附录调用原文），并非严格零写入读取页。

### 每个 API 与后端

下表 `C=` `console/server/api/`，`F=` `foundation/server/utils/consoleTenantRuntimeClient.ts`；`:数字` 是实际调用行。列表/详情共同依赖目录 API，见 §7。

| 页面可达 METHOD + path | Console handler / 调用点 | 数据源、Runtime METHOD + path / capability | 人员授权 | 幂等 |
| --- | --- | --- | --- | --- |
| GET /api/notifications | C notifications/index.get.ts:6；Foundation composable useNotifications.ts 的 loadNotifications | F:2102 GET /v1/console/notifications；console:notification:read | 当前用户；Runtime 收件人范围 | 读取 |
| GET /api/notifications/summary | C notifications/summary.get.ts:6；useNotifications.loadSummary | F:2110 GET /v1/console/notifications/summary；console:notification:read | 当前用户 | 读取 |
| GET /api/v1/console/notifications/:notificationId/detail | C v1/console/notifications/[notificationId]/detail.get.ts:11 | notificationDetails.ts:getUserNotificationDetail → F:2118 GET /v1/console/notifications/:id/detail-fact；console:notification:read；另有来源授权调用 | 当前收件人 + fresh eligibility/对象授权，非仅登录 | 读取；授权协议见下文 |
| POST /api/v1/console/notifications/:notificationId/read | C v1/console/notifications/[notificationId]/read.post.ts:9 | F:2141 POST /v1/console/notifications/:id/read；console:notification:manage | 当前收件人 | handler :8 强制 Key；composable 发送 |
| POST /api/notifications/:notificationId/archive | C notifications/[notificationId]/archive.post.ts:9 | F:2141 POST /v1/console/notifications/:id/archive；console:notification:manage | 当前收件人 | handler :8 强制 Key；composable 发送 |
| POST /api/notifications/read-all | C notifications/read-all.post.ts:8 | F:2129 POST /v1/console/notifications/read-all；console:notification:manage | 当前用户 | handler :7 强制 Key；composable 发送 |

Host 中 `useNotifications` 的 appCode 是 enterprise，因此 detail/read 会改用 `/api/notifications/:id/detail|read`，已有 Foundation 代理分别转至同一 Console v1 handler。Console 中 appCode=console 才用表中 v1 路径（`foundation/app/composables/useNotifications.ts:98-100`）。`/api/notifications` 的 Foundation list/summary/archive/read-all 代理同样转 Console v1；Console 存量顶层 handler 直接调用相同 Runtime。v1 list、summary、archive、read-all 与上表行为一致（对应 C v1/console/notifications/**）；本次未发现 Console 顶层 detail override。

**通知详情的其他数据源/授权**：`console/server/utils/notificationDetails.ts:AUTHORIZATION_PATH` 定义 `POST /api/v1/service/notification-details/authorize` 与 `/authorize/finalize`，`callSourceAuthorization` 以来源 app 的现有服务 scope 调来源 Service API；某些消息走 Console lifecycle verifier 或 Aims webdev_issue 快照分支。先读收件人 detail-fact，然后新鲜资格与对象授权；来源 enterprise 的受控不可变快照分支不提供业务对象导航。需要保留该策略，不把正文快照直接放到 Host 绕过 verifier。来源权限细目由 descriptor 决定，无固定一个通知页资源能替代；各来源实际部署与 grant **unverified**。

写动作：单条已读、全部已读、归档；“前往处理”只是受控导航，业务完成在来源页面，批次 A 不迁来源写操作。通知 helper 读取/转发 cookie 或 user access token、来源授权会签发服务 token：这些 **batch C** 身份实现留 Console/Foundation，不能随组件复制到 Host。

**迁移形态 (a)**：复用现有 Foundation 用户代理，无新增 capability/grant/Runtime 操作。显式组合 NotificationCenter，替换 `~/utils/dashboardPanel` 引用，调整其硬编码 `/notifications` router.push/返回链接为冻结的 Host 路由；保留正文实时授权与用户隔离缓存。顺序 1，列表 M、详情 S（同组件，合并估计 M）。

## 3. 我的待办

`console/app/pages/todos/index.vue:16-21` 使用 Foundation usePageTitle/useUserApplications/useNotifications、resolveNotificationActionUrl，Nuxt useRoute/useToast/navigateTo，Vue ref/onMounted；组件 UDashboardPanel、UDashboardNavbar、UBadge、UButton、UCard、UIcon。

| METHOD + path / 页面调用 | Console handler | 数据源与调用点 | 授权/幂等 |
| --- | --- | --- | --- |
| GET /api/v1/console/notifications/todos（todoKind/cursor/limit=20）/ :56-64 | console/server/api/v1/console/notifications/todos/index.get.ts:14 | console/server/utils/notifications.ts:listUserPendingActionables → Foundation client:2155 GET /v1/console/notifications/todos；console:notification:read | 当前用户/收件人；无需 Key |
| GET /api/v1/console/notifications/:id/detail / :87 | 同 §2 detail | 同 §2；Runtime + 来源实时授权 | 当前收件人 + 对象资格 |
| POST /api/v1/console/notifications/:id/read / :90 | 同 §2 read | 同 §2；之后 GET /api/notifications/summary | 强制 Key |
| GET /api/user/applications / :120 loadApps | §7 | 授权应用目录 | 当前用户 |

没有“完成 todo”接口或按钮。`:83-101` 先校验详情/action URL，标已读，再导航来源业务；标已读不会把 pending actionable 置 resolved。`GET /api/v1/console/notifications/todos/summary` handler 已存在，但本页面没有调用，属于可复用库存，不能误记为本页必需 API。

**迁移形态 (a)**：增加一个薄的 Host todo-list 用户 BFF，复用 `fetchConsoleNotificationsForUser` → 现有 Console `/api/v1/console/notifications/todos`；这是缺少 URL 接线，不需要新的 Console Service API/Runtime 操作，故不归 (b)。其余 detail/read/summary/application catalog 已有 Foundation。直拷原组件仍会请求 Console v1 地址，需改为 Host 明确路由。身份/token 边界同 §2 **batch C**。顺序 2，M。

## 4. 个人资料与兼容入口

### profile.vue

`console/app/pages/profile.vue:2-7` 依赖 Console dashboardPanelUi；Foundation usePageTitle/useAuth、resolveAvatarSrc；Nuxt useFetch/useToast，Vue ref/reactive/computed/onBeforeUnmount。组件 UDashboardPanel、UAlert、UAvatar、UButton、UCard、UFormField、UInput。当前表单只改头像和密码，没有修改姓名/邮箱/部门的 API。

| METHOD + path / 页面调用 | handler / 数据源调用点 | 授权 | Key / batch C |
| --- | --- | --- | --- |
| GET /api/directory/me / :46-63 | foundation/server/api/directory/me.get.ts:25 → console/server/api/v1/console/auth/me.get.ts:5 resolveOptionalConsoleSession → authSession.ts:275；Runtime session resolve 与 Directory 投影 | 当前正式 session；未认证 401（Foundation） | session 读取/touch **batch C**；Host 仅消费最小资料 |
| PUT /api/v1/console/directory/me/avatar / :131-137 multipart | console/server/api/v1/console/directory/me/avatar.put.ts:47 putConsoleOSSAvatar、:66 updateConsoleDirectoryOwnAvatar | :19 正式 Console session，绑定自己 uid | 浏览器发送 Key，Console handler 未显式 requireKey；Runtime 消费 Key，见下文；:72-77 Cookie 更新 **batch C** |
| GET /api/v1/console/directory/me/password-capability / :167 | console/server/api/v1/console/directory/me/password-capability.get.ts:6 → Foundation client:1011 GET /v1/console/directory/me/password-capability；console:directory-connector:view | requireConsoleRequestUid，当前用户 | **batch C** |
| POST /api/v1/console/directory/me/password / :202-209 | console/server/api/v1/console/directory/me/password.post.ts:10 → Foundation client:1022 POST /v1/console/directory/me/password；console:directory-connector:execute | 当前用户；202 connector operation | :8 requireKey，浏览器 :204 发送；当前/新密码 **batch C** |
| GET /api/v1/console/directory/operations/:operationId / :177-179 | console/server/api/v1/console/directory/operations/[operationId].get.ts:8 → Foundation client:1030 GET /v1/console/directory/operations/:id；console:directory-connector:view | handler 当前用户；Runtime operation 归属限制 **unverified** | 最多轮询20次；密码任务状态 **batch C** |

头像有两阶段：Foundation client `:350` 的 PUT /v1/console/oss/avatars（console:avatar-object:write，integrationCode=oss.default 默认）把对象写到 OSS；`:1650` PUT /v1/console/directory/me/avatar（console:directory-profile:edit）更新自己 Directory 头像。两者都由 Console Runtime 执行，不是 Console 直读 OSS secret。`data-runtime/internal/server/server.go:2285-2288` 将请求 Key 放入 ConsoleMutationMeta。端到端 OSS 写入与元数据重放原子性 **unverified**。Console handler 最后可能更新 legacy auth cookies，不能原样搬入 Host；Foundation Console binding helper 目前 body JSON 序列化，不应直接拿它转发 multipart。

`useAuth` 根据 console-oidc 配置调用现有认证 composable（`foundation/app/composables/useAuth.ts:2-4`）；读取 `/api/auth/me`（Host 配置前缀后 `/enterprise/api/auth/me`）、401 后可能调用 POST `/api/auth/refresh`（同样受前缀配置）。这些是既有 Host session bootstrap，**batch C**，不新增或复制 session/refresh 逻辑。MFA 本页未发现；没有“编辑资料 token”或新 secret 输入。

**迁移形态 (a)**，仅资料展示：复用 Foundation `/api/directory/me` 与 Host 现有 useAuth，确认 cookie/session 投影兼容后接线；缺少可靠投影时应先定义当前用户资料适配，不能借全目录 service capability。头像上传暂建议 **(c)** 留 Console，因为现有 handler 有会话 Cookie 写入且 BFF 缺 multipart 合同；密码能力、修改与 operation 轮询全部 **(c)/batch C** 留 Console。这不是建议删除功能：Host 给明确的 Console 安全设置入口。

顺序 4，展示 M（凭据适配确认可能扩大），头像与密码本批次不迁。普通头像数据本身不是凭据，但现有会话副作用需要拆分后另审。

### settings/profile.vue

`console/app/pages/settings/profile.vue:2` 仅 `navigateTo('/profile', { replace: true })`；无组件、API、额外授权、独立写动作。所有实际依赖继承 profile.vue，不能算第二套资料实现。Host 无该页；Foundation UserMenu 有此旧目标但 Host 未使用该组件。

**(a)** 随展示页增加受控兼容 alias/redirect，冻结新旧 route 与安全设置链接；密码等仍 **batch C/(c)**。顺序随个人资料，S。

## 5. 工作日历

本页标题是“节假日管理”，不是普通用户自己的日程。`console/app/pages/work-calendar.vue:59,81` 使用 Foundation usePermissions，canEdit=system_settings:edit；同时用 usePageTitle、Nuxt useToast、Vue ref/computed/watch。依赖 Console dashboardPanelUi。Nuxt UI：UDashboardPanel、UBadge、UButton、UButtonGroup、UCard、UInput、UModal、USelect、USkeleton、USwitch、UTextarea。

设 `B=console/server/api/v1/console/work-calendars/`、`F=foundation/server/utils/consoleTenantRuntimeClient.ts`：

| METHOD + path / 页面调用 | Console handler / Runtime call site | Runtime METHOD + path、capability | 人员授权 / Key |
| --- | --- | --- | --- |
| GET /api/v1/console/work-calendars / :207 | B index.get.ts:6 / F:1846 | GET /v1/console/work-calendars；console:work-calendar:view | system_settings:view |
| GET /api/v1/console/work-calendars/:calendarCode/months?year / :220 | B [calendarCode]/months.get.ts:7 / F:1858 | GET /v1/console/work-calendars/:code/months；console:work-calendar:view | system_settings:view |
| GET /api/v1/console/work-calendars/:calendarCode/days?yearMonth / :228 | B [calendarCode]/days.get.ts:7 / F:1870 | GET /v1/console/work-calendars/:code/days；console:work-calendar:view | system_settings:view |
| POST /api/v1/console/work-calendars/import-year / :267 | B import-year.post.ts:10 / F:1892 | POST /v1/console/work-calendars/import-year；console:work-calendar:import | system_settings:edit；handler :8 强制 Key；页面 :270 发 Key |
| PATCH /api/v1/console/work-calendars/:calendarCode/days/:workDate / :301 | B [calendarCode]/days/[workDate].patch.ts:10 / F:1905 | PATCH /v1/console/work-calendars/:code/days/:date；console:work-calendar:edit | system_settings:edit；handler :8 强制 Key；页面 :306 发 Key |
| GET /api/auth/permissions / :78 loadPermissions | §7 共用权限接口 | 已验签 policy bundle，不是日历表 | 当前用户 |

所有日历业务数据来自 Console Runtime。自动导入另读取外部 holiday-calendar JSON（`data-runtime/internal/apps/console/work_calendar.go:692-693` unpkg/jsdelivr）；手工导入传入 JSON dataset。写动作：自动获取全年、手工导入全年、逐日修改 dayType/isWorkday/holidayName/remark；分别带 expectedRevision。不是只有读取。没有本页新 credential/MFA/token 输入；现有身份解析 **batch C**。

`console/server/utils/systemSettingsAccess.ts:8-23` 对 view 有 service actor fallback，scope=system_settings:view；edit 没有该 fallback。故授权不能简写“管理员”，也不能因为服务读取可用就让普通用户免 system_settings:view。

**迁移形态 (a)**：为五个明确 METHOD + path 增加 Host 用户 BFF，复用 Console 用户 API 和既有 Foundation binding，保留 Console system_settings 权限判断及 Key/冲突语义；不签发 enterprise 直达 Runtime 的新能力。Foundation 需要一个保留已验证 user 上下文及 Key 的窄 JSON 转发适配（现有 fetchConsoleApi 没有独立 headers 选项；通知 helper 仅 GET/POST，不涵盖 PATCH）。无新的 Runtime 操作。顺序 5，M；Claude 需确认批次 A 是否包括该管理写入，若只迁日历读取则写入口必须保留 Console 明确去向。

## 6. 企业资料（只读迁移）

`console/app/pages/org-profile.vue:2,4,35-40` 使用 Console dashboardPanelUi，Foundation usePageTitle/usePermissions，Nuxt useFetch/useToast，Vue ref/reactive/computed。Nuxt UI：UDashboardPanel、UDashboardNavbar、UButton、UAlert、UCard、USkeleton、UModal、UFormField、UInput、UTextarea；最后四项主要属于原页编辑弹窗。

| METHOD + path / 页面调用 | handler / 数据源 call site | 授权 / Key |
| --- | --- | --- |
| GET /api/v1/console/profile / :35-38 | console/server/api/v1/console/profile.get.ts:6 → Foundation client:86 GET /v1/console/profile；console:org-profile:view | org_profile:view |
| PUT /api/v1/console/profile / :143-147 | console/server/api/v1/console/profile.put.ts:13 → Foundation client:100 PUT /v1/console/profile；console:org-profile:edit | org_profile:edit；handler :7 强制 Key；页面 :145 发 Key |
| GET /api/auth/permissions / :66 loadPermissions | §7 | 当前用户 |

当前源页实际有编辑弹窗、saveProfile 和 PUT，字段含企业名称、法人名称、信用代码、联系信息、本地化与 logoPath；没有 secret。Runtime 权威保存 org_profiles。**本任务限定只读迁移，不能直接注册完整源组件让编辑按钮随权限出现**。原 Console PUT 仍留 Console，不新增 Host 写路由。GET 权限必须保留，不能当作任意登录用户可读的公开品牌信息。

**迁移形态 (a)**：Host 只读展示页 + 窄 GET BFF 经 Foundation Console binding 调现有 profile GET；不新增 capability/grant/Runtime operation，编辑入口明确留 Console。共享身份实现 **batch C**。顺序 3，S。

## 7. 共用隐含 API 依赖

这些也是页面调用链的一部分，不应只盘点组件中直接出现的 $fetch。

| 依赖页面 / METHOD + path | Console handler / 数据源 call site | 授权与敏感性 |
| --- | --- | --- |
| 通知两页、todos：GET /api/user/applications | console/server/api/user/applications.get.ts:10 → console/server/utils/userApplications.ts:291 getConsoleUserApplications；Host Foundation 代理可调用 /api/v1/console/user/applications（Bearer） | 当前 session 或验证 access token；人员 app-access/已验签 policy snapshot 过滤；不是全量应用授权 |
| 上述 Bearer 目录 GET /api/v1/console/user/applications | console/server/api/v1/console/user/applications.get.ts 的 verifyAccessToken、getConsoleUserApplications；同时 writeTokenEvent(introspect) | token 校验与事件审计 **batch C**；不在 Host 复制 |
| org-profile、work-calendar：GET /api/auth/permissions | console/server/api/auth/permissions.get.ts:35-41 resolveConsoleSession/loadPolicyAuthorizationSnapshot；Bearer 版本 console/server/api/v1/console/user/permissions.get.ts | 当前用户、appCode 指定的权限快照；会话/token **batch C** |

应用目录数据主要是已验签 Platform policy bundle（userApplications.ts:314,348；用户过滤 :229）；managed-cloud cache miss 可 refreshPlatformBundle（:317），旧非 managed-cloud 且包缺 enterpriseEntitlement 时可 GET Platform /api/platform/runtime/applications（:270-271,335-339）。因此分类为 **Platform 来源的已验签策略缓存 + 条件性 Platform 调用**，不是纯 Directory Runtime 查询。策略缓存可能通过 Runtime 持久层，实际环境 backend **unverified**。

`usePermissions` → `useAuthorization` 会对 enterprise 前缀取 `/enterprise/api/auth/permissions`（`foundation/app/composables/useAuthorization.ts:78-80`）；复制 Console 页面后不能假设默认 enterprise snapshot 含 console.org_profile/system_settings 权限。Host 需显式读取逻辑 Console 人员权限或直接根据 Console BFF 的授权返回只读状态。本次未发现 Foundation `server/api/auth/permissions.get.ts` 文件，Host 实际由何注册提供该路径及当前环境可用性 **unverified**；迁移时必须核实 route readiness，不据源码中客户端 URL 宣称接口已服务。

## 8. 需要 Claude 决定或补核的事项

1. 冻结本批次 Host 规范 route、兼容旧 `/console/...`、通知详情 ID/query、个人安全设置回退 URL；是否放在 `/enterprise/...` 或登记的逻辑 `/console/...` 尚未决定。Gateway/Shell 投影不能依据浏览器参数任意切换。
2. 确认工作日历是否允许全部管理写动作进入批次 A；当前不是普通员工 API，权限是 system_settings:view/edit。若仅日历查看，管理动作留 Console，明确入口去向。
3. 个人资料只读投影能否复用现有 `/api/directory/me` 的 Console session cookie 路径？Host OIDC 用户凭据与 SSR 适配未实测。若必须新建当前用户 Service API，则归 (b)，需要绑定签名 actor、精确新 capability、Console grant seed/verify；不能用全目录 grant 偷渡自己的资料。
4. 头像暂留 Console：是否另批拆分 session Cookie 更新，并补 multipart 用户 BFF/上传大小/对象条件写入/幂等合同？本报告不提出新增头像 capability（两个现有 Runtime scopes 已存在），也不把接线视为已验收。
5. Foundation 小幅补充：Console 用户 JSON 转发（GET/PATCH/POST、保留已验证身份、Key、401/403/503、可信目标部署）与明确 todo-list 代理；可复用 notifications helper 的约束，但不能扩大为任意 path 的通用代理。Calendar/Org权限应读取逻辑 Console snapshot；若需要扩大现有 adapter，单独登记 Foundation 合同变化。
6. 显式组件组合：NotificationCenter 和 dashboardPanelUi 的注册/导入方案；调整组件 router.push/返回链接，不带 Console Shell、plugins、auth 或任务。
7. 通知详情现有来源 verifier/grants 与活跃 policy 状态仍需环境证据；Aims finalize 协议、Console lifecycle 权限、enterprise snapshot 分支要原样保留。接入读取不授权给 Host 新的通知 producer/publish 能力。
8. 默认方案没有新增 capability/grant/Runtime 操作：所有 (a) 都在既有用户授权路径下。若改为 Host 直调 Runtime 或新服务接口则必须改分类为 (b)，列出精确业务 capability 与 grants，并遵循 SourceAppCode=console 的既有 Runtime 边界，不能借 Host 同进程身份。
9. 本次未验证环境授权、页面可达、真实收件人/用户隔离、角色矩阵、幂等重放或 1440/390 视觉；后续按 §4 模板补齐验收。密码、MFA、session/refresh/token Authority 均留 **batch C**，没有因盘点而改变 ADR-017 凭据边界前置条件。

## 9. 简要汇总与建议顺序

| 顺序 | 页面 | 形态 | 规模 | 主要缺口 / 写边界 |
| --- | --- | --- | --- | --- |
| 1 | notifications/index.vue | (a) | M | 组合共享通知页、Host route；read/read-all/archive 保留 Key |
| 1 | notifications/[notificationId].vue | (a) | S（与列表合并 M） | 共用组件、深链接与 fresh 来源授权；自动 markRead |
| 2 | todos/index.vue | (a) | M | 新薄用户 list BFF；已有 Runtime，非新增 Service API；无 todo completion |
| 3 | org-profile.vue 只读 | (a) | S | 新 GET BFF、Console org_profile:view；原 PUT 不迁 |
| 4 | profile.vue 资料展示 | (a)，头像/安全动作 (c) | M | 当前用户投影凭据兼容 unverified；密码/会话 **batch C** |
| 4 | settings/profile.vue | (a) | S | 同一资料页兼容 redirect，安全设置留 Console |
| 5 | work-calendar.vue | (a) | M | 明确用户 BFF 与 Foundation PATCH/Key 适配；system_settings 管理权限 |

结论：批次 A 优先复用 Console 用户 API 和 Foundation binding，已有通知能力最接近可迁；资料页必须拆出密码与会话副作用，工作日历需按管理权限与真实写动作评审。本次没有发现必须新增的 Runtime 业务操作；环境可用性与授权不作完成声明。

## 附录：关键间接调用原文
以下为本次读取的实际调用行，补充上文函数名证据。
- `console/server/utils/notifications.ts:61`：`export async function requireNotificationUserUid(event: H3Event) {`
- `console/server/utils/notifications.ts:105`：`export async function listUserPendingActionables(`
- `console/server/utils/notificationDetails.ts:36`：`const AUTHORIZATION_PATH = '/api/v1/service/notification-details/authorize'`
- `console/server/utils/notificationDetails.ts:37`：`const AUTHORIZATION_FINALIZE_PATH = '/api/v1/service/notification-details/authorize/finalize'`
- `console/server/utils/notificationDetails.ts:130`：`async function callSourceAuthorization(`
- `console/server/utils/notificationDetails.ts:304`：`export async function getUserNotificationDetail(event: H3Event, uidInput: string, notificationIdInput: string) {`
- `console/server/utils/notificationDetails.ts:311`：`const envelope = await getConsoleUserNotificationDetailFact(event, notificationId)`
- `foundation/server/utils/notifications.ts:225`：`function notificationUserForwardHeaders(event: H3Event) {`
- `foundation/server/utils/notifications.ts:269`：`export async function fetchConsoleNotificationsForUser<T>(`
- `foundation/server/utils/notifications.ts:294`：`const response = await consoleServiceFetch<ConsoleApiResponse<T>>(event, `${baseUrl}${normalizedPath}`, {`
- `console/app/components/NotificationCenter.vue:185`：`await markRead(notificationId)`
- `console/app/components/NotificationCenter.vue:246`：`onMounted(async () => {`
- `foundation/app/composables/useNotifications.ts:94`：`const notificationItemApiBase = currentAppCode === 'console'`
- `foundation/app/composables/useNotifications.ts:149`：`const response = await $fetch<ApiResponse<NotificationSummary>>('/api/notifications/summary')`
- `foundation/app/composables/useNotifications.ts:184`：`const response = await $fetch<ApiResponse<{ items: NotificationItem[], nextCursor: string | null }>>('/api/notifications', {`
- `foundation/app/composables/useNotifications.ts:214`：`const response = await $fetch<ApiResponse<NotificationDetail>>(`
- `foundation/app/composables/useNotifications.ts:221`：`await $fetch(`${notificationItemApiBase}/${encodeURIComponent(notificationId)}/read`, {`
- `foundation/app/composables/useNotifications.ts:236`：`await $fetch(`/api/notifications/${encodeURIComponent(notificationId)}/archive`, {`
- `foundation/app/composables/useNotifications.ts:247`：`await $fetch('/api/notifications/read-all', {`
- `foundation/app/composables/useConsoleOidcAuth.ts:253`：`await $fetch(resolveAuthUrl('/api/auth/refresh'), { method: 'POST' })`
- `foundation/app/composables/useConsoleOidcAuth.ts:266`：`resolveAuthUrl('/api/auth/me'),`
- `console/server/api/v1/console/user/applications.get.ts:26`：`const payload = await verifyAccessToken(event, token)`
- `console/server/api/v1/console/user/applications.get.ts:32`：`await writeTokenEvent(event, {`
- `console/server/api/v1/console/user/applications.get.ts:42`：`data: await getConsoleUserApplications(event, uid)`
- `console/server/api/v1/console/user/permissions.get.ts:4`：`loadPolicyAuthorizationSnapshot,`
- `console/server/api/v1/console/user/permissions.get.ts:45`：`const payload = await verifyAccessToken(event, token)`
- `console/server/api/v1/console/user/permissions.get.ts:62`：`snapshot = await loadPolicyAuthorizationSnapshot(uid, targetAppCode, event)`

## Claude 审查决定与 Step 2（2026-09-26）

盘点审查通过；本节覆盖上文尚未冻结的建议：

1. Host 正式路由为 `/enterprise/notifications`、`/enterprise/notifications/:notificationId`、`/enterprise/todos`；不使用 Host `/console/...`，旧 Console 页继续工作，本步骤无重定向。
2. 工作日历是 system_settings 管理页，移至批次 B，不属批次 A。
3. 个人资料展示与企业资料只读进入 Step 3；Claude/Codex-sol 先安排 Host `/api/directory/me` 只读探测，不通则停止，不建新服务 API。
4. 头像、密码和安全设置留 Console，后续 Host 明确链接出去。
5. NotificationCenter 与 TodoList 移至 Foundation，双端共用；路由/API 通过 props 指定，Console dashboardPanelUi 由调用方传入；Host 页头用 ContentPageHeader。
6. 通知沿用 Foundation 用户代理；待办只新增 GET `/enterprise/api/notifications/todos`，经 fetchConsoleNotificationsForUser 调现有 Console API，仅允许 todoKind/cursor/limit（1–50），额外字段 400；更新 Host readiness。
7. fresh source authorization、Aims finalize、lifecycle、enterprise snapshot、自动已读及 read/read-all/archive 幂等键全部保留。
8. Host 抽屉查看全部与工作台待办入口指向新页面；通知业务 action URL 深链接不在 Step 2。
9. 停止条件：需改 notifications.ts/consoleServiceBinding.ts 的 Header 或身份转发、需新 capability/grant、或需改 Console handler 除 imports 外的内容时，先回报 Claude。边界排除 data-runtime/deploy/workflow 和其他代理在途文件，无重启/环境写入。

Step 2 代码与隔离验证证据见提交回执；不把旧盘点中的未验证项改记为环境通过。

### Step 2 验证回执

- Enterprise / Console typecheck 通过。
- Console 全量 579/579；Foundation 全量 671 个 TS 测试 + 3 个 MJS 测试通过。
- 新 todo 用户路由、共享组件双端渲染与 readiness 定向 11/11 通过；Console 页面提取后契约定向 4/4 通过。
- Enterprise 全量 249 个测试：246 通过、2 失败、1 跳过；两项失败均为范围外 Aims timesheet/weekly-reports 原页面使用 ContentPageHeader 未显式 import 的既有源码合同，本批次未改这些页面。
- 三模块 ESLint 对本批次文件执行通过（0 errors）；Host default.vue 保留 54 项既有格式 warnings，新增代码无 warnings。git diff --check 通过。
- 浏览器检查未完成；Claude 已澄清：匿名只读 curl 通知列表、待办页的 302 是 Cloudflare Access 登录，不能据此判断重定向循环。未重启、清理 Cookie、修改环境或执行已读/归档写请求。1440/390 与真实交互验收由 Claude/Codex-sol 在登录态完成。

### Step 2 审查后续与 Step 3 暂缓

Claude 审查通过 d8f1b34d。Host 共享组件改用 Foundation 自动导入，todo BFF 对 cursor 增加 512 字符上限，隔离测试覆盖 512 允许、513 拒绝且不访问 Console。两项合为 fix(enterprise) 提交。

Step 3 暂缓：资料展示与企业资料的非通知 Console API 需要用户身份转发适配，命中此前停止条件；Claude 在 Step 2 登录态浏览器检查后分配负责人，本次不实施该适配或新服务 API。
