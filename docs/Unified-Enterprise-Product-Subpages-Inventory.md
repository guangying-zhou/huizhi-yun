# Aims 产品未登记子页盘点（W1-B，2026-09-23）

基线为 W1-B 开始时 `aims/app/pages/products/[productCode]/` 中未在 `aims/layer/entry.mjs` 登记的 **48 页**。源页和直接渲染的业务组件均已核对。下表 `P` = `/api/v1/products/:productCode`，`C` = `P/planning-cycles/:cycleId`，`I` = `C/items/:itemId`，`Q` = `P/planning-items/:itemId`，`R` = `P/roadmaps`，`O` = `P/objectives/:objectiveId`；`GET` 为未显式传 method 的读取，`POST/PATCH/DELETE` 为可达操作。组件列只列业务组件与关键 composable，基础 UI 和 `useRoute` 省略。人员权限均来自 `aims/app.manifest.json`；名称带连字符的 `product-*` 是内部服务资源，不能当作人员导航授权。写入口的人员动作需按具体操作再复核。

`已有`表示 Foundation 的 `enterpriseRuntimeClient.ts` 有精确操作且 Host BFF 可复用；`缺`表示源页接口尚无等价 Enterprise Runtime 操作。部分只读源页仍有通往写流程的链接，因此“只读”指页面自身请求，不代表整个链接闭包可迁。本批 Host 专页不暴露这些链接。

## cycles（23 页）

| 源页 | 组件 / composable；METHOD + API | 人员权限；Runtime 缺口 | 可达写动作；只读判断 / 批次 |
| --- | --- | --- | --- |
| `cycles/index.vue` | `ProductsVersionTools`、`ProductsPlanningCycleReviews/Detail`、`useDebouncedSearch`、`useListPage`；GET `P/planning-cycles`、`P/planning-cycles/permissions`；弹窗再 GET `C/reviews`、`C` | `product_priorities:view`；列表已有 `aims.feature-cycles`，权限/详情/复评缺 | 新增、编辑、开放、关闭、复评及候选入口；只读为主。本批仅 Host 列表、状态、容量和分页，去掉弹窗与写入口；详情后批 |
| `cycles/new.vue` | `ProductsPlanningCycleForm`、`useFetch`；GET `P/planning-cycles/permissions`；POST `P/planning-cycles` | `product_priorities:edit`；缺创建操作 | 创建周期；写流程后批 |
| `cycles/[cycleId]/edit.vue` | `ProductsPlanningCycleForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；PATCH `C` | `product_priorities:edit`；缺详情/更新 | 修改草案；写流程后批 |
| `cycles/[cycleId]/open.vue` | `ProductsPlanningCycleOpenForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；POST `C/open` | `product_priorities:prioritize`；缺详情/开放 | 开放周期；写流程后批 |
| `cycles/[cycleId]/close.vue` | `ProductsPlanningCycleOpenForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；POST `C/close` | `product_priorities:prioritize`；缺详情/关闭 | 关闭周期；写流程后批 |
| `cycles/[cycleId]/review.vue` | `ProductsPlanningCycleReviewForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；POST `C/review` | `product_priorities:prioritize`；缺详情/复评 | 记录复评；写流程后批 |
| `cycles/[cycleId]/budget.vue` | `ProductsPlanningBudgetForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；POST `C/budget-preview`、`C/budget` | `product_priorities:prioritize`；缺详情/预算操作 | 预算预览和提交；写流程后批 |
| `cycles/[cycleId]/capacity.vue` | `CommonEmptyState`、`usePageActions`；GET `C/capacity` | `product_priorities:view`；缺容量读取 | 无直接写请求，但可跳预算；只读，待读取操作后批 |
| `cycles/[cycleId]/model.vue` | `useAsyncData`、`useFetch`；GET `P/priority-models/permissions`、`C`、`P/priority-models/list`；POST `P/priority-models/cycles/:cycleId` | 读 `product_priorities:view`；源 handler 写用 `product_priorities:admin`，但 manifest 未声明 `admin`；缺模型与周期详情/绑定 | 选用模型；写流程后批，权限动作需 Claude 复核 |
| `cycles/[cycleId]/matrix.vue` | `CommonEmptyState`、`useDebouncedSearch`；GET `C/matrix` | `product_priorities:view`；缺矩阵读取 | 无直接写请求，通往评估；只读，待操作后批 |
| `cycles/[cycleId]/roadmap.vue` | `ProductsSaveRoadmapView`、`useFetch`；GET `R/quarter`、`R/views/permissions`；POST `R/views/create` | `product_roadmaps:view`，保存需 `product_roadmaps:edit`；缺季度读取/保存 | 保存视图；读写混合后批 |
| `cycles/[cycleId]/items/index.vue` | `CommonEmptyState`、`useDebouncedSearch`、`useListPage`；GET `C/items`、`P/planning-cycles/permissions` | `product_priorities:view`；缺候选列表 | 通往新增/评估/选入/移动/撤回；页面自身只读，后批 |
| `cycles/[cycleId]/add-item.vue` | `ProductsPlanningCandidateAddForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`Q`；POST `C/items` | `product_priorities:edit`；缺详情/添加 | 加入候选；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/assess.vue` | `ProductsPlanningAssessmentForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`Q`、`I/assessments`；POST `I/assessments` 或 `I/rice-assessments` | `product_priorities:assess`；缺评估详情/提交 | 评分；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/assessments.vue` | `CommonEmptyState`、`useListPage`；GET `I/assessments`、`P/planning-cycles/permissions` | `product_priorities:view`；缺历史读取 | 通往评估；页面自身只读，后批 |
| `cycles/[cycleId]/items/[itemId]/select.vue` | `ProductsPlanningSelectionForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`Q`、`I/assessments`；POST `I/selection-preview`、`I/select` | `product_priorities:prioritize`；缺详情/选入 | 预览与选入；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/move.vue` | `ProductsPlanningQueueMoveForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`Q`、`I/assessments`；POST `C/move-preview`、`C/move` | `product_priorities:prioritize`；缺详情/移动 | 调整队列；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/withdraw.vue` | `ProductsPlanningWithdrawalForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`Q`、`I/consumption`；POST `I/withdrawal-preview`、`I/withdraw` | `product_priorities:prioritize`；缺消费/撤回 | 撤回候选；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/consumption.vue` | `useConfirm`；GET `P/planning-cycles/permissions`、`Q`、`I/consumption`；POST `I/consumption` | `product_priorities:assess`；缺消耗读取/记录 | 记录实际消耗；写流程后批 |
| `cycles/[cycleId]/items/[itemId]/commit.vue` | `useConfirm`、`useAsyncData`；GET `R/permissions`、`C`、`R/windows/:itemId`、`R/commitments/:itemId`；POST `R/commit/:itemId` | `product_roadmaps:view/commit` + `product_priorities:view`；缺窗口/承诺链 | 正式承诺；写流程后批 |
| `cycles/[cycleId]/observe.vue` | `ProductsPlanningObservationForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`；POST `C/observations` | `product_priorities:observe`；缺观测操作 | 新增观测；写流程后批 |
| `cycles/[cycleId]/observations/index.vue` | `CommonEmptyState`、`useFetch`；GET `C/observations`、`P/planning-cycles/permissions` | `product_priorities:view`；缺观测列表 | 通往纠正观测；页面自身只读，后批 |
| `cycles/[cycleId]/observations/[observationId]/correct.vue` | `ProductsPlanningObservationForm`、`useAsyncData`；GET `P/planning-cycles/permissions`、`C`、`C/observations/:observationId`；POST `C/observations` | `product_priorities:observe`；缺详情/纠正 | 纠正观测；写流程后批 |

## planning-items（8 页）

| 源页 | 组件 / composable；METHOD + API | 人员权限；Runtime 缺口 | 可达写动作；只读判断 / 批次 |
| --- | --- | --- | --- |
| `planning-items/[itemId]/index.vue` | `ProductsPlanningItemDetail/Comments`；GET `Q`、`P/planning-items/permissions`、`Q/comments`；评论组件 POST `Q/comments`、PATCH/DELETE `Q/comments/:commentId` | `product_priorities:view/comment`；详情已有 `aims.handoff-detail`（服务响应需比对），评论缺 | 评论写入；读写混合后批 |
| `planning-items/[itemId]/commitments.vue` | `ProductsRoadmapCrossHistory`、`useFetch`；GET `R/commitments/:itemId`，跨产品历史组件再读相应历史接口 | `product_roadmaps:view`；缺承诺历史读取 | 无直接写；只读，待操作后批 |
| `planning-items/[itemId]/dependencies.vue` | `ProductsCrossDependencyCreate`、`useConfirm`；GET `P/cross-dependencies/items/:itemId`、`P/cross-dependencies/permissions`；选择器 GET `/api/v1/products`、`P/planning-items`；POST `P/cross-dependencies/items/:itemId/:dependencyId/remove`、`P/cross-dependencies/items/:itemId` | `product_priorities:view/edit`；缺依赖读写操作 | 建立/移除依赖；写流程后批 |
| `planning-items/[itemId]/feature.vue` | `useDebouncedSearch`、`useListPage`；GET `Q/feature`、`P/planning-items/permissions`、`P/features`；POST `Q/feature` | `product_features:view` + `product_priorities:edit`；功能列表已有 `aims.feature-list`，关联缺 | 关联/解除功能；写流程后批 |
| `planning-items/[itemId]/reach.vue` | `CommonEmptyState`、`useFetch`；GET `P/reach-observations/items/:itemId`、`P/reach-observations/permissions` | `product_priorities:view`；缺触达历史 | 通往新增观测；页面自身只读，后批 |
| `planning-items/[itemId]/reach-new.vue` | `useAsyncData`、`useFetch`；GET `P/reach-observations/permissions`、`Q`、`P/priority-models/list`；POST `P/reach-observations/items/:itemId` | `product_priorities:assess`；缺模型/观测操作 | 新增触达观测；写流程后批 |
| `planning-items/[itemId]/roadmap.vue` | `useConfirm`、`useFetch`；GET `R/windows/:itemId`、`R/permissions`；PATCH `R/windows/:itemId` | `product_roadmaps:view/edit`；缺窗口读写 | 修改路线图窗口；写流程后批 |
| `planning-items/[itemId]/version.vue` | `ProductsVersionPicker/DeferralPicker`；GET `Q`、`P/versions/permissions`、`P/planning-cycles`、`P/versions/:versionId`，选择器 GET `P/versions`；POST `P/versions/:versionId/features` | `product_priorities:view` + `product_versions:view/edit`；版本列表/详情已有 `aims.version-list/view`，规划项绑定缺 | 排入/延期版本；写流程后批 |

## models（3 页）

| 源页 | 组件 / composable；METHOD + API | 人员权限；Runtime 缺口 | 可达写动作；只读判断 / 批次 |
| --- | --- | --- | --- |
| `models/index.vue` | `CommonEmptyState`、`useFetch`；GET `P/priority-models/list`、`P/priority-models/permissions` | 列表 `product_priorities:view`；缺模型列表操作；权限探针还检查 manifest 未声明的 `admin`，会失败 | 跳新建加权/RICE 模型；本页只读，待操作与权限契约后批 |
| `models/new.vue` | `useFetch`、`useToast`；GET `P/priority-models/permissions`；POST `P/priority-models/create` | 源 handler 用 `product_priorities:admin`，manifest 未声明；缺模型创建操作 | 创建加权模型；写流程后批，权限动作需 Claude 复核 |
| `models/rice-new.vue` | `useFetch`、`useToast`；GET `P/priority-models/permissions`；POST `P/priority-models/rice-create` | 源 handler 用 `product_priorities:admin`，manifest 未声明；缺 RICE 创建操作 | 创建 RICE 模型；写流程后批，权限动作需 Claude 复核 |

## objectives（3 页）

| 源页 | 组件 / composable；METHOD + API | 人员权限；Runtime 缺口 | 可达写动作；只读判断 / 批次 |
| --- | --- | --- | --- |
| `objectives/index.vue` | `CommonEmptyState`、`useListPage`；GET `P/objectives`、`P/objectives/permissions` | `product_objectives:view`；manifest 有内部 `product-objectives:read`，Foundation 尚无目标列表操作 | 新建入口；列表只读，待操作后批 |
| `objectives/[objectiveId].vue` | `ProductsObjectiveActions/Cycles/Items`、`useListPage`；GET `O`、`O/observations`、`O/cycles`、`O/items`、`P/objectives/permissions`；组件 POST `O/:action`、`O/cycle-map`/`O/cycle-revoke`、`O/item-link` | `product_objectives:view`；编辑/观测/状态推进分别需 `edit/observe/activate/close/reopen/archive`；缺目标详情、观测与关系操作 | 目标动作、周期映射、规划项关联；读写混合，待完整读取闭包后批 |
| `objectives/new.vue` | `ProductsObjectiveFields`、`useFetch`、`useToast`；GET `P/objectives/permissions`；POST `P/objectives` | `product_objectives:edit`；缺创建操作 | 新建目标；写流程后批 |

## 其他（12 页）

| 源页 | 组件 / composable；METHOD + API | 人员权限；Runtime 缺口 | 可达写动作；只读判断 / 批次 |
| --- | --- | --- | --- |
| `features/index.vue` | `navigateTo`；无 API，旧书签携带模块 query 跳 `structure` | 目标页 `product_components:view` + `product_features:view`；目标已有组件/功能读取 | 无写；本批登记 Host 前缀跳转 |
| `components.vue` | `navigateTo`；无 API，旧书签携带模块 query 跳 `structure` | 目标页 `product_components:view` + `product_features:view`；目标已有组件/功能读取 | 无写；本批登记 Host 前缀跳转 |
| `adoption.vue` | `CommonEmptyState`、`useAsyncData`；GET `R/adoption?page&pageSize` | `products:view` 加 Assets `deliveries:view`、`environments:view` 对象范围；已有 `assets.product-adoption-read` | 无写；本批登记原页，保留分页与双资产范围许可 |
| `documents.vue` | `ProductsDocumentRequests/EditDocumentPurpose/LinkDocument/PreviewDocument`、`useAsyncData`、`useConfirm`；GET `R/documents`、`R/documents/requests`、`R/documents/search`、`R/documents/request-status`、`R/documents/content`；POST `R/documents/create`、`R/documents/template-create`、`R/documents/request-resume`、`R/documents/link-created`、`R/documents/:action` | `product_documents:view/edit`；产品关系和 Codocs 内容授权分离；缺关系列表/预览等精确操作 | 链接/创建/修改用途/移除文档；读写混合，后批。不得借此改 Codocs |
| `feature-version-matrix.vue` | `ProductsFeatureReleaseEvidence/VersionPicker/VersionTools`、`useAsyncData`；GET `R/feature-version-matrix`，选择器 GET `P/versions`、`P/versions/:versionId/releases` | `product_features:view` + `product_versions:view`；版本列表/发布记录已有 `aims.version-list`/`aims.version-release-list`，矩阵缺 | 无本页写请求；只读，待矩阵操作后批 |
| `release-comparison.vue` | `ProductsReleasePicker/VersionPicker/VersionTools`、`useFetch`；GET `R/release-diff`，选择器 GET `P/versions`、`P/versions/:versionId/releases` | `product_versions:view`；版本/发布列表已有，差异计算缺 | 无写；只读，待差异操作后批 |
| `cost.vue` | `ProductsCostProjectPicker`、`useFetch`；GET `R/cost?projectCode&periodMonth`、`/api/v1/projects` | `product_roadmaps:view` + 项目 `projects:view`；缺成本聚合操作（且跨项目权限） | 通往成本规则；页面自身只读，待契约后批 |
| `cost-rules.vue` | `ProductsCostProjectPicker`、`useConfirm`；GET `/api/v1/projects`、`/api/v1/projects/:projectId/product-cost-rules`；POST 同一路径 | `product_roadmaps:view/edit` 与项目 `projects:view/edit` 待复核；缺规则读写操作 | 保存规则；写流程后批 |
| `settings.vue` | `ProductsMemberList/WorkspaceLifecycle`、`useProductWorkspace`、`usePageActions`；GET `P` 及成员/权限组件 API；PATCH `P`，成员与生命周期组件另有管理写请求 | `products:view/edit/admin/archive/restore`；工作区查看已有 `aims.product-workspace-view`，管理闭包未齐 | 编辑资料、成员和状态；写流程后批 |
| `views/index.vue` | `ProductsEditRoadmapView/PlanningItemObjectives/RoadmapCommitmentSummary/RoadmapCycleGoal/VersionTools`、`useFetch`、`useAsyncData`、`useConfirm`；GET `R/views/list`、`R/views/permissions`、`R/views/:viewId`、`R/views/:viewId/apply`，子组件再读目标/周期/承诺；POST `R/views/create`、PATCH `R/views/:viewId`、DELETE `R/views/:viewId` | `product_roadmaps:view/edit` + `product_objectives:view` + `product_priorities:view`；缺保存视图读写操作 | 创建/编辑/删除视图；读写混合后批 |
| `versions/[versionId]/features.vue` | `ProductsLegacyScopeCriteriaForm/VersionDeliverySummary/VersionDevelopmentAction/VersionScopeEditor/VersionScopeHistory/VersionScopeVisibility`、`useDebouncedSearch`、`useConfirm`；GET `P/versions/:versionId/features`、`P/versions/:versionId`、`P/versions/permissions`、`P/planning-items/permissions`、`P/versions/:versionId/features/:scopeId/history`；POST `P/versions/:versionId/features/:scopeId/:deliveryAction`，子组件继续读写范围与验收字段 | `product_versions:view/edit/accept`；版本详情已有 `aims.version-view`，范围列表/历史及编辑闭包未齐 | 范围维护、研发交付动作；读写混合后批 |

## 本批 Host 实施与权限边界

- 新路由为 `/aims/products/:productCode/{features,components,adoption,cycles}`。前两者仅保留 query 并跳已登记 `/structure`；采用页沿用源页和 20 条分页；周期页是 Host 只读列表，沿用已有 `aims.feature-cycles`，无权限探针、复评弹窗或写页链接。周期原页继续在独立 Aims 中使用，并与 Host 共用状态中文标签及语义色映射。
- `adoption` BFF 先检查 Foundation 快照 `products:view`，再检查产品对象可见性，最后向 Assets 按 `deliveries`、`environments` 各签一份范围许可；`cycles` BFF 先检查 `product_priorities:view`，再读取产品对象事实并签周期许可。人员资源不使用 Runtime 服务 capability。缺人员权限 403 且无 Runtime 调用；对象不可见 404；Console 授权依赖失败 503。查询参数保持源 BFF 校验，分页由 Runtime 支持。
- 未实施候选：`documents`、`feature-version-matrix`、`release-comparison`、`objectives/index`、`objectives/[objectiveId]`、`models/index`、`cost`。原因是至少一条必要的精确读取操作缺失。没有复用任意路径代理、增加 Runtime 操作或改 grant。

## 待 Claude 复核的 Runtime 提议

以下都是提议，**未实施**。每个操作须以 `:productCode`、当前用户 actor、tenant/deployment 及签名许可为输入；Runtime 校验许可的资源/动作、产品对象可见性和响应 productCode，拒绝请求自带身份/范围字段。Enterprise BFF 在签发许可前先用 Foundation 快照检查右列人员 `view`；依赖故障为 503、对象不可见为 404。新增服务 capability 的 manifest 条目与 Console grant/seed/verify 改动均须 Claude 复核后由后批执行。

| 读取需求 | 建议精确 Runtime path / capability | 人员门槛与 manifest 变更 |
| --- | --- | --- |
| 产品文档关系列表、请求/搜索、内容预览 | `/v1/enterprise/aims/product-documents:list`、`:requests`、`:search`、`:content`；建议 `aims:product-documents:read`，正文继续由既有 Codocs 权限独立校验 | `product_documents:view`；新增 `product-documents:read` 内部服务资源，Codocs 内容读取不得随关系许可放行 |
| 功能版本矩阵 | `/v1/enterprise/aims/feature-version-matrix:view`；建议 `aims:product-roadmaps:read` | `product_features:view` + `product_versions:view`；复核现有 `product-roadmaps:read` 是否覆盖矩阵，无需新增时直接复用 |
| 发布差异 | `/v1/enterprise/aims/release-diff:view`；建议 `aims:product-versions:read` | `product_versions:view`；Runtime 双版本/发布 ID 必须同产品且可见，复核现有服务资源是否可复用 |
| 目标列表/详情/观测及关系 | `/v1/enterprise/aims/product-objectives:list`、`:view`、`:observations`、`:cycles`、`:items`；建议 `aims:product-objectives:read` | `product_objectives:view`；manifest 已有 `product-objectives:read` 内部服务资源，核对 Runtime 实际绑定后再登记 Foundation 操作 |
| 优先级模型列表 | `/v1/enterprise/aims/priority-models:list`；建议 `aims:product-priorities:read` | `product_priorities:view`；复核现有 `product-priorities:read` 是否覆盖，不扩 `aims.feature-cycles` 语义；源权限探针/写接口要求未声明的 `product_priorities:admin`，须同步修正人员动作契约 |
| 产品经营成本 | `/v1/enterprise/aims/product-roadmap-cost:view`；建议 `aims:product-roadmaps:read` | `product_roadmaps:view`，并对每个项目检查 `projects:view`/对象范围；禁止以产品许可读取跨项目未授权成本 |
| 周期详情/复评（本批未开放详情） | `/v1/enterprise/aims/planning-cycles:view`、`:reviews`；建议 `aims:product-priorities:read` | `product_priorities:view`；独立校验周期归属产品、对象可见性与分页 |

## 后批与范围说明

周期列表和采用列表已有服务端分页，Host 已接 `UPagination`。其余列表在对应 Runtime 契约就绪时确认服务端分页、总数和筛选边界，不以客户端截断模拟分页。读写混合页的 Host 精简方案须等读取闭包与人员授权通过复核后再实施。源应用的写流程、Codocs、Runtime、授权核心和 grant 均不在本批交付中。
