# AIMS 工作项重复更新 404 排障报告

## 问题现象

- 生产环境请求 `PUT /aims/api/v1/work-items/287` 返回 `404 Not Found`。
- data-runtime 审计日志显示该请求已到达 `/v1/aims/work-items/287`，错误码为 `record_not_found`。
- 同一工作项的 transitions、documents、time-entries 和 execution-context 均能正常读取。

## 证据与根因

- 2026-08-26 01:42:40（生产服务器时间），工作项 287 的首次状态更新成功，runtime 记录 `aims.work_items.update` / `200`。
- 生产数据库中该行仍存在：`287 / HZY-1-1 / in_progress / project 257 / milestone 134`。
- 2026-08-26 01:45:08 对同一工作项再次写入当前状态时，runtime 返回 `record_not_found` / `404`。
- `HandleRuntimeUpdateWithTxHook` 将 MySQL `RowsAffected() == 0` 直接解释为记录不存在。MySQL 默认返回实际变更行数，对已经是 `in_progress` 的行再写 `in_progress` 会返回 0，因此幂等更新被误判为不存在。

## 修复

- 事务更新返回 0 行变更时，在同一事务内按原 identity `WHERE` 条件查询记录是否存在。
- 记录存在时将请求作为合法幂等更新，继续执行事务 hook 并返回当前资源。
- 只有确认记录不存在时才返回 `record_not_found`，且不执行 hook。

## 回归验证

- 新增“已有记录重复写入同值”测试，要求提交事务、执行 hook 并返回成功。
- 新增“真实缺失记录”测试，要求返回 404、回滚事务且不执行 hook。
- `go test ./...` 通过。
- `go vet ./...` 通过。

