# People 员工页部门目录 403 排障报告

## Symptom

- 在 Wiztek 租户模拟 `hr_specialist` 后打开 `/people/employees`。
- People BFF 请求 `GET /people/api/directory/departments` 返回 403，部门树和员工列表无法正常加载。
- 同一份历史控制台输出包含 `POST /codocs/api/auth/refresh` 401；该请求属于 Codocs 应用会话，不在 People 部门读取调用链内。

## Root cause

`hr_specialist` 按角色设计不应拥有任何 Console 控制台权限。原实现却把非 Console 应用的部门树读取转发到：

`/api/v1/console/directory/departments`

该接口是 Console 人类管理端接口，正确要求 `directory_departments:view`。因此 People 业务读取错误地依赖了 `console:directory_operator`，把 Console UI entitlement 与跨应用目录共享能力耦合在一起。删除人事专员的 Console 角色后，这个架构缺陷按设计表现为 403。

排障中曾短暂生成 `…0082` 恢复该 Console 映射；在确认角色意图后已立即撤回，不能作为最终修复。

## Fix

- Platform 系统模板和 Wiztek tenant role 均保持：
  - `hr_specialist -> people:specialist`
  - `hr_specialist -> workflow:approver`
  - `hr_specialist -> codocs:editor`
  - 不包含任何 `console:*` 应用角色。
- 最终生产策略包为：
  - bundle ID：`85`
  - version：`pv_prod_20260716164248_0083`
  - policy revision：`18`
  - hash：`sha256_5c90223223c6e95845a54d2a5485afb51912d2e4b0dcf17712829b17bf76ebaf`
- Foundation 对非 Console 应用的部门树读取改为调用 Console 现有受限共享投影：
  - endpoint：`GET /api/v1/console/service/directory/users?projection=departments`
  - audience：`console`
  - capability：`console:directory-users:read`
  - 仅携带已验证 Tenant Gateway 上下文和短期 service token，不转发浏览器 Cookie 作为 Console UI 授权。
- 为 `people.runtime` 安装精确 active service grant；该 grant 不产生 Console 菜单 entitlement，也不能访问 Console 管理接口。
- 发布 People Worker：`e37813ca-6f6f-4491-a1bb-6570e5ae84b8`。

## Verification

- 最终 bundle `…0083`：17 个角色、825 条角色权限、91 条 assignment、24 条 assignment scope、16 条 baseline、17 条冲突规则。
- `hr_specialist` 应用角色仅为 `codocs:editor`、`people:specialist`、`workflow:approver`；Console grant 数为 0。
- Console 激活缓存：`active=true`、`bundleReady=true`、版本 `…0083`、`lastError=null`。
- 生产 `people.runtime` service grant：`console:directory-users:read` active，source=`seed:v1.79`。
- 红测先失败后通过：Foundation 目录路由与 Console service grant 契约均已锁定。
- 全量验证：Foundation 203/203、Console 350 passed（1 skipped）、People 66/66、Platform 218/218；四模块 typecheck 通过。
- 在生产 bundle 已确认 `hr_specialist` 无 Console grant 的前提下，生产 Chrome 新标签页强制刷新 `/people/employees`：部门树显示、员工总数 91、控制台 error/warning 为 0，不再出现 People 目录 403 或 Codocs refresh 401。浏览器当前为普通已认证会话；角色收窄事实由生产 `…0083` bundle 和 Platform 回归双重验证。

## Note

Foundation 全库 lint 仍有 3 条既有错误（`nuxt.config.ts` 键顺序与旧测试引号）；本次改动文件 lint、Console/People/Platform 全库 lint 均通过。
