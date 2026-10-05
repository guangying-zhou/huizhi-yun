# AIMS 重复必交成果与 Workflow prepare 404

- 现象：项目 257 的目标 276 同时存在两条《需求规格说明书》（207/214）；提交里程碑 134 完成审批时 `POST /aims/api/workflow-proxy/instances/prepare` 返回 404。
- 重复成果根因：207 由项目模板创建，214 由目标编辑界面后续新增；前端无同名提示，Data Runtime 批量新增接口直接 INSERT，也无同归属同名检查。
- 生产数据处理：将未绑定 Workflow 实例的完成申请 13 标记为 cancelled 并解除里程碑锁；删除 214 的两条质量审核、提交 4 和成果 214。207 保持 approved/passed。
- 防重修复：目标编辑界面在新增和重命名前检查同名；Data Runtime 对同一 project/milestone/target/matter 归属的同名新增和重命名返回 `409 deliverable_name_conflict`，并通过项目行锁串行化并发写入。
- prepare 404 的最终根因（后续生产复测纠正）：生产响应体为 `action_def_not_found`，Workflow 数据库漏执行 `010_aims_milestone_completion.sql`，导致动作定义、流程定义和默认路由均不存在。Cloudflare 实时日志确认 `x-hzy-service-routes` 已包含 Workflow `/workflow/` base path，实际下游路径正确。
- 路由修改仍作为正确的托管云直达加固保留：`resolveServiceAppBaseUrl(event, 'workflow', { directTarget: true })` 使用受信目标 Worker 路由；但它不是这次业务 404 的最终修复。生产执行 migration 010 后，同一个已登录 prepare 请求返回 HTTP 200。
- 验证：Data Runtime `go test ./...`、AIMS lint/typecheck/261 tests、Foundation lint/typecheck/305 tests 全部通过。本机 Node 25.8.1 会输出项目要求 Node 24.18.x 的 engine warning，不影响检查结果。
