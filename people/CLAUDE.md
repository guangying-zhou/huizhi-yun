# People 模块

> 业务模块 — 人员事实、任职、成本快照与项目贡献绩效 | 端口 3007 | 状态：Phase 3 MVP 初始实现 | 数据库：tenant-runtime 托管（默认 hzy_people）
>
> Schema：[`docs/people_schema.sql`](./docs/people_schema.sql)
> API：[`docs/PEOPLE_API_SPEC.md`](./docs/PEOPLE_API_SPEC.md)

## 职责边界

**负责**：员工最小事实、岗位/职级字典、M/P 职级设置（职级工资、绩效工资范围）、任职历史、月度人员成本快照、项目贡献快照、个人绩效周期、绩效基础、评分/确认结果、Codocs 文档引用。

**不负责**：完整 HRM 套件、招聘、薪酬发放、社保个税、考勤排班、项目执行事实、文档正文、财务核算、提成/奖金/绩效金额财务核算和审批引擎。

## 依赖模块

- **Console Directory / Settings / Foundation**：用户、部门、项目注册表、系统参数、登录鉴权和业务授权消费；职级设置页读取 Console 系统参数确定 M/P 序列数量。People 不读取本地 policy bundle，权限快照和 scoped authorization 只经 Foundation/Console。
- **Aims**：项目参与、任务、工时和贡献来源；People 只固化快照。
- **Codocs**：岗位说明、绩效说明、复盘报告等文档正文；People 只保存 `document_uuid`。
- **Workflow**：员工入职、任职变更、成本调整、绩效周期确认审批。
- **Finance**：提供人力成本计算参数（基本工资、福利费率、管理分摊系数、固定资源分摊），读取 People 人员成本和项目人力成本摘要；向 People 提供项目财务指标、绩效金额/提成奖金等财务口径快照。People 不维护财务总账、财务明细或人力成本费率参数。

## 数据库与运行时

People 应用自身不得直连 MySQL，也不配置 `DB_*` / `runtimeConfig.db`。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。

如业务接口缺失，应优先补 `data-runtime/internal/apps/people` adapter，不允许恢复本地 repository、DB fallback 或跨模块数据库访问。

`docs/people_schema.sql` 只包含生产 schema、基础字典和 M/P 职级设置基线；本地演示数据在 `docs/people_demo_seed.sql`，不得混入生产初始化脚本。已执行旧版 schema 的租户库执行 `docs/people_standard_cost_incremental.sql`，不需要删库重建。职级成本公式所需参数在 Finance 执行 `docs/finance_people_cost_parameter_incremental.sql` 后维护；M/P 职级数量在 Console 执行根目录 `docs/Console-SQL-Seed-v1.22-people-rank-settings.sql` 后维护。

生产切换期可通过 `POST /api/admin/directory-sync/import` 从 Console Directory 初始化 People 员工事实。该接口只做服务端编排：校验 People 权限、读取 Console Directory、再调用 data-runtime `POST /v1/people/service/directory-users:sync`。正常运营期的入职、调岗、离职事实应先在 People 落地，再按 People → Console Directory 契约投影账号和部门关系；员工状态设为 `left` / `inactive` 或任职调整“离职”时，People BFF 会调用 Console service endpoint 停用对应登录账号。

Cloudflare 部署固定使用 `managed-cloud-agent`，配置由 `scripts/render-cloudflare-config.mjs` 生成，不允许新增 `DB_*` vars、Hyperdrive 绑定或租户域名写死到共享 Worker。部署细节见 `deploy/cloudflare/README.md`。

## 开发注意

- 跨模块引用只保存稳定业务键：`employee_uid`、`dept_code`、`project_code`、`cycle_code`、`document_uuid`。
- `people_contribution_snapshots` 必须保留 `source_app`、`source_biz_type`、`source_biz_id` 和 `source_refs`，便于个人绩效周期追溯到 Aims 等来源系统；该表不作为 Finance 项目成本核算主输入。
- `people_standard_cost_rates` 是项目人力标准成本测算的前置主数据，当前只作为 M/P 职级设置表使用，维护职级工资和绩效工资范围；M/P 职级数量来自 Console 系统参数；基本工资、福利费率、管理分摊系数和固定资源分摊由 Finance 参数 API 提供。
- Finance 项目核算通过 `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` 读取员工有效职级和职级设置，再结合 Aims 月度工时与 Finance 人力成本参数计算标准成本；People 不返回项目成本分摊结果。
- 月度成本快照由 People BFF `POST /api/admin/cost-snapshots/generate` 编排：先读取 Finance `GET /api/v1/finance/service/people-cost-parameters`，再调用 data-runtime `POST /v1/people/service/cost-snapshots:generate` 按公式固化。
- 绩效周期贡献汇集由 People BFF `POST /api/admin/performance-cycles/{cycleCode}/collect` 编排：校验 `performance_cycles/edit` 后按周期 `project_code` 读取 Aims 项目与工时事实，再调用 People data-runtime `POST /v1/people/service/contributions:sync` 固化贡献快照。该路径需要 Console 执行根目录 `docs/Console-SQL-Seed-v1.24-people-aims-contribution-grants.sql`，授予 People runtime `aims:read`。
- 绩效周期确认/关闭由 People BFF `POST /api/admin/performance-cycles/{cycleCode}/confirm|close` 编排，调用 data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:confirm|close` 更新周期状态；确认周期会同步固化贡献快照 `confirmed_at`。
- 绩效周期详情由 People BFF `GET /api/admin/performance-amounts` 读取 Finance `GET /api/v1/finance/service/performance-amounts` 展示绩效金额财务口径快照；People 只引用金额依据，不写 Finance，也不把 Finance 状态当作 People 绩效终态。
- 成本快照和绩效周期是 People 侧历史固化事实，分别服务成本留档和个人绩效考核；Finance 项目成本核算只消费员工职级、职级设置和 Aims 工时，不依赖绩效周期。
- 数据结构变更必须同步更新 `docs/people_schema.sql`。
