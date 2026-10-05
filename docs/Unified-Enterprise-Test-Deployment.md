# ADR-018 统一 Host 测试发布准备

本文件对应 INT-502 的测试准备包。2026-09-13 已完成实际 Enterprise OIDC/服务身份登记、Vault 加密凭据及 36 项 capability 分批正式签发/验签。测试 Host/Gateway 已发布登录路径，真实 SSO 与 Enterprise 会话查询通过；Runtime 已更新 candidate.2，enterprise.enabled=false。统一业务库、业务/调度路由和最新 Assets 写入制品尚未启用。以下执行记录保留当时状态，以后续记录及 [实际迁移准备](./C000001-Enterprise-Migration-Preparation.md) 的最新观测为准。

## 现有配置差距

| 位置 | 当前事实 | 统一 Host 要求 |
| --- | --- | --- |
| `deploy/test-env/cloudflare-config.mjs` | Enterprise 使用专用拓扑；生成器已改 runtime，远端 Console 仍待应用和验证 | 使用单独 enterprise 拓扑；Console 必须 Runtime 持久缓存，不允许 memory/file 降级 |
| `deploy/test-env/worker-config.mjs` | 本地 Console 使用 Runtime 缓存，但只定义 Console/People | 补齐显式 Host worker、服务绑定、OIDC 和 Runtime 参数后才能渲染发布配置 |
| `enterprise/scripts/render-cloudflare-config.mjs` | 仅 Host 身份、静态资源及可选 Console binding；运行即写生成文件 | 不是完整测试发布器，不应直接照此发布或推断生产绑定 |
| `enterprise/.env.example`、`nuxt.config.ts` | OIDC client 为 enterprise；模块默认禁用；无统一 schema 自动配置 | 模块开启须有真实 Runtime/schema/权限和技术部署证据；保持旧 `/aims/`、`/assets/` |
| `deploy/test-env/provision-product-clients.mjs` | 旧 `${app}.runtime` 的逐应用 read/write grants | 不可借用 aims/assets client，也不能把旧 grant 总数当 Host 精确能力证明 |
| Console manifest / SQL seeds | `enterprise-registration.mjs` 已登记并核验当前 36 项精确能力 | 新增 operation 时复核目录及实际签发；保留已有停用/撤销，不自动恢复 |
| Runtime `config/enterprise.go` | 统一连接仅来自受信本地配置 | tenant + environment + Runtime deployment + MySQL instance UUID + schema + generation + domain owner/table mapping 全部匹配 |

不修改现有 legacy 测试部署行为。`enterprise-readiness.template.json` 是**准备清单模板，不是可直接提交 Wrangler 或 Runtime 的配置**。所有目标身份及制品路径初值为空，任务调度关闭，没有 secret 值，也没有伪造 credential/grant。后续渲染正式配置应从核实后的清单生成，不应读取生产 `.env` 作默认值。

## 本地预检

```sh
node deploy/test-env/enterprise-preflight.mjs --template-only
node --test deploy/test-env/enterprise-preflight.test.mjs
# 明确指定准备清单；退出 1 表示尚不能由本地检查宣告环境就绪
node deploy/test-env/enterprise-preflight.mjs /absolute/path/reviewed-test-input.json
```

脚本只读文件，不联网，不读取环境凭据，不调用部署器、不执行 SQL。输出仅固定原因码及公开能力目录。`--template-only` 只在结构与仓库一致时退出 0；默认始终保持 `deploymentReady:false`，因为静态文件不能验证活跃服务凭据、真实授权和实例绑定。`requiredExternalReview` 表示仍需环境证据核对，并非新增人工审批流程。证据栏填写报告引用，不填写 token、口令、私钥或 credential 内容。

预检比较 Foundation 真实 `enterpriseRuntimeClient.ts` 的去重精确 capability，检测代码增加操作后模板漏项；比较真实 release builder 合同及 Runtime/schema/path registry 文件 SHA256，Host manifest 使用发布器相同 canonical digest。禁止未知 owner、带认证信息的 origin、通配 capability、旧应用身份和 memory cache。制品缺失保留未就绪，不能以 fixture hash 或 `latest` 代替。

## Runtime 和服务身份核对

- 物理 app / client / subject 分别为 `enterprise` / `enterprise.runtime` / `enterprise.runtime`；OIDC client 为 enterprise，redirect URI 精确登记。Host deployment 必须与 tenant/environment、签名 service claim、Runtime `deploymentBindings.enterprise` 一致。
- Runtime 使用 JWT；发行方/JWKS/实际 audience 按测试环境核实，不能用 static auth 绕过。Host 路由还要求 signed user actor、当前 credential 活跃以及每次调用的精确 grant。服务能力不替代人员 action、角色和对象/字段 scope。
- `servicePolicy.capabilities` 是当前代码能力集合；grant 的 resource 是 capability 最后一个冒号前部分、action 是最后一段。当前 Enterprise 仅使用登记的 `data-runtime` audience，逐项验证**每个实际请求 scope**的签发/验签；未登记的 `tenant-runtime` 应拒绝。同时覆盖拒绝未知 capability、错 tenant/deployment、停用 credential 的负例。不能只检查行数或增加宽泛 `read/write`。
- Console 自身持久策略存储另外需要 `console.runtime` 的 `console:policy-bundle:read` 和 `:write`，两个 audience 各验证 read、write、read+write 组合；该客户端身份不能授给 Host。`Console-SQL-Seed-policy-bundle-grants.sql` 保留已撤销状态。
- Runtime 本地 `enterprise` 配置包含 `enabled/environment/schemaVersion/generation/instanceId/db/domains`。DB 连接参数通过现有安全部署路径填写；本模板仅记录无 secret 的绑定。每个 domain 提供 ownerDeployment、完整 logical→physical table map，以及独立 read/write/scheduler 模式。instanceId 由 MySQL 实际 server UUID 复核；同实例/数据库不能绑定两个租户。
- 当前模板 read/write/scheduler 均 disabled。实际迁移验收后按域设置，不能因开启读路径顺带开启写路径或调度；task ownership generation 必须与 release 一致。缺统一 schema/path registry 实物时不激活功能。

## 数据和发布顺序

Assets 主档写入前须应用独立源迁移 `assets/docs/migrations/20260913_assets_owned_product_receipts.sql`，验证 CHECK 已强制执行并重新生成源计划/hash；此项与 Platform 迁移分开。预检输出 `sourceMigrationOrder` 并要求 `assetsOwnedReceiptSchema` 环境证据引用，引用本身不能证明实际已迁移。具体次序和回滚限制见实际迁移准备文档。

以下是完整测试业务发布顺序；身份登记与登录发布已执行，数据库迁移与业务切换尚未执行。保留历史订单、订阅、License、人员角色授权及原到期时间。

1. 核对测试 tenant/Console/Platform/Runtime 数据库与 MySQL instance UUID，记录备份及恢复点。确定 schema manifest、表映射、路径读写 owner 与 task ownership generation；不得把隔离测试最小 fixture 当部署 schema。
2. 在目标 **Platform** 库按顺序应用独立迁移：
   - `platform/docs/sql/migrations/20260913-enterprise-entitlements.sql`
   - `platform/docs/sql/migrations/20260913-enterprise-entitlement-state.sql`
   - `platform/docs/sql/migrations/20260913-enterprise-order-fulfillments.sql`
   - `platform/docs/sql/migrations/20260913-enterprise-order-approvals.sql`
   四者完成后才启用统一报价/确认 UI 与 API。调度/恢复另需同目录 `20260913-tenant-scheduler-ownership.sql` 与 `20260913-enterprise-recovery-route.sql`。此处不运行存量转换，也不创建商业订单。
3. 在目标 **Console** 库核实 `console/docs/sql/Console-SQL-Migration-policy-bundle-snapshots.sql` 与对应 policy grant seed；验证真实 Runtime HTTP ETag/CAS、封存签名、重启后水位不回退。未满足时企业模式失败关闭。
4. 部署匹配统一 schema 的 Runtime 制品并核对启动 registry。技术制品必须有真实版本和 hash；旧 adapter 保留，不能把只读视图作为所有写操作兼容的证据。校验最小 SQL 权限及跨租户拒绝。
5. 由干净源树生成 `enterprise/app.manifest.json` 和 release manifest；Host tag 使用 `enterprise/vX.Y.Z`，绑定实际 enterprise/aims/assets commit+tree、Runtime artifact hash、schema manifest hash、path registry hash/generation 及 task generation。当前工作区未提交不能宣称正式 release 制品已生成。
6. Platform 登记 Host composition 与 aims/assets 原逻辑资源/action/role 命名空间，事务完整成功后核对逻辑 latest snapshot。登记 enterprise 技术 plan/version/site，版本必须绑定正确 Host manifest。空 Host resources 不是全量权限目录。旧逻辑 release 不伪造替换。
7. 使用已存在且有效的企业资格进行技术开通；真实业务事件另按用户授权范围办理。Host deployment 的 reported manifest hash、活跃 License、测试 site origin 与 composition 必须吻合，Platform 才输出逻辑 moduleAvailability/homeUrl。暂停/撤销不得以付款或开通恢复。
8. 核实 Host 独立 OIDC/service client、精确 grants、Console Runtime cache 和 gateway/service bindings；再开启 `/aims/`、`/assets/` 对应业务入口。人员 allowedAppCodes/data scopes 保持原算法。
9. 实际测试验收：真实签名包→Console持久缓存→Host人员授权→Runtime HTTP→统一库；覆盖读取及新建/编辑/决策/来源/版本规划，暂停撤销、到期、错包/篡改、低 revision 重放、重启及刷新失败关闭。旧应用基线和临时 MySQL 测试通过不能替代这一步。

## 本包证据和剩余项

本地模板预检有效，4 个预检回归通过；默认检查明确未就绪。未进行 Cloudflare mutation、业务库迁移、切流或服务凭据签发。仍需实际环境绑定、完整 schema/path registry 与发布制品、精确服务授权证据，再生成可部署 Worker/Runtime 配置并完成测试环境验收。本文不勾选 INT-502 整体完成。

## C000001 实际绑定复核（2026-09-13）

专用清单：`deploy/test-env/C000001.enterprise-readiness.json`。本次读取受保护的本机 Runtime `config.json`，仅提取白名单身份字段；使用其现有连接在内存中执行 Console 库 SELECT，未输出口令或 credential 值。实测：

- tenant `C000001`，Runtime `c000001-test-tenant-runtime`，JWT audience `data-runtime`、issuer `https://hzy-test.huizhi.yun`；本地 `127.0.0.1:18084` health 正常，版本仍为 `0.3.219-test.product-line-label.1`。
- Console deployment `wiztek-test-console`；库 `hzy_console_test_local_20260910`，MySQL server UUID 已记入 observed。`console.runtime` active 且有 current credential 指针，`policy_bundle_snapshots` 表存在。此结果不证明实际签发及持久 CAS 通过。
- Runtime 没有 enterprise deployment binding，未开启 enterprise；Console 没有 enterprise.runtime。旧 aims/assets 库已存在，但不是已批准的统一数据库或统一 schema。
- `hzy-test-console` 来自当前仓库测试配置，未在本包额外调用 Cloudflare API 查询实时 Worker 配置；配置中的 memory 是观察值，所需 runtime 是 proposed 变更。
- 拟定 `hzy-test-enterprise` / `C000001-test-enterprise` 单独位于 proposed，不写入已登记字段。Host origin 尚未选定：现有根入口属于 Console shell，必须先解决统一 Host 根部署、旧业务前缀与 OIDC callback 的精确 gateway 路由，不能盲用 Console 的 callback。

现在可执行的准备/验证命令（全部不发布）：

```sh
node deploy/test-env/enterprise-preflight.mjs deploy/test-env/C000001.enterprise-readiness.json --template-only
node --test deploy/test-env/enterprise-preflight.test.mjs
curl -fsS --max-time 10 http://127.0.0.1:18084/runtime/health
node --experimental-strip-types platform/scripts/test-enterprise-entitlement-mysql.mjs
node data-runtime/scripts/test-enterprise-planning-mysql.mjs
```

后两项只使用各自专属临时 MySQL harness，不连接当前测试业务库。正式制品输入就绪后，使用现有命令 `node enterprise/scripts/generate-release-manifest.mjs <verified-build-input.json> <release-manifest.json>`；它要求干净源树和真实 artifact 文件。不要运行 `update_dr.sh`、国内旧 Runtime 更新脚本或 `prepare-cloudflare-gateway.mjs` 来“补全”配置：它们有更新/重建凭据副作用，且国内测试实例已停用。

下一实际工作应从清单 `factSourcesNeeded` 中取得 Platform 技术 site/deployment、Host gateway/OIDC 路由决策、统一 schema/table map 和发布实物；其后才能生成可部署配置。没有可执行的 enterprise 专用现成部署器时，不把 legacy `build-cloudflare-worker.mjs enterprise` 写成有效命令。

## 已实现的同域试点路由与配置（后续准备包）

无需新增 DNS。明确选用现有 `https://hzy-test.huizhi.yun`：

| 浏览器路径 | 物理目标 | 转发路径/身份 |
| --- | --- | --- |
| `/`、`/oauth/*`、`/api/auth/*`、`/_nuxt/*` | 既有 Console | 保持原行为 |
| `/aims/*`、`/assets/*` | enterprise | 业务路径原样，app=enterprise、Host deployment、根 forwarded prefix 同时设置 |
| `/enterprise/api/auth/*` | enterprise | 仅剥 `/enterprise` 到 Foundation `/api/auth/*` |
| `/enterprise/login` | enterprise | 统一登录页 alias；默认返回 `/aims/` |
| `/enterprise/_nuxt/*` | enterprise | 独立构建资源路径原样转发 |
| `/enterprise/` | enterprise 试点路由 | 绑定完整才 308 到 `/aims/` |

Gateway 仅在精确测试主机且 `HZY_ENTERPRISE_PILOT=true` 时启用；tenant、environment、enterprise deployment 与真实 Service Binding 缺失返回 503，未知 `/enterprise/*` 也不回落 Console。旧应用配置行为不变。Foundation 客户端仅 appCode=enterprise 且显式 authApiPrefix=/enterprise 时改 auth/permission 请求地址。Cookie 与 OIDC transient cookie 沿用既有 appCode=enterprise 的名称，路径为根以支持两个逻辑前缀；不会改 Console cookie 名称或域策略。

配置入口 `enterprise-pilot-config.mjs` 产出完整 Host Worker 配置，以及保留现有秘密的 Gateway/registry/Console **合并补丁**。不能把 registryPatch 当完整 registry 覆盖现有 login、SSO 和凭据。`build-enterprise-pilot.mjs` 禁用 dotenv、清理继承业务配置，只生成本地构建和专用 Wrangler 配置。

```sh
# 公开配置计划（没有 secrets，未登记）
node deploy/test-env/enterprise-pilot-config.mjs
# 默认仅计划；verify 仅 SELECT 当前本机 Console 测试库
node deploy/test-env/enterprise-registration.mjs
node deploy/test-env/enterprise-registration.mjs --verify
# 专属临时 MySQL：真实 Console DDL、重复安装、撤销不恢复和事务回滚
node deploy/test-env/test-enterprise-registration-mysql.mjs
# 本地制品和上传前校验，不发布
node deploy/test-env/build-enterprise-pilot.mjs
pnpm --dir enterprise exec wrangler deploy --dry-run --config ../deploy/test-env/.cloudflare-workers/enterprise/wrangler.json
```

`enterprise-registration.mjs --apply` 已于 2026-09-13 在本机 C000001 Console 测试库执行成功。执行前重新运行专属临时 MySQL 验证，覆盖真实 Console DDL、重复安装和撤销事务回滚。命令限定本机测试数据库、Runtime/Console deployment 和 MySQL UUID；同事务登记 public OIDC client、两个精确 URI、enterprise.runtime 服务身份及当时 capability 列表。实际返回 OIDC、callback、logout 和 service client active 均为 true，缺失及额外 capability 均为空；`currentCredentialPointer:false`、`tokenIssuanceVerified:false`。已有停用/撤销或 scope 冲突拒绝，不覆盖旧记录。不生成凭据，后续服务凭据和实际 data-runtime audience 验签见下方完成记录；后续增加 capability 时重新核验登记。未部署的 Host deployment 仍保持 proposed，未切换 Gateway 路由或业务库。

已完成本地 pilot 类型检查、真实 Gateway 请求的物理身份/前缀测试、既有 Gateway 回归以及真实隔离 MySQL 注册验证。部署前还需实际 Platform 技术部署/Manifest、统一 Runtime schema/registry、服务 credential 及精确 token 签发证据；这些不是路由补丁能生成的事实。

本次实际本地构建及 Wrangler dry-run 均 exit 0；上传制品估计 `5785.81 KiB`、gzip `2084.29 KiB`。构建后的公开资源确实位于 `output/public/enterprise/_nuxt/`。该结果仅证明本地制品和配置可打包，未上传或切换真实请求。

## Gateway 源身份登记实际执行（2026-09-13）

测试 Gateway 在 40 项回归、配置摘要专项测试及 Wrangler dry-run 通过后，以 `--keep-vars` 发布代码；代码版本为 `ef3cfc92-5737-4487-b15a-396a61ca905e`，发布前版本为 `bc4258f9-e163-40cd-8d37-658cba010605`。四个服务绑定、测试域名和两分钟调度保持原配置；未开启 Enterprise Host 路由。

远端受保护摘要与本地完整 Registry 一致后，生成仅新增 `apps.enterprise.deploymentCode=C000001-test-enterprise` 的单 secret 合并制品。写前再次核对，使用 `wrangler secret bulk` 仅更新 Registry secret，写后远端摘要与预期一致。摘要由 `f0c034a94f905367a1adaf334042c71301fb15e27935a408d33e365f72eb8d62` 变为 `204800c68c34fb7df5b582307a76fbd55ecd2410ddeed2b847a0a1aafcc81907`；秘密未输出。Cloudflare secret 更新不是原子 CAS，本次由单一执行者顺序完成核验与写入。

该变更登记受信内部请求的 Enterprise 来源身份，不代表 Host 已上线、正式令牌已验证或业务库已迁移。

测试 Runtime 身份绑定：实际受保护 `config.json` 已新增唯一字段 `deploymentBindings.enterprise=C000001-test-enterprise`，原配置以 `config.before-enterprise-binding-20260913.json`（0600）备份。重启原 `cn.wiztek.hzy-test-runtime` 后，`/runtime/health` 返回 200、tenant/deployment 精确匹配，所有已启用数据库均为 ok；二进制仍为原 `0.3.219-test.product-line-label.1`。Enterprise 业务开关仍关闭，未启用统一库或替换运行二进制。

## 正式 Enterprise 服务令牌首项验证（2026-09-13）

已审阅并向实际 Console 测试库补齐 32 项既有 active grant 缺失的 `audience=data-runtime` 与同名 `semanticScope`，保留原 metadata、状态与租户/部署范围。已有冲突值或撤销记录拒绝更新；实际注册复验无缺失项。

`node deploy/test-env/verify-enterprise-oauth.mjs --execute` 退出码 0：正式测试 Gateway `/oauth/token` → `HZY_CONSOLE_SERVICE=hzy-test-console` → 客户 Runtime 签发 `aims:products:view`，返回带 CF ray 与 C000001 测试标记。令牌经 stdin 交给只读公钥与当前凭据校验器，签名、issuer、data-runtime audience、enterprise.runtime、tenant/deployment、有效期、scope 和当前 credential/grant 均通过；未本地签 token，未输出 token 或明文秘密。

首项探测之后已完成当前 32 项 capability 的逐项正式签发与验签，脱敏证据见 [`enterprise-oauth-live-evidence.json`](../deploy/test-env/enterprise-oauth-live-evidence.json)（2026-09-13T19:41:06.219Z）。32 项均通过，未登记的 tenant-runtime audience 与未知 scope 均返回 400。Foundation 当前每次只请求一个 capability，没有组合 scope 调用。此证据不覆盖实际 Runtime 业务调用、用户 OIDC 会话或业务页面验收。

用户会话分阶段验证：Gateway 新增 `HZY_ENTERPRISE_AUTH_PILOT=true`，仅代理 `/enterprise/` 下的登录、认证 API、构建静态资源及明确不可用页。Aims、Assets、Console 根入口和 `/oauth/token` 继续走现有路由；完整业务切换仍由 `HZY_ENTERPRISE_PILOT=true` 控制。真实 Gateway binding fixture 的 5 项拓扑测试通过，包含缺少 Host binding 返回 503 和旧业务路由保留。该开关已在下述登录阶段发布；拓扑测试本身不能作为用户 OIDC 已通过的证据。

## 登录阶段 Host 实际发布（2026-09-13）

重新执行专用 pilot 构建和 Wrangler dry-run 后，发布 `hzy-test-enterprise`（代码版本 `649a24cc-5aa6-4802-8a32-3132f4cb8fc0`），仅配置既有 Gateway 内部凭证，不导出 Enterprise 客户端秘密。随后发布 Gateway auth-only 配置，版本 `0979bab5-8f46-4e06-b8f1-f5aa1be7cabb`，新增 Host service binding 与 `HZY_ENTERPRISE_AUTH_PILOT=true`，未启用完整 `HZY_ENTERPRISE_PILOT`。

实际 `/enterprise/login` 返回 HTML 200，正确会话接口 `/enterprise/api/auth/me` 返回 JSON 200、`authenticated:false`；现有 `/aims/products`、`/assets/products` 均仍返回 200。`/enterprise/api/auth/session` 不是本项目会话接口，其 HTML fallback 不能作为认证验证。此阶段只证明登录入口与未登录会话查询接通；用户授权码回调、已登录会话及业务页面仍未验收。Runtime 统一业务开关保持关闭。

浏览器实测补充：在当前 Chrome 打开 `/enterprise/login` 并点击“使用企业账号登录”，已有 SSO 会话完成跳转，最终到达 `/aims/`，未要求重新输入凭据。随后直接打开 `/enterprise/api/auth/me` 被 Chrome 以 `ERR_BLOCKED_BY_CLIENT` 拦截，未取得已登录会话 JSON。随后回到登录页，通过 Chrome 开发能力发起同源、携带现有会话的只读请求，得到 HTTP 200、`authenticated:true`、`provider:console_oidc`、`refreshable:false`；仅提取上述状态，没有读取或输出 cookie、token、用户标识。这证明当前 SSO 登录与 Enterprise 会话查询通过，尚不覆盖业务权限与统一 Runtime 验收。

## 项目承接新增授权验证

Host 项目承接新增 `aims:product-priorities:handoff` 和 `aims:product-priorities:project-authorization`，当前合同共 34 项 capability。真实 Console 复验发现仅缺这两项，按原测试租户注册流程补齐后缺失/额外项均为空。使用 `verify-enterprise-oauth.mjs --execute-scopes aims:product-priorities:handoff aims:product-priorities:project-authorization` 完成两项正式签发、公钥与当前凭据/授权校验，另两项拒绝探测通过；见 [增量证据](../deploy/test-env/enterprise-oauth-selected-evidence.json)。该文件与原 32 项证据各保留实际验证时间，不将历史探测改写成同一时刻全量验证。

迁移准备的真实源计数、精确映射、权限核验边界及执行依赖见 [C000001 统一库启用准备](./C000001-Enterprise-Migration-Preparation.md)。部署预检已纳入 `20260913-enterprise-recovery-route.sql`，实际应用结果见下方2026-09-14迁移记录。

测试 Cloudflare 配置生成器已将 Console 的 `HZY_PLATFORM_BUNDLE_CACHE_BACKEND` 默认值从 memory 改为 runtime，与本地 Worker 模板及 Enterprise 预检一致；8 项配置/隔离测试通过。这是下次部署的配置修正，尚未改变远端 Console 变量，目标环境持久策略存储仍需实际验证。

Runtime 更新前已在受保护目录 `test-runtime/backups/before-adr018-69a948c2bfcd2b59` 保存当前二进制和配置，并分别按字节/hash核对。原二进制 SHA-256 为 `69a948c2bfcd2b59187d822c98ca30734ec5225e16cfde03dc9f23eff63e2d31`；配置备份权限0600，内容未导出仓库。该备份用于尚未启用统一库时的二进制更新恢复，不替代新业务写入后的数据恢复。

## Runtime 候选2实际测试更新

2026-09-13T19:57:57Z，测试 Runtime 已原子替换为 `0.3.219-test.adr018-candidate.2`，SHA-256 `cb5c2d15c2f4c70c0bf47f25ca7c86bd93deed7c5c6980c49b15b583b5659e12`。制品来自独立源码快照，`go test -race ./...` 的27个测试包通过；此全包运行未开启专属 MySQL 环境参数，真实 HTTP/MySQL 证据另行保留。配置按字节保持不变，enterprise.enabled=false，重启后实际健康状态ok且版本匹配，未执行业务迁移。

Chrome 通过正常 Console 应用入口回验：Assets 产品主档53条、分类8个、技术底座1个；Aims产品中心6条产品线、名称及管理状态正常加载。最初未初始化会话的直接API请求401不能单独归因于重启；错误的双前缀登录redirect已纠正，正确深链可用。正式 `verify-enterprise-oauth.mjs --execute` 再次通过1项签发/验签及2项拒绝探测。这些证据覆盖本次二进制更新的旧路径读取与服务认证，不代表统一库业务链验收。候选2尚不包含后续 Assets主档整合与外部drain控制新增工作。

## Assets 主档与分类服务授权增量

当前固定能力合同增至36项，新增 `assets:product:edit` 和 `assets:admin:admin`。真实 Console verify 仅缺这两项，事务补齐后无缺失/额外 grant；两项正式 Gateway→Console→Runtime 签发和公钥/当前状态验签通过，两个拒绝探测通过。脱敏证据为 [Assets 增量探测](../deploy/test-env/enterprise-oauth-selected-618a3481f5d8-evidence.json)，保留原32项和项目承接2项的独立验证时间。新增服务能力不替代用户的 products/edit 或 admin/admin 数据范围校验。

主档与分类的 Host H3 测试已覆盖独立管理员权限、可信 actor/scope、非法范围/参数、幂等键传递与下游不可用；修复了检查幂等键但未转发 Runtime 的问题。真实双 HTTP/MySQL/race 回归已通过，覆盖重放、冲突、回滚与撤销。正式源 receipt CHECK 已于20:32:33Z应用并只读复核；完整表映射和新版业务制品尚待交付，不能据隔离测试通过宣称业务部署完成。


## Enterprise 产品文档接收合同补齐

Codocs metadata接收端现在按认证事实分别接受 assets/assets.runtime 与 enterprise/enterprise.runtime，不允许混用client；固定Assets operation及精确Codocs能力，保留独立文档ACL和四字段输出。Runtime已补 `/v1/codocs/service/assets-product-documents/{id}/metadata` 的只读POST分类，避免只读BFF误被要求codocs.write。实际JWT/auth/router测试与18项Codocs policy/middleware/HMAC测试通过；下游ACL测试使用SQL fixture，不代表真实Enterprise→Codocs跨服务部署验收。目标Codocs部署与新增audience=codocs grant仍待落实。

### Enterprise 外部 Codocs grant 登记与实际签发

`enterprise-readiness.template.json` 的 `externalServicePolicies` 单独选择
`aud=codocs` / `codocs:product-document:read`；Runtime 的 36 项 capability 保持原样。
`enterprise-registration.mjs` 根据目标 manifest 核验资源动作，按每项 audience 登记及复验，
拒绝重复 capability、错 audience 和已撤销记录。隔离真实 Console DDL/MySQL 验证包括外部
授权错 audience 拒绝、撤销后整个事务回滚、重复登记及原元数据保留。
2026-09-13T21:03:50Z 已向实际 C000001 Console 登记该外部 grant，复验无缺失或意外授权。
`node deploy/test-env/verify-enterprise-oauth.mjs --execute-codocs` 经实际 Gateway→Console→Runtime 签发并以当前公钥、凭据状态和精确 grant 验签；错 `data-runtime` audience 返回 400，未授权 `create` 返回 403。
证据：[Codocs OAuth](../deploy/test-env/enterprise-oauth-codocs-evidence.json)。验证器通过固定 `--verify-codocs-token` 模式选择该唯一外部 audience/scope 对，原 Runtime allowlist 不变。
尚未证明目标 Codocs 新代码已部署或完整文档关联链可用。

## Runtime 候选4实际测试更新（2026-09-14）

测试 Runtime 已原位原子替换为 `0.3.219-test.adr018-candidate.4`，SHA-256 为 `c0d8a54fd9114b46b7cbe7110ad0f24c0c05f1115ba4a97decb3c2b9d35a71fd`（30,043,650 bytes，darwin/arm64）。替换前确认当前二进制仍为候选2的 `cb5c2d15c2f4c70c0bf47f25ca7c86bd93deed7c5c6980c49b15b583b5659e12`，并核验候选 receipt 的 `go test -race ./...` 成功、构建前后源码漂移均为空及独立真实 HTTP/MySQL 证据。受保护目录已保存旧二进制和 config 的 owner-only 备份与哈希；未输出配置或秘密。

仅重启 `cn.wiztek.hzy-test-runtime`。本地 `127.0.0.1:18084/runtime/health` 和公网 `https://hzy-test-runtime.isme.dev/runtime/health` 均返回 HTTP 200、目标 tenant/deployment 和候选4版本。config 按字节保持不变，Enterprise 与合同开关仍为关闭，未执行数据库迁移、绑定变更或其他 Worker 操作。脱敏部署 receipt 见 [候选4 Runtime 部署证据](../deploy/test-env/artifacts/C000001.runtime-candidate4-deployment.json)。本次二进制更新未进行浏览器业务验收；健康检查不能替代该验收。

控制面预检迁移清单现包含8项：在既有6项后明确列入external-drain-approval与drain-activity-approval两张审计表迁移。文件存在只证明准备齐备，实际Platform目标库应用状态仍须另行核验；不能据本地预检通过声明排空认可接口可用。

## Platform 测试库迁移实际执行（2026-09-14）

2026-09-14T04:44:38.313Z，8项已审阅的新增表迁移应用于 `hzy_platform_dev`，精确实例UUID核验通过。13张新表均为空，4项CHECK约束生效；未修改旧表或写入业务行。受保护目录保留执行前状态和执行回执，[脱敏证据](../deploy/test-env/artifacts/C000001.platform-enterprise-schema-application.json)记录每项SQL及实际DDL摘要。此结果只证明测试库结构已就绪，Platform新代码发布和真实API验收仍待完成。

## Platform 开发测试候选实际替换（2026-09-14）

2026-09-14T05:36:41Z，仅 `hzy-platform-dev` 已替换为独立 Linux Node 24 候选，PM2 entry、`/proc/PID/cwd` 与候选 entry SHA 均为 `/wiztek/hzy-test/platform-candidates/enterprise-platform-linux-20260914T052100Z`。候选输出为849文件、manifest `9331f2c20650e22e9ca44a65d424ac7f3f0065e2f58f9b7ca828db0d09b55cd5`；端口3011、`hzy_platform_dev` 与已核验 UUID 保持原值。`/api/health` 返回200，enterprise roles、external drain 与 cutover activation 三条未认证请求均返回401，证明新路由存在且仍拒绝未认证调用。原 PM2 环境快照以0600保护，原 release entry/cwd 保留为回滚目标。完整脱敏证据见 [Platform 测试部署收据](../deploy/test-env/artifacts/C000001.platform-enterprise-development-deployment.json)。这不替代待完成的已认证浏览器验收。

## Console更新后的浏览器验收状态（2026-09-14）

Chrome原有Aims需求页在刷新前显示缓存内容（需求池/版本计划/产品结构及10条需求）。实际刷新后进入Wiztek SSO登录页，因此不能把刷新前的内容视为本次Console发布后的页面验收通过。已请用户重新登录；构建及非浏览器验证继续。该观察不单独证明登录失效由Console更新引起。

用户重新登录后，Chrome实际返回Aims需求池，10条需求及需求池/版本计划/产品结构页签正常显示。经页面导航进入产品中心，6条产品线以名称显示，下拉选项为名称加编码；选择通用领域（TY）后URL携带productLine=TY，结果仅1条产品线、5个产品；已重置默认筛选。此项验证覆盖Console更新后的旧Aims读取与筛选路径，不代表尚未启用的Enterprise统一库页面验收。

控制面运维身份与业务测试站SSO独立：2026-09-14检查时，`hzy.wiztek.cn/admin/login`仍需员工登录。浏览器工具安全策略阻止企业微信扫码地址跳转，已请用户手动完成；未获取或绕过运维身份，未提交排空认可。


## 固定提交发布候选（2026-09-14）

指导、业务源码与测试部署证据已分别提交为 `8cfb6a52`、`c4fe818f`、`090ba513` 并推送main。本机 `data-runtime/.env.example` 调整保留在原工作区，未提交或复制到构建检出。

从clean detached `090ba513`构建Runtime `0.3.219-test.adr018-candidate.5`，darwin/arm64，21,996,450 bytes，SHA256 `2b720e3be9953410ed15ad871d359eb9d72320fe85d3cf3a84e5cab50de180e6`。完整Go race suite通过；全业务域关闭、无外部控制配置的独立loopback健康检查返回该版本200，随后停止。[候选收据](../deploy/test-env/artifacts/C000001.runtime-candidate5-build.json)。实际运行复核仍为candidate.4；candidate.5部署未获验证，不能记为上线成功。

同一固定提交的完整Host（pilot=false）在独立检出使用Node24.18.0构建，typecheck、Cloudflare build和Wrangler dry-run通过。输出374文件、7,646,211 bytes；Wrangler Total Upload为6001.97 KiB，gzip为2115.97 KiB。构建不复制环境文件，结束后Git源码仍干净。[Host候选收据](../deploy/test-env/artifacts/C000001.host-pinned-090ba513-build.json)。此前基于未提交快照的Host候选保留历史，本候选未部署。

这解决了固定源码及构件准备，不替代最终fenced copy、Registry/调度所有权、外部排空认可、真实业务与恢复验收。预检仅在proposed下引用新候选，observed仍记录实际在线版本。Git推送已核实成功；现有Git凭据访问GitLab CI API返回401，未据此宣称远端CI通过。

最新[部署状态观察](../deploy/test-env/artifacts/C000001.runtime-candidate5-deployment-observation.json)记录：当前二进制与原candidate.4 SHA一致，配置SHA保持不变，本地health为200；Python默认客户端访问公网health返回Cloudflare 403/1010。备份目录存在，但没有成功部署收据，不能仅凭备份推断完整执行过程或失败原因。Chrome产品中心刷新后为空白，此现象与命令行403分开记录，尚未证明同一原因。

后续已使用项目Node请求方式核验公网health与签名drain snapshot，均200；因此Python默认客户端403不代表服务不可用。Runtime candidate.5已成功部署，本地/公网health均报告提交`090ba513`，二进制SHA与固定候选一致、配置SHA不变；旧二进制及配置备份保留。见[成功部署收据](../deploy/test-env/artifacts/C000001.runtime-candidate5-deployment.json)。此记录更新前述candidate.4观察，不改变统一库及合同开关关闭状态。

## 运维审阅入口与在途证据（2026-09-14 后续）

Platform 员工登录已恢复。新增 `/admin/deployment-reviews`，使用原运维会话和 `ops.deployments:admin`，支持外部排空/在途活动审阅的 plan 与显式 approve；文件或粘贴 JSON 共用校验，修改草稿/切换类型清除旧 plan，处理中锁定输入。Runtime cutover activation 仍保持原控制凭据边界。类型检查及独立 Linux 构建通过；仅更新 `hzy-platform-dev`，数据库及实例不变，并接入已有测试协调器的验签配置。完整输出850文件，版本依据提交 `52ed822b`，旧版本输出保留。见[部署收据](../deploy/test-env/artifacts/C000001.platform-review-paste-ui-deployment.json)。

[真实浏览器验收](../deploy/test-env/artifacts/C000001.platform-review-ui-browser-verification.json)覆盖已认证接口的错误签名拒绝、输入变更失效及1440/390布局。未执行真实批准，正向 plan/approve 尚未验收。Chrome 文件导入因扩展权限不可用，实际使用粘贴入口完成测试。

最新签名账本仍为open/revision 2，存在41条Aims uncertain活动，时间覆盖05:23:11Z～06:22:23Z。对应扩大窗口的Runtime结构日志2016条，已观测的Aims操作均为读取/权限查询；源码复核这些分支没有业务写入或enqueue。但账本没有请求路径或下游operation关联，聚合Runtime日志不能覆盖未观测Worker入口；不把读取样本视为全部活动终态。见[活动观察](../deploy/test-env/artifacts/C000001.drain-uncertain-activity-observation.json)。

[实际Worker日志配置](../deploy/test-env/artifacts/C000001.aims-observability-observation.json)确认当前100%版本仍为 `b4b4763b-57ac-4ad8-b4a8-67e042c31ad0`，observability未配置、logpush=false、tailConsumers为空。现有渠道无法补回上述历史请求关联。未关闭入口、未封存或清理活动，未切换统一库；需取得覆盖这41条活动的终态/未发送证据，再执行活动复核和最终排空。


## 测试数据授权处理与统一库激活（2026-09-14，取代前述排空阻塞状态）

用户已明确确认仅内部测试，并授权放宽测试数据处置限制。41 条已结束但状态不确定的活动按原行摘要逐条审计结案，保留原始状态与授权依据，不标记为真实外部业务成功。当前未解决活动为 0；此前等待外部历史证据的卡点已解除。

已完成旧 Aims/Assets 源库备份、写入围栏、152 表最终复制（480 行，含两条围栏状态）、55 个兼容视图安装及 Platform 实际签名外部排空审批。统一目标 `hzy_enterprise_shadow_review_20260913` 已激活 generation=1。专用 Runtime 账号仅获目标库四项 DML 和这 55 个视图的 SHOW VIEW；逐视图校验、目标写事务回滚验证通过。Runtime 已启用统一绑定，本地与公网健康检查均为 200。AA-03/AA-04 合同开关保持关闭。

完整 Enterprise Host pinned `090ba513` 已部署测试 Worker，版本 `2d71bea8-d845-4885-9089-0b6d84e3ae5b` 承接 100% 流量。此时尚待调度归属、网关业务路由、排空释放和认证业务验收；以上数据库与二进制事实不能代替整阶段验收。

证据：[测试数据处置](../deploy/test-env/artifacts/C000001.test-data-disposition-result.json)、[切换前备份](../deploy/test-env/artifacts/C000001.pre-cutover-source-backup.json)、[统一库激活](../deploy/test-env/artifacts/C000001.unified-database-activation.json)、[Host 发布](../deploy/test-env/artifacts/C000001.host-pinned-090ba513-build.json)。


### 本次切换后续核验

Platform 已登记统一调度归属 revision=1，并修正测试 Runtime/Aims/Assets 三条过时的 runtime_endpoint 登记。真实 Runtime 观察与 Platform 签名匹配后，排空已释放为 open/revision=5/generation=1；签名快照核验未解决活动为 0。Gateway `01b2d883-cc5c-4523-8247-6a01b1d78068` 已承接 100% 测试流量，统一业务路由启用，静态 registry 中 Aims 调度选择为 unified/generation=1，摘要实际读回一致。

浏览器发现第一份完整 Host 构建使用根静态资源路径，与测试网关前缀不匹配；已用同一 `090ba513` 源码和 Node 24.18.0 重新构建，启用仅控制测试 URL 前缀的 `HZY_ENTERPRISE_PILOT=true`。新 Host `afb6680a-f930-4c74-ae59-1e5025dc7783` 已 100% 发布，`/enterprise/_nuxt/` 的 JS/CSS 均 HTTP 200，认证入口进入正常 Wiztek SSO。测试站当前会话过期，已请求重新登录；此处尚不声称登录后产品业务验收通过。

见[网关与排空释放](../deploy/test-env/artifacts/C000001.unified-gateway-release.json)、[测试前缀 Host 发布](../deploy/test-env/artifacts/C000001.host-test-prefix-090ba513-deployment.json)。旧制品与配置备份保留；源库仍有写入围栏，恢复旧入口前必须按恢复流程决定唯一写入方，不能直接让旧源重新写入。

## Console 策略同步与登录后读取复核（2026-09-14）

测试 Console 独立策略同步曾在其30秒下游请求期限内未等到已认证 Platform 签名包。仅测试环境把 Console→Platform 上界设为90秒、Gateway→Console上界设为100秒；不会更改策略TTL、`syncedAt`、签名校验、tenant或deployment绑定。当前 Console `d7456308-bb6a-4aa9-90f3-0268f0087e93` 与 Gateway `0866464e-ffa4-4de8-a75e-895100a87bfa` 均承接100%流量。手动同步返回200，随后两次自然cron续期相隔120206ms和119498ms，持久快照保持活动签名包。见[脱敏恢复回执](../deploy/test-env/artifacts/C000001.console-policy-sync-recovery-20260914.json)。

SSO重新登录后，Chrome已验证产品中心六条产品线名称与通用领域筛选、需求池/版本计划/产品结构，以及53项Assets主档读取。首次并发的产品/Assets请求曾出现`Fresh bound product authorization is required` 403。Foundation合并相同缓存键的未完成换票，Host只为随后同一注册Runtime操作预热精确令牌；短请求仍复现后，诊断收敛到 Runtime 的严格15秒 permit 上界。Host现将明确定义 permit 字段中原本合法的14～15秒值收紧为14秒，保留15秒 Runtime 接受窗口，已过期或异常未来值仍原样拒绝，facts/input未改写。该1秒余量基于分布式时钟差推断，并未确认 Runtime 的具体失败分支。最终Host构建版本发布后仍需复验冷首访；写入UI验收、AA-03/AA-04合同开关及Altoc、Finance、People等未迁移域的完成状态不因此改变。

`bd55fe14` Host 构建已作为 `d6a2d58c-b225-4558-92c7-f1f7cc2095ba` 承接100%测试流量。冷首访 Assets 的 dictionaries、categories 和 products 三个请求均为200，页面显示53项产品与8个分类，未进行重试。Aims详情、需求和版本等后续页面按各自浏览器回执继续验收；本记录不把读路径成功扩展为写入UI、AA-03/AA-04合同开关或未迁移域完成。

### 测试候选发布边界

测试 Runtime 只上传到不可变候选版本路径，并在 Platform dev 固定引用该候选。不得通过测试发布改写共享 `latest`、根安装脚本或其他环境的下载入口。2026-09-14 候选发布曾误改共享别名，已恢复至原 `0.3.216` 并核对 13 个公开地址的文件摘要；测试实例继续固定候选 7。恢复证据见 [`C000001.runtime-shared-latest-recovery.json`](../deploy/test-env/artifacts/C000001.runtime-shared-latest-recovery.json)。该核验只证明别名已恢复，不代表已调查期间所有外部下载行为。

### 最终浏览器验收与剩余环境阻断

Host `d6a2d58c-b225-4558-92c7-f1f7cc2095ba` 首访 Assets 字典、分类和产品三接口均为 200，显示 53 产品、8 分类；Aims 六产品线、产品详情、需求池、版本计划、产品结构正常加载，旧目录同步提示已隐藏。浏览器完成一条明确标记的内部测试需求新增、详情读取、进入评估及拒绝，最终状态为“已拒绝”，保留审计记录。详情见 [浏览器验收回执](../deploy/test-env/artifacts/C000001.browser-acceptance-20260914.json)。这不代表全部写入流程或 AA03/AA04 已验收。

自动续期仍有环境阻断：实际定时调用在 Console 发生 `exceededCpu`（CPU 10ms），不是 Gateway bootstrap 超时；手动同步后完成了上述验收，但不能替代稳定续期。对同一测试制品尝试 `limits.cpu_ms=1000`，Cloudflare 当前明确返回 `100328: CPU limits are not supported for the Free plan`。尝试未改变线上版本、绑定或 secrets，临时配置已清理。等待用户决定 Workers Paid 或后续专项 CPU 优化，未购买套餐，未放宽 300 秒策略有效期。[阻断回执](../deploy/test-env/artifacts/C000001.console-cpu-limit-blocker-20260914.json)。

### 测试技术发布登记完成

Platform test Release 34 已登记为 `v0.3.219-test.adr018-candidate.7-g1` 并标记 released，Deployment 18 报告为 current。本次采用限定测试应用的管理员审计事务：逐字段核对内容相同后复用 active Manifest 41，不重建权限目录、不修改旧 release；标准导入接口事务停滞已回滚，作为后续独立问题保留。Enterprise 主页修正为测试 Host 根路径，临时 release prefix 已恢复。回执中的 sourceTag 为发布标签（未推送 Git tag），Worker URI 是已部署版本引用，不代表可下载安装包；实际已推送源码见 repositoryCommit。见[实际登记回执](../deploy/test-env/artifacts/C000001.enterprise-technical-release-registration.json)。此登记不消除上述 Free CPU 自动续期阻断。

## 整合分支隔离与授权差异复核（2026-09-14）

主分支以 `1cc1ca3d` 撤回从 `c4fe818f` 到 `c53243ac` 的 41 个整合提交，源码树与整合前 `8cfb6a52` 完全一致，保留此前产品功能及指令精简。撤回与独立分支 `feat/adr018-enterprise-integration` 均已推送；分支在撤回后的 main 上恢复整合源码，后续修复仅提交到该分支。没有重写共享历史，也没有因 Git 撤回修改生产部署或数据库；本机未提交数据库配置保持原样。整合验收完成前，不将该分支合并到 main。

实际生产 Console 使用 memory 后端、30 秒内存缓存及 Platform Service Binding；测试整合 Console 使用 Runtime 持久缓存、300 秒有效期及外部 Platform URL，并增加签名包持久化、防回滚与 CAS。两者并非相同执行路径。此前把失败直接归因于免费套餐不足并不完整；用户已明确保留 Free，本次不购买套餐。

`5b5315e6` 复用同一候选的规范化策略摘要，避免持久化过程中反复处理约 593 KB 的策略数据；前驱仍逐次读取校验。签名、HMAC、有效期、防回滚及 CAS 条件保持不变。`9bf4e68f` 将已有测试专用 90 秒 Platform 请求上界固化到配置生成器，防止重建后退回 30 秒。生产只作配置比较，没有部署变更。

浏览器在现有会话中打开原截图版本地址：同步恢复前页面保持登录但业务请求报 `bundle_unavailable`，恢复后显示 4 个版本；随后从顶部导航切换 Assets（53 产品、8 分类）再返回 Aims（6 条产品线），没有额外登录。原截图的旧外层布局未复现，不将其历史原因断言为缓存问题。首页过时的“业务模块尚未启用”提示已随 `ee1fbb84` 构建更新，测试 Host `615f6fe3-4fe2-42d4-94f0-d7dc4ed329d7` 已读回 100% 流量。见[分支与登录复核](../deploy/test-env/artifacts/C000001.integration-branch-auth-verification-20260914.json)及[Host 收据](../deploy/test-env/artifacts/C000001.host-ee1fbb84-deployment.json)。

最终测试 Console `fdcbeddf-6e6f-4322-b92b-1aa80fdb4558` 承接 100% 流量。11 项持久策略测试、5 项测试配置检查通过。两次自动续期均 HTTP 200 / outcome=ok，间隔 125 秒，持久快照读回新鲜；因此本次已恢复自动续期，无需开通 Paid。日志分别记录 CPU 114ms、96ms，不能据此保证免费档长期无 CPU 中断；后续仍可单独优化并观察。见[自动续期恢复收据](../deploy/test-env/artifacts/C000001.console-policy-cpu-recovery-20260914.json)。本节取代前述“等待套餐决定”的当前阻塞状态，历史失败记录保留。

### 登录复发排查（2026-09-14 后续）

用户再次报告停在 `/enterprise/login?redirect=/aims/`。本次观察刷新根页面曾进入 Console activation（未缓存策略包），随后策略自行恢复；不能用前述两轮成功宣称已解决间歇故障。点击 Host 登录按钮无需输入账号即返回业务页，说明该次已有 SSO 会话可复用。

宿主会话协调器存在可重现竞态：Cookie 更新使进行中的身份检查失效，旧检查返回空字符串，路由守卫将取消结果误判成未登录。`ad65c5de` 让旧检查等待替代检查，或采用当前已经验证的身份；退出及无效新身份仍清空，旧身份不能复活。7 项会话测试覆盖两种完成顺序、身份变化、退出及失败；另 11 项 Foundation OIDC 测试通过。登录回到 `/aims/` 或 `/assets/` 时，现在转到已接入的产品入口，避免显示旧占位页。

测试 Host `bcf7157b-7a08-4e04-bb82-1a6d300c0d9a` 已读回 100% 流量；浏览器 `/aims/` 自动进入 `/aims/products`，显示 6 条产品线，auth/me 为 200。没有声称真实过期续期验收成功：浏览器 URL 范围的短期 Cookie 删除未实际移除域 Cookie，工具不允许域范围修改，未绕过该限制。见[本次 Host 与验证回执](../deploy/test-env/artifacts/C000001.host-ad65c5de-deployment.json)。生产与主分支保持不变。

本轮已抓到复发根因：Console `fdcbeddf-6e6f-4322-b92b-1aa80fdb4558` 的 21:18:50Z 定时策略同步，wall=32544ms、CPU=10ms、outcome=`exceededCpu`，异常 `Worker exceeded CPU time limit`。该次未更新快照；此前新鲜快照仅证明上一轮成功。前次重复计算优化没有消除 Free 档间歇 CPU 中断，故本轮仅把宿主竞态记为已修复，策略续期稳定性仍未解决。未手动同步覆盖现场、未购买套餐、未放宽 TTL 或鉴权。后续 CPU 优化须针对完整同步路径，并用成功与失败日志核验，不能以两轮 200 替代稳定性结论。

### 按用户要求延长测试策略有效期并改为每日同步

用户明确要求延长策略有效期、降低 Platform 拉取频率，而非隐藏激活页。此次没有修改激活页/路由守卫。仅 test 环境启用 `HZY_PLATFORM_BUNDLE_MAX_AGE_MS=93600000`（26 小时，覆盖每日周期并留 2 小时余量）；未配置或非 test 环境保持原 5 分钟。持久缓存、企业资格新鲜度和内存截止时间共用该值，内存驻留 TTL 仍为 5 分钟，其重新读取来自 Runtime 而非重新访问 Platform。

任何策略包若带 `expiresAt`，到期仍立即拒绝；当前测试签名包 `expiresAt=null`，本次未修改或重签该字段。26 小时从最后一次成功同步计时，不从读取、失败重试或进程重启时延长。HMAC、签名、CAS、防回滚和用户会话/账号有效性检查不变。策略包承载的权限调整可能延迟至下一次同步，紧急变更需要手动触发。

测试 Console `29be09c1-b326-4474-86b6-990ae36a1e1d` 已 100% 发布并读回配置；21 项缓存边界测试、5 项配置测试和 Console typecheck 通过。Gateway 仅通过 schedules API 将 `*/2 * * * *` 改为 `0 16 * * *`，即北京时间每日 00:00；已读回，未重部署 Worker 代码或改变 bindings。Cloudflare [Cron 使用 UTC，配置传播最长约 15 分钟](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。保留手工同步端点，不新增高频兜底轮询；当天自动同步失败可手动重试，连续失败超过有效期仍会停止使用旧包。

只读测试 `/api/activation/status` 返回 HTTP 200、`activated=true`、`bundleReady=true`。配置读回及边界测试不等同于已观察次日零点任务。生产、main、免费套餐及本机数据库配置保持不变。见[Console 收据](../deploy/test-env/artifacts/C000001.console-0e637dd3-deployment.json)及[每日调度收据](../deploy/test-env/artifacts/C000001.policy-daily-schedule.json)。
