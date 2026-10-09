# Altoc / People / Finance：M0 盘点与估算

## 1. 本轮边界与结论

任务依据：`.git/brief-apf-m0-20261003.md`，整合计划 [§11/§15](Enterprise-Altoc-People-Finance-Integration-Plan.md)。源码基线 `38f8a20be812dd12db5afb5395055942fef9a830`；包含当时工作区的该整合计划（未提交文档，仅作用户已批准方向）。本轮只有本地源码读取和文档生成：未连生产/本机数据库、未读取运行凭据、未跑服务、未提交或推送。冷存档实际版本、数据及启用状态均留给 Claude 只读核查。

核心结论：

1. 三域已有大量 Runtime 领域实现，不能按从零开发估算。旧模块 middleware 不是可原样挂到 Enterprise 的 U 通道；身份、短期 permit、范围、来源、回调和后台 owner 仍要接线。
2. Altoc 有 12 个基础读操作及一个合同激活固定操作；People/Finance 尚不在 Host alias 与固定操作白名单内。完整 Altoc 对象工作区、People 入转调离、Finance 28 项配置的 UI/BFF 闭包不能用现有只读页代替。
3. 现有 Altoc 独立安装规格只有 13 表、write/scheduler disabled，不是完整 Altoc schema。People/Finance 没有对应完整统一域安装规格。统一库扩展属于独立工作包，不能在活动库上直接运行 canonical schema。
4. People 注册 4 个 Workflow action，但仅发现任职/绩效两类 callback 分支；未找到四项完整的页面申请链。必须补合同/实现或明确退役，而不是按 CLAUDE 的概述宣称全支持。
5. 没有证据要求现在新增“开票申请人≠开票人”或“到账确认人≠核销人”强制规则；本轮保留已存在的自审批/付款职责分离，把新增规则交产品决定。

## 2. 交付物与读法

| 附件 | 用途 |
|---|---|
| [Actions.csv](Enterprise-APF-M0-Actions.csv) | 296 行动作候选：252 个具名 Nitro BFF 动作，以及44个 AST 可见但不能直接匹配具名文件的 middleware/动态入口；每行包含方法/路径、页面或组件证据、BFF、Runtime证据、主要逻辑表、物理映射状态、副作用、人员授权及复用分类 |
| [Source-Evidence.json](Enterprise-APF-M0-Source-Evidence.json) | 全量源页面、Vue script/TS AST 中的请求及路径构造调用、各 BFF 专用 Runtime 调用/guard、Go 路由字面量、权限资源和 Finance 配置；保留动态表达式，不能将其当成完整运行时 URL |
| [Tables.csv](Enterprise-APF-M0-Tables.csv) | 139 个“域×逻辑表”条目、DDL位置、已存在的13表物理规格与其它命名候选；候选不代表 Registry 已安装 |
| [Schema-Files.csv](Enterprise-APF-M0-Schema-Files.csv) | 93 个 SQL 文件的角色、表名、SHA-256，供冷存档迁移对照；不是可顺序执行的迁移清单 |

### 2.1 覆盖与限制

| 域 | 源页面 | AST请求/路径构造调用 | 具名BFF动作 | CSV动作候选 | Go路由字面量 | SQL文件 | canonical表 / 含增量表 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Altoc |31|162|111|135|168|50|76 / 77|
| People |16|66|34|54|117|24|22 / 23|
| Finance |7|63|107|107|131|19|37 / 39|

统计基于目录扫描，**不等于有效业务页数/可达 HTTP 动作数**：login/no-access/占位页包含在页数；`ApiPath` 与实际 fetch 会各留证据；Go 前缀常量不能当完整路由；middleware 的通用 CRUD/动作型 body 不是一个文件一个动作。逐动作 CSV 是实施输入索引，下面的动作族表补齐这些动态分派。所有未静态解析的字段已显式标出，不以“没有匹配”判页面不可达。

CSV 的主要逻辑表是目标/关系入口，不是 SQL 全事务读写闭包；完整表闭集见 Tables.csv，跨域/可靠操作依赖见下面各族。Runtime_evidence 的前缀命中仅提供定位，不证明同权限或已走 Host。人员列的通用 resolver 输出只是无状态输入的路由门槛；status/command、对象关系、独立 scoped authorization 及 handler guard 必须一起保留。没有赋予估算 CSV 任何授权作用。

复用分类：

- **可直接复用**：已有已登记 Host 基础读或已明确退役的拒绝行为；仍需新环境验收。
- **需补 Host 接线**：领域实现及目标入口可复用，缺 Host 页面/BFF/编排/回调/任务入口。
- **需补 Runtime 操作**：已有领域规则，但未登记 Host METHOD/路径/permit 适配；不得随意穿透旧 `/v1/<domain>/**`。
- **需补业务实现**：新共享事务 owning 接口、审批闭包、数据安装/漂移治理等，不能把 wrapper 当实现。每个族可有多个标签。

## 3. 公共接入现状（APF-01）

证据：`enterprise/composition/business-module-alias.mjs:8` 只列 aims/assets/codocs/altoc；`foundation/server/utils/enterpriseRuntimeClient.ts:132–144` 是 Altoc 12读+合同激活；同文件路径域正则目前不包括 people/finance。`data-runtime/internal/server/server.go` 初始化 People/Finance 时仍调用独立 `New(cfg.Apps.<domain>)`，不能从 Registry 的存在推断 adapter 已使用统一库。

| 链路 | 当前事实 | M1需补 |
|---|---|---|
| 页面/子组件 | Altoc为基础读Host+完整独立应用；People有根`/api/v1`及`/api/admin`；Finance由pageConfigs驱动动态大页 | 每域显式入口/alias，移除独立布局；typed公共入口，不从外部导入内部服务身份helper |
| 用户U | Altoc部分已登记；People/Finance无Host固定操作 | 九项能力按计划§7.2及D11逐通道实现；精确METHOD/path+人员动作、签名actor/permit/范围，不使用宽scope兜底 |
| 系统S | 旧独立任务client/来源与精确scope | 唯一owner、机器动作表、可信绑定/generation，拒绝用户委托；旧client不替代enterprise.runtime |
| purpose P | 各域独立 notification-details authorize | 固定purpose，只读对象复核；viewer来自验证委托，不从浏览器接受；不得复用U/S能力 |
| Workflow | 当前迁移映射主要为Aims | altoc/finance/people按app_code完整组映射；逻辑biz身份和旧key保留，物理目标Enterprise；历史冻结callback同时取证 |
| 数据库 | 独立adapter SQL/compat与部分Altoc13表 | 全量mapping+视图闭集，SharedPhysicalNames有限适配、Registry多域Resolve+generation；共享Tx要显式caller-Tx owning入口 |

M1不得只加一个域capability正例。每域至少 list/detail/write、一个机器动作、一个purpose复核及U/S/P交叉拒绝；范围撤权、过期、错actor/tenant/deployment、scope角色合并和回执重放均纳入模板。目标范围当前只是一项设计，不是任何真实grant已批准写入。

## 4. Altoc 逐动作族与复用判定

原页面入口详见 Source-Evidence.pages；实际调用含页面内子组件，不按manifest资源制造不存在的独立页面。人员资源/动作来源 `altoc/server/utils/altocPermissionRoutes.ts`，领域SQL来源 `data-runtime/internal/apps/altoc`；CSV按METHOD逐行展开已具名入口，以下列出通用middleware及body命令的补充动作。

| 页面/组件 → 请求动作 | BFF/Runtime与主要表 | 人员门槛/外部效果 | 分类 |
|---|---|---|---|
| customers列表/新建/详情/编辑 → list/detail/create/update/delete | `/api/v1/customers` → `/v1/altoc/customers`；adapter.go、business_reads.go、客户命令；customer | customer:view/edit；approved状态需approve；Directory姓名不授Console UI | 6类基础读可直接复用；全页/写需Host+Runtime操作 |
| 客户联系人/开票资料 → list/create/update/delete/default | customers/{id}/contacts、invoice-infos、invoice-info:save；contact/customer_invoice_info，父客户范围 | customer:view/edit；税务资料/联系人字段白名单 | Host+Runtime，业务可复用 |
| leads三页 → CRUD、assign/disqualify/convert、activity | leads/*；lead_commands.go、lead_matching.go；lead/lead_conversion/sales_activity，转换关联customer/opportunity | lead:view/edit/assign/disqualify/convert/activity分别判；conversion不重复建对象 | 基础读复用，其余Host+Runtime |
| opportunities四页 → CRUD、assign、transition/close-won/close-lost/pause/reopen、activities/contact-roles | opportunity_commands.go、sales_reads.go；opportunity、stage_log/contact_role、sales_activity | opportunity:view/edit/assign/transition/activity；跨对象归属复核 | Host+Runtime，业务复用 |
| quotes三页 → CRUD/items、版本、status/approve、转合同事实 | quotation_commands.go；quotation/item/version，contract引用 | quotation:view/edit/approve；版本冻结/批准不凭UI状态 | Host+Runtime；版本/审批闭包核查 |
| contracts三页 → CRUD、submit/withdraw/approve、mark-signed/suspend/terminate/status/management | contract_commands.go、contract_management.go；contract/party/payment_term/stage | contract:view/edit/approve/admin；状态型body不能统一当edit | Host+Runtime，保留独立Workflow链 |
| 合同子组件 → lines、obligations start/submit/accept/reject、billing-schedules、stages/fulfillment-close | contract_lines.go、contract_obligations.go、contract_management.go / contract_lines.go；line/obligation/billing_schedule/stage | contract:view/edit，对象锁/冻结与金额规则 | Host+Runtime |
| 合同项目关联 → eligible列表、project-links全量替换、按行/义务分摊 | eligible-aims-projects BFF、contract_project_relations.go；project_link/line_rel/obligation_rel；Aims项目读取 | contract:edit与项目域自身授权独立；不能复制经营事实到Console | Host+Runtime，typed读可复用；caller-Tx联调 |
| 履约启动 → activate-delivery、activation job/step/result | BFF service/contracts/{code}/activate-delivery；contract_activation*.go、enterprisecontracts/activation.go | 用户contract:edit，不因目录含service而当S；Aims项目/里程碑、Assets计划、服务协议 | 已有固定U可复用；多域Tx/来源/在途operation迁移需实现，AA-04不能假定启用 |
| payments列表/详情 → list/detail/update/confirm、scan-overdue | receivable_plan/payment_record、receivable_responsibility.go；Finance不是此表副本 | receivable:view/edit/confirm；扫描与人工作业分通道 | 基础读复用；Host+Runtime |
| 回款计划 → invoice-request；合同级旧invoice-request | receivable_invoice_operation.go → Finance目标receipt与Workflow operation；integration_operation/attempt | receivable:edit不授Finance issue；无稳定计划身份的合同级旧入口410 | typed/共享Tx新实现+Host；保留410 |
| 客户/合同Finance摘要与发票文件读取 | contracts/invoices、invoice-files/view、maintenance-financial-summary；finance_summary_receipt.go、Finance owned摘要 | contract/customer:view+Finance范围/文件授权；无过滤不得变范围放大 | Host+Runtime，typed跨域读取 |
| tenders三页 → CRUD/agencies/members/milestones | tender_commands.go；tender/member/milestone/agency | 当前映射quotation:view/edit；不另造tender权限 | Host+Runtime，原业务复用 |
| 客户服务面板 → maintenance/entitlement/ticket/renewal CRUD；service agreements/coverage resolve/suspend/end/confirm-legacy、default-project | service_maintenance.go/service_agreement*.go；完整服务相关表 | 原maintenance_contract/service_entitlement/service_ticket/renewal_opportunity；coverage由contract门槛；close独立 | Host+Runtime，领域规则复用 |
| 服务工单 → aims-work-item、delivery-result、product-request/resume/status/progress | service_ticket_aims_operation.go、product_feedback_*；ticket/feedback/projection与Aims工作项/需求receipt | service_ticket:edit/close，系统回写仅登记操作；冻结业务键/generation | Host+Runtime+受限共享Tx；原可靠路径复用 |
| 服务工单 → ops-knowledge | service_ticket_ops_knowledge.go；Codocs关系+Assets文档link及receipt/operation | 源工单范围、Codocs ACL、Assets域规则分别复核；OSS正文不搬入Altoc | Host+typed内部编排/历史可靠路径 |
| 对象DocumentPanel → documents list/create/delete/preview/external-view；attachments | document_commands.go；document_link/attachment；独立Codocs/OSS | entity_type决定customer/lead/opportunity/quotation/contract；不同对象不借权限；内容另判ACL | Host+Runtime，外部内容边界保留 |
| settings/teams → dict CRUD、团队/成员；profile/login/no-access/admin占位 | config_dict_commands.go/team_commands.go；字典/team；共享Host本人资料/登录 | settings:view/edit、admin:view/edit；只读字典当前null不能当万能公开写 | Host接线；占位明确退役/共享承接 |
| dashboard/index → kpis/funnel/forecast/receivables/summary/analytics、export | dashboard_reads.go/operating_accounting.go；customer/opportunity/contract/receivable | dashboard:view/export；统计总额同范围，不当前页reduce | Host+Runtime，查询复用 |
| integration operations → list/detail attempts/replay；due/overdue/stale/drain | integration_operation_runtime.go及BFF admin helpers、tasks/*；operation/attempt/dead_letter/checkpoint | integration_operations:view/replay；S任务独立，人工replay仍U | Host+S接线/owner迁移；不重造历史key |
| 合同行成本/利润、服务成本摘要 | operating_accounting.go；contract_line_cost_allocation/profit_summary/service_cost_summary | contract范围；冻结摘要不重算；缺分摊失败，不平均分摊 | M4 Host+typed输入/事务联调 |

注意：上述文件族与CSV共同定位，不声明每个文件路径就是完整HTTP路由；通用CRUD、status/command及专用Service handler必须分别登记。第三方AI配置、OSS、GitLab、Console等仍是外部边界，不能因同Runtime就取消原授权。

## 5. People 逐动作族与实际 Workflow

人员门槛：`people/server/middleware/tenant-runtime.ts:410–490`、每个 `/api/admin` handler、`app/config/permissions.ts`，敏感成本/档案字段通过独立scope决定。旧peopleApiPath依赖应用basePath，迁入Host必须固定模块路径，不能落到Console根API。

| 页面/组件 → 动作 | 当前BFF → Runtime / 逻辑表 | 权限与外部效果 | 分类 |
|---|---|---|---|
| index → dashboard/overview | middleware → adapter/runtime.go；employees/assignments/cycles/cost_snapshots | dashboard:view，成本须单独standard_costs范围，非授权不显示 | Host+Runtime操作，读取复用 |
| employees index/[uid] → list/search/detail/create/update/archive/profile/private-profile/documents | `/api/v1/employees`及专用后缀→ adapter/employee_access/private_facts；员工/私档/任职/文档 | employees:view/edit/admin；私档edit，不由普通view读身份证；文档引用独立 | Host+Runtime，字段脱敏复用 |
| assignments/员工详情 → list/change/edit、有效主任职历史 | `/api/v1/assignments[:change]`→ assignment_change/selector；assignments/employee/lifecycle_versions/operation | assignments:view/edit；原审批/未来生效逻辑保留；提交后Directory reliable projection | Host+Runtime；审批申请链待补 |
| positions/ranks → CRUD；standard-costs → CRUD和M/P数量参数 | middleware → adapter/cost_standard；positions/ranks/standard_cost_rates；Console参数 | positions/ranks写admin；standard_costs写admin，工资与人员scope独立 | Host+Runtime，业务复用 |
| onboarding list → profile补全、provision/activation-link/refresh-status/activate/cancel | `/api/admin/onboarding-cases/*`→ Runtime case状态命令+Console开通聚合 | employees:view/edit/admin按动作；Console/Platform身份开通不可吞成“员工insert” | Host+Runtime及跨进程可靠接线 |
| offboarding list/detail → case创建、task confirm/cancel | `/api/v1/offboarding-*`→ offboarding_cases；cases/tasks/checkpoint | offboarding_tasks:view/admin/confirm/cancel，edit/admin不蕴含确认；账号停用/资产回收另事实 | Host+Runtime，原CAS可复用 |
| cost-snapshots → list/generate | `/api/admin/cost-snapshots/generate`→ Finance参数读取 → `/v1/people/service/cost-snapshots:generate` | cost_snapshots:edit；月末任职/工资/公式冻结，Finance是参数源 | typed跨域读取+Host+U，原生成逻辑复用 |
| performance cycles → list/create/detail/collect/confirm/close | `/api/admin/performance-cycles*` → runtime/performance_cycles/sync；cycles/contribution/scope_versions | performance_cycles:view/edit；confirm/close后端approve；已审核Aims工时、Finance金额；确认/关闭冻结 | Host+Runtime；审批闭包需补/决定，不能照搬前端edit授权 |
| performance amounts读取 | `/api/admin/performance-amounts`→ Finance | performance_cycles读取及财务敏感范围；People只引用金额 | typed读取+Host |
| HR source sync → mappings list/save、changes read/apply、jobs create/read/cancel/retry | `/api/admin/hr-source-sync/dingtalk/*` → Console/Connector及RuntimePeople facts | hr_source_sync:view/execute/admin分别；只凭正式离职事实，不凭通讯录缺失停用 | Host+系统可靠接线，原实现复用 |
| Directory初始导入、档案导入、subject-merge preview | admin/directory-sync/import、employee-archive-import、subject-merge/preview | employees:admin；独立安全库不可加入事务；在线subject-merge写/disable旁路410 | 导入工具/Host接线，保留退役，非生产初始化授权 |
| integration operations list/attempts/replay；Directory/assets/dead-letter/due任务 | admin handlers+runtime integration_operation_admin及server/tasks | view/replay与S分开；三条既有family allowlist，notification generation独立 | Host+Runtime/S/P+owner迁移 |
| service contributions/standard-costs resolve/Workflow callback | `/v1/people/service/*`，contribution_receipt/cost_standard/sync | 新consumer typed范围复核；旧进程独立Service鉴权/receipt继续 | 可复用领域；需补来源整组与新U/S适配 |

### 5.1 People Workflow 实际动作组（不是文档概述）

源注册 `people/app/config/permissions.ts:31–72`；插件 `people/server/plugins/sync-approval-actions.ts:1–29` 启动5秒后同步定义（可由HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP=false关闭）。同步定义不代表已创建有效实例。

| resource / actionCode | embed / business identity | 已见消费/回调 | M0结论 |
|---|---|---|---|
| assignments / employee_onboard | `/employees/{biz_id}`，定义描述初始任职 | runtime sync.go:834支持assignment/assignments/people_assignment，通过assignment_code或source_biz_id定位 | employee UID页面与assignment业务键的关系须核查；未见页面WorkflowPanel/startWorkflow完整申请链，不能宣称闭环 |
| assignments / employee_transfer | `/assignments` | 同上述assignment分支；批准后冻结Directory lifecycle，与未来生效准备任务衔接 | 领域回调可复用，申请/绑定/人员快照与Host映射需补证据 |
| cost_snapshots / employee_cost_adjust | `/cost-snapshots` | sync.go:834–901没有cost_snapshot类型分支 | **需补业务实现/合同或决定停用此注册**；不得把任职回调冒充成本审批 |
| performance_cycles / performance_cycle_confirm | `/performance-cycles/{biz_id}` | sync.go:876支持performance_cycle/performance_cycles/cycle；approved调用confirm，其他终态取消 | 回调实现存在；页面handleCycleAction直接调confirm/close，未创建Workflow。不能把直接确认当审批创建证据 |

另：`performance-cycles/[code].vue:162`前端先检查edit，`server/api/admin/performance-cycles/[code]/confirm.post.ts:27`却要求approve（close同样需核对），这是迁移要处理的动作呈现/后端一致性缺口，不应降后端权限。未发现 People 页面 WorkflowPanel，只有绩效详情显示workflow_instance_id；不存在充分证据证明“注册了4动作=4动作已可用”。

另外两域的源注册：Altoc `app/config/permissions.ts:300` 为customer/approve、quotation/approve、contract/approve；Finance同文件:31为invoices/request、expenses/claim、expenses/project_expense、expenses/payment，`server/utils/financeApproval.ts`映射四种单据submit。这些动作组要整体迁移，不能只迁开票演示单。

需要Claude回读实际action_defs/routes/实例/冻结callback以及是否有外部申请入口；在该结果前，M2不得承诺全部People审批只是换URL。现有回调app_code保持people，不能全局改为enterprise；Console employment/offboarding和Connector专用签名是特殊边界，不能混入普通U。

## 6. Finance 28 配置逐项去向与动作

源 `finance/app/config/pageConfigs.ts` 确有28条；原7个Vue文件不等于7项功能。统一请求前缀`/api/v1/finance` → `/v1/finance`；当前人员映射 `server/utils/financePermissionRoutes.ts`、责任与范围 `server/utils/dataRuntime.ts`；金额/状态规则在Runtime `resources.go/write_*.go`。下表动作是现有配置与专用组件可达操作族，详细METHOD/BFF证据见CSV；不新增原后端不支持的批量核销/自动开票。

| # | 原slug → endpoint（省略API前缀） | 动作/主要逻辑表 | 人员资源/动作 | Host去向 / 分类 |
|---|---|---|---|---|
|1|invoices → /invoices|列表/新建/编辑/文件预览/删除含文件/生命周期/receipt-reconcile；finance_invoice/attachment|invoices:view/edit，删除admin，核销reconciliation:confirm|正式发票列表/详情，Host+Runtime适配 |
|2|invoices/requests → /invoice-requests|列表/详情/创建/编辑/submit/issue/assign-issuance；invoice_request/approval instance|invoices:view/edit/approve/issue独立|开票申请对象页，Host+Workflow整组；已有领域复用 |
|3|receipts → /receipts|列表/详情/创建/更新确认/classify/delete；finance_receipt|view/confirm；classify edit；详情责任范围|到账办理页，Host+Runtime |
|4|reconciliation → /reconciliation|列表/创建/void；receipt/invoice/reconciliation及Altoc摘要operation|reconciliation:view/confirm|核销工作区，重设计+共享Tx实现 |
|5|expenses → /expenses|列表/创建/编辑/删除；finance_expense|expenses:view/edit/confirm/admin按状态/动作|支出台账，Host+Runtime |
|6|expenses/claims → /expense-claims|列表/创建/详情/edit/submit；claim/items/expense|expenses:view/edit/approve/confirm|报销申请本人/办理视图，重设计+接线 |
|7|expenses/projects → /expenses|与5相同endpoint，保留项目筛选语义，不新造事实|expenses同门槛+项目scope|支出台账项目视图；Host接线 |
|8|expenses/project-requests → /project-expense-requests|列表/创建/edit/submit；request/items/expense|expenses:view/edit/approve/confirm|项目支出申请，Host+Workflow |
|9|payments/requests → /payment-requests|列表/创建/edit/submit；payment_request/expense|expenses:view/edit/approve/confirm，付款职责分离|付款申请对象页，Host+Workflow |
|10|bank-accounts → /bank-accounts|列表/详情/创建/edit/delete；finance_bank_account|bank_accounts:view/admin（维护），不是余额edit代替admin|账户页；首批Host+Runtime复用 |
|11|bank-accounts/balances → /bank-accounts/balances|余额快照列表/创建；account_balance_snapshot|bank_accounts:view/edit|账户余额页；首批Host+Runtime |
|12|bank-accounts/balance-changes → /bank-accounts/balance-changes|列表/图表/范围；服务端summary，不跨币种合计|bank_accounts:view|资金变动视图；Host接线 |
|13|project-accounting → /project-accounting/aims-projects|Aims项目分页+本页Finance摘要，recalculate/sync-people-costs|project_accounting:view/edit|核算列表/详情，typed Aims/People+本域写；迁移联调 |
|14|project-accounting/allocations → /project-cost-allocations|list/create；project_cost_allocation|project_accounting:view/edit|项目期间分摊，Host+Runtime |
|15|project-accounting/employee-costs → /employee-costs|list/create；employee_cost_snapshot|project_accounting:view/edit+敏感范围|人员期间成本视图，Host+Runtime |
|16|performance → /performance|list/recalculate；employee_finance_performance|performance:view/edit|财务绩效金额结果，不写People周期；Host |
|17|performance/contributions → /employee-contributions|list/create；employee_finance_contribution|performance:view/edit|贡献归因工作区，Host |
|18|performance/rules → /performance-rules|list/create；performance_rule|performance:view/edit|设置的金额规则视图，Host |
|19|performance/snapshots → /performance/snapshots|list；performance_calculation_snapshot|performance:view|计算历史与依据，Host |
|20|settings → /settings/subjects|list/create/update；finance_subject|settings:admin（当前API规则）|科目配置，不把菜单view替代APIadmin；Host |
|21|accounting-objects → /accounting-objects|list/create/update；finance_accounting_object|settings:admin|核算对象配置，Host |
|22|settings/subject-mappings → /settings/subject-mappings|list/create；finance_subject_mapping|settings:admin|科目映射，Host |
|23|settings/income-types → /settings/income-types|list/create/update；finance_income_type|settings:admin|收入分类，Host |
|24|settings/expense-types → /settings/expense-types|list/create/update；finance_expense_type|settings:admin|费用分类，Host |
|25|settings/people-cost-parameters → /settings/people-cost-parameters|list/create/update；finance_people_cost_parameter|settings:admin；给People读取为独立服务合同|首批参数页，Host+Runtime+typed只读接口 |
|26|settings/approval-instances → /integrations/approval-instances|list；external_approval_instance；action sync/Workflow callback另入口|settings:admin|审批关联与同步诊断，Host+整组映射 |
|27|settings/audit-logs → /audit-logs|list；finance_audit_log|settings:admin|安全审计视图，脱敏；Host |
|28|reports → /reports|list+专用export；本域收支核算汇总|reports:view/export分别|既有报表/导出，Host+查询联调 |

其它源页：index→财务概览；invoices/[code]/edit→正式发票编辑；invoices/requests/[code]→申请详情；receipts/[code]→到账详情；integration-operations→诊断/replay；no-access→Host拒绝页。`[...slug].vue`不能迁成任意slug的永久占位兜底。

子组件闭包：FinanceEntityFormSlideover的config create/update、InvoiceRequestDialogs的issue/assign、InvoiceLifecycleDialogs的状态/删除、InvoiceFilePreview的OSS、BankAccountBalanceSlideover的快照、BalanceChangesOverview的server-summary、useProjectAccountingOperations的Aims/People/Calendar，均随所在行交付。附件upload/view/delete不是CRUD字段附加项。

现有职责规则：`payment_confirmation_duty_separation.go`、`approval_duty_separation_test.go`及权限resolver状态分支必须保留；actor取签名主体，不能信body.paidBy/confirmedBy。申请获批、正式开票、到账确认、核销/付款是不同事实，合同edit不升级为财务issue/confirm。两项未决定的新增强制职责分离不进入本次估算实现范围。

## 7. 外部副作用、后台与事务边界

| 域/现有任务文件 | 当前作用 | 迁入处置/依赖 |
|---|---|---|
| altoc/server/tasks/integration-operations/drain.ts | 冻结合同项目/里程碑、开票、工单/知识等可靠操作 | 新内部域间写评估共享Tx；历史operation/key/receipt沿原路收口；外部效果仍可靠投递 |
| altoc/tasks/notifications/receivable-due.ts | 回款到期责任通知 | Runtime候选准备+Enterprise所属执行器；原责任/eligibility/descriptor+P复核 |
| altoc/tasks/overdue/scan.ts、stale/scan.ts | 逾期回款/停滞商机扫描 | 有界本域扫描，单owner/generation；不能同时保留旧cron与新timer |
| people/tasks/integrations/directory-lifecycle.ts | prepare-due+生效任职Directory投递 | Runtime准备；Console独立安全库，outbox不可改成共享DB事务；未来任职/乱序水位保留 |
| people/tasks/integrations/assets-offboarding.ts | 离职事实到Assets回收协调 | 仅已实际同库部分可caller-Tx；外部路径仍可靠投递，账号停用不同事实 |
| people/tasks/integrations/dead-letter-notifications.ts | 固定三family的dead-letter发布/关闭 | 独立notification generation；失败不能改变业务claim；不增加family自动继承 |
| people/tasks/notifications/offboarding-due.ts | 交接/资产任务到期通知 | 当前责任人+active Directory，eligibility失败不ack、不回退管理员 |
| finance/tasks/integration-operations/altoc-summary.ts | 核销后摘要可靠回传 | 新Finance→Altoc受限共享Tx；旧leased/pending原键收口，不生成新消息 |
| finance/tasks/notifications/finance-due.ts | 未开票/未核销到期提醒 | 唯一责任人/截止时间，关闭旧generation；不回退申请人/经理 |

代码中的默认关闭开关/文件存在均不证明目标环境任务已启用。完整owner/tenant/environment/lease/asOf/批次上限/调度时延由M1样例与Claude现状核验冻结，不能现在改任何cron。

共享Tx候选：Altoc合同→Aims项目/里程碑（现AA起点）、Finance核销→Altoc摘要、工单正反向、People离职→已迁入Assets。用Registry.ResolveDomains+持久化栅栏，统一对象/receipt锁序，目标领域不另开Tx；网络预读在事务前，通知/Workflow Node/OSS/Console在提交后。Finance核算读取Aims审核工时+People有效任职/职级，冻结输入版本/hash，再短锁重验并写本域；缺输入明确not_ready/NULL，不静默0成本。不能把People贡献绩效快照当人力成本源。

特别保留：Console/Platform HR生命周期及Connector签名身份、独立Workflow、OSS/第三方、尚未迁入的Assets子路径。处理它们的Service API不因Enterprise用户入口迁入就取消鉴权。

## 8. APF-02 Schema、迁移和映射事实

### 8.1 可得源码事实

| 域 | canonical与升级 | Runtime检查 / 安装结论 |
|---|---|---|
| Altoc | altoc/docs/altoc_schema.sql：76表；50个SQL候选中另有assets_delivery_status_projection，合计77不同名 | adapter/requiredTables与业务SQL更多于13表独立读规格；不能全量运行含DROP/重建的bootstrap。033/其它迁移实际执行状态待冷存档核查 |
| People | people_schema.sql：22表；增量另有employee_number_reassignment_history，合计23；schema-manifest.json明确bootstrap空库+upgrade sequence10–140+verify | requiredTables20项不是完整闭集；贡献水位/receipt/历史等不能只按启动floor安装；manifest各hash应与实文件逐项比对后确定候选，不把文件存在当已执行 |
| Finance | finance_schema.sql：37表；integration_operation/attempt在20260710增量，合计39；19 SQL文件 | canonical注明IO DDL在增量，不能只跑canonical；requiredTables16项并检查readiness/currency/reject_reason/责任字段等，不是全域表全集 |

本地核对People schema-manifest共22项hash：21项一致，bootstrap `people_schema.sql`不一致（记录 `f04ae45bfcb6a5a96410c1895b08fe0522c5b5ebb0f192f6ecec74729bc8fab6`，实际 `5d6699c2cefbca59c8c624f0b4432d721f68822af98ac2b976a407400e1af0d0`）。这是已证实的制品元数据缺口，M1需按审过的canonical重新生成/审查hash；本轮不修改manifest、不假定生产bootstrap失败。

各文件SHA及DDL行见Schema-Files/Tables附件；原独立库逻辑/物理同名是源码默认部署模式，不证明冷存档或活动统一库状态。People demo_seed单列，不混入生产。旧迁移包括回填/遗留导入及可能破坏性DDL，要按依赖/目标版本重新形成完整reviewHash，禁止按文件名排序一键执行。

People已显式登记的upgrade：standard_cost、offboarding tasks、assets projection、contribution scope versions、directory lifecycle versions、dead-letter actionable、connector sync、unscored project facts、rank series、DingTalk profile、onboarding cases/provisioning refs、private facts、employee number sequence。Finance关键增量：20260518业务核算/科目、20260619发票文件与请求、20260709readiness、20260710 IO/receipt/due、20260711 actionable、20260827 reject_reason、20260909 currency/product attribution；各源表/列实况由Claude核查，不假定版本串连续代表无漂移。

### 8.2 Registry/视图与名称冲突

- `data-runtime/internal/enterprise/domaininstall/altoc.json`固定13表：映射详见Tables.csv；installer `install.go:46`固定read=unified、write/scheduler=disabled。`ForAltoc`提供按profile身份的规格，不等于全域writer已经就绪。测试data hzy0-mapping含Altoc，但**本轮不读取运行配置、不能据测试fixture断言本机/生产仍如此**。
- `enterpriseviews/views.go`兼容installer基本安装aims/assets，Workflow有自己的增量；SeparatelyInstalledDomains目前只有altoc。People/Finance完整schema family、adapter NewEnterprise/repository wiring仍需补，不能靠DB名字改相同实现共享事务。
- `enterprise/shared_names.go:5`冻结6项：integration_operation、integration_operation_attempt、integration_operation_dead_letter_actionable、service_command_receipt、work_item_status_catalog、workflow_status_catalog。三域DDL中共同命中前4项，后2项未发现本轮三域CREATE声明；前4必须按域物理名+Resolved.Table访问，不能建一个通用视图指向任一域。
- 三域已扫描SQL的CREATE表名没有system_parameters。**这不证明冷存档不存在**；若实际存在，按计划使用 `<domain>_system_parameters`逻辑/物理同名，有限适配消费者；不动Assets ExclusiveOwners(system_parameters)或SharedPhysicalNames。
- 跨三域重名扫描命中仅上述4项；与现有Aims/Assets/Codocs/Workflow/Console的全候选闭集碰撞仍由M1完整mapping检查。旧Altoc role/permission/user_role属于历史数据，不是新人员授权事实源，不能迁入后恢复本地授权算法。
- Tables.csv未有固定映射者列出的“保留已有域前缀或增加domain前缀”是命名提案；实际选择需与视图/外键/JSON/旧SQL闭集联调。不能机械地把people_people_employees之类双前缀当正确，也不能覆盖既有Altoc活动数据。

M1迁移：新候选与新hash包含已有活动域和新增三域；完整shadow-copy、视图双向等价、JSON引用/索引/FK/trigger、ID/code/金额/状态/历史快照/receipt/watermark核验；final-copy前封存writer，旧命令identity保持。不能复用过去两域target/hash或把只建13表工具当全域升级器。

## 9. 交 Claude 的生产冷存档只读核查清单

本轮**不执行以下查询、不自行寻找通道**。请Claude在已获授权的冷存档/生产只读通道回报脱敏结果；不选secret/ciphertext，不解密、不打印人员敏感明细/文档正文。

| 编号 | 只读核查项 | 所需结果/用途 | 影响工作包 |
|---|---|---|---|
| C01 | 三域冷存档来源、封存日期、原应用/runtime提交，是否另有活动writer、定时任务/回调 | 库标识与版本/hash/计数；明确只读存档还是仍变更，不凭名称判断 | 全迁移 |
| C02 | information_schema表/视图/列/默认值/ENUM/索引/FK/trigger，迁移ledger | 与93文件/139表对比；缺/多/改列清单、algorithm/版本；不只schema_version | M1/APF05 |
| C03 | 三域表计数、PK范围、业务code唯一性、重复/NULL关键键，软删除与终态分布 | 按表/状态汇总，不贴姓名/税号/薪资；canonical有/增量有但存档无分别报告 | 映射与估算校准 |
| C04 | 活动统一库Registry domains/mapping/owner/read/write/scheduler/schemaVersion/generation；Altoc13表实际数据 | 仅metadata/映射hash与计数；是否已改/有外部消费者，防重复复制 | M1/Altoc |
| C05 | system_parameters、4个共享账本名及其它跨域重名的实际DDL/消费者 | 是否存在、列hash、数目、逻辑所属；Assets现有视图不改 | 闭集冲突 |
| C06 | Altoc多合同行/付款条款/义务/结算/项目link、line_rel、obligation_rel、未分摊及金额对账 | 选择脱敏代表合同codes/状态/金额分币种汇总；项目引用有效性、planned/active/closed/取消关系 | 合同首批 |
| C07 | 客户/合同开票资料、报价版本、tender、document_link/attachment、服务覆盖计划与正式asset pair | 只业务键/类型/状态/路径形状/对象存在布尔；旧invoice使用者与Finance真值差异 | M2/M5 |
| C08 | People员工/Directory对应、有效主assignment、未来生效/left/inactive、rank_series/M-P、private facts结构、同日冲突 | uid可散列或只代表测试对象；关系/计数与异常；不选身份证/工资明细 | People基础 |
| C09 | People四action定义/route配置、运行中实例、biz_type/biz_id类型、冻结callback URL路径/目标、是否外部创建入口 | 按action分组计数及路径形状；成本审批是否真实使用；直接绩效confirm与审批各自使用数 | §5.1缺口 |
| C10 | Finance账户/余额币种、发票/附件、申请、到账/核销/退款/void、支出与pending审批 | 金额按期间/币种汇总、残余额、责任/版本列齐全、孤儿键计数，不贴银行号/税号 | 参数账户/M3 |
| C11 | Finance参数有效期、科目映射/核算对象、People职级cost输入、Aims approved工时与Calendar就绪 | 缺输入分布、not_ready/NULL vs历史0值、历史快照版本hash | M4 |
| C12 | 三域integration_operation/attempt/receipt/dead-letter/checkpoint及旧domain_event_outbox | 状态/lease/generation/nextAttempt水位、目标/operation family、同key hash一致性，脱敏不贴command | owner交接/重放 |
| C13 | Workflow altoc/finance完整action组、在途实例/冻结callback及可靠创建operation | 目标来源/deployment/app_code/相对路径和状态分布，旧token来源窗口 | M1/M3 |
| C14 | 有效service client/grant元数据、deployment/audience/semanticScope绑定、manifest安装hash、角色scope/职责冲突规则 | 仅授权元数据；用户/S/P与HR特殊签名区分；没有新seed执行授权 | 三通道 |
| C15 | 存量后台owner/开关/cron、实际最近调用、外部OSS/GitLab/钉钉integration元数据及附件存在性 | owner/周期/计数与状态，不读token；多owner/残余旧消费者列表 | M5/M6 |

建议先回读C01–06、C10、C12–14，足以锁定首批风险；其余在对应工作包前取证。冷存档不能证明活动系统调度/授权时效，C04/C14/C15需要相应活动只读证据，由Claude区分来源。若未获得，保留未知而不假定空库或无任务。

## 10. 工作量估算与首批建议

单位为**工程人日**：一名熟悉本仓库工程师一个正常工作日，含实现、代码审查修订、隔离契约/反例，不含等待用户/环境窗口、数据业务裁定及观察期日历。区间是M0估算，不是上线承诺；各包列出四类互不重算的工作，M1/迁移公共工作不再分摊到每页。多人并行仅降低日历，不降低总人日。

| 工作包 | 复用核对/整理 | Host接线/UI | 新业务/公共实现 | 迁移联调/验证 | 合计人日 |
|---|---:|---:|---:|---:|---:|
| WP1 三域接入/三通道/来源/回调模板+代表页面 |2–3|3–5|5–8|3–5|13–21|
| WP2 全量schema/mapping/视图/JSON/历史命令迁移闭集 |2–3|0|4–7|5–9|11–19|
| WP3 Finance参数/账户/余额 |1–2|3–5|1–2|1–2|6–11|
| WP4 Altoc合同主链/客户报价必要路径/项目履约 |2–3|5–8|4–7|3–5|14–23|
| WP5 People员工/任职/岗位职级/入职基础及审批缺口 |2–3|4–6|3–6|2–4|11–19|
| WP6 Finance收支/申请/审批/核销/摘要共享Tx+重设计 |2–3|7–11|5–8|4–6|18–28|
| WP7 成本/快照/绩效/贡献/报表 |2–3|4–7|4–7|3–5|13–22|
| WP8 Altoc服务/投标/反馈/知识、People HR/离职异常与剩余配置 |2–4|5–8|4–7|3–5|14–24|
| WP9 owner收口、故障/回滚/撤身份验证及文档 |1–2|0–1|2–3|3–5|6–11|
| **总计** |**16–26**|**31–51**|**32–55**|**27–46**|**106–178**|

这是三域**全功能及数据迁移**估算，非首批上线耗时。Finance动态页重设计、People审批缺闭包、全域迁移占上界；若C02/C09证明无漂移且审批有现成外部完整入口，可下调相应包，不能先按最佳情况减掉。新增强制职责政策、完整ERP能力、项目目录新授权等不含本轮。历史非同库数据/金额需人工纠正另估。

### 10.1 建议第一交付波次

按用户顺序：公共模板与样例 → Finance参数/账户 → Altoc合同主链。保留原里程碑名称：公共模板为M1，后两项是M2的提前域包，不把“首批”改写成一次性三域全量启用。

1. **M1 WP1+WP2（24–40人日）**：用无敏感合成样本验证三域list/detail/write、S/P、来源与整组callback合同；先冻结完整可选mapping/视图/锁序。迁移工具只能在后续批准的环境执行。People成本审批缺口先定处理策略，不用伪造成功回调做样例。
2. **Finance参数/账户 WP3（6–11人日）**：28项中的#10/#11/#25，账户管理admin与余额edit不同；余额summary/币种/有效期、参数历史稳定、People typed读取。#12视图可随账户读顺带接入，但不阻塞参数主链。
3. **Altoc合同主链 WP4（14–23人日）**：客户/联系人/开票资料必要维护→报价与合同/行/条款→签署/履约→项目关联/里程碑，沿已实现AA校准。回款计划与单据读取就绪；Finance开票/核销完整办理留WP6，不能以合同已生效宣称财务闭环。

第一交付波次合计 **44–74人日**，分小批审阅、逐域启用；不要求等全106–178人日做完才交付。从长期常态看，这包含通用框架和完整数据闭集的一次成本，不能按新增每页固定操作数量线性倍增。M1样例完成后用实测调整：通用CRUD适配耗时、专用写/回调/共享Tx比例、Finance代表页重设计、schema漂移数；附实际花费与剩余预测，而不是预先声称减少一个数量级。

### 10.2 首批放行/后续未知项

- C01/02/04明确候选、已有域与表闭集；C06多行合同样本和C10参数/账户可用；缺数据时用合成隔离样例，环境验收记缺口。
- 合同edit不授项目create/财务issue；金融字段和People敏感字段不能从列表/summary/total/导出泄漏。退款、核销、付款并发必须保留金额精度/锁/职责分离。
- 三域用户/S/P及HR专用边界明确。旧独立来源/token/回调窗口按原key续行，不重建在途实例；新旧owner不能双执行。
- 每批分开记录代码通过、隔离验证、环境启用、真实业务验收四态；本M0仅第一种文档产出，不宣称任何环境启用。

## 11. 待裁定与后续动作（本轮不实施）

1. People `employee_cost_adjust`到底保留并补正式申请/回调，还是已无有效消费者可退役；先回读C09。入职action的employee页面ID与assignment回调键也要明确。
2. 绩效确认应继续独立直接approve命令还是必须Workflow审批；现UI edit/后端approve不一致必须在迁入时处理，不能降低服务端门槛。
3. 两项新增强制职责分离仍待决定，保留现有规则。无需因M0先改角色或grant。
4. 冷存档差异、活动Altoc13表数据、任务/回调在途命令和完整可选映射明确后，由M1形成迁移执行单。任何真实库写入、数据安装、grant、外部来源/owner切换均另获适用批准。

## 12. 本轮验证回执

本地 AST 扫描 Vue script 与 TS 的 fetch/ApiPath 调用，保存原表达式；对独立Altoc/Finance纯权限resolver做本地无IO求值，记录无状态输入门槛；枚举所有具名API、非测试Go路由字面量、SQL CREATE和hash。People schema-manifest 22项SHA检查另发现1项不一致，已在§8记录。未执行应用测试/构建/SQL，文档任务无需这些副作用。静态完整性检查以附件实际计数/路径存在/28配置完整/JSON/CSV可解析为准。

并行 `docs/Unified-Enterprise-Implementation-Plan.md` 及整合计划原有改动保持不动；本轮新增只有此文档与4个证据附件。生产只读清单已交付，不自行连任何环境。

## 13. Claude 生产只读核查结果（2026-10-03，C01–C06、C10、C12–C14）

只执行只读查询，生产与冷存档均未写入，不含个人敏感明细。

| 编号 | 结果 |
|---|---|
| C01 | 冷存档库 `hzy_altoc`（72 表）、`hzy_people`（22 表）、`hzy_finance`（38 表）均于 2026-09-30 22:54 导入，此后没有更新。无业务账号库级授权，也无连接，可判定为纯只读存档、不存在活动 writer。三库均无视图、无 trigger。迁移台账表：Finance 有 `finance_migration_map`（20031 行），另有 `hzy_migration_backup_20260713_project_finance_summary`。 |
| C02 | 表/列逐项比对尚未执行（工作量较大），放到 M1 迁移闭集生成时，用 information_schema 导出比对。 |
| C03 | 非空表与行数如下：<br>**Altoc**：customer 757，contact 873，contract 1550，contract_line 1523，contract_obligation 1523，contract_party 1523，contract_billing_schedule 1508，receivable_plan 2066，invoice 1916，document_link 960，audit_log 2586，lead 5，opportunity 7，quotation 1，tender 1，integration_operation 1（succeeded）。<br>**People**：employees 92，assignments 118，employee_private_facts 456，directory_lifecycle_versions 92，positions 3，ranks 15，standard_cost_rates 18，performance_cycles 2，cost_snapshots 3，integration_operation 406（全部 succeeded）。<br>**Finance**：invoice 1957，receipt 2107，expense 3930，account_balance_snapshot 2161，bank_account 22，accounting_object 249，subject 73，contract_summary 1517，unclassified_income 933，project_finance_summary 761，invoice_request 2，people_cost_parameter 1。 |
| C04 | 生产统一库 Registry 只有 aims（115 表）、assets（37 表）两个 domain。**生产没有 Altoc 统一域，13 表独立安装只存在于 hzy0。** Runtime 配置中 altoc/people/finance 三个 app 均为 enabled=false。生产 Host 的 Altoc G1/G2 只读页因此不可用。 |
| C05 | `hzy_enterprise` 中没有任何 people/finance/altoc 前缀表；共享名冲突只能在生成闭集时判断。 |
| C06 | 合同为**单合同行**：多行合同数为 0，27 份合同没有合同行。状态分布：completed 1264、effective 262、terminated 24、bad_debt 4。回款计划：received 2061，to_invoice 1。**合同与项目关联表为空**，AA-03/04 的合同到项目链在存量数据中没有样本，多行、多项目场景需要用合成样本验证。 |
| C10 | 币种全部为 CNY。发票 1957 张，金额合计约 2.11 亿（issued 1956、red_reversed 1）。到账 2107 笔，合计约 2.08 亿，**reconciled_amount 全部为 0**，即存量从未在系统内核销。支出 3930 笔，约 2132 万。Altoc 侧 `invoice` 1916 与 Finance `finance_invoice` 1957 是两套发票来源，迁移时需要确定权威方并对账。 |
| C12 | 三库 integration_operation 全部为 succeeded，没有在途、租约或死信。 |
| C13 | 生产 Workflow 的 flow_action_defs 为：altoc 3 个（approve），finance 1 个（request），people 0 个。实例方面：altoc 有 1 个 running（id 40，customer/approve，2026-04-14，callback_url 为空），属于遗留实例；finance 有 1 个 approved。People 在生产没有审批定义。 |
| C14 | 旧服务客户端 altoc.runtime（120 条 active grant）、finance.runtime（80 条）、people.runtime（38/39 条）仍为 active，另有 aims/console/assets 指向这三域的跨域 grant。enterprise.runtime 已有 `data-runtime:altoc:enterprise-host`，**没有** people/finance 的 enterprise-host。旧 grant 留待 M6 退役时处理，本轮不动。 |

**对估算和首批的影响**
- WP2 迁移不需要考虑活动 writer 和在途命令（全部 succeeded），风险下降。
- 但生产统一库从零建 Altoc 域：hzy0 的 13 表只能作为参考，不能当作生产已有。
- 存量合同全部是单合同行，且没有项目关联；首批 Altoc 合同主链的“多行/多项目”验收只能依赖合成样本。
- 财务核销是全新流程，存量没有核销数据可以对照；双发票来源需要业务决策。
- People 审批在生产为 0，§11 第 1–2 条的 People 审批缺口可以优先考虑退役或重新设计，不存在历史包袱。

## 14. 用户决定（2026-10-03）

- **Altoc 历史数据不迁移，数据结构可以重新设计。** 冷存档 `hzy_altoc` 保留为只读历史档案，不进入统一库迁移闭集。WP2 中 Altoc 的迁移部分取消，WP4 改为“在统一库中按新设计建立 Altoc 域”。
- 待确认的连带影响：
  1. Finance、People 是否迁移历史数据。Finance 的发票、到账、合同摘要按合同或客户编码引用 Altoc；如果 Finance 迁移而 Altoc 不迁，这些引用会变成悬空的历史编码。
  2. 客户主数据（757 个）是否也重新录入，或者只做一次性导入。
  3. 重新设计的边界：复用现有业务规则（状态机、付款条款、开票条件），还是同时调整业务流程。
- **补充（同日）：Finance、People 同样不迁移历史数据，数据结构也可以重新设计。** 三个冷存档库（`hzy_altoc`/`hzy_people`/`hzy_finance`）全部保留为只读历史档案。WP2 由“迁移闭集”改为“三域新 schema 在统一库中的建库与安装规格”。客户主数据是否一次性导入、重新设计按 A（沿用业务规则、重整结构）还是 B（同时调整流程），暂按 A 推进，客户导入作为可选项在设计中预留。
