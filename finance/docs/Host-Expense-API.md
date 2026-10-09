# Host Finance 支出、付款与配置（APF-13a / 13b）

13a 含支出台账、报销、项目支出申请；13b 新增付款申请、分类配置、审批关联与审计查询，精确范围见下文。
服务通道复用 Finance enterprise-host/scheduler 精确能力，不新增 grant。

## APF-13a 固定操作（20个）

Host BFF `/finance/api/v1/expenses` 映射 Runtime `/v1/enterprise/finance/expenses:{page,detail,create,update,delete,confirm}`。
BFF `/finance/api/v1/expense-claims` 映射 `claims:{page,detail,create,update,cancel,submit,confirm}`。
BFF `/finance/api/v1/project-expense-requests` 映射 `project-requests:{page,detail,create,update,cancel,submit,confirm}`。
列表 GET 根，详情GET /:code；创建POST根、编辑PATCH /:code、台账删除DELETE /:code；其余POST /:code/:action。禁止浏览器写批准事实。

列表 query `page=1&pageSize=20&search=&status=`，pageSize1–100，响应 `{data:[],total,page,pageSize}`。只有expenses-page可用 `projectOnly=true`，SQL过滤项目台账并计算对应total，不由客户端删行。详情和写入返回 `{data:row}`。

写入需 Idempotency-Key（原用户意图重试同键），非创建需当前 expectedVersion。服务端使用签名会话actor、fresh permit、当前scope及注册表代次栅栏。tenant:global或subject:self之外的scope失败关闭，列表、详情和写入范围一致。view/edit/confirm分别取manifest expenses动作；admin不隐式confirm。提交只允许当前申请人且有edit，不把其申请关系扩大为全局授权。

## 数据与状态

台账草稿字段：expenseDate、expenseAmount（正DECIMAL18,2字符串）、currencyCode、description、payeeName、projectCode、contractCode、customerCode；还允许精确 expenseTypeId/subjectId/bankAccountId/paymentChannel 字段，引用必须active。手工创建只能draft，确认只能draft→confirmed；确认后不允许编辑或删除。创建/编辑不能传handler、actor、状态或来源申请字段。

申请字段：title、currencyCode、projectCode、contractCode、customerCode、remark、items；项目申请projectCode必填。items1–100项，每项description、正amount字符串、可选occurredAt（报销日期）、expenseTypeId/subjectId；总额由服务端定点累加，不接收客户端total/approved/paid金额。无条目变更保持原条目。修改仅draft/rejected，取消仅未提交draft/rejected；pending冻结不可编辑。subject:self按当前落库申请人/经办人/创建人核对，global保留原可编辑范围。

draft/rejected→submit→pending_approval→可信人工审批回调approved/rejected。**批准不插入支出台账**。approved经独立confirm→paid，并原子生成唯一来源支出台账（confirmed）。确认需expenses:confirm，受信actor不得等于已落库applicant_uid、handler_uid、created_by；请求不能覆盖这些字段。不能复用actorless后台兼容路径。不是实际银行支付接口，不调用银企直连。

## 锁序、回执与跨域

caller-Tx次序：Altoc/Finance注册表代次栅栏 → 发现父记录（无锁） → Altoc owning客户/合同引用锁 → 稳定排序的Finance引用锁 → 申请/台账父锁及版本再核对 → owning回执 → 条目或来源唯一台账 → 审计/operation。所有条目写入经父锁串行；付款来源唯一索引 `(source_request_type,source_request_code)`。回执与审计结果同事务，软删除后同键可回放，跨键旧版本拒绝。

合同引用复核由Altoc owning typed caller-Tx入口完成，不写Altoc线索/商机，不消耗billing_schedule，不改合同开票/到账/核销摘要。现有摘要没有费用字段，本批不新增汇总业务规则。引用项目编码不创造额外项目数据范围。

## 审批闭集与恢复

只新增finance/expenses/claim与finance/expenses/project_expense。13b追加payment，见下节。两条旧相对path `/api/v1/finance/workflow/callback`、`/finance/api/v1/finance/workflow/callback` 明确兼容；发送端物理deliveryPath为Enterprise固定callback入口，冻结URL不变，SourceApp=finance不放宽。

submit固定操作内部只允许request（默认）和phase=bind两个阶段，BFF公共submit仅接收expectedVersion。绑定和恢复复用已有Finance只读实例reader/system通道，无新增固定系统操作。冻结action与resource、bizId、申请人、快照、版本、requestNo；实例resource/action、ID/no、biz/initiator/path/form必须严格匹配。回调还检查人工终态、非申请人决策证据及稳定回调键；无适配器503，同键恢复pending。失败回调不改变状态，审批通过本身不生成台账。

## 安装候选与上线前提

`apf13a_schema_candidate.sql`及domaininstall/finance_13a.json为五表子集，基于原B1+11a B3追加；ForFinance13a提供plan/apply/verify/非空拒绝rollback。另交付schema verify/rollback和两审批定义seed/verify候选。没有执行真实安装、授权或审批人配置。本批前端须与已安装映射及两条人工审批配置配套上线；旧B3部署返回503，不探测/直连本机环境。

附件上传及更细的费用维度编辑不伪装为已迁入口，本批无附件写路由；分类维护和付款申请由13b承接。已存明细、金额和审计读取不泄露付款凭据。

## APF-13b（24 个新增固定操作）

本节取代上文 13b 待办：新增付款申请 7 个操作、五组分类各 3 个操作及两种只读查询，不增加固定系统操作或 grant。

| Host BFF | Runtime 固定操作 | 人员门槛 |
| --- | --- | --- |
| `/finance/api/v1/payment-requests` | `payment-requests:{page,detail,create,update,cancel,submit,confirm}` | expenses:view / edit；confirm 单独要求 expenses:confirm |
| `/finance/api/v1/settings/expense-types` | `expense-types:{page,create,update}` | settings:admin，tenant:global |
| `/finance/api/v1/settings/income-types` | `income-types:{page,create,update}` | 同上 |
| `/finance/api/v1/settings/subjects` | `subjects:{page,create,update}` | 同上 |
| `/finance/api/v1/settings/subject-mappings` | `subject-mappings:{page,create,update}` | 同上 |
| `/finance/api/v1/accounting-objects` | `accounting-objects:{page,create,update}` | 同上 |
| `/finance/api/v1/integrations/approval-instances` | `approval-instances:page` | 同上，只读 |
| `/finance/api/v1/audit-logs` | `audit-logs:page` | 同上，只读 |

配置根 GET/POST 为 page/create，PATCH /:code 为 update，subject-mappings 用数值 ID 作为 URL :code（该表无 code 列）；不得传表名。分页仍是 data/total/page/pageSize。配置 page 可用 code 精确过滤以读取编辑快照，不增加泛化详情路由；普通列表 search 按编码筛选，映射按 ID。停用只用 status=inactive + 当前 expectedVersion 的 update，没有删除或批量管理入口。复杂配置创建/编辑独立页面；原型字段外不接受浏览器 source_app、owner、actor。核算对象本批只维护手工编码、名称、类型、状态与备注，不伪造其他域的来源事实。

付款申请 draft 字段：title、paymentType(supplier/customer_refund/loan/expense/other)、payeeName、requestedAmount（正 DECIMAL18,2 字符串）、currencyCode；可选 plannedPayDate、bankAccountId、projectCode、contractCode、customerCode、remark。没有 items 数组，不暴露或接收账户密文/凭据字段。状态、actor、经办人、审批事实、已付金额与生成台账 ID 只能由 owning Runtime 写。没有真实银行付款调用。

付款沿同一冻结请求/创建/绑定/恢复协议，新增且仅新增完整元组 **finance/expenses/payment**，两条旧相对路径均精确兼容，SourceApp=finance 不变。审批只写 approved/rejected 及 approved_amount=requested_amount；显式 confirm 才把申请置 paid、写 paid_amount 并原子生成唯一 confirmed 台账。确认 actor 与落库制单/申请/经办人分离，不能用 admin 替代 confirm。原键重试、旧版本冲突、来源唯一约束和注册表代次栅栏保留。

配置 caller-Tx 锁序：Finance 注册表代次栅栏 → finance_expense_type / finance_income_type / finance_subject 按表名、ID 顺序锁定小型配置集合 → 引用复核与目标配置行 → owning 回执 → 审计。与支出写入的引用锁顺序一致；科目层级在锁定快照上检查循环。配置信息量小，序列化写入以保持图和映射稳定；读取使用 snapshot transaction。配置回执和审计写入同事务，失败全部回滚；重复同键回放不重复写入。

审计读取只返回 id/entity_type/entity_code/action/operator_uid/channel/created_at，不返回 old_value/new_value、请求键、命令或敏感快照。审批关联从 owning 四类申请读取真实 workflow_instance_id 与状态，不把冻结快照当成外部审批成功事实，未绑定申请不会出现虚假实例。

`finance_13b.json` / ForFinance13b 是 B1+B3+13a 上追加 finance_payment_request 单表的严格候选；配套 schema、verify/rollback、payment Workflow seed/verify 仅交付不执行。付款及四类审批关联要求该映射已安装；旧映射失败关闭为 503。没有改本机库、环境或授权。
