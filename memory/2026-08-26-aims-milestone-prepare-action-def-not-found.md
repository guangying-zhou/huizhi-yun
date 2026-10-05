# AIMS 里程碑完成审批 prepare 404：生产漏执行 Workflow migration 010

## DEBUG REPORT

- **Symptom**：`POST /aims/api/workflow-proxy/instances/prepare` 返回 404。
- **Root cause**：生产 Workflow 数据库缺少 Aims `milestones / milestone_completion` 动作定义、`aims_milestone_completion` 流程定义及默认路由。仓库已有 `workflow/docs/migrations/010_aims_milestone_completion.sql`，但部署 Data Runtime 与 AIMS Worker 时没有执行 Workflow 数据库迁移。Cloudflare 生产日志确认 `x-hzy-service-routes.workflow.basePath=/workflow/` 且下游请求路径正确；已登录探针的真实响应是 `action_def_not_found`，推翻了“仍然丢失 /workflow 路径”的假设。
- **Fix**：在生产 `hzy_workflow` 执行 migration 010；新增 `010_aims_milestone_completion_verify.sql`，缺少动作、流程或默认路由时通过临时表 CHECK 约束让部署失败；部署文档要求任何 migration/verify 非零退出立即中止。
- **Evidence**：迁移前动作/流程/路由计数均为 0；迁移后已登录相同 prepare 请求返回 HTTP 200，动作定义 ID 17、流程定义 ID 12、默认路由 ID 18。
- **Regression test**：`workflow/test/milestoneCompletionMigration.test.ts` 验证 migration、fail-closed 校验与部署命令合同。
- **Related**：`c02b2bc0` 对受信直达路由的修改符合跨 Worker 路由合同，但并不是此次业务 404 的最终根因。旧报告中的路径根因判断已被生产响应体和实时 Worker 日志纠正。
- **Status**：DONE。
