# G-9 执行计划（草案）：在共享 Platform `hzy.wiztek.cn` 上登记 C000001 `prod`

日期：2026-09-29。状态：**草案，待审；本文不授权任何写入。** 依据 [Platform 方案 §8c](./Go-Live-Self-Hosted-Platform-Plan.md)（用户决定：生产控制面改用 `https://hzy.wiztek.cn`，与测试共用；新机不再运行 Platform）。取代原 G-9 的 P1–P3 与 `platform.wiztek.cn` 入口。

## 0. 已停止/存档的事项

- 停止全部 P2 准备：未建账号、未打 tag、未访问 registry、未创建 `platform.env`、未生成签名密钥。
- 新机 `/root/.hzy-s3/p2/`（`db.json.skeleton`、`check-env.py`、`old-kids.txt`）保留不删；`/root/.hzy-s3/p1/` 与新机 `hzy_platform`（P1 从旧生产 Platform 恢复的副本，基线加密备份 sha256 `d61f80cd…6ca2`）转为**存档，不动**，删除另批。
- 日本机已清理完毕（P1 结束时回读）。旧生产 Platform（`platform.huizhi.yun`/日本）仍在原机运行。

## 1. 现实例只读复查（2026-09-29 夜，仅 SELECT，`SET SESSION TRANSACTION READ ONLY`；未读取/打印任何密钥、哈希、token）

实例：gitlab 主机（阿里云，`iZcqwiqyhp9u8rZ`，公网 8.130.81.31，tailnet 100.98.120.65）。进程：PM2 `hzy-platform-dev`（Node 24.18.0，`127.0.0.1:3011`，工作目录 `/wiztek/hzy-test/platform-candidates/gateway-4a36cf66/platform`，运行 3 天，0 次重启）。数据库：Docker 容器 `hzy-platform-dev-mysql`（mysql:8.0.46，`127.0.0.1:13317`，卷 `/wiztek/docker-data/volumes/hzy-platform-dev-mysql-data`），库 `hzy_platform_dev`，103 张基表。同主机还有 PM2 `hzy-platform-prod`（旧生产 Platform，`/wiztek/huizhi-yun/platform`）、`hzy-test-mysql`（`127.0.0.1:13316`）、GitLab、Keycloak、Nexus、YAPI、gitlab-runner 等，**该主机是单点**。

### 1.1 账号与 OPS RBAC

| 项 | 现状 | 与目标差距 |
| --- | --- | --- |
| `platform_accounts` | 4 个：`gavin`（staff，`ops_super_admin`）、`zhouguangying`（staff，`ops_super_admin`）、`gavin,zhouguangying`（staff，`ops_super_admin`，异常 uid）、`u_Dc3Q…`（tenant_admin，无平台角色）；全部 `mfa_enabled=0` | 目标：运维只有 `zhouguangying`。**需停用 `gavin` 与 `gavin,zhouguangying`，或撤销其 `ops_super_admin`** |
| 角色 | `ops_super_admin`、`ops_auditor`（内置） | 无 `ops_auditor` 持有人 |
| 进程 env | `NUXT_SECURITY_OPS_UIDS`/`OPS_BOOTSTRAP_UIDS` 为空，`ALLOW_OPS_UID_FALLBACK=false`，`ENABLE_OPS_RBAC=true`，`ALLOW_LEGACY_ADMIN_API=false` | RBAC 完全靠库内角色；env 侧无需变更，但要按 §8c 把库内角色收敛 |
| WeCom 白名单 | `NUXT_AUTH_WECOM_ALLOWED_USERIDS=zhouguangying,caoqian,renjianwei`，`ALLOW_ALL=false` | 目标只有 `zhouguangying`。**需改 PM2 env 并重启（影响共享测试控制面）** |
| WeCom 可信 IP | 用户确认：实例出口 `8.130.81.31` 即企业微信可信 IP（无法从本侧验证企业微信管理端）；登录重定向 `https://hzy.wiztek.cn/api/platform/auth/wecom/callback` | 无 |
| 站点标识 | `NUXT_PUBLIC_PLATFORM_STAGE=test`，显示名“汇智云平台测试控制面” | 要改为生产语义（否则管理页默认环境、文案仍是测试；`LicensesManager.vue`/`deployments.vue` 的默认环境取决于 stage）。改动需重启 |

### 1.2 签名密钥、备份、进程

- `platform_signing_keys`：1 个 active `psk_20260718_AElQdK3VQSja`（Ed25519，2026-07-18 激活），2 个 rotated；`private_key_ref` 前缀为 `env:`——**私钥只通过 PM2 进程环境（`HZY_PLATFORM_SIGNING_PRIVATE_KEY`，base64）提供**，没有独立的密钥文件。未发现该私钥的离线备份（仅 PM2 dump 里有）。§8c 已接受“测试与生产共用同一活动签名密钥”，因此**私钥丢失或泄露将同时影响测试与生产信任链**。
- 备份现状：**没有定时备份**（cron 只有无关爬虫；无 timer）。存在的是逐次操作前的加密备份目录 `/wiztek/hzy-test/backups/*` 与口令文件 `/wiztek/hzy-test/backup-keys/*.pass`（**口令与备份同机**），以及 7 月的 `/var/backups/hzy-platform-dev/*.json`（迁移/策略包 JSON）。Docker 数据卷 `/wiztek/docker-data`（`/wiztek` 盘 195G，已用 49G）。
- 进程管理：PM2，非 systemd；`/wiztek/hzy-test/platform-candidates/gateway-4a36cf66/platform` 是候选目录，非正式发布路径。

### 1.3 C000001 现有 `test` 环境记录（生产写入不得破坏）

- 租户：`C000001` active，`onboarding_stage=runtime_token_pending`；`C000002` active（草稿，订阅 `starter` 已于 2026-06-01 到期，站点 `C000002-main` inactive、`localhost:3180`）。
- 订阅：`C000001` `advanced` active，**2026-05-15 → 2027-09-14**；子订阅 aims/console/workflow/codocs/assets/altoc/finance/webdev/people/enterprise 全部 active，同期限。目标是 **2027-12-31**（§8a）。
- 站点：`wiztek-test`（test，active，`https://hzy-test.huizhi.yun`，root_app_code=enterprise）；`C000001-test`（test，inactive）；`C000001-main`（**prod**，active，`https://hzy-test.wiztek.cn`，root_app_code=NULL）。
- 部署：test 环境 active：`C000001-test-aims/-assets/-codocs/-enterprise/-finance/-people`、`wiztek-test-console`（license active）；**prod 环境已有 7 个 inactive 行**：`C000001-aims/-altoc/-assets/-codocs/-finance/-webdev/-workflow`（license/connectivity 均 pending，`base_path` 多为 NULL）；**没有** `C000001-console`、`C000001-prod-enterprise`、`C000001-collab`。
- License：3 张 active（`ELIC-C000001-test-1`、`LIC-C000001-PEOPLE-TEST`、`lic_console`），均到 2027-09-14。
- Runtime：仅 `c000001-test-tenant-runtime`（test，ready，端点 `https://hzy-test-runtime.isme.dev`，desired `0.3.219-test.adr018-candidate.7`）。`tenant_runtime_credentials` **按 tenant 唯一**（`WHERE tenant_code = ?`，C000001 一行 active，mode `tenant`）。
- 策略包：仅 `C000001/test`，共 30 个，最新 2026-09-29 01:12 UTC；无 `prod`。
- 应用：11 个应用行；**没有 `collab`**；`enterprise` 已注册（`enterprise/app.manifest.json`，`enterprise/`，6 个 manifest，7 个 release，最新 2026-09-28）。`people`、`workflow`、`enterprise` 已是 monorepo 形状，**其余 8 个应用的 `manifest_path=app.manifest.json`、`release_tag_prefix` 为空，`repo_url` 也未指向 monorepo → v2.32 尚未应用**。
- Schema：已含 20260913/14/23/26 各迁移的表；**缺 `20260929-enterprise-external-drain-generation.sql`**（`enterprise_external_drain_approvals` 无 `target_generation`/`artifact_json`），M3d 排空认可需要。
- Enterprise 权益：`tenant_enterprise_entitlement_current` C000001 revision 1（未细读内容）。

## 2. 需要用户/协调者决定的风险点（先于任何写入）

1. **共享活动密钥无离线备份**（§1.2）。写入前必须先离线备份私钥；备份介质与口令处理需用户指定，口令不得经聊天。
2. **口令与备份同机**：现有加密备份的 `.pass` 与产物在同一主机同一盘。建议生产备份的口令/密钥分开存放，产物异地（可放新机）。
3. **`tenant_runtime_credentials` 按 tenant 唯一**：为 `prod` 注册 Runtime 时，若走“签发 tenant 级 Runtime token”会**轮换/替换 C000001 现有 credential，可能使 test Runtime 失效**。P5 前需读 `tenantRuntimeInstanceToken.ts`/`tenantRuntimeEnrollment.ts` 确认 prod Runtime 是否只使用实例级 token（`tenant_runtime_instances.runtime_token_hash/control_token_hash`）而不动租户 credential；不确认前不做该步。
4. **重启影响面**：改 WeCom 白名单、stage、升级发布都要重启 PM2 `hzy-platform-dev`，会中断共享的测试控制面（hzy0/hzy-test 的策略下发、登录）。需要约定窗口并预先通知。
5. **测试仍在使用这个实例**：所有对 `C000001` 的 prod 侧写入必须限定 `environment='prod'`，不得触碰 test 行；每步写后回读 test 行不变。
6. **`gavin` 与异常账号**：停用属于删除/停用性写入，需批准；`gavin,zhouguangying` 是错误 uid，建议停用。
7. **升级路径**：该实例现在运行的是候选目录构建；“升级走正式发布”意味着先从受审提交打正式 tag（如 `platform/v0.2.0`）、构建并按 release 流程切换，之后再做 schema 迁移。是否要在做 prod 登记前先升级，需决定（迁移 `20260929` 与 v2.32 都依赖它）。
8. **主机单点**：GitLab、Keycloak、Nexus、Platform（测试+生产）都在一台阿里云主机。宕机即生产控制面不可用（Runtime 有本地缓存的策略信封，租约期内可继续）。这是已接受代价，但应在 Go/No-Go 记录。

## 3. 为 C000001 `prod` 需要的全部写入（每项：工具/流程、备份、回执、回滚）

通用规则：**每次写入前**对 `hzy_platform_dev` 做加密备份（`docker exec … mysqldump --single-transaction` 管道 gzip + openssl，产物与口令分离，记录 sha256 与解密自检）；每个 `--apply`/API 写入前把 reviewHash/摘要发协调者确认；写后回读并确认 `test` 环境行不变；回执 0600 保存。回滚统一为：优先“正式流程回切”（API/工具的 rollback），不可行时用该步前的加密备份对**受影响表**恢复，不全库覆盖（N9 原则，避免破坏并发的测试写入）。

| # | 写入 | 正式流程/工具 | 备注/风险 |
| --- | --- | --- | --- |
| W0 | 离线备份活动签名私钥；建立每日加密备份 | 新增运维脚本（受审）；私钥备份见 §2-1 | 前置于其余所有写入 |
| W1 | 账号收敛：停用 `gavin`、`gavin,zhouguangying`；确认 `zhouguangying` 是唯一 `ops_super_admin` | Platform ops accounts API/页面（`ops/accounts*`）或受审 SQL | 需批准；写前记录角色分配快照 |
| W2 | WeCom 白名单改为仅 `zhouguangying`；stage/显示名改为生产语义 | PM2 env 变更 + 重启 | 见 §2-4；env 中密钥不打印 |
| W3 | 升级到正式 tag 构建（`platform/v0.2.0`，待定）；应用迁移 `20260929-enterprise-external-drain-generation.sql`；应用 v2.32（8 个应用的 monorepo 源） | `deploy/self-hosted/build.mjs`/`release.mjs`（或既有 PM2 发布流程）；`g9-platform-schema.mjs --inventory`（只读）核对；迁移用受审 SQL | 迁移非事务，写前备份；v2.32 幂等 UPDATE，写前记录 8 行原值 |
| W4 | 注册 `collab` 应用；核对 `enterprise` 应用 manifest/release | `ops/applications/from-manifest`（正式流程，`collab/app.manifest.json`，tag 前缀 `collab/`） | 不新增 SQL 制品；需 `GITLAB_*` 配置（该实例已有 GitLab base/token） |
| W5 | 站点：`C000001-main`（prod）`public_url=https://aidcp.wiztek.cn`，`root_app_code` 待用户确认（Enterprise 挂 `/enterprise/` 时为 NULL 或空，见 §8b） | `ensureDeploymentSite` 经 ops deployment 更新；页面做不到则受审 SQL | 只改 prod 站点，不动 `wiztek-test` |
| W6 | 部署：`C000001-console`（新）、`C000001-workflow/-aims/-codocs/-assets`（沿用，补 `site_id/base_path/api_base`，置 active）、`C000001-prod-enterprise`（企业开通创建）、`C000001-altoc/-finance/-people/-webdev` 保持 inactive；`C000001-collab`（新） | ops `deployments.post`/`deployments/[id].patch`；enterprise 走 `enterpriseProvisioning`；collab 走 `g9-collab-deployment.mjs --plan/--apply/--verify` | 每行 `environment='prod'`；collab 需 W4 完成；回执保存插入 ID 与原值 |
| W7 | 订阅/子订阅到期日 → 2027-12-31；企业权益转换 | `convertEnterpriseEntitlement` 预览→应用；订阅期限经 ops 订阅接口或受审 SQL | 订阅是租户级（`tenant_subscriptions`/`subscriptions` 按 tenant 而非 environment 存放）[推断，W7 前读代码确认]，**很可能同时改变 test 环境订阅期限**；需用户确认这是可接受的 |
| W8 | License：为 `prod` 部署签发（Console license 不含 Vault 字段，`migrated` 标记保持） | ops `licenses.post`（签发路径已支持客户侧持钥） | 用现活动 kid 签发；旧 test license 不变 |
| W9 | Runtime `c000001-prod-tenant-runtime` 注册，规范端点 `https://aidcp-runtime.wiztek.cn`（不做公网解析） | 租户管理员 `install-command` 签发一次性注册码 → 新 Runtime `hzy-data-runtime enroll`（P5，依赖 G-5 Runtime 就位） | 先确认 §2-3；`desiredVersion`/`releaseSigningKeyId` 必须匹配 stable channel；Runtime 关闭自动更新（§8b） |
| W10 | Aims 调度登记 `storage=unified, environment=prod, workerDeployment=C000001-aims, workerClient=aims.runtime, generation=N` | `POST /api/platform/ops/deployments/scheduler-ownership` | 必须在 W9 ready 之后；N 与 Runtime `enterprise.generation` 及 registry 一致 |
| W11 | 策略包：`POST /api/platform/ops/tenants/C000001/bundles {"environment":"prod"}` | 正式发布 | 核对：新修订、kid=现活动 kid、目标只含 W6 中 active 的 prod 部署、homeUrl/回调为 aidcp、payload 无 74 对孤儿资源；`test` 包不变 |
| W12 | M3d/排空认可 profile 钉住的 Platform kid/公钥 → 该实例活动密钥 | 更新 profile（新机 S3/生产 profile），非 Platform 写入 | `S3-ONLY` 演练密钥仍禁止用于生产认可 |

不使用（因会破坏共享实例）：`g9-platform-sanitize`（清空会话、bundle、heartbeat、enrollment 等）、`g9-platform-data`（整体停用/改写测试站点与部署）、克隆恢复类步骤。`g9-orphan-gate`（只读，74 对）与 `g9-platform-schema --inventory` 可用于只读核对。

## 4. 自托管侧引用 `platform.wiztek.cn` 的清单与改为 `https://hzy.wiztek.cn` 的建议

**必须改（运行配置模板与构建）**

| 文件 | 行 | 键/内容 |
| --- | --- | --- |
| `deploy/self-hosted/build.mjs` | 61 | `HZY_PLATFORM_URL`（构建期写死） |
| `deploy/self-hosted/env/console.env.example` | 22, 63 | `HZY_PLATFORM_URL`、`NUXT_PLATFORM_BASE_URL` |
| `deploy/self-hosted/env/enterprise.env.example` | 22, 27, 59 | `HZY_PLATFORM_URL`、`HZY_ENTERPRISE_POLICY_ISSUER`、`NUXT_VERIFIED_POLICY_ISSUER`（策略 issuer 必须等于 Platform 的 `HZY_PLATFORM_POLICY_ENVELOPE_ISSUER`，该实例当前为 `https://hzy.wiztek.cn`） |
| `deploy/self-hosted/env/{aims,codocs,workflow}.env.example` | 22/24 | `HZY_PLATFORM_URL` |
| `console/.env.prod.example` | 24 | `HZY_PLATFORM_URL` |
| `platform/scripts/g9-official-trust-plan.mjs` | 14, 32, 42–45 | `platformOrigin`、Console/Enterprise/Runtime `control.platformUrl`/Gateway `platform.origin` 输出 |
| Runtime 配置（运行期，非仓库） | — | `control.platformUrl`、策略 issuer、`platformSigningKeyId`/公钥 → 现活动 kid `psk_20260718_AElQdK3VQSja` 及其公钥 |
| Gateway 配置（`gateway.json`，运行期） | — | `platform.origin`、`platformRegistryToken`（须在 Platform `PLATFORM_INTERNAL_SERVICE_TOKENS` 集合内，与应用 token 不同，见 §3.4） |

**作废/改写（不再运行 Platform）**：`deploy/self-hosted/env/platform.env.example`、`platform/.env.prod.example`、`platform/deploy/nginx/*`、`deploy/self-hosted/platform-ingress/nginx.conf.example`、`deploy/self-hosted/README.md`（8782 反代、`platform.wiztek.cn` 后端两行）、`deploy/self-hosted/platform-bootstrap/README.md`（整体转为存档说明）、`deploy/self-hosted/systemd/hzy-platform.service`。

**文档**：`docs/Go-Live-Self-Hosted-Topology-Plan.md`（第 24、57 行）、`Go-Live-Self-Hosted-Data-Migration-Runbook.md`（21、172 行）、`Platform-Console-Prod-Dev-Isolation-Plan.md`（14 处）及 `scripts/validate-*.mjs`/`probe-*.mjs`（公开路由与 Runtime 隔离检查里的 `platform.wiztek.cn` 期望值）需要同步或标注取代。`docs/Go-Live-Self-Hosted-Platform-Plan.md` 已由 §8c 标注取代，不重复改。

**网络路径（新机 → `hzy.wiztek.cn`）**：从新机实测公网 HTTPS 可达：解析 `8.130.81.31`，`GET /` 200、TCP+TLS 连接约 28 ms。tailnet 路径（`100.98.120.65:443`）也通，但需要自行处理 Host/证书（未测试），**建议用公网 HTTPS**（与测试 Runtime 一致）。Platform 本身只监听 `127.0.0.1:3011`，`hzy.wiztek.cn` 由该主机 nginx 反代。Runtime/Gateway/Console 在新机只需出站 443。

## 5. 顺序与批准点（每步单独批准）

1. **G-9a 只读收尾**（无需写入）：读 `tenantRuntimeInstanceToken.ts`/`tenantRuntimeEnrollment.ts` 确认 §2-3；读 `enterpriseProvisioning.ts`/订阅接口确认 W7 是否会影响 test；用 `g9-orphan-gate` 对该库做只读 74 对检查。
2. **G-9b 保护**：W0（离线备份密钥 + 每日备份 + 异地）→ W1（账号收敛）→ W2（白名单/stage，重启窗口）。
3. **G-9c 升级**：W3（正式 tag、迁移 20260929、v2.32）→ 复查。
4. **G-9d 登记**：W4 → W5 → W6 → W7 → W8。
5. **G-9e 运行时**：W9 → W10（依赖 G-5 Runtime 就位）→ W11 → W12。
6. **G-7**：grant/签发探测（原计划 §5），在 W11 之后。
7. 每步后回读：`test` 环境行、策略包、签名密钥、账号不变量；失败回滚见 §3 通用规则。

## 6. 未在本次复查覆盖

- 未读取 `tenant_enterprise_entitlement_current` 细节、策略包内容、`policy_bundle_targets`、`scheduler` 表结构（`tenant_scheduler_ownership` 无 `status` 列，需另行读结构）。
- 未验证企业微信管理端的可信 IP 配置；未测试实际登录。
- 未评估该主机的容量与 PM2 保存配置（`pm2 save`/开机自启）。

## 7. G-9a 只读收尾结果（2026-09-30 凌晨，仅代码阅读与 `START TRANSACTION READ ONLY` 查询）

### 7.1 风险 3：prod Runtime 注册是否会替换 tenant 级 credential

- `tenant_runtime_credentials` 主键是 `tenant_code`（C000001 仅一行，active）。`issueRuntimeToken` 是 `INSERT … ON DUPLICATE KEY UPDATE`：**对同一租户再次签发就是轮换，旧 token 立即失效**；`revokeRuntimeToken(tenantCode)` 按租户撤销，**即使从 prod 部署的接口触发，也会撤销整个租户的 credential**。调用方：`tenants/runtime-token.post.ts`、`ops/deployments/[deploymentCode]/runtime-token.post.ts` / `.delete.ts`、`onboardingFlow.ts`（1206/1353/1460）。
- Runtime **注册（enrollment）不经过这条路径**：`tenantRuntimeEnrollment.ts` 按 `(tenant_code, environment)` 在 `tenant_runtime_instances` 建/更新实例（唯一键 `uk_tenant_runtime_instances_tenant_env`），令牌是实例级（`runtime_token_hash`、`hzy_ctl_`/`hzy_dr_` 前缀，`tenantRuntimeInstanceToken.ts`），不读写 `tenant_runtime_credentials`。企业开通 `enterpriseProvisioning.ts:52` 只读取并要求现有 credential 为 active；`issueInitialRuntimeToken` 已存在则原样返回、不轮换。
- **结论**：走 `install-command` → `hzy-data-runtime enroll` 注册 prod Runtime 不会影响 test Runtime（test 实例 `c000001-test-tenant-runtime` 与 prod 实例是不同行）。**红线：对 C000001 不得调用 `runtime-token` 的 POST/DELETE（任何环境的部署入口）**，也不得重做 onboarding 的“签发 Runtime token”步骤；否则会使 test 侧租户 credential 失效。无需代码改动，写进执行单禁令即可；若要加保险，可另立小改动让这两个 ops 接口在 `environment≠该 credential 所属环境`时拒绝（不建议在上线窗口内改）。

### 7.2 风险 8：订阅/权益租户级？改到 2027-12-31 对 test 的影响

- `tenant_subscriptions`、`subscriptions`、`tenant_enterprise_entitlement_current` 的列里**没有 environment**，按 `tenant_code`（子订阅另按 `app_code`）存放；因此**订阅期限是租户级，test 与 prod 共享**。把 `ended_at` 从 2027-09-14 改到 2027-12-31 只会**延长** test 的订阅期，不会缩短，不会使现有 test 部署失效。
- 已签发的 license 有独立的 `expires_at`（现有 3 张仍是 2027-09-14），不随订阅自动变化；prod 的新 license 才带 2027-12-31。权益转换会使 `tenant_enterprise_entitlement_current.revision` 递增（当前 1）；test 的下一次策略/授权发布会读取新权益，行为上等同延长。需要在 W7 的预览里核对转换结果，确认 test 侧策略包内容仅有期限变化。

### 7.3 只读孤儿门禁与 schema inventory（对 `hzy_platform_dev`，READ ONLY 事务）

- `g9-orphan-gate` 的 74 对 SQL（`docs/Go-Live-Prod-Read-Only-Checklist.md` §02，原样执行）：**0 行**。
- G9 迁移所建 18 张表：**全部存在，0 缺失**。
- `20260929-enterprise-external-drain-generation.sql`：`enterprise_external_drain_approvals` **没有** `target_generation`、`artifact_json`，也没有 `uk_external_drain_generation` → 状态为 `absent`（不是部分安装），迁移可干净应用。
- v2.32：8 个应用未指向 monorepo（见 §1.3），需在 W3 应用。

### 7.4 从候选构建升级到正式 tag 的最小路径

- 现状：运行的是 `/wiztek/hzy-test/platform-candidates/gateway-4a36cf66/platform`（候选目录，源码提交 `4a36cf66c`，PM2 由 `/wiztek/hzy-test/platform-dev.config.json` 驱动，0600）。自 `4a36cf66c` 起 `platform/` 有 12 个提交、27 个文件变化（含 G-9 排空认可、客户侧持钥 license 签发、Collab 部署登记、WeCom API 基址）。
- 建议提交：打 `platform/v0.2.0` 于**代码冻结后**的受审提交（当前分支 HEAD 之后，须先确认 Platform 相关测试已过并由用户批准冻结）；不使用带 `test` 的 tag。tag 推 GitLab 属外部写入，单独批准。
- 构建位置：**在 gitlab 主机上构建**，沿用现有做法（`/wiztek/hzy-test/build-platform.sh`）：受审提交 `git archive` 成 `platform-source-<sha>.tar.gz` → 传到主机核对 sha256 → 解包到新目录 → `pnpm --filter 'platform...' install --frozen-lockfile --ignore-scripts`（`registry.npmmirror.com`）→ `nuxt build --preset=node-server` → 得到 `.output/server/index.mjs`；不含任何生产 dotenv。Node 用 `/root/.nvm/versions/node/v24.18.0`（与运行一致）。该主机有 Nexus/npm 镜像访问，不需要新机出网。
- 切换：复用 `e1-platform-switch.cjs` 的 `prepare/switch/rollback/persist` 模式（新写一份参数化脚本，不改历史脚本）：`prepare` 备份 PM2 config、进程 env 摘要与快照，核对 DB 名 `hzy_platform_dev`、端口 3011；`switch` 只把 `cwd` 指向新候选目录并 `pm2 restart <config> --only hzy-platform-dev --update-env`，健康检查 `http://127.0.0.1:3011/api/health`，确认其它 PM2 进程 pid 不变；`persist` 才执行 `pm2 save`。**回滚**：把 config 恢复为旧 `cwd`（gateway-4a36cf66）并重启。
- 迁移顺序：`20260929` 迁移是 `ADD COLUMN … NULL` 加唯一索引，旧构建不读这两列，因此**先迁移、后切换**，切换失败回滚 PM2 即可，不必回滚库；迁移三步非事务，写前加密备份，若中途失败按 `drainGenerationState` 判定“部分安装”并从备份恢复该表。v2.32 是幂等 UPDATE，写前记录 8 行原值。W2 的 env 变更可与切换合并为一次重启，以减少对测试控制面的中断。

## 8. 用户决定与待办（2026-09-30）

- **W0**：签名私钥离线备份由用户在 gitlab 主机终端交互输入口令执行 `/root/hzy-g9/w0-backup-signing-key.sh`（公钥指纹须为 `sha256:00495074…9935`）；完成前不做其余写入。
- **W1**：批准；停用 `gavin` 与 `gavin,zhouguangying`，运维只剩 `zhouguangying`；先备份后回读。
- **W2（选 A）**：企业微信白名单**只保留 `zhouguangying`**（去掉 `caoqian`、`renjianwei`）；`PLATFORM_STAGE` 与显示名去掉“测试”；与 W3 的切换合并为一次重启。原因（代码事实）：`callback.get.ts:106–115` 得到 `allowProvision`，`platformAuth.ts` 的 `upsertWecomAdmin` 末尾 `if (options.allowProvision) grantOpsSuperAdminRoleToAccount(...)`，即**白名单用户每次企业微信登录都会（重新）获得 `ops_super_admin`**。
- **W3**：批准；冻结检查已过（`platform` 单元测试 348/348，`nuxt typecheck` 通过，HEAD 为 f9b3de7c 之前的 platform 代码）；打 `platform/v0.2.0` 推 GitLab（不推 GitHub）；gitlab 主机按 `build-platform.sh` 方式构建；写前加密备份后装 `20260929` 迁移与 v2.32；PM2 只重启 `hzy-platform-dev`，其它进程 pid 不变；健康检查、回读 test 行不变，确认后 `pm2 save`。
- **红线**：对 C000001 不得调用 `runtime-token` POST/DELETE，不得重做 onboarding 的 Runtime token 签发。
- **待办 B（暂不做）**：把“允许企业微信登录”与“自动授予 `ops_super_admin`”分离——自动授予只对 `NUXT_SECURITY_OPS_UIDS` 中的 uid；白名单其他人首次登录只建无角色 staff 账号。需要补测试：角色不自动授予、撤销后不复活、已有账号不受影响。落地前白名单只能保持 `zhouguangying`。

## 9. 执行记录（2026-09-30 凌晨，北京时间；证据均在 gitlab 主机 `/root/hzy-g9/`、`/wiztek/hzy-test/platform-candidates/w3-platform-v0.2.0/` 及新机 `/home/hzy-backup/`）

- **W0**：用户在 gitlab 主机终端交互加密签名私钥，产物 `platform-signing-key-20260929T173723Z.enc`（240 B），sha256 `5bb3b497…fda29`；公钥指纹 `sha256:00495074…9935` 与 DB 中 active 密钥 `psk_20260718_AElQdK3VQSja` 一致。副本在新机 `/home/hzy-backup/platform-signing/`（0700/0600），sha256 三处一致。口令只在用户手中。
- **每日加密备份**：gitlab 主机 `hzy-platform-dev-backup.timer`（每日 02:40 CST）→ `pd_backup.py`（docker exec mysqldump → gzip → AES-256-CBC，随机密钥经新机 RSA-4096 公钥包装）→ 受限 ed25519 强制命令推送到新机 `/home/hzy-backup/platform-dev/`（保留 30 天，不覆盖）。RSA 私钥仅在新机 `/root/.hzy-keys/`。已验证还原：`hzy_platform_dev-20260929T174050Z` 恢复到临时库 103 张基表。**待办**：RSA 私钥的口令加密离线副本（由用户执行）。
- **W1**：写前备份 `…T174232Z`；`gavin`（id 1）、`gavin,zhouguangying`（id 94）置 `disabled`，其 `ops_super_admin` 分配 `expired_at` 置当前 UTC（保留行）；`zhouguangying`、租户管理员与会话不变。回滚：`UPDATE platform_account_roles SET expired_at=NULL WHERE id IN (1,69); UPDATE platform_accounts SET status='active' WHERE id IN (1,94);`。
- **W3**：`platform/v0.2.0`（注解 tag，指向 `54e54837`）已推 GitLab（未推 GitHub）；冻结检查：`platform` 单元测试 348/348、`nuxt typecheck` 通过、`platform/`/`deploy/self-hosted` 自 `4c24a9fb` 无变化。源码包 `platform-source-54e54837.tar.gz` sha256 `8489866d…f669` 上传 gitlab 主机，按 `build-platform.sh` 方式构建，`platform/.output/server/index.mjs` sha256 `45cc5b3c…33b4`。写前备份 `…T175915Z`（新机核验通过）；应用 `20260929-enterprise-external-drain-generation.sql`（`target_generation`/`artifact_json` 两列、`uk_external_drain_generation`，唯一 1 行回填，无重复）；应用 v2.32（**仅 8 个应用**：aims、altoc、assets、codocs、console、finance、insights、webdev；`enterprise`/`people`/`workflow` 已是 monorepo 形状，只在 `repo_url` 末尾 `.git` 上与文件不同，未改）。PM2 只重启 `hzy-platform-dev`（17:59:56 UTC 切换，健康 200），其余进程 pid 不变；W2 env 同一次重启：`NUXT_PUBLIC_PLATFORM_STAGE=production`、显示名“汇智云平台控制面”、企业微信白名单 `zhouguangying`（`NUXT_AUTH_WECOM_ALLOWED_USERIDS` 与 `WECOM_OAUTH_ALLOWED_USERIDS`）。切换前后快照（test 部署/站点、prod 行、license、策略包、Runtime 实例/credential、签名密钥、订阅、权益、账号）逐项哈希一致，仅 `platform_applications` 因 v2.32 变化；测试 Runtime 在新构建下心跳 18:02:17 UTC 正常（`runtime_version_incompatible` 在切换前的 17:57:16 心跳里已存在，非本次引入）。`persist` 已把 dump.pm2 中该进程指向新构建（其它条目不变）。
- **回滚**：`node /root/hzy-g9/w3-platform-switch.cjs rollback` 恢复旧候选构建与旧 env；库变更为加性，旧构建不读新列，无需回滚库（如需回滚 v2.32，用备份 `…T175915Z` 中 8 行原值）。

## 10. W4–W11 只读预检与预览汇总（2026-09-30，未写入；对象：`hzy_platform_dev`，代码为 `platform/v0.2.0`）

通用：所有 prod 写入限定 `environment='prod'`（或只作用于 prod 站点/部署/租户环境行）；每步前 `python3 /root/hzy-g9/backup/pd_backup.py` 做加密备份（新机核验）；写后重跑 `/tmp/snap.mjs` 式快照（test 部署/站点/license/runtime/credential/签名/账号等逐项哈希），要求除该步预期变化外全部不变。红线：不调用 `runtime-token` POST/DELETE、不执行 onboarding 的 `runtime_token` 步骤（`onboardingFlow.ts` 的 `runOnboardingStep('runtime_token')` 会调用会轮换 tenant 级 credential 的 `issueRuntimeToken`）。

### 10.1 依赖顺序（修正版）

`W4 应用注册（含新 tag） → W5 prod 站点 URL → W6a 建 prod 部署（console 先行）+ Console Vault migrated 标记 → W7 权益延期（订单） → W6b 企业开通（enterprise 部署 + console license，onboarding startOnboarding） → W6c 其余 prod 部署置 active + 路由 → W8 其余 license → W9 Runtime 注册 → W10 Aims 调度登记 → W11 prod 策略包 → G-7`。

### 10.2 逐项

| # | 正式流程/接口 | 将写入的行/字段（无秘密） | 限定 prod | 备份/回读判据 | 回滚 |
| --- | --- | --- | --- | --- | --- |
| W4 | `POST /api/platform/ops/applications/from-manifest`，body `{repoUrl:"https://gitlab.wiztek.cn/huizhi-yun/huizhiyun.git", version:"collab/v<x>", releaseTagPrefix:"collab/", manifestPath:"collab/app.manifest.json"}`；enterprise 新正式版走 `applications/enterprise/manifests/import-from-gitlab` | `platform_applications` +1 行 `collab`（`app_type=internal`，`service_role`＝manifest 的 `supporting_service`，`auth_mode=service`，`bundle_enabled=0`）；`platform_app_manifests`/`platform_app_releases`/资源（1 个 `runtime` 资源）+ role materialization。enterprise：新增 manifest/release 行，`latest_manifest_id` 前移 | **应用/manifest/release 不分环境，是租户共享事实**：新增 collab 不影响 test；enterprise 新 manifest 会成为 test 也读取的“latest”，需评估 | 写前备份；回读 `platform_applications` 12 行、collab `manifest_path=collab/app.manifest.json`、tag 前缀 `collab/`；test 快照除 apps 外不变 | 删除刚插入的 collab 应用/manifest/release 行（有 id 回执）；enterprise 新版本 `platform_app_releases.status` 置回并把 `latest_manifest_id` 还原（备份中有原值） |
| W5 | ops deployment-sites 更新（`ensureDeploymentSite` 会改 prod 站点 URL）；页面做不到则受审 SQL | `deployment_sites` id 4 `C000001-main`：`public_url` `https://hzy-test.wiztek.cn` → `https://aidcp.wiztek.cn`；`root_app_code` 保持 NULL（Enterprise 挂 `/enterprise/`） | **核对结论**：test 部署全部挂 `wiztek-test`（site_id 1）；**没有任何部署引用 site 4**，改 site 4 不会影响 test 入口 | 备份；回读 site 1/3 不变，test 部署行哈希不变 | `public_url` 还原为原值（备份/回执） |
| W6a | ops `deployments.post`（`environment='prod'`）或 `deployments/[id].patch` | 新增 `C000001-console`（prod，`site_id=4`，`base_path=/console/`，`deployment_mode/region` 沿用 test console，`status=active`，`license_status=pending`）；**现有 7 个 prod 行的 `site_id` 全指向 test 站点 1（altoc/assets/codocs/finance/webdev）或 NULL（aims/workflow），须全部改到 site 4**并补 `base_path/api_base`（workflow `/workflow/`、aims 无用户入口）。`C000001-altoc/-finance/-webdev` 保持 inactive；`C000001-assets/-codocs/-workflow/-aims` 置 active | 每条 `WHERE environment='prod' AND deployment_code=…`；不触碰 `C000001-test-*`、`wiztek-test-console` | 备份；回读 test 部署 7 行哈希不变；prod 行逐字段与预览一致 | 按备份逐行还原字段（含 `site_id`） |
| W6a′ | **受审 SQL（无正式 API）**：`deployment_bootstrap_secrets` 插入 `migrated` 标记 | 新 console 部署 id：`(deployment_id=<新id>, tenant_code=C000001, app_code=console, secret_code='console.vault.master_key', secret_name='Console vault master key', status='migrated', secret_value=<生产 Vault 主密钥指纹>)`；指纹 `3b1b0e37c78e516dd17853b1cb895687` 已在 S3 用日本机密钥与 `vault_secret_versions.key_fingerprint` 成对核对，不是秘密 | 仅新 prod console 部署 id | **关键**：`resolveConsoleVaultMasterKeyForIssuance` 只认该部署 id 上的 `migrated` 行；没有它，签发 license 会**为新 console 部署生成一把 Platform 持有的新主密钥并把指纹写进 license**（与生产 Vault 数据不匹配）。必须先于 W6b/W8。test console（id 3）当前是 Platform 持有的 active 密钥，不动 | 删除该行 |
| W7 | 企业订单流：`platform_orders`（tenant-admin `enterprise-orders`）→ `confirmEnterprisePayment`（`platform_payments`）→ `POST /ops/subscriptions/orders/{orderNo}/enterprise-fulfillment`（`fulfillEnterpriseOrderInTransaction`） | 新 `tenant_enterprise_entitlements` revision 2（`effective_until=2027-12-31…`，`effective_from` ≤ 现 `2027-09-14 23:59:59` 且延续，守卫要求“延长且无缺口”）；`tenant_enterprise_entitlement_current.revision=2`；`tenant_enterprise_order_fulfillments` +1。**需要真实订单/付款记录**（金额、币种、`transaction_ref`、支付日期）——是商业事实，需用户提供，不能编造。`tenant_subscriptions`/`subscriptions.ended_at`（现 2027-09-14）**不会被订单流修改**；如需对齐 2027-12-31 用受审 SQL（只延长） | 权益与订阅**租户级、无 environment 列**：延长同样作用于 test | 备份；回读 revision=2、test 部署/license/runtime 行不变。**预览结论**：`loadBundleEnterpriseEntitlement` 读当前 revision，策略包 payload 里含 `enterpriseEntitlement{revision,period…}`，`bundleEnterpriseEntitlementMatches` 不匹配会让**已有 test 包判为过期并在下次取用时重新生成**；重新生成的 test 包只有权益 revision 与 `effectiveUntil` 变化（期限延长，行为不变）。`convertEnterpriseEntitlement` 无 API 入口，不适用于本步 | `tenant_enterprise_entitlement_current.revision` 改回 1（revision 2 行保留作审计）；订阅日期 SQL 用备份原值还原 |
| W6b | 企业开通 `startOnboarding`（`planCode='enterprise-full'`，`environment='prod'`，`deploymentCode='C000001-console'`，`consoleBasePath='/console/'`，站点 `C000001-main`）→ `prepareEnterpriseProvisioning` | 复用 W6a 的 console 部署；新增 `C000001-prod-enterprise`（`${tenant}-${env}-enterprise`）、subscription 行（如缺）、console license `ELIC-C000001-prod-<revision>` + `license_deployments`；`deployments.license_status=active`。前置：当前权益 active（W7 后 revision 2）、tenant credential 为 active（是）、`console`/`enterprise` manifest 存在且哈希一致（`requireEnterpriseProvisioningManifests`）。onboarding 对 `enterprise-full` 用 `issueInitialRuntimeToken`（已存在则原样返回，不轮换）；`finalizeOnboarding` 对 enterprise-full 禁止 `rotateRuntimeToken`。**不得执行 step `runtime_token`** | 只处理 `environment='prod'` | 备份；回读 license payload **无 Vault 字段**（W6a′ 生效），`enterprise_recovery_routes` 等不变 | license/subscription/enterprise 部署行按回执删除；恢复 credential 快照不变 |
| W8 | 其余 prod 部署 license：`POST /ops/licenses`（`tenantCode, deploymentId, licenseCode, planCode, issuedAt, expiresAt, capabilities`）；console license 已由 W6b 生成，**不再单独签** | 为 W6a 置 active 的 workflow/aims/codocs/assets 部署（按需要）签 license，`expiresAt=2027-12-31` | 每次 `deploymentId` 指向 prod 部署 | 备份；回读；签名 kid＝现活动 `psk_20260718_AElQdK3VQSja`；旧 test license 不变 | 置 `licenses.status='revoked'` 或删除新行（有 id） |
| W9 | 租户管理员 `install-command.post`（`tenant-admin/deployment-settings`）→ 新 Runtime `hzy-data-runtime enroll` | `tenant_runtime_instances` +1（`c000001-prod-tenant-runtime`，prod，`runtime_endpoint=https://aidcp-runtime.wiztek.cn`，`desired_version`=stable 已批准的 `0.3.219-test.adr018-candidate.7`，`release_signing_key_id` 与现设置一致）；`tenant_runtime_enrollments`；`tenant_runtime_instance_apps`；实例级 `hzy_ctl_`/`hzy_dr_` 令牌（哈希）。**只能由租户管理员会话发起**（账号 `u_Dc3Q…` 是 tenant_admin），需要用户登录操作 | 实例键 `(tenant_code, environment)` 唯一，与 test 实例是不同行 | 备份；回读 test 实例行（`ready`、版本）不变；`tenant_runtime_credentials` 快照不变 | 删除 prod 实例/enrollment/apps 行；令牌哈希随之失效 |
| W10 | `POST /api/platform/ops/deployments/scheduler-ownership`（`storage=unified, environment=prod, runtimeCode=c000001-prod-tenant-runtime, workerDeployment=C000001-aims, workerClient=aims.runtime, generation=N, expectedRevision=0`） | `tenant_scheduler_ownership` +1 行 `(C000001, prod)`，`tenant_scheduler_ownership_receipts` +1。前置：prod 实例 `ready`，prod 下恰有 1 个 active `aims` 部署且编码相同；`N` 必须等于 Runtime `enterprise.generation` 与统一库 registry（本次演练 profile 里为 1） | 键含 environment；现有一行是 `(C000001,test,generation=1)`，不冲突 | 备份；回读 test 那行不变 | 用 `storage='disabled'` 走同一接口，或按回执删除 |
| W11 | `POST /api/platform/ops/tenants/C000001/bundles {"environment":"prod"}`（或 internal 版） | `policy_bundles` +1（`tenant=C000001, environment=prod`），`policy_bundle_targets`（仅 active prod 部署）；payload 含权益 revision 2、host 路由（`/enterprise/`）。前置：至少 1 个 active prod 部署（W6）、权益有效、74 对孤儿门禁 0 行（已核：0） | 环境入参 `prod`；test 包不因本步新增 | 备份；回读：kid＝活动 kid、目标＝W6 active 集合、homeUrl/回调为 aidcp、无 74 对资源、test 包数量与内容哈希不变（除 W7 引起的重新生成外） | 该步幂等；回滚＝把 prod 包置为 `revoked`/删除新行 |

**与 G-7 的顺序**：策略包生成**不依赖** G-7 grant（grant 在 Console 库，不在 Platform）；G-7 的 prod seed/verify/13 项签发探测依赖 W9（Runtime ready）、W11（策略包）和新机 Console，所以放在 W11 之后。

### 10.3 需要另批的外部动作（新增）

1. **`collab` 新 tag**：GitLab 上 `collab/v0.1.0` 已存在，但它指向 2026-05-17 的旧提交，manifest 缺 `serviceRole` 且带 `collab:operator`/`collab:admin` 两个 recommendedRoles；当前 HEAD 的 manifest（`serviceRole:"supporting_service"`，`recommendedRoles:[]`）才是 G-9 collab 部署登记工具校验的形状。若从 `v0.1.0` 注册会**多出两个不需要的 collab 角色**，`service_role` 也会落到默认值。建议在当前受审提交打 `collab/v0.1.1` 后再 from-manifest。
2. **`enterprise` 正式 tag**：现有 4 个 tag 中最新为 `enterprise/v0.3.279-test.c000001-rollout.5`（带 test）。§3.5 要求从受审提交打正式 tag（如 `enterprise/v0.4.0`）；导入新 enterprise manifest 会改变共享应用的 latest，须先评估 test 侧影响。
3. **商业事实**：W7 的订单/付款字段（金额、币种、交易号、支付日）需由用户提供或明确“内部授予”的记录方式。
4. **租户管理员会话**：W9 的 `install-command` 需以 tenant_admin（`u_Dc3Q…`）登录后由用户或经批准的方式执行。

### 10.4 test Runtime 心跳 `runtime_version_incompatible` 的原因（只读）

- 来源：`platform/server/api/v1/runtime/agent-heartbeat.post.ts:93`——`runtimeVersion !== releaseTarget.desiredVersion` 时置该码。test 实例 `desired_version=0.3.219-test.adr018-candidate.7`（stable 通道已批准的 release id 2），而本机 hzy0 Runtime 报告 `0.3.292-test.c000001-b1b2.6`（本地更新的候选构建），二者不等。
- 影响：**无**。代码明确“release drift is an update signal, not a data-plane outage”，`status` 仍是 `ready`，实例照常可路由/解析；心跳仍在写入（切换前后均正常）。
- 对后续的意义：(1) W9 的 prod Runtime 也会因“本机固定版本 ≠ stable 已批准版本”得到同样的良性 `runtime_version_incompatible`，可接受，前提是 Runtime 关闭自动更新（`auto-update-policy.json`）；(2) 不要为了消除该码而在共享 Platform 上把 stable 通道改到新版本——`resolveDataRuntimeReleaseTarget` 会在心跳里把所有实例（含 test）的 `desired_version` 自动推进到新批准版本，并可能触发 test Runtime 的更新，属于跨环境耦合。

## 11. 执行记录二（2026-09-30 凌晨）：tag、W5、W6a、W6a′；W4/W7 延后

- **tag（只推 GitLab）**：`collab/v0.1.1`、`enterprise/v0.4.0`，均指向 `978eb851`。enterprise 导入评估：库内 latest manifest（id 54，seq 6）与 `enterprise/v0.4.0` 的 `app.manifest.json` 逐键一致 → 导入只会命中复用并新增注册记录与 draft release，不改变 manifest 与 test 策略包；导入仍待批准。
- **W4（collab 应用注册与部署登记）延后**到正式启用协作时与其它协作环境项一起做；**W7（权益续期）延后**：订阅计划页面尚未完成，当前权益到期 2027-09-14 足够；W6b/W8 的 license 按现有权益有效期（到 2027-09-14）签发。
- **W5**（受审 SQL，事务）：`deployment_sites` id 4 `C000001-main`（prod）`public_url` `https://hzy-test.wiztek.cn` → `https://aidcp.wiztek.cn`；事先确认无部署引用该站点。回滚：`UPDATE deployment_sites SET public_url='https://hzy-test.wiztek.cn' WHERE id=4`。
- **W6a**（用户 zhouguangying 委托会话，经 `/api/platform/ops/deployments`，审计记在其名下；会话文件用后已删除并回读确认）：写前加密备份 `…T184710Z`（新机核验通过）。`POST` 新建 `C000001-console`（id 20，prod，`subscription_id=6`，`site_id=4`，`base_path=/console/`，`api_base=/api/v1/console`，`deployment_mode=customer-hosted`，`status=active`，`license_status=pending`）。`PATCH` 现有 7 个 prod 部署的 `basePath`（触发按 prod 活动站点重算 `site_id`）：aims(4) `/aims/`、workflow(5) `/workflow/`、codocs(6) `/codocs/`、assets(7) `/assets/`、altoc(8) `/altoc/`、finance(9) `/finance/`、webdev(13) `/webdev/`，全部 `site_id=4`、`route_source=platform_override`、**状态仍为 inactive**（激活留待 W6c）。原值（回滚依据）：aims/workflow 原 `site_id=NULL`、`base_path/api_base=NULL`、`route_source=default`；codocs/webdev 原 `site_id=1` `route_source=platform_override`；assets/altoc/finance 原 `site_id=1` `route_source=default`；其余字段原 `base_path`/`api_base` 与新值相同。回滚：按上列原值 `UPDATE deployments SET site_id=…,base_path=…,api_base=…,route_source=… WHERE id=…`，并删除 id 20（无 license、无 runtime 引用）。
- **W6a′**（受审 SQL，事务，带守卫）：写前备份 `…T184825Z`；`deployment_bootstrap_secrets` 插入 `(deployment_id=20, tenant_code=C000001, app_code=console, secret_code=console.vault.master_key, secret_name='Console vault master key', secret_value='sha256:3b1b0e37c78e516dd17853b1cb895687', secret_last4=NULL, status='migrated')`（39 字符指纹，非密钥；test console id 3 的 active 行未动）。此后为 `C000001-console` 签发 license 将走 customer-held，不带 Vault 字段。回滚：`DELETE FROM deployment_bootstrap_secrets WHERE deployment_id=20 AND secret_code='console.vault.master_key' AND status='migrated'`。
- **回读**：写前后 12 组快照，除 `prodRows`（7→8 行）外全部一致：test 部署、test 站点、license、策略包、Runtime 实例、credential、签名密钥、订阅、权益、账号、应用均不变；`hzy-platform-dev` 健康 200。红线遵守（未调用 runtime-token POST/DELETE）。

## 12. W6b–W8 只读预检与一次会话操作清单（2026-09-30，未写入）

### 12.1 只读预检结果

- **`requireEnterpriseProvisioningManifests` 哈希预检（对 `hzy_platform_dev` 只读复现其检查）**：enterprise 最新 manifest（id 54，active）`composition.kind=hzy-enterprise-composition`，3 个模块：`aims`（已登记 manifest 51）、`assets`（52）、`codocs`（53）。每个模块：声明的 `manifestHash` = sha256(canonical(module.manifest)) ✔；已登记的最新 manifest 与 `module.manifest` canonical 相等 ✔；所需资源动作在 `platform_app_manifest_resource_actions` 中全部存在（aims 185 / assets 54 / codocs 41，缺失 0）✔。→ **W6b 的 manifest 前置全部满足，无需先导入 `enterprise/v0.4.0`**（其 manifest 与 id 54 逐键一致，导入只会新增注册记录与 draft release）。
- 其它前置：租户 `C000001` active、`onboarding_stage=runtime_token_pending`；当前权益 revision 1 active（到 2027-09-14）；`tenant_runtime_credentials` active；`console`(subscription 6)、`enterprise`(subscription 17) 子订阅 active；`C000001-console`（id 20）active + `migrated` 标记；活动 prod 站点 `C000001-main`（site 4）。
- **onboarding 的 tenant 级副作用（须知）**：`tenant_onboarding_steps` 按租户存放、无 environment；`startOnboarding(enterprise-full)` 会用 prod 信息覆盖 `tenant/console_app/subscription/deployment/license/runtime_token` 各步的 payload 与 `completed_at`（当前 9 步：前 7 步 completed、`bundle` blocked、`finalize`…），test 的 onboarding 页面因此显示 prod 部署/license 摘要。写前备份含原值；属只读展示信息，不影响 test 运行。
- **license 与 test 的对齐**：test 环境只有 console（`wiztek-test-console`：`lic_console`、`ELIC-C000001-test-1`）和 people 有 license；aims/assets/codocs/finance/enterprise 部署 `license_status` 为 pending 或由开通设置。因此 **W8 不需要为 workflow/aims/codocs/assets 另签 license**，只保留 W6b 生成的 console license（`ELIC-C000001-prod-<revision>`）即可；如用户仍要求逐部署签发，再按 `POST /ops/licenses` 单独批准。

### 12.2 一次会话内的操作清单（用户提供方案 B 会话后，逐步写前备份、写后回读 12 组 test 快照）

| 步 | 接口/请求 | 预期写入 | 预期回读 | 回滚 |
| --- | --- | --- | --- | --- |
| 1 W6b | `POST /api/platform/ops/onboarding/start`，body `{"tenantCode":"C000001","tenantName":"<现名>","planCode":"enterprise-full","environment":"prod","deploymentCode":"C000001-console","consoleBasePath":"/console/","generateBundle":false}`（**不带** `licenseExpiresAt`/`runtimeTokenExpiresAt`/`rotateRuntimeToken`；`generateBundle:false` 避免同时生成 prod 策略包与改变租户阶段） | 新增 `C000001-prod-enterprise`（app `enterprise`，prod，site 4，`subscription_id=17`，`base_path=/enterprise/`，`api_base` 取默认）；`licenses` 新增 `ELIC-C000001-prod-1`（`plan_code=enterprise-full`，到期＝权益到期 2027-09-14 23:59:59，签名 kid＝`psk_20260718_AElQdK3VQSja`）+ `license_deployments`（deployment 20）；`C000001-console.license_status→active`；`tenant_onboarding_steps` 覆盖；`issueInitialRuntimeToken` 已存在则原样返回，**不轮换** | license 载荷**无 `vault` 字段**（customer-held）；`tenant_runtime_credentials` 行与哈希不变、`token=null`；租户 `onboarding_stage` 仍 `runtime_token_pending`；无新 `policy_bundles`；test 快照除 prod 行、licenses（+1）、`tenant_onboarding_steps` 外不变 | 删除 `license_deployments`/`licenses` 新行与 `C000001-prod-enterprise`；`C000001-console.license_status` 还原 `pending`；steps 按备份还原 |
| 2 W6c | `PATCH /api/platform/ops/deployments/{4,5,6,7}` body `{"status":"active"}`（aims、workflow、codocs、assets）；enterprise 若开通后为 inactive 则同样置 active；`altoc(8)/finance(9)/webdev(13)` 不动 | 5–6 个 prod 部署 `status=active`（aims 恰一个 active，满足调度登记前置；`active_site_path_key` 各不相同） | 8 个 prod 行 active/inactive 分布如预期；`status='active'` 的 prod 部署不含 altoc/finance/webdev/people/collab；test 不变 | 逐条 `PATCH {"status":"inactive"}` |
| 3 W8 | 无额外请求（见 12.1，与 test 对齐）；若用户要求，`POST /api/platform/ops/licenses` 逐部署签发，`expiresAt` 不得晚于权益到期 | — | — | — |
| 4 收尾 | 只读：74 对孤儿门禁（0 行）、快照对比、`/api/health` | — | — | — |

强调：**不执行** `runOnboardingStep('runtime_token')`、`rotateRuntimeToken`、`runtime-token` POST/DELETE、`/ops/tenants/C000001/bundles`（W11 另批）；会话文件用后立即删除。

### 12.3 风险与待确认

1. `startOnboarding` 一旦提交不可 dry-run，失败则整个事务回滚（`prepareEnterpriseProvisioning` 在事务内）；license 签名不可撤回但可 `status='revoked'`。
2. `enterprise` 部署的 `base_path` 为 `/enterprise/`（站点 `root_app_code` 为空）；Enterprise 构建也是 `/enterprise/`，两者一致（`deploy/self-hosted/build.mjs`）。
3. `people` 在 prod 没有部署行（test 有 `C000001-test-people`）；按用户决定 People 保持不建，如需要另批。

## 13. 执行记录三（2026-09-30 凌晨）：W6b、W6c

用户 `zhouguangying` 委托会话（方案 B，审计记在其名下；会话文件用后已删除并回读确认不存在）。写前加密备份 `…T185552Z`（W6b）、`…T185744Z`（W6c），新机均核验通过。

- **W6b**（`POST /api/platform/ops/onboarding/start`，`enterprise-full`/`prod`/`C000001-console`/`/console/`/`generateBundle:false`；不带 rotate、不走 `runtime_token` 步骤；未导入 `enterprise/v0.4.0`）：`200`。新增部署 `C000001-prod-enterprise`（id 21，enterprise，prod，site 4，`/enterprise/`，`/api/v1/enterprise`，`subscription_id=17`，`status=active`，`license_status=pending`）；新增 `ELIC-C000001-prod-1`（id 4，`enterprise-full`，`issued_at 2026-09-29 18:57:03Z`，`expires_at 2027-09-14 23:59:59`，kid `psk_20260718_AElQdK3VQSja`，**载荷无 `vault` 字段**）+ `license_deployments`（→ `C000001-console` id 20）；`C000001-console.license_status=active`。回读：`tenant_runtime_credentials` 行与哈希不变（`issued_at 2026-07-18 15:26:51`，未轮换）；租户 `onboarding_stage` 仍 `runtime_token_pending`（接口返回中的 `awaiting_subject_sync` 只是响应内的推算值，库内未写）；`policy_bundles` 仍只有 test 的 30 个；`tenant_onboarding_steps` 各步 payload 被 prod 信息覆盖（租户级展示信息，原值在备份 `…T185552Z`）。
- **W6c**（`PATCH /api/platform/ops/deployments/{4,5,6,7}` `{"status":"active"}`）：`C000001-aims`、`-workflow`、`-codocs`、`-assets` 现为 `active`（`license_status` 仍 `pending`，与 test 对齐）；`C000001-altoc`、`-finance`、`-webdev` 保持 `inactive`。当前 prod 部署共 9 行：active 6 个（console、prod-enterprise、aims、workflow、codocs、assets）、inactive 3 个。
- **W8**：无额外 license（与 test 对齐，只有 W6b 生成的 console license）。
- **收尾回读**：写前后 12 组快照，只有 `prodRows`（8→9 行）与 `licenses`（3→4 行）变化，均为预期；test 部署/站点、策略包、Runtime 实例与 credential、签名密钥、订阅、权益、账号、应用全部不变；74 对孤儿门禁 0 行；G9 18 张表齐全；`hzy-platform-dev` 健康 200。红线遵守。
- **回滚**：`W6b`：`licenses` id 4 置 `revoked`（或删除）+ `license_deployments` 对应行；删除 `C000001-prod-enterprise`(id 21)；`C000001-console.license_status` 还原 `pending`；`tenant_onboarding_steps` 按备份 `…T185552Z` 还原。`W6c`：对 4/5/6/7 逐条 `PATCH {"status":"inactive"}`。
