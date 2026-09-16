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
