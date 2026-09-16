# P3 / P4 跨模块演示数据包

本目录提供六个业务库各自独立、可重复执行的演示数据脚本。`manifest.json` 是根编排器使用的机读索引；顶层 `seed.sql`、`verify.sql`、`cleanup.sql` 是 fail-fast 入口，会主动报错，禁止把它们当成跨库脚本执行。

## 固定业务键

所有可读业务编码使用 `DEMO-P3P4-202607-*` 前缀。Codocs UUID 遵循 RFC UUID 格式，并通过文档标题、OSS 路径和上下文中的演示标记安全识别。核心引用如下：

| 对象 | 固定键 |
| --- | --- |
| 员工 | `DEMO-P3P4-202607-EMP` |
| 项目 | `DEMO-P3P4-202607-PROJ` |
| Aims 源任务 | `DEMO-P3P4-202607-G23-TASK` |
| 客户 | `DEMO-P3P4-202607-CUST` |
| 合同 | `DEMO-P3P4-202607-CT` |
| 维保合同 | `DEMO-P3P4-202607-MC` |
| 服务协议 | `DEMO-P3P4-202607-SA` |
| 服务工单 | `DEMO-P3P4-202607-ST` |
| 交付视图 | `DEMO-P3P4-202607-DLV` |
| 交付资产 | `DEMO-P3P4-202607-CDA` |
| 环境 | `DEMO-P3P4-202607-ENV` |
| 运维知识文档 UUID | `d3a4c000-2026-4701-8000-000000000001` |
| 验收月份 | `2026-07` |

## 执行原则

- 每个子脚本都不包含 `USE hzy_*`，必须由执行者连接到该模块实际配置的数据库。
- 每个 seed / cleanup 自带独立事务；不关闭外键、不使用 `TRUNCATE`，父子记录通过稳定业务键解析本库 ID。
- seed 只准备源事实和验收前置，包括 G2-3 的 Aims 里程碑、源任务和挂接该任务的期间工时；不直接写入 People 贡献同步、Finance 项目人力成本重算、Altoc → Aims 工单回流或 Codocs 运维知识关联等派生结果。
- verify 的 `precondition` 行应在 seed 后为 `PASS`；`e2e_result` 行需要执行对应 API 后才会由 `FAIL` 变为 `PASS`，这用于证明结果不是 SQL 预埋。编排器会严格解析 MySQL TSV 输出，并按 manifest 的 `expectedCheckCodes` 拒绝任一 `FAIL`、缺失、重复或意外检查项；因此 seed 后的首次 verify 预期以非零状态结束，API 闭环完成后的 verify 才应整体通过。
- 建议通过受控数据库账号执行；不要把数据库密码写入命令历史或仓库。

外部前置条件：目标 Console Directory 中需存在 active 用户 `DEMO-P3P4-202607-EMP`，且 Console 2026-07 工作日历必须能返回大于 0 的月标准工时。Codocs seed 只创建文档元数据；若验收需要打开正文，应通过 Codocs 正常写入链路创建对应 OSS 内容。

## 安全编排器

根脚本默认只打印计划，不连接数据库：

```bash
pnpm demo:p3-p4:seed
pnpm demo:p3-p4:verify
pnpm demo:p3-p4:cleanup
```

执行前为每个模块设置 `HZY_DEMO_<APP>_MYSQL_DATABASE`，并优先配置 MySQL login path：

```bash
export HZY_DEMO_PEOPLE_MYSQL_LOGIN_PATH=hzy-demo-people
export HZY_DEMO_PEOPLE_MYSQL_DATABASE=hzy_people
pnpm demo:p3-p4:seed -- --apply
```

未使用 login path 时，可使用同前缀的 `HOST`、`PORT`、`USER`、`PASSWORD`、`SOCKET`。密码仅通过子进程 `MYSQL_PWD` 传递，不写入命令参数或 journal。实际执行会把不含凭据的 journal 写到 `build/release/p3-p4-demo-data/`；seed 中途失败时默认逆序清理已完成模块，只有显式 `--keep-partial` 才保留部分结果。

## Seed 顺序

分别连接六个模块的实际数据库，按以下顺序执行：

1. `codocs/seed.sql`
2. `people/seed.sql`
3. `aims/seed.sql`
4. `assets/seed.sql`
5. `altoc/seed.sql`
6. `finance/seed.sql`

编排器按 `manifest.json` 顺序逐库调用 MySQL CLI；不使用普通 SQL driver 执行包含 MySQL CLI 语法的迁移或演示脚本。

## API 验收阶段

seed 后应通过应用 API/页面完成以下动作，不应通过 SQL 补结果：

1. 在 Aims 对 `DEMO-P3P4-202607-PROJ`、周期 `DEMO-P3P4-202607-CYCLE` 执行 People 贡献同步；People verifier 应出现贡献快照。
2. 在 Finance 对该项目和 `2026-07` 执行项目人力成本同步/重算；Finance verifier 应出现 labor allocation 和项目财务汇总。
3. 在 Altoc 将 `DEMO-P3P4-202607-ST` 回流 Aims；Aims verifier 应出现 `altoc:service_ticket:DEMO-P3P4-202607-ST` 工作项及 service extension，Altoc verifier 应出现 Aims 引用。
4. 通过 Altoc `POST /api/v1/service-tickets/DEMO-P3P4-202607-ST/ops-knowledge` 只提交文档 UUID；Altoc 必须从 scoped dispatch context 解析客户、合同、项目、交付视图、正式交付资产和环境，先预留工单 UUID，再以同一幂等键调用 Codocs、Assets 并完成绑定。重放一次，Codocs 仍为六条非 ACL 关系，Assets 仍为一条文档索引和一次首次关联事件；换另一个 UUID 必须返回冲突且不得触达下游。
5. 在 Altoc 客户服务运营页读取 Assets 交付包与 Finance 维保财务摘要，确认 Assets 返回正式资产、正式环境关系和 UUID 文档但无正文；Finance `invoiceAmount` 必须为维保发票 `100000.00`，不得计入同客户负样本 `DEMO-P3P4-202607-NONMAINT-INV` 的 `900000.00`。Assets/Finance 404 必须表现为不可用错误而非成功空包。

第 1、2 步可使用根命令 `pnpm run accept:g2-3-labor-cost-loop`。该命令默认只打印零网络 preview；必须人工复核摘要后显式提供 `--execute --confirm <preview-sha256> --cookie-env <ENV_NAME>` 才会经 Tenant Gateway 各执行两次 Aims/Finance 同步。它不自动重试、回滚或清理，最终唯一性和金额仍由本目录严格 verifier 证明。

## Verify 与 Cleanup

verify 可在 seed 后和 API 验收后各执行一次。seed 后首次执行应保存失败 journal 作为“派生结果未预埋”的证据；API 验收后的第二次执行必须全部 `PASS`，否则编排器退出 1。cleanup 按以下逆序执行：

1. `finance/cleanup.sql`
2. `codocs/cleanup.sql`
3. `altoc/cleanup.sql`
4. `assets/cleanup.sql`
5. `aims/cleanup.sql`
6. `people/cleanup.sql`

cleanup 会同时删除由 API 基于演示稳定键产生的本库派生记录，但不会删除其他业务键的数据。
