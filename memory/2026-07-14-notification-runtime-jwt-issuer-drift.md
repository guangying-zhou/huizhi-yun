# DEBUG REPORT — Notification Runtime JWT Issuer Drift

- **Symptom:** Console 通知运行时配置检查通过，但企业微信测试发送依次出现 401、409 和 404，页面只显示概括性错误。
- **Root cause:** 第一处为 Console 已固定使用规范 OIDC issuer `https://console.huizhi.yun`，而客户服务器上的 notification-runtime 仍保留旧 JWT issuer。修复后暴露出第二处初始化缺陷：Console 安装器把 notification-runtime service client 的 `app_code` 强制写成 `NULL`，导致运行时出站 token 缺少 `source_app`。同时旧安装脚本的 `systemctl enable --now` 不会重启已运行服务，使旧 token 最长继续缓存约 15 分钟。第三处是安装命令把规范 issuer 同时写成租户 Integration API base；Runtime 直接请求 `console.huizhi.yun` 时没有 `wiztek` 租户网关上下文，因而读取 `wecom.default` 返回 `Integration not found`。
- **Fix:** Console 配置检查新增无副作用 JWT 探针；安装器把 notification-runtime 的 `client_code/app_code` 都幂等绑定为 `notification-runtime`，配置检查新增完整服务身份项并自愈历史漂移；安装脚本改为每次安装都明确 restart；安装元数据将租户 API origin 与规范 token issuer 分离。
- **Evidence:** Cloudflare 生产 tail 依次记录 `invalid issuer`、`service integration identity is incomplete`，以及 Runtime 请求 `https://console.huizhi.yun/api/v1/console/integrations/wecom.default` 返回 `Integration not found`。notification-runtime Go 全量测试与安装脚本语法检查通过，0.1.4 已上传且公网 latest/install.sh 已校验；Console lint、typecheck 和 305 项测试通过（304 pass，1 skip）。最终实现同时消费租户网关保留的 `x-forwarded-host/proto`，Console 最新修复已部署为 Cloudflare Version `48405dcb-e793-4a4a-b827-1f5ca0c12e40`。
- **Regression test:** `console/test/notificationPublishPermission.test.ts` 覆盖无发送认证探针、issuer/identity 错误映射、安装器身份绑定、自愈及租户 API/issuer 分离；`notification-runtime/internal/deliveryledger/mysql_test.go` 覆盖重装必须重启已有服务。
- **Related:** 这是配置漂移问题。2026-07-13 的 Console issuer 规范化只修正新签发和新安装命令，不能自动重写已安装 runtime 的 `.env`。
- **Status:** PENDING_PRODUCTION_ACCEPTANCE — 代码、测试、Console Cloudflare 发布和 notification-runtime 0.1.4 发布已完成；客户实例需要应用新租户 API 地址后验证真实发送。
