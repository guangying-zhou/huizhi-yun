# wiztek 自托管正式切换执行单（S4，草案，2026-09-30）

状态：**草案，待审；本文不授权任何服务器、生产库、Platform、Cloudflare 或云端写入。** 每个步骤的“批准”行给出**用户批准原文建议**，批准只覆盖该步列明的对象；任何不符即停在当前步骤、保留现场、不换参数重试。执行者默认是我（Claude Sonnet 5.5，执行操作员）；协调者（Claude Opus）转达批准并复核；用户是唯一的批准与业务验收人。

依据与优先级：本文是[数据迁移 Runbook](./Go-Live-Self-Hosted-Data-Migration-Runbook.md) §6–§8 的落地版本，遇到冲突以本文为准（Platform 已改用 `https://hzy.wiztek.cn`，[Platform 方案 §8c](./Go-Live-Self-Hosted-Platform-Plan.md)；新机不再运行 Platform）。同时引用：[拓扑方案](./Go-Live-Self-Hosted-Topology-Plan.md)、[S3 演练执行单](./Go-Live-Self-Hosted-S3-Rehearsal.md)（两轮实测与未验证项）、[G-9 共享 Platform 计划](./Go-Live-G9-Shared-Platform-Plan.md)（W9–W11、W4/W7 延后、红线）、[K2-E 排空证据设计](./Enterprise-Offline-Drain-Evidence-Design.md)、[G-4/自托管 README](../deploy/self-hosted/README.md)、[G-7 生产授权](../console/docs/G7-Production-Service-Grants.md)、协作 P0 与 [hzy0 启用计划](./Codocs-Collaboration-hzy0-Enablement-Plan.md)。

## 0. 主机、账号与固定事实

| 角色 | 主机/入口 | 账号与说明 |
| --- | --- | --- |
| 新机（目标） | `root@100.64.72.59`（`anolis-hzy`，Tailscale，NAT 后） | root（运维）；MySQL `hzy_migrator`（窗口内临时解锁）、`hzy_cutover`（K2 专用）、`hzy_rt_*`、`hzy_backup`；系统用户 `hzy-<app>` |
| gitlab 主机 | `root@gitlab.wiztek.cn`（阿里云 `iZcqwiqyhp9u8rZ`，公网 `8.130.81.31`，tailnet `100.98.120.65`） | 承载 nginx（`aidcp.wiztek.cn` 入口）、共享 Platform（PM2 `hzy-platform-dev`，`https://hzy.wiztek.cn`，v0.2.0）、目录连接器（`hzy-connector-runtime`）、构建机 |
| 日本机（源） | `root@oa.wiztek.cn`（`vultr`，公网 `45.32.20.65`，tailnet `100.77.180.33`，MySQL 8.0.45） | 只读 SSH 已批准；任何写入（停服务、临时账号、临时公钥）逐项批准；MySQL 经用户本机 `jp-root` login-path |
| Platform | `https://hzy.wiztek.cn` | 活动签名密钥 `psk_20260718_AElQdK3VQSja`（公钥指纹 `sha256:00495074…9935`，私钥离线备份已做）；C000001 prod 部署已登记：`C000001-console`(20)、`C000001-prod-enterprise`(21)、`aims`(4)、`workflow`(5)、`codocs`(6)、`assets`(7) 为 active，`altoc/finance/webdev` inactive；权益到期 2027-09-14 |
| 员工/租户 | 运维：`zhouguangying`（唯一 `ops_super_admin`，企业微信白名单仅其一）；租户管理员 `u_Dc3Q…` | Platform 写入由用户以方案 B 委托会话，用后删除 |
| 固定标识 | 租户 `C000001`，环境 `prod`；Runtime `c000001-prod-tenant-runtime`，规范端点 `https://aidcp-runtime.wiztek.cn`（不对外解析，回环拨号）；新机 `@@server_uuid=1e3c34dd-bb9b-11f1-bf6b-000c293f1086` | 统一库 `hzy_enterprise`，源副本 `hzy_aims_src`、`hzy_assets_src`；冷存档 `hzy_altoc/finance/people/webdev`；`schemaVersion=enterprise.v1`，激活 `generation=1` |

**红线（全程有效）**：不调用 Platform 的 `console-vault-migration`、`console-oidc-signing-bootstrap`、`v1/runtime/cutover-activation`、`recovery-route` 四个会按 `runtime_endpoint` 拨 Runtime 的端点（S4 全不需要，见 §21.2）；不调用 `runtime-token` POST/DELETE、不执行 onboarding 的 `runtime_token` 步骤、不带 `rotateRuntimeToken`；向 `latest` 发布 Runtime 包为禁止；Runtime 不启用自动更新；不复用 S3 材料、库、密钥或认可；`S3-ONLY` 演练密钥不得用于任何认可；不打印密钥、口令、token、cookie；先备份后写入；失败恢复该步前备份并停手，不换 key 盲重试。

## 1. 阻断项清单（按优先级）与建议解决顺序

| 优先级 | 阻断项 | 现状 | 建议解决 |
| --- | --- | --- | --- |
| P0-1 | **排空认可链（M3d）**未在任何副本上验证；且共享 Platform 的 `HZY_DRAIN_CONTROL_TOKEN` 就在 PM2 环境里，与测试 coordinator 共用，违反 K2-E“独立于 Gateway/测试 coordinator 的一次性密钥、经 systemd credential 分发”的要求 | 本地代码（`provider-report-cli.mjs`、`seal-cli.mjs`、Platform 审阅页、Go `VerifyEnvelope`）已完成、现场未执行；PM2 不支持 systemd credential | ①决定 HMAC 密钥分发方式（专用生产密钥经受保护文件读取并禁止回落 env；需要小的 Platform 改动与发布）；②在 A13 彩排里用 `s3r3` 副本走完整链；③profile 钉 `psk_20260718_AElQdK3VQSja` |
| P0-2 | **Runtime 固定版本制品与发布签名**：install 只接受带发布签名的包，我的 S3 构建是未签名的；Platform 里 stable 通道批准的是 `0.3.219-test…`（旧下载站） | **已查明（只读）**：签名流程是 `data-runtime/scripts/package-release.sh <精确版本>`，读环境变量 `HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE`（Ed25519 私钥文件）；私钥在用户 Mac `/Users/gavinzhou/Dev/secure/hzy-data-runtime-release/release-signing-private.pem`（0600，未读内容）；其公钥指纹前 16 位 `e1f7cfc0fb174116` 与日本 Runtime 信任的 `release-signing-public.pem` 及 hzy.wiztek.cn 的 `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM` **三处一致** | 需用户**授权使用该私钥**签一次：本机跑 `package-release.sh`（**不用 `update_dr.sh`**：它会上传 R2 并推进 `latest`）；产物放新机本地（`--no-auto-update`），不改 stable 通道；不做 `latest` |
| P0-3 | 仓库构建常量仍指向 `platform.wiztek.cn`（`build.mjs`、各 `env/*.example`、`g9-official-trust-plan.mjs`、部署文档） | 已列清单（G-9 §4） | A1：一次性改为 `https://hzy.wiztek.cn`，加测试，冻结提交 |
| P0-4 | **Vault 主密钥**尚未复制到新机；解密类冒烟（Vault 解析、Console 签发链、OIDC 私钥）从未验证 | S3 决定不拷；密钥在日本机 `/etc/hzy-data-runtime/console-vault-master-key` | A14：用户批准后经日本只读 SSH 管道传输并比对指纹；A15 彩排验证解密 |
| P1-5 | G-7 真实执行：`aims.runtime`、`enterprise.runtime`、`workflow.runtime` 等 service client 新签凭据；令牌探测按 R3 口径（G-7 的 34 项，含 21 项基础成功项）+ 反例签发探测 | 参数化 seed/verify/rollback 已隔离演练；真实库未执行 | 彩排中先对 `s3r3_hzy_console` 做 plan/apply/verify/rollback；窗口内对恢复的 `hzy_console` 做 |
| P1-6 | W9 Runtime 注册、W10 Aims 调度、W11 prod 策略包尚未做（依赖 Runtime 就位与 Console 副本） | 见 G-9 §10 | A7/B14–B16 |
| P1-7 | 自托管 Gateway/nginx `aidcp.wiztek.cn`（证书、WebSocket、白名单）未配置；Tailscale/firewalld 顺序需实测 | 拓扑 §2b 方案已认可 | A9 |
| P1-8 | 协作是否随切换启用（Codocs 协作 P0：快照桶实测、hzy0 双人验收未完成） | W4（collab 注册）延后 | 建议切换**不启用协作**，只在 M6 安装 schema；启用另批（C5） |
| P2-9 | 目录连接器切换、企业微信可信域名/回调、冷存档口径（员工公告：用户决定不发） | 连接器在 gitlab 主机（企业微信/钉钉身份与 profile 同步）；LDAP 目录连接器用户已决定不迁移（§21.2） | A10–A11、A18 |
| P2-10 | S3 演练库 `s3r1_*`/`s3r2_*` 与密钥待清理；`hzy_migrator` 通配收紧；`hzy_cutover` 口令轮换 | M3f 暂缓 | C4 |

**建议解决顺序**：P0-3（代码对齐）→ P0-2（Runtime 签名包）与 P0-1（排空链设计）并行 → A3/A5 构建与安装 → P0-4（Vault 传输）→ A15 彩排（含 M3d、Vault 解密、Console 签发、Workflow/Host 冒烟）→ P1 项（G-7 预演、nginx、W9）→ Go/No-Go → T0。**任一 P0 项未关闭不得进入窗口。**

## 2. 时间线总览

| 阶段 | 内容 | 生产影响 | 关口 |
| --- | --- | --- | --- |
| **T-n**（A1–A19） | 代码与制品、新机服务安装、Runtime 注册、入口与证书、排空链与彩排、Go/No-Go | 无 | 彩排全绿 + P0 关闭 + 用户 Go |
| **T0**（B0–B20） | 停写 → 导出/恢复 → 迁移与激活 → 授权与 Platform 写入 → 启动 → 开放入口 | **停机** | 每步判据；C9 冒烟为硬门禁 |
| **T+**（C1–C5） | 监控 72 h、回滚窗口、清理、后续项 | 无/回滚时有 | 修复前进优先 |

## 3. T-n：切换前（可提前，生产不受影响）

### A1 代码对齐：Platform URL、部署常量与文档
- **主机/账号**：本机仓库（Claude/Codex），无环境写入。
- **前置（只读）**：`grep -rn "platform.wiztek.cn"` 清单（G-9 §4）；`git status` 干净。
- **命令**：修改 `deploy/self-hosted/build.mjs:61`、`env/{console,enterprise,aims,codocs,workflow}.env.example`、`console/.env.prod.example`、`platform/scripts/g9-official-trust-plan.mjs` 输出为 `https://hzy.wiztek.cn`；`HZY_ENTERPRISE_POLICY_ISSUER`/`NUXT_VERIFIED_POLICY_ISSUER` 与 Platform `HZY_PLATFORM_POLICY_ENVELOPE_ISSUER` 一致；标注 `platform.env.example`、nginx 8782 反代、`hzy-platform.service`、`platform-bootstrap/README.md` 为存档。跑相关 `pnpm test`/`node --test`。
- **判据**：测试通过；无残留 `platform.wiztek.cn`（存档文档除外）。**回滚**：git revert。**证据**：提交 SHA、测试输出。
- **批准**：不需要环境批准（代码/文档）。**耗时**：0.5 天。

### A2 冻结发布提交与正式 tag
- **主机**：本机 → GitLab origin（只推 GitLab，不推 GitHub）。
- **前置**：A1 合入；`platform` 测试 348/348 与 typecheck 通过；各应用测试通过（console、enterprise、workflow、aims、codocs、gateway）。
- **命令**：确定 `RC_SHA`（40 位）与版本号 `S4_VERSION`（如 `1.0.0-s4`，`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`）；`git tag -a` 各组件正式 tag（沿用已推送的 `platform/v0.2.0`、`collab/v0.1.1`、`enterprise/v0.4.0`；其余组件按需新打）；`git push origin <tag>…`。
- **判据**：`git ls-remote --tags origin` 回读。**回滚**：删除远端新 tag（另批）。**证据**：tag 列表与 SHA。
- **批准**：`批准 A2：在 <RC_SHA> 上为 <组件列表> 打正式 tag 并只推送到 GitLab origin，不推 GitHub。`**耗时**：30 分钟。

### A3 构建自托管制品并传到新机
- **主机/账号**：gitlab 主机 root（Linux，已有 Node 24.18.0/pnpm 镜像，沿用 `build-platform.sh` 做法）；产物再经 tailnet 传新机。
- **前置**：磁盘/内存足够（构建约 2 GB）；`git archive <RC_SHA>` 源码包 sha256 两端核对。
- **命令形状**：`node deploy/self-hosted/build.mjs --commit <RC_SHA> --version <S4_VERSION> --out /wiztek/hzy-test/s4-build --apps console,enterprise,workflow,aims,codocs,gateway`（协作启用时加 `collab`）→ `index.json` + `<app>-<version>.tar.gz` → `scp` 到新机 `/home/hzy/build/`；新机 `sha256sum -c`。上传 Mac→gitlab 链路仅约 70 KB/s：**在 gitlab 主机直接 `git clone`/`git archive` 不可行时，改由新机拉取**（列入 A3 决策项）。
- **判据**：`release.mjs` 干运行校验通过；`index.json` 记录 commit、node、各包 sha256。**回滚**：删除构建目录。**证据**：`index.json`、sha256 清单。
- **批准**：`批准 A3：在 gitlab 主机按 build-platform.sh 方式构建 S4 制品并传到新机 /home/hzy/build，不发布、不启动。`**耗时**：1–2 小时（含传输，取决于链路）。

### A4 Runtime 固定版本签名包（P0-2）
- **主机/账号**：用户 Mac（私钥所在；我在其上执行，需用户授权使用私钥）→ 新机 root。
- **前置（只读）**：`stat` 私钥 0600、属主本人；公钥指纹 `e1f7cfc0…` 与日本 `release-signing-public.pem`、Platform `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM` 一致（已核）；确认不设置 R2 相关变量；stable 通道仍为 `0.3.219-test…`，**不改**。
- **命令形状**：`HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE=<私钥路径> HZY_DATA_RUNTIME_PACKAGE_DIR=<0700 临时目录> HZY_DATA_RUNTIME_COMMIT=<RC 短 SHA> ./data-runtime/scripts/package-release.sh <精确版本>`（本机交叉构建 linux-amd64/arm64、生成 sha256 与签名，**不上传**）→ 只把 linux-amd64 包与签名 `scp` 到新机 `/home/hzy-backup/runtime-release/`；在新机 `bash install.sh --base-url file:///home/hzy-backup/runtime-release --version <精确版本> --release-public-key /etc/hzy/release-signing-public.pem --no-auto-update --no-start`（已核：`install.sh` 用 curl 取 `$BASE_URL/<版本>/hzy-data-runtime_<版本>_linux_amd64.tar.gz{,.sha256,.sig}`，`file://` 基址（含 `?v=` 查询串）可离线安装，不访问 downloads；`--no-auto-update` 不装/不启更新 timer；目录布局须为 `<base>/<版本>/…`，即 `package-release.sh` 产出的 `VERSION_DIR`）。公钥文件取自 Platform 配置的同一公钥（DER sha256 已核 `e1f7cfc0fb174116c305766c2a39d90606e22cc5a3c02d1cf7fc749578bcab82`，hzy.wiztek.cn 的 `HZY_DATA_RUNTIME_RELEASE_PUBLIC_KEY_PEM` 与 `NUXT_…` 两项均一致）。**新机架构 x86_64 ⇒ linux_amd64。版本号取 >0.3.220 的下一个未占用号（建议 0.3.221），`HZY_DATA_RUNTIME_COMMIT=<冻结提交>`，产物留主 checkout 默认包目录 `data-runtime/build/packages/hzy-data-runtime/0.3.221`，使之后在主 checkout 运行 update_dr 自动跳过该号（**0.3.221 已保留给自托管生产，不得从 worktree 运行 update_dr.sh**；不提交修改 VERSION）；严禁运行 update_dr.sh（其 stage 后 promote 到 latest，会触发日本生产 Runtime 自动更新）。**
- **版本批准风险（只读代码核对）**：Platform 的批准版本（`dataRuntimeReleaseSettings`，现为 `0.3.219-test…`）决定 install-command 写入的 `desired_version`；`redeemTenantRuntimeEnrollment` 要求 `runtimeVersion === desired_version`，否则 **409 `tenant runtime enrollment version mismatch`**，即安装 0.3.221 会**阻止 enroll**；heartbeat 仅给出软错误码 `runtime_version_incompatible`（状态仍 ready，且 0.3.221>已批准版本会被降级保护保持原 desired）。批准新版本需 `fetchVerifiedDataRuntimeRelease` 从 `packageBaseUrl` 取已签 manifest，而本方案不发布下载站。已上报协调会话，未改通道。
- **判据**：包签名用公钥验证通过；二进制哈希本机与新机一致；`auto-update status` 为 disabled/pinned。**回滚**：删除新机上的包与安装目录。**证据**：包 sha256、签名文件 sha256、指纹核对（私钥内容与路径以外不入证据）。
- **批准**：`批准 A4：授权用本机 release-signing-private.pem 通过 package-release.sh 为 Runtime <精确版本> 签名（不上传 R2、不推进 latest、不改 Platform stable 通道），产物只放新机本地并关闭自动更新。`**耗时**：1–2 小时。

### A5 新机服务安装（固定版本，不启用）
- **主机/账号**：新机 root。
- **前置（只读）**：Node v24.18.0、pnpm 11.17.0 ✓；`/home/hzy/tools` 目前为空；系统用户 `hzy-*` 已存在（`hzy-platform` 不再使用）；`/etc/hzy`、`/etc/hzy/mysql` 存在。
- **命令形状**：`install -m 0755 deploy/self-hosted/{release.mjs,release-lib.mjs,verify.mjs,health.mjs,collab-probe.mjs} /home/hzy/tools/`；`/etc/hzy/<app>.env`（0600 root，模板填入：`HZY_PLATFORM_URL=https://hzy.wiztek.cn`、策略 issuer、回环 `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON`、`HZY_SELF_HOSTED_RUNTIME_ENDPOINT/DIAL_ORIGIN`、OIDC/服务凭据占位到窗口内 G-7 后填入，`check-env.py` 式检查禁止 `REPLACE_`）；`systemctl daemon-reload`；`node /home/hzy/tools/release.mjs --index … --root /home/hzy/apps`（仅切换软链与健康探测前置，**单元先 mask 不启动**）。
- **判据**：`verify.mjs` 对每个 release 通过；`systemd-analyze verify` 无告警；所有 env 无占位符（除窗口内才有的凭据，用受控占位标记在清单中）。**回滚**：移除 `current` 链接、`daemon-reload`。**证据**：verify 输出、env 键清单（无值）。
- **批准**：`批准 A5：在新机安装 S4 制品与工具、写入 /etc/hzy 配置与 systemd 单元，不启动任何服务。`**耗时**：2–3 小时。

### A6 新机 MySQL 授权（正式库名）与备份异地
- **主机/账号**：新机 root（MySQL）。
- **前置**：`hzy_migrator` 通配 `hzy\_%` 已覆盖正式库；`hzy_backup` 每日备份 timer 存在；`hzy_cutover` 目前仅 `s3r1/s3r2` 授权。
- **命令形状**：受审 SQL 文件（哈希记录）：`hzy_cutover` 对 `hzy\_aims\_src`、`hzy\_assets\_src`（`SELECT, INSERT, UPDATE, CREATE, TRIGGER`）与 `hzy\_enterprise`（`SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, CREATE VIEW, SHOW VIEW, TRIGGER`）；`hzy_rt_console/workflow/codocs` 对正式库 DML（S0 已存在，回读）；`hzy_rt_enterprise` 对 `hzy\_enterprise` DML。异地副本：每日备份密文推送 gitlab 主机 `/wiztek/...`（口令/密钥与产物分开）。
- **判据**：`SHOW GRANTS` 逐账号精确；`hzy_cutover` 拒绝全局权限。**回滚**：`REVOKE`。**证据**：授权前后清单、SQL sha256。
- **批准**：`批准 A6：在新机 MySQL 为 hzy_cutover/hzy_rt_* 授予附件 SQL 列明的正式库名 schema 级权限，并启用备份异地推送到 gitlab 主机。`**耗时**：1 小时。

### A7 Runtime 安装与 W9 注册
- **主机/账号**：新机 root；Platform 侧需要**租户管理员会话**（用户，`u_Dc3Q…`）。
- **前置**：A4 完成；新机到 `https://hzy.wiztek.cn` 出站 443 通（已测）；G-9 §10 W9 前置全部满足；Platform stable 通道 `desiredVersion=0.3.219-test…`（注册时用它；真实运行版本不同会得到良性 `runtime_version_incompatible`，见 G-9 §10.4）。
- **命令形状**：用户在 Platform 页面生成 `install-command`（一次性 enrollment code）→ 我在新机执行 `install.sh … enroll`，Runtime 以 `apps` 全关的最小配置运行；Platform 写入 `tenant_runtime_instances`（`c000001-prod-tenant-runtime`，prod）。之后停止 Runtime（数据未就位）。
- **判据**：实例状态 `enrolled/ready`；**test 实例与 `tenant_runtime_credentials` 快照不变**；无 `runtime-token` 调用。**回滚**：删除 prod 实例/enrollment/apps 行（G-9 §10 W9）。**证据**：12 组快照比对、instance 行（无令牌）。
- **批准**：`批准 A7：在新机安装 Runtime <版本> 并用租户管理员会话完成 c000001-prod-tenant-runtime 注册（不轮换 tenant 级 credential，关闭自动更新）。`**耗时**：1 小时 + 用户 10 分钟。

### A8（延后）W4 collab 应用注册/协作启用
- 按用户决定延后；本次切换**不启用协作**（P1-8）。schema 在 B6 安装（不启用开关）。W7 权益续期同样延后。

### A9 入口：gitlab 主机 nginx `aidcp.wiztek.cn`（先维护页）
- **主机/账号**：gitlab 主机 root（共用主机，改前备份、`nginx -t`、reload，不重启、不动其它站点与 PM2）。
- **前置（只读）**：`aidcp.wiztek.cn` A→`8.130.81.31` 已解析；现有 vhost 与证书清单；`certbot` 可用；新机 Gateway 监听 `100.64.72.59:8780` 与来源白名单（firewalld `hzy-tailnet` 区，仅 `100.98.120.65`）已由 S0 配置。
- **命令形状**：certbot 签发 `aidcp.wiztek.cn`；vhost：HTTPS server，`proxy_pass http://100.64.72.59:8780`，透传 Host、WebSocket（`/codocs/ws` 用 `location =`，Upgrade/Connection，关缓冲，600 s），**上游不可用时返回维护页**；此阶段 `return 503` 维护页而非反代（M8 才切）。
- **判据**：外部访问 `https://aidcp.wiztek.cn` 返回维护页 200/503 页面、证书有效；从非白名单来源直连新机 8780 被拒；`nginx -t` 通过。**回滚**：还原 vhost 备份、reload。**证据**：配置 diff、证书到期日、探测输出。
- **批准**：`批准 A9：在 gitlab 主机 nginx 新增 aidcp.wiztek.cn 站点（仅维护页，不反代到新机）并签发证书，改前备份。`**耗时**：1 小时。

### A10 目录连接器切换准备
- **只读核对结果（2026-09-30，日本机）**：日本机运行着 **`hzy-data-runtime-directory.service`**（`/opt/hzy-data-runtime/hzy-data-runtime directory-connector`，环境 `/etc/hzy-data-runtime/directory.env`，身份文件 `directory-connector-private.pem` + `state-cache.json` 在 `/etc/hzy-data-runtime/directory/`）；它不持有 MySQL 连接（`ss` 只见 `hzy-data-runtime` 主进程连库）。gitlab 主机另有一个 `hzy-connector-runtime.service`（“Enterprise Connector Runtime”，与目录连接器不是同一个单元）。**用户已决定**：生产目录连接器继续用 gitlab 主机上的 `hzy-connector-runtime`；日本机 `hzy-data-runtime-directory` 在 B1 停止，不搬到新机。
- **gitlab 主机 `hzy-connector-runtime` 现状（只读，2026-09-30）**：`/etc/systemd/system/hzy-connector-runtime.service`，用户 `hzy-connector`，监听 `0.0.0.0:18082`，由 nginx `tpapi.wiztek.cn` 反代；环境文件 `/opt/hzy/connector-runtime/.env`（0600），SQLite `/opt/hzy/connector-runtime/data/operations.db`；身份文件 `/etc/hzy-connector-runtime/connector-private.pem`（sha256 前 16 位 `2bdbbff59822b4b3`）、`release-signing-public.pem`（`280b5ab5982939fb`）。
- **它现在连接的是旧世界**：`HZY_CONSOLE_API_URL`、`HZY_CONNECTOR_RUNTIME_JWT_ISSUER`、`…JWKS_URL` 均为 `https://wiztek.huizhi.yun`（旧 Cloudflare Console），`…DATA_RUNTIME_URL=https://wiztek-data-runtime.huizhi.yun`，`PACKAGE_BASE_URL=downloads.huizhi.yun`；client `conn_5DziqPIGYVH5lt83i3ehTTxg`，tenant `C000001`，deployment `C000001-console`，`connector-runtime.C000001-console`。另有 `hzy-connector-runtime-update.timer`（active，自动更新）。
- **B14 改指范围**（B13/B14 之前不改）：`HZY_CONSOLE_API_URL`、`HZY_CONNECTOR_RUNTIME_JWT_ISSUER`、`…JWKS_URL`、`HZY_CONSOLE_TOKEN_URL` → `https://aidcp.wiztek.cn/console` 对应值，`…DATA_RUNTIME_URL` → 新 Runtime 入口；client 凭据须在新 Console（恢复自旧库）中仍有效，先只读核对；回滚 = 还原 `.env`（改前备份）并重启。更新 timer 是否保留另定。
- **hzy0/test 依赖**：nginx 仅 `tpapi.wiztek.cn` 一条反代；仓库 `deploy/test-env` 未引用该连接器，判定 test 不依赖，但**尚未从 test Console 侧确认**，改动前再核。
- **前置（只读）**：新机到 LDAP 的连通性；两个连接器当前指向的 Console/Runtime URL（仅键与主机名）。
- **命令形状**：**用户已决定 LDAP 连接器不迁移（2026-09-30）**：日本机 `hzy-data-runtime-directory` 在 B1 停止，新机不部署 directory-connector，切换后 LDAP 同步与自助改密停用；日后如需启用的做法见 C4。本步骤只做**只读核验**。
- **判据**：身份文件哈希与权限记录；手动触发一次 LDAP 同步的方案就绪。**回滚**：不改。**批准**：只读，无需批准。**耗时**：1 小时。

### A11 企业微信与 OIDC 回调准备
- **主机/账号**：用户（企业微信管理端）；Console 侧写入在 B14。
- **前置**：生产 `auth_client_redirect_uris` 130 条（18 条含旧域名）；Console 使用的企业微信集成配置在 Vault（随库迁移）。
- **动作**：用户在企业微信管理端为应用登记可信域名/回调 `aidcp.wiztek.cn`；确认企业微信可信 IP（新机出口 `39.78.255.170` 如需）。
- **判据**：用户确认页面配置保存成功。**批准**：`（用户操作，无需向我批准）`**耗时**：15 分钟。

### A12 排空证据链就绪（P0-1）
- **主机/账号**：新机 root（cutover CLI 专用身份）；gitlab 主机（Platform 密钥分发改动，需发布）；用户（审阅页）。
- **前置**：K2-E 精简方案 B 本地代码；共享 Platform 现用 `HZY_DRAIN_CONTROL_TOKEN` 环境变量，与测试 coordinator 共用（需拆分）。
- **代码核对结论（只读，2026-09-30）**：`platform/server/utils/enterpriseExternalDrainApproval.ts` 的 `drainCredential()` **已实现**所需行为：优先读 `$CREDENTIALS_DIRECTORY/offline-drain-hmac`（`readCredential`：文件与父目录须归进程所有、无组/其他权限、O_NOFOLLOW、恰好 32 字节），仅在 `NODE_ENV !== 'production'` 时才回落 `HZY_DRAIN_CONTROL_TOKEN`，否则 `credential_unavailable` 失败关闭；用后 `fill(0)`。hzy.wiztek.cn 的 PM2 进程 `NODE_ENV=production` 且**未设** `CREDENTIALS_DIRECTORY`，所以外部排空认可当前直接失败关闭，不会误用共用的 `HZY_DRAIN_CONTROL_TOKEN`。因此 **A12 不需要 Platform 代码改动**，只需要部署配置：0700 目录 + 0600 `offline-drain-hmac`（32 字节随机，与 `HZY_DRAIN_CONTROL_TOKEN` 不同值）+ 给 PM2 进程设置 `CREDENTIALS_DIRECTORY`（需要一次外科式 PM2 切换，属共享 Platform 写入，另批）。不属于本项范围的旁路：`cutover-activation.post.ts`、`drain-activity/index.post.ts` 仍直接读 `HZY_DRAIN_CONTROL_TOKEN`（另一类封存，非 M3d 外部排空认可），如要收紧是独立 P2。
- **线上构建核对（只读）**：hzy.wiztek.cn 运行的 PM2 `hzy-platform-dev`（cwd `/wiztek/hzy-test/platform-release-54e54837/platform`，端口 3011，DB `hzy_platform_dev@127.0.0.1:13317`，`NODE_ENV=production`）即 `platform/v0.2.0`（`54e54837`，包含 `e9a28c48`）；其 `.output/server/chunks/nitro/nitro.mjs` 中含 `offline-drain-hmac`、`EVIDENCE_CREDENTIAL_LENGTH`、`CREDENTIALS_DIRECTORY`，即线上已有 `drainCredential`/`readCredential` 逻辑，**无需 Platform 发布**。stable 通道回退目标 `0.3.219-test.adr018-candidate.7` 在 `platform_runtime_releases` 中 id=2、status=available。
- **A12 密钥与 PM2 执行方案（供审）**：
  1. **生成位置**：新机 root，`umask 077`，`openssl rand -out <新机凭据目录>/offline-drain-hmac 32`（原始 32 字节）。新机凭据目录 `/root/.hzy-drain-cred/<rehearsal|prod>/`（0700 实体目录，非符号链接）。seal CLI 通过 `CREDENTIALS_DIRECTORY=<该目录>` 读取（不接受命令行/env 秘密）。
  2. **分发到 Platform（gitlab 主机）**：用户本机中转，与 A14 同法，不落本机盘：`ssh root@100.64.72.59 'cat /root/.hzy-drain-cred/<k>/offline-drain-hmac' | ssh root@gitlab.wiztek.cn 'install -m 600 -o root /dev/stdin /root/hzy-drain-cred/active/offline-drain-hmac.new && mv -f /root/hzy-drain-cred/active/offline-drain-hmac.new /root/hzy-drain-cred/active/offline-drain-hmac'`（目录 `/root/hzy-drain-cred/active/` 0700 实体目录，PM2 进程属 root，`readCredential` 要求文件与父目录归进程所有且无组/其他权限）。两端各算指纹 `sha256("hzy-drain-key-fp:"+key)` 前 16 位比对，不打印密钥。
  3. **演练密钥与生产密钥分开**：A15 用 `rehearsal` 密钥（key ID `s3r3-…`）；A15 结束**立即**在两端 `shred -u` 并回读文件不存在（Platform 此后 fail-closed `credential_unavailable`）；B10 前生成 `prod` 密钥（key ID `s4-…`）重复 1–2 步；B20（及 C3 兜底）在两端销毁并回读。**更换/撤销密钥不需要重启 PM2**：`approveExternalDrain` 每次请求调用 `drainCredential()` 重新读文件，只有**首次设置 `CREDENTIALS_DIRECTORY`** 需要重启一次。`active/` 内文件替换用 `mv` 原子重命名。
  4. **PM2 首次设置（A15 之前，一次外科切换）**：新写参数化脚本（不改 `w3-platform-switch.cjs`），沿用 `prepare/switch/rollback/persist` 模式：`prepare` 备份 `/root/.pm2/dump.pm2`、从 `/proc/<pid>/environ` 导出 `rollback.config.json`，`candidate.config.json` = 同 cwd/同入口 + 仅叠加 `CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active`（脚本断言 `DB_NAME=hzy_platform_dev`、`PORT=3011`、其余 PM2 进程 pid 不变）；`switch` = `pm2 delete hzy-platform-dev` → `pm2 start candidate.config.json --only hzy-platform-dev` → 轮询 `http://127.0.0.1:3011/api/health`，失败自动回滚；`persist` 才改写 dump.pm2（`pm2 save` 语义，只替换该进程条目，其它条目逐项不变），使 `pm2 resurrect` 后仍带该 env。**只影响 `hzy-platform-dev`**。
  5. **停机与影响**：进程重启窗口为 `pm2 delete` 到 health 200，W3 同法切换未记录精确秒数，预计十几秒；本次执行时记录实测值并回填。期间 hzy.wiztek.cn 的 Platform API 不可用：test Runtime（Mac，5 分钟心跳）错过一次心跳即重试，策略信封续期同理；运维登录会话中断需重新登录（cookie 委托文件在窗口内不使用）。不涉及数据库写入。
  6. **判据与回滚**：切换后回读——`/api/health` 200；进程 env 含 `CREDENTIALS_DIRECTORY`、`NODE_ENV=production`、`DB_NAME=hzy_platform_dev`；其它 PM2 pid 不变；用与进程同 uid 的一次性 node 探针调用构建内 `readCredential` 逻辑只回读“长度=32”（不打印内容，A15 前用占位测试密钥，测后销毁）；`HZY_DRAIN_CONTROL_TOKEN` 未改。回滚：`rollback` 模式 `pm2 delete` + 用 `rollback.config.json` 启动 + 健康检查 + 其它 pid 核对；`persist` 之前不动 dump.pm2，回滚无需还原 dump。
  7. **共享 Platform 写入批准**：属于对 hzy.wiztek.cn 的一次进程重启（不改库、不改构建），逐项批准；文案见下。
- **命令形状**：①生产 HMAC 密钥分发（专用密钥、经受保护 0600 文件、生产禁止回落 env——代码已具备；密钥仅用于本窗口，事后撤销）；②准备 P 阶段原始材料采集清单（旧 Cloudflare Gateway route/版本回读、日本机 systemd 状态、九库逐表 COUNT/CHECKSUM 两轮≥5 分钟、新机 nginx 维护页回读）和冷存档四份人工材料（altoc/finance/people/webdev 的 deployment-inventory 证据）；③`provider-report-cli.mjs collect`/`seal-cli.mjs seal` 参数文件；④profile：`enterprise-cutover-profile.v1`（tenant C000001，env prod，runtimeDeployment `c000001-prod-tenant-runtime`，enterpriseDeployment `C000001-prod-enterprise`，sourceDeployments `C000001-aims/assets`，instanceId=新机 server_uuid，schemaVersion `enterprise.v1`，generation 1，sourceAims `hzy_aims_src`，sourceAssets `hzy_assets_src`，target `hzy_enterprise`，**Platform kid=`psk_20260718_AElQdK3VQSja`、公钥指纹经与 Platform 读回值逐字核对**，cutoverKey=`s4-C000001-prod-<日期>`）。
- **判据**：密钥分发方式经审；profile 校验通过（`cutoverprofile.Load`）；`S3-ONLY` 密钥不出现。**回滚**：撤销密钥、恢复 Platform env。**证据**：profile 指纹、密钥 ID（非值）。
- **批准**：`批准 A12：①在 gitlab 主机建 /root/hzy-drain-cred/active（0700）；②仅重启 hzy-platform-dev 一次，叠加 CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active（不改构建/库，含 persist）；③在新机生成排空认可 HMAC 密钥，经用户本机管道分发到 Platform，仅比对指纹；④在新机创建生产 cutover profile（钉 hzy.wiztek.cn 活动 kid）。演练密钥用后即销毁，生产密钥 B20 销毁。`**耗时**：约半天（无 Platform 代码改动；含 PM2 外科式配置切换与 profile）。

### A13 hzy_cutover 授权与 profile 就绪核验（合并入 A6/A12）
- 只读复核：`hzy-enterprise-migrate --profile P --plan` 在彩排库上可运行；账号无全局权限；记录 `hzy_cutover` 口令已受保护。

### A14 Vault 主密钥传输（P0-4）
- **主机/账号**：**用户本机中转**（新机未必持有登录日本机的 SSH 身份，故新机不直接 ssh 日本机）：本机 → 日本机（只读 SSH，读取）、本机 → 新机 root（写入）。
- **前置**：日本机 `/etc/hzy-data-runtime/console-vault-master-key` 存在（S3 已见）；**只读核对新机（2026-09-30）：无 Runtime 系统用户（仅 hzy-console/enterprise/gateway/workflow/aims/codocs）、无 `/etc/hzy-data-runtime`，故 A14 须在 A4 install 之后执行**；S3 已核对库内指纹 `3b1b0e37c78e516dd17853b1cb895687`（19 行）；**新机已完成 A4/A7 的 Runtime 安装**（新机上现无 `/etc/hzy-data-runtime`、无 Runtime 用户，`install.sh` 会创建）。
- **命令形状**（在用户本机执行，密钥只经管道内存，不落本机盘、不进 shell 历史）：`ssh root@oa.wiztek.cn 'cat /etc/hzy-data-runtime/console-vault-master-key' | ssh root@100.64.72.59 'install -m 600 -o <Runtime 运行用户> -g <Runtime 运行用户> /dev/stdin /etc/hzy-data-runtime/console-vault-master-key'`；两端各算 `VaultMasterKeyFingerprint`（sha256 前 32 位）比对，不打印密钥。
- **判据**：两端指纹一致；文件权限 0600、属 Runtime 用户。**回滚**：新机 `shred -u` 该文件。**证据**：指纹、权限。
- **批准**：`批准 A14：在用户本机以管道把日本机 Console Vault 主密钥传到新机 /etc/hzy-data-runtime/（0600），仅比对指纹，不打印、不落盘。`**耗时**：15 分钟。

### A15 彩排 R3（`s3r3_*`，含此前未验证项）
- **主机/账号**：新机；日本机导出沿用第二轮管道。
- **范围**：把 S3 未验证项一次验完：M3d（provider-report → seal → Platform 审阅页导入/复核 → 签发认可 → `hzy-enterprise-drain --mode activate` 于演练库 → `verify-views` 正向）；Vault 解密与 OIDC 签名链（Runtime 带 Vault 密钥启动，Console 签发、JWKS）；Console/Workflow/Enterprise/Aims/Codocs 全部启动 + Host 冒烟；G-7 对 `s3r3_hzy_console` 做 plan/apply/verify/rollback 与签发探测；Workflow 发起/审批/回调；无公网回落抓包；计时。**限制**：W10/W11 与真实 Platform 绑定，只演练到“接口前置满足”；M3d 的 Platform 签发使用演练 `cutoverKey`（例如 `s3r3-…`）和演练 target，认可不可用于生产（cutoverKey/target 不同），需用户确认可在共享 Platform 上产生该签发记录。
- **演练认可隔离（2026-09-30 只读核对 `cutoverprofile.VerifyEnvelope`、`unified.validateExternalApproval`、`VerifyExternalDrain`、`ActivateFinalCopy`）**：签名认可与激活**绑定**了：Ed25519 签名（profile 钉的 kid 与公钥）；`type`；`tenant`；`environment`；`runtimeDeployment`；**`instanceId`（新机 server_uuid，演练与正式相同，不构成隔离）**；`cutoverKey`；`generation`（演练与正式相同，不构成隔离）；**两个源库 schema 名与部署编码**（认可里的 `sources[].schema` 必须等于 profile/计划的 `SourceAims/SourceAssets`，即演练的 `s3r3_hzy_aims/assets` 对正式的 `hzy_aims_src/hzy_assets_src`）；provider 各 schema 与探测行数/行哈希（激活事务在目标实例上重读并逐项比对）；final plan 的 `ReviewHash`（覆盖 Config，含 Target 与源库名、instanceId、generation）以及目标库 ledger/registry。**未直接绑定**：目标库名本身与 profile 文件指纹不在认可载荷里。**结论**：演练签出的认可在正式激活时会同时因 ①`cutoverKey` 不等 ②源 schema/provider schema 名不等 ③行哈希不等（演练与正式数据不同）而被拒，且 final plan 与 ledger 也不匹配，因此**在演练 `cutoverKey`、源库名与正式不同的前提下不能激活 `hzy_enterprise`**；这是多重独立不匹配，不是 P0。**规则**：演练 `cutoverKey` 统一前缀 `s3r3-`，正式统一前缀 `s4-`，二者不得相同；演练源库必须用 `s3r3_` 前缀；演练用 profile 的 target 只能是 `s3r3_hzy_enterprise`。**可选加固（P2，不阻塞）**：把 `target` 库名写入签名载荷 `report.binding` 并在 `VerifyEnvelope`/`validateExternalApproval` 中与 profile 精确比较（需 Platform 封存 CLI + Platform 签发 + Go 三处同步小改，各一条测试）；如后续实施，仍不改变上面的运行规则。**演练用 HMAC 密钥**：与 S4 的生产密钥用不同 key ID，演练结束**立即撤销**并记录 key ID。
- **判据**：全流程无失败项；耗时表。**回滚**：删除 `s3r3_*`（另批）。**证据**：回执、计时、日志摘要。
- **批准**：`批准 A15：在新机对 s3r3_* 演练副本完整演练 M3d、Vault 解密、G-7 与全服务冒烟，允许在共享 Platform 签发一次演练 cutoverKey 的排空认可（不用于生产）。`**耗时**：0.5–1 天。

### A16 冷存档口径（用户）
- **用户决定（2026-09-30）：不发员工公告**，公告稿 `docs/Go-Live-Self-Hosted-S4-Staff-Announcement.md` 保留但标注“用户决定不发”。以下仅保留冷存档与值班口径确认：
- 用户确认：Finance/People/Webdev/Altoc 切换后不可用（冷存档）；停机时段、新入口 `aidcp.wiztek.cn` 通知；每周需先“生成应报清单”（Runbook §9b）；值班人、回滚决策人。**批准**：用户操作。

### A17 Go/No-Go（T-1 日）
- **检查表**：P0-1~4 全部关闭；A15 全绿；A2 tag 与 A3 制品哈希一致；Platform 12 组快照与备份新鲜（当日 `pd_backup`）；无其它管理员计划改动 Cloudflare/旧主机/Platform（变更冻结）；日本机磁盘与负载正常；回滚决策人在线。
- **批准**：`Go：确认在 <日期时段> 执行 S4 切换窗口，按本执行单 B0–B20 逐步批准。`

## 4. T0：停写窗口（预留 4 小时；估时基于 S3 第二轮实测）

> 所有耗时为“脚本执行”，不含人工确认等待。每步前若涉及 `hzy_platform_dev`，先手动 `pd_backup.py` 并在新机核验。

### B0 开窗与冻结
- **主机**：新机/gitlab 主机（只读+备份）。**前置**：A17 Go；nginx `aidcp` 为维护页；员工已通知。**命令**：手动 Platform 加密备份；记录新机 `@@server_uuid`、磁盘、`hzy_*` 库清单。**判据**：备份核验通过。**回滚**：无。**证据**：备份 sha256。**批准**：随 A17。**耗时**：5 分钟。

### B1 M4 停写（用户执行 + 我核验）
- **Cloudflare 操作（2026-09-30 具体化）**：生产旧入口 `wiztek.huizhi.yun` 由 Worker `hzy-tenant-gateway`（路由 `*.huizhi.yun/*`，zone `huizhi.yun`）服务；**同一个 Worker 与同一条通配路由也在服务测试环境 `hzy-test.huizhi.yun`**（响应头 `x-hzy-test-environment: C000001`），所以**不能删除通配路由、不能停用/回滚该 Worker 的版本**。做法：在 zone `huizhi.yun` → Workers Routes 新增一条更具体的路由 `wiztek.huizhi.yun/*`，Worker 选 **None**（更具体的路由优先，该主机绕过 Worker）。回读（我执行，可能有 1 分钟传播）：`curl -s -o /dev/null -w '%{http_code}' https://wiztek.huizhi.yun/` 不再是 200 且响应头无 `x-hzy-gateway`；`https://hzy-test.huizhi.yun/` 仍 200 且带 `x-hzy-test-environment`。回滚：删除这条 `wiztek.huizhi.yun/*` 路由。注意：Worker 的 `*/5 * * * *` cron 不受路由影响，仍会尝试调度，但日本机 Runtime 已停，只会产生失败日志，不产生写入。
- **主机/账号**：Cloudflare（用户禁用旧 Gateway Worker 路由/版本）；日本机 root 停 `hzy-data-runtime`、`hzy-data-runtime-directory`（目录连接器）、`hzy-data-runtime-update.timer` 与 `hzy-data-runtime-update-request.path`（API 触发更新，二者都 enabled/active）。已只读核对：`hzy-data-runtime-ctr812`、`hzy-connector-runtime`、`hzy-notification-runtime` 三个单元在日本机均 **inactive 且 disabled**（ctr812 的 update-request path 也 disabled），且当前只有 `hzy-data-runtime` 主进程持有 MySQL 连接，故不需要操作，仅在 B1 回读它们仍为 inactive。
- **前置（只读）**：日本机 `systemctl list-units/timers` 快照；`SHOW PROCESSLIST`；旧入口当前可达。
- **命令形状**：`systemctl stop hzy-data-runtime-update.timer hzy-data-runtime-update-request.path hzy-data-runtime-directory hzy-data-runtime`（先停触发源再停主进程，**可逆**，回退时逆序启）；用户在 Cloudflare 禁用 Gateway。
- **gitlab 主机 connector（补充，2026-09-30）**：gitlab 主机上的 `hzy-connector-runtime.service` 与 `hzy-connector-runtime-update.timer` 现在均 active/enabled（连的是旧 Console `wiztek.huizhi.yun`，最近一次取令牌 2026-09-29 23:22），B1 必须一并停止，不能只依赖 Gateway：`systemctl stop hzy-connector-runtime-update.timer hzy-connector-runtime.service`（先停 timer 再停服务，**可逆**），随后 `systemctl is-active` 回读两者 inactive，并确认 18082 无监听、`tpapi.wiztek.cn` 反代返回 502/503。**只读结论（为何仍要停）**：旧 Console 是 Cloudflare Worker，本身不连 MySQL；B1 前 `SHOW PROCESSLIST` 只有日本机 `hzy-data-runtime` 主进程持有库连接，`hzy_console` 的所有写入都经该 Runtime。所以日本机 Runtime 一停，connector 经旧 Console 的写入（`directory-profiles:sync`、心跳）就会失败而不落库；但 connector 会持续重试并报错，且若先于 Runtime 停止之前有请求在途，可能造成 B2 两轮 COUNT 之间的差异，因此把它放在 B1 中**最先**停（早于日本机 Runtime），保证 B2 两轮一致。回读判据：gitlab 主机两个单元 inactive；B2 两轮逐表一致。**回滚**：`systemctl start hzy-connector-runtime.service hzy-connector-runtime-update.timer`（B14 改 env 之前 `.env` 未动，可直接还原）。
- **判据**：旧入口不可达；日本机无运行进程/timer；`SHOW PROCESSLIST` 无业务连接。**回滚**：重新启用 Gateway、启动 units。**证据**：Cloudflare 回读、systemd 状态。
- **批准**：`批准 B1：由用户停用旧 Cloudflare Gateway；批准在日本机停止 hzy-data-runtime、hzy-data-runtime-directory、hzy-data-runtime-update.timer 与 hzy-data-runtime-update-request.path，并在 gitlab 主机停止 hzy-connector-runtime.service 与 hzy-connector-runtime-update.timer，均可逆。`**耗时**：10 分钟。

### B2 停写证据与冻结核验
- **主机**：新机（CLI）/日本机（只读，经 `hzy_dump_s4@localhost` 或复用最小账号）。**前置**：B1。
- **命令形状**：九库逐表 `COUNT(*)` + `CHECKSUM TABLE` 两轮，间隔 ≥5 分钟（`p1_counts.py` 模式）；Cloudflare/systemd/nginx 四类材料落新机 0700，逐件 0600，记录 SHA-256。
- **判据**：两轮逐表一致；四类材料齐全。**回滚**：不一致→找出写入者，窗口不前进。**证据**：材料清单与哈希。**批准**：随 B1（只读部分）；日本机临时账号另含在 B3。**耗时**：15 分钟（含 5 分钟间隔）。

### B3 日本机本地导出（沿用第二轮管道）
- **主机/账号**：日本机 `nice`/`ionice` 单连接；新建临时 `hzy_dump_s4@localhost`（九库 `SELECT, SHOW VIEW, TRIGGER` + `SHOW_ROUTINE`）；一次性 ed25519 拉取密钥的强制命令（`restrict,from=…,command="tar …"`）。
- **前置（只读）**：磁盘余量、swap 基线（守卫阈值 +500 MB / load>1.5）；RSA 公钥指纹两侧一致。
- **命令形状**：`jp_export.py`：`mysqldump → 明文 sha256/字节/Dump completed → zstd -3 -T1 → AES-256-CBC（每库随机密钥，RSA-4096 OAEP 包装）`。
- **判据**：九库 `ok`，守卫未触发。**回滚**：删除目录/公钥行/DROP 账号。**证据**：manifest。
- **批准**：`批准 B3：在日本机创建临时 hzy_dump_s4@localhost、受限拉取公钥与 /root/.hzy-s3-jp 目录，本地导出九库加密产物，完成后立即清理并回读。`**耗时**：约 1 分钟（第二轮实测 19 秒）。

### B4 拉取、核验、清理日本机
- **主机**：新机拉取（tailnet DERP，约 72 KB/s）；日本机清理。**判据**：密文/明文 sha256、字节、Dump completed 全匹配；日本机 `authorized_keys` 恢复原行数与哈希、临时账号 DROP。**回滚**：重新拉取。**证据**：核验输出、日本机回读。**批准**：随 B3。**耗时**：约 7 分钟（28.6 MB；**主要瓶颈**）+ 核验 8 秒。**路径已定（复审 P1-6）：B3/B4 就是日本机本地导出 + 拉取，不用直连。** R3 复用了第二轮的导出，新机直连日本 MySQL 的方式要 82 分钟，不可接受；因此 S4 **不使用** `hzy_dump@39.78.255.170`（S3/R3 用的只读账号，凭据文件在新机 `/root/.hzy-s3/`），该账号仍按 C3 单独清理。B3 的批准文案与 C3 清理项以本节为准。

### B5 恢复为正式库名与停写后核验
- **主机/账号**：新机 root（建库）+ `hzy_migrator`。
- **命令形状**：建库 `hzy_console`、`hzy_workflow`、`hzy_codocs`、`hzy_aims_src`、`hzy_assets_src`、`hzy_altoc`、`hzy_finance`、`hzy_people`、`hzy_webdev`（`utf8mb4_unicode_ci`），去 DEFINER 导入；流内 sha256 与 manifest 复核。
- **判据**：**停写后逐表 COUNT 与 B2 基线零差异（硬门禁）**；Vault 指纹对（19 行 `3b1b0e37…`）；结构计数一致。**回滚**：DROP 这些库重来（新机无生产写入）。**证据**：restore.jsonl、L1/L2/L3。
- **批准**：`批准 B5：在新机创建 9 个正式库名并导入 B4 已核验产物；同时临时解锁 hzy_migrator（解锁与重锁时点见 §21.3，B13c 完成后统一重锁）。`**耗时**：约 2 分钟（console 122 s）+ 校验 5 分钟。

### B6 各库迁移（M6）
- **主机/账号**：新机 `hzy_migrator`（窗口内临时解锁，结束重锁）。
- **命令形状（每步前加密备份、每步 verify）**：Workflow 012→013→014；Codocs：`20260922_codocs_owned_command_receipts`、`v1.6_product_document_creation`、`20260920_document_snapshots`、`20260924_document_collaboration_sessions`、`20260929_department_collaboration`（**安装不启用**）；Aims 源副本：先移除两张无主键备份表（存档保留），再 v5.3、v5.19–v5.41；Assets 源副本：`20260907`、`20260909`、`20260913–20260917`、`20260929_backfill_schema_drift`（3 行 PASS）；Console 选装项按 release 配置。
- **Workflow 012/013/014 核对（只读，2026-09-30）**：
  - 迁移文件与 verify 均在 rc1、rc2、rc3（`workflow/docs/migrations/01[234]_*.sql` 各 6 个文件：三个迁移 + 三个 `_verify.sql`）；对应 Runtime 代码提交（`b6e3b2a6` 投递终态与依赖迁移、`587ef4be` 冻结待办关闭对创建通知的依赖、`04b19a70` 待办创建通知进入事务 outbox、`4924aa88` 有界重试与受控恢复、`63566e06` 并发投递不重复消耗重试预算、`a86f91b2` 通知详情核验以签名委托传递查看者）全部是 `s4-rc1` 的祖先，因此在 Runtime 0.3.221（`ce08d40e`）里。
  - B6 链已装：`m3a-workflow.sh` 依次 `012`→`013`→`014`，每步前加密备份、每步跑对应 verify 并核对 PASS 行数（012:2、013:4、014:1）。三轮彩排（S3 第一轮 `20260929T113406Z`、第二轮 `s3r2-…`、R3 `s3r3-…`）的 `workflow.jsonl` 全部 `all_pass:true`，SQL sha256 一致：012 `ef19543f…6e64`、013 `ea97d4e9…4f42`、014 `6fa48bda…f8`（三轮相同），每步 0–1 秒，整段 3 秒。
  - 生产 Workflow 库现状（旧库只读）：`flow_notification_outbox` **尚不存在**（012 会创建），`flow_actionable_outbox` 12 行、`flow_callback_logs` 2 行、`flow_instances` 80 行，总量不足 1 MB。
  - **实际 DDL 算法与锁评估**（临时 MySQL 8.0.34 上用生产 `SHOW CREATE TABLE` 结构 + 012 复现，逐条加 `ALGORITHM=` 探测，取第一个被接受的；新机是 8.0.46，`INSTANT` 带 `AFTER` 位置自 8.0.29 起支持，语义相同）：
    | 语句 | 实际算法 | 说明 |
    | --- | --- | --- |
    | 013 `ALTER flow_notification_outbox`（ENUM 追加 `abandoned` + 4 列） | **INSTANT** | 仅元数据，MDL 短暂独占 |
    | 013 `ALTER flow_actionable_outbox`（ENUM 追加 + 6 列 + `ADD INDEX`） | **INPLACE**（`INSTANT` 被拒，因含加索引） | 无表拷贝，`LOCK=NONE` 可并发 DML；12 行，毫秒级 |
    | 013 `ALTER flow_callback_logs`（ENUM 追加 + 4 列） | **INSTANT** | 仅元数据 |
    | 013 `CREATE TABLE flow_delivery_audit` | 新表 | 无锁问题 |
    | 014 `ALTER flow_delivery_audit`（3 列） | **INSTANT** | 仅元数据 |
    | 012 `CREATE TABLE IF NOT EXISTS flow_notification_outbox` | 新表（含指向 `flow_instances` 的外键，`ON DELETE CASCADE`） | 建表时对 `flow_instances` 取元数据锁，瞬时 |
    SQL 文件不显式写 `ALGORITHM`，由 MySQL 默认选择“最轻的可行算法”，上表即其实际选择；窗口内 B6 时应用已停、Workflow 库只有本流程在写，不存在并发 DML 竞争，MDL 等待只可能来自遗留长事务（B1 后 `SHOW PROCESSLIST` 已确认无业务连接）。B6 判据追加：`INFORMATION_SCHEMA.INNODB_TABLES.INSTANT_COLS`（`flow_notification_outbox`、`flow_callback_logs`、`flow_delivery_audit`）大于 0 作为 INSTANT 的旁证，并把各步耗时写入 `schema/workflow.jsonl`（已有 `seconds` 字段）。
  - **回滚**：每步前的加密备份 `schema/workflow.before-<step>.sql.gz.enc`；恢复该库备份并停手（DDL 非事务，不做反向 ALTER）。
  - 相关但不属于本次切换的候选：`console/docs/sql/Console-SQL-Seed-v2.30-workflow-delivery-recovery-grants.sql` 是 `workflow.maintenance` 恢复客户端的**候选**授权（文件头写明需审批身份与能力、客户端须先由控制面登记、绑定的是测试 deployment `C000001-test-workflow-local`），**不进入 S4**；恢复能力（`workflow:delivery-recovery`）在生产保持未启用。
- **判据**：每步 verify PASS（S3 第二轮 68 秒）。**回滚**：恢复该步前备份并停手。**证据**：`schema/*.jsonl`。
- **批准**：`批准 B6：在新机 9 个库副本上执行已审 SQL 升级链（含 Assets 三列补丁与 Codocs v2 schema，不启用任何开关），hzy_migrator 临时解锁使用 B5 起已解锁的 hzy_migrator，不在本步重锁（重锁时点见 §21.3）。`**耗时**：约 2 分钟。

### B7 K2 计划（H0）
- **主机**：新机，`hzy_cutover`。**命令**：`hzy-enterprise-migrate --profile P --plan source.json`。**判据**：`blocking_conflicts=0`，H0 与彩排结构一致；**发我与协调者确认 H0**。**回滚**：无写入。**批准**：只读，H0 确认。**耗时**：3 秒。

### B8 install-fence → fence → prepare-final（H1）
- **命令**：`hzy-enterprise-test-cutover --profile P --source-plan … --source-review-hash H0 --phase install-fence|fence|prepare-final --apply`，每步前加密备份两源副本。**判据**：两源 `enterprise_source_fence=fenced`；H1 与 H0 差异只含 fence 表与触发器（S3：153→155 表、+3×153 触发器）。**回滚**：恢复该步前备份并停。**批准**：`批准 B8：确认 H0=<…>，执行 install-fence/fence/prepare-final。` H1 另确认。**耗时**：约 30 秒。

### B9 K2 apply 与对账
- **命令**：`hzy-enterprise-migrate --profile P --plan final.json --apply --review-hash H1`。**判据**：逐表 COUNT 与 final plan 一致；registry `generation=0`；源仍 fenced。**回滚**：恢复备份、删除 `hzy_enterprise`（新机无生产写入）。**批准**：`批准 B9：确认 H1=<…>，执行 migrate --apply。`**耗时**：约 40 秒。

### B10 兼容视图
- **命令**：`hzy-enterprise-compatibility-rehearsal --profile P --binding-candidate … --migration-plan final.json`（plan → HV）→ 确认后 `--apply --review-hash HV`。**判据（P0-15 修订）**：视图集由映射派生（`internal/enterpriseviews`），不再是固定的 57 个：aims 域的 physical≠logical 映射项、assets 域同理，去掉 `SharedPhysicalNames`（integration_operation*、service_command_receipt、work_item_status_catalog、workflow_status_catalog），且 `system_parameters` 只归 assets（工具自动把 aims 域里的这一项从绑定中剪掉）。按生产候选映射，预期 **aims 109 + assets 33 = 142** 个视图（R3 用同一映射实测应相同）；altoc 在生产不启用，不装，`hzy-enterprise-add-altoc` 只在以后启用 altoc 时使用。输出行与 `--artifact` 里记录 `mapping_hash`；读检查通过，generation=0 时 Runtime 校验器拒绝。**Runtime 配置（B14）里 aims/assets 的 `tables` 必须取自该 artifact 的 `binding`（已剪枝），不得另写。****回滚**：恢复备份。**批准**：`批准 B10：确认 HV=<…>，安装兼容视图。`**耗时**：约 10–15 秒。

### B10b 最小 Runtime 就绪（P0-11，新增）
- **原因**：B11 的 Platform 签发要求 prod Runtime 实例 `status='ready'`（`enterpriseExternalDrainApproval.ts:23`），ready 只由心跳产生。
- **主机/账号**：新机 root。**前置**：B5 已恢复 `hzy_console`；B10 兼容视图已装但企业库仍是 generation 0（Runtime 校验器拒绝），故只启用 console/directory，不带 `hzy_enterprise`。
- **命令形状**：先把 T-n 的模板移开（`mv /etc/hzy-data-runtime/config.json /etc/hzy-data-runtime/config.template.json`），再由渲染脚本从受保护文件生成（口令来自 `/etc/hzy/mysql/hzy_rt_console.cnf`，bindings 来自 Runtime `.env` 的 `HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64`，**没有任何秘密经过 argv 或 shell 历史**）：`render-runtime-config.py --stage b10b --out /etc/hzy-data-runtime/config.json`（自带 `--check`，属主 `hzy-runtime` 0600）；内容只含 `apps.console` 与 `apps.directory`（库 `hzy_console`），其它 app 与 enterprise 块都关闭；保留 A7 写入的控制 token、Platform URL；`systemctl start hzy-data-runtime`。Runtime **启动后 5 秒发首次心跳**（`control_heartbeat.go`：`time.NewTimer(5*time.Second)`，之后每 5 分钟），若心跳带回新 bindings 或 Platform 签名公钥会写入并自动重启一次（再 5 秒后再发），所以就绪等待约 10–30 秒，不需要缩短间隔。
- **判据**（用新鲜度而非仅看 `ready`）：`tenant_runtime_heartbeats` 出现启动时间之后的新行（read-only 查询）；`tenant_runtime_instances.status='ready'` 且 `current_version='0.3.221'`；`/runtime/health` 200。停：进入 B12 前 `systemctl stop hzy-data-runtime`。**回滚**：停 Runtime、`mv config.template.json config.json` 还原模板。**批准**：并入 B10/B11：`批准 B10b：以最小配置启动并随后停止新机 Runtime，仅用于使 prod 实例经心跳转 ready。`**耗时**：2–3 分钟（R3 探针实测：启动约 5 秒即首次心跳）。

### B10c 窗口内 provider 库授权（P0-13，新增；B10 之后、B11 之前）
- **命令**：新机 MySQL root 执行 `deploy/self-hosted/cutover/a6/a6-supplement-window-grants.sql`（`hzy_cutover` 对 `hzy_console/codocs/finance/people` 的 SELECT + LOCK TABLES）。执行前后各做一次 `SHOW GRANTS FOR hzy_cutover@localhost` 回读并存档。**判据**：回读恰好多出这四行，别的不变。
- **为何放这里**：只有 B12 的 drain verify/activate 用到（`external_drain_verifier.go:55` 的 `FOR SHARE`），B11 采集器只读 SELECT 不需要；放在 B10 之后能让暴露窗口最短，同时早于 B12 的首次使用。
- **撤销**：B12 完成后执行 `a6-supplement-window-revoke.sql` 并回读为 0 条。**回滚**：同一撤销脚本。**批准**：用户已批准该文件；执行前仍按窗口惯例在通知中列出。**耗时**：秒级。
- 永久项 `a6-supplement-showview.sql`（`hzy_rt_enterprise` 对 `hzy_enterprise` 的 SHOW VIEW）不属于窗口，随 A6 一并已在窗口前执行（见 §9 执行记录）。

### B10d 生产排空 HMAC 密钥：生成、分发、比对指纹（A12 第 3 步，新增；B10c 之后、B11 之前）
- **现状（A15 结束后）**：演练 HMAC 已在两端 `shred`，gitlab 主机 `/root/hzy-drain-cred/` 目录现已不存在（清理时连同空目录一起删除），Platform 的 `approveExternalDrain` 每次请求重读 `$CREDENTIALS_DIRECTORY/offline-drain-hmac`，所以外部排空认可处于**失败关闭**（`credential_unavailable`）。进程环境里的 `CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active` 是 A12 切换设置的，无需再重启 PM2。
- **步骤与耗时（约 6–8 分钟）**：
  1. **gitlab 主机建目录（1 分钟）**：`install -d -m 700 -o root /root/hzy-drain-cred /root/hzy-drain-cred/active`（实体目录，非符号链接；`readCredential` 要求文件与父目录归进程所有且无组/其他权限）。
  2. **新机生成（1 分钟）**：`umask 077; install -d -m 700 /root/.hzy-drain-cred/prod; openssl rand -out /root/.hzy-drain-cred/prod/offline-drain-hmac 32`（原始 32 字节，key ID 记为 `s4-…`）。
  3. **经用户本机管道分发（2 分钟，不落本机盘）**：`ssh root@100.64.72.59 'cat /root/.hzy-drain-cred/prod/offline-drain-hmac' | ssh root@gitlab.wiztek.cn 'install -m 600 -o root /dev/stdin /root/hzy-drain-cred/active/offline-drain-hmac.new && mv -f /root/hzy-drain-cred/active/offline-drain-hmac.new /root/hzy-drain-cred/active/offline-drain-hmac'`。
  4. **两端比对指纹（1 分钟，不打印密钥）**：两端各算 `sha256("hzy-drain-key-fp:"+key)` 前 16 位并比对；同时回读文件长度=32、权限 0600、属主 root，`active/` 为 0700。指纹不一致或长度不对 → 立即两端 `shred -u` 并停止。
  5. **确认新机 seal CLI 用的目录**：`CREDENTIALS_DIRECTORY=/root/.hzy-drain-cred/prod`，B11 的 `seal-cli.mjs seal` 读它。
- **判据**：两端指纹一致；Platform 文件权限与属主符合；新机与 gitlab 主机以外没有副本（用户 Mac 上无落盘）。**回滚**：两端 `shred -u` 并回读文件不存在（Platform 即失败关闭）。**批准**：随 A12（已批准“在新机生成排空认可 HMAC 密钥，经用户本机管道分发到 Platform，仅比对指纹”）；窗口内执行前通知用户，属 B10d。

### B10e 渲染最终 Runtime 配置（P1-1，新增；B10d 之后、B11 之前，不启动）
- **原因**：B12 的 `verify-views --config` 需要带企业块的最终配置，而正式启动在 B14。B10b 用的是不带企业块的最小配置。
- **命令**：`mk-binding-candidate.py` 已在 B10 用过；此处 `render-runtime-config.py --stage final --binding <B10 的 views-applied.json> --out /etc/hzy-data-runtime/config.final.json`，随后 `--check /etc/hzy-data-runtime/config.final.json --stage final`。企业表映射取自 artifact 的**剪枝绑定**（aims 115、assets 37），`instanceId`/`generation` 取自 cutover profile，`aimsDeliveryWorker` 在 aims 调度为 unified 时写入。属主 `hzy-runtime` 0600；**B10b 的 Runtime 仍在运行时不覆盖 `config.json`**，`config.final.json` 只在 B14 才成为 `config.json`（见 B14 命令）。
- **B12 用法**：`verify-views` 要求配置文件属于进程用户，所以 B12 前 `install -m 600 -o root config.final.json /root/.hzy-s4/runtime-config.verify.json`，用毕 `shred -u` 并回读不存在。
- **回滚**：删除 `config.final.json`。**批准**：随 A5 配置范围（/etc 内新增一个未启用的文件，改前后 manifest 回读）。**耗时**：1 分钟。

### B11 排空证据、Platform 签发认可（P0-1）
- **主机/账号**：新机 CLI（`provider-report-cli.mjs collect` 在恢复副本上、`seal-cli.mjs seal`）；**Platform 会话（用户，方案 B）**：`ops.deployments` 审阅页导入 → 复核 → 签发 `enterprise-external-drain-approval.v1`。
- **前置**：B2 材料；冷存档四份人工材料；**生产 HMAC 密钥已在 B10d 生成并分发、两端指纹一致**；profile 钉活动 kid。
- **判据**：Platform 复核 M4 四项闭包、冷存档四份人工确认、profile kid/公钥指纹；签发一次，同键同请求回放原制品。**回滚**：作废认可（未激活前）；撤销 HMAC 密钥。**证据**：认可 JSON 哈希（不含密钥）、证据 SHA-256。
- **批准**：`批准 B11：用户以自己的 Platform 会话导入证据并签发 cutoverKey=<…> 的排空认可，仅用于本窗口；批准在新机采集 provider 回执与封存证据。`**耗时**：20–30 分钟（含人工复核）。

### B12 M3d 激活
- **命令**：`hzy-enterprise-drain --profile P --fence-plan source.json --final-plan final.json --approval approval.json`（只读核验）→ `--mode activate --apply --review-hash H1`；随后 `hzy-enterprise-verify-views --profile P --config <Runtime 配置> --install-artifact <B10 的 artifact>`（映射哈希必须与安装时一致，且已装视图集与派生集双向相等）。
- **判据**：验签、七项闭包、副本行指纹 PASS；registry `generation=1`；verify-views 全数通过。**回滚**：激活前失败→恢复备份；**激活后 registry 不可回退**（恢复路径为 `enterprise-recovery.v1`，仅限同实例）。**批准**：`批准 B12：确认认可哈希与 H1，执行 hzy-enterprise-drain 激活到 generation=1。`**耗时**：约 5 分钟（S3 未测，待 A15 实测）。

### B12b nginx 来源白名单直通（P0-A 用户已决定采用；B12 之后、B13 之前，仅一个 vhost）
- **决定**：用户 2026-09-30 同意“白名单直通”（协调会话称方案 1，本文原 P0-A 编号里的“方案 2”）。connector 改指、Keycloak 与企业微信登录、B18 的人工登录都经入口 `aidcp.wiztek.cn`，所以 B19 之前必须让少数来源能到达新机 Gateway；其余来源仍返回 503 维护页。
- **配置**：`deploy/self-hosted/cutover/b12b/aidcp.allowlist.conf.tmpl`（B12b 状态）与 `aidcp.open.conf`（B19 状态）。`geo $hzy_aidcp_allowed` 放在 vhost 文件顶部（vhost 目录在 `http{}` 内被 include），白名单为：`127.0.0.1`（本机探针）、`8.130.81.31`（gitlab 主机自身公网地址）、用户当时的公网出口 IP（模板里唯一的占位符 `@USER_LINES@` 行，每个地址一行 `<ip> 1;`）。**源地址已实测**：2026-09-30 在 gitlab 主机对 `https://aidcp.wiztek.cn` 发 GET，nginx 访问日志记录的来源是 `8.130.81.31`（DNS 解析到公网地址，不是 127.0.0.1），所以 connector 的出口就是 `8.130.81.31`。nginx 直接终结 TLS、前面没有 CDN/SLB，`$remote_addr` 即真实对端。非白名单在 `location /` 与 `location = /codocs/ws` 里 `return 503`，走原 `error_page 503 /index.html` 维护页；上游不可达时 `502/504` 同样落维护页。**头部纵深防御（协调会话要求）**：Gateway 本身先剥掉客户端的全部 `x-hzy-*`、`forwarded`、`x-forwarded-host/proto/port/prefix`、`x-real-ip`，tailnet 模式下还剥掉 `x-forwarded-for` 等客户端地址声明，再由 Worker 层 `stripInternalHeaders` 与 `buildForwardHeaders` 用配置/注册表的值重设（代码 `deploy/self-hosted/gateway/http-bridge.mjs:sanitizeClientHeaders`、`deploy/cloudflare/tenant-gateway/src/index.js:stripInternalHeaders/buildForwardHeaders`；测试 `gateway/test/forwarding.test.mjs`、`ingress-peers.test.mjs` 已含伪造头用例）。nginx 两处 location 另外显式清空已知可信上下文头并用真实对端覆盖 `X-Real-IP`/`X-Forwarded-For`。
- **用户 IP**：不固定，窗口里现场取——由用户告知，或在用户浏览器访问一个回显端点（在用户浏览器打开一个 IP 回显页面）获得；核对是公网 IPv4 且是用户自己的（`^[0-9]{1,3}(\.[0-9]{1,3}){3}$`），不接受网段。如用户走 IPv6，另加一行。
- **命令形状**（gitlab 主机 root，**只改 `/etc/nginx/vhost/aidcp.wiztek.cn.conf` 这一个文件**，reload 而非 restart；共享 nginx 是 `/usr/sbin/nginx` 主进程）：① 备份：`cp -p /etc/nginx/vhost/aidcp.wiztek.cn.conf /root/hzy-g9/b12b-<UTC>/aidcp.wiztek.cn.conf.pre` 并记 sha256，同时存 `nginx -T` 全量；② 把模板中 `@USER_LINES@` 换成白名单行，写为新文件（0600）；③ `nginx -t`（必须 ok；同时用 `diff` 确认只有该 vhost 变化）；④ `nginx -s reload`（不 restart），回读进程仍在、`nginx -T | grep -c hzy_aidcp_allowed` 为预期值；⑤ 回读判据：从白名单来源（gitlab 主机本机 `curl https://aidcp.wiztek.cn/console/.well-known/jwks.json`）返回 200，用户浏览器访问返回登录页或 Console 页面；从非白名单来源（如另一台机器的 `curl`）返回 **503 且正文是维护页**；同机其它 vhost（`hzy.wiztek.cn`、`sso.wiztek.cn`、`tpapi.wiztek.cn`）状态码与改前一致。本地行为测试：`b12b/test-aidcp-nginx.sh`（临时 nginx 于回环，覆盖拒绝、放行、开放、上游宕机四态），语法已在 gitlab 主机用 `nginx -t -c <临时配置>` 验证两份配置（不触碰运行中的 nginx）。
- **B19 移除**：把 vhost 换成 `aidcp.open.conf`（去掉 geo 与 `if`，全量反代），流程同上（备份 → `nginx -t` → reload → 回读：公网来源与白名单来源都到新系统）。**回滚**：B12b 回滚 = 还原改前备份的 vhost、`nginx -t`、reload，回读公网与白名单来源都回到 503；B19 回滚 = 换回 B12b 状态（若已撤销白名单则还原维护页 vhost）。
- **风险**：白名单里的用户 IP 一旦变化（换网络）会突然收到 503，此时让用户重新告知 IP，重复一次 reload；connector 用的 `8.130.81.31` 是 gitlab 主机自身，不需要更新。白名单期间新机 Gateway 仍只接受 `100.98.120.65`（nginx）的连接，直连仍被防火墙拒绝。
- **批准**：`批准 B12b：在 gitlab 主机 nginx 为 aidcp.wiztek.cn 增加来源白名单直通（白名单：8.130.81.31、127.0.0.1、<用户 IP>），nginx -t 后 reload，仅改该 vhost。`**耗时**：5 分钟。

### B13 Console 数据写入（M7a，不依赖运行中的 Runtime）：OIDC 回调、G-7
- **顺序说明**：OIDC 登录签发判据依赖回调已写入，故回调与 G-7 写入放在 Runtime 启动之前（B13），登录/Vault 判据放在 B14。
- **前置（connector 客户端，只读）**：apply 前后各读一次 `connector-runtime.C000001-console`（旧库 `service_clients.id=1043`）的授权，应为 9 行（8 active、1 revoked：未加前缀的旧 `connector_runtime:heartbeat`）、凭据 active v14，且前后逐行相同；G-7 plan 里不应出现该客户端的任何 `insert/bind/revoke`（§15.4）。
- **主机/账号**：新机（对恢复的 `hzy_console`）；`hzy_migrator` 或 G-7 工具账号。
- **命令形状**：先对 `hzy_console` 做加密备份（记 sha256）；OIDC 回调改由 B13c 的受审 SQL 写入（`auth_client_redirect_uris`，改前后清单入执行记录）；G-7：`g7-prod-grants.mjs --plan <config>` → 逐 ID 审阅 reviewHash → `--apply <config> <reviewHash> <receipt>` → `--verify`；`enterprise.runtime` 新增 20 项、`aims.runtime`/`workflow.runtime` 精确双 audience、**无 `collab.runtime`**（协作不随切换启用，B6 只装 schema）。
- **G-7 工具版本（P0-12，R3 发现）**：必须使用修复后的 `console/scripts/g7-prod-grants.mjs`（见 G7 文档“生产 seed v1.92 别名”）。生产 `aims.runtime` 的 `data-runtime:/tenant-runtime:aims:integration_operation`（seed v1.92）没有 `audience` 键且 `semanticScope` 带 audience 前缀，旧版 `--plan` 会以 `G7_SEMANTIC_CONFLICT` 拒绝，Aims 调度令牌也签发不出来；修复版只接受“与短形式完全相等”或“恰为本行自身 audience + `:` + 短形式”，其余仍冲突，别名行走 `bind` 改写为短形式并补租户/部署绑定，原值记录在计划、reviewHash 与回执中，回滚逐字还原。
- **B13b 服务凭据（定稿，用户批准方案 B；执行前需协调会话回复“可执行”）**：G-7 `--apply` 与 `--verify` 通过后，在新机对 `hzy_console` 执行：① 备份 `hzy_console`（加密，记 sha256；如同一窗口刚做过则复用并记时间）；② `node /root/.hzy-s4-rc2/…/b13-env-ref-credentials.mjs --config <db.json 0600，账号 hzy_migrator，用毕重锁> --pre-image /root/.hzy-a5/b13-pre.json --align-existing --plan`，核对：既有三行（aims/codocs/workflow）`aligned=false`、`backend=env_ref`，`enterprise.runtime` 存在且无凭据；③ 同命令 `--apply`（单事务：三行 `content_hash` 改为 `sha256_`+变量名哈希、`masked_preview=env-ref`，新增 enterprise 的 vault_secrets/版本/凭据行，回读按 `ConsumeServiceClientCredential` 联表核对四个 client 的链，全部通过才 COMMIT），输出应为 `B13 APPLIED`；④ 回读 `--plan`：三行 `aligned=true`，enterprise 有 1 个 secret、1 个凭据；⑤ 再核对 connector 客户端 9 行未变（见上）。**回滚**：`--rollback --align-existing --pre-image /root/.hzy-a5/b13-pre.json`（删除 enterprise 行，逐字还原三行哈希与预览，并校验），或恢复 `hzy_console` 备份。**用毕销毁**：`db.json`（含 `hzy_migrator` 口令，0600）与 pre-image 在 B13c 完成后 `shred -u` 并回读不存在（pre-image 只含哈希与预览，回滚需要时保留到 B20）；执行器只输出 `B13 APPLIED`，不打印连接串。四个变量的值已在 T-n 写入 Runtime `.env` 与各应用 env（指纹 enterprise `66f34ea29f0d`、codocs `5eb7aa5de4e2`、workflow `68f63ba1a967`、aims `5a6a712bb42e`），B13 不再涉及密钥值；Runtime 只在 B14 用最终配置启动，因此会读到这四个变量。
- **B13c OIDC 回调与登出 URI（P1-4，受审 SQL，改为从旧 canonical 行派生）**：G-7 apply（创建 `enterprise` 客户端）与 B13b 之后，`hzy_migrator` 对 `hzy_console` 执行 `deploy/self-hosted/cutover/b13/b13-oidc-redirect-uris.sql`（回滚 `…rollback.sql`）。**先 plan 后 apply**：`SET @apply=0; source …` 只读，逐行列出“旧 URI → 新 URI、basis”供审；`SET @apply=1; source …` 单事务写入。行来源：① `derived`（6 行）：console/aims/workflow 三个客户端在旧域 `https://wiztek.huizhi.yun/` 下 active 的行，域名替换为 `https://aidcp.wiztek.cn/`；旧 Console 在域名根，自托管 Console 在 `/console/` 下，所以 console 客户端另加 `/console` 前缀（`…/api/auth/oidc-callback` → `…/console/api/auth/oidc-callback`）；② `explicit`（4 行）：codocs 与 enterprise 在旧域下没有行（**2026-09-30 21:2x 实测修正**：生产 `wiztek.huizhi.yun` 下 active 行共 18 条 = 九个客户端 aims/altoc/assets/codocs/console/finance/people/webdev/workflow × 2，其中 console/aims/workflow 各 2 条；codocs 在旧域下**有**两行 `…/codocs/api/auth/oidc-callback|oidc-post-logout`，与下面的 explicit 值逐字相同，因此 explicit 值有旧行佐证），按路由布局写：codocs `/codocs/api/auth/oidc-callback|oidc-post-logout`（Foundation `server/api/auth/oidc-*.get.ts` 在应用 base path 下），enterprise 用构建时 `HZY_ENTERPRISE_OIDC_REDIRECT_URI=…/enterprise/api/auth/oidc-callback` 与 `HZY_ENTERPRISE_LOGOUT_REDIRECT_URI=…/enterprise/login`（`build.mjs`、`enterprise/nuxt.config.ts`）。共 **10 行**，`source='local'`。原因：Console 只在 `HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE=true` 时从策略包自动登记，安装的 env 为 false。守卫（任一不满足则一行不写）：五个客户端 active、derived 行数恰为 6、explicit 行数为 4、库内没有任何 `https://aidcp.wiztek.cn/%` URI。回读判据：`SELECT` 恰 10 行、五个客户端各 2 行、全部 `source='local' status='active'`；其它客户端不动。窗口内 plan 输出须与 T-1 的 plan 清单逐行一致。已在临时 MySQL（生产形态的旧行：三个旧域、含 inactive 干扰行）验证 plan 只读、10 行、console 前缀、漂移守卫、二次执行无副作用与精确回滚。哈希见 §21.4。
- **判据**：回调清单回读含且仅含预期的新域名条目；G-7 `--verify` 全 PASS；旧精确 scope 失败。**回滚**：G-7 `--rollback`（凭据未登记前）；恢复 `hzy_console` 备份。**证据**：回执、清单、reviewHash。
- **批准**：`批准 B13：在新机 hzy_console 执行 G-7 grant（plan/apply/verify，不含 collab.runtime）、B13b 的 env_ref 凭据行、B13c 的 OIDC 回调 SQL。`**耗时**：15 分钟。

### B14 Runtime 启动（M7b；令牌、JWKS、登录类判据移到 B17b）
- **主机**：新机。**前置**：B13/B13b/B13c 完成；A4/A7/A14 完成；B10e 已写好 `config.final.json`（不含占位）；`auth-jwt-trust.json` 新写（issuer `https://aidcp.wiztek.cn/console`，audience `data-runtime`）。gitlab 主机 connector 改指与 LDAP 目录连接器的处理不在 B14（见 B17b 与 §21.2 的两项待决）。
- **命令**：停 B10b 的 Runtime → 备份 `config.json` 为 `config.b10b.json`（0600）→ `mv config.final.json config.json`（同目录原子重命名）→ 启动探测（带齐 unit 环境，日志到 `listening 127.0.0.1:31080`）→ `systemctl start hzy-data-runtime` → `/runtime/health`、`/runtime/schema/status`（后者需服务令牌，放 B17b）；Platform 心跳（W9 已注册）。service client 凭据已在 T-n 预置、B13b 登记；GitLab 凭据（`gitlab.default`）随 `hzy_console` 恢复，已在旧库 Vault 内且 R3 已解析成功（§12 判据），**B14 不再录入 GitLab 凭据**；如需轮换 token，B17 后走 Console UI，另批。
- **判据（只含 Runtime 自身可验证的项）**：`/runtime/health` 200 且 `status=ok`、`apps.console.vaultKeyConfigured=true`、各启用适配器 `db=ok`；一次 Vault 只读解析探测（§13.7 的离线解密程序对恢复后的 `hzy_console`，只输出计数，期望 aes256-gcm 行 19/19 解密成功）；Platform 心跳新鲜（启动后新行）；`enterprise_schema_registry.generation=1`。**回滚**：停 Runtime，还原 `config.b10b.json`；凭据登记后按 C2 外部写入回退表逐项撤销。**证据**：health 输出（无 token）、解密计数、心跳时间。
- **批准**：`批准 B14：启动新机 Runtime 并绑定 hzy_enterprise/正式库，完成 Vault 只读解析探测。`**耗时**：10–15 分钟。

### B15 W10 Aims 调度登记
- **主机**：Platform（用户会话，方案 B）。**命令**：`POST /api/platform/ops/deployments/scheduler-ownership`（`storage=unified, environment=prod, runtimeCode=c000001-prod-tenant-runtime, workerDeployment=C000001-aims, workerClient=aims.runtime, generation=1, expectedRevision=0`）。**前置**：B13 后实例 `ready`；prod 下恰有 1 个 active `aims`。**判据**：新行与 receipt；test 那行不变。**回滚**：同接口 `storage=disabled`。**批准**：`批准 B15：（W10）`。**耗时**：5 分钟。

### B16 W11 prod 策略包
- **主机**：Platform（用户会话）。**命令**：`POST /api/platform/ops/tenants/C000001/bundles {"environment":"prod"}`。**前置**：孤儿门禁 0（已核）；W6 active 部署；权益有效。**判据**：kid=活动 kid，目标=active prod 部署集合，homeUrl/回调为 aidcp，payload 无 74 对资源，test 包不变；Console 拉取并验证策略信封。**回滚**：置 revoked/删除 prod 包。**批准**：`批准 B16：（W11）`。**耗时**：5–10 分钟。

### B17 启动服务与冒烟
- **顺序**：MySQL → Runtime → Console → Workflow → Aims（scheduler-only：A3 构建时 `HZY_AIMS_SCHEDULER_ONLY=true` 已编入 Nuxt 配置，`aims.env` 中 `HZY_AIMS_SCHEDULER_ONLY=true` 与 `NUXT_HZY_SCHEDULER_ONLY=true` 是运行时开关）→ Codocs → Enterprise → Gateway（`release.mjs` 的既定顺序）；`health.mjs` 逐个。**判据**：本机健康全通过；日志无 `insufficient_scope`/`console_service_token_grant_inactive`。**回滚**：按序停止。**批准**：`批准 B17：按序启动新机全部服务（仍不开放入口）。`**耗时**：15 分钟。

### B17b Console 就绪判据（P0-B，新增；B17 之后、B18 之前）
- **原因**：服务令牌由 Console 签发、JWKS 由 Console 提供、OIDC 登录经 Console，Console 在 B17 才启动，所以这些判据不能放在 B14。
- **判据（维护页期间，全部走本机回环）**：① `deploy/self-hosted/cutover/smoke/s4-smoke.mjs --mode maintenance ...`：服务健康、Runtime health、各应用向 Console 取令牌/读运行配置无失败日志、Codocs introspection、JWKS kid 集合与旧 Console 一致（预检 10-01 抓取的 `expected-kids.txt`）、登录配置（企业微信显示、钉钉关闭）、钉钉路径 503、维护页 503；② `probe-prod-service-tokens.mjs`（`tokenEndpoint=http://127.0.0.1:31001/console/oauth/token`，R3 口径 34 项，含 `notifications-due` 403 与反例）；③ `verify-views` 复跑；④ Runtime `/runtime/schema/status?app=…` 按应用逐个（用 ② 取得的 `<app>.schema.read` 令牌，不落盘）；⑤ 与入口有关的项（Keycloak 登录正例、企业微信扫码登录正反例、connector 改指与心跳）**在本步执行**：P0-A 用户已决定采用 B12b 白名单直通，用户从白名单 IP 的浏览器登录，connector 经 `8.130.81.31` 访问。
- **connector 改指与启动**（位置：B17b，依赖 B12b 白名单；原属 B14）：
  - B1 起 `hzy-connector-runtime` 与其 update timer 一直是停止的。新 Runtime 与新 Console 就绪后，在 gitlab 主机 root 下：① 备份 `/opt/hzy/connector-runtime/.env` 为 `.env.pre-s4`（0600，记 sha256）；② 只改 5 项（`HZY_CONSOLE_API_URL`、`HZY_CONSOLE_TOKEN_URL`、`HZY_CONNECTOR_RUNTIME_JWT_ISSUER`、`HZY_CONNECTOR_RUNTIME_JWKS_URL`、`HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL`，值见 §15.4），其余不动，回读 diff 恰为这 5 行；③ `systemctl start hzy-connector-runtime.service`；④ 回读并确认心跳后再启动 update timer：服务 active，`/runtime/health` 返回 ok，新 `hzy_console.connector_runtime_instances.last_heartbeat_at` 在 2 分钟内刷新（连接器每 60 秒心跳一次），且旧库不再有新心跳；⑤ 企业微信/钉钉登录冒烟见 B18。**回滚**：`systemctl stop` 服务，`.env.pre-s4` 还原并核对 sha256，再按 C2 决定启动旧目标。
  - **update timer（用户已决定：切换后保持启用，2026-09-30）**：B1 仍须把 timer 与服务一起停掉（停写需要）；B14 改完 env、启动服务并确认心跳后，再 `systemctl start hzy-connector-runtime-update.timer`，回读 **active 且 enabled**（B1 只 stop，不 disable，故 enabled 状态保持）。**风险（用户已知悉并接受）**：connector 会自动从 `downloads.huizhi.yun` 的 latest 更新；今后若把测试版本发布到 latest，生产 connector（企业微信与钉钉登录链路）会跟着更新，发布 connector 测试版本前必须注意这一点。
- **回滚**：按序停止 B17b 新增的项；connector 按上面回滚项。

### B18 冒烟与故障注入（入口仍为维护页）
- 从白名单来源（gitlab 主机）经 Gateway 验证：登录、JWKS kid、项目详情、工作项、审批发起→回调→状态落定、驳回、通知/待办各一次、Codocs 读写与共享、Assets 页面、调度空队列探测；无公网回落抓包（G-8）；Runtime/Console/Workflow 各重启一次恢复；写请求丢响应后同键重放不重复。
- **生产数据写入约定（P2-3）**：B18 会向正式库与共享 OSS 桶 `wiz-rs` 写测试数据；一律使用前缀 `CLAUDE-FIXTURE-S4-`（项目名、审批标题、文档标题、OSS 对象键），并在执行记录列出创建的对象 ID/键；C3 清理时逐个删除（OSS 对象只删带该前缀的键）。
- **登录/登出回调人工项（B13c 审定）**：分别从 Enterprise 与 Console 登录再登出，确认回调与登出都回到 aidcp 对应路径（`/console/api/auth/...`、`/enterprise/...`），不出现 `/api/auth/...` 的 302 循环。
- **判据**：全部通过；C9 是回退与前进的硬门禁。**回滚**：停新服务→按 §5 回退；回滚时同样清理带前缀的测试数据。**批准**：只读+测试数据写入随 B17。**耗时**：30–45 分钟。

### B19 M8 开放入口
- **主机**：gitlab 主机 nginx。**前置**：B18 全绿；用户 Go；二次回读“旧入口仍禁用、日本 Runtime 仍停”。**命令**：vhost 由 B12b 的白名单状态换成 `aidcp.open.conf`（去掉来源白名单、全量反代 `100.64.72.59:8780`；`nginx -t` 后 reload，改前备份，只改该 vhost）；不调用任何 JS coordinator `/release`。**判据**：`https://aidcp.wiztek.cn` 正常登录；员工验收清单（项目经理、成员、审批人、无权账号四岗位正/反例；撤权 ≤5 分钟生效）。**回滚**：换回 B12b 白名单 vhost（若需完全关闭再还原维护页 vhost），`nginx -t` 后 reload，回读非白名单来源 503。**批准**：`批准 B19：切换 aidcp.wiztek.cn 到新机 Gateway 并开放员工。`**耗时**：10 分钟。

### B20 收尾
- 删除会话 cookie 文件并回读；归档证据（回执、哈希、计时）；**销毁生产排空 HMAC 密钥**：两端 `shred -u` `/root/.hzy-drain-cred/prod/offline-drain-hmac`（新机）与 `/root/hzy-drain-cred/active/offline-drain-hmac`（gitlab 主机），回读两处文件都不存在（Platform 恢复失败关闭），目录保留为空的 0700 或按 C3 移除；`hzy_migrator` 重锁；写入执行记录。**耗时**：15 分钟。

## 5. T+：切换后

### C1 监控（72 小时）
- 每小时：新机服务健康、Runtime 心跳、磁盘/内存、`journalctl` 中 5xx/`insufficient_scope`；Platform 侧：prod 实例 `ready`、策略信封续期；每日加密备份成功且异地副本到位（gitlab 主机）；`vault_access_logs` 增量；Workflow abandoned/outbox 计数（破窗 Runbook）；每周先生成周报周期（Runbook §9b）。**回滚决策点**：T+1h、T+24h、T+72h 各一次 Go/继续。

### C2 回滚方案（2026-09-30 纸面演练后重写；场景：B18 失败，需要在 B19 之前回滚）
> 演练方法：把 B1–B18 的每一步产生的**外部写入**逐个列出，确认每条都有撤回命令、执行主机与账号、回读判据，且命令在现有工具/接口下**可以执行**。所有写操作仍须用户逐项批准；下表“执行者”里的 Mac 指用户本机经 SSH。
- **C10（M8）之前**（仅冒烟/标记数据），顺序：
  1. **入口保持维护页**：B19 之前 nginx 从未切换，`aidcp.wiztek.cn` 一直是 503；B12b 已让白名单来源直通新机，先撤销白名单直通：还原 B12b 改前备份的 vhost（即维护页 vhost），`nginx -t` 后 reload（只改该 vhost），回读公网 503 且白名单来源也回到 503。
  2. 停新机服务：`systemctl stop hzy-tenant-gateway hzy-enterprise hzy-codocs hzy-aims hzy-workflow hzy-console hzy-data-runtime`（回读全 inactive；`hzy-data-runtime` 与 `update-request.path` 保持 disabled）。
  3. 撤销窗口内的外部写入（新机数据保留为证据，但外部系统必须回到切换前状态）：

     | # | 外部写入（引入步骤） | 撤销命令 | 执行者与账号 | 回读判据 |
     | --- | --- | --- | --- | --- |
     | 1 | 旧入口 `wiztek.huizhi.yun` 已停用（B1） | 用户在 Cloudflare Workers Routes 删除 B1 新增的 `wiztek.huizhi.yun/*`（Worker=None）路由 | 用户，Cloudflare 控制台 | 旧入口 `wiztek.huizhi.yun` 返回 200/登录页 |
     | 2 | 日本机 Runtime、LDAP 目录连接器（`hzy-data-runtime-directory`，B1 停止；LDAP 连接器不迁移）、更新定时器已停（B1） | `systemctl start hzy-data-runtime hzy-data-runtime-directory hzy-data-runtime-update.timer hzy-data-runtime-update-request.path` | Mac→`root@oa.wiztek.cn`（写，逐项批准） | 四个单元 active；日本 Runtime `/runtime/health` 200；`SHOW PROCESSLIST` 见 Runtime 连接 |
     | 3 | gitlab 主机 connector 与 update timer 已停（B1）；B17b 之后已改指（`.env` 五项） | `systemctl stop hzy-connector-runtime`（若已启动）；若已改指则还原 `.env.pre-s4` 并核对 sha256；`systemctl start hzy-connector-runtime.service hzy-connector-runtime-update.timer` | Mac→`root@gitlab.wiztek.cn` | 两单元 active+enabled；`.env` 五项读回等于原值；日本库 `connector_runtime_instances.last_heartbeat_at` 恢复刷新 |
     | 4 | 生产排空 HMAC 密钥（B10d）；Platform 已用它验证并签发认可（B11） | 两端 `shred -u`：新机 `/root/.hzy-drain-cred/prod/offline-drain-hmac`、gitlab `/root/hzy-drain-cred/active/offline-drain-hmac` | Mac→新机 root、gitlab root | 两处文件不存在；Platform 恢复失败关闭（`credential_unavailable`） |
     | 5 | Platform 侧不可变记录：外部排空认可与证据库（B11） | **不可撤销**（唯一键含 cutoverKey）；重试必须换新 cutoverKey 与新窗口 | — | 记入执行记录；不影响旧系统 |
     | 6 | W10 调度归属（B15） | `POST /api/platform/ops/deployments/scheduler-ownership`：先 `mode=verify` 读当前 `expectedRevision`，再 `mode=attest`，`storage=disabled`，其余字段（`runtimeCode`、`workerDeployment`、`workerClient=aims.runtime`、`generation`）与登记时相同，附 `verificationReference/verificationSha256/verificationMethod=operator-attested` | 用户 Platform 会话（方案 B） | `mode=verify` 读回 `storage=disabled`、revision 递增；test 那行不变 |
     | 7 | W11 prod 策略包（B16） | **接口不存在**：Platform 没有“revoke bundle”API，`policy_bundles.status` 现有值只有 `active/superseded`，旧文“置 revoked”不可执行。处置：默认**不撤销**（旧系统使用 `huizhi.yun` 的 Platform、不读这个包；包有 `expires_at`，且需要 Runtime 存活才会被拉取）；若必须使其失效，用受审 SQL `UPDATE policy_bundles SET status='superseded' WHERE tenant_code='C000001' AND environment='prod' AND bundle_version=<B16 记录的版本>`（改前备份该行，回读 `GET /api/v1/policy/bundles/latest`）——**该 SQL 尚未起草，待用户决定是否需要** | 用户批准后 root@gitlab（Platform 库） | 若执行：latest 不再返回该版本；test 包不变 |
     | 8 | prod 实例 `ready` 与心跳（B10b/B14） | 不手工改 Platform 状态；新 Runtime 停止后实例会遗留 `ready`（既有已接受结论），重试窗口时 B10b 判据用“启动后新心跳行” | — | 记入执行记录 |
     | 9 | 新机 `hzy_cutover` 对 provider 库的窗口授权（B10c） | `a6-supplement-window-revoke.sql` | 新机 root（MySQL） | `SHOW GRANTS` 对四库为 0 条 |
     | 10 | B18 测试数据（B18）：正式库行 + OSS `wiz-rs` 中带 `CLAUDE-FIXTURE-S4-` 前缀的对象 | 按执行记录列出的 ID/键逐个删除 | 新机（库）；OSS 由持有该桶写权限的账号（需逐项批准） | 库内前缀记录 0 条；桶内前缀对象 0 个 |
     | 11 | Keycloak 客户端 `hzy_aidcp`（A11，已执行）、Platform prod 子域 `aidcp`（a7）与 prod `consoleLogin`（a7b，已执行） | **回到旧系统不需要撤销**（互不影响）；放弃本次切换时才按各自回滚：A11 的回滚步骤、`a7-…rollback.sql`、`a7b-…rollback.sql` | 用户/Platform 库 root | 各自回滚判据；plain 回滚不动 |
     | 12 | `hzy-platform-prod`（PM2 3010，连日本库）已删除 | 旧世界若确需它：从 `/root/hzy-g9/prod3010-removal-…` 备份恢复，**默认不恢复**（无进程连接、无转发） | 用户决定后 root@gitlab | — |
     | 13 | 新机库内写入：G-7、B13b、B13c、目录/凭据（B13） | 仅在新机库，不影响旧系统；保留为证据（需要时按各自回滚脚本） | — | 无需回读旧系统 |
     | 14 | 企业微信、钉钉后台 | **本次没有修改**（企业微信回调登记的是 Connector 域名；钉钉登录暂不启用） | — | 记“未改” |
  4. 用户重新启用旧 Cloudflare Gateway（表第 1 行）；日本机启动单元（第 2 行）。
  5. 回读：日本机四单元 active、Runtime `/runtime/health` 200；原入口冒烟（登录、项目详情、审批各一次）。无需数据回迁。
  6. `hzy_migrator` 复核仍为 locked（若尚未在 B13c 后重锁则立即重锁）；记录回滚执行时间线。
- **纸面演练发现的缺漏（已补入上表）**：① B10d 生产 HMAC 未列入撤回；② B10c 授权撤销未列入；③ “W11 置 revoked”在现有 schema/API 下不可执行；④ W10 回滚缺 `expectedRevision` 获取方法与 attest 字段；⑤ B18 会写生产库与共享 OSS，缺清理项；⑥ Keycloak、a7、a7b、`hzy-platform-prod` 未列；⑦ 入口白名单直通（B12b）缺撤回，现已并入第 1 步；⑧ 目录连接器一行含义不清，已由用户决定“LDAP 连接器不迁移”（§21.2）消解。
- **旧系统依赖哪个 Platform？** 旧日本系统依赖 **`https://huizhi.yun`**（Cloudflare 上的旧 Platform，加日本机 PM2 `hzy-platform-prod`/`hzy_platform` 库），**不是** `platform.wiztek.cn`；`hzy.wiztek.cn` 共享 Platform 与旧世界相互独立，回滚不影响旧 Runtime 的心跳与旧策略包。
- **M8 之后**：默认**修复前进**（先隐藏入口）。确需回退：冻结新库 → 加密全备 → 按 B5 恢复点导出增量 → `hzy_aims`/`hzy_assets`/Workflow 映射回旧结构 → 逐表 before/after 清单 → **另批**写回日本库 → 再启用旧 Gateway，同样须撤销上表外部写入。反向回迁工具**目前不存在**（K6），此路代价高。

### C3 清理（各项单独批准）
- 日本库：`DROP USER hzy_dump@'39.78.255.170'` 与 `hzy_dump_s4@localhost`；日本机 `authorized_keys` 回到原 4 行。新机：销毁 `s3r1_*`、`s3r2_*`、`s3r3_*`（含生产数据）与 `/root/.hzy-s3*`、`/root/.hzy-keys` 中不再需要的密钥；撤销 `m3e-grants*.sql` 授权；收紧 `hzy_migrator` 的 `hzy\_%` 通配为具体库；**轮换 `hzy_cutover` 口令**（S3 曾短暂出现在命令行）；旧生产 `hzy_platform` 归档副本处置（`hzy_platform` 与 P1 基线）；`S3-ONLY` 演练密钥与 profile 删除；窗口 HMAC 密钥撤销。

### C4 用户待办与后续项
- **LDAP 目录同步与自助改密（用户决定不迁移，2026-09-30）**：切换后停用，B1 停止日本机 `hzy-data-runtime-directory`，状态记入 C2 回滚表第 2 行。日后如需启用：在新机启用 `directory-connector` 单元并沿用原连接器身份（`directory-connector-private.pem` 与 `state-cache.json`，A14 同款用户本机管道；连接器 ID 不变，无需重新 enrollment），Runtime 配置 `apps.directory` 已启用、`.env` 设 `HZY_DIRECTORY_CONNECTOR_ENABLED=true`、`directory.env` 指向新机 Runtime 回环；`ldap.wiztek.cn:636` 已实测从新机 TCP 可达；`install.sh` 是否随包带 directory 单元需先在包内确认。启用是单独变更，另行批准。
- **W4 collab 应用注册与部署登记**、协作启用（快照桶实测、hzy0 双人验收、`collab.runtime` 注册与 grant、Runtime 开关，逐项批准）；**W7 权益续期**（订阅计划页完善后）；**待办 B**：企业微信登录与自动授予超级运维分离；`RSA` 备份私钥的口令加密离线副本；Finance/People/Webdev 整合计划；日本机旧系统下线；周报周期自动生成；`platform_signing_keys` 共用密钥的角色分离评估。

## 6. 停机时间估算（基于 S3 第二轮实测）

| 段 | 估时（脚本） | 说明 |
| --- | --- | --- |
| B1 停写 + B2 证据 | 25 分钟 | 含 ≥5 分钟冻结间隔与四类材料采集 |
| B3–B4 导出与拉取核验 | **约 9 分钟** | 导出 19 s，拉取约 7 分钟（DERP 约 72 KB/s，瓶颈）；直连可缩短到分钟内 |
| B5 恢复与核验 | 约 7 分钟 | 恢复 2 分钟 + 停写后逐表核对 |
| B6–B10 迁移/K2/视图 | 约 5 分钟脚本 + 人工确认 | 68 s + 30 s + 40 s + 10 s |
| B10b 最小 Runtime 就绪 | 2–3 分钟 | **新增（P0-11）**，待 R3 实测 |
| B10c provider 库授权 | 1 分钟 | 新增 |
| B10d 生产 HMAC 生成与分发 | 6–8 分钟 | 新增（A12 第 3 步） |
| B11–B12 排空认可与激活 | 25–35 分钟 | **未实测**（A15 实测替换）；含 Platform 人工复核 |
| B13 G-7 + B13b 凭据行 + B13c OIDC 回调（DB 级写入） | 15–20 分钟 | 原 B13/B14 顺序对调；B13b、B13c 各约 2 分钟 |
| B10e 渲染最终配置 | 1 分钟 | 新增 |
| B14 Runtime 启动（只含 Runtime 自身判据） | 10–15 分钟 | 令牌/JWKS/登录/connector 判据移到 B17b |
| B15–B16 W10/W11 | 10–15 分钟 | 需用户会话 |
| B17–B18 启动与冒烟（含 B17b Console 就绪判据） | 55–75 分钟 | B17b 约 10–15 分钟 |
| B19 开放入口 | 10 分钟 | |
| **合计** | **约 3.1–3.8 小时** | 建议预留 **4 小时**（含人工确认与意外）；比第一轮 M2 单导出 82 分钟大幅缩短 |

## 7. 全部待用户批准点

| 编号 | 对象 | 何时 |
| --- | --- | --- |
| A2 | 打正式 tag（只推 GitLab） | T-n |
| A3 | gitlab 主机构建 S4 制品并传新机 | T-n |
| A4 | Runtime 固定版本签名与本地安装 | T-n |
| A5 | 新机服务安装（不启动）、`/etc/hzy` 配置 | T-n |
| A6 | 新机 MySQL 授权（正式库名）与异地备份 | T-n |
| A7 | Runtime 安装与 W9 注册（租户管理员会话） | T-n |
| A9 | gitlab 主机 nginx `aidcp` 维护页与证书 | T-n |
| A12 | 排空认可 HMAC 密钥分离与生产 profile | T-n |
| A14 | Vault 主密钥经日本只读 SSH 传到新机 | T-n |
| A15 | R3 彩排与共享 Platform 演练签发 | T-n |
| A17 | Go/No-Go | T-1 |
| B1 | 用户停旧 Gateway；日本机停 Runtime/timer | T0 |
| B3 | 日本机临时账号/公钥/目录与导出 | T0 |
| B5 | 新机创建 9 个正式库并导入 | T0 |
| B6 | 升级链 SQL（含 Assets 补丁、Codocs v2 schema） | T0 |
| B7–B10 | H0 / H1 / apply / HV 确认 | T0 |
| B10b | 最小 Runtime 启动，使实例经心跳转 ready | T0 |
| B10c | hzy_cutover 对 provider 库临时授权（窗口后撤销） | T0 |
| B10d | 生产排空 HMAC 密钥生成、分发、指纹比对（B20 销毁） | T0 |
| B11 | 排空证据与 Platform 签发认可 | T0 |
| B12 | M3d 激活 generation=1 | T0 |
| B13 | G-7（DB 级写入）、B13b env_ref 凭据行、B13c OIDC 回调 SQL | T0 |
| B10e | 渲染最终 Runtime 配置（不启动） | T0 |
| B14 | Runtime 启动（正式库）、Vault 只读解析探测 | T0 |
| B15 / B16 | W10 调度登记 / W11 策略包 | T0 |
| B17 | 按序启动全部服务 | T0 |
| B12b | nginx 来源白名单直通（gitlab 主机，仅该 vhost，reload） | T0 |
| B17b | Console 就绪判据（令牌、JWKS、登录、connector 改指；依赖 B12b） | T0 |
| B19 | nginx 开放员工入口 | T0 |
| C3 | 各项清理 | T+ |

## 8. 未在本文验证的事实（须在对应步骤前只读确认）

已核实（2026-09-30 只读）：日本机 `ctr812`、`hzy-connector-runtime`、`hzy-notification-runtime` 为 inactive+disabled，仅 `hzy-data-runtime` 持有库连接；目录连接器是 `hzy-data-runtime-directory`；发布签名私钥在用户 Mac、公钥指纹三处一致；演练认可隔离结论见 A15。

仍待确认：目录连接器与 gitlab 主机 `hzy-connector-runtime` 的去留（A10）；`hzy-data-runtime enroll` 在最小配置下的行为；共享 Platform 上生产 HMAC 密钥的分发实现（A12，方向已获同意：一次性独立密钥、受保护文件、生产禁 env 回落）；`install.sh` 能否从本地包目录离线安装且关闭自动更新、新机 CPU 架构（A4）；新机到 LDAP 的连通性；Gateway/调度器在新机的注册（G-2）与 5 分钟 cron 语义；`aidcp-runtime.wiztek.cn` 回环拨号映射（G-10）的最终配置值；企业微信回调是否实际需要改动（A11）。

## 9. 执行记录

### 2026-09-29 A4 / b′：Runtime 0.3.221 打包、R2 stage、Platform 同步与批准
- **本地打包**：主 checkout，`HZY_DATA_RUNTIME_COMMIT=ce08d40e`，`package-release.sh 0.3.221`，产物在 `data-runtime/build/packages/hzy-data-runtime/0.3.221/`；`VERSION` 文件不改（仍 0.3.220）。manifest keyId `e1f7cfc0…bab82`；amd64 包 sha256 `4ce1f0df…2881`；release inventory `81cb7a1b…7ea6`。**0.3.221 已保留给自托管生产，不得从 worktree 运行 update_dr.sh。**
- **R2 stage**（用户授权，无 promote）：`upload-r2.sh 0.3.221 --stage --execute --confirm a999c192…afa3`（默认 `pnpm dlx wrangler@4.110.0`；用本机 wrangler 时摘要变为 `6862b2e6…`，脚本按设计拒绝，未写入）。回读：12/12 公开 URL sha256 与本地一致；`latest/version.txt` 仍 `0.3.220`。
- **Platform**（用户运维会话 cookie，方案 B）：写前备份 `/root/hzy-g9/runtime-release-b/before-*.json`、`before-approve-*.json`（0600）。`POST /api/platform/ops/runtime-releases/sync {"version":"0.3.221"}` → 200，`platform_runtime_releases` 仅新增 id=3（`0.3.221`，available，keyId `e1f7cfc0…`），id1/id2 不变，通道与实例不变。`POST …/approve` → 200，`promotion`，previous `0.3.219-test.adr018-candidate.7`，`updatedInstances=1`。回读：stable 通道 `approved_release_id=3`；test 实例 desired `0.3.221`、current `0.3.292-test.c000001-b1b2.6`、status `ready`、last_error `runtime_version_incompatible`（软告警，批准前已存在）。
- **回退**：`approve {"version":"0.3.219-test.adr018-candidate.7","confirmRollback":true}`（id=2 仍 available），会把实例 desired 改回。
- **收尾**：cookie 文件已 `shred -u` 并回读不存在；请用户在浏览器登出。
- **附注（心跳）**：`tenant_runtime_heartbeats` 每 5 分钟一条，没有中断；先前看到的“8 小时空档”是 mysql2 读 datetime 时区解析造成的显示偏差，不是心跳故障。

### 2026-09-30 A3 构建与 A5 安装（新机）、A6 授权、hzy-platform-prod 停用
- **A3（位置偏差，用户批准）**：源码由 gitlab 主机隔离目录 `/wiztek/hzy-s4-build/` 用 git bundle 从 gitaly 只读导出 `self-hosted/s4-rc1`（tag→`ce08d40e69f1fa91432bff9772541a5466a1f155`，sha256 `1bc8e01e…5633`），经用户本机中转传到新机 `/home/hzy/build/`（校验一致）。新机新建 `hzy-build`（无登录 shell，C3 删除），`pnpm fetch --frozen-lockfile` 用 npmmirror（2 分 48 秒），`build.mjs --version s4-rc1 --apps console,enterprise,workflow,aims,codocs,gateway`（11 分 32 秒），产物 `/home/hzy/build/out`，`index.json` 记录 commit、node v24.18.0，六个包 sha256 均与文件一致（console `771f0d69…`、enterprise `964886f1…`、workflow `55d78a59…`、aims `93bac43b…`、codocs `04329bb9…`、gateway `0b609d72…`）。C3 清理占用：`/home/hzy/build` 源码 1.7G、`.local` 50M（store）、`out` 167M、`tmp` 24M、bundle 112M；gitlab 主机 `/wiztek/hzy-s4-build/` 117M。
- **A5（未启动任何服务）**：工具 `release.mjs/release-lib.mjs/verify.mjs/health.mjs/collab-probe.mjs` 装入 `/home/hzy/tools`（哈希在 `/root/.hzy-a5/tools.sha256`）。`release.mjs` 会 `systemctl restart`，故改用同一 `publishIndex`（无操作 restart/health）发布六个包到 `/home/hzy/apps/<app>/releases/s4-rc1`，随后把属主由 `hzy-build` 改为 root 并 `go-w`，`verify.mjs` 逐包通过；`current -> releases/s4-rc1`。systemd 单元 `hzy-{console,enterprise,workflow,aims,codocs}` 与 `hzy-tenant-gateway`（含 `release.conf` 覆盖）已安装，均 disabled/inactive；`systemd-analyze verify` 仅提示缺 `hzy-data-runtime.service`（A4 安装后出现）。`hzy-data-runtime` 的 `g4-config.conf` 覆盖待 A4 后安装。
- **A5 配置**：`/etc/hzy/{console,enterprise,workflow,aims,codocs,gateway}.env`（0600 root）与 `/etc/hzy-gateway/gateway.json`（0600 hzy-gateway）已写。已填：租户 `C000001`、部署编码（`C000001-console/-prod-enterprise/-workflow/-aims/-codocs`）、Runtime 端点 `https://aidcp-runtime.wiztek.cn`、runtime 部署 `c000001-prod-tenant-runtime`、Platform kid `psk_20260718_AElQdK3VQSja` 与公钥、五个回环 origin；共享 Gateway 内部 token 在新机随机生成，五个 env 与 gateway.json 一致，未打印（指纹前 16 位在 `/root/.hzy-a5/gateway-token.sha256`）。用 `parseSelfHostedTopology` 对五个 env 校验通过。**仍为 `REPLACE_*` 的窗口内材料**（清单 `/root/.hzy-a5/env-pending.json`）：Console 上游 OIDC 六项、`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`/`NUXT_PLATFORM_PLATFORM_SERVICE_TOKEN`；各应用 service client secret（enterprise 1、workflow 2、aims 2、codocs 2）；gateway.json 的 `platformRegistryToken`；`/etc/hzy/console-service-key.pem` 尚未生成。
- **A6**：`a6-prod-grants.sql`（sha256 `3201b2fb…998b`）已在新机执行，回读新增 4 条 schema 级授权，无全局权限；备份 `/root/.hzy-a6/grants-{before,after}.txt`。
- **hzy-platform-prod（gitlab 主机 PM2，端口 3010，连日本库）**：用户批准“没用则删除”；nginx 无转发、10 分钟采样 0 条 TCP 连接、`.output` 无定时任务，故已 `pm2 delete` 并从 `dump.pm2` 摘除该条（其余条目逐项不变），备份在 `/root/hzy-g9/prod3010-removal-20260929T201321Z/`；hzy.wiztek.cn health 200，3010 不再监听。`/wiztek/huizhi-yun/platform` 保留待 C3；日本库与其账号未触碰。

### 2026-09-30 A4 安装与 A14 Vault 主密钥
- **A4 安装（新机，离线）**：包与签名（amd64 tar.gz、.sha256、.sig，install.sh(.sig)、manifest、release.sha256、version.txt）scp 到新机 `/home/hzy-backup/runtime-release/0.3.221/`；包 sha256 `4ce1f0df…2881` 与本地一致；公钥取自 hzy.wiztek.cn Platform 配置，新机上 DER sha256 = `e1f7cfc0…bab82` 后才写入 `/etc/hzy/release-signing-public.pem`；包与 install.sh 的 Ed25519 签名均验过。命令：`install.sh --base-url file:///home/hzy-backup/runtime-release --version 0.3.221 --release-public-key /etc/hzy/release-signing-public.pem --user hzy-runtime --no-auto-update --no-start`，环境 `AUTH_MODE=jwt`、监听 `127.0.0.1:31080`、tenant `C000001`、deployment `c000001-prod-tenant-runtime`，全部 `*_AGENT_ENABLED=false`（安装器要求 `--check-db`，第一次以默认 finance agent 失败，未写配置；第二次通过）。结果：`hzy-data-runtime 0.3.221 (ce08d40e6)`，运行用户 `hzy-runtime`（组 `hzy`），无 update timer（`state: disabled`）。**偏差**：安装器自动 enable 了 `hzy-data-runtime.service` 与 `hzy-data-runtime-update-request.path`，已改为 disabled/inactive（B17 再启用，API 触发更新路径是否保留另定）。`g4-config.conf` 覆盖与 `/etc/hzy/runtime.env` 已装。`/etc/hzy-data-runtime/.env` 中的 DB 用户 `cf_app`（空口令）是安装占位，不会用于运行，B14 用 `config.json` 取代。
- **A14**：经用户本机管道 `ssh root@oa.wiztek.cn 'cat …' | ssh root@100.64.72.59 'install -m 600 -o hzy-runtime -g hzy /dev/stdin /etc/hzy-data-runtime/console-vault-master-key'`，不落本机盘、不打印；两端按 `VaultMasterKeyFingerprint` 同算法（base64→前 32 字节→sha256 前 32 位）得 `sha256:3b1b0e37c78e516dd17853b1cb895687`，与 S3 记录的库内指纹一致；新机文件 0600 `hzy-runtime:hzy`，45 字节。

## 10. 窗口内材料来源表（`/root/.hzy-a5/env-pending.json`，仅列来源与路径，不含值）

| 材料 | 写入位置 | 来源 | 能否 T-n 提前 | 批准 / 步骤 |
| --- | --- | --- | --- | --- |
| Console 上游 OIDC 端点与 client id（`OIDC_ISSUER/AUTHORIZATION_ENDPOINT/TOKEN_ENDPOINT/JWKS_URI/CLIENT_ID` 与 `NUXT_AUTH_UPSTREAM_OIDC_*` 同名六项） | `/etc/hzy/console.env` | 上游 IdP 的公开元数据（discovery）。日本机 `/opt/huizhi-yun`、`/opt/hzy` 下没有旧 Console 的 env（旧 Console 跑在 Cloudflare，Worker secret 不可读取）；需用户指明是 SSO 还是企业微信及其 client | 可以（公开信息） | 用户提供 IdP 与 client；随 B13/B14 写入 env；A11 在 IdP 登记新回调 |
| Console 上游 OIDC client secret（`OIDC_CLIENT_SECRET` 与 `NUXT_AUTH_UPSTREAM_OIDC_CLIENT_SECRET`） | `/etc/hzy/console.env` | IdP 管理端（用户）；若沿用 hzy0/test Console 的同一 client，则取自 Mac 上测试 Console 环境，经用户本机管道；不打印 | 可以，前提是用户决定沿用或新建 client | 需用户批准来源；B14 写入，B17 启动前生效 |
| Console 的 Platform service token（`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、`NUXT_PLATFORM_PLATFORM_SERVICE_TOKEN`） | `/etc/hzy/console.env` | Platform 内部凭据 CSV 中给 Console 的一项（Platform 计划 §4）：新机随机生成，加入 hzy.wiztek.cn 的 PM2 环境；必须与 Gateway 项不同 | 可以，但要重启 hzy-platform-dev，**建议并入 A12 的同一次 PM2 切换** | 需扩大 A12 批准范围（追加两个 token 项的环境变量）；执行在 A12 |
| Gateway `platformRegistryToken` | `/etc/hzy-gateway/gateway.json` | 同上，Platform 内部凭据 CSV 的另一项；与 Console 项、Gateway 内部 token 三者互不相同 | 同上，并入 A12 | 同上 |
| Service client secret：`enterprise.runtime`、`workflow.runtime`、`aims.runtime`、`codocs.runtime`（enterprise 1 项、workflow 2、aims 2、codocs 2，其中同一 client 在 env 里重复两键） | `/etc/hzy/{enterprise,workflow,aims,codocs}.env` | 恢复后的 `hzy_console` 中的正式凭据流程签发（先 G-7 grant，再签发，口令只显示一次） | **不能**：`hzy_console` 在 B5 才恢复，client 与 grant 依赖它 | B14；逐项批准；写入后 G-7 探测 |
| `/etc/hzy/console-service-key.pem` | 新机 `/etc/hzy/`（`hzy-console` 可读，0600） | 新机本地生成 Ed25519，公钥在 Console 策略同步时自动登记到 `console_service_keys`（Platform 计划 §4） | 可以（只生成，不登记） | 新机本地写入，纳入 A5 追加项；登记在 B17 |
| Runtime `config.json`、`auth-jwt-trust.json`、Platform 控制 token（`hzy_ctl_`） | `/etc/hzy-data-runtime/` | `config.json`、`auth-jwt-trust.json` 由 B14 写；控制 token 由 A7 `enroll` 取得，Runtime 自己落盘 | `enroll` 可提前（A7）；其余在窗口内 | A7、B14 |

### 2026-09-30 A9 nginx 维护页、A6b 异地备份、Console 服务密钥、上游 OIDC 结论
- **A9（gitlab 主机 nginx，仅维护页）**：写前备份 `/root/hzy-g9/a9-20260929T202822Z/`（`nginx -T` 全量、vhost 列表、各阶段配置）。新增 `/etc/nginx/vhost/aidcp.wiztek.cn.conf`：80 端口只处理 ACME 与跳转；`certbot certonly --webroot -w /var/www/certbot -d aidcp.wiztek.cn --key-type ecdsa`，沿用既有 certbot 账号（未新建账号；命令里带了 `-m` 邮箱，账号已存在故未注册），证书到期 2026-12-28，续期任务与其它站点相同；443 站点仅返回 503 维护页（`/var/www/aidcp-maintenance/index.html`），**不反代新机 8780**。最初写了 `listen 443 ssl http2`，重载时触发两条“protocol options redefined”告警并会改变共享 443 套接字的协议选项，已改为 `listen 443 ssl` 后无告警。回读：`https://aidcp.wiztek.cn` 外部返回 503 且为维护页，证书有效；`http` 301 到 https；hzy.wiztek.cn 200、`/api/health` 200、gitlab 302 不变。观察（非本次引入）：`hzy-test.wiztek.cn` 的证书已过期。未做：从非白名单来源直连新机 8780 的拒绝测试（8780 尚无监听）；（更正：新机 `hzy-tailnet` 区域 DROP，但已有 rich rule 只放行来源 `100.98.120.65/32` 的 tcp/8780 与 tcp/8782，runtime 与 permanent 均在；`8782` 属已存档的 Platform 专用入口，C3 删除。此前“未见放行规则”是我把输出截断了。）gitlab 主机 firewalld 未运行。
- **A6b（异地备份，gitlab 主机拉取）**：gitlab 主机新建 `/wiztek/hzy-s4-backup-inbox`（0700）、专用密钥 `/root/hzy-g9/s4-backup/pull_ed25519`、`pull.sh`（sha256 前 16 位 `77d01a3117e639fe`）与 `hzy-s4-backup-pull.{service,timer}`（每日 03:30，已 enable timer）。新机 `/root/.ssh/authorized_keys` 追加一行 `restrict,from="100.98.120.65",command="/root/.hzy-keys/serve-s4-backup.sh"`（写前备份 `/root/.hzy-a5/authorized_keys.before-a6b`）；`serve-s4-backup.sh` 只允许 `list` 与 `get <YYYYMMDDTHHMMSSZ>/(SHA256SUMS|hzy_*.sql.gz.enc)`。回读：手动拉取一次成功并通过 `SHA256SUMS`；任意命令、路径穿越、非白名单文件均退出 2。**注意**：备份加密口令 `/etc/hzy/backup/backup.pass` 只在新机，异地副本没有它无法解密，口令需另行由用户离线保管（C4）。
- **Console 服务密钥**：`/etc/hzy/console-service-key.pem`（Ed25519，0600 `hzy-console`，其它应用用户不可读）；公钥 DER sha256 前 32 位 `d0a3e74e7e4d822f9418055ca909b394`，未登记。
- **上游 OIDC 结论（只读）**：`s3r2_hzy_console.auth_identity_providers` 为 0 行，上游 OIDC 完全来自 Console 环境（`nuxt.config.ts` 的 `upstreamOidc`，`ssoOidcEnable` 需 enabled、clientId 与 issuer 同时存在），**env 必需**。生产登录方式：`sso_oidc` 成功 659 次（2026-05-22 起至 2026-09-29，为主）、企业微信 45、钉钉 13，早期 CAS 83（至 05-22）。上游 IdP 为 Keycloak `https://sso.wiztek.cn/realms/wiztek`（gitlab 主机，docker `keycloak`，127.0.0.1:18080），Console 客户端 `hzy_wiztek_cn`（机密客户端）现有重定向 `https://wiztek.huizhi.yun/api/auth/oidc-callback` 与兼容项 `https://hzy.wiztek.cn/api/auth/oidc-callback`，**没有** `https://aidcp.wiztek.cn/console/api/auth/oidc-callback`。公开元数据已核：issuer、`…/protocol/openid-connect/{auth,token,certs,userinfo,logout}`。缺：客户端 secret 与在 Keycloak 登记新回调（外部写入，需要 Keycloak 管理员，属 A11）。决定项：沿用 `hzy_wiztek_cn` 加回调，或新建仅用于 aidcp 的客户端（回滚更干净）。

## 11. T-n 补充步骤（2026-09-30）

### A7 注册码的经手方式（不经过聊天）
- 新机已备好 `/root/.hzy-a7/set-enroll-command.sh`（用户操作）与 `run-enroll.sh`（助手执行）。
- **用户**：①在 Platform 页面（租户管理员，`C000001`，环境 `prod`）生成 Runtime install-command（需租户已配置 gateway 子域，否则接口返回 409）；②在自己的终端运行 `ssh -t root@100.64.72.59 /root/.hzy-a7/set-enroll-command.sh`，粘贴整段命令，再在空行按 Ctrl-D；输入不回显。脚本只在 runtimeCode=`c000001-prod-tenant-runtime`、tenant=`C000001`、Platform=`https://hzy.wiztek.cn`、release key id 与 bindings 均符合预期时才以 0600 存为 `/root/.hzy-a7/install-command.txt`，并只打印 runtimeCode、tenant、启用的 app 摘要、存入时间，不打印注册码；③告诉助手“已存好”。注册码单次有效，约 15 分钟内使用。
- **助手**：`run-enroll.sh` 从存好的命令里取出必要变量，**覆盖**为：Directory Connector 关闭（生产连接器继续用 gitlab 主机，不在新机启用，也不消费命令里的 connector enrollment token）、Console runtime 关闭、全部应用 agent 关闭、`--no-start`、用本地离线 0.3.221 包，重跑 `install.sh` 走“已有 .env”分支兑换注册码并同步 `HZY_DATA_RUNTIME_CONTROL_TOKEN`、Platform 签名公钥、bindings 等；随后 `shred -u` 中间文件并回读；用完后 `shred -u /root/.hzy-a7/install-command.txt` 并回读。执行前备份 `/etc/hzy-data-runtime/.env`。
- 判据：`tenant_runtime_instances` 出现 `c000001-prod-tenant-runtime`（prod）、`desired_version=0.3.221`；test 实例与 `tenant_runtime_credentials` 快照不变；无 `runtime-token` 调用；Runtime 仍未启动（实例为 enrolled，B14 才 ready）。回滚：删除 prod 实例/enrollment 行（G-9 §10 W9）并恢复 `.env` 备份。

### A11 上游 OIDC：新建 aidcp 专用 Keycloak 客户端（待审，未执行）
- 用户决定：新建仅用于 aidcp 的机密客户端，`hzy_wiztek_cn` 与 realm 其它配置不动。
- 建议 clientId：`hzy_aidcp`；回调 `https://aidcp.wiztek.cn/console/api/auth/oidc-callback`；登出回调 `https://aidcp.wiztek.cn/console/api/auth/oidc-post-logout`（Console 缺省即 `<应用地址>/api/auth/oidc-post-logout`）。
- **认证方式（需明确批准）**：容器 `keycloak` 内 kcadm 的缓存会话已过期（“Session has expired”）。拟在容器内用容器自己的 `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` 环境变量执行 `kcadm.sh config credentials --server http://localhost:8080 --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"`（在容器 shell 内展开，不经过我、不打印）。这是使用 master realm 管理员凭据，需要用户点头；替代方案是用户自己登录 kcadm 后告诉我。
- 步骤：①只读：`kcadm.sh get clients -r wiztek -q clientId=hzy_wiztek_cn` 保存完整表示到 `/root/hzy-g9/a11/`（0600，**先删除 `secret` 字段**），同时导出 realm 全部 clients 表示（同样删除 secret）作为备份；核对 protocol mappers、default/optional client scopes、`attributes`（含 pkce、`post.logout.redirect.uris`、`use.refresh.tokens` 等）、`fullScopeAllowed`、`publicClient`、`clientAuthenticatorType`、subject（是否有 pairwise sub mapper）；②创建：以旧表示为模板，去掉 `id/secret/clientId/rootUrl/baseUrl/adminUrl/redirectUris/webOrigins` 与 `post.logout.redirect.uris`，写入新值后 `kcadm.sh create clients -r wiztek -f -`，再按旧客户端复制 default/optional scopes 与 protocol mappers；③secret：`kcadm.sh get clients/<newId>/client-secret` 的 value 经管道（gitlab→用户本机→新机，不落盘不打印）写入 `/etc/hzy/console.env` 的 `OIDC_CLIENT_SECRET` 与 `NUXT_AUTH_UPSTREAM_OIDC_CLIENT_SECRET`；同时填入 issuer/授权/令牌/JWKS 端点（`https://sso.wiztek.cn/realms/wiztek` 及 `…/protocol/openid-connect/{auth,token,certs}`）与 `hzy_aidcp`。
- 判据：新旧客户端表示逐项 diff 仅 `id/clientId/secret/rootUrl/baseUrl/adminUrl/redirectUris/webOrigins/post.logout.redirect.uris` 不同（因为没有 pairwise sub mapper，`sub` 由 realm 用户 id 决定，与客户端无关，旧用户关联不变，待①确认）；旧客户端表示与备份完全一致；`https://wiztek.huizhi.yun` 现有登录不变（只读检查 discovery 与旧客户端）；`console.env` 六项不再含 `REPLACE_`。回滚：`kcadm.sh delete clients/<newId> -r wiztek`，`console.env` 六项改回 `REPLACE_`。

### 新机防火墙 8780
- 已核（只读）：`hzy-tailnet`（DROP，接口 `tailscale0`）已有 rich rule `source 100.98.120.65/32 port 8780/tcp accept`，`--permanent` 与 runtime 一致。无需新增写入。前后回读判据：`firewall-cmd --zone=hzy-tailnet --list-rich-rules` 与 `--permanent --list-rich-rules` 均含该规则；B17 后从 gitlab 主机 `nc -vz 100.64.72.59 8780` 通、从其它 tailnet 节点（如 Mac）不通。8782 规则（已存档的 Platform 入口）C3 移除。

### A12 一次 PM2 切换（脚本已备，待通知与执行）
- 脚本 `deploy/self-hosted/cutover/a12/a12-platform-switch.cjs`（`prepare|switch|probe|rollback|persist`），沿用 W3 模式，构建与 cwd 不变，只改 `hzy-platform-dev` 的环境：①`CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active`（演练 HMAC 已放入该目录）；②在 `PLATFORM_INTERNAL_SERVICE_TOKENS` 后追加两项（Console、Gateway 的 token；`NUXT_SECURITY_INTERNAL_SERVICE_TOKENS` 保持原值，Platform 对两者取并集）。
- 密钥/令牌生成与分发（均在新机生成、经用户本机管道传输、只比指纹）：`/root/.hzy-drain-cred/rehearsal/offline-drain-hmac`（32 字节）→ gitlab `/root/hzy-drain-cred/active/offline-drain-hmac`（目录 0700、文件 0600）；Console token → 新机 `/etc/hzy/console.env` 的 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`/`NUXT_PLATFORM_PLATFORM_SERVICE_TOKEN` 与 gitlab `/root/hzy-g9/a12/tok-console`；Gateway token → `gateway.json` 的 `platformRegistryToken` 与 `/root/hzy-g9/a12/tok-gateway`。三者互不相同且不同于 Gateway 内部 token。
- `prepare` 断言 DB/端口/NODE_ENV、CREDENTIALS_DIRECTORY 未设、目录/文件权限与长度、令牌格式且互异，备份 dump.pm2，导出 rollback/candidate 配置；`switch` = `pm2 delete` → 用 candidate 启动 → health 200 → 回读进程环境（旧令牌条目指纹逐项不变、只新增两条、其它 PM2 pid 不变），任一失败自动回滚并停下，输出实测停机毫秒；`probe` = 用每个令牌 GET `/api/platform/internal/signing-keys/<活动 kid>`（只返回公钥）：旧令牌与两个新令牌均 200、伪造令牌 403、响应不含令牌；再等 test Runtime 的下一次心跳入库；`persist` 只在以上全部通过后改写 dump.pm2 的该条目。

### 2026-09-30 A12 PM2 切换与 A11 aidcp 客户端执行记录
- **A12**：材料在新机生成并经用户本机管道分发，两端指纹一致：Console token `dcb844e80663`、Gateway token `a3ea6c1f62d7`（sha256 前 12 位）、演练 HMAC `398b72cda53d`（32 字节，原始文件 sha256 前 12 位）。新机 `console.env` 两个 `REPLACE_PLATFORM_SERVICE_TOKEN` 与 `gateway.json` 的 `platformRegistryToken` 已填，写前备份在 `/root/.hzy-a12/`（`console.env.before`、`gateway.json.before`，含旧值，C3 shred）；新机上的两份 token 中间文件已 shred。gitlab 主机：`/root/hzy-drain-cred/active/`（0700）放 `offline-drain-hmac`；`a12-platform-switch.cjs prepare` → `switch` → `probe` → `persist`。`switch`：`pm2 delete` 到 health 200 **实测停机 1801 ms**；进程环境：`CREDENTIALS_DIRECTORY` 已设、`PLATFORM_INTERNAL_SERVICE_TOKENS` 旧条目指纹 `13c6402f3859` 不变并新增两条、`NUXT_SECURITY_INTERNAL_SERVICE_TOKENS` 未改、其它 PM2 pid 不变、`HZY_DRAIN_CONTROL_TOKEN` 仍在。`probe`：切换前旧 token 200、伪造 403；切换后旧 token 与两个新 token 均 200、伪造 403、响应不含 token。test Runtime 切换后的第一次心跳 20:42:28Z 入库，实例仍 ready。`persist` 后 dump.pm2 中该条目含新环境（3 个 token 条目），其余条目逐项不变；`/root/hzy-g9/a12/tok-console`、`tok-gateway` 与 `candidate.config.json` 已 shred 并回读不存在。保留至 C3：`rollback.config.json`、`protected-dump.pm2`（含旧环境，0600）、`switch-state.json`。
- **A11**：在 Keycloak 容器内用容器自己的 `KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` 登录 master（未打印）。备份（已剔除 secret）：`/root/hzy-g9/a11/{all-clients,hzy_wiztek_cn}.before.json`。旧客户端无客户端级 protocol mapper；默认/可选 scopes 内均无 pairwise mapper，故 `sub` 由 realm 用户决定，与客户端无关。以旧客户端为模板新建 `hzy_aidcp`（id `32cc0e6f-7520-421b-be4b-92cb42163656`）：仅 `id/clientId/name/rootUrl/baseUrl/adminUrl/redirectUris/webOrigins/post.logout.redirect.uris/client.secret.creation.time` 不同，回调只有 `https://aidcp.wiztek.cn/console/api/auth/oidc-callback`，登出回调 `…/console/api/auth/oidc-post-logout`；旧客户端及其它 8 个客户端与备份完全一致；`https://sso.wiztek.cn/realms/wiztek` discovery 200。secret 经 gitlab→本机→新机管道写入 `console.env`（两端指纹 `db19352863e9`，长度 32，未打印）；`console.env` 的 12 个上游 OIDC 键（六项×两套）已填齐，文件中不再含 `REPLACE_`。回滚：`kcadm.sh delete clients/32cc0e6f-… -r wiztek`，并把 12 个键改回占位（备份 `/root/.hzy-a12/console.env.before-oidc`）。容器内 `~/.keycloak/kcadm.config` 已删除并回读确认（该文件原有，内容为已过期会话）。
- **A7 前置只读核对**：①**prod 环境没有配置 `tenantGateway.subdomain`**（`tenants.settings_json` 里只有 `deploymentEnvironments.test.tenantGateway.subdomain='wiztek'` 与 `test.dataRuntime`）。`install-command.post.ts` 对 prod 会直接返回 409（“tenant gateway subdomain is required”），因此在生成注册码前必须先给 prod 配置一个子域（Platform 租户设置写入，会决定命令里的 issuer/JWKS 主机 `https://<子域>.huizhi.yun`，该值在 run-enroll 中被丢弃，由 B14 的 `auth-jwt-trust.json` 取代）。②connector enrollment token 是无状态的签名 JSON（jti、tenant、console 部署、runtimeCode、15 分钟 TTL，`sign()` 生成），**不写库**，不消费就不留任何记录，也与 gitlab 主机连接器的 client `conn_5Dziq…` 无关。③但生成命令本身会写库：`tenant_runtime_instances` 新增 prod 行（`enrollment_issued`）、`tenant_runtime_instance_apps`（按 prod 活动部署：aims、assets、codocs、console、enterprise、workflow）与 `tenant_runtime_enrollments`（`issued`，TTL 15 分钟）；再次生成会把上一条 `issued` 注册码置 `revoked`。A7 后的清理/回滚：删除这些 prod 行（G-9 §10 W9）；用户必须选择环境 `prod`，否则会覆盖 test 实例的 desired_version 并作废其未用注册码。

### 2026-09-30 A7 子域核对：租户设置页写入会改写 prod 站点 URL（禁止用）
- 只读核对：`aidcp` 不在 `tenant_reserved_subdomains`（39 条 active 均无）、不在默认保留表、未设 `HZY_TENANT_RESERVED_SUBDOMAINS`；`assertSubdomainAvailable` 会比较所有站点 `deployment_sites.public_url` 主机与所有租户 `primary_domain`/各环境 `tenantGateway.subdomain`，当前无占用（C000001 test 为 `wiztek`，C000002 无）。C000001 唯一的 active owner 是 `u_Dc3QMq9PBa8pBXPU`（用户需以该账号进入 Platform 租户管理页，`install-command` 要求 `membership.isOwner`）。
- **风险**：`PATCH /api/platform/tenant-admin/deployment-settings`（租户设置页的保存）不只写子域：①对 prod 环境会同时改写 `settings_json` 顶层的 `tenantGateway/dataRuntime/platform/consoleLogin`，其中 `dataRuntime.defaultEndpoint`、`platform.baseUrl`、`consoleLogin` 取自请求体，留空即被清空；②`ensureDeploymentSite` 会 `UPDATE deployment_sites SET public_url=…`：现有 prod 站点 `id=4 C000001-main` 的 `public_url=https://aidcp.wiztek.cn` 会被改成 `https://aidcp.huizhi.yun`，从而破坏 W11 策略包的 homeUrl/回调与 tenant-gateway 解析。**因此不能让用户在设置页保存来配置子域。**
- 可行做法（需批准）：一条受审 SQL 只写 `settings_json.deploymentEnvironments.prod.tenantGateway.subdomain='aidcp'`（`JSON_SET`，写前备份 `tenants` 该行，事务，带守卫：该路径当前不存在），不动站点、不动 dataRuntime/platform/consoleLogin；写后回读 `install-command` 所用的 `tenantGatewaySettings(settings,'prod')` 得 `aidcp`、test 子域 `wiztek` 不变、`deployment_sites` 4 行逐字段不变。回滚：`JSON_REMOVE` 该路径或还原备份行。
- **执行（2026-09-30）**：`a7-prod-tenant-gateway-subdomain.sql`（sha256 `2f40c46b…12b9`）在 hzy_platform_dev 单事务执行，`affectedRows=1` 且 12 项回读全通过后提交：prod 合并子域=`aidcp`；prod 的 `dataRuntime/platform/consoleLogin` 合并结果与写前一致；test 合并结果与子域 `wiztek` 不变；顶层与 test scope 不变；prod scope 恰为 `{"tenantGateway":{"subdomain":"aidcp"}}`；`deployment_sites` 全表、各租户 `primary_domain`、其它租户逐字段不变。写前备份 `/root/hzy-g9/a7/tenants.before.json`（0600）；回滚 SQL `b3ad8c9b…d67f` 未使用。`run-enroll.sh` 在命令未带端点时补 `HZY_DATA_RUNTIME_PUBLIC_ENDPOINT=https://aidcp-runtime.wiztek.cn`，注册后回读 `tenant_runtime_instances.runtime_endpoint`。

### 2026-09-30 A7 注册执行记录
- 用户以 owner 账号在 Platform 生成 prod install-command，并经 `set-enroll-command.sh` 存入（不经过聊天）。`run-enroll.sh` 20:59:43Z 执行（注册码约 15 分钟有效，过期时间 21:13:25Z）：注册码已兑换。覆盖项生效：Directory Connector 关闭、Console runtime 关闭、全部应用 agent 关闭、`--no-start`、本地离线 0.3.221。安装器再次自动 enable 了 `hzy-data-runtime.service` 与 `hzy-data-runtime-update-request.path`，已改回 disabled/inactive。
- 回读（写前快照 `/root/hzy-g9/a7/pre-enroll.json`，写后 `post-enroll.json`）：新增 prod 实例 id=2 `c000001-prod-tenant-runtime`，状态 `enrolled`，`runtime_endpoint=https://aidcp-runtime.wiztek.cn`（由 run-enroll 补充），`desired_version=0.3.221`，控制 token 已发放（`ctl=1`，仅存哈希）；注册码 id=2 `redeemed`；`tenant_runtime_instance_apps` 7→13（新增 prod 绑定 6 行）。**test 实例稳定列不变**（ready、endpoint、desired、current、签名 key）；`tenant_runtime_credentials` 哈希 `57dd36d2cbf5ac01` 不变（未调用 `runtime-token`，无轮换）；`deployment_sites` 与 `deployments` 哈希不变。
- 新机：`/etc/hzy-data-runtime/.env` 同步了 `PLATFORM_URL`、`INSTANCE`、`PUBLIC_ENDPOINT`、控制 token、部署 bindings，`AUTH_MODE=jwt`，无启用的 agent，`DIRECTORY_CONNECTOR_ENABLED=false`；服务 disabled/inactive，31080 无监听；`install-command.txt` 已 shred，`enroll.env` 已不存在。写前备份 `/root/.hzy-a7/env.before-enroll`、`/etc/hzy-data-runtime/.env.bak.20260930045944`（C3 清理）。

## 12. A15 R3 彩排请示稿（待审；2026-09-30）

**新发现（P0-11，须先改主流程）**：Platform 签发排空认可时 `verifyRegisteredBinding` 要求 prod 的 Runtime 实例 `status='ready'`（`enterpriseExternalDrainApproval.ts:23`），而 ready 只由 Runtime 心跳产生（`agent-heartbeat.post.ts`：密钥指纹一致 + `databaseStatus='passed'` + 端点已登记）。主流程的 Runtime 在 B14 才启动，B11 签发时实例仍是 `enrolled` → 签发会以 `runtime_binding_invalid` 失败。修法：在 B10 与 B11 之间加 **B10b**：以最小配置（仅 console/directory 库 `hzy_console`，全部 agent 关，不带企业库）启动 Runtime，等一次心跳（5 分钟间隔，预计最长 5 分钟）使实例 ready，再签发；B12 激活前停 Runtime，B14 用最终配置启动。停机估算相应 +5–8 分钟，待本次演练实测。B17 前置回读加一条：`hzy-data-runtime-update-request.path` 必须 disabled（安装器会自动 enable）。

1. **写入清单（按主机）**
   - 日本机（只读导出）：沿用第二轮遗留的 `hzy_dump` 临时账号、受限公钥与导出管道（R3 前只读确认仍在；不新增账号）；只读，无回滚需求；账号与公钥清理仍在 C3。
   - 新机：①MySQL：为 `hzy_cutover`、`hzy_rt_*`、`hzy_migrator` 增加 `s3r3_*` 的 schema 级授权（现只有 `s3r1/s3r2` 与正式库名），可 `REVOKE`；②`s3r3_hzy_{console,workflow,codocs,aims,assets,altoc,finance,people,webdev,enterprise}` 库，可 `DROP`；③`/home/hzy/rehearsal/`（0700，配置、profile、日志、密钥副本）；④临时 systemd 单元 `hzy-r3-*`（`systemd-run`，落在 `/run`，不写 `/etc`）；⑤演练 HMAC 已在 `/root/.hzy-drain-cred/rehearsal/`。全部可逆，演练结束当日清理并出清单。
   - gitlab 主机：演练 HMAC 已在 `/root/hzy-drain-cred/active/`，无新写入；演练后 `shred`（无需重启 PM2）。
   - hzy.wiztek.cn（用户 Platform 会话）：导入证据并签发一次 `cutoverKey=s3r3-…` 的排空认可。**不可撤销的只有这条不可变审计记录**（唯一键含 cutoverKey，不会与正式 `s4-…` 冲突，认可不能激活 `hzy_enterprise`，见 A15 隔离结论）。
2. **在 s3r3 库上运行且不污染正式配置**：演练 Runtime 与各应用作为 `systemd-run` 瞬时单元运行，环境文件放 `/home/hzy/rehearsal/env/`（由 `/etc/hzy/*.env` 复制并覆盖：库名 `s3r3_*`、端口改为 `32001–32007/32080`、runtime 拨号指向 `127.0.0.1:32080`、服务 client secret 用演练库里 G-7 新签的值、Platform 相关开关关闭），Runtime 用独立 `HZY_DATA_RUNTIME_CONFIG_DIR=/home/hzy/rehearsal/runtime-config`，Vault 主密钥只读引用 `/etc/hzy-data-runtime/console-vault-master-key`（不复制、不修改）。**不启动** Gateway、不开 8780、nginx 仍是维护页。恢复与证明：演练前后对 `/etc/hzy`、`/etc/hzy-data-runtime`、`/etc/hzy-gateway`、`/etc/systemd/system/hzy-*` 生成 `sha256sum + stat(模式/属主/mtime)` 清单并 `diff`，必须为空；`systemctl` 单元状态、`ss -ltn` 端口前后一致；`/etc/hzy-data-runtime/.env` 逐字节不变。
3. **演练 Runtime 的身份（推荐方案）**：默认**不连 Platform**——演练环境文件不含 `CONTROL_TOKEN/PLATFORM_URL/INSTANCE`，不带心跳，Platform 上 prod 实例保持 `enrolled`，不会留下误导状态，也不会被 W10/W11 前置误判。M3d 的 Platform 签发部分改用 **test 环境身份**（`environment=test`、`runtimeDeployment=c000001-test-tenant-runtime`、test 部署编码、`cutoverKey=s3r3-…`）：test 实例本来就是 ready，认可里 `environment=test`，从设计上就不可能用于 prod；缺点是 prod 就绪门禁本身在演练中不被覆盖。**备选（保真度更高，需要额外批准）**：演练末尾单独做“B10b 就绪探针”——用 prod 实例的真实控制 token、最小配置启动一次 Runtime，观察实例转 ready 后停止，并用写前快照（`pre-enroll/post-enroll.json`）经受审 SQL 把实例恢复为 `enrolled`。**W10、W11 绝不在演练中执行。**
4. **要验完的项与判据**
   - Vault 解密：`/runtime/health` 报 `vaultKeyConfigured=true`，Vault 只读解析 `oss.default`/`gitlab.default` 成功，`vault_access_logs` 新增行，指纹 `3b1b0e37…`。
   - Console 签发与 OIDC：用演练库里 G-7 新签的 client 取令牌（`client_credentials`），JWT 由 Vault 解出的签名私钥签发，`/console/.well-known/jwks.json` 的 kid 集合与旧 Console 一致且能验签，`iss` 为 `https://aidcp.wiztek.cn/console`；`/console/api/auth/oidc-login` 返回 302 到 `sso.wiztek.cn/realms/wiztek`，`client_id=hzy_aidcp`，`redirect_uri` 为 aidcp 回调。**真实回调登录需要 aidcp 入口，nginx 现为维护页，只能留到 B18**。
   - Workflow：启动、库访问经 Runtime、健康 200、流程定义可读；**依赖 Platform 策略包的鉴权类流程（发起/审批/回调）留 B18**（W11 前无策略包）。
   - M3d 全链：`provider-report collect` → `seal` → Platform 导入复核并签发 → `hzy-enterprise-drain` 验证再 `--mode activate` → `hzy-enterprise-verify-views` 全通过；registry `generation=1`。
   - G-7：`--plan` → 逐 ID reviewHash → `--apply` → `--verify` → `--rollback` 演示 → 再 apply；`probe-prod-service-tokens.mjs` 用演练配置的全部组合 scope 签发探测，反例失败。
   - 计时：每段记入表（导出/拉取、恢复、迁移链、K2 plan/fence/apply/视图、M3d 各步、Runtime 启动、G-7、应用启动），用来替换停机估算。
5. **耗时、在场与中止**：预计 3.5–5 小时；用户只需在 M3d 的 Platform 步骤在场约 30 分钟（登录 Platform、导入证据、复核并签发），其余我独立执行；若做备选就绪探针再加约 15 分钟。**中止条件**：停写后逐表 COUNT 或流内 sha256 与基线有差异；任一步 verify FAIL；清单 diff 发现 `/etc` 被改；Platform 返回 5xx 或签发失败原因不明（不重试换参数）。**回滚**：停 `hzy-r3-*`、`DROP s3r3_*`、`REVOKE` s3r3 授权、`shred` 演练 HMAC 与 profile、清单 diff 为空、Platform 上仅留一条惰性审计记录。

### A15 请示稿补充（2026-09-30，按协调会话决定）
- **B10b 已并入主流程**（见 §4），停机估算 +2–3 分钟（Runtime 启动后 5 秒发首次心跳，之后每 5 分钟；无需缩短间隔），待 R3 实测。
- **就绪探针不手工改 Platform 状态。只读结论**：①Platform 没有任何“心跳超时 → offline/stale”的自动转换：`tenant_runtime_instances.status` 只被注册、心跳（`agent-heartbeat.post.ts`）和版本批准改写，无定时任务、无新鲜度阈值（仅“租户/应用列表页”对部署级 `last_heartbeat_at` 用 30 分钟阈值做展示，不是这张表）。②所有前置检查只看 `status='ready'`，不看心跳新鲜度：B11 签发（`enterpriseExternalDrainApproval`）、W10 调度登记（`tenantSchedulerOwnership`）、`enterpriseCutoverActivation`、网关密钥集登记（`gateway_keyset_runtime_not_ready`）、`tenant-gateway/resolve`（`runtimeReady`）。**结论：探针结束后 prod 实例会一直保持 `ready` 与探针时上报的应用 schema 状态，直到下一次真实心跳；遗留的 ready 会让上述前置检查在 Runtime 实际停止时也判为通过。**影响评估：Gateway 不启动（8780 未开、nginx 维护页）、W10/W11 不在演练中执行，因此不会有实际动作；但它会掩盖 T0 时“Runtime 没有真正起来”的失败。缓解（无需写 Platform）：B10b 的判据改为 `tenant_runtime_heartbeats` 中出现启动之后的新行（已写入 §4），且 B15（W10）前再读一次新鲜度。**需协调会话决定是否接受这一遗留状态。**
- **test 身份认可不会被 hzy0 消费**：认可只被两处读取：①Platform 的 `enterpriseCutoverActivation`，按 `(tenant, environment, cutover_key, seal_revision, seal_payload_sha256)` 精确查找，需要该 test 实例的控制 token 并带同一 `cutoverKey` 才会触发，且没有定时调用方；②同一审阅页的回放。hzy0 本机流程使用自己的 cutoverKey，不会碰到 `s3r3-…`。
- **日本机现状（只读核对）**：`/root/.ssh/authorized_keys` 是原 4 行（最后修改 2026-09-30 01:12，第二轮遗留的受限公钥此前已移除），R3 不使用 SSH；导出走新机用 `hzy_dump@39.78.255.170` 直连 Japan MySQL，该账号存在且可登录，授权仅 9 个业务库的 `SELECT, SHOW VIEW, TRIGGER` 加 `SHOW_ROUTINE`，无写权限；凭据文件 `/root/.hzy-s3/hzy_dump.my.cnf`（0600）。账号清理按协调会话决定延期到 C3（`DROP USER hzy_dump@'39.78.255.170'`）。
- **演练中未覆盖的项（写明）**：真实 OIDC 回调登录、依赖 Platform 策略包的鉴权类 Workflow 流程（发起/审批/回调）、经 Gateway 的 Host 路径，均留到 B18；演练只覆盖 OIDC 授权重定向参数、令牌签发与 JWKS。

## 13. A15 R3 彩排结果与权限矩阵（2026-09-30 新机时间；不含任何密钥值）

### 13.1 结论

- R3 在新机按 A15 授权范围完成，S3R3 全套 `s3r3_*` 库已清理。视图族修复（`e3a598eb`）重跑一次通过：**H1 与已签认可的 `finalReviewHash` `ddfbe330…9369` 逐字相同**；drain verify `externalEvidenceVerified:true`，activate `applied:true`（generation 1）；安装 **142** 个兼容视图，`verify-views --install-artifact` **142/142**，`mapping_hash=6c22db52…8786`；与 hzy0 按名字比对：R3 多出 0 个，hzy0 独有 14 个（altoc 13 个 + 遗留 `service_command_receipt`）。
- **更正**：本节此前写的“新机主密钥不是生产密钥”是错误的——那是把 S3 文档的旧结论（S3 时未拷贝）误当成现状。A14 已把日本机生产主密钥装到新机，指纹 `sha256:3b1b0e37c78e516dd17853b1cb895687`。P0-4 的解密证据见 13.7。
- 未覆盖（如实）：Console 令牌签发、OIDC 登录、Workflow 鉴权链路依赖 Platform 启动令牌与受信 Gateway，留到 B18；五个应用只验证进程启动与监听（Console 302/200、其余 302/404），对外部 URL 的依赖调用因入口尚未切换而失败，属预期。JWKS 公开 14 个密钥而库内 15 个，未公开的是 2026-07-18 已过 `not_after` 的一个已退役密钥，规则未追查，B18 与旧 JWKS 对照。
- 就绪探针：用 prod 控制 token 与最小配置启动一次后停止；prod 实例由 `enrolled` 转为 `ready`（`current_version=0.3.221`，首次心跳在启动后约 5 秒）。**遗留 `ready` 未手工恢复**（按约定不手工改 Platform 状态）；Runtime 与 `hzy-data-runtime-update-request.path` 均为 disabled，`/etc` manifest 与彩排前无差异。

### 13.2 实测计时（新机）

| 段 | 实测 |
| --- | --- |
| 恢复（整库还原） | 133 秒 |
| 迁移脚本 | 约 68 秒 |
| 工具构建（5 个，含 Go 缓存） | 13 秒 |
| plan / install-fence / fence / prepare-final | 2 / 5 / 6 / 9 秒（含每步加密备份 3–5 秒） |
| apply（155 表 / 6123 行） | 32 秒（+备份约 10 秒） |
| views-plan / views-apply | 1 / 6 秒（+备份约 5 秒） |
| drain verify / activate | <1 / 1 秒（+激活前三库加密备份约 10 秒） |
| verify-views | 3 秒 |
| Runtime（企业域开启）启动到监听 | 4 秒 |
| 五个应用启动到监听 | 12 秒 |
| B10b 探针：启动到首次心跳 | 约 5 秒 |

重跑从 plan 到 activate 共约 2 分 20 秒（含一次我自己造成的 apply 预检拒绝，见 13.4）。B11 的人工时间不在此表。

### 13.3 P0-11 至 P0-15 状态

| 编号 | 内容 | 状态 |
| --- | --- | --- |
| P0-11 | B11 前 prod 实例须 `ready`，只能靠 Runtime 心跳 | 已加 B10b；探针证实最小 Runtime 启动约 5 秒即转 `ready`。补充：最小配置**必须启用 console 与 directory 且库可连**；全部 app 关闭时启动失败（`create server failed: Error 1045 … cf_app`）；`/etc/hzy-data-runtime/config.json` 当前不存在，B10b 须先写好 |
| P0-12 | G-7 seed v1.92 的 `audience` 前缀 semanticScope | 已修（`bff43e72`），R3 探针 34/34 |
| P0-13 | `hzy_cutover` 对 provider 库缺 SELECT 与 LOCK TABLES | 已定位；生产补充见 13.5 与 B10c（`a6-supplement-window-grants.sql`，B10 后 B11 前执行，B12 后撤销）；R3 期间已授权并已撤销 |
| P0-14 | `hzy_rt_enterprise` 缺 SHOW VIEW | 已定位；永久授权，见 13.5 |
| P0-15 | 视图族与 Runtime 适配器名单不一致 | 已修（`eb9ed8ac`、`e3a598eb`），R3 重跑通过，无 binding identity 报错 |

### 13.4 本次偏差与教训

- 重跑时来源库已带 fence，`plan` 直接得到 155 表，H0 因此与第一次的 `4612d4e7…` 不同；H1 仍与已签认可相同，不影响结论。B7 的 H0 只在来源库未 fence 时才与本文一致。
- 目标库 `hzy_enterprise` 由 migrate 自己创建；预先建空库会使 apply 报 `existing target is not owned by this reviewed migration`。重跑或回滚只 `DROP`，不要重建。
- Runtime 配置里的企业表映射必须取自 artifact 的剪枝绑定（aims 115 项含 6 个共享表，assets 37 项），不得沿用候选的完整映射；`verify-views --config` 要求配置文件属主是进程用户。
- 应用 env 里的 `HZY_CONSOLE_*` 指向公开入口时，彩排中的应用会向真实 `aidcp.wiztek.cn` 发出请求（得到 302）；B14 前的演练应把这些 URL 改到回环。
- 遗留清理：s3r1、s3r2 的库与授权仍在新机（不在 A15 范围）；`/home/hzy-backup/s3/s3r3-…` 下的加密备份保留；`/home/hzy/build` 属 C3。

### 13.5 权限矩阵

「窗口临时」指窗口开始时授予、窗口结束撤销；「永久」指 Runtime 或备份常驻所需。依据均来自 `data-runtime/` 代码，R3 中实测验证的标 ✔。

| 账号 | 场景 | 库 | 权限 | 依据 | 性质 |
| --- | --- | --- | --- | --- | --- |
| `hzy_cutover` | K2 plan/fence/prepare-final/apply | `hzy_aims_src`、`hzy_assets_src`（来源副本） | SELECT, INSERT, UPDATE, CREATE, TRIGGER | 读源：`migrations/unified/migration.go`；fence 表与触发器：`fence.go:143-147`；`information_schema.TRIGGERS` 只对有 TRIGGER 权限的对象可见（`fence.go:207`、`migration.go:159`）✔ | 窗口临时 |
| `hzy_cutover` | K2 apply、视图安装、activate | `hzy_enterprise` | SELECT, INSERT, UPDATE, DELETE, CREATE, REFERENCES, INDEX, CREATE VIEW, SHOW VIEW, TRIGGER | 建库 `migration.go:420`（库级 CREATE）；外键 REFERENCES；视图 `domaininstall/install.go`、`compatibility_views.go:172`；触发器 `migration.go:355` ✔。**不含 ALTER/DROP**：回滚删库须 root | 窗口临时 |
| `hzy_cutover` | drain verify/activate（B12） | `hzy_console`、`hzy_codocs`、`hzy_finance`、`hzy_people`（以 profile 的 provider 清单为准） | SELECT, LOCK TABLES | `external_drain_verifier.go:55` 在激活事务内执行 `SELECT … FOR SHARE`；MySQL 要求 SELECT 外再有 UPDATE/DELETE/LOCK TABLES 之一，取最小的 LOCK TABLES ✔（此前仅 SELECT 报 1142） | **窗口临时（A6 补充）** |
| `hzy_cutover` | 全局 | — | 仅 USAGE | 无 FILE/PROCESS/SUPER 需求 ✔ | — |
| `hzy_rt_enterprise` | Runtime 运行 | `hzy_enterprise` | SELECT, INSERT, UPDATE, DELETE | 视图为 SQL SECURITY INVOKER，基表 DML 由调用者承担；`enterprise/transaction.go:72` 读 registry `FOR SHARE`（SELECT+UPDATE 已含）✔ | 永久 |
| `hzy_rt_enterprise` | Runtime 启动校验 / `verify-views` | `hzy_enterprise` | SHOW VIEW | `enterprise/compatibility_views.go:217` 读 `information_schema.VIEWS.VIEW_DEFINITION`，无 SHOW VIEW 时定义不可见而判不一致（R3：0/57 → 57/57）✔ | **永久（A6 补充）** |
| `hzy_rt_enterprise` | — | — | 不需要 CREATE/ALTER/DROP/CREATE VIEW/TRIGGER/EXECUTE | 运行期代码无 DDL、无 `CALL`（全库 grep 无存储过程调用） | — |
| `hzy_rt_console` | Runtime 运行、目录同步 | `hzy_console` | SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES | 临时表 `apps/directory/sync.go:29`；**就绪检查会拒绝多出的库级权限或任何全局权限**（`console/cutover_readiness.go:112-160`）✔ | 永久，不得增加 |
| `hzy_rt_workflow` | Runtime 运行 | `hzy_workflow` | SELECT, INSERT, UPDATE, DELETE | 无临时表、触发器、锁语句 ✔ | 永久 |
| `hzy_rt_codocs` | Runtime 运行 | `hzy_codocs` | SELECT, INSERT, UPDATE, DELETE | `codocs/document_snapshot_read.go`、`enterprise_department_document_collaboration.go` 的 `FOR SHARE/FOR UPDATE` 由 SELECT+UPDATE 覆盖 ✔ | 永久 |
| `hzy_backup` | 加密逻辑备份；B11 evidence 采集（只读 SELECT） | `hzy_%` | SELECT, SHOW VIEW, TRIGGER；全局 PROCESS、SHOW_ROUTINE | mysqldump `--triggers`、视图定义、例程；PROCESS 是否必要取决于是否带 `--no-tablespaces`，**待对备份脚本确认，能去则去** | 永久 |
| `hzy_migrator` | B5 恢复与迁移 | `hzy_%` | ALL | 账号默认 locked，仅在窗口内临时解锁，用后重锁（R3 期间已重锁 ✔） | 窗口临时 |

其它权限项结论：`FOR SHARE/FOR UPDATE` 不需要 `hzy_backup` 承担（采集器只读 SELECT）；`EXECUTE` 无运行期需求；`information_schema` 无需额外授权，但 TRIGGERS/VIEWS 的可见性取决于账号自己的 TRIGGER/SHOW VIEW 权限。生产 A6 补充 SQL 分两个文件：永久的 `a6-supplement-showview.sql` 与窗口临时的 `a6-supplement-window-grants.sql`，共两项：`hzy_cutover` 对 provider 库的 SELECT+LOCK TABLES（窗口临时，B12 后撤销）与 `hzy_rt_enterprise` 对 `hzy_enterprise` 的 SHOW VIEW（永久）；该 SQL 另行呈用户审批，本节不构成批准。

### 13.6 B11 用户亲自参与

B11 的 7 条人工判定与 4 项冷归档复核是**用户自己的业务判断**，必须由用户本人在 Platform 审阅页逐条复核并签字；我只准备和导入证据，不替代判断，也不预填结论。R3 中这些内容是合成的（已标注），不能视为对生产内容的判断。用户在场时间估计（未实测）：证据核对与 7 条判定约 20–30 分钟，4 项冷归档复核约 10–15 分钟，签署与确认约 5–10 分钟，合计 **35–55 分钟**；B11 签发窗口 15 分钟，须在 activate 之前完成。

### 13.7 Vault 主密钥核对与解密证据（P0-4，只读）

- 新机 `/etc/hzy-data-runtime/console-vault-master-key`：0600 `hzy-runtime:hzy`，45 字节；按 `VaultMasterKeyFingerprint` 同算法（base64 → 前 32 字节 → sha256 前 32 位）得 `sha256:3b1b0e37c78e516dd17853b1cb895687`，与 A14、S3 记录一致。
- 演练 Runtime 读的正是这个文件：转瞬单元的环境为 `HZY_CONSOLE_VAULT_MASTER_KEY_FILE=/etc/hzy-data-runtime/console-vault-master-key`，没有别的密钥来源。
- 库内 vault 行（`s3r2_hzy_console.vault_secret_versions`，55 行；scheme 为 aes256-gcm 19、external_ref 21、sha256-only 15）：aes256-gcm 的 19 行 `key_fingerprint` 全部为 `3b1b0e37…`，与文件指纹相同。
- **离线解密校验**（只读；临时 Go 程序按 `apps/console/vault_crypto.go` 的解密逻辑，root 套接字只做 SELECT，只输出计数，不输出明文，程序用后已删除）：`aes256-gcm versions=19 fingerprint_match=19 decrypted_ok=19 content_hash_match=19 active=9 active_decrypted=9`。即 19/19 解密成功，且解出内容的 sha256 与库内 `content_hash` 全部一致（含 9 个 active）。
- 边界：演练用的库是 S3 的恢复副本，`s3r3_*` 已清理；生产 `hzy_console` 在 B5 恢复后应在 B5/B17 用同一探测再做一次。external_ref 与 sha256-only 行不含密文，不属于解密范围。

### 13.8 彩排应用对外部地址的访问（只读核查）

- 五个应用的彩排 env 由 `/etc/hzy/<app>.env` 派生（`mkenv.py`），其中 `HZY_PLATFORM_*` 令牌类变量**只有 Console 的 env 有**（`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、`NUXT_PLATFORM_PLATFORM_SERVICE_TOKEN`）。派生时我把 Console 的 `HZY_PLATFORM_RUNTIME_ENABLED`、`HEARTBEAT_ENABLED`、`BUNDLE_REFRESH_ON_BOOT`（及 `NUXT_` 同名项）置为 false；Enterprise/Workflow/Aims/Codocs 的 env 只有 `HZY_PLATFORM_ENVIRONMENT` 与 `HZY_PLATFORM_URL`，没有 Platform 令牌。
- Platform 侧证据（`hzy.wiztek.cn` 的 nginx `platform.access.log`，2026-09-30 06:52–07:02 新机时区）：所有 Platform 请求来自 `142.163.116.83`（本机 test 租户，每分钟固定的 gateway-keyset、bundle、bootstrap-token 与 5 分钟心跳），以及 06:57:23 来自 `39.78.255.170` 的**一次** `POST /api/v1/runtime/agent-heartbeat`，即就绪探针的心跳（Platform 库中 prod 实例 `last_heartbeat_at` 与此吻合）。应用启动窗口 06:52–06:54 内没有任何来自新机出口的 Platform 请求。结论：**应用没有访问 Platform，也没有产生 Platform 写入；Platform 侧仅有探针心跳这一次由新机发起的写入。**
- 应用实际访问的外部地址：从应用日志可见 `https://aidcp.wiztek.cn/console`（运行配置读取、服务令牌请求；aims、codocs 各有 `Console service token request failed`，响应为 302 “Found”）。当前该入口由 gitlab 主机 nginx `vhost/aidcp.wiztek.cn.conf` 返回 503 维护页，不代理到任何后端。该 vhost 没有独立访问日志，主 `access.log` 在 06:52–06:55 也没有相应记录，**无法确认这些请求最终由谁应答、请求体是否被记录**。**所带凭据逐应用分类（只读核对 `/etc/hzy/<app>.env` 的值类别，不含值；应用日志已 shred，出站内容由 env 与 Foundation 代码推断）**：

| 应用 | 出站到 `aidcp.wiztek.cn/console` 的请求 | 所带凭据类别 |
| --- | --- | --- |
| enterprise、workflow | 仅启动时 `GET …/runtime/apps/<app>/config`（`consoleRuntime.ts`：启动时无入站事件，`tenantGatewayRequestHeaders` 返回 undefined，不附 gateway 头） | 无凭据 |
| aims、codocs | 上述 GET，加服务令牌 `POST …/oauth/token`（`serviceOidc.ts`） | client_id + client_secret，而 secret 在 env 里是 **`REPLACE_` 占位（类 a）**，不是真实凭据 |
| console | 未见对该地址的出站；`HZY_PLATFORM_RUNTIME_ENABLED/HEARTBEAT_ENABLED/BUNDLE_REFRESH_ON_BOOT` 已关，Platform 令牌与上游 OIDC secret 只在登录/Platform 同步路径使用，彩排未触发登录 | 无证据表明真实凭据被发出 |

真实凭据（类 c）在 env 中的存在情况：五个应用都有 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`（64 字符）；Console 另有 `HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、上游 OIDC `client_secret`、服务密钥文件路径。**没有证据表明它们被发往 `aidcp.wiztek.cn`**：gateway 头只在有受信入站请求时附加；Platform 令牌路径被关；OIDC secret 只在登录时使用。类 b（只对已删 s3r3 有效的演练凭据）：仅 Runtime 演练 JWT 信任密钥（在 `/home/hzy/rehearsal/tokens`，已 shred）与 s3r3 库账号，均未发往外部。因此**本次不需要轮换**；残余不确定性：该 vhost 无独立访问日志，无法从服务端佐证。此前我写的“携带真实服务客户端凭据”不准确，已更正。

- 未访问：`aidcp-runtime.wiztek.cn`（探测时无响应，且应用的 runtime 拨号源被 `HZY_SELF_HOSTED_RUNTIME_DIAL_ORIGIN` 指到回环 32080）。

## 14. s4-rc1 之后的变更评估与 T0 前剩余事项（2026-09-30，只读评估）

### 14.1 `ce08d40e..HEAD`（23 个提交）分类

| 类 | 文件 | 结论 |
| --- | --- | --- |
| (i) 编进 Runtime 二进制的非 cmd、非测试代码 | `apps/aims/enterprise_work_item_completion.go`、`enterprise_work_item_delete.go`、`enterprise_write_transaction.go`、`apps/assets/adapter.go`（均在 Runtime 依赖图内）；`enterprisecandidate/candidate.go`、`enterpriseviews/views.go`（**不在** Runtime 依赖图内，只被 cmd 工具用） | aims/assets 四个文件是纯重构：把原先内联的视图名字面量抽成导出函数（`Enterprise*ViewNames()`），调用处改为调用它；机械比对 `enterprise_write_transaction.go` 的 16 个名字、删除事务的 4 个名字，前后逐字相同。**行为等价**（无逻辑、SQL、协议变化）。 |
| (ii) K2/cutover 工具与脚本 | `cmd/hzy-enterprise-compatibility-rehearsal`、`cmd/hzy-enterprise-verify-views`、`enterpriseviews` 与 `enterprisecandidate`（视图族改由映射派生，verify-views 新增必填 `--install-artifact`）；`console/scripts/g7-prod-grants.mjs`（audience 前缀别名）；`deploy/self-hosted/cutover/a6,a7,a12` | **必须使用 HEAD 版本**：旧工具装 57 个视图，Runtime 启动会因缺视图失败（R3 已证）。 |
| (iii) 五个 Nuxt 应用与 gateway 的构建输入 | 无。变更的 `console/` 文件只有 `docs/G7-…md` 与 `scripts/test-g7-…mjs`，不进应用包 | s4-rc1 应用包（manifest 提交 `ce08d40e`）不受影响。 |
| (iv) 纯文档 | `docs/Go-Live-Self-Hosted-S4-Cutover-Runbook.md` 等 | 无制品影响。 |

**结论**：
1. **Runtime 保持 0.3.221**，不需要 0.3.222，也不要用 HEAD 重编同版本号：我用 `-trimpath` 分别从 `ce08d40e` 与 HEAD 编译 linux/amd64 Runtime，二进制大小相同（28192930 字节）但哈希不同（编译布局差异），同版本号出现两个不同二进制会破坏已批准 0.3.221 的签名/哈希对应关系。已批准、已安装的 0.3.221 由 `ce08d40e` 编成，R3 用它加载 142 视图的绑定并通过，是直接的等价证据。
2. **应用制品保持 rc1**。**需要 rc2 的只是源码快照**：`self-hosted/s4-rc2` 冻结工具、g7 脚本、cutover SQL；窗口内的 K2/视图/verify 工具与 g7 从 rc2 源码在新机构建（13 秒）。这与"制品不变、工具随源码"一致，不触发 R2 stage/sync/approve/离线安装。
3. 提醒：rc2 冻结后不再改 Runtime 依赖图内代码；若之后确需修改，才走 0.3.222。

### 14.2 T0 前剩余事项

| # | 事项 | 状态 | 需用户 | 需批准 |
| --- | --- | --- | --- | --- |
| 1 | rc2 冻结并打 `self-hosted/s4-rc2` tag（只推 GitLab；冻结点在文档与工具最后一次改动之后） | 待办 | 否 | 是（A2 同类，打 tag） |
| 2 | 新机用 rc2 源码重建 5 个 K2 工具并记哈希（不启动服务，13 秒） | 待办，依赖 1 | 否 | 否（新机本地构建，沿用 A3/R3 做法；建议通知） |
| 3 | `/etc/hzy-data-runtime/config.json` 预写模板（B10b 必需：启用 console+directory；此前不存在；库 `hzy_console` 到 B5 才有，故只写模板、不含最终值，属主 `hzy-runtime` 0600） | 待办 | 否 | 是（/etc 生产路径写入，A5 同类） |
| 4 | 新机 `hzy_cutover` 窗口临时授权 `a6-supplement-window-grants.sql` | 文件已审；B10c 执行 | 否 | 已批准（窗口内执行前通知） |
| 5 | A16 冷存档口径与值班/回滚决策人（**员工公告：用户决定不发**） | 待办 | 是（口径确认） | 用户操作 |
| 6 | A17 Go/No-Go 检查表：P0-1~4 关闭（P0-1/2/3/4 均有 R3/A4/A14 证据）、A15 全绿、rc2 tag 与哈希一致、当日 Platform 备份、变更冻结、日本机磁盘/负载、回滚决策人在线 | 我出草稿；T-1 填写 | 是（Go） | 是（A17） |
| 7 | 生产 `hzy_console` 解密探测（同 13.7 程序）与 G-7 plan/verify | 属窗口 B5/B13 | 否 | 随窗口批准 |
| 8 | A10/A18 目录连接器切换与企业微信/钉钉登录 | 见 §15.4：企业微信后台不用改（用户已确认）；钉钉登录暂不启用（用户已决定，后台不加回调）；**企业微信登录需 Platform prod `consoleLogin`（§15.6，用户已批准，待审后执行）**；connector 的 4 个 URL/issuer 项在 B14 改指 | 否（钉钉）/ 待定（企业微信 Platform 写入） | 企业微信写入需批准 |
| 9 | Platform 侧：prod 实例现停在 `ready`（探针遗留）；B10b 判据已改为"心跳新鲜度" | 已记录 | 否 | 否 |
| 10 | 变更冻结：提前告知其他管理员不得改 Cloudflare/旧主机/共享 Platform；本机 test 租户仍每分钟轮询 Platform，不影响 | 待办 | 是（通知） | 否 |
| 11 | W4/W7（协作注册、协作启用）延后，切换不启用协作 | 已定 | 否 | 否 |
| 12 | 切换后清理 C3（含 `/home/hzy/build`、`/root/.hzy-s3`、旧密钥与导出文件等），另行批准 | T+ | 否 | 是 |

### 14.3 日期与时段建议（已被 §15.3 取代：用户选定 2026-10-02）

- 2026-10-01 至 10-07 为国庆假期（请用户按国务院当年放假通知核对是否有调休上班日），10-08（周四）为上线目标。
- **建议：2026-10-04（周日）20:00（东八区）开窗**，即用户所在的加拿大 ADT（UTC-3）10-04 09:00，用户白天在线；员工在假期，影响最小。预留 4 小时脚本时间加 1 小时缓冲，预计 10-05 01:00 前完成。B11 的用户在场约 35–55 分钟，按估算落在开窗后约 55 分钟至 1 小时 50 分钟之间（约 20:55–21:50 东八区，即 ADT 09:55–10:50）。
- 10-05 至 10-07 三天作为观察与回滚缓冲，10-08 前完成冒烟与员工入口开放的最终确认。备选窗口：10-05（周一）20:00，缓冲缩为两天。
- 前置节点：10-01 前 rc2 tag 与新机工具重建；10-02 前 config 模板（已完成）；10-03（T-1）A17 Go/No-Go 与当日 Platform 备份。
- 决定权在用户；这是建议，不是批准。

## 15. 2026-09-30 执行记录与 T0 定为 2026-10-02

### 15.1 rc2 与新机工具（已批准，已执行）

- Tag：annotated `self-hosted/s4-rc2`（tag 对象 `e5576ea6…`）→ 提交 `cb4418ca39a7a82c1504836a58b906378ae85782`，只推 GitLab origin。s4-rc1 不变（`ce08d40e`）；应用与 Runtime 0.3.221 仍是 rc1 制品。
- 新机以 git bundle 取得 rc2，在 `/home/hzy/build/src` 检出（detached），用 Go 1.26.3 构建 5 个 K2 工具（6 秒，`-trimpath`，`Version=0.3.221`，`Commit=cb4418ca`），放入 `/root/.hzy-s4-rc2/bin`（0500，root）；`SHA256SUMS` 与 `COMMIT` 在 `/root/.hzy-s4-rc2/`。窗口内一律用这一套二进制，并在 B0 复核哈希。
- 哈希（sha256）：

| 文件 | sha256 |
| --- | --- |
| bin/hzy-enterprise-compatibility-rehearsal | `ca1c7c69d6f840e22adb8088783165e6a7612be25176fd92c883d6668b9efb11` |
| bin/hzy-enterprise-drain | `04b7306ff0411944ef66547296584c16d5f924ffa42c667e2ac015fb1918201a` |
| bin/hzy-enterprise-migrate | `9b774e9f170052d368d81dc0a48504a5e942d870adcbcdc04daf0ae66b3c550e` |
| bin/hzy-enterprise-test-cutover | `1a94c267a110672d4764c193e8faf3cd76ae8f6d9d9f140ad3316c406c63e7e8` |
| bin/hzy-enterprise-verify-views | `62b7bf036bea4bd97ea918d45ad53f7d9cf1e384be32dab238a0bb33c54c31f1` |
| console/scripts/g7-prod-grants.mjs | `19cd8b171ecd7d6878eb4bdbb76ae5c50efe3fdf770666eb31a99015dd4e3cba`（`node --check` 通过） |
| a6-supplement-showview.sql | `bd62ebbbfc6efc23f6d999c495e1451d42c1f4cfeec4ebf6292a84b17c8aecdd` |
| a6-supplement-window-grants.sql | `bdfffac21f946d4166b8dc1e33000a43a2df27fe05e0fccb746f3e3801cb9715` |
| a6-supplement-window-revoke.sql | `07d722a026f672dd259cd2c57ab1c2bb3feb0da00139b94a6f78eb9c98783a80` |
| a6-prod-grants.sql | `3201b2fb99a617838046afd4255b154ef20d107010362bf6a5409f6eb280998b` |
| a7-prod-tenant-gateway-subdomain.sql | `2f40c46b165bfc1593fb7b2cc88fe0233f4a65c86c17eac3418048bae82912b9` |
| a12-platform-switch.cjs | `eec6a1476544f043753acf91e8bcc8631f360535766d22757516ab28423f3b6b` |

### 15.2 B10b 配置模板（已批准，已写，未启用）

`/etc/hzy-data-runtime/config.json`（属主 `hzy-runtime:hzy`，0600，1469 字节，写前该文件不存在）。内容只有 B10b 最小结构：server `127.0.0.1:31080`、tenant `C000001`、deployment `c000001-prod-tenant-runtime`、auth（issuer `https://aidcp.wiztek.cn/console`、audience `data-runtime`、jwksUrl `http://127.0.0.1:31001/console/.well-known/jwks.json`）、`apps.console` 与 `apps.directory` 启用（库 `hzy_console`，账号 `hzy_rt_console`，口令为 `REPLACE_AT_B10B_hzy_rt_console_PASSWORD` 占位），其余 app 全部 `enabled:false`，无 enterprise 块（B14 加）。**窗口内 B10b 启动前必须替换口令占位，且 `deploymentBindings` 等按 A7 值补齐；含占位时 Runtime 不会启动。** 写前目录清单与 manifest 存于 `/root/.hzy-r3/`（`etc-hzy-data-runtime.listing.pre`、`manifest.pre-config`）。`hzy-data-runtime` 与 `update-request.path` 仍 inactive/disabled。`/etc` manifest 基线已更新（58 行），旧基线保存为 `manifest.before.pre-config-template`，回读 diff 为空。

### 15.3 T0 = 2026-10-02（周五）20:00 东八区（UTC 12:00；用户 ADT 09:00）

| 日期 | 事项 |
| --- | --- |
| 09-30（今天） | rc2、工具、config 模板（已完成）；A16 冷存档口径稿（公告稿已写但用户决定不发）；A17 检查表草稿（15.5）；A18 只读结论（15.4） |
| 10-01 | A17 预检（只读）；通知变更冻结；（钉钉后台不加回调：用户已决定暂不启用钉钉登录） |
| 10-02 白天 | 当日 Platform 备份（`pd_backup`）；最终 Go/No-Go |
| 10-02 20:00 | 开窗（估时 3.1–3.8 小时脚本，预留到 01:00） |
| 10-03 至 10-07 | 观察与回滚缓冲（国庆假期） |
| 10-08 上班前 | 最终冒烟，开放员工入口的最终确认 |

窗口内估计时间线（东八区 / ADT）：B0–B2 20:00–20:30 / 09:00；B3–B10 至约 21:00 / 10:00；B10b/B10c 约 21:00；B10d（生产 HMAC，6–8 分钟）约 21:00–21:08；**B11 用户在场约 21:10–22:05 / 10:10–11:05**；B12 至约 21:35；B13–B14 至约 22:35；B15–B16 至约 22:50；B17–B18 至约 23:50；B19 约 00:00；缓冲至 01:00 / ADT 14:00。备选窗口：10-03（周六）同一时刻，缓冲缩为四天。

### 15.4 A18 企业微信与钉钉登录（只读结论）

- **企业微信：后台不用改（用户已确认后台登记的回调与可信域名都指向 Connector Runtime）。** 依据：`console/server/utils/wecom.ts:104-127` 的 `redirect_uri` 是 `<connector.runtimeApiUrl>/v1/identity/wecom/callback`；旧 Console 的 `connector.runtimeApiUrl` = `https://tpapi.wiztek.cn`（`setting_values`，2026-07-17 更新，随 `hzy_console` 恢复到新库，不变）；旧 Console 配置里 WeCom 只有 `corpid/agentid`，没有回调字段。
- **登录后跳回 Console 的地址来自 connector 自己的配置**，不是 Console 传入或 Platform 设置：`notification-runtime/internal/server/server.go:redirectWeComCallback` 用 `cfg.Console.BaseURL + /api/auth/wecom-callback`（要求 https），而 `BaseURL` 取自 connector 环境变量 `HZY_CONSOLE_API_URL`（当前为旧 Cloudflare Console `https://wiztek.huizhi.yun`）。**B14 把它改成 `https://aidcp.wiztek.cn/console` 后，跳转自动变为 `https://aidcp.wiztek.cn/console/api/auth/wecom-callback`。**
- connector 主机 `gitlab.wiztek.cn` 的 `/opt/hzy/connector-runtime/.env`（服务 `hzy-connector-runtime`）中需要一起改的项，共 5 个：`HZY_CONSOLE_API_URL`、`HZY_CONSOLE_TOKEN_URL`（→ `…/console/oauth/token`）、`HZY_CONNECTOR_RUNTIME_JWT_ISSUER`（→ `https://aidcp.wiztek.cn/console`，与新 Runtime 配置的 issuer 一致）、`HZY_CONNECTOR_RUNTIME_JWKS_URL`（→ `…/console/.well-known/jwks.json`）、`HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL`（→ `https://aidcp-runtime.wiztek.cn`）。改后重启该服务。其余（tenant `C000001`、deployment `C000001-console`、connector id、audience）不变。
- **"把 connector 登记为可信来源"**：不需要新的登记动作。connector 的注册记录在 `connector_runtime_instances`（id `connector-runtime.C000001-console`，deployment `C000001-console`，status active，含公钥），随 `hzy_console` 恢复到新库；连接器用其私钥签名心跳，Console 用库中公钥验证。已只读核实 connector 的服务客户端（旧生产 `hzy_console`，经 `hzy_dump` 只读）：
  - client_id `conn_5DziqPIGYVH5lt83i3ehTTxg`（connector `.env` 的 `HZY_CONNECTOR_RUNTIME_CLIENT_ID`）→ `service_clients.id=1043`，`client_code=connector-runtime.C000001-console`，`app_code=connector-runtime`，`supporting_service`，**active**；凭据 active，版本 14，无过期，最近使用 2026-09-29 23:22（connector 当前正在用）。
  - 授权共 9 条，8 条 active、1 条 revoked（旧的未加前缀 `connector_runtime:heartbeat`，早已撤销）。active 的 8 条（只列 resource/action，scope 均限定 tenant `C000001`、deployment `C000001-console`、integrationCodes `wecom.default/dingtalk.default/dingtalk.identity`）：`console:connector-runtime:heartbeat`、`console:directory-profiles:sync`、`data-runtime:credential_vault:resolve`、`data-runtime:integration_config:view`、`tenant-runtime:credential_vault:resolve`、`tenant-runtime:integration_config:view`，以及两条未加前缀的 `credential_vault:resolve`、`integration_config:view`（未加前缀的在新 Console 不授权，但不影响）。
  - connector 代码实际只请求 4 个（audience, scope）：`(data-runtime, data-runtime:integration_config:view)`、`(data-runtime, data-runtime:credential_vault:resolve)`（`notification-runtime/internal/console/client.go:120,148`）、`(console, console:connector-runtime:heartbeat)`（`:179`）、`(console, console:directory-profiles:sync)`（`:222,248`）；四个都有对应的、**资源名带 audience 前缀**的 active 授权。**（更正 2026-10-01：此处结论错误——新 Runtime 只认 `scope_json` 里的 `audience` 键，资源名前缀不算；这些授权的 `scope_json` 没有 `audience`，connector 取令牌 403 `insufficient_scope` 退出。已由 B17 修正 12 按 id 补 audience 事实（`b17-connector-audience-facts.sql`）。其它客户端的缺失见 C4：逐个排查上线前实际会用到的客户端，notification-runtime、directory-connector 为重点。）**
  - **G-7 不会误伤它**：G-7 目录（`g7-prod-grant-catalog.mjs`）只引用 `enterprise.runtime`、`aims.runtime`、`workflow.runtime`、`codocs.runtime`、`console.runtime`、可选 `collab.runtime`，`connector-runtime.C000001-console` 不在其中；plan 的 `revoke` 只针对 `workflow.runtime`、`aims.runtime` 的复数 `integration_operations`/`integration_operation` 的 `execute` 行（`g7-prod-grants.mjs:116-121`），不涉及 connector；其余授权行进入 `nonTarget`，计划与 apply 前后用 `nonTarget.hash` 比对，connector 的 9 行因此被哈希保护，任何改动都会使 verify 失败。（旧库共 13 个 service client，与“14 个”口径的差别不影响结论。）
  - **不需要处理方案。** 残余风险只有：新 Console 对 connector 的令牌签发未经 R3 探测（R3 探测只覆盖 G-7 的 34 项）。B13 前置与 B18 冒烟已据此增加检查（见 B13 与 §15.4 末）。
- **钉钉登录（用户决定 2026-09-30：暂不启用，钉钉后台不加新回调）**：钉钉浏览器登录的 `redirect_uri` 是 Console 自己的地址（`deriveDingTalkCallbackUrl`），只有授权码换身份与组织同步经 connector。**只读查清的控制点**：登录方式是否启用只由 `resolveConsoleLoginConfig`（`console/server/utils/loginConfig.ts`）决定：`dingtalk.enabled = enabledProviders 含 dingtalk 且 dingtalk clientId 非空`，`enabledProviders` 只来自 ① 受信租户网关注入的 `x-hzy-console-login-*` 头（自托管网关 `deploy/self-hosted/gateway` 不注入）② Platform 策略包 `consoleLogin`（`settings_json` 的 prod 环境）；没有 Console 环境变量或 Console 库字段可以单独开启钉钉。**当前事实（只读，Platform 库）**：`C000001` 的 `deploymentEnvironments.prod` 只有 `tenantGateway`，**没有 `consoleLogin`**（顶层也没有），因此新自托管 Console 的策略包 `consoleLogin` 为 `mode=none`、`enabledProviders=[]`，钉钉登录**默认就是关闭的**，无需任何写入；登录页不显示钉钉入口（`publicConsoleLoginConfig` 在未启用时 `dingtalkClientId` 为空），直接访问 `/api/auth/dingtalk-login` 或 `/api/auth/dingtalk-callback` 返回 **503 “钉钉登录未启用”**（`createError`，不是 500）。因此 B13 **不增加任何写入**；只在 B13 完成后只读回读上述公开登录配置。前提：不要在 Platform prod 范围写入含 `dingtalk` 的 `consoleLogin`；若日后要启用，先在钉钉开放平台登记 `https://aidcp.wiztek.cn/console/api/auth/dingtalk-callback`。
- **关闭钉钉不影响的部分**：connector 的 `dingtalk.default`、`dingtalk.identity` 集成（`integrations` 表，状态 active）和组织/People 同步、工作通知走 connector 的 `people.dingtalk.sync`、`directory.dingtalk.profile-sync`、`identity.dingtalk.exchange` 能力，与"登录方式是否启用"是两套开关，照常。企业微信登录的门控也是同一个 `resolveConsoleLoginConfig`，但只看 `wecom` 自己的项，不受钉钉影响。
- **⚠ 同一发现对企业微信的影响（需协调会话决定，涉及 Platform 写入，未执行）**：同样因为 prod 范围没有 `consoleLogin`，新 Console 的 `enabledProviders` 只有 `oidc`，**企业微信登录入口默认也不会显示**，`/api/auth/wecom-login` 与 `wecom-callback` 会返回 503 “企业微信登录未启用”（`wecom-login.get.ts:21`、`wecom-callback` 同）。要让企业微信登录可用，唯一路径是给 Platform 的 prod 范围写入 `consoleLogin`：`enabledProviders` 含 `wecom`，`wecom.corpid=wwe3597050c256d8e4`、`wecom.agentid=1000007`（取自旧 Console `integrations.wecom.default`，非敏感），OIDC 部分仍由 Console 环境提供。这是一次受审 SQL 写入（类似 A7 的子域 SQL，`JSON_SET` 单路径、写前备份、事务、回读、回滚 `JSON_REMOVE`），**不使用租户设置页保存**（会改写站点 URL）。此前"企业微信不用改后台"的结论只针对企业微信后台，不含这一点。
- 钉钉 `dingtalk.default`（工作通知/People 同步）经 connector，B14 改指后自动跟随；无需后台改动。
- **B18 冒烟增加**：0. connector 心跳成功（新 Console 收到 `console:connector-runtime:heartbeat` 令牌签发的心跳，`connector_runtime_instances.last_heartbeat_at` 刷新）；① 企业微信扫码登录正例 1 个（授权→connector 回调→跳回 aidcp Console→建立会话）；② 撤权账号反例 1 个（已停用/撤销授权账号扫码，应被拒绝且不建立会话）；③ 钉钉（暂不启用）：登录页**不显示**钉钉入口；直接访问 `/api/auth/dingtalk-login`、`/api/auth/dingtalk-callback` 返回明确的 503 “钉钉登录未启用”，不得是 500；**不做钉钉登录正例**。

### 15.5 A17 Go/No-Go 检查表（草稿，T-1 填写）

| # | 检查项 | 当前 |
| --- | --- | --- |
| 1 | P0-1~4 关闭（P0-1 排空链 R3 全绿；P0-2 Runtime 0.3.221 已签名安装；P0-3 A1 已改；P0-4 Vault 指纹一致且 19/19 解密成功） | 已有证据 |
| 2 | A15 R3 全绿 | 是（§13） |
| 3 | rc2 tag 与新机工具哈希一致 | 是（§15.1）；B0 复核 |
| 4 | A6 补充：`showview` 已执行；`window-grants` 待 B10c | 部分 |
| 5 | config 模板就位；B10b 前替换占位 | 是（模板） |
| 6 | 当日 Platform 备份新鲜且新机可解密 | T-1 / 10-02 |
| 7 | 变更冻结：无人改 Cloudflare、旧主机、共享 Platform | 待通知 |
| 8 | 日本机磁盘与负载正常 | T-1 只读 |
| 9 | 回滚决策人在线，值班人到位 | 待用户 |
| 10 | ~~员工公告已发出~~（用户决定不发，本项取消） | 取消 |
| 11 | 钉钉登录暂不启用（用户已决定；钉钉后台不加回调；prod 范围不写 dingtalk） | 已决定 |
| 12 | connector 主机 5 项环境变量改动稿与回退值已备（B14） | 待办 |
| 13 | 用户 B11 在场时间已预约（35–55 分钟） | 待用户 |

### 15.6 企业微信登录：Platform prod `consoleLogin`（`a7b`，用户已批准，**已于 2026-09-29T23:46:54Z 执行**）

- **文件**：`deploy/self-hosted/cutover/a7/a7b-prod-console-login-wecom.sql`（sha256 `814d6f2b21754f71dc439c55cee0f654485b4372f37a5902b6753c3751b16893`）与 `…rollback.sql`（`65d9a6cfa326b0c9025889c6652d553cad79a8dbf6d86da16ec6ba7298363b83`）。
- **写入内容**：只改 `tenants.settings_json`（C000001）的两处：① `$.deploymentEnvironments.prod.consoleLogin = {"mode":"oidc","enabledProviders":["oidc","wecom"],"wecom":{"corpid":"wwe3597050c256d8e4","agentid":"1000007"}}`（不含 secret，不含 dingtalk）；② `$.deploymentEnvironments.test.consoleLogin.enabledProviders = ["oidc"]`（固定 test）。
- **合并规则**（`tenantDeploymentSettings.ts`，已逐函数移植计算）：prod 有效值 = 顶层设置与 prod 范围合并；非 prod 环境（test）的有效值 = `mergeConsoleLoginSettings(顶层∪prod 的 consoleLogin, test 范围的 consoleLogin)`。`mergeConsoleLoginSettings` 是**逐键浅覆盖**：顶层键（`mode`、`enabledProviders` 等）以覆盖方数组/值整体替换，**不是并集**；`oidc/cas/wecom/dingtalk` 各自再逐键覆盖。`normalizeConsoleLoginMode`：非 oidc/cas/wecom/dingtalk 的值都变成 `none`；`normalizeConsoleLoginProviders`：`mode=none` 时列表恒为空，否则为 `[mode] ∪ 配置列表`（去重）。因此 **`mode` 必须写成具体值 `oidc`**（`none` 会使列表被清空，企业微信入口不显示）；`oidc` 与 Console 环境里已配置的上游 OIDC 一致。
- **test 前后对比（对 Platform 库实际 `settings_json` 只读计算，`consoleLoginSettings(…,'test')` 的规范化输出，即策略包与 gateway resolve 实际使用的值）**：写前 sha256 前 16 位 `87105a2076d6e79d`，写后 `87105a2076d6e79d`，**逐字相同**（`mode=oidc`、`enabledProviders=["oidc"]`、`wecom.corpid/agentid` 均为空串、无 dingtalk）。**不加固定时**（只写 prod）test 的 `enabledProviders` 会变成 `["oidc","wecom"]`（wecom 仍因 corpid/agentid 为空而不生效，但值变了），所以固定是必须的。诚实说明：未规范化的原始合并结果多一个显式键 `enabledProviders`，这不是 Platform 输出的一部分。其它路径（tenantGateway、dataRuntime、platform、deployment_sites、顶层字段）逐字不变（计算 `otherPathsIdentical=true`；SQL 只写上述两处）。
- prod 写后有效值：`mode=oidc`、`enabledProviders=["oidc","wecom"]`、`wecom.corpid=wwe3597050c256d8e4`、`agentid=1000007`，`oidc` 各项为空串（OIDC 由 Console 环境提供）、`dingtalk` 空，**无 secret**。
- **生效路径**：`consoleLogin` 由 `buildPolicyBundlePayload`（`policyBundle.ts:993/1087`）写入策略包 payload，包在 B16（W11）生成并存储，因此**必须在 B16 之前写入**；建议现在（T-n）执行，B16 生成后校验 payload 的 `consoleLogin` 恰为上述 prod 有效值。已存在的 test 包不会被改写（包是生成时快照）。
- **执行要求**：单事务，写前备份 `tenants` 该行，`ROW_COUNT()=1`，回读后 COMMIT；回读判据：prod 有效 consoleLogin 与预期一致；test 有效 consoleLogin sha256 前 16 位 `87105a2076d6e79d` 不变；`tenantGateway/dataRuntime/platform` 三个合并结果与 `deployment_sites` 全表写前写后逐字不变。回滚：`…rollback.sql`（守卫为“恰为本次写入的值”）或还原备份行。
- **B18 冒烟**：企业微信扫码登录入口显示；正例 1 个能登录；撤权账号反例被拒且不建立会话。

- **执行记录（2026-09-29T23:46:54Z，gitlab 主机，Platform 库 `hzy_platform_dev`）**：协调会话审过两文件哈希后执行。写前备份整行 `tenants`(C000001) 到 `/root/hzy-g9/a7b/tenants.C000001.before.json`（0600）。执行脚本先核对 SQL 哈希 `814d6f2b…6893`，在一个事务里运行，`affectedRows=1`；事务内回读全部通过后才 COMMIT：prod 原始值恰为预期；prod 有效值 `mode=oidc`、`enabledProviders=["oidc","wecom"]`、corpid/agentid 正确、`oidc` 全空串、`dingtalk` 空；test 有效 consoleLogin sha256 前 16 位写前写后均 `87105a2076d6e79d`（逐字相同）；prod 与 test 的 `tenantGateway/dataRuntime/platform` 合并结果写前写后相同；除两处路径外整个 `settings_json` 逐字不变；`deployment_sites` 全表哈希不变；其它租户 0 行被改。提交后用新连接再读一次：prod scope 键为 `consoleLogin`、`tenantGateway`；`test.consoleLogin.enabledProviders=["oidc"]`；test sha 仍为 `87105a2076d6e79d`。回滚：`a7b-prod-console-login-wecom.rollback.sql` 或备份行。
- **B16 增加校验**：生成的 prod 策略包 payload 的 `consoleLogin` 必须恰为 `mode=oidc`、`enabledProviders=["oidc","wecom"]`、`wecom.corpid/agentid`；**`oidc` 各字段必须为空串或不存在（不能带 secret，不能覆盖 Console 环境里的 Keycloak 配置）**，`dingtalk` 为空。（依据 `loginConfig.ts` 中 `bundleConfig?.oidc.x || rawOidc.x`：bundle 里的空串会回落到 env 的 Keycloak 配置，所以 `mode=oidc` 不影响现有 SSO。）
- **B18 增加**：Keycloak 登录正例照常；企业微信扫码入口显示、正例登录、撤权账号反例被拒。

## 16. 切换后 Console 管理页可用性与服务凭据签发路径（只读核实，2026-09-30）

### 16.1 独立 Console 的管理页能否经 `https://aidcp.wiztek.cn/console/...` 使用

- **自托管网关放行 `/console/**`（页面与 API）**：自托管网关是同一份 Cloudflare 租户网关代码在 Node 下运行（`deploy/self-hosted/gateway/server.mjs` 引入 `deploy/cloudflare/tenant-gateway/src/index.js`）。`APP_ROUTES` 只列出 finance/altoc/aims/…/codocs 等业务应用前缀；**没有匹配任何应用前缀的路径一律落到 `proxyToConsole`**，按原路径转发到 Console 源站（`127.0.0.1:31001`，应用基路径 `NUXT_APP_BASE_URL=/console/`），页面与 API 同等对待。Enterprise 试点的分流只处理 `/enterprise/**` 与 `/shell/**`；`enterprise-host-routes.mjs` 里没有登记 integrations、vault、service-clients 等 Console 管理页，它们不会被转走。**注意：R3 没有经网关验证过**，此结论来自代码与配置，须在 B18 用真实请求确认。
- **构建产物包含这些页面**：`console-s4-rc1.tar.gz` 的 `.output` 中，以下路由都在页面路由表里：`/integrations`、`/vault`、`/service-clients`、`/system-settings`、`/work-calendar`、`/org-profile`、`/data-runtime`、`/connector-runtime`、`/notification-runtime`、`/directory/*`、`/admin/*`（runtime-apps、logs、regions、business-domains）。源码 `console/app/pages/` 也有同名页面。
- **没有 Cloudflare 专有绑定依赖**：Console 服务端代码里没有 KV、D1、R2、`caches`、Worker binding 的强依赖；对 `context.cloudflare.env` 的读取都是“Cloudflare 环境或 `process.env`”的回落写法（`loginConfig.ts`、`bundleCache.ts`、`dataRuntimeManagement.ts` 等），构建预设是 `node-server`，R3 已在新机启动并监听。策略包缓存在自托管走文件缓存。**唯一不适用的页面**：`/admin/runtime-apps`（PM2 进程管理，`runtimeApps.ts` 仅在 Cloudflare 下禁用，自托管下会尝试 PM2 而新机用 systemd）——不影响日常运维，记为低风险。
- **菜单可见性**：菜单来自 `console/app/config/permissions.ts`，由 manifest 资源与当前用户在 **prod 策略包**（B16/W11）里的权限过滤；管理员要看到“集成中心、凭证库、服务凭证、系统参数”等，前提是其角色在 prod 包里带有对应资源（`credential_vault`、`service_clients`、`system_settings` 等）的权限。B16 后须核对管理员账号的角色映射，B18 用管理员登录实测菜单。
- **日常运维依赖链**：GitLab token 轮换、AI Provider、OSS 配置走 Console 的 `integrations/*` 与 `vault/*` API，落到 Tenant Runtime 的 Console 适配器和 Vault；Vault 解密已证（§13.7，19/19）。这些页面的读写路径 R3 没有经 UI 走过，故列入 B18。

### 16.2 B14 的服务凭据“签发”到底走什么（重要发现，B14 前须定方案）

- **不是“服务凭证”页**：`console/app/pages/service-clients.vue` 只有一个按钮，调用 `POST /api/v1/console/service-clients/repairs/aims-codocs-runtime-read`（补齐 `aims.runtime` 的 Codocs 只读授权）。Console 的 Nuxt 服务端**没有任何签发 service client 凭据的接口**。
- **也没有可直接用于生产的脚本**：G-7 工具只建 client 与 grant，从不建凭据（`g7-prod-grants.mjs` 注释“The plan never mints a credential”）；仓库唯一的初始凭据工具 `data-runtime/cmd/enterprise-test-credential` 写死为这台 Mac 的 C000001 **测试** Runtime（固定目录、测试库、测试 deployment），且不输出 secret，不能直接用于新机。
- **现有 client 的 secret 存放方式（旧生产库，只读）**：`aims.runtime`、`codocs.runtime`、`workflow.runtime` 的 secret 版本是 `external_ref`（`storage_backend=env_ref`），即由 **Runtime 进程的环境变量** `HZY_SERVICE_CLIENT_AIMS_SECRET`、`HZY_SERVICE_CLIENT_CODOCS_SECRET`、`HZY_SERVICE_CLIENT_WORKFLOW_SECRET` 提供；`console.runtime`、`notification-runtime`、`connector-runtime…`、`directory-connector…` 是 `db_encrypted`（随库恢复，Vault 已可解密）。新机 `/etc/hzy-data-runtime/.env` 目前**没有**这三个变量，各应用 env 里对应位置是 `REPLACE_` 占位——**Runtime 与应用两侧必须持有同一个值**，否则应用取不到令牌。
- **`enterprise.runtime`** 在旧库不存在，G-7 会建 client 与 grant，但没有生产可用的“初始凭据”命令。
- **待决策的最小方案（请协调会话/用户定，我先不做）**：① 对三个 `env_ref` 的 client：要么从日本机 Runtime 环境经用户本机管道取出现有值，同时装入新机 Runtime 的 `.env` 与三个应用的 env（A14 同款方式，不打印不落盘）；要么在两侧同步设为新值（`env_ref` 只存变量名，不需要改库）；建议后者更简单且不依赖日本机，但会使旧值作废，必须同一时刻两侧一起改。② 对 `enterprise.runtime`：需要一个经审的、参数化的生产初始凭据命令（以 `enterprise-test-credential` 为模板，去掉写死的 Mac 路径与测试库，带 `--plan/--apply/--verify`，写 `db_encrypted` 版本），并决定 secret 如何交付给 Enterprise 应用进程。在此之前 B14“签发并登记 service client 凭据”不可执行，B17 各应用取服务令牌会失败。

### 16.3 B18 冒烟新增（全部只读，不保存）

- 管理员账号登录后，经 `https://aidcp.wiztek.cn/console/` 依次打开：集成中心（GitLab、AI Provider、企业微信、钉钉、OSS 各卡片能列出，钉钉集成状态 active 仅用于组织同步）、凭证库、服务凭证、系统参数、企业资料、目录管理、运行时管理；菜单项齐全（对照旧控制台截图：管理概览、企业资料、目录管理、系统参数、节假日管理、集成中心、运行时管理、凭证库、服务凭证、系统管理、审批中心）。
- **Host 部门文档**：用真实部门负责人账号（或由用户操作）打开 Host 部门文档，确认列出的是生产文档，条数与恢复后 `hzy_codocs` 对应部门的行数一致；打开其中一篇正文，确认 OSS 读取成功。只读，不保存、不编辑。（说明：hzy0 的 `hzy_codocs` 是 9-17 新建的空库，用户在 hzy0 只见测试夹具；切换后会恢复生产数据。）

## 17. env_ref 服务凭据：T-n 预置、B13 凭据行 SQL 与方案 A 的阻塞（2026-09-30）

### 17.1 方案 A（沿用日本机旧值）不可行：源不存在（只读核实）

- 日本机 `hzy-data-runtime` 的单元只有一个 `EnvironmentFile=/etc/hzy-data-runtime/.env`，无 drop-in；`.env` 的变量名清单里**没有** `HZY_SERVICE_CLIENT_*_SECRET`；运行进程（MainPID）的环境里这三个变量个数为 **0**；在日本机 `/etc /opt /root /home /srv /var/lib` 全部文件中搜索这三个变量名，**没有任何文件命中**；PM2 无相关进程，docker 只有一个无关容器。所以旧值不在日本机，我没有读取任何秘密（无可读取之物）。
- 推断（未证实）：旧生产里这三个 client 的 secret 只存在于 Cloudflare Worker 的密钥中（不可读），日本机 Runtime 走的是网关断言的 app identity 路径（`ConsumeRuntimeAppIdentity`，不校验 secret；`codocs.runtime` 的 `last_used_at` 也在持续更新），因此这些 `env_ref` 行在日本机从未以“secret 校验”方式被用过。
- 结果：三个旧行的 `content_hash` 是旧值的哈希，永远无法用新值匹配。要让新机的应用用 client secret 取服务令牌，只有方案 B：新值 + 对齐 `content_hash`（见 17.3 的 `--align-existing`）。**需要协调会话/用户重新决定**；决定前不写这三个变量。

### 17.2 已执行：Enterprise 新密钥（用户批准“A”中的第 2 项）

- 新机 root 用 `t-n-env-ref-secrets.py --only enterprise` 生成随机密钥（`secrets.token_urlsafe(48)`），写入 `/etc/hzy-data-runtime/.env`（`HZY_SERVICE_CLIENT_ENTERPRISE_SECRET`）与 `/etc/hzy/enterprise.env`（`HZY_SERVICE_CLIENT_SECRET`，原为 `REPLACE_` 占位）。不打印；写前备份到 `/root/.hzy-a5/envref-backup-20260930T000432Z`（0700）；回读两侧 `sha256[:12]` 指纹一致 `66f34ea29f0d`；文件权限属主不变（`.env` 为 `hzy-runtime:hzy` 0600，`enterprise.env` 为 `root:root` 0600）；`enterprise.env` 中已无 `REPLACE_`。**未启动任何服务**（`hzy-data-runtime` 仍 inactive）。`/etc` manifest 基线已更新（旧基线 `manifest.before.pre-envref`），回读 diff 为空。
- 脚本安全：只在“Runtime 变量不存在且应用键仍为 `REPLACE_` 占位”时才写，否则拒绝；本机用伪造文件做过计划/应用/拒绝重复/权限保持测试。

### 17.3 B13：enterprise.runtime 凭据行（待协调会话回复“可执行”后在窗口 B13 的 G-7 apply 之后执行）

- 文件（`deploy/self-hosted/cutover/b13/`）与 sha256：`b13-enterprise-runtime-env-ref-credential.sql` `574a5d1910e06e07af12469e60477a7833ebe8632208e22ec7ea991203fe64c6`；`…rollback.sql` `ff9b0a154c8f10ec2af7e6c4aa556b2db99d5ee10b79daa0e23add9ba6b3c993`；备选 `b13-env-ref-content-hash-align.sql` `2bc94ed8691a983f45fee57685cada11438bfa603e75f9092852ffc7b8adf68a`（仅方案 B 用）；执行器 `b13-env-ref-credentials.mjs` `47a720d01c2323d9e6bcd0281388103488603bb4c4774963ea568ecbc585f76d`；测试 `test-b13-env-ref-credentials-mysql.mjs` `9bb03e26…fdb92a`；T-n 脚本 `t-n-env-ref-secrets.py` `9fd6c0c22da215180d5a9072791b265ad228f10126b8746fe56ebd7017a34c05`。
- 行形状逐列取自生产 `codocs.runtime` 的一组行（五张表）：`vault_secrets`（`svc.enterprise.runtime.client_secret`、`owner_type=service_client`、`owner_key=enterprise.runtime`、`storage_backend=env_ref`、`reveal_policy=approval`、`masked_preview=env-ref`）、`vault_secret_versions`（`ciphertext_blob` 空、`backend_secret_ref=HZY_SERVICE_CLIENT_ENTERPRISE_SECRET`、`encryption_scheme=external_ref`、`content_hash=sha256_+sha256(变量名)`，即 Vault API 自己给 env_ref 写的规范形态，`vaultContentHashMatches` 接受“变量名哈希”，所以值可随时换）、`service_client_credentials`（`client_id=enterprise.runtime`，与旧库 `codocs.runtime` 的写法一致）、`service_clients.current_credential_id` 回填、`vault_secrets.current_version_id` 回填。代码层面 env_ref 对任何 client 都允许，变量名只受 `^[A-Za-z_][A-Za-z0-9_]*$` 约束（`vault_crypto.go`）。
- 执行器用法：`node b13-env-ref-credentials.mjs --config <db.json 0600> --pre-image /root/.hzy-a5/b13-pre.json (--plan | --apply | --rollback) [--align-existing]`。`--apply` 在单事务内：核对三个既有行的形态与 `enterprise.runtime` 的前置状态（活动、`app_code=enterprise`、无凭据、无 vault 行），先把三个既有行的哈希/预览存为 pre-image（0600，只含哈希与预览），运行 SQL，回读并按 `ConsumeServiceClientCredential` 同一联表核对四个 client 的凭据链，全部通过才 COMMIT；`--rollback` 删除 enterprise 的行并校验既有三行与 pre-image 逐字一致（带 `--align-existing` 时还原它们的哈希）。
- 已在 Mac 临时 MySQL（规范 Console DDL）跑通：`plan` 不写、`apply`、重复 `apply` 被拒、`rollback`、既有行形态不符与前置状态不符被拒，以及 `--align-existing` 的应用与回滚。

### 17.4 启动顺序（`.env` 只在进程启动时读取）

- T-n 已把 `HZY_SERVICE_CLIENT_ENTERPRISE_SECRET` 写入 Runtime `.env`；B10b 启动的最小 Runtime 会读到它，但 B13 之后才有凭据行，故 B10b 不受影响。若后续再往 `.env` 追加变量（方案 B 的三个），**必须在 B14 启动前**追加，或追加后重启一次 Runtime；B10b 的最小 Runtime 在 B12 前会停止，B14 才用最终配置重新启动，所以只要在 B14 启动前写好即可，无需额外重启。

### 17.5 方案 B 已批准（用户“同意”），四个 env_ref 密钥均已预置（唯一事实，2026-09-30）

- 用户批准方案 B：新机为 env_ref 客户端预置新密钥；B13 用 `--align-existing` 把既有行的 `content_hash` 改为变量名哈希的规范形态，写前保存 pre-image 以便回滚。用户随后确认 Aims 进程在 10-02 仍运行（负责集成操作投递与定时任务），故 **aims 也已预置**。
- 已执行（新机 root，`t-n-env-ref-secrets.py`，不打印；写前备份；两侧 `sha256[:12]` 回读一致；权限属主不变；`/etc` manifest 基线随之更新，回读 diff 为空）：
  | 应用 | 备份目录 | 指纹 |
  | --- | --- | --- |
  | enterprise | `/root/.hzy-a5/envref-backup-20260930T000432Z` | `66f34ea29f0d` |
  | codocs、workflow | `/root/.hzy-a5/envref-backup-20260930T000913Z` | `5eb7aa5de4e2`、`68f63ba1a967` |
  | aims | `/root/.hzy-a5/envref-backup-20260930T001110Z` | `5a6a712bb42e` |
  Runtime `.env` 现有四个变量（enterprise、codocs、workflow、aims），`/etc/hzy/*.env` 中不再有服务密钥的 `REPLACE_` 占位；`hzy-data-runtime` 仍 inactive。
- 说明：Aims 与 Codocs 并入 Enterprise 属切换之后的事，由后续 ADR-018a 补充，不影响这次切换；align SQL 保留 aims（B13b 按 3 行 align 加 enterprise 新行执行）。

## 18. P0：应用到 Console 的回环调用被剥掉 `/console` 前缀（2026-09-30，只读核实，需改代码，rc3 暂缓）

### 18.1 结论

- **env 是对的，缺陷在代码。** `HZY_SELF_HOSTED_SERVICE_ORIGINS_JSON`（A5 写入的五个回环 origin）本来就是为服务端内部调用设计的：设置后，Foundation 的服务绑定解析器返回回环传输（`selfHostedServiceTransport.ts`，行为等同 Cloudflare Service Binding：目标固定为本机 origin，**只取请求 URL 的 path 与 query**）。因此 `HZY_CONSOLE_API_URL`、`HZY_CONSOLE_TOKEN_URL`、`NUXT_HZY_SERVICE_CLIENT_TOKEN_URL`、各 `…_JWKS_URL` 等**保持公网 canonical 形式是正确的**（只用来提供 path）；OIDC issuer、浏览器重定向、documentUrl 同样必须保持公网 canonical。**不需要也不应该把这些 env 改成回环。**
- R3 看到的 `POST https://aidcp.wiztek.cn/console/oauth/token` 出自 `HZY_CONSOLE_TOKEN_URL` / `NUXT_HZY_SERVICE_CLIENT_TOKEN_URL`，日志里打印的是配置的 canonical URL，实际拨向回环；**失败原因是 Console 返回 302 “Found”**，不是访问了公网。
- **根因**：调用 Console 的所有路径（`consoleRuntime.ts:563`、`serviceOidc.ts:256/590`、`consoleOidc.ts:122/880`、`consoleServiceBinding.ts:128`）在拨号前都经 `normalizeConsoleServiceBindingUrl`，它把 `/console` 前缀**剥掉**（那是给 Cloudflare 上 base path 为 `/` 的 Console Worker 用的；`selfHostedServiceTransport.test.ts:98` 的用例也把它当作预期）。自托管的 Console 却以 `NUXT_APP_BASE_URL=/console/` 运行，收到没有 `/console` 的路径时，Nuxt 的 base 处理会**302 重定向**到带前缀的路径，而回环传输设置了 `redirect: 'manual'`，不跟随。
- **本机复现（只读，不触及任何环境）**：在 Mac 上用 `console-s4-rc1` 制品、`NUXT_APP_BASE_URL=/console/` 启动，请求 `/api/v1/console/runtime/apps/aims/config`、`/oauth/token`、`/api/health` **全部 302**，`Location` 为 `/console/…`；带前缀的同一路径全部 200。
- **后果**：应用取服务令牌（`/oauth/token`）与读 Console 运行配置全部失败，与 aidcp 是否为维护页无关；同类还包括 Codocs 服务 API 经回环向 Console 做令牌 introspection、`consoleOidc` 的 OIDC 交换。B17/B18 冒烟会整体失败，且这在 R3 应用层就已出现（当时被归入“入口未切换”，是误判，已更正）。
- **单点修复方案（代码，需你批准）**：让 `normalizeConsoleServiceBindingUrl` 只在真实的 Cloudflare Service Binding 下剥前缀；当 binding 来自自托管回环传输时保留 `/console`（即 `consoleServiceBinding()` 返回回环传输时，调用方不剥）。改动集中在 `foundation/server/utils/consoleServiceBinding.ts`（约 10 行），并更新 `selfHostedServiceTransport.test.ts:98`、补 `consoleRuntimeServiceBinding`、`serviceOidc`、`consoleOidc` 的自托管用例。因为 Foundation 是共享层，需要重建并重新打包全部五个 Nuxt 应用（Console、Enterprise、Workflow、Aims、Codocs）与网关，产生 **s4-rc2 应用制品**（Runtime 0.3.221 不变）。
- **无代码的替代（不推荐）**：把 Console 的 `NUXT_APP_BASE_URL` 改成 `/`，则公网路径 `/console/...` 需要网关剥前缀，与 issuer、回调、JWKS 等全部约定冲突。

### 18.2 对 B17/B18 判据的补充（无论用哪种修复）

- **维护页期间**（aidcp 仍返回 503，B19 才开放）：各应用（Enterprise、Workflow、Aims、Codocs）向 Console 取服务令牌成功、读 Console 运行配置成功（日志无 `Failed to fetch runtime config`、无 `Console service token request failed`）；Codocs 对入站服务令牌的 introspection 成功。这些调用全程走本机回环，不经 nginx 与 tailnet。

### 18.3 T-n 更新（用户答复：变更冻结不需要通知；B11 在场 10-02 东八区 21:10–22:05；回滚决策人为用户本人；值班人“用户本人 + 协调会话”；冷存档口径沿用执行单现有表述并并入 B11 冷存档复核）

- A17 第 7 项（变更冻结）关闭；第 9 项写为“回滚决策人：用户本人；值班：用户本人 + 协调会话”。
- 修正前 rc3 暂缓（用户已批准打 `self-hosted/s4-rc3` annotated tag，只推 GitLab，10-01 执行，届时核对 Go 工具源码与 rc2 相同、工具哈希不变，并记录 b13、a7b 等新增文件的哈希）。

### 18.4 修复已提交（`2e3d0199`，待协调会话审后在新机重建）

- **判断依据**：`normalizeConsoleServiceBindingUrl(url, binding)` 只在“binding 不是自托管回环传输”时剥 `/console`；回环传输由 `selfHostedServiceTransport.ts` 内部的 `WeakSet` 登记（`isSelfHostedLoopbackBinding()`），只有该模块创建的 binding 才在集合里，复制、展开、原型继承、自造 `{fetch}` 都不算，URL 与请求头无法影响。不传 binding 或传入 Cloudflare Service Binding、hzy0 本机传输时行为与以前逐字相同。
- **调用方排查（每一处）**：
  - 受影响并已修复（7 处 `normalizeConsoleServiceBindingUrl` 调用，全部传入 binding）：`consoleRuntime.ts`（读 Console 运行配置）、`serviceOidc.ts:256`（`fetchConsoleServiceJson`：Enterprise 权限快照 `platformBundleAuthorization`、运行时设置 `runtimeSettings`、主体资格/范围授权都经它）与 `:590`（服务令牌 `/oauth/token`）、`consoleOidc.ts:122`（Codocs 等的 `/oauth/introspect`）与 `:880`（JWKS 拉取）、`consoleServiceBinding.ts:134`（`consoleServiceFetch`：目录 API、通知、OIDC 令牌交换）。
  - 不受影响：`consoleOidc.ts:976`、`consoleSessionBridge.ts:99` 只用 binding 决定是否附带受信头，不拼 URL；`appServiceBinding.ts`（业务应用，默认不剥 `/{app}` 前缀，且无调用方以 Console 为目标）；`workflow/server/utils/dataRuntime.ts` 的回环用于 Runtime 拨号。
  - 租户网关（JS，自有前缀逻辑）：**受影响并已修复**——策略同步（`/api/internal/policy-bundle/sync`）、Console 排空唤醒（`/api/internal/integration-operations/drain`）、目录连接器代理（`/directory-connector/…`→Console 根路径）此前都以根路径拨 Console，会得到 302；现由 `HZY_CONSOLE_BASE_PATH`（自托管网关配置注入 `/console`，未设置则与 Cloudflare 行为逐字相同，取值严格校验）加前缀；调度签名覆盖的仍是逻辑路径，不变。浏览器流量（`proxyToConsole`）原样转发已带 `/console` 的路径，不变。备注：网关令牌 lane 的 `/oauth/token` 相等判断只在 `HZY_GATEWAY_ASSERTION_ENABLED` 启用时使用，自托管回环设计不经它，未改。
  - connector / notification（gitlab 主机）：走公网 canonical URL `https://aidcp.wiztek.cn/console/…`，经 nginx→网关→`proxyToConsole`，路径本就带 `/console`，不受影响。
- **测试**：foundation 全量 tsx 用例 807/807（含新增 `selfHostedConsolePrefix.test.ts` 7 例：normalize 规则、伪造 binding、Cloudflare 剥前缀对照、consoleServiceFetch/fetchConsoleServiceJson、runtime 配置、introspection、服务令牌；更新 `selfHostedServiceTransport.test.ts:98`）与 26 个 mjs 用例；变异测试（去掉保留分支）使其中 6 例失败。网关：自托管 51 例、Cloudflare 网关 55 例（新增 `HZY_CONSOLE_BASE_PATH` 取值矩阵与签名不变用例）、`validate:business-cloudflare` 与 `manage-tenant-gateway-release` 通过。foundation 与 console、enterprise、workflow、aims、codocs 六个 `nuxt typecheck` 全部通过；foundation lint 对本次改动文件无问题（`authDependencyDiagnostic.ts`、`objectStorageVersion.ts` 有既有的 9 条风格错误，与本次无关，未动）。
- **制品级回归**：`deploy/self-hosted/test/console-prefix-loopback.e2e.mjs --app <应用制品目录>`：用真实 aims 制品（本机以修复后代码构建）加一个与真实 Console 同语义的替身（无前缀 302、`/console/oauth/token` 占位凭据 401 `invalid_client`、运行配置 200）：修复后 PASS（读配置与令牌请求均带 `/console`，无 302）；在变异代码上重新构建后 FAIL（4 条无前缀 302）。
- **下一步（审后）**：新机用 hzy-build 从新提交重建五个应用与网关，no-op restart 安装，回读并更新 manifest；在新制品上重跑上述 e2e；最后打 `self-hosted/s4-rc3`（含修复、b13、a7b）。

## 19. rc3：应用与网关重建、安装与标签（2026-09-30，已完成）

- **标签**：annotated `self-hosted/s4-rc3`（tag 对象 `320da29b…`）→ 提交 `2d8f533cbf944f9592c4d418bd40c61d87c6a11b`，只推 GitLab。内容 = rc2 + Foundation 回环 `/console` 前缀修复（`2e3d0199`）+ 自托管网关 `HZY_CONSOLE_BASE_PATH` + Enterprise Tailwind 源扫描修复（`2d8f533c`）+ B13/a7b 工具与 SQL。Runtime 0.3.221 与 Go 源码不变：`git diff s4-rc2..s4-rc3 -- data-runtime` 为 0 个文件，且在新机用同一编译参数从 rc3 源码重编五个 K2 工具，sha256 与 rc2 构建**逐个相同**。
- **新机构建**（`hzy-build`，离线 store，`node build.mjs --commit 2d8f533c… --version s4-rc3`，约 11 分钟）：`/home/hzy/build/out-rc3`，`index.json` 记录 commit 与 node v24.18.0。教训（写入 A3 操作备忘）：构建必须设置 `TMPDIR=/home/hzy/build/tmp`（与 pnpm store 同一文件系统）；否则工作树落在 `/tmp`，pnpm 选另一个 store，离线安装报 `ERR_PNPM_NO_OFFLINE_TARBALL`（本次因此走了几次多余的 fetch/store add，均只影响 `hzy-build` 自己的 store 与源码目录）。
- **包哈希（sha256）**：console `32e517e162f24657e19bd927a4227ee97a2f1eefbc1d50b19cff4ca3e6c8c074`；enterprise `7d5d336082f6f1298b49e521f23abaff9b3bd34363ccb4546f66a1201f2b68f0`；workflow `8592d82c372a9c3f79cb3d8741c1c04b52cbe76f4a17e0a69e96f3985b8fa315`；aims `e603650ebea4ab2e5179b6b3fc21d9df7037ecc765b7c8088a5a2f6cd6de4b12`；codocs `85cbfa4bbb7cb05f7dcf648b132711c521f8f494cad131f1d3edb7a2f6ac6ccd`；gateway `2b7774bcd8271682a4dbabfbb2c8bc0ba0ba767d10655c797c7d004ff3604c45`。
- **安装（无操作 restart）**：`/root/.hzy-a5/publish-nostart-rc3.mjs` 调 `publishIndex`（不重启、不探活）发布六个包到 `/home/hzy/apps/<app>/releases/s4-rc3`，属主改 root 并 `go-w`，`verify.mjs` 逐包通过，六个 `current` 均指向 `releases/s4-rc3`，`s4-rc1` 保留可回退。全部服务 inactive/disabled，`hzy-data-runtime` inactive，`/etc` manifest 与基线无差异。
- **验收**：① Enterprise CSS 含 `.sm\:w-60`、`.sm\:w-72`、`.lg\:grid-cols-[18rem_minmax(0,1fr)]`（26 个 CSS 文件中命中），同一检查在 rc1 制品上全部为否；② `console-prefix-loopback.e2e.mjs` 在新机对 rc3 aims 制品 PASS（`GET /console/api/v1/console/runtime/apps/aims/config`→200，`POST /console/oauth/token`→401 `invalid_client`，无无前缀 302）。
- **新增文件哈希（rc3 检出）**：`a7b-prod-console-login-wecom.sql` `814d6f2b…6893`、`…rollback.sql` `65d9a6cf…3b83`；`b13-enterprise-runtime-env-ref-credential.sql` `574a5d19…64c6`、`…rollback.sql` `ff9b0a15…c993`、`b13-env-ref-content-hash-align.sql` `2bc94ed8…ee`、`b13-env-ref-credentials.mjs` `47a720d0…76d`、`t-n-env-ref-secrets.py` `9fd6c0c2…4c05`；`g7-prod-grants.mjs` `19cd8b17…3cba`（与 rc2 相同）。完整值见 §17.3 与 §15.1。
- **窗口内的使用约定**：应用与网关制品用 `s4-rc3`；K2 工具用 `/root/.hzy-s4-rc2/bin`（与 rc3 源码同哈希）；b13/a7b/g7 脚本从 rc3 检出（新机源码目录 `hzy-build` 的 `rc3-build2` 分支即 `2d8f533c`）。旧的 `2ee1339a` 构建产物已删除。

## 20. A17 预检清单（10-01，全部只读；10-02 白天再做 §20.7 的当日项）

判据：任一项不符 → 停下报告，不自行修复；修复另请批准。输出只记状态与哈希，不含密钥值。

### 20.1 冻结与制品（新机 + GitLab）
1. GitLab：`self-hosted/s4-rc3` 仍指向 `2d8f533cbf944f9592c4d418bd40c61d87c6a11b`（`git ls-remote`）；rc1、rc2 标签未变（`ce08d40e…`、`cb4418ca…`）。
2. 新机 `/home/hzy/apps/{console,enterprise,workflow,aims,codocs,gateway}`：`current -> releases/s4-rc3`，`verify.mjs` 逐包通过；`/home/hzy/build/out-rc3` 的六个 tar.gz sha256 与 §19 相同；`/home/hzy/tools` 与 `/root/.hzy-a5/tools.sha256` 一致。
3. K2 工具 `/root/.hzy-s4-rc2/bin`：`sha256sum -c SHA256SUMS`（五个二进制与 g7/SQL 文件）全 OK，权限 0500 root。**证据链按 rc3 记录**：该路径下的二进制与 rc3 源码（`2d8f533c`）在新机重编的二进制**逐字节相同**（§19，Go 源码自 rc2 起 0 个文件变化）；执行单里的命令路径保持 `/root/.hzy-s4-rc2/bin`，不另建 rc3 目录。
4. 窗口用 SQL/脚本（`a6-supplement-*`、`a7b-*`、`b13-*`、`t-n-env-ref-secrets.py`）在 rc3 检出中的哈希与 §15.1、§17.3、§19 记录一致；B13b 的“可执行”只对应这些哈希。

### 20.2 新机配置与服务状态
5. 所有服务 inactive/disabled：`hzy-{console,enterprise,workflow,aims,codocs}`、`hzy-tenant-gateway`、`hzy-data-runtime`、`hzy-data-runtime-update-request.path`、`hzy-data-runtime-update.timer`；没有 `hzy-r3-*` 单元；监听端口 31001–31005、31080、8780 无进程。
6. `/etc` manifest 与**当前**基线（文件 `/root/.hzy-r3/manifest.before`，58 行；已含 config 模板与 env_ref 密钥写入后的哈希，旧基线为 `manifest.before.pre-*`，不要用旧的）差异为空；`/etc/hzy-data-runtime/config.json` 仍是模板（0600 `hzy-runtime:hzy`，含 3 处 `REPLACE_AT_B10B_*`）。
7. env_ref 密钥：Runtime `.env` 有 4 个 `HZY_SERVICE_CLIENT_*_SECRET`；对应应用 env 中无 `REPLACE_` 服务密钥占位；四对指纹（sha256 前 12 位）仍为 enterprise `66f34ea29f0d`、codocs `5eb7aa5de4e2`、workflow `68f63ba1a967`、aims `5a6a712bb42e`（不打印值）。列出 `/etc/hzy/*.env` 中**仍带 `REPLACE_` 的键名**（应只剩 B14 才填的项，如 OIDC secret、Platform 令牌），与执行单 §10 来源表核对。
8. Vault 主密钥指纹 `sha256:3b1b0e37c78e516dd17853b1cb895687`，0600 `hzy-runtime:hzy`。
8b. **生产 cutover profile（P0-C，已创建）**：`/root/.hzy-s4/profile/S4-PROD-cutover-profile.json`（0600 root，目录 0700），sha256 `8d31ead954b73adab49d883adb9966d6373a8e957751914477c9221e2dc28925`；用 `cutoverprofile.Load` 校验通过并逐项回读：`version=enterprise-cutover-profile.v1`、`environment=prod`、`runtimeDeployment=c000001-prod-tenant-runtime`、`enterpriseDeployment=C000001-prod-enterprise`、`sourceDeployments={aims:C000001-aims, assets:C000001-assets}`、`instanceId=1e3c34dd-bb9b-11f1-bf6b-000c293f1086`（等于新机 `@@server_uuid`）、`schemaVersion=enterprise.v1`、`generation=1`、`sourceAims=hzy_aims_src`、`sourceAssets=hzy_assets_src`、`target=hzy_enterprise`、`cutoverKey=s4-C000001-prod-20261002`（B0 按实际窗口日期定稿；日期变了就重新生成并重跑 Load）、`kid=psk_20260718_AElQdK3VQSja`；钉住的公钥（32 字节）与 Platform 库中活动签名密钥的原始公钥逐字一致（`AJpz_Z7sSibKPA2deR_5r0BVMVYxMtqkQjo-Wy1Cz_w`，PEM 指纹前缀 `00495074add54128`），其 sha256 前 16 位 `c25b32389c0ccf10` 与 R3 认可里的 `platformKeyFingerprint` 开头相同。预检重做 Load 与哈希比对；连接口令仅在该 0600 文件中，K2 工具的 `--artifact` 与日志不含口令（预检 `grep -c` 各 artifact 为 0）。
8c. **Runtime 配置渲染演练（P1-7）**：不启动 Runtime，`render-runtime-config.py --stage b10b --out /root/.hzy-s4/rehearsal-b10b.json` 后 `--check`，再删除该文件；确认口令来自 `/etc/hzy/mysql/hzy_rt_console.cnf`、bindings 来自 `.env`，无秘密经 argv。
8d. **`aidcp-runtime.wiztek.cn` 无解析**：从 gitlab 主机 `getent hosts aidcp-runtime.wiztek.cn` 应无结果（见 §21.2）。
8d2. **抓取旧 Console 的 JWKS kid 集合**（公开 GET，写入 `expected-kids.txt`，供 B17b 的 s4-smoke 比对）。
8e. **`.env` 占位说明（P2-7）**：Runtime `.env` 里安装占位的 `HZY_DATA_RUNTIME_DB_USER=cf_app`（空口令）不会用于业务连接：B10b 探针已证明启用 console 并在 `config.json` 指定库时启动成功；预检只核对 B14 之后 Runtime 使用的是 `config.json` 里的库账号，不改 `.env`。
8f. **B13c 输入复核（协调会话审定，2026-09-30）**：只读确认生产 `auth_client_redirect_uris` 旧域行仍为 18 条，其中 `wiztek.huizhi.yun` 下 console、aims、workflow 各 2 条（共 6 条 derived）；不符则停下并重新审。窗口内 B13c 先以 `@apply=0` 跑 plan，10 行输出须与 §B13c 清单逐字一致，一致后才 `@apply=1` 并回读；SQL 文件哈希须为 `d4545722…41f7`（回滚 `6799deb1…7d77`），文件有任何改动都要重新审。
8a. **排空 HMAC 现状（失败关闭）**：gitlab 主机 `/root/hzy-drain-cred/active/offline-drain-hmac` **不存在**（目录 `/root/hzy-drain-cred` 已随演练清理移除，B10d 第 1 步重建）；新机 `/root/.hzy-drain-cred/` 不存在（演练目录已 shred 并 rmdir）；`hzy-platform-dev` 的进程环境仍含 `CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active`（只核对键名与值路径）；执行单存在 B10d（生成、分发、比对指纹，约 6–8 分钟，位于 B10c 与 B11 之间）与 B20 的销毁步骤。

### 20.3 新机数据库与账号
9. MySQL 运行正常；数据库中**无**任何业务 `hzy_*`、`s3r*` 库（**实测更正**：新机上存在 `hzy_platform`，85 张表，2026-09-30 01:12 CST 由 G-9 P1 从日本 Platform 库独立克隆而来，无进程使用，与 B5 的 9 个正式库名无冲突，建议 C3 清理；原“hzy_platform 是日本库，不在新机”不准确），`information_schema` 无 `s3r` 授权残留。
10. 账号授权与清理后哈希一致（`/root/.hzy-r3/grants-prod-named.post`）：`hzy_migrator` 仍 locked；`hzy_rt_enterprise` 含 `SHOW VIEW ON hzy_enterprise`；`hzy_cutover` **无**对 `hzy_console/codocs/finance/people` 的授权（B10c 才加）；`hzy_backup` 只读。
11. 磁盘与内存：`/home`、MySQL 数据目录剩余空间足够容纳 9 库恢复（约 1 GB 级别）与加密备份；内存充足；`/var/lib/mysql` 所在盘无告警。
12. 每日加密备份定时器（02:30）与 gitlab 拉取定时器（03:30）最近一次均成功；备份口令文件在位（`/etc/hzy/backup/backup.pass`，只核对存在与权限）。

### 20.4 入口、网络与时钟
13. `https://aidcp.wiztek.cn` 返回 503 维护页，证书剩余有效期充足（到 2026-12-28）；`hzy.wiztek.cn` 200；gitlab nginx 配置无未提交变更（对比 A9 备份）。
14. 新机 8780 未监听；防火墙规则仍为“仅 gitlab 主机可达 8780/8782”；tailnet 两端在线，记录 gitlab↔新机链路是直连还是 DERP（影响 B3–B4 的拉取耗时，预估 9 分钟）。
15. 三台主机（日本机、新机、gitlab 主机）时钟同步（`chronyc tracking`/`timedatectl`），偏差 < 1 秒；记录各自时区，窗口时间统一按 UTC 与东八区双写。
16. 用户 Mac 剩余磁盘空间（当前约 3 GB）：窗口内 Mac 只做 ssh 中转与小文件，确认无大文件落盘需求；SSH 密钥登录日本机、新机、gitlab 主机均正常。

### 20.5 日本机（旧生产，只读）
17. `hzy-data-runtime` 与 `hzy-data-runtime-directory` 仍 active；MySQL 连接数、磁盘、负载正常；`SHOW PROCESSLIST` 只见 Runtime 主进程；`hzy_dump` 只读账号可用；旧入口 `wiztek.huizhi.yun` 可达。
18. 记录 B2 基线用的九库行数与 `CHECKSUM TABLE` 基线时间（与窗口内两轮比较用；预检值仅作参考，因为窗口前仍有业务写入）。

### 20.6 Platform、Keycloak、connector（只读）
19. Platform（`hzy-platform-dev` PM2）健康；`tenants.settings_json` 中 C000001 的 prod `consoleLogin` 仍为 a7b 写入值、test 有效 consoleLogin 哈希 `87105a2076d6e79d` 不变、`deployment_sites` 未变；prod 实例状态与最近心跳；尚无 prod 策略包（W11 未做）；`HZY_DRAIN_CONTROL_TOKEN` 分离状态与 A12 记录一致。
20. Keycloak：`https://sso.wiztek.cn/realms/wiztek/.well-known/openid-configuration` 200；客户端 `hzy_aidcp` 存在且仅登记 aidcp 回调与 post-logout（协调会话已核对，预检只复核公开元数据）。
21. gitlab 主机 connector：`hzy-connector-runtime` 与 update timer 均 active/enabled；`.env` 中 5 个待改键当前仍指向旧 Console（只核对主机名，不打印值）；日本库 `connector_runtime_instances.last_heartbeat_at` 在 2 分钟内；连接器身份文件哈希与 §10 记录一致。

### 20.7 10-02 白天的当日项
22. 当日 Platform 加密备份（`pd_backup`）完成，并在新机核验可解密（记录 sha256）；共享 Platform 上 test 租户仍在心跳，无人在改 Cloudflare/旧主机（用户已确认无变更冻结通知需要）。
23. 重跑 20.1、20.2 的第 5–6 项（服务状态与 manifest），确认自 10-01 起无漂移；确认 B11 用户在场（东八区 21:10–22:05）、回滚决策人（用户本人）、值班（用户本人 + 协调会话）。
24. 最终 Go/No-Go（A17 检查表 13 项，第 10 项已取消）。

**产出**：`docs` 中追加“A17 预检记录”，逐项 PASS/FAIL 与证据（哈希、计数、时间戳，不含秘密）。

## 21. 独立复审（Fable）处理记录与新增工具（2026-09-30）

### 21.1 处理结果一览
| 项 | 处理 |
| --- | --- |
| P0-A 入口 B19 才开放，B14–B18 经入口的功能走不通 | **用户已决定（2026-09-30）：nginx 来源白名单直通**（原文“方案 2”）；新增 B12b，connector 改指与登录冒烟在 B17b/B18 执行。需窗口内逐项批准 |
| P0-B B14 判据超前于 Console | 已拆分：B14 只留 Runtime 自身可验证的项，令牌/JWKS/登录/connector 移到新增的 B17b，并作为 B18 前置 |
| P0-C 生产 cutover profile 无创建记录 | 已创建并校验，见 §20 第 8b 项与 §21.5 |
| P1-1 最终 config 与 B10b 的切换 | 新增 B10e（渲染最终配置、不启动），B14 原子替换，B12 用 root 副本 |
| P1-2 LDAP 目录连接器归属 | **用户已决定（2026-09-30）：不迁移，切换后停用 LDAP 同步与自助改密**（§21.2、C4） |
| P1-3 aims 密钥事实 | §17.5 已改为唯一事实：已预置，指纹 `5a6a712bb42e` |
| P1-4 OIDC 回调无受审 SQL | 新增 B13c 与 `b13-oidc-redirect-uris.sql`（及回滚、测试） |
| P1-5 `aidcp-runtime.wiztek.cn` 谁会拨号 | 只读结论见 §21.2 |
| P1-6 B3/B4 导出路径 | 定为日本机本地导出，见 B4 段落末尾 |
| P1-7 B10b 口令与 bindings | 新增 `render-runtime-config.py`（口令来自 `/etc/hzy/mysql/*.cnf`，bindings 来自 `.env`，无 argv 秘密）与自测；10-01 演练见 §20 第 8c 项 |
| P1-8 时间线 | B10d 计入；B11 用户在场改为东八区约 21:10–22:05（ADT 10:10–11:05） |
| P1-9 `hzy_migrator` 时点 | 见 §21.3 |
| P2-1…P2-9 | C2 重写（含 Keycloak、a7/a7b、`hzy-platform-prod`）；B10c 撤销列入 B20；GitLab 凭据随库恢复（B14）；B18 前缀 `CLAUDE-FIXTURE-S4-` 与清理；`db.json` 销毁（B13b）；connector 更新源风险保留（见下）；profile 口令与 artifact 检查（§20 8b）；`.env` 占位（§20 8e）；manifest 基线文件名（§20 第 6 项）；令牌探测口径统一为 R3 的 34 项；B17 注明 aims scheduler-only 开关 |

**connector 自动更新源（P2-5）**：用户已知悉并接受 connector 会从 `downloads.huizhi.yun` 的 latest 自动更新。补充：旧 Cloudflare 站点下线（C4）之前，先把 `HZY_CONNECTOR_RUNTIME_PACKAGE_BASE_URL` 改到新的下载源，否则 update timer 会持续报错。

### 21.2 两项待用户决定，以及两项只读结论
1. **P0-A（用户已决定采用白名单直通，见 B12b）**：回读判据：B17 后从 gitlab 主机 `curl -H 'Host: aidcp.wiztek.cn' https://127.0.0.1/console/.well-known/jwks.json` 返回 200，公网来源仍 503；回滚为还原改前备份的 vhost。
2. **P1-2 LDAP 目录连接器（待决），只读现状**：
   - 旧生产 `directory.ldap` 集成 active（`ldaps://ldap.wiztek.cn:636`，OpenLDAP，`syncIntervalSeconds=300`，连通性 healthy，最后检查 2026-07-21）；日本机 `hzy-data-runtime-directory` 正在运行，连接器 `directory-connector.C000001-console` 状态 active，`last_seen_at` 2026-09-30（说明它在轮询命令，进程活着）。
   - **但最近没有 LDAP 同步**：`directory_sync_jobs` 中 ldap 共 214 个作业，其中 76 个成功，全部发生在 2026-07（207 次尝试，70 成功）与 2026-08-27 当天的 6 次手动同步；此后到 2026-09-30 **一个都没有**。日本机连接器近 3 天日志为空。9 月的登录事件全是 `sso_oidc`、`wecom`、`dingtalk`，没有 LDAP 登录；LDAP 身份 68 个 active，最后更新 2026-09-10。没有查到自助改密的使用记录（未找到对应表，无法证实其是否被使用）。
   - **结论**：LDAP 同步与自助改密在生产**近一个月没有被实际使用**；切换后它们不可用，属于功能静默丢失，是否接受由用户决定。
   - **如果要保留（方案）**：在新机启用 `directory-connector` 单元，沿用日本机身份文件（`directory-connector-private.pem` 与 `state-cache.json`，A14 同款用户本机管道；连接器 ID 不变，所以不需要重新 enrollment）；需要：Runtime 配置里 `apps.directory` 已启用（B10b 已有）且 `.env` 设 `HZY_DIRECTORY_CONNECTOR_ENABLED=true`；`directory.env` 指向新机 Runtime 回环（`HZY_DIRECTORY_CONNECTOR_RUNTIME_URL`）；`ldap.wiztek.cn:636` 连通性——**只读实测：新机到 `ldap.wiztek.cn:636`（101.132.171.143）TCP 可达**；单元安装与 systemd 文件（`install.sh` 是否随 Runtime 包提供 directory 单元需在 A4 包内确认）；回滚为停新机单元、启日本机单元。列入 B14，C2 第 2 行相应扩展。
   - **用户已决定（2026-09-30）：接受停用，不迁移**；A10/B14/C2/C4 已统一写成“LDAP 连接器不迁移，切换后停用 LDAP 同步与自助改密”，A16 口径同步说明。
3. **P1-5（只读结论）`aidcp-runtime.wiztek.cn` 谁会拨号**：Platform 侧只有四个端点会按 `tenant_runtime_instances.runtime_endpoint` 拨号：`console-vault-migration`、`console-oidc-signing-bootstrap`、`v1/runtime/cutover-activation`、`recovery-route`；**S4 一个都不用**（Vault 主密钥走 A14 用户管道，OIDC 签名密钥随库恢复，排空走离线外部认可 + 本机 Go 激活，无需恢复路由）。`tenant-gateway/resolve` 与心跳只把该值当数据返回或比较，不拨号；应用与 Console 对 Runtime 的拨号由 `HZY_SELF_HOSTED_RUNTIME_ENDPOINT → DIAL_ORIGIN` 回环映射覆盖（A5 env 已设）。**处理**：不给该域名做公网/内网解析（拨到它会解析失败并失败关闭，这比悄悄拨错更安全）；红线增加“不得调用上述四个 Platform 端点”；预检（§20）新增：从 gitlab 主机 `getent hosts aidcp-runtime.wiztek.cn` 应无结果。

### 21.3 `hzy_migrator` 解锁/重锁时点（单一窗口）
| 时点 | 动作 | 回读 |
| --- | --- | --- |
| B5 开始前 | 解锁一次（列入 B5 批准） | `account_locked='N'` |
| B5–B6、B13、B13b、B13c | 使用；B6 不重锁 | — |
| B13c 完成后（含 db.json 销毁） | 重锁 | `account_locked='Y'` |
| B20 | 复核仍为 locked | `Y` |
| 回滚（C2 第 6 步） | 复核并重锁 | `Y` |

### 21.4 新增文件与哈希（sha256）
| 文件 | sha256 |
| --- | --- |
| `b13/b13-oidc-redirect-uris.sql` | `d4545722ced21e5700a2147ffb4ef48294fac578c47e973c16ce9ffb58c241f7` |
| `b13/b13-oidc-redirect-uris.rollback.sql` | `6799deb1f206507c3fe55fa9543b49096b64591015f00c378a925ed051137d77` |
| `render-runtime-config.py` | `ff7e26c598c097fd087bd7adcb61cee0ffb55e3675652eff212e6ae48b05ef78` |
| `mk-binding-candidate.py` | `c52cd986121b0331eb6a27f0238dd21af16fdf705a2eec17a6b3b52786cfc7ce` |
| `smoke/s4-smoke.mjs` | `fd33fc0e1f975ec53a2bd4de3781d7bc99b953a6e04d712f49c8ace0ca36e1ef` |
| `b12b/aidcp.allowlist.conf.tmpl` | `048347a9192db73827a11c9b3fcb865cfc73d318d9ae3ff90b69ae18459341d6` |
| `b12b/aidcp.open.conf` | `131b1e47d1cab29187029ef96d9c65ea0776e58a15584778d39aa755b55aa04a` |
| `b12b/test-aidcp-nginx.sh` | `f0e65ffbc3c7cdb168abea4470c7b8cc3412cf3c90a09f5f499f27ade145ae9f` |

以上文件在 rc3 之后提交，属窗口用材料；rc3 标签保持不动。窗口内以这些哈希为准（另需协调会话对新增 SQL 的审阅结论，见对应消息）。`render-runtime-config.py`、`mk-binding-candidate.py`、`s4-smoke.mjs` 的自测：`render-runtime-config.selftest.py`、`s4-smoke.selftest.mjs`（均在 Mac 通过）；`mk-binding-candidate.py` 在新机对 R3 的 K2 计划验证，得到与 R3 候选逐表相同的映射（aims 116、assets 37）。

### 21.5 生产 cutover profile 创建记录（P0-C，A12 第④项，已批准，2026-09-30）
- 位置与保护：`/root/.hzy-s4/profile/S4-PROD-cutover-profile.json`，目录 0700、文件 0600，root；sha256 `8d31ead954b73adab49d883adb9966d6373a8e957751914477c9221e2dc28925`。
- 内容与校验：见 §20 第 8b 项；`cutoverprofile.Load` 通过；`connection` 段是 `hzy_cutover`（口令取自 `/etc/hzy/mysql/hzy_cutover.cnf`，只存在于该 0600 文件）。
- 依据：Platform 活动签名密钥 `psk_20260718_AElQdK3VQSja` 的原始公钥（只读从 Platform 库计算）与 R3 用的相同，deployments 表读回 `C000001-aims`(4)、`C000001-assets`(7)、`C000001-prod-enterprise`(21) 为 active。
- 注意：`cutoverKey` 的日期部分（`20261002`）在 B0 定稿；窗口日期改变必须重新生成 profile 并重做 Load 与哈希记录。

## 22. A17 预检记录（2026-09-30 21:10–21:35 CST，全部只读；协调会话要求提前开窗）

结论：**24 项中除下列“需注意”外全部 PASS，无阻断项。** 输出只含状态与哈希，不含密钥值。

| # | 项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 标签 | PASS | `git ls-remote`：rc1 → `ce08d40e…`，rc2 → `cb4418ca…`，rc3 → `2d8f533c…` |
| 2 | 应用与包 | PASS | 六个 `current -> releases/s4-rc3`；`out-rc3` 六个 tar.gz sha256 与 §19 逐个相同；`/home/hzy/tools` 与 `tools.sha256` 逐项 OK |
| 3 | K2 工具 | PASS | 五个二进制 `sha256sum -c` 全 OK，权限 0500 root；另外 7 个 SQL/脚本文件与 SHA256SUMS 相同（用 `git show rc3-build2:<path>` 逐个比对，`rc3-build2` = `2d8f533c`） |
| 4 | 窗口 SQL/脚本 | PASS | a7b `814d6f2b`、b13 SQL `574a5d19`、`b13-env-ref-credentials.mjs` `47a720d0`、`t-n-env-ref-secrets.py` `9fd6c0c2` 与记录一致；B13c `d4545722…41f7` 在 Mac 检出（GitLab `860f9a09` 之后） |
| 5 | 服务状态 | PASS | 九个单元 inactive/disabled（`hzy-data-runtime-update.timer` 不存在）；无 `hzy-r3-*` 单元；31001–31005/31080/8780 无监听 |
| 6 | manifest 与配置模板 | PASS | 40 个文件/目录条目权限、属主、大小、sha256 与 `manifest.before` 逐项相同；单元启用状态、监听套接字相同；`config.json` 0600 `hzy-runtime:hzy` 1469 字节，含 3 处 `REPLACE_AT_B10B_*` |
| 7 | env_ref 密钥 | PASS | Runtime `.env` 4 个 `HZY_SERVICE_CLIENT_*_SECRET`；指纹 enterprise `66f34ea29f0d`、codocs `5eb7aa5de4e2`、workflow `68f63ba1a967`、aims `5a6a712bb42e`，应用侧同值；`/etc/hzy/*.env` 与 `.env` 里没有任何 `=REPLACE_` 键 |
| 8 | Vault 主密钥 | PASS | 指纹 `sha256:3b1b0e37c78e516dd17853b1cb895687`，0600 `hzy-runtime:hzy` |
| 8a | 排空 HMAC 现状 | PASS | gitlab `/root/hzy-drain-cred` 不存在；Platform 进程 `CREDENTIALS_DIRECTORY=/root/hzy-drain-cred/active`（仅路径）；`HZY_DRAIN_CONTROL_TOKEN` 存在于进程环境（仅键名） |
| 8b | 生产 profile | PASS | sha256 `8d31ead9…8925` 未变；`cutoverprofile.Load` OK，字段与 §20 8b 相同，`pinnedKeySha256_16=c25b32389c0ccf10`，`cutoverKey=s4-C000001-prod-20261002`（提前开窗需改为 `…20260930`，见 §23） |
| 8c | 渲染演练 | PASS | `render-runtime-config.py --stage b10b` 渲染并 `--check` 通过（0600 `hzy-runtime:hzy`，`problems=[]`），与模板相比只多 `deploymentBindings` 六项，已删除演练文件；口令来自 `/etc/hzy/mysql/*.cnf`，无 argv 秘密 |
| 8d | `aidcp-runtime.wiztek.cn` | PASS | 新机与 gitlab 主机 `getent hosts` 均无结果 |
| 8d2 | 旧 Console JWKS kid | PASS | 14 个 kid（`csk_20260429…` 至 `csk_20260718…`）写入新机 `/root/.hzy-s4/expected-kids.txt`（0600），sha256 前 16 位 `371a148d2de8e254` |
| 8e | `.env` 占位 | PASS | 无变化；B14 后使用 `config.json` 的库账号 |
| 8f | B13c 输入 | PASS（附修正） | 生产 `auth_client_redirect_uris` 共 130 行；`https://wiztek.huizhi.yun/%` 下 active 恰 18 行，console/aims/workflow 各 2 条，与 plan 的 6 条 derived 相同；**修正**：其余 12 行是 altoc/assets/codocs/finance/people/webdev 各 2 条，codocs 的两条与 explicit 值逐字相同；`aidcp` 行 0 |
| 9 | 新机数据库 | PASS（附更正） | 无 `s3r*` 库与授权残留；业务 `hzy_*` 库为 0；**发现**：新机有 `hzy_platform`（85 表，G-9 P1 克隆，2026-09-30 01:12 CST，无进程使用），已更正第 9 项口径，建议 C3 清理 |
| 10 | 账号授权 | PASS | 七个账号的授权哈希与 `grants-prod-named.post` 逐个相同；`hzy_migrator` locked；`hzy_rt_enterprise` 含 `SHOW VIEW ON hzy_enterprise`；`hzy_cutover` 只有 `hzy_aims_src/hzy_assets_src/hzy_enterprise` 授权；`hzy_backup` 只读 |
| 11 | 磁盘内存 | PASS | 新机 `/home` 386 GB 可用（MySQL datadir `/home/mysql/data/`），内存可用 10.7 GB；**注意**：日本机 `/` 使用 93%，可用 5.4 GB，B3 导出产物约 28.6 MB，足够，但不要在日本机上做别的大文件操作 |
| 12 | 备份定时器 | PASS（附注） | 新机 `hzy-backup.timer` 最近一次 2026-09-30 02:30 成功，备份口令 0600 root；gitlab `hzy-s4-backup-pull.timer` 已启用，**尚未触发过**（首次 2026-10-01 03:30），不影响窗口；`hzy-platform-dev-backup.timer` 最近一次 02:41 |
| 13 | 入口 | PASS | `aidcp` 返回 503 维护页；证书到 2026-12-28 19:30 GMT；`hzy.wiztek.cn` 200；gitlab `aidcp` vhost 与 A9 备份的 `aidcp.conf.final` 逐字相同（sha256 前 16 位 `211da068e45a9764`） |
| 14 | 网络 | PASS | 新机 8780 无监听；防火墙 `hzy-tailnet` 只有 `100.98.120.65` 的 8780/8782；`tailscale ping` gitlab ↔ 新机**直连**（经 `8.130.81.31:41641`，24 ms），不走 DERP，B4 拉取预计更快 |
| 15 | 时钟 | PASS | 三台主机均 Asia/Shanghai，同步 yes，偏差 <1 ms（日本机 0.17 ms、新机 0.21 ms、gitlab 0.90 ms） |
| 16 | Mac | PASS | 可用 76 GiB；三台主机 SSH 密钥登录正常 |
| 17 | 日本机 | PASS | `hzy-data-runtime`、`-directory`、update timer 与 request path 均 active/enabled；`hzy-connector-runtime`、`hzy-notification-runtime` inactive/disabled；只有 `hzy-data-runtime` 主进程持有库连接；`hzy_dump` 可用（TLS_AES_256_GCM_SHA384）；`wiztek.huizhi.yun` 200 |
| 18 | B2 基线参考 | 记录 | 九库估算行数（`information_schema`）：aims 5755、altoc 16903、assets 335、codocs 6950、console 1991676、finance 32171、people 1830、webdev 1274、workflow 361；窗口内以 `CHECKSUM TABLE` 两轮为准 |
| 19 | Platform | PASS | `hzy-platform-dev` online、`/api/health` ok；C000001 prod `consoleLogin` = `{mode:oidc, wecom:{corpid:wwe3597050c256d8e4, agentid:1000007}, enabledProviders:[oidc,wecom]}`；test 有效 consoleLogin 哈希 `87105a2076d6e79d` 不变；`deployment_sites`：prod `C000001-main` → `https://aidcp.wiztek.cn` active，test 两行；prod 实例 `ready`（最后心跳 09-29 22:57，R3 遗留，符合既有结论）；**prod 策略包 0 个**（W11 未做），test 27 active/3 superseded |
| 20 | Keycloak | PASS | discovery 200；客户端 `hzy_aidcp` 由协调会话已核对 |
| 21 | connector | PASS | gitlab 主机 `hzy-connector-runtime` 与 update timer 均 active/enabled；`.env` 五个键仍指向 `wiztek.huizhi.yun` / `wiztek-data-runtime.huizhi.yun`（只核对主机名）；日本库 `connector-runtime.C000001-console` 心跳 0 秒前；身份文件哈希前 16 位 `2bdbbff59822b4b3`、`280b5ab5982939fb` 与 §10 一致 |
| 22–24 | 当日项 | 待 | Platform 加密备份、重跑 5–6 项、Go/No-Go 在 Go 前一刻做（见 §23） |

**需注意（均不阻断）**：① 新机 `hzy_platform` 是 G-9 P1 克隆，含 Platform 生产数据，无进程使用，C3 清理；② 日本机根盘 93%；③ `hzy-s4-backup-pull.timer` 尚未运行过；④ 预检脚本的三处自身错误（清单里 `stat -h`、SHA256SUMS 需在检出目录运行、指纹用 `cut` 而非脚本同款解析）已在预检脚本中改正，不涉及环境。

## 23. 提前开窗（用户提议，2026-09-30 21:15 CST）：profile、批准分组与时间线

### 23.1 cutoverKey 与 profile
- 提前开窗需把 `cutoverKey` 从 `s4-C000001-prod-20261002` 改为 `s4-C000001-prod-20260930`（cutoverKey 只是唯一键，含日期便于识别；B11 的 Platform 认可与 K2 工具都用同一个值）。
- 重新生成：在新机把 `/root/.hzy-s4/profile/S4-PROD-cutover-profile.json` 的 `cutoverKey` 字段改写为新值（写前备份原文件到 `/root/.hzy-s4/profile/…pre-20260930`，0600），再跑 `cutoverprofile.Load` 与逐项回读（同 §22 8b），记录新哈希；估计 **3 分钟**。Go 后、B0 之前做（新机 `/root/.hzy-s4` 内一个小文件，可逆）。

### 23.2 当日 Platform 加密备份（第 22 项）
- 内容：`pd_backup.py` 对共享 Platform 库 `hzy_platform_dev` 做只读逻辑导出并加密，经现有转发命令送到新机 `/home/hzy-backup/platform-dev`，再在新机 `pd_verify.py --restore-test` 解密核验（临时库 `pd_verify_tmp`，用毕删除）。对 Platform 库只读，新增的是备份文件与一个临时库，属于“只读加备份”，按既有约定不需要批准；**建议在用户 Go 之后、B0 之前 5 分钟内做**，使备份接近窗口起点（今晚 02:41 的定时备份也在）。执行前我再通知协调会话。

### 23.3 批准分组（每组内逐项列出，用户按组回复“批准 Gx”；带 `<…>` 的哈希值只有到那一步才知道，仍需现场逐个确认）

**G1 停写组（B0–B2）**
- B0 开窗冻结（含 §23.1 profile 改 key、§23.2 Platform 备份）。
- B1：`批准 B1：由用户停用旧 Cloudflare Gateway；批准在日本机停止 hzy-data-runtime、hzy-data-runtime-directory、hzy-data-runtime-update.timer 与 hzy-data-runtime-update-request.path，并在 gitlab 主机停止 hzy-connector-runtime.service 与 hzy-connector-runtime-update.timer，均可逆。`
- B2 停写证据与冻结核验（只读，随 B1）。

**G2 导出、恢复与迁移组（B3–B6）**
- B3/B4：`批准 B3：在日本机创建临时 hzy_dump_s4@localhost、受限拉取公钥与 /root/.hzy-s3-jp 目录，本地导出九库加密产物，完成后立即清理并回读。`（B4 拉取、核验、清理随 B3）
- B5：`批准 B5：在新机创建 9 个正式库名并导入 B4 已核验产物；同时临时解锁 hzy_migrator。`
- B6：`批准 B6：在新机 9 个库副本上执行已审 SQL 升级链（含 Assets 三列补丁与 Codocs v2 schema，不启用任何开关）。`

**G3 K2 计划、视图与就绪组（B7–B10e，不含 B11）**
- B7 H0 计划（只读，用户当场确认 H0）。
- B8：`批准 B8：确认 H0=<…>，执行 install-fence/fence/prepare-final。`
- B9：`批准 B9：确认 H1=<…>，执行 migrate --apply。`
- B10：`批准 B10：确认 HV=<…>，安装兼容视图。`
- B10b：`批准 B10b：以最小配置启动并随后停止新机 Runtime，仅用于使 prod 实例经心跳转 ready。`
- B10c：hzy_cutover 对 provider 库临时授权（`a6-supplement-window-grants.sql`，B12 后撤销）。
- B10d：生产排空 HMAC 密钥在新机生成、经用户本机管道分发到 gitlab 主机、只比对指纹（B20 销毁）。
- B10e：渲染最终 Runtime 配置（不启动，`/etc/hzy-data-runtime` 内新增一个文件）。

**G3b B11（用户本人）**：`批准 B11：用户以自己的 Platform 会话导入证据并签发 cutoverKey=s4-C000001-prod-20260930 的排空认可，仅用于本窗口；批准在新机采集 provider 回执与封存证据。` 由用户在 Platform 页面亲手签发，签发前逐项阅读 `docs/Go-Live-Self-Hosted-S4-B11-Reviewer-Guide.md`。

**G4 激活、入口与授权组（B12–B13c）**
- B12：`批准 B12：确认认可哈希与 H1，执行 hzy-enterprise-drain 激活到 generation=1。`（其后撤销 B10c 授权）
- B12b：`批准 B12b：在 gitlab 主机 nginx 为 aidcp.wiztek.cn 增加来源白名单直通（白名单：8.130.81.31、127.0.0.1、<用户 IP>），nginx -t 后 reload，仅改该 vhost。`（用户告知当时公网 IP）
- B13：`批准 B13：在新机 hzy_console 执行 G-7 grant（plan/apply/verify，不含 collab.runtime）、B13b 的 env_ref 凭据行、B13c 的 OIDC 回调 SQL。`（B13b 仍需协调会话“可执行”，B13c SQL 哈希 `d4545722…41f7`，先 `@apply=0` 的 10 行 plan 与清单逐字一致才 `@apply=1`）

**G5 启动与冒烟组（B14–B18）**
- B14：`批准 B14：启动新机 Runtime 并绑定 hzy_enterprise/正式库，完成 Vault 只读解析探测。`
- B15：`批准 B15：（W10）`——Platform `scheduler-ownership` 登记 Aims（用户会话）。
- B16：`批准 B16：（W11）`——Platform 签发 prod 策略包（用户会话）。
- B17：`批准 B17：按序启动新机全部服务（仍不开放入口）。`
- B17b（connector 改指与心跳、令牌探测、登录冒烟）：在本组内，connector `.env` 五项改指有备份，回滚见 B17b。
- B18：冒烟与故障注入，带前缀 `CLAUDE-FIXTURE-S4-` 的测试数据写入正式库与 OSS，用毕清理；用户需用自己的浏览器登录/扫码并确认人工项（登录登出回调、登录页、管理页等）。

**G6 开放组（B19–B20）**
- B19：`批准 B19：切换 aidcp.wiztek.cn 到新机 Gateway 并开放员工。`（用户 Go 后）
- B20 收尾：销毁生产排空 HMAC 两端文件、`hzy_migrator` 重锁、会话 cookie 文件删除（随 B19）。

### 23.4 时间线（从 Go 起；东八区 CST 与用户所在的 ADT = CST − 13 小时对照；以下以 Go = 22:00 CST / 09:00 ADT 举例，实际按 Go 时刻平移）

| 阶段 | 内容 | 时长 | CST | ADT | 用户必须在场 |
| --- | --- | --- | --- | --- | --- |
| G1 | B0 冻结、profile 改 key、Platform 备份；B1 停旧 Gateway（用户在 Cloudflare 操作）；B2 证据（含 ≥5 分钟冻结间隔） | 约 35 分钟 | 22:00–22:35 | 09:00–09:35 | 在场：Cloudflare 操作、批准 B1 |
| G2 | B3–B4 导出拉取（直连，预计 <9 分钟）、B5 恢复、B6 迁移 | 约 20 分钟 | 22:35–22:55 | 09:35–09:55 | 在场批准 |
| G3 | B7–B10e：H0/H1/HV 三次哈希确认、视图、最小 Runtime、HMAC、渲染 | 约 20 分钟 | 22:55–23:15 | 09:55–10:15 | 在场：三次哈希确认 |
| G3b | **B11 用户签发认可**（含人工复核 5 类判定） | 20–30 分钟 | 23:15–23:45 | 10:15–10:45 | **必须本人操作，全程** |
| G4 | B12 激活、B12b 白名单（需用户当时公网 IP）、B13 授权与凭据写入 | 约 30 分钟 | 23:45–00:15 | 10:45–11:15 | 在场：告知公网 IP、批准 |
| G5 | B14 Runtime 启动；B15/B16 用户会话调用 Platform；B17 启动服务；B17b 就绪判据；B18 冒烟 | 约 100–120 分钟 | 00:15–02:15 | 11:15–13:15 | **B15/B16 必须本人；B17b/B18 需用户浏览器登录、扫码、确认人工项** |
| G6 | 用户 Go/No-Go 后 B19 开放；B20 收尾 | 约 25 分钟 | 02:15–02:40 | 13:15–13:40 | 在场：最终 Go 与观察开放后首批登录 |
| 合计 | | **约 4.7 小时**（脚本 3.1–3.8 小时 + 人工确认；含 4 小时预留已在其中） | 22:00–02:40（次日） | 09:00–13:40 | 全程在线 |

回滚决策人：用户本人；值班：用户本人 + 协调会话。B19 之前任何步骤失败都按 C2 回滚，旧系统在 B19 之前不受影响，日本机停写窗口内不可用（业务停机从 B1 起算）。

## 24. 窗口内 B17 修正 1–9 与 C4 遗留项（2026-09-30 至 10-01 CST，实际执行记录）

本节记录 S4 窗口内 B17（启动服务）阶段暴露并修复的问题，以及必须带入 C4 / 下一版本（rc5）的项。时间以新机 `/root/.hzy-r3/events.log` 为准。

### 24.1 红线（高优先级，C4 与本 Runbook 同时生效）

1. **rc5 之前不得轮换 OIDC 签名密钥。** 当前 Runtime 用静态 `jwksJson` 验证 Console 令牌（修正 6）；轮换后 Runtime 无法自动获得新 kid，全部服务令牌失败。
2. **Runtime 配置目录不得出现 `auth-jwt-trust.json`。** 该 overlay 存在时会清空静态 `jwksJson`（config.go）。本 Runbook 早先“新写 auth-jwt-trust.json”的步骤作废。
3. systemd `EnvironmentFile` 中含 `\n` 的 PEM 值**必须用双引号**（见 24.2 修正 8）。`deploy/self-hosted/env/*.env.example` 已改（`53bcdee8`）。

### 24.2 修正清单

| 修正 | 现象 / 根因 | 处理 |
| --- | --- | --- |
| 1–4 | Gateway 打包缺文件与符号链接入口检查；健康探针假设（aims/codocs/enterprise 无直连 health）；`Wants=` 会把应用一并拉起；`console.env` 需 managed-cloud 模式 | 见 §19 及 drop-in `b17-no-direct-health.conf`、`zz-b17-entry.conf` |
| 5 | Console 取策略令牌 `insufficient_scope`：`console.runtime` 的 `console:policy-bundle` 行只有 `{"source":"policy-bundle-install"}`，无 audience | `b17-console-policy-grants.sql`（4 行，`9ced1bf3`） |
| 6 | Runtime 无法验证 Console 令牌 | 静态 `jwksJson`（见 24.1） |
| 7 / 7b / 7d | Runtime 缺 `apps.console.policyEnvelope` 与 `gatewayExchangeEnabled`。`maxAgeMs`：`verifiedPolicyConfigured()` 允许到 `LongMaxAgeMS`=3600000，但写路径 `policyenvelope.Validate()` 非 test 仅允许 `MaxAgeMS`=300000（也是 Platform 签发租期）；从 hzy0（test，上限 93600000）抄来的值在 prod 无效 | 最终 `maxAgeMs=300000`；渲染脚本与 `--check` 已同步（`eaf115ee`、`22bec3b6`）。`gatewayExchangeEnabled` 仅启用 Runtime 侧对 Gateway 主体的令牌交换（`auth_gateway_exchange.go`），Gateway 身份校验仍然生效 |
| 7c | `hzy_console` 缺 `verified_policy_snapshots`（含 `renewal_state`/`renewal_attempted_at`）、`console_service_assertion_replay`、`gateway_service_assertion_replay` | 取自 rc4 tag 的迁移文件与 schema 逐字截取，执行文件在新机 `/root/.hzy-s4/b17-7c/`；**执行记录含一次偏差**：加密备份步骤密钥路径错误而脚本未 `set -e`，DDL 仍执行（纯新增空表），事后补做等价备份 `hzy_console.pre-7c-equivalent.sql.enc`。此后写操作脚本一律 `set -e` + 备份成功为硬前置 |
| 8 | systemd 对未加引号的值吞掉反斜杠，`\n` 变成字母 `n`，PEM 解码失败（`DECODER routines::unsupported`）；影响 `console.env` 与 `enterprise.env` 各 2 行 | 4 行加双引号；以 `/proc/<pid>/environ` + `createPublicKey` + DER 指纹与 Platform kid 公钥比对验证 |
| 9 | 生产 `console.runtime` 历史 grant 无 audience 事实（hzy0 已在 2026-09-26 做过 ADR-017 audience 事实迁移），`console:service-client:consume` 等全部 `insufficient_scope` | `b17-console-runtime-audience-facts.sql`（86 行，按 id CAS，含回滚与临时 MySQL 测试，`47a90a7d`）；排除 7 行（2453/9676/76763 无事实；54638787/8 旧表有 hzy0 无；69143051/2 与修正 5 的绑定行冲突，会触发 `service_grant_policy_conflict`） |

### 24.2b 修正 10、11 与 rc5 / rc6（2026-10-01 CST）

| 项 | 现象 / 根因 | 处理 |
| --- | --- | --- |
| 修正 10 | `hzy-codocs`、`hzy-enterprise` 启动崩溃 `uv_interface_addresses ... errno 97`：单元 `RestrictAddressFamilies` 未含 `AF_NETLINK`，`os.networkInterfaces()` 需要它 | 两个单元加 `zz-b17-netlink.conf`（先清空再设置含 `AF_NETLINK`），模板同步（`996fe6c1`）；aims/workflow 无崩溃证据暂不加，出现同样错误时按同一批准补 |
| 修正 11 | 渲染 final 阶段漏了 `apps.aims`/`apps.assets`：统一域的读写/调度挂载点是这两个适配器（`server.go` `ConfigureEnterpriseWrites`）。先用同一二进制、临时 config、不发心跳做启动探测，再写正式 config | aims/assets `enabled:true`，db=`hzy_rt_enterprise`→`hzy_enterprise`；渲染脚本与 `--check` 同步（`f5cf82bd`） |
| rc5（gateway） | Platform `tenant-gateway/resolve` 只有在实例下所有绑定 app 都 `schema_ready/active` 时才给出 Runtime endpoint；统一拓扑下 aims/assets 适配器的 `SchemaStatus` 按未加前缀的表名检查，而统一库里是 `aims_*`/`assets_*` 前缀表，所以永远 `schema_mismatch`，Platform 判 blocked，顶层 endpoint 为空，drain 失败 | Worker `withStaticDataRuntimeEndpoint`：仅自托管设置 `HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_ENDPOINT/_CODE` 时，在 registry 未给 endpoint 且 `status=ready`、`runtimeCode` 逐字匹配时补；registry 给的 endpoint 与静态值不一致则拒绝租户（`f66a2fdf`）。包同时补上缺失的 `collab-deployment.mjs`（`6aa3b89a`） |
| rc6（gateway） | 应用取服务令牌时把 Gateway 头原样转给 Console；Console（managed-cloud）在 `x-hzy-app-code` 非 console 时要从 `x-hzy-service-routes` 目录取 console 部署，目录只遍历 `APP_ROUTES`，没有 console → `verified_console_route_missing` 503 | 显式开关 `HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE`（仅自托管 `buildWorkerEnv` 设置）；条目仅在 registry 的 `apps.console` 显式带 `deploymentCode` 时追加，origin/basePath 取 Gateway 受信配置（`36138dc9`、`a263e04f`） |

**发布事实**：`self-hosted/s4-rc5` 曾被删除重打一次（重打前无人消费，属操作失误）；**自此标签一经推送即不可变，出问题只能往后打新号**（红线）。rc6 产物 `gateway-s4-rc6.tar.gz` sha256 `f7d5c699…9f71`，commit `a263e04f`，`verify.mjs` 通过；rc3 手工补的 `collab-deployment.mjs`/manifest 不再需要，`release.conf` 与 `zz-b17-entry.conf`（`--preserve-symlinks-main`）保留，rc3 目录保留用于回滚。

**门 b（2026-10-01 03:25:00 CST）**：`integration-drain` `ok:true`，3/3 唤醒 2xx，`failedTenants=0`；policy-sync 持续 ok；重启后 workflow/aims 日志 0 条令牌失败。门 a 口径：Runtime 侧授权 20/20、反例 3/3 拒绝；Console 签发阶段的 source binding 以真实调用路径为准（外部探测经 `/console` 路由被注入 console 部署上下文，与调用方部署不一致，按设计被拒）。

**C4 / 0.3.222 追加**：
- **高优先级**：compat 适配器 `SchemaStatus` 在统一模式下按 binding 解析物理表名（或 Platform 就绪判定对统一域豁免）；做完后可撤掉 Gateway 静态 endpoint 回退。
- `build.mjs` 不按 `--commit` 取代码（直接用当前工作区）：应在自己的临时 worktree 里检出；窗口内构建前手工 `git checkout --detach`。
- 后台无事件调用在 managed-cloud 下 Console policy 绑定失败（`verified_console_route_missing`），仅记录。
- 生产 `console.runtime` 高权限 grant（如 `vault-secret:reveal`、`service-client:grant`、`platform-lifecycle:execute`）经 audience 事实迁移恢复等价状态，日后收敛。
- 其它客户端约 350 行缺 audience 的旧 grant 暂不迁移（惰性）。

### 24.2c rc7、rc8、修正 12 与 connector 重指（2026-10-01 CST）

| 项 | 现象 / 根因 | 处理 |
| --- | --- | --- |
| rc7（gateway） | 用户浏览器测试期间 Gateway 每 10–20 秒崩溃重启：`Readable.toWeb(req.pipe(...))` 在上游提前应答（如 `POST /api/rum` 得 404、登出 POST）时对已关闭的 controller `enqueue`，未捕获异常杀死进程，全部用户断线。"登出后一直显示正在加载汇智云..." 是其直接后果 | 自管请求体 `ReadableStream`（逐字节计数含取消后排空，超限 413 + `connection: close` 后销毁，背压，不写已关闭 controller）；进程级 `uncaughtException`/`unhandledRejection` 仅记录 name/code 后退出（`29055f60`）。本地复现并加 5 项测试；重启后 `NRestarts` 保持 0 |
| 策略信封周期性过期 | Platform 非 test 签 5 分钟租期（Runtime `Validate` 上限同为 300000，不能改 60 分钟），Console 续签间隔固定 15 分钟：信封每 15 分钟里约 10 分钟是过期的（`verified_console_policy_receipt_invalid`，drain 3/3 失败）。此前"Gateway 每分钟续签"的说法有误 | rc8：续签间隔 = `max(30 秒, min(15 分钟, 租期/2))`，租期缺失/非法退回 15 分钟并记 `policy_lease_invalid`；`renewAfter` 改按新信封计算（`8f2bfde5`）。22 分钟观察：信封年龄最大 180.75 秒、剩余有效期最小 119 秒，drain 5 轮 3/3，0 条 `receipt_invalid` |
| 修正 12 | `connector-runtime.C000001-console`（service_clients.id=1043）的 grant 无 `audience`，connector 取令牌 403 退出 78 | 4 行按 id CAS 补 `audience`（628428、628427→data-runtime；6357、9677→console；`b17-connector-audience-facts.sql`，`184f1f78`）；排除 6328/6329/6330/628439/628440。**§15.4 原结论（按资源名前缀判断）有误，已在原处更正** |
| connector 重指 | — | gitlab 主机 `/opt/hzy/connector-runtime/.env` 备份为 `.env.pre-s4`（sha256 f05ab48f…），改 5 个键；服务恢复后新库 `connector_runtime_instances` 心跳刷新，旧库无新心跳，tpapi 不再 502；随后启动 `hzy-connector-runtime-update.timer`（首次 already up to date 0.4.33） |

**红线补充**：标签一经推送不可变（rc5 曾被重打一次，自此只往后打新号）。

**B17b 已通过的浏览器项**：1（Keycloak 正例）、2（反例被拒）。第 3 项（登录→登出）在 Gateway 崩溃循环期间失败，属 rc7 修复对象，待重测。

**C4 追加**：
- 根路径 `/api/rum`、`/shell/*`、`/admin`、`/api/oss/avatar` 会落到 Console（`/api/rum` 返回 404，其余 302 到 `/console/…`）：前端上报路径与后端不一致，切换后处理。
- 生产 grant audience 事实迁移仍未覆盖全部客户端：逐个排查上线前实际会用到的客户端，`notification-runtime`、`directory-connector` 为重点。
- 策略租期与续签：Runtime `Validate` 对非 test 只接受 ≤5 分钟租期，与 Console/TS 侧 60 分钟上限不一致，0.3.222 应统一。

### 24.2d rc9、Enterprise 资源前缀、nginx 响应头缓冲与 Cookie（2026-10-01 CST）

| 项 | 现象 / 根因 | 处理 |
| --- | --- | --- |
| 修正 13 | Enterprise 页面一直"正在加载"：`enterprise.env` 的 `NUXT_APP_BASE_URL=/enterprise/` 与 pilot 构建固定的 `buildAssetsDir=/enterprise/_nuxt/` 叠加，资源变成 `/enterprise/enterprise/_nuxt/…`（Gateway 503）。`enterprise/nuxt.config.ts` 明确 `app.baseURL` 为 `/`（Host 同时服务 /enterprise、/aims、/assets、/codocs） | `NUXT_APP_BASE_URL=/`，示例已改（`7fcc140a`）。favicon 链接仍为 `/enterprise/favicon.*`（404，C4） |
| 修正 14 | Console SSO 回调后显示"系统维护中"：回调响应带大量 Set-Cookie，超过 nginx 默认 `proxy_buffer_size`，nginx 502 → `error_page` 换成维护页（error.log: upstream sent too big header） | aidcp vhost 两处 location 加 `proxy_buffer_size 32k; proxy_buffers 4 32k; proxy_busy_buffers_size 32k;`（只加第一条会被 `nginx -t` 拒绝）；模板与 `test-aidcp-nginx.sh`（~24KB 响应头用例）同步（`5615115d`）；重载对象是监听 443 的手工进程 `nginx: master process ./nginx`（pid 见 `ps`，`nginx.service` 未运行） |
| rc9（foundation） | 所有业务应用的 SSO 回调 503（`verified_console_route_missing`）：OIDC 换码走 `consoleBackendRequestHeaders`，只转发固定头，不含 `x-hzy-service-routes`；Console 在 `x-hzy-app-code≠console` 时只能从该目录取自己的部署。循环登录 → Cookie 累积 → Gateway 16KB 头限制返回 **431** | 新增 `serviceRouteCatalog.forwardedServiceRouteCatalogHeader`（仅可信网关请求、JSON 对象、≤16KB，非法 503），`serviceOidc`、`consoleOidc`、`consoleSessionBridge`、`consoleRuntime`、`subjectEligibility`、`platformBundleAuthorization` 共用（`aa4d8de2`）；重建并安装 5 个应用（enterprise/workflow/aims/codocs/console），Gateway 不变 |
| 修正 15 | `getAuthCookieDomain` 在未设置 `HZY_AUTH_COOKIE_HOST_ONLY=true` 时把认证 Cookie 的 Domain 设为 `.wiztek.cn`（为 huizhi.yun 多租户子域共享设计）：aidcp 的会话 Cookie 会发给 gitlab/hzy/sso/tpapi 等所有 wiztek.cn 子站，且不断累积。用户浏览器实测 wiztek.cn 下 117 个 Cookie、约 108 个在父域 | 5 个应用 env 各加 `HZY_AUTH_COOKIE_HOST_ONLY=true`（备份 `.pre-b17-15`），随 rc9 重启生效；`Set-Cookie` 已无 `Domain=`；示例同步。**已发出的旧父域 Cookie 浏览器仍会发送，需用户清除；B19 前需决定是否批量撤销旧会话** |

**B17b 已通过的浏览器项**：1（Keycloak 正例）、2（反例被拒）、4（Console 集成中心/凭证库/服务凭据只读页面）。待 rc9 后：Enterprise 登录/登出、部门文档、企业微信扫码、权限、审批往返。

**C4 追加**：
- 应用 OIDC 回调失败后自动重新发起登录、无次数上限（形成循环、Cookie 累积）。
- Keycloak（sso.wiztek.cn）realm 的 Cookie Domain 未核（curl 不可见），需管理端或浏览器开发者工具确认。
- 示例 env 文件的默认值要点：`enterprise.env` 的 `NUXT_APP_BASE_URL=/`、所有应用 `HZY_AUTH_COOKIE_HOST_ONLY=true`。

### 24.4 修正 5–15 总表（根因 / 改动 / 备份 / 回滚）

路径约定：新机 = `root@100.64.72.59`；`B17DIR` = 新机 `/root/.hzy-s4/b17-7c/`；日志 = 新机 `/root/.hzy-r3/events.log`。数据库写入均经 `hzy_migrator` 临时解锁并立即重新加锁，`hzy_console` 操作均先做加密备份（密钥 `/root/.hzy-s4/pipeline/s4-s4-20260930T143157Z.key`，`openssl enc -aes-256-cbc -pbkdf2`）。

| 修正 | 根因 | 改动 | 备份位置 | 回滚 |
| --- | --- | --- | --- | --- |
| 5 | `console.runtime` 的 `console:policy-bundle` 行无 audience，取策略令牌 `insufficient_scope` | `hzy_console.service_client_grants` 新增 4 行 audience 绑定（`b17-console-policy-grants.sql`） | 见 §24.2 与 A 节备份；新增行带 `source=s4-b17-console-policy` | `b17-console-policy-grants.rollback.sql`（按 source 删除） |
| 6 | Runtime 无法验证 Console 令牌 | `/etc/hzy-data-runtime/config.json` `auth.jwt.jwksJson` 静态 JWKS | `config.pre-b17-6.json` | 恢复该备份并重启 Runtime；**严禁放置 `auth-jwt-trust.json`** |
| 7 / 7b / 7d | 缺 `apps.console.policyEnvelope`、`gatewayExchangeEnabled`；`maxAgeMs` 非 test 上限 300000（写路径 `Validate`） | 同上文件加块；最终 `maxAgeMs=300000` | `config.pre-b17-7.json`、`-7b`、`-7d` | 恢复对应备份并重启 Runtime |
| 7c | `hzy_console` 缺 `verified_policy_snapshots`、`console_service_assertion_replay`、`gateway_service_assertion_replay` | 3 张表（`B17DIR/01–04*.sql`，取自 rc4 tag） | `B17DIR/hzy_console.pre-7c-equivalent.sql.enc`（事后补做，见 §24.2 偏差说明） | 三张表为空表，`DROP TABLE` 即可 |
| 8 | systemd `EnvironmentFile` 对未加引号的值吞掉 `\n`，PEM 公钥损坏 | console.env / enterprise.env 各 2 行加双引号 | `/etc/hzy/console.env.pre-b17-8`、`enterprise.env.pre-b17-8` | 恢复备份并重启对应服务 |
| 9 | 生产 `console.runtime` 历史 grant 无 audience 事实（hzy0 已在 9-26 迁移） | 86 行按 id CAS 补 audience+semanticScope（`b17-console-runtime-audience-facts.sql`） | `B17DIR/service_client_grants.pre-9.sql.enc` | `b17-console-runtime-audience-facts.rollback.sql`（按 id 还原，限带标记行） |
| 10 | `RestrictAddressFamilies` 缺 `AF_NETLINK`，`os.networkInterfaces()` errno 97 崩溃 | codocs、enterprise 加 drop-in `zz-b17-netlink.conf` | drop-in 为新增文件 | 删除 drop-in，`daemon-reload` |
| 11 | Runtime 未启用 `apps.aims`/`apps.assets`（统一域挂载点） | `config.json` 两处启用，db=`hzy_rt_enterprise`→`hzy_enterprise` | `config.pre-b17-11.json` | 恢复备份并重启 Runtime |
| 12 | connector 服务客户端（id 1043）4 行 grant 无 audience | 4 行 CAS 补 audience（`b17-connector-audience-facts.sql`） | `B17DIR/service_client_grants.pre-12.sql.enc` | `b17-connector-audience-facts.rollback.sql` |
| 13 | `enterprise.env` `NUXT_APP_BASE_URL=/enterprise/` 造成资源前缀翻倍 | 改为 `/` | `/etc/hzy/enterprise.env.pre-b17-13` | 恢复备份并重启 enterprise |
| 14 | nginx `proxy_buffer_size` 太小，SSO 回调响应头被 502→维护页 | aidcp vhost 两处 location 加 3 条缓冲指令 | gitlab 主机 `/root/hzy-g9/b12b-fix14-20261001T050249/aidcp.wiztek.cn.conf` | 恢复该文件并对手工 nginx master 发 HUP |
| 15 | 认证 Cookie 默认 Domain=父域（`.wiztek.cn`），泄露到同级站点并累积 | 5 个应用 env 加 `HZY_AUTH_COOKIE_HOST_ONLY=true` | `/etc/hzy/{console,enterprise,workflow,aims,codocs}.env.pre-b17-15` | 恢复备份并重启 |

| 16 | `VerifyOIDCServiceTokenState` 对物理 `resource:action` 校验 `enterprise.runtime` 的 `console:policy-bundle` read，而该客户端只有 audience 绑定行 | `hzy_console.service_client_grants` 新增 `enterprise.runtime` `console:policy-bundle` `read` 一行（无 audience，`scope_json.source=s4-b17-enterprise-policy-state`） | `/root/.hzy-s4/b17-7c/service_client_grants.pre-16.20260930T212934Z.sql` | 按 `source=s4-b17-enterprise-policy-state` 删除该行 |
| 17 | `enterprise.env` 两个 PEM 公钥（`HZY_ENTERPRISE_POLICY_PUBLIC_KEY`、`NUXT_VERIFIED_POLICY_PUBLIC_KEY`）在 Enterprise 侧需要真实多行值 | 改为真实多行带引号的值（替换修正 8 的转义形式） | `/etc/hzy/enterprise.env.pre-b17-17` | 恢复备份并重启 enterprise |
| 18 | Console 在自托管下需要用本地部署码做策略绑定 | `console.env` 启用 `HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING=true`（rc11 起读取 `HZY_PLATFORM_DEPLOYMENT_CODE`） | `/etc/hzy/console.env.pre-b17-18` | 恢复备份并重启 console |
| 19 | 企业微信 502 `identity_exchange_failed`：Connector Runtime URL `aidcp-runtime.wiztek.cn` 不可解析 | 新机 systemd `hzy-runtime-tailnet-proxy.socket/.service`（`100.64.72.59:31090` → `127.0.0.1:31080`，`systemd-socket-proxyd`），firewalld zone `hzy-tailnet` rich rule 仅放行 `100.98.120.65/32` tcp 31090；gitlab 主机 systemd `hzy-runtime-loopback-proxy.socket/.service`（`127.0.0.1:31090` → `100.64.72.59:31090`）；`/opt/hzy/connector-runtime/.env` 的 `HZY_CONNECTOR_RUNTIME_DATA_RUNTIME_URL=http://127.0.0.1:31090`（Connector 只接受 HTTPS 或回环 HTTP）；心跳 200 已验证 | gitlab 主机 `/opt/hzy/connector-runtime/.env.pre-b17-19` | 恢复该 `.env` 后重启 connector；停用并移除两侧 proxy unit 与 firewalld rich rule |

| 20 | `workflow.runtime` 授权行 id 12133789（`console:authorization-role-holders` read）缺 audience，审批人解析被 `insufficient_scope` 拒绝 | 该行补 `audience=console`、`semanticScope=console:authorization-role-holders:read` | `/root/.hzy-s4/b17-7c/service_client_grants.pre-20.20260930T230119Z.sql` | 用备份还原该行的 `scope_json` |
| 21 | `workflow.runtime` 授权行 2197/2198（`data-runtime:workflow` read/write）缺 audience；2092（`notifications` publish）缺 audience | 2197/2198 补 `audience=data-runtime`；2092 补 `audience=notifications`、`semanticScope=notifications:publish`。依据同修正 9："B17b 暴露什么补什么" | `/root/.hzy-s4/b17-7c/service_client_grants.pre-21.20261001T002318Z.sql` | 用备份还原这三行的 `scope_json` |

| 22 | Enterprise Host 打开 Codocs 文档正文返回 503"无法加载文档内容"：`enterprise.runtime` 申请 `integration_config:view` 被拒（403 `insufficient_scope`）。G-7 生产清单只给 `codocs.runtime` 授了 OSS 读取，Host 读正文所需的两项授权遗漏 | 为 `enterprise.runtime`（service_client_id 1173351）新增两行：id 104437632（`integration_config` view）、104437633（`credential_vault` resolve）。`scope_json`：`source=s4-b17-enterprise-oss-read`、`tenantCode=C000001`、`deploymentCode=C000001-prod-enterprise`、`audience=data-runtime`、`semanticScope`=`integration_config:view` / `credential_vault:resolve`、`integrationCodes=["oss.default"]`，credential_vault 一行另加 `usageTypes=["integration"]` | `/root/.hzy-s4/b17-7c/service_client_grants.pre-22.20261001T004304Z.sql`（改前 `enterprise.runtime` 全部 21 行） | 删除 104437632、104437633 两行 |
| 22b | 22 的两行最初按 hzy0 注册脚本（`deploy/test-env/enterprise-registration.mjs`）写成带前缀的 `data-runtime:integration_config` / `data-runtime:credential_vault`，但 Runtime 0.3.221 的 `authorizedIntegrationCodes` 按**不带前缀**的 `resource_code` 查询，报 `console_service_integration_not_granted` | 两行改为不带前缀的 `integration_config` / `credential_vault`，与 `codocs.runtime` 的 439、440 两行同构 | `/root/.hzy-s4/b17-7c/service_client_grants.pre-22b.20261001T010719Z.sql` | 同上（删除这两行） |

**22 / 22b 验证**：用户确认文档正文已能打开；`vault_access_logs` 有 `client:enterprise.runtime` `resolve` `integration_resolve:oss.default` success（01:24:25 UTC）；修复后 `hzy-enterprise` 没有新的 `insufficient_scope` 或 `not_granted`。**待办**：hzy0 注册脚本的带前缀资源名与生产 Runtime 的核对方式不一致，需在生产授权清单统一核对时一并处理（C4）。

| 23 | 通知外发缺授权：Host 承担 Codocs 分享/发布/转移通知，hzy0 只发站内消息、从未走到外发；外发由设置 `connector.notificationsEnabled=true` 决定，经 `https://tpapi.wiztek.cn` 到 Connector（新机可达 200；Connector 的 issuer/JWKS 已改指 aidcp；Connector 无来源应用白名单，只要求 `sourceAppCode` 与令牌一致，Host 使用 `enterprise`） | ① Workflow、Aims、Codocs 的 `system_settings` view（行 150/34/148）补 `audience=system_settings`、`semanticScope=system_settings:view`；`connector-runtime:notifications` send（行 6103/6099/6101）补 `audience=connector-runtime`、`semanticScope=connector-runtime:notifications:send`。② `enterprise.runtime` 新增两行：104437634（`system_settings` view）、104437635（`connector-runtime:notifications` send，`providers=[wecom]`、`integrationCodes=[wecom.default]`），`deploymentCode=C000001-prod-enterprise`，`source=s4-b17-host-notifications` | `/root/.hzy-s4/b17-7c/service_client_grants.pre-23.20261001T013600Z.sql` | 新增两行按 id 删除；补 audience 的 6 行用备份还原 `scope_json` |
| 24 | 工作项完成审批链路缺授权：完成审批由独立 aims 的 drain 以 `aims.runtime` 调用 `workflow:work-item-complete:create`，生产缺此授权，审批创建被拒并进入死信 | 原样执行仓库种子 `console/docs/sql/Console-SQL-Seed-v2.6-aims-work-item-completion-grants.sql`（sha256 前缀 `66c44b8612d43a97`）与 `Console-SQL-Seed-v2.7-workflow-work-item-completion-grants.sql`（`bf8fba23b53eb83c`），两个文件均幂等；共插入 8 行：`aims.runtime` 104437636–104437640、`workflow.runtime` 104437643–104437645 | `/root/.hzy-s4/b17-7c/service_client_grants.pre-24.20261001T013749Z.sql`（`aims.runtime` 与 `workflow.runtime` 共 72 行） | 按 id 删除这 8 行 |

| 25 | 新机所有主服务原本都是 `disabled`（准备期刻意设置），Runbook 没有切换后启用的步骤，主机重启会导致整站中断 | `systemctl enable hzy-data-runtime hzy-console hzy-enterprise hzy-workflow hzy-aims hzy-codocs hzy-tenant-gateway`（只 enable，未改变运行状态）；`hzy-data-runtime-update-request.path` 按 Runbook 保持 disabled。依赖顺序已核对：应用 After/Requires Runtime 与 mysqld，网关 After 各应用与 tailscaled，Restart 策略已设；mysqld、tailscaled、firewalld、`hzy-runtime-tailnet-proxy.socket` 均已 enabled。gitlab 主机上 connector 及其 update timer、`hzy-runtime-loopback-proxy.socket`、tailscaled 均为 enabled+active；nginx 维持手工进程现状（风险见 §24.5） | 无文件备份（只改 unit 启用状态） | `systemctl disable` 上述 7 个单元 |

连接器重指（B17b）：gitlab 主机 `/opt/hzy/connector-runtime/.env.pre-s4`（5 个键改指新入口），回滚 = 恢复该文件后重启 `hzy-connector-runtime`；update timer 已启用。

### 24.5 rc4–rc9 变更与五个制品当前状态

| 标签 | commit | 变更 | 组件 |
| --- | --- | --- | --- |
| rc4 | `7a02b594` | `configuredGatewayIssuer`（OIDC issuer 保留 Console 基路径） | console |
| rc5 | `6aa3b89a` | 网关静态 dataRuntime endpoint 回退（`f66a2fdf`）+ 包带 `collab-deployment.mjs`。**此标签曾被重打一次** | gateway |
| rc6 | `a263e04f` | 自托管可信服务路由目录含 Console（显式开关，仅 `apps.console` 显式 deployment） | gateway |
| rc7 | `29055f60` | 请求体自管流修复 `Controller is already closed` 崩溃；`gateway-fatal` 日志后退出 | gateway |
| rc8 | `8f2bfde5` | 策略信封续签间隔随租期自适应（min(15 分钟, 租期/2)，下限 30 秒），`renewAfter` 按新信封 | console |
| rc9 | `aa4d8de2` | 所有发往 Console 的网关上下文头构造统一转发 `x-hzy-service-routes` | enterprise、workflow、aims、codocs、console |

后续发布（由协调会话执行，记录于此）：

| 标签 | commit | 变更 | 组件 |
| --- | --- | --- | --- |
| rc10 | `6377f6cb` | （已被 rc11 取代） | console |
| rc11 | `6030ac6f` | `HZY_CONSOLE_SELF_HOSTED_POLICY_BINDING` 读取 `HZY_PLATFORM_DEPLOYMENT_CODE` | console |
| rc12 | `da107843` | Console `sanitizeRedirect` 按受信转发主机判断同源 | console |
| rc13 | `38f41f76` | `/` 与 `/enterprise/` 302 `no-store` → `/enterprise` 工作台；非 GET/HEAD 返回 405；登录默认落点 `/enterprise` | gateway、enterprise |
| rc14 | `f37a1293` | 企业微信登录的外部登录事务：受信 Gateway 转发主机上的绝对回跳地址还原为站内路径（如 `/enterprise`、`/console/oauth/authorize?…`），外站地址仍降为 `/`；编码分隔符检查只作用于路径部分 | console |
| rc15 | `f6fb5079` | Foundation 令牌续期改用 `keepalive`，页面跳转不再丢失轮换后的刷新令牌（此前触发重用检测并吊销整组令牌）；刷新返回 `ok:false` 时进入登录页，不再导致导航空白 | enterprise、console |
| rc16 | `6cfa52d0` | role-holders / subject-eligibility 的修订门禁在已验签存储下改用 Console 自身部署做比对与探测（此前用调用方 Workflow 的部署，被 Platform 拒绝，"待我审批"持续 503）；调用方不是 Console 时不在请求路径上刷新策略包；顺带修复 console 的 10 个既有类型错误，typecheck 为 0 | console |

**以协调会话通报为准的当前状态**：console `s4-rc16`，enterprise `s4-rc15`，gateway `s4-rc13`，workflow / aims / codocs `s4-rc9`，Runtime 0.3.221。上表 §24.5 中 console / enterprise / gateway 的 `current` 与 sha 反映的是 rc9 / rc7 时点，**已被取代**，以新机 `index.json` 为准。**rc14 验证**：数据库中企业微信登录事务的 `redirect_path` 分别为 `/enterprise`（站内）与 `/`（外站地址被降级）；用户确认企业微信从 Enterprise 与 Console 两个入口登录均正常。

**标签与 commit 对应（GitLab 升级完成后已推送，annotated，不可变）**：`self-hosted/s4-rc10`=`6377f6cb`、`s4-rc11`=`6030ac6f`、`s4-rc12`=`da107843`、`s4-rc13`=`38f41f76`、`s4-rc14`=`f37a1293`、`s4-rc15`=`f6fb5079`、`s4-rc16`=`6cfa52d0`（此前：rc1–rc9 见上表）。原计划的 nginx 根路径跳转规则取消（Gateway 已实现）。

**风险记录（未改动）**：gitlab 主机 443 由 2026-07-21 手工启动的 nginx 主进程（`./nginx`，pid 3210851）提供；systemd 的 `nginx.service` 自 07-20 起为 inactive 但 enabled。主机重启后将由 systemd 版本接管，需确认两者使用的配置路径一致。重载 nginx 时对该手工主进程发 HUP，不要用 `systemctl reload nginx`。

**遗留问题**：`console/test/consolePolicyConsumption.test.ts` 中 “menu filtering and client route guard consume the shared permission snapshot” 失败；去掉本次改动后同样失败，与本次发布无关（已知既有失败）。

当前 `current` 符号链接与制品 sha256（来自各自 `index.json`）：

| 组件 | current | sha256 |
| --- | --- | --- |
| console | `releases/s4-rc9` | `403bb6af9de4324374f941f6e5ea43704c791ea24312846fc365a137f08d0f17` |
| enterprise | `releases/s4-rc9` | `7139dbea5679c511b6587225aceea7fbafa39559ca365b536c18c0cd88c241d1` |
| workflow | `releases/s4-rc9` | `23805e81550ea89468a3f87863fbdca502de9b6513ebc3f8dac0f6f8fb8a1301` |
| aims | `releases/s4-rc9` | `a71952482477b856364f2fdf12ac9aaf155a6f7ac70769294fcf8f22ceb42ce7` |
| codocs | `releases/s4-rc9` | `a315aec4d1f9296777d3958c96a53de2c3b46cd75f5defa4ba2c9473b4b76023` |
| gateway | `releases/s4-rc7` | `dcae76408d665a23a6d6f5e9a5ffb677af3df0c62343a67b1b0739da08181c2a` |

回滚点：各应用 `releases/s4-rc3`（网关 rc3 整棵树备份 `/root/.hzy-s4/gateway-current.pre-rc5`）仍在，console 另有 rc4、rc8。

### 24.6 drop-in、配置备份与临时文件清单

**systemd drop-in（`/etc/systemd/system/<unit>.service.d/`）**：`hzy-aims`：`b17-no-direct-health.conf`；`hzy-codocs`：`b17-no-direct-health.conf`、`zz-b17-netlink.conf`；`hzy-enterprise`：`b17-no-direct-health.conf`、`zz-b17-netlink.conf`；`hzy-tenant-gateway`：`release.conf`（安装器生成）、`zz-b17-entry.conf`（`--preserve-symlinks-main`）；`hzy-data-runtime`：`g4-config.conf`（`EnvironmentFile=/etc/hzy/runtime.env`）。

**配置备份（新机）**：`/etc/hzy/console.env.pre-b17`、`.pre-b17-2`、`.pre-b17-4`、`.pre-b17-8`、`.pre-b17-15`；`/etc/hzy/enterprise.env.pre-b17-8`、`.pre-b17-13`、`.pre-b17-15`；`/etc/hzy/{aims,codocs,workflow}.env.pre-b17-15`；`/etc/hzy-data-runtime/config.b10b.json`、`config.template.json`、`config.pre-b17-6.json`、`-7`、`-7b`、`-7d`、`-11`；`/root/.hzy-s4/backups/gateway-manifest.json.pre-b17-4`；`/root/.hzy-s4/gateway-current.pre-rc5/`；`B17DIR` 下的 SQL、回滚 SQL 与加密备份。gitlab 主机：`/opt/hzy/connector-runtime/.env.pre-s4`、`/root/hzy-g9/b12b-*`（含 `b12b-fix14-20261001T050249`）。

**B20 收尾需清理**：`/root/.hzy-s4/obs.sh`、`obs.log`、`/root/.hzy-s4/s4-smoke.mjs`、`/root/.hzy-a5/publish-nostart-rc{5..9}.mjs`、`/home/hzy/build/out-rc5-superseded`；Mac 侧 `wt-rc4` worktree 与临时目录。**本节备份文件在 B20 之前不得删除。**

### 24.7 红线（汇总）

1. **标签一经推送不可变**（rc5 曾被重打一次），出问题只往后打新号。
2. **rc5 之前不得轮换 OIDC 签名密钥**（静态 `jwksJson`，见修正 6）；rc5 已过，但新的 JWKS 来源未落地前仍不得轮换。
3. **Runtime 配置目录禁止出现 `auth-jwt-trust.json`**（会清空静态 `jwksJson`）。
4. 对照配置时 token/secret/password/key 类值必须先打码再输出。
5. 写操作脚本一律 `set -e`，"备份成功"是继续执行的硬前置。
6. 环境写入每次单独批准；Platform / 日本库不写；B19、回滚等仍需用户明确确认。

### 24.8 交接（2026-10-01）

自此浏览器验证、日志排查与环境修复由协调会话直接执行；本会话只维护记录，不再对新机、gitlab 主机、Platform 写入。旧会话撤销：泄露的会话只属于用户本人当晚测试会话且只发往自有 wiztek.cn 主机，不出 SQL，改为用户登出并清除父域 Cookie（C4 记录）；Keycloak 只读核对：用户截图显示 `sso.wiztek.cn` 仅有自身主机域下 3 个 Cookie、无父域 Cookie，该项关闭。

### 24.3 门 0 通过证据

02:11:01 CST 起 `policy-sync ok:true`；`verified_policy_snapshots` 一行（C000001/prod/C000001-console，`renewal_state=ok`）；信封 `policyRevision=31`、`bundleVersion=pv_prod_20260930155856_0001`；`/console/api/auth/login-config` 返回 `enabledProviders=["oidc","wecom"]`。

### 24.4 C4 / rc5 待办

- `consolePolicyConsumption.test.ts` 存在既有失败。
- Gateway 清单与 drop-in、OIDC issuer 补丁（`configuredGatewayIssuer`，rc4）需回到正式发布流程。
- G-7 目录缺 `console.runtime` 的策略授权与 audience 事实（rc5）；其它客户端约 350 行缺 audience 的旧 grant 暂不迁移、运行时惰性，门 b / B17b 暴露什么补什么，依据同修正 9。
- JWKS 路由需要 gateway 上下文，静态 JWKS 之外的后台回环拉取在 managed-cloud 下可能失败（方案 B，rc5）。
- Enterprise 包内 `callbackUrl` 指向 hzy-test 域；Platform 应用注册表需支持按环境覆盖。
- 无事件的后台调用在 managed-cloud 模式下失败。
- `render-runtime-config.py` 仍未渲染 `jwksJson`（手工修正 6），rc5 前补齐。
- 清理：`hzy_dump@39.78.255.170`（C3）、新机上的 `hzy_platform` 克隆。
- C2 原表述“策略包有 expires_at”不成立：生产包 `expiresAt` 为 NULL。
- **运行风险（C4/C1）**：策略信封租期仅 5 分钟，依赖 Gateway 每分钟 policy-sync 续签；Gateway 停机超过 5 分钟，策略过期，授权失败关闭。C1 监控加“Gateway policy-sync 连续失败”告警（阈值：连续 3 次失败即告警，Gateway 已输出 `gateway-scheduler-alert`）。
- 读配置对照 hzy0 时，token/secret/password/key 类键的值必须先打码再输出。


## 25. 执行单：当前线上配置快照（相对 A5 基线的差异，仅键名与说明，不含值）

**应用 env（`/etc/hzy/*.env`）**
- `console.env`、`enterprise.env`、`workflow.env`、`aims.env`、`codocs.env`：新增键 `HZY_AUTH_COOKIE_HOST_ONLY`（认证 Cookie host-only）。
- `console.env`：`HZY_PLATFORM_SIGNING_PUBKEY`、`NUXT_PLATFORM_SIGNING_PUBKEY` 的值改为双引号包裹（键不变）；激活模式为 managed-cloud 形态（修正 1–4：`HZY_CONSOLE_ACTIVATION_MODE`、`HZY_CONSOLE_TRUST_TENANT_GATEWAY`、`HZY_CONSOLE_PLATFORM_SERVICE_TOKEN`、`HZY_TENANT_GATEWAY_INTERNAL_TOKEN` 等，详见 §24.2）。
- `enterprise.env`：`HZY_ENTERPRISE_POLICY_PUBLIC_KEY`、`NUXT_VERIFIED_POLICY_PUBLIC_KEY` 值改为双引号包裹；`NUXT_APP_BASE_URL` 由 `/enterprise/` 改为 `/`。
- `gateway.env`：仅 `NODE_ENV`、`HZY_GATEWAY_CONFIG`（无变化）。

**Runtime `config.json`（相对 B10b 最小结构新增的路径，表列表折叠）**
- `apps.aims`、`apps.assets`、`apps.codocs`、`apps.workflow`：`db.*`（host/port/user/password/database/connectionLimit）；aims/assets 指向 `hzy_enterprise`（账号 `hzy_rt_enterprise`）。
- `apps.console`：`policyEnvelope.{enabled,enterpriseReadEnabled,environment,maxAgeMs}`（prod，`maxAgeMs=300000`）、`gatewayExchangeEnabled`。
- `auth.jwt.jwksJson`（静态 JWKS，红线见 §24.7）。
- `enterprise.{enabled,environment,generation,instanceId,schemaVersion}`、`enterprise.db.*`、`enterprise.aimsDeliveryWorker.{deployment,serviceClientId}`、`enterprise.domains.{aims,assets}.{ownerDeployment,read,write,scheduler,tables}`。
- 不存在：顶层 `control`（由 `/etc/hzy-data-runtime/.env` 提供 Platform URL / 签名密钥）、`gatewayKeyset`（自托管不需要）。

**Gateway `gateway.json`**：键集合 `schemaVersion/site/platform/runtime/apps/enterprise/listeners/limits/scheduler/secrets` 无增减；`limits.maxHeaderBytes=16384` 保持；Worker 环境由 `buildWorkerEnv` 派生（rc5–rc6 新增 `HZY_TENANT_GATEWAY_STATIC_DATA_RUNTIME_ENDPOINT/_CODE`、`HZY_TENANT_GATEWAY_SERVICE_ROUTES_INCLUDE_CONSOLE`）。

**数据库（`hzy_console`）**：新增表 `verified_policy_snapshots`、`console_service_assertion_replay`、`gateway_service_assertion_replay`；`service_client_grants` 有 86（`console.runtime`）+ 4（connector）行补了 `audience`（标记键 `audienceFacts`）；另有修正 5 的 4 行新增。

**外部**：gitlab 主机 nginx aidcp vhost 增 `proxy_buffer_size/proxy_buffers/proxy_busy_buffers_size`；connector `.env` 5 个键改指新入口。


## 26. B17b 结果与遗留（2026-10-01 CST，协调会话通报）

- **通过**：第 1–5 项；企业微信扫码正反例；第 8 项权限正反例与撤权（从生成策略包到页面生效约 9 秒，刷新令牌无重用）。**暂缓**：第 9 项审批往返，用户 10-01 决定留到业务整体测试。
- **脚本判据**：`verify-views` 142/142；JWKS 14 个 kid 一致；冒烟脚本里回环直连 Console 的项在托管模式下失败属脚本局限（无网关上下文），已由网关入口复核通过；Aims 健康检查路径 404 属脚本问题。
- **需用户确认**：生产策略包里 `project_director` 的持有人是 `test`，是否为临时分配。
- **审批链路未验证的授权**：Aims 发起完成审批、通知发布、回调 Aims。
- **B20 清理**：`/root/.hzy-s4/wf.tcpdump.log`、`wf2.tcpdump.log`（抓包与重放文件其余已 shred）。


## 27. 生产授权全面核对（协调会话，2026-10-01 CST）

- **方法**：导出生产 `service_client_grants` 共 520 行（488 行 active），按 Runtime 0.3.221 的 `mapServiceAudienceScopes` 规则离线模拟签发。依据：G-7 生产清单、enterprise-readiness 模板（hzy0 注册）、审批链路与通知链路的实际服务调用，以及运行证据（各服务日志的签发失败记录、Runtime 按客户端统计的操作）。
- **可达性结论**：独立 aims 只运行定时任务（里程碑滚动、集成操作领取、死信处理，3 小时内全部 200），用户请求全部由 Host 处理。因此 aims / codocs 独立服务中面向用户的代码路径**不补授权**（最小权限）。
- **结果**：50 项要求中 OK 40、WARN 10（`data-runtime` / `tenant-runtime` 语义匹配，由 Runtime 自行核验，运行中已证实正常）、FAIL 0。补授权见修正 23、24（以及此前的 20、21、22）。
- **未覆盖，留待业务测试**：独立 Codocs 编辑器/协作路径（近 3 小时无 `codocs.runtime` 操作）；aims 死信通知发布（`notifications:publish`，`aims.runtime` 无绑定行，仅在集成操作失败时触发）；Console 的 `audit:write`（旧 Account 路径）；LDAP 目录同步（不迁移）。
- **文档待办（C4）**：`deploy/test-env/enterprise-registration.mjs` 中 OSS 物理资源名带 `data-runtime:` 前缀，与生产 Runtime（不带前缀按 `resource_code` 查询）的核对方式不一致；G-7 清单（`console/scripts/g7-prod-grant-catalog.mjs`）缺少 Host 的 OSS 与外发通知授权，需回补。


## 28. B18 冒烟结果（2026-10-01 约 09:55–10:10 CST，协调会话通报）

**重启恢复**
- `hzy-data-runtime` 重启后 3 秒 health 200，aims / assets / codocs / console / directory / workflow 六个适配器 db 均 ok。
- Runtime 重启会连带重启 `hzy-aims`、`hzy-codocs`（单元 Requires/BindsTo Runtime）；两者启动时 `workflow:action_defs:sync` 和 `system_settings:view` 报 “An enrolled Tenant Runtime bootstrap token is required”，属已记录的“无事件后台调用”遗留问题。
- Console 在 09:59:45–09:59:53 出现 `verified-policy-binding` 503 共 12 次，属重启窗口内的短暂中断，之后为 0。
- `hzy-console` 重启后 3 秒恢复，经网关 login-config、JWKS、`/enterprise`、`/enterprise/login` 均 200，无依赖失败；`hzy-workflow` 重启后 2 秒恢复，之后各 drain 操作全部 200、0 错误。

**调度**：09:55 起 policy-sync 15 次、integration-drain 3 次全部 ok，0 告警，最大连续失败 0。

**G-8 无公网回落**：在新机 `ens32` 抓发往 `8.130.81.31:443` 的 TLS ClientHello 15 分钟，共 24 次，SNI 全部为 `hzy.wiztek.cn`（Platform），没有 `aidcp.wiztek.cn`；抓包文件已 shred。

**未做（按用户决定并入业务测试）**：Codocs 读写与共享、审批发起/驳回、写请求丢响应后同键重放、Assets 页面。

**B20 清理**：`/root/.hzy-s4/g8.tcpdump.log`（连同此前的 `wf.tcpdump.log`、`wf2.tcpdump.log`）。


## 29. B19 执行记录：开放员工（2026-10-01 CST，协调会话通报）

- **批准**（用户原文，2026-10-01）：“批准 B19：切换 aidcp.wiztek.cn 到新机 Gateway 并开放员工。”
- **前置只读复核**：旧入口 `wiztek.huizhi.yun` 的 TLS 能连通，但 15 秒内无 HTTP 响应（路由已不指向服务）；日本机 `hzy-data-runtime`、`hzy-data-runtime-directory`、`update.timer`、`update-request.path` 均 inactive，31080 无监听，但仍为 enabled（B1 只 stop 不 disable，以便回滚）。**建议在 C1 监控期结束后经用户单独批准再 disable。**
- **变更**：gitlab 主机 `/etc/nginx/vhost/aidcp.wiztek.cn.conf` 只删除两处 `if ($hzy_aidcp_allowed = 0) { ... return 503; }`（`/codocs/ws` 与 `/`），并更新头部注释；`geo` 白名单块保留不再引用，供回滚使用；修正 14 的缓冲配置、受信头清除和 `X-Real-IP` 全部保留。备份目录 `/root/hzy-g9/b19-20261001T102148/`（`aidcp.wiztek.cn.conf.pre`，改前 sha256 前缀 `bc45b420d7710455`；`aidcp.wiztek.cn.conf.open`）。`nginx -t` 通过。
- **操作失误记录**：第一次 HUP 误发给了 GitLab 内置 nginx（pid 1810411，`/opt/gitlab/embedded`），只是平滑重载其未变的配置，GitLab 仍 200，无影响；随后按 `/run/nginx.pid` 向 aidcp 实际使用的手工 nginx 主进程 3210851 发送 HUP，10:22:07 新 worker 生效。**经验：gitlab 主机上有两个 nginx master，重载 aidcp 必须用 `/run/nginx.pid`（3210851），不能用 `pgrep`。**
- **验证**：从两个非白名单来源（新机出口 39.78.255.170、日本机 45.32.20.65）访问，`/` 302 到 `/enterprise`，`/enterprise`、`/enterprise/login`、`/console/login`、`/console/api/auth/login-config` 均 200。
- **回滚**：`cp /root/hzy-g9/b19-20261001T102148/aidcp.wiztek.cn.conf.pre /etc/nginx/vhost/aidcp.wiztek.cn.conf`，然后 `nginx -t`，再 `kill -HUP $(cat /run/nginx.pid)`，最后从非白名单来源回读应为 503（维护页）。
- **下一步**：C1 监控 72 小时；B20 收尾（销毁两端排空 HMAC，清理临时文件与日志，含 §24.6、§26、§28 列出的清单）。


## 30. Runtime 0.3.222 进程内调度上线与 Aims rc20/rc21（2026-10-01 CST，协调会话）

- **批准**（用户原文）：“都批准，无需先装hzy0，直接生产”（设计 B1–B5 顺序与 0.3.222 打包安装）；“批准 R2 stage”。
- **打包**：主 checkout，`HZY_DATA_RUNTIME_COMMIT=376e43d58`，`package-release.sh 0.3.222`（`VERSION` 文件不改）；amd64 包 sha256 `62d480f5…5778`，release inventory `ccce79fa…d0af`，manifest keyId `e1f7cfc0…bab82`。
- **R2 stage**：`upload-r2.sh 0.3.222 --stage --execute --confirm 1aec71cc…f808`（默认 `wrangler@4.110.0`）；12/12 公开 URL 回读一致，`latest/version.txt` 仍 `0.3.220`。
- **Platform**（用户运维会话，用后 `shred`）：写前快照 `/root/hzy-g9/rt222/before-*.json`；`sync` → release id=4；`approve` → `promotion`，previous `0.3.221`，`updatedInstances=2`。test 实例（hzy0，0.3.292-test）desired 改为 0.3.222，仍是原有的 `runtime_version_incompatible` 提示，无新影响。**回退**：`approve {"version":"0.3.221","confirmRollback":true}`。
- **为何先批准再安装**：Runtime 心跳按 Platform `desiredVersion` 写更新请求；未批准就装 0.3.222 会排队一个降回 0.3.221 的 journal（update-request.path 关闭时永久 queued，挡住后续更新）。
- **安装**：备份 `/root/.hzy-rt222/backup-20261001T110415Z`（/etc/hzy-data-runtime、/opt 二进制、systemd 单元）；`install.sh --base-url file:///home/hzy-backup/runtime-release --version 0.3.222 --release-public-key /etc/hzy/release-signing-public.pem --user hzy-runtime --no-auto-update --no-start`（无环境覆盖）。`.env` 47 项值不变，单元/drop-in/config/journal 与备份一致；安装器再次 enable 的 `update-request.path` 已改回 disabled。`config.json` 增加 `enterprise.inProcessScheduler={"enabled":true,"intervalSeconds":300}`（前版 `config.pre-rt222.json`）。
- **中断事故（约 7 分钟，19:09:47–19:16:50 CST）**：install.sh 执行 `systemctl stop hzy-data-runtime`；Gateway 与 console/enterprise/workflow/codocs/aims 单元均 `Requires=hzy-data-runtime.service`，被 systemd 连带停止；随后只 `systemctl start hzy-data-runtime`，依赖单元不会随之启动，公网入口不可用。19:16:50 手工启动全部单元后恢复，`https://aidcp.wiztek.cn/enterprise/login` 200。**经验**：凡会 stop Runtime 的操作（install.sh、手工 stop），结束后必须 `systemctl start hzy-console hzy-workflow hzy-codocs hzy-enterprise hzy-aims hzy-tenant-gateway` 并核对 `systemctl list-units 'hzy-*'` 与公网入口；`restart` 会连带重启依赖，`stop`+`start` 不会。
- **验证**：prod 实例 ready、desired=current=0.3.222、无错误码；19:15:21 首轮 `[enterprise-scheduler]` `result=ok generation=1 scanned=0`；Console `operation_logs` id=1663（`domain_code=aims`、`action=scheduler_round`、`actor_type=system`）；Aims 唤醒的滚转请求得 409 `aims_milestone_rollover_inprocess_owner`，其余投递操作 200。
- **Aims rc20 → rc21**：rc20（`30d758ae`）上线后发现唤醒路径仍记 `failed`：Foundation `tenantRuntimeClient` 重抛错误为 `{statusCode, data:{code, upstreamStatus}}`，任务 A 的跳过判断只认旧 cron 的 `data.error.code`。`2f042609` 新增 `isInProcessMilestoneRolloverOwner`，rc21 上线后 19:30 唤醒 `rollover failed` 0 次、Gateway `integration-drain ok`。Tag `self-hosted/s4-rc20`、`self-hosted/s4-rc21` 仅推 GitLab。
- **渲染脚本**：`render-runtime-config.py --stage final` 在 aims 为 unified 时写入并校验 `inProcessScheduler`；用新版 `--check` 检查生产 `config.json`，`problems=[]`。
- **回退调度**：`config.json` 置 `enabled:false` 后 `systemctl restart hzy-data-runtime`（restart 会连带重启依赖单元，属短暂中断），Aims 唤醒路径即恢复执行滚转。
- **当前**：Runtime 0.3.222；aims `s4-rc21`；其余应用不变。D7 观察期（生产 ≥14 天）自 2026-10-01 起算。
