# 汇智云八应用 UI/UX 评审报告

> 范围：aims / altoc / assets / people / finance / codocs / console / workflow ｜ 方法：源码静态走查（约 200 个页面文件）｜ 首评 2026-07-10（五应用），2026-07-12 扩展 codocs/console/workflow 并同步 P0 落地状态
>
> 评审维度：界面一致性、操作便利性、交互友好性。所有数字均来自代码检索，可复核。
>
> 交互规范已固化到根 `CLAUDE.md`「列表页与交互规范」；本报告保留完整背景、证据与路线。

## P0 落地状态（2026-07-12）

首评提出的四项 P0 已全部完成并通过各模块 lint / typecheck：

1. **useConfirm 统一确认弹窗**：Foundation 新增 `useConfirm()` + `ConfirmDialog`，替换全仓 22 处原生 `confirm()`（aims 7、altoc 6、console 5、insights 2、platform 2；insights/platform 使用本地副本）。全仓（除 account）现为 0 处原生 confirm。
2. **useDebouncedSearch 搜索防抖**：Foundation 新增 `useDebouncedSearch()`（300ms 防抖 + 回车 flush + 关键字变化重置页码），31 个文件接入（altoc 7、assets 11、people 6、aims 2、console 2、codocs 2、finance 以 `watchDebounced` 等效处理）。
3. **列表分页**：people 3 页、assets 10 页补齐 `UPagination`；people 员工列表移除 500 条硬编码。顺带修复 assets 列表只显示前 20 条却无翻页控件的数据可见性 bug。
4. **loading + 空状态**：people 8 个列表页补 `:loading`；`EmptyState` 上移 Foundation（`CommonEmptyState`），people 8 页 + assets 10 页接入 `#empty` 空状态。

## P1 首轮落地状态（2026-07-12）

本轮已完成 P1 中边界清晰、可验证的共享基础与最高优先级缺口：

1. **Console 目录真分页**：users/projects 查询在显式 `page/pageSize` 时执行筛选后 `COUNT + LIMIT/OFFSET`，响应返回 `total/page/pageSize`；未传分页参数时保留同步/兼容调用的全量语义。两个管理页接入 `UPagination`、“共 N 条”、筛选重置、回车搜索、统一页头刷新和 `CommonEmptyState`。
2. **标准列表能力**：Foundation 新增 `useListPage()`，统一页码、筛选重置、筛选变化回到第 1 页及 URL query 双向同步；新增 `docs/STANDARD_LIST_PAGE.md` 四段式页面约定，Console 两页作为首批接入样板。
3. **页面级错误反馈**：Foundation 新增 `useApiErrorAlert()` / `resolveApiErrorAlert()`，统一权限、Console 授权服务、tenant-runtime 和普通加载错误的页内 Alert 模型，并对错误消息中的 URL 做隐藏；Console 两页已接入。
4. **格式化事实源**：Foundation 新增 `formatDate / formatDateTime / formatMoney`，统一中文默认格式、人民币两位小数和空值 `-`。存量页面仍按模块渐进替换。
5. **冗余覆盖清理**：删除 Workflow 与 Foundation 字节级一致的本地 `usePageActions.ts`，Workflow 直接消费共享实现。

第二批继续完成：

6. **页头全量迁移**：altoc/assets/people Layout 已改为共享标题/刷新优先、旧 Teleport 仅保留复合业务动作；三个模块页面标题 Teleport 均已清零，People 13 页、Assets 26 页、Altoc 14 个有刷新需求的页面统一接入 `usePageActions`。详情/表单页原先混在标题里的返回图标改为带文字的复合动作按钮。`usePageTitle` 同步补上卸载清理，避免跨页残留标题。
7. **行操作可发现性**：Foundation 新增 `selectableTableUi`，在 Nuxt UI 原有 selectable hover/focus 基础上补指针光标；Assets、People、Codocs、Workflow 的典型整行点击列表已接入。Altoc 列表的查看/编辑/删除/更多图标按钮补齐 `title + aria-label`。
8. **组件副本全部收敛**：删除 Codocs `AppLauncher/DeptTreeSelector`，删除 Altoc/Assets 的 `AppLauncher/UserMenu/DeptTreeSelector`，删除 Aims/Altoc/Assets/Workflow 四份无引用 `SidebarHoverMenu`。上述模块直接使用 Foundation 事实源。
9. **空状态补齐**：Codocs、Console、Workflow 所有包含 `UTable` 的文件均已有 `#empty`；Codocs 旧 `DocumentList` 同步迁移到 Nuxt UI v4 `data/accessorKey/header/#*-cell` API，并移除仅 `console.log` 的假删除入口。
10. **格式化首批迁移**：Altoc 合同、商机、报价、回款四个核心列表，以及合同新建/详情、客户详情、商机详情、报价详情、回款详情、投标详情与线索转商机组件，已移除页面内重复 `formatMoney`，改用 Foundation 统一人民币格式；首页/看板的“万元”紧凑展示作为场景化格式保留。Workflow 7 页、Console 2 页及 Codocs 9 个通用时间戳页面/组件同步删除重复日期 helper，统一使用 Foundation `formatDateTime`；日报、周报、工作日志和“今天/昨天”等业务日期语义保留本地格式。
11. **Finance catch-all 领域拆分**：银行账户域拆出图表工具、资金变动总览和余额快照 Slideover；发票域拆出文件预览、开票责任/确认开票，以及核销/冲红/删除组件；项目核算同步与报表导出拆为独立 composable；28 个路由页面配置迁入 `app/config/pageConfigs.ts`。新增 15 个 focused tests，catch-all 页面由当前工作树的 3991 行降至 1594 行。
12. **创建入口规范落地**：根 `CLAUDE.md` 与 `docs/STANDARD_LIST_PAGE.md` 已明确“≤6 字段 Modal/Slideover、7–8 字段单步对象宽 Slideover、复杂多步骤对象独立页面”；Finance 原页内展开式配置表单已迁入统一右侧 Slideover，并在 390px 单列、宽屏两列展示。

验证结果：Foundation lint、针对性测试、typecheck 通过；Console 分页相关 lint、2 个契约测试、typecheck 通过；Altoc、Assets、People、Codocs、Workflow scoped lint/typecheck 通过；Finance catch-all 拆分 lint、15 个 focused tests、typecheck 通过。真实浏览器已验证外部入口可进入企业 SSO，但测试会话无登录态；本地 Finance 服务可启动，内置浏览器的 URL 安全策略不允许读取 `127.0.0.1` 页面，因此尚未完成受保护页面的 1440px / 390px 视觉验收。

尚待后续批次：登录态下的双视口视觉验收。

## 总体结论

八个应用横向看，体验成熟度分三档：

- **规范执行较好**：workflow（搜索回车触发、有分页、表格全带 loading）、codocs（分页覆盖好、layout 统一刷新、表格全带 loading）、console（标题标准化、错误 Alert 覆盖最高、组件层最干净）。
- **P0 后已达标**：altoc、assets、people、finance 的列表核心交互（确认弹窗、防抖、分页、loading/空状态）已统一。
- **仍有结构性负债**：组件副本漂移（codocs 的 AppLauncher/DeptTreeSelector、四份 SidebarHoverMenu、workflow 的 usePageActions 冗余副本）、console 目录列表服务端不分页、页头/刷新模式仍是三种并存。

问题的根源仍然是：**好做法散落在各模块，没有及时沉淀为 Foundation 标准**。P0 已把四类核心交互收口；剩余工作集中在页头模式统一、组件副本收敛和 console 服务端分页。

## 八模块列表页范式对比

以各模块最典型的列表页为样本。标注（P0✔）表示该项由 P0 改造统一：

| 模块 | 样本页 | 筛选形式 | 搜索触发 | 分页 | 行级操作 | 创建入口 | 空状态 | 删除确认 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Aims | 项目总览 | 顶部粘性筛选条 + 视图切换 | 防抖（P0✔） | ⚠️ 无，预取 500 条客户端筛选 | 卡片内按钮 | Modal | ✅ CommonEmptyState | ✅ useConfirm（P0✔） |
| Altoc | 客户列表 | 工具栏 + 重置按钮 | 防抖 + 回车 flush（P0✔） | ✅ UPagination | 行内图标按钮，无 tooltip | 独立 new 页面 | ✅ 自定义 + CTA | ✅ useConfirm（P0✔） |
| Assets | 实物资产 | 指标卡 + 按钮组 | 防抖（P0✔） | ✅ UPagination（P0✔） | 整行点击，无视觉提示 | Slideover / Modal | ✅ CommonEmptyState（P0✔） | ✅ UModal |
| People | 员工列表 | 卡片筛选 | 防抖（P0✔） | ✅ UPagination（P0✔） | 整行点击 | —（目录同步） | ✅ CommonEmptyState（P0✔） | — |
| Finance | 台账页 | 页内自绘（3815 行 catch-all） | 防抖（P0✔） | UPagination（部分） | 按配置生成 | 行内配置字段 / Modal | 文案标题 | ✅ 无原生 confirm |
| Codocs | 文档列表 | 类型筛选 + 搜索 | 防抖（P0✔） | ✅ UPagination（4 处） | 行点击跳详情 | 按钮直建 + 跳转 | 部分自定义 | ✅ 无原生 confirm |
| Console | 目录用户 | 卡片筛选 + 搜索 | 防抖（P0✔） | ⚠️ 无，且服务端 API 不分页 | Modal 编辑 | Modal | UTable 默认 | ✅ useConfirm（P0✔） |
| Workflow | 流程定义 | 工具栏 + 搜索 | ✅ 回车触发（原生正确） | ✅ UPagination | 行内按钮 | Modal | UTable 默认 | ✅ 无原生 confirm |

## 维度一：界面一致性

### C1（高）列表页范式并存 → P0 后收敛为"交互统一、布局仍异"

P0 统一了确认弹窗、搜索、分页、loading/空状态四类核心交互；但筛选栏位置（工具栏 / 卡片内 / 粘性条 / 指标卡）、行级操作（图标按钮 / 整行点击 / 卡片按钮）、创建入口（独立页 / Modal / Slideover / 直建跳转）仍各不相同。

**建议**（P1）：制定「标准列表页」文档约定 + `useListPage` composable（分页/筛选/URL 同步一体），新页面强制、存量渐进迁移。Aims 卡片/看板、Finance 配置驱动属合理差异。

### C2（中）页头与「刷新」三种模式并存——统一路径已明确

扩查后事实更清晰：Foundation 已提供 `usePageTitle` + `usePageActions`（layout 统一渲染刷新按钮），且 **finance、codocs、workflow 已在用**；altoc/assets/people 用 Teleport 挂载点 + 每页手放刷新按钮；console 只用了 `usePageTitle`（标题标准化，刷新仍各页自理）；aims 是 395 行自定义 layout。

**建议**（P1）：Teleport 阵营（altoc/assets/people）迁移到 Foundation `usePageTitle`/`usePageActions`；console 补 `usePageActions`；workflow 删除与 Foundation 完全一致的本地 `usePageActions.ts` 副本（diff 为零，可直接删）。

### C3（中）组件副本漂移——扩查后问题更大

除首评发现的 altoc/assets 副本外，扩查新增：

```text
foundation/AppLauncher.vue        65 行  ← 事实源
codocs/AppLauncher.vue            88 行  ← 已漂移 23 行
foundation/DeptTreeSelector.vue   89 行  ← 事实源
codocs/DeptTreeSelector.vue      101 行  ← 已漂移 12 行
SidebarHoverMenu.vue              aims / altoc / assets / workflow 四份副本（foundation 无）
workflow/usePageActions.ts        与 foundation 完全一致的冗余副本
```

**建议**（P2）：codocs 两组件的差异合并回 Foundation 后删副本；`SidebarHoverMenu` 上移 Foundation 收敛四份；workflow 冗余 composable 直接删除。

### C4（中）日期、金额格式化各写一套（未变）

People `usePeopleFormat`、Finance `formatMoney`、Altoc 原始字符串直出。**建议**（P1）：Foundation 提供 `formatDate / formatDateTime / formatMoney`（含空值占位约定）。

### C5（低）空状态覆盖仍不完整

P0 后 people/assets 主列表已统一 `CommonEmptyState`；aims/altoc 原本就好；**codocs 部分自定义、console/workflow 仍是 UTable 默认空态**。**建议**：随 P1 标准列表页约定补齐。

## 维度二：操作便利性

### O1（已修，P0✔）搜索行为不一致且全仓零防抖

`useDebouncedSearch` 已在 7 个模块 31 个文件落地；workflow 三个管理页原本就是回车触发（正确行为，未改动）。纯客户端过滤页面（console 字典页、people 标准成本页等）保持即时过滤，未加防抖。

### O2（已修，P0✔）+ 新发现 O2b（高）console 目录列表服务端不分页

assets/people 分页已补齐。但扩查发现 **console 目录用户/项目列表是全仓仅剩的无分页服务端列表，且缺口在服务端**：`console/server/api/v1/directory/users/index.get.ts` 不接受任何分页参数，全量返回；前端也无 `UPagination`。企业目录用户可达数百上千，数据增长后每次打开目录页都全量拉取。

**建议**（P1）：console 目录 users/projects API 增加 `page/pageSize/total`，前端接 `UPagination`。这是唯一需要动服务端的分页缺口（其余模块走 data-runtime 通用资源层，天然支持）。

### O3（中）筛选和页码不进 URL，返回即丢失（未变）

**建议**（P1）：`useListPage` 内置筛选/页码 ↔ URL query 双向同步。

### O4（中）「重置筛选」只有 Altoc 有（未变）

**建议**：纳入标准列表页约定——筛选控件超过 2 个必须提供重置。

### O5（低）行级操作缺少可发现性（未变）

整行可点无 hover 提示（assets/people/codocs）、图标按钮无 tooltip（altoc）。**建议**：随 P1 约定统一。

## 维度三：交互友好性

### F1（已修，P0✔）原生 confirm() 已全部替换

22 处替换完成，全仓（除 account）0 处残留。规范已入根 `CLAUDE.md`（危险操作必须 `useConfirm()`，禁止原生弹窗）。

### F2（中）接口错误反馈质量参差——console 是第二个正面样板

首评样板是 People（`usePeopleApiError` + 页内 UAlert）。扩查发现 **console 有 10/25 页使用页内 UAlert**，覆盖率全仓最高；workflow 仅 1 页、codocs 4 页，动作失败基本只有 toast。

**建议**（P1）：泛化为 Foundation `useApiErrorAlert`；约定「页面级加载失败用页内 Alert、动作失败用带原因的 toast」。

### F3（已修，P0✔）+ 亮点：三个扩查模块 loading 覆盖满分

people 8 个列表页已补 `:loading`。扩查确认 **codocs/console/workflow 的所有 UTable 本就全部传了 `:loading`**——全仓最佳，无需改动。

### F4（低）Toast 文案无规范（未变，范围扩大）

八模块约 150 个文件调用 `toast.add`，句式各异（codocs 一个模块就有 46 个文件）。**建议**：新代码执行「已 + 动词 + 对象」/「动词 + 失败 + 原因」句式，存量不回改。

### F5（低）Finance 3815 行 catch-all 是长期负债（未变）

**建议**（P2）：按业务域拆分，向标准列表页收敛。

## 各模块值得推广的做法（更新）

| 模块 | 做法 | 来源 |
| --- | --- | --- |
| People | 页内错误 Alert 模式 | `usePeopleApiError.ts` |
| Altoc | 空状态 CTA + 分页 + 重置筛选三件套 | `customers/index.vue` |
| Finance / Codocs / Workflow | layout 统一刷新（Foundation `usePageActions`） | `usePageActions` |
| Assets | 列表页指标卡 | `SummaryMetricGrid.vue` |
| Aims | EmptyState（已上移 Foundation）与多视图切换 | `CommonEmptyState` |
| Codocs / Console / Workflow | UTable `:loading` 全覆盖 | 全模块 |
| Console | `usePageTitle` 标题标准化 + UAlert 错误提示覆盖率最高 + 组件层零副本 | `directory/*.vue` |
| Workflow | 搜索回车触发（免防抖的正确实现） | `admin/flows.vue` |

## 改进路线（更新）

### P0 — ✅ 已全部完成（2026-07-10 ~ 07-12）

1. ✅ Foundation `useConfirm()`，替换 22 处原生 confirm。
2. ✅ Foundation `useDebouncedSearch`，31 个文件接入。
3. ✅ assets/people 列表补 UPagination，移除 500 条硬编码。
4. ✅ UTable 补 `:loading`；`CommonEmptyState` 上移 Foundation 并接入 18 个列表页。
5. ✅ 交互规范写入根 `CLAUDE.md`。

### P1 — ✅ 已全部完成（2026-07-12）

1. ✅ **Console 目录 users/projects 服务端分页**：API 已支持 `page/pageSize/total`，前端已接入 `UPagination`、总数、筛选重置与 URL 同步。
2. ✅ **「标准列表页」约定 + `useListPage`**：四段式布局、筛选重置、URL 同步已固化；Console 两页作为首批样板。
3. ✅ **页头统一**：Altoc、Assets、People 标题 Teleport 已清零并统一使用 Foundation `usePageTitle/usePageActions`；Console 已补统一刷新。
4. ✅ **Foundation 格式化 helper**：`formatDate/formatDateTime/formatMoney` 已落地，并完成 Altoc、Workflow、Console、Codocs 首批存量迁移。
5. ✅ **泛化 `useApiErrorAlert`**：Foundation 实现已落地，Console 目录两页已接入页内错误 Alert。
6. ✅ **行操作规范**：Foundation 已提供 `selectableTableUi`；典型整行点击列表已接入，Altoc 图标按钮已补 `title + aria-label`。

### P2 — 持续整治

1. ✅ **组件副本收敛**：Codocs、Altoc、Assets 的共享组件副本与四份无引用 SidebarHoverMenu 已删除；Workflow 冗余 `usePageActions.ts` 已删除。
2. ✅ **Finance catch-all 按业务域拆分**：银行账户、发票、项目核算、报表与静态页面配置均已抽离，catch-all 从 3991 行降至 1594 行并补 15 个 focused tests。
3. ✅ **创建入口规范**：规范已写入根开发约定和标准列表页文档；Finance 页内展开式创建表单已迁入统一 Slideover。
4. ✅ **codocs/console/workflow 空状态**：所有包含 `UTable` 的文件均已有 `#empty`。

## 评审方法与局限

本报告基于八个模块 `app/pages` 与 `app/components` 源码静态走查（约 200 个页面文件），核对了 Foundation 层现有能力与 data-runtime 分页契约。P0、P1 与列出的 P2 代码/规范改造均已通过对应模块 lint、typecheck 和 focused tests；真实浏览器双视口验收仍受企业 SSO 登录态与本地 URL 安全策略限制。account 模块（legacy）与 insights/platform（独立于 Foundation 的模块，P0-1 已同步修复）不在本轮列表范式评审范围内。
