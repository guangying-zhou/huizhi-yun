# 本机 APF 三域安装

默认路径仅适用于 C000001 / test、部署 C000001-test-enterprise、Runtime 127.0.0.1:18084、数据库 127.0.0.1。一次安装 Altoc、Finance、People 的固定嵌入清单：53 张表、0 个兼容视图（Altoc 26 张业务表加 4 张账本；Finance 9+4；People 6+4）。它不编辑现用配置、Registry、generation、授权或进程。以下是后续获批维护窗口内的操作说明，本次开发不执行这些步骤。

## 前提与失败边界

- 从干净、已审提交构建工具；维护前备份统一库、Registry、现用配置、LaunchAgent 及 Console service client/credential/grant。备份采用既有加密流程，验证可恢复；先在完整隔离副本演练，不能以空库单测代替实际备份演练。
- 操作者按现有本机运行手册停止 Runtime，并明确禁用 `cn.wiztek.hzy-test-runtime`。每个模式均只读检查 launchctl 的明确 disabled 状态、服务未加载、18084 端口明确拒绝连接；超时或权限错误不算停止。工具不会帮忙停止/启动任何进程。
- 独立迁移账号限定同一 host/port/database，与 Runtime 用户不同，禁止 root；使用 schema 最小权限（SELECT、CREATE、DROP、REFERENCES、INDEX、SHOW VIEW、CREATE VIEW），不得使用全局管理员。`--migration-db-config` 使用既有迁移工具 DB JSON 格式，文件为所有者私有 0600；密码不放命令行或环境变量。
- 所有输入为所有者私有文件，拒绝符号链接；输出父目录不可被其他用户写入。新 plan、candidate、receipt 均独占创建 0600，不覆盖已有文件；每次 CREATE 后持久化 receipt。遗留 `.next`、未知对象、结构/数据/绑定漂移均停下报告，不删除证据或自动回滚。
- 所有模式持有迁移锁。校验既有对象定义和行摘要，保护 aims/assets 等基线；代次保持原值，回滚每次 DROP 前重新核对代次。输出只包含摘要/结果，不打印配置、凭据、SQL 或驱动原始错误。

## 先处理旧 Altoc

旧域为 13 张表和 13 个兼容视图，仅含 27 条 ZZ-TEST 样本；用户选择不迁移历史数据。原始证据目录：

`~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/altoc-live-20260927134003591/`

在完整备份和停止事实核验后，从该目录人工确认**原安装 plan、原 receipt、原 proposed config** 及原 reviewHash，不能猜文件名或重新生成旧计划。用原配置绑定执行：

```sh
# 在 data-runtime 目录；变量均指向已审、所有者私有的原始文件。
go run ./cmd/hzy-enterprise-add-altoc --mode rollback \
  --config "$oldProposed" --migration-db-config "$migration0600" \
  --plan "$oldPlan" --receipt "$oldReceipt" \
  --review-hash "$(jq -r '.ReviewHash' "$oldPlan")"
```

旧工具可能因安装后合法基线变化或对象漂移拒绝回滚：**立即停止并报告**，不得改 receipt、替换摘要、生成新旧域计划、禁用外键或手工强删。只有原回滚成功后，准备新的私有 base 配置，移除旧 `enterprise.domains.altoc`，保留所有其他字段、映射、UUID 与 generation：

```sh
umask 077
# base 必须是新的文件；先人工检查差异，不覆盖 active 配置。
( set -C; jq 'del(.enterprise.domains.altoc)' "$current0600" > "$base" )
```

旧域处理与新安装之间不得启动 Runtime。新工具会同时拒绝配置中已有的任一 APF 域、旧 Altoc 表和残留兼容视图，即使旧 mapping 已删也不能绕过。

## Console 固定通道 grant

复用 `console/docs/sql/Console-SQL-Seed-v2.34-apf-channels.sql` 与对应 Verify SQL；不要修改授权模型或人员权限。先加密备份 service clients、credentials、grants，核对当前有效 `enterprise.runtime` / `enterprise` 客户端、current credential 与绑定。

用现有安全 DB 执行流程，在同一会话设置 `@apf_tenant='C000001'`、`@apf_deployment='C000001-test-enterprise'`、`@apf_audience` 为实际配置的 **一个** `data-runtime` 或 `tenant-runtime` audience。先读 Verify 与待插入差异，再运行 Seed，最后再次 Verify。Seed 只插缺失行；已有 revoked/inactive、重复、错误绑定不得通过 UPDATE 或删行补救，停止报告。

三域分别需要以下三个语义 scope（共九项）：

| 域 | Host | 调度 | 通知详情 |
| --- | --- | --- | --- |
| altoc | altoc:enterprise-host:execute | altoc:scheduler:execute | altoc:notification-detail:authorize |
| finance | finance:enterprise-host:execute | finance:scheduler:execute | finance:notification-detail:authorize |
| people | people:enterprise-host:execute | people:scheduler:execute | people:notification-detail:authorize |

数据库 resource_code 带实际 audience 前缀，语义 scope 不带此前缀。如果 Console 表在同一统一库，必须按“旧域回滚 → grant 备份/补缺/Verify → APF plan/apply/verify”排序；plan 后修改任何基线表会使 verify/rollback 拒绝。

完成安装且另行批准激活 Runtime 后，保持业务写入冻结，用现有安全凭据流程做**真实签发**探测：九项单 scope；三域 Host、scheduler、notification-detail 各一组组合 scope；消费者使用全九项时再测全组合。请求使用 client_credentials、client_id enterprise.runtime、app_code enterprise、实际 audience、相应 scope、source_binding service-client-policy。检查 JWT 签名/JWKS、iss/aud、token_use=service、sub/client/source_app、tenant/deployment、精确 scope、有效期和当前凭据状态。只记录 HTTP 状态和校验布尔结果，不记录 token/secret。现有 `deploy/test-env/probe-c000001-rollout-service-tokens.mjs` 不覆盖完整 APF 九项，不能替代此矩阵。授权 scheduler 通道不会启用调度，候选配置仍禁用全部 APF scheduler。

## 新三域安装

```sh
umask 077
mkdir -m 700 "$artifacts"
# 在 data-runtime 目录；目录与路径由操作者指定，迁移凭据不进入参数。
go build -o "$artifacts/hzy-enterprise-add-apf" ./cmd/hzy-enterprise-add-apf
common=(--config "$base" --migration-db-config "$migration0600" \
  --proposed-config "$artifacts/proposed.json" --plan "$artifacts/plan.json" \
  --altoc-write unified --finance-write unified)
"$artifacts/hzy-enterprise-add-apf" --mode plan "${common[@]}"
```

人工审查 plan 与候选配置。三域 read=unified；默认候选 Altoc/Finance write=unified、People write=disabled，scheduler 全 disabled。可将两个 write 参数选为 disabled，但后续所有模式必须保持相同选项。安装绑定本身保持 write=disabled；候选文件仅用于日后激活，不会在工具内生效。reviewHash 同时绑定安装清单、完整 source/candidate 字节与写模式；修改任一项必须重新计划，不得修改现有证据。

```sh
review=$(jq -r '.ReviewHash' "$artifacts/plan.json")
# review 必须经审查批准，不能仅因为能读出就 apply。
"$artifacts/hzy-enterprise-add-apf" --mode apply "${common[@]}" \
  --receipt "$artifacts/receipt.json" --review-hash "$review"
"$artifacts/hzy-enterprise-add-apf" --mode verify "${common[@]}" \
  --receipt "$artifacts/receipt.json" --review-hash "$review"
```

重复 apply 拒绝覆盖已有 receipt/对象，不替换第一次结果。成功后按既有维护手册另行审查切换到 candidate，并执行上述真实签发核验；本工具不进行配置切换或进程启动。其余模式继续用原 base 文件，而非换成已注册 APF 的 active/candidate 配置。

## 显式回滚

```sh
"$artifacts/hzy-enterprise-add-apf" --mode rollback "${common[@]}" \
  --receipt "$artifacts/receipt.json" --review-hash "$review"
```

只回滚本次 receipt 证明创建的对象。任何 APF 表已有业务数据（包括命令回执/审计）、外部外键、结构/基线/绑定漂移、未登记对象均拒绝；业务写入后需要新的恢复方案，不能强删。部分 apply 失败时保留原 plan/candidate/receipt，再在停止事实与原基线成立时显式 rollback；若 CREATE 成功但回执未落盘，也需停止人工处理，不猜对象归属。回滚不自动恢复 active 配置或启动 Runtime。

## 开发验证（只用一次性库）

```sh
# 仓库根目录；新 /tmp datadir、随机 loopback 端口、--no-defaults，自动清理。
node data-runtime/scripts/test-enterprise-add-apf-mysql.mjs
# data-runtime 目录
go vet ./cmd/hzy-enterprise-add-apf ./internal/enterprise/domaininstall
go test -race ./cmd/hzy-enterprise-add-apf ./cmd/hzy-enterprise-add-altoc ./internal/enterprise/domaininstall
```

隔离测试覆盖全链、旧域原 receipt 回滚及残留拒绝、aims/assets 摘要、重复安装拒绝、迁移锁、非空回滚拒绝、部分 receipt 恢复与回滚代次漂移；不连接 hzy0 或读取本机已有数据库凭据。

## 已注册 APF 的增量子集（2026-10-03）

使用同一个CLI的 `--subset` 精确枚举：people-private → people-facts；finance-B3 → finance-13a → finance-13b → finance-cost；altoc-sales-B2 → altoc-tenders → altoc-services → altoc-tickets。hzy0建议串联顺序为 people-private、people-facts、altoc-sales-B2、altoc-tenders、altoc-services、altoc-tickets、finance-B3、finance-13a、finance-13b、finance-cost。已有基础53表不重装。未知/动态文件名或缺前置映射立即拒绝。增量模式不接受 `--altoc-write` / `--finance-write`，仅扩展所属域tables，完整保留原模式和未知字段，不激活、不切进程。

每一段原 `--config` 是前一段已verify的proposed-config。新建各段独立0700目录和0600 plan/proposed/receipt；真实停止校验、安全迁移账号、来源/candidate字节摘要、generation/baseline、迁移锁和每次CREATE checkpoint复用基础流程。reviewHash包含subset身份。旧无subset v1计划/回执仍可验证，不重写历史证据。

```sh
# 获批维护窗口；在干净候选data-runtime目录构建，当前任务不执行环境。
go build -o "$artifacts/hzy-enterprise-add-apf" ./cmd/hzy-enterprise-add-apf
subset=people-private
stage="$artifacts/$subset" # 预先mkdir -m700，新目录
common=(--subset "$subset" --config "$previous_config0600" \
 --migration-db-config "$migration0600" \
 --proposed-config "$stage/proposed.json" --plan "$stage/plan.json")
"$artifacts/hzy-enterprise-add-apf" --mode plan "${common[@]}"
# plan成功不等于批准。审查原文件生成的ReviewHash后：
review=$(jq -er '.ReviewHash' "$stage/plan.json")
"$artifacts/hzy-enterprise-add-apf" --mode apply "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
"$artifacts/hzy-enterprise-add-apf" --mode verify "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
# 下一段previous_config0600=$stage/proposed.json；不要覆盖原config/证据。
```

禁止一次先plan全部再apply：各段baseline依赖前一段实际对象，需逐段plan→审查→apply→verify。最后仅由协调者另审激活累计candidate。回滚用每段**原**config/plan/proposed/receipt/hash，按依赖逆序finance-cost、finance-13b、finance-13a、finance-B3、altoc-tickets、altoc-services、altoc-tenders、altoc-sales-B2、people-facts、people-private。每次先verify当前段，再rollback，再verify剩余前缀的上一段；基础原53表保持。独立域间也按实际安装的逆序恢复baseline。不允许跳段、改hash、删证据或直接DROP。

```sh
"$artifacts/hzy-enterprise-add-apf" --mode verify "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
"$artifacts/hzy-enterprise-add-apf" --mode rollback "${common[@]}" \
 --receipt "$stage/receipt.json" --review-hash "$review"
```

任何非空、schema/Registry/binding/baseline漂移、外部FK、未checkpoint对象或`.next`遗留，保持原证据并停止。所有段完成前保持Runtime停止；安装/回滚工具均不执行授权、Workflow seed或配置激活。隔离CLI测试覆盖基础→十段串联→逆序回滚→基础verify，以及跳序回滚拒绝、generation漂移、非空拒绝、0600与原域保护。Workflow候选测试仅在同一/tmp隔离实例运行SQL，不连接已有Workflow/Console库。

altoc-services 固定六表（协议/覆盖/项目关系/合同资产计划与旧维保/权益只读），复用只建、非空拒绝回滚机制。此子集不启用旧模型写入，不创建 service_agreement_asset 第二套事实。

altoc-tickets 固定一表 altoc_service_ticket，须已有 altoc-sales-B2 与 altoc-services，Tender 可选。安装保留 generation、既有域映射与模式；回滚沿原 receipt 摘要与非空保护，必须先退役在途派发/回写，不得删除业务证据。

APF-16d `--subset altoc-renewals`：一表 `altoc_renewal_opportunity`，前置 sales-B2 与 services；tenders/tickets 可选且原样保留。候选命令沿上述 plan→审查→apply→verify，用本段原配置/plan/receipt/hash rollback，先于 services/tickets/tenders 的逆序回滚。仅续约记录，不迁移旧维保数据、不更改授权或开启写入。非空回滚失败关闭。

APF-16f `--subset altoc-feedback`：三表冻结来源、状态投影、进度投影；必须已有 altoc-tickets，兼容已装 tender/renewal。沿既有 plan→审查→apply→verify，Runtime 停止、迁移锁与 generation 栅栏不变。rollback 使用本次原 plan/receipt/hash，必须先于 tickets 逆序执行；非空数据拒绝 DROP。本批不执行安装、旧数据迁移、owner 或环境切换。

### APF-18B1 到期通知安装候选（不执行）

固定增量子集 `altoc-due`、`finance-due`、`people-due`：分别只建本域 checkpoint/cursor/audit 三表并增量映射，generation 不变，既有域/模式不变。源表必须先安装：Altoc sales-B2 + billing_schedule、Finance 开票与核销域、People offboarding。沿上述命令替换 `--subset`，每个子集独立 plan → review hash → Runtime 停止窗口 apply → verify；原 plan/receipt/hash 逆序 rollback，三表任何非空、漂移或外部 FK 即拒绝，不删除投递证据。SQL 规格在各域 `*_enterprise_due_schema.sql`。真实安装/Runtime 停止均须另获批准。

安装不启用任何 owner。Runtime 本地受保护配置 `enterprise.dueNotifications` 是六个 family 名到 `{enabled:false,legacyOwnerDisabled:false}` 的映射（缺省相同）；不能由 API 提供。启用前核对旧 worker 开关实际关闭、在途键对账、APF-18A 调度双 audience 六行与 APF-18B1 P/Console seed verify 全部通过，才同时配置 Runtime 门禁与 Enterprise 对应开关。撤回 owner 时先关 Enterprise 六族，再关 Runtime 配置，保留三表与原键；旧 owner 不自动复活。

|family|Enterprise enable（缺省 false）|旧 owner 关闭/退役确认（须显式 false）|
|---|---|---|
|sales-due|HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED|HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED（旧源码无独立此开关，此项是退役确认；需另外核对旧执行者）|
|billing-due|HZY_ENTERPRISE_ALTOC_BILLING_DUE_ENABLED|HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED|
|issuance-due|HZY_ENTERPRISE_FINANCE_ISSUANCE_DUE_ENABLED|HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED|
|reconciliation-due|HZY_ENTERPRISE_FINANCE_RECONCILIATION_DUE_ENABLED|HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED|
|handover-due|HZY_ENTERPRISE_PEOPLE_HANDOVER_DUE_ENABLED|HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED|
|asset-recovery-due|HZY_ENTERPRISE_PEOPLE_ASSET_RECOVERY_DUE_ENABLED|HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED|

只复用 APF-18A 的 Gateway 签名 `/enterprise/api/internal/apf/scheduler-inspect`；Gateway domain owner、Enterprise `HZY_ENTERPRISE_APF_SCHEDULER_ENABLED`、unified generation 门禁仍须符合原合同。无独立 timer；不允许 U 触发机器任务。通知每族 20+20 条扫描、同域两族并行，20 秒启动预算；原 Directory/审批恢复并行处理，不在其耗时后再追加通知预算。完整环境 CPU/壁钟验收另批，不以单测代替。

APF-18B2 死信通知没有新增安装子集：复用三域共享账本及当前 schema。受保护 Runtime 配置 `enterprise.deadLetterNotifications.<domain> = {"enabled":false,"legacyOwnerDisabled":false}` 默认关闭；Host 三个 `HZY_ENTERPRISE_<DOMAIN>_DEAD_LETTER_NOTIFICATIONS_ENABLED` 默认关闭。启用前先完成旧通知 task **以及请求内调用**退役/对账，再显式设置对应旧 flag=false；只声明新 flag 不会自动停旧代码。统一 Gateway APF 签名 wake 是唯一新 owner，双 audience scheduler grant 复用 APF-18A，P/Console publish grant 复用18B1候选。每域至多3创建+3关闭，20秒开始预算，无外部渠道；恢复/成功仍业务原路径，不由通知owner代办。

### 已激活 Aims：项目集成员子集

`--subset aims-portfolio-members` 仅新增 `aims_portfolio_members`、`aims_portfolio_doc_repos` 两张同名表与候选 tables 映射，不创建兼容视图、不更新 Registry。DDL 与 `aims/docs/migration_v5.42_portfolio_members.sql` 逐字一致。Aims 不采用 APF 固定基集；来源配置摘要、审阅 hash 及既有对象 baseline 固定原映射、视图、Registry mapping_hash 和数据。原 read/write 必须为 unified，scheduler、generation 和其他域保持原状；任何既有同名表/映射或跨域占用拒绝。

命令复用上节 plan → 审阅 → Runtime 停止窗口 apply → verify，替换固定 subset 名称即可。每个阶段使用独立私有 plan/proposed/receipt。rollback 只移除本批自建且摘要一致的两张空表，既有对象漂移、非空或外部 FK 都拒绝；恢复原配置时用本段 source，不能把新的同名映射遗留在运行配置。工具自身不修改 live config 或 Registry。环境安装须另获批准，本批不执行。

## 受审生产路径（G1，未执行）

省略 `--profile` 时仍严格使用以上 C000001/test、launchctl、18084 合同。
生产路径使用绝对路径的所有者私有 0600 JSON profile，不接受环境参数拼接或任意停止命令。
选择 profile 是为了将全部身份、地址、代际和停止证明方式的原字节摘要一起纳入 reviewHash。
此文件不包含密码；profile 不是远端审批或用户批准的替代物。

```json
{
  "schema": "apf-production-install.v1",
  "tenant": "C000001",
  "environment": "prod",
  "ownerDeployment": "C000001-prod-enterprise",
  "runtimeDeployment": "c000001-prod-tenant-runtime",
  "runtimeHost": "127.0.0.1",
  "runtimePort": 31080,
  "databaseAddress": "127.0.0.1:3306",
  "database": "hzy_enterprise",
  "instanceId": "从已核对的现用配置与数据库读取",
  "schemaVersion": "从已核对的现用配置与Registry读取",
  "generation": 1,
  "stopProof": "systemd-inactive-port"
}
```

上例的 instanceId、schemaVersion、generation **必须换成现场核对值**，不得照抄。
profile 与源配置的 tenant、Runtime deployment、Enterprise deployment binding、运行地址、统一库地址/名称、instanceId、schemaVersion、非零 generation 必须严格一致。
未知键、未知环境/停止证明、非回环数据库、非 31080 Runtime、可公开读取或符号链接文件均拒绝。

在 Linux Runtime 主机上，每个模式只读执行：

```sh
systemctl show hzy-data-runtime.service --no-pager --property=LoadState,ActiveState,SubState,MainPID
```

仅 `loaded / inactive / dead / MainPID=0` 且 127.0.0.1:31080 明确 ECONNREFUSED 才通过。
failed、不存在、超时、权限失败、仍监听均不能证明停止；macOS 上生产路径拒绝。
工具不停止服务，不禁用 timer。操作者须先按受批执行单冻结自动启动来源；停止 Runtime 的连带服务停机必须纳入窗口。

所有 plan/apply/verify/rollback 命令在原参数基础上添加：

```sh
--profile "$PRODUCTION_INSTALL_PROFILE"
```

四模式必须使用同一 profile 原字节。每次停止核验都会重读私有 profile 并比对摘要，改动后不得沿用旧 plan/hash。
原迁移账号、迁移锁、只建不覆盖、源/候选 SHA、Registry 与非零 generation、既有对象 baseline 和空表回滚条件不变。

## W1 银行账户列增量子集

`--subset finance-bank-account-columns` 只扩展已安装的 APF `finance_bank_account`，不新增表映射、不改变任何 Runtime 模式。source 与 proposed 配置字节完全相同，reviewHash 仍绑定两份 SHA。Registry、generation、既有兼容映射 hash 均保持不变；列声明和前后表定义摘要独立存入 plan/receipt。

载体为 W1 §3.1 的五列（简称、行号、法人主体、排序、子类型）及两个索引。既有 `account_no_secret_ref` 不重复新增。新装 APF 使用同一编译声明，隔离测试断言新装与增量的 `SHOW CREATE TABLE` 定义逐字一致。

沿用上述 `plan → 审批 reviewHash → apply → verify` 命令，仅添加该 `--subset`；所有输入输出仍为 owner-private 文件，所有模式仍要求既有 test/prod 停止证明。不接受外部 SQL 或声明文件，不安装 Aims/Assets 视图族列。迁移账户除既有 schema 权限外需要该 schema 的 `ALTER`，不需要 DML 或全局管理员权限。

- plan 冻结 MySQL 版本、目标表完整定义、旧列投影的全表行多集摘要、其余表/视图/Registry 数据和定义、trigger 定义；每条 DDL、前后定义摘要都纳入 reviewHash。
- apply 在迁移锁内逐条执行，显式使用 `ALGORITHM=INPLACE, LOCK=NONE`；不支持时失败即停，不自动降级 COPY。INPLACE 不代表不重建表，实际耗时写入 receipt；执行前仍需根据演练评估元数据锁和停机预算。
- 每列/索引完成后持久化 checkpoint。重复 `apply` 只续已保存的连续 checkpoint；若 DDL 成功但 checkpoint 未落盘，表定义不匹配即停止人工核对，不能把未知对象认领成本批创建。
- verify 要求全部 checkpoint 完成，新定义逐字匹配、旧列数据摘要及其余基线不变。保护 Registry 的全部字段，包括已有的 `mapping_hash`。
- rollback 先全量预检后逆序删除本批索引和列；不删本来就存在的同定义列/索引。新增列必须全为 NULL/声明默认值，旧列投影与其余基线不变；有外部 FK、定义漂移或业务数据时拒绝。nullable 回退含 NULL 时拒绝。
- 仅批准 `altoc_contract.tax_rate` 的内部 nullable 声明可放宽 NOT NULL，默认值保持 `6.00` 或移除；不可变更类型、注释或其他旧列。当前 CLI 不开放任意放宽选择器。

回滚只适用于尚未启用业务写入的安装窗口。当前值恢复为默认不能证明历史上从未被写入；一旦开放业务，不得仅凭空列检查做删除回滚，应走另行审查的数据保留方案。旧安装 plan/receipt 须保留与其对应的原安装器二进制，不用新版基础声明替代历史审查事实。

## W2：W1 固定安装子集（候选，不执行）

以下是固定闭集，不接受任意表名、SQL 或约束表达式。每段使用独立的 source/proposed/plan/receipt；沿本文件 `plan → 审阅 reviewHash → apply → verify` 的命令替换 `--subset`。Runtime 停止、迁移锁、非零 generation、原对象及数据 baseline、受保护 profile 均沿用原门槛；停止 Runtime 会连带影响各业务服务，必须另获停机批准。

| 固定 subset | 对象 | 前置依赖 |
|---|---|---|
| `w1-migration-ledger` | mig_batch、mig_batch_step、mig_source_row、mig_object_map、mig_identity_map、mig_exception | 已激活统一库；仅新增 migration 域，logical=physical，无视图 |
| `w1-finance-legal-entity` | finance_legal_entity | Finance 基集 |
| `finance-bank-account-columns` | 既有账户五列及两个索引 | Finance 基集；既有 secret_ref 不重复新增 |
| `w1-finance-balance-entry` | finance_account_balance_entry | finance_bank_account 已存在且有主键 |
| `w1-finance-balance-columns` | balance_snapshot 三列 | finance_account_balance_snapshot |
| `w1-altoc-contract-columns` | 合同九列、origin CHECK、tax_rate NULL 放宽 | altoc_contract |
| `w1-altoc-contract-snapshot` | 合同迁移快照 | altoc_contract |
| `w1-altoc-customer-columns` | 客户三列、主联系人索引和外键 | altoc_customer、altoc_contact（id 主键） |
| `w1-altoc-contact-columns` | 联系人 star_level | altoc_contact |
| `w1-altoc-customer-snapshot` | 客户迁移快照 | altoc_customer |

新表配置仅增量追加对应域映射；迁移台账不进入业务读取。列子集 source/proposed 原字节一致，不更新 Registry 或 mapping_hash。声明与完整 DDL 摘要是安装证据，不称 Runtime 映射 hash。新装 APF 的对应表由同一列声明派生；客户/联系人是双向外键，客户主联系人 FK 必须在所有基表创建后追加，仍保持 foreign_key_checks 开启，计划和表回执均覆盖这一步。新装也需要 schema 级 ALTER 权限。W1 新表仍按上表各自闭集安装，不隐式安装或启用数据迁移。

约束预检在 plan 与 apply 开始时均执行：引用对象/索引/列类型须可用，已有非 NULL 引用不得悬空；CHECK 检查目标全表，无效数据阻断，不抽样。尚未新增的列用声明默认值构造投影，NULL 遵循 MySQL CHECK 语义。完整约束定义纳入 reviewHash 并逐字 verify。客户源列索引显式声明为 `idx_altoc_customer_primary_contact`，不依赖 MySQL 隐式创建。

MySQL 8.0.34 隔离演练确认：新增 FK（保持 FK 检查）和 CHECK 使用受审 `ALGORITHM=COPY, LOCK=SHARED`；普通加列、索引及 nullable 放宽仍显式 INPLACE/NONE。不是运行时失败后自动降级，具体算法预先固定进每条 plan，耗时记录在 receipt。COPY 会重建表，正式安装必须根据生产数据量评估停机与磁盘预算，不以空库毫秒数代替。任何 DDL/verify 失败立即停止。

rollback 先完整预检，再逆序 DROP 本批约束、索引、列；本来已有的对象不删除。新表逆序删除且必须为空；任何外部 FK、非空、定义或旧数据漂移均拒绝。合同 tax_rate 有 NULL 时禁止回退 NOT NULL。所有恢复仅适用于未开放业务写入的安装窗口；先撤销后续 subset，再按每段原 source/receipt/hash 回滚。历史安装 plan/receipt 继续使用对应旧二进制，不用新声明替代其事实。

完整 W1 链按设计 §9.1 执行：legal-entity → balance-entry + balance-columns → bank-account-columns → customer-columns + contact-columns + customer-snapshot → contract-columns + contract-snapshot → migration-ledger；各段独立审阅，逆序回滚。上述表格是依赖对照，不代表执行顺序。

### hzy0 W1 停机前权限预检

在停止任何 Runtime/应用、或开始候选切换之前，使用安装账号执行只读预检：

```sh
node deploy/test-env/preflight-w1-ddl.mjs --migration-db-config "$migration0600"
```

命令从仓库根运行；只读取受保护 0600 配置，固定为本机 C000001 测试统一库与 `hzy_apf_migration@127.0.0.1`，不适用于生产。仅查询 MySQL 当前账号及权限元数据，不执行试探 DDL、GRANT、进程管理或修复。输出 `ready:false`、依赖错误或非零退出时，禁止停机；将缺失的表/权限交协调者审批，不能自行补权。

预检包含五表 ALTER、所需 INDEX/REFERENCES、十张固定新表的 CREATE/DROP/SELECT，以及基线 SELECT/SHOW VIEW。新表集合由测试与 canonical W1 声明对照。使用显式账号权限；active roles 未支持时失败关闭，不猜继承权限。预检不代替安装器的停止证明、reviewHash、迁移锁、对象/数据/generation 检查或 MySQL 执行时权限校验。进入 W1 窗口前再次执行，权限发生变化时停止。

### 本机同制品彩排

受保护 `--profile` 可使用 `apf-local-rehearsal.v1`：仅 C000001/test、固定 Enterprise/Runtime 部署、MySQL `127.0.0.1:3320`、Runtime `127.0.0.1:18184`、既定统一库及非零 generation。停机证明必须同时为独立 LaunchAgent `cn.wiztek.wizbiz-isolated-runtime-20261005` 显式 disabled、未加载、端口 ECONNREFUSED；不得使用测试注入或将真实 hzy0 的停机状态作为副本证明。配置字节 hash 绑定 reviewHash；Runtime 配置和真实 MySQL UUID 仍逐项核对。此配置不能指向 3306/18084，默认 hzy0 与生产路径不变。

B5-A `--subset altoc-receivables`：一表 `altoc_collection_event`，需要现有 APF Altoc 基础映射，保留所有可选子集与模式。按原 plan→reviewHash→apply→verify 执行；原配置/plan/proposed/receipt/hash 逆序 rollback。新事件表非空时禁止直接回滚丢失业务事实。未安装时当前应收读取可用、催收写入失败关闭。不得重装基础表或手工执行 DDL。
