# ADR-018 已登记 Operation 覆盖矩阵

核对日期：2026-09-15。核对基线为本次审计开始时的已提交 HEAD `bbd5045e`；未以工作树中未提交的 Aims、Assets、Runtime 或环境文件作为证据。范围是当前 `feat/adr018-enterprise-integration` 源码中由 Data Runtime `/v1/enterprise/**` router 登记的 operation；不把独立应用的 legacy/runtime 路由、尚未登记的页面调用，或计划中的 operation 算入本表。

本表是 INT-108 所要求的追溯制品，不改变 [实施计划](./Unified-Enterprise-Implementation-Plan.md) 的状态。ADR-018 的目标 Host 仍是 `enterprise`，但 ADR 本身不表示任一运行路径已切换；Host 合同也要求未登记 BFF 明确不可用。[P0–P2 证据审计](./Unified-Enterprise-P0-P2-Evidence-Audit.md) 对 INT-108 的状态仍为“部分”。

## 后续增量：ec42f82d（已提交，未部署）

下列增量不把早期基线表的其他历史缺口视为已解决。

| Operation | Runtime route / Host BFF | capability / 人员权限 | 代码与隔离证据 | 尚未完成 |
| --- | --- | --- | --- | --- |
| 工作项创建、基本信息编辑 | `POST /v1/enterprise/aims/work-items:create|edit`；Host `POST /aims/api/v1/projects/:id/work-items`、`PUT /aims/api/v1/work-items/:id` | `aims:work-item-create:execute`、`aims:work-item-edit:execute`；`work_items:create|edit` | `enterprise/test/aims-work-item-write-contract.test.mjs`、Runtime permit 测试、`enterprise_project_member_write_mysql_test.go` 隔离 MySQL race；receipt/事实/audit 回滚与旧版本冲突 | 状态/结构/版本关联/outbox、环境 grant/制品/浏览器验收 |
| 工作项任务分配确认、撤回 | `POST /v1/enterprise/aims/work-items:confirm-distribute|revoke-distribute`；Host `POST /aims/api/v1/work-items/:id/confirm-distribute|revoke-distribute` | `aims:work-item-distribute-confirm:execute`、`aims:work-item-distribute-revoke:execute`；`work_items:confirm` / `work_items:edit` | `enterprise/test/aims-work-item-write-contract.test.mjs`、`enterprise_work_item_write_actions_test.go`（路由、capability、permit 映射）、`enterprise_work_item_distribution_test.go`（receipt 标识长度）、`enterprise_project_member_write_mysql_test.go` 隔离 MySQL（版本冲突、需求目标、确认/重放/异载荷、重复确认、普通成员撤回拒绝、经理角色成员撤回、审计失败回滚、负责人撤回） | 分配页面未登记进 Host；任务分解保存、追加任务、需求分解提交；环境 grant/制品/浏览器验收 |
| 工作项追加任务确认、拒绝 | `POST /v1/enterprise/aims/work-items:confirm-append|reject-append`；Host `POST /aims/api/v1/work-items/:id/confirm-append|reject-append` | `aims:work-item-append-confirm:execute`、`aims:work-item-append-reject:execute`；均为 `work_items:confirm` | `enterprise/test/aims-work-item-write-contract.test.mjs`、`enterprise_work_item_write_actions_test.go`（路由与 confirm permit）、隔离 MySQL（仅作用于追加的规划态任务、无追加任务确认 409、拒绝删除追加任务并审计、无追加任务拒绝返回 0） | 追加任务创建、任务分解保存、需求分解提交；分配页面未登记进 Host；环境 grant/制品/浏览器验收 |
| 工作项追加任务创建 | `POST /v1/enterprise/aims/work-items:append-tasks`；Host `POST /aims/api/v1/work-items/:id/append-tasks` | `aims:work-item-append-tasks:execute`；`work_items:edit` + 事务内项目经理规则 | `enterprise/test/aims-work-item-write-contract.test.mjs`、`enterprise_work_item_write_actions_test.go`（路由、capability、仅 edit permit）、隔离 MySQL（普通成员 403、非成员负责人 409 且零写入、创建任务与自有成果、重放冻结 receipt、再次追加替换草稿、确认后进入待办） | 任务分解保存、需求分解提交；分配页面未登记进 Host；环境 grant/制品/浏览器验收 |
| 工作项任务分解保存 | `POST /v1/enterprise/aims/work-items:breakdown`；Host `PUT /aims/api/v1/work-items/:id/breakdown` | `aims:work-item-breakdown:execute`；`work_items:edit` + 事务内项目经理规则 | `enterprise/test/aims-work-item-write-contract.test.mjs`、`enterprise_work_item_write_actions_test.go`（路由、capability、仅 edit permit）、隔离 MySQL（普通成员 403、成果未覆盖/重复承接 400、外部子任务 id 409 且零写入、保存承接与自有成果、重放冻结 receipt、再次保存更新保留任务并移除未保留任务、确认分配后 409 锁定） | 需求分解提交；环境 grant/制品/浏览器验收 |
| 任务分配上下文读取与分配页面 | `POST /v1/enterprise/aims/work-items:breakdown-context`；Host `GET /aims/api/v1/work-items/:id/breakdown-context`，页面 `/aims/work-items/:id/breakdown` | `aims:work-items:view`；`work_items:view` 项目范围 permit | `TestEnterpriseWorkItemBreakdownContextReadTarget`（路由、路径、current_user、非法 id 与伪造查询键拒绝）、`enterprise/test/aims-work-item-write-contract.test.mjs`（页面登记、Foundation operation、幂等键与版本、useConfirm、无遗留 store）、隔离 MySQL（普通成员可读而写入仍需经理、成果承接与自有成果的 sourceDeliverableId 映射、工作项文档与待审记录、editVersion 稳定、缺 current_user 401、非成员与他项目成员 403、未知工作项 404、读取零副作用） | 真实浏览器与环境联调；视图安装前统一路径 503 |
| 数字资产列表、详情 | `POST /v1/enterprise/assets/digital-assets:list|view`；Host `GET /assets/api/v1/digital-assets[/:id]` | `assets:digital-asset:read`；`digital_assets:view` | `enterprise/test/digital-assets-reads-bridge.test.mjs`、Runtime permit/adapter owner/project scope、Foundation operations | 数字资产写链、真实 SQL 分页、环境 grant/制品/浏览器验收 |

## 判读规则

- **Operation** 是 Runtime router 的固定、版本化/命名 operation，不是泛指页面动作。用 `/v1/enterprise/**` 路由和其 action map 作为登记证据。
- **grant** 一栏写代码要求的精确 service capability；Host 身份固定为 `enterprise` / `enterprise.runtime`，实际 audience 为部署配置的 `data-runtime` 或 `tenant-runtime`。只有明确的环境 verify 与实际 token 签发探测才可写作“环境已核验”。本次已读证据没有给出本矩阵每项均已核验的结论。
- **页面** 只说明组合入口或页面/API 是否在源码登记；它不是登录后操作验收。`未见 Host 页面` 也不代表 operation 无用，例如 scheduler worker。
- **测试证据** 记录已在文档中声明的本地/隔离验证，不重复宣称本次重新执行。所有行均还受下文共同缺口约束。

## Host 用户请求与产品目录

| Operation | Runtime route | Host BFF | capability / grant | 页面或调用点 | 已登记测试证据 | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| Aims 项目读取（`list`、`view`） | `POST /v1/enterprise/aims/projects:{list,view}` | `GET /aims/api/v1/projects`；`GET /aims/api/v1/projects/:id` | `aims:projects:view`；目标环境 grant verify 尚待完成 | `/aims/projects`、`/aims/projects/:id` | `enterprise/test/aims-projects-bridge.test.mjs`；Foundation operation 与 Runtime/Aims scope 定向测试 | 仅只读；项目写入、成员、工作项、工时、周报、文档、审批仍为独立 Aims；登录页面验收待完成 |
| Assets 产品目录 | `POST /v1/enterprise/assets/product-directory` | 已有 Host BFF（页面 API 文档为 `GET /assets/api/v1/product-directory`） | `assets:product:read`；双 audience 精确 grant 要求已定义，环境启用待核验 | 产品目录/产品线读取 | `data-runtime/scripts/test-enterprise-directory-mysql.mjs`；Foundation HTTP 身份与 scope 测试 | Enterprise OIDC、Console 用户授权到 BFF、环境 grant 启用待完成 |
| Aims 产品总目录 | `POST /v1/enterprise/aims/product-list` | `GET /aims/api/v1/products` | `aims:products:view`；同时以 Assets 范围过滤当前主档 | 顶栏产品切换、当前目录 | `test-enterprise-catalog-mysql.mjs`；Foundation 13 项 transport；Host typecheck/lint（文档记录） | 登录后页面验收和环境 grant 证据未列出 |
| Aims 产品空间详情 | `POST /v1/enterprise/aims/product-workspace:view` | `GET /aims/api/v1/products/:productCode` | `aims:products:view`，并需要 Assets `products:view` 范围事实 | `/aims/products/:productCode` 概览 | Runtime HTTP/MySQL 详情专项；Foundation 19 项 transport（文档记录） | 登录后页面验收待完成；概览的功能/目标/路线图计数另有未接线项 |
| Aims 组件读取 | `POST /v1/enterprise/aims/components:list` | `GET /aims/api/v1/products/:productCode/components` | `aims:product-components:read` | 模块选择器、结构页 | Foundation 18 项 transport；Host typecheck/lint（文档记录） | 该早期读取说明未构成写操作就绪；下方组件命令有单独证据，环境/OIDC仍待完成 |
| Aims 产品授权事实预检 | `POST /v1/enterprise/aims/product-authorization` | 无浏览器路由；BFF 内部调用 | `aims:products:authorization-object` | 为需求/权限提示等 BFF 构造 permit | 4 项 HTTP/身份/幂等测试与 Host typecheck（文档记录） | 不是用户可调用 API；目标环境完整用户流程待验收 |
| Aims 产品接入候选与接入（`candidates`、`candidate`、`line-candidates`、`onboard`、`onboard-line`） | `POST /v1/enterprise/aims/product-onboard:{candidates,candidate}`；`POST /v1/enterprise/aims/product-line-onboard:{candidates,onboard}` | `GET /aims/api/v1/product-candidates`；`POST /aims/api/v1/products` | `aims:products:onboard`；还需绑定的 Assets 查看授权 | 产品/产品线接入 | `test-enterprise-onboarding-http-mysql.mjs`；Foundation 30 项 transport；H3、Aims/Host typecheck（文档记录） | 文档明确“未发布”；OIDC 浏览器和环境授权验收待完成 |

## Aims 需求、组件、功能与版本

| Operation | Runtime route | Host BFF | capability / grant | 页面或调用点 | 已登记测试证据 | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| 需求读取（`list`、`view`） | `POST /v1/enterprise/aims/product-requests:{list,view}` | `GET /aims/api/v1/products/:p/requests`；`GET .../requests/:r` | `aims:product-requests:read` | `/aims/products/:p/requests`、详情/合并轨迹 | `test-enterprise-requests-mysql.mjs`；请求 H3/权限证据见 readiness | 目标环境授权、登录后页面验收未完成 |
| 创建需求 | `POST /v1/enterprise/aims/product-requests:create` | `POST /aims/api/v1/products/:p/requests` | `aims:product-requests:create`，`Idempotency-Key` | 需求新建 | `test-enterprise-requests-mysql.mjs`，含重放、冲突、撤销、generation（文档记录） | 环境启用和完整页面流程待验收 |
| 需求动作（`edit`、`decide`、`merge`、`source-list`、`source-create`、`source-delete`） | `POST /v1/enterprise/aims/product-requests:{edit,decide,merge}`；`POST /v1/enterprise/aims/request-sources:{list,create,delete}` | 对应 `PATCH/POST` requests、`merge` 和 sources 路由均在 Host 文件树登记 | 每个 action 的 `aims:product-requests:<action>`；读取仍为 `...:read` | 请求编辑、决策、来源增删、合并 UI | readiness 记录四个写动作的 Runtime HTTP/MySQL 与 H3；`merge` 的 Host/Runtime 登记见 router | 文档同时说合并的 Host/Runtime 接口“尚未注册”，与当前 Host route 文件及 Runtime map 有冲突；须以一次实际 Host request/route test 解决，不能据此宣称合并链完成。外部反馈绑定还需真实 outbox owner/deployment |
| 组件命令（`create`、`edit`、`move`、`delete`） | `POST /v1/enterprise/aims/components:{create,edit,move,delete}` | `POST .../components`；`POST .../:id/edit`；`POST .../:id/move`；`DELETE .../:id` | `aims:product-components:{create,edit,move,delete}` | `/aims/products/:p/structure`、模块管理/移动表单 | `test-enterprise-components-http-mysql.mjs`；Foundation 34 项 transport；H3/Host transport（文档记录） | 实际环境授权与 OIDC 页面验收待部署流程；早期 API 文档的“读取不代表写入接入”已被后续 readiness 增量取代，需在后续文档整合时消除陈述漂移 |
| 功能目录与关系（`cycles`、`list`、`view`、`create`、`edit`、`delete`、`component-assign`、`lifecycle`、`request-list`、`request-link`、`roadmap`、`unscheduled`） | `POST /v1/enterprise/aims/features:<action>` | 相应 features、requests、roadmap、planning-cycles Host routes 已在文件树登记 | `aims:product-features:read`（读取）；各写 action 使用 `aims:product-features:<action>`；优先级读取为 `aims:product-priorities:read` | 功能详情、需求关联、生命周期、只读路线图 | `test-enterprise-features-http-mysql.mjs`；`enterprise/test/feature-bridge.test.mjs`；Foundation 46 项 transport（文档记录） | 文档称本包未部署，实际环境授权和 OIDC 浏览器验收尚待完成 |
| 版本/轻量计划读取（`list`、`view`、`plan`、`plan-items`） | `POST /v1/enterprise/aims/versions:{list,view,plan,plan-items}` | 对应 versions、plan、plan/items GET 路由 | `aims:product-versions:read` | 版本列表/详情、计划和范围读取 | `test-enterprise-planning-mysql.mjs`；Host typecheck、Foundation transport（文档记录） | API_SPEC 早期称读取未接线，与当前 router/Host route 文件存在陈述漂移；需请求级回归与目标环境页面验收 |
| 版本创建与轻量计划写入（`create`、`plan-edit`、`plan-item-create`、`plan-item-edit`、`plan-item-delete`、`plan-confirm`） | `POST /v1/enterprise/aims/versions:<action>` | 对应 `POST /versions`、`PATCH /plan`、`POST/PATCH/DELETE /plan/items`、`POST /plan/confirm` | `aims:product-versions:create`（create）或 `aims:product-versions:edit`（其余）；均需对象 permit | 版本新建、计划与范围编辑/确认 | `test-enterprise-planning-mysql.mjs`，覆盖 6 operation 的 race/replay/grant revoke；Foundation 12 项 transport（文档记录） | Host 请求级和登录后业务页面验收仍进行；环境 grant 无逐项核验记录 |
| 版本生命周期与验收发布（`edit`、`delete`、`transition`、`reopen`、`archive`、`accept`、`publish`、`acceptance-preview`） | `POST /v1/enterprise/aims/product-version:<action>` | 相应 versions、acceptances、publish/lifecycle Host routes 已登记 | `aims:product-versions:read`（preview）或 `aims:product-versions:<action>`；`transition` 使用 edit capability | 版本详情、验收、发布和生命周期 UI | `test-enterprise-version-release-http-mysql.mjs`；版本相关 H3/bridge 测试（文档记录） | API_SPEC 仍说实际 Host BFF/生命周期页面验收继续进行；不得把 Runtime 通过等同 UI 完成 |
| 验收/发布历史与执行汇总（`acceptance-list`、`acceptance-view`、`release-list`、`release-view`、`execution-coordination`、`execution-project-authorization`） | `POST /v1/enterprise/aims/product-version:<action>` | acceptances、releases、execution-coordination GET 路由；执行授权为内部 BFF 预检 | `aims:product-versions:read`；执行授权还要求对应项目范围 | 版本验收/发布历史；执行汇总页 | `test-enterprise-version-release-http-mysql.mjs`；`enterprise/test/version-history-bridge.test.mjs` | 未部署；实际 OIDC 页面验收另行记录 |
| 轻量版本项目承接（`detail`、`projects`、`requirements`、`project-authorization`、`create`） | `POST /v1/enterprise/aims/handoff:<action>` | handoff projects/requirements/detail GET；`POST .../planning-items/:id/handoffs` | `aims:product-priorities:read`、`...:project-authorization`、`...:handoff`，并保留产品/来源/版本/需求对象权限 | `planning-items/:id/handoff` 与版本 plan | `test-enterprise-handoff-http-mysql.mjs`；`enterprise/test/handoff-bridge.test.mjs`；Foundation 56 项 transport（文档记录） | 两项新增 priority capability 的既有 OAuth 证据不覆盖；环境登记/探测与 OIDC 页面验收待完成 |

## Assets 产品主档与 Altoc 交付激活

| Operation | Runtime route | Host BFF | capability / grant | 页面或调用点 | 已登记测试证据 | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| Assets 产品读取（`list`、`view`、`dictionaries`、`categories`、`base-candidates`、`asset-candidates`） | `POST /v1/enterprise/assets/products:{list,view,base-candidates,asset-candidates}`；`POST /v1/enterprise/assets/product-{dictionaries,categories}:list` | products、link-candidates、dictionaries、asset-categories GET 路由 | `assets:product:read` | 产品台账/目录、关联候选、字典 | `test-enterprise-assets-products-mysql.mjs`；H3、Foundation 固定映射 69 项（文档记录） | OIDC 页面和独立 Codocs deployment/grant 验收待发布阶段 |
| Assets 产品/产品线写入（`create`、`edit`、`category-admin-list`、`category-save`） | `POST /v1/enterprise/assets/products:{create,edit}`；`POST /v1/enterprise/assets/product-categories:{admin-list,save}` | `POST/PATCH /assets/api/v1/products`；产品分类 admin 的 GET/POST/PUT 路由 | `assets:product:edit` 或 `assets:admin:admin` | 产品维护、产品线/分类维护 | 同上；该专项覆盖当前 grant、actor、Registry、physical receipt 映射 | 需要已应用 Assets owning receipt DDL、正式源迁移、环境部署和页面验收；文档未提供完成证据 |
| Assets 产品关联（`link-base`、`link-asset`、`link-document`） | `POST /v1/enterprise/assets/products:{link-base,link-asset,link-document}` | `POST /assets/api/v1/products/:id/{bases,assets,documents}` | 关联写要求 `assets:product:edit`，并有被关联对象的独立范围/文档证明 | 产品关联基线、资产、文档 | `test-enterprise-assets-products-mysql.mjs`；H3 覆盖双权限与伪造证明拒绝 | links 迁移、目标 Codocs deployment/grant、OIDC 页面验收待发布；不能把本地 H3 当作跨部署验收 |
| Assets 字典与实物/资源资产读取（`dictionaries`、`list`、`view`） | `POST /v1/enterprise/assets/dictionaries:list`；`POST /v1/enterprise/assets/assets:{list,view}` | `GET /assets/api/v1/asset-dictionaries`；`GET /assets/api/v1/assets`；`GET /assets/api/v1/assets/:id` | `assets:asset-item:read`，并编译 `asset_items:view` 对象范围 | `/assets/admin/dictionaries`、`/assets/physical`、`/assets/resources`、`/assets/items/:id` | `enterprise/test/assets-reads-bridge.test.mjs`；Runtime server/adapter、Foundation operation 与 Enterprise 全量测试 | Host 仅开放只读入口；新增、编辑、删除及未迁移的其他 Assets 页面继续停用；目标环境 grant 与登录页面验收待完成 |
| Altoc 合同激活交付 | `POST /v1/enterprise/altoc/contracts:activate-delivery` | `POST /altoc/api/v1/contracts/:contractCode/activate-delivery` | 代码 capability/环境 grant 的逐项依据未在已读 ADR-018 readiness 文档列出 | 未见组合后的 Altoc 页面证据 | `enterprise/test/contract-activation-bridge.test.mjs` 和 Runtime MySQL 测试文件存在；未在审计材料中找到对应完成回执 | 缺完整 capability/grant、页面与环境验收材料；本行只能证明 Runtime/Host 路由登记，不能证明业务链可用 |

## Aims 项目执行只读覆盖

下表补齐项目执行工作区的操作。每行把**已登记**（提交基线中的 Runtime/Host 或受信代理）、**已测试**（本地/隔离测试文件）和**未部署**（没有目标环境 grant verify、实发 token 探测、部署回执或已验证登录会话）分开写。除特别标明的项目文档代理外，这些都是 `POST /v1/enterprise/**` Runtime operation；所有读取仍要求当前用户、租户、部署和短期对象范围 permit 一致，未新增默认人员权限。

| 操作 | capability / 范围合同 | 已登记 | 已测试 | 部署状态 |
| --- | --- | --- | --- | --- |
| 工作项读取（`list`、`view`） | `aims:work-items:view`；`work_items:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/work-items:{list,view}`；Host `GET /aims/api/v1/work-items`、`/:id`；`/aims/work-items` | `enterprise/test/aims-work-items-bridge.test.mjs`；`data-runtime/internal/server/enterprise_work_items_test.go` | **未部署**；不含创建、编辑、分配、确认或删除 |
| 项目工时读取（`list`、`view`） | `aims:time-entries:view`；`timesheet:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/time-entries:{list,view}`；Host 项目 `time-entries` list/detail；项目工时页面 | `enterprise/test/aims-time-entries-bridge.test.mjs`；`data-runtime/internal/server/enterprise_time_entries_test.go` | **未部署**；不含填报、审批或编辑 |
| 跨项目工时总览 | `aims:timesheet-overview:view`；`timesheet:view` 与可见项目范围 | Runtime `POST /v1/enterprise/aims/timesheet-overview:view`；Host `GET /aims/api/v1/timesheet`；`/aims/timesheet` | `enterprise/test/aims-timesheet-overview-contract.test.mjs`；`data-runtime/internal/server/enterprise_timesheet_overview_test.go` | **未部署**；页面明确不提供填报或审批 |
| 项目周报读取（`list`、`view`） | `aims:weekly-reports:view`；`weekly_reports:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/weekly-reports:{list,view}`；Host 项目 `weekly-reports` list/detail；项目周报页面 | `enterprise/test/aims-weekly-reports-bridge.test.mjs`；`data-runtime/internal/server/enterprise_weekly_reports_test.go` | **未部署**；不含创建、提交、审阅、发布或冻结 |
| 跨项目周报总览 | `aims:weekly-report-overview:view`；`weekly_reports:view` 与可见项目范围 | Runtime `POST /v1/enterprise/aims/weekly-report-overview:view`；Host `GET /aims/api/v1/weekly-reports`；`/aims/weekly-reports` | `enterprise/test/aims-weekly-report-overview-contract.test.mjs`；`data-runtime/internal/server/enterprise_weekly_report_overview_test.go` | **未部署**；不含写入或审阅动作 |
| 项目成员列表 | `aims:project-members:view`；用户侧 `projects:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/project-members:list`；Host 项目 `members` GET；`/aims/projects/:id/members` | `enterprise/test/aims-project-members-bridge.test.mjs`；`data-runtime/internal/server/enterprise_project_members_test.go` | **未部署**；不含成员增删或角色变更 |
| 项目需求读取（`list`、`view`） | `aims:requirements:view`；`requirements:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/project-requirements:{list,view}`；Host 项目 `requirements` list/detail；项目需求页面 | `enterprise/test/aims-project-requirements-bridge.test.mjs`；`data-runtime/internal/server/enterprise_project_requirements_test.go` | **未部署**；不含需求编辑、评审或任务转换 |
| 项目计划读取（里程碑、工作项） | `aims:project-plan:view`；用户侧 `milestones:view`、`work_items:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/project-plan:{milestones,items}`；Host 项目 `plan` GET；`/aims/projects/:id/plan` | `enterprise/test/aims-project-plan-contract.test.mjs`；`data-runtime/internal/server/enterprise_project_plan_test.go` | **未部署**；不含排序、结转或计划写入 |
| 项目 Board | `aims:project-board:view`；用户侧 `work_items:view` 和项目对象范围 | Runtime `POST /v1/enterprise/aims/project-board:view`；Host 项目 `board` GET；`/aims/projects/:id/board` | `enterprise/test/aims-project-board-contract.test.mjs`；`data-runtime/internal/server/enterprise_project_board_test.go` | **未部署**；原列状态只读，不含拖拽或状态迁移 |
| 项目文档安全代理（`list`、`view`、`open`） | `aims:project-documents:read`；用户侧 `documents:view`、项目对象范围和 Enterprise→Aims 签名服务命令 | **不登记为 Enterprise Runtime operation**：Host 项目 `documents`、`/:documentId`、`/:documentId/open` 受信代理到 Aims service endpoint，再由 Aims 访问 Codocs | `enterprise/test/aims-project-documents-bridge.test.mjs`；`enterprise/test/aims-project-documents-readiness.test.mjs` | **未部署**；仍缺目标环境双跳 service grant、Service Binding/部署绑定和登录会话验收 |

## Assets 导出领域边界

| 操作 | capability / 范围合同 | 已登记 | 已测试 | 部署状态 |
| --- | --- | --- | --- | --- |
| Assets 产品目录受限导出 | 同时精确要求 `assets:product:read` 和 `assets:product:export`；拒绝 `assets:*`、`*` 和任一单独 scope | 仅 Assets 领域 Runtime `GET /v1/assets/service/products/catalog/export`；必须显式 fields，只允许产品代码、名称、产品线、状态和可接入标记，保留分页/watermark | `data-runtime/internal/apps/assets/product_catalog_test.go` 覆盖双 scope、字段白名单、隐藏关系/所有人不泄露、分页及未登记导出路径 | **未部署**；没有 `/v1/enterprise/assets/**` operation、Enterprise Host BFF 或页面，因此不得把此领域导出写作 Enterprise 已开放能力 |

## Aims integration-operation Worker（非页面入口）

| Operation | Runtime route | Host BFF | capability / grant | 页面或调用点 | 已登记测试证据 | 当前缺口 |
| --- | --- | --- | --- | --- | --- | --- |
| claim、succeed、fail | `POST /v1/enterprise/aims/integration-operations:{claim,succeed,fail}` | 无；Aims worker transport 把旧路径映射到 enterprise 路径 | `aims:integration_operation:execute`；必须同时具备 `data-runtime` 与 `tenant-runtime` audience grant | scheduled drain / wake，不是用户页面 | `enterprise_scheduler_mysql_test.go`、`aims/test/unifiedIntegrationOperationRoute.test.ts`、`unifiedSchedulerWake.test.ts`（源码登记） | 目标租户的双 audience grant verify、真实多 scope token 探测和 cron/wake 实测未在本矩阵证据中闭环 |
| dead-letter 通知（`pending-failure-notifications`、`pending-dead-letter-actionables`、`pending-dead-letter-closures`、`failure-notified`、`dead-letter-actionable-published`、`dead-letter-closure-acknowledged`） | `POST /v1/enterprise/aims/integration-operations:<action>` | 无；worker/Console 通知链 | 同为 `aims:integration_operation:execute`，不等同管理页面的 `aims:integration_operations:view/replay` | worker 与 Console 专用通知入口 | `enterprise_scheduler_mysql_test.go`；`aims/test/unifiedIntegrationOperationRoute.test.ts` | 同上；还缺生产式 dead-letter/ack 丢失恢复与环境调用证据，符合 INT-106/107 的“部分”状态 |

## 共同缺口与处理顺序

1. **环境身份与授权没有逐项闭环。** 本地 Runtime 测试能验证当前 credential/grant 被撤销时的拒绝；它不证明目标 Enterprise deployment 已安装每个精确 capability 的双 audience grant，也不证明可签发实际组合 token。应逐项记录目标 tenant 的 verify 输出和探测结果，不能以 SQL seed、宽 scope 或页面可打开代替。
2. **页面证据没有闭环。** 产品 readiness 记录的 Chrome 观察只到登录重定向，且说明没有可用 Enterprise 登录会话。应以已验证用户会话、不同范围主体和实际 Host 路径验证读取与写入；未经验证的路由文件不构成页面可用结论。
3. **文档陈述存在时间漂移。** `enterprise/docs/API_SPEC.md` 中部分早期“未接线/继续进行”描述，和后续 readiness 增量、Runtime router/Host route 文件不一致。应保留此矩阵的“登记”与“验收”两个维度，并在后续专项改动中把冲突段落改为同一基线；在此之前不把存在 route 当作完成状态。
4. **Host 覆盖范围仍不是两模块全量整合。** 实施计划明确只组合产品规划和产品主档相关页面；未组合的 Aims/Assets 业务页面、后台任务以及其它业务模块不在本矩阵的已登记 Host coverage 内。

## 证据来源

- [ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)：目标边界、Host/Runtime 身份和“文档不等于已切换”的约束。
- [实施计划](./Unified-Enterprise-Implementation-Plan.md) 与 [P0–P2 证据审计](./Unified-Enterprise-P0-P2-Evidence-Audit.md)：INT-108、INT-106、INT-107 的当前阶段结论。
- [Host 合同](./Unified-Enterprise-Host-Contract.md)、[Host API](../enterprise/docs/API_SPEC.md) 与 [产品页面 API 接线清单](./Unified-Enterprise-Product-Page-API-Readiness.md)：Host 边界、BFF、页面和已声明的专项测试。
- Runtime route 事实：`data-runtime/internal/server/server.go` 及 `enterprise_*.go` 的 action maps；Host BFF 事实：`enterprise/server/middleware/01-business-api.ts` 和 `enterprise/server/routes/**`。这些源码位置仅用于登记核对，不替代环境验收回执。
