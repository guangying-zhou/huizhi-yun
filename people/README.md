# People - 汇智云人员模块

People 是汇智云的一体化运营人员事实源，负责员工最小事实、任职快照、月度人员成本快照、项目贡献快照和个人绩效主流程确认。

## 快速开始

```bash
pnpm install
pnpm --dir people dev
```

默认端口：`3007`，默认挂载路径：`/people/`。

## 数据访问

People 不直连 MySQL。所有 `/api/v1/**` 业务数据通过 tenant-runtime/data-runtime 代理访问，schema 见 [people_schema.sql](/Users/gavin/Dev/huizhi-yun/people/docs/people_schema.sql)。

生产初始化只执行 `docs/people_schema.sql`；本地演示数据按需执行 `docs/people_demo_seed.sql`。

启用 data-runtime：

```bash
HZY_PEOPLE_AGENT_ENABLED=true
HZY_PEOPLE_DB_NAME=hzy_people
```

## Console Directory 初始化

员工列表页提供“同步目录”操作，调用 `POST /api/admin/directory-sync/import` 从 Console Directory 导入当前企业活跃用户，并写入 People 员工事实和当前任职快照。该能力用于生产切换和目录校准；后续正常入转调离应在 People 形成事实后投影到 Console。

## Cloudflare 部署

People 的 Cloudflare Worker 配置由 `scripts/render-cloudflare-config.mjs` 生成，固定使用 `managed-cloud-agent`，不生成 `DB_*` 或 Hyperdrive 绑定。部署说明见 [deploy/cloudflare/README.md](/Users/gavin/Dev/huizhi-yun/people/deploy/cloudflare/README.md)。

## 职责边界

People 负责人员运营事实、成本快照、贡献快照和个人绩效主流程，不负责完整薪酬、社保、招聘、考勤、财务总账、提成/奖金/绩效金额财务核算或项目执行事实。项目任务和工时来自 Aims，文档正文来自 Codocs，审批流来自 Workflow，财务核算由 Finance 消费 People 的服务接口；Finance 的项目财务指标和绩效金额快照可回到 People 作为绩效依据。
