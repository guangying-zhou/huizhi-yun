# 自托管 Node 制品与进程配置（G-4）

本目录给出**待审批的生产安装方案**。构建脚本只在本机临时 worktree 工作；发布工具不会执行 schema 迁移。生产部署、站点配置、数据迁移、grant 与策略发布分别经过上线执行单的批准关口。网关的路由和安全合同仍以 [`gateway/README.md`](./gateway/README.md) 为准。

## 取舍与目录布局

使用 systemd：Runtime 和既有 Gateway 已采用 systemd，统一依赖顺序、重启和 journald；不用第二个 PM2 守护进程。每个应用独立无登录用户。发布目录为 `/home/hzy/apps/<app>/releases/<version>/`，`current` 是相对软链；工具在成功发布后保留最近 5 版和当前/前一版。`/home/hzy/tools/` 放本目录的 `release.mjs`、`release-lib.mjs`、`verify.mjs`、`health.mjs`、`collab-probe.mjs`（`health.mjs` 静态引用，缺失会使所有应用的健康检查失败）；`/etc/hzy/<app>.env` 属 root、0600，systemd 管理器读取后再降权。Gateway 私有 JSON 仍由 `hzy-gateway` 持有 `/etc/hzy-gateway/gateway.json`，权限 0600。生产包不包含配置值、凭据或数据库迁移。manifest 同时固定 OS/架构；macOS 本机验证包**不能**在 Anolis x86_64 上发布，正式包须在受保护的 Linux x86_64 构建机从同一提交构建。

| 进程 | 监听 | 用途 |
| --- | --- | --- |
| Tenant Gateway | `100.64.72.59:8780` | nginx 的 Tailscale 白名单入口；仅接受已配置对端 |
| Gateway health | `127.0.0.1:8781` | `/readyz` |
| data-runtime | `127.0.0.1:31080` | 本机拨号；对外仍使用 Platform 登记的规范 HTTPS 地址 |
| Console | `127.0.0.1:31001` | `/console/` |
| Enterprise | `127.0.0.1:31002` | `/enterprise/` |
| Workflow | `127.0.0.1:31003` | `/workflow/` |
| Aims scheduler-only | `127.0.0.1:31004` | `/aims/`，无用户入口 |
| Codocs editor | `127.0.0.1:31005` | `/codocs/` |
| Collab（独立） | `127.0.0.1:31007` | 仅经 Gateway 的 `/codocs/ws`、`/collab/*` WebSocket 升级；单元 `hzy-collab.service`，见下文“独立 Collab” |

业务服务不得得到 `DB_*`、Vault 主密钥或 OIDC 签名私钥；Platform 与 Runtime 的数据库材料分别在其受保护配置中。`env/*.env.example` 仅提供占位符，不可原样启动。`HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 必须与 Gateway JSON 中相应字段为同一私密值。`HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON` 只列配置核验过的回环地址；Runtime 规范地址和拨号源分别配置，不可互换。Console 的上游 OIDC 客户端 secret 与平台服务材料仅归 Console，签名私钥不归 Console。

Codocs 的 `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON` 必须包含 `"console":"http://127.0.0.1:31001"`。Codocs Service API 校验入站 service token 时通过该固定回环到 Console introspection；生产 Node 制品不配置 Cloudflare `HZY_CONSOLE_SERVICE` Binding。发布前以只读探针核对本机 Console `/oauth/introspect` 可达，且 Codocs 对无效 service token 仍拒绝；不可回退公网 Console。

公司周报汇总投递使用 Aims 调度进程的 `HZY_CODOCS_TARGET_DEPLOYMENT`（已登记的 `${tenant}-codocs`）和 `HZY_CODOCS_SERVICE_BASE_URL`（本机回环 `http://127.0.0.1:31005/codocs`）。Codocs 必须运行含 `/api/v1/service/company-weekly-summaries/{periodKey}:publish` 的制品，且 `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON` 登记 Codocs 回环地址。投递前核对 G-7 的两条精确 grant：`aims.runtime` → `aud=codocs`、`codocs:company-weekly-summary:publish`；`codocs.runtime` → `aud=data-runtime`、`data-runtime:codocs/write`（semanticScope `codocs.write`）。OSS 凭据由 Console 的 `oss.default` integration-config/Vault 提供，不放入 env 模板。上述配置与 grant 的生产写入另走审批和 G-7 plan/reviewHash/verify。

### S0 主机准备（执行前另行批准）

先核实 Anolis OS 23.5、MySQL 8.0.46、Tailscale 地址与来源白名单、Node 精确 `24.18.0`、`pnpm@11.17.0`、`git`、`tar`、nginx 和 systemd。**MySQL 首次初始化 datadir 前**须在 `/etc/my.cnf.d/zz-hzy.cnf` 的 `[mysqld]` 段设置 `lower_case_table_names=1`、`character_set_server=utf8mb4`、`collation_server=utf8mb4_unicode_ci`；初始化后不能再改前者。文件名须按字母序排在系统 `mysql-server.cnf` 后：新服务器 S0 实测较早的 `hzy.cnf` 会被系统文件的 `datadir` 等设置覆盖。开启 binlog 时还须设置 `log_bin_trust_function_creators=1`，否则普通迁移账号创建触发器会遇到 `ERROR 1419`；新服务器已验证设置后可以创建。先用 `mysqld --verbose --help` 核实 datadir 等生效值，再运行 `mysqld --initialize`，启动后只读核对 `@@lower_case_table_names`、`@@character_set_server`、`@@collation_server`、`@@log_bin_trust_function_creators`。准确的目录、账号和迁移步骤见 [G-5 runbook](../../docs/Go-Live-Self-Hosted-Data-Migration-Runbook.md) §2。Node 版本取仓库 `.nvmrc`，满足 `package.json` 的 `>=24.18.0 <25`；构建和运行均使用这一精确版本，避免 native 依赖 ABI 与 Nitro 产物差异。Node 安装源和包哈希须由运维另行确认。示例安装命令在完成 S0 审批后执行：

```sh
# 在受保护的运维工作站构建；必须从指定的完整提交 SHA 出发。
node --version                         # v24.18.0
corepack pnpm --version               # 11.17.0
node deploy/self-hosted/build.mjs --commit <40位SHA> --version <发行号> --out /path/to/empty-output

# 主机目录/账号：先按清单逐一创建 hzy-{console,enterprise,workflow,aims,codocs,collab,platform,gateway}
install -d -m 0755 /home/hzy/apps /home/hzy/tools
install -d -m 0711 -o root -g root /etc/hzy
install -m 0755 deploy/self-hosted/{release.mjs,release-lib.mjs,verify.mjs,health.mjs,collab-probe.mjs} /home/hzy/tools/
# 每个 app 的 /home/hzy/apps/<app> 归其专用账号；release 文件只读。
# 模板由运维填入后以 install -m 0600 -o root -g root 放到 /etc/hzy/<app>.env。
# /etc/hzy 仅允许穿越，不允许列目录；签名密钥等子目录仍为专用账号 0700。
# Gateway 配置按 gateway/README.md 放置，不使用 .env 保存其 secrets。
```

安装 `systemd/hzy-*.service`、Gateway `systemd/hzy-tenant-gateway.override.conf.example`（为既有 Gateway unit 添加 release 路径，不改 Gateway 源目录），`systemctl daemon-reload` 后再按顺序启用。Gateway override 保留 `After=tailscaled.service`，并等 Runtime 和应用启动。journald 的 `90-hzy-journald.conf.example` 是主机级轮转上限，安装前需检查现有日志策略；各进程输出到 journald，`Restart=on-failure`，120 秒内最多六次尝试。`verify.mjs` 会在启动前校验制品完整性；`health.mjs` 在启动后探测回环地址。

Runtime 已有 installer 生成的 `hzy-data-runtime.service`；另外安装 `systemd/hzy-data-runtime.override.conf.example`，使其在原 `/etc/hzy-data-runtime/.env` 之后读取 root 0600 的 `/etc/hzy/runtime.env`，并通过 `HZY_DATA_RUNTIME_CONFIG=/etc/hzy-data-runtime/config.json` 指向由 Runtime 账号读取的受保护配置。Platform 的 unit 仅对 Runtime 设置 `After`/`Wants`，避免 Runtime 故障时连带停止负责控制注册的 Platform。`/etc/hzy/platform-signing/` 应归 `hzy-platform` 且权限 0700，签名私钥文件 0600；其他应用账号不能读。

### 独立 Collab（Codocs v2 共享个人文档实时协作）

用户 2026-09-29 决定上线时启用共享个人文档协作，正式路径为 Host → Gateway `/codocs/ws` → 独立 Collab → Runtime；Console 内嵌 Collab 保持 `CONSOLE_COLLAB_MODE=disabled`。本节只描述**待批准的安装制品**，仓库不执行任何一步。

- **构建。** `build.mjs` 把 `collab` 与其他组件一起从同一固定 SHA、Node `24.18.0` 构建：不走 Nuxt，而由 `bundle-collab.mjs` 用 esbuild（取自 collab 已锁定的 `tsx` 依赖，不新增直接依赖）把 `collab/src/server.ts` 打成单文件 `.output/server/index.mjs`，主机上无需 `node_modules`。`verify.mjs` / 发布工具对 collab 额外拒绝包内 `.env*`、密钥文件和内嵌 `COLLAB_SERVICE_CLIENT_SECRET` 字面量。只构建 collab：`--apps collab`。
- **进程。** `systemd/hzy-collab.service`（用户 `hzy-collab`、`/etc/hzy/collab.env`、回环 `127.0.0.1:31007`，加固项不少于其它应用单元，并去除全部 capability、`PrivateDevices`）。**安装单元不等于启用**：在下面第 1–5 项批准前不 `enable/start`。`ExecStartPost` 运行 `health.mjs --app collab`：`/healthz` 必须返回 `data.healthy=true`（不接受 Hocuspocus 欢迎页），且监听只能在 `127.0.0.1`——本机任何非回环地址也能连上该端口则启动失败。
- **配置。** `env/collab.env.example`：回环监听、`COLLAB_CODOCS_RUNTIME_URL` 取 Runtime 拨号源（与 `HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN` 相同；规范 HTTPS 地址只登记、不被 Collab 读取）、`collab.runtime` 服务身份（`COLLAB_SERVICE_CLIENT_ID/SECRET`，secret 仅在该 0600 文件）、`COLLAB_CONSOLE_TOKEN_URL`、`COLLAB_V2_ENABLED=true`。**不设** `COLLAB_CODOCS_RUNTIME_TOKEN`（无静态 Runtime Token）、`COLLABORATION_AUTH_SECRET`（旧 HMAC 通道保持关闭，仅接受 Host 签发的一次性 v2 票据）、任何 DB/OSS/Vault 材料；快照字节经 Runtime 读写。
- **Gateway。** `gateway.json` 增加 `apps.collab.origin=http://127.0.0.1:31007` 与 `apps.collab.deploymentCode=<tenant>-collab`（Platform 登记值，见 `platform-bootstrap/README.md` “Collab 部署登记”；漂移检查 `check-collab-deployment.mjs`）。`/codocs/ws` 无 `Upgrade` 头的普通请求由 Gateway 直接 `426`。公网 nginx 增加 `location = /codocs/ws`（Upgrade/Connection 头、关闭缓冲、600 秒超时），示例见 [`gateway/README.md`](./gateway/README.md)。
- **健康与验收探针（只读，不发票据）。** 本机：`node /home/hzy/tools/health.mjs --app collab`。经入口深检：`node /home/hzy/tools/health.mjs --app collab --deep --gateway-url https://aidcp.wiztek.cn --public-host aidcp.wiztek.cn`——裸握手必须 `101` 且 accept 值正确，普通 HTTP 必须 `426`；Gateway 只放行白名单对端，故 `--gateway-url` 须为经 nginx 的公网入口（TLS），或从白名单对端发起。
- **服务身份与 grant。** `console/scripts/collab-prod-registration.mjs`（plan/reviewHash/apply/verify/rollback，参数化租户，`bindings.deployments.collab` 缺省即 Platform 登记的 `${tenant}-collab`，只授 `codocs:collaboration-snapshots:read|publish`、`aud=data-runtime`，不创建凭据）；同一清单也在 G-7 目录（`bindings.deployments.collab` 可选），见 `console/docs/G7-Production-Service-Grants.md`。令牌签发探测在 `probe-prod-service-tokens.mjs` 的 `collab.runtime` 项（2 个正例、15 个反例）。
- **启用前置（每项单独批准）：** ① 生产 Codocs 库安装快照/协作表（数据库 runbook 的“Codocs v2 协作 schema 安装清单”）；② `collab.runtime` 注册、grant `--verify`、令牌探测通过并把凭据写入 `/etc/hzy/collab.env`；③ Runtime 配置 `deploymentBindings.collab=${tenant}-collab`、`apps.codocs.snapshotV2Enabled=true`、`apps.codocs.collaborationV2Enabled=true`；④ 快照桶“版本 ID + 写一次条件”实测通过（`snapshot-bucket-proof.mjs`，见 `docs/Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan.md`）；⑤ nginx 与 Gateway 配置；⑥ 最后才把 Enterprise 的 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2`、`HZY_ENTERPRISE_CODOCS_COLLABORATION_V2`、`NUXT_PUBLIC_CODOCS_COLLABORATION_V2` 一并改为 `true`（模板默认全部 `false`）。双人编辑、断线重连、撤权踢出等浏览器验收仍需在目标环境完成。**部门文档协作是第三个独立开关：** 在个人协作链路验收通过之后，另行批准并依次完成 Codocs 库安装 `20260929_department_collaboration.sql`、Runtime `apps.codocs.departmentCollaborationV2Enabled=true`、Enterprise `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2` 与 `NUXT_PUBLIC_CODOCS_DEPARTMENT_COLLABORATION_V2`（模板默认 `false`）；不新增 capability 或 grant。

### Platform 专用入口（已存档）

> **存档（[Platform 方案 §8c](../../docs/Go-Live-Self-Hosted-Platform-Plan.md)，2026-09-29）**：生产控制面为共享的 `https://hzy.wiztek.cn`（gitlab 主机），新机不运行 Platform，不安装本节的 8782 反代与 `hzy-platform.service`；各应用的 `HZY_PLATFORM_URL` 等均为 `https://hzy.wiztek.cn`，新机到 Platform 只需出站 HTTPS。以下保留作参考。

Gateway 严格只服务 `aidcp.wiztek.cn`，不能代收 `platform.wiztek.cn`。选择内网服务器上的**独立 nginx 反代**（`platform-ingress/nginx.conf.example`），监听 `100.64.72.59:8782`，仅放行 nginx 主机 `100.98.120.65`，并核对 Host 精确为 `platform.wiztek.cn` 后转到 `127.0.0.1:31006`。外层 `gitlab.wiztek.cn` nginx 才终止 TLS，反代保留公网 Host；内层不接受公网直连。与 Gateway 复用同一 Tailscale/firewalld 来源白名单机制，但不改 Gateway 源目录或单站点绑定。选择 nginx 是因为主机已在入口链使用它，配置少且运维可用 `nginx -t` 检查；另一种扩展 Gateway 为双站点会扩大其信任边界。

**企业微信出站反代。** 企业微信可信 IP 保持 `8.130.81.31`（gitlab 主机）。Platform 出口 IP 不固定，故其企业微信服务端调用经 gitlab 主机反代（`platform-ingress/wecom-egress-proxy.nginx.conf.example`，`100.98.120.65:8790`，仅放行 `100.64.72.59`，仅三条路径，日志不含查询串），由 `NUXT_AUTH_WECOM_API_BASE` 指向；缺省仍直连官方地址。安装反代与写入该环境值均须另行批准。

安装与修改两端 nginx、firewalld 是独立环境写入，须另行批准。安装前核对 `nginx -t`、`ss -ltn` 中仅 Tailscale `8782` 和回环 `31006`，再从非白名单来源确认连接被拒；外层 nginx 到内层的 upstream 指向 `100.64.72.59:8782`，`Host` 原样为 `platform.wiztek.cn`。本机未执行这些命令。

## 首次部署

1. 在已批准的数据库 runbook 完成 MySQL、Runtime schema/视图及配置；先启动 `mysqld` 和 `hzy-data-runtime`，验证 Runtime 健康。
2. 在**独立运维工作站**从完整 commit 构建 `index.json` 和版本包；对交付文件用受保护渠道传输，主机上复核 index 与包 SHA。不要在源码工作目录直接打包脏文件。
3. 填好每个 `/etc/hzy/<app>.env` 和 Gateway JSON，设置受保护权限；确认所有监听端口和部署/租户绑定，不能把测试地址或占位符带入生产。Nuxt `runtimeConfig` 在 node-server 构建时会固化默认值；运行时覆盖须使用相应的 `NUXT_*` 配置键，尤其 OIDC/策略/部署事实。**这一键映射和无 secret 内嵌的生产启动探测是 S1 门禁，未完成时不能启站。**
4. 安装校验/健康/发布工具，然后调用 `node /home/hzy/tools/release.mjs --index /path/to/index.json --root /home/hzy/apps`。工具先核验 archive 和每个文件 SHA，再切换软链、重启 systemd、探测健康；任何失败自动恢复原链接。首次部署失败则移除 `current`，停止对应服务。
5. 按 MySQL → Runtime → Platform/Console/Workflow/Aims/Codocs/Collab/Enterprise → Gateway 顺序读服务状态；通过网关的正式入口做会话、签发、审批、Codocs 与调度冒烟。发布工具的本机健康探测不替代业务验收。

## 升级与回滚

升级使用新的 `<version>` 和完整提交 SHA 重建全部包，先完成单独审核的数据库兼容/迁移步骤，再调用同一个 `release.mjs`。程序不会迁移数据库。发布途中一个应用失败，会按反向顺序把已切换应用恢复到各自原来的 `current`，保留失败包供排查。旧版若不兼容已应用 schema，应按独立迁移 runbook 决定恢复路径，不盲目回退数据库。

人工回滚（须先核对目标包 manifest 与 schema 兼容）：

```sh
node /home/hzy/tools/verify.mjs --dir /home/hzy/apps/<app>/releases/<旧版本> --app <app>
ln -s releases/<旧版本> /home/hzy/apps/<app>/current.next
mv -Tf /home/hzy/apps/<app>/current.next /home/hzy/apps/<app>/current
systemctl restart hzy-<app>.service   # Gateway 为 hzy-tenant-gateway.service
node /home/hzy/tools/health.mjs --app <app>
```

`ln`/`mv` 要由能写该应用目录的发布账号执行；Gateway 回滚时先核对其配置与 Tailscale 来源白名单。健康检查只看本机，不打印头/令牌/正文；日志用 `journalctl -u hzy-<app>`。数据迁移和授权变更都有自己的恢复步骤，不由本工具自动回滚。

## 已知前置门禁

- G-12 的 Host 根路径接口尚在并行开发，完整业务冒烟须等该批合并。
- node-server 的 Nuxt `runtimeConfig` 与运行时环境变量映射必须在 S1 核对。脚本刻意不把 OIDC secret 编进产物；若部署时仍取构建默认值，须先补 `NUXT_*` 键或专用运行时读取，再发布。
- Gateway 已有独立 systemd 示例，覆盖文件应做一次 `systemd-analyze verify` 与本机启动演练，且需将 Gateway 包路径与旧 `/opt/hzy/current` 区分；这里不改其源目录。
