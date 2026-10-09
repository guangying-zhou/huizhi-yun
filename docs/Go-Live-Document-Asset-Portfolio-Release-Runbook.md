# 文档资产与项目集：生产合并发布执行单

状态：**草稿，供协调者审阅和用户确定窗口；未连接生产、未执行任何环境操作。** fa 已于 2026-10-04 校对 §3、§6、§7、§9、§10、§11、§12 中与文档资产/项目集相关的内容（对照主线 `523341ab` 的代码与 SQL），补充处标有“fa 校对补充”；G1–G3 与生产拓扑、备份、制品、Altoc/People 验收行不在校对范围。

用户 2026-10-04 已批准 v2.35、项目集两表、Codocs 三份迁移和两类对账随下一次生产合并发布执行。该批准不表示现在执行，也不覆盖本文发现的安装器生产适配、额外授权、GitLab 账号调整或其他模块启用。窗口、最终 SHA/版本、连带停机和回滚选择须在执行前确认。

## 1. 生产拓扑与制品基线

沿用 [项目页面发布执行单](Go-Live-Project-Pages-Release-Runbook.md) 与 [S4 切换手册](Go-Live-Self-Hosted-S4-Cutover-Runbook.md)，不采用 hzy0 的 PM2、LaunchAgent、231xx 端口或测试部署编码。

| 对象 | 已有生产记录；窗口前只读复核 |
| --- | --- |
| 主机 | Anolis OS 23.5，x86_64，内网 `100.64.72.59`；MySQL 8.0.46（以现场版本为准） |
| 公网入口 | `https://aidcp.wiztek.cn` → gitlab 主机 nginx → Tailscale → 内网 Gateway；不是本轮新建 Tunnel |
| Gateway | 实际单元 `hzy-tenant-gateway.service`；配置 `/etc/hzy-gateway/gateway.json`；入口/健康端口 8780/8781 |
| Runtime | `hzy-data-runtime.service`；`/opt/hzy-data-runtime/hzy-data-runtime`；`/etc/hzy-data-runtime/config.json`、`.env`、信任/绑定 overlay；回环 31080；规范端点 `https://aidcp-runtime.wiztek.cn` |
| 应用 | `/home/hzy/apps/<app>/current`；`/etc/hzy/<app>.env`；Console 31001、Enterprise 31002、Workflow 31003、Aims 31004、Codocs 31005；Collab 31007 仅原已启用时恢复 |
| 数据 | 统一库 `hzy_enterprise`，独立 `hzy_console`、`hzy_codocs`；Workflow 库/绑定按现用配置盘点，不假设已迁入统一库；源副本/冷存档不是写入目标 |
| 身份 | tenant `C000001`、environment `prod`、Runtime `c000001-prod-tenant-runtime`、Enterprise `C000001-prod-enterprise`；其他部署逐项采用登记值 |
| Platform | 既有共享 `https://hzy.wiztek.cn`；本轮不部署 Platform、不复制 test 策略到 prod |
| 历史发布 | 协调者已通报应用 rc25 上线；旧执行单目标 Runtime 0.3.225。它们仅为历史参考，实际版本、current 链接、desiredVersion 与策略 revision/hash 须重新回读 |
| 候选 | 最低覆盖 `3e98a6bc2c086ac0010d5b801933248edf8a292c`，包含 `e63687c7` 正文只读、`6df3d747` 归属保护、`ac0490df` 子集及 DOC-05/06/07。最终合并 SHA、下一未占用 Runtime 精确版本及应用 tag **待协调者冻结**；不得直接把本机 `.17` 版本装入生产 |

Runtime 和 Console 配置只核对键、绑定、文件指纹/权限，不能把配置、令牌或私钥打印到终端。以现用 `systemctl cat` 为准；历史模板不是现场配置的替代品。

## 2. 当前源码存在的停止关口

### G1：生产安装 profile 待审及现场核对

生产候选代码新增 `--profile`：0600、所有者私有、绝对路径，绑定 prod tenant/owner/Runtime、数据库、instanceId、schemaVersion、非零 generation；原字节 SHA 纳入 reviewHash。Linux 只读核对 `hzy-data-runtime.service` 为 loaded/inactive/dead/MainPID=0 且 127.0.0.1:31080 明确拒绝连接；所有模式保留迁移锁、只建、baseline、空表回滚等护栏。省略 profile 保持原 test 路径。

**代码审过、现场身份和停止事实核对通过前仍禁止生产运行（含 plan）。** 参见 `data-runtime/cmd/hzy-enterprise-add-apf/README.md` 的 profile 字段；不得照抄示例代际或伪造 test 配置。

### G2：安全入口及现用 drop-in 核对

候选 `release.mjs:localHealth` 仅 GET `/aims/`，不再请求 drain。该只读入口返回 2xx/3xx/401/403 可证明服务已响应，404/5xx 失败；不证明业务授权已就绪，业务验收另做。仓库记录的 `b17-no-direct-health.conf` 是禁用直连后置检查，并未提供专用健康 API。生产现用 ExecStartPost/drop-in 的实际内容仍待只读核对，不能推测其与候选一致。

### G3：对账源与 Runtime 一致性校验

Runtime 与对账工具均经 `config.Load()`、`aims.New(cfg.Apps.Aims)` 构造连接，Registry 不会静默改写该连接。候选工具要求 `--expect-aims-db` 和 `--expect-codocs-db`，先核对配置和实际 `SELECT DATABASE()`；统一 Aims 还须匹配 Enterprise DB host/port/name，并验证 Registry 身份/代际及对账所用兼容表/视图。拒绝未知/disabled 读取模式与未支持的 Codocs unified 路径。启动只在 stderr 输出库名/模式，不含凭据。

现场仍须核对 tenant/prod overlay、`hzy_enterprise` 与独立 `hzy_codocs`；不符合时停止，不静默换库。

## 3. 批准点、顺序与停写预算

| 点 | 范围与已有授权 | 前置与停止条件 |
| --- | --- | --- |
| W1 | 冻结最终合并 SHA/版本/tag、构建、传输、加密备份；需确定窗口和制品写入授权 | G1–G3 全部解除，版本未占用、生产影响隔离、备份可恢复 |
| W2 | 维护入口、暂停投递/业务写、停止应用与 Runtime；确认连带停机 | 记录全部依赖和原运行/定时任务状态；允许窗口已确认 |
| W3 | `aims-portfolio-members` plan/review/apply/verify 与累计配置切换；已批准随合并发布 | 使用已审生产适配工具；人工确认 reviewHash，不能自动读 hash 即视为审查 |
| W4 | Codocs 三迁移；已批准随合并发布 | 完整备份和隔离整文件演练，逐份 verify；部分安装或对象冲突停止 |
| W5 | Runtime/六应用发布、启动；需确认版本、连带停机与回退策略 | 两策略列先于新代码，所有包同 SHA、配置保留、视图验证成功 |
| W6 | Console v2.35；已批准随合并发布 | 新 Runtime 已删除 commit/resolve-actions，盘点范围符合；非目标字段/行保持 |
| W7 | catalog 与 portfolio-owner 对账；已批准随合并发布 | 迁移+新代码已就绪；两种 dry-run 分别审查，无未知源或所有权变化 |
| W8 | 真实签发/业务样本验收、清理及可选回滚 | 签发写审计、挂入/成员/策略修改是业务写入，需确认样本/动作；不借服务身份替用户 |

依赖：**备份 → 停写 → 项目集子集 → 20261005 → 20261006 → 20261007（策略两列）→ 新代码部署/核验 → v2.35 → catalog 对账 → portfolio-owner 对账 → 恢复业务/浏览器验收**。目录迁移可早于或晚于代码；本文选择先迁移。v2.35 必须晚于新 Runtime；portfolio-owner 必须晚于策略列和新代码。执行 W3 后不重建旧 plan；后续 Codocs/Console 写入前，先完成 W3 baseline verify。

依赖的精确含义（fa 校对补充，供窗口内判断“停在哪里”用，不改变上面的首选顺序）：

- 新代码对这批数据对象全部是“缺失即失败关闭”，不是“缺失即不可启动”：项目集两表未安装或未映射 → 项目集成员/文档入口固定 `503 aims_portfolio_members_unavailable`；策略两列未安装 → 项目集文档列表与正文固定 `503 codocs_portfolio_policy_unavailable`；目录表未安装 → 目录登记静默跳过。三种情况下项目文档、既有 Aims/Codocs 功能与项目文档页均不受影响（项目文档页只省略“所属项目集文档”区）。20261005 的新列目前没有任何读取方。
- 因此真正的硬顺序只有三条：① 20261007 必须早于 portfolio-owner 对账，也必须早于项目集文档对用户可用；② v2.35 必须晚于新 Runtime 上线（旧 Runtime 仍登记 commit/resolve-actions，先收窄 grant 会让旧 Codocs 的“提交 GitLab”按钮变成 403，而不是消失）；③ 两类对账必须在新代码与对应迁移都就绪之后。
- W3 或 W4 中途失败时，可以选择“保留已完成的增量对象、照常上线代码、相关入口保持 503”，不必因此回滚整批；是否这样做由协调者在窗口内决定，并在验收清单里把对应入口记为“未启用”，不得记为通过。

建议预留完整维护窗口 **60–120 分钟**，是待现场演练修订的规划预算，不是生产实测承诺：停写备份/DDL/安装 20–60 分钟，启动与预热 5–15 分钟，对账/验收/回滚余量 30–45 分钟。构建和大包传输安排窗口外（历史传输可能需 1–2 小时）。按生产表量、每条 ALTER 的算法/耗时和链路实测修订，不把 hzy0 耗时当生产 SLA。

Runtime 停止会通过 Requires 连带停止 Gateway、Console、Workflow、Aims、Codocs、Enterprise，以及实际依赖它的 Collab。**只启动 Runtime 不会恢复这些应用**。MySQL、共享 Platform、nginx/Tailscale 不在停机清单；入口维护和 scheduler 暂停/恢复若需改它们的配置，另列精确动作批准。

## 4. 只读前检、备份与制品准备（W1）

以下全部是**未来获批窗口中的命令模板，本任务未执行**。未冻结的参数不得自行填猜测值。

```sh
set -euo pipefail
umask 077
# 以下值由协调者审定；BACKUP 必须是新目录，不覆盖旧批次。
RELEASE_COMMIT='<最终完整 SHA>'
RT_VERSION='<未占用精确 Runtime 版本>'
APP_VERSION='<未占用应用 tag 版本>'
REPO='/home/hzy/build/doc-asset-source'
ARTIFACTS='/home/hzy/build/doc-asset-artifacts'
BACKUP='/home/hzy-backup/doc-asset-<批准窗口 UTC 标识>'
CONFIG='/etc/hzy-data-runtime/config.json'
TOOLS='/home/hzy/tools/doc-asset-<批准窗口 UTC 标识>'
# protected MySQL defaults：独立备份/迁移账号，0600；不把密码写 argv。
CONSOLE_CNF='<已批准 Console mysql defaults 绝对路径>'
CODOCS_CNF='<已批准 Codocs mysql defaults 绝对路径>'
UNIFIED_CNF='<已批准统一库 mysql defaults 绝对路径>'
BACKUP_KEY_FILE='<既有受保护备份加密材料路径>'
```

前检记录（输出只存私有证据，不打印包含环境的 unit 内容）：

```sh
systemctl list-dependencies --reverse hzy-data-runtime.service
systemctl is-active hzy-data-runtime hzy-console hzy-enterprise hzy-workflow hzy-aims hzy-codocs hzy-tenant-gateway
readlink -f /home/hzy/apps/{console,enterprise,workflow,aims,codocs,gateway}/current
ss -ltn
mysql --defaults-extra-file="$CODOCS_CNF" --batch --skip-column-names \
 --execute='SELECT VERSION(),@@server_uuid,@@lower_case_table_names,@@character_set_database,@@collation_database' hzy_codocs
```

核对生产 config/domain modes、generation/instanceId、Registry 行/原 mapping_hash、compatibility view 数与定义、账号授权、表计数/各 doc_type 计数、待投递水位、Runtime desired/current/pinned、timer/path 状态、prod 策略 revision/hash。窗口前和停写后各读一次。读取 `/runtime/health` 只保存允许字段，不能输出授权头。Config/env/overlay 的内容只进加密归档。

W1 批准后创建 0700 备份目录。备份 Console 全 grant 表、统一库及实际 Workflow/Aims 库、独立 Codocs；统一库中已包含 Aims 时不把源副本当活动库。示例：

```sh
install -d -m 0700 "$BACKUP"
backup_db() {
  local cnf="$1" db="$2" tables="$3" out="$4"
  # tables 为空时全库；本执行单只传固定 service_client_grants 或空串。
  # FIFO只传输字节，不落明文；后台hash进程显式wait，避免进程替换落盘竞态。
  local fifo="$out.hash.fifo" hash_pid
  mkfifo -m 0600 "$fifo"
  sha256sum < "$fifo" > "$out.plain.sha256" &
  hash_pid=$!
  if ! mysqldump --defaults-extra-file="$cnf" --single-transaction --routines --triggers \
    --events --hex-blob --set-gtid-purged=OFF "$db" ${tables:+$tables} \
    | gzip -c | tee "$fifo" \
    | openssl enc -aes-256-cbc -salt -pbkdf2 -pass "file:$BACKUP_KEY_FILE" -out "$out.enc"; then
    kill "$hash_pid" 2>/dev/null || true
    wait "$hash_pid" 2>/dev/null || true
    rm -f "$fifo"
    return 1
  fi
  wait "$hash_pid"
  rm -f "$fifo"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_KEY_FILE" -in "$out.enc" \
    | sha256sum > "$out.check.sha256"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_KEY_FILE" -in "$out.enc" | gzip -t
  test "$(cut -d' ' -f1 "$out.plain.sha256")" = "$(cut -d' ' -f1 "$out.check.sha256")"
  chmod 0600 "$out".*
}
backup_db "$CONSOLE_CNF" hzy_console service_client_grants "$BACKUP/grants"
backup_db "$UNIFIED_CNF" hzy_enterprise '' "$BACKUP/enterprise"
backup_db "$CODOCS_CNF" hzy_codocs '' "$BACKUP/codocs"
# 实际独立 Workflow 库使用其受保护 defaults 再调用 backup_db。
```

停止条件：管道任一非零、gzip/解密/hash 不符、账号无备份对象权限、未备份实际活动库，均停止。备份前核实 events 是需要恢复的定义，不在新机自动 enable；完整备份要在独立隔离库做一次恢复与结构/计数核验。停止写入后再做最终 Codocs/统一库备份。不得将明文备份留在 /tmp。

另把现用 Runtime 二进制、config/.env/overlay、unit/drop-in、Gateway/env 和原 current 链接清单打包到加密归档；原二进制命名为 hzy-data-runtime.before，current清单命名为 current-<app>.path。回滚前从该归档只解密需要的文件到本批0700恢复目录，配置文件0600，禁止全量打印；保留旧 release 目录。记录文件权限/属主/hash，备份密钥留原保护位置。无密钥生成/主密钥迁移。

从干净冻结 SHA 构建 Runtime 与同 SHA 的三个工具 `hzy-enterprise-add-apf`、`hzy-enterprise-verify-views`、`hzy-document-catalog-reconcile`（Linux amd64）。安装器须包含 G1 审过的生产适配；生产适配候选必须先审查通过。

```sh
# 构建主机，W1 批准后；工作区必须干净，Node v24.18.0、pnpm 冻结 lock。
git worktree add --detach "$REPO" "$RELEASE_COMMIT"
cd "$REPO"
HZY_DATA_RUNTIME_COMMIT="$RELEASE_COMMIT" \
 HZY_DATA_RUNTIME_PACKAGE_DIR='<私有 Runtime 包目录>' \
 HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE='<既有受保护签名私钥>' \
 ./data-runtime/scripts/package-release.sh "$RT_VERSION"
node deploy/self-hosted/build.mjs --commit "$RELEASE_COMMIT" --version "$APP_VERSION" \
 --apps console,enterprise,workflow,aims,codocs,gateway --out "$ARTIFACTS"
# 在匹配 Linux amd64 的受控构建环境：
(cd data-runtime && go build -trimpath -o "$TOOLS/hzy-enterprise-add-apf" ./cmd/hzy-enterprise-add-apf)
(cd data-runtime && go build -trimpath -o "$TOOLS/hzy-enterprise-verify-views" ./cmd/hzy-enterprise-verify-views)
(cd data-runtime && go build -trimpath -o "$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs ./cmd/hzy-document-catalog-reconcile)
```

核对六制品 commit/版本/OS/arch/hash/signature 与三个工具 hash，传输后再次校验。保留生产配置，不从本机 secret 覆盖。Runtime stage/Platform sync+approve 采用既有正式路径、只用 stable-prod，目标 pinned；影响其他 prod 实例时停止请示。不 promote latest、不运行 update_dr.sh。发布 tag 只在单独批准后走 GitLab origin；本任务不发布。

## 5. 停写与 SQL 安装前检（W2/W4）

暂停用户写入及已登记后台 owner（cron、手动 drain、Runtime 进程内调度、回调、对账触发），记录原状态；不改 outbox 行，不以错误响应模拟“已暂停”。停止应用，再停 Runtime：

```sh
sudo systemctl stop hzy-tenant-gateway hzy-enterprise hzy-aims hzy-codocs hzy-workflow hzy-console
# Collab 仅原 active 且实际依赖 Runtime 时停止。
sudo systemctl stop hzy-data-runtime
runtime_state=$(systemctl is-active hzy-data-runtime.service || true)
test "$runtime_state" = inactive # 其他状态不是停止证明，立即停止。
ss -ltn # 应无31080；其余应用实际监听均退出。
```

若任何进程仍可写/端口仍监听，停止。MySQL 留在线。安装过程中冻结 Runtime 的自动启动/更新来源，按审过的 systemd 停止证明执行；生产适配应同时验证 unit 状态和31080实际无监听，不能仅信 inactive。

分别读取信息 schema 的 columns/indexes/tables/views，保存 SHOW CREATE。三迁移预期目标：

| SQL | 一次性对象 | 只读成功条件 |
| --- | --- | --- |
| `20261005_document_storage_dimension.sql` | documents.storage_type/storage_locator/origin_json、idx_documents_storage_type；document_versions.storage_revision | 类型/default/nullable/索引与原 SQL 一致；每个 documents 行 locator 已回填；旧正文路径、doc_type、总数不变 |
| `20261006_document_catalog.sql` | document_catalog_entries、document_catalog_entry_versions、只读 document_catalog view | 两唯一键/索引和完整 view 定义匹配；view IS_UPDATABLE=NO；文档枚举不复制正文、不改变旧文档 |
| `20261007_document_access_policy_owner.sql` | policies.source_owner_type、inherit_to_member_projects | ENUM 三值、default=project；TINYINT default=1；原策略/授权列和行数不变 |

**全部目标不存在**才整份执行该迁移；**全部已存在且定义/回填匹配**则记录已安装并跳过 DDL。任何部分存在、定义不同、同名非预期对象：停止，编制恢复/补齐方案另审。不能给 ALTER/CREATE 随便加 IF NOT EXISTS 或自动重跑完整 SQL。20261005 的 backfill 可重复，但不代表其 ALTER 可重复。

```sql
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='hzy_codocs'
 AND ((TABLE_NAME='documents' AND COLUMN_NAME IN ('storage_type','storage_locator','origin_json'))
 OR (TABLE_NAME='document_versions' AND COLUMN_NAME='storage_revision')
 OR (TABLE_NAME='document_access_policies' AND COLUMN_NAME IN ('source_owner_type','inherit_to_member_projects')));
SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='hzy_codocs' AND TABLE_NAME IN ('document_catalog_entries','document_catalog_entry_versions','document_catalog');
SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,NON_UNIQUE FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA='hzy_codocs' AND (TABLE_NAME IN ('document_catalog_entries','document_catalog_entry_versions')
 OR (TABLE_NAME='documents' AND INDEX_NAME='idx_documents_storage_type')) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
```

## 6. 项目集两表增量安装（W3，G1 解除后）

前置：运行进程真实停止、最终停写备份有效、原 Aims read/write=unified、非零 generation 与 Registry/instanceId 匹配；两表和映射不存在。工具只建 `aims_portfolio_members`、`aims_portfolio_doc_repos` 两张同名表，DDL 等同 `aims/docs/migration_v5.42_portfolio_members.sql`，不建兼容视图、不更新 Registry/mapping_hash，其他域/模式/未知字段保持。

以下为生产适配候选参数，G1 审过且现场核对通过后才能执行。`PRODUCTION_INSTALL_PROFILE` 指向依 README 现场核对后准备的 0600 profile；其中原 generation 保持不变。

```sh
STAGE="$BACKUP/portfolio-install"
install -d -m 0700 "$STAGE"
# BASE 是停写前现用配置的0600原字节副本；migration.json为独立迁移账号，不能是root或Runtime账号。
BASE="$BACKUP/config.source.json"
MIGRATION_DB_CONFIG='<已批准同主机/同统一库的0600迁移配置>'
PRODUCTION_INSTALL_PROFILE='<已审生产安装profile绝对路径0600>'
common=(--profile "$PRODUCTION_INSTALL_PROFILE" --subset aims-portfolio-members --config "$BASE" --migration-db-config "$MIGRATION_DB_CONFIG" \
 --proposed-config "$STAGE/proposed.json" --plan "$STAGE/plan.json")
"$TOOLS/hzy-enterprise-add-apf" --mode plan "${common[@]}" > "$STAGE/plan-result.log"
# 人工审阅：恰2表、无视图/Registry变化、其他对象baseline不变；提交reviewHash确认后才继续。
review=$(jq -er '.ReviewHash' "$STAGE/plan.json")
"$TOOLS/hzy-enterprise-add-apf" --mode apply "${common[@]}" --receipt "$STAGE/receipt.json" --review-hash "$review"
"$TOOLS/hzy-enterprise-add-apf" --mode verify "${common[@]}" --receipt "$STAGE/receipt.json" --review-hash "$review"
```

应用 proposed 配置前审阅精确差异：只追加两张 Aims tables 映射。Runtime 通过该映射解析物理表名（`resolved.Table`），**映射缺任一张表时三个成员入口与全部项目集文档入口都返回 503**，所以“表已建但映射未切换”不算安装完成。W3 批准后以原属主/权限原子切换现用配置，保留 source；不替换 overlay/信任密钥。verify 不通过不启动。已有完整安装则用其**原**plan/receipt/hash验证，不重新猜造归属。

回滚命令使用本段原四文件/hash，保持 Runtime 停止：

```sh
"$TOOLS/hzy-enterprise-add-apf" --mode rollback "${common[@]}" --receipt "$STAGE/receipt.json" --review-hash "$review"
# 成功后，恢复BASE至CONFIG（原属主/权限，原子替换），核对原mapping与Registry。
```

安装后的功能核验（W5 启动之后做，只读）：以有 `portfolios:view` 的真实会话 `GET /aims/api/v1/portfolios/<任一项目集>/members` 应为 200 且含 `portfolio/ownerUid/members/docRepo/canManage/canBootstrap/ownerInactive/truncated`；返回 `503 aims_portfolio_members_unavailable` 说明映射未生效，返回 `503 directory_subject_status_unavailable` 说明 Directory 预读不可用（负责人是否在职的判定依赖它，不会降级放行）。生产若存在负责人已离职的项目集，页面会显示“负责人已失效”，这是预期行为，不是故障。

任何非空数据、baseline/schema/代际漂移、外部 FK、未 checkpoint 对象、遗留 .next 都停止，不手工 DROP。后续验收写入成员或仓库关系后，该回滚通常不能删表；正常代码回退优先保留增量表/映射，评估旧代码兼容，不破坏新数据。

## 7. Codocs 三迁移（W4）

已在独立隔离库从生产备份恢复并用最终 SQL 原字节演练、逐条记录 MySQL 版本/ALGORITHM/锁等待/耗时后，按 §5 判定逐份执行。MySQL 8.0.29 以下 ADD COLUMN AFTER 可能重建表；即使8.0.46也不能未经实测宣称 INSTANT。SQL 中未固定 ALGORITHM，实际路径不明须标记未知并给足停写预算。

```sh
# 仅已确认该份目标全不存在时执行；不使用mysql --force。
mysql --defaults-extra-file="$CODOCS_CNF" --database=hzy_codocs --show-warnings \
 < "$REPO/codocs/docs/migrations/20261005_document_storage_dimension.sql" \
 > "$BACKUP/migration-20261005.log" 2>&1 || exit 1
# 按§5逐项verify并保存证据；不是PASS不执行下一份。
mysql --defaults-extra-file="$CODOCS_CNF" --database=hzy_codocs --show-warnings \
 < "$REPO/codocs/docs/migrations/20261006_document_catalog.sql" \
 > "$BACKUP/migration-20261006.log" 2>&1 || exit 1
# verify表/索引/视图，再继续。
mysql --defaults-extra-file="$CODOCS_CNF" --database=hzy_codocs --show-warnings \
 < "$REPO/codocs/docs/migrations/20261007_document_access_policy_owner.sql" \
 > "$BACKUP/migration-20261007.log" 2>&1 || exit 1
# verify两策略列与旧行计数，再允许部署代码。
```

每份 SQL 必须**整文件交 MySQL 服务端解析**。无 mysql 客户端时仅使用已审 mysql2 `createConnection({multipleStatements:true})`、`query(完整文件内容)` 的执行器；不得客户端按分号拆分，COMMENT 内含分号。DDL 非事务，某条失败不会回滚上一条；立即停止，保存已完成对象，不自动重试整份。

20261007 的核验口径（fa 校对补充）：两列加完后，**所有存量策略行** `source_owner_type='project'`、`inherit_to_member_projects=1`（列默认值）。这是预期的中间状态：在 portfolio-owner 对账把项目集文档的策略行标为 `portfolio` 之前，项目集路径对这些行一律按“L2、不继承”处理（安全但组内项目成员看不到），不会因为 `inherit=1` 的默认值而放宽——继承只对 `source_owner_type='portfolio'` 且编码匹配的行生效。因此“迁移后、对账前”开放业务也不会越权，只是继承尚未生效。存量行 `inherit_to_member_projects=1` 的含义是：一旦该行被对账标为项目集归属且密级为 L0/L1，组内项目成员即可见；对账 dry-run 审查时要连同每行的 `confidentiality_level` 一起看（见 §10）。

核验补充：documents 按 doc_type/status 的计数和旧字段摘要不变；storage_type全为oss（本次回填不生成git正文），locator bucket与git-project/projects、其他/documents一致；versions原行内容不变；catalog安装初始为空，view不含已删/回收文档。普通OSS对象不改、不删，不发布正文。

## 8. 新代码上线与服务恢复（W5）

必须在新 Runtime 上验证 GitLab integration operation 注册表已无 commit/resolve-actions，再做 v2.35。两策略列已装才启用项目集路径。六应用同冻结 SHA；Aims仍scheduler-only，不恢复独立用户写入口。

离线 Runtime 安装沿用已验签 install.sh，参数为精确版本、受保护公钥、原运行用户、不自动更新、暂不启动：

```sh
sudo bash "/home/hzy-backup/runtime-release/$RT_VERSION/install.sh" \
 --base-url file:///home/hzy-backup/runtime-release --version "$RT_VERSION" \
 --release-public-key /etc/hzy/release-signing-public.pem \
 --user hzy-runtime --group hzy --no-auto-update --no-start
"$TOOLS/hzy-enterprise-verify-views" --config "$CONFIG" \
 --profile '<现用生产profile0600路径>' --install-artifact '<现用安装证据路径>'
```

安装器仍可能重新 enable update-request.path，按窗口前记录恢复 timer/path 的批准状态；目标 pinned，不能让旧 latest 更新器介入。配置/env/overlay与批准差异之外原字节保持。视图总数按生产基线；两同名表不增加视图，**不把 hzy0 的142当生产固定值**。旧 install-artifact 与映射hash不一致即停，不改证据绕过。

release.mjs CLI 默认重启，窗口内采用受审 `publishIndex` 的不启动形式，从干净仓库执行：

```sh
PUBLISH_INDEX="$ARTIFACTS/index.json" PUBLISH_ROOT=/home/hzy/apps node --input-type=module <<'JS'
import { publishIndex } from './deploy/self-hosted/release.mjs'
await publishIndex({indexPath:process.env.PUBLISH_INDEX,root:process.env.PUBLISH_ROOT,
 restart:async()=>{},health:async()=>{},keep:99999})
JS
for app in console enterprise workflow aims codocs gateway; do
 node deploy/self-hosted/verify.mjs --dir "/home/hzy/apps/$app/releases/$APP_VERSION" --app "$app"
done
```

保留旧链接和工具版本，不套用旧手册的 `hzy-gateway` 单元名；实际为 `hzy-tenant-gateway`。按实际 Wants 核对避免意外拉起此前停用应用，Runtime → Console → Workflow → Aims → Codocs → 原active Collab → Enterprise → Gateway；逐个ready后再启动下一个，不一条start掩盖前项失败。**启动不等于解冻用户写入**：对账完成前维持入口维护和暂停后台投递；若Runtime启动即有post-commit目录同步，则保持业务写入冻结，并确认无并行对账执行者。

- Runtime `/runtime/health` 连续3×200，版本/commit精确匹配，tenant/prod/generation与基线一致；匿名业务401。
- 实际应用端口全部监听；Console/Enterprise/Codocs页面入口、实际Nuxt入口chunk连续3×200；60秒无加载错误/reload循环。
- Codocs匿名 Service API 返回401，不能把直连根路径404当授权失败证据。
- Gateway `/readyz` 成功，公网 `/enterprise/login` 200、`/enterprise/` 200或302（不跟随跳转）；systemctl全部预期单元active，原停用单元不被拉起。
- 使用已有生产受信拨号/签名工具核验 Aims，只做只读入口；不手拼Gateway头、不请求drain。
- 视图复核、策略版本/签名与配置指纹通过，后台水位/attempt无异常推进。

任一步失败停止后续，按 §12 回滚，不反复盲切。

## 9. v2.35 收窄 GitLab 操作（W6）

已知生产 `aims.runtime` grant id=31735163、`codocs.runtime` id=31735164 仍含 gitlab.commit/resolve-actions，来自任务书/用户只读核查。本任务未再次连接确认。

Seed **并非只针对这两ID**：它匹配全表 resource_code=`integration_operations`、action=`execute` 的所有状态行，只从 $.operations 删除两项、更新updated_at；不改status、不删行、不复活revoked，保留gitlab.issue-upsert、读操作、WeCom及integrationCodes等限制。前检必须包含全匹配集合（含revoked）；出现未审批额外命中先报告，不把“预计2行”当事实。

```sh
mysql --defaults-extra-file="$CONSOLE_CNF" --database=hzy_console --show-warnings \
 < "$REPO/console/docs/sql/Console-SQL-Verify-v2.35-gitlab-repository-read-only-candidate.sql" \
 > "$BACKUP/v235-before.log" 2>&1 || exit 1
# 保存每个目标完整原行、预计删除后行及整表非目标字段摘要到加密私有证据；先审范围。
# 新Runtime健康和操作闭集核验通过后才执行：
mysql --defaults-extra-file="$CONSOLE_CNF" --database=hzy_console --show-warnings \
 < "$REPO/console/docs/sql/Console-SQL-Seed-v2.35-gitlab-repository-read-only-candidate.sql" \
 > "$BACKUP/v235-apply.log" 2>&1 || exit 1
mysql --defaults-extra-file="$CONSOLE_CNF" --database=hzy_console --show-warnings \
 < "$REPO/console/docs/sql/Console-SQL-Verify-v2.35-gitlab-repository-read-only-candidate.sql" \
 > "$BACKUP/v235-after.log" 2>&1 || exit 1
```

Verify第一查询必须0行（所有状态），第二查询剩余读/issue-upsert等与before一致；逐行仅operations两项/updated_at变化，status/binding/audience/semanticScope/integrationCodes/其他键不变，非目标行按id排序摘要相同。JSON数组存在重复写操作时单次JSON_REMOVE可能不能全部移除；verify不为0则停止报告，不循环试错。

签发会写审计，须 W8 确认：真实aims.runtime/codocs.runtime/enterprise.runtime用实际client_credentials与现有精确scope签发，只记录HTTP和脱敏iss/aud/scope/source/tenant/deployment/TTL校验结果，不输出token；再以正式用户读取仓库文件/项目集正文验证使用链。integration_operations:execute令牌签发200不代表commit仍可用；两项操作应在新Runtime固定闭集之外拒绝，读操作正常，反例优先用隔离证据/批准的无副作用请求。不提交真实GitLabcommit测试。

若代码回退到不含 DOC-01 的旧版本而 v2.35 保持收窄：旧 Codocs 页面会重新出现“提交到 GitLab”入口，点击后因 grant 已无 `gitlab.commit` 而失败（403/502 取决于旧代码的错误映射）。这是失败关闭，不会写仓库；需要在回退通知里向用户说明该按钮不可用，而不是为此恢复 grant。

代码回滚通常**保留v2.35收窄**，用户“不写GitLab仓库”的决策不因回滚自动撤销。如确需恢复原JSON，须另行明确批准，用before逐行条件恢复；不整表覆盖新授权：

```sql
-- 只作预生成rollback.sql模板：各十六进制值从私有before/after原字节证据取得。
START TRANSACTION;
UPDATE service_client_grants
 SET scope_json=CAST(CONVERT(UNHEX('<该ID原scope_json字节HEX>') USING utf8mb4) AS JSON),
     updated_at='<该ID原updated_at>'
 WHERE id=31735163 AND status='<原status>'
   AND BINARY CAST(scope_json AS CHAR)=BINARY CONVERT(UNHEX('<该ID已验证after JSON的HEX>') USING utf8mb4)
   AND updated_at='<本批after updated_at>';
-- ROW_COUNT()必须为1；0则ROLLBACK并停止。31735164及已审批其他命中逐行同样处理。
-- 应由事务执行器逐条检查再COMMIT，不能无条件执行下面的提交。
-- COMMIT;
```

该SQL只是形状；实际JSON显示字节、timestamp精度和全部目标必须在执行前生成并审查。任何并发授权变化则不恢复；从加密备份隔离恢复取值，不打印原JSON或凭据。

## 10. 两类对账（W7）

保持业务/后台写入冻结。工具只读取Aims元数据、写Codocs元数据；不复制正文。`HZY_DATA_RUNTIME_CONFIG`及CONFIG_DIR使用现用生产受保护路径；config.Load还读取overlay/Vault，沿用现有安全服务启动环境，不把secret导出到日志，不临时造身份。

```sh
# G3通过后；在Runtime主机运行，JSON保存0600，只回报统计。
export HZY_DATA_RUNTIME_CONFIG="$CONFIG"
export HZY_DATA_RUNTIME_CONFIG_DIR=/etc/hzy-data-runtime
"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs > "$BACKUP/catalog-before.json"
# 分族审查project_repo_document / requirement_spec / project_weekly_report的源、owner、变更。
"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs --apply > "$BACKUP/catalog-apply.json"
"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs > "$BACKUP/catalog-after.json"
jq -e 'has("error")|not' "$BACKUP/catalog-after.json" >/dev/null
jq -e '[.kinds[].changes|length]|all(. == 0)' "$BACKUP/catalog-after.json" >/dev/null
# 三族必须都在结果里：某一族失败时工具在该族停止，后面的族不会出现在 kinds 中。
jq -e '.kinds|keys == ["project_repo_document","project_weekly_report","requirement_spec"]' "$BACKUP/catalog-after.json" >/dev/null

"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs --portfolio-policy-owners > "$BACKUP/portfolio-owner-before.json"
# 逐UUID核对权威portfolio code、目录排除、仅已有policy行；确认后才apply。
"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs --portfolio-policy-owners --apply > "$BACKUP/portfolio-owner-apply.json"
"$TOOLS/hzy-document-catalog-reconcile" --expect-aims-db hzy_enterprise --expect-codocs-db hzy_codocs --portfolio-policy-owners > "$BACKUP/portfolio-owner-after.json"
jq -e '.portfolioPolicyOwners.changes|length == 0' "$BACKUP/portfolio-owner-after.json" >/dev/null
```

目录对账的运行特性（fa 校对补充）：dry-run 不取锁、不写入。`--apply` 对每一族先取库级锁 `GET_LOCK`（等待 10 秒）再读 Aims、再写 Codocs；若此时新 Runtime 的后台登记 worker 正持有同一把锁，命令返回 `documentcatalog: reconcile busy` 且**没有写入任何内容**，稍后重跑即可，不属于失败。业务写入冻结时 Runtime 不会产生新的登记触发。每一族的写入是单事务；输出中每族的 `changes[].action` 只会是 `create`/`update`/`deactivate`，首次生产运行预期全部为 `create`，出现 `update`/`deactivate` 说明目录表并非空表，应停下核对。输出只含 uuid、kind、objectId，不含标题或正文。

成功条件：目录三族dry-run changes均0，active/inactive、版本唯一键与冻结源一致；不存在源的旧catalog仅标inactive，不删行。每族apply可能已成功而后续族失败，工具不是跨三族全事务；失败停止、保存分族证据，不假设自动全部回滚。

Portfolio：desired由非目录、只挂项目集、UUID与project_portfolios权威来源计算；不会把目录或项目文档计入。noPolicy允许非0，工具不为缺policy创建策略、不放宽默认限制。已正确归属计unchanged；changes仅改已有policy source_owner_type/source_project_code并写policy_update审计（reason=portfolio_owner_reconciled），inherit/security/其他授权列不改。

portfolio-owner dry-run 的逐行审查口径（fa 校对补充）：`changes[]` 每项含 `documentUuid`、`portfolioCode`、`fromOwnerType`、`fromOwnerCode`。逐项确认 ① `portfolioCode` 是该文档在 Aims 中所属项目集的现行编码；② `fromOwnerType` 应为 `project`（存量默认值），出现其它值停止；③ `fromOwnerCode` 通常就等于 `portfolioCode`（独立 Aims 时期把项目集编码写在“项目编码”列）——若不相等，说明这行策略原本登记在**另一个项目**名下，apply 会把它从那个项目的策略里改挂到项目集，必须先由业务确认，不能直接 apply；④ 对每个将被标记的 UUID 另查其策略行的 `confidentiality_level` 与 `inherit_to_member_projects`：L0/L1 且 inherit=1 的文档在 apply 之后会立即对该项目集的组内项目成员可见，这是一次可见范围的扩大，需把清单交项目集负责人知悉或先把不应继承的文档在页面上关闭继承（关闭继承须在 apply 之后、开放业务之前由项目集管理者操作，或接受其生效）。`--apply` 是单事务：全部成功或全部不写；`desired == unchanged + noPolicy + len(changes)` 应恒成立，不成立即停止。列未安装时命令返回 `codocs_portfolio_policy_unavailable`，说明 20261007 未就绪。

核对期望从**生产before**派生，不硬编码hzy0 desired1。每个changed UUID审计增1，重复apply不增；无policy者无新增审计。任何未知归属、跨租户、重复UUID、源不完整、只读视图缺失、unexpected change或dry-run非零均停止。

工具没有reverse/revert flag，不能编造回滚命令。验收前仍全停写且无新业务写入时，可经 W8 确认按 §12 恢复Codocs最终全库备份；有新写入后不得覆盖。需要精准撤回则另审逐行反向计划并保留审计，不能删除审计抹去对账历史。

## 11. 浏览器验收与 hzy0 演练证据

在维护入口解除前完成只读核验；写验收的样本、动作及清理方式经 W8 确认。使用真实zhouguangying会话及无权test会话，不伪造actor、不以service-client替用户。1440/390各记录截图、API状态、分页COUNT、无JS错误/横向滚动、private,no-store。

| 场景 | 正例与负例 |
| --- | --- |
| 项目集详情（`/aims/portfolios/:id`，从项目总览的项目集名称进入） | 三个页签：项目集文档、成员、文档仓库。页头显示名称/编码/负责人/“我的关系”；负责人已离职时出现“负责人已失效”。成员表不分页（上限 500，超出有提示）；文档表底部“共 N 项，其中 M 份文档”与列表一致（`total` 含文件夹，`documentTotal` 只计文档）。入口显隐：管理者见“挂入已有文档/新建文件夹/访问策略/移除”与成员维护；参与者见挂入与移除自己挂入的文档，无策略入口；查看者与组内项目成员无任何写入口；无关系用户看到“你不是该项目集的成员”（接口 403）。文件夹行与“引用缺失”行的密级/状态显示“—”。390 宽度两张表横向滚动、表头不竖排 |
| 项目集挂入（写验收，需 W8 确认样本） | 只能挂入**本人是所有者**的已有文档（粘贴文档链接或标识）；挂入他人文档（即使有编辑分享）403；同一文档重复挂入 409；新挂入文档默认 L2/草稿/组内项目成员不可见，出现“访问策略”。项目集下没有“新建文档/上传”入口，页面有“先在个人或部门空间创建再挂入”的说明。策略属于其它项目或项目集的文档：可挂入但提示“策略属于别处”，策略按钮禁用。把一份文档改为 L1 并开启“对组内项目成员开放”后，组内项目的成员（非项目集成员）在项目集页与项目文档页只读区能看到它；改回 L2 或关闭继承后立即看不到。样本用带约定标记的测试文档，验收后由管理者“移除”（只删引用，不删正文），并把策略恢复为 L2/不继承或记录保留原因 |
| 打开正文（`/aims/portfolios/:id/documents/:docId`） | 仅平台文档（Codocs）可打开，按 Markdown 安全渲染、只读，无下载/编辑入口；原始 HTML 以文本显示。**仓库文件引用本批不支持在线查看**，列表显示“暂不支持在线查看”且标题不是链接。负例：组内项目成员直接访问一份 L2 或未开启继承的文档的地址，与访问不存在的编号得到同一个“文档不存在，或你没有查看权限”（接口同为 404，响应体相同）；无关系用户 403。响应不含文档 UUID、存储路径；`Cache-Control: no-store`。390 宽度长代码行在代码块内滚动，页面无横向溢出。已知限制：公司文档空间（路径以 `codocs/company/` 开头）的文档挂入后，对没有 Codocs 原生权限的读者“列表可见但打不开”，属失败关闭，记录即可 |
| 项目文档页只读区 | 项目文档页侧栏底部“所属项目集文档”：数量（只计文档）、前 5 个标题（链接到打开页）、“查看项目集文档”链接。只出现对当前用户开放的项目集文档；项目未归属项目集或用户与项目集无关系时该区不出现；项目集侧依赖不可用时显示一行“项目集文档暂不可用，不影响本项目文档”，项目自己的文档照常。原项目文档列表、计数与写入口不变；项目入口对项目集归属文档的写入仍被拒绝（409）。同名编码反例（某项目编码与项目集编码相同）若生产不存在该情形，以隔离 MySQL 测试证据代替，不为验收制造同名数据 |
| Altoc/People表单 | 人员/部门/客户/合同/岗位/职级等搜索选择器中文姓名/标签；必填星号、400字段错误；目录失败明确提示、不多次重复请求；无权入口不泄露数量/敏感字段 |
| 授权/回滚 | 非成员不可读的样本、wrong permit/aud/source等用既有隔离证据；Runtime回退后入口和旧业务读仍健康，新策略字段/账本证据保留 |

浏览器写入不做真实新账号开通、离职、外部停用或合同审批。项目集两表开始有数据后不要尝试installer DROP回滚；审批/审核历史不得硬删。共享OSS wiz-rs：仅批准的CLAUDE-FIXTURE对象可用于测试，不改真实对象。

[LOCAL_RUNTIME](../deploy/test-env/LOCAL_RUNTIME.md) 对应标题为可检索证据索引：

- 「v2.35 本地授权核验（零目标）与 DOC-03 部分盘点」：599行全表不变、目标0行。**不能当作生产31735163/64的非零修改演练**；需以脱敏生产grant形状补隔离演练。Reporter调整尚未执行，不并入本次范围。
- 「项目集成员子集」安装/回滚记录（`ac0490df`之后）：两同名表、generation/既有视图不变、空表rollback护栏；只证明hzy0工具，不能证明G1的Linux路径。
- 「ce785898 / Runtime .15 尝试」：客户端拆分分号失败，停止并全库恢复；是本次整文件/失败即停的反例证据。
- 「ce785898 第二次」：整文件演练成功，但错误的“预期2”导致回滚；后续已裁定合法集合只1份（目录排除、缺policy不创建）。
- 「100c52b9 / Runtime .15 与 Codocs三迁移、对账成功」：138文档/六新增列、catalog只读视图、两catalog登记后零差异；portfolio desired1/noPolicy1/changes0，零新增审计；三迁移和备份恢复演练完成。
- 「8ffecbe4 / Runtime .16」与「3e98a6bc / Runtime .17」：六应用同候选、七端口/公网302、142视图、入口3×200、60秒稳定。协调者已确认3e98a6bc项目集正文/UI验收通过；生产不得照搬142或本地端口。

## 12. 停止与回滚（窗口内确认 W8）

优先级：保留证据 → 停止所有写入/投递 → 判断是否已有新业务写入 → 选择代码回退或数据恢复。不能因页面失败自动恢复全库。

### 12.1 代码回退，优先保留增量数据

停止六应用和Runtime（同§5），恢复已备份原Runtime二进制、原工具/current链接、兼容的配置原属主权限。若portfolio新表已有数据则保留表与映射，确认旧Runtime对新增mapping兼容；否则按原receipt显式rollback后恢复source配置。Codocs三份增量列/表可留，旧代码未使用它们；v2.35维持收窄。恢复Platform desiredVersion仅通过正式prod approve回滚路径且另批准，不能让更新器把运行版本反复改回。

```sh
# OLD_*均来自窗口前保存的真实路径/SHA，不能猜rc25路径。
# hzy-data-runtime.before已从本批加密归档校验解密；属主/组/模式须与before stat一致。
sudo install -o hzy-runtime -g hzy -m 0750 "$BACKUP/hzy-data-runtime.before" /opt/hzy-data-runtime/hzy-data-runtime
for app in console enterprise workflow aims codocs gateway; do
  old=$(cat "$BACKUP/current-$app.path")
  test -d "$old"
  ln -s "$old" "/home/hzy/apps/$app/current.rollback-next"
  mv -Tf "/home/hzy/apps/$app/current.rollback-next" "/home/hzy/apps/$app/current"
done
# 配置恢复仅使用审过的原字节/保留新映射版本，不覆盖信任overlay。
sudo systemctl start hzy-data-runtime
# 等Runtime准确健康后，逐个start+ready，不忘Gateway：
sudo systemctl start hzy-console
sudo systemctl start hzy-workflow
sudo systemctl start hzy-aims
sudo systemctl start hzy-codocs
sudo systemctl start hzy-enterprise
sudo systemctl start hzy-tenant-gateway
# 原active Collab按原依赖顺序恢复；再跑全部健康/监听/视图/入口门槛。
```

回退后数据与旧代码的兼容性（fa 校对补充，均为“可保留”）：① 20261005/20261007 新列都是 NOT NULL 带默认值或可空，旧代码的 INSERT 不受影响；旧代码不读这些列。② portfolio-owner 对账只改 `source_owner_type` 与 `source_project_code`；当 `fromOwnerCode == portfolioCode`（常见情形）时旧代码看到的编码没有变化，行为与对账前相同；若某行的编码被对账改过（§10 口径 ③），旧代码会按新编码判断“来源项目成员”，回退前须把这些 UUID 列出并评估。③ 新代码写入的项目集策略行（`source_owner_type='portfolio'`）在旧代码下会被当作普通项目策略、按编码匹配项目成员：若生产存在与项目集同编码的项目，回退期间该项目成员可经旧的项目文档入口读到这些文档——回退前必须只读核查“项目编码 ∩ 项目集编码”是否为空，非空则回退方案需另审。④ 目录登记表对旧代码不可见。⑤ 项目集两表保留时，旧 Runtime 不访问它们；但配置里多出的两张表映射是否被旧 Runtime 的映射校验接受，须按上文在隔离环境确认。

二进制/install布局以现场readlink为准，若目标本身是受管软链，不用install破坏链接；改为按原受审release机制恢复对应二进制目标。对每项恢复后核对hash/权限。回滚路径存在/归属或旧配置兼容性不明即停，不无限restart。

### 12.2 Codocs 数据恢复，仅无新业务写入且明确批准

最终停写全库备份可撤回部分DDL/对账；会丢弃备份后的catalog和policy审计，故只限窗口未开放写入时，备份审计证据保留。迁移中失败但对象已创建，不手写DROP列/索引补救；先由协调者选择保留增量修复还是全库恢复。

```sh
# 先确认服务全部停止、恢复库名是hzy_codocs、备份已验证、charset/collation取生产before值。
# DROP/CREATE为破坏性恢复，单独确认本次回滚对象后执行；不DROP统一库/Console。
mysql --defaults-extra-file="$CODOCS_CNF" --show-warnings \
 --execute='DROP DATABASE hzy_codocs; CREATE DATABASE hzy_codocs CHARACTER SET utf8mb4 COLLATE <生产before已核实collation>;' || exit 1
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:$BACKUP_KEY_FILE" -in "$BACKUP/codocs.enc" \
 | gzip -dc | mysql --defaults-extra-file="$CODOCS_CNF" --database=hzy_codocs --show-warnings || exit 1
```

上面collation占位符须在审查时替换成实际合法标识符，不直接运行。恢复后复核documents/versions/policies/grants/audit计数与摘要、schema/view定义、原owner类型；再按代码回退顺序启动与健康检查。业务已开放写入时禁用这条恢复流程，另审增量数据修复/PITR。

本批不提供“撤销统一库所有变更”的整库覆盖捷径；portfolio安装只用原工具护栏回滚，Console只用逐行条件恢复，catalog/策略不伪造revert命令。

## 13. 执行前待协调者填写

- 最终合并 SHA、Runtime精确版本/tag及与已上线rc25的真实差集；若随后增加迁移/授权变化，重新审本执行单。
- G1生产CLI候选审查与profile现场核对、G2现用Aims健康drop-in、G3对账Apps DB/prod overlay核验。
- 生产当前Runtime/各current路径、systemd依赖、MySQL版本/表量、视图基线、generation/hash和各env状态。
- 独立迁移/备份defaults及加密材料保护路径、生产备份隔离恢复演练、DDL耗时与停止阈值。
- v2.35全匹配行集合及非零隔离演练、真实签发的精确现有capability矩阵；不新增grant。
- 维护入口/后台暂停方式、预计停写窗口、恢复/回滚选择、浏览器标记样本和业务清理清单。

### 13.1 已完成的生产只读核查（2026-10-04，协调者经 Tailscale + 只读账号 `hzy_ro_audit`）

只读账号仅 `SELECT, SHOW VIEW` 于 `hzy_enterprise`、`hzy_codocs`、`hzy_console`，写入被拒已验证；凭据只在协调者本机 0600 文件。

| 核查项 | 生产结果 | 结论 |
| --- | --- | --- |
| 项目编码 ∩ 项目集编码（`aims_projects` × `project_portfolios`） | 空 | §12 回退无同名串权风险；窗口前 W1 复查一次 |
| 项目集自有引用（portfolio-only） | 2 行：1 文件夹、1 文档，该文档 `codocs_uuid` 为空（引用缺失） | 与 hzy0 一致；`--portfolio-policy-owners` 预期 desired≤1、changes=0 |
| Codocs 策略行中 `source_project_code` 属于项目集编码 | 0 行（L0/L1 为 0） | 对账不会改挂任何策略，也不会对组内项目成员放开任何存量文档 |
| Codocs 有效文档 | 758，其中 `git-project` 94 | 6a 回填与目录登记规模参考 |
| `hzy-aims` ExecStartPost | 已有 `b17-no-direct-health.conf` 清空直连后置检查 | G2 与 `release.mjs` 只读探针一致，G2 解除 |

### 13.2 授权口径决定

用户 2026-10-04 同意：本批生产 G-7 维持既有五个 `enterprise-host` 域（选项 B）。Finance/People 的 `finance:enterprise-host:execute`、`people:enterprise-host:execute` 不在本批，APF 生产启用批次再对齐根规则、API 合同与 G-7 目录，届时 grant 写入另行批准。

上述未填写不能解释成默认批准。当前交付只是一份文档草稿。
