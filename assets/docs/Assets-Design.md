# Design: Assets — 企业资产、环境、交付与产品视图

状态：DRAFT  
日期：2026-03-21  
范围：Assets 首版技术设计，不替代 [企业资产管理系统-PRD-V1.0.md](/Users/gavin/Dev/huizhi-yun/assets/docs/%E4%BC%81%E4%B8%9A%E8%B5%84%E4%BA%A7%E7%AE%A1%E7%90%86%E7%B3%BB%E7%BB%9F-PRD-V1.0.md)

## 1. 文档目的

Assets 当前已有较完整 PRD，但尚缺少可直接指导研发开工的模块设计稿。本文档补齐以下内容：

- Assets 在汇智云整体架构中的职责边界
- 首版 MVP 的收敛范围与延后范围
- 核心对象模型、状态机、页面结构与 API 骨架
- 与 `Account`、`Aims`、`Altoc`、`Codocs`、`Workflow` 的集成方式
- 首版数据库表结构草案与后续扩展方向

## 2. 模块定位

Assets 是汇智云平台的“资源与交付支撑事实源”，负责回答三类问题：

- 公司和项目到底拥有哪些资产
- 某个环境、某次交付、某个项目到底用了哪些资源
- 这些资产当前状态、责任人、成本和风险分别是什么

Assets 不是：

- 平台项目注册表
- 客户与合同主数据系统
- 审批引擎
- 研发任务执行系统
- 文档正文存储系统

## 3. 领域边界与事实源

### 3.1 单一事实源

| 领域 | 事实源模块 | Assets 中的使用方式 |
|------|------------|--------------------|
| 用户、部门、角色、权限 | `Account` | 负责人、使用人、保管人、申请人、部门归属、数据权限 |
| 平台项目注册表 | `Account` | `project_code` 关联项目、项目负责人、项目成员、项目启停状态 |
| 客户、合同、商机 | `Altoc` | `customer_code`、`contract_code` 关联客户交付视图和成本归因 |
| 研发执行、工时、里程碑、风险、产品版本 | `Aims` | 项目执行上下文、交付环境相关的研发投入与风险；产品详情页只读展示 Aims 版本路线 |
| 文档正文与文档元数据 | `Codocs` | 关联环境、交付、运维、设计文档，不复制正文 |
| 审批实例与待办 | `Workflow` | 采购、领用、归还、回收等流程实例与审批状态 |
| 资产、环境、交付资源关系 | `Assets` | Assets 自身维护的唯一事实源 |

### 3.2 关键架构判断

- 项目主数据链路必须是 `Assets -> Account`，而不是 `Assets -> Aims`。
- `Aims` 可以提供项目执行上下文，但不能替代 `Account` 成为项目注册表。
- 产品版本事实源在 `Aims`，Assets 产品主档的 `current_version` / `target_version` 仅作为台账展示快照。
- 客户和合同必须来自 `Altoc`，Assets 不建立自己的客户主档。
- 文档正文只归 `Codocs` 管理，Assets 只维护文档引用关系。
- 流程由 `Workflow` 驱动，业务最终状态必须回写到 Assets 本地表。
- 首版不允许通过跨模块数据库直连实现在线业务，统一走 API、回调和异步事件。

## 4. MVP 范围收敛

### 4.1 P0 首版范围

首版以“资产台账 + 环境视图 + 交付视图 + 采购闭环 + 预警”闭环为目标，仅交付下列能力：

- 实物资产台账
- 资源资产台账
- 知识产权资产台账
- 数字资产台账
- 环境视图
- 客户交付视图
- 供应商基础台账
- 采购申请、审批、入库/激活
- 资产分配、领用、转移、归还、释放、报废
- 预警中心
- 资产总览、到期管理、项目/部门成本归因、客户交付成本、环境资源视图

### 4.2 延后到 Phase 2

- 知识产权资产
- 数字资产目录化管理
- 安全视图
- 合格供应商管理
- 账单 API 自动同步
- 入转调离自动联动
- 自动成本分摊
- GitLab/制品仓/云厂商深度自动同步

### 4.3 首版设计原则

- 先把 P0 主链路做透，不追求五大资产分类一次性全部落地
- 统一资产主表，针对实物和资源分别建扩展表
- 环境视图和客户交付视图作为横向对象，不把“环境资产”“交付资产”再建成一级资产
- 所有关联均使用稳定业务键，不使用跨库外键
- 审批先预留 Workflow 接口，不把流程逻辑硬编码到页面里

## 5. 核心用户与使用场景

### 5.1 核心角色

| 角色 | 首版关注点 |
|------|------------|
| 资产管理员 | 台账维护、入库激活、预警处理、全局查询、导入导出 |
| 部门负责人 | 本部门资产领用、归还、采购申请、部门成本查看 |
| 项目负责人 | 项目相关资产、客户交付环境、项目成本与风险查看 |
| 财务 | 采购金额、成本归因、财务口径查看 |
| 普通员工 | 查看本人资产、发起领用/归还 |

### 5.2 四条主链路

#### 采购到建账

`采购申请 -> 审批 -> 下单 -> 到货/开通/激活 -> 建账 -> 绑定项目/环境/合同 -> 分配`

#### 环境建立

`新建环境 -> 关联项目/合同/客户 -> 挂接资源资产/文档 -> 查看成本、责任人、到期`

#### 客户交付

`客户/合同 -> 项目 -> 交付视图 -> 环境 -> 资产 -> 验收/运维`

#### 预警处理

`规则触发 -> 生成预警 -> 指派处理人 -> 延期/确认/完成 -> 记录闭环`

## 6. 信息架构与页面结构

### 6.1 模块导航

```text
Assets
├── 工作台
├── 资产台账
│   ├── 实物资产
│   ├── 资源资产
│   ├── 产品资产
│   ├── 知识产权资产
│   ├── 数字资产
│   └── 资产详情
├── 横向视图
│   ├── 环境视图
│   ├── 客户交付视图
│   └── 视图详情
├── 采购管理
│   ├── 供应商
│   ├── 采购单
│   ├── 入库/激活
│   └── 分配与归还
├── 预警中心
├── 报表统计
└── 系统配置（Phase 2）
```

### 6.2 首版页面路由建议

| 页面 | 路由建议 | 说明 |
|------|----------|------|
| 工作台 | `/` | 我的待办、待处理预警、即将到期资产、项目成本摘要 |
| 实物资产列表 | `/assets/physical` | 列表、筛选、批量导出 |
| 资源资产列表 | `/assets/resources` | 资源、Seat、额度、域名证书统一列表 |
| 产品资产列表 | `/assets/products` | 同一列表中区分产品主档与技术底座子类别 |
| 知识产权资产列表 | `/assets/ip` | 软著、商标、专利、资质证照台账 |
| 数字资产列表 | `/assets/digital` | 代码、文档、数据、模型和交付物台账 |
| 资产详情 | `/assets/[id]` | 基础信息、关系、变更记录、预警记录 |
| 产品主档详情 | `/products/[id]` | 产品信息、技术底座、运行资源 |
| 产品版本路线 | `/products/[id]` | 同页只读区块，来自 Aims service API，展示版本、公开特性和进度 |
| 技术底座详情 | `/technology-bases/[id]` | 服务对象、责任人、关联产品 |
| 知识产权资产详情 | `/ip-assets/[id]` | 权属信息、关联产品、关联文档 |
| 数字资产详情 | `/digital-assets/[id]` | 存储位置、访问权限、关联产品、关联文档 |
| 环境视图列表 | `/environments` | 按环境类型、项目、客户筛选 |
| 环境详情 | `/environments/[id]` | 环境资产、成本、文档、责任人 |
| 客户交付视图列表 | `/deliveries` | 按客户、合同、项目、状态筛选 |
| 客户交付详情 | `/deliveries/[id]` | 环境、资产、成本、关键文档 |
| 供应商列表 | `/procurement/suppliers` | 供应商台账 |
| 采购单列表 | `/procurement/orders` | 状态筛选、审批状态、入库状态 |
| 采购单详情 | `/procurement/orders/[id]` | 采购项、审批记录、入库记录 |
| 入库/激活台 | `/procurement/receipts` | 待入库、待激活、已处理 |
| 分配/归还记录 | `/operations/assignments` | 分配、转移、归还、释放、报废 |
| 预警中心 | `/alerts` | 待处理、已延期、已完成 |
| 报表页 | `/reports` | 总览、到期、项目成本、客户交付成本 |

### 6.3 列表页统一模式

首版列表页统一采用：

- 顶部摘要卡片
- 高级筛选区
- `UTable` 主列表
- 右侧详情抽屉或跳转详情页
- 批量操作仅保留导出、批量标记处理、批量指派

## 7. 对象模型设计

### 7.1 统一资产模型

Assets 首版采用“统一资产主表 + 类型扩展表”模式。

统一主表负责：

- 编号、名称、分类、归属、责任人
- 部门/项目/合同/环境关联
- 通用状态、标签、备注、审计字段

扩展表分别负责：

- 实物资产扩展字段
- 资源资产扩展字段

### 7.2 核心对象

| 对象 | 说明 | 首版是否落地 |
|------|------|--------------|
| `asset_items` | 统一资产主档 | 是 |
| `asset_physical_details` | 实物资产扩展字段 | 是 |
| `asset_resource_details` | 资源资产扩展字段 | 是 |
| `product_assets` | 产品主档 | 是 |
| `technology_bases` | 技术底座 | 是 |
| `product_asset_bases` | 产品与技术底座关联 | 是 |
| `product_asset_resources` | 产品与资源资产关联 | 是 |
| `ip_assets` | 知识产权资产主档 | 是 |
| `ip_asset_products` | 知识产权与产品关联 | 是 |
| `digital_assets` | 数字资产主档 | 是 |
| `digital_asset_products` | 数字资产与产品关联 | 是 |
| `asset_environments` | 环境视图实体 | 是 |
| `asset_delivery_views` | 客户交付视图实体 | 是 |
| `asset_delivery_products` | 客户交付与产品关联 | 是 |
| `suppliers` | 供应商基础台账 | 是 |
| `purchase_orders` | 采购单 | 是 |
| `purchase_order_items` | 采购明细 | 是 |
| `asset_receipts` | 入库/激活/登记记录 | 是 |
| `asset_assignments` | 分配、领用、转移、归还、释放、报废记录 | 是 |
| `asset_alerts` | 预警实例 | 是 |
| `asset_monthly_costs` | 月度成本记录 | 是 |
| `asset_documents` | 关联 Codocs 文档 | 是 |
| `asset_events` | 全量操作日志 | 是 |
| 数字/知识产权相关表 | 扩展资产类型 | 是 |

### 7.3 统一关联键

跨模块字段统一采用业务键：

- 用户：`uid`
- 部门：`dept_code`
- 项目：`project_code`
- 客户：`customer_code`
- 合同：`contract_code`
- 文档：`document_id`
- Workflow 实例：`workflow_instance_id`

## 8. 状态机设计

### 8.1 采购单状态

```text
draft -> pending_approval -> approved -> ordered -> received -> stocked -> completed
                                  \-> rejected
draft / approved / ordered / received / stocked -> closed
```

说明：

- `received` 表示到货、开通或激活已发生
- `stocked` 表示 Assets 已完成建账或激活登记
- `closed` 用于作废、终止或无需继续的采购单

### 8.2 实物资产状态

```text
pending_stock_in -> in_stock -> in_use -> idle -> repairing -> scrapped
```

补充字段：

- `claim_status`: `unclaimed -> claimed -> returned`

### 8.3 资源资产状态

```text
pending_activation -> active -> expiring -> expired -> released -> disabled
```

### 8.4 环境状态

```text
planning -> active -> frozen -> retired
```

### 8.5 客户交付状态

```text
preparing -> delivering -> online -> accepted -> terminated
```

### 8.6 预警状态

```text
pending -> acknowledged -> snoozed -> resolved -> ignored
```

## 9. 权限模型

### 9.1 权限来源

权限仍由 `Account` 提供，Assets 只做两层控制：

- RBAC：菜单、页面、按钮、API 级别的基础权限
- 数据归属：按部门、项目、本人、负责人范围过滤数据

### 9.2 首版权限策略

| 能力 | 资产管理员 | 部门负责人 | 项目负责人 | 财务 | 普通员工 |
|------|------------|------------|------------|------|----------|
| 查看全量资产 | 是 | 否 | 否 | 否 | 否 |
| 查看本部门资产 | 是 | 是 | 否 | 否 | 否 |
| 查看项目相关资产 | 是 | 否 | 是 | 否 | 否 |
| 查看本人名下资产 | 是 | 是 | 是 | 否 | 是 |
| 新增/编辑资产 | 是 | 部分 | 部分 | 否 | 否 |
| 发起采购 | 是 | 是 | 是 | 否 | 否 |
| 查看成本金额 | 是 | 部分 | 部分 | 是 | 否 |
| 处理预警 | 是 | 部分 | 部分 | 否 | 否 |

## 10. API 设计

首版 API 对外统一采用 `/api/v1/**` 风格，前端不直接访问外部模块 API，而是调用 Assets 自身后端，由后端代理和聚合外部数据。

### 10.1 资产台账

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/assets` | 资产列表，按类型/部门/项目/状态筛选 |
| `POST` | `/api/v1/assets` | 新建资产 |
| `GET` | `/api/v1/assets/:id` | 资产详情 |
| `PATCH` | `/api/v1/assets/:id` | 更新资产 |
| `POST` | `/api/v1/assets/:id/status` | 状态变更 |
| `GET` | `/api/v1/assets/:id/events` | 资产操作记录 |
| `POST` | `/api/v1/assets/:id/documents` | 关联 Codocs 文档 |

### 10.2 环境与交付视图

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/environments` | 环境列表 |
| `POST` | `/api/v1/environments` | 新建环境 |
| `GET` | `/api/v1/environments/:id` | 环境详情 |
| `PATCH` | `/api/v1/environments/:id` | 更新环境 |
| `POST` | `/api/v1/environments/:id/assets` | 绑定资产到环境 |
| `GET` | `/api/v1/deliveries` | 客户交付视图列表 |
| `POST` | `/api/v1/deliveries` | 新建客户交付视图 |
| `GET` | `/api/v1/deliveries/:id` | 客户交付视图详情 |
| `PATCH` | `/api/v1/deliveries/:id` | 更新交付视图 |

### 10.3 采购管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/suppliers` | 供应商列表 |
| `POST` | `/api/v1/suppliers` | 新建供应商 |
| `GET` | `/api/v1/purchase-orders` | 采购单列表 |
| `POST` | `/api/v1/purchase-orders` | 新建采购单 |
| `GET` | `/api/v1/purchase-orders/:id` | 采购单详情 |
| `POST` | `/api/v1/purchase-orders/:id/submit` | 提交审批 |
| `POST` | `/api/v1/purchase-orders/:id/receipts` | 入库/激活/登记 |

### 10.4 资产操作

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/assignments` | 分配、领用、转移、归还、释放、报废 |
| `GET` | `/api/v1/assignments` | 操作记录列表 |
| `GET` | `/api/v1/alerts` | 预警列表 |
| `POST` | `/api/v1/alerts/:id/actions` | 确认、延期、完成、忽略 |

### 10.5 工作台与报表

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/dashboard/overview` | 工作台总览 |
| `GET` | `/api/v1/reports/assets-summary` | 资产总览 |
| `GET` | `/api/v1/reports/expiring` | 到期管理 |
| `GET` | `/api/v1/reports/project-costs` | 项目成本归因 |
| `GET` | `/api/v1/reports/delivery-costs` | 客户交付成本 |
| `GET` | `/api/v1/reports/environment-resources` | 环境资源视图 |

## 11. 集成设计

### 11.1 与 Account

使用场景：

- 登录态、权限、用户/部门数据
- 项目注册表
- 通知能力或统一消息网关

设计要求：

- 前端只调 Assets API，不直连 Account
- Assets 服务端通过 `server/api/account/**` 代理或 `server/utils/accountApi.ts` 获取组织数据
- 项目选择器统一使用 `project_code`

### 11.2 与 Altoc

使用场景：

- 客户交付视图的客户、合同来源
- 客户/合同维度成本统计

设计要求：

- Assets 不维护客户主档
- `customer_code`、`contract_code` 作为外部引用存储
- 首版允许“引用为主、缓存为辅”，避免深度主数据复制

### 11.3 与 Aims

使用场景：

- 项目执行上下文
- 工时、里程碑、项目风险
- 产品版本路线、版本公开特性和版本目标进度

设计要求：

- Assets 只消费项目执行上下文，不反向向 Aims 提供项目主数据
- 首版先做只读聚合接口，不做强耦合写入
- 产品详情页通过 Assets 本地 server handler 调 Aims service API `GET /api/v1/service/products/:productCode/versions`；调用使用 Console service token（`audience=aims`，`scope=aims:read`），前端不直连 Aims。
- `product_assets.project_code` 是历史/台账字段，可用于一次性初始导入 Aims `aims_project_products`，在线项目↔产品关联事实源不在 Assets。
- `current_version` / `target_version` 保留为台账快照；版本清单、状态、特性和进度以 Aims 为准。
- 后续可支持“资产预警 -> Aims 任务”联动，但不纳入首版强依赖

### 11.4 与 Codocs

使用场景：

- 环境文档
- 运维文档
- 接口文档
- 交付文档

设计要求：

- Assets 只存 `document_id`、文档类型和引用说明
- 文档正文、权限、版本由 Codocs 自己负责

### 11.5 与 Workflow

使用场景：

- 采购审批
- 领用审批
- 归还/回收审批
- 大额续费或释放审批

设计要求：

- 首版表结构中预留 `workflow_instance_id`
- 审批完成后由 Workflow 回调 Assets 更新本地业务状态
- 即使 Workflow 尚未完全接入，Assets 也必须有本地业务状态字段

## 12. 数据库设计

### 12.1 设计思路

数据库采用“P0 可落地 + P1 可扩展”的模式：

- 主表稳定：统一资产主档、环境、交付视图、采购、预警
- 类型扩展明确：实物/资源扩展字段独立表
- 关系通过关联表表达，不在表结构层面硬编码过深层级
- 审计和历史通过事件表与操作表统一记录

### 12.2 核心表清单

| 表 | 说明 |
|----|------|
| `system_parameters` | 系统参数 |
| `asset_items` | 统一资产主表 |
| `asset_physical_details` | 实物资产扩展 |
| `asset_resource_details` | 资源资产扩展 |
| `asset_environments` | 环境视图 |
| `asset_environment_assets` | 环境与资产关联 |
| `asset_delivery_views` | 客户交付视图 |
| `asset_delivery_environments` | 交付视图与环境关联 |
| `asset_documents` | 关联文档 |
| `suppliers` | 供应商基础台账 |
| `purchase_orders` | 采购单 |
| `purchase_order_items` | 采购单明细 |
| `asset_receipts` | 入库/激活/登记记录 |
| `asset_assignments` | 分配、转移、归还、释放等操作 |
| `asset_alerts` | 预警实例 |
| `asset_monthly_costs` | 月度成本记录 |
| `asset_events` | 统一操作日志 |

### 12.3 数据归属说明

- `asset_items.project_code` 只是项目引用，不代表项目主档
- `asset_items.contract_code` 和 `asset_delivery_views.contract_code` 只是合同引用，不代表合同主档
- 成本统计优先取采购金额和月度成本记录，不做自动财务分摊
- 涉及凭证、密钥等敏感字段，在资源扩展表中只保留加密值与脱敏值

## 13. 首版实现顺序

### Phase 1：底座

- 落 `assets_schema.sql`
- 建资产主表、扩展表、环境、交付视图、采购单、预警表
- 定义基础枚举与编号规则

### Phase 2：P0 页面与 API

- 实物资产列表/详情
- 资源资产列表/详情
- 环境视图列表/详情
- 采购单列表/详情/入库台
- 预警中心
- 基础报表

### Phase 3：跨模块联动

- 读取 Account 项目、用户、部门
- 读取 Altoc 合同、客户
- 读取 Aims 项目执行摘要
- 关联 Codocs 文档
- 接入 Workflow 审批

## 14. 当前设计决策

| 编号 | 决策 | 结论 |
|------|------|------|
| AD-01 | 项目主数据来源 | `Account` |
| AD-02 | 客户/合同主数据来源 | `Altoc` |
| AD-03 | 文档正文存储 | `Codocs` |
| AD-04 | 审批状态来源 | `Workflow`，业务终态回写 `Assets` |
| AD-05 | 首版资产类型 | 仅 `实物资产`、`资源资产` 正式落地 |
| AD-06 | 环境/交付建模 | 作为横向对象，不作为一级资产 |
| AD-07 | 成本口径 | 首版以采购金额 + 月均费用手工录入为主 |
| AD-08 | 资产预警联动 Aims | 首版只预留，不做强依赖 |

## 15. 待后续确认

- Assets 模块正式服务端口编号是否单独分配
- Altoc 对外 API 的字段口径是否以 `customer_code` / `contract_code` 为准
- Workflow 首版回调签名与重试机制是否与其他模块统一
- 资源密钥类字段的加密方案是否统一复用平台级封装
- 报表统计是否直接落库聚合，还是首版在线聚合查询
