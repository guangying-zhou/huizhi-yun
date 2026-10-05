# FE-2 / INT-503 产品工作台逐步任务脚本与差距清单

2026-09-24。依据[冻结任务输入](./Unified-Enterprise-Product-Page-API-Readiness.md#fe-2--int-503-当前任务输入2026-09-20)，供固定环境、真实岗位验收使用。#7 阶段 C 经正式 UI 关联两份标记产品文档，owner 从产品资料页读到两份正文；`test` 在 Codocs 直达可见共享样本为只读、受限样本 GET 403，并继续无法访问该产品空间。两项目过滤浏览器验证因缺第二个当前账号可管理的项目而延后；多岗位验收未齐，不能据此宣称 FE-2 全部通过。未登记页面、接口和权限均为待办，不应在验收时用独立 Aims 地址冒充 Host 成功。

## 2026-09-24 MVP 决定

- B1：试点 Assets 产品只对应一个 Aims 产品空间。步骤 06/07/24 使用既有 `/aims/products/{productCode}`，多空间关系与选择器后批处理；无权空间直达仍需 403/404。
- B2：批准产品正式资料只读闭包，实施 Host 页面/BFF、Foundation 精确操作、Runtime `product-documents:list|requests|search|content` 与独立 Codocs 正文授权。创建和编辑后批。
- B3：步骤 21 只对既有、已按原流程基线的项目样本验证读取；项目评审、基线和任务写入本轮不做，FE-2 在该步记“部分完成”。
- B4：可在 C000001 准备显式标记的试点数据和权限；首次写入前备份受影响表，逐笔记录写入和清理回执。`test` 账号默认无 Aims 权限，不静默扩权。
- Round 5：MVP 不新增产品文档关联或项目产品关联的 Host 写入口。步骤 05 的正文 ACL 和步骤 17/23 的两项目过滤仅记“契约已验证、浏览器验证延至后批”；现有空列表与无权对象浏览器结果仍按各自实际证据记录。
- Round 5 hzy0 通知限制：Codocs owner 共享已可用既有精确 Runtime 能力创建关系；C000001 的外部 Connector 通知已启用，hzy0 不放行通知发布。共享关系提交后，Host 的通知步骤可能返回设计性 503；以重新载入后的共享列表判断关系是否落库，**不在 hzy0 重试共享请求**。FE-2 接受已落库的 `test` 只读共享；其正文直达浏览器验收见文末回执。显式“仅站内通知”模式为后续任务，本轮不启用外部通知。

## 口径与记录约定

- 下文 `P` = `/aims/api/v1/products/{productCode}`，`V` = `P/versions/{versionId}`，`J` = `/aims/api/v1/projects/{projectId}`。`{productCode}` 是 Aims 管理空间编码；Assets 主档的 `{id}` 是另一标识。`—` 表示当前没有可调用的 Host BFF / Runtime 操作，不能请求一个猜测的路径。
- 每步只给一个主状态：`已实现有证据` 指代码及所列本地测试覆盖相应接口/边界，**不**指真实登录验收；`已实现待环境证明` 指接口已组合但关键用户路径或授权组合仍无目标环境证据；其余缺口状态按当前阻断层标记。每个“结果”都须用后文模板填实际证据。
- 通用失败基线：缺人员权限 403、对象不可见 404 或不出现在列表、Console/Runtime 依赖故障 503；撤权后刷新并重发请求，旧许可不得继续读写。写操作还须验证幂等重放、修订冲突和失败后无部分提交。不得把页面按钮隐藏当作服务端拒绝的证据。
- `Runtime` 栏写 Foundation `enterpriseRuntimeClient.ts` 的 operation → exact capability；组件内多次 GET 分别列出。非 Runtime 的导航写 `无`。人员权限是 manifest 中的用户资源/动作，不是 `data-runtime:*` 服务授权。

## 逐步脚本（24 步）

| 步 | 状态、岗位与入口 | 用户动作；METHOD + Host BFF | Runtime 操作 → capability；人员权限 | 预期结果；失败/撤权 |
| --- | --- | --- | --- | --- |
| 01 | **已实现有证据**；产品负责人；`/assets/products` | 搜索试点产品、记录 Assets ID/产品编码；GET `/assets/api/v1/products` | `assets.products-list` → `assets:product:read`；Assets `products:view` | 只出现对象范围内主档；无权 403/过滤，故障 503。证据：`enterpriseAssetsProducts.ts`、产品主档接线记录（接线清单 INT-503 段）。 |
| 02 | **已实现有证据**；产品负责人；`/assets/products/{id}` | 查看当前名称、产品线和主档关联文档；GET `/assets/api/v1/products/{id}` | `assets.products-view` → `assets:product:read`；Assets `products:view`；文档元数据另验 Codocs 权限 | 当前主档字段与可见文档，不泄漏受限文档；无权 403/404，依赖 503。证据：`enterpriseAssetsProducts.ts` 的文档过滤、INT-503 主档记录。此步不能替代 Aims 正式产品资料。 |
| 03 | **已实现有证据**；产品负责人；`/aims/products` | 按编码/名称找当前管理空间；GET `/aims/api/v1/products` | `aims.product-list` → `aims:products:view`，并按 Assets 主档可见性投影；Aims `products:view`、Assets `products:view` 分别判定 | 列表只给有权 Aims 空间，主档名按当前代次显示；无权空间不出现，依赖 503。证据：`enterpriseProductList.ts`、接线清单“历史主链登记”。 |
| 04 | **已实现有证据**；产品负责人；`/aims/products/{productCode}` | 进入当前产品定义、核对空间编码/修订/状态；GET `P` | `aims.product-authorization` → `aims:products:authorization-object`；`aims.product-workspace-view` → `aims:products:view`；Aims `products:view`，Assets `products:view` 独立范围 | 只展示当前定义；对象无权 403/404，授权或 Runtime 故障 503。证据：`enterpriseProductWorkspace.ts`、`useProductWorkspace.ts`、INT-503 当前/历史说明。 |
| 05 | **#7 两份正式资料关联及 owner 正文浏览器通过；Codocs 共享正反例通过**；产品负责人；`/aims/products/{productCode}/documents` | 查看正式资料关系、请求/搜索及可见正文；GET `P/roadmaps/documents`、`P/roadmaps/documents/requests`、`P/roadmaps/documents/search`、`P/roadmaps/documents/content` | Runtime `product-documents:list|requests|search|content` → `aims:product-documents:read`；Aims `product_documents:view`；正文另验 Codocs ACL | `zhouguangying` 经正式 UI 将两份 `FE2-FOLLOWUP-7-20260924` 文档关联到 HZ-TY-S-002；列表由 0 变 2，从产品资料页预览两份正文。`test` 从 Codocs 直达已共享样本可读且只读；直达受限样本 GET `/codocs/api/documents/{uuid}` 返回 403、未显示正文。`test` 无 Aims 产品权限，直达产品资料页本身加载失败，因此不能声称其从产品资料页读取共享样本或在该页独立触发受限正文 ACL；产品页与 Codocs 双门槛由合同测试覆盖。 |
| 06 | **MVP 单空间**；产品负责人；`/assets/products/{id}` → `/aims/products/{productCode}` | 从试点主档进入唯一 Aims 产品空间；GET `P` | `aims.product-workspace-view` → `aims:products:view`；Assets 与 Aims 各自核对 `products:view` | 核对产品编码、当前定义与对象授权；多空间关系和选择器后批。 |
| 07 | **MVP 单空间无权直达浏览器通过**；无权样本；`/aims/products/{productCode}` | 直接打开无权空间，撤权后再打开；GET `P` | `aims.product-workspace-view` → `aims:products:view`；Aims `products:view` + 对象事实 | 2026-09-24 `test` 直达 `HZ-TY-S-002` 时 GET `P` 返回 404，页面未显示产品定义；`test` 无 Aims 应用角色。多空间过滤后批。 |
| 08 | **已实现有证据**；产品负责人；`/aims/products/{productCode}/requests` | 筛选需求、进入详情；GET `P/requests`、GET `P/requests/{requestId}` | `aims.product-request-list/view` → `aims:product-requests:read`；`product_requests:view` | 列表/详情同空间、分页准确；无权 403，错对象 404，故障 503。证据：`enterpriseProductRequestRead.ts`、接线清单需求合同。 |
| 09 | **已实现有证据**；产品负责人；同上 | 新建试点需求并记录 bizId；POST `P/requests`（`Idempotency-Key`） | `aims.product-request-create` → `aims:product-requests:create`；`product_requests:create` | 一份需求/回执；重放不重复，异载荷或修订冲突拒绝，撤权后 403。证据：`enterpriseProductRequestActions.ts`、接线清单需求动作证据。 |
| 10 | **已实现有证据**；产品负责人；同上 | 审核并采纳需求；POST `P/requests/{requestId}/decision`（幂等键） | `aims.request-decide` → `aims:product-requests:decide`；`product_requests:decide` | 决策及来源轨迹可复查；权限撤销 403、陈旧修订 409、依赖故障 503；采纳**不等于**项目基线。证据：`enterpriseProductRequestActions.ts`、需求/规划桥接测试。 |
| 11 | **已实现有证据**；产品负责人；`/aims/products/{productCode}/versions` | 查看版本列表并选轻量版本；GET `P/versions`、GET `V` | `aims.version-list/view` → `aims:product-versions:read`；`product_versions:view` | 仅当前产品版本；越界 403/404，故障 503。证据：`enterpriseProductPlanning.ts`、`enterprise/test/planning-bridge.test.mjs`。 |
| 12 | **已实现有证据**；产品负责人；同上 | 无合适版本时建 `planningMode=simple` 试点版本；POST `P/versions`（幂等键） | `aims.version-create` → `aims:product-versions:create`；`product_versions:edit` | 建立轻量版本并进入计划；撤权 403、重放不重复、冲突 409。证据：`enterpriseProductPlanning.ts`、版本计划 HTTP/MySQL 记录。 |
| 13 | **已实现有证据**；产品负责人；`/aims/products/{productCode}/versions/{versionId}/plan` | 读计划及候选需求；GET `V/plan`、GET `V/plan/items`、GET `P/requests` | `aims.version-plan/plan-items` → `aims:product-versions:read`；需求列表另需 `aims:product-requests:read`；`product_versions:view` + `product_requests:view`（轻量计划读取也独立检查需求 view） | 保留版本及空间上下文，候选仅授权需求；各权限独立，缺一不得借另一许可绕过。证据：`productLightweightPlanRuntime.ts`、`planning-bridge.test.mjs`。 |
| 14 | **已实现有证据**；产品负责人；同计划页 | 将已采纳需求纳入范围；POST `V/plan/items`（幂等键）；必要时 PATCH `V/plan` | `aims.version-plan-item-create/plan-edit` → `aims:product-versions:edit`；范围新增需 `product_versions:edit` + `product_requests:view` + `product_priorities:edit`，`adopt_request=true` 再需 `product_requests:decide`；计划 PATCH 仅需版本 edit | 范围显示来源需求及修订；撤权 403，旧修订 409，失败不留下半成品。证据：`productLightweightPlanRuntime.ts`、`planning-bridge.test.mjs`。 |
| 15 | **已实现有证据**；产品负责人；同计划页 | 确认轻量计划；POST `V/plan/confirm`（幂等键） | `aims.version-plan-confirm` → `aims:product-versions:edit`；`product_versions:edit` + `product_priorities:prioritize` | 计划确认后生成可承接范围，重复操作不得另造回执；撤权/过期 403、修订变化 409。证据：`productLightweightPlanRuntime.ts`、`test-enterprise-handoff-http-mysql.mjs`。 |
| 16 | **已实现有证据**；产品负责人；`/aims/products/{productCode}/planning-items/{itemId}/handoff?versionId={versionId}&scopeId={scopeId}` | 从确认范围打开承接表单；GET `P/planning-items/{itemId}`、GET `P/planning-items/permissions`，来源需求 GET `P/requests/{requestId}` | `aims.handoff-detail` → `aims:product-priorities:read`；来源另需 `aims:product-requests:read`；`product_priorities:view`、`product_requests:view` | 显示真实规划/来源/版本范围；错范围 404/409，撤权 403。证据：`enterprise/test/handoff-bridge.test.mjs`、页面 `handoff.vue`。 |
| 17 | **单项目浏览器通过；两项目过滤契约已验证、浏览器待第二项目样本**；产品负责人；同承接页 | 搜索可承接项目；GET `P/handoff/projects?page=…&pageSize=…` | `aims.handoff-projects` → `aims:product-priorities:project-authorization`；`product_priorities:view` + 对每个候选 `projects:view` | hzy0 `zhouguangying` 承接页仅列 HZY（项目 257）并可选中。#7 已提供第二项目关联入口，但当前 `zhouguangying` 只管理 HZY，正式 UI 创建标记研发项目返回 403；后续存在第二个可管理活动研发项目时再做两项目浏览器过滤。过滤合同见 `enterpriseProductHandoffCandidates.ts`、`handoff-bridge.test.mjs`。 |
| 18 | **空候选浏览器通过；有权/无权候选过滤待真实样本**；产品负责人；同承接页 | 若选“关联已有需求”，搜索目标需求；GET `P/handoff/requirements?projectCode=…` | `aims.handoff-requirements` → `aims:product-priorities:project-authorization`；`product_priorities:view` + `requirements:view`（目标项目对象） | 2026-09-24 选择 HZY 后切换关联已有需求，页面正常返回 0 条；写入前 HZY 需求列表为空。隐藏候选及缺权 403 由 `enterpriseProductHandoffCandidates.ts`、`handoff-bridge.test.mjs` 覆盖，尚无真实浏览器样本。 |
| 19 | **创建草稿浏览器通过**；产品负责人；同承接页 | 创建项目草稿需求或关联已有需求；POST `P/planning-items/{itemId}/handoffs`（幂等键） | `aims.handoff-project-authorization` → `aims:product-priorities:project-authorization`，`aims.handoff-create` → `aims:product-priorities:handoff`；`product_priorities:handoff`，有来源还需 `product_requests:handoff`，另需 `product_versions:view`、目标 `requirements:edit` | 2026-09-24 正式 UI 将产品需求 12、已确认版本 5/范围 1 承接到 HZY 257；成功提示后新草稿 `HZY-REQ-001`（id 1）可读。只读关联表确认一条 product/version/project/requirement 关系。重放、撤权、晚失败仍由 `test-enterprise-handoff-http-mysql.mjs`、`handoff-bridge.test.mjs` 覆盖；本次不重复提交。 |
| 20 | **项目经理正例与无权负例浏览器通过**；项目经理；`/aims/projects/{projectId}/requirements` | 打开承接后的项目需求；GET `J/requirements`、GET `J/requirements/{requirementId}` | `aims.project-requirement-list/view` → `aims:requirements:view`；`requirements:view` + 项目对象范围 | `zhouguangying` 在 hzy0 HZY 项目页读取新草稿列表/详情成功；`test` 对项目 257 的列表及需求 1 详情均收到 GET 403，无正文。产品来源由只读关联表证实，详情 UI 的 `internal` 是原需求来源类别，未显式展示产品关联。 |
| 21 | **部分完成：HZY 工作项只读可用、无既有基线需求样本**；项目经理/审批人；`/aims/projects/{projectId}/requirements` | 只读核对既有、已按原项目流程基线的需求及其工作项；GET `J/requirements`、`J/work-items` | `aims.project-requirement-list` → `aims:requirements:view`；`aims.project-work-item-list` → `aims:project-work-items:view`；人员分别验 `requirements:view`、`work_items:view` | HZY 工作项页可读；只读库核对项目需求仅步骤 19 的一条 `draft`，没有 baselined 样本。未将新草稿视作已基线，也未执行评审、基线或任务创建；写动作后批。 |
| 22 | **已实现待环境证明**；项目经理；`/aims/projects/{projectId}/work-items` 或 `/aims/projects/{projectId}/board` | 查看已有/经基线创建的工作项及进展；GET `J/work-items`、GET `J/board` | `aims.project-work-item-list` → `aims:project-work-items:view`；`aims.project-board-view` → `aims:project-board:view`；`projects:view`、`work_items:view` 分别按 handler 检查 | 只展示有权项目/工作项；无权 403/过滤、依赖 503。Host 读入口已组合，需真实项目经理与执行数据证明。 |
| 23 | **已实现；两项目过滤契约已验证、浏览器待第二项目样本**；产品负责人；`/aims/products/{productCode}/execution-coordination` | 选择原版本查看跨项目执行汇总；GET `P/roadmaps/execution-coordination?versionId=…` | `aims.version-execution-coordination` → `aims:product-versions:read`；`product_versions:view` + 每项目 `projects:view`/`work_items:view` 过滤 | 版本总量可见，受限项目明细不泄露；撤权后刷新过滤或拒绝，故障 503。证据：`VersionDeliverySummary.vue`、`handoff-bridge.test.mjs`、版本发布 HTTP/MySQL 记录。#7 关联入口已就绪，第二活动研发项目样本因当前账号无另一经理关系、创建 403 尚未准备；真实两项目浏览器验证待补。 |
| 24 | **已实现待环境证明**；产品负责人；版本页 → `/aims/products/{productCode}` | 返回唯一产品空间、重开原版本计划；GET `P`、GET `P/versions`、GET `V/plan` | `aims.product-workspace-view` → `aims:products:view`；`aims.version-list/plan` → `aims:product-versions:read`；`products:view` + `product_versions:view`，计划另需 `product_requests:view` | 编码和版本上下文保持；撤权后原 URL 重新鉴权。多空间返回上下文后批。 |

## 差距汇总

### 阻塞冻结主链

| 编号 | 涉及步骤 | 差距与所需决定 |
| --- | --- | --- |
| B1 | 06、07、24 | **MVP 已决：单一 Aims 空间。** 复用现有路由；多空间关系查询、授权过滤和选择器后批，不阻塞当前单空间验收。 |
| B2 | 05 | **已批准并部署本机测试 Runtime，#7 owner 产品正文与 test Codocs 正反例已验。** Host/Runtime 只读产品资料 `list/requests/search/content`，精确 `aims:product-documents:read` + 人员 `product_documents:view`；正文另过 Codocs ACL。两份标记资料已关联并由 owner 预览；`test` Codocs 可见只读、受限 403，因无 Aims 产品权限，其产品资料页仍拒绝。模板创建、正文编辑后批。 |
| B3 | 21 | **接受只读。** 用既有已基线项目样本验证读取；项目评审、基线及任务写入后批，FE-2 此步标“部分完成”。 |
| B4 | 01–24 | **已授权准备 C000001 测试数据与权限。** 写前备份受影响表，逐笔标记测试对象和回执；真实多岗位/撤权浏览器证据仍待验。 |

### 不阻塞本轮轻量主链

| 编号 | 涉及步骤或边界 | 差距与 W1-B 对应 |
| --- | --- | --- |
| N1 | 05 的文档维护扩展 | #7 已交付“关联既有 Codocs 文档”及“项目关联已有产品”两个精确写入口；两份标记资料和 owner 产品正文、`test` Codocs 共享正反例已在 hzy0 验证。`test` 无 Aims 产品权限，产品资料入口仍拒绝；双门槛合同测试保留。Codocs 候选选择器、模板创建、正文编辑、用途调整、解除/恢复关联，以及主产品/版本限定切换仍后批。当前账号仅管理现有 HZY #257，正式 UI 创建第二项目 403；按 Claude 决定不补授权，两项目过滤维持契约证据、浏览器延后。 |
| N2 | 11–15 以外的高级规划 | W1-B 提议 ② 功能版本矩阵、③ 发布差异、④ 产品目标、⑦ 周期详情/复评均非已确认轻量版本计划的必经动作；不以它们替代轻量范围。 |
| N3 | 06–19 以外的模型/成本 | W1-B 提议 ⑤ 优先级模型、⑥ 产品经营成本不在冻结主链。模型读取可拟复用 `aims:product-priorities:read`；源 `product_priorities:admin` 在 `productModelRuntime.ts` 被使用而 manifest 未声明。**建议**单列“模型发布/周期绑定”的精确人员动作，经拥有方与权限审计确认后同步 handler、manifest、授权种子与测试；在决定前不要把它映射为现有 `edit` 或临时授 `admin`，也不要开放该写入口。**待 Claude 决定。** |
| N4 | 23 → 项目详情 | Host 汇总仅以普通文本显示项目编号，项目工作项详情需用户从项目入口再打开；优化深链与携带安全返回来源可后批做，仍须独立校验 `projects:view`/`work_items:view`。 |

W1-B 提议序号按[盘点文档“待 Claude 复核的 Runtime 提议”](./Unified-Enterprise-Product-Subpages-Inventory.md#待-claude-复核的-runtime-提议)自上而下编号 ①～⑦；这里只列与脚本相关的映射，不重复盘点正文。项目评审 B3 与多空间 B1 是本次从冻结主链识别出的额外差距。

## 环境与数据前置（C000001 准备获准，写入须备份并留回执）

| 对象 | 测试租户需准备并记录 |
| --- | --- |
| 固定环境 | 同一组 Host、Console、Gateway、Runtime、schema、权限目录的版本/配置标识；仅在此组内记录真实页面结果，不拼接跨环境证据。 |
| 产品与空间 | 1 个试点 Assets 主档及其唯一 Aims 管理空间（编码、状态、当前目录代次）；多空间关系后批，另备无关或停用空间防串读。 |
| 正式资料 | #7 已新建并关联两份 `FE2-FOLLOWUP-7-20260924` 标记文档：可见 `dfc6da97-0977-42b2-bc4a-66874ea4e01c`（产品概览，向 `test` 只读共享）与受限 `04bf9ce4-5a0c-4ab5-b1cc-5a1a6fee1e59`（设计，无共享）。owner 从产品资料页读到两份正文；`test` 从 Codocs 直达可见只读、受限 GET 403，产品资料入口因无 Aims 权限拒绝。历史发布/验收快照另备。 |
| 需求与版本 | 可新建/决策的试点需求、已采纳与拒绝对照；轻量草稿版本、可确认范围及版本修订；重复操作/旧修订用的隔离副本。 |
| 项目与执行 | #7 已提供第二项目关联入口；当前仅 HZY #257 是 `zhouguangying` 管理且已关联的活动研发项目。其余当前可见研发项目只有普通成员关系；标记第二项目正式创建 403 且未落库。Claude 决定不补授权，真实两项目过滤延后，合同证据保留。已有项目需求、按原流程已评审基线的需求、工作项与执行状态另记实际证据；不得把步骤 19 的新草稿当已基线样本。 |
| 岗位与授权 | 普通产品负责人、可决策产品负责人、项目经理、项目审批人、发布人与独立验收人、只读/无权样本各账号；记录 Console 当前授权快照、对象范围及预期可见空间/项目。发布与验收分权且不可自审。 |
| 撤权与故障 | 可受控撤销 `products:view`、`product_requests:decide`、`product_versions:view/edit`、`product_priorities:handoff`、`projects:view`、`requirements:view/edit` 的样本；故障样本按环境团队既有演练方式准备，不创建故障开关文件。记录撤权前后快照时间与重新请求。 |

**清理边界**：仅清理测试租户明确标记、能按回执定位的本轮新建需求/版本/草稿和临时授权；历史发布、验收快照、既有项目基线/任务及无权对照样本不在自动清理范围。先核对对象依赖和审批状态，由环境拥有方按既定流程操作并留清理回执。本文不写入业务数据，也不修改授权。

## 验收记录模板（逐步复制）

| 字段 | 填写内容 |
| --- | --- |
| 步骤 / 执行时间 / 执行人 | `FE-2-__`；时区；岗位账号代号（不写凭据） |
| 环境与对象 | Host/Console/Gateway/Runtime/schema/权限目录版本；产品 ID/编码、空间/版本/项目/需求 ID；数据修订 |
| 预期 / 实际 | 本步骤表述的预期；实际页面、HTTP 状态、响应中与归属/修订有关的脱敏字段；是否通过 |
| 证据 | 截图、脱敏网络请求与响应、测试/审计/回执 ID、时间戳、文件或记录链接；不要记录 cookie/token/密钥 |
| 重复操作 | 相同 URL 刷新、同幂等键重试、新会话重查的实际结果；是否新增多余回执/数据 |
| 失败与恢复 | 无权、撤权、过期、修订冲突、依赖故障的实际 HTTP 与页面提示；恢复权限/服务后的重试结果及审计证据 |
| 清理 | 新建对象清单、依赖检查、执行人、清理回执；未清理时写明保留原因与责任人 |

**验收结论门槛**：逐步记录可已完成/阻塞/不适用；只读预置样本能验证部分步骤。MVP 逐步证据未齐前，不将 FE-2 / FE-A05 / INT-503 记为完成；步骤 21 写动作明确记部分完成。

## 2026-09-24 本机 MVP 验收回执与清理清单

此节记录当时的 MVP 快照；其中两份旧文档与共享已在后续 #6 经正式 UI 清理至回收站，以下“尚未清理”只描述该次验收结束时的状态。#7 新样本与现状见文末续行。

- 环境为 C000001 本机 hzy0；正式开发 Platform Enterprise release `v0.3.221-test.fe2-round6.1` 已发布，C000001 测试策略 revision 24 已由 Console/Enterprise Runtime 接受。`zhouguangying` 的现有项目经理角色含 `aims:requirements:view/edit`，无需临时个人授权。开发 Platform 发布和部署的逐阶段证据另存受保护执行报告。
- `zhouguangying` 从确认的产品版本 5／范围 1 打开正式承接页，看到唯一关联且可见项目 HZY（257）；“关联已有项目需求”候选当时为 0。经正式 UI 创建项目草稿 `HZY-REQ-001`（需求 ID 1），列表和详情可读；只读关联查询证明其来源为产品需求 12、规划项 8、版本 5／范围 1。HZY 没有既有已基线需求，步骤 21 只能记部分完成，未执行评审、基线或任务写入。
- `test` 一次登录的负例：共享个人文档 `6e6201fc-5913-4a8a-8dff-347cb8af2de6` 可直接打开、正文可见，页面显示“只读／当前文档不可编辑”；未共享的受限文档 `0e67e0c6-8318-4d40-972c-fa4cd498e071` 正文 GET 403、正文为空。HZY 项目 257 的需求列表与需求 1 详情 GET 均为 403；直达产品 `HZ-TY-S-002` 及其承接页时，相关产品、规划项、权限、项目候选 GET 均为 404，不显示对象数据，承接按钮禁用。
- 最终正式成员权限页显示 `test` 有效角色仅 `console.viewer`，没有 Aims 应用角色；Aims 的 4 项 `aims_overview:view`、`notifications:view`、`projects:view`、`work_items:view` 均是 participant/self 受限 baseline。上述受保护对象负例已验证该 baseline 没有扩大到产品、HZY 需求或承接对象。本轮未给 `test` 临时授角或执行撤权写入。
- 浏览器发现：`/codocs/mydocs/shared` 空白，控制台报 `useAccountStore is not defined`；直接文档链接可用于本轮 ACL 验收。打开共享文档时附带的“标记已读”POST 和共享信息 GET 各收到 403，但正文 GET 成功，故只读正文正例成立，协同文档列表与辅助功能需后续修复。hzy0 共享创建后的设计性 503 与外部通知限制仍按上文处理，不重试共享。
- **本批结论**：FE-2 轻量产品需求→版本范围→项目草稿主链及 `test` 对象拒绝已取得真实浏览器证据。步骤 05 的已关联产品资料正文、步骤 17/23 的两项目过滤仍只按契约证据接受并延后浏览器验收；步骤 21 缺既有基线样本而部分完成。未完成的多岗位发布／独立验收、旧版本 `/features` 死链和上述协同文档列表缺陷不能写成全量 FE-2 通过。

| 待清理测试对象 | 当前关系与清理次序 |
| --- | --- |
| HZY 项目需求 `HZY-REQ-001` / ID 1，产品承接关联 ID 1 | 草稿仍存在；先由环境拥有方核对是否已有后续评审或依赖，再经正式领域流程处理项目需求及产品承接关联，不直接删库。 |
| 产品 `HZ-TY-S-002` 的需求 ID 12、版本 ID 5、规划项 ID 8、范围 ID 1 | 需求已采纳、版本计划已确认并关联上述项目草稿；待解除承接依赖后，按正式领域流程依次核对计划范围、需求与版本的可清理状态。 |
| Codocs 可见样本 `6e6201fc-5913-4a8a-8dff-347cb8af2de6` 及给 `test` 的只读共享；受限样本 `0e67e0c6-8318-4d40-972c-fa4cd498e071` | 两份都是未关联产品的个人测试文档；先处理共享关系，再由 owner 按正式文档流程清理。不要将它们误记为产品正式资料。 |
| 自定义角色 `fe2_mvp_requirements_temp_20260924` | 已停用，0 个应用角色／权限、0 人授权，从未用于 `test`；正式角色 UI 无删除入口，保留为待环境拥有方清理的空测试元数据，不启用。 |

以上对象尚未清理；备份、发布 release 35 与策略 revision 24 是环境记录，不能作为测试行直接回滚或删除。清理负责人为 C000001 环境拥有方，须先复核依赖、审批状态和备份，再逐项留正式回执。本回执只更新文档，不改业务数据或授权。

## 2026-09-24 #7 续行：产品资料与项目关联验收

- 固定环境：C000001 hzy0，Runtime `0.3.223-test.fe2-followup7.2`，开发 Platform Enterprise release 36，C000001 策略 revision 25；C000002 未改。写前对本机统一 Enterprise/Aims 库与 Codocs 库分别加密备份并核对可解密性；备份留在 Runtime 受保护目录，不入仓库。Collab 保持关闭。
- `zhouguangying` 经正式 Codocs UI 新建两份无业务正文样本，随后经新产品资料 UI 关联到 `HZ-TY-S-002`。可见样本 UUID `dfc6da97-0977-42b2-bc4a-66874ea4e01c`、Codocs id 289、关系 id 1、用途 `product-overview`；受限样本 UUID `04bf9ce4-5a0c-4ab5-b1cc-5a1a6fee1e59`、Codocs id 290、关系 id 2、用途 `design`。两份关系 revision 均为 1、未解除；owner 在产品资料列表看到 2 条并分别预览正文。
- 可见样本仅向 `test` 建立一条只读共享（共享 id 3）；受限样本无共享。`test` 在同一次登录中直达前者，页面显示 owner、只读标识与样本正文；直达后者，GET `/codocs/api/documents/04bf9ce4-5a0c-4ab5-b1cc-5a1a6fee1e59` 为 403，未显示受限正文。`test` 直达产品概览、产品资料及承接页时，产品资料与规划/权限/目标项目加载失败，不能打开该产品的资料关系；HZY 项目 257 概览未显示详情、需求列表 GET 403。没有执行任何负例写入。
- 本轮的 `test` 是无 Aims 产品权限账号：其 Codocs 共享正文可读，只证明 Codocs 独立 ACL；从产品资料页读取共享正文需要同时有 Aims 产品/资料 view 权限，本次没有临时授予，因此该双门槛的交叉浏览器样本仍由自动化合同测试承担。步骤 05 的 owner 正文与 Codocs 共享正反例已获得浏览器证据；不把 `test` 的产品资料页加载失败误记为 Codocs 拒绝。
- 第二项目关联入口已部署，未创建第二条关联。只读核对 `zhouguangying` 在活动产品研发项目中只管理已关联的 HZY #257；正式 UI 创建标记项目 `FE2FUP7-20260924` 返回 403、未落库。Claude 决定不补授权、不绕过。步骤 17/23 的真实两项目过滤保持“契约已验证、浏览器延后”；test 对 HZY 直达拒绝不替代两项目差分样本。

| #7 新样本清理项 | 当前状态与正式清理路径 |
| --- | --- |
| 产品资料关系 id 1/2 | 均为活动关系；本批 UI 只提供关联，尚无解除入口。先由后续正式领域流程解除关系并记录回执；在入口出现前列清单保留，不直接写库。 |
| 可见 Codocs 文档 id 289、共享 id 3 | 与产品解除关联后，owner 在正式共享面板撤销 `test/read`，复核共享为空，再由 owner 按正式 UI 将文档移入回收站。 |
| 受限 Codocs 文档 id 290 | 当前无共享；与产品解除关联后，由 owner 按正式 UI 移入回收站。 |
| 标记项目 `FE2FUP7-20260924` | 创建 403，未产生项目或产品关联行，无需清理。 |
