# DEBUG REPORT — People 跨应用操作列表返回 500

日期：2026-09-01
入口：`GET /api/v1/integration-operations?limit=50`

## Symptom

- People 的“跨应用操作”页面连续两次请求列表接口，均返回 HTTP 500。
- 同一页面控制台报告无法加载图标 `lucide:refresh-cw-cog`。

## Root cause

Data Runtime 的 People 适配器会把跨应用操作查询结果包装为
`{ code: 0, message: "ok", data: result }`。People BFF 的
`callPeopleIntegrationOperationAdmin` 在回归后却把整个包装对象当作业务结果返回，列表安全投影
因拿不到顶层 `items` 而以“diagnostic items are malformed”失败，最终对浏览器表现为 500。

图标问题相互独立：菜单配置使用了 Lucide 中不存在的 `refresh-cw-cog` 图标名。

## Fix

- 恢复 People BFF 对 Runtime 标准响应包装的解包，只把内层 `data` 交给列表、尝试记录和重放
  投影。
- 对 Runtime 非零业务码和缺失 `data` 的异常响应显式返回 502，避免再次把结构错误伪装成
  业务数据。
- 将无效图标替换为已使用且可加载的 `refresh-cw`。

## Evidence

- 生产 `hzy-data-runtime` 日志显示两次对应的
  `people.integration_operations.diagnostics.list` 均返回 HTTP 200，耗时分别为 6ms 和 5ms；
  因此数据库与 Runtime 查询正常，500 位于 People BFF 的后续解包/投影阶段。
- Git 历史显示提交 `41ab3c31` 删除了原本存在的 `RuntimeEnvelope<T>` 与
  `runtime.data.data` 解包逻辑，和故障调用链完全吻合。
- 两项聚焦回归在修复前失败、修复后通过。
- People 全量测试 103/103 通过，lint、Nuxt typecheck 与 `git diff --check` 均通过。

## Regression test

- `people/test/integrationOperationDiagnosticProjection.test.ts`
- `people/test/hrSourceSyncBoundary.test.ts`

## Status

DONE_WITH_CONCERNS：本地代码已修复且自动化校验通过；没有可连接的 Browser/Chrome 实例，
未能在真实登录页面复测，也未执行生产部署。线上生效只需发布 People Worker，Data Runtime
不需要为本次问题改版。
