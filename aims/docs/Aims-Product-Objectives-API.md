# 产品目标 API（实施中）

当前已实现领域创建/读取、Runtime adapter 和浏览器 BFF；页面尚未接入，不能视为已上线。

Runtime 路径统一为 `POST /v1/aims/internal/products/{productCode}/objectives:{action}`。

| action | 精确服务 capability | 产品对象权限 | input |
| --- | --- | --- | --- |
| create | aims:product-objectives:create | product_objectives:edit | title、description、starts_on、ends_on、owner_uid、metric、expected_revision |
| list | aims:product-objectives:read | product_objectives:view | status（空或draft/active/closed/archived）、page、page_size |
| view | aims:product-objectives:read | product_objectives:view | id |

每个请求携带 Foundation 生成的 authorization；actor 来自受信服务上下文，不能取自 input。写请求携带 idempotency_key，权限校验先于回执重放。create 要求产品 active、预期产品修订一致，负责人是当前有效产品成员；目标、产品修订、审计与回执同一事务提交。Directory 用户活跃事实仍待接入。

metric 包含 name、unit、measurement_definition、direction、baseline_value、target_value。指标数值为最多14位整数、6位小数的十进制字符串；当前正式目标支持 increase/decrease，目标须分别高于/低于基线。create 返回初始 draft 状态、revision=1、workspace_revision，以及目标完整快照（在标准命令回执 value 内）。

list 返回 items、total、page、pageSize、workspace_revision；page 为1..1000000、page_size为1..100，按 starts_on DESC、id DESC 排序。view 返回 objective、workspace_revision。目标记录包含稳定 biz_id、产品、标题/说明、期间、负责人、metric、状态与修订；日期为 YYYY-MM-DD，基线/目标值始终是六位小数字符串。

观测及目标状态流转已接入 Runtime 和浏览器 BFF，页面尚未接入。领域达成率计算为 `(观测-基线)/(目标-基线)*100`，缺观测为 null，允许负数和超过100%，不由任务完成率推导。

验证：领域隔离 MySQL 创建/读取/迁移测试、Runtime 边界及读取传输权限测试、Console grant 隔离测试已通过；实际 Adapter+MySQL 创建→重放→列表→详情链路已验证；服务上下文为测试注入，实际 JWT/HTTP 成功链路与页面验收待完成。

## 浏览器 BFF

- `GET /api/v1/products/{productCode}/objectives`：status/page/pageSize 查询，真实分页。
- `GET /api/v1/products/{productCode}/objectives/{objectiveId}`：只接受路由 ID，不接受查询字段。
- `POST /api/v1/products/{productCode}/objectives`：要求 Idempotency-Key，不接受查询字段。JSON 为 title、description（默认空）、startsOn、endsOn、ownerUid、expectedRevision、metric；metric 为 name/unit/measurementDefinition/direction/baselineValue/targetValue。数值为字符串，精确比较不经过 Number。

BFF 拒绝未知字段和客户端身份覆盖，调用 Foundation 产品权限 helper，permit有效期15秒，actor来自可信 facts；所有响应 no-store。Runtime不可用保留503，上游业务错误保留原错误语义。尚未完成实际JWT/HTTP和页面验收。

目标观测已接入 Runtime `objectives:observe`：CreateProductObjectiveObservation 要求独立 product_objectives:observe，输入 objective_id、expected_revision、expected_objective_revision、observed_on、measured_value、evidence、note。仅active/closed目标允许录入，记录服务端指标快照与原目标修订；实际值须为明确数值，未知尚不支持独立记录。更正链和观测历史接口待实现。

目标状态命令 TransitionProductObjective 已接入 Runtime `objectives:activate|close|reopen|archive`：input 包含 objective_id、expected_revision、expected_objective_revision、action、reason，身份 action 为 product_objectives:{action}。独立动作权限为activate/close/reopen/archive；允许draft→active、active→closed、closed→active、draft/closed→archived。启用/重开复核有效负责人和指标，保留前后快照与原因；结束不伪造达成结果，归档后保留历史且不可录入观测。

Runtime 观测和状态动作分别要求 `aims:product-objectives:{action}` 精确服务 capability 与 `product_objectives:{action}` 对象权限。状态 input.action 必须匹配路径动作，不能使用 close capability 请求 reopen。目标修订冲突与状态冲突映射409。真实 Adapter+MySQL 已验证创建→启用→观测→结束、重放、读取与修订冲突；上下文仍为测试注入，非实际JWT验证。

浏览器动作路由均为 `POST /api/v1/products/{productCode}/objectives/{objectiveId}/{action}`，action为observe/activate/close/reopen/archive，要求Idempotency-Key且不接受查询参数。状态请求体为expectedRevision、expectedObjectiveRevision、reason；动作由服务端路由注入。观测请求体为expectedRevision、expectedObjectiveRevision、observedOn、measuredValue、evidence、note（默认空）。ID来自路由；拒绝客户端action、快照、达成率或身份字段。每个动作使用独立同名产品权限与精确服务capability。

## 观测历史 Runtime

`POST /v1/aims/internal/products/{code}/objectives:observations`，要求 `aims:product-objectives:read` 与 product_objectives:view，input为objective_id/page/page_size。返回items/total/page/pageSize/objective_id/workspace_revision，按observed_on DESC、id DESC真实分页。记录包含实测值、原指标快照、原目标修订、证据/备注、录入人/时间及按原快照计算的attainment_percent。不得按当前目标定义重算旧记录。浏览器历史路由已接入：`GET /api/v1/products/{code}/objectives/{objectiveId}/observations`，仅接受page/pageSize；目标ID固定取路由，调用目标view/read权限，不需要幂等键。

实现说明：详情及子动作共用严格catch-all分发器，URL合同不变。只接受正安全整数目标ID及上述动作，未知路径404、错HTTP方法405；不会回退到任意Runtime操作。列表和创建仍为独立index路由。

## 页面权限快照

`GET /api/v1/products/{code}/objectives/permissions` 不接受查询字段，要求目标view权限；返回product_code/status/revision以及独立edit/observe/activate/close/reopen/archive布尔值，不返回actor。复用Foundation权限helper，各次授权事实的身份、产品、状态、修订和成员关系必须一致，否则409要求刷新。授权服务不可用保留503；此快照仅供UI显示，实际写请求仍独立鉴权。

更正链schema v5.23已提供correction_of_id及correction_reason，要求同目标/产品引用且原因明确，每条记录最多一个直接更正，保留全部不可变历史。领域命令与对外更正接口尚未接入。

Runtime `objectives:observe`现支持可选correction_of_id和correction_reason（配对）；复用独立observe权限，更正仍要求当前产品/目标修订。只能引用同产品同目标且尚未被更正的观测，保留原日期、原metric_snapshot及原objective_revision；证据/实测/备注为新记录，原记录不修改。更正链冲突409。浏览器BFF尚未接受更正字段，历史更正标识和页面入口待补齐。

历史读取现在要求v5.23迁移，记录增加correction_of_id（nullable）、correction_reason、superseded_by_id（nullable）。全部记录保留分页展示，不过滤被更正记录；superseded_by_id非空表示历史已被替代，链尾为空。详情页面展示对应标识和更正原因；这里“未被更正”仅表示未被更正，不表示最新观测日期或目标已达成。

浏览器观测POST现接受配对可选correctionOfId/correctionReason。ID须为正安全整数，原因非空且最多2000字；任一出现即要求另一字段有效，禁止null/字符串ID。保留当前expectedObjectiveRevision并由服务端读取原口径及历史修订，拒绝客户端metricSnapshot/objectiveRevision等覆盖字段。普通观测省略两字段，页面更正入口待接入。

### 目标编辑 Runtime（2026-09-08）

`POST /v1/aims/internal/products/{code}/objectives:edit` 使用 `aims:product-objectives:edit` 服务能力和 `product_objectives/edit` 业务权限。input 为创建字段加 `objective_id`、`expected_objective_revision`、必填 `reason`；创建字段中的 `expected_revision` 仍表示当前产品修订。只允许 draft/active，成功返回 `{ objective, workspace_revision }`，目标与产品修订各加一。保留历史观测原口径；BFF和页面编辑入口尚待接入。

目标编辑 BFF 已接入 `POST /api/v1/products/{productCode}/objectives/{objectiveId}/edit`。body 使用创建页面的 camelCase 字段，并增加 `expectedObjectiveRevision`、`reason`；必须传 Idempotency-Key，不接受查询参数或 body 中的目标 ID、状态、操作者。路由提供唯一目标 ID，沿用创建时的日期与精确数值校验。编辑页面尚待接入。

目标详情现已提供编辑弹窗，复用创建字段组件，必填变更原因；仅草稿/进行中且有edit权限时显示。组件代码检查通过，浏览器交互验收待完成。

### 目标与规划事项关联接口（2026-09-08）

- `GET /api/v1/products/{productCode}/objectives/{objectiveId}/items`：仅接受page/pageSize，返回items/total/page/pageSize/objective_id/objective_revision/workspace_revision；事项含planning_item_id、biz_id、product_code、title、lifecycle、planning_revision、contribution_note、created_by/created_at。
- `POST /api/v1/products/{productCode}/objectives/{objectiveId}/item-link`：必填幂等头；body为expectedRevision、expectedObjectiveRevision、planningItemId、expectedPlanningRevision、contributionNote、remove(boolean)、reason。新增/更新要求非空贡献说明，解除要求贡献说明为空。三方修订同时校验，仅草稿/进行中目标可修改关系。
- Runtime对应objectives:items（product-objectives:read）及objectives:item-link（product-objectives:item-link）。业务分别使用product_objectives/view与edit。目标ID只取BFF路由，拒绝客户端身份、状态及未知字段。
- 关联更新只递增目标及产品修订，保留规划事项的评分/状态及所有观测口径；贡献说明更新和解除均记录原因与前后审计。

### 周期映射 BFF（2026-09-08）

- `GET /api/v1/products/{productCode}/objectives/{objectiveId}/cycles`：page/pageSize分页，含有效与撤销记录。每条返回原目标/周期快照及各自保存修订；顶层objective_revision/workspace_revision为当前修订。
- `POST .../{objectiveId}/cycle-map`：body为cycleId、expectedCycleRevision、expectedObjectiveRevision、expectedRevision、reason。
- `POST .../{objectiveId}/cycle-revoke`：body为mappingId、expectedObjectiveRevision、expectedRevision、reason。撤销保留原快照与记录，重新映射生成新记录。
- 写接口必须幂等头、目标edit权限与同名精确Runtime capability；读要求目标view与product-objectives:read。BFF拒绝客户端快照、目标ID或未知字段，后端按路由产品和目标检查归属。重复有效映射或已撤销映射返回409。

### 规划事项反向目标查询（Runtime）

`POST /v1/aims/internal/products/{productCode}/objectives:item-objectives`，operation 为 `aims.product-objectives.item-objectives`，精确服务能力 `aims:product-objectives:read`。需可信委托 actor，body 包含目标 `authorization`、规划 `planning_authorization` 及 `input: { item_biz_id, page, page_size }`。领域事务重新核对双 view 授权和事项归属。

返回 items、total、page、pageSize、item_biz_id、item_revision、workspace_revision；items 含 objective_id、biz_id、product_code、title、status、objective_revision、contribution_note、created_by、created_at。只返回持久事项关联，不从周期映射推断；每页 1–100。已登记为只读传输，复用现有读取 grant。浏览器代理/页面尚待接入。

浏览器入口：`GET /api/v1/products/{productCode}/objectives/for-item/{itemBizId}?page=1&pageSize=20`，复用 objectives catch-all。只接受分页，服务端取得目标/规划双 view 并比较产品、actor、修订及成员事实一致性，再用可信 actor 调 Runtime；禁止请求覆盖授权上下文。失败保留权限/运行服务错误，不缓存。
