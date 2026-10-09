# Aims legacy Account-named directory compatibility API

> 当前状态：兼容 BFF 契约。最后核对：2026-07-11。
>
> 这些路径只保留旧前端的 URL 形状；目录事实源始终是 Console Directory Runtime，不能作为新增 Account 能力或 Account fallback 的入口。

## 通用安全边界

- 所有 `/api/account/**` 兼容路由先通过 Foundation Console session bridge 取得已验证的当前用户；未登录返回 `401`，不会使用应用的 Directory 或 Git 集成凭证继续请求。
- Directory 请求只经 Foundation Console adapter。Console 返回的 `401` / `403` 是最终认证或授权结果，必须原样失败，不能改走 Account 或弱保护路径。
- `/users`、`/users/batch`、`/users/{uid}`、部门和项目注册表读取是已登录协作界面所需的目录投影；它们不接受浏览器提交的 actor 身份。
- `/user-departments?uid=` 和 `/users/{uid}/projects` 是自助关系读取，路由参数或 query 中的 `uid` 必须精确等于当前已验证 UID；不一致返回 `403`。
- `/api/account/projects?parent_id={group}` 用于项目仓库关联选择器：BFF 固定使用当前已验证 UID 查询 self-bound Directory 用户项目，并必须先确认结果中存在与 `parent_id` 精确相等的 Git 群组。通过授权门禁后，BFF 才通过 Console tenant-runtime 的受控 `gitlab.group-projects` fixed operation 实时分页读取该群组的全部未归档直属仓库；已归档仓库不进入关联候选。它不读取全局项目注册表，不依赖延迟的 Directory 仓库同步，也不允许浏览器通过任意父群组扩大可见范围。
- `POST /api/account/projects` 已退役，已验证会话后固定返回 `410`，项目注册表写入仅能使用 Console 管理接口。

## Git Markdown compatibility routes

`GET /api/account/projects/docs-tree/{projectCode}` 与
`GET /api/account/projects/doc/{projectCode}` 仍是历史路径名，但不再仅凭
`projectCode` 调用 Git 集成。

- 请求必须包含正整数 `aimsProjectId`（兼容 `aims_project_id`）；缺失或非法返回 `400`。
- BFF 以当前已验证 UID 构造 Aims scoped runtime 查询，验证其为该项目成员或项目管理员，并从 `GET /v1/aims/projects/{aimsProjectId}/repos` 验证 `projectCode` 与该项目的精确仓库关联。
- 非项目成员或仓库未关联返回 `403`；tenant-runtime 不可用返回受控 `503`，且不会调用 GitLab。
- 只有上述检查成功后，才可通过 Foundation Git integration 读取 Markdown tree 或文件内容。浏览器不得以项目编码、GitLab URL、actor header 或运行时 URL 代替此绑定。

当前实现见 `server/api/account/**`、`server/utils/authIdentity.ts` 与
`server/utils/projectDocumentAccess.ts`；跨模块目录边界见根
`docs/MODULE_CONTRACTS.md`。

## Direct WeCom login boundary

Foundation-backed Console OIDC is Aims' normal browser sign-in path. The
historical `GET /api/auth/wecom-login` and `GET /api/auth/wecom-callback` are
available only when `HZY_AUTH_MODE=legacy` or
`HZY_LEGACY_AUTH_BRIDGE=true` is explicitly enabled. In the default mode each
route returns `410` before reading browser query input, resolving the WeCom
integration, redirecting to WeCom, writing legacy cookies, or recording the
legacy login audit. Clients must use Console OIDC instead.
