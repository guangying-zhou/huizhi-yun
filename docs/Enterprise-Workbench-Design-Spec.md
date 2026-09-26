# 企业工作台（个人首页）设计与实现规范

> 版本：v1.0（2026-09-26）
> 适用：Enterprise Host 首页 `/`（别名 `/enterprise`）及后续在工作台一级下新增的个人视图。
> 上位依据：[企业业务导航与交互规范](./Enterprise-Business-Navigation-and-Interaction-Spec.md) §3.1、§2.3，[UI/UX 规范](./UI_UX_SPEC.md) §5.4 与 §7，[ADR-019](./ADR-019-Enterprise-Business-Frontend-Integration.md)。
> 设计基线：设计系统「汇智云企业导航」的 `Workbench` 页面范式（与 `AppShell`、`TopBar`、`SideNav` 同一套令牌），设计画布「汇智云企业工作台」含桌面 1440 与窄屏 390 两张画板。设计系统与本文冲突时，先改本文再改设计系统。
> 实现：`enterprise/app/pages/index.vue`、`enterprise/app/utils/workbench.ts`、`enterprise/test/workbench.test.mjs`。

## 1. 定位

工作台是一级「工作台」的落地页：把**当前用户今天要处理的事**聚在一屏，每一项都能一步进入原业务页办理。

- 它是个人首页，不是综合看板；不为其他一级业务区补建看板（导航规范 §2.3）。
- 审批、工作项、项目、工时的办理和状态仍归原领域。工作台只读、只聚合、只跳转，不复制审批动作、状态机或编辑表单（导航规范 §3.1、§4.1「审批待办」行）。
- 不显示「未购买模块」或营销内容。无权的内容**不出现**，而不是显示为 0 或空壳。

## 2. 版式

外壳沿用 Host 唯一布局（顶部栏、统一侧栏）；工作台只占内容区，最大宽度 1600px，内边距桌面 24px、窄屏 16px。内容区自上而下四段：

| 段 | 内容 | 桌面（≥1280px） | 窄屏（<1280px） |
| --- | --- | --- | --- |
| 问候行 | `caption` 日期与 ISO 周次；`page-title` 问候语 + 显示名；一句摘要；至多两个快捷操作 | 左文右按钮 | 按钮移到文字下方两列等宽 |
| 概览卡 | 至多四张数字卡 | 一行四列（≥1024px 即四列） | <1024px 两列；<640px 隐藏口径说明行 |
| 主栏 | 我的工作、我参与的项目 | 左侧 2/3 | 单栏，排在概览之后 |
| 侧栏 | 待我审批、最新通知、常用入口 | 右侧 1/3 | 单栏，排在项目之后 |

窄屏顺序固定为：问候 → 概览 → 我的工作 → 项目 → 审批 → 通知 → 常用入口。任何宽度都不得出现页面级横向滚动；列表行在 <768px 把编号、项目与截止折到标题下一行。

## 3. 区块清单与数据契约

每个区块都有**显示前提**：只有导航快照（`useEnterpriseNavigationAccess()`，与侧栏同一份）里对应入口可见时才发请求、才渲染。这样无权用户不会产生被拒请求，也不会看到空壳。审批与通知对所有登录用户开放，以接口结果决定显示。

| 区块 | 显示前提（导航入口 id） | 数据源（Host 路由） | 口径 | 下钻 |
| --- | --- | --- | --- | --- |
| 问候摘要 | 无 | 复用下列各块已成功加载的结果 | 只列已加载成功且有权的项 | — |
| 写周报 | `aims.delivery.execution.weekly-reports`，否则 `codocs.workspace.self.journal` | — | — | 该入口 |
| 记工时 | `aims.delivery.execution.timesheet` | — | — | 工时日历 |
| 待我审批（卡 + 侧栏列表） | 无；`GET` 失败或非 0 码则整块隐藏 | `GET /api/workflow-proxy/tasks/pending?page=1` → `{ items, nextPage }` | 第一页条数；`nextPage` 非空显示 `N+` | `/enterprise/approvals/{task_id}`，全部 → `/enterprise/approvals` |
| 未完成工作（卡）/ 我的工作（列表） | `aims.delivery.execution.work-items` | `GET /aims/api/v1/my-work-items?filter=assigned&uid=<当前用户>` → `{ items }` | 未完成 = `planning/todo/in_progress/in_review` | `/aims/projects/{projectId}/board/{id}/execution`，全部 → 任务中心 |
| 本周工时（卡） | `aims.delivery.execution.timesheet` | `GET /aims/api/v1/users/{uid}/time-entries?startDate&endDate&pageSize=500` | 本地时区周一至周日，`hours` 求和保留 1 位 | 工时日历 |
| 我参与的项目 | `aims.delivery.project.projects` | `GET /aims/api/v1/projects?participatingOnly=true&page=1&pageSize=6` → `{ items, total }` | 标题旁「共 N 个」取 `total` | `/aims/projects/{id}`，全部 → 项目总览 |
| 未读通知（卡）/ 最新通知 | 无 | Foundation `useNotifications()`：`loadSummary()`、`loadNotifications({ limit: 5 })` | `summary.unreadCount` | 右上角通知铃铛 |
| 常用入口 | 导航快照非空 | 快照中已授权叶子入口前 9 个，图标继承所属二级节点 | — | 该入口 |

「我的工作」页签：

- **进行中** = `todo` + `in_progress`。
- **本周到期** = 未完成且截止日 ≤ 本周日，逾期的也算在内。
- **确认中** = `in_review`。

各页签按截止日升序，无截止日的排在最后，最多显示 6 行。

规则：

- 请求一律 `server: false`、`immediate: false`，在 `watch([uid, 授权条件])` 满足后才 `execute()`；不得在授权未知时预取。
- 所有数据都来自已登记的 Host 路由和 Foundation composable。新增区块时，不得为工作台新开聚合后端或绕过原路由的权限判断；缺数据源时先按 ADR-018/019 在原领域补路由。
- 分页接口只取第一页时，数字标 `N+`，不得把当前页数量当总数（UI/UX 规范 §5.4）。

## 4. 四态

每个区块独立处理四态，一块失败不影响其他块：

| 状态 | 呈现 |
| --- | --- |
| 加载 | `USkeleton`，形状接近最终内容（列表行、卡片、磁贴） |
| 失败 | `UAlert color="error" variant="subtle"`，标题「××读取失败」，说明「请稍后刷新页面」 |
| 空 | Foundation `CommonEmptyState`，图标 + 一句说明，例如「这里没有需要处理的工作」「你还没有参与的项目」 |
| 无权 | 不渲染该块、不发请求。主栏两块都无权时，显示一张「暂无可展示的工作内容」空态，引导用户使用常用入口或侧栏 |

## 5. 视觉令牌与 Nuxt UI 对应

颜色、字号、间距、圆角全部使用设计系统令牌，实现时用 Nuxt UI 语义类，不写原色。

| 设计令牌 | 实现 |
| --- | --- |
| `surface` / `surface-raised` / `border` | `bg-default` / `bg-elevated`（hover、磁贴底） / `border-default`；行分隔 `border-muted` |
| `ink` / `ink-body` / `ink-muted` | `text-highlighted` / `text-toned` / `text-muted` |
| `primary-text` 实心主按钮 | `UButton`（默认 primary 实心） |
| 描边次按钮 | `UButton color="neutral" variant="outline"` |
| `secondary` 跳转链接 | `UButton variant="link" color="secondary"` |
| `page-title` 20/28/600 | `text-xl font-semibold` |
| `section-title` 15/22/600 | `text-[15px] font-semibold` |
| 概览数字 | `text-2xl sm:text-3xl font-semibold tabular-nums` |
| `code` 等宽编号 | `font-mono text-xs text-muted` |
| `radius-lg` 卡片 | `rounded-lg border border-default` |
| `focus-ring` | 可点击卡片与行：`focus-visible:outline-2 focus-visible:outline-(--ui-secondary)`，偏移 2px |

业务状态徽标一律与文字同时出现（`UBadge`）：

| 类别 | 值 → 颜色 |
| --- | --- |
| 工作项 | 规划中 `neutral`、待办 `info`、执行中 `primary`、确认中 `warning`、已完成 `success` |
| 项目生命周期 | 草稿/已暂停/已归档 `neutral`、立项审批中 `warning`、进行中 `primary`、已完成 `success` |

截止日为今天或已逾期时用 `text-error`，并写明「今天」或「逾期 m/d」。

## 6. 交互与可访问性

- 整行、整卡可点击时，用 `NuxtLink` 包住整行或整卡，不用 `div @click`。
- 页签用 `UTabs`（`:content="false"`），带 `aria-label`。各区块用 `section` + `aria-labelledby` 指向其 `h2`。
- 未读圆点同时写「未读/已读」文字，不只靠颜色区分。
- 快捷按钮与磁贴点击目标 ≥ 44px（窄屏）；不使用原生 `confirm/alert/prompt`。
- 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前 / m/d。日期与周次取浏览器本地时区。

## 7. 扩展准则

新增工作台区块前逐条确认：

1. 有已授权的导航入口作为显示前提，数据源是现有 Host 路由或 Foundation composable。
2. 只读、只聚合；办理、审批、编辑一律跳回原业务页。
3. 数字写清口径与时间范围；分页未取全时标 `N+`。
4. 具备加载、失败、空、无权四态，失败只影响本块。
5. 桌面放入主栏或侧栏之一，窄屏在第 2 节的顺序里给出位置。
6. 纯函数放 `app/utils/workbench.ts` 并补单测；页面合同断言补到 `test/workbench.test.mjs`。

## 8. 已知限制与后续

- **项目进度条**：设计画布中有进度条，实现暂不展示。项目列表没有进度字段，逐个项目请求会放大工作台首屏开销；待项目列表提供进度或里程碑摘要后再加。
- **本周工时目标**：尚无租户级标准工时配置，卡片只显示已填小时数，不显示「/ 40」。配置落地后再加目标与差额提示。
- **审批总数**：Workflow 待办接口只有分页，没有总数，因此显示 `N+`。
- **通知**：列表项暂不跳转详情；通知详情深链接属于通知模块后续项，完成后改为可点击行。
- **菜单结构**：导航规范 §3.1 规划的「今日工作 / 审批办理 / 个人事务 / 日常协作」三级菜单尚未全部注册。工作台首页不依赖它们，注册后「常用入口」会自动出现相应入口。

## 9. 验收清单

- 1440×900 与 390×844 各检查一次：
  - 无文字溢出、元素重叠或页面级横向滚动；
  - 控制台无错误；
  - 各块的请求路径与状态码符合第 3 节，无权块不产生请求。
- 用无 Aims 权限的账号（如 C000001 的 `test`）确认我的工作、项目、工时三块不渲染且无 403 请求，审批与通知正常。
- 空库账号确认各块空态文案；断开一块数据源时，确认只有该块显示失败提示。
