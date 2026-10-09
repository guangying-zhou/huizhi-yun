# AIMS 开始执行任务 503 排障记录

## 现象

- 在汇智云项目的任务看板中点击“开始执行”，`PUT /aims/api/v1/work-items/287` 返回 503。
- 失败任务为 HZY-1-1（编制《项目计划书》）。

## 定位证据

- AIMS 专用 PUT handler 将请求转发到 `PUT /v1/aims/work-items/287`。
- data-runtime 生产日志记录了真实上游错误：

  ```text
  Error 1054 (42S22): Unknown column 'wse.delivery_generation' in 'field list'
  /v1/aims/work-items/287 -> 500 internal_error
  ```

- `hzy_aims.work_item_service_ext` 线上表存在，但只有 v4.9 的初始字段，缺少 v5.4 引入的 `delivery_generation` 和 `last_delivery_status`。
- compat schema status 只检查必需表，AIMS `requiredTables` 又未包含 `work_item_service_ext`，因此发布前没有报告结构漂移。

## 根因

data-runtime 二进制已升级到使用工单投递代次字段的版本，但生产 AIMS 数据库没有执行 `migration_v5.4_service_ticket_delivery_generation.sql`。任意工作项状态变更都会进入工单同步 hook，SQL 在解析缺失列时立即失败；AIMS 将上游 500 统一映射为 503。

## 修复

- 在生产 `hzy_aims.work_item_service_ext` 表补齐两个缺失字段。
- 新增可重复执行的 v5.7 修复迁移，供其他环境安全补齐。
- compat schema status 新增必需列检查；AIMS 明确要求 `work_item_service_ext` 表及两个投递代次字段。
- 新增 schema mismatch / schema ok 回归测试和 AIMS schema 配置契约测试。

## 验证

- 线上字段结构查询确认两列存在。
- 在事务中重放原失败 SELECT 成功，随后回滚，无业务数据变更。
- 在已登录生产页面重新点击同一任务“开始执行”，页面显示“已开始执行”并进入执行页。
- data-runtime 日志确认 `aims.work_items.update` 返回 200，耗时 6ms。
- `go test ./...` 与 `go vet ./...` 全部通过。
