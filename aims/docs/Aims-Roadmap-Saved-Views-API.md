# 路线图受众与保存视图

PC-14 延续现有季度路线与规划事项，不另建规划实体。当前仅实现定义校验与季度查询映射，持久化、授权命令、Runtime/BFF 和页面尚待接入。

## 定义

- title：非空名称，最多 200 字符。
- audience：planning（规划讨论）、delivery（交付协调）、stakeholder（干系人概览）；这是展示方式，不是角色或授权来源。
- visibility：personal（创建者个人）或 product（产品内共享）。禁止 public/匿名分享。
- cycle_biz_id、year、quarter、unscheduled：复用现有季度查询的身份、日期与筛选规则。

不保存 actor、permit、产品覆盖字段、数据正文或分页大小。每次读取用当前请求的受限分页，并重新执行产品规划与路线图 view 双授权。共享仅允许其他已获权限的产品用户读取视图定义，不授予其事项或承诺内容访问权。

## 后续实现边界

持久化应绑定产品及创建者、版本；个人修改限本人，产品共享定义修改要求产品路线图编辑权限。创建/更新使用修订和幂等回执，记录审计。应用视图时重查周期归属及当前权限，不重放创建者授权。删除仅删除视图定义，不修改事项、决定队列或历史承诺。

受众投影复用现有可访问路线数据：规划显示范围与决定队列，交付突出时间窗口与状态，干系人显示目标/标题与探索或承诺状态；不得把展示隐藏当作权限边界。所有受众保持同一底层范围、分页总数及截断语义。

## 存储（v5.32）

product_roadmap_saved_views 已定义稳定 biz_id、产品/周期复合外键、owner_uid、名称、受众/可见性、年份/季度/未排期筛选、revision 与创建/更新审计字段。没有授权 JSON 或事项正文。产品内共享与个人索引支持后续按当前用户过滤分页。

实际隔离 MySQL 已验证跨产品外键、字段约束、重复迁移保留数据和 canonical/增量 schema 一致。目标环境未执行迁移，领域创建/更新/删除与读取尚待实现。

## 创建领域命令

CreateRoadmapSavedView 接收 expected_revision 与 definition，命令身份 product_roadmaps:view-create。个人视图要求当前用户 product_priorities/view 和 product_roadmaps/view；产品共享视图要求前者及 product_roadmaps/edit。可信 actor 自动成为 owner/创建者，不接受客户端指定 owner。

授权事务内核对活动产品、预期产品修订和周期归属，保存定义、递增产品修订、审计及回执原子提交；不修改周期或决定队列。重放仍检查当前权限。隔离 MySQL 已验证审计失败回滚、同键重放以及共享视图查看权限不足被拒绝。Runtime/BFF、读取应用及页面尚未接入。

## 分页读取领域接口

ListRoadmapSavedViews 要求当前用户的规划/路线图双 view，按产品范围返回本人 personal 或产品 product 视图，计数与列表使用同一条件。每页最多 100 条，默认由调用者指定有效分页，返回产品当前修订、视图定义/owner/revision，按创建 ID 倒序。共享定义不授予底层数据权限。

个人视图的产品活动日志仅含视图 ID、visibility、owner、revision，不包含名称和季度筛选；完整结果仅进入操作者绑定的命令回执。实际 MySQL 覆盖他人个人记录不影响计数、他人共享可见、分页/空页及缺路线图授权拒绝。

## 详情与应用领域接口

ReadRoadmapSavedView 重新检查双 view 授权及个人/共享可见性，不可见与不存在返回相同无记录结果。ApplyRoadmapSavedView 在同一授权事务内读取定义并复用季度路线查询，当前请求指定受限分页，响应包含 view 与 roadmap。存储的 audience 仅用于后续展示投影，不复用创建者权限。

季度读取提取事务内 helper，原直接读取入口保持双授权与相同数据语义。实际数据库测试覆盖详情一致性、应用后的周期/季度/分页/修订、私人定义拒绝及缺当前授权拒绝；受众投影与 Runtime/BFF/UI 尚待接入。

## 修改领域命令

UpdateRoadmapSavedView（product_roadmaps:view-update）接收 biz_id、expected_revision、expected_view_revision 和完整 definition。个人视图仅 owner 可读取并修改；旧或新定义任一为 product 时要求路线图 edit，切换 visibility 仅 owner 可执行，owner 不可变。规划 view 始终重新核验。

活动产品内核对双修订与目标周期归属，原子更新定义、视图/产品修订、审计和回执；个人审计继续隐去定义。已成功命令重放重新检查当前可见性和权限，返回原回执。删除及接口页面尚待接入。

## 删除标记存储（v5.33）

增加 deleted_at，保留原视图身份、owner、visibility 和修订供删除命令重放时授权。正常列表/计数、详情、应用均过滤已删除记录；删除不是取消规划或删除周期。当前仅完成存储和读取过滤，带审计/幂等的删除命令尚待接入。实际数据库测试中的直接标记是存储 fixture，不代表删除业务命令已实现。

## 删除领域命令

DeleteRoadmapSavedView（product_roadmaps:view-delete）接收 biz_id、expected_revision、expected_view_revision。个人限本人及规划/路线图双 view，共享要求规划 view 与路线图 edit；授权查询包括删除标记，以便同键重放仍检查当前权限。新键对已删除视图返回无记录。

活动产品内核对双修订，原子设置 deleted_at、递增视图/产品修订及写审计回执，审计不携带个人定义。事务失败保持原视图可见。正常读取/应用立即隐藏，周期与规划事项不变。实际隔离数据库已验证删除、同键重放、缺当前权限拒绝和审计失败回滚。

## Runtime 读取

POST `/v1/aims/internal/products/{productCode}/roadmap-views:{list|view|apply}`，operation 为 aims.product-roadmap-views.{action}，要求 aims:product-roadmaps:read 和可信委托 actor。信封 authorization 为路线图 view，planning_authorization 为规划 view。

list input 仅 page/page_size；view 仅 biz_id；apply 为 biz_id/page/page_size。各入口严格解码并复用领域可见性和双授权。三者登记为只读传输；使用现有读取 grant，数量不变。实际 Adapter 成功集成和浏览器 BFF 尚待接入。

## Runtime 写入

POST `/v1/aims/internal/products/{productCode}/roadmap-views:{create|update|delete}`，对应能力 aims:product-roadmaps:view-create/view-update/view-delete。input 分别使用上述领域输入结构，信封携带 authorization、planning_authorization、idempotency_key；actor 来自可信委托身份。读取能力不能替代写能力，三个写接口不登记为只读传输。

Manifest 与 Console 双 audience grant 已同步，当前 162 条业务 grant /168 项要求，隔离 MySQL 初始化/核验通过；目标环境未安装或探测实际签发。实际 Adapter 成功链路和 BFF/UI 继续。

实际 Adapter.HandleRuntime 集成已覆盖六动作：创建个人视图并重放，列表/详情读取，应用视图返回数据库中的未排期候选事项，更新/删除及重放，删除后列表为空。全部经过统一 Runtime operation/响应信封及精确能力路径；仍不等同实际 Console JWT 或浏览器 BFF 验收。

## 浏览器输入约定（校验已实现，路由待接入）

写请求使用 expectedRevision；update/delete 还需 expectedViewRevision，身份从路径获取。create/update 的 definition 为 title、audience、visibility、cycleId、year、quarter、unscheduled，unscheduled 必须显式布尔值。delete 不接受 definition。拒绝 owner、actor、authorization、productCode 和未定义字段。

读取 list/apply 仅 page/pageSize 查询参数，view 不接受查询参数；apply 不允许临时覆盖已保存年份或周期。BFF 映射为 Runtime snake_case，分页沿用 1–100 单页限制。输入专项已验证身份、修订、未知字段、非法受众/公开范围和分页边界。

## 浏览器代理路由

`/api/v1/products/{productCode}/roadmaps/views/` 下提供 GET list、GET permissions、POST create、GET/PATCH/DELETE {UUID}、GET {UUID}/apply。写请求必须携带 Idempotency-Key，无查询覆盖。permissions 返回当前 actor、状态、修订及 roadmap edit 判断。

BFF 读取规划 view、路线图 view，并核对产品/actor/修订/成员事实一致；写入另外检查 roadmap edit。个人创建用 view，共享创建缺 edit 在 BFF 拒绝；修改/删除传当前可用 edit 或 view，由 Runtime 基于持久 owner/visibility 再判断，重试无需先读取被删定义。个人删除允许显式 edit permit，仍限持久 owner；不会因此允许访问他人个人视图。

三个代理 handler VM 专项验证双权限、精确能力、共享创建拒绝、apply 分页、事实混用及服务错误；实际浏览器 UI 尚待接入。

## 浏览器列表与受众展示

`/products/{productCode}/views` 展示可访问视图的真实分页列表（20 条/页）和应用结果（独立 20 条/页）；季度路线页提供入口。规划受众显示范围与决定顺序，交付受众显示时间窗口，干系人概览隐藏细节；均保留同一有权限的事项及底层队列，提供事项入口。

页面明确标注当前规划不构成发布承诺，不把时间窗口或近期 bucket 当作已承诺。当前尚待新增/编辑/删除管理入口、目标与承诺信息增强和浏览器视觉验收。

季度路线页现提供“保存当前视图”弹窗，沿用当前周期/年份/季度/未排期筛选，填写名称、受众和个人/产品共享可见性。打开时重新读取权限和产品修订，共享选项要求 edit 并经 Foundation 确认。保存时复用稳定载荷幂等键，核验回执身份/owner/定义/修订；失败保留文字，重新读取权限是显式动作。浏览器创建交互与视觉验收尚待完成。

### 交付与干系人承诺摘要

保存视图展示当前生命周期及选入状态。delivery/stakeholder 提供按需承诺查询，复用 `/roadmaps/commitments/{itemId}?page=1&pageSize=1`，每次按当前双 view 权限读取；该摘要独立于保存视图应用时点，不作为同事务快照。校验最新记录身份后展示窗口和复评状态；未读取不推断无承诺，读取失败提供错误，零记录才显示规划探索。完整原因和历史通过现有承诺历史页面查看。目标信息及新增摘要浏览器验收仍待完成。

### 周期目标上下文

应用视图后通过现有规划周期详情接口读取当前 goal_summary、metric_definition、baseline_value 和 target_value，独立重新授权。当前周期目标与承诺摘要一样是独立读取，不宣称与季度查询处于同一事务快照。目标值保留十进制字符串，null 显示未记录。周期目标不是事项到产品战略目标的关联证明；该反向关联仍待实现。
