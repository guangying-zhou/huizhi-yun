# DEBUG REPORT: 反馈 Issue 未发送企业微信通知

- **Symptom:** 用户通过 Foundation 页面“反馈”按钮提交后，WebDev Issue 收件箱可以收到 Issue，但配置的管理员没有收到企业微信提醒。
- **Root-cause chain:**
  1. `notifyFeedbackRecipients()` 读取 `feedback.notify.wecomUsers` 时没有把当前 `H3Event` 传给 `getRuntimeSetting()`；统一通知读取 Connector 开关和 Runtime 地址时也丢失了同一请求上下文。
  2. Shell 的反馈来源最初取宿主 Console，而不是当前 iframe 应用，导致 AIMS 反馈显示为 `console`。
  3. 即使传入 event，Foundation 仍以公网 fetch + `Authorization` 请求 Console 设置/通知端点，没有使用 `HZY_CONSOLE_SERVICE` Service Binding 转发已验证的 Tenant Gateway/Data Runtime 上下文，生产设置读取返回 `503 Console tenant-runtime is required`。
  4. 改用 Service Binding 后，Console 通用浏览器认证中间件又在目标 handler 之前按 `aud=console` 拒绝了 `aud=system_settings` 等精确服务令牌；设置值与通知 lifecycle 端点缺少精确 bypass。
  5. 最后一跳 Connector Runtime 是每租户一个、登记在 `C000001-console` 的共享 supporting service，但旧 JWT 校验要求调用令牌 deployment 必须等于登记 deployment。AIMS 的有效、已内省、具备精确 `connector-runtime:notifications:send` grant 的 `C000001-aims` 令牌因此在进入投递 ledger 前被 `deployment_mismatch` 拒绝。诊断计数在失败请求后保持 `failed=4/succeeded=4`，证明供应商投递尚未开始。
- **Fix:**
  - 所有反馈/通知运行设置读取都透传当前 event；Shell 从当前业务 iframe 解析可信来源应用。
  - 托管云业务 Worker 对 Console 设置、站内通知及 lifecycle 的服务调用统一使用 Service Binding，并只转发已验证的租户/运行时头。
  - Console 仅对由目标 handler 自行完成精确服务令牌校验的设置值、通知 publish/actionable/dead-letter 端点跳过通用浏览器认证。
  - Connector Runtime 保留签名、introspection、tenant、audience、exact scope、来源应用与 body 一致性校验，并用令牌中的可信来源 deployment 分区 ledger/audit；只是不再把同租户业务部署误当成必须等于登记 Connector 的 Console deployment。旧 Notification Runtime 继续严格匹配 deployment。
- **Regression tests:**
  - `foundation/test/runtimeSettingsTenantContext.test.ts` 覆盖 request-bound Console Service Binding 与可信运行时头。
  - `foundation/test/consoleAuthBypass.test.ts` 覆盖设置值和通知精确服务端点进入各自 handler 校验。
  - `notification-runtime/internal/auth/auth_test.go` 覆盖 Connector 接受同租户已授权业务 deployment、仍拒绝其他 tenant；`internal/config/config_test.go` 固定该行为只由 Connector 配置启用。
- **Validation:** Foundation 全量 314 项、Console 全量 414 项、AIMS 265 项测试通过；Connector Runtime `go test ./...` 与 18 项发布/安装/SLO 脚本测试通过。AIMS Worker、Console Worker 和 Connector Runtime `0.4.26` 已发布。
- **Production acceptance:** 最终 AIMS 反馈请求返回 200，`feedback.notify.wecomUsers`、站内 publish、Connector 开关和 Runtime 地址读取全部返回 200；Connector `0.4.26` 的耐久投递计数从 `succeeded=4` 增至 `succeeded=5`，`failed=4` 未增加。管理员随后确认实际收到企业微信消息。
- **Commits:** `943b7033`, `670f5a28`, `5dbbf89a`, `56e5f37e`, `7f454e1b`。
- **Status:** DONE（代码、自动化、生产部署、耐久投递事实与真实收件人验收全部通过。）
