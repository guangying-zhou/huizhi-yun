# PC-17 客户反馈进入产品需求池：实施契约

状态：需求提交与决策回流主体已实现，尚未完成部署验收。本文细化产品中心计划 PC-17；历史章节中的“拟新增／尚未”描述须结合下方当前状态及实施记录阅读。启用依赖 PC-12 验收及本契约对应测试通过。

## 1. 首条业务流程与事实源

首条来源选择 Altoc `service_ticket.ticket_type=requirement`。工单已有 `code/product_code/title/description/priority`。具备该工单提交权限的用户发起“提交产品需求”，服务端锁定工单并取得产品、标题和说明，生成 caller-owned operation。AIMS 接收为产品需求及来源证据，产品经理随后沿用现有评估、合并、功能关联和优先级流程。

Altoc 保留客户、联系人、SLA、工单状态和原反馈内容事实源。AIMS 不复制联系方式、合同金额或客户主档。工单 priority 只表示客户服务紧急度，不映射为 RICE 分数、产品决策顺位或版本承诺。无 product_code 时先补全工单产品绑定，禁止客户端临时选择其他产品替换来源事实。

## 2. 提交命令

拟新增 Altoc 用户入口：`POST /api/v1/service-tickets/{ticketCode}/product-request`，body 仅接收 expectedSourceSha256，由已授权读取的工单产品、类型、编号、标题和说明计算。首次提交在工单行锁内重算并比较；不一致返回 409，用户刷新后重新确认。已有提交先返回冻结绑定，不因后续工单编辑产生第二条需求。客户端不能提供 source app、目标 UUID、客户身份、评分或已验证标记。

目标服务：`POST /api/v1/service/product-requests/from-feedback`，固定 capability `aims:product-request:create-from-feedback`，来源 altoc，目标 aims。使用 Foundation 标准签名 service-command envelope；operation code 为 `altoc.aims.product-request.create-from-feedback.v1`，短 schema 为 `product-feedback-create.v1`。

冻结 command 字段：`actorUid/productCode/ticketCode/requestBizId/title/description/action`，action 固定 create。requestBizId 由 Altoc 首次提交时生成并持久化；重试不可重生。actorUid 是原提交人。标题最多 200 字，说明最多 10000 字，不含联系方式字段；字符及 UUID 校验按现有产品输入规则执行。源工单文本只作数据，不可解释为服务指令。

operation 与源侧提交绑定必须同事务。幂等身份采用 tenant/source deployment/target deployment/source app/target app/operation code/idempotency key 既有约定。每个工单的首次产品需求提交只有一个稳定提交 ID；键使用提交 ID，不直接按会变化的标题散列。重复点击先返回已有绑定；编辑原工单不覆盖已冻结请求。后续证据更新另设 revision 命令，不复用创建键传入新内容。

## 3. 授权与目标事务

Altoc 提交前校验当前用户的工单动作和对象范围。AIMS Service API 校验 Console JWT、精确 capability、来源／目标 app、租户、部署和 Foundation 签名，随后检查原操作者当前对目标产品的 product_requests:create 范围。服务 grant 不代替用户产品权限。权限变更、归档产品、未开通产品工作空间均拒绝，不能自动授予产品角色或创建空间。

AIMS 事务依次锁定产品工作空间、检查自然来源绑定、创建 product_requests、写入 product_request_sources、来源绑定、产品修订和脱敏活动日志，最后保存 target receipt。任何失败整体回滚。

拟新增独立来源绑定表，唯一约束为 `(source_app,source_type,source_biz_id)`，保存 product_code 和 request biz ID；本应用数据库已按租户隔离。source_app 固定 altoc、source_type 固定 service_ticket、source_biz_id 为稳定工单 code。另一产品试图接收同一来源时返回绑定冲突。采用独立表以避免改变允许重复手工说明的现有来源表行为。

已签名且授权通过的来源可标 verified；该标记仅证明来源经过服务验证，不证明客户主张或价值评估正确。手工 source-create 继续不能设置正式来源或 verified。

receipt targetBizType 为 product_request，targetBizCode 为冻结 requestBizId。同身份同 hash 返回原 receipt；异 hash 冲突。Altoc 校验完整回执后保存关联。ACK 丢失沿用原 operation 恢复。不同产品、相同来源且不同 request ID 不允许静默生成第二需求。

## 4. 后续状态回执

AIMS 需求 accepted/rejected/merged 等决策以及功能／版本进度通过独立 caller operation 回传 Altoc 的产品需求关联视图，不直接把服务工单设为 resolved/closed。拟新增 `altoc:product-feedback:update-status`，采用单调 source revision；旧代际不覆盖新状态，重复同代际不产生新通知。

需求合并保留原来源绑定，回执带原 requestBizId 及 canonical requestBizId，禁止删除原客户反馈证据。路线图计划日期和实际发布日期分列；发布不等于客户环境已部署。对客户的通知另需现有通知资格校验，不在收到服务回执时无条件发送。

## 5. 代码落地顺序

1. 核对 Altoc 工单并发／范围授权及现有 operation 插入方式，补源侧持久化提交绑定和迁移。
2. AIMS 增加来源自然键绑定迁移及内部接收事务，保持手工来源兼容；用隔离 MySQL 验证原子性和重复提交。
3. 两应用 manifest 登记精确服务能力，加入精确客户端、双 runtime audience 的 seed/verify；不加入普通用户角色。
4. 目标 AIMS 服务入口与签名校验、自身 Runtime 调用；源 Altoc 冻结命令、派发器、受控恢复与 receipt checkpoint。
5. Altoc 提交／进度页面与 AIMS 来源展示，分别执行当前对象范围检查；标题链接仅在可访问时显示。
6. 状态回执、合并引用、通知资格与增量代际测试；完成真实租户 JWT／跨部署调用验收后启用。

## 6. 验收证据

必须覆盖：无产品授权拒绝；源工单产品无法被浏览器替换；重复提交仅一个需求及一条正式来源；同源跨产品冲突；目标事务中途失败无残留；ACK 丢失恢复原回执；原用户撤权后重试拒绝；手工来源不能伪造 verified；重复反馈不增加评分；合并保留来源；旧状态回执不覆盖新代际；产品发布不关闭工单；真实 client、凭证及双 audience grant 核验。模拟测试与真实部署证据分别记录。

## 7. 已核对的接入事实（2026-09-08）

Altoc 既有 `freezeServiceTicketAimsWorkItem` 先执行 service_ticket:edit，再通过 FOR UPDATE 锁定工单及可信客户关联，并执行 altocRequireRecordWrite。PC17 可复用此授权／锁定模式；不能假设工单已有整数 revision（既有 operation 的 version_no 不等于工单修订）。新增提交入口的并发令牌仍需与源侧提交投影设计一并落实。AIMS 已实现严格七字段冻结命令解析及输入测试，尚未暴露接收服务或执行数据库写入。

## 8. 内部 Runtime 接收入口（2026-09-08）

已登记 `POST /v1/aims/internal/product-requests:from-feedback`，body 为标准 serviceCommand 与 AIMS BFF 生成的 authorization permit；仅经过 Runtime 签名上下文和 service-command 委托的 AIMS 自身调用可使用。精确 capability 为 aims:product-request:create-from-feedback，manifest 已声明但未加入普通用户角色。回传标准完整 receipt 身份、目标和 result。外部 Altoc→AIMS Service API 与 Console grant 安装仍待实现；不能直接从浏览器提交 authorization 或 reserved context。

## 9. 原操作者授权事实查询（2026-09-08）

新增内部 `POST /v1/aims/internal/product-requests:feedback-authorization`，与接收接口使用同一签名 command 和精确反馈 capability。只解析已验证 command 的 productCode/actorUid，返回该产品与用户的现时授权事实，用于 AIMS BFF 调用 Foundation scoped authorization。该响应本身不是 permit 或权限授予。普通 authorization-object 仍维持原浏览器委托用途限制，不为服务调用放宽。服务 BFF 不得通过 requireAimsSessionUid 选择服务账户或当前浏览器用户替换原 actor。

## 10. Altoc 来源并发校验（2026-09-08）

工单无适合本流程的整数修订字段，采用限定来源字段的 canonical command SHA-256。altocProductFeedbackSnapshot 已实现类型、必填产品、长度和字符边界检查，并统一空说明；摘要不含 priority、联系人或 SLA。该 helper 尚待接入已授权工单读取和首次冻结事务，不单独构成授权或并发保护。

## 11. 定时反馈派发目标配置（2026-09-08）

Altoc scheduled drain 通过 `hzy.productFeedback.aimsDeployment`（环境变量 `HZY_ALTOC_PRODUCT_FEEDBACK_AIMS_DEPLOYMENT`）取得明确的 AIMS 目标部署，再传给反馈专用签名 transport。该值不得使用 Altoc 源部署替代；未配置时反馈投递返回可恢复错误，不能以源部署签名。请求态使用可信 Gateway 解析的 AIMS route，不依赖此 scheduled 配置。

配置代码和受控测试已完成，不表示实际环境已填入有效目标。部署验收仍须核对精确客户端、服务授权、目标路由和 JWT／签名，不能仅以配置非空作为成功证据。

## 12. 当前实现与未完成边界（2026-09-08 联合回归）

已实现：Altoc 工单预览／冻结提交／刷新恢复／即时及后台派发；AIMS 接收与正式来源去重；决策和连续合并的事务 outbox；AIMS→Altoc 状态签名传输、原子回执、单调投影及弹窗展示。两个方向的角色／服务身份、实际签名算法、源和目标领域事务分别有测试证据。

本轮联合测试：Altoc 12 项、AIMS（含服务授权）17 项 TypeScript 测试通过；Go 的 Altoc、AIMS、productcenter 包中反馈、决策、合并相关测试通过，其中数据库场景使用专用隔离 MySQL。浏览器证据为实际组件配模拟 API，不是实际 tenant 端到端。

仍需完成或验收：
- 实际租户迁移和精确 client grant 安装、真实 JWT token issuance、跨部署 HTTP／签名及 worker 启用恢复演练。
- 功能／版本进度回流；当前六字段仅覆盖需求决策及 canonical 合并引用，不包含功能交付或版本发布状态。
- 合并后的 canonical 需求评估进展展示：当前原反馈显示 merged 与最新 canonical UUID，不表示 canonical 评估状态已回传。
- 通知资格及通知流程如需启用必须单独接入；目前无自动客户通知。

PC-18 产品采用／经营结果及 PC-12 总体验收不因上述局部测试通过而完成。

## 13. 功能／版本进度快照读取（2026-09-09）

新增内部 `readFeedbackProgressTx`，由持有产品工作空间锁的调用方事务读取，不能独立作为授权入口。当前尚未接入外部服务或既有 outbox。

- 沿需求合并引用解析最终需求，独立返回 canonicalRequestBizId、canonicalDecisionStatus；循环、超过 64 层或合并状态与引用不一致均拒绝，不把中间需求当最终结果。
- 将最终需求及其历史合并来源组成需求族，通过 product_request_features 关联版本功能；仅纳入同产品且 is_public=1 的版本特性。EXISTS 防止多个需求关联同一功能时重复计数。
- 每个版本仅返回版本号、版本状态、计划发布日期、实际发布日期、相关公开特性数及已交付数，不包含功能标题／正文、项目、客户或操作者。无相关公开版本时返回空数组，不推断交付成功或客户已部署。
- 隔离 MySQL 已验证连续合并、去重、公开过滤、跨产品隔离、日期分列、空结果、错误合并状态及循环拒绝；既有反馈决策 outbox 回归通过。

下一步接入须保留现有六字段 v1 冻结命令及其重试身份；新增进度需使用明确的新 schema/operation，并同时实现目标验证、单调投影、迁移、回执与页面展示，不能直接给既有冻结 v1 命令追加字段。本节不表示功能／版本进度已回传 Altoc。

## 14. Altoc 进度命令校验与独立投影（2026-09-09）

新增八字段进度命令解析：既有六个身份／决策字段，加 canonicalDecisionStatus 和 versions。未合并时两个决策状态必须一致；合并时原决策固定 merged，canonical 决策不得为 merged。versions 必须显式提供（允许空数组，最多 1000 项），版本号去重，逐项严格校验六字段、日期、公开计数与交付计数上界；不接受内部正文或客户字段。现有 v1 解析仍拒绝此新命令。

Altoc 迁移 `048_product_feedback_progress_projection.sql` 与 canonical schema 新增独立进度投影，保存 source_revision、command_sha256 和经过校验的完整快照。`applyProductFeedbackProgressTx` 要求外层已验证 receipt 事务，锁原提交绑定后校验产品／原需求，旧代际忽略，同代际异内容冲突，新代际替换全部快照。该函数不更新工单，也不修改旧决策投影。

隔离 MySQL 已验证迁移重复执行、父事务回滚、重复投递、旧代际、同代际冲突、版本证据清空和错产品拒绝。解析测试覆盖必填字段、未知字段、null、日期错误、重复版本和计数越界。尚未注册新 operation/schema、接入签名服务入口、接收 receipt、源 outbox 或页面读取；这些仍是后续必做项，当前不能宣称新版进度已形成端到端回流。

## 15. 新版进度事务回执（2026-09-09）

新增内部 `receiveProductFeedbackProgress`：固定 operation `aims.altoc.product-feedback.update-progress.v1`、schema `product-feedback-progress.v1`、capability `altoc:product-feedback:update-progress`，仅接受 AIMS / aims.runtime 到 Altoc 的已认证命令。入口调用者仍须先验证 JWT 和签名上下文；当前未对外注册入口。

通过共享 ReceiptRepository 将进度投影和成功回执放在同一事务。回执重试前重新检查工单未删除及原提交产品／需求绑定，不能以已有成功回执绕过当前来源检查。回执保留原 requestBizId 和单调 sourceRevision，返回 applied 结果。

隔离 MySQL 验证：注入投影 UPDATE 失败时无进度成功回执；恢复后原命令成功；同命令返回原 receiptId；来源工单删除后即使已有回执也拒绝重试。旧状态完整 Runtime 回归同时通过。精确服务授权登记、签名 HTTP 接入、源侧触发与页面展示仍未完成。

## 16. 新版进度 Runtime 路由与授权声明（2026-09-09）

已注册 `POST /v1/altoc/internal/product-feedback:progress`，从 Runtime 可信上下文解析标准 receipt 命令，严格要求 `altoc:product-feedback:update-progress`，并核对 Altoc 自身 Runtime 调用、租户及目标部署。旧 update-status 权限不允许调用新版接口，GET 不允许写入。

Altoc manifest 增加 update-progress 服务动作；授权生成器增加 AIMS→Altoc 与 Altoc→两个 Runtime audience 的精确能力，不加入普通用户角色。当前生成矩阵为 233 条要求（215 条安装、18 条传输前置条件）。隔离 MySQL 授权幂等／失效测试和 10 项授权契约回归通过。

实际 Adapter.HandleRuntime 测试验证既有回执重放以及错误 scope、tenant、deployment、source app 拒绝。外部 HTTP 签名 BFF、源 AIMS outbox/变更触发、Altoc UI 仍待接入，不能据此认定跨应用进度链路已完成；本次没有安装真实环境授权。

## 17. Altoc 新版进度签名 Service API（2026-09-09）

已接入 `POST /api/v1/service/product-feedback/progress`，在通用转发前由专用处理器接管。校验 Console 服务身份、精确 update-progress scope、AIMS/aims.runtime、可信目标 Altoc 租户部署，再校验八字段命令、摘要和标准签名。仅调用 Altoc 自身 Runtime，使用 service-client-policy 来源绑定。

回传仅包含经过逐项身份核对的完整回执及 requestBizId/sourceRevision/applied；不透传 command 或内部 Runtime 数据。版本快照额外校验合法日期、去重、公开计数和字段白名单。服务身份、路由、签名篡改／错误回执与快照输入共 5 项 TypeScript 测试通过，受影响服务文件 ESLint 通过。这些测试采用受控依赖，不代表真实 JWT／跨部署 HTTP 验收。

源 AIMS 尚未冻结或派发新版 progress operation，Altoc UI 仍未读取新投影；端到端功能继续进行。

## 18. AIMS 新版进度事务冻结（2026-09-09）

新增 `enqueueFeedbackProgressTx`，调用方持产品工作空间锁并提供本次产品修订，在同一事务内读取合并需求族的正式 Altoc 来源、canonical 决策及公开版本快照，冻结八字段命令。独立幂等键 `aims:product-feedback:progress:{原需求UUID}:{产品修订}`，operation/schema/capability 与新版接收端一致，不改写既有 status.v1。

嵌套版本结构先转为 JSON 对象再执行共享 canonical hash，避免 Go 结构体字段顺序与接收端 map 排序产生不同摘要。隔离 MySQL 已从实际持久化 command_json 复算摘要并验证一致，验证原需求身份、最终决策、新协议标识，以及父事务回滚时无 outbox 残留。超过 1000 个关联版本返回错误，不截断后冒充完整快照。

当前 helper 尚未接入业务变更触发，也尚未接入 AIMS operation claim/执行器；完成派发支持后须将其接入需求决策、功能关联与版本变化事务，继续做提交成功、并发和跨应用验收。

## 19. AIMS 新版进度执行器与传输（2026-09-09）

新增 progress operation 执行器，并接入共享 claimed dispatcher、请求态 IO 和 scheduled IO。校验冻结八字段快照、hash、租约及协议身份；通过独立 `/api/v1/service/product-feedback/progress` 和 update-progress capability 签名投递。定时调用复用已配置的 Altoc 目标部署，不以 AIMS 源部署替代。

成功回执核对原需求、修订及完整标准身份后在 fencing token 下确认；签名／网络／回执失败沿用共享失败分类与恢复，ACK 不可用保持 pending。新增执行器／传输及旧状态执行器共 7 项 TypeScript 测试通过；受影响服务文件 ESLint 通过。业务变更事务尚未调用进度冻结 helper，因此本节仅证明派发路径支持，不能视为自动回流已启用。
