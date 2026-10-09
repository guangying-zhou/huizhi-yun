# 模块交互契约

## 2026-09-21 hzy0 本地 Console 门面（策略链已切换，完整业务未验收）

本日第 1 步真实探针已确认旧策略封包完整、Platform 签名/哈希通过，但本地
HMAC 密钥不匹配；不是缺版本或缺授权。后续采用 Enterprise 内 Console 模块
验证版本化完整签名信封，Runtime 提供受控最新修订/同步状态；不新增 Gateway
策略验证通道。旧 `/v1/console/policy-bundle` GET 仍只是 opaque 存储读取，不能
将其冒充新接口；新合同的代码候选与环境状态分列如下。
字段覆盖、身份及兼容边界见 [策略验证合同核查](./Console-Enterprise-Policy-Verification-Contract.md)。

后续代码候选已有 `hzy-policy-envelope.v1` 完整 Ed25519 信封、Go 接纳规则及
Host 验证 helper；后续已增加默认关闭的 `/v1/console/verified-policy` 与隔离新表，
通过临时 HTTP/MySQL 验证，后续仅在本机 C000001 测试 Runtime 启用并接入在线消费者。新接口仍仅接受
Console source、精确 policy-bundle read/write、显式 deployment binding 和实时
grant/credential 校验；未授予 Enterprise 借用 Console 身份的权限。GET 可返回
过期/撤销水位以支持 CAS 恢复，不是授权判定，Host 必须继续检查当前有效期和状态。
信封签名不等于最新状态证明，旧 opaque GET 不可替代受认证的当前状态读取。
同修订续签不得改变正文、状态或部署范围；重放不得刷新 acceptedAt。

新候选补充：Platform 原正式 bundle 端点用 `format=hzy-policy-envelope.v1`
协商完整信封，不允许历史版续签/304/回退更早 active 行。Runtime 另有显式开启的
`GET /v1/enterprise/console-policy`，只读、真实 enterprise 身份、精确 read grant、
登记 Console 存储部署及签名双部署覆盖；输出绑定读者的回执，不授予 Console 写权。
Host 导航已有默认关闭的当前策略/会话版本检查，角色与业务授权路径不变。
同步器/Console 消费者已增加显式 `verified-runtime` 后端：协商新格式、精确身份
CAS 写入、验证当前回执；不回退旧 HMAC/内存。仅明确缺行 404 可初始化，其他错误
失败关闭。hzy0 已安装精确 read 业务 grant 和双 audience semanticScope 映射；
Console 自有策略部署取受信服务目录，不改变 Enterprise 入站身份。完整状态见上述合同第 12 节。

2026-09-21 后续获准发布：仅开发 Platform `hzy.wiztek.cn` 已交付完整信封及
issuer，公网既定公钥验签和 Console/Enterprise 双部署绑定通过；旧格式兼容，
策略包数据不变。生产 Platform/其他云端应用未发布。后续本机 Runtime、表、grant、
同步已切换，登录/导航/文档列表现场通过；固定制品与证据见上述合同第 11～12 节。

显式 `local-canonical-facade` 将浏览器认证入口放在 hzy0 `/console`，canonical
issuer 仍为 `https://hzy-test.huizhi.yun`；后端保留 canonical 名称，由受控
Gateway egress 拨号本地 Console。公开 token 仅接受 Enterprise 授权码/刷新，
不能继承服务身份。Gateway 独占远端凭据；Console 仅接收独立本地入口密钥、
公开验签材料和正式短期 Runtime bootstrap，关闭后台同步/心跳。

前置故障曾在 SSO/授权码交换完成后产生 `policyVersion=null`，Host 正确拒绝进入；
当前完整信封链已解除该阻塞。持久化策略完整性与本地入口密钥仍是不同信任边界；
不复制远端密钥、不绕过校验、不重签覆盖共享记录。候选模式缺策略时签发前
返回 503。不能把登录/读取通过登记为 G1 或全部业务验收通过。

## 2026-09-20 hzy0 本机获准副本

当前状态：产品编辑审计修复已部署测试 Runtime `0.3.219-test.product-edit-audit.1`（用户确认 `7d42abd1` 加定向补丁）。真实 hzy0 保存后丢响应，同键重试复用一份成功回执及同一条 updated 事件，actor 一致；恢复原备注新增一条独立事件。无 schema/grant/身份边界变更。下述“尚未部署”保留为修复前过程记录；G1 其他矩阵仍待验。

产品编辑审计补齐：Assets owning `UpdateProductInTransaction` 与修改同事务写入 `product_asset/updated`，operator 使用验证 actor；位于 receipt business callback 内，幂等重放不重复写事件，事件失败回滚修改和回执。没有 schema/API 或权限变更。真实 hzy0 丢响应后同键重试已验证唯一成功回执，审计修复仅通过隔离 MySQL 测试，尚未部署共享 Runtime；不据此放行 G1。网关错误映射仅增加正式产品冲突/幂等冲突 409 和依赖不可用 503 的固定白名单。

最新写链准备：用户允许测试环境业务数据修改，egress 仅增加 `assets:product:edit` + `audience=data-runtime` 精确例外，仍固定 Enterprise 身份及测试部署。既有正式 grant 签发/验签/状态核验通过，未新增云端 grant。该 capability 包含产品创建/编辑/关联，非字段级权限；人员/对象 permit、幂等与审计不变。其他写 scope、Node/loopback 仍失败关闭。测试产品备注已通过正常页面保存、回读并恢复；丢响应重试与审计尚待验收，下述只读限制描述保留为前一阶段记录。

符合性整改（当前只读 Dev 阶段）：Host `/enterprise` 是 SPA 注册首页，品牌同址；本机 `/` 与尾斜杠仅 GET/HEAD 临时 302，其他方法 405。gatewayInternal 明确固定 23121，profile 预检拒绝其他端口。本地两段错误通道仅对已登记 code/status、64 KiB JSON 做固定文案/有限字段映射，未知诊断继续脱敏；入口可保留已知 host-only 空值 Max-Age=0 Cookie 清理，出口不透传远端 Cookie。Retry-After 仅保留有界秒数。写 scope、Node/loopback guards 不变，不据此放行 G1。

2026-09-20 用户批准补齐测试 Enterprise 的两个 Console 只读 grant：`console:directory-project-access:read`、`console:business-domain:view`，固定 C000001 / C000001-test-enterprise / audience console。受保护修复脚本仅新增缺失项、拒绝撤销/冲突，其他 grants 保持不变。正式目标 API 两项 200，交叉 capability 与错误 audience 拒绝；此授权同时适用于该身份的云端测试 Enterprise，不涉及生产。此前“未新增 grants”为接通凭据阶段的历史边界。

目录读链修正：Aims/Enterprise 项目范围计算通过 Foundation `fetchConsoleDirectoryApi('/departments'|'/user-departments')` 读取既有 `console:directory-users:read` 服务投影；保留部门负责人/领导、下级部门与个人归属语义，归属查询拒绝或故障不再推断主部门。目录项目列表 GET 使用既有 `console:directory-project-access:read` 与固定 `projection=projects`。这些为调用契约修正，不新增服务 grants；拒绝不能退回旧管理端接口。

用户批准 hzy0 使用现有 C000001 测试 Enterprise 身份及现有测试 Gateway 凭据。Enterprise → `127.0.0.1:23121` 本地 egress → `https://hzy-test.huizhi.yun`；两段凭据分离，远端凭据仅 Gateway 进程从既有受保护文件读取，不注入 Nuxt 或浏览器。egress 启动回读远端 Registry 摘要确认测试 Enterprise deployment，固定 origin/tenant/environment/app/deployment、拒绝重定向与未登记路径、拒绝非读取 service scopes；用户令牌/会话仍由 Console 校验。未新增 grants、未切换 Runtime、未变更云端配置；本轮仅验证读取链。关闭本机适配器可将 profile 凭据引用恢复为本地入口引用并定向重启两个 hzy0 进程。

## 2026-09-19 ADR-019 导航访问补充

Enterprise `GET /enterprise/api/navigation` 通过 `requireEnterpriseUser` 验证当前用户与受信 Host 租户/部署，再复用 Foundation `loadAuthorizationSnapshotFromConsoleRuntime`，分别以 Aims、Assets、Codocs 为逻辑目标读取人员权限；不把物理 Enterprise 权限快照混作三个领域的授权。返回本发布已注册且具备当前人员权限的稳定节点 ID 与导航展示用 `maxAgeMs=300000`（5 分钟，客户端每 2 分钟刷新），`private, no-store`；授权服务不可用保留 503。客户端后台刷新只在同一验证 scope、未到期时保留展示，失败/过期/撤权清理；该展示租约不是业务授权。菜单与对象操作引用 manifest 的人员资源/动作，不引用服务 capability 来推导用户权限。对象详情、写入、数据范围及字段授权仍由原 handler 执行，不新增 grant 或绕过 Service Binding。

Console Shell 迁移使用 Gateway 的 `x-hzy-enterprise-shell-pages` 受控投影：仅 pilot、Host binding、tenant/environment、enterprise deployment 和 Console deployment 全部匹配时注入；Gateway 先剥离浏览器同名头。Foundation `/api/application-shell-migration` 再以 gateway token 验证上下文、按生成的 registered page pattern 精确匹配目标，保留 query/hash，拒绝 API/OIDC/OAuth 和跨源目标。该元数据不是授权；错租户、错环境、错 deployment、非 pilot、未迁移页均回退原 Shell iframe。Console 页面必须在创建 iframe 前调用判定，AppRail prewarm 不得触发导航；Gateway 与 Console 需同版本发布。

测试 pilot 的旧 `/shell/{appCode}` 仅对 GET、受控 tenant/environment/Host deployment 绑定与生成的正式页面登记做兼容跳转；保留合法 query/hash，移除旧 iframe 标记，未迁移页面及写请求仍走原兼容链路。此为本地修正合同，不表示环境部署或线上角色验收完成。

## 2026-09-19 项目文档宿主链补充

浏览器复验修正：Aims manifest 不存在 `documents` 用户资源，不能以该虚构权限阻断全部用户。Host 与 Aims 服务的用户入口资格统一为既有 `projects:view`；写入仍重施项目成员/负责人/scoped-admin 关系，删除仍限上传人或项目经理，策略写入仍限项目经理，正文与附件仍受 Codocs ACL。服务 capability 的 read/write/download/manage 分离不变，不为用户新增角色或授权。

Enterprise 复用 Aims 原项目文档页；新增 `POST /aims/api/v1/projects/{id}/other-documents`，通过既有 `aims:project-documents:write` 签名命令的 `upload-file` 动作调用 Aims。宿主单附件限 10 MiB，稳定 `documentUuid` 参与幂等；Aims 重新验证 actor 的文档编辑权限、项目关系与对象归属，再调用 Codocs 文件柜精确能力。multipart 在 Foundation Service Binding 中保持原始字节，不得 JSON 化。

PA-01 项目文档写入收紧：Enterprise 的项目 Markdown/附件新建与访问策略修改先要求 `projects:edit`；Aims 受信 Service 命令验签后以同一 actor 的 Console `projects:edit` scoped grants 和 Runtime 当前项目/活动成员事实再次判定项目范围，部门树只取 Console 当前目录索引。company L0/L1 的公开读取例外不用于写入。原项目成员/经理门槛与 Codocs 创建能力保留；访问策略修改还须在改 Codocs 策略及 Aims 摘要前通过 Codocs 当前 `edit` ACL。项目文档 `access-check` 仍是只读业务判定，但 Codocs 会写既有访问审计行，不修改文档或策略。

Aims 项目文档搜索、摘要、创建、策略、检查、审计改走 Codocs `POST /api/v1/service/project-document-access/execute`，不再使用 Aims 身份直连 Codocs Runtime。来源固定 `aims.runtime`，能力为目标 manifest 的 `codocs:project-document-access:{read,manage,create}`；命令 schema=`aims-project-document-access.v1`，operation=`aims.codocs.project-document-access.{action}.v1`，包含 actor、对象、完整 payload hash 及源/目标 deployment 的 HMAC。Codocs 验证后使用自己的 Runtime 身份，项目范围 marker 只有已签名 `service-command` actor 可消费。该接口允许 Aims 委托项目范围与策略写入，属于固定来源的高风险接口，不给其他调用方或浏览器通用权限。

Foundation 的 request-local 已验签 actor 证明只由 `verifyServiceCommandRuntimeHeaders({ event, ... })` 建立，并与当前 service principal、tenant、来源 deployment、目标 app、capability 再绑定；不修改用户会话或信任客户端 actor header。Console 注册项目文档各用途和 `enterprise_project_admin`，按固定资源/动作读取当前主体授权；动作蕴含仍使用 Foundation helper。

创建重放：Aims 索引、Codocs metadata 和 cabinet file 对相同 UUID 校验不可变输入；相同输入返回原对象，不同内容/归属返回 409。正文和附件初次对象路径绑定 UUID 与内容摘要，已存在对象不覆盖，初次 PUT 使用 provider 防覆盖条件（OSS 限未启用 bucket 版本控制）；上传失败不删除并发请求可能拥有的对象。正文创建错误向上游传播，不再返回虚假成功。策略 GET 返回缺省值但不创建策略记录。

环境初始化见 Console v2.11 seed/verify，以及既有 v1.50 cabinet grants。Codocs 对 `oss.default` 的配置读取与 Vault resolve 使用 data-runtime / tenant-runtime 两个 audience 的精确 grant，限制 integrationCodes。C000001/test 已补配置与 grants；部署与验收证据见 `deploy/test-env/CLOUDFLARE_TEST_STATUS.md`，未部署生产。

> 本文档定义汇智云各模块间的 API 调用关系、共享标识和集成规则。
> 更新日期：2026-09-13（补充 ADR-018 分阶段整合指引）

> 说明：本文档描述**当前有效契约与目标主路径**。新能力默认走 `platform` 策略治理、`console` 企业基础运行服务、Console Directory API、Console OIDC、Console service token 与 Foundation adapter；`account` 仅作为 legacy 目录/身份/项目注册表迁移源与兼容 facade。存量未迁移调用关系继续有效，但不得为新能力新增 `account` 权限治理、目录扩展或静态跨模块密钥依赖。详见 `Directory-Runtime-Contract.md`、`Account-Directory-Runtime-Refactor-Plan.md`、`console/docs/Console-Directory-Runtime-Integration-Plan.md`、`console/docs/Console-Functional-Design-v1.md`、`console/docs/sql/Console-SQL-DDL-Draft-v1.sql` 与 `console/docs/Console-API-Contract-v1.md`。

## 已确认的整合方向与当前契约

[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md) 已确认统一企业应用、每租户统一业务库及全量功能交付的目标，[实施 TODO](./Unified-Enterprise-Implementation-Plan.md) 维护迁移进度。C000001 测试环境已激活 Aims/Assets 统一库 generation=1 并启用 Enterprise Host 路由；生产及其他未迁移路径继续遵守原接口和身份规则，具体验收见[测试部署记录](./Unified-Enterprise-Test-Deployment.md)。

**Enterprise Host 用户委托能力收敛（代码合同；环境切换另批）**：Foundation 的固定 operation 表仍只允许登记的 METHOD/path；针对 `/v1/enterprise/<domain>/**`，从 Runtime 路由受信 `LogicalTarget` 派生服务 scope `<domain>:enterprise-host:execute`，域仅 `aims`、`assets`、`codocs`、`altoc`、`console`。五个能力分别为 `aims:enterprise-host:execute`、`assets:enterprise-host:execute`、`codocs:enterprise-host:execute`、`altoc:enterprise-host:execute`、`console:enterprise-host:execute`。只允许 `enterprise.runtime` 对实际配置的 Runtime audience 请求，Console 当前 ACTIVE grant、来源、租户/部署仍精确核对；其它域 token 不能进入本域路由。它们是服务入口能力，不是人员 resource/action：Host 的 Console 权限快照和 Runtime 的签名 actor、≤15 秒 permit、具体 resource/action/mode、关系/范围复核、双 permit、事务/幂等保持原样。这条 Host 通道的人员权限由模块 manifest 定义，五个域服务能力只在本合同和 Runtime API 合同定义；其它独立服务的 manifest 资源依其合同保留。scheduler/worker、cutover/control、独立 `/api/v1/service/**`、Workflow proxy、policy reader、通知发布及其它服务客户端均不适用，继续用各自精确 scope。下文历史专项段落出现的 Host 逐操作 service capability 是切换前合同；C000001 v2.27 写入、Runtime/Host 切换和 v2.28 撤旧 grant 均须单独批准，不能仅凭源码合入视为环境生效。

后续完成专项合同与验收的 Runtime 业务域允许受控跨模块查询、内部领域服务及共享事务；同进程协作可移除多余 HTTP，真实服务边界仍校验身份、租户、actor 和权限。每次迁移在本文更新具体路径、数据写入责任、授权、事务/幂等、旧消费者与兼容版本；不得因为整合方案已确认就直接放开所有应用或表的访问。全量功能资格也不替代人员操作权限和数据范围。

首条内部目录链：Enterprise Host `GET /assets/api/v1/product-directory` → Runtime `POST /v1/enterprise/assets/product-directory` → 注册统一库 Assets 领域服务。物理身份固定 `enterprise.runtime`，精确 `assets:product:read`，保留当前 credential/grant、签名 actor、BFF 范围编译与事务内对象过滤；不经过旧 Assets Worker，不写历史快照。测试部署已切换，完整业务验收状态以测试部署记录为准；见 [Enterprise API](../enterprise/docs/API_SPEC.md)。

### 2026-09-15 新登记链路（尚未部署此批）

- 工作项：Enterprise `POST /aims/api/v1/projects/:id/work-items`、`PUT /aims/api/v1/work-items/:id` → Foundation → Runtime `POST /v1/enterprise/aims/work-items:create|edit` → Aims 领域写入。人员权限为 `work_items:create|edit`，服务 capability 为 `aims:work-item-create:execute`、`aims:work-item-edit:execute`，物理身份固定 `enterprise.runtime`。创建复用项目工作项校验；基本编辑绑定 project/workItem、检查活跃受派人员和内容 expectedVersion。业务事实、changelog/activity audit 与 succeeded receipt 同事务，同键返回冻结结果，旧内容版本返回 409。状态、结构、版本关联和服务工单结果 outbox 尚未由此编辑入口替代，不能放开字段绕过原 workflow/可靠投递合同。
- 数字资产：Enterprise `GET /assets/api/v1/digital-assets[/:id]` → Foundation → Runtime `POST /v1/enterprise/assets/digital-assets:list|view` → Assets 自有查询。人员权限 `digital_assets:view` 与服务 capability `assets:digital-asset:read` 分别核验。owner/project 对象范围在实际查询执行；无法执行的部门或关系约束不降为全量。`POST /assets/api/v1/digital-assets` 与 `PATCH /assets/api/v1/digital-assets/:id` 通过同一链路映射到 `:create|edit`，分别要求 `assets:digital-asset:create|edit` 与 `Idempotency-Key`；Assets owning receipt、业务变更、范围复核和审计事件处在 Registry generation fence 的同一事务。Host 只在 `digital_assets:edit` 快照有效时显示写入口。
- 知识产权资产（整合分支候选，未启用）：Enterprise `GET /assets/api/v1/ip-assets[/:id]` → Foundation → Runtime `POST /v1/enterprise/assets/ip-assets:list|view`，分别核验 `ip_assets:view` 与 `assets:ip-asset:read`。total/summary/page 使用同一 Registry snapshot，owner relation 与关联产品项目范围按 grant-unit 合取；不返回未授权产品计数。`POST /assets/api/v1/ip-assets`、`PATCH /assets/api/v1/ip-assets/:id` 对应 `:create|edit`，要求人员 `ip_assets:edit`、具体 `assets:ip-asset:create|edit` capability 和幂等键。命令、Assets owning receipt、写入前后范围检查与审计处于同一 Registry 写事务；编辑不允许修改 ip_code，省略 nullable 字段保留旧值，显式 null 清空，必填字段拒绝 null。新增 20260916 receipt migration 必须追加到既有 CHECK，不能替换丢失产品/关联/数字资产能力；旧 schema 503。产品/文档关联未迁入，Host 入口继续隐藏。
- 跨域批量名称与聚合：Enterprise `POST /assets/api/v1/products/resolve-codes` → Foundation `assets.product-directory-resolve` → Runtime `POST /v1/enterprise/assets/product-directory:resolve` → 统一库 Assets 领域服务 `ProductDirectoryService.Resolve`。人员权限为 `products:view` 派生的对象范围，服务 capability 仍是精确 `assets:product:read`。单次最多 200 个唯一编码；名称、按状态与按产品线聚合复用目录列表的同一 grant 谓词、目录 readiness 与只读事务，不因被请求编码放宽谓词。**不可读编码与不存在编码统一归入 `unresolved`，调用方无法区分**；返回字段限于编码、名称、产品线、产品线标签与来源状态，聚合不含未授权产品。
- 产品采用查询：Enterprise `GET /aims/api/v1/products/:productCode/adoption` → Foundation `assets.product-adoption-read` → Runtime `POST /v1/enterprise/assets/product-adoption:read` → 统一库 Assets 交付资产与环境。人员权限为 `deliveries:view` 与 `environments:view` 两个对象族各自编译的数据范围，分别作为绑定 permit 传入，任一族被拒即返回 `assets_object_scope_denied`；服务 capability 为精确 `assets:product-adoption:read`。统一读取在单一 snapshot 事务内取总数与明细，取代原先经签名跨应用命令访问独立 Assets Worker 的路径。所需兼容视图 `customer_delivery_assets`、`asset_environments`、`customer_delivery_asset_environment_rel` 使用独立清单，未安装时只有该入口返回 503。
- 工作项状态与删除：Enterprise `POST /aims/api/v1/work-items/:id/{plan-ready|start|reset|reopen}` 与 `DELETE /aims/api/v1/work-items/:id` → Runtime `POST /v1/enterprise/aims/work-items:{plan-ready|start|reset|reopen|delete}`。`plan-ready` 对应 V2 `decompose` 规则，只允许非需求目标 planning→todo，要求控制工时、有效起止日期及至少一条目标成果，并在事务内要求项目负责人、活跃经理或 scoped 管理员；独立 capability `aims:work-item-plan-ready:execute` 避免与需求分解提交混淆。其余状态流转为 todo→in_progress、in_progress→todo、completed→in_progress，均按项目 `workflow_transitions` 校验；人员权限沿用 `work_items:edit`。删除为敏感动作，要求独立的人员权限 `work_items:delete` 与服务 capability `aims:work-item-delete:execute`，编辑权限不构成删除授权，Runtime 在同一事务冻结工作项与子项删除证据。状态动作只接受 `expectedVersion` 且不接受人员 permit，均按项目数据范围执行。
- Matter 成果添加：Host `POST /aims/api/v1/work-items/:id/deliverables` 从路径固定单条 matter owner，经已登记的 `aims.project-deliverable-batch-create` / `aims:project-deliverables:edit` 进入 Runtime；人员 `projects:edit` 门槛与 Runtime active manager/scoped admin 对象校验共同生效。Runtime 的成果新增、工作项证据修改、项目交付物直改/删除均按项目→matter 行锁序列化，只有 `in_progress` 可写，其余状态 409；target 和非 matter 不改。无新 Foundation 操作、manifest 或 grant；浏览器必需成果验收仍须单独记录。
- 两条链均校验 Console JWT/JWKS、tenant/deployment、签名 actor、当前 credential/grant 和绑定对象的最多 15 秒 permit。Nuxt/BFF 无数据库凭据，不转发旧应用 runtime Token，也不借宽 scope 替代精确 capability。源码和隔离测试不表示环境 grants、固定制品及浏览器验收已完成。

## 核心原则

策略包持久存储：Console → Foundation `consolePolicyStore` → Data Runtime `GET/PUT /v1/console/policy-bundle` → `hzy_console.policy_bundle_snapshots`。精确 capability 为 `console:policy-bundle:read|write`，来源固定 Console，audience 为 Runtime；完整 JWT、credential/grant 撤销及租户/部署校验先于读写。这两个 scope 的 Token 签发不读包摘要。PUT 内容 ETag + expectedEtag CAS 幂等，禁止旧同步覆盖新同步；GET 缺包为 null。协议及上线核验见 [持久包说明](../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md)。

Console 的可选服务令牌 exchange 仅处理携带 `client_secret` 的 `client_credentials`：Foundation 以 `console.runtime` 已签发的 Runtime 令牌和独立 `console:service-token:exchange` grant 调用 `POST /v1/console/auth/service-tokens/exchange`。Runtime 亲自校验客户端密钥和 ACTIVE grant；来源 app 来自客户端库，租户来自认证上下文，来源部署来自所选 grant。Console 传入的已验证策略 version/hash 仅与正式 `verified_policy_snapshots` 的签名信封比较，摘要不参与客户端/grant 授权；exchange（密钥客户端与 Gateway 两种 lane）复用 Runtime `policyenvelope.Store`、`VerifyAuthenticity`、`EvaluateValidity`，要求本机信任锚、精确 tenant/environment/Console deployment 与 `valid/grace` 租约。读取沿用签发事务，缺失、损坏、错绑定或过期返回 `503 console_exchange_policy_unavailable`，摘要不同返回 `503 console_exchange_policy_mismatch`；不读或更新 legacy `policy_bundle_snapshots`，禁止旧表回退或新旧双接受。签名和成功审计同一事务，审计失败不返回令牌。缺密钥 Gateway 身份、授权码及刷新令牌继续原路径；功能开关默认关闭。新 scope 不能通过 Platform bootstrap 或 Console key assertion 直接调用，只能使用真实 `console.runtime` 身份。两种 Runtime audience 共享一条精确 grant，启用前均需真实签发探测。


签发 issuer（ADR-017 F3-1）：Runtime 的 `/v1/console/auth/oidc/sign`、`/v1/console/auth/service-tokens/issue` 及服务令牌 exchange（密钥客户端与 Gateway 两种 lane）统一取本机认证器正在使用的受信 JWT issuer；已批准的 trust 引导更新由同一认证器实时提供。调用方 `iss`/`issuer` 仅作一致性断言，错值返回 403 `oidc_signing_issuer_mismatch`，签出的 `iss` 一律为受信值；未配置/无效 Runtime issuer 返回 503 `oidc_signing_issuer_unavailable`，不使用请求值回退。issuer 拒绝先于凭据、密钥引导、replay 与审计写入，不授予额外 capability/grant。

服务签发身份（ADR-017 F3-2）：通用 `oidc/sign` 以 `credentialId + client_id` 精确解析当前 active、未过期凭据所属的 `service_clients` 行，并复核每项 active grant。`sub=client:<client_code>`、`hzy.subjectCode/clientCode/clientName/clientType/appCode` 与 `source_app` 只来自该行；调用方已提供的任意身份字段必须是精确一致的字符串，否则403 `oidc_signing_service_identity_mismatch`，不签名、不引导密钥。未提供的可选字段由Runtime补齐。工具类客户端 `app_code IS NULL` 时应用身份只可为空或缺省，签出空值，不从请求发明来源应用；数据库身份不完整503 `oidc_signing_service_identity_unavailable`。消费状态接口仍只返回既有active/reason，不向调用方扩展身份字段。issue与两种exchange已有数据库身份推导，本批不修改grant/audience/deployment规则。

### 签发部署绑定（ADR-017 F3-4）

Runtime 在 server 构造时向 Console signer 注入配置的 Runtime deployment 与已登记 deploymentBindings（含已审核的本机 Workflow 覆盖），复制 map 并用 mutex 隔离并发；调用方的请求不能登记或修改这些事实。

- 通用服务签名只检查 F3-3 实际选中的 active grant。完整 `tenantCode/deploymentCode` 是权威绑定，tenant 必须等于本 Runtime 租户；部分字段、非字符串、混合 scope 的不同部署均 403。旧 grant 两字段缺失/NULL时，由凭据行的 canonical app_code 查询受信配置里的来源应用部署；有显式 map 时缺项503，不按租户名拼部署。沿用 `Config.DeploymentForApp` 的 Connector→Console 支撑服务绑定；无显式 map 的 legacy 配置只使用已登记 Runtime deployment。工具 client 的NULL app若无明确 grant 绑定则503，具有完整绑定仍可签发。
- `deployment` 必须严格等于上述来源部署，不能使用目标 audience 的部署、他租户部署或请求构造的名称；错值403 `oidc_signing_service_deployment_mismatch`。未选中的 grant 不参与决定部署。
- access/id 用户 token 继续先复核 live session/subject，再要求 deployment 属于受信配置的显式登记值集合或 enrolled Runtime deployment；未知值403 `oidc_signing_user_deployment_mismatch`，登记事实未接线503。此批不增加 auth_clients/azp 检查（F3-5另批）。
- Console自身 issue 已按认证Console部署构造 claim，经通用Sign再核验；secret/Gateway exchange 保留每条所选 grant 完整绑定、tenant一致与 Gateway签名来源部署等值校验，不新增入参覆盖。失败先于签名密钥引导。

本批仅代码与隔离测试，不写grant/配置。F3-3/4/5和F4-1合入后才按已批准方案一起升版本机Runtime，部署时核验实际签发与SSO正例。

### OIDC trust 共享初始化（ADR-017 F4-1）

Console OIDC bootstrap 继续先验证 Platform 签名、有效期、tenant/Console deployment/runtimeCode、用途与 trust URL；随后先检查本地 overlay 冲突，并在既有 `console_mutation_receipts` 中固定共享 trust，再消费 JTI、引导密钥、写入 overlay、更新内存。共享事实的 operation 为 `console.auth.oidc.trust.initialize`，idempotency key 为规范化 `(tenant, console deployment, runtimeCode)` 数组的 SHA256；request_sha256 约束规范化绑定与 issuer/audience/jwksUrl，result_json 保存同一事实与摘要。仅含公开 trust，不含私钥或令牌，不新增表/权限/迁移。

唯一回执+事务使不同进程/空 overlay 的第二实例也不能用新 JTI 替换 trust；不同事实409 `console_oidc_bootstrap_jwt_trust_immutable`，在 JTI/密钥副作用前拒绝。合法首次请求先持久固定 trust，后续 custody/磁盘失败只能按相同事实恢复；不因后续失败释放 trust 根。相同事实重试不重复初始化审计，同一 JTI 的原有 durable receipt 继续复核内容并支持安全续行。

启动时按 enrolled runtimeCode 读取共享事实：本地 overlay 冲突则拒绝启动；overlay 缺失时从共享事实恢复认证配置、清除旧 inline JWKS，只允许相同 envelope 重建磁盘。首次升级若共享事实不存在而已有受保护 overlay，则先固定该已接受的 trust 后再对外服务；普通 env/legacy JWT 默认配置不用于建立共享事实。未 enrolled（无 runtimeCode）的 legacy 实例不查此初始化 tuple。共享记录损坏/依赖查询失败均失败关闭，不当作未初始化。该初始化写入发生在批准的 Runtime 升版启动或正式 bootstrap，不在代码测试阶段写环境。

### 用户签发客户端（ADR-017 F3-5）

access/id token 在 live session、subject 与部署登记检查通过后，要求 `aud` 是本 Runtime 数据中 `auth_clients.status=active` 的精确 `client_id`。即使数据库排序规则忽略大小写，返回 client_id 也必须与 aud 字节相等；未知/停用客户端403 `oidc_signing_user_client_not_active`。`azp` 缺省允许，出现则必须为与 aud 精确相等的字符串（空/null/其他类型或错值403 `oidc_signing_user_azp_mismatch`）。检查在密钥读取/引导之前，查询故障不签名。

SSO 会话不绑定单一 auth client；同一个有效会话可为不同已登记 active 客户端签发。不新增 client/session 字段，不改服务 token audience/grant 路径，不将 app_code 或 deployment 代替 auth_clients 客户端事实。本批仅代码与隔离测试，统一部署后再做登录正例。

### 服务签发 audience 映射（ADR-017 F3-3）

通用 `oidc/sign`、Console 自身 `service-tokens/issue`、密钥 exchange 与 Gateway exchange 统一使用 Runtime `mapServiceAudienceScopes`。每个请求 scope 必须匹配凭据所属 client 的一条当前 active grant；`target_app` 缺省时补为 `aud`，已提供时须精确等于 `aud`，否则 403。用户 token 与公开服务状态接口的响应合同不变。

- 有 `scope_json.audience` 的行只对该 audience 有效，不能被物理 resource 前缀或兼容表覆盖。映射保留既有两种形式：物理 scope 精确相同且以该 audience 加冒号开头，或 JSON audience 与 semanticScope 分别精确匹配。歧义映射、无效 JSON/字段失败关闭。
- `audience` 缺失或 NULL 的存量行视为未登记，一律 403。阶段1临时兼容表已收紧为空；错 client、错 audience、scope 扩张、撤销 grant 均 403，不以 source app、前缀相似或动态配置扩大兼容。
- Console 管理更新既有 `data-runtime:runtime:update` → `runtime.update` 别名仍只在 `console.runtime`、`aud=data-runtime` 且单 scope 时派生并校验原精确 grant；它不是通用点号 scope 兼容。

以下为已迁移的历史组合（不是运行时白名单）：

| client | audience | 已登记 scope（除标注前缀外均为精确值） |
| --- | --- | --- |
| console.runtime | data-runtime | 前缀 `console:`；`data-runtime:runtime:update` |
| enterprise.runtime | console | `console:policy-bundle:read` |
| console.runtime | workflow | `workflow:proxy`、`workflow:notification-details:authorize` |
| console.runtime | aims / altoc / assets / finance / people | 各自 `<app>:notification-details:authorize`，仅这五个精确 app/scope 配对 |
| console.runtime | connector-runtime | `connector-runtime:diagnostics:view`、`connector-runtime:identity:exchange`、`connector-runtime:identity:dingtalk:exchange`、`connector-runtime:jobs:cancel`、`connector-runtime:jobs:view`、`connector-runtime:people:sync`、`connector-runtime:notifications:send` |
| console.runtime | notification-runtime | `notification-runtime:send` |
| console.runtime | tenant-runtime | `tenant-runtime:runtime:update` |
| console.runtime | webdev | `webdev:issue:read`、`webdev:issue:write` |
| codocs.runtime | data-runtime | `credential_vault:resolve`、`integration_config:view` |

2026-09-26，经批准在本机 C000001 合并补齐93行的 audience/semanticScope，保留其它 JSON 键、授权状态及其它字段（updated_at 反映迁移）。逐行核验93/93，以上22个精确三元组及1个前缀代表请求真实签发23/23为200，Codocs跨audience反例403。运行时兼容表现为空；Go历史夹具同时证明登记后通过、缺失/NULL audience失败关闭。

明确排除的3行 `connector-runtime:directory:sync`、`console.schema:read`、`workflow:action_defs:sync` 保持原状、无audience、失败关闭，不删除或撤销；Codocs tenant-runtime 两项同样不在已登记组合内。其它环境的grant事实迁移仍待独立盘点与批准，部署此版本前必须补齐其合法签发组合。Enterprise 的同名 policy scope 向 data-runtime/tenant-runtime 使用分别登记的前缀物理行，不能把旧Console行扩展到其它audience。此次不启用外部通知或OSS，不新增权限。

1. **未迁移路径保持既有边界** — 独立应用不跨模块直连数据库；内部整合按上节及 ADR-018 的专项合同逐项替换 HTTP/同步，Nuxt/BFF 始终不持有业务库凭据
2. **单一事实源** — 每类数据只有一个权威模块（见下表）
3. **稳定标识** — 跨模块引用使用业务键，不使用内部自增 ID
4. **统一服务认证** — 跨模块服务端 API 调用、回调、同步和写操作统一使用 Console 签发的 `token_use=service` JWT；业务应用通过 Console runtime/app identity 获取运行时配置与短期 token，本地 env 不新增跨模块 client secret，也不再依赖 app 级 `license.lic` bootstrap。目标模块验证 Console JWKS、`aud`、`scope`、`token_use=service` 和来源应用，不新增共享 webhook secret 或静态 API key。

Console 委托 Runtime 签发其他应用的服务令牌时，部署必须匹配 Runtime 已登记的 `deploymentBindings[appCode]`，并同时匹配 `<app>.runtime` client/subject 与 `source_app`。存在显式绑定表时，未登记应用或旧生产形状 `<tenant>-<app>` 不得作为 fallback；只有未配置绑定表的 legacy 部署保留旧命名规则。测试部署名不能因包含环境后缀而被拒绝，也不能删除精确绑定检查来放行。

## 企业应用 Shell 导航契约

- Console 是企业应用 Shell 的 UI 宿主，入口为 `/shell/{appCode}?target=...`；Tenant Gateway 未命中业务应用 base path 时按既有默认规则把该路径路由到 Console，不新增特殊服务端代理。
- Tenant Gateway 的默认 Console 转发在存在 `HZY_CONSOLE_SERVICE` 时直接使用该 Binding，保留统一头清理及 Console app/deployment/prefix 上下文；无 Binding 的私有部署仍使用显式 origin。仅本地多 Worker 启动器强制要求本地 Console/People Binding，不修改生产部署配置，方案见 `deploy/test-env/LOCAL_WORKERS_PLAN.md`。
- Foundation AppRail/AppLauncher 把当前用户应用目录中同源、非 Console 原生入口的业务应用转换为 Shell URL；Console、工作台和跨源部署继续使用直接 URL。
- Shell 只使用 `/api/user/applications` 返回的当前用户授权应用目录，并把 `target` 限制在该应用 `homeUrl/basePath` 内。该检查只约束导航，不能替代目标应用自身 OIDC、路由权限和服务端对象范围授权。
- 子应用 iframe 使用 `hzy_embed=1` 激活 Foundation 嵌入布局。嵌入布局隐藏父 Shell 已提供的全局应用入口、通知、用户菜单和反馈入口，保留应用自己的业务侧边栏、页面标题、操作和内容。
- 子应用只向同源父窗口发送 `hzy:shell:navigation` v1 消息；Shell 同时校验 `event.origin`、`event.source`、`appCode`、消息版本和目标 home path，随后同步父 URL 与标题。不得信任任意 postMessage 数据拼接 iframe URL。
- Shell 最多保留最近两个业务 iframe，使用 LRU 淘汰；pointer/focus 导航意图可预热下一个业务应用。同源业务 URL 顶层刷新默认恢复 Console Shell，只有显式 `standalone=1` 才进入独立应用模式；跨源应用保持直接访问。独立模式用于新窗口、开发测试和 Shell 故障降级，不得由普通刷新隐式触发。

## 数据归属

Codocs 组织资产管理员快速发布和查看记录由 Codocs BFF 与 tenant-runtime 专用合同承载，文档元数据、幂等发布计划及访问审计均归 Codocs runtime。快速发布不触发 Workflow 或企业微信通知；Directory 提供界面及 CSV 导出时查看人的当前姓名，审计用户取签名 actor。已发布资产短链接映射同样归 Codocs runtime，BFF 生成和解析时沿用原预览权限，短码不授权额外读取。权限、接口及部署依赖见 [runtime 合同 9.3.1–9.3.2](./Tenant-Runtime-API-Contract-v1.md#931-组织资产管理员发布与查看记录)。

| 数据类型               | 权威模块   | 标识键         | 其他模块如何获取         |
| ---------------------- | ---------- | -------------- | ----------------------- |
| 用户、部门、角色、权限 | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `uid`, `dept_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 平台项目注册表         | Console directory-runtime（新主路径）/ Account（legacy 兼容） | `project_code` | 新接入使用 Console Directory API / Foundation adapter；存量 legacy 可继续 Account REST API |
| 文档内容与元数据       | Codocs     | `uuid`         | Codocs REST API         |
| 研发执行（迭代/任务）  | Aims       | `work_item_id` | Aims REST API           |
| 产品版本、版本特性与版本目标进度 | Aims | `product_code`, `version_code`, `version_id` | Aims service REST API |
| 客户/商机/合同/经营回款计划 | Altoc      | `code`         | Altoc REST API          |
| 发票/到账/核销/支出/项目财务核算/人力成本参数 | Finance | `code` | Finance REST API |
| 资产/采购/环境/产品主档 | Assets     | `asset_code`, `product_code` | Assets REST API         |
| 人员事实、任职、离职交接任务、成本快照、项目贡献快照、个人绩效周期与确认结果 | People | `employee_uid`, `assignment_code`, `offboarding case_code/task_code`, `cycle_code` | People REST / service API |
| 轻量待办/通知/协同入口 | Console employee-portal | `uid`, `appCode`, `biz_id` | Console REST API / Foundation adapter |
| 深度组织协同/借调/协助 | Align（可选增强） | `request_code` | Align REST API          |
| 审批流程/实例/待办     | Workflow   | `instance_id`  | Workflow REST API       |

## 目标/新路径权威源

| 数据类型 | 目标权威模块 | 标识键 | 其他模块如何获取 |
| -------- | ------------ | ------ | ---------------- |
| 企业基础资料、系统参数、节假日/工作日历、集成配置、凭证引用 | 客户侧 Tenant Runtime Console/Vault adapter；Console 为薄 BFF | `tenant_code`, `setting_key`, `calendar_code + year_month`, `integration_code`, `secret_ref` | Console REST API → Foundation Console Runtime client → 客户 Runtime；不得直连 Console DB |
| 用户、部门、岗位、项目注册表、外部目录同步 | Console directory-runtime（已落地核心表与 API，持续迁移） | `uid`, `dept_code`, `project_code` | Console Directory API / Foundation adapter；新 adapter 不提供 Account fallback |
| 人员运营事实、任职、职级、月度人员成本、项目贡献快照和个人绩效周期 | People（端口 3007） | `employee_uid`, `assignment_code`, `cycle_code`, `contribution_code` | People REST / service API；来源事实保留 `source_app/source_biz_type/source_biz_id/source_refs` |
| 租户企业角色、主体授权、policy bundle | Platform（端口 3011） | `role_code`, `subject_code`, `bundle_version` | Platform Dashboard 治理；应用角色仅作为企业角色的权限聚合来源；Console / 企业应用运行时拉取签名 bundle 后本地鉴权 |
| 租户订阅、deployment、license、policy bundle、revocation | Platform（端口 3011） | `tenant_code`, `deployment_code`, `bundle_version` | Platform `/api/v1/runtime/**` / `/api/v1/policy/**` |
| 前端访问观测配置与摘要 | Observability Worker（Cloudflare） | `tenant_code`, `app_code` | Platform tenant-admin dashboard 通过 `/api/platform/tenant-admin/observability/**` 代理读取；明细存 Analytics Engine，摘要和配置存 D1 |

## Platform ↔ Console 运行时契约

ADR-017 新增的客户数据面契约：

| 调用方 | 被调用方 | 方式 | 用途 |
| ------ | -------- | ---- | ---- |
| Tenant Gateway 独立分钟调度 | Console | `POST /api/internal/policy-bundle/sync` 经 Console Binding | 固定空请求，无客户端可选 tenant/URL；使用 Gateway token + 60 秒时间窗的 path/tenant/deployment/app/environment/runtime/host HMAC。公网入口返回 404。成功 `{code:0,data:{ready:true}}`，不可用 503；重复同步可重试，Runtime CAS 不允许旧同步覆盖新同步 |
| Console BFF（Cloudflare / PM2 / Self-hosted） | 客户侧 Tenant Runtime Console adapter | Foundation `callConsoleTenantRuntime()`；已接入 profile、settings、business domains、regions、work calendar、audit read/append 和 current-user notification state 的 `/v1/console/**` 语义 API | Runtime 校验 service token tenant/deployment/exact source app/capability 和签名用户 actor，并在 SQL 前/返回前校验 enrollment tenant。Mutation 要求 Idempotency-Key，版本化写入要求 expectedRevision，业务写、receipt、审计同事务；notification recipient 固定为当前签名用户。Runtime 不可用时 503，不回退 Console DB |
| data-runtime Console adapter | 客户侧 `hzy_console` | `HZY_CONSOLE_DB_*`；与 Directory 同时启用时强制配置一致并共享一个连接池 | 作为 Console 租户数据唯一数据库入口；Console/Platform/Gateway 不接收 DSN 或凭证 |

已实现的 MVP 调用方向：

| 调用方 | 被调用方 | 方式 | 用途 |
| ------ | -------- | ---- | ---- |
| Console（PM2 / 私有单租户） | Platform | `GET /api/v1/runtime/deployments/{deploymentCode}/bundle` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 首次启动、缓存启动刷新、heartbeat `download_bundle` action 触发时拉取签名 policy bundle |
| Console（PM2 / 私有单租户） | Platform | `GET /api/platform/runtime/applications?tenantCode={tenantCode}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | `/api/user/applications` 可按需获取当前 deployment 环境的租户订阅应用入口；用户可见性由本地已验签 policy bundle 的角色授权过滤 |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/subjects/sync` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 启动时重建 `directory_subject_exports`，并把最小 subject 投影同步到 `tenant_subjects`；同时同步 `directory_user_departments` 的多归属 membership 到 `tenant_subject_memberships`；不包含姓名、邮箱、手机等目录 PII |
| Console（PM2 / 私有单租户） | Platform | `POST /api/v1/runtime/heartbeat` + `Authorization: Bearer HZY_PLATFORM_RUNTIME_TOKEN` | 上报 Console deployment 心跳、bundle 版本、auth-runtime 健康状态与签名 key 指纹 |
| Console（Cloudflare 共享） | Platform | `GET /api/platform/internal/console/tenants/{tenantCode}/bundle?environment={environment}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN` | runtime 模式由独立同步拉取并验签保存；普通鉴权 cache-miss 不再拉取。旧 memory 模式、显式管理刷新和通知详情等原有高风险 fresh-policy 路径保留原语义；角色持有人与 subject-eligibility 服务读取使用下述逐请求修订探测门槛。旧 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN` 仅作兼容；不使用租户 Runtime Token 或 deployment license token |
| Console | Platform | `POST /api/platform/internal/console/tenants/{tenantCode}/service-keys` + Platform 内部凭据（hzy0 经 Gateway 固定私有出口） | R1 稳态服务身份：策略同步时自动登记本部署 Ed25519 公钥，Platform 签入该部署策略信封；body 仅 `environment/deploymentCode/publicKey`，只接受 active Console 部署，不改变授权。见策略验证合同 §15 |
| Console（Cloudflare 共享） | Platform | `POST /api/platform/internal/console/tenants/{tenantCode}/subjects/sync?environment={environment}&deploymentCode={deploymentCode}` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN` + `x-hzy-internal-principal: console-managed-cloud-worker` | LDAP/Account/企业微信/钉钉/GitLab 或手工 subject 同步完成后，把最小 subject 与 membership 投影写入 Platform；tenant/deployment/environment 只取可信 Tenant Gateway 上下文并由 Platform 绑定 active Console deployment，body 不能覆盖租户边界；不包含目录 PII |
| Platform tenant-admin | tenant Console BFF → Tenant Runtime | 复制安装命令内的 `directory-connector-enrollment.v1` 单次签名 token → Console `POST /api/v1/console/directory-connectors/enroll` → Runtime `POST /v1/console/directory-connectors/enroll` | Platform 同时把固定 Ed25519 `kid/public key` 写入受保护 Runtime 安装配置；Runtime 验原始 payload 签名、有效期、tenant、Console deployment 和单次 `jti`，在同一事务登记 RSA-3072 Connector 公钥与审计，只返回 Connector identity，不签发 Console OAuth credential |
| Directory Connector（独立 systemd/Linux 用户） | 本机 data-runtime Directory adapter | RSA-PSS 签名 loopback `POST /runtime/internal/directory-connector/{configuration,commands/lease,sync,commands/{id}/complete}` | Runtime 从客户侧 Vault resolve LDAP Secret 后只返回 Connector RSA-OAEP 密文；在客户服务器内 lease/fencing 执行创建用户、改密码、显式立即同步和连接认证测试。LDAP 全量同步只响应目录同步页提交的 `sync-now` 命令，启动和周期 tick 不自动扫描；data-runtime 通过 `directory_connectors.public_key_pem` 验签、校验 tenant/deployment、时间戳与 nonce 防重放；Connector 不持有数据库账号、Console OAuth credential 或 Vault 明文 |
| Console Directory BFF | data-runtime Directory adapter | `GET /v1/console/directory/{provisioning,me/password-capability,operations/{id}}`；`POST /v1/console/directory/{connector-operations/users,connector-operations/ldap-sync,me/password,sources/ldap/test}` + `console:directory-connector:{view,execute}` + 签名用户委托 | Runtime 排队 LDAP 创建用户、本人改密、立即同步和连接测试；命令、幂等 Receipt 与审计同事务，operation 状态仅原发起人可读；Console 不直连 `integration_operation` |
| data-runtime Directory adapter | 客户侧 `hzy_console` | 复用 data-runtime 受保护数据库配置，默认 `HZY_DIRECTORY_DB_NAME=hzy_console` | 本地事务写 `directory_users`、`directory_identities`、membership、sync job、operation attempt 和最小 subject export；LDAP 明细与数据库逐行处理不经过 Cloudflare |
| data-runtime Directory adapter | Platform | 分块 `POST /api/v1/runtime/subjects/sync` + enrollment 返回的租户 Runtime Token | 每次本地同步成功后以最多 10 条/请求提交脱敏 subject/membership、snapshot hash 与 Console deployment 绑定；tenant-runtime enrollment 必须把同环境 active Console deployment 纳入 `tenant_runtime_instance_apps`，Platform 继续按精确 deployment 绑定校验 Runtime Token；Console 记录仅作为控制面绑定，固定 `schema_ready/not_applicable`，不生成 adapter enable flag，也不参与 Agent schema 心跳更新；首块重置 runtime membership、末块才提交健康游标，失败可从首块幂等重试；不提交姓名、邮箱、手机号、LDAP DN 或密码 |
| Console Directory lifecycle operation | Platform | `console.platform.employment-sync.v1` / `console.platform.offboarding-revoke.v1` → authorization employment/offboarding internal API | Console 在 Directory mutation/receipt 同事务冻结 caller-owned operation；默认关闭的 bounded drain 使用 lease/fencing/attempt 投递。HMAC 绑定 Console source deployment、固定 Platform target deployment、tenant、path、capability、hash、original actor 与时间；Platform 在授权 mutation、水位和 receipt 同事务提交后才返回 succeeded |
| Console 授权运行时 | Platform | `POST /api/platform/internal/authorization/instance-conflict-explain` + `Authorization: Bearer HZY_CLOUDFLARE_INTERNAL_TOKEN`（或兼容 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`） | 只读解释当前用户在具体业务对象上的自审批、同人经办审批和职责冲突风险；供 Console current-user API 与 Foundation helper 消费，业务应用不得直连 Platform tenant-admin 诊断接口 |
| 企业应用（经 Foundation） | Console | `GET /api/v1/console/runtime/apps/{appCode}/config` | 启动时拉取 app runtime config，包括 Console API 端点、应用元数据、Workflow 地址和非 secret 运行参数；不直接读取 app license 派生启动配置 |
| 企业应用浏览器（经本应用 Foundation BFF） | Console | `POST /api/heartbeat` → Console `POST /api/v1/heartbeat` + 当前已验证 Console 用户会话 | 每 2 分钟写入 Console tenant-runtime 在线状态；BFF 以服务端 `public.appCode` 固定来源应用且不接受浏览器 uid/sourceApp。Console 自身直接调用 `/api/v1/heartbeat`，业务应用不得保留只返回成功但不写 Runtime 的本地空壳接口 |

约束：

- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_RUNTIME_TOKEN` 来自 platform 开通/订阅页面生成的 env artifact，platform 仅保存 hash。Cloudflare 共享 Console 不配置该 token。
- Tenant Gateway 调用 Platform internal `runtime-bootstrap-token` 时，90 秒 `data-runtime-bootstrap` JWT 的 `iss` 必须来自部署配置：优先可信 Worker bindings / 进程环境中的 `NUXT_PUBLIC_SERVICE_URL` 或 `PLATFORM_SERVICE_URL`，再回退 `runtimeConfig.public.serviceUrl`，不得固定为生产域名或使用请求 Host。开发控制面与生产控制面分别使用自身 URL 和签名密钥；缺少合法配置返回 503。Runtime 按受保护 `control.platformUrl` 精确验签发方，并继续校验 Console scope、tenant/deployment/app/runtime 绑定。Wiztek 2026-09-05 开发控制面规范 URL 已改为 `https://hzy.wiztek.cn`，生产仍为 `https://huizhi.yun`；旧开发域名的 HTTP 跳转不改变 JWT issuer 校验规则，新增测试 binding 必须使用新的规范 URL。
- 本地 C000001/test 联调由 `deploy/test-env/local-gateway.mjs` 复用 Gateway 头清理与精确 source-binding，固定回环 Console/People 后端和 SSH Runtime transport。Platform bootstrap 仍由正式接口签发，仅通过 SSH helper 在内存中刷新，内部服务凭证不下发本机。Console 仅在网关已认证、显式 `HZY_LOCAL_TEST_GATEWAY_ENABLED=true`、Node development/profile dev/environment test、配置 issuer 为 loopback HTTP 且与 forwarded host/proto/prefix 完全一致时保留本地 OIDC issuer；生产和共享托管规则不变。People 独立端口使用既有 standalone UI 模式，不改变 JWT、角色或数据范围授权。
- Tenant Runtime 的 Vault master key 由客户侧 KMS/受保护 Runtime 配置生成和持有；Platform、Console、Cloudflare Worker 和业务应用均不接收该值。Platform 如保留历史 bootstrap secret，只能用于一次性迁移到客户侧 Runtime，不能继续下发给 Console。
- PM2 / 私有单租户 Console 的 `HZY_PLATFORM_LICENSE_TOKEN` 和所有 Console policy bundle 必须用 `HZY_PLATFORM_SIGNING_PUBKEY` 验签；Cloudflare 共享 Console 不配置 `HZY_PLATFORM_LICENSE_TOKEN`，按请求从 Platform 内部 bundle 接口获取并验签。Platform 不再向业务应用下发 app 级 `license.lic`。
- Console 只缓存运行时授权包，不持有 platform 私钥，也不修改 platform 授权治理数据。
- Console `/api/auth/permissions` 与服务端 `checkPermission/requirePermission` 只读取本地已验签 policy bundle，不再代理 Account 权限 API；授权快照返回 `availableRoles` 与 `activeRoleCode`，其中 `availableRoles` 只包含平台企业角色。普通运行默认按用户全部有效企业角色合并计算 `roles/resources` 与 `/api/user/applications` / AppRail / AppLauncher 应用可见性，`activeRoleCode` 仅作为展示/显式模拟提示；只有服务端显式允许的 `role_simulation` 才按指定企业角色收窄，且无效模拟角色不得回退到其他角色；bundle 缺失、过期、未激活时生产环境按失败关闭。
- Policy bundle 的 `applications` 投影包含 `appCode/appName/description/icon/homeUrl/callbackUrl/logoutUrl/basePath/apiBase/appType/runtimeMode/serviceRole/authMode/bundleEnabled/status`，并按 `environment` 生成，可支撑 Console 离线应用入口展示和 OIDC client 物化；bundle 还包含 Platform deployment settings 的 `consoleLogin`，供 Console 运行时消费上游员工登录配置。Cloudflare 共享 Console 的 `/api/user/applications` 只读取本地已验签 bundle，不再用租户 Runtime Token 调用 Platform runtime applications。
- Policy bundle 主 `schemaVersion` 已切换为 `policy-bundle.v2`。新生成 bundle 不再输出已被 v2 替代的 `subjectRoles`、`subjectRoleScopes`、`roleScopes`、`baselinePermissions` 冗余字段，并新增 v2 `rolePermissionGrants` 作为角色权限事实；`rolePermissions` 仅作为历史兼容字段保留。Foundation/Console 对历史 bundle 仍保留 v1 fallback。Foundation 的 `buildScopedAuthorizationGrantsFromPolicyBundle()` / `evaluatePolicyBundleScopedAuthorization()` 优先读取 v2 `roleAssignments`、`rolePermissionGrants`、`assignmentScopes`、`roleDefaultScopes`、`baselineGrants`，缺失时回退 v1 `subjectRoles.assignmentId`、`rolePermissions`、`subjectRoleScopes`、`roleScopes`、`baselinePermissions`，并将用户 direct 角色、active 部门/职位 membership 继承角色和 assignment scope 转换为同一授权关系内的 grant 调用范围 evaluator；`baselineGrants` 由 Platform 全局治理表 `platform_baseline_permissions` 管理并投影到每个租户 bundle，当前不是 tenant-scoped 配置。租户差异继续通过角色授权、模板绑定和 `templateOverrides` 表达，override 不得改写或借用 baseline grant 的权限/范围；全局排除表投影的 `excludedSubjectCodes` 会同时被 Console 普通权限快照、Console scoped authorization 和 Foundation helper 过滤，使指定 uid/subjectCode 不获得默认登录权限。历史静态 baseline 清单仅作为未迁移 fallback。Foundation scoped evaluator、Console 扁平权限检查和 scoped authorization 会消费 v2 `actionImplications` 构造 `@hzy/authz-core` action policy，缺失时保持 core 默认保守蕴含；应用 manifest 可用资源级 `actionImplications[{resourceCode,action,implies}]` 声明自定义蕴含，Platform 合并到 bundle，Console 以 `actionPolicies[resourceCode]` 随普通/scoped 快照下发，Foundation 白名单归一化后透传给业务 helper。业务模块不得自行维护 `view/edit/admin` 层级或应用专属蕴含表。Console 权限快照同样优先读取 v2 `roleAssignments` / `rolePermissionGrants` / `baselineGrants`，并按 active 部门/职位 membership 继承主体授权；Console 普通权限快照、scoped authorization 快照和 Foundation 业务应用授权 helper 会透传 v2 `policyRevision`。`policyRevision` 由 Platform `tenant_environment_policy_revisions` 按 `(tenant_code, environment)` 单调状态表生成（旧 `tenant_policy_revisions` 仅作迁移基线），并在 `policy_bundles.policy_revision/policy_hash` 中快照；Console/Foundation/业务应用不得自行递增或改写。Console current-user 实例冲突解释会在已验签 bundle 含 active v2 `conflictRules` 时优先通过 Foundation `explainPolicyBundleInstanceConflicts()` 本地计算，旧 bundle 或本地解释不可用时才回退 Platform internal API。Platform 提供 `buildDbAuthorizationGrants()` / `evaluateDbAuthorization()` / `DbGrantSource` 从 DB 形态构建同一授权单元并调用 `@hzy/authz-core`。Platform tenant-admin 还提供 `/api/platform/tenant-admin/authorization-explain` 和 `/api/platform/tenant-admin/instance-conflict-explain`，用于管理员诊断授权命中、范围拒绝以及实例级自审批/同人经办审批风险；运行时业务消费必须经 Console `/api/auth/instance-conflict-explain` 或 `/api/v1/console/user/instance-conflict-explain`，并由 Foundation `loadInstanceConflictExplanationFromConsoleRuntime()` 调用。现有 Console 与业务应用扁平 `checkPermission` 路径不得直接把 assignment scopes 合并进全局 scope，业务 API 需要对象上下文时应显式调用 scoped helper 或实例冲突解释 helper。
- Cloudflare 共享 Console 启动时不执行 subject sync、heartbeat 或 license token 校验；subject sync 改为在带可信 Tenant Gateway 租户上下文的目录同步请求中执行，并可由目录同步页“同步到 Platform”重试。PM2 / 私有单租户仍可执行 heartbeat 与 license token 校验，但所有部署都不再由 Console 从 Platform 拉取并直写 `org_profiles`；企业资料由 Tenant Runtime schema/init 和 `/v1/console/profile` 唯一管理。
- `applications.homeUrl/callbackUrl` 的运行态值由 Platform 生成 bundle 时解析：`homeUrl` 使用当前环境的 `deployment_sites.public_url + deployments.base_path`，为空时才回退到 `platform_applications.home_url`；`callbackUrl` 优先使用应用默认 `callback_url`，为空时按最终 `homeUrl + /api/auth/oidc-callback` 自动生成。manifest 的 `entry.web` 只作为源码声明，不作为客户最终访问地址。
- Foundation 的业务应用 startup activation 默认关闭：Platform activation、bundle 刷新和 heartbeat 只由 Console 执行。Foundation `consoleRuntime.ts` 在业务应用启动时向 Console 拉取 app runtime config；legacy `/api/platform-activation/*` 仅保留为迁移期诊断入口。
- Foundation 默认通过 Console OIDC 门面接入客户侧 Auth Runtime：前端 `useAuth` 消费 `hzy_*` token/session Cookie，服务端通过 Console JWKS 验证 access token 并注入 `event.context.consoleAuth`。OIDC private key、Session、Refresh family 和 token state 只由 Tenant Runtime 持有。`HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才回退旧 CAS/Account bridge。
- Foundation 默认启用轻量 RUM client，向当前租户域 `/api/rum` 上报页面加载、Web Vital、同源 API 耗时与 JS 错误；tenant gateway 会转发到 Observability Worker。RUM 明细不进入业务数据库，不采集 Cookie、Authorization、请求体、用户输入或 URL query/hash。
- 企业应用之间的服务调用使用 Console service-token 门面：调用方通过 Foundation `requestServiceAccessToken()` 获取短期 `token_use=service` JWT，实际 client/credential/grant 校验、签名和 introspection 均由 Tenant Runtime Auth adapter 完成。业务应用和 Console env 不保存跨模块 client secret 或 signing private key。目标应用先验证 Console JWKS、`aud`、`token_use` 与 exact `scope`，再通过 Console `/oauth/introspect` 门面确认 token 仍绑定 current credential、active service client 和完整 active grants。托管云目标 Worker 的 introspection 必须使用 `HZY_CONSOLE_SERVICE` Cloudflare Service Binding 直达 Console；不得由后台 Worker 公网 fetch `console.huizhi.yun` 或租户 Console 域名，否则无浏览器国家上下文的子请求可能在到达 Console 前被 zone WAF 拒绝。托管云业务 Worker 对 Console 的 request-bound service API（包括运行参数读取和通知发布）同样必须通过 Foundation `fetchConsoleServiceJson(event, ...)` 使用 `HZY_CONSOLE_SERVICE`，并用 `trustedServiceRequestHeaders(event)` 仅转发已验证的 Tenant Gateway 与 Data Runtime bootstrap 上下文；不得只携带 `Authorization` 重新进入 Console 公网入口，否则 Console 无法建立 tenant-runtime 绑定。Console 自身仍使用 Nitro local fetch 避免 Worker 自调用环。明确 inactive 返回 401；Runtime/introspection 网络、超时或 5xx 失败关闭并返回可重试 503。可靠投递遇到目标 401 时淘汰缓存 token、强制刷新且只重试一次。Tenant Runtime 的 JWKS 缓存遇到未知 `kid` 必须在带冷却保护的前提下主动刷新一次，使 Console 密钥轮换立即生效且不开放无界刷新。签发时 `tenant/deployment/source_app/target_app` 必须来自已验证 Gateway/Runtime enrollment，多个兼容 claim 冲突必须拒绝；禁止 `credentialId=0`、通用管理员 scope 或 Console DB fallback。Runtime 的通用签名入口不得只校验 claim 形状：`token_use=service` 在签发前必须确认 credential 为 current/active 且请求的每个 scope 都有 active grant，`token_use=access/id` 必须按 `sid` 解析出未撤销、未过期的会话，并要求 `sub` 与 `hzy.uid` 同时与该会话一致。持有签名 capability 只代表可以请求签发，不代表可以断言 Runtime 无法核实的 subject、session 或 scope；不满足时返回 403，不得延后到 introspection 才发现。
- Codocs 文档共享用户选择器、批量协作者名称补全、部门名称补全与当前用户兼容视图统一通过 Codocs BFF 调 Console `GET /api/v1/console/service/directory/users`，使用 `aud=console`、精确 capability `console:directory-users:read`、`token_use=service`、`target_app=console` 与 tenant 绑定。批量读取用服务端生成的 `uids` 查询，部门投影只返回编码、名称和父子关系；Console 的用户投影只返回 `uid`、姓名、头像、部门和岗位等共享识别字段，不返回手机号、邮箱或目录管理字段；浏览器 Cookie、普通员工的 `directory_users:view` 和 Codocs 自身高权限身份均不能替代该服务授权。
- People 员工页的共享部门树沿用同一个受限投影：People BFF 必须先建立已验证用户会话，再由 People runtime 使用 `aud=console`、精确 capability `console:directory-users:read` 调用 `GET /api/v1/console/service/directory/users?projection=departments`。该 service grant 只允许读取最小共享字段，不形成 Console 应用 entitlement，也不能用 `console:directory_operator` 等人类 UI 角色替代；初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.79-people-directory-sharing-read-grant.sql` 提供。
- Aims 项目协作页的用户列表也沿用该受限投影：Aims BFF 必须先建立已验证用户会话，再由 Aims runtime 使用 `aud=console`、精确 capability `console:directory-users:read` 调用 `GET /api/v1/console/service/directory/users`。Console 共享端点必须透传 `page` / `pageSize`（runtime 单页上限 100），Foundation BFF 对业务页面请求的较大姓名映射窗口自动分页合并；响应仅含 `uid`、姓名、头像、部门和岗位等共享识别字段，不返回手机号、邮箱或目录管理字段；`project_member` 等人类角色不获得任何 Console 应用权限，初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.80-aims-directory-sharing-read-grant.sql` 提供。
- Aims 项目仓库关联选择器先通过 self-bound Directory 用户项目合同验证当前 UID 对 `parentId` / `parent_id` 指定 Git 群组的精确访问权；不得改回全局项目注册表，也不得由浏览器自报 UID 或其他群组扩大范围。授权通过后，Aims 使用 Console tenant-runtime 受控 `gitlab.group-projects` fixed operation 实时、稳定排序并自动分页读取该群组全部直属仓库，并在 GitLab 上游查询中排除归档仓库，不以可能滞后的 Directory 仓库注册表作为候选清单。Directory Runtime 的父群组过滤与直属子项目权限继承仍作为通用合同保留。
- Aims 项目表单所需的租户业务领域字典不得借用 Console `org_profile:view` 人类权限。Aims BFF 必须先建立已验证用户会话，再由 `aims.runtime` 使用 `aud=console`、精确 capability `console:business-domain:view` 调用 `GET /api/v1/console/service/business-domains`；Console 在校验 active credential、exact grant、target app 和 tenant binding 后，才以自身 Runtime 身份读取 `/v1/console/business-domains`。初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.85-aims-business-domain-read-grant.sql` 提供，不产生 Console 菜单 entitlement。
- Altoc 页面按 UID 展示负责人、经办人和审计操作者时同样使用该受限投影：Foundation 将业务侧 `GET /api/directory/users/{uid}` 收敛为 Altoc runtime 持有 `aud=console`、精确 capability `console:directory-users:read` 的 `uids` 查询，并把最小共享数组还原为单用户响应。销售、商务等人类角色不获得 Console UI 目录权限；初始化 grant 由 `console/docs/sql/Console-SQL-Seed-v1.81-altoc-directory-sharing-read-grant.sql` 提供。
- Workflow 在创建、预检、重新提交审批实例和校验任务委托人时也沿用该受限投影：Workflow BFF 必须把当前 `H3Event` 传给 Foundation，由 `workflow.runtime` 使用 `aud=console`、精确 capability `console:directory-users:read` 读取发起人、部门及上级部门的最小共享字段，用于冻结审批人上下文。目录认证、授权或依赖故障必须失败关闭，不得返回空用户/部门并伪装成“未解析到审批人”；该 service grant 不产生 Workflow 操作者或审批人的 Console UI 权限，初始化与发布前核验分别使用 `console/docs/sql/Console-SQL-Seed-v1.96-workflow-directory-sharing-read-grant.sql` 和 `console/docs/sql/Console-SQL-Verify-v1.96-workflow-directory-sharing-read-grant.sql`。
- Codocs Issue 项目范围解析通过 `GET /api/v1/console/service/directory/project-access`，使用精确 capability `console:directory-project-access:read`。Codocs 先从已验证浏览器会话派生 `actor_uid`，Console 只返回指定项目的负责人、部门祖先编码和该 actor 是否为项目成员，不返回项目列表或成员清单。两项初始化 grant 均由 `console/docs/sql/Console-SQL-Seed-v1.56-codocs-directory-user-read-grant.sql` 提供。
- Console 零直连切换门禁的历史投递/同步阻断项只允许通过 Tenant Runtime 的受控处置接口处理：`GET /v1/console/cutover/dispositions` 要求 `aud=data-runtime`、`source_app=console` 与精确 capability `console:cutover-disposition:view`；`POST` 要求独立的 `console:cutover-disposition:manage`、`Idempotency-Key`、变更单号、逐条 `expectedSourceFingerprint` 和状态限定的 reason code。Runtime 在同一事务中锁定仍处于阻断状态的源记录，核对覆盖状态、尝试次数和更新时间的 SHA-256 指纹，追加 `console_cutover_dispositions`、操作日志和 mutation receipt；不得删除或改写原失败记录。门禁仅忽略 `status=active` 且指纹仍与当前源状态完全相等的处置；任何相关源字段变化都会使处置失效并自动恢复阻断。重复评审只把旧处置标记为 `superseded`，历史证据必须保留。活动 service client 的凭证完整性禁止豁免；重复的无凭证 legacy identity 只能通过 `POST /v1/console/cutover/service-clients/{id}/retire` 和独立 capability `console:cutover-service-client:retire` 受控停用。该操作必须先锁定源记录并核对覆盖关联凭证/Vault 指针的指纹，再验证同 app 已存在 active、凭证/Vault 完整且拥有 legacy 全部 active grants 的替代 identity；原行只改为 `inactive` 并保留 receipt 与操作日志。
- 企业应用之间的服务端调用不得使用浏览器入口 `homeUrl`，也不得要求租户在 Console 中配置目标应用服务地址。`homeUrl` 只用于浏览器导航。Tenant Gateway 从已解析的租户注册表生成不含 secret 的 `x-hzy-service-routes`（目标 Worker origin、目标 deployment、base path），覆盖浏览器同名头并与 Gateway token 一起建立可信边界；托管云 request-bound BFF 必须通过 Foundation `serviceAppFetch(event, appCode, url, options)` 使用渲染配置中同名的 `HZY_<APP>_SERVICE` Cloudflare Service Binding 直达目标 Worker，URL 可由 `resolveServiceAppBaseUrl(event, appCode, { directTarget: true })` 解析，并用 `trustedServiceRequestHeaders(event, appCode)` 将 app/deployment/prefix 原子改写为目标应用。没有 route catalog 的可靠后台回调可以由 `serviceAppFetch(null, ...)` 回到受信 tenant host，但 Tenant Gateway 必须对已绑定的目标应用使用 Cloudflare Service Binding 直达 Worker，不得再 fetch 同样被通配 Gateway route 覆盖的目标公网域名形成二次 Gateway 跳转。这样不得在 Gateway 同步等待来源 Worker 时重新请求同一 tenant host，也不得沿用来源 deployment。缺少可信目标路由时失败关闭；本地开发仍可由运营级 service URL 或端口表解析。
- Console session 每次鉴权仍实时读取 active session 与 active Directory 用户，撤销语义不做长缓存；`last_seen_at` 仅用于活动时间展示，最多每 5 分钟写回一次，不得让同一页面的每条 API 请求都产生一次 Hyperdrive UPDATE。
- Directory Runtime 向 Platform 分块投影 subject 前先携带完整、排序稳定的 `snapshotHash`；Platform 对当前 deployment 已为 `healthy` 且 hash 完全相同的首块返回 `unchanged`，data-runtime 必须立即停止后续块，不得每 5 分钟对未变化的 LDAP 全量快照重复执行 Platform 事务写入。hash 变化、首次同步或上次同步非健康时仍执行完整投影并在 finalize 后更新 reported hash。
- Console Directory 与 Platform 控制面统一使用项目主体类型 `project`，不得映射为表示岗位的
  `job`。项目父子关系同步为 `project → project`，用户项目成员关系同步为
  `user → project`，角色映射固定为
  `owner → leader`、`admin → manager`、`viewer → observer`、其他为 `member`。
  Platform 仅保存授权所需的脱敏最小投影，不在通用主体目录 UI 展示项目，也不把项目 membership
  当成部门/岗位角色继承；项目授权优先使用 `project:member|owner` 动态关系。Platform 不得将该投影
  反向作为 Console Directory 事实源，GitLab 项目注册信息也不得因进入最小投影自动获得企业角色。
- Console vault 凭证按 `integration / service / bootstrap / custody` 分类管理。Nuxt 业务模块不得直接依赖 `integration_credentials`、内部 credential id 或 `/vault/resolve`；外部集成能力必须通过 Foundation adapter 按 `integrationCode` 消费。程序化 resolve 只接受 service caller 的 `integrationCode`，服务端以当前 active `integrations → integration_credentials → 固定 vault version` 绑定解析；调用方不得传 `secretRef`、version 或 purpose。`service_client_grants.scope_json.integrationCodes` 是实际执行的精确 allowlist：必须同时匹配已验证 client ID、source app、`credential_vault:resolve` grant 和 `usage_type=integration / owner_type=integration / owner_key=integrationCode`，缺失或通配 scope 均失败关闭。服务身份读取 integration 配置也使用相同 allowlist。`connector-runtime` 是由 Console enrollment 创建、绑定到该 Console deployment 的单租户 supporting service，不在 Platform 创建伪应用 deployment；业务应用调用 Connector 时，Runtime 必须验证签名、introspection、tenant、audience、exact scope 和 body `sourceAppCode` 与令牌来源一致，并保留令牌中受信的来源 deployment 用于 ledger/audit，但不得要求该来源 deployment 等于登记 Connector 的 Console deployment，否则 Aims/People 等同租户业务部署无法使用共享 Connector。Connector 直达 Tenant Runtime 时仍保留 `source_app=connector-runtime`，Data Runtime 只在没有更精确显式绑定时使用已注册的 Console deployment 校验其 token，tenant、audience、service credential、grant 与 exact scope 校验均不放宽。`custody` 托管凭证默认只能授权 reveal，不能被程序化 resolve。
- Env 收敛规则：Console 是唯一直接消费 `HZY_PLATFORM_*` 与企业级集成 secret 的企业端基础运行模块；业务应用优先只保留自身数据库、应用身份和 base path，不再新增 app 级 `license.lic`。`HZY_CONSOLE_API_URL`、`HZY_WORKFLOW_API_URL`、`HZY_ACCOUNT_API_*`、`ALIYUN_OSS_*`、`GITLAB_*`、`WECOM_*` 等平台级配置不得在新业务模块中新增，迁移期存量项按 [`ENV_SIMPLIFICATION_PLAN.md`](ENV_SIMPLIFICATION_PLAN.md) 逐步清理。

### 项目治理唯一角色持有人契约

- Platform 企业角色 `project_director` 与 `qa` 均固定为 `max_active_assignments=1`、`subject_type_constraint=user`。约束同时物化到 `tenant_roles`；通用授权写入必须在锁定角色行后检查任期重叠，不能以直接授予绕过。
- 系统管理员更换持有人使用 Platform `PUT /api/platform/tenant-admin/role-holders/{roleCode}`。该命令要求租户 owner、可选 `expectedRevision`，在一个事务内撤销旧有效授权、写入新用户授权并递增 `tenant_role_holder_revisions`；不授予系统管理员任何 Aims 审阅、QA、发布或审批业务动作。
- Platform policy bundle 输出 `roleHolderRevisions[{roleCode,revision,updatedAt}]`，并继续用当前有效 `roleAssignments` 输出持有人事实。角色授权变化会改变 bundle hash 和全局 `policyRevision`。
- Aims 与 Workflow 通过 Console `GET /api/v1/console/service/authorization/role-holders?roleCodes=project_director,qa` 读取当前持有人。调用令牌要求 `aud=console`、精确 capability `console:authorization-role-holders:read`、`token_use=service`、current credential/grant 及 tenant/deployment/target app 绑定；接口只允许这两个 role code，`Cache-Control=no-store`，忽略角色/用户模拟。托管模式每次先用固定 `hzy-policy-revision.v1` 探测当前修订；只有未变、已验签 Console 信封仍有效且距接收不满 20 分钟时才直接读取，修订变化或超龄必须刷新完整信封并验签，探测/刷新失败返回 503。修订响应不单独构成授权依据。
- 每个角色返回 `revision/policyRevision/status/errorCode/holders`；`holders[].uid` 必须是用户主体 `subjectCode`（即 Console 会话和业务应用使用的稳定 UID），不得使用仅标识上游目录同步记录的 `externalRef`。只有 `status=resolved` 且恰好一个 holder 时调用方可以执行敏感业务动作。0 人返回 `role_holder_missing`，多人脏数据返回 `role_holder_ambiguous`；调用方不得回退管理员、历史人员或数组第一项。初始化授权见 Console v1.87 seed/verify。

### Aims 项目责任与周报周期契约

- Aims 项目创建的 `leader_uid` 为业务必填项；浏览器创建和 Altoc 合同激活创建均不得以 `created_by`、系统管理员或第一个成员兜底。expand 阶段 runtime 先拒绝空值，待 preflight 的空负责人项目全部人工修复后再执行数据库 `NOT NULL` contract。
- `project_lifecycle_events` 是项目周报应报口径的追加式事实。项目创建与状态更新必须和项目主记录在同一事务写入事件；v5.6 迁移只为既有项目写一条按 `created_at` 生效的基线，不回算无法证明的历史周期。
- 代理项目经理使用 `project_manager_delegations` 保存不可变任期。只有当前唯一 `project_director` 可任命或撤销；代理必须是该项目 active 成员，同一项目有效任期不得重叠。周报操作时以“有效代理优先，否则正式 `leader_uid`”解析责任人，系统管理员和普通 `role=manager` 成员均不能代填。
- `weekly_reporting_settings` 每公司一条，配置 timezone、截止时间、汇总目标、提醒、RAG 参数、rollout mode 和单调 `config_version`。只有 `weekly_reports:configure` 可修改；该权限不隐含审阅、代理任命或发布。
- `weekly_reporting_periods` 保存自然周起止、截止和当时配置快照；`weekly_report_obligations` 对每周期/项目唯一，并保存正式/代理责任人、责任类型和项目状态快照。`pilot` 只纳入有效试点项目，`company` 纳入周期内曾 active 的项目；截止后义务进入 `deadline_frozen`，后续负责人或状态变化不得改写。
- Aims BFF 必须删除客户端传入的 `current_user_is_project_director`、`current_user_can_configure_weekly_reports` 和 `current_user_can_submit_weekly_report`，再以 normal-merged 当前授权重建；data-runtime 在数据库访问前检查这些受信上下文，并继续叠加项目关系、代理任期和对象状态。
- Enterprise Host 周报设置（代码候选，待发布）：`GET/PUT /aims/api/v1/admin/weekly-reporting-settings`（`enterprise/server/utils/enterpriseAimsWeeklyReportingSettings.ts`）只按已验证会话的 `weekly_reports:configure` 放行（不借 `admin:admin` 或 review），丢弃调用方自带治理标志与 actor，写入 `current_user_can_configure_weekly_reports=1`，经 Foundation `aims.weekly-reporting-settings-view|update` → Runtime `POST /v1/enterprise/aims/weekly-reporting-settings:view|update`（`aims:enterprise-host:execute`，人员许可 `weekly-reporting-settings/configure`，拒绝范围键与各类 ID）。PUT 只接受白名单整体替换字段，浏览器每个保存意图一个稳定 `Idempotency-Key`（结果未确认时原键重试），Host 派生 `aims.weekly-reporting-settings:<key>` 且 Runtime 要求该头；Runtime 单行 upsert 按内容收敛，但无 CAS 与回执表，同键重放会再次递增 `config_version`，并发保存以最后一次为准。页面 `/aims/admin/weekly-reporting-settings` 复用 Aims 原页面并贡献至“控制台 → 业务配置”（`weekly_reports:configure`）；独立 Aims API 仍叠加 `/admin/**` 的 `admin:admin`，两入口的差异仅在此。周报页把总监工作台 409 `weekly_reporting_period_required`（及旧 404）视为“应报清单未生成”，生成遇 `weekly_reporting_not_configured/disabled` 时提示并对有配置权限者给出设置入口。不新增 grant、manifest 资源或 Console seed。
- Enterprise Host 全局周报治理桥（`enterprise/server/utils/enterpriseAimsWeeklyGovernance.ts`，12 个 `aims.company-weekly-summary-*`、`aims.weekly-reporting-period-*`、`aims.weekly-report-review/open-correction` 操作）与独立 BFF 同一口径：丢弃调用方自带的治理标志，按已验证会话的 `weekly_reports:review/configure` 设置 `current_user_is_project_director` / `current_user_can_configure_weekly_reports`；总监命令、公司汇总（含查看/版本/publish/retry）与“仅总监”的周期生成再经 Foundation `projectGovernanceRoleHolder` 读取 Console 当前唯一 `project_director`，非持有人 403、0/多人 409、依赖故障 503，并写入新鲜 `current_user_project_director_revision`；总监工作台只按 review 权限放行。Runtime 已为这 12 个 action 登记精确 `QueryKeys`；Host 服务客户端 `enterprise.runtime` 的 Console `console:authorization-role-holders:read` 精确 grant 以目标环境 grant verify 为准（v1.87 seed 只覆盖 aims/workflow）。
- Enterprise Host 公司汇总发布编排（代码候选，待发布；不新增 capability、grant、manifest 资源或 schema）：
  - Host `:publish` 以同一授权上下文先读 Runtime `company-weekly-summaries:view` 投影，只按其中的抄送选择经 Foundation `fetchConsoleDirectoryApi`（`enterprise.runtime` 既有 `console:directory-users:read`）展开为 active UID 快照，之后才写入 `company_summary_recipient_resolution_verified=1`（Runtime 只在 `publish` action 的 `QueryKeys` 放行该键，其它 action 带上即 400；Host 丢弃调用方同名键）。浏览器正文只取 `correctionReason`，`resolvedRecipients/coveredSelectionKeys` 仅由 Host 生成，Aims 仍按冻结选择逐项核对覆盖。`:retry`/`:cancel-publish` 不转发浏览器正文。目录失败 503、清单失效 409、未生成 409。
  - Runtime `routeEnterpriseDelegated` 对 `publish/retry/cancel-publish` 注入受信上下文标记（`aimsapp.WithEnterpriseCompanyWeeklySummaryOutbox`），Aims 据此以已登记写入绑定的 tenant、正式 Aims worker deployment（`deploymentBindings.aims`）、`source_app=aims`、`aims.runtime` 与注册 outbox 物理表写入/定位 `aims.company-weekly-summary.codocs-publish.v1` operation，不读 payload 保留键；未配置 Enterprise writer 或 worker 时 503 失败关闭。独立 BFF 路径（服务端注入保留键）保持不变。发布事务本身按汇总状态机防重（非 draft/correction_draft 即 409），operation key 为 `aims:company-weekly-summary:{period}:r{revision}:publish:v1`。
  - 投递沿用既有 outbox：统一调度上的正式 Aims worker（`aims:integration_operation:execute`、generation 绑定）claim 后经新增 `POST /v1/enterprise/aims/integration-operations:company-weekly-summary-publish-content` 读取不可变 Markdown（闭合 body `{operationKey, summaryVersionId, markdownSha256}`；必须是本 worker 未过期的 processing 租约且命令冻结的版本/hash 一致），再调用 Codocs `codocs:company-weekly-summary:publish`，最后 `integration-operations:succeed`。succeed 在同一事务发布汇总、写 fact snapshot，并把 `review_route=company_summary`、`review_status=submitted`、`locked_report_version_id` 属于本版本 `included` 项的项目经理职责工时置为 `approved`（`approved_summary_version_id` 为本版本，追加 review event）；其它路由、未纳入版本与草稿不受影响（`enterprisescheduler` 隔离 MySQL 测试）。宿主请求内不同步投递，返回 `delivery.pending=true`。
  - 环境启用前仍需：统一调度 worker 定时 owner 已恢复、`aims.runtime` 的 `aims:integration_operation:execute` 与 Codocs `codocs:company-weekly-summary:publish` grant verify、Codocs 独立 Service API 可达；未核验前不得宣称发布链路在环境生效。

### Console 统一员工入口展示契约

SSO 落地后，企业员工统一入口由 `console` 承接。入口展示契约如下：

- Console 前端通过 `/api/user/applications` 获取当前用户可见应用。
- `/api/user/applications` 的权威过滤依据是 Console 本地已验签 policy bundle 中的角色、模板、覆盖与 `applications` 投影。
- Console 可按需调用 Platform runtime applications 做实时应用入口刷新，但不得绕过本地授权过滤。
- 业务应用通过 Foundation 接入 Console OIDC；应用卡片跳转到 bundle 下发的 `homeUrl`，目标应用本地无 session 时再发起 OIDC authorize redirect。
- Console 会话桥接走与 OIDC 相同的 Binding 路径，不再从业务 Worker 通过公网域名读取 Console auth/me 或 session API。请求内 OIDC 校验可以按相同身份及网关上下文合并，但不得把会话有效结果复用到另一个 HTTP 请求。
- 当前用户文档水印的手机号尾号通过 Console `/api/v1/console/auth/me` → Foundation `/api/directory/me` 的本人会话链路读取：仅返回验证过的 `mobileTail4` 四位数字或 `null`，不暴露完整手机号，不扩展跨应用共享用户投影，不依赖登录时 Cookie 中的旧资料。
- OIDC 后端换票、刷新、userinfo 和 JWKS 在具有 `HZY_CONSOLE_SERVICE` 时走 Binding，不因绑定失败重试公网。换票保留来源部署上下文；userinfo/JWKS 通过受信 route helper 原子切换到 Console 的 app/deployment/prefix。authorize 的浏览器跳转保持公网地址。JWT issuer/audience、会话撤销校验不变；JWKS 缓存隔离 issuer、endpoint、传输类型和网关上下文，容量上限 64，不跨请求缓存会话有效性。
- Console 只做应用级可见性过滤；业务应用必须继续做自身页面级和资源级权限校验。

详细方案见 `console/docs/Console-Unified-Employee-Portal-Plan.md`。

## API 调用矩阵

说明：矩阵中的 `Account` 列/行仅代表迁移期 legacy 兼容路径；新服务端调用应优先使用 Console service token、Console Directory API、Foundation adapter 和目标应用 service API。

```
             Account  Codocs  Aims  Altoc  Assets  Finance  Workflow  Align
Account        —        ×      ×      ×      ×       ×        ×         ×
Codocs         ✓        —      ×      ×      ×       ×        ✓         ×
Aims           ✓        ✓*     —      ✓**    ✓       ✓        ✓         ✓*****
Altoc          ✓        ✓      ×      —      ×       ✓        ✓***      ×
Assets         ✓        ×      ✓      ✓****  —       ✓        ✓***      ×
Finance        ✓        ×      ✓      ✓      ✓       —        ✓         ×
Workflow       ✓        ×      ×      ×      ×       ×        —         ×
Align          ✓        ✓****** ✓***** ✓******* ×      ×        ✓         —
Insights       ✓        ×      ×      ×      ×       ×        ×         ×

✓  = 已实现    ✓* = iframe 嵌入    ✓** = 计划中（API 桥接）
✓*** = 计划中  ✓**** = 计划中（客户/合同引用）
✓***** = 计划中（项目/任务协同关联）    ✓****** = 计划中（纪要/公告文档引用）
✓******* = 计划中（客户/合同上下文引用）
```

## Account API 契约（迁移期）

**Base URL**: `{HZY_ACCOUNT_API_URL}/api/v1`
**认证**: `Authorization: Bearer {api_key}:{api_secret}`

定位：

- 当前已实现目录读取与部分登录/审计能力仍由 Account 提供。
- 目标架构下，新增目录能力优先落到 `console.directory-runtime`。
- Foundation 的新目录 adapter 只支持 `console` provider，不提供 Account fallback；未迁移的旧 `/api/account/**` 兼容路由可继续直连 Account。
- Console 自身已不再要求 `HZY_ACCOUNT_API_*` 配置；登录审计写入本地 `auth_login_events`，启动资源同步也不再上报 Account。

尚未迁移的 legacy 模块通过以下环境变量配置：
- `HZY_ACCOUNT_API_URL` — 不含 `/api/v1` 后缀
- `HZY_ACCOUNT_API_KEY` / `HZY_ACCOUNT_API_SECRET` — 在 Account 管理后台创建

常用端点：
- `GET /users` — 用户列表
- `GET /users/{uid}` — 用户详情
- `GET /departments` — 部门树
- `GET /projects` — 项目注册表

详细接口定义：`account/docs/ACCOUNT_API_SPEC.md` 或 `http://localhost:3000/openapi.json`

## Workflow API 契约

**Base URL**: Console 运行时参数 `workflow.apiUrl` 对应服务的 `/api/v1`
**认证**: 业务前端经 Foundation `/api/workflow-proxy/**` 转发用户请求；服务端同步与回调使用 Console service token。
**业务应用 → Workflow**: Foundation proxy 必须先在本应用内验证浏览器用户身份，再以本应用 runtime service client 请求 `audience=workflow`、`scope=workflow:proxy` 的短期 token，通过租户中立 Workflow service origin 调用目标 Worker，并通过 `x-hzy-actor-uid` 传递已验证用户 UID。Foundation 用服务端 `public.appCode` 覆盖 query `request_app_code`，同时写入 `x-hzy-request-app-code`；缺 appCode 失败关闭。Workflow 只在服务令牌校验通过、精确包含 `workflow:proxy`、且 token 的 `source_app`（`hzy.appCode`）与该受信 header 完全一致时接受代理 actor；`workflow:invoice-request:create` 只能走 Finance receipt-only service endpoint，不能作为通用代理 actor scope。Workflow 再以 `service-client-policy` 获取自身精确 `<tenant>-workflow` deployment 的 data-runtime token，重签并绑定 source app、tenant、deployment、HTTP request target 与时效；来源应用 deployment 只保留在来源身份中，不能成为 Workflow runtime token deployment。Workflow runtime 的用户关系读取和 `/instances/prepare|instances` 写入只接受该签名 actor，忽略浏览器 body/query 的 `current_user`。审批 GET 只读取任务/实例，不得触发全局 actionable lifecycle outbox 排空；outbox 只作为写命令成功后的后续动作。

**Codocs 发布申请 → Workflow**：`POST /api/reviews/publish-requests/{id}/workflow-instance` 不是浏览器 Workflow proxy。Codocs 只可在已验证发起人和 `reviews:submit` 后，以锁定的 `document_publish_requests + documents` 重新构造固定命令；`source_app=codocs`、`target_app=workflow`、`aud=workflow`、capability=`workflow:document-publish:create`、`operation_code=codocs.publish-request.workflow-submit.v1`、`documents/publish`、相对 callback `/api/reviews/workflow-callback` 及 `publish-request:{id}` 业务键均不得由浏览器覆盖。请求 ID 派生稳定 operation/idempotency identity；Workflow 在同一事务写实例和 `service_command_receipt`，同键同 hash 恢复、异 hash 409；重试由 receipt 已固定的 `instance_no` 恢复该 Workflow 实例 ID，而不接受调用方提交实例 identity。Codocs 仅在已验证 receipt 的实例 identity 与固定命令一致后回写本地 binding。终态 callback 仅接受 `aud=codocs`、`scope=workflow:callback`、来源 `workflow` 的 service token；在读 body 前必须将 token tenant/deployment 与可信 `x-hzy-tenant`/`x-hzy-deployment` 精确绑定，并只把已绑定 instance 的 `approved/rejected/cancelled` 状态写入 runtime；不接受 callback 的任意业务字段覆盖。 托管云提交必须用 `resolveServiceAppBaseUrl(event, 'workflow', { directTarget: true })`、`serviceAppFetch` 与 `HZY_WORKFLOW_SERVICE -> hzy-workflow` 直连，`trustedServiceRequestHeaders(event, 'workflow')` 传递可信 tenant/runtime 上下文并将 app/deployment/prefix 原子绑定到 Workflow；创建申请的部门目录查询必须显式传入同一 `event`，使用 Console Service Binding。禁止普通 `$fetch` 经租户公网入口重新进入 Gateway。

该 capability 的初始化/核验文件为 `console/docs/sql/Console-SQL-Seed-v1.51-codocs-workflow-publish-grant.sql` 与 `console/docs/sql/Console-SQL-Verify-v1.51-codocs-workflow-publish-grant.sql`；两者仅作为待批准环境变更输入，不创建 credential，也不得由代码自动执行。

Finance 入站 Service API 只接受各端点登记的精确 capability；`finance:*`、`finance:admin` 或写入宽 scope 不蕴含 `finance:invoice-request:create`。已有调用方使用 Console v2.1 grant seed/verify 核对精确授权，发布前重新签发实际组合 scope；本次不新增 capability 或调用方。

**Finance BFF → Finance tenant-runtime**：Finance 普通用户读写统一要求 Foundation runtime actor delegation；actor、部门、`current_user_*_access` 与项目/部门范围必须由 Finance BFF 先基于 Console scoped authorization 求值，再随完整 request target 进入 HMAC 绑定。Finance runtime 验证失败时不得使用 bearer service client、query 或 body 派生用户 actor/范围，并须在 SQL 前返回 403。`/v1/finance/service/**`、Workflow callback 与 Finance scheduled notification 是显式 actorless 服务合同，继续依各自 capability/来源/worker 约束执行，但必须清除同名浏览器 actor/范围字段；不得把 service client identity 提升为用户数据范围。三条 due-notification worker route 更进一步仅接受 `sub=client:finance.runtime` 的短期 JWT、`data-runtime:finance:notifications_due:execute` 精确 grant、tenant/deployment enrollment 与 request-target HMAC purpose `finance-due-notification-worker`；`finance.write`、static token 或任意其他 Finance caller 不能扫描或 ack checkpoint，且每条 route 只接受其固定 body 字段。

**Aims / Altoc / Assets / People scheduled due worker → tenant-runtime**：四模块的通知 checkpoint scan、ack 与 closure-ack 同样不是通用 `*.write` 服务路径。它们仅接受各自短期 JWT `sub=client:{aims|altoc|assets|people}.runtime`、精确 `data-runtime:<app>:notifications_due:execute` grant、tenant/deployment enrollment 和绑定完整 request target 的固定 HMAC purpose（`aims-due-notification-worker`、`altoc-receivable-due-notification-worker`、`assets-due-notification-worker`、`people-offboarding-due-notification-worker`）。static/disabled auth、普通模块 write token、任意其他 service client、未签名或错 purpose 的 actor assertion，以及 browser 注入 actor/tenant/lifecycle body 字段都必须在 adapter/SQL 前失败；Cloudflare cron 仍默认关闭，专用 client ID 仅在显式启用时要求为 `<app>.runtime`。初始化/核验脚本为 `console/docs/sql/Console-SQL-Seed-v1.49-due-notification-worker-grants.sql` / `console/docs/sql/Console-SQL-Verify-v1.49-due-notification-worker-grants.sql`，均未在任何环境执行。

**Aims / Altoc / Assets / Finance / People integration-operation worker → tenant-runtime**：可靠集成 operation 的 claim、drain、ack、fail 和受控恢复使用调用方自己的运行身份，并要求精确 `<app>:integration_operation:execute`；该单数 worker capability 与管理界面的复数 `<app>:integration_operations:view/replay` 完全独立，`<app>.write` 也不蕴含 execute。所有 worker grant 必须同时安装 `data-runtime` 与 `tenant-runtime` audience 版本。Aims、Altoc、Assets 使用 `console/docs/sql/Console-SQL-Seed-v1.92-integration-operation-worker-grants.sql` / `console/docs/sql/Console-SQL-Verify-v1.92-integration-operation-worker-grants.sql`，Finance 使用 v1.61 runtime grants，People 使用 v1.86 worker grant；启用 cron 前必须在目标租户执行相应 verify 和真实多 scope token 签发探测。

**Runtime 进程内调度（ADR-018a §3.3）**：显式本地配置 `enterprise.inProcessScheduler.enabled` 默认 false；仅 Aims unified scheduler 可启用。任务白名单本期只有 `aims.milestone.rollover`，内部固定主体 `system:enterprise-scheduler`，不得伪造 `SchedulerIdentity` 或借用 `aims.runtime`。扫描与每条滚转复用 owning Aims 命令，在 registry SHARE generation 栅栏事务内执行，操作人固定 `system`；代次改变立即停止剩余条目与本进程后续轮次，须受控重启。间隔默认 300 秒（60–3600），首次与每轮结束后等待间隔加最多 5% 抖动，每轮最多 100 条，串行单飞、退出取消且关闭连接池前等待停止。日志只含任务/系统主体、结果计数、固定errorClass、耗时、代次与UTC开始/结束时间。每轮由Console owning Adapter向既有operation_logs独立追加固定typed摘要（actor_type=system，固定系统主体，不写人员uid/业务ID）；不与滚转条目共用事务，不新增表/授权。即使取消也尽力记录，独立尝试最多3秒；Console未配置或写失败只记audit_unavailable与固定分类，不回滚/阻断滚转。错误轮次计数不可证明此前无条目提交，D7必须用权威snapshot对账且审计持久化无缺口。开关开启时 enterprise 和 legacy 两条 rollover-due 服务入口都返回 `409 aims_milestone_rollover_inprocess_owner`，Aims cron/drain 记 skipped；关闭保持下文旧合同。此内部调用不签服务令牌、不新增 capability/grant，不改变手工 rollover、到期通知或集成投递。代码合入不等于环境启用，停用 Aims 尚须完成其它入站/后台依赖迁移。

**Aims 周期里程碑滚动 → 统一 Runtime（ADR-018 INT-305 候选）**：当 Runtime 的 Aims scheduler 路径为 `unified` 时，唯一 owner 是 Gateway 签名 drain 唤醒。Aims Worker 在 `unified/recovered` 存储下完成 drain 后调用 `POST /v1/enterprise/aims/milestones:rollover-due`，使用 `aims.runtime` 运行身份、精确 `aims:milestone-rollover:execute`（与 `aims:integration_operation:execute` 互不替代）和 `X-HZY-Scheduler-Generation`；请求体只接受 `limit`（1–200）与 `carryover`（`auto/manual`），操作人、复盘豁免和 scheduled 标记由 Runtime 固定。扫描与每个里程碑各自在 registry SHARE 锁的 scheduler 事务内执行，generation 变化即停止剩余条目；缺少兼容视图时本入口 503。同一条件下 legacy `POST /v1/aims/service/milestones:rollover-due` 返回 `409 aims_milestone_rollover_unified_owner`，本地每日 cron 将其记为 skipped。Grant 见 `console/docs/sql/Console-SQL-Seed-v2.8-aims-milestone-rollover-grants.sql` / `Console-SQL-Verify-v2.8-aims-milestone-rollover-grants.sql`（`aims`、`data-runtime`、`tenant-runtime` 三个 audience）；启用前须在目标租户执行 verify 并实际签发该 scope 的 service token。候选代码不表示任何环境已启用。

**Aims 到期通知 → 统一 Runtime（ADR-018 INT-305 候选）**：同一条件下（Runtime Aims scheduler 为 `unified`），到期通知的唯一 owner 也是 Gateway 签名 drain 唤醒。Aims Worker 在 `unified/recovered` 存储下以注入的调用方执行既有 drain（仍受 `HZY_AIMS_DUE_NOTIFICATIONS_ENABLED` 开关、subject eligibility 与 Console 发布合同约束），调用 `POST /v1/enterprise/aims/notifications:scan-due|acknowledge|acknowledge-closure`：`aims.runtime` 运行身份、精确 `aims:notifications-due:execute`（与 outbox、rollover capability 互不替代，替代旧点号 `aims.notifications_due.execute` 在统一路径上的使用）和 `X-HZY-Scheduler-Generation`；请求体沿用 legacy worker 的封闭字段集。扫描的对账、事实查询、每个检查点、闭环列表以及 ack 各自在 registry SHARE 锁 scheduler 事务内执行；缺少兼容视图时 503。统一 owner 期间 legacy `/v1/aims/service/notifications:*` 返回 `409 aims_due_notifications_unified_owner`，本地 15 分钟 cron 记 skipped；Assets、Altoc、People 的同名 worker 不受影响。Grant 见 `console/docs/sql/Console-SQL-Seed-v2.9-aims-notifications-due-grants.sql` / `Console-SQL-Verify-v2.9-aims-notifications-due-grants.sql`；启用前须在目标租户执行 verify 并实际签发该 scope 的 service token。

**Assets 到期通知 → 统一 Runtime（ADR-018 INT-305 候选）**：Assets 没有 legacy 唤醒，因此以显式选择启用：仅当 Platform 租户记录持久化 `apps.assets.enterpriseScheduler.storage` 为 `unified/recovered` 时，Tenant Gateway 才签名唤醒 Assets Worker `POST /api/internal/integration-operations/drain`（其余情形不唤醒）；Foundation `requireTenantGatewaySchedulerRequest` 仅对 `aims`、`assets` 接受 storage 选择，签名覆盖 storage/generation。Worker 校验 tenant/deployment 与运行绑定一致后，以注入调用方执行既有 drain（页 50、每流 1 页、10 秒；仍受 `HZY_ASSETS_DUE_NOTIFICATIONS_ENABLED` 与 subject eligibility 约束），调用 `POST /v1/enterprise/assets/notifications:scan-due|acknowledge|acknowledge-closure`：`assets.runtime` 运行身份与 Runtime `enterprise.assetsDeliveryWorker`（部署须等于 Assets deployment binding）、精确 `assets:notifications-due:execute`（Aims 身份或 capability 均不通过）和 `X-HZY-Scheduler-Generation`；请求体沿用 legacy Assets worker 的封闭字段集。Runtime 以 Assets 域自身的 scheduler 绑定（无 outbox）开启 registry SHARE 锁事务，扫描、收件人补全、检查点、闭环与 ack 均在其内；缺少兼容视图 503。Runtime Assets scheduler 为 `unified` 时 legacy `/v1/assets/service/notifications:*` 返回 `409 assets_due_notifications_unified_owner`，本地 15 分钟 cron 记 skipped。Grant 见 `console/docs/sql/Console-SQL-Seed-v2.10-assets-notifications-due-grants.sql` / `Console-SQL-Verify-v2.10-assets-notifications-due-grants.sql`；启用前须在目标租户执行 verify、实际签发该 scope 的 service token，并在 Platform 写入 Assets scheduler 选择。

**业务应用 → Console tenant-runtime fixed integration operations**：GitLab/WeCom 固定操作使用复数 `integration_operations:execute`，与上述业务 operation worker 的单数 capability 不同。Console service token 签发必须同时存在 `data-runtime:integration_operations:execute` 与 `tenant-runtime:integration_operations:execute` audience grant；Runtime 收到 token 后还会按未加 audience 的 `integration_operations:execute` semantic grant 精确重验 `integrationCodes + operations`。Aims/Codocs 的 semantic policy 必须合并 GitLab 与 WeCom allow-list，后续 seed 不得用单一 integration policy 覆盖已有集合；Altoc/Assets/Workflow 仅保留 WeCom allow-list。存量 v1.82/v1.83 租户用 `console/docs/sql/Console-SQL-Seed-v1.93-fixed-integration-runtime-token-grants.sql` 修复，并以对应 v1.93 verify 确认两条 audience grant 齐全、Aims/Codocs GitLab policy 未被覆盖。Aims 实时群组仓库目录另要求 semantic grant 精确包含 `gitlab.group-projects`，存量租户使用 `console/docs/sql/Console-SQL-Seed-v1.98-aims-gitlab-group-projects.sql` 只追加该 operation，不覆盖已有 allow-list。

**Workflow → data-runtime**: Workflow 服务端访问 data-runtime 时使用 Console service token，`audience` 必须与 data-runtime 的 `HZY_DATA_RUNTIME_JWT_AUDIENCE` / `HZY_TENANT_RUNTIME_AUDIENCE` 一致。跨应用代理链路必须用 `source_binding=service-client-policy` 签发 `appCode=workflow`、`deployment=<tenant>-workflow` 的目标 token，不得复用来源业务应用的 gateway runtime token。若 audience 为 `data-runtime`，scope 使用 `data-runtime:workflow:read` / `data-runtime:workflow:write`；若 audience 为 `tenant-runtime`，scope 使用 `tenant-runtime:workflow:read` / `tenant-runtime:workflow:write`。data-runtime 将这些 audience-scoped scope 映射为内部 `workflow.read` / `workflow.write` 语义。

### 业务模块接入流程

1. **启动时同步动作定义**：`POST /action-defs/sync`
   ```json
   {
     "appCode": "aims",
     "actions": [{
       "resourceCode": "projects",
       "actionCode": "initiation",
       "name": "项目立项",
       "embedUrlPattern": "{app_base_url}/embed/{resource}/{biz_id}"
     }]
   }
   ```

2. **发起审批**：`POST /instances/prepare` → `POST /instances`

3. **接收回调**：Workflow 审批完成后携带 Console service token 回调业务模块；业务模块校验 `token_use=service`、`aud`、`scope=workflow:callback` 与来源应用 `workflow`

### Actionable notification 合同

Workflow tenant-runtime 产生的待办、通过、驳回、撤回、委派和重提通知必须携带 `metadata.targetAppCode/businessTargetAppCode`（均来自 `flow_instances.app_code`）、`bizKey={app_code}:{resource_code}:{biz_id}`、`workflowInstanceId/workflowInstanceKey` 和 `actionableKey`；涉及任务时还必须携带 `workflowTaskIds`，结果事件保留 action ID 及 task/instance identity，供后续关闭对应待办。顶层 `bizType/bizId` 使用原业务 `resource_code/biz_id`，不能退化为标题、URL 或时间派生键。

`flow_instances.biz_url` 只接受 `http/https` 绝对 URL 或单斜杠开头的站内路径。tenant-runtime 的语法校验不是导航授权：Workflow BFF 在调用统一通知入口前，必须用 Console runtime 下发的已验签 policy bundle `applications[].appCode/homeUrl/basePath/status` 和 Foundation shared resolver 将 URL 绑定到 `actionTargetAppCode`，生成 exact origin + home path 内的 canonical absolute URL；协议相对、凭据 URL、危险协议、反斜杠/控制字符、编码路径逃逸、未注册/inactive 应用、错 origin 或错应用 base path 一律拒绝。业务目标不匹配时必须改用 `/workflow/tasks/{taskId}` 或 `/workflow/instances/{instanceId}`，保持 `targetAppCode/businessTargetAppCode=flow_instances.app_code`，仅设置 `urlFallback=true`、`actionTargetAppCode=workflow`；若可信 catalog 中连 Workflow 自身也不可解析，则发布失败并保留 lifecycle/outbox 待重试。Console 对 `sourceAppCode=workflow` 的 publish 在入库和计算 canonical idempotency hash 前使用本地已验签 bundle再次复核；catalog 不可用稳定返回 `503 action_target_catalog_unavailable`，目标不匹配返回 `400 invalid_action_target`。本地开发只允许显式 dev application catalog，不按 appCode 合成浏览器目标。外部企业微信与站内通知必须复用同一 canonical URL，不能发送未绑定的原始 `biz_url`。

所有 Workflow 调用通过 Foundation 代理（`/api/workflow-proxy/`），自动注入 `request_app_code`。Enterprise Host pilot 构建经 `sharedApiPath` 使用 `/enterprise/api/foundation/workflow-proxy/**`（同七个精确操作，见“Enterprise Host 共享用户 API 基址”）。

详细接入指南：`foundation/docs/Workflow-Integration-Guide.md`

## Data Runtime 管理契约

**Base URL**: Console 运行时参数 `dataRuntime.runtimeApiUrl` 对应租户 data-runtime 服务根地址；Cloudflare / Tenant Gateway 可通过 `x-hzy-data-runtime-url` 或 `x-hzy-tenant-runtime-url` 注入当前租户运行时地址，并通过 `x-hzy-data-runtime-code` 注入 Platform 注册表中的 runtime instance code。业务应用只有在 `x-hzy-gateway-token` 与 `HZY_CLOUDFLARE_INTERNAL_TOKEN`（兼容 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`）匹配时才可信任这些注入头；Gateway 必须剥离浏览器自报的 runtime code。
**OSS 包地址**: Console 运行时参数 `dataRuntime.packageBaseUrl`，默认 `https://downloads.huizhi.yun/packages/hzy-data-runtime`。Console 读取 `{baseUrl}/latest/manifest.json` 获取最新版本、构建/发布时间和平台包信息；manifest 不可用时回退 `{baseUrl}/latest/version.txt`。
**服务认证**: 更新操作使用 Console service token，默认 `audience=data-runtime`、`scope=data-runtime:runtime:update`；配置为新 tenant-runtime audience 时使用 `audience=tenant-runtime`、`scope=tenant-runtime:runtime:update`。data-runtime 将 audience-scoped scope 映射为内部 `runtime.update` 语义，并要求来源应用为 `console`。对尚未支持 audience scope 映射、且 enrollment 中缺少 Console deployment binding 的历史 Agent，Console 可在正式 grant 校验通过后重试一次兼容令牌：`deployment` 必须精确等于可信 Gateway 注入的 `x-hzy-data-runtime-code`，scope 只能为 `runtime.update`；不得接受浏览器或请求体覆盖。静态 runtime token 只作为显式离线/兼容部署兜底。

核心端点：

- `GET /runtime/healthz` — Console 管理页探活主路径，返回 `status/version/commit/builtAt/tenant/deployment/apps`。
- `GET /runtime/health` — 兼容探活路径，响应结构同 `/runtime/healthz`。
- `POST /runtime/update` — 触发租户端更新，要求 Console service token。HTTP 请求体只允许精确语义版本 `{ "targetVersion": "X.Y.Z" }`（兼容同值 `version`）；禁止通过 HTTP 覆盖 package base URL、install dir、systemd service、force 或 no-restart。下载源必须来自服务器可信配置且是官方默认源或显式 HTTPS allowlist。无论 runtime 进程 UID，生产路径统一返回带 `operationId` 的 `queued`，原子写最小 `/etc/hzy-data-runtime/update-request.env`，由 root-owned external oneshot 在共享 execution lock 内执行。
- `GET /runtime/update/status` — 从 `0600` 持久 update journal 查询跨进程/重启后的 queued/running/succeeded/failed/partial_or_unknown、phase、前后版本/二进制 SHA、制品/manifest SHA 和脱敏 error code，要求 Console service token；损坏或过期 running journal 不得伪装为 idle。
- timer、API update、manual update、installer 和 rollback 共用 `/run/lock/hzy-data-runtime-update.lock`。自动更新策略由 `/etc/hzy-data-runtime/auto-update-policy.json` 持久表达 tracking/pinned/disabled；发布/回滚前 pin，rollback 不自动 unpin，恢复 tracking 必须使用 change ID 和精确确认。
- installer 必须预创建或修正 `/etc/hzy-data-runtime/update-journal.json` 为主 Agent 运行用户所有、`0600`；root update oneshot 后续原子替换时保持既有 owner，避免主进程因 root-only journal 无法触发下一次更新。无法解析的历史 journal 必须先隔离保留证据，不能由 API 静默覆盖。
- data-runtime release manifest、架构 archive 和 installer 使用 detached Ed25519 signature；签名私钥只存在于离线发布环境，服务器通过非 R2 渠道预置 public key。updater/installer 必须同时校验签名、manifest artifact SHA 和 public-key SHA-256 key ID，生产路径不提供 unsigned/skip-signature fallback。

## Console 统一消息中心契约

**Base URL**: Console API 根地址。业务应用通过 Foundation 本地 `/api/notifications/**` 代理当前用户请求；服务端发布通过 Foundation `publishNotification()` helper 调用 Console。
**用户认证**: 当前用户 Console access token 或 Console 本地 session。
**服务认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notifications`、`scope=notifications:publish` 的 service token。

核心端点：

- `GET /api/v1/console/notifications` — 当前用户消息安全信封列表，支持 `status/category/sourceAppCode/limit/cursor`；只返回 Console 生成的通用标签、来源/类别/严重级别、时间和本人阅读状态，不返回来源 title/summary/body/actionUrl/biz/metadata/createdBy/idempotencyKey。
- `GET /api/v1/console/notifications/summary` — 当前用户未读数、类别聚合和最近消息安全信封，`latest` 遵守与列表相同的最小字段约束。
- `GET /api/v1/console/notifications/{notificationId}/detail` — 当前收件人详情；Console 必须先按 `uid + notificationId` 绑定收件事实，再向来源应用实时重验对象权限，只有明确授权后才返回白名单详情。
- `GET /api/v1/console/notifications/todos/summary` — 当前用户实时待办投影计数；只统计 `pending`，与通知已读/归档正交。
- `POST /api/v1/console/notifications/{notificationId}/read` — 标记当前用户单条消息已读。
- `POST /api/v1/console/notifications/read-all` — 批量标记当前用户消息已读。
- `POST /api/v1/console/notifications/{notificationId}/archive` — 归档当前用户单条消息。
- `POST /api/v1/console/notifications/publish` — service-only，业务应用或 Workflow 发布站内消息。
- `POST /api/v1/console/notifications/actionable-lifecycle` — service-only，来源应用以 `expectedVersion -> nextVersion` CAS 将既有 generation 关闭为 `resolved/cancelled`；服务身份必须与 `sourceAppCode` 一致。

发布请求：

```json
{
  "sourceAppCode": "workflow",
  "eventType": "workflow.notification",
  "category": "approval",
  "severity": "info",
  "title": "您有新的审批待办",
  "summary": "项目立项 - 部门负责人审批，请审批",
  "actionUrl": "https://example.com/workflow/tasks/123",
  "bizType": "workflow",
  "bizId": "123",
  "idempotencyKey": "workflow:task:123:created",
  "recipients": ["zhangsan", "lisi"],
  "channels": ["in_app"]
}
```

Console 保存站内消息事实与阅读/归档状态；外部通道继续走 Notification Runtime。普通业务通知统一通过 Foundation `sendNotification()` 编排：必须先成功写入 Console `in_app` 耐久事实，再外发 WeCom；站内失败时不得外发，外部失败则返回保留站内成功结果的部分交付错误。列表与 summary.latest 只能返回不含来源业务文案的安全信封。详情读取由 Console 调来源应用 `POST /api/v1/service/notification-details/authorize` 实时重验：使用 `aud=<sourceAppCode>`、`scope=<sourceAppCode>:notification-details:authorize` 的 Console service token，请求体 `{notificationId,descriptor,subject:{uid},tenantId,deploymentId}` 全部来自收件事实、当前认证会话及可信 Gateway/服务端运行配置，客户端不能提交 subject、descriptor 或 challenge。Workflow descriptor 为 `workflow_task + instance:{instanceId}:tasks:{去重升序 taskIds}`（无 task 时为 `workflow_instance + instanceId`），Aims 为 `work_item + 规范化数字 ID`；Assets metadata descriptor 固定为 `authorizationDescriptor:{resource:'asset_item'|'ip_asset'|'customer_delivery_asset'|'offboarding_recovery_case',id:objectCode}`，People 固定为 `authorizationDescriptor:{resource:'offboarding_task',id:taskCode}`；两者都必须与 `bizType/bizId` 精确一致且不得带额外字段，并仅接受来源直接精确 tuple，不在 Console 执行 scoped challenge。来源直接放行必须 `code=0,data.authorized=true` 且精确回显 `resource/id`；拒绝/权限撤销/对象不存在返回 403，无 verifier、超时、429、5xx、畸形响应或来源授权运行时不可用返回 503。禁止最终授权缓存和陈旧详情回退。授权后也只返回 title/summary/body/actionUrl/actionTargetAppCode/bizType/bizId/时间等 UI 白名单，不返回 raw metadata、bizKey、createdBy 或 idempotencyKey。唯一的无对象读取例外是已绑定收件人的 `sourceAppCode=enterprise`、`metadata.notificationKind=business_event`、`moduleAppCode=codocs` 且业务类型为 `document_share`、`department_share` 或 `document_review` 的历史通知：Console 仅返回创建时保存的 title/summary/body/时间，清空 actionUrl、bizType、bizId，不读取当前业务对象、不提供跳转，并在 UI 明示对象状态未核验；未知模块或类型仍失败关闭。

在调用任意非 Console 来源 verifier 之前，Console 必须先执行 notification-detail fresh eligibility：Directory 中 subject 必须仍为 `active`，再用 fresh normal-merged policy（忽略 role/user simulation、禁止 privileged、绕过 snapshot cache；managed-cloud 先刷新并核验当前 tenant/deployment bundle）判定由 Console 静态 registry 固定的最低 `resource:view`。固定映射为 Workflow `workflow_task→workflow_tasks`、`workflow_instance→workflow_instances`；Aims `work_item→work_items`、`integration_operation→integration_operations`；Assets `asset_item→asset_items`、`ip_asset→ip_assets`、`customer_delivery_asset→deliveries`、`offboarding_recovery_case→offboarding_recoveries`、`integration_operation→integration_operations`；People `offboarding_task→offboarding_tasks`、`integration_operation→integration_operations`；Finance `invoice_request→invoices`、`finance_receipt→receipts`、`integration_operation→integration_operations`；Altoc `receivable_plan→receivable`、`integration_operation→integration_operations`。registry 不接受请求体或来源回调覆盖 resource/action；Directory inactive 或 permission deny 返回 restricted，Directory/policy/bundle 不可用返回 unavailable，二者都不得调用 source verifier。Console lifecycle `people_lifecycle_authorization` 继续使用其现有双权限实时边界，不能用这条通用最低 view 检查替代或弱化。

Assets 客户交付资产 `expiry / warranty / support` 到期通知以 `customer_delivery_assets.responsible_uid` 为唯一收件事实；`responsible_dept_code` 仅供用户目标页的数据范围，不得展开为部门群发。两者由 Assets 内显式维护，不从 Altoc 合同负责人、Aims 项目成员或交付视图负责人隐式推导。通知使用 `delivery_expiry / delivery_warranty / delivery_support` 三条流和 `customer_delivery_asset + delivery_asset_code` descriptor；详情重验要求当前 active 生命周期对象的责任人仍精确等于 subject。目标页 `/customer-delivery-assets/{deliveryAssetCode}` 经普通 Assets 用户认证、`deliveries` permission 和 runtime owner/department scope 重新读取；责任撤销后不得依赖通知中的旧正文或 URL 获得对象内容。

People 离职事项独立保存 `people_offboarding_cases` 与 `people_offboarding_tasks`，只允许已生效或无需审批的离职任职事实创建事项；`handover` 表达工作交接，`asset_recovery_coordination` 仅表达资产回收协调确认，不能声明 Assets 中的实物已经归还。Console Directory 继续独占账号停用、session 撤销和 Platform 授权来源回收事实，人员状态变为 `left/inactive` 或 Directory 生命周期成功不得自动生成 People 离职任务。到期通知使用 `offboarding_handover_due / offboarding_asset_recovery_due` 两条流，唯一收件人是任务当前 `responsible_uid` 且必须为 active Directory 用户，不允许经理、部门、管理员、配置或 `@all` 回退。通知详情重验只允许当前直接责任人查看精确 task，管理员不作为通知关系回退；普通事项目标页仍按 People 自身用户权限重新授权。任务确认与取消采用 `expectedVersion=vN` CAS，并分别受 `offboarding_tasks:confirm` 与 `offboarding_tasks:cancel` 控制，`edit/admin` 不隐式获得确认或取消能力。

People 是员工离职生命周期的唯一事实源；Console Directory `inactive` 可能来自管理员停用或目录同步，Assets 不得反向扫描 Directory 推断离职。People 只为已提交且已生效的 `left/inactive` 员工事实，或查询时点最新已生效且 `approval_status in (none,approved)` 的 `change_type=leave` 任职事实，创建 caller-owned 耐久 operation；未来日期、draft/pending/rejected/cancelled leave 均不得提前投影。scheduled drain 使用 `aud=assets`、精确 `assets:offboarding-recovery:sync`、`Idempotency-Key` 与标准签名 service-command envelope 调 `POST /api/v1/service/offboarding-recoveries:upsert`，只有 Assets 在领域 mutation 与 succeeded receipt 同事务提交后，People 才确认 source operation 成功。功能开关 `HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED` 默认关闭，且在 runtime binding、token 与网络前短路。

Assets 的 `asset_offboarding_recovery_cases` 只保存来源事件键、离职 UID/生效时间、Assets 自定回收期限和显式回收责任，不复制 People `asset_recovery_coordination` task/case 状态或静态资产清单。case `status=active` 只表示离职投影有效；未归还事实每次仅按 Assets 当前 canonical `asset_items.user_uid=departed_employee_uid` 重算。责任人初始可为空，后续只能由 Assets `offboarding_recoveries:edit` 显式分配且不得等于离职员工；无责任时保留工作清单但不通知，不使用 owner/custodian/经理/部门/管理员/配置或 `@all` fallback。可靠流固定为 `offboarding_unrecovered`，holdings 排序指纹进入 source version，资产集合或责任变化会 supersede 旧证据，全部归还关闭为 resolved；descriptor 固定 `{resource:'offboarding_recovery_case',id:caseCode}`，详情只允许当前显式责任人且仍有未归还资产时查看。

Assets 用户目标读取对 `asset_item / ip_asset / offboarding_recovery_case` 使用 BFF 从 Console normal-merged grant 派生的 trusted `all / relation / none` 和有界 grant-unit 对象范围；grant 内跨维度 AND、grant 间 OR，unknown/不可解析范围失败关闭。资源资产 direct relation 为当前 owner/custodian/user，并支持自身 `dept_code/project_code`；知识产权 direct relation 为当前 IP owner 或关联产品 business/technical owner，并支持关联产品 `project_code`；离职回收只支持 active case 当前 recovery responsible，因无部门/项目字段不匹配相应 unit。责任变化后旧 UID 的 direct relation 分支立即失效，但独立对象 owner、部门/项目、tenant-global 或同 resource admin grant 仍可保留访问。浏览器不能提交 actor、all 或 scope units。view/通知关系绝不蕴含 edit/approve/admin；PATCH 必须重新满足 action-specific scoped grant 和 runtime 对象谓词。

Enterprise IP 详情的产品关联读取使用精确 `GET /assets/api/v1/ip-assets/:id/products` → Runtime `POST /v1/enterprise/assets/ip-assets:products`（服务能力 `assets:ip-asset:read`）。Host 从同一当前用户会话分别取得 `ip_assets:view` 和 `products:view` scoped permit；Runtime 在一个 Registry 快照中先验证源 IP 对象范围，再按产品对象范围过滤关联，仅返回可见产品的 `id/code/name/status`。原 `:view` 仍只返回 IP 主档，不因关联读取而泄露产品计数或明细。

Assets 普通资产使用人以 `assignments:request` 发起自助操作，不持有 `assignments:edit`。runtime 只接受 `claim / return / release`，强制 claim 目标为当前用户，并分别校验资产可领用、本人当前实物使用关系或本人当前资源使用关系；流程实例、操作编号、生效/结束时间、审批人、终态和他人 target 均不可由浏览器指定。`assets:employee` 的 dashboard、asset item、assignment、alert 默认 scope 为精确 `asset:user`，不得把 user 合并为 owner/custodian；`assets:requester` assignment scope 为 `subject:self`。工作台汇总、列表、详情和 alert action 必须消费 BFF 派生的 action-specific trusted scope；assignment 可见性是“本人发起/本人目标/资产关系”与同 grant 部门、项目范围的有界组合，管理侧分配、转移、续费、维修、密钥轮换、权限回收和报废仍要求 `assignments:edit`，审批终态仍要求 `assignments:approve`。

Console 提供 `POST /api/v1/console/service/authorization/subject-eligibility` 与 Foundation `checkSubjectEligibility()`，用于按服务端固定 purpose 检查指定用户的精确权限。调用方使用目标应用 `aud=console` 与精确 `console:authorization:subject-eligibility` capability，只能以自身双 claim service identity 查询 registry 登记的 purpose；body 只有 `subjectUid/purpose`，resource/action/app/tenant/deployment/object/simulation 均不可由调用方声明。Console 要求 Directory 显式 active，托管模式先通过逐请求修订探测选择已验签且距接收不满 20 分钟的缓存信封或刷新完整信封，再按 normal-merged、无 simulation、无主体 snapshot cache 的 policy snapshot 判定 registry 固定的 `resource:action`；修订探测失败及刷新失败均关闭为 503。响应仅 active/allowed/reason/policyRevision 且 no-store，基础设施不可用失败关闭。Aims、Assets、People、Finance、Altoc drain 在旧 UID closure 后、publish/ack 前检查真实 stream purpose；negative/503 不发布、不确认 checkpoint。v1.42 seed/verify 用于初始 capability，v1.97 seed/verify 用于幂等恢复 `workflow.runtime` 的精确 grant 及审批动作 purpose；两者都不创建 credential，实际权限元组始终以 Console registry 代码为唯一事实，不得由应用自动执行 seed。
Registry 与 Aims、Assets、People、Finance、Altoc 的真实 due/offboarding stream union 及各应用 manifest `resource:view` 由跨模块静态合同锁定。Workflow 通知 purpose 只由可信 event allowlist 与 task/instance 身份派生：单 task 使用 `task_actionable` 和 task URL，并行 task 使用 `instance_actionable` 和 instance URL，终态使用 `instance_status` 和 instance URL。Workflow 跨应用代理操作只能按服务端路由派生 `task_approve/task_reject/task_delegate/instance_cancel/instance_resubmit`，并分别固定到 `workflow_tasks:approve|reject|delegate` 或 `workflow_instances:cancel|resubmit`；通过 Console 用户权限后，tenant-runtime 仍必须校验当前 task assignee 或 instance initiator 关系。业务 target、biz type、URL 和调用方输入均不能选择 eligibility permission。

Finance 将 Workflow 审批通过与正式开票拆成两个事实：审批回调只把 `invoice_request` 置为 `approved`，正式发票只能由显式 `invoices:issue` 动作创建，审批人和 `admin` 不因动作蕴含自动获得开票能力。已批未开票以 `issuance_responsible_uid / issuance_due_at` 为唯一责任与时限事实；到账未核销以 `reconciliation_responsible_uid / reconciliation_due_at` 为唯一责任与时限事实，`requested_by`、`handler_user_id`、经理、部门、管理员、配置和 `@all` 均不得作为通知收件回退。通知使用 `invoice_issuance_due / receipt_reconciliation_due` 两条流，descriptor 分别固定为 `invoice_request + request code` 与 `finance_receipt + receipt code`，并与 `bizType/bizId` 精确一致。来源详情每次只对仍处于可办理状态的当前直接责任人放行；正式开票、足额核销、取消、责任或时限变化必须通过可靠 checkpoint 关闭或推进旧 generation。

Altoc 应收计划的普通 `owner_user_id` 可能由合同负责人自动派生，不得作为催收通知责任关系。临期生产者只使用显式维护、历史不回填的 `receivable_plan.collection_responsible_uid`；计划负责人、合同负责人、客户经理、部门、管理员、配置和 `@all` 均不得 fallback。`receivable_plan_due` 只覆盖 `to_receive / partially_received / overdue` 且 `amount - received_amount > 0`、计划回款日在 30 天窗口内的对象；`pending / to_invoice / received / bad_debt` 排除，其中 `to_invoice` 由 Finance 开票事项覆盖。descriptor 固定为 `receivable_plan + plan code`，详情重验只允许对象仍可催收时的当前直接催收责任人。旧 `scan-overdue` 仅保留状态与逾期天数更新，不再聚合发布 `receivable_overdue_scan` 或回退合同负责人；通知统一由可靠 checkpoint、owner move、publish/closure ack 恢复的 scheduled producer 产生。

Altoc 应收目标页使用通知 descriptor 的 exact plan code 跳转 `/payments/{code}`。普通列表与详情读取保持既有 `receivable_plan.owner_user_id`、合同 owner 和合同部门范围，并显式 OR 当前 `collection_responsible_uid`，不以新责任字段替换或重解释存量 owner。编辑、确认到账和手工逾期扫描仍只使用原 owner/合同对象范围及显式 admin 旁路，不能仅凭催收责任关系写入。反向的通知详情授权不复用该 OR 读取范围：即使是计划 owner、合同 owner、部门成员或管理员，只要不是当前直接催收责任人就不得读取通知正文；责任切换后旧 UID 的详情关系与目标页责任分支都实时失效。

Aims 非成员的 scoped-admin 分支采用同一 Console → Aims capability 的两阶段闭环。phase-1 只在 Aims 用受控 runtime actor delegation 证明当前 subject 既非 active member 也非 leader 后，返回固定 tuple `aims/projects/admin`、`objectRevision`、绑定 notification/descriptor/subject/tenant/deployment/最小对象事实的 `factsHash`，以及只含 `projectCode/projectId?/departmentCode?/confidentialityLevel` 的 challenge。Console 不接受来源提供 actor、owner/member 数组、departmentTree 或任意 relation；actor 固定为当前 uid，非成员数组固定为 sentinel，departmentTree 由本地 active Directory 逐父构造。managed-cloud 每次求值前必须强制刷新并验证 tenant/deployment 绑定的 policy bundle，刷新失败不得使用旧 allow；求值固定 normal merged、忽略 simulation、绕过进程快照缓存。允许后 Console 调 `POST /api/v1/service/notification-details/authorize/finalize`，Aims 必须按 revision 重读事实并重施领域规则（包括 L3 不允许 department scope），最后精确回显 `factsHash/objectRevision/policyRevision/policyBundleHash/scopeBasis` evidence；Console 逐项相等且 evidence 无额外键时才释放详情。任何 tuple/字段漂移、未知 scope、目录/策略不可用、revision 或 evidence 不匹配都 fail closed。

通知发布、actionable lifecycle 和 integration dead-letter 写入口在读取 body 前必须验证现代 service token 的 `hzy.appCode` 与 `source_app` 均非空且精确一致，并把 app/tenant/deployment 与当前可信 runtime binding 精确比较；发布 canonicalization 仍再次要求 body `sourceAppCode` 与服务身份一致。禁止回退 actorId、单个历史 JWT claim 或 body 自报 source。

Enterprise Host 内的 Codocs 共享、部门移交和发文执行四处普通业务通知由 `enterprise.runtime` 发布，故 `sourceAppCode='enterprise'` 与服务身份一致；`metadata.moduleAppCode='codocs'` 保留模块归属，`notificationKind='business_event'`，原 Codocs 事件类型、幂等键与 `/codocs/…` URL 保持不变。这些通知没有 `actionableState='pending'`，不触发待办动作目标 catalog 绑定；`moduleAppCode` 不能授予来源身份或绕过对象权限。Console 当前未登记 Enterprise 来源的详情 verifier，详情读取继续失败关闭；发布与详情验收分开记录。

Codocs Host 部门目录、部门文档、部门文件柜与部门移交的写入/回放使用双库锁协议：Runtime 先在 Console Directory 自有库的只读事务中对用户、目标部门、直属上级及成员关系行加共享锁并计算当前 R，保持该事务打开；再在 Codocs 自有库的写事务中核对受锁保护的 actor/部门/R，且这一检查早于 service-command 回执读取。Codocs 提交后才释放 Directory 锁，因此并发撤权必须等待本次写入结束，撤权后的同键回放重新取 R 并拒绝。Directory 不可用返回 503；不能把 Codocs 的 SQL 事务传给 Directory adapter，也不接受 Host 提供的角色事实。隔离 MySQL 测试必须使用两个不同 schema。

Enterprise Host 的 Codocs 移交目标候选与提交前目标校验使用 Foundation 固定操作 `console.directory-self-departments` / `console.directory-self-projects`，映射 `POST /v1/enterprise/console/directory-self:departments|projects`、精确 `console:directory-self:read`。Runtime 按已验 Enterprise 服务身份、当前有效 grant 与签名 actor 查询当前用户的活跃部门/委员会和管理或参与的项目；请求体只能是 `{}`，查询参数或任意 `uid` 字段均拒绝。部门投影仅含移交选择字段及通知所需的部门负责人/领导 UID，项目投影仅含编码、名称；目录依赖失败为 503。原 `/v1/console/directory/*` 保持 Console 来源限制。Enterprise Host 的 Aims `GET /aims/api/account/accessible-departments`（新建事务/项目表单的部门选择）使用同类固定操作 `console.directory-self-accessible-departments` → `POST /v1/enterprise/console/directory-self:accessible-departments`，同样只接受 `{}`、以签名 actor 计算“所在部门 + 负责/分管部门 + 全部下级（仅 `org_type=department` 且有上级）”，输出仅 `{deptCode,name}`；Host 不持有 `console:directory-department:view`，Runtime 403/503 原样映射为 403/503，不静默返回空列表。独立 Aims 仍经 Console 目录 `/api/v1/departments/accessible`。Host 与独立 Aims 的已知差异：Host 投影不含部门 `managerId`，Host 新建/编辑项目表单不再自动把部门负责人补入候选人（仍可手动搜索选择），负责人 UID 不离开 Runtime。新 grant 分别绑定 `data-runtime` / `tenant-runtime` audience，Host 切换并验证后按精确 SQL 停用旧 `console:directory-user:view` 两行。

Console publish 以 `sourceAppCode + idempotencyKey` 作为站内通知唯一身份，并保存 canonical SHA-256 request hash。hash 绑定排序去重后的 recipients/channels、递归按 key 规范化的 metadata，以及 eventType/category/severity/title/summary/body/actionUrl/bizType/bizId 等完整投递语义。同键同 hash 只返回既有 `notificationId`，不得再次 INSERT/UPSERT recipient，不得解除归档、重置已读或改变 delivery state；同键异 hash 返回 HTTP 409 `idempotency_payload_mismatch`。并发首次发布发生 duplicate-key race 时，失败事务必须用锁定读回当前行并按 hash 作同样判定，不能把冲突当成功。历史行因未保存 channel 请求而无法可靠重建 canonical hash，迁移使用确定性 legacy sentinel，旧 key 重放保守返回 409。

`actionUrl` 在 publish 和授权后 detail 两个边界都必须 fail closed：只接受 `http/https` 绝对 URL 或单个 `/` 开头的应用内路径；拒绝 `javascript:`/`data:`、`//` protocol-relative、带 username/password 的 URL、CR/LF/控制字符和反斜杠。历史不安全值不得因详情已授权而返回。存储的 actionUrl 保持 Console 按签名目录绑定的绝对 URL（外部通道与发布 hash 依赖其稳定）；浏览器消费端在 Enterprise Host 内对 `actionTargetAppCode=enterprise` 的目标只取 `/enterprise/` 下的 path/query/hash 于当前源导航，不要求 enterprise 出现在用户应用目录，也不信任请求头推导公网地址；其他目标与 Host 外查看继续按目录校验（见 FOUNDATION_CAPABILITIES `hostNotificationTarget()`）。

Actionable 待办不复用 `portal_notification_recipients.delivery_state`。Console 以独立 `portal_actionable_projections` 保存 `(uid, source_app_code, actionable_key)` generation、当前 notification 引用、业务键、状态和 opaque object version。只有真正新建 notification 才能首次创建 projection；canonical replay 对 projection 零写。终态 generation 不得复活，重新打开必须使用新的 `actionableKey`。lifecycle API 只接受 `resolved/cancelled`，exact `(state,nextVersion)` 重放为幂等成功，版本不匹配或不同终态请求返回 409。所有显式 `metadata.actionableState='pending'` 的发布在 canonical hash 前必须由 Console 用已验签 application catalog 绑定 action URL 和受控 target app；Console 写入一致的 `actionTargetAppCode/targetAppCode` 与 `actionTargetCatalogBinding='catalog-v1'`，catalog 不可用失败关闭。Workflow 保持既有同一绑定规则，普通非 Workflow 通知与终态 lifecycle 不触发 catalog。历史 pending 无法从 source 或 URL 追溯为安全绑定，升级须按批准流程执行 Console fail-closed migration 关闭无 marker 的 projection，绝不猜测或自动执行。Workflow 是审批事实源；当前 pending 通知可创建 Console projection，但 Workflow 完成、转交、驳回和撤回后的关闭调用仍需后续在 Workflow 侧接线，接线前 Console 投影可能陈旧。

Workflow 待办生命周期 outbox 首次立即投递。失败检查点保留 pending 并记录尝试次数与时间；后续按 10、20、40、最多 60 分钟退避，仅返回已到期记录，按 ID 扫描且每轮最多 100 条。Console `actionable_not_found` 不得当作成功确认，因为它也可能表示部分收件人投影缺失；退避只控制请求频率，数据修复仍需核对原始投影。

Console Directory→Platform 的 employment/offboarding operation 同样是 source-owned reliable projection：只有两条固定 Platform operation 在 `dead_letter` 时才由 `console_platform_lifecycle_actionables` 冻结 `operation_id + generation`、opaque actionable key/object version 和首批显式 active 收件 UID；发布失败或 notification/closure checkpoint 丢失由同一 Console task 重试。待办目标固定为已验签的 Console catalog 路由，descriptor 必须精确镜像 `people_lifecycle_authorization + directory uid`；通知正文、metadata 和 URL 均不得包含 operation key、命令、hash、原始失败摘要、token 或内部地址。原 operation 离开 `dead_letter` 后，成功以 `resolved`、其他受控重试终态以 `cancelled` 使用冻结 expected/next version CAS 关闭；详情仍每次实时同时要求 `console:authorization_lifecycle:view` 与 `console:audit_logs:view`。

## Notification Runtime 契约

方案 B（Enterprise Connector Runtime）已经批准。当前 Notification Runtime 是迁移兼容源；
`GET /runtime/capabilities` 在保留原有 `channels/messageTypes/scopes` 的同时返回
`hzy.connector-capabilities.v1` 类型化 provider/capability 注册表、目标 scope 映射和
`arbitraryHttpProxy=false`。只允许已实现能力被注册，Integration 配置不得覆盖编译期
provider HTTPS origin 策略。现有服务不会通过普通 updater 静默改名或切换 audience；
显式迁移、账本保留和回滚规则见 `connector-runtime/docs/Enterprise-Connector-Runtime-Migration.md`，可机读
事实源为 `notification-runtime/internal/migration/connector-runtime.v1.json`。

Phase 1 已落地独立产品 `hzy-connector-runtime`：共享 Runtime Core 但使用独立的
`HZY_CONNECTOR_RUNTIME_*` 配置空间、默认端口 `18082`、audience
`connector-runtime`、本机 SQLite `operations.db` 和 systemd service/timer。安装命令
只携 15 分钟、单次、tenant/deployment 绑定的 enrollment code；Console 只持久化其
SHA-256，Runtime 本机生成 RSA-3072 私钥，换取的长期 service credential 只经 RSA-OAEP
加密返回并落到客户服务器。enrollment code 不得写入 Runtime 配置、日志或 SQLite。

Connector Runtime 的企业微信通知能力继续使用兼容路径
`POST /v1/notifications/send`，但目标 token 必须为
`aud=connector-runtime`、精确 scope `connector-runtime:notifications:send`。Console 设置
`connector.notificationsEnabled` 默认 false；只有管理端验证 runtime product、类型化
capability schema、固定 provider origin、`arbitraryHttpProxy=false` 和精确 scope/path 后
才能显式启用。未启用时 Foundation 和 Console 均继续走 Notification Runtime；Connector
探测失败不得改变设置。显式迁移脚本只支持可验证的 SQLite ledger 复制，失败必须恢复旧
service；MySQL 迁移不得自动猜测源/目标数据库。

通知成功响应包含布尔字段 `replayed`。首次实际调用供应商时为 `false`；同一 tenant、deployment、
source app、idempotency key 且 canonical request hash 相同的成功重放必须从持久账本返回原脱敏结果并
标记 `replayed=true`，不得再次调用供应商。同键异 hash 继续返回 409
`idempotency_payload_mismatch`。Console 企业微信测试在 Connector 通道启用时必须用同一请求执行一次
成功重放，并且只有看到 `replayed=true` 才能报告幂等验收通过。

Phase 2 新增企业微信身份能力 `identity.wecom.exchange@v1`，固定接口为
`POST /v1/identity/wecom/exchange`，只注册在 `hzy-connector-runtime`，不在兼容
Notification Runtime 中暴露。调用令牌必须为 `aud=connector-runtime`、精确 scope
`connector-runtime:identity:exchange`，JWT 模式下来源应用固定为 Console；请求只允许
`integrationCode=wecom.default` 与一次性 `authorizationCode`。Runtime 只访问编译期
`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo`，只返回规范化企业成员 subject，
不得返回 access token、OpenID 非成员身份、原始响应或用户详情。

Cloudflare 租户域名不再直接作为企业微信授权回调域。浏览器登录必须同时验证
`identity.wecom.browser-login@v1`，由 Console 调用
`POST /v1/identity/wecom/authorizations` 创建五分钟、tenant/deployment/state 绑定的授权，
企业微信只回调当前租户已登记 Connector 的 `GET /v1/identity/wecom/callback`。每个租户必须在
自己的企业微信应用中单独配置该 Connector 公网域名作为授权回调域，并单独维护本租户的
CorpID/AgentID/CorpSecret；不得把 wiztek 的 `wecom-api.wiztek.cn` 当作全平台租户的默认回调域。
Runtime 消费授权码后生成
不含 provider subject 的随机单次交接码，浏览器回到租户 Console 后再由 Console 以相同
`connector-runtime:identity:exchange` scope 调用
`POST /v1/identity/wecom/handoffs/redeem`。Runtime SQLite 只能保存 state/交接码 SHA-256；
授权码、access token、原始响应和明文交接码不得持久化或记录。

Console 企业微信登录 state 必须使用密码学随机值，并以 SHA-256 形式持久化，同时绑定
httpOnly 浏览器 cookie、tenant、deployment、目标应用和安全站内 redirect；有效期 5 分钟，
在调用 Runtime 前以事务和 CAS 单次消费。callback query 中的 target app/redirect 不可信。
外部身份和目录用户任一被禁用均失败关闭，已有禁用 identity 不得因再次登录自动恢复。
企业微信 CorpSecret 只保存在 Console `wecom.default` Vault；Platform 只保存并投影
CorpID/AgentID，Cloudflare 登录配置、policy bundle、页面和日志不得携带 CorpSecret。

Console 登录策略使用 `consoleLogin.mode` 表示默认登录方式，并使用
`consoleLogin.enabledProviders` 明确列出实际开放的 `oidc|cas|wecom|dingtalk` 入口；默认方式
必须包含在开放列表中。旧 policy bundle 缺少 `enabledProviders` 时只启用原 `mode`，不得因
其他 provider 恰好存在配置而隐式放开。Tenant Gateway 只在已验证租户上下文中注入默认方式、
开放列表和各开放 provider 的非秘密元数据。存在多个入口时 Console 登录页必须让用户选择，
其中默认方式优先展示；企业微信客户端在企业微信入口已开放时可直接进入企业微信授权。
直接访问 provider start/callback 时仍需实时验证该 provider 已开放，禁用后不得仅凭未过期 state
继续交换身份。OIDC 与企业微信并行启用不改变 OIDC 的默认方式，也不允许把 CorpSecret 投影到
Platform、policy bundle、Gateway header 或浏览器。

OIDC 登录入口的用户可见文案使用 `consoleLogin.oidc.displayName`，默认值为
`企业统一身份登录`，去除首尾空白后最多 10 个 Unicode 字符。Platform 部署管理负责在保存时
校验并把该非秘密字段写入环境级设置；Policy Bundle 必须将其置于签名载荷的 `consoleLogin`
中。Tenant Gateway 仅在可信租户上下文中通过 URI 百分号编码的
`x-hzy-sso-oidc-display-name` 转发，且必须先清除浏览器伪造的同名请求头。Console 必须在
可信读取后解码，登录配置接口和登录页必须消费该字段；旧 bundle、空值或越界值统一回退默认
文案。

Phase 3 新增钉钉类型化能力。身份交换固定为
`identity.dingtalk.exchange@v1` / `POST /v1/identity/dingtalk/exchange` / scope
`connector-runtime:identity:dingtalk:exchange`；工作通知复用
`notifications.send@v1`，但 `channel=dingtalk` 只允许 `integrationCode=dingtalk.default`。
Runtime 仅访问代码内固定的 `api.dingtalk.com`、`oapi.dingtalk.com` 官方 HTTPS 路径，
Integration 不能提交 URL、方法或请求头。AppSecret 只存在 Console Vault；Platform、Tenant
Gateway、登录配置与 policy bundle 只投影 AppKey/CorpID 等非秘密元数据。身份交换只返回
规范化 provider subject，不把 user access token、app access token 或原始供应商响应返回云端。
钉钉网页登录优先使用独立 `dingtalk.identity` 集成：非秘密配置保存 OAuth Client ID（旧版企业
内部应用通常显示为 AppKey）和可选 CorpID，对应 Client Secret 只存在该集成自己的 Console
Vault 绑定。`dingtalk.default` 继续承载机器人通知和 People；只有租户没有 active
`dingtalk.identity` 时，登录才兼容回退到其中的 `oauthClientId`/历史 AppKey。登录 start 选中的
integration code 必须写入一次性 OAuth transaction，callback 和 Runtime 授权码交换只能使用同一
集成，禁止在回调阶段重新选择或换用另一份 secret。机器人通知和 People 同步继续固定使用
`dingtalk.default`，不得被登录 Client ID 覆盖。钉钉 `AgentId` 与 `UnifiedAppId` 都不是本 OAuth
合同的 Client ID，Console/Platform 配置页必须明确阻止误填。钉钉后台回调修改只有在重新发布
应用版本后才视为生效。
Console 只显示一个“钉钉”集成入口，内部分为“通知与 People”和“登录”页签。登录默认复用
`dingtalk.default` 的 Client ID 和 Vault 凭证；只有管理员选择独立登录应用时才启用
`dingtalk.identity`。切回复用模式必须先规范化 `dingtalk.default` 的历史重复字段，再停用
`dingtalk.identity`，不得删除独立集成或其 Vault 历史。
管理员真实通知验收使用 Console 固定入口
`POST /api/v1/console/connector-runtime/dingtalk-test`，必须先校验 `integration_config:edit`，
只接受固定 `dingtalk.default`、收件人和幂等验收键，并由 Console 申请
`aud=connector-runtime` / `connector-runtime:notifications:send` 短期 service token。该入口不得
接收 AppSecret、provider URL、方法或请求头；只有实际投递后以完全相同请求命中持久账本且返回
`replayed=true`，才可报告验收成功。Connector 通知未显式启用时必须在供应商调用前失败关闭。

Phase 4 的钉钉组织/People 同步是显式异步任务，不存在默认 cron 或无条件周期全量。
People `设置 / 人事事实源` 通过 Console service API 提交任务；旧 Console 浏览器 API
`POST /api/v1/console/connector-runtime/people-sync-jobs` 已返回 410。Console service API 仅负责用
`connector-runtime:people:sync` 提交固定 `provider=dingtalk`、
`integrationCode=dingtalk.default` 和 `organization|people` scope；进度读取使用独立
`connector-runtime:jobs:view`。运行中任务取消使用独立 `connector-runtime:jobs:cancel`，只把
`pending|running` 原子转为 `cancelled` 并中止后续分页；已经成功写入的 data-runtime 幂等批次
不回滚。失败任务重试继续要求 `connector-runtime:people:sync`，生成带 `retryOfJobId` 的新任务、
沿用原 watermark/对象范围，并以来源 job 派生稳定幂等键；同一失败来源的确认丢失重放不得创建
第二个重试任务，非 `failed` 状态返回 409。Connector 在客户侧持久化 job、watermark、批次数和脱敏错误，
并以规范化请求 SHA-256 约束幂等键；同键不同 scope、watermark、actor 或 retry lineage 返回 409。
同一 provider/integration 只允许一个 `pending|running` 任务，watermark 必须为 RFC3339 且不得倒退；
升级时先把遗留运行中任务标记为 `runtime_restarted` 失败，再安装单活约束。取消动作另存原始管理员、
动作幂等键和请求 hash，同键不同 actor/任务不得重放。
分页读取固定钉钉通讯录 API；`people` scope 还必须读取钉钉 HR 离职清单与离职详情接口，
People HR 事实源只接受钉钉供应商根部门 `rootDeptId=1`；不得把子树配置伪装成完整组织快照，
否则会错误重挂父级并把范围外部门判为缺失。
用明确的 `status + lastWorkDay` 生成 `active|leaving|left` 事实。不得用“本次通讯录未返回”
推断离职，因为权限、可见范围和临时接口失败都可能造成缺失。Cloudflare 请求返回 202 后不等待
供应商拉取完成。

People 人事事实源入口只提交 `organization + people` 的 Connector People 任务，不复用旧
`directory.dingtalk` 配置，也不允许 Cloudflare 直接请求钉钉 API。Connector 固定读取
`dingtalk.default`，每个批次通过签名 data-runtime 边界落 People；姓名、主归属、在离职状态和
账号关闭都沿 People canonical uid 与 durable lifecycle 投影到 Console。该链路不得启用旧
`directory_profiles` 邮箱匹配回调，避免 provider identity 与唯一邮箱指向不同 uid 时跨人写入。
独立的 Console 目录资料同步能力保留给原有 Console 管理流程，不属于 People HR 事实源任务。

员工私密档案（身份证号、出生日期、学历、专业、毕业学校、毕业日期）不进入通用 Directory 或
`people_employees` 列表合同。Connector 可从钉钉成员响应的同名字段或 `extension` 自定义字段下发这些
可选事实；People 按字段分别保存 `dingtalk / manual / oa_archive` 来源，并按钉钉、人工、OA 顺序解析。
钉钉 absent 不清除回退值，显式空值只移除钉钉来源；钉钉有值时 People 管理页面与 runtime 都拒绝人工
覆盖。旧 OA CSV 只经 People `employees/admin` 浏览器边界上传、预检和导入，匹配歧义一律跳过，身份证
明文不得出现在普通员工 API、导入结果、日志或跨应用响应中。

Connector 到 data-runtime 只允许安装时固定的 origin 和精确路径
`POST /runtime/internal/connector-runtime/people-sync-batches`：分机部署必须使用 HTTPS，只有显式同机部署可使用 loopback HTTP；不跟随重定向。目标地址由 Console 已受信的 `dataRuntime.runtimeApiUrl` 写入单次安装指令，不接受 People job 请求动态覆盖。请求由 enrollment 生成的本机
RSA-3072 工作负载私钥以 RSA-PSS 签名，签名绑定 method、path、timestamp、nonce 和原始请求体
SHA-256。data-runtime 必须按 `hzy_console.connector_runtime_instances` 中当前 active 公钥验签，
执行 90 秒时间窗、nonce 防重放和 tenant 绑定；Connector 不接收任何业务数据库凭证。
data-runtime 在处理用户前先通过 `directory_department_identities`
把 `(provider_code=dingtalk, external_department_id)` 解析为稳定 canonical `dept_code`；
供应商 ID 不写入 `directory_departments` 的业务编码或旧 `external_ref` 字段，也不得直接作为
跨模块业务键。用户优先复用现有
`directory_identities(provider=dingtalk)`，其次复用唯一邮箱命中的 Directory uid；仍未命中的
当前/待离职员工生成确定性内部 uid，未知且从未被汇智云管理的历史离职人员计入 skipped，避免
为历史清单反向创建幽灵账号。人员批次在一个 People 事务中 upsert `people_employees`、当前任职
或明确的 `leave` assignment，并为已生效事实冻结单调 Directory lifecycle operation；未来
`lastWorkDay` 到期后由 `directory-lifecycle:prepare-due` 冻结。employment operation 创建/启用
Directory user、DingTalk identity 和部门 membership；offboarding operation 停用用户与外部身份
并撤销本地 session/refresh token。每个 `(job_id,batch_number)` 在
`people_connector_sync_receipts` 中保存 hash、状态和结果，同 hash 成功重放不重复写，异 hash
409，失败批次可按相同内容重试。

Phase 5 设备运维使用独立出站 scope `console:connector-runtime:heartbeat`。Connector 默认每 60 秒
向 Console `/api/v1/console/service/connector-runtime/heartbeat` 上报版本、能力、启动时间及
通知/People job 状态聚合；不得上报用户、provider subject、消息正文、URL、错误正文或凭证。
Console BFF 必须先校验 service actor 的 app、client code、tenant、deployment，再只把
服务端派生的 verified client code 转发至客户侧 Tenant Runtime；Runtime 再与 body
connectorId、enrollment binding 和本机 tenant/deployment 一致性校验后更新实例。
管理员 issue/revoke 必须携带签名用户委托和 `Idempotency-Key`；吊销在 Tenant Runtime
同一事务撤销 instance、公钥信任、未使用 enrollment、service credential、grants、
Receipt 与审计。心跳业务请求收到 401/403 时，Runtime 必须淘汰对应缓存 Token、重新执行一次
`client_credentials` 并只重试一次；新 Token 仍被拒绝，或 Token 端点直接拒绝当前 client
credential 时，才按身份撤销停止。轮换通过新的 15 分钟单次 enrollment 原子替换公钥和
credential，新 enrollment 兑换前不得提前停用旧实例。
`runtime.diagnostics.read@v1` 固定为 `GET /v1/diagnostics`、scope
`connector-runtime:diagnostics:view`，只允许 Console，响应仅含版本、绑定和 SQLite 聚合计数。

**Base URL**: Console 运行时参数 `notification.runtimeApiUrl` 对应服务根地址。
**认证**: 调用方通过 Console OAuth2 `client_credentials` 获取 `audience=notification-runtime` 的 service token。发送、投递查询、人工对账分别要求精确 scope：`notification-runtime:send`、`notification-runtime:deliveries:read`、`notification-runtime:deliveries:reconcile`，三者互不蕴含。

当前一期只支持企业微信通知：

- `GET /runtime/health` — 运行状态、版本、租户/部署信息。
- `GET /runtime/capabilities` — 当前支持的 channel 与 message type。
- `POST /v1/notifications/send` — 发送通知。
- `GET /v1/deliveries` — 仅返回 token 所属 tenant/deployment 的脱敏 ledger 记录；支持单状态过滤、1–100 limit 和稳定 opaque cursor。
- `POST /v1/deliveries/{deliveryId}/reconcile` — 仅允许持证据把当前 `partial_unknown` CAS 为 `succeeded|failed`，并在同一事务追加 reconciliation audit。

发送请求：

```json
{
  "channel": "wecom",
  "integrationCode": "wecom.default",
  "sourceAppCode": "workflow",
  "touser": "zhangsan|lisi",
  "title": "审批待处理",
  "description": "你有一个新的审批任务",
  "url": "https://example.com/workflow/tasks/1",
  "btntxt": "查看详情",
  "idempotencyKey": "workflow:task:1:created"
}
```

Foundation 会向 Notification Runtime 传递解析后的可信 `sourceAppCode` 和与 Console publish 相同的稳定 `idempotencyKey`。Runtime 必须先校验 Console JWT 的签名、issuer、audience、expiry、`token_use=service`、tenant、deployment、`hzy.appCode`、`client_id` 和精确 scope，再通过 Console `/oauth/introspect` 校验 current credential/grant；请求 `sourceAppCode` 必须与 JWT 来源应用一致。inactive 返回 401，Console/网络/5xx 无法确认撤销状态时返回 503，不得降级为本地 active。

外部发送由 Notification Runtime 自有 durable `notification_delivery_ledger` 持久化；单 systemd 实例默认使用本机 SQLite（`/opt/hzy/notification-runtime/data/delivery.db`，不得放在 NFS/共享盘），多实例部署才显式选择 MySQL。唯一投递身份为 `tenant + deployment + source_app + idempotency_key`，channel、integration、规范化收件人和消息内容进入不可变 SHA-256；同键异 payload 返回 409。发送前必须取得 processing lease/fencing token；succeeded 重放返回最小公开结果且不再次调用 provider，活跃或过期 processing/partial_unknown 不得盲目重发，只有明确 failed 才能取得新 fencing token 重试。Runtime 缺 store/schema 时启动或发送失败关闭，不允许内存 fallback；不得让多个 runtime 实例同时打开同一个 SQLite 文件。

企业微信没有供应商侧幂等能力，provider 成功到 ledger success checkpoint 之间仍存在崩溃窗口。因此该契约只保证持久去重、同键冲突和 `partial_unknown` 隔离，不保证 exactly-once；不确定投递必须人工确认或经后续对账后受控处理。

Delivery 查询不得返回完整消息、收件人、幂等键/request hash、token、URL、provider body/result 或错误摘要。对账必须携 `expectedStatus=partial_unknown`、`result=succeeded|failed`、人工 reason 与最小 evidence type/reference；运行时按 tenant/deployment + delivery ID 锁行并以当前状态/fencing CAS，拒绝对 processing/succeeded/failed 盲重置。审计表只追加 actor source/client/subject、reason、证据引用与最小公开结果，不持久化新敏感 payload。

`partial_unknown → failed` 后不会由管理 API 直接发送。原业务调用方必须使用原 `sourceAppCode + idempotencyKey + 相同 payload/hash` 重放 send，才能进入现有 failed Claim/fencing 重试；同键异 hash 仍返回 409。known failed 本来即可由此重试，因此不提供 reset/retry 端点。`partial_unknown → succeeded` 后原请求只返回最小 succeeded replay，不再调用 provider。

企业微信 `corpid`、`agentid`、`corpsecret` 由 Console `wecom.default` Integration/Vault 管理；Cloudflare 业务应用不得直接保存或调用企业微信 API。

Notification Runtime 读取 Integration/Vault 时必须使用独立 service client，且该 client 的 `client_code` 与 `app_code` 都固定为 `notification-runtime`。业务 service 使用自身短期 token 直达客户 Tenant Runtime 的 `/v1/console/service/integrations/**`；Runtime 必须同时校验 `integration_config:view` / `credential_vault:resolve` token capability、本地 active credential 以及按 `integrationCode` 收敛的 grant scope，才可读取 `wecom.default`。旧 Console service Integration/Vault API 返回 410，不再读取 grant 或 Secret。安装指令生成必须幂等修复该服务身份，配置检测必须将缺失或漂移的 `app_code` 判为失败，不得只检查 client/grant 行是否存在。

托管云租户的 Notification Runtime 安装指令必须区分两个来源地址：`HZY_CONSOLE_API_URL` 使用生成指令时经过认证的租户网关 origin（例如 `https://wiztek.huizhi.yun`），确保 Integration/Vault 请求保留租户上下文；`HZY_CONSOLE_TOKEN_URL` 与 `HZY_NOTIFICATION_RUNTIME_JWT_ISSUER` 使用规范 Console issuer（例如 `https://console.huizhi.yun`）。不得把规范 issuer 直接作为租户级 Integration API base。

## Codocs API 契约

### 公司周报汇总存档投递环境前置条件

正式 Aims event-less worker 领取周报 outbox 后，以 `aims.runtime` 的 `aud=codocs`、精确 `codocs:company-weekly-summary:publish` 调 Codocs Service API；Foundation 从受信服务器配置绑定目标部署并原子设置目标 app/deployment/prefix，不能使用浏览器传入的目标。hzy0 的 Codocs editor Worker 构建物包含该 Service API，但公开 Gateway 仅放行编辑器 GET/HEAD；内部投递走其回环监听。hzy0 需显式启用私有 profile 开关、配置 Codocs 目标部署和回环地址，Console egress 仅准 Aims runtime 这一条 scope/audience；自托管生产需在 Aims 环境配置同一目标部署及 Codocs 回环 Service Binding。两种环境启用前均须核验 Codocs 目标实际部署、`aims.runtime → codocs` 与 `codocs.runtime → data-runtime` 当前 grant 和实际 JWT 签发。Codocs OSS 凭据来自 Console `oss.default` integration-config/vault，不进入 Aims 或 Codocs env 模板。未完成目标环境验证不得宣称投递已启用。

### Enterprise Host 组织资产 B2（本地候选）

`/codocs/company/{rules,notice,legal,culture,tech-specs,knowledge,templates}` 与部门开放文档由 Host 组合展示；组织资产只枚举七个固定 OSS 子目录，列表请求级完整列举后提供真实 `items/total/page/pageSize`。预览正文或 PDF 字节前先提交 `company_asset_access_records`；记录写入失败返回 503，不交付内容。访问记录列表要求 Codocs `admin:admin` 与 `company:admin`，CSV 再要求 `company:export`；快速发布要求 `admin:admin` 与 `company:publish`。部门开放集合仅由 Runtime 的显式开放目录及同部门后代、未发布、非周报谓词定义，UUID 只能收窄。短链只是路径映射，解析和内容读取均重新判定当前对象权限；部门对象的 B1 关系接线前失败关闭。

Host 使用既有 `codocs:enterprise-host:execute`，Runtime 按 `company-assets`、`open-department-documents`、`published-asset-links` 三种 resource 的固定动作与短期 permit 验证物理服务身份、签名 actor、租户和部署。记录、短链创建及快速发布的 SQL 业务写与跨应用 `service_command_receipt` 在同一事务；回执的 `source_app=enterprise` 是真实 Host 调用方，目标仍为 Codocs。目录创建/删除/移动/归档与快速发布的 OSS 操作无法加入 MySQL 事务：Host 保留用户意图 UUID，Runtime 分别提交 prepare/complete 回执，Host 在中间做条件写与对象状态核验；同键重放不得重复副作用，异载荷返回 409。存储成功而完成回执失败时，同键重试核验并收口；撤权后不得继续完成，残留 OSS 状态需运维核对。本合同不宣称跨系统原子性，也不新增 capability、grant、manifest 资源或 schema。

保存协议的源码证据、候选对象发布、generation/协作 epoch、故障恢复及分批放行约束见[个人文档写入协调合同](./Codocs-Document-Write-Coordination.md)。第一批 private 文档内部事务及两表 schema 已补，并通过隔离真实 MySQL 并发/回滚测试；没有注册 HTTP 路由、安装环境 schema 或提供正式存储 verifier。现有 v1 保存/读取路径未切换，不能据此认为当前 API 已提供并发安全或原子正文/Yjs 发布。

### Enterprise 个人文档接入候选（2026-09-19，未启用环境）

2026-09-21 版本详情收敛：Enterprise 的 `codocs.personal-document-version-view` 保持精确 `codocs:personal-documents:read`、已验签 actor 与短期 read permit，固定转为 `GET /v1/codocs/documents/{uuid}/versions/{versionId}`。Codocs Runtime 先验证受信委托，再执行当前文档 ACL，随后以版本 ID 与文档 ID 同时约束单行；不存在返回 404。版本列表仍为独立读取操作，详情不再下载整份历史后在 Host 过滤。当前 hzy0 连接的 Runtime 尚未更新，代码通过不等于该环境版本链通过。

2026-09-20 保存重放修正：`PUT /codocs/api/documents/{uuid}` 在任何 OSS 调用前，经 Foundation 固定 `codocs.personal-document-update-plan` → `POST /v1/enterprise/codocs/personal-documents:update-plan`（精确 `codocs:personal-documents:edit`、documents:edit、签名 actor 与短期 edit permit）核对当前 owner/write-share、只读/删除状态和原命令回执。计划为只读，复用 `codocs-document-update.v1` 摘要与命名空间；输入 title 及可选 content_sha256/content_size/save_mode，不接受浏览器 OSS path/version/owner。成功同 key 重放直接返回成功、不调用 OSS；异命令 409，异常回执/依赖故障失败关闭。未成功请求才沿原路径存储并在其后重新授权，原 update 同事务提交文档版本及 receipt。未新增 schema、capability 或 grant，只新增已有 edit 能力下的固定计划路由；发布须更新对应 Runtime，不能只更新 Host。

此修正仅关闭“已有成功回执的旧请求覆盖后来正文”，不能把只读计划当成写锁。尚未完成请求并发、存储后提交失败/撤权的补偿、Collab 竞争写仍是发布前未关闭风险。当前集成为版本化 OSS；[官方 PutObject 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)明确版本控制开启/暂停时 `x-oss-forbid-overwrite` 无效，也未声明此 PUT 的 `If-Match` 条件覆盖保证，因此不以模拟条件头测试宣称环境并发安全。此前创建/文件柜“条件写”记录是代码及隔离测试证据，真实 provider/桶模式下的保证必须另外核验，不据此扩大完成结论。

个人柜转文档增量：Host `POST /codocs/api/cabinet/{uuid}/to-document` 只接 title/folder_id 和有效 Idempotency-Key，同时要求 documents:view/create。固定 Runtime `personal-cabinet:{conversion-plan|convert}` 使用精确 `codocs:personal-cabinet:create`、物理 enterprise.runtime、签名 actor 和短期 create permit；不开放浏览器指定 owner/路径/文档 UUID。只读计划重验源文件当前 owner、非部门项目、未删除以及目标个人目录/标题，稳定 UUID 绑定租户/Codocs deployment/actor/key，目标路径绑定源 UUID/标题/目录的意图摘要、源状态及转换正文摘要。

Host 使用请求级 OSS 读取原 DOC/DOCX 字节，复用 Office→Markdown 转换；无效格式返回 422（未宣称旧二进制 DOC 已验证可转）。正文最多 10 MiB，条件 PUT 不覆盖，已有对象及并发赢家须匹配摘要和长度。存储成功后重新取得权限，Runtime Serializable 事务锁定源和目标、重验状态/目录/重名，将 documents、owner relation 和 cabinet 转存关联一起提交；任何失败回滚数据库，不删除原文件或失败阶段保留的存储对象。旧成功请求重放返回同一文档，不覆盖后续编辑、不重新关联后来发生另一转换的源文件、不复活已删除目标；当前归属改变仍拒绝。前端失败保留会话/源/标题/目录绑定 key，异步响应重验当前会话/选中文件；关联信息失败不伪造路径、不把已成功转换改报失败。隔离测试与本地构建不等于真实 DB/OSS/Worker 大文件验收；目录选择已接 page/pageSize/total 和失败重试；环境启用及整个页面组合仍未完成。此前增量段落中的“转换未完成”由本段更新代码状态。

个人柜上传增量：Host `POST /codocs/api/cabinet/upload` multipart 保留原扩展名集合（不含 Markdown）及单文件 100 MiB，前端逐文件发送、失败保留批次/字节/顺序/会话绑定的请求键。固定 `personal-cabinet:upload-plan` 与 `personal-cabinet:upload` 都要求精确 `codocs:personal-cabinet:create`，物理 enterprise 身份；Host 分别在规划与 OSS 后提交前重新准备身份、检查 documents:create 并生成短期 permit。owner 只能来自当前主体，body 不接受 UUID/路径/部门/项目范围。计划只读，当前目录归属及已存在文件状态先检查；UUID 由租户/Codocs deployment/actor/key 派生，完整元数据（含内容 SHA-256）摘要写入新对象路径，旧数据和对象路径不变。

OSS 使用 event 配置、条件 PUT 不覆盖；重试 HEAD 必须匹配内容摘要元数据与长度，条件冲突必须确认赢家对象，失败不能提交 DB。成功存储后 Runtime 事务锁定目录和 UUID，再次校验当前 owner/个人目录及 cabinet 非部门/项目范围，依赖 cabinet_files.uuid 唯一键重放返回原记录；元数据或内容变更、已删除记录 409，归属改变 403，不复活删除记录。数据库与 OSS 不是同一事务：提交失败保留对象以重试，不删除并发请求可能拥有的对象，也不宣称失败对象已清理。转换写链、环境授权和真实联调仍未完成。

个人柜删除增量：`DELETE /codocs/api/cabinet/{uuid}` 只接受合法 UUID 和 `Idempotency-Key`，不接受 body/query。Host 在准备 Runtime 身份后重取 documents:delete，发送固定 `personal-cabinet:delete` / 精确 `codocs:personal-cabinet:delete`，物理 enterprise 身份不变。原 Codocs DB 事务锁定当前 actor 所有且 dept_code/project_code 为 NULL 的行（包含已删除行以支持重试），与 durable receipt 同事务更新 status/deleted_at；成功重放不再更新后来恢复的记录，换文件复用 key 返回 409，归属变更后旧回执不能绕过当前范围。无 OSS 删除/移动，不删除 converted_doc_uuid 对应文档。客户端按会话/UUID 保留失败请求键，成功后清除。环境 grants 尚未启用。

个人文件柜读取增量：Host `GET /codocs/api/cabinet` 支持 page/pageSize/folder_id，默认 20、最多 200；兼容 owner_uid 仅允许当前用户。`/{uuid}/preview`、`preview-html`、`preview-pptx`、`converted-info` 使用 documents:view 与精确 `codocs:personal-cabinet:read`；`/{uuid}/download` 独立要求 documents:export 与 `codocs:personal-cabinet:export`。固定 Runtime `personal-cabinet:{list|view|download|converted-info}` 经 Enterprise 物理身份直达原 Codocs adapter，SQL 固定当前 owner、非部门/项目、未删除范围；不开放泛型路径代理。转存信息还须通过目标文档当前 ACL，仅目标不存在/已删除返回 null，撤权和依赖故障不伪装无关联。

Host 按返回 UUID/owner/个人柜规范路径再次校验元数据，OSS client 只用当前 event 配置；文本复用限长编码预览，Office HTML 设 CSP sandbox，PPTX 返回原字节，直接预览和下载签名有效期 300 秒。存储 404 与依赖 503 区分且脱敏，响应 no-store；内部 Office/PPTX URL 使用 Host `/codocs` 前缀。源页面使用真实分页/total，失败显示重试，账号与文件切换丢弃旧预览响应；standalone 列表 BFF 同步保留 Runtime 分页字段。转文档写链及环境 grants 尚未迁入，本增量不代表完整文件柜交付。

回收前置查询增量：`GET /codocs/api/documents/check-name` 对应固定 Runtime `personal-documents:check-name`，复用精确 read capability 和 documents:view。只接 title/doc_type/folder_id/exclude_uuid，owner 从签名 actor 注入；支持 private/slide/worklog/weekly-report，目录省略归一为根目录，拒绝部门/项目与伪造范围。trash 允许个人 type 筛选并强制 owner=actor。Host 下的 useRecycleBin 已适配请求前缀，名称/列表检查失败或响应无效会抛错而非伪装 false/空列表，恢复弹窗检查失败时禁止提交。

删除/恢复候选已接线：Host `DELETE /codocs/api/documents/{uuid}` 使用 documents:delete 和精确 `codocs:personal-documents:delete`，仅更新回收状态，保留原 OSS key 与 Yjs；当前 ACL/只读状态和幂等回执在原 Codocs DB 同事务处理。历史删除请求重放不会再次删除后来恢复的文档。

Host `POST /codocs/api/documents/{uuid}/restore` 仅接可选 new_title 和 Idempotency-Key，使用 documents:edit 与精确 `codocs:personal-documents:edit`，依次调用固定 `personal-documents:restore-plan` 和 `personal-documents:restore`。计划绑定 UUID、归属、类型、目录、标题、路径、状态和时间戳；原 codocs/ key 保持不变，历史 recycle.bin/ 对象条件复制到按 UUID/状态摘要隔离的 codocs/document-restores/ key，保留源对象并处理存活的 Yjs 快照。正文和快照均不存在时拒绝恢复，存储失败不提交元数据；复制完成后重新取得业务权限，事务中再锁定文档/分享 ACL、原目录并检查同命名空间标题冲突。Serializable 恢复事务连同回执提交；旧请求重放不再次恢复后来删除的文档，修改同 key 的用户意图返回 409。check-name 仅是用户提示，不替代提交校验。旧 standalone restore 不因此改变；真实数据库并发、OSS 联调及外部回收保留期/物理清理规则仍待核验。

新增 Host 读取入口 `GET /codocs/api/documents`、`GET /codocs/api/documents/{uuid}`、`GET /codocs/api/documents/trash`、`GET /codocs/api/folders`。BFF 从 Host 会话取得 actor，并检查逻辑 Codocs `documents:view`，然后通过 Foundation Enterprise Runtime client 调用固定的 `POST /v1/enterprise/codocs/personal-documents:{list|view|trash|folders}`。物理身份始终是 `enterprise/enterprise.runtime`；逻辑来源与目标为 Codocs，精确传输 capability `codocs:personal-documents:read` 由 Codocs manifest 定义，不以 `codocs.read` 代替，也不授予普通用户角色。

Runtime 复用 Enterprise 当前凭据/grant 校验、签名 actor 与最多 15 秒的 tenant/Host deployment/resource/action permit；按动作白名单重建 query，拒绝调用方 actor/owner/部门特权标记，私人列表与目录 owner 从签名 actor 派生，列表默认 20、单页最多 200。仅调用现有 `s.codocs` 用户域读取，保留其独立数据库与 owner/share/relation ACL，不改旧 Codocs service-only 或其他跨应用合同。该候选不是通用 Runtime 路径透传。

上述四个文档读取是初始入口，创建、上传、软删除/恢复及文件柜读取的后续进展见本节增量合同。正文覆盖与协作协调、文件柜写入、共享副作用、日志/周报/演示、完整页面依赖、目录与回收站分页、manifest 组合及环境 grants 仍须继续完成。未注册新页面、未切换网关、未部署或宣称整合完成；按用户要求跳过浏览器页面验证，不跳过服务端与非页面测试。

后续候选增量：Host `PATCH /codocs/api/documents/{uuid}` → `POST /v1/enterprise/codocs/personal-documents:edit-metadata`，精确 capability 为 `codocs:personal-documents:edit`，BFF 要求 Codocs `documents:edit`。只接受 title、folder_id、star_flag、home_flag、readonly_flag；Runtime 再验证字段形状及原有 owner/share 写 ACL、只读转换、目标目录范围。拒绝浏览器存储路径、owner、actor、doc_type、部门/项目归属和任意额外字段。此接口只改元数据，目录移动保留已有 OSS key，不搬移正文或复制写入实现；相同 actor/租户/部署/UUID/期望值派生稳定幂等键，仍重验当前权限。正文替换、删除、恢复及目录 CRUD 不以这个接口代替。

演示目录补充：`slide` 与 `private` 同属个人目录 namespace，创建 owner 只取受信 actor；父目录须同类型、同 owner 且不能带其他部门/项目归属。它不是部门权限的另一种表现。目录详情与修改/删除旧合同仍缺失，必须补齐后才能视为完整 mydocs 可用。

目录候选增量：`GET/PATCH/DELETE /v1/codocs/folders/{id}` 已新增受信 actor 范围合同，详情仅个人 owner 或精确部门 read marker，写入仅个人 owner 或精确部门 manage marker。PATCH 只改 name/parent_id；事务内锁定目录并检查同 namespace 父目录和祖先循环。DELETE 在事务内检查子目录及全部关联文档（包括回收站文档），非空返回 409，不递归删除业务数据。Host 对应 `/codocs/api/folders/{id}` 三方法直达 `/v1/enterprise/codocs/personal-folders:{view|update|delete}`，分别要求 manifest 精确 read/edit/delete；Host 本批只传个人 actor，不接受浏览器部门特权 marker。目录创建的 Host 接入、所有文档创建/移动写入与目录删除间的并发一致性仍待闭合，sqlmock 事务测试不代表真实并发验证。

元数据底层校验补充：`updateDocument` 现在明确限制 readonly 标记只能由 owner 改动，share-write 不包含该权限；移动文档按原文档 namespace 检查目标目录，并在仅移动不改标题时检查目标同名冲突。同次修改 namespace 不能绕过目标校验。此前仅 ACL/传输测试不能证明这两个不变量，新增专项用例单独覆盖。

创建目录候选：Host `POST /codocs/api/folders` → `POST /v1/enterprise/codocs/personal-folders:create`，要求 `documents:create`、精确 `codocs:personal-folders:create` 和调用方 `Idempotency-Key`。只允许 private/slide，忽略不了的伪造 owner 被 BFF 拒绝；Runtime 从已验证 identity 派生 owner，在原 Codocs DB 的 `service_command_receipt` 与 folder INSERT 同事务执行。租户/Codocs deployment/actor/key 构成回执 namespace，相同 key 不同业务内容返回 409；重放不再次创建，仍重验当前父目录及目标 owner。物理服务身份保持 enterprise.runtime，逻辑回执归 Codocs，不迁表、不新建另一套回执表。启用须核验 Codocs deployment binding 与既有 receipt schema。

正文读取候选：Host 文档详情在 Runtime ACL 通过后，以返回的 UUID/type/OSS key 读取正文；支持 `skip_content=1`，空 Markdown 可从同一对象 Yjs 快照恢复，缺对象返回 404，存储故障返回脱敏 503。带 event 的 Codocs OSS client 使用该请求返回的配置，不写入或回读进程全局配置；无 event 的独立应用启动兼容路径不变。项目冲突元数据、附件下载/写入及完整发布链仍未验收，不以一般正文读取代替。

正文下载与访问审计候选：`GET /codocs/api/documents/{uuid}/download` 通过 `documents:export` 和 `codocs:personal-documents:export` 取得 ACL 校验的元数据，再返回 Markdown 附件（安全编码文件名）。company 路径在正文读取/恢复成功后、返回内容之前，调用内部 `POST /v1/enterprise/codocs/document-access-records:record`，要求精确 `codocs:document-access-records:record` 与短期 record permit；Host 按原动作重新校验 view 或 export，不能要求只有 export 的用户同时具备 view。输入仅文档 UUID、服务器生成的 eventId 与元数据 OSS 路径的 SHA-256；Runtime 重验当前文档 ACL、company 路径格式及摘要一致性，路径变化返回 409，不信任浏览器指定 actor/path。事件 ID 用于幂等重试，记录使用原 Codocs 表与 Runtime 时间；skip_content、私人路径和存储失败不记录，审计失败不交付已加载正文并返回脱敏 503。此为访问审计，不是读取触发的业务状态变更；无浏览器直达审计接口，未改变独立 Codocs 的 source_app 边界。环境 capability 安装与完整非页面业务验收尚待完成。

审计错误映射：上述 503 仅指依赖故障；当前授权失效保留 401/403，存储路径变更保留 409，均使用固定脱敏消息且不返回正文，不把撤权伪装为服务故障。

个人文档创建候选：Host `POST /codocs/api/documents` → Runtime `POST /v1/enterprise/codocs/personal-documents:create`，要求 `documents:create`、精确 `codocs:personal-documents:create`、签名 actor 与 `Idempotency-Key`。仅 private/slide，Host 接受 title/doc_type/folder_id/content 和与会话相同的兼容 owner_uid；Runtime 仅接收 title/doc_type/folder_id/content_sha256/content_size，拒绝调用方 UUID、OSS path 和 owner。租户/Codocs deployment/actor/key 生成稳定 UUID，规范化请求摘要生成初始对象路径；复用既有 createDocument 事务（文档及 owner relation）及 documents.uuid 唯一键，不另造文档写入域。相同请求复用创建结果，改请求内容或重放对象元数据已不匹配时 409，不恢复已删除对象或覆盖后续编辑。个人目录在新建事务中锁定并验证类型/owner，重放也重新校验当前目录。

Host 在 Runtime 成功后以请求级 OSS 配置写初始 Markdown，正文上限 10 MiB。先 HEAD，再条件创建（forbidOverwrite），并发条件冲突仅确认已有对象，不进行无条件覆盖。数据库与 OSS 非原子：存储失败保留元数据并返回脱敏 503；同一请求重试可修复缺失正文。前端普通文档/演示创建保留失败键，内容或会话范围变化重新生成，成功后释放。上传、覆盖正文、日志/周报创建为其他动作，仍需各自闭合，不能以此合同冒充完整写链。

上传增量：`POST /codocs/api/documents/upload` 采用 multipart，但每项复用上述创建编排与精确 create capability，不增加跨应用代理。仅接 files、doc_type、folder_id、兼容自身 owner_uid；只接受 UTF-8 Markdown，单文件 10 MiB、批次 30 文件/30 MiB，拒绝重复标量、任意路径和其他归属。Host 在解析前检查 create 权限，每项调用前再次读取权限并签发短 permit。批次键+租户/部署/actor/序号派生单项幂等键；客户端以文件字节摘要、顺序、目录和会话识别同批失败重试，成功项不覆盖、失败项可补写。单项错误脱敏计入 results，401/403 保留请求错误而不伪装普通文件失败。

成功上传通过 Foundation `reportOperationAudit(payload,{event,idempotencyKey})` 上报 Console 既有 audit audience/audit:write API。物理 sourceApp 为 enterprise，逻辑 action 为 codocs.document.upload；配置、令牌、Console Service Binding 均按请求上下文处理，审计键同样隔离主体与批次项。保持旧上传 best-effort 操作审计语义，失败不回滚已完成文件，不能将其与必须成功的 company 访问审计混同。环境仍需验证 Enterprise→Console audit grant 与存储条件写能力；源码接线不代表已启用。

**Base URL**: `{CODOCS_API_URL}/api/v1` 或 `/api/documents`
**认证**: Cookie 转发

- `POST /api/documents` — 创建文档
- `GET /api/documents/{uuid}` — 获取文档
- `POST /api/v1/documents/{uuid}/preview-access` — service-only，当前因缺少可验证的 AIMS 用户委托而 fail-closed；签名 service-command 合同落地前不会写入预览关系
- `POST /api/v1/service/project-documents/{uuid}/content` — 仅用于 Aims 已关联项目文档的正文读取。Aims 必须先以已验证浏览器 actor 证明 active member/leader/creator/scoped-admin 与 `project_documents.codocs_uuid` 或 `deliverables(document)` 的精确 UUID 关联；随后固定发送 `source_app=aims`、`client=aims.runtime`、`aud=codocs`、精确 capability `codocs:project-document:content:read`、tenant/deployment、actor UID、project code、UUID、`content:read` 动作和 one-shot service-command。Aims 用刚签发的短时目标 service token 对 method/path、tenant/deployment、source/target app+client、固定 operation/capability/idempotency/schema、command hash 与 request ID 做 60 秒 HMAC；Codocs 在读 runtime/OSS 前先验 token、绑定与首跳 HMAC，随后才用自身 runtime bearer 重签第二跳。runtime 只接受受签名 actor 和 `status=1` 文档，并再次执行 Codocs owner/share/relation 原 ACL；不把 Codocs 的物理 `doc_type` 或可空 `project_code` 当作 Aims 项目边界，因为历史项目关联可以指向部门文档等已有文档。Aims 项目关系不是 Codocs ACL 的替代；请求 body 的 project/role/OSS 字段均不被信任。响应只含 UUID、标题、类型、大小、更新时间与正文，绝不返回 OSS path、签名 URL、grant 或策略细节。Aims 项目文档预览必须复用该只读合同并在 Aims 内渲染正文，不得先调用 fail-closed 的 `preview-access` 写关系，也不得从 Worker 回环租户网关访问 Codocs。Aims 调用 Codocs `POST /v1/codocs/document-access/check` 时使用 `codocs.read`；该 POST 是结构化只读判定，不得因 HTTP 方法错误提升为 `codocs.write`。项目成员编码与项目角色只能由 Aims BFF 从权威 runtime 事实派生，通过完整 request-target HMAC 绑定的专用 query marker 传入；Codocs runtime 仅在签名 actor 委托有效且 `hzy_runtime_source_app=aims` 时接受，请求体中的同名 project/role 声明始终忽略。存量租户通过 `console/docs/sql/Console-SQL-Seed-v1.99-aims-codocs-runtime-read.sql` 为有凭据的 `aims.runtime` 补齐 `data-runtime:codocs:read` 与 `tenant-runtime:codocs:read`，并用同版本 verify 核验；生产环境无直连 SQL 时，仅 `service_clients:admin` 可通过 Console BFF 触发固定的 `POST /v1/console/admin/service-grant-repairs/aims-codocs-runtime-read`，Runtime 同时要求 `console:service-client:grant` 与已签名的真实管理员 actor。该入口不接受 client/resource/action/scope 参数，只能幂等补齐上述两条授权并写操作日志，不得扩大为 `codocs.write`。

Aims 工作项源章节读取按不同文档 UUID 去重，并以最多 4 个 worker 有界并发调用上述逐文档合同；同一文档的多个锚点复用一次请求结果。该优化不改变逐 UUID 的 Aims 关系证明、one-shot command 与 Codocs ACL 复核，不得为减少请求恢复已退役的通用 batch/content 合同。

Codocs 的文档分享、版本、批注/回复和问题评论只允许其文档、批注或问题嵌套路由调用；不存在跨模块或浏览器可用的 `/v1/codocs/document-shares|document-versions|annotations|annotation-replies|issue-comments/**` generic CRUD 合同。runtime 对这些直达路径返回 `503 scoped_resource_contract_required`，不得用 generic table mapping 绕过父对象 ACL。

Codocs 部门开放文档使用自身 BFF 到 tenant-runtime 的专用 `GET /v1/codocs/open-department-documents` 用户态合同。合同要求 Foundation 签名 actor，只返回显式开放部门目录、同部门后代目录及其中的有效未发布非周报文档；可选 UUID 只负责收窄，不能扩大集合。部门负责人设置开放状态时，BFF 先对请求部门执行负责人校验，再通过 `PATCH /v1/codocs/folders/{id}/open` 传递精确受信管理部门标记，runtime 必须复核目标目录部门后才写入。普通 folder/document ACL 不因开放文档能力而放宽。

`GET /api/v1/documents/search` 与 `POST /api/v1/documents/batch-summary`（及 `/api/v1/codocs/**` 兼容别名）不再是有效 service 合同：宽 `codocs:documents:read` 无法证明 project/document 范围，BFF 与 `/v1/codocs/documents/{search|batch-summary}` runtime 均返回 `503 scoped_document_service_contract_required` 且零 DB。保留摘要/正文/URL 或创建能力前，必须分别落地绑定 source/target、tenant/deployment、actor、文档 UUID、来源对象范围、动作和时限的专用 signed service-command；不得恢复通用 read/write scope 路径。

上述 Aims 单文档正文命令只恢复其精确路径；summary、URL、通用搜索、批量摘要、preview relation 与非 Aims 来源仍维持 fail-closed。Aims 新建项目的部门文档选择使用独立的 `POST /api/v1/service/department-documents/search`：Aims 与 Codocs 分别确认签名 actor 对精确部门的访问，首跳绑定 `source=aims/client=aims.runtime`、tenant/deployment、actor、dept、pageSize、action、60 秒 command MAC 与精确 `codocs:department-documents:list`；Runtime 从签名 command 重建筛选，只返回 exact department 下 active `department` 目录和文档的最小摘要。按产品规则，这些可读部门文档均可作为立项书候选，不要求预置 `project_proposal` 分类；候选资格不授予绑定后的正文读取，后续仍由项目关系与 Codocs 原 ACL 的专用正文合同共同校验。浏览器 UUID/query、通用 `codocs:documents:read` 和 Aims 直连 Codocs tenant-runtime 均不可替代。

Altoc 只通过两条精确命令访问已有 Codocs UUID：预览 `POST /api/v1/service/altoc-entity-documents/{uuid}/content` 和关联前授权 `.../{uuid}/attach`。F 中 Altoc 先以当前会话完成实体 `view` 数据范围和 `document_link(entity_type, entity_id, document_uuid)` 精确持久关联；H 中先完成实体 `edit` 数据范围和实体存在性读取。两者再以 `source_app/client=altoc`、精确 capability、actor、允许的实体类型、实体 ID、UUID、action、tenant/deployment、固定 envelope 与 60 秒首跳 HMAC 调 Codocs；Codocs 使用自身 runtime bearer 重签第二跳，runtime 对该 actor 重施原 owner/share/relation ACL。关联额外要求 active 文档且 owner 或显式 `document_shares.permission=write`，relation/read share、只读、归档均拒绝；预览只要求原 read ACL。`document_link` 以 `(entity_type, entity_id, document_uuid)` 重放返回既有 ID。实体权限从不替代 Codocs ACL，响应不返回 OSS path、签名 URL 或策略细节；不恢复 generic summary/search/batch/content。v1.53 seed/verify 仅为待批准输入，未执行。

Codocs Issues 是单项目 user-domain 合同，不提供 actorless service 或跨项目 generic CRUD：BFF 仅在 Console Directory 项目/成员/部门事实与 Foundation scoped `codocs/projects:view|edit` 在同一授权判断通过后，才写入 request-target HMAC 覆盖的 `codocs_trusted_issue_project_code`。Runtime 的列表、待办、详情、创建、更新、删除和评论均以该精确 marker 约束 SQL；浏览器 `project_code`、actor 或 marker 不是受信输入。创建或改关联的 `document_uuid` 仅可指向同项目 active `project|git-project` 文档；没有任何新 service grant、schema 或 migration。

Codocs 发文流程定义、路由和审批节点由 Workflow 唯一管理；Codocs 只保存 `document_publish_requests` 业务关联与审批终态投影。Workflow 回调写入 `approved` 后，用户态 `POST /api/reviews/{id}/archive|seal|send|receive` 由 Codocs BFF 校验会话权限并转成 `/v1/codocs/reviews/publish-requests/{id}/archive-plan|archive|seal|send|receive` 专用 runtime 命令。归档采用两阶段编排：runtime 先锁定申请并派生稳定发布 UUID、包含申请 ID 的唯一 OSS 路径和初始执行状态，BFF 只复制 OSS，随后 runtime 再锁定申请并在单事务中创建发布文档、更新源文档 `publish_info`、写执行状态及 `document_relations`。盖章、发送、接收分别只接受 `pending_seal`、`pending_send`、`pending_receive`，最终为 `received`；每次重放必须与既有记录完全一致，否则 409。`archive` 和 `send` 只允许申请发起人，`seal` 的 `reviews:admin` 与 `receive` 的指定发送人校验由 BFF 权限和 runtime 对象事实共同收敛。旧 `document_reviews` 只读兼容，不再接收这些写操作；OSS、通知、临时快照清理由 BFF 在事务提交后编排。

详细接口定义：`codocs/docs/CODOCS_API_SPEC.md`

## Altoc ↔ Aims 桥接契约（契约有效，首轮 service 端点与编排入口已落地）

采用**双数据库桥接模型**，不合并数据库：

| Altoc 实体      | Aims 字段         | 方向        |
| --------------- | ----------------- | ----------- |
| 商机 opp_id     | aims_projects.opp_id | Altoc → Aims |
| 合同 contract_id | aims_projects.contract_id | Altoc → Aims |
| 回款节点        | milestones.payment_term_id | Altoc → Aims |
| 客户 customer_code | aims_projects.customer_code | Altoc → Aims |

原则：Altoc 管经营/财务视角，Aims 管交付执行视角。里程碑 PIVR 阶段映射到合同回款节点。

当前状态：业务契约已接受。Phase 1 已落地 Altoc 合同生效交付编排入口、Aims 合同项目桥接、付款条款里程碑同步、Altoc 回款计划可开票 service endpoint、Altoc 发起 Finance 开票申请、Finance submit 审批提交、Altoc 合同 Finance 摘要展示，以及 Finance 核销后回传 Altoc 回款计划摘要的 service endpoint；Aims 验收完成后可自动按 `payment_term_id` 推进 Altoc 回款计划，Finance 核销完成后可自动刷新经营侧已收 / 未收 / 状态。实现时不得合并数据库或复制对方主档。

## 客户合同交付与回款闭环契约（Phase 0 冻结）

本节是 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` Phase 0 的跨模块执行合同，用于约束首条端到端闭环：“Altoc 合同 → Aims 交付项目 → Finance 开票/到账/核销 → Assets 交付视图”。

### 事实源与稳定业务键

| 业务对象 | 唯一事实源 | 稳定业务键 | 消费模块 | 约束 |
| --- | --- | --- | --- | --- |
| 客户 | Altoc `customer` | `customer_code` (`customer.code`) | Aims / Finance / Assets / Console | 其他模块只保存编码和名称快照 |
| 商机 | Altoc `opportunity` | `opp_id`，后续补 `opportunity_code` | Aims / Finance | Aims 只引用，不推进销售阶段 |
| 合同 | Altoc `contract` | `contract_code` (`contract.code`)，兼容 `contract_id` | Aims / Finance / Assets | 其他模块不复制合同主档 |
| 合同行项目归属 | Altoc `contract_project_line_rel` | `project_code + contract_line_code` | Finance / Aims / Assets | `contract_project_link.line_codes_json` 仅是兼容快照 / 回退，不是首选真值 |
| 合同行成本分摊 | Altoc `contract_line_cost_allocation` | `contract_line_code + project_code + allocation_type + effective period` | Finance / Aims | Goal 3 新增；合同利润重算前由 `contract_project_line_rel` 自动物化为核算归因快照，也支持手工显式规则；项目成本必须通过 `project_code` 和分摊规则进入合同行，不允许未配置规则的项目成本静默归属 |
| 合同行 / 客户毛利摘要 | Altoc `contract_line_profit_summary` / `service_cost_summary` | `contract_line_code + period + calculation_key` / `service_agreement_code + project_code + period + calculation_key` | Finance / Aims / Console | Goal 3 新增；均为可重算派生数据，保留 calculation key 和版本，不覆盖历史计算；合同行利润摘要可冻结，冻结后禁止普通重算和分摊改写 |
| 付款条款 | Altoc `contract_payment_term` | `payment_term_id` | Aims / Finance | Aims 里程碑只映射，不修改条款 |
| 回款计划 | Altoc `receivable_plan` | `receivable_plan_code` (`receivable_plan.code`) | Finance / Console | Finance 通过摘要或回调触发经营侧状态刷新 |
| 交付项目 | Aims `aims_projects` | `project_code` | Altoc / Finance / Assets | Altoc 不维护项目执行状态 |
| 项目成本摘要 | Aims `project_cost_summary` | `project_code + period_start + period_end + calculation_key` | Altoc / Finance | Goal 3 新增；Aims 只聚合 `time_entries` 和调用方提供的成本单价，不复制 Finance 明细账或 Altoc 合同主档 |
| PIVR 里程碑 | Aims `milestones` | `project_code + milestone_id`，映射 `payment_term_id` | Altoc / Finance | Aims 是里程碑状态事实源 |
| 项目文档 / 交付物 | Aims `project_documents` / `deliverables`，正文在 Codocs | `document_uuid` / `codocs_uuid` | Altoc / Assets / Finance | 其他模块只保存文档 UUID 和标题快照 |
| 开票申请 | Finance `invoice_request` | `invoice_request_code` (`invoice_request.code`) | Altoc / Workflow | Altoc 可发起，不生成发票事实 |
| 正式发票 | Finance `finance_invoice` | `invoice_code` (`finance_invoice.code`) | Altoc / Aims | Finance 是发票事实源 |
| 到账记录 | Finance `finance_receipt` | `receipt_code` (`finance_receipt.code`) | Altoc / Aims | Finance 是到账事实源 |
| 收款核销 | Finance `finance_reconciliation` | `reconciliation_code` | Altoc / Aims | Finance 是核销事实源 |
| 合同财务摘要 | Finance `finance_contract_summary` | `contract_code` | Altoc / Aims / Console | 摘要可读，计算事实仍在 Finance |
| 交付视图 / 环境 / 资产 | Assets `asset_delivery_views` / `asset_environments` / `customer_delivery_assets` / `customer_delivery_asset_environment_rel` / `asset_items` | `delivery_code` / `environment_code` / `delivery_asset_code` / `asset_code` | Aims / Altoc / Finance | Assets 不维护合同、项目、财务主档；`customer_delivery_assets.environment_code` 仅是主环境兼容快照，完整事实以关系表为准 |
| 审批实例 | Workflow `flow_instances` | `instance_no` + `app_code/resource_code/biz_id/action_code` | 全业务模块 | Workflow 只保存审批流转事实，不保存业务终态 |

### Goal 2 交付环境身份链路

对象主责关系：

```mermaid
flowchart LR
  AltocPlan["Altoc contract_delivery_asset_plan<br/>source_plan_code"]
  AssetsAsset["Assets customer_delivery_assets<br/>delivery_asset_code"]
  AssetsRel["Assets customer_delivery_asset_environment_rel"]
  AssetsEnv["Assets asset_environments<br/>environment_code"]
  AimsRel["Aims project_environments<br/>project_id + environment_code"]
  AltocCoverage["Altoc service_agreement_coverage"]

  AltocPlan -->|创建或同步正式资产| AssetsAsset
  AssetsAsset --> AssetsRel
  AssetsEnv --> AssetsRel
  AimsRel -->|只保存执行关系和版本快照| AssetsEnv
  AssetsRel -->|正式对象回写| AltocCoverage
  AltocPlan -->|pending source_plan_code| AltocCoverage
```

标准实施时序：

```mermaid
sequenceDiagram
  participant Altoc
  participant Assets
  participant Aims

  Altoc->>Assets: create customer_delivery_asset from source_plan_code
  Assets-->>Altoc: delivery_asset_code
  Aims->>Assets: environments/upsert with idempotency key
  Assets-->>Aims: environment_code
  Aims->>Aims: upsert project_environments as pending sync
  Aims->>Assets: bind delivery_asset_code to environment_code
  Aims->>Assets: lifecycle:sync when online or accepted
  Aims->>Aims: mark project_environments synced or failed
  Assets->>Altoc: status:sync sourcePlanCode + deliveryAssetCode + environmentCode + projectCode + occurredAt
  Altoc->>Altoc: resolve pending service_agreement_coverage
```

Assets 环境主状态以 `asset_environments.status` 表达 `planning / active / frozen / retired`；`online` 和 `accepted` 输入会归一为 `active`。验收完成事实以 `asset_environments.accepted_at` 或交付资产-环境关系 `deployment_status = accepted` 判断，不依赖 `asset_environments.status = accepted`。

### Service API 合同

以下 endpoint 是跨模块 service API 合同基线。标记为“待实现”的端点不得绕过 Console service token 或引入共享 secret；若先复用已有用户侧 API，必须补 service token 校验、scope 校验和幂等规则。状态截至 2026-06-22。

| 调用方 | 被调用方 | Endpoint / 事件 | 认证 | 幂等键 | 状态 |
| --- | --- | --- | --- | --- | --- |
| Altoc UI / Workflow / service | Altoc | `POST /api/v1/service/contracts/{contractCode}/activate-delivery` | 用户需 `contract:edit` 权限；service 调用 Console service token，`aud=altoc`，`scope=altoc:write` 或 `altoc:contract:edit`，来源仅允许 `altoc` / `workflow` | `altoc:contract:{contract_code}:activate-delivery:v1` | Phase 1 已实现 Nuxt 编排入口：先创建 Altoc 履约启动作业，激活合同并生成回款计划；仅当启动计划包含项目步骤时按 `project_plans` 调用 Aims 创建 / 复用多个项目和同步里程碑，并回写步骤状态 |
| Altoc | Aims | `POST /api/v1/service/projects/from-contract` | Console service token，`aud=aims`，`scope=aims:write`，来源 `altoc`；可靠链路使用标准 service-command envelope | 每次 activation + `plan_key` 一条 project operation | G3 可靠化：Altoc 在合同激活/回款计划事务中按 plan 冻结单目标 project operation；Aims 项目 mutation 与 receipt 同事务。同一 plan 使用 source 确定并显式下发的 `project_code`，不依赖前序 response 改写后续命令 |
| Altoc | Aims | `POST /api/v1/service/projects/from-opportunity` | Console service token，`aud=aims`，精确 `scope=aims:project:create-from-opportunity`，来源仅 `altoc`；强制标准 service-command envelope，并校验 tenant/deployment/target app/command hash | receipt 使用调用方冻结键；业务唯一键为 `opp_id + category`，同商机同 `presales` / `sales` 类型返回既有项目 | PIVR V1.1 B4：Aims 解析对应已发布模板并在 receipt 事务内创建项目、经理成员、里程碑/交付物；Altoc 继续拥有商机状态与主数据，Aims 不反向修改。Console v2.3 seed/verify 同时登记 Aims BFF、data-runtime 与 tenant-runtime audience 的精确 grant。 |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/by-contract/{contractCode}` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | Phase 1 已实现；兼容旧单项目读取，P1 项目选择必须使用 `eligible-for-contract` 或 Altoc `project_plans` |
| Altoc / Aims | Aims | `GET /api/v1/service/projects/eligible-for-contract?contract_code=&customer_code=&search=` | Console service token，`aud=aims`，`scope=aims:read` | 读接口不要求；使用 `x-hzy-request-id` 追踪 | P1 已实现：返回同客户、未归档、未绑定合同或已绑定当前合同的项目候选，用于 Altoc 关联已有项目 |
| Altoc / Aims | Aims | `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync` | Console service token，`aud=aims`，`scope=aims:write`；可靠链路使用标准 service-command envelope | 每次 activation + `plan_key` 一条 milestone operation，依赖同 plan project operation | G3 可靠化：每个 plan 的 milestone command 在 source 事务内独立冻结，不能把多项目网络调用塞入一个 receipt；Aims 按 `project_code + payment_term_id/template_key` mutation 并与 receipt 同事务，ack 丢失以原 hash 恢复 |
| Finance / Aims / Altoc | Altoc | `GET /api/v1/service/projects/{projectCode}/contract-lines` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `project_code` 作为跨应用键 | 新增：Altoc 按 `contract_project_line_rel` 返回 `contract_code`、`contract_line_code`、`relation_type`、`allocation_method/allocation_ratio/allocated_amount/planned_workdays`；包含 planned/active/closed 项目以支持历史成本归集，仅当结构化关系尚未回填时才回退 `line_codes_json` |
| Finance / People 编排 | Aims | `GET /api/v1/service/projects/{projectCode}/cost-summary` / `POST /api/v1/service/projects/{projectCode}/cost-summary:recalculate` | Console service token，`aud=aims`，读 `scope=aims:read`、写 `scope=aims:write` | `aims:project-cost:{project_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：Aims 从 `time_entries` 聚合项目期间工时，使用调用方提供的 Finance/People 成本单价和外包/其他成本写入 `project_cost_summary`；同一 calculation key 重放返回既有 summary，不重复累加 |
| Finance / Aims / Altoc | Altoc | `GET/POST /api/v1/service/contract-lines/{contractLineCode}/cost-allocations` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:contract-line:{contract_line_code}:cost-allocation:{calculation_or_request_key}` | Goal 3 新增：维护或读取 `contract_line_cost_allocation` 归因快照，支持 direct/ratio/amount/workdays；来源可为手工规则或 `contract_project_line_rel` 自动物化；项目成本不得无规则归属合同行；若该合同行已有冻结利润摘要，普通分摊编辑返回 `profit_summary_frozen` |
| Finance / Altoc | Altoc | `POST /api/v1/service/contracts/{contractCode}/profit-summary:recalculate` | Console service token，`aud=altoc`，`scope=altoc:contract:edit` | `altoc:contract-profit:{contract_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：收入来自 `contract_billing_schedule` 合同行节点；成本来自 Aims/Finance 提供的显式项目成本快照，先经 `contract_project_line_rel -> contract_line_cost_allocation` 归因快照再分摊，写入 `contract_line_profit_summary`；项目确实 0 成本也必须显式传 0；同 calculation key 幂等；多合同行未明确分摊返回 `cost_allocation_required`；冻结期间返回 `profit_summary_frozen` |
| Finance / Altoc | Altoc | `POST /api/v1/service/contract-lines/{contractLineCode}/profit-summary:freeze` | Console service token，`aud=altoc`，`scope=altoc:contract:edit` | `altoc:contract-line:{contract_line_code}:profit-freeze:{period_start}:{period_end}` | Goal 3 新增：冻结当前合同行期间利润摘要，写入 `frozen_at/frozen_by/freeze_key`；冻结后普通重算和分摊改写都必须失败 |
| Finance / Aims / Altoc | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/cost-summary:recalculate` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:service-cost:{service_agreement_code}:{project_code}:{period_start}:{period_end}:{calculation_key}` | Goal 3 新增：Altoc 统计服务工单数和 SLA 工单数，调用方传入 Aims/Finance 汇总后的服务项目工时与成本，按服务协议、项目、期间幂等写入 `service_cost_summary`，支持 `environment_code` 过滤 |
| Altoc / Finance / Console | Altoc | `GET /api/v1/altoc/analytics/contract/{contractCode}` / `GET /api/v1/altoc/analytics/customer/{customerCode}` | Console service token 或用户态 Altoc 权限，`aud=altoc`，`scope=altoc:read` | 读接口不要求 | Goal 3 新增：返回收入、合同行成本、服务成本、毛利和毛利率；breakdown 保留合同行摘要和服务成本摘要 |
| Aims | Altoc | Aims `review-approve` 事务写 operation → claim/drain → `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable` → receipt 校验与 source checkpoint | Aims operation runtime 需 `aims:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:receivable:mark-billable`，来源 `aims`；目标只接受标准 service-command envelope | `aims:milestone:{project_code}:{milestone_id}:accepted:v1` | G3-2 可靠纵切：Aims 在锁定里程碑的事务内同时提交验收事实与冻结命令，目标只取 runtime `milestones.payment_term_id/project/contract`，浏览器 `receivablePlanCode/paymentTermId` 不参与选择。Altoc 校验 path/payment term、冻结合同、operation/capability/hash 后，把该付款条款的回款计划 mutation 与 succeeded receipt 同事务提交；同键同 hash 返回既有 receipt，异 hash 409。Aims 仅在精确 receipt checkpoint 后收口；5xx、timeout、ack 丢失保留原键恢复，并复用既有 drain、dead-letter、诊断和受控重放。 |
| Aims | Codocs | `POST /api/v1/project-cabinet/upload` / `GET /api/v1/project-cabinet/{uuid}/download-url?project_code=` / `GET /api/v1/project-cabinet/{uuid}/preview-url?project_code=` / `DELETE /api/v1/project-cabinet/{uuid}` | `aud=codocs`、`source app=aims`、`client=aims|aims.runtime`、tenant/deployment 精确绑定、精确 `codocs:project-cabinet:{read,upload,delete}`；不接受 wildcard/admin/通用 documents scope | Codocs 仅在 guard 成功后向 Runtime 写入 request-target HMAC 覆盖的 `codocs_trusted_project_cabinet_project_code`。Runtime GET/POST/DELETE SQL 固定该 marker；POST/DELETE OSS path 固定 `codocs/projects/{project_code}/cabinet/`；DELETE 要求 Aims 已验证索引 `project_code + expected_oss_path` 与 BFF 读取、Runtime 锁定行三方精确相等。 | Aims 仍在本地先完成项目成员/管理员、文档归属和访问策略校验，actor UID 只作审计字段。Console v1.50 seed/verify 仅为待授权文件，未执行，不授予浏览器权限或 user grant；PATCH/PUT 保持 `503 project_cabinet_mutation_contract_required`。 |
| Aims | Codocs | `POST /api/v1/service/project-documents/{uuid}/content` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant/deployment 精确绑定、精确 `codocs:project-document:content:read`；不接受 wildcard/admin/通用 `codocs:documents:read` | Aims 先以真实用户会话核验 member/leader/creator/scoped-admin 与精确 `project_documents.codocs_uuid` 或 document deliverable；固定 command actor/project/uuid/action，并以刚签发的短期 `aud=codocs` token 对首跳 command context 签名。Codocs 验签后，才以自身 runtime bearer 重签第二跳。runtime 接受任意物理类型的 active 文档，但必须重新执行 owner/share/relation ACL；Aims 项目关系不能授予 Codocs 读取权限，物理 `doc_type/project_code` 也不能替代该 ACL。 | 响应只有正文 DTO，不含 OSS path、signed URL 或授权细节。v1.67 将历史 v1.52 的无凭据 `aims` grant 校正到实际运行身份 `aims.runtime`；不恢复 generic search/summary/url/preview。 |
| Aims | Codocs | `POST /api/v1/service/department-documents/search` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant 精确绑定；token/source deployment 固定 Aims，可信服务路由/target deployment 固定 Codocs，两者分别进入 command HMAC；精确 `codocs:department-documents:list`，不接受 wildcard/admin/通用 documents 或 Runtime scope | Aims 与 Codocs 分别验证签名 actor 对 exact department 的 Directory 访问；Codocs 只在目标 gateway identity 为 `codocs` 且 target deployment 为 `<tenant>-codocs` 时使用自身 `codocs.runtime` 身份查询 Console Directory。command 固定 actor/dept/pageSize/action，Runtime 仅接受重签后的 service-command actor，从 command 重建 `type=department + dept_code`，以现有部门读取谓词返回 active 文档与目录。 | 产品规则为“该用户可读取的部门文档均可作为立项书候选”；不读取正文，不返回 OSS/策略，不恢复 UUID summary。Console v1.94 仅授权有凭据的 `aims.runtime`。 |
| Aims | Codocs | `POST /api/v1/service/project-documents/{uuid}/versions/{versionId}:resolve` / `POST /api/v1/service/project-document-review-grants` / `POST /api/v1/service/project-documents/{uuid}/versions/{versionId}/review-content` | `aud=codocs`、`source app=aims`、`client=aims.runtime`、tenant/deployment 精确绑定；分别使用 `codocs:project-document:version:resolve`、`codocs:project-document:review-grant:create`、`codocs:project-document:review-content:read` | Aims 先证明当前用户对确定 deliverable 与项目有关系；Codocs resolve 再以 actor 重施原文档 ACL并返回确定 version/hash。grant 精确绑定 Aims `submission_no + document_uuid + version_id + qa/project_director`，同一绑定幂等。review-content 只接受完全匹配的有效 grant，按 OSS version ID 读取并复算 SHA-256；不得读取后续版本。 | Aims 保存不可变 `deliverable_submission` 证据快照；QA 自提交固定走 PM 完整性确认后由项目总监质量审核。Console v1.88 只为有凭据的 `aims.runtime` 配置三项精确 grant，不授予浏览器或用户通用 Codocs 权限。 |
| Aims | Codocs | `POST /api/v1/service/company-weekly-summaries/{periodKey}:publish` | `aud=codocs`、来源 `aims`、客户端 `aims.runtime`、精确 `codocs:company-weekly-summary:publish`；标准 service-command envelope，tenant/deployment/operation/hash 全绑定 | `aims:company-weekly-summary:{periodKey}:r{revision}:publish:v1`；Aims operation 只冻结版本 ID、Markdown hash 和实际收件人，不在 command 中复制正文。Codocs 另行回读 Aims 不可变 Markdown，复算 hash 后创建/复用一个公司只读文档、追加不可变版本和精确 UID share，并在同一事务写 receipt。Aims 只在 receipt checkpoint 后发布汇总并确认项目经理职责工时；失败可重试，目标尚未开始时可取消，更正只追加新 revision。 | 已落地；Console v1.90 授权。抄送人员和部门在发布时解析为 active UID 快照，后续目录变化不改写历史版本。 |
| Altoc | Codocs | `POST /api/v1/service/altoc-entity-documents/{uuid}/{content\|attach}` | `aud=codocs`、`source app/client=altoc`、tenant/deployment 精确绑定，分别仅接受 `codocs:altoc-entity-document:content:read` 或 `codocs:altoc-entity-document:attach` | content 前 Altoc 重验实体 view 和精确已存 `document_link`；attach 前重验实体 edit 与实体存在。首跳绑定 actor/entity type+ID/UUID/action/HMAC；Codocs 重新执行原 ACL。attach 只允许 active owner/write-share，且 Altoc `(entity,uuid)` 重放幂等。 | 无 generic UUID、正文、摘要或 URL 路由；不返回 OSS/签名/ACL。v1.53 seed/verify 待批准，未执行。 |
| Altoc | Finance | Altoc `POST /api/v1/receivable-plans/{receivablePlanCode}/invoice-request` 编排 Finance `POST /api/v1/finance/invoice-requests` | Console service token，`aud=finance`，`scope=finance:write`，来源 `altoc` | `altoc:receivable:{receivable_plan_code}:invoice-request:v1` | Phase 1 已实现：Altoc UI 入口调用本地编排器，runtime 校验回款计划并组装 payload，Finance 按来源业务键幂等创建，Altoc runtime 写回款计划审计 |
| Altoc / Finance / Workflow | Finance / Workflow | Altoc operation → `POST /api/v1/finance/service/invoice-requests/create` → Finance operation → `POST /api/v1/service/finance-invoice-approval` → 两级 receipt/checkpoint | Altoc→Finance：`aud=finance`、`scope=finance:invoice-request:create`；Finance→Workflow：`aud=workflow`、`scope=workflow:invoice-request:create`；两级均要求来源 service token、标准 service-command envelope 和与冻结 command 相等的受信 actor delegation | `altoc:receivable:{receivable_plan_code}:invoice-request:v1` / `finance:invoice-request:{invoice_request_code}:workflow-submit:v1` | Altoc 在回款计划锁事务冻结 Finance command；Finance 的 invoice request mutation、target receipt 与 Workflow operation 同事务。Workflow instance mutation 与 target receipt 同事务；Finance 最终把 invoice `pending_approval`、external instance、attempt 和 source operation 同事务 checkpoint。5xx/timeout/ack-loss 保留原键恢复；同键同 hash 重放，异 hash 409。浏览器 Authorization/Cookie 不转发；合同级无稳定计划身份的旧入口返回 410。 |
| Console action / Finance 用户 | Finance | `GET /api/v1/finance/invoice-requests/{code}` → `/finance/invoices/requests/{code}`；`GET /api/v1/finance/receipts/{code}` → `/finance/receipts/{code}` | 普通 Finance 用户 permission；manifest 仅支持既有 `tenant:global` / `subject:self`，不自动建 grant | invoice request / receipt `code` | P1：列表和 exact-code 详情按当前 `issuance_responsible_uid` / `reconciliation_responsible_uid` 过滤，受信全局访问旁路；责任转移实时撤销旧责任人读取。issue、receipt confirm、reconciliation 各自要求独立 action + 当前责任，通知关系不扩写权限，浏览器伪造 actor/access 被剥离。 |
| Altoc | Finance | `GET /api/v1/finance/contracts/{contractCode}/summary` / `GET /api/v1/finance/contracts/summaries` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` | 读接口不要求；摘要版本用 `calculated_at` | Phase 1 已实现：Altoc 合同列表和合同详情发票页读取并展示 Finance 开票、到账、核销、未核销摘要 |
| Finance | Altoc | Finance 核销事务写 operation → `POST /api/v1/service/contracts/{contractCode}/finance-summary:sync` → receipt 校验与 source checkpoint（事件 `finance.contract.summary.updated` 保留后续总线语义） | Finance operation runtime 需 `finance:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:contract:finance-summary:sync`，来源 `finance` | `finance:reconciliation:{reconciliation_code}:altoc-summary:v1` | G3 可靠纵切：Finance 只从锁定的到账/发票关联与 runtime 重算摘要生成最小冻结命令，并与核销事实同事务；Altoc 回款计划更新与 succeeded receipt 同事务，同键同 hash 返回原合同摘要业务键，异 hash 409；Finance 精确校验 receipt 后 checkpoint，ack 丢失使用原幂等身份恢复。scheduled drain 默认关闭，migration 尚未执行。 |
| Aims / Altoc | Assets | `POST /api/v1/service/deliveries/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `contract:{contract_code}:project:{project_code}:delivery-view:v1` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按 `delivery_code` 或 `contract_code + project_code` 幂等 upsert，返回交付资产包 |
| Aims / Assets | Assets | `POST /api/v1/service/deliveries/{deliveryCode}/documents` | Console service token，`aud=assets`，`scope=assets:write` | `delivery:{delivery_code}:document:{document_uuid}` | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；保存 Codocs UUID，支持 `artifact_type` 九类交付成果，并把 Aims `milestone_id/milestone_code` 等上下文写入 `asset_documents.source_context` |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；按客户 / 合同 / 项目返回交付视图、产品、环境、文档包 |
| Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/plans` | Console service token，`aud=assets`，`scope=assets:write`，来源 `altoc` | `altoc:contract:{contract_code}:customer-delivery-assets:v1` | P1 已实现：按 Altoc 合同计划资产 upsert Assets `customer_delivery_assets` 主档，`project_code` 可为空，返回 `delivery_asset_code` 供 Altoc 回填 |
| Altoc / Aims / Finance | Assets | `GET /api/v1/service/customer-delivery-assets/by-customer?customer_code=&contract_code=&project_code=` / `GET /api/v1/service/customer-delivery-assets/by-contract/{contractCode}` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | P1 已实现：按客户、合同或项目读取客户交付资产主档 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/upsert` | Console service token，`aud=assets`，`scope=assets:write`，来源 `aims` 或 `altoc` | `environment:{customer_code}:{source_project_code}:{idempotency_key}` | Goal 2 新增：Assets 生成 / 复用正式 `environment_code`；显式 code 只能引用已有环境，幂等键重试返回同一对象，不按名称模糊复用 |
| Aims / Altoc | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind` / `GET /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments` / `GET /api/v1/service/environments/{environmentCode}/customer-delivery-assets` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `delivery-asset:{delivery_asset_code}:environment:{environment_code}:{relation_type}` | Goal 2 新增：正式交付资产与正式环境的多对多部署关系；设置主环境时同步旧 `customer_delivery_assets.environment_code` 快照 |
| Aims / Altoc | Assets | `POST /api/v1/service/environments/{environmentCode}/lifecycle:sync` / `POST /api/v1/service/references:resolve` | Console service token，`aud=assets`，读 `scope=assets:read`、写 `scope=assets:write` | `environment:{environment_code}:status:{status}` | Goal 2 新增：同步环境 planning/active/frozen/retired 生命周期并批量解析正式对象和资产-环境 pair；`accepted` 输入只写验收时间并归一到 `active` |
| Aims / Assets / Altoc | Aims | `GET /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:status` / `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:assets-sync` | Console service token，`aud=aims`，读 `scope=aims:read`、写 `scope=aims:write` | `aims:project:{project_code}:environment:{environment_code}:{delivery_asset_code}` | Goal 2 新增：Aims 保存项目对正式环境的执行关系、版本快照和 Assets 同步状态；Aims 不生成正式 `environment_code` |
| Altoc / Aims | Assets | `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/activate` | Console service token，`aud=assets`，`scope=assets:write` | `customer-delivery-asset:{delivery_asset_code}:status:{status}` | P1 已实现：推进客户交付资产 delivered/online/accepted 等状态；Assets BFF 会尽力回调 Altoc 状态同步，回调失败不回滚 Assets 状态，响应附带同步错误便于重放 |
| Assets | Altoc | Assets 状态事务写 operation → `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync` → receipt 校验与 source checkpoint | Assets operation runtime 需 `assets:integration_operation:execute`；跨应用 Console service token `aud=altoc`、`scope=altoc:contract:delivery-asset-status:sync`，来源 `assets` | `assets:delivery-asset:{delivery_asset_code}:altoc-status:revision:{source_revision}:v1` | G3 可靠纵切：Assets 仅在正式资产、环境、状态及目标相关事实变化时递增 revision，同事实重放复用 operation；状态 mutation 与 operation 同事务。Altoc mutation 与 receipt 同事务，并锁定 applied watermark：低 revision stale-skipped、同 revision 异 hash 409、更高 revision 才推进计划资产、服务覆盖、义务和结算。即时 pending 返回 202；scheduled drain 默认关闭且按 20条/45秒/剩余25秒有界。migration 尚未执行。 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/coverages/{coverageCode}:resolve|suspend|end|confirm-legacy` | Console service token，`aud=altoc`，读 `scope=altoc:read`、写 `scope=altoc:contract:edit` | `altoc:service-agreement:{service_agreement_code}:coverage:{coverage_code}` | Goal 2 新增：`service_agreement_coverage` 是正式覆盖事实源，区分 `source_plan_code`、`delivery_asset_code`、`environment_code` 和 `legacy_reference`；新读优先 coverage，旧 `service_agreement_asset` 只作未迁移回退 |
| Altoc / Assets / Aims / Finance | Altoc | `GET /api/v1/service/service-agreement-coverages/by-environment/{environmentCode}` / `GET /api/v1/service/service-agreement-coverages/by-delivery-asset/{deliveryAssetCode}` | Console service token，`aud=altoc`，`scope=altoc:read` | 读接口不要求 | Goal 2 新增：按正式环境或正式交付资产反查服务协议覆盖 |
| Finance | Assets | `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求 | Phase 2 已实现；Assets BFF 在转发 tenant-runtime 前校验入站 service token；输出资产采购、资源订阅、环境投入和月度归集成本分解，供 Finance 项目核算写入 `project_cost_allocation` |
| Aims / Altoc / Finance / Assets | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:{app_code}:{manifest_hash}` | 通用能力已有；Assets Phase 2 已新增采购、领用、分配、退回、报废 action manifest |
| Workflow | Aims | `POST /api/v1/service/workflow/callback`（Aims BFF），内部写入 `POST /v1/aims/service/workflow/callback` | Console service token，`aud=aims`，`scope=workflow:callback`，来源仅 `workflow`；Aims BFF 用自身 tenant-runtime 身份写入 data-runtime | Workflow callback outbox 的 `instance_id + event + status` 稳定键 | 立项审批通过时，data-runtime 在串行化事务内锁定项目，将 `approval_pending → active`，把里程碑 `planning` 归一为 `todo` 并激活 `sort_order/start_date/id` 最前的里程碑；重放保留已激活里程碑，驳回将项目回退为 `draft`。仅当服务器 `HZY_AIMS_ENTERPRISE_ENABLE_MILESTONE_RECEIVABLE=true`，且同一入口的规范化回调为 `milestones/milestone_completion` 时，Aims 才会以固定受控组合 `aims.write altoc:receivable:mark-billable` 调 Runtime；Foundation 只允许该 pair 和 `data-runtime` / `tenant-runtime` audience。随后 Runtime 仍要求 Aims 已认证身份、严格 service JWT（`token_use=service`、source/target/audience/tenant/deployment 绑定且 `sub/client=aims.runtime`）、精确 `altoc:receivable:mark-billable`、当前 credential/grant 与 legacy Aims source binding 后才进入 AA-04 Aims+Altoc 共享事务；项目立项和所有其他回调继续原路径。启用前必须执行 Console v2.5 的两 audience grant verify 和真实组合 token 签发探测；v2.5 seed 只插入缺失 grant，不覆盖既有 metadata 或重激活撤销项，缺失/非 active 必须走已授权管理修复路径。不得使用 Foundation 默认 scope 前缀或转发 legacy `aud=altoc` token。 |
| Workflow | Assets | `POST /api/v1/purchase-orders/{id}/workflow:sync` / `POST /api/v1/assignments/{id}/workflow:sync` | Console service token，`aud=assets`，`scope=workflow:callback` 或 `assets:write` 代理 | `workflow:{instance_no}:assets:{resource}:{id}:{status}` | Phase 2 已实现 runtime 同步入口；资产操作默认 pending，审批通过后才联动资产主档 |

### 事件口径

Phase 1 先以 service API + 幂等键 + 审计日志落地，不强制引入全局事件总线；后续如果进入事件汇总或消息队列，事件名和载荷语义保持不变。

| 事件名 | 事实源 | 触发条件 | 消费方 | 关键载荷 |
| --- | --- | --- | --- | --- |
| `altoc.contract.effective` | Altoc | 合同状态变为 `effective` | Aims / Assets / Workflow | `customer_code`, `contract_code`, `contract_id`, `opp_id`, `payment_terms[]` |
| `aims.project.linked_to_contract` | Aims | 项目创建或绑定合同 | Altoc / Assets / Finance | `project_code`, `customer_code`, `contract_code`, `opp_id`, `contract_id` |
| `aims.milestone.accepted` | Aims | 绑定 `payment_term_id` 的验收里程碑完成 | Altoc / Finance | `project_code`, `milestone_id`, `payment_term_id`, `receivable_plan_code?`, `accepted_at` |
| `altoc.receivable.billable` | Altoc | 回款计划进入可开票状态 | Finance / Console | `receivable_plan_code`, `contract_code`, `amount`, `planned_invoice_date` |
| `finance.invoice_request.approved` | Finance | 开票申请审批通过 | Altoc / Console | `invoice_request_code`, `contract_code`, `receivable_plan_code`, `requested_amount` |
| `finance.invoice.issued` | Finance | 正式发票生成 | Altoc | `invoice_code`, `invoice_no`, `contract_code`, `receivable_plan_code`, `invoice_amount` |
| `finance.receipt.confirmed` | Finance | 到账确认 | Altoc | `receipt_code`, `contract_code`, `receivable_plan_code`, `received_amount` |
| `finance.reconciliation.completed` | Finance | 核销完成 | Altoc / Aims | `reconciliation_code`, `contract_code`, `receivable_plan_code`, `reconciled_amount` |
| `finance.contract.summary.updated` | Finance | 合同摘要重算 | Altoc / Aims / Console | `contract_code`, `invoice_amount`, `received_amount`, `reconciled_amount`, `risk_status`, `calculated_at` |
| `aims.project_cost.summary.ready` | Aims | 项目期间成本重算完成 | Altoc / Finance | `project_code`, `period_start`, `period_end`, `total_hours`, `labor_cost`, `outsourced_cost`, `other_cost`, `total_cost`, `calculation_key` |
| `altoc.contract_line.profit_summary.updated` | Altoc | 合同行毛利重算或冻结完成 | Finance / Console | `contract_code`, `contract_line_code`, `period_start`, `period_end`, `total_revenue`, `total_cost`, `gross_profit`, `gross_margin`, `calculation_key`, `frozen_at` |
| `altoc.service_cost.summary.updated` | Altoc | 服务协议成本重算完成 | Finance / Aims / Console | `service_agreement_code`, `project_code`, `environment_code`, `period_start`, `period_end`, `ticket_count`, `sla_ticket_count`, `total_hours`, `total_cost`, `calculation_key` |
| `assets.delivery_view.upserted` | Assets | 客户交付视图创建或更新 | Aims / Altoc / Console | `delivery_code`, `customer_code`, `contract_code`, `project_code`, `status` |
| `assets.delivery_document.linked` | Assets | 交付视图关联 Codocs 文档 | Aims / Altoc / Console | `delivery_code`, `document_uuid`, `artifact_type`, `project_code`, `contract_code`, `milestone_id` |
| `assets.customer_delivery_asset.status_changed` | Assets | 客户交付资产进入 delivered / online / accepted 等状态 | Altoc / Aims / Finance | `delivery_asset_code`, `customer_code`, `contract_code`, `contract_line_code`, `status`, `accepted_at` |
| `assets.environment.upserted` | Assets | 正式客户环境创建或复用 | Aims / Altoc / Finance | `environment_code`, `customer_code`, `contract_code`, `source_project_code`, `status` |
| `assets.delivery_asset_environment.bound` | Assets | 正式交付资产与正式环境关系创建或更新 | Aims / Altoc / Finance | `delivery_asset_code`, `environment_code`, `relation_type`, `deployment_status`, `is_primary`, `source_project_code` |
| `aims.project_environment.status_changed` | Aims | 项目推进部署、上线、验收或交接 | Assets / Altoc / Finance | `project_code`, `environment_code`, `delivery_asset_code`, `delivery_status`, `assets_sync_status` |
| `altoc.service_agreement_coverage.resolved` | Altoc | 服务覆盖从计划或旧引用解析为正式对象 | Assets / Aims / Finance | `service_agreement_code`, `coverage_code`, `target_type`, `source_plan_code`, `delivery_asset_code`, `environment_code`, `resolution_status` |
| `assets.project_cost.summary.ready` | Assets | 项目资产成本摘要可供 Finance 同步 | Finance | `project_code`, `period_month`, `asset_purchase_amount`, `resource_subscription_amount`, `environment_investment_amount` |

### 幂等与审计要求

- 所有跨模块写操作必须带 `Idempotency-Key` header；没有 header 时，被调用方应拒绝 service-only 写操作或按请求体派生同等幂等键。
- 幂等键格式：`<source_app>:<source_object_type>:<source_object_key>:<action>:v<major>`；涉及目标对象时追加 `:<target_object_key>`。
- 被调用方必须记录 `source_app`、`source_biz_type`、`source_biz_code`、`idempotency_key`、`request_id`、`actor_uid`、`service_client_id`、`created_at`；若现有业务表没有字段，先写入审计日志或后续补专门 bridge log 表。
- 幂等冲突返回已创建对象的稳定业务键，不重复创建业务对象。
- Workflow 回调必须带 `instance_no`、`app_code`、`resource_code`、`action_code`、`biz_id`、`status`、`completed_at`、`idempotencyKey`。

Phase 1 实现说明：Altoc 合同激活→Aims 项目/里程碑、Aims 验收→Altoc 可开票、Altoc 开票申请→Finance/Workflow、Finance 核销→Altoc 财务摘要均已升级为 caller-owned `integration_operation` + target-owned `service_command_receipt`；业务 mutation、源命令和目标 receipt 的事务边界见下方 G3 可靠投递契约。Assets 客户交付资产状态仍按 `delivery_asset_code + status` 派生幂等键回传 Altoc 计划资产、义务和结算状态。

### 可靠投递、操作记录与目标回执（G3）

跨模块定向写入的可靠性模型以 [`CROSS_MODULE_OPERATION_MODEL.md`](./CROSS_MODULE_OPERATION_MODEL.md) 为唯一详细设计。关键边界如下：

- 调用方应用拥有 `integration_operation`，并由自身 data-runtime adapter 在本地业务 mutation 的同一数据库事务中写入；BFF、Cloudflare Queue、KV 和 data-runtime 进程内存都不是耐久事实源。
- 每条 operation 只代表一个目标应用的一条命令；多目标链路通过 correlation、顺序和依赖关联多行，不允许执行时改写 target app。
- 目标应用拥有 `service_command_receipt`，目标业务 mutation 与 succeeded receipt 同事务；同键同 hash 返回原目标业务键，同键异 hash 返回 `409 idempotency_payload_mismatch`。
- 业务审计、integration operation 和 domain event outbox 是三类不同事实，不合并成万能表。Altoc `contract_orchestration_job/step` 保留合同专用业务视图，不能冒充所有跨模块操作的通用队列。
- dispatcher 只能通过代码映射 operation code 到目标 app、audience、capability 和 path；payload 不得覆盖路由、安全上下文或幂等身份。每次尝试重新申请短期 service token，禁止持久化 token、Cookie、Authorization 或内部 runtime URL。
- 网络错误、timeout、408/425/429/5xx 可自动退避；401/403 和确定性契约错误进入人工终态，不得自动重试或泛化为 502。响应/ack 丢失或 lease 过期进入 `partial_unknown`，必须用原幂等键恢复。
- 管理员重放只接受 operation ID、原因和 expected version；不得修改 tenant/deployment/source/target/业务键/idempotency/payload。查看和重放权限分离，并记录原 actor 与 replay actor。
- Aims/Altoc/Assets/Finance/People 管理端列表与 `GET /api/v1/integration-operations/{operationId}/attempts` 必须命中同一 grant 的租户全局范围；浏览器 BFF 必须在 runtime 返回后执行 Foundation allow-list 投影。列表/attempt 只允许 operation ID、目标 app、operation code、source/target 业务键、状态、尝试计数、版本、稳定错误码/类别、时间和耗时；不得返回 operation/correlation/idempotency key、required capability、command/schema/hash、lock/fencing、原始错误正文、request/response 或认证材料。受控重放请求和响应只保留 `operationId`、`expectedVersion`、1–500 字符 `reason`。
- 共享 Cloudflare 自动 drain 由 Platform 无凭证 scheduler page 与 Tenant Gateway 5 分钟 cron 负责。registry 采用时间轮换窗口、稳定分片和不透明 cursor，只返回 tenant host/environment 与 Aims、Altoc、Console、Finance、People、Workflow app code；Gateway 重新 resolve runtime endpoint 后以空 body、内部 token、60 秒 HMAC 调固定私有 wake。业务应用使用 app 前缀路径，Console 使用根路径 `/api/internal/integration-operations/drain`；所有 wake 使用 event-bound IO，普通 HTTP/`/_nitro/tasks/**` 禁止。共享 Console 不配置单租户 Runtime URL/token，也不自带 Cloudflare cron。People 还把可信 Console target deployment 纳入 HMAC，以便投递 Directory lifecycle；跨应用调用重新进入 tenant host，由 Gateway 注入目标 app deployment。service-token 和 Console-runtime cache 必须按可信 tenant/deployment/environment/app 隔离。Gateway 对同一租户的应用使用有界并发唤醒；drain 返回本轮领取或新建操作时，只在同一个总 wall-time 内最多继续两轮，空队列立即停止，5 分钟 cron 仍作为恢复兜底。Tenant Gateway 对成功的 Platform 租户注册表解析保留 5 分钟新鲜缓存，并允许在 Platform/Hyperdrive 暂时不可用时使用不超过 24 小时的最近成功值；从未成功解析或已超过兜底窗口时仍失败关闭，缓存不得包含内部 token、runtime token 或登录 secret。
- Altoc→Aims、Aims→Altoc、Altoc→Codocs/Assets 的目标写接口使用统一 `service_command_receipt` executor。Foundation 以目标 Runtime bearer 对 source/target deployment、app、operation、capability、schema、idempotency、command hash 和 request ID 签名；原 actor 使用独立 service-command delegation/audit 证据，不进入可由另一授权操作者恢复的业务 command hash。目标 runtime 验证后才允许在目标业务 mutation 同一事务写 succeeded receipt；source checkpoint 校验并保存 `target_receipt_id`，ACK 丢失可用原幂等身份恢复。
- Aims 验收→Altoc 可开票使用同一 executor：source transaction 只从锁定的里程碑 `payment_term_id` 冻结 `aims.milestone.receivable-billable.v1`，不得接受浏览器 target hint；Altoc 以 `payment-term:{id}` 作为目标业务集合键，并在 receipt 事务中校验冻结 `contractCode` 与实际回款计划合同一致。
- Altoc 合同激活→Aims 按每个 `project_plan` 拆为 project operation 和依赖它的 milestone operation；两者 sequence/depends_on、target=`aims`、capability=`aims:write` 与 endpoint 都由代码固定。source 为无显式 code 的 plan 使用与 Aims 一致的规范化规则冻结确定 project code，并把原 actor 只保存在 operation 审计列，不写入 command hash；不同操作者重放同一 activation 不产生 payload mismatch。
- dead-letter 通知由 Aims/Altoc/Assets/Finance/People source runtime 提供安全候选和 CAS ack。source 以 `integration_operation_dead_letter_actionable` 保存 operation+generation 的 action key、冻结 object version、Console notification ID 与实际显式收件 UID；replay/success 事务写 resolved/cancelled closure，未 ACK 的旧 generation 阻止后续 generation 发布。People 只允许 Directory→Console 两条生命周期 operation 与 People→Assets 离职资产 operation 进入候选，未来 family 不会自动接入。Foundation 调 Console 专用 `POST /api/v1/console/notifications/integration-operation-dead-letter`。Console 要求 `aud=notifications`、`scope=notifications:publish`，并把 tenant/deployment/source app 绑定 service token；稳定 SHA-256 幂等键避免重复通知，成功后 source 保存 Console notification ID。Finance/Assets 与 People publish grant 分别由 v1.46/v1.47 seed 增量补齐，且不授予浏览器权限；fallback 收件人由 `notification.integrationOperationRecipients` 配置，初始设置见 v1.36。

## Aims ↔ GitLab / 外部任务消费者契约

Aims 是任务事实源，GitLab Issue 只是外部执行投影。GitLab Token 只在 Console tenant-runtime 的 fixed-operation 边界解析；Orca、WebDev 等消费者读取 Aims 任务时使用独立 Console service identity，不共享 GitLab Token、静态 API Key 或浏览器用户 Cookie。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| Aims BFF | Console GitLab integration | `POST /api/v1/projects/{projectId}/sync-gitlab-issues` → Console fixed operation `gitlab.issue-upsert` | 浏览器先通过 Aims 项目 manager/scoped-admin 校验；Aims runtime 需 `integration_operations:execute` 且 semantic grant 包含 `gitlab.issue-upsert` | SHA-256 幂等键；Issue 正文固定 `hzy-aims:item-key` marker；`gitlab_issue_links` 对 `work_item_id+repo` 和 `repo+iid` 双唯一，已有 IID 更新前复验 marker | 已落地；单次最多 100 条，completed→closed，其余→opened；只允许 `aims_project_repos` 已绑定仓库，部分失败不写本地链接 |
| Orca / WebDev / 旧服务客户端 | Aims | `GET /api/v1/service/tasks` | 已退役，不再建立 Host 服务 tuple | 返回 `410 aims_service_tasks_retired`；使用 Enterprise 工作项页面 | 2026-10-07 只读核查 hzy0 与生产 Console：精确 semantic scope/已知 resource 闭集均无 active 持有者；按用户裁定退役，不迁移执行器 |

## People ↔ Aims / Finance / Workflow 项目绩效契约（Phase 3）

People 是人员运营事实、任职、M/P 职级设置、月度人员成本快照、项目贡献快照和个人绩效主流程事实源；Console Directory 是登录用户、部门、项目注册表和访问控制事实源，Console 系统参数提供 M/P 职级序列数量。生产切换期允许从 Console Directory 初始化 People 员工事实；正常运营期，入职、调岗、离职等 HR 事实应先落 People，再按服务契约投影到 Console Directory。钉钉 HR 同步使用通讯录员工的入职日期和 HR 离职接口的明确状态、最后工作日/原因；既有钉钉 identity 优先匹配，其次只允许唯一且无歧义的 Directory 邮箱，绝不以通讯录缺失推断离职。People 不复制 Aims 任务/工时明细、Codocs 文档正文或 Finance 财务核算结果；Finance 提供人力成本计算参数、项目财务指标和绩效金额/提成奖金财务口径快照，供 People 成本快照和绩效周期引用。项目成本核算主路径由 Finance 读取 Aims 月度工时与 People 职级设置后自行计算标准人力成本，不依赖 People 绩效周期或贡献快照。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| People BFF | People data-runtime | `POST /v1/people/service/directory-users:sync` | Console service token，`aud=people`，`scope=people:write`，来源 `console` | `employee_uid` upsert 员工事实；`ASN-DIR-{employee_uid}` upsert 当前目录导入任职；保留 Console Directory 原始引用 | 已落地；用于 Console → People 初始化导入，不作为长期双向同步主路径 |
| People BFF | Console / Connector Runtime | `GET/POST /api/v1/console/service/directory/hr-sources/dingtalk/department-mappings`；`GET/POST .../dingtalk/department-changes`；`POST/GET .../service/connector-runtime/people-sync-jobs` 及 `cancel/retry` | `aud=console`；固定 `people.runtime` service client；精确 `console:hr-source-sync:view|execute|admin`；映射、部门停用及 job 创建/取消/重试均使用标准 service-command HMAC 绑定 tenant、source/target deployment、原 actor、capability、command hash 与幂等键；Console 向 Connector Runtime 继续传递原 actor 与幂等键 | `external_department_id -> canonical dept_code`；旧 `DT-* -> canonical dept_code` alias；Connector 提交 final marker、根部门、计数与聚合 hash；Console receipt + People 引用事务重映射，失败可通过已映射行的显式“重新对账 People 引用”动作恢复 | 已落地；浏览器入口仅 People `hr_source_sync`，Console 旧钉钉按钮/写 API 410。缺失正式部门只在完整快照验证后冻结，超过数量/比例阈值或根部门变化标高风险；所有停用仍需 People 管理员逐项确认并实时重查人员/子部门。钉钉只接管正式行政部门、人员主归属和在离职状态，委员会、虚拟组织、项目组及稳定 `dept_code` 不归钉钉 |
| People BFF | People data-runtime | `POST /v1/people/service/hr-source-sync/dingtalk/departments:remap` | 仅固定 `client:people.runtime`，精确 `people:hr-source-department-remap:execute`，并要求绑定请求目标的管理员 actor HMAC；alias 只能来自 People BFF 已验真的 Console mapping response，不允许 People Runtime 跨库读取 Console 表 | 批量把 `people_employees.dept_code` 与 `people_assignments.dept_code` 从旧 alias 改为 canonical code；重复执行无副作用 | 已落地；Console 成功、People 暂时失败时，管理员可对已绑定 mapping 执行“重新对账 People 引用”恢复；其他持有通用 `people.write` 的应用不能调用 |
| People data-runtime | Console Directory | `people.directory.employment-sync.v1` / `people.directory.offboarding-disable.v1` → employment/disable service API | `aud=console`；精确 `console:directory-employment:sync` / `console:directory-offboarding:disable`；标准 envelope + source/target deployment HMAC binding | People 在 employee/approved effective assignment mutation 同事务从锁定事实生成单调 revision operation；钉钉 Connector 也只能先写 People 后复用同一 operation。未来生效 assignment 用固定 `asOf` 调 `directory-lifecycle:prepare-due` 到期冻结。Console 同事务应用 Directory/session/钉钉 identity 事实、水位、receipt，并冻结下一跳 Platform operation。People 收到有效 Console succeeded receipt 后立即完成自身 operation；返回的 Platform pending 只表示 Console 所有的下一跳尚未完成，不得把 People operation 写成失败重试。低 revision stale-skip，同 revision 异 hash 409 | 已可靠化；共享 Worker 由 Platform registry + Tenant Gateway 版本化 scheduler 唤醒，HMAC 绑定 tenant、People deployment、Runtime endpoint 与 Console target deployment；每轮先有界领取、再并发投递冻结操作，单条失败互相隔离；专属 Worker 自有 cron 仍默认关闭。BFF 不读取浏览器 projection hints，旧 admin disable 旁路 410 |
| Console Directory | Platform authorization | `console.platform.employment-sync.v1` / `console.platform.offboarding-revoke.v1` → Platform internal authorization API | 固定 internal principal，精确 `platform:employment-authorization:sync` / `platform:offboarding-authorization:revoke`；tenant/deployment/principal/envelope/actor HMAC 绑定 | Console Directory/receipt 与 caller-owned Platform operation 同事务；Platform 校验 Console deployment 属于 tenant，在 authorization mutation 同事务推进 employee revision watermark 并写 receipt；ack 丢失按原 key 恢复 | 已可靠化；Platform 不可用不回滚 Directory/账号事实。Console drain 默认关闭、lease/fencing/append-only attempt、8次阈值和20条/45秒边界；每轮领取的有界批次并发投递且逐条 checkpoint；共享 Worker 由 Platform registry + Tenant Gateway 逐租户签名唤醒并使用 event-bound Runtime binding；active→left→active 和迟到旧任职按 source revision 收敛 |
| People BFF | Assets | `POST /api/v1/service/offboarding-recoveries:upsert` | Console service token，`aud=assets`，`scope=assets:offboarding-recovery:sync`，来源 `people`；标准 service-command envelope | `people.offboarding.assets-recovery-sync.v1`；People 固定 `asOf` 后只为当前 left/inactive 或最新已生效、approval-free/approved leave 创建 operation；Assets case 与 receipt 同事务，同键异载荷 409 | 新增、默认关闭；不读取 Console inactive，不复制 People 资产回收协调状态；未来/未批准 leave 与已被后续 onboard/transfer 覆盖的历史 leave 不投影，People 仅在精确 receipt 验证后确认 succeeded |
| People BFF | Console Settings | `GET /api/v1/console/settings/values?keys=people.rankSeries.managementCount,people.rankSeries.professionalCount` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回管理序列和专业序列职级数，默认 M5 / P10 | 已落地；People 职级设置页据此生成 M/P 页签和职级行，不提供自由新增职级 |
| Finance BFF / 工时核算方 | Console Work Calendar | `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view`；Console handler 仅接受 service actor，普通用户态管理查询走 `/api/v1/console/work-calendars/**` | 读接口不要求；返回 `workdayCount`、`standardHoursPerDay`、`standardWorkHours` 和来源 | 新增；Console 是月标准工时事实源，Finance 项目人力成本分摊应使用 `project_hours / standardWorkHours`，不再用员工当月已填报总工时作为分母 |
| Aims BFF / 周报页面 | Console Work Calendar | `GET /api/v1/console/service/work-calendar/{calendarCode}/days?yearMonth=YYYY-MM` + `GET /api/v1/console/service/work-calendar/month?calendarCode=CN&yearMonth=YYYY-MM` | Console service token，`aud=system_settings`，`scope=system_settings:view` | 读接口不要求；返回日级 `dayType`、`isWorkday`、`holidayName` 和月度 `standardHoursPerDay`，用于项目周报日历区分工作日、休息日、法定假日和调休工作日；人工管理页面继续使用 `/api/v1/console/work-calendars/...` 会话接口 | 新增；Aims 项目周报日历按可视月份缓存日级工作日历，并在选中周日期范围后显示当周工作日天数和标准工时，100% 投入按当周标准工时折算 |
| People BFF | Finance | `GET /api/v1/finance/service/people-cost-parameters?effective_date=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回有效的人力成本参数 code、基本工资、福利费率、管理分摊系数和固定资源分摊 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 生成成本快照前读取，不从 Console 系统参数取值 |
| People BFF | People data-runtime | `POST /v1/people/service/cost-snapshots:generate` | Console service token，`aud=people`，`scope=people:write` | 按 `employee_uid + period_month` upsert 月度成本快照；`standard_rate_code` 追溯命中的 M/P 职级设置，`source_refs` 追溯 Finance 参数 code | 已落地；用于从职级设置 + Finance 参数生成月度成本快照 |
| Finance BFF | Aims | `GET /v1/aims/projects?current_user=&search=&page=&pageSize=` | Tenant-runtime service token，`scope=aims.read`；当前用户通过 `current_user` 控制可见性 | 读接口不要求；Finance 只保存/展示 `project_code` 等稳定业务键和财务摘要，不复制 Aims 项目主档 | 已落地；Finance 项目核算页以 Aims 项目清单为底表，合并 Finance `project_finance_summary` |
| Finance BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `finance` | 读接口不要求；按 `project_code + period_month` 读取项目当月工时，分摊比例由项目工时 / Console 月标准工时计算 | 已落地；Finance `POST /api/v1/finance/project-accounting/sync-people-costs` 使用该链路 |
| Finance BFF | Aims data-runtime | `GET /v1/aims/admin/projects` / `GET /v1/aims/projects`，可带 `project_codes`、`include_archived` / `exclude_archived`、`page`、`pageSize` | Tenant-runtime service token，`scope=aims.read`，来源 `finance`；普通项目列表仍叠加 Aims 当前用户可见性 | 只允许用 `project_codes` 精确缩小结果，不得据此扩大 Aims 可见性；Finance `projects` scope 必须先把授权项目编码下推再计算 total / 分页；归档过滤必须在 count 与 list 使用同一谓词 | Finance 项目核算列表使用该合同避免先取固定大页再做客户端范围过滤；当前页只解析当前页项目财务摘要 |
| People BFF | Aims data-runtime | `GET /v1/aims/admin/projects?search=` + `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` | Tenant-runtime service token，`scope=aims.read`，来源 `people`；需 Console seed v1.24 授权 People runtime 读取 Aims | 读接口不要求；按 People 绩效周期 `project_code + period_start + period_end` 读取完整工时页，但只纳入 `review_status=approved` 的记录 | 已落地；保持兼容的 `source_biz_type=time_entries` 替换范围以清理旧快照，同时写入 `score_status=unscored`、`contribution_score=NULL`，页面显示“未评分” |
| People | Aims | `GET /api/v1/service/project-management-facts?periodStart=&periodEnd=&projectCodes=&afterRevision=&limit=` | Console service token，`aud=aims`、来源仅 `people`、精确 capability `aims:project-management-facts:read` | 以全局单调 `revision` 增量读取，返回 `correctionOfId`、结构化 `value`、`sourceRefs` 和 `sourceSha256`；`limit<=500`，项目过滤最多 100 个稳定 project code | 已落地；Console v1.91 授权。事实只在公司汇总 Codocs receipt 成功后生成，更正发布追加更高 revision，不覆盖旧事实。 |
| Aims | People | `aims.people-contributions.replace-scope.v1` → `POST /v1/people/service/contributions:sync` | 固定 dispatcher 申请 Console service token，`aud=people`、`scope=people:write`、来源 `aims`；浏览器不得指定 target/capability/tenant/deployment | Aims 只冻结期间内已审核工时，以既有 `time_entries` scope 维护单调 revision、完整集合与 caller-owned operation；People 重算 content hash，并在周期行锁事务内完成 replace-scope、水位推进及 target-owned receipt。低 revision 成功 `staleSkipped`、同 revision 同 hash 幂等、同 revision 异 hash 409；空集合是可推进的新版本 | 已升级为可靠操作/回执链路；新事实固定 `score_status=unscored` 且不携带默认分。People 仅允许 `collecting` 周期；confirmed/closed 周期保持不可变，通用贡献 CRUD 禁止写入。 |
| People BFF | People data-runtime | `POST /v1/people/service/performance-cycles/{cycleCode}:confirm` / `:close` | Console service token，`aud=people`，`scope=people:write` | 确认要求已有贡献快照；确认时固化周期 `confirmed_at` 和贡献快照 `confirmed_at`；关闭只允许已确认周期 | 已落地；People 绩效周期详情页提供“确认周期 / 关闭周期” |
| Finance BFF | People data-runtime | `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` | Tenant-runtime service token，`scope=people.read`，来源 `finance` | 读接口不要求；返回员工在 `effective_date` 有效、`is_primary=1` 且 `approval_status IN ('none','approved')` 的主任职、职级和匹配的 M/P 职级设置，不返回项目成本分摊金额 | 已落地；Finance 项目核算按标准成本实时计算；较新的 pending/rejected 任职不得覆盖已生效主任职 |
| Finance / 兼容方 | People | `GET /v1/people/service/employees/{employeeUid}/cost-snapshot?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；历史成本按月度快照固化 | 已在 data-runtime People adapter 落地；用于成本留档或兼容查询，不作为 Finance 项目核算主路径 |
| Finance / 兼容方 | People | `GET /v1/people/service/projects/{projectCode}/people-costs?period_month=` | Console service token，`aud=people`，`scope=people:read` | 读接口不要求；返回成本快照 + 绩效贡献快照聚合 | People adapter 已落地；保留兼容，不作为 Finance 项目核算主路径 |
| People BFF | Finance | `GET /api/v1/finance/service/performance-amounts?cycle_code=&period_start=&period_end=&employee_uid=&project_code=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `people` | 读接口不要求；返回 Finance `employee_finance_performance` 稳定 code、金额、计算状态、项目贡献范围和 `cycle_code` 透传引用 | 已落地；Finance BFF 在转发 tenant-runtime 前校验入站 service token；People 绩效周期详情读取展示 Finance 金额快照，不作为 Finance 写 People 绩效终态 |
| People | Workflow | `POST /api/v1/action-defs/sync` | Console service token，`aud=workflow`，`scope=workflow:proxy` 或 app service grant | `workflow:action-defs:people:{manifest_hash}` | Nuxt 启动插件已声明动作 |
| Workflow | People | `POST /api/v1/service/workflow/callback`（People BFF），内部写入 `POST /v1/people/service/workflow/callback` | Console service token，`aud=people`，`scope=workflow:callback`，来源 `workflow`；People BFF 使用自身 tenant-runtime 身份写入 data-runtime | `workflow:{instance_no}:people:{resource}:{id}:{status}` | 已落地；BFF 规范化 Workflow `resource_code/instance_id` payload，审批通过的任职变更会读取 People 任职事实并触发 Console Directory employment/offboarding 投影，拒绝/取消只同步审批状态 |

关键约束：

- `people_employees.employee_uid` 必须能映射 Console Directory `uid`；People 保存员工、岗位、职级、入离职和成本口径快照，但不替代 Console 登录身份、认证和权限。
- Platform 岗位来源的系统角色只自动授予归类为 `main_position` 的角色。`high_risk_privilege`、`approval_duty`、`management_duty` 和 `custom_role` 即使岗位编码精确命中也不得自动授予，须显式授权或人工归类为主岗位；被闸门排除的候选通过 lifecycle 结果的 `excludedCandidates` 返回，用于生成管理员待办。
| People BFF | Console Directory | `people.directory.identity-reserve.v1` / `identity-release.v1` / `user-provision.v1` / `user-provision-status.v1` / `activation-link.v1` → `/api/v1/console/service/directory/onboarding/*` | `aud=console`；精确 `console:directory-identity:reserve` / `console:directory-user:provision`；标准 envelope + source/target deployment HMAC binding；`actorUid=originalActorUid` 来自已验证用户会话，并由 Console 重签后传给 tenant-runtime | 由 HR 在前台发起并等待结果，不进 drain 队列；People 先以 CAS 进入 `reserving_identity`，持久化预留回执后才排队 LDAP 建号，断线可从已保存阶段续跑。只有已验真的建号 operation `succeeded` 且 LDAP identity 已落地后才签发激活凭据；明文令牌不回传 People，不进入站内通知或持久 delivery ledger，只在外部钉钉请求中短暂出现。失败可落入可处理状态，取消仅允许在预留开始前；重发会轮换并作废旧令牌。 |

- 受控入职复用既有权限，不新增权限资源：People 侧读取用 `employees:view`、资料完善用 `employees:edit`、开通/激活/取消用 `employees:admin`；Console 侧使用精确的 `console:directory-identity:reserve` 与 `console:directory-user:provision`，不得退回宽泛的 `directory_users:edit`。
- 遗留 `dt-*` 主体归并的产品入口只保留只读预览。由于产品内尚无全应用引用扫描与跨库原子提交能力，浏览器 BFF、People runtime 与 Console service 的执行入口均返回 410；不得以“人工已检查”的未验真声明执行不可逆改写。实际迁移只能在审计运维窗口按 `docs/runbooks/dt-uid-merge.md` 和 precheck SQL 分阶段处理。
- 入职单终态由 Console 报告的下游状态推进，People 不直接访问 Platform：Platform 下一跳 `succeeded` 即 `completed`；目录已生效但 Platform 未收口停在 `projecting_authorization`；Platform `dead_letter` 转 `authorization_failed` 并可在下次刷新时自愈。`completed` 只要求 Platform subject 与 baseline 权限成功，岗位角色缺失由 Platform 侧生成管理员待办，不阻塞入职完成；已取消的入职单不得被下游状态复活。
- 入职单激活为正式员工前必须向 Console 验真建号 operation 已 `succeeded`，且该 operation 必须是这张入职单自己发起的；不接受浏览器声称账号已创建。员工创建、首次 `change_type=onboard` 任职与 `people.directory.employment-sync.v1` 冻结在同一事务内完成，后续 Console 目录与 Platform 授权交给现有可靠链路，不另建投递路径。
- 受控入职在开户前必须先原子预留身份：`directory_identity_reservations` 对 active 预留的 uid、登录名、邮箱和外部主体各有唯一索引，过期预留在下次预留时自动回收。LDAP 账号要到 Connector 回执成功才写入 `directory_users`，仅靠 pending operation 只能挡同一个 uid，登录名与邮箱没有跨请求保护。UID 建议由 Console 判定可用性（`identity-reservations:suggest`），发起方不得自行猜测变体。排队建号成功即消费预留，之后由 `directory_users` 与 pending operation 接管排斥。
- People 受控入职的初始凭据走一次性激活链接：开户只生成抛弃口令并排队 LDAP，不签发激活凭据；建号 operation 成功且 LDAP identity 已落地后，独立激活命令才轮换/签发凭据。`directory_activation_credentials` 只保存令牌 SHA-256，带令牌 URL 仅投递到入职单冻结的钉钉 `provider_subject`；站内通知只保存无令牌 `/set-password`。兑换在单事务内校验、消费并排队 `console.directory-connector.reset-password.v1` 管理员改密；令牌无效/已兑换/已过期/已作废统一返回同一错误码。
- Console LDAP 建号的 `initialPassword` 为可选：缺省时由 Console 生成随机初始密码，只在内存中用 Connector 公钥加密，明文仅在创建响应中出现一次且不写入可重放的 `console_mutation_receipts.result_json`；调用方不得依赖重放取回密码。自助改密不适用该生成逻辑，缺少新密码仍返回 400。
- 钉钉同步不再为未命中既有身份的员工或未解析的经理合成 `dt-*` UID。未匹配员工落成 `people_onboarding_cases` 入职候选，候选不是 employee，不参与员工统计、任职、成本、绩效、资产、项目成员或权限范围计算；经理未落地时 `manager_uid` 留空，只透传 `manager_provider_subject`。`ResolveDingTalkPeopleBatch` 分别返回正式条目与候选条目，候选只能写入入职单。
- 工号是 People 自主管理事实，钉钉 `job_number` 不进入 Connector Runtime → People 契约；People runtime 对旧任务残留字段同样忽略。存量员工无条件按入职日期、员工主键从 `000` 全量重排，新员工通过 `people_employee_number_sequences` 行锁在入职资料首次保存或首次正式员工同步时分配，至少三位且超过 `999` 后自然扩展；分配事务同时检查员工与未取消入职单，已消费号码不回收。
- People 员工手机号以 `people_employees.mobile` 一等列为事实源，`metadata->$.directory_user` 快照仅作迁移前存量行兜底；入职日期和私密员工档案均按字段执行 `dingtalk > manual > oa_archive` 来源优先级。钉钉提供有效非空值时接管，未下发、空值或无效值不得擦除 People/OA 回退事实。
- Connector Runtime 持久化每次钉钉同步的字段覆盖率，按 `provided / empty / absent / invalid` 区分有效值、显式空值、未下发和无法规范化；`partial_fields_missing` 只在全部在职用户都缺少该字段键时产生。People 同步 JSON 与落库均保留该语义：absent 不覆盖旧值，显式空值可清除来源字段，无效日期不擦除既有有效值；People → Console 生命周期命令继续携带字段来源状态，使 Directory 也不会把 absent 与 empty 再次折叠。
- People 成本快照以 `period_month` 月末有效主任职生成，并固化 `assignment_code`、部门、岗位和职级快照；后续任职变化不得改写历史月份的读取结果。新增/批准主任职必须拒绝与已有 `none/approved` 主任职的日期区间重叠；Directory bootstrap sync 仅用于初始化校准，不得作为正常调岗入口。
- Console → People 导入只用于生产初始化或目录校准；不得把 Console 手工目录维护作为 People 正常人事流程的长期事实源。
- 钉钉部门外部 ID 不得进入跨模块业务键；已映射部门改名、移动时只更新 canonical 正式部门的名称、父级、排序、负责人等钉钉权威字段并保留 `dept_code`。首次接管仅在同一父级有唯一名称精确匹配的未绑定正式部门时建立 `path_matched` identity；同层存在未解析正式部门时失败关闭。稳态发现新部门时创建不含供应商 ID 的 opaque `DPT-*` code。每次出现记录 `last_snapshot_revision` 与规范化摘要；只有 final marker、根部门、计数和聚合 hash 全部验证通过才持久化缺失差异。缺失数量/比例超过租户阈值或根部门变化时标记高风险；无论风险级别都不自动停用，须 `people:hr_source_sync:admin` 逐项确认并在事务中重查活跃主归属和未纳入子部门。存在首次映射冲突时 People 服务端禁止启动同步，不能只依赖页面按钮禁用。旧 `DT-*` 部门在 Directory 软停用后，其 alias subject 与原成员非主归属在首个兼容周期仍向 Platform 投影为 active，确保其他模块的存量 `dept_code` 引用不失去授权；清理须等待跨模块引用清单验证归零。
- 根公司负责人补充：仅当 active 钉钉部门 identity 的 `external_department_id=1`、canonical 正式部门 active 且无父级、`manager_external_subject` 为空时，Console `directory_departments:edit` 可通过现有 PATCH 设置、替换或清空 `managerId`，沿用用户有效性校验、幂等 receipt、审计和 subject 投影。名称、父级、排序、状态和类型仍受钉钉字段保护；`leaderId` 沿用汇智云本地维护规则。Console 编辑只提交实际变化字段。钉钉根快照未提供负责人时保留现有 `manager_uid`；上游后来提供负责人时恢复钉钉接管及原 lifecycle 回填，普通子部门空负责人仍按上游清空。本地补充不改变钉钉 identity、canonical code 或来源标识。
- LDAP 只维护认证目录字段。对 `source_provider=people/hr` 的用户，LDAP 不得覆盖姓名、邮箱、手机号、职位、正式主部门、用工类型或正式部门 membership；委员会和虚拟组织 membership 始终不在钉钉正式部门同步范围。
- People → Console 投影必须由已审批或管理员确认的人事事件触发，禁止跨模块直连 Console 数据库或使用静态 webhook secret；首批已落地员工创建/更新、调岗主部门投影、离职停用账号、会话撤销和 Platform 授权来源回收，Workflow 审批回调通过 People BFF 校验 `workflow:callback` 服务令牌后，在任职审批通过时触发同一 Console Directory / Platform 授权生命周期投影。
- Aims 是项目清单和项目执行事实源；Finance 项目核算页不得通过手工项目编码维护项目清单，只能读取 Aims 项目并合并 Finance 财务摘要。
- `people_standard_cost_rates` 是项目人力成本测算前置主数据，当前只维护 M/P 职级工资和绩效工资范围；基本工资、福利费率、管理分摊系数和固定资源分摊由 Finance `finance_people_cost_parameter` 维护。
- People 职级设置页按 Console 系统参数 `people.rankSeries.managementCount` / `people.rankSeries.professionalCount` 生成 M/P 序列行，默认 M1-M5 / P1-P10；超出序列数量的历史规则不作为页面新增入口展示。
- People 月标准成本公式为：基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊；公式参数来自 Finance，不放入 Console 系统参数。
- `people_cost_snapshots` 是 People 成本留档能力，由标准成本规则或实际成本导入按月固化，不随员工当前事实变更自动改写历史月份；Finance 项目核算主路径不读取该表。
- `people_contribution_snapshots` 是 Aims 输出或 People BFF 从 Aims API 汇集后的个人绩效周期快照，不允许 People 直连 Aims 数据库补算；Finance 项目成本核算不依赖该表。
- Console Work Calendar 是平台月标准工时和日级工作/休息日事实源，节假日和调休按年导入并允许手工修正，月度 `standardWorkHours = workdayCount * standardHoursPerDay`。
- Finance 同步标准人力成本时按 `project_code + period_month + employee_uid` 生成稳定分摊编码，月标准成本由 Finance 参数 + People 职级设置实时计算，分摊比例为员工本项目当月工时 / Console 月标准工时，写入 `project_cost_allocation(allocation_type=labor)` 后重算项目财务汇总。
- Finance BFF 对每个项目/月份只调用一次 data-runtime 领域动作 `POST /v1/finance/project-accounting/labor-costs:sync`。该动作以 summary 行 `FOR UPDATE` 串行化，在同一事务内 upsert 员工成本快照和当前 managed labor allocation、反转完整集合中已消失的旧分摊、持久化 `cost_readiness_status/reasons/input_hash/checked_at` 并更新摘要；`expectedInputHash` 防止晚到的旧抓取覆盖新结果。外部源缺失或不可证明完整时也必须写入 `not_ready`、使旧 managed labor 失效并把毛利/毛利率置空。
- Finance 普通项目摘要重算不得改变成本 readiness；它必须锁定同一 summary 行，只有持久化状态为 `ready` 时才计算毛利，否则只能刷新收支/成本并保持毛利和毛利率为 `NULL`。项目列表、详情、月报、看板和维保摘要不得用“已有正数 labor allocation”推断 ready。
- 没有 People 员工职级、M/P 职级设置、Finance 人力成本参数或 Aims 工时时，Finance 只能标识“人力成本未就绪”，不得把项目毛利展示为完整成本核算结果。
- 个人绩效周期创建、评分、确认、申诉和归档归 People；Finance 的 `employee_finance_*` 与 `performance_*` 对象只表达财务贡献归因、提成/奖金/绩效金额快照和计算依据。
- Finance 不写 People 个人绩效终态；People 读取 Finance 金额快照时只保存稳定业务键和必要摘要，不复制 Finance 财务明细。
- People 文档只保存 Codocs `document_uuid`，不保存正文。

## Altoc / Assets / Aims / Codocs / Finance 运维服务契约（Phase 4）

Phase 4 不新增独立运维应用，按现有事实源拆分：Altoc 管客户成功经营事实和服务工单入口，Assets 管客户系统 / 交付实例，Aims 管工单执行和缺陷 / 需求回流，Codocs 管运维知识正文，Finance 管维保收入和服务成本。

| 调用方 | 被调用方 | 端点 / 事件 | 认证 | 幂等 / 追溯 | 状态 |
| ------ | -------- | ----------- | ---- | ----------- | ---- |
| Altoc | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | Console service token，`aud=assets`，`scope=assets:read` | 读接口不要求；`customer_code` 必填 | G2-5 收口：精确 AND 过滤交付视图，并返回产品、正式资产、正式资产环境关系和仅含 UUID/类型/必要快照的文档；缺 `asset_documents.artifact_type/source_context` schema 时 503，不降级为语义不完整的成功响应 |
| Aims | Aims tenant-runtime | `POST /api/v1/service/projects/{projectCode}/milestones/{milestoneId}:rollover` / `POST /api/v1/service/milestones:rollover-due` | Console service token，`aud=aims`，`scope=aims:write`，来源仅 `aims` | `aims:milestone:{projectCode}:{templateKey}:{periodStart}:rollover:v1`；runtime 以 `project_id + template_key + period_start` 事务兜底 | 新增：Aims BFF 手动入口和 Nitro scheduled task 调用；runtime 只允许 periodic 里程碑关期，关闭当前周期、创建下一周期，并写入 `milestone_cycle_snapshots` 作为 R 阶段复盘输入 |
| Altoc | Aims | Altoc 用户编排 `POST /api/v1/service-tickets/{ticketCode}/aims-work-item` → Altoc freeze/claim → `POST /api/v1/service/service-tickets/{ticketCode}/work-item/receive` → receipt 校验与 Altoc complete checkpoint | 用户需 `service_ticket:edit`；跨应用 Console service token `aud=aims`、精确 capability `aims:service-ticket:work-item:create`、来源 `altoc`；原 actor 走独立签名 delegation | `altoc:service-ticket:{ticketCode}:aims-work-item:v1` | G3 可靠闭环：Altoc 锁定工单和可信项目上下文，在同一事务提交最小冻结 command、dispatch 投影和 caller operation；Aims 工作项 mutation、初始结果 operation 与 succeeded receipt 同事务。目标按全局 `source_ticket_code` 防改绑，Altoc 在精确 receipt checkpoint 后原子绑定项目/工作项；ACK 丢失按原键恢复，succeeded 重放不回退 pending，永久失败须受控 replay。旧 raw `POST .../work-item` 已从 middleware 移除并由 runtime 返回 `410 legacy_service_ticket_work_item_retired`。 |
| Aims | Altoc | Aims 单条 `PUT /api/v1/work-items/{id}` 或 `PATCH /api/v1/work-items/batch` 的服务工单状态修改原子写 operation → Aims operation claim/drain → `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` → succeed/fail checkpoint | Aims operation runtime 需 `aims:integration_operation:execute`；跨应用 Console service token `aud=altoc`、kebab-case capability `altoc:service-ticket:delivery-result:sync` | `aims:work-item:{workItemKey}:ticket-result:g{generation}:v1` | G3 可靠闭环：业务事实、单调 generation 和 caller operation 同事务；批量仅在 `changes.status` 且已关联服务工单时按工作项创建 operation，保留 `updated` 响应且不在请求中 N 次外呼。operation 冻结失败会回滚整个批量写入；同状态返回真实 operation status 并校验 command hash。Altoc 工单写入与 receipt 同事务，较旧 generation 幂等忽略，resolved/closed/cancelled 不因更高 generation 非法重开；source ACK 暂不可用由原 operation 恢复。即时、专属 task 和共享 Gateway wake 复用 executor；阈值 dead-letter、管理员诊断/重放已落地。 |
| Altoc / Aims / Finance | Altoc | `GET /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `GET /api/v1/service/service-agreements/{serviceAgreementCode}/default-project?allow_missing=true` | Console service token，`aud=altoc`，`scope=altoc:read`，来源按调用方 | 读接口不要求；使用 `service_agreement.code` 和 Aims `project_code` 作为跨应用键 | 新增：Altoc 通过 `service_agreement_project_rel` 维护服务协议到 Aims 项目的结构化关系；默认项目严格按当前有效 active/default 关系解析，多默认时报错，`allow_missing=true` 仅允许无默认时返回空 |
| Altoc | Altoc | `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/default` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:end` / `POST /api/v1/service/service-agreements/{serviceAgreementCode}/project-relations/{projectCode}:suspend` | 用户需 `contract:edit` 或 service token `aud=altoc`，`scope=altoc:write altoc:contract:edit` | `altoc:service-agreement:{serviceAgreementCode}:project:{projectCode}:{action}:v1` | 新增：服务协议项目关系由 Altoc data-runtime 事务写入；设置默认项会先清理同协议当前 active/planned 默认关系，保证当前默认解析唯一 |
| Altoc 用户编排 | Altoc / Codocs / Assets | `POST /api/v1/service-tickets/{ticketCode}/ops-knowledge` → Altoc `ops-knowledge:reserve` → operation claim → Codocs link + succeed/fail checkpoint → Assets document link → Altoc `ops-knowledge:complete` | 用户需 `service_ticket:edit`；跨应用分别使用 `aud=codocs/assets`、`scope=codocs:documents:write/assets:write`；operation runtime 需 `altoc:integration_operation:execute` | canonical root 固定为 `altoc:ticket:{ticketCode}:ops-knowledge:{documentUuid}`；外部 header 不得覆盖 | G3 可靠闭环：Altoc reservation 与两条 caller operation 同事务；Codocs relation 与 receipt 同事务，Assets document link/event 与 receipt 同事务；source 对每步校验 receipt 并保存 `target_receipt_id`，最终 Assets receipt 与工单 linked 投影原子收口。即时、专属 task 和共享 wake 复用 executor；dead-letter 使用 Console 幂等通知。管理员诊断/重放已落地；attempt UI 和部署态 live acceptance 仍待完成 |
| Finance | Altoc | `GET /api/v1/service/customers/{customerCode}/maintenance-summary` | Console service token，`aud=altoc`，`scope=altoc:read`，来源 `finance` | 读接口不要求 | P4.1 已落地：读取维保合同、SLA 权益、最近工单和续约机会摘要；Altoc BFF 在转发 tenant-runtime 前校验入站 service token |
| Altoc / Finance | Finance | `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=` | Console service token，`aud=finance`，`scope=finance:read`，来源 `altoc` 或 `finance` | 读接口不要求；Altoc 必须先解析维保范围，Finance 要求至少一个合同或项目编码 | G2-5 收口：Finance 统一使用 `customer AND (maintenance contract OR maintenance project)`，用户项目授权再作为额外 AND；空业务范围 400，项目授权空集返回空结果。Altoc 显式非法过滤不得回退为另一维全量；Finance/Assets 404 均按上游不可用失败，不伪装成成功空数据 |

关键约束：

- `service_ticket.code` 是工单主业务键；回流到 Aims 后只保存 `aims_work_item_key` / `aims_project_code` 引用，不复制工作项正文。
- 服务协议到 Aims 项目的事实源是 Altoc `service_agreement_project_rel`，只保存 Aims 稳定业务键 `project_code`；Aims 继续负责项目、任务和工时执行事实，Altoc 不保存 Aims 本地主键。
- Altoc 服务工单派发 Aims 工作项时，项目解析顺序固定为：显式 `projectCode`、工单已绑定 `aims_project_code`、服务协议默认项目、旧版合同唯一候选项目兜底；若服务协议存在多个当前默认项目或旧版合同候选无法唯一确定，派发必须失败并暴露数据修复信号。
- 派发前 Altoc 必须读取 scoped `GET /v1/altoc/service-tickets/{ticketCode}/dispatch-context`，客户/合同/维保合同/服务协议编码以 runtime JOIN 事实为准；旧合同兜底必须通过 Aims `contract_match=exact` 查询最多两个精确候选，不得先取客户分页再在 BFF 过滤。
- Aims 使用 `work_items.template_key=altoc:service_ticket:{ticketCode}` 和 `work_item_service_ext.source_ticket_code` 唯一键记录来源自然绑定；同一工单不能改绑到另一项目。可靠写入口仅为 receipt-only `/work-item/receive`，旧 raw `/work-item` fail closed。若 Altoc 未指定里程碑，Aims 会创建 / 复用 `template_key=service_ops` 的项目里程碑作为工单执行容器，不新增 `work_items.type` 枚举。
- SLA 响应 / 解决时限由 Altoc 计算，Aims 只保存 `work_item_service_ext.sla_status_snapshot` 作为展示快照，并从执行状态派生 accepted / processing / resolved / closed 回写。首次响应晚于截止时间时不得因后续解决而改回 met；小时额度按 Aims 累计工时与工单已消费值之差扣减。
- Altoc 已绑定的 `project_code/aims_project_code + aims_work_item_key` 不得被后续回写覆盖；Aims 回写使用单调 generation，resolved / closed / cancelled 终态不得因更高 generation 回退 processing。Aims 只在工作项恰有一个关联文档时回写 Codocs UUID；多文档候选必须先消除歧义。
- 运维知识正文只保存在 Codocs；Altoc / Assets 仅保存 `document_uuid` 和客户、系统、产品版本上下文，Codocs 用稳定非用户主体建立客户、合同、项目、正式交付资产、环境、工单六类非 ACL 索引关系，不复制业务主档或改变文档授权。
- 维保收入以 Finance 财务事实为准；Altoc 提供维保合同、服务期和续约经营上下文。Altoc 客户页读取 Finance 摘要时只传维保合同关联的 `contract_codes/project_codes`；无显式过滤时传全部维保范围，有任一显式过滤时只传该显式维度的合法交集，不得用未请求的另一维补全扩大范围。

## Aims 产品对象授权内部契约（实施中）

- 当前精确服务授权的生成式 Seed／Verify 和签发组合见 [产品中心服务授权安装与验收](../aims/docs/Aims-Product-Center-Service-Grants.md)。脚本仅选择指定的 Aims／Assets 客户端，双 runtime audience 分别授权；18 条业务 grant 与 6 条既有传输前提逐项核验。仓库具备脚本不代表目标租户已经安装或实际签发成功。

- `GET /v1/aims/internal/products/{productCode}/authorization-object` 为 Aims BFF 到本应用 Runtime 的内部读取，不建立浏览器 API。要求受信来源应用 `aims`、tenant/deployment/client 上下文、已签名用户 actor，以及精确能力 `aims:products:authorization-object`；`aims.read` 传输权限或通配能力不替代该能力。
- 返回 `{ code: 0, data: { product_code, actor_uid, status, revision, is_member, is_manager } }`，只包含当前 actor 的关系事实。关系基于 Aims `product_members` 的 active 状态和数据库 UTC 当前时间（含起始、不含结束），不读取 Assets 所有者或项目成员。
- Aims `checkProductPermission` 验证响应产品／actor 一致后，调用 Foundation → Console scoped authorization，以 Manifest 声明动作和真实产品关系判定；事实读取本身不授予任何业务动作。
- 内部接口额外要求 Runtime 已验证 `hzy_runtime_actor_delegated=1`、空 actor purpose，且 actor 不等于 service client；拒绝普通服务主体回退和通知／service-command 身份挪用。Query 中伪造的受信字段会被 Runtime 入口清理。
- 已接入的浏览器接口为 `GET/PATCH /api/v1/products/{productCode}`、`POST .../archive`、`POST .../restore`。PATCH 输入 `{ expectedRevision, positioning, targetUsers, valueStatement, reason? }`，三个定位字段须显式提供，null 表示清空；生命周期输入 `{ expectedRevision, reason }`。写入必须有 `Idempotency-Key`。不允许浏览器提供 actor、授权、产品状态或 Runtime 命令字段。
- BFF 完成 Console 授权后构造一次请求的 `{ resource, action, facts, expires_at }`，有效期 15 秒；Runtime 拒绝已到期或距数据库时间超过 30 秒的上下文。它只在可信 Aims 服务通道传输，不返回给浏览器、不存为用户权限缓存。
- `GET /api/v1/products/{productCode}/permissions` 为页面提供当前产品的 edit／archive／restore／admin 提示；先验证产品 view，再通过相同 Foundation 授权 helper 分别检查每个动作。返回 no-store，不包含授权证据或完整 grants。此响应不是命令授权凭证，PATCH 仍独立重验身份、范围、revision 与幂等键。
- BFF 请求内部 `POST /v1/aims/internal/products/{productCode}/workspace:{view|edit|archive|restore}`，分别需要精确能力 `aims:products:{action}`；view 使用 aims.read 传输 scope，其他使用 aims.write。Runtime 先校验服务能力，再锁产品根记录并重新读取关系；事实与 Console 决策输入不一致则 409，客户端须重新发起完整授权请求。
- 工作空间 mutation、revision 递增、活动历史及成功回执处于同一事务；重放也先重验授权，业务 expectedRevision 仅在首次执行检查。重复键异 payload／并发冲突 409；已归档空间可读，编辑须先 restore；归档／恢复必须有原因。缺产品表／列为 503，不影响既有项目表的启动检查。
- 产品目录列表范围、真实令牌 grant 签发与租户启用仍待后续接入。本端点能力尚未自动播种或部署，产品页面不能据此标记已可用；缺能力必须失败关闭。

### 授权产品列表（C000001 测试环境已验收）

- `GET /api/v1/product-permissions` 返回当前用户显式全租户 onboard 提示，复用接入命令相同的全局授权 helper，no-store；依赖失败保留 503，拒绝授权返回 onboard=false。目录刷新每个命令仍重新鉴权，页面提示不是授权凭证。
- `GET /api/v1/products` 接受 page/pageSize（最大 100）、keyword、productLine、status=not_enabled/active/archived（省略表示全部）。BFF 从 Console 获取当前主体 products:view 授权，使用 Foundation `compileFoundationProductScope`，浏览器不能提供 actor、scope 或可见产品数组。
- Foundation 对非成员／有效成员／有效经理三个产品事实状态复用同一 evaluator，输出默认匹配位和具体 product_code 覆盖；仍在同一 grant 中判断权限、动作蕴含、default/assignment scopes，Runtime 不解释角色或策略。相关显式产品编码最多 512 个，超过返回 503，不截断；不相关动作不占此上限。
- 详情和列表共同使用 `evaluateFoundationProductAuthorization`，只接受产品事实可表达的 tenant-global、product code/member/manager 和已知产品关系谓词；含部门／项目／未知范围的 grant 不生效，不能用缺失上下文扩大权限。
- 内部 `POST /v1/aims/internal/product-list` 要求签名用户、可信 Aims 服务和 aims:products:view，传输为 aims.read。短时授权绑定 actor/resource/action；Runtime 在同一只读 repeatable-read 快照内关联生效目录及有效成员，先做范围和业务筛选，再计数与分页。成员有效期使用同一数据库时间点，避免总数与页数据因自然到期产生分歧。
- 列表合并生效目录与已有空间，同一 product_code 仅一行；只有目录、尚无空间时 status=not_enabled、biz_id=""、revision=0，并按非成员 products:view 范围求值。成员／经理范围不能据此看到其他未启用产品；显式编码和全租户查看范围仍有效。启用操作继续单独要求全租户 products:onboard，并实时核验 Assets 状态及初始产品经理。
- 返回 items/total/page/pageSize/catalog_generation/catalog_updated_at。未刷新或主档删除时，按权限保留空间和 product_code，目录字段为 null，不混入实时数据或伪造名称。GET 不创建、刷新或写审计；没有匹配权限时返回空列表。C000001 测试环境已验证统一目录 53 条、分页、搜索与同步后刷新；生产发布不在本轮范围。

### 产品空间接入（实现中，未部署验收）

- 浏览器 `POST /api/v1/products` 要求显式 tenant-global `products:onboard` 和 `Idempotency-Key`，输入 productCode、managerUid、reason 以及可选 positioning/targetUsers/valueStatement；不能输入主档名称、状态、授权或目录证据。未填写的定位字段为 null。
- BFF 先通过 Assets 精确目录接口核对大小写一致的单条主档和 onboardable，再通过 Foundation Directory active-status 核对指定负责人；不默认采用 Assets owner 或当前 actor，不创建虚拟项目。外部读取失败则不启动本地接入事务。
- 内部 `POST /v1/aims/internal/products/{productCode}/onboard` 要求可信 Aims 服务、签名用户和 `aims:products:onboard` 精确能力，使用 aims.write 传输 scope。BFF 构造产品／actor／动作绑定的短时授权、主档水位与负责人证据；Runtime 在取得产品根锁后检查各证据有效期，不能把外部快照误称为跨应用原子事务。
- 空间、active manager 关系、onboard 活动记录及成功回执同事务提交；失败无残留。按产品唯一根锁串行化并发接入，同 actor／键／业务内容重放原回执，异内容或其他键对已有空间返回 409；不覆盖定位或重新启用归档空间。重放同样需要新授权和来源核验。
- 初始 manager 关系仅提供产品对象范围，不自动赋予动作权限；租户角色安装、service grant 与实际租户验收仍须完成。接入不刷新或覆盖目录代际投影。

### 产品线统一管理（2026-09-11，代码实现，未部署）

- AIMS 增加产品线管理主体及来源产品→功能模块映射；Assets 继续拥有产品线与产品主档，AIMS 的 `~line-` 保留编码不是新的 Assets 产品编码，不得用它伪造源产品身份。详见 [产品线统一管理契约](../aims/docs/Aims-Product-Line-Management.md)。
- 浏览器 `GET /api/v1/products?tree=true` 按授权后的产品线分页，`childLine` 单独展开分页；范围仍由 Foundation 编译，来源模块按统一空间的产品权限和有效成员求值。完整资格检查不受前端产品分页或筛选影响。
- `GET /api/v1/product-candidates?mode=line&productLine=...` 和 `POST /api/v1/products` 的 productLine 形态要求原有 tenant-global products:onboard。只允许尚无独立/归档空间的整条线一次性启用，BFF 用既有 Assets 精确目录 API 的 productLine/watermark 分页合同取完整快照（最多 1000 项），源状态及有效经理重新核验。
- 新内部 `/v1/aims/internal/product-line-onboard` 复用 `aims:products:onboard` 与 aims.write，保留签名 actor、可信 Aims 服务、租户/部署和短时证据验证。空间、经理、模块、唯一来源映射、审计及回执同事务；独立启用/统一启用/目录激活共用控制锁，失败回滚。既有 Assets / Directory capabilities 和 Console grants 不增加。
- 目标先安装 v5.37 两表迁移，再更新 Runtime 与 AIMS；本次未对目标租户执行迁移、赋权或部署。

### 产品目录代际刷新（实现中，未部署验收）

2026-09-13 显示口径：Aims 产品树、统一空间标题和名称搜索优先读取当前 active 目录的产品线标签，接入时 `line_label` 仅作缺失回退；Assets 改名仍经显式目录同步生效。首页产品线下拉框复用带用户范围的产品树读取，无新增跨应用调用或授权。

- 浏览器 `POST /api/v1/products/catalog-refresh` 要求显式 tenant-global products:onboard，输入仅 action=start/continue/status/cancel、refreshId 和继续时的 expectedRevision。start 需 Idempotency-Key，只创建批次；后续每次 continue 最多从 Assets 读取一页 100 条，页码和水位由服务端保存的批次状态决定，浏览器不能提交目录行或任意源游标。
- 内部 `/v1/aims/internal/product-catalog/start|view|append|fail` 均要求签名用户与精确 aims:products:onboard；view 为只读 aims.read，其余 aims.write。批次限定创建 actor；每次读取、继续、取消和页回执重放均重新执行全局授权，授权过期拒绝。start 按 actor＋幂等键生成稳定批次 ID，不创建伪产品或虚拟项目。
- product_catalog_control 单行锁序列化提交；product_catalog_page_receipts 按 generation＋page 保存内容 hash 与结果。逐页校验总数、水位、完整条目数和跨页稳定顺序；页写入、游标、回执和最终生效切换同事务。相同页同内容重放不重复累计，异内容拒绝；过期 revision 不能跳页覆盖。
- staging 不参与普通产品列表。全部页完成后原子 supersede 原 active；较新批次已经生效时拒绝较早批次覆盖。来源水位 409 会尝试标失败，暂时不可用保留可续批次；取消标 failed，已有 active 目录保持可读。空主档目录可以完整切换，历史产品空间不随目录消失删除。
- 响应包含 refresh_id/status/watermark/row_count/revision/next_page/total；start 的 total=-1 表示尚未读取，完成的 next_page=0。并发继续返回 revision 冲突时客户端读 status 后再继续，不能盲目递增页码。最后刷新展示和授权列表页面仍待实现。

### 产品成员管理（实现中，未部署验收）

- 浏览器 `GET/POST /api/v1/products/{productCode}/members`、`PATCH/DELETE .../members/{memberId}` 全部要求产品对象的 products:admin；读取同样不以菜单隐藏代替授权。Runtime 内部命令为 members:list/create/update/revoke，精确服务能力 aims:products:admin；list 使用只读传输 scope，其余使用写入 scope。
- 列表按 uid、relation_type、id 稳定排序，返回 items/total/page/pageSize/workspace_revision，pageSize≤100；可按 relationType/status 筛选。effective 只表示本地关系状态及当前有效期，不代表目录用户仍有效，更不代表动作权限。
- 创建／更新输入 uid、relationType、status、validFrom、validUntil、expectedRevision、reason，更新另需 expectedMemberRevision；日期为 UTC ISO 毫秒字符串，validUntil 必须显式为 null 或晚于 validFrom。memberId 由路由解析、uid 不可替换。DELETE 软停用，输入 uid、两个 revision、reason，保留关系及活动历史。
- continuingManagerUid 可显式指定调整后继续负责的经理；普通操作默认当前 actor，新增／调整 active manager 默认目标 uid。BFF 通过 Foundation active-status 视图验证此人，以及新建或需要启用的目标用户（单次最多两人）。该校验不自动赋予任何产品角色权限。
- Runtime 在产品根锁下执行授权事实重验、成员和空间 revision 检查、变更、接管经理当前关系核对、活动历史及回执。接管人必须在同产品且当前 active、已生效、未到期；外部状态依据由可信 BFF 构造、15 秒有效，过期拒绝。最后经理撤销／降级、跨产品接管、未来才生效的接管均整体回滚。
- 保护的是本次主动操作后的当前责任关系；后续人员停用或自然到期可能产生无经理空间，仍按主方案由显式全租户产品管理员接管。归档空间禁止调整成员，需先恢复。

## Aims → Assets 产品目录契约（实施中）

- 新增 `GET /api/v1/service/products/catalog`，入站要求 `aud=assets` 与精确 `assets:product:read`；能力定义在 Assets manifest，调用方资格由 Console active service grant 控制，不另设业务调用方白名单。Assets 使用自身服务身份访问 `/v1/assets/service/products/catalog`，不得转发入站 Aims Token；Runtime 同时要求可信 Assets 来源、tenant/deployment/client 和精确能力。
- 查询：`page`（1～1000000）、`pageSize`（1～100，默认 100）、`keyword`、精确大小写 `code/productLine`、`watermark`。响应含精简主档 `items`、`total/page/pageSize/nextPage/watermark`；不返回资产关系或项目数据。`onboardable` 当前仅允许 poc/mvp/mmp/pmf/iterating，eol 和未知状态拒绝接入。
- 每页在同一只读数据库快照读取水位、总数和主档；后续页必须携带首批水位。产品主档或产品线分类变化递增水位；不匹配返回 409，调用方必须丢弃未激活的刷新批次并重启。迁移缺失或未就绪返回 503。GET 不生成目录投影或业务审计。
- Aims 候选入口 `GET /api/v1/product-candidates` 先检查显式 tenant-global `products:onboard`，再读取目录；不把此服务目录作为普通用户已授权产品列表。正式产品列表仍须独立执行产品范围过滤和分页。
- 当前完成代码、单元／SQL mock 及隔离 MySQL 验证：101 条分页、主档／产品线变更使旧水位失效、事务回滚水位不变、迁移重放及未就绪拒绝。Console 精确 grant Seed／Verify 已提供并经隔离 MySQL 验证；真实租户安装／签发、目录刷新和用户页面尚未收口，不代表租户可用。旧 `/service/products` 的分页改造仍需另行完成，不能用新接口测试证明存量接口已分页。

## Aims ↔ Assets 产品版本契约（有效）

定位：

- Assets 是产品主档事实源，稳定业务键为 `product_code`；`product_assets.current_version` / `target_version` 仅是台账展示快照。
- Aims 是产品版本事实源，维护 `product_versions`、`product_version_features`、`work_items.version_id` / `feature_id` 与版本进度聚合。
- Aims 的项目↔产品关联事实源为 `aims_project_products`。Assets 的 `product_assets.project_code` 仅用于历史台账和一次性初始导入，不作为在线关联事实源。

Service API：

| 调用方 | 被调用方 | 端点 | 认证 | 用途 |
| ------ | -------- | ---- | ---- | ---- |
| Aims / Altoc | Assets | `GET /api/v1/service/products?keyword=&codes=` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` 或 `altoc` | Aims 项目关联产品、Altoc 合同行绑定软件产品时查询产品主档精简信息 |
| Aims | Assets | `POST /api/v1/service/products/resolve-codes` | Console service token，`audience=assets`，`scope=assets:read`，来源应用 `aims` | 按产品编码批量解析产品名称/状态 |
| Assets | Aims | `GET /api/v1/service/products/:productCode/version-summaries` | Console service token，`audience=aims`，`scope=aims:product-version-summary:read`，来源应用仅 `assets`；AIMS 到 Runtime 使用同名精确 capability | 产品详情页只读展示版本元数据、公开特性总数与已交付数；不含项目、人员、工作量、特性正文。旧 `/versions` 接口仅保留兼容，Assets 已不调用 |

`GET /api/v1/service/products` 的产品线字段同时返回稳定 code、展示名和 Assets 定义顺序：`productLine` / `product_line` 保留 Assets 产品主档原始 `product_line` 值（大小写不得由调用方归一化），`productLineLabel` / `product_line_label` 来自 Assets 资产类别管理中的产品线名称，`productLineSortOrder` / `product_line_sort_order` 来自产品线分类的 `sort_order`。调用方应用应使用 code 做过滤和写入引用，使用 label 做 UI 展示，并按 `productLineSortOrder` 排列产品线选项；当 label 缺失时才回退显示 code。

批量解析时，Assets BFF 必须把去重后的编码集合以单次 tenant-runtime 请求的 `product_codes=code1,code2` 下推；runtime 使用精确 `IN` 过滤一次读取，不能按编码逐条调用或把未命中的全量产品返回给 BFF。`POST /api/v1/service/products/resolve-codes` 的响应顺序与调用方首次传入的编码顺序一致，重复编码只返回一次。

Cloudflare 多租户部署下，上述服务调用的 base URL 由 Foundation 按 appCode 解析共享应用 origin，不读取 Console runtime `applications.homeUrl` / `applications.apiBase`。`applications.homeUrl` 可以是 `https://<tenant>.huizhi.yun/<app>/` 这类租户入口，仅用于用户导航；`applications.apiBase` 是应用逻辑 API root，不作为服务端跨应用 origin 配置。

Console grant 种子：`console/docs/sql/Console-SQL-Seed-v1.15-aims-assets-version-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.32-assets-service-api-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.33-altoc-aims-codocs-service-grants.sql`、`console/docs/sql/Console-SQL-Seed-v1.50-aims-codocs-project-cabinet-grants.sql`（v1.50 仅文件，未执行）。

## WebDev Issue 上报契约（阶段2，实现中）

业务应用（codocs/finance/workflow 等）向 WebDev Issue 收件箱上报问题：

- **链路**：业务应用前端 Foundation 报告组件 → 业务应用本地 `POST /api/webdev-report/issues`（Foundation 共享路由，派生当前用户身份）→ `requestServiceAccessToken({ audience: 'webdev', scope: 'webdev:issue:write' })` → `POST {webdev}/api/webdev/issues/intake`。业务应用前端不直连 WebDev、不持有 WebDev 凭证。
- **WebDev intake 校验**：Console JWKS + `aud=webdev` + `token_use=service` + `scope=webdev:issue:write` + 来源 `hzy.appCode` ∈ 允许上报应用集合（`HZY_WEBDEV_REPORT_ALLOWED_APPS`）。`app_code`/`tenant`/`reporter_uid` 只信任服务端派生，不接受客户端覆盖。
- **落库**：WebDev Console 用户读写走带完整 request-target HMAC actor delegation 的 `/v1/webdev/issues*`；已验证跨应用上报仅走精确 actorless service bridge `POST /v1/webdev/service/issues/intake`，而“我已提报”仅走 `GET /v1/webdev/service/issues/mine`。intake 内部自动领取只允许其固定的 settings/read/claim/patch/service-job persistence 子路径，不能放开通用 `/service/**`。Data Runtime 从已验证 runtime context 强制 tenant，普通路径覆盖浏览器自报的 `createdBy`、`reporterUid`、审计 actor 与 tenant。命中自动领取规则（severity=高 且 bug 且 app ∈ 白名单）时创建 Dev Agent 任务，幂等键 `clientRequestId=issue-<id>`。
- **WebDev → Data Runtime**：托管 tenant-runtime 部署必须由 WebDev 以 `service-client-policy` 获取自身 `webdev.runtime` 短期令牌，绑定目标租户的 `<tenant>-webdev` deployment；读写分别请求 `data-runtime:webdev:read|write`（或配置 audience 对应的 `tenant-runtime:*` scope）。WebDev 不得把上游业务应用 service token、Platform bootstrap credential 或长期 static token 转发给 Data Runtime；static bearer 仅保留给显式非 tenant-runtime 的本地/PoC 部署。
- **「我已提报」**：`GET /api/webdev-report/issues` → WebDev `/api/webdev/issues/mine`，按当前用户 + 层级过滤。
- **自动领取规则**：存于 `webdev_issue_settings`（按租户），WebDev 项目设置页维护，intake 评估命中后建任务；未配置时回退 `HZY_WEBDEV_AUTO_CLAIM_APPS` 等 env 默认值。
- **状态通知**：Issue 领取与状态流转（verifying/resolved/closed）经 Foundation `publishNotification`（audience=notifications）通知反馈人；WebDev 需 `notifications:publish` grant。
- 设计详见 `webdev/docs/WebDev-Issue-Inbox-Design.md`。Console 需为业务应用 service-client 配置 `webdev:issue:write` grant，为 `webdev.runtime` 配置 Data Runtime 双 audience 的 `webdev` read/write grant，并为 WebDev 配置 `notifications:publish` grant。

## Foundation 代理层

Foundation 作为 Nuxt Layer 提供服务端代理：

- `server/utils/accountApi.ts` — Account API 封装（legacy directory bridge）
- `server/utils/webdevReport.ts` — 业务应用 → WebDev Issue 上报/查询代理（service token）
- `server/utils/directoryApi.ts` — Console Directory API adapter；新接入模块通过 Console runtime config 只读 Console，不提供 Account fallback
- `server/utils/syncApprovalActions.ts` — 启动时同步审批动作
- `server/utils/serviceOidc.ts` — Console service token 获取，供跨模块服务调用、同步和回调使用
- `server/utils/platformBundleAuthorization.ts` — 业务应用授权消费层；普通权限快照和 scoped authorization 均调用 Console runtime，生产不读取业务应用本地 policy bundle，也不在 Console 不可用时降级为本地旧 bundle
- `server/api/workflow-proxy/[...path].ts` — Workflow API 透明代理

业务模块前端通过 Foundation 的 composables（`useAccount`、`useWorkflow`）访问平台服务，不直接调用。

授权事实源边界：Platform 负责 manifest、角色授权关系、scope、动作蕴含和签名 bundle；Console 负责拉取、验签、缓存、模拟会话以及生成普通/scoped 权限快照；Foundation 只把 Console 授权结果和 `actionPolicies` 适配给业务应用；业务模块只调用 Foundation helper。算法唯一事实源是 `@hzy/authz-core`，业务应用不得直接调用 `readCachedPlatformBundle()`，不得自行解析 policy bundle、选择有效角色或复制动作蕴含。

## Platform → Tenant Runtime 注册与治理

- 租户管理员从 Platform 复制安装命令；命令只携带短期单次 enrollment code，不携带长期 Runtime token、数据库密码或 release private key。
- Agent 通过 `POST /api/v1/runtime/enroll` 兑换独立入站兼容 token 和 control token；Platform 只保存 hash，并以 `(tenant, environment)` Runtime instance 绑定多个应用 deployment。
- Agent 使用 control token 调用 `POST /api/v1/runtime/agent-heartbeat`，只上报版本、release key id、endpoint、数据库连通性和各应用 Schema 粗粒度状态。
- Platform Admin 通过 `GET /api/platform/ops/runtime-releases` 查看稳定渠道、签名制品和实例版本分布；`POST /api/platform/ops/runtime-releases/sync` 从 R2 同步 `latest` 或精确版本并用当前 Ed25519 trust anchor 验签，`POST /api/platform/ops/runtime-releases/approve` 动态移动数据库中的 `stable` 渠道指针。批准与回滚均要求 `ops.deployments/deploy`，并写入 `platform_audit_logs`。发布目标不依赖 Platform Worker 版本；`HZY_DATA_RUNTIME_APPROVED_VERSION` 只作为首次动态批准前的迁移兜底。
- Platform Admin 批准或回滚 `stable` 渠道时，在同一数据库事务内把新版本物化到签名 key 一致的 Runtime `desired_version`；企业控制台以 `stable` 渠道作为有效目标版本事实源，避免已批准版本因实例行或 HTTP 缓存滞后而继续显示旧目标。Agent heartbeat 仍负责离线实例的最终校准和当前版本上报；版本漂移只标记 `runtime_version_incompatible` 作为滚动升级信号，不把数据库、endpoint 和信任锚均健康的运行时摘出数据面。默认禁止批准版本导致隐式降级，只有 Admin 明确确认且渠道记录为 `rollback` 时才允许下发更低目标。Signing key 变化不得通过批准或 heartbeat 隐式轮换，必须显式重新 enrollment。
- Tenant Gateway 只有在 Runtime instance 为 `ready` 且对应应用 binding 为 `schema_ready|active` 时才为业务 API 注入 endpoint；未就绪必须失败关闭，不得回退 Worker 直连数据库。业务应用自身的 `/api/auth/**` 是控制面例外：当当前应用 binding 未就绪但 Console binding 已就绪时，只允许这些认证路由借用 Console 的 runtime endpoint 完成 OIDC/session 操作，其他业务 API 仍不得获得 endpoint。
- Agent 的业务入站 JWT 仍由 Console 签发；runtime 按 `appCode` 查找 enrollment 中对应的 deployment binding 并精确校验，control token 不得用于业务 API。

## Align 协同边界（新增）

`Align` 调整为未来可选的深度组织协同业务模块，不再承担全平台统一员工入口。轻量待办、通知、公告摘要、最近访问、常用入口和简单事项入口优先归入 `console.employee-portal`。

- 新路径以 `Console directory-runtime` 作为用户、部门、角色、项目注册表事实源；未迁移模块可继续通过 `Account` legacy facade 读取
- `Workflow` 仍然是审批实例与待办的唯一事实源
- `Align` 只在轻量协同超出 Console 边界后承接完整协同业务对象，例如跨部门协助单、人员借调、HR/轻财务流程对象
- `Align` 若引用项目、合同、文档，只保存业务键，不复制主档

### Aims 产品需求创建（实现中）

`POST /api/v1/products/{productCode}/requests` 要求当前产品范围内 `product_requests:create`、Idempotency-Key 和 expectedRevision。BFF 重建 RequestDraft，委托已验证用户 actor 调内部 `POST /v1/aims/internal/products/{productCode}/requests:create`，要求精确 `aims:product-requests:create` 及 aims.write 传输权限。服务资源 `product-requests` 与用户资源 `product_requests` 分离。初始状态固定 submitted；创建、产品根 revision、审计、回执同事务，归档空间拒绝。创建 SQL 事务已通过隔离 MySQL 验证；目标租户实际签发链尚待验收。


### Aims 产品需求读取（实现中）

- 用户 GET `/api/v1/products/{productCode}/requests` 与 `/requests/{requestId}` 要求当前产品范围内 `product_requests:view`；requestId 使用需求 biz_id（规范小写 UUID）。用户不能传入授权对象、actor 或跨产品范围。
- BFF 调内部 POST `/v1/aims/internal/products/{productCode}/requests:list`、`requests:view`，组合 scope 为 `aims.read aims:product-requests:read`，内部校验签名 actor 与精确 capability。POST 在此仅承载可信授权快照，无业务写入或回执。
- 列表 page 默认 1、pageSize 默认 20／最大 100，page 最大 1000000；支持 keyword（最多 200 字符、按字面包含匹配）、decisionStatus、sourceType、urgencyLevel。过滤先于计数分页，按 id 倒序稳定返回；空结果 items=[]。返回 workspace_revision 与 items／total／unmerged_total 在产品根锁保护下读取。total 为匹配记录总数（用于分页），unmerged_total 为相同筛选范围内 decision_status 不为 merged 的需求数；已合并来源保留为历史记录，不算独立需求。详情同时限定 product_code 与 biz_id，跨产品或不存在对象返回 404。
- 列表可选 `mergedInto`（目标规范 UUID），Runtime 对应 merged_into_biz_id；在同产品内解析目标后筛选直接合并到该目标的记录，复用分页与全部既有筛选。目标不存在或不在当前产品返回 404；它不代表所有递归祖先的扁平集合，不按来源条数加分。
- 需求详情附带非空时的 `merge_trail`（biz_id／title／decision_status）；按原始合并边追溯，逐跳限定当前 product_code，在同一根锁事务内最多返回 64 层。超过时 `merge_trail_truncated=true`，末项不得宣称最终目标；循环返回 product_request_merge_cycle，缺失／跨产品目标拒绝，不输出部分越权数据。列表不展开链路。
- 读取允许已归档空间，但仍须当前授权；短期 permit 在锁内复核。归档不会自动隐藏历史需求。枚举、分页、未知参数在 BFF／Runtime 边界分别校验。
- Console seed／verify 的当前授权数量以 [产品中心服务授权说明](../aims/docs/Aims-Product-Center-Service-Grants.md)及生成脚本为准。实际 SQL 在隔离 MySQL 通过；目标租户 grant／令牌签发和浏览器真实链路仍须环境验收。

### Aims 产品需求修改（实现中）

`PATCH /api/v1/products/{productCode}/requests/{requestId}` 以 requestId（biz_id）定位当前产品需求，要求 `product_requests:edit`、Idempotency-Key、expectedRevision、expectedRequestRevision 和 reason；标题、问题说明、来源、紧急程度均显式提交。BFF 不接受评审／actor／授权字段。内部 POST `requests:edit` 要求组合 scope `aims.write aims:product-requests:edit`，签名 actor 与短期 edit permit 在产品根锁内复核。领域事务保留评审决定、拒绝合并源记录修改，连同关联规划事项证据 revision、根 revision、审计和回执一起提交；冲突返回 409。服务 grant 当前清单见 [产品中心服务授权说明](../aims/docs/Aims-Product-Center-Service-Grants.md)，本地 SQL 已验证，目标租户实际签发待验收。

### Aims 产品需求评审（实现中）

`POST /api/v1/products/{productCode}/requests/{requestId}/decision` 要求当前产品范围内 `product_requests:decide`、Idempotency-Key、双 revision 与目标 status。输入仅包含 status／reason／impactNote，决定人及时间由受信运行链产生。内部 POST `requests:decide` 要求 `aims.write aims:product-requests:decide`，edit capability 不蕴含 decide。首次 submitted→evaluating 可不填理由，其余允许转换要求理由；accepted→evaluating/rejected 还要求影响说明。merged 不经本入口产生。状态与说明在产品根锁内校验，决策／关联证据 revision／审计／回执原子提交，不撤销已有项目执行或版本范围。当前生成器安装 26 条业务 grant，verify 含传输前提共 32 项；隔离 SQL 通过，目标租户签发与 UI 链路待验收。

需求池 UI 操作提示由 `GET /api/v1/products/{productCode}/requests/permissions` 提供，先要求当前产品 `product_requests:view`，再分别计算 create／edit／decide；返回产品状态／revision，Cache-Control 为 no-store。该提示不代替每次命令重新授权，也不把编辑权限转换成评审权限。

### Aims 需求来源证据读取（实现中）

`GET /api/v1/products/{productCode}/requests/{requestId}/sources` 要求 product_requests:view，requestId 为该产品内需求 biz_id；只接受 page／pageSize（默认 1／20，最大页码 1000000、每页 100）。内部只读 POST `request-sources:list` 复用组合 scope `aims.read aims:product-requests:read`，在产品根锁内重新核验授权事实并解析需求归属，跨产品或不存在需求返回 404。按证据 id 倒序分页，返回 total、request_revision、workspace_revision；日期未知为 null，空页 items=[]。人工证据的 fact／assumption 是类别，verification_status 独立返回，不能把人工 fact 显示成已核验外部引用。此读取不新增业务 grant、不写审计或回执。

### Aims 人工来源证据添加（实现中）

`POST /api/v1/products/{productCode}/requests/{requestId}/sources` 要求 product_requests:edit、双 revision、Idempotency-Key；允许 note／evidenceDate／kind／direction，未知日期省略或 null，kind 为 fact／assumption，direction 为 supporting／opposing／neutral。拒绝 sourceApp、sourceBizId、verificationStatus、actor 和授权对象。BFF 调内部 POST `request-sources:create`，组合 scope 为 `aims.write aims:product-requests:source-create`；领域固定 manual／unverified，与根／需求／关联证据 revision、审计和回执同事务。该 capability 在两个 Runtime audience 下精确安装，当前共 28 条业务 grant、34 项 verify 要求；隔离 SQL 通过，目标租户签发仍待验收。

### Aims 产品规划事项创建与列表（实现中）

- 用户 GET／POST `/api/v1/products/{productCode}/planning-items` 分别要求当前产品 `product_priorities:view`／`edit`；创建带 Idempotency-Key、expectedRevision、标题、本次范围、投资类别、紧急程度建议及有界来源 UUID／revision。
- 内部 POST `/v1/aims/internal/products/{code}/planning-items:list`／`planning-items:create` 分别要求 `aims.read aims:product-priorities:read`／`aims.write aims:product-priorities:create`，使用当前委托用户及短期授权凭据。签名身份、精确能力校验在数据库访问前完成，产品成员事实在根锁内重新核验。
- 列表支持 page/pageSize、keyword、lifecycle、investmentCategory，过滤先于分页／计数；未知截止日期为 NULL，空列表为 []。创建初始 proposed，关联需求与审计／根版本／回执原子提交；不自动产生评分、周期选择或版本承诺。
- 服务授权由产品中心生成脚本和统一说明维护，用户角色权限与内部 service capability 分离。当前实现不代表规划页面、周期决策或真实租户部署已验收。

- 规划事项详情 GET `/api/v1/products/{productCode}/planning-items/{itemId}`（规范 UUID、无额外查询参数）委托内部 POST `planning-items:view`，复用 `aims.read aims:product-priorities:read` 和 product_priorities:view。详情含事项及产品 revision、来源 UUID／当前 revision；来源超过 100 条拒绝而非静默截断。详情与来源在同一产品根锁内读取，其他产品的 itemId 返回 404。

- 规划 PATCH `/api/v1/products/{productCode}/planning-items/{itemId}` 委托内部 POST planning-items:edit，要求 `aims.write aims:product-priorities:edit` 与 product_priorities:edit。请求必须显式携带完整 requests 数组、紧急程度、事项／产品 revision 和原因；不能省略来源来隐式清空。写入使用差异关系更新，历史评估／决定保留；完全相同的事实不增加业务 revision。已选／交付中修改需影响说明；终态只读。已承诺版本变更及验收失效合同仍在实施，不能用此接口替代版本范围变更命令。

### Aims 规划周期内部读取（实现中）

内部 POST `/v1/aims/internal/products/{code}/planning-cycles:list` 与 `planning-cycles:view` 复用 `aims.read aims:product-priorities:read`。入口在访问数据库前验证签名委托用户、来源、租户／部署、客户端及精确服务能力；领域读取在产品根锁内要求当前产品 `product_priorities:view`，不能以项目权限代替。列表 input 为 page、page_size、keyword、status（draft/open/closed），每页上限 100，计数与过滤集合一致；详情 input 为规范 UUID biz_id，跨产品对象返回 404。返回周期／队列版本、模型快照、可空预算与指标值，workspace_revision 用于后续并发控制。两个端点仅查询，不写活动或回执，不新增业务 service grant；用户 BFF 与页面尚未接入。

- 周期用户读取 BFF：`GET /api/v1/products/{productCode}/planning-cycles` 与 `GET .../planning-cycles/{cycleId}` 已接内部 list／view。列表只接受 page/pageSize/keyword/status，默认 1／20；详情只接受路径 UUID，不接受额外查询字段。两入口均 no-store，要求当前产品 product_priorities:view，以 Foundation Runtime helper 传递当前用户及 15 秒授权事实；下游错误保留统一语义，Runtime 不可用返回 503，不回退本地数据库。

### Aims 周期草案创建（实现中）

`POST /api/v1/products/{productCode}/planning-cycles` 要求当前产品 product_priorities:edit、expectedRevision 与 Idempotency-Key。仅允许 title、startsOn、endsOn、goalSummary、reviewIntervalDays 和可选 budget；复评间隔省略默认 14 天，budget 为 null／省略表示未知，提供时五项人日完整且类别加预留不超总量。小数输入规范为两位十进制字符串传入 Runtime，不以浮点计算容量。拒绝 actor、status、模型和评分等未定义字段。内部 `planning-cycles:create` 使用 `aims.write aims:product-priorities:create`，领域命令身份为 product_priorities:cycle-create，创建草案与活动／回执同事务；该服务资源的 create 同时覆盖规划事项和周期草案创建，不包含开放周期或最终决策。现有两个 Runtime audience 的 grant 组合不变，目标租户授权仍须部署验收。

周期草案编辑：`PATCH /api/v1/products/{productCode}/planning-cycles/{cycleId}` 调内部 `planning-cycles:edit`，要求 product_priorities:edit 与 `aims.write aims:product-priorities:edit`，使用独立 cycle-edit 命令身份。除完整草案字段外，必须提供 expectedCycleRevision、reason、budgetMode；budgetMode 为 keep／set／clear，set 要求完整预算，其他模式拒绝同时设置数值，reviewIntervalDays 编辑时不得省略。产品与周期 revision 均在事务重查；非草案和版本冲突返回 409。edit 服务能力用于事项及周期草案编辑，不包含开放期容量决策或关闭周期。

周期成功指标：周期 POST／PATCH 可提交 metric，包含 name、unit、direction（increase/decrease/maintain）、measurementMethod、baselineValue、targetValue。后两键必须显式提供字符串或 null，数字类型拒绝，精度上限为 14 位整数／6 位小数；其余字段要求非空且有界。metric 省略或 null 时创建不设置指标，编辑保留已有指标；提交对象则替换完整定义及数值，明确的 null 代表未知，不代表零。写入仍限草案并沿用 edit 用户授权及同一命令回执，不新增跨应用能力。详情以 metric_definition、baseline_value、target_value 返回。

周期开放：`POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/open` 只接受 expectedRevision、expectedCycleRevision、reason，并要求 Idempotency-Key 和当前产品 product_priorities:prioritize。内部 `planning-cycles:open` 需独立 `aims.write aims:product-priorities:cycle-open`，读／创建／编辑服务能力不能替代；周期与产品版本、状态、预算、目标指标及唯一开放周期在事务中核验。Manifest 与生成器新增两个 Runtime audience 的精确 grant，当前共 40 条业务授权／46 个验证组合；目标租户启用仍须实际签发核验。

周期候选读取：内部 POST `/v1/aims/internal/products/{code}/planning-candidates:list` 要求 `aims.read aims:product-priorities:read`，input 为 cycle_biz_id、page、page_size、keyword、selection_status（candidate/selected/deferred）。在当前产品根锁及 product_priorities:view 授权内定位周期，再按同产品事项关联过滤、计数、分页；顺序为周期持久化 decision_rank，不以当前页覆盖队列。返回周期／队列／产品版本及事项事实、选择状态、评估引用；评估引用不表示评分当前有效。此读取不新增 grant；用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/items` 经产品 view 授权转发，周期来自路径，selectionStatus 独立于周期状态筛选。

周期候选添加：用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/items` 要求 product_priorities:edit，携带 Idempotency-Key、itemId、expectedRevision、expectedCycleRevision、expectedItemRevision。BFF 使用签名当前用户委托转发内部 POST `/v1/aims/internal/products/{code}/planning-candidates:add`，精确服务能力为现有 `aims:product-priorities:edit`（写传输 scope）；这是候选集合编辑，不授予 prioritize，不新增 grant。Runtime 在身份／服务能力检查后调用 candidate-add 事务命令，根锁内重新核验用户授权及三个版本；仅允许同产品、draft/open 周期及 proposed/in_delivery 事项。新增为 candidate/later，递增产品／周期／队列版本并原子记录审计与回执；重复关联保持已有选择和顺序，不重复增加业务版本。该动作不产生评分、选入决定或版本承诺。

产品评估追加：内部 POST `/v1/aims/internal/products/{code}/planning-assessments:create` 要求 `aims.write aims:product-priorities:assess` 与签名当前用户委托；用户动作独立为 product_priorities:assess，edit／create／cycle-open 不能替代。input 使用 PlanningAssessmentCreate：周期／事项标识及产品、周期、事项、范围、证据版本，固定模型 AssessmentInput、逐维度 rationale、带唯一 key 的人工 evidence、逐维度 evidence_references 和 estimate_confirmed。服务端计算分数并追加不可覆盖快照，更新当前评估引用、周期／产品版本、审计和回执同事务；不改变决定队列、选择结果及版本承诺。仅开放周期可评估；人工事实／假设不标记为外部验证事实。估算确认者当前绑定本次 actor，跨人研发确认流程与用户 BFF／页面仍待接入。Manifest 与 Console 生成器增加双 audience assess grant，当前共 42 条业务 grant、48 个核验组合（含 6 条已有传输权限）；目标环境仍须实际核验。

评估用户入口已接入 `POST /api/v1/products/{code}/planning-cycles/{cycleId}/items/{itemId}/assessments`：外层版本字段采用 expectedRevision／expectedCycleRevision／expectedItemRevision／expectedScopeRevision／expectedEvidenceRevision，另含 assessment、rationale、evidence、evidenceReferences、estimateConfirmed。assessment 和 evidence 内部字段沿用领域 snake_case；数值未知显式 null，置信度／投入以精确十进制字符串提交。用户 BFF 映射为领域输入并复核 assess 范围，不接收 actor、estimatedBy 或最终分数；当前尚未提供评估 UI。

评估历史读取已接入用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/items/{itemId}/assessments` 与内部 POST `/v1/aims/internal/products/{code}/planning-assessments:list`。使用 product_priorities:view、精确 product-priorities:read 和只读传输能力；内部 POST 只读例外按精确路径匹配，嵌套路由不可借用。用户查询仅接收 page/pageSize，周期与事项来自路径，Runtime 根锁内检查归属与关联。按历史 ID 倒序返回完整冻结快照、分页总数、is_current 与 stale；stale 仅表明范围／证据／模型版本不匹配，不等于完整交付决策有效性判定。不新增 grant，不在读路径重新评分。

周期候选读取新增 sort=decision/recommended（省略按原队列）及 investmentCategory=reliability/usability/growth；BFF 映射为 investment_category。推荐为只读视图：分类内先展示 proposed 且范围／证据／模型版本匹配、推荐分非空的事项，按精确 DECIMAL 分数倒序，同分以稳定 biz_id 定序；其他事项后置，分类间不以分数比较。筛选同时用于 count 和分页，不写 queue_revision 或决定快照；不代表按推荐生成草案／正式定序命令已实现。

周期调序已接入用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/move` 和内部 POST `/v1/aims/internal/products/{code}/planning-queue:move`。用户动作 product_priorities:prioritize，服务能力独立为 `aims:product-priorities:move` 加写传输 scope；edit、assess、cycle-open 均不可替代。用户输入 itemId、恰一个 beforeId/afterId、expectedRevision、expectedCycleRevision、expectedQueueRevision、reason 与幂等键；周期只取路径，不接受完整页面队列。领域根锁授权、开放周期、完整集合锚点移动、已选前置检查、审计和回执同事务，冲突 409。双 audience grant 新增 move 后共 44 条业务授权／50 个核验组合。此入口只调序，不替代后续 selection／capacity 决策接口。

调序预览已接入用户 POST `/api/v1/products/{code}/planning-cycles/{cycleId}/move-preview` 与内部 POST `/v1/aims/internal/products/{code}/planning-queue:preview`。两侧均为只读计算，使用 view、product-priorities:read 和精确只读 POST 路由，不要求或产生幂等回执。输入与 move 一致；预览返回周期总数、受影响事项选择状态及旧新位置、三个版本。预览不代表依赖／容量或版本承诺审核通过，正式 move 仍单独授权和校验。页面须按当前输入读取预览再确认，任何输入变化使旧预览失效。

价值／投入矩阵已接入用户 GET `/api/v1/products/{code}/planning-cycles/{cycleId}/matrix` 与内部 POST `/v1/aims/internal/products/{code}/planning-matrix:view`，复用 view／product-priorities:read 及精确只读 POST 例外。仅允许 keyword、selectionStatus、investmentCategory，周期来自路径；不接受 limit、page、pageSize、sort 或身份覆盖。返回 points／unplotted、total／returned／limit=200／truncated、周期阈值和版本；分组只基于当前有效完整评估，缺项与过期项不落坐标原点，不暗示全部数据已展示。不新增 grant，不产生业务写入。

### Aims 产品中心周期容量读取（2026-09-07 增量）

- 用户 `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/capacity` 不接受查询参数，以路径绑定周期；Foundation 校验 `product_priorities:view` 与产品范围，响应 `Cache-Control: no-store`。
- BFF 调自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-capacity:view`，使用精确 `aims:product-priorities:read` capability、签名委托当前用户及短时授权事实。内部 POST 仅精确单产品后缀进入只读例外，嵌套路径拒绝；没有新增服务授权。
- 输入为 `input.cycle_biz_id` 与 authorization。输出包含产品／周期／队列 revision、完整 budget（总量、预留、三类预算）、confirmed／latest 两组容量结果及逐项 changes（confirmed_category／latest_category 分别保留已决定与当前投资类别，即使投入相同也展示类别变化）。未知投入及不可计算差额保持 NULL，已确认投入来自决定快照；缺失快照失败关闭。读取完整产品依赖图，超过 10000 事项／100000 依赖明确拒绝，不能返回部分汇总。
- 当前为读取合同；不执行选择、预算变更或版本安排。未填写完整预算时返回明确领域错误，不把未知预算显示为零。

### Aims 产品中心选入预览（2026-09-07 增量）

- 用户 `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/selection-preview`，路径绑定产品／周期／事项；body 仅接受 expectedRevision、expectedCycleRevision、expectedItemRevision、expectedQueueRevision、expectedAssessmentId、reason 和显式 exceptions 数组（最多 100）。
- 例外字段为 code、按问题类型要求的 itemId／predecessorId／category、reason、responsibleUid、impact。只接受容量总额、类别容量、未知投入或未解除依赖问题；拒绝通用覆盖、评估豁免、重复问题及不对应问题类型的标识。责任人字段是决策说明，不授予身份或提交权限。
- BFF 使用 Foundation `product_priorities:view` 与产品范围、签名委托当前用户及精确 `aims:product-priorities:read` 调自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-selection:preview`。只读后缀严格匹配并拒绝嵌套；无新增服务授权，无幂等回执或业务写入。
- 返回 before／after 容量、产品／周期／队列版本和 can_confirm／blocker；can_confirm 仅表示提交的条件可满足领域检查，不表示查看者有 prioritize 权限。正式提交须再次校验事实及版本，不能信任客户端回传的预览结果。正式选入写接口见下节，预览本身不产生决定。

### Aims 产品中心正式选入（2026-09-07 增量）

- 用户 `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/select` 复用 selection-preview 的严格输入，并要求有效 `Idempotency-Key`、Foundation `product_priorities:prioritize` 与同产品范围。
- BFF 调 `POST /v1/aims/internal/products/{productCode}/planning-selection:select`，要求独立 `aims:product-priorities:select` service capability 和签名委托用户。read／edit／assess／move／cycle-open 不能代替 select；内部写命令不加入只读 POST 例外。
- 服务端重算预览相同领域条件，事务内写选择和评估引用／容量快照、产品／周期／队列 revision、审计及回执。幂等重放仍先检查最新授权。旧版本、已选重复选择、已变更决定及过期评估使用 409；容量／依赖问题按领域规则处理。
- Manifest 与 grant 生成器新增 select（data-runtime／tenant-runtime 两个 audience），共 46 条业务 grant，Verify 共 52 个组合；隔离数据库验证通过，不代表业务环境已安装授权。
- 当前接口尚未配套交互页面，期限确认、跨人研发估算、已选变更等完整决策要求仍在实施；不得将接口接通视为试点发布完成。

### Aims 产品中心前置依赖 API（2026-09-07 增量）

- `GET /api/v1/products/{productCode}/planning-items/{itemId}/dependencies` 拒绝查询参数，读取完整已有集合。返回 item_biz_id、产品／事项／范围版本、requires_impact_note 与 predecessors（biz_id/title/lifecycle/revision）。100 项以上明确拒绝，不返回部分集合。
- `PUT` 同路径要求 Idempotency-Key、expectedRevision、expectedItemRevision、predecessorIds 完整数组、reason 与可选 impactNote。空数组表示明确清空，缺失数组拒绝；重复、自依赖、非法标识／版本及客户端身份覆盖均拒绝。
- Aims BFF 通过 Foundation 校验产品范围内 product_priorities:view／edit，分别调用自身 Runtime `planning-dependencies:view`／`planning-dependencies:edit`，精确 service read／edit，绑定签名委托当前用户；没有新增 grant。view 的内部 POST 仅精确路径属于只读例外，edit 是写操作。
- Runtime 事务内执行完整产品图循环校验、状态／版本／影响说明验证，依赖增删、范围失效、审计及回执原子提交；已确认顺序、选择和版本快照不会被依赖维护自动重写。接口已接通，交互页和完整承诺变更流程继续实施。

### Aims 产品规划周期关闭

- BFF `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/close` 接受 expectedRevision、expectedCycleRevision、reason，复用严格周期流转解析，必须提供 Idempotency-Key。用户授权为 product_priorities:prioritize，复用 Foundation 产品对象范围和签名 actor 委托。
- 调用 Aims 自身 runtime `POST /v1/aims/internal/products/{productCode}/planning-cycles:close`，精确能力为 aims:product-priorities:cycle-close；cycle-open、edit、select 和宽写权限不蕴含关闭。双 runtime audience grants 由 manifest 对应生成器维护。
- 仅 active 产品的 open 周期可关闭；产品和周期版本冲突拒绝。关闭、产品/周期版本递增、审计及幂等回执在同一事务内；重放前重新授权。不改变队列版本、评估及选择快照，不自动结束共享事项或重开周期。读取保持原合同；本写端点不得加入 readonly POST 列表。

### Aims 周期结果观测 Runtime（BFF 待接）

- 内部 `POST /v1/aims/internal/products/{productCode}/planning-observations:list` 接收 input={cycle_biz_id,page,page_size}，需要 aims:product-priorities:read 和 product_priorities:view。列入只读内部 POST，真实分页并返回跨页更正关联。
- 内部 `POST /v1/aims/internal/products/{productCode}/planning-observations:create` 需要 aims:product-priorities:observe 与 product_priorities:observe，以及签名 actor 和幂等键。input 包含 biz_id、expected_revision、expected_cycle_revision、reason、value_mode、observed_value、observed_at、evidence_summary、evidence_source、conclusion、correction_of_id。value_mode 为 known/unknown，unknown 值为空；指标快照和记录 actor 由服务端生成。
- 更正来源限同周期，已有后续更正返回 409 planning_observation_already_corrected。产品/周期版本、状态、审计与幂等遵循领域命令；写端点不属于只读路由。双 runtime audience observe grants 由 manifest 和生成器维护，不借用 edit/assess/prioritize。

### Aims 观测 BFF 接入

- `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/observations` 接受 page/pageSize（默认 1/20，上限 100），拒绝其他过滤或身份参数，转发 observations:list。
- 同路径 POST 接受 expectedRevision、expectedCycleRevision、reason、valueMode、observedValue、observedAt、evidenceSummary、evidenceSource、conclusion、correctionOfId。observedValue 在 unknown 模式必须明确 null，correctionOfId 无更正时必须明确 null；其他字段、记录人和指标快照不得由浏览器覆盖。
- GET/POST 使用 Foundation view/observe 对象权限及签名 actor；POST 必须提供 Idempotency-Key，精确 observe service scope。均 no-store，调用自身 runtime，无本地数据库后备。

### Aims 单条结果观测读取

`GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/observations/{observationId}` 拒绝全部查询参数，周期为规范 UUID，观测 ID 为正安全整数。调用自身 Runtime `planning-observations:view`，input={cycle_biz_id,observation_id}，精确 read scope 及 view 对象授权。授权后绑定产品/周期/记录读取原文、指标快照、后续更正 ID 和当前版本；缺失或跨周期记录不得退回其他周期查找。内部 view POST 属只读，create 不属于只读。

### Aims 规划预算决定 Runtime

- 内部 POST planning-budget:preview 接收 PlanningBudgetChange（biz_id、expected_revision、expected_cycle_revision、expected_queue_revision、budget、reason、impact_note、exceptions），view/read 授权，纯读取前后预算及 confirmed/latest 容量影响；此预览不表示所有问题已处理或具提交权限。
- 同产品内部 POST planning-budget:change 需要 prioritize 和独立 aims:product-priorities:budget-change，必须幂等键。重新计算全周期容量，拒绝已有估算/类别变更未确认或未显式处理的问题；事务更新三版本与预算、追加审计及回执。不改变冻结事项投入。
- 仅 preview 属只读 POST；预算写使用独立双 runtime audience grant，不借用 edit 或其他决策能力。BFF 与页面待接入。

### Aims 预算决定 BFF

`POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/budget-preview` 与 `.../budget` 共享输入：expectedRevision、expectedCycleRevision、expectedQueueRevision、budget、reason、impactNote、exceptions。budget 要求总量/预留/三类完整精确金额，例外须明确数组；拒绝额外身份/容量快照。preview 为 view/read、无幂等键要求，budget 为 prioritize/独立 budget-change 且要求 Idempotency-Key。复用 Foundation 当前对象权限、actor 委托、no-store 与自身 Runtime 转发，无本地 DB 后备。

预算 preview 返回补充 can_confirm 与 blocker：基于完整当前数据和请求例外判断领域规则能否确认，不表示 view 用户具备 prioritize 权限。提交仍重新授权并重新计算。

### Aims 未开工事项撤回接口

- BFF `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/withdrawal-preview` 与 `.../withdraw` 接受 expectedRevision、expectedCycleRevision、expectedItemRevision、expectedQueueRevision、reason、impactNote、exceptions；路径绑定事项和周期，拒绝客户端消耗投入/状态等额外字段。
- Runtime 分别为 planning-withdrawal:preview（view/read，只读 POST）与 planning-withdrawal:withdraw（prioritize/独立 withdraw，幂等键必需）。共用完整周期投影，提交重新校验；未选中或需消耗确认返回 409。支持范围为 selected+proposed，已开工投入确认尚待后续命令。
- service withdraw 双 audience grant 已纳入 manifest 生成器，不蕴含于 edit/select/budget-change；复用 Foundation 对象范围/actor 与自身 Runtime，无本地 DB 后备。

### 产品周期撤回的投入确认引用（2026-09-08）

Aims 周期事项 withdrawal-preview/withdraw BFF 允许可选 `consumptionConfirmationId`（规范 UUID），映射 runtime `consumption_confirmation_id`。未开工撤回可省略；已开工撤回必须引用匹配当前事项版本、范围和原决定的服务端确认记录。不得提交已发生人日、确认人或任意确认快照来替代该引用。服务 capability 仍分别为 product-priorities:read / withdraw；实际已发生投入读取自领域命令保存的确认记录。确认命令的 Runtime/BFF 入口及 service grant 尚待接通，当前不宣称已开工撤回用户闭环可用。

### 产品已发生投入确认命令（2026-09-08）

Aims `POST /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/consumption` 映射自身 Runtime `POST /v1/aims/internal/products/{productCode}/planning-consumption:confirm`。请求绑定四版本和 expectedScopeRevision、明确字符串 spentPersonDays（0～1000000 人日、至多两位小数）与核验依据 reason。用户需 product_priorities:assess，服务需 aims:product-priorities:consumption-confirm；请求使用既有受信 actor 委托及幂等键。只有 active/open/selected/in_delivery 状态可确认。确认保留原容量，不执行撤回；返回 confirmation 及新的产品/周期/队列版本，后续撤回引用 confirmation_id。仅生成授权文件和隔离验证不代表目标租户已启用。

### 产品投入确认读取（2026-09-08）

Aims `GET /api/v1/products/{productCode}/planning-cycles/{cycleId}/items/{itemId}/consumption` 不接受查询参数，映射自身 Runtime `planning-consumption:view`，精确 capability `aims:product-priorities:read`，用户对象动作为 view。响应包含产品/周期/事项/范围/队列版本、状态、pending、retained、current 与 blocker；current 只证明待用确认与当前范围/原决定及状态匹配，不表示整个周期依赖和容量校验已通过。范围变更保留历史确认供查看但 current=false；闭期/归档后不得据此撤回。撤回后的 retained 继续展示已发生投入，读取不产生业务写入。

#### Aims 产品功能未排期事项读取

BFF `GET /api/v1/products/:productCode/features/:featureId/unscheduled` 仅接受 `page` / `pageSize`，调用自身 Runtime `POST /v1/aims/internal/products/:productCode/feature-unscheduled:view`，要求精确 `aims:product-priorities:read` 及签名用户 actor。Runtime 在产品根锁内重新校验 `product_priorities:view` 和 `product_features:view`，确认功能属于该产品；返回 PlanningPage（items、total、page、page_size、workspace_revision）。未排期严格指事项不存在任何周期关联，不是未进入当前所选周期。读取不写业务状态，响应 no-store；服务授权沿用已有 read grant。

#### Aims 产品规划转交项目需求

- `POST /api/v1/products/:productCode/planning-items/:itemId/handoffs` 与 `POST /api/v1/products/:productCode/requests/:requestId/handoffs` 共用命令，后者必填 planningItemId 且来源绑定路径 requestId。输入包含 cycleBizId、四类 expected revision、projectCode、sliceKey、operation(create/link)、scopeSummary、reason；create 填 title，link 填 requirementId，可选 requestBizId/expectedRequestRevision 及 plannedVersionId/plannedVersionFeatureId。拒绝额外客户端授权/actor 字段与 query；必须携带 Idempotency-Key。
- BFF 通过 Foundation 验证 product_priorities:handoff、有来源时 product_requests:handoff、目标项目 requirements:edit，可选版本意图还须 product_versions:view。项目事实由自身 Runtime `POST /v1/aims/internal/products/:productCode/handoff-project:authorization` 提供，精确 capability 为 `aims:product-priorities:project-authorization`；只返回当前受信 actor 的上下文，用于 Foundation 授权，不对浏览器单独开放事实接口。
- 写入调用自身 Runtime `POST /v1/aims/internal/products/:productCode/planning-handoff:create`，精确 capability `aims:product-priorities:handoff`、签名 actor。Runtime 在回执前复验产品及项目授权票据；事务内检查当前选入决定、来源关系、active product_dev、产品/限定版本绑定和需求归属。创建需求草稿/范围章节或关联已有需求，与来源快照、审计、版本推进、回执原子提交；不会将草稿自动基线或改写已有正文。
- 同切片业务意图不一致返回 409；同键重放仍执行当前授权。版本意图仅保存关联，不等于修改版本范围或写执行 target 的 version_id。所有读取/写入返回 `{code:0,data:...}`，响应 no-store。授权 seed 现有 88 条业务 grant、verify 94 条含传输前提；目标环境安装/签发探测仍须实际核验。

Aims 项目列表 `GET /api/v1/projects` 新增可选 `product_code` 产品绑定筛选。Runtime 使用参数化 EXISTS，绑定条件同时参与完整集合计数与分页；不替代已有项目可见范围检查，也不隐式授予需求编辑权限。产品转交项目选择器组合 category=product_dev、lifecycle_status=active、page/pageSize/search 使用该条件。

### 产品中心版本清单与创建（2026-09-08）

- `GET /api/v1/products/{productCode}/versions`：Foundation 产品范围 `product_versions:view`；接受 page/pageSize/keyword/status，返回完整 total 和有界列表，产品编码精确匹配。自身 Runtime `POST .../versions:list` 为只读，需 `aims:product-versions:read`。
- `POST /api/v1/products/{productCode}/versions`：`product_versions:edit`、Idempotency-Key，严格接受 expectedRevision/versionCode/name/description/plannedReleaseDate；自身 Runtime `POST .../versions:create` 需 `aims:product-versions:create`。复验短期授权、签名 actor、active 产品与根 revision；创建 planning 版本，不要求牵头项目。拒绝客户端指定状态、发布事实、项目归属。版本、根 revision、审计、回执原子提交。
- `GET .../versions/permissions` 先验证产品范围 view，再返回当前 edit 能力、产品状态和 revision。以上响应 no-store，成功统一 `{code:0,data:...}`。
- 版本范围、验收、发布与旧项目版本写入口切换尚未由上述接口覆盖；目标租户授权安装与实际签发探测待核验。

### 产品中心版本详情与基本信息编辑（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}` 映射自身 Runtime `versions:view`，产品范围 `product_versions:view`、精确 `aims:product-versions:read`；只接受规范正安全整数路径 ID，不接受查询参数，锁定产品与版本并精确核对产品编码。
- `PATCH` 同路径映射 `versions:edit`，需产品范围 `product_versions:edit`、精确 `aims:product-versions:edit`、签名 actor 和幂等键。接受 expectedRevision、expectedVersionRevision、versionCode、name、description、plannedReleaseDate、reason；路径绑定版本，拒绝客户端更改产品、状态、项目或发布事实。
- 产品 active 且版本 planning/developing 才可编辑基本信息；任一 revision 不匹配返回 409。更新版本 revision 与产品 revision，保留 scope_revision 与项目归属；原因、前后快照、回执与修改同事务。已发布/归档内容不得由基本信息编辑覆盖。
- 当前详情为基本信息读取，正式发布快照视图与范围/验收/发布动作仍待补齐。

### 产品中心规划事项排入版本（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}/features`：产品范围 product_versions:view；自身 Runtime `versions:scope-list` 使用精确 aims:product-versions:read，属于只读 POST。接受 page/pageSize/keyword，完整 count 与真实分页；返回版本/范围/产品 revision、规划事项与长期功能业务 ID，旧未关联事项行标记 legacy_unscored。跨产品关系不暴露其业务 ID。
- `POST` 同路径：产品范围 product_versions:edit 与 product_priorities:prioritize 同时满足；自身 Runtime `versions:scope-create` 需精确 aims:product-versions:scope-create、签名 actor 与幂等键。严格接收规划事项/周期业务 ID、产品/事项/周期/队列/版本 revision、范围标题/说明/验收标准/changeType/原因。
- 与项目转交共用 ValidatePlanningDeliveryTx，重验当前开放周期 selected 决定及范围、证据、投入等依据。目标版本须同产品且 planning/developing，长期功能从当前事项关系读取；客户端不能另指定功能或已交付状态。事项最多安排一个版本范围，同版本同长期功能重复冲突。
- 新范围为 planned、默认未对外公开；保存范围与验收标准，版本 revision/scope_revision、事项 revision、产品 revision、决定依据审计及回执原子提交。scope_revision 推进使旧验收不再对应当前范围；不自动改变事项生命周期或写项目执行事实。
- 本批仅创建/读取范围；修改、合并、移出/顺延、验收/发布、紧急例外独立路径与旧入口切换仍待接通。

产品版本 permissions 读取在 view 范围校验后返回 scope_create（version edit 与 planning prioritize 的交集）；该布尔值只供 UI 使用，范围 POST 仍独立复验两项权限。规划事项页面的排入版本流程使用现有 GET versions 分页选择目标，再按所见 revision 提交 scope-create，成功跳转范围清单；不会凭 UI 权限或选择器代替 Runtime 决策检查。

### 产品中心版本范围修改（2026-09-08）

`PATCH /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}` 复用严格 scope 输入与五项 revision，scopeId 只从规范正安全整数路径绑定。产品版本 edit 与规划 prioritize 双权限、签名 actor、幂等键，Runtime `versions:scope-edit` 需精确 aims:product-versions:scope-edit。当前周期 selected 决定仍须有效；同产品/版本/规划事项/范围必须完整对应，当前事项长期功能不能与已排范围的功能绑定漂移。只允许 planning/developing 版本中的 planned 范围修改标题、说明、验收标准和变更类型；delivered/deferred、已发布/归档及 legacy 无事项绑定的范围不通过此新接口修改。

修改递增版本 revision/scope_revision、事项 revision、产品 revision，保存修改前内容、修改后输入、决定依据及原因；与审计、回执同事务。修改不重新绑定规划事项/长期功能，不更改状态或项目工作项。既有验收因 scope revision 不再匹配而失效；验收/发布命令仍须单独完成该门禁。

### 产品中心范围交付确认（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/deliver` 需独立产品范围 product_versions:accept，edit 不蕴含 accept；自身 Runtime `versions:scope-deliver` 需精确 aims:product-versions:scope-deliver、签名 actor 与幂等键。严格接收 expectedRevision/expectedVersionRevision/expectedScopeRevision/evidence/reason，版本/范围身份只从路径绑定。产品 active、版本 planning/developing、范围 planned 且已有非空验收标准才可确认；当前产品/版本/范围 revision 必须一致。

确认将范围状态改为 delivered，推进版本 revision/scope_revision 与产品 revision，并在不可变活动日志保存范围原文、验收标准、证据、原因、受信 actor 和时间；与回执原子提交。该动作不要求重新建立历史 selected 决定，允许有明确验收标准的 legacy 未评分范围执行当前验收，但不补造历史评估。它不生成版本整体验收/发布记录、不改项目任务状态或长期功能生命周期。旧无验收标准范围须先通过后续兼容治理补齐标准。

版本 permissions 返回独立 accept 标志供 UI 控制；服务端确认接口仍自行校验。验收依据为用户显式记录的核验结果，不能据此宣称已自动检查项目缺陷或全部执行项。

### 产品中心版本验收预览与提交（2026-09-08）

- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptance-preview` 不接受查询参数，产品范围 product_versions:view，自身 Runtime `versions:acceptance-preview` 需精确 aims:product-versions:read，属于只读 POST。返回当前版本、范围状态计数、执行快照、产品 revision 与 review_hash；执行快照明确缺陷覆盖仅为已关联后代，仍需人工核验。
- `POST .../acceptances` 不接受查询参数，产品范围 product_versions:accept、自身 Runtime `versions:accept` 精确 aims:product-versions:accept、签名 actor、Idempotency-Key。严格接受 expectedRevision/expectedVersionRevision/expectedScopeRevision/expectedReviewHash/checks/exceptions；路径绑定 versionId，禁止提交验收人/状态/发布事实。
- checks 必须各一次 execution-review、blocking-defects-review、release-readiness 并附 evidence；exceptions 必须显式数组，每项唯一 code、reason、responsibleUid、impact。Runtime 逐项核对未完成目标与未关闭关联缺陷的自动例外编号，当前事实已不存在的编号拒绝。
- review_hash 是服务端对所见版本、完整范围和执行事实的 SHA-256 内容摘要。正式验收在事务中重读并比对，任何影响该摘要的变化均返回 409 product_version_review_changed，不能仅依赖 legacy 写入可能未推进的 revision。该摘要不是授权凭证，权限仍独立校验。
- 验收写入不可变记录与审计/回执，并推进版本及产品 revision；不直接发布。验收页面、记录查询与发布门禁仍待继续接通。

#### 产品版本验收历史查询（PC-10）

- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptances?page=1&pageSize=20` 返回真实分页元数据（id/version_id/scope_revision/accepted_by/accepted_at），total、page、pageSize 和 current_scope_revision；只接受 page/pageSize，页大小 1～100。
- `GET /api/v1/products/{productCode}/versions/{versionId}/acceptances/{acceptanceId}` 返回同一版本内的验收记录元数据及保存的 checks、exceptions。不会返回完整存储的执行项目快照。
- 两者经 Foundation product_versions:view，分别调用自身 Runtime 只读 POST `versions:acceptance-list` / `versions:acceptance-view`，使用 `aims.read aims:product-versions:read`，15 秒受信 actor 范围许可、no-store；无新增 service grant。Runtime 锁定并验证产品与版本归属，详情按版本和记录 ID 双重约束。历史查询不修改状态；范围修订号相同也不替代发布前的执行事实核验。

#### 首次正式发布命令（PC-10）

`POST /api/v1/products/{productCode}/versions/{versionId}/publish` 只接受 acceptanceId、expectedRevision、expectedVersionRevision、expectedScopeRevision、reason，必须带 Idempotency-Key；不接受查询参数、客户端发布人／时间／证据等级／状态覆盖。Foundation 要求产品范围 product_versions:publish，BFF 以可信 actor 和 15 秒许可调用自身 Runtime `versions:publish`，精确服务 scope `aims.write aims:product-versions:publish`。Manifest 和双 audience Console seed/verify 已加入该业务 capability（当前 90 条业务 grant／96 条含传输条件）。

Runtime 执行发布命令：不同验收／发布主体、当前产品／版本／范围修订、保存后范围及执行事实一致、不可变记录与状态／审计／回执同事务；过期验收或自发布返回 409，同键同 payload 重放原回执。首次发布返回 release_record_id/release_biz_id/content_hash/version_id/product_code/status/revision/workspace_revision。现有历史版本的重开／更正另行实现。发布不执行部署或跨应用业务写入。

版本权限读取已增加 publish 布尔值。API 接通不代表旧项目／管理员入口及工作项关联写入已切换到同一发布锁协议；上线前仍须完成该切换、真实租户 grant/token 探测和端到端验收。

#### 发布快照读取（PC-10）

`GET /api/v1/products/{productCode}/versions/{versionId}/releases/{recordId}` 不接受查询参数；Foundation product_versions:view，经自身 Runtime 只读 POST `versions:release-view`，精确 scope `aims.read aims:product-versions:read`，no-store 与 15 秒 actor 范围许可。无新增 grant。产品、版本、记录逐级校验归属。

返回发布元数据、current/withdrawn/superseded、snapshot_available、冻结的版本基本信息与完整范围、验收人／时间／依据及例外；不投影完整执行项目快照。verified 记录先从保存的两份 JSON 复算规范化内容 hash，再投影；内容校验失败拒绝读取，不能以当前业务表替代。legacy_import 返回其证据等级和元数据、snapshot_available=false，不伪装为新流程已核验记录。current 仅说明当前有效发布引用，不代表已部署。

版本权限 GET 额外返回受信 `actor_uid`，仅用于发布 UI 比较验收人并提示职责分离；发布请求不能提交 actor，Runtime 仍以签名委托身份独立校验。

发布领域命令已扩展更正语义：完成专用重开及新的验收后，重新调用既有 publish API 可生成递增 release_seq、新 supersedes_record_id 和旧记录 superseded 事件。没有覆盖旧发布 JSON；未撤回或已经更正的原记录拒绝作为来源。重开领域命令当前尚未提供在线 API，仍待单独接通。

重开接口已接入：`POST /api/v1/products/{productCode}/versions/{versionId}/reopen`，body 严格限定 releaseRecordId、expectedRevision、expectedVersionRevision、reason，需 Idempotency-Key，无 query。Foundation product_versions:reopen，经签名 actor、15 秒许可调用自身 Runtime versions:reopen；精确 scope aims.write aims:product-versions:reopen。当前 grant 基线为 92 条业务／98 条含传输条件，目标租户仍待实际安装与令牌探测。

版本权限 GET 已返回独立 `reopen` 布尔值；不由 edit/publish 布尔值推导。

发布历史：`GET /api/v1/products/{productCode}/versions/{versionId}/releases?page=1&pageSize=20` 仅接受这两个分页参数，pageSize 1～100，经 Foundation product_versions:view 与自身只读 Runtime `versions:release-list`，scope aims.read aims:product-versions:read。按 release_seq/id 降序真实分页，返回元数据、supersedes_record_id、current/withdrawn/superseded 和总数；不随当前引用清除而删除或隐藏旧记录，无新增 grant。

#### 旧版本状态接口退役（产品中心迁移）

`POST /api/v1/admin/product-versions/{id}/transition` 与 `POST /api/v1/projects/{projectId}/releases/{id}/transition` 对应 Runtime 路径现返回 410 legacy_product_version_transition_retired，不读取或写入数据库。管理员及项目版本页面的旧状态按钮已替换成产品中心版本详情链接；发布／重开使用已接入的独立命令。管理员旧创建接口只接受 planning，拒绝直接创建 developing/released/archived。

这一步只关闭旧状态写入与创建状态旁路。旧版普通版本编辑、特性 CRUD、项目分配与工作项关联仍待统一；产品中心普通 planning→developing、归档等专用动作仍待补齐，不能据此宣称全部旧入口切换或生产验收完成。

### 产品中心版本归档命令（2026-09-08）

Aims BFF `POST /api/v1/products/{productCode}/versions/{versionId}/archive` 调用自身 Runtime `POST /v1/aims/internal/products/{productCode}/versions:archive`，要求 `aims.write` 与精确 `aims:product-versions:archive`，用户侧要求 Foundation 产品范围 `product_versions:archive`。请求为 expectedRevision、expectedVersionRevision、expectedScopeRevision、reason；ID 取路径，actor 取受信会话，Idempotency-Key 必填。仅已发布版本可归档，状态、修订、审计、回执同事务；原发布记录不撤回、不删除，客户环境不变。双 audience 授权 seed／verify 已生成，未在目标租户安装或完成实际令牌探测。

### 产品版本验收／发布执行明细预检（2026-09-08）

Aims BFF 在 accept/publish 前，以产品 view 许可读取 acceptance-preview，并使用 Foundation 项目对象授权同时检查 projects:view、work_items:view。缺任一关联执行项目权限返回 403，不调用 mutation；授权依赖异常向上传播。Runtime accept/publish envelope 必须有 BFF 生成的 execution_review_hash（非浏览器输入），在新命令事务中与锁定后的执行核验快照比较，不一致 409。该值不纳入业务输入幂等 hash，已有成功回执仍在当前产品授权检查后重放。用户版本 accept/publish 权限及负责人／不可自发布规则继续独立执行。

#### 产品版本执行预检的项目授权事实完整性（2026-09-08）

Aims BFF 的版本验收预览及 accept/publish 预检，从自身 runtime 的 `GET /v1/aims/projects/{id}/authorization-object` 读取项目事实，启用严格模式。必须返回与请求一致的数值 ID、规范项目编码 `project_code`、创建人字段、可空部门/负责人字段及成员数组；缺失或畸形响应以 503 中止，不以项目详情、路由 ID 或空对象补造权限上下文。有效空成员数组不是故障。Foundation 仍是项目与工作项数据范围判断的唯一策略执行者；本次未新增 capability、未改变已有 grant 集合。

#### 版本业务负责人的提交时有效性（2026-09-08）

产品版本 accept 和 publish 在新命令事务内复用版本负责人校验：负责人须在该产品存在 status=active、valid_from 不晚于数据库 UTC 当前时间、valid_until 为空或晚于当前时间的产品成员关系。accept 仍要求操作者为版本负责人；publish 仍要求验收人为当前负责人且与发布人不同。成员关系失效返回既有 `product_version_owner_unavailable`（409），不产生验收、发布、审计或成功 receipt。已成功命令沿用 ExecuteCommand 的重放合同；本次不改变 Console Directory 身份校验，也不把本地成员有效性等同于 Directory 在职状态。

#### 产品规划评论 Runtime 契约（2026-09-08）

Aims 自身 Runtime 新增 POST `/v1/aims/internal/products/{productCode}/planning-comments:{list|create|edit|delete}`。list 要求 `aims:product-priorities:read`，写操作要求 `aims:product-priorities:comment`，均在数据库访问前校验精确 capability。产品动作分别为 view/comment；author_uid 来自受信 current_user，写入复用标准 input/authorization/idempotency_key envelope。列表 POST 归 aims.read 传输；写 POST 不加入只读白名单。本人关系失败 403、评论不存在 404、版本冲突/已删除/闭期冻结 409。

Manifest 与生成器已登记 comment，Seed 共 96 条业务 grant，Verify 共 102 个组合（含 6 条已有传输权限）。这些是仓库授权产物；尚未安装目标租户、未做实际 JWT 签发与 BFF 全链路验证。

#### 产品规划评论浏览器 API（2026-09-08）

Aims BFF 提供 `GET/POST /api/v1/products/{productCode}/planning-items/{itemId}/comments` 及 `PATCH/DELETE .../comments/{commentId}`。GET 仅接受 page/pageSize；新增正文及 expectedRevision，修改还需 expectedCommentRevision，删除不接受正文。写操作必须提供 Idempotency-Key 且禁止 query；正文最多 10000 字、拒绝空白/无效 Unicode/NUL。作者来自 requireProductPermission 返回的 actor_uid，不接受客户端作者、授权或对象覆盖字段。列表/写操作分别获得 product_priorities:view/comment 后调用既有 Runtime 契约；上游未接管返回 503，其他错误沿用统一映射，响应 no-store。

#### 评论跨周期冻结规则修正（2026-09-08）

评论写入依赖 v5.20 cycle_id 增量。新增评论由 Runtime 在产品根锁内解析事项当前 open 周期，不允许浏览器指定归属；无开放周期时保持未分配。编辑/删除读取评论自身周期：closed 保持冻结，不因事项进入新周期而解冻。未分配历史评论遇到闭期关联继续冻结，不推断历史。列表 readonly 表示新增限制，每条评论另有 readonly/readonly_reason/cycle_id；新旧讨论可同时显示而具有不同修改资格。此前“任一闭期永久冻结全部讨论”的规则由此替代。

#### 评论历史查询（2026-09-08）

GET `/api/v1/products/{productCode}/planning-items/{itemId}/comments/{commentId}/history` 仅接受 page/pageSize，BFF 校验路径标识并要求 product_priorities:view，调用 POST Runtime `planning-comments:history`，传输使用 aims.read、精确 capability 使用 aims:product-priorities:read。Runtime 同产品定位事项及评论后返回分页审计记录，包含编辑前正文和删除历史；普通评论列表仍隐藏删除正文。历史查询为显式查看原文的独立入口，没有新增授权动作或 grant。

#### 周期复评记录 API（2026-09-08）

POST `/api/v1/products/{productCode}/planning-cycles/{cycleId}/review` 接受 expectedRevision/expectedCycleRevision/reason，必须带 Idempotency-Key，不接受 query。BFF 从产品 prioritize 权限绑定 actor 和短期授权，调用 Runtime POST `planning-cycles:review`；精确 capability 为 aims:product-priorities:cycle-review，传输为 aims.write。复评记录不清除 stale、不替代评分或排序决定。Manifest/Seed/Verify 已同步到 98 条业务 grant、104 个核验组合；目标环境尚未安装或探测实际 JWT。

#### 周期复评历史 API（2026-09-08）

GET `/api/v1/products/{productCode}/planning-cycles/{cycleId}/reviews` 仅接收有界 page/pageSize，要求 product_priorities:view；BFF 调 Runtime POST `planning-reviews:list`，使用 aims.read 与 aims:product-priorities:read。历史归属在领域层校验，响应包含结论、操作者、时间及前后周期快照。无新增 grant，周期关闭不删除复评历史。

### Aims 产品中心版本删除（2026-09-08）

浏览器使用 `DELETE /api/v1/products/{productCode}/versions/{versionId}`，提交 `expectedRevision`、`expectedVersionRevision`、`expectedScopeRevision`、`reason` 和 `Idempotency-Key`。BFF 通过 Foundation 要求 `product_versions:delete`，以受信 actor 调用本应用 Runtime `POST /v1/aims/internal/products/{productCode}/versions:delete`，要求精确 capability `aims:product-versions:delete`。领域命令仅删除 active 产品下无范围、执行工作项、项目绑定、验收和发布引用的 planning 版本；版本校验、删除、根 revision、审计及 receipt 同事务。

旧 admin/project 版本删除 Runtime 入口返回 `410 legacy_product_version_delete_retired`，调用方应跳转产品中心取得当前版本和产品权限后操作。此变更不代表其他旧版本写入口已全部迁移；目标 Console grant 与实际 JWT 签发仍须按部署验收核验。

项目页的旧版本创建 Runtime 命令 `createProductVersion` 返回 `410 legacy_product_version_create_retired`。项目页面先选择已关联产品，再导航到 `/products/{productCode}/versions` 使用产品中心创建流程；不再通过项目管理员身份直接创建版本或隐式设置 owner_project_id。产品中心新建仍要求产品范围 edit 许可及原有幂等、revision 规则。管理端旧创建/编辑及项目关联等其他写命令的统一另行跟踪，不因本条标记为完成。

管理端旧版本创建和编辑分别返回 `410 legacy_product_version_create_retired`、`410 legacy_product_version_edit_retired`。管理页面创建入口导航产品中心版本列表，编辑入口导航对应版本详情，统一使用产品中心版本号规则、产品授权、revision 与幂等命令；原管理表单的自由 owner_project_id 写入被移除。项目编辑和范围等尚存旧命令不在本次迁移范围内，仍须继续收敛。

项目旧版本编辑（`PUT/PATCH /v1/aims/projects/{projectId}/releases/{versionId}`）同样返回 `410 legacy_product_version_edit_retired`。项目详情现有“在产品中心管理版本”入口指向产品中心版本详情。管理端和项目端旧创建、编辑、删除的八个 method/path 组合均通过实际路由分发测试，在访问数据库前返回对应迁移错误。无调用方的临时 legacy 基本信息编辑事务 helper 已移除；范围、项目绑定和工作项挂接仍须分别迁移，不能把基本信息入口收敛当作全部版本领域迁移完成。

项目页旧 `POST /v1/aims/projects/{projectId}/releases/{versionId}/features` 返回 `410 legacy_product_version_scope_create_retired`。项目“添加特性”入口转向 `/products/{productCode}/versions/{versionId}/features`，使用产品中心规划事项选择和范围创建命令；旧页面标题直填新增表单及 POST 已移除。该项只覆盖项目新增范围，管理端新增与两端旧范围编辑/删除仍需独立迁移。

管理端旧 `POST /v1/aims/admin/product-versions/{versionId}/features` 也返回 `410 legacy_product_version_scope_create_retired`，管理页面新增范围跳转产品中心版本范围页，旧表单仅保留尚待迁移的编辑流程，不再存在直接新增分支。两端新增路由由同一退役矩阵测试验证；旧范围编辑/删除仍需领域命令迁移。

### Aims 撤回版本范围交付确认（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/reopen` 接收 expectedRevision/expectedVersionRevision/expectedScopeRevision/reason，要求 Idempotency-Key 和 Foundation product_versions:accept。BFF 使用受信 actor 调用本应用 Runtime `versions:scope-reopen`，精确 service capability 为 `aims:product-versions:scope-reopen`。仅未发布且无当前发布记录的 planning/developing 版本可将 delivered 范围退回 planned；保留原交付审计，新撤回审计、根/版本/范围 revision 和 receipt 同事务。API 已接入，页面及目标授权尚未验收。

范围交付/撤回历史通过 `GET /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/history` 分页读取，仅接受 page/pageSize。BFF 要求 product_versions:view，以 `aims.read aims:product-versions:read` 调用 `versions:scope-history`；Runtime 将该 POST 明确归入只读传输，查询验证产品、版本及范围归属。返回受限审计字段，不返回完整 changes 内容。页面历史组件仍待接入。

### Aims 历史范围验收标准补录（2026-09-08）

`POST /api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/legacy-criteria` 接收 acceptanceCriteria、reason 和三个 expected revision，要求 Idempotency-Key。Foundation 要求 product_versions:edit；Runtime `versions:scope-legacy-criteria` 要求精确 capability `aims:product-versions:scope-legacy-criteria`。仅已有 planned、无 planning_item_id 的历史范围可补录标准，不能通过请求注入历史标记、规划决定或状态；命令不创建新范围。页面及目标授权部署仍待验收。

Enterprise Host 版本范围读取：`GET /aims/api/v1/products/{productCode}/versions/{versionId}/features` 与 `GET /aims/api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/history` 分别经 Foundation 操作 `aims.version-scope-list|history` 到 Runtime `POST /v1/enterprise/aims/product-version:scope-list|scope-history`。Host 在签发 `aims:product-versions:read` 服务许可前，用受信会话、当前产品对象事实和 `product_versions:view` 完成人员门槛；分页参数严格白名单，版本与范围 ID 取路径。Runtime 再校验签名 actor、短期许可与产品/版本/范围归属，沿用既有产品中心领域读取及 no-store 响应。

Enterprise Host 范围交付与撤回：`POST /aims/api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}/{deliver|reopen}` 经原 Aims 严格入参及 `product_versions:accept` 人员校验后，以 Foundation `aims.version-scope-deliver|reopen` 和独立 `aims:product-versions:scope-deliver|scope-reopen` 服务能力到 Runtime 同名精确路由。Runtime 用签名 actor 再验产品/版本/范围与短期 permit，复用原领域命令的 revision、release lock、审计、回执、反馈 outbox，并置于统一 registry 的写事务。Host 仅在人员权限、版本状态及范围状态均允许时显示动作；409 后刷新，不自动换键重提。

Enterprise Host 范围维护：`PATCH /aims/api/v1/products/{productCode}/versions/{versionId}/features/{scopeId}`、`POST .../{scopeId}/visibility`、`POST .../{scopeId}/legacy-criteria` 分别经 Foundation 操作 `aims.version-scope-edit|visibility|legacy-criteria` 与 Runtime 精确能力 `aims:product-versions:scope-edit|scope-visibility|scope-legacy-criteria`。三者先验证当前用户的 `product_versions:edit` 与产品对象范围；编辑还需独立的 `product_priorities:prioritize`，两个短期 permit 绑定同一签名 actor、租户与部署，其他动作拒绝非空 planning permit。Host 复用 Aims 的字段白名单与幂等键校验，规划事项详情和开放周期仍走已有只读 Host 路由。Runtime 在统一 registry 写事务里调用原领域命令，保留决定修订、release lock、审计、回执与 visibility 反馈 outbox；旧修订 409，服务 grant 缺失 403。版本范围创建仍未迁入 Host。

2026-09-25 验收状态：隔离 MySQL 的 `test-enterprise-version-release-http-mysql.mjs` 已覆盖交付、同键回放、撤回、旧修订 409、缺人员 `accept` 403、错误范围 404 和撤销服务 grant 403；Host bridge 合同测试已通过。本地 C000001 的双 audience grant 签发和页面读取已通过。应用角色 `aims:product_manager` 通过企业角色 `product_manager` 间接映射；旧范围值 `product:manager` 被误解析为 `product:equals:manager`，修复 Foundation/Platform 解析器后仅 active 产品经理成员匹配。Host 正式页面以 `zhouguangying` 对版本 5／范围 1 完成交付并撤回，最终恢复计划中；同键回放与旧版本 409 仍以隔离 MySQL 验证。Platform Policy Bundle v2 直接保留原始范围字段，此次没有重新发布策略包、调整角色或部署开发 Platform。

### 产品模块 Runtime 接口（2026-09-08）

Aims 自身 Runtime 新增 components:list/create/move，精确 capability 分别为 aims:product-components:read/create/move；产品范围权限为 product_components:view/edit。全部复用 Foundation 授权事实及既有 Runtime 服务认证/actor 委托边界。写入要求 idempotency_key；模块与根修订、审计、回执事务提交，三层树约束由领域命令执行。两个 runtime audience 的授权 seed/verify 已同步；目标安装及 BFF/UI 接入尚未完成。详见 [模块 API](../aims/docs/Aims-Product-Components-API.md)。

### 功能模块归类写入（2026-09-08）

Aims 自身 Runtime features:component-assign 要求 aims:product-features:component-assign 和统一 product_features:edit 产品范围授权，BFF 从已验证会话获取 actor，写入要求幂等键及产品/功能修订。Console 两个 Runtime audience 授权已加入生成清单；无需跨应用数据直写。详情见 [模块 API](../aims/docs/Aims-Product-Components-API.md)。目标授权安装及真实 JWT 探测未完成。

模块编辑补充（2026-09-08）：Aims 自身 components:edit 要求 aims:product-components:edit，业务权限 product_components:edit；双修订/原因与幂等原子写入，不接收层级变化。Manifest 和两个 Runtime audience 的 Console seed/verify 已同步，目标租户安装仍未执行。

模块删除补充（2026-09-08）：Aims 自身 Runtime components:delete 使用独立 aims:product-components:delete 服务 capability 与 product_components:delete 用户权限，双修订/原因/幂等事务执行，引用阻止返回 409。Manifest 与两个 Runtime audience seed/verify 已同步，未在目标环境安装。

### Aims 产品目标 Runtime（2026-09-08，BFF 待接入）

Aims 自身 Runtime 新增 `POST /v1/aims/internal/products/{code}/objectives:create|list|view`，创建要求 `aims:product-objectives:create`，读取要求 `aims:product-objectives:read`；业务对象使用 `product_objectives:edit/view` 的 Foundation permit，可信 actor 与产品修订校验复用产品命令边界。跨产品目标 ID 不可读取，创建审计/回执事务化。两 Runtime audience 的授权 seed/verify 已生成，尚未安装目标环境。字段与实现边界见 [目标 API](../aims/docs/Aims-Product-Objectives-API.md)。

产品目标浏览器 BFF 已接入列表/详情/创建，路径为 `/api/v1/products/{code}/objectives` 及其目标 ID 详情；通过 Foundation 产品权限和 Aims 自身 Runtime 实现，输入及能力合同见目标 API。未新增跨应用数据库访问。

产品目标 Runtime 新增 objectives:observe/activate/close/reopen/archive，均要求同名精确服务 capability 及独立对象动作权限。状态动作须与路由一致；观测使用服务端指标快照，不接受客户端达成率。双 audience 授权生成已同步（总130业务 grant/136核验项），隔离验证通过，目标环境尚未安装。

目标状态及观测 BFF 已接通 `/api/v1/products/{code}/objectives/{id}/{observe|activate|close|reopen|archive}` POST，双修订/幂等和独立动作授权沿用目标 Runtime 合同；状态动作由路由注入，客户端不提供指标快照或达成率。

目标观测历史 Runtime `objectives:observations` 使用既有目标read capability及view permit，按指定产品/目标真实分页；每条达成率由该观测不可变快照计算。读取采用只读传输路径，不新增业务grant。

目标观测历史 BFF `GET /api/v1/products/{code}/objectives/{id}/observations` 已接入既有目标read Runtime；查询仅允许page/pageSize，不能通过query覆写目标ID，响应no-store。

目标观测更正沿用observe BFF/Runtime权限及capability，浏览器配对字段correctionOfId/correctionReason映射原记录ID/原因；当前双修订仍校验，原指标快照由Runtime读取，原日期保持。历史接口返回更正前后关联。实际Adapter+MySQL链路已验证，非真实JWT环境验收。

### Aims 产品目标周期映射（2026-09-08）

Data Runtime内部POST `/v1/aims/internal/products/{code}/objectives:cycle-map`、`:cycle-revoke`分别使用精确`aims:product-objectives:cycle-map`、`:cycle-revoke`，业务Foundation permit为`product_objectives/edit`。`:cycles`分页历史为`product_objectives/view`及`aims:product-objectives:read`，按只读传输处理。以上共享可信操作者及产品数据范围，映射校验目标/周期同产品和三方修订，撤销检查映射归属及目标/产品双修订。双方快照由Runtime数据库读取生成，BFF禁止客户端提供，映射与撤销均有幂等回执和原子审计。v5.24保存快照及撤销历史，禁止历史删除/改写，不重算任何周期评分或观测结果。

### Aims 产品路线探索窗口（2026-09-08）

浏览器 BFF `GET/PATCH /api/v1/products/{code}/roadmaps/windows/{itemBizId}` 对应 Runtime `roadmaps:window-view/window-edit`，分别要求 `aims:product-roadmaps:read/window-edit` 精确服务能力及 `product_roadmaps/view/edit` Foundation permit。GET permissions 返回一致产品事实下独立计算的 edit/commit 能力，写入仍重新授权。事项必须属于路由产品；编辑检查当前产品及事项双修订、原因及幂等键，仅 active 产品的 proposed/in_delivery 事项可修改。日期必须为合法且顺序正确的一对日期，或明确双 null 清空。v5.25 保存探索窗口，命令将日期、双修订、审计及回执原子提交，不改变优先级、范围、证据或版本承诺。季度展示和正式承诺基线已接入，合同见下；当前授权脚本尚未安装目标环境。详见 [路线 API](../aims/docs/Aims-Product-Roadmaps-API.md)。

### Aims 季度路线与正式承诺（2026-09-08）

季度 GET roadmaps/quarter 和历史 GET roadmaps/commitments/{itemBizId} 使用路线/优先级 view 双 permit，BFF 核对产品事实一致，Runtime 使用精确 aims:product-roadmaps:read 且按只读传输处理。季度从既有周期决定顺序派生，历史真实分页返回不可变快照及当前变化原因，不自动撤销基线。

POST roadmaps/commit/{itemBizId} 使用 product_roadmaps/commit 及精确 aims:product-roadmaps:commit。四项当前修订、上一基线 ID、原因及幂等键绑定用户查看的事实；服务端核验当前选入/评估/投入与前置依赖，读取真实快照。v5.26 基线禁止改写/删除，变更追加后继；事务同时保存基线、审计、根修订及回执。浏览器不可提供日期、快照、操作者或例外覆盖。未取代版本范围确认或项目需求基线流程。详见路线 API。

### AIMS → Codocs 产品文档元数据（PC-16，代码接入中）

`POST /api/v1/service/product-documents/{uuid}/metadata` 要求精确 `codocs:product-document:read`，来源 `aims.runtime`，签名命令 `aims.codocs.product-document.read.v1`。固定载荷为 actorUid/productCode/documentUuid/action=metadata:read。来源 deployment 取服务身份，目标 deployment 取受信路由，Foundation HMAC 分别绑定二者、tenant、method/path/request ID 和 payload hash，不假定两个 deployment 相同。

Codocs 以自身运行身份调用 `/v1/codocs/service/product-documents/{uuid}/metadata`，申请 `codocs.read codocs:product-document:read` 并重新签名 actor。Runtime 要求精确 capability，再执行 owner/share/relation ACL；产品关系与部门 hint 不授予正文访问。只返回 UUID、标题、类型、更新时间，不返回正文或存储路径。AIMS 必须先验证自身产品文档关系，且候选 UUID 经本接口核验后才能向浏览器展示。

此为只读元数据链路，无业务写入；操作标识与幂等键用于签名关联。Console grant 的生成式 Seed/Verify 已包含本链路：aims.runtime → aud=codocs 的 codocs:product-document:read，以及 codocs.runtime → data-runtime/tenant-runtime 的精确产品文档读取能力。既有 codocs.read 传输权限只核验、不自动扩权。目标环境安装、令牌签发探测及完整跨服务测试尚未完成，不能标记为已启用。正文、模板创建和关联操作另行接入。

AIMS 侧内部调用方已新增 `aims/server/utils/productDocumentCodocs.ts`：产品文档 view 授权先于 Codocs token 申请，actor 来自当前授权事实；使用 Foundation 可信 Gateway 服务目录及目标路由 header helper，签名分别绑定 AIMS/Codocs deployment。此 helper 供现有关系读取和关联预检编排，尚未开放浏览器文档入口，不能替代 AIMS 关系归属校验；无可信服务目录时返回 503。

AIMS 内部候选关系读取新增 `POST /v1/aims/internal/products/{productCode}/roadmaps/documents:list`，只读传输 `aims.read`、精确能力 `aims:product-documents:read`，固定签名 actor 与 product_documents/view 许可。input 接受用途、解除状态和有界 page/page_size；返回关系 UUID、用途、修订和候选总数，不能直接作为浏览器可见列表。BFF 必须完成 Codocs 当前 ACL 核验后才返回文档标识与标题。Manifest 及双 audience Seed/Verify 已更新，当前为 167 业务 grant / 175 核验项，目标环境仍未安装。

产品文档浏览器列表接入 `GET /api/v1/products/{productCode}/roadmaps/documents?page=1&pageSize=20&purpose=design&removed=false`。用途可省略，解除状态默认 false；BFF 独立 product_documents/view 授权，经自身 Runtime 候选页和 Codocs 签名元数据服务过滤后计算可见总数/分页，响应 no-store。只有 403 permission_denied/product_document_inactive 计入 restrictedCount，其余认证/服务错误传播；产品根修订变化为 409，末尾再次核验权限与修订。尚未完成真实 JWT、页面及大文档空间性能验收。

产品文档内部关系详情新增 `POST /v1/aims/internal/products/{productCode}/documents:view`，input 为 biz_id，复用 aims:product-documents:read 与 product_documents/view 许可及只读传输。按产品+关系身份查找，含已解除关系，返回根修订和关系当前用途/状态/修订；仍为内部候选数据，浏览器曝光及恢复前须独立核验 Codocs ACL。无新增 grant。

产品文档解除关系 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:remove`，要求 aims.write 和 aims:product-documents:remove、受信 actor、product_documents/edit 许可及稳定 idempotency_key。input 为 biz_id/expected_revision/expected_document_revision，关系状态、产品修订、审计和回执同事务，不修改 Codocs 文档或 ACL。复用 manifest 生成双 audience grant，当前 169 业务 grant / 177 核验项；浏览器写入口及真实部署验收未完成。

解除关联 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/remove`，不接受 query，要求 Idempotency-Key，body 严格为 bizId/expectedRevision/expectedDocumentRevision。当前 product_documents/edit 授权先于 body，actor 仅来自授权事实；转自身 Runtime 精确 remove 能力。旧预期修订交 Runtime 处理幂等回执，不在 BFF 提前拒绝。该动作只解除关系，浏览器按钮尚未接入。

文档列表响应补充 canEdit：列表结束时独立计算 product_documents/edit，要求其产品、actor、修订和状态与当前查看事实一致，且产品 active 才返回 true。编辑权限故障传播，事实变化返回 409；该字段只控制 UI，解除关联 BFF/Runtime 仍独立授权。

文档用途维护 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:edit`，精确 aims:product-documents:edit、写传输及 product_documents/edit 许可，input 为 biz_id/purpose/expected_revision/expected_document_revision，稳定幂等键；复用领域用途枚举、已解除拒绝及双修订事务。Manifest 与双 audience 生成授权更新为 171 业务 grant / 179 核验项，目标环境未安装；用途修改 BFF/页面尚未接入。

用途编辑 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/purpose`，无 query，要求 Idempotency-Key，body 严格为 bizId/expectedRevision/expectedDocumentRevision/purpose；用途限定六个合同值。与解除复用产品 edit 授权/受信 actor/双修订及幂等转发，动作和精确 capability 由服务端固定为 edit。页面用途编辑入口尚待接入。

恢复关联内部 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:restore`，要求 aims.write + aims:product-documents:restore、受信 actor、product_documents/edit 许可、稳定幂等键及双修订。恢复原关系，不创建新 biz_id/UUID，不修改 Codocs ACL。调用方 BFF 须先读取同产品关系并核验 Codocs 当前访问权限，浏览器恢复入口尚未开放。生成授权当前 173 业务 grant / 181 核验项，目标环境未安装。

恢复 BFF 已接入 `POST /api/v1/products/{productCode}/roadmaps/documents/restore`，body/key 同解除。当前 edit/view 事实必须同产品、actor、根修订；先由自身 documents:view 读取关系，校验归属，再以关系中的 UUID 调 Codocs 当前 ACL 元数据服务，最后提交 restore。浏览器不得提交 UUID，已恢复状态不在 BFF 提前拒绝，以支持成功回执重放；每次重试仍核验 Codocs 当前权限。页面恢复入口尚待接入。

关联创建内部 Runtime 新增 `POST /v1/aims/internal/products/{productCode}/documents:create`，要求 aims.write + aims:product-documents:create、受信 actor、product_documents/edit、稳定幂等键；input 为 document_uuid/purpose/expected_revision。领域层产品+UUID唯一，已解除关系须恢复，不重复创建。BFF 须先核验 Codocs 当前权限，浏览器创建入口尚未开放。生成授权当前175业务grant/183核验项，目标环境未安装。

关联创建 BFF 接入 `POST /api/v1/products/{productCode}/roadmaps/documents/create`，无query、稳定Idempotency-Key，body仅documentUuid/purpose/expectedRevision。先产品edit授权，严格UUID/用途/修订，再以当前用户调用Codocs元数据ACL预检，成功后调自身documents:create。浏览器不提供actor/权限事实，Codocs拒绝或不可用时不写关系；重复请求仍核验当前ACL后交Runtime处理回执。

产品文档搜索 Service API 新增 `POST /api/v1/service/product-documents/search`：使用既有精确 codocs:product-document:read、aims.runtime 来源及独立源/目标 deployment；无 query，固定六字段 search.v1 签名命令（actorUid/productCode/action/search/page/pageSize），HMAC/hash 验证后以目标自身 runtime 身份重签 actor。响应严格分页和四元数据白名单，不返回 OSS/权限信息。middleware 本地 handler 已登记；调用方和真实部署验证待完成，复用 read grant 不新增授权。

AIMS 内部 searchProductDocuments 调用方已接入固定 search.v1 Service API：当前 product_documents/view 用户事实、可信 Gateway 路由和独立源/目标 deployment，搜索词/页码/页大小包含在签名命令中。与元数据读取共用本模块签名发送编排及Foundation helper；响应严格校验分页、规范UUID和重复项并投影白名单。浏览器搜索入口和选择器待接入。

### 2026-09-08：产品文档正文 Service API

`POST /api/v1/service/product-documents/{uuid}/content` 由 Codocs middleware 精确分发，复用 `codocs:product-document:read`。固定 operation/schema 为 `aims.codocs.product-document.content-read.v1`，command 严格为 actorUid/productCode/documentUuid/action（content:read）；源 AIMS 签名及 tenant/双 deployment 绑定先于 Runtime 和存储。Codocs 使用自身身份与同一精确 capability 访问 Runtime，当前文档 ACL 校验后才下载正文；空 Markdown 按既有 Yjs 恢复机制处理。对外仅返回 uuid/title/docType/updatedAt/contentSize/content，不返回 OSS 路径。存储失败为脱敏503。

复用已登记 read grant，不增加 scope 或放宽现有权限。AIMS 正文调用及预览尚未接入；VM测试含真实HMAC，但身份解析、Runtime及存储为stub，不等同真实JWT/OSS验收。

### 2026-09-08：产品模板创建内部 Runtime 阶段

Codocs Runtime 新增 POST `/v1/codocs/service/product-documents/create/{template|prepare|complete}`，固定签名创建命令与精确 `codocs:product-document:create` 先于存储；非POST拒绝。template返回内部模板读取授权，prepare/complete每次重新校验模板ACL，分别调用冻结快照及共享回执完成事务。快照/上传参数是Codocs BFF自产的内部数据，不接受浏览器直传；外部BFF还必须校验实际用户documents:create资格。返回模板/快照中的存储路径仅供Codocs内部，不得传给AIMS。

外部Service未开放，创建授权Seed仍不安装；后续接BFF时需要Codocs自身Runtime写传输授权及精确create能力。专项Go测试通过，覆盖三阶段缺scope/宽scope/readscope/缺签名及非POST在存储前拒绝；此轮未验证真实Service/JWT/OSS链路。

### 2026-09-08：产品模板创建 Service 入口与授权产物

`POST /api/v1/service/product-documents/create` 已由 Codocs middleware 精确分发到创建处理器。入站要求 AIMS 精确 `codocs:product-document:create`；Codocs 自身访问 Runtime 使用 `codocs.write codocs:product-document:create`。Console生成产物增加AIMS→Codocs及Codocs→双Runtime的create业务授权，Codocs写传输只列前置核验、不自动扩大。

矩阵现为178条业务授权、10条传输前置要求，共188项。七项manifest/grant测试、Codocs typecheck及相关Lint通过；隔离MySQL验证188项、种子幂等、缺客户端、非选定客户端、缺传输、inactive授权与过期凭证门禁。原测试固定数量随新增组合更新：Codocs凭证失效影响8项，AIMS凭证失效影响176项、其余12项通过。未安装到真实租户，未完成实际service token组合签发探测或OSS联调。AIMS模板创建调用与UI仍待接入。

### PC17 Altoc 客户反馈到 AIMS 产品需求（实现中）

AIMS 已登记 `POST /api/v1/service/product-requests/from-feedback` 专用 BFF，使用 `aims:product-request:create-from-feedback`，仅接受 altoc.runtime 与 Foundation 签名命令；可信 Gateway 的 AIMS 目标部署与 Altoc token 来源部署分别绑定。BFF 通过自身 Runtime 读取签名 actor/product 的授权事实，再用 Console/Foundation 评估 product_requests:create，最后调用自身内部接收事务。需求、来源、自然键绑定及目标 receipt 同事务；Altoc 工单与客户仍是来源事实，客户 priority 不映射产品评分。详细字段和验收见 `aims/docs/Aims-Product-Feedback-Contract.md`。Altoc 源提交／派发和目标环境 grant 尚未交付，不宣称反馈闭环已启用。

### 产品当前采用读取（PC18，开发中）

AIMS 产品中心通过 Assets 服务边界读取当前采用，精确 capability 为 `assets:product-adoption:read`，固定签名协议 `aims.assets.product-adoption.read.v1`；五字段 command 为 actorUid、productCode、action=read、page、pageSize。原用户须有当前产品查看权限，Assets 按同一原用户独立加载 deliveries:view 和 environments:view 数据范围，交集过滤后才统计或分页。不得通过 AIMS 直接读取 Assets Runtime，也不得把服务客户端权限代替原用户对象授权。

Assets manifest 及 Console seed/verify 已准备 AIMS→Assets 与 Assets→双 Runtime audience 精确授权。C000001 测试租户已安装 Seed 并 Verify 236 行 0 FAIL（记录见 `deploy/test-env/CLOUDFLARE_TEST_STATUS.md`），但只对 `assets:product:read` 做过真实令牌签发探测，`assets:product-adoption:read` 的签发探测与端到端验收仍未完成；生产租户未安装。Assets 已注册 `POST /api/v1/service/product-adoption/read`，专用 handler 完成身份、签名、原用户授权后调用自身 `POST /v1/assets/internal/product-adoption:read`；AIMS transport、页面及真实链路验收待完成。详细口径见 `aims/docs/Aims-Product-Adoption-Outcome-Contract.md`。

失败归类是这条链路的契约的一部分，因为两类失败对使用者的含义完全不同。Assets 的三个 403 出口都返回稳定 `data.reason`：原用户对象范围被拒为 `assets_object_scope_denied`，服务身份或部署绑定不匹配为 `product_adoption_service_identity_invalid`，签名命令不合法为 `product_adoption_command_invalid`。AIMS 只把 `assets_object_scope_denied` 作为 403 透出，并提示补 Assets `deliveries:view` / `environments:view` 及数据范围；其余 401/403、Console 服务令牌签发失败和无效响应一律收敛为 503，不携带 Console 诊断串，也不提示用户去申请权限。缺少产品查看权限时 AIMS 仍返回 404，不返回 403。

### 产品反馈决策回流（PC17，开发中）

Altoc 已登记 `POST /api/v1/service/product-feedback/status` 专用服务处理器，AIMS 来源精确能力 `altoc:product-feedback:update-status`，固定 `aims.runtime`，目标 Altoc 部署由可信 Gateway 绑定。命令 `aims.altoc.product-feedback.update-status.v1`、schema `product-feedback-status.v1` 包含 ticketCode/productCode/requestBizId/canonicalRequestBizId/decisionStatus/sourceRevision 六字段；不接受工单状态或客户身份。

验签后通过 Altoc 自身 Runtime `POST /v1/altoc/internal/product-feedback:status` 执行原子 receipt 和单调状态投影。同 revision 异内容冲突，旧 revision 跳过；需求合并保留原提交 UUID，更新 canonical 引用，不关闭服务工单。尚缺 AIMS 决策事务 outbox／派发与真实部署验收，接口登记不等于闭环启用。
# 产品中心期间成本读取补充（2026-09-09）

AIMS → Finance：`POST /api/v1/finance/service/product-cost/read`，精确 `finance:product-cost:read`，签名 operation/schema `aims.finance.product-cost.read.v1`。五字段命令为 actorUid、productCode、projectCode、periodMonth、action=read；Finance 固定接受 aims.runtime，同租户可信部署绑定，并通过 Console `product_cost_read` 查询原用户 `project_accounting:view` 项目范围。Finance BFF 校验后调用自身 Runtime `/v1/finance/internal/product-cost:read`，不直读其他应用数据库，不写只读 receipt。

结果仅含请求产品比例、分币种成本、ready／原因、规则及来源修订；成本沿用 Finance 非取消支出台账与有效 allocation 口径，不宣称实际已付。收入归因未配置时独立保持未就绪，不以收款或合同额替代。完整规则计算后再投影单产品，不能按可见产品重分比例或泄漏薪资来源。当前服务路由及受控测试已实现，真实租户 JWT 和 AIMS 页面未验收；详细约定见 `aims/docs/Aims-Product-Adoption-Outcome-Contract.md`。

### 产品成本规则可靠投递补充（2026-09-09）

AIMS 的 claimed-operation 派发器对 `aims.finance.product-cost.rules.replace.v1` 使用 Finance BFF `POST /api/v1/finance/service/product-cost/replace-rules`，仅申请 `finance:product-cost:replace-rules`，schema 为 `product-cost-rules.v1`。request IO 使用可信网关路由，scheduled IO 使用显式 `HZY_FINANCE_TARGET_DEPLOYMENT`，托管云通过 `HZY_FINANCE_SERVICE`。目标回执和结果均绑定项目、月份及下一修订；本地确认丢失维持 pending 并复用原幂等键重放。精确 grants 已纳入生成脚本；实际授权安装、源端冻结入口及完整用户流程验收未完成。

AIMS 源端冻结接口补充：POST /v1/aims/internal/product-cost-rules:freeze 仅供 aims.runtime 以精确 aims:product-cost-rules:freeze 和委托用户调用。请求为 requestId、完整 command 与短时 projects:edit authorization；在 AIMS 本地事务中锁定项目并冻结幂等任务。该 capability 已加入 data-runtime/tenant-runtime 双 audience 安装矩阵。用户 BFF 保存路由及真实租户验收未完成。

规则提交查询使用 AIMS 自身 Runtime 精确 capability aims:product-cost-rules:status，接口 POST /v1/aims/internal/product-cost-rules:status。仅返回当前项目编辑者本人提交的任务状态，按租户/部署/actor/项目及固定 Finance 规则 operation 约束查询；不返回冻结规则、员工或内部异常详情。

Finance 完整分摊规则读取 Service API 为 POST /api/v1/finance/service/product-cost/read-rules：来源 aims.runtime、capability finance:product-cost:read-rules，按签名四字段 command 校验后以原 actor 的 project_accounting:edit 调用自身只读 Runtime。结果仅 projectCode、periodMonth、revision、evidenceRef、shares；不允许以单产品过滤器取得不完整编辑基线。

### Assets 产品用户列表与服务目录分离（2026-09-09）

Assets 用户 `GET /v1/assets/products` 与详情读取必须携带由 Console scoped authorization 派生的 products 对象范围和当前用户；用户列表及 total 只包含同一 SQL 范围内的产品。产品负责人对应主档 business_owner_uid / technical_owner_uid，项目对应 project_code；无部门字段映射的授权单元不放宽。

存量 Assets Service API 的 serviceProducts helper 改为调用自身 `GET /v1/assets/service/products`，使用 `assets.read assets:product:read`，Runtime 校验受信 Assets 服务上下文及精确 capability 后执行目录读取。该 capability 已在产品目录 manifest 与双 runtime audience grants 中定义，未引入新增 grant。外部存量 service 路径保持其已有入站认证契约；新增产品中心同步继续使用分页 `/service/products/catalog`。存量服务目录的分页改造及产品写入口对象范围仍待完成。

### Assets 产品文档元数据校验（实现中，2026-09-09）

Codocs 自身 Runtime 新增 `POST /v1/codocs/service/assets-product-documents/{uuid}/metadata`，精确 capability 为 `codocs:product-document:read`，签名 operation/schema 为 `assets.codocs.product-document.read.v1`。受信来源固定 `assets` / `assets.runtime`；命令仅 actorUid、productCode、documentUuid、action（metadata:read），actor 必须与已验证服务委托一致。产品上下文不提供文档 ACL，Codocs 仍重验当前用户 documentAccess，只返回 uuid/title/doc_type/updated_at。

此入口与既有 AIMS metadata 路径隔离。尚待 Codocs Service API、Assets 签名传输和 source grant 接线；不能直接以 Assets 凭据调用 Codocs Runtime，也不能宣称用户链路已可用。

上述 Assets 产品文档元数据的 Codocs Service API 已注册：`POST /api/v1/service/assets-product-documents/{uuid}/metadata`。入站 auth requirement 独立固定 assets/assets.runtime，精确 `codocs:product-document:read`；Foundation 验证 HMAC、tenant 和来源／目标 deployment 后，Codocs 使用自身 runtime 身份及 actor 委托执行 ACL 查询。仍待 Assets 调用方与 source grant 安装接线。

Assets 产品文档关联接线（2026-09-09）：用户 POST products/:id/documents 的 middleware 先按产品对象范围查询规范 product_code，再由当前用户向 Codocs 发起上述签名 metadata ACL 查询。成功后派生 current_user_product_document_* 字段，绑定 actor、产品 ID/code、文档 UUID 和 15 秒有效期；所有同前缀入站 query/body 字段先清除。Assets 关联事务在父产品 edit 范围锁内校验该短期结果与当前产品编码后写入。该短期预检不授予 Codocs ACL，也不等同跨数据库原子撤权；点击打开文档仍须由 Codocs 当前 ACL 授权。

### Service client 的精确部署绑定（测试与非默认部署）

Console `service-client-policy` 签发目标应用自身 Runtime Token 时，若已验证的凭证策略或 Gateway 上下文属于该应用，必须保留其精确 deployment（例如 `C000001-test-assets`），不得重新拼接为 `C000001-assets`。其他来源应用的 deployment 不得复用为目标部署；跨租户或本应用绑定不完整时拒绝。无显式本应用绑定的 legacy canonical runtime client 才沿用既有命名兼容规则，最终仍由 Runtime 的 enrollment deploymentBindings 校验。此规则同样适用于 AIMS → Assets 产品目录 → Assets Runtime，业务 capability 保持 `assets:product:read`。

Runtime 的 `hzy_runtime_service_client_id` 必须取已验证 JWT 的 `client_id`（`auth.Context.ClientID`），不能取带 `client:` 主体前缀的 `sub`。仅缺少 ClientID 的 legacy 已验证上下文继续使用 Subject 兼容；外部 query/body 中同名字段仍由认证层剥离并覆盖。产品目录继续精确要求 `assets.runtime`，不接受通过截断或宽匹配伪造客户端。

- 用户通知代理 `fetchConsoleNotificationsForUser` 统一通过 `consoleServiceFetch` 消费 Console Service Binding，保留已验证用户凭证、查询参数和写操作幂等键；托管云不经公网回源读取通知。

### Aims 轻量版本计划（2026-09-12）

Aims 浏览器 BFF 经 Foundation 调用本应用 Runtime 的 `versions:plan/plan-items/plan-edit/plan-item-create/plan-item-edit/plan-item-delete/plan-confirm`，读取复用 `aims:product-versions:read`，写入复用 `aims:product-versions:edit`。不新增跨应用数据库访问或服务客户端。版本 `planning_mode` 持久化为 `simple/cycle`；旧版本和省略模式的旧创建调用保持 cycle，新 UI 默认 simple。

产品范围 permit 在 Runtime 事务内分别要求 `product_versions:view/edit`、来源 `product_requests:view`、明确采纳时的独立 `product_requests:decide`、创建规划事项的 `product_priorities:edit`、确认的 `product_priorities:prioritize`。转交继续叠加需求/规划 handoff 与目标项目 requirements edit；服务 capability 不替代用户权限。写入使用当前用户委托、幂等键和预期修订。simple 转交依据必须来自实际版本范围和当前有效确认；cycle 路径继续执行原评分/选入门禁。

计划元数据、范围估算及不可变确认快照由 v5.38 扩展，范围身份仍使用既有 planning item/version feature/source request。2026-09-12 已迁移 C000001 本机测试 Aims 库并部署 CF 测试 Aims / Runtime，生产未部署；线上已验证读取和表单，完整真实租户写入链路未实跑。本地隔离 MySQL、BFF/adapter 合同和 mock UI 的证据分别记录于 [第一阶段方案](../aims/docs/Aims-Lightweight-Product-Planning-Phase1.md)。完整输入输出见 [轻量规划 API](../aims/docs/Aims-Lightweight-Product-Planning-API.md)。


### ADR-018 统一产品需求事务入口（接线进行中）

托管 Enterprise BFF 的业务 permit deployment 来自 Foundation 验证后的 Gateway Host 绑定，并核对 appCode=enterprise、tenant 与用户会话一致。用户 access token 中的 Console 签发部署保留用于会话验证，不能直接充当统一业务部署；未经验证的 Header 不得选择 Host 身份。具体实现与负例验证见 `enterpriseRuntimeClient`。

`data-runtime/internal/enterpriseplanning.RequestService` 在初始化时验证 Aims 所需受管视图，按登记的 writer 与迁移代际调用 `Registry.BeginWriteTransaction`。后者要求参与域均处于 unified write 模式、使用同一连接池和同一 tenant/environment/runtime deployment/schema/generation；业务写入前对 `enterprise_schema_registry` 的身份行取共享锁并核验持久值，锁保留至最终 commit/rollback。

需求创建继续调用原 `productcenter.CreateProductRequestInTransaction`：保持 workspace/member 事实重鉴权、原命令身份、修订检查、audit 与 receipt，成功后由用例服务提交；任一步失败整体回滚。该入口不新增角色算法，不在请求中创建视图，也不代表现有 HTTP 旧 URL 已切换。初始化、受信 Host 调用、其余规划命令及实际目标环境接线须继续完成。


### ADR-018 Enterprise → Codocs 产品文档元数据

`POST /api/v1/service/assets-product-documents/{uuid}/metadata` 额外接受物理 `enterprise` / `enterprise.runtime`，仅限原 `assets.codocs.product-document.read.v1`、精确 `codocs:product-document:read`、`metadata:read` 命令。Assets 原身份继续可用，两组 app/client 必须各自匹配，不允许交叉组合。JWT 的 Codocs audience、当前授权、源部署与目标部署分别验证；HMAC 绑定 method/path/request ID、actor、productCode、UUID 及完整命令 hash。产品上下文不授予文档 ACL，Codocs Runtime 仍按当前 owner/share/relation 判断，仅返回 uuid/title/doc_type/updated_at。本条只覆盖 Assets 产品文档元数据；项目文档正文读取另有下节的独立条目，两者的 capability、operationCode 和授权条目互不蕴含。

此为代码合同，目标环境 Enterprise→Codocs grant/部署与真实跨服务验收尚未完成；该 Codocs audience 能力独立于 Enterprise→Runtime 的 data-runtime 能力集合。

### ADR-018 Enterprise → Codocs 项目文档正文

Host 原生组合增量：`GET /aims/api/v1/projects/{id}/documents/{documentId}/open` 不调用独立 Aims 的 `open`，而先沿原签名项目文档 `view` 桥复核 `projects:view`、项目范围与精确关联行，从受信响应取得 Codocs UUID。随后以同一用户 actor 调用既有 `codocs.personal-document-view`（`codocs:personal-documents:read`），保留 Codocs `documents:view` 与 Runtime owner/share/relation ACL，确认元数据后才由 `withEnterpriseCodocsDocumentContent` 读取正文。项目成员身份不覆盖 Codocs 拒绝；浏览器不能提供 UUID 或存储路径。读后再次复核项目关联和 Codocs ACL/元数据，关联、路径或更新时间变化返回 409，不释放已读取正文。输出保持 `{code:0,data:{document,content}}`，不含存储路径；无新增能力/grant/虚构 Codocs 部署。以下独立 Service API 路径及独立 Aims 调用保留不变，不能为原生 Host 编造目标部署。

ADR-018 §2 范围表中 Codocs 首轮保留独立运行边界，因此这是真实的跨应用调用，不是把 Codocs 并入宿主。

Enterprise Host `GET /aims/api/v1/codocs/documents/{uuid}/content?projectId=` → Aims 共享 helper `getCodocsProjectDocumentContent` → Codocs `POST /api/v1/service/project-documents/{uuid}/content` → Codocs 自身 tenant-runtime `POST /v1/codocs/service/project-documents/{uuid}/content`。

- **本域先判定**：Host 先要求登录用户，再用 `assertCodocsProjectDocumentAccess` 在本域判定该项目文档的访问权限，拿到 `projectCode` 后才发起跨应用调用；项目成员关系不构成 Codocs 授权。
- **并列身份，不放宽**：Codocs 新增 `ENTERPRISE_PROJECT_DOCUMENT_CONTENT_SERVICE_AUTH`，与既有 Aims 条目并列——scope（精确 `codocs:project-document:content:read`）、`operationCode`（`aims.codocs.project-document.content-read.v1`）与命令 schema 完全相同，只有 `allowedApps` / `allowedClientCodes` 不同。Aims 条目继续只认 `aims` / `aims.runtime`。
- **来源与客户端同源**：`aims` + `enterprise.runtime`、`enterprise` + `aims.runtime` 等交叉组合在 Codocs BFF 与 Runtime 两层都被拒；发送端的 `sourceClientId` 由已验签的来源应用派生，不是可填写的字面量。未登记的第三方来源一律拒绝。
- **Runtime 仍重验 ACL**：Codocs Runtime 只按文档当前 owner/share/relation 判断，命令里的 `projectCode` 只用于绑定，不授予读取；BFF 返回的 DTO 不含 `ossPath` 等内部字段。
- **capability 单点声明**：`enterprise/server/utils/enterpriseCodocsProjectDocument.ts` 的 `requiredCapability` / `audience` 是 readiness 策略推导宿主 Codocs 能力的唯一事实源，不维护第二份清单。
- **回归矩阵**：正确调用、缺 capability、宽 scope 替代、错 audience、错来源应用（双向交叉 + 第三方来源）、错客户端、用户令牌与 introspection 故障分别有用例；覆盖见 `codocs/test/projectDocumentContentSourceAppBoundary.test.ts`、`codocs/test/projectDocumentContentServiceContract.test.ts`、`data-runtime/internal/apps/codocs/project_document_service_test.go` 与 `enterprise/test/aims-project-documents-readiness.test.mjs`。GET 读取无副作用，不需要幂等键。

C000001 测试环境已完成该 scope 的 Console grant 与令牌签发探测（`deploy/test-env/enterprise-oauth-codocs-evidence.json`，含 2 条负例）。Worker 部署与浏览器端到端验收尚未完成，证据中 `browserAcceptance` 仍为 false，不能视为已启用。

### ADR-018 工作项完成审批（整合分支，尚未启用）

Workflow 专用服务入口为 `POST /api/v1/service/aims-work-item-completion-approval`，要求 `workflow:work-item-complete:create`，自身 Runtime 路径为 `/v1/workflow/service/aims-work-item-completion-approval`。冻结命令限定完成申请、工作项、项目、操作者和快照 hash；调用方不得覆盖回调路径。操作码为 `aims.work-item.completion.workflow-submit.v1`，幂等键为 `aims:work-item-completion:<requestId>:workflow-submit:v1`。目标回执身份为 `work_item_completion_workflow` / `completion-request:<requestId>`；重试必须恢复唯一匹配冻结身份的实例，不重新创建实例或派发创建 effects。

Matter 完成申请复用该操作码、能力、回执目标与专用回调，但冻结命令使用 `commandSchemaVersion=v2`、`kind=matter` 和 `aims:work-item-completion:matter:<requestId>:workflow-submit:v2`；`formData` 同时含精确 `kind=matter` 及成果、必需成果、提交、工时记录四项计数，成为 Workflow 任务快照和终态回调的一部分。审批页只显示该冻结摘要和 hash，不读取实时 Aims 对象。Workflow BFF 与 Runtime 均拒绝 v1/v2 与 kind 不匹配、未知 kind 或额外字段；重试恢复实例时核对冻结的 kind。原 target 命令仍为无 kind 的 v1 和原幂等键，保持字节与行为兼容。Aims 回调以申请行 kind 对照表单 kind，matter 批准前复核冻结的工时与成果证据，差异失败关闭；批准仍需至少一名非申请人的批准者。此 matter 分支尚待本机部署与浏览器端到端验收。

请求驱动的 Aims→Workflow 投递直达受信服务路由，必须用 Foundation `trustedServiceRequestHeaders(event, 'workflow')` 转发已验证的 Gateway 上下文，并绑定目标 app-code、deployment 与 forwarded-prefix；不得透传浏览器自带的同名头或其它请求头。定时投递仍由 Gateway 自行建立目标信任上下文。该传输修复也适用于云端请求驱动路径，云端尚未部署验证。

专用回调限定 Aims 的 `/api/v1/service/work-item-completion/workflow-callback`。审批终态事务从最后一次 resubmit 之后的 Workflow approve/reject actions 生成 `approval_actor_uids`、`non_self_approval_actor_uids` 和 `approval_operator_uid`；缺少终态操作者时回滚，自动自审批不产生非本人证据。回调 outbox 在序列化之前生成 `workflow:callback:<instanceId>:flow_completed:<status>` 并写入 payload 的 `idempotencyKey`，即时派发和持久重试共享该身份。

通过回调仅采用 approve actions，驳回回调仅采用 reject actions，不能用退回人的记录充当非本人批准。创建结果必须是 running，否则专用命令回滚实例、effects 和 receipt，避免无人工审批路线直接批准后源对象无法解锁。取消延续现有 Workflow withdraw 约束；专用取消回调在同一事务核验当前 withdraw 动作属于该实例发起人，生成 `cancellation_actor_uid`，不生成虚假审批主体列表。源端取消应恢复冻结原状态、释放完成申请的活跃唯一约束，并原子写入审计和适用工单 outbox。

缺动作定义、无匹配路线和无人工审批路线属于可人工修复的配置失败；当前 Foundation 不把这些 404/409 自动分类为 transient。修复配置后必须通过受权限控制的 operation replay 保留原冻结命令及幂等键，不能生成新申请来绕过失败记录。网络超时及响应丢失继续按投递不确定处理；目标已有成功 receipt 时恢复唯一原实例。Host 的失败展示和人工 replay 可达性仍需验收，不能把目标直接重试测试当作消费链路已恢复。

统一 Runtime 的 completion replay 必须把受信 Registry 解析的 Aims outbox 四张物理表传给 Repository；只在 SELECT 中映射逻辑 `integration_operation` 而让 Repository UPDATE 裸表，会把可恢复的 `failed_permanent` 操作误报为 409。重放前后保持原 operation ID、冻结命令及幂等键，事务内更新状态与审计。

统一 Aims 的 integration-operation 诊断、认领、通知、周报重试及通知详情授权均通过同一受信 Registry 解析的四张 outbox 物理表；只在未配置 Enterprise writer 的旧独立库路径使用原逻辑表名。replay 仅对版本变化或状态不适用返回 409，存储错误保持 5xx。

Enterprise Host 的独立 `/enterprise/approvals` 待办入口只取 Workflow 当前用户的 `aims/tasks/complete` 任务；任务详情与决定以前端登录用户对应的 Workflow 任务归属、`workflow_tasks` 精确审批资格和发起人与审批人职责分离为门槛。页面仅展示 Workflow 提交时冻结的标题、动作及审批节点快照，不读取实时 Aims 对象或提供业务对象跳转；原按业务键查实例路径仍要求 Aims 对象查看权。审批 POST 复用 Workflow 的受信 actor 委托、approve/reject 资格和持久任务状态，已处理任务返回 409，不自动换幂等键。

Host → Workflow 的拓扑只由部署配置决定（G-3，2026-09-29）：`HZY_ENTERPRISE_HOST_WORKFLOW_ENABLED` 未设置时保持托管云行为（审批面板隐藏，桥接沿用 Foundation 服务发现）；`false` 时面板隐藏且桥接直接 503，不查服务发现；`true` 时必须同时配置 `HZY_ENTERPRISE_WORKFLOW_ORIGIN`，其值只能是 `http://127.0.0.1:<port>` 或 `http://[::1]:<port>` 的精确回环源（无凭据、路径、查询、片段或隐式端口），Workflow 基础路径固定为 `/workflow`。其他取值、或未开启却配置了源，均在 Host 启动时拒绝，请求期再次校验只会失败关闭。配置不从请求 Header、租户共享设置或 public runtimeConfig 读取；`workflow:proxy` scope、actor 委托、受信上下文与幂等规则不变。hzy0 以 `features.workflowLocal` 映射到这两个变量，行为与原 `HZY0_LOCAL_ENTERPRISE` + `HZY_WORKFLOW_API_URL` 相同；自托管生产使用同一开关指向本机 Workflow。

自托管单站点的服务间回环（G-10，2026-09-30）：自托管 Tenant Gateway 在公网入口剥除全部客户端 `x-hzy-*`，所以应用服务端之间不得经公网回落。各应用进程以 `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON`（appCode → 精确回环 HTTP 源，必须含 console）声明本机进程，Foundation 在无 Cloudflare Service Binding 时用同语义回环传输替代：访问 Console（含 `/oauth/token` 服务令牌交换、runtime 配置、授权快照、通知、目录）去掉 `/console` 前缀并携带调用方已组装的受信 Gateway 上下文（`x-hzy-gateway-token` 为本机共享网关 Token，`x-hzy-app-code` 仍表示来源应用）；应用间 `serviceAppFetch` 保留 `/{app}` 前缀并由 Foundation 受信 route helper 原子改写 `x-hzy-app-code`/`x-hzy-deployment`/`x-forwarded-prefix` 为目标。Runtime 以 `HZY_SELF_HOSTED_RUNTIME_ENDPOINT` + `HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN` 只替换规范端点的拨号。Workflow 终态回调在自托管模式下经受信 route catalog 解析目标 basePath，以 `trustedServiceRequestHeaders(event, appCode)` 生成的受信上下文（校验 tenant 一致、目标 app/deployment/prefix 精确、不含 hzy0 拨号头）+ `aud=<业务appCode>`、`scope=workflow:callback` 服务令牌直连目标进程；缺少可信路由或目标源时按 `callback_app_url_unavailable` 记失败检查点，不回落公网。Aims→Workflow 工作项完成沿用 `serviceAppFetch(event, 'workflow')` + `trustedServiceRequestHeaders(event, 'workflow')`，自托管时自动走回环。source_app/target_app、精确 capability、幂等键与 401/403 语义不变；托管云（真实 Service Binding 优先）与 hzy0（`HZY0_*` 路径、23140/23141/18084 固定值，禁止与自托管变量同时设置）行为不变。配置只来自进程环境并在启动时校验，非法即拒绝启动。


此链路存在两个独立的 `workflow:work-item-complete:create` 授权边界：Aims 调用 Workflow Service API 时由 `aims.runtime` 获取 `aud=workflow` token；Workflow BFF 调自身 Runtime 时由 `workflow.runtime` 获取目标 Runtime audience token。后者须分别初始化/核验 `data-runtime` 与 `tenant-runtime` 精确 grant；不能用 Aims 的外部 grant、Workflow manifest 声明或宽 write scope 代替。当前代码及隔离数据库测试不证明目标环境这两个边界的实际签发授权已生效。

候选授权制品分开维护：[Aims seed](../console/docs/sql/Console-SQL-Seed-v2.6-aims-work-item-completion-grants.sql) / [verify](../console/docs/sql/Console-SQL-Verify-v2.6-aims-work-item-completion-grants.sql)，[Workflow seed](../console/docs/sql/Console-SQL-Seed-v2.7-workflow-work-item-completion-grants.sql) / [verify](../console/docs/sql/Console-SQL-Verify-v2.7-workflow-work-item-completion-grants.sql)。它们只初始化缺失行，不重新激活已有撤销授权；尚未向目标环境应用。

工作项详情附带的完成申请状态、canRequest/canReplay 和 operation 版本属于统一业务读取，必须在 Registry 代际 fence 下读取同一快照；兼容视图检查不是读取 fence。即使这些字段仅用于显示按钮，旧代际绑定仍须拒绝，写命令须再次执行对象权限、状态和版本校验。初版状态 helper 的多次直接连接查询已改为同一 Registry snapshot transaction；组合隔离 MySQL 演练已验证状态读取及恢复状态在旧代际下拒绝。事项（matter）不可提交时状态另带固定 `reason` 码（`matter_completion_time_required`、`matter_completion_evidence_required`、`matter_completion_commit_required`、`matter_completion_assignee_required`、`work_item_completion_state_invalid`），Host 因缺 `work_items:edit` 降为不可提交时写 `work_items_edit_required`；`reason` 只作面板提示，不含证据细节，也不替代写命令的重新校验。

当前仅有命令边界、回调路径、主体证据和持久幂等键的定向测试及 Go 包回归；源端完整接线、精确 grant 核验与真实隔离 MySQL 全链路测试仍未完成，不代表测试或生产环境已启用。
### Enterprise Host → Codocs v2 协作会话（阶段 B 候选）

Host 页面核验私人文档共享状态后，经 `POST /codocs/api/documents/{uuid}/collaboration` 让当前用户打开 Runtime 的 `personal-documents:collaboration-open`（精确 `codocs:personal-documents:edit`）。Host 先用 Foundation 读取 Console 权限快照并要求 `documents:edit`，再签发 Runtime 操作许可；Runtime 重验当前 owner/write-share 和 v2 代际，返回绑定用户/文档/会话的一次性票据。浏览器每条 WebSocket 经 `/codocs/ws` 将票据交 Collab；Collab 以独立 `collab.runtime` 身份兑换并按活动会话续租。hzy0 本机 Collab 的服务令牌经 Gateway 的本机 Host 限定 `/__hzy0/collab-token` 精确代理到本机 Console，该代理核对独立客户端密钥、目标 audience 与两项协作 scope 后才注入固定 Collab 部署上下文；公网 Console token 路由仍不接受服务客户端凭据。Host 共享正文禁用 HTTP PUT，避免与 Collab 发布并行覆盖。两个 Host 开关及 Collab v2 开关默认关闭，双人端到端尚未验收，不构成发布声明。细节见[写入协调合同](./Codocs-Document-Write-Coordination.md)。

hzy0 本机启用例外：`HZY_LOCAL_COLLAB_DEPLOYMENT=C000001-test-collab` 可在Platform overlay未登记Collab时显式启用精确绑定，仅限C000001、c000001-test-tenant-runtime、127.0.0.1:18084、Codocs enabled且v2快照/协作开启、静态配置同一绑定。overlay已有不同绑定则拒绝，其他应用绑定不变；不设置时不补静态绑定。此开关不修改服务身份、capability/grant或签名校验，生产/云端仍要求正式Platform部署绑定。见[hzy0启用计划](./Codocs-Collaboration-hzy0-Enablement-Plan.md)。

v2 快照字节由 Collab 通过同一 `collab.runtime` 身份调用 Runtime `POST /v1/codocs/collaboration-snapshots:upload|download`；上传沿用精确 `codocs:collaboration-snapshots:publish`，下载沿用 `codocs:collaboration-snapshots:read`，不新增 capability/grant。Runtime 先校验当前服务凭据、grant 与活动会话；上传再绑定已 prepare 的同一命令、声明长度与 SHA-256，只写该候选前缀下 32 位随机 attempt 的 `body.md` / `state.yjs`，每对象上限 16 MiB；下载只返回已发布 head 的精确对象版本，并重验长度与摘要。Collab 不持有 OSS 密钥，Runtime 使用 vault 绑定的 `oss.default`。新路由仍受 Runtime 协作开关控制，尚未部署或进行双人端到端验收。

#### Enterprise Host → Codocs 部门文档协作（Runtime 批次 R1，代码已实现，默认关闭）

设计与用户批准见[部门协作设计](./Codocs-Host-Department-Collaboration-Design.md)（2026-09-29，A-1…A-7、Q1–Q7）。**不新增服务 capability，不新增 Console grant**：Host→Runtime 复用 `codocs:enterprise-host:execute`，Collab→Runtime 复用 `collab.runtime` 的 `codocs:collaboration-snapshots:read/publish`，人员权限复用 `departments:edit`（普通读取 `departments:view`）。

**Host → Runtime 固定操作**（`POST /v1/enterprise/codocs/department-documents:<action>`，permit 资源固定 `department-documents`，路由 `code`=`dept_code`、`subId`=文档 UUID；仅当 `apps.codocs.snapshotV2Enabled`、`collaborationV2Enabled` 与新增 `departmentCollaborationV2Enabled` 三者同时为 true 时登记，默认全关）：

| 操作 | permit 动作 | 请求体 | 说明 |
| --- | --- | --- | --- |
| `collaboration-open` | `edit` | 必须为空 | 仅**可写者**获得会话与一次性票据：Directory 关系 R∈{member,manager}（2026-10-07用户裁定：当前同部门成员默认可编辑他人正文，不要求owner或写分享）；leader/parent/非成员 403 `department_writer_required`，分享不能替代部门关系。要求文档已 v2（否则 409 `document_not_on_snapshot_v2`）、类型/部门/`project_code=''`/未回收/未只读。租期 90 秒；同 epoch 复用活动会话并作废该用户旧的未兑换票据（票据不可重放，会话由稳定业务键决定，故不要求 `Idempotency-Key`）；每 (用户,文档) 每分钟 ≤6 次（429 `collaboration_open_rate_limited`）；每会话并发写者（已兑换参与者 + 未兑换有效票据）≤20（409 `collaboration_writer_limit_reached`）。 |
| `snapshot-read` | `read` | 必须为空 | 任一部门关系（含 leader/parent）读取已发布 head（generation/epoch/精确对象版本或 `legacy:true`）；**不创建 head，阅读不触发转换**。 |
| `snapshot-prepare` / `snapshot-publish` | `edit` | 快照命令；必须带 `Idempotency-Key` | **仅用于 v1→v2 转换**：Directory 加锁的写者、`generation=0`、仅 Markdown（无 Yjs）。head 已 >0 时 CAS 失败 409 `snapshot_generation_conflict`（两名并发点击者恰一人成功，另一人重读 head 后开会话）；`generation≠0` 409 `department_snapshot_conversion_only`；带 Yjs 400 `department_snapshot_conversion_invalid`。转换后部门正文只经 Collab 变更；旧 PUT / Host v1 保存 / v1 Collab 版本被 `document_on_snapshot_v2` 拒绝。 |

每次 Host 写操作在 Codocs 事务前取 `lockEnterpriseCodocsDepartment`（Directory 库只读事务 `FOR SHARE`，跨不同 schema 持有到 Codocs 事务结束）。Directory 不可用一律 503 `department_directory_unavailable`，不伪装成 403。

**Collab → Runtime**：路由与 capability 不变（`collaboration-snapshots:admit|read|prepare|publish|renew|close|upload|download`）。会话新增策略列 `policy(private|department)` 与 `dept_code`，Collab 每次调用只带 `sessionId`，Runtime 由会话反查文档与部门，**不接受 Collab 传入部门或 actor**。部门会话的差异：

- `admit`：先经只读 `PeekCollaborationTicket` 得知票据的策略/部门/用户，再取 Directory 锁重算该用户 R 与编辑规则，事务内重验文档（`FOR SHARE`）、会话、epoch 后兑换并记参与者 `status=active`；成功响应多返回 `deptCode`、`participantAccess`（个人响应字段不变）。失权 403 `collaboration_ticket_invalid`。
- `renew`（Collab 每 ≤30 秒）：请求体可选 `{"connectedUids":[...]}`（≤100 个 uid；个人会话带该字段仍为 400）。Runtime 在**一次批量 Directory 锁**下重算全部活动参与者与所报已连接用户的 R 与编辑规则：失权者置 `revoked` 并列入响应 `revokedUids`（连接却从未兑换的 uid 亦列入）；已上报列表之外的活动参与者置 `left`；通过者保持/恢复 `active`。响应 `{"expiresAt","revokedUids":[]}`（个人仍仅 `{"expiresAt"}`）。租期刷新为 90 秒。文档级失败（回收/只读/类型/部门变化、epoch 不符）或全部参与者失权 → 409 `collaboration_session_invalid`（后者同时将会话置 `revoked`），Collab 关整间房；参与者级失败只断开 `revokedUids`。
- `publish`：文档行锁下重验会话、epoch、文档状态，并在批量 Directory 锁下重算所有 `active` 参与者；任一失权 → 409 `collaboration_participant_revoked`，错误体 `error.details.revokedUids` 列出这些 uid（Runtime 同时将其置 `revoked`），Collab 断开后在下一保存周期重试；发布记录的参与者集合含 `active` 与 `left`，不含 `revoked`。撤销/过期会话上的迟到发布因 `status<>'active'` 或 epoch 不符被拒。参与者集合在加锁与事务之间变化时内部最多重试 3 次，仍变化则 409 `collaboration_participants_changed`。
- `prepare|read|download|upload`：会话活动 + 文档仍为可写部门文档（不做 Directory 重验）。
- 关闭 `departmentCollaborationV2Enabled` 后，部门会话在下一次 Collab 调用返回 409，个人协作不受影响。

**互斥**（同一 Codocs 事务内、文档行锁下）：部门 `readonly=true`、`recycle`、个人→部门移交接收、项目移交、文档分享变更均执行 `invalidateCollaboration`（epoch+1、活动会话置 `revoked`）；`readonly=false`/`restore`/`edit-metadata` 不撤销会话（标题与目录不属协作状态）。部门接收保留快照 head（v2 正文仍权威），不做退出 v2。加锁顺序固定为 Directory（共享）→ 文档行 → 快照 head → 会话/票据/参与者 → 候选。

Schema：`codocs/docs/migrations/20260929_department_collaboration.sql`（会话 `policy`/`dept_code`、参与者 `status`/`checked_at`、按 UUID 的 head/会话索引），DDL 不可事务回滚，安装须另获环境批准；未安装该迁移时个人路径行为不变（缺列读作 private）。本批次仅 Runtime 与迁移文件，尚未部署、未做双人端到端验收。

**自托管生产制品（P0，2026-09-29，代码与模板就绪、未安装未启用）：** 用户决定上线时启用共享个人文档协作，正式路径为 Host → Gateway `/codocs/ws` → 独立 `hzy-collab.service`（`127.0.0.1:31007`）→ Runtime；Console 内嵌 Collab 保持 `CONSOLE_COLLAB_MODE=disabled`。服务身份为生产 `collab.runtime`（`aud=data-runtime`，仅 `codocs:collaboration-snapshots:read|publish`，绑定 `${tenant}-collab`），注册与 grant 见 `console/scripts/collab-prod-registration.mjs` 与 G-7 目录（可选 `bindings.deployments.collab`），令牌签发探测含 2 个正例与 15 个反例（错 audience/来源/租户/部署/能力、Enterprise 不得持有 Collab scope）。Runtime 还要求 `deploymentBindings.collab` 等于该部署码、`snapshotV2Enabled` 与 `collaborationV2Enabled`；Host 需 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`、`HZY_ENTERPRISE_CODOCS_COLLABORATION_V2` 与运行期覆盖 `NUXT_PUBLIC_CODOCS_COLLABORATION_V2`（页面开关由构建期环境派生，发布构建不设置它们），模板默认全部 `false`。Gateway 对无 `Upgrade` 的普通 `/codocs/ws` 请求直接返回 426。schema 安装清单见数据迁移 runbook §3a，快照桶“版本 ID + 写一次”实测方案见 [Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan](./Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan.md)，两者均待批准、未执行。

#### Codocs v2 快照文档的非 Host 正文消费者（批次 H1b，代码已实现，随协作开关生效）

依据 [正文消费者盘点](./Codocs-Collaboration-Body-Consumers-Inventory.md)：v2 文档的**权威正文是发布头指向的精确对象版本**（校验长度与 SHA-256），`documents.oss_path` 仅是尽力而为的派生镜像；不做异步镜像（Q9）。**不新增 capability、grant 或 schema。**

- **Runtime 计划变体**：发文归档计划在无冻结副本且源为 v2 时返回 `sourceBodyRef` 并置 `sourceOssPath=""`；组织资产快速发布计划（独立端 `company-assets/quick-publish/prepare` 与 Host `enterprise.codocs.quick-publish.prepare.v1`）对 v2 源项返回 `bodyRef`、`sourcePath=""`，并在源文档行锁下复核 head 仍为规划时的 generation（否则 409 `document_snapshot_changed`）。`bodyRef` 形状 `{generation,epoch,markdown:{key,version},size,sha256}`，v1 与已存旧计划仍按 `sourcePath` 重放。**Host 的快速发布复制需读取 `bodyRef`（本批次未改 enterprise/**）。**
- **独立端元数据**：`GET /v1/codocs/documents/{uuid}` 与开放部门单文档读取带 `snapshot_generation`（0=v1）；`/v1/codocs/documents?oss_path=…&include_snapshot_ref=1` 及受信单文档读取（`include_snapshot_ref=1`）返回 `snapshot_ref`，仅服务端调用方使用，独立端转发中间件不允许浏览器索取。独立 Codocs 对 v2 文档的打开/下载/批量取正文/复制/版本查看/开放部门预览/`GET /api/v1/documents/{uuid}/content`/周报修订，以及 `PUT` 带正文（**在任何 OSS 写入之前**）一律 409 `document_on_snapshot_v2`（Q2）；仅改标题等元数据仍允许。
- **发文冻结顺序（Q6）**：`POST /api/reviews/publish-requests` 先 `readonly_flag=true`（Runtime 同事务推进 epoch 并撤销协作会话），再读取冻结稿；v2 的冻结稿由精确快照生成，读取失败则取消申请并 503，不回退镜像。归档执行按 `sourceBodyRef` 读取精确版本。
- **服务内容授权（Q7）**：Aims 项目文档、Altoc 实体文档、产品文档内容授权与项目文档评审版本内容对 v2 文档返回 409 `document_on_snapshot_v2`，不再交出过期的 `ossPath`。项目仍可引用 v1 的部门/私人文档；未按“类型”整体拒绝部门文档以免回退既有引用能力。
- **转换白名单（Q4）**：部门协作会话/转换拒绝 `oss_path` 含 `/weekly-reports/` 的文档（403 `department_document_not_collaborative`）；`company/knowledge/product/project/slide`、`status<>1` 与归档物本就不满足部门协作门槛。
- **管理端图片清理**：引用判断读取所属文档的精确快照；v2 无法读取或校验时拒绝删除（503）。`cleanup-yjs` 排除 `codocs/snapshots/`。
- 回滚到 v1 所需的镜像重建脚本（Q8）属发布计划，不在本批次。

#### Enterprise Host → Codocs 部门文档协作：Host 侧（批次 H1a，代码已实现，默认关闭）

Host 端点、人员权限与转换流程见 `enterprise/docs/API_SPEC.md`「部门文档协作」。合同要点：Foundation 操作表追加 `codocs.department-documents-{collaboration-open,snapshot-read,snapshot-prepare,snapshot-publish}`，服务 capability 仍由路径域推导为 `codocs:enterprise-host:execute`，**不新增 capability 与 grant**（hzy0 egress 投影不变，且不列出这四个操作，`generate-console-egress-scopes.mjs --check` 覆盖）。Host 人员权限为 `departments:edit`（开会话、转换）/`departments:view`（读快照头、详情），permit 资源固定 `department-documents`；Host 不向 Runtime 传关系、角色、文档类型或 owner 事实，Runtime 的 Directory 关系与所有者/写分享/经理规则是最终门槛。转换请求携带稳定意图幂等键；`collaboration-open` 沿用“会话由业务键决定、票据一次性”的规则解读。正文读取一律以已发布快照为准，镜像 `oss_path` 不被读取、也不在读取时修复（个人 v2 路径同样取消读时修复）。正文引用是 Q1 决定的单一授权点：H1b 的快速发布计划已对 v2 源项返回 `bodyRef`（`sourcePath` 置空），Host 快速发布按其读取精确快照版本（校验长度与 SHA-256）、暂存到内容寻址键后拷贝；开放部门单文档读取 Runtime 已标注 `snapshot_generation`，Host 对 0 读原路径，>0 需要 `snapshot_ref`（H1c 已由 Runtime 补齐，见下）。环境（开关、Collab、`collab.runtime` 核验、schema 迁移）仍按设计文档 E-1…E-13 逐项审批，本批次未部署、未做浏览器双人验收。

#### Codocs 部门文档协作收尾：开放部门读取、回收站恢复、只读版本历史（批次 H1c，代码已实现，随部门协作开关生效）

**不新增 capability、grant 或 schema**（沿用 `codocs:enterprise-host:execute`、`department-documents` 读 permit 与既有迁移）。

- **开放部门读取（A6）**：企业 `open-department-documents:view` 的 Runtime 查询由服务端追加 `include_snapshot_ref=1`（浏览器 `query` 白名单不含该键，`list` 也不带），v2 文档在元数据中带 `snapshot_generation` 与精确 `snapshot_ref`；授权、部门范围与 permit 动作（`read`）不变。Host 对 `snapshot_generation=0` 读原路径，>0 按引用读取精确版本，缺失引用仍失败关闭。
- **回收站恢复（A9/A10/B4）**：个人与部门 `restore-plan`/`restore` 读取当前发布头代际；代际 >0 时计划带 `snapshot_backed: true`，`state_sha256` 绑定该代际（转换发生在预检与提交之间则 409 `*_state_changed`），v1 计划哈希不变。恢复**只翻转状态**（标题、目录、`oss_path` 目标沿用既有规则），不读取、不复制、不重建镜像与 `.yjs`，发布头与 epoch 不动；恢复后可重新开会话。Host 看到 `snapshot_backed=true` 跳过存储阶段，不再因镜像缺失误报“正文与快照均不存在”；未带该标记（v1）的行为不变。
- **部门文档版本历史（A11，Q3 首版只读）**：随部门协作三开关注册 `department-documents:versions` 与 `:version-view`（读 permit、`departments:view`，Foundation 操作 `codocs.department-documents-{versions,version-view}`，hzy0 egress 投影排除）。Runtime 先校验部门读关系与文档归属（`doc_type=department` 且 `dept_code` 相符），再由 Codocs 适配器在精确部门读取上下文下返回 `document_versions` 行；Host 读取行内 `object_key`（必须位于 `codocs/snapshots/`）或 v1 行的 `oss_path` 对象的指定版本并校验长度与 SHA-256。无回滚、无删除、无差异；页面对部门文档隐藏差异入口，只读成员可查看。
- 验证：Runtime 单元与隔离 MySQL（Directory 与 Codocs 分 schema：镜像路径与 `recycle.bin/` 路径的 v2 恢复、v1 对照、陈旧哈希、非经理与错部门、无分享部门成员读取版本历史）；Host 恢复与版本桥接测试；Foundation 操作表与 egress 生成器 `--check`。

个人协作首次打开（AR09）：Host仅在`personal-documents:collaboration-open`已复核当前写ACL并返回精确409 `document_not_on_snapshot_v2`后转换generation0。权威个人文档元数据、旧正文与静默窗口检查沿用部门转换；通过已有snapshot prepare/publish，以actor/tenant/deployment/UUID/epoch/正文摘要生成稳定键，CAS 0→1，失败同键重试。仅精确snapshot_generation_conflict可在重新授权读取已发布head后加入；并发出版使updated_at变新而触发document_v1_collaboration_active时，也须重新读取head证实已v2才可加入，其他失败原样拒绝。已v2直接申请ticket；普通GET绝不转换。只读/撤权/回收仍在Runtime文档锁下拒绝，Collab握手ACL不变，无新增操作、capability/grant/schema。大图/表格Markdown完整字节保留，仍受10MiB正文上限。

### FE-2 产品资料只读闭包（C000001 MVP 候审）

Enterprise Host 的 `GET /aims/api/v1/products/{productCode}/roadmaps/documents`、`/requests`、`/search`、`/content` 对应 Runtime 的 `POST /v1/enterprise/aims/product-documents:list|requests|search|content`，四个操作均要求精确 `aims:product-documents:read` 服务能力和签名 actor。Host 从 Aims 产品授权事实与 Foundation Console scoped 授权先判定 `products:view`（不可见为 404），再判定 `product_documents:view`（可见但无资料权限为 403），才准备对应 Runtime 许可；依赖故障为 503。Runtime 绑定 tenant、Host deployment、actor、产品编码及 15 秒内有效的 `product_documents:view` permit，在 Registry 读取事务内重验产品对象权限与关系；请求状态只返回申请编号、用途、状态和是否关联，不返回文档 UUID。

列表和名称搜索只遍历 Aims 产品关系，再逐条调用 Codocs 当前 owner/share/relation ACL；受限文档从结果中剔除，且不公开受限计数。正文先重验同产品未移除关系和 Codocs ACL，Runtime 只把存储路径交给受信 Host；Host 下载后复查产品权限、关系、Codocs ACL、存储路径与更新时间，只返回正文和必要展示字段。客户端不能提供文档 UUID 或存储路径作为读取依据；该限制只针对正文读取。候选 grant 的 seed/verify 位于 `console/docs/sql/Console-SQL-{Seed,Verify}-FE2-Product-Documents-Read.sql`，只初始化缺失的 `enterprise.runtime` 双 Runtime audience 精确 read grant，不恢复被撤销项。

### FE-2 后续 #7：现有文档与项目产品关系写入（阶段 A 候审）

Enterprise `POST /aims/api/v1/products/{productCode}/roadmaps/documents` 仅接受既有 Codocs `documentUuid`、用途、预期产品修订及 `Idempotency-Key`。Host 在签发 `aims:product-documents:create` 前，以 Foundation/Console 产品对象事实判定 `products:view` 与 `product_documents:edit`；Runtime 绑定签名 actor、tenant、部署和短时 permit，先重验 Codocs 当前 ACL，再复用 Aims `CreateProductDocument` 原子命令。关系写入不授予 Codocs 正文或分享权限；同键同 payload 返回原 receipt，旧修订或重复关系为 409。模板创建、用途编辑、解除/恢复关联均不在本闭包。

Enterprise `GET/POST /aims/api/v1/projects/{id}/products` 分别要求 `aims:project-products:read|create`，Host 先查 `projects:view|edit`，POST 再查目标 `products:view` 的当前对象事实；缺权拒绝后才签发 Runtime 许可。Runtime 用签名 actor 重验项目成员/经理与产品事实，只允许活动的产品研发项目关联现有产品。新增关联不指定版本；已有主产品与版本限定不变，第一个关联可成为主产品。重复关联为 409，POST 同键同 payload 以服务端 receipt 重放。由于本批没有版本 ID 输入，旧规则中版本归属和已有工作项冲突检查仅在后续版本限定操作适用；本批不开放这些操作。产品 owner 同意不是此 MVP 关联的前置条件。关联列表仍按项目成员可见性过滤，不向无权用户返回第二个项目的关系或名称。

两条写入与项目列表均为精确 Host 路由、Foundation 操作和 Runtime 路由，不接受任意旧 Aims 路径透传。候选 grant 见 `console/docs/sql/Console-SQL-{Seed,Verify}-FE2-Followup-7-Product-Links.sql`；阶段 A 代码不表示环境已发布。

## Gateway 断言 keyset（候选、默认关闭）

员工会话以显式 `ops.deployments:deploy` 经 Platform gateway-keys 命令登记公钥，
复核 active deployment site 与冻结 site_code/tenant/environment；轮换修订与审计同一事务。
Gateway 公钥 FK deployment_sites.id，既有 gateway_deployment 字段承载 site_code；
不新增应用/订阅/部署，不进入目录、权益或策略包；员工 identity 导出严格核对 public_url host。
Runtime 经独立 `GET /api/v1/runtime/gateway-keyset` 用已登记控制 token 读取同租户/环境
的 Platform 签名清单，以操作员预固定公钥验签，不从无签名 heartbeat 换根。
严格复核 Runtime/Gateway 绑定、时间、单调 revision，0600 原子持久化；坏签名/回滚
失败关闭，重启必须成功新鲜拉取，最长缓存 5 分钟。同步默认关闭且不启用 exchange；
keyset 不是授权。代码与隔离测试不表示环境迁移/登记/上线完成，详见
[签名 keyset 合同](Gateway-Service-Assertion-Keyset.md)。

Gateway断言exchange候选：Console→Foundation `exchangeConsoleGatewayToken`→精确
`/v1/console/auth/service-tokens/gateway-exchange`，须真实console.runtime JWT和独立
`console:service-token:gateway-exchange`；Runtime自行验Gateway Ed25519签名与登记
keyset/源deployment，对照DB active client/精确grant，在同事务消费jti、签发及审计。
新路径默认关闭，Console不替Gateway验签、不传私钥/可信布尔值；仅503
`gateway_keyset_unavailable`可由Gateway回原三次调用，安全失败不得降级。
每次事务清理≤100条超过30秒容差的过期replay。参见[exchange合同](Gateway-Service-Assertion-Exchange.md)；
真实Worker接线/环境grant/上线未完成，不改变原路径或默认权限。

Gateway断言第四批签名：Tenant Gateway仅对原内部凭证已验证、registry源部署精确匹配的JSON无密钥请求签独立Ed25519 proof；员工导出的Gateway登记绑定限定租户/环境，Runtime仍自行验固定根keyset及grant。签名lane剥离入站proof/Gateway头并以显式受信头白名单经Console Binding转发；唯一Foundation回退helper只匹配503专用机器码。Console proof存在而开关关闭时明确disabled、不得静默旧路径。先Runtime keyset→Runtime exchange→Console开关→最后Gateway lane，回滚先关Gateway；全部选中grant缺绑定先报告。详见 [第四批上线计划](Gateway-Service-Assertion-Rollout.md)。

### 企业部署中的 Workflow 通知操作目标（2026-09-26）

Console runtime config 目录与通知目标目录复用验签 `moduleAvailability` 投影：未部署项无可执行 home，已部署事实随目录返回。单任务 Workflow 通知在受验签目录的 Enterprise 为 active+deployed 时，使用目录绑定的 `/enterprise/approvals/{taskId}`，`actionTargetAppCode=targetAppCode=enterprise`；业务来源仍在 `businessTargetAppCode`，资格 purpose 与审批敏感动作/受托人校验不变。无可信部署证据则保留 Workflow 回退；矛盾目录或 Enterprise home 无法解析时失败关闭，不回退绕过。实例/并行多任务/状态通知在 Workflow 具备受信且已部署 home 时保留原 Workflow 实例链接；仅当 Enterprise 为 active+deployed 而 Workflow 无受信入口时，回退到同一 Enterprise home 下的宿主审批列表 `/enterprise/approvals`（`actionTargetAppCode=enterprise`，固定日志 `workflow_action_target_host_list_fallback`），不新增宿主实例详情路由；两者均不可信时失败关闭。Console 继续严格校验注册 home 的 origin/basePath，不信任通知请求提供的地址。

### Enterprise 原生项目可访问文档读取（2026-09-26）

Host `GET /aims/api/v1/project-documents/accessible` 使用 Foundation `aims.project-document-accessible-list` → Runtime `POST /v1/enterprise/aims/project-documents:accessible`；精确业务 capability 为 `aims:project-documents:read`（business 格式），Host 先检查 `projects:view`，短期 permit 绑定签名 actor、项目、租户与 Host 部署。Host 复用 Foundation 当前项目 `projects:admin` 求值，permit 内 `projectAdmin` 以目标 Runtime Token 的独立 HMAC 签名覆盖全部 permit 字段、方法和精确路径；Runtime 拒绝篡改、跨项目及过期。该管理员事实仅作用于当前项目，部门和成员关系仍由 Runtime 自读。请求仅包含 `projectId/tenant/deployment/authorization`，不接受 UUID 候选、角色、部门或项目关系事实。

Runtime 由 Aims 读取项目可见性、活动成员、项目候选、工作项里程碑和完整分页成果，再内部调用 Codocs 既有 `documentAccessCheck` 策略核心。目录事实由 Runtime Directory 读取当前用户主部门及其负责部门的下级范围；不存在额外 Codocs Service API、来源身份改写或任意 UUID 能力。缺失/明确拒绝的引用省略，仓库引用仍按项目成员关系，祖先目录与成员空目录保留；依赖失败返回整列表 503，分页最多 100×100，超限不返回部分结果。独立 Aims 路径不变。当前本机仅使用 data-runtime：v2.23 安装 Enterprise 的 `data-runtime:aims:project-documents/read` 物理行，以 audience+semanticScope 映射原业务 scope；tenant-runtime 待实际使用时安装。

## Console 批次 A 用户页面组合（2026-09-26）

Enterprise `/enterprise/notifications[/:notificationId]` 与 `/enterprise/todos` 原生页面共用 Foundation NotificationCenter/TodoList，Console 旧页面继续消费相同组件并保留原路由。只新增 `GET /enterprise/api/notifications/todos` 薄用户 BFF：验证现有 user 上下文，严格白名单 todoKind/cursor/limit（1–50），经既有 `fetchConsoleNotificationsForUser` / Console binding 调 Console `/api/v1/console/notifications/todos`。通知其他操作复用既有 Foundation 通知处理器（Host 经 `/enterprise/api/foundation/notifications/**`，见下节 G-12），来源对象授权和幂等写回执不变；无新 capability/grant/Runtime 操作，也不把服务 token 当用户。上游 401/403/503 透传，响应禁止共享缓存。Host 通知抽屉“查看全部”及工作台“我的待办”通往新页面；来源 action URL、旧 Console 重定向、密码/头像/会话与后台任务不在本步骤。真实环境与视觉验收另行记录，页面注册不代表已验收。

### Enterprise Host 共享用户 API 基址（G-12，2026-09-29）

租户网关（Cloudflare Worker 与自托管 Gateway 同源拓扑）把根路径 `/api/*` 交给 Console，而 Console 不识别按应用命名的 Host 会话 Cookie，Host 页面经根路径调用 Foundation 用户 API 会得到 401。Host 因此在自身保留基址 `/enterprise/api/foundation` 下提供 Host 页面实际使用的 Foundation 用户 API；Foundation 浏览器侧 `sharedApiPath('/api/…')` 仅在 `appCode=enterprise` 且构建期 public `sharedApiBase` 恰为该值（Host pilot 构建）时改写路径，其他应用与非 pilot Host 保持根路径合同。不用 `/enterprise/api/<op>` 直挂，是因为 `/enterprise/api/directory/{users,departments,projects}` 已是 Console 管理页 BFF（需 `directory_*:view`），而选择器查询面向所有已登录员工，两者语义与权限不同。

| 方法 | Host 路径（`/enterprise/api/foundation` + ） | 复用的处理器 |
| --- | --- | --- |
| GET | `/workflow-proxy/instances/by-biz`、`/instances/by-biz-history`、`/instances/:id`、`/tasks/pending`、`/tasks/:id` | Host `enterpriseWorkflowProxy`（与根路由相同操作） |
| POST | `/workflow-proxy/tasks/:id/approve`、`/tasks/:id/reject` | 同上，保留 `Idempotency-Key` |
| GET | `/notifications`、`/notifications/summary`、`/notifications/:notificationId/detail` | Foundation `server/api/notifications/**` |
| POST | `/notifications/read-all`、`/notifications/:notificationId/read`、`/notifications/:notificationId/archive` | 同上 |
| GET | `/user/applications` | Foundation `server/api/user/applications.get` |
| GET | `/directory/me`、`/directory/users`、`/directory/departments`、`/directory/projects`、`/directory/business-domains` | Foundation `server/api/directory/**` |
| POST | `/directory/users/batch` | 同上 |

- 授权：Foundation 处理器原样复用（通知详情仍由 Console 端 verifier 链实时授权，写操作幂等回执不变），Host 仅在其前加 `requireEnterpriseUser`，与其他 `/enterprise/api` 路由一样要求已验证 Host 会话（access token、tenant、deployment，Gateway 上下文须为 enterprise）；不新增 capability、grant 或 Runtime 操作，不从 Header 取身份。根路径同名接口保持现状（hzy0 兼容与非 pilot Host）。
- 精确登记：Host 路由文件、`enterprise/composition/business-api-routes.generated.mjs` 就绪边界与 `deploy/test-env/enterprise-topology.mjs` 按 METHOD + 路径一一对应（`enterprise/test/host-shared-api.test.mjs` 做漂移检查）；基址下其他路径或方法由网关返回不可用。新页面若使用未登记的 Foundation 用户 API，需同时补 Host 路由与拓扑，否则按 `enterprise_module_runtime_not_ready` 失败关闭。
- 图标：pilot Host 的 Nuxt Icon `localApiEndpoint` 为 `/enterprise/_nuxt_icon`（公开 JSON，网关按 asset 转发并剥离 Cookie）。
- 认证入口仍为 `/enterprise/api/auth/*`（网关改写为 Host 根 `/api/auth/*`），唯一例外是下节的 `GET /enterprise/api/auth/permissions`（Host API，不改写）；头像 `/api/oss/avatar` 与 RUM `/api/rum` 仍归 Console/观测入口，不依赖 Host 会话。

### Enterprise Host 浏览器权限快照（2026-09-28）

此前 Foundation `useAuthorization` 在 Host 请求 `/enterprise/api/auth/permissions`，网关改写为 Host 根 `/api/auth/permissions`，Host 无此路由而命中 SPA 回退（200 HTML），被静默当作空快照，导致组合页面所有 `hasPermission` 为 false（服务端判权本身正确）。现合同：

- `GET /enterprise/api/auth/permissions?app=<module>`：`requireEnterpriseUser` → 严格 `app`（唯一 query 键、单值）→ 可选 verified-policy gate → Foundation `loadAuthorizationSnapshotFromConsoleRuntime(uid, app, event)`，与 Host 服务端 handler 判权使用同一普通合并快照（不传角色选择、localDev 或管理员扩展）。`app` 白名单由生成的 `enterpriseNavigation.navigationSources`（即组合注册表 `navigationContributors`：aims/assets/codocs/console/altoc）派生，不手写；未知/重复/多余参数 400（先验证会话，未登录一律 401）。返回 `{ code: 0, data: { appCode, uid, roles, availableRoles: [], activeRoleCode: '', resources, actionPolicies } }`，`private, no-store`；Console 依赖失败或快照无效一律 503 `enterprise_authorization_unavailable`，上游 401/403 保留，绝不返回空 200。
- 按模块而非合并：不同模块资源码可重名（如 `products`），浏览器按页面所属模块分别请求并分别缓存。页面归属来自构建期路由 meta `authorizationApp`：业务页由 `registerBusinessPages` 按模块写入，Host 原生页由 `annotateHostNativePageAuthorization` 依已校验的原生页投影（Console/Altoc）写入；无归属的 Host 页面（登录、审批、工作台）不请求模块快照。浏览器快照只是 UI 提示，Host 各 handler 仍逐次服务端判权。
- 网关：`deploy/test-env/enterprise-topology.mjs` 对该精确路径（仅 GET）返回 `kind: 'api'`，其余 `/enterprise/api/auth/*` 仍按 auth 改写；Cloudflare 与自托管网关共用该拓扑。
- 失败可见：Foundation 校验响应信封（对象、`code === 0`、`data.resources` 为动作数组映射、Host 下 `data.appCode` 等于请求模块），否则置 `error` 并以空快照失败关闭；Host 布局显示“权限信息加载失败”与重试。Host 未登记的 `/enterprise/api/**` 由就绪中间件返回 JSON 404 `enterprise_api_not_found`；经 auth 改写到达 Host 根 `/api/**` 的未登记路径由 `server/routes/api/[...].ts` 返回同一 JSON 404。该兜底文件不计入就绪清单，业务模块前缀仍保持 503 `enterprise_module_runtime_not_ready`。
- 不新增 capability、grant、Runtime 操作或 Console 接口；独立应用 `/api/auth/permissions` 合同不变。

### Console 管理页 Host 读取（已撤出，2026-10-01）

ADR-018a D8：Console 保持独立管理控制台。原 Host 企业资料、目录（用户/部门/项目/委员会读写与同步）、工作日历、C1 当前公司配置与 C2 运行状态的 `/enterprise/api/{org-profile,directory,work-calendars,organization,runtime-status}` BFF 及对应页面已删除，Foundation 已登记 Console 用户 API 只剩 `notifications.todos.list`；Console 中间件对 Host 应用令牌的放行随之收窄。管理一律在 `/console/` 进行。Enterprise 个人菜单的“控制台”入口复用上节 `GET /enterprise/api/auth/permissions?app=console` 快照，以 `console_overview:view` 决定是否显示（UI 提示，Console 页面自行判权），不新增接口、capability 或 grant。Gateway（`deploy/test-env/enterprise-topology.mjs`）对未登记的 `/enterprise/*` 页面路径（仅 GET/HEAD、安全字符、非 API）返回 Host page，由 Host 404 页提供“回到工作台”；API、写方法与非常规路径仍 unavailable。

### PA-03 Enterprise 项目写授权候选

项目基本信息与成员add/role/remove保留原精确capability、业务输入、人员有效性、幂等回执和审计。Host读取Runtime完整项目对象后经Foundation `loadProjectWriteAuthorization` 调Console scoped projects:edit，发出 `static-or-project-manager` 短期许可：静态allowed仅代表对当前对象的真实范围求值；false时仅由Runtime在项目行锁内检查当前leader或status=active的manager。两分支按OR判定，不把普通member/viewer升级为经理。未知模式/跨actor、租户、部署、项目、动作/过期许可403；Console失败503。

Runtime在幂等回执读取前复核当前关系，已撤经理不能重放旧结果。旧无mode的allowed=true许可保留原经理门槛，避免旧Host未做对象范围求值时获得新静态通道。静态许可不携带客户端关系事实；同键payload不同仍409，旧revision仍409，leader不可移除等领域守卫保持。详情的canEditProject只贡献当前项目编辑发现入口，服务端每次重新授权。

本候选未增加manifest/grant/schema，需新Runtime与Host一起按本地部署关口启用，再重跑M/R；PA-01列表/详情/写/导出完整范围投影仍独立待办，不能据此标记所有范围合同生效。

### PA-01 第1批：项目范围事实投影（尚未接入业务读取）

Foundation `compileFoundationProjectScope` 接收 Console 已按角色合并/模拟/有效期筛选的 grant，与 product 投影一样逐个有限事实调用现有 scoped evaluator，保留权限与三组范围的授权单元绑定。支持已登记的 tenant:global、project:code/member/owner、department:self/tree、subject:self，以及当前 C000001 projects:view 基线的 relation:participant；未知谓词或超过4096单元返回null，调用方应503失败关闭，不能截断或删除范围。

投影version=1包含按UTF-8字节排序的project_codes、department_codes、department_tree_roots和扁平masks。项目/部门索引0表示未登记编码；单元索引为`((projectIndex*(departmentCount+1)+departmentIndex)*2^rootCount+ancestorMask)`。每个单元16bit对应四个独立事实（active成员、负责人、创建人、显式participant）；state分别按1/2/4/8组合，再读`mask & (1 << state)`。部门树位来自真实祖先集合，部门本身等于root时由Foundation evaluator固有规则处理；不把company可见、manager或member自动等同participant。`subject:self`取created_by，缺失时按既有对象helper回退leader；project:owner取leader，两者不得混同。

Go `internal/projectscope`仅严格验证形状/边界与选择事实结果，不解释角色/动作/策略。TS与Go共用`foundation/test/fixtures/project-scope-projection.json`，验证项目263精确范围、部门树AND成员、创建人与负责人独立。投影本身不构成许可：后续接线必须签入actor/tenant/deployment/action/对象及policy revision/hash绑定、≤15s且不越过源授权有效期的permit，Runtime自行读取当前事实。该批未改变列表/详情/写入访问，也未改company语义、manifest、grant、schema或环境；第2批前须提交真实数据改前/改后矩阵并裁定意外访问损失。


### PA-01 第2批候选：项目公开读取与范围执行（2026-09-27）

**有意设计：范围view不隐藏company公开项目。** company可见性且密级L0/L1时，持有任一有效projects:view（含按现有策略蕴含得到view）的主体可读，不论该view的范围。完全无有效view仍403；未知/不可表达谓词仍503失败关闭，不得利用公开例外跳过编译。非company（含project_team、department、whitelist；现行schema无private枚举）保留原可见性/安全级别约束，并与同一动作的Foundation范围投影相交。写入、批量与导出没有公开例外，待第3批逐入口核对。

Host列表/详情同时复核当前Console scoped grants确有view，不依赖可能较旧的聚合发现快照。scope version=1、hasViewPermission、bundleVersion/hash、policyRevision随现有签名命令一并绑定actor/tenant/deployment/projects:view；截止时间≤14秒，并截到Console从已验签payload计算的最早active源记录未来到期（保守覆盖全部源记录，不能延长授权）。缺期限/身份/绑定/投影503，不签发许可；Runtime拒绝缺scope、无view、错actor/tenant/deployment/action或过期/超过15秒许可。

Runtime participant事实=active项目成员 OR leader OR creator，全部取当前权威行；creator沿用created_by为空回退leader。浏览器不能提交participant/member/owner、部门树或SQL。部门树根由签名投影固定，Runtime内部Directory读取active父子关系派生后代；循环、过大图、依赖不可用失败关闭。项目/部门编码及身份比较用BINARY/TRIM，保持Foundation精确区分大小写。

两个读取入口仅经Server认证后注入内部context：旧独立Aims无该context时路径行为不变，HTTP query不能设置context。列表COUNT与LIMIT/OFFSET之前、详情主行SELECT都使用同一SQL投影条件，不读取全库再JS筛选；非公司范围外详情404。无新capability/grant/manifest/schema。仅候选代码，统一Runtime/Host上线与浏览器回归另经审查。


### PA-01 第3批A：嵌套项目读取许可（候选）

项目成员、计划milestones/items、看板、需求list/view保留各自业务资源许可，同时在同一签名命令中增加 `projectReadAuthorization`：复用 projects:view 完整范围投影、策略version/hash/revision与≤14s源期限，并额外绑定精确projectId。Runtime在任何子资源查询前拒绝缺失/错项目/错主体/过期许可；目录树事实不可取得503。查询参数或客户端关系事实不得替代许可。owning Aims先以原可见性AND投影SQL验证项目，旧admin标志不能绕过非公开范围，再进入原子资源处理（原业务人员/对象归属检查不删）。company L0/L1公开读取例外仍仅在此读许可生效，写/批量/导出不得使用它。

项目计划按页≤100读完；响应未声明total时继续到短页，100页上限失败关闭503而不返回部分结果。其他嵌套业务与写命令逐入口在后续小批接线；本批不新增服务scope、grant、manifest、表或导出能力。部署须Runtime与Host配套切换，旧嵌套permit无兼容放行；候选在独立worktree，不影响现行hzy0。


### PA-01 第3批B候选：工作项新建、基本编辑、版本关联

这三个 Host 命令仍使用各自既有 capability，人员动作分别为 work_items:create/edit/edit；Foundation 从该动作自身的同源 grants 编译项目范围投影，不以 projects:view 或公开可见性代替写授权。签名许可同时绑定 actor/tenant/deployment/projectId/workItemId/action、策略版本/hash/revision 与不超过15秒的期限。缺投影或策略事实403；无法表达范围或缺部门树权威事实503。

Runtime 在 owning 事务中先锁项目，再读当前 active 成员/leader/creator 与工作项项目归属，选择投影并保留原业务关系门槛（新建为经理/leader，编辑/关联为 active成员/leader）。company L0/L1无写例外。该复核位于 ExecuteInTransaction 读取既有回执之前，因此同键成功回放也必须满足当次许可和当前关系；许可不纳入业务幂等摘要，以允许同业务命令更新短期许可后安全回放。跨项目ID和过期许可失败关闭，拒绝时无业务/回执变化。

这里只迁移 create/edit/associate；状态、完成/replay、批量与其它领域命令仍在后续小批，不宣称已全部 scoped。独立旧库命令未携此可信 Enterprise 投影时保留其现有领域门槛；Enterprise HTTP 入口这三动作必须携带投影，无旧 permit 降级。无新能力、grant、schema 或导出入口。候选需审后 Runtime/Host 配套切换。

### PA-01 F1：项目创建/删除、事项删除与批量修改的范围复核（候选）

项目创建的 `projects:create` 短期签名许可绑定最终 `projectCode`、`deptCode`、actor/tenant/deployment、策略版本/hash/revision 与项目范围投影。创建前尚无关系行，member/owner/participant/subject:self 一律为 false，请求中的负责人不能为自身产生授权；空部门只能匹配不含部门约束的范围。Runtime 在读取旧幂等回执前按拟建 code/部门求值，部门树只取目录权威事实，撤权后的同键续行失败关闭。独立的人员/负责人校验仍须通过。

项目删除保留既有特权能力与草稿限制，额外要求 `admin:admin` 的项目范围许可；事项删除要求自身 `work_items:delete` 范围许可。两者在事务和旧回执读取前按当前项目事实复核，project_team/private 写入不借 company 公开读取例外。批量修改要求 `work_items:edit` 的同源投影，在单个事务中对所有 owning project 逐一锁定和预检，再锁定全部事项并复核归属；任一越权、缺失或归属变化整批回滚。旧独立 Aims 路径仍执行原领域门槛。此候选不增加能力、grant、schema、导出或新的删除入口，需 Host/Runtime 配套上线。

### PA-01 F2a：目标任务树分配与确认范围复核（候选）

Host 的 `append-tasks`、`breakdown`、`confirm-distribute`、`revoke-distribute`、`confirm-append`、`reject-append` 使用各动作原有的 `work_items:edit` 或独立 `work_items:confirm` 人员授权编译项目范围，签名绑定 actor/tenant/deployment/项目/目标/策略版本和不超过 15 秒的期限。Runtime 在旧回执读取前，于同一写事务锁住项目与目标并按当前关系事实重算范围；company 公开读取例外不适用于此处。原项目经理、审批确认和状态前置条件各自保留，不把确认能力视为编辑能力。任务树变化前锁定并核对全部将受影响的子事项归属；若出现跨项目子项，整笔拒绝且不产生回执或部分写入。独立 Aims 旧入口仍走原领域规则。此批不新增能力、grant 或 schema。

### PA-01 F2b：需求分解提交与模板克隆范围复核（候选）

Enterprise Host 的两条既有工作项分解写路由继续要求 `work_items:edit` 人员授权，并增加同一 Foundation helper 编译的签名项目投影；许可固定绑定受验签 actor/tenant/deployment、源工作项 ID、策略版本与不超过 15 秒的期限。Host 不从浏览器接收项目范围事实。Runtime 由源工作项权威行取得 owning project，在写事务中先锁项目和源事项、重算范围与当前经理关系，再锁定并读取最新源字段后创建目标/子项；范围外 company 项目也不能写。原模板类型、锚点、工时和经理规则保留。独立 Aims 路径没有 Enterprise 投影时仍执行原领域门槛。两路既有命令没有 service-command receipt，本批不宣称响应丢失后的同键重放保证，归入 PA-04 后续。

### PA-01 F3：事项工时三写范围复核（候选）

事项工时 create/update/delete 与项目工时三写使用同一个 `timesheet:submit` 人员动作与 Foundation 项目范围投影，签名绑定 actor/tenant/deployment、源工作项 ID、指定工时 ID、策略版本事实和不超过 15 秒的期限。Runtime 从权威事项行取得 owning project，在同一事务中依次锁项目、当前成员、事项及目标工时，复核范围与事项/工时归属后再写；范围外 company 项目只有读例外，不能写。原 active 成员/owner、草稿或退回状态与工时数值规则仍保留，独立 Aims 旧入口无 Enterprise 投影时按原领域规则执行。三条既有工时命令尚无 service-command receipt，列入 PA-04，不宣称同键回放保证。

PA-04 B2 已为 Host 通道的事项工时三写加入目标事务内 service-command receipt。写入和同键回放都要求当前项目 active 成员、负责人、经理或 scoped admin，与独立 Runtime 的 `requireProjectMemberOrScopedAdmin` 门槛对齐；已暂停的成员不能再写入或回放自己的事项工时。校验在回执读取前执行，独立 Aims 入口的原领域规则不变。

PA-04 C 的需求分解同键回放使用与业务写同一事务插入的 `project_activity_logs` 审计记录 ID 标识**本次执行**。同一源可在新的章节锚点再次分解，`decomposition_source_id` 只表示溯源，不是批次 ID；子项自增 ID 区间也不作批次标识。审计 `changes` 记录本批子项 ID 和本批工时 ID；回放先复核当前 scope、成员和经理，再要求审计的项目、源、动作、actor、请求键与回执一致，缺失或损坏固定返回 `409 receipt_result_unavailable`，绝不重新写入。回放只读取本批且当前仍属该项目的子项，已删除或移往别的项目的子项不返回、不重建；本批工时若已离开项目则 `timeEntryId=null`；源状态取当前值。同键只保证无重复副作用，**响应是当前状态，不是冻结快照**，客户端不能要求与首次响应逐字节一致。Host 收到 `receipt_result_unavailable` 时只提示“该操作已提交，请刷新查看”并返回详情刷新，不自动换键重试。现有 Runtime、独立 Aims 与运维脚本未发现删除或改写 `project_activity_logs` 的生产路径，表对项目的外键为 `ON DELETE RESTRICT`；若运维清理审计行，旧回执将冲突关闭。独立 Aims 分解入口仍保留原有写合同。

PA-04 D1 的 Host 里程碑新建、编辑、删除和需求变更目标新建使用每次用户意图独立的 Idempotency-Key；同键同载荷的 service-command 回执与业务写在同一事务提交，异载荷为 409。回放前重新复核当前项目范围与经理或 scoped admin 门槛，撤权不能取回原成功结果。删除后的里程碑只通过已成功回执定位原项目，重新核权后返回删除回放，不重建对象；目标新建回放从当前项目内的工作项重建响应，已删除目标只返回已删除标志。独立 Aims 无 Host 上下文的入口保留原行为；人工 rollover 继续使用原周期快照合同。无新 capability、grant 或 schema。

PA-04 D2 的 Host 项目仓库关联/解除使用各自的用户意图键；GitLab 手动同步由 Host 先用既有只读凭据拉取，再按本次观察到的批次内容生成稳定键，Runtime 只负责入库。仓库关联、解除、GitLab 批次入库与各自的 service-command 回执在同一事务提交；回放前复核当前项目范围、经理或 scoped admin 门槛，GitLab 批次另复核每个仓库仍属于当前项目。异载荷 409、撤权或仓库关系失效均不回放旧结果。仓库回放的 `linked` 返回当前关联状态，页面成功后重新拉取列表；旧解除键不能删除后来重新关联的仓库。同步命令的回执只存批次内容哈希和提交数，不复制提交消息或邮箱；Runtime 不外发 GitLab 请求，原独立 Aims 通道保留旧行为。`commit-files-changed` 是对当前提交的绝对值覆盖，同值重复写天然不产生额外副作用，因此不加 service-command 回执；更新前在同一事务内锁定并确认提交仍属当前项目和事项，同值重写返回成功，跨项目/事项为 404。无新 capability、grant 或 schema。

### Altoc G1：Enterprise 基础只读闭包候选

Host 六条 `/altoc/api/v1/{customers|contracts|payments}` list/detail GET，经 Foundation 固定操作访问已登记 `/v1/enterprise/altoc/{customers|contracts|receivable-plans}:{list|view}`。人员动作取 Altoc manifest 的 customer/contract/receivable:view；服务能力取同资源三条精确 capability。Console当前scoped授权编译许可，原owner/dept/催收关系由 owning reader 当前行判断；不继承客户view给合同，也不借回款许可返回关联主档动态名称。

许可身份/对象/query/范围/策略字段由现有项目文档 `signHmac` 机制独立签署，actor委托签名同时保留。Registry持久tenant/environment/runtimeDeployment/schema/generation栅栏先于业务SQL，COUNT分页同WHERE/snapshot；只解析Altoc Read与七张物理表白名单，不访问Finance/Codocs/Aims/Workflow、不写业务/receipt/outbox、不签文件URL。Host/BFF两层固定白名单与固定错误，private/no-store；页面直达仍由handler授权。

原独立Altoc读写入口继续保留。新增导航只是Altoc manifest贡献，不安装完整应用组合模块。三条grant仍为 `data-runtime:altoc:<resource>/view` + semanticScope，共享现时校验按已验证audience复用签发映射；环境安装由授权操作员另行执行，不得补语义重复/宽grant绕过。候选、SQL隔离测试与页面组件测试不构成环境启用或财务/履约链验收。

### Altoc G2：Enterprise 线索/商机/报价基础只读闭包候选

六 GET Host BFF→Foundation固定操作→六 `/v1/enterprise/altoc/{leads|opportunities|quotations}:{list|view}` POST。复用当前Console普通view gate/scoped授权、Altoc原scope compiler/global-admin兼容与Directory当前事实，permit取最早授权到期及14秒上界并独立HMAC签名完整query（包含opportunityId）；人员权限与服务cap分开。当前三主档自身owner/dept及quotation父子范围由Runtime snapshot读取，不继承关联客户/商机范围。

仅Altoc五表读，不读Finance/Codocs/Aims/Workflow/联系人/活动；不输出动态关联名、成本毛利、自由诊断/URL，不写receipt/outbox/状态。Host重建白名单，报价item必须父ID相同且不超过1000；固定错误/no-store。新grant保持qualified `data-runtime:altoc:{lead|opportunity|quotation}/view` + 对应semanticScope，未安装前不宣称环境启用。E1/AA-04与原独立写流程仍另审。

### P5a1 普通工时可选分页

Enterprise 本人/项目普通工时复用既有固定操作与精确读 capability，添加可选 page/pageSize≤100 及完整日期/项目汇总；无分页参数保留旧全量响应。本人所有权与项目动态范围均在 owning reader 执行，分页 COUNT/明细/DECIMAL 聚合共用 read-only RepeatableRead；不新增跨应用调用或 grant，不改变 Finance/People 全量期间消费者。字段、筛选、自然月与周日修正、日编辑全天基线见 [Aims-Time-Entry-Pagination-API](../aims/docs/Aims-Time-Entry-Pagination-API.md)。审核队列授权闭包另列 P5a2，未在本批实施。

P5a2审核队列复用现 `aims:time-entry-reviews:view`：Host 当前 Console approve OR submit 有效分支的项目scope投影与 query 独立HMAC签入专用permit，Runtime当前服务grant/actor/期限/元数据先验证、动态项目范围与reviewer_uid_snapshot再约束COUNT/page。无分页保留原形状；分页状态计数来自完整集合。浏览器仅periodKey/page/pageSize，无公开项目授权旁路；审核 POST 按下述合同启用，读取与写入分别校验权限。详见同一 [工时API合同](../aims/docs/Aims-Time-Entry-Pagination-API.md)。

#### 成员工时审核写入合同（20）

正式入口沿用 `POST /aims/api/v1/projects/:id/time-entry-reviews`，Host 固定操作 `aims.time-entry-review-submit` 仅映射 `POST /v1/enterprise/aims/time-entry-reviews:submit`；服务令牌走既有 `aims:enterprise-host:execute`，不得用旧的 `time-entry-reviews/edit` permit、`timesheet:submit`、`timesheet:admin` 或项目公开读取替代人员的显式 `timesheet:approve`。独立 Aims 的 `POST /v1/aims/projects/{id}/time-entry-reviews` 保持原合同，Host 不向它传浏览器可伪造的 `current_user_can_approve_timesheet` 标志。

- **入参与签名。** 浏览器只传 `action=approve|return`、不重复且升序规范化的 `entries=[{id,rowVersion}]`（1–100 条）、退回原因（`return` 必填，≤1000 字）及格式合法的 `Idempotency-Key`；项目 ID 来自路径。Host 从当前已验签会话读取 actor/tenant/deployment，向 Console 取 `aims/timesheet:approve` 的当前有效 scoped grants，由 Foundation 唯一 scope evaluator 编译项目投影；无有效授权立即 403，策略/目录依赖不可用 503。Host 以现有短期（≤15 秒）项目范围许可绑定 actor、租户、Host 部署、项目 ID、策略版本/hash/修订及有效期；Foundation 另以服务令牌绑定的 HMAC 签名动作、条目 ID/rowVersion、原因和幂等键；Runtime 同时校验 service grant、签名用户委托、许可 HMAC 和精确业务 `timesheet/approve`，不从 body/query/header 接受审核标志或范围事实。授权改变后旧 permit 不可用于回执重放。
- **对象与职责。** Runtime 在一个事务内按 ID 顺序锁定 owning project、当前经理/负责人/有效代理关系和所有选中 `time_entries`；在读既有幂等回执之前，对同一项目执行当前 `timesheet:approve` 范围判断（无 company 公开读例外），确认操作者当前具备该项目审核关系、每条记录属于该项目、`review_route=project_manager`、`reviewer_uid_snapshot` 精确等于 actor、首次执行时 `review_status=submitted`、`row_version` 等于请求值，且每条 `uid` 不等于 actor。不得用 `timesheet:submit` 的被分派队列读取分支取得审核权。任何一条失败整批不写、不留成功回执；已失权的旧键也不得重放。项目不存在/不可见与跨项目对象按 404 处理；已知项目但缺 approve/项目范围/经理关系为 403；自审批为 403。**已知限制：**经理更换后，旧经理快照名下的 submitted 工时不会自动转给新经理；现有独立 Aims 只在提交时写 `reviewer_uid_snapshot`，审核时精确比较该快照，没有重新分派命令。本批不扩展分派语义，存量悬挂项单列后续治理。
- **事务、回执与审计。** 复用 Aims 已有 Host 写入的 `service_command_receipt` 与 `ReceiptRepository.ExecuteInTransaction`（项目成员/项目工时同一机制），不新建回执表。同一事务内更新全部审核状态与 rowVersion、追加每条 `time_entry_review_events`（actor、动作、原因）、写入持久幂等回执；不发跨应用 outbox。回执身份至少绑定已验证 tenant/deployment/actor、项目、`Idempotency-Key` 与版本化审核命令，冻结规范化 payload hash 和结果。相同键/相同 payload 仅回放原结果，不重复事件；相同键/不同 payload 409；并发同键仅一笔提交。跨键竞争、旧 rowVersion 或非 submitted 状态返回 409，客户端保留原键和草稿、刷新后再决定。回执读取前仍复核当前授权/关系；审计失败整笔回滚。现有独立 Aims 审核事务只有状态/事件，尚无该 Host 幂等回执与范围门槛，不得直接透传启用。
- **读取与提交配对。** 审核队列列表每条必须返回当前 `rowVersion`；页面选择当前页记录时保存对应版本，确认/退回使用这一版生成请求，刷新后的版本不能与旧草稿混用。现有 Runtime 分页 reader 已返回 `rowVersion`，Host 页面类型也已有该字段；合同测试固定传递。
- **响应与测试门槛。** 成功 `200` 返回 `action,entryIds,updatedCount` 与可识别的 `replayed`；输入/超 100 条/缺退回原因或键为 `400`；未认证 `401`；能力、人员 approve、项目范围、职责冲突 `403`；越权或不存在对象 `404`；旧版本、状态改变、同键异体 `409`；策略/目录/Runtime 不可用 `503`。合同测试覆盖合法确认与退回、缺 approve、仅 submit、跨项目 ID、自审批、撤权后同键、同键回放、同键异体及并发，核对全部写入与事件计数。Host 页面仅在审核权限满足时展示确认/退回，失败保留当前选择与原因。

### Aims 全局周报可选分页（P5b1，2026-09-27）

既有 Host 周报 overview 固定读链/capability不变。显式 page/pageSize 启用真实 SQL COUNT/page，完整合计与四图表基于相同授权项目集合、同 RR snapshot；关键词只影响列表，不影响指标图表。搜索限 Aims 自有项目字段与周报部门/人员快照、UID/编码，Console 当前目录改名后的展示回退名不参与匹配（已批准限制），不引入目录查询或新 grant。原无页响应与导出保持全量。cumulativeLaborCost 为成本，统一两位小数且不猜币种，不再显示成人天。详细字段及兼容见 `aims/docs/Aims-Weekly-Report-Pagination-API.md`。

### Aims 项目周报分页（P5b2，2026-09-27）

既有 weekly-report-list/view 精确读操作/cap不变，可选 page/pageSize；周期列表提供独立轻量周历，周期详情提供两集合页标识/完整已保存统计/独立历史锚点，includeBaseline=1 才附完整初始化写输入。原 owning 项目范围与经理/代理判定复用，在 RR 内重验，不新增浏览器权限 flag。实际按UID工时合计仍通过既有 timesheet:view 的 time-entry-list 独立查询；只增加 includeUidHours=1 的分页摘要，不把工时许可塞入周报权限。旧无页与整份替换写合同保留，完整基线+跨页草稿不截断提交，无新增grant/环境写。见 `aims/docs/Aims-Weekly-Report-Pagination-API.md`。

### P6a 项目总览与候选分页（2026-09-27）

Enterprise 既有项目 GET/portfolios GET 复用 `aims.project-list` / `aims:projects:view` 的当前 Console 结构化 project permit；portfolios 只读响应 projectCount 为可见数，canDelete 由宿主当前 portfolios:admin 事实及 owning 完整项目存在性检查生成布尔，绝不返回隐藏计数。Runtime 按当前项目可见性+permit scope 在 RR 内执行 COUNT/page/完整组、年度、状态汇总；项目集根保留空组，独立桶及组内项目分别分页；候选角色与收藏条件在页前。真实项目集写合同及 DELETE 完整 COUNT 不变，无新 grant/Host 路径。API 字段、兼容与跨请求快照限制见 `aims/docs/Aims-Project-Overview-Pagination-API.md`。

### PA-01 第3批C候选：状态、完成申请与完成重放的范围复核

Host 的 plan-ready/start/reset/reopen、target/matter completion 与 completion-replay 使用同一 Foundation 项目命令投影 helper。状态/完成仍取 work_items:edit 自身授权，重放独立取 integration_operations:replay；不借 projects:view，也不使用 company 公开读取例外。许可绑定主体、租户、宿主部署、父项目、事项、动作及策略版本/hash/revision，最长15秒；Runtime 入口拒绝旧无范围许可。

Runtime 在 owning 事务内、查询既有 receipt 之前锁父项目并派生当前关系事实，求值动作投影并锁定事项的 project_id；范围外、错父项目与过期许可不能回放成功结果。原状态规则、成员/scoped 管理员门槛、target 负责人、matter 执行人、恢复经理与完成就绪/冻结规则保持独立；共享 scope helper 不替代这些领域门槛。旧独立调用路径不强加 Enterprise 投影。本批不修改 callback：回调继续消费已冻结申请与现有受信合同，不由审批人的项目范围替代申请人授权。

无新增 capability/grant/manifest/schema；候选须 Host 与 Runtime 配套上线。删除、分配/分解、其他领域写入及批量全事务仍按后续小批逐入口处理，不据此宣称 PA-01 全部完成。

### PA-01 第3批D候选：成果写入与批量全事务范围

项目成果 batch-create/update/delete 继续使用既有 projects:edit，工作项成果证据 update 继续使用 work_items:edit；Host 为这四条精确 delegated 操作另带 `projectWriteAuthorization`，以 Foundation 同一动作 grants 编译投影，不借公开项目读取例外。许可绑定 actor/tenant/deployment、人员 resource/action、objectId/subId、空 parent 标识（其真实项目须由 Runtime 派生）和完整策略事实，≤15秒。整个命令仍由原受信签名保护；Runtime 不信任 payload 中宣称的项目授权事实。其他 delegated 操作拒绝此额外字段，缺许可或错绑定403，部门树事实缺失503。

Runtime 将该许可安装为不可由 body/query 构造的 owning context。成果写事务先锁项目，重新派生当前关系并求值投影，再核对锁内事项/成果归属；项目成果仍需 manager/scoped admin，证据仍允许 active member/scoped admin，不将其升为经理门槛。批量项目行按ID顺序锁定，全部项目与所有成果归属在 INSERT 前复核，一项越权整批回滚。matter 的项目→事项冻结锁与 in_progress 限制不变。原独立路径保留原合同。

已知缺口 **PA-04（成果写入幂等）**：这四个既有 delegated 成果 handler 未使用 service-command receipt；本批不扩展回执体系，列入后续。每次调用（含重试）均重新复核现时范围，原重复名称/返回合同不变。不新增能力/grant/schema。Host 与 Runtime 须配套上线；里程碑、承接、工时、周报及其余工作项批量仍为后续小批。


### PA-01 F4b：事项文档关联的双重授权

Enterprise Host 的事项文档关联和按 `documentId` 解绑，先按原 `work_items:edit` 人员动作签入 owning project 范围；Runtime 在事务里锁定项目和事项，依据权威归属与当前关系求值，不借 company 公开读取例外。关联还要求 UUID 出现在 Aims 的项目文档来源索引，且 Runtime 原生 Codocs ACL 对已验签 actor 当前给出该文档的 `view`；来源缺失、Codocs 拒绝或依赖不可用时均不得写入。项目关系本身不授予 Codocs 正文访问。按 ID 解绑仅允许当前事项已有的关联，不要求操作者仍持有 Codocs 文档查看权；它不修改文档或 ACL。无具体 `documentId` 的集合 DELETE 保持拒绝，Host 不展示批量解绑入口。独立 Aims 路径保持原领域规则。本批不新增 capability、grant 或服务身份。

### PA-01 F5：仓库、提交、同步与评论范围

Enterprise Host 仓库 link/unlink 使用 `projects:edit` 自身人员许可和签名项目投影；事项评论、提交 link/unlink 与 GitLab 同步入库使用各自原有的 `work_items:edit` 人员许可及同源投影。Runtime 锁 owning project/事项后按当前关系复核范围，保留原经理或成员业务门槛。提交关联还要求提交属于该项目且仓库当前仍与项目关联；解绑可清理已失去仓库关系的旧提交关联。GitLab 同步必须在同一事务内核对每个仓库 ID 与 code 的当前项目关系，范围或仓库错配时整批不写；全局唯一提交键已属另一项目时拒绝跨项目 UPSERT。Enterprise 批次任一 SQL 失败即回滚游标与提交。相同 payload 产生稳定幂等键，Runtime 的唯一提交键 UPSERT 保证重试不新增重复行。手动同步是入站拉取后入库，没有外发事件；因此本操作没有 outbox 投递对象。若将来改为后台定时同步，应另按受控调度与 outbox 合同设计。仓库/评论/关联写尚无 service-command receipt，与其他 PA-04 项一并收敛，不能宣称响应丢失后精确一次。独立 Aims 现有同步入口与业务门槛不因本批改变。

### PA-01 里程碑写范围（2026-09-27）

Enterprise 里程碑 create/update/delete 的项目编辑范围由 Foundation 统一 helper 投影到短期签名许可；Runtime 验证 actor/tenant/deployment/action/项目或对象绑定，body/query 无法建立范围上下文。Runtime 先按权威归属锁项目，再锁里程碑并复核归属、范围及当前经理/范围管理员关系；company 公开例外仅适用于读取。里程碑与配套成果同步共用同一事务，任一领域校验失败整笔回滚；完成审批冻结规则仍保留。独立 Aims 无 Enterprise 上下文的路径保持原领域行为。

本小批覆盖 Host 已暴露的三条里程碑写操作；系统定时 rollover 是固定 system 身份的受控维护路径，未新增人员许可或 Host 人工 rollover 入口。人工 rollover/完成相关通道继续按 PA-01 逐入口清单核查，不将三写完成宣称为全部里程碑写通道完成。

### PA-01 人工里程碑 rollover 与需求变更目标（2026-09-27）

Host 已有人工 rollover 与需求变更创建目标入口均附带 Foundation 的短期签名 projects:edit 范围许可，保留各自业务能力与原经理/范围管理员门槛。Runtime 从权威项目/里程碑归属派生 owning project，按项目→里程碑顺序锁定，事务内复核当前关系和写范围；company 公开读取例外不用于写入。人工 rollover 在返回既有周期快照之前复核许可，以受信 actor 记录操作人，不接受 body 伪造的 operator_uid。需求变更目标的归属、阶段、冻结检查、计数器与插入共用事务，拒绝不留下目标。

固定 system 定时 rollover 未改变。里程碑完成申请/绑定 Workflow 尚无 Enterprise Host 入口，记为迁移缺口，本批不新增操作或能力。人工 rollover 的既有周期快照幂等合同保持不变；需求变更目标的 Host 回执由 PA-04 D1 补齐。

### PA-01 项目工时三写范围（2026-09-27）

Enterprise 项目工时 create/update/delete 使用 Foundation 的 timesheet:submit 人员动作投影与短期签名许可（固定 actor、tenant/deployment、parent projectId、entry subId 与策略版本事实），不借用 projects:edit，不新增经理门槛。Runtime 先锁 owning project 和当前成员行并求值同一项目范围，之后锁指定工时行复核归属。company 公开读取例外不应用于工时写入；跨项目 entry ID 不可用于读写其他项目。

原有负责人/活动 manager 或 member/范围管理员门槛、仅本人编辑删除、仅 draft/returned 可变规则保留，并在该事务内复核。主写与响应回读共用同一事务；失败回滚，不在持锁期间借第二个连接。独立 Aims 无受信 Enterprise scoped context 的路径保持原行为。审核和周提交批量尚为后续小批，不以三写完成宣称全工时整改完成。

已知缺口 PA-04（成果+工时写入幂等）：这三个存量工时写入口目前未实现 service-command receipt；本批增加范围和事务，不新建平行回执体系。不能以幂等键发送或拒绝重试测试宣称有服务端幂等，回执重放验证为既有缺口，后续需单独整改。

### Aims 管理员项目 Host 委托（代码候选，待发布）

企业宿主独立提供 `GET /aims/api/v1/admin/projects` 与 `PUT /aims/api/v1/admin/projects/:id`，只面向 Console 快照中拥有**无对象范围静态** `aims:admin:admin` 的人员；项目经理关系及 `projects:edit` 不能替代。Host 在调用 Runtime 前使用 Foundation 统一授权求值，依赖失败返回 503、缺权返回 403。Service Token 能力分别为 `aims:admin-projects:view` 与 `aims:admin-projects:edit`，对应两条精确 Enterprise POST 操作，均由 Runtime 核对 enterprise 来源、部署、actor、audience 和当前服务凭据；人员许可绑定 actor/tenant/deployment 与 `admin/admin`，最长 15 秒。项目内 PA-02 编辑路径保持原 scoped projects:edit 加当前 leader/active manager 门槛，两个入口的许可不能互用。

管理员列表只接受界定的筛选与 1–100 页大小，在单个一致快照中计算 COUNT、稳定分页和编辑版本，输出基本字段及访问控制字段白名单。管理员编辑与 PA-02 共用字段校验、项目行锁、editVersion、同事务 receipt/活动日志、负责人同步和 L2/L3 收紧；管理员独立 operation code/required capability，审计 action 为 `admin-edit` 且记录入口和操作者，旧键重放前仍重新校验现时管理员授权。管理员基本编辑入口仍不接受删除和强制生命周期改写。批量部门事务创建与项目集创建分别使用下文的独立固定入口。manifest 增加细粒度服务资源声明，不给人员推荐角色新增权限。C000001 的两个 data-runtime qualified grant 尚待代码审查与正式安装后才生效。

### Host 本人工时填报动作与周提交（2026-09-29）

人员权限与 manifest 对齐：项目/事项工时 create/update/delete 以及本人整周提交均要求 `timesheet:submit`，Foundation 编译该动作自己的范围，Runtime 验证同一签名动作。`edit/admin` 不替代显式 submit；内部传输 permit 的 `edit` 标签及既有服务能力不变。个人日历导航允许 view OR submit；submit 仅额外允许读本人记录，不开放项目全量或他人工时。

周提交无需请求体，actor 来自受信会话。Runtime 先验证短期 submit 范围，再在同一事务按项目顺序锁定当前范围/成员事实并复核既有填写资格，最后锁定本人该周期 draft/returned 工时；任何项目不满足条件时整周回滚。并发加入未经复核的项目返回 409 要求重新提交。状态和审核事件同事务写入，重复提交无可编辑记录时冲突关闭，不宣称整周提交具有 service-command receipt 回放合同。Host/Runtime 必须配套更新或回滚；审核写入口仍关闭，未修改 manifest、角色或环境 grant。


### Aims–Workflow 同库 Tx 基础（B1+B2 候选，2026-10-01）

本批仅提供显式 Workflow 映射、Directory 预读快照、多域 Registry 与调用方 Tx 核心，不新增公开路由、capability/grant 或启用同库 lane。完整合同见 [统一事务设计](./Aims-Workflow-Unified-Transaction-Design.md) §3–6/§12；旧 Host、独立 Workflow 与 Aims 外投 completion 默认行为不变。

- Directory 先在自己的 RR 只读事务读取权威 active actor/唯一主部门/父级，产出不可变字段、逐行版本向量和 SHA-256；任何缺失或依赖故障固定 503，不接受浏览器提供的部门事实。统一业务 Tx 内禁止再调 Directory 或外部服务。
- `ResolveDomains` 要求所有域同 tenant/environment/runtime、存储池、schema/generation，并逐域验证 owner/mode；任一失败不返回部分结果。`BeginWorkflowWriteTransaction` 在现有 Registry 持久化 generation 栅栏内仅按 owning lane 传入的窄逻辑名集合检查安装，完整绑定一致性为内存比对，adapter 构造期核对完整安装；失败回滚而无领域或 receipt 写入。共享逻辑名以 enterprise 包名单为单一事实，enterpriseviews 仅 re-export。统一锁序为 Registry→Aims 项目→事项→申请→Workflow 实例→任务/动作（组内稳定 ID）→receipt。
- Aims caller-Tx 固定私有 typed in-process 模式，不生成 Workflow-submit operation；默认 wrapper 保留旧外投，模式不能由 body/query 指定。Aims 入口须接收 Registry Resolved 并与当前 writer 的 DB/Key/generation/schema/owner/映射等值；Workflow 核心深拷贝命令，重试不改调用方输入。
- Tx 核心的 commit/rollback 属于调用方，领域授权与职责分离仍属于各自 owning service；ReceiptRepository 使用现有 `ExecuteInTransaction`。Aims 与 Workflow 的 receipt 分别映射自身物理表；Workflow caller-Tx 不得使用未映射的默认 receipt 仓库。同键重放读取原冻结结果，不能更换目录快照或建立第二个实例。
- 源参数表只在 Workflow 映射里改为 `workflow_system_parameters`；Assets 原 `system_parameters` 及既有共享名集合保持。可选迁移绑定 DDL/数据/映射 review hash，已激活 target、未审源表/JSON、缺 013/014、半装/漂移失败关闭。环境 copy/DDL/登记与 B3 lane 激活仍须另行批准。

B1+B2 renderer 在 B3 server 工厂接线前拒绝包含 Workflow 域的候选和独立 adapter 指向统一库的配置；不得仅因迁移映射存在就启用旧 Workflow pool 写统一表。单域/多域 Resolve 的表映射均为副本。锁序 helper 的缺行哨兵由 B3 映射固定 404/409；兼容视图锁到底表的隔离证据为后续启用前验收项。


### 工作项完成同库 lane（ADR-018a B3，默认关闭）

`enterprise.workflowLane.enabled` 仅显式 true 时使用 Registry 的 Aims/Workflow 同库 Tx；缺登记、unified 模式、安装/视图或人员目录即失败关闭，不回退旧池。关闭行为不变；renderer 需显式 `--workflow-lane` 并以相同参数 check。启用与迁移仍另需批准。

申请仍为既有 Host scoped work_items permit；审批保持 Host→Workflow Node（静态 approve/reject+subject-eligibility）→Runtime 签名 actor，既有 workflow.runtime/workflow.write 与 live grant 核验不变。无新增 capability/grant、无 Host 决策签名桥。Directory user_type 是权威：只有 active employee 可参与，非 employee/未知固定 403 workflow_subject_type_not_allowed；employee S3 目录快照不完整或依赖失败 503。目录预读在业务 Tx 之前，快照/版本/hash 冻结于申请和实例。

同 Tx 固定 Registry→Aims project/item/request→Workflow instance/task/action 锁序；scope/关系/受托人撤权复核先于旧 receipt。申请 receipt 分别沿用 Aims 与 Workflow 映射表；决策结果沿用 Workflow→Aims 的 Aims receipt（真实来源、既有跨应用 CHECK，无 DDL）。approve/reject 与 Aims 回写任一失败整笔回滚。内部 callback 不生成 pending HTTP 外投；通知/actionable 使用原 durable outbox，网络 IO 仅在 commit 后。完成实例 withdraw 同库回写；generic resubmit 返回 409 workflow_completion_lane_owner，必须经 Aims 重新冻结申请。

完整实施与边界见 `docs/Aims-Workflow-Unified-Transaction-Design.md` §13；隔离 MySQL 门未通过前不得声称 lane 已验收/已启用。

### B3 lane 审计与行动主体补充（第六轮）

- 同库申请/决策不是已验证的跨服务请求：保留真实 source/target app 与部署，内部 receipt 的 ServiceClientID 为 aims.lane/workflow.lane，operation 为 aims.completion.request.lane.v1/v2 或 workflow.tasks.<action>.lane/workflow.instances.cancel.lane，requestId 加 lane:；不得用这些标识调用公开 Service API。旧 operation/client 合同不变。
- 发起人 employee/主部门快照只在申请时复核。决策只核行动主体、delegate_to 和回写 approvers；发起人停用/离职不阻断其他合法员工收口。撤回不新增代撤权，原发起人行动仍须 active employee。
- Directory 只读当次涉及的 uid，未预读的新候选/证据锁内失败关闭；空申请快照 503。决策缺行/映射漂移 409；申请缺对象 404。
- 决策 Idempotency-Key 不得跨任务复用，同键异任务 409。lane 创建通知来自提交后的 durable outbox drain，其周期/退避影响到达时间；申请响应不携内部 effects。

## ADR-018a P1 候选：Aims 迁入 Host 的跨进程边界

本节对应 P1 代码候选；环境未切换、grant 未执行。六类项目文档进程内迁移仍须完成独立验收。

- 通知详情是第三类 purpose 委托：Console 以 `console.runtime`、aud=enterprise、`enterprise:notification-detail:authorize` 调用 authorize/finalize 独立端点；仅来源事实为 aims/assets 的通知改指 Enterprise，其它来源保持原目标。owning 模块保留现有状态机，沿用 Foundation 从已验证 Console 命令提取 viewer 并签 `purpose=notification-detail-authorization`，出站身份 enterprise.runtime，scope 为 `aims:notification-detail:authorize` 或 `assets:notification-detail:authorize`。Runtime 拒绝缺 purpose、actor=service subject、错 client/source/deployment、撤销或错 scope。系统路由拒绝任何 actor 委托。
- Workflow payload `app_code=aims` 整组映射为 Enterprise 服务地址/前缀、aud=enterprise、`enterprise:workflow-callback:execute`，冻结的相对 URL、payload、callback id/key 不改。其它 app 的地址/audience/scope/路径不改。Enterprise 两个独立回调入口均校验业务 app=aims；完成回调只服务存量或未启用同库 lane 的安装，不重复审批。出站 Runtime 使用 enterprise.runtime、`aims:scheduler:execute`，不转发 Workflow 令牌。AA-04 开态失败关闭。
- 独立 Codocs 的 Aims 服务策略逐条采用两组配对来源：enterprise/enterprise.runtime，或显式过渡窗口内的 aims/aims.runtime。每条仍要求原精确 Codocs capability、服务令牌当前状态、租户/目标部署绑定、原字段白名单与 HMAC 信封。业务 operation/schema/key 和业务 source_app=aims 不随网络执行者变化。Enterprise→Codocs grant 只在候选 SQL 中列出，不执行。
- 开关分族且默认 true（保持存量来源）：Runtime `allowLegacyAimsCallbacks`、`allowLegacyNotificationDetails`；Codocs `HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED`，仅显式 false 收回。调度旧来源开关属于 P2，不由这三项扩大。Runtime 路由审计 operation 标记新/旧来源；Codocs 安全审计日志只记固定 event、source/client/scope/branch，无令牌、正文或业务 ID。
- 移除条件：新入口的正反例与真实调用验收通过、按相应 family 的 Runtime operation/安全日志观察 legacy 请求数为 0、全部非终态业务已收口，再关闭兼容。停 hzy-aims 的环境必须关闭 aims 分支；不以『部署成功』代替观察证据。P2/P4 顺序为 Runtime 新来源版本→暂停唤醒→核对 processing/locked/dead-letter/due/周报待发等所有非终态→改 W10→恢复→观察→关闭旧来源。view/replay 不并入 scheduler；ack/fail 领取者不符须 409。

### P1 项目文档 owner 迁移边界（2026-10-01，选项 A）

Enterprise 固定 U 文档写操作只接受 Runtime 能从权威行解析到实际 projectId 的
project/milestone/work-item/parent owner。仅属项目集的文档，以及继承这类父目录
的写入，必须在任何 Codocs 或数据库写入前以
`409 project_document_portfolio_owner_unsupported` 拒绝；不能把项目集 code
当作项目 code，不借任选子项目或 company 可见性放宽写范围。项目页列表不纳入
portfolio-only 文档。独立 Aims 路径保持原行为。

项目集文档的人员 resource/action、对象投影和关系门槛列为迁移缺口，另行设计；
不得用本次 transport 迁移默许或自行创设该授权合同。生产只读盘点数据为
portfolio-only 2 份（最后创建于 2026-03-29）、挂项目 4 份，仅作迁移背景，不是授权事实。

### P1 legacy 收回核验

Enterprise 分支真实命中验证 → 停 hzy-aims → 按回调、通知详情、Codocs 策略逐个置 false → 用真实旧来源分别验证 403。每项收回前须 hzy-aims 停机且该环境 legacy 命中为 0；统计来源为 Runtime `.legacy` operation 审计与 Codocs `.legacy` 安全审计（按环境和观察窗口），不可用总请求数推断。保留观察证据与 403 回执后才删除兼容代码。

AA-04 开关以 Runtime `enterprise.enableMilestoneReceivable` 配置为唯一判定依据，Host 不能覆盖；当前迁移不提供跨 Altoc 协调，启用且遇相关回调必须失败关闭，不得部分成功。

### 项目需求恢复 R1a：规格书与需求基本内容（2026-10-02）

Enterprise 只调用 Aims owning typed 核心 `readHostProjectRequirements` /
`writeHostProjectRequirement`。新增十个固定操作（目标列表、规格书读取、需求创建、
章节创建、导入、需求更新/删除、章节更新/删除/恢复）均使用
`aims:enterprise-host:execute`；无新 capability、grant 或 schema。

读取叠加 `requirements:view` 与绑定项目的 `projects:view` 签名投影，先复核 owning
项目再读章节/需求；COUNT、分页、规格书关联在同一只读快照内计算。写入要求
`requirements:edit` 的签名项目投影、当前 leader/active manager 或既有 scoped
项目管理员、active 项目，company 公开读取不放宽写入。许可绑定 actor、tenant、
部署、项目与对象、策略修订，最长 15 秒；浏览器不能提交评审状态或权限事实。

每次写入（包括回执重放）在现有受管事务内先锁项目和对象、复核范围及当前关系，
再读 `service_command_receipt`。领域写与回执原子提交，不新增回执表。回执仅存紧凑
稳定结果（ID、编号与计数/布尔值），不存正文；超出既有结果列上限整体回滚。Host
对未确认的相同意图保留幂等键，载荷变化使用新键。独立 Aims 仍拥有自己的事务。

导入每次先复核来源：Codocs 走既有 Enterprise 委托的项目正文 ACL，仓库走既有
项目绑定及固定 commit 读取；Runtime 再核 owning 项目与仓库绑定。Codocs 来源可
尚未建立项目索引，导入本身创建规格书引用，不通过关联授予文档访问。导入覆盖
仍执行原锁定、已生成需求禁止覆盖及确认门槛；失败在外层事务回滚。

R1a 不登记评审写操作；Host 需求评审页显示明确禁用说明，章节预览的变更入口亦
禁用。R1c 完成前不得从浏览器写批准/退回结果，最终结果只能由正式 Workflow 服务
链写入。

### 2026-10-02 项目需求恢复 R1b（评审准备）

十个固定 U 操作详见 `aims/docs/Aims-Project-Requirements-Host-API.md` R1b 表。
同进程 owning typed 入口 → `aims:enterprise-host:execute` 与已签名用户委托；不得走
Aims HTTP 或宽 scope。新增五读/五写，无 capability/grant/schema。写入在 R1a
Registry/receipt 同事务内复核当前项目范围、管理关系及全部批次/章节引用；原独立
Aims 调用不持有该外层事务时仍自行 begin/commit。原生命周期和里程碑门槛不放宽。
评审批次创建/追加/撤回仅为准备动作；审批提交、同步与结果回写待 R1c，批准/退回
只能来自服务端已核验的正式 Workflow 结果。读取结果不授权浏览器写入结果。

### 2026-10-02 项目需求恢复 R1c（正式结果）

新增 review-sync / review-create-tasks 两个固定 U 操作（仍在 aims:enterprise-host:execute，
无新 capability/grant/schema）。sync 冻结批次摘要并通过 Host 原有 Workflow 通道创建/对账，
Workflow owning 只读端口由 Runtime 构造注入；Aims 不 import Workflow。浏览器仅发送
projectId，不发送实例/批准/拒绝事实。正式回调沿用 P1 Enterprise 入站与
 aims:scheduler:execute，Runtime 读正式实例再核完整绑定/终态/操作者，
beginBoundEnterpriseTransaction 内批次、章节、版本整笔落库，同结果回放无重复。
任务生成仍核 requirements:edit 范围与当前经理关系，旧回执前复核，全对象归属预检；
既有 receipt 冻结计数摘要。冻结格式、历史绑定失败关闭与错误见
`aims/docs/Aims-Project-Requirements-Host-API.md` R1c。

### R3：Host 项目设置与生命周期申请（2026-10-02）

Host `/aims/projects/:id/edit` 保留 PA-02 基本信息和访问控制编辑，并恢复全字段只读概览、产品关联、仓库 list/link/unlink、模块配置和生命周期审批。成员维持独立页；不迁移 Account/GitLab 仓库创建。浏览器不得因 Workflow 状态推算或补写项目生命周期。

- `PUT /aims/api/v1/projects/:id/modules` → 固定 U `aims.project-modules-update` (`/v1/enterprise/aims/project-modules:update`)。仅接受 `expectedVersion`、原始 `expectedModuleConfig`（保留 NULL）和七个布尔模块键的 `moduleConfig`，要求签名用户、当前 `projects:edit` scoped permit、当前负责人或 active manager。写前重验关系和范围；原配置或基本版本变化 409；模块写入、活动日志及持久化回执同事务。PA-02 原可写白名单不扩展。
- `POST /aims/api/v1/projects/:id/lifecycle` 仅接受 `actionCode` (`pause|resume|finish`)、`comment`、当前 `expectedVersion` 及 `Idempotency-Key`。pause/resume 使用 `projects:edit`，finish 使用 `projects:close`，均要求当前负责人/active manager，不能借用查看范围。Runtime 固定 U `aims.project-lifecycle-request` 在项目锁内写待审 `approval_records`，冻结 requestNo、项目、动作、active→paused / paused→active / active→completed、用户、版本和说明。相同意图重放返回同一记录；不同载荷/已有待审/状态变化 409。
- Host 用冻结快照经现有 `enterprise.runtime → workflow:proxy` 内部 prepare/create 路径创建实例；不开放浏览器通用 prepare/create，也不接受浏览器 form_data。沿用 Aims 已登记 `projects/pause|resume|finish` 动作和既有 Workflow 配置，未配置路由时失败关闭。固定 U `aims.project-lifecycle-bind` 使用重新读取的短期 scoped permit，把 instance ID 绑定原申请；Workflow 创建或绑定失败保持待审，同键可重试。
- Workflow 对带 `PLC-<64hex>` 冻结 requestNo 的三个项目生命周期动作，在定义锁内按 requestNo 重放相同实例；actor/project/表单变化 409，新意图不覆盖驳回/撤回旧实例。没有该前缀的独立应用既有创建行为不变；未加 schema、capability 或 grant。
- 正式回调仍经 Enterprise 入站来源认证 → `aims.workflow-callback` / `aims:scheduler:execute`。Runtime 同时匹配已绑定实例、requestNo、项目和动作；批准只推进既定目标（finish 为 **completed**），写生命周期事件；驳回/撤回只关闭申请。未经认证、错实例/项目/动作、无绑定、旧申请或当前状态改变均拒绝，已经处理的同终态回调幂等返回。

固定 U 操作仅新增三项（request、bind、modules-update）。审批人员资格仍由 Workflow 负责；Host 仅把生命周期 by-biz/实例/任务读取和单任务处理加入固定业务白名单，不扩展通用创建入口或工作项待办列表范围。部署验收需要既有 Workflow 动作/路由配置可用及 callback outbox 重试；本批仅代码，不安装或修改环境。

申请已经冻结后，即使 Workflow 创建/绑定阶段返回 4xx，Host 返回 `data.requestFrozen=true`；浏览器保留原意图和草稿，不能将其当作未登记申请另换幂等键。未确认意图用已验证 Enterprise 会话范围内的 Nuxt state 保留，关闭弹窗或路由返回后可“继续未确认申请”；不是客户端状态补偿。

R3 第二轮收紧：生命周期与立项系统回调均通过 `beginBoundEnterpriseTransaction` 持注册表共享锁并复核代次，代次不符时零业务写入。绑定必须提交 `instanceId` 与 `instanceNo`；Runtime 核对编号、requestNo、biz_id、initiator_uid 及 app/resource/action，错误归属拒绝且不绑定。Workflow 已注册并库时在同一栅栏事务中读取注册表解析的实例表；未并库时由 server 注入已启用 Workflow adapter 的窄 `ProjectLifecycleInstanceReader`（仅按实例 ID 返回只读 typed 身份及表单，不接受 trusted 标志），在 Aims 事务外读取独立 Workflow 库，再进入 Aims 注册表代次栅栏锁申请、复核 scope/管理关系与冻结身份并绑定。Aims 不反向 import Workflow，不新增 HTTP 路由/capability/grant。适配器未配置或读取依赖失败503，pending 记录与同一键保留，可恢复后重试；实例不存在或身份不符409。Host 生命周期意图键带 projectId/action 前缀并保持同意图重试键不变。回调早于绑定返回409，由既有 Workflow 持久投递重试；达到 maxAttempts 后 abandoned 的生命周期回调通过既有管理员 replay 流程恢复，禁止浏览器补写项目状态。

### 项目成果 Host 读取（R2a）

Aims owning `readHostProjectOutput/readHostProjectRepoCandidates` 固定调用 `aims.project-output-overview` 与 `aims.project-repo-candidates`，均在 `aims:enterprise-host:execute` U 通道；前者 projects:view+父项目签名范围、同快照 document COUNT/统计/分页/分类卡片/仓库列表，后者 projects:edit 范围+当前项目经理关系，从权威项目集 git_group 解析只读候选，禁止浏览器输入组和 Account 全目录回退。正文权限继续由 P1 Codocs/GitLab 复核；列表元数据不授正文权限。通用成果列表不因成果页而排除制品。质量三个动作待R2b，本批不启用。详细合同见 `docs/Aims-Project-Output-Host-API.md`。

R1c/R3 的只读实例依赖合并为 `AimsWorkflowInstanceReader` 单一接口、Runtime构造处一次注入；需求4xx透传、依赖503。需求workflow_instance_id为内部rrb冻结编码，不是状态/URL；在审update/delete仍领域409，callback abandoned通过受审恢复命令原键replay，不绕过冻结。编码与恢复详见 `aims/docs/Aims-Project-Requirements-Host-API.md`。

### R2b Host 项目成果质量动作

Host 三个项目内 POST 经 Aims owning typed `writeHostDeliverableQuality`，用固定 U resume/create/activate/completeness/waiver 操作（aims:enterprise-host:execute），不经旧 Aims HTTP 或宽 scope。送检/完整性用 projects:view 的签名项目投影及 Runtime 当前成员/责任经理，不额外要求 QA 无权的 projects:edit；写不走 company 公开例外。豁免要求 quality_reviews:waive + Console 当前唯一总监。受检版本/hash 和 role-holder revision 由服务端解析，随短期用户委托签入；浏览器不得提供。Codocs 使用 P1 双来源版本解析/受检 grant，固定版本与 ACL 不放宽。Registry Tx 内项目/对象/关系复核早于 receipt，复用既有回执表、原键两阶段恢复。完整性不直接通过质量。详见 aims 项目成果 Host API 合同 `docs/Aims-Project-Output-Host-API.md` R2b。


### R2c 项目文档保留与固定版本

项目附件上限 100 MB（100×1024×1024 bytes）在 Aims shared、Host 与 owning 上传校验中一致；独立端与 Codocs 文件柜沿用相同字节数。无新增 U 操作/grant/DDL。项目移除成员不回收 Codocs 的独立分享/授权，Codocs 仍独立复核自己的当前 ACL。项目引用删除不调用 Codocs delete/recycle/附件删除：只在 Runtime owning 事务移除索引。目录含任意后代文档时 409 project_document_folder_not_empty；先验证所有后代，再删除空目录，跨项目后代失败关闭。

Git 文档创建先复核项目/仓库权威关系，再冻结服务端解析的提交 ID；preview 返回固定提交的正文与单独读取的当前文件 blob 更新标识。latest 的正文不下发、不替换快照、不写引用。过期或撤销项目访问仍在 Git 读取前拒绝。非 Git 的项目附件仍保留 Codocs 文件柜的生命周期，项目删除不影响其本体。

仓库正文与 Markdown 树保留旧浏览器路径，但 Host 原生调用固定 U 操作 `POST /v1/enterprise/aims/project-documents:repository-read`（`aims:enterprise-host:execute`），不再使用旧 Account/Aims HTTP 或 Console `integration_operations:execute` 服务令牌。Runtime 校验短期 projects:view 范围、当前项目成员和精确仓库绑定；引用预览额外绑定 documentId/文件路径/固定提交并复核 Codocs 策略。GitLab 读取后再次校验成员、引用与许可有效期再返回正文。同进程 Console typed 只读入口固定 `gitlab.default` 的 file/markdown-tree，复用配置、Vault 归属验证与审计；不开放 issue 写入，不接受浏览器指定 integration。新引用冻结提交也复用此读取入口，无新增 capability/grant/schema。

### Enterprise 顶栏企业简称（2026-10-02）

`GET /enterprise/api/org-brand` → Foundation 固定 `console.org-brand-view` → `POST /v1/enterprise/console/org-brand:view`；复用 `console:enterprise-host:execute`，只允许 enterprise.runtime 的已验证本租户签名用户委托，实时核验服务凭据/grant。无需 org_profile:view，不新增 grant/capability。Runtime 只查询 tenant_code/org_name/org_short_name/display_name 并复核租户，输出仅 `{shortName,displayName}`：shortName 按 orgShortName→displayName→orgName 回退，displayName 按 displayName→orgName 回退；拒绝 query/body 输入。顶栏会话缓存，切用户失效，失败静默回退企业编码。不重新开放企业资料管理页。

### Enterprise 项目页签读取（2026-10-02）

项目页签使用现有 Aims U 固定操作，不新增 capability/grant/角色。项目可见性是前置；看板、项目目标、需求、风险、度量仅当前 active 成员/leader 或覆盖此项目的 scoped projects:edit/admin 可读。Foundation 唯一 evaluator 编译签名 managementAuthorization（projects/edit、策略版本/hash/revision、≤15s），Runtime 由权威项目/member 行重新求值；projects:view/company 公开读取不升级为管理。

工时普通成员仅本人（SQL COUNT/分页/汇总前过滤、详情同边界），仅当前项目经理/覆盖性管理可读全部。周报允许任一项目的当前经理只读，但仍须目标项目可见，不给该项目写权限。项目设置/基本信息入口从 scoped edit/admin OR 当前经理发现，失败只隐藏编辑，不阻断概览。概览、里程碑、成员、成果、版本的非成员只读与逐文档 Codocs ACL 保持，所有写动作原有授权/范围/职责门槛不变。详见 `aims/docs/Aims-Project-Tab-Access-API.md`；签名只读父项目上下文仅由已验证读路由设置，不能用于写命令。

### Platform 环境策略修订与 Runtime 发布渠道（2026-10-02）

- 当前策略权威键为 `(tenant_code, environment)`，存于 `tenant_environment_policy_revisions`，环境仅 prod/test/dev；每环境 revision 只增不减。相同有效事实及目标集合/有效期复用原已签正文；需新正文时升 revision。消费者仍拒绝回退与同 revision 不同正文。
- 租户人员授权事实的编辑仍是租户级，各环境发布快照独立；test 发布不撤销 prod 快照，角色变化经各环境正式发布后保留该环境撤权语义。
- Runtime 软件批准使用 `stable-prod/test/dev`，不存在渠道不回退旧 stable/bootstrap；目标仅写同环境、同登记发布key、`release_update_mode=tracking` 实例。pinned 不返回自动升级目标；retired 拒绝心跳与重新登记。mode 不替代主机 timer/API 路径冻结。
- 受管安装要求 exact semver 安装与 timer目标（或禁用 timer），不能 latest。环境迁移、日本实例、旧 stable 映射与主机冻结均需独立现场批准。候选SQL及回滚见 Platform Environment-Policy-Runtime-Release-Rollout.md。

### APF M1 三域统一库与三通道样例（首批合同，当前状态见下）

**2026-10-03 同步更正（源码 `4a5fa619`）**：以下 M1/各实施批段落描述当批合同，不能把当时“无页面、People 无写、候选/未部署”读成当前总状态。M1 `9146cf23` 之后 WP3/WP4、09c2、11～14、16a～g、18A 已扩展固定闭集、页面与恢复链。hzy0 base+七增量 read/write 已启用，最近文档化候选 `8ee33d32` / Runtime `0.3.295-test.apf-enable.5`；Finance 范围待 Platform 发布。后续提交、B5/成本投影新表、目标 seed 与全链验收不可按源码推定已启用，Workflow/Console seed 仅部分在 hzy0 执行。scheduler disabled；17/18B 用户规则和18C旧owner收口尚未关闭。本轮只核对仓库及既有回执，未连接环境。逐入口、操作、权限和安装子集见 [APF 全动作对照表](./Enterprise-APF-Action-Matrix.md)，四类交付材料与提交见 [专项计划 §12.1](./Enterprise-Altoc-People-Finance-Integration-Plan.md#121-每个动作的完成记录)。


- 新域首批业务表：Altoc **26**、Finance **9**、People **6**；各域另有四张物理域前缀账本表，共 **53** 张。候选 canonical 为各模块 `docs/apf_m1_schema.sql`，由 `data-runtime/scripts/generate-apf-domain-manifests.py --check` 对设计 SQL 校验。旧 schema 留作历史，不导入历史数据。业务逻辑名=物理名，账本仅经 `Resolved.Table` 解析，不创建共享账本视图；既有 Aims/Assets/Workflow 映射、兼容视图和 hash 不变。
- `domaininstall.WithAPF` 只增完整映射、保留非零 generation；初始 read=unified、write/scheduler=disabled。`ForAPF` 在已有迁移锁、Runtime 停止及身份核对护栏内 plan/apply/verify/rollback；reviewHash 覆盖 53 张 DDL。已有对象拒绝覆盖；回滚仅删本批摘要匹配、无数据、无外部 FK 的对象。启用模式和部署均需另批。
- U：`<domain>:enterprise-host:execute`，fresh Enterprise 服务身份 + 已验签用户委托 + ≤15 秒签名 permit。P：`<domain>:notification-detail:authorize`，仅经 Console purpose 委托复核该查看者读取权，无写入。S：`<domain>:scheduler:execute`，拒绝用户委托头并核对当前 grant、部署和 generation；M1 `scheduler:inspect` 本身仅统计至多 100 条到期 operation；18A Host wake 随后分别恢复审批和 Directory 队列，详见18A，不能因此启用第二个 owner。
- M1 首批共 14 个固定 Runtime 操作（不是当前全闭集）：客户 list/view/save（3）、银行账户 list/view/save（3）、岗位 list/view（2）、三域 scheduler inspect（3）、三域 notification detail authorize（3）。M1 样例 People 无写；09ab/c/d 已增加独立固定写操作。全部路径闭合，无任意表名/SQL/资源代理。
- 客户人员许可沿用 `customer:view/edit` 和既有 Altoc 范围编译；银行账户沿用 `bank_accounts:view/admin`；岗位沿用 `positions:view`。后两类样例只能在 Foundation 现有 evaluator 未提供对象事实也可授权时执行，不能把对象约束 grant 扁平化为 all。旧业务路径权限不变。样例仅修改 code/name 元数据，不实现审批、资金交易、凭据字段或人员成本写入。
- APF permit HMAC 绑定 fresh service token、method/path、actor/tenant/Host deployment、resource/action、operation/object、policy revision/version/hash、范围与完整请求意图；共同 TS/Go fixture 锁定编码。列表范围在 COUNT/分页前，读取同一 snapshot。写事务在回执读取前锁对象并复核范围；业务行、回执、审计同事务；同键改意图 409、撤权旧键拒绝、rowVersion 冲突 409。
- Host 候选 BFF 为 `/enterprise/api/apf/{altoc/customers,finance/bank-accounts,people/positions}/{list,view,save}`（People 无 save），系统样例为 `/enterprise/api/internal/apf/scheduler-inspect`；并入现有 Console 通知 purpose 入口。这是 M1 首批状态；后续已增加页面和18A Gateway签名wake owner代码（默认关闭），环境安装/路由/调度启用分别取证。
- v2.34 seed/verify 仅为候选，以配置中实际 **一个** Runtime audience 参数化生成九项 exact grant，不默认授双 audience。已有任何同键行均不覆盖，revoked 不复活；新事实包含 audience/semanticScope/tenant/deployment。本批无真实签发与授权写入。
- Finance 样例 Host 编辑字段 `expectedVersion` 规范化为 Runtime 签名意图里的 `rowVersion`；拒绝浏览器直接携内部字段。`Idempotency-Key` 不自动重发。Codex-sol2 的完整账户/参数 UI 草案（`hostFinanceClient.ts`）包含不同的 REST/PATCH 及字段封套，WP3 `9de74eff` 与前端 `ea49496a` 已实现完整 REST 合同；M1 元数据样例仍独立，不能以简化响应替代完整页面字段。

### APF WP3 Finance 完整账户与参数 U 合同

十个新固定 U 操作，复用 `finance:enterprise-host:execute`，详见 `finance/docs/Host-Finance-API.md`。Host REST 对齐 sol2 typed 草案；POST自动编码、PATCH expectedVersion 与 Idempotency-Key、响应 snake_case 白名单与定点字符串。银行账户 view/admin，参数严格保留既有 settings:admin（manifest无 people_cost_parameters，不新增人员资源）。permit完整绑定finance意图、目标code与policy事实，≤15s；Runtime验签后再校验字段/对象。

参数 active 生效闭区间不重叠，Registry排他行锁覆盖空表并发；业务、既有域 receipt、完整版本审计快照同事务。历史仅读取该版本快照，旧审计不伪装历史。回放先复核权限/对象、返回原版本；同键变意图/版本/区间冲突409。既有 M1 样例、独立 Finance legacy 通道不变。没有新DDL、capability、grant、调度或环境操作。

### APF WP4a 客户主链（d057d697；hzy0基础抽验，非全链验收）

新增10个Altoc固定U操作，使用既有 `altoc:enterprise-host:execute`，人员门槛 customer:edit、读取customer:view；客户owner/dept范围在Runtime锁内、旧回执之前复核，子对象必须权威归属该客户。负责人调整的目标事实同样受范围约束。所有写入使用既有Altoc receipt + audit，同事务；默认开票资料在客户锁内切换并受唯一约束。接口、字段、范围和失败恢复见 [Host-Customer-API](../altoc/docs/Host-Customer-API.md)。客户审批、导入及报价/合同不在本段，未开放任何新能力或环境配置。

### APF WP4b 报价主链（1f92cd36；正式审批见APF-12a）

新增六个固定 U 操作，全部在 `altoc:enterprise-host:execute` 内，人员 quotation:view/edit 与当前 owner/dept scope 独立复核；明细金额由 Runtime 十进制计算，版本冻结、现有 receipt/audit 同事务。批准/拒绝不能由浏览器写入，APF-12a `58685d12` 已接入正式 Workflow request/bind 与回调，浏览器 submit 只创建冻结审批意图；未配置正式 action/route 或目标依赖时失败关闭。send/accept 保留原状态门槛。完整字段、固定路由、舍入、失败恢复见 [Host-Quotation-API](../altoc/docs/Host-Quotation-API.md)。不新增 capability/grant/schema。

### APF WP4c：Altoc 合同 → Aims 项目/里程碑 caller-Tx

详见 [Host 合同 API](../altoc/docs/Host-Contract-API.md)。12 个固定 Altoc U 操作复用 `altoc:enterprise-host:execute`，人员 `contract:view/edit`，项目创建/关联与里程碑另由 Foundation 当前 Aims `projects:create/edit` scoped 许可并入 token-bound HMAC。Runtime Aims owning core同caller事务、锁内派生关系和范围，项目计划按code排序；固定域锁序 People→Altoc→Aims→Assets→Finance→Workflow，无锁内网络、无Aims反向调用Altoc。全部业务/receipt/audit同事务；重放前复核授权、短期授权事实不进入稳定业务摘要。

D-06可空billing_schedule_code及兼容视图刷新仅交付SQL候选；有绑定时禁止rollback删列。AA-04自动回写仍关闭；APF-12a `58685d12` 已接入新合同正式 Workflow 审批，Runtime 依据正式结果推进，草稿不可由浏览器批准/签署。

### APF-09ab：Enterprise People 基础主数据和读取

Enterprise 固定 `people:enterprise-host:execute` U 通道新增 16 个操作：岗位 create/update/delete；职级 list/view/create/update/delete；职级工资设置 list/view/create/update；员工 search/profile；任职 list/view。人员门槛仍是 People manifest 的 positions/ranks/standard_costs `view/admin`、employees/assignments `view`；字典为全局主数据，不把部门范围升级成全局管理。

Host 从 Console 当前快照经 Foundation 唯一 scoped evaluator 编译 all/self/dept/self_dept/none 真值表，无法表达的谓词和缺失部门树整体 503，不降级。短期 permit 绑定 actor、tenant、deployment、resource/action、对象、请求、策略版本/hash 和 ≤15s TTL；Runtime 在分页/COUNT 前按权威 employee_uid/dept_code 过滤。员工和任职白名单不含手机号、登录名、metadata、私密档案或成本快照。rank_code/name 和 cost_center_code 另由 standard_costs:view 的同一策略事实与独立范围控制，签名包含字段掩码；取两份快照更早的到期时间。没有该权限不查询这些列。

岗位/职级/工资设置写入复用 People service_command_receipt，与领域更新在同一 caller-Tx；expectedVersion 冲突 409，同键异意图拒绝，同键重放保留原 ID/版本。稳定业务编码不可改变；员工、任职和工资设置仍引用的岗位/职级不可删除。工资 DECIMAL 字符串与有效日期保留精度，成本计算参数仍由 Finance 自身 settings:admin 入口提供；Finance 403 只影响参考区块。M/P 序列数量暂仅显示 Console 维护说明，不申请 system_settings 宽 scope。

09ab 不提供员工、任职、身份或 Workflow 写入，私密档案入口暂未开放。后续 09c 须由 Enterprise 自身身份承接可靠 Console 生命周期与正式审批回调；09d 须先提供增量私密表安装候选，不能回落到 metadata。

### APF-09d：员工私密档案

Host 固定 `people.apf09-employees-private-view/update` → Runtime `/v1/enterprise/people/employees-private-profiles:view/update`，均要求 personnel `employees:edit` 和员工对象范围，服务 capability 仍为 `people:enterprise-host:execute`。不借标准成本或 employees:view 放行。范围依据锁定的员工当前 employee_uid/dept_code，读取和回执重放都重新核对；浏览器不能提交 source_code、actor、scope、状态或附加字段。

白名单为 id_number、birth_date、education_level、major、graduation_school、graduation_date；身份证号输出始终掩码。保留原分来源事实（dingtalk > manual > oa_archive）；DingTalk 非空事实不可人工覆盖。update 的 expectedVersion 使用 employee row_version，私密写、员工版本递增和既有 People service-command receipt 同事务；同键原回执重放，异参/旧版本 409。审计保存目标员工、actor、requestId、expectedVersion、意图 hash 和结果 hash/版本，不将私密原文复制到共享回执 command_json；private facts 是唯一内容存储。界面仅权限允许后主动展开读取；scope/对象变化清空内存，稳定意图存储仅摘要和键，不含私密字段。

基础 APF 10 表规格保持不变。`domaininstall.ForPeoplePrivateFacts/WithPeoplePrivateFacts` 为固定一表增量候选；只添加私密表映射、不改 generation/schemaVersion、不启用 lane。plan/apply/verify/rollback 复用迁移锁、停止 Runtime、reviewHash、既有对象与行 baseline、摘要及外部引用护栏；表非空拒绝 rollback。没有映射/表时失败关闭，不回退 employee.metadata。安装候选不表示已在任何环境执行。

### APF-09c1：People 业务事实与正式审批（当批冻结；c2已补投递）

固定 11 个 U 操作 `people.apf09c1-*` 只使用 `people:enterprise-host:execute`：employees create/update；assignments create/update/delete/change/attach-workflow；onboarding list/view/create/update。人员门槛分别为 employees:view/edit、assignments:edit，Foundation 唯一 evaluator 将当前人员范围签进 ≤15s permit；actor、对象 UID/ID、完整请求意图与字段掩码均绑定。Runtime 用员工当前部门与拟变更部门复核，先复核范围再读取回执。rank/cost_center 只接受经 standard_costs:view 的全局字段许可；普通响应不返回内部审批快照。岗位/职级引用按 owning 有效字典核对，不接受浏览器提供名称或状态。

写事实、CAS、同意图 receipt、Directory lifecycle operation 在同一 caller-Tx 内提交或回滚。复用 People service_command_receipt，不新增回执表；审计包含已验证 actor/client、requestId、对象、意图 hash、结果版本与 hash。Directory operation 固定 source_app=enterprise、service_client_id=enterprise.runtime；冻结命令不等于已向 Console 投递，本阶段没有开通、激活、停用或自动 drain 入口。c2 `635acaed` 已交付目标端幂等投递、确认与阶段恢复；仍不允许在业务事务内网络投递。

主任职变更先保存 draft，再由 Host 使用既有 Workflow prepare/create 通道创建实例，以同一意图键续行并由内部 attach 操作核对实例。实例须为 People/assignments/change、相同业务编码、正式发起人与冻结 snapshotHash。待审批事实不可修改；浏览器不能传 approval_status、审批结果、来源、actor 或 attach 的实例 ID。正式回调经 Enterprise 入站鉴权 → `people:scheduler:execute` 系统通道，Runtime 在 People→Workflow 同库事务内读正式实例终态后推进，不能信任回调正文独自宣称批准。其他应用的回调映射与业务处理保持原合同。

未来生效的 approved 任职不提前修改员工当前 cache 或 Directory projection；旧主任职区间按权威生效时间截断，重放不重复建任职/operation。c1 入职候选不创建员工或 Directory 身份；c1 当时账号开通/激活按钮禁用；c2 对真实钉钉候选已启用，manual 在页面与服务端均失败关闭，提示“手工候选暂不支持自动开通，请在 Console 中处理”。manual 身份/激活合同仍待用户决定。新增固定增量安装候选仅 onboarding_cases 与 directory_lifecycle_versions（均沿用 People canonical DDL），不改基础 10 表、不启用 lane、不执行安装。

**切换与旧入口**：只有完整 `people/assignments/change` 业务元组及冻结 `/api/v1/service/workflow/callback` 路径转至 Enterprise（aud=enterprise、enterprise:workflow-callback:execute）。绩效周期与其他 People 类型保留原 People 目标、aud=people、workflow:callback；不是整 app 切换。未知业务类型由 People owning 接收端明确拒绝，不默认成功。绩效周期是否迁入另待用户裁定；旧独立 People callback 不能在绩效在途未收尾前删除。部署执行单须记录在途实例的冻结业务元组与 callback URL，完成清空/对账后才删除旧入口或以 410 拒绝，禁止双方同时产生业务投影。此次只交付代码与测试，不切换环境。


### APF-11a Finance 收支事务合同（79afbe43；范围发布/完整业务待验）

以 Domain Design §2.7 / APF-11a 补充锁序为准：Registry → Altoc customer→contract→line→obligation→billing_schedule → Finance invoice_request→invoice→receipt→reconciliation→finance_contract_summary（contract_code 升序）→unclassified_income→attachment → receipt/ledger。同表 id 升序，discovery 后锁定再复核；Finance/Altoc owning 核心复用 caller-Tx，任何摘要/审计/回执失败全回滚，无事务内网络调用。D-01/D-02 已采用，开票人≠申请人、核销人≠到账确认人；到账 draft 需显式 confirm。正式发票只由已批申请 issue；手工新建与 submit 本批不开放。B3 schema 与安装/verify/rollback 仅交付候选，不自动安装或启用 Registry。

### APF-09c2：Enterprise 入职开通与 Directory 可靠投递

- 仅真实 `provider_code=dingtalk` 且拥有非空 provider subject 的候选可进入身份预留、开通、查询与激活。manual 可维护资料，但页面和 Runtime 开通族均返回 `409 people_manual_onboarding_unsupported`：“手工候选暂不支持自动开通，请在 Console 中处理”。manual 身份绑定/激活为待用户裁定的新信任合同，本批不实现。
- 新增固定 U 操作 12 个：begin-provisioning/reserved/provisioning/failure/cancel/aggregate-status/activate 与 prepare-reserve/release/provision/status/activation-link，均使用既有 `people:enterprise-host:execute`。人员门槛为当前 `employees:edit` 和 Foundation 唯一范围投影；Runtime 在事务内复核范围，早于回执读取。浏览器五种动作只接受 expectedVersion（取消另需 reason），不得传确认结果、UID、provider 或来源。
- 五个 Console 命令从 Runtime 权威入职行冻结，使用既有 integration_operation 和 service_command_receipt，无新增 DDL。提交后重新获取 `enterprise.runtime` 身份调用 Console，不使用 People 身份，不转发入站令牌。每个阶段固定操作 ID/key、摘要、source/target deployment、原操作者；同意图恢复保留最初版本偏移。Console 以验签后的精确 `(app,client)` 判定来源，仅并列接受 `(people,people.runtime)` 和 `(enterprise,enterprise.runtime)`，不根据正文 sourceApp 授权。
- Console 身份预留/释放固定 `console:directory-identity:reserve`；开通、状态查询、激活链接固定 `console:directory-user:provision`；生命周期同步固定 `console:directory-employment:sync`，停用固定 `console:directory-offboarding:disable`。audience 为 console。候选 seed/verify 为 `Console-SQL-{Seed,Verify}-apf09c2-enterprise-directory.sql`，不执行、不复活 revoked；既有 People 调用保持其来源与精确授权。
- 开通结果须由服务端通过目标 operation 状态读取确认，之后方可原子建立员工与主任职。未来生效日不提前投影/冻结生命周期。完成还须 Directory 生效且 Platform 已确认，未来日期不得提前完成；激活 token/凭据不返回浏览器。开通在途不得用取消绕过停用合同。
- Directory 系统命令 prepare-due/claim/ack/fail 固定 `people:scheduler:execute`，仅既有已验签 Enterprise APF wake 可调用，绑定 Registry generation，拒绝用户委托和未知字段。bounded prepare 每页 100、最多 5 页，delivery 最多 5 条/25 秒。claim 使用租约和 fencing，原键重投；fail 固定错误类别，ack 验证完整目标回执身份。ACK 写入失败不误记为目标失败。Console 已成功接收即 ACK；Platform pending 是目标端下一跳，不导致源重复投递。
- 环境切换前必须核对 People 未结束的绩效审批：旧 People 还支持 performance_cycle/performance_cycles/cycle，本批仅接管任职审批。不得把未支持的回调当成功；若有在途绩效，不得直接退役旧回调或切换整 app。旧入口删除/410 以在途清零及新处理验证为前置，需协调者确认。没有在本批执行任何环境切换、定时任务启用或 grant 写入。

### APF-13a Finance 支出台账与申请

Host Finance 新增20个精确用户操作：expenses 6、claims 7、project-requests 7；合同见 `finance/docs/Host-Expense-API.md`。复用现有 Finance Host/scheduler service能力和Finance审批typed reader，不新增grant。审批仅改变申请状态；付款确认需显式expenses:confirm，并比较受信actor与落库制单人/经办人，确认后caller-Tx生成唯一台账。仅finance/expenses/claim、finance/expenses/project_expense的两个旧固定相对回调路径承接至Enterprise；payment留给13b，SourceApp不放宽。Altoc owning caller-Tx只核对合同引用，不写销售事实或billing_schedule；schema、Workflow seed/verify仅候选交付，不执行环境。

### APF-07a 线索与商机主链（5c0ffc5f；B2已装，完整业务待验）

15 个固定 U 操作使用既有 Altoc 域能力，人员动作分别为 lead 的 edit/assign/disqualify/convert/activity 和 opportunity 的 edit/assign/transition/activity，不由 edit 或 view 替代专门动作。详情读取、COUNT 和分页同 snapshot；B2 owner_uid 与 row_version 在白名单投影中返回。创建、分配、转化及重放均重新核对 current source/target owner/dept；转换的客户、联系人、商机和源在同一 caller-Tx，失败整体回滚。协议与候选安装见 [Host-Sales-API](../altoc/docs/Host-Sales-API.md)。不新增授权或审批闭集，支撑/关系/文档操作已由 APF-07b `6176fa7f` 补齐，详见下节。

### APF-13b Finance 付款与配置

Host 使用 24 个新增精确 Finance 用户固定操作：付款申请7、五组分类配置15、审批关联/审计读取2；不增加系统操作或 grant。finance/expenses/payment 与两条旧相对 callback path 精确承接，审批只改申请状态，显式确认且与持久化制单/经办人分离后才生成唯一台账。配置及两种查询保持 settings:admin + tenant:global，caller-Tx 引用锁顺序、CAS、原键回执及审计与 finance/docs/Host-Expense-API.md 一致；不直写 Altoc 07b，不返回审核快照或凭据。

### APF-07b Altoc 销售支撑与引用

14 个闭集 U 操作见 `altoc/docs/Host-Sales-API.md` APF-07b；沿用 `altoc:enterprise-host:execute`，服务能力不替代 lead/opportunity 的人员动作及对象范围。支撑读取先核 owning 父对象范围，在 Registry 同快照做 COUNT/分页；写入的父 ID、子 ID、expectedVersion 和全部字段受原 APF HMAC 绑定。联系人当前归属商机客户，主要联系人与父版本同事务；目标文档只以验签 actor 调用 Codocs owning 当前 view ACL，关联不授予权限、不写正文。删除允许清理失权引用但只操作当前父对象的引用。授权重验在旧 receipt 之前，审计与 receipt、主写全事务，无 HTTP/外部网络在事务内。配置 purpose 为闭集：opportunity-view 或 lead-convert，后者独立检查 lead:convert，不能借 view 升级转换权限。

## APF-14a 项目成本输入与历史合同（2026-10-03）

此节冻结 14b/14c 的接口，不表示命令已开放。人员资源复用 Finance `project_accounting:view/admin`；计算 authority 与项目范围绑定。个人工资/职级依据须 Finance 管理与 People `standard_costs:view` 两项当前范围同时满足，但 **Host 公开响应不返回个人工资明细**。受信通道复用 `finance:enterprise-host:execute`，不新增 grant，不将 grant 当人员权限。

### 固定操作闭集（14b 才注册）

13 个操作：`project-accounting-page/view`、`project-labor-preview/recalculate`、`project-cost-allocations-page/view`、`employee-costs-page/view`、`project-labor-history-page/view`、`project-cost-period-view/confirm-zero/close`。前 10 项对应 APF-14 盘点；后 3 项提供正式关账信号与显式零投入。写操作使用 Idempotency-Key、expectedVersion 和 expectedInputHash；同键异意图 409，同键同意图返回原回执，未知响应保留原键。

`finance_project_cost_period(project_code,period_month)` 为 Finance owning 冻结事实，`closed_at/closed_by` 非空即已关账。close 要求 Finance `project_accounting:admin`、当前项目范围、当前版本和 ready 批次；没有有效批次不能关账。关账后 confirm-zero/recalculate 均拒绝，不开放 reopen；关账调整另建后续调整批次，本轮不开放绕过入口。close 不改变 Aims 工时状态/People 快照，亦不等于总账全公司关账。

confirm-zero 仅在 owning 读取完整项目/月工时集合为空时写入，绑定该空集合 input SHA。后来新增任何工时使零确认失效；存在 returned/draft/submitted 等未审核工时即整月 not_ready，不能靠确认零投入抹去。无工时且无有效确认仍 not_ready。重算比例可以大于 1，不封顶或跨项目归一化；CN 标准月小时分母、月末任职、入离职整月标准成本不变。

### Typed owning 输入与锁序（先于实施冻结）

接口在 `data-runtime/internal/projectcost/contracts.go`：AimsInputs、PeopleInputs、FinanceInputs 接收同一 caller `*sql.Tx`；CalendarReader 在事务外读取 CN 月。无 arbitrary table/path、trusted bool、用户 actor 或 capability 参数。所有 authority 由 owning 服务/编排的签名 permit 复核；接口存在不表示可以绕过鉴权调用。PeopleSnapshotCode 可空，Finance 不隐式写 People。14b 实现 SQL owning readers 与确定性计算，14a 不开放业务路由。

锁序固定：Registry generation SHARE → People employees（UID）→ assignments（id）→ standard_cost_rates（id）→ Aims projects（id）→ 必要 work_items（id）→ time_entries（project/date/id）→ Finance people_cost_parameter（id）→ 所需 M3 confirmed 收支事实（按 APF-11a 表序）→ finance_contract_summary（contract_code）→ finance_project_cost_period（project/month）→ finance_project_summary（project/month）→ finance_employee_cost_snapshot（UID/month）→ finance_project_cost_allocation（code）→ finance_project_cost_batch/item → service_command_receipt/integration_operation 最后。无需某类事实不取得其锁；反向重算/历史/确认不可反序。预览发现集合，锁后 owning 复核集合 hash，不一致拒绝，禁止向已锁定的后序对象反向追加 People 锁。

**工时幻读防护选择**：14b 为这条共享写事务提供 generation-fenced REPEATABLE READ；Aims owning reader 使用既有 `idx_project_date(project_id,entry_date)` 对该项目/月全状态范围做锁定读，包括空范围 next-key/gap。不先过滤 approved，不漏新增、删除、审核退回；与现有写端行锁冲突串行。执行前由隔离 MySQL 实证空范围 INSERT、DELETE 和 approved→returned 三类阻塞/回滚及重读行为；当前 READ COMMITTED 的通用 BeginWriteTransaction 不足以防幻读，禁止直接调用后声称有范围锁。此方案不新增 project-period 输入代次，避免只给部分写端加代次造成漏记；若隔离证据发现范围锁不满足，则在实施前改成全写端代次方案并重新审查，不能降级。

People/Finance 费率选择也必须锁定候选范围并重新匹配月末 effective date；不只锁预览命中的那条记录而遗漏并发新有效版本。外部日历不能事务内网络读，保存内容/来源版本/hash/获取时间，历史仅读冻结事实。

### 完整集合与不可变历史

安装候选六表：Finance period、batch、batch_item、employee_cost_snapshot、project_cost_allocation、project_summary。batch/input/calendar/item 的冻结 JSON 为服务端私密计算证据；公开列表使用独立 PublicSummary 投影，不序列化这些内部结构。批次创建后只读，不 UPDATE/DELETE；当前 projection 可更新，旧历史不 join 当前 People/参数重新计算。People 已确认留档不可覆盖。批次 receipt_key 是完整作用域回执标识，绑定 actor/操作/项目/月意图，不能只存浏览器裸键导致跨人冲突。

recalculate 全量替换同 project/month/source/rule 托管 labor 集合，旧项 reversed，其他来源保留；not_ready 撤销旧集合、金额/毛利 NULL，不以部分有效工时小计作完整成本。已确认 M3 财务事实由 Finance owning 聚合读，不由 BFF 传入金额；summary 与 cost projection/批次/receipt 同 Tx，失败全部回滚。双项目共享员工月投影不得使旧批次金额漂移。

### APF-18A signed machine wake and People frozen approval recovery (075db5f0; default disabled)

Owner is the existing Gateway five-minute cron, separately registered by protected exact host/tenant/environment/Enterprise deployment/generation/domain bindings and disabled by default. Host verifies the Gateway signature including domain, then obtains a fresh `enterprise.runtime` system token with exact `<domain>:scheduler:execute`; no U scope, forwarded user token or browser actor is accepted. Runtime checks Strict issuer/audience/client/deployment/live grant state and Registry scheduler authority/generation. Dual data-runtime/tenant-runtime qualified scheduler seed+verify are candidates only.

Three new fixed operations: user `people.apf09c1-assignments-request-workflow` and system `/v1/enterprise/people/assignment-approval:pending`, `:bind`. User submit freezes original initiator, authoritative form/hash/assignment+employee IDs/version and Workflow key in People integration_operation, in the same caller transaction as pending assignment and existing user receipt. Ordinary drafts are never scanned. Machine recovery needs no active browser session but cannot invent an initiator or rewrite the frozen intent. Future effective dates do not apply employee projections while creating/binding approval.

Pending validates the current row against frozen command and version. Bind locks employee then assignment then reads the real Workflow instance through the existing narrow owning reader; app/resource/action/biz/initiator/hash/status must match. No network calls occur in transaction. Request-driven and machine bind both acknowledge the same operation; response loss retries original key and the Workflow idempotent creation contract. A different instance/changed frozen intent is rejected. Registry generation SHARE remains pinned without a SHARE→UPDATE upgrade. Approved/rejected callback stays the existing formal system callback and is not a machine-provided result.

Host families are bounded (at most 3 approval intents / one Directory claimed command per wake), issue fixed count/unavailable results and retain unfinished commands. Domain signature prevents wake substitution; gate disabled, wrong actor/client/audience/deployment/generation/grant return closed failures, dependency failures remain 503. Legacy owner retirement, notifications/purpose migration, other People approval types and raw-command replay remain B/C gaps; installing this code does not authorize enabling owners or modifying grants.

### APF-16a Host 投标（fc725e44；B5环境安装待验）

投标 ten-operation 闭表为 `tenders-page/view/create/update`、`tender-agencies-page/create`、`tender-members-add/remove`、`tender-milestones-create/update`。均为 Enterprise 用户 U 通道 `altoc:enterprise-host:execute`，不新增 tender 人员资源或服务 grant；人员门槛明确为 `opportunity:view/edit`。无商机的手工投标仍须 edit 与投标负责人/部门范围。团队分工仅业务事实，不授予任何应用权限或 Aims 项目关系。

Runtime 从投标行取当前 owner/dept，读列表在 COUNT/分页前过滤、详情同一快照复核；存在的商机和客户引用还须满足当前同一签名 opportunity 范围。写入复核来源、拟变更目标与引用的权威行后才读取旧 receipt。customer/opportunity/contact/agency pair 必须存在且客户一致；不接受前端“可见/经理”事实。所有修改携父投标 expectedVersion，子对象不能跨父；主写、父版本推进、audit 和 service_command_receipt 同事务。删除团队成员仅删除业务分工，原键重放不重复删除/审计。无 Workflow 审批、调度或 outbox 扩展。

锁序为 Registry generation SHARE → 销售 stage gate（存在时，沿用销售写入串行门）→ 当前投标 → customer → opportunity → contact → agency → 当前子对象 → receipt/audit；没有 stage 时手工投标可创建（销售旧写入本身拒绝未配置 stage），不臆造商机。Tenders 的 caller-Tx 不作网络调用。row_version 冲突为409；范围拒绝403、对象不存在404、未安装四表503。金额是非负固定十进制字符串，不由浮点 round-trip 冻结。

安装候选 `domaininstall.ForAltocTenders/WithAltocTenders` 只新增 B5 的 altoc_tender/agency/member/milestone 四物理表、无 FK/CASCADE、无 Registry 写入或现有域数据覆盖。复用 plan→reviewHash→Runtime stopped→迁移锁→apply→verify 与空表 rollback；新增 Runtime 操作10个、无 grant。`hzy-enterprise-add-apf --subset altoc-tenders` 已由16b `32244c98` 接入固定子集框架，串联/逆序回滚测试已交付。任何真实安装另行批准。

### APF-16b 服务协议、覆盖与项目关系（32244c98；B5安装/业务待验）

- 14 个固定 U 操作：service-agreements page/view/create/update；service-coverages page/create/resolve/suspend/end；service-projects page/bind/set-default/suspend/end。人员统一 `contract:view/edit`，签名委托 actor/tenant/deployment/object/TTL 与规范意图绑定；使用 `altoc:enterprise-host:execute`，无新增 capability/grant。
- 范围来自 Foundation 唯一 evaluator 的编译结果。分页/COUNT 前同时过滤当前合同和客户范围；详情/子列表同一快照。新建从所属合同权威派生客户；不可改合同归属。锁序 customer→contract→contract_line→agreement→child/siblings→Aims→Assets→receipt/audit。多域 Registry generation 栅栏同 caller-Tx；跨域锁参与者须 unified write 就绪，但 owning 核验不改目标域任何事实。禁止持锁网络调用。
- Aims `CheckServiceProjectTx`：精确 code 读取权威 project/member；不同合同、archived/completed 拒绝；本合同项目或当前 leader/active manager 可选。关联不创建项目、不授予权限、不修改合同绑定。默认项目由协议行锁串行化，只能选择 active 关系；暂停/结束清除默认。
- Assets `CheckServiceCoverageTx`：只核验协议客户的正式资产/环境身份，不暴露通用资产查询；客户必须精确相等。双对象必须有唯一有效 asset/environment relation。计划属于同一合同；pending plan 不直接 active，仅 resolve 经正式身份核验后生效；禁止 legacy/confirm-legacy。跨客户、悬空引用、混合计划编码不能被当成已解析目标。
- 所有写入带父协议 expectedVersion（创建除外）+稳定 key；既有 service_command_receipt 与审计同事务，失败全回滚。旧键重放先重验当前合同/客户范围和目标资格；版本/状态只在执行新业务时复核，不阻止同键回放已确认结果。子对象必须属于当前协议；不接受客户端 source/状态/额度消耗/解析结果事实。
- 六表 B5 只建安装候选：altoc_contract_delivery_asset_plan、altoc_service_agreement、altoc_service_agreement_coverage、altoc_service_agreement_project_rel、altoc_maintenance_contract、altoc_service_entitlement。旧维保/权益只读，service_agreement_asset 不作为第二套新写来源。安装、激活、真实授权/浏览器验收另行执行；本批无环境操作。

### APF-16c 工单、派发与同库回写（95c8ff35；B5安装/业务待验）

- 九个固定 U 操作：service-tickets page/view/create/update/close/reopen；service-ticket dispatch/dispatch-resume/dispatch-view。仍为 `altoc:enterprise-host:execute`。人员 `service_ticket:view/edit/close/reopen`；重开是独立动作，新增 manifest action 不默认授予任何角色。签名 actor/tenant/deployment/action/object/TTL/当前范围与规范意图由 Foundation 唯一 helper 产生，Runtime 在原 receipt 前复核。无 capability/grant/Workflow 闭集扩展。
- 新模型必须选择正式服务协议，Runtime 权威派生 customer/contract；客户和工单负责人/部门范围在 COUNT/分页之前和锁内复核。修改不接受状态、耗用额度、项目归属或投递 generation。expectedVersion 冲突409；业务/receipt/audit 同 caller-Tx。close 与 reopen 各需自己的许可，终态不接受普通编辑，重开不重开 Aims 事项、不退款。
- 派发目标顺序为显式项目、工单已绑定项目、服务协议唯一 active 默认项目。**新统一模型不采用旧合同项目猜测兜底**。Aims owning typed Prepare/Apply 在同一 Registry 多域写事务中核验项目合同/当前经理关系、生命周期、处理人成员关系与来源自然键；不能改绑到其他项目。旧键重放前仍复核来源与目标资格；新意图恢复不重复建事项。服务协议过期、额度超限或默认项目歧义均失败关闭；沿用绝对分钟 SLA 与累计额度规则，不引入暂停计时规则。小时额度按已耗用与预计工时检查，不新增预占模型。
- 全局锁序 Altoc→Aims→Workflow，Altoc 内部所有 customer→contract→agreement→ticket ID 升序预锁，之后才允许 Aims 工作项/项目锁。状态动作、批量 patch、完成申请与正式完成回调均在开事务前固定事项集合；原状态/人员/范围门槛不变。Runtime 构造时注入窄 owning 回写接口，HTTP 无选择器或“可信事实”开关。仅精确安装新表且 unified 的 lane 参与，缺 owner/绑定则503，不能退到远端投递。
- Aims 在 caller-Tx 派生真实状态、源工单码、项目码、工作项键、实际工时与首次响应/解决时间；先更新 service extension 再读取快照，Altoc 当前 binding 锁内复核。generation 旧值跳过、同代异摘要409，累计耗用只加差额，终态不会被迟到的结果重开。一项回写失败使整批 Aims 修改、Altoc 配额/状态/审计全部回滚。不产生新 HTTP/outbox；独立旧模型保持原投递路径。
- `altoc-tickets` 安装候选仅新增 `altoc_service_ticket` 一表（row_version/delivery_hash），依赖已安装 sales-B2/services、Tender 可选。固定 DDL 无 FK/CASCADE，generation/既有域/原模式不变；沿原 plan/apply/verify/空表 rollback，已有业务时不可 DROP。本批不安装、激活、改 grant 或运行浏览器。正式启用前必须由协调者盘点旧 ticket-result 在途命令并对账，同一业务键不能同时由独立旧投递和新同库回写拥有；旧 owner 的关闭/收尾属于 APF-18C，不能把本批提交视为退役完成。

### APF-16d 续约基础记录

Enterprise 的 `altoc.apf16d-renewals-{page,view,create,update}` 固定操作仅使用既有 `altoc:enterprise-host:execute`，人员门槛为 `renewal_opportunity:view/edit`。签名 permit 绑定 actor/tenant/deployment、操作、对象 ID、完整意图、当前权限修订及短有效期；Runtime 使用唯一数据范围实现复核。

记录客户必填，可选合同必须属于该客户。读取的 COUNT/分页在记录与关联客户/合同范围过滤之后，同一快照返回姓名标签与白名单字段。写入锁序为既有 sales stage gate → 当前及目标客户（ID 排序）→ 当前及目标合同（ID 排序）→ 续约行；在回执查询之前复核当前源/目标范围及权威归属。更新须 expectedVersion；同意图键回放，变意图 409；回执、记录、审计同事务，失败回滚。原客户/合同失权后旧键重放仍拒绝。

本批只保存续约记录，状态 won 不代表合同生效。不接受 opportunity_id、旧 maintenance_contract_id 或覆盖日期，不创建/绑定商机、不延长协议/覆盖，续约以新合同/新服务期表达。`altoc-renewals` 是增量安装候选；只建一表，保留 generation 和其它域，按原 receipt 校验逆序回滚，非空业务证据禁止删除。未执行安装或配置变更。

#### APF-14b 实施补充（6aed7346；新增输入/投影安装与范围待验）

13 个成本操作使用 `cost` 闭合输入与签名 `authorization.costScope`（all 或显式 projectCodes、People salary 范围）；对象为 projectCode|periodMonth|code。Finance project_accounting:view/admin 与 People standard_costs:view 联合范围只能由 Host evaluator 编译，浏览器不得提交 scope。CostIntent 与 scope 完整进入现有 APF HMAC canonical。14c 配套 Host 后才开放页面；本批无 grant/环境操作。

Registry 新增显式 REPEATABLE READ 写事务入口，保持旧 READ COMMITTED 入口不变。People assignment/rate 通过主键顺序锁定完整候选配置集合；UID discovery 不加 Aims 业务锁，锁后全状态 UID 集合变化返回409，不反向补 People 锁。Aims 工时仍为 idx_project_date 项目月范围锁。

M3 取 Finance receipt→reconciliation→expense 顺序，只聚合已确认父到账的 active 核销及 confirmed 支出，按到账/支出日期归月；不改变收支或 Altoc 状态。为防核销跨项目重新归属漏掉父锁，目前锁定完整 receipt 父集合、目标项目 reconciliation/expense 候选集合；不保存其它项目金额或身份，不查询 contract_summary（没有该事实依赖）。该保守锁法可能使财务并发串行，后续优化必须保持父子集合与锁序证据。财务输入 hash 纳入计算 inputHash，作为重算预览 CAS 与批次证据。

Preview 返回预览 inputs hash 与当前期版本；recalculate/confirm-zero/close 使用这组值。重试原键在当前范围复核后回放旧 receipt，不因期间已关账重新执行；新键 CAS/关账状态在 receipt 业务回调内校验。员工月 projection 可更新，不可变 batch/item 永不更新或删除。项目/历史输出使用金额/readiness公开列；employee-costs 只输出员工成本总額并叠加当前 People salary 范围，不输出工资分量。

M3 写端联动：B4 映射存在时，Finance 收支命令在 owning 父对象/contract_summary 锁后、receipt 前，以项目/月排序锁定已存在的 cost_period→project_summary；业务回调只用同 Tx 非锁定聚合刷新已确认核销/支出及毛利，不反向获取新的 receipt/expense 锁。相同期间通过 period 行串行，READ COMMITTED 写端在取该锁后聚合，避免最后提交覆盖其它已提交收支。没有 B4 时原 M3 行为不变；没有成本期间不隐式建成本批次；成本关期不禁止合法收支事实。批次不可变，M3 更新只修改当前财务 projection，不改历史成本或工资证据。

#### APF-14c Host 接入补充

13 条成本用户路径纳入 Foundation 精确 APF 签名白名单和 Enterprise Runtime 用户映射；canonical 追加 CostIntent 与 costScope，TS/Go 共享 golden fixture。人员资源/受信 transport capability 沿用 14a，不增加 grant。BFF 对公开响应做白名单投影，个人月标准成本只在 Finance project_accounting:admin 与 People standard_costs:view 双重当前范围内返回，工资组成/内部冻结证据不出 Host。

首算列表复用 project-accounting-page/view：Aims 项目集左连接当月 Finance 摘要，签名 Finance 项目范围在 COUNT/LIMIT 前下推，未计算项目为 not_ready。跨域编码 JOIN 使用 BINARY，避免 owning 库历史 collation 差异或大小写归并。员工月快照详情允许空 projectCode，但必须在 costScope 项目集合的分摊成员子查询及 People 当前范围中命中 id；不增加任意员工读取入口。

APF-14c 公开托管 labor 分摊按项目/月/规则/状态聚合为总额，公开 group code 不含个人 UID，basis_value 为 NULL；不允许用旧的 per-UID CA code 读取个人分摊。避免项目管理员以已知工时和确定性个人行编码反推个人月工资。未托管的手工/资产等分摊仍保留原行；员工月标准成本继续走双重权限接口。

### APF-16e Enterprise 知识关联与只读摘要（2271f417；目标seed/安装/业务待验）

五个固定 U 操作 `altoc.apf16e-{customer-assets-summary,customer-documents-page,service-ticket-knowledge-link,service-ticket-knowledge-resume,service-ticket-knowledge-view}` 使用 `altoc:enterprise-host:execute`，人员分别要求 `customer:view`、`service_ticket:edit/view` 与当前 owning 对象范围。客户权限不能代替 Assets 或 Codocs ACL。Assets 摘要使用 Assets 唯一范围编译器按 deliveries:view 与 environments:view 求交；Codocs 摘要逐文档复核当前普通 ACL，COUNT/分页只包含有权对象。目标整体无权返回 `access=denied`，不带数量/UUID/标题；依赖故障仍 503。

知识关联只接受已有 UUID 和工单 expectedVersion。Runtime 按当前客户→合同→工单锁序重验范围，在同一 caller-Tx 中冻结两份命令（序号 1/2）、reserve 回执、pending 投影与审计；事务回滚不能遗留 operation。冻结 actor、权威 customer/contract/project/delivery/asset/environment code、目标 deployment 和 command digest。Host 提交后分别以 **enterprise.runtime 新签 token** 调两个精确目标：

| 目标 | 固定 Service API | 入站 capability | 目标 Runtime scope |
| --- | --- | --- | --- |
| Assets | POST /api/v1/service/enterprise-knowledge-links | assets:asset-link:create | assets:asset-link:create |
| Codocs | POST /api/v1/service/enterprise-knowledge-links | codocs:knowledge-link:create | codocs:knowledge-link:create |

目标先完成 JWT audience/实时身份与撤权校验、受信 tenant/目标 deployment 以及短时 service-command HMAC，再使用自身 service identity 获取 Runtime token，不能转发入站 token。Runtime 要求精确目标 client (`assets.runtime`/`codocs.runtime`)、部署与 scope，重新验证源 enterprise.runtime 的签名命令上下文及 actor 委托。Assets 从 Console 固定 purpose `knowledge_link_deliveries` 求 deliveries:edit、`product_adoption_environments` 求 environments:view；其授权 JSON 由目标 token 独立 HMAC 绑定 method/path/tenant/deployment/actor/digest，Runtime 在旧回执前复核当前目标范围和交付事实。Codocs 在同一 Serializable Tx 内锁文档并复核既有 owner/share/relation 可读 ACL，再读回执。

两个目标仅写关联与不可变回执。Codocs 的 service principal 关系全部 read/edit/comment 标志为 false；Assets 关联不扩大资产对象范围。**不创建、复制或发布正文，不授予他人文档访问。**命令严格固定 11 个字符串字段，按 Go 字典序规范编码；不接受任意目标、源路径、授权事实或客户端 receipt。

Host 验证每份目标回执的 operation/schema/digest/key/UUID/类型，再以新求值短期 U permit 写 checkpoint。中途失败、响应丢失均保留第一次 frozen actor/key/command；请求驱动 resume 每次重验源、Codocs 和 Assets 当前权限，目标以原 key 回放原 receipt，两个目标都确认后才把工单标为 linked。此族为用户恢复路径，不新增 scheduler owner；现有 APF wake 的闭集只恢复审批，不认领本族。撤权后禁止恢复，故成功目标与 pending 状态可等待原用户恢复权限或后续独立对账决定，不允许机器冒用用户。

**切换门禁**：新合同的 grant seed/verify 为候选 `Console-SQL-{Seed,Verify}-apf16e-knowledge-links-candidate.sql`，只有经批准备份后才能执行；Runtime audience 从部署实际配置取 data-runtime 或 tenant-runtime，不固定生成额外 audience。先验四行精确映射/绑定、两项目标 Runtime 与 App 合同，再启用用户入口。旧 Altoc 精确/宽能力入口、既有冻结命令、owner 与回执均保持原样，不能把旧 source_app=altoc 命令改为 Enterprise；在途旧队列须由原 owner 原键收口，另批退役。回滚撤回新入口与新版本，不删已成功关联/回执；停用新 grant 需单独审批。

### APF-16f 产品反馈接收落点的 owner 门禁

本批保留现有 Aims 产品反馈投递 owner `aims.runtime`。状态与进度命令的生产者可信来源、目标逻辑应用 Altoc、精确 capability、冻结命令/schema 与原幂等键均保持原合同。Enterprise/Altoc 只新增接收落点，不提前把生产者改成 `enterprise.runtime`，不转发入站令牌，不伪装来源。

owner 迁移、旧在途命令对账与收口统一由 APF-18B/C 处理；该门禁通过前不得退役旧 Aims owner或给同一任务启用第二个 owner。用户恢复只重放原冻结意图，读取评估和进度，不补充证据、不重新提交已拒绝需求、不扩展 Workflow 闭集。候选代码和安装制品不等于已执行环境切换。

### APF-16f 原键恢复与旧 owner 接收合同

- 用户固定 U 操作为 `altoc.apf16f-product-feedback-view/submit/resume`，要求工单 edit 范围；提交/恢复另复核当前产品 `product_requests:create`。请求不能提交 actor、product、审批状态或附加证据。首次冻结原作者、源摘要、命令、operation/key；同事务审计。恢复只调用 Aims owning caller-Tx 核心，重放前重验权限；拒绝后不能生成第二份需求。
- 接收端为 `/altoc/api/v1/service/product-feedback/status|progress`，保留 Aims 原 `aims.runtime`、aud=altoc、`altoc:product-feedback:update-status|update-progress`、原信封与幂等键。先做 Console 实时内省、来源/目标部署与命令签名验证，再重新取得 Enterprise 身份，以既有 `altoc:scheduler:execute` 调 Runtime 固定接收操作。入站令牌不转发。版本单调、同版本异摘要冲突；状态和进度只读展示。
- Aims 投影生产者及其 outbox owner 不变。本批不新增调度或 Workflow。用户冻结 operation 不属于 APF-18A 机器审批恢复闭集。owner 迁移、旧在途来源/绑定收口及路由切换统一留待 APF-18B/C；部署前必须核对新接收表已安装、旧源绑定与新目标部署可解析。

### APF-16g 服务财务与成本只读摘要

- 两个固定 U 操作：`altoc.apf16g-customer-service-finance-summary`（customer:view）和 `altoc.apf16g-service-cost-summary-view`（contract:view）；沿用 `altoc:enterprise-host:execute`，没有新 capability、grant、表或后台 owner。
- Host 用 Foundation 唯一 evaluator 生成 Altoc 对象范围，并从同修订的 Finance 快照投影 `invoices:view`、`receipts:view`、`reconciliation:view` 各自 all/self/none，或 `project_accounting:view` 的 all/projects/none；这份窄投影作为 opaque 字符串绑定在已有签名 U 意图中，含 actor/tenant/deployment、≤15秒有效期，不接受浏览器事实。
- Runtime 同一只读快照解析 Altoc 与 Finance Registry。先复核客户；服务协议还复核其合同与客户。客户摘要仅统计该客户服务协议对应合同的正式发票/确认回款/有效核销，逐资源责任人过滤在金额/COUNT 前；不同币种分别统计。服务成本仅取当月有效协议项目关系与 Finance 授权项目的交集，再由 Finance owning 核心读取 APF-14 公共核算结果。
- 无权限返回 `access=denied`，不解析 Finance 表、不查询数量、不泄露隐藏项目总数；部分资源拒绝只拒绝相应区块。依赖故障不可伪装成无权限或零金额。未核算返回 `not_ready` 与空金额，不返回个人工资、员工成本、输入 hash 或原始核算日志。范围超过1000对象整体失败503，不部分成功。
- 两条 Host GET 入口为 `/altoc/api/v1/customers/:customerId/service-finance-summary`、`/altoc/api/v1/service-agreements/:agreementId/cost-summary?periodMonth=YYYY-MM`，响应 `private,no-store`，白名单重建。只读，不提供重算/恢复/批量写入；旧 service_cost_summary 与旧 maint 模型不启用。

### APF-17b 离职事项与 Assets 协调锁序（候选，环境未启用）

Registry 代次 SHARE → People employee UID 升序 → assignments → offboarding case → tasks 按类型 → Assets recovery 根 → asset_items 按 id → audit/receipt。People/Assets owning helper 仅接受 caller Tx 和注册表映射，不自行 Begin/Commit，不接收浏览器 trusted/source 标志。六个用户操作 list/view/create/arrange/confirm/cancel，使用现有 People Host capability 与 offboarding_tasks 的 view/admin/confirm/cancel 精确动作；当前 scope 复核先于旧 receipt。未归还阻断资产协调完成，不阻断已生效离职及 Directory 安全撤权。责任人须 active 且不是离职人，期限由 HR 明确提交；自动事项不默认期限或责任人。17c 外部账号 receipt、17d 通知/自动 delivery 不在本批伪造为成功。

### APF-17a Enterprise HR 来源与部门映射（候选，环境未启用）

- 人员合同仍是 People `hr_source_sync:view/admin/execute` 三个独立动作；Foundation 唯一范围投影只接受全租户 HR 字典权限，员工范围不升格为全公司映射管理。固定 U 闭集为 `hr-state` 和 mappings/changes/jobs-start/jobs-cancel/jobs-retry 各 prepare/confirm，共11个；复用 `people:enterprise-host:execute`，permit 绑定 actor/tenant/Enterprise deployment、动作、意图、对象 dingtalk 和≤15秒 TTL。没有公开 confirm BFF，也不接受浏览器的 actor/source/targetConfirmed。
- Enterprise 重新取得自身 `enterprise.runtime` → `console` 服务令牌，使用既有 `console:hr-source-sync:view/admin/execute` 精确 capability。Console 增量接受精确 `(enterprise,enterprise.runtime)` 与旧 `(people,people.runtime)`，不接受交叉配对；服务命令验签仍绑定 tenant、源/目标部署、短时效、命令摘要、原键。历史 `people.hr-source-sync.dingtalk.*` 是固定操作名，不代表伪造 People 身份。三个 grant 仅 seed/verify 候选，无环境写入。
- `people-hr-source` 安装子集只新增 `people_hr_source_state` 一表，generation/schemaVersion/既有表和视图不变。准备命令先在统一库 Repeatable Read caller-Tx 锁固定 dingtalk 根，冻结完整 Console 命令/actor/key/version 到既有 integration_operation，并写既有 service_command_receipt；同键不同意图409。已冻结命令只重放原命令，不能从新快照派生。Console确认以后，另一个caller-Tx按员工→任职锁序归并已确认 aliases，推进 operation 与清除闸门，与回执同事务；归并故障全回滚，闸门仍为pending。每次恢复先重新授权，撤权旧键403。只有原actor可恢复；需要他人接管属于后续可审计恢复合同，不允许换actor/换key。
- 来源命令尚未确认时禁止新同步/新映射命令；job-start 的 `sourceReady` 由 Host 读取 Console 映射总数后计算，签入 permit，浏览器不得提供。Runtime仅在新命令冻结时要求全部mapped；原键已冻结命令可恢复，不因来源后来改变而丢失目标回执。该短期前置事实不改变原命令摘要/回执意图。
- 本段只迁 HR 控制入口和引用归并；Connector、HR provided/empty/absent/invalid 的既有生产者及目标合同不变，不批准任职、不提前生效未来任职、不修改工资/职级/工号。部门别名归并保留任职的生效日、审批状态与历史顺序，仅转换稳定目录引用及row_version。本段未证明旧 HR 接收器已满足 R17-01 字段所有权/冲突复核与 R17-02 单调 revision；旧 sync.go 还引用新 APF schema 不存在的 monthly_standard_cost。启用同步前必须核验 Connector→People 目标的新 schema 兼容与这两项规则，未通过不得启用；不以本段控制入口迁移视为事实接收链已完成。旧People用户入口不在本段退役；任何环境启用需安装候选、三条精确grant逐行核验，以及Console/Connector/People事实目标链验证。不得因UI的job成功把Directory/Platform安全投影标为成功。
- 页面权限显式加载并区分失败；映射、来源差异、作业分区。未确认意图只在内存保存，刷新可从Runtime恢复原actor的冻结意图；没有HR记录/token写入浏览器storage。危险操作useConfirm；响应private,no-store。18B通知、17b离职/Assets与成本/绩效不属于本段。

### APF-18B1：Enterprise 到期通知（默认关闭，候选）

六族固定 S 合同为 `sales-due`、`billing-due`、`issuance-due`、`reconciliation-due`、`handover-due`、`asset-recovery-due`，各有 `scan-due / published / closure-ack`，共 18 个操作。唯一 owner 是既有 Gateway 签名 APF wake → Enterprise，不新增 cron。Runtime 严格检查 `enterprise.runtime`、部署、实时 grant、unified generation 和对应 `<domain>:scheduler:execute`；不接受用户 actor、U permit 或宽 scope。Foundation 系统通道登记同一精确路径集合。

来源只取统一库权威的直接责任人、截止时间和状态。销售任务优先于同源 lead/opportunity 下一步，开票/核销相互独立；People 两族读离职交接和资产回收**协调任务**，不把提醒视为 Assets 已归还证据。不会推进商机、开票、核销、归还或离职状态。空责任人、广播 UID、未来时间、非活动状态不产生通知。发布前 Console subject eligibility 复核 active 和固定人员 `view` 门槛；通知仅站内，正文不含金额、薪资、私密档案或业务数量。

每域新增可独立安装/verify/rollback 的 checkpoint、cursor、audit 三表（安装子集 `<domain>-due`，仅候选）。冻结键 `apf-due:<family>:<source-kind>:<id>:<generation>`，事实摘要固定直接责任人/截止时间；扫描每族最多 20 个源行与 20 个待收口行，分别轮转，不因早期已发布记录饿死后续记录。冻结和审计同事务，锁序为来源行 → checkpoint；扫描先锁本族 cursor。发布成功后只记录目标实际回执；同键同回执幂等，不同回执 409。负责人/截止/状态变化先取消或解决旧 actionable，确认关闭后才产生新一代。

发布响应或 ACK 不确定且来源已变时，只用原 payload/key 查询 Console 回执（`probeOnly`，仅验签 Enterprise 身份和 APF 类型可用，不创建通知）。查到后记录并关闭；查不到**不能**排除原请求仍在途，保留未知，不强行关闭、不换键。此类未知缺少自动判定的安全依据，需上线后对账；本批不提供强制成功或数据库修补入口。通知 ACK 丢失且事实未变时按原键重投，Console 目标幂等。关闭使用同 actionable key 和稳定版本，关闭 ACK 丢失仍按原键重试。

实际 sourceApp 为 `enterprise`，不冒充旧三域来源。新增 APF descriptor 使用 Console→Enterprise `enterprise:notification-detail:authorize`，再用三域精确 P scope 复核当前直接责任人与 checkpoint/fact；Console 自己复核对应业务人员权限。旧三域通知仍走原 P 目标，不整组切换旧通知。详情不返回金额或无权数量。

开关门禁：Enterprise 六个 `HZY_ENTERPRISE_<DOMAIN>_<FAMILY>_ENABLED` 默认关闭（准确名称见 `enterpriseAPFDueDelivery.ts`）；旧同族开关必须显式 `false`，Runtime `enterprise.dueNotifications[family]` 的 `enabled` 和 `legacyOwnerDisabled` 也都须为 true。销售新族的 `HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED=false` 是显式退役确认，旧源码没有该族独立开关，不能把变量缺省当退役证明。启用前必须完成旧 owner/在途通知核对；本批不执行环境配置或 seed。调度复用 APF-18A 双 audience 六行候选；P 与 Console 发布/资格/回查使用 `Console-SQL-{Seed,Verify}-apf18b1-enterprise-notifications.sql`。既有 revoked 或绑定不符行不得复活、覆盖，另请批准。

同域两个通知族并行但各有独立 cursor/故障计数，共享 20 秒启动预算；预算内才开始下一目标调用，单次调用沿用现有传输超时。通知与 Directory/审批恢复并行，不累加各队列等待时间、不注册额外 owner。真实 cron CPU/壁钟验收、安装、grant、旧 owner 退役均是后续环境批准点。18B2 死信族未在本批实施；Workflow、Aims 反馈投递 owner 和 People 非任职审批归属不变。

通知键对应 v1 固定线协议：标题/说明/正文/站内落点、descriptor、metadata 与冻结来源字段的派生规则必须保持不变（Host 契约测试锁定 v1 文案和落点）。不得在旧 checkpoint 未收口时直接替换模板或派生规则；未来模板变更须另定协议版本并保留旧键的原 payload 重建能力。本批安全落点为 Enterprise 通知中心，业务细节继续经 P 实时授权；不拼接输入 URL。

### APF-18B2 Enterprise 死信通知与关闭（候选，默认关闭）

- Altoc/Finance/People 各四个固定 S 操作：`pending-dead-letter-actionables`、`dead-letter-actionable-published`、`pending-dead-letter-closures`、`dead-letter-closure-acknowledged`。唯一 owner 是现有 Gateway 签名的 Enterprise APF wake，无新 timer。精确 `<domain>:scheduler:execute`，enterprise.runtime、实时 grant、部署及 Registry scheduler generation 验证；禁止 U/purpose/用户 actor 替代。
- 每域 Runtime `deadLetterNotifications[domain].enabled && legacyOwnerDisabled` 与 Host `HZY_ENTERPRISE_<DOMAIN>_DEAD_LETTER_NOTIFICATIONS_ENABLED=true` 双重默认关闭；Host 要求旧 `HZY_<DOMAIN>_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED=false`。Altoc/Finance 旧请求内通知调用也须实际停止、在途对账完成（APF-18C），不是仅设置新变量。legacy 未确认或该 Host 部署存在非 enterprise.runtime 的旧 operation 时失败关闭，不自动接管。
- 原始命令事实保留 source_app（Altoc/Finance 是各自域，People 是 enterprise），不作为新投递服务身份。出站重新获取 Enterprise 的 notifications:publish；Console 精确验证 enterprise.runtime，源应用 enterprise，封闭 moduleAppCode。只站内投递；沿用原 actor active 优先、配置 active 收件人回退，未找到收件人仍失败，不扩展角色或全员通知。
- 复用每域既有 integration_operation_dead_letter_actionable，caller-Tx 和 generation 栅栏；无 schema/新 U 操作。每次至多3个创建、3个关闭，20秒开始预算，失败只回报计数、不输出原错误/正文。创建 ACK 冻结通知 ID 与实际收件人；丢失 ACK 原键重试；恢复发生在 ACK 前仍先创建，再按原 key/version/收件人关闭。通知失败绝不推进原 operation 为成功，也不能代理人工 replay。
- 详情使用原 P 路径，`apf_<domain>_dead_letter` 两字段 descriptor。Console 当前 `<domain>/integration_operations:view` 先判权，Runtime 再精确核对 notificationId、冻结收件人、当前死信状态/version、未关闭；其它用户/大小写不同 UID/旧 generation 均不可读。企业通知链接只指向 `/enterprise/notifications`，不拼接错误文本或内部URL。
- grant 制品复用 APF-18A 双 audience 的三个 domain scheduler grant，以及 APF-18B1 三域双 audience P + Enterprise notifications:publish + Console→Enterprise P 的 seed/verify，不新增宽 scope。候选不等于环境启用；release 必须核对两个 audience 与发布 grant 后再开同族 owner。People 非任职审批仍原 People；16f 的 Aims owner 不变。


### Finance 法人主体目录与银行账户补充字段（W3，2026-10-04）

Enterprise Host → Runtime 用户委托通道内的 Finance 自有能力，不新增服务 capability，不涉及其它应用。

- **法人主体**（`finance_legal_entity`，W1 子集 `w1-finance-legal-entity`）：`/v1/enterprise/finance/legal-entities:{list|view|create|update}`，Host 为 `/finance/api/v1/legal-entities`。人员资源 `finance:legal_entities`，列表与详情要求 `view`，新建与修改要求 `edit`。字段闭集：名称（唯一，重名 `409 finance_legal_entity_name_exists`）、简称、统一社会信用代码、类型、注册地址、开票抬头、税号、状态（`active`/`inactive`，新建不可指定）、排序号、备注。页面新建的编码为 `ENT-<十六进制>`，迁移写入的为 `ENT-W<源主键>`，两者不相撞。只停用、不删除；停用不影响已关联的账户与合同，但不能再被新对象选择。**目录表未安装时全部返回 `503 finance_legal_entity_unavailable`**，不返回空列表，也不伪装成 403。
- **银行账户补充字段**（W1 子集 `finance-bank-account-columns`）：`shortName`（唯一，重复 `409 finance_account_short_name_exists`）、`bankBranchCode`、`legalEntityCode`（须存在且启用，否则 `409 finance_legal_entity_invalid`）、`sortNo`、`accountSubtype`（仅 `bank` 类型可有，否则 `409 finance_account_subtype_invalid`）。Runtime 在事务内探测列是否存在：已安装则读取返回这些字段并接受写入；**未安装时读取与既有写入行为不变，写入这些字段返回 `409 finance_account_fields_unavailable`**。账户写入沿用既有的 `bank_accounts:admin`。`account_no_secret_ref` 不出现在任何读取结果中。
- 其它应用需要显示主体名称时（如 Altoc 合同的签约主体）经 Finance 的进程内 typed 入口读取名称，不要求用户具备 `legal_entities` 资源，也不直接查表。
- 推荐角色：能看账户的角色（出纳、财务会计）同时具备 `legal_entities:view`，因为账户资料里要显示主体名称；能管账户的角色（财务负责人、财务管理员）具备 `legal_entities:admin`。

### 迁移事项队列的读取（W3，2026-10-04）

迁移后需要人工处理的遗留事项与人员匹配。Enterprise Host → Runtime 用户委托通道，不新增服务 capability。这是运行时代码对迁移台账 `mig_*` 的受控读取（W1 §1.4、§6.2 允许的两处之一），业务查询仍不得读取或关联 `mig_*`。

- **接口**：`/v1/enterprise/altoc/migration-exceptions:page`、`/v1/enterprise/altoc/migration-identities:page`、`/v1/enterprise/finance/migration-exceptions:page`；Host 为 `/altoc/api/v1/migration/{exceptions|identities}` 与 `/finance/api/v1/migration/exceptions`。
- **人员权限**：各应用自己的 `migration_exceptions:view`（Altoc 与 Finance 各一个资源，互不相通）；许可范围必须是不受限的 `all`——队列里的对象不属于任何单个负责人或部门。推荐角色仅 `altoc:admin` / `finance:admin`。`resolve` 动作已在 manifest 声明，由写操作使用。
- **按域隔离**：每个应用只看到 `owning_domain` 等于自己的事项；`kind` 是闭集（W2 工具合同 §10.1），跨域的 kind 作为查询参数返回 400，库里出现本版本不认识的 kind 时既不列出也不计数。
- **闭合投影**：每种 kind 只返回 §10.1 规定的 `detail_json` 键；“待归属联系人”额外返回 `mig_source_row.row_json` 中固定的八个键（姓名、部门、职务、两个电话、备用手机、星级、关键联系人标记）和原业务员的显示名。**从不返回整行 JSON、行摘要或白名单外的键**；搜索只匹配姓名与电话。人员显示名只取 `mig_identity_map.display_name`。
- **未安装**：迁移台账子集未安装（`migration` 域未绑定）时全部返回 `503 migration_ledger_unavailable`，不返回空列表。
- 读取不改变台账任何内容。

### 迁移事项队列的处理（W3，2026-10-04）

对“迁移事项队列的读取”的补充。Enterprise Host → Runtime 用户委托通道，不新增服务 capability。

- **接口**：`/v1/enterprise/{altoc|finance}/migration-exceptions:resolve`、`/v1/enterprise/altoc/migration-identities:{confirm|reject}`；Host 为 `POST /{altoc|finance}/api/v1/migration/exceptions/:id/resolve` 与 `POST /altoc/api/v1/migration/identities/:sourceUserId/{confirm|reject}`。全部要求 `Idempotency-Key`。
- **人员权限**：各应用的 `migration_exceptions:resolve`，许可范围必须为 `all`。两种触及客户的处理方式（`assign_customer`、`link_existing`）**另外**要求调用者对目标客户有 `altoc:customer:edit` 与数据范围：Host 用调用者自己的授权算出客户范围，放进签名的命令里，Runtime 据此校验；浏览器不能提供范围。
- **处理方式是闭集**：`accept`（保持现状/确认无误，`open→accepted`；“有效额大于总额”必须给原因）、`reopen`（`accepted→open`）、`mark_done`（`open→resolved`，仅限在对象上修正后标记的两类）、`assign_customer` 与 `link_existing`（仅“待归属联系人”）。每种方式只适用于表内列出的 kind，其它组合返回 `409 migration_exception_method_not_applicable`。`contract_balance_mismatch` 在一期没有任何处理方式；余额类的“认领到账户”“指定取值”依赖余额登记流水，尚未提供。跨域的事项对另一个应用表现为不存在（404）。
- **归属到客户**：联系人内容由 Runtime 从台账行取（姓名、部门、职务、电话、手机、备用手机、微信、地址、备注，以及关键联系人标记与星级），**浏览器只选客户，不能提交联系人内容**。创建走既有的联系人创建写路径（范围校验、审计、命令回执照旧），与事项更新为 `resolved` 在**同一个事务**里完成，事项记录生成的联系人编码。目标客户下已有同名同手机的联系人返回 `409 migration_contact_duplicate`，由用户改用 `link_existing`。源值超出联系人模型能容纳的长度时返回 `409 migration_contact_source_invalid`，不截断，资料继续留在台账。
- **人员匹配**：源人员以完整键标识（`employee:<id>` / `user:<id>`）。确认要求目标是当前有效的目录用户、不是保留主体、**不是操作者本人**（`409 migration_identity_self_match`）；`source_missing` 的源人员不可匹配。同一结论重复提交不再写入。一期只接受在职目录用户；“匹配到非在职账号仅用于历史显示”留待后续。
- **并发与重放**：事项以 `expectedVersion`、人员以 `expectedStatus` 保护；同一幂等键重放返回首次结果且不再写入；状态已被他人改变返回 409。
- **Runtime 对台账的写入是闭集**：只有两条语句——更新 `mig_exception` 的 `status/resolution_json/resolved_by/resolved_at/row_version`，更新 `mig_identity_map` 的 `directory_uid/match_status/match_basis/directory_status/matched_by/matched_at`——在所属域的写事务内执行。不 INSERT、不 DELETE，不触碰 `mig_source_row`、`mig_object_map`、`mig_batch*`。数据库账号本身对统一库有库级 DML，**权限不构成边界**，边界由代码闭集与源码级测试 `TestMigrationLedgerWritesAreClosed` 保证：除命名空间声明、安装器和两个队列文件外，任何 Runtime 源码提到 `mig_` 表即失败。
- **审计**：每次处理在所属应用的审计表写一行（`entity_type='migration_exception'` 或 `'migration_identity'`，含方式与原因）。
- **按源人员批量改派**：`/v1/enterprise/altoc/migration-identities:apply`（Host `POST /altoc/api/v1/migration/identities/:sourceUserId/apply`，仅 `employee:<id>`）。把该源人员名下未处理的 `owner_unmatched` 事项交给已确认的目录用户：一次最多 100 条，**逐条一个事务**——锁定并校验事项 → 走客户或合同的正常“变更负责人”命令（负责人校验、两头的范围校验、审计照旧）→ 事项置为 `resolved`。单条失败不影响其它条，返回每条结果与剩余未处理数；整批可重复执行。权限为 `migration_exceptions:resolve` 加调用者自己的 `customer:edit` 与 `contract:edit` 范围（由 Host 放进签名命令）。**职责分离**：每次执行都重新校验匹配是由目标用户以外的人确认的（不只在确认时拦截），否则 `409 migration_identity_self_match`；执行人不受限制；每条事项的处理记录写明目标、确认人与执行人。每次执行都重查目标用户仍在职。只改负责人，不自动填写部门。

### Altoc 客户层级、主联系人与联系人星级（W3，2026-10-04）

既有客户命令通道内的补充，人员权限均为 `customer:edit` 与数据范围，不新增动作或服务 capability。

- **上级客户** `customers-set-parent`（`/v1/enterprise/altoc/customers:set-parent`，Host `PATCH /altoc/api/v1/customers/:customerId/parent`）：载荷只有 `parent_customer_id`（id 或 `null` 清空）与 `expectedVersion`。上级必须存在、未删除且在调用者范围内（否则 403，不区分“不存在”与“无权”）；不能是自己；不能成环；上方链路加下方子树的总深度不超过 10 层，否则 `409 altoc_customer_hierarchy_invalid`。使用基础列，不依赖 W1 子集。
- **主联系人** `customers-set-primary-contact`（`…/customers:set-primary-contact`，Host `PATCH …/primary-contact`）：载荷只有 `primary_contact_id`（id 或 `null`）。必须是该客户自己的未删除联系人，否则 `409 altoc_primary_contact_invalid`。作为主联系人的联系人不能删除（联系人是软删除，外键拦不住，由命令校验），须先更换或清空，否则 `409 altoc_contact_is_primary`。“主联系人”与既有的“关键联系人”标记是两件事，互不影响。
- **联系人星级**：联系人新建与修改接受 `star_level`（1–6 的整数或 `null`）。
- **读取**：客户读取返回 `parent_customer_id`；联系人返回 `is_key_contact`；W1 列（`primary_contact_id`、`contact_name_text`、`sort_no`、`star_level`）已安装时一并返回。
- **未安装 W1 客户/联系人列子集**：主联系人命令与星级写入返回 `409 altoc_customer_fields_unavailable`；层级命令与全部既有读写不受影响。

### Finance 余额登记流水（W3，2026-10-04）

Enterprise Host → Runtime 用户委托通道内的 Finance 自有能力，不新增服务 capability。模型见 W1 §4.2：每次登记一行只增不改的流水，当日展示值取登记时刻最晚的金额。

- **接口**：`/v1/enterprise/finance/balance-entries:{list|create}`；Host 为 `GET|POST /finance/api/v1/bank-accounts/:code/balance-entries`（读取带 `date`）。
- **人员权限**：读取 `bank_accounts:view`；登记 `bank_accounts:edit`。`edit` 只用于登记余额——账户资料的新建与修改仍要求 `admin`，查看完整账号仍要求 `reveal-account-no`，`edit` 都不满足（有契约测试）。推荐角色中出纳（`finance:cashier`）新增 `bank_accounts:edit`。
- **登记**：载荷只有对账日期、金额（文本，两位小数，可为负）、备注；来源固定为 `manual`，登记时刻与登记人由服务端确定，不接受调用方指定。按账户行锁串行，登记时刻保证严格晚于当日已有的人工登记，因此页面登记不会产生“同一时刻不同金额”。写入流水后重算当日同来源的快照：金额、`entry_count`、`latest_tie_count`、`distinct_amounts`，并维护 `is_day_latest`。同一天再次登记不覆盖历史。日期不得晚于今天；已销户账户不接受登记。
- **幂等**：流水的 `entry_ref` 由幂等键派生，重放命中唯一键后比对内容——相同返回首次结果，不同 `409 finance_idempotency_conflict`。
- **规则无法决定的情况**：某日最新时刻的多条登记金额不同（只可能来自导入）时不生成快照，返回/记录 `finance_balance_latest_conflict`，由迁移事项队列处理。
- **列表补充**：账户列表每行返回最近余额与日期，并返回整个筛选结果（不是当前页）按“法人主体 + 币种”的合计 `balanceTotals`；没有任何余额记录的账户不返回 0，也不计入合计。余额快照列表在已安装时返回三个登记统计列。
- **迁移事项**：Finance 的 `migration-exceptions:resolve` 增加方式 `record_balance`，适用于“无账户的余额”（须指定账户）与“当日最新金额冲突”（账户取事项本身的目标，不可改指别处）。金额必须是事项列出的候选金额之一，日期取自事项；以一条人工登记落账并把事项置为已处理，同一事务。
- **未安装**：流水表未映射或快照统计列不存在时，两个新接口返回 `503 finance_balance_entry_unavailable`；既有账户列表与快照列表照常工作。

### Finance 查看完整银行账号（W3，2026-10-04）

路径：浏览器 → Enterprise Host `POST /finance/api/v1/bank-accounts/:code/reveal-account-no` → Runtime `/v1/enterprise/finance/bank-accounts:reveal-account-no` → **进程内** Console 保险箱 `RevealCustodySecretForOwner`（ADR-018a D11：同进程同租户，不签服务令牌、不登记 grant）。不新增服务 capability。

- **人员权限**：`finance:bank_accounts:reveal-account-no`，独立敏感动作，平台默认蕴含下 `admin`/`edit`/`view` 都不满足；Host 以该显式动作向 Console 申请授权并写入许可，Runtime 校验许可动作逐字相等。推荐角色仅 `finance:admin`。
- **只能取到本账户的账号**：Runtime 不信任账户行上的 `account_no_secret_ref`，而是由账户编码推出唯一合法密钥码 `finance.bank-account.<code>.account-no`，要求行上引用恰好等于 `hzybase://vault/<该密钥码>`（否则 `409 finance_account_no_ref_invalid`，不触达保险箱）。保险箱再独立复核：`usage_type='custody'`、`secret_type='bank_account_number'`、`owner_type='finance_bank_account'`、`owner_key=<账户编码>`，任一不符统一 404，不区分“不存在”与“不属于你”。`ResolveVaultSecret` 对 custody 密钥仍固定 403。
- **银行 custody 预览**：Console 创建/轮转 `secret_type=bank_account_number`、`owner_type=finance_bank_account`、`usage_type=custody` 的 db_encrypted 密钥时，仅保留账号末四字符；长度不超过四的全部遮盖。其它密钥类型的预览行为不变。WizBiz 工具的账户掩码与该预览一致，不通过解密生成预览，不改变 reveal/resolve 授权。
- **输入**：浏览器只提交 `reason`（4–200 字，必填）。客户端地址与 User-Agent 由 Host 从自身请求上下文取得并放进**签名的命令载荷**：地址取连接对端；仅当对端是回环/私网地址（即来自 Gateway）时采用 Gateway 覆盖写入的 `X-Real-IP`；**从不读取 `X-Forwarded-For`**。浏览器请求体里出现 `clientIp`、`secretCode` 等任何其它字段一律 400。User-Agent 是浏览器自报信息，仅作上下文记录。
- **双重审计**：① Finance 业务审计 `finance_audit_log`（`action='reveal_account_no'`：谁、何时、哪个账户、原因、地址；不含账号），**先提交、后揭示**；② 保险箱访问日志（`action='reveal'`，`success`/`failed`/`denied`，含操作者、`app_code='finance'`、地址、UA、原因）。保险箱日志写不进去时不返回明文。
- **频率限制**：同一用户每小时最多 20 次（尝试即计数，含保险箱随后失败的）。超限返回 `429 finance_account_no_reveal_rate_limited`，另写一条 `reveal_account_no_rate_limited` 审计，不触达保险箱。按用户串行化计数（连接级命名锁，在事务结束前释放）。
- **不是幂等命令**：每次查看都是一次新的受审访问，不走命令回执，不存在可重放的已存响应。
- **错误语义**：无权 403；账户不存在或没有保存完整账号 404；引用不属于该账户 409；超限 429；保险箱未就绪或失败 503（不伪装成 403）。错误信息是固定文案，不回显保险箱错误或任何账号片段。
- **不落盘、不进日志**：响应 `Cache-Control: no-store`；Host 处理函数、Foundation 的 Runtime 传输与 Runtime 访问日志都只记录固定的元数据字段，不记录请求体或响应体（有源码级断言锁定）；账号不进入任何列表、导出、搜索或业务表。
- **不在本合同内**：把账号写入保险箱（登记或更换完整账号）。迁移由工具按 W2 工具合同写入；页面上的更换账号另行设计，属于凭证写入。

### Altoc 合同列表合计与客户子树汇总（W3 只读前置，2026-10-04）

既有 `/v1/enterprise/altoc/contracts:list` 的纯新增能力，不新增路由、服务 capability 或人员动作；人员权限仍是 `contract:view` 与合同数据范围。

- **`summary`**：每次列表读取都返回整个筛选结果（不是当前页）的 `count` 与 `amounts[{currency_code,count,amount}]`。金额按币种分行，调用方不得跨币种相加，也不得在客户端对当前页求和代替它。
- **`includeDescendants`**（查询字段，仅合同列表、且须同时给 `customerId`）：把列表与合计的客户范围从单个客户扩到其整棵子树（按 `parent_customer_id`，忽略已删除客户）。深度上限 10、节点上限 2,000，超限返回 `422 altoc_customer_subtree_too_large`，不截断；成环不会死循环。
- **`rollup`**（带 `customerId` 时返回）：只统计调用者合同范围内可见的销售方向合同——`count`、`amounts`（不含中止）、`terminatedCount`、`signedLast12Months`、`signedThisYear`、布尔 `excluded`（所涉客户下存在范围外的销售合同）。不受 `search`/`status` 筛选影响。**不含任何客户 id、编码、名称或不可见合同的数量**：子树遍历只在服务端使用客户 id，调用者对下属客户是否有 `customer:view` 不影响也不被泄露。
- **签名**：`includeDescendants` 属于读许可签名的 query 部分。为保持既有许可的字节不变，Runtime 与 Foundation 的 canonical 仅在该值为 `true` 时在末尾追加一个 `true`；双端共用黄金向量 `data-runtime/internal/server/testdata/enterprise-altoc-contract-descendants-read-permit.json`。许可内 query 与请求体 query 必须逐字段相等，Host 不能在签名后扩大范围。
- 只使用既有列，未安装 W1 列的环境同样可用。

### W3 对象只读展示扩展（2026-10-04）

沿用现有客户、合同、银行账户读操作和对象 `view` 范围，不新增固定操作、capability 或 grant；所有读取都在 Registry 快照事务内。未装 W1 列/快照/台账映射时不返回对应字段，既有无新增筛选的读取保持可用；配置了映射但物理表缺失时返回依赖失败，不伪装成空数据。

- 客户列表增加 `parentId`、`rootsOnly`、`ownerUnassigned`，前两者互斥。`childCount` 仅计可见直接下属，`hasHiddenChildren` 仅表示是否存在范围外下属，不返回其数量或名称。`ancestors` 至多 10 层，任一不可见上级截断路径；直接上级不可见时不返回其 ID/名称，仅给 `parentHidden=true`。
- 合同列表增加 `origin`（`native` / `historical_import`）、`category`、`ownerUnassigned`；W1 列未装时指定来源/类别得到空匹配，不影响既有查询。列表和详情按已装列返回 W1 字段；客户 `rollup.effectiveAmounts` 每币种独立返回 `count/amount/missingCount`，NULL 不当作已填零。
- 新筛选进入 Go/TS 共享 canonical：按 `parentId, rootsOnly, ownerUnassigned, origin, category` 顺序，仅非空字符串/true 追加 `[字段名,值]`；false/空值不改变老许可字节。仍要求许可 query 与请求 query 精确相等。共享向量：`enterprise-altoc-w3-read-permits.json`。
- 详情 `migration_snapshot` 只返回类型化快照表的固定字段；`source_info` 只含 `system/table/pk/batchCode/importedAt`。受控台账读取限定 `w3_read_metadata.go`，已登记在 `TestMigrationLedgerWritesAreClosed`。对象主映射通过 `mig_object_map → mig_batch` 取来源；未分配负责人的源 UID 从同来源、同目标对象的 `owner_unmatched` 事项取出，再匹配 `mig_identity_map` 的 `employee:` 命名空间，仅返回 `source_owner_name`。不返回事项 JSON、源行正文或身份映射行，列表不读台账。
- 合同的签约主体名称及账户简称走 Finance owning 窄函数 `financeW3ReferenceName`，与 Altoc 共享 Registry 只读快照；只返回引用对象名称，不返回账号或保险箱引用，调用前已核对合同范围。账户详情返回法人主体名称，缺目录映射时保留编码。
- 同账户同日人工和导入快照并存，余额列表在 COUNT/LIMIT 前排除被人工覆盖的导入行，账户最新余额与整个筛选结果的按主体/币种汇总也优先人工。无快照保持 NULL，不冒充零余额。页面不对当前页 reduce 合计。

### 历史导入合同的操作护栏（WizBiz 迁移 W2 前置三，2026-10-04）

适用对象：`altoc_contract.origin_type='historical_import'`（必然 `amount_basis='header'`）以及任何 `amount_basis='header'` 的合同。这是“历史合同行落库后 Runtime 可以启动”的前置门；依据 W1 设计 §5.3、§5.4。

- **判定方式**：各入口在已持有的合同行锁内读取当前行（`SELECT *`），按 `amount_basis` / `origin_type` 判断；未安装 W1 列的环境读不到这两个键，护栏不生效，行为与此前一致。不查询可能不存在的列。
- **Altoc 统一库路径**（`enterpriseapf` 合同命令，范围校验之后、任何写入与幂等回执之前）：
  - `amount_basis='header'`：`contract-lines-replace` → `409 altoc_contract_header_lines_locked`。行合计重算对 header 合同的跳过保留为纵深防御。
  - `origin_type='historical_import'`：除 `contract-projects-bind`、`contracts-set-owner`（见下）与两个只读命令外，全部写命令（`contracts-update`、`payment-terms-replace`、`obligations-replace`、`obligations-transition`、`contracts-sign`、`contracts-activate`）→ `409 altoc_contract_historical_operation_denied`。
  - **后续命令（W3）**：`contracts-annotate`（`contract:edit`；只改 `contact_id`、`remark`、`content_summary`，联系人须属于该合同客户，否则 `409 altoc_contract_contact_invalid`）、`contracts-complete` 与 `contracts-terminate`（`contract:close`；须 `status='effective'`，中止必须给原因）。目标状态与导入映射一致：完结 → `completed/closed/fulfilled` 并写 `completed_at`；中止 → `terminated/terminated/cancelled` 并写 `terminated_at`；`financial_status`、`activation_status` 不变。不发 Workflow、不写集成出站、不同步 Finance 摘要、不动 Aims；写版本审计，完结/中止另写一条含原因的审计。三条命令**只适用于历史导入合同**，对其它合同（含未安装 W1 列的环境）返回 `409 altoc_contract_operation_not_applicable`；一期不提供撤销。
  - **变更负责人** `contracts-set-owner`（`contract:edit`，对原生与历史合同、任何状态都可用）：只改 `owner_uid` 与可选的 `owner_dept_code`，不改状态、金额、审批字段，不产生出站；负责人须是在职目录用户、不是保留主体；**当前合同与改派后的负责人/部门都必须在调用者数据范围内**，否则 403——不能把合同改派出自己的范围。写版本审计，另写一条记录改派前后负责人的审计。
  - `contract:close` 是 Altoc manifest 的独立动作，平台默认动作蕴含下 `admin`、`edit` 都不满足它；Host 以显式动作申请许可（全局管理员角色同样需要显式授权），Runtime 校验许可动作与命令要求的动作逐字相等。推荐角色中仅 `altoc:admin` 含该动作。
- **Finance**：台账写命令在锁定来源合同时判定，历史合同一律 `409 finance_historical_contract_not_ready`（开票申请、收款登记、由结算计划发起的开票及其后续命令）。Altoc 的合同财务摘要入口对历史合同同样失败关闭，不静默跳过，避免 Finance 已有事实而 Altoc 无感知。
- **旧 Altoc 适配器**：行写入与状态/激活入口有同样的判断（完结、中止放行）。旧路径操作的是旧库表，历史合同只落统一库，这里仅为纵深防御。
- **不是人员权限**：以上是对象状态约束，与角色、数据范围无关；`admin` 不能绕过。
- **待后续放开**：P1 期初应收批次落地时重新设计付款条款、Finance 开票/收款与摘要同步的放开条件。放开前不得以放宽本护栏的方式提供这些能力。

### Altoc 负责人指派校验与“未分配”保留主体（WizBiz 迁移 W2 前置二，2026-10-04）

- **规则**：任何写入口为对象指派负责人时（payload 的 `owner_uid`、`owner_user_id` 或 Finance 的 `responsibleUid`），目标必须是 Console Directory 中存在且 `status=active` 的用户，不限 `user_type`。以 `system:`、`client:` 开头或等于 `system` 的保留主体、含空白或控制字符、`@all`、超过 64 字符的值一律 `400 apf_owner_invalid`；不是有效用户 `400 apf_owner_not_active`；Directory 不可用 `503 directory_subject_status_unavailable`（未配置 Directory 时 `503 apf_owner_directory_unavailable`），不降级放行。接口原有输入格式校验先执行，格式错误也可能返回该接口的 input-invalid 错误。只阻断新指派，不因历史负责人失效而拒绝读取或不产生新指派的更新。
- **位置**：校验在 Runtime `enterpriseapf` 的每个公开写入口内、输入校验之后、业务事务之前，作用于该入口随后写入的同一份 payload（客户、线索/商机及转化、续约、招投标、服务工单、服务协议、报价、合同）。没有独立的“操作 → 负责人字段”清单，源码级测试保证：负责人字段集合封闭、每个入口都有该校验、读取负责人字段的文件都在受保护入口之后。
- **Enterprise → Directory**：Runtime 进程内 typed 调用 `EnterpriseActiveUser`（ADR-018a D11，同进程同租户），不签服务令牌、不新增 capability 或 grant。
- **`system:unassigned`**：表示历史负责人未能映射到目录用户的对象。用户可达的写入口不能把它作为新指派目标；迁移工具通过 `enterpriseapf.ValidateMigrationOwner` 写入，用户写路径不能调用这个迁移专用例外。该字面量在 `enterpriseapf` 生产代码中只允许出现在 `owner_guard.go`。负责人为该值且部门为空的对象只对 `all` 数据范围可见、可改派；由其下新建的对象（报价、工单等）负责人取创建人，不继承该值。
- **Foundation**：`system:unassigned` 登记为内置目录用户（显示名“未分配”，`status=0`），批量与单个目录查询在本地解析，不转发 Console。保留主体不能成为会话主体（`requireFoundationSessionUid` 视为未登录）、不能取得权限快照或 scoped authorization（`403`，含本地开发捷径之前）、不出现在 `UserTreeSelector`（`APFUserSelect` 经它）的候选中，也不会被选择器提交。`useAltocDirectoryLabels` 不为保留主体发起查询，也不因其未解析而标记目录错误。
- **责任人覆盖核查（第 3 批）**：W1 列出的遗留项共 4 个字段。Finance `invoice-requests-assign-issuance` 写 `issuance_responsible_uid`，`receipts-create/update` 写 `reconciliation_responsible_uid`，均在 `FinanceLedger` 事务前按同一份 `responsibleUid` 执行 owner-guard。销售任务 `assignee_uid` 来自线索/商机当前 owner：先按当前范围读取来源快照，在业务事务前预读 Directory；仅实际插入新任务时消费校验结果，已有任务不重新指派。新跟进活动和线索转化生成对象也复用该结果；实际 uid 与预读值不同返回 `409 altoc_sales_owner_changed`，整笔事务回滚。不会在业务事务持锁期间查询 Directory。结算计划 `collection_responsible_uid` 目前没有 Enterprise 用户指派入口，合同生成和期初迁移均保持 NULL；合同 payload、付款条款明细及未登记的 billing 写操作拒绝注入责任人字段，不为补校验新增业务接口。旧独立 Altoc 的 `receivable_plan` 是另一套未迁移接口，不属于此 `altoc_billing_schedule` 合同。
- **客户、联系人、银行账号**：客户创建/改派已有 owner-guard；联系人写入口不接受独立 owner 字段，按客户范围授权；银行账号 `ownerDeptCode` 是部门标识，不按人员 uid 校验，两类入口均拒绝注入人员负责人字段。Foundation 选择器继续排除保留主体，真实组件测试同时覆盖候选、提交和历史值显示。

### APF-17c 现有开通链恢复与安全撤权诊断（候选，环境未验）

本段保留真实钉钉候选的开通、激活、状态查询合同。手工候选仍只能维护资料，自动开通在页面与服务端失败关闭。LDAP、邮箱停用及其独立成功回执没有既有目标合同，本段不实现，也不把 Console/Platform 已确认解释为外部账号全部停用。

- 开通恢复沿用原动作、原 `expectedVersion` 和原 `Idempotency-Key`，按原阶段的版本偏移重放已有回执。浏览器 sessionStorage 只存这些元信息和同租户/用户/部署绑定，不存员工资料、命令、令牌或目标确认。策略 revision 更新不丢弃同身份原意图，但每次重试都重新执行当前人员权限、员工范围与短期 permit 校验；切换身份/部署不能恢复他人的意图。目标拒绝释放时不能推进本地取消；必须取得 `released=true` 和相同 reservationId。
- Directory 恢复新增三个固定 U 操作 `people.apf09c1-directory-operations-list/view/replay`，复用 `people:enterprise-host:execute`。人员门槛分别为 `integration_operations:view/replay`，仅租户全局同授权单元可用，部门/本人范围不得扩大为全公司操作。Runtime 限定当前 tenant/deployment、source_app=enterprise、service_client_id=enterprise.runtime、target_app=console、source_biz_type=employee，以及 employment-sync/offboarding-disable 两个固定 family；旧 People 来源不在此恢复入口中。
- list COUNT/分页在同一快照；view 返回浏览器字段白名单，命令与摘要仅在服务器间用于 probe。replay 在同一 caller-Tx 锁定原命令，校验 frozen hash/来源/目标 capability，当前授权在读取既有回执之前复核；复用 service_command_receipt 与 ReplayInTransaction，只重排 failed_permanent/dead_letter，保留原 payload/hash/key。processing/partial_unknown/succeeded 不得强制成功或重排；同键改意图、版本变化409，失败整笔回滚。没有新增表、grant 或 owner。
- Enterprise probe 只从 Runtime 的冻结命令取得 employeeUid/sourceRevision/snapshotHash/type，不接受浏览器自报 uid、版本、确认或新 payload。重新取得 enterprise.runtime → Console 令牌，employment 与 offboarding 分别使用既有 `console:directory-employment:sync`、`console:directory-offboarding:disable`；Console 校验真实服务来源、精确客户端、aud/tenant/deployment。只读 `lifecycle-command-status` 由 Console 自身凭据以现有 `console:directory-connector:execute` 查询 Runtime，绝不转发上游令牌。
- Console 在一致快照中核对 Directory lifecycle 的精确 revision/hash/type，并查询同 revision 的 Platform operation。Directory 已应用与 Platform pending/partial_unknown 分开展示；更晚 Directory revision 显示 superseded，不冒充原版本完成。响应只含封闭状态，无原始错误、URL、凭据或私密档案。未知结果保持未确认，依赖故障503；参数400、身份/范围403、版本冲突409保留。

本段不启用任何环境。部署需同时带上 Runtime、Console、Foundation/Host 的固定路由与生成物，核验既有精确 grant/目标部署和受信 Console 传输路径；hzy0 本地 egress 已补两条精确只读 probe 路径候选，实际切换另作为启用前核验项，不以隔离测试冒称已接通。17d 及旧 owner 退役等待整批提交后另案。


### People 任职用户原键恢复（2026-10-04）

`POST /enterprise/api/apf/people/assignments/:id/recover` 只接受 employeeUid、expectedVersion 与稳定 Idempotency-Key。沿用 `assignments:edit`、Foundation 唯一人员范围投影及 U 通道；Runtime 在锁内复核当前范围、发起人 created_by 与签名 actor 相等、pending 状态和冻结版本。恢复通过既有 request-workflow 固定操作的 phase=recover 获取单个不可变 command_json；无记录或记录不唯一返回 409，不创建新的 operation。浏览器不能提供原键、表单或实例号。

Host 用冻结 actor/form/operationKey 经正式 Workflow prepare/create 获取原实例，随后沿用 attach-workflow 与独立 workflowapproval reader 校验并绑定；回绑键与原提交的 bind 键一致。已绑定 pending 的重试不再调用 Workflow。恢复不进入 scheduler-inspect、不会唤醒或领取 Directory lifecycle operation；无需启用调度或新增 capability/grant。任职只读白名单增加 created_by 与 workflow_instance_id 以显示发起人恢复入口和审批链接，不包含薪资或私密资料。

### GitLab 仓库内容只读（2026-10-04，文档资产设计 DOC-01）

依据 [文档资产统一管理设计](./Document-Asset-Unified-Management-Design.md) §6，平台不再向 GitLab 仓库写入内容。本批为代码与候选授权脚本，未在任何环境执行授权变更或部署。

- **删除**：Foundation 五个通用接口 `/api/git-integration/{commit,commits,commit-diff,file,markdown-tree}`（无前端调用方，处理器内无人员授权）与 `createGitCommit`、`resolveGitCommitActions`；Codocs `POST /api/project-docs/gitlab-submit/**` 及其编排、页面“提交到 GitLab”入口。
- **Runtime**：`/v1/console/service/integrations/{code}/gitlab/{operation}` 的固定操作集合去掉 `commit`、`resolve-actions`，对持有 `integration_operations:execute` 且带幂等键的调用方同样返回 `404 console_gitlab_operation_not_found`。保留只读操作 `project-info`、`group-projects`、`commits`、`commit-diff`、`markdown-tree`、`file`，以及仍需 `Idempotency-Key` 的 `issue-upsert`（工作项与 GitLab Issue 关联，是否保留见设计 §9 第 6 项）。
- **授权**：`gitlab.commit`、`gitlab.resolve-actions` 的语义授权由候选脚本 `Console-SQL-Seed-v2.35-gitlab-repository-read-only-candidate.sql` 收回（只从 `operations` 中移除两项，不改状态、不删行、不复活已撤销行），配套只读 verify。执行属于环境写入，需逐环境批准；执行前 Runtime 已不再受理这两项操作，授权残留不构成可用通路。
- **读取**：GitLab 读取只经各业务模块自身的服务端入口，由该入口先判项目范围与仓库绑定，再调用 Foundation `gitIntegration` 的只读辅助函数；浏览器不能直接指定任意仓库。
- **约束**：GitLab 集成令牌保留写权限以支持 `issue-upsert`（用户 2026-10-04 决定，DOC-02 取消）。仓库内容只读依赖 Runtime 固定操作白名单与 Console 操作授权，不得再新增写仓库内容的固定操作；相关契约测试是防回退的门。
- **仍待处理**：旧独立 Codocs 的 `GET /api/project-docs/gitlab-sync/**` 只校验静态 `projects:edit`，未按项目成员关系限定 `projectCode`；它只读仓库并写入本项目 OSS 前缀，随旧 Codocs 项目文档退役处理，退役前如继续使用应补项目范围判权。独立 Aims 的仓库读取入口已有 `assertAimsProjectRepositoryAccess`。

### Codocs 文档存储维度（DOC-06a/6b，2026-10-04，未在任何环境执行迁移）

依据 [DOC-05/06 实施细化稿](./Document-Asset-DOC-05-06-Implementation-Spec.md) §2。本批不改变任何读写行为。

- **表结构（候选迁移）**：`documents` 新增 `storage_type`（`oss`/`git`，默认 `oss`）、`storage_locator`、`origin_json`；`document_versions` 新增 `storage_revision`。只增列并回填隐含的桶（`git-project` → `projects`，其余 → `documents`）；回填可重复执行。现有代码在未加列的库上照常工作。
- **判别收口**：`git-project`（仓库文档的 OSS 副本，存于项目文档桶）的判断只允许出现在 Runtime `internal/apps/codocs/document_storage.go` 与 Codocs `shared/utils/documentStorage.ts`；两处各有测试禁止其它文件直接比较该值。在迁移确认执行之前，这两处不得引用新增列。
- **后续**：`storage_type=git` 的只读读取（6c）与旧取值规范（6d）另行交付；在此之前不得改写或停止写入 `git-project`。

### Aims 项目集成员与文档仓库登记（DOC-05a，2026-10-04，表未在任何环境安装）

依据 [DOC-05/06 实施细化稿](./Document-Asset-DOC-05-06-Implementation-Spec.md) §3。本批只提供成员与仓库登记的读写，不改变任何文档的读写判权（项目集归属文档在 Host 上仍固定 409，见 5b）。

- **Host 路由**：`GET /aims/api/v1/portfolios/:id/members`、`PUT /aims/api/v1/portfolios/:id/members`、`PUT /aims/api/v1/portfolios/:id/doc-repo`。对应 Runtime 固定用户操作 `/v1/enterprise/aims/project-portfolios:{members-list,members-save,doc-repo-save}`，仍由 `aims:enterprise-host:execute` 授权，不新增 capability 或 grant。写入必须带 `Idempotency-Key`；浏览器只能提交 `action/uid/relationType/validUntil/expectedRevision` 或 `repoPath/expectedRowVersion`，不接受任何身份字段。
- **人员权限**：读取要求 `portfolios:view`；写入要求 `portfolios:admin`（Host 判定后才注入 `current_user_can_manage_portfolios`，调用方自带的同名参数丢弃）。
- **关系复核（Runtime 事务内、对锁定行）**：写入者除上述权限外，还必须是该项目集的负责人（`owner_uid`）或当前有效的 `manager`；actor 只取签名委托。两者缺一即 `403 portfolio_member_manager_required`。
- **引导规则**：仅当项目集没有负责人且没有任何有效 `manager` 时，允许只凭 `portfolios:admin` 新增第一名 `manager`；不能借此新增其它关系、修改或重新启用已有成员，也不适用于文档仓库登记。
- **不变量**：没有负责人的项目集至少保留一名有效 `manager`，最后一名管理者被移除或降级时返回 `409 portfolio_last_manager_required`。成员按 `(portfolio_id, uid)` 唯一，更新与移除带修订号，冲突返回 409；移除为软删除并立即失去管理资格。
- **数据与安装**：表 `aims_portfolio_members`、`aims_portfolio_doc_repos`（逻辑名与物理名相同，不属于兼容视图族）。独立 Aims 库执行 `aims/docs/migration_v5.42_portfolio_members.sql`；统一库经域安装子集 `aims-portfolio-members` 安装并登记映射（安装器子集另行交付）。统一写入模式下映射缺少这两张表时，三个入口固定 `503 aims_portfolio_members_unavailable`，其它 Aims 功能与默认映射 hash 不变。统一模式的事务持 Registry 代次栅栏，代次不符时在任何业务写入前拒绝。
- **负责人已失效（5b-1 补充）**：Enterprise Host 路径下，Runtime 在业务事务之前用进程内 typed 调用向 Directory 预读该项目集负责人是否仍为有效员工（`status=active` 且 `user_type=employee`）。失效的负责人视同“无负责人”：不再是隐含 `manager`；引导规则与“最后一名管理者”保护都按无负责人计算；成员列表返回 `ownerInactive`。预读结果与事务内锁定行的 `owner_uid` 绑定，期间负责人被更换返回 `409 portfolio_owner_changed`。Directory 不可用时这些入口返回 `503 directory_subject_status_unavailable`，不降级为“按记录信任负责人”。独立 Aims 路径没有目录预读，行为不变。
- **未做**：成员 uid（负责人以外）是否为在职员工的目录校验、成员管理页面（5c）、项目集文档写入（5b-2）。

### Aims 项目集文档只读（DOC-05 5b-1，2026-10-04，迁移未在任何环境执行）

依据 [DOC-05/06 实施细化稿](./Document-Asset-DOC-05-06-Implementation-Spec.md) §3 与 §8。本批只读：项目集归属文档的写入在 Host 上仍固定 `409 project_document_portfolio_owner_unsupported`。

- **Host 路由**：`GET /aims/api/v1/portfolios/:id/documents`，不接受查询参数。对应 Runtime 固定用户操作 `/v1/enterprise/aims/project-portfolios:documents-list`，仍由 `aims:enterprise-host:execute` 授权，不新增 capability 或 grant。
- **判权（同一上下文内同时成立）**：人员权限 `portfolios:view`（Host）；与项目集的当前关系（Runtime，按签名 actor 与当前行计算，不接受调用方传入）。关系来源依次为：有效负责人或有效 `manager` 行 → `manager`；其它有效成员行 → `contributor` / `viewer`；当前归属该项目集的项目的负责人或有效成员 → `inherited`；都不是 → `403 portfolio_document_relation_required`。成员行过期或移除、项目移出项目集、项目成员停用后立即失效。
- **Aims → Codocs（进程内 typed 调用，ADR-018a D11）**：Aims 只把自己选出的项目集文档 UUID 与（actor、项目集编码、关系）交给 `CheckEnterprisePortfolioDocument`；不签服务令牌、不新增路由。Aims 是文档归属的事实源，策略行只贡献密级、默认权限与继承开关，且仅当该行显式归属本项目集（`source_owner_type='portfolio'` 且编码一致）时才采用；否则按限制性默认（L2、不继承）处理。
- **可见范围**：直接关系可看该项目集全部文档（含仓库引用文档）；`inherited` 只可看显式归属本项目集、密级 L0/L1 且 `inherit_to_member_projects=1` 的文档，仓库引用文档不继承。被过滤文档的标题、数量与只含这类文档的文件夹对 `inherited` 不可观察；`total` 为过滤后的数量。下载是否开放只看策略的 `default_permission`，关系不放宽。全部结果只读。
- **同名编码**：项目集文档的判权从不使用“来源项目成员”规则。项目路径的该规则只对 `source_owner_type='project'` 的策略行成立，因此策略行显式标为项目集后，与项目集同编码的项目的成员也不能经项目路径读取。存量策略行默认为 `project`，由 `hzy-document-catalog-reconcile --portfolio-policy-owners`（默认 dry-run，`--apply` 幂等，只改已存在行的归属类型与编码并记审计）标记；**标记前该同名缺口在项目路径上依然存在**，启用前必须在目标环境执行并核对。
- **项目文档列表**：`project-documents:accessible` 的响应增加只读区 `portfolioDocuments`（该项目当前所属项目集、对当前用户过滤后的文档，带 `inheritedFrom: 'portfolio'` 与 `relation`）和 `portfolioDocumentsUnavailable`。原 `items` 不变。项目集侧依赖（成员表未安装、策略列未安装、Directory 不可用）不可用时只省略该区并置标志，不影响项目文档。
- **数据**：Codocs 候选迁移 `codocs/docs/migrations/20261007_document_access_policy_owner.sql` 为 `document_access_policies` 增加 `source_owner_type`、`inherit_to_member_projects`。列未安装时项目集文档列表固定 `503 codocs_portfolio_policy_unavailable`；项目文档判权不依赖这两列。成员表未安装沿用 `503 aims_portfolio_members_unavailable`。
- **未做**：单份项目集文档的打开/内容读取与页面（5c）、产品线归属。

### Aims 项目集文档写入与策略维护（DOC-05 5b-2，2026-10-04）

依据 [DOC-05/06 实施细化稿](./Document-Asset-DOC-05-06-Implementation-Spec.md) §9。只提供“登记、文件夹、移除引用、策略维护”；**不在项目集下新建正文或上传附件**（Codocs 尚无项目集归属，另行设计）。项目文档入口对项目集归属文档仍固定 `409 project_document_portfolio_owner_unsupported`，以下是唯一的写入口。

- **Host 路由**：`POST /aims/api/v1/portfolios/:id/documents`、`DELETE /aims/api/v1/portfolios/:id/documents/:docId`、`PUT /aims/api/v1/portfolios/:id/documents/:docId/policy`。对应 Runtime 固定用户操作 `/v1/enterprise/aims/project-portfolios:{documents-create,documents-delete,documents-policy}`，仍由 `aims:enterprise-host:execute` 授权，不新增 capability 或 grant。三者都必须带 `Idempotency-Key`。
- **判权（同时成立）**：人员权限 `portfolios:edit`（Host）；当前关系（Runtime，写事务内对锁定的项目集行与成员行复核，actor 只取签名委托）——登记与移除要求 `manager` 或 `contributor`，策略维护仅 `manager`；`viewer` 与组内项目成员（继承关系）不能写。负责人失效规则同 5b-1。关系撤销后，旧请求的重放与首次请求同样被拒绝。
- **归属**：只取路径中的项目集。请求体只接受 `uuid/title/parentId/isFolder/docCategory/documentSource/codocsUuid/repoFilePath/repoCommitId`，出现任何项目、里程碑、工作项、项目集或身份字段即 400。父级必须是同一项目集自有的文件夹。
- **登记 Codocs 文档（Aims → Codocs，进程内 typed 调用，ADR-018a D11）**：挂入项目集等同于对外分享，Aims 在自己的写事务之前调用 `ConfirmEnterprisePortfolioDocumentSharer`，要求 actor 是该 Codocs 文档的所有者（与 Codocs“只有所有者可管理分享”一致；编辑分享不够），且文档未删除、未进回收站、未只读锁定。不签服务令牌。同一文档在同一项目集只能登记一次。文档的策略行若属于某项目或其它项目集，登记仍允许，响应返回 `policyOwnedElsewhere=true`；此时读取侧按限制性默认（L2、不继承）处理。
- **登记仓库文件**：仓库只能是该项目集登记的文档仓库（Runtime 在事务内读取登记表，不接受调用方传仓库）；Host 经只读固定操作取回文件并冻结提交版本。登记的仓库路径超过 50 个字符时返回 `409 portfolio_doc_repo_unsupported`（`project_documents.repo_project_code` 的列宽限制）。
- **幂等**：`uuid` 由浏览器生成，是引用的身份与幂等锚点：同一 actor 的相同登记重放返回同一行（`replayed=true`）；同一 `uuid` 的不同内容或他人重放返回 `409 document_uuid_conflict`。移除不存在的引用返回 404。策略保存“已是目标状态”时为 no-op。
- **移除**：只删除 Aims 的引用行，不触碰 Codocs 正文、分享或策略。`manager` 可移除任意引用与空文件夹树；`contributor` 只能移除自己登记的非文件夹引用。文件夹内仍有文档时 `409 portfolio_document_folder_not_empty`；逐行校验后代都属于同一项目集后才删除。
- **策略维护**：字段为生命周期、密级、`default_permission`、`inherit_to_member_projects` 与 `expectedEtag`。Codocs 策略行是权威，先写（进程内 typed 调用 `SaveEnterprisePortfolioDocumentPolicy`），Aims 的 `access_*` 镜像列随后更新，仅用于展示；镜像更新丢失时重发同一状态即可修复。**只允许作用于没有策略行、或策略行已显式归属本项目集的文档**；策略行属于某项目或其它项目集时返回 `409 portfolio_document_policy_owned_elsewhere`，不改写其归属。并发以 `etag` 保护，过期返回 `409 portfolio_document_policy_conflict`。文件夹与仓库文件没有可维护的策略。每次变更记 `policy_update` 审计。
- **目录登记**：仓库文件引用的登记与移除在提交后触发文档目录的定向对账（归属 = 该项目集）。
- **项目路径不得改写**：既有的项目文档策略更新入口（Codocs `updateDocumentAccessPolicy`）对 `source_owner_type` 不是 `project` 的策略行返回 `409 document_policy_owned_elsewhere`，不改写其编码或其它字段；列未安装时行为不变。
- **列表补充**：`documents-list` 对直接关系返回 `canLink`、`canManagePolicy` 与每份文档的策略状态（`etag`、`defaultPermission`、`inheritToMemberProjects`、`ownedElsewhere`）；继承关系不返回策略状态。
- **未做**：项目集下新建 Markdown 与上传附件、Codocs 侧项目集归属、内容打开（5c-2）、产品线。

### 项目集详情页（DOC-05 5c-1，2026-10-04）

- **页面**：Host 原生页 `/aims/portfolios/:id`（`aims/layer/pages/enterprise-portfolio-detail.vue`），从项目总览的项目集名称进入，不占顶层导航。三个页签：项目集文档、成员、文档仓库。只调用上面已登记的 Host 路由，不新增操作；所有入口是否显示取自服务端返回的 `canManage` / `canBootstrap` / `canLink` / `canManagePolicy`，不是安全边界。
- **列表口径调整**：`documents-list` 与项目文档列表只读区的 `total` 与 `items` 同口径（含文件夹）；新增 `documentTotal` 只计文档。
- **悬空引用**：引用指向的 Codocs 文档已不存在时，直接关系仍返回该行并带 `missingSource=true`（不带策略状态，`accessPermission='none'`），供管理者移除；继承关系继续省略。
- **成员列表上限**：`members-list` 最多返回 500 行，超出时 `truncated=true`；并返回 `portfolio{id,code,name}` 供页头显示。
- **项目文档页**：侧栏增加“所属项目集文档”只读区（标题与数量，链接到项目集页）；项目集侧不可用时仅提示，不影响项目文档。
- **未做**：从“我的文档”选择器挂入（首版粘贴文档链接或标识）。

### 项目集文档内容打开（DOC-05 5c-2，2026-10-04）

只读查看 `document_source=codocs` 的文档正文。不提供下载、编辑或协作；仓库文件引用暂不支持在线查看。

- **Host 路由**：`GET /aims/api/v1/portfolios/:id/documents/:docId/open`，不接受查询参数；浏览器只给出项目集与引用的数字标识，文档 UUID、存储位置、文档类型与正文引用一律来自 Runtime，绝不接受浏览器传入。页面 `/aims/portfolios/:id/documents/:docId`。
- **Runtime 固定用户操作**：`/v1/enterprise/aims/project-portfolios:documents-content`（沿用 `aims:enterprise-host:execute`，无新 capability 或 grant）。只返回正文定位（文档元数据 + 已发布快照引用），不含正文，仅供宿主服务端使用。
- **判权**：人员权限 `portfolios:view`（Host）与当前关系（Runtime，同 5b-1）同时成立。Aims 确认引用属于该项目集后，经进程内 typed 调用 `ReadEnterprisePortfolioDocument` 由 Codocs 按与列表**同一个判定函数**决定：直接关系可读；继承关系仅“策略行显式归属本项目集 + L0/L1 + 开启继承”。
- **不可区分**：对继承关系，“不允许查看”与“不存在”是同一个 `404 portfolio_document_not_found`（同状态码、同响应体）：引用不存在、属于项目或其它项目集、是文件夹或仓库文件、策略未开放、文档已删除或进回收站，均如此。Codocs 始终同时读取文档行与策略行并写审计后才看结果；Aims 在没有可读对象时也走同一条读取路径。直接关系对文件夹与仓库文件得到 `409 portfolio_document_content_unsupported`。
- **放出正文前二次复核**：Host 用第一次返回的定位取正文（`bodyRef: 'required'`），随后再读一次 Runtime；文档 UUID、存储路径、更新时间、快照代次与引用、文档类型必须不变，且关系与权限不得降级，否则 `409`，不返回正文。响应逐字段构造，不含 UUID、存储路径或正文引用，`Cache-Control: no-store`。
- **正文引用规则（共享逻辑）**：`withEnterpriseCodocsDocumentContent` 的 `bodyRef: 'required'` 现在对所有文档类型一致——有 Runtime 引用用引用；`snapshot_generation === 0` 读自身路径；其余 `503 enterprise_document_body_ref_required`。因此非所有者读取他人私人文档时不会走“按当前用户读取个人快照头”的路径。既有 open-department 读取与所有者自读行为不变。
- **审计**：每次判定（允许或拒绝）在 Codocs 记录 actor、关系、项目集编码与文档 UUID。
- **已知限制**：存储路径以 `codocs/company/` 开头的文档在取正文后还会经过既有的、按当前用户的访问记录与 ACL 复核；项目集读者若在 Codocs 原生权限上无权，该复核会失败关闭（403/503），不会放出正文。

### 文档目录登记（DOC-07，2026-10-04，表未在任何环境安装）

完整合同见 [DOC-05/06 实施细化稿](./Document-Asset-DOC-05-06-Implementation-Spec.md) §7。

- **方向**：Aims → Codocs 文档目录，单向。Aims 拥有仓库引用文档、已基线需求规格、已冻结项目周报的事实与正文；目录只保存元数据（标题、归属、存储定位、版本、内容哈希、状态）。
- **调用方式**：Runtime 进程内 typed 调用（ADR-018a D11），不签服务令牌、不登记 grant、无新增 HTTP 路由或 capability。Aims 事务提交后投递定向对账请求（该项目的仓库文档、该项目的需求规格、本次冻结/解冻的周报），由单个后台 worker 合并后串行执行，绝不阻塞或失败 Aims 请求；队列满则丢弃并计数。写入型对账先取 `tenant/app/kind` 库级锁再读来源，保证当前版本不回退。尽力而为：目录不可用、进程退出或丢弃都不影响 Aims 业务；独立 Aims 旧路径不挂触发点。漏登记由 `hzy-document-catalog-reconcile`（默认 dry-run，`--apply` 幂等）补齐。
- **隔离**：登记记录在独立表 `document_catalog_entries` / `document_catalog_entry_versions`，不进入 `documents`，对 Codocs 现有的全部读写路径不可见、不可写。只读视图 `document_catalog` 合并 `documents`（排除已删除与回收站）与有效登记，仅供登记包、对账命令与后续索引使用，不得挂接任何用户接口。
- **判权**：目录不授予任何访问权。内容读取与人员判权仍由 Aims 的既有入口执行；后续索引使用目录时必须由原模块按提问人实时判权。
- **身份**：`UUIDv5(固定命名空间, tenant, app, kind, objectId)`；来源为封闭集合，新增来源须修改合同与代码。

W3 法人主体列表/详情仅在 Host 复核同一主体、同一 bundle 的 `bank_accounts:view` 后，以签名绑定的 `finance.accountCountAllowed=true` 请求 `account_count`；其余调用不查询也不返回该字段。主许可有效期取两项权限的最早到期时间。该字段仅允许主体列表/详情，旧请求缺省 false 的 canonical 不变；true 增加闭合标签 `[accountCountAllowed,true]`。Runtime 在同一 Registry 快照事务内统计该主体关联的未删除银行账户（含停用账户）；未装账户主体列时为 0。不返回账号、余额或账户明细，不新增权限/操作。Host 法人主体目录、账户编辑五列、余额登记/当日流水页面沿用上述固定操作、版本与原键合同。

## W3 第6批：只读扩展

复用既有 `customer:view`、`contract:view`、`bank_accounts:view`、`migration_exceptions:view` 与固定读取操作，不新增 capability/grant/schema。列表、详情分别由服务端授权；来源信息在所属对象通过范围检查后，以 Registry 快照事务读取迁移台账。仅返回 `system/table/pk/batchCode/importedAt`，不返回源 JSON。

- 客户 list/detail 返回 `customer_level_id`（NULL 保持）及已有字典 `customer_level_name`；不与信用等级混用。联系人来源随受控客户详情返回；账户来源仅在账户详情返回。
- `GET /altoc/api/v1/contracts?parentContractId=<id>&page=&pageSize=`：仅当前合同范围内的直接下级合同；W1 列未装时为空，不恢复宽读取。
- 同一合同 list 的 `customerIds=2,3`（最多100个不同正整数，无 customerId/includeDescendants）返回 `customerSummaries`：一次批量分组，各客户的可见销售合同（排除 terminated）count/amounts，按币种分开；只用合同范围，不查询客户名称或存在性，不返回不可见计数。无可见合同与客户不存在都返回零。
- 账户 list 的 `legalEntityCode/accountType` 服务端筛选；`complete=true` 仅 page=1，整个筛选结果≤200才完整返回，响应 `complete=true`；超过200则 `complete=false`、按传入 pageSize（≤100）分页。响应 pageSize 保持请求值，完整模式仅作为有界展示例外；合计仍覆盖整个筛选结果。W1 主体列未装，主体筛选返回空。
- 余额 list 的 `legalEntityCode` 经账户关联筛选，total 与返回记录采用同一条件；同账户同日人工快照优先于导入。
- Finance exceptions 读增加 `exceptionId`，仅 kind=balance_without_account，不接受 status/search；沿用既有签名泛型 ID 和 page/pageSize。详情返回分页白名单流水（sourceEntryId/balanceDate/amount/recordedAt/recordedByName），固定源表与事项冻结快照，匹配原 sourceEntryIds、日期和 ba_id=0；其它批次/日期/关联账户记录不可混入。Ledger 未装仍503。

新增 Altoc/Finance query 在 Go/TS canonical 中仅有值时追加，旧请求字节保持不变，共享金向量覆盖参数删改。exceptionId 使用原有签名 ID 槽位，不改变旧许可格式。

### APF UI B1 验收修订：合同客户投影与筛选

合同列表/详情仍由 contract:view 与原合同范围判定。客户名称使用同一策略快照下独立 customer:view 范围许可，作为可选 customerRead 附加于原 token-bound HMAC permit；Runtime 复用原 permit 校验，绑定 actor/tenant/deployment/版本/到期时间，拒绝嵌套许可和跨快照拼接。无客户读授权时合同不消失，customer_visible=false、customer_name=NULL；依赖故障仍为 503。每页只做一次 scoped 客户批量查询，不逐行读取。

搜索覆盖合同名称/编码/合同编号，客户名称匹配只在独立客户范围内执行；不可见客户不贡献搜索命中。新增 ownerUid、direction、contractType、amountMin、amountMax 均可选且仅有值时签入；旧空参数 permit 字节不变。金额为非负 DECIMAL(18,2)，区间包含边界；按列表合同金额过滤（历史原签约额、原生当前额），不换算币种。所有筛选先于 COUNT、全结果 summary 和分页，分页上限 100。

有效额缺失只在显示时回退到该行合同金额，注明来源，不改有效额存储或统计口径。显示列的本机保存不保存视图/筛选/合同内容。详情次要信息以概览、履约与项目、来源与关联页签组织；桌面关键信息网格，390 宽度单列。

### APF UI B4：迁移办理与只读扩展

- 沿用 Altoc/Finance 的既有固定 U 操作和人员权限；不新增 capability、grant 或解决命令。迁移办理写入、意图键、版本冲突与逐对象应用合同不变。
- `migration-exceptions-page` 可选 `migrationQuery`：`objectSearch` 搜索 `source_pk/target_key`，`createdFrom/createdTo` 为事项入队日期（不是源业务发生日期），`sort` 为 `created_asc/created_desc`。已有 `status` 可传去重、排序后的逗号分隔状态集合；COUNT 和分页在同一快照、同一筛选内完成。旧请求不携带新对象，旧 permit 正文保持不变。
- 迁移事件使用该读操作的独立 `eventsFor` 模式：`exception:<id>` 或 Altoc 的 `identity:employee:<id>/identity:user:<id>`。它不能与事项筛选混用；先复核事项所属域或源身份存在，再查询 owning 域审计表。仅返回 `id/action/operator_uid/channel/created_at`，不返回 `old_value/new_value/resolution_json/row_json`。页码、每页条数和 COUNT 同快照，ID 倒序稳定分页。Finance 不可读取 Altoc 人员匹配事件。
- 合同 `summary.effectiveMetrics` 按当前筛选与既有合同范围分币种统计；`contract_count` 为集合内排除“其父合同也在同一可见集合中”的子合同后的数量，`missing_count` 为该集合中有效额 NULL 的数量，`effective_amount` 只加已登记有效额，全缺失时为 NULL。隐藏或已被筛掉的父合同不参与去重，不回退到签约额。客户 rollup 的同名指标沿用已有 rollup 集合（销售类、非终止合同），不改变已有记录数或签约额指标。
- Finance `accounts-list` 的截至日期模式要求有效 `asOfDate`；可选 `staleBefore/balanceState/currencyCode` 仅在该模式使用。沿用账户读取门槛与有效快照规则，先取截至日内每账户最新有效日期；手工确认优先于被其取代的导入证据。同日仍有冲突时金额为 NULL、不按 ID 选胜出；无快照为 missing，只有显式过期边界才判 stale。汇总按主体和币种分组；缺失/冲突不计金额，真实零余额仍有效，stale 金额纳入且单列数量。旧 Finance permit 参数不变，新增非空参数签入意图。
- 页面默认待处理，分页 20/50/100；URL 保留查询，本机视图仅保存列名并按应用/会话作用域隔离。无权时清空结果；刷新失败不伪造零值。合同差异始终只读，没有通用解决入口。
- 本轮 R5 仅覆盖两域迁移事项及 Altoc 身份匹配的处理事件；全域业务对象时间线与统一附件聚合尚未接入，相关入口省略。已有附件/知识引用访问与下载复核合同不变。

### B5-A 应收工作台、账龄与催收责任

当前结算计划 read 与催收 write 沿 Altoc owning APF 用户通道，精确 `receivables:{page,detail,aging-summary,set-collection-owner,set-due-date,followup-create}`，复用 altoc:enterprise-host:execute；新增敏感人员动作由 Altoc manifest 显式声明。范围、当前业务日、分币种合计、法人筛选的额外 Finance 授权、锁序、追加事件/receipt/CAS、历史护栏与安装失败关闭见 [B5-A 合同](B5A-Receivables-Contract.md)。通知继续沿既有 billing-due S/P 通道，不开启 scheduler、不新增 grant。


### Host 项目管理原生入口与批量部门事务（2026-10-06）

导航稳定区域 `delivery` 更名为“项目”。项目文档迁至该区域；项目管理入口仍为 `/aims/admin/projects`，仅静态 `admin:admin` 可读写，不能用项目经理关系替代。原独立 Aims 管理页保留。Host 新增 `/aims/admin/projects/:id/edit` 与 `/aims/portfolios/new` 原生组合页面，登记项目复用 `/aims/projects/new`；成员和生命周期审批链接已登记的项目内页面，仍执行各自现时范围与关系校验。管理员强制状态改写、彻底删除不提供 UI 入口。

管理员列表新增可选 `projectId`（精确读取）、`sort=code|name|updated|start`，`portfolioId=0` 表示未分组；搜索新增负责人 UID。未提交参数时保留原排序与输入形状，参数位于原受信请求体，不改变旧读许可签名字节。COUNT、分页、版本与单项目 members/milestones/workItems 数量在同一只读事务内计算。管理员编辑仅提交既有白名单字段与当前 editVersion；409 保留草稿并精确回读项目比较。

- `POST /aims/api/v1/admin/projects/batch-create-routine` → 固定 `aims.admin-project-routine-batch` → `POST /v1/enterprise/aims/admin-projects:routine-batch`。浏览器仅提交 `year`（2000–2100）和 Idempotency-Key，不接受部门、成员或管理标志。Host 先验证无对象范围静态 `admin:admin`，再读取 Directory 正式部门、有效负责人、分页 active 成员；负责人状态按每批最多 100 UID 查询。缺负责人部门跳过。Runtime 再核对服务身份、租户、部署、actor、admin-static permit 与 15 秒有效期。
- 批量写入复用原 owning 逻辑，但使用 registry generation 栅栏与 caller-Tx。锁序为 binding registry → command receipt → 日常事务项目集 → 按部门编码排序的项目/成员。回执意图只包含年度，首次成功后同键同年不因目录变化重新创建；同键改年 409。重放只确认原回执，不重复展示未保存的首次业务响应，UI 回读列表。
- 既有 `/aims/api/v1/portfolios` 创建仍要求 `portfolios:admin`，不从 `admin:admin` 推导权限。原精确 `project-portfolios:create` Host 固定操作补强为必需 Idempotency-Key、registry 栅栏、回执与项目集 INSERT 同事务；旧独立 owning 创建路径不变。重放返回回执确认，不二次 INSERT。

本批只新增一个固定 Runtime 路径，复用既有 `aims:enterprise-host:execute`，不新增资源、人员动作、capability、grant 或 schema，无需 Platform manifest 发布和 test 重签；上线须配套部署新 Runtime，不能仅热更新页面。

### Host 管理员项目树只读投影

现有 `aims.admin-project-list` 支持仅在有值时提交 `query.tree=true`，复用 `admin:admin` 静态授权和原精确 Runtime 路径，不新增 capability/grant。该投影的 `items` 为项目集根节点（`id/code/name` 与已有项目集编辑字段），`total/page/pageSize` 按根节点计；空项目集无筛选时保留，未归属项目集的项目以 `id=0` 的“未分组”节点展示。项目搜索/分类/状态筛选只保留包含匹配项目的父节点；展开时以现有 `portfolioId` 筛选独立分页项目，`0` 对应 NULL。读取在同一只读事务内完成，项目明细原投影与许可字节不变。项目集编辑复用现有 PUT 与 `portfolios:admin`，项目创建只预填项目集 ID，后端原授权继续校验。

Host 项目集树修订：每个根节点增加 `projectCount`，统计与同次管理员项目列表完全相同的筛选与可见授权上下文（包括未分组），不从目录全局统计推导或透出不可见数量。树读只面向已验证的静态 `admin:admin`，有限项目范围不能获取该投影。项目集已有编辑字段增加 `editVersion`（当前持久字段快照 SHA-256）。现有 Host PUT 更新必须携带 `expectedVersion` 与该用户意图的 `Idempotency-Key`；Runtime registry 栅栏事务内锁定项目集、校验版本、写入与回执原子提交，过期版本返回 `409 portfolio_version_conflict`，同键同命令返回回执确认，同键改命令冲突。独立 Aims 兼容入口不变，无 schema/capability/grant 增项。

## B5-B 净期初接续与分配（2026-10-06 候选）

历史销售合同只采用净期初路径：已审核 opening 的金额与快照日 T0 冻结在 Finance 激活记录，旧 OA 收款/发票/支出仅作保全查询，不生成 Finance 核销。余额为期初减 T0 后有效核销及已确认调整；撤销按实际时刻留痕，不删除原事实，不允许同时启用全历史重建。没有可靠 T0、opening review hash/confirmation、完整映射和逐合同一致性证据时继续拒绝。关闭/中止合同不豁免未结应收。

新增 Finance 固定用户操作：historical-finance-preview/activate、historical-finance-history-page、allocation-candidates、allocation-batches-page/detail、reconciliation-allocate-batch、allocation-batches-reverse、receivable-adjustments-page/detail/create/confirm/reverse。沿用 finance:enterprise-host:execute；人员历史接续及调整使用 manifest 的精确资源/动作，确认/激活不由 admin 蕴含。录入者与确认者不得同人，actor 仅取受信委托。每个写动作携带 Idempotency-Key、当前版本，回执与全部事实同事务；相同键异 payload 返回冲突，重试同键不重复记账。

锁序先冻结：Registry → 客户（ID 升序）→ 合同（ID 升序）→ 结算计划（ID 升序）→ 历史接续记录 → 发票 → 到账 → 核销/分配组/调整 → Finance 合同摘要 → 项目成本财务目标 → 回执/审计。发现阶段只读；锁定后重验版本、目标关联、币种、客户、法人主体与当前权限。多目标容量与余额在同一事务重新计算，全部成功或全部回滚；撤销和调整复用同一锁序，拒绝导致负未结的变更。历史激活只读取迁移台账；不得更新原 mig_batch/mig_object_map 或修改确认文件。

安装候选 finance-receivables 为三张新事实/审计表：finance_historical_readiness、finance_allocation_batch、finance_receivable_adjustment。走 domaininstall 原停止检查、plan/reviewHash/apply/verify/checkpoint/rollback。新表缺失时新写入口失败关闭；原业务读取仍可用。安装与逐合同激活是不同动作，不因建表自动放开历史写。Platform 必须导入新 Finance manifest 并仅重签授权环境，未执行前新增敏感按钮继续失败关闭。

B5-B 的精确操作、人员角色增量、净期初证据边界、跨域 caller-Tx 与安装步骤见 [Finance B5-B 合同](../finance/docs/B5B-Receivables-Contract.md)。原子分配本批只承接结算计划目标；未知法人主体失败关闭，组内核销禁止单独撤销。旧支出保全源表使用实际 `wb_project_payment`，不生成台账或冲减净期初。

部门协作默认成员可写仅调整正文协作与详情提示；标题/目录移动、回收等管理规则不随之放宽，个人文档owner/share规则不变。分享变更撤销当前会话的epoch机制保留，但仍在本部门的成员可重新打开；离部门或停用仍在admit/renew/publish重验时拒绝。

### 2026-10-07 部门负责人写入裁定

Directory EnterpriseCodocsDepartmentRole.CanWrite 包含直接 active leader/member/manager；parent/none 不写，CanManage 仍仅 manager。正文协作与 Host can_edit 使用同一结果。创建/上传/复制目标因此允许 leader；标题修改仍核 owner/写分享，移动仍核 owner/manager；回收、只读、恢复、目录管理不扩大。本文此前 leader 只读描述由此裁定覆盖。

### Aims 退役 R2 补漏：项目文档访问判定

Host `POST /aims/api/v1/projects/:id/documents/:documentId/access-check` 调用固定 `aims.project-document-access-check` → `POST /v1/enterprise/aims/project-documents:access-check`。复用既有 `aims:enterprise-host:execute` 用户委托身份与 projects:view、父项目短期范围 permit；不新增 grant。Runtime 自读项目文档归属、UUID、项目成员/部门/角色事实，再调用 Codocs typed ACL 核心；浏览器不能提交 UUID、actor 或关系事实。动作闭集为 view/download/edit，只读文档拒绝 edit，缺失/删除对象拒绝，保留既有访问审计。该路径不再调用仅接受 aims.runtime 的旧 Codocs Service API，也不放宽旧接口身份限制。旧 permit 格式与字节不变。 Git 仓库文档的 UUID 仅使用 cabinet_file 策略命名空间，不代表 cabinet_files 实体；Aims owning adapter 先复核项目文档归属、当前成员及精确仓库绑定，再通过独立 typed 入口复用相同 ACL。真实 Codocs/cabinet 引用仍要求实体存在且未删除。所有允许/拒绝结果均返回 allowed、permission、readonly、reason、lifecycleStage、confidentialityLevel；缺失实体固定 reason=document_not_found。前端异常/缺字段响应失败关闭，不覆盖有效的生命周期/密级显示。
### Console 系统公告（候选，2026-10-07）

Console 拥有公告、范围、本人已读及分渠道投递事实。Enterprise 通过 `console/server/public/announcements.ts` typed 入口组合人员读写 BFF，复用 `console:enterprise-host:execute`，不自调用 Console HTTP；管理页面原生组合到 Enterprise Host，独立 Console 仅提供跳转入口。人员权限 `console:announcements:view/admin` 由 manifest 定义，Runtime 重验绑定完整命令/幂等键/策略截止时间的许可及实时 Directory 范围。立即投递在当前公告管理员的固定 U 操作内执行，逐次重验人员许可；冻结 outbox 使用稳定键与栅栏回执，失败由管理员原键恢复。无机器调度、新服务 scope 或新 grant；定时公告读取时生效，本轮不支持定时推送。全员基线仅增 announcements:view，系统管理员增 announcements:admin。详见 [系统公告实现与发布约定](System-Announcements.md)。Platform 发布、test 重签、DDL/常驻帮助种子和生产启用仍各自待批，不因代码合入自动执行。

### AR09：Aims 旧 URL 与项目文档关联恢复

旧页面按精确 Host 注册表兼容，详见 `Aims-Legacy-Page-Compatibility.md`。settings 复用已授权的原生编辑页；登录/个人资料只作固定客户端重定向；无 Host 等价功能的源 URL 提供归档说明，不恢复独立 Aims API，不新增能力或 grant。

项目正文 UUID 关联先按签名项目范围与当前成员复核。相同 UUID 若另有悬空项目索引，`project_not_found` 候选不遮蔽权威解析到目标项目的合法引用；只有悬空或其它项目引用仍拒绝。数据库与权限失败不跳过，不修改存量索引。总览仓库预览携原 projectDocumentId，与项目内预览保持相同的固定版本及引用 ACL。

### 文档共享：禁止自共享（2026-10-08）

创建文档共享时，目标 UID 不得等于文档的权威 owner UID 或已验证操作者 UID。Host 提前拒绝操作者自共享，Runtime 按当前文档 owner 和签名 actor 再验，返回 HTTP 400 `share_self_not_allowed`；拒绝发生于共享事务开始之前，不写共享/关系行，不发通知。文档列表共享弹窗和编辑器共享面板均排除当前用户，并拦截过时的自选结果。既有所有者自共享行只读统计，清理须另行批准。

Host 共享列表的姓名补全使用 Foundation Directory 的 `console:directory-users:read`（audience=console）既有共享投影，不申请目录管理 scope；补全失败仍保留 UID 回退，不改变文档共享 ACL。共享保存与通知投递分开判断：外部投递失败保留共享事实及原幂等键，不把重试变成新共享。


### Codocs 共享通知的外部身份降级（2026-10-08）

Codocs 共享通知在既有 Console 通知发布合同中显式请求 `resolveExternalChannel`（闭集：`wecom` / `dingtalk`）。该传输字段不进入规范通知正文和摘要，不改变既有幂等键、permit 或能力；未启用的调用保持原行为。Console Runtime 只解析本次规范通知收件人，通过 Directory 的 active 身份返回绑定目标；不接受调用方自报外部身份。该响应仅用于服务端投递，不下发浏览器，不记录外部身份值。

收件人缺有效外部绑定或已停用时，在同一通知事务中记录 `skipped` 及闭集原因。站内通知成功后，外部跳过不构成共享失败；有效绑定的收件人仍正常投递。Directory 依赖故障、响应不完整或不匹配不得降级为跳过。原键重放不重复写跳过记录。真实临时投递失败保留 pending 和原键；授权/配置或渠道明确拒绝显示已共享与渠道提示，不伪装为共享行写入失败。

共享列表姓名补充复用 Foundation 既有目录用户读取合同；失败仅回退 UID，不改变共享 ACL。禁止将文档共享给当前操作者或文档所有者：Host 与 Runtime 在写入/通知前返回 `share_self_not_allowed`。历史自共享行不自动清理。
### Console 全局文本反馈（G0+G1，2026-10-07 候选）

- Enterprise → `console/server/public/feedback.ts` 为同进程 typed owning 入口；Foundation UI 不调用 WebDev、不派发 Agent 任务。Host 跨进程访问 Runtime 的固定 `console.feedback-{options,draft,submit,list,detail}` 使用 `enterprise.runtime` / `console:enterprise-host:execute`。
- 固定 POST `/v1/{enterprise/console,console}/feedback:{operation}` 需要签名用户委托和 14 秒人员 permit。permit 绑定 method/path/Idempotency-Key、payload、UID、tenant/deployment、资源/动作、策略版本/hash/revision、self/global 投影；Runtime 复核活跃 Directory 用户、tenant 与本人归属后才处理或重放。Host 不提供 settings/admin/retry/cancel 操作。
- 人员事实见 Console manifest：`feedback:view/submit/retry/admin`、`feedback-settings:view/edit`。`admin` 不蕴含 `submit/retry`。员工基线与 reporter 角色为 `subject:self`；管理员为租户范围。列表固定每页 20 条，detail 独立复核。授权模拟禁止写。
- Console scheduler 复用已受信 `/api/internal/integration-operations/drain`，只在无其他 operation claim 且 `feedbackDeliveryEnabled=true` 时执行有界反馈 drain；默认关闭。Runtime `/v1/console/feedback:drain` 与 `/v1/console/feedback-notifications:{events,freeze,claim,ack}` 仅接受 `console.runtime` 的精确 `console:feedback-delivery:execute`、实时 credential/grant 校验，拒绝用户委托。双 audience seed/verify 为 v2.41；环境令牌签发与现有通知/目录/策略 scope 组合验证是启用前置条件。
- hzy0 的反馈机器 owner 为本机 Gateway：仅 `features.feedbackDeliveryEnabled=true` 时每 30 秒签名唤醒既有 Console drain 的 `{feedbackOnly:true,phase:issue|notification}` 闭集分支（两阶段交替，避免外部通知重试阻挡建单），验签与开关校验先于分支；单实例防重叠、25 秒请求上限、关闭/退出清理 timer，不启用其它 Console/租户任务。复用 v2.41 双 audience 精确授权，无用户委托或宽 scope。该分支直接返回，不认领相邻 lifecycle/actionable/announcement 命令。
- Runtime 使用持久反馈记录冻结的 integrationCode，通过 Console 内部拥有的 GitLab 凭据解析内核建单，目标固定 `huizhi-yun/huizhiyun`；不借用 Aims `issue-upsert`，不修改任意 IID，不把 Token 发往 Nuxt。投递前提交 dispatching 意图；超时、5xx、回执不完整或 lease 丢失转 unknown，只进行分页精确 marker 对账。零命中保持 unknown；明确拒绝/建单前依赖失败转 failed，只有显式 retry 权限可重投。
- 状态与通知意图同事务；事件、接收人、铃铛/企业微信各有持久回执。接收人按配置 UID/角色去重并冻结，发送和通知详情重新验证活跃用户及租户范围 feedback:view；未解析到合格接收人保持待投递。铃铛已成功时外部重试沿用同一键。Console typed publisher 经 Foundation 通知投递链路发送，保持 `notifyRedirectTo` 和本地 in-app-only 限制。反馈消息详情先经 Runtime 绑定当前收件人，再核验正式签名 revision 与实时活跃/反馈读取权限；用户读取不触发策略快照写入，漂移/依赖故障仍失败关闭。
- 通知只含类型、标题、提交人姓名、页面与 Issue 链接；不含描述、图片、诊断或底层错误。外部回链取可信 deployment public URL 绝对地址；配置保存要求与当前部署入口一致。员工/管理员查看记录仍独立受权。事件回执只表示本地验证，不能代表企业微信生产送达。
- v2.41 在 Console schema 安装四表；不改变业务域表。草稿 24 小时、本地已完成记录 180 天，有界清理每次最多 50 条；failed/unknown 或未完成通知不自动删除，GitLab 留存独立。迁移、Platform manifest/基线发布及 test 重签、真实外部测试写入和 scheduler 开启分别待批。

### Console feedback 图片与截图（G2+G3）

Host → Console public typed → Runtime 固定 `feedback:attachment-put/attachment-read`；Console 管理端另有 `cleanup-media`，Host 禁止此管理操作。人员动作分别为 feedback:submit/view/admin；复用原有精确服务通道，不新增 admin 对敏感动作的蕴含。二进制先在 BFF 有界读取，完整 base64 payload/摘要、对象、UID/tenant/deployment/策略与幂等键进入同一 HMAC permit；Runtime 再复核所有权、内容摘要和尺寸，重编码去元数据。私有表与 schema manifest 为 v2.42，默认图片 gate 关闭。

GitLab 上传固定 `huizhi-yun/huizhiyun`，凭据只在 Runtime integration/vault 解析。发图前必须有未过期人工匿名验证记录，并实时核验 private/enforce_auth_checks_on_uploads。逐图 intent/receipt 和父任务 attempt fence 防止盲重传；未知上传只按文件名+字节摘要对账。管理员清理仅限已取消、无 Issue 回执、固定回执 ID 的孤儿图片；普通 worker 不删除。图片 URL/内容不进入管理员通知。启用、保留期、GitLab 精确设置和恢复限制见 Global-Feedback-Design §14。
