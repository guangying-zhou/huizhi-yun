# PC-16 产品文档空间实施契约

状态：目标契约，尚未实现。本文承接完整产品中心方案的 PC-16，不替代现有项目文档合同。实际进度见 Aims-Product-Center-Implementation-Status.md。

## 已核对的实现基础

- Codocs `inferDocumentTypeFromBusinessContext` 已优先将携带 productCode/product_code 的创建上下文归为 product；AIMS 无需创建第二套文档正文存储。
- Codocs 项目正文 Service API 已使用签名 actor 和文档 owner/share/relation ACL；产品成员关系不能替代该 ACL。
- AIMS 当前没有 product_documents 关系表及产品文档读写接口，产品页也没有文档入口。文档分类存在不代表产品空间或正文授权已完成。

## 事实源与最小数据模型

AIMS 保存产品与文档 UUID 的关系，Codocs 保存文档元数据、正文、模板实例及 ACL。AIMS 关系只包含 biz_id、product_code、document_uuid、用途、建立/解除关系的用户与时间、revision；不复制正文，不根据标题识别文档，不产生 ACL。关系唯一键为 product_code + document_uuid，解除后可在同一关系身份上恢复，历史追加记录。

用途首批为产品说明、需求规格、设计说明、发布说明、使用指南、其他。用途只影响组织方式，不构成权限或正式验收结论。模板由 Codocs 管理，AIMS 仅引用已授权模板 UUID，不在 AIMS 维护第二套模板正文。

关联、解除、恢复均使用产品根修订、关系修订和幂等键；关系、活动日志和命令回执同事务。解除只解除 AIMS 关系，不删除 Codocs 文档，也不撤销用户已有分享权限。

## 浏览器行为与权限

产品详情增加文档入口。列表真实分页，支持用途筛选；空列表提供关联现有文档入口。建立关系前先选用途与可访问的 Codocs 文档，完成后刷新列表。模板创建是独立动作，必须先获得 Codocs 创建与模板读取权限。

产品 documents/view 控制产品文档空间访问，documents/edit 控制关联维护；这些能力需由 AIMS manifest 正式定义，不能用产品版本权限代替。每次返回文档标题、预览、正文、搜索结果前，Codocs 都校验可信 actor 的当前 ACL。产品关系不自动创建 can_read/can_edit/can_comment 分享记录。

无正文权限时不得泄露标题、摘要、命中片段、存储路径或文档 UUID；可只显示产品侧“存在受限关联”的数量与说明。筛选与分页必须先经过可见性过滤，total 明确为可见记录数，受限数量独立返回。授权依赖失败为可重试错误，不缓存为有权，不伪装为空列表。

## 服务边界实施顺序

1. 在 AIMS manifest 定义产品文档资源，增加关系迁移、领域命令、审计与回执及数据库授权测试。
2. Codocs 增加独立产品文档元数据/正文读取合同：可信签名 actor、产品关系来源、UUID、操作和租户/双 deployment 绑定；重新执行文档 ACL。复用 Foundation 签名、token 和 runtime helper，不复制认证算法，不复用项目 permit。
3. 更新 Codocs manifest、Console 精确 grant seed/verify、Service API 拦截清单及 MODULE_CONTRACTS；所有信任边界分别申请短期 token，正文响应不包含 OSS 路径。
4. AIMS BFF 对产品关系授权后调用 Codocs，完成可见列表、关联选择、解除确认和文档打开/预览。所有正文仍从 Codocs 取得。
5. 在 Codocs 原有创建流程接入产品上下文和模板，创建与关联分步记录 operation/receipt；创建成功、关联失败时可重试同一 UUID，不重复造文档。

## 必须验证的场景

- 有产品权限但文档未分享：不可预览、搜索或读取正文；分享后可读，撤销后立即失效。
- 有文档权限但无产品权限：不可读取或修改产品关系。
- 错 capability、来源应用、audience、tenant、source/target deployment、过期 token 或 actor 签名：在正文/存储访问前拒绝。
- 关联重放、并发建立、解除重放、旧修订更新、审计失败：满足唯一性、幂等及全部回滚。
- 超过一页且混合可见/受限文档：分页、总数与搜索无泄露；权限故障不返回不完整成功数据。
- 模板创建后关联失败：保留可恢复状态，重试不重复文档；解除产品关系不删除文档。
- 实际浏览器 1440/390 检查、真实产品成员与文档分享角色验收，以及目标环境 grant 核验。仅单元测试或模拟页面不能替代这些验收。

## 模板创建接入差距与实施顺序（2026-09-08 实查）

当前产品列表、关联维护、搜索与正文预览已实现，本文开头“没有产品关系表/入口”的初始盘点已过时；逐项验证证据以实施记录最新条目为准。

现有创建路径不能直接作为产品模板创建的可靠实现：

- `codocs/app/composables/useQuickCreateDoc.ts` 仅接受 private/project/department/worklog/weekly，没有产品上下文或模板选择。
- `codocs/server/api/v1/documents/index.post.ts` 接受普通文档写scope和ownerUid；先创建元数据，再上传正文，不包含产品签名委托、模板ACL或成功回执。
- `data-runtime/internal/apps/codocs/document_lifecycle.go#createDocument` 虽支持按产品上下文推断类型，但普通创建按OSS路径查重，文档与owner关系在同一事务，没有创建命令回执。重试可能收到重复错误，不能证明正文已经上传。
- `codocs/app/pages/company/templates.vue` 使用公司资产浏览器展示 templates 目录，不能将目录路径直接当作已经授权的模板文档UUID。

后续按以下依赖实施，不复用普通创建接口绕过缺失能力：

1. 明确可选模板来自 Codocs 已登记文档UUID；模板搜索与读取均校验当前用户ACL。公司资产中的未登记模板需先走现有导入流程，不向AIMS暴露存储路径。
2. 新增精确 `codocs:product-document:create` capability 与独立签名创建命令；actor来自会话，产品上下文不产生Codocs创建或模板读取权限。服务端必须检查用户自身创建资格。
3. Codocs按操作身份冻结目标UUID、模板内容快照/hash与标题。元数据、owner关系和可恢复操作记录同事务；上传固定目标后才形成成功回执。上传失败重试同一目标，成功回执重放不得再次覆盖用户后续编辑。
4. AIMS持久记录创建阶段和返回UUID，再执行现有产品关联命令。创建成功而关联失败保留UUID与待关联状态，重试只关联；跨产品或更换模板/标题需新操作身份。
5. UI展示创建中、待关联、已完成及可重试失败，不把已创建文档伪装为整体失败；验收必须覆盖上传失败、成功回执丢失、关联冲突、权限撤销和重试不覆盖编辑。

以上为尚待实现的创建闭环，不能由现有“关联已有文档”或预览测试替代验收。

创建签名合同补充：operationCode 固定 `aims.codocs.product-document.create.v1`，commandSchemaVersion 独立为 `product-document-create.v1`（适配现有回执表30字符列）；operationId 必须为规范UUID，幂等键与command hash由共享 ReceiptCommandFromBody 校验。只读接口无回执，其既有schema不变。

持久准备顺序细化：创建前先在Codocs product_document_creation冻结正文；此时不发布documents行。每个上传尝试使用独立对象路径，上传成功后将文档/owner关系、完成状态与成功回执同事务提交。并发失败尝试不得覆盖胜出路径；未被选中的上传对象后续按内部恢复/清理策略处理，不作为正式文档。AIMS仍在成功回执后建立关联。

### 创建请求内部读取（2026-09-08）

`POST /v1/aims/internal/products/{productCode}/documents:request-view` 使用既有 `aims:product-documents:read` service capability，body 为 `{input:{biz_id},authorization}`。运行时必须验证当前操作者的产品文档 **edit** permit，服务 scope 本身不赋予用户产品权限。返回 `product_code/workspace_revision/biz_id/document_uuid/purpose/operation_key/status/relation_biz_id`；请求和 operation 按固定来源、目标、操作类型及 source biz 绑定。不存在请求沿用 product_document_not_found。此端点仅供 BFF 恢复创建及关联；文档 UUID 对浏览器公开前必须另做当前 Codocs ACL 检查，不返回冻结标题、模板内容或内部错误。

### 创建请求内部写入（2026-09-08）

两个内部 POST 入口均要求 `aims:product-documents:create`（已有产品文档关联创建能力）和当前用户产品文档 edit permit：

- `/v1/aims/internal/products/{productCode}/documents:template-create`：`input={expected_revision,template_uuid,title,purpose}`，登记创建请求与 caller operation。
- `/v1/aims/internal/products/{productCode}/documents:link-created`：`input={expected_revision,request_biz_id}`，验证目标成功事实并关联文档。

两者 body 同时携带 `authorization` 与 `idempotency_key`。操作者取签名委托用户，租户及源部署只取 Runtime 认证上下文，不接收 input 内的 actor/tenant/deployment 覆盖。AIMS 创建 capability 不替代目标 Codocs 的 `codocs:product-document:create` 或用户 documents:create 资格。BFF 接入时，模板创建前检查模板可访问，结果关联前检查服务端解析目标文档的 Codocs ACL。当前内部入口没有浏览器路由。

### 浏览器模板创建请求（2026-09-08）

`POST /api/v1/products/{productCode}/roadmaps/documents/template-create` 要求 Idempotency-Key，无 query；body 精确为 `{templateUuid,title,purpose,expectedRevision}`。BFF 先要求当前产品文档 edit、读取 Codocs 模板元数据 ACL，再核对当前产品操作者和修订，调用内部 template-create。返回 `{code:0,data:{requestBizId,workspaceRevision}}`，不公开预分配的目标文档 UUID。响应仅表示创建请求已登记，不表示目标文档已创建；请求恢复／派发和页面尚待接通。

### 浏览器创建结果关联（2026-09-08）

`POST /api/v1/products/{productCode}/roadmaps/documents/link-created` 要求 Idempotency-Key、无 query、精确 body `{requestBizId,expectedRevision}`。BFF 以当前产品文档 edit permit 读取内部 request-view，检查产品／请求／修订匹配且 operation succeeded，按服务端 document_uuid 检查 Codocs ACL，再次确认用户和产品修订后调用内部 link-created。返回 `{code:0,data:{bizId,workspaceRevision}}`。pending 请求不会检查尚不存在的文档或执行关联；输入不得携带 documentUuid、操作者或其他覆盖字段。

### 创建请求即时派发（2026-09-08）

模板创建 BFF 在请求持久化后按服务端 requestBizId 派生既有 operation key 并领取租约，核对返回 key、操作类型和冻结产品后调用专用执行器。响应新增 `creationConfirmed`：仅即时目标回执校验与 source checkpoint 均成功时为 true，不表示产品文档关系已建立。领取不到任务、调用或 checkpoint 故障时仍返回已登记的 requestBizId，creationConfirmed=false，不重新创建另一任务；后续按原请求恢复。

### 浏览器创建状态查询（2026-09-08）

`GET /api/v1/products/{productCode}/roadmaps/documents/request-status?requestBizId={UUID}` 只接受 requestBizId 查询参数。当前产品文档 edit 授权后读取内部请求；返回 `{requestBizId,status,workspaceRevision,relationBizId}`，不公开目标文档 UUID、operation key 或内部错误。status 使用 integration operation 既有八种状态；succeeded 必须再次通过目标文档 Codocs ACL 才返回，其他状态不访问尚未确认创建的文档。全部响应 no-store，返回前复核产品身份和修订。关联 ID 只表示请求已建立过关联；关联是否仍有效由现有文档列表／详情确认。

### 创建请求分页列表（2026-09-08）

内部 `POST /v1/aims/internal/products/{productCode}/documents:requests-list` 使用既有精确 `aims:product-documents:read` 和当前产品文档 edit permit，input 为 `{page,page_size}`。返回 `{product_code,workspace_revision,items,total,page,pageSize}`；每项仅含 `{biz_id,purpose,status,linked}`，不返回文档标题／UUID／模板／operation key。COUNT 和分页在同一 REPEATABLE READ 事务中，按请求 id 降序排列；linked 表示曾建立关联，不表示关系当前仍有效。文档打开或结果关联仍须另过 Codocs ACL。

### 浏览器历史请求列表（2026-09-08）

`GET /api/v1/products/{productCode}/roadmaps/documents/requests?page=1&pageSize=10`：仅接受 page/pageSize，默认 1/10，page 最大 100000、pageSize 最大 100。要求当前产品文档 edit，调用内部 requests-list；检查返回产品、修订、页码、总数、行数、唯一请求 UUID 和用途／状态。仅返回 `{items:[{requestBizId,purpose,status,linked}],total,page,pageSize,workspaceRevision}`，多余内部字段被剥离。无文档元数据，不为列表另行调用 Codocs；查看成功请求及关联仍单独执行 Codocs ACL。

### 文档创建 worker grant（2026-09-08）

任务派发调用自己的 Runtime 时要求 `aims.write aims:integration_operation:execute`；通配权限不满足精确执行检查。既有单数下划线 capability 已在 AIMS manifest 显式登记，并由产品中心生成器在 data-runtime／tenant-runtime 两个 audience 安装，普通用户 recommendedRoles 不包含该服务能力。Console Seed／Verify 当前共 190 项要求；目标环境仍须按实际 client code 校验活跃凭证和授权后启用。

### 原请求恢复派发（2026-09-08）

`POST /api/v1/products/{productCode}/roadmaps/documents/request-resume` 无 query，精确 body `{requestBizId}`。复用状态查询的产品 edit、请求归属和当前身份校验，只对 pending/retry_wait/partial_unknown 尝试领取原 operation；claim 保持 next_attempt_at、租约和 fencing 约束。processing、succeeded 和终态不重置；永久失败／dead-letter 不绕过管理员重放。返回的是派发前观察状态，页面随后 GET request-status 取得最新结果；GET 本身无派发副作用。
