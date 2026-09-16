# PC18 产品采用与经营结果实施契约

状态：采用接口、经营成本读取、分摊规则读写、AIMS 页面及可靠投递链路已实现并完成受控测试；真实租户、服务授权及后台任务启用仍待验收。收入／毛利未就绪。本文不替代 PC12 真实部署验收。

## 已核对的事实源

Assets `customer_delivery_asset_environment_rel` 保存 deployed_version、deployment_status、relation_type、effective_from/to 和 status，关联正式交付资产与环境。交付资产主档的 product_version 是另一字段，不能覆盖关系上的实际部署版本。AIMS 发布记录不是部署完成证据。

Finance `project_cost_allocation` 按 project_code、period_month 保存 active/reversed 分摊，code 唯一，包含 source_table/source_id、rule_code、source_refs_json；旧结构没有逐条 currency_code；已新增可空字段和 20260909_project_cost_allocation_currency.sql 扩展迁移，历史不回填。写入校验与产品结果消费尚待接入。不能仅凭 amount 做跨项目产品成本合计，也不能将 reversed 条目算作有效成本。Finance 项目成本未就绪时毛利为 NULL，不能由金额非零推断已就绪。

## 首版采用指标与接口

跨应用读取复用 Foundation 签名命令路径：operation/schema 固定 aims.assets.product-adoption.read.v1，capability 为 assets:product-adoption:read；command 严格包含 actorUid、productCode、action=read、page、pageSize 五字段。actorUid 来自 AIMS 当前已验证用户，page 为 1–1000000、pageSize 为 1–200。读取不创建 receipt/outbox，也不缓存历史授权结果；目标仍需验签、绑定租户／部署并按原用户加载当前授权。Assets 已注册 POST /api/v1/service/product-adoption/read 专用验签入口，随后查询 Console 固定用途原用户授权并调用自身 Runtime；AIMS 调用与 adoption.vue 页面已接入；真实租户验收仍待完成。

拟在 Assets 增加精确 `assets:product-adoption:read` 服务能力，返回指定 productCode 当前已授权范围的部署摘要及分页明细。AIMS BFF 校验当前产品查看权限，Assets 同时检查原用户对交付资产／环境的对象权限；无权限行不得参与 total 或分组统计。跨应用仅使用服务 API，不读其他应用数据库。

采用查询的 Assets 范围分别从 deliveries:view 和 environments:view 当前授权生成，要求同一原用户，两种资源之间取 AND；各资源保留 grant 内维度 AND、grant 间 OR。交付资产 owner/self/assigned 对应其显式 responsible_uid，部门对应 responsible_dept_code；环境 owner/self/assigned 对应 owner_uid，部门对应 dept_code。项目范围分别匹配各自主档 project_code，不用关系来源项目绕开对象范围。两类对象没有资源资产 user/custodian 关系，相应受限分支不匹配，不能忽略该限制后退化为部门授权。环境 maintainer 不自动扩大为 owner 授权。当前 SQL 范围组合、可信原用户委托、Console 当前授权加载及读取接口已串联；真实租户链路仍待验收。

- 当前采用：未软删除的资产、环境及关系；关系 status=active 且 deployment_status 属于 deployed/online/accepted。planned/provisioning/suspended/removed 单独计数，不混入当前采用。
- 当前有效期按数据库查询时刻判断：effective_from 为空或不晚于当前时刻，effective_to 为空或晚于当前时刻，采用左闭右开区间；active 状态不覆盖有效期限制。环境现有 schema 无 deleted_at，正式关联通过 INNER JOIN 要求环境仍存在，不编造软删除字段。
- 部署实例以正式 delivery_asset_code + environment_code 去重。同一对存在多个 relation_type 时返回角色集合，不重复计算实例。版本不一致时标记冲突，不随意选择最新行或主环境版本。
- 产品实际采用数、环境数与客户数是三个独立指标，不可互相替代。production 与 test/backup 等环境角色分列，不把测试环境当作生产采用。
- deployed_version 空值为“版本未知”，保留计数；不能补为台账版本或 AIMS 最新发布版。与 AIMS 版本关联必须使用精确业务标识，未匹配保留原字符串，不模糊匹配。
- 首版仅展示当前快照及查询时间。effective_from/to 不足以证明完整历史版本变更，不据此生成历史采用曲线。后续历史趋势需独立部署事件或快照证据。

### 失败归类（2026-09-10）

产品采用的失败必须区分"这位用户缺 Assets 数据范围"和"服务授权或部署绑定不对"，两者对使用者的下一步动作完全不同。

Assets 三个 403 出口返回稳定 `data.reason`：

| 出口 | reason | 含义 |
| --- | --- | --- |
| `productAdoptionAuthorization.ts` 对象范围为空 | `assets_object_scope_denied` | 原用户缺 deliveries / environments 数据范围 |
| `productAdoptionServiceAuth.ts` 服务身份或部署绑定不符 | `product_adoption_service_identity_invalid` | 调用方身份、租户或部署配置问题 |
| `productAdoptionService.ts` 签名命令不合法 | `product_adoption_command_invalid` | 命令协议或哈希不匹配 |

AIMS 侧 `productAdoptionFailure.ts` 据此归类：只有 `assets_object_scope_denied` 以 403 透出，并携带同名 reason 与"补 Assets deliveries:view / environments:view 及数据范围"的可执行说明；其余 401/403、Console 服务令牌签发失败以及无效响应一律收敛为 503，不携带 Console 诊断串或内部地址，也不提示用户去申请权限。令牌失败在服务端记录状态码，不返回给浏览器。

调用方缺 AIMS 产品查看权限时仍由 `requireProductPermission` 返回 404「产品不存在或不可见」，不返回 403；因此线上出现 403 就不是 AIMS 产品权限问题。

`adoption.vue` 只在 reason 为 `assets_object_scope_denied` 时展示补权提示，其余失败沿用通用错误告警。

## 经营结果接口与分摊

规则写入入口已注册 `POST /api/v1/finance/service/product-cost/replace-rules`，固定 `finance:product-cost:replace-rules`，operation `aims.finance.product-cost.rules.replace.v1`、schema `product-cost-rules.v1`。签名命令仅 actorUid、projectCode、periodMonth、expectedRevision、evidenceRef、shares；Finance 查询固定用途 `product_cost_rules_edit` 的原用户 project_accounting:edit 范围，每次包括重放均重新鉴权，再调用自身 Runtime 同事务保存完整修订与 receipt。对应精确读写 grants 已纳入生成脚本及 seed/verify。AIMS claimed-operation 执行器与前台/后台 Finance 签名投递 IO 已接入；后台要求显式 HZY_FINANCE_TARGET_DEPLOYMENT，缺失记录为可重试失败。源端冻结入口、规则读取／编辑页及终态查询已实现；真实租户授权联调尚未完成，不能视为已启用。

Finance 已注册 `POST /api/v1/finance/service/product-cost/read`：专用 middleware handler 在通用转发前校验服务身份、签名命令和原用户项目范围，再请求自身 Runtime `/v1/finance/internal/product-cost:read`，返回单产品期间成本 DTO。请求失败不回退通用代理。服务能力及 Console seed/verify 已生成，尚未安装真实租户；AIMS productCostFinance 调用与 cost.vue 页面已接入。

经营读取签名命令 operation/schema 为 `aims.finance.product-cost.read.v1`，目标能力为 `finance:product-cost:read`；命令只含 `actorUid/productCode/projectCode/periodMonth/action=read`。产品最多 64 字符、项目最多 50 字符、期间为有效 YYYY-MM，拒绝服务主体、额外权限字段及客户端币种覆盖。Runtime 解析器、capability manifest、实际服务路由、验签上下文绑定及 grants 生成产物已实现；目标租户的 grant 安装和实际 Token 签发尚待核验。

原用户经营权限使用 Console 专用 subject-scoped 合同：只有已验证 Finance 服务身份可请求固定 purpose `product_cost_read`，目标固定为 `finance:project_accounting:view`，不接受调用方选择动作或资源。此用途现已注册；Finance 消费复用既有项目范围转换并验签委托原用户，AIMS 同时保留当前产品查看权限。该用途不授予规则写入权限，Finance 客户端精确 Console grant 已纳入生成产物，经营读取服务入口已接通；目标环境尚待核验。

先建立产品到项目的显式期间归因规则，再由 Finance 提供按期间和币种分组、带 readiness 的结果。一个项目对应多个产品时不得把项目全额重复计入每个产品；规则应保存有效期、产品、项目、分摊比例、审批／更正依据和稳定修订，期间比例合计不得超过 100%，未分配部分单列。

产品结果引用 Finance 的稳定 summary/allocation code、期间、币种、来源修订和归因规则修订，避免 AIMS 维护第二套成本主账。仅当前有效 allocation 可参与计算；更正／反转产生新结果修订，旧展示可追溯。不同币种分别显示，无明确汇率来源和基准日时不合并。

项目关联不能自动证明产品收入归因。未有收入归因规则时收入／毛利显示未就绪，不用合同总额、开票额或到账额替代产品收入。Finance 应解释收入、成本和毛利采用的口径，AIMS 展示 readiness／缺失项及来源引用。

## 实现顺序与验收

### 经营分摊计算约定（2026-09-09）

Finance 迁移 `20260909_product_cost_attribution.sql` 与 canonical schema 增加当前修订 head 和不可变 revision 两张表。完整比例集合、依据、原用户和创建时间按修订保存；head 行锁覆盖首次创建及后续替换，expectedRevision 不符返回冲突。存储 helper 使用调用方事务，现已与可靠命令 receipt 同事务提交，并在进入事务前校验整个项目／月份的编辑权限。读取用单次 join 绑定当前修订与历史内容，未配置返回无记录，不视作零成本或已就绪。隔离 MySQL 已验证迁移重复执行、首次并发、回滚、历史保留、过期修订、超额拒绝和业务键大小写隔离；未安装真实租户。

Finance Runtime `product_cost_attribution.go` 已实现单项目／月份／规则修订的分摊计算。比例使用整数基点（10000 = 100%），每个产品只出现一次，完整规则总比例不得超过 100%；不得按调用者可见产品裁剪规则后重新归一化。规则必须携带依据引用，后续持久化须按项目／月份串行校验并替换完整修订，避免并发编辑分别通过上限检查。

输入成本为非负 DECIMAL(18,2) 精确字符串，币种为明确的三位大写代码，不提供默认币种或换汇。每个产品金额及未分配比例对应金额分别向下取到分，剩余分值独立列为舍入差额；产品金额之和 + 未分配金额 + 舍入差额严格等于来源成本。产品排序不能决定谁取得尾差。空规则表示全部未分配。

计算核心不证明成本事实或币种来源已就绪，也不提供收入／毛利。`project_finance_summary` 没有统一币种；`project_cost_allocation.currency_code` 已新增可空字段并接入写入和产品成本读取，非人工分摊（asset/shared_expense/other）使用逐条明确币种，托管人工仍核对来源快照，显式币种不得与快照冲突。历史 NULL 不回填，对缺乏逐条币种证据的来源仍须补齐来源证据；不能将默认 CNY 写入旧汇总后宣称历史成本已就绪。当前 Finance 事实读取及持久化层验证反转、就绪状态、权限和来源修订；没有币种证据的来源保持未就绪。定向测试已覆盖上限、重复产品、尾差、完整分配、空规则与 DECIMAL 最大值。

1. Assets 实现当前采用只读聚合、分页及原用户授权；覆盖多关系去重、版本冲突、未知版本、非生产角色、软删除和范围过滤。
2. AIMS 增加采用页和精确服务调用，明确展示“发布版本”与“实际部署”；1440/390 浏览器验证。
3. 核对并实现产品—项目期间归因与 Finance 币种／readiness 摘要服务，不复用无币种的裸 allocation 合计。
4. 增加期间经营结果页，验证分摊上限、多产品不重计、反转、币种隔离、未就绪及权限撤销。
5. 安装精确客户端／双 Runtime audience grants，进行真实租户 JWT、跨部署调用和数据样本验收。

上述全部完成前 PC18 不标为完成。PC17 功能／版本进度回流与通知是独立剩余项，不由本契约消除。

#### 项目规则提交接口

POST /api/v1/projects/{id}/product-cost-rules。请求仅 requestId（客户端生成并在重试时复用的 UUID）、projectCode、periodMonth、expectedRevision、evidenceRef、shares（productCode/basisPoints）。shares 是整个项目期间的完整规则，空数组表示清空；总比例不得超过 10000。

BFF 使用会话 actor、完整项目事实及 projects:edit 范围鉴权，然后以 aims:product-cost-rules:freeze 调用自身 Runtime。目标 Finance 每次执行仍复核该 actor 的 project_accounting:edit。冻结后尝试即时派发，未确认成功返回 202 和 pending=true；响应仅包含 requestId、projectCode、synced、pending。202 表示已冻结且尚未确认投递成功，不表示 Finance 规则已经生效。当前规则读取、cost-rules.vue 编辑 UI 和终态查询已实现；真实租户全链路验收仍待完成。

规则提交状态查询：GET /api/v1/projects/{id}/product-cost-rules/{requestId}?projectCode=...。BFF 重新检查当前用户 projects:edit，并以 aims:product-cost-rules:status 调用自身 POST /v1/aims/internal/product-cost-rules:status。Runtime 限定原提交 actor、项目、租户、部署及固定 operation；不允许仅凭 UUID 跨用户查询。返回 requestId/projectCode/status/synced/pending；failed_permanent、dead_letter、cancelled 是终态，pending=false；不返回原始 command 或内部错误摘要。

完整规则读取 Runtime：POST /v1/finance/internal/product-cost:read-rules，operation aims.finance.product-cost.rules.read.v1、schema product-cost-rules-read.v1、capability finance:product-cost:read-rules。签名 command 仅 actorUid/projectCode/periodMonth/action=read；Finance 原用户 project_accounting:edit 授权与保存一致。只读事务返回 projectCode/periodMonth/revision/evidenceRef/shares，未配置返回 revision=0 和空 shares。Finance Service BFF、AIMS 调用端与编辑 UI 已连接。

Finance 规则读取 Service API 已注册 POST /api/v1/finance/service/product-cost/read-rules，固定 aims.runtime 来源与 finance:product-cost:read-rules。只接受签名 serviceCommand；先验证服务身份和签名，再查询原 actor 的 project_accounting:edit，调用自身读取 Runtime。输出完整规则的白名单 DTO；未配置 revision=0 与已有修订清空规则分别表示。AIMS 调用端和编辑页面已接入。

AIMS 规则读取入口已接通：GET /api/v1/projects/{id}/product-cost-rules?projectCode=...&periodMonth=YYYY-MM。先校验当前用户对完整项目的 projects:edit，再使用可信 Finance 路由、精确 read-rules 服务令牌和签名调用 Finance Service API。响应校验项目/月份、修订、依据、产品唯一性和总比例，白名单返回完整规则。读取失败不能作为空规则基线；revision=0 仅表示 Finance 明确返回未配置。

规则产品引用：AIMS 冻结前，在同一事务内按排序后的 productCode 对 product_workspaces 执行锁定读取，要求所有分摊产品已登记且编码精确匹配。归档工作区仍可用于历史成本；空 shares 可清空规则。此校验不代表 Assets 产品主档的实时生命周期核验，也不替代 Finance 项目核算 edit 授权。

## 当前交付边界（2026-09-09 核对）

- 已实现页面：`products/[productCode]/adoption.vue`、`cost.vue`、`cost-rules.vue`。AIMS 仍分别校验产品／项目权限，Finance 独立复核原用户项目核算权限。
- 当前成本证据：明确币种的直接费用、Finance 台账中明确记录币种的非人工分摊，以及能核对 People 来源币种的托管人工分摊；来源缺少可靠币种时返回未就绪，不能用默认币种补齐。单产品结果只投影该产品比例，计算仍使用完整项目分摊集合，不重新归一化。
- 当前收入：`revenueReady=false`、`revenueReason=revenue_attribution_not_configured`；产品收入归因规则及收入／毛利计算尚未实现。不以合同、开票或到账金额替代。
- 环境待验：真实 tenant/deployment、精确 grants／Token、原用户范围、Finance 迁移、后台规则投递与失败恢复；受控测试不证明目标环境已启用。
- 接下来的实现应围绕缺失成本来源证据和收入归因合同展开；现有规则读写、签名服务与页面应复用，不另建第二套。

### 自动人工成本来源保护

通用分摊 upsert 不得覆盖托管人工成本（包括已反转记录），也不得通过 source_table/rule_code 冒用标准人工同步来源。原记录在事务锁内校验；命中时返回 `managed_labor_sync_required`，必须走原项目人工成本整组同步。该约束防止手工金额变化沿用旧来源快照。项目归属更正还必须同时满足原项目和目标项目授权。
