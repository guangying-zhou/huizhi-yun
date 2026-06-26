# People API Spec

People 业务数据接口通过本应用 `/api/v1/**` 暴露，由 `server/middleware/tenant-runtime.ts` 代理到客户侧 data-runtime `/v1/people/**`。少量本应用编排接口使用 `/api/admin/**`，不直接访问数据库。

生产初始化执行 `docs/people_schema.sql`。演示数据已拆到 `docs/people_demo_seed.sql`，仅用于本地原型体验。

已执行旧版 schema 的环境不需要删库重建，执行 `docs/people_standard_cost_incremental.sql` 补齐 M/P 职级设置字段和成本快照追溯字段即可。职级成本公式参数在 Finance 侧维护，既有 Finance 库执行 `finance/docs/finance_people_cost_parameter_incremental.sql`。职级序列数量在 Console 系统参数维护，执行根目录 `docs/Console-SQL-Seed-v1.22-people-rank-settings.sql` 增加 `people.rankSeries.managementCount` 和 `people.rankSeries.professionalCount`。

## 资源接口

- `GET /api/v1/dashboard/overview`
- `GET /api/v1/employees`
- `GET /api/v1/employees/{employeeUid}/profile`
- `GET /api/v1/assignments`
- `GET /api/v1/cost-snapshots`
- `GET/POST/PATCH /api/v1/standard-costs`
- `GET /api/v1/performance-cycles`
- `GET /api/v1/performance-cycles/{cycleCode}/detail`
- `GET /api/v1/positions`
- `GET /api/v1/ranks`

通用资源由 data-runtime compat adapter 提供 `GET/POST/PATCH/DELETE` 基础能力，响应统一为：

```json
{ "code": 0, "message": "ok", "data": {} }
```

## Service API

以下端点由 data-runtime 暴露为 `/v1/people/service/**`，调用方使用 Console service token，目标 `aud=people`，读写分别使用 `scope=people:read` / `scope=people:write`。

- `POST /v1/people/service/directory-users:sync`
- `POST /v1/people/service/cost-snapshots:generate`
- `GET /v1/people/service/standard-costs:resolve?employee_uids=u1,u2&effective_date=YYYY-MM-DD`
- `GET /v1/people/service/employees/{employeeUid}/cost-snapshot?period_month=YYYY-MM`
- `GET /v1/people/service/projects/{projectCode}/people-costs?period_month=YYYY-MM`
- `POST /v1/people/service/contributions:sync`
- `POST /v1/people/service/performance-cycles/{cycleCode}:confirm`
- `POST /v1/people/service/performance-cycles/{cycleCode}:close`
- `POST /v1/people/service/workflow/callback`

`directory-users:sync` 用于生产切换期从 Console Directory 初始化 People 员工事实。People 本应用提供 `POST /api/admin/directory-sync/import` 编排接口：先按当前企业角色校验 `employees/admin` 或 `admin/admin` 权限，再读取 Console `GET /api/v1/console/directory/users?status=active`，最后调用 data-runtime 写入 People。

请求示例：

```json
{
  "source_app": "console",
  "source_biz_type": "directory_user",
  "create_assignments": true,
  "items": [
    {
      "employee_uid": "g.zhao",
      "employee_no": "g.zhao",
      "display_name": "赵宇航",
      "login_name": "g.zhao",
      "dept_code": "rd",
      "dept_name": "研发部",
      "position_name": "架构师",
      "employment_status": 1,
      "employment_type": "human",
      "source_biz_id": "g.zhao"
    }
  ]
}
```

同步规则：

- `employee_uid` 对应 Console Directory `uid`，作为 People 员工唯一键。
- `assignment_code` 默认派生为 `ASN-DIR-{UID}`，重复执行只更新当前目录导入快照。
- Console active 映射为 People `active`；disabled/deleted 等非 active 状态映射为 `inactive`，不直接等同 HR 离职。
- 该接口只用于初始化和校准。正常入职、调岗、离职闭环应由 People 产生事实，并通过 People → Console Directory 契约投影账号和部门关系；当前已落地离职停用账号投影。

`standard-costs` 当前作为 M/P 职级设置维护入口。People 只维护 `rank_series`、`rank_code`、`rank_level`、`rank_salary`、`performance_salary_min/max` 和有效期；管理序列和专业序列的职级数量由 Console 系统参数决定；基本工资、福利成本费率、管理分摊系数、固定资源分摊在 Finance `finance_people_cost_parameter` 中维护。`GET /api/v1/standard-costs` 要求 `people:standard_costs:view` 且为全局范围；`POST/PATCH /api/v1/standard-costs` 要求 `people:standard_costs:admin` 且为全局范围，不接受本人/部门范围授权。

员工事实写入中的 `monthly_standard_cost` 属于敏感成本字段。`PATCH /api/v1/employees/{employeeUid}` 只有在 People BFF 注入 `current_user_standard_cost_access=all` 时才允许写入该字段；普通 `employees/edit` 的本人或部门范围只能维护员工基础事实，不得改写月标准成本。

`standard-costs:resolve` 是 Finance 项目核算的标准成本主接口。Finance 按项目当月 Aims 工时提取员工 UID 后调用该接口，People 返回员工有效任职/职级和命中的 M/P 职级设置；Finance 再结合自身人力成本参数计算月标准成本，并按员工本项目工时 / 员工当月全部 Aims 工时分摊。该接口不读取 `people_cost_snapshots`，也不依赖绩效周期或贡献快照。

People 本应用提供本地编排接口：

- `GET /api/admin/cost-parameters/current?effective_date=YYYY-MM-DD`：校验 `standard_costs/view` 后读取 Finance 当前人力成本参数，用于职级设置页展示公式口径。
- `GET /api/admin/rank-settings/current`：校验 `standard_costs/view` 后读取 Console 系统参数 `people.rankSeries.managementCount` / `people.rankSeries.professionalCount`，用于职级设置页生成管理 M 和专业 P 页签；People 使用 `aud=system_settings`、`scope=system_settings:view` 的 Console service token。
- `POST /api/admin/directory-users/{uid}/disable`：校验 People `employees/edit` 或 `assignments/edit` 权限后，使用 Console service token 调用 Console `POST /api/v1/console/service/directory/users/{uid}/disable`；当员工状态保存为 `left` / `inactive`，或任职调整类型为 `leave` 时由前端调用。
- `POST /api/admin/cost-snapshots/generate`：校验 `cost_snapshots/admin` 权限，读取 Finance `GET /api/v1/finance/service/people-cost-parameters?effective_date=`，再调用 People data-runtime `POST /v1/people/service/cost-snapshots:generate`。
- `POST /api/admin/performance-cycles`：校验 `performance_cycles/edit` 权限后调用 People data-runtime `POST /v1/people/performance-cycles` 创建草稿绩效周期；项目范围周期必须填写 `projectCode`。
- `POST /api/admin/performance-cycles/{cycleCode}/collect`：校验 `performance_cycles/edit` 权限，读取 People 周期详情，按周期 `project_code` 通过 Aims data-runtime `GET /v1/aims/admin/projects?search=` 解析项目，再读取 `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=` 聚合工时，最后调用 People data-runtime `POST /v1/people/service/contributions:sync` 固化贡献快照。该接口需要 Console 执行根目录 `docs/Console-SQL-Seed-v1.24-people-aims-contribution-grants.sql`，授予 People runtime 读取 Aims 的服务权限。
- `POST /api/admin/performance-cycles/{cycleCode}/confirm`：校验 `performance_cycles/edit` 权限后调用 People data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:confirm`，将周期置为 `confirmed`，并把该周期贡献快照 `confirmed_at` 固化；没有贡献快照时拒绝确认。
- `POST /api/admin/performance-cycles/{cycleCode}/close`：校验 `performance_cycles/edit` 权限后调用 People data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:close`，仅允许已确认周期进入 `closed`。
- `GET /api/admin/performance-amounts`：校验 `performance_cycles/view` 权限，使用 Console service token 读取 Finance `GET /api/v1/finance/service/performance-amounts?cycle_code=&period_start=&period_end=&employee_uid=&project_code=`，用于绩效周期详情页展示财务金额快照。

`cost-snapshots:generate` 按 M/P 职级设置和 Finance 参数生成指定月份员工成本快照。该 data-runtime 接口要求请求体带 `costParameters` / `cost_parameters`，不再由 People 自行假定费率或回退员工冗余成本。

请求示例：

```json
{
  "period_month": "2026-06",
  "employee_uids": ["g.zhao", "l.xiao"],
  "costParameters": {
    "code": "PCP-DEFAULT-2026",
    "base_salary": "8000.00",
    "welfare_cost_rate": "0.3000",
    "management_allocation_rate": "0.2000",
    "resource_allocation_cost": "2000.00",
    "currency_code": "CNY"
  },
  "operator_uid": "people.admin"
}
```

响应示例：

```json
{
  "period_month": "2026-06",
  "employee_count": 2,
  "rate_count": 15,
  "generated": 2,
  "skipped": [],
  "cost_basis": "standard",
  "finance_parameter": "PCP-DEFAULT-2026"
}
```

生成规则：

- 匹配 `people_standard_cost_rates` 中生效且启用、且不限定岗位的 M/P 职级规则；员工 `rank_code` 必须命中规则 `rank_code`。
- 月标准成本公式为：`基本工资 + 职级工资 + 绩效工资中位数 + 福利成本 + 管理分摊 + 资源分摊`。
- `福利成本 = (基本工资 + 职级工资 + 绩效工资中位数) * Finance.福利成本费率`。
- `管理分摊 = (基本工资 + 职级工资 + 绩效工资中位数 + 福利成本) * Finance.管理分摊系数`。
- 写入 `people_cost_snapshots` 时 `cost_basis=standard`，`standard_rate_code` 指向命中的规则。
- 在薪资/实际成本未接入前，`actual_cost` 暂等于 `standard_cost`，并通过 `cost_basis=standard` 明确其不是薪资实际。
- 同步更新员工 `monthly_standard_cost` 冗余值，用于员工台账展示。

`people-costs` 返回基于 `people_cost_snapshots` 与 `people_contribution_snapshots` 的兼容聚合明细，核心字段包括 `cycle_code`、`employee_uid`、`period_month`、`standard_cost`、`actual_cost`、`effective_cost`、`cost_basis`、`standard_rate_code`、`work_hours`、`total_work_hours`、`allocation_ratio`、`allocated_standard_cost`、`allocated_actual_cost`、`allocated_cost`。该接口保留给历史查询和个人绩效快照分析，不作为 Finance 项目成本核算主路径。

`contributions:sync` 请求示例：

```json
{
  "cycle_code": "PC-2026Q2",
  "source_app": "aims",
  "items": [
    {
      "employee_uid": "g.zhao",
      "project_code": "PRJ-FIN",
      "role_code": "研发",
      "work_hours": 60,
      "contribution_score": 92,
      "source_biz_type": "task",
      "source_biz_id": "TASK-1001",
      "source_refs": { "tasks": ["TASK-1001"] }
    }
  ]
}
```

## Data Runtime

启用 People adapter：

```bash
HZY_PEOPLE_AGENT_ENABLED=true
HZY_PEOPLE_DB_HOST=127.0.0.1
HZY_PEOPLE_DB_PORT=3306
HZY_PEOPLE_DB_USER=root
HZY_PEOPLE_DB_PASSWORD=***
HZY_PEOPLE_DB_NAME=hzy_people
```

Schema 检查：

```bash
curl 'http://127.0.0.1:18080/runtime/schema/status?app=people'
```
