# 混合开发 / 测试环境

> 2026-09-09：C000001 独立 Cloudflare 测试入口已部署，当前结果和待办见 [CLOUDFLARE_TEST_STATUS.md](./CLOUDFLARE_TEST_STATUS.md)。以下本地环境记录保留历史上下文。

本地多 Worker 的 Console 配置改用 Runtime 持久授权包，数据位于隔离测试 Console 库的 `policy_bundle_snapshots`；旧 `.local-workers/console/storage` 对象保留但不读取。`local-workers.mjs start` 独立每分钟同步；初次启动需等首包就绪，普通请求不触发 Platform 拉包，最后成功同步超过 5 分钟失败关闭。此项未创建云端资源、未发布生产。详见 [策略包运行说明](../../console/deploy/cloudflare/POLICY_BUNDLE_STORAGE.md)。

核验日期：2026-09-06。状态：**C000001 独立测试基础设施、生产数据副本、测试控制面及 Runtime 注册已完成；hzy-tester People 授权、本地员工列表/详情与测试岗位创建/更新/回读已验证。Cloudflare 独立测试 Worker 尚未发布，不属于本机 Console/People 访问入口。**

## 拓扑与边界

| 位置 | 用途 | 当前状态 |
| --- | --- | --- |
| 本机，Node 24.18.0 | Console 3000 + People 3007 热更新 | 已重新启动，隧道/Runtime 及两应用页面检查通过；每个 V8 heap 上限 2048 MiB（不是进程总 RSS 上限） |
| 国内 `gitlab.wiztek.cn` | 独立 MySQL + Data Runtime + 测试 Keycloak realm | 已创建并通过健康 / 未认证拒绝检查 |
| 日本 `oa.wiztek.cn` | C000001 生产数据库和 Runtime | 未修改生产服务、配置或数据；不作为本地测试数据库 |
| `hzy.wiztek.cn` → `hzy-platform-dev` | 开发控制面，3011，独立 `hzy_platform_dev` | 用户批准替换旧 PM2 域名入口；原开发 DB 和签名身份不变 |
| `huizhi.yun`（Cloudflare） | 生产 Platform | 用户确认的正式生产入口；本次未修改 Worker、DNS、凭证或部署 |
| Cloudflare | 后续独立测试 Worker / gateway / bindings | OAuth 已恢复；本次尚未发布测试应用，不复用生产 Worker 或 binding |

用户最新决定：**不创建新测试租户，继续使用开发控制面中的 `C000001`，限定测试环境。**
国内隔离 Runtime 已于 **2026-09-05 18:59:13 UTC** 改绑为 `C000001`，Runtime deployment 为
`c000001-test-tenant-runtime`，应用部署绑定为 `C000001-test-console` / `C000001-test-people`。
上述为首次改绑记录；**21:03:37 UTC 已正式兑换注册凭证**，Console 绑定对齐 Platform 已有
`wiztek-test-console`，People 保持 `C000001-test-people`，详见下方注册完成记录。测试库、JWT 公钥和签发方仍独立；
不能因为与生产同名就使用生产 deployment、凭证或日本生产 Runtime。
经用户明确授权，已完整、不脱敏导入下文列出的
Console / People 业务表；测试账号、Vault、签名密钥、会话、服务身份及集成配置保持独立。

所有本地业务数据调用都经过 Tenant Runtime。Console/People 不持有数据库密码、Vault 主密钥或 OIDC 签名私钥。
本地开发的 policy bypass 不代表共享集成测试通过；共享测试必须验证正式授权流程。

## 本机使用

**2026-09-06 本地认证联调入口：**先保留或启动下文 SSH 隧道，再运行：

```bash
nvm use
node deploy/test-env/local-gateway.mjs --start
```

不要与 `local.mjs --start` 或独立 `pnpm dev` 同时运行（会占用 3000/3007）。
本地网关监听 `127.0.0.1:3000/3007`，两个 Nuxt 后端监听 `127.0.0.1:13000/13007`，均只监听回环。
Console URL 仍为 `http://127.0.0.1:3000/console/`，People 为 `http://127.0.0.1:3007/people/`。
People HTML 导航自动使用文档既有 `standalone=1` 模式：不同端口不承载同源 Console Shell，不绕过用户认证或业务权限。
Foundation 在显式本地测试网关（development + test）下使用配置的 loopback Console URL 生成工作台/控制台入口，保留 `/console` 前缀。
AppRail/AppLauncher 和自动 Shell 入口同时检查应用目录中的 Console 来源，避免把 People 自身端口当成 Console Shell；生产默认 URL 解析不变。
GET/HEAD 的 localhost 入口规范跳转到 127.0.0.1；其他 Host 和内部 scheduler 入口被拒绝。

网关复用现有 Tenant Gateway 的头清理和精确 token-source 绑定规则，只注入固定 C000001/test 部署；
业务请求的 Runtime transport 固定到 SSH 隧道，Cloudflare 的 loopback 拒绝规则不变。
启动时从国内 `local-context.mjs` 经 SSH 读取必要测试 OIDC 配置、已有 Console 测试 license、公开签名 key，
以及 enrollment 得到的 `hzy_dr_*` **仅供 Platform 控制面 API 使用**的凭证。
这些值只进入启动器/Nuxt 进程内存与运行环境，不写本地 dotenv、Git 或输出日志。
`hzy_dr_*` 从未放入业务 Runtime token 变量，也不用于数据面调用；数据面继续使用短期 service JWT。
测试 Platform 内部服务凭证仍只留国内：启动器经固定 SSH helper 换取 90 秒、精确 Console/test binding 的引导 JWT，
到期前自动重新获取，仅内存缓存，不伪造 Gateway 用户或管理员会话。所有业务 app client secret、Vault 主密钥和签名私钥仍留 Runtime。

启动器显式覆盖 Console 为正式测试策略模式：Platform runtime enabled、dev policy bypass disabled，
仍关闭 heartbeat、后台任务、auth-client 自动物化和 Collab。缓存独立为 `.data/platform-runtime-test-local`。
已验证官方流程成功验签测试 license/策略包，activation=`active`、bundleReady=true；当前为测试包 #5（版本见下文）。
原 `.env.dev` 的低副作用基础配置未覆盖，`local.mjs` 仍可单独做隧道/只读检查。

验证进度：现有 `hzy-tester` 已在真实浏览器完成测试 Keycloak → 本地 Console OIDC 回调并进入工作台；
用户于 2026-09-06 明确确认给 `hzy-tester` 授予测试环境 People 管理权限并访问未脱敏测试数据，重新登录后已执行：

- 测试 Console Runtime 通过正式短期 JWT 读取并核对 `test-user-001` / `hzy-tester`，经 Console 主体投影接口仅同步这一条用户；`resetMemberships=false`、`finalize=false`，不重置成员关系或谎报全量同步完成。主体 ID 为 50312。直接从 dashboard 创建主体仍按设计返回 405，未绕过该限制。
- 企业角色 `people_admin`（ID 126）只映射 manifest 应用角色 `people:admin`；成员分配 ID 24，类型 privileged、active。正常合并权限模式生效，不使用角色模拟，不增加其他应用管理权限。既有 baseline 保持不变。
- 签名测试策略包 `pv_test_20260906032659_0005`（ID 5，hash `sha256_bc306aafef753d9d1832b32575065c93a5062e35b61597762bb6a699679b5533`）仅下发 `wiztek-test-console` 和 `C000001-test-people` 两个 test 部署。本地重启后验签加载成功、bundleReady=true。
- 不创建新登录账号，不修改生产控制面。People 浏览器已进入正常工作台并显示员工/任职/绩效等管理菜单。

本地启动器显式指定 `HZY_CONSOLE_TOKEN_URL=http://127.0.0.1:3000/console/oauth/token`，避免受信云端 Gateway 默认规则将独立 People 端口解释为 HTTPS token endpoint；精确来源应用/租户/部署校验保持不变。
网关仅将 Console 已授权应用目录中的 People 链接映射到本机 3007；不增加应用、不扩大权限，不修改签名策略。账号/部门显示名的历史合成种子有编码乱码，尚未修正。
Node 网关已补 WebSocket upgrade 转发，People 浏览器新日志为 `[vite] connected.`。

### 复用现有企业 SSO

本地启动器支持两个精确的上游身份组合：`hzy-test` Realm / `hzy-test-console`，以及
`wiztek` Realm / `hzy_local_console`（以 Keycloak 实际登记的下划线 ID 为准）。后者共享企业身份，不改变 C000001/test Runtime、业务数据库、部署和策略绑定。
`console/.env.dev`（或启动进程环境）中的 `SSO_OIDC_ISSUER` / `SSO_OIDC_CLIENT_ID` 优先；必须同时配置。
`SSO_OIDC_CLIENT_SECRET` 可由受保护的本机配置提供；未提供时只接受远端
`/wiztek/hzy-test/secrets/test-login.json` 中**相同 issuer/clientId** 的 secret。禁止把新客户端与旧测试密钥混用，配置缺失时停止启动，不静默回退。
远端 `local-context.mjs` 和同目录 `local-login.mjs` 须同步更新；所有密钥禁止输出或提交 Git。

本地回调地址固定为 `http://127.0.0.1:3000/console/api/auth/oidc-callback`，退出回调为
`http://127.0.0.1:3000/console/api/auth/oidc-post-logout`；Keycloak 客户端必须登记精确地址，启用标准授权码流程、客户端认证和 S256 PKCE。
现有账号登录后仍需在测试目录核对 UID，并由测试 Platform 单独授权，不继承 `hzy-tester` 的 People 角色。
当前 Console 退出仍会调用上游 SSO 退出；共享 Realm 下可能影响同一浏览器的正式 SSO 会话。本次启动器修改没有改变退出语义。

2026-09-06 切换记录：已核对 Keycloak 实际 ID 为 `hzy_local_console`，纠正本地连字符 ID；
复用用户提供的本机 secret，客户端认证预检查通过（故意无效授权码返回 `invalid_grant`，而非 `invalid_client`）。
28 项部署脚本测试通过，Console/People 已重启。真实浏览器从本地 Console 跳转到 `wiztek` Realm 的 Wiztek SSO 登录页，
client、回调及 S256 均正确；现有企业账号的登录回调、目录身份映射和测试权限须在用户登录后继续验证。

后续账号验收：现有 SSO 登录已映射 Console UID `zhouguangying`，Console 工作台及企业目录 HTTP 200。
经用户明确批准，测试控制面主体 #80（subjectCode=`zhouguangying`）新增 `people_admin` #126 分配 #25，
privileged/manual/active，无到期时间；仅新增 People 的 22 项权限，保留原有其他角色。
已发布测试包 #6 `pv_test_20260906141653_0006`，hash
`sha256_27c6eab4a52803cec91a2e415566c527ee5e8271c0c4dc4853f2bc801f8e3967`，目标仅
`wiztek-test-console` / `C000001-test-people`。本地重启后 Console/People 权限接口确认 UID 和版本一致。
同一真实浏览器员工搜索从未授权 403 转为 HTTP 200 / 92 人；重启后曾出现授权依赖 503 和长响应，
后续搜索成功，但本次不声称性能或稳定性压测通过。未变更生产授权或数据。

2026-09-06 经用户明确批准，`people-directory-grant.mjs` 仅向国内测试库的
`people.runtime`（client #1）新增 grant #248582：`console:directory-users:read`，
audience `console`，绑定 `C000001` / `C000001-test-people`。原有 4 条 grant 未变。
修改前记录及精确回滚 SQL 保留在国内 `/wiztek/hzy-test/backups/people-directory-grant-20260906/`。
实际浏览器触发的 Runtime identity consume 已从 `insufficient_scope` 403 转为 200；
首次部门读取随后在 Console Directory 请求阶段超时，不能据此宣称员工页面已恢复。

Console 439 tests/typecheck/定向 lint 通过；新增 2 项 local issuer 测试要求已认证网关、显式 dev/test、loopback HTTP 和精确 host/prefix，生产保持 HTTPS issuer 规则。
跨端口导航修复：21 项 Foundation 定向测试、相关文件 lint、People typecheck 通过。真实浏览器已验证 People 工作台链接跳转到 `http://127.0.0.1:3000/console/` 并保持登录；修复本地 Console URL 缺尾斜杠导致网关 503 的问题。People 自身入口不再指向本端口的 `/shell/people`。岗位管理页面已在 1440px / 390px 查看，宽表使用横向滚动。
授权隔离核查：Platform 角色分配以租户为单位收集，策略包目标部署按 environment 筛选。本次角色与主体只写入独立的 `hzy_platform_dev`，仅发布 C000001/test 策略；未修改生产控制面或生产授权。

### People 数据验收与测试 Runtime 构建

- Runtime 服务签发器按登记的 `deploymentBindings` 校验应用 deployment，不再把测试部署误限定为 `<tenant>-<app>`。显式绑定表中的缺项或不匹配仍返回 403；未配置绑定表的 legacy 规则不变。全部 `go test -p 1 ./...` 通过，新增 7 个绑定子用例。
- 国内仅 `hzy-test-data-runtime` 更新为 `0.3.215-test.1`（`2040509e-test-binding`）；未更改正式发布通道。二进制 SHA-256 为 `ed40e6845113180d53a4a8bc603404c74f9350531910bf72e71144d9bde69ee7`，原二进制及回执保留在 `/wiztek/hzy-test/backups/runtime-binding-20260906`。Runtime 健康响应 tenant/deployment 与 test 绑定一致。
- 真实浏览器会话：员工搜索 HTTP 200、总数 92、首分页 20；员工详情 profile HTTP 200。
- 测试岗位 `DEV-SMOKE-20260906`（ID 4）：创建、PATCH、重新 GET 均 HTTP 200，`created_by/updated_by=test-user-001`；`enabled=0`，没有分配任何员工。保留该停用记录用于后续回归，没有修改真实员工资料。
- 不带会话的 People 员工搜索和 Console Directory 均返回 401。未以菜单可见替代数据面验收；未验收其他未启动业务应用、真实 HR 集成或完整审批流程。
- 退出 Console 后，同一浏览器目录请求返回 401；通过独立测试 Keycloak 复用现有账号重新登录成功，People 员工搜索仍为 HTTP 200 / 92 人，权限版本仍为测试包 #5。实际点击 Console 的 HR 入口已进入本机 People 工作台。
- 已登录 `hzy-tester` 的 Console Directory 返回 403：本次只授予 People 管理权限，没有 `directory_users:view`，这是预期权限边界，不代表 Console 目录管理已验收。Console 登录、工作台、授权应用目录和跨应用导航已验证。
- 本地部署脚本 25 项测试全部通过；最终 `local.mjs --check` 确认测试 Runtime `0.3.215-test.1` 健康、未认证请求 401、两个本地页面 HTTP 200。

已有的 `console/.env.dev` 和 `people/.env.dev` 是忽略跟踪的本机配置，不能提交。
它们将 Runtime URL 固定为 `http://127.0.0.1:18080`，关闭 heartbeat、后台同步、自动物化等副作用。
基础 dotenv 不包含完整运行凭证；认证联调须使用上面的 local-gateway 启动器。不要从生产环境补入 token，也不要关闭 Runtime JWT 验证。

在仓库根目录执行：

```bash
nvm use
# 终端一：只启动 SSH 隧道；已有隧道时无需重复运行。
node deploy/test-env/local.mjs --tunnel-only
# 终端二：启动正式认证的本地 Console 和 People。
node deploy/test-env/local-gateway.mjs --start
```

如果 Console/People 已经在其他终端运行，只启动隧道：

```bash
node deploy/test-env/local.mjs --tunnel-only
```

访问：

- Console：<http://127.0.0.1:3000/console/>
- People：<http://127.0.0.1:3007/people/>

只读检查：

```bash
node deploy/test-env/local.mjs --check
node --test deploy/test-env/test/*.test.mjs
```

检查覆盖 Runtime 租户 / 部署 / DB health、未认证目录访问返回 401、两个页面可达性；**不代表 SSO、People 业务 API、授权或跨应用 token 验收通过**。
启动脚本拒绝占用端口，不会终止其他终端或用户已有进程。SSH 仅转发 Runtime：
`127.0.0.1:18080 → 国内 127.0.0.1:18084`，不转发数据库、不开放公网监听。

## 国内测试资源

根目录 `/wiztek/hzy-test`，不与既有 GitLab、Connector、MySQL 或 Console-test 工作目录复用。

| 资源 | 配置 |
| --- | --- |
| Docker `hzy-test-mysql` | `127.0.0.1:13316`；896 MiB 内存 / 无额外 swap；0.75 CPU；最大连接 40；buffer pool 256 MiB |
| systemd `hzy-test-data-runtime` | `127.0.0.1:18084`；256 MiB 内存；0.5 CPU；独立非登录服务用户 |
| Keycloak realm | 现有 Keycloak 中新增 `hzy-test`，独立客户端和合成用户；未修改其他 realm |
| GitLab Runner | 原配置已经 `concurrent = 1`，本次未改动 |

初始化观测值：MySQL 约 166 MiB，Runtime 约 6 MiB；不是峰值负载保证。
测试数据库账户仅拥有测试 schema 的 DML 和临时表权限，初始化 / migration 使用独立 root 身份。
当前实际业务库为 `hzy_console_test_20260905` / `hzy_people_test_20260905`；
原 `hzy_console` / `hzy_people` 保留用于回滚，不再作为测试 Runtime 的活动库。

Runtime 初次安装使用已发布 **0.3.215 / b0a7eacd-dirty**；2026-09-06 已更新为上文记录的 **0.3.215-test.1** 本地修复构建，原发行二进制已备份。
首次直传本机构建速度过慢，已停止传输，改由服务器下载已签名发行包，验证 SHA-256 和 Ed25519 签名后安装。
发行包 SHA-256：`85ea75938c2ef43f090ecb871e0c12b38d11f61424313a5b7be1a01bd224b0a0`。
发布验签公钥与日本生产主机已安装的公开信任材料核对；这只是发行包公钥，不是生产租户密钥。

只读运维：

```bash
ssh root@gitlab.wiztek.cn 'systemctl status hzy-test-data-runtime --no-pager'
ssh root@gitlab.wiztek.cn 'curl -fsS http://127.0.0.1:18084/runtime/health'
ssh root@gitlab.wiztek.cn 'docker stats --no-stream hzy-test-mysql'
ssh root@gitlab.wiztek.cn 'node /wiztek/hzy-test/inspect-platform.mjs'
```

登录材料仅在国内主机 `/wiztek/hzy-test/secrets/test-login.json`（0600），不要输出到聊天、工单或普通日志。
Runtime DB 配置在 `runtime/config.json`，Vault 主密钥在 `secrets/vault-key`，仅测试服务身份可读取必要材料。

## 初始化脚本的执行边界

以下脚本已经执行，**不要对当前环境再次初始化**：

1. `provision-data.mjs --execute`：限定国内主机名，拒绝已初始化数据；要求预先将
   `console/docs/hzy_console_schema.sql`、`people/docs/people_schema.sql` 分别复制为
   `/wiztek/hzy-test/schema/console.sql`、`people.sql`，并已拉取 `mysql:8.0`。实际镜像 digest 记录在远端 `provisioned.json`。
2. `provision-identity.mjs --execute`：要求数据初始化回执，拒绝已存在 realm；仅创建独立测试身份与合成数据。
3. `install-runtime.sh --execute`：要求已下载固定发行包和配套公钥 / systemd unit；验签后安装新测试服务，拒绝覆盖已有 unit。

任一步部分失败都应检查实际状态后修复，不能删除回执重跑。脚本不是已有数据库的 migration 工具。

## 开发控制面升级记录

`platform-dev` 诊断确认 DB 为 `hzy_platform_dev`，开发签名私钥可用。
旧版携带有效内部凭证请求 `POST /api/platform/internal/tenant-gateway/runtime-bootstrap-token`
返回 404；升级后返回 **409（HTEST001 绑定尚未注册）**，未认证请求返回 403。
这确认新版接口和认证边界已部署，不表示 HTEST001 登录链路已经接通。

- 开发 DB 的 76 张 InnoDB 表已经通过一致性加密备份，恢复到新建的
  `hzy_platform_upgrade_probe` 演练库后核对表数。
- 演练和正式开发库均执行了 v2.16 / v2.22 / v2.25 / v2.27 / v2.28 / v2.29 / v2.31
  七组迁移；正式开发库现为 87 张表。没有对生产业务库执行迁移。
- 新部署目录：`/wiztek/hzy-test/platform-release-5f898581/platform`。
  基线为 `5f898581aea6448385541d88f3357bbbbf24bd37`，另含两个 issuer 修复文件；
  精确文件 hash 在远端 `platform-upgrade-complete.json.sourcePatchHashes`。
  不能把这个部署称为未修改的 5f898581。
- `platform-state.mjs --backup` 生成加密 SQL、原 `.output` 和受保护的环境 / 进程快照。
  文件位于 `/wiztek/hzy-test/backups/platform-dev-20260905`，仅运维 root 读取；
  数据备份为 AES-256-GCM，解密材料不进入本机或 Git。
- `platform-probe.mjs` 负责恢复、迁移演练和验证；`platform-upgrade.mjs` 校验演练文件 hash
  后迁移；`platform-cutover.mjs` 只重建 `hzy-platform-dev` PM2 记录，并验证实际 cwd、
  script、watch=false、DB、签名 kid 和 bootstrap 状态，不仅检查 health。
  旧目录 `/wiztek/huizhi-yun/platform-dev` 保留用于回滚。候选 PM2 进程验收后已删除，演练库保留。
- 构建未读取真实 dotenv；`platform-env.mjs` 显式映射 Nuxt 运行期 DB、认证和集成设置，
  并剔除 `/proc` 环境快照夹带的 PM2 元数据。不要将完整进程 environ 直接传回 PM2：
  `name/pm_id/watch/pm_exec_path` 会覆盖进程定义。PM2 reload 也不能证明 cwd/script 已切换。
- 构建在国内服务器串行运行，上限 3 GiB / 1 CPU；lint、typecheck、Platform 全量测试、
  Runtime auth 测试、部署脚本隔离测试均通过。原生产 Platform 和既有 Console-test 没有重启。
- `platform-dev.wiztek.cn` 旧证书于 2026-08-28 过期；已仅对这个域名执行续期，
  改用 nginx authenticator，证书有效至 **2026-12-04**。公网 HTTPS 返回 200。
  Nginx 应用路由与续期前备份逐字节一致，未停服；仅发生正常的优雅 reload。
  未发现现有 Certbot timer/cron；新增 `hzy-test-platform-cert.timer` 每天两次检查，
  续期目标固定为 `platform-dev.wiztek.cn`，不会批量续期其他域名。

`build-platform.sh` 构建固定基线归档；本次还将工作区的
`platform/server/utils/runtimeBootstrapIssuer.ts` 和
`platform/server/api/platform/internal/tenant-gateway/runtime-bootstrap-token.post.ts`
同步到新部署目录并重新运行 lint、typecheck、Node 构建。再部署时必须包含同样经过测试的修复，
不能仅重放旧基线归档。所有初始化 / 升级脚本都不是日常反复执行的启动命令。

## 首次联调问题记录（历史状态，当前验收见上文）

当前 Runtime 要求短期、受签名且严格绑定 tenant/deployment/app/runtime 的 bootstrap，再由 Console 换取准确 scope 的服务 JWT。
不能使用生产凭证、长期万能 token、自签假 Platform token 或 auth-disabled 模式绕过。

接下来改为核对并建立开发控制面 `C000001` 的测试部署与隔离 Runtime 绑定、配置测试激活材料、接通 SSO/服务凭证；不再注册 HTEST001 租户。
浏览器连接恢复后已只读核验：C000001 企业工作台可访问，当前账号显示为企业所有者。
首次部署管理页报告 `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM is required`，导致整个配置请求失败。
**纠正首次空态判断：不能据此断定测试部署不存在。** 后续运营页、只读数据库和恢复后的配置页共同确认：
已有 active 测试 Console 部署 `wiztek-test-console`，runtime_endpoint 为 `https://hzy-test.wiztek.cn`，仍有持续心跳。
它与新隔离 Runtime 暂定的 `C000001-test-console` 绑定不一致；后续需按真实 Platform 记录对齐，不能再创建同环境同应用的冲突 active deployment。
开发应用注册表尚无 People；现有套餐应用不代表本地 Console / People 业务链路已接通。
上述首次浏览器检查未改动环境绑定、生成安装指令、轮换租户令牌或操作生产环境；其后的服务器端改绑见下一节。
现有 Platform Google 登录的 client ID/secret 在升级前就是空值，仍未配置；本次没有猜测或复制生产 Google 凭证。
Console 的新 Keycloak 测试 realm 与此管理员 Google 登录是不同链路。
Keycloak 已预留 `https://hzy-test.huizhi.yun/console/api/auth/oidc-callback`，**预留不等于域名或 Worker 已部署**。
Cloudflare 阶段必须新建测试专用配置、Worker、gateway 和 bindings，不能使用现有强制生产配置的 `deploy:cloudflare` 命令冒充测试发布。

上述为首次联调时的待验收清单。本机 Console/People 的登录、登出、重新登录、策略加载及 People 读写已完成，详见上文；Cloudflare 测试发布、完整业务流程和峰值内存压力测试仍未进行，不属于本次本地访问验收。

## 测试 Runtime 改绑 C000001（已完成）

用户明确要求只改国内测试服务器，沿用开发控制面的 C000001，不创建新租户。

- `rebind-runtime.mjs --check` 核对固定国内主机、测试 Docker 标签/回环端口、精确测试 schema、旧绑定及 JWT 模式。
  扫描两库文本/JSON 列，旧 HTEST001 引用仅有 1 条 `org_profiles.tenant_code` 和 4 条 `service_client_grants.scope_json`。
- `--execute` 先停 `hzy-test-data-runtime`，仅在国内生成两库的 AES-256-GCM 加密备份与原配置/绑定回滚材料，
  然后将上述 5 条记录与 Runtime 的 tenant / deployment / per-app bindings 同步改为 C000001 测试标识并重启。
  未轮换密钥、账号或凭证；People grant 的 client、audience、action、status 不变，仅更新 tenant/deployment 范围。
- 活动库仍为 `hzy_console_test_20260905` / `hzy_people_test_20260905`，监听仍为 `127.0.0.1:18084`。
  排除两张定向更新表后 Console 所有表及 People 整库前后 dump SHA-256 一致，未重新导入或删除业务数据。
- 独立复核服务 active、health tenant/deployment 正确、Console/Directory/People DB 均为 ok；无凭证及伪造 Bearer 请求均 401。
  本机 SSH 隧道也验证了新绑定和 401；3000/3007 均无监听，因此完整 `local.mjs --check` 未通过，不作为业务验收。
  本地 14 项部署脚本测试及 Go auth/config 测试通过；Go 源码测试不替代已发布 Runtime 的完整业务鉴权验收。
- 备份：`/wiztek/hzy-test/backups/rebind-c000001-test-20260905`（0700），文件 0600，仅国内保留。
  `complete.json` 记录成功时间和前后保护哈希；`rollback.sql` 仅恢复这 5 条绑定及原更新时间。
  回滚需先停测试 Runtime、保留后续测试写入并审阅漂移，再恢复绑定和原 `runtime-config.json` 后重启；不恢复整库覆盖新数据。
- 脚本拒绝非预期源状态和重复执行。历史初始化/生产导入脚本仍保留 HTEST001，以保存当时事实且防止误重跑。
  `local.mjs` 已要求 tenant=C000001 **同时** deployment=`c000001-test-tenant-runtime`；仅租户编号相同不算隔离验证通过。

本次不写 Platform 库，不伪造 ready/enrollment 记录，不生成激活凭证；后续仍需在开发控制面的测试环境正式注册并接通短期 bootstrap。

## 本地正常访问接通进度（未完成）

- Node 24 的 Console / People 已重新启动，`local.mjs --check` 通过：C000001 测试 Runtime healthy、未认证 401、两应用页面 HTTP 200。
  真实浏览器 Console 登录页仍显示“当前入口未配置 Console 登录方式”，不能称作正常登录或业务访问。
- 已修复本地启动期间 `getBackgroundRuntimeEvent()` 构造普通对象导致的 Nitro/H3 上下文错误：
  现在使用 H3 `createEvent`，补齐 `context.nitro`，保留真实请求上下文；不伪造 gateway、用户身份或服务凭证。
  热更新后启动日志不再出现 `runtimeConfig` / `replace` 属性异常，而是准确报告缺少 Console service client。
  新增 3 项回归测试；Console 全量 437 项测试、typecheck、定向 lint 均通过。凭证链路仍未接通，测试通过不等于本地登录验收。
- `configure-release-trust.mjs` 已为开发 Platform 配置现有公开 Ed25519 发行验签公钥，指纹为
  `e1f7cfc0fb174116c305766c2a39d90606e22cc5a3c02d1cf7fc749578bcab82`，并实际核验公开 PEM 接口。
  发行元数据的 HTTPS issuer 兜底为预留 `https://hzy-test.huizhi.yun`，不代表该域名已部署，也未改变隔离 Runtime 的本地 Console issuer。
  原配置备份在 `backups/platform-release-trust-https-20260905`，仅重启开发 Platform，生产 PID 未变。
  首次使用 loopback HTTP issuer 被生产模式构建拒绝；其备份保留在 `backups/platform-release-trust-20260905`。
  PM2 restart 会保留未显式清空的 env，单纯恢复 JSON 不能保证删除新 env；最终已覆盖为通过验证的 HTTPS 元数据配置。
- 发布中心同步 `0.3.215` 的实际响应为 **422：缺少 `linux/arm64` 制品**，不是网络或签名错误。
  未更改发布中心多架构检查或签名规则，未写伪造的 registry approved 记录。
  `bootstrap-installed-release.mjs` 再次验证国内现有 amd64 包 SHA-256/Ed25519 签名及实际运行版本后，
  仅为开发控制面启用既有 `HZY_DATA_RUNTIME_APPROVED_VERSION=0.3.215` 迁移引导兜底；source 是 `bootstrap`，不是 `registry`。
  备份在 `backups/platform-installed-release-bootstrap-20260905`；未来批准完整签名多架构版本后应移除此迁移兜底，不能作为日常发布流程。
- 恢复后的 C000001 测试配置仍包含旧 `wiztek` 子域名、旧 OIDC issuer/client 和旧测试 Console 地址。
  尚未保存新的站点/登录配置、生成注册指令或轮换租户令牌；生产入口不能作为本地开发的默认路由。
- People 导入表单使用本仓库 `people/v0.1.6`（远端 tag 已核验）和 `people/app.manifest.json`。
  首次导入响应为 **500：GitLab 配置缺失**；后续经用户明确授权复用 `account/.env` 的 GitLab 令牌，已解除该缺项，见下一节。

## 开发 Platform GitLab 配置（已完成）

用户明确批准复用现有令牌并保留写能力；来源是用户新建、Git 已忽略的 `account/.env`。
本次仅选择 `GITLAB_BASE_URL` / `GITLAB_BOT_TOKEN`，没有复制 Account 的其他设置或引入 Account API 依赖。

- `configure-platform-gitlab.mjs --check` 经国内服务器只读核验令牌 active、`api` scope、到期日 **2027-01-22**、
  仓库所在组 access level **40（Maintainer）**，并成功读取 `people/v0.1.6` 的 manifest。
  未执行 GitLab 写请求验证；有写权限不代表已经测试所有写入场景，保护分支等规则仍由 GitLab 执行。
- `--execute` 通过 SSH stdin 传输必要配置，不放入命令参数或输出；仅写国内开发配置及 Nuxt 对应变量，文件权限 0600。
  未创建/轮换令牌、未更改原权限，也未改生产环境配置。以后轮换或撤销该令牌会影响所有复用方。
  回滚配置及完成回执位于 `/wiztek/hzy-test/backups/platform-gitlab-reuse-I5Il2e`（目录 0700）。
- 只重启 `hzy-platform-dev` 并保存 PM2 状态；核验实际 PM2 env 与预期相同、登录页 200，其他进程 PID 未变化。
- 使用已登录管理员浏览器再次导入 People；浏览器请求返回 **504 网关超时**，不能据此重复创建。
  后续只读数据库及应用详情页确认：People 应用 ID **184**、manifest ID **34**，
  `v0.1.6` 草稿 release 已落库，包含 **13 resources / 39 actions**。
  当前 **0 订阅 / 0 活跃 deployment**，尚未发布、订阅或配置 People 的 C000001 测试部署。
- 16 项部署脚本测试、脚本语法与 `git diff --check` 通过。新增测试覆盖必要字段白名单和 GitLab HTTPS 目标限制。

GitLab 配置缺项已解决；本地 Console/People 登录、Runtime enrollment 与服务 JWT 链路仍未验收。
生产 Runtime token、Platform/Console 私钥及租户认证材料仍禁止复用；本次授权例外仅限 GitLab 集成令牌。

### 本地版本对齐与注册前核验（2026-09-05）

- 原 `people/v0.1.6` manifest 与当前本地提交有差异，不能用旧草稿作为当前本地权限事实。
  已通过已登录的测试管理员接口 `/api/platform/ops/app-manifest-imports` 导入
  `v0.1.6-dev.2040509e`（release ID 29、manifest ID 35、seq #2）。
  `commitSha=2040509e` 固定到已推送提交；没有创建 GitLab Tag。
  接口把来源 ref 记为 `people/2040509e`，这是 prefix 归一化后的元数据，不是真实新建 Tag；
  实际文件读取使用显式 commit SHA。数据库 manifest hash 与本地规范化 manifest **完全一致**，13 resources / 39 actions。
  浏览器版本列表已确认新草稿，尚未发布或授予租户访问。
- 当前开发 DB 的 C000001/test `tenant_runtime_instances` 为 0，唯一 active app deployment 仍是 `wiztek-test-console`。
  当前 active 测试站点 `wiztek-test` 指向 `https://hzy-test.wiztek.cn`；旧 inactive `C000001-test` 指向 `https://wiztekdev.huizhi.yun`。
  旧站点和旧 Console 心跳不能证明国内新隔离 Runtime 已注册。尚未改动站点、生成 enrollment 或轮换凭证。
- 本地 `local.mjs --check` 再次通过页面与隔离 Runtime/401 检查，SSO 和业务读写仍未验收。
  下一步是在开发控制面中为 C000001 创建 People 测试部署并注册现有隔离 Runtime；浏览器执行新安全访问授权前需用户当次确认。

注册前再次只读核验：新 Runtime 的 control URL/token 仍未配置，开发控制面 C000001/test 没有 runtime instance 或 issued enrollment。
活动库仍固定国内 `127.0.0.1:13316` 的两个 `_test_20260905` schema，JWT 认证保持开启。
**旧 PM2 `hzy-console-test` 仍 online，且其 Runtime URL 指向日本生产 `wiztek-data-runtime.huizhi.yun`。**
后续对齐 `wiztek-test-console` 时必须处理旧测试进程的身份/流量冲突，不能把新激活材料或测试策略交给这个仍连接生产数据的旧实例。
本次仅核验，没有停止或修改旧实例。

注册落地还需注意：Go `ControlConfig.PlatformSigningPublicKey` 标记为 `json:"-"`，把公钥塞进主 config 的该字段不会生效。
应使用官方受保护的 `platform-signing-key.json` overlay（含 kid/alg/publicKey），或既有公开信任 env 路径；
不能用生产私钥或关闭 JWT 校验补救。主配置与 overlay 都必须保留既有测试业务 JWT issuer、测试 Vault 和数据库边界。

### C000001/test 正式注册完成（2026-09-05 21:03 UTC）

用户当次明确授权创建 People 测试部署、生成并兑换一次性 Runtime 注册凭证。

- 通过已登录测试管理接口创建 People 订阅及部署：deployment ID **14**，
  `C000001-test-people`，environment=`test`，deployment/license 均 `active`。
  使用现有测试站点，未新增租户、订单付款、生产部署或 GitLab Tag。
- 测试版本 `v0.1.6-dev.2040509e` 的发布按钮及 PATCH 接口返回 **404 API route not found**；
  版本仍为 `draft`。未直接修改数据库绕过发布流程；注册就绪不代表应用版本发布或权限链路已完成。
- 通过 C000001 所有者的 `install-command` 接口生成一次性注册凭证，enrollment ID **1**。
  浏览器仅提取注册码并用国内临时 RSA-OAEP/SHA-256 公钥加密，本机仅中转密文；
  私钥、兑换得到的 control token 和兼容 token 只保留国内受保护文件。
  未执行完整安装指令，未启用或兑换附带的 Directory Connector token，也未应用其中旧生产域名的 JWT issuer。
- `enroll-runtime.mjs` 验证固定主机、测试 DB/监听/JWT/原绑定及 binary hash，先备份，再调用官方
  `hzy-data-runtime enroll`。只写入 control 配置、公开 Platform 验签 overlay 和返回的精确应用绑定。
  **未安装兼容 static token**，未修改测试 Vault、业务 JWT、公钥、数据库连接或数据。
- Runtime instance ID **1**，code=`c000001-test-tenant-runtime`，控制面为 `https://hzy.wiztek.cn`。
  Agent 自身真实心跳确认 `ready` / `0.3.215` / 无错误；注册记录为 `redeemed`。
  Console `wiztek-test-console` 为 `schema_ready/not_applicable`，
  People `C000001-test-people` 为 `schema_ready/ok`。未伪造 heartbeat 或写 ready 状态。
- 注册 endpoint 为国内回环 `http://127.0.0.1:18084`，仅同机控制面和 SSH 隧道可访问；
  **不是已发布的公网 Runtime URL**。本机仍通过 `127.0.0.1:18080` 隧道访问；后续 Gateway 必须处理私网传输，不能把回环地址直接交给 Cloudflare。
- 对业务目录接口的无令牌、伪造令牌和真实 control token 探测均 **401**；控制令牌不能用于业务访问。
  Console/Directory/People 测试 DB health 均 ok。
- 已备份并停止旧 PM2 **`hzy-console-test`**，保存 PM2 状态，避免其继续用相同部署身份连接日本生产 Runtime。
  `hzy-platform-dev` 和旧 `hzy-platform-prod` PID 均未改变；本次没有生产配置、服务或数据写操作。
- 回滚材料：`/wiztek/hzy-test/backups/runtime-enrollment-c000001-20260905`（0700、文件 0600）。
  `runtime-config.json`、`pm2-before.json`、`redeemed.env`、公开信任和完成回执留在国内。
  脚本拒绝重复兑换和漂移；如失败应先核对受保护回执及 Platform enrollment 状态，不能盲目再次生成/兑换。
  恢复旧 Console 会重新连接生产 Runtime，不能自动恢复；回滚需重新审阅此风险。

本节为注册阶段记录；随后完成的本地 SSO、短期 JWT、权限和业务数据验收见上方“本机使用”。

### People 发布路由修复与短期令牌探测（2026-09-06）

- 已定位并本地复现此前发布 404：同层 `/applications/:id` 与 `/applications/:appCode` 混用，
  H3 radix 注册后续 sibling 时会使嵌套 `/:releaseId` 路由无法匹配。
  源码统一为 `[appCode]`；旧详情/更新/删除 URL 仍使用数值 ID，校验和权限没有改动。
  4 项真实 H3 分派回归覆盖 ops/admin/tenant-admin/_handlers 的正反注册顺序。
- `fix-platform-application-routes.mjs` 只为现有开发构建修正 16 条 route 参数名和 3 个 ID parser，
  不部署其他 HEAD 变更。先备份并执行语法校验，只重启 `hzy-platform-dev`，其他 PM2 PID 未变。
  备份位于 `backups/platform-application-routes-20260905`，未来完整构建由对应源码重命名接替此热修复。
- 真实管理员浏览器再次点击发布成功：release **29**、`v0.1.6-dev.2040509e` 已显示 **released / latest**。
  这是开发控制面应用版本元数据发布，未发布生产 Worker 或创建 GitLab Tag。
- 国内进程调用正式 Platform bootstrap 接口返回 **200**，绑定 `C000001/test/wiztek-test-console`。
  使用该 90 秒引导 JWT 调用 Runtime 官方服务签发接口，精确 `console:directory-user:view` scope
  返回 **200**；所签 60 秒 JWT 读取测试 Directory 返回 **200**。
  issuer=`http://127.0.0.1:3000/console`、tenant/deployment 与测试绑定一致；令牌未输出或传回本机。
  Runtime 按官方签发流程确保自己的 `console.runtime` 服务身份、Vault credential 和 grants，未导出私钥。
  首次误用不存在的 `console:directory:read` scope 返回 **403 grant_inactive**；按源码精确 scope 更正后通过，未为错误 scope 补宽权限。
- Platform **263 tests**、typecheck、定向 lint 通过；热修复脚本增加 2 项边界测试。
- 本轮末核验发现本地两个 Nuxt 进程已退出（3000/3007 无监听），而原 SSH 隧道 PID 49785 仍在。
  保留该隧道，以 Node 24 和各 2048 MiB V8 heap 重新启动 Console/People；随后完整 `local.mjs --check` 通过。
  部署脚本测试现为 **21 项通过**；Console 仍准确提示缺少服务身份，People 的 disabled scheduled task 警告不构成登录验收。

上述为接通本地 Gateway 前的阶段性探测，不应单独作为本地 BFF 验收证据。后续本机验收见本文顶部；
始终不得把长期业务 Runtime token、应用 client secret 或生产私钥补进本地 env。

## 生产业务数据导入（已完成）

用户已确认源为生产库，允许完整数据、不脱敏，保留测试账号、密钥、会话和集成配置。
范围固定为 Console / People，不含其他业务模块或 legacy Account。

- 日本生产 MySQL 仅执行 SELECT / `mysqldump --single-transaction --quick`，不加表锁、不改数据、不重启服务。
- `data-refresh-plan.mjs` 明确列出 **Console 24 张、People 17 张业务表**；未知表失败关闭。
  原始姓名、联系方式、私密人事事实、稳定 UID、工号、部门和项目编码均保持原值。
  `org_profiles.tenant_code` 唯一改为测试标识 `HTEST001`，避免请求误绑定生产租户。
- 导入包含生产 Directory **100 位用户、395 条外部身份映射、24 个部门、64 个项目**，
  People **92 位员工、118 条任职、456 条私密事实**。另保留 Console 的 `test-user-001` 测试账号及其部门/成员关系。
  原合成 People 员工仍在回滚库中；不将其冲突工号覆盖到生产员工集合。
- 不覆盖测试 Vault / signing / auth / service-client / sessions / integration / connector 配置。
  不复制生产实时同步队列、operation/receipt、通知投递状态、runtime cache 或认证/凭证审计日志；
  这些运行态表保留测试原值，避免重放生产任务。完整清单见 `preservedTables`，不能称作整库逐表原样克隆。
- 原测试库先做加密备份，恢复到全新候选库后导入业务快照。逐表核对源导出前后与目标行数、
  SQL 内容 SHA-256、保留表内容哈希，两个候选库外键孤儿数均为 **0**；People→Directory UID 引用校验通过。
  行数核对不代表两个不同源库具备跨库同一时间点快照；每个库分别使用一致性事务导出。
- 快照在日本进程内 gzip + AES-256-GCM 加密，数据密钥由国内 RSA-OAEP 公钥封装。
  本机只转发密文，不写生产明文、私钥或数据文件；国内验证 GCM tag 后才向 MySQL 传入 SQL。
  本机及 Git 仅有脚本、表名、计数和验收截图，没有生产原始数据。
- 2026-09-05 **15:38:28 UTC** 已切换测试 Runtime 到候选库；健康状态正常，未认证目录请求返回 401。
  本地 Console / People 页面均返回 200。此检查不表示浏览器业务读写、SSO 或完整授权已通过。
- 导入后观测 MySQL 约 380 MiB / 896 MiB，Runtime 约 8.4 MiB；生产 Platform 和旧 Console-test PID 未变化。

受保护的服务器备份目录：`/wiztek/hzy-test/backups/production-business-20260905`（0700）。
其中含加密快照、解密私钥（0600）、原 Runtime 配置和 `complete.json` 计数/校验回执；不要复制到本机或聊天。
原测试库未删除，可在停止测试 Runtime 后恢复该目录的原配置并重启测试服务以回滚；操作前先保留当前配置与新测试写入。

已执行的一次性步骤如下，**不是可重复执行的日常刷新命令**：

1. 国内 `refresh-business.mjs --prepare`：验证原测试绑定、加密备份、生成接收公钥。
2. 本机 `transfer-business.mjs --execute`：经 SSH 执行只读 `export-business.mjs`，只转发密文；国内 `--receive` 验证密文完整性。
3. 国内 `refresh-business.mjs --restore`：只创建固定候选库、恢复、校验并合并已审阅的合成账号。
4. 国内 `refresh-business.mjs --cutover`：验证未发生配置/保留表漂移，仅切换测试 Runtime；健康失败自动恢复原配置。

再次刷新必须先审阅表清单和新产生的测试数据，使用新的备份/候选库版本；不可删除回执重跑。

## Platform-dev 国内登录

`configure-platform-wecom.mjs --execute` 已仅更新国内 `hzy-platform-dev`：

- **最新核验：** 用户指定 AgentId `1000010`（不是 `1000007`）。检查时保存配置和实际进程的
  `WECOM_AGENTID` / `NUXT_AUTH_WECOM_AGENTID` 已均为 `1000010`，无需重复修改或重启。
  桌面 / 企业微信客户端 OAuth start 均 302，均携带 `agentid=1000010` 和 `hzy.wiztek.cn` 回调。
  腾讯 `agent/get` 返回成功；真实浏览器已显示“汇智云平台”的企业微信登录二维码，不再出现此前域名错误。
  此次只核验已生效状态，没有改变 CorpSecret、白名单或生产配置。用户随后明确确认“已成功登录”，
  因此扫码登录标记为用户验证通过；管理员操作权限、业务应用授权和 Runtime 端到端调用仍单独验收。
- 复用现有企业微信身份应用和 **3 人白名单**，`allowAll=false`；开发 DB、签名密钥及会话仍独立，开发模拟登录保持关闭。
- 配置备份在 `/wiztek/hzy-test/backups/platform-wecom-20260905`（0700），密钥未进入本机或 Git。
- 企业微信 gettoken 校验成功；桌面和企业微信客户端 OAuth start 均 302，域名切换后回调固定为
  `https://hzy.wiztek.cn/api/platform/auth/wecom/callback`；错误 state 返回 403。
- 历史检查：真实浏览器检查了 1440 / 390 宽登录页，按钮可见、无横向溢出、无页面异常。
  点击后腾讯授权页明确返回 **“redirect_uri 与配置的授权完成回调域名不一致”**。
  仅 HTTP 200 或 HTML 含 QR 字段不足以证明授权可用，**目前不能称作企业微信登录已验收通过**。
- 用户随后确认生产 Platform 在 Cloudflare `huizhi.yun`，授权将旧 `hzy.wiztek.cn` PM2 入口改为开发环境。
  域名切换后真实浏览器仍收到同一腾讯错误。只读 `agent/get` 返回 `redirect_domain=hzy.wiztek.cn`、
  `home_url=https://hzy.wiztek.cn`，但这些字段不足以证明桌面扫码的授权完成回调设置正确。
  当时需要核对扫码授权回调设置；现已通过上面的 AgentId 1000010 二维码核验。不能将 HTTP 302 或二维码显示称作完整登录成功。
- 个人微信的现有 `dev-wechat-login` 只是模拟入口，未启用。正式个人微信登录还需确认微信开放平台网站应用、
  AppID/AppSecret 的安全配置位置与获准回调域名，然后实现并验证真实授权链路；不能以企业微信入口冒充个人微信。

本轮脚本语法检查、11 项本地部署隔离测试、实际候选库恢复与切换验证均通过。
尚待完成：登录后业务权限验收、个人微信正式应用资料、C000001 测试环境的隔离 Runtime 绑定和短期 bootstrap/服务 JWT 链路、Cloudflare 测试发布。
后续只读检查确认开发库中 `HTEST001` 的 tenants / deployments / tenant_runtime_instances 记录均为 0。
浏览器连接曾不可用；桌面应用重启后已恢复，已读取登录后的管理员工作台及 C000001 企业工作台。
根据用户最新决定停止新建 HTEST001 的计划；
未创建虚假管理员会话、未放宽 internal token 权限，也未直接伪造 ready Runtime 绑定。

## 开发 Platform 域名切换（已完成）

2026-09-05 17:25:14 UTC 经用户明确确认切换：

- `https://hzy.wiztek.cn` → 国内 Nginx → `127.0.0.1:3011` → `hzy-platform-dev` → `hzy_platform_dev`。
- 原 `https://platform-dev.wiztek.cn` 返回 **308**，保留路径/query 跳转至 `https://hzy.wiztek.cn`；请从新域名重新发起登录。
- `PLATFORM_SERVICE_URL` / `NUXT_PUBLIC_SERVICE_URL`、激活基础 URL、Google / WeCom 回调及 Nuxt 对应变量已同步改为新域名。
  DB、服务凭证、WeCom 应用/白名单、开发签名密钥和会话表未改变；Google 凭证仍为空，不因 URL 切换自动启用。
- `hzy.wiztek.cn` 证书由过期状态续期至 **2026-12-04 16:23:30 UTC**；原开发域名保留有效证书以完成 HTTPS 跳转。
  `hzy-test-platform-cert.service` 现在仅续期这两个开发域名，原每日两次 timer 继续启用。
- 旧 `hzy-platform-prod` PM2 进程（3010）未停、未改配置；只是用户批准的 `hzy.wiztek.cn` Nginx upstream 改为 3011。
  Cloudflare `huizhi.yun` 登录页仍 200，Google start 302 且回调仍指向 `huizhi.yun`。
  生产 WeCom start 切换前已是 503，本次未修改这个已有缺项。
- 本机真实浏览器 1440 / 390 宽验证页面标识为“平台测试控制面”，无横向溢出和 pageerror。
  切换时腾讯二维码未显示，返回回调域名不一致；后续 AgentId 1000010 核验已正常显示二维码，用户已确认扫码登录成功。
- 新域名错误 OAuth state 返回 403；带开发内部凭证的 HTEST001 bootstrap 请求返回原有 409（绑定尚未注册）。

脚本：`switch-platform-domain.mjs --prepare` 先备份，再续期指定证书，最后 `--execute`。
备份与完成回执位于国内 `/wiztek/hzy-test/backups/platform-domain-hzy-20260905`（0700），不要下载其敏感配置。
脚本拒绝已完成重复执行、配置漂移、非开发库或不符合预期的 upstream。

注意：此服务器 Nginx 在运行，但 `nginx.service` 为 inactive，不能使用 `systemctl reload nginx`。
两次切换尝试因此未通过，并已恢复配置；最终使用 `nginx -t` + `nginx -s reload` 平滑重载成功。
验证会等待旧 worker/keepalive 连接退出，不用首次请求就判断重载已完成；未改变服务器现有 Nginx 启动管理方式。

通用 `plan:public-routing` 和旧模板仍包含历史默认拓扑，不可直接拿它覆盖本环境。
新 Runtime enrollment、测试 Gateway 与 Console 的 Platform URL 应使用 `https://hzy.wiztek.cn`，
对应精确 `iss/control.platformUrl`；不可沿用旧域名作为签发方或改用生产 `https://huizhi.yun`。

## 暂停与恢复

本地对本启动命令按 Ctrl-C；服务器端按需停止**这两个测试服务**：

```bash
ssh root@gitlab.wiztek.cn 'systemctl stop hzy-test-data-runtime && docker stop hzy-test-mysql'
```

恢复时先 `docker start hzy-test-mysql`，待数据库健康后 `systemctl start hzy-test-data-runtime`。
停止不会删除测试数据。不要删除 `/wiztek/hzy-test`、卸载既有 MySQL/Keycloak 或操作生产 C000001。
