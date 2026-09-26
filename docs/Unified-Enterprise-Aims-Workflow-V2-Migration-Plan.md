# 统一库 Aims V2 工作项流程加法迁移计划

## 适用边界

统一 Runtime 的工作项状态命令按 `work_items.tier`（`target` / `matter`）查询 `aims_workflow_transitions`。早期统一影子复制保留了 Aims 源表的旧 `entity_type ENUM('project','milestone','requirement','task','bug')`；随后业务数据导入还明确跳过三张 workflow 表。因此旧规则存在并不代表 V2 状态命令可用。C000001 只读基线（2026-09-25）为旧状态目录 22 行、旧转换规则 28 行，`target/matter` 均 0；历史复制来源见[统一迁移计划](../deploy/test-env/artifacts/C000001.enterprise-migration-plan.json)，导入跳过原因见[导入回执](../deploy/test-env/artifacts/C000001.production-business-import.json)。其它租户需逐一 plan，不能从 C000001 推断。

本迁移只改统一库物理表 `aims_workflow_status_catalog` 与 `aims_workflow_transitions`：两列 `entity_type` 的 ENUM **在末尾增加** `target,matter`；保留全部旧成员、旧行、项目专属规则、ID 和外键；安装 V2 官方默认状态 9 条，以及 `migration_v2_status_model.sql` 的 11 条默认转换加 `migration_v2.3_allow_reset_to_todo.sql` 的 2 条 reset。`work_items`、`work_item_status_catalog`、旧规则、业务数据、grant、策略与授权不变。它是现有统一库的加法修复，不是对统一库直接执行硬编码 `USE hzy_aims` 且会删改旧行的原始 V2 SQL。

## 计划、备份与安装

实现：[受控迁移程序](../deploy/test-env/enterprise-aims-workflow-v2.mjs)。从已保护的本地 Runtime 配置读取明确 tenant/deployment/环境/generation/数据库/实例绑定；默认使用 Runtime 只读连接产生计划。计划核验两张表列类型、两个复合外键、已存在 V2 行的精确形状、旧行摘要，并输出绑定身份的 review hash。`--apply` 另需匹配的 hash、已存在的受保护备份文件，以及**独立的 0600 迁移账号配置**（JSON MySQL 连接字段）；Runtime 日常 DML 账号不授 ALTER。迁移连接须与 Runtime 绑定同库、同 MySQL server UUID。程序用单库 advisory lock、防计划漂移检查，变更后再查列类型、9/13 条 V2 数据及旧行摘要；重复执行只作缺失项补齐，既有旧行不变。程序不处理源库、不更改租户 registry/generation 或路由。配置和凭据不得写入计划/日志。

在**已批准的指定租户维护窗口**：停止相关写流量、排空在途任务；确认实际物理库/tenant/Runtime deployment/generation 与工单一致，先对该统一库作加密备份并验证可恢复，再运行：

```sh
node deploy/test-env/enterprise-aims-workflow-v2.mjs \
  --config <受保护的Runtime配置路径> --tenant <租户> --database <统一库>
node deploy/test-env/enterprise-aims-workflow-v2.mjs \
  --config <同一配置路径> --tenant <同一租户> --database <同一统一库> \
  --apply --review-hash <已复核的计划hash> --backup <已验证的加密备份路径> \
  --migration-db-config <受保护的迁移账号JSON路径>
```

完整影子复制场景：先按 [统一切换手册](./Unified-Enterprise-Cutover-Runbook.md) 完成来源/目标逐表一致性对账与 `hzy-enterprise-migrate` 自身的 verified-shadow 检查，再在目标库安装本加法迁移并记录**独立的**计划/hash/行数/旧行摘要；之后才进入 V2 工作项状态能力的租户激活/路由开放。加法迁移会让两张规则表与源端的逐表字节 hash 有预期差异，不能拿原复制 hash 对迁移后的规则表重新断言零差异，也不能悄悄改写既有影子复制计划及激活回执。其它业务表仍须与最终复制基线一致。若源端已是新 ENUM/规则，plan 应报告现有 V2 项，apply 只补缺项。

已激活租户场景（如 C000001）：只在独立环境批准后维护窗口安装，记录前后 schema 与全局规则数量，先以标记对象做 start 正例、旧版本 409、reset/reopen（涉及的状态按正式权限和页面可达性执行），再开放对应状态操作。非事务性 DDL 任一步失败须停止写流量并保留备份/当前状态供审查；不能假设自动回滚，也不自行重放不匹配的计划。旧行摘要不一致或非预期 FK/schema 差异均为停止条件。旧版本 Runtime 回滚前须确认它是否依赖旧 ENUM 形状；不能只回滚二进制却把已变更的库当成旧快照。

## 隔离演练与验收

- `node deploy/test-env/test/enterprise-aims-workflow-v2.test.mjs`：在 `/tmp` 一次性 MySQL 建旧 ENUM/FK/旧规则，错误 hash 拒绝，真实 DDL + seed 后精确 9/13、start/reset/reopen 各 1 条、旧行摘要与数量不变，第二次 apply 不重复；结束删除临时库与实例。
- `node data-runtime/scripts/test-enterprise-project-members-mysql.mjs`：同样的隔离 MySQL harness，以 canonical schema 建表并由真实 Runtime adapter 对标记 fixture 执行 todo→in_progress、reset、reopen，旧 editVersion 返回 `409 work_item_version_conflict`。这验证业务命令合同；生产/测试租户的页面正例须在获批准安装后另做。

历史复制计划 `deploy/test-env/artifacts/C000001.enterprise-migration-plan.json` 与激活回执保持原样，作为当时旧 ENUM 来源结构的真实证据；本文件是此后 V2 规则的单独安装计划。
