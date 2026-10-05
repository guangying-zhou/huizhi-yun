# 本地多 Worker 开发测试环境

## 策略包数据库切换验收（2026-09-06）

R2 policy 层已替换为 Foundation/Data Runtime API，存入隔离测试库 `hzy_console_test_20260905.policy_bundle_snapshots`；生产可用同一 schema/API 和 `backend=runtime`，但生产迁移与发布未执行。独立分钟同步、内存 TTL 300000 与同步新鲜度硬截止保留。

已新增存储表和两个精确 Console capability，旧 R2 对象保留。实测约419KB单条快照持续更新，不积累无限历史。Runtime 存储上限4MiB、专用HTTP命令上限8MiB；其他业务命令仍1MiB，超限失败关闭。

最终隔离测试 Runtime 版本 `0.3.215-test.4`；切换前版本保留于 `/wiztek/hzy-test/runtime/hzy-data-runtime-before-test.3`，本轮容量限制调整前版本保留于 `hzy-data-runtime-before-test.4`。没有修改生产 Runtime 或生产数据库。

验收：独立同步连续200；两个 Runtime audience 的 read/write/组合共6组真实签发通过。使用 `local-workers.mjs start --no-policy-sync` 暂停调度并重启，数据库同步时间未变化，Console scoped与People员工查询200，证明数据库持久读取；随后恢复普通 start 的分钟调度。此开关仅用于冷启动/失效测试。

Console447项测试、类型检查和Worker构建通过；Runtime Console/Auth/Server包、Gateway调度和本地配置13项检查通过。生产发布前仍需按 [运行手册](../../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md) 完成目标环境升级与实际签发验证。

日期：2026-09-06。状态：本地入口与 Runtime 策略包持久存储已验收；生产未迁移/发布。下文保留分阶段实施记录。

最新入口决定：用户已改用 `https://hzy0.isme.dev` Tunnel，替代下文历史候选
`wiztek.hzy.test` / `dev0.huizhi.yun`。Tunnel 当前指向本机 `http://localhost:19090`，
Caddy 不再作为主入口；无需修改 `huizhi.yun` 的生产通配 Worker route。
本地配置已改用精确 hostname，仍固定 C000001/test；SSO 与 Runtime issuer 尚未切换。
初次外部探测返回 502；本机 8787 使用 `Host: hzy0.isme.dev` 请求返回 HTML 200。
运行中的 cloudflared 使用 token 模式，未显式使用本地 config.yml；该文件不能代表当前
远程管理的 ingress。随后只读 Cloudflare API 核验确认 hzy-dev0 Tunnel 的 hzy0 ingress
为 `http://localhost:19090`，连接器在线；502 原因为本地入口端口不一致。
本地启动器已切换到回环 19090，停止旧 8787 实例并启动三个 Worker；外部 Console
首页与 `/people/employees` 均实测 HTTP 200。未修改云端 Tunnel 配置；当前仍为 smoke，
认证和业务 API 尚未接通。

## 目标与决定

统一 HTTPS 租户入口，使用生产 Gateway 源码和 Console/People 的
`cloudflare_module` 构建，在本地 workerd 中运行，通过 Service Binding 联调。
保留 Shell，不进行前端架构迁移。Platform 直接使用国内 PM2 测试实例
`https://hzy.wiztek.cn`，本地不配置 Platform Binding，不引入转接 Worker。
生产 Platform Binding 与生产域名、凭证、数据、发布配置保持不变。

## 拓扑

```text
浏览器 → Caddy HTTPS → 本地 Tenant Gateway Worker
                         ├─ Service Binding → Console Worker
                         └─ Service Binding → People Worker
                                              └─ Binding → Console
Gateway/Console → HTTPS → 国内 PM2 测试 Platform
Console/People → 受控本地传输 → SSH 隧道 → 国内独立测试 Runtime
```

首期仅 Gateway、Console、People。拟用 `wiztek.hzy.test` 回环域名；Caddy
只负责 TLS/代理，不复制业务路由或鉴权。未接入应用不得回落到生产地址。

## 安全与一致性

- 固定 C000001/test，Console deployment `wiztek-test-console`，People
  deployment `C000001-test-people`，Runtime `c000001-test-tenant-runtime`。
- 复用正式 Gateway 头清理、租户校验和请求签名；不伪造用户，不关闭权限。
- 使用正式签名策略、精确服务 grant、短期 JWT；业务 Worker 不读取本地策略。
- 本地配置独立生成，禁止生产 routes/resource ID/远程 binding；Worker 名称
  使用 hzy-local 前缀。运行状态和秘密忽略跟踪，日志不输出认证材料。
- DB 密码、Vault 主密钥和 OIDC 签名私钥留在测试 Runtime。
- Platform 用显式测试 HTTPS URL 和测试专用服务凭证；保持鉴权与验签。
- 本地 SSO 客户端的 callback/logout/origin 与 Console issuer/Runtime 验签
  同步迁移；不修改其他 SSO 客户端，不以关闭 TLS 验证处理证书问题。
- 本地 Runtime 传输必须单独适配并测试；不得全局放宽 loopback/SSRF 防线。
- 定时任务和外部通知默认关闭；后续按正式签名入口显式验证。

## 执行阶段

1. 保存方案，核验工具、配置、实际绑定调用和当前 OOM 基线。
2. 独立生成本地 Worker 配置，串行构建；锁定 Wrangler 版本及生产 compatibility
   date/flags。校验生成配置没有生产回退，测试必需绑定缺失时失败关闭。
3. 启动最小多 Worker，补齐 Gateway 普通 fetch 与实际 Binding 之间的缺口；
   本地 Platform 走现有 HTTP adapter，测试控制面失败时明确返回依赖不可用。
4. 接入 Caddy、回环域名、证书和 SSO；保留旧启动方式与配置备份。
5. 验证真实登录、权限、目录、员工读写、Shell、资源路由、重载、内存和错误报告。
6. 按需接入 Workflow/Finance/Assets 等，不把未验证功能标为可用。

## 启动器交付

拟提供 check/build/start/verify/stop；只管理本次创建的进程，不终止其他任务。
默认最小应用集合、受限构建并发、独立产物/状态目录；不覆盖生产生成配置。
首次实现可靠重建/重载，不承诺 Nuxt dev 等价 HMR。Nuxt dev 仅保留为 UI 辅助模式。

## 验收

- 实际请求走本地 Binding；缺绑定不通过生产 HTTPS 掩盖。
- 未登录、缺 capability、错误 tenant/deployment、过期 token 正确拒绝。
- 员工列表/分页/部门树/详情与受控测试记录创建/修改/回读成功。
- 登录/退出、深链接刷新、跨应用切换、Worker 重载后会话正常。
- 图标、头像、RUM 正确路由，无错误上报循环；1440/390 视口检查。
- 重复访问与重载无 OOM、无持续 5xx；分段记录请求耗时，不将单次 200 当作稳定。
- 停启可重复、可回退，不需要修改生产服务或业务数据。

## 保留差异

国内测试 Platform 为 PM2，Runtime 经跨地域 SSH 隧道；本地不模拟生产 WAF、
CDN 与全部云端限制。Platform Binding 或边缘特有变更仍需独立云端测试。
当前 Node dev OOM 的根因未确定，迁移不等于证明内存问题已修复。

## 实施记录

- 方案已落盘。生产未改动，浏览器入口尚未切换。
- 已发现：Gateway 部分 Console 转发仍为普通 fetch；现有应用构建脚本
  固定读取模块 `.wrangler.generated.jsonc`，本地方案必须隔离配置与产物。
- 已实现 `worker-config.mjs`、`build-worker.mjs`、`local-workers.mjs` 和本地 ingress guard；
  Console/People 串行 Cloudflare 构建成功，产物位于忽略跟踪的 `.local-workers/`。
  Wrangler 固定为 4.110.0；三个 Worker 已实际本地运行，Console/People HTML 经 Binding 返回 200。
- Gateway 默认 Console 转发已改为优先 Binding；Foundation Cloudflare 启动预取已取消，
  请求期 Runtime 获取不变。People 重建/自动重载后不再报告全局作用域 I/O 警告。
- 当前启动器仅支持 `check/configure/build/smoke/verify`；**不是完整集成入口**。
  smoke 显式拒绝认证/业务 API（503），不含 Platform/用户凭证，RUM 显式丢弃（204），
  不得把 HTML 200 或 RUM 204 视为业务/观测验收通过。
- Caddy 配置校验成功，但本机绑定 443 返回 permission denied；hosts 不可写，
  `sudo -n` 需要密码。未修改 hosts/系统信任，未切换 SSO/Runtime issuer。

### 2026-09-06 新增入口候选：现有 dev0 Tunnel

用户提供 `dev0.huizhi.yun` Cloudflare Tunnel。建议用它替代 Caddy 主入口：

```text
https://dev0.huizhi.yun → Cloudflare Tunnel → 本机 127.0.0.1:8787
  → 本地 Tenant Gateway → Console/People Service Binding
```

已核查本机安装并运行 cloudflared；本地 `~/.cloudflared/config.yml` 可见的是
`altoc.isme.dev → localhost:3005`，不能据此认定控制台管理的 dev0 ingress 已正确配置。
实测 dev0 返回 `404 Unknown tenant`，与生产 Gateway 的未知租户响应一致；
仓库生产路由配置为 `*.huizhi.yun/*`，需要核验线上精确路由是否先拦截 Tunnel。
建议仅对 `dev0.huizhi.yun/*` 配置更精确的无 Worker 路由例外，不能删除生产通配路由。
此 Cloudflare zone 变更尚未执行。

采用 Tunnel 前还需：确认 ingress 指向 8787；固定 dev0→C000001/test 注册表；
同步公开 URL、SSO callback/logout、Console issuer 和测试 Runtime 验签 issuer；
核验 cookie 为 host-only、不共享 `.huizhi.yun` 生产 cookie；配置开发者访问限制，
不把开发入口无保护暴露公网。Worker→Worker 仍用 Binding，不经 Tunnel 自调用。
测试 Platform HTTPS 凭证、Runtime transport 与业务端到端验收仍待完成。

### 当前可复现命令

使用 Node 24.18.0，在仓库根目录：

```sh
node deploy/test-env/local-workers.mjs check
node deploy/test-env/local-workers.mjs build
node deploy/test-env/local-workers.mjs smoke
# 另一个终端，仅检查 HTML transport
node deploy/test-env/local-workers.mjs verify
```

`smoke` 前台运行，Ctrl-C 停止；不会操作原 3000/3007 服务。当前本机地址为
19090，经既有 Tunnel 由 `https://hzy0.isme.dev` 访问，不能用此 smoke 模式访问业务数据。

### 2026-09-06 真实集成接线（验收进行中）

- 入口固定为 `https://hzy0.isme.dev → Tunnel → 127.0.0.1:19090`，未修改线上 Tunnel 或生产 Worker 配置。
- 每个 Worker 使用独立目录的 `wrangler.json` / `.dev.vars`；后者权限 0600，位于忽略目录。
- 启动器分别运行三个 `wrangler dev` 进程，端口 19090/19091/19092 仅监听 loopback，Service Binding 通过 Wrangler 本地注册表连接。不能使用一个 `wrangler dev -c gateway -c console -c people`：当前 Miniflare 的静态存储服务名未区分 Worker，导致 Console 资源 manifest 存在但静态存储 404，最终返回 500。诊断时对本机包缓存添加的临时日志已撤销。
- Gateway 和 Console 持有测试 Platform 内部凭证；People 只有本地 Gateway 信任凭证，不持有 Platform 或数据库凭证。
- Gateway 向测试 Platform 获取短期 Runtime bootstrap Token；本地适配器在校验租户、环境、部署及 Gateway 身份后，将占位 Runtime 地址映射到 SSH 隧道 `127.0.0.1:18080`。生产 Gateway 不放宽 loopback 校验。
- 仅修改既有 `wiztek/hzy_local_console` SSO 客户端，增加新入口的回调、登出回调和 origin，保留旧值。测试 Runtime JWT issuer 改为 `https://hzy0.isme.dev`；旧 Node 入口不再是当前测试 issuer。
- 远端备份：`/wiztek/hzy-test/backups/worker-identity-1788713282932`。`align-worker-identity.mjs --execute` 仅允许已确认测试主机和测试绑定。
- 已验证 discovery 返回新 issuer，Console/People 未登录权限请求返回 401；HTML 200 不代表业务验收完成。静态资源、真实 SSO 登录、授权后数据读写和重复刷新仍需继续验收。

本轮验证补充：

- 分离进程后 Console JS 返回 200；People 静态资源按 `/people/` 前缀打包到独立 assets 目录后返回 200。
- 本地 Console 浏览器已正常渲染工作台并读取现有测试会话；这不是新域名全新 SSO 登录验收。
- People 授权跳转至 Console 后返回 `invalid_redirect_uri`：测试授权客户端仍需登记 `https://hzy0.isme.dev/people/api/auth/oidc-callback`，并同步测试应用导航 URL；不应放宽 redirect URI 校验。当前应用导航仍含 `hzy-test.wiztek.cn`。
- 公网 Console 旧构建资源为 `CF-Cache-Status: HIT` 的 500；相同资源加新查询参数及本机直连均 200。当地 Tunnel 管理凭证对精确资源 URL purge 返回 401，未清理任何缓存，需要有权限的用户清理 **仅 hzy0.isme.dev** 的缓存。
- 本地 Gateway 响应统一 `Cache-Control: no-store`，防止后续构建/错误再被缓存；生产缓存策略未修改。
- Gateway 和本地配置自动测试共 38 项通过，`git diff --check` 通过。未完成 People 登录后数据读写验收，也未对生产发布。

使用已建立的 Runtime SSH 隧道，在 Node 24 下：

```sh
node deploy/test-env/local-workers.mjs provision
node deploy/test-env/local-workers.mjs start
```

`provision` 通过 SSH 捕获测试上下文，不打印凭证；更改凭证后重启 `start`。
不要在已 provision 的目录运行 `smoke`：它会拒绝覆盖凭证。
`verify` 目前只验证 HTML transport，不能作为业务验收结论。

### 2026-09-06 登录与部署绑定修复

- 用户清理域名缓存后，公网 Console JS/CSS 已实测 200 / BYPASS；本地响应保持 no-store。
- `align-worker-site.mjs` 将唯一活动的 `wiztek-test` 站点改为 `https://hzy0.isme.dev`，发布测试 bundle `pv_test_20260906172623_0007`。备份：`/wiztek/hzy-test/backups/worker-site-1788715557446`。Console 从签名 bundle 生成 People 精确回调，不放宽 redirect URI 校验。
- 本地 Runtime 适配器允许生产 Gateway 在 `/oauth/token` 的 POST 中保留经过认证的 People 调用方部署，其他路径/身份仍拒绝；已补回归测试。
- 浏览器已验证 People OAuth token 200、callback 302、权限 200、员工查询 200（92 条测试记录）。未修改员工数据。
- 目录调用进一步暴露 Runtime `service-client-policy` 硬编码 `<tenant>-console` 的问题。曾尝试精确补齐测试授权绑定，但 Runtime 身份初始化覆盖该值，因此该数据库方案已废弃；备份 `/wiztek/hzy-test/backups/console-read-grant-1788716110646` 仅用于审计。正确修复是在 Console issuer 使用已经通过 Console target/source 认证的部署身份，不拼接部署名。
- 头像 OSS 未配置、Workflow 未启用等旁路问题独立记录，不通过扩大授权或恢复本地 DB fallback 解决。
- Runtime 修复构建 `0.3.215-test.2` 仅安装到 `hzy-test-data-runtime`，SHA-256 `b5def14b0ebe12ac5c1facf9abfff357d5528e8289fc938dc18806ca43423f87`；旧二进制 `/wiztek/hzy-test/runtime/hzy-data-runtime-before-test.2` 可用于回滚。未上传生产发布仓库、未修改生产服务。全部 Go 测试与 Gateway 39 项测试通过。
- 修复后浏览器登录态实测：`/people/api/directory/departments` 200、`/people/api/auth/permissions` 200、POST `/people/api/v1/employees:search` 200（总数 92，测试页返回 10 条）。未覆盖新增/编辑/删除或其他应用；不得将本轮读取验收视为完整业务回归。

### 2026-09-06 OSS 与合成部门清理

- 经用户指定读取 `account/.env` 的四个头像 OSS 字段，使用 Runtime 原生 Vault/Integration adapter 创建测试 `oss.default`，Secret 仅通过 SSH stdin 输入并由 Runtime 加密；本地 Worker 未持有 OSS 凭证，未接入项目文件桶。
- 实际读取既有头像收到阿里云 `403 InvalidAccessKeyId`，当前来源 AccessKey ID 无效；配置已落库但 OSS 尚不可用，需要有效凭证并通过正常 credential rotation 更新。未修改 OSS 对象或 Bucket 权限。
- 合成部门 `TEST-RD` 的乱码来自早期 `provision-identity.mjs` 的 SQL 字符集问题。按用户要求软删除该记录，仅解除 `test-user-001` 的该部门关系，保留用户和正式目录。备份 `/wiztek/hzy-test/backups/remove-test-rd-ICfgtH`，可恢复；部门接口实测 200 且不再包含 `TEST-RD`。

### OSS 凭证更新后的验证

- 用户更新 `account/.env` 后，使用 `test-oss-setup --rotate` 通过原生 Vault version / Integration credential rotation 更新测试配置，旧凭证版本保留。应用头像接口返回 `200 image/png`（11788 bytes），OSS 凭证故障已解决。
- `oss.default` 保持头像实际所在的 `wiz-rs`；新增 `oss.images` 指向 `wizimages`，endpoint 为 `https://oss-cn-qingdao.aliyuncs.com`，`bucketDomain=images.wiztek.cn`。各集成绑定各自 ownerKey 的 Vault secret，不向 Worker 暴露凭证。
- 当前头像在 `wizimages` 同路径返回 `404 NoSuchKey`，因此未切换旧头像路径、未复制对象、未修改 Bucket ACL；图片专用集成登记不代表旧图片已迁移或所有上传调用方已切换。

## 参考

- [多 Worker 本地运行](https://developers.cloudflare.com/workers/local-development/multi-workers/)
- [本地运行与绑定](https://developers.cloudflare.com/workers/local-development/)
- [项目模块合同](../../docs/MODULE_CONTRACTS.md)
- [测试环境现状](README.md)
# 2026-09-06 待办与应用目录请求修正

第四轮分段诊断：本地 Worker 显式开启 `HZY_PERF_TIMING_ENABLED=true`，Foundation `measureRequestStage` 仅输出阶段名与毫秒数的 Server-Timing；生产未开启。Console scoped API 冷请求 5722 ms，其中包刷新 3330 ms；紧接着热请求 717 ms，其中会话检查 594 ms、policy 计算 3 ms。授权包本地计算不是秒级瓶颈，默认 30 秒内存缓存失效后的同步刷新会引入控制面延迟。已合并同完整配置的并发 cache-miss 刷新，失败释放重试，未延长缓存/包有效期，未跳过会话撤销检查。员工查询随后两次 200（6409 / 2780 ms），热请求权限 675 ms、scope 1061 ms、Runtime HTTP 282 ms；样本不是受控性能对比，不能归因全部改善于单项修改。

历史阶段曾实现 R2 持久策略包与独立分钟同步（现在由 Runtime 数据库持久层替代，以下为该阶段验证记录），本地已开启，生产默认 memory 待迁移。普通授权/cache-miss 不再调用 Platform；5 分钟为同步新鲜度硬上限，不允许无限沿用旧包。Worker 重启后 scoped 请求 200，policy 阶段 23 ms、无 policy_refresh，验证持久读取；同步入口 200。高风险显式 fresh-policy 路径保留原约束。部署、首包预热、轮换和失效边界见 [持久策略包运行说明](../../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md)。未创建云端桶、未部署生产。

最终构建重启后员工查询两次 200（7423 / 2536 ms）；第二次基础权限 557 ms、scope 1055 ms、Runtime HTTP 269 ms。冷启动仍有身份/Runtime token 开销，不宣称全部性能问题已解决。Console 类型检查、修改文件 lint、策略/存储/同步信任及 Gateway/本地配置针对性测试通过；超龄和篡改失败关闭由自动化测试验证，未在生产进行断网或撤权演练。

第三轮员工页：未选部门时不依赖异步部门树，浏览器回归只观察到一次 employees:search（11923 ms，92 人）。员工范围与 standard_costs 范围并行读取，任一失败仍阻断转发；三个后续查询均 200（12319 / 8341 / 9469 ms，20 条/总 92）。15 项针对性测试、People typecheck 和修改文件 lint 通过。与此前 13–17 秒样本相比有所降低，但不是受控基准，仍需进一步分段定位剩余 8–12 秒，未发布生产。

第二轮：session bridge auth/me 与 session API 改走 Binding；OIDC 检查仅在单个 HTTP event 的相同身份/配置/网关上下文中合并，不缓存跨请求会话有效性。18 项针对性测试通过。重启后应用目录五次均为 200（7346 / 1312 / 1239 / 1310 / 1554 ms），热请求与上一轮接近，首请求仍慢；本轮不宣称冷启动性能已改善，未发布生产。

后续生产共用代码优化：OIDC 换票/刷新/userinfo/JWKS 优先走 Console Binding，userinfo 跳过重复通用鉴权但由专用处理器继续验签并检查实时会话；畸形 Token 返回 401。最终构建重启后应用目录 5 次均为 200，耗时 5904 / 1300 / 1267 / 1284 / 1515 ms，首请求仍有冷启动成本。缺失和畸形 Token 的 userinfo 负向实测均为 401。仅本地运行验证，未发布生产；不能把这组样本解释为生产加速比例。

当前拓扑仍只启用 Gateway / Console / People。显式设置 `NUXT_PUBLIC_WORKFLOW_ENABLED=false`，关闭共享侧栏审批入口及无效待办请求；未创建 Workflow grant，也未宣称审批能力已接入。

本地 `NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS=15000`，生产默认仍为 3000 ms，保留 Binding 和失败关闭。重新构建并重启后，应用目录连续三次返回 200（约 1588 / 1265 / 1287 ms）；HR 刷新后未发出 pending 请求，员工查询返回 200。冷启动还存在重复 OIDC userinfo 查询及较慢员工请求，超时配置仅为本地延迟容忍措施，不代表性能根因已完全修复。
