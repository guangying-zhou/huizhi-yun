# 产品试点 API 领域复用审计

更新：2026-09-15。范围是当前 Enterprise Host 已登记的产品试点 API 源码，不代表部署环境已经启用。

| 入口组 | Enterprise API 数 | 当前复用证据 | 待补证据 |
| --- | ---: | --- | --- |
| Aims 产品规划 | 63 | 51 个路由直接导入 Aims 的需求、功能、版本、轻量计划、验收、交接等 handler；需求创建已由重复 BFF 实现改为旧入口和 Enterprise 共用 `productRequestCreateRuntime` | 产品列表/接入、空间、需求读取、交接候选、组件共 12 个路由使用 6 个 Enterprise adapter utility，需逐 operation 固定旧入口与 Runtime 同一领域服务的映射 |
| Assets 产品主档 | 18 | Host 路由只调用 `enterpriseAssetsProducts`、`enterpriseAssetsRead`、`enterpriseAssetsCategories`、`enterpriseAssetsLinks`，路由层无 SQL/数据库客户端 | 除 1 个复用 Assets 授权核心的目录路由外，其余 17 个需逐 operation 固定旧 Assets 入口与 Runtime adapter/owning service 的同一映射 |

`enterprise/test/pilot-domain-reuse.test.mjs` 固定当前 63 + 18 个实际路由，拒绝 Host 路由出现 SQL、数据库客户端或未登记 handler，并证明需求创建的新旧入口共用相同输入校验、对象授权、幂等键和 Runtime 命令。其余 29 个路由的自动映射如下；测试逐项固定路由数、旧入口、Enterprise utility、Foundation operation 登记和 Runtime adapter 文件，避免新增平行 Host 状态机。

| Enterprise utility | 路由数 | 旧入口代表 | shared handler / Runtime adapter |
| --- | ---: | --- | --- |
| `enterpriseProductList` | 1 | Aims 产品列表 | `aims/product_list.go` |
| `enterpriseProductOnboarding` | 1 | Aims 产品接入 | `productOnboardingRuntime` → `aims/product_onboard.go` |
| `enterpriseProductWorkspace` | 1 | Aims 产品空间 | `aims/product_workspace.go` |
| `enterpriseProductRequestRead` | 2 | Aims 需求列表/详情 | `aims/product_requests.go` |
| `enterpriseProductHandoffCandidates` | 2 | Aims 规划交接候选 | `aims/product_handoff_runtime.go` |
| `enterpriseProductComponents` | 5 | Aims 模块读写 | `productComponentRuntime` → `aims/product_center_components.go` |
| `enterpriseAssetsProducts` | 6 | Assets 产品主档 | `assets/product_master_commands.go` |
| `enterpriseAssetsRead` | 3 | Assets 字典/资产读 | `assets/adapter.go` |
| `enterpriseAssetsCategories` | 3 | Assets 产品线管理 | `assets/product_master_commands.go` |
| `enterpriseAssetsLinks` | 5 | Assets 产品关联 | `assets/product_link_commands.go` |

复核实际请求顺序后，旧 Assets 数据 API 会先经过 `assets/server/middleware/tenant-runtime.ts`，匹配 `assetsPermissionRoutes` 后代理到 Runtime；页面 route 中已禁用的本地 repository fallback 不会承担数据写入。Runtime 的旧 `/v1/assets/products` create/edit 路径在携带幂等键时调用 `executeLegacyProductMaster`，Enterprise 路径调用同一 `enterpriseAssetsProducts.Command`，两者最终共用 `ExecuteProductMasterInTransaction`、`ExecuteOwnedInTransaction`、产品校验、范围复核和事务。源码合同已固定这条请求顺序，避免以后误把不可达 fallback 当成第二状态机。

隔离回归发现测试服务 JWT 仍使用裸 `sub`，而当前统一服务主体合同要求 `client:<client_id>`；旧 Assets credential guard 也仍接受过时裸主体。现已将 guard 收紧为 `client:assets.runtime` 并修正 fixture，未放宽 tenant、deployment、app、client、credential 或精确 scope 校验。[最新隔离回执](../deploy/test-env/artifacts/C000001.assets-product-master-cross-entry-isolated-mysql-verification.json)证明当前身份合同下双向跨入口同键重放、异 payload 409、单业务行/receipt、授权/credential 拒绝和晚失败回滚均通过。因此当前 81 条清单已覆盖 INT-103；该结论不代表部署环境已验证。
