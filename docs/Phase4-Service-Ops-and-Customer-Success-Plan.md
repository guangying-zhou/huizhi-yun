# Phase 4 运维服务与客户成功设计方案

## 目标

Phase 4 覆盖交付后的客户系统台账、维保合同、SLA、服务工单、需求 / 缺陷回流、运维知识和续约经营。首轮目标不是新增独立应用，而是在现有边界内补齐可落地闭环：

`客户 / 合同 -> 交付系统 -> 维保权益 / SLA -> 服务工单 -> Aims 缺陷或需求 -> Codocs 知识 -> Finance 维保收入和服务成本 -> Altoc 续约机会`

## 模块边界

| 领域 | 事实源 | 最小职责 |
| --- | --- | --- |
| 客户、合同、维保合同、续约机会、服务工单入口 | Altoc | 维护客户成功经营视角，统一查看客户合同、维保期、SLA、工单和续约机会 |
| 客户系统 / 交付实例、环境、产品版本、交付文档 | Assets | 承接交付资产包，记录已交付系统、环境和版本上下文 |
| 工单执行、缺陷 / 需求 / 变更工作项 | Aims | 将服务工单转为维护项目中的工作项，跟踪处理结果 |
| 运维知识、SOP、故障复盘 | Codocs | 保存文档正文，业务模块仅保存 document UUID |
| 维保收入、服务成本、续约回款分析 | Finance | 维保收入分类、服务成本归集、合同 / 客户维度财务分析 |

## 最小数据对象

### Altoc

- `maintenance_contract`：维保合同或原合同的维保条款，关联 `customer_code`、`contract_code`、`delivery_code`、服务起止日期、金额、状态。
- `service_entitlement`：SLA 权益，关联维保合同，记录响应时限、解决时限、服务窗口、服务级别和计费方式。
- `service_ticket`：服务工单，类型包括 `incident`、`consulting`、`requirement`、`change`，记录客户、系统、产品版本、SLA 状态、Aims 回流引用和知识文档引用。
- `renewal_opportunity`：续约机会，来源可为维保到期、服务满意度、增购线索或客户成功计划。

### Assets

- 复用交付视图 / 交付资产包；如现有字段不足，再扩展 `delivery_instance` 视图对象。
- 每个交付实例保存 `customer_code`、`contract_code`、`project_code`、`product_code`、`version_code`、`environment_code`、`delivery_status`、`ops_owner_uid`。

### Aims

- 服务工单回流后创建或关联维护项目工作项。
- `incident` 默认映射 `bug`，`requirement` 映射 `requirement`，`change` 映射 `change_request`，`consulting` 可映射普通 `task`。

### Codocs

- 运维知识文档仅保存正文和协作编辑能力。
- Altoc / Assets 保存 `document_uuid`、`document_type=ops_knowledge`、客户 / 系统 / 产品版本上下文。

### Finance

- 复用 `finance_income_type.code=maintenance`。
- 服务成本优先从 Aims 项目工时、People 人力成本和 Assets 资源成本汇总，不新增独立成本事实源。

## Service API 契约

| 调用方 | 被调用方 | 端点 | 目的 |
| --- | --- | --- | --- |
| Altoc | Assets | `GET /api/v1/service/deliveries/package?customer_code=&contract_code=&project_code=` | 获取客户交付系统、环境、产品版本和交付文档 |
| Altoc | Aims | `POST /api/v1/service/service-tickets/{ticketCode}/work-item` | 将工单回流为缺陷、需求、变更或任务 |
| Aims | Altoc | `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` | 回写处理状态、工作项和交付结果 |
| Altoc | Codocs | `POST /api/v1/service/ops-knowledge/link` | 关联运维知识文档 UUID |
| Finance | Altoc | `GET /api/v1/service/customers/{customerCode}/maintenance-summary` | 读取维保合同、续约机会和服务上下文 |
| Altoc / Finance | Finance | `GET /api/v1/finance/service/customers/{customerCode}/maintenance-financial-summary?contract_codes=&project_codes=&period_month=` | 按客户、合同和项目范围汇总维保收入、服务成本和毛利 |

全部跨模块调用使用 Console service token；写操作必须带 `Idempotency-Key` 或可由业务键派生。

## 当前落地状态

P4.1 已落地 Altoc 最小服务运营事实源：

- `maintenance_contract`、`service_entitlement`、`service_ticket`、`renewal_opportunity` 已进入 Altoc schema 与 `008_phase4_service_ops.sql` 增量迁移。
- data-runtime Altoc adapter 已提供上述四类对象的通用列表、详情、创建、更新和软删除资源。
- `GET /api/v1/service/customers/{customerCode}/maintenance-summary` 已作为 Finance / 客户成功看板的只读汇总接口，返回客户、维保合同、SLA 权益、最近工单和续约机会。
- Aims `POST /api/v1/service/service-tickets/{ticketCode}/work-item` 已能按 Altoc 工单创建或复用项目工作项，使用 `work_items.template_key=altoc:service_ticket:{ticketCode}` 保证幂等。
- Altoc `POST /api/v1/service/service-tickets/{ticketCode}/delivery-result:sync` 已能接收 Aims 工作项处理结果，回写工单状态、Aims 引用、解决 / 关闭时间和 Codocs 文档 UUID。
- Altoc 客户详情“服务运营”页签已提供“回流 Aims”操作入口，通过本地 BFF 调用 Aims 创建 / 复用工作项，并立即把 `aims_work_item_key` 回写到服务工单。
P4.3 / P4.4 已完成首轮最小闭环：

- Altoc 客户详情新增“服务运营”页签，聚合展示维保合同、SLA、服务工单、续约机会、Assets 客户交付系统和 Finance 维保财务摘要。
- Altoc 新增本地只读编排接口 `GET /api/v1/customers/{customerCode}/delivery-package`，通过 Console service token（`aud=assets`、`scope=assets:read`）读取 Assets 交付资产包，Assets 端在转发 tenant-runtime 前校验入站 service token。
- Altoc 新增本地只读编排接口 `GET /api/v1/customers/{customerCode}/maintenance-financial-summary`，先读取 Altoc 维保范围，再带 `contract_codes/project_codes` 调 Finance，避免把客户下全部项目泛化为维保。
- Altoc 用户态编排接口 `POST /api/v1/service-tickets/{ticketCode}/aims-work-item` 负责在用户权限校验后调用 Aims `POST /api/v1/service/service-tickets/{ticketCode}/work-item`，用户入口不占用 `/api/v1/service/**` 命名空间。
- Codocs data-runtime 新增 `POST /v1/codocs/service/ops-knowledge/link`，通过 `document_relations` 将运维知识文档 UUID 关联到客户、合同、项目、交付实例和服务工单上下文；文档正文仍只在 Codocs。
- Finance data-runtime 新增 `GET /v1/finance/service/customers/{customerCode}/maintenance-financial-summary`，基于发票、到账、核销、项目财务摘要和项目成本分摊做只读聚合，不新增独立成本事实源。

## 推进步骤

1. P4.0 契约冻结：确认 Altoc 作为服务工单事实源，Assets 作为交付实例事实源，Aims 作为执行事实源。
2. P4.1 Altoc schema / data-runtime：新增维保合同、SLA、服务工单和续约机会最小表，先提供列表、详情、创建和状态流转。（已完成）
3. P4.2 Aims 回流：新增 service endpoint，把工单创建为维护项目工作项，并向 Altoc 回写处理结果。（已完成）
4. P4.3 客户视图：Altoc 客户详情展示交付系统、维保期限、SLA、服务工单、知识文档和续约机会。（已完成）
5. P4.4 知识与财务：Codocs 文档关联运维知识，Finance 汇总维保收入、服务成本和续约回款。（已完成）

## 验收

- 从客户能查看合同、交付系统、维保期限、SLA、服务工单、知识库和续约机会。
- 服务工单能生成 Aims 缺陷 / 需求 / 变更 / 任务，并跟踪处理结果。
- 运维知识能归档到 Codocs，并按客户、系统、产品版本追溯。
- Finance 能按客户和合同查看维保收入、服务成本和续约回款情况。
