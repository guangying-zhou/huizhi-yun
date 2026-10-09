# 统一产品中心当前目录读取

## 路由与授权

`POST /v1/enterprise/aims/product-list` 接收 `{tenant,deployment,input,authorization,assets_authorization}`。`input` 为既有 `ProductListQuery`，`authorization` 为既有 Aims `ProductListPermit`，`assets_authorization` 复用 Assets 目录的绑定许可格式。Runtime 要求精确 `aims:products:view`、当前有效 Console service credential/grant、已签名用户 actor；外层再次校验两份授权的 actor、tenant/deployment 和最多 15 秒有效期。未知字段拒绝，浏览器不能直接提供可信许可。

`enterpriseplanning.NewCatalogService` 在初始化时核验 Aims 列表依赖的受管映射（workspace/member/component_source/line_workspace），取得同池 Assets 的 `product_assets`、`asset_category_groups` 受信物理表名。构造/请求均不接受 SQL、schema 或自由 predicate。读取账号需要目标库 schema 级 SELECT，以及 55 个受管兼容视图逐个 TABLE 级 SHOW VIEW，以便启动时验证视图定义；不授予 schema 级 SHOW VIEW 或任何 DDL 权限。

当前 Assets scope 使用原 `EnterpriseProductReadPredicate` 和目录 authorizer，Aims scope 独立使用既有 default/override mask 与当前有效会员关系。仅组合目录路由允许显式 Assets `none`（scope units 空或 `[]`）编译为空 grant；这时仍可返回 Aims 有权读取的独立 workspace 编码/状态，不返回 Assets 名称/产品线。原 Assets 目录端点的 none 拒绝语义保持不变。

## 同事务当前源

`Registry.BeginSnapshotReadTransaction` 先用锁读验证持久 tenant/environment/deployment/schema/generation，并保持 registry 共享锁；随后第一个非锁定领域读取建立 Repeatable Read 快照。Assets 范围查询、current_catalog、总数、分组、分页和有效会员查询在同一快照中完成。锁读读取当前事实，不被描述为快照读取。

`productcenter.ListProductsInTransaction` 复用旧列表的 workspace/candidate/source 结构、scope mask、分页与分组规则，将原 projection 源替换为受控 `current_catalog` CTE。`CurrentCatalogSource` 的字段不导出；构造器仅接受合法的已引用单表名、actor、到期时间及产品 code 集合，标识符和数据参数分离。scope/code 参数不能变成 SQL。

统一列表有以下约束：

- 当前名称、产品线名称、状态和更新时间从 Assets 读取；不再用 `source_product_name`、`line_label` 历史快照填当前字段或搜索。
- 不可见 source 不进入候选/source 子行和分组计数，也不输出其 managementProductCode/componentID；只有不可见 source 的合并产品线管理行不输出。
- 有 Aims 权限但没有可见 Assets 记录的独立 workspace 可以按自身 code/status 展示；当前名称/产品线为空。
- 全线 `CanUnify` 仅在 Assets 全域读取、Aims 全域列表（default mask 7、无 overrides）和全域 onboarding 都成立时计算。计算使用未分页、未搜索过滤的当前完整产品线；部分授权不能推算全线可接入性。
- 历史表没有被覆盖，旧 `ListProducts` 继续使用 projection/generation 语义。统一列表的 `catalog_generation` 为 null，不伪装成已完成的旧 refresh；`catalog_updated_at` 为当前可见源的最大更新时间。新的接入/整线接入必须建立独立受控命令合同，不能因 null 回退旧库。

## 实测证据

2026-09-13，真实隔离 MySQL：

```sh
(cd data-runtime && HZY_PRODUCT_CENTER_TEST_SOCKET=/tmp/hzy-product-center.catalog.2z_de73r/mysql.sock \
  go test -race -run 'TestMySQLCurrentCatalogScopeNamesAndSnapshot|TestMySQLProductList' -v ./internal/enterpriseplanning ./internal/apps/aims/productcenter)
node data-runtime/scripts/test-enterprise-catalog-mysql.mjs
```

- canonical schema 服务测试通过（6.404s）：当前改名立即可见、旧快照不变、隐藏来源/历史关键词不泄漏、分页/分组同授权、部分接入全线提示、会员撤销。范围查询建立快照后，另一连接提交改名及新增；本次 count/page 保持旧快照，下次读取看到新事实。
- 三项旧 ProductList 实际 MySQL 回归通过（4.758s）。构造器拒绝任意 SQL/schema/重复 scope 的 race 单测通过（1.453s）。
- 独立真实 HTTP + MySQL 路由测试通过（1.662s）：精确 live grant、用户签名、双授权 tenant/deployment/actor、过期范围、非法 scope key、Assets none 保留 workspace code、实时名称、撤销 credential/grant、旧 generation 拒绝。
- `go test ./internal/server ./internal/enterpriseplanning ./internal/apps/aims/productcenter` 通过。该无环境变量命令中的 MySQL 用例会 skip，上面的显式隔离命令才是实际数据库证据。

服务测试 PID 439 已正常 shutdown；fixture 库剩余 0，自建 datadir/socket 删除。HTTP runner 使用独立 `/tmp/hzy-test-mysql-*`，在 finally 中停止进程并删除 datadir，成功完成清理。未访问实际业务库。Host/BFF 和测试站浏览器验收由对应工作包继续完成。

## Workspace 详情读取

`POST /v1/enterprise/aims/product-workspace:view` 使用同一精确 `aims:products:view` capability，body 为 `{productCode,tenant,deployment,authorization,assets_authorization}`。Aims authorization 为原 `AuthorizationPermit(products:view)`，绑定实际 productCode/actor/facts；Assets 为目录的独立 scope 许可。返回原 `WorkspaceDetail` snake_case 字段：`management_kind`、Workspace 的定位/目标用户/价值说明/状态/修订/审计字段，以及三个当前名称字段。

`CatalogService.ReadWorkspace` 先锁并重新校验 Aims workspace 授权，再在同一 generation/RR 事务内编译 Assets scope，调用 `productcenter.ReadWorkspaceInTransaction`。产品型空间仅从授权 Assets 主档填当前名称/产品线；产品线型空间保留 Aims 的 `management_kind=product_line`，仅当存在显式接入、Assets 可见且当前仍属于该线的 source 时填当前线名称。同线但未接入的可见产品不能代替隐蔽 source 为管理空间提供当前身份；无可见来源则三个当前字段为空。旧 projection 与 `line_label`/`source_product_name` 历史快照不作为回退，也不新增历史字段暴露。旧 `ReadWorkspace` 及所有 workspace 写命令保持原行为。

MySQL 中原 `AuthorizeWorkspaceTransaction` 的根行 `FOR UPDATE` 需要对应 UPDATE（或 MySQL 允许的等价锁权限）；仅 SELECT/SHOW VIEW 足够列表读取，但不足以运行这个原有锁式 workspace 授权。隔离 HTTP 测试给只读目录账号补充了 `product_workspaces` view 及其物理根表的 UPDATE 权限，没有授予其他业务表写权限。接口本身只读，不产生 receipt/audit。

新增真实验证：`TestMySQLCurrentCatalogScopeNamesAndSnapshot/workspace-current-identity` 覆盖当前产品改名、授权已接入产品线来源、同线未接入/不可见来源不泄漏、Aims 自身字段保留、会员事实变化拒绝（所在包 race 4.404s）；旧 `TestMySQLWorkspaceReadCarriesCatalogIdentity` 回归通过（1.987s）。`node data-runtime/scripts/test-enterprise-catalog-mysql.mjs` 现包含 workspace 真实 HTTP，验证原字段和当前名称、Assets none 字段留空、错误 code/actor/tenant/deployment/action、篡改签名、旧修订拒绝；最新通过 1.768s。

本轮专用 `/tmp/hzy-product-center.workspace.q2t0s2zm` PID 14937 已 shutdown，fixture 库剩余 0，datadir/socket 删除；HTTP wrapper 完成自身 finally 清理。未访问实际业务库，未扩大到 workspace 写入。

## 当前目录候选与接入

`enterpriseplanning.OnboardingService` 在统一库内复用产品、整线接入的 owning-domain 算法与 `ExecuteCommandInTransaction`：继续使用 `product_catalog_control` 单行锁协调独立产品与整线管理，保留唯一归属、部分选择、成员、组件、历史来源快照、审计与幂等回执。原 adapter 入口仍使用旧证据合同；统一服务不接受调用方传入 source 事实，也不从投影补源。

接口为 `ProductCandidate`、`LineCandidates`、`Onboard`、`OnboardLine`。独立候选响应 `{item,watermark}`；整线响应 `{line_code,label,watermark,items,total}`。权限由真实 `OnboardPermit`、组织目录负责人证据和独立 `AssetsCatalogAuthorizer` 提供。整线候选和接入要求 Assets `AllProducts`，与首页 `CanUnify` 的完整可见要求一致；局部产品权限不能获得隐藏产品名称、计数或整线证据。独立产品可使用精确已授权 code 集合。当前生命周期能否接入复用 Assets 的 `ProductStatusOnboardable`，不维护第二套状态规则。

`current-assets:v1:<sha256>` watermark 覆盖当前候选内容及 tenant/environment/runtime/schema/generation、实际域 owner 和 actor，不复用 projection generation/watermark。整线写操作重新查询并比较，改名、产品线变更、状态或成员集合变化使旧确认失败；不把请求中的产品名称或生命周期作为证据。`source_product_name`、line label 和 audit source 仍是接入时历史快照，后续详情当前名称由授权 Assets 主档读取。

写事务先独立解析 Assets **Read** 与 Aims **Write**，校验相同 pool、binding、schema、generation，再通过 Aims `BeginWriteTransaction` 持有整个统一库的持久 generation SHARE 锁。锁序为 generation → catalog control → 当前 Assets 行 SHARE → 原 workspace/receipt。不会为了关联读取开放 Assets Write。所选产品的当前事实被锁至提交；未选或其后新增的产品保留独立接入语义，未把整条产品线永久封闭。候选查询则沿用 snapshot read 事务。负责人是否仍为有效组织用户须由 Host 在进入事务前通过真实目录服务核验并提供短期证据，服务不生成身份。

统一 `OnboardProductLineInTransaction` 的保留编码碰撞检查从登记的 Assets 产品表读取，legacy 入口保留原 projection 检查。初始化只验证必要 managed views，不创建 view 或修改业务路径配置。

隔离验证：`HZY_PRODUCT_CENTER_TEST_SOCKET=<专用实例>/mysql.sock go test -race ./internal/enterpriseplanning -run TestMySQLCurrentAssetsOnboarding -count=1 -v` 通过（4.553s）；使用 `/tmp/hzy-product-center.onboard.qg7x9kki`、mysqld PID 48106，已 shutdown 并删除。canonical Aims 全表与 Assets 两主档表 fixture 验证：Assets Write disabled 时接入成功、投影矛盾不影响当前事实、隐藏资产拒绝、局部权限不能列完整线、改名使确认 hash 失效、两个接入动作最终审计失败无残留、当前快照保留、未选中产品独立接入、退役产品拒绝、原 Go 两入口回执重放、统一产品与整线竞争仅一个所有者、错 tenant grant 拒绝。原 `TestMySQLOnboard*`、`TestMySQLLineOnboard*`、`TestMySQLLineAndIndividual*` 真实回归通过（6.717s，另一专用实例 PID 46679 已清理）。服务、productcenter、Assets、Aims race 单测通过；这些结果不代替后续 HTTP/BFF 身份与组织目录验收。

产品选择器另提供 `ProductsCandidates`：输入 `keyword/code/productLine/page/pageSize/watermark`，固定候选 permit 的 `product_code="*"`，返回原 Assets `ProductCatalogPage` 结构。它直接查询已授权 Assets 产品，包括尚未接入 Aims 的记录，不使用 workspace 列表替代候选。匹配记录在同一 snapshot 中按编码流式计算摘要，仅保留当前页；total、页内容与摘要来自相同可见集合，隐藏记录的变更不改变水印。`current-assets-page:v1:<sha256>` 绑定过滤条件而不绑定 page/pageSize，后续页必须提供该水印，集合变化返回 409。它与整线确认水印分开，不能将分页水印冒充整线确认。当前实现计算完整可见匹配集合摘要，时间成本随匹配产品数增长，避免引入会泄漏隐藏变更的全局目录 revision。

补充候选分页实测覆盖：同scope分页、水印跨页稳定、隐藏产品改名不改变可见水印/total、可见产品改名拒绝旧水印、空scope返回空页、后续页缺水印拒绝。扩展 `TestMySQLCurrentAssetsOnboardingAtomicAndScoped` 通过（2.29s），专用 `/tmp/hzy-product-center.structure.oxhksd0o`、PID 55238 已关闭并删除。
