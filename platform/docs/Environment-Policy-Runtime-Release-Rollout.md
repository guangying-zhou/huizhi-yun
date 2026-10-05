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
