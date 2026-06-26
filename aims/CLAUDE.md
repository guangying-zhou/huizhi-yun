# Aims 模块

> 业务模块 — 研发项目全生命周期管理 | 端口 3002 | 状态：开发中（MVP/Beta） | 数据库：tenant-runtime 托管（默认 hzy_aims）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。

## 职责边界

**负责**：项目管理（立项→交付）、需求分析、产品版本管理、迭代/Sprint 规划、任务看板（Epic→Story→Task→Sub-task）、缺陷管理、GitLab 代码集成、测试管理、工时统计、项目报表

**不负责**：客户/商机/合同（→ Altoc）、文档内容编辑（→ Codocs iframe）、资产与产品主档管理（→ Assets）、企业目录主数据与登录态（→ Console）、租户授权治理与 policy bundle（→ Platform）、审批流转（→ Workflow）

## PIVR 方法论

所有项目统一采用 PIVR 四阶段：Planning（规划）→ Implementation（实施）→ Verification（验收）→ Release（交付）。里程碑与合同回款节点映射。

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
- `POST /api/v1/service/projects/from-contract`：按 Altoc 合同项目计划创建或关联交付项目，按 `project_code` / `planKey` 幂等，支持同一合同拆分多个 Aims 项目。
- `GET /api/v1/service/projects/by-contract/{contractCode}`：兼容旧单项目读取；P1 项目选择应使用 `eligible-for-contract` 或 Altoc 下发的 `project_plans`。
- `GET /api/v1/service/projects/eligible-for-contract?contract_code=&customer_code=&search=`：按客户、合同和搜索词返回可关联的未归档项目候选，支持 Altoc 关联已有项目。
- `POST /api/v1/service/projects/{projectCode}/payment-milestones:sync`：按付款条款和 Altoc 结算计划同步 PIVR 里程碑，按 `project_code + payment_term_id` 或 `project_code + template_key` upsert。
上述 runtime-forwarded `/api/v1/service/**` 入口在 Aims middleware 转发 tenant-runtime 前校验 Console service token 和 `aims:read` / `aims:write` scope。

Aims 验收里程碑完成后只通过 Altoc service API / 事件推进回款计划，不直写 Altoc 或 Finance 数据。当前 `POST /api/v1/milestones/{id}/review-approve` 会优先使用请求体中的 `receivablePlanCode` / `receivable_plan_code` 调用 Altoc；未提供时，使用 runtime 返回的 `paymentTermId` 调用 Altoc `POST /api/v1/service/payment-terms/{paymentTermId}/receivable-plan:mark-billable` 自动推进回款计划，调用 token 需申请 `altoc:write altoc:receivable:mark-billable`。

## 运维服务与客户成功 Phase 4 契约

Aims 是服务工单回流后的执行事实源。Altoc 管客户成功经营事实和服务工单入口，Aims 只承接执行工作项并向 Altoc 回写处理结果，不复制 Altoc 工单主档。

P4.2 已落地：
- `POST /api/v1/service/service-tickets/{ticketCode}/work-item`：按 Altoc 服务工单创建或复用 Aims 工作项；幂等键写入 `work_items.template_key=altoc:service_ticket:{ticketCode}`。
- Aims middleware 在转发该 service endpoint 到 tenant-runtime 前校验入站 Console service token，要求 `aud=aims`、`scope=aims:write`、来源 `altoc`。
- 工单类型映射：`incident -> bug`、`requirement -> requirement`、`change -> change_request`、`consulting/default -> task`。
- 未指定 `milestoneId` 时，Aims 会创建 / 复用 `template_key=service_ops` 的项目里程碑作为服务工单执行容器。
- 处理结果通过 Altoc `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` 回写，Aims 不直写 Altoc 数据库；调用 token 需申请 `altoc:write altoc:service_ticket:delivery-result:sync`。

## 依赖的模块

- **Console**：应用用户登录、OIDC token、Directory API（`HZY_CONSOLE_URL` / `HZY_CONSOLE_API_URL`）
- **Platform / Console / Foundation**：Platform 负责 policy bundle 与租户角色授权；Console 是运行时授权事实源；Aims 只通过 Foundation 获取权限快照和项目 scoped authorization，不读取本地 bundle
- **Workflow**：项目立项/暂停/恢复/结项审批（`hzy.workflowApiUrl`）
- **Codocs**：项目文档编辑（iframe 嵌入，`codocsUrl`）
- **Altoc**：商机→项目、合同→里程碑关联；Phase 1 已落地合同项目桥接、付款条款里程碑同步，以及验收通过时按 `receivablePlanCode` 或 `paymentTermId` 通知 Altoc 回款计划可开票的 service 调用
- **GitLab**：代码仓库/分支/MR 集成
- **Account**：仅作为 `HZY_AUTH_MODE=legacy` / `HZY_LEGACY_AUTH_BRIDGE=true` 迁移期兼容来源，不新增依赖

## 数据库

Schema 定义：`docs/aims_schema.sql`

核心表：project_portfolios、aims_projects、project_members、milestones、work_items、product_versions、aims_project_products、product_version_features、product_version_logs、deliverables、approvals

产品版本管理事实源在 Aims：Assets 只提供 `product_assets.product_code` 产品主档和只读展示入口；项目↔产品关联写入 `aims_project_products`，版本清单/特性/进度由 `product_versions`、`product_version_features` 和 target 层 `work_items.version_id` 聚合。跨模块服务调用使用 Console service token，Aims → Assets 需要 `assets:read`，Assets → Aims 需要 `aims:read`。

Aims 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db` / Hyperdrive。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。`server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository、DB fallback 或 Cloudflare Hyperdrive。

## 一体化运营闭环 Phase 3 契约

Aims 是项目工时、项目参与和交付贡献的来源应用。Aims 不直连 People 数据库，通过 Console service token 调 People service API：

- `POST /api/v1/projects/{projectId}/people-contributions/sync`：Aims 本地编排端点，按 `periodStart/periodEnd` 聚合项目 `time_entries`，调用 People `POST /api/v1/service/contributions:sync`，目标 `aud=people`、`scope=people:write`。
- 请求必须提供 `cycleCode`、`periodStart`、`periodEnd`；贡献快照使用 `source_app=aims`、`source_biz_type=time_entries`，`source_refs` 保留 time entry 和 work item 引用。

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
