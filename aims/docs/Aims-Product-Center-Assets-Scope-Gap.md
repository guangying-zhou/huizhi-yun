# Assets 产品台账对象范围缺口

核验日期：2026-09-09。状态：未完成，影响 PC11/PC12 真实授权验收。

## 当前证据

- Assets `server/api/v1/products/[id]/versions.get.ts` 已检查 `products:view`，并向本地 lookup 传递已验证 `current_user`。这是资源级授权，不能单独证明对象范围。
- Data Runtime `internal/apps/assets/runtime_catalog.go` 的产品详情路由调用 `getProduct(ctx, id)`，未传 query。详情 SQL 仅按 `p.id` 限定，没有当前用户或授权范围谓词。
- 产品列表也使用专用 `listProducts`，不能以 compat Adapter 的通用范围逻辑证明它受保护。
- Assets `resolveAssetsRuntimeQuery` 的范围资源集合未包含 `products`；本地版本摘要入口还绕过该通用转发。
- 规范 `product_assets` 有 `business_owner_uid`、`technical_owner_uid`、`project_code`，没有规范归属部门字段。不得把其他表的 `dept_code`、创建人或历史项目字段臆断为产品部门范围。

## 必须完成的实现

1. 复用 Foundation/Console scoped authorization，按 `products` 资源与当前动作解析范围；保留同一授权单元内条件的 AND、不同授权单元间的 OR，不能拆开合并权限与范围。
2. 明确产品直接关系对应业务／技术负责人，项目范围对应产品的规范 `project_code`；核对 Console 已定义的关系谓词后实现，不新增平行权限算法。缺少可执行部门映射的授权单元不得放宽为全局。
3. 通用产品入口和本地版本摘要 lookup 均传递服务端派生范围，清除浏览器伪造范围参数。
4. Runtime 产品列表（含 total）、详情、修改和关联底座／资产／文档逐项执行对象范围。仅增加 BFF 校验、仅限制一个摘要接口或只隐藏按钮均不足以关闭缺口。
5. 写入校验与业务变更须在同一事务内；关联入口还须校验目标对象权限及归属，不能利用可写产品取得其他对象权限。
6. 跨应用产品目录 service contract 单独保留其精确 capability，不能错误套用普通用户入口或恢复宽 scope。

## 验收证据

- 隔离 MySQL：业务负责人、技术负责人、项目范围、无关用户、全局有效授权；授权单元交叉组合、过期、缺失、伪造范围。
- 列表 items 与 total 一致；详情与所有可达写入口使用真实存量产品行验证；写失败不得留下部分关联。
- 浏览器：相同身份在台账详情与版本摘要中的可见范围一致。
- 真实租户：Console scoped authorization、可信 actor 传播和权限撤销实际生效。

在上述证据齐备前，产品中心整体授权验收仍未完成。先前“已传递用户身份”的记录不应被解读为产品对象范围已经执行。
