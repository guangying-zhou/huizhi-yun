# Enterprise Host API（实施中）

## Codocs B2：组织资产与开放文档（本地候选）

Host 注册 `/codocs/api/company-assets/{list,preview,mkdir,directory,move,archive,access-records,access-records/export,import-source,import-documents}`、`/codocs/api/open-department-docs[/:uuid]` 与 `/codocs/api/published-asset-links[/:token]`。所有请求先取已验证 Enterprise 用户，再按 Codocs Console 快照校验人员权限；快照故障返回 503。列表、预览和短链对象读取要求 `company:view`；目录写要求 `company:admin`；查看记录要求 `admin:admin` 与 `company:admin`，导出再要求 `company:export`；快速发布要求 `admin:admin` 与 `company:publish`。人员权限不来自浏览器字段，服务 permit 只证明已签署的 Runtime 请求。

组织资产路径限 `codocs/company/{rules,notices,legal,culture,tech-specs,knowledge,templates}/`，列表接受规范 `page=1..1000000`、`pageSize=1..100`，按请求完整列举 OSS 后返回 `{items,total,page,pageSize}`。预览在返回正文或 PDF 字节前必须成功提交查看记录；记录依赖失败返回 503 且不交付内容。目录写和快速发布由 Host 稳定用户意图 UUID 驱动，Runtime 在服务命令回执中分别记录 prepare/complete；OSS 条件写与状态核验发生在两次 SQL 提交之间，失败后同键重试恢复，不宣称 OSS 与 MySQL 原子提交。移动或归档遇到源版本改变、目标被其他操作占用时返回 409；源 ETag 校验与删除之间仍有竞争窗口，失败恢复须核对对象状态；超过 100 MiB 的文件需要另行处理。

部门开放文档仍由 Codocs Runtime 的显式开放目录及后代、未发布、非周报谓词决定，`uuid` 只能缩小集合。短链解析仅返回路径，不授予权限；Host 根据当前对象重新判权，随后内容端点再次检查。B1 部门对象关系接线前，Host 对部门资产短链失败关闭；旧 `products` 类短链也保持关闭，待兼容批处理。

## 浏览器 401 续期与重试（2026-09-28，本地候选）

Host 客户端对同源业务 API 的 401 合并续期并重新核验会话。仅在请求发出前与续期后的已验证 tenant/uid/subject/policy/deployment 上下文完全一致时，GET/HEAD 或带 `Idempotency-Key` 的非流式写请求可重试一次；原上下文缺失、切换身份或策略变化时保留原失败，不能把旧操作自动提交到新上下文。无幂等键的写请求只续期、不重试。认证接口、Console 与跨源请求不参加；续期服务暂不可用不等于登出。

## PUT /codocs/api/documents/:uuid 保存重放修正（2026-09-20，本地候选）

保留 title/content/saveMode 与 Idempotency-Key；Host 经 `documents:edit` 调用只读 `POST /v1/enterprise/codocs/personal-documents:update-plan`，精确 capability `codocs:personal-documents:edit`，短期 edit permit 与签名 actor/tenant/deployment 绑定。计划在 OSS 之前检查当前写 ACL、只读/删除状态及完整命令回执；已成功同请求返回 `{success:true,data:{uuid,updated:true,contentUpdated,replayed:true}}`，不 HEAD/PUT OSS、不重写后来修改的标题；同 key 异命令 409。无成功回执才使用原 OSS 路径写入，存储后重取业务权限，再提交原 `personal-documents:update` 事务。新计划不创建回执或持有跨请求锁；Runtime 不具备该路由时失败关闭，不退回旧顺序。

私人文档启用 snapshot v2 时，完整正文 GET 返回 `snapshot_generation`、`snapshot_epoch`；PUT 正文必须携带 `expectedGeneration`、`expectedEpoch` 和布尔 `titleChanged`，缺失返回 428。Host 原样采用客户端读取时的期望代次/epoch 构造 Runtime 快照命令，不按保存时最新 head 重建。Runtime 在事务中校验代次/epoch，并以 Idempotency-Key、期望版本和正文 SHA-256 绑定候选；prepare 若返回 `replayed:true`，Host 直接返回已发布 generation，不再上传。相同 key 的不同命令返回 409；冲突保留客户端正文。标题是独立的 `:title` 子命令，响应 `titleResult=unchanged|updated|replayed`；正文回执的 `replayed` 只描述正文。

**未关闭/发布限制**：只读预检不能保护尚未完成的并发写，OSS 与数据库仍非原子；存储成功但提交失败、预检后撤权、同时保存/协作写等恢复仍待实现和真实依赖验证。不把发出 `If-Match` 头等同于当前 provider 已保证原子条件覆盖，未添加未经证明的存储条件；本轮不是完整编辑闭环或可发布声明。

## Host 导航访问快照（ADR-019 review 修正）

`GET /enterprise/api/navigation`：验证 Enterprise 用户会话与受信租户/部署绑定，结合本发布的注册导航和服务端 Runtime 配置，分别读取 Aims、Assets、Codocs 的 Console 人员权限快照，复用 Foundation 动作蕴含判断。返回 `visibleIds: string[]` 与仅用于导航展示的 `maxAgeMs: 300000`（5 分钟；客户端每 2 分钟及路由切换、窗口获得焦点时刷新，2026-09-22 由 60 秒/30 秒放宽），不返回权限快照或对象名称；HTTP 禁止缓存。多个权限引用默认全部满足，显式 `mode=any` 才按任一满足。同一验证身份的后台刷新保留有效导航，客户端从请求开始计时且最长 60 秒，30 秒轮询，绝不因重试延长旧有效期；到期、失败、明确撤权清理，退出/主体/租户/策略上下文变化立即清理并拒绝迟到响应。此展示租约不授予权限，业务接口仍逐次鉴权。

未登录返回 401，绑定不符沿用 403，授权依赖不可用保留 503；未配置 Runtime 返回空可见集合，不回退旧应用。菜单隐藏不是授权边界，详情、写入、范围及字段权限仍由原 handler 执行。浏览器在会话/策略变化、切页、重新聚焦和可见页面定时重验时刷新，旧代次结果不得重新填入菜单。

## Host 模块权限快照（2026-09-28）

`GET /enterprise/api/auth/permissions?app=<module>`：供组合页面按钮/入口显隐的浏览器快照（UI 提示，非授权边界）。先 `requireEnterpriseUser`（未登录 401、绑定不符 403），`app` 必须是唯一且单值的 query，取值限生成导航的 `navigationSources`（aims/assets/codocs/console/altoc），否则 400；再经可选 verified-policy gate，调用 Foundation `loadAuthorizationSnapshotFromConsoleRuntime(uid, app)` 的普通合并快照。响应 `{ code: 0, data: { appCode, uid, roles, availableRoles: [], activeRoleCode: '', resources, actionPolicies } }`，`private, no-store`；Console 不可用或快照无效 503 `enterprise_authorization_unavailable`，不返回空 200。不同模块分别请求，不合并同名资源码。

未登记的 `/enterprise/api/**` 返回 JSON 404 `enterprise_api_not_found`（不是 SPA HTML）；经网关 auth 改写到达 Host 根 `/api/**` 的未登记路径同样 JSON 404。

本文件记录已接线的 Host API；代码登记不等于目标环境已完成身份、授权、数据迁移与流量验收。未登记入口明确不可用，各批次的历史说明需结合当前源码与最新验收记录判断。

## 工作项创建与基本信息编辑（2026-09-15）

`POST /aims/api/v1/projects/:id/work-items` 与 `PUT /aims/api/v1/work-items/:id` 均要求 `Idempotency-Key`，拒绝 query。人员权限分别为 `work_items:create/edit`，服务 capability 分别为 `aims:work-item-create:execute`、`aims:work-item-edit:execute`。编辑 body 包含 `projectId`、详情返回的 `editVersion` 作为 `expectedVersion`，以及变化字段。

基本编辑仅接受 title、description、priority、assigneeUid、startDate、dueDate、estimatedHours；状态、结构和版本关联明确拒绝。创建字段遵循原项目工作项创建校验，受派人员必须是活跃项目成员，里程碑必须属于项目。Runtime 校验用户绑定的 15 秒 permit，并在同一事务中提交事实、审计和 receipt；同键重放返回冻结结果，不同键旧内容版本返回 409。状态/关联/outbox 的完整迁移仍待完成。

版本关联另走工作项 `association` 子路由，精确 service capability 为 `aims:work-item-associate:execute`，人员权限为 `work_items:edit`；不通过基本编辑放开字段。复用原关联合同并锁定项目产品绑定、源/目标版本，维护 scope revision、审计和 receipt。人员活跃校验通过独立 Console `console:directory-users:read` service hop，短期证据绑定 actor/tenant/deployment/对象/字段/操作；业务事务不查询 Console 目录表。状态审批、结构调整和工单结果 outbox 仍待完整迁移。

## 数字资产读取（2026-09-15）

`GET /assets/api/v1/digital-assets` 接受 page、pageSize、search、status；`GET /assets/api/v1/digital-assets/:id` 不接受 query。人员权限为 `digital_assets:view`，独立服务 capability 为 `assets:digital-asset:read`，Runtime operation 为 `assets.digital-assets-list/view`。

`POST /assets/api/v1/digital-assets` 与 `PATCH /assets/api/v1/digital-assets/:id` 必须携带 `Idempotency-Key`。两者都要求由 Console 快照签发的、绑定用户/租户/Host deployment 的短期 `digital_assets:edit` permit；Runtime capability 分别为 `assets:digital-asset:create` 与 `assets:digital-asset:edit`。编辑请求中未出现的字段保留，`storage_location`、`owner_uid`、`project_code`、`environment_id` 和 `notes` 显式 `null` 清空；数字资产编号不可改。

BFF 编译当前人员对象范围，Runtime 校验签名身份、租户/部署、当前 credential/grant 和 15 秒 permit。数字资产只有 owner/project 范围，无法执行的部门或关系约束拒绝匹配，不降为全量。此批本地测试不证明目标环境已启用。

## GET /aims/api/v1/projects 与 /aims/api/v1/projects/:id

第一批 Aims 项目管理读取入口。Host 仅接受项目列表的 `page`、`pageSize`、`search`、`category`、`lifecycleStatus`、`portfolioId`、`participatingOnly`，详情不接受 query；浏览器不能传递 actor、部门、项目管理员范围、tenant 或 deployment。

BFF 从已验证 Enterprise 用户会话取得 uid/tenant/deployment，读取 Console Directory 的当前部门与管理部门，再复用 Aims `projects/admin` scoped-authorization 投影。它把这些受信范围与短期 `projects/view` permit 发送到固定 Runtime 操作 `POST /v1/enterprise/aims/projects:list` 或 `:view`；两者要求精确 `aims:projects:view`，固定 Enterprise service identity，并在 Runtime 再校验签名 actor、租户、部署、当前 credential/grant 和 15 秒 permit。Runtime 只调 Aims 既有项目可见性查询，保留项目成员、负责人、部门和 scoped-project-admin 的范围语义。

这批次是只读的：项目新建/编辑、成员、工作项、工时、周报、文档和审批仍由独立 Aims 提供，未注册的 Host API 继续返回明确不可用。目标环境仍需完成 Enterprise `aims:projects:view` grant verify 与登录后页面验收。

## GET /assets/api/v1/product-directory

浏览器使用 Host 已验证的 Console OIDC 用户会话。筛选字段：`page`（默认 1）、`pageSize`（默认 50，最大 100）、`keyword`、`productCode`、`productLine`、`watermark`。拒绝未知字段与数组，后续页携带首屏水位。

BFF 通过 Foundation 向 Console 查询 `assets/products/view` 的当前 scoped authorization，复用 Assets 范围编译器。产品主档没有部门维度，不能丢弃部门约束后当作全量；产品归属由 Runtime 同一只读事务中的实际行判断。浏览器不能覆盖 actor、tenant、deployment 或授权范围。

托管 Host 的业务 permit 使用经过 Gateway 密钥验证、且与用户 tenant 匹配的 Enterprise deployment；用户 access token 中的 Console 签发部署保持原样用于会话验证和 actor 委托，不与业务部署混用。未经验证的请求头不能选择 permit 部署。

调用链：Host → Foundation `callEnterpriseRuntime` → Runtime `POST /v1/enterprise/assets/product-directory` → 注册统一库的 Assets 内部目录服务。该 POST 是查询命令，不写事实、receipt/outbox 或历史快照，也不经过旧 Assets Worker。成功返回 `{code:0,data:{items,product_lines,total,page,pageSize,watermark}}`；只包含授权内产品与产品线，名称直接来自权威主档。

身份固定 `source_app=enterprise`、`client_id=sub=enterprise.runtime`、`token_use=service`；audience 为配置的 `data-runtime` 或 `tenant-runtime`。精确 capability `assets:product:read` 不加传输前缀；实际 audience 分别登记精确 grant，不借旧 app 身份或宽 scope。Runtime 要求显式 enterprise deployment binding，并每次校验当前 credential/grant。

内部 body 包含 query 和 BFF authorization（actorUid/tenant/deployment/resource/action/expiresAt/scope）。actor 匹配 bearer-bound 签名用户，资源/动作固定 products/view，期限最多 15 秒；租户和 Host deployment 匹配 JWT 与本地登记。schema、generation、域和表名仅来自本地配置。

错误：401 无有效身份；403 绑定/能力/范围不满足；400 无效筛选；409 水位变化需重新分页；503 登记或服务依赖不可用。业务响应不泄露内部诊断，设置 `Cache-Control: no-store`。

证据：Foundation HTTP 测试覆盖精确 scope、签名 actor 与伪造上下文不转发；Runtime 覆盖 JWT、授权证据绑定/期限和现有范围约束；真实隔离 MySQL 目录验证见[数据合同](../../docs/Unified-Enterprise-Data-Contract.md)。Runtime 实际 Ed25519/JWKS 验证、HTTP handler、当前凭证/精确 grant 查询与真实 MySQL 已由 `node data-runtime/scripts/test-enterprise-directory-mysql.mjs` 联合验证（含 owner 隔离、当前改名、错租户、撤销和依赖 503）。正式 OIDC、Console 用户授权到 BFF 的完整链路及环境 grant 启用仍待完成。


## Runtime POST /v1/enterprise/aims/product-requests:create

这是已接线的 Runtime 内部入口；Host 浏览器 BFF 为 `POST /aims/api/v1/products/:productCode/requests`，沿用原需求输入字段与校验。仅在 enterprise 启用、Aims writer 为 unified 且启动时通过所需受管视图验证后可用；否则启动拒绝不兼容配置或接口返回 503。

采用上述固定 Host 身份、签名 actor、明确部署绑定与当前 credential/grant 检查，精确 capability 为 `aims:product-requests:create`。请求头 `Idempotency-Key` 沿用原产品命令身份。body 为 `{productCode,tenant,deployment,authorization,input}`：tenant/deployment 必须匹配受信上下文；authorization 是既有 productcenter permit，resource/action 固定 `product_requests/create`，facts 的 product_code/actor_uid 必须匹配，expires_at 最多 15 秒；input 使用原 RequestDraft（expected_revision/title/problem_statement/source_type/urgency_level/可选 component_id）。未知字段拒绝，浏览器不得自行提交授权证据。

Runtime 在统一库事务内先锁定并核验持久迁移代际，再由原需求领域命令锁 workspace、重读成员事实、检查修订、写需求/audit/receipt，最后提交。相同 key 同 payload 复用原回执；不同 payload 冲突。返回 `{code:0,data:{receipt_id,replayed,value}}`。原领域错误状态保持，无法归类的 SQL/依赖故障脱敏为 503。

授权绑定单测和 `node data-runtime/scripts/test-enterprise-requests-mysql.mjs` 真实 HTTP/MySQL/race 验证已通过，包含旧 Go 入口重放、冲突、撤销、持久代际与依赖错误。新增授权事实预检的联合验证继续补充；不代表目标环境已启用。


### Host 授权编排

BFF 从已验证 Host 用户会话取得 uid/tenant/deployment；先调用内部 `POST /v1/enterprise/aims/product-authorization`（精确 `aims:products:authorization-object`，body 仅 `{productCode}`），取得该签名 actor 自身的 `productcenter.AuthorizationFacts`。此接口没有对应浏览器路由。BFF 将事实通过 Aims 原 `requireProductPermission` 的服务端数据源适配传给 Console，复用 Foundation 原产品范围求值；无权时仍按原可见性判断返回 403/404。获得许可后才构造短期 permit 并调用创建命令，浏览器不能提供授权事实或运行身份。

Foundation 已登记预检和创建两个固定操作，创建的 `Idempotency-Key` 保持传递；4 项 HTTP/身份/幂等测试和 Host typecheck 通过。服务初始化读取兼容视图定义需要数据库账户具有所需视图的 `SHOW VIEW` 权限，以及已批准的表级读写权限；不因此授予 CREATE/ALTER/DROP 等 DDL 权限。产品页面其余 API/动作与目标环境完整用户流程仍待验收。


## GET /aims/api/v1/products/:productCode/requests 与 /requests/:requestId

Host 列表/详情复用原 Aims 查询参数解析和 `product_requests/view` 对象授权流程。列表按原 page/pageSize、keyword、decisionStatus、sourceType、urgencyLevel、模块等筛选；详情只接受规范 UUID 且不接受额外 query。内部操作分别为 `POST /v1/enterprise/aims/product-requests:list`、`:view`，都要求精确 `aims:product-requests:read`。

Runtime 列表 body 公共字段与创建一致（授权动作改为 view），另含原 RequestPageQuery 格式的 query；详情改为 bizId。使用登记 read 模式及持久代际共享锁，调用原 `ListProductRequestsInTransaction` / `ReadProductRequestInTransaction`，保持 workspace 锁下授权、总数和结果一致，读取不写 receipt/audit。初始化额外验证 product_versions、product_version_plans、product_version_plan_scopes、product_version_plan_confirmations 视图，保留原需求版本关联信息。当前 RequestService 仍随 Aims unified writer 初始化，单独影子读取配置及完整产品页面链另行接续。

Host typecheck、真实 HTTP/MySQL/race 列表/详情验证已通过，覆盖分页、筛选、不同 workspace 隔离、actor/view permit、代际失效与读前后 receipt/audit 数量不变；不能据此声称页面所有动作已完成。


## 产品权限提示接口

`GET /aims/api/v1/product-permissions` 要求已验证的 Enterprise 用户会话，复用 Aims 全局产品启用权限检查，返回 `{ code: 0, data: { onboard: boolean } }` 并禁止缓存。产品范围授权不等同于全租户启用权限；实际启用命令仍独立检查授权。

Host 已接入以下 GET 路由，并直接复用 Aims 原权限处理函数：

- `/aims/api/v1/products/:productCode/permissions`
- `/aims/api/v1/products/:productCode/requests/permissions`
- `/aims/api/v1/products/:productCode/versions/permissions`

服务端数据源以已验证 Host uid 获取 Runtime 当前事实；同一 HTTP 请求内按 productCode 合并事实读取，作用域不跨请求/用户/租户。各动作仍分别调用原 Console/Foundation 授权，不由 Host 重建角色算法。响应结构与原页面一致，首先要求对应 view 权限；每个业务命令仍独立重鉴权。权限为岗位许可提示，不代表尚未接线的命令已可用，页面就绪状态与完整调用链继续验收。

Host typecheck、相关 lint 及原产品对象/列表/全局接入 7 项授权回归已通过；目标环境真实岗位与完整页面验收仍待完成。

## 产品版本规划写入

### 版本研发交付范围读取与交付确认

Host `GET /aims/api/v1/products/:productCode/versions/:versionId/features` 仅接受 `page`、`pageSize`、`keyword`；`GET /aims/api/v1/products/:productCode/versions/:versionId/features/:scopeId/history` 仅接受 `page`、`pageSize`。路径 ID 为正安全整数，分页大小 1～100。两者先用当前用户的产品对象事实和 Foundation `product_versions:view` 检查，再以短期许可调用 Foundation 登记的 `aims.version-scope-list|history`，对应 Runtime `POST /v1/enterprise/aims/product-version:scope-list|scope-history`，精确 capability 为 `aims:product-versions:read`。Runtime 复核签名 actor、租户/部署、产品/版本/范围归属；缺权或越界拒绝、依赖不可用返回 503。

Host `POST /aims/api/v1/products/:productCode/versions/:versionId/features/:scopeId/{deliver|reopen}` 复用 Aims 的严格 ID、无 query、Idempotency-Key、正文及当前产品 `product_versions:accept` 校验，再通过精确 Foundation 操作 `aims.version-scope-deliver|reopen` 进入 Runtime `:scope-deliver|scope-reopen`。Runtime 要求各自的 `aims:product-versions:scope-*` 服务能力和签名 actor，复核人员许可与产品/版本/范围归属，调用原领域命令并共享 registry-fenced 事务、revision、release lock、审计、回执和反馈 outbox。页面仅在权限、版本及范围状态均允许时显示按钮；409 后刷新事实，不自动更换幂等键重提。编辑/公开性/历史标准维护仍属下一阶段。

Host 以下路由复用 Aims 原版本/轻量计划参数校验与权限流程，通过仅服务端可注入的 `ProductCommandBridge` 进入统一 Runtime；独立 Aims 默认传输保持原行为。

| Host 路由（产品前缀 `/aims/api/v1/products/:productCode`） | Runtime 操作（`POST /v1/enterprise/aims/versions:`） |
| --- | --- |
| POST `/versions` | `create` |
| PATCH `/versions/:versionId/plan` | `plan-edit` |
| POST `/versions/:versionId/plan/items` | `plan-item-create` |
| PATCH `/versions/:versionId/plan/items/:scopeId` | `plan-item-edit` |
| DELETE `/versions/:versionId/plan/items/:scopeId` | `plan-item-delete` |
| POST `/versions/:versionId/plan/confirm` | `plan-confirm` |

所有写入要求 `Idempotency-Key`。创建版本使用精确 capability `aims:product-versions:create`，其余使用 `aims:product-versions:edit`；均要求产品版本 edit 对象权限。创建计划项另要求需求 view 与规划 edit，采用需求时另要求需求 decide；确认计划另要求规划 prioritize。短期 permit、actor、tenant、deployment 在 Runtime 再次核验。Host 的用户及租户/部署来自已验证会话，不能由浏览器 body 覆盖。统一服务使用原领域命令及同事务 receipt/audit，不新增平行状态。

验证：Foundation 12 项传输测试通过，覆盖六个新增操作的精确 capability、身份、actor 签名及幂等键；Host 类型检查通过。`node data-runtime/scripts/test-enterprise-planning-mysql.mjs` 真实 HTTP/MySQL/race 覆盖六操作及逐一重放、payload 冲突、附加授权拒绝、grant 撤销和审计晚失败完整回滚。Host BFF 请求级与登录后业务页面验收继续进行；版本/计划读取等未接线操作仍返回明确不可用。


## GET /aims/api/v1/products

Host 复用原 `productListInput`、Foundation 产品范围编译器及全局 onboard 判断，分别读取 Aims 与 Assets 的 Console 授权。内部固定操作 `POST /v1/enterprise/aims/product-list` 要求 `aims:products:view`，body 为 `tenant/deployment/input/authorization/assets_authorization`。租户、部署和 actor 从 Host 会话绑定；两份权限有效期均为 15 秒。

Assets 缺权生成空目录范围，不自动否定独立的 Aims 工作空间权限；当前名称、产品线、源产品及分组由 Runtime 按 Assets 范围过滤。不得回退到历史名称绕过主档权限。真实服务查询使用同一 Repeatable Read 事务读取授权范围、总数与分页；`catalog_generation` 不再伪造旧投影刷新凭据，统一目录接入管理命令需另行对齐当前事实契约。

Host 类型检查、相关 ESLint 与 Foundation 13 项精确传输测试已通过。Runtime 路由已接线；`node data-runtime/scripts/test-enterprise-catalog-mysql.mjs` 真实 HTTP/MySQL 验证通过，覆盖双域范围、改名、空 Assets 权限、actor/tenant/deployment 绑定、授权撤销和过时代际。目标环境登录后页面验收仍待完成。


## GET /aims/api/v1/products/:productCode/components

Host 复用原 `handleProductComponent` 参数校验和 `product_components/view` 对象授权，经固定 `aims.component-list` 操作调用 `POST /v1/enterprise/aims/components:list`，精确 capability 为 `aims:product-components:read`。parentId/page/pageSize 保持原参数合同，响应保留 snake_case 及根节点/子节点分页语义。

Runtime 在登记的只读业务操作事务内调用 `ListProductComponentsInTransaction`，验证父节点属于当前产品，保持原工作空间权限和版本事实核验。Host 类型检查、相关 lint 及 Foundation 18 项传输测试通过；组件专项真实 HTTP/H3 回归接续中。新增接口不代表模块创建、移动、编辑或删除已接入。

## GET /aims/api/v1/products/:productCode

Host 工作空间详情要求 `products/view` 对象权限，使用当前 Runtime 授权事实和 Foundation/Console 原授权流程。随后独立计算 Assets `products/view` 范围，经固定 `aims.product-workspace-view` 操作请求 `POST /v1/enterprise/aims/product-workspace:view`（capability `aims:products:view`）。body 为 `productCode/tenant/deployment/authorization/assets_authorization`，两份权限绑定同一已验证用户和 Host 部署，15 秒有效。

返回保留原 WorkspaceDetail snake_case；当前名称与产品线由授权目录读取，不以历史投影回填不可见名称。Host 拒绝无效产品编码及额外 query。Host 类型检查、ESLint 及 Foundation 19 项传输测试通过；Runtime 详情专项 MySQL/HTTP 验证已通过，覆盖实时改名、产品线来源可见性、空 Assets 授权、旧成员事实拒绝及读取不写 receipt/audit；锁定工作空间的查询需要根表及对应视图 UPDATE 权限（MySQL FOR UPDATE），不是业务写操作授权。登录后页面验收尚未完成。

## 版本生命周期 Runtime 接线

新增内部固定 POST `/v1/enterprise/aims/product-version:{edit|delete|transition|reopen|archive}`，请求体为 `productCode/tenant/deployment/input/authorization`，并携带 `Idempotency-Key`。`input` 为原 productcenter 命令类型，拒绝未知字段和额外 query；租户、Host 部署、签名用户及短期 permit 继续分别核验。

精确服务 capability 为 `aims:product-versions:<action>`，其中 transition 使用原 `edit` capability；人员 permit 对应 `product_versions` 的 edit/delete/reopen/archive，transition 同样为 edit。服务复用原状态机、回执、审计和登记反馈来源，在统一写事务中执行；不能跳过发布证据或反馈来完成状态变更。初始化验证所需受管视图。

当前 Runtime 入口及初始化编译/单测通过；真实 HTTP/MySQL、Host BFF 及登录后页面生命周期验收继续进行，不代表这些 UI 入口已全部就绪。

## 知识产权资产（整合分支候选）

`GET /assets/api/v1/ip-assets` 支持实际服务端分页和筛选；`GET /assets/api/v1/ip-assets/:id` 要求精确对象。两者要求人员 `ip_assets:view` 与服务 `assets:ip-asset:read`，Runtime 操作为 `assets.ip-assets-list/view`，同一 Registry snapshot 返回 total/summary/page。关联产品不可见时不返回其全量计数。

`POST /assets/api/v1/ip-assets/:id/products` 要求当前用户 `ip_assets:edit` 和目标产品 `products:view` 的两份独立 scoped 授权，Host 仅接受正整数产品 ID 与 `Idempotency-Key`，以 `assets:ip-asset:link-product` 精确服务能力提交 Runtime；Runtime 再核对源资产和目标产品对象范围，重复关联返回 409。`GET /assets/api/v1/ip-assets/:id/products` 分别核对 `ip_assets:view` 与 `products:view` 的当前用户对象范围，以 `assets:ip-asset:read` 服务能力读取同一 Registry 快照，只返回两份范围交集内的产品 `id/code/name/status`；源 IP 不可见为 404，目标产品不可见则从结果中过滤。缺任一人员权限为 403。独立 IP 详情读取不因此新增未授权的关联计数或明细。

`POST /assets/api/v1/ip-assets` 与 `PATCH /assets/api/v1/ip-assets/:id` 要求 `Idempotency-Key`、人员 `ip_assets:edit` 与各自 `assets:ip-asset:create/edit`。BFF 仅接受白名单业务字段，会话重建 actor/tenant/Host permit；Runtime 再校验对象范围、Registry generation、owning receipt 和审计事务。编辑拒绝 ip_code；省略 nullable 字段保留，显式 null 清空，必填字段及非法日期/字典值拒绝。IP 文档关联仍未迁入 Host。

## 工作项完成审批（整合分支候选）

`POST /aims/api/v1/work-items/:id/completion` 与 `completion-replay` 必须携带幂等键；完成申请 input 为 expectedVersion，人工 replay input 为 expectedOperationVersion 和 reason，二者都携带 projectId。完成申请冻结工作项及子项快照后，通过 Aims owning outbox 请求 Workflow；回调按审批证据更新状态，撤回和人工 replay 保持原 command 身份。人工 replay 单独要求 `integration_operations:replay` 及实际项目管理关系，不以普通编辑权限替代。具体字段、固定 action/回调路径、身份和 grants 见根 MODULE_CONTRACTS 的 work-item completion 合同。Workflow BFF 必须在查询目录或重签 actor 前校验入站 command hash 与 HMAC。scheduled 路由已接入真实 Gateway Binding，缺少绑定/明确 origin/目标部署时拒绝发送；候选 schema/grants、任务启用和完整环境联调尚未完成。

Matter 工作项经 `POST /aims/api/v1/work-items/:id/matter-completion` 提交同形状的 `projectId`、`expectedVersion` 与幂等键；与 target 共用 `aims:work-item-complete:execute`，Runtime 额外验证事项负责人、工时和成果证据。审批页只呈现 Workflow 冻结的事项类型、证据计数和 SHA-256，不读取实时 Aims 对象；旧 target v1 入口与命令不变。本机浏览器端到端验收尚待执行。

`POST /aims/api/v1/work-items/:id/{start|reset|reopen}` 与 `DELETE /aims/api/v1/work-items/:id` 均要求幂等键，input 仅接受 expectedVersion，并携带 projectId；请求不接受人员 permit。状态流转限定 todo→in_progress、in_progress→todo、completed→in_progress 三条边，按项目 workflow_transitions 校验，人员权限沿用 `work_items:edit`，服务 capability 分别为 `aims:work-item-{start|reset|reopen}:execute`。删除是敏感动作：人员权限要求独立的 `work_items:delete`，服务 capability 为 `aims:work-item-delete:execute`，编辑权限不构成删除授权；Runtime 在同一事务冻结工作项与子项删除证据、写 `work_item_deletion_evidence` 和项目活动日志。两类动作都按项目数据范围（projectScope）执行。Host 工作项详情页当前只提供状态流转按钮，删除入口尚未接入界面。

## 工作项任务分配确认与撤回（整合分支候选，2026-09-15）

`POST /aims/api/v1/work-items/:id/confirm-distribute` 与 `POST /aims/api/v1/work-items/:id/revoke-distribute` 均要求 `Idempotency-Key`、拒绝 query，input 仅接受 `expectedVersion`（目标工作项内容版本）并携带 `projectId`，不接受人员 permit。人员权限：确认为显式授予的 `work_items:confirm`，撤回为 `work_items:edit`；服务 capability 分别为 `aims:work-item-distribute-confirm:execute`、`aims:work-item-distribute-revoke:execute`，Runtime 路由 `POST /v1/enterprise/aims/work-items:confirm-distribute|revoke-distribute`。

Runtime 在同一 Registry 写事务内锁定项目（须 active）、目标及全部子任务：仅 `target` 层可操作；确认不接受需求类目标，且要求全部子任务为 `planning`，逐个置为 `todo`；撤回沿用原项目经理规则：项目负责人、活跃的经理角色项目成员或受信项目管理范围内的管理员，且全部子任务为 `todo`，逐个退回 `planning`。目标自身状态不变；复用评审锁与里程碑完成锁校验。每个子任务写 `work_item_changelog`，目标写 `project_activity_logs`，receipt 同事务提交，同键重放返回冻结结果、异载荷拒绝；审计失败整体回滚。receipt 命令 schema 版本为 `distribution-confirm.v1` / `distribution-revoke.v1`（受 `command_schema_version VARCHAR(30)` 约束）。

`POST /aims/api/v1/work-items/:id/confirm-append` 与 `reject-append` 沿用同一合同（`expectedVersion` + `projectId` + 幂等键），人员权限均为显式 `work_items:confirm`，服务 capability 分别为 `aims:work-item-append-confirm:execute`、`aims:work-item-append-reject:execute`，receipt schema 版本 `append-confirm.v1` / `append-reject.v1`。二者只作用于目标执行中追加的 `planning` 子任务，已在执行的子任务不受影响：确认把它们置为 `todo`（无待确认追加任务时 409 `no_planning_children`，需求类目标拒绝）；拒绝先解除其承接的目标成果（`matter_id` 置空，保留目标成果），再删除其自有成果与任务本身，无追加任务时成功返回 0 条。

`POST /aims/api/v1/work-items/:id/append-tasks` 要求幂等键，input 仅接受 `expectedVersion` 与 `subtasks`（1～50 个，沿用原追加任务字段：负责人、标题、描述、起止日期、预计工时及至少 1 条自有成果），并携带 `projectId`。人员权限为 `work_items:edit`，服务 capability 为 `aims:work-item-append-tasks:execute`，receipt schema 版本 `append-tasks.v1`。Runtime 在同一写事务内：沿用原项目经理规则（负责人、活跃经理角色成员或受信项目管理员）；仅接受执行中（in_progress/in_review/completed）的非需求类目标；沿用统一创建规则，要求负责人为项目负责人或活跃项目成员；先替换该目标下既有的规划态追加草稿（解除其承接的目标成果、删除自有成果与任务），再创建规划态任务及自有成果，写项目审计与 receipt。创建的任务仍须经 `confirm-append` 进入待办或经 `reject-append` 移除。

`PUT /aims/api/v1/work-items/:id/breakdown` 要求幂等键，input 仅接受 `expectedVersion` 与 `subtasks`（0～50 个；空列表清除全部规划态子任务），并携带 `projectId`。人员权限为 `work_items:edit`，服务 capability 为 `aims:work-item-breakdown:execute`，receipt schema 版本 `breakdown-save.v1`。Runtime 在同一写事务内沿用原分解规则：项目经理规则；目标须已配置成果要求；任一子任务离开 `planning` 即 409 `distribution_locked`；有任务时每条目标成果须恰好被一个任务承接（`targets_uncovered` / `targets_duplicated`）；单任务及合计计划工时不得超过目标控制工时。统一路径新增：任务 `id` 必须是该目标现有的规划态子任务（否则 409 `work_item_breakdown_child_mismatch`），负责人须为项目负责人或活跃项目成员。未保留的子任务先解除并重置其承接的目标成果、删除自有成果后移除；保留或新建的任务按载荷重建承接与自有成果，写项目审计与 receipt。

`GET /aims/api/v1/work-items/:id/breakdown-context` 不接受查询参数，人员权限为 `work_items:view`（项目范围 permit），服务 capability 为 `aims:work-items:view`，Runtime operation `work-items:breakdown-context` 复用原只读上下文（目标、成果要求、子任务及其成果、相关文档）并附加 `editVersion`；Host 另附当前主体的 `permissions.edit` / `permissions.confirm`，仅用于入口展示，服务端写入仍逐项重鉴权。

Host 页面 `/aims/work-items/:id/breakdown`（`enterprise-work-item-breakdown`）承载保存分解、确认/撤回分配、追加任务及其确认/拒绝；原独立页面的前端审批面板改为按上述权限直接调用对应写动作，服务端边界不变。需求分解提交仍由独立 Aims 提供；候选代码与 capability 未在任何环境启用。

## GET /aims/api/v1/codocs/documents/:uuid/content（2026-09-17）

项目文档正文读取。Codocs 在 ADR-018 §2 范围表中保留独立运行边界，因此这是真实的跨应用调用，不是宿主内查询。

Host 先要求登录用户，再在本域用 `assertCodocsProjectDocumentAccess(projectId, uuid, uid)` 判定该项目文档的访问权限并取得 `projectCode`，然后复用 Aims 共享 helper `getCodocsProjectDocumentContent({ sourceApp: 'enterprise' })` 调 Codocs Service API。查询参数 `projectId` 必填（正整数），`uuid` 必须是规范 UUID；`preview=1` 时权限或正文读取失败降级为 `contentUnavailable`，与独立应用一致，非预览模式照常抛错。

身份是宿主自己的 `enterprise` / `enterprise.runtime`，不借 `aims.runtime`；Codocs 侧有与 Aims 并列的授权条目，精确 capability `codocs:project-document:content:read`。`enterprise/server/utils/enterpriseCodocsProjectDocument.ts` 的 `requiredCapability` / `audience` 是 readiness 策略推导该能力的唯一事实源。

完整信任边界、回归矩阵与验收状态见根 `docs/MODULE_CONTRACTS.md`「ADR-018 Enterprise → Codocs 项目文档正文」。C000001 已完成 grant 与令牌签发探测，Worker 部署与浏览器验收未完成。
## POST /codocs/api/documents/:uuid/collaboration（阶段 B 候选）

Host 仅在 snapshot v2 与 collaboration v2 双开关开启时受理无 query/body 的会话打开请求。先核验当前用户 Codocs `documents:edit`，再以 `enterprise.runtime` 身份调用固定 Runtime 操作 `codocs.personal-document-collaboration-open`，携带当前 actor、tenant/deployment 和 `personal-documents:edit` permit。Runtime 重验文档 ACL、v2 代际并签发 60 秒一次性准入票据；Host 返回 `v2.<ticket>`、sessionId、expiresAt，`Cache-Control: no-store`。协作重连必须重新请求票据。代码默认关闭，尚未完成环境授权、WebSocket 路由及真实协作验收。

## 部门文档协作（Host 批次 H1a，代码候选，默认关闭）

设计与批准见 `docs/Codocs-Host-Department-Collaboration-Design.md`。三个开关同时为 `true` 才受理：`HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`、`HZY_ENTERPRISE_CODOCS_COLLABORATION_V2` 与 `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2`（页面同名 public 配置 `codocsDepartmentCollaborationV2`）；否则 404 `department_collaboration_disabled`，不调用 Runtime。三条路由均只接受唯一 query `dept_code`（身份、角色、文档类型、owner 一律不接受），`Cache-Control: no-store`。

- `GET /codocs/api/departments/documents/:uuid?dept_code=`：部门文档详情，人员权限 `departments:view`，Runtime `codocs.department-documents-view`。返回白名单字段（不含 `oss_path`）、`content`、`snapshot_generation/epoch`。已转换（generation>0）的文档正文来自 `snapshot-read` 给出的精确对象版本，校验长度与 SHA-256，**不读 `oss_path` 镜像，读取不修复镜像**。协作开关开启时附 `department_collaboration.can_edit`（仅 UI 提示：Directory 可写关系，且为经理、所有者或写分享成员，文档在用且未只读；Runtime 每次开会话仍独立判定）。
- `POST /codocs/api/departments/documents/:uuid/collaboration?dept_code=`：领取写票据，无请求体；人员权限 `departments:edit`（缺失 403，Console 依赖故障 503），Runtime `codocs.department-documents-collaboration-open`（permit `department-documents` + `edit`）。请求只含 tenant/deployment/`code`=dept/`subId`=文档 UUID/permit，不含关系事实。Runtime 的 403（`department_writer_required`、`department_document_write_denied`）、409（`document_not_on_snapshot_v2`、`collaboration_writer_limit_reached`）、429 原样传递状态与稳定码。成功返回 `v2.<ticket>`、sessionId、expiresAt、generation；票据一次性，重试会作废旧票据（无 Idempotency-Key，见 MODULE_CONTRACTS 规则解读）。
- `POST /codocs/api/departments/documents/:uuid/collaboration/convert?dept_code=`：用户点击“协作编辑”时的 v1→v2 转换，`departments:edit`。仅 `doc_type=department`、`status=1`、无 `project_code`、未只读、`oss_path` 为 `.md` 且不含 `/weekly-reports/`、非 `recycle.bin/` 的文档（否则 409 `department_document_not_convertible`）。流程：`department-documents-view` → `snapshot-read`（generation>0 直接返回已转换）→ v1 房间活动检查（文档 `updated_at` 或 `.yjs` 旁路对象 120 秒内变化、或无法判定，均 409 `document_v1_collaboration_active`/503 失败关闭）→ 读取 v1 Markdown（≤10 MiB）→ `snapshot-prepare`（`generation=0`、`epoch` 取自 head）→ 请求级 OSS 条件写候选（`forbidOverwrite`）→ `snapshot-publish`。幂等键 `dept-convert:<sha256(tenant, deployment, uid, uuid, epoch, 0, 正文摘要)>`，同一用户意图重试同键，另一用户或正文变化即另一命令。并发转换恰一人成功，输家重读 head 后视为已转换。阅读从不触发转换。

正文消费者：`GET /codocs/api/departments/documents/:uuid/download`、部门复制的源正文、`open-department-docs/:uuid` 均经 `withEnterpriseCodocsDocumentContent`：响应若带 `body_ref`/`snapshot_ref`（`{generation,epoch,markdown:{key,version},size,sha256}` 或 `snapshot-read` 形状，`legacy:true` 表示未转换）则用之，作为单一授权点；否则部门文档在协作开关开启时按调用人权限调用 `snapshot-read`。开放部门文档的读者不属于该部门：Runtime 标注 `snapshot_generation=0` 时读原路径，>0 或未标注而无引用时**失败关闭**（503 `enterprise_document_body_ref_required`，不回落镜像）。公司快速发布按 Runtime 计划项处理：带 `bodyRef`（此时 `sourcePath` 为空）的已转换项按精确版本读出、校验长度与 SHA-256，暂存到内容寻址键 `codocs/copy-staging/quick-publish/<sha256>.md` 后拷贝；只有 `sourcePath` 的 v1 项照旧；两者皆无则 503。Runtime 的企业 `open-department-documents:view` 现由服务端追加 `include_snapshot_ref=1`（批次 H1c），v2 文档随元数据带 `snapshot_generation` 与精确 `snapshot_ref`；`list` 不带引用。

- `GET /codocs/api/departments/documents/:uuid/versions?dept_code=` 与 `GET …/versions/:versionId?dept_code=`（批次 H1c，只读版本历史）：随三开关注册，人员权限 `departments:view`，Runtime `codocs.department-documents-versions` / `codocs.department-documents-version-view`（permit `department-documents` + `read`，`subId` 为文档、`objectId` 为版本）。仅接受 `dept_code`，版本 ID 为正整数，`Cache-Control: no-store`。列表返回净化行（`id/versionNum/ossVersionId/editorUid/contentSize/contentSha256/createdAt/objectKey`）；查看读取行内 `object_key`（限 `codocs/snapshots/`）或 v1 行 `oss_path` 的指定对象版本，校验长度与 SHA-256，`404` 版本对象不存在，`410` 已过期的被覆盖 v1 版本，`503` 存储不可用或摘要不符。无删除、回滚、差异。
- 回收站恢复（`POST /codocs/api/departments/documents/:uuid/restore` 与个人文档恢复）：Runtime 计划带 `snapshot_backed: true` 时 Host 不检查也不复制镜像与 `.yjs`，直接以计划哈希提交，恢复只翻转状态；未带（v1）保持原有复制/校验流程。

## Enterprise 工作项完成审批面板（首批）

Host BFF 只登记 `aims/tasks/complete`，精确开放四个读取 `GET /api/workflow-proxy/instances/by-biz`、`by-biz-history`、`instances/:id`、`tasks/:id`，以及两个任务决策写入 `POST /api/workflow-proxy/tasks/:id/approve`、`tasks/:id/reject`。发起走已登记的 `POST /aims/api/v1/work-items/:id/completion` owning 命令，经 Aims receipt/outbox 投递 Workflow 专用完成审批端点；Host 不开放通用 prepare/create。先验证当前用户和 Aims 工作项对象范围；任务决策由 Workflow 判断归属、资格及职责冲突，不额外要求 Aims 编辑权。工作项状态仅由服务端完成回调更新，Host 不客户端 PUT 状态。实例读取失败不得转成“无实例”；其余 Workflow 路径和动作拒绝。当前共用 `workflow:proxy` capability，后续收敛为实例读取和任务决策等细粒度能力。

## Host 共享用户 API 基址（G-12）

网关把根 `/api/*` 交给 Console，因此 pilot Host 在 `/enterprise/api/foundation` 下再登记一份 Host 页面实际使用的 Foundation 用户 API，浏览器经 Foundation `sharedApiPath` 请求（public `sharedApiBase`）。根路径同名路由保留。

- Workflow：`GET …/workflow-proxy/instances/by-biz`、`by-biz-history`、`instances/:id`、`tasks/pending`、`tasks/:id`；`POST …/workflow-proxy/tasks/:id/approve|reject`。同上节 `enterpriseWorkflowProxy` 操作与 `02-workflow-boundary` 精确边界。
- 通知：`GET …/notifications`、`…/notifications/summary`、`…/notifications/:notificationId/detail`；`POST …/notifications/read-all`、`…/notifications/:notificationId/read|archive`。
- 应用目录：`GET …/user/applications`。
- 目录：`GET …/directory/me|users|departments|projects|business-domains`；`POST …/directory/users/batch`。

除 Workflow 外均为 Foundation 处理器原样复用，外层 `enterpriseSharedApi` 先要求已验证 Host 用户会话（`requireEnterpriseUser`），未登录 401 且不调用处理器；不新增 capability/grant/Runtime 操作。其他方法或路径由就绪边界返回 `enterprise_module_runtime_not_ready`。pilot 构建的 Nuxt Icon 端点为公开的 `GET /enterprise/_nuxt_icon/:collection`。

## Host matter 成果添加（本地候选）

`POST /aims/api/v1/work-items/:id/deliverables` 只接受名称、类型、说明、验收标准、必需标记。Host 从路径固定 `entityType=matter/entityId`，构造单条 `items`，调用既有 `aims.project-deliverable-batch-create` → Runtime `/v1/enterprise/aims/project-deliverables:batch-create`；请求体中的对象 ID、批量数组与查询参数均拒绝。人员先经 Console `projects:edit` 门槛，再由 Runtime 以签名 actor 复核项目 manager/scoped admin；服务 capability 保持 `aims:project-deliverables:edit`，未增 grant/manifest。页面仅在 matter `in_progress` 且可管理时显示入口。Runtime 对 matter 成果的新增、工作项证据更新、项目交付物直改/删除按项目→事项锁顺序要求 `in_progress`，其他状态 409；target 与非 matter 规则不变。成功后刷新执行上下文与就绪提示，冲突时保留表单。负责人无项目经理权限时不能自建成果，另列后续。

## Console 通知与待办用户入口（2026-09-26）

页面：`/enterprise/notifications`、`/enterprise/notifications/:notificationId`、`/enterprise/todos`。复用 Foundation NotificationCenter/TodoList；Console 原入口继续保留，无页面重定向。通知 list/summary/detail/read/read-all/archive 均沿用 Foundation 通知用户代理处理器（pilot 经 `/enterprise/api/foundation/notifications/**`，见 G-12 节），不新增服务能力或 Runtime 业务操作。

`GET /enterprise/api/notifications/todos`：要求 Foundation 已验证 Console user 凭据；不接受 service token 或未验证 Header/cookie 作为用户身份。仅允许以下 query，额外字段、重复字段和非法值 400：

| 参数 | 约束 |
| --- | --- |
| todoKind | 可选；approval / due / risk / follow_up |
| cursor | 可选；单个字符串，最多 512 字符，沿用 Console 不透明游标 |
| limit | 可选；十进制整数 1–50，默认 20 |

经既有 `fetchConsoleNotificationsForUser` 与 Console binding 调 `GET /api/v1/console/notifications/todos`，返回 `{ code: 0, message: 'success', data: { items, nextCursor } }`；`private, no-store`；上游 401/403/503 不改写为 502。详情继续由 Console fresh source verifier / Aims finalize / lifecycle / enterprise snapshot 合同判断；标已读、全部已读、归档的 Idempotency-Key 不变。接口就绪不代表真实环境验收。

### Console 企业资料只读页面

`/enterprise/org-profile` 使用共享 `OrgProfileDetails`。GET `/enterprise/api/org-profile` 不接受 query，private/no-store，调用 Foundation `fetchConsoleUserApi(event, 'org-profile.read')` → GET Console `/api/v1/console/profile`；保留用户权限及 401/403/503，不登记写操作。编辑入口在 `/console/org-profile`。

### B1 目录用户读取

`/enterprise/directory/users` 共用 Foundation `DirectoryUsersTable`，列表真实分页、详情单独 GET。GET `/enterprise/api/directory/users` → registry `directory.users.list`，仅 page（1–1000000）、pageSize（1–100）、search（最多100 UTF-8字节）、deptCode（安全单段）、status（active/inactive/pending/deleted/all）；GET `/enterprise/api/directory/users/:uid` → `directory.users.read`，不接受 query，uid 为1–128字符安全单段。均 private/no-store，Console `directory_users:view` 为授权事实源，401/403/503 原样传递。管理链接 `/console/directory/users`；无写/凭据/建号 API。

### B1 目录部门读取

`/enterprise/directory/departments` 共用 Foundation 组织树表格与树筛选函数。GET `/enterprise/api/directory/departments` → `directory.departments.list`；GET `/enterprise/api/directory/departments/:deptCode` → `directory.departments.read`，两者均拒绝 query，详情仅安全单段编码。保留 Console `directory_departments:view` 与401/403/503；客户端过滤完整组织树，不伪装服务端分页。管理链接回 `/console/directory/departments`，未登记写/成员读取路径。


### B1 项目只读迁移

GET `/enterprise/api/directory/projects`（page/pageSize/search/deptCode/leaderUid/status）、GET `/enterprise/api/directory/projects/:projectCode`（无 query）、GET `/enterprise/api/directory/projects/members`（必填 projectCode，page/pageSize/search/status）。校验编码与分页，private,no-store；沿用 Console `directory_projects:view`，保留401/403/503。


### B1 委员会只读迁移

GET `/enterprise/api/directory/committees`（page/pageSize/search/status）、GET `/enterprise/api/directory/committees/:committeeCode/members`（page/pageSize/search/role）。沿用 Console `directory_departments:view`，private,no-store，保留401/403/503。Console 无委员会单条 GET；Host 资料来自列表，未添加单条路由。


### 本人资料只读页

`/enterprise/profile` 使用既有 Foundation GET `/api/directory/me`（当前已验证用户，响应含 uid/姓名/邮箱/部门/岗位及手机尾号）。无新增 Enterprise BFF/Console 路由，不接受他人 uid 查询。


### Host 导航贡献

GET `/enterprise/api/navigation` 新增 manifest 派生的 Console 发现项。authenticated-self 仅在 requireEnterpriseUser、当前策略 gate 和受信 Runtime 可用后由服务端启用；permission 项仍读取 targetAppCode=console 的快照。原 private,no-store / visibleIds+maxAgeMs 及故障语义保持。


### 工作日历只读迁移

`/enterprise/work-calendar`只读；GET `/enterprise/api/work-calendars`、`/:calendarCode/months?year`、`/:calendarCode/days?yearMonth`。日历编码按Runtime正则，年份2000–2100，月份01–12；禁止其它query。Console最终检查system_settings:view；保留401/403/503，private,no-store。

### Console 目录同步只读投影
- `GET /enterprise/api/directory/sync-jobs?limit=30`：任务列表；无分页参数沿原数组/limit（1..100，默认20）合同。Host 请求 page/pageSize=20。
- `GET /enterprise/api/directory/sync-jobs/:jobCode`：任务详情，不允许查询参数。
- `GET /enterprise/api/directory/sync-jobs/:jobCode/events?limit=100`：事件列表；无分页参数沿原数组/limit（默认100）合同。Host 独立事件页 page/pageSize=20。
- jobCode 是 1..128 位 `[A-Za-z0-9_.-]` 安全段，排除 `.`/`..`；未知/重复查询拒绝。`private, no-store`；Console 每次检查 `directory_sync:view`，使用宿主验证过的用户凭证。
- BFF 按白名单重建响应，仅状态、计数、时间、对象代码/类型与固定 `failureCategory`；不透传 `errorMessage`、事件 `message`、cursor、requestedBy、externalRef、beforeHash、afterHash 或未知字段。异常响应保留 401/403/404/503，其他为 502，使用固定错误文本。
- Runtime 已知 Platform/Connector 错误前缀映射固定“Platform同步失败”/“连接器同步失败”，未知错误统一“同步失败”，成功状态无失败类别。完整详情、同步触发和重试保留 Console。

### B2 部门写入

- `POST /enterprise/api/directory/departments`、`PATCH /enterprise/api/directory/departments/:deptCode`、`DELETE /enterprise/api/directory/departments/:deptCode`：精确转发对应 Console 用户 API，`directory_departments:edit` 由 Console 判定，private/no-store。
- 浏览器 Idempotency-Key 必须匹配 `[A-Za-z0-9:_-]{8,128}`；缺失/非法 400，服务端不生成。未知查询/字段、非 JSON 对象、身份/版本覆盖字段拒绝；body 最大 16 KiB，编码 1..128 安全段，禁止 . / ..，删除不接受业务字段。
- Host 创建字段：deptCode/name/parentDeptCode/managerId/leaderId/orgType/deptCategory/description/sortOrder；PATCH 同组可变字段但不含 deptCode，只提交变化字段；无变化不发送。status/expectedRevision/actor 不属于 Host 请求体。
- 既有列表 GET 附加 `canEdit`：在受信用户及策略 gate 后从 Console 快照按 directory_departments:edit 计算，权限/依赖失败时关闭写入口；不接受客户端权限参数，不新增权限接口。
- 已知限制：MVP 无 CAS，与 Console 一致，同字段后写覆盖。稳定幂等键重试原请求；成功 mutation 后刷新失败只重试读取。Runtime 事务/审计/回执沿用现有实现。

### B2 项目写入

- 精确 `POST /enterprise/api/directory/projects`、`PATCH /enterprise/api/directory/projects/:projectCode`、`DELETE /enterprise/api/directory/projects/:projectCode`、`POST /enterprise/api/directory/projects/members`；对应 registry `directory.projects.create/update/delete/members.replace`，全部 write:true，private/no-store。Console 每次判定 `directory_projects:edit`。
- 浏览器 Idempotency-Key 必填，沿用 `[A-Za-z0-9:_-]{8,128}`；无查询参数，JSON object 最大 32 KiB。创建只允许 projectCode/name/parentProjectCode/projectType/deptCode/ownerUid/leaderUid/repoUrl/description/status，PATCH 不含 projectCode，仅差量；省略保持、null 清空。status 只允许 active/inactive/archived，删除必须独立确认；不接受成员字段、actor、租户或虚构版本字段。
- 编码/UID 1..128 安全段，不允许 . / ..；项目代码 `members` 是静态成员路由保留段，PATCH/DELETE 不把该路径当项目单条。name 非空最多255，repoUrl最多2048、description最多4000；projectType 为 project/group/template。
- 成员 POST 只允许 `{projectCode,members:[{uid,role}]}`，0..100 人、UID 不重复、role 为 owner/admin/member/viewer；这是全量替换，不是追加。共享编辑器独立 GET page=1/pageSize=100/status=active，完整 total 与 items 一致才允许保存，不用搜索或当前分页结果替换；加载失败/超限禁止保存。warning 确认含项目名及“将以当前列表替换全部成员”，空列表也确认。
- 已有项目列表 GET 附加 gated Console 快照投影 canEdit，失败/缺 edit 不展示写控件；不增加权限端点。401/403 后关闭写入口并刷新快照，Console 原路径共用同一编辑器。
- MVP 无 CAS，同字段及全量成员后写覆盖；PATCH 差量只降低无关覆盖。结果未知保留原 METHOD/path/body/key 重试；写成功关闭抽屉，独立列表 GET 失败提示“已保存，刷新失败”，不再次写入。

### B2 委员会写入

- 精确 `POST /enterprise/api/directory/committees`、`PATCH/DELETE /enterprise/api/directory/committees/:committeeCode`、`POST /enterprise/api/directory/committees/:committeeCode/members`、`PATCH/DELETE /enterprise/api/directory/committees/:committeeCode/members/:uid`，六项 registry 均 write:true，private/no-store。Console 每请求检查 **directory_departments:edit**，不引入 directory_committees 权限。
- 浏览器 Idempotency-Key 必须匹配 `[A-Za-z0-9:_-]{8,128}`，缺失/非法400；禁止 query/身份/租户/虚构版本字段，JSON object 最大32KiB。编码/UID 为1..128安全段，排除 . / ..。
- 创建字段 committeeCode/name/parentDeptCode/description/sortOrder/status，PATCH 不含 committeeCode，仅提交变化字段；省略保持、null清空。name非空最多255，description最多4000，sortOrder为0..2147483647整数，status仅active/inactive。主任/秘书只能通过成员动作维护，删除没有业务 body，danger 确认含对象名、先移除成员和不可恢复后果。
- 成员 POST `{members:[{uid,role}]}` 为增量upsert，1..100、不重复UID、role为leader/manager/member/observer，单次最多一主任与一秘书；PATCH单成员只接受 `{role}`，仍沿用既有upsert语义；DELETE移除需要warning确认用户及委员会名称。主任/秘书变更与用户关系由既有 Runtime 事务处理，不在客户端推算。
- 列表 GET 附加 gated Console directory_departments:edit 快照 canEdit；共享 DirectoryCommitteeEditor 保留分页/搜索/角色筛选和资料。失败保留添加候选/原角色/原成员；角色控件复位；成功重新读成员和列表，空末页回退。读取失败关闭成员写控件。401/403关闭写入口并重新加载权限，Backend仍交Console判权。
- 同意图稳定键、未知结果锁定与原请求重试；成功后刷新失败提示“已保存，刷新失败”，只重试 GET。MVP 无 CAS，同字段/同成员角色及主任秘书指针仍允许后写覆盖。无新增页面/导航路径或同步动作。

## Console C1 当前公司配置只读

- GET `/enterprise/api/organization/business-domains`、`/enterprise/api/organization/regions`：无query；公司由已验证用户的Console profile解析，返回仅company标识/名称与domains或regions白名单。
- GET `/enterprise/api/organization/regions/:regionCode/divisions`：无query；先检查当前公司区域集合，再返回items中的divisionCode/divisionName/includeChildren。
- Console `org_profile:view` 为最终权限；401/403/404/503保留状态，其他依赖失败502且固定文本。均private/no-store。
- 没有companyCode入站参数、写接口或任意响应透传；管理入口回Console。三条METHOD/路径同时在API readiness、Foundation registry与Gateway topology登记并测试。

### 组合路由的请求类型

随着C1增加3条Host API，默认NitroFetchRequest路由联合触发TS2589/TS2345。Enterprise shared/types/nitro-fetch.d.ts复用仓库已有Nitro 2.13.4 opt-in补丁（Aims既有方案），仅移除通用请求地址的完整route-key autocomplete；具体URL仍推导响应并检查METHOD，显式泛型/动态路径/Request/raw/create/event.$fetch不变。不改依赖、运行时代码或权限门禁。类型测试覆盖600条追加路由、非法方法/字段拒绝及未启用项目默认契约。逐页面尝试的第二泛型参数改动已撤回。

## Console C2 安全运行状态摘要

GET `/enterprise/api/runtime-status/data` 与 `/enterprise/api/runtime-status/applications` 均无query，响应data仅version、status（healthy/degraded/unavailable/unknown）、healthy、available、lastSeenAt、checkedAt、failureCategory（runtime-unavailable/runtime-unhealthy/applications-unavailable/applications-degraded或null）。version仅合法版本字符串、日期仅合法ISO时间，不透传raw error。应用摘要为已启用应用聚合：无appCode/appName/逐项信息，version/lastSeenAt为null。依赖失败固定文本，保持401/403/404/503，其他502；private/no-store。Console继续是权限权威，更新、配置、启停回Console。

### PA-03 项目基本信息与成员写（候选）

`PUT /aims/api/v1/projects/:id` 与原成员写路径保持方法/输入/精确capability不变；人员许可为Foundation对当前项目求值的静态projects:edit，或Runtime事务内的当前leader/active manager。服务端签名authorization新增`mode=static-or-project-manager`，`allowed`仅代表静态分支；浏览器不得提交authorization/mode/关系事实。原无mode许可保持原经理门槛。项目详情新增`canEditProject`发现标志；项目设置与成员管理入口依此显示，每次写仍独立授权。Console授权依赖错误503、无两类许可403、幂等payload或版本冲突409。该候选不表示PA-01完整数据范围合同已上线。

## Altoc G1 六条基础只读 GET（候选，环境未启用）

| Host 路由 | 固定 Runtime 操作 | Altoc manifest 人员权限 |
| --- | --- | --- |
| GET `/altoc/api/v1/customers` | `altoc.customer-list` | customer:view |
| GET `/altoc/api/v1/customers/:customerId` | `altoc.customer-view` | customer:view |
| GET `/altoc/api/v1/contracts` | `altoc.contract-list` | contract:view |
| GET `/altoc/api/v1/contracts/:contractId` | `altoc.contract-view` | contract:view |
| GET `/altoc/api/v1/payments` | `altoc.receivable-list` | receivable:view |
| GET `/altoc/api/v1/payments/:planId` | `altoc.receivable-view` | receivable:view |

当前 Console 普通快照执行资源 view gate；同次 scoped authorization 保留有效授权来源与策略version/hash/revision/expiry，复用 Altoc 原纯 scope 编译器及原 global-admin 兼容语义。部门self/tree事实由当前 Console Directory 读取，不采纳浏览器 actor/dept/scope。permit 绑定可信身份、资源/操作、对象及完整规范化query，并复用项目文档的独立token-bound HMAC传输机制覆盖全部字段；有效期取 scoped 源期限与14秒上界之小者，Runtime允许15秒上界。

列表 query：page=1..1000000、pageSize=1..100（默认20）、search≤200 UTF-8字节、status≤40字节；合同可加customerId，回款可加customerId/contractId。ID为规范正整数且必须为JS安全整数。拒绝数组、未知字段、Finance metric、授权/身份参数；详情不接受API query。成功 `{code:0,data}` 由共享字段白名单重建，列表COUNT/page/pageSize必须为有效分页元数据；详情对象ID必须匹配请求。合同仅基础主档/lines/payment_terms/obligations/billing_schedules；不返回客户或关联合同动态名、Finance、扫描/文档URL、审计、任务诊断或原始错误。

`Cache-Control: private, no-store`；400输入无效、401未登录、403无人员/服务查看权限、404不存在或对象范围不可访问、503依赖/授权事实不完整。错误固定中文文本。六个原生页共用AltocBasicReadPage，清空身份/策略变更前的数据，取消旧请求并拒绝迟到回复；列表保留筛选/分页返回位置。写操作仅配置的独立Altoc应用管理入口，无同源Host路径冒充旧写流程。

Gateway只登记六条精确GET与六个页面，未知相邻路径/错方法不被迁移到Host。Manifest导航贡献至销售既有customer/contract/settlement分组，Altoc不是composition.modules成员。Console v2.24 seed/verify仅交付文件，目标三条data-runtime audience grant由协调者安排授权操作；SQL行存在不代表真实签发/Runtime/登录验收已完成。

## Altoc G2 基础只读（代码候选）

新增精确 GET `/altoc/api/v1/leads`、`/leads/:leadId`、`/opportunities`、`/opportunities/:opportunityId`、`/quotes`、`/quotes/:quotationId`（均沿 `/altoc/api/v1`）。对应 `altoc.lead-list/view`、`altoc.opportunity-list/view`、`altoc.quotation-list/view` 固定操作；scope 为 `altoc:lead:view`、`altoc:opportunity:view`、`altoc:quotation:view`，人员权限由当前 Console Altoc manifest resource:view 判定。

列表 page/pageSize/search/status；商机和报价可 customerId，报价另可 opportunityId；详情不接受筛选 query。输入严格上限/规范ID，返回白名单与 private,no-store，固定400/401/403/404/503。当前 owner/dept scope 与最早授权到期许可沿 G1；G2 独立 HMAC 完整覆盖 opportunityId，G1 contractId 合同不变。报价只读 items 强制 quotation_id 与详情ID一致且≤1000，不输出成本/毛利、联系人/活动/动态关联名称、文件或诊断。没有新建/变更/审批/转换/转合同命令。

六个原生页 `/altoc/leads|opportunities|quotes` list/detail，独立管理入口配置限制沿 G1。导航贡献至 sales.opportunity / sales.quote，不增加 composition.modules。三 grant 文件 v2.25 仅交付，由指定操作员合入后执行；代码与隔离测试不代表已安装或登录验收完成。

## Codocs 回收站可选分页（P1）

GET `/codocs/api/documents/trash` 在显式 page/pageSize 时返回 `{success:true,data:{items,total,page,pageSize}}`；page 为 1..1000000，pageSize 为 1..100（仅传一个时默认 1/20），拒绝空、重复、非规范整数。无分页参数维持原调用形状与查询语义。固定 `codocs.documents-trash` 读操作沿原人员权限和服务许可，只扩展精确 query 白名单，没有新路径或 grant。COUNT 与当前页在同一只读 repeatable-read 事务内，使用相同 trash/可见性/筛选条件；稳定按 deleted_at/id 降序，越界返回空 items 与真实 total。Host 回收站以 UPagination 展示共 N 条，恢复后刷新当前页、页数缩小时回到末页；身份/策略切换取消旧列表请求并拒绝迟到结果。

### Console 同步分页（P2）
两条集合 GET 可选 page/pageSize（1..1000000 / 1..100，只传一项默认1/20），显式分页返回 `{code:0,data:{items,total,page,pageSize}}`；拒绝 limit 与 page 模式混用、重复/空/非规范参数。详情 GET 不变。Runtime COUNT 与页在同一只读 repeatable-read 快照，任务按 created_at/job_code，事件按 created_at/id 降序；事件 COUNT 与页同 job_code WHERE，任务对象 totalCount 等仍为原权威全量值。Host 白名单重建 envelope 与 rows；不输出诊断原文或未来字段。列表页和事件页分别保存 URL 分页，详情带安全 returnTo 返回列表页；身份/策略变更取消旧请求并清空数据。沿原精确路由与 `directory_sync:view`，没有新 capability、grant 或拓扑路径。

### Codocs 协同文档分页（P3）
GET `/codocs/api/collab-docs` 可选 page/pageSize（1..1000000 / 1..100，只传一项默认1/20）；Host 查询另接受 `sharedTab=received|sent`（仅 category=shared）。无分页参数维持原 items/total 合同。显式分页返回 items/total/page/pageSize 与完整匹配范围的 ownerUids/deptCodes 筛选候选；BFF 严格验证参数及响应页元数据。沿既有两条固定读操作与 read/review-admin capability/当前 Console gate，没有新路径或 grant。

owning reader 在同一只读 repeatable-read 快照读取当前 actor 的 active 关系、有效文档及受信 review-admin 发文事实；先按文档合并全部关系，再计算 scope 和共享页签，随后计数和取页，按 updatedAt/uuid 稳定降序。重复关系不增加 total，隐藏/删除/撤销关系不进入匹配集合；筛选候选不取自当前页。这里保留完整事实投影再分页，以复用既有依赖关系图的 scope 判断；尚未将完整关系图读取改成 SQL 聚合/窗口 LIMIT，数据库与内存工作量仍随匹配事实规模增长。Host 接 UPagination 共 N 条、筛选变化回第一页、URL 保存筛选/页码，身份/策略与预览迟到隔离。类别按钮目前不显示分类总数，不新增未使用 categoryCounts。

### 通知历史页码模式（P4a）
Foundation/Console 既有 GET `/api/notifications` / `/api/v1/console/notifications` 接受可选 page/pageSize（1..1000000 / 1..100，仅一项时默认1/20）。显式页返回 `{code:0,message:'success',data:{items,total,page,pageSize}}`，page 与 cursor/limit 混用400；不带 page/pageSize 时保留原 items/nextCursor、cursor/limit 语义。BFF 严校重复/空/非规范/未知参数，保留 status/category/sourceAppCode（及原 source_app_code 别名），设置 private,no-store。

COUNT 与当前页在同一只读 repeatable-read 事务，用同一数据库 UTC cutoff 检查有效期，当前已验证 uid、状态/分类/来源条件一致；按 COALESCE(pinned_at,created_at)/recipient id 降序。通知历史仍仅显示静态标签、来源、时间和收件状态，没有 title/body/actionUrl；业务详情继续实时鉴权，成功后才自动已读。summary 的全量合同及查询不改。

Host NotificationCenter 显式启用 serverPagination，独立 pageItems/total/loading/error 与取消/身份策略 generation，铃铛与旧 cursor 调用维持原状态；useListPage 保存 URL 页码/status，详情和返回链接保留 query，归档/批量已读后重载页并修复缩减末页。撤权/身份切换清详情，迟到详情不写内容或触发已读；fresh detail 仍走原接口。没有新 METHOD+路径、capability、grant 或 topology。

### 2026-09-28 Host 浏览器验收回归修复
- GET `/aims/api/v1/projects/:id/work-items` 分页仍可选：只校验调用方实际给出的 `page` / `pageSize` / `page_size`（此前把缺省分页合成为空键，里程碑页只带 `milestone_id` 时整表 400）。筛选键白名单、身份键拒绝与 Runtime 精确 QueryKeys 不变。
- GET `/codocs/api/worklogs/list`、`/codocs/api/personal-weekly-reports/list` 对 Runtime 个人文档索引按 pageSize=100 逐页读取（最多 10 页，超出返回 422，不静默截断）；此前单次 pageSize=200 被 Codocs 分页上限拒绝为 400。周报列表只接受 `year`，旧调用方回显的 `owner` 必须等于当前会话 uid，否则 403。
- Codocs 收藏/最近使用/工作汇报/我的文档/回收站在 Host 模式不再发送 `owner`、`last_editor` 或旧 `limit`；最近使用在 Host 为当前 actor 自有文档按更新时间倒序（Runtime 列表不接受 `last_editor`）。独立 Codocs 行为不变。
- POST `/aims/api/v1/projects` 在授权与 Runtime 调用前校验项目名称，规则与 Runtime 项目编辑命令一致（`aims/shared/projectName.ts`），不合规返回 400 `project_name_invalid`。编辑页只在名称被修改时发送并校验 `name`，存量不合规名称的项目仍可保存其他基本信息。
- 没有新 METHOD+路径、capability、grant 或 topology。

### 本人工时清单

`GET /aims/api/v1/users/:uid/time-entries` 只允许 `uid` 等于已验证会话本人（否则 403，且不签发 Runtime 许可）；人员权限为 `timesheet:view` 或 `timesheet:submit`（manifest 的 `aims:member`/`aims:dev` 只有 submit，填报页须读回本人记录）。submit 不蕴含项目工时、周报汇总或他人工时读取。Runtime 仍以签名 actor 覆盖 `current_user` 并拒绝 `uid != current_user`。

## Aims 周报设置（本地候选）

`GET /aims/api/v1/admin/weekly-reporting-settings` 与 `PUT` 同路径要求已验证 Enterprise 会话及 Aims `weekly_reports:configure`（403 时不调用 Runtime），响应 `private, no-store`；query 仅静默丢弃治理标志/actor，其余键 400。PUT 必须带 `Idempotency-Key`（8–64 位字母数字或连字符，同一保存意图重试沿用），正文只允许 `timezone`、`deadlineWeekday`、`deadlineTime`、`summaryTargetWeekday`、`summaryTargetTime`、`rolloutMode`（`disabled|pilot|company`）及可选 `reminderOffsets`（数组）/`ragConfig`（对象，各 ≤4 KiB）；未知字段 400。成功返回 Runtime `{ configured, settings }`。Runtime 映射见根 MODULE_CONTRACTS“Aims 项目责任与周报周期契约”。

## Aims 公司项目周报汇总发布（本地候选）

`POST /aims/api/v1/company-weekly-summaries/{periodKey}:publish|:retry|:cancel-publish` 沿用全局周报治理桥的授权：Aims `reports:edit` + `weekly_reports:review` + Console 当前唯一 `project_director` 持有人（非持有人 403、0/多人 409、依赖故障 503）。

- `:publish` 只读取正文 `correctionReason`（≤2000 字，其余字段含 `resolvedRecipients`、`coveredSelectionKeys`、`company_summary_recipient_resolution_verified` 一律丢弃）。宿主先以同一授权上下文读取 Runtime 当前汇总投影（未生成 409），按投影中的抄送选择经 Foundation `fetchConsoleDirectoryApi`（`enterprise.runtime` 既有 `console:directory-users:read`）展开人员/部门子树为 active UID 快照，随后才写入 `company_summary_recipient_resolution_verified=1` 调用 Runtime publish。抄送人离职/部门不存在或无人 409；目录依赖失败统一 503 `company_summary_recipient_directory_unavailable`，不透出内部诊断。成功返回 Runtime 结果并附 `delivery: { linked, synced: false, pending: true }`、`status: "publishing"`。
- `:retry` / `:cancel-publish` 不转发浏览器正文；retry 同样附 `delivery.pending`。
- Codocs 存档与项目经理职责工时确认由正式 Aims worker 在统一调度上异步完成（claim → `integration-operations:company-weekly-summary-publish-content` 读取不可变正文 → Codocs Service API → succeed），不在宿主请求内同步投递。Runtime 合同与 outbox 身份见根 MODULE_CONTRACTS“Enterprise Host 全局周报治理桥”。
