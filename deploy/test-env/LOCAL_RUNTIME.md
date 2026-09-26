# C000001 本机测试 Runtime

2026-09-10 已将原国内测试 Runtime 和全部 5 个测试数据库迁到当前 Mac。测试网页仍在 Cloudflare，入口不变：<https://hzy-test.huizhi.yun/>。

## 当前拓扑

2026-09-20 当前运行版本已更新为 `0.3.219-test.product-edit-audit.1`（`7d42abd12f04-audit`，构建时间 `2026-09-20T19:40:40Z`）。用户确认采用已提交 `7d42abd1` 加审计修复，独立工作树仅包含一个实现文件与两个测试文件的增量，未包含暂停中的未提交 Codocs 工作。完整 Go 测试、隔离 MySQL/race、完整 LaunchAgent 环境启动探测通过；本地及公网 health 新版本、匿名/伪造 token 401、正式 edit token 签发通过。真实页面丢响应同键重试只有一份成功回执与一次 updated 审计，恢复空备注另记一条事件。详见 [制品与验收证据](artifacts/C000001.product-edit-audit-deployment-20260920.json)。

本次 SHA-256：`dd054a05c5335035f8a488b68fdab93bd3b016c80f2de68e05731d8454fb50a0`。旧二进制保存在运行目录 `deployments/product-edit-audit-20260920/hzy-data-runtime.before`，SHA-256 为 `e308530f9f396f0828de52ff7d29e5d4142112df08847bedeea9629e26c67a62`。仅重启测试 Runtime LaunchAgent，配置、数据库、Tunnel、密钥及 grants 未修改；回退仅恢复该二进制并重启，仍使用当前权威数据库，不切回旧库。尚未演练回退，不代表 G1 全部放行。下方旧版本说明保留为历史。

浏览器 → CF 测试 Gateway / Console / AIMS / Assets / Finance / Codocs → `https://hzy-test-runtime.isme.dev` → 独立 Cloudflare Tunnel → `127.0.0.1:18084` → 本机 MySQL `127.0.0.1:3306`。

- Runtime：`0.3.219-test.document-chain.3`（`ac18d39f-dirty`，构建于 `2026-09-19T16:38:00Z`），Darwin arm64 原生构建。2026-09-19 全量 Go 检查、完整 LaunchAgent 环境启动探测通过；上版备份 `deployments/document-chain-20260919-read-only-check/hzy-data-runtime.before`，原版本备份 `deployments/document-chain-20260919/hzy-data-runtime.before`。登录已恢复；文档链因策略刷新阻断尚未验收，现按用户要求暂停独立链路、等待整合方案，见测试部署记录。
- 租户：`C000001`，Runtime 身份：`c000001-test-tenant-runtime`。Console 及应用 deployment/client 绑定、JWT 信任、登录状态、签名密钥和 Vault 密钥保持迁移前身份。
- Tunnel：`hzy-test-local-runtime` / `71750282-1608-4903-8bb8-349072e955ab`。沿用已有账户授权的 isme.dev DNS，独立连接，不调整其他 Tunnel。
- Runtime 仅监听本机回环地址，Tunnel 以 HTTPS 对外提供同样的 JWT 保护接口；匿名和伪造 Bearer 请求均实测返回 401。
- SSO 和平台控制面仍位于原服务器，因此首次登录、策略冷加载仍可能涉及国内链路。迁移没有改变生产环境。
- 本机须开机、联网且不休眠。两个 LaunchAgent 在当前用户登录后启动、异常后自动重启；没有修改系统电源设置。

## 数据与验证

以下表数为 9-10 迁移时快照；后续增量迁移见版本更新及测试部署记录。

2026-09-16 从生产（`oa.wiztek.cn`，同租户 C000001）导入 aims/assets 业务数据到统一企业库 `hzy_enterprise_shadow_review_20260913`：48 张表 5999 行，逐表计数一致。项目线由 0 个项目变为 142 个（27 在建 / 114 归档）。生产侧只执行 SELECT，凭据取自运行进程环境未落盘；导入前已备份统一库到运行目录 `database-backup/`。工具为 `import-production-business.mjs`（默认 dry-run，`--apply` 才写入），跳过项与理由见 `artifacts/C000001.production-business-import.json`——其中生产的 `workflow_status_catalog` / `workflow_transitions` / `work_item_status_catalog` 仍是 matter/target 旧分类，测试库已是新分类模型，未覆盖。

| 原服务器数据库 | 本机数据库 | 表数 |
| --- | --- | ---: |
| hzy_console_test_20260905 | hzy_console_test_local_20260910 | 68 |
| hzy_people_test_20260905 | hzy_people_test_local_20260910 | 22 |
| hzy_aims_test_product_20260909 | hzy_aims_test_local_20260910 | 108 |
| hzy_assets_test_product_20260909 | hzy_assets_test_local_20260910 | 34 |
| hzy_finance_test_product_20260909 | hzy_finance_test_local_20260910 | 39 |

2026-09-17 为 Codocs 上线测试环境新建本机库 `hzy_codocs`（34 张表，装 `codocs/docs/codocs_schema.sql` 加 v1.1–v1.6 及 `company_asset_quick_publish`），并在 `config.json` 增加 `apps.codocs`；库名沿用用户 `.env.dev` 里指定的 `hzy_codocs`，与上表 `_test_local_` 命名不同。原配置备份 `config.before-codocs-20260917T085710.json`。未更换 Runtime 二进制——codocs adapter 已在当前版本内。详见 [测试环境记录](./CLOUDFLARE_TEST_STATUS.md)。

导出前暂停国内测试 Runtime；逐库校验压缩 SQL 的 SHA256，导入新数据库，271 张表逐表比对记录数全部一致。未覆盖本机原有数据库。专用 MySQL 用户 `hzy_test_local_runtime` 仅获上述 5 个库加 2026-09-17 新增的 `hzy_codocs` 的权限，应用未使用 root。

浏览器重新加载后验证：53 个产品、已启用的 HZ-TY-S-002、zhouguangying 的经理关系保持正常；目录同步批次 `4126fc77-a529-5852-a708-cdebc9a82c9c` 在本机成功写入并显示 53/53。Runtime 本地和公网 health 均正常，公网健康检查样本约 0.15–0.24 秒；这不是完整页面加载耗时对比。

## 本机维护

运行目录：`~/Library/Application Support/HuizhiYun/test-runtime/`。配置、密钥、数据库快照、迁移记录均在该受保护目录，不入 Git。`migration-receipt.json` 保存逐库校验结果。不要将 config、Vault 文件或 Tunnel 凭据内容粘贴到日志。

```sh
# 健康检查
curl -fsS http://127.0.0.1:18084/runtime/health

# 重启
launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-runtime
launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-tunnel

# 当前任务状态（注意完整输出含路径及环境配置，不宜直接公开）
launchctl print gui/$(id -u)/cn.wiztek.hzy-test-runtime
launchctl print gui/$(id -u)/cn.wiztek.hzy-test-tunnel
```

LaunchAgent 文件为 `~/Library/LaunchAgents/cn.wiztek.hzy-test-runtime.plist` 和 `cn.wiztek.hzy-test-tunnel.plist`。日志分别为运行目录内 `runtime.stderr.log`、`tunnel.stderr.log`。

本地 Console、AIMS、Assets、Finance、People 的 `.env.dev` Runtime 地址均指向 `127.0.0.1:18084`。CF 访问走 Gateway 受信 Runtime 路由，不走开发环境变量。

## 版本更新

任何 schema 迁移后、部署或重启 Runtime 前，先在 `data-runtime/` 运行只读兼容视图校验：`go run ./cmd/hzy-enterprise-verify-views --config "$HOME/Library/Application Support/HuizhiYun/test-runtime/config.json"`。必须达到现存视图全数通过；工具使用 Runtime 的 `VerifyCompatibilityViews` 与同一视图规格生成器，遇同名跨域映射时仅在恰好一个精确定义匹配后通过。配置文件与凭据不入日志。

测试 Runtime 在本机，**不要**更新或启动 `gitlab.wiztek.cn` 上的 `hzy-test-data-runtime`（已 stop + disable，库为 9-10 旧快照），也不要用 `./update_dr.sh`（会推送生产 `latest`）。步骤：`go test ./...` → 以 `-ldflags` 注入 `internal/version.Version/Commit/BuiltAt` 构建 `GOOS=darwin GOARCH=arm64` → **启动探测**（直接运行新二进制，**必须带齐 LaunchAgent 里的全部环境变量**——当前 7 个：`HZY_DATA_RUNTIME_CONFIG`、`HZY_DATA_RUNTIME_CONFIG_DIR`、`HZY_CONSOLE_VAULT_MASTER_KEY_FILE`、`HZY_FINANCE_AGENT_ENABLED`、`GOMAXPROCS`、`GOMEMLIMIT`、`HZY_LOCAL_WORKFLOW_DEPLOYMENT`；只传 `HZY_DATA_RUNTIME_CONFIG_DIR` 会让进程回落到默认配置（8080、无库）并“正常”启动，等于没验证；日志出现 `listening on 127.0.0.1:18084` 才说明 `server.New(cfg)` 已通过存储与兼容视图校验，随后因端口被占用而退出是预期的，不影响结论）→ 备份运行目录内 `hzy-data-runtime` 为 `hzy-data-runtime.backup-<时间>` → 替换（权限 750）→ `launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-runtime` → 本地与公网 health、匿名 401。**公网 health 探测使用 `curl`（记录 UTC 时间、HTTP 状态、version、`cf-ray`/`server` 是否表明 Cloudflare 边缘）；Python `urllib` 默认客户端曾被 Cloudflare 返回 403，不能据此判定 Tunnel 或 Runtime 故障。**依赖新表的版本须先确认本机测试库已执行对应 migration。回滚即把备份文件复制回原名并 kickstart。

| 日期 | 版本 | SHA-256（darwin/arm64） | 备份 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-09-11 | `0.3.219-test.product-line.1`（`bd15fff9-dirty`） | `e8a5cca4a8644fdde99583c9e207bc8f8bc0b2a7372b6c4a77580320e88d60e1` | `hzy-data-runtime.backup-20260911152009`（原 `0.3.215-test.local-runtime.2`） | 全部 Go 测试通过；本机 AIMS 库已有 v5.37 `product_line_workspaces` / `product_component_sources`；本地及公网 health ok、匿名/伪造 Bearer 401；重启后 Gateway service-token 签发 200 |
| 2026-09-12 | `0.3.219-test.lightweight-plan.1`（`bd15fff9-dirty`） | `394622ce30e0d05a5986e09fbabfdac3c77e8bbbc1853fff851c30ea1fd18776` | `deployments/lightweight-plan-1789246041797/hzy-data-runtime.before`（原 product-line.4） | 全量 Go 22 包通过；测试 Aims 库 v5.38 迁移后原数据计数保持；本地／公网 health 新版本正常，匿名／伪造 Bearer 401 |
| 2026-09-13 | `0.3.219-test.product-line-label.1`（`bd15fff9-dirty`） | `69a948c2bfcd2b59187d822c98ca30734ec5225e16cfde03dc9f23eff63e2d31` | `deployments/product-line-label-20260913T125218Z/hzy-data-runtime.before`（原 lightweight-plan.1） | 全量 Go 22 包通过；本地／公网 health、匿名／伪造 Bearer 401；目录已通过登录态入口同步 53 个产品，名称／下拉筛选／统一标题复验通过 |
| 2026-09-16 | `0.3.219-test.work-item-workspace.1`（`721f46ec-dirty`） | `4a2aacd68dbcffc834bfa2bdbd7c5512b07f4e4f0b3d6c13c21957fdb744698b` | `deployments/work-item-workspace-20260916T225813Z/hzy-data-runtime.before`（原 adr018-unified-cutover.1） | 全量 Go 22 包通过；**换二进制前先用同一 config 跑一次启动探测**，日志到达 `listening` 即证明 `server.New(cfg)` 通过兼容视图与存储校验（9-14 那次崩溃就是缺这一步）；替换后本地／公网 health ok、匿名与伪造 Bearer 401；8 个新企业端点匿名返回 401、未注册路径返回 404 |
| 2026-09-16 | `0.3.219-test.project-filter-keys.1`（`721f46ec-dirty`） | `ea1146e89d7068241fcc5f06787de57a912d000916377e74569de0eead471bec` | `deployments/project-filter-keys-20260916T231307Z/hzy-data-runtime.before` | 修复企业项目列表筛选键：Aims 只读 `lifecycle_status`，wrapper 原样透传驼峰导致筛选被静默忽略、归档项目不可达。启动探测通过；部署后浏览器实测 active=27 / archived=114 / completed=1，合计等于迁移的 142 行 |
| 2026-09-16 | `0.3.219-test.project-shared-deps.1`（`721f46ec-dirty`） | `3065318ac42585374d13df8092de61032fdd7bfa3b28ab24030caea65ed5912a` | `deployments/project-shared-deps-20260916T232729Z/hzy-data-runtime.before` | 第 0 批项目线共享依赖（收藏、仓库、项目工作项列表）。全量 Go 测试通过；启动探测通过；5 个新 capability 令牌签发探测通过；无权账号实测 repos/work-items 403、favorites 返回本人空集 |
| 2026-09-16 | `0.3.219-test.project-deliverables.1`（`721f46ec-dirty`） | `325dc0556b8a3e04e51b462289b537725c05be8836dec1c5599db0509e33ab25` | `deployments/project-deliverables-20260916T235253Z/hzy-data-runtime.before`（原 `project-shared-deps.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-milestones.1`（`721f46ec-dirty`） | `926cd7523ab49571b3aa0626f52e23078330abb0aa3f7b038495cf80c749319c` | `deployments/project-milestones-20260917T000042Z/hzy-data-runtime.before`（原 `project-deliverables.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-board.1`（`721f46ec-dirty`） | `a291a541411ddccc0ae7f7feb4e0333c8de3118f162e07ae2683e0476bacf5b8` | `deployments/project-board-20260917T005741Z/hzy-data-runtime.before`（原 `project-milestones.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-portfolios.1`（`721f46ec-dirty`） | `4fa643a8c08df2bdaa1e12d91ac76d088b34da3492025bb9b3ae535a3e3fed73` | `deployments/project-portfolios-20260917T012708Z/hzy-data-runtime.before`（原 `project-board.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-list-keys.1`（`721f46ec-dirty`） | `c086094a81037add3eaac9e0d92a0c884397470dbac48801ba107fe7391cc577` | `deployments/project-list-keys-20260917T013015Z/hzy-data-runtime.before`（原 `project-portfolios.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.timesheet-pages.1`（`721f46ec-dirty`） | `7eb79264768c1982b76f957c1d0ea2447d6eff035b11f40a33a4c5f42ee53696` | `deployments/timesheet-pages-20260917T021512Z/hzy-data-runtime.before`（原 `project-list-keys.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.my-work-items-keys.1`（`721f46ec-dirty`） | `c9cf1145ec3896bab98fe074e3b1012bb7178eac1c56e327870cbc2f0081b451` | `deployments/my-work-items-keys-20260917T022545Z/hzy-data-runtime.before`（原 `timesheet-pages.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.weekly-governance.1`（`721f46ec-dirty`） | `c568acb21c7f344977dfe41b939cac6e1b3cb54a2880beb13c7b77bda15a80be` | `deployments/weekly-governance-20260917T024211Z/hzy-data-runtime.before`（原 `my-work-items-keys.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-plan.1`（`721f46ec-dirty`） | `852feff62463f2c8eececf17e5b041ac6e5212820ced1553bd7978225df12573` | `deployments/project-plan-20260917T025125Z/hzy-data-runtime.before`（原 `weekly-governance.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.plan-keys.1`（`721f46ec-dirty`） | `62b95cab74b82aae5f5008a738925e6aca429f5f0b9df744c9daf033516be37c` | `deployments/plan-keys-20260917T025608Z/hzy-data-runtime.before`（原 `project-plan.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.deliverable-keys.1`（`721f46ec-dirty`） | `877e53d12191561c13a659d9d43ae7d47d72edd881f1c349b623afdd10e77001` | `deployments/deliverable-keys-20260917T025817Z/hzy-data-runtime.before`（原 `plan-keys.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.board-execution.1`（`ac4b4917-dirty`） | `2575111677960c4617a785eb26c94508e5dc8f75bcebb0c050d294b3516301b3` | `deployments/board-execution-20260917T031714Z/hzy-data-runtime.before`（原 `deliverable-keys.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.project-weekly-report.1`（`7810c5ff-dirty`） | `38ec00f48a1498b7a498d9d7d32be0f0b9fae2b350fb0277c24c81fae0515c86` | `deployments/project-weekly-report-20260917T040027Z/hzy-data-runtime.before`（原 `board-execution.1`） | 见下方“2026-09-16～17 回填说明” |
| 2026-09-17 | `0.3.219-test.codocs-project-document.1`（`4ce960df`） | `4e9182e28a9d3545f3049e093662ba5ab2c1d5d342d310a62117423a973df7dc` | `deployments/codocs-project-document-20260917T050746Z/hzy-data-runtime.before`（原 `project-weekly-report.1`） | 宿主直读 Codocs 项目文档正文。全量 Go 31 包通过；**启动探测必须带齐 LaunchAgent 的全部环境变量**——只传 `HZY_DATA_RUNTIME_CONFIG_DIR` 会回落到默认配置（8080、无库），等于没验证，补齐后日志到达 `listening on 127.0.0.1:18084` 才算通过；替换后本地／公网 health 均为新版本，匿名与伪造 Bearer 均 401 |
| 2026-09-22 | `0.3.219-test.policy-renewal.1`（`7a0176f2-dirty`） | `59cbf536ea2e3988ebc1085b8f7f8a7de23fd09dbeb2e9b7e4f814ed488f120a` | `deployments/policy-renewal-20260922T184507Z/hzy-data-runtime.before`（原 `0.3.219-test.codocs-version-read.1`，SHA-256 前缀 `53c0f858938d617a`） | 策略同步频率计划阶段 F 第 1 项（用户批准）：新增续签状态接口、Enterprise 读取宽限判定、同修订状态变化和 60 分钟接收上限。先对本机 Console 库执行 `Console-SQL-Migration-verified-policy-renewal-state.sql`（只加两个可空列；表备份在同目录 `verified_policy_snapshots.before.tsv`），再以 LaunchAgent 全部 6 个环境变量做启动探测（到达 `listening`）。替换后本机/公网 health 均为新版本，匿名与伪造 Bearer 401；首轮同步后 `renewal_state=ok`，Enterprise 导航读取与 Console 读写均 200。回滚：复制 `.before` 回原名并 kickstart；新增列可保留，旧版本不读取。 |
| 2026-09-22 | `0.3.219-test.policy-renewal.2`（`7a0176f2-dirty`） | `4cfb3f8914609fa376afc7c9b8129b483240ed2eb7bdee90d1cd139751d5a164` | `deployments/codocs-receipt-schema-20260922T202244Z/hzy-data-runtime.before`（原 `policy-renewal.1`，SHA-256 前缀 `59cbf536ea2e3988`） | 修复 Codocs 个人文档保存 500：5 个写入 `service_command_receipt.command_schema_version`（各模块统一 `VARCHAR(30)`）的 Codocs 标识超过 30 字符，严格模式下插入失败（Error 1406）。按 Aims 既有惯例改为短标识（`codocs-document-update.v1`、`codocs-annotation-mutation.v1`、`codocs-dept-transfer.v1`、`codocs-project-transfer.v1`、`codocs-cabinet-delete.v1`），不改列宽；标识只写入并比对回执，不参与命令摘要，统一库该表当时为空，无存量回执。新增守护测试 `TestReceiptCommandSchemaVersionsFitColumn`（变异检查能抓到旧标识）；`go test ./...` 32 包通过；启动探测到达 `listening`；替换后本机/公网 health 为新版本，匿名 401。 |
| 2026-09-22 | `0.3.219-test.policy-renewal.3`（`5fe828c4-dirty`） | `c58a768fc456069ea9a7e6bb5f3b13f0f0a38417613355c2c4e88d70ee12937f` | `deployments/policy-renewal-sticky-20260923T014408Z/hzy-data-runtime.before`（原 `policy-renewal.2`，SHA-256 前缀 `4cfb3f8914609fa3`） | 评审 R2/R3 修复：续签状态新增 `invalid`（Platform 响应无法验证，无宽限）；`refused/invalid` 对同一 ETag 粘性，之后的 `platform_unavailable/ok` 和同一信封重放不覆盖，只有接纳新信封才重置。无 schema 变化。`go test ./...` 32 包通过；临时 MySQL 集成测试通过（去掉粘性判断的变异会失败）；启动探测到达 `listening`；替换后本机/公网 health 为新版本，匿名与伪造 Bearer 401；下一轮同步 `renewal_state=ok`。 |
| 2026-09-22 | `0.3.219-test.console-steady-identity.1`（`5fe828c4-dirty`） | `17ee4147fb50530aebb489dbea36d5ea36bcbf851576cd7bcfbe97c2b98fdd2b` | `deployments/console-steady-identity-20260923T022254Z/hzy-data-runtime.before`（原 `policy-renewal.3`，SHA-256 前缀 `c58a768fc456069e`） | R1 Console 稳态服务身份（用户决定：方案 A、自动登记、G1 前完成）：信封正文可选 `serviceKeys` 解析；`POST /v1/console/auth/service-tokens/issue` 接受 Console 部署密钥断言（仅在 Console 信封 valid/grace 且含该公钥时，`jti` 一次性）。先对本机 Console 库执行 `Console-SQL-Migration-console-service-assertion-replay.sql`（只新建可选表 `console_service_assertion_replay`）。`go test ./...` 32 包通过；临时 MySQL 集成测试（断言接受、重放、宽限、拒绝/无效/停摆、移除公钥、未迁移、未启用）通过，去掉策略门槛的变异会失败；启动探测到达 `listening`；替换后本机/公网 health 为新版本，匿名、伪造 Bearer 与未登记公钥断言均 401。回滚：复制 `.before` 回原名并 kickstart；新表可保留。 |
| 2026-09-24 | `0.3.219-test.codocs-snapshot-v2.1`（`900fbf0e`） | `f7d969a107ea2eda7a6477a03c6056cf06b54aa88344703de5e7dbe89768f2e4` | `hzy-data-runtime.backup-20260924T001534Z`（原 `console-steady-identity.1`），配置 `config.before-snapshot-v2-*.json` | 用户批准：`hzy_codocs` 先备份（`database-backup/hzy_codocs-before-snapshot-v2-20260924T001441Z.sql`）再装快照两表与 `document_versions.object_key`；`apps.codocs.snapshotV2Enabled=true`；启动探测、本地/公网 health、匿名 401 通过；hzy0 端到端见写入协调合同“阶段 A 实测” |
| 2026-09-24 | `0.3.219-test.codocs-collab-v2.1`（`2119b04c`） | `739379409488bd00f6bcbf4f70bafad7624711ab13b4c005703e24b26be76366` | `deployments/codocs-collab-v2-20260924T023922Z/hzy-data-runtime.before`（原 `codocs-snapshot-v2.1`）；配置 `config.before-collab-binding-20260924T025312Z.json`；Codocs 备份 `database-backup/hzy_codocs-before-collab-v2-20260924T023654Z.sql` | 用户续行授权：`hzy_codocs` 安装四张协作表；Console 登记 `collab.runtime` 与两项精确 grant，凭据仅哈希存库、明文在私有 0600 文件；新增 `deploymentBindings.collab=C000001-test-collab`。全量 Go 测试、两次携完整 LaunchAgent 环境的启动探测、重启后本机 health/Codocs DB 通过；两项真实服务 token 签发与身份声明核对通过。`apps.codocs.collaborationV2Enabled` 仍关闭，未启用协作流量；见写入协调合同阶段 B。 |
| 2026-09-24 | `0.3.223-test.fe2-followup7.2`（`cf8eb398`） | `58db414c947d112ce8422ed500a0df9c79eb4c381c709f218110836c49439c3a` | `deployments/fe2-followup7-stageb-20260924/hzy-data-runtime.before`（原 `0.3.222-test.fe2-documents.3`，SHA-256 `92bc7549291a4e5eb61c96b7de0749100a4af15082a308fbb55b60fba890feee`） | #7 项目产品与产品文档关联 Runtime；干净提交构建、`go test ./...`、携六项 LaunchAgent 环境启动探测通过。本机/公网 `curl` health 连续三组成对 200/新版本；三个新 POST 路由匿名和伪造 Bearer 均 401。开发 Platform release 36 与 C000001 策略 revision 25、六项精确 grant 和签发探测通过；C000002 不变。阶段 C 写前统一 Aims/Enterprise 与 Codocs 库分别加密备份，标记文档经正式 UI 关联，浏览器验收摘要见 `docs/FE-2-Product-Workbench-Task-Script.md`。未新增 migration；Collab 保持关闭。 |
| 2026-09-25 | `0.3.225-test.dev-round2-d1-4.1`（`912f9459-dirty`） | `a0bfe8483f6d8a8f0b12e28994dc1b674dd009670afb7cee5aa1da16b8fde098` | `deployments/dev-round2-d1-4-20260925/hzy-data-runtime.before`（原 `0.3.224-test.route-action.1`，SHA-256 `15b8f3eea6cb79a3fb311a933c1b7800a6db4df74097a2acd21337cdb0c9b39d`） | D1-4 既有个人文档列表 `search` 参数按标题过滤；`go test ./...`、携六项 LaunchAgent 环境启动探测到达本机监听均通过。仅替换本机 Runtime 二进制并重启对应 LaunchAgent，无 schema、grant、配置或业务数据写入；切换后 2026-09-25 01:21:43、:49、:55 UTC 本机与公网 `curl` 连续三组成对 200/新版本，公网 `cf-ray` 存在且 `server=cloudflare`。hzy0 正式页面按标记标题搜索仅返回两份匹配文档，选择后确认按钮可用但未提交关联。可从 `.before` 原子恢复并 kickstart 回滚。 |

| 2026-09-25 | `0.3.226-test.dev-round2-d2-aims.1`（`28e8ad24`） | `171646622dc29b2a84a2dfb881b3d8ba27a01ab6f4b94f8f3c9acf062d55ed42` | `deployments/dev-round2-d2-aims-20260925/hzy-data-runtime.before`（原 `0.3.225-test.dev-round2-d1-4.1`，SHA-256 `a0bfe8483f6d8a8f0b12e28994dc1b674dd009670afb7cee5aa1da16b8fde098`） | D2 Aims 项目更新 Runtime 路由与 Host POST 对齐，同时纳入已提交的 D1-4 标题搜索 LIKE 转义和 100 字限制。全量 Go 测试、LaunchAgent 六项环境启动探测到达 `listening`（随后预期端口占用）通过；仅替换本机 Runtime 并 kickstart，未改配置、schema、grant。2026-09-25 01:52:12、:18、:23 UTC 本机与公网 `curl` 连续三对 200/新版本，公网 `cf-ray` 与 `server=cloudflare`；该路由匿名与伪造 Bearer 均 401。回滚可恢复同目录 `.before` 并 kickstart。业务编辑复验见 D2 回执。 |
| 2026-09-25 | `0.3.227-test.dev-round2-d2-aims.1`（`3dd849d0`） | `9108e4f183c9ccb60878ed77dc4a6269afc3f9339614199699cf740ccb99adca` | `deployments/dev-round2-d2-aims-workitem-20260925/hzy-data-runtime.before`（原 `0.3.226`，SHA-256 `171646622dc29b2a84a2dfb881b3d8ba27a01ab6f4b94f8f3c9acf062d55ed42`） | D2 例行工作项无里程碑详情读取修复。全量 Go 测试、携六项 LaunchAgent 环境启动探测到达 `listening`（随后预期端口占用）通过；仅替换本机 Runtime 并 kickstart，未改配置、schema、grant。2026-09-25 02:06:21、:26、:31 UTC 本机与公网 `curl` 连续三对 200/新版本，公网 `cf-ray` 和 `server=cloudflare`；`work-items:view` 匿名及伪造 Bearer 均 401。回滚可恢复同目录 `.before` 并 kickstart；项目 263 的工作项 308 详情原页“刷新”后显示标题、项目、NULL 里程碑和其他字段。 |
| 2026-09-25 | `0.3.228-test.dev-round2-directory-self.1`（`0451706b`） | `9e54e318b5947875ba16912b4e21b795a53306fc1ce94d3d03cff5ca333ed610` | `deployments/dev-round2-directory-self-20260925/hzy-data-runtime.before`（原 `0.3.227`，SHA-256 `9108e4f183c9ccb60878ed77dc4a6269afc3f9339614199699cf740ccb99adca`） | D2 移交目录按签名 actor 的 directory-self 能力与无里程碑执行页 LEFT JOIN。全量 Go 测试、六项环境启动探测通过；04:03:12、:17、:22 UTC 本机与公网连续三对 200/新版本，匿名端点 401。旧二进制可从 `.before` 原子回滚；业务与 grant 回执见 `.git/codex-report-dev-round2.md`。 |
| 2026-09-25 | `0.3.229-test.dev-round2-codocs-transfer.1`（`6155a2f3`） | `c9a0379b065058daa3d901a8905a48adeae391561df945310e22b1c470608a93` | `deployments/dev-round2-codocs-transfer-20260925/hzy-data-runtime.before`（原 `0.3.228`，SHA-256 `9e54e318b5947875ba16912b4e21b795a53306fc1ce94d3d03cff5ca333ed610`） | 私人文档部门移交沿用 Codocs 的空来源部门表示。全量 Go 测试、Codocs 6 项测试和 typecheck、六项环境启动探测通过；04:30:16、:21、:27 UTC 本机与公网 `curl` 连续三对 200/新版本，公网 `cf-ray`、`server=cloudflare`。仅替换本机 Runtime 二进制并 kickstart，未改配置或 schema；可从 `.before` 原子回滚。浏览器标记文档移交 HTTP 200，一条 pending 共享、一份 succeeded 回执、一条站内通知，无外部投递；详细回执见 `.git/codex-report-dev-round2.md`。 |
| 2026-09-25 | `0.3.230-test.d4-ip-products.1`（`376b5a96`） | `3d4d1faa620e10e78c71e5ab88aac887a1d212c17aafa6b308c7b2ef70b1575e` | `deployments/d4-ip-products-20260925T064628Z/hzy-data-runtime.before`（原 `0.3.229`，SHA-256 `c9a0379b065058daa3d901a8905a48adeae391561df945310e22b1c470608a93`） | D4-1 IP 关联产品受当前用户 IP 与产品双对象范围过滤。全量 Go 测试、隔离 MySQL、六项 LaunchAgent 环境启动探测通过；06:47:21、:27、:32 UTC 本机与公网 `curl` 连续三对 200/新版本，公网经 Cloudflare；新路由匿名与伪造 Bearer 401。仅本机二进制替换并 kickstart，随后仅重启 hzy0-gateway/enterprise；未改配置、schema、grant。hzy0 `zhouguangying` 浏览器 IP 4 详情显示关联 `HZ-TY-S-002`；可用 `.before` 原子回滚。 |
| 2026-09-25 | `0.3.231-test.d4-version-scope.1`（`376b5a96-dirty`） | `d42f10788ec191c9a65ee794c70ac8a3fb365e39acd6d13a6747186a4b731c3c` | `deployments/d4-version-scope-20260925/hzy-data-runtime.before`（原 `0.3.230`，SHA-256 `3d4d1faa620e10e78c71e5ab88aac887a1d212c17aafa6b308c7b2ef70b1575e`） | D4-2 只读版本范围列表与历史。全量 Go、隔离 MySQL HTTP、六项 LaunchAgent 环境启动探测通过；07:02:50、:55/:56、07:03:01 UTC 本机与公网连续三对 200/新版本，公网经 Cloudflare；两路由匿名/伪造 Bearer 401。仅本机 Runtime 二进制替换，随后仅重启 hzy0-gateway/enterprise，未改库、配置或 grant。hzy0 `zhouguangying` 在 HZ-TY-S-002 版本 5 看见范围、协调汇总与空历史；可用 `.before` 原子回滚。制品从本次待审未提交源码构建，提交后应重建固定来源候选。 |
| 2026-09-25 | `0.3.233-test.round3-workflow-heartbeat.1`（本机 A2，待提交源码） | `d3f763cd9c7e77f8104c8055948e92304d5d99110d5668723ecbffd46a93f51a` | `deployments/round3-workflow-heartbeat-20260925/hzy-data-runtime.before`（原 `0.3.232-test.round3-workflow.1`，SHA-256 `aecd449ecb5105ae0c4315d653ef518c8d6b6d403dff2b6450725293e3439339`） | 本机 Workflow 绑定仅由本机开关注入，不属于 Platform 下发绑定；心跳比较精确排除该一项，真实 Platform 差异仍触发重启。全量 Go 测试、携完整 LaunchAgent 环境的启动探测通过。13:32:13–13:35:13 UTC 的 3 分钟稳定观察：launchd runs 恒为 465，新增绑定持久化日志 0；本机与公网 health 均 200/新版本，公网经 Cloudflare。回滚：恢复 `.before` 并 kickstart；旧版本有心跳重启循环，若回滚需同时关闭本机 Workflow binding 开关。 |
| 2026-09-25 | `0.3.238-test.matter-completion.1`（`631d9aec`） | `85b39ff0b3225bec13f9bb5cd25dc674b6d4bed11962caba3036e75f6892bd86` | `deployments/matter-completion-20260925/hzy-data-runtime.before-0.3.238`（原 `0.3.237`，SHA-256 `39b5482c7db5bc5892de5188cd2e7873cf8a560b6e789072832950c46833ddd8`） | 部署前修复 C000001 完成申请兼容视图，并用 Runtime 自身校验 142/142 现存视图；0.3.237/0.3.238 带完整 7 项环境启动探测均到达监听。仅替换本机 Runtime；22:13:50、:55、22:14:00/01 UTC 本机与公网三组 health 均 200/新版本，公网有 Cloudflare cf-ray。仅重启 hzy0-gateway/enterprise/workflow；新 matter Runtime 路由匿名与伪造 Bearer 均 401。业务端到端验收见 `.git/codex-report-round3.md`。 |
| 2026-09-25 | `0.3.239-test.matter-schema.1`（`8b41d2fc`） | `7d8000d4a200a5eed337b5cdf8d8c7fb99f8a8cff2bb4d295df629984d32391d` | `deployments/matter-schema-20260925/hzy-data-runtime.before`（原 `0.3.238`，SHA-256 `85b39ff0b3225bec13f9bb5cd25dc674b6d4bed11962caba3036e75f6892bd86`）；同目录备份原 LaunchAgent plist | Aims 完成审批回执按冻结租约 schema v1/v2 严格配对，修复 matter v2 checkpoint 409；全量 Go、跨模块合同测试通过，Runtime 自身视图校验 142/142，携原 7 项环境启动探测到达监听。仅替换本机二进制；23:49:34、:39、:44/45 UTC 本机与公网三组 health 均 200/新版本，公网均有 Cloudflare cf-ray。原过期 operation 经一次正式 drain 幂等续行成功，复用 Workflow 原回执且实例数不增；详情见 `.git/codex-report-round3.md`。 |
| 2026-09-26 | `0.3.240-test.matter-deliverable.1`（`acd10b86`） | `a8307451d56507c0b1b5fd3246c46df400fba7e00c2e84358891fdcc40664739` | `deployments/matter-deliverable-20260926T003242Z/hzy-data-runtime.before`（原 `0.3.239`，SHA-256 `7d8000d4a200a5eed337b5cdf8d8c7fb99f8a8cff2bb4d295df629984d32391d`）；同目录备份原 LaunchAgent plist | 从干净提交构建；全量 Go 测试、Runtime 兼容视图校验 142/142、携原 7 项环境启动探测到达监听后预期端口冲突均通过。仅替换本机 Runtime 二进制并重启 hzy0-enterprise；00:32:55–00:33:07 UTC 本机与公网三组成对 health 均 200/新版本，公网有 Cloudflare cf-ray。浏览器创建标记 matter 时项目 257 的 plan GET 稳定 403，尚未写入业务数据，等待拒绝点审查后续测。回滚可恢复本行 `.before` 后 kickstart。 |

D1-4 提交前补充的标题搜索字面匹配（LIKE 转义）及 100 字限制未包含在旧 `0.3.225` 二进制中，现已随 `0.3.226` 部署到本机测试 Runtime。

2026-09-16～17 回填说明：上表标注“回填说明”的 13 行，其版本、commit、构建时间、SHA-256 与备份路径为 2026-09-17 事后从运行目录 `deployments/` 备份链逐个 `--version` 与 `shasum` 实测补录，链路自洽（每个目录的 `hzy-data-runtime.before` 等于上一行的二进制）。这些部署发生在其他会话，**当时的验证记录未转录到本文档**，因此“验证”列不填写未经本文档核实的结论；需要追溯时以对应会话记录为准。回滚所需的备份与哈希已完整可用。

Platform 控制面自 9-10 起持续要求更新到 `0.3.215`（`update-journal.json` 残留 queued 操作），旧版本报 `runtime_update_in_progress`，新版本报 `runtime_update_downgrade_not_allowed`；两者都不会执行更新。需要消除该日志时应调整测试控制面的目标版本，不要改动 journal 或放宽降级保护。

## Gateway 与回退

本次只更新 `hzy-test-gateway` 的 `HZY_TENANT_GATEWAY_REGISTRY_JSON` 中 Runtime endpoint，保留租户、应用、SSO 和内部凭据。源码 `prepare-cloudflare-gateway.mjs` 同步指向本机 Tunnel；不要为了重启而重新运行该准备脚本，它会重新生成其他 Worker 的 secrets 文件。

国内源目录 `/wiztek/hzy-test/backups/local-runtime-20260910/` 保留完整 SQL 快照、表计数和哈希。原数据库未删除；`hzy-test-data-runtime` 已 stop + disable，防止双实例写入。

运行目录的 `gateway-secrets-before-local.json` 保存切换前配置，仅用于受控回退。**切换后已产生新的本机写入，不能直接启动旧库并改回 Gateway**。回退应先暂停测试访问、停止本机 Runtime、备份并同步本机新增数据到服务器，核对一致后恢复服务器 Runtime，再更新 Gateway 路由，最后验证登录与业务。避免丢失本次切换后的产品编辑和同步记录。

Cloudflare Tunnel 的 DNS 与本机运行方式参考：[Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/)。

## 开发 Platform 本地库回退围栏

`deploy/test-env/platform-dev-db-localize.mjs rollback` 现在默认拒绝，且不会重启进程。切换到本机库后，旧远端库不再接收开发 Platform 写入；直接使用旧 `rollback.config.json` 会丢掉切换后新写入的数据。`cutover-receipt.json` 和切换时的表校验和只能证明切换当时一致，不能证明当前一致。

若确需回到远端库，须先安排单独的数据回退窗口：停止 `hzy-platform-dev` 及所有写入者并确认写入围栏生效；分别对本机、远端 `hzy_platform_dev` 做可恢复的加密备份；在围栏内将本机库的切换后事实完整同步到远端；逐表核对表集合、行数和服务端校验和均一致，并记录围栏时间、备份、差异与复核人。只有这些证据通过后，才可使用受保护的原 PM2 回滚配置手动切换单个开发 Platform 进程并做健康与授权冒烟。脚本尚未实现可验证的 catch-up 路径，因此没有自动绕过开关；任一步失败应保持本机库运行或从备份恢复，再单独审查恢复方案。
