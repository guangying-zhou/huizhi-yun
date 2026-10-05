# 周报列表分页与完整合计

## 全局周报（P5b1）

`GET /api/v1/weekly-reports`；Host `/aims/api/v1/weekly-reports`。既有固定操作 `aims.weekly-report-overview`，Runtime `POST /v1/enterprise/aims/weekly-report-overview:view`，capability `aims:weekly-report-overview:view` 不变。当前 Console `weekly_reports:view` 与当前项目范围仍必需，不新增 grant。

可选 `page`（1–1000000）、`pageSize`（1–100），任一出现启用分页，默认 1/20。拒绝重复/空/小数/负值/超限参数。原 year/week、deptCode/category、includeWorkItems 保留。不带页参数维持原五字段响应与原搜索合同。

分页返回 `{items,total,page,pageSize,meta,summary,charts}`。items 为当前页完整项目摘要；includeWorkItems=1 仅附加页内报告的完整工作项。total 是关键词过滤后的可见项目数；越界空页仍保留真实 total 和统计。

`summary`：total（完整可见项目数）、filled（有当前周报数）、currentDays（当前报告工时/8）、actualDays（当前 ISO 周未关联 weekly_report_id 的实际工时/8，沿原全部审核状态）、previousDays（前一 ISO 周报告工时/8）、deltaDays、memberSlots（跨项目参与人次，非去重人数）、cumulativeLaborCost（当前报告累计人力成本合计，空值按 0）。

`charts` 为完整集合的工作量 Top10+其他、成员/变化/成本 Top14，稳定并列按项目 id；变化保留逐项目 round2 和绝对值排序。所有统计不依赖页码或表格关键词。可见性、默认非归档、部门/类别过滤影响统计和列表；表格 search 仅影响 COUNT/items。COUNT、items、完整统计、工作项在同一 read-only RR snapshot；当前成员等范围事实同事务读取。

分页模式 search 按字面包含（%/_ 不作为 SQL 通配符），匹配 Aims 项目名/项目编码/内部编码/部门编码/负责人 UID、周报已有部门和负责人快照名。不新增 Console 名称查询：当前目录改名后的展示名若尚未写入周报快照，可能搜不到；Directory 回退展示仍保留，但不作为搜索事实。BFF 不进行页后过滤。

## 成本显示纠正

`cumulativeLaborCost` 保持数据库累计人力成本含义，历史数据和写入字段未改。过去全局将 10000 显示为 10000 人天；现在统一“累计人力成本”，显示 10,000.00，不自行标币种。没有单价与币种依据，不能转换成累计人天。人天指标只从对应 hours/8 产生。

## 验证边界

自动化覆盖旧响应、106 项目跨页与越界、完整统计/排行、成本单位、快照搜索/字面通配字符/目录改名限制、跨年与周日时间窗、当前关系变更、BFF 参数/权限与可信范围。真实登录和 1440/390 验收由协调者在 P5b 完成部署后安排；本批不部署、不重启、不写环境或 grant。

## 项目周期与明细（P5b2）

`GET /api/v1/projects/:id/weekly-reports`（Host 同 `/aims` 前缀），原固定 `aims.weekly-report-list`；可选 page/pageSize 1–1000000/≤100、year/week、includeWorkItems。无页原响应不变。分页 COUNT/items 同 read-only RR，重复执行原项目读范围检查；按 report_year/week/id DESC 稳定排序。额外 `calendar` 是独立轻量年度周状态投影（year筛选，独立于 page 和 week），周历不能从当前页重建。

`GET /api/v1/projects/:id/weekly-reports/:periodKey`，原 `aims.weekly-report-view` / `aims:weekly-reports:view`。page/pageSize 启用明细投影；`includeBaseline=1` 仅为初始化完整草稿使用，BFF要求同时有分页，不接受浏览器 uid、身份、写权限或审核 flag。旧无页返回完全不变。分页响应：

- report：当前报告元数据，省略 entries/workItems。
- entriesPage：`{items: uid[],total,page,pageSize}`，活跃成员与报告历史 entry 的 UID 并集，BINARY UID稳定排序。参与认定的完整初始化分母包括历史非活跃 entry。
- workItemsPage：`{items: id[],total,page,pageSize}`，按 sort_order/id 稳定分页。
- summary：persistedRecognizedHours、persistedMemberCount、persistedAllocationPercentAverage、persistedWorkloadDays 是完整已保存集合；initializationMemberCount 为活跃成员+历史 entry 并集。它们不等于初始化草稿的默认标准工时/分配率。
- history：选中周期之前最近非空累计成本，以及原向前扫描“前次变化进度”的百分比和 ISO 周锚点，独立于列表页/年度/明细页。
- baseline：仅 includeBaseline=1 返回完整已保存报告、entries、workItems；未建报告为 null。普通翻页没有该完整载荷。由于旧写合同是整份替换，完整写输入必须初始化保留，不能通过只载入第一页伪装成完整草稿；本轮不改写合同为差量或引入 CAS。

上述授权门槛、报告、COUNT、page、完整统计与历史事实在同一 RR snapshot。旧项目读与当前负责人/代理判定直接复用已有 owning helper（允许 DB/transaction 参数），没有重写权限算法或扩大服务 grant。

实际工时仍独立走原 `timesheet:view` + 项目范围读取。既有 `GET /api/v1/projects/:id/time-entries` 可选 `includeUidHours=1`，必须带分页，返回 `summary.uidHours:[{uid,hours}]`；同原完整 WHERE/snapshot 分组，前端 page1/pageSize1 即可取得完整期间按 UID 实际工时。周报读取许可绝不包含该实际工时查询，不因拥有 weekly_reports:view 就越过 timesheet:view。

Host 周期、成员、工作项使用独立页状态；成员/工作项分页请求只更新显示标识，完整初始化基线与按对象的草稿编辑保留。工作项新增/删除后使用完整草稿合并后的页投影/真实草稿条数，避免删除导致最后一页隐藏；后端持久记录 page/total 保持原事实。保存仍序列化完整草稿，并刷新写入后新 ID 的页标识。基线不完整不能保存/提交；显式401/403清理私有草稿与参考数据，503显示重试、保留完整草稿并禁用保存，期间/身份变更隔离迟到响应。当前报告/成员变化提示重新初始化（useConfirm警告丢弃草稿），不是服务端 CAS 保证。

已知限制：完整初始化载荷仍随报告明细规模增长，这是保留既有整份替换写合同的必要边界；成员目录/工作日历仍沿既有独立读取，期间实际工时与周报不构成跨接口单一快照。CAS、差量写合同和超大草稿分段存储不在本轮批准范围。真实部署与登录验收待协调者安排。
