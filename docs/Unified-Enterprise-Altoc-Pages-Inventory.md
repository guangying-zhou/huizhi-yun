# Altoc 页面盘点：波次 3 合同到交付链

日期：2026-09-26；执行者：Codex-sol2。只读源码盘点，仅新增本文；未运行页面、API、测试、数据库、外部服务，未改代码/环境。当前源码基线 `f8a1fb90` 后的工作区；其他代理未提交代码不纳入交付证明。

## 1. 先列安全与失败边界

以下是源码发现，不是已复现的真实租户泄漏；秘密值未读取。

| 编号 | 位置与流向 | 判断与波次 3 要求 |
| --- | --- | --- |
| ALT-SEC-01 | `server/api/v1/documents/index.post.ts` 的 Runtime `message` 与 Codocs `Error.message`；客户 delivery-package、documents/external-view、contracts/invoice-files/view 等 BFF 同样存在上游 message 进入异常的路径 | 原始错误可能带地址/诊断/秘密形状，页面 toast 可显示 error.data.message。Host 必须固定错误/类别、重建响应；未证明实际包含秘密，不能当安全摘要复用。 |
| ALT-SEC-02 | 合同列表 `contract_scan_url` 直接 iframe/window.open；DocumentsPanel 外链经 external-view 校验关联后302；发票 view BFF 将 Finance OSS 签名 URL 返回JSON或302，签名有效期10分钟 | 外链/签名 URL 是敏感访问材料与外部访问面；合同扫描直接链接没有沿用 documents 关联校验。禁止把临时 URL 放共享导航/缓存/日志，Host 是否提供预览需独立决定。external-view 已 HTTPS、禁止URL userinfo、private/no-store；不能声称所有扫描链接同样受保护。 |
| ALT-SEC-03 | `server/utils/financeApi.ts` listFinanceInvoices 异常→空列表+原始 warning；getFinanceContractSummaries 异常日志后继续 | 存在弱化失败的工具实现，但本页 invoices 已由 middleware→Runtime处理，旧 invoices.get 只503；不能把未命中的旧工具称当前页面泄漏。getFinanceHeaders 默认抛错，只有 optional=true 才无Authorization回退，本次未发现页面调用 optional=true，**不是已证实认证绕过**。新链必须503而非空成功。 |
| ALT-SEC-04 | 合同 activation job/step、合同详情聚合与 audit 数据；原页面展示错误、处理历史、关联快照 | 普通详情不能透传 arbitrary job/step/metadata/error；按岗位范围白名单输出，尤其不输出 command/hash/idempotency/lock/auth/原始请求响应。运维诊断需遵守 integration_operations 投影合同。 |
| ALT-SEC-05 | DocumentsPanel POST可创建Codocs正文或关联UUID，合同/报价/客户审批、合同履约、开票、工单派发与反馈均可跨应用写 | “详情只读迁入”必须关闭组件内部写动作及新建/编辑/审批/派发深链，或链接明确回独立Altoc；不能仅隐藏页头按钮。外部通知、存储、Workflow、Finance实际副作用留原拥有方。 |

## 2. 范围、权限与操作口径

来源：[Altoc模块约束](../altoc/CLAUDE.md)、[Altoc/Aims扩展](./Unified-Enterprise-Altoc-Aims-Expansion.md)、[模块合同](./MODULE_CONTRACTS.md)、[Altoc manifest](../altoc/app.manifest.json)。全量发现 **31个页面**，含登录/拒绝/管理占位。没有独立 contacts、service-ticket、maintenance/service-agreement 页面；服务工单及反馈嵌在客户详情，不能按manifest资源数虚构页面。

路径表省略统一前缀 `A=/api/v1`；页面路径为 Altoc 模块内部路径，独立部署通常加 `/altoc`。`{id}` 是本地对象ID，`{code}`是业务code，不得混用。表中 `GET contracts` 表示 **GET A/contracts**，同理每个列举METHOD都带 A 前缀。

Runtime：`R(x)` 表示已有 Altoc owning HTTP **同 METHOD `/v1/altoc/x`**，由 `data-runtime/internal/apps/altoc/runtime_router.go` 与 `adapter.go` 的资源/专用handler承接；不是 Enterprise fixed operation。`B` 表示 Altoc BFF编排/其他事实源，不能直接改前缀映射。`E0` 表示 `foundation/server/utils/enterpriseRuntimeClient.ts` **没有该页所需固定操作**。唯一Altoc固定操作为 `altoc.contracts-activate-delivery` → POST `/v1/enterprise/altoc/contracts:activate-delivery` / `altoc:contract:activate-delivery`，已有 Host POST `/altoc/api/v1/contracts/{contractCode}/activate-delivery`，但无Altoc页面组合；不能推导全模块已迁入。

人员权限依 `server/utils/altocPermissionRoutes.ts` 与具体handler：资源是 **customer/lead/opportunity/quotation/contract/receivable（单数）**，tenders 使用 quotation，不是 tender；teams使用admin，不是settings。config只读七项在permission route返回null，仍需登录及各handler/Runtime边界，不伪造 settings:view必需。Runtime现有middleware用 `altoc.read/altoc.write` 加 `altoc:<resource>:<action>`；这描述存量，不建议新增宽capability。所有对象scope由服务端当前授权编译，浏览器不得提供可信scope。

## 3. 逐页清单

组件列列出业务组件，所有页自有模板的Nuxt UI表格/表单/弹窗记为“页内UI”；D=DocumentsPanel，A=AuditTimeline，U=UserName/UserPicker，I=AltocInstanceConflictExplanationModal，L=LeadConvertModal。组件隐藏请求及跨应用依赖见§4，不能漏算。

| 页面（`app/pages/`）/组件 | 读取 METHOD+路径 | 可达写入 METHOD+路径/人员manifest动作 | Runtime / Enterprise | 跨应用、敏感数据与建议 |
| --- | --- | --- | --- | --- |
| index.vue / 页内UI、U | GET dashboard/summary；GET opportunities；GET dashboard/receivables | 新商机/业务详情深链；dashboard:view、opportunity:view、receivable相关范围 | R(dashboard/*、opportunities)；E0 | 经营金额/回款提醒；先读，摘要不等于细项权限。S/M |
| dashboard/index.vue / 页内UI | GET dashboard/kpis、dashboard/funnel、dashboard/forecast、dashboard/receivables、dashboard/sales-insights | 无直接写；dashboard:view；manifest export存在但本页未见导出请求 | R全部；E0 | 聚合范围和预测敏感；后于基础读链。M |
| customers/index.vue / 页内UI、U | GET customers；GET config/industries、config/regions、config/customer-levels | DELETE customers/{id}；new/edit链接；customer:view/edit | R(customers、levels)；industry/region B；E0 | 客户/联系人隐私，删除必须关闭。M |
| customers/new.vue / 页内UI、U | GET config/industries、regions、customer-levels、customer-types | POST customers；customer:edit | R(customers、level/type)；行业区域B；E0 | 新客户与通知可能副作用；写后批。M |
| customers/[id]/edit.vue / 页内UI、U | GET customers/{id}；四项字典同new | PUT customers/{id}；customer:edit | R CRUD、字典混合；E0 | 主档/负责人范围；写后批。M |
| customers/[id].vue / 页内UI、U、A、ServiceTicketProductFeedback | GET customers/{id}；GET config/industries、regions；GET opportunities?customer_id；GET contracts?customer_id；GET customers/{id}/invoice-infos；GET customers/{code}/maintenance-summary、delivery-package、maintenance-financial-summary | POST customers/{id}/contacts、invoice-infos；PUT customers/{id}/invoice-infos/{infoId}；PUT customers/{id}含approval/status/负责人等；POST service-tickets/{code}/aims-work-item；反馈写见§4；customer:view/edit/approve、service_ticket:edit | R主档/发票信息；三个code摘要B；E0 | Assets/Finance摘要、Aims派发、Workflow审批、反馈链；开票资料含税号/银行/邮箱。拆“客户基础只读”与“服务运营”，勿整页搬。L |
| leads/index.vue / 页内UI、U、L | GET leads；L的conversion-preview | L POST leads/{id}/convert；新建深链；lead:view/convert | R列表/转换；E0 | 线索转换可创建客户联系人/商机；先只读。M |
| leads/new.vue / 页内UI、U | 用户候选见§4 | POST leads；lead:edit | B创建handler→R(leads)；E0 | 个人联系数据/负责人通知。M |
| leads/[id].vue / 页内UI、U、L | GET leads/{id}；L GET leads/{id}/conversion-preview | POST leads/{id}/activities、disqualify、assign、convert；lead:activity/disqualify/assign/convert | R详情与命令；assign B补通知；E0 | 即时动作+转换事务，关闭L提交。M |
| opportunities/index.vue / 页内UI、U | GET opportunities；GET customers；GET config/opportunity-stages | POST opportunities/{id}/transition、close-won、close-lost、pause；新建链接；opportunity:transition | R列表/状态；E0 | 列表本身可写，商机金额/客户范围。M |
| opportunities/new.vue / 页内UI、U | GET config/opportunity-stages；GET customers、customers/{id} | POST opportunities；opportunity:edit | B创建→R；E0 | 客户授权和目录选择分别检查。M |
| opportunities/[id]/edit.vue / 页内UI、U | GET opportunities/{id}、customers | PATCH opportunities/{id}；POST opportunities/{id}/assign；opportunity:edit/assign | R更新；assign B；E0 | 负责人通知/写作用域。M |
| opportunities/[id].vue / 页内UI、U、D、A | GET opportunities/{id}；GET config/opportunity-stages；GET customers/{customerId}/contacts | POST opportunities/{id}/transition、close-won、close-lost、pause、reopen、activities、contact-roles；PUT/DELETE opportunities/{id}/contact-roles/{roleId}；opportunity:transition/activity/edit；D写 | R命令及关系；D B；E0 | Codocs、审计admin:view独立；新报价/合同/投标深链需只读模式关闭。L |
| quotes/index.vue / 页内UI、U、I | GET quotes；I POST authorization/instance-conflict-explain | 新建/详情链接；quotation:view；I另receivable:view | R(quotes)，I B；E0 | 报价金额与冲突解释不是无权限旁路。M |
| quotes/new.vue / 页内UI、U | GET customers、customers/{id}、opportunities、opportunities/{id} | POST quotes；quotation:edit | R；E0 | 价格/项目归属；写后批。M |
| quotes/[id].vue / 页内UI、U、D | GET quotes/{id} | POST quotes/{id}/status、approve；POST contracts/from-quotation；quotation:edit/approve、生成合同需contract:edit；D写 | R报价/生成草稿；Workflow B；E0 | Workflow、Codocs；“转合同”直接跨对象写，不能只保留批准按钮隐藏。L |
| contracts/index.vue / 页内UI、U、I | GET contracts；I POST authorization/instance-conflict-explain | 新建/详情链接；contract:view；I receivable:view | R(contracts)；E0 | contract_scan_url外部iframe/open；需独立净化/预览决策。M |
| contracts/new.vue / 页内UI、U | GET customers、customers/{id}、customers/{id}/contacts；GET opportunities、opportunities/{id}；GET config/contract-business-templates；GET contracts；GET quotes/{id}；GET assets/products | POST contracts/drafts；POST documents创建/关联外链/UUID；contract:edit，关联来源各自view | R草稿与本域读；Assets/Codocs B；E0 | 多行/条款/产品/文档，非简单CRUD；必须拆域授权。L |
| contracts/[id].vue / 页内UI、U、D、A | GET contracts/{id}、contracts；GET config/contract-business-templates；GET contracts/{id}/invoices、stages、activation-plan、eligible-aims-projects；GET contracts/invoice-files/view | §5完整动作；contract:view/edit/approve/admin；开票receivable:edit；D写 | R详情/计划/阶段/发票；项目候选/文件B；**只有统一激活E1** | 核心链：Aims/Assets/Finance/Codocs/Workflow。分详情只读、关联、激活、结算四闭包。XL |
| payments/index.vue / 页内UI、U、I | GET payments；I POST authorization/instance-conflict-explain | 详情链接；receivable:view | R(payments)；E0 | 实收/应收、发票衍生摘要；Finance事实不能本地修改。M |
| payments/[id].vue / 页内UI、U | GET payments/{id} | POST payments/{id}/confirm；PUT payments/{id}改状态/负责人；POST receivable-plans/{code}/invoice-request；receivable:confirm/edit | R回款；开票B冻结operation；E0 | Finance开票→Workflow，不把confirm等同财务核销；写后批。L |
| tenders/index.vue / 页内UI、U | GET tenders | 新建/详情链接；quotation:view | R；E0 | 非必经合同主链，后批。M |
| tenders/new.vue / 页内UI、U | GET customers、customers/{id}、customers/{id}/contacts、opportunities、opportunities/{id}、tenders/agencies | POST tenders；quotation:edit | R；E0 | 招标方/代理联系数据、保证金；后批。M |
| tenders/[id].vue / 页内UI、U、D | GET tenders/{id} | PUT tenders/{id}状态/结果/复盘；POST/PUT tenders/{id}/milestones；POST/DELETE tenders/{id}/members；quotation:edit；D写 | R专用/CRUD；D B；E0 | Codocs标书/复盘、成员关系；后批。L |
| settings/index.vue / 页内UI | GET config/industries、regions、customer-levels、customer-types、opportunity-stages、payment-term-templates | POST/PUT/DELETE config/dict；settings:edit（只读字典不统一要求settings:view） | R四本域字典/dict；行业区域B；E0 | 源设置仍含旧accountBaseUrl管理链接，不能继承进Host，应映射现有Console配置入口；不读/修改Account模块。M |
| settings/teams.vue / 页内UI、U | GET teams、teams/{id} | POST teams；POST/DELETE teams/{id}/members；admin:view/edit | R teams；候选B；E0 | 团队/成员业务关系不是Console目录替代。M |
| settings/profile.vue / 页内UI | useAuth本地身份展示，无业务GET | 无写；登录身份，不推定settings:view接口 | 无独立Runtime；E0 | Host已有profile，不重复迁移。XS |
| admin/index.vue / 页内UI | 无请求，占位 | 无动作；导航/入口按admin:view复核 | 无操作；E0 | 无业务收益，不单独迁入。XS |
| admin/integration-operations.vue / IntegrationOperationAdminPage | GET integration-operations；GET integration-operations/{operationId}/attempts | POST integration-operations/{operationId}/replay；integration_operations:view/replay，全局scope | R diagnostics/attempts/replay+安全BFF投影；E0 | 重放有后台跨应用效果；安全读可后续拆入，replay单独批准。M/L |
| login.vue / 页内UI | GET /api/auth/oidc-login（**不带A**），window.location跳转 | 无业务写 | Foundation/OIDC；E0 | Host统一会话，不迁独立登录壳。XS |
| no-access.vue / 页内UI | 无业务请求 | 无动作 | 无操作；E0 | 复用Host拒绝页，不计业务能力。XS |

## 4. 组件及隐藏依赖闭包

| 组件/辅助链 | METHOD+路径、权限、Runtime与跨应用 |
| --- | --- |
| DocumentsPanel + DocumentPreview | GET A/documents?entity_type=&entity_id=；GET A/documents/preview；GET A/documents/external-view；POST A/documents；DELETE A/documents/{linkId}。Altoc按entity_type映射对应customer/lead/opportunity/quotation/contract view/edit，tender→quotation；GET/DELETE关系有R，POST B先Codocs创建/关联授权再R写关系。preview B要求真实关联及Codocs用户ACL，不能只看UUID；外链302会访问外部；Markdown图片亦会产生资源请求。只读模式须关闭create/attach/delete。 |
| AuditTimeline | GET A/audit-logs?entity_type=&entity_id=，admin:view而非对象view；R(audit-logs)，不得在普通合同详情默认扩大管理员审计权限。 |
| LeadConvertModal | GET A/leads/{id}/conversion-preview；POST A/leads/{id}/convert，lead:view/convert，目标客户/商机事实由原转换handler校验；R冻结转换，不由Host重新拼CRUD。 |
| UserName/UserPicker | UserName通过Foundation useAccountStore目录缓存/按uid精确Console Directory加载，并不是Altoc DB；UserPicker GET A/teams/users 无teamID→B Directory候选，有teamID则R(teams/users)。目录“可选人”不代表有目标对象管理权限。 |
| AltocInstanceConflictExplanation | POST A/authorization/instance-conflict-explain，receivable:view，B调用当前Console范围解释并绑定实例证据；虽POST为诊断读取，不是业务写，也不能赋edit兜底。用于quotes/contracts/payments列表。 |
| usePageWorkflow | 客户/报价/合同页均使用Foundation审批桥；业务状态接口之外还需流程资格、实例、启动/审批/撤回链。具体路径来自共享Workflow helper，不能把页面本地approve接口当完整审批合同；迁入前必须按操作登记精确路径及回调服务身份。 |
| ServiceTicketProductFeedback | 客户页工单卡片→GET A/service-tickets/{ticketCode}/product-request；POST同路径提交 expectedSourceSha256；POST A/service-tickets/{ticketCode}/product-request-resume 空body恢复。B→Altoc冻结operation→Aims from-feedback receipt；决策/公开版本进展由Aims签名回写Altoc。代码已有，扩展文档PC17“实现中”是历史快照，真实部署/grant/业务启用仍未知；不以UI存在宣布启用。 |

## 5. 合同详情写动作拆解（均可由现有页面触达）

| METHOD+ A路径 | 原权限/Runtime与后续效果 |
| --- | --- |
| PUT contracts/{id}/draft | contract:edit；R草稿更新，带行/条款/关系，不能泛化合同所有状态字段可编辑 |
| POST contracts/{id}/submit、withdraw、mark-signed、suspend、terminate、fulfillment/close | contract:edit；R lifecycle，状态/审计/义务与前置条件；终止/履约关闭不是普通字段PATCH |
| POST contracts/{id}/approve；POST contracts/{id}/status | approve/reject需contract:approve，其余edit；R状态，Workflow资格/回调独立 |
| POST contracts/{id}/management | contract:admin（页面还检查系统管理资格）；force_complete/terminate/invalidate；R管理命令，高风险留原页 |
| POST contract-obligations/{obligationId}/start、submit、accept、reject | contract:edit；R义务状态机，提交证据/拒绝理由及结算联动 |
| POST contracts/{id}/stages | contract:edit；R阶段记录，文档UUID/标题/处理日期，别把标题当ACL证明 |
| POST contracts/{id}/project-links | contract:edit；R结构化行/义务关系；候选GET是B→Aims eligible-for-contract，需要Aims独立授权，关系使用project_code |
| POST service/contracts/{contractCode}/activate-delivery | **原页面路径**：本地用户态编排入口需contract:edit/范围，冻结activation/operations→Aims project/milestone receipt、Assets交付计划及服务协议步骤；不是可直接映射的新Host统一路径 |
| POST contracts/{id}/activation/jobs/{jobId}/retry、cancel | contract:edit；R重置/取消job，cancel原因；必须与source outbox/目标receipt核对，不能重建幂等身份 |
| POST receivable-plans/{planCode}/invoice-request | receivable:edit；B→R冻结可靠operation→Finance target receipt→Workflow提交；页面submit:true，不把合同edit自动当回款edit |
| POST /altoc/api/v1/contracts/{contractCode}/activate-delivery | **已有Enterprise BFF**（非A相对路径）：空body、稳定幂等键；独立编译Altoc contract:edit范围与Aims projects:create短期permit→E1。Runtime开关/Registry双域guard、精确grant/当前credential须真实回读；不把旧服务scope或旧页面body原样复用。 |

## 6. 跨应用事实、秘密与副作用边界

- **Aims**：合同激活按project_plan多计划创建项目并同步付款里程碑，结构化project/line/obligation关系属于Altoc。Aims里程碑审批→Altoc可开票由受信Workflow回调/receipt链处理；AA-04已有受控同库core与HTTP隔离证据，默认开关与线上启用必须分开。项目名称历史快照不能当当前客户名，当前名仍需Altoc授权读。
- **Finance**：开票/核销/维护收入是Finance事实；回传finance-summary:sync使用单调/幂等service command。普通合同invoices在Runtime adapter需要Finance bridge，缺bridge503；不可只挂通用CRUD。发票文件有OSS签名访问材料，财务金额/税号/银行信息按业务敏感数据处理。
- **Codocs**：Altoc只保存UUID/关系与最小上下文，不复制正文或改变ACL。新建文档/知识归档会写Codocs，知识链还依赖Assets单目标operation。预览必须实体授权与正文ACL双门槛。
- **Workflow**：流程发起/提交/审核/撤回与业务状态必须一致；service callback不能用浏览器approve伪造。现有service token能力及委托审计保留，不用管理员权限冒充岗位审批。
- **Assets/Console**：产品候选、交付资产计划/状态、服务覆盖是Assets关系；通知和死信actionable有Console后台写/外部投递可能。Token、runtime credential、OSS密钥仅服务端解析，浏览器不持有service token。跨应用grant/受控重放/运行调度不是页面迁入附赠范围。
- **稳定幂等**：旧网络operation/source ACK与target receipt不删不重生成；旧租约/drain要核对。共享事务不得网络外呼，Finance/Assets/Codocs等未登记同pool目标继续异步。页面fetch未显式带幂等键处须实施前逐动作核对，不能根据“原接口已有”推定所有按钮可安全重试。

## 7. 建议分组、顺序与停止条件（待 Claude 决定）

| 组 | 页面/动作与预计规模 | 顺序理由、准入 |
| --- | --- | --- |
| W3-R1 | customers/contracts列表、customer基础详情、contract基础/行/条款/义务/结算只读，payments列表/详情只读；M～XL | 先形成“客户→合同→交付关系→回款状态”证据链。关闭扫描/签名预览及所有嵌入写，摘要/审计/服务运营分开。每个所需R操作仍需精确Enterprise登记、Host BFF、Gateway拓扑测试、manifest导航贡献；E0不是已ready。 |
| W3-R2 | 项目候选/既有关联、activation安全摘要、Finance摘要/文档受控预览；L | 先补白名单和跨域独立授权/失败语义，不复用任意原始payload。合同activation摘要不泄命令/原错；Codocs和Finance单独闭包。 |
| W3-W1 | 合同→Aims统一履约启动E1、里程碑可开票AA-04；XL | 优先复用扩展文档已提取 owning tx/receipt与permit，先确认Runtime开关、双域登记/物理映射、当前service grant、迁移generation、单writer/taskowner；业务与恢复验收后再切，不另拼网络写SQL。 |
| W3-W2 | 草稿/报价转合同、合同生命周期、义务/阶段、项目关联；L～XL | 写合同先冻结数据与权限/版本字段、确认/幂等与刷新失败分离；审批回调另审。不连带管理员force_complete/作废。 |
| W3-F | Finance开票与回款确认/核销回传；L～XL | 接INT-603，Finance事实和Workflow单独验收；不能因Altoc菜单迁入顺便搬Finance。 |
| W3-Later | lead/opportunity/quotation/tender完整写、dashboard、service运营/反馈/知识；settings/teams/admin诊断另包 | 上游获客、运营成本/反馈与主合同到交付并非全部必经；按需要接读，后台replay和配置写单独批准。profile/login/no-access/admin占位复用Host，不重复迁壳。 |

停止条件：未知/错scope或对象范围、缺owner reader/Finance bridge、跨域映射或generation不一致、错误/签名材料未经净化、新增API未逐METHOD登记网关拓扑、重复写/ACK不确定、未完成旧lease/drain、未获环境启用授权。先报告，不临时用宽capability、旧库、直接BFF数据库或手工修关系绕过。

## 8. 证据定位与待决定

关键实现：`altoc/server/middleware/tenant-runtime.ts`（分流/排除/传输+资源scope）；`altoc/server/utils/altocPermissionRoutes.ts`（人员动作）；`data-runtime/internal/apps/altoc/adapter.go`、`runtime_router.go`（真实资源/命令/parent scope）；`foundation/server/utils/enterpriseRuntimeClient.ts`（E1唯一登记）；`enterprise/composition/business-api-routes.generated.mjs`（Host仅activation API，不是页面挂载）；`altoc/server/utils/db.ts`（direct DB全部失败，旧server文件不能作可用实现证明）。跨域详见MODULE_CONTRACTS可靠operation章节及Phase4、PC17，与扩展文档最后增量一起读，不能只读历史“尚未实现”段。

待决定：W3是否先批准R1且排除附件/服务运营；是否以现有E1/AA-04为首个写闭包；Finance/Workflow、资料预览各自边界与负责人；只读写流程链接是隐藏还是明确回Altoc。实际部署/授权、调用频率/错误率、待处理operation/租约、水位、当前Runtime开关、本机样本、岗位登录证据本次均**未知**；无INT-601/602或P5完成结论。

### 页面源文件索引（31/31）

- [admin/index.vue](../altoc/app/pages/admin/index.vue)
- [admin/integration-operations.vue](../altoc/app/pages/admin/integration-operations.vue)
- [contracts/[id].vue](../altoc/app/pages/contracts/[id].vue)
- [contracts/index.vue](../altoc/app/pages/contracts/index.vue)
- [contracts/new.vue](../altoc/app/pages/contracts/new.vue)
- [customers/[id]/edit.vue](../altoc/app/pages/customers/[id]/edit.vue)
- [customers/[id].vue](../altoc/app/pages/customers/[id].vue)
- [customers/index.vue](../altoc/app/pages/customers/index.vue)
- [customers/new.vue](../altoc/app/pages/customers/new.vue)
- [dashboard/index.vue](../altoc/app/pages/dashboard/index.vue)
- [index.vue](../altoc/app/pages/index.vue)
- [leads/[id].vue](../altoc/app/pages/leads/[id].vue)
- [leads/index.vue](../altoc/app/pages/leads/index.vue)
- [leads/new.vue](../altoc/app/pages/leads/new.vue)
- [login.vue](../altoc/app/pages/login.vue)
- [no-access.vue](../altoc/app/pages/no-access.vue)
- [opportunities/[id]/edit.vue](../altoc/app/pages/opportunities/[id]/edit.vue)
- [opportunities/[id].vue](../altoc/app/pages/opportunities/[id].vue)
- [opportunities/index.vue](../altoc/app/pages/opportunities/index.vue)
- [opportunities/new.vue](../altoc/app/pages/opportunities/new.vue)
- [payments/[id].vue](../altoc/app/pages/payments/[id].vue)
- [payments/index.vue](../altoc/app/pages/payments/index.vue)
- [quotes/[id].vue](../altoc/app/pages/quotes/[id].vue)
- [quotes/index.vue](../altoc/app/pages/quotes/index.vue)
- [quotes/new.vue](../altoc/app/pages/quotes/new.vue)
- [settings/index.vue](../altoc/app/pages/settings/index.vue)
- [settings/profile.vue](../altoc/app/pages/settings/profile.vue)
- [settings/teams.vue](../altoc/app/pages/settings/teams.vue)
- [tenders/[id].vue](../altoc/app/pages/tenders/[id].vue)
- [tenders/index.vue](../altoc/app/pages/tenders/index.vue)
- [tenders/new.vue](../altoc/app/pages/tenders/new.vue)
