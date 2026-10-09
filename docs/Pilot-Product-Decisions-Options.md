# 试点收口：产品决策选项

状态：待产品负责人裁定；2026-09-27。本文只整理代码和现有证据，不授权初始化本机数据、变更项目可见性或修改 rollover 合同。三个决定相互独立，裁定后分别实施、验收。

## 1. 周报周期与应报清单

**当前事实。** 本机 `weekly_reporting_periods`、`weekly_report_obligations` 均为 0；`zhouguangying` 在项目 263 保存草稿返回 409 `weekly_report_obligation_required`，未产生草稿。现有生成命令要求当前项目总监或 `weekly_reports:configure`，读取 `weekly_reporting_settings`；`disabled` 不生成，`pilot` 按 `weekly_reporting_pilot_projects` 的生效区间选择项目，`company` 包含当周曾 active 的项目。生成在事务内按周期键复用周期并写义务，未冻结义务可重算负责人快照；过截止则冻结。责任人按有效代理优先、否则 `leader_uid`。配置、周期、义务各自有业务含义，不能为过关直接插 SQL。[契约](./MODULE_CONTRACTS.md#aims-项目责任与周报周期契约)；代码 `data-runtime/internal/apps/aims/project_governance_responsibility.go`、`project_weekly_report_governance.go`；[本机证据](./Unified-Enterprise-PA01-Scope-Enforcement.md#本机证据与未决决定)。

| 选项 | 做法与影响范围 | 风险与可撤路径 | 工作量 | 推荐 |
| --- | --- | --- | --- | --- |
| A. 仅项目 263 的单周期试点 | 由有权角色先核对时区、截止时间和 `rollout_mode=pilot`，将 263 置入试点有效区间，再通过正式生成入口仅生成指定未来/当前 `periodKey`；生成前后记录配置版本、目标项目及义务差集。只解锁 263 的草稿/提交验收。 | 生成会产生真实责任义务和提醒/汇总候选。撤回先停后续生成/提醒，逐一确认本次周期、义务和草稿/提交/汇总/审计引用；只有无任何下游引用且未冻结时，才可使用获批的精确清理流程。已有报告或冻结义务不得直接删，改为保留记录并标记试点证据。不能把配置改回 `disabled` 当成删除历史义务。 | 中：需试点成员、周期与回滚清单及正式权限操作。 | **推荐**，最小真实写链样本。 |
| B. 全公司初始化一个周期 | 配置 `company` 并生成指定周期，使所有当周曾 active 的项目形成应报义务。 | 影响全部项目负责人和提醒/汇总；责任快照、截止冻结及历史记录使撤销成本高，需全公司业务确认和逐项目差集回滚。 | 高 | 不建议用于本机单项目试点。 |
| C. 暂不初始化 | 保留空表，使用隔离 MySQL 正反例作为代码证据；浏览器周报写链记为未验。 | 无环境副作用，但试点 INT 写链不能以真实周报收口。 | 低 | 若业务方不能确认责任和撤销，就选此项。 |

**裁定需明确：** 目标 `periodKey`、项目集合及责任人、时区/截止、执行角色、提醒与汇总是否暂停、备份/差集证据、含下游记录时的保留或撤销责任人。执行前先只读预览，正式写入另行审批。

## 2. 手工周期里程碑与 rollover

**当前事实。** 手工创建只保存项目、名称、模式、日期及 recurrence，未存 `template_key`；模板生成有稳定键。人工和定时 rollover 对 periodic 都要求 `template_key`，并按项目、该键及下期 `period_start` 识别系列和自然唯一周期；缺键返回 `missing_template_key`，不能以一次性伪键造本机样本。[周期说明](./Unified-Enterprise-PA01-Scope-Enforcement.md#本机证据与未决决定)；代码 `data-runtime/internal/apps/aims/service_milestone_rollover.go`、`enterprise_milestone_write.go`。

| 选项 | 做法与影响范围 | 风险与可撤路径 | 工作量 | 推荐 |
| --- | --- | --- | --- | --- |
| A. 手工周期建立独立稳定系列键 | 在正式创建事务中为每条手工周期系列生成服务端稳定键，使用与模板键隔离的命名空间；后续周期沿用，现有手工无键记录需逐条经身份/重复检查后迁移或明确保留不可关期。人工与系统 rollover 都承认该系列。 | 键冲突、既有周期误归并或并发重复；需唯一约束/回放和迁移回退证据。已关期快照不可简单改键。 | 高 | **推荐长期方案**，若产品要求手工周期也能滚动。 |
| B. 周期里程碑只允许模板创建 | 在 Host/独立 Aims 创建表单禁止手工 `periodic`，已有无键记录显示“无法关期/请迁至模板”；一次性手工里程碑仍可创建。Rollover 继续只处理有模板键的周期。 | 限制人工灵活性；旧记录处理需要明确转换工具或只读留存。 | 中 | **推荐试点最小方案**，如本轮无手工周期业务需求。 |
| C. 保留现状并显式提示 | 允许录入手工 periodic，但在创建/详情/关期前告知不可 rollover。 | 持续制造无法完成闭环的周期，容易误用。 | 低 | 不建议作为收口方案。 |

**裁定需明确：** 手工周期是否必须支持关期；若支持，历史无键记录的转换规则、模板同名隔离和定时任务范围；若不支持，已有记录如何展示与处理。当前隔离 MySQL 已覆盖合法重放/撤权，不能代替真实浏览器正例。

## 3. PA-02 项目访问控制编辑

**当前事实。** 项目 263 当前 `company/L1`、`access_whitelist=NULL`，未改值。独立 Aims `projects/[id]/settings.vue` 可编辑可见性、安全级别和白名单并做组合收紧；Host `/aims/projects/:id/edit` 仅有基本信息，BFF `enterpriseAimsProjectUpdate.ts`、Runtime project-update 白名单及 `editVersion` 未覆盖这些字段。当前 `company/L0/L1` 是持有效 `projects:view` 的读取例外，写入无公开例外；项目范围与真实负责人/active manager 关系仍须复核。[PA-01 合同](./Unified-Enterprise-PA01-Scope-Enforcement.md)；round3 工作回执的 PA-02 入口核查（本机工作证据，不作为仓库内永久引用）；代码 `aims/app/pages/projects/[id]/settings.vue`、`enterprise/server/utils/enterpriseAimsProjectUpdate.ts`。

| 选项 | 做法与影响范围 | 授权门槛、风险与恢复 | 工作量 | 推荐 |
| --- | --- | --- | --- | --- |
| A. Host 项目编辑页内访问控制面板 | 在 `/aims/projects/:id/edit` 增加独立面板/确认，复用安全级别标签与 L2/L3 收紧规则；仅提交变更字段，未改白名单的 `NULL` 保持原值。复用 `aims.project-edit`/`aims:project-edit:execute`、当前 `projects:edit` 范围 permit，再要求 Runtime 当前 leader 或 active manager 的业务门槛；锁行、把三字段纳入 `editVersion` 与回执。 | 不能用 `projects:view`、浏览器 role 或范围管理员身份绕过现时业务门槛；降/升可见性后须重新读取权限，旧版本 409。恢复须按原值精确提交并权威回读，不能盲目覆盖并发更新。 | 中 | **推荐**，与现有编辑和版本合同共用。 |
| B. Host 项目设置独立页 | 注册 `/aims/projects/:id/settings`，将独立 Aims 设置体验迁入 Host，调用同一严格 BFF/Runtime 合同；导航只对有权用户显示。 | 设置页迁移面更大，易把其他未迁功能一起带入；必须逐控件核权和验收。 | 高 | 若产品要集中管理全部项目设置再选。 |
| C. 仅保留独立 Aims 编辑 | Host 只展示当前安全设置并链向独立页，Host 不提供写入口。 | 试点 Host 访问控制写链仍缺失；双应用跳转需证明登录、权限和返回路径。不得通过 SQL 代替正式入口。 | 低 | 只适合明确允许跨应用验收。 |

**裁定需明确：** 编辑位置、是否复用现有 `projects:edit` + 当前 leader/active manager，是否允许新增管理员旁路（如允许须另设计精确权限和审计），以及变更可见性时的二次确认文案。项目 263 的临时 `company→project_team→company` 样本只可在该合同获批、实现并核对备份/恢复后执行。

## 4. 产品负责人裁定（2026-09-27）

1. **周报周期：选 A**——仅项目 263 的单周期试点。先只读预览（配置、目标 periodKey、项目与责任人、提醒/汇总是否暂停、备份与差集），预览经 Claude 审核并取得用户对写入的确认后，才经正式生成入口写入；有下游记录的一律保留并标记试点证据。
2. **手工周期里程碑：选 B**——周期里程碑只允许模板创建；Host 与独立 Aims 表单禁止手工 periodic，一次性手工里程碑保留；BFF 与 Runtime 同样拒绝手工 periodic 创建；已有无键记录显示“无法关期/请迁至模板”，不做数据迁移。
3. **PA-02：选 A**——Host 项目编辑页内访问控制面板，复用 `projects:edit` 范围 permit + 当前 leader/active manager 门槛，三字段纳入 `editVersion` 与回执；不新增管理员旁路；变更可见性需二次确认。
4. **周报试点执行延后（2026-09-28）**——项目 263 的 2026-W40 方案已获参数确认，执行前的新加密备份和差集预演均通过且没有业务写入；但 Host/Aims 缺少正式的周报设置与试点项目配置页/命令，不能用 SQL 代替。试点收口的周报写链暂以隔离 MySQL 合同证据为准，浏览器草稿/提交正例保留缺口；正式配置入口列为后续待办，原方案不视为已执行。
5. **项目范围管理调整（2026-09-28）**——取消 PA-01 第 4 批 Platform 项目范围页、assignment-scopes API 和相关控制面写入。试点项目访问由 PA-02 的项目可见范围（company/project_team/白名单；产品口径中的 private 须按 Aims 实际枚举另行映射）和权威项目成员关系决定；PA-01 第 1–3 批 Runtime 范围执行保留。R 用例改为正式创建标记 project_team 项目，确认 test 非成员不可见、加入 viewer 后可见、移除后再次不可见，并按 G05 记录传播时间。项目 263 既有可见性不改。
