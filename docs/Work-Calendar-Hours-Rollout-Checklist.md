# Work Calendar Hours Rollout Checklist

> 状态：专项发布与验收参考（外部变更待授权）
> 最后核对：2026-07-11
> 当前事实源：Console/Aims/Finance 当前 schema 与 API、相关 migration/seed、`docs/MODULE_CONTRACTS.md`、`docs/P3-P4-Release-Readiness-and-E2E-Acceptance.md`
> 边界：本清单中的 SQL、seed、Cloudflare 发布和验收步骤必须按目标环境单独确认；离线实现或自动化验证不构成执行授权。

## 目标

将 Console 工作日历从展示能力推进为平台工时口径事实源：

- Aims 项目周报按日级工作日历识别工作日、休息日、法定假日、调休工作日。
- Aims 周报成员认定工时按“当周工作日标准工时”折算，不再固定为 40h/周。
- Finance 项目人力成本按“员工本项目月工时 / Console 月标准工时”计算分摊比例。

## 需要发布的应用

1. Console
   - 需要包含 Work Calendar API / 页面及工作日历表结构。
   - 若生产环境已具备节假日管理页面和 `/api/v1/console/service/work-calendar/month`，可只执行授权 seed。

2. Aims
   - 发布项目周报页面和 `/api/work-calendars/{calendarCode}/days` BFF。
   - 周报 100% 投入按当周标准工时折算。

3. Finance
   - 需要包含 `POST /api/v1/finance/project-accounting/sync-people-costs` 当前实现。
   - 当前实现已按 Console `standardWorkHours` 作为分母计算项目人力成本分摊。

## 需要执行的 SQL

按环境现状执行，已执行过的跳过：

1. Console 工作日历表结构
   - `console/docs/work_calendar_incremental.sql`

2. People / Finance runtime client
   - `console/docs/sql/Console-SQL-Seed-v1.21-people-finance-runtime-clients.sql`
   - 若 `finance.runtime` 已存在且可签发 `finance` 来源 service token，可跳过。

3. Aims / Finance 读取 Console Work Calendar 授权
   - `console/docs/sql/Console-SQL-Seed-v1.25-work-calendar-system-settings-grants.sql`
   - 必须确保 `aims.runtime` 和 `finance.runtime` 有 `system_settings:view`。

## 验收路径

1. Console 节假日管理
   - 确认目标年份已导入或维护工作日历。
   - 月份摘要存在 `workdayCount`、`standardHoursPerDay`、`standardWorkHours`。

2. Aims 项目周报
   - 打开某项目周报。
   - 左侧周报日历能区分工作日 / 休息日 / 法定假日 / 调休工作日。
   - 右侧日期范围后显示当周工作日天数和标准工时。
   - 新增或未填报成员的默认认定工时 = 当周标准工时。
   - 修改投入比例时，认定工时按当周标准工时折算。

3. Finance 项目核算
   - 在项目核算页选择核算月份并执行“计算人力成本”。
   - 分摊记录中的 `source_refs.workCalendar.standardWorkHours` 为 Console 月标准工时。
   - 分摊比例 = Aims 本项目月工时 / Console 月标准工时。
   - 项目汇总页显示人力成本，并触发财务摘要重算。
