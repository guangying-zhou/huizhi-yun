# 本机 C000001 配套上线执行单

状态：**仅供逐项审批；未执行**。目标是本机 `hzy0` 与本机 C000001，既不是 C000001 云端预发，也不是 wiztek 生产。除保留编号但 10/8 不执行的 N5 外，每个 `N` 是独立批准点；回复“批准 N”只授权该项列明的写入，不自动批准后续项或回滚写入。出现不符立即停在当前关口，保留证据，不运行后续命令。

依据：[LOCAL_RUNTIME](../deploy/test-env/LOCAL_RUNTIME.md)、[Workflow 部署说明](../workflow/docs/DEPLOYMENT.md)、[有界投递 Runbook](Workflow-Bounded-Delivery-Runbook.md)、[能力收敛批次](Enterprise-Host-Capability-Consolidation.md)、[round3 批 4 执行单](../.git/codex-report-round3.md)。已提交的批 3 manifest 删除涉及 Aims、Assets、Codocs 与派生 Enterprise manifest；此文档不批准发布。

## 0. 只读冻结与执行变量

执行者先记录 GitLab origin 上经审查的**同一干净提交**、当前 Runtime/Workflow/Host 版本和 SHA-256、PM2/LaunchAgent 配置、C000001/C000002 策略修订与信封摘要。候选必须含批 2 修正 `b9e73209`、批 3 `e87bf1e7`、Workflow 013/014 与版本栅栏 `63566e06`、部署说明修复 `77dee3cc`；若后续提交改变合同须重新审查。当前读得的本机库名是 `hzy_console_test_local_20260910`、`hzy_workflow_test_local_20260925`、`hzy_enterprise_shadow_review_20260913`，绑定是 `C000001-test-enterprise/workflow-local/aims`；**执行时须从受保护 Runtime 配置重新核对**，不得靠本文件中的旧快照选库。

以下命令均从仓库根目录、**同一受控 shell** 按批准项执行；换 shell 时须从受保护回执重新载入 `STAMP`、`ROLL`、`KEY_PATH`、候选提交等变量，不猜测路径。`CONSOLE_CNF`、`WORKFLOW_CNF`、`AIMS_CNF` 必须分别指向已有、权限 `0600`、仅含对应库账号连接信息的 MySQL `--defaults-extra-file`；不得在命令行、回执或日志写密码。`mysql`/`mysqldump` 的该选项必须是第一个选项。尚无这三个受控配置文件时先按既有密钥保管流程准备并审查，**不得运行下面的写命令**。

```bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
RUNTIME_ROOT="$HOME/Library/Application Support/HuizhiYun/test-runtime"
PROFILE="$HOME/.config/huizhi-yun/hzy0/profile.json"
CONSOLE_DB=hzy_console_test_local_20260910
WORKFLOW_DB=hzy_workflow_test_local_20260925
AIMS_DB=hzy_enterprise_shadow_review_20260913
: "${CONSOLE_CNF:?0600 Console MySQL defaults file required}"
: "${WORKFLOW_CNF:?0600 Workflow MySQL defaults file required}"
: "${AIMS_CNF:?0600 Aims MySQL defaults file required}"
test "$(stat -f %Lp "$CONSOLE_CNF")" = 600
test "$(stat -f %Lp "$WORKFLOW_CNF")" = 600
test "$(stat -f %Lp "$AIMS_CNF")" = 600
git -C "$ROOT" status --short
node "$ROOT/deploy/test-env/local-enterprise.mjs" status --profile "$PROFILE"
curl -4 -fsS http://127.0.0.1:18084/runtime/health
```

上述 `git status` 可以显示其他代理未提交文件；这些文件**不得**进入候选。冻结提交后只在独立 worktree 构建。核对三个数据库、租户和部署绑定、Host 实际 Runtime audience=`data-runtime`，任一不同即停并修订执行单。观察写入前基线：grant 行 ID/状态/绑定；Workflow 三类 outbox pending、attempt、version 与 abandoned 数；Aims integration operation 水位；四项调度 owner/generation。只读输出仅保留计数、ID 与机器码，不保留 token、正文、密文或凭据。

## N1：加密备份三库与回滚制品

**批准点 N1**：批准对本机 Console 的 `service_client_grants` 表、Workflow 库、Aims 统一库创建加密备份；不批准任何业务写入。前置：0 节通过、备份路径和受控 MySQL 配置已经核对、三库能一致读取。使用每次新建的 `ROLL` 目录；目录 `0700`，密文及独立口令文件 `0600`，口令不进 argv。不得复用旧备份或覆盖文件。

```bash
umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ROLL="$RUNTIME_ROOT/database-backup/local-c000001-rollout-$STAMP"
mkdir -m 700 "$ROLL"
mkdir -p -m 700 "$RUNTIME_ROOT/backup-keys"
KEY_PATH="$RUNTIME_ROOT/backup-keys/local-c000001-rollout-$STAMP.pass"
openssl rand -hex 32 > "$KEY_PATH"
chmod 600 "$KEY_PATH"
mysqldump --defaults-extra-file="$CONSOLE_CNF" --single-transaction --quick --no-tablespaces "$CONSOLE_DB" service_client_grants \
  | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_PATH" -out "$ROLL/service_client_grants.sql.gz.enc"
mysqldump --defaults-extra-file="$WORKFLOW_CNF" --single-transaction --quick --routines --triggers --events --no-tablespaces "$WORKFLOW_DB" \
  | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_PATH" -out "$ROLL/workflow.sql.gz.enc"
mysqldump --defaults-extra-file="$AIMS_CNF" --single-transaction --quick --routines --triggers --events --no-tablespaces "$AIMS_DB" \
  | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_PATH" -out "$ROLL/aims.sql.gz.enc"
for name in service_client_grants workflow aims; do
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KEY_PATH" -in "$ROLL/$name.sql.gz.enc" | gzip -t
  shasum -a 256 "$ROLL/$name.sql.gz.enc"
done
```

**验证**：三个 decrypt+gzip 检查退出 0、密文哈希与表/行数基线留存，文件权限合格。密文 SHA-256 本身不能替代解密自检。**回滚**：尚未写库时无需恢复；后续只按具体受影响行或 Workflow DDL 的受控恢复计划使用备份，绝不盲目覆盖整个 Aims/Console 现库。013/014 是非事务 DDL，执行前另记录 `SELECT VERSION()`、隔离副本每条 ALTER 的实际 ALGORITHM（INSTANT/INPLACE/COPY）和耗时；若锁表时间不满足维护窗口即停。

## N2：v2.27 五域授权与真实使用

**批准点 N2**：只给 `enterprise.runtime`、`audience=data-runtime` 安装 `aims/assets/codocs/altoc/console:enterprise-host:execute` 五条 C000001/C000001-test-enterprise 绑定 grant。前置：N1 已自检；`enterprise.runtime` 凭据 active；写前查询五个 qualified 物理 `(resource_code, action)` 的现状，若存在 revoked、冲突或其他 audience 请求即停，不运行 seed。

```bash
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --show-warnings \
  < console/docs/sql/Console-SQL-Seed-v2.27-enterprise-host-domain-grants.sql
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --batch \
  < console/docs/sql/Console-SQL-Verify-v2.27-enterprise-host-domain-grants.sql
```

**验证**：verify 恰五个域、每行 `client_status=active`、`credential_status=active`、`exact_rows=1`、`active_exact_rows=1`；重新执行 seed 时新增 0；备份中旧行逐字段不变。用 `node deploy/test-env/probe-c000001-rollout-service-tokens.mjs --issue-all "$PROFILE"` 的真实 `enterprise.runtime` 客户端对五个语义 scope 分别请求 `aud=data-runtime`，签发均 200 且内存中的 claims 精确。这个 helper 同时探测 N3/N4 的 8 组调度 scope，因此在 N2/N3/N4 都就绪后统一运行；只输出 scope、audience、HTTP 状态，不输出令牌。五域**使用时** 200 与错 audience/跨域 403 探测要在 N7 新 Runtime 已切换后各调用一条已登记只读路由；旧 Runtime 仍以旧精确 capability 认证，不应把切换前的调用拒绝误判为 N2 失败。**回滚**：v2.28 前可保留这五行等待修复；若要撤销，只按此次新 ID 经单独批准置 revoked，不能删行或复活旧 revoked 行。

## N3：v2.29 Workflow 调度授权

**批准点 N3**：为 `workflow.runtime` 的 `workflow:integration_operation:execute` 仅在 `data-runtime`、`tenant-runtime` 两 audience 安装精确行。前置：N1、凭据与 `C000001-test-workflow-local` 绑定核对；旧物理行如 revoked/冲突须先停。新 Worker **不得**先请求新 scope。

```bash
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --show-warnings \
  < console/docs/sql/Console-SQL-Seed-v2.29-workflow-integration-operation-grants.sql
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --batch \
  < console/docs/sql/Console-SQL-Verify-v2.29-workflow-integration-operation-grants.sql
```

**验证**：两行各 `exact_rows=active_exact_rows=1`、client/credential active、tenant/deployment/audience/semanticScope/source 精确。分别用真实 `workflow.runtime` 取得两 audience 的 scope 令牌；受信、**空队列**的 claim/诊断使用探测在 N7 新 Runtime 就绪、恢复真实投递前进行，要求认证接受且领取 0，不得让探测投递真实 effect。403/503 即停。**回滚**：旧 Runtime/Worker 尚在时不撤旧授权；新行若需停用，先成对回滚 Runtime/Worker，再按新 ID 精确 revoke。

## N4：v2.31 Aims 三 owner 授权

**批准点 N4**：`aims.runtime` 的 `aims:integration_operation:execute`、`aims:notifications-due:execute`、`aims:milestone-rollover:execute`，双 audience 最多六条，绑定 `C000001/C000001-test-aims`。前置：N1；先**只读运行 verify** 并按每行 `active_exact_rows`、`active_binding_only_missing_rows`、`revoked_rows` 分类：仅缺行才可 seed；旧 active 行只缺绑定须另审精确 binding-only repair；revoked 行不得借 repair 复活；绑定冲突/重复也停。

```bash
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --batch \
  < console/docs/sql/Console-SQL-Verify-v2.31-aims-unified-scheduler-grants.sql
# 仅当六项差集均为“缺物理行”，或已有完整绑定行且无需修补时：
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --show-warnings \
  < console/docs/sql/Console-SQL-Seed-v2.31-aims-unified-scheduler-grants.sql
mysql --defaults-extra-file="$CONSOLE_CNF" --database="$CONSOLE_DB" --batch \
  < console/docs/sql/Console-SQL-Verify-v2.31-aims-unified-scheduler-grants.sql
```

**验证**：六组合逐一 `active_exact_rows=1`、`revoked_rows=0`、`active_binding_only_missing_rows=0`，身份/来源绑定正确；实际插入数只能等于写前差集，重复 seed 0。三项 × 双 audience 原始 scope 真实签发 200；受信空队列 wake/owner 使用探测在 N7 新 Runtime 就绪后、恢复真实投递前进行，要求认证接受、认领 0，不能触发真实 due/rollover 写入。**回滚**：新插入行只按其 ID 独立停用；既有旧行保持原状。若需要修旧绑定或处理 revoked，先形成另一份 before/after SQL 和单独批准，不能在 N4 内暗修。

## N5：10/8 不登记维护身份

`workflow.maintenance`、v2.30 两条恢复 grant 和任何维护凭据**均不在本次本机/10 月 8 日上线执行范围**；N5 保留编号但不申请批准，也不是 N7 的前置条件。若上线后出现 abandoned，按[Workflow 有界投递 Runbook](Workflow-Bounded-Delivery-Runbook.md) 另次取得用户对具体 effect 与三阶段写入的批准。受审的 [workflow-breakglass 工具](../data-runtime/cmd/workflow-breakglass/main.go)（`9957ad71`）已能在目标 Runtime 主机上按 prepare→activate→retire 登记 disabled 身份、建立短期凭据并吊销；工具**尚未在任何环境执行**。单独的 v2.30 seed 仍只准备 grant，不能创建身份或签发凭据；此处不以 SQL 直插或 Runtime bootstrap 代替受审工具。10/8 后仍需把破窗流程进一步收敛为凭据只在同一进程内存中使用。

## N6：Workflow 013 → verify → 014 → verify

**批准点 N6**：只改本机 Workflow 库。前置：N1 的 Workflow 密文备份已解密检查；MySQL 版本/隔离演练中各 ALTER 的实际算法及耗时已记录；停止 Workflow 写入与请求内即时 effects，暂停 Gateway cron 和手动 drain，核对没有在途投递；N3 授权已就绪。013/014 均非事务 DDL。按 [Workflow 部署说明](../workflow/docs/DEPLOYMENT.md) 的原始逐项命令执行，以下命令以本机库与受控配置代入，同一 shell 必须启用 pipefail：

```bash
set -o pipefail
mysql --defaults-extra-file="$WORKFLOW_CNF" --database="$WORKFLOW_DB" --show-warnings \
  < workflow/docs/migrations/013_bounded_delivery_outbox.sql || exit 1
mysql --defaults-extra-file="$WORKFLOW_CNF" --database="$WORKFLOW_DB" --show-warnings --batch --skip-column-names \
  < workflow/docs/migrations/013_bounded_delivery_outbox_verify.sql \
  | awk -v expected=4 '{ print; count++; if ($0 != "PASS") failed=1 } END { if (failed || count != expected) exit 1 }' || exit 1
mysql --defaults-extra-file="$WORKFLOW_CNF" --database="$WORKFLOW_DB" --show-warnings \
  < workflow/docs/migrations/014_delivery_recovery_attribution.sql || exit 1
mysql --defaults-extra-file="$WORKFLOW_CNF" --database="$WORKFLOW_DB" --show-warnings --batch --skip-column-names \
  < workflow/docs/migrations/014_delivery_recovery_attribution_verify.sql \
  | awk -v expected=1 '{ print; count++; if ($0 != "PASS") failed=1 } END { if (failed || count != expected) exit 1 }' || exit 1
```

**验证**：013 四条、014 一条全为 PASS；同 instance 依赖列/索引、version_no、abandoned、审计表及三种 outbox 旧行摘要均符合迁移前基线。任何 SQL 非零、FAIL、行数错误都保持投递暂停，不能启动新 Worker。**回滚**：停止本机 Runtime/Workflow；根据已执行到的 DDL 精确恢复 N1 的 Workflow 库备份（需先保护失败现场并另行批准恢复），而不是假设事务自动回滚；按旧 Worker 查询仅取 pending/failed 的兼容证明选择成对旧版。Aims 库本步不写；其 N1 备份用于后续切换意外时的证据与受控恢复。

## N7：同窗切换 Runtime、Workflow、Host

**批准点 N7**：从同一受审干净提交构建并切换本机 Runtime、`hzy0-workflow` 与 Host `hzy0-enterprise`，必要时只重启 `hzy0-gateway`；不部署云端。前置：N2/N3/N4/N6 均通过；N5 按本次范围跳过；仍暂停请求内、cron、手动投递；保留旧二进制、Runtime config、LaunchAgent plist、PM2 当前配置与进程来源。Runtime 与 Workflow **必须在同一维护窗口成对切换**：旧 Worker 不传 `expectedEffectVersion`，遇新 Runtime 会 400；不能只滚其中一方或提前恢复投递。

```bash
COMMIT="<经审查的完整提交 SHA>"
BUILD_DIR="/tmp/hzy-local-c000001-rollout-$STAMP"
git worktree add --detach "$BUILD_DIR" "$COMMIT"
test -z "$(git -C "$BUILD_DIR" status --porcelain)"
(cd "$BUILD_DIR" && pnpm install --frozen-lockfile)
(cd "$BUILD_DIR/data-runtime" && go test ./...)
(cd "$BUILD_DIR/workflow" && pnpm test && pnpm typecheck && pnpm build)
(cd "$BUILD_DIR/enterprise" && pnpm test && pnpm typecheck && pnpm build)
(cd "$BUILD_DIR/data-runtime" && go run ./cmd/hzy-enterprise-verify-views --config "$RUNTIME_ROOT/config.json")
```

Runtime 构建采用比当前版本递增的 `VERSION`（执行前固定），并注入三个版本字段；输出必须在本次 `ROLL` 下，不能覆盖现用文件：

```bash
VERSION="<高于当前本机版本的已审版本>"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
(cd "$BUILD_DIR/data-runtime" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath \
  -ldflags "-X github.com/huizhi-yun/data-runtime/internal/version.Version=$VERSION -X github.com/huizhi-yun/data-runtime/internal/version.Commit=$COMMIT -X github.com/huizhi-yun/data-runtime/internal/version.BuiltAt=$BUILT_AT" \
  -o "$ROLL/hzy-data-runtime.candidate" ./cmd/hzy-data-runtime)
shasum -a 256 "$ROLL/hzy-data-runtime.candidate"
```

**固定 worktree 进程切换方案**：`local-enterprise.mjs restart` 只重启旧 cwd，不能切来源；`--mode node` 当前拒绝 `.output`。本次只切 `hzy0-workflow`、`hzy0-enterprise` 两个 PM2 dev 进程；`hzy0-gateway/console/aims/codocs-editor` 维持已验证的原来源。前置只读比较旧进程启动提交与候选在这些未切模块及 `deploy/test-env/local-enterprise/{gateway,console-egress,console-facade,run-process}.mjs` 的差异；只要有影响本次通路的差异就停止，另审扩展切换，不借热加载共享脏树。PM2 名称/cwd/script/args/Node 路径先从 `pm2 jlist` 只在内存核对，旧来源必须为 `$ROOT`，候选必须为 `$BUILD_DIR`；PM2 dump 含内部令牌，只在 N1 的受保护 `ROLL` 留加密副本。启动密钥仅从原 Gateway 的 PM2 环境读入本次 shell 内存，绝不打印或放入命令行参数。候选的 Workflow 凭据仍从 `$PROFILE` 邻接的受保护文件读取；Enterprise `publicPolicyTrust()` 所需的 Console **公钥配置**在原 worktree 的 ignored `deploy/test-env/.cloudflare-workers/console/secrets.json`，只把这个已有 owner-only 文件以符号链接挂进候选，绝不复制其内容或其它私有文件。候选若缺其它受保护文件则停下报告。下面的切换与回滚只在 **N7 另获批准且暂停投递** 后运行：

```bash
PM2_HOME="$(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1]));process.stdout.write(p.processManagement.pm2Home)' "$PROFILE")"
export PM2_HOME
umask 077
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),root=process.argv[1];for(const name of ["hzy0-workflow","hzy0-enterprise"]){const x=p.find(v=>v.name===name);if(!x||x.pm2_env?.pm_cwd!==root||x.pm2_env?.status!=="online")process.exit(1)}})' "$ROOT"
pm2 jlist | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KEY_PATH" -out "$ROLL/pm2-before.json.enc"
PUBLIC_TRUST="$ROOT/deploy/test-env/.cloudflare-workers/console/secrets.json"
test "$(stat -f %Lp "$PUBLIC_TRUST")" = 600
mkdir -p "$BUILD_DIR/deploy/test-env/.cloudflare-workers/console"
ln -s "$PUBLIC_TRUST" "$BUILD_DIR/deploy/test-env/.cloudflare-workers/console/secrets.json"
test -z "$(git -C "$BUILD_DIR" status --porcelain)"
HZY0_GATEWAY_INTERNAL_TOKEN="$(pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).find(p=>p.name==="hzy0-gateway");if(!x?.pm2_env?.HZY0_GATEWAY_INTERNAL_TOKEN)process.exit(1);process.stdout.write(x.pm2_env.HZY0_GATEWAY_INTERNAL_TOKEN)})')"
export HZY0_GATEWAY_INTERNAL_TOKEN
OLD_ROOT="$ROOT"
RUNTIME_BIN="$RUNTIME_ROOT/hzy-data-runtime"
RUNTIME_PLIST="$HOME/Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist"
cp -p "$RUNTIME_BIN" "$ROLL/hzy-data-runtime.before"
cp -p "$RUNTIME_ROOT/config.json" "$ROLL/config.json.before"
cp -p "$RUNTIME_PLIST" "$ROLL/cn.wiztek.hzy-test-runtime.plist.before"
HZY0_PROFILE_FILE="$PROFILE" HZY0_REPO_ROOT="$BUILD_DIR" HZY0_NODE_BIN="$(command -v node)" HZY0_MODE=dev \
  node -e 'const c=require(process.argv[1]);if(!c.apps.some(x=>x.name==="hzy0-workflow"&&x.cwd===process.env.HZY0_REPO_ROOT)||!c.apps.some(x=>x.name==="hzy0-enterprise"&&x.cwd===process.env.HZY0_REPO_ROOT))process.exit(1)' "$BUILD_DIR/deploy/test-env/local-enterprise/pm2.config.cjs"
pm2 delete hzy0-workflow hzy0-enterprise
install -m 700 "$ROLL/hzy-data-runtime.candidate" "$RUNTIME_BIN.next"
mv "$RUNTIME_BIN.next" "$RUNTIME_BIN"
launchctl kickstart -k "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
# 以 curl -4 本机/public health 与 version 核对新 Runtime；失败立即成对回滚。
HZY0_PROFILE_FILE="$PROFILE" HZY0_REPO_ROOT="$BUILD_DIR" HZY0_NODE_BIN="$(command -v node)" HZY0_MODE=dev \
  pm2 start "$BUILD_DIR/deploy/test-env/local-enterprise/pm2.config.cjs" --only hzy0-workflow,hzy0-enterprise
pm2 save
# 核对 pm2 jlist 中两者 cwd/pm_exec_path 已指向 BUILD_DIR，其它进程与备份完全一致；再做 N7 health/签发/页面冒烟。
```

失败时保持投递暂停，Host/Workflow 的旧来源只按**本机真实旧 root** 重建，不盲目恢复加密的旧 PM2 dump（它可能含更早的持久化条目）：

```bash
pm2 delete hzy0-workflow hzy0-enterprise
install -m 700 "$ROLL/hzy-data-runtime.before" "$RUNTIME_BIN.next"
mv "$RUNTIME_BIN.next" "$RUNTIME_BIN"
cp -p "$ROLL/config.json.before" "$RUNTIME_ROOT/config.json"
cp -p "$ROLL/cn.wiztek.hzy-test-runtime.plist.before" "$RUNTIME_PLIST"
launchctl kickstart -k "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
HZY0_PROFILE_FILE="$PROFILE" HZY0_REPO_ROOT="$OLD_ROOT" HZY0_NODE_BIN="$(command -v node)" HZY0_MODE=dev \
  pm2 start "$OLD_ROOT/deploy/test-env/local-enterprise/pm2.config.cjs" --only hzy0-workflow,hzy0-enterprise
pm2 save
pm2 jlist | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s),root=process.argv[1];for(const name of ["hzy0-workflow","hzy0-enterprise"]){const x=p.find(v=>v.name===name);if(!x||x.pm2_env?.pm_cwd!==root||x.pm2_env?.status!=="online")process.exit(1)}})' "$OLD_ROOT"
node "$OLD_ROOT/deploy/test-env/local-enterprise/smoke.mjs" --profile "$PROFILE"
unset HZY0_GATEWAY_INTERNAL_TOKEN
```

逐项核对旧 cwd/进程 health、Runtime 本机与公网旧版本，再由审批过的恢复流程重开投递。Runtime 候选仍须按 LOCAL_RUNTIME 携 LaunchAgent 全部环境启动探测到 `listening on 127.0.0.1:18084` 后才替换。

Runtime 已有的精确进程重启命令为：

```bash
launchctl kickstart -k "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
node deploy/test-env/local-enterprise.mjs status --profile "$PROFILE"
node deploy/test-env/local-enterprise/smoke.mjs --profile "$PROFILE"
```

**验证**：本机与公网 `curl -4` health 连续三对 200 且都为新版本，公网记录 UTC/状态/version/Cloudflare 边缘标志；匿名受保护路由 401；五域令牌使用、Aims/Workflow 精确调度签发/空队列使用、hzy0 登录导航和每域关键只读页均通过；三类 Workflow effect 用原幂等键各做一次受控投递/ack/fail 回归，无第二通知、无双 attempt。然后才恢复请求内投递与受信 drain；调度 owner/generation 或 Gateway cron 若未另获批准，不在此步启用。**回滚**：先重新暂停全部投递，成对恢复 Workflow 旧来源与 Runtime 旧二进制/config/plist，后恢复 Host 旧来源；用相同 health/签发/页面探测验证，再恢复旧调度。N6 schema 若已进入 abandoned 状态，旧版回滚前须核对旧查询只按 pending/failed 过滤；不得改库状态或重放新审批。回滚环境写入同样需要批准。

## N8：观察后 v2.28 撤旧精确 grant

**批准点 N8**：仅撤销 `enterprise.runtime` Host 用户委托旧精确 grant，不删行，不触碰 policy reader、notification publish、Workflow proxy、scheduler/worker 或其他 client。前置：N7 健康；用 Console 安全签发日志覆盖至少一个策略同步周期和一次正常 Host 巡检，按旧精确 scope/audience 统计请求次数必须为 **0**。出现任何旧请求即停并定位调用方。审过的逐 ID before/after 清单须包括 D2 真实存在的 `tenant-runtime` 行和 v2.26 ID `13227427/13227428`，同时排除五域新行及已 revoked 行。记录仅含 ID/scope/audience/状态/时间与计数。

v2.28 制品为 `console/docs/sql/Console-v2.28-enterprise-host-precise-scopes.json`（附录 A 的 172 个旧精确 scope）、Revoke/Verify SQL 和 `console/scripts/v228-enterprise-host-grants.mjs`。SQL **只允许由 helper 在同一事务、带临时 ID 表执行**，不可直接用 `mysql <文件`；helper 的 `--plan` 给出逐 ID before/after 与 reviewHash，`--apply` 会重读并锁定行、比较 reviewHash、只改 active→revoked，校验五域 grant 恰好五条且全 active；其余所有 grant（含可能尚未安装的调度行）按 ID 排序比较完整字段数量与 hash，漂移即 rollback。v2.28 不要求 v2.29/v2.31 先安装。2026-09-28 只读预览为 183 行（data-runtime 172、tenant-runtime 11），含 D2 两个 audience 的 `directory-self` 与 ID 13227427/28；这是准备证据，**不得作为执行日固定数量或 hash**。N8 先以 N1 备份核对现状和零旧请求，再把当日 plan 送审、取得 N8 批准，随后在同一提交运行：

```bash
node console/scripts/v228-enterprise-host-grants.mjs --plan > "$ROLL/v228-reviewed-plan.json"
# 审核逐 ID 清单，并将其中 reviewHash 填入已批准的回执；不可从未审文件自动取 hash。
node console/scripts/v228-enterprise-host-grants.mjs --apply '<经审查的64位reviewHash>'
# 再运行 --plan，targets 必须为 0；N2/N3/N4 的 verify 及真实探测仍须 200。
node console/scripts/v228-enterprise-host-grants.mjs --plan
node deploy/test-env/probe-c000001-rollout-service-tokens.mjs --issue-all "$PROFILE"
```

**验证**：逐 ID 仅 active→revoked，其他字段及清单外行不变；旧精确 scope 按实际 audience 真实签发 403，五域新 scope 及关键 Host 页面仍 200。**回滚顺序不可倒**：从 N1 备份只恢复本批撤销 ID 的原 active 状态并逐 ID verify、确认旧签发 200，**之后**才按 N7 成对回滚旧 Runtime/Worker/Host；绝不全表覆盖或复活原已 revoked 行。

## N9：开发 Platform 正式 release 与 C000001 策略同步

**批准点 N9**：独立控制面写入，**不能并入 N7/N8 的批准**。前置：N8 与健康复验通过；开发 Platform 员工会话有效；先对开发 Platform 的 `tenant_role_permissions`、`tenant_role_scopes`、`platform_app_role_permissions` 在**全部租户**按被删的 74 对 `(app_code, resource_code)` 只读聚合，三表必须各 0 行；非零即停，不能发布。重做开发 Platform 库加密备份与解密自检，记录 C000001/C000002 的旧 release、策略修订、签名信封 hash、目录与权益。生产同项 0 行核对是未来生产 release 的独立门禁，不用本机结论代替。

开发 Platform 主机上的数据库备份命令（先按进程绑定核对库名；`PLATFORM_CNF` 为主机上已有的 0600 MySQL defaults 文件，不能把路径或内容放进回执）：

```bash
set -euo pipefail
: "${PLATFORM_CNF:?0600 Platform MySQL defaults file required}"
test "$(stat -c %a "$PLATFORM_CNF")" = 600
umask 077
PLATFORM_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLATFORM_ROLL="/wiztek/hzy-test/backups/local-c000001-release-$PLATFORM_STAMP"
mkdir -m 700 "$PLATFORM_ROLL"
mkdir -p -m 700 /wiztek/hzy-test/backup-keys
PLATFORM_KEY="/wiztek/hzy-test/backup-keys/local-c000001-release-$PLATFORM_STAMP.pass"
openssl rand -hex 32 > "$PLATFORM_KEY"
chmod 600 "$PLATFORM_KEY"
mysqldump --defaults-extra-file="$PLATFORM_CNF" --single-transaction --quick --routines --triggers --events --no-tablespaces hzy_platform_dev \
  | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PLATFORM_KEY" -out "$PLATFORM_ROLL/hzy_platform_dev.sql.gz.enc"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PLATFORM_KEY" -in "$PLATFORM_ROLL/hzy_platform_dev.sql.gz.enc" | gzip -t
sha256sum "$PLATFORM_ROLL/hzy_platform_dev.sql.gz.enc"
```

冻结同一提交的 Enterprise release tag（`TAG` 命名与提交 SHA 在执行前写入回执，先查 GitLab 不重名），只推 GitLab origin：

```bash
TAG="<经审查且尚未存在的 enterprise/v... tag>"
git ls-remote --exit-code --tags origin "refs/tags/$TAG" && exit 1 || test "$?" -eq 2
git tag -a "$TAG" "$COMMIT" -m "C000001 local capability consolidation release"
git push origin "refs/tags/$TAG"
```

正式员工页面 `https://hzy.wiztek.cn/admin/applications/enterprise/releases` 按 **注册 tag/manifest → 审核 ready → 发布 latest** 逐步操作；派生 Aims/Assets/Codocs manifest 的资源删除按该 release 的真实组合清单核对。再经正式租户同步入口**只同步 C000001**，不直接改策略表或信封。页面入口/实际 tag 若与当前注册配置不符即停并重订步骤。

**验证**：release/tag/commit/manifest hash 与受审提交一致；C000001 新策略修订和验签信封不含被删 74 对资源，人员权限、五域签发、目录/权益模式保持预期；C000002 修订、信封 hash、目录、权益逐项等于写前基线。**回滚**：先停止进一步同步，按开发 Platform 正式 release/策略回切流程恢复旧 latest 与 C000001 已验签旧修订，再核两租户；不直接覆写 Platform 数据库。若正式 UI 不支持回切，先报选项，不能以全库恢复覆盖其它租户的新写入。

### N9 共用主机约束（2026-09-28 补充）

开发 Platform（`hzy-platform-dev`）与 `hzy-platform-prod` 在同一主机（`gitlab.wiztek.cn`）在线。执行 N9 前后必须：

1. 只读确认对外生产 Platform 实例（9/5 记录为 Cloudflare `https://huizhi.yun`）、本机 `hzy-platform-prod` 是否仍承载生产流量、两进程的 MySQL 实例/库名/账号。
2. 所有命令显式使用库名 `hzy_platform_dev`，账号仅限 dev 库，不用 root 或共享账号；加密备份只 dump `hzy_platform_dev`，禁止 `--all-databases`；执行前后回读生产库行数或 hash 摘要，证明未触碰。
3. 不 restart/reload 任何 PM2 进程，尤其 `hzy-platform-prod`；若发布需重启 dev，仅对核对过进程名与 cwd 的 `hzy-platform-dev` 执行。
4. 员工页面发布由用户操作（A）或经用户导入 dev 域 cookie 由 huizhiyun-fa 操作（B），只做 manifest release 与 C000001 策略同步，每步前后截图并先确认页面为 dev 环境。
5. 发布前复核孤儿权限门禁：dev 库 74 对资源三表仍为 0 行。

## 审批回复与可合并项

| 编号 | 写入对象 | 可以与哪些编号同一次**明示**批准 | 不得默认为已批准的后续动作 |
| --- | --- | --- | --- |
| N1 | 本机加密备份三库/表 | N2/N3/N4/N6 可作为同一维护窗口批准，但必须逐项点名 | SQL apply、进程切换 |
| N2 | 五域 grant | N3、N4 | v2.28 撤销 |
| N3 | Workflow scheduler grant | N4 | Workflow Worker 切换、cron/owner 登记 |
| N4 | Aims 三 owner grant | N3 | binding-only repair、revoked 复活、四 owner 激活 |
| N5 | 10/8 不执行；仅破窗另审 | 不申请本次批准 | 身份、grant、凭据、恢复命令 |
| N6 | Workflow 013/014 DDL | N7 可合为一个**明确写出暂停、成对切换与回滚**的维护窗口 | 任意未核算法的 DDL、默认恢复投递 |
| N7 | 本机 Runtime/Worker/Host 切换 | N6 | N8、Gateway cron/owner、云端发布 |
| N8 | 旧精确 grant 撤销 | 不建议与 N7 合并；须先观察 0 请求 | N9 Platform release |
| N9 | dev Platform release、仅 C000001 策略同步 | 不与 N8 合并 | C000002 或生产同步 |

本执行单仍缺的**执行前制品/裁定**：v2.28 helper/SQL 需 huizhiyun-fa 审查，N8 的逐 ID 计划必须在执行日重新生成并审；013/014 隔离库算法与锁时长须在维护前记录。任一缺失就在对应步骤停下。N5 已明确从本次计划移出，不阻断 N7；未来使用受审破窗工具仍须针对具体事件单独批准。C000001 独立测试 Gateway 五分钟 cron、四 owner registry/generation 登记和旧 owner 停用不在 N1–N9 中，须按[预发准备](Go-Live-C000001-Staging-Preparation.md)单独求批；此处不将“grant 已签发”误写为“scheduler 已启用”。

## 执行记录（2026-09-28，Claude 执行，用户逐项批准）

| 项 | 结果 |
| --- | --- |
| L1（N1） | 备份目录 `database-backup/local-c000001-rollout-20260928T113855Z`（0700），三份密文均解密+gzip 自检、以 `Dump completed` 结尾；Aims 172/172 表。Runtime 业务账号无 `SHOW EVENTS` 权限，Aims 改用 `--skip-events` 重做。 |
| L2（N2） | v2.27 新增 5 行（13227430–34），verify 5×1，重复 seed 新增 0。 |
| L3（N3） | v2.29 新增 2 行，verify 2×1。 |
| L4（N4） | 按 v2.31 verify 停止：legacy 529971/530061 无绑定无 semanticScope，直接补绑定会与 13227398 形成 `service_grant_policy_conflict`。改由 v2.32（`49d01978`，含 verify 与未执行回滚）替代，用户单独批准：写前再备份 grant 表（sha256 `ef81bc78…`），真实通道签发前后均 200；执行后 6 组合 ready、due 0 行、非目标行全字段 SHA 不变，表 573→575。 |
| L6（N6） | 临时库演练：MySQL 8.0.34，013 0.072s、014 0.049s。停 `hzy0-workflow` 暂停投递后执行 013→verify(4 PASS)→014→verify(1 PASS)；三类 outbox 行数/attempt 与基线一致，version_no=1，审计表空。 |
| L7（N7） | 候选 `49d01978`：Go 全量、Workflow 75/75、Enterprise 317 pass/1 skip、typecheck/build、verify-views 156/156。Runtime `0.3.275-test.c000001-rollout.1`（sha256 `be80ac84…`），带齐 LaunchAgent 环境启动探测 `listening on 127.0.0.1:18084` 后替换；旧 binary/config/plist 与 PM2 状态已存 ROLL。本机/公网 health 3×200 新版本，匿名与伪造 Bearer 401，smoke 7/7，严格签发探测 13/13（5 域、Workflow 与 Aims 调度双 audience 200，due 403）。 |
| 统一 root | 用户批准扩大切换：候选 worktree 移至 `~/orca/hzy-candidates/49d01978`（`/tmp` 为 `/private/tmp` 符号链接，PM2 cwd 与工具 realpath 不一致；且 `/tmp` 可能被清理），6 个 hzy0 进程全部以此为 root。受保护文件只挂链接不复制：gateway/、codocs/、console/secrets.json 为符号链接，aims/secrets.json 为硬链接（读取器 `O_NOFOLLOW`）。smoke、签发 13/13、`local-enterprise status` 与 Aims `--empty-probe`（200，claimed 0）均通过。回滚：停进程后按原 root `/Users/gavinzhou/orca/huizhiyun` 启动，Runtime 用 ROLL 中 `.before` 文件。 |
| 未完成 | Workflow 两条 9/26 遗留 pending（1 notification、1 actionable）保持原样，不作为新版本投递证据；新版本投递回归由浏览器验收中的新标记审批完成（huizhiyun-fa 执行）。N8/N9 未执行。 |

### 后续切换与回归（2026-09-28 下午）

| 项 | 结果 |
| --- | --- |
| 模板 1–3 乱码修复（用户批准） | 备份 `aims_project_template_versions.pre-repair.sql.gz.enc`；按 ISO-8859-1 反向还原（MySQL `latin1`=cp1252 对 C1 字符转 NULL，不可用），UNHEX+原文 SHA2 保护、单事务；3 行合法 JSON、名称与代码默认一致，其余 7 行不变。第 1、2 行保留旧 slug key `p-规划poc`（有意，同模板派生项目一致；统一 slug 另立迁移）。标记项目 266 `ZZTPLFIX20260928` 验证通过，登记为待清理测试数据。项目 262/265 及其他表旧测试 JSON 未修。 |
| 候选 `fa6d94e4`（用户批准） | Host 新建事务 accessible-departments、导航死链、过时测试；Runtime `0.3.276-test.c000001-rollout.2`。 |
| 候选 `509fa9d8`→`0f337d97`（用户批准） | 含 `e89b2a9f`（effect/drain 精确 scope 不加 audience 前缀）与 `c20183a7`（通知 Host 列表回退、计数器）；Runtime `0.3.277-test.c000001-rollout.3`。 |
| 审批回归 | 事项 398/实例 30：test 审批通过，398 completed。一次性 Workflow drain 后通知 26 → actionable 28 依序 delivered（v1→v2），audit ack 4 条，`checkpointTokenDenied.drain=0`。历史行（不作证据）：通知 25、actionable 27 亦 delivered。callback 28 `failed`、attempt 2、v3：本机 `verifiedLocalWorkflowCallbackHeaders` 仅接受用户请求经网关的受信上下文，调度 drain 不满足（本机 `consumeBusinessOutbox=false`，云端回调走 Service Binding 不经此校验）；业务结果正确（回调已在审批请求内送达），不再重试。回调重投只回放原回执的验证移到预发门禁 5 W3/W4。 |

**操作规程补充**：候选 worktree 执行 `pnpm install` 后不得再移动目录；pnpm 依赖状态检查会在进程启动时触发重装并与并发进程冲突（本次 Console 因此未能启动，停进程后干净重装恢复）。需要固定路径时，先在最终路径创建 worktree 再安装。

### 通知详情链路打通（2026-09-28 晚）

test 查看 Workflow 待办通知详情经四处修复后通过（用户浏览器确认）：本机 policy egress 放行详情 live revision 与 Console 的回环 Workflow 地址（`2b88c7f8`，本机专有）；Runtime 通知详情核验按 `workflow.read` 并固定 `workflow.runtime` 身份（`9bd80ef3`）；Workflow verifier 以签名 notification-detail 委托传递查看者、Runtime 拒绝无委托/错 purpose/服务主体（`a86f91b2`）；Foundation 委托不再要求 Console 与目标应用部署相同（`8b9c1a58`，自 7 月起影响所有经 verifier 的通知详情）。后三处影响生产，预发 W3/W4 须在云端真实打开一次。本机当前候选 `8b9c1a58`，Runtime `0.3.279-test.c000001-rollout.5`。

### N8 执行（2026-09-28，用户批准）

- 零旧请求证据：Console `auth_token_events` 不记 scope，改用 hzy0 console-egress 日志——L7 后 egress 对 `enterprise.runtime` 仅放行五域 scope，旧精确 scope 必在 allowlist 被拒并记 scope；分界后 `enterprise.runtime` 旧精确 scope 请求 0 次（另见 `aims.runtime` rollover 旧探测 2 次、due 按 D4 拒 28 次，均非 Host）。**局限**：egress 放行请求不记 scope，结论依赖放行名单已无旧 scope。期间多个 policy sync 周期与 huizhiyun-fa 的 Host 五域浏览器巡检（含写操作）。
- plan：183 行（data-runtime 172、tenant-runtime 11），含 13227427/28 与 enterprise.runtime 的 7008449（Host 手动 rollover），无 enterprise-host 行；reviewHash `77ceafce749129ae3ebf8797245ba7b49202e055ce099f2472c10c9dd792eeed`（huizhiyun-fa 审）。
- 写前加密备份 `service_client_grants.pre-v2.28.sql.gz.enc`（sha256 `ca6cb2ed…`）。首次 apply 因 helper 临时表继承库默认 `utf8mb4_0900_ai_ci` 与表 `unicode_ci` 冲突而整体回滚（重新 plan 仍 183 行、hash 不变）；修复 `ad1be99b`（临时表显式 unicode_ci，隔离测试改为与 Console 相同排序规则并可复现失败）后以同一 reviewHash apply 成功。
- 结果：183 行 active→revoked，不删行；重新 plan targets 0；五域 domainHash 不变；grant 状态 active 572→389、revoked 1→184；helper 事务内非目标行全字段 hash 校验通过。`aims.runtime` 调度 rollover 双 audience 行仍 active。签发探测 13/13、smoke 通过。旧精确 scope 的 Console 签发拒绝在本机被 egress 先拦，端到端反例放到预发门禁 2 U3。
- 回滚：从 pre-v2.28 备份逐 ID 恢复本批 183 行为 active（不复活原已 revoked 行），再核旧签发。

### N9 执行记录（2026-09-28 晚，用户批准“确认，选 B”）

- 共用主机核对：`https://hzy.wiztek.cn`（443）→ `hzy-platform-dev`（127.0.0.1:3011，库 `hzy_platform_dev` 在容器 `hzy-platform-dev-mysql`）；80 端口同名 vhost 走 Caddy 3180，不是 Platform；`hzy-platform-prod`（3010，`hzy_platform` 在独立实例）不在该域名后。全程仅用 dev 专用账号的临时 0600 defaults 文件，生产只读摘要用只读会话；结束后临时凭据文件均已删除。
- 写前门禁：74 对资源在 dev 三表全租户 0 行；只备份 `hzy_platform_dev`（103/103 表，解密自检通过，`local-c000001-release-20260928T155305Z`，sha256 `24db7fd5…`）。
- 基线：C000001 修订 27 / bundle 27 `pv_test_20260925173015_0027`、权益 revision 1；C000002 无修订/bundle/tenant_roles，套餐 starter；Enterprise latest release 37。生产摘要：releases 51（max 54）、修订 1 行 md5 `7cce33f3…`、bundles 98、registration max 60。
- Tag `enterprise/v0.3.279-test.c000001-rollout.5`（tag 对象 `94d4493a`，commit `8b9c1a58`，与 HEAD 间无 Enterprise/layer 代码差异），只推 GitLab。
- huizhiyun-fa 以用户导入的 dev 员工会话操作（用户在其会话直接确认，截图 n9-00…n9-14）：注册 → release 39、manifest 54（`sha256:9a042725…`，派生 aims 51/assets 52/codocs 53）→ ready → latest。员工页面无租户策略同步按钮；`/dashboard/deployments` 走 tenant-admin 会话不适用。经用户再次确认改用员工 ops API `POST /api/platform/ops/tenants/C000001/bundles {"environment":"test"}`（需 `ops.deployments/deploy`），仅调用一次。
- 结果：bundle 28 `pv_test_20260928165329_0028`，修订 27→28，7 个 C000001 test 部署目标。payload 按 (appCode, resourceCode) 对比：27→28 恰删 73 对（74 对中 `aims/admin-projects` 从未进入已发布 manifest），新增 0；roles/subjects/roleAssignments/权益/部署段逐段相同，rolePermissionGrants 784 不变。`syncInheritedSystemRoles` 仅更新 C000001 四个系统角色（121–124）的继承修订与哈希，行数 23 不变、无新增。
- 写后：C000002 无变化；生产摘要逐项等于写前，`hzy-platform-prod`/`hzy-platform-dev` pid 与重启次数不变；本机 Console `verified_policy_snapshots` 已为修订 28、renewal ok（旧 `policy_bundle_snapshots` 缓存仍为 27，本机主路径不读）；签发探测 13/13、smoke 7/7。
- 回滚：停止进一步同步，按 Platform 正式流程恢复 release 37 为 latest 并为 C000001 重新生成策略包；不以全库备份覆盖。

### 候选切换 cf4dd510（2026-09-28 晚，本机切换已获长期授权）

- 候选 `~/orca/hzy-candidates/cf4dd510`：在最终路径建 worktree 后 `pnpm install --frozen-lockfile`；受保护文件按原方式挂接（gateway/codocs 目录与 `console/secrets.json` 符号链接，`aims/secrets.json` 硬链接）。8b9c1a58..cf4dd510 无 migration/schema/grant 变更。
- 内容：G-10/G-11 自托管管线（hzy0 行为不变）、G-12 Host 共享 API `/enterprise/api/foundation/*` 与图标 `/enterprise/_nuxt_icon`、目录接口会话校验（`ca028360`）、完成面板不可提交原因（`79895186`）、回归修复 1–4/6/7。
- Runtime `0.3.280-test.c000001-rollout.6`（Commit cf4dd510，sha256 `193b49b0…`）：带齐 LaunchAgent 7 个变量启动探测到 `listening`；备份 `hzy-data-runtime.before-candidate6`、`config.json.before-candidate6`、plist 同名备份；PM2 状态加密备份 `pm2-before-candidate8.json.enc`（均在本 runbook ROLL 目录）。
- 验证：go test 全量、Enterprise 346/1 skip、Workflow 95、local-enterprise+topology 165、verify-views 156/156；Runtime 本机/公网 health 各 3×200 新版本、匿名与伪造 Bearer 401；6 进程 online；严格签发探测 13/13；Aims empty-probe 200 claimed 0；Host 新路由匿名 401。smoke 初次 6/7（脚本仍查旧图标路径 `/api/_nuxt_icon`，属 G-12 设计迁移），修正脚本后 7/7。
- 回滚：恢复 `.before-candidate6` 并 kickstart，从 `~/orca/hzy-candidates/8b9c1a58` 重启 6 个进程。

### Host 候选 d8efe1d2（2026-09-28，接手后按本机授权切换）

- `~/orca/hzy-candidates/d8efe1d2` 为固定路径 detached worktree，Node 24.18.0、`pnpm install --frozen-lockfile`；受保护文件沿用前述符号链接/硬链接方式。六个 hzy0 Node 进程切换至该目录，所有者、旧 cwd、脚本、参数和解释器在停止前逐项核对；写后均 online、重启数 0。
- 包含通知 Host 目标路径、本人历史工时读取、401/403/404 保真与提示、同一已验证身份范围内的 401 续期重试、完成面板上下文刷新和根头像代理修复。审查补充 `2f7fa3df` 拒绝通知编码首段及身份改变后的自动写重放。`d8efe1d2` 另含已审 K2-E 设计文档，本次没有启用离线切换。
- 切换前 PM2 配置加密备份并校验解密一致性：`~/.config/huizhi-yun/hzy0/backups/host-d8efe1d2-20260928T232917Z/`，密钥分开保存。仅切换六个已核对的 Node 进程；Runtime 保持 `0.3.280-test.c000001-rollout.6` / `cf4dd510`，未改数据库、grant、LaunchAgent 或 Runtime binary。
- 验证：Enterprise 352 PASS / 1 SKIP、Foundation 770 + 25 PASS、local-enterprise 146 PASS，Enterprise typecheck 与目标 lint 通过；候选 smoke 7/7、实际服务令牌签发探测 13/13（含 due 双 audience 预期 403）。1440px 浏览器工时页本人查询返回 200、月统计 2.9h，Network 显示新 worktree 发起请求。390px 首屏、个人资料、通知详情可打开；控制台仅见既有 Suspense 提示。
- **浏览器未收口**：390px 七列工时日历截断数字（现存布局问题，未在本批修改）；test 审批通知详情的“前往处理”已确认跳转至 `/enterprise/approvals/33`，已办任务正确显示不可用且无再次审批按钮；资料头像为占位图，未证明实际 OSS 图片读取。401 自动续期和完成面板刷新有自动化覆盖，现场交互仍待对应样本。不能把以上有限检查记为完整浏览器验收通过。
- 审批闭环：先只读核实两样本仍 pending，再使用用户在 Chrome 登录的 test 会话，经 Host 正式审批页和确认框完成 316 同意、317 驳回。回读 Workflow 实例 32=`approved`、33=`rejected`，动作 30/31 的 actor 均为 test；Aims 事项 316=`completed`、317=`in_progress`，完成申请 32/33 分别 approved/rejected。callback 30/31 均 success、attempts=1、version=2；notification 28/29 与 actionable 30/31 均 delivered、version=2；不需手动 drain。浏览器待办由 4 条变为 2 条，仅剩其他历史任务，未处理历史任务。发起人 zhouguangying 收到两条结果通知，驳回详情包含本次意见。
- 普通用户工时边界：test 工时页显示明确“无权查看工时”提示，提交按钮禁用；原工时动作/manifest/导航合同差异仍待独立核对，未擅自补角色或扩大授权。不能以管理员读取成功宣称普通成员工时回归全部通过。
- 回滚只需恢复六个 Node 进程至切换前 `~/orca/hzy-candidates/cf4dd510` 的原配置，保留现有 Runtime；本机会话辅助脚本 `.git/codex-switch-host-d8efe1d2.py rollback` 在执行前再次核对新目录进程所有权。不得据本段回滚其他环境或恢复整库。

### 候选成对切换 f9fa4f3f（2026-09-29，本机切换已获长期授权）

- 内容：工时 `timesheet:submit` 合同对齐（Host 写操作由不存在的 `edit` 改为 `submit`；本人清单 view 或 submit；整周提交 Runtime 逐项目校验范围/成员并整周原子回滚）、移动周历样式。Host 与 Runtime 合同同变，**必须成对切换/回滚**。d8efe1d2..f9fa4f3f 无 migration/schema/grant/manifest 变更。行为变化：仅有 `aims:admin`（无 member/dev/pm）的账号在 Host 不能再填工时（admin 不蕴含 submit）。
- 候选 `~/orca/hzy-candidates/f9fa4f3f`；Runtime `0.3.281-test.c000001-rollout.7`（sha256 `93376d85…`）。备份：`hzy-data-runtime.before-candidate7`（cf4dd510）、`config.json`/plist 同名备份、`pm2-before-candidate9.json.enc`。停机约 63 秒。
- 验证：go test 38 包 ok；6/6 online、0 重启；health 本机/公网各 3×200 新版本；匿名/伪造 Bearer 401；smoke 7/7；签发探测 13/13；verify-views 156/156；Aims empty-probe 200 claimed 0；Host 新路由匿名 401。
- 回滚（成对）：恢复 `.before-candidate7` 并 kickstart，再从 `~/orca/hzy-candidates/d8efe1d2` 重启 6 个进程。
- 已知告警：Runtime 日志 `grant_usage_touch_failed`（本机测试库缺 `last_used_at` 列，自 9/10 起已有，不影响签发），另行跟进。

### Host 候选切换 3062a7f1（2026-09-29，本机切换已获长期授权）

- 仅 Host 六进程（`f9fa4f3f..3062a7f1` 无 data-runtime 变更，Runtime 保持 0.3.281/f9fa4f3f）。内容：Host 业务错误机器码与固定文案、周历布局、目录头像解析、Codocs 预览缓存、周报汇总周次、Host access/id token HttpOnly（`public.oidcHttpOnlyTokens`）。
- 候选 `~/orca/hzy-candidates/3062a7f1`，受保护文件链接同前；PM2 加密备份 `pm2-before-candidate10.json.enc`；停机约 50 秒。
- 验证：6/6 online 0 重启；smoke 7/7；签发探测 13/13；Runtime health 不变；Host 新路由匿名 401。HttpOnly 由配置确认，真实登录响应待浏览器复验。
- 回滚：从 `~/orca/hzy-candidates/f9fa4f3f` 重启六进程（`.git/switch-host-3062a7f1.py rollback`，本机工具不入库）。
- 同日 dev Platform（均用户批准、写前加密备份）：撤销 wangzhuang、授予 zhouguangying C000001 test `project_director`（rev 29，备份 `role-director-20260929T004052Z`）；系统角色 `project_director` 应用角色映射对齐生产（进行中，备份 `sysrole-director-20260929T010706Z`）。

### 本机 Console grant：Host 查询项目总监持有人（2026-09-29，用户批准）

- 新增 `service_client_grants` id `13227443`：`enterprise.runtime`（service_client 52778）`console:authorization-role-holders` / `read`，scope `{"audience":"console","roleCodes":["project_director"],"tenantCode":"C000001","deploymentCode":"C000001-test-enterprise","semanticScope":"console:authorization-role-holders:read","source":"user-approved:host-weekly-governance-20260929"}`。用途：Host 周报治理按 Console 当前唯一项目总监注入标志（`e1c71460`/`b2fcc1ec`）。roleCodes 仅 `project_director`。
- **执行偏差（如实记录）**：写前加密备份因脚本取 `KEY_PATH` 为空而失败，但脚本未设失败即停，插入已执行。补偿证据：写前全表 575 行内容指纹 `d3382e17…`，写后非目标行指纹与之完全一致（其他行未变）；写后立即补做加密备份 `service_client_grants.post-role-holders-13227443.sql.gz.enc`（解密自检通过，sha256 `dde2cebb…`）。写前状态 = 当前表去掉 id 13227443；**回滚**：删除该行并复核指纹回到 `d3382e17…`。教训：后续所有写前备份一律 `set -euo pipefail` 且备份失败即中止，已写入切换任务约束。
- 生产：G-7 授权清单需补这一项（`enterprise.runtime` 外部服务 scope，roleCodes 仅 project_director），待 Codex 更新。

### 候选成对切换 b2fcc1ec（2026-09-29，本机切换已获长期授权）

- 内容：Host 周报治理按会话与 Console 项目总监持有人推导标志（`e1c71460`）、Runtime 登记 12 个周报治理动作的宿主注入标志（`b2fcc1ec`）、无 `timesheet:submit` 禁用填报入口（`ad50d3bd`）。无 migration/schema/manifest 变更；依赖同日本机 grant `13227443`。
- Runtime `0.3.282-test.c000001-rollout.8`（sha256 `71bf26cf…`）；备份 `hzy-data-runtime.before-candidate8`、config/plist 同名备份、`pm2-before-candidate11.json.enc`（每步确认成功后继续）。停机约 63 秒。
- 验证：go test 38 包；6/6 online 0 重启；health 本机/公网 3×200；匿名/伪造 401；smoke 7/7；签发探测 13/13；verify-views 156/156；Aims empty-probe 200 claimed 0；Host 新路由匿名 401。
- 回滚（成对）：恢复 `.before-candidate8` 并 kickstart，从 `~/orca/hzy-candidates/3062a7f1` 重启六进程（`.git/switch-b2fcc1ec.py rollback`，本机工具）。

### Host 候选切换 39fd82da（2026-09-29，本机切换已获长期授权）

- 仅 Host 六进程（含 gateway；`b2fcc1ec..39fd82da` 无 data-runtime 变更，Runtime 保持 0.3.282/b2fcc1ec）。内容：Host 从未提供 `/enterprise/api/auth/permissions`，浏览器权限快照一直为空（SPA HTML 被静默当作空快照）；现按页面所属模块提供 `?app=<module>` 快照（白名单 aims/assets/codocs/console/altoc，先校验会话，Console 失败 503），前端按模块缓存，非 JSON 显式报错；未登记 `/enterprise/api/**` 与 Host 根 `/api/**` 返回 JSON 404。
- 备份 `pm2-before-candidate12.json.enc`；停机约 62 秒。验证：6/6 online；smoke 7/7；签发探测 13/13；权限端点与通知摘要匿名 401 JSON。经网关的未登记 `/enterprise/*` 由网关 `unavailable` 返回纯文本 404（原有行为，非 SPA HTML）。
- 回滚：从 `~/orca/hzy-candidates/b2fcc1ec` 重启六进程（`.git/switch-host-39fd82da.py rollback`，本机工具）。

### 候选成对切换 fd5a0188（2026-09-29，本机切换已获长期授权）

- 内容：总监工作台周期缺失返回 409（`3010d783`）；Host 周报设置读写与页面（`fd5a0188`，沿用 `aims:enterprise-host:execute`，无新 grant/manifest）。
- Runtime `0.3.283-test.c000001-rollout.9`（sha256 `7648f629…`）；备份 `.before-candidate9`（binary/config/plist）、`pm2-before-candidate13.json.enc`，逐步核验。停机约 53 秒。
- 验证：go test 38 包；verify-views 156/156；6/6 online；health 本机/公网 3×200；匿名/伪造 401；smoke 7/7；签发探测 13/13；Aims empty-probe 200；权限端点与周报设置接口匿名 401 JSON。
- 回滚（成对）：`.git/switch-fd5a0188.py rollback`（恢复 `.before-candidate9` 并从 `~/orca/hzy-candidates/39fd82da` 重启六进程）。
- 上线运营前置更新（见迁移 runbook §9b）：切换后先由持 `weekly_reports:configure` 的管理员在 Host「周报设置」保存一次，再由项目总监每周生成当周周期，员工方可整周提交。

### W40 本机候选切换记录（2026-09-29，candidate15）

公司周报 Codocs 投递候选使用干净提交 `d35844e0`。Enterprise 的 Aims/Codocs 页面及 Foundation layer 从 **Enterprise 进程所在 worktree** 的同级路径解析，因此本机 `hzy0-enterprise`、`hzy0-gateway`、`hzy0-aims`、`hzy0-codocs-editor` 必须切到**同一个**候选目录；Runtime、Console、Workflow 此次不切。停旧进程前核对四个当前 cwd/PM2 状态、六份受保护配置的属主/0600/SHA-256，并完成 Console grant、Aims/Codocs 库及 PM2/profile 的加密备份与解密验证。私有执行脚本 `.git/candidate15-switch.py` 固定这四个进程、提交与本机路径，切换后要求 Enterprise 回环 `/_nuxt/@vite/client` 和新候选 Nuxt `entry.js` 均连续三次 200，且 Enterprise 日志连续 60 秒无 `full-reload`；任一不符自动回滚四进程/profile。匿名 SSR 因缺 Console facade 会话按设计返回 403，不应传递浏览器 Cookie 给本机探针；登录态 SSR 必须在受控浏览器单独核验。

第五次执行备份：`~/Library/Application Support/HuizhiYun/test-runtime/database-backup/candidate15-20260929T053035Z`，其中 `backup-receipt.json` 记录可解密的四项加密文件和切换前 PM2 cwd/PID。四进程已切到 `d35844e0`，入口双路径各三次 200、60 秒无 reload；周报页在新 Chrome 标签可加载。当前浏览器个人菜单为 `test`，故 W40 retry/drain 尚未执行；等待 `zhouguangying` 登录后再核对身份、正式 UI 重试一次与本地 drain 一次。若需回滚：`python3 .git/candidate15-switch.py rollback`，然后核对六进程 online、四个 cwd 恢复、profile 投递开关关闭和 W40 operation 未变化。

### B1 部门文档复制的 OSS 前置项（未批准，未执行）

Host 部门文档复制的暂存对象（`codocs/copy-staging/`）不再使用 OSS 生命周期规则：该规则已被 OSS 拒绝（与桶上现有 `codocs/` 前缀 Expiration 规则重叠，嵌套前缀不能共用同一动作类型）。应用不在成功后即时删除暂存（保证 24 小时内同键重放幂等），只靠维护脚本 `pnpm codocs:cleanup-copy-staging -- --client-module <file>` 清理超过 24 小时的对象：默认只读 dry-run，实际删除需 `--apply --confirm-delete-copy-staging`，只接受精确前缀 `codocs/copy-staging/`；工厂模块由运维在受控环境提供（示例 `scripts/cleanup-codocs-copy-staging.client.example.mjs`）。桶为测试与生产共用且启用版本控制，非当前版本按现有 `codocs/` 规则保留 30 天。执行 `--apply` 属独立环境写入，须获用户明确批准；无需再修改 OSS 生命周期配置。
