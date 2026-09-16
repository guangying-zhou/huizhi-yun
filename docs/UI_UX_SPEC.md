# 汇智云 UI/UX 规范

> 状态：v1.0 生效 | 制定：2026-08-26 | 适用：全部继承 `@hzy/foundation` 的租户应用 + Platform 控制面
>
> **本文与既有文档的分工：**
>
> | 文档 | 职责 |
> | --- | --- |
> | **本文** | 平台级 UI/UX 约束：视觉基础、布局导航、页面范式、组件选用、反馈文案、格式化、响应式与落地机制 |
> | [`STANDARD_LIST_PAGE.md`](./STANDARD_LIST_PAGE.md) | 列表页的详细实现约定（本文 §5.1 直接引用，不重复） |
> | [`FOUNDATION_CAPABILITIES.md`](./FOUNDATION_CAPABILITIES.md) | Foundation 能力清单（本文 §6 引用其组件与 composable） |
> | [`UI_UX_REVIEW_2026-07-10.md`](./UI_UX_REVIEW_2026-07-10.md) | 2026-07 评审报告（历史快照，本文承接其 P2 未决项） |
> | 根 `CLAUDE.md` | 面向 AI 与开发者的强制红线摘要（本文是其展开） |

---

## 1. 核心判断：能力都在，但各写一套

2026-08-26 全仓实测。**几乎每项能力各模块都实现了，问题是各实现各的**——不是功能缺失，是一致性与维护成本问题。

| 能力 | Foundation 标准件 | 实际情况 |
| --- | --- | --- |
| 日期/金额格式化 | `foundation/app/utils/format.ts` | **0 个模块采用**；103 个文件各写一份本地 `formatDateTime` 等 |
| 列表页码/筛选 URL 同步 | `useListPage()` | 仅 console 3、workflow 3 采用；aims 7、altoc 6、people 3、assets 2、finance 1 个页面手写 `route.query` 操作 |
| 空状态 | `CommonEmptyState` | workflow 7/7、assets 11/27 采用；**altoc 13 个页面写了 `#empty` 但 0 处用共享组件** |
| 页面标题 | `usePageTitle()` + 路由 meta 回退 | 两套机制并存且**均受 Foundation 支持**，见 §4.2 |
| 统一刷新 | `usePageActions()` | 见下方「真实缺陷」 |

### 真实缺陷（非一致性问题，需要修）

| 缺陷 | 位置 | 说明 |
| --- | --- | --- |
| 🔴 `setRefresh` 死代码 | console 3 处、codocs 3 处 | 页面调用了 `usePageActions().setRefresh()`，但两个模块的 layout **从未把 `refresh-handler` 传给 `LayoutSidebar`**，刷新按钮根本不渲染。开发者以为接上了，实际没有。 |
| 🟠 页面内自绘刷新按钮 | aims 7 个页面 | 违反 §4.2；aims 未接入统一刷新机制，各页面自己放了 `i-lucide-refresh-cw` |

> `LayoutSidebar` 的 `refreshHandler` 是 **prop**，不是内部读取 `usePageActions()`。模块 layout 必须显式传入。当前只有 `finance` 传了（`:refresh-handler="refreshHandler || undefined"`）；altoc / assets / people / workflow 在自有 layout 里渲染，也有效。

**因此本规范的重点：**把已有标准件定为唯一合法写法（消除"各写一套"）+ 修掉上表两个真实缺陷 + 建立可度量基线（§10）。

## 2. 设计原则

1. **一致性优先于局部最优。** 同一个交互在九个应用里必须长得一样、行为一样。局部"更好看"的方案若与平台范式冲突，不采纳。
2. **服务端是安全边界，UI 只是可用性。** 隐藏按钮、禁用菜单从来不构成权限控制。前端隐藏必须与服务端拒绝一一对应，反之不成立。
3. **状态必须可见。** 加载、空、错误、无权限四种状态每个数据区都要有明确呈现，不允许"什么都不显示"。
4. **写给中国企业用户。** 中文优先、信息密度偏高、表格优于卡片、批量操作是刚需。参考飞书/Notion 的克制，不照搬其留白。

---

## 3. 视觉基础

### 3.1 语义色（强制）

**只允许使用 Nuxt UI 语义色**：`primary`、`secondary`、`success`、`warning`、`error`、`info`、`neutral`。

禁止：
- 组件 props 写原色名——`color="red"`、`color="green"`
- Tailwind 原色类——`text-red-500`、`bg-green-100`、`border-blue-300`
- 已废弃的 `color="gray"`（Nuxt UI v3 写法，v4 是 `neutral`）；全仓现有 `neutral` 1300 处、`gray` 仅 1 处残留

语义对应：

| 语义色 | 用途 |
| --- | --- |
| `primary` | 主操作、当前态、品牌强调 |
| `secondary` | 次级操作、辅助标识 |
| `success` | 成功结果、已完成、已核销、已通过 |
| `warning` | 可恢复的风险、待处理、即将到期、可撤销操作确认 |
| `error` | 失败、拒绝、逾期、**不可逆操作确认** |
| `info` | 中性提示、说明性信息 |
| `neutral` | 默认文本、边框、禁用态 |

**调色板基线（2026-08-26 实测）：**

| 范围 | primary | secondary | neutral |
| --- | --- | --- | --- |
| 全部租户应用 | `orange` | `blue` | `zinc` |
| Platform 控制面 | `sky` | `lime` | `slate` |

Platform 用不同调色板是**有意为之**——控制面面向平台运营，与租户业务界面要一眼可分。

**待收敛的 2 处漂移：**

| 模块 | 现状 | 应改为 |
| --- | --- | --- |
| `insights` | `neutral: 'slate'` | `zinc` |
| `webdev` | `secondary: 'slate'` | `blue` |
| `insights/app/components/App/Settings/PasskeyManager.vue:62` | `color="gray"`（v4 已废弃） | `color="neutral"` |

**待整改：** `codocs` 有 183 处 Tailwind 原色类（全仓唯一违规模块，最早的模块，历史遗留）。列入 §10.2 backlog。

> 注：PRD 架构图里每个模块用不同颜色，那是**图示配色**，与应用主题无关，不要相互套用。

### 3.2 暗色模式（强制）

- **依赖 Nuxt UI 语义 token**：`bg-default`、`bg-muted`、`bg-elevated`、`text-default`、`text-muted`、`text-dimmed`、`border-default`。
- **不手写 `dark:` 变体类。** 全仓当前仅 14 处，保持这个数字不增长。手写 `dark:` 意味着绕开了 token 体系，暗色下必然漂移。
- 颜色模式由 Foundation `color-mode-sync.client.ts` 跨应用同步，业务模块不自建切换器。

### 3.3 排版与间距

- 页面标题走 `usePageTitle()`，不在页面内写 `<h1>`（见 §4.2）。
- 区块标题 `text-base font-semibold`；正文 `text-sm`；辅助说明 `text-sm text-muted`；元信息 `text-xs text-dimmed`。
- 间距只用 4 的倍数（Tailwind `gap-2/3/4/6/8`）。卡片内边距 `p-4`，页面区块间距 `space-y-6`。
- 数字、编码、ID 用等宽字体（`font-mono`）——aims 的 `table.td` 已这么配置，可作参考。

### 3.4 图标

- 统一 `i-lucide-*`。同一语义全平台同一图标：刷新 `i-lucide-refresh-cw`、搜索 `i-lucide-search`、删除 `i-lucide-trash-2`、编辑 `i-lucide-pencil`、更多 `i-lucide-ellipsis-vertical`。
- 纯图标按钮必须有 `aria-label` 或 tooltip（见 §9.2）。

---

## 4. 布局与导航

### 4.1 应用外壳

- 跨应用切换**只能**走 Console `/shell/{appCode}` 企业 Shell + Foundation `useApplicationShell()`。
- 业务模块**禁止**自建 iframe 总入口、复制 `AppRail` / `AppLauncher`、信任未校验的 `postMessage`。
- 侧边栏统一用 Foundation `LayoutSidebar`；断点已在 `foundation/app/app.config.ts` 统一为 `sm`（640px）：`<640px` 抽屉、`≥640px` 常驻。模块不得覆盖该断点。

### 4.2 页头

**标题：两套机制，按标题是否动态选择。**Foundation `LayoutSidebar.vue` 已内置优先级链：

```ts
pageTitle = usePageTitle 的值
  || route.meta.layoutHeaderTitle
  || route.meta.title
  || ''
```

| 场景 | 用法 | 理由 |
| --- | --- | --- |
| **静态标题** | `definePageMeta({ layoutHeaderTitle: '回款计划' })` | 声明式；可沿路由树继承（父路由设默认值），适合深层嵌套 |
| **动态标题**（实体名、加载后才知道） | `usePageTitle(titleRef)` | 支持 `Ref<string>`，`definePageMeta` 结构上做不到 |

两者都由 Foundation 渲染，**不存在"哪个才是正确写法"**。aims 采用 meta 方式（37/44 页），console/codocs/finance 走 `LayoutSidebar` 的 `usePageTitle` 路径，altoc/assets/people/workflow 在自有 layout 里渲染 `usePageTitle`——都合法。

> 嵌套路由下 `route.meta` 响应性不可靠，若模块在自有 layout 里解析 meta，必须用 `router.afterEach` 主动同步（aims `default.vue:150` 是正确参考实现）。

**刷新：统一注册，不在页面内自绘。**

```ts
const { setRefresh } = usePageActions()
setRefresh(() => refresh())
```

模块 layout 必须把 `refreshHandler` 接出去，二选一：

- 走 `LayoutSidebar`：传 `:refresh-handler="refreshHandler || undefined"`（finance 的写法）
- 自有 layout：`v-if="refreshHandler"` 渲染按钮（altoc / assets / people / workflow 的写法）

**禁止：**页面内写 `<h1>` / `text-2xl font-bold` 自绘标题；页面内再放刷新按钮（Layout 已有）。

### 4.3 面包屑与返回

- 详情页必须能返回来源列表，且**保留原筛选与页码**（依赖 `useListPage` 的 URL 同步，见 §5.1）。
- 层级 ≥3 时提供面包屑；≤2 层用返回按钮即可。

---

## 5. 页面范式

### 5.1 列表页

**完整约定见 [`STANDARD_LIST_PAGE.md`](./STANDARD_LIST_PAGE.md)，本文不重复。**底线摘要：

- 四段式结构：页头 → 摘要（可选）→ 筛选与主操作 → 结果区
- `useListPage()` 管页码/筛选/URL 同步；`useDebouncedSearch()` 管服务端搜索
- 真实服务端分页 + 「共 N 条」；筛选变化重置到第 1 页
- `UTable` 必传 `:loading`；`#empty` 用 `CommonEmptyState`
- 筛选项 >2 个必须有「重置」

### 5.2 详情页

- **首屏三段：** 标题与状态徽章 → 关键字段摘要（≤8 项，网格布局）→ 分区内容（Tab 或锚点分区）。
- 状态用语义色徽章，与列表页同一套映射，不允许两处颜色不一致。
- **相关业务对象用跳转，不复制数据。**例：合同详情展示交付项目名称+链接，不复制项目字段。
- 操作按钮按危险度排列：主操作 `primary` 在右，危险操作放「更多」菜单内并二次确认。
- 审批类对象统一用 Foundation `WorkflowPanel` / `WorkflowTimeline` / `WorkflowBadge`，不自绘审批状态条。

### 5.3 表单与录入

入口选择（沿用 `STANDARD_LIST_PAGE.md` §创建与编辑入口）：

| 字段规模 | 入口 |
| --- | --- |
| ≤6 个独立字段 | `UModal` 或 `USlideover` |
| 7–8 个单步字段 | 宽 `USlideover` |
| 有步骤依赖 / 子表 / 实时汇总 / 审批预检 | 独立页面 |

补充约束：

- 校验失败在**字段级**提示，不只给一个笼统 toast。
- 提交中禁用提交按钮并显示 loading，防重复提交。
- 只读业务键（`project_code`、合同编码等）必须 `disabled`，不得用隐藏字段暗中提交。
- 金额输入右对齐、千分位显示、明确币种；比率明确百分号。
- 独立页面表单离开前有草稿保护提示。

### 5.4 仪表盘与看板

- 指标卡必须标明口径与时间范围。**数据来自当前页时，标题必须写「当前页」**——这是已发生过的误读来源。
- 图表配色只用语义色 + `neutral` 梯度，不引入第三方配色。
- 每个卡片能下钻到对应列表页，并带上对应筛选参数。
- 空数据显示 `CommonEmptyState` 而非空白图表。

---

## 6. 组件使用规约

### 6.1 选用表（Foundation 已有则必须用）

| 场景 | 必须使用 | 位置 |
| --- | --- | --- |
| 危险操作确认 | `useConfirm()` | `foundation/app/composables/useConfirm.ts` |
| 空状态 | `CommonEmptyState` | `foundation/app/components/common/EmptyState.vue` |
| 页面加载错误 | `useApiErrorAlert()` + `UAlert` | — |
| 服务端搜索 | `useDebouncedSearch()` | — |
| 列表页码/筛选 | `useListPage()` | — |
| 页面标题 / 刷新 | `usePageTitle()` / `usePageActions()` | — |
| 部门选择 | `DeptTreeSelector` | — |
| 人员选择 | `UserTreeSelector` | — |
| Git 仓库/群组选择 | `GitGroupTreeSelector` | — |
| 审批面板 / 时间线 / 徽章 | `WorkflowPanel` / `WorkflowTimeline` / `WorkflowBadge` | — |
| 通知铃铛 / 抽屉 | `NotificationBell` / `NotificationsSlideover` | — |
| 应用切换 / 用户菜单 | `AppLauncher` / `AppRail` / `UserMenu` | — |
| 问题反馈 | `IssueReporter` / `useIssueReporter()` | — |
| 文档编辑 / 预览 | `CodocsEditor` / `CodocsPreview` | — |

### 6.2 禁止复制副本（强制）

**不得把 Foundation 组件复制到业务模块内维护。**这是 2026-07 评审的 C3 项，扩查后发现问题比预估更大。

发现 Foundation 能力不足时的正确顺序：

1. 先在 Foundation 扩展（加 prop / slot / 变体）
2. 同步更新 [`FOUNDATION_CAPABILITIES.md`](./FOUNDATION_CAPABILITIES.md)
3. 再在业务模块使用

### 6.3 原生对话禁令

禁止 `confirm()` / `alert()` / `prompt()`。全部走 `useConfirm()`：不可逆操作 `tone: 'danger'`，可恢复操作 `tone: 'warning'`，文案必须含对象名与后果说明。

---

## 7. 状态与反馈

### 7.1 四种状态必须都有

| 状态 | 呈现 |
| --- | --- |
| 加载中 | 表格传 `:loading`；卡片区用骨架屏；按钮内联 loading |
| 空 | `CommonEmptyState`：图标 + 说明 + （首屏场景）下一步 CTA |
| 错误 | 页面级用 `useApiErrorAlert()` + 页内 `UAlert`；动作级用带原因的 toast |
| 无权限 | 明确说明缺少什么权限、找谁申请，**不显示成空列表** |

「无权限显示成空列表」是最容易掩盖真实问题的反模式——用户以为没数据，实际是授权缺失。

### 7.2 Toast 文案规范

| 类型 | 句式 | 示例 |
| --- | --- | --- |
| 成功 | 已 + 动词 + 对象 | 「已保存回款计划」 |
| 失败 | 动词 + 失败 + **具体原因** | 「保存失败：合同编码已存在」 |
| 警告 | 陈述影响 | 「部分记录未导入：3 条缺少项目编码」 |

约束：

- 失败 toast **必须带原因**。「操作失败」「保存失败，请重试」不合格。
- 后端已给出可读错误码/消息时，优先透出，不要覆盖成通用文案。
- 成功 toast 3 秒自动消失；失败 toast 需手动关闭。
- 同一操作只弹一个 toast，不叠加。
- 页面级加载失败用 Alert 不用 toast（toast 会消失，用户失去上下文）。

### 7.3 错误语义与 HTTP 状态

前端呈现必须与服务端语义一致：

| 状态 | 含义 | 前端呈现 |
| --- | --- | --- |
| `401` | 未认证 | 跳登录流程 |
| `403` | 已认证但无权限 | 明确的无权限说明（§7.1） |
| `409` | 业务冲突 | 具体冲突原因 + 修改建议 |
| `503` | 依赖不可用 | 「服务暂时不可用，请稍后重试」+ 重试按钮 |

**不得把 4xx 业务错误呈现成「系统错误」。**已发生过：唯一键冲突被转成 503，用户以为系统坏了。

---

## 8. 数据格式化（当前采用率 0，强制整改）

**唯一合法来源：`foundation/app/utils/format.ts`**

```ts
import { formatDate, formatDateTime, formatMoney } from '#imports'
```

| 数据 | 函数 | 展示 |
| --- | --- | --- |
| 日期 | `formatDate()` | `2026-08-26` |
| 日期时间 | `formatDateTime()` | `2026-08-26 14:30` |
| 金额 | `formatMoney()` | 千分位 + 明确币种，右对齐 |

禁止在业务模块内新写 `toLocaleDateString`、`Intl.NumberFormat`、自定义 `formatCurrency`。

**现状：103 个文件各写一套**（codocs 33、insights 26、aims 21、workflow 8、console 6、altoc 5、finance 2、assets 1、people 1）。整改按 §10.2 顺序推进，新代码即刻生效。

其他约定：

- 空值统一显示 `—`（em dash），不显示 `null` / `undefined` / 空字符串。
- 百分比保留 1 位小数；金额保留 2 位。
- 相对时间只用于 7 天内（「3 小时前」），超过则显示绝对日期。

---

## 9. 响应式与可访问性

### 9.1 响应式

- 验收视口固定两个：**1440px** 与 **390px**。
- 390px 下：表格横向滚动（外层 `overflow-x-auto`），表单单列，筛选换行不重叠，分页不溢出。
- 宽屏表单最多两列。
- 移动端优先保障：审批、通知、任务查看三类高频场景。

### 9.2 可访问性

- 纯图标按钮必须有 `aria-label` 或 tooltip。
- 整行可点击时保留键盘可达入口，并有 hover / focus 视觉反馈。
- 表单控件与 `label` 正确关联。
- 不用颜色作为唯一信息载体——状态徽章必须带文字。
- 模态框内焦点收敛，`Esc` 可关闭。

---

## 10. 落地机制

### 10.1 采用率基线（2026-08-26）

后续每次评审重测此表。**数字含义是「用共享标准件」，不是「有没有这个能力」**——多数模块两者都有，只是用了本地实现。

| 模块 | 页面≈ | 页面标题机制 | 统一刷新 | 列表 URL 同步 | 空状态 |
| --- | --- | --- | --- | --- | --- |
| aims | 44 | 37（meta 方式） | ❌ 未接入，7 页自绘按钮 | 7 页手写 query | 3 用共享组件 |
| altoc | 34 | 30（`usePageTitle`） | ✅ 自有 layout | 6 页手写 query | 13 页 `#empty`，**0 用共享组件** |
| assets | 43 | 31 | ✅ 自有 layout（29 处注册） | 2 页手写 query | 11 / 27 |
| finance | 11 | 7 | ✅ `LayoutSidebar` prop | 1 页手写 query | 1 / 2 |
| people | 19 | 14 | ✅ 自有 layout（13 处注册） | 3 页手写 query | 8 / 11 |
| codocs | 55 | 32 | 🔴 **3 处 setRefresh 死代码** | 4 页手写 query | 4 / 4 |
| console | 43 | 24 | 🔴 **3 处 setRefresh 死代码** | ✅ 3 处 `useListPage` | 10 / 9 |
| workflow | 13 | 11 | ✅ 自有 layout | ✅ 3 处 `useListPage` | 7 / 7 |

格式化工具（`formatDate` / `formatDateTime` / `formatMoney`）采用率：**全部模块 0**，103 个文件各写一份本地实现（codocs 33、insights 26、aims 21、workflow 8、console 6、altoc 5、finance 2、assets 1、people 1）。

### 10.2 整改 backlog

| 优先级 | 内容 | 性质 | 理由 |
| --- | --- | --- | --- |
| 🔴 P0 | **console / codocs 接上 `refresh-handler`** | 真实缺陷 | 6 处 `setRefresh` 是死代码，刷新按钮从不渲染。改动极小（layout 传一个 prop） |
| 🟠 P1 | **aims 接入统一刷新，移除 7 页自绘按钮** | 规范违反 | 9 月全员推开，刷新位置不一致会被直接感知 |
| 🟠 P1 | **全模块迁移到 Foundation 格式化函数** | 一致性 | 103 份本地实现；金额/日期显示不一致在财务场景是信任问题 |
| 🟡 P2 | altoc 13 处 `#empty` 换成 `CommonEmptyState` | 一致性 | 已有空状态，只是各写各的 |
| 🟡 P2 | 列表页手写 `route.query` 迁移到 `useListPage` | 一致性 | 19 个页面手写，行为易漂移 |
| 🟡 P2 | aims 6 个动态标题详情页补 `usePageTitle` | 补全 | `portfolios/[id]`、`projects/[id]/members`、`milestones/[milestoneId]` 等，`definePageMeta` 静态做不到；其中带项目切换器的页面可能本就不需要标题，逐页判断 |
| 🟡 P2 | codocs 183 处 Tailwind 原色类改语义色 | 一致性 | 暗色模式下必然漂移 |
| ⚪ P3 | insights `neutral`、webdev `secondary` 调色板归位；1 处 `color="gray"` | 一致性 | 影响面小 |

**执行方式：不设专项整改周。**除 P0（改动极小，可立即做）外，其余在双月计划的既有工作流里顺带完成——改到哪个页面就把那个页面按规范收口，避免与 9/10 月业务目标争抢时间。

### 10.3 新页面自检清单

合入前逐项确认：

- [ ] `usePageTitle()` 声明标题，页面内无自绘 `<h1>`、无重复刷新按钮
- [ ] 列表页用 `useListPage()` + `useDebouncedSearch()`，真实服务端分页 + 「共 N 条」
- [ ] `UTable` 传 `:loading`，`#empty` 用 `CommonEmptyState`
- [ ] 加载 / 空 / 错误 / 无权限四态齐全，无权限不显示成空列表
- [ ] 危险操作用 `useConfirm()`，无原生 `confirm/alert/prompt`
- [ ] 失败 toast 带具体原因
- [ ] 日期金额走 Foundation 格式化函数
- [ ] 只用语义色，无原色名与 `dark:` 手写变体
- [ ] Foundation 已有的组件没有另写一份
- [ ] 真实浏览器验过 1440px 与 390px，控制台零报错

### 10.4 本文档如何演进

- 新增或修改 Foundation 组件/composable 时，同步更新 §6.1 选用表与 [`FOUNDATION_CAPABILITIES.md`](./FOUNDATION_CAPABILITIES.md)。
- 每次 UI/UX 评审后重测 §10.1 基线并更新 §10.2 backlog。
- 与既有约定冲突时，以本文为准，并同步修订根 `CLAUDE.md` 摘要与 `STANDARD_LIST_PAGE.md`。
- 修订记录追加在下方。

### 修订记录

- 2026-08-26：v1.0 初版。基于全仓实测数据建立采用率基线与整改 backlog。
- 2026-08-26：v1.1 修正初版三处误判。初版按「是否调用某个共享函数名」统计，把
  「用了本地实现」误报为「缺少该能力」：
  1. **页面标题**：aims 用 `definePageMeta({ layoutHeaderTitle })`，覆盖 37/44 页，
     且 `LayoutSidebar.vue:484` 本就支持该回退路径。两套机制均合法，改为按
     「标题是否动态」选择（§4.2）。
  2. **空状态**：altoc 有 13 个页面写了 `#empty`，并非没有空状态，只是未用共享
     组件。从 P0 降为 P2 一致性问题。
  3. **URL 同步**：多数模块手写 `route.query`（aims 7、altoc 6 等），同样是
     「各写一套」而非缺失。
  同时查实两个**真实缺陷**并列为 P0/P1：console 3 处 + codocs 3 处 `setRefresh`
  为死代码（layout 未把 `refresh-handler` 传给 `LayoutSidebar`）；aims 未接入
  统一刷新且 7 个页面自绘刷新按钮。
