# wiztek 自托管数据迁移 Runbook（G-5 草案）

状态：**草案，仅供审阅与逐项批准；未执行**。本文不授权任何服务器、生产库、Platform 或云端写入。对应[自托管拓扑方案](./Go-Live-Self-Hosted-Topology-Plan.md) §3 G-5 与 §5 的 S0/S3/S4。格式沿用[本机配套上线执行单](./Go-Live-Local-C000001-Rollout-Runbook.md)：每个 `M*` 是独立批准点，“批准 Mx”只授权该项列明的写入；出现不符立即停在当前关口、保留证据。

标注：**[核实]** = 本文作者 2026-09-29 只读核对（生产库仅 information_schema、COUNT(*)、只含 information_schema 的 verify 脚本；未读业务行、密文或 token）或仓库代码行；**[推断]** = 由代码/文档推出、未在环境实测；**[待测]** = 必须在 S0/S3 取证后才能定稿。

依据：拓扑方案 §2–§6；[上线计划](./Go-Live-20261008-Plan.md) §1、§4、§7；[生产只读核对](./Wiztek-Production-Read-Only-Check-20260928.md)；[ADR-018 切换协议](./Unified-Enterprise-Cutover-Protocol.md)与[切换手册](./Unified-Enterprise-Cutover-Runbook.md)；[Aims V2 加法迁移](./Unified-Enterprise-Aims-Workflow-V2-Migration-Plan.md)；[LOCAL_RUNTIME](../deploy/test-env/LOCAL_RUNTIME.md)（9/10 VM→Mac 先例）；[自托管制品 G-4](../deploy/self-hosted/README.md)；`data-runtime/README.md`、`data-runtime/deploy/install.sh`；[Workflow 部署说明](../workflow/docs/DEPLOYMENT.md)。

## 0. 范围与数据库去向

原系统（`wiztek.huizhi.yun` + Workers + 日本 Runtime/MySQL `oa.wiztek.cn`）全程不改库、不改 Worker；切换 = 用户停用原 Cloudflare Gateway 停写 → 最终复制 → 员工改用 `aidcp.wiztek.cn`。

| 生产库 | 新主机去向 | 10/8 Runtime 绑定 | 理由 |
| --- | --- | --- | --- |
| `hzy_console` | 原名恢复，Console/Directory 共用 | 启用 | 身份/策略/Vault 权威；必须与 Vault 主密钥**成对**迁移 |
| `hzy_workflow` | 原名恢复，升级 012→013→014 | 启用 | 审批闭环 |
| `hzy_codocs` | 原名恢复 | 启用 | 现有前端与数据不变 |
| `hzy_aims`、`hzy_assets` | 以**源副本**名恢复（如 `hzy_aims_src`/`hzy_assets_src`），在同一实例复制到统一库 | 统一库启用；源副本是否仍被 `apps.aims/assets` 绑定 [待测] | `hzy-enterprise-migrate` 拒绝跨实例（`data-runtime/internal/migrations/unified/migration.go:75-78`）[核实] |
| `hzy_altoc` | 原名恢复为**冷存档** | 停用 | 10/8 不做 Altoc；`hzy-enterprise-add-altoc` 只装空表且硬编码 C000001/test（`cmd/hzy-enterprise-add-altoc/main.go:58,117`，`internal/enterprise/domaininstall/install.go:75`）[核实] |
| `hzy_finance`、`hzy_people`、`hzy_webdev` | 原名恢复为**冷存档**（无 Runtime/业务账号授权，仅 DBA 只读） | 停用 | 见下 |
| `hzy_platform` | 不迁（旧生产 Platform 库，留在原机） | — | 已改用共享 Platform `https://hzy.wiztek.cn`（[Platform 方案 §8c](./Go-Live-Self-Hosted-Platform-Plan.md)），不在新机运行 Platform |

**Finance/People/Webdev 处置建议**（需用户确认，§9 Q1）：切换后原 Gateway 停用，这三个应用无论新旧都不可用（拓扑 §4.1）。建议仍在最终复制中带走并恢复为冷存档：①日后整合进 Enterprise 时须与统一库同实例（上条理由）；②不再依赖日本主机保存切换点数据。Console 目录**不依赖** `hzy_people`：目录全部在 `hzy_console` 的 `directory_*` 表（Runtime schema manifest 66 表）[核实]。生产 `hzy_aims.integration_operation` 为 0 行、`hzy_people` 406 行全部终态、各库指向 finance/people 的未结 operation 为 0 [核实]；但 10/8 版本的 Aims 流程在 `apps.finance/people` 关闭时是否会入队到这两个目标 [待测，S2/S3 验证必须可见地失败而非静默堆积]。原系统保持停写不删除，作为权威冻结副本。

## 1. 生产现状（2026-09-29 只读）

| 项 | 结果 | 影响 |
| --- | --- | --- |
| 版本 | MySQL 8.0.45，Linux，`gtid_mode=OFF`，binlog ROW、保留 30 天 [核实] | 新机 8.0.46 同大版本 |
| **`lower_case_table_names`** | **1** [核实] | 新机**必须在首次初始化数据目录前**设为 1，初始化后不能再改（MySQL 8.0 规则）|
| 字符集 | server `utf8mb4_0900_ai_ci`；10 个 hzy_* 库默认 `utf8mb4_unicode_ci`；表级例外 `hzy_console.policy_bundle_snapshots`、`hzy_workflow.flow_callback_logs` 为 0900_ai_ci；列级非 unicode 列 console 28 / workflow 5 / codocs 4 [核实] | 表/列原样保留，不在迁移中“顺手修”；新机 server 默认改 unicode_ci（§2），避免 v2.28 helper 临时表继承 0900 导致的排序规则冲突（[执行记录](./Go-Live-Local-C000001-Rollout-Runbook.md):329）|
| 时区 | `time_zone=SYSTEM`（CST，偏移 +08:00）[核实] | 新机系统时区已是 Asia/Shanghai（拓扑 §2a）；mysqldump 默认 `--tz-utc` 保 TIMESTAMP；统一库连接固定 `+00:00`（`internal/db/enterprise.go:26,54`）|
| sql_mode | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` [核实] | 新机显式设同值 |
| 规模 | 精确行数：console 1,945,089（`vault_access_logs` 1,496,483、`console_mutation_receipts` 148,138、`auth_token_events` 280,938）；finance 34,560；altoc 17,184；codocs 7,152；aims 5,949；people 1,883；webdev 1,294；workflow 362；assets 332。数据+索引约 console 582 MB，其余合计约 125 MB [核实] | 窗口时长由 console 主导 |
| 对象 | 全部 InnoDB；视图 0；EVENT 0；触发器仅 `hzy_aims` 10 个；存储过程仅 `hzy_aims` 2 个（`add_fk_item_type_status_safe`、`fix_item_type_status_fk`）；DEFINER 均为 `root@%`；跨库外键 0 [核实] | 见 §5 R2 的 DEFINER 处理 |
| 无主键表 | `hzy_aims.migration_backup_20260520221011_project_user_align_{members,projects}`、`hzy_codocs.migration_backup_20260521013616_hfzx_work_reports_paths` [核实] | `hzy-enterprise-migrate` 对无主键源表直接拒绝（`migration.go:149-150`）→ 源副本须先移除两张 Aims 备份表（存档保留）|
| 账号 | 业务授权账号 `cf_app@'%'`、`hzy_console_runtime@localhost`；本次只读 defaults 文件实际以 **`root@'%'`（全权限 + GRANT OPTION）** 登录，仅靠会话 READ ONLY 约束 [核实] | 风险 K1；迁移 dump 应改用专用只读账号 |
| Vault/OIDC | `vault_secrets` 22、`vault_secret_versions` 55、`auth_signing_keys` 15、`integration_credentials` 26、`service_clients` 13 / 凭据 25 / grant 489 [核实] | OIDC 私钥以 Vault 加密存于库内（`internal/apps/console/auth_signing.go:433`），主密钥错则登录签名失败 |
| 目录连接器 | `directory_connectors` 1、`directory_connector_enrollments` 2、`connector_runtime_instances` 1 [核实] | 连接器身份/RSA 私钥/状态在日本主机 `/etc/hzy-data-runtime/directory/`（README:689）[推断] |
| OIDC 回调 | `auth_clients` 10，`auth_client_redirect_uris` 130 条，其中 18 条含 `wiztek.huizhi.yun` [核实] | 新域名需补回调（G-6，写新库副本）|

## 2. S0 主机准备（批准点 M0）

**批准点 M0**：在新服务器安装并初始化 MySQL、建目录与账号、建备份任务。不含任何生产数据。前置：G-4 S0 同批核对（[G-4 README](../deploy/self-hosted/README.md) S0）。

1. 安装系统包 `mysql-server 8.0.46` 后**先不要启动**（首启会以默认参数初始化数据目录，`lower_case_table_names` 从此锁死）。[推断：Anolis 包的 systemd 首启会自动 `--initialize`，S0 以 `systemctl cat mysqld` 核实]
2. 数据目录 `/home/mysql/data`、binlog `/home/mysql/binlog`、备份 `/home/hzy-backup`（0700）。SELinux 虽为 Permissive 仍按 enforcing 标注：`semanage fcontext -a -e /var/lib/mysql /home/mysql` 后 `restorecon -Rv /home/mysql`；若 `systemctl cat mysqld` 含 `ProtectHome=`，加 drop-in `ProtectHome=false`。
3. `/etc/my.cnf.d/zz-hzy.cnf`（**文件名必须排在系统包 `mysql-server.cnf` 之后**：后者自带 `datadir=/var/lib/mysql`，按字母序后读者生效；2026-09-29 S0 实测 `hzy.cnf` 会被覆盖）（16 GB 主机，另有 Runtime + 7 个 Node 进程约 3–4 GB）：

```ini
[mysqld]
datadir=/home/mysql/data
socket=/var/lib/mysql/mysql.sock
bind-address=127.0.0.1                 # 不监听 Tailscale/公网；运维经 SSH
mysqlx=OFF
lower_case_table_names=1               # 与生产一致；必须在初始化前生效
character_set_server=utf8mb4
collation_server=utf8mb4_unicode_ci    # 避免新建临时表/库继承 0900_ai_ci
sql_mode=ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION
default_time_zone=SYSTEM               # 主机 Asia/Shanghai，与生产 +08:00 一致
innodb_buffer_pool_size=4G             # 现有数据 <1 GB，留足余量
innodb_redo_log_capacity=1G
innodb_flush_log_at_trx_commit=1
sync_binlog=1
log_bin=/home/mysql/binlog/binlog
binlog_format=ROW
binlog_expire_logs_seconds=1209600     # 14 天，配合每日全备做 PITR
server_id=1
max_connections=300
max_allowed_packet=64M                 # 与生产一致
event_scheduler=OFF                    # 生产 EVENT 为 0
local_infile=OFF
log_bin_trust_function_creators=1   # 开 binlog 时普通账号建触发器需要（否则 ERROR 1419 要 SUPER）；ROW 格式下风险低
```

然后**先用 `mysqld --verbose --help` 核对 datadir 等生效值**，再显式 `mysqld --initialize --user=mysql`（不要走 systemd 首启的 `--initialize-insecure`，它会以 root 空口令初始化）；`log-error` 为空时错误日志位于 datadir 下 `<hostname>.err`，临时口令行需脱敏 → 启动 → 验证 `SELECT @@lower_case_table_names,@@collation_server,@@server_uuid` 并把 `server_uuid` 记入回执（它将成为 `enterprise.instanceId`，`internal/db/enterprise.go:54` 严格比对）[核实]。

4. 账号（全部 `@localhost`，口令只进 0600 defaults 文件或 Runtime 私有配置，不进 argv/日志）：

| 账号 | 权限 | 说明 |
| --- | --- | --- |
| `hzy_migrator` | `hzy_*` 全部 DDL/DML、`GET_LOCK` 可用 | 恢复、schema 升级、统一库复制；窗口外 `ACCOUNT LOCK`（锁定不影响其作为触发器 DEFINER 执行），**不得 DROP**：统一库触发器以复制连接用户为 DEFINER [推断：`migration.go:350` 的 `CREATE TRIGGER` 不带 DEFINER] |
| `hzy_rt_console` | `hzy_console`: SELECT/INSERT/UPDATE/DELETE、CREATE TEMPORARY TABLES | Directory 同步用临时表（`internal/apps/directory/sync.go`）；Console 与 Directory 须同一连接参数（README:388-390）|
| `hzy_rt_workflow`、`hzy_rt_codocs` | 各自库 DML | |
| `hzy_rt_enterprise` | 统一库 DML + `SHOW VIEW` | 不得有 DDL/TRUNCATE/改 fence 行（切换协议 §1）；兼容视图元数据需 SHOW VIEW（LOCAL_RUNTIME:200,214）|
| `hzy_rt_aims_src`、`hzy_rt_assets_src` | 源副本 DML 或只读 [待测] | 取决于 release 配置是否仍把 `apps.aims/assets` 指向源副本 |
| `hzy_backup` | 全部 `hzy_*`: SELECT、SHOW VIEW、TRIGGER；全局 `SHOW_ROUTINE`、`PROCESS` | 每日加密备份 |

冷存档库（altoc/finance/people/webdev）不授予任何运行账号。

5. 备份：`hzy-backup.timer` 每日 02:30 逐库 `mysqldump`（§5 R1 同一旗标）→ gzip → `openssl enc -aes-256-cbc -pbkdf2 -iter 200000`，口令文件 0600 独立保存，保留 14 天；每周一次解密 + `gzip -t` 自检。异地副本去向 [§9 Q6]。

**S0 执行记录（2026-09-29，用户批准，root 执行）**：GNOME 停用；Node 24.18.0（官方 sha256 双端核对）、pnpm 11.17.0、git、nginx、mysql-server 8.0.46；MySQL 按本节初始化，root 改 `auth_socket`，`server_uuid=1e3c34dd-bb9b-11f1-bf6b-000c293f1086`；7 个账号（`hzy_rt_enterprise`、`hzy_cutover` 暂无授权，S3 库名确定后按回执 GRANT）；每日加密备份 timer 启用并以哨兵库完成备份→解密→恢复核对；firewalld `hzy-tailnet` 区仅放行 100.98.120.65→TCP 8780/8782（ts-input 在前放行，firewalld 丢弃为最终结果）。回执 `.git/s0-host-prep-receipt.md`（本机，不入库）。另经用户批准停用 rpcbind（service+socket 已 mask）与 LLMNR/mDNS（`/etc/systemd/resolved.conf.d/90-hzy-no-llmnr.conf`），111/5355 不再监听，DNS 正常；`log_bin_trust_function_creators=1` 后 `hzy_migrator`、`hzy_cutover` 实测可建触发器。遗留：备份口令离机托管（用户决定暂不导出）、Gateway 上线后实测白名单。

**验证**：变量回读、`SHOW GRANTS` 逐账号最小化、`ss -lntp` 仅 127.0.0.1:3306、备份一次成功并自检。**回滚**：尚无生产数据，可整体卸载重做。

## 3. Schema 升级路径（生产现状 → 10/8 release）

Runtime **不自动执行 DDL**：`/runtime/schema/status` 只报告表/列/索引缺失（`internal/server/server.go:3672`；Workflow 仅查表 `internal/apps/workflow/adapter.go:29-42`；Console 按内嵌 manifest 查表/列/索引/约束 `internal/apps/console/adapter.go:221-316`）[核实]。所有升级都在新主机的恢复副本上由 `hzy_migrator` 执行，生产原库不动。

| 库 | 生产现状 | 升到 release 需要 | 状态 |
| --- | --- | --- | --- |
| Workflow | 011 verify 2×PASS；012/013/014 verify 全 FAIL；缺 `flow_notification_outbox`、`flow_delivery_audit`（Runtime 必需表 12 中缺 2）[核实] | 按 [DEPLOYMENT.md](../workflow/docs/DEPLOYMENT.md):48 先审 001–011 水位（010 的种子数据 verify 读业务配置表，S3 在副本上跑）→ 012 → verify(2) → 013 → verify(4) → 014 → verify(1)。表极小，本机演练 013 0.072 s、014 0.049 s | 已知 |
| Console | Runtime manifest（`sha256:fdbb6e38…`，66 表）的表/列/索引/约束**全部已具备**；另有 manifest 外 `console_runtime_cache`、`product_versions` [核实] | 可选迁移仅在 release 配置启用对应能力时需要：`verified_policy_snapshots`(+`renewal_state` 两列，`apps.console.policyEnvelope`)、`console_service_assertion_replay`（R1 稳态身份）、`gateway_service_assertion_replay`——生产三表均缺 [核实]。数据层：ADR-017 grant audience/semanticScope 事实迁移、五域与调度 grant、GitLab 凭据入 Vault、新域名 OIDC 回调——归 G-6/G-7 | 表结构已知；启用项 [待测：以 G-4 release 配置为准] |
| Codocs | Runtime 必需 24 表全部存在 [核实]；缺 v1.6 `product_document_creation`、快照两表、协作四表 [核实] | 快照/协作默认关闭（`snapshotV2Enabled`/`collaborationV2Enabled`，data-runtime CLAUDE.md:144）。v1.6 是否随 Host 产品文档功能开放 [待测] | 已知 |
| Aims → 统一库 | 70 表；统一库 Aims 域映射（C000001 候选 113 表）中生产缺 45 表：v5.3 `aims_contribution_snapshot_versions`、v5.19 产品中心 24 表至 v5.38 轻量规划；另缺 v5.38 `project_activity_logs`、v5.39、v5.41 [核实，表级] | ①源副本删两张无主键备份表 → ②按版本序补 Aims v5.x 迁移（含只 ALTER 的版本，列级差异 [待测]）→ ③以 C000001 本机统一库 `--no-data` DDL 为参照做结构比对 → ④`hzy-enterprise-migrate` plan/review-hash/apply（generation=0）→ ⑤统一库 Aims V2 状态加法迁移（生产状态目录仍是旧 matter/target 分类，见 [导入回执](../deploy/test-env/artifacts/C000001.production-business-import.json)）→ ⑥兼容视图安装 + 激活（generation≥1）→ ⑦`hzy-enterprise-verify-views` 全数通过 | **K2 已实现（方案 A，待安全审查与 S3 演练）** |
| Assets → 统一库 | 36 表；缺 `assets_product_catalog_state`（`assets/docs/migrations/20260907_product_catalog_watermark.sql`）[核实]；另需补规范 schema 已有、仓库此前无迁移的三列 `asset_physical_details.config_detail`、`asset_documents.artifact_type/source_context`：`assets/docs/migrations/20260929_backfill_schema_drift.sql`（先 `_verify.sql` 应 3 行 PASS；守卫任一列已存在即中止；`_rollback.sql` 仅三列全空时可执行）。S3 演练已在 `s3r1_hzy_assets` 执行并 verify 通过，M6 正式迁移同样执行 | 同 Aims 链路 | 同上 |
| Altoc | 72 表，Runtime 必需 55 表齐全；缺 046–048 反馈投影 3 表、002 兼容 2 表 [核实] | 10/8 冷存档，不升级 | — |

**K2 工具缺口（阻断）**：统一库链路中只有 `hzy-enterprise-migrate`（影子复制）和 `hzy-enterprise-verify-views` 是通用的；其余阶段工具都写死 C000001/test：`hzy-enterprise-test-cutover`（`main.go:77`，fence/prepare-final）、`hzy-enterprise-compatibility-rehearsal`（`main.go:75`，兼容视图）、`domaininstall`（`install.go:75-82`，删除证据表/Altoc）[核实]；激活 `hzy-enterprise-drain --mode activate` 需要新生产 Platform 签名的排空认可信封（`cmd/hzy-enterprise-drain/main.go:34-80`）[核实]。生产必须二选一，经 Claude 安全审查后才进入 S3：
- **A（推荐，复用已验协议）**：把上述工具参数化为“受保护配置指定 tenant/environment/库名 + review hash”，在新主机的两个源副本上走 install-fence → fence → prepare-final → apply → 视图 → drain activate；源副本本来无写入者，fence 只作为协议证据，不触碰日本原库。
- **B**：新写一个“已冻结源的一次性激活”工具（影子复制 + 视图 + registry generation 置位 + 回执），不装 fence；改动面小但是新的信任代码。

**用户决定（2026-09-29）：采用 A。** 参数化现有工具，复用已审切换协议；实现后须经 Claude 安全审查，再进入 S3 演练。

**K2 审查结论（Claude，2026-09-29）**：参数化实现已合并（`--profile`，`enterprise-cutover-profile.v1`）。激活仍须 Platform 签名信封：以 profile 固定的 kid 与 Ed25519 公钥验签，信封内嵌公钥必须为空或一致，租户/环境/Runtime 绑定/cutover key/generation 全部匹配后，再由激活事务内原 SQL 核验器复核闭包。profile 文件即信任锚（本人 0600、`O_NOFOLLOW`），因此 **S3/S4 审批项必须包含 profile 中 Platform `keyId` 与公钥 SHA-256 指纹，并与新生产 Platform 活动签名密钥逐字核对**。签发端此前写死的 C000001/test 由 K2-P 修正；新主机仍需创建无全局权限的 `hzy_cutover` 账号（工具拒绝 root 与全局管理权限）；域安装在激活之后、Runtime 停机时执行。

**K2-P/K2-P2 边界更新（2026-09-29）**：排空认可信封 `enterprise-external-drain-approval.v1` 的 Platform 签发端已按登记事实参数化，但生产离线场景的 sealed 快照及 provider receipt 证据包尚无正式产出链。生产激活只接受这份 Platform 签名、Go 验签的认可；`enterprise-drain-release.v1` 与 JS drain coordinator 保持 C000001/test 专用，不进入生产切换。M4 停用旧 Gateway/日本 Runtime 是停写证据来源，M8 nginx 切换才开放入口；二者都不能代替排空认可的签名证据。产出链缺口须在 S3 前单独审定。

**K2-E 精简排空认可（方案 B，本地代码已完成、现场未执行）**：C2/M4 的原始 Cloudflare、systemd、源库和 nginx 只读观测先置于新主机 0700 目录，逐件 0600；从恢复副本用 `node deploy/self-hosted/cutover/provider-report-cli.mjs collect --config <0600-config> --out provider-report.json` 生成 provider 报告，再用 `node deploy/self-hosted/cutover/seal-cli.mjs seal --manifest <P-manifest> --report <provider-report.json> --profile <0600-profile> --actors <actors.json> --cold-archive <cold.json> --out-prefix <window-id>` 生成证据和审批请求。人工核对四份冷存档材料及证据 SHA-256，经 Platform `ops.deployments` 页面 plan→approve；生产 Platform 与 CLI 必须各从受保护 systemd credential 获取同一窗口 HMAC，签发用活动 Platform kid/公钥指纹须与 profile 固定值相同。先执行 Platform 迁移 `20260929-enterprise-external-drain-generation.sql` 并验证唯一键；同一 cutoverKey/generation 仅一次签发，原样重放不重新签名。S3/S4 分别采新证据，M6 激活仍用 Go 验签和事务内七项闭包。现场采证来源、credential 分发/销毁、Platform DDL 与任何环境写入仍需单独批准。

**K2 实现状态（2026-09-29，代码完成、待环境验证）**：方案 A 已在本地实现。涉及工具为 `hzy-enterprise-migrate`、`hzy-enterprise-test-cutover`、`hzy-enterprise-compatibility-rehearsal`、`hzy-enterprise-drain`、`hzy-enterprise-add-altoc`（domaininstall）和 `hzy-enterprise-verify-views`，均新增 `--profile`：读取受保护的 `enterprise-cutover-profile.v1`（0600、O_NOFOLLOW、限长，不输出 DSN 或密码）。profile 指定 tenant、environment、源/目标库名、部署码、cutover key、专用最小权限账号，以及固定的 Platform kid 与公钥。每次写入都需要 `--apply` 加精确审阅 hash；不带 `--profile` 时，C000001/test 行为不变。护栏包括：环境仅限 prod/test/dev；跨租户（plan、registry、Runtime 配置、信封）一律拒绝；目标已有 active generation 时拒绝，须改走恢复路径；激活仍须 Platform 签名信封（kid 与公钥固定，不接受自签）；拒绝 root 或全局管理权限账号。命令、结构、授权说明与证据见[切换协议](./Unified-Enterprise-Cutover-Protocol.md) §9。隔离验证命令为 `node data-runtime/scripts/test-enterprise-cutover-profile-mysql.mjs`，覆盖合成租户全流程、拒绝矩阵和 C000001 兼容。进入 S3 前还需满足：①离线排空认可证据包的正式产出链审查；②生产 Platform 活动 kid/公钥与 profile 的指纹核对；③创建 `hzy_cutover` 专用账号（schema 级授权，见协议 §9.4）。执行顺序与协议一致；注意 domaininstall 须在 drain activate **之后**、Runtime 仍停机时执行。

### 3a. Codocs v2 协作 schema 安装清单（**待批准，未执行**）

背景：用户 2026-09-29 决定上线时启用共享个人文档协作。Runtime 对这些表使用 `isMissingTable`（MySQL 1146）容错，`requiredTables` 不含它们，所以未安装时 `/runtime/schema/status` 仍显示 ready；安装与否**只由本清单核验**，不能靠 Runtime 自检。以下全部在新主机的 `hzy_codocs` 副本上由 `hzy_migrator` 执行（S3 演练副本一次，属批准点 M3；M6 最终副本一次，属 M6），生产原库不动。目标库是否与 `hzy_codocs` 同名、是否在统一库中，按 K2 激活结果确定（安装的是物理 Codocs 库；统一库激活后须对 Codocs 域映射的物理库执行同一清单）。

**部门协作追加项**：启用部门文档协作时，须在上述两份迁移之后追加安装 `codocs/docs/migrations/20260929_department_collaboration.sql`（会话 `policy`/`dept_code`、参与者 `status`/`checked_at`、按 UUID 的 head/会话索引）；它与部门协作 Runtime 构建一起安装、单独批准，未安装时个人协作不受影响（缺列读作 private）。

**前置（只读核验，缺任何一项则停止）**

| 检查 | 期望 | 依据 |
| --- | --- | --- |
| `document_versions.oss_version_id`、`content_sha256` 存在，`object_key` 不存在 | 见 verify 语句 `prerequisite-columns`（应返回 2 行） | v1 基线与 `migration_v1.5_document_quality_review.sql`；协作发布同时写 `content_sha256`（`collaboration_versions.go:98`） |
| 表 `documents`、`document_shares`、`document_versions` 齐全 | Runtime 必需 24 表已核实存在 | 本文 §3 表 |
| `service_command_receipt` 的 `chk_scr_cross_app` 已含 Codocs 自有命令白名单 | 与 `20260922_codocs_owned_command_receipts.sql` 一致；**不属于协作表**，但 Host 私人文档保存/回收依赖它，未应用则 Host 保存报 3819 | 迁移文件头注释；只读确认，不在本清单安装 |
| 快照桶实测 `PASS_BOTH` | 见 [快照桶实测方案](./Go-Live-Self-Hosted-Snapshot-Bucket-Test-Plan.md) | 发布门槛 |

**要安装的对象（精确清单，按顺序）**

| 顺序 | 迁移文件 | 创建/修改 | 备注 |
| --- | --- | --- | --- |
| 1 | `codocs/docs/migrations/20260920_document_snapshots.sql` | 表 `document_snapshot_heads`（PK `tenant_code, deployment_code, document_uuid`；generation/collaboration_epoch 与发布约束的 CHECK）、`document_snapshot_candidates`（PK `tenant_code, deployment_code, candidate_key`；索引 `snapshot_document_history`）；**`ALTER TABLE document_versions ADD COLUMN object_key VARCHAR(512) NULL AFTER oss_version_id`** | 现有历史行保持 `object_key = NULL`（正文仍在 `documents.oss_path`）；不迁移任何旧对象 |
| 2 | `codocs/docs/migrations/20260924_document_collaboration_sessions.sql` | 表 `document_collaboration_sessions`（含索引 `collaboration_session_document`、CHECK `collaboration_session_epoch`）、`document_collaboration_tickets`（仅存 SHA-256；索引 `collaboration_ticket_session`）、`document_collaboration_participants`、`document_collaboration_publications` | 依赖 1 中的头表语义，但无外键 |

合计 **6 张新表 + 1 个新列**；`codocs/docs/codocs_schema.sql` 已含同样定义（隔离演练逐条比对一致）。**本批次没有部门协作所需的新列**（`policy`、`dept_code`、`status`、`checked_at` 属设计稿 A-4，未获批准、未实现，不在本清单）。不需要其它迁移：`20260910_*`、`20260717_*` 与协作无关。

**操作步骤（每步单独批准，DDL 不可事务回滚）**

1. 备份：`hzy_codocs` 全库 `mysqldump --single-transaction --routines --triggers` 到 0700 目录、加密并做可解密演练；记录 `@@server_uuid`、`SHOW CREATE TABLE document_versions` 原文（回滚对照）、`SELECT COUNT(*) FROM document_versions`。
2. 只读前置核验：`deploy/self-hosted/schema/codocs-v2-collaboration.verify.sql` 中 `prerequisite-columns` 与 `tables`（应为 0 行）。
3. 按顺序执行两个迁移文件（各自单独一次会话，不合并）；**MySQL 每条 DDL 隐式提交**：中途失败时已建的表保留，不能靠回滚撤销（隔离演练：预置同名 `document_collaboration_tickets` 后，文件在第三条语句失败，`document_collaboration_sessions` 已存在）。失败处理：停止，保持全部开关关闭，用回滚文件清理已建对象，再从头重试。
4. 只读核验：同一 verify 文件的 `tables`（恰好 6 行）、`object-key-column`（`varchar(512)`、可空）、`primary-keys`（均以 `tenant_code,deployment_code` 开头）、`check-constraints`（5 项）、`charset-collation`（0 行）；再对 `document_versions` 行数与步骤 1 一致。
5. 才可继续：Runtime 配置 `apps.codocs.snapshotV2Enabled` / `collaborationV2Enabled` / `deploymentBindings.collab`（另行批准，见 `deploy/self-hosted/README.md` “独立 Collab”）。**安装本身不启用任何行为**：开关关闭时新表为空、Host 与 Runtime 路径不读写它们。

**回滚（仅限尚未启用任何开关、表内无数据时）**

- 精确对象：`deploy/self-hosted/schema/codocs-v2-collaboration.rollback.sql`（按依赖倒序 `DROP TABLE` 六张表，再 `ALTER TABLE document_versions DROP COLUMN object_key`）。
- 前置：verify 文件的 `rollback-precondition` 四个计数（heads、candidates、sessions、`object_key IS NOT NULL` 的历史行）必须全为 0，且所有协作/快照开关为关闭。
- **一旦有文档发布到 generation > 0，禁止执行回滚文件**：其权威正文是头指向的对象版本，删表会让 Host 回落到过期的 `documents.oss_path` 镜像。此后的出口是关闭开关、保留 schema，或经单独批准的备份恢复路径（恢复会丢失备份之后的全部 v2 写入，须单独评估）。
- 回滚后用步骤 4 的核验确认表集合为空、`SHOW CREATE TABLE document_versions` 与步骤 1 记录一致。

**隔离演练证据（/tmp 一次性 MySQL 8.0.34，未连接任何真实库）**：`node deploy/self-hosted/test/test-codocs-v2-schema-mysql.mjs` 覆盖前置、安装、逐项核验、与 `codocs_schema.sql` 逐条一致、回滚前置计数、回滚后 `document_versions` 定义与数据不变、重复安装被拒（`already exists`）、DDL 非事务性的中途失败。生产字符集/排序规则（服务器 `utf8mb4_0900_ai_ci`）下的行为在 S3 副本上以 `charset-collation` 语句再核对，本演练库使用 `utf8mb4_unicode_ci` 默认。

## 4. Runtime 迁移要素

Runtime 配置读 `HZY_DATA_RUNTIME_CONFIG`（`internal/config/config.go:267`）与 `HZY_DATA_RUNTIME_CONFIG_DIR` 下的覆盖文件 [核实]。注意 G-4 的 `deploy/self-hosted/env/runtime.env.example` 写的是 `HZY_RUNTIME_CONFIG_FILE`，Runtime 不读此名 [核实]，G-4 需对齐；监听按 G-4 为 `127.0.0.1:31080`。

| 项 | 来源 / 做法 | 核验（不打印值）|
| --- | --- | --- |
| `tenant`/`deployment`/`deploymentBindings` | 新 Platform 登记（G-6/G-9）；心跳落 `deployment-bindings.json` 覆盖（config.go:282）。**建议新 Platform 沿用原部署编码**（生产 Runtime 为 `c000001-prod-tenant-runtime` [核实]），则 `hzy_console` 中 489 条 grant 与 25 条凭据绑定无需重绑 [推断] | 启动后 bindings 与 Platform 记录逐项一致 |
| `control.platformUrl`/enrollment | `https://hzy.wiztek.cn`（§8c 取代原 `platform.wiztek.cn`），一次性 enrollment code（install.sh:515-541）；得到 control token | 心跳 200；`/runtime/health` |
| `platform-signing-key.json` | 新 Platform 的 Ed25519 公钥（config.go:307）；同时用于目录连接器 enrollment 与恢复签名 | kid 与 Platform 公布值一致 |
| `auth-jwt-trust.json` | issuer 改为新 Console（`aidcp.wiztek.cn`），audience `data-runtime`，JWKS 走 G-10 回环；**一次写入、不同值拒绝**（config.go:367-426）→ 不复制旧文件 | 签发探测 |
| `enterprise.*` | `enabled`、`environment`、`schemaVersion`、`generation`（=激活值）、`instanceId`（=新机 `@@server_uuid`）、`db`、`domains.aims/assets`（`ownerDeployment` 必须等于 `deploymentBindings[domain]` 或 `["enterprise"]`，enterprise.go:51-53）、`aimsDeliveryWorker{deployment,serviceClientId=aims.runtime}`；`enableMilestoneReceivable=false`（里程碑审批顺延）、`enableContractActivation=false` [核实字段] | `hzy-enterprise-verify-views` 全数通过；启动日志到 `listening` |
| `apps.*` | console/directory/workflow/codocs 启用；finance/people/webdev/altoc 关闭；aims/assets 按 release 配置 [待测] | `/runtime/health` apps 段 |
| **Vault 主密钥** | 与 `hzy_console` **成对**：同一快照时点的库 + 原密钥（README:393-396）。文件 `console-vault-master-key` 0600、属 Runtime 用户（config.go:224）。传输：新机 → 日本机的一次性 Tailscale/SSH 管道 `ssh jp 'sudo cat <keyfile>' \| sudo install -m 600 -o hzy /dev/stdin <newpath>`，不落中间盘、不进 shell 历史；若日本机把密钥写在 `.env` 的 `HZY_CONSOLE_VAULT_MASTER_KEY=`，改为只提取该行值走同一管道 [待测：现存位置] | 两端各算 `VaultMasterKeyFingerprint`（sha256 前 32 位，adapter.go:47；设计上可公开）比对；功能证明：`vaultKeyConfigured=true`（server.go:5391）不够，须 OIDC 登录签发成功且 JWKS kid 集合与旧 Console 一致，并做一次 Vault 解析只读探测（GitLab 只读 API，不打印 token）|
| OIDC 签名私钥 | 在 `hzy_console` Vault 行内，随库迁移，无单独文件 [核实] | 同上 |
| 目录连接器 | 二选一 [§9 Q4]：①复制 `/etc/hzy-data-runtime/directory/`（`state-cache.json` + RSA 私钥，0600，同一 SSH 管道）保持身份；②新机 `HZY_DIRECTORY_CONNECTOR_REENROLL=true` 用新 Platform 签名的 enrollment token 重新登记（install.sh:757-794）。Console 部署编码若变，只能②。新机到 LDAP 的连通性 [待测] | 连接器心跳；管理员手动触发一次 LDAP 同步（README:697）|
| 发布公钥 | 复制 `release-signing-public.pem`，比对 keyId；安装用 `--no-auto-update` 或装后 `auto-update pin`（README:420,477）。**新 Runtime 制品只 stage 精确版本，不 promote `latest`**：日本 Runtime 的更新 timer 若在跟踪 `latest`，会被一并升级，破坏回退路径 [推断，§9 Q5] | `auto-update status` = pinned/disabled |
| 服务凭据 | 生产 `aims.runtime` 等 secret 为 `env_ref`（在 Cloudflare Worker secret 中，不可取回）[核实，只读核对 §11] → 新主机进程需在新库副本上**新签凭据**（G-7）| 真实 client 全组合签发探测 |

安装：`install.sh --version <精确版本> --release-public-key … --no-auto-update --no-start`，再放置私有配置 → **启动探测**（带齐 unit 的全部环境，日志到 `listening on 127.0.0.1:31080`，否则只证明回落默认配置，LOCAL_RUNTIME:65）→ `systemctl start` → health。

## 5. S3 迁移演练（批准点 M1–M3，非最终 dump）

**批准点 M1（生产写入，最小）**：在日本 MySQL 建专用只读账号 `hzy_dump@<来源>`：各 hzy_* 库 SELECT、SHOW VIEW、TRIGGER，全局 SHOW_ROUTINE；不给 EVENT/LOCK TABLES/RELOAD。来源限定为新主机 Tailscale 地址（若日本机入网）或新主机出口 IP + `REQUIRE SSL`。不再用 `root@'%'` 做迁移。

**R1 dump（M2：只读生产 + 写新主机）**。路径 A（推荐）：在新主机远程 dump，密文当场落盘，日本机不留文件或密钥；同一 mysqldump 客户端也用于目标侧指纹，结果可比。路径 B：日本机本地 dump + `age` 公钥加密 + Tailscale 传输（链路不稳时用）。事件为 0，且 dump 账号无 EVENT 权限（本机 L1 曾因此失败，[执行记录](./Go-Live-Local-C000001-Rollout-Runbook.md):301），故固定 `--skip-events` 并先断言 `information_schema.EVENTS` 为 0。

```bash
set -euo pipefail; umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; ROLL="/home/hzy-backup/migration-$STAMP"; mkdir -m 700 "$ROLL"
KEY="/home/hzy-backup/keys/migration-$STAMP.pass"; openssl rand -hex 32 > "$KEY"; chmod 600 "$KEY"
DBS="hzy_console hzy_workflow hzy_codocs hzy_aims hzy_assets hzy_altoc hzy_finance hzy_people hzy_webdev"
mysql --defaults-extra-file="$SRC_CNF" -N -e "SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA LIKE 'hzy\_%'" | grep -qx 0
for db in $DBS; do
  mysqldump --defaults-extra-file="$SRC_CNF" --ssl-mode=REQUIRED --compress \
    --single-transaction --quick --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF \
    --routines --triggers --skip-events --hex-blob --default-character-set=utf8mb4 --tz-utc \
    --order-by-primary --skip-dump-date "$db" \
  | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY" -out "$ROLL/$db.sql.gz.enc"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$ROLL/$db.sql.gz.enc" | gzip -dc | tail -1 | grep -q 'Dump completed'
  sha256sum "$ROLL/$db.sql.gz.enc" >> "$ROLL/SHA256SUMS"
done
```

不带 `--databases`：目标库由 `hzy_migrator` 先以 `CREATE DATABASE <名> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` 显式创建，可改名（Aims/Assets 源副本），也不继承 server 默认。同时记录源端逐表 `COUNT(*)`（S3 期间生产仍在写，仅作参考；S4 停写后为硬门禁）。

**R2 恢复（M2 内）**：DEFINER `root@%` 在新机不存在，且导入账号不应有 SET_USER_ID：恢复流去掉 DEFINER，使触发器/过程归 `hzy_migrator`。

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY" -in "$ROLL/$db.sql.gz.enc" | gzip -dc \
  | sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' \
  | mysql --defaults-extra-file="$MIG_CNF" --database="$target" --show-warnings
```

Aims 两个存储过程是历史修复工具，统一复制不会携带（`migration.go` 只处理表与触发器，`unsafeTrigger` 拒绝 CALL）[核实]，留在源副本即可。

**R3 一致性核验**：①逐表 `COUNT(*)` 源（dump 快照时点）与目标一致；②数据指纹：对目标用 R1 同一客户端与旗标加 `--no-create-info --skip-triggers --skip-routines` 重新导出，`grep '^INSERT INTO' | sha256sum` 与 dump 文件同样处理的结果逐库相等（同客户端、同旗标下扩展 INSERT 分批确定 [推断，S3 以第二次 dump 比对确认]）；三张无主键表单独用 `--skip-extended-insert` 后 `sort` 比较；③结构：`information_schema` 的表/列/索引/约束/触发器计数逐库相等，表与列排序规则逐项相等。`CHECKSUM TABLE` 只作辅助，跨 8.0.45/8.0.46 若出现差异以②为准。

**R4 升级链（M3：仅新主机）**：按 §3 顺序在副本上执行，每步前加密备份、每步 verify；Aims/Assets 走 K2 选定工具。全部完成后以演练配置做 Runtime 启动探测、`verify-views`、`/runtime/health`，Runtime 以**无入口**方式运行（Gateway 未指向，或 nginx 仍返回维护页）；只做只读冒烟与签发探测。

**R5 计时**：逐步记录 dump、传输、恢复、校验、每个迁移、统一库 plan/apply/视图/激活、Runtime 启动的耗时；链路抖动（日本 health 曾 12.6 s，拓扑 §2a）下 dump 是否中断；由此定 S4 窗口。演练至少两轮，第二轮用脚本化命令一次跑通。演练数据在 S4 前整体删除重建（不复用演练库，避免把演练写入带入生产）。

## 6. S4 切换窗口（批准点 M4–M8）

前置：S1/S2/S3 门禁通过；K2 工具已审；G-4 制品、G-6 Platform 记录、G-7 grant 方案、G-9 生产 Platform 就绪；Go/No-Go 由用户决定。窗口放非工作时间，**预留 4 小时**（下表为 S3 前估算，以 S3 实测替换）。

| 步 | 动作 | 估时 | 门禁 |
| --- | --- | --- | --- |
| C0 | 公告；nginx `aidcp` 仍为维护页 | — | 员工已知停机时段 |
| C1（**M4**，用户执行）| 停用原 Cloudflare Gateway；建议同时停日本 Runtime 服务及其 update timer（可逆，回退时再启）[§9 Q2] | 10 min | 原入口不可达 |
| C2 | 冻结核验：`SHOW PROCESSLIST` 无业务连接；9 库逐表 `COUNT(*)` 与 `CHECKSUM TABLE` 间隔 5 分钟两次相同；记录 Workflow 未结实例与 Console 4 条未结 operation 的去向 | 10 min | 两次一致；否则找出写入者再继续 |
| C3（**M5**）| R1 最终 dump（9 库）+ 密文自检 | 10–20 min [待测] | 全部 `Dump completed` |
| C4 | 删除演练库 → R2 恢复 | 15 min [待测，console 为主] | 无错误 |
| C5 | R3 核验（停写后 COUNT 为硬门禁）| 15 min | 零差异 |
| C6（**M6**）| §3 升级链：Workflow 012–014、Console 选装、Aims/Assets 源副本升级 → 统一库 plan → **现场复核新 review hash**（与演练 hash 不同属正常，须核对原因）→ apply → V2 → 视图/激活 → verify-views；激活须用离线停写证据对应的 Platform 签名 `enterprise-external-drain-approval.v1`，不使用 JS coordinator 的释放信封 | 30–45 min | 每步 verify PASS；排空认可验签和事务闭包 PASS；视图全数通过 |
| C7（**M7**）| 新库副本上的数据写入：新域名 OIDC 回调、服务凭据新签、grant（G-7）、GitLab 凭据入 Vault（上线计划 §1）| 20 min | Console grant verify；真实 client 全组合签发 200、旧精确 scope 失败 |
| C8 | Runtime 最终配置 → 启动探测 → start；Vault 指纹比对；Platform 心跳；目录连接器 | 15 min | health 200、`listening`、bindings 一致 |
| C9 | 启动 Console/Workflow/Enterprise/Aims 调度/Codocs/Gateway（G-4 顺序）；登录、JWKS kid、项目详情、工作项、事项审批→回调、Codocs 读写、调度空队列探测 | 30 min | 冒烟全通过；无公网回落（G-8）|
| C10（**M8**）| nginx 切到 Gateway（拓扑 §2b 已批方案）；人工批准后开放员工，不调用 JS coordinator `/release`；观察 | — | 72 h 观察开始 |

## 7. 回退

判据是**新系统是否已有员工写入**。原库、原 Worker、日本 Runtime 全程未改，是回退目标。

- **C10 之前**（仅有冒烟/标记数据）：停新主机全部服务 → 用户重新启用原 Gateway（C1 若停了日本 Runtime 与 timer，先启动并核 health）→ 原入口登录冒烟。新主机数据保留作证据，下次窗口删库重来。不需要数据回迁。
- **C10 之后**：原则上修复前进（上线计划 §5：先隐藏入口，不回退业务库）。只有新系统不可用且无法在观察期修复时才回退，步骤：①nginx 恢复维护页、停新 Gateway 与调度，冻结新库；②加密全备新库；③以 C5 恢复点为基线，按表导出增量（新增/更新按主键与 `updated_at`，删除按主键集合差），再从统一库 `aims_*`/`assets_*` 映射回 `hzy_aims`/`hzy_assets`、Workflow 新列丢弃映射到 011 结构；④形成逐表 before/after 清单，**单独批准**后写回日本库；⑤再启用原 Gateway。不回迁：会话/refresh token（员工重新登录）、`vault_access_logs`/`auth_token_events` 审计增量（另存档）、新签服务凭据与 grant（新系统专有）。统一库自带的 `enterprise-recovery.v1` 只能恢复到同实例新 schema（切换协议 §7），不能直接写回日本库。反向回迁工具目前不存在 [核实：仓库无此工具]，因此 **C10 后回退代价高，Go/No-Go 必须以 C9 冒烟为硬门禁**，观察期内出现问题优先修复前进。
- Codocs 文件在 OSS，两套系统共用 bucket [推断]；新系统上传的对象回退后仍在 bucket，但库内引用需随③回迁，否则成为孤儿对象。

## 8. 批准点汇总

| 编号 | 写入对象 | 可合并批准 | 不默认包含 |
| --- | --- | --- | --- |
| M0 | 新主机 MySQL 安装、配置、账号、备份任务 | — | 任何生产读写 |
| M1 | 日本 MySQL 新建 `hzy_dump` 只读账号 | — | 其它生产写入、改 root |
| M2 | 生产只读 dump + 新主机恢复（演练）| M3 | 最终 dump |
| M3 | 新主机副本上的 schema 升级与统一库演练 | M2 | 开放入口 |
| M4 | 用户停用原 Gateway（及日本 Runtime/timer）| — | 删除或修改原系统 |
| M5 | 最终 dump | M6 | — |
| M6 | 新主机副本升级链与统一库激活 | M5、M7 | Platform 写入 |
| M7 | 新库副本上的 OIDC 回调、凭据、grant、Vault 写入 | M6 | 新 Platform 记录（G-6 另批）|
| M8 | nginx 切换与开放员工 | — | 回退写回（另批）|

## 9. 待用户决定或提供

1. **Q1 Finance/People/Webdev/Altoc**：按 §0 冷存档 + 切换后停用（推荐）；还是需要切换期继续可用（需另开旧链路只读入口，与“停用原 Gateway”冲突）？员工通知口径？
2. **Q2 停写强度**：只停原 Gateway，还是同时停日本 Runtime（阻断经 Tunnel 的非 Gateway 写入，如 Worker 直连 Runtime、旧 cron；可逆）？推荐同时停。
3. **Q3 部署编码**：新 Platform 是否沿用原部署编码（`C000001-<app>`）（推荐，免 489 条 grant 重绑），还是新编码（需 G-7 批量重绑与凭据重签）？
4. **Q4 目录连接器**：复制原身份还是重新 enrollment？新主机能否直连 LDAP（地址/端口）？
5. **Q5 日本主机访问**：能否只读 SSH 或加入 Tailscale（Vault 密钥/连接器状态传输、确认 Vault 密钥存放位置、查看 `auto-update status`）？日本 Runtime 的更新 timer 是否跟踪 `latest`？
6. **Q6 备份异地**：新主机每日备份的第二份副本放哪里（公司 NAS / gitlab 主机 / 对象存储）？
7. **Q7 窗口**：可接受的停机时长与时段；C10 后多长时间内仍接受回退（建议 24 h，之后只修复前进）。
8. **Q8 K2 方案**：统一库激活工具选 A（参数化现有协议工具）还是 B（一次性激活工具）？由谁实现、谁审。（已决定：A，2026-09-29 已实现，待 Claude 安全审查。）
9. **Q9 生产 root@'%'**：本次只读文件以 `root@'%'` 登录且端口可从外部访问——是否在上线后单独收紧（限制来源、改用专用账号）？本文不执行。

### 9a. 用户决定（2026-09-29）

1. Finance / People / Webdev / Altoc：**冷存档**（带到新机、不接 Runtime、不升级；切换后原系统停用）。
2. 停写时**同时停止**日本 Runtime 服务及其自动更新 timer（回退时再启）。
3. 新 Platform **沿用原部署编码**：各应用为 `C000001-console`/`-workflow`/`-aims`/`-codocs`/…，Runtime 自身为 `c000001-prod-tenant-runtime`（2026-09-29 只读核实生产 `deployment-bindings.json` 与 Platform `deployments`；此前写作 `c000001-prod-*` 有误）。生产 active grant 476 条未绑定部署、11 条绑定 `C000001-console`，均无需重绑。
4. 目录连接器：**复制原身份**；新主机可直连 LDAP。
5. 允许**只读 SSH** 日本主机（root@oa.wiztek.cn）。
6. 新主机每日备份的异地副本放 **gitlab.wiztek.cn**（`/wiztek` 盘，经 Tailscale 传输，密文存放）。
7. 停机窗口与开放后回退期**不设限**（仍以 C9 冒烟为硬门禁、修复前进优先）。
8. K2 采用 **A**（见 §3）。
9. 生产 `root@'%'` **暂不收紧**（风险已告知；迁移仍用专用 `hzy_dump` 账号）。

**只读核实（2026-09-29，日本主机）**：`hzy-data-runtime-update.timer` 每 5 分钟以 `--version latest` 从 `https://downloads.huizhi.yun/packages/hzy-data-runtime` 自动更新生产 Runtime（受本机 `auto-update-policy.json` 约束）；另有 `hzy-data-runtime-ctr812`（API 触发更新）、`hzy-connector-runtime`、`hzy-notification-runtime` 及其更新 timer。由此硬规则：
- 切换完成前**禁止向 `latest` 发布任何 Runtime 包**，新环境制品只用固定版本号安装；
- 新主机 Runtime **不启用**自动更新 timer，升级走 G-4 发布流程；
- C1 停写时一并停 `hzy-data-runtime` 与其 update timer；`ctr812`、connector、notification 三项的去留在 S3 前核对。

### 9b. 上线运营前置：周报填报周期（2026-09-29 本机验收发现）

整周工时提交要求当周已存在 `weekly_reporting_periods` 记录（否则 Runtime 返回 409 `weekly_reporting_period_required`）。周期**只能**由持有 `aims:weekly_reports:review` 的角色（manifest 中仅 `aims:project_director`）在周报汇总页“生成应报清单”手动生成，Runtime 无定时自动生成（`project_governance_responsibility.go` `generateWeeklyReportingPeriod`）。因此：切换前核对生产 `project_director` 持有人；C10 开放当周由其生成当周周期，并在上线说明中告知“每周先生成周期”；是否增加定时自动生成另行决定（10/8 后）。本机 C000001 test 统一库目前无任何周期，rev 28 仅 `zhuxicheng` 持有该角色。

## 10. 关键风险

- **K1** 生产 MySQL `root@'%'` 可从外部登录（本次只读核对即经此账号）。迁移不再使用它；收紧属原系统变更，另议（Q9）。
- **K2** 统一库激活链路的生产级工具：方案 A 已实现（§3，2026-09-29），在安全审查、生产 Platform 签名端参数化和 `hzy_cutover` 账号就绪前仍是 S3 的前置阻断项。
- **K3** `lower_case_table_names` 只能在初始化前设定；错过需清空数据目录重来（S0 验证）。
- **K4** Vault 主密钥与 `hzy_console` 不成对 → 全部 Vault 密文与 OIDC 签名不可用；只按指纹 + 登录签发 + 只读探测三项判定。
- **K5** Aims 从 v5.x 旧结构（70 表、旧状态分类）一次跨越到统一库 150+ 表，是本次最大的结构变化；列级差异和数据语义（状态目录）只能靠 S3 两轮演练发现。
- **K6** C10 后回退需要尚不存在的反向回迁；窗口前必须接受“修复前进为主”。
- **K7** 日本链路不稳，dump 可能中断；停写后重跑是安全的，但会拉长窗口（S3 实测，必要时改路径 B）。

## 附录：本文只读核对使用的查询（生产，READ ONLY 会话）

`information_schema.SCHEMATA/TABLES/COLUMNS/STATISTICS/TABLE_CONSTRAINTS/TRIGGERS/ROUTINES/EVENTS/REFERENTIAL_CONSTRAINTS/SCHEMA_PRIVILEGES`；9 库 361 张表逐表 `COUNT(*)`；`integration_operation` 按状态/目标的 `COUNT(*)`；`auth_client_redirect_uris` 按域名 `COUNT(*)`；`workflow/docs/migrations/011–014_*_verify.sql`（仅 information_schema）；Console manifest 与生产结构逐项比对；服务器变量与 `SHOW GRANTS`（当前账号）。未输出任何业务行、密文、token 或 scope_json；defaults 文件内容未打印。
