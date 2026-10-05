# DEBUG REPORT — AIMS 项目立项驳回 400

- 日期：2026-08-24
- 现象：AIMS 审批中心处理任务 100 时，`POST /aims/api/workflow-proxy/tasks/100/reject` 返回 400。
- 状态：RESOLVED（生产任务 100 已实际驳回成功并返回审批中心）

## Root cause

生产前端代码与实际 Network Request Payload 均已确认在驳回时发送 `{ comment: "未关联代码库" }`，且空意见时驳回按钮不可用。任务页仍处于待办/运行状态，因此不符合 `task_already_handled` 或 `flow_not_running` 的 400 分支。

实际请求经过两个 Cloudflare Worker：浏览器 → AIMS Worker → Workflow Worker → Data Runtime。首轮修复只覆盖 AIMS Worker 的 Workflow proxy；用户部署 AIMS 后复验仍返回 400，证明「POST 缓冲体未暴露」并非已确认的线上根因。

Workflow Cloudflare 生产构建的 module handler 明确在进入 Nitro 前对 POST 执行 `request.arrayBuffer()` 并传入 Buffer，因此「Workflow 第二跳也丢 body」的后续假设已被构建产物否定，未保留该试探性改动。需从实际 400 响应 JSON 中确认稳定 code，再继续定位。

已确认 AIMS Foundation Workflow proxy 对 `$fetch` 异常直接 `throw error`，Nitro 将 Workflow 已返回的稳定业务 `code/message` 重新序列化为通用 `Server Error`。这是已确认的诊断信息丢失问题，但它不足以证明底层驳回 400 的业务根因。

错误透传上线后，生产响应明确为 `invalid_scope: scope does not match audience`。调用链路定位到 Workflow 跨应用代理的 `checkSubjectEligibility()` 前置权限检查：请求使用 `audience=console_authorization`，但 capability 是 `console:authorization:subject-eligibility`。Console service-token 签发器要求每个 scope 以实际 audience 开头，因此在进入用户资格判定之前就稳定返回 400。目标端本身同样校验错误 audience，而仓库其他 Console Service API 均使用目标应用 `aud=console` 与精确 `console:*` capability。

用户确认使用本地脏工作区执行 `pnpm --dir workflow deploy:cloudflare`，因此「未提交即未部署」的中间判断不成立。Wrangler 记录确认 `hzy-workflow` 22:36 和 `hzy-console-prod` 22:38 部署，Workflow 上传产物明确包含 `audience: "console"`。

开启两个 Worker 实时日志并在已登录页面对任务 100 实际提交「未关联代码库」后，Workflow 记录为 `audience=console` 且 `scope=console:authorization:subject-eligibility`，上游已从 400 `invalid_scope` 前进为 403 `insufficient_scope: console:authorization:subject-eligibility`。Console 记录显示其自身 `console:service-client:consume` 令牌已正确签发并进入 `/v1/console/auth/runtime-app-identities/consume`，最终是 Tenant Runtime 在消费 `workflow.runtime` 身份时因请求的 eligibility capability 不在该 client active grants 中而拒绝。生产根因是 v1.42 eligibility grant 未落库，不是代码 audience 仍未生效。

生产补齐 v1.97 grant 后，错误从 403 前进为 503 `service_token_introspection_unavailable`。安全诊断记录到真正的上游状态为 HTTP 522：Console 的通用认证中间件为服务令牌调用公网 `https://console.huizhi.yun/oauth/introspect`，即 Cloudflare Worker 通过自定义域回调自身。更深一层的问题是 `/oauth/introspect` 本身没有绕过通用认证；无论走公网还是 Nitro 内部路由，都会形成“认证需要内省，进入内省又先认证”的递归。公网形态被 Cloudflare 终止为 522，内部形态则触发 Worker CPU 1102。

请求还保留租户网关的 `x-forwarded-host=wiztek.huizhi.yun`，所以不能只靠请求 Origin 判断 Worker 是否在调用自身；Console 的运行时应用身份 `clientId=console` 才是稳定判断依据。

## Fix

- `readRequestBodyCompat()` 不再仅按 HTTP method 判断是否需要补取。
- GET/HEAD 仍直接返回 `undefined`；其他 method 只要 h3/Nitro 缓冲体缺失，就从 Cloudflare 原始 `Request` 补齐到 `event._requestBody`。
- 已有 Buffer/rawBody 的正常 POST 继续直接使用，不会二次消费原始 stream。
- Workflow proxy 现在保留上游 4xx 中的稳定 `code/message/upstreamStatus`，使驳回等业务错误可诊断。
- 上游 5xx、无响应或非预期状态统一转为脱敏 503，不向浏览器泄露 Workflow/数据库内部信息。
- Foundation 资格检查请求改为 `aud=console`，保留精确 `console:authorization:subject-eligibility` capability。
- Console 目标接口同步只接受 `aud=console` 且继续要求精确 scope、`target_app=console`、双来源 claim 与 tenant/deployment 绑定，未放宽权限边界。
- Console 运行时对自身内省使用 `event.$fetch('/oauth/introspect')` 在 Nitro 内部分发，其他应用仍走外部 Console HTTPS 边界。
- 同源判定优先使用受配置约束的 Console 应用身份，兼容租户网关转发主机名；非 Console 应用仍按 Origin 保守判断。
- `/oauth/introspect` 明确绕过通用 Console 认证中间件，由路由自身完成签名、issuer、audience、有效期、当前 credential 和当前 grant 校验，消除认证递归且未放宽验证。
- 增加不记录令牌明文的内省失败诊断，能够区分嵌套 HTTP 状态、稳定错误 code 与安全摘要。

## Evidence

- 新增 Cloudflare POST 回归用例：原始 `Request` 含 `{ comment: '需要调整立项材料' }`，但 Nitro 缓冲体缺失。
- 修复前该生产形态用例返回 `undefined`，下游会把它解释为缺少 comment；修复后请求体正确解析，聚焦用例 7/7 通过。
- Foundation 在仓库指定的 Node 24.18.0 下全量测试 290/290，lint 和 typecheck 通过。
- Workflow 全量 55/55，lint、typecheck、Cloudflare 生产构建及 Wrangler dry-run 均通过；构建产物同时证明 POST 在 Worker 入口会被缓冲。
- 新增 Workflow proxy 错误归一化用例：4xx 稳定业务错误保留，5xx 内部细节脱敏，聚焦用例 2/2 通过。
- 认证契约回归在修复前同时失败（Foundation 调用方和 Console 目标端均仍含 `console_authorization`）；修复后 Foundation 聚焦 1/1、Console 聚焦 19/19 通过，并增加 `target_app=console` 正向用例。
- Foundation 全量 292/292、Console 全量 404/404、Workflow 全量 55/55 通过；三个模块 lint/typecheck 均通过。
- Console 与 Workflow 的 node-server 生产构建、Cloudflare 配置生成及 `cloudflare_module` 生产构建均通过。
- 新增 Console 自调用回归：即使保留租户网关 `x-forwarded-host`，`clientId=console` 仍使用 Nitro 内部 `/oauth/introspect`；Workflow 等跨源应用继续使用外部网络边界。
- 新增认证中间件回归，确保 `/oauth/introspect` 在通用认证之前 bypass，避免公网 522 与内部 CPU 1102。
- Foundation 最终全量 296/296；Console 最终 lint、typecheck、405/405、Cloudflare 构建和 Wrangler dry-run 全部通过。
- 生产 Console 版本 `b375d596-c7cc-477d-b3fb-7e4e8b5b78a8` 上实际提交任务 100 驳回：subject eligibility 两次返回成功，Workflow 请求完成且页面返回审批中心，待办显示 0。

## Remaining observation

驳回成功后 Workflow 记录一条非阻断 `NotificationDeliveryError`（in_app），未改变任务 rejected 终态或 AIMS 页面跳转。本故障的 400/403/503/522/1102 调用链已经闭环；通知投递应作为独立问题跟踪，避免与审批事务回滚语义混淆。
