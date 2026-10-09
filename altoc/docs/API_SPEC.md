
## APF-16a Enterprise 投标候选

Host `/altoc/api/v1/tenders` 族及 Runtime `/v1/enterprise/altoc/tenders:*` 等10个固定 U 操作，人员权限明确为 opportunity:view/edit，不新增 tender 资源或 grant。严格 parent expectedVersion + Idempotency-Key；读取同快照 COUNT/分页和当前关联范围，写入/审计/回执同事务。完整字段、错误码、成员/节点命令和安装回滚边界见 [Host-Tender-API.md](Host-Tender-API.md)；四表尚未在环境安装。

## Host APF-16b（候选）

`/altoc/api/v1/service-agreements` GET分页/POST新建；`/:agreementId` GET详情/PATCH编辑；`/:agreementId/coverages` GET分页/POST添加；`/coverages/:childId/{resolve|suspend|end}` POST固定动作；`/:agreementId/projects` GET分页/POST绑定；`/projects/:childId/{set-default|suspend|end}` POST。14个固定Runtime U操作，contract:view/edit+当前合同/客户范围；写入expectedVersion（父协议版本）与Idempotency-Key。列表page/pageSize≤100/search，COUNT同快照，响应private,no-store、白名单。400输入非法，403权限/归属拒绝，404目标不存在，409版本/关系/幂等冲突，503依赖或安装未就绪。旧维保/权益只读，不开放confirm-legacy。

## Host APF-16c（候选）

`/altoc/api/v1/service-tickets` GET分页/POST新建；`/:ticketId` GET详情/PATCH编辑；`/:ticketId/{close|reopen|dispatch|dispatch-resume}` POST；`/:ticketId/dispatch-status` GET。9个固定 Runtime U 操作，人员 service_ticket:view/edit/close/reopen 独立动作与当前客户/工单范围。非创建写携 expectedVersion 与 Idempotency-Key。派发只接 project_code/estimated_hours，恢复只接版本；不接受目标执行状态、消费额度或投递 generation。角色未显式拥有 reopen 不得重开。权限加载失败明确提示，不静默作为无权；列表pageSize≤100/共N条同快照。

创建协议必填，customer/contract由服务端派生。active协议且额度足够才可派发；超限409 service_ticket_quota_exceeded（“服务额度不足，无法派单，请补充合同或额度”）。版本/自然键冲突409，不存在404，未安装或依赖失败503。当前旧键重放仍复核权限与目标；原服务响应分钟/解决分钟及累计差额规则不变。Aims新事项与Altoc执行关系同事务，批量完成回写一项失败整批回滚。普通更新不能重开，显式重开不退款或改Aims状态。

## APF-16f Host 产品反馈

`GET /altoc/api/v1/service-tickets/:ticketId/product-feedback` 返回源预览或已冻结反馈、正式评估与版本进度。`POST` 同路径仅接受 expectedSourceSha256，`POST .../product-feedback/resume` 仅接受空 body，两者必带稳定 Idempotency-Key。工单 edit 范围为前置，写动作另核当前产品 create 权限。身份/产品/评估/补证字段由服务端确定，不接受浏览器声明。首轮事务冻结原命令与审计，再由用户路径尝试 caller-Tx 恢复；失败后只恢复同 operation/key，不更改源字节，不重复建需求。撤权后旧键拒绝，已拒绝需求不可重提。

旧 Aims 生产者继续向 status/progress 两个 Service API 投递；Host 新接收端保留原 aud=altoc、aims.runtime、精确 capability 与签名信封，实时内省、部署/来源/摘要验证后，以自己系统身份请求 Runtime 接收。不同版本单调更新，同版本异摘要 409，回执重放不重复应用。没有迁移 Aims owner，没有扩展 Workflow。新三表和路径必须在 APF-18B/C 环境切换核对之后启用，当前只交付制品。

### APF-16g Host 服务财务/成本摘要

|Host GET|固定 U 操作|人员门槛|
|---|---|---|
|`/altoc/api/v1/customers/:customerId/service-finance-summary`|`altoc.apf16g-customer-service-finance-summary`|customer:view 当前对象范围 AND 各 Finance invoices/receipts/reconciliation:view 责任范围|
|`/altoc/api/v1/service-agreements/:agreementId/cost-summary?periodMonth=YYYY-MM`|`altoc.apf16g-service-cost-summary-view`|contract:view 当前合同/客户范围 AND Finance project_accounting:view 项目范围|

两操作沿用域 U capability，Host 无 request body，服务端 Finance 窄投影绑定签名意图（actor/tenant/deployment/TTL≤15s）。只读快照、private,no-store、白名单响应。拒绝区块只有 access=denied，没有count/total。客户金额按币种分组；成本用月份有效的协议项目关系与 Finance 范围交集，未核算金额为null；依赖或超1000对象失败503，不返回部分统计。不会启动旧维保摘要/定时重算，不返回员工或工资。

### Enterprise APF-18B1 到期通知（候选，默认关闭）

`POST /v1/enterprise/altoc/{sales-due|billing-due}:{scan-due|published|closure-ack}` 为六个固定 S 操作，只接受验签 enterprise.runtime 和 `altoc:scheduler:execute`，无用户 actor。scan body `{}`；published 为 `{eventKey,notificationId,recipientUid}`；closure-ack 为 `{eventKey,state}`（resolved/cancelled）。scan 返回冻结 items 和已发布后才可关闭的 closures，不返回金额。P 复用 `/v1/altoc/notification-details/authorize` 的签名 viewer，加固定 `{eventKey}`。安装三表候选见 altoc_enterprise_due_schema.sql；唯一 owner/退役与回执未知处理见 MODULE_CONTRACTS APF-18B1。本批不改变独立 Altoc 通知合同。

#### Enterprise APF-18B2 dead-letter owner（未启用候选）

固定 S POST `/v1/enterprise/altoc/{pending-dead-letter-actionables|dead-letter-actionable-published|pending-dead-letter-closures|dead-letter-closure-acknowledged}`；enterprise.runtime + altoc:scheduler:execute + Registry scheduler generation。复用共享账本，无新增 schema/用户操作。`HZY_ENTERPRISE_ALTOC_DEAD_LETTER_NOTIFICATIONS_ENABLED` 默认关闭，旧 task/请求内投递必须关闭并完成原键对账；原 source_app=altoc 事实不作为出站身份。新发布源 enterprise，只站内，详情需当前 integration_operations:view 和冻结收件人。部署及 grant 均待审批。

## APF UI B1 合同列表签约日

Enterprise 合同列表可选 `signedDateFrom` / `signedDateTo`（合法 `YYYY-MM-DD`，闭区间，起始日不得晚于结束日）。空值不进入请求或 permit 规范正文；新增键按 from、to 顺序追加在既有可选筛选键之后，旧请求签名字节保持不变。服务端人员与对象范围保持原合同。

响应只读字段 `signed_date`：原生合同取 `sign_date`；历史合同优先取 UTC `signed_at` 在 Asia/Shanghai（+08:00）对应日期，无时间戳时回退 `sign_date`。缺失日期不使用导入日期补齐。服务端先执行范围与日期筛选，再同一快照计算 COUNT、金额 summary 和分页；排序为签约日 DESC、ID DESC，缺失日期在最后。summary 仍为当前合同额按币种汇总，不能解释为原签约额或有效金额汇总。

### APF UI B1 验收修订：合同客户投影与筛选

合同列表/详情仍由 contract:view 与原合同范围判定。客户名称使用同一策略快照下独立 customer:view 范围许可，作为可选 customerRead 附加于原 token-bound HMAC permit；Runtime 复用原 permit 校验，绑定 actor/tenant/deployment/版本/到期时间，拒绝嵌套许可和跨快照拼接。无客户读授权时合同不消失，customer_visible=false、customer_name=NULL；依赖故障仍为 503。每页只做一次 scoped 客户批量查询，不逐行读取。

搜索覆盖合同名称/编码/合同编号，客户名称匹配只在独立客户范围内执行；不可见客户不贡献搜索命中。新增 ownerUid、direction、contractType、amountMin、amountMax 均可选且仅有值时签入；旧空参数 permit 字节不变。金额为非负 DECIMAL(18,2)，区间包含边界；按列表合同金额过滤（历史原签约额、原生当前额），不换算币种。所有筛选先于 COUNT、全结果 summary 和分页，分页上限 100。

有效额缺失只在显示时回退到该行合同金额，注明来源，不改有效额存储或统计口径。显示列的本机保存不保存视图/筛选/合同内容。详情次要信息以概览、履约与项目、来源与关联页签组织；桌面关键信息网格，390 宽度单列。

## B5-A 应收工作台与催收责任

Host `/altoc/api/v1/receivables` 提供真实分页、同快照账龄汇总及详情；三个写入口分别要求 `receivable:assign`、`receivable:set-due-date`、`receivable:followup`，绑定当前数据范围、`expectedVersion` 与 `Idempotency-Key`。沿用结算计划和到期通知，不新增平行应收主账或扫描器。

完整字段、安装子集、锁序、历史未就绪与法人筛选的额外 Finance 权限见 [B5-A 合同](../../docs/B5A-Receivables-Contract.md)。
