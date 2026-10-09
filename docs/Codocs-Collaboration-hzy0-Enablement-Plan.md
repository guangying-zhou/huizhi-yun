# Codocs 协作在 hzy0 的启用与验收计划（批次 V1）

状态：**计划，未执行**。本文不代表任何环境写入、开关变更或浏览器验收已经发生。编写日期 2026-09-29，基于分支 `feat/adr018-enterprise-integration` 在 H1c 之后的代码。

目标：在 hzy0（本机 C000001 测试环境）先启用并验收**个人共享文档协作**，再启用并验收**部门文档协作**，作为批次 V1 的端到端证据。设计与批准见 [部门协作设计](./Codocs-Host-Department-Collaboration-Design.md)（§10）、[写入协调合同](./Codocs-Document-Write-Coordination.md)（阶段 B）、[正文消费者盘点](./Codocs-Collaboration-Body-Consumers-Inventory.md)（§7.1.1）。

## 0. 审批标记与总原则

| 标记 | 含义 |
| --- | --- |
| **[只读]** | 只读检查，无需批准；不打印密钥、Token、正文。 |
| **[本机开关]** | hzy0 本机候选开关或进程切换（Runtime 二进制/配置开关、profile 键、PM2 进程），依既有约定无需逐项批准，但必须先备份、切换后验证、失败即回滚。 |
| **[需批准]** | 本机数据库写入、Console 授权/客户端写入、Platform 写入、任何云端或生产动作。每一项须在执行前向用户出示具体命令与备份点，单独获批。 |

- **不新增 capability、grant、schema 设计**：全流程沿用 `codocs:enterprise-host:execute`、`collab.runtime` 的 `codocs:collaboration-snapshots:{read,publish}` 两项精确 grant 和已有迁移文件。若核验发现 grant 漂移，只修复精确 grant，不放宽 scope、不吞 403、不退回静态 Token。
- **顺序不可颠倒**：先个人协作，再部门协作；部门是第三个独立开关。任一步验证失败，立即回到上一步的开关状态，保留现场证据，不用旧 HMAC 通道或静态 Token 绕过。
- **不在云端、Platform 开发环境或生产上做任何事**；本计划止于 hzy0。
- 命令中的 `$PROFILE`=`$HOME/.config/huizhi-yun/hzy0/profile.json`（私有，不入库）；`$RT`=`~/Library/Application Support/HuizhiYun/test-runtime/`（含 `config.json`、`database-backup/`、`deployments/`，不入库、不贴内容）。

### 0.1 已知的记录状态（来自 `deploy/test-env/LOCAL_RUNTIME.md` 与写入协调合同，需在步骤 1 现场复核）

- 2026-09-24：本机 `hzy_codocs` 已按批准备份后安装快照两表与 `document_versions.object_key`（`20260920`），随后安装四张协作表（`20260924`）；`apps.codocs.snapshotV2Enabled=true` 已启用。
- 2026-09-24：Console 已登记 `collab.runtime` 与两项精确 grant，凭据仅哈希存库、明文在私有 0600 文件，两项令牌签发探测通过；`apps.codocs.collaborationV2Enabled` 与 profile `features.codocsCollaborationV2` **保持关闭**。
- 写入协调合同提示：Runtime 配置 overlay 会整体替换 `deploymentBindings`，仅写在 `config.json` 的 `collab` 绑定会丢失，**须按 Platform 部署绑定重新核验生效值**。
- `20260929_department_collaboration.sql` **从未在本机安装**。
- 当前运行的 Runtime 二进制在部门协作合入前构建，**不含**部门协作、H1c 恢复计划与版本历史路由；且需含 Collab 存储改线（`collaboration-snapshots:upload|download`）。

## 1. 只读预检（全部 [只读]，无需批准）

| # | 检查 | 命令/做法 | 通过标准 |
| --- | --- | --- | --- |
| 1.1 | 代码基线 | 在 hzy0 实际运行的工作副本执行 `git status`、`git log -1`；确认在含 H1c 的提交上且无未提交改动 | 干净；记录提交 SHA |
| 1.2 | 运行器与 profile | `node deploy/test-env/local-enterprise.mjs plan --profile "$PROFILE"`，随后 `doctor`、`status` | 无未预期的阻塞；只读 |
| 1.3 | profile 当前开关 | 读 `$PROFILE` 的 `features`、`listeners`（仅键与布尔，不贴其它内容） | 记录现值：预期协作均为 `false` |
| 1.4 | Runtime 健康与版本 | `curl -fsS http://127.0.0.1:18084/runtime/health` | 200；记录版本号 |
| 1.5 | Runtime 配置键 | 读 `$RT/config.json` 的 `apps.codocs.{snapshotV2Enabled,collaborationV2Enabled,departmentCollaborationV2Enabled}` 与 `deploymentBindings` 键名 | 记录现值；不打印任何密码/密钥 |
| 1.6 | Codocs 库结构（只读连接） | 对 `hzy_codocs` 执行只读 `SHOW TABLES LIKE 'document_snapshot%'`、`LIKE 'document_collaboration%'`；`information_schema.columns` 查 `document_versions.object_key`、`document_collaboration_sessions.{policy,dept_code}`、`document_collaboration_participants.{status,checked_at}`；`SHOW INDEX FROM document_snapshot_heads` | 判定 `20260920`/`20260924`/`20260929` 各自是否已安装（预期前两者已装，`20260929` 三处缺失） |
| 1.7 | Console 注册状态 | `node deploy/test-env/collab-registration.mjs --verify`（SELECT only） | 显示 `collab.runtime` active 与两项精确 grant，且无意外 active grant；否则进入步骤 3 |
| 1.8 | 凭据文件属性 | `stat -f '%Lp %Su' "$(dirname "$PROFILE")/collab-client-secret.json"` | 模式 600、属主本人；只看属性，不读内容 |
| 1.9 | 路由探测基线 | 对 Runtime 匿名 POST：`/v1/enterprise/codocs/personal-documents:collaboration-open`、`/v1/codocs/collaboration-snapshots:upload`、`/v1/enterprise/codocs/department-documents:collaboration-open`、`…:versions` | 记录 401（已登记）或 404（未登记）；预期当前个人/部门相关多为 404 |
| 1.10 | Gateway `/codocs/ws` | `curl -si http://127.0.0.1:<gatewayIngress>/codocs/ws`（走 hzy0 Origin 检查的公开入口同理） | 协作关闭时 404 |

## 2. 阶段 A：数据库（全部 [需批准]，仅在 1.6 判定缺失时执行）

要点：三份迁移都含 DDL，**不能靠事务回滚**；每份先备份、后安装、再核验，失败时所有协作开关保持关闭。使用与 2026-09-24 安装相同的受批准特权连接，**不要用 Runtime 的低权限用户**。执行前须再核对 MySQL 实例（`SELECT @@server_uuid, @@hostname, DATABASE()`）与目标库名一致。

对每一份缺失的迁移，按顺序（`20260920` → `20260924` → `20260929`）：

1. **[需批准] 备份**：`mysqldump --single-transaction --routines --triggers hzy_codocs > "$RT/database-backup/hzy_codocs-before-<迁移名>-<UTC 时间>.sql"`；记录 SHA-256 与文件大小，并确认文件可被 `head` 读出、含 `document_versions` 建表语句。
2. **[需批准] 安装**：`mysql <特权连接> hzy_codocs < codocs/docs/migrations/<迁移文件>.sql`。注意 `ALTER` 不幂等，重跑会因重复列/索引报错，因此必须先按 1.6 确认确实缺失，且**不要盲目重放**。
3. **[只读] 核验**（对照 `codocs/docs/codocs_schema.sql` 与迁移内容）：
   - `20260920`：`document_snapshot_heads`、`document_snapshot_candidates` 存在，`document_versions.object_key` 为 `VARCHAR(512) NULL`。
   - `20260924`：`document_collaboration_{sessions,tickets,participants,publications}` 四张表存在。
   - `20260929`：`document_collaboration_sessions` 新增 `policy`(ENUM，默认 `private`)、`dept_code` 与 CHECK `collaboration_session_policy`、索引 `collaboration_session_document_only`；`document_collaboration_participants` 新增 `status`、`checked_at` 与索引 `collaboration_participant_status`；`document_snapshot_heads` 新增索引 `snapshot_head_document`。既有行 `policy='private'`、`dept_code IS NULL`。
   - 个人协作仍可用：隔离 MySQL 套件 `node data-runtime/scripts/test-codocs-department-collaboration-mysql.mjs` 已证明“无部门迁移时个人路径不变”，本机仅做上述结构核验。
4. **回滚**：
   - 首选：所有协作开关关闭后，用上述备份**整库还原**（需批准；还原期间停 Runtime 的 Codocs 写入）。
   - `20260929` 的精确反向（仅当无 `policy='department'` 会话行且部门开关已关，需批准）：
     ```sql
     ALTER TABLE document_collaboration_sessions DROP CONSTRAINT collaboration_session_policy, DROP INDEX collaboration_session_document_only, DROP COLUMN dept_code, DROP COLUMN policy;
     ALTER TABLE document_collaboration_participants DROP INDEX collaboration_participant_status, DROP COLUMN checked_at, DROP COLUMN status;
     ALTER TABLE document_snapshot_heads DROP INDEX snapshot_head_document;
     ```
   - `20260920`/`20260924` 仅新增表和一列：回滚为在确认无 v2 文档/会话后 `DROP` 新表与 `object_key` 列，或整库还原；一旦已有 generation>0 的文档，**不要**回退表结构，改为关闭开关并保持 Host 读取精确快照。

## 3. 阶段 B：`collab.runtime` 注册与授权（先 [只读]，缺失才 [需批准]）

1. **[只读]** 复核 1.7 结果。若已 active 且 grant 精确，跳到 3.3。
2. **[需批准]** 仅在缺失/漂移时：`node deploy/test-env/collab-registration.mjs --plan` 出示计划，获批后 `--apply`（显式事务、不签发凭据、不复活撤销记录），再 `--verify`。凭据不由脚本创建；如需重发，按受控流程只写入 0600 的 `collab-client-secret.json`。
3. **[需批准]** 令牌签发探测（会签发短期令牌）：用真实 `collab.runtime` 客户端，对 `codocs:collaboration-snapshots:read` 与 `…:publish` **各一次**，audience 为 `data-runtime`，解码核对 `token_use=service`、`source_app=collab`、租户、`deployment=C000001-test-collab`、单项 scope。按根 CLAUDE.md，仅 SQL 行存在或宽 scope 可签发不算完成；若 Runtime 实际验签需要 `tenant-runtime` 第二 audience，先出示证据再申请补 grant。
4. **[只读]** 部署绑定：确认 Platform 下发的 `deploymentBindings` 含 `collab=C000001-test-collab`。若缺失，需要 Platform 部署绑定登记，属 **[需批准]**（Platform 写入）；不得靠 `config.json` 手写绑定长期代替（overlay 会丢失）。

## 4. 阶段 C：Runtime 二进制与开关（[本机开关]）

1. 从含 H1c 的**已提交**源码构建 Runtime（`go test -race ./...` 通过后，darwin/arm64），记录版本与 SHA-256。
2. 备份：复制现二进制到 `$RT/deployments/codocs-collab-<UTC>/hzy-data-runtime.before`；复制 `config.json` 为 `config.before-collab-<UTC>.json`。
3. 替换二进制；用完整 LaunchAgent 环境做启动探测（到达监听），再 `launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-runtime`。
4. 验证：本机与公网 health 200/新版本；匿名与伪造 Bearer 对新路由返回 401（不是 500/404）。此时所有协作开关仍为原值（个人 `collaborationV2Enabled=false`，部门 `false`）。
5. **回滚**：还原 `.before` 二进制与配置并 kickstart。

## 5. 阶段 D：个人共享文档协作（[本机开关]，前置为 2、3 已完成）

1. 备份 `config.json`，设置 `apps.codocs.collaborationV2Enabled=true`（`snapshotV2Enabled` 保持 true），确认 `deploymentBindings.collab` 生效；kickstart Runtime。
2. 探测：匿名 POST `personal-documents:collaboration-open` 与 `/v1/codocs/collaboration-snapshots:{upload,download,renew,close}` 均 401；`/v1/enterprise/codocs/department-documents:*` 仍 404。
3. 私有 profile：添加 `listeners.collab={"host":"127.0.0.1","port":23131}`，`features.codocsSnapshotV2=true`、`features.codocsCollaborationV2=true`（`config.mjs` 已校验：需本地 Console 门面、协作要求快照）；`plan`/`doctor` 预检；`up`（启动 `hzy0-collab`），随后**仅**重启 `hzy0-gateway` 与 `hzy0-enterprise`（`restart` 命令保留既有 PM2 凭据环境）。
4. 探测序列：
   - Gateway：无 `Upgrade` 的 `GET /codocs/ws` → 426；错误 Origin 的升级 → 拒绝。
   - `probe-exposure.mjs`：Collab 仅回环 `127.0.0.1:23131`，公网不可达。
   - Collab 令牌桥：`/__hzy0/collab-token` 仅受理精确客户端/audience/两项 scope。
   - Host：登录后打开一份已共享的私人 v2 文档，`POST /codocs/api/documents/:uuid/collaboration` 返回一次性票据（响应字段仅 `token/sessionId/expiresAt/generation`）。
5. **个人验收（阶段 B 第 5 步；设计 E-1…E-4、E-8、E-11）**，两名真实用户（见 §7）：同时编辑与配对发布；断线换票重连；撤权（取消分享）后断开且迟到发布被拒；活动会话期间 HTTP 保存 409、关闭后恢复；历史版本与镜像；日志无票据/令牌/正文。
6. **回滚**：`features.codocsCollaborationV2=false`、`apps.codocs.collaborationV2Enabled=false`，停 `hzy0-collab`，重启 gateway/enterprise/Runtime；已发布的 v2 文档保持 v2，Host 读取仍走精确快照。

**只有个人验收全部通过才进入阶段 E。**

## 6. 阶段 E：部门文档协作（前置：阶段 A 中 `20260929` 已安装并核验）

1. **[本机开关]** 备份 `config.json`，设置 `apps.codocs.departmentCollaborationV2Enabled=true`，kickstart Runtime。
2. **[只读]** 探测：匿名 POST `/v1/enterprise/codocs/department-documents:{collaboration-open,snapshot-read,snapshot-prepare,snapshot-publish,versions,version-view}` 均 401；Runtime 启动日志无 schema/列缺失告警；隔离于此前个人会话（`policy='private'`）仍可用。
3. **[本机开关]** 私有 profile 设置 `features.codocsDepartmentCollaborationV2=true`（运行器代码已支持：`config.mjs` 校验需 `codocsCollaborationV2`，`run-process.mjs` 向 Host 进程追加 `HZY_ENTERPRISE_CODOCS_DEPARTMENT_COLLABORATION_V2=true`）；`plan`/`doctor`；仅重启 `hzy0-enterprise`（dev 模式下 Nuxt 启动时派生 public 开关 `codocsDepartmentCollaborationV2`，无需 `NUXT_PUBLIC_*` 覆盖；`build`/Node 模式当前 fail-closed）。
4. **运行器需要的改动清单**（均已在本批次交付，默认关闭）：profile 键 `codocsDepartmentCollaborationV2`（`config.mjs`、`profile.example.json`、`config.test.mjs`）；Host 进程环境（`run-process.mjs`）；README 说明。**无需改动**：`gateway-transport.mjs`（`/codocs/ws` 已按协作开关放行，部门共用）、`pm2.config.cjs`、Collab 进程环境（Collab 对部门会话把续租间隔钳到 30 秒，`COLLAB_V2_RENEW_INTERVAL_MS` 不必设置）、Console 令牌桥（部门与个人共用 `collab.runtime` 两项 scope）、egress 生成物（三处部门操作与版本历史均被排除）。
5. 探测：登录后对一份部门文档，`POST …/departments/documents/:uuid/collaboration?dept_code=` 的鉴权链：无 `departments:edit` → 403，Console 依赖故障 → 503，开关关 → 404。
6. **部门验收**：见 §7 与设计 §6.3 的 E-1…E-12，另加 H1c 项（下节）。
7. **回滚**：profile 键 `false` 并重启 enterprise；Runtime `departmentCollaborationV2Enabled=false` 并 kickstart（部门会话在 Collab 下一次调用时终止）；已转换为 v2 的部门文档保持 v2，Host 读取精确快照，旧独立入口写入继续被拒；需要回到 v1 时使用尚待编写的镜像重建脚本（盘点 Q8），不在本计划内。

## 7. 双人浏览器验收脚本

### 7.1 账号与前置（**需要用户提供**）

- 账号 A：`zhouguangying`（已有，Directory 中含经理关系，需先核实其在测试部门是经理还是成员）。
- 账号 B：**第二个真实的同部门成员账号——须由用户提供，并在第二个浏览器配置（或无痕窗口）中完成 hzy0 登录**；一个浏览器只有一个 Host 会话，两个账号必须在两个独立配置里同时登录。
- 账号 C（负向，可选但强烈建议）：部门 leader/parent 或非成员账号，用于 E-7；已知 `test` 账号对 Aims 无权，是否适合作为 Codocs 负向账号需先核对，管理员账号验不出越权。
- 数据前置：一个 A 为 owner 的部门 Markdown 文档（`status=1`，非周报、非只读）；一个 B 通过写分享或部门规则可写的文档；一个 B 只读的文档；一个 v1 文档专用于“首次点击才转换”。B 需要 Host 人员权限 `departments:edit`（协作）与 `departments:view`（版本历史）。
- 每次验收记录：提交 SHA、Runtime 版本、profile 开关快照、双方浏览器截图（1440px 与 390px 各一张状态条）。

### 7.2 个人共享文档（阶段 D 第 5 步）

| 步 | 操作 | 期望 |
| --- | --- | --- |
| P1 | A、B 同时打开同一已共享私人 v2 文档并输入 | 互见光标与更改；发布后 generation 递增 |
| P2 | B 断网 30 秒后恢复 | 自动换新票据重连，未发布内容不丢，票据不复用 |
| P3 | A 取消对 B 的分享 | ≤1 个续租周期内 B 被断开；A 不受影响 |
| P4 | 会话期间用 HTTP 保存（旧路径） | 409；关闭会话后恢复 |
| P5 | 历史版本 | 协作发布行进入历史，查看按精确版本核对摘要 |
| P6 | 日志抽查 | Host/Runtime/Collab/Gateway 日志无票据、令牌、正文 |

### 7.3 部门文档（阶段 E 第 6 步）

| 步 | 操作 | 期望 |
| --- | --- | --- |
| D1 | A 打开 v1 部门文档，仅阅读 | 存储不变、不转换；显示“可协作编辑”提示 |
| D2 | A 点击“协作编辑” | 转换成功（generation=1），进入会话；旧独立 Codocs 对该文档写入 409 |
| D3 | B 打开同一文档并编辑 | 互见光标与更改；发布后 generation 递增；参与者含两人 |
| D4 | B 断线重连 | 换新票据重连，无重复转换 |
| D5 | 管理员把 B 移出部门（Directory） | ≤30 秒（一个续租周期）B 被断开且输入失效；A 不受影响；B 页面有撤权提示 |
| D6 | 经理变更/owner 离部门/撤销写分享 | 同上，分享撤销即时 |
| D7 | 经理设只读，再回收 | 房间关闭；迟到发布被拒；恢复后可重开 |
| D8 | 回收站恢复该 v2 文档（H1c A10） | 恢复成功，不再报“正文与快照均不存在”；发布头未变；可重开会话 |
| D9 | 版本历史（H1c A11） | 只读成员 C/B 可列出并查看精确版本；无删除/回滚/差异入口；权限不足者 403 |
| D10 | 开放部门读取（H1c A6） | 已开放的转换后部门文档，非本部门成员可预览最新发布版本 |
| D11 | 下载/发文/复制 | 读到最新发布版本（H1b/A1–A5、A14） |
| D12 | leader/parent/非成员点击编辑 | 明确 403；只读成员读到最新版且无编辑入口 |
| D13 | 桌面 1440px 与移动 390px | 状态条与失权提示无溢出/重叠，控制台无新增错误 |
| D14 | 日志抽查 | 同 P6 |

失败处理：记录现象与证据后，按各阶段“回滚”关闭对应开关；不修改数据库以掩盖问题。

## 8. 步骤总览

| 阶段 | 步骤 | 标记 |
| --- | --- | --- |
| 1 | 只读预检 1.1–1.10 | [只读] |
| 2 | 三份迁移的备份、安装（仅缺失者）、回滚 | [需批准] |
| 2 | 迁移安装后的结构核验 | [只读] |
| 3 | `collab-registration.mjs --verify`、凭据属性、绑定核对 | [只读] |
| 3 | `--apply`（仅缺失/漂移）、令牌签发探测、Platform 部署绑定登记（仅缺失） | [需批准] |
| 4 | Runtime 二进制构建、备份、替换、重启、探测 | [本机开关] |
| 5 | Runtime `collaborationV2Enabled`、profile 个人协作键、`hzy0-collab` 进程、gateway/enterprise 重启、探测 | [本机开关] |
| 5 | 个人双人验收 | 需用户提供第二账号 |
| 6 | Runtime `departmentCollaborationV2Enabled`、profile 部门键、enterprise 重启、探测 | [本机开关] |
| 6 | 部门双人验收 | 需用户提供第二账号 |

## 9. 证据边界

- 已读：本仓库代码与文档（见各引用）；`LOCAL_RUNTIME.md` 的 2026-09-24 记录；Runtime 配置结构与开关（`data-runtime/internal/config/config.go`）；hzy0 运行器（`config.mjs`、`run-process.mjs`、`gateway-transport.mjs`）。
- 未做：任何数据库、Console、Platform、Runtime、进程或网络动作；未核实 §0.1 所列现场状态是否仍成立；未运行浏览器验收。
- 不在本计划内：云端 Collab Durable Object（仍只接受旧 HMAC）、自托管生产启用（见 `deploy/self-hosted/README.md`，模板默认全关）、快照桶“版本 ID 与写一次条件”生产实测（hzy0 的测试桶开启版本控制，不能防覆盖，仅测试可接受，见写入协调合同“剩余风险”）。


## hzy0 本机 Collab 显式绑定（2026-10-05）

hzy0 的 Platform 持久化部署 overlay 当前没有 Collab；静态 `config.json` 中的绑定不会自动补回，签名因 `oidc_signing_service_deployment_invalid` 失败关闭。经用户授权处理本机启用，Runtime 提供显式 `HZY_LOCAL_COLLAB_DEPLOYMENT=C000001-test-collab`，仅用于本机试验：tenant=C000001、Runtime=c000001-test-tenant-runtime、监听127.0.0.1:18084、Codocs enabled/snapshotV2Enabled/collaborationV2Enabled均为true，且静态配置已有同一精确绑定。Platform overlay中若已有不同Collab绑定则报错，不覆盖；其他绑定保持不变。生产、云端、其它租户或关闭协作时均拒绝此开关。未设置时保持原overlay权威行为，不修改任何grant或签名校验。正式部署仍由Platform登记。

启用前加密备份Runtime plist；仅在hzy0 LaunchAgent环境加入上述精确开关，回滚时恢复原plist。Console external不内嵌监听，独立hzy0-collab绑定profile.listeners.collab=127.0.0.1:23131。

令牌探测使用`node deploy/test-env/local-enterprise/probe-collab-token.mjs <profile> 23120 <0700证据目录>`，两项scope逐项断言先以0600落盘，不记录token/密钥/响应正文。解码只用于诊断，不能代替Runtime验签。失败后最多10分钟只读采集Console审计错误码或预定义错误原因布尔、精确grant verify、Collab日志机器码、监听表与实际绑定，再恢复已备份配置/进程并撤销无部门会话时的获批DDL。同步验收仅使用CLAUDE-FIXTURE合成文档，不使用WizBiz迁移文档。
