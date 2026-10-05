# AIMS 里程碑审批通过后仍显示进行中

## DEBUG REPORT

- **Symptom**：Workflow 实例 `WF202608270001` 已完成且审批通过，但 AIMS 完成申请 `MCR-134-V2` 长时间保持 `pending`，里程碑 134“规划POC”保持 `active`，下一里程碑 135“核心MVP”保持 `todo`。
- **Root cause 1 — callback identity**：Workflow 的后台 callback drain 没有把当前 `H3Event` 传给 Console service-token helper，无法从可信 Tenant Gateway 上下文签发服务令牌；回调地址还曾因 `new URL()` 丢失 `/aims` 前缀。
- **Root cause 2 — semantic grant validation**：Data Runtime 对 service-token scope 与 audience 做了不适用于 semantic capability 的前缀绑定，导致 `aud=aims`、`scope=workflow:callback` 被错误拒绝为 `invalid_scope`。现按 Console 冻结的 `audience + semanticScope` grant 精确验证。
- **Root cause 3 — public Worker callback transport**：Workflow 的 cron/background Worker 公网请求租户域名时没有浏览器国家上下文，会在到达 Tenant Gateway/AIMS 前被生产 zone 地理 WAF 拒绝为 403。Workflow 现通过 `HZY_TENANT_GATEWAY_SERVICE` Service Binding 直达网关，网关再通过目标应用 Service Binding 直达 AIMS。
- **Root cause 4 — public introspection transport**：回调到达 AIMS 后，AIMS 又公网请求 `console.huizhi.yun/oauth/introspect`，同样在到达 Console 前被 WAF 拒绝。Foundation 的 service-token introspection 现优先通过业务 Worker 的 `HZY_CONSOLE_SERVICE` Service Binding，Console 自身仍使用 Nitro local fetch，非 Cloudflare 环境保留 HTTP fallback。
- **Fix**：修复 Workflow callback URL、事件上下文和 Gateway binding；修复 Data Runtime semantic scope 校验；Tenant Gateway 对已绑定应用使用 Service Binding；Foundation 服务令牌内省使用 Console Service Binding；为各层补充回归测试和跨模块合同。
- **Validation**：Foundation 308 项、Workflow 59 项、Tenant Gateway 27 项、AIMS 261 项测试全部通过；相关模块 lint/typecheck 通过。生产部署 Data Runtime `0.3.186`、Tenant Gateway `77a539c4-085e-417b-b962-ebb7e5a04d10`、Workflow `7a05ece0-08a6-4356-a767-68940cb04298`、AIMS `5e05fab7-d437-423b-8a73-38deb413f977`。
- **Production evidence**：Workflow callback log id 2 于 `2026-08-27 01:25:57` 变为 `success`；审批记录 14 / `MCR-134-V2` 变为 `approved`；里程碑 134 变为 `completed` 且解除完成申请锁；里程碑 135 变为 `active`。
- **Related**：Workflow 待办生命周期投影到 Console 的独立公网请求仍有 403 日志，不影响本次里程碑终态回调，需按同一 Service Binding 原则单独收敛。
- **Status**：DONE。
