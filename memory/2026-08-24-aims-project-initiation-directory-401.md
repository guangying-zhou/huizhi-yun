# AIMS 项目立项审批 400 排障记录

- 日期：2026-08-24
- 状态：DONE（本地修复与验证完成；生产授权与 Workflow 部署已发布，2026-08-26 完成生产复验）
- 生产项目：AIMS 项目 257（`HZY`）

## 现象

在项目设置页提交立项审批时：

- `POST /aims/api/workflow-proxy/instances/prepare` 返回 200；
- 随后的 `POST /aims/api/workflow-proxy/instances` 返回 400；
- 页面仍显示“未提交”，项目保持草稿状态。

## 根因

Workflow 在 `server/utils/initiatorContext.ts` 收集发起人上下文时，通过
`server/utils/directoryRuntimeClient.ts` 调用受保护的 Console Directory 用户接口：

`GET https://console.huizhi.yun/api/v1/directory/users/zhouguangying`

该调用没有传入请求事件，也没有获取 `aud=console`、
`console:directory-users:read` 的服务令牌，生产返回 401。客户端随后把错误吞成
`null`，导致 `initiator_dept_manager_uid` 缺失。Data Runtime 在创建实例快照时无法
解析第一节点审批人，返回：

`assignee_not_resolved: 节点“部门经理审核”未解析到审批人`

本次不是 GMO 目录数据缺失：生产 Console Directory 显示发起人
`zhouguangying` 的主部门为 GMO，GMO 负责人为周光营。

## 证据

2026-08-24 生产 Worker 实时日志：

- Workflow：`[DirectoryRuntime] Failed to fetch user zhouguangying ... 401 Unauthorized`
- AIMS：下游 400 响应正文为
  `code=assignee_not_resolved`、`节点“部门经理审核”未解析到审批人`
- 刷新项目页后仍为“未提交”，`instances/by-biz` / history 查询均未发现活动实例；
  因此本次失败没有留下半成功审批实例。

## 已实施修复

Workflow 已改用 Foundation 现有的受限 Directory 共享投影：

- 通过 `fetchConsoleDirectoryApi()` 调
  `GET /api/v1/console/service/directory/users`；
- 请求绑定当前 `H3Event`，由 `workflow.runtime` 获取 `aud=console`、
  `console:directory-users:read` 服务令牌；
- 用户详情用 `uids` 投影，部门负责人解析用 `projection=departments`；
- Directory 认证/可用性错误不再吞成空上下文，避免伪装成“未配置审批人”；
- 新增 `Console-SQL-Seed-v1.96-workflow-directory-sharing-read-grant.sql` 与对应 verify，
  只向 credential-backed `workflow.runtime` 授予精确 capability；
- 同步 `docs/MODULE_CONTRACTS.md` 与 `workflow/CLAUDE.md`，并增加 Workflow Directory
  服务契约回归测试。

## 验证状态

- 已在生产项目 257 连续复现两次相同 400；
- 已确认没有创建 Workflow 实例；
- Workflow 全量测试 54/54 通过；
- Workflow lint、Nuxt typecheck、生产构建通过；
- 未修改生产授权或部署；生产复测需先执行 v1.96 seed/verify 并发布 Workflow。

## 生产复验

2026-08-26：v1.96 seed/verify 已执行、Workflow 已发布，生产立项发起复验通过，不再出现 400 / `assignee_not_resolved`。（由维护者在生产环境确认）
