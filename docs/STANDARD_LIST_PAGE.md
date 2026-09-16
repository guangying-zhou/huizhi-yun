# 标准列表页约定

> 适用范围：继承 `@hzy/foundation` 的服务端列表页。卡片看板、树编辑器、配置驱动台账等特殊页面可保留业务差异，但必须遵守搜索、分页、加载、空状态和错误反馈底线。

## 四段式信息结构

1. **页头**：`usePageTitle()` 声明标题，`usePageActions()` 把刷新注册到统一 Layout；页面内不重复放刷新按钮。
2. **摘要（可选）**：只展示服务端全量统计；若数据来自当前页，标题必须明确写“当前页”。
3. **筛选与主操作**：搜索在前、结构化筛选居中、重置和创建入口在后；筛选项超过 2 个必须提供“重置”。
4. **结果区**：页内错误 Alert、带 loading/empty 的表格、底部“共 N 条”与分页。

## 状态与请求

- 使用 `useListPage({ filters, defaults, pageSize })` 管理页码、筛选重置和 URL query。返回列表时应恢复原页码与筛选。
- 服务端搜索必须组合 `useDebouncedSearch()`：输入框绑定 `search`，请求绑定 `debounced`，回车调用 `flush`。
- 请求必须发送 `page`、`pageSize`；响应至少返回 `items`、`total`。筛选变化必须回到第 1 页。
- 客户端小字典过滤不使用服务端分页或防抖。
- 存在客户端合计时，不得直接分页；先让服务端返回全量合计或摘要。

```ts
const { search, debounced, flush, reset: resetSearch } = useDebouncedSearch()
const status = ref('active')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, status },
  defaults: { search: '', status: 'active' }
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debounced.value || undefined,
  status: status.value
}))

function resetFilters() {
  resetSearch()
  resetListFilters()
}
```

## 反馈与操作

- `UTable` 必须传 `:loading`，并用 `#empty` + `CommonEmptyState` 给出原因和下一步。
- 页面级加载失败使用 `useApiErrorAlert()` + 页内 `UAlert`；保存、删除等动作失败用带具体原因的 toast。
- 删除、禁用、覆盖使用 `useConfirm()`；不可逆操作为 `danger`，可恢复操作为 `warning`。
- 整行可点击时增加 hover/焦点视觉提示，并保留键盘可达入口；纯图标按钮必须有 tooltip 或可访问名称。
- Toast 句式：成功用“已 + 动词 + 对象”，失败用“动词 + 失败 + 原因”。

## 创建与编辑入口

- 不超过 6 个相互独立字段的轻量对象使用 `UModal` 或 `USlideover`，避免把表单长期展开在列表结果区。
- 7–8 个字段但仍为单步录入的配置对象，优先使用宽 Slideover；字段应在 390px 单列、宽屏最多两列。
- 存在步骤依赖、子表明细、实时金额汇总、审批预检或离开前草稿保护的复杂对象使用独立页面。
- 创建成功后关闭入口、刷新列表并保留筛选上下文；校验/提交失败在入口内部展示具体原因，不得只显示笼统 toast。
- 编辑入口应复用同一表单模型；只读业务键必须禁用，不能通过隐藏字段暗中修改。

## 响应式验收

合入前在真实浏览器检查 1440px 与 390px：筛选换行、表格横向滚动、分页不溢出、按钮不重叠、空状态不挤压，并确认浏览器控制台无新增错误。
