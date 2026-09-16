# 跨模块 / 租户运维 SQL

这里只放**不归属任何单一模块**的脚本：针对具体租户的一次性整改，或同时跨 Console 与
Platform 的生产修复。模块自有的 DDL、迁移与 Seed 分别在 `console/docs/sql/`、
`platform/docs/sql/` 以及各业务模块的 `docs/` 下。

| 文件 | 说明 |
| --- | --- |
| `Wiztek-角色权限整改-2026-07-16.sql` | Wiztek 租户角色权限整改，配套 `../Wiztek角色权限逐项审计-2026-07-16.md` |
| `migration_prod_service_client_grants_last_used_at.sql` | 生产库 service client grant 增补 `last_used_at` |
| `migration_prod_integration_operation_dead_letter_actionable_aims_altoc.sql` | 生产库 Aims/Altoc 集成任务死信可处置化 |

一次性生产脚本执行后请在提交信息或 runbook 中记录执行时间与目标环境。
