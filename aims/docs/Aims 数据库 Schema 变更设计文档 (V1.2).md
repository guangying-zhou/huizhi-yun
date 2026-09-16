# Aims 数据库 Schema 变更设计文档 (V1.2)

## 1. 设计目标

本次变更的目标不是重构 Aims 主模型，而是在现有 `hzy_aims` 数据库上增加 Altoc 联动桥接字段，使 Aims 可以在不破坏现有项目、里程碑、工作项结构的前提下，承接经营侧上下文。

本次变更聚焦：

- 经营到交付的来源追溯
- 交付到回款的条件绑定
- 保持 Aims / Altoc 双库解耦

不在本次变更范围内：

- 统一 PMS 主库
- 合并 Altoc / Aims 表结构
- 引入跨库外键
- 改造 `work_items` 主模型

---

## 2. 现状约束

当前 Aims 已具备以下特征：

- `aims_projects` 已持有 `customer_code`、`contract_code` 等跨模块引用字段
- `milestones` 是交付锚点，保留 `mode` / `status` 语义
- `work_items` 仍以 `milestone_id` 作为一级容器，不适合直接引入经营对象

因此本次变更应遵循“**项目层挂经营来源，里程碑层挂回款触发条件**”的原则。

---

## 3. Schema 变更方案

### 3.1 aims_projects 增加经营桥接字段

```sql
ALTER TABLE `hzy_aims`.`aims_projects`
ADD COLUMN `opp_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 商机 ID' AFTER `customer_code`,
ADD COLUMN `contract_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 合同 ID' AFTER `opp_id`;
```

字段说明：

| 字段 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `opp_id` | BIGINT UNSIGNED | 否 | Altoc 商机主键，用于追溯项目来源 |
| `contract_id` | BIGINT UNSIGNED | 否 | Altoc 合同主键，用于绑定正式交付项目 |

设计说明：

- `customer_code` 保持不变，继续作为客户侧跨系统公共标识
- `contract_code` 保持不变，继续用于展示和人工对账
- `opp_id` / `contract_id` 仅作为桥接 ID，不建立跨库 FK

### 3.2 milestones 增加交付联动字段

```sql
ALTER TABLE `hzy_aims`.`milestones`
ADD COLUMN `pivr_stage` ENUM('P','I','V','R') DEFAULT NULL COMMENT 'PIVR 阶段标签，仅交付类项目使用' AFTER `mode`,
ADD COLUMN `payment_term_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '关联 Altoc 合同付款条款 ID' AFTER `pivr_stage`;
```

字段说明：

| 字段 | 类型 | 是否必填 | 说明 |
| --- | --- | --- | --- |
| `pivr_stage` | ENUM('P','I','V','R') | 否 | 用于表达交付阶段标签 |
| `payment_term_id` | BIGINT UNSIGNED | 否 | 关联 Altoc `contract_payment_term.id` |

设计说明：

- `pivr_stage` 是业务标签，不替代 `mode`
- `mode` 继续表示里程碑管理模式
- `payment_term_id` 只用于“某里程碑完成后可触发某付款条款进入开票流程”

---

## 4. 与 Altoc 的对象映射

| Altoc 对象 | Altoc 主键 / 编码 | Aims 对应字段 | 用途 |
| --- | --- | --- | --- |
| `customer` | `code` | `aims_projects.customer_code` | 客户对齐 |
| `opportunity` | `id` | `aims_projects.opp_id` | 商机来源追溯 |
| `contract` | `id` | `aims_projects.contract_id` | 合同绑定 |
| `contract` | `code` | `aims_projects.contract_code` | 合同展示 / 排查 |
| `contract_payment_term` | `id` | `milestones.payment_term_id` | 交付触发财务联动 |

注意：

- Altoc 实际付款条款表名为 `contract_payment_term`
- 本文不使用复数表名 `contract_payment_terms`

---

## 5. 应用层联动规则

### 5.1 Altoc -> Aims

#### 商机触发售前项目

- 商机进入售前需要协作的阶段后，Altoc 调用 Aims 创建 `presales` 项目
- Aims 写入：
  - `opp_id`
  - `customer_code`
  - 可选 `leader_uid`

#### 合同触发正式项目

- 合同有效后，由 Altoc 创建或升级正式交付项目
- Aims 写入：
  - `opp_id`
  - `contract_id`
  - `customer_code`
  - `contract_code`

### 5.2 Aims -> Altoc

#### 里程碑完成触发可开票条件

只有在以下条件同时成立时，Aims 才能向 Altoc 发起联动：

- `milestones.pivr_stage = 'V'`
- `milestones.status = 'completed'`
- `milestones.payment_term_id IS NOT NULL`
- 项目已绑定 `contract_id`
- 若 `mode = 'strong_constraint'`，交付物校验已通过

联动动作：

- Aims 发起 Altoc 内部接口调用
- Altoc 校验后决定是否将对应 `receivable_plan.status` 推进到 `to_invoice`

### 5.3 为什么不能由 Aims 直接改回款状态

因为 `receivable_plan` 属于 Altoc 财务语义对象，真实状态机包含：

- `pending`
- `to_invoice`
- `to_receive`
- `partially_received`
- `received`
- `overdue`
- `bad_debt`

因此 Aims 只能表达“交付已满足申请开票条件”，不能直接定义 Altoc 财务状态流转。

---

## 6. 接口与代码同步要求

### 6.1 Aims 类型定义

需要同步扩展：

```ts
interface AimsProject {
  oppId: number | null
  contractId: number | null
}

interface Milestone {
  pivrStage: 'P' | 'I' | 'V' | 'R' | null
  paymentTermId: number | null
}
```

### 6.2 Aims 后端接口

需要同步修改：

- `POST /api/v1/projects`
- `PUT /api/v1/projects/:id`
- `GET /api/v1/projects/:id`
- `GET /api/v1/projects`
- `POST /api/v1/projects/:id/milestones`
- `PUT /api/v1/milestones/:id`
- `GET /api/v1/milestones/:id`
- `GET /api/v1/projects/:id/milestones`

### 6.3 前端表单与展示

项目页增加：

- 商机关联
- 合同关联
- 客户编码展示

里程碑页增加：

- PIVR 阶段选择
- 付款条款绑定

展示约束：

- 非交付型项目默认隐藏 `pivrStage` / `paymentTermId`
- presales 项目允许仅绑定 `opp_id`

---

## 7. 数据约束建议

建议通过应用层校验而不是数据库跨库约束来保证一致性：

### 7.1 项目级约束

- 若填写 `contract_id`，建议同时填写 `customer_code`
- 若填写 `contract_id`，通常也应有 `opp_id`

### 7.2 里程碑级约束

- 若填写 `payment_term_id`，所属项目必须存在 `contract_id`
- 若填写 `payment_term_id`，建议要求 `pivr_stage = 'V'`
- 同一项目内，同一个 `payment_term_id` 不应被多个里程碑重复绑定

---

## 8. 推荐实施顺序

1. 先执行 Schema 增量变更
2. 同步修改 Aims 类型与接口
3. Altoc 增加供 Aims 查询付款条款与推进回款状态的内部接口
4. 前端补充项目和里程碑配置入口
5. 最后补审计日志、幂等和失败重试

---

## 9. 结论

这是一份 **最小侵入、可渐进上线** 的 V1 变更方案。

它保留了：

- Aims 现有项目模型
- Altoc 现有经营模型
- 双库边界

同时补齐了：

- 商机到项目的来源追溯
- 合同到项目的业务绑定
- 里程碑到付款条款的联动桥梁

这版方案适合作为当前阶段的正式实现口径。
