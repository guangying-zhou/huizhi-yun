# AIMS 项目关联仓库列表不完整排障记录

## 现象

- 生产环境项目 `HZY` 的设置页打开“关联仓库”选择器后，`huizhi-yun` 群组只显示 9 个仓库。
- `console`、`people`、`webdev`、`finance` 等同群组仓库未出现在候选列表。

## 定位证据

1. 生产选择器请求 AIMS 兼容路由 `GET /api/account/projects?parent_id=huizhi-yun&include_template=false`，前端没有对选项做固定条数截断。
2. GitLab 群组 API 返回 `huizhi-yun` 下 17 个非模板仓库；当前用户是该群组 Owner（effective access level 50），对这些仓库均有继承权限。
3. AIMS BFF 为避免全局项目注册表越权，原来完全使用 self-bound `GET /api/v1/users/{uid}/projects` 的 Directory 项目投影作为候选清单。
4. 生产 Directory 实际只登记了 9 个直属仓库和 `huizhi-yun/templates` 群组；`console`、`people`、`webdev`、`finance`、`platform`、`align`、`collab`、`huizhiyun` 根本不在 `directory_projects` 中。
5. Console 目录同步页只有 Subject export、钉钉和 LDAP，当前 GitLab/projects provider 会被服务端明确拒绝为“尚未迁入客户侧 Runtime”，所以没有可用的 GitLab 同步按钮。
6. Data Runtime 的 `ConsoleUserProjects` 另有父群组权限继承和 `parent_id` 未在上限前下推的查询缺陷；`0.3.173` 已修复该通用合同，但重启后生产仍只返回 9 个，证明它不是本次缺失 8 个仓库的最终原因。

## 根因

问题不在 `USelectMenu` 的前端分页。真实原因是 Console 尚无 GitLab 项目同步实现，Directory 仓库注册表滞后且只有 9 条；AIMS 却把这份不完整的 Directory 投影当成了 GitLab 仓库目录。Directory 查询缺陷是同时发现并已修复的次要问题，但无法生成 Directory 中本就不存在的仓库。

## 修复

- AIMS 先以当前已验证 UID 读取 self-bound Directory 群组关系，精确确认用户可访问请求的 `parent_id`；未授权群组在访问 GitLab 前返回 `403`。
- 通过授权后，AIMS 调用 Console tenant-runtime 的受控 `gitlab.group-projects` fixed operation，不接触 GitLab credential。
- Runtime 对 GitLab group projects API 使用 `per_page=100`、`id asc` 稳定排序自动翻页，禁止 shared/subgroup 扩大，重验每个结果的精确 namespace。AIMS 后续按产品要求传入 `includeArchived=false`，由 GitLab 上游排除归档仓库。
- Console v1.98 seed 只向 AIMS 现有 fixed-operation semantic grant 追加 `gitlab.group-projects`，不覆盖 GitLab/WeCom 原有 allow-list。
- Data Runtime `0.3.173` 保留已完成的 Directory 父群组过滤与直属权限继承通用修复；`0.3.174` 增加实时 GitLab 群组目录 operation，生产探测进一步发现 HTTP fixed-operation 路由还有独立白名单；`0.3.175` 同步枚举 `group-projects` 并增加回归测试。

## 验证

- Directory 回归测试覆盖父群组权限继承、过滤下推和非法编码失败关闭。
- GitLab 回归测试构造 101 个仓库，覆盖至少两页、稳定排序参数；AIMS 契约测试额外固定关联候选请求不包含归档仓库。
- AIMS 安全回归测试要求精确 Directory 群组授权必须先于实时 GitLab 调用，且不得使用全局 Directory 项目端点。
- Data Runtime `0.3.175` / Commit `733a217b` 已发布并升级到生产 `c000001-prod-tenant-runtime`，Console 页显示 aims、console、directory 等 10 个 adapter 全部正常。
- Console v1.98 seed 已在生产执行，verify 无返回行；AIMS Cloudflare Worker 已部署归档过滤修复，Version ID `4ee9e390-4b63-4fd1-af5b-a2d4ed6e4c7d`。
- 生产 Runtime 审计记录显示 `console.service.integration.gitlab.group-projects` 在 2229ms 内返回 `200`。
- 完整性修复部署后，选择器曾从 Directory 的 9 个候选恢复为 GitLab 直属的 17 个候选，证明实时分页链路完整。
- 按产品要求加上 `includeArchived=false` 后再次线上验收，候选仅剩未归档的单仓 `huizhiyun (huizhi-yun/huizhiyun)`；已归档的原模块仓库不再出现。验收过程未选择或关联任何仓库。
