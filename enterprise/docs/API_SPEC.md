# Enterprise Host API（实施中）

本文件记录已接线的 Host API；代码登记不等于目标环境已完成身份、授权、数据迁移与流量验收。未登记入口明确不可用，各批次的历史说明需结合当前源码与最新验收记录判断。

## 工作项创建与基本信息编辑（2026-09-15）

`POST /aims/api/v1/projects/:id/work-items` 与 `PUT /aims/api/v1/work-items/:id` 均要求 `Idempotency-Key`，拒绝 query。人员权限分别为 `work_items:create/edit`，服务 capability 分别为 `aims:work-item-create:execute`、`aims:work-item-edit:execute`。编辑 body 包含 `projectId`、详情返回的 `editVersion` 作为 `expectedVersion`，以及变化字段。

基本编辑仅接受 title、description、priority、assigneeUid、startDate、dueDate、estimatedHours；状态、结构和版本关联明确拒绝。创建字段遵循原项目工作项创建校验，受派人员必须是活跃项目成员，里程碑必须属于项目。Runtime 校验用户绑定的 15 秒 permit，并在同一事务中提交事实、审计和 receipt；同键重放返回冻结结果，不同键旧内容版本返回 409。状态/关联/outbox 的完整迁移仍待完成。

版本关联另走工作项 `association` 子路由，精确 service capability 为 `aims:work-item-associate:execute`，人员权限为 `work_items:edit`；不通过基本编辑放开字段。复用原关联合同并锁定项目产品绑定、源/目标版本，维护 scope revision、审计和 receipt。人员活跃校验通过独立 Console `console:directory-users:read` service hop，短期证据绑定 actor/tenant/deployment/对象/字段/操作；业务事务不查询 Console 目录表。状态审批、结构调整和工单结果 outbox 仍待完整迁移。

## 数字资产读取（2026-09-15）

`GET /assets/api/v1/digital-assets` 接受 page、pageSize、search、status；`GET /assets/api/v1/digital-assets/:id` 不接受 query。人员权限为 `digital_assets:view`，独立服务 capability 为 `assets:digital-asset:read`，Runtime operation 为 `assets.digital-assets-list/view`。

`POST /assets/api/v1/digital-assets` 与 `PATCH /assets/api/v1/digital-assets/:id` 必须携带 `Idempotency-Key`。两者都要求由 Console 快照签发的、绑定用户/租户/Host deployment 的短期 `digital_assets:edit` permit；Runtime capability 分别为 `assets:digital-asset:create` 与 `assets:digital-asset:edit`。编辑请求中未出现的字段保留，`storage_location`、`owner_uid`、`project_code`、`environment_id` 和 `notes` 显式 `null` 清空；数字资产编号不可改。

BFF 编译当前人员对象范围，Runtime 校验签名身份、租户/部署、当前 credential/grant 和 15 秒 permit。数字资产只有 owner/project 范围，无法执行的部门或关系约束拒绝匹配，不降为全量。此批本地测试不证明目标环境已启用。

## GET /aims/api/v1/projects 与 /aims/api/v1/projects/:id

第一批 Aims 项目管理读取入口。Host 仅接受项目列表的 `page`、`pageSize`、`search`、`category`、`lifecycleStatus`、`portfolioId`、`participatingOnly`，详情不接受 query；浏览器不能传递 actor、部门、项目管理员范围、tenant 或 deployment。

BFF 从已验证 Enterprise 用户会话取得 uid/tenant/deployment，读取 Console Directory 的当前部门与管理部门，再复用 Aims `projects/admin` scoped-authorization 投影。它把这些受信范围与短期 `projects/view` permit 发送到固定 Runtime 操作 `POST /v1/enterprise/aims/projects:list` 或 `:view`；两者要求精确 `aims:projects:view`，固定 Enterprise service identity，并在 Runtime 再校验签名 actor、租户、部署、当前 credential/grant 和 15 秒 permit。Runtime 只调 Aims 既有项目可见性查询，保留项目成员、负责人、部门和 scoped-project-admin 的范围语义。

这批次是只读的：项目新建/编辑、成员、工作项、工时、周报、文档和审批仍由独立 Aims 提供，未注册的 Host API 继续返回明确不可用。目标环境仍需完成 Enterprise `aims:projects:view` grant verify 与登录后页面验收。

## GET /assets/api/v1/product-directory

浏览器使用 Host 已验证的 Console OIDC 用户会话。筛选字段：`page`（默认 1）、`pageSize`（默认 50，最大 100）、`keyword`、`productCode`、`productLine`、`watermark`。拒绝未知字段与数组，后续页携带首屏水位。

BFF 通过 Foundation 向 Console 查询 `assets/products/view` 的当前 scoped authorization，复用 Assets 范围编译器。产品主档没有部门维度，不能丢弃部门约束后当作全量；产品归属由 Runtime 同一只读事务中的实际行判断。浏览器不能覆盖 actor、tenant、deployment 或授权范围。

托管 Host 的业务 permit 使用经过 Gateway 密钥验证、且与用户 tenant 匹配的 Enterprise deployment；用户 access token 中的 Console 签发部署保持原样用于会话验证和 actor 委托，不与业务部署混用。未经验证的请求头不能选择 permit 部署。

调用链：Host → Foundation `callEnterpriseRuntime` → Runtime `POST /v1/enterprise/assets/product-directory` → 注册统一库的 Assets 内部目录服务。该 POST 是查询命令，不写事实、receipt/outbox 或历史快照，也不经过旧 Assets Worker。成功返回 `{code:0,data:{items,product_lines,total,page,pageSize,watermark}}`；只包含授权内产品与产品线，名称直接来自权威主档。

身份固定 `source_app=enterprise`、`client_id=sub=enterprise.runtime`、`token_use=service`；audience 为配置的 `data-runtime` 或 `tenant-runtime`。精确 capability `assets:product:read` 不加传输前缀；实际 audience 分别登记精确 grant，不借旧 app 身份或宽 scope。Runtime 要求显式 enterprise deployment binding，并每次校验当前 credential/grant。

内部 body 包含 query 和 BFF authorization（actorUid/tenant/deployment/resource/action/expiresAt/scope）。actor 匹配 bearer-bound 签名用户，资源/动作固定 products/view，期限最多 15 秒；租户和 Host deployment 匹配 JWT 与本地登记。schema、generation、域和表名仅来自本地配置。

错误：401 无有效身份；403 绑定/能力/范围不满足；400 无效筛选；409 水位变化需重新分页；503 登记或服务依赖不可用。业务响应不泄露内部诊断，设置 `Cache-Control: no-store`。

证据：Foundation HTTP 测试覆盖精确 scope、签名 actor 与伪造上下文不转发；Runtime 覆盖 JWT、授权证据绑定/期限和现有范围约束；真实隔离 MySQL 目录验证见[数据合同](../../docs/Unified-Enterprise-Data-Contract.md)。Runtime 实际 Ed25519/JWKS 验证、HTTP handler、当前凭证/精确 grant 查询与真实 MySQL 已由 `node data-runtime/scripts/test-enterprise-directory-mysql.mjs` 联合验证（含 owner 隔离、当前改名、错租户、撤销和依赖 503）。正式 OIDC、Console 用户授权到 BFF 的完整链路及环境 grant 启用仍待完成。


## Runtime POST /v1/enterprise/aims/product-requests:create

这是已接线的 Runtime 内部入口；Host 浏览器 BFF 为 `POST /aims/api/v1/products/:productCode/requests`，沿用原需求输入字段与校验。仅在 enterprise 启用、Aims writer 为 unified 且启动时通过所需受管视图验证后可用；否则启动拒绝不兼容配置或接口返回 503。

采用上述固定 Host 身份、签名 actor、明确部署绑定与当前 credential/grant 检查，精确 capability 为 `aims:product-requests:create`。请求头 `Idempotency-Key` 沿用原产品命令身份。body 为 `{productCode,tenant,deployment,authorization,input}`：tenant/deployment 必须匹配受信上下文；authorization 是既有 productcenter permit，resource/action 固定 `product_requests/create`，facts 的 product_code/actor_uid 必须匹配，expires_at 最多 15 秒；input 使用原 RequestDraft（expected_revision/title/problem_statement/source_type/urgency_level/可选 component_id）。未知字段拒绝，浏览器不得自行提交授权证据。

Runtime 在统一库事务内先锁定并核验持久迁移代际，再由原需求领域命令锁 workspace、重读成员事实、检查修订、写需求/audit/receipt，最后提交。相同 key 同 payload 复用原回执；不同 payload 冲突。返回 `{code:0,data:{receipt_id,replayed,value}}`。原领域错误状态保持，无法归类的 SQL/依赖故障脱敏为 503。

授权绑定单测和 `node data-runtime/scripts/test-enterprise-requests-mysql.mjs` 真实 HTTP/MySQL/race 验证已通过，包含旧 Go 入口重放、冲突、撤销、持久代际与依赖错误。新增授权事实预检的联合验证继续补充；不代表目标环境已启用。


### Host 授权编排

BFF 从已验证 Host 用户会话取得 uid/tenant/deployment；先调用内部 `POST /v1/enterprise/aims/product-authorization`（精确 `aims:products:authorization-object`，body 仅 `{productCode}`），取得该签名 actor 自身的 `productcenter.AuthorizationFacts`。此接口没有对应浏览器路由。BFF 将事实通过 Aims 原 `requireProductPermission` 的服务端数据源适配传给 Console，复用 Foundation 原产品范围求值；无权时仍按原可见性判断返回 403/404。获得许可后才构造短期 permit 并调用创建命令，浏览器不能提供授权事实或运行身份。

Foundation 已登记预检和创建两个固定操作，创建的 `Idempotency-Key` 保持传递；4 项 HTTP/身份/幂等测试和 Host typecheck 通过。服务初始化读取兼容视图定义需要数据库账户具有所需视图的 `SHOW VIEW` 权限，以及已批准的表级读写权限；不因此授予 CREATE/ALTER/DROP 等 DDL 权限。产品页面其余 API/动作与目标环境完整用户流程仍待验收。


## GET /aims/api/v1/products/:productCode/requests 与 /requests/:requestId

Host 列表/详情复用原 Aims 查询参数解析和 `product_requests/view` 对象授权流程。列表按原 page/pageSize、keyword、decisionStatus、sourceType、urgencyLevel、模块等筛选；详情只接受规范 UUID 且不接受额外 query。内部操作分别为 `POST /v1/enterprise/aims/product-requests:list`、`:view`，都要求精确 `aims:product-requests:read`。

Runtime 列表 body 公共字段与创建一致（授权动作改为 view），另含原 RequestPageQuery 格式的 query；详情改为 bizId。使用登记 read 模式及持久代际共享锁，调用原 `ListProductRequestsInTransaction` / `ReadProductRequestInTransaction`，保持 workspace 锁下授权、总数和结果一致，读取不写 receipt/audit。初始化额外验证 product_versions、product_version_plans、product_version_plan_scopes、product_version_plan_confirmations 视图，保留原需求版本关联信息。当前 RequestService 仍随 Aims unified writer 初始化，单独影子读取配置及完整产品页面链另行接续。

Host typecheck、真实 HTTP/MySQL/race 列表/详情验证已通过，覆盖分页、筛选、不同 workspace 隔离、actor/view permit、代际失效与读前后 receipt/audit 数量不变；不能据此声称页面所有动作已完成。


## 产品权限提示接口

`GET /aims/api/v1/product-permissions` 要求已验证的 Enterprise 用户会话，复用 Aims 全局产品启用权限检查，返回 `{ code: 0, data: { onboard: boolean } }` 并禁止缓存。产品范围授权不等同于全租户启用权限；实际启用命令仍独立检查授权。

Host 已接入以下 GET 路由，并直接复用 Aims 原权限处理函数：

- `/aims/api/v1/products/:productCode/permissions`
- `/aims/api/v1/products/:productCode/requests/permissions`
- `/aims/api/v1/products/:productCode/versions/permissions`

服务端数据源以已验证 Host uid 获取 Runtime 当前事实；同一 HTTP 请求内按 productCode 合并事实读取，作用域不跨请求/用户/租户。各动作仍分别调用原 Console/Foundation 授权，不由 Host 重建角色算法。响应结构与原页面一致，首先要求对应 view 权限；每个业务命令仍独立重鉴权。权限为岗位许可提示，不代表尚未接线的命令已可用，页面就绪状态与完整调用链继续验收。

Host typecheck、相关 lint 及原产品对象/列表/全局接入 7 项授权回归已通过；目标环境真实岗位与完整页面验收仍待完成。

## 产品版本规划写入

Host 以下路由复用 Aims 原版本/轻量计划参数校验与权限流程，通过仅服务端可注入的 `ProductCommandBridge` 进入统一 Runtime；独立 Aims 默认传输保持原行为。

| Host 路由（产品前缀 `/aims/api/v1/products/:productCode`） | Runtime 操作（`POST /v1/enterprise/aims/versions:`） |
| --- | --- |
| POST `/versions` | `create` |
| PATCH `/versions/:versionId/plan` | `plan-edit` |
| POST `/versions/:versionId/plan/items` | `plan-item-create` |
| PATCH `/versions/:versionId/plan/items/:scopeId` | `plan-item-edit` |
| DELETE `/versions/:versionId/plan/items/:scopeId` | `plan-item-delete` |
| POST `/versions/:versionId/plan/confirm` | `plan-confirm` |

所有写入要求 `Idempotency-Key`。创建版本使用精确 capability `aims:product-versions:create`，其余使用 `aims:product-versions:edit`；均要求产品版本 edit 对象权限。创建计划项另要求需求 view 与规划 edit，采用需求时另要求需求 decide；确认计划另要求规划 prioritize。短期 permit、actor、tenant、deployment 在 Runtime 再次核验。Host 的用户及租户/部署来自已验证会话，不能由浏览器 body 覆盖。统一服务使用原领域命令及同事务 receipt/audit，不新增平行状态。

验证：Foundation 12 项传输测试通过，覆盖六个新增操作的精确 capability、身份、actor 签名及幂等键；Host 类型检查通过。`node data-runtime/scripts/test-enterprise-planning-mysql.mjs` 真实 HTTP/MySQL/race 覆盖六操作及逐一重放、payload 冲突、附加授权拒绝、grant 撤销和审计晚失败完整回滚。Host BFF 请求级与登录后业务页面验收继续进行；版本/计划读取等未接线操作仍返回明确不可用。


## GET /aims/api/v1/products

Host 复用原 `productListInput`、Foundation 产品范围编译器及全局 onboard 判断，分别读取 Aims 与 Assets 的 Console 授权。内部固定操作 `POST /v1/enterprise/aims/product-list` 要求 `aims:products:view`，body 为 `tenant/deployment/input/authorization/assets_authorization`。租户、部署和 actor 从 Host 会话绑定；两份权限有效期均为 15 秒。

Assets 缺权生成空目录范围，不自动否定独立的 Aims 工作空间权限；当前名称、产品线、源产品及分组由 Runtime 按 Assets 范围过滤。不得回退到历史名称绕过主档权限。真实服务查询使用同一 Repeatable Read 事务读取授权范围、总数与分页；`catalog_generation` 不再伪造旧投影刷新凭据，统一目录接入管理命令需另行对齐当前事实契约。

Host 类型检查、相关 ESLint 与 Foundation 13 项精确传输测试已通过。Runtime 路由已接线；`node data-runtime/scripts/test-enterprise-catalog-mysql.mjs` 真实 HTTP/MySQL 验证通过，覆盖双域范围、改名、空 Assets 权限、actor/tenant/deployment 绑定、授权撤销和过时代际。目标环境登录后页面验收仍待完成。


## GET /aims/api/v1/products/:productCode/components

Host 复用原 `handleProductComponent` 参数校验和 `product_components/view` 对象授权，经固定 `aims.component-list` 操作调用 `POST /v1/enterprise/aims/components:list`，精确 capability 为 `aims:product-components:read`。parentId/page/pageSize 保持原参数合同，响应保留 snake_case 及根节点/子节点分页语义。

Runtime 在登记的只读业务操作事务内调用 `ListProductComponentsInTransaction`，验证父节点属于当前产品，保持原工作空间权限和版本事实核验。Host 类型检查、相关 lint 及 Foundation 18 项传输测试通过；组件专项真实 HTTP/H3 回归接续中。新增接口不代表模块创建、移动、编辑或删除已接入。

## GET /aims/api/v1/products/:productCode

Host 工作空间详情要求 `products/view` 对象权限，使用当前 Runtime 授权事实和 Foundation/Console 原授权流程。随后独立计算 Assets `products/view` 范围，经固定 `aims.product-workspace-view` 操作请求 `POST /v1/enterprise/aims/product-workspace:view`（capability `aims:products:view`）。body 为 `productCode/tenant/deployment/authorization/assets_authorization`，两份权限绑定同一已验证用户和 Host 部署，15 秒有效。

返回保留原 WorkspaceDetail snake_case；当前名称与产品线由授权目录读取，不以历史投影回填不可见名称。Host 拒绝无效产品编码及额外 query。Host 类型检查、ESLint 及 Foundation 19 项传输测试通过；Runtime 详情专项 MySQL/HTTP 验证已通过，覆盖实时改名、产品线来源可见性、空 Assets 授权、旧成员事实拒绝及读取不写 receipt/audit；锁定工作空间的查询需要根表及对应视图 UPDATE 权限（MySQL FOR UPDATE），不是业务写操作授权。登录后页面验收尚未完成。

## 版本生命周期 Runtime 接线

新增内部固定 POST `/v1/enterprise/aims/product-version:{edit|delete|transition|reopen|archive}`，请求体为 `productCode/tenant/deployment/input/authorization`，并携带 `Idempotency-Key`。`input` 为原 productcenter 命令类型，拒绝未知字段和额外 query；租户、Host 部署、签名用户及短期 permit 继续分别核验。

精确服务 capability 为 `aims:product-versions:<action>`，其中 transition 使用原 `edit` capability；人员 permit 对应 `product_versions` 的 edit/delete/reopen/archive，transition 同样为 edit。服务复用原状态机、回执、审计和登记反馈来源，在统一写事务中执行；不能跳过发布证据或反馈来完成状态变更。初始化验证所需受管视图。

当前 Runtime 入口及初始化编译/单测通过；真实 HTTP/MySQL、Host BFF 及登录后页面生命周期验收继续进行，不代表这些 UI 入口已全部就绪。

## 知识产权资产（整合分支候选）

`GET /assets/api/v1/ip-assets` 支持实际服务端分页和筛选；`GET /assets/api/v1/ip-assets/:id` 要求精确对象。两者要求人员 `ip_assets:view` 与服务 `assets:ip-asset:read`，Runtime 操作为 `assets.ip-assets-list/view`，同一 Registry snapshot 返回 total/summary/page。关联产品不可见时不返回其全量计数。

`POST /assets/api/v1/ip-assets` 与 `PATCH /assets/api/v1/ip-assets/:id` 要求 `Idempotency-Key`、人员 `ip_assets:edit` 与各自 `assets:ip-asset:create/edit`。BFF 仅接受白名单业务字段，会话重建 actor/tenant/Host permit；Runtime 再校验对象范围、Registry generation、owning receipt 和审计事务。编辑拒绝 ip_code；省略 nullable 字段保留，显式 null 清空，必填字段及非法日期/字典值拒绝。产品/文档关联尚未迁入；候选 migration 与环境启用未验收，不代表测试站已经支持写入。

## 工作项完成审批（整合分支候选）

`POST /aims/api/v1/work-items/:id/completion` 与 `completion-replay` 必须携带幂等键；完成申请 input 为 expectedVersion，人工 replay input 为 expectedOperationVersion 和 reason，二者都携带 projectId。完成申请冻结工作项及子项快照后，通过 Aims owning outbox 请求 Workflow；回调按审批证据更新状态，撤回和人工 replay 保持原 command 身份。人工 replay 单独要求 `integration_operations:replay` 及实际项目管理关系，不以普通编辑权限替代。具体字段、固定 action/回调路径、身份和 grants 见根 MODULE_CONTRACTS 的 work-item completion 合同。Workflow BFF 必须在查询目录或重签 actor 前校验入站 command hash 与 HMAC。scheduled 路由已接入真实 Gateway Binding，缺少绑定/明确 origin/目标部署时拒绝发送；候选 schema/grants、任务启用和完整环境联调尚未完成。

`POST /aims/api/v1/work-items/:id/{start|reset|reopen}` 与 `DELETE /aims/api/v1/work-items/:id` 均要求幂等键，input 仅接受 expectedVersion，并携带 projectId；请求不接受人员 permit。状态流转限定 todo→in_progress、in_progress→todo、completed→in_progress 三条边，按项目 workflow_transitions 校验，人员权限沿用 `work_items:edit`，服务 capability 分别为 `aims:work-item-{start|reset|reopen}:execute`。删除是敏感动作：人员权限要求独立的 `work_items:delete`，服务 capability 为 `aims:work-item-delete:execute`，编辑权限不构成删除授权；Runtime 在同一事务冻结工作项与子项删除证据、写 `work_item_deletion_evidence` 和项目活动日志。两类动作都按项目数据范围（projectScope）执行。Host 工作项详情页当前只提供状态流转按钮，删除入口尚未接入界面。

## 工作项任务分配确认与撤回（整合分支候选，2026-09-15）

`POST /aims/api/v1/work-items/:id/confirm-distribute` 与 `POST /aims/api/v1/work-items/:id/revoke-distribute` 均要求 `Idempotency-Key`、拒绝 query，input 仅接受 `expectedVersion`（目标工作项内容版本）并携带 `projectId`，不接受人员 permit。人员权限：确认为显式授予的 `work_items:confirm`，撤回为 `work_items:edit`；服务 capability 分别为 `aims:work-item-distribute-confirm:execute`、`aims:work-item-distribute-revoke:execute`，Runtime 路由 `POST /v1/enterprise/aims/work-items:confirm-distribute|revoke-distribute`。

Runtime 在同一 Registry 写事务内锁定项目（须 active）、目标及全部子任务：仅 `target` 层可操作；确认不接受需求类目标，且要求全部子任务为 `planning`，逐个置为 `todo`；撤回沿用原项目经理规则：项目负责人、活跃的经理角色项目成员或受信项目管理范围内的管理员，且全部子任务为 `todo`，逐个退回 `planning`。目标自身状态不变；复用评审锁与里程碑完成锁校验。每个子任务写 `work_item_changelog`，目标写 `project_activity_logs`，receipt 同事务提交，同键重放返回冻结结果、异载荷拒绝；审计失败整体回滚。receipt 命令 schema 版本为 `distribution-confirm.v1` / `distribution-revoke.v1`（受 `command_schema_version VARCHAR(30)` 约束）。

`POST /aims/api/v1/work-items/:id/confirm-append` 与 `reject-append` 沿用同一合同（`expectedVersion` + `projectId` + 幂等键），人员权限均为显式 `work_items:confirm`，服务 capability 分别为 `aims:work-item-append-confirm:execute`、`aims:work-item-append-reject:execute`，receipt schema 版本 `append-confirm.v1` / `append-reject.v1`。二者只作用于目标执行中追加的 `planning` 子任务，已在执行的子任务不受影响：确认把它们置为 `todo`（无待确认追加任务时 409 `no_planning_children`，需求类目标拒绝）；拒绝先解除其承接的目标成果（`matter_id` 置空，保留目标成果），再删除其自有成果与任务本身，无追加任务时成功返回 0 条。

`POST /aims/api/v1/work-items/:id/append-tasks` 要求幂等键，input 仅接受 `expectedVersion` 与 `subtasks`（1～50 个，沿用原追加任务字段：负责人、标题、描述、起止日期、预计工时及至少 1 条自有成果），并携带 `projectId`。人员权限为 `work_items:edit`，服务 capability 为 `aims:work-item-append-tasks:execute`，receipt schema 版本 `append-tasks.v1`。Runtime 在同一写事务内：沿用原项目经理规则（负责人、活跃经理角色成员或受信项目管理员）；仅接受执行中（in_progress/in_review/completed）的非需求类目标；沿用统一创建规则，要求负责人为项目负责人或活跃项目成员；先替换该目标下既有的规划态追加草稿（解除其承接的目标成果、删除自有成果与任务），再创建规划态任务及自有成果，写项目审计与 receipt。创建的任务仍须经 `confirm-append` 进入待办或经 `reject-append` 移除。

`PUT /aims/api/v1/work-items/:id/breakdown` 要求幂等键，input 仅接受 `expectedVersion` 与 `subtasks`（0～50 个；空列表清除全部规划态子任务），并携带 `projectId`。人员权限为 `work_items:edit`，服务 capability 为 `aims:work-item-breakdown:execute`，receipt schema 版本 `breakdown-save.v1`。Runtime 在同一写事务内沿用原分解规则：项目经理规则；目标须已配置成果要求；任一子任务离开 `planning` 即 409 `distribution_locked`；有任务时每条目标成果须恰好被一个任务承接（`targets_uncovered` / `targets_duplicated`）；单任务及合计计划工时不得超过目标控制工时。统一路径新增：任务 `id` 必须是该目标现有的规划态子任务（否则 409 `work_item_breakdown_child_mismatch`），负责人须为项目负责人或活跃项目成员。未保留的子任务先解除并重置其承接的目标成果、删除自有成果后移除；保留或新建的任务按载荷重建承接与自有成果，写项目审计与 receipt。

`GET /aims/api/v1/work-items/:id/breakdown-context` 不接受查询参数，人员权限为 `work_items:view`（项目范围 permit），服务 capability 为 `aims:work-items:view`，Runtime operation `work-items:breakdown-context` 复用原只读上下文（目标、成果要求、子任务及其成果、相关文档）并附加 `editVersion`；Host 另附当前主体的 `permissions.edit` / `permissions.confirm`，仅用于入口展示，服务端写入仍逐项重鉴权。

Host 页面 `/aims/work-items/:id/breakdown`（`enterprise-work-item-breakdown`）承载保存分解、确认/撤回分配、追加任务及其确认/拒绝；原独立页面的前端审批面板改为按上述权限直接调用对应写动作，服务端边界不变。需求分解提交仍由独立 Aims 提供；候选代码与 capability 未在任何环境启用。

## GET /aims/api/v1/codocs/documents/:uuid/content（2026-09-17）

项目文档正文读取。Codocs 在 ADR-018 §2 范围表中保留独立运行边界，因此这是真实的跨应用调用，不是宿主内查询。

Host 先要求登录用户，再在本域用 `assertCodocsProjectDocumentAccess(projectId, uuid, uid)` 判定该项目文档的访问权限并取得 `projectCode`，然后复用 Aims 共享 helper `getCodocsProjectDocumentContent({ sourceApp: 'enterprise' })` 调 Codocs Service API。查询参数 `projectId` 必填（正整数），`uuid` 必须是规范 UUID；`preview=1` 时权限或正文读取失败降级为 `contentUnavailable`，与独立应用一致，非预览模式照常抛错。

身份是宿主自己的 `enterprise` / `enterprise.runtime`，不借 `aims.runtime`；Codocs 侧有与 Aims 并列的授权条目，精确 capability `codocs:project-document:content:read`。`enterprise/server/utils/enterpriseCodocsProjectDocument.ts` 的 `requiredCapability` / `audience` 是 readiness 策略推导该能力的唯一事实源。

完整信任边界、回归矩阵与验收状态见根 `docs/MODULE_CONTRACTS.md`「ADR-018 Enterprise → Codocs 项目文档正文」。C000001 已完成 grant 与令牌签发探测，Worker 部署与浏览器验收未完成。
