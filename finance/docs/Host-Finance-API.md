# Enterprise Host Finance WP3 合同（候选，未部署）

依据 M1、APF 设计首批 schema、sol2 950f5f1e `hostFinanceClient.ts` / `hostFinance.ts`。独立 Finance 的 legacy API 不变。Nuxt/BFF 无 DB 凭据，所有事实由 Runtime 固定 U 操作处理。

## 路由和人员门槛

| Host 路径 | 方法 | 固定 Runtime 路径（统一前缀 `/v1/enterprise/finance/`） | 人员权限 |
|---|---|---|---|
| `/finance/api/v1/bank-accounts` | GET | bank-accounts:page | bank_accounts:view |
| 同上 | POST | bank-accounts:create | bank_accounts:admin |
| `/finance/api/v1/bank-accounts/:code` | GET | bank-accounts:detail | bank_accounts:view |
| 同上 | PATCH | bank-accounts:update | bank_accounts:admin |
| `/finance/api/v1/bank-accounts/balances` | GET | balance-snapshots:list | bank_accounts:view |
| `/finance/api/v1/settings/people-cost-parameters` | GET | people-cost-parameters:list | settings:admin |
| 同上 | POST | people-cost-parameters:create | settings:admin |
| `/finance/api/v1/settings/people-cost-parameters/:code` | GET | people-cost-parameters:view | settings:admin |
| 同上 | PATCH | people-cost-parameters:update | settings:admin |
| `/finance/api/v1/settings/people-cost-parameters/:code/history` | GET | people-cost-parameters:history | settings:admin |

十个操作共用 `finance:enterprise-host:execute`，没有新 capability/grant。服务 JWT + 已验签 actor + fresh scoped permit 独立校验。permit ≤15 秒，绑定 actor/tenant/deployment、resource/action、operation/code、policy version/hash/revision、完整字段和查询；共享 TS/Go fixture 包含中文、null、版本号。只接受现有 Foundation evaluator 在无对象事实时可授权的许可，不把对象约束展平为全局，延续 M1 的静态设置/账户门槛。

**与前端按钮差异**：Finance manifest 无 `people_cost_parameters` 资源；既有 `financePermissionRoutes.ts` 对 settings/** 要求 admin。本批不降低门槛为 view/edit；账户写入沿用 bank_accounts:admin。sol2 前端草案 view/edit 按钮条件需整合负责人按此合同对齐（未修改其 worktree）。

## 请求、响应

GET 列表：page≥1、pageSize≤100，search、status（active/inactive，账户另含 closed）。COUNT 与分页同一 RR snapshot，不在 BFF 截断。余额另支持 accountCode/startDate/endDate（严格 YYYY-MM-DD、闭区间），search 匹配账户名/编码，status 不适用。history 仅分页，不支持 search/status。

列表 `{data: T[], total, page, pageSize}`，详情与写入 `{data: T}`；Host 去除 Runtime 内部封套。响应字段完全对应前端 typed snake_case，id/row_version 为安全整数，DECIMAL 始终字符串。账户不返回 account_no_secret_ref、明文账号、内部身份或审计载荷；参数返回完整白名单快照。

账户 POST：accountName、bankName/null、accountNoMasked/null、accountType（bank/cash/third_party/internal）、currencyCode（三位大写）、ownerDeptCode/null；可选 accountNoSecretRef（仅引用，不是明文，不在此接口读取/签发凭据）。code 服务端生成 BA-UUID 摘要，初始 active/version1。不得由浏览器提供 code/status/actor/tenant 等事实。masked 字段拒绝连续八位以上数字，secret reference 不得含 URL 查询/控制字符/路径穿越。

账户 PATCH：上述可编辑字段任意子集、可选 status（active/inactive/closed），必带 expectedVersion，至少一个真实修改字段；code 不可改。status 只改变账户元数据，不改变既有余额事实或发起银行副作用。

参数 POST/PATCH：name、effectiveFrom、effectiveTo/null、baseSalary、welfareCostRate、managementAllocationRate、resourceAllocationCost、currencyCode、status、remark/null。PATCH 是完整版本替换，另带 expectedVersion。PCP-UUID 编码自动生成。金额 DECIMAL(18,2)，系数 DECIMAL(10,4)；只接受非负普通定点字符串，拒绝数字/科学计数/超精度。终止日期不得早于起始日期；同一时点只允许一个 active 参数，闭区间端点相同也算重叠，不按 currency 放宽。

POST/PATCH 必带 Idempotency-Key（1–100 字符的字母数字 `._:-`）；不自动重发。intent 含 expectedVersion，变意图换键。参数 history 来自同一写事务产生的完整版本快照（finance_audit_log，entity_type=people_cost_parameter/action=version），按审计 id 倒序分页，不混入其它审计操作，不声称迁移旧记录已有历史。无新 DDL。

## 事务、错误与恢复

Registry generation SHARE 栅栏→参数写获取 Registry 行排他锁（保证空表也串行）/账户行锁→当前对象核对→receipt→条件业务写→版本审计→commit。无网络 IO。参数锁升级可能使一方死锁，返回固定409而非泄露 DB 错误；同键原意图可手动重试。对象当前不存在/已删除不回放旧 receipt。replay 返回原版本快照，不返回后来已修改的当前版本；scope/actor 在每次请求 fresh 求值，撤权旧键不能绕过。

400 输入/缺键；401 未认证；403 权限/通道/permit 失败；404 精确对象不存在；409 版本冲突、区间重叠、同键变意图、并发写冲突；真实 Registry/Console/DB 依赖故障503。固定错误文本，无原始SQL或凭据。

## 未执行的环境步骤

新 schema/Registry write 模式/实际 finance 域 grant/Host 路由发布均需另批。本批只交付代码和隔离证据；没有真实签发、部署、浏览器联调或历史数据导入。


## APF-11a：开票、到账、核销候选（未安装、未部署）

本批固定 **23** 个 U 操作，复用 `finance:enterprise-host:execute`；不增加 capability/grant。以下 REST 路径均以 `/finance/api/v1` 为前缀，Runtime 以 `/v1/enterprise/finance` 为前缀（冒号为固定动作分隔符）。不存在正式发票手工创建或审批 submit/callback 路由。

| REST 方法 / 路径 | 固定 Runtime 操作 | 人员门槛 |
|---|---|---|
| GET /invoice-requests | invoice-requests:page | invoices:view |
| GET /invoice-requests/:code | invoice-requests:detail | invoices:view |
| POST /invoice-requests | invoice-requests:create | invoices:edit |
| PATCH /invoice-requests/:code | invoice-requests:update | invoices:edit |
| POST /invoice-requests/:code/assign-issuance | invoice-requests:assign-issuance | invoices:issue |
| POST /invoice-requests/:code/issue | invoice-requests:issue | invoices:issue |
| GET /invoices | invoices:page | invoices:view |
| GET /invoices/:code | invoices:detail | invoices:view |
| PATCH /invoices/:code | invoices:update | invoices:edit |
| DELETE /invoices/:code | invoices:void | invoices:edit |
| POST /invoices/:code/red-reverse | invoices:red-reverse | invoices:edit |
| GET /receipts | receipts:page | receipts:view |
| GET /receipts/:code | receipts:detail | receipts:view |
| POST /receipts | receipts:create | receipts:confirm |
| PATCH /receipts/:code | receipts:update | receipts:confirm |
| POST /receipts/:code/confirm | receipts:confirm | receipts:confirm |
| POST /receipts/:code/classify | receipts:classify | receipts:edit |
| DELETE /receipts/:code | receipts:delete | receipts:edit |
| GET /reconciliation | reconciliation:page | reconciliation:view |
| POST /reconciliation | reconciliation:create | reconciliation:confirm |
| POST /reconciliation/:code/void | reconciliation:void | reconciliation:confirm |
| POST /invoices/files | invoice-files:attach | 已批准待开票申请：invoices:issue + 当前开票责任人；其他附件：invoices:edit（均另核对父对象 view） |
| GET /invoices/files/view?code= | invoice-files:read | invoices:view |

页列表统一 `page/pageSize/search/status`（pageSize≤100），返回 `{data, total, page, pageSize}`；详情/写入返回 `{data}`，小数保持字符串。`all`/当前责任人 `self` 由新鲜 Console scoped grants 编译，其他范围失败关闭；当前责任关系在 Runtime 每次重核，回放旧键也不能跳过。申请草稿/退回状态还允许申请人在获权 self 范围内查看。B3 未安装返回 `503 finance_b3_unavailable`，不将缺表伪装成空列表。

所有写入要求 Idempotency-Key；已有对象写入要求 expectedVersion。核销另带 receiptVersion，目标为发票时带 invoiceVersion，含结算计划时带 scheduleVersion。到账详情按其已获权合同返回最多 100 个只读 billing_candidates（code/currency_code/amount/received_amount/row_version），不新增 Altoc 浏览权限。客户端仅在用户明确采用刷新比较结果后更换版本和意图；响应不确定时保留原 payload、原版本和原键。

开票申请保持 draft，当前不开放 submit。正式开票只能由 approved 申请产生，申请人≠开票人；开票附件从拥有的申请附件元数据回读，浏览器不能覆盖其 MIME/大小/文件名；正式发票详情包含来源申请附件。资料编码存在时冻结同客户的有效 Altoc 开票资料字段。作废/红冲前须无有效核销；红冲新增关联原票的红字记录，不能只改变原票状态。到账创建要求核销责任人及截止时间，默认 draft，显式 confirm 后才可核销；确认人≠核销人（撤销核销也重核）。金额全部定点字符串，核销同时检查到账、发票及结算计划余额与币种/客户/合同关系。

按 Domain Design §9 的全局锁序持有 Registry 与对象锁，锁定/创建 finance_contract_summary 后锁次要业务行，最后 receipt；两域共用 caller-Tx，Finance 聚合通过 Altoc 的固定 typed owning port 回写，失败整笔回滚。B3 子集 manifest 和 install/verify/rollback 候选见 `finance/docs/sql/APF11a-B3-*`、`domaininstall.ForFinanceB3`；不执行环境。project summary 属 B4，本批不安装/写入。审批元组与两个旧 callback 路径留待 11b。

## APF-11b：开票审批及 Altoc 来源

新增 6 个固定 Runtime 操作：`invoice-approval:request/bind/callback/pending/bind-system` 与 `invoice-requests:from-altoc`，没有新增 capability/grant。Host `POST /finance/api/v1/invoice-requests/:code/submit` 接收 `expectedVersion` 和 `Idempotency-Key`；恢复可加 `recover: true`（见文末恢复合同）；冻结、正式 Workflow 创建与绑定按同键续行，失败保留冻结申请，由现有 signed APF scheduler 恢复。申请人以 `invoices:edit` 且当前 `requested_by` 关系提交，审批人由 Workflow 当前任务、非申请人及任务权限复核。`self` 申请人可只读跟踪自己的申请各状态，不扩大其它对象或写责任。

仅映射 `finance/invoices/request`。实例保留 `/api/v1/finance/workflow/callback` 或 `/finance/api/v1/finance/workflow/callback`；发送物理路径映射到 Enterprise `/api/v1/service/workflow/callback`，相应 audience/capability 一起映射。其余 `finance/expenses/{claim,project_expense,payment}` 保持原 Finance 目标，未登记组合失败关闭。专用 Finance→Workflow 入口仍要求 `SourceApp=finance`；Host 正式链沿 `workflow:proxy`，不放宽该专用入口。

Altoc `POST /altoc/api/v1/contracts/:contractId/billing-schedules/:scheduleCode/invoice-request` 接收 `expectedVersion`、`scheduleVersion`、`requestedAmount`、`invoiceItem` 与可选 `invoiceProfileCode`，要求 Finance `invoices:edit` **且** Altoc `contract:edit` 的分别新鲜范围。客户、币种和来源取锁定对象快照。锁序沿 11a，副授权绑定在完整签名 payload 中，但其刷新时间不计入业务回执摘要，同键重试不会因续签变成不同意图。

回调只从受信 Workflow 通道接收，再以进程内 typed reader 核对八项冻结身份和终态操作证据；不接受浏览器批准事实。批准只推进申请，正式开票仍是独立 `invoices:issue`，保留 D-01 申请人≠开票人。人工正式发票创建仍不开放。流程定义 seed/verify 位于 `finance/docs/sql/apf11b-workflow-*-candidate.sql`，仅交付，未执行；上线前须审核真实人工审核人及已有路由，不能采用自动通过或空审核人。

## APF-14c 项目成本（本地候选）

Host 公开页面：`/finance/project-accounting`、`/finance/project-accounting/:projectCode`、`/finance/project-cost-allocations[/:code]`、`/finance/employee-costs[/:code]`。按月，列表服务端分页，项目核算以 Aims 项目集为源左连接当月 Finance 摘要；先范围过滤再计数，未计算项目保留入口且状态为缺少输入，不伪造零成本。

所有 API 位于 `/finance/api/v1`，必须 `periodMonth=YYYY-MM`。列表接受 `page/pageSize/search`（pageSize≤100）；分摊/员工列表可加 projectCode，分摊详情必须 projectCode。员工详情可不传 projectCode，但仍在签名项目范围内核对分摊成员关系及当前 People 范围。

| 路径 | 方法 | 固定 Runtime 操作 | 人员权限 |
| --- | --- | --- | --- |
| `/project-accounting` | GET | project-accounting-page | project_accounting:view |
| `/project-accounting/:projectCode` | GET | project-accounting-view | project_accounting:view |
| 同上 `/preview` | GET | project-labor-preview | project_accounting:admin |
| 同上 `/recalculate` | POST | project-labor-recalculate | project_accounting:admin |
| 同上 `/history` | GET | project-labor-history-page | project_accounting:view |
| 同上 `/history/:code` | GET | project-labor-history-view | project_accounting:view |
| 同上 `/period` | GET | project-cost-period-view | project_accounting:view |
| 同上 `/confirm-zero` | POST | project-cost-period-confirm-zero | project_accounting:admin |
| 同上 `/close` | POST | project-cost-period-close | project_accounting:admin |
| `/project-cost-allocations` | GET | project-cost-allocations-page | project_accounting:view |
| `/project-cost-allocations/:code` | GET | project-cost-allocations-view | project_accounting:view |
| `/employee-costs` | GET | employee-costs-page | project_accounting:admin + People standard_costs:view |
| `/employee-costs/:code` | GET | employee-costs-view | 同上，双重当前范围 |

写请求只接受 `{expectedVersion,expectedInputHash}`，必须 Idempotency-Key；BFF 编译范围、actor/tenant/deployment/政策版本，浏览器不能提交这些字段。Finance 与 People 版本/策略不一致返回 503；公开汇总不加载或依赖工资权限。Host 仅返回项目汇总/分摊总额及获双重权限后的员工月标准成本，不返回工资组成、职级依据、source_refs/input_snapshot/calendar_snapshot JSON。历史比较读已冻结批次的公开金额/版本/输入哈希，不重算历史。

409 保留项目/月、原 CAS 请求及历史选择，自动刷新最新预览和历史；只有明确“采用最新预览”并再次确认才换意图/幂等键。响应丢失或 5xx 重试同一冻结请求，不把新预览自动塞入旧请求。确认重算说明完整替换托管集合；确认零投入绑定空集合；关期说明不可直接重开。缺少输入允许记 not_ready 批次（毛利为 NULL），关期仍由 owning Runtime 要求 ready 当前批次。

公开托管人力分摊只展示项目/月/规则的合计，使用 CL- 聚合编号，不返回个人工时依据值，也不接受 CA- 个人托管行编号作为公开详情。非托管来源保留原记录。这一投影在 Runtime GROUP BY 后再范围过滤/COUNT/LIMIT，不在 BFF 对单页做 reduce，不能遗漏后续页。

### APF-18B1 机器到期通知候选

固定六条 S 路径 `/v1/enterprise/finance/{issuance-due|reconciliation-due}:{scan-due|published|closure-ack}`：只验签 enterprise.runtime 的 `finance:scheduler:execute` 与部署/generation/实时 grant，无人员 actor，不自动开票或核销。scan `{}`；published `{eventKey,notificationId,recipientUid}`；closure-ack `{eventKey,state}`，状态仅 resolved/cancelled。P 沿现有签名 viewer 路径 `/v1/finance/notification-details/authorize` 接受固定 `{eventKey}`，当前责任人和事实再次核对，不返回金额或无权数量。安装规格 finance_enterprise_due_schema.sql；默认关闭、唯一 owner 与未知回执见 MODULE_CONTRACTS APF-18B1。

## 审批提交恢复（验收修复）

四类申请既有 POST `/:code/submit` 可传 `{ expectedVersion: 当前行版本, recover: true }`。人员权限和范围与原提交一致，仅原申请人可恢复；Runtime 在原锁序和代次栅栏中核验当前版本、pending_approval、尚未绑定实例，再读取该行最新冻结审计。冻结请求必须匹配申请人、类型、编码和冻结后版本，浏览器不得提供原键、requestNo、实例或审批事实。BFF 仅用返回的原冻结 key/expectedVersion/requestNo 创建和绑定；Workflow 按原 requestNo 幂等，刷新后恢复不创建第二个实例。恢复探测不写新冻结记录，绑定成功后仍由受信回调推进审批结果。未增加固定操作或权限。

#### APF-18B2 死信通知候选

固定 S POST `/v1/enterprise/finance/{pending-dead-letter-actionables|dead-letter-actionable-published|pending-dead-letter-closures|dead-letter-closure-acknowledged}`，enterprise.runtime + finance:scheduler:execute + Registry scheduler generation。复用共享账本/原 generation，无新增 schema/用户操作。新投递源 enterprise，不冒充 finance；只站内，详情当前 integration_operations:view + 冻结收件人。`HZY_ENTERPRISE_FINANCE_DEAD_LETTER_NOTIFICATIONS_ENABLED` 默认关闭；旧通知 task/请求内调用与在途需先收口，环境和 grant 均未执行。

### 开票附件办理动作（验收修复）

上传到已批准、待开票申请时，Host 从当前父对象判定办理开票，固定操作仍为 invoice-files-attach，签名 Finance payload 带 attachmentPurpose=issuance。Runtime 将此精确动作绑定 invoices:issue，并在原锁序内锁定申请，重验 approved、issuance_responsible_uid 与受信 actor 相同且 requested_by 不同。该字段只是闭集业务动作，不接受 trusted 标志，不替代策略权限或责任关系；edit/admin 签名不能代替 issue。已批准申请不允许省略办理动作退回 edit。其他申请状态及正式发票附件仍要求 edit，不允许 issuance 用于正式发票。目的参与原键摘要，改目的或对象不得用原键改变意图；没有新增操作、capability 或 grant。

Host 表单在任何上传/确认前校验必填附件与金额、日期、责任人、截止时间，并保留草稿。客户/合同选择器读取 Altoc 原用户 API，银行账户读取 Finance 原分页 API，所有读取仍由 owning BFF 授权，不借用 Finance 权限放宽 Altoc 读取。结算计划按合同分页，接口没有 search 字段，页面明确只搜索当前页。

## W3 第6批：只读扩展

复用既有 `customer:view`、`contract:view`、`bank_accounts:view`、`migration_exceptions:view` 与固定读取操作，不新增 capability/grant/schema。列表、详情分别由服务端授权；来源信息在所属对象通过范围检查后，以 Registry 快照事务读取迁移台账。仅返回 `system/table/pk/batchCode/importedAt`，不返回源 JSON。

- 客户 list/detail 返回 `customer_level_id`（NULL 保持）及已有字典 `customer_level_name`；不与信用等级混用。联系人来源随受控客户详情返回；账户来源仅在账户详情返回。
- `GET /altoc/api/v1/contracts?parentContractId=<id>&page=&pageSize=`：仅当前合同范围内的直接下级合同；W1 列未装时为空，不恢复宽读取。
- 同一合同 list 的 `customerIds=2,3`（最多100个不同正整数，无 customerId/includeDescendants）返回 `customerSummaries`：一次批量分组，各客户的可见销售合同（排除 terminated）count/amounts，按币种分开；只用合同范围，不查询客户名称或存在性，不返回不可见计数。无可见合同与客户不存在都返回零。
- 账户 list 的 `legalEntityCode/accountType` 服务端筛选；`complete=true` 仅 page=1，整个筛选结果≤200才完整返回，响应 `complete=true`；超过200则 `complete=false`、按传入 pageSize（≤100）分页。响应 pageSize 保持请求值，完整模式仅作为有界展示例外；合计仍覆盖整个筛选结果。W1 主体列未装，主体筛选返回空。
- 余额 list 的 `legalEntityCode` 经账户关联筛选，total 与返回记录采用同一条件；同账户同日人工快照优先于导入。
- Finance exceptions 读增加 `exceptionId`，仅 kind=balance_without_account，不接受 status/search；沿用既有签名泛型 ID 和 page/pageSize。详情返回分页白名单流水（sourceEntryId/balanceDate/amount/recordedAt/recordedByName），固定源表与事项冻结快照，匹配原 sourceEntryIds、日期和 ba_id=0；其它批次/日期/关联账户记录不可混入。Ledger 未装仍503。

新增 Altoc/Finance query 在 Go/TS canonical 中仅有值时追加，旧请求字节保持不变，共享金向量覆盖参数删改。exceptionId 使用原有签名 ID 槽位，不改变旧许可格式。

## 历史财务接续列表与详情

- `GET /finance/api/v1/historical-finance?page=1&pageSize=20&search=&status=`：精确 Runtime 操作 `historical-finance-page`，复用 `historical_finance:view`。`status` 可省略，或为 `pending`（待核验）、`active`（已激活）。按调用者 Finance 范围检查后，在同一快照读取 opening 映射、合同、封存快照日与接续状态；返回 `{data:{items,total,page,pageSize}}`。列表不宣称证据已核验，激活前仍须详情验封。
- `/finance/historical-finance/:code` 为独立详情页。概览与只读保全明细分别加载；任一读取失败不冒充保存结果未确认。切换合同清空旧概览与明细，拒绝旧请求覆盖新选择。
- 迁移 `primary` 映射定位保全明细；旧 OA 明细始终不参与净期初余额计算。Runtime 对期初封存行的时间列使用 MySQL 文本读取，保持原封存字节，不降低验封标准。

本批不新增 schema、manifest 动作或 grant；部署需同步 Runtime、Foundation 精确路径与 Host 路由。
