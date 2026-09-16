# People 模块

> 业务模块 — 人员事实、任职、成本快照与项目贡献绩效 | 端口 3007 | 状态：Phase 3 MVP 初始实现 | 数据库：tenant-runtime 托管（默认 hzy_people）
>
> Schema：[`docs/people_schema.sql`](./docs/people_schema.sql)
> API：[`docs/PEOPLE_API_SPEC.md`](./docs/PEOPLE_API_SPEC.md)

## 职责边界

**负责**：员工最小事实、钉钉 HR 事实源入口与部门映射决策、岗位/职级字典、M/P 职级设置（职级工资、绩效工资范围）、任职历史、月度人员成本快照、项目贡献快照、个人绩效周期、绩效基础、评分/确认结果、Codocs 文档引用。

**不负责**：完整 HRM 套件、招聘、薪酬发放、社保个税、考勤排班、项目执行事实、文档正文、财务核算、提成/奖金/绩效金额财务核算和审批引擎。

## 依赖模块

- **Console Directory / Settings / Foundation**：用户、部门、项目注册表、系统参数、登录鉴权和业务授权消费；职级设置页读取 Console 系统参数确定 M/P 序列数量。People 不读取本地 policy bundle，权限快照和 scoped authorization 只经 Foundation/Console。
- **Aims**：项目参与、任务、工时和贡献来源；People 只固化快照。
- **Codocs**：岗位说明、绩效说明、复盘报告等文档正文；People 只保存 `document_uuid`。
- **Workflow**：员工入职、任职变更、成本调整、绩效周期确认审批。
- **Finance**：提供人力成本计算参数（基本工资、福利费率、管理分摊系数、固定资源分摊），读取 People 人员成本和项目人力成本摘要；向 People 提供项目财务指标、绩效金额/提成奖金等财务口径快照。People 不维护财务总账、财务明细或人力成本费率参数。

## 数据库与运行时

People 应用自身不得直连 MySQL，也不配置 `DB_*` / `runtimeConfig.db`。所有 `/api/v1/**` 业务数据读写必须通过 `server/middleware/tenant-runtime.ts` 代理到 tenant-runtime/data-runtime，由 runtime 侧执行数据库操作。
跨应用 service 入口的 token introspection 只有明确 inactive/revoked/invalid 才返回 401；Console introspection 网络、5xx 或存储故障必须在读取业务 body、调用 handler 或 tenant-runtime mutation 前返回可重试 503。

如业务接口缺失，应优先补 `data-runtime/internal/apps/people` adapter，不允许恢复本地 repository、DB fallback 或跨模块数据库访问。

`docs/people_schema.sql` 只包含生产 schema、基础字典和 M/P 职级设置基线；本地演示数据在 `docs/people_demo_seed.sql`，不得混入生产初始化脚本。已执行旧版 schema 的租户库执行 `docs/people_standard_cost_incremental.sql`，并执行 `docs/migrations/20260829_rank_series.sql` 补齐职级专业/管理类型，不需要删库重建。职级成本公式所需参数在 Finance 执行 `docs/finance_people_cost_parameter_incremental.sql` 后维护；M/P 职级数量在 Console 执行根目录 `console/docs/sql/Console-SQL-Seed-v1.22-people-rank-settings.sql` 后维护。

生产切换期可通过 `POST /api/admin/directory-sync/import` 从 Console Directory 初始化 People 员工事实。正常运营期入转调离只先写 People；钉钉被配置为 HR 事实源时，Connector 也必须先写 People 员工/任职事实，离职只接受钉钉 HR 离职接口的明确状态和最后工作日，不得用通讯录缺失推断。data-runtime 在 employee 或已批准且已生效 assignment mutation 的同一事务重读 canonical facts、锁定 employee、推进 `people_directory_lifecycle_versions` 并冻结 caller-owned operation。未来生效 assignment 不得提前投影；专属 Worker 的默认关闭 scheduled task，或共享 Worker 的 Tenant Gateway 受信 scheduler wake，先以本轮固定 RFC3339 `asOf` 有界分页调用 `POST /v1/people/service/directory-lifecycle:prepare-due`，再 drain allowlisted family。共享 wake 必须把 tenant、People source deployment、Runtime endpoint 和 Console target deployment 绑定进 Gateway HMAC，不得从普通 HTTP body 获取。BFF 不再从浏览器 body 推导投影，也不直接写 Console；旧 `/api/admin/directory-users/{uid}/disable` 旁路返回 410。固定 dispatcher 使用 `aud=console` 和精确 lifecycle capability；HMAC 必须绑定 header/envelope/token actor 的 source deployment，以及可信 Console target deployment 与 Console 本地 binding。有效 Console succeeded receipt 立即完成 People→Console operation；下一跳 Platform pending 只保留为链路状态并让即时两跳响应返回 202，不得制造 People 重试。`HZY_PEOPLE_DIRECTORY_LIFECYCLE_SYNC_ENABLED` 仍只控制专属 Worker 自有 cron。

钉钉组织同步的用户入口固定为 People `设置 / 人事事实源`，权限资源为 `hr_source_sync:view|execute|admin`，默认只建议授予 `people:admin`。钉钉只接管正式行政部门、人员主归属和在离职状态；委员会、虚拟组织、项目组及稳定 `dept_code` 仍由汇智云维护。首次切换先通过 Console `directory_department_identities` / `directory_department_aliases` 归并旧 `DT-*` 部门，再事务改写 People 员工与任职引用；People 不保存钉钉 secret，也不直连 Console 数据库。只有 final marker、根部门、计数和快照 hash 全部验证通过才冻结缺失差异；所有停用都要求 `hr_source_sync:admin` 逐项确认，并在应用时重新检查活跃主归属和子部门，绝不因一次缺失自动停用。

Cloudflare 部署固定使用 `managed-cloud-agent`，配置由 `scripts/render-cloudflare-config.mjs` 生成，不允许新增 `DB_*` vars、Hyperdrive 绑定或租户域名写死到共享 Worker。部署细节见 `deploy/cloudflare/README.md`。

离职交接/资产回收协调到期通知由 People scheduled task 通过 tenant-runtime 扫描；`HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED` 默认关闭。通知只投递给 runtime 明确返回且 Directory 当前 active 的任务责任人，descriptor 固定为 `offboarding_task/taskCode`，详情必须经 Console → People BFF → People runtime 实时重鉴权。发布前还必须通过 Console subject eligibility 校验固定目的 `offboarding_tasks:view`；拒绝、inactive 或资格服务不可用时不得发布、不得 ack，保留候选重试。Cloudflare 仅在显式启用并具有完整 runtime binding 与 People 专用 service client 时渲染 cron。

离职员工未归还资产由 People authoritative lifecycle 可靠投影到 Assets：People runtime 使用固定 `asOf`，仅选择当前 `left/inactive` 员工，或截至 `asOf` 最新一条已生效且 `approval_status IN ('none','approved')`、`change_type=leave` 的任职事实；未来日期、待审批/拒绝 leave，以及已被后续 onboard/transfer 覆盖的历史 leave 均不得投影。候选写入 People `integration_operation` 后，由 People BFF 使用 `aud=assets`、`assets:offboarding-recovery:sync` 和标准 service-command receipt 合同投递。`HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED` 默认关闭；该链路不读取 Console `inactive` 作为离职事实，也不复制 People 资产回收协调任务状态。

People integration-operation dead-letter actionable 只允许三条既有 caller-owned code：Directory → Console 的 `people.directory.employment-sync.v1` / `people.directory.offboarding-disable.v1`，以及 People → Assets 的 `people.offboarding.assets-recovery-sync.v1`。诊断、attempt、replay、candidate、publish/closure ACK 与 integration-operation notification detail 均在 runtime 按该 allowlist、可信 tenant/deployment/source binding 重新验证；不得让新 operation family 自动继承 Console actionable 或浏览器重放。source 保留 Console 实际收件人和 notification ID，success/replay 同事务生成 resolved/cancelled closure；People → Assets 资产回收协调事实与 Directory → Console lifecycle 仍彼此独立。

dead-letter 的发布/closure 是独立 scheduled drain（`integrations:dead-letter-notifications`），开关 `HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED` 默认关闭；每轮一个 generation、使用 People runtime binding 和 Console notification service token。不得把该 helper 放进 Directory 或 Assets claim loop：通知失败只能保留 source generation pending，不能改变 claim、业务事实或 receipt。现有业务 drains 保持其 25 秒 claim reserve。

## 开发注意

- 员工列表未选择部门时，不订阅部门树的异步加载结果，避免目录初始化触发内容相同的第二次员工搜索。员工数据范围与标准成本数据范围可并行读取，但必须分别保留结果并在全部完成后才转发 Runtime 请求；不得以并行为由省略、合并权限或吞掉授权错误。

- 跨模块引用只保存稳定业务键：`employee_uid`、`dept_code`、`project_code`、`cycle_code`、`document_uuid`。
- `people_contribution_snapshots` 必须保留 `source_app`、`source_biz_type`、`source_biz_id` 和 `source_refs`，便于个人绩效周期追溯到 Aims 等来源系统；该表不作为 Finance 项目成本核算主输入。
- `people_standard_cost_rates` 是项目人力标准成本测算的前置主数据，当前只作为 M/P 职级设置表使用，维护职级工资和绩效工资范围；M/P 职级数量来自 Console 系统参数；基本工资、福利费率、管理分摊系数和固定资源分摊由 Finance 参数 API 提供。
- Finance 项目核算通过 `GET /v1/people/service/standard-costs:resolve?employee_uids=&effective_date=` 读取员工查询日期有效、`is_primary=1` 且已批准/无需审批的主任职和职级设置，再结合 Aims 月度工时与 Finance 人力成本参数计算标准成本；People 不返回项目成本分摊结果。缺失用户 scope 的 data-runtime 用户读取必须失败关闭，不得解释为全量访问。
- 月度成本快照由 People BFF `POST /api/admin/cost-snapshots/generate` 编排：先读取 Finance `GET /api/v1/finance/service/people-cost-parameters`，再调用 data-runtime `POST /v1/people/service/cost-snapshots:generate` 按公式固化；生成器以月份末日解析有效主任职，并冻结 assignment、部门、岗位和职级快照，后续调岗调级不得改变历史快照。
- 绩效周期贡献汇集由 People BFF `POST /api/admin/performance-cycles/{cycleCode}/collect` 编排：校验 `performance_cycles/edit` 后按周期 `project_code` 完整读取 Aims 项目与工时事实，只纳入 `review_status=approved` 的工时，再以 `sync_mode=replace_scope + snapshot_complete=true` 调用 People data-runtime `POST /v1/people/service/contributions:sync` 固化完整贡献快照。新快照固定 `score_status=unscored`、`contribution_score=NULL`，不得用 0 或 80 代替；data-runtime 在周期行锁事务内 upsert 当前集合并删除该项目/周期/来源范围内已消失的成员，空集合也会清理旧快照；不完整分页、坏工时行和来源范围不一致必须在替换前失败。该路径需要 Console 执行根目录 `console/docs/sql/Console-SQL-Seed-v1.24-people-aims-contribution-grants.sql`，授予 People runtime `aims:read`。
- Aims 主动推送贡献使用固定 `aims.people-contributions.replace-scope.v1` service-command envelope，只冻结期间内已审核工时并保持既有 `source_biz_type=time_entries` 范围以替换清理旧快照。People 在同一周期行锁事务中重算剔除版本字段后的规范化快照 hash、执行完整范围替换、推进 `people_contribution_scope_versions` 水位并写 succeeded `service_command_receipt`；低版本乱序到达返回成功的 `staleSkipped` 且零业务 mutation，同版本同 hash 幂等返回，同版本异 hash 返回 409。confirmed/closed 周期仍在任何版本判断前拒绝写入。
- People 可使用 v1.91 精确授权调用 Aims `GET /api/v1/service/project-management-facts`，按全局单调 revision 增量读取公司周报发布后形成的版本化项目管理事实。People 必须保留 `correctionOfId/sourceRefs/sourceSha256` 追溯；首期不据此自动评分。
- 绩效周期确认/关闭由 People BFF `POST /api/admin/performance-cycles/{cycleCode}/confirm|close` 编排，调用 data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:confirm|close` 更新周期状态；确认周期、贡献 `confirmed_at` 和 Workflow 批准使用同一周期行锁事务。通用 `contribution-snapshots` REST 只读，不得绕过 service sync 修改 confirmed/closed 快照。
- 绩效周期详情由 People BFF `GET /api/admin/performance-amounts` 读取 Finance `GET /api/v1/finance/service/performance-amounts` 展示绩效金额财务口径快照；People 只引用金额依据，不写 Finance，也不把 Finance 状态当作 People 绩效终态。
- 成本快照和绩效周期是 People 侧历史固化事实，分别服务成本留档和个人绩效考核；Finance 项目成本核算只消费员工职级、职级设置和 Aims 工时，不依赖绩效周期。
- 数据结构变更必须同步更新 `docs/people_schema.sql`。
