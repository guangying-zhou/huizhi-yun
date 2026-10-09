# 企业微信通知链接落入共享 Console 激活页

## DEBUG REPORT

- **Symptom**：wiztek 企业微信测试通知可以送达，但在企业微信内点击后进入 Console 激活页，页面显示 `tenant context is required; access Console through Tenant Gateway`，Tenant/Deployment 为空。
- **Root cause**：旧版 `sendWecomIntegrationTestMessage` 使用 Console Worker 收到请求后的 `getRequestURL(event).origin` 生成卡片 URL。Tenant Gateway 会把请求代理到租户中立的 `console.huizhi.yun` Worker，因此卡片携带的是共享 Console origin，而不是用户访问的 `wiztek.huizhi.yun` 租户域名。
- **Fix**：`notificationTestActionUrl` 优先使用经过 Tenant Gateway 内部令牌验证的 `x-forwarded-host` 生成 `https://wiztek.huizhi.yun/notifications`。如果请求声明来自 Tenant Gateway、但受信上下文无法解析，则返回 503 并停止发送，禁止退回共享 Console origin。非 Tenant Gateway 的单租户/本地部署继续使用请求 origin。测试结果通知本身不再附带返回运行时配置页的操作按钮。
- **Evidence**：Console lint、typecheck、Cloudflare dry-run 和完整测试通过；完整测试 340 项中 339 通过、1 项环境跳过、0 失败。生产 Console 已部署版本 `db570868-6e94-4373-9082-f6d9e5448657`。部署后通过已登录的 wiztek Console 向 `zhouguangying` 真实发送测试通知成功，页面显示“企业微信测试消息已发送 / 接收人：zhouguangying。发送记录已保存到消息中心。”；统一消息中心生成记录 `notif_6ba6417b-58fc-4841-974e-8173335eaf59`，详情不再提供返回通知运行时的操作按钮，页面无横向溢出或浏览器错误。
- **Regression test**：`console/test/notificationPublishPermission.test.ts` 固定校验受信 Tenant Gateway URL 优先、网关上下文异常时失败关闭、非网关部署才允许 request-origin fallback。
- **Related**：截图中的 Last Check 为 `2026-07-15T02:06:06.637Z`，早于包含租户 URL 修复的生产部署。旧消息中的 URL 不会被追溯修改，必须点击部署后新发送的消息验收。
- **Status**：`DONE_WITH_CONCERNS`。代码、部署和真实发送已验证；企业微信移动端最终点击需要用户在客户端完成，预期进入租户工作台 `https://wiztek.huizhi.yun/notifications`（未登录时应进入租户登录流程），不应再进入运行时配置页或共享 Console 激活页。
