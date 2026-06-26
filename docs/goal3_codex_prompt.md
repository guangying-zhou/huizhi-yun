# Codex Goal 3：成本归集与经营核算闭环（Altoc + Aims + Finance）

你正在修改仓库 `guangying-zhou/huizhi-yun`。

Goal 1：已完成（合同 → 合同行 → 项目结构化）  
Goal 2：已完成（交付资产 → 环境 → 服务覆盖闭环）

---

# 一、目标

构建完整经营核算能力：

```text
客户
  → 合同
    → 合同行
      → 项目（Aims）
        → 工时（worklog）
        → 人力成本（People/Finance）
      → 服务协议
        → 工单（ticket）
          → 服务成本
      → 收入（billing schedule）
```

最终实现：

- 合同收入
- 合同行成本
- 项目毛利
- 客户利润

---

# 二、强约束

## ❌ 不允许

- 不改 Goal 1 / 2 数据模型
- 不引入 Console 成本能力
- 不复制工时到 Altoc
- 不改 Assets / Aims 主数据职责
- 不引入新的成本主账系统

## ✅ 必须遵守

- Aims = 工时事实
- Finance = 成本单价
- Altoc = 经营归集
- 所有成本必须可重算

---

# 三、核心能力

---

# 任务1：合同行成本分摊模型（Altoc）

## contract_line_cost_allocation

```sql
id
tenant_id
contract_line_code
project_code

allocation_type   -- direct / ratio / amount / workdays

allocation_ratio
allocated_amount
allocated_workdays

status
created_at
updated_at
deleted_at
```

---

# 任务2：项目成本汇总（Aims）

## project_cost_summary

```sql
project_code
period_start
period_end

total_hours
labor_cost
outsourced_cost
other_cost
total_cost
```

---

# 任务3：合同收入结构（Altoc）

## billing_schedule

```sql
contract_line_code
milestone_type
due_date
amount
paid_amount
status
```

---

# 任务4：合同行利润模型

## contract_line_profit_summary

```sql
contract_line_code
total_revenue
total_cost
gross_profit
gross_margin
period_start
period_end
```

---

# 任务5：成本链路

```text
worklog
 → project_code
   → contract_line_cost_allocation
     → contract_line
       → billing_schedule
```

---

# 任务6：服务成本（维保）

## service_cost_summary

```sql
service_agreement_code
project_code
total_hours
total_cost
ticket_count
```

---

# 任务7：经营API

## GET /analytics/contract/{code}

```json
{
  "revenue": 100000,
  "cost": 60000,
  "profit": 40000,
  "margin": 0.4
}
```

---

## GET /analytics/customer/{code}

---

# 四、关键规则

## 成本
- 必须通过 project_code

## 收入
- 来自 billing_schedule

## 毛利
- revenue - cost

---

# 五、测试要求

- 多 project → 多 contract line
- 分摊模式 ratio/amount/workdays
- 工时重放不重复计费
- 收入分期/部分付款
- 毛利正确计算

---

# 六、验收标准

✔ 成本可归集  
✔ 收入可拆分  
✔ 毛利正确  
✔ 可重算  
✔ 不重复计算  

---

# 七、本质

Altoc 从履约系统升级为经营核算系统
