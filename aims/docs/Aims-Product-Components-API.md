# 产品模块 Runtime API

当前实现内部 Runtime 与浏览器 BFF，已提供模块浏览与创建页面，已接入移动交互，浏览器专项验收仍待完成。路径统一为 `POST /v1/aims/internal/products/{productCode}/components:{action}`。

| action | 精确服务 capability | 用户权限 | input |
| --- | --- | --- | --- |
| list | aims:product-components:read | aims:product_components:view | parent_id（null 为根）、page、page_size（1～100） |
| create | aims:product-components:create | aims:product_components:edit | parent_id、name、description、sort_order、expected_revision |
| move | aims:product-components:move | aims:product_components:edit | component_id、parent_id、expected_revision、expected_component_revision、reason |

调用信封包含 `authorization`、`input`；写操作另需 `idempotency_key`。actor 来自经过服务认证及委托校验的 Runtime 上下文，不取 input。统一产品授权 helper 在事务中核验权限事实；服务认证、tenant/deployment 和 actor 委托沿用现有 Runtime 边界。

列表仅返回指定层并稳定按 sort_order/id 排序，包括 total、page、pageSize、workspace_revision；条目包含 id、biz_id、product_code、parent_id、name、description、sort_order、revision 和 child_count。写入返回标准命令回执；实际数据位于 result value。创建返回新模块字段与 workspace_revision，移动返回模块标识、父节点和新修订。

最大三层；创建和移动在产品根锁内验证整棵树，最大 10000 节点，超限拒绝。写入、产品修订、审计及幂等回执事务提交。模块修订冲突返回 409，其他结构输入错误为 400；不存在或不可见的父对象沿用统一 404。

服务 grant 由 manifest 声明与生成脚本维护，包含 data-runtime、tenant-runtime 两个 audience。尚未在目标租户安装或执行真实 JWT 签发探测。

## 浏览器 BFF

- GET `/api/v1/products/{productCode}/components`：parentId 可省略表示根，page/pageSize 为分页查询。
- POST 同路径：parentId 必须显式为正整数或 null，expectedRevision、name 必填；description、sortOrder 可选。
- POST `/api/v1/products/{productCode}/components/{componentId}/move`：parentId、expectedRevision、expectedComponentRevision、reason 必填。模块 ID 只取路由。

写入必须携带 Idempotency-Key，不接受查询参数；所有输入拒绝未知字段。BFF 从统一产品授权获取可信 actor/facts，向自身 Runtime 传递精确服务 scope 和 15 秒授权事实，不允许浏览器自报 actor 或权限。所有响应 no-store；Runtime 未处理保留 503。

GET `/api/v1/products/{productCode}/components/permissions` 要求模块 view，返回产品标识/状态/修订与 edit 判断。页面权限快照仅控制交互，写入仍由 BFF 与领域事务重新授权。

## 功能读取扩展

现有功能列表、详情及复用 FeatureRecord 的规划关联读取增加 `component_id: number | null`；null 表示未分组。部署这些读取代码前必须应用 v5.21_product_components 迁移，不以忽略缺失字段或恢复本地数据库读取作为兼容路径。功能归类写入口见下文。

功能列表增加互斥查询：`componentId=<正整数>` 仅返回该模块直接归属功能，`ungrouped=true` 返回未分组功能；两者省略表示全部，不隐含包含后代模块。不接受同时传入两者、数组或非规范 ID。Runtime 对指定模块先核验产品归属，再使用同一筛选条件计数和分页。

## 功能归类写入

POST `/api/v1/products/{productCode}/features/{featureId}/component`，featureId 为功能 biz_id。body：componentId（正整数或显式 null）、expectedRevision、expectedFeatureRevision、reason；必须提供 Idempotency-Key，无查询参数。BFF 使用 product_features:edit；Runtime 路径 `POST /v1/aims/internal/products/{productCode}/features:component-assign`，精确 capability `aims:product-features:component-assign`。输入转换为 biz_id/component_id/expected_revision/expected_feature_revision/reason，原子更新归属、修订、审计和回执。目标不属本产品拒绝；不改写规划或历史范围。

功能详情页已接入归类 modal：模块列表按层分页浏览到第三级，当前模块不能重复选择但可以进入其下级，null 操作为移回未分组。表单冻结功能/产品修订，确认后提交，成功刷新详情与权限。浏览器专项与视觉验收仍待完成。

## 模块编辑

POST `/api/v1/products/{productCode}/components/{componentId}/edit` 接收 name、description、sortOrder、expectedRevision、expectedComponentRevision、reason；不接受 parentId。Runtime 为 components:edit，精确 aims:product-components:edit，业务 product_components:edit。Idempotency-Key 必填，字段必须完整提供，返回 value.component 与 workspace_revision。修改父节点使用独立 move。

模块页面已接入编辑弹窗，与创建共享名称、说明、排序字段；编辑额外要求原因。父节点不可在编辑弹窗修改，保存时提交冻结双修订，校验返回内容与新模块修订后刷新。浏览器专项验收仍待完成。

## 模块删除 Runtime

POST `/v1/aims/internal/products/{productCode}/components:delete`，精确 capability `aims:product-components:delete`，用户权限 `product_components:delete`。input 为 component_id、expected_revision、expected_component_revision、reason；幂等信封沿用其他写命令。存在子模块/功能引用返回 409 product_component_referenced，拒绝级联删除。删除 BFF 与 UI 已接入，浏览器专项仍待完成。

DELETE `/api/v1/products/{productCode}/components/{componentId}` 接收 expectedRevision、expectedComponentRevision、reason，Idempotency-Key 必填，不接受 query、cascade 或引用计数字段。使用独立 delete 权限，模块权限读取新增 delete 布尔值。

模块删除页面使用独立 delete 权限，已知子模块存在时禁用入口；服务端仍核验所有引用。填写原因后 Foundation 危险确认，失败保留请求重试键，删除页末唯一项后回退一页。
