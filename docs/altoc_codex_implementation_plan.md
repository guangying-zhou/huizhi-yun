# Altoc 合同履约关系收口与成本归集基础改造方案

## 1. 推荐执行方式

不要把全部问题一次性交给 Codex 做成一个超大改动。建议拆为四个可独立验收的 Goal：

| 顺序 | Goal | 主要产出 |
|---|---|---|
| 1 | 履约关系结构化收口 | 合同行—项目、履约义务—项目、服务协议—服务项目关系 |
| 2 | 交付环境覆盖身份收口 | 计划资产、Assets 正式交付实例、环境 code 的清晰边界 |
| 3 | 维保模型与额度账收口 | 新模型停止双写旧模型，额度改为可审计流水 |
| 4 | 实际成本归集 | Finance/Aims 成本按项目分配到合同行、合同和客户 |

**建议现在先执行 Goal 1。**
它是后续环境覆盖、维保服务和成本核算的共同前置条件，且不需要先建设 Console 关系表。

---

## 2. 总体目标架构

```text
Altoc
customer
  -> contract
      -> contract_line
          -> contract_project_line_rel
              -> Aims project_code
                  -> task/worklog
                  -> Finance project cost

contract_line
  -> service_agreement
      -> service_agreement_project_rel
          -> Aims service project_code
      -> service coverage
          -> Assets formal delivery/environment code
```

职责边界：

- Altoc：客户、合同、合同行、服务权益、商业关系和成本归集维度。
- Aims：项目、任务、工时和交付执行事实。
- Assets：正式交付实例、环境/资产长期台账和当前态。
- Finance：人员及其他直接成本的核算主账。
- Console：当前阶段不参与业务关系写入，也不是运行时必经节点。

---

## 3. 当前关键问题与改造原则

### 3.1 合同行—项目关系仍以 JSON 为主

当前 `contract_project_link` 同时存在直接 ID 字段和 `line_codes_json`、`obligation_codes_json`。合同激活项目分组使用 JSON 保存多条合同行和履约义务，导致：

- 无法用外键保证关联对象存在；
- 无法高效反向查询；
- 无法给每条合同行配置成本分摊；
- Finance 难以从 `project_code` 稳定归集到合同明细。

原则：

> JSON 保留为激活快照和兼容数据；结构化关系表成为主读与业务真值。

### 3.2 服务协议没有正式绑定维护项目

当前工单会在缺少明确 project 时，根据合同去 Aims 查询可用项目并启发式挑选。该策略在一个合同有多个运维、巡检、升级项目时存在歧义。

原则：

> 服务协议明确保存一个或多个服务项目关系，并支持唯一的当前默认项目；旧启发式仅作为存量兼容回退。

### 3.3 不能跨应用依赖本地 ID

现有部分 payload 同时包含 code 和 Altoc 本地 ID。短期不强行删除兼容字段，但新逻辑只能依赖 `_code`。

原则：

```text
应用内关系：本地 id
跨应用关系：tenant + object code
```

### 3.4 不提前建设 Console 中央关系库

关系的创建、变更和终止发生在业务应用中，应由 Altoc 保存其主责关系。Console 以后可以建立只读索引，但当前不应成为合同、项目或工单的运行时依赖。

---

## 4. Goal 1：履约关系结构化收口

### 4.1 建议表结构

具体字段类型应由 Codex按现有 schema 约定适配。

#### `contract_project_line_rel`

```sql
contract_project_line_rel
-------------------------
id
contract_project_link_id
contract_line_id
relation_type
allocation_method
allocation_ratio
allocated_amount
planned_workdays
created_at / created_by
updated_at / updated_by
deleted_at
```

作用：

- 结构化表示一个 Aims 项目对应哪些合同行；
- 保存后续成本归集所需的分摊方法；
- 支持按 project 和 contract line 双向查询。

建议唯一键：

```text
contract_project_link_id + contract_line_id + relation_type
```

#### `contract_project_obligation_rel`

```sql
contract_project_obligation_rel
-------------------------------
id
contract_project_link_id
obligation_id
created_at / created_by
updated_at / updated_by
deleted_at
```

建议唯一键：

```text
contract_project_link_id + obligation_id
```

#### `service_agreement_project_rel`

```sql
service_agreement_project_rel
-----------------------------
id
service_agreement_id
project_code
project_role
is_default
effective_from
effective_to
status
source_type
created_at / created_by
updated_at / updated_by
deleted_at
```

作用：

- 明确年度维保协议、质保权益或支持协议对应哪个 Aims 服务项目；
- 支持日常运维、巡检、升级、专项等多个项目；
- 同一时点只允许一个默认项目。

### 4.2 兼容策略

采用“建新表—回填—双写—新读优先—旧读回退”：

```text
第一步：新增表和索引
第二步：从直接 ID 与 JSON 回填
第三步：所有新写同时写结构化关系和 JSON 快照
第四步：读取优先关系表，空时回退 JSON
第五步：观察稳定后再考虑取消 JSON 业务依赖
```

本阶段不删除旧字段。

### 4.3 服务工单项目解析顺序

```text
显式 project_code
  > 工单已保存 project_code
  > service_agreement 当前默认项目
  > 旧合同项目启发式
  > 返回无法唯一解析
```

成功后把最终 `project_code` 固化到工单，保证后续重试一致。

### 4.4 成本归集准备

Goal 1 不同步实际成本，但必须支持：

```text
project_code
  -> contract_project_link
  -> contract_project_line_rel
  -> contract_line
  -> contract
  -> customer
```

分摊字段先进入关系表：

- `unallocated`
- `direct`
- `ratio`
- `amount`
- `workdays`

这样 Goal 4 接入 Finance 时，不需要再次重构关系模型。

---

## 5. Goal 2：交付环境覆盖身份收口

在 Goal 1 稳定后执行。

### 目标

避免 `service_agreement_asset.delivery_asset_code` 同时承载计划编号、待创建编号、旧交付编号和 Assets 正式编号。

### Codex 执行前必须先确认

1. Assets 当前正式主对象是什么：
   - customer delivery asset
   - environment
   - asset
2. 哪个 `_code` 是正式且不可变的跨应用标识。
3. `environment_code` 是否已经是独立持久化对象，而不是项目激活 payload 中的可选字段。

### 推荐结果

如果 Assets 已有正式 `environment_code`：

```text
service_agreement_coverage
  -> environment_code
  -> optional asset_code
  -> source_plan_code
```

如果 Assets 目前只有正式 `delivery_asset_code`：

```text
service_agreement_coverage
  -> delivery_asset_code
  -> source_plan_code
  -> environment_code nullable
```

不要凭空创造一个没有主责系统的 environment code。

### 迁移方式

- 保留旧 `service_agreement_asset` 兼容读取；
- 新增清晰的 source plan 与 formal asset/environment 字段或新 coverage 表；
- Assets 回写正式 code 后原子升级 pending coverage；
- 防止同一协议对同一正式环境重复覆盖；
- 不把 Altoc 计划 code 当作长期维保正式键。

---

## 6. Goal 3：维保模型与额度账收口

### 6.1 新旧模型

目标主链：

```text
contract
  -> contract_line
      -> service_agreement
          -> coverage
          -> service project
```

旧表：

- `maintenance_contract`
- `service_entitlement`

处理原则：

1. 停止新业务写旧表；
2. 旧 API 改为新模型读取或兼容视图；
3. 保留存量回填与核对；
4. 经过观察期后再考虑删除，不在首次改造中 drop。

### 6.2 服务额度流水

新增：

```sql
service_quota_ledger
--------------------
id
service_agreement_id
ticket_code
work_item_code
entry_type
quantity
idempotency_key
occurred_at
created_by
```

类型：

- `grant`
- `consume`
- `reverse`
- `adjust`

`service_agreement.consumed_quota` 可保留为缓存，但应能从 ledger 重算。工单撤销或改单通过冲销，不直接覆盖历史。

---

## 7. Goal 4：实际成本归集

### 7.1 主责边界

- Aims：工时及项目执行事实；
- People：人员成本费率；
- Finance：成本计算和分配主账；
- Altoc：商业归属和经营分析维度。

Altoc 不保存每笔工时副本。

### 7.2 归集路径

```text
Aims approved worklog
  -> Finance labor cost
  -> project_code
  -> Altoc contract_project_line_rel
  -> contract_line
  -> contract
  -> customer
```

维保路径：

```text
service ticket
  -> service_agreement
  -> default/selected service project
  -> Aims work item and worklog
  -> Finance cost
  -> maintenance contract line
```

### 7.3 多合同行项目的分摊

按关系表的 `allocation_method`：

- `direct`：任务/成本明确归属单条合同行；
- `ratio`：按比例；
- `amount`：按预算金额；
- `workdays`：按计划人天；
- `unallocated`：进入待分配队列，不得悄悄平均。

### 7.4 Altoc 可选只读投影

只有在经营页面有明确消费者时再增加：

```sql
contract_line_cost_summary
--------------------------
contract_line_id
project_code
accounting_period
labor_cost
outsourcing_cost
travel_cost
other_direct_cost
source_version
synced_at
```

它是 Finance 结果投影，不是成本主账。

---

## 8. 分 PR 建议

### PR 1：表、回填与新读

- 新增三张关系表；
- 回填 JSON 和直接 ID；
- 更新 schema 文档；
- data-runtime 读取优先新表、回退 JSON；
- 添加迁移和读取测试。

### PR 2：新写与激活幂等

- 合同激活和绑定已有项目双写结构化关系；
- 重试不重复；
- 暴露 project → contract line 查询；
- 补合同激活测试。

### PR 3：服务协议默认项目

- 服务协议项目关系 API；
- 唯一默认约束；
- 工单项目解析顺序改造；
- 并发与幂等测试。

也可以由 Codex 在一个 Goal 中完成三个逻辑提交，但代码审查时仍应按以上结构组织。

---

## 9. 验收清单

- [ ] 一个合同的三条合同行可拆到两个项目。
- [ ] 一个项目可关联多条合同行。
- [ ] 可按 project_code 反查合同行和分摊信息。
- [ ] JSON 仍保留，但新读不依赖 JSON。
- [ ] 旧 JSON 数据可幂等回填。
- [ ] 激活/重试不产生重复关系。
- [ ] 服务协议可绑定多个项目和一个默认项目。
- [ ] 工单优先进入协议默认项目。
- [ ] 显式指定项目仍优先。
- [ ] 多默认数据异常不会被随机掩盖。
- [ ] Console 不可用不影响流程。
- [ ] Nuxt/BFF 没有直接访问 MySQL。
- [ ] 跨应用新逻辑只依赖 `_code`。
- [ ] 旧表和旧 API 未被破坏。
- [ ] Altoc lint/typecheck/test 与 data-runtime Go tests 通过。

---

## 10. 可直接提交给 Codex 的 Goal

请使用同目录文件：

`altoc_codex_goal_prompt.txt`

该提示词已把 Goal 1 的范围、边界、任务、测试和验收条件写成可执行格式。建议先让 Codex 完成 Goal 1 并提交审查，再继续 Goal 2–4。
