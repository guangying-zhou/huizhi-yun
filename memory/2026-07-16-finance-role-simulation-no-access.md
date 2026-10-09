# Finance 角色模拟误跳无权限页排障报告

## Symptom

- 在 Wiztek 租户模拟 `hr_specialist` 后访问 `/finance/`，页面跳转到
  `/finance/no-access`，提示“当前企业角色没有财务权限”。
- 该角色按审计约定应保留登录用户 Finance 基线权限，至少可以查看财务工作台。

## Root cause

生产策略和 Console 授权链路本身正常：

- 截图时间窗口内的角色模拟审计记录为 `includeBaseline=true`，策略包版本为
  `pv_prod_20260716115323_0080`。
- `0080` 与后续 `0081` 都包含 `finance:dashboard:view` 基线授权；模拟操作者是
  active user subject，未被该基线授权排除。
- 同一时间窗口 Console 成功完成 62 次 Finance token introspection，没有失败记录。

Finance 客户端的授权状态却在模块顶层由 `createAuthorizationState()` 创建。Nuxt
Worker 的 SSR 模块会跨请求复用，因此一个请求产生的空授权快照可能被后续用户请求
继续读取，导致路由中间件错误跳转到 `/no-access`。客户端随后重新加载到正确权限时，
无权限页也没有监听权限恢复，页面会继续停留在错误状态。

## Fix

- 新增基于 `WeakMap` 的 scoped runtime registry，以当前 Nuxt app 为作用域保存授权
  state、重试计数、timer、fingerprint、generation 和 watcher 状态。
- SSR 中每个 Nuxt app/request 获得独立授权状态；浏览器端同一个 Nuxt app 仍复用同一
  state，保留原有缓存与并发加载语义。
- `/no-access` 监听 `finance:dashboard:view`，客户端授权刷新成功后自动返回财务工作台。
- 新增请求隔离行为测试和授权恢复页面契约测试。

## Verification

- 回归测试先失败，修复后通过。
- Finance 全量测试：95 passed，0 failed。
- Finance typecheck、ESLint、`git diff --check` 均通过。
- Cloudflare 生产 Worker：`cfd36957-d34c-45af-a3f3-a68cc4a6cb77`。
- 新版本保留 `HZY_CLOUDFLARE_INTERNAL_TOKEN` 与 `HZY_TENANT_GATEWAY_TOKEN` secrets。
- `https://wiztek.huizhi.yun/finance/` 返回 200。
- 当前生产入口引用的 JS/CSS 静态资源均返回 200。
- 未登录访问 `/finance/api/auth/permissions` 返回预期 401，而非 5xx。

## Regression tests

- `finance/test/authorizationHydrationReload.test.ts`
- `finance/test/scopedRuntimeRegistry.test.ts`

## Status

DONE_WITH_CONCERNS：代码已修复并部署。当前本机 Chrome 登录会话已失效，因此未执行新的角色模拟
点击验收；生产策略事实、截图时审计、自动化回归和生产 HTTP 健康检查均已通过。
