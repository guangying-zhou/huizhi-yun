# DEBUG REPORT — People 角色权限误判

日期：2026-07-18  
租户：C000001 / wiztek.huizhi.yun

## Symptom

- 已登录用户访问 `/people/` 后被重定向到 `/people/no-access`。
- 页面提示“当前企业角色没有 People 权限”。
- 当前用户实际已分配 `system_admin`、`general_manager`、`project_director` 和
  `project_manager`，生产策略包也包含 People 授权，因此页面提示与角色事实不符。

## Root cause

People 覆盖了 Foundation 的统一授权实现，在以下两处自建了旧 Console 权限代理：

- `people/server/api/auth/permissions.get.ts`
- `people/server/utils/peoplePermissions.ts`

旧代理把浏览器 Cookie/Authorization 直接转发给 Console
`/api/auth/permissions?appCode=people`，但没有使用已验证的
`event.context.consoleAuth.token`，也没有转发 Tenant Runtime URL、租户、deployment、
bootstrap token 和 audience 上下文。Console 因而尝试按自身 JWKS 校验 audience 为
`people` 的访问令牌，生产日志明确记录：

`Expected 200 OK from the JSON Web Key Set HTTP response`

权限快照没有成功返回，People 前端将其判定为无权限并跳转到 no-access。这是权限
调用链错误，不是角色配置缺失。

## Fix

- People 浏览器权限入口改用：
  - `requireFoundationSessionUid`
  - `loadAuthorizationSnapshotFromConsoleRuntime`
- People 服务端业务权限守卫同步切换到相同的共享 Runtime 授权通道。
- 返回权限快照增加 `private, no-store`，避免角色或模拟状态被缓存。
- 删除两处旧 Console origin、header 转发和 `$fetch` 权限代理实现。
- 增加回归测试，禁止 People 重新直连旧 `/api/auth/permissions`。

发布 People Worker：

- Version ID：`14d63316-38eb-4a8e-9bc5-d17e8da49347`

## Verification

- People 全量测试：68/68。
- People ESLint：通过。
- People Nuxt typecheck：通过。
- Cloudflare production build：通过。
- `git diff --check`：通过。
- 生产 Cloudflare tail：
  - `GET /people/api/auth/permissions`：Ok。
  - 新链路 `GET /api/v1/console/user/permissions?appCode=people`：Ok。
  - `GET /people/api/v1/dashboard/overview`：Ok。
- 已登录内置浏览器：
  - `/people/` 保持在工作台，不再跳转 `/people/no-access`。
  - 工作台成功显示 83 名在职员工、94 条当前任职及绩效周期数据。
  - `/people/employees` 成功显示员工台账，共 91 人。

## Non-blocking observation

Console tail 仍可见其他会话桥接请求对 `/oauth/userinfo` 的既有 JWKS 告警，以及反馈
设置读取的 service token introspection 告警；本次 People 权限快照、Dashboard 和员工
台账均已成功。这些告警不再导致 People 权限误判，可作为后续统一会话链路降噪任务处理。
