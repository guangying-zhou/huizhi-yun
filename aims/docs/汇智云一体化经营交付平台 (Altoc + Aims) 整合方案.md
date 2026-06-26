# 汇智云一体化经营交付平台 (Altoc + Aims) 整合方案

## 1. 方案定位

本方案采用 **双库联动、应用层桥接** 的方式打通 Altoc 与 Aims。

目标不是重建统一主库，也不是替换现有 Aims / Altoc 的业务模型，而是在保持两边现有架构稳定的前提下，建立经营到交付、交付到回款的可追溯链路。

### 1.1 当前边界

- Altoc 继续作为经营主系统，维护客户、商机、合同、付款条款、回款计划等经营对象
- Aims 继续作为交付主系统，维护项目、里程碑、工作项、迭代等交付对象
- Account 继续作为身份与组织的唯一来源

### 1.2 V1 原则

- 不合并 `hzy_altoc` 与 `hzy_aims`
- 不改 Aims 现有核心表名和主流程
- 不建立跨库外键
- 仅增加桥接字段和联动接口
- 所有跨模块状态变更均通过应用层 API / 领域事件触发

---

## 2. 联动桥梁设计

### 2.1 数据桥接关系

```text
Altoc (hzy_altoc)                    Aims (hzy_aims)
┌──────────────────┐                 ┌────────────────────┐
│ opportunity       │── opp_id ────► │ aims_projects      │
│ contract          │── contract_id ►│   opp_id           │
│ customer          │── customer_code│   contract_id      │
│ contract_payment_ │                │   customer_code    │
│ term              │── payment_term►│ milestones         │
│ receivable_plan   │◄─ status sync ─│   pivr_stage       │
└──────────────────┘                 │   payment_term_id  │
                                     └────────────────────┘
```

### 2.2 主数据归属

| 领域对象 | 主系统 | Aims 是否持久化 |
| --- | --- | --- |
| customer | Altoc | 仅存 `customer_code` |
| opportunity | Altoc | 存 `opp_id` |
| contract | Altoc | 存 `contract_id`，可保留 `contract_code` 便于展示 |
| contract_payment_term | Altoc | 里程碑存 `payment_term_id` |
| receivable_plan | Altoc | 不在 Aims 落库，仅通过接口联动 |
| project / milestone / work_item | Aims | Altoc 不复制主表 |

说明：

- `customer_code` 继续作为跨系统可读性最强的客户标识
- `opp_id`、`contract_id`、`payment_term_id` 使用 Altoc 主键做桥接 ID
- Aims 不复制 Altoc 的完整经营对象，只按需要冗余少量展示字段

---

## 3. Schema 变更范围

### 3.1 aims_projects 扩展

在现有 `aims_projects` 基础上增加字段：

```sql
ALTER TABLE aims_projects
  ADD COLUMN `opp_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 商机 ID',
  ADD COLUMN `contract_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 合同 ID';
```

说明：

- `customer_code` 已存在，继续保留
- `contract_code` 继续保留，作为展示字段与人工排查辅助字段
- 不在 Aims 中新增 `customer_id`，避免将 Altoc 内部主键扩散为 Aims 基础依赖

### 3.2 milestones 扩展

在现有 `milestones` 基础上增加字段：

```sql
ALTER TABLE milestones
  ADD COLUMN `pivr_stage` ENUM('P','I','V','R') DEFAULT NULL COMMENT 'PIVR 阶段标签，仅交付类项目使用',
  ADD COLUMN `payment_term_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 合同付款条款 ID';
```

说明：

- `pivr_stage` 只作为业务标签，不替代现有 `mode`
- `mode` 继续表示里程碑管理模式：`strong_constraint | rolling_plan | periodic`
- `payment_term_id` 是可选桥接字段，不对所有里程碑强制要求

### 3.3 不做的事

V1 明确不做：

- 不改 `work_items` 主模型
- 不新增跨库外键
- 不将 Altoc 的 `receivable_plan`、`contract_payment_term` 复制到 Aims
- 不把 `milestones` 直接设计成财务对象

---

## 4. 业务联动流程

### 4.1 Altoc -> Aims

#### 场景 A：售前项目启动

- 触发条件：商机进入“方案报价”或等价阶段
- Altoc 调用 Aims 创建 `presales` 项目
- Aims 写入：
  - `opp_id`
  - `customer_code`
  - 可选 `leader_uid`
  - `category = 'presales'`

#### 场景 B：正式立项

- 触发条件：合同生效，或商机赢单并完成合同创建
- Altoc 调用 Aims 创建或更新正式交付项目
- Aims 写入：
  - `opp_id`
  - `contract_id`
  - `customer_code`
  - `contract_code`
  - 项目负责人、计划周期等交付属性

### 4.2 Aims -> Altoc

#### 场景 C：交付触发回款推进

- 前置条件：
  - 里程碑 `pivr_stage = 'V'`
  - 里程碑 `status = 'completed'`
  - 里程碑存在 `payment_term_id`
  - 强约束模式下交付物检查通过
- Aims 不直接改 Altoc 表
- Aims 调用 Altoc 接口，例如：
  - `POST /api/internal/receivable-plans/mark-to-invoice`
- Altoc 校验：
  - `payment_term_id` 是否存在
  - 所属合同是否匹配该项目关联的 `contract_id`
  - 当前回款计划状态是否允许推进为 `to_invoice`
- 校验通过后，由 Altoc 自身更新 `receivable_plan.status`

### 4.3 为什么必须由 Altoc 决定状态推进

Altoc 中 `receivable_plan` 的状态机不止 `pending -> to_invoice`，还包括：

- `to_receive`
- `partially_received`
- `received`
- `overdue`
- `bad_debt`

因此 Aims 只能表达“交付已满足可开票条件”，不能替 Altoc 直接定义最终财务状态。

---

## 5. API 契约建议

### 5.1 Altoc 调用 Aims

#### 创建项目

`POST /api/v1/projects`

新增支持字段：

- `oppId`
- `contractId`
- `customerCode`
- `contractCode`

#### 创建 / 更新里程碑

- `POST /api/v1/projects/:id/milestones`
- `PUT /api/v1/milestones/:id`

新增支持字段：

- `pivrStage`
- `paymentTermId`

### 5.2 Aims 调用 Altoc

建议新增内部接口：

- `POST /api/internal/projects/sync`
  - 用于 Altoc 推送商机/合同关键信息到 Aims
- `POST /api/internal/receivable-plans/mark-to-invoice`
  - 用于 Aims 通知 Altoc 某个付款条款对应交付条件已完成
- `GET /api/internal/contracts/:id/payment-terms`
  - 用于 Aims 拉取某合同可绑定的付款条款

内部接口参数建议包含：

- `source_app`
- `operator_uid`
- `trace_id`
- `project_id`
- `contract_id`
- `payment_term_id`

---

## 6. Aims 侧实现要求

### 6.1 类型定义

需要同步扩展：

- `AimsProject.oppId`
- `AimsProject.contractId`
- `Milestone.pivrStage`
- `Milestone.paymentTermId`

### 6.2 后端接口

需要同步修改：

- 项目创建接口
- 项目更新接口
- 项目详情接口
- 项目列表接口
- 里程碑创建接口
- 里程碑更新接口
- 里程碑详情 / 列表接口

### 6.3 前端表单

需要补齐：

- 项目表单中 Altoc 关联区块
- 里程碑表单中 PIVR 阶段选择
- 合同付款条款选择器
- 只在交付类项目中展示 `pivrStage` / `paymentTermId`

---

## 7. 风险与约束

### 7.1 里程碑不是财务节点本身

一个付款条款可以由一个交付里程碑驱动，但不能把两者视为同一对象。

建议约束：

- 一个里程碑最多绑定一个 `payment_term_id`
- 一个 `payment_term_id` 在同一项目中最多被一个里程碑绑定

### 7.2 presales 项目不应强制绑定回款条款

售前项目可以有 `opp_id`，但通常没有 `contract_id` 和 `payment_term_id`。  
因此所有经营桥接字段都必须允许为空。

### 7.3 跨库一致性由应用层保障

由于不使用跨库外键，必须通过以下方式保证一致性：

- 写入前接口校验
- 幂等调用
- 审计日志
- 失败重试与补偿机制

---

## 8. 结论

V1 推荐方案是：

- 保持 `hzy_altoc` 与 `hzy_aims` 独立
- 在 Aims 中增加最小必要桥接字段
- 通过应用层联动打通经营、交付、回款链路
- 将统一主库视为远期重构议题，而不是当前迭代目标

这条路径兼顾了：

- 现有系统稳定性
- 联动可追溯性
- 后续渐进演进空间

相比直接建设统一 `hzy_pms` 主库，这一方案更适合当前阶段实施。
