# 普通工时列表分页与完整汇总（P5a1）

## 路径与兼容

- Host：`GET /aims/api/v1/users/:uid/time-entries`、`GET /aims/api/v1/projects/:id/time-entries`。
- 固定 Enterprise Runtime 操作沿用 `aims.user-time-entry-list` / `aims.time-entry-list`，精确 capability 沿用 `aims:user-time-entries:view` / `aims:time-entries:view`，不新增 grant 或路由。
- Owning Runtime：`GET /v1/aims/users/:uid/time-entries`、`GET /v1/aims/projects/:id/time-entries`。
- 无 `page/pageSize`：保留原 `{items,total,page:1,pageSize:items.length}`、全量排序与字段；Finance/People 的既有完整期间读取不受影响。
- 有任一分页参数：默认 page=1、pageSize=20，page≤1000000、pageSize≤100，返回 `{items,total,page,pageSize,summary}`；正整数规范形式，拒绝重复、空值、混用 cursor/limit/page_size。

## 筛选与权限

`startDate/endDate` 为真实 ISO 日期、闭区间。user 页可用 `projectId` 收窄本人记录，mine 视图由此在 COUNT/page 前筛选。`cycleCode` 保留既有接受但不生效语义，不冒充正式周键。project 页可用 `uid` 收窄。

本人记录保持原 uid 所有权及 `weekly_report_id IS NULL`，不以当前可填报项目候选删除历史记录；Host 当前会话与 Runtime 已验签 actor 一致，其他 uid 被拒绝。项目先执行原范围 gate，分页集合再在同 read-only RepeatableRead 内带相同动态项目可见性；COUNT、明细与 SUM/GROUP BY 同快照。无状态过滤，含 draft/returned/submitted/approved。

`calendarProjectId` 只收窄明细、total 与日历展示汇总；旁栏项目桶、当日全项目基线与选中周状态计数保持原 base 集合。所有小时按数据库 DECIMAL 汇总、整数百分之一小时累加，不由当前页估算。

## 汇总字段

- `totalHours/positiveDays`：完整请求区间与选中项目集合；保留原跨月凸包语义。
- `monthHours/monthPositiveDays/monthMissingDays`：明确 `monthStart/monthEnd` 自然月与原集合交集；missingDays 截至 `todayDate`、每日≤0。
- `todayHours/weekHours`：显式 todayDate / weekStart、weekEnd 与查询集合交集。
- `dailyHours[] {date,hours,entryCount}`、`dailyProjectHours[] {date,projectId,projectCode,projectName,hours,entryCount}`：完整展示集合；按日、项目归并，不含描述或工作项正文。
- `baseDailyProjectHours[]`：选项目前的当日各项目汇总，供新增填报基线。
- `projectHours[] {projectId,hours,distinctEntryDays}`：base 全项目，含零小时日期的 distinct 天数。
- `weeklyHours[] {weekStart,weekEnd,hours,entryCount}`：完整展示集合按 ISO 周归并。
- `weekStatusCounts {draft,returned,submitted,approved}`：base 全项目、显式选中周的完整条数。

month 参数必须成对且为自然月首末日，week 参数成对且相隔六天；汇总锚点要求分页。锚点只是统计维度，不授予权限，不扩大查询范围；浏览器授权 flag 不在白名单。

## 页面与已批准的值修正

个人月 badge 改用自然月字段。项目周日在本地 Date 运算后保持原 UTC 日期序列化，周末上界改为当前 Sunday；日期筛选仍求交。个人今天保持原本地日期语义。

日历请求只取 page1/pageSize1 及完整分组摘要；日编辑器真实每页20条，共 N 条，全天合计=服务端基线+当前草稿差量。基线加载失败关闭保存；带草稿翻页用 useConfirm warning。项目明细每页20条，mine 筛选前置；Host 首页本周小时取完整 summary.totalHours。

摘要含完整日期/项目分组，大小随区间与项目数增长；此批减少记录/描述传输，不声称分组响应大小恒定。项目候选仍是既有独立 P6a 任务。审核队列 periodKey 与 approve/assigned-review 合同留 P5a2 裁定，不改审核写流程。

## P5a2 审核队列读取与写入口状态

`GET /aims/api/v1/projects/:id/time-entry-reviews` 浏览器仅接受 `periodKey/page/pageSize`；periodKey 为真实 ISO 年周（1970年起），拒绝无53周年份的 W53、别名和审核 flag。复用固定 `aims.time-entry-review-list` 与精确 `aims:time-entry-reviews:view`，不新增grant。

Host 以当前 Console 的 timesheet:approve OR timesheet:submit 取得入口资格，每个 action 自己的 scoped grants 通过 Foundation 编译为结构化项目事实投影；不同权限分支不拼接 scope，元数据不一致失败关闭。既有通用 actor 签名不覆盖body；Foundation signHmac 对队列专用 canonical 独立签名，覆盖主体/租户/部署/项目/期间/query、各分支范围与授权元数据及最早期限。Runtime 先验精确服务身份、当前 credential/grant、actor、permit绑定和HMAC，再用当前项目/成员/部门树事实判定。

审核范围无 projects:view 的公开项目豁免；有 approve 也始终约束 `reviewer_uid_snapshot=actor`、project_id、正式周、project_manager 路由及 submitted/approved/returned。scope项目 gate、COUNT、状态计数与page在同read-only RR。未匹配项目范围403，授权内但未被分派返回空集合；无分页参数保留 `{periodKey,items,total}`，分页返回 `{periodKey,items,total,page,pageSize,statusCounts}`。full submitted badge 不随page变动；当前页选择只对应当前页。

完整审核写合同批准前，Host POST固定403 `Host timesheet review is unavailable`，页面隐藏确认/退回/审核弹窗并明确说明，不能以edit冒充approve；Standalone既有写流程保留。审核读取完成不表示审核写动作启用。
