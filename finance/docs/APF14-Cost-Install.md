# APF-14a B4 项目成本候选

仅交付，不执行。固定 DDL 为 `apf14a_schema_candidate.sql`，内嵌 `data-runtime/internal/enterprise/domaininstall/finance_cost.json`。前置 Finance B1→B3→13a→13b；六张新表，无视图，不覆盖旧库/旧表，不启用 write/scheduler。

备份统一库/config/Registry并隔离恢复验证；WithFinanceCost(currentBinding) → ForFinanceCost(reviewed Expectation) → PlanInstall → 私有0600 plan/candidate → 审查 plan.ReviewHash → 停止Runtime的真实证明 → Apply逐项checkpoint → Verify/VerifyReceipt。generation/schemaVersion和其他域不变。没有额外 Console grant seed：复用v2.34固定Finance Host通道，人员权限复用project_accounting。当前通用APF CLI不支持该增量，不能虚构--finance-cost参数或直接执行SQL替代reviewHash。

Verify SQL候选在 `sql/apf14a-verify-candidate.sql`；rollback候选在 `sql/apf14a-rollback-candidate.md`。有业务数据/审计/回执、外部FK、结构/基线/代次漂移则拒绝自动回滚。14a只冻结schema和typed读合同，SQL owning读取、共享Tx重算、fixed operation注册在14b；Host页面在14c。14b批准前不宣称成本操作已可调用。
