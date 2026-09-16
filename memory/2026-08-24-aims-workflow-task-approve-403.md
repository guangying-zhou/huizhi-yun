# DEBUG REPORT — AIMS 项目立项审批通过 403

- 日期：2026-08-24
- 现象：部门经理在 AIMS 审批中心处理任务 100 时，`POST /aims/api/workflow-proxy/tasks/100/approve` 返回 403。
- 状态：DONE（本地修复与回归完成；2026-08-26 完成生产部署复验）

## Root cause

AIMS 的 Foundation Workflow proxy 先以已验证用户会话派生 `x-hzy-actor-uid`，再用 `aud=workflow`、`scope=workflow:proxy` 的服务令牌调用 Workflow。代理按设计删除浏览器 Cookie 和用户 Authorization，避免把用户会话泄露到跨应用边界。

Workflow middleware 在进入 tenant-runtime 前对 `approve` 执行 `requirePermission()`。该 helper 使用“当前用户权限快照”端点，但此时 event 只有 AIMS service identity，没有可转发的用户 token/Cookie，因此无法以委托 UID 读取 `workflow_tasks:approve`，在 runtime 校验 task assignee 之前就失败为 403。

生产页面已确认任务 100 仍为 pending，当前节点是“部门经理审核”，assignee 为周光营，故不是任务关系错误。仓库中 `department_manager → workflow:approver` 及 `workflow_tasks:approve` 映射也已由 Platform 契约测试锁定。

## Fix

- Console subject eligibility registry 新增服务端固定的 Workflow 动作 purpose：
  - `task_approve/task_reject/task_delegate`
  - `instance_cancel/instance_resubmit`
- 每个 purpose 只能映射到对应 manifest 已声明的精确 `resource:action`；调用方 body 仍只允许 `subjectUid/purpose`，不能选择 resource/action。
- Workflow 仅对已验证 `workflow:proxy` 受信委托走该检查；直接用户请求仍走原 `requirePermission()`。
- Console 使用 fresh normal-merged policy、禁用 simulation 与 snapshot cache 评估用户权限；依赖失败保留 503，真实拒绝保留 403。
- tenant-runtime 仍在事务内校验 task assignee / instance initiator，没有放宽对象关系边界。

## Evidence

- 修复前 Console 回归新增用例稳定失败为 `subject_eligibility_tuple_unregistered`。
- 修复前 Workflow 代理契约用例确认 middleware 没有 subject eligibility 动作检查。
- 修复后 Console 授权契约 11/11；中文工作区路径测试随后改用 `fileURLToPath()` 修复，全量 404/404；lint、typecheck 通过。
- 修复后 Workflow 全量 55/55；lint、typecheck、生产构建通过。
- Console 完整 preflight 已在仓库要求的 Node `24.18.0` 下通过。

## Remaining verification

部署 Console 与 Workflow 后，需在当前租户使用任务 100 复验部门经理通过，并确认下一节点“分管领导审批”正常创建。

2026-08-26：Console 与 Workflow 已发布，生产复验通过，部门经理审批通过不再返回 403。（由维护者在生产环境确认）
