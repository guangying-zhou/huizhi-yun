# Enterprise Altoc WP4b 报价合同（候选，未部署）

六个新增固定 U 操作全部使用 `altoc:enterprise-host:execute`。不增加 capability、grant 或 schema。APF12 候选已接正式 Workflow：Host transition `submit` 冻结当前版本，创建并绑定实例，页面允许草稿/退回报价提交；approve/reject 不属于可接受的客户端命令。本批不借用旧独立端审批身份或权限。

| Host 路径 | 方法 | Runtime 固定操作 | 人员许可 |
| --- | --- | --- | --- |
| `/altoc/api/v1/quotes` | POST | quotations:create | quotation:edit |
| `/altoc/api/v1/quotes/:quotationId` | PATCH | quotations:update | quotation:edit |
| `/altoc/api/v1/quotes/:quotationId/items` | PATCH | quotation-items:replace | quotation:edit |
| `/altoc/api/v1/quotes/:quotationId/versions` | GET | quotation-versions:list | quotation:view |
| `/altoc/api/v1/quotes/:quotationId/versions/:version` | GET | quotation-versions:view | quotation:view |
| `/altoc/api/v1/quotes/:quotationId/transition` | POST | quotations:transition | quotation:edit |

Runtime 路径均前缀 `/v1/enterprise/altoc/`。既有 quotation-list/view GET 路径不变，新 APF 读取改用统一库表与相同范围模型。COUNT 和分页在范围 WHERE 后，详情/明细同快照，无成本或毛利字段。版本列表按服务端 page/pageSize（≤100）返回 data/total/page/pageSize。

## 请求与安全边界

- create：customerId 正整数，currency_code 三位大写；quotation_no≤50、valid_until ISO 日期、remark≤500，可为 null。负责人固定为签名 actor，部门取当前有权访问客户的权威部门。客户与目标报价范围都须满足。
- update：expectedVersion + quotation_no/valid_until/remark，至少一个字段；客户、负责人、金额、状态等不得通过 PATCH 变更。
- items-replace：expectedVersion + items（1–1000）。每行只接受 item_name、specification、unit、quantity、unit_price、discount_rate、tax_rate。明细全量替换，不接受成本、毛利或客户端计算金额。
- 金额用十进制字符串：数量 DECIMAL(18,4)、含税单价 DECIMAL(18,2)、折扣/税率 DECIMAL(5,2)，百分数 0–100，数量>0。逐行含税金额=数量×含税单价×(100−折扣)/100，四舍五入至两位；不含税金额=本行已舍入含税金额/(1+税率/100)，同样舍入；表头合计为各行舍入结果之和。不使用 JS/Go 二进制浮点做金额计算，不开放表头折扣/税率编辑。
- transition：expectedVersion + action；submit 由 Host 编排 quotation-approval:request/bind；send 仅 approved→sent，冻结不可变 snapshot；accept 仅 sent→accepted。draft/rejected 才能修改表头与明细。批准/退回仅由正式 Workflow 受信服务端结果回写。
- 每个写入带稳定 Idempotency-Key。HMAC 绑定完整 quotation 意图、actor/tenant/deployment、resource/action、policy revision/hash、TTL≤15s 和 scope；列表/详情使用既有新鲜 permit。用现有唯一 scoped evaluator/Altoc 范围投影，不新增授权规则。
- Runtime 锁当前报价与权威 owner/dept，在读取旧回执之前复核 scope；create 先锁客户。row_version CAS、明细、合计、审计、既有 Altoc service_command_receipt 同事务；一行失败整批回滚。回执保存不可变响应摘要并通过审计快照恢复原响应，同键改变意图409；撤权后的旧键拒绝。
- send 在已锁报价上分配版本并冻结快照，后续编辑/accept 不改旧版本。版本读取仍需当前报价可见，不因持有旧版本号绕过撤权。

## UI 与验证

原 `/altoc/quotes` 列表/详情路径各只有一套 Host 页面：服务端搜索/分页/共N条、新建/表头编辑、全量明细编辑、版本历史、状态受限发送/接受、正式审批提交。useConfirm warning 确认冻结操作；稳定意图键用于响应不确定后的原请求重试。读响应 private,no-store，身份范围切换清空旧对象与版本。

400 参数/未知字段/非十进制/缺键；403 permit/范围/撤权；404 不存在或详情不可见；409 状态冻结、版本/意图/并发冲突、审批轮次冲突；依赖故障503。测试覆盖 TS→Go共同canonical、角色字段/金额篡改、未授权/依赖失败不调用领域、并发CAS单胜者、两行中途溢出整事务回滚、同键不重复、撤权旧键拒绝与版本不变。隔离 MySQL 用独立临时库，t.Cleanup 删除整个夹具库。

候选尚未上线；未作真实浏览器/现有环境写入。需在获批窗口核验三条精确通道、安装人工审批规则后验收；客户审批仍未实现。

## APF12 审批冻结与回调

新增精确 U 操作为 `quotation-approval:request/bind`，均保留 quotation:edit、当前对象 scope、Idempotency-Key 和 expectedVersion。Host 不接受 approve/reject。冻结、pending_approval、integration_operation、audit 与 receipt 同事务；失败保留原键并由既有 APF signed wake 恢复，单次最多每业务20条。Workflow 创建按冻结 requestNo 回放同一实例，不覆盖退回轮次。bind 经只读适配器核对实例ID/号、业务对象、发起人、app/resource/action、冻结表单与固定回调路径；无适配器503。

回调闭集仅 altoc/quotation/approve 与 altoc/contract/approve，固定 /api/v1/service/workflow/callback；来源 workflow.runtime 经 Enterprise 认证后转 owning Runtime altoc:scheduler:execute 系统通道。Runtime 重新读 Workflow 终态与非自审批证据，版本栅栏、业务状态、结果审计/receipt 同事务；同键回放、冲突409，旧轮不改新轮。无需 schema/capability/grant 新增；候选流程/核验见 docs/sql/APF12-*，未执行。
