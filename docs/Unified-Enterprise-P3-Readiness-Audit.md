# ADR-018 P3 Host / Layer / BFF / Task 就绪审计

核对日期：2026-09-15。范围：INT-301～INT-305。证据边界为当前整合分支已提交源码、静态配置和自动测试；本轮未访问环境、未部署，也不把共享工作树中尚未提交的 Aims 工作计入完成证据。

## 1. 结论

| 任务 | 状态 | 已证明 | 完成前缺口 |
| --- | --- | --- | --- |
| INT-301 | **完成** | `enterprise/` 是独立最小 Host，只 extends Foundation；唯一 `app.vue`、layout、登录入口、首页、配置生成和 Cloudflare dry-run 模板已存在。Gateway/Host 拓扑、路由前缀、构建和基础认证测试通过 | — |
| INT-302 | 部分 | Aims/Assets 显式 `layer/entry.mjs`、页面命名空间、模块路径 helper、重复/越界路由拒绝、Layer 相对共享导入和两个独立应用 typecheck 已证明 | 尚未迁入的页面仍列在 deferred 或未登记；完整 layout/middleware/API/auto-import/CSS/public/dependency 冲突清单尚未逐项关闭，`handlers`/`tasks` 仍为空 |
| INT-303 | 部分 | 单一 Console OIDC 会话协调器按 tenant/subject/policy/deployment 生成 scope，合并并发验证，拒绝旧响应恢复身份；测试覆盖切用户、切租户、策略变化、登出竞态、失败重验及安全深链 | Host 只清理 `hzy:enterprise:*` Nuxt data/state；复用的 Aims/Assets composable 仍有 `product-workspace:*`、`assets-dictionaries` 等非主体化 key。所有旧页面/URL 尚未迁入，无法证明完整刷新、前进后退和跨模块返回 |
| INT-304 | 部分 | 提交 3fe32c87 登记 120 个 Host BFF route（Aims 93、Assets 26、Altoc 1）；已登记 route 使用真实 H3 event 调用模块 handler/Foundation Runtime transport，专项 bridge 测试覆盖身份、scope、错误、分页和幂等边界 | Aims/Assets 完整业务面仍未挂载；deferred 页面没有对应 BFF/Runtime；不能由现有产品及只读项目/资产链推定全部旧请求/响应/错误语义已保留 |
| INT-305 | 部分 | Enterprise Layer 的 `tasks` 均为空，Host 不注册业务 cron；共享 Worker 业务 drain 默认关闭，测试 Gateway 每个 cron 只提交一次执行。Aims unified scheduler 使用 storage/generation fencing 和签名身份 | Aims/Assets 原 Worker 仍各自保留任务定义；只接通 Aims 部分统一 drain，Assets、通知、milestone 等完整 ownership/迁移开关和外部投递身份尚未逐任务闭环；静态配置不能证明环境中无双消费者 |

## 2. INT-301 最小 Host 证据

| 原文要求 | 代码证据 | 测试/构建证据 |
| --- | --- | --- |
| 复用 Foundation | [`enterprise/nuxt.config.ts`](../enterprise/nuxt.config.ts) 只以 `extends: ['@hzy/foundation']` 引入共享基础层，没有 extends Aims/Assets 整应用 | `enterprise typecheck` 与 Cloudflare `verify:cloudflare` dry-run 通过 |
| 统一布局、登录入口 | [`app.vue`](../enterprise/app/app.vue) 唯一挂载 `UApp/NuxtLayout/NuxtPage`；[`default.vue`](../enterprise/app/layouts/default.vue) 提供统一导航/退出；[`login.vue`](../enterprise/app/pages/login.vue) 复用 Foundation OIDC，旧三个登录 URL 为 alias | `session-cache.test.mjs` 验证可信会话和安全 returnTo；`enterprise-topology.test.mjs` 验证 callback、静态资源和旧业务前缀 |
| 统一配置、构建和部署模板 | `enterprise-pilot-config.mjs`、`render-cloudflare-config.mjs` 和 `package.json` 的 `verify:cloudflare` 形成独立 Host 配置与 dry-run；Gateway 仅在精确 tenant/environment/deployment 与 Service Binding 下转发 | 拓扑测试拒绝缺 Binding/错绑定；最近 dry-run 构建成功且明确没有部署，构件指标见[构建基线](./Unified-Enterprise-Build-Baseline.md) |
| 空业务页验证基础能力 | [`index.vue`](../enterprise/app/pages/index.vue) 与 [`module-entry.vue`](../enterprise/app/module-entry.vue) 提供不复制业务实现的 Host/模块入口；业务页面由 registry 后续显式登记 | `module-path.test.mjs`、`registry.test.mjs` 验证前缀一次、路径/名称唯一和越界拒绝 |
| 不复制 Console/Foundation | Host 认证、授权、Runtime transport 都导入 Foundation；Console root/OAuth 保持独立 | `enterprise-topology.test.mjs` 明确证明 Console root/OAuth/callback 与 Host 边界 |

这些证据覆盖 INT-301 的交付物与静态验证边界，因此实施计划可勾选 INT-301。它不证明真实页面、性能、调度或发布验收，不能据此勾选整个 P3。

## 3. INT-302 Layer 与冲突状态

- [`aims/layer/entry.mjs`](../aims/layer/entry.mjs) 与 [`assets/layer/entry.mjs`](../assets/layer/entry.mjs) 只登记 Host-ready 页面，并明确维护 `deferredPages`；独立应用仍使用原 `nuxt.config.ts` 构建。
- [`composition/registry.mjs`](../enterprise/composition/registry.mjs) 强制模块 prefix、route name、嵌套路径和冲突检查；[`modulePath.mjs`](../aims/layer/modulePath.mjs) 与 Assets 同名文件保证独立路径不加前缀、Host 路径只加一次。
- Assets 字典 Layer 已把 consuming-root `~~/shared` 改成相对 Assets package 的单一常量源，并由 `assets-layer-readiness.test.mjs` 防回归。
- Host 合同第 3 节已盘点页面、layout、middleware、组件/composable、API、server utils、plugin、task、public、CSS/alias 冲突，但当前只对已登记子集关闭冲突。Aims/Assets 大量原功能仍 deferred，不能用 registry 不冲突证明完整应用可组合。
- 2026-09-15 复核：`enterprise/test/registry.test.mjs` 已把依赖版本、composable 重名、页面自带 layout/具名 middleware、模块依赖 `public/` 或全局 CSS、`handlers/tasks` 非空等冲突类别变成失败即阻断的守卫，当前 0 违例（内联 middleware 函数随页面携带，允许）。页面决定仍缺：Aims 115 页已登记 44、Assets 34 页已登记 11，余下 93/23 页无登记也无书面决定，`deferredPages` 清单已不存在。

完成 INT-302 需要：为全部拟迁页面逐项决定“迁入/保留独立/退役”，生成最终 page/API/component/composable/plugin/task 注册清单并拒绝规范化名称冲突；消除剩余 Host 根别名、全局 middleware/layout、CSS reset、public URL 和依赖冲突；随后在同一提交验证 Aims、Assets 独立构建及 Host 构建。

## 4. INT-303 会话与缓存状态

[`enterprise-session.client.ts`](../enterprise/app/plugins/enterprise-session.client.ts) 复用 `useAuth()` 和 Console `/api/auth/me`，不会从浏览器自报字段构造缓存身份。[`session-cache.mjs`](../enterprise/shared/session-cache.mjs) 只接受 `console_oidc` 已认证会话，并把 tenant、uid/subject、policyVersion、deployment 纳入 scope；无效或重验失败会清空 scope，迟到旧响应不能恢复旧身份。`app.vue` 的 page key 随可信 scope 变化，已登记页面会重建。

现有测试 7 项覆盖租户/用户/策略变化、并发去重、登出竞态、重验失败、替换会话拒绝及本地深链/外部跳转拒绝。但插件当前只调用：

```ts
clearNuxtData(key => key.startsWith('hzy:enterprise:'))
clearNuxtState(key => key.startsWith('hzy:enterprise:'))
```

复用模块仍存在不带该前缀及主体维度的状态 key，例如 Assets `assets-dictionaries`、Aims `product-workspace:${code}`。页面重建不等于这些全局 `useState/useAsyncData` 已失效。必须统一 key builder 或维护经过测试的模块 cache invalidator，并以两个租户、两个主体验证切换前后内容、total、权限按钮和错误缓存，之后才能勾选 INT-303。

## 5. INT-304 BFF / Runtime 复用状态

以已提交 `3fe32c87` 为准，Enterprise 已登记 120 个 route：Aims 93、Assets 26、Altoc 1。产品目录、接入、模块、功能、需求、版本、规划、验收/发布、项目/工作项读取及部分写入，以及 Assets 产品、分类、字典、资产读取和关联操作已有对应 BFF。工作项创建/基本信息编辑/版本关联具备事务 receipt、审计和内容版本冲突检测，状态/结构/outbox 编辑仍待迁移；数字资产读取/创建/编辑使用独立 capability 与 owner/project 对象范围，列表使用快照事务和 SQL 分页。数字资产及 IP 的隔离 SQL 测试已按真实 additive 迁移顺序验证 CHECK 保留与具体 capability 拒绝，不把它视为目标环境 schema 已应用。route 将收到的真实 H3 event 传入 Aims/Assets handler 或 Enterprise bridge；浏览器业务入口不构造模拟 H3Event；Aims scheduled completion 仅将真实 Cloudflare env 与空请求上下文交给既有凭证 helper，不伪造 Gateway trust，投递经真实 Gateway Binding。Foundation 统一完成 Console session、scoped authorization、目标 Runtime transport 和错误保留。

bridge 测试中的远端 Runtime/Console 是显式 fixture，只证明路由、输入、身份、scope、幂等和错误映射，不证明目标环境联调。完整 operation 追踪见[Operation 覆盖矩阵](./Unified-Enterprise-Operation-Coverage-Matrix.md)；页面缺口见[产品页面 API 就绪台账](./Unified-Enterprise-Product-Page-API-Readiness.md)。Aims/Assets 尚未登记页面及 BFF 不能由现有 route 覆盖，因此 INT-304 保持未完成。

## 6. INT-305 任务所有权状态

| 任务族 | 原独立登记 | Host/Gateway 当前代码 | 当前判断 |
| --- | --- | --- | --- |
| Aims integration drain | Aims task 保留；共享 Worker cron 默认关闭 | Gateway 可按 `enterpriseScheduler.storage/generation` 签名唤醒统一 Runtime；generation 与 storage 被 HMAC 和 Runtime binding 固定 | 代码具备单 owner 切换机制，环境 owner/在途 ACK 仍需逐次证明 |
| Aims notification due | Aims 每 15 分钟声明 | Host Layer `tasks=[]`；统一 drain 内有部分通知 checkpoint 处理 | 未证明全部通知流已迁移及旧触发关闭 |
| Aims milestone rollover | Aims 每日声明 | Host 未接管 | 保留独立，尚无最终保留/迁移登记 |
| Assets notification/status | Assets 每 15 分钟声明两项 | Host Layer `tasks=[]`；测试配置无业务 cron | 未接管；需固定唯一 owner、generation、身份、receipt/checkpoint 与回退 |

`scheduled-drain-config.test.mjs` 证明共享 Worker 默认不会自动启用 drain；`cloudflare-gateway.test.mjs` 证明单个 scheduled event 对 policy sync 和 integration drain 各只 `waitUntil` 一次；Gateway scheduler 与 Aims wake 测试证明 generation、storage、tenant/deployment、签名和 service identity 被绑定。这些是机制证据，不是所有任务已经迁移的证据。完成 INT-305 前须用逐任务清单记录旧 owner、目标 owner、开关、generation、最后租约/在途 operation、正式 service capability、切换及回退测试，并对真实环境回读唯一触发者。该逐任务清单已形成于[后台任务所有权清单](./Unified-Enterprise-Task-Ownership-Inventory.md)（2026-09-15）。

## 7. 本轮静态校验

执行以下不访问环境的测试，31 项通过：

```sh
node --test \
  enterprise/test/module-path.test.mjs \
  enterprise/test/registry.test.mjs \
  enterprise/test/session-cache.test.mjs \
  enterprise/test/assets-layer-readiness.test.mjs \
  deploy/test-env/enterprise-topology.test.mjs \
  deploy/test-env/cloudflare-gateway.test.mjs \
  deploy/cloudflare/tenant-gateway/test/scheduled-drain-config.test.mjs
```

Node 对 `deploy/cloudflare/tenant-gateway/src/index.js` 报告根 package 未声明 module type 的重解析警告；测试仍通过。该警告不改变本审计结论，但后续构建治理可单独处理。


## 3fe32c87 新增候选证据

工作项完成申请、回调、撤回与人工 replay 以及 IP list/detail/create/edit 已在整合分支收口；源端与 Workflow canonical DDL 的隔离事务/幂等/审计/Registry fence 演练通过。Workflow target BFF 的 command hash/HMAC 必须先于目录查询与 actor 委托。scheduled completion 经真实 Gateway Binding，测试覆盖路由 app/deployment/prefix、签名/actor 留存与缺绑定拒绝；配置仍未启用，目标环境 schema/grants/任务及端到端验收待完成。IP 产品/文档关联、其他工作项状态/结构与未挂载页面仍未完成。

缓存提交 1c9daa47 覆盖五个已挂载 Assets 页面，IP 页面在 3fe32c87 使用同一 session scope namespace；专项测试仅证明源码绑定与既有 coordinator 合同，真实双租户/主体及双视口 OIDC 验收仍未完成。INT-302～308 保持未勾选。
