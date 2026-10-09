# Platform SQL Scripts

针对 Platform 控制面数据库的 DDL、迁移、Seed 与核验脚本。原先散落在仓库根 `docs/`，
现按归属收敛到本目录，文件名保持不变。

## 命名约定

| 前缀 | 用途 |
| --- | --- |
| `HZY-Platform-SQL-DDL-Draft-v2.sql` | 当前基线 DDL（v1 已归档到 `../../../docs/archive/platform-v1/`） |
| `HZY-Platform-SQL-Migration-v2.*` | 结构迁移，按版本号顺序执行 |
| `HZY-Platform-SQL-Seed-v2.*` | 平台角色目录、应用角色与 scope 初始化 |
| `HZY-Platform-SQL-Verify-v2.*` | 对应 Seed 的核验查询 |
| `HZY-Platform-Seed-Plans-v2.3.sql` | 订阅计划种子数据 |

Schema 语义与 ERD 见同级 `../HZY-Platform-Schema-Draft-v2.md`、
`../HZY-Platform-Schema-Addendum-v2.*.md` 和 `../HZY-Platform-ERD-v2.md`。
