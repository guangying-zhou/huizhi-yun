# ADR-018 部署与路由基线清单

基线日期：2026-09-15。范围：`C000001 / test` 的统一企业应用试点，以及仍需保留的独立边界。对应 INT-001。

本清单只使用当前源码、已提交配置和仓库内脱敏回执。它不读取密钥，也不把构建配置、候选制品或历史部署记录当作当前线上事实。各项的“实测时间”可能不同；因此本文是同一代码基线下的证据快照，尚不是一次同时读取所有运行组件所得的原子环境快照。

## 1. Worker、Host 与入口

| 组件 | 代码/配置声明 | `C000001 / test` 运行证据 | 状态与边界 |
| --- | --- | --- | --- |
| Tenant Gateway | `hzy-test-gateway`；唯一公网入口 `hzy-test.huizhi.yun/*`；按前缀通过 Service Binding 转发 | 2026-09-14 16:15Z 回读版本 `6c281245-1f1d-4b15-a6e8-ccc2c4f6fe29`、100% 流量；绑定 Console、Enterprise、Aims、Assets、Finance 及 drain coordinator | 已证明当时部署；2026-09-15 以后版本需重新回读 |
| Enterprise Host | 物理 app `enterprise`，Worker `hzy-test-enterprise`，deployment `C000001-test-enterprise`，Nuxt base path `/` | 2026-09-14 16:15Z 回读版本 `579ef868-1738-4cfe-94c5-49caa7e26a35`、100% 流量，绑定 `hzy-test-console` | 已证明当时部署；最新源码已继续增加页面，不能据此声称当前 HEAD 已发布 |
| Aims 独立 Worker | app `aims`，deployment `C000001-test-aims`，Nuxt base path `/aims/` | 2026-09-14 05:04Z 回读版本 `b4b4763b-57ac-4ad8-b4a8-67e042c31ad0`、100% 流量；`/aims/products` 为 200 | 兼容入口保留；未迁移页面仍由它承载 |
| Assets 独立 Worker | app `assets`，deployment `C000001-test-assets`，Nuxt base path `/assets/` | 2026-09-14 05:04Z 回读版本 `7f090cc0-b98f-4cec-ab2f-2612591c46ce`、100% 流量；`/assets/products` 为 200 | 兼容入口保留；未迁移页面仍由它承载 |
| Console Worker | 独立身份、目录、会话、策略和凭据运行时；测试 deployment `wiztek-test-console` | Gateway/Host 回读均显示 `HZY_CONSOLE_SERVICE -> hzy-test-console`；本清单未取得同一时点 Console 自身版本回读 | 必须独立保留；当前版本待环境核验 |
| Platform Worker | 控制面、签名与租户/部署注册表；不并入 Enterprise Host | Gateway 配置指向 `https://hzy.wiztek.cn` 的内部 registry；现有回执仅证明相关签名快照曾通过 | 必须独立保留；当前 Worker 版本、环境和路由待环境核验 |
| Data Runtime Agent | 客户数据面，deployment `c000001-test-tenant-runtime`，JWT audience `data-runtime` | 2026-09-14 16:47Z 为 `0.3.219-test.adr018-candidate.7`，健康检查 200；Aims/Assets 为 `schema_ready`，Enterprise binding 为 `active` | 必须独立保留；当前版本待重新探测 |

来源：[统一 Worker 回读](../deploy/test-env/artifacts/C000001.unified-workers-readback.json)、[独立 Worker 与绑定回读](../deploy/test-env/artifacts/C000001.deployed-worker-versions-and-direct-bindings-evidence.json)、[Runtime candidate 7 回执](../deploy/test-env/artifacts/C000001.runtime-candidate7-deployment.json)、`deploy/test-env/.cloudflare-workers/gateway/wrangler.json` 与 `enterprise/nuxt.config.ts`。

候选构建不算部署证据。特别是 `C000001.enterprise-host-full-candidate-20260914.json` 明确记录 `candidateOnly:true`、`deployed:false`，因此不用于填充线上版本。

## 2. 路由和真实调用路径

| 浏览器入口 | Gateway 决策 | Host/BFF 身份边界 | 数据路径 | 当前证明范围 |
| --- | --- | --- | --- | --- |
| `/enterprise/**` | 试点认证、页面和静态资源转发至 Enterprise | Enterprise OIDC client `enterprise`；物理服务主体 `enterprise.runtime` | Enterprise BFF → Foundation runtime client → Console 签发短期 service JWT → Data Runtime → 统一库 | 登录回调和页面渲染已有回执；当前 HEAD 的完整页面集未做同一版本线上验收 |
| 已登记的 `/aims/**` | Enterprise pilot 开启时，由 registry 将已迁移路径交给 Host；否则进入 Aims Binding | Host 保持物理身份 `enterprise`，逻辑模块为 `aims`，不借用 Aims 浏览器 Token | `/aims/api/**` → Enterprise Aims BFF → 精确 operation/capability → Data Runtime Aims adapter → 统一库 | 产品链及项目列表/详情已在源码登记；部署版本覆盖范围待环境核验 |
| 未迁移的 `/aims/**` | 转发 `HZY_AIMS_SERVICE -> hzy-test-aims` | 独立 Aims 身份 `aims.runtime` | Aims BFF → Console service token/runtime helper → Data Runtime；现有正式跨应用调用仍走目标 Service API | 独立产品入口 200 已实测；其余页面逐项待验收 |
| 已登记的 `/assets/**` | Enterprise pilot 开启时，由 registry 将已迁移路径交给 Host；否则进入 Assets Binding | Host 保持物理身份 `enterprise`，逻辑模块为 `assets` | `/assets/api/**` → Enterprise Assets BFF → 精确 operation/capability → Data Runtime Assets adapter → 统一库 | 产品、分类、字典、实物/资源只读路径已在源码登记；部署版本覆盖范围待环境核验 |
| 未迁移的 `/assets/**` | 转发 `HZY_ASSETS_SERVICE -> hzy-test-assets` | 独立 Assets 身份 `assets.runtime` | Assets BFF → Console service token/runtime helper → Data Runtime | 独立产品入口 200 已实测；其余页面逐项待验收 |
| `/`、`/console/**` 及未匹配路径 | Gateway 默认转发 Console | Console 会话和目录边界 | Console Worker → 自身 Runtime/Platform 合同 | Console Binding 已回读，Console Worker 本身版本待核验 |
| `/altoc`、`/codocs`、`/people`、`/workflow`、`/webdev`、`/collab`、`/directory-connector` | 测试包装器显式返回 503 | 无 | 无业务转发 | 当前测试环境明确未启用，不能因仓库存在模块而写成已接入 |

Gateway 在受信边界注入 tenant、environment、目标 app/deployment、runtime endpoint/audience；跨 Worker 调用通过 Service Binding。业务 Worker 不持有统一库凭据，也不直接把上游 Token 转发给 Runtime。该路径由 `deploy/cloudflare/tenant-gateway/src/index.js`、`deploy/test-env/cloudflare-gateway.mjs`、`foundation/server/utils/enterpriseRuntimeClient.ts` 与 Enterprise BFF 源码共同声明。

## 3. 服务身份与会话初始化

| 边界 | 身份/初始化方式 | 已有证据 | 待核验 |
| --- | --- | --- | --- |
| 浏览器 → Enterprise | `/enterprise/login` 使用 Console OIDC；回调 `/enterprise/api/auth/oidc-callback`；旧 `/aims/login`、`/assets/login` 进入统一入口 | 2026-09-14 可见浏览器验收记录跨 Aims/Assets 导航无需二次登录 | 当前部署的 redirect allowlist、client 状态与 Host 版本 |
| Enterprise 客户端会话 | `enterprise-session.client.ts` 创建单一 session cache coordinator；Foundation `useAuth()` 为唯一认证状态源 | 源码与会话修复回执 | 两租户/两主体切换、登出和过期回归尚不属于本清单证据 |
| Enterprise → Console/Runtime | client/subject `enterprise.runtime`；向 Console 换取短期、精确 scope 的 service JWT；Runtime 另要求签名 actor | 既有注册/grant/OIDC 回执及 Runtime active binding | 当前全部 operation 的 live token 签发组合由 INT-107/108 跟踪 |
| 独立 Aims/Assets → Runtime | 分别为 `aims.runtime`、`assets.runtime`；deployment 精确绑定 | 2026-09-14 Worker binding 回读、drain actor digest 匹配 | 当前 credential 撤销状态和最新部署版本 |
| Gateway → 下游 Worker | Gateway 内部信任头和 Service Binding；页面请求会剥离浏览器 Cookie/Authorization，再由目标应用建立自己的会话 | 页面会话修复回执记录登录回调通过，之后跨模块读取无需二次登录 | 当前线上版本重新回读 |

来源：[页面会话修复回执](../deploy/test-env/artifacts/C000001.gateway-page-session-fix.json)、[整合分支授权验收](../deploy/test-env/artifacts/C000001.integration-branch-auth-verification-20260914.json)及 [Host 合同](./Unified-Enterprise-Host-Contract.md)。这些文件证明指定时间的结果，不证明长期有效凭据当前仍活跃。

## 4. Cron、任务与 outbox 消费者

| 调度/消费者 | 源码所有者 | 测试环境登记/实测 | 当前结论 |
| --- | --- | --- | --- |
| Policy Bundle 同步 | Gateway scheduled handler → Console 内部同步端点 | Cloudflare schedule API 于 2026-09-15 00:43Z 从 `*/2 * * * *` 改为 `0 16 * * *`（北京时间每日 00:00）；下次零点执行尚未观察 | schedule 已回读，首次新计划执行待观察；也可通过受保护的手工端点触发 |
| Aims `integration-operations:drain` | 独立 Aims 配置原声明每 5 分钟 | 2026-09-15 回读：全环境仅 Gateway 有 cron `0 16 * * *`，且该值等于包装器的 `TEST_POLICY_SYNC_CRON`，只执行 policy sync；drain coordinator 无 cron | **无定时触发器执行 drain**，只在请求驱动路径（`HZY_DRAIN_COORDINATOR` Binding、受保护 `/__test/drain/*`）执行；恢复定时 drain 需注册第二条 cron，归 INT-305 |
| Aims `notifications:due` | 独立 Aims 原声明每 15 分钟 | Host `HZY_BACKGROUND_JOBS_ENABLED=false`；未取得当前 Cloudflare trigger/消费者执行回读 | 未证明已启用；不得宣称 Host 或旧 Worker 正在消费 |
| Aims `milestones:rollover` | 独立 Aims 原声明每日 `15 2 * * *` | 同上 | 未证明已启用 |
| Assets `notifications:due` | 独立 Assets 原声明每 15 分钟 | Host 后台任务关闭；Runtime registry 中 Assets scheduler=`disabled` | 当前统一调度禁用；旧 Worker 是否仍有 trigger 待环境核验 |
| Assets `integration-operations:delivery-asset-status` | 独立 Assets 原声明每 15 分钟 | Runtime registry 中 Assets scheduler=`disabled` | 当前统一调度禁用；旧 Worker 是否仍有 trigger 待环境核验 |
| receipt/outbox 持久消费者 | Aims/Assets `integration_operation*`、`service_command_receipt` 等表由登记 owner 消费 | 统一库 generation 1 与 owner deployment `C000001-test-enterprise` 已记录；drain 控制回执记录 unresolved activities=0 | 表归属已证明；实际定时唤醒链因上述 wrapper 差异仍未闭合 |

来源：[每日调度回执](../deploy/test-env/artifacts/C000001.policy-daily-schedule.json)、[统一 Gateway 回执](../deploy/test-env/artifacts/C000001.unified-gateway-release.json)、`aims/nuxt.config.ts`、`assets/nuxt.config.ts`、`deploy/test-env/cloudflare-gateway.mjs` 和 `deploy/cloudflare/tenant-gateway/src/index.js`。生成的 `deploy/test-env/.cloudflare-workers/gateway/wrangler.json` 仍写有旧 `*/2` 配置，不能覆盖 API 回读的当前 schedule，但说明生成物已漂移，下一次发布前必须重渲染。

## 5. 保留的独立服务与环境

以下边界按 ADR-018 保持独立，不随 Aims/Assets 第一阶段组合进入 Host：

- Platform 控制面及其数据库。
- Console 的身份、Directory、Vault、策略协议、会话密钥和内嵌 Collab 边界。
- Data Runtime Agent 与租户业务数据库；Nuxt Host 不获得数据库凭据。
- Workflow、Codocs 编辑器、独立扩容时的 Collab、notification-runtime、connector-runtime。
- Altoc、Finance、People、Align、Insights 等尚未纳入本试点组合的业务服务。
- Aims、Assets 独立 Worker 在其未迁移页面、兼容 URL 和回退窗口结束前继续保留。

本清单只核对共享测试租户 `C000001 / test`。生产、其他租户、本地开发和 self-hosted 环境没有同一时点运行回读，均标记为**待环境核验**；不得从测试配置推断生产状态。

## 6. INT-001 验收判断

清单已经覆盖任务要求的 Worker/Host、Nuxt base path、服务身份、真实调用路径、cron、outbox 消费者、会话初始化、独立服务和环境，并对源码声明、候选制品及运行回读作了区分。

2026-09-15T14:12:51Z–14:13:01Z 的同一观测窗口回读已补齐三项缺口，证据见[观测窗口回执](../deploy/test-env/artifacts/C000001.int-001-observation-window.json)：

1. **版本、流量与 Binding**：Gateway `0866464e`、Enterprise `bcf7157b`、Console `29be09c1`、Aims `b4b4763b`、Assets `7f090cc0` 均为 100% 流量的活动版本；Data Runtime 为 `0.3.219-test.adr018-candidate.7`，本地与公网 health 一致，六个已启用 adapter 的 `db=ok`。Service Binding 只记录名称与目标：Gateway 指向 aims/assets/console/finance/enterprise 及 `hzy-test-drain-coordinator`；Aims、Assets 各自指向对方、Console、Finance 与 drain coordinator；Enterprise 仅指向 Console；Console 无 Service Binding。
2. **Trigger 与 integration drain 实际触发者**：全环境只有 `hzy-test-gateway` 注册了 cron `0 16 * * *`，Enterprise、Console、Aims、Assets 和 drain coordinator 均无 cron。测试包装器 `deploy/test-env/cloudflare-gateway.mjs` 按 cron 值分派：等于 `TEST_POLICY_SYNC_CRON` 时执行 policy sync，否则执行 `runIntegrationDrains`；而该常量的值正是唯一注册的 `0 16 * * *`。**结论：当前没有任何定时触发器会执行 integration drain**，drain 只能由请求驱动——业务 Worker 经 `HZY_DRAIN_COORDINATOR` Service Binding 调用，或经 Gateway 受保护的 `/__test/drain/*` 控制端点。包装器中的 drain 分派在当前单一 cron 下不可达；要恢复定时 drain 必须注册第二条不同的 cron，归入 INT-305。
3. **Enterprise 身份绑定**：OIDC client `enterprise` 为 active、public、`source=bundle`，home/logout URL 指向 `https://hzy-test.huizhi.yun`；服务客户端 `enterprise.runtime`（runtime 类型、app_code=enterprise）为 active，38 条 grant 全部 active，覆盖 `aims:product-components/features/priorities/requests/versions` 等精确资源动作；Runtime deploymentBindings 中 enterprise 绑定 `C000001-test-enterprise`。注意 `auth_client_redirect_uris` 在该库中 11 个 client 全部为 0 行，redirect URI 由策略包承载，这不是 Enterprise 独有缺口。

三项缺口已闭合，INT-001 勾选。本回读仍只覆盖共享测试租户 `C000001 / test`；生产与其他租户没有同一时点运行回读，仍标记为**待环境核验**，不得据此推断生产状态。
