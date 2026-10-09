# hzy0 APF 安装与启用方案（待批准，不执行）

编写日期：2026-10-03；只读核对源码 HEAD `6176fa7f5d61b23a938916ea85b9d885e74a00b5`。本文是供用户批准、协调者执行的方案，不是执行回执。没有连接数据库、读取凭据正文或改变环境。审批后若 HEAD 变化须重新固定提交、清单和 reviewHash。

## 1. 目标、现状与执行前缺口

仅本机 C000001/test、部署 C000001-test-enterprise、Runtime 127.0.0.1:18084；统一库 `hzy_enterprise_shadow_review_20260913`，Console 库 `hzy_console_test_local_20260910`。不涉及云端、生产、GitHub、历史冷库迁移或 APF-14/16 待裁定功能。

`LOCAL_RUNTIME.md` 的 0.3.294 记录：基础 APF 53 表已经安装，Altoc/Finance unified 读写、People 只读，scheduler 关闭。该记录不是此次实时核验：本轮按要求未连接数据库。执行者必须先核对实际 mapping、表与回执。**不得重新执行基础 hzy-enterprise-add-apf，也不得重做当时旧 Altoc 手工删除。**

以下执行缺口必须先补齐/审查，不能凭本文跳过：

1. 增量 CLI 已补齐：`hzy-enterprise-add-apf --subset` 支持七个固定子集，真实停止、0600、reviewHash、baseline/generation与checkpoint复用原核心。先从审查提交构建；禁止直接 mysql < DDL。完整串联/逆序回滚已在隔离测试交付，不代表 hzy0 已执行。
2. Workflow owning 数据库/是否已并库须从受保护配置确认，不假定所有 Workflow seed 都写统一库。People 任职变更人工路由候选已补（§5）；入职provisioning/离职Directory lifecycle不是独立审批元组，不能seed出不存在的接收链。
3. 审批人、制单/经办、开票、付款确认和 test 账号权限须明确；不自动给 test 提权，不修改职责冲突规则。确认测试数据及恢复范围后才做浏览器写验收。
4. 增量安装 rollback 对非空/漂移严格拒绝。多段安装的 baseline 串联后，回滚必须逆序并逐段核验，不能承诺所有后来基线漂移都能自动恢复；验证实际失败条件，必要时停下转备份恢复方案。

## 2. 执行前备份与干净制品

每个变更步骤均执行以下门槛，记录时间、提交、文件摘要、审批引用和上一状态，不记录密码/token/私密正文：

- 告知维护窗口，冻结业务写入，确认没有他人部署/验收并行。
- 加密备份统一库、Console 库及真实 Workflow owning 库（如另库），包含数据/DDL/Registry；另备份 Runtime binary/config/LaunchAgent、hzy0 各进程启动定义及候选路径、Console clients/credentials/grants、Workflow routes/schemas/action defs。采用既有安全备份流程；本仓库未提供通用加密备份命令，沿用 0.3.294 的私有运行流程，禁止把 DSN/password 写 shell 参数或普通日志。
- 备份存 `~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-<UTC>/`，0700 目录、0600 文件。验证每份可解密并可在 /tmp 隔离副本恢复；只输出 PASS/摘要。私密档案备份按同等保密处理。
- 读取实际配置仅在私有进程内，核对 tenant/environment/deployment/database/generation/schemaVersion 与 mapping；输出布尔核验，不 `cat` 配置/plist/env。不使用生产迁移凭据。

获批后固定当前已审提交，从 GitLab 已有本地 ref 创建干净独立 worktree（不 reset 主工作区、不带未提交变更）：

```sh
approved_commit="${APF_APPROVED_COMMIT:?指定包含增量CLI与审批候选的已审提交}"
candidate=/Users/gavinzhou/orca/hzy-candidates/$approved_commit
git worktree add --detach "$candidate" "$approved_commit"
git -C "$candidate" status --porcelain
# 必须为空；新增版本号由协调者确认，不重用 0.3.294。
```

在该候选跑已提交模块的回归和隔离 MySQL，不连接 hzy0；记录结果。构建 Runtime：

```sh
cd "$candidate/data-runtime"
runtime_version=0.3.295-test.apf-enable.1 # 建议占位：执行前确认未被使用，否则另定唯一版本
built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
go build -trimpath -ldflags "-X github.com/huizhi-yun/data-runtime/internal/version.Version=$runtime_version -X github.com/huizhi-yun/data-runtime/internal/version.Commit=$approved_commit -X github.com/huizhi-yun/data-runtime/internal/version.BuiltAt=$built_at" -o "$private_artifacts/hzy-data-runtime" ./cmd/hzy-data-runtime
shasum -a 256 "$private_artifacts/hzy-data-runtime"
```

`private_artifacts` 由执行者预先创建为私有目录。模块 prepare/build 按 0.3.294 候选流程对全部组合模块执行，不只 Enterprise；Cloudflare 本机凭据由执行者以私有复制流程从原候选移入，不输出内容、不入 Git。本机 Node/依赖版本沿现用流程，不在此升级包。

## 3. 安装顺序、reviewHash、verify、rollback

停止并明确禁用 `cn.wiztek.hzy-test-runtime`，核验 launchctl disabled、服务未加载、18084 明确拒绝连接；权限错误/超时不算停止。停止/恢复命令采用实际当前用户域，执行者确认后使用：

```sh
launchctl bootout "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
launchctl disable "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
```

保留现有基础 binding（禁止删除 domains 伪装新安装）。每段先备份→隔离副本演练→plan 审查→apply/checkpoint→verify+VerifyReceipt→保存累计候选 mapping；直到全部安装完成才启用。增量候选由上一段累积 binding 派生，保持 generation/schemaVersion/其他域不变。

| 顺序 | 已提交候选/固定 manifest | mapping / installer 库入口 | 验证与 rollback 证据 |
| --- | --- | --- | --- |
| 0 | 既有 `apf_altoc.json`、`apf_finance.json`、`apf_people.json` 基础 53 表 | 只核验原安装 plan/receipt/mapping，不 apply | 原回执与当前累计扩展须分别核对，不能用基础严格清单去拒绝合法扩展 |
| 1 | `people/docs/apf_private_facts_incremental.sql`；`domaininstall/people_private.json` | WithPeoplePrivateFacts / ForPeoplePrivateFacts | APF09-PRIVATE-FACTS-INSTALL.md；逐段 Verify、VerifyReceipt；原 receipt Rollback |
| 2 | `people/docs/apf_onboarding_lifecycle_incremental.sql`；`people_facts.json` | WithPeopleFacts / ForPeopleFacts | employee/assignment/onboarding/offboarding 等事实映射；逐段 Verify、VerifyReceipt、Rollback |
| 3 | `altoc/docs/migrations/APF-B2-sales-install-candidate.sql`；`altoc_sales.json`（8 表） | WithAltocSales / ForAltocSales | APF-B2-sales-verify-candidate.sql；rollback-candidate.md + 原 receipt |
| 4 | `finance/docs/sql/APF11a-B3-install-candidate.sql`；`finance_b3.json`（7 表） | WithFinanceB3 / ForFinanceB3 | APF11a-B3-verify.sql、rollback-candidate.sql（审阅，不直接执行替代 receipt） |
| 5 | `finance/docs/apf13a_schema_candidate.sql`；`finance_13a.json` | WithFinance13a / ForFinance13a | sql/apf13a-verify-candidate.sql、rollback-candidate.sql |
| 6 | `finance/docs/apf13b_schema_candidate.sql`；`finance_13b.json`（付款申请 1 表） | WithFinance13b / ForFinance13b | sql/apf13b-verify-candidate.sql、rollback-candidate.sql |
| 7 | `altoc/docs/migrations/APF-B2-sales-stage-seed-candidate.sql` | 独立数据 seed；在 DDL 全完成且 receipt verify 后执行 | 核对阶段 code/模型、已有配置冲突即停；记录新增行，不覆盖人工配置 |

不存在另外一套“生命周期安装器”：它包含在 People facts 增量中。13b 配置/审计读取复用基础 Finance 字典表，不重复安装。07b 销售支持复用 B2 族，清单以固定 manifest 为准。B4/B5、APF-14/16 不安装。

**实际增量命令**（仅批准后执行，本轮不运行）：

```sh
cd "$candidate/data-runtime"
go build -o "$private_artifacts/hzy-enterprise-add-apf" ./cmd/hzy-enterprise-add-apf
# 每段都在真实停止状态下操作。第一段source是原已注册APF配置；
# 之后source是前一段verify通过的proposed.json，不修改active配置。
subset=people-private
stage="$private_artifacts/$subset"
mkdir -m 700 "$stage"
common=(--subset "$subset" --config "$previous_config0600" \
 --migration-db-config "$migration0600" \
 --proposed-config "$stage/proposed.json" --plan "$stage/plan.json")
"$private_artifacts/hzy-enterprise-add-apf" --mode plan "${common[@]}"
review=$(jq -er '.ReviewHash' "$stage/plan.json")
# 停在此处审查该段reviewHash，批准后再执行，不把读取hash当批准。
"$private_artifacts/hzy-enterprise-add-apf" --mode apply "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
"$private_artifacts/hzy-enterprise-add-apf" --mode verify "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
```

依次重复七段：`people-private`、`people-facts`、`altoc-sales-B2`、`finance-B3`、`finance-13a`、`finance-13b`、`finance-cost`。CLI仅这七种名称，不接受 arbitrary DDL/path/domain；增量不接受write模式参数，保留原binding模式。不能先plan七段再apply，因为baseline依赖前一段真实安装。每段单独审查hash、备份、checkpoint和verify。

Hash由实际安装器plan与完整source/candidate摘要、subset身份产生，SQL文件SHA不能替代。generation/schemaVersion/其它域保持；原plan/candidate/receipt不覆盖。

**逆序回滚命令**：以原段`common`（原source，不是最后累计config）和原reviewHash运行：

```sh
"$private_artifacts/hzy-enterprise-add-apf" --mode verify "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
"$private_artifacts/hzy-enterprise-add-apf" --mode rollback "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
```

按 finance-cost→finance-13b→finance-13a→finance-B3→altoc-sales-B2→people-facts→people-private，每次rollback后verify上一段剩余前缀，最后核对基础53表/原binding/旧域摘要。任何非空/漂移/外部FK/未checkpoint对象停止，不跳过拒绝、不自动恢复全库。已启用业务写入后另审恢复方案。

安装后回读：每段固定表/列/索引/FK/mapping 数量、既有 aims/assets 和 Registry 摘要、generation/schemaVersion、receipt 创建对象归属；应用 SQL verify 的结果须逐项通过。增量表有回执/审计/业务数据或 baseline 漂移时停止自动 rollback，禁止强删、禁 FK 或修改 receipt。

## 4. Console grant seed/verify（Console 库，含双 Runtime audience）

先备份 clients/credentials/grants，再 Verify/preflight；已有 revoked/inactive、重复、错部署或语义别名冲突立即停，不 UPDATE/删除复活、不创建凭据。人员 manifest 权限与 service grant 是两件事：通道 seed 不授予用户 edit/approve/admin。

按以下顺序，每项 seed 前后回读，只记录行 ID/绑定和差异摘要，不打印 scope 中任何敏感扩展或凭据：

| 顺序 | Seed / Verify 文件 | 参数/用途 |
| --- | --- | --- |
| 1 | `console/docs/sql/Console-SQL-{Seed,Verify}-v2.34-apf-channels.sql` | @apf_tenant=C000001、@apf_deployment=C000001-test-enterprise；**分两次** @apf_audience=data-runtime / tenant-runtime。每次三域×Host/scheduler/notification-detail＝9 精确 scope，双 audience 共 18 物理组合，已有行保持。scheduler grant 不等于调度启用 |
| 2 | `Console-SQL-{Seed,Verify}-v2.12-enterprise-workflow-proxy-grant.sql` | Enterprise→Workflow，audience=workflow、workflow:proxy；既有精确行先 verify |
| 3 | `Console-SQL-{Seed,Verify}-p1-enterprise-channels-candidate.sql` | **只执行审查提取的 workflow.runtime→enterprise:workflow-callback/execute 那一行**，参数 @p1_* 从保护配置绑定。不得 source 整个 seed 顺带安装 OSS/其他未批行；Verify 也需聚焦同一行 |
| 4 | `Console-SQL-{Seed,Verify}-apf09c2-enterprise-directory.sql` | @apf_tenant/@apf_deployment 同上；audience=console，4 项 directory reserve/provision/employment sync/offboarding disable。不把这四项复制成 Runtime 双 audience |

执行模板（只在批准窗口用，当前未运行）：

```sh
# defaults0600 为已存在且经审查的私有 MySQL defaults 文件，不提供密码参数。
# params0600 仅包含该步骤已批准的 SET @...，seed0600/verify0600 指固定或审查后的精确 SQL。
# 所有输出进入私有目录，协调者只提取无敏感摘要。
{ cat "$params0600"; cat "$verify0600"; } | mysql --defaults-extra-file="$defaults0600" --database=hzy_console_test_local_20260910 > "$private_artifacts/grants-before.txt"
{ cat "$params0600"; cat "$seed0600"; } | mysql --defaults-extra-file="$defaults0600" --database=hzy_console_test_local_20260910 > "$private_artifacts/grants-seed.txt"
{ cat "$params0600"; cat "$verify0600"; } | mysql --defaults-extra-file="$defaults0600" --database=hzy_console_test_local_20260910 > "$private_artifacts/grants-after.txt"
```

双 audience 是本次用户要求的两个实际 Runtime 组合，不扩到其它 audience；Workflow/Console 仍各自精确目的。实际签发检查 JWT 验签、issuer/aud、client/source_app、tenant/deployment、token_use、scope/有效期，仅记录状态/布尔结果；不输出 token。两 Runtime audience 各测九个单 scope与三域 Host 组合；错 audience/来源/部署拒绝。受信回调完整元组保持既有闭集，不增加 app 通配。

授权回滚：候选没有统一 APF 专用 grant rollback SQL，不伪称存在。执行前记录新插入行 ID 与摘要，协调者审查精确 ID 停用候选；仅本轮新增行、未被其它批准依赖的行可停用。既有行与 current credential 不变，不全表覆盖。无可审查回滚候选时停止该项 seed。

## 5. Workflow 人工定义（与 Console grant 分开）

必须备份真实 Workflow owning 库并核对当前 routes，再按顺序执行：

1. `altoc/docs/sql/APF12-Workflow-Seed-candidate.sql` / `APF12-Workflow-Verify.sql`：仅 altoc/quotation/approve、altoc/contract/approve；设置文件要求的 @apf12_reviewer_uid、@apf12_installer_uid（执行前逐字核对变量名）。已有 route 冲突先停，不覆盖。customer/approve 仍失败关闭。
2. `finance/docs/sql/apf11b-workflow-seed-candidate.sql` / `apf11b-workflow-verify-candidate.sql`：finance/invoices/request，@apf_invoice_reviewer_uid、@apf_seed_actor_uid。
3. `finance/docs/sql/apf13a-workflow-seed-candidate.sql` / `apf13a-workflow-verify-candidate.sql`：finance/expenses/claim、project_expense；按文件设置 claim/project reviewer 与 seed actor。
4. `finance/docs/sql/apf13b-workflow-seed-candidate.sql` / `apf13b-workflow-verify-candidate.sql`：finance/expenses/payment；@apf_payment_reviewer_uid、@apf_seed_actor_uid。
5. `people/docs/sql/APF-Assignments-Workflow-Seed-candidate.sql` / `APF-Assignments-Workflow-Verify-candidate.sql`：仅 **people/assignments/change**，设置 @apf_people_reviewer_uid、@apf_people_installer_uid；一个启用默认人工route，schema=`apf-people-assignment-change`。既有任何route/schema先停下人工审查，不覆盖、复活或重复seed。
6. **入职/离职核对结论**：Host onboarding case是候选/provisioning（Directory reserve→provision→绑定→激活），非独立Workflow审批；任职onboard/leave事实若需要审批使用已有assignments/change链。Directory employment/offboarding是已冻结事实的受信同步，不是新批准事实。当前Host没有独立people/onboarding/approve或offboarding/approve的submit/bind/callback闭环，因此不新增这两个定义。若用户要求独立入离职审批，先补业务合同/链路再启用，不能靠seed绕过。

统一只读前置核验新增 `deploy/test-env/APF-WORKFLOW-PREFLIGHT.sql`：列出7个当前正式元组及action/route/schema/conditions/level/priority/nodes/config。在实际owning Workflow库执行后，必须确认每个元组有一个启用默认人工route、schema有效、节点type=approve、reviewer UID匹配批准名单；另核对条件route是否会优先命中，不能仅看默认。缺失、重复、inactive、空/@all reviewer或与既有策略冲突时停下。此SQL不创建授权、不读Console凭据。

Altoc/Finance候选已齐：Altoc2、Finance开票1、报销/项目支出2、付款1；没有新Workflow元组或app级通配。各审批人仍需Console当前active/Workflow审批资格/与申请人的职责分离，SQL本身无法跨库证明人员资格。

使用与上节相同安全 SQL 管道模板，但 database 为审查确定的 Workflow owning 库，不写错 Console 库。人工 UID 来自 Console active Directory，审批人和申请人分离，禁止 @all、默认自动批准。已有 routes 不换策略；正式实例创建后不能删除 schema/action defs 回滚，应先冻结 submit，保留 pending/receipt 恢复，再审查数据恢复。

## 6. Runtime 配置、候选切换与回读

先保存原 config/Registry/binary/plist 与 hzy0 进程路径，再在新私有 candidate config 合并已核验累计 mapping。保护字段 tenant/deployment/storage/schemaVersion/generation/其他域逐字段不变；不改 app.baseURL、buildAssetsDir 或 Gateway 全局路径。

| 配置项（真实 JSON 结构） | 目标/限制 |
| --- | --- |
| enterprise.domains.people.read / write | unified / unified；只有 private+facts 安装通过且人员权限/审批/Console 目标通道已核验后开写 |
| enterprise.domains.finance.read / write | unified / unified；保持基础参数能力，B3/13a/13b 族逐项确认可用 |
| enterprise.domains.altoc.read / write | unified / unified；保留基础客户/报价/合同，B2 安装后开相应页面 |
| enterprise.domains.{people,finance,altoc}.scheduler | **disabled**，本轮默认不启调度 |
| enterprise.inProcessScheduler.enabled | 保持原审查值；不为 APF 擅自打开全局/Aims 调度。APF 独立 scheduler/worker 环境变量与任务配置亦保持关闭 |
| enterprise.workflowLane.enabled | 不自动打开或并库。保留现有经审查拓扑；People bind 读取须确认已配置窄 Workflow reader，未配置 503 不绕过 |
| enterprise.enableContractActivation / enableMilestoneReceivable | 不是报价/合同审批开关；保持现有值。启用履约共享事务需另核对相应依赖，不随本方案开启 |

scheduler 关闭时用户 submit 即时路径仍须完成创建/绑定；依赖 worker 的 pending 可能需现有受控恢复入口。验收不得把 202 当已批准/已开户；如恢复必须开 scheduler，先另交精确 owner/任务/范围审批，不启全部 cron。

在 Runtime 停止状态先核验 candidate 的完整 binding/兼容视图（本轮批准后才执行）：

```sh
cd "$candidate/data-runtime"
go run ./cmd/hzy-enterprise-verify-views --config "$candidate_config0600"
```

数量以新 mapping 和实际 verifier 为准，不盲写 142/156；所有旧映射摘要保持。用现用 LaunchAgent 完整环境做启动探测，不省略签名配置。安装 verified binary/config，恢复现用 plist；之后：

```sh
launchctl enable "gui/$(id -u)/cn.wiztek.hzy-test-runtime"
launchctl bootstrap "gui/$(id -u)" "$reviewed_plist_path"
# 若已 loaded，则用 kickstart -k；不混用 bootstrap 失败作为成功。
```

hzy0 应用在同一干净候选准备依赖与 Nuxt 生成物后，用既有进程管理切到候选目录；准确进程管理命令/进程名取当前启动定义，本轮不读取其凭据正文，也不猜 pm2 app 名。只重启获批的本机 Runtime/Console/Workflow/Enterprise 配套进程，不动 Tunnel/生产。

回读：启动 listening；本机与公网 health 连续三轮 200且 version/commit/hash 对应制品；匿名业务请求 401/既定拒绝；service token 绑定矩阵；每新增族 readiness 与权限加载；失败无 fallback 冷库。访问入口 `https://hzy0.isme.dev/enterprise/`（模块页同源 /people、/altoc、/finance）。HTTP 核验实际 health 路径从现用 runbook/进程配置读取，不凭空猜。

切换失败先停写/停进程，恢复本轮 binary/config/plist/候选路径，重新启动核对旧版本；新表保留且关闭新入口比强删安全。没有新业务写入才考虑 receipt 逆序 rollback；有业务数据则保留并提完整恢复方案。全库恢复会覆盖窗口内其它域写入，只有维护冻结与用户明确批准后执行。

## 7. 浏览器验收（每项 1440 与 390）

执行者使用用户已登录受控浏览器新标签，不读取/填写密码；登录过期通知用户。批准方案后使用带本轮唯一标记的合成数据，登记业务键/回执/版本，不写真实私密信息。任何物理删除清理另获批准，不用 SQL 清理当默认步骤。

| 链路 | 正例 | test/职责分离与状态反例 |
| --- | --- | --- |
| 岗位/职级/设置 | 列表分页/搜索，授权人员创建编辑 CAS；生效日期与未来设置 | test 无 admin 禁止写；跨范围详情不泄露；409 保留草稿 |
| 员工/私密档案 | 当前任职/目录投影；授权 private 查看/编辑，敏感白名单/no-store | test 无私密 edit/view不能读写；employees:view不推出成本/私密权；响应无正文日志 |
| 任职审批/入离职 | 草稿→提交→Workflow人工审批→绑定→受信回调→有效日期投影；未来批准不提前生效 | 申请人不可伪造批准；test 无权/错对象403；依赖失败 pending 同键恢复；审批撤权/同版本冲突 |
| 线索转换 | 显式客户/商机匹配→转换一次；活动/团队关系正常 | test 无 convert、错范围禁止；重复原键不重复客户/商机；歧义匹配提示 |
| 报价→合同审批 | 版本快照→submit→正确人工审批→状态回读；两类元组正确绑定 | test/申请人不能浏览器写 approved；无 edit/approve403；旧版本409；customer审批不误放行 |
| 开票→到账→核销 | 批准申请→另一开票人正式开票；到账draft→explicit confirm→核销→Altoc摘要 | 申请人=开票人拒绝；到账确认人=核销人拒绝；draft到账不可核销；手工正式发票不开放；超额/跨币种/重复原键保护 |
| 报销/项目支出→付款确认 | submit→审批仅改变申请状态→独立确认人确认→一条confirmed台账；付款申请同链 | 申请/制单/经办人不得付款确认；trusted actor不可浏览器替换；审批通过未确认不得提前生成台账；同键重试不重复付款事实 |

每页两个宽度检查：页头/操作区、列表与共 N 条、loading/empty/无权限/依赖失败区别、手机菜单与抽屉关闭按钮、无文字溢出/重叠/横滚、复杂表单独立页、409刷新比较保留草稿、响应未知原键恢复、控制台无新增错误。权限快照必须按模块发请求；不把 loaded=false 显示成暂无数据。

test 是反例账号，不假定其权限足够验证全部职责冲突：无权限403与具备动作权限但违反 SoD 的领域拒绝分别记录。若需 test 持适当角色才能触达 SoD，先由用户批准对应人员角色安排，不在本次 service seed顺手授权。所有验收记录按“源码已交付/隔离已过/安装已核验/浏览器已验”分列，不用方案替代证据。

## 8. 执行放行清单

- [ ] 用户批准精确提交、安装段、双 Runtime audience、人工路由/UID、测试数据与维护窗口。
- [ ] 增量安全CLI已审查；grant精确回滚候选已审查；按每段实际hash放行，不执行未知命令。
- [ ] 三库（按实际 Workflow 拓扑）备份恢复演练、每段 baseline/receipt 与 runtime停止证明通过。
- [ ] 安装逐段 verify；grant双 audience与精确Workflow/Console通道通过；People流程缺口已处理。
- [ ] 唯一测试版本、干净构建、候选mapping/readiness/启动与真实签发矩阵通过。
- [ ] 1440/390全链与test/职责分离反例有独立证据；scheduler仍关闭。

本文只读取仓库源码、候选 SQL 与本机运行手册的配置结构；没有连接数据库、执行安装/授权/构建/切换/浏览器写操作。新增文件为唯一交付。
