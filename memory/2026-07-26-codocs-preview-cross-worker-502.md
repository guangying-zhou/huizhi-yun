# Codocs 文档预览跨 Worker 502 修复记录

## 状态

DONE_WITH_CONCERNS

Codocs 文档预览及其关联的 AIMS、Workflow 页面请求已恢复。线上复核时，截图中对应的
项目列表、收藏、项目详情、需求、成员、里程碑、项目文档和 Workflow 待办接口均返回
HTTP 200；`Copilot记录` 文档可正常打开预览。

## 用户症状

- Codocs 已能完成 OIDC 登录，但打开文档预览后控制台持续出现 502。
- 失败请求主要包括：
  - `/aims/api/v1/projects`
  - `/aims/api/v1/projects/33`
  - `/aims/api/v1/favorites`
  - `/aims/api/v1/projects/33/work-items`
  - `/aims/api/v1/projects/33/members`
  - `/aims/api/v1/projects/33/milestones`
  - `/aims/api/v1/projects/33/documents`
  - `/codocs/api/workflow-proxy/tasks/pending`

## 根因

1. AIMS、Workflow 和 Codocs Worker 通过租户网关回调 Console 获取 service token，
   形成同一 Worker 请求链上的自等待，最终超时并被网关表现为 502。
2. Codocs 的 Workflow 代理沿用了 Codocs 的 app/deployment 上下文，没有切换为
   Workflow 的服务目标上下文。
3. Workflow 获取项目总监角色持有人时，继续通过租户公网路径调用 Console，且
   Console 的角色持有人内部接口尚未包含在生产部署中。
4. Console 在 managed-cloud-multitenant 模式下错误地要求调用方 Workflow 的
   deployment 与 Console 缓存策略包 deployment 相同。
5. Console Service Binding 收到租户网关 URL 时保留了 `/console` 前缀，Console
   Worker 将请求落到 SPA fallback，返回 HTTP 200 HTML；Workflow JSON 解析后得到
   空对象并报 409。
6. 上述问题修复后，Workflow 主查询已成功，但每次请求末尾的可靠回调 outbox drain
   暴露出生产 `hzy_workflow.flow_callback_logs` 未执行 011 迁移，缺少
   `idempotency_key`、`next_attempt_at` 和唯一索引，最终把主请求转成 503。

## 代码修复

- 为 AIMS、Workflow、Codocs 的 Cloudflare 配置增加
  `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding。
- 根目录部署配置校验增加业务 Worker 对 Console Service Binding 的必需检查。
- Codocs Workflow proxy 使用 Workflow 目标的可信服务请求上下文。
- Workflow 项目总监查询改走 Console Service Binding，并增加非敏感诊断字段。
- Console 增加项目治理单例角色持有人内部接口，并修正 managed-cloud-multitenant
  的 deployment 边界判断。
- Foundation 的 `fetchConsoleServiceJson` 在 Service Binding 模式下移除租户网关
  `/console` 前缀；service-token 请求复用同一规范化逻辑。
- 增加/更新相应回归测试。

## 生产操作

- 生成并激活策略包：
  - bundle id: `88`
  - version: `pv_prod_20260726181651_0086`
  - policy revision: `21`
- 执行：
  - `workflow/docs/migrations/011_durable_callback_outbox.sql`
  - `workflow/docs/migrations/011_durable_callback_outbox_verify.sql`
- 迁移验证：
  - `callback_outbox_columns = PASS`
  - `callback_outbox_unique_key = PASS`
- 当前部署版本：
  - AIMS: `4aeef34a-34dc-45a4-876f-7a9d5036b49d`
  - Codocs: `fc15e370-356b-4379-a5be-48facfb276aa`
  - Console: `be6c4a1b-7d01-4171-ab2e-747ebc13af05`
  - Workflow: `ab4e2ae2-fd17-4ea7-ac05-4d6f57f84df4`

## 验证证据

- Foundation：
  - lint 通过
  - typecheck 通过
  - tests: 275/275
- Console：
  - lint、typecheck、完整测试、构建、Cloudflare dry-run 和部署通过
- Workflow：
  - lint、typecheck、tests 51/51、构建、Cloudflare dry-run 和部署通过
- Codocs：
  - lint、typecheck、tests 149/149、构建、Cloudflare dry-run 和部署通过
- 线上：
  - Workflow `/tasks/pending`：HTTP 200
  - Workflow scheduled callback drain：HTTP 200
  - 截图中 7 组 AIMS 关联接口：HTTP 200 且 `code = 0`
  - `Copilot记录`：预览可见

## 非阻断关注项

- 本机 Node 为 `25.8.1`，仓库声明支持 `>=24.18.0 <25`；本次所有门禁均通过，但
  后续开发环境应切回受支持的 Node 24。
- AIMS 后台定时 `integration-operations/drain` 仍可观察到与本次页面请求无关的
  `data-runtime:aims:integration_operation:execute` scope 403，应作为独立运行维护
  问题处理；它不会出现在本次 Codocs 预览请求链中。
