# 跨应用 Service Token 403 排障记录

- 日期：2026-07-26
- 状态：DONE
- 影响应用：Aims、Altoc、Assets；同时核查并加固 Finance、People、Codocs、Workflow、WebDev

## 现象

多个应用通过 Console 申请运行时 Service Token 时返回 403，生产 Data Runtime 日志包含：

- `console_service_token_grant_inactive`
- `runtime-app-identities/consume insufficient_scope`

失败请求需要 `<app>:integration_operation:execute`，但 Aims、Altoc、Assets 的运行身份只有管理界面使用的复数 `integration_operations:view/replay` grant。

## 根因

1. Console 对 Service Token 请求中的每个 scope 做精确、独立的 active grant 校验。
2. `<app>.write` 不蕴含 `<app>:integration_operation:execute`。
3. 单数 `integration_operation:execute` 是后台任务执行能力，复数 `integration_operations:view/replay` 是管理界面能力，两者不能替代。
4. 根级 Cloudflare 校验此前没有覆盖所有业务 Worker，Altoc、Assets、Finance、WebDev 缺少 `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding，存在经公网租户网关请求 Console 的风险。

## 修复

- 新增 Console v1.92 seed/verify，为 `aims.runtime`、`altoc.runtime`、`assets.runtime` 安装 `data-runtime` 与 `tenant-runtime` 两个 audience 的精确 `integration_operation:execute` grant。
- 生产环境已执行 v1.92；核验结果为三个运行身份各有 2 条 active worker grant。
- Altoc、Assets、Finance、WebDev Cloudflare renderer 已增加 `HZY_CONSOLE_SERVICE` Service Binding。
- 根级 `validate:business-cloudflare` 现在强制所有托管云业务模块绑定 `hzy-console-prod`。
- 新增契约测试，校验 worker 请求的 scope 与双 audience seed/verify 保持一致。
- 在 `CLAUDE.md` 和 `docs/MODULE_CONTRACTS.md` 固化授权、Service Binding、发布验证规则。

## 生产发布

| 应用 | Cloudflare Version |
|---|---|
| Altoc | `889f2230-83a5-44af-b8ca-568d7d0d2fd3` |
| Assets | `5b45ba9f-4e95-422c-81bd-87f35ef74dbc` |
| Finance | `ca8afdfc-9063-4ff6-a83c-6201632572f3` |
| WebDev | `794dc80b-018e-412e-855e-a46451b398f0` |

四次部署均确认绑定 `HZY_CONSOLE_SERVICE (hzy-console-prod)`。

## 验证

- Console、Altoc、Assets、Finance、WebDev 全量测试通过。
- 上述五个模块 lint/typecheck 通过。
- 四个重新部署模块 build 与 Wrangler dry-run 通过。
- 根级 Cloudflare 配置校验通过。
- 生产 v1.92 SQL verify 通过。
- `https://wiztek.huizhi.yun/{altoc,assets,finance,webdev}/` 均返回 HTTP 200。
- `git diff --check` 通过。

说明：排障期间未等到 Aims 定时任务自然触发，因此没有把“观察到一次新的生产 drain 成功”作为完成证据；精确 grant 已直接在生产 Console 授权事实源中核验，原来的 403 条件已经消除。

## 后续防错规则

新增后台任务或跨应用 operation 时，交付物必须同时包含：

1. worker 调用代码及精确 scope；
2. Data Runtime 精确 scope 校验；
3. `data-runtime` 与 `tenant-runtime` 双 audience grant seed/verify；
4. 授权契约测试；
5. Cloudflare Console Service Binding；
6. 目标租户 SQL verify 与真实运行身份 token 探测。

不得通过删除精确 scope、吞掉 403、改用宽 `*.write` 或回退静态 Token 规避授权失败。
