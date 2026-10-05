# C000001 Cloudflare 测试环境

## 2026-09-19 项目文档链候选（按用户要求暂停独立链路）

- **最新方向**：用户认为后续还要整合，不应继续大量投入 Codocs 打通。已停止联调与日志监听，不再推进控制面修复或增加 Codocs 功能；现有代码与测试部署保留为候选，不能标记业务链完成。后续先明确统一文档能力的整合边界，再评估复用，历史 TODO 不构成继续实施授权。
- 登录已恢复，真实用户 `zhouguangying` 可进入项目 257 文档页。修复未注册 `documents` 用户资源入口（恢复 `projects:view`，保留项目成员/经理关系判定）、`/aims` 服务路由前缀与 Host → Aims 受信上下文传递；未扩大用户角色。列表拒绝不再回退为成员可见，读取不修补 ACL；空文件夹对项目成员保留。新增明确加载失败提示，关闭列表自动重试。
- 当前阻断：Console 主体权限接口的实时签名策略刷新在 Worker 调用中超过 100 秒被取消；日志已确认服务身份、命令签名、目录身份均通过，未到策略包刷新完成阶段。本机对相同测试策略包接口只读请求 200，约 58.9 秒，有签名包返回；未证明根因为网络或控制面处理，未绕过 fresh-policy。文档链使用有界预算，同一请求的管理员快照合并，不跨请求缓存未完成 I/O。一次 Runtime 重启窗口另出现 token issue 502，之后本地/公网 health 200、匿名/伪造 Bearer 401 已复验。
- 最后部署候选：Console `da1ccdba-5d54-4197-82b7-c9c6b3bcec55`、Aims `75e3dee6-1bc9-4056-9306-1960d1dd933c`、Enterprise `0a2a8d2d-4df5-486a-bbab-7659d51af6ac`；Codocs 保持下述版本。Console/Aims 候选尚含无敏感字段的临时阶段诊断日志，本地源码已移除；暂停后未追加发布。Foundation 超时映射 503 与最后格式整理尚未重新发布。
- Runtime 已到 `0.3.219-test.document-chain.3`（`2026-09-19T16:38:00Z`），权限检查只留访问审计，不因列表读取创建策略。完整 Go 检查及实际 LaunchAgent 环境启动校验通过；上版备份 `deployments/document-chain-20260919-read-only-check/hzy-data-runtime.before`。本轮 Foundation 579、Enterprise 106（1 跳过）、Console 主体/签名相关 39、Aims 定向 8 项通过，Aims 类型检查通过。未创建成功业务测试文档，Markdown/附件/预览/下载/删除/权限编辑及移动端仍未端到端验收。

- 用户授权完成项目文档业务链，并允许从 `oa.wiztek.cn/hzy_console` 迁移必要存储参数。生产仅 SELECT；测试 `oss.default` 原凭证可解密且与生产相同，未复制或替换密钥。只补缺失的 region、recycleDays、bucketDomain、projectsEndpoint、projectsBucketName、projectsBucketDomain，保留测试原字段。工具：`import-production-document-storage.mjs`（默认 dry-run，`--apply` 明确写测试）。
- `verify-document-storage.mjs` 在 `codocs/test/C000001/document-chain-probe/<随机 UUID>.md` 实测 PUT/GET 字节一致，清理了自身一次性探测对象；既有生产对象未修改。测试仍共享生产存储凭证/桶，不等于存储资源隔离，业务验收只允许创建命名清晰的测试夹具。
- 文档页改为原完整页面；补宿主附件上传（10 MiB）、multipart Binding、固定 UUID 重试、跨跳 actor 校验与 Console 主体用途；Codocs 项目服务使用本应用 Runtime 身份。策略 GET 缺省不落库。
- 新 v2.11 grants、已有 v1.50/v1.55 初始化仅执行于 `hzy_console_test_local_20260910`。实际 `aims.runtime` 对 `codocs` 的 read/manage/create 与 cabinet read/upload/delete **组合** scope 签发 200；`codocs.runtime` 对 data-runtime 和 tenant-runtime 的 integration_config:view + credential_vault:resolve 组合签发均 200，限制 oss.default。
- 已发布测试 Worker：Console `8353ae9c-0144-4643-9574-6658af34cc66`、Aims `71503646-b81c-47a9-b0b8-399d60314251`、Enterprise `91ab3ea8-cdf5-4498-b797-ad48da3b7302`、Codocs `2621dc6c-9480-41d5-ab3c-5a405b3b339c`。Host 增加 Aims/Codocs Binding，Aims 增加 Codocs Binding；没有发布生产或改 Gateway secret。
- 本机 Runtime `0.3.219-test.document-chain.2`；全量 Go 检查及携带完整 LaunchAgent 环境的启动探测通过。此前版本备份在 `deployments/document-chain-20260919/hzy-data-runtime.before`，中间候选备份在 `deployments/document-chain-20260919-final/`。本地/公网 health、匿名/伪造 Bearer 401 已核验。
- 已通过 Foundation 579 项、Enterprise 105 项（另 1 项原本跳过）、文档相关 Aims 107 项、Codocs 原 239 项 + 新签名边界 3 项、测试部署配置 11 项。Aims 全量 tsx 测试 688/696；剩余 8 项位于本次未改的 catalog refresh、feature component、version development 测试及其旧 harness，不将其记为通过。模块默认 strip-types 脚本另有无扩展名导入失败，定向检查使用现有 tsx。
- **尚未全链验收**：此前 SSO 阻断已解除，当前状态以上方最新记录为准。后续整合方案确定前不继续独立链路验收；未索取密码、未伪造会话或扩大用户角色。

2026-09-09：用户授权搭建独立测试环境，未授权覆盖生产 Worker。

最新产品导航整合结果见文末「2026-09-13 产品工作区导航与业务整合」；下列早期待办属于当日历史记录。

## 已落地

- `cloudflare-config.mjs` / `build-cloudflare-worker.mjs`：独立测试构建，禁用 dotenv，输出到忽略目录 `.cloudflare-workers`；限定测试租户、控制面和 Service Binding，应用 Worker 无公网路由、无定时任务。
- Console 构建、Wrangler dry-run 通过；已上传 `hzy-test-console`，版本 `a40f9ab5-d7c3-4b9d-8596-cf75d8e1cc39`。通过专用 Gateway 接入公网测试域名。
- 国内测试服务器 Nginx 在 `hzy.wiztek.cn` HTTPS 虚拟主机增加 `/runtime/`、`/v1/` 到 `127.0.0.1:18084` 的代理。Runtime JWT 验证保持开启。
- 公网探测：`https://hzy.wiztek.cn/runtime/health` 返回 200，未认证 `/v1/console/profile` 返回 401。
- Nginx 修改前备份：服务器 `/wiztek/hzy-test/backups/cloudflare-nginx-1788963276/huizhi-yun.conf`。配置测试及平滑重载成功。

## 尚未完成

1. 产品中心真实用户登录后的应用权限与业务操作验收（测试管理员账号待明确）。
2. 业务应用测试 License（当前 pending）、新产品中心权限清单与 service grant 安装。
3. SchemaStatus 的实际授权调用及产品中心业务验收；Runtime 和三个新 adapter 已启用，健康检查通过。
4. 业务应用已构建并上传测试 Worker；跨应用具体 capability 授权安装和实际 token 签发核验尚未完成。
5. 产品中心数据库迁移、真实登录和端到端验收。

基础测试入口已经可访问并跳转 SSO；业务应用仍存在待解决的登录回调/授权问题，不能称为产品中心可用环境或部署验收完成。生产 Worker 未修改。

构建示例（Node 24）：`node deploy/test-env/build-cloudflare-worker.mjs console`。
部署前必须对生成的配置执行 Wrangler dry-run，禁止使用模块现有生产 `deploy:cloudflare` 命令。

## 本轮追加结果

- 专用 Gateway `hzy-test-gateway` 已绑定 `hzy-test.huizhi.yun` 及精确路由 `hzy-test.huizhi.yun/*`（覆盖匹配该测试域名的通配路由，未修改原生产通配配置）。
- Console、AIMS、Assets、Finance 测试 Worker 已发布，凭证用 Worker secrets 配置，未写入构建配置或日志。
- Console 激活状态已实际返回 `activated=true`，tenant `C000001`、deployment `wiztek-test-console`。
- 已通过受认证同步更新策略缓存；Gateway 仅启用每两分钟的策略同步，不启用业务 outbox/通知等定时任务。`POST /__test/policy-sync` 要求精确测试主机和 Gateway 凭证，拒绝未授权请求；边界测试通过。
- 真实 Chrome 浏览器访问根入口后跳转至 Wiztek SSO 登录页，redirect URI 为 `https://hzy-test.huizhi.yun/api/auth/oidc-callback`；尚未代入任何用户完成登录。
- Runtime issuer 已对齐测试域名，原配置备份 `/wiztek/hzy-test/backups/worker-identity-1788963384178`。旧本地站点 issuer 不再是运行中的 issuer。
- Platform 测试站点已对齐域名并重新签发测试策略包 `pv_test_20260909141848_0008`，备份 `/wiztek/hzy-test/backups/worker-site-1788963490371`。
- 新库：`hzy_aims_test_product_20260909`、`hzy_assets_test_product_20260909`、`hzy_finance_test_product_20260909`；只装 schema 与自带初始化记录，没有拷贝生产业务数据。
- 首次建库暴露两项问题：Assets 列级 `COMMENT=` 语法已修正为 `COMMENT `；Finance 需先安装 `20260710_finance_integration_operations.sql` 才能建立后续 dead-letter 外键，本次新库已按依赖顺序补齐。

## Runtime 与业务应用登记

- 已运行 `0.3.215-test.product-center.1`，AIMS、Assets、Finance、Console、People、Directory 均 `enabled=true` 且 `db=ok`。安装前校验 SHA256，备份 `/wiztek/hzy-test/backups/product-runtime-1788964520`。
- 临时传输包经过加密，服务器解密后验证二进制 SHA256；传输资产已从当前 Console 发布中删除，临时密钥和服务器加密包/未完成上传文件已清理。
- 修正测试 Runtime 的 systemd `Restart=always`：控制面绑定更新会正常退出以触发重启，旧 `on-failure` 曾造成停服。服务器用专用 drop-in 应用，仓库 unit 已同步。修复后服务 active，策略同步重新返回 200；后续部分手动同步发生 503，定时同步日志仍有成功读写，需继续核验策略刷新稳定性。
- `register-product-apps.mjs --execute` 只允许国内测试主机和 `hzy_platform_dev`，用现有 C000001 active subscription 注册 `C000001-test-aims/assets/finance`，license 状态保持 pending，未伪造有效 License。
- 新测试策略包：`pv_test_20260909144000_0009`。
- AIMS、Assets、Finance 的浏览器登录探测目前在 Console OAuth 返回 `invalid_redirect_uri`，尚未完成新回调配置的落库/刷新核验。根入口 SSO 跳转已验证，不能代替业务应用登录验证。
- 未部署的 Altoc、Codocs、People、Workflow 等测试路径明确返回 503，防止 Gateway 回落到默认生产 origin；相关测试通过。

## 最后复查

- Console 激活状态已返回最新 `pv_test_20260909144000_0009`，`activated=true`、`lastError=null`；先前读取旧版本的现象与缓存刷新有关。
- AIMS、Assets、Finance 的既有 OAuth client 缺少新测试站点 redirect URI。已在独立 Console 测试库为三个现有 public client 添加精确的测试 callback/post-logout URI（source=local），保留既有配置；未增加通配回调或关闭 URI 校验。备份 `/wiztek/hzy-test/backups/product-callbacks-1788965245`。
- 测试管理员账号尚未指定；不申请密码，不代替用户完成真实身份登录。产品中心新权限、service grant、测试 License 以及 PC16–18 的未部署协作应用仍须继续完成，不能据基础设施健康宣称业务验收通过。

- 最后浏览器复查：AIMS、Assets、Finance 在 390px 视口均已正常跳转 Wiztek SSO 登录页，先前 `invalid_redirect_uri` 已消除。尚未验证提交真实账号后的回调和业务操作。

## 测试管理员与服务授权（2026-09-09 续）

- 用户指定 `zhouguangying`；已核对测试控制面主体 #80 active，已有 AIMS、Assets、Finance、Console 管理员角色，未重复新增管理员分配。
- 现有 AIMS 管理员角色没有新产品中心权限，需要导入当前 Manifest 并按产品角色补齐；不能把现有管理员名称等同于新功能已授权。
- 已打开用户 Chrome 的测试 SSO 登录页，等待用户本人登录；不读取或索取密码。
- 已用 `provision-product-clients.mjs --execute` 在独立 Console 测试库创建五个精确运行服务账号（AIMS、Assets、Finance、Codocs、Altoc），沿用既有凭证哈希存储方式。凭证仅保留在服务器保护目录；前三个 Worker 的应用专用服务凭证已通过 Cloudflare secrets 配置。后两个应用仍未启用，不代表其链路可用。
- 产品中心生成器漂移检查通过；Seed 安装后 Verify **236 行、0 FAIL**。备份与报告 `/wiztek/hzy-test/backups/product-grants-1788965778`。这证明数据库授权记录满足条件，不等同于全部端到端授权验证。
- 实际 AIMS → Assets `assets:product:read` Token 签发返回 200，tenant/source/target 匹配。Runtime audience 探测须按 Foundation `tenantRuntimeTokenScope` 转换成协议 scope；直接发送语义 scope 的初次探测正确被拒绝，未修改服务校验。

- 已按 Foundation 协议格式完成 AIMS、Assets、Finance 在 `data-runtime` 和 `tenant-runtime` 双 audience 的 6 组实际 Token 签发，全部 HTTP 200，tenant/deployment/source/target 匹配。报告只保存脱敏结果，不保存 Token。

## 产品中心入口权限修复（2026-09-09）

- 当前 AIMS Manifest 经测试 Platform 标准注册流程导入，manifest #36、release #30，物化 13 个角色、158 条权限。
- 为测试主体 `zhouguangying`（#80）分配租户角色 `test_product_manager`（#127），映射标准 `aims:product_manager`；保留原角色，不授予发布者权限，不使用通配权限。
- 新测试策略包发布与 Gateway 策略同步均返回 HTTP 200。
- 真实登录 Chrome 的 `/aims/api/auth/permissions` 已返回 `test_product_manager` 和 `products:view/edit/admin/archive/restore`，同时包含目标、优先级、路线图、功能、版本权限。此前入口缺失与新增权限未安装/分配有关。
- 页面加载过程中仍观察到 Console auth/me、运行配置和 JWT 验证超时；需单独核验稳定性，不能把本次权限修复视为全部业务验收完成。
- 真实 Chrome 最终确认 `/aims/products` 已显示左侧“产品中心”及产品筛选/列表区域，入口可见问题已修复。但列表报 `Aims tenant-runtime is required for /api/v1 data access.`，业务数据链路尚未就绪，不能宣称可正常管理产品。

## 产品中心数据路由修复

- 根因：AIMS 通用 tenant-runtime 中间件未登记产品中心专用 BFF 路由，在 scoped authorization 与专用 Runtime 命令处理器执行前返回通用 503。
- 产品中心 `/products`、`/product-permissions`、`/product-candidates` 由对应 BFF 处理；未知相似路径仍失败关闭，未修改权限与 Runtime 认证。
- 新增路由回归测试，相关路由、范围授权及列表输入共 10 项通过。产品扩展检查 292 项中 290 通过，2 项已有 catch-all 测试桩缺少新依赖（productItemObjectivesRuntime、productAdoptionRuntime），尚未通过。
- AIMS 构建与 Wrangler dry-run 通过，仅发布 `hzy-test-aims`，版本 `e99c58f3-c3df-414b-a241-76685adf7b6e`。
- 真实登录验收：Chrome 产品页已正常显示筛选、空列表及“共 0 个产品”，原 Runtime 不可用错误消失；Worker 日志确认产品列表和产品权限接口均 HTTP 200。未登录同一列表接口返回 401。
- 当前测试库无产品空间且目录尚未刷新，页面如实显示初始化状态；这与此前的运行服务错误不同，尚未执行产品创建、目录刷新及写操作验收。

## OA 产品目录迁移（2026-09-09）

- 用户授权从 `oa.wiztek.cn` 迁移相关产品目录数据到当前 C000001 独立测试环境。
- 源 `hzy_assets` 只读导出，目标 `hzy_assets_test_product_20260909`：`product_assets` 53 行、关联所需 `technology_bases` 1 行、`product_asset_bases` 1 行；产品线等分类沿用主档原字段。
- 使用 `import-product-directory.mjs` 显式目标校验、空表保护、事务写入和外键校验，保留编码、ID、负责人、时间和关联；未覆盖现有业务行、未修改源库。
- 导入前快照、回执和校验报告：`/wiztek/hzy-test/backups/product-directory-1788971310527`。源导出仅存受保护文件，不纳入 Git。
- AIMS 源库另有 3 个历史版本、3 条版本功能、7 条日志和 1 条项目产品关联。本次产品目录迁移不复制这些旧项目 ID；迁移版本历史需单独映射所属项目、里程碑和功能关系。
- Assets 主档导入不等同于启用 AIMS 产品空间，目录刷新与空间接入仍按既有受授权流程执行。

## Assets 登录回调路由修复（2026-09-09）

- 根因：Gateway 的 `APP_SERVICE_BINDINGS` 缺少 assets 映射，虽已部署测试 binding，实际 Assets 请求仍走默认非测试 origin。测试授权码回调失败后，错误页的 X-Frame-Options DENY 进一步导致 Shell iframe 拒绝显示；不能通过关闭防嵌入响应头解决。
- 补齐 `assets -> HZY_ASSETS_SERVICE`，并为测试 Assets/Finance 配置不可路由的 `.test.invalid` origin，避免缺失 binding 时回落生产默认地址。
- Gateway 34 项测试通过；新增 Assets 页面、登录回调和 API 三条路由验证，断言目标 app/deployment/prefix 与 tenant，拒绝浏览器伪造上下文。测试包装层隔离/认证测试通过，Wrangler dry-run 通过。
- 仅发布测试 Gateway，版本 `e7b4a7bc-3ea9-432d-ad23-6411ec373ab6`；生产 Worker 未发布修改。旧授权码不重放，使用新登录流程验收。
- 真实 Chrome 验收完成：Shell 内 Assets 产品台账正常加载，显示产品主档 53 条、技术底座 1 条及分页；测试 Assets Worker 已收到实际页面、认证和数据请求。原 503/iframe 拒绝显示已消除，未放宽 X-Frame-Options。

## 产品总监与产品经理企业角色

- 用户请求新增产品总监，并补齐角色列表中的产品经理。Manifest 新增 `aims:product_director`，包含 36 个产品治理动作（含精确 onboard），不包含版本验收、发布、重新打开版本和永久删除。现有 `aims:product_manager` 40 个动作保持独立验收职责。
- 同步 Platform AIMS SQL 角色种子与当前 Manifest，消除旧产品角色重复/漂移；角色定义、范围隔离、接入及列表授权相关 18 项测试全部通过。
- 测试 Platform 标准 Manifest 注册物化 14 个应用模板。企业角色 #127 从 `test_product_manager` 规范为 `product_manager` / 产品经理，保留账号分配并明确各动作 `product:manager` 范围。
- 企业角色 #128 `product_director` / 产品总监，可分配、active、app_code NULL，映射标准应用角色；逐动作显式 `tenant:global` 范围，已分配测试账号 `zhouguangying`。原有其他角色保留，普通权限合并模式不变。
- 可重复执行的精确测试环境安装脚本 `provision-product-roles.mjs` 不操作生产控制面。
- 发布新测试权限包并同步 Gateway，均 HTTP 200。数据库回读确认两个正式角色 active、is_assignable=1、app_code NULL；产品经理 40 条明确范围，产品总监 36 条明确范围。
- 真实登录 Chrome 确认 `zhouguangying` 的产品接入页面已显示“接入产品空间”和“启动目录刷新”，新增 onboard + tenant:global 权限生效；本轮未启动实际目录刷新。

## 目录刷新 403 修复

- 用户接入权限已生效且批次已创建；实际拒绝在 Assets 读取自身 Runtime 时发生。
- 第一处：Console `service-client-policy` 硬编码 `<tenant>-<app>` 覆盖精确测试 deployment。修复后保留已验证的本应用绑定；服务身份、授权策略、撤销、校验与生命周期 26 项测试通过。实际 Assets 在 data-runtime/tenant-runtime 双 audience 的精确组合 scope 均签发 200，并验证 deployment 为 C000001-test-assets。
- 第二处：Runtime 将 `sub=client:assets.runtime` 当作 service client ID，目录要求 `assets.runtime` 因而拒绝。中央受信上下文改为优先使用经验证的 ClientID，legacy 缺失时才保留 Subject；query/body 的伪造字段覆盖测试通过。server、auth、assets、aims 四个 Go 测试包全部通过。
- 国内测试 Runtime 已更新到 `0.3.215-test.product-center.2`，备份 `/wiztek/hzy-test/backups/catalog-runtime-1788984641258`，安装前 SHA256 验证通过。加密临时传输资产及本地临时密钥已移除，最终 Console 版本 `7516606b-ad1a-40ba-9475-07e2c0189e6d`。
- 实际服务链路复验：Assets 两种 Runtime audience Token 均 200；AIMS → Assets 目录 Token 200；Assets 产品目录 API 返回 HTTP 200、code=0、total=53。原服务身份 403 已消除，旧目录批次可继续。

## Cloudflare Workers Free CPU 限制（2026-09-10）

- 用户截图 OAuth authorize 报 Error 1101；实测 Console 多个请求的 outcome=exceededCpu，异常 `Worker exceeded CPU time limit.`，cpuTime=10ms，包括 auth/me 和独立 policy-bundle sync。
- 持久化策略最后同步 1788994844905，复查 1789000786218 时已近 100 分钟未更新，超过系统 5 分钟新鲜度要求；因定时同步被中断，普通权限请求失败关闭为 503。未延长策略有效期或绕过激活校验。
- 手动认证同步有一次返回 200，但不代表稳定恢复。将测试 Console cpu_ms 临时设为 1000 后，Cloudflare 拒绝部署：100328 / CPU limits are not supported for the Free plan。该发布未生效，生成配置已撤回限额。
- CPU 超限已确认，但尚不能据此认定必须升级套餐或迁移服务器；先对比同账户生产的部署和策略链路，定位测试环境额外开销。稳定性尚未验收。

## 同账户生产 Console 只读对照（2026-09-10，按实际流量版本修正）

- 实际生产 custom domain `console.huizhi.yun` 与生产 Gateway 的 `HZY_CONSOLE_SERVICE` 均指向 `hzy-console-prod`。直接查询 `hzy-console` script 返回 404。
- 以 deployments 的 100% 流量 version_id 查询 `/workers/scripts/{name}/versions/{id}`，才能获得本轮对照所需的正在运行版本配置。此前通用 `/settings` 与 script 下载所见并不代表生产回滚后的活动版本；据此作出的“两边都启用 runtime、关键缓存代码一致”判断撤回，下载代码的体积及函数比较也不作为活动版本对照证据。
- 生产实际活动版本 `81ad528b-3c5f-45ea-91d3-3deb554174cb`：`HZY_PLATFORM_BUNDLE_CACHE_BACKEND=memory`；首次部署于 9 月 4 日，9 月 7 日回滚重新启用，备注 Restore service: rollback policy persistence regression 2026-09-07。
- 测试实际活动版本 `7516606b-ad1a-40ba-9475-07e2c0189e6d`：`HZY_PLATFORM_BUNDLE_CACHE_BACKEND=runtime`，内存 TTL 300000ms。
- 两个活动版本同账户、usage_model=standard、compatibility_date=2026-05-23、nodejs_compat；生产具有 `HZY_PLATFORM_SERVICE -> hzy-platform`，测试平台地址为 https://hzy.wiztek.cn，没有该 Service Binding。套餐差异不是已发现原因。
- 实时各采样 45 秒：生产 15 个事件，没有 exceededCpu，但有 4 个 runtime/apps 配置请求约 5 秒后 canceled；测试独立 policy-bundle sync 再次 exceededCpu（cpuTime=10ms，wallTime=2629ms）。所有 tail 已停止，仅保留受保护本地原始日志，不输出凭证。
- 公网只读验证：`wiztek.huizhi.yun/api/activation/status` 返回 activated=true、bundleReady=true，lastCheckedAt=2026-09-10T01:03:13.706Z；测试同一路径返回 error code: 1101。
- 测试 Runtime 策略快照约 548981 字节，最近同步 2026-09-10T00:40:21.179Z。OA 生产快照约 630341 字节，停留在 9 月 7 日，与生产回滚后使用 memory 模式的事实相符；不能用该旧快照认定生产当前策略过期。
- 测试额外链路已由代码确认：冷缓存时 `readActivationStatus` 内部调用 `readCachedBundle`，而 `policyAuthorization`、`loadActivationStatus` 又并行调用二者，可能同时读取、解析两份完整持久化包；独立同步经 Platform 验签后还需 Runtime 读取旧包、CAS 写入以及状态回读。该路径包含服务令牌获取、JSON/HMAC 处理和网络调用，生产活动版本的 memory 后端不走这套持久化读写。
- 故障链路：测试独立同步 CPU 超限 → 快照超过 5 分钟新鲜度 → 普通授权失败关闭；请求自身 CPU 超限又会直接导致 Worker 错误。`auth/me` 不直接读取策略包，故尚不能把所有超限都归因于重复包读取，精确 CPU 热点仍需单独定位。
- 本轮仅排查与记录，未修改生产、未变更套餐、未部署测试。生产对照证明应先修复/验证测试持久化链路，而不是直接要求升级。不得通过延长策略有效期、关闭验签或绕过授权恢复页面。

## 策略持久化开销优化（2026-09-10）

- 同一请求、相同 scope/完整性密钥的并行冷读取合并为一次 Runtime 读取与完整性验证；未完成 I/O 不跨 Worker 请求共享，失败后允许重新读取。
- CAS 返回已验证的胜出记录，同步后直接更新内存，省去一次整包 Runtime 回读；保留较新本地版本，防止较早读/写完成时回退缓存。重试复用编码，遇到已有较新记录时不再编码落败的包。
- 内存截止不越过原始同步时间加 5 分钟或策略自身 expiresAt；未改变签名/HMAC、租户 scope、服务授权或普通请求不访问 Platform 的规则。测试仍使用 runtime 后端。
- 回归测试 27 项通过，包括冷读取次数、同步后读取次数、CAS 较新版本、并发请求隔离、错误后重试、过期、篡改、scope 和服务身份绑定。Nuxt 构建、Wrangler dry-run、变更空白检查通过。
- 仅发布测试 Console：`f696312e-df39-4e34-a05b-8c7112f089db`，生产未修改。
- 两次手动独立同步均 200，CPU 97/72ms；前两个定时同步均 outcome=ok，CPU 48/50ms。不能将不同冷/热状态采样直接换算为 CPU 降幅，也不能以一次成功保证长期没有 Free 限额错误。
- 实际 Chrome 产品接入页显示产品中心入口、“接入产品空间”、“启动目录刷新”；激活接口 activated=true、bundleReady=true；真实 AIMS → Assets 目录 API 返回 200、code=0、total=53，Assets 双 audience 令牌探测均 200。
- 追加 320 秒持续观察：24 个事件全部 outcome=ok，包含 3 轮定时同步（48/50/55ms），未复现 exceededCpu；采样结束已停止 tail。该证据仅覆盖本次观察窗口，不代表 Free CPU 预算已获得长期余量。

## AIMS 首页应用菜单缺失复发（2026-09-10 上午）

- 真实请求确认：登录 auth/me 返回 200，但 Console `/api/user/applications`、`/api/v1/console/user/permissions` 与用户应用目录返回 503；激活状态无可用策略包。测试 Gateway 的 */2 分钟调度仍存在，手动同步可恢复，但上一轮短时优化验收未证明长期同步可用。
- 将测试 Console 切回实际生产版本采用的 `memory` 策略模式，缓存缺失仍经现有受验签 Platform 冷加载路径，保持请求上下文隔离和既有权限判断。不是关闭鉴权，也不是宣称 Runtime 持久化稳定性已修复。持久化优化代码保留；后续重新启用需独立验证长期调度可用性。
- 测试配置事实源 `cloudflare-config.mjs` 显式设置 Console 后端为 memory，避免下次构建再次意外启用 runtime。Console 发布版本 `b0656aff-a644-40a2-87c7-eebdbc22f479`，生产未修改。
- 同时发现 AIMS 通知摘要 522：Foundation 用户通知代理使用公网 fetch。改用 `consoleServiceFetch`，复用已有 Console Service Binding，保留用户凭证、过滤参数、幂等键及错误状态。AIMS 发布版本 `80d2905a-e813-4733-a363-d69b1879483d`。
- 策略相关 12 项、通知及 binding 相关 12 项测试通过；两次发布 dry-run 通过，AIMS 构建通过。浏览器确认最左侧应用菜单与产品中心入口恢复。
- 发布后实际请求：Console 与 AIMS 的 applications/permissions 均 200，Shell 通知摘要 200；另在 AIMS standalone 页面打开通知中心，`/aims/api/notifications` 返回 200，界面显示“暂无通知”，原公网代理错误未复现。最终主标签页保持正常应用导航；临时诊断页已关闭，所有 tail 已停止。

## 退出后切换 SSO 用户（2026-09-10）

- 修复退出页 restartLogin 提前清除 logout marker 后丢失重新认证意图的问题：保留 prompt=login 到登录入口，立即启动可用 provider；显式重新认证不复用 Console 当前会话直接跳回应用。
- 上游 OIDC 在显式 prompt=login 或退出标记 + force=1 时附加 prompt=login、max_age=0。正常 SSO 跳转不强制重新认证，state/nonce/PKCE 不变。
- 4 项回归测试、Console 构建及 Wrangler dry-run 通过。仅发布测试 Console `e8038396-6f4b-44ee-b9bb-34710a1a8cca`，生产未修改。
- 实际 Chrome 验收：退出到 logged_out 页面；新版“重新登录”进入 /login?prompt=login，再跳转 Wiztek SSO，确认 URL 包含 prompt=login&max_age=0，显示空的用户名/密码输入框。保留该页供用户选择账号；未输入凭证或代替用户完成另一个账号登录。

## 2026-09-10 产品中心统一列表

- 测试 AIMS Worker：`07b8423f-6032-4f58-9e18-0cac3bff0f5c`；测试 Runtime：`0.3.215-test.product-center.3`。C000001 身份、测试库与服务 health 已核验；不涉及 DDL 或生产发布。
- Runtime 原二进制备份：`/wiztek/hzy-test/backups/unified-products-1789047077186/hzy-data-runtime`。加密传输资产已从最终 Worker 移除，临时本地密钥已清理。
- 当前登录会话已实际显示 53 条同步产品，第三页与总数一致；按 `HZ-TY-S-002` 搜索只返回“汇智云”一条。启用弹窗选中对应产品，缺经理／原因时提交禁用，未代用户分配经理或批量启用。
- 一次点击“开始同步”自动完成批次 `7e71e9ed-d660-56ab-b81c-5a395354f61f`，显示同步成功 53/53，列表更新时间自动变化。浏览器未捕获控制台错误。
- 桌面 1440px 和手机 390px 检查；手机列表改为产品／操作两列，状态与产品线折入产品信息，避免按钮横向截断。

### 产品列表滚动修复

- 测试 AIMS Worker 更新为 `b457a0c6-e387-4f5d-93ca-1e276cb1622f`。页面根容器增加 min-h-0 / flex-1 / overflow-y-auto，解决父布局裁切长列表及分页的问题。
- 发布遇到 CF 64 个变量限制，AIMS 测试配置移除 7 个未被 AIMS / Foundation 使用的 HZY_*_URL 别名，保留实际 *_API_URL、NUXT_PUBLIC_*_URL、目标部署身份与认证配置；当前普通变量 59 个。
- 页面 ESLint、Cloudflare 构建与 dry-run 通过；无需数据库或 Runtime 变更。
- 真实浏览器滚动验收通过：桌面容器 681px / 内容 1425px，滚动到 743.5px；手机 390px 视口容器 798px / 内容 2133px，滚动到 1334.5px。两种视口均实际看到最后一行与分页，已恢复正常视口。

### 产品详情及子页面滚动

- 测试 AIMS Worker：`bcf4a1c5-646e-41a9-a7a1-731a311305c0`。新增 products.vue 作为产品路由共同滚动容器，覆盖列表、详情及所有产品子路由；列表去掉重复滚动设置。
- 页面 ESLint、Cloudflare 构建及 dry-run 通过，无数据库或 Runtime 变更。
- Nuxt 类型检查通过。实际 HZ-TY-S-002 详情滚动验收：1440px 桌面容器 654px、内容 858px，可达成员表及分页；390px 手机容器 798px、内容 1041px，scrollTop=243.5px 可达底部。成员表保留横向滚动。

## 2026-09-10：测试数据库与 Runtime 迁到本机

当前运行事实以 [LOCAL_RUNTIME.md](./LOCAL_RUNTIME.md) 为准。5 个库、271 张表已迁到 Mac MySQL；Runtime 版本 `0.3.215-test.local-runtime.1`，Gateway 指向 `https://hzy-test-runtime.isme.dev`。原国内测试服务已停止并禁用自启动，源库与完整快照保留。真实登录会话产品列表 53 条、已启用产品与经理关系、目录同步 53/53 均已通过；匿名／伪造令牌接口返回 401。当前用户登录后 LaunchAgent 自动启动 Runtime 和专用 Tunnel，本机需保持开机联网、不休眠。

## 2026-09-10：产品工作台布局发布

- 发布 Claude 的产品身份栏、三个工作视角、二级导航与更多菜单、独立设置页及共享工作台数据读取。测试 AIMS Worker：`5616885d-6965-4458-be74-4085e7d4924f`。
- 本机 Runtime 更新为 `0.3.215-test.local-runtime.2`，补充工作台读取中的产品名称及产品线字段；原二进制备份在本机运行目录。无数据库迁移，health 正常。
- 13 项前端测试、AIMS Go 测试、Nuxt 类型检查、CF 构建及 Wrangler dry-run 均通过。
- 真实登录会话验证：汇智云名称与编码、产品与研发二级导航、更多菜单、设置页成员关系、产品切换器及 53 条产品列表正常。概览采用客户为 —，按页面约定表示无权读取或读取失败，本次未将其视为有效零值。
- 桌面概览滚动 0→111px；手机设置页滚动 0→223.5px，成员分页可见。产品列表桌面滚动至 570.5px、手机至 1334.5px，均可达分页；手机 body 宽度 390px，无页面整体横向溢出。未捕获浏览器 error 日志。浏览器恢复正常尺寸并保留产品概览。


## 2026-09-11：需求管理内嵌规划发布

- 仅发布测试 AIMS Worker `hzy-test-aims`，版本 `7a0ae716-4359-4a4c-9dcb-63ebb1af57c1`，Cloudflare deployment 查询确认 100% 生效。沿用测试 Gateway / Service Binding，无数据库或 Runtime 更新。
- 产品与研发导航收敛为「需求管理」，建设范围和周期优先级作为需求内部流程；单条需求可带入来源创建建设范围。
- 测试专用构建、Wrangler dry-run、4 项测试环境隔离检查及 9 项工作台导航测试通过；此前受影响文件 ESLint、AIMS typecheck、1440 / 390 模拟 API 浏览器回归通过。
- 公网请求新版需求页 bundle `8_smnYWZ.js` 成功，SHA256 与本次构建完全一致。测试 Runtime health=ok，各已启用应用 db=ok。
- 真实浏览器刷新后原会话已失效，跳转 SSO 登录页；未输入凭证或修改业务数据。登录后的线上页面及保存验收待重新登录，不能以静态资源核验替代。

## 2026-09-11 产品线统一管理（测试 AIMS + 本机 Runtime）

- 本机测试 Runtime 先更新为 `0.3.219-test.product-line.1`（记录见 `LOCAL_RUNTIME.md`）；本机 AIMS 测试库已有 v5.37 两张新表，无 DDL。
- 仅发布测试 AIMS Worker `hzy-test-aims`，版本 `5ae33248-cadf-4def-bb34-c7b511d56776`（上一版 `7a0ae716`），源码为工作区 `bd15fff9` + 未提交的产品线改动。Manifest 仅改描述，无新动作，未重发策略包；Worker secrets 沿用。
- 发布前：AIMS typecheck 通过；全量测试 473 pass / 63 fail，63 个失败文件均未改动，原因是无扩展名 import 在 `node --experimental-strip-types` 下 `ERR_MODULE_NOT_FOUND`（存量）；全部变更/新增测试通过。ESLint 全量 2697 个存量错误分布在 32 个未改动文件，变更文件唯一 1 处已修正。Wrangler dry-run：59 个变量、仅 `hzy-test-*` Binding、无路由/触发器。
- 发布后：未登录页面 200、`/aims/api/v1/products` 401。登录 `zhouguangying` 实际浏览器：产品线列表 6 条（合计 53 个产品）、分页「共 6 条产品线」；展开 BDC 调用 `products?tree=true&childLine=BDC` 返回 200 并显示 17 个产品；页面 API 全部 200、无控制台错误；390px 无横向溢出。未点击任何「启用」按钮，未写业务数据。
- 未随本次发布：Assets 工作区中给产品采用 403 增加 `data.reason` 的改动。在其发布前，Assets 真实的用户数据范围拒绝会被 AIMS 归为服务侧拒绝（仍失败关闭，仅提示不准确）。
- 存量观察：AIMS 侧栏折叠且用户无项目时，`PortfolioTree.vue` 空状态未判断 `collapsed`，「暂无项目」在窄栏内逐字竖排。

## 2026-09-11 测试 Assets（产品采用路由修复 + 失败原因码）

- 仅发布测试 Assets Worker `hzy-test-assets`，版本 `c6ae2f23-286f-4bb6-95a4-679d456f13b9`（上一版 9-09 的 `e6910fdf`），因此同时带上 9-09 之后 Assets/Foundation 的已提交改动（`bd15fff9`、`df259ee7`、`5649dae9`）以及工作区中给产品采用 403 增加 `data.reason` 的改动。
- 首次发布被 Cloudflare 拒绝：`code 10055`，Free 计划每个 Worker 最多 64 个变量（text + secrets），Assets 为 66 + 2。线上旧版本同样有 66 个变量，是在限额生效前发布的。`cloudflare-config.mjs` 已把 AIMS 的无用 `HZY_<app>_URL` 别名裁剪规则扩展到 Assets（Assets 与 Foundation 只读取 `HZY_CONSOLE_URL`，服务地址走 `*_API_URL` / `*_SERVICE_URL` / `*_BASE_URL`），现为 59 个；`cloudflare-config.test.mjs` 增加上限断言，test-env 42 项测试通过。Console 原先生成 82 个变量 + 9 个 secret，重发会遇到同样的 10055；已按下节精简。

## 2026-09-11 测试 Console 变量精简

- `cloudflare-config.mjs` 为 Console 删除 34 个无读取方的变量：其他应用的 `HZY_<app>_URL`（7）、全部 `HZY_<app>_TARGET_DEPLOYMENT`（8，含 Console 自身）、除 Workflow 外的 `HZY_<app>_API_URL`（6）、`NUXT_PUBLIC_<app>_URL` 与 `NUXT_PUBLIC_ACCOUNT_URL`（8，Console/Foundation 的 runtimeConfig 无对应键），以及 5 个无引用开关（`HZY_COLLAB_ENABLED`、`HZY_SYNC_APPROVAL_ACTIONS_ON_STARTUP`、`HZY_CONSOLE_AUTH_CLIENT_MATERIALIZE_ENABLED`、`HZY_PLATFORM_BUNDLE_ALLOW_LEGACY_CACHE`、`HZY_PLATFORM_BUNDLE_CACHE_LEGACY_FALLBACK`）。现为 48 个 + 9 个 secret = 57。
- 依据：Console 跨应用只经受信 Gateway 路由（`directTarget`）并读取 `HZY_WORKFLOW_API_URL`；Foundation 非 directTarget 的查找只涉及 webdev 与 console 自身。保留按命名规则动态读取的 `HZY_CONSOLE_DATA_ACCESS_MODE`、`HZY_CONSOLE_SERVICE_CLIENT_ID`，以及由 runtimeConfig 隐式映射的 `NUXT_CONSOLE_USER_APPLICATIONS_TIMEOUT_MS`、`NUXT_PUBLIC_APP_CODE`、`NUXT_PUBLIC_APP_BASE_PATH`。
- 验证：test-env 43 项测试通过（含上限与必需变量断言）；测试 Console 构建与 Wrangler dry-run 通过；构建产物 server bundle 中不含任何被删除的变量名。**尚未发布**，线上测试 Console 仍为 `e8038396`。仅影响测试环境生成配置，`worker-config.mjs`（本地 Worker）与生产配置未改。
- 其余测试应用已同步精简（见下节）。

## Cloudflare 限额核查（2026-09-11）

- 变量上限 64（Free）/ 128（Paid），计入 secrets + text。这不是新数字：Cloudflare 文档源码在 2025-06 就已写明。Cloudflare 没有发布调整公告，也没有说明原因。
- 实际执行时间（依据本账户版本历史）：2026-09-10 12:47 UTC 仍接受 Console 91 个变量的版本，13:55 UTC 仍创建并部署了 AIMS 68 个变量的版本；2026-09-11 18:42 UTC 起拒绝 Assets 的 68 个变量（错误码 10055，变量集合与线上版本完全相同）。可见检查是在这两个时间点之间开始执行的。已存在的超限版本仍在运行，只有新上传会被拒绝。
- 发布包大小在 2026-09-04 另有官方调整（放宽）：取消压缩后大小限制（原 Free 3 MB / Paid 10 MB gzip），两种计划统一为未压缩 64 MiB。本环境 Worker 未压缩约 5.9–7.2 MB、gzip 约 2.1–2.6 MB，按旧规则已接近 Free 的 3 MB，按新规则余量充足。启动时间上限 1 秒和 Free 的 CPU 时间限制不变。

## 2026-09-11 测试 People / Finance / Altoc / Codocs 变量精简

- 这四个应用只精简了没有读取方的跨应用别名：非 Console 的 `HZY_<app>_URL`（7）、非 Console 的 `NUXT_PUBLIC_<app>_URL`（7，四个模块的 runtimeConfig 只有 `public.accountUrl`，因此保留 `NUXT_PUBLIC_ACCOUNT_URL`）、`HZY_<app>_TARGET_DEPLOYMENT`（Finance / Altoc / Codocs 删 8 个；People 读取 `HZY_CONSOLE_TARGET_DEPLOYMENT`，只删 7 个）。全部 `HZY_<app>_API_URL` 均保留，因为 Foundation 会动态回退到这些变量；所有开关也保留。
- 结果（文本变量 + 2 个 secret）：People 49 + 2 = 51，Finance / Altoc / Codocs 44 + 2 = 46；Console 48 + 9 = 57，AIMS / Assets 59 + 2 = 61。AIMS 读取 `NUXT_PUBLIC_*_URL` 及 Finance / Altoc / Codocs 的 target deployment，因此不做额外精简。
- 线上只有 `hzy-test-finance`（2 个 secret）；`hzy-test-people`、`hzy-test-altoc`、`hzy-test-codocs` 尚无 Worker，按业务 Worker 的 2 个 secret 估算。test-env 44 项测试覆盖全部应用的上限，并断言每个应用必需的变量仍在。四个应用均用精简后的配置完成测试构建与 Wrangler dry-run；各自删除的名称（People 21 个，其余各 22 个）在构建产物 server bundle 中均无出现。本次只改配置，未发布。
- 发布后探测发现 `bd15fff9` 的真实缺陷：`server/middleware/tenant-runtime.ts` 以 `pathname === '/api/v1/service/product-adoption/read'` 精确匹配，而 Gateway 与 Service Binding（业务应用 base path 为 `/assets/` 时 Foundation 不剥前缀）到达的都是 `/assets/api/v1/...`，请求落入通用 capability 表，返回 403「Unsupported Assets service endpoint capability」，AIMS 产品采用因此始终失败。已改为与同文件其他判断一致的 `/api/v1` 后缀匹配；`productAdoptionRoute.test.ts` 增加带 `/assets` 前缀用例（修复前复现同一错误）与相似路径拒绝用例。
- 检查：Assets typecheck 通过；全量测试 98 pass / 2 fail，失败仅为未改动的 `productCenterLink.test.ts`（无扩展名 import，存量）；改动文件 ESLint 通过；Wrangler dry-run 通过。
- 发布后：`/assets/` 200、用户 API 401；未登录或伪造 Bearer 访问 `product-adoption/read` 由采用处理器自身的 Console OIDC 校验返回 401（修复前为 403「Unsupported」）；`/read/extra` 等相似路径仍 403；Worker secrets 沿用。
- 未验证：登录用户在 AIMS 打开产品采用页面、经 Service Binding 调用 Assets 的端到端链路。

## 2026-09-11 产品列表改为项目列表同款树形表格

- `aims/app/pages/products/index.vue` 改用与 `projects/index.vue` 列表视图相同的原生树形表格（chevron + 文件夹图标 + 徽标 + 缩进子行），列为「产品线 → 产品 / 编码 / 管理状态 / 管理」；删除 `app/components/products/LineProducts.vue`（仅该页使用）。
- 去掉产品线与产品线下产品两层 `UPagination`。数据按接口上限 `pageSize=100` 逐页取完（最多 20 页），不是一次请求大 page_size；未取完时显示明确提示而不是静默截断。产品线下产品仍在首次展开时加载并缓存，筛选变化或刷新时清空。
- 测试 AIMS Worker：`a06448f3-a345-454f-ab45-caf42fb1a9f9`（中途 `10d6d14b` 为列宽修复前版本）。无 Runtime、接口或数据库改动。
- 验证：AIMS typecheck、改动文件 ESLint 通过；全量测试 473 pass / 63 fail，失败与基线相同且均为未改动文件的存量 import 扩展名问题。真实登录浏览器复验：1440px 下 6 条产品线、无分页控件，展开 BDC 显示 17 个产品（共 23 行），请求为 `pageSize=100` 各一次，无控制台错误。
- 390px 首版回归：固定列宽把名称列压到约 96px，产品名逐字竖排。已将表格最小宽度提到 50rem 并让编码/状态/操作列不换行；复验名称列 320px 正常单行，页面本身不横向滚动（390/390），表格在自身容器内横向滚动可见「管理状态 / 管理」两列。

## 2026-09-11 产品线统一管理：按选择接入、去掉启用原因

- 规则变更：产品线中已有产品被独立管理时不再整体阻塞，只要还有未被管理的产品即可统一（`can_unify` 由 `blocked == 0` 改为 `blocked < total`）。当前生命周期不允许接入的产品同样只约束自己，不再要求整条产品线全部 onboardable。
- 接口变更：`POST /api/v1/products` 产品线形态由 `{ productLine, managerUid, reason, expectedWatermark }` 改为 `{ productLine, managerUid, productCodes, expectedWatermark }`，去掉启用原因；`productCodes` 非空、不重复、最多 1000 个。目录证据仍是整条产品线，浏览器只能选择纳入项。Runtime `LineOnboardInput.Reason` 同步替换为 `ProductCodes`，只对所选产品做已管理检查并只为所选产品创建模块，审计记录改存所选编码。
- 弹窗改为复选框列表：默认勾选全部可选产品，提供全选/清空与已选计数；已单独启用管理的产品显示「保持独立空间」且不可勾选（状态取自 `products?tree=true&childLine=`），生命周期不允许接入的同样不可勾选；「启用原因」字段移除。
- 部署：本机测试 Runtime `0.3.219-test.product-line.3`（备份 `hzy-data-runtime.backup-20260911202503`），测试 AIMS Worker `0dfdd08d-2020-4540-be00-743f56a30c3a`。数据库无新增迁移。
- 验证：隔离 MySQL（专用 `/tmp/hzy-product-center.*` socket）下 `go test ./internal/apps/aims/...` 全部通过，新增「绕开已管理产品的部分统一」和「绕开不可接入产品的部分统一」两个用例；AIMS typecheck、改动文件 ESLint 通过，全量测试 474 pass / 63 fail（失败与基线一致）。顺带补齐 `product_handoff_integration_test.go` 缺少的 v5.37 迁移，该用例此前因新表缺失失败。
- 真实登录浏览器验证：TY 产品线（含 1 个已单独管理、1 个不可接入）现在显示「启用统一产品管理」；弹窗 5 个产品中 3 个可选并默认勾选，2 个禁用且点击无效，取消勾选后计数正确；1440 / 390 均无横向溢出。服务端拒绝实测：选中已管理产品 409「所选产品中已有产品启用管理」（Runtime），非本产品线 409（BFF），空选择 400。
- 未执行真实的统一启用写入（会创建产品线空间且无回退入口），happy path 尚未在测试环境实跑。

## 2026-09-11 产品线名称与未纳入产品的单独启用

- 产品线名称显示为编码的根因：Assets 界面的名称来自前端 `useAssetLabels.ts` 的硬编码兜底，而字典事实源 `asset_category_groups`（`category_scope='product'`）在测试库里是空的；给 AIMS 的目录 service 接口只读字典，因而只能返回编码。不是 AIMS 取值错误。
- 已向测试 Assets 库写入 8 条产品线字典（FC 智慧房产、BDC 不动产登记、TY 通用领域、JD 特定领域、NY 农业农村、GZ 公证处，以及用户提供的 HFZX 汇房智选、ZHWY 智慧物业和维修资金），`created_by='seed-claude'`。前 6 条取自 Assets 自带兜底，标签去掉了重复的编码后缀。Assets 目录查询已实测能解析全部 6 条在用产品线的名称。
- **仍需在 AIMS 点一次「同步产品目录」**：`product_catalog_projection.product_line_label` 当前仍为 NULL，刷新后名称才会出现在产品中心列表。字典也可在 Assets `/admin/asset-categories` 维护。生产环境如果同样没有该字典，AIMS 也会显示编码，发布前需核对。
- 规则变更：产品线统一管理只拥有实际纳入的模块。未被纳入的产品、以及之后加入该产品线的新产品，仍可单独启用产品管理；Runtime 去掉了按产品线拦截的两处检查，只保留「已是某统一空间的功能模块」的拦截。列表中原「待纳入统一模块」提示改为正常的「启用产品管理」按钮。
- 部署：本机测试 Runtime `0.3.219-test.product-line.4`（备份 `hzy-data-runtime.backup-20260911204348`），测试 AIMS Worker `a11ed60c-5553-4ddc-930d-e29f57373bc3`。
- 验证：隔离 MySQL 下 `go test ./internal/apps/aims/...` 全通过，新增/调整用例覆盖「统一线外的产品仍可单独启用」「被排除的产品可单独启用」，并修正了 sqlmock 中已删除的两次查询期望；AIMS typecheck、改动文件 ESLint 通过，全量测试 474 pass / 63 fail（与基线一致）。线上仍未做真实统一写入，因此「部分统一 → 剩余产品单独启用」的端到端链路未在测试环境实跑。


## 2026-09-12 轻量产品版本规划第一阶段

- 用户授权部署 CF 测试环境。发布 `hzy-test-aims` 版本 **`ababb3e9-0766-40f6-99fa-2b62947a07c1`**，部署 ID `b4e80e1c-1554-4e83-a8cb-333e7197cede`，时间 `2026-09-12T20:48:30Z`；部署列表确认 100% 流量。上一版本 `a11ed60c-5553-4ddc-930d-e29f57373bc3`。源码为 `bd15fff9` 加当前工作区规划改动及 Nitro 声明补丁。
- 本机测试 Runtime 更新至 `0.3.219-test.lightweight-plan.1`，SHA-256 `394622ce30e0d05a5986e09fbabfdac3c77e8bbbc1853fff851c30ea1fd18776`，构建时间 `2026-09-12T20:44:23Z`。本地及 Tunnel 公网 health 验证新版本、C000001 / test 身份及全部已启用数据库正常。
- 仅对 `hzy_aims_test_local_20260910` 应用 v5.38；迁移 SHA-256 `2141fc4c11d7d08e044d8a79946f3e2faa0993706eaf236e6ca0b3f39d822803`。校验新增 3 表 / 2 列，迁移前后产品空间 3、需求 10、版本 4、模块 43，旧版本全部保留 cycle。
- 迁移前完整 SQL 和旧 Runtime 位于 `~/Library/Application Support/HuizhiYun/test-runtime/deployments/lightweight-plan-1789246041797/`：`aims-before-v538.sql` 哈希 `f482dcf715ac9f2da7c5bd95c4ead6dfce89b6b0628ba1142bd8c6279a9c10c2`；`hzy-data-runtime.before` 哈希 `9d0fce8e34be5fcf85713942bfc3b30d31037a543463db74fa21b62db4046fd4`。配置和 secrets 未修改，未发布其他 Worker 或生产。
- 发布前检查：Node 24.18.0 Aims 全量 typecheck、测试 Worker 构建和 dry-run 通过。全部 Go 22 包通过，2942 测试／子测试通过，6 个未配置的其他集成用例跳过；产品领域及 adapter 使用真实隔离 MySQL。目标授权 verify 236/236 PASS；真实 Gateway 57/57 组服务令牌签发和 tenant / deployment / audience / scope 绑定校验通过，无需写 grants。
- 发布后：产品中心页面 200；匿名 Aims API、匿名 Runtime、伪造 Bearer Runtime 均 401。已登录 Chrome 确认 FC 空间新需求流程、模块筛选列表、轻量版本创建表单正常；负责人目录 `user-departments` 返回 400 后走组件回退并可列出人员，有 warning、无 console error。截图已查看，未创建或修改业务数据。
- 验证边界：本次未实跑真实租户创建 → 确认 → 转交写入全过程。隔离 MySQL 事务、BFF 合同和 mock UI 完整流程证据见 [第一阶段记录](../../aims/docs/Aims-Lightweight-Product-Planning-Phase1.md)。部署日志、脱敏回执及线上截图位于 `/tmp/hzy-phase1-qa-20260912`。
- 回退：测试 Worker 可恢复上述上一版本；Runtime 可恢复本次备份并重启专用 LaunchAgent。v5.38 为增量结构，可保留；产生新业务写入后不得直接覆盖为迁移前 SQL，恢复数据前需另行核对增量。


## 2026-09-13 产品线名称与首页下拉筛选

- 修复：产品树、中文名称搜索、统一工作区标题和产品切换列表优先使用 active 目录代次的产品线名称，接入时 `line_label` 仅作缺失回退。首页「产品线编码」输入改为可搜索下拉框，显示名称（编码），选项独立于搜索／状态筛选；全部、重置及 URL 恢复正常。空结果提示移到固定最小宽度表格外，手机可完整查看。
- 测试 Aims Worker `59f03e32-0155-4bae-a550-0bf52e581413`，上一版 `ababb3e9-0766-40f6-99fa-2b62947a07c1`；测试 Runtime `0.3.219-test.product-line-label.1`，SHA-256 `69a948c2bfcd2b59187d822c98ca30734ec5225e16cfde03dc9f23eff63e2d31`。没有新 Schema、grants 或跨应用调用。
- Runtime 原版 `0.3.219-test.lightweight-plan.1` 备份于 `~/Library/Application Support/HuizhiYun/test-runtime/deployments/product-line-label-20260913T125218Z/hzy-data-runtime.before`。本地与公网 health 返回新版本，全部已启用数据库正常。
- 验证：Aims typecheck、页面 ESLint、Node 24 测试构建／dry-run 通过；全量 Go 22 包通过（产品领域和 adapter 使用真实隔离 MySQL）。新增测试验证首次补齐／改名／空名回退、仅统一空间范围下的中文搜索／详情、无权限不泄漏及原接入快照不变。目标 Console verify 236/236 PASS、57/57 实际服务令牌签发通过。匿名 Aims API、匿名／伪造 Bearer Runtime 均 401。
- 实际 Vue 页面配模拟 API 的 Chrome 1440 / 390 检查：选择产品线、关键词无结果时选项保留、重置、重新加载后恢复选择、全部产品线；无 pageerror、无页面横向溢出，截图已查看。日志／脚本／截图在 `/tmp/hzy-line-fix-*` 和 `/tmp/hzy-line-filter-*`。
- 线上数据同步已完成：用户恢复登录后，经产品中心正常「同步产品目录」入口激活批次 `9c8e80f5-29f7-5be9-99d0-803910918204`，完整同步 53 个产品。只读回查 6 条产品线均有名称：智慧房产（FC，13）、不动产登记（BDC，17）、通用领域（TY，5）、农业农村（NY，3）、汇房智选（HFZX，12）、智慧物业和维修资金（ZHWY，3）。同步前这些名称均为空；没有直接改写跨模块数据库。
- 登录态最终复验通过：列表及下拉框显示名称；选择 FC 后返回 1 条产品线、13 个产品；按「智慧房产」搜索结果一致；进入 FC 统一空间后标题及产品线标签为「智慧房产」，编码仍为 FC。重置恢复全部 6 条。线上证据 `/tmp/hzy-line-fix-live-sync.json`、`/tmp/hzy-line-fix-live-workspace.png`、`/tmp/hzy-line-fix-live-dropdown.png`。

## 2026-09-13 产品工作区导航与业务整合

- 用户确认精简方案并授权 agent 分工。研发二级入口固定为「需求池 / 版本计划 / 产品结构」，默认需求池；模块树和功能清单同页联动。版本目标、范围、确认、研发交付及验收发布连续可达，矩阵／对比／跨版本项目汇总／高级周期规划收进局部工具，评分模型归设置；旧功能、模块书签及旧周期版本保留兼容路径。
- 仅发布测试 `hzy-test-aims`，最终版本 **`8d573b11-b6cf-4052-a4a0-d0d6bf7b5a41`**，部署 ID `ca037e19-6d57-40f3-9089-4878cdb41962`，`2026-09-13T14:38:20Z`，部署列表确认 100%。原版本 `59f03e32-0155-4bae-a550-0bf52e581413`；中间验收版 `5cb18802-b203-4b4f-9d35-81b43da3c562` 后补齐模块名称跳转展示。Runtime 继续使用 `0.3.219-test.product-line-label.1`，无数据库、grants、其他 Worker 或生产变更。
- 最终全量 Aims typecheck、改动文件 ESLint 通过；导航／列表响应式筛选／模块名称、规划 UI 和需求／版本输入 27 项，进入开发命令行为 3 项全部通过。Node 24 测试构建、dry-run 通过：59 个普通变量、既有 secrets、仅测试 Service Binding、无路由和定时任务。目标授权 236/236 PASS，服务令牌签发绑定 57/57 通过。
- 实际 Vue 配模拟 API，在 1440 / 390 验证全部主入口、模块功能联动、旧链接与筛选重置、名称刷新、简单计划锚点、周期流程、项目聚合和 GTM 保留；每种尺寸各 56 次 API 请求，无 pageerror / API 400+，页面无横向溢出，截图已查看。
- 真实登录 HZ-TY-S-002：需求池 10 条、功能 38 项；模块「租户与订阅」准确筛到 1 项功能，跳需求池保留模块筛选；版本计划 4 个历史周期版本、局部矩阵工具和研发交付页正常。1440 / 390 实际截图已查看，无 console error / warn，旧 `/features` 地址自动转到 `/structure`；匿名 API 401。真实租户未执行创建／进入开发／转交／验收发布写入，该边界不以模拟 API 代替。
- 实施记录：[产品工作区整合](../../aims/docs/Aims-Product-Workspace-Simplification.md)。本轮构建、发布、脱敏回执、浏览器脚本及截图：`/tmp/hzy-product-nav-qa-20260913`。
- 最终版补丁线上复验：从模块进入需求池显示「租户与订阅」，刷新应用后名称仍保留；点击重置恢复全部模块、移除旧名称及相关 URL 参数，无 console error / warn。证据 `live-module-context-final.json`、`live-module-name-final.png`。

## 2026-09-17 宿主直读 Codocs 项目文档正文（enterprise Worker + 本机 Runtime）

- 用户授权部署。测试 `hzy-test-enterprise` 版本 **`cbbb7726-451b-4a7c-ade4-4d580575f2cf`**，部署列表确认 100% 流量；回滚点为上一版本 `96caa71a-dba1-4f77-8b81-c158fd9510c3`。本机测试 Runtime 同步更新至 `0.3.219-test.codocs-project-document.1`（`4ce960df`），SHA-256 与备份见 [LOCAL_RUNTIME.md 版本更新](./LOCAL_RUNTIME.md#版本更新)。未改 secrets、grants、Gateway 或生产。
- 发布前：全量 Go 31 包通过；换二进制前用 LaunchAgent 的**全部**环境变量做启动探测。只传 `HZY_DATA_RUNTIME_CONFIG_DIR` 时进程会回落到默认配置（8080、无库）并正常启动，等于没验证；补齐后日志到达 `listening on 127.0.0.1:18084`，再因端口占用退出，才是本文档要的结论。
- 发布后线上验证：新路由 `GET /aims/api/v1/codocs/documents/:uuid/content` 匿名返回 401（已注册，不是 503 未就绪），未注册路径仍 503；按生成清单 `enterprise/composition/business-api-routes.generated.mjs` 逐条、各用其自身声明的方法比对 176 条路由，174 条返回 401/400/403。Runtime 本地与公网 health 均为新版本，匿名与伪造 Bearer 均 401。
- 探针纠错：过程中两次是探针本身写错而非部署回归——先用了 `project-portfolios`、裸 `time-entries` 这类实际不存在的路径形状，又对 PUT/DELETE-only 路由发 GET。比对路由必须取清单里声明的方法。

### 阻断：Codocs 在 C000001 测试环境从未上线（已于同日解除，见文末「2026-09-17 Codocs 上线测试环境」）

该端点的端到端验收**跑不通**，原因不是缺一项配置：

- 共享测试 Gateway 对 `/codocs/*` 是显式 503——`cloudflare-gateway.mjs:30` 把 `codocs` 与 `altoc`/`people`/`workflow`/`webdev`/`collab` 一并列入 “Application not enabled in test environment”，线上实测 `/codocs/`、`/codocs/api/v1/health` 均为 503。
- 线上不存在 `hzy-test-codocs` Worker（CF API 查不到该 script）。
- Runtime health 中 `"codocs":{"enabled":false}`，没有对应数据库。

要跑通需另立一件事：新建 Codocs Worker 及其 secrets（含 `downloadDocument` 依赖的阿里云 OSS 凭据）、Console 应用注册与 homeUrl、修改共享测试 Gateway 放行 `/codocs/*`、启用 Runtime codocs adapter 与数据库。**涉及共享 Gateway，需单独授权**，本轮未做。

浏览器验收另有一层阻断：消费该端点的 `aims/app/pages/projects/[id]/documents.vue` 仍是未迁页面之一（`enterprise/app/pages/` 下无对应页面），宿主目前没有 UI 调用它。`enterprise-oauth-codocs-evidence.json` 中 `browserAcceptance` 保持 `false`，未改。

### 顺带发现（既有缺口，未修）

`POST /aims/api/v1/company-weekly-summaries/:periodKey` 与 `POST /aims/api/v1/weekly-reports/:reportId` 线上返回 404，但路由文件与就绪清单中都存在（同路径 GET 正常返回 401/400）。`HEAD~2` 时清单里已有这几条，本轮两个提交未触碰任何 weekly 文件，属既有缺口而非本次引入。2026-09-17 复测仍为 404。

## 2026-09-17 Codocs 上线测试环境

用户授权把 Codocs 部署到 CF 测试环境，解除本文上一节记录的阻断。用户在 `codocs/.env.dev` 提供了本机 MySQL 管理凭据；`codocs/.wrangler.generated.jsonc` 是**生产**配置（`hzy-codocs` / `codocs.huizhi.yun` / `hzy-console-prod`），测试构建不使用它，也不使用 `.env.dev`（`build-cloudflare-worker.mjs` 设 `dotenv: false` 并清除 `HZY_*`／`ALIYUN_*` 等进程变量）。

已有、无需新建的部分：Console `auth_clients` 的 `codocs`（含本测试域 callback / post-logout URI）、服务账号 `codocs.runtime` 及其 8 条 active grant、Platform 的 active `codocs` 订阅、策略包中 `homeUrl=https://hzy-test.huizhi.yun/codocs/` 的 codocs 应用，以及当前 Runtime 二进制内已编译的 codocs adapter（本次**没有**重建 Runtime）。

本次改动：

- 数据库：新建本机 `hzy_codocs`（utf8mb4 / utf8mb4_0900_ai_ci），装入 `codocs/docs/codocs_schema.sql` 并按序执行 v1.1–v1.6 及 `company_asset_quick_publish`（后者多为 `IF NOT EXISTS` 空操作，schema dump 已含大部分对象），共 34 张表；adapter `requiredTables` 24 张逐项核对齐全。授权 `hzy_test_local_runtime@127.0.0.1`。库名沿用用户在 `.env.dev` 指定的 `hzy_codocs`，与其余 `hzy_*_test_local_20260910` 命名不同。
- Runtime：`config.json` 增加 `apps.codocs`（同一本机用户，库 `hzy_codocs`），原文件备份为 `config.before-codocs-20260917T085710.json`。换配置前按文档做启动探测（带齐 LaunchAgent 全部环境变量），日志到达 `listening on 127.0.0.1:18084` 才重启，证明 `server.New(cfg)` 通过 codocs adapter 的建表校验。重启后本地与公网 health 均为 `"codocs":{"db":"ok","enabled":true}`，其余应用不变，匿名与伪造 Bearer 仍 401。未改 Runtime 版本（仍 `0.3.219-test.codocs-project-document.1`）。
- Platform 控制面：按 `register-product-apps.mjs` 同样的主机／控制面／订阅守卫，在 `hzy_platform_dev` 插入 `C000001-test-codocs` 部署（`license_status=pending`，与 aims/assets/finance 一致）。仅新增一行，未改其他部署。
- Gateway 源码：`APP_SERVICE_BINDINGS` 增加 `codocs: 'HZY_CODOCS_SERVICE'`。**缺这一条时 codocs 会回落到 `DEFAULT_CODOCS_ORIGIN`（外部 `codocs.isme.dev`）**，即 2026-09-09 Assets 那次同类故障。该改动是加法：`serviceBindingFetch` 在缺少绑定时回退普通 fetch，生产网关行为不变。
- 测试 Gateway：`cloudflare-gateway.mjs` 的 503 名单移除 codocs；`prepare-cloudflare-gateway.mjs` 的 registry apps、service bindings、secrets 与 `HZY_CODOCS_ORIGIN=https://codocs.test.invalid` 同步补齐。新增测试断言 codocs 命中绑定且 `x-hzy-app-code=codocs`、`x-hzy-deployment=C000001-test-codocs`。test-env 43 项、tenant-gateway 40 项全部通过。
- Worker：`hzy-test-codocs` 版本 **`4b524c54-2150-42b4-bf98-2de670546f37`**，44 个变量 + 2 个 secret（`HZY_CODOCS_SERVICE_CLIENT_SECRET`、`HZY_TENANT_GATEWAY_INTERNAL_TOKEN`），无公网路由、`workers_dev:false`、无定时任务、`tenant-runtime` 数据模式、`HZY_COLLAB_ENABLED=false`。服务账号密钥取自服务器 `product-runtime-clients.json`，落盘为 0600，部署前已对活的 Console 验证该凭据有效（进入 scope 判定而非 `invalid_client`）。
- Gateway registry：线上 registry 与两份本地副本都不一致，漂移是 2026-09-14 的 `apps.aims.enterpriseScheduler={storage:'unified',generation:'1'}`；据此重建后摘要与线上 `0a5f499b…` 逐字节相同，才在其上合并 codocs。写入前复核、写入后回读，新摘要 `0fe7cb98…`，enterprise 绑定保持 `C000001-test-enterprise`。合并制品 `codocs-source.secret-patch.json` / `codocs-source.receipt.json`。
- Gateway 部署：先从线上版本读出真实绑定、变量、cron 与路由再组配置，避免按仓库里过时的候选配置覆盖。线上只有一条 cron `0 16 * * *`（仓库 prepare 脚本里的 `*/5` 集成 drain 并未上线），本次原样保留。新版本 **`0fc9768d-e170-4da9-a3ef-ce1a0ae5e40b`**，回滚点 `0866464e-ffa4-4de8-a75e-895100a87bfa`。

验收：`/codocs/` 与 `/codocs/login` 返回 200；`/`、`/aims/projects`、`/assets/`、`/finance/` 仍 200；`/altoc/`、`/people/`、`/workflow/`、`/webdev/`、`/collab/` 仍 503。匿名 `/codocs/api/documents|folders|cabinet` 为 401、`/codocs/api/info/items` 为 403、服务 API `POST /codocs/api/v1/service/product-documents/search` 为 401。真实 Chrome 访问 `/codocs/` 正确跳转 Wiztek SSO，与其他应用一致，无 console 错误（两条 401 是触发跳转的鉴权探测）。`verify-enterprise-oauth.mjs --execute-codocs` 通过：2 个 scope 签发并验签、2 个负向用例被拒，证据 `enterprise-oauth-codocs-evidence.json` 已按新 registry 摘要更新。

### 未完成：宿主直读 Codocs 正文在测试环境仍跑不通（同日已修复，见文末「2026-09-17 修正项目文档正文的来源/目标部署绑定」）

Codocs 应用本身已可用，但 `/aims/api/v1/codocs/documents/:uuid/content` 这条宿主直读链路**在测试环境仍不通**，原因是跨应用直连拓扑，不是本次部署遗漏：

- `aims/server/utils/codocsApi.ts` 要求直连 Codocs 独立子域名（生产为 `https://codocs.<suffix>/codocs`），明确禁止回环统一网关。测试环境没有 codocs 子域名。
- enterprise Worker 没有 `HZY_CODOCS_API_URL`，也没有 codocs service binding，`HZY_DEPLOYMENT_PROFILE` 未设置，因此 `resolveServiceAppBaseUrl` 解析不出 https 直连地址，回退到 Console 应用目录的 `homeUrl`，即网关回环。（顺带确认：不会误连生产 `codocs.huizhi.yun`。）
- 网关按应用路由时用 `stripInternalHeaders` 清掉入站上下文并把 `x-hzy-deployment` 设为**目标**应用（`C000001-test-codocs`），而 `codocs/server/api/v1/service/project-documents/[uuid]/content.post.ts` 经 `requireCodocsServiceTenantDeploymentBinding` 要求它等于 token 的**来源**部署（`C000001-test-enterprise`）。用真实 enterprise 服务令牌实测该端点即返回 `403 Service tenant/deployment binding is invalid.`——令牌与 capability 都正确，是传输拓扑不匹配。`preserveTrustedServiceTokenSource` 只覆盖 `POST /oauth/token`，不覆盖服务 API。
- 网关注入的 `x-hzy-service-routes` 目录里 codocs 的 origin 是 `https://codocs.test.invalid`，与其他应用一样是测试环境刻意设置的不可路由地址。

要打通需另做一件事并单独决策：给 codocs 一个可路由的测试直连地址并相应设置 `HZY_CODOCS_ORIGIN`，或给 enterprise 加 codocs service binding 并让 Foundation 受信 route helper 保留来源部署，或让网关在跨应用服务 API 路径上保留来源上下文。浏览器端到端验收另有一层阻断：消费该端点的 `aims/app/pages/projects/[id]/documents.vue` 仍是未迁页面，宿主没有 UI 调它，证据文件 `browserAcceptance` 保持 `false`。

Codocs 文件下载所需的阿里云 OSS 凭据未配置（测试 Worker 无 `ALIYUN_OSS_*`，按仓库约定应走 Console `integration-config + credential-vault`），因此附件下载不可用；文档正文读取不依赖 OSS。实时协同按 `HZY_COLLAB_ENABLED=false` 关闭，与 `/collab/` 仍 503 一致。


## 2026-09-17 修正项目文档正文的来源/目标部署绑定

上一节把宿主直读跑不通归因为"需要 codocs 独立子域名"。**这个判断是错的**：测试环境的 `validateCloudflareTestConfig` 明确禁止业务 Worker 带 `routes`（"App ingress and scheduling must remain disabled"），给 codocs 配公网主机名会破坏该不变量。真正的缺陷在代码——项目文档正文这条链路两端都停在旧的同部署形状。

- Codocs 侧 `api/v1/service/project-documents/[uuid]/content.post.ts` 用 `requireCodocsServiceTenantDeploymentBinding`，要求 `x-hzy-deployment` 等于令牌里的来源部署；而经受信网关到达时该头是**目标**（codocs）部署，必然 403。它的 5 条兄弟路由（product-documents metadata、productDocumentContentService、productDocumentSearchService、productDocumentCreateService、companyWeeklySummaryService、assetsProductDocumentMetadataService）早已改用 `requireCodocsCrossAppServiceTenantDeploymentBinding`。
- Aims 侧 `getCodocsProjectDocumentContent` 把 `targetDeploymentCode` 写成来源部署，出站也发来源部署；同文件的 `searchDepartmentDocuments` 早已从网关下发的 `x-hzy-service-routes` 受信目录解析目标部署再签名。

改动：两端按兄弟链路的既有形状对齐——Codocs 改用跨应用绑定并把 `binding.tenant/sourceDeployment/targetDeployment` 分别传入签名校验；Aims 解析 `resolveTrustedServiceAppRoute(event,'codocs')`，以目标部署签名并发送，有网关上下文却无受信路由时 503 失败关闭。没有改网关信任模型，没有新增公网入口，没有放宽任何校验。

验证：codocs typecheck、aims typecheck 均通过。codocs 225 项测试 217 通过 / 8 失败、aims 63 项失败，改动前后失败集合逐文件相同（均为既有的 `ERR_MODULE_NOT_FOUND`：测试文件以无扩展名路径 import，在 `--experimental-strip-types` 下加载失败，属既有问题，本次未引入也未处理）。更新了受影响的契约测试并新增 `aims/test/codocsProjectDocumentContentCaller.test.ts`。

部署：`hzy-test-codocs` **`2bc3dcd0-cdbc-4128-9101-930b3efe28fd`**；`hzy-test-enterprise` **`727bc257-6842-458a-bda8-316b90cef4bb`**，回滚点 `cbbb7726-451b-4a7c-ade4-4d580575f2cf`。先发目标应用再发调用方。

线上信任边界回归矩阵（真实令牌打真实端点，来源 enterprise → 网关 → codocs → codocs runtime → MySQL）：

| 用例 | 结果 |
| --- | --- |
| 正确调用 | `404 document_not_found` —— 鉴权、跨应用绑定、命令校验、HMAC 全部通过并查到数据库，探针用的是不存在的 UUID |
| 签名声称目标部署=来源部署 | 403 signature context invalid |
| 签名声称来源应用为 aims | 403 signature context invalid |
| 签名声称错误租户 | 403 signature context invalid |
| 签名后篡改命令体 | 403 command is invalid |
| 无令牌 | 客户端签名即拒绝（上下文不完整） |
| 伪造令牌 | 401 |
| capability 不符（`codocs:product-document:read`） | 403 Missing required service scope |
| audience 错误（data-runtime） | 令牌不予签发（invalid_scope） |
| aims 令牌走 enterprise 条目 | 令牌不予签发（insufficient_scope） |

仍未完成：浏览器端到端验收——消费该端点的 `aims/app/pages/projects/[id]/documents.vue` 还是未迁页面，宿主没有 UI 调它；库内也没有项目文档数据。`browserAcceptance` 保持 `false`。

同时盘点了 Codocs 全部服务路由的绑定形状，仍用同部署形状的 4 条（`altoc-entity-documents` 的 content/attach、`reviews/workflow-callback`、`projectDocumentQualityService`）记录在 `codocs/CLAUDE.md`：前三条的来源应用未部署无法验证，`projectDocumentQualityService` 经网关会同样失配，属已识别未处理项。

## 2026-09-17 项目文档预览下载端点与侧栏导航改版

用户授权部署。两个 Worker，先发目标应用再发调用方。

- `hzy-test-aims` **`7541a838-4c6c-4097-8e58-fd23d4449259`**，回滚点 `b4b4763b-57ac-4ad8-b4a8-67e042c31ad0`。本次同时补上了此前只发到宿主、未发到 Aims 的 `codocsApi.ts` 来源/目标 deployment 修正——该文件同样被 Aims 自身路由使用。
- `hzy-test-enterprise` **`6aa36332-f60f-400d-9b42-f1cb927526ed`**，回滚点 `727bc257-6842-458a-bda8-316b90cef4bb`。

内容：项目文档 preview/download 端点（宿主路由 + Aims service 端点 + 独立 `aims:project-documents:download` capability），以及侧栏一级菜单改为分节标题、二级菜单加图标。

验证：

- 部署前 Console 令牌签发探测：`aims:project-documents:read`、`aims:project-documents:download`、`codocs:project-document:content:read` 均 200 签发。
- 新宿主路由 `/aims/api/v1/projects/:id/documents/:id/{preview,download}` 匿名返回 401（已注册，非 `enterprise_module_runtime_not_ready` 的 503）。
- 导航改版确认落到线上：`/enterprise/_nuxt/DCH0lk4l.js` 含 `HostNavSections` 与分节标题样式；服务端下发的 `businessNavigation` 含 6 个工作域图标（book-marked / box / boxes / folder-kanban / list-checks / map），4 个领域图标（package / truck / chart-line / settings）保留供折叠态图标轨使用。
- 回归：`/`、`/enterprise/`、`/aims/*`、`/assets/`、`/finance/`、`/codocs/` 均 200；`/altoc/`、`/people/`、`/workflow/`、`/webdev/`、`/collab/` 仍 503；Runtime 版本与各库状态不变。

拓扑澄清（本次排查所得）：企业宿主 pilot 服务于 `/enterprise/*`，构建产物在 `/enterprise/_nuxt/`；站点根 `/` 由 Console 提供，引用 `/_nuxt/`。`/enterprise/` 会 308 跳到 `/aims/`。按公网路径探测 `/aims/api/v1/service/enterprise/**` 得到的 503 是宿主命名空间的正常结果——该 Aims service 端点只经 `HZY_AIMS_SERVICE` Service Binding 由宿主调用，不对外暴露。

未完成：preview/download 的浏览器端到端验收仍未做——需要登录会话，且消费这些端点的 `projects/[id]/documents.vue` 尚未迁入宿主（闭包还差 13 个端点）。侧栏改版的线上视觉验收同样需要登录；本次视觉验证是在本地用真实组件与真实导航数据、以 1440×900 和 390×844 完成的。
