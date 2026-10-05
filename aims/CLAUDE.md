# Aims 模块

项目文档宿主链复用原 `projects/[id]/documents.vue`，Host 上传调用共享 `projectDocumentUpload`。项目搜索/摘要/创建/ACL 通过签名 Codocs `project-document-access` Service API，不得恢复 Aims → Codocs Runtime 直连。完整边界、幂等和测试状态见根 MODULE_CONTRACTS 的 2026-09-19 补充；浏览器全链验收尚待完成。

> 业务模块 — 研发项目全生命周期管理 | 端口 3002 | 状态：开发中（MVP/Beta） | 数据库：tenant-runtime 托管（默认 hzy_aims）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。

## 职责边界

**负责**：项目管理（立项→交付）、需求分析、产品版本管理、迭代/Sprint 规划、任务看板（Epic→Story→Task→Sub-task）、缺陷管理、GitLab 代码集成、测试管理、工时统计、项目报表

**不负责**：客户/商机/合同（→ Altoc）、文档内容编辑（→ Codocs iframe）、资产与产品主档管理（→ Assets）、企业目录主数据与登录态（→ Console）、租户授权治理与 policy bundle（→ Platform）、审批流转（→ Workflow）

## PIVR 方法论

所有项目统一采用 PIVR 四阶段：Planning（规划）→ Implementation（实施）→ Verification（验收）→ Release（交付）。里程碑与合同回款节点映射。

V1.1 分类约束：`routine` 是日常事务容器，不立项、不生成里程碑，创建后直接进入 `active`，只承载 `matter` 层工作项与工时；项目集 `default_category='routine'` 对子项目是不可覆盖的强约束，其余默认分类只是创建预设。维保项目以 `service_line_code + service_period_seq` 串联服务年度，非自然年服务期不得用单一年份作为展示标签。

系统项目管理提供 `POST /api/v1/admin/projects/batch-create-routine`：浏览器只提交年度，Aims BFF 从 Console Directory 读取正式部门、部门负责人和 active 成员，再由 tenant-runtime 在单一事务中创建或复用系统“日常事务”项目集，并按部门 × 年幂等创建 `routine` 项目；已有项目和未配置部门负责人的部门只计入跳过结果。

## Altoc 桥接（有效方案）

Altoc 与 Aims 通过 API 桥接，不合并数据库：
- `opp_id` — 关联 Altoc 商机
- `contract_id` — 关联 Altoc 合同
- `customer_code` — 关联 Altoc 客户
- `payment_term_id` — 里程碑映射到回款节点

详见：`docs/汇智云一体化经营交付平台 (Altoc + Aims) 整合方案.md`

## 一体化运营闭环 Phase 1 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Aims 是交付项目、PIVR 里程碑、项目文档/交付物的事实源。Phase 1 Altoc → Aims 调用使用 Console service token，目标 `aud=aims`，读写 scope 分别为 `aims:read` / `aims:write`；写操作必须带 `Idempotency-Key` 或由请求体派生等效幂等键。

Phase 1 首轮已落地的 service endpoint：
- `POST /api/v1/service/projects/from-opportunity`：Altoc 按商机创建 `presales` / `sales` 执行项目；只接受标准 service-command envelope，要求来源 `altoc` 和精确 capability `aims:project:create-from-opportunity`，按 `opp_id + category` 业务幂等，项目、分类模板实例与 succeeded receipt 同事务提交。商机状态和主数据仍只由 Altoc 维护，Aims 不回写。
- `POST /api/v1/service/projects/from-contract`：按 Altoc 合同项目计划创建或关联交付项目，按 source 冻结的确定 `project_code` / `planKey` 幂等，支持同一合同拆分多个 Aims 项目；Altoc contract activation 使用标准 service-command envelope 时，项目 mutation 与 `service_command_receipt` succeeded 同事务。
- `GET /api/v1/service/projects/by-contract/{contractCode}`：兼容旧单项目读取；P1 项目选择应使用 `eligible-for-contract` 或 Altoc 下发的 `project_plans`。
- `GET /api/v1/service/projects/eligible-for-contract?contract_code=&customer_code=&search=`：按客户、合同和搜索词返回可关联的未归档项目候选，支持 Altoc 关联已有项目。
- `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync`：按付款条款和 Altoc 结算计划同步 PIVR 里程碑，按 `project_code + payment_term_id` 或 `project_code + template_key` upsert；可靠 activation 命令必须依赖同 plan 的 project operation，并与自己的 receipt 同事务提交。
上述 runtime-forwarded `/api/v1/service/**` 入口在 Aims middleware 转发 tenant-runtime 前校验 Console service token 和 `aims:read` / `aims:write` scope；未登记 capability 的 service 后缀会在代理前拒绝，不得落到通用 runtime 转发或本地 handler。
服务令牌 introspection 只有明确 inactive/revoked/invalid 才返回 401；Console introspection 网络、5xx 或存储故障必须在读取业务 body、调用 handler 或 tenant-runtime mutation 前返回可重试 503。Cloudflare 托管云必须通过 `HZY_CONSOLE_SERVICE` Service Binding 调 Console `/oauth/introspect`，不得从后台 Worker 公网 fetch Console custom domain。

Aims 验收里程碑完成后只通过 Altoc service API 推进回款计划，不直写 Altoc 或 Finance 数据。`POST /api/v1/milestones/{id}/review-approve` 在 data-runtime 内锁定里程碑，把 completed/下一里程碑激活与 caller-owned `integration_operation` 写入同一事务；冻结目标只取受信 `milestones.payment_term_id`、项目和合同事实，浏览器提交的 `receivablePlanCode/paymentTermId` 不参与目标选择。BFF 领取冻结命令后调用 Altoc `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable`，目标回款计划 mutation 与 `service_command_receipt` succeeded 同事务；同键同 hash 重放返回原 receipt，异 hash 409，Aims 校验 receipt 后才 checkpoint。即时请求、专属 task、共享 Gateway wake、管理员诊断和受控重放复用既有 operation 设施；调用 token 需 `altoc:receivable:mark-billable`。

Aims 所有 caller-owned `integration_operation` INSERT 必须显式以 `UTC_TIMESTAMP(3)` 写入 `next_attempt_at`，与 Go claim 使用的 UTC 时钟保持同域，禁止依赖按 MySQL 会话时区求值的列默认值。

## 运维服务与客户成功 Phase 4 契约

Aims 是服务工单回流后的执行事实源。Altoc 管客户成功经营事实和服务工单入口，Aims 只承接执行工作项并向 Altoc 回写处理结果，不复制 Altoc 工单主档。

P4.2 已落地：
- `POST /api/v1/service/service-tickets/{ticketCode}/work-item/receive`：只接受 Altoc 冻结的标准 service-command envelope，要求 `aud=aims`、精确 capability `aims:service-ticket:work-item:create`、来源 `altoc`；工作项 mutation、初始 Aims→Altoc 结果 operation 和 `service_command_receipt` succeeded 在同一事务提交。旧 raw `POST .../work-item` 已退役，middleware 不再放行，runtime 明确返回 `410 legacy_service_ticket_work_item_retired`。
- 工单类型映射：`incident -> bug`、`requirement -> requirement`、`change -> change_request`、`consulting/default -> task`。
- 未指定 `milestoneId` 时，Aims 会创建 / 复用 `template_key=service_ops` 的项目里程碑作为服务工单执行容器，不新增 `work_items.type` 枚举。
- `work_item_service_ext` 保存 Altoc 工单的 `source_ticket_code`、客户、环境、响应 / 解决时限、SLA 快照和首次响应 / 解决时间；SLA 快照仅展示，官方 SLA 结果仍以 Altoc 为准。
- `source_ticket_code` 是全局自然绑定：同一工单在同一项目重放返回既有工作项，解析到另一项目时返回冲突，不允许通过扩展表 upsert 改绑。
- 单条 `PUT /api/v1/work-items/{id}` 通过 data-runtime transactional update hook，把工作项更新、首响/解决时间冻结和 caller-owned `integration_operation` 写入同一 Aims 数据库事务；outbox 插入失败时工作项更新整体回滚。runtime 只从更新后的受信项目、工单扩展、累计工时和唯一关联文档生成冻结 command，映射 `todo/planning → accepted`、`in_progress → processing`、`in_review → resolved`、`completed → closed`。多个关联文档时失败关闭。
- BFF 只读取 PUT 返回的 operation key，先从 Aims runtime claim 冻结 command，再用 Console service token 调 Altoc `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync`；Altoc 工单 mutation 与 `service_command_receipt` succeeded 同事务，同身份同 hash 重放返回原工单键；Aims 校验 receipt 并保存 `target_receipt_id` 后才成功收口。成功/失败均受 operation ID、worker、lease 和 fencing token 约束；目标已提交而 source ACK 暂不可用时返回 `202 integration_checkpoint_unavailable`，保留原 operation 恢复。调用 token 需 kebab-case capability `altoc:service-ticket:delivery-result:sync`，单调代际幂等键为 `aims:work-item:{itemKey}:ticket-result:g{generation}:v1`；同状态重放必须读取真实 operation status 并校验冻结 command hash。Altoc 的 resolved/closed/cancelled 终态不会仅因更高 Aims generation 被重开。管理员 API 提供脱敏诊断和受控重放；即时请求、专属 task 和 Tenant Gateway 私有 wake 复用同一 executor。dead-letter 由 source 安全扫描后通过 Console 专用通知入口发布，Console 成功才 CAS 保存通知 ID；ack 丢失依靠通知幂等键恢复。shared wake 必须通过内部 token + 60 秒 HMAC，event-bound runtime context 只允许 10 条/25 秒，普通 HTTP 与 `/_nitro/tasks/**` 均拒绝。本轮列明的可靠投递调用（Altoc、People、Codocs）和三处 Assets 调用使用 Foundation `serviceAppFetch` 与对应 `HZY_<APP>_SERVICE` binding；event-bound 请求由 `trustedServiceRequestHeaders` 原子改写目标 app/deployment/prefix，Codocs 周报命令另以短期 token 对 source/target deployment 和 request ID 签名，event-less drain 需要显式 `HZY_CODOCS_TARGET_DEPLOYMENT`。`codocsApi.ts` 中未列入本轮、包含 multipart/文件流的存量调用仍是后续迁移项，不在此宣称已统一。批量状态更新仅对关联服务工单按工作项在同一事务冻结相同 operation，接口不逐项外呼；可视化 UI 和部署态 live acceptance 仍归 G3 后续任务。

周期运维里程碑已落地：
- `POST /api/v1/service/projects/{projectCode}/milestones/{milestoneId}:rollover`：Aims 自身 BFF 或 scheduled task 调用，要求 `aud=aims`、`scope=aims:write`、来源 `aims`；按 `project_id + template_key + period_start` 和 `idempotency_key` 幂等。
- `POST /api/v1/service/milestones:rollover-due`：Aims Nitro scheduled task 每日扫描到期 periodic 里程碑；Cloudflare 部署需生成 wrangler cron trigger。
- runtime 在关期前执行五项门禁（完结/结转、超时补救、工时成本、SLA 复核、周期复盘），失败时必须处理或登记原因/责任人/日期完整的例外；月度复盘可显式豁免，季度/年度不可豁免。scheduled scan 对未过门周期只产出待办，不静默滚动。通过后关闭当前周期、创建下一周期，并将门禁、例外、SLA/成本快照与结转溯源写入 `milestone_cycle_snapshots`；连续结转三期的工作项标记治理异常。

## 依赖的模块

- **Console**：应用用户登录、OIDC token、Directory API（`HZY_CONSOLE_URL` / `HZY_CONSOLE_API_URL`）
- **Platform / Console / Foundation**：Platform 负责 policy bundle 与租户角色授权；Console 是运行时授权事实源；Aims 只通过 Foundation 获取权限快照和项目 scoped authorization，不读取本地 bundle
- **Workflow**：项目立项/暂停/恢复/结项审批（`hzy.workflowApiUrl`）
- **Codocs**：项目文档编辑（iframe 嵌入，`codocsUrl`）
- **Altoc**：商机→项目、合同→里程碑关联；验收通过时按 Aims runtime 锁定的 `payment_term_id` 可靠推进 Altoc 回款计划可开票，浏览器不能选择目标
- **GitLab**：代码仓库/分支/MR 集成
- **Account**：仅作为 `HZY_AUTH_MODE=legacy` / `HZY_LEGACY_AUTH_BRIDGE=true` 迁移期兼容来源，不新增依赖

## GitLab Issue 与外部任务输出

- `POST /api/v1/projects/{id}/sync-gitlab-issues` 把 runtime 校验后的 Aims 工作项幂等投影为项目已关联仓库的 GitLab Issue；Aims 仍是事实源，`gitlab_issue_links` 只保存稳定外部链接与最近同步状态。
- GitLab Issue 固定操作经 Foundation → Console tenant-runtime → credential-vault 执行；Aims 和浏览器不得读取 Token，也不得绕过 `aims_project_repos` 仓库绑定。
- `GET /api/v1/service/tasks` 以 `aims:tasks:read` 精确 capability 向 Orca/WebDev 等已登记服务客户端提供 cursor 分页任务列表，不在业务代码维护调用方白名单。
- API、状态映射、幂等标记与发布顺序见 `docs/Aims-GitLab-Issue-Task-Feed-API.md`。

## 到期通知目标资格

- 工作项到期通知的候选收件人只允许当前 active 项目成员中的 assignee，或项目 leader；不再回退到部门经理。旧责任人 projection 必须先按既有 checkpoint/CAS 合同关闭。
- 发布前必须通过 Console subject eligibility 服务确认目标用户 Directory 状态为 active，且对 Aims 固定目的 `work_items:view` 具有当前 normal-merged 访问资格。拒绝、inactive 或资格服务不可用时不得发布、不得 ack，保留原候选等待重试。
- subject eligibility 只证明资源级读取资格；exact 工作项目标仍由 Aims 当前项目成员/leader 关系和目标页 runtime 重鉴权共同约束。
- ADR-018 统一调度（Runtime Aims scheduler 为 `unified`）下，到期通知与周期里程碑滚动都只由 Gateway 签名 drain 唤醒执行，分别使用精确 `aims:notifications-due:execute` / `aims:milestone-rollover:execute` 与 scheduler generation；legacy 入口返回 409 owner 拒绝，本地 cron 记 skipped。合同见根 `docs/MODULE_CONTRACTS.md`。

## 数据库

Schema 定义：`docs/aims_schema.sql`

核心表：project_portfolios、aims_projects、project_members、milestones、work_items、product_versions、aims_project_products、product_version_features、product_version_logs、deliverables、approvals

产品版本管理事实源在 Aims：Assets 只提供 `product_assets.product_code` 产品主档和只读展示入口；项目↔产品关联写入 `aims_project_products`，版本清单/特性/进度由 `product_versions`、`product_version_features` 和 target 层 `work_items.version_id` 聚合。跨模块服务调用使用 Console service token，Aims → Assets 需要 `assets:read`，Assets → Aims 版本摘要使用 `aims:product-version-summary:read` 和专用 version-summaries 接口。

产品中心建设见 [`docs/Aims-Product-Center-Implementation-Plan.md`](./docs/Aims-Product-Center-Implementation-Plan.md)，当前代码与验收状态见[实施记录](./docs/Aims-Product-Center-Implementation-Status.md)。v5.19 已增加工作空间／优先级存储与内部领域规则，产品范围授权、API、页面仍待接通；不能把新表存在视为产品中心或精确 service capability 已可用。继续保留 Assets 产品主档事实源。

Aims 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。`server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。

## 一体化运营闭环 Phase 3 契约

Aims 是项目工时、项目参与和交付贡献的来源应用。Aims 不直连 People 数据库，通过 Console service token 调 People service API：

- `POST /api/v1/projects/{projectId}/people-contributions/sync`：Aims 可靠编排端点。data-runtime 在 `REPEATABLE READ` 事务内锁定路由项目及期间 `review_status=approved` 的 `time_entries`，聚合完整集合（包括 `items=[]`），按原始 `project/cycle/source` SHA-256 作用域维护单调 `source_revision`，并把冻结快照版本与 caller-owned `integration_operation` 同事务持久化。BFF 只能按固定代码映射以 `aud=people`、`scope=people:write` 派发 `aims.people-contributions.replace-scope.v1`，浏览器不得选择 project、target、capability、tenant 或 deployment；5xx/响应确认丢失由同一 operation/receipt 身份重试，定时 drain 负责有界补偿。
- 请求必须提供 `cycleCode`、`periodStart`、`periodEnd`。贡献快照保持 `source_app=aims`、`source_biz_type=time_entries` 兼容替换范围，固定 `score_status=unscored` 且不传默认分；`source_refs` 保留 time entry、work item 和 `review_status=approved` 证据。默认 Idempotency-Key 包含规范化集合哈希，内容变化不会复用旧请求键。
- `GET /api/v1/service/project-management-facts`：仅允许 People 以精确 `aims:project-management-facts:read` capability 按 period/project/revision 增量读取公司汇总发布后生成的事实；返回 `correctionOfId/sourceRefs/sourceSha256`，更正只追加 revision，不原地覆盖。

## 成本归集与经营核算 Goal 3 契约

Aims 是项目工时事实源。Goal 3 新增 `project_cost_summary` 作为可重算的项目成本汇总层，只保存期间合计工时、按人员成本单价计算后的人力成本、外包成本、其他成本和总成本；不把 Altoc 合同、Finance 明细账或 People 人员主档复制到 Aims。

新增 tenant-runtime service endpoint：
- `GET /api/v1/service/projects/{projectCode}/cost-summary`
- `POST /api/v1/service/projects/{projectCode}/cost-summary:recalculate`

重算请求由 Finance/People 成本参数或上游编排提供 `hourlyCosts` / `standardCosts` / `defaultHourlyCost`、`outsourcedCost`、`otherCost` 和期间；Aims 只从本地 `time_entries` 聚合工时，按 `project_code + period_start + period_end + calculation_key` 幂等写入 summary。重放同一计算键不得重复累加。

## 交付环境身份闭环 Goal 2 契约

Aims 是项目与正式环境执行关系的事实源。`project_environments` 只保存 Aims 本地 `project_id`、Assets 正式 `environment_code` / `delivery_asset_code`、本次项目的交付状态、交接状态、版本快照和 Assets 同步状态；不建立第二套环境主档，也不生成正式 `environment_code`。

新增 service endpoint：
- `GET/POST /api/v1/service/projects/{projectCode}/environments`：查询或幂等写入项目环境执行关系。
- `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:status`：推进部署、上线、验收、交接并标记 Assets 同步待处理。
- `POST /api/v1/service/projects/{projectCode}/environments/{environmentCode}:assets-sync`：记录 Assets 同步成功或失败，失败保留诊断错误供重试。
- `GET /api/v1/service/environments/{environmentCode}/projects`：按正式环境反查项目历史。

## 开发注意

- 项目状态流转：draft → approval_pending → active ↔ paused → completed → archived
- 工作项支持四级层次：Epic → Story → Task → Sub-task
- Foundation 层提供 useWorkflow 组合式函数，审批不要自己实现
- 默认登录路径通过 Foundation 接入 Console OIDC；CAS / 企业微信等上游身份源由 Console 承接
- Aims 本地 CAS 回调已移除；默认登录入口通过 Foundation Console OIDC 提供
- 企业微信等外部 integration credential 通过 Foundation `integrationConfig.ts` 按 `integrationCode` 读取 Console 配置并 resolve vault secret，不再读取本地企业微信环境变量
- ADR-016 阶段 2 起，Aims 通过 `server/middleware/tenant-runtime.ts` 转发 `/api/v1/**` 业务路径；优先使用统一 `HZY_TENANT_RUNTIME_URL`，`HZY_AIMS_TENANT_RUNTIME_URL` 仅作为应用级覆盖。未启用 tenant-runtime 时应显式报错，不允许回退本地 DB handler。
- 产品主档历史导入脚本：`pnpm import:product-version-bindings -- --create-versions --apply`。默认不带 `--apply` 为 dry-run；脚本只用于受控迁移环境，不属于在线业务路径。

## 产品客户反馈接收（PC17，实现中）

`POST /api/v1/service/product-requests/from-feedback` 在 middleware 中进入专用签名 BFF，不走通用代理；精确 capability 为 aims:product-request:create-from-feedback，固定来源 altoc.runtime。原 actor 的产品权限经 Foundation 当前 scoped authorization 验证，需求与来源绑定／receipt 同事务。契约与当前缺口见 `docs/Aims-Product-Feedback-Contract.md`；源派发、grant 和真实环境验收未完成，不能视为已启用集成。

产品成本分摊规则的可靠投递使用 Finance Service API `/api/v1/finance/service/product-cost/replace-rules`，精确 capability 为 `finance:product-cost:replace-rules`；request/scheduled IO 复用冻结命令和 Foundation 签名。后台显式配置 `HZY_FINANCE_TARGET_DEPLOYMENT`，托管云经 `HZY_FINANCE_SERVICE` Binding；源端冻结入口及规则编辑 UI 仍在实现中。

旧项目／管理端版本特性创建、修改、删除入口均已返回 410；产品中心通过规划范围、验收、顺延及公开设置维护版本特性，不允许旧入口清空工作项关联后直接删除范围。

## 产品治理角色

- `aims:product_manager`（产品经理）：规划、需求、目标、优先级、路线图、版本计划与验收；企业角色显式配置 `product:manager` 范围。
- `aims:product_director`（产品总监）：产品接入与目录刷新、空间和成员管理、跨产品目标与优先级治理、路线图和版本计划；企业角色显式配置 `tenant:global` 范围，不含永久删除、版本验收、发布和重新打开版本。
- `aims:product_publisher` 保持独立发布职责。普通运行权限合并，因此同一主体兼任其他角色时仍会获得其有效权限；新增总监角色不会撤销已有角色，也不能代替服务端自验收/发布职责冲突校验。
- 权限事实源是 `app.manifest.json`。应用模板注册后还须建立企业可分配角色、应用角色映射和逐权限范围，发布策略包后才在租户运行环境生效。
