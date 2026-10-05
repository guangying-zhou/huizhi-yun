# 统一企业 Host 组合与迁移合同

日期：2026-09-13。依据：[ADR-018](./ADR-018-Unified-Enterprise-Application-and-Data.md)。对应 INT-001、INT-002；总进度仅在[实施台账](./Unified-Enterprise-Implementation-Plan.md)维护。

本文冻结代码组织和路由合同，记录仓库配置事实；不宣称远程 Worker、会话、调度或 Runtime 绑定已经切换。盘点不读取密钥、业务数据或 legacy Account 目录。实施前工作区已有 ADR、实施计划、项目指导及索引修改，本文未覆盖这些改动。

## 1. 冻结的组合规则

| 项目 | 合同 |
| --- | --- |
| Host 目录、包名、技术 Tag | `enterprise/`、`@hzy/enterprise`、`enterprise/vX.Y.Z` |
| Host 技术 manifest | `enterprise/app.manifest.json`；由现有模块 manifest 生成资源目录，保留 `aims:*`、`assets:*` 等权限代码，不手写第二份资源白名单 |
| Nuxt baseURL | `/`，一个 app.vue、UApp、顶层 layout、认证入口及全局 middleware 注册；业务模块不是嵌套独立 Nuxt 应用 |
| 页面 | `/aims/**`、`/assets/**` 保持原地址；路由 name 分别以 `aims-`、`assets-` 开头；Host 首页单独占 `/` |
| BFF | `/aims/api/**`、`/assets/api/**`；共享 Foundation API 由 Host 唯一登记。禁止两个模块争用无前缀 `/api/v1/products` |
| 登录 | Host `/login` 与 Foundation 正式 OIDC 回调；旧 `/aims/login`、`/assets/login` 转入统一入口并保留经校验的站内 returnTo；不转发或复制旧浏览器 Token |
| 业务 Layer | 从现有应用提取组合入口，例如 `aims/layer/`、`assets/layer/`；初期源码保留原目录，独立启动入口继续构建。Host 不 extends 两个完整应用配置 |
| 资源 | 新宿主资源 `/enterprise-assets/**`；业务静态资源 `/aims/static/**`、`/assets/static/**`；旧已发布 chunk 在兼容窗口仍可请求 |
| 导入 | 业务代码使用显式模块别名 `@aims`、`@assets` 或相对导入；不让 `~`、`~~` 默认为原独立应用根。共享能力继续导入 `@hzy/foundation` |
| 配置 | Host 公共配置与 `modules.aims` / `modules.assets` 分离；禁止通过运行时改一个全局 appCode 改变当前业务身份 |
| 导航 | 已迁移页面同一 Vue Router 导航，Console Shell 仅为旧入口兼容；不把两个旧 iframe 包进新首页作为整合成品 |

目录、包名、URL、技术 Tag 在本文作为实施值固定。实际版本号与环境部署记录由发布时生成；不得把商业版本取消误作软件版本取消。

## 2. 当前部署与调用证据

| 范围 | 仓库事实 | 证据 |
| --- | --- | --- |
| Aims / Assets | 两个 SPA，分别 extends Foundation，默认 baseURL `/aims/`、`/assets/`，独立 public.appCode 与 runtimeConfig | `aims/nuxt.config.ts`、`assets/nuxt.config.ts` |
| 测试环境 | `https://hzy-test.huizhi.yun`，tenant `C000001`、environment `test`；Worker 配置名 `hzy-test-aims`、`hzy-test-assets`、`hzy-test-console`；业务部署代码 `C000001-test-aims/assets`，Console `wiztek-test-console` | `deploy/test-env/cloudflare-config.mjs` |
| 测试入口 | Worker 自身 workers_dev=false，无 routes/triggers；Gateway 只接测试域。Altoc/Codocs/People/Workflow 等入口当前显式返回未启用 503，不能因有构建配置就标记功能可用 | `deploy/test-env/cloudflare-config.mjs`、`cloudflare-gateway.mjs` |
| Gateway | 按 app prefix 定位 Worker；通过目标 Service Binding，携带目标 app/deployment/prefix 与受信租户上下文 | `deploy/cloudflare/tenant-gateway/src/index.js` |
| 托管构建默认 | Aims、Assets renderer 默认 Console Binding 指向 `hzy-console-prod`；Aims 另有 Assets、Altoc、People、Finance、Codocs bindings。测试 renderer 覆盖为测试绑定，不能混用默认生产值 | `aims/scripts/render-cloudflare-config.mjs`、`assets/scripts/render-cloudflare-config.mjs` |
| 服务运行身份 | 测试配置显式设 `aims.runtime`、`assets.runtime`；业务 BFF 经 Foundation service token 和 tenant runtime helper 调用客户侧 Runtime；不是 Nuxt 直连库 | `deploy/test-env/cloudflare-config.mjs`、两模块 `server/middleware/tenant-runtime.ts` |
| 产品目录 | Aims BFF 请求 `aud=assets`、`assets:product:read`，经 Assets service catalog，再进入其 Runtime | `aims/server/utils/productCatalog.ts` |
| 产品采用 | Assets 验证服务 envelope 与产品采用权限后，调用 `/v1/assets/internal/product-adoption:read`，仍有跨服务边界 | `assets/server/utils/productAdoptionService.ts` |
| OIDC / 会话 | Foundation 客户端 useAuth 选择 Console OIDC；服务端 clientId/cookie scope 默认由 public.appCode 派生。仅合并页面不等于统一会话 | `foundation/app/composables/useAuth.ts`、`foundation/server/utils/consoleOidc.ts` |

以上是源码和配置证据，不是远程部署的实时证明。上线前必须补实际 Worker version、Gateway 路由版本、Runtime deployment binding、OIDC redirect allowlist 与运行开关；不得将本表作为 INT-006 性能基线或线上可用性证据。

## 3. 实测文件冲突与解决责任

以两模块对应目录内文件相对路径求交集。数量反映扫描时源文件，不涵盖导出符号同名、Nuxt 自动组件名称规范化、动态路由 name 等额外冲突；构建期还必须对最终注册结果做唯一性断言。

| 类型 | Aims / Assets 文件数；同路径数 | 具体冲突或风险 | 责任与处理 |
| --- | --- | --- | --- |
| 页面 | 115 / 34；7 | `index.vue`、`products/index.vue`、`login.vue`、`admin/index.vue`、`reports.vue`、`integration-operations.vue`、`settings/profile.vue` | Nuxt 负责人：显式加页面及 name 前缀；登录归 Host |
| layout | 2 / 1；1 | `default.vue` | Nuxt 负责人：Host 默认布局，业务局部布局显式命名；移除业务 app.vue 重复 UApp/head |
| app middleware | 3 / 2；2 | `auth.global.ts`、`permission.global.ts` | 认证 + Nuxt：共享会话一次初始化，业务授权按路由逻辑模块执行，禁止优先级覆盖 |
| components / composables | 121 / 40、12 / 5；同路径均 0 | 无同路径不证明自动导入无冲突；仍依赖模块根别名和全局配置 | Nuxt：生成实际组件/composable 注册清单，对规范化名称判重；显式导入或前缀 |
| API | 305 / 93；18 | `auth/permissions`、`v1/products/index` GET/POST、`v1/integration-operations/**`、实例冲突解释、notification authorize、旧 account facade | BFF 负责人：业务 handler 显式前缀注册；共享兼容 facade 由 Foundation 唯一注册，不改 legacy Account |
| server utils | 155 / 33；14 | `checkPermission`、`authIdentity`、`serviceAuth`、`db`、`scheduledRuntime`、due notification helpers 等 | BFF：模块目录显式引用，不全局 autoimport 同名工具；db 防误用桩不能成为 Host 数据路径 |
| server middleware | 4 / 3；1 | `tenant-runtime.ts` 都识别 `/api/v1` 后缀，直接合并可能双重鉴权或错误代理 | BFF + 认证：先可信确定逻辑模块，再调用明确的模块适配函数；不能模拟 H3Event 调旧 handler |
| Nitro plugin | 1 / 1；1 | `sync-approval-actions.ts` 启动时延迟同步 Workflow，两者默认存在副作用 | Host：唯一注册的审批动作发布任务，manifest 驱动；不能因为导入 Layer 执行两次启动同步 |
| Nitro task | 3 / 2；1 | `notifications/due.ts`，两模块独立消费通知状态 | Host + Runtime：任务命名 `aims:notifications:due` / `assets:notifications:due`，消费权由租户路径登记控制 |
| public | 6 / 2；1 | `favicon.ico`，另有 app.vue 根绝对 logo 引用 | Nuxt：Host head 统一，资源显式前缀，旧 chunk 保留兼容 |
| CSS / aliases | 两个 `~/assets/css/main.css`；两个 safer-buffer/ali-oss alias | `~` 指向 Host 后解析错误；重复全局主题及 reset | Nuxt：只加载一套基础 CSS，模块样式作用域化，shims 显式共享或模块命名 |

缓存具体整改入口：Aims `useProductWorkspace.ts` 使用 `product-workspace:${code}` / permission key；Assets `useAssetDictionaries.ts` 使用固定 `assets-dictionaries` key。Host 必须引入经过验证的 tenant + subject + 权限版本 + module 作用域，登出/主体变更失效；同产品 code 不能在切租户后复用先前对象。目录公共定义与实际租户字典分别处理，不以清空所有缓存代替正确 key。

## 4. 调度登记与单消费者

当前 Aims：每 5 分钟 `integration-operations:drain`，每 15 分钟 `notifications:due`，每日 `15 2 * * *` `milestones:rollover`。Assets：每 15 分钟 `notifications:due` 和 `integration-operations:delivery-asset-status`。定义来自各自 nuxt.config 与 server/tasks；实际功能开关另由环境决定。

Host 初始所有迁移消费关闭。每个 `(tenant, environment, logicalModule, task)` 只能有一个登记的执行所有者，必须有 fence/generation 防止正在运行的旧 Worker 与 Host 同时领取。切换时先停旧任务入口、排空或转移租约与在途 operation，再启用新所有者；稳定 operation ID、receipt 和 checkpoint 不因迁移改名而重置。回退反向转移消费权，不能两边同时启动。测试环境配置禁止业务 cron；需专门调度演练，不能靠页面测试证明单消费者。

## 5. 身份、旧 URL 与兼容矩阵

Host 固定物理身份 `enterprise`；请求上下文另存 logicalSource / logicalTarget。目标服务身份的启用依赖 INT-107：注册正式 client、精确能力 grant、Host deployment 到目标 Runtime adapter 的绑定，保留 JWT audience/source/tenant/deployment、签名 actor、撤销及业务对象授权。没有登记的新身份应失败关闭。

INT-301 空 Host 可先使用现有 Foundation 能力开发；真实业务联调前由认证负责人落实专用客户端与绑定。迁移期间旧独立 app 继续使用其精确身份；不得把 Host 默认身份改成 aims，或在一个请求里全局切换 appCode 来借用另一个应用权限。

| UI/BFF | Runtime / 数据模式 | 允许条件 |
| --- | --- | --- |
| 旧独立 Aims/Assets | 旧路径 | 原正式合同保持，作为未迁移租户路径 |
| 旧独立 Aims/Assets | 新权威库 | P1/P2 兼容适配已验证；作为新增写入后回退 UI 的主方式 |
| enterprise Host | 旧路径 | 仅明确登记的过渡读取/兼容路径；不是整合完成状态 |
| enterprise Host | 新内部查询/领域服务 | 精确身份、业务授权、schema 与路径登记相容且已验证，才可作为迁移完成路径 |
| 新旧 BFF 任一 | 过时旧库恢复写入 | 新库已有写入后禁止直接切回；须暂停写入、反向迁移并对账 |

浏览器旧 URL 保留 pathname、业务键、query 和 hash；刷新、复制深链、前进后退及 Console 应用目录跳转要落入 Host 对应模块。站外 URL 与伪造 returnTo 拒绝。旧 API 保持 method、body、状态码及幂等 key；写 API 不用 301/302 跳转迁移，也不通过复制写请求做影子验证。跨独立服务的上下文改写继续用 Foundation 受信 helper，不能只改 x-hzy-app-code。

Release manifest 至少绑定 Host tag/源码、Aims/Assets 源码版本、Runtime 版本、schema 版本、权限目录 hash、路由模式版本、task ownership generation。兼容范围由实际测试填写，不用“向后兼容所有旧版本”占位承诺。

路径与任务所有权 generation 在新 release 输出中使用规范正 uint64 十进制字符串，避免 JSON/JavaScript number 丢失精度。输入兼容安全整数范围内的旧数字；不安全数字、溢出、前导零等非法值拒绝。部署预检按相同规范比较 release 与运行配置，不能直接以数字转换比较大代际。

## 6. 保留的独立边界

Platform 控制面/数据库保持独立；Console 的身份、Directory、Vault、策略协议与客户侧 Auth/Session 密钥边界保持。Codocs 编辑器、Workflow、Collab、notification-runtime、connector-runtime 首轮继续独立，不随 Host 复制会话或密钥表。Altoc、Finance、People 等按后续链路迁移；未迁移 API 仍走正式 Service API 与精确 grant。Nuxt 不获得数据库凭据，内部 Runtime 查询与领域事务才承担跨域数据整合。

## 7. 可立即执行的 P3 切入点与验收证据

1. INT-301：增加 enterprise workspace、唯一 app/layout/login、仅 Foundation extends、配置及 Cloudflare 模板。用两个空业务占位路由验证前缀和一套会话加载；不挂载全部旧配置。
2. INT-302：先提取产品列表、产品空间、需求/版本、Assets 产品台账涉及的页面与模块组件。构建前生成最终页面/API/组件/composable/plugin/task 清单并拒绝重复。逐文件替换根别名和模块绝对 API URL；保留两应用独立构建。
3. INT-303：会话单例及带主体/租户维度的缓存，旧 URL 兼容适配。用两个租户、两个不同权限主体覆盖切换、登出、刷新及深链，不依赖管理员测试替代。
4. INT-304/305：在 P1/P2 服务和身份合同就绪后挂真实 BFF，按请求上下文调用模块服务；建立任务消费登记。新内部产品链不得继续 Aims→Assets Worker→Runtime 作为最终路径。
5. INT-306～308：真实数据完成 1440/390 主流程与权限状态，记录 Worker 上传和客户端首载分别的测量值、真实 Runtime SQL 与导航指标；写入后回退演练及 release manifest 与实物对应。

本盘点未完成远程当前状态核验、INT-006 性能采样、构建后的自动导入符号清单、Host OIDC 注册、Runtime 身份绑定或调度切换。因此可作为 INT-001 的源码证据与 INT-002 组合合同，不能单独据此勾选整个 P0/P3。

## 8. 技术 manifest 生成实现（2026-09-13）

`enterprise/scripts/generate-manifest.mjs` 已从 Aims/Assets 权限事实源生成 `enterprise/app.manifest.json`，保留原模块 manifest 并产生合并逻辑资源目录 hash。Platform 当前 `server/utils/appManifestResources.ts` 的同步函数统一绑定注册 appCode，而 `appManifestPermission.ts` 明确拒绝跨 app 角色权限。因此 enterprise 顶层资源/推荐角色为空，业务权限只在 composition 中按原模块保留；组合注册支持尚需认证/Platform 工作包实现，不能误用现有单应用导入把 aims/assets 资源改成 enterprise。

`generate-release-manifest.mjs` 从已提交 Git HEAD/模块 tree 与真实构件文件生成 release artifact；Runtime、schema、路径登记 hash 从实际文件计算，Host tag、版本、路径/调度 generation 为必填正式输入。源码未提交、生成目录陈旧、输入缺失或 hash 不符均拒绝。当前不以假版本生成“示例正式发布记录”，也不执行发布。

源码记录覆盖 enterprise、aims、assets、codocs、altoc、foundation（含其 packages）、console、deploy/cloudflare/tenant-gateway、platform/packages 和 data-runtime；同时记录根 package.json、pnpm-lock.yaml、pnpm-workspace.yaml 及 Gateway 外部导入的 deploy/test-env/enterprise-host-routes.mjs、enterprise-topology.mjs 的 Git blob。2026-09-20 将 Console/Gateway 输入补齐：旧 Shell 普通点击迁移依赖它们，不能只固定 Host。生成器检查这些实际依赖路径的未提交改动；测试环境 release-artifact-descriptor 复用同一输入目录并校验全部 tree/blob，旧描述符缺字段将拒绝，须在新提交的干净工作区重新生成。该源码记录不能单独证明二进制由对应源码构建，也不证明环境已安装 grants；正式构建及验收需分别保留固定提交、构件 hash、目标版本回读和真实岗位证据。
