# wiztek 生产自托管拓扑方案（草案，2026-09-29）

状态：**草案，待用户审阅**。本文不授权任何服务器、云端或生产变更。

## 1. 背景与决定

- 生产 Cloudflare 账户为 Workers Free（每次调用 10 ms CPU）。9/28 只读核对（[记录](Wiztek-Production-Read-Only-Check-20260928.md) §07）显示：被 `exceededResources` 终止的调用 CPU 中位数恒为 10 ms；生产 `hzy-workflow` 成功请求 CPU 中位数 40–60 ms，约 15% 请求被终止；Console 近 5 天每天被终止 600–1,200 次。Enterprise Host 负载只会更高。
- 用户决定（9/28）：不购买 Workers Paid；租户栈改为**自托管**。新服务器位于公司内网，经 Cloudflare Tunnel 对外；Runtime 与租户 MySQL 一并迁入（结构 B）。
- 新服务器：4 核 / 16 GB / 500 GB，Anolis OS 23.5，公司内网，经 Tailscale `100.64.72.59` 管理（见 §2a）。

## 2. 目标拓扑（结构 B）

```text
员工浏览器 → aidcp.wiztek.cn（阿里云 DNS → 8.130.81.31）
  → gitlab.wiztek.cn 上的 nginx（TLS 终止，仅透传 Host）
  → Tailscale（WireGuard 加密）
  → 内网服务器：自托管 Tenant Gateway（仅绑定本机 Tailscale 地址，只接受 gitlab 主机的 Tailscale 地址）
      ├─ Enterprise Host（含 Aims/Assets/Codocs/Altoc 页面）
      ├─ Console
      ├─ Workflow
      ├─ Aims 调度（scheduler-only）
      └─ Codocs 编辑器
  → data-runtime（systemd，127.0.0.1）→ MySQL 8.0（本机，hzy_* 租户库）
生产 Platform：platform.wiztek.cn，同一路径 → 内网服务器上的 Platform 进程（生产 hzy_platform 库同机）。
开发/测试 Platform：hzy.wiztek.cn 保持不变。
原生产：wiztek.huizhi.yun + Cloudflare Workers + 日本 Runtime 暂不改动。
```

原则：
- 应用进程与 Runtime、MySQL 同机，全部走回环地址，不跨境。
- 公网入口只在 gitlab 主机 nginx；内网服务器不对公网开放端口，仅经 Tailscale 接受 gitlab 主机一个来源。
- 业务进程不拿数据库凭据；Vault 主密钥和 OIDC 签名材料只在 Runtime。

## 2a. 主机现状（2026-09-29 只读检查）

| 项 | 结果 | 影响 |
| --- | --- | --- |
| 系统 | Anolis OS 23.5，内核 6.6，x86_64，glibc 2.38 | 可直接使用现有 `linux-amd64` Runtime 构建，无需换系统 |
| 资源 | 4 核，15.3 GB 内存（可用约 14 GB） | 满足结构 B |
| 磁盘 | `/` 69 GB（剩 51 GB），`/home` 413 GB（几乎全空） | MySQL 数据目录、备份和发布包放 `/home` 下的独立目录，不放根分区 |
| MySQL | 系统源提供 `mysql-server 8.0.46`（生产现为 8.0.45），另有 Docker 28.3 | 用系统包，同一 8.0 大版本；Docker 作为备选 |
| 待安装 | Node、PM2、git、cloudflared | 按 §5 S0 安装 |
| SELinux / 防火墙 | Permissive；firewalld 运行中 | 仍按 enforcing 规则配置标签，便于日后收紧；不开放新入站端口 |
| 时区 | Asia/Shanghai，时间已同步 | 调度签名要求时钟偏差 ≤60 秒，满足 |
| 其他 | 运行着 GNOME 桌面（gdm） | 可停用以节省内存（非必须） |
| 出口 | 国家 CN（在 `CN_CA_JP` WAF 允许范围内）；到 Cloudflare 建连 0.26–0.68 s，`huizhi.yun` 首页 0.8–1.5 s；下载约 4.3 MB/s | Tunnel 可用；用户请求会多一段"Cloudflare 边缘→内网"的往返，预发时实测页面时延 |
| 到日本 Runtime | ping 78–102 ms；3 次健康检查 1.4 s、1.9 s、**12.6 s** | 跨境链路不稳定，印证必须采用结构 B（Runtime 与库同机），迁移完成前新机不应依赖日本 Runtime |

## 2b. 入口链路（2026-09-29 已打通）

- `gitlab.wiztek.cn` 的 Tailscale 已启用（用户授权）：`--accept-dns=false --netfilter-mode=off`，取消原 exit node 广告；启用前后 `resolv.conf` 哈希不变、无 `ts-` iptables 规则、阿里云 DNS 与 GitLab/3010/3011 均正常。回退：`tailscale down`。
  - 原因：阿里云 DNS `100.100.2.136/138` 落在 100.64.0.0/10，Tailscale 默认防火墙会丢弃非 tailscale0 进入的该网段包。
- 首次仅走 DERP（华沙）中继，RTT 560–1130 ms。原因：新服务器在对称型 NAT 后（出口 `39.78.255.170`）。用户在阿里云安全组放行 gitlab 主机入方向 UDP 41641 后，建立直连，**RTT 约 21 ms**（gitlab→新服务器 10/10，20.5–21.6 ms）。
- 后续：公司出口 IP 若变化，直连仍可建立（新服务器主动连 gitlab 主机固定端口）；如需收紧安全组来源，以公司出口 IP 为准。

- DNS：`aidcp.wiztek.cn` A → `8.130.81.31` 已由用户添加，本机/223.5.5.5/8.8.8.8/权威均已生效。nginx 尚未配置该站点，当前落到默认站点（他人业务页面与 `*.wyfwpt.com` 证书）；用户确认暂不遮挡。
- nginx 方案（用户已认可，待 Gateway 就绪后执行，执行前再出示具体配置）：certbot 签发 `aidcp.wiztek.cn`、`platform.wiztek.cn`；两个独立 HTTPS server 块经 Tailscale 反代新服务器，透传 Host、支持 WebSocket，上游不可用时返回维护页；改前备份、`nginx -t`、reload，不重启、不动其他站点与 PM2。

## 3. 缺口清单（按工作量与风险排序）

依据：9/29 只读仓库调研（证据见附录）。

| # | 缺口 | 现状 | 需要做的 | 估算 |
| --- | --- | --- | --- | --- |
| G-1 | 生产级自托管 Gateway | `local-enterprise/gateway.mjs` 是测试件：强制 `environment=test`、C000001、固定 `hzy0.isme.dev`、读测试 Gateway 凭据 | 以 `deploy/cloudflare/tenant-gateway/src` 为核心包成 Node 服务（它已用纯 Web API，无 binding 时回落 fetch）：Platform registry 解析、Runtime bootstrap token、`x-hzy-gateway-token`、调度签名、WebSocket（Collab）；生产配置与测试隔离；安全审查 | 2–3 天 |
| G-2 | 常驻调度器 | 托管云靠 Gateway cron；hzy0 只有进程内 60 秒策略同步和一次性手动 drain 脚本（限回环、限 hzy0） | 常驻调度：策略同步，Workflow、Aims、Finance、People 的 drain 唤醒（带 HMAC 签名），失败计数与告警 | 1–2 天 |
| G-3 | Host 的测试硬编码 | `hostWorkflowEnabled` 仅在 `HZY0_LOCAL_ENTERPRISE=true` 时打开；Workflow 地址固定 `127.0.0.1:23140`；pilot 绑定要求 `environment=test`；egress/facade 只面向 hzy0 | 改为按部署配置启用；清点 enterprise、foundation、console 中所有 `HZY0_*` 用法 | 1–2 天 |
| G-4 | 生产 Node 制品与进程配置 | 仅 Console 有维护中的生产 PM2 配置；`run-process` 拒绝 `.output` 模式；其余模块无 ecosystem | 每个进程的生产构建、PM2（或 systemd）配置、日志轮转、健康检查、发布与回滚脚本；更新过时的 Deployment Guide | 1–2 天 |
| G-5 | Runtime + MySQL + Vault 迁移 runbook | 仅有 9/10 测试迁移先例（`rebind-runtime.mjs` 限测试） | 生产迁移步骤：停写窗口、dump/恢复/逐表核对、Vault 主密钥与 `hzy_console` 成对迁移、`deploymentBindings`、Directory Connector 密钥与状态、Tunnel 切换、回退 | 1 天写 + 1 次演练 |
| G-6 | Platform 部署记录切换 | Gateway 解析只读 `deployment_sites.public_url`、`deployments.*`、`tenant_runtime_instances.runtime_endpoint`；`deployment_mode` 取值在三处不一致 | 列出要改的记录与回读；统一取值；确认 OIDC redirect/issuer | 0.5–1 天 |
| G-7 | 授权核验 | 新部署和 audience 需要重新核验 | 按 CLAUDE.md 做 grant verify 与全组合签发探测 | 0.5 天 |
| G-8 | 出口与 WAF | 回落公网的调用经 huizhi.yun 的 `CN_CA_JP` WAF 规则；新机出口为 CN，已在允许范围 | 自托管后同机调用应走回环，不再经公网；预发时核对确无公网回落 | 0.5 天 |

合计约 8–12 个工作日，部分可以并行。另需在新服务器上做一轮完整预发验收（原 §3 门禁，2–3 天）。

### 3a. 进度（2026-09-29 晚）

| 项 | 状态 | 提交 |
| --- | --- | --- |
| G-1 自托管 Gateway、G-2 常驻调度 | 已合并 | `cf78b4ba`、`1e1d1672` |
| G-3 Host 测试硬编码显式化 | 已合并 | `a602145f` |
| G-11 Tailscale 入口监听 + 来源白名单 | 已合并 | `332f75b5`（附 Console 诊断本地判断修复 `5746c901`） |
| G-10 服务间/Runtime 回环直连、Workflow↔Aims 回调 | 已合并（第 1–3 项） | 见 `feat(foundation): 自托管单站点服务间与 Runtime 回环直连（G-10）` |
| G-12 Host 根路径接口（`/api/workflow-proxy/*`、`/api/notifications*`、`/api/directory/*`、`/api/user/applications`、图标）登记到 `/enterprise/api/...` | 代码完成（`/enterprise/api/foundation/**` + `/enterprise/_nuxt_icon`，见 MODULE_CONTRACTS “Enterprise Host 共享用户 API 基址”）；待 hzy0 登录态浏览器验收 | 生产 Worker 路由会把根路径交给 Console，Host 会话不被 Console 识别 → 401 |
| G-4 生产构建与进程配置（含生产 Platform） | 本机代码与制品方案已完成（`c46de304`、`55685ad8`）；S1 环境验证待审批 | 见 `deploy/self-hosted/README.md` 与 G-4 回执 |
| G-5 迁移 runbook | 草案完成，用户决定已记录（`docs/Go-Live-Self-Hosted-Data-Migration-Runbook.md` §9a）；K2 工具参数化进行中 | — |
| G-6 Platform 记录、G-9 生产 Platform 部署 | 方案与用户决定见 `docs/Go-Live-Self-Hosted-Platform-Plan.md` §8a；G-9 克隆/迁移/整理/信任链制品及隔离 MySQL 演练见 `deploy/self-hosted/platform-bootstrap/README.md`，尚未连接真实库或执行环境写入 | 真实环境逐项审批；以正式权益转换、注册与签发流程完成信任链 |
| G-7 grant 核验 | v2.33 参数化 seed/repair/verify/rollback、reviewHash 计划与签发探测候选已完成隔离演练；真实库及令牌探测待单独批准 | `console/docs/G7-Production-Service-Grants.md` |
| Codocs 共享个人文档协作上线准备（P0，`docs/Codocs-Host-Department-Collaboration-Design.md` §7） | 制品与模板已完成、**未安装未启用**：`hzy-collab.service` + 打包（`bundle-collab.mjs`）+ `env/collab.env.example` + 健康/回环/101/426 探针；`apps.collab=31007`；nginx `/codocs/ws` 示例；`collab.runtime` 生产注册与 G-7 目录条目、探测矩阵；schema 安装清单（runbook §3a）与快照桶实测方案。环境写入、grant 核验、桶实测、Runtime 开关与双人验收均待逐项批准 | 见 `deploy/self-hosted/README.md` “独立 Collab”；**Collab 部署登记（用户 2026-09-29 决定，登记为 `C000001-collab`）：** `g9-collab-deployment.mjs` 与 `check-collab-deployment.mjs` 已就绪并通过合成库演练，Gateway/G-7/`collab.runtime` 均消费同一登记编码，真实 Platform 未写入，待逐项批准 |
| 其他遗留 | `consoleOidc` introspection 仍走 `fetchExternal`；其他直接 `$fetch` Console 处待预发抓包确认无公网回落；新服务器 firewalld 与 Tailscale `ts-input` 规则顺序需实测 | — |

## 4. 用户决定（2026-09-29）与遗留影响

0a. **入口与域名（2026-09-29 用户决定，取代下文 Tunnel 相关表述）**：`wiztek.cn` DNS 在阿里云，不能挂 Cloudflare Tunnel，采用方案 b——阿里云 `gitlab.wiztek.cn` nginx 经 Tailscale 反代到内网服务器。租户新入口 **`aidcp.wiztek.cn`**（AI-powered digital collaboration platform）；生产 Platform **`platform.wiztek.cn`**（新服务器）；`hzy.wiztek.cn` 仍为开发/测试 Platform，不改名。原 `wiztek.huizhi.yun` 不另设路由 Worker，也不改挂 `c000001.huizhi.yun`：切换与回退通过停用/启用原 Cloudflare Gateway 控制。待办：gitlab 主机启用 Tailscale（用户登录）、测延迟与直连/中继；自托管 Gateway 增加"仅绑定 Tailscale 地址 + 来源白名单"监听（G-11）；gitlab 主机 nginx 证书与反代（共用主机写入，逐项批准）；阿里云 DNS 新增 `aidcp.wiztek.cn`。
0. **新子域名并行（2026-09-29 用户决定）**：新生产环境启用新的子域名；原域名 `wiztek.huizhi.yun` 与 Cloudflare 上的 Workers 暂不改动。由此：
   - 不做原域名的 DNS/Worker 切换，原链路即回退路径；
   - Platform 需为 C000001 新增并存的站点/部署编码（每环境仅一个 active 站点，需选定新环境或部署编码方案），新部署编码需按规范新装 grant 并做签发探测（生产写入，逐项批准）；
   - 新 Console 以新子域名为 OIDC issuer 与回调，员工需在新域名重新登录；
   - ~~控制面：新生产环境使用 `https://hzy.wiztek.cn` 的 Platform~~（已被 0a 取代，改为新服务器上的 `platform.wiztek.cn`）。原记录：新生产环境使用 `https://hzy.wiztek.cn` 的 Platform（`gitlab.wiztek.cn` 上 PM2 `hzy-platform-dev`，库 `hzy_platform_dev`，已有 Enterprise release 39 与 C000001 修订 28）；原生产继续用 `platform.huizhi.yun`，不改动。该实例由此按生产规则管理（写前备份、逐项批准、回执），不再作开发沙箱；与 C000001 test 环境共用签名密钥、员工账号与备份，需在切换前评估；与 `hzy-platform-prod` 同主机，沿用 N9 共用主机约束。
   - **数据权威（待用户确认）**：切换前新环境只验收、数据不作数；切换时原域名停写 → 最终同步 → 员工改用新域名；原 Workers 与日本 Runtime 保留不写入，作为回退；回退前须回迁新环境写入。
1. **Finance / People 暂不迁移**，后续逐步整合进 Enterprise。已知影响：这两个 Worker 通过 `HZY_CONSOLE_SERVICE` 绑定云上 Console，并经 Platform 登记解析 Runtime；生产切换后 wiztek 在这两个应用上的读写会失去对应的 Console/Runtime，大概率不可用。切换前需二选一：①切换期间起暂停其入口并提示；②保留旧链路只读（需评估数据一致性）。Webdev 同理。
2. **目标仍暂定 10/8**，视进展调整。按 §3 估算时间很紧；每日在本文更新进度与风险。
3. **开发分工**：9/29 由 Claude 与子代理开发（G-1/G-2 自托管 Gateway 与调度器；G-3 Host 测试硬编码通用化）；9/30 起部分交 Codex（G-4 生产制品与进程配置、G-5 迁移 runbook 等），Claude 负责安全相关审查。

5. **Assets 延后页面（2026-09-29 用户确认）**：`assets/layer/entry.mjs` `hostReadiness.deferredPages` 所列概览、技术底座详情、环境、交付、采购（`/procurement/**`）、运营分配、告警、报表在 Host 下不可用（失败关闭 404）。wiztek 尚未使用这些功能，**不阻塞上线**，维持延后，按需另行补 Host 数据接口。自托管切换后旧 Assets Worker 不再承载这些入口。

6. **Codocs 部门文档与公司文档（2026-09-29 用户决定：选 A，10/8 前迁入 Host）**：生产只读计数——部门文档 231 篇（45 个部门文件夹，当日仍在更新）、公司文档 13、知识库 32、个人 490。范围：INT-606d 部门文档（含部门文件柜、制度、知识、记录、外部、周报等部门页）+ 公司文档/组织资产（`codocs/app/pages/company/**`：文化、知识、法务、通知、制度、技术规范、模板、开放部门文档）。项目文档（2026-09-29 用户更新）：**只迁项目组文档**（doc_type `project`，生产 13 篇），由代码仓库生成的 `git-project`（94 篇）不迁移、数据保留；项目组文档在 Host 中放在“文档协作”菜单下（2026-09-29 用户决定），列表按用户可见项目的数据范围过滤。实施：先盘点与合同（Claude 审查授权范围），再分部门/公司两批并行实现；工作量预计 4–6 人日，影响 10/8 排期。

## 5. 分阶段计划（草案）

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| S0 | 服务器准备：OS 检查、MySQL 8.0、Node、cloudflared、SELinux 规则、备份目录 | 检查脚本输出归档 |
| S1 | 开发 G-1 至 G-4，本机 hzy0 以新的"生产形态"配置跑通（非 dev 模式） | 本机 smoke、签发探测、审批回归通过 |
| S2 | 新服务器预发：测试租户或 C000001 test 环境，Tunnel 使用独立测试域名 | 原 §3 门禁（CPU 门禁改为进程资源与延迟门禁）全部在新服务器取证 |
| S3 | 迁移演练：用生产只读 dump 在新服务器恢复，校验行数和哈希，Runtime 以只读方式启动 | 演练记录与耗时 |
| S4 | 生产切换窗口（逐项批准）：停写 → 最终 dump/恢复 → Runtime 切换 → Platform 记录 → Tunnel 与 DNS 切换 → 验收 → 观察 | 切换回执；回退路径保留 72 小时 |

## 6. 回退原则

- 切换前保留日本 Runtime 和数据库原样（停写但不删除）。
- DNS 与 Tunnel 切换可以逆转。
- 切换后若需回退，新服务器上产生的写入要逐表回迁；因此 S4 之后的观察期内，回退只在"新写入可以安全回迁"时执行，具体规则在 G-5 runbook 里写明。

## 附录：调研证据（2026-09-29，只读）

- 部署模式：ADR-014:25（self-hosted 为主推）；ADR-016:282；ADR-018:273（INT-A08）；MODULE_CONTRACTS.md:236-264（仅 Console PM2 合同）；Deployment_Guide:664-689（示例含 `DB_*`，已过时）。
- 生产 PM2 配置仅 `console/ecosystem.config.cjs`（:49-51 剔除 DB、Vault 与 OIDC 密钥）。
- 测试 Gateway 限制：`local-enterprise/gateway.mjs:28-35`；`config.mjs:4,55,85,111,140`；`pm2.config.cjs`（`HZY_APP_RUN_MODE=test`）。
- `tenant-gateway/src/index.js`：无 binding 时回落 `fetch`（:760-766）；`scheduled()`（:232）；策略同步（:881-915）。
- Gateway 信任校验：`foundation/server/utils/tenantGatewayTrust.ts:73-100`（token），:143-192（调度 HMAC、60 秒偏差）。
- Host 硬编码：`enterprise/nuxt.config.ts:169`；`enterpriseWorkflowProxy.ts:46-50`；`enterprise-topology.mjs:86-90`；gateway `index.js:601`。
- WAF：`consoleServiceBinding.ts:9-14,85-91`。
- Runtime 迁移要素：`install.sh:45,75`；`config.go:40,48,77-85,307`；`auth_signing.go:433,591`（OIDC 私钥在 Vault，主密钥必须成对迁移）；Directory Connector README:665-691。
