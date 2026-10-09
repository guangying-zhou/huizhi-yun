# 自托管上线 S3 数据迁移演练执行单（待逐项批准）

状态：**草案，未执行**。本文只把 [G-5 数据迁移 Runbook](./Go-Live-Self-Hosted-Data-Migration-Runbook.md) 的 M1–M3 展开为现场步骤，不授权读取生产数据、创建账号、写新主机、启动服务或清理副本。S3 用生产数据的**演练副本**测量和验证流程；S4 必须重新取最终快照、证据和批准，不复用 S3 的库、密钥或认可。原 `wiztek.huizhi.yun` Gateway、日本 Runtime 与生产库在 S3 保持运行和可写；新站点入口维持维护页。

依据：[拓扑方案](./Go-Live-Self-Hosted-Topology-Plan.md)、[Platform 方案](./Go-Live-Self-Hosted-Platform-Plan.md)、[离线排空证据设计](./Enterprise-Offline-Drain-Evidence-Design.md)、[切换协议 §9](./Unified-Enterprise-Cutover-Protocol.md)。本执行单与 G-5 §9a 的决定一致：冷存档 Finance/People/Webdev/Altoc；新 Platform 用 `prod`、沿用 `C000001-<app>`，Runtime 为 `c000001-prod-tenant-runtime`；目录连接器复制原身份；不发布 Runtime `latest`。S0 已完成 MySQL 8.0.46、备份哨兵演练和主机防火墙；`hzy_rt_enterprise`、`hzy_cutover` 仍待按确定库名授最小权限。

## 0. 批准、角色与证据约定

每个 `M*` 是**独立批准点**；M2 与 M3 可在列明对象、主机、账号及回滚边界后合并为一次批准。批准 M1 不包含 M2；批准 M2 不包含 M3；M0 既有批准不覆盖这三项。下表中的 `M3a–M3f` 是 M3 内部停止门槛，遇到新的环境写入、grant、Platform 签发或超出原批准范围时另行请求明确批准。生产 Platform P1–P6 属 G-9 独立批准，不能借 M3 执行。

| 角色 | 主机与权限 | 限制 |
| --- | --- | --- |
| 原机 DBA | 日本 `oa.wiztek.cn`，仅 M1 时使用受控 DBA 身份 | 只创建限定来源的 `hzy_dump`，不改生产业务行或 root 授权 |
| 导出操作员 | 推荐在新主机 `100.64.72.59` 以备份身份，经 TLS 使用日本库 `hzy_dump`；备用方案才在日本主机本地导出 | 不在命令行、日志或证据中放口令/密钥；生产只读 |
| 迁移操作员 | 新主机，以 `hzy_migrator` 写**演练库**；统一链路另用受限 `hzy_cutover` | 不用 root 或全局管理权限代替 cutover；Runtime 停机时做域安装 |
| 演练验证员 | 新主机只读库账号、隔离的 Platform/Runtime/Worker 进程 | 只访问本机回环或维护页，禁止旧公网端点回退 |

证据根目录建议为新主机 `/home/hzy-backup/s3/<UTC-批次号>/`（0700），原始输出、profile、证据包逐件 0600；回执只记相对路径、命令版本/提交、UTC、耗时、退出码、库名/计数、SHA-256、review hash、kid 与**公钥指纹**，不记 DSN、明文、密文、token、scope_json 或主密钥。第一轮和第二轮分目录，失败现场保留加密备份和日志，未经另批批准不删除。`<...>` 均为审批后填入的占位符；以下是**命令形状，不可原样执行**。预计耗时是 S3 待测预算，不构成跳过 verify 的理由。

## M1：日本生产库建立专用只读导出账号（预计 15–30 分钟）

- **执行/只读前置**：日本机 DBA，确认来源确为新主机的 Tailscale 地址或固定出口 IP、TLS 可用；只读 `SHOW GRANTS`、`information_schema` 库/事件计数，确认原库仍正常服务，记录日本实例 ID。S0 的新主机与源机地址不要凭记忆填写。
- **写入命令形状**：经受保护 SQL 文件创建 `hzy_dump@'<已核对来源>' REQUIRE SSL`；仅九个 `hzy_*` 源库 `SELECT, SHOW VIEW, TRIGGER` 和全局 `SHOW_ROUTINE`，不授 `EVENT/LOCK TABLES/RELOAD`。口令走受保护文件/安全输入，不写 shell 参数；执行后以该账号 `SHOW GRANTS` 和 `SELECT COUNT(*) FROM information_schema.EVENTS ...` 回读。
- **通过/停止**：授权集合、来源和 TLS 精确相等；九库可只读、事件数为 0；任一宽授权、无 TLS、地址不符立即撤销新账号并停 M2。
- **回滚/证据**：撤销该账号及其 grant，回读不存在；保存脱敏 SQL、授权清单、事件计数、审阅人与 UTC 于 `M1/`。不改 root@`%`（G-5 §9a 已决定暂不收紧）。
- **用户批准原文建议**：`批准 M1：仅在日本生产 MySQL 为来源 <已核对地址> 创建 REQUIRE SSL 的 hzy_dump 只读账号，权限限九库 SELECT/SHOW VIEW/TRIGGER 与全局 SHOW_ROUTINE；不改业务数据和 root。`

## M2：只读导出、传输、恢复演练副本（预计 60–120 分钟）

### M2a 导出与传输（预计 25–60 分钟）

- **执行/只读前置**：推荐在 `100.64.72.59` 以备份身份直连日本 MySQL，经 M1 账号与 TLS 读取，密文直接落新机，无日本机中间文件。先回读九库清单、`information_schema.EVENTS=0`、源实例/服务器版本、磁盘余量、`hzy_console` 与 Vault 主密钥配对来源及指纹。源库在 S3 仍可写：逐表 `COUNT(*)` 只作参考，不当作同一全局快照；九库逐库 dump 的时点不同。
- **命令形状**：沿 G-5 §5 R1：`mysqldump --defaults-extra-file=<0600-source.cnf> --ssl-mode=REQUIRED --single-transaction --quick --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --routines --triggers --skip-events --hex-blob --order-by-primary --skip-dump-date <db> | gzip | openssl enc -aes-256-cbc -pbkdf2 ... -out <M2>/<db>.sql.gz.enc`，逐库九次，`hzy_platform` **不在这九库里**。每份做解密流末尾 `Dump completed` 检查和密文 SHA-256。若直连受限，备用路径才在日本机本地用 `age` 公钥加密，经 Tailscale/SSH 传到 `100.64.72.59`，传后比对两端密文 SHA-256；该路径必须在 M2 批准中明写。
- **通过/停止**：九份均完整、密文 hash 匹配、未在原机留下明文、导出不持锁；缺库、断流、事件非零、指纹不符停在 M2a。不要通过重试把不同时间的九库误称为一致快照。
- **回滚/证据**：原生产库无数据回滚；失败密文保留于受控目录待复盘，审批后销毁。记录逐库字节数、耗时、hash、客户端版本、源实例 ID、传输方式于 `M2/export/`；密钥另放 0600 受保护目录，不入回执。

### M2b 恢复与三层校验（预计 35–60 分钟）

- **执行/只读前置**：新机 `hzy_migrator`，确认目标实例 `@@server_uuid=1e3c34dd-bb9b-11f1-bf6b-000c293f1086` 与空演练 schema 清单；名称冻结为 `hzy_console`、`hzy_workflow`、`hzy_codocs`、`hzy_aims_src`、`hzy_assets_src` 及四个冷存档库，**不覆盖正式库**。恢复前加密备份/空库基线和逐库容量记录；`hzy_platform` 走 G-9 P1 独立克隆审批。
- **命令形状**：`CREATE DATABASE <target> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`；按 G-5 §5 R2 从密文解密、解压、去掉 `DEFINER=` 后，`mysql --defaults-extra-file=<0600-migrator.cnf> --database=<target> --show-warnings` 导入。Aims/Assets 在同一 MySQL 实例中保留源副本名，供统一迁移工具读。不能把 `--databases` dump 自带的源库名导回正式库。
- **通过/停止**：九库全部恢复；逐表行数、同客户端同旗标的 INSERT 流 SHA-256、表/列/索引/约束/触发器清单与导出对应。三张无主键表用 G-5 指定的 `--skip-extended-insert` 加排序单验；跨 MySQL 8.0.45/8.0.46 的 `CHECKSUM TABLE` 仅作辅助。S3 源生产持续写入，恢复结果要对**导出流**而非事后源库当前值。Vault 指纹与原 `hzy_console` 密钥成对核对，绝不输出密钥。
- **回滚/证据**：停止使用该批副本；从 M2 前空库基线重建或在另批批准后删演练 schema，原库不变。逐库导入日志、校验脚本输出、DDL/行数差异及 hash 存 `M2/restore/`。
- **用户批准原文建议**：`批准 M2：用 hzy_dump 对日本九个生产业务库只读导出，加密传至 100.64.72.59，在明确命名的演练库恢复与校验；不含 hzy_platform 克隆、最终 dump、生产停写或任何公网切换。` 如选备用传输，附加 `允许日本机本地 age 加密暂存并经 Tailscale 传输，验 hash 后按批准清理暂存。`

## M3：仅对新机演练副本升级、激活模拟和隔离 smoke（预计 2–4 小时；两轮分别计时）

**总前置/阻断**：M2b 全部 PASS；发行制品固定为同一干净提交与正式版本；目标没有已激活 generation；`hzy_migrator` 与 `hzy_cutover` 的 schema 级授权已**另批批准并实际核验**，不能用 root 补位；受保护 `enterprise-cutover-profile.v1` 的 tenant=`C000001`、env=`prod`、source/target schema、部署码和新机 `@@server_uuid` 全部匹配。profile 中 Platform 活动 `keyId` 与 Ed25519 公钥 SHA-256 指纹须与**新生产 Platform** 逐字核对；旧 Platform kid 或合成 key 不得冒充生产事实。生产 sealed 快照/provider receipt 的受信采证、冷存档四份人工材料、Platform 证据导入/签发及 systemd credential 分发/销毁仍需现场审查与单独批准；未闭合时 **M3d 激活阻断**，可先完成 M3a–M3c 的 plan/副本写入。M3 的隔离测试签名不得写进生产 Platform 或成为 S4 凭据。

### M3a 各库迁移与备份（预计 30–60 分钟）

| 库/步骤 | 命令形状及顺序 | 通过条件 |
| --- | --- | --- |
| Workflow | 用受限 migrator 按 `workflow/docs/DEPLOYMENT.md`，先核 001–011 水位，再 `mysql --defaults-extra-file=<cnf> hzy_workflow < workflow/docs/migrations/012_durable_notification_outbox.sql` → `012_durable_notification_outbox_verify.sql`；同样 `013_bounded_delivery_outbox.sql` → verify（4 项）、`014_delivery_recovery_attribution.sql` → verify（1 项）。逐条执行，不用通配循环 | 每一步 verify 全 PASS，`flow_notification_outbox`、`flow_delivery_audit` 存在；不跳版 |
| Console/Directory | 对照 release 的 66 表 manifest 与 `schema/status`；仅当能力开关启用才应用 `verified_policy_snapshots`、`console_service_assertion_replay`、`gateway_service_assertion_replay` 对应的**已审**迁移；授权、OIDC 回调、Vault 凭据写入属于 G-7/M7 或 G-9，不借 M3 做 | 表/列/索引/约束齐；未启用项保持关闭；Vault 只读解析探测不打印 token |
| Codocs | 核对 24 张必需表；v1.6 产品文档表只按 release 功能开关决定，快照 V2/协作 V2 默认关 | schema/status PASS；无未审扩表 |
| Aims 源副本 | 先将两张无主键历史备份表单独加密留存，再在**副本**移除；依版本顺序补 v5.x（含只 ALTER 版），与本机统一库 `--no-data` DDL 比较 | 逐版本 verify/结构差异清零，原导出和备份表可恢复 |
| Assets 源副本 | 补 `20260907_product_catalog_watermark.sql` 等 release 必需迁移并验；另执行 `20260929_backfill_schema_drift.sql`（补 `config_detail`、`artifact_type`、`source_context` 三列，先备份，执行后跑 `_verify.sql` 应 3 行 PASS；S3 已于 2026-09-29 在 `s3r1_hzy_assets` 通过，M6 同样执行） | source schema 满足迁移计划 |
| Altoc/Finance/People/Webdev | 保持冷存档原样，不升级、不开 Runtime app；只做 provider/未结操作计数和部署/外发清单 | 无活动消费者与未决外发；不把“冷存档”自动判完成 |

每步写入前备份当前演练库、留 SQL 文件 hash，失败只恢复该步前副本并停，不在半升级库继续。

**加载规范 schema 的注意事项（2026-09-29 S3 事故教训）**：`codocs/docs/codocs_schema.sql` 等规范 schema 文件开头带 `CREATE DATABASE IF NOT EXISTS <正式库名>; USE <正式库名>;`，直接灌入 scratch 库会在新主机上误建**正式库名**（本次 `hzy_codocs` 已核对为空并 DROP）。任何用规范 schema 做对比或装库的步骤，必须先剥离 `CREATE DATABASE` / `USE` 语句，再灌入明确命名的 scratch 库（`s3r*_scratch_*`），用完 DROP 并回读库清单；不得用 root 在含正式库名的语句上执行未审文件。预计时长含备份和 verify；真实时间记入 `M3/schema/`。

### M3b K2 源 fence、计划与复制（预计 30–50 分钟）

新主机 `hzy_cutover` 只操作 `hzy_aims_src`/`hzy_assets_src` 与**未激活**统一库，Runtime 停止、Gateway 未指向。按[切换协议 §9](./Unified-Enterprise-Cutover-Protocol.md#9-生产参数化切换方案)形状：

```text
hzy-enterprise-migrate --profile P --plan source.json                  → H0
hzy-enterprise-test-cutover --profile P --source-plan source.json --source-review-hash H0 --output spec.json --phase install-fence --apply
hzy-enterprise-test-cutover --profile P --source-plan source.json --source-review-hash H0 --output spec.json --phase fence --apply
hzy-enterprise-test-cutover --profile P --source-plan source.json --source-review-hash H0 --output final.json --phase prepare-final --apply  → H1
hzy-enterprise-migrate --profile P --plan final.json --apply --review-hash H1
```

每次 `--apply` 前现场核审精确 H0/H1、schema 和行数；H1 与 H0 不同正常，但须解释。Aims V2 状态加法迁移在统一库复制后按已审版本执行，不在源库猜测状态。通过：generation 仍为 0、源 fence 与 cutoverKey 匹配、COUNT/复制校验通过。失败恢复 M3b 前加密备份；不可在部分 fence/复制结果上用新 key 盲重试。证据 `M3/k2-copy/`。

### M3c 兼容视图与预激活拒绝（预计 15–30 分钟）

`hzy-enterprise-compatibility-rehearsal --profile P --binding-candidate runtime-candidate.json --migration-plan final.json --artifact views.json` 先计划得 HV；核审后才 `--apply --review-hash HV`。generation=0 时 Runtime 校验器与 ProductService 应拒绝使用这些视图；视图数量不得为 0。失败恢复 M3c 前副本，保存计划、HV、DDL 差异和拒绝证据于 `M3/views/`。

### M3d 离线排空认可与隔离激活（**阻断，预计 30–60 分钟另计**）

S3 不能关闭仍在服务生产的旧 Gateway/日本 Runtime，因此不能用真实 M4 停写事实签发生产认可。若要演练完整链，须在**生产数据的演练副本和隔离控制面**构造明确标为 S3 的停写模拟观测，使用测试 HMAC/测试 Platform 签发，且与生产 kid、凭据、数据库、路由物理隔离；这一隔离控制面与 provider receipt 的正式采证链、受保护 systemd credential、Platform `20260929-enterprise-external-drain-generation.sql`、冷存档逐项人工确认均待审/待批准。没有这些，M3d 保持阻断，不得用 `enterprise-drain-release.v1`、JS test coordinator、自签信封或 `ingressDrained=true` 裸字段绕过。精简方案 B 只要求现有审阅页的人审，不执行未实施的双人复核 UI/窗口 epoch/二次签名状态机。

满足前置后：从恢复副本用 `provider-report-cli.mjs collect --config <0600-config> --out provider-report.json`，再用 `seal-cli.mjs seal --manifest <P-manifest> --report <provider-report.json> --profile P --actors <actors.json> --cold-archive <cold.json> --out-prefix <S3-window>`；逐件核对四类停写模拟材料、七项 provider 闭包及 Finance/People/Altoc/Webdev 冷存档人工证据，记录原始文件 SHA-256。隔离 Platform `ops.deployments` 页面 plan→review→approve，签 `enterprise-external-drain-approval.v1`；然后 `hzy-enterprise-drain --profile P --fence-plan source.json --final-plan final.json --approval approval.json` 先只读核验，最后在**隔离演练库**以 `--mode activate --apply --review-hash H1` 激活。Go 验签、profile kid/公钥指纹、tenant/env/instance/generation、事务内七项闭包全 PASS；任何缺项停在 generation=0。激活后 Runtime 仍停机，按实际 release 所需分别运行 `hzy-enterprise-add-altoc --profile P --config runtime.json --mode plan`、核审 plan hash 后按工具要求携带 `--apply` 与精确 hash 执行 `--mode apply`、最后 `--mode verify`（仅安装必须的删除证据表等；Altoc 业务域仍冷存档），并运行 `hzy-enterprise-verify-views --profile P --config runtime.json`；一个视图都没有视为失败。S3 激活后的副本只能销毁重建，不能改作 S4。证据 `M3/drain/` 只存脱敏日志、hash、签发回执与测试 key ID。

- **M3d 另批批准原文建议**：`批准 M3d：仅在与生产 Platform、签名密钥、路由和库隔离的 S3 控制面，用已审 sealed/provider 证据链和测试签名认可，对 100.64.72.59 演练副本执行排空认可、激活与 verify；不签生产认可、不打开员工入口，记录 kid/公钥指纹及证据 SHA-256。` 未能满足隔离及证据条件时，该批准不得视为已生效。

### M3e Runtime、Platform 隔离启动与 smoke（预计 20–40 分钟）

新主机本机回环、维护页后，以受审演练配置启动：Runtime 只监听 `127.0.0.1:31080`，`HZY_DATA_RUNTIME_CONFIG` 指向演练副本、`enterprise.generation` 等于演练 registry，apps 仅 console/directory/workflow/codocs 与核定 aims/assets；Finance/People/Webdev/Altoc 关闭。先 `hzy-enterprise-verify-views`、`/runtime/schema/status`、`/runtime/health`，再做 Console 签发、Vault 只读解析和 Workflow 发起/审批的**隔离测试数据** smoke；无入口时不可把线上员工请求导入副本。新 Platform 克隆/清理、全新签名 key、C000001 登记、正式 API 探测依 G-9 P1–P6 **独立批准**；若 P1–P6 未就绪，只能用明确隔离的测试 Platform 验证启动，不声称生产 Platform 链路通过。检查配置不含旧 Runtime 公网端点，Platform kid/公钥、OIDC issuer、deployments、Console Vault 指纹闭合；Gateway/nginx 继续维护页。任一回退到旧公网、新旧签名混用或签发失败即停止服务并恢复配置。证据 `M3/smoke/` 包括进程版本、回环 health、schema/status、签发结果码、维护页截图/响应；不记 token。

### M3f 第二轮、耗时与清理（第二轮预计 2–4 小时；清理 20–40 分钟）

第二轮从**重新导出并恢复的演练副本**按相同审阅流程脚本化重走；逐步计时 dump、传输、恢复、九库核验、每个 DDL、K2 plan/review/apply、provider 采集、人审、激活、Runtime/Platform 启动。用实测总时长、最大单步、故障恢复时间修订 S4 窗口；出现不一致先修 runbook，不能带缺口进入 S4。

清理须另获明确批准：先停全部演练进程，回读无生产路由/Service Binding 指向演练库，留存加密备份、hash、回执与失败证据；再按 schema 白名单删除两轮演练库、测试控制面数据、测试凭据和临时解密文件，回读不存在。**不删除**日本生产库、M1 账号、S0 正式备份任务、Vault 原密钥、正式 Platform 库或任何原系统。M1 账号何时撤销另定。证据 `M3/cleanup/` 保存清理前清单、受审删除清单、执行人与复核、回读结果。无清理批准时隔离停用并保留受控副本。

- **M3 用户批准原文建议**：`批准 M3：仅在 100.64.72.59 的 M2 演练副本上，使用已审 SQL 与受限账号完成 Workflow/Console/Codocs/Aims/Assets 迁移、K2 plan/review-hash/apply、隔离视图和 Runtime smoke；不改日本生产库、生产 Platform、Gateway 或公网入口。M3d 激活须待 sealed/provider 证据链、隔离 Platform 与 hzy_cutover 授权另批批准。`
- **清理批准原文建议**：`批准 M3 清理：仅按 S3 回执中逐库/逐文件白名单删除 100.64.72.59 的两轮演练副本和测试凭据；保留加密证据，不触及生产或 S0 备份。`

## 4. S3 开始前必须关闭的缺口

| 编号 | 缺口与判定 | 阻断点 |
| --- | --- | --- |
| B1 | 生产 sealed 快照、原始 Cloudflare/systemd/源库/nginx 停写材料、provider receipt 与四项冷存档人工证据的**正式产出链**经安全审查；S3 只能用标明隔离的模拟事实，不能冒充 M4 | M3d；S4 M6 更是硬阻断 |
| B2 | 新生产 Platform 活动签名 `kid` 与 Ed25519 公钥 SHA-256 指纹和 0600 profile 逐字核对；S3 测试 key 物理隔离、S4 重新生成新 key | M3d；生产激活 |
| B3 | `hzy_cutover`/`hzy_rt_enterprise` 按冻结 schema 获最小权限并 `SHOW GRANTS` 核实；不得 root/全局授权 | M3b 起的写入、M3e 启动 |
| B4 | 生产 Platform G-9 P1–P6 的克隆、12 张表迁移、清理、签名、入口、正式部署/授权与 13 项探测各有独立批准；旧 kid/旧 token 不沿用 | 声称生产 Platform 链路通过前 |
| B5 | G-4 固定制品、Runtime `HZY_DATA_RUNTIME_CONFIG`、Console/Vault 成对密钥、目录连接器身份复制、规范端点与维护页配置受审；不发布 `latest` | M3e |
| B6 | 日本 `hzy-data-runtime` update timer/`ctr812`/connector/notification 的停写范围在 S4 前确认；M4 不属于 S3 | S4 M4，不在 S3 停生产 |

所有阻断项由责任人记录“已审证据链接、适用环境、批准号、UTC”，不以草案文字或本机测试 PASS 替代。S3 最终报告应明确哪些只完成了 M3a–M3c，哪些已在隔离链路完成 M3d–M3f；未执行项标 **未验证**，不得写为通过。

## 用户批准记录

- 2026-09-29：用户批准 **M1、M2**（按本文 M1/M2“用户批准原文建议”的范围执行：M1 仅在日本生产 MySQL 创建 REQUIRE SSL 的 `hzy_dump` 只读账号，权限限九库 SELECT/SHOW VIEW/TRIGGER 与全局 SHOW_ROUTINE，不改业务数据和 root；M2 仅用 `hzy_dump` 只读导出九个生产业务库、加密传至 100.64.72.59 并在明确命名的演练库恢复与校验，不含 `hzy_platform` 克隆、最终 dump、生产停写或公网切换）。M3 及其清理、M3d 仍待另批。
- 2026-09-29：M1、M2 已执行完成（hzy_dump@39.78.255.170 只读账号；九库导出 20260929T113406Z 并恢复为 `s3r1_*`，三层校验与 Vault 指纹成对核对通过，详见本地报告）。用户随后批准 **M3**（原文按本文“M3 用户批准原文建议”：仅在 100.64.72.59 的 M2 演练副本上，使用已审 SQL 与受限账号完成 Workflow/Console/Codocs/Aims/Assets 迁移、K2 plan/review-hash/apply、隔离视图和 Runtime smoke；不改日本生产库、生产 Platform、Gateway 或公网入口）。**M3d 激活不在本次批准内**，仍待 sealed/provider 证据链、隔离 Platform 与 hzy_cutover 授权另批。
- 2026-09-29：M3 账号授权已按协调者确认的最小方案在 100.64.72.59 由 root 执行并回读（全部 schema 级、无全局权限、无 GRANT OPTION，库名下划线转义）：`hzy_migrator` 对 `s3r1_hzy_workflow/console/codocs/aims/assets` 授 `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES, TRIGGER, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, EXECUTE`，对四个冷存档库 `s3r1_hzy_altoc/finance/people/webdev` 仅 `SELECT`；`hzy_cutover` 对源副本 `s3r1_hzy_aims/assets` 授 `SELECT, INSERT, UPDATE, CREATE, TRIGGER`，对统一目标库 `s3r1_hzy_enterprise` 授 `SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES, TRIGGER, CREATE VIEW, SHOW VIEW`（不授 DROP，回滚域安装时再临时追加）；`hzy_rt_enterprise` 仅对 `s3r1_hzy_enterprise` 授 `SELECT, INSERT, UPDATE, DELETE`。回读与负向验证（访问 `mysql.user`、创建其它库、DROP、访问正式库名与其它演练库均被拒绝）通过。`hzy_rt_console/workflow/codocs` 对 `s3r1_*` 的授权留到 M3e 前另报。

## 库名对应与账号约定（2026-09-29 确认）

- 统一目标库：**演练用 `s3r1_hzy_enterprise`（第二轮 `s3r2_hzy_enterprise`）；正式迁移（M6）目标为 `hzy_enterprise`**。cutover profile（`enterprise-cutover-profile.v1`）的 target schema 以此对应为准：演练 profile 写 `s3r1_hzy_enterprise`，正式 profile 写 `hzy_enterprise`，两者不得混用。
- 源副本沿用 M2 恢复名 `s3r1_hzy_aims` / `s3r1_hzy_assets`（正式 M6 为 `hzy_aims_src` / `hzy_assets_src`，见 G-5 §9a）。
- `hzy_migrator` 在新主机 S0 已带 ``hzy\_%``.* 的 ALL PRIVILEGES（覆盖正式库名，M6 仍需使用）。**清理项：切换完成后收紧为具体库，不再保留通配。**
- `hzy_migrator` 在 S0 后处于 `ACCOUNT LOCK`；M3 期间仅在迁移窗口临时 `ACCOUNT UNLOCK`，M3a 结束（或失败停手）后立即重新锁定并回读。
- `hzy_dump@'39.78.255.170'`（日本生产库）与新主机 `/root/.hzy-s3/hzy_dump.my.cnf`：演练与正式迁移全部结束后必须 `DROP USER` 并删除。
- 2026-09-29：M3b H0 计划被 11 项 `json_field_contract_unregistered` 阻断（见 [JSON 契约缺口盘点](./Enterprise-JSON-Contract-Gap-Inventory.md)）；决定补可执行校验器并注册，不走 allowlist。M3c–M3f 暂停。M3f 清理项：轮换 `hzy_cutover` 口令（曾短暂出现在命令行参数）。

## S3 首轮执行记录（2026-09-29，批次 `20260929T113406Z`，演练库 `s3r1_*`，新机 100.64.72.59）

M1–M3c、M3e 已执行；**M3d 阻断，M3f（第二轮 `s3r2_*` 与清理）未执行**，待正式迁移导出方式确认后再定。完整日志在新机 `/home/hzy-backup/s3/20260929T113406Z/`（不入仓库）。

### 阶段结果与耗时

| 阶段 | 结果 | 耗时 |
| --- | --- | --- |
| M1 | 日本库 `hzy_dump`（REQUIRE SSL，只读九库）已建 | — |
| M2a 导出 | 九库经新机直连日本库 TLS 导出，2 条连接并行；首段串行（workflow/people/webdev/altoc）约 8 分钟，随后导出脚本重启一次；并行段 11:50–12:56 UTC：泳道 A（finance 1374 s、aims 283 s、assets 119 s、codocs 96 s）约 31 分，泳道 B 只有 console，**3983 s ≈ 66 分，为瓶颈**。全程 11:34–12:56 UTC | 约 82 分（含重启） |
| M2b 恢复 | 九库恢复并三层校验通过；console 118 s，其余各 2–12 s | 13:05:54–13:07:53 UTC，约 2 分（校验另计） |
| 校验结论 | 283 表中 280 个行数与源现值相等，差异仅 console 三张追加型日志（导出后新增）；Vault 指纹成对 | — |
| M3a Workflow | 012–014 逐步 verify PASS | 约 3 s |
| M3a Codocs | 5 个迁移 | 约 6 s |
| M3a Aims | 25 个迁移（v5.3–v5.41） | 约 50 s（含备份） |
| M3a Assets | 7 个迁移 + `20260929_backfill_schema_drift.sql`（三列） | 前者约 8 s；后者 0.8 s，verify 3 行 PASS |
| M3b H0 | `--plan`：153 表 / 6121 行；首次 11 项 JSON 契约冲突，补校验后仍 1 项（模板里程碑缺可选 `description`），修复 `99e5c37d` 后冲突 0，H0=`d63ee6a0…c51` | 秒级 |
| M3b install-fence / fence / prepare-final | 全部成功；H1=`1e5b481a…0d4`，155 表 / 6123 行（多 2 张 fence 表，各表 +3 guard 触发器） | 每步含加密备份 10–20 s |
| M3b apply | 目标库逐表行数与 final plan 一致，generation 仍为 0，两源 fenced | 31.8 s（备份另计约 1 分） |
| M3c 兼容视图 | HV=`745370…d10e2`，57 个视图（aims 46、assets 11）读检查通过，generation=0 时 Runtime 校验器与 ProductService 按预期拒绝 | 秒级 |
| M3e | 隔离 Runtime `0.3.292-s3r1.1`（本机与新机构建 SHA-256 一致）health 200，directory/workflow/codocs/console schema/status 200；负向 401/403 符合预期；启动前后 278 表精确行数完全一致 | 约 5 分 |

### 首轮暴露的问题及处理

- Assets 存量库缺三列（`asset_physical_details.config_detail`、`asset_documents.artifact_type/source_context`）：补 `20260929_backfill_schema_drift.sql` 及 verify/rollback，M6 同样执行（已登记 G-5）。
- H0 被 JSON 契约缺口阻断：11 列补可执行校验并注册（`docs/Enterprise-JSON-Contract-Gap-Inventory.md`），存量模板的可选键已对齐；正式 M6 前须对最终快照重跑 `--plan` 并重新盘点。
- `hzy_backup` 的授权为 ``hzy\_%``，不匹配 `s3r1_*`，演练期备份改由 `hzy_cutover`（源 SELECT/TRIGGER、目标含 SHOW VIEW）完成。
- M3e 授权 `m3e-grants.sql`（sha256 `ee83f719…0b63`）：`hzy_rt_console/workflow/codocs` 对各自 `s3r1_` 库的 schema 级授权，M3f 撤销。

### 未验证与阻断（不得当作已通过）

- **`hzy-enterprise-verify-views` 与 ProductService 正向路径依赖 M3d**：该工具校验激活后（generation≥1）的绑定，generation=0 时按设计拒绝，未绕过。
- **Vault 解密未在 S3 验证**：决定不把生产主密钥拷到新机，仅做指纹成对静态核对和不依赖解密的启动（`vaultKeyConfigured=false`）；解密类 smoke 留到 S4/M6 安装主密钥时验证。
- **生产 Platform 链路未验证**：S3 未启动任何 Platform，Runtime 无 control 配置；kid/公钥闭合、心跳、生产 OIDC 与 deployments 均未覆盖。演练用 Platform key `s3r1-isolated-rehearsal-20260929`（公钥 SHA-256 `c783b3a9…1934`）仅供 S3 自签测试，不得用于任何认可。
- **Console 签发与 Workflow 发起/审批的数据 smoke 未做**（依赖 Vault 解密与完整签发链）；S4 前另报。
- **M3d 排空认可与隔离激活阻断**：缺隔离控制面、sealed/provider 证据链和 hzy_cutover 激活授权；M3d 未获批准。
- M3f 未做，待办清理：撤销 `m3e-grants.sql` 的三条授权；删除 `/root/.hzy-s3/s3r1/`（含 S3-only 私钥、profile、runtime 配置）；**轮换 `hzy_cutover` 口令**；收紧 `hzy_migrator` 的 ``hzy\_%``；DROP `hzy_dump` 及其 cnf；演练库与加密备份的保留/销毁另批；W40 发布键的处理约定。
- 2026-09-29：用户决定正式迁移（及 S3 第二轮）改为**日本主机本地导出**：在日本机本地用只读导出账号逐库 `mysqldump` → 本地加密 → 传输至 100.64.72.59 → 校验哈希后恢复；日本机上仅临时存放**加密**导出文件，传输完成并核验后删除。具体传输路径、临时目录、密钥处理与删除步骤以执行计划为准，执行前由 Claude 审核。

## S3 第二轮执行记录（2026-09-29，批次 `s3r2-20260929T160949Z`，演练库 `s3r2_*`；日本机本地导出）

方式：用户决定正式迁移改为日本机本地导出。日本机（`oa.wiztek.cn`，2 核/3.6GB，可用内存约 0.9GB，swap 已用 5.7G/7.9G，根盘剩 6.0G）经临时 `hzy_dump@localhost` 本机 socket 导出，管道为 `mysqldump → 明文 sha256/字节数/Dump completed → zstd -3 -T1 → openssl aes-256-cbc（每库随机密钥，RSA-4096 OAEP-SHA256 包装，日本机不留可解密材料）→ 落盘`，`nice -n19 ionice -c3`，守卫阈值 swap +500MB 或 load>1.5 即中止（实际 swap +0、load 峰值 0.6）。传输由新机经 tailnet（DERP 中继）用 `restrict,from=新机tailnet IP,command="tar -C <批次目录> -cf - ."` 的一次性受限密钥拉取。结束后日本机已清理并回读：`/root/.hzy-s3-jp/` 已删、`authorized_keys` 回到 4 行且 sha256 与执行前相同、`hzy_dump@localhost` 已 DROP；原 `hzy_dump@'39.78.255.170'` 仍在，待全部迁移结束后 DROP。

### 端到端耗时（第二轮，UTC）

| 阶段 | 耗时 | 备注 |
| --- | --- | --- |
| 日本机本地导出（九库） | 19 s | console 13.0 s（明文 321.6MB→密文 23.9MB），finance 1.9 s，其余 0.3–1.3 s；密文合计 28.6MB |
| 传输（tailnet 拉取） | 397 s | 约 72KB/s；速度测试 20MB 用 400 s；**瓶颈**，经 DERP 中继，未建立直连 |
| 解密/解压/哈希核验 | 8 s | 密文 sha256、明文 sha256、字节数、Dump completed、退出码全部匹配 manifest |
| 恢复 `s3r2_*` | 122 s | 两路并行：console 122 s，其余八库约 40 s；去 DEFINER；流内 sha 复核 |
| M3a（Workflow/Codocs/Aims/Assets + 三列补丁） | 68 s | 全部 verify PASS |
| M3b H0 计划 | 3 s | 153 表 / 6121 行 / 冲突 0，H0=`f324c960…11dc` |
| install-fence + fence + prepare-final | 26 s（13+5+8，含备份） | H1=`a7ba5da5…766b`，155 表 / 6123 行 |
| migrate --apply | 36 s（含备份；apply 33.4 s） | 逐表 COUNT 与 plan 完全一致，generation 仍为 0 |
| M3c 兼容视图 plan + apply | 约 5 s | HV=`3fe85454…3fb39`，57 视图，generation=0 时 Runtime 校验器/ProductService 拒绝 |
| M3e 隔离 Runtime smoke | 约 5 s（不含配置准备） | health/schema-status 正负向通过，278 表启动前后逐表 COUNT 一致 |
| **合计（脚本执行时间，不含人工确认等待）** | **约 690 s ≈ 11.5 分钟** | 相比第一轮 M2（约 82 分钟导出 + 2 分钟恢复）显著缩短；生产环境估算需加：真实停写/排空认可、M3d 激活与 Vault/Platform 链路、冷存档确认与人工确认时间 |

### 校验结论与局限

- 九库流完整性（恢复时流内明文 sha256 = manifest = 日本机管道内哈希）全部为 True，这是精确证据。
- 对日本生产源库的实时 L1/L2/L3（`jp_verify_l123`）：people、webdev、altoc、finance L1/L2/L3 全部通过；console L1 通过、Vault 指纹成对（19 行 `3b1b0e37…`、36 行 NULL）；console L2 三张追加型日志源库更多（导出后新增），L3 抽样两张运维表（`connector_runtime_instances`、`directory_connectors`）与实时源不等，属源库导出后继续写入。workflow L3 不等是操作顺序失误：M3a 先于该比较开始，`flow_actionable_outbox` 已被 012–014 迁移改变，不是恢复异常。已迁移四库（workflow、codocs、aims、assets）不再做实时 L3，以流完整性为准。
- 第二轮同样未验证：Vault 解密（主密钥未拷贝）、生产 Platform 链路、Console 签发/Workflow smoke、`hzy-enterprise-verify-views` 与 ProductService 正向路径（依赖 M3d）；M3d 仍阻断。
- 本轮新增 M3f 清理项：撤销 `s3r2` 授权（`M3/grants/m3-grants-s3r2.sql`、`m3e-grants-s3r2.sql` 逐条撤销）；删除新机 `/root/.hzy-s3/s3r2/` 与 `/root/.hzy-s3/s3r2p/`（含 RSA 私钥、一次性 ed25519 私钥、profile、Runtime 配置）；`s3r2_*` 演练库与加密备份的保留/销毁另批。
