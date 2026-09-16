# Platform Runtime 批准后企业目标版本滞后

## Symptom

- Platform Admin 批准 `0.3.137` 后提示成功，稳定渠道最终显示 `0.3.137`。
- 企业控制台仍显示 Runtime `0.3.133 / 0.3.129`，并报告 `runtime_version_incompatible`。
- Admin 批准后的同 URL 刷新短时间内也可能继续显示旧的 bootstrap 版本。

## Root cause

`approveDataRuntimeRelease()` 只更新
`platform_runtime_release_channels` 和审计日志，没有同步更新
`tenant_runtime_instances.desired_version`。企业控制台读取实例行，因此在下一次 Agent
heartbeat 校准前继续显示旧目标。两个运行状态 GET 接口也没有明确禁止缓存，批准后的
刷新可能复用旧响应。

## Fix

- 在批准/回滚渠道的同一事务内，将签名 key 一致的 Runtime 实例
  `desired_version` 更新为新稳定版本，并在批准回执及审计记录中包含更新实例数。
- 企业部署设置以数据库稳定渠道作为有效目标版本事实源；已发生的批准无需再次操作，
  即可显示正确目标。实例行仍由 heartbeat 最终校准。
- Runtime Admin 与企业部署设置响应增加 `private, no-store`，Admin 刷新请求同时使用
  `cache: no-store` 和时间戳。
- 当前版本仍只由 Agent heartbeat 上报；批准后预期先显示
  `0.3.133 / 0.3.137`，升级完成后再显示 `0.3.137 / 0.3.137`。

## Regression coverage

- `platform/test/dataRuntimeReleaseAdminContract.test.ts`
  - 批准必须更新 `tenant_runtime_instances.desired_version`。
  - 只更新 release signing key 一致的实例。
  - 两个动态状态接口与 Admin 客户端必须绕过缓存。
- Platform：229 项测试、typecheck、lint、生产构建通过。

## Related Console deploy failure

同一轮检查发现 Console Cloudflare 发布被过时的源码契约测试拦截：布局已在
`filterMenus(rawMenus)` 后映射 `expandCurrentRouteGroups`，测试仍要求直接 return。
已更新断言，同时验证权限过滤和当前路由分组展开；Console 388 项测试、lint、
typecheck、Cloudflare 构建及 Wrangler dry-run 均通过。

## Status

Resolved in workspace. Production requires deploying the updated Platform and Console artifacts.
