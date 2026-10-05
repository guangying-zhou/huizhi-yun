# 产品轻量规划 API 契约（P1）

本文件是 P1 浏览器 BFF、Aims Runtime adapter 与产品中心领域层的共同接口事实。浏览器提交 camelCase；轻量计划的新浏览器响应为 camelCase。Runtime 内部命令和 Go 记录保持 snake_case。现有需求、版本和转交接口的既有响应字段保持 snake_case，以免改变已上线页面。

所有写命令都要求 `Idempotency-Key`，只接受当前已验证会话派生的 actor 与权限事实；浏览器不能提交 actor、authorization、capability 或 Runtime 上下文。成功命令返回 `{ code: 0, data: { value, ... } }`，其中 `data` 深层键转换为 camelCase。相同幂等键和相同输入重放原回执；同键不同输入及预期修订冲突由 Runtime 返回稳定 `409` 领域错误。Runtime 的非零 `{ code, data }` 由 BFF 保留其领域 code 和 HTTP 语义，认证/服务身份失败不得被改写为成功或普通用户缺权。

## 需求和版本

`GET/POST /api/v1/products/:productCode/requests` 和 `PATCH /api/v1/products/:productCode/requests/:requestId` 支持 `componentId`（创建/编辑可空；编辑的显式 `null` 清除归属）。列表接受 `componentId`、`unassigned=true`、`includeDescendants=true`、原有筛选及 `page/pageSize`。`includeDescendants` 必须同时给出 `componentId`，不能与 `unassigned` 组合。Runtime 在产品边界内递归筛选并计算分页总数。响应记录补充 `component_id`、`component_biz_id`、`component_name`、`scheduled_version_id`、`scheduled_version_code`、`scheduled_plan_status`（`confirmed` 或 `draft_or_stale`）；安排状态以 Runtime 最终投影为准，不得由浏览器推断或按项目关联计数。

`POST /api/v1/products/:productCode/versions` 接受 `planningMode: "simple" | "cycle"`，省略时保留旧调用的 `cycle` 默认值。版本读取返回持久化的 `planning_mode`；只有 `simple` 版本可使用下列轻量端点。

## 计划工作区

| Browser endpoint | 输入 | 必需用户权限 |
| --- | --- | --- |
| `GET .../versions/:versionId/plan` | 无 query/body | `product_versions:view`、`product_requests:view` |
| `PATCH .../plan` | `expectedRevision`、`expectedVersionRevision`、`expectedPlanRevision`、`goal`、`startsOn`、`plannedReleaseDate`、`availablePersonDays`、`reservePersonDays`、可选 `reason` | `product_versions:edit` |
| `GET .../plan/items` | `page`、`pageSize`、`keyword` | `product_versions:view`、`product_requests:view` |
| `POST .../plan/items` | `expectedRevision`、`expectedVersionRevision`、`expectedPlanRevision`、`requestBizId`、`expectedRequestRevision`、`scopeSummary`、`estimatePersonDays`、`acceptanceCriteria`、`sortOrder`、`adoptRequest`、可选 `reason` | `product_versions:edit`、`product_priorities:edit`、`product_requests:view`; `adoptRequest=true` 额外要求 `product_requests:decide` |
| `PATCH/DELETE .../plan/items/:scopeId` | `expectedRevision`、`expectedVersionRevision`、`expectedPlanRevision`、`expectedScopeRevision`；修改还含范围、估算、验收、排序和可选原因；删除要求原因 | `product_versions:edit` |
| `POST .../plan/confirm` | `expectedRevision`、`expectedVersionRevision`、`expectedPlanRevision`、`expectedScopeRevision` | `product_versions:edit`、`product_priorities:prioritize` |

人日字段是最多两位小数的十进制字符串或 `null`；`null` 是未知估算，绝不等价于零。日期是 `YYYY-MM-DD` 或草案空值。修改已确认计划时 Runtime 决定何时要求非空 `reason`，BFF 不代替该状态校验。

`GET .../plan` 的 `data` 为 `planningMode`、`planStatus` (`draft|confirmed|stale`)、`goal`、`startsOn`、`plannedReleaseDate`、`availablePersonDays`、`reservePersonDays`、`workspaceRevision`、`versionRevision`、`planRevision`、`scopeRevision`、`confirmation` 和全量 `summary`（`selectedCount`、`estimatedPersonDays`、`unknownEstimateCount`、`remainingPersonDays`、`issues`）。它还提供只用于呈现的 `permissions`: `canEditPlan`、`canCreateScope`、`canConfirmPlan`、`canDecideRequests`、`canHandoff`。这些字段不替代每个写入口及 Runtime 的再次授权。

`GET .../plan/items` 返回 `items`、`total`、`page`、`pageSize` 和当前四个 revision。每项为 `id`、`bizId`、`versionId`、`planningItemBizId`、`requestBizId`、`requestTitle`、`componentId`、`componentName`、`scopeSummary`、`estimatePersonDays`、`acceptanceCriteria`、`sortOrder`、`status`、`revision`、`handoffCount`。`id` 是既有 version feature 的持久化数值标识，也是范围写命令的键；`bizId` 为稳定派生的 `version-feature:<id>` 展示键，不是独立业务 UUID。汇总始终由完整版本范围计算，不能受此分页或搜索影响。

## 单条项目转交

既有 `POST .../planning-items/:itemId/handoffs` 及从需求发起的 handoff 继续要求 `product_priorities:handoff`、相关需求的 `product_requests:handoff`、版本查看（如有关联版本）和目标项目 `requirements:edit` 范围。版本范围可随完整的旧周期决定（`cycleBizId`、`expectedCycleRevision`、`expectedQueueRevision`）一同转交，仍走原有周期评分门禁。对持久化 `simple` 版本，浏览器必须省略这些周期字段，Runtime 只接受持久化的、当前有效的确认修订作为决定依据；草案、过期确认、移除范围、错误产品或项目范围均被拒绝。Runtime 在事务中按持久化 `planning_mode` 选择门禁，因此浏览器提交任何模式、版本或依据字段都不能把周期路径伪装成轻量路径，或反向绕过评分。

## 统一 Runtime 共享事务入口（ADR-018）

产品中心领域层现提供以下内部 Go 入口；它们不是新增浏览器端点，输入与对应旧 Go 方法完全一致，仅将 `*sql.DB` 改为调用方提供的 `*sql.Tx`：

- `CreateProductCenterVersionInTransaction`
- `EditLightweightVersionPlanInTransaction`
- `CreateLightweightVersionPlanItemInTransaction`
- `EditLightweightVersionPlanItemInTransaction`
- `DeleteLightweightVersionPlanItemInTransaction`
- `ConfirmLightweightVersionPlanInTransaction`
- `HandoffPlanningItemInTransaction`

新旧入口共用同一份领域执行回调，保留授权先于 receipt、产品根锁先于领域对象锁、预期修订、simple/cycle 模式门禁、采纳决策、确认失效、审计和幂等响应。调用方通过 `Registry.BeginWriteTransaction` 先锁持久 registry 身份/generation，再进入领域入口；领域成功不 commit，任何失败（含进入 executor 前的字段校验）都会 rollback 调用方事务。仅调用方可最终 commit，事务内不得发送外部消息。

`HandoffPlanningItemInTransaction` 继续只接受由可信 Aims adapter 构造的 `PlanningHandoffTarget`，项目授权和需求创建/解析必须使用所传同一事务；此接口不放宽目标项目 `requirements:edit`、产品关联或版本意图规则。幂等重放仍重新验证当前授权，不能重用 mutation 前已过期的授权事实。

真实隔离 MySQL 验证复用既有轻量全链场景：需求→simple 版本→计划→采纳→估算→确认→转交，经 41 个受管视图与 registry generation guard 执行；每个成功步骤先证明 caller rollback 回滚 Aims revision/receipt/audit 和先前 Assets 修改，再提交并由旧 Go 入口重放相同 receipt。未知估算、容量超限、确认 stale、错误范围和过期确认转交门禁继续通过原场景断言。项目转交 callback 使用隔离合成项目/需求，不代表真实 HTTP/BFF 项目权限接线已完成。移除入口本轮覆盖早期校验失败回滚，未把它列作全链成功删除验收。

```sh
HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.lightweight.rz68naix/mysql.sock \
  go test -race -run 'TestMySQLEnterpriseLightweightPlanningChain|TestMySQLLightweightPlan' -v ./internal/apps/aims/productcenter
```

该测试于 2026-09-13 通过（4.344s）；另有 `TestSharedPlanningEarlyValidationAbortsTransaction` 覆盖上述七入口的早期拒绝与 caller commit 被阻止。这里不切换任何现有 API/物理写路径；业务服务和 Host/BFF 路由需单独接线验收。

隔离清理记录：PID 81849 正常 shutdown；关闭前 fixture 库剩余 0，socket/datadir 已删除。未访问实际业务数据库。

### enterpriseplanning 用例服务

`NewPlanningService(ctx, registry, binding)` 初始化时验证六个本地写命令的受管视图依赖，方法沿用 `CreateProductCenterVersion`、`EditLightweightVersionPlan`、`Create/Edit/DeleteLightweightVersionPlanItem`、`ConfirmLightweightVersionPlan` 的身份/授权/输入参数，移除 `db` 参数。每次执行通过持久 generation guard 开始事务，调用既有领域 `InTransaction`，成功后由用例服务 commit；无旧库 fallback。

`NewLightweightHandoffService` 独立初始化，额外要求 `aims_projects`、`aims_project_members`、`aims_project_products`、`requirement_items`、`requirement_contents`、`requirement_item_contents`、`project_documents`、`work_items` 的受管视图。`ProjectAuthorizationFacts` 供已验签 BFF 编译项目决策；`HandoffPlanningItem` 明确接收 planning/request/version permits 和既有 `aims.ProductHandoffProjectPermit`。该服务只接持久 `simple` 版本，不回落未登记的 cycle 路径。

Aims 导出的 `ProductPlanningHandoffTarget` 与旧 adapter 共用一份 target 构造代码，回调继续调用原项目事实校验、资格/产品绑定/版本意图校验以及 `createProjectRequirementTx`，所有 SQL 使用传入事务；bridge 自身没有连接池，也没有默认授权。项目决策变化仍在 receipt replay 前拒绝。

`enterpriseplanning.TestMySQLPlanningServicesUseOwningProjectHandoff` 使用当前 canonical schema 的隔离数据库与受管视图，实测六个本地命令成功执行（含移除范围及旧入口重放）、真实项目需求草稿/正文/关联共同提交、晚期审计失败共同回滚、同键重放不重复、无项目许可/项目事实变化拒绝、缺视图映射和旧 generation 拒绝。该证据补足上节首次领域测试尚未覆盖的成功删除与真实项目 target。

```sh
HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.services.fdgkwear/mysql.sock \
  go test -race -run 'TestMySQLPlanningServicesUseOwningProjectHandoff|TestProductHandoffProjectPermitFreshness|TestProductHandoffTargetEligibility|TestProductHandoffRuntimeRequiresVersionPermit' -v ./internal/enterpriseplanning ./internal/apps/aims
```

通过：enterpriseplanning 4.531s，Aims 项目授权/目标资格/version permit 回归 1.494s。仍需为这些服务接入真实 Host/BFF/HTTP 身份边界，不能直接接受浏览器传入 permits。

服务测试实例 PID 89788：fixture 库剩余 0，正常 shutdown，socket/datadir 已删除；未访问实际业务库。
