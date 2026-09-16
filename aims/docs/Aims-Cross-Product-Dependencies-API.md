# 跨产品依赖 API

当前已实现领域创建、移除、详情与可见范围分页，Runtime 发现/列表/详情/创建/移除动作，以及浏览器读写 BFF。页面及交付门禁整合尚待接入；未部署目标环境。

## 浏览器写接口

- 创建：`POST /api/v1/products/{code}/cross-dependencies/items/{itemBizId}`。
- 移除：`POST /api/v1/products/{code}/cross-dependencies/items/{itemBizId}/{dependencyBizId}/remove`。

均要求 `Idempotency-Key`，拒绝 query。body 仅允许 predecessorProductCode、predecessorId、expectedRevision、expectedItemRevision、expectedPredecessorProductRevision、expectedPredecessorRevision、reason、impactNote；移除另要求 expectedDependencyRevision。标识为规范 UUID，修订为正安全整数，原因非空且最多 2000 字符。源事项与移除边由路由绑定，客户端不能提供授权、操作者或快照。

源产品要求 product_priorities/edit，前置产品要求 product_priorities/view。两端分别核验，同一操作者；不同产品修订无需相等。Runtime 使用 aims:product-priorities:cross-dependency-create/remove 精确服务能力。产品/事项修订和依赖归属由领域在事务内再次检查。

## 事务与依赖图

先取得全局图锁，再按产品编码顺序取得两端产品锁；同产品依赖编辑也先取得图锁。创建以完整同产品/跨产品图校验重复与环路；移除保留原原因和身份到审计。边变化、源范围/事项/产品修订、图修订、审计与幂等回执原子提交，不修改前置产品内容。

## Runtime 读取

POST 内部路径 `/v1/aims/internal/products/{code}/cross-dependencies:list|view` 使用 aims:product-priorities:read，登记为只读传输。详情须提供双方 view permit；列表提供源 view 和可见前置产品 permit 集合，最多 100 个，按授权范围计数/分页，不返回隐藏数量。不可直接把浏览器传入数据当作 permit。

## 浏览器详情

`GET /api/v1/products/{code}/cross-dependencies/edges/{dependencyBizId}?predecessorProductCode=...` 已接入 Runtime view。只接受前置产品参数，两端分别核验 priorities/view，可信操作者必须一致；依赖 ID 从路由绑定，Runtime 再次校验实际两端归属。读取使用精确 read 能力、不要求幂等键、响应 no-store。列表发现与页面尚待接入。

## 浏览器筛选列表

`GET /api/v1/products/{code}/cross-dependencies/items/{itemBizId}` 接收 predecessorProductCode（单值或重复参数，1–100 个不重复产品）、page/pageSize。源及每个前置产品均要求 priorities/view，参数仅作为筛选，BFF 生成真实 permit 后调用 Runtime list。任一所选产品不可见即拒绝，不把传入产品列表当作权限。自动发现全部可见依赖尚待完善。

## 自动发现可见依赖

`GET /api/v1/products/{code}/cross-dependencies/items/{itemBizId}` 不传 predecessorProductCode 时，BFF 先通过内部 targets 动作发现关联产品，再逐一核验 view 权限，仅将获准产品传给列表查询。浏览器不会接收内部产品编码集合，总数仅统计可见记录。显式传入筛选产品时仍要求每个产品都获准。

发现结果与源产品修订不一致返回 409；授权服务故障保留 503，不伪装成空列表。所有目标权限收集完成后生成短期 permit，Runtime 仍重新核验事实。分页默认 page=1、pageSize=20，最多 100；自动发现最多 100 个关联产品，超限明确拒绝。

## 操作权限

`GET /api/v1/products/{code}/cross-dependencies/permissions` 不接受 query，返回产品编码、状态、修订和 edit 布尔值。先要求 priorities/view，再检查 priorities/edit，并核对两次事实的产品、actor、状态、修订及成员/负责人关系一致；变化返回 409，授权故障保留 503。该响应仅用于页面操作呈现，创建/移除仍独立执行双方服务端授权。

## 浏览器创建与移除

事项依赖页面提供自动列表和移除表单，并接入新增依赖选择器。新增复用 `/api/v1/products` 的已授权活动产品分页查询及目标产品 `/planning-items` 分页查询；选择结果冻结前置事项及产品修订，提交沿用上文创建接口。产品目录可见不代表规划事项可见，目标列表和写入接口分别执行权限核验。已取消/已合并前置事项不可选择，本产品入口不可选择。

原因与影响说明进入 Foundation 确认框；相同请求失败重试复用幂等键。创建/移除期间避免列表刷新与其他编辑干扰，回执身份与修订校验通过后刷新列表。创建与移除已通过浏览器模拟服务的失败重试/成功刷新验证；真实 JWT/Runtime 端到端验收尚待完成。

## 承诺前置历史 Runtime

`POST /v1/aims/internal/products/{code}/roadmaps:cross-snapshots` 使用 `aims:product-roadmaps:read`；input 的 biz_id 为承诺 UUID，另有 page/page_size。authorization 为源 roadmaps/view，planning_authorization 为源 priorities/view，predecessor_authorizations 为当前可见前置产品 priorities/view 集合。返回仅获准范围内的不可变快照和分页总数。空前置集合返回零总数，承诺仍校验源产品归属。浏览器 BFF 见下节。

## 浏览器承诺前置历史

`GET /api/v1/products/{code}/roadmaps/cross-snapshots/{commitmentBizId}` 仅接收 page/pageSize（默认 1/20，pageSize 最大 100）。BFF 核验源 roadmaps/view 与 priorities/view 的一致事实，经内部 cross-snapshot-targets 发现历史关联产品并逐个核验 priorities/view，再调用 cross-snapshots 返回获准范围分页。内部发现集合不返回浏览器；权限服务故障保留错误，发现修订或 actor 变化拒绝。该路径读取承诺 UUID，不接受客户端授权或前置身份覆盖。

## 历史前置展示

承诺历史每条基线提供“查看前置历史”，按需加载该承诺 UUID 的快照，显示确认当时的标题、范围、状态、修订、依赖原因、探索窗口和期限。当前前置事项另以明确链接进入，不把历史内容当作实时状态。分页和计数来自权限过滤 BFF；空页仅表示无可见记录。组件核验承诺/源事项及每条快照身份、修订和日期字段。浏览器模拟数据验证已覆盖展开/收起、分页和历史字段展示；真实环境验收仍待完成。
