# 环境策略与 Runtime 发布隔离：候选执行单

本文件仅为执行草稿。没有执行任何步骤；每项环境写入须用户另批。环境只允许 prod/test/dev。

## 合同

策略权威水位为 `tenant_environment_policy_revisions(tenant_code,environment)`。同环境事实、目标部署集合、有效期都未变且原制品有效时，复用原已签正文、generatedAt、revision、signature，避免同 revision 不同正文。过期、撤销、目标变化或新正文必须升 revision。角色事实编辑仍是租户级，发布后每环境快照独立生效。生产旧有效版本 38 不因 test 发布失效；历史 test37 不恢复成有效。

软件制品共享，批准独立：`stable-prod/test/dev`；不存在渠道时无批准，不回退旧 stable 或全局 bootstrap 环境变量。实例默认 pinned，只有精确获批 tracking 实例跟随本环境渠道，retired 在心跳/签发登记码/兑换登记码时拒绝。mode 不能阻止主机上的旧 timer，必须单独冻结。软件降级要求本环境确认，Runtime 实际降级仍走主机受控回滚，不承诺 heartbeat 自动降级。

## E1 只读 plan 与备份批准

先记录 HEAD、MySQL 版本、部署环境、全部实例精确 ID/runtime_code、旧 stable 的来源与审批证据，生产 bundle38 的 ID/hash/signature/targets。日本旧实例是否与新生产共用登记行必须现场确认，无法确认则停止；不按名称/key 自动退休。

```sh
set -euo pipefail
# MYSQL_CNF、BACKUP_KEY 为既有受保护配置/加密 key 路径，禁止值进 argv/log。
# MYSQL_CNF 0600。BACKUP_DIR 必须在受保护备份根目录，目录0700。
mysql --defaults-extra-file="$MYSQL_CNF" --show-warnings "$PLATFORM_DB" \
  < platform/docs/sql/migrations/20261002-runtime-environment-channels-plan.sql
mysqldump --defaults-extra-file="$MYSQL_CNF" --single-transaction --routines --triggers "$PLATFORM_DB" \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass file:"$BACKUP_KEY" -out "$BACKUP_DIR/platform-before.sql.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:"$BACKUP_KEY" -in "$BACKUP_DIR/platform-before.sql.enc" \
  | shasum -a 256 > "$BACKUP_DIR/decrypted-dump.sha256"
# 验证可解密、精确表/行清单与生产基线；不回显正文、token、ciphertext。
```

## E2 迁移演练与现场 DDL 批准

先在真实库的受保护隔离副本演练；记录 ALTER 的实际算法与耗时、锁窗口。生产不保证无锁。暂停策略生成、批准、登记写入，保留数据面；旧 Platform 不得与新 Platform 并行写水位。

```sh
mysql --defaults-extra-file="$MYSQL_CNF" --show-warnings "$PLATFORM_DB" \
  < platform/docs/sql/migrations/20261002-environment-policy-runtime-release.sql
```

任一非零退出立即停止，非事务 DDL 半装须核查，不能重跑覆盖。回填由同一连接执行 START TRANSACTION、backfill、verify，人工检查全部异常查询为空且 release_mode_column=PASS 后才 COMMIT，否则 ROLLBACK。不能仅按 mysql exit0 判成功。回填数量等于审过的环境组数。prod 原 ID/revision/hash/signature/targets、所有 instance 原字段与所有旧渠道必须逐字段不变。SQL 不自动迁移 stable，不启用 tracking，不处置日本实例。

## E3 兼容 Platform 切换批准

构建本批干净提交候选，保留旧输出/进程配置及具环境隔离保护的回滚候选。先 SQL，再新代码。验证 prod38 当前信封仍有效，test 发布独立升39；Console/Gateway/Runtime 不降低 revision、不接受同 revision 不同正文。安装命令按选定环境取精确版本。缺渠道时安装命令503，不生成 latest 命令。

正常回滚到保留新环境/mode守卫的制品，禁用批准；不能直接回旧全局代码。schema rollback 候选只用于无新签发/批准的隔离演练。不能恢复整表覆盖凭据、心跳或实例目标。

## E4 主机冻结、渠道映射与 mode 批准

先经现场批准冻结旧 timer 与 API-update path，核查 policy.TargetVersion 优先级。再决定旧 stable 只迁到哪个环境（精确release ID/key/version）。test/dev 必须独立批准，不复制prod渠道。按 plan SQL 中模板生成精确参数执行单，更新 tracking 时必须 ID/code/environment/before-mode/version 全匹配且影响行数=1。日本独立旧登记行才可另批 retired；共用新生产身份时必须先解决旧 credential 失效，不能退役新生产行。

## E5 验收/回滚

逐环境批准与探测：同 key prod/test；只改选定环境tracking，pinned/retired与非目标环境全字段hash不变；错token401、退休403且不写、pinned返回空desired、未知mode503；未批准无stable fallback。降级无确认409，确认后渠道审计含环境。实际主机降级另批。

每环境水位已上升后不得降低或删除；停止新批准并以兼容制品保持当前水位。timer冻结、日本退役不随代码回滚解除。全局latest发布不属于本次批准。

## 需 Claude 运行的隔离测试

```sh
node --experimental-strip-types platform/scripts/test-environment-policy-runtime-release-mysql.mjs
node platform/scripts/test-g9-platform-bootstrap-mysql.mjs
```

前者仅用 temporary-mysql-harness 建立 /tmp 隔离实例，无真实库输入；覆盖 DDL/backfill、prod38/test39、真实批准函数 mode/env 栅栏与降级事务。后者复验新 Platform bootstrap 的混合 CREATE/ALTER 完整性检测。需要 mysqld 及隔离监听权限，作者未执行。现场迁移锁时长、prod38真实信封续签、Japan identity/timer状态仅在另批现场验收中证明。

## 执行记录（2026-10-02，用户批准，共享 Platform `hzy.wiztek.cn`）

1. **备份**：加密全量备份 `hzy_platform_dev`，已解密校验，路径 `/wiztek/hzy-test/backups/env-separation-20261002T203020Z/`。
2. **构建**：从干净提交 `5910d77b` 构建到 `/wiztek/hzy-test/platform-release-5910d77b`。源码包 SHA-256 前缀 `04b79121`，入口 `.output/server/index.mjs` 的 SHA-256 前缀 `1d500242`。
3. **DDL**：耗时 181 ms，MySQL 8.0.46。新建 `tenant_environment_policy_revisions`；`release_update_mode` 已核对为默认 `pinned`、`NOT NULL`。
4. **回填**：同一事务内先 ROLLBACK 演练，再正式 COMMIT。
   - 预检查与 4 项异常查询全部为空，`release_mode_column=PASS`。
   - 结果：C000001 prod=38（带 hash），test=38（hash 为 NULL）。
   - 实例字段摘要前后一致：`b6678776…`。
5. **切换**：`hzy-platform-dev` 由 `platform-release-54e54837` 切到新目录，回滚配置保存在 `env-separation-switch-20261002T203344Z/`，其他 PM2 进程不变。
   - prod 探测 200，版本 38；生产 Console 于 04:44 CST 续签 ok，版本 38。
   - 只把目标进程写入 PM2 dump，原 dump 已备份。
6. **test 签发**：bundle 39 / `pv_test_20261002204418_0032`。
   - prod 探测仍为 38；生产 04:50 续签 ok，版本 38。
   - hzy0 策略同步 `ready=true`。
7. **发布渠道**：`stable`（0.3.224，promotion，即 10/01 生产上线批准）复制为 `stable-prod`。
   - 两个实例（prod id 2、test id 1）均为 `pinned`，desired 未改。
   - 本 Platform 上没有日本旧实例登记，无需退役。
   - 本次渠道复制没有写 `platform_audit_logs`，以本记录作为审计依据。

**回滚**：PM2 用切换目录内的 `rollback.config.json` 启动旧目录。新表与新列旧代码不读，保留不删。

## APF 发布前置核验中止（2026-10-03）

用户已批准 Platform APF 发布（含第 6 步），固定候选 930c5ede。执行前核对本地发布包、源包、脚本补充包与 artifact manifest，四项 SHA256 均与 Finance-Manifest-Default-Scopes-Release.md 执行清单一致。

本机恢复验证前置只读查询返回 `@@event_scheduler = ON`，server_uuid 存在。用户明确要求此状态下停止报告、不擅自修改全局变量，因此本次在停服/备份之前中止。

当前状态：未连接 gitlab 主机或远端 Platform 库；hzy-platform-dev 与其他 PM2 进程未操作；未创建恢复库、未生成临时 defaults 文件、未执行备份/迁移/清单导入/角色配置/test 重签；未改全局变量、runtime channel、生产策略或任何数据库数据。没有需要回滚的环境写入。连接配置仅在内存中用于本机只读查询，未输出密码、DSN、server_uuid 原值或策略正文。

后续须由协调者处理本机 event_scheduler 条件，或另行批准事件调度已关闭的隔离 MySQL 实例作为恢复目标；本次不自动换目标或修改设置。恢复验证仍应使用唯一临时库名，验证后删除，不使用已有同名库。发布产物与候选保留，等待处理后续行；未提交或推送。

## APF 发布续行前置核验中止（2026-10-03，管理会话未配置）

已收到临时关闭本机 event_scheduler 的授权：仅隔离恢复验证期间 OFF，成功/失败均须恢复 ON 并回读。本轮尚未进入恢复验证，因此没有执行 OFF，原状态 ON 保持不变。

远端只读核验：主机匹配 iZcqwiqyhp9u8rZ；hzy-platform-dev 在线，cwd 为 `/wiztek/hzy-test/platform-release-38f8a20b/platform`，DB=hzy_platform_dev、PORT=3011、Node=v24.18.0；其他进程 hzy-console-test 原状态 stopped，未操作。Platform 库 source_type 列不存在、库内 events 数量 0。固定产物仍沿用前次已核对的四项 hash。

停止原因：执行单 api.mjs 所需的 PLATFORM_SESSION_FILE（0600、操作员已授权的 ops/tenant-owner 管理会话）尚未配置；限定 `/wiztek/hzy-test`、`/root` 私有目录的相应命名文件盘点未发现候选会话文件。正式管理接口要求对应有效会话，不可使用运行中的 internal/service token 绕过 ops/tenant-owner 认证，也未从数据库读取或创建用户会话。需配置已授权操作员会话、核验两类管理权限后才能续行；没有索取或读取密码。

本轮仅 SSH 与远端数据库只读前置核验；未停止进程、未修改 PM2、未创建候选/备份/临时恢复库、未改 event_scheduler、未执行迁移/导入/角色写入/重签/运行渠道修改。没有环境写入需要回滚。临时恢复库将在后续执行时使用唯一名称，成功后删除；无论恢复验证成功或失败都恢复 event_scheduler=ON。

未提交、未推送。发布在停服之前中止，原服务保持原状。

## APF 拆分执行中止（2026-10-03，远端缺 mysqldump）

按新增授权仅执行会话无关部分，固定 930c5ede。产物/source/执行包/artifact manifest 四项 SHA256 在远端再次核对一致；候选解包至 `/wiztek/hzy-test/platform-release-930c5ede`。macOS archive 扩展属性产生 GNU tar 非致命元数据警告；没有修改业务产物。

私有 attempt：`/wiztek/hzy-test/backups/apf-platform-930c5ede-20261003/`（0700）。已生成原 PM2 快照、rollback.config.json（0600），记录原库表行数/逻辑校验和与对象数摘要；仅停止 hzy-platform-dev，随后尝试加密转储。失败原因：远端宿主 PATH 无 `mysqldump`（command not found）。转储未成功，所得 encrypted 文件不是有效备份，不可用于迁移或恢复；私有 backup-diagnostic.log 保存诊断，不回显凭据。数据库尚未改动。

失败处理已完成：恢复 `/wiztek/hzy-test/platform-release-38f8a20b/platform` 原进程配置，hzy-platform-dev 在线，本机 health 200；其他进程 PID/status 与原快照完全一致（hzy-console-test 原为 stopped，保持 stopped）。临时远端 defaults 文件已删除。原进程运行 env 与旧配置保留在批准的私有快照内。

本机未开始隔离恢复验证：未执行 event_scheduler=OFF、未生成本机 defaults/明文转储、未创建临时库；回读确认 event_scheduler=ON。未执行 source_type 迁移/verify、新版切换、清单导入、角色配置、test 重签或 runtime channel 修改。第 5～7 步仍待协调者；本次不提交、不推送。

续行前应只读核验可用备份客户端（例如 owning MySQL 容器内的 mysqldump）及对应版本/选项，准备在既有批准库上转储的入口，不安装软件、不改变其他服务。任何可复用客户端仍须先完成完整加密备份与本机唯一临时库恢复验证，然后才可迁移；本次失败备份不能复用。

第 5～7 步界面执行要点（迁移和切换成功后才执行）：登录 Platform 管理界面，People→Altoc→Finance 逐份预览固定 930c5ede manifest diff、导入并按 applications.latestManifestId 回读；确认敏感动作按专岗分离，manual scopes 原样。仅 C000001/test 按 roles-plan 分阶段配置 test 的租户角色与精确手工范围，到账确认与核销不能对同一 actor/同笔业务绕过 D-02。重签按既有内部 POST `/api/platform/internal/tenants/C000001/bundles`、body `{"environment":"test"}`，不签 prod/其他租户；由已授权内部通道执行，不保存用户管理会话。回读新 test revision/签名/绑定与 hzy0 Console 同步，finance:admin/manager global、viewer 无默认、test 专岗动作及其范围同源，并核对非目标已签制品 hash/revision/targets 不变。

## APF 容器备份续行中止（2026-10-03，凭据文件权限门禁）

按授权将 `database.sh` 做最小适配：新增可选 `APF_MYSQL_CONTAINER=hzy-platform-dev-mysql` 精确白名单，mysqlq/dumpq 通过 `docker exec -i` 使用容器 `/usr/bin/mysql`、`/usr/bin/mysqldump`，非容器路径保留。密码从容器内 MYSQL_ROOT_PASSWORD_FILE 读取，只进入目标客户端环境，不进入宿主 argv/日志；入口要求源秘密文件权限为 400/600。迁移 SQL 仍由 mysqlq 标准输入进入原固定库。bash -n 与候选门禁/角色测试 6/6 通过，未提交。

新 attempt `/wiztek/hzy-test/backups/apf-platform-930c5ede-20261003b/`（0700），已保存 PM2 快照、rollback.config、旧 .output 包与原 PM2 dump；记录原库表计数/校验和及对象摘要。候选 .output 正文文件 hash 全部匹配；仅清理解包额外产生的 1061 个 macOS `._*` 元数据文件，不改固定产物正文。

停止原因：容器有两个客户端，MYSQL_ROOT_PASSWORD_FILE 可读，但其实际文件权限为 **644**，不满足本次批准的 0600 文件条件；凭据安全门禁在运行 mysqldump 之前返回非零（私有 stderr 为空，无认证/权限/选项错误）。因此加密文件不是有效备份，不可复用。未打印密码、token 或 DSN，未修改现有 secret 文件权限。

已恢复旧 hzy-platform-dev：online、cwd `/wiztek/hzy-test/platform-release-38f8a20b/platform`、health 200。其他 PM2 PID/status 与本轮原快照一致。临时宿主 defaults 文件已删除，失败 encrypted 文件保持 0600/私有目录，仅作失败制品。

本机恢复验证未开始，event_scheduler 原 ON 未改变；未创建恢复库、未迁移、未切新版、未导入清单/分配角色/重签。后续建议在容器内用 umask 077 生成临时 0600 客户端文件（从既有 secret 读取，避免修改挂载源文件），备份/迁移后 trap 删除；需按本次停止规则由协调者确认续行，不自动放宽源文件权限门禁。仍停在第 5 步前，未提交、未推送。

## APF source_type 迁移与固定候选切换完成（2026-10-03，停在第 5 步前）

授权：用户批准 Platform 发布与第 6 步，随后拆分：本代理只执行快照、备份恢复验证、迁移、切换和只读回读；清单导入/角色配置/test 重签由协调者执行。固定产物 930c5ede，不包含主工作区并行改动。没有执行第 5～7 步，没有重签生产/其他租户、没有改 runtime channel。

### 执行结果与制品

- 候选 `/wiztek/hzy-test/platform-release-930c5ede/platform`，Node 24.18.0；原候选 `/wiztek/hzy-test/platform-release-38f8a20b/platform` 保留。
- 成功 attempt `/wiztek/hzy-test/backups/apf-platform-930c5ede-20261003c/`（0700）；PM2 快照、原配置、旧 .output 包、原 PM2 dump、库摘要、加密备份、恢复回执和切换回执保存在私有目录。密码/策略正文未进入终端或本文。
- 四项源/产物/补充包/artifact manifest SHA256 与执行清单一致；解包产生的 1061 个 macOS `._*` 元数据已清理，所有产物正文文件与固定整树 manifest 一致。入口 hash 仍只是 Nitro loader，版本以完整树核验为准。
- 加密备份 `platform-before.sql.enc`，48,243,840 bytes，SHA256 `7dc73f87e617e7f7cdcbe441532dbe276a848ad8328bcb7d33b57055d9fe7041`。转储参数包含 single-transaction/routines/events/triggers/hex-blob（以及 no-tablespaces、set-gtid-purged=OFF、column-statistics=0）。成功备份来自 owning Docker MySQL，不复用前次失败文件。
- 本机私有副本 `/Users/gavinzhou/.local/state/huizhi-yun/platform-apf-930c5ede-20261003/`；使用本机管理员连接生成临时 0600 defaults，唯一临时库恢复成功，104 张 base table 的行数和逻辑 CHECKSUM 全部一致，view/routine/event/trigger 对象清单一致。临时库已删除，本机 defaults 与明文转储已删除并回读确认。
- 恢复期间按授权临时将本机 event_scheduler OFF；完成删除临时库后恢复 ON，并再次回读 ON。原信息架构无事件；没有改变其他 MySQL 全局变量或 hzy0 数据。
- source_type 迁移与 Verify 均 PASS：NOT NULL、默认 manual，非法默认角色/来源关联计数 0。**现场 platform_app_role_scopes 原来为 0 行，迁移后仍为 0 行**，因此“原行全部 manual”是空集条件；未生成默认范围，Finance 范围需等第 5 步导入。
- 切换成功，hzy-platform-dev online；其他 PM2 PID/status 与本轮快照一致，hzy-console-test 原 stopped 保持 stopped。PM2 dump 尚未持久化，切换回执明确 persisted=false；第 5～7 步全部验收后需只更新本目标的持久化启动定义，不直接 pm2 save 捕获其他状态。
- 原 scope 行（去除新增 source_type 后）、推荐角色行、全部 policy_bundles 行摘要与停服前完全一致。Finance/Altoc/People 当前最新 manifest 均不含 defaultScopes；新版启动没有改变现有权限/范围或签名制品。省略字段的兼容语义另有固定候选 Platform 364/364 测试证据。
- 本机与 `https://hzy.wiztek.cn/api/health` 连续三轮均 200；匿名 `/api/platform/ops/applications` 返回 401。未保存管理会话，没有读数据库中的用户 session 来调用管理 API。

### 容器客户端最小适配与凭据清理

`database.sh` 保留原宿主客户端分支，新增精确 `APF_MYSQL_CONTAINER=hzy-platform-dev-mysql` 分支；mysqlq/dumpq 复用新 `container-client.sh`。后者在容器内 umask 077 + mktemp 生成 0600 defaults，内容只从容器现有凭据文件流入，不进入宿主 argv；mysql/mysqldump 完成后立即删除并确认不存在，异常用 trap 清理。原挂载秘密文件权限 **644 保持不变**：这是既有权限风险，未授权修改，本轮不处置。成功后只读确认容器临时文件数量为 0、临时宿主 defaults 不存在、原文件仍 644。

两个 shell 语法检查与候选门禁/角色清单测试 6/6 通过；备份/迁移真实执行已验证该分支。本机恢复采用独立验证脚本与唯一库名，替代原 backup 子命令同名恢复库部分；没有通过 DDL 脚本绕过正式迁移步骤。所有代码改动可审查，未提交或推送。

### 第 5～7 步交协调者执行

1. **清单导入**：使用用户已登录的 Platform 管理界面，按 People→Altoc→Finance 逐份预览固定 `930c5ede7083664353acf871b3e8ef4173c45afd` 的 `<app>/app.manifest.json`，审阅敏感动作撤权/专岗增权/defaultScopes 后导入。确认应用 latestManifestId 指向导入结果；不要只用 isLatest，因为它同时涵盖 latest release 的 manifest。只导入技术目录，不自动升级客户部署/Runtime channel。Finance admin/manager global、expense_submitter expenses/self、viewer []；仅替换 manifest_default，manual 保留。
2. **角色配置**：只 C000001 的 test，依据 roles-plan.json 的阶段配置与合并来源回读；invoice_issuer、审批专岗、cashier、reconciliation_operator 不借 admin 范围。专岗无 defaultScopes 时配精确租户 custom/manual scope，既有无关配置保留。原 tenant-admin scopes 路由只覆盖 Console，Finance 等范围使用治理 ops 路径并核验精确租户角色 ID；不改共享 app-role 默认范围。到账确认与核销同笔业务不能是同一实际 UID；切角色不清除旧 actor。zhou 作为制单/申请主体，test 承接独立动作；同人反例仍须拒绝。按前述执行清单核验 static conflict/holder 限制，阶段变更留行 ID 与撤销路径。
3. **只重签 test**：使用现有内部授权通道，POST `/api/platform/internal/tenants/C000001/bundles`，body `{"environment":"test","includePayload":false}`。该路由复用正式 deterministic generator；不指定历史 revision、不签 prod/其他租户，不把内部令牌写 argv/日志，不保存用户管理会话。
4. **回读**：hzy0 Console 同步到新 test 包，签名/tenant/environment/deployment/targets 与 revision/hash 正确；finance:admin/manager 只在已声明精确动作上得到 global，viewer 无默认，submitter self；test 每个阶段角色/动作/范围同源。核对三域旧 admin 敏感动作已撤，People standard_costs/view 与 Finance 管理联合工资规则未放宽。比较非目标已签制品 hash/revision/targets 不变，并完成职责反例；原 0 行 scopes 不能被当作此次导入已生效的证据。
5. **最终持久化与回滚**：通过全部回读后，只持久化 hzy-platform-dev 的候选启动定义，保留其他 PM2 定义与旧 dump。当前步骤之前可按私有 rollback.config 恢复旧代码、保留兼容列；第 5 步之后若要回滚，先围栏治理写入、恢复目录/撤销本批角色与 owned defaults，以更高 test revision 撤权并同步，验证后才恢复旧代码。不能恢复整个旧库降低已签水位；列删除需单独确认。

完成本次授权部分，服务健康，等待第 5 步；没有导入 manifest、分配角色或生成新 test bundle。未提交、未推送。

## APF 发布第 5–7 步（2026-10-03 21:20–21:29 CST，协调者在用户登录的 Platform 管理界面执行）

- 第 5 步清单导入：固定提交 930c5ede，GitLab 预览返回内容与本地提交逐份规范化 JSON SHA-256 一致（people 7794054d…、altoc 568165e1…、finance a52cc3b8…）。按 People→Altoc→Finance 导入：people 版本 v0.1.7-dev.930c5ede → manifest 55（10 角色/88 权限）；altoc v0.1.2-dev.930c5ede → manifest 56（6/78）；finance v0.3.2-dev.930c5ede → manifest 57（13/75）。三应用 latestManifestId 回读一致。
- 重签 test（仅 C000001、environment=test）：bundle 41 / rev 40 / pv_test_20261003212219_0033。hzy0 回读：finance invoices/expenses/receipts 列表由 403 变 200；altoc lead assign/convert/disqualify/activity、opportunity assign/transition/activity、contract activate-delivery 生效；zhouguangying 在三域已无 approve/issue/confirm。
- 第 6 步（用户批准“含第6步”）：租户控制台创建 C000001 custom 角色 id=132 `apf_sod_test_20261003`，映射 finance:invoice_issuer、finance:invoice_approver、finance:expense_approver、altoc:contract_approver、people:approver；ops 写 29 条精确 tenant:global manual 范围（来自 roles-plan.json 阶段 1）；subject-role id=35 分配给 test（temporary，到期 2026-10-10 23:59:59）。出纳与核销按阶段另行配置，未叠加。
- 再重签 test：bundle 42 / rev 41 / pv_test_20261003212827_0034。生产未重签，生产 policy-sync 与入口回读正常。
- 撤销路径：DELETE tenant-admin subject-roles/35；PUT ops roles/132/scopes 为 []；角色 132 置 disabled；再重签 test。
