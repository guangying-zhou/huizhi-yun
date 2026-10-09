# WebDev 菜单与授权接口 403 修复记录

- 日期：2026-08-27
- 租户：C000001 / wiztek.huizhi.yun
- 状态：DEPLOYED_AND_VERIFIED
- 影响应用：WebDev

## 现象

登录汇智云后打开 WebDev，侧边菜单为空，浏览器控制台中的下列请求统一返回 403：

- `GET /webdev/api/auth/permissions`
- `GET /webdev/api/webdev/jobs`
- `GET /webdev/api/webdev/agent/enrollment`
- `GET /webdev/api/workflow-proxy/tasks/pending`

Shell 登录态和 WebDev 应用入口正常，说明不是整站会话过期。

## 生产证据与根因

Cloudflare Worker 日志复现到所有受影响接口都先输出：

```text
[webdev] Console application grant check failed:
[GET] "https://console.huizhi.yun/api/v1/console/user/applications": 503 Service Unavailable
```

根因是 WebDev 的旧鉴权实现仍用公网 URL 调用 Console 的应用列表和权限接口，
没有使用 Worker 已配置的 `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding。
应用授权调用失败后，代码把异常吞成 `false`；权限快照调用失败后又吞成空资源，
最终把授权依赖的 503 伪装成用户缺权 403。菜单依赖 `webdev_workspace`
权限资源，因此权限快照为空时所有菜单同时消失。

## 修复

- 应用授权查询改为 Foundation `fetchConsoleServiceJson`，优先经
  `HZY_CONSOLE_SERVICE` Worker 间直连，并转发租户网关与用户认证上下文。
- 权限快照改为 Foundation `loadAuthorizationSnapshotFromConsoleRuntime`，不再维护
  WebDev 私有的公网 Console 客户端。
- Console 授权依赖不可用时保留 `503 Authorization Unavailable`；只有成功取得授权
  快照且缺少对应动作时才返回 403。
- 新增回归测试，禁止 WebDev 应用授权回退到 `$fetch` 公网调用，并锁定统一权限快照
  与 503 语义。

## 验证

- WebDev lint：通过
- WebDev typecheck：通过
- WebDev tests：20/20
- Foundation Console 授权与 Service Binding 定向测试：12/12
- 业务 Cloudflare 配置校验：通过（8 个模块）
- WebDev Cloudflare build 与 Wrangler dry-run：通过
- 登录态生产验收：上述四个原 403 请求均返回 200
- 生产页面侧栏恢复：总览、任务、Issue 收件箱、Diff 审查、部署、Agent、历史
- 生产任务列表成功加载 6 条记录

## 部署

- Worker：`hzy-webdev`
- Cloudflare Version：`a0230022-4218-4767-993c-f0a45b7f9a47`
- Service Binding：`HZY_CONSOLE_SERVICE (hzy-console-prod)`
- 流量：100%

## 独立观察项

审批角标内部申请 `workflow:proxy` service token 时仍记录 `insufficient_scope`，但该角标
接口已按可选能力降级为 200，不再产生浏览器 403，也不影响 WebDev 菜单和任务功能。
该 scope 应作为独立的跨应用授权项处理，不能通过放宽 WebDev 用户权限绕过。
