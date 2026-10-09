# 功能版本矩阵

PC-15 矩阵按功能展示所选版本中的范围状态，数据来源为 Aims 当前功能与版本范围。每个功能×版本最多一条范围，由 uk_pc_version_feature 唯一约束保证；不把已交付范围当成发布或部署证据。

## 查询

浏览器：`GET /api/v1/products/{code}/roadmaps/feature-version-matrix?versionIds=3,1&page=1&pageSize=20`。

versionIds 为 1–10 个不重复正整数，保持选择顺序。page 默认 1，上限 1000000；pageSize 默认 20，上限 100。拒绝未知查询参数。

Runtime：`POST /v1/aims/internal/products/{code}/features:version-matrix`，operation 为 `aims.product-features.version-matrix`，能力为 `aims:product-features:read`。body 包含 input（version_ids/page/page_size）、功能 authorization、版本 version_authorization。

BFF 分别获取当前功能与版本 view，检查 actor、产品、修订、成员及状态事实一致；Runtime 在同一事务重新授权，校验所有所选版本属于该产品。只读、不缓存、不接受客户端 actor 或 permit。

## 响应

product_code、workspace_revision、version_ids、items、total、page、pageSize。

每行包含 feature_biz_id、title 和 cells；每格包含 version_id、scope_id、planned、delivered、deferred、deferred_from_scope_id、deferred_from_version_id。

每格新增 latest_release：无发布记录时为 null；否则包含 record_id、version_id、membership（included/absent/unavailable）、scope_id、frozen_status、current、withdrawn、superseded。按 release_seq/id 选择最新记录，每个所选版本只加载一次，并复用发布详情的 hash/产品归属校验。included 表示冻结快照中存在该功能，frozen_status 是冻结范围状态；不代表当前有效发布或已部署。legacy_import 返回 unavailable，不能推断为 absent。撤回、更正不会抹去历史成员关系。

- 功能按 ID 倒序真实分页，包括没有任何所选版本关联的功能；total 是产品功能总数，不是当前页或非空格数量。
- cells 完整保留所选列顺序。未关联格三个状态均为 0、scope_id 为 null；有关联格恰好一个状态为 1。
- 顺延来源可以在未选择的版本中，仍核对其产品归属；缺失或跨产品来源拒绝，不泄露其他产品范围。
- 当前版本范围随正式业务操作变化；历史范围对比使用独立发布快照接口。

## 当前交付

领域输入/实际 MySQL 查询、Runtime 边界、浏览器输入/双权限代理及路由回归已有验证。Runtime 成功读取集成已验证。

页面 `/products/{code}/feature-version-matrix` 已实现，从版本列表进入。选择最多 10 个版本，按添加顺序展示列；功能每页 20 条，支持移除版本、刷新、错误提示，以及版本范围和顺延来源链接。页面与入口 ESLint、全应用 typecheck 已通过。发布证据增强及浏览器交互/视觉验收仍待完成。
