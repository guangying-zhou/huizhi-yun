# 2026-07-21 Console OIDC session expiry and concurrent login recovery

## DEBUG REPORT

- Symptom: People、Finance 等业务应用在页面已经完成 OIDC 登录并可用时，控制台仍间歇记录 `POST /<app>/api/auth/refresh 401`；session 过期后偶尔需要发起两次登录才能成功。
- Evidence collected: 生产请求的 refresh 响应为 `{"ok":false,"expiresIn":null}`。Tenant Runtime 同时记录 Console refresh-token consume 返回 `400 invalid_grant: session revoked or expired`。相关 refresh token 记录仍为 active，但其绑定的 Console local session 已超过 8 小时有效期；同一时段可见并发授权流程生成多个 code，而只有一个 callback 成功消费。
- Root cause: Foundation 仅凭长期 HttpOnly refresh Cookie 存在就持续尝试刷新，并把所有失败统一改写为 401；业务应用的 refresh Cookie 默认保留 30 天，明显长于 Console local session 的 8 小时。与此同时，同一应用的 OIDC state、nonce、PKCE verifier 和 redirect 使用固定 Cookie 名，并发授权会互相覆盖，造成 callback state/verifier 冲突和“需要登录两次”。
- Fix: Console 签发的 refresh token TTL 现在受绑定 local session 剩余有效期约束，并通过 `refresh_expires_in` 返回实际寿命；Foundation 按该寿命设置 refresh Cookie。预期的 missing refresh token / `invalid_grant` 以 typed `200 reauthenticationRequired=true` 触发一次正常重认证，其他上游错误保持原状态码。OIDC 临时 Cookie 改为按 authorization state 隔离，并保留旧固定 Cookie 回调兼容路径。
- Regression tests: 新增 Foundation 并发 state Cookie 隔离和 refresh 错误分类测试；扩展 refresh recovery 测试，确保预期 session 失效不再变成 401、基础设施错误继续抛出且失败不删除可能已并发轮换的 Cookie。新增 Console refresh TTL 单元和源码契约测试，覆盖 30 天配置被 8 小时 session 截断、短 TTL 保留、临近过期不签发，以及两个 OAuth grant 均返回实际寿命。
- Verification: Foundation lint、typecheck 和全量测试通过（269/269）；本次补充后的 Foundation 定向测试通过（11/11）。Console lint、typecheck 和 OIDC 定向测试通过（4/4）；Console 全量测试 386/387，其中唯一失败是既有 `consolePolicyConsumption.test.ts` 对当前菜单映射实现的过期源码正则断言，本次未修改对应布局或该测试。三个仓库 `git diff --check` 通过。
- Status: DONE_WITH_CONCERNS. 修复尚未发布，因此还不能在生产 People/Finance 上确认 refresh 请求不再显示 401；生产生效需要发布 Console 以及继承 Foundation 的业务应用。
