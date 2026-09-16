# Console SQL Scripts

针对 `hzy_console` 数据库的 DDL、迁移、Seed 与核验脚本。原先散落在仓库根 `docs/`，
现按归属收敛到本目录。文件名保持不变，历史文档与 Runbook 中的脚本名可直接检索。

## 命名约定

| 前缀 | 用途 |
| --- | --- |
| `Console-SQL-DDL-Draft-*` | 基线 DDL 草案 |
| `Console-SQL-Migration-v*` | 结构迁移，按版本号顺序执行 |
| `Console-SQL-Seed-v*` | 初始化数据，主要是 service client grant 与集成配置 |
| `Console-SQL-Verify-v*` | 对应 Seed 的核验查询，发布前在目标租户执行 |

`Console-SQL-Verify-grant-dump.sql`、`Console-SQL-Verify-orphan-grants.sql`、
`Console-SQL-Verify-service-grant-coverage.sql` 是不绑定版本的通用授权巡检脚本。

## 使用提醒

- Seed 只用于初始化授权记录，不是第二套授权事实源；授权事实源见
  `../../../docs/MODULE_CONTRACTS.md` 与各应用 manifest。
- 发布前必须在目标租户执行对应 Verify，并用实际 service client 对全部组合 scope
  做令牌签发探测；只验证 SQL 行存在不足以证明授权完成。
- WebDev 托管运行时身份由
  `Console-SQL-Seed-v2.0-webdev-runtime-identity.sql` 初始化，并用同版本 Verify
  核验；该 Seed 只创建不可用的 env-ref 占位 credential，不生成或分发长期 secret。
