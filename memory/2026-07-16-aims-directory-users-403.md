# Aims 项目成员目录用户 403 排障报告

日期：2026-07-16  
租户/环境：`C000001` / `prod`  
故障请求：`GET /aims/api/directory/users?pageSize=500` → `403 Forbidden`

## 结论

`project_member` 不需要、也不应获得 Console 目录管理权限。故障来自 Foundation Directory adapter 的授权路径不完整：非 Console 应用的部门树已经走受限服务投影，但用户列表仍被转发到 Console 人类目录 UI API，导致没有 Console 角色的项目成员被正确拒绝。

修复后，Aims BFF 先保持已验证浏览器会话边界，再由 `aims.runtime` 使用短期 Console service token 调用受限共享端点：

- audience：`console`
- capability：`console:directory-users:read`
- endpoint：`GET /api/v1/console/service/directory/users`
- 响应字段：`uid`、姓名、头像、部门、岗位等协作识别字段
- 明确不返回：手机号、邮箱、目录管理字段

## 根因证据

- Aims 使用 Foundation `useDirectoryUsers()`，默认请求 `/api/directory/users?pageSize=500`。
- Foundation `fetchConsoleDirectoryApi()` 原先只对 `GET /departments` 使用受限服务端点；`GET /users` 落入 `/api/v1/console/directory/users` 的人类会话授权路径。
- 生产策略包 `pv_prod_20260716164248_0083` 中 `project_member` 无 Console 应用角色；这属于预期最小权限，不是缺失授权。
- 修复前红测确认 `/users` 缺少受限服务分支，Aims 精确服务 grant seed 也不存在。

## 修复

- Foundation 将非 Console 应用的 `GET /api/directory/users` 与部门树统一路由到 Console 最小共享投影。
- 新增 `Console-SQL-Seed-v1.80-aims-directory-sharing-read-grant.sql`，只给活动的 `aims.runtime` 增加 `console:directory-users:read`；没有修改任何企业角色或 Console 菜单 entitlement。
- 更新跨模块契约和 Foundation 能力清单，固定人类角色与跨应用服务身份的边界。
- 生产已安装并回读 grant：`clientCode=aims.runtime`、`resource=console:directory-users`、`action=read`、`status=active`、`source=seed:v1.80`。
- Aims 已部署版本：`48744e84-a115-4eb2-b7dc-b2d8fb92e97e`。

## 验证

- Foundation：204/204 tests 通过；typecheck、变更文件 lint 通过。
- Console：351 tests 通过、1 条临时 MySQL 环境测试跳过；typecheck、lint 通过。
- Aims：194/194 tests 通过；typecheck、lint 通过；部署 preflight 与 dry-run 通过。
- 生产 Chrome 新标签页访问 `https://wiztek.huizhi.yun/aims/project-resources`：页面显示 10 名人员、4 个部门、28 个项目及 28 条人员-项目关系；控制台 error/warning 均为 0，不再出现目录用户 403。
- 生产角色边界继续由 bundle `…0083` 保证：`project_member` 无 Console 应用角色；浏览器页面成功来自 Aims 服务身份的精确 grant，而非人类角色扩权。
