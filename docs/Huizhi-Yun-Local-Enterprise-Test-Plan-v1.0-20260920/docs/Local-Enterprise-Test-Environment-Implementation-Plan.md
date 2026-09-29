# 汇智云本机 Enterprise 测试环境实施方案

**PM2 / Caddy / 既有 Tunnel，复用已在本机运行的 Runtime 与数据库**

版本：1.0
编制日期：2026-09-20
状态：待实施、待本机参数核验；本文件不代表已部署或已验收。
源码核对基线：`feat/adr018-enterprise-integration`，提交 `559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63`。
建议归档：`docs/Local-Enterprise-Test-Environment-Implementation-Plan.md`。

> **决策摘要：把本机前端作为日常开发和业务联调入口，保留 Cloudflare Workers 作为平台兼容性与发布前验收入口；两者复用现有本机测试 Runtime 和数据库。先沿用 Runtime 公共地址接通，再在已验证的身份边界内改为本机回环通信。**
>
> 本次不搬数据库、不新建第二个 Runtime、不更换数据库事实源、不自动修改现有 Cloudflare Worker、Tunnel 或认证信任。本文给出实施合同、配置样例和操作顺序；标记为“拟新增”的脚本与配置读取器需要先实现，不能把附录命令当作当前仓库已经可运行的工具。

## 目录

1. 现状、依据和必须确认的参数
2. 目标、范围及完成定义
3. 目标拓扑与部署职责
4. 代码改造范围与交付物
5. 身份、OIDC 与共享后端接入
6. 路由、静态资源和本地受信网关
7. Runtime 两阶段传输适配
8. 配置管理与环境隔离
9. PM2 开发模式和 Node 构建模式
10. Caddy 与既有 Tunnel 接入
11. HMR、文档编辑器和实时连接
12. 测试数据、后台任务与运行保护
13. 实施工作包与阶段门禁
14. 首次启动和日常操作 Runbook
15. 验收矩阵及证据要求
16. 回退和退出方案
17. 常见故障定位
18. 后续边界与实施任务输入
19. 资料来源和文档适用范围

---

## 1. 现状、依据和必须确认的参数

### 1.1 用户已确认的事实

| 项目 | 已确认内容 | 本方案处理 |
| --- | --- | --- |
| 数据库 | 测试数据库已经运行在本机 | 复用，不迁移、不改变管理方式 |
| Runtime | 测试 Runtime 已经运行在本机 | 复用既有实例，不由新 PM2 栈重复启动 |
| Runtime 对外入口 | `https://hzy-test-runtime.isme.dev`，经既有 Tunnel 到本机 | 保留云端调用；初期本机 BFF 也沿用它 |
| 本机前端入口 | 已配置 `hzy0.isme.dev` 的 Tunnel | 核对现有 upstream，只调整获准的这个入口 |
| 云端测试前端 | `hzy-test-*` Workers | 保留，承担 Cloudflare 专项验证 |

上述物理部署事实来自本轮用户确认，而不是从历史部署文档推断。旧说明中的“远端 Runtime、国内主机、SSH 转发”等不能继续作为本次本机拓扑的依据。

### 1.2 本轮源码核对结果

| 代码或文档 | 已看到的内容 | 不能直接推出的结论 |
| --- | --- | --- |
| `deploy/dev-stack/ecosystem.config.cjs` | 已有 PM2 多应用启动、端口与配置处理；列出的旧应用集合未包含 Enterprise | 不能直接运行旧栈就宣称完成统一 Host 本地接入 [R04] |
| `deploy/dev-stack/Caddyfile.local` | 按旧应用前缀转发的本地代理基础 | 不代表当前 Host、编辑器、认证及新路由已经接通 [R05] |
| `deploy/test-env/local-gateway.mjs` | 复用生产头处理、测试身份和本地转发；当前限定 Console/People，并包含远程上下文获取 | 可复用机制，不照搬固定端口、远端 SSH、旧部署值 [R06] |
| `enterprise/nuxt.config.ts` | Host、明确页面注册、`ssr: false`；pilot 回调写入云端测试域名 | 本次要参数化，不能只改一个公共 URL 后沿用全部 pilot 假设 [R07] |
| `enterprise/package.json` | 有 dev、build、typecheck、test 和独立 Cloudflare 构建脚本 | Node 与 Worker 产物应分别生成、分别验证 [R08] |
| `localDevRuntime.ts` | `NODE_ENV=development` 可触发 dev 模式，bypass 默认受开发配置影响 | Nuxt dev 模式不等于正式权限测试模式；必须显式关闭 bypass [R10] |
| `tenantGatewayTrust.ts` | 可信请求头依赖服务端凭证验证 | Caddy 随手添加 tenant/app 头不是完整安全适配 [R09] |
| ADR-019 | 当前基线已为 v1.3，继续采用统一 Host/业务侧栏与部署适配原则 | 不因本机化退回多应用 Shell，也不重置已确认导航 [R03] |

本方案是针对上述固定快照的实施输入，不是全仓重新审计。实现时以实际开发工作树与相应正式合同核对差异；不要求把较新的工作树回退到该提交。

### 1.3 开工前填写的参数清单

下面不是需要用户提前提供全部秘密信息，而是实施者必须在本机完成的只读盘点。只记录摘要与引用，不把凭据、完整环境变量或业务导出提交到仓库。

| 编号 | 待核验项目 | 必须记录的非敏感结果 | 未核验时的限制 |
| --- | --- | --- | --- |
| ENV-01 | 实际仓库路径、工作树、未提交变更 | 路径、commit、dirty 状态、负责人 | 不清理、重置或覆盖他人修改 |
| ENV-02 | 本机 Runtime 的监听地址、协议、端口及容器网络 | 实际 endpoint、runtimeCode、版本与连接方式 | 回环阶段不可启动；第一阶段仍可用已批准公共 endpoint |
| ENV-03 | 本机 Runtime 对应租户/环境 | 与正式登记一致的 tenant、environment、deployment | 禁止只凭健康 200 就访问 |
| ENV-04 | 现有数据库和 Runtime 进程由谁管理 | 管理服务名/容器名、维护人、状态摘要 | 新脚本不得管理其生命周期 |
| ENV-05 | 两个域名的 Tunnel 管理方式与 ingress | 本地/远程管理、Tunnel 引用、各自 upstream、共享关系 | 不重建 Tunnel、不覆盖完整 ingress |
| ENV-06 | 已有 Caddy 监听、admin 地址及 PM2 实例 | 端口占用、管理方式、已有进程名 | 不使用 `restart all`、`delete all` |
| ENV-07 | Console 当前 canonical issuer/JWKS、上游 IdP、OIDC client | 正式地址与客户端标识、允许回调、作用域范围 | 不新建或覆盖认证根；本地登录不可宣布可用 |
| ENV-08 | Host/Console/编辑器调用身份与 Runtime binding | 客户端/部署映射、可签发能力、writer/scheduler 登记摘要 | 未批准的本地实例不得靠伪造云端头获得访问 |
| ENV-09 | 本机编辑器、Collab、Workflow 可用情况 | 正式 origin、WebSocket 路径、按需运行方式 | 未就绪功能标记不可用，不假装已迁入 |
| ENV-10 | 测试数据和副作用范围 | 可操作对象集、通知接收范围、任务当前 owner | 不做批量写、迁移或故障停机试验 |
| ENV-11 | 主机容量与系统依赖 | Node/pnpm、Caddy/PM2/cloudflared 版本，空闲内存/磁盘 | 不升级全局工具或耗尽 Runtime 资源 |
| ENV-12 | 外层测试访问保护 | 获准人员范围、入口访问控制、开发资源暴露检查 | Nuxt dev 入口不得匿名开放至互联网 |

历史代码出现的 `18080`、`C000001`、`wiztek-test-console` 等只作为核对候选，不把它们直接写成当前本机事实。用户未提供 Runtime 实际端口，本方案故意不替其赋值。

## 2. 目标、范围及完成定义

### 2.1 目标

- 通过 `https://hzy0.isme.dev/enterprise` 使用统一 Host 的已迁移功能。
- 日常使用 Nuxt dev/HMR，页面改动无需反复上传 Worker。
- 可切换到 Node 构建产物模式，验证开发模式以外的行为。
- 数据仍仅通过现有 Runtime 访问；登录、权限、签名用户委托、scope、幂等和审计不降低。
- Cloudflare 测试入口仍可用；本地模式通过不代表 Workers 专项已通过。
- 用实际“保存代码到页面可验证”的时间和请求路径证明效率改善，不预设百分比或毫秒承诺。

### 2.2 本次不做

不新建测试租户或业务数据库；不重复启动 Runtime；不修改生产授权；不实施合库或数据恢复；不启用 VPC；不新增通用 SQL API；不把所有旧应用、完整 Codocs 编辑器、Workflow 和 Collab 强制合进 Enterprise；不为本机测试绕过 OIDC 或策略校验。

部署身份、回调登记、secret 引用和入口切换属于需要明确批准的变更。本文授权范围仅是方案设计，不等于批准执行这些写操作。

### 2.3 环境与结论分级

| 层次 | 用途 | 放行含义 |
| --- | --- | --- |
| 本机 Dev | 页面/HMR、接口调试、ADR-019 行为回归 | 本机开发与联调可用 |
| 本机 Node 构建 | 固定提交、正式 Node 产物、相关业务链验收 | Node/self-hosted 适配验证通过 |
| Cloudflare Workers | Worker 构建、真实 Service Bindings、云端调度、资源预算、发布回退 | Cloudflare 部署专项通过 |

这三层不是三套数据库。默认本机和云端前端共享同一个测试后端；数据、任务与维护窗口必须协调。

## 3. 目标拓扑与部署职责

### 3.1 总体结构

```text
浏览器 / 测试人员
  |
  | HTTPS hzy0.isme.dev（限制测试人员访问）
  v
既有 Cloudflare Tunnel
  |
  v
本机 cloudflared
  |
  v
Caddy：单一入口、可信外部 URL 语义、WebSocket 转发
  |
  v
本地 Tenant Gateway 适配（复用现有契约）
  |-- Enterprise Host：统一页面与业务 BFF
  |-- Console：按获准身份模式提供协议/目录/BFF 门面
  `-- 必要的旧页面/编辑器/Workflow/Collab 兼容进程
         |
         | 第一阶段：现有 Runtime 公共 HTTPS endpoint
         | 第二阶段：经批准的同机 loopback HTTP(S) endpoint
         v
既有本机 Runtime（同一个实例、同一个正式 runtimeCode）
         |
         v
既有测试业务库 / 安全域存储

云端 hzy-test-* Workers
  `-- hzy-test-runtime.isme.dev -- 既有 Tunnel -- 同一个本机 Runtime
```

PM2 管新增进程；Caddy 不承担业务授权；本地网关不变成认证权威；Runtime 不因调用方在本机就省略验证。[R01][R02]

### 3.2 建议端口和进程名

以下全是**待端口盘点确认的建议值**，有冲突时由一个 profile 整体调整，不逐文件手改。使用单独区间，是为了避免直接占用历史 `3000/3010/3100/3180` 等端口。

| 服务 | 建议回环监听 | PM2 名称/归属 | 默认启动 |
| --- | --- | --- | --- |
| Caddy 入口 | `127.0.0.1:23180` | 复用既有 Caddy；不得接管其他站点 | 是，获准后添加站点 |
| 本地网关公共转发监听 | `127.0.0.1:23120` | `hzy0-gateway` | 是 |
| 本地网关受控服务转发监听 | `127.0.0.1:23121` | 同一网关的内部监听；不接 Tunnel | 只有正式服务调用需要时 |
| Enterprise | `127.0.0.1:23110` | `hzy0-enterprise` | 是 |
| Console | `127.0.0.1:23100` | `hzy0-console` | 正式身份方案通过后 |
| Codocs 独立编辑器/兼容应用 | `127.0.0.1:23101` | `hzy0-codocs` | 按文档任务需要 |
| Workflow | `127.0.0.1:23105` | `hzy0-workflow` | 按审批任务需要 |
| Collab | `127.0.0.1:23107` | 复用既有 owner 或 `hzy0-collab`，不得双启 | 按实时协作任务需要 |
| HMR 独立端口（如需要） | 本机独立端口，按组件分配 | 不对浏览器直接暴露 | 仅 Dev |
| Runtime/数据库 | **保持实际监听值** | 保持现有管理服务 | 不由本方案启动 |

“内部监听”不是只要来自 `127.0.0.1` 就可信。它仍必须验证调用进程的既有服务身份、来源绑定、目标与签名；同机其他进程不能借它任意注入 tenant、actor 或 scope。

### 3.3 按需启动与 Cloudflare 依赖

已迁入 Host 的 Aims/Assets 页面不需要同时启动完整旧 Aims/Assets。兼容页面确有需要才启动，对应进程及端口追加到 profile。Platform 保持现有控制面，不在本机额外创建另一套控制面数据。

第一阶段可以继续依赖已有测试 Console 的 canonical OIDC 服务及已批准的独立编辑器。这是有标记的过渡，不宣称已完成全部 Console 本地化。是否切换认证门面见第 5 节。

## 4. 代码改造范围与交付物

### 4.1 原则：一个环境入口，复用正式契约

在现有 `deploy/test-env/` 增加 `local-enterprise` profile 和薄启动适配；复用 `deploy/dev-stack/` 的进程管理经验，不复制它的完整旧应用表和 DB 环境注入。现有 Console/People 专用网关保留兼容，公共安全函数尽量共享。[R04][R06]

建议目标文件组织如下，均属于**拟新增/拟修改**，不是当前已经具备的命令：

```text
deploy/test-env/
  local-enterprise.mjs                 # plan/doctor/up/status/logs/down/build 等薄 CLI
  local-enterprise/
    profile.example.json              # 无秘密模板
    config.mjs                        # 配置校验与受控生成
    gateway.mjs                       # Node transport + 既有网关契约
    run-process.mjs                   # 最小环境、进程信号、Dev/Node 选择
    test/*.test.mjs                    # profile/路由/头/传输/退出回归
  Caddyfile.hzy0.example               # 单站点示例，不覆盖全局 Caddy

docs/
  Local-Enterprise-Test-Environment-Implementation-Plan.md
```

非秘密的路由输出与契约快照遵守现有生成物管理规则；环境 profile 实值、日志、PM2 状态、dotenv、secret 引用解析结果不得写入 Git。统一实施台账继续使用现有 `Unified-Enterprise-Implementation-Plan.md`，增加本方案工作包引用，不另建竞争性的总进度表。[R14]

### 4.2 逐文件改造清单

| 位置 | 必须完成的改造 | 验收要点 |
| --- | --- | --- |
| 新 profile/CLI | 非秘密配置、必填检查、端口/进程命名、启动计划、只管理本栈 | 空占位值和错误环境拒绝；不影响 Runtime/数据库 |
| `enterprise/nuxt.config.ts` | 将公共 origin、回调、登录前缀与静态资源前缀和 Cloudflare pilot 开关解耦 | 本机不跳回云端回调；云端原配置测试保持通过 |
| Host/模块首页与返回逻辑 | 增加受控 Host 首页路径；避免本地品牌链接 `/` 误回 Console | 一级入口、旧链接、对象返回符合当前 ADR-019 |
| 本地网关/共享路由生成器 | 使用正式页面/API 登记；处理 Console 协议、旧 Shell、静态资源与 Upgrade | 未登记写 API 不进入 HTML 兜底；前缀不丢失 |
| Foundation 服务客户端 | 明确 Node HTTP(S) 与 Service Binding 的传输差异；保留身份/授权/错误语义 | 不修改每个业务 handler，不扩大可请求 origin |
| Runtime 客户端 | 第二阶段支持 canonical endpoint 与 approved dial endpoint 分离 | 公网与回环命中同一 Runtime；签名绑定不变 |
| Console/OIDC 配置读取 | 依第 5 节冻结的 issuer/client/deployment 实施，禁止启动时再 bootstrap | 不覆盖共享信任，原云端登录仍通过 |
| Nuxt Dev/HMR | 同域 `wss`、固定允许 Host、不同进程 HMR 路径/端口不冲突 | 真正热更新，不能偷偷直连浏览器 localhost 端口 |
| 独立编辑器/Collab | 保留 origin/source/ACL/短期协作令牌和保存路径 | 打开、保存、断线恢复、退出与撤权验证 |
| 文档与生成物校验 | 同一源码、路由 hash、配置摘要、测试矩阵 | 不以页面 200 或 mock 通过替代环境联调 |

## 5. 身份、OIDC 与共享后端接入

### 5.1 先冻结身份方案，再开放登录和写入

“换成 PM2”只改变进程承载，不自动产生一个获授权部署。必须区分以下对象：

| 对象 | 本方案处理 |
| --- | --- |
| 操作系统进程名 | 使用 `hzy0-*`，仅是进程标签 |
| 物理 Host appCode | 保持正式 `enterprise` 语义，不用菜单名替换 |
| 逻辑业务模块 | Aims/Assets/Codocs 等保持其正式资源与能力 |
| OIDC client / service client | 从当前正式配置读取，新增/追加配置需批准 |
| Host deployment | 本地实例是已批准副本，还是独立部署，必须有记录 |
| Runtime runtimeCode / deployment | 保持现有测试实例，不重新 enrollment |
| writer/scheduler owner | 不因增加一个前端进程而改变 |

**推荐决策顺序：**

1. 核对能否把本机前端登记为现有测试部署的获准副本，并为本地 callback 增加精确允许值；继续使用正式客户端和授权方式，不复制 raw secret 文件。只有正式模型允许、版本兼容且获批准时才能采用。
2. 若需要独立本地 deployment，先确认 Runtime 的 Host binding、Console client 和策略支持。创建的是受控部署身份，不自动创建新租户或数据库。
3. 若当前 binding 只支持单一宿主且不支持并行，不放宽相等检查或共享 root token。选择获准时间窗切换，或先实施一个限定的多部署绑定改造；两者均必须明确审批与回退。

不要机械地创造 `enterprise.local.runtime` 并替换所有校验；代码中可能固定了正式客户端语义，必须沿其合同处理。

### 5.2 issuer、浏览器入口与实际连接地址分别记录

这是共享 Runtime 最重要的前置检查。

```text
canonical issuer / JWKS：既有正式认证信任
public origin：hzy0.isme.dev（新前端浏览器入口）
internal origin：127.0.0.1:<端口>（仅实际 HTTP 传输）
```

不能因为 Console 页面在本机，就把共享 Auth Runtime 的 issuer 改成 `hzy0.isme.dev` 或 `localhost`。若当前 Runtime/签名实现每部署只保存一个 issuer，两套 Console 不得交替启动并覆盖它。

本方案按以下门禁推进：

| 身份方式 | 使用条件 | 结论范围 |
| --- | --- | --- |
| 保留现有 canonical Console OIDC，Host 回调登记到 hzy0 | 当前客户端允许精确回调，服务授权和用户委托验证通过 | 最小本机 Host 阶段的首选过渡；不改变 Auth 信任根 |
| 本地 Console 为现有权威认证的门面 | 实现确实支持公网协议地址/issuer 与传输地址分离，且不会 bootstrap/改信任 | 可以纳入同机栈；须完成两段登录和云端非回归 |
| 为本地重新设 issuer 或建立隔离 Auth | 当前单 issuer 模型无法满足，又确需该能力 | 超出默认范围，另行批准；不在启动脚本中悄悄完成 |

第一行和第二行是显式阶段选择，不是在登录失败时自动切换的 fallback。不能仅凭同一个 Runtime URL 假定两种登录拓扑兼容。

### 5.3 回调地址与两段认证

固定浏览器入口为 HTTPS。保留已登记 issuer；只新增/核对当前阶段需要的精确客户端地址。

| 协议链 | 需要核对的值 |
| --- | --- |
| Enterprise → Console IdP → Enterprise | 建议外部回调 `https://hzy0.isme.dev/enterprise/api/auth/oidc-callback`；退出后页面 `https://hzy0.isme.dev/enterprise/login`；按实际 handler 校验 |
| Console → 上游企业 IdP → Console | 根据现有 Console base path/handler 登记回调；不得把 Enterprise 回调填到上游 Console client |
| 服务令牌签发 | 既有精确 service client、audience、tenant、deployment、能力组合 |
| JWKS / discovery | 返回 canonical issuer；不能泄漏 loopback URL，也不能由任意 `Host` 推导信任根 |

必须核对 state、nonce、PKCE、授权码一次性使用、Cookie 名称/Path/Domain、Secure、SameSite、刷新与退出。具体 SameSite 按既有 OAuth response mode 和编辑器场景确定，不统一改成宽松值。

本地 Cookie 默认限本机公共主机的合理范围，不能设为整个 `.isme.dev` 来分享会话。通过 Runtime 公共域名调用 API 不需要共享浏览器 Cookie；服务间继续使用正式短期身份。

若使用同一上游企业 SSO，明确退出是否会影响云端测试甚至正式企业 SSO 会话。建议独立浏览器 profile 执行测试，不修改上游全局退出语义来掩盖差异。

### 5.4 启动循环和秘密边界

启动器不得重新执行 Runtime enrollment、初始化 OIDC 私钥、改写 JWKS overlay 或创建默认管理员。需要的引导只使用已经批准的受限机制，不能用控制面注册 token 替代业务 JWT。

数据库密码、Vault 主密钥、OIDC 签名私钥和权威 Session 仍只在 Runtime/原安全存储。PM2/Console/Host 不接收这些内容。[R01]

入口网关凭证只证明请求来源；它不产生用户身份。服务调用在网关来源验证后仍要经过原 client policy、signed actor 和 scope 检查。[R09][R11]

## 6. 路由、静态资源和本地受信网关

### 6.1 第一阶段公共路径方案

首轮不顺带重命名全站 URL。建议保留 Console 根入口的既有契约，Host 明确从 `/enterprise` 进入；Host 品牌、首页和登录完成后的返回采用该入口配置，不硬编码 `/`。是否最终将站点根目录切到 Host，是后续单独的导航切换。

| 外部请求 | 第一阶段处理原则 |
| --- | --- |
| `GET/HEAD /enterprise`、`/enterprise/` | 进入当前已登记、对该用户可访问的 Host 默认页；安全导航的临时定向 |
| `/enterprise/login` | Host 登录页，保留原请求路径 |
| `/enterprise/api/auth/**` | 只按现有 Host 适配规则映射到真实认证 handler；方法、query、body 保留，不 302 写请求 |
| `/enterprise/api/navigation` | 当前正式导航 API，不能误剥成另一端点 |
| `/enterprise/_nuxt/**` | Host 静态资源；Dev 的 Vite 内部路径/HMR 按实际生成登记 |
| 已登记 `/aims/**`、`/assets/**`、`/codocs/**` 页面及 API | 精确匹配当前 Host/路由产物，不全前缀劫持 |
| 未迁入但正式可用的页面/API | 仅在批准兼容路由和进程存在时进入原实现；缺依赖明确不可用 |
| `/shell/{appCode}?target=...` | 已迁移目的地转换为顶层 Host 导航；旧 Console SPA 点击也必须覆盖 |
| Console 的公开协议、基础服务、静态资源与页面 | 依它的正式登记进入 Console；根目录或 `/console` 形态须在 ENV-07 冻结 |
| 独立编辑器与协作连接 | 精确路由或已批准独立 origin；不让整个 `/codocs/*` 进入错误宿主 |
| Runtime、数据库、内部 drain、通用代理及调试管理路径 | 不经 hzy0 对普通浏览器公开 |

未知 API 不回落为 200 HTML 首页；不存在路径返回 404，明确尚未就绪的已登记能力使用原有 503 语义。401/403/409/5xx 不被网关改成占位成功。

### 6.2 路由只有一个正式来源

复用 `enterprise/composition/registry.mjs`、现有 API readiness 生成器及 Gateway 页面清单。Node 适配读取同一 release 下的生成登记，Caddy 不维护另一份业务白名单。需要兼容的未迁移端点也必须显式登记，不使用运行时失败后自动切旧服务。

当前 `enterprise-topology.mjs` 将环境和域名绑定到云端测试。应保留该验证，抽出可注入的 profile/共享 resolver 或新增限定的 hzy0 resolver；不要简单去掉 hostname、tenant 与 deployment 检查。[R12]

路由安全顺序建议为：标准化 URL → 拒绝非法路径/内部公网访问 → 判定协议/静态资源 → 精确页面/API 注册 → 受控旧入口转换 → 明确的未匹配结果。API 要以 method + path 匹配；动态段不得吞掉保留的 `new` 或无效对象标识。

### 6.3 Node 网关必须复用的安全与传输行为

- 公共请求的 `x-hzy-*`、伪造 Forwarded、内部 scheduler/部署/token-source 等头先清理；tenant、environment、appCode、deployment、Runtime identity 由服务端批准配置生成。
- 保留合法用户 Cookie、Authorization、CSRF、If-Match、Idempotency-Key 等原业务需要的字段；不把用户 access token直接用成 Runtime service token。
- 内部服务转发按原来源规则校验，不借公共入口清理逻辑抹掉已经验证的 service-token-source；可用内部 listener/Unix socket 实现，但仍验证身份。
- 保留真实 public host/scheme，内部 socket 地址不是用户看到的 origin。审计客户端 IP 不能信任浏览器自己发来的 `X-Forwarded-For`。
- 请求/响应正文按流转发；签名覆盖的原始字节不能随意 JSON 重编码。正确保留多个 `Set-Cookie`。
- Fetch 自动解压与响应头必须一致，不转发错误的 `Content-Encoding/Length`；hop-by-hop headers 按 HTTP 转发规则处理。
- WebSocket、SSE、上传下载、取消、超时和背压需要实际测试。写请求不在代理层自动重试或重发到另一上游。
- 对内部 URL 与重定向目标使用封闭映射；浏览器不得提供 upstream、Runtime URL、service ID 或 tenant 选择权。

这些是现有正式能力的 Node 传输适配，不另建一个业务权限中心。首轮仅支持当前获准测试租户，结构化 request context 仍保持每请求隔离，不能把全局变量当作当前用户。

## 7. Runtime 两阶段传输适配

### 7.1 阶段 A：继续使用现有公共 endpoint

```text
本机 BFF → https://hzy-test-runtime.isme.dev → 既有 Tunnel → 本机 Runtime
```

先用已正常工作的网络路径验证本机 Host/Console 的身份、查询和写入。此阶段不减少 Runtime 网络绕行，但已经能减少前端构建上传的等待。

本地进程仍须通过正式 endpoint/服务身份检查；现有公共入口如还有 Access、mTLS 或服务令牌要求，必须照原契约处理，不关闭验证。

### 7.2 阶段 B：固定 Runtime 身份，切换实际连接地址

```text
本机 BFF → http(s)://127.0.0.1:<实际端口> → 同一个 Runtime
云端 Workers → 现有公共 endpoint → 同一个 Runtime（保持不变）
```

只在 Runtime 与调用进程确实共用同一网络命名空间且回环可达时采用 `127.0.0.1`。Docker 容器内的 localhost 不是宿主机；若需主机映射/私有容器网络，单独冻结地址，不把 Runtime 绑定到 `0.0.0.0` 作为默认修复。

拟新增配置区分：

| 属性 | 含义 |
| --- | --- |
| canonicalEndpoint | 正式注册的 Runtime 公共标识/连接契约 |
| transportMode | `public-https` 或 `loopback`，仅由受控本地配置选择 |
| dialEndpoint | 实际建立连接的本机地址；第一阶段为空 |
| expectedRuntimeCode / expectedTenant / expectedEnvironment | 请求身份的核对条件，不从 dialEndpoint 推导 |

实现点优先在集中 Runtime client 或 transport adapter；如果某签名/受信策略覆盖 URL/Host，保持其正式规范化语义，只在最终 transport 层选择 socket 目标。不能简单字符串替换后跳过 endpoint 签名比对，也不能将 `localhost` 写回全局 Platform 登记。[R11]

阶段 B 进入条件：

1. 本机健康/身份摘要与公共路径一致；业务请求继续验服务 JWT 和用户 permit。
2. 配置只在明确 Node 本地测试 profile 中启用；Cloudflare 的私网目标限制及其他租户默认行为不变。
3. 明确公共入口原有 Access/WAF/限流哪些被绕开，必要保护在应用或本机接入层落实；不能只凭 localhost 放行敏感管理 API。
4. 分别验证权限拒绝、过期、响应丢失、错误端口和跨租户错配。
5. 切换只影响本机进程，无自动公网 fallback、无双发写请求。

**传输失败时只能明确报错或经批准手工回退；不能以错误为条件静默尝试另一 Runtime。**

## 8. 配置管理与环境隔离

### 8.1 一个 profile，生成多个进程的受控配置

配套 `templates/local-enterprise.profile.example.json` 是**拟定结构**，不是现有 Nuxt 自动识别的配置。实现 `config.mjs` 后才能使用。

非秘密 profile 保存 public origin、端口、功能范围、预期身份引用、transport mode 和输出目录；秘密只保存受保护引用，由正式提供方式按进程最小需要注入。禁止把整份 `.env.dev`、Runtime 配置或 PM2 dump 复制给所有进程。

建议配置优先级：仓库可提交默认值 → 本机获准非秘密 profile → 受保护逐进程配置 → 经审核的强制测试安全值。CLI 必须输出配置来源摘要，不输出值中的秘密。遇到冲突先报错，不默默采用生产默认。

### 8.2 Dev 模式也使用正式测试权限

当前 `localDevRuntime.ts` 的 mode 判定意味着只设置 `NODE_ENV=development` 不够。[R10] 本地共享联调进程显式使用：

```dotenv
# 以下名称由当前 Foundation 读取；不是新增模拟用户机制。
HZY_APP_RUN_MODE=test
HZY_PLATFORM_ENVIRONMENT=test
HZY_DEV_APPLICATIONS_ENABLED=false
HZY_LOCAL_DEV_APPLICATIONS_ENABLED=false
HZY_LOCAL_DEV_RUNTIME_BYPASS=false
HZY_DEV_RUNTIME_BYPASS=false
HZY_CONSOLE_DEV_POLICY_BYPASS=false
CONSOLE_DEV_POLICY_BYPASS=false
```

Dev 进程仍可用 `NODE_ENV=development`；Node 构建服务使用 `NODE_ENV=production`，但其业务 environment 和 run mode 仍为 test。本方案不会通过设置 `NODE_ENV=production` 将测试注册变成生产。

上述值应由启动器生成，不要求操作者长期手动维护八个等价开关。doctor 必须验证最终有效 `runtimeBypassEnabled=false`，不能只检查某一个 env 字符串。

### 8.3 Nuxt 构建时与运行时配置分开

Nuxt 的构建产物不会自动读取 `.env`；运行时覆盖必须使用已声明的 `runtimeConfig` 和匹配的 `NUXT_*` 名称。只在 `nuxt.config.ts` 中读取 `process.env.HZY_*` 的值，可能已经在构建时固化。[T02][T03]

因此：

- 构建期输入：页面注册、资源前缀、Node/Worker preset、白名单组件与 CSS 源。
- 运行期输入：服务器私有连接/身份引用、受控公开 origin 与环境提示；通过正式 runtimeConfig 或服务器配置读取器解析。
- `runtimeConfig.public` 只放浏览器需要的非敏感信息；不放 Runtime 凭据、数据库地址、网关秘密或完整授权包。
- Dev 与 Node 构建模式必须通过同样的地址和身份检查；不能在 Dev 成功后靠 `.env.dev` 的隐式读取让 build 模式失效。
- 不在运行期依赖源码目录读取 manifest；路由/能力配置应生成到确定的构件，并校验新鲜度。

### 8.4 本机配置与 PM2 存储

建议独立 `PM2_HOME`，例如 `$HOME/.local/state/huizhi-yun/hzy0/pm2`，避免污染已有进程管理。PM2 支持不同 home 运行独立守护实例。[T06]

PM2 会继承启动 shell 的环境。[T05] 启动器需要受控 env allowlist，并避免把 DB/Vault/OIDC 私钥等既有 shell 环境带入新 PM2 守护进程和应用；不能只删除最终对象中的几个已知字段。dotenv 文件权限为 0600，父目录 0700；PM2 日志、dump、诊断报告同样按敏感工件处理。

新栈进程只使用 `hzy0-*` 前缀。不要执行全局 `pm2 save`、`pm2 startup`、`pm2 kill` 或 `pm2 delete all`；必要自启动在本机模式验证后另行配置，并确认不会把不该开机运行的 Dev 服务暴露到公网。

## 9. PM2 开发模式和 Node 构建模式

### 9.1 日常 Dev

PM2 管理 Nuxt dev；Nuxt/Vite 管理代码热更新。建议初期 `instances: 1`、`exec_mode: 'fork'`、`watch: false`，不要 PM2 再监听整个仓库并重复重启。[T04]

使用确定的 Node/pnpm 二进制和各应用 cwd，按绝对路径调用工具，避免终端 nvm 与后台 PATH 不一致。配套 `templates/ecosystem.hzy0.example.cjs` 给出 PM2 进程结构，但它依赖 LET-01 待实现的 runner，缺少实现时明确报错；实际启用的应用集合仍由获准身份阶段决定。本次仓库 `.nvmrc` 为 `24.18.0`；实现仍以当前工作树 `.nvmrc` 和锁文件为准，不为此强制升级全局运行环境。[R13]

建议选择当前任务必须的进程；为共享 Runtime 和 MySQL 预留内存。V8 heap 参数不是 RSS 硬上限；不要初期直接 `instances: max` 或多个应用并行重型构建。

当前 Enterprise 的 `dev` 脚本带有固定的 `--port 3010`，因此不能只设置 `PORT=23110` 就继续执行旧脚本并假定它会使用新端口。[R08] 实现的运行器应明确传入 Nuxt CLI 参数，例如：

```bash
# 这是启动器完成 profile 映射后的等价命令示意，不代替前置鉴权/路由配置。
# SAFE_ENV_FILE 必须为已生成、审核且权限受控的绝对路径，不是旧 .env.dev。
# 由运行器显式设置 NODE_ENV、测试安全开关、身份引用及其他所需环境。
pnpm --dir enterprise exec nuxt dev \
  --host 127.0.0.1 --port 23110 --dotenv "$SAFE_ENV_FILE"
```

Dev/build 都选择明确的 dotenv 输入，不默默合并工作树内历史 `.env`；运行器在加载应用之前完成预检。Node 构建模式则由运行器显式注入运行时配置，不期望产物自动加载 dotenv。

### 9.2 Node 构建验证

使用 Nuxt Node server preset 构建，运行 `.output/server/index.mjs`。这是官方支持的部署模式，与 Cloudflare 产物分别验证。[T01]

已有命令的使用原则：

```bash
# 当前仓库已有脚本；先安装锁文件依赖并装载获准配置。
pnpm --filter @hzy/enterprise typecheck
pnpm --filter @hzy/enterprise test

# 当前 build 脚本是 nuxt build；Node 模式显式选择 preset。
# 仅在专用 Node 构建工作树、正确的 profile 映射和测试配置下执行。
NITRO_PRESET=node-server pnpm --dir enterprise exec nuxt build --dotenv "$SAFE_ENV_FILE"
```

不调用 `build:cloudflare` 来生成 PM2 产物；Node 模式不启用仅为 Workers 准备的 OSS/文档转换 shims。Console、独立文档等按各自当前 package 脚本核对后构建，不从 Enterprise 脚本类推全部模块。

Dev、Node build 和 Worker build 不同时写一个工作树的 `.nuxt/.output`。建议使用现有仓库 worktree 管理流程建立固定提交的构建工作树，或串行停 Dev 后构建；不清理他人的依赖缓存。CLI 的 mode 切换先确认构建成功，再受控停止当前同端口进程，禁止双监听。

### 9.3 进程生命周期

PM2 显示 online 不代表业务 ready。网关、Host、Console 分别提供或复用只读就绪检查，汇总路由、身份依赖和 Runtime 可用性。不要未经应用实现就设置 `wait_ready: true`，否则会等待不存在的 `ready` 消息。[T07]

子进程包装器需要转发 SIGINT/SIGTERM、等待请求和文件操作适当结束并清理子进程组。PM2 restart 仅用于对应前端；不得顺带重启 Runtime、数据库或 cloudflared。

## 10. Caddy 与既有 Tunnel 接入

### 10.1 默认只处理一个新增站点

优先复用已有 Caddy 进程，把配套 `Caddyfile.hzy0.example` 中的站点块经审核加入现有配置。该样例没有全局块，不覆盖原 admin、证书、其他站点和日志策略。

若 Caddy 已占用建议端口，调整 profile 和样例一起生成。若 cloudflared 在容器内，`127.0.0.1:23180` 可能并非宿主 Caddy；先解决正式的容器网络映射，不把所有应用端口开放到公网。

### 10.2 站点样例的责任

样例入口只接收 `Host: hzy0.isme.dev`，向本机网关转发，不路由数据库或 Runtime。外部 HTTPS 在 Tunnel 终止，同机回环段可以是 HTTP；跨主机则单独配置可信 TLS。

Caddy 默认会处理 `X-Forwarded-*`，支持 WebSocket 和流式代理。[T08] 本方案在专用 hzy0 站点固定已知 public scheme/host/port，避免信任任意浏览器转发头；网关再独立检查批准的 origin。不能把本地反向代理凭据返回给客户端。

不要使用 `handle_path /aims/*` 等规则随意剥除应用前缀；该指令会隐式去掉匹配前缀。[T09] 本方案由本地网关执行少量已登记的路径映射。

样例不自动启用公共请求 access log，防止 OAuth code/query/凭据在默认日志中泄漏。需要日志时使用脱敏路径模板、requestId、状态和耗时，不记录 Authorization、Cookie 或正文。

### 10.3 Tunnel 操作边界

只核对/调整 `hzy0.isme.dev` 到 Caddy 的映射；`hzy-test-runtime.isme.dev` 的 service、DNS、证书、访问策略及现有凭据保持原样。

同一个 Tunnel 可服务多个主机名，路由按顺序匹配且路径原样转发。[T10] 若两域名共用一个 cloudflared，重启会影响两条链路，必须安排窗口。不要为重新启动前端创建第二个相同 Tunnel 的不一致配置副本。

远程管理的 Tunnel 在当前管理入口改唯一 hzy0 规则；本地管理的 Tunnel 仅合并该 ingress 条目并保留其他规则和最终 catch-all。不要把附录片段当作完整 `config.yml` 覆盖原文件。[T10][T11]

### 10.4 公网 Dev 的外层保护

Tunnel 发布后 Vite/源码/HMR 也是互联网可达资源，单有应用登录不一定覆盖这些路径。必须设置获准测试人员的入口保护，例如已批准的 Cloudflare Access 或等效控制，并验证静态 Dev 路径和 WebSocket 也受保护。

此保护不代替汇智云登录/授权。服务间通信优先走受控内部路径，不把交互式 Access 登录页作为服务 API 返回。需要第三方回调的场景单独登记机器身份或精确回调策略，不给整个 `/api/*` 设宽泛 bypass。

## 11. HMR、文档编辑器和实时连接

### 11.1 HMR

浏览器看到的连接应是 `wss://hzy0.isme.dev/<登记的 HMR 路径>`，而不是 `ws://127.0.0.1:<端口>`。本地实际 HMR listener 可以是另外一个回环端口，由同一网关精确转发。

用当前锁文件确定的 Nuxt/Vite 版本选择正确配置项。当前 Vite 官方资料已把 WebSocket 相关配置归到 `server.ws` 并说明旧 HMR 配置兼容关系；不把最新版示例机械复制到仓库，也不为本方案升级框架。[T12]

必须验证：

- `allowedHosts` 限定自有 hzy0 主机；不设 `true`，不把全部跨域设为允许。
- Console、Enterprise、编辑器的 Vite 客户端/静态路径不会互相响应。
- 修改 Host 布局、领域 Vue 页面和共享 Foundation 样式能正确更新；修改 Nuxt config/环境值时明确需要重启。
- 重连不悄悄绕过代理直连本机端口；不同设备都能从公共地址正常连接。
- Node 构建模式不提供 Dev/HMR endpoint。

### 11.2 Codocs 编辑器与协作

不以“文档列表出现”代替文档测试完成。先盘点当前正式的编辑器与正文保存路径，继续使用已批准的 independent origin 或兼容页。不能把 `HZY_CODOCS_ORIGIN` 设成会重新命中 Host 编辑器包装页的同一地址，造成 iframe 递归。

需要本地化编辑器时，采用经批准的专门兼容路径/来源，并校验其实际生成 URL。保持现有精确 origin、source window、消息 schema、文档 ACL、短期协作 token、保存/冲突语义；不复制整个旧应用 Shell。

浏览器 Cookie/跨站限制不满足时，优先明确的顶层独立编辑入口作为过渡，不能通过扩大 Cookie Domain、关闭 iframe 边界或长期传 token 于 URL 来“解决”。

HMR、Collab WebSocket、SSE 是不同连接，分别测试。HMR 通了不代表协作服务可用。共享测试文档创建/保存有副作用，需要明确测试对象和清理规则。

## 12. 测试数据、后台任务与运行保护

### 12.1 同一测试后端的双入口

本地前端与云端前端都调用同一个 Runtime，不自动产生两个数据库写入权威；但它们会修改同一数据，且 Runtime 版本、schema 和策略变更同时影响两端。

日常选定测试产品/项目/文档，附运行批次标识；不能认为不同域名隔离数据。云端验收期间冻结兼容版本、测试对象和本地写入窗口。迁移、删除、反向恢复等破坏性试验用明确隔离副本，不对共享测试库直接运行。

前端升级如确实要求 Runtime/schema 新版本，作为后端发布任务单独执行；“本方案不搬数据”不代表任意新前端都天然兼容现有表结构。

### 12.2 唯一任务 owner

本地新栈默认不注册业务 cron、不执行通知、目录写同步、Outbox drain、milestone rollover 或其他定时业务动作。保留原已核验 owner；若原任务本来没有可用 owner，本方案也不宣称它已闭环。

Policy Bundle、JWKS 和会话刷新按现有机制继续有效；区分只读获取与会更新共享 Runtime 的刷新任务。已有云端 policy 同步 owner 时本地优先消费，不额外注册一份共享写任务。确需本地消费，登记唯一 owner/时间窗/租约后再启用。

手工任务执行也要使用正式身份、精确能力、generation 与幂等约束；仅 loopback endpoint 不等于可以无鉴权执行。[R02][R09]

### 12.3 日志、容量与主机可用性

- 同机 CPU/内存/磁盘与 Runtime/数据库共享。重型构建串行执行，先测预算；不把 OOM 自动重启当作容量治理。
- 为本栈日志设轮转和保留期，路径与 PM2_HOME 均独立；诊断只保留脱敏信息。
- Runtime/数据库现有开机自启保持不变。主机休眠、重启、断网会同时影响云端测试后端，安排共同维护窗口。
- 前端运行本机不代表断网可完整工作：Platform、SSO、对象存储、Tunnel 等依赖可能仍在外部。
- 使用挂载的 Node 构建制品时记录 commit、preset、配置 hash、路由 hash、Runtime 版本和权限版本；Dev dirty 状态应明显标记，不拿来作固定版本验收证据。

## 13. 实施工作包与阶段门禁

工作包 ID 仅用于本方案追踪，纳入现有台账时由整合负责人映射到正式 INT 编号。没有实测数据前不承诺日历工期。

| ID | 工作包 | 主责 | 前置条件 | 必须交付 |
| --- | --- | --- | --- | --- |
| LET-00 | 本机盘点和变更边界冻结 | 整合负责人/运维 | 用户确认方案 | ENV-01～12 非秘密记录、可操作范围 |
| LET-01 | profile、doctor、PM2 最小启动管理 | 前端/部署 | LET-00 | 配置 schema、无副作用 plan、只管 hzy0 进程 |
| LET-02 | OIDC/服务身份与实例绑定 | 认证负责人 | LET-00 | issuer/client/deployment 决策、精确回调与正式只读验证 |
| LET-03 | Node Gateway/Caddy/Tunnel 入口 | 部署/共享层 | LET-01、LET-02 约定 | 同源路由、可信头、API/静态/旧 Shell/Upgrade 测试 |
| LET-04 | Host/Console Node 适配与 HMR | 前端/共享层 | LET-03 | 最小查询与获准保存、无双 Shell、正式权限、热更新 |
| LET-05 | Node 构建模式与独立组件 | 前端/文档 | LET-04 | 固定产物、实际文档依赖、构建与环境一致性 |
| LET-06 | Runtime 回环传输优化 | 共享层/认证 | LET-04，ENV-02/08 | identity 不变、回环策略、失败与回退验证 |
| LET-07 | 联合验收与云端非回归 | 验证负责人 | 适用工作包完成 | 第 15 节证据、当前风险、批准启用范围 |
| LET-08 | 日常使用与退役候选登记 | 整合负责人 | LET-07 | 日常 Runbook、维护窗口；不删除云端专项环境 |

阶段划分：

- **G0 可开发**：本机盘点/身份方案已冻结，不动现有 Runtime。
- **G1 本机 Dev 可用**：公共 Runtime 路径下真实登录、查询、保存与 HMR 通过。
- **G2 Node 构建可用**：固定产物、配置与适用独立依赖通过。
- **G3 回环调用可用**：本机直接连接与云端公共连接共同验证，安全和错误语义一致。
- **G4 日常默认使用**：验收/回退记录完成，Cloudflare 仍保留专项验证。

LET-06 可在 LET-05 后或并行准备；身份方案/正式权限未通过时，不得以 `dev bypass` 抢先达到 G1。

## 14. 首次启动和日常操作 Runbook

### 14.1 先执行只读检查

以下是通用检查示例，操作者在实际仓库中执行。不要公开完整命令行参数、进程环境或配置文件中的 secret。

```bash
git status --short
git rev-parse HEAD
node --version
pnpm --version
caddy version
pm2 --version
cloudflared --version

# macOS 可检查建议端口；Linux 可使用 ss 的等价只读检查。
lsof -nP -iTCP:23180 -sTCP:LISTEN
lsof -nP -iTCP:23120 -sTCP:LISTEN
lsof -nP -iTCP:23110 -sTCP:LISTEN
lsof -nP -iTCP:23100 -sTCP:LISTEN
```

版本安装按仓库锁定要求和已有运维方式处理；不在本方案里执行 `npm install -g ...@latest`、更新整个系统或替换已有 cloudflared 服务。

Runtime 健康检查使用实际配置中正式 health 路径，确认无权暴露的细节不写入报告。不要把未知 `/health` 当作一定存在的接口，也不要把未认证业务 401 误判为 Runtime 宕机。

### 14.2 完成实现后使用的统一 CLI 合同

下面是 **LET-01 需要实现的命令界面**。它们目前不是已交付程序。实现完成、通过测试且 profile 的阻塞项已填好后，才按序执行。

```bash
# 本机私有 profile 放在仓库外，真实路径由实施者创建。
PROFILE="$HOME/.config/huizhi-yun/hzy0/profile.json"

node deploy/test-env/local-enterprise.mjs plan --profile "$PROFILE"
node deploy/test-env/local-enterprise.mjs doctor --profile "$PROFILE"
node deploy/test-env/local-enterprise.mjs up --profile "$PROFILE" --mode dev
node deploy/test-env/local-enterprise.mjs status --profile "$PROFILE"
```

各命令行为必须是：

| 命令 | 行为 | 禁止副作用 |
| --- | --- | --- |
| `plan` | 输出进程、路由、身份引用和依赖差异，不输出秘密 | 不创建客户端/策略/云资源，不启动进程 |
| `doctor` | 配置/版本/端口检查、允许的健康和认证只读探测 | 不跑迁移、数据库写入、任务 drain 或授权修复 |
| `up --mode dev` | 启动唯一 hzy0 网关与所需 Nuxt dev，逐步就绪后开放 | 不启动 Runtime/数据库，不开启业务 scheduler |
| `build --mode node` | 在确定工作树和输入下构建，保存制品摘要 | 不发布 Worker，不覆盖正在运行的 Dev 构件 |
| `up --mode node` | 启动已构建产物；若当前 Dev 在运行则要求明确切换 | 不未构建先停服务，不混用旧配置 |
| `restart --app enterprise` | 只重新启动这个 profile 的目标进程 | 不匹配模糊名称，不重启全部 PM2 |
| `logs --app enterprise` | 受控日志入口，默认限制行数 | 不打印 env、cookie、token 或业务正文 |
| `down` | 停止本 profile 管理的新增进程 | 不停止 Caddy 全局服务、Tunnel、Runtime 或数据库 |

PM2_HOME 必须由 profile 固定，CLI 检查进程的实际 cwd 和运行摘要；同名但不属于本栈的进程拒绝接管。切换 mode、Caddy/Tunnel 修改、回调/授权变更应分别确认，不把所有动作藏进 `up`。

### 14.3 接入 Caddy 和 Tunnel

1. 备份当前 hzy0 入口与 Caddy 非秘密配置摘要；记录两个 Tunnel 主机名是否共用进程。
2. 确认本地网关只监听回环，且启动器可以在不开放公网入口时完成健康检查。
3. 将站点样例合并进现有完整 Caddy 配置，使用 Caddy 实际版本执行 `caddy validate`；验证通过后再按既有服务管理方式 reload。
4. 只把 hzy0 的 upstream 指向批准的 Caddy 监听，保留 runtime 域名的原规则。
5. 先验证外层保护、Host 拒绝与未认证状态，再用正式测试账号登录。

样例验证方式：

```bash
# 对合并后的完整配置执行；此处路径由实际管理员确认。
caddy validate --config /path/to/reviewed/Caddyfile --adapter caddyfile

# 本地管理 Tunnel 的只读校验；远程管理模式不使用本地文件替代云端配置。
cloudflared tunnel --config /path/to/existing/config.yml ingress validate
cloudflared tunnel --config /path/to/existing/config.yml ingress rule https://hzy0.isme.dev/enterprise
cloudflared tunnel --config /path/to/existing/config.yml ingress rule https://hzy-test-runtime.isme.dev/
```

不在文档中提供直接覆盖整个 Tunnel 配置的 PUT 命令。若一次 reload 会影响已有运行链路，按维护窗口执行。

### 14.4 最小真实任务

用正式测试账号完成：

```text
打开 hzy0 /enterprise
  → 正式认证（允许进入既有 canonical IdP）
  → 返回 hzy0 Host
  → 按当前权限看到业务菜单
  → 打开允许的产品/项目
  → 执行一次已批准、可核对的编辑保存
  → 返回原上下文
  → 刷新、重新聚焦、折叠侧栏
  → 确认无额外登录、双 Shell、错误回调或状态丢失
```

再修改一处非业务敏感的 Vue 文案/样式，验证真正 HMR，无 Worker 发布。不要为了演示写入而直接变更客户真实合同或费用记录。

### 14.5 切换回环与 Node 模式

G1 通过后，在 profile 中分别修改 `transportMode` 与构建模式；一次只改变一个维度。先 `plan/doctor`，再重启受影响的本栈进程，复验相同数据、相同权限和相同 Runtime 身份。

回环模式失败则显式恢复本机 profile 的 `public-https` 并重启；不修改 Platform 的公共 Runtime endpoint。失败写请求的重试按照原幂等状态核对，不重新生成业务操作身份。

### 14.6 日常操作规则

页面开发使用 Dev；共享层配置/身份适配修改后重启对应进程并跑安全回归；准备合并时在固定工作树生成 Node/Worker 两种产物。维护 Runtime/数据库时同时通知本机与云端测试使用者，暂停相关写入和验收。

平时 `down` 只停前端栈。故意停 Runtime/Tunnel、断网、注入故障属于有影响试验，需要第 12 节的维护窗口或隔离环境，不在普通 smoke 命令内执行。

## 15. 验收矩阵及证据要求

每项结果记录 commit、mode、profile 摘要、测试主体、Runtime 版本、数据范围、命令/脚本、时间、通过/失败/未执行。截图/trace/日志脱敏，不保存真实 token 或整份浏览器 storageState 到公开库。

| ID | 场景 | 通过标准 | 验证层 |
| --- | --- | --- | --- |
| LE-A01 | profile 含未知/空身份、生产 environment、冲突端口 | 停止启动并报告缺项，无外部写入 | 配置/CLI |
| LE-A02 | 旧 `.env.dev` 或 shell 含 DB/主密钥/绕过开关 | 禁止导入/明确拒绝，实际 bypass 为 false | 进程/配置 |
| LE-A03 | 本机栈 up/down/restart | Runtime、数据库和其他 PM2 进程保持运行 | 本机进程 |
| LE-A04 | 伪造 tenant/app/Runtime/Forwarded 头 | 不接受浏览器指定的可信上下文，不泄漏内部头 | HTTP |
| LE-A05 | 公网请求内部服务监听/drain/调试接口 | 不可到达或按合同拒绝 | 入口/网络 |
| LE-A06 | 未认证访问 Dev 资源/WS | 外层保护生效；保护不替代应用登录 | 公网浏览器 |
| LE-A07 | Enterprise 完整登录与退出 | 返回正确 hzy0 地址，state/nonce/PKCE/Cookie 规则不退化 | 正式身份/浏览器 |
| LE-A08 | 本地 Console 和云端认证并存 | canonical issuer/JWKS 未被本地启动改写，云端登录仍可用 | 认证非回归 |
| LE-A09 | 普通员工/项目经理/只读用户菜单 | 正式权限生效，无全权限模拟，无权对象不出现在载荷 | API/浏览器 |
| LE-A10 | 过期、撤权、多标签退出 | 数据/菜单按正式策略失效，迟到响应不恢复旧状态 | 真实授权 |
| LE-A11 | Host 注册页面/API/静态资源 | method/path 正确；无 200 HTML 冒充 JSON，无旧白名单误拦 | 路由/HTTP |
| LE-A12 | 旧书签与 Console 内部普通点击 | 已迁入目的地顶层进入 Host，无双 Shell，query/hash 合法保留 | 浏览器 |
| LE-A13 | 项目创建、详情、子页、返回 | 创建不误入对象；正文/侧栏返回一致，筛选和树状态恢复 | 组件/浏览器 |
| LE-A14 | 权限后台刷新与列表 query 更新 | 有效工作区不被无意义清空，筛选不丢焦点或重建整页 | 组件/浏览器 |
| LE-A15 | 桌面/折叠/窄屏 | 一套导航数据，键盘/焦点/抽屉正确，名称按当前 ADR | 浏览器 |
| LE-A16 | Host/领域组件/Foundation 样式变更 | HMR 可用；无公网裸调试端口，无直连 localhost fallback | 开发浏览器 |
| LE-A17 | Node 构建与重启 | 不依赖隐式 dotenv；地址/身份与 Dev 一致，无 HMR 残留 | Node 制品 |
| LE-A18 | Runtime 公网/回环同一查询 | 命中同一正式 Runtime，结果与授权一致，不全局改 endpoint | 服务联调 |
| LE-A19 | 回环错误端口、错误 identity、伪造 override | 失败关闭，不自动换目标或回退数据库 | 服务负向 |
| LE-A20 | 普通写与响应丢失重试 | 审计与幂等保持，只有一次业务效果 | 测试业务对象 |
| LE-A21 | 文档编辑、保存、移动、上传下载 | 通过真实正文/存储链，不仅列表或 mock | 文档联调 |
| LE-A22 | Collab/编辑器 origin 与退出 | 精确窗口/来源校验，协作断线恢复及撤权符合既有合同 | 浏览器/WS |
| LE-A23 | 大文件、SSE、多个 Set-Cookie | 流/头/状态无损，不错误缓存、不无限缓冲 | HTTP/协议 |
| LE-A24 | 本地启动前后共享任务状态 | 不重复注册/消费；必要策略刷新持续有效 | 运行回读 |
| LE-A25 | 固定云端 Workers 读取/登录非回归 | hzy-test-* 仍能访问原 Runtime，正式绑定未被覆盖 | Cloudflare |
| LE-A26 | 停本机前端与恢复旧配置 | 只影响本机前端，数据与云端 Runtime 入口保持 | 回退 |
| LE-A27 | 共同维护中的 Runtime/Tunnel 故障 | 正确失败、恢复无重复 mutation；仅在批准窗口/隔离环境测 | 故障恢复 |
| LE-A28 | 效率与容量 | 有修改→验证时长、请求路径、RSS/CPU/数据库影响实测 | 性能 |

增加第二个测试租户、复制真实数据或模拟生产故障不在本方案默认授权范围。现有跨租户 fixture 可先做自动化负向验证；真实跨租户测试需要另行批准，未执行就明确记录。

最低 G1：LE-A01～16 中适用项以及 LE-A20/24/25 的基本链通过，未纳入的文档依赖不能写成已完成。G2 增加 LE-A17 与适用文档/协议验证；G3 增加 LE-A18/19；G4 完成适用回退与容量证据。通过仅表示相应阶段，不提前勾选全部 ADR-019。

## 16. 回退和退出方案

| 回退对象 | 动作 | 不应执行 |
| --- | --- | --- |
| 本机前端代码 | 恢复上一固定 Node 制品/Dev 提交，配置与路由 hash 配套 | 不 `git reset --hard` 覆盖共享开发修改 |
| Runtime 连接方式 | 本机 profile 从 loopback 改回已批准 public-https，受控重启 | 不修改全局 Runtime 登记，不偷偷重发失败写请求 |
| hzy0 入口 | 恢复它原 upstream，或关闭它的已批准本机入口 | 不删除 runtime 域名，不覆盖其他 ingress |
| 本机进程 | 只 down 本 profile 的 `hzy0-*` | 不停止既有 Caddy/Tunnel/Runtime/数据库 |
| OIDC/client 回调增量 | 经批准撤销仅本次新增且无消费者的配置 | 不删除 cloud callback、issuer、密钥或共享会话事实 |
| 实际业务数据 | 按原业务冲正/版本/幂等机制处理 | 不为撤回 UI 恢复整库旧备份 |

**既有数据库产生的新写入不会因本机 UI 回退而消失。** 涉及后端 schema/Runtime 回退按原发布手册单独执行，不能夹带在本地 `down` 中。[R02]

回退触发条件包括：云端认证被改变、错误租户/部署、未授权信息进入载荷、任务双执行、主要写链不确定、主机资源影响现有后端。发现上述情况先停止本机相关写入，保留脱敏证据，不通过扩大权限继续运行。

## 17. 常见故障定位

| 表现 | 优先检查 | 禁止的快捷“修复” |
| --- | --- | --- |
| hzy0 502/503 | cloudflared upstream、容器网络、Caddy/Gateway/目标进程逐跳检查 | 随机开放所有监听地址 |
| 登录跳回 hzy-test 域名 | pilot 固定回调、运行时 config 与构建时值、客户端登记 | 通配 callback 或替换所有 issuer |
| Secure Cookie/回调失败 | public scheme/host、Cookie Path/Domain、两个 OIDC 客户端是否混淆 | 关 Secure、扩大 `.isme.dev` Cookie |
| 菜单全空 | 正式授权/策略新鲜度、服务身份、Runtime availability、导航 API | 开 dev policy bypass |
| Runtime 403 | scope、signed actor、tenant/deployment、writer/permit 对应关系 | 共享管理员 token 或去掉比较 |
| 本地启动导致云端登录坏 | 是否初始化/覆盖 shared issuer、client 或策略绑定 | 在两域名间反复 bootstrap |
| API 返回 HTML | 路由兜底、前缀重写、交互式入口保护误拦服务调用 | 在页面吞掉 JSON 解析错误 |
| HMR 重连失败 | 浏览器实际 WS URL、Vite 版本配置、代理 Upgrade 和端口冲突 | `allowedHosts=true`、直接暴露 Dev 端口 |
| 编辑器白页/iframe 递归 | 独立 editor origin、包装路由、CSP/source/跨站 Cookie | `postMessage('*')` 发送凭证 |
| Node build 有效配置与 Dev 不同 | 构建固化值、NUXT runtime override、未显式 dotenv | 把完整生产 `.env` 拷贝过来 |
| 回环失败而公网成功 | namespace、监听、TLS/Host、传输地址白名单 | 关闭 TLS 或所有私网地址限制 |
| 重复通知/同步 | 云端与本机是否双 owner/双 cron | 只在客户端去重后当作已修复 |
| 前端重启带停 Runtime | PM2_HOME、进程模糊匹配、全局 down 行为 | 再启动一个 Runtime 掩盖误停 |

## 18. 后续边界与实施任务输入

### 18.1 当前批次的推荐顺序

先 LET-00/01/02，再接通 LET-03/04 的最小业务链；随后做 Node 构建、文档独立依赖和回环优化。不要把数据库迁移、全部业务应用扩展、认证根重建与本地部署合成一批。

Workers VPC 继续按已形成的观察方案处理，不在本任务接线。现有 hzy-test-* 不退役；主机离线会使两类前端共同失去后端，本方案不是高可用改造。

### 18.2 可交给实施者的任务摘要

```text
目标：在 feat/adr018-enterprise-integration 的当前工作树实现 local-enterprise
测试部署适配。数据库和 Runtime 已在本机，公共 Runtime 域名为
hzy-test-runtime.isme.dev；前端使用已有 hzy0.isme.dev Tunnel。

先完成 ENV-01～12 只读盘点；不得沿用旧文档中的远端/SSH 拓扑。
复用既有 Gateway/Registry/Foundation 身份契约，新增薄 profile/CLI 与
PM2/Caddy 适配。先沿用公网 Runtime endpoint，再可选优化 loopback。
保持 canonical issuer、runtimeCode、数据事实源和唯一任务 owner。

必须交付：
1. 逐项代码改动清单、配置 schema、必填/危险配置拒绝测试；
2. 同源路由、正式登录、权限、HMR、Node build 与受控服务传输；
3. 对应验收矩阵、固定版本与回退记录；
4. 现有统一实施台账中的实际状态和剩余项。

不得自动执行：云端发布、Tunnel/DNS 覆盖、授权/issuer 改写、Runtime 重启、
数据库迁移、生产数据操作、启用第二套 scheduler。
需写操作时先提供具体变更及回退，获得批准再执行。

不要重新实现业务页面或权限引擎；不要仅启动旧 dev-stack 宣称完成。
```

### 18.3 本方案的最终完成标准

一个获授权的普通测试用户能够从 hzy0 正式登录，使用统一业务菜单完成批准的产品/项目/文档任务；开发者能快速热更新；Node 构建模式可复现；Runtime 连接、权限和写入语义不变；云端专项入口未受破坏；回退只影响本机前端而不回退业务事实。

## 19. 资料来源和文档适用范围

本轮分开使用三类依据：

1. **用户确认**：数据库/Runtime 已在本机、两个现有 Tunnel 域名、现有 hzy-test-* 测试方式。
2. **固定仓库快照**：本文件 [R01]～[R14]。代码声明不等于本机真实部署，也不表示相关机制已通过全量验收。
3. **官方工具文档**：本文件 [T01]～[T13]，核对日期 2026-09-20；用于确认 Node/PM2/Caddy/Tunnel/HMR 的机制，不据此升级仓库版本。

本文件没有读取用户机器的 PM2、Caddy、cloudflared、数据库、Runtime 或真实凭据，也没有执行部署、创建资源或发起测试写入。配置附件是实施合同样例；JSON 格式与文档一致性检查不能替代 Caddy/Nuxt/真实环境验证。

### 仓库依据

- [R01] ADR-017：客户侧数据与认证边界。
- [R02] ADR-018：统一运行时与存储边界。
- [R03] ADR-019 v1.3：企业侧统一前端。
- [R04] 既有 PM2 开发栈。
- [R05] 既有 Caddy 本地路由。
- [R06] 既有 Console/People 本地测试网关。
- [R07] Enterprise 配置及固定 pilot 地址。
- [R08] Enterprise 构建与测试脚本。
- [R09] 可信网关上下文与调度验证。
- [R10] 本地运行模式与 bypass 判定。
- [R11] 集中 Runtime 客户端与短期服务身份。
- [R12] 当前云端试点拓扑与路径适配。
- [R13] 仓库 Node 版本约束。
- [R14] 唯一整合实施台账。

### 官方工具依据

- [T01] Nuxt：Node 部署与 PM2。
- [T02] Nuxt：运行时环境变量与私有配置。
- [T03] Nuxt：开发/构建 dotenv 与运行产物区别。
- [T04] PM2：进程声明。
- [T05] PM2：环境变量继承。
- [T06] PM2：独立 PM2_HOME。
- [T07] PM2：优雅退出与就绪信号。
- [T08] Caddy：反向代理、转发头与流式连接。
- [T09] Caddy：handle_path 会去除匹配前缀。
- [T10] Cloudflare Tunnel：主机路由、原样转发路径与配置检查。
- [T11] Cloudflare Tunnel：公共主机名映射本地服务。
- [T12] Vite：Host 限制与 HMR/WebSocket 配置。
- [T13] Cloudflare：本地 Workers 开发与部署差异。

[R01]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/docs/ADR-017-Console-Tenant-Data-Plane-Separation.md "ADR-017：客户侧数据与认证边界"
[R02]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/docs/ADR-018-Unified-Enterprise-Application-and-Data.md "ADR-018：统一运行时与存储边界"
[R03]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/docs/ADR-019-Enterprise-Business-Frontend-Integration.md "ADR-019 v1.3：企业侧统一前端"
[R04]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/deploy/dev-stack/ecosystem.config.cjs "既有 PM2 开发栈"
[R05]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/deploy/dev-stack/Caddyfile.local "既有 Caddy 本地路由"
[R06]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/deploy/test-env/local-gateway.mjs "既有 Console/People 本地测试网关"
[R07]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/enterprise/nuxt.config.ts "Enterprise 配置及固定 pilot 地址"
[R08]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/enterprise/package.json "Enterprise 构建与测试脚本"
[R09]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/foundation/server/utils/tenantGatewayTrust.ts "可信网关上下文与调度验证"
[R10]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/foundation/server/utils/localDevRuntime.ts "本地运行模式与 bypass 判定"
[R11]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/foundation/server/utils/tenantRuntimeClient.ts "集中 Runtime 客户端与短期服务身份"
[R12]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/deploy/test-env/enterprise-topology.mjs "当前云端试点拓扑与路径适配"
[R13]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/.nvmrc "仓库 Node 版本约束"
[R14]: https://github.com/guangying-zhou/huizhi-yun/blob/559ac131e94d18bc6ef10a3dbe5ce2e8d1f6fe63/docs/Unified-Enterprise-Implementation-Plan.md "唯一整合实施台账"
[T01]: https://nuxt.com/docs/4.x/getting-started/deployment "Nuxt：Node 部署与 PM2"
[T02]: https://nuxt.com/docs/4.x/guide/going-further/runtime-config "Nuxt：运行时环境变量与私有配置"
[T03]: https://nuxt.com/docs/4.x/directory-structure/env "Nuxt：开发/构建 dotenv 与运行产物区别"
[T04]: https://pm2.keymetrics.io/docs/usage/application-declaration/ "PM2：进程声明"
[T05]: https://pm2.keymetrics.io/docs/usage/environment/ "PM2：环境变量继承"
[T06]: https://pm2.keymetrics.io/docs/usage/specifics/ "PM2：独立 PM2_HOME"
[T07]: https://pm2.keymetrics.io/docs/usage/signals-clean-restart/ "PM2：优雅退出与就绪信号"
[T08]: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy "Caddy：反向代理、转发头与流式连接"
[T09]: https://caddyserver.com/docs/caddyfile/directives/handle_path "Caddy：handle_path 会去除匹配前缀"
[T10]: https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/ "Cloudflare Tunnel：主机路由、原样转发路径与配置检查"
[T11]: https://developers.cloudflare.com/tunnel/get-started/ "Cloudflare Tunnel：公共主机名映射本地服务"
[T12]: https://vite.dev/config/server-options "Vite：Host 限制与 HMR/WebSocket 配置"
[T13]: https://developers.cloudflare.com/workers/local-development/ "Cloudflare：本地 Workers 开发与部署差异"
