# People API Spec

People 业务数据接口通过本应用 `/api/v1/**` 暴露，由 `server/middleware/tenant-runtime.ts` 代理到客户侧 data-runtime `/v1/people/**`。少量本应用编排接口使用 `/api/admin/**`，不直接访问数据库。

生产初始化执行 `docs/people_schema.sql`。`docs/schema-manifest.json` 是 People schema 与增量迁移顺序、校验和的模块事实源，发布时由当前活动 release manifest 纳入；不得改写已归档 release manifest。演示数据已拆到 `docs/people_demo_seed.sql`，仅用于本地原型体验。

已执行旧版 schema 的环境不需要删库重建，执行 `docs/people_standard_cost_incremental.sql` 补齐 M/P 职级设置字段和成本快照追溯字段，并执行 `docs/migrations/20260829_rank_series.sql` 为职级字典增加专业/管理类型。随后必须执行 `docs/migrations/20260829_rank_series_verify.sql`；runtime readiness 也会校验枚举、非空/default、索引及残留 NULL，未完整迁移时按 `schema_mismatch` 失败。职级成本公式参数在 Finance 侧维护，既有 Finance 库执行 `finance/docs/finance_people_cost_parameter_incremental.sql`。职级序列数量在 Console 系统参数维护，执行根目录 `console/docs/sql/Console-SQL-Seed-v1.22-people-rank-settings.sql` 增加 `people.rankSeries.managementCount` 和 `people.rankSeries.professionalCount`。

## 资源接口

- `GET /api/v1/dashboard/overview`
- `GET /api/v1/employees`：兼容普通列表查询。
- `POST /api/v1/employees:search`：员工页列表查询，body 支持 `page`、`page_size`、`keyword`、
  `employment_status`、`dept_codes: string[]` 和 `employee_uids: string[]`。选择正式部门时，从 Console
  Directory 部门树展开该部门及其正式下级部门后使用 `dept_codes` 查询；选择委员会时，先解析委员会
  成员 UID，再使用 `employee_uids` 查询 People 员工事实。集合放在请求体，避免大型组织树超过浏览器、
  Cloudflare 或代理的 URL 长度限制；该 POST 是只读查询，要求 `employees/view` 与 `people.read`。
- `GET /api/v1/employees/{employeeUid}/profile`
- `GET/PATCH /api/v1/employees/{employeeUid}/private-profile`：身份证号、出生日期、学历、专业、毕业学校和毕业日期的人事档案扩展资料。要求 `employees/edit`，并按授权的员工数据范围校验目标员工；身份证号只返回掩码，扩展资料不加入通用员工列表或 profile。
- `POST /api/admin/employee-archive-import`：上传旧 OA `employee.csv`，先 dry-run 再由用户确认。按钉钉 userid、手机号、唯一姓名依次匹配；歧义或未匹配行跳过并汇总，不返回身份证明文。OA 入职日期只补充当前为空的员工。
- `GET /api/v1/assignments`
- `POST /api/v1/assignments:change`：原子执行调岗、调级或离职，使用稳定
  `source_biz_id` 幂等重试；同一事务结束旧主任职、创建新任职、在变更已生效时更新当前员工事实并冻结
  Directory lifecycle operation。调级额外要求 `standard_costs/admin` 全局权限，并且 `rank_code` 必须命中
  当前启用的职级字典；调级页面同时要求 `ranks/view` 读取选项（推荐的 specialist 与
  compensation_admin 角色均包含该只读权限）。runtime 使用字典中的规范编码和名称，未知或停用职级返回
  `400 people_assignment_rank_unavailable`。
- `POST /api/v1/authorization/instance-conflict-explain`：任职变更审批职责冲突解释（`targetType=assignment`）
- `GET /api/v1/cost-snapshots`
- `GET/POST/PATCH /api/v1/documents`
- `GET/POST/PATCH /api/v1/standard-costs`
- `GET /api/v1/performance-cycles`
- `GET /api/v1/performance-cycles/{cycleCode}/detail`
- `GET/POST /api/v1/positions`、`GET/PATCH/DELETE /api/v1/positions/{idOrPositionCode}`：维护岗位字典；
  更新不允许修改稳定 `position_code`。删除只移除岗位字典项，不改写员工、任职及成本快照中已固化的岗位事实。
- `GET/POST /api/v1/ranks`、`GET/PATCH/DELETE /api/v1/ranks/{idOrRankCode}`：维护职级字典；
  `rank_series=M|P` 分别表示管理/专业类型，其他值返回稳定的 `400 people_rank_series_invalid`；
  编码/名称、非负整数层级与排序、说明长度和启用值均由 runtime 校验，非法值分别返回稳定的
  `people_rank_*_invalid` 400 错误；数据库同时用 CHECK 约束保护数值和启用状态。
  更新不允许修改稳定 `rank_code`，尝试修改返回 `400 people_rank_code_immutable`。删除只移除职级字典项，
  不改写员工、任职及成本快照中已固化的职级事实。
- `GET /api/v1/integration-operations`（仅 People caller-owned Directory/Assets operation family）
- `GET /api/v1/integration-operations/{operationId}/attempts`
- `POST /api/v1/integration-operations/{operationId}/replay`

通用资源由 data-runtime compat adapter 提供 `GET/POST/PATCH/DELETE` 基础能力，响应统一为：

```json
{ "code": 0, "message": "ok", "data": {} }
```

People Nuxt BFF 在代理普通 `/api/v1/**` 到 data-runtime 前会先校验当前登录用户的 People 权限：dashboard 要求 `dashboard/view`；员工、任职、成本快照、文档引用、绩效周期分别按 HTTP 方法映射为 `view/edit/admin`；`standard-costs`、`positions`、`ranks` 写入要求对应资源 `admin`。`/api/v1/service/**` 不走用户权限闸门，必须使用 Console service token capability。

员工扩展人事档案使用独立的 `people_employee_private_facts` 分来源表，不注册为 compat 通用资源。每个字段分别保存 `dingtalk / manual / oa_archive` 事实，有效值按该顺序解析。钉钉明确下发非空值时接管该字段；钉钉不下发或下发空值时，People 人工值和 OA 历史值仍可作为回退。被钉钉接管的字段在 People UI 和 runtime 都禁止人工覆盖。旧 OA 学历仅有 `0/1/2` 原代码，导入时原样保留，不能在缺少旧系统字典时猜测含义。

data-runtime 的用户读取端点要求 BFF 显式注入 `current_user_employee_access=all|self|dept`；缺失、`none` 或未知值一律返回 403，不得把缺少 scope 上下文解释为全量读取。Service-only endpoint 使用独立的 Console service capability，不依赖该用户 scope。

员工当前职级只能通过 `POST /api/v1/assignments:change` 调整。普通员工 `POST/PATCH/PUT` 即使调用者具有薪酬管理权限，也会拒绝 `rank_code/rank_name`（包括别名）并返回
`400 people_employee_rank_requires_assignment_change`，避免绕过职级字典、任职历史和幂等校验。

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
- `POST /v1/people/service/assets-offboarding-projections:prepare`：固定 `asOf` 分页物化 People → Assets 可靠 operation，仅供 People scheduled runtime identity。

这些 service-only 端点若经 People Nuxt BFF 暴露为 `/api/v1/service/**`，必须在 `server/middleware/tenant-runtime.ts` 代理到 data-runtime 前完成 Console service token 校验：`standard-costs:resolve`、员工成本快照和项目 people-costs 读接口要求 `people:read` 且来源为 Finance；`contributions:sync` 要求 `people:write` 且来源为 Aims；`directory-users:sync` 要求 `people:write` 且来源为 Console；成本快照生成和绩效周期 confirm/close 仅保留给 People 自身服务编排。未列入 capability 映射的 `/api/v1/service/**` 后缀会在转发前被拒绝，普通浏览器会话不得直接调用这些 service-only BFF 路径。

`POST /api/v1/service/workflow/callback` 是 Workflow 调用的 People BFF 入口：要求 Console service token `aud=people`、`scope=workflow:callback`、来源 `workflow`。BFF 会把 Workflow 的 `resource_code` / `instance_id` 规范化为 data-runtime 识别的 `biz_type` / `workflow_instance_id`，再调用 `/v1/people/service/workflow/callback` 写入审批状态；当任职变更审批通过时，BFF 会读取 People 任职事实并复用 Console Directory employment/offboarding 投影，拒绝或取消只同步审批状态，不改变 Console 登录身份和主岗位授权。

`POST /api/v1/service/notification-details/authorize` 只接受 Console service identity，要求
`aud=people`、`scope=people:notification-details:authorize`。路由在读取 body 或解析
tenant-runtime binding 前先校验 capability，再通过 Foundation 绑定 token、请求和可信
tenant/deployment。descriptor 必须精确为
`{resource:'offboarding_task',id:taskCode}` 或已发布 People dead-letter generation 的
`{resource:'integration_operation',id:lowercaseUuid}`；额外字段、资源漂移或 runtime 响应未精确回显
`{authorized,reasonCode,resource,id}` 均返回不可用。BFF 使用 purpose-bound actor 调用
`POST /v1/people/notification-details/authorize`，runtime 只按当前 pending task 的
`responsible_uid` 重新授权，不使用部门、经理或管理员 fallback；integration-operation
descriptor 则必须同时匹配当前 dead_letter generation、Console ACK 的 notification ID 与实际收件 UID，
已 replay/succeeded/closed 的 generation 一律拒绝。

## People 跨应用操作诊断与死信 actionable

浏览器只可通过 `GET /api/v1/integration-operations`、attempt timeline 与受控
`POST .../{operationId}/replay` 访问，分别要求 `people:integration_operations:view` 和
`people:integration_operations:replay`，并且 Foundation/Console 必须授予租户全局范围；浏览器不提供
target、command、idempotency key、错误正文或收件人。runtime 将可诊断、replay 和 Console actionable
严格限于以下 caller-owned operation code：

诊断列表按 `(updated_at DESC, operation_id DESC)` keyset cursor 连续翻页。runtime 以允许 family
过滤后的第 N 条为 continuation cursor，并在内部过取未获批准 family；因此未获批准 operation
即使填满原始页，也不会遗漏后续允许的记录，且 browser projection 仍只返回允许字段。

- `people.directory.employment-sync.v1` → Console，`console:directory-employment:sync`
- `people.directory.offboarding-disable.v1` → Console，`console:directory-offboarding:disable`
- `people.offboarding.assets-recovery-sync.v1` → Assets，`assets:offboarding-recovery:sync`

dead-letter 候选的四个 service runtime endpoint（list/publish ACK/list closure/closure ACK）均要求
`people:integration_operation:execute` 及可信 People scheduled worker binding。source 只返回安全 DTO；
publish ACK 持久化 Console 实际显式收件 UID、notification ID 与冻结 generation/object version。成功写入
`resolved` closure，受控 replay 写入 `cancelled` closure，二者与 operation mutation 同事务；旧 generation
closure 未 ACK 时不发布下一 generation。升级库执行
`docs/migrations/20260711_people_dead_letter_actionable_lifecycle.sql`；不执行 migration、不启用 cron 或
不部署，不会产生外部投递。

通知投递由独立 `integrations:dead-letter-notifications` scheduled task 执行，开关
`HZY_PEOPLE_INTEGRATION_OPERATION_DEAD_LETTER_NOTIFICATIONS_ENABLED` 默认 `false`。启用后每轮最多处理
一个 source generation（publish 与 closure 同一安全 helper），并复用 People 专用 runtime binding 与 Console
service client。该任务不调用 `claim-next`、不写业务 receipt、也不参与 Directory→Console 或 People→Assets
业务 drain；Console/runtime 发布或 closure ACK 不可用时只记录 pending，下一轮以同一冻结身份重试。

离职事项用户路由要求 route-specific runtime scope：列表/详情为
`people:offboarding_tasks:view`，创建为 `admin`，确认为 `confirm`，取消为 `cancel`，并与
`people.read/write` transport scope 同时签发。BFF 丢弃客户端提供的
`current_user/current_user_scopes`，只注入验证会话 UID。GET/confirm 只有在同一权限快照
另行拥有 `offboarding_tasks/admin`（或全局 admin）时才附加精确 admin scope；confirm
本身不升级为 admin，cancel 只使用独立 cancel 权限。

## 离职任务到期通知

People 定时通知包含 `offboarding_handover_due` 与
`offboarding_asset_recovery_due` 两个流，event type 分别为
`people.offboarding.handover_due` 与
`people.offboarding.asset_recovery_due`。候选必须携带一致的
`caseCode/taskCode/taskType`，`sourceType=offboarding_task` 且
`sourceCode=taskCode`；只允许一个 runtime 明确给出的当前责任人，并经 Console Directory
active 状态复核，不使用 manager、department、People admin、配置收件人或 `@all`
fallback。action URL 固定为
`/people/offboarding-cases/{caseCode}?task={taskCode}`，通知 descriptor、`bizType/bizId`
均绑定该 taskCode。

扫描使用固定 `asOf`，每页 100、每流最多 10 页、45 秒墙钟预算，并通过稳定
idempotency/actionable identity 支持 publish 后 ack 丢失重放及 closure CAS。阶段固定为
`D30/D7/D1/expired`，不使用 `due/overdue` 近似值。环境变量
`HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED` 默认 `false`；关闭时在解析 runtime
binding、取 token或发网络请求前返回。只有显式启用且 runtime URL、tenant、deployment
和 People 专用 service client ID 齐全时才渲染 Cloudflare cron。

## People → Assets 离职资产回收投影

People runtime 使用固定 RFC3339 `asOf` 和 `(effectiveDate,employeeId)` 不透明游标遍历候选。员工当前状态为 `left/inactive`，或截至 `asOf` 最新一条已生效、`approval_status IN ('none','approved')` 的任职记录为 `change_type=leave` 时才创建 operation。任职选择在全部 change type 中按 `effective_from,id` 取最新值，因此历史 leave 后已有 onboard/transfer 的 active 员工不会再次投影；未来生效、draft/pending/rejected/cancelled leave 均排除。

operation 固定为 `people.offboarding.assets-recovery-sync.v1`，目标 capability 为 `assets:offboarding-recovery:sync`。command 只含 `sourceEventKey/departedEmployeeUid/offboardedAt`，不保存 Assets 责任人、due、资产列表或 People 协调状态。People BFF 使用标准 `serviceCommand` envelope 和 operation `Idempotency-Key` 调 Assets `/api/v1/service/offboarding-recoveries:upsert`；只有 receipt 身份、command hash 与目标 case 全部精确匹配后才确认 succeeded 并保存 `target_receipt_id`。

`HZY_PEOPLE_ASSETS_OFFBOARDING_SYNC_ENABLED` 默认 `false`；关闭时在 runtime binding、token 和网络调用前短路。开启前应用 `docs/people_assets_offboarding_projection_20260710.sql`、Assets 对应 migration 和根目录 Console v1.41 grant；只通过 Cloudflare 配置/部署指令启用，不使用 GitLab Runner。

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
- 该接口只用于初始化和校准。正常入职、调岗、离职闭环应由 People 产生事实，并通过 People → Console Directory 契约投影账号和部门关系；当前已落地员工创建/更新、非离职任职调整的 Console 用户与主部门投影，以及离职停用账号投影。

`standard-costs` 当前作为 M/P 职级设置维护入口。People 只维护 `rank_series`、`rank_code`、`rank_level`、`rank_salary`、`performance_salary_min/max` 和有效期；管理序列和专业序列的职级数量由 Console 系统参数决定；基本工资、福利成本费率、管理分摊系数、固定资源分摊在 Finance `finance_people_cost_parameter` 中维护。`GET /api/v1/standard-costs` 要求 `people:standard_costs:view` 且为全局范围；`POST/PATCH /api/v1/standard-costs` 要求 `people:standard_costs:admin` 且为全局范围，不接受本人/部门范围授权。

员工事实写入中的 `monthly_standard_cost`、`cost_center_code`、`rank_code` 和 `rank_name` 属于敏感成本/职级字段。`PATCH /api/v1/employees/{employeeUid}` 只有在 People BFF 注入 `current_user_standard_cost_access=all` 时才允许写入这些字段；普通 `employees/edit` 的本人或部门范围只能维护员工基础事实，不得改写月标准成本、成本中心或职级。员工列表、员工详情、员工 profile、员工写响应、任职变更 generic 响应和 dashboard 近期任职列表会在缺少 `standard_costs` 全局读取权限时脱敏月标准成本、成本中心和职级字段；dashboard 本月实际成本聚合未命中 `standard_costs:view` 时只返回未授权指标。

`documents` 保存 People 对 Codocs 文档的引用。`GET /api/v1/documents` 与详情读取先要求 `people:documents:view`，再按关联 `employee_uid` 套用该授权的本人/部门范围：本人范围只能读取自己的文档引用，部门范围可读取授权部门员工的文档引用；写入、修改和删除要求 `people:documents:edit/admin` 且仍必须满足全局员工父对象范围，避免 scoped 用户为未授权员工绑定或改写文档引用。

`standard-costs:resolve` 是 Finance 项目核算的标准成本主接口。Finance 按项目当月 Aims 工时提取员工 UID 后调用该接口，People 返回员工有效任职/职级和命中的 M/P 职级设置；Finance 再结合自身人力成本参数计算月标准成本，并按员工本项目工时 / Console Work Calendar 当月标准工时分摊。该接口不读取 `people_cost_snapshots`，也不依赖绩效周期或贡献快照。

“有效任职”统一定义为：查询日期落在 `effective_from` 与 `effective_to`（含首尾）之间、`is_primary=1`，且 `approval_status` 为 `none`（无需审批）或 `approved`。同一员工存在历史重叠数据时，读取端按 `effective_from DESC, id DESC` 确定一条，但该顺序只用于兼容存量脏数据，不代表允许新增重叠主任职。日期区间排他无法由普通静态唯一键正确表达；generic POST/PATCH/PUT 在完成员工范围与全局写权限校验后执行领域冲突检查，Workflow 将任职切换为 `approved` 前也执行同一检查。正常调岗、调级和离职必须调用 `POST /api/v1/assignments:change`：runtime 会锁定员工，拒绝覆盖普通同日或未来已生效/免审批主任职，并把旧任职截止日设为新任职生效日前一天；若历史 HR 事实早于 `directory-users:sync` 生成的 `ASN-DIR-*` 初始化任职，则在同一事务把该初始化记录标记为 `cancelled`，避免制造结束日早于开始日的无效区间。任何一步失败都会整体回滚，不允许调用方继续编排多个 generic 写入。

`directory-users:sync` 是生产切换期的 bootstrap/calibration upsert，会以稳定 `ASN-DIR-{UID}` 写入 approved 主任职。该批量事务目前不复用普通 generic 写入冲突检查：既有租户若已存在其他有效主任职，直接复用会让整批初始化因历史重叠中断。该入口不得用于正常调岗；执行前应审计目标员工的有效主任职重叠，正常变更统一使用上述单事务 action。

People 本应用提供本地编排接口：

- `GET /api/admin/cost-parameters/current?effective_date=YYYY-MM-DD`：校验 `standard_costs/view` 后读取 Finance 当前人力成本参数，用于职级设置页展示公式口径。
- `GET /api/admin/rank-settings/current`：校验 `standard_costs/view` 后读取 Console 系统参数 `people.rankSeries.managementCount` / `people.rankSeries.professionalCount`，用于职级设置页生成管理 M 和专业 P 页签；People 使用 `aud=system_settings`、`scope=system_settings:view` 的 Console service token。
- 员工事实或任职变更写入时，data-runtime 会在同一事务重读 canonical facts、推进
  `people_directory_lifecycle_versions` 并冻结 caller-owned Directory lifecycle operation；People BFF
  只负责可靠投递该 operation，不从浏览器请求体推导投影内容，也不直接写 Console。
- 旧 `POST /api/admin/directory-users/{uid}/disable` 旁路已退役并返回 410；离职统一通过员工事实
  mutation 或 `POST /api/v1/assignments:change` 产生 Directory offboarding operation。
- `POST /api/admin/cost-snapshots/generate`：校验 `cost_snapshots/admin` 权限，读取 Finance `GET /api/v1/finance/service/people-cost-parameters?effective_date=`，再调用 People data-runtime `POST /v1/people/service/cost-snapshots:generate`。
- `POST /api/admin/performance-cycles`：校验 `performance_cycles/edit` 权限后调用 People data-runtime `POST /v1/people/performance-cycles` 创建草稿绩效周期；项目范围周期必须填写 `projectCode`。
- `POST /api/admin/performance-cycles/{cycleCode}/collect`：校验 `performance_cycles/edit` 权限，读取 People 周期详情，按周期 `project_code` 通过 Aims data-runtime `GET /v1/aims/admin/projects?search=` 解析项目，再完整读取 `GET /v1/aims/projects/{projectId}/time-entries?start_date=&end_date=`，只聚合 `review_status=approved` 的工时，最后调用 People data-runtime `POST /v1/people/service/contributions:sync` 固化 `score_status=unscored`、`contribution_score=NULL` 的贡献事实。该接口需要 Console 执行根目录 `console/docs/sql/Console-SQL-Seed-v1.24-people-aims-contribution-grants.sql`，授予 People runtime 读取 Aims 的服务权限。
- `POST /api/admin/performance-cycles/{cycleCode}/confirm`：校验 `performance_cycles/approve` 权限后调用 People data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:confirm`，将周期置为 `confirmed`，并把该周期贡献快照 `confirmed_at` 固化；没有贡献快照时拒绝确认。
- `POST /api/admin/performance-cycles/{cycleCode}/close`：校验 `performance_cycles/approve` 权限后调用 People data-runtime `POST /v1/people/service/performance-cycles/{cycleCode}:close`，仅允许已确认周期进入 `closed`。
- `GET /api/admin/performance-amounts`：校验 `performance_cycles/view` 权限，使用 Console service token 读取 Finance `GET /api/v1/finance/service/performance-amounts?cycle_code=&period_start=&period_end=&employee_uid=&project_code=`，用于绩效周期详情页展示财务金额快照。

`cost-snapshots:generate` 按 M/P 职级设置和 Finance 参数生成指定月份员工成本快照。该 data-runtime 接口要求请求体带 `costParameters` / `cost_parameters`，不再由 People 自行假定费率或回退员工冗余成本。

生成器以 `period_month` 最后一天作为 `as_of_date`，复用上述有效主任职 selector；找不到有效主任职的员工以 `missing_effective_primary_assignment` 跳过，不使用当前员工冗余岗位/职级伪造历史。快照会固化 `assignment_code`、`dept_code_snapshot/dept_name_snapshot`、`position_code_snapshot/position_name_snapshot`、`rank_code_snapshot/rank_name_snapshot`，并在 `source_refs.assignment` 中保留任职生效区间。后续调岗或调级不会改变已生成快照；只有显式重新生成或成本调整动作才会更新同一 `employee_uid + period_month` 快照。

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
- 写入时同时固化期间末有效主任职及部门、岗位、职级快照；成本匹配使用该任职的职级，而不是员工表当前冗余职级。
- 在薪资/实际成本未接入前，`actual_cost` 暂等于 `standard_cost`，并通过 `cost_basis=standard` 明确其不是薪资实际。
- 同步更新员工 `monthly_standard_cost` 冗余值，用于员工台账展示。

`people-costs` 返回基于 `people_cost_snapshots` 与 `people_contribution_snapshots` 的兼容聚合明细，核心字段包括 `cycle_code`、`employee_uid`、`period_month`、`standard_cost`、`actual_cost`、`effective_cost`、`cost_basis`、`standard_rate_code`、`work_hours`、`total_work_hours`、`allocation_ratio`、`allocated_standard_cost`、`allocated_actual_cost`、`allocated_cost`。该接口保留给历史查询和个人绩效快照分析，不作为 Finance 项目成本核算主路径。

`contributions:sync` 请求示例：

```json
{
  "cycle_code": "PC-2026Q2",
  "project_code": "PRJ-FIN",
  "period_start": "2026-04-01",
  "period_end": "2026-06-30",
  "source_app": "aims",
  "source_biz_type": "time_entries",
  "sync_mode": "replace_scope",
  "snapshot_complete": true,
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

`sync_mode=replace_scope` 表示调用方已经完整读取本次 `cycle_code + project_code + period + source_app + source_biz_type` 快照；必须同时传 `snapshot_complete=true`。data-runtime 在同一事务中锁定绩效周期，只允许 `collecting`，校验周期项目/期间和所有 item 来源范围，upsert 当前集合，再删除该范围内本次未出现的旧贡献。`items=[]` 是合法的完整空快照，会清理该来源范围；不传 `sync_mode` 的旧非空请求暂保留只 upsert 的兼容语义，旧空请求仍拒绝。响应保留 `synced` 并新增 `removed`、`sync_mode`。

`score_status` 只允许 `unscored|scored`。`unscored` 必须将 `contribution_score` 保存为 `NULL`；`scored` 必须显式提供分数。Aims 的工时与项目管理事实在首期始终为 `unscored`，HR 后续评分不得回写或覆盖 Aims 来源事实。

`contribution-snapshots` 通用 REST 入口仅允许读取；创建、更新和删除必须经 `contributions:sync`，避免绕过周期行锁修改已确认或已关闭快照。周期 confirm/close 与 Workflow 批准使用同一事务行锁，周期状态和贡献 `confirmed_at` 要么一起提交、要么一起回滚。

## 钉钉人事事实源

People 管理入口：

- `GET /api/admin/hr-source-sync/dingtalk/department-mappings`：预览旧 `DT-*` 部门到 canonical `dept_code` 的已绑定、建议、冲突与未匹配状态；要求 `hr_source_sync/view`。
- `POST /api/admin/hr-source-sync/dingtalk/department-mappings`：确认映射，先由 Console 原子归并目录，再事务改写 People 员工/任职部门引用；要求 `hr_source_sync/admin` 与 `Idempotency-Key`（未传时 BFF 生成）。
- `GET /api/admin/hr-source-sync/dingtalk/department-changes`：读取最近一次通过 final marker、根部门、计数和快照 hash 校验的缺失部门差异、风险等级及实时阻断原因；要求 `hr_source_sync/view`。
- `POST /api/admin/hr-source-sync/dingtalk/department-changes`：按 `snapshotRunId + snapshotHash + departmentCodes` 确认停用缺失正式部门；要求 `hr_source_sync/admin`。服务端重新检查候选仍属于同一快照、没有活跃主归属人员且没有未同时处理的 active 子部门；稳定 `dept_code` 与历史记录不删除。
- `POST /api/admin/hr-source-sync/dingtalk/jobs`：同步正式行政部门、人员主归属和在离职状态；要求 `hr_source_sync/execute`。存在未解决部门映射时服务端失败关闭。
- `GET /api/admin/hr-source-sync/dingtalk/jobs/{jobId}`、`POST .../{jobId}/cancel|retry`：读取、取消或重试 Connector Runtime 任务。

任务创建、取消和重试由固定 `people.runtime` 客户端使用标准 service-command HMAC 调用 Console，冻结原始管理员、tenant、source/target deployment、operation、payload hash 与幂等键；Console 验证后向 Connector Runtime 传递原始管理员和同一幂等键。

同步任务结果的 `counts.fieldCoverage[]` 持久返回 `field / provided / empty / absent / invalid / observed`，`counts.partialFieldsMissing[]` 返回整批完全未下发的核心字段。Connector Runtime 从通讯录用户接口读取基础资料，再以钉钉应用 `Agent ID` 调用智能人事花名册接口 `/v1.0/hrm/rosters/lists/query`，按标准字段编码读取身份证号、出生日期、最高学历、专业、毕业院校和毕业时间；Console 的 `dingtalk.default` 集成必须填写 `agentId`，且应用必须具有读取员工花名册信息的权限。日期字段在边界处规范化为 ISO：出生日期必须为 `YYYY-MM-DD`，毕业时间允许钉钉使用 `YYYY-MM` 月精度或 `YYYY-MM-DD` 日精度，并兼容斜杠及中文年月日文本。钉钉响应中的 absent、显式空值和无效日期在 Connector Runtime → People JSON 边界及 People 落库时保持可区分：私密档案的 absent 保留全部既有来源，显式空值只移除钉钉来源并自动回退到 People/OA，无效日期保留既有有效事实；入职日期只在钉钉提供有效非空值时接管，否则保留 People/OA 补充值。HR 页面展示这些计数与候选字段状态，不把缺权限造成的静默字段缺失误报为完整成功。

员工工号不属于钉钉管理字段：Connector Runtime 不读取或下发钉钉 `job_number`，People runtime 对旧任务中残留的 `employeeNumber / jobNumber / employee_no` 也强制忽略。People 以 `people_employee_number_sequences` 在事务中分配连续十进制工号，首号为 `000`、不足三位补零，超过 `999` 后自然扩展；新候选首次保存入职资料或钉钉同步首次创建正式员工时分配。存量员工使用 `20260904_employee_number_sequence.sql` 全量按入职日期、员工主键重排，现有工号无论是否为空或已占用都不保留，仅在审计表保存新旧映射。

跨应用调用只使用 `aud=console` 和 `console:hr-source-sync:view|execute|admin`，映射写入和缺失部门确认都需要标准 service-command HMAC。钉钉凭证仍由 Console Vault/Connector Runtime 管理，不进入 People。

内部 People runtime `POST /v1/people/service/hr-source-sync/dingtalk/departments:remap` 只接受固定 `client:people.runtime` 的精确 `people:hr-source-department-remap:execute` 能力与管理员 actor HMAC，并仅接收 People BFF 从已验真的 Console mapping response 提取的 aliases，批量更新 `people_employees.dept_code` 与 `people_assignments.dept_code`；它不是浏览器 API，也不得跨库读取 Console 表。Console 已提交但 People 暂时失败时，管理员可从页面对已绑定映射重新对账 People 引用。

## 受控入职

- `PATCH /api/admin/onboarding-cases/{code}`：HR 完善资料时无需填写工号；首次保存由 People 自动分配并在同一入职单后续流程中保持不变。
- `POST /api/admin/onboarding-cases/{code}/provision`：以 `object_version` CAS 进入身份预留，保存 `reservation_id` 后排队 LDAP 建号；`reserving_identity` 可用同一冻结命令继续，确定性冲突落入 `profile_conflict / identity_conflict / reservation_expired / provisioning_failed`，网络与 5xx 保留当前阶段等待幂等重试。
- `POST /api/admin/onboarding-cases/{code}/activate`：服务端验真本入职单的建号 operation 已成功，向冻结的钉钉主体投递一次性激活链接后，在一个 People 事务中创建员工、首次任职并冻结目录生命周期。
- `POST /api/admin/onboarding-cases/{code}/activation-link`：显式轮换并重发激活链接；旧链接立即失效。可用于账号已创建后的投递恢复或过期重发。
- `POST /api/admin/onboarding-cases/{code}/cancel`：要求至少 5 字符原因并保留审计；允许待完善、待开通以及已确认没有在途建号的失败状态取消。`reserving_identity / provisioning_account` 等仍在执行的记录必须先收口，账号已经创建则走正式停用流程。
- 受控激活把 `provider_code / provider_subject / corporate_email / mobile` 固化到员工目录快照，使后续 `people.directory.employment-sync.v1` 将钉钉主体绑定到 HR 确认的 canonical UID，不再生成 `dt-*` 登录名。
- `/api/admin/subject-merge` 的 POST 和 `/v1/people/subject-merge` 已 fail-closed 返回 410；在全应用引用扫描和跨库可恢复编排产品化前，只提供只读 preview，实际遗留主体迁移按审计 runbook 执行。

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
