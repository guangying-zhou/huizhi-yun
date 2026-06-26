# Assets 模块

> 业务模块 — 企业资产与资源管理 | 端口 3004 | 状态：主干已接入 tenant-runtime（Phase 2 交付资产包完成） | 数据库：tenant-runtime 托管（默认 hzy_assets）
>
> 📖 涉及认证、目录、审批、共享组件或 Server API 复用时，按需查 [`docs/FOUNDATION_CAPABILITIES.md`](../docs/FOUNDATION_CAPABILITIES.md)；简单局部改动不需要预读。
>
> 📚 **分类口径** [`docs/ASSET_CLASSIFICATION_GUIDE.md`](./docs/ASSET_CLASSIFICATION_GUIDE.md) — 五大资产分类定义、边界判定、典型对象落类示例。

## 职责边界

**负责**：实物资产（笔记本/服务器）、资源资产（订阅/席位）、环境与交付视图、供应商管理、采购→入库→分配→退回→处置全流程、到期/配额预警、项目/部门/客户成本归因

**不负责**：项目执行（→ Aims）、客户/合同数据（→ Altoc）、文档（→ Codocs）、审批流转（→ Workflow）

## 数据归属原则

- 项目注册表与组织目录走 Console Directory API / Foundation adapter；迁移期 legacy 模块可继续兼容 Account
- 项目执行、版本、任务与交付进度只从 Aims 查询
- 客户/合同数据只从 Altoc 查询
- 审计文档只引用 Codocs 的 document_id，不存储内容
- 所有资产操作（采购→入库→分配→退回→报废）通过 Workflow 审批

## 依赖的模块

- **Console Directory / Foundation**：项目注册表、部门、用户查询和业务授权消费；Account 仅作为 legacy 迁移兼容。Assets 不读取本地 policy bundle，权限快照只经 Foundation/Console。
- **Aims**：项目执行、产品版本、交付进度与里程碑引用
- **Altoc**：客户/合同引用
- **Workflow**：采购/领用/分配/退回/报废审批动作定义与终态同步
- **Codocs**：文档引用（仅存 document_id）

## 一体化运营闭环 Phase 0 契约

首条闭环按 `docs/Huizhi-yun-Integrated-Operations-Roadmap.md` 与 `docs/MODULE_CONTRACTS.md` 执行：Assets 是客户交付视图、环境、资产、资产文档关联和资产成本归因的事实源。Assets 只保存 `customer_code`、`contract_code`、`project_code`、`document_uuid` 等稳定业务键，不复制 Altoc 合同主档、Aims 项目执行事实或 Finance 财务事实。

冻结的 service endpoint 目标：
- `POST /api/v1/service/deliveries/upsert`：按客户、合同、项目创建或更新交付视图。
- `POST /api/v1/service/deliveries/{deliveryCode}/documents`：关联交付文档。

调用方必须使用 Console service token，目标 `aud=assets`、`scope=assets:write`，写操作必须带 `Idempotency-Key`。现有用户侧 `/api/v1/deliveries/**` 可作为实现参考，但 service-only 合同需要独立鉴权和幂等处理。

## 一体化运营闭环 Phase 2 契约

Phase 2 已把交付视图推进为“交付资产包”：

- `POST /api/v1/service/deliveries/upsert` 已落地到 tenant-runtime，按 `delivery_code` 或 `contract_code + project_code` 幂等 upsert，保存 Altoc `customer_code/contract_code` 和 Aims `project_code` 稳定键。
- `POST /api/v1/service/deliveries/{deliveryCode}/documents` 已落地，交付成果只保存 Codocs `document_uuid`，并用 `artifact_type` 标识九类成果：`solution`、`requirement`、`design`、`test_report`、`deployment_manual`、`acceptance_report`、`training_material`、`ops_knowledge`、`customer_environment_record`；Aims `milestone_id/milestone_code`、来源应用和客户 / 合同 / 项目上下文写入 `asset_documents.source_context`。
- `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` 返回客户 / 合同 / 项目交付资产包，包含交付视图、关联产品、环境和文档。
- `GET /api/v1/service/projects/{projectCode}/cost-summary?period_month=` 输出资产采购、资源订阅、环境投入和月度成本归集，供 Finance 项目核算写入成本分摊。
- 上述 `/api/v1/service/**` 入口在 Nuxt middleware 转发 tenant-runtime 前校验 Console service token；Assets 用户界面关联交付文档走 `/api/v1/deliveries/{deliveryCode}/documents` 用户路径，不调用 service-only endpoint。
- 采购单和资产操作均以 Workflow 为审批事实源：采购 submit 后进入 `pending_approval`；资产领用 / 分配 / 退回 / 报废操作默认 `pending`，只有 Workflow 同步为 approved 后才联动资产主档。

## 一体化运营闭环 P1 客户交付资产契约

P1 已新增 Assets 侧 `customer_delivery_assets` 主档，用于承接 Altoc 合同行生成的客户交付资产。该主档允许 `project_code` 为空，覆盖软件许可 / SaaS 等不需要 Aims 项目的销售合同；它只保存 Altoc `customer_code/contract_code/contract_line_code`、产品和生命周期状态等稳定引用，不复制合同商业条款。

已落地 service endpoint：
- `POST /api/v1/service/customer-delivery-assets/plans`：Altoc 履约启动时按计划资产批量 upsert 客户交付资产，返回 `delivery_asset_code` 供 Altoc 回填。
- `GET /api/v1/service/customer-delivery-assets/by-customer?customer_code=&contract_code=&project_code=` 和 `GET /api/v1/service/customer-delivery-assets/by-contract/{contractCode}`：按客户 / 合同 / 项目读取交付资产主档。
- `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/activate`：推进 delivered / online / accepted 等生命周期状态；Assets BFF 会尽力回调 Altoc `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/status:sync`，payload 携带 `sourcePlanCode`、正式 `deliveryAssetCode`、正式 `environmentCode`、`projectCode`、`status` 和 `occurredAt`，让合同计划资产、关联义务、结算计划和 pending 服务覆盖获得状态回写。Altoc 同步失败不回滚 Assets 状态，响应附带同步错误供调用方重试。

## 交付环境身份闭环 Goal 2 契约

Assets 是正式客户交付资产、正式环境和二者部署关系的事实源。`asset_environments.environment_code` 与 `customer_delivery_assets.delivery_asset_code` 只能由 Assets 生成或复用；Aims/Altoc 只保存这些稳定 code。`customer_delivery_assets.environment_code` 保留为兼容性的主环境快照，完整部署关系以 `customer_delivery_asset_environment_rel` 为准；`asset_environments.project_code` 仅表示初始/来源项目快照，项目历史以 Aims `project_environments` 为准。`asset_environments.status` 不单独区分 `accepted`，`online` / `accepted` 会归一为 `active`；验收完成以 `asset_environments.accepted_at` 或部署关系 `deployment_status = accepted` 为准。

新增 service endpoint：
- `POST /api/v1/service/environments/upsert`：幂等创建或复用正式环境。
- `POST /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments:bind`：绑定交付资产与正式环境，支持多环境和唯一主环境。
- `GET /api/v1/service/customer-delivery-assets/{deliveryAssetCode}/environments`、`GET /api/v1/service/environments/{environmentCode}/customer-delivery-assets`：正式关系查询。
- `POST /api/v1/service/environments/{environmentCode}/lifecycle:sync`、`POST /api/v1/service/references:resolve`：环境生命周期与正式引用解析。

## 数据库

Schema 定义：`docs/assets_schema.sql`

统一资产模型：asset_items 主表 + 专用详情表（asset_physical_details、asset_resource_details 等）

Assets 应用自身不得直连 MySQL，也不再配置 `DB_*` / `runtimeConfig.db`。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。`server/utils/db.ts` 仅保留为迁移期防误用桩，任何新增代码不得导入或调用它；如业务接口缺失，应先补 tenant-runtime adapter，而不是恢复本地 repository 或 DB fallback。

## 开发注意

- `asset_purpose` 枚举决定成本归因规则：self_use / project_procurement / sales_stock
- 成本归因三维度：cost_bearer（公司/客户/共享）+ finance_subject + 部门/项目
- 禁止跨模块 DB JOIN，首版只用 API + 异步回调
- ADR-016 阶段 2 起，Assets 通过 `server/middleware/tenant-runtime.ts` 将 `/api/v1/**` 业务路径转发到 tenant-runtime；优先使用统一 `HZY_TENANT_RUNTIME_URL`，`HZY_ASSETS_TENANT_RUNTIME_URL` 仅作为应用级覆盖。未启用 tenant-runtime 时应显式报错，不允许回退本地 repository + DB。
