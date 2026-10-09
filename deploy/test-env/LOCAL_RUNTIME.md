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

`cutover` 在调用 PM2 start **之前**标记启动已尝试（命令报错也可能已产生写入），此后绝不自动恢复远端。start/health/probe/process 阶段失败一律 PM2 stop；仅验证已完成后的 others/receipt/report 阶段失败，且重新确认候选健康，才保留本机候选，否则停止。失败原因脱敏并限 200 字，非零退出。本机库继续是权威源；恢复须围栏、反向追平与校验后人工批准。该主机 pm2-root startup/resurrect 已启用；失败处理不自动 pm2 save，旧 dump 可能在主机重启时复活远端写入者，须冻结主机重启/resurrect，人工核对并批准持久化当前状态，不得直接启动 rollback.config。候选启动前失败才可恢复已核对的原配置。

若确需回到远端库，须先安排单独的数据回退窗口：停止 `hzy-platform-dev` 及所有写入者并确认写入围栏生效；分别对本机、远端 `hzy_platform_dev` 做可恢复的加密备份；在围栏内将本机库的切换后事实完整同步到远端；逐表核对表集合、行数和服务端校验和均一致，并记录围栏时间、备份、差异与复核人。只有这些证据通过后，才可使用受保护的原 PM2 回滚配置手动切换单个开发 Platform 进程并做健康与授权冒烟。脚本尚未实现可验证的 catch-up 路径，因此没有自动绕过开关；任一步失败应保持本机库运行或从备份恢复，再单独审查恢复方案。

### 2026-09-26 Workflow 待办创建 outbox（本机 0.3.243）

按批准顺序：本机 Workflow 库加密备份 → 迁移 012（verify 两项 PASS）→ 干净提交 `04b19a702` 构建 Runtime `0.3.243`。制品 SHA-256 `2c605fc32c713284a8d1ff42037006c8a14ce075c25395d0e5c4dbfab037e58d`；全量 Go 测试、142/142 兼容视图与原七项 LaunchAgent 环境启动探测通过。本机/公网于 13:24:42、47、52–53 UTC 连续三组成对 200/新版本。仅重启本机 Runtime 与 hzy0-workflow；配置与 grant 未变，未部署云端。

回滚二进制/config/plist备份在私有 `deployments/workflow-outbox-012-20260926T132314Z/`（旧二进制 SHA-256 `4ad6c930b5a480c1affed999c675e9f5b5c49dc7651e4ca198f8ac151c6778d2`）；恢复 `.before` 并 kickstart，新增012表可保留，勿回退测试业务数据库。Workflow库备份在 `database-backup/workflow-outbox-012-20260926T132238Z/`。

新 matter314/任务5通过一次Aims drain创建通知 outbox1（pending）。一次正式Workflow drain在 eligibility 上403，published0/failed1，outbox1仍pending/attempt1，已停止不重试；通知及投影尚未落库，B恢复投递未验收。matter313/任务4与314/任务5均保留待审；旧lifecycle outbox1–3仅随正常drain增加尝试、未手动修改。详细阶段与安全诊断见 `.git/codex-report-round3.md` 最新回执。

## 2026-09-26 原生项目可访问文档 Runtime

本机更新为 `0.3.244-test.project-document-accessible.1`（`4d332b64`），SHA-256 `d9fff700fd0c75b34a55e303c66b221fed14a7e44df28c533ce264f17e0b1ef3`。备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/deployments/native-accessible-20260926T181912Z`；无 schema 迁移，兼容视图 142/142，通过全量 Go 测试与带齐 LaunchAgent 环境的启动探测。本机/公网 curl 连续三次 200 新版本，精确 Enterprise 原生 accessible 路由匿名 401。zhouguangying 经 Host 在项目257/263验证 accessible 200。Console v2.23仅新增 grant13227420（data-runtime，Enterprise项目文档 read），原 business scope 真实签发200、绑定验证通过；无 tenant-runtime 新行。


### 2026-09-26 ADR-017 F3-1 issuer 权威修复（本机）

本机 Runtime `0.3.245-test.adr017-issuer.1`（`647f0245`），SHA-256 `1e559d9ed67314af984d1b63f2cbb0549c0c599c050edd8b632151c683f69ed0`；备份 `deployments/adr017-issuer-20260926T194953Z`。无schema/grant变更，视图142/142、带齐LaunchAgent环境启动探测与本机/公网curl连续三次200新版本，匿名401；enterprise/workflow/aims现有scope各一次真实签发200，issuer/绑定正确。签发issuer取认证器实时trust，错issuer403与未配置503由隔离回归验证。回滚恢复该备份二进制后kickstart本机Runtime。


### 2026-09-26 ADR-017 F3-2 服务签发身份（本机）

本机 `0.3.246-test.adr017-identity.1`（`44899235`），SHA-256 `513cf9b94ae826640683ff1b6e847f9366fcb14a304403c722b6ab55635657a5`；备份 `deployments/adr017-identity-20260926T200028Z`。无schema/grant变更，视图142/142、启动listening、本机/公网curl连续三次200新版本、匿名401；enterprise/workflow/aims现有组合各一次真实签发200与完整绑定正确。通用sign身份严格绑定当前凭据所属客户端；NULL app空来源失败关闭。回滚恢复该备份二进制并kickstart本机Runtime。


### 2026-09-26 ADR-017 阶段1 F3-3～F4-1 本机统一验收

本机Runtime `0.3.247-test.adr017-stage1.1`（`4e6c05cb`），SHA-256 `682314ce0ea96cf36a5a44108b01c2d2ca5401aad3bf9be0599091b968bbef59`；二进制/config备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/deployments/adr017-stage1-binary-20260926T213456Z`，加密Console全库及plist备份 `deployments/adr017-stage1-20260926T213322Z`（解密比对通过）。干净worktree构建，视图142/142、原LaunchAgent环境启动listening、本机/公网curl连续3组200新版本、匿名401。enterprise/data-runtime policy-bundle、aims/data-runtime项目文档+read、本机workflow/console eligibility与workflow/notifications publish均真实签发200且精确来源部署符合登记。SSO授权码issue/consume各一条success，真实refresh200与consume success，回到Enterprise并确认zhouguangying；导航与项目263主API200。错issuer/错aud反例由隔离回归证明。无schema或grant变更；该实例无auth-jwt-trust overlay，所以未把env/default信任写入共享初始化事实（receipt新增0），正式bootstrap的共享事实冲突由真实隔离MySQL与server测试覆盖。恢复备份二进制后kickstart可回滚，不回退业务库。


### 2026-09-26 ADR-017 grant audience事实与兼容表关闭

经批准，本机C000001只迁移dry-run支持的93行（Console90/Codocs2/Enterprise1），JSON合并audience/semanticScope、保留其它键，updated_at反映真实变更；逐行93/93通过，3个排除项及其它行保持不变。全表加密备份`database-backup/adr017-audience-facts-20260926T214147Z/`再次解密核验通过。迁移后历史22精确组合+1前缀代表真实签发23/23为200，跨audience403。兼容表已清空（`cd8758f3`），缺失/NULL audience全部失败关闭；其他环境升级前先盘点补齐合法grant事实。

Runtime `0.3.248-test.adr017-audience-facts.1`，SHA-256 `0cd445df901809ff1ee73d47879ac39aa57ac5d012aa2371a346ef32b6fcf8b4`；备份`deployments/adr017-audience-facts-binary-20260926T215916Z/`。干净提交构建，全量Go/race/隔离MySQL通过，verify-views142/142、启动listening、本机/公网curl连续3组200新版本与匿名401。部署后hzy0 Enterprise、Aims、本机Workflow通知与eligibility四组真实签发200，来源部署/issuer精确核对通过。回滚恢复二进制备份并kickstart，保留已核验的audience事实，不回退业务库；本轮未改schema/云端/Platform或Worker开关。


### 试点前旧 Workflow lifecycle 测试 outbox 清理（2026-09-27 00:06 UTC）
经批准，仅本机 C000001 精确删除 `flow_actionable_outbox` 主键1–3，事务影响行数3、删除后0；其它行摘要不变。原因：三个已批准测试实例无通知创建行、无Console待办投影，旧失败项没有可用终止状态且无重试上限。执行前核实无入站外键、无outbox-id关联列，按actionable_key确认创建与投影均0；不改实例、审批、通知、grant、ENUM或代码。
相关四表加密备份 `database-backup/pilot-lifecycle-cleanup-20260927T000604Z/workflow.sql.gz.enc`，SHA256 `f460cb110f1e5b16161c5c80dfddd0db13a1aec5ef8d6a7a8ae8b316a42c96cc`；AES-256/PBKDF2，解密后与原dump字节完全一致。恢复只按该备份精确恢复三条测试记录，勿整体回退业务库。正式 abandoned 终态、审计与重试上限列为后续 Workflow outbox 改进；322条缺绑定grant保持不动，列P5补验缺口。


### PA-03 项目经理关系写入与连续编辑（2026-09-27）

- 已审精确提交 `cbc3ed5c3`（25文件）与 `8eff3e0c9`（2 Go文件），仅推GitLab。Runtime项目锁内静态许可或当前leader/active manager、回执前撤权复核；leader未变不触碰其它manager。无schema/grant修改。
- 当前本机 `0.3.251-test.pa03-manager-continuity.1`，SHA256 `99229e581c5b012d457703fb58d778e2a88abe2035f13ecda78f3c57210fb2ce`。干净worktree构建、142/142视图、启动listening、本机/公网三轮200新版本、四组签发200且绑定通过。
- 回滚点：`~/Library/Application Support/HuizhiYun/test-runtime/deployments/pa03-manager-binary-20260927T025355Z/`（binary/config/LaunchAgent），只替换本机Runtime；配置未变。M前新全库加密备份可解密校验。
- 项目263正式UI经理授予后test连续两次编辑成功并恢复原文，manager持续有效；完整M通过：观察≥30分钟、28次成功策略同步、正式空drain200；移除后51.282s合法写403、62.113s入口隐藏，test成员0/角色基线不变/原值恢复。证据在 `.git/codex-report-round3.md` 与 `.git/codex-pa03-m-observation.json`。


### 2026-09-27 PA-01 项目范围读取第2批（配套上线）

本机Runtime `0.3.252-test.pa01-project-read.1`（`93b48c9e`），SHA256 `66412eb773076130dbccd33fa6358262193be1c9968d016e235f8a45e07ce771`；备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/deployments/pa01-read-binary-20260927T040843Z`。干净提交构建，视图142/142、启动listening、本机/公网三组200新版本与匿名401，四组服务签发200绑定正确。仅配套重启Console/Enterprise，无schema/grant变更。登录态列表COUNT30/含归档144、分页10/10/0与详情263200；浏览器Nuxt动态模块加载失败待诊断，视觉验收未完成。恢复备份binary并kickstart可回滚。


## PA-01 第3批A嵌套读取本机部署（2026-09-27）

Runtime `0.3.253-test.pa01-nested-read.1`（`45df913d`），SHA256 `e4c0c8da370fc0291882fc955551d432672a0245f31af0d7700ef4bbc54e7e3b`；备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/deployments/pa01-nested-read-binary-20260927T113425Z`。干净提交构建，verify-views142/142、启动listening、本机/公网三组成对health200新版本、匿名401，配套仅重启hzy0-enterprise。无schema/grant写入；浏览器会话过期，zhou登录后抽验四类页与计划分页。回滚恢复该备份binary后kickstart，Host同步回退对应合同。


### 2026-09-27 Enterprise 服务使用时 scope 映射（本机 0.3.256）

精确提交 `e84ce150` + 错误分类补修 `a5753a9d`（均仅推 GitLab），干净 worktree 构建 `0.3.256-test.service-grant-classification.1`。SHA-256 `77b53e7b7213447d33f13289f3ba2c3256fc5b9817b608d56756eabe2c18680b`；备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/deployments/service-grant-classification-binary-20260927T121138Z`。Go全量、Console/auth/server race、隔离MySQL回归通过；兼容视图142/142、完整LaunchAgent环境启动探测、本机/公网curl三组成对200新版本，匿名401。

Enterprise真实能力 `aims:projects:view` 与 `aims:project-documents:read` 签发200、claims绑定正确；zhouguangying Host项目263详情与accessible使用200/code0。映射无字面回退；撤销/不匹配/冲突403与DB依赖503由联合认证链回归验证。仅替换/重启本机Runtime，未改配置/schema/grant，未部署云端。回滚恢复本次二进制备份并kickstart同一LaunchAgent；不回退业务数据库。


### 2026-09-27 Altoc 本机只读域激活 / Runtime 0.3.258

干净 `f9b4f2b0` 构建 `0.3.258-test.altoc-activation.1`，SHA256 `4cb6844a58d5cb45e62f664200d2e7b5fb7cf87fe38d1cf9b31866d1f0c5d73e`。先在完整统一库隔离副本（158表/142视图）apply→155视图verify→rollback证明既有baseline不变，再加密备份现库至`domain-backups/altoc-live-20260927134003591/`并解密自检。新增13 Altoc物理表与13 INVOKER兼容视图，Registry/generation1保持不变；配置仅加Altoc域（Enterprise owner、unified read、write/scheduler disabled），原域零修改。独立迁移账号执行DDL，Runtime仅补13视图SHOW VIEW元数据权限；部署前155/155视图与全量Go通过。本机/公网于13:55:20–31 UTC三组成对200新版本，六项Altoc签发200、绑定正确；匿名精确POST按Altoc既有合同403，不误写为401。v2.25仅新增G2 grant13227424–26，旧行不变；27条ZZ-TEST-ALTOC-20260927纯标记样本登记`.git/altoc-seed-receipt.json`，test未增人员授权，十二页浏览器验收待安排。回滚须停Runtime，精确删除本批13表/视图、撤13新SHOW VIEW、恢复配置/LaunchAgent/二进制、核对原142视图/Registry；G2新grant按ID停用，禁止全库覆盖既有域。


### 2026-09-27 P2–P4b 分页配套本机 Runtime

经Claude与Codex-sol2确认，P5a1尚未审查/提交，本次仅从干净`31a91b59`构建`0.3.259-test.pagination-p2-p4.1`，SHA256 `0ed48b03a69e96a7dcc6e08d10c9fabe8744373dc6406d43637d21e9759315e4`。Go全量通过、155/155兼容视图通过、完整LaunchAgent环境启动listening；备份binary/config/plist至`deployments/pagination-p2-p4-binary-20260927T144843Z/`。14:48:46–57 UTC本机/公网curl连续三组成对200新版本，公网Cloudflare标志true，匿名accessible401、本机smoke7/7。无schema/grant/config写入，只替换本机Runtime；回滚恢复本次binary备份后kickstart，不回退业务数据库。安全回执`.git/codex-pagination-runtime-259-receipt.json`；登录态P2–P4b复验另记round3。

### 2026-09-27 Pagination P5 reviewed candidate

Clean 7b412021 deployed as 0.3.260-test.pagination-p5.1 (excludes dirty P5b2), SHA256 `66bd8796f6a56df94a6427a0b656496f5ec1048cdbab3b6b2285c61c31af8697`. Initial attempt rolled back to259 after unclassified curl failure; one approved subprocess IPv4 retry passed three local/public 200+new-version pairs at16:15:00/05/10 UTC. Go full tests,155 views,startup listening,smoke7/7 PASS; no schema/grant changes. Backup `pagination-p5-binary-20260927T161457Z`; safe receipt `.git/codex-pagination-runtime-260-receipt.json`.


### 2026-09-27 删除证据受管安装与 Runtime 0.3.261

- 已审提交 af8c4bdc / 5e494f22 / 322a1c5a（仅 GitLab）；固定证据lane完整统一库副本 apply/verify/rollback PASS，现库新加密备份可解密，Runtime停止、迁移锁内仅创建 aims_work_item_deletion_evidence 与兼容视图；generation=1及既有域不变，155→156视图。Runtime账号只补新视图SHOW VIEW元数据权限，与Altoc安装口径一致，无新增业务权限/service grant。
- 干净322a1c5a候选 0.3.261-test.evidence-pagination.1（含P5b2/P6a）；156/156、startup listening、本机/公网curl -4各3次200+新版本，匿名401。SHA256 6a981c45092120c2ead77ef0905d3c7518e635edecbdf638e3a9ffad9c984ce6。回滚保护副本：test-runtime/domain-backups/deletion-evidence-live-20260927T203256Z。证据非空后禁止DROP回滚；配置/binary回滚须保留证据表。
- 首页参与项目200/total8；项目263周报及项目集读API200。新标记337正式创建/删除200，证据id1留存；原315–336不动。同步回调标记338/工时104/实例与task28待test驳回即时回调验收，旧task4/5不动，104待清理。安全回执 .git/evidence-{live-install-result,runtime-261-receipt}.json，浏览器截图 .git/evidence-261-qa/。

- 0.3.261同步回调复验：test仅驳回task28一次，callback26 failed/attempt1/local_callback_target_binding_invalid，338仍in_review；未恢复drain，4/5不动。工时104暂留，待受信目录传输修复后以同callback/key恢复，不能重提或重新决策。

- 受信目录修复b353dc0d审后热加载，正常正式Workflow drain一次：callback26 success/attempt2，338恢复in_progress，notification/actionable各1送达，4/5不动。zhou正式删除104200/权威COUNT0。a3eb6913弹窗双击仅创建339，同键同payload200/原receipt无重复；339正式删除200/冻结证据1留存。恢复与清理安全回执 .git/evidence-261-recovery-cleanup.json。


### 2026-09-27 PA-01 第3批C/D：0.3.262 本机回执

- C 9e7aa0f1、D fc735535 已精确提交并推 GitLab；D 15文件。PA-04（四个既有成果 handler 无 service-command 幂等回执）已纳入 MODULE_CONTRACTS，未扩范围。
- 干净 worktree /tmp/hzy-pa01-cd-build 固定 fc735535，Runtime 0.3.262-test.pa01-state-deliverable.1，SHA256 209cd34302f2d8f8d03d42737d15bb319f953b8c4944ac396c1913205ee251b6。三库新加密备份解密逐字节一致：database-backup/pa01-cd-20260927T213410Z。156视图PASS，启动listening，21:35:20–32 UTC本机/公网连续3轮200新版本、匿名401。配置/schema/grant未变。
- 仅重启Enterprise；首轮smoke在启动窗口503，随后7/7。浏览器冷模块加载后正常；zhouguangying个人菜单确认、auth/me/navigation200。accessible-departments403抽验前已存在，未放宽授权。
- 项目263正式UI新建标记matter340，start200、成果234创建200。正式Host PUT成果234描述编辑200，execution-context回读一致。项目产出页不列事项成果，编辑使用登录页面正式Host API而非直写库。
- 成果234正式DELETE200；matter340正式DELETE200（首请求遗漏projectId400，补齐后同键续行200）。回读matter404、成果筛选200且0行；删除证据保留，无审批/工时/通知，任务4/5不动。
- 下一小批里程碑：逐owning project锁内复核并保留领域门槛，按批准清单继续送审。


### 2026-09-27 PA-01 3E1/E2：0.3.263 本机回执

干净de6c1425构建 0.3.263-test.pa01-milestone.1，SHA256 8ade7f372faafe39db7393fc5d67c24eff52c8d96511f77775ca859bbaedba33；回滚备份 deployments/pa01-e12-binary-20260927T220453Z，新三库加密备份解密PASS。156视图PASS、启动listening、本机/公网22:04:56–22:05:07UTC三轮200、匿名401；schema/grant/config不变。恢复E1 Host hold并仅重启Enterprise，smoke7/7。zhou正式Host创建里程碑142=200、页面合法日期编辑200、清理DELETE200/权威残留0。空日期500、手工周期缺template_key及非空列表缺创建入口列缺陷；rollover浏览器无安全样本，未宣称200。

### 2026-09-27 PA-01 3E3/E4：0.3.264 本机回执

从干净 `debd0592` 构建 `0.3.264-test.pa01-time-product.1`（含已审工时三写、项目产品关联范围复核及里程碑空日期修复），SHA256 `f052da52eee8fd7d158a15ab711c453cc28a532ced6a6070af1bee77e650aefe`。三库加密备份并逐份解密核对通过：`database-backup/pa01-e34-20260927T222938Z`；二进制/配置/LaunchAgent 回滚备份：`deployments/pa01-e34-binary-20260927T223033Z`。Go 全量通过、156/156 兼容视图通过、原 LaunchAgent 完整环境启动探测到 listening；本机/公网 curl 于 22:30:36–47 UTC 三组成对 200 且 version 均为 0.3.264，公网有 Cloudflare 边缘标记；匿名新 POST 401。仅重启本机 Runtime 与 hzy0-enterprise，hzy0 smoke 7/7；schema/grant/config 未改。回滚为恢复上述二进制并 kickstart LaunchAgent，Host 对应合同须同步回退。

zhouguangying 正式 Host 工作项 308 新建标记工时 105（0.10h）200；正式 Host PATCH 描述 200、刷新后可见；正式页面删除 200，`aims_time_entries.id=105` 残留 0。项目产品：本机唯一 active product_dev 可用项目 257 已关联 zhou 唯一可见产品 `HZ-TY-S-002`；同项目同产品的新键重复提交 409，`aims_project_products` 仍 1 行、该测试键 receipt 0。浏览器新增关联 200 缺安全可清理样本，隔离 MySQL 新建/回放 200 已通过，不把浏览器 409 冒称正例。

### 2026-09-28 PA-02 / 管理员项目本机 Runtime 0.3.274

干净 `ed4765a1` 构建 `0.3.274-test.pa02-admin.1`，含 PA-02 后端/面板、管理员项目后端/页面和手工周期里程碑拒绝修复；Go 全量与兼容视图 156/156 PASS，完整 LaunchAgent 环境启动探测到 listening。SHA-256 `cbbbf0378ac1e55db146203841f7d43664f13217759e3258ecbeafd45306eb6d`；二进制/配置/plist 回滚备份 `deployments/pa02-admin-274-binary-20260928T043511Z/`。本机与公网 curl -4 三组成对 200 且版本一致，匿名 POST 401，hzy0 smoke 7/7。仅重启本机 Runtime、hzy0-gateway、hzy0-enterprise；无 schema/config 变更。回滚恢复备份二进制并 kickstart，Host 对应合同须配套回退。

C000001 Console grant v2.26 写前完整加密备份可解密：`grant-backups/v2.26-20260928043255700/service_client_grants.json.aes-gcm`（密文 SHA-256 `12ba78c9fbc7cccf359d22346ecaa588d1c463da1ae76607bdb113f4f4b60d35`，独立密钥未输出）。新增精确 enterprise.runtime→data-runtime `aims:admin-projects:view/edit` 两行 ID `13227427/13227428`；verify 两行均 1/1、重跑 0、原有行不变。Gateway 加载新精确 egress 后两种 scope 真实签发均 200，身份绑定吻合；无令牌落盘。浏览器以 zhouguangying 验管理员列表/编辑、项目内访问控制保存 200；正式创建标记 R 项目 ID 265、编码 `ZZPA02R20260928` 并设为 project_team，待 test 非成员/观察者/撤销计时验收。详见 `.git/codex-report-round3.md` 对应回执。


### 2026-10-02 项目页候选 02cd5252 切换预检受阻（未切换）

2026-10-02T18:34:55Z 从干净 detached HEAD `02cd5252bebf31183e701fada91840d63455410b` 建候选 `/Users/gavinzhou/orca/hzy-candidates/02cd5252`，离线冻结锁文件安装依赖，未混入主工作区内容。只读 `hzy-enterprise-verify-views` 返回非零：156/156 定义核对一致、1个歧义精确定义解决，但14个现存视图不在新校验器的 reviewed install set 中（contact、contract、contract_billing_schedule、contract_line、contract_obligation、contract_payment_term、customer、lead、opportunity、opportunity_stage、quotation、quotation_item、receivable_plan、service_command_receipt）。mapping_hash=`6c22db525e6f0a05e74dc2dd4bb4cd14282e8b9eb33b903f11fecf0083728786`。

新增集合检查来自 `eb9ed8acf` / `e3a598eb0`；当前 Install 仅取 InstalledDomains(aims/assets)与可选workflow，现存Altoc等视图被判集合外。不能以删除现存视图、改变配置或绕过校验来继续，本次按任务书在替换/重启前停止；需先审定兼容安装集合与现库的处理办法。未构建/部署新版本，无二进制SHA和部署备份；无需回滚。Runtime仍是 `0.3.292-test.c000001-b1b2.6` / `4072d2aa`，PM2进程仍分别使用原b84f31a9/40bd709c候选，本机入口23120/enterprise返回200。未改schema、grant、业务库、Runtime配置或任何运行进程，未碰云端/生产/GitHub。只读校验日志 `/tmp/hzy0-02cd5252-views.log`；Go全量日志 `/tmp/hzy0-02cd5252-go-test-final.log`。访问地址仍为 https://hzy0.isme.dev/enterprise/ ，不是新候选验收结果。

### 2026-10-02 项目页候选切换完成 / Runtime 0.3.293

Claude 接续上面受阻的预检：`571dd58b` 修正 verify-views，使绑定已配置的独立安装域（Altoc，`hzy-enterprise-add-altoc`）的改名映射计入可接受视图族，仍逐个精确核对定义，安装集与 mapping_hash 不变。复跑结果 156/156 定义一致，仅剩 1 项：`service_command_receipt` 视图。该名属于共享物理名（aims/assets 各自映射到自己的表），不应建视图，是切换前就存在的本机库遗留；新旧 Runtime 都不依赖它，本次未删除（删除属于本机库写入，待批准）。

从干净 `571dd58b` 构建 `0.3.293-test.project-pages.1`，SHA-256 `4d65ce6bceaf24b634d01d341490e3d1e318923f0948bb6f438fb7f92fbc7f3b`，Go 全量通过。二进制、config 与 plist 回滚备份在 `~/Library/Application Support/HuizhiYun/test-runtime/deployments/project-pages-293-binary-20261002T185107Z`；原二进制为 `0.3.292-test.c000001-b1b2.6`。替换后 kickstart LaunchAgent。18:51 UTC 起本机与公网三组成对 200，且版本均为新版本；新增 POST 路由（`console/org-brand:view`、`aims/deliverable-quality:waiver`）匿名访问均返回 401。

hzy0 的六个 PM2 进程（gateway、enterprise、codocs-editor、console、workflow、aims）由 b84f31a9/40bd709c 切到 `/Users/gavinzhou/orca/hzy-candidates/02cd5252`（应用代码与 571dd58b 相同）。Gateway 内部凭据沿用原 PM2 环境，未落盘、未输出。被 git 忽略的本机凭据文件（`.cloudflare-workers/{aims,codocs,console,gateway}`，6 个，0600）从 b84f31a9 原样复制。四个端口均已监听，公网匿名访问被 Access 302 拦截。

未改 schema、grant、业务库或 Runtime 配置。回滚：Runtime 用备份二进制覆盖后 kickstart；应用 `pm2 delete` 后，从原候选以同一 profile 执行 `local-enterprise.mjs up`。登录态浏览器验收另记。


### 2026-10-03 APF 三域本机安装 / Runtime 0.3.294

经用户批准（含手工删除旧 Altoc 对象和新建迁移账号），用 `c04b323c` 的 `hzy-enterprise-add-apf` 在统一库 `hzy_enterprise_shadow_review_20260913` 安装 APF 53 张新表（altoc_/finance_/people_ 前缀）。写前备份在 `~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-install-20261003T034508Z/`，内含统一库与 Console 库加密转储、config/plist/二进制原件，时间线见其中的 `window.log`。过程：旧 add-altoc 回滚因基线漂移被拒，于是手工删除 13 个旧 Altoc 视图和 13 张表（`lead` 需加反引号）；删除遗留的共享名视图 `service_command_receipt`（apf.go 安装预检会拒绝它）；首次创建的 53 张空表因此作废，删掉后重新 plan（reviewHash `8b1018a1…`），apply 与 verify 均 PASS。

Runtime 换成 `0.3.294-test.apf-m1.1`（`c04b323c`），SHA-256 `129c12c54cea03e12cac4e6f3479341dc7c916b9cc7009f607508205c322168d`。APF 配置：altoc/finance 统一读写，people 仅读，scheduler 关闭。verify-views 142/142。Console 新增 grant 行 13227445–13227452，其中 9 项 scope 可签发。hzy0 应用切到候选 `/Users/gavinzhou/orca/hzy-candidates/c04b323c`（需对全部模块执行 `nuxt prepare`，并从旧候选复制 `.cloudflare-workers` 凭据）。之后又热同步了 defe106b 拓扑、Console egress 生成器、127f872e 与 d60891c8 的 Finance 修复。

浏览器验收（zhouguangying，1440/390）：Finance 银行账户新建 → 详情 → 编辑（v2）→ 停用（v3）全部 200，余额快照页正常。测试夹具 `CLAUDE-FIXTURE-20261003 测试账户`（`BA-c49d9472…`，脱敏 `****0001`、无 Vault 引用）已停用；经用户批准后于 04:22 UTC 物理删除（连同 3 条审计日志和 3 条服务命令回执），删除前行备份在 `domain-backups/fixture-bank-delete-20261003T042221Z/rows.sql`，页面复查为 0 条。Altoc 客户页列表 200，但三个 Altoc 页面没有加载 altoc 权限快照，且 `hasPermission` 传的是复合字符串，导致写入口不显示，修复交由 WP4-fix。回滚：用备份恢复二进制、config 和 plist 后 kickstart；库按备份解密恢复。

后续（同日）：Altoc 三页权限修复 `8c23d79a`、交互重做 `1363a4d6`、Foundation 目录批量读取改走共享投影 `40f2587a` 已热同步到 hzy0 并复验（1440/390）：新建客户 200，负责人显示姓名，详情分组与编辑 Slideover 正常。测试客户 `CLAUDE-FIXTURE-20261003 测试客户`（`CU-a8fbb424…`）经用户批准于 04:45 UTC 物理删除，连同 1 条审计日志和 1 条回执；删除前行备份在 `domain-backups/fixture-customer-delete-20261003T044528Z/rows.sql`，页面复查为 0 条。


### 2026-10-03 APF 启用前置核验中止（未改变运行环境）

用户批准本机 hzy0 启用，固定候选 `3dc87ed9e253b061bfe3e5169dd3bc7d75a18591`；干净 worktree `/Users/gavinzhou/orca/hzy-candidates/3dc87ed9` 已建立，14b 未完成改动留在主工作区。候选全量 Go 测试与三项 CLI/Runtime 构建通过，离线 frozen-lockfile 依赖安装通过。新 Runtime 制品版本 `0.3.295-test.apf-enable.1`，SHA-256 `3c702feca89f1c4a6c3cab6557d568ebcededaf662c7c5d393105c5f669d8f24`，**仅构建，未安装/启动**。

私有准备目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T104624Z`（0700，文件0600；运行二进制副本保留可执行权限）保存原 config/plist/binary 和 PM2 启动快照。**三库加密转储及解密验证尚未完成，不能视为备份完成。** 本机数据库绑定只读核验通过：统一库 `hzy_enterprise_shadow_review_20260913`、Console `hzy_console_test_local_20260910`、Workflow owning 库 `hzy_workflow_test_local_20260925`。Workflow preflight 查询成功，七个目标元组均尚无 action/route/schema，未 seed。

停止原因：执行者核对 test active 状态时误用 `users` 表，返回 `ERROR 1146 (42S02): Table 'hzy_console_test_local_20260910.users' doesn't exist`。按任一步失败即停止规则中止，没有继续探测或绕过。尚未停 Runtime/PM2、未执行 plan/apply、未写库、未改配置、未切换进程；安装 reviewHash 与新增 grant 行 ID 均无。原 0.3.294 和旧候选仍运行，无需回滚。下一次执行须先按真实 Console schema 修正账号只读核验，再完整完成加密备份等放行步骤。未提交或推送。


### 2026-10-03 APF 启用续行：备份权限失败，已恢复原服务

沿用用户批准，先用 SHOW TABLES LIKE 确认 `directory_users`，test 与 zhouguangying 均 active；enterprise.runtime/workflow.runtime active 且存在 current credential。候选11个模块 Nuxt prepare 均通过（Foundation、Console、Workflow、Aims、Assets、Codocs、Collab、Altoc、Finance、People、Enterprise），凭据仅私有复制。

维护窗口停下 hzy0 六个 PM2 应用和 Runtime 后，统一库完整备份失败：mysqldump 使用现有统一库运行账号执行 SHOW EVENTS 返回1044 Access denied。没有跳过 events/routines 或修改权限继续。转储未完成，不算有效备份；已删除未完成的 gzip 转储。备份准备目录仍为 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T104624Z`，其中受保护原启动快照保留。尚无加密三库备份、安装 reviewHash、新增 grant ID；没有 apply/seed、没有变更二进制/config/plist或应用候选路径。

已 enable/bootstrap 原 Runtime，并 restart 原六个 PM2 应用（全部 online）。本机与公网 `/runtime/health` 连续三轮200，版本均为原 `0.3.294-test.apf-m1.1`。恢复证据在目录中的 restored-health.json；安装状态未改变，无需数据库回滚。继续前需确定可完成完整备份的本机备份账号/权限，不能将运行账号权限失败当作完整备份成功。14b仍暂停，未提交/推送。


### 2026-10-03 APF 启用续行：安装通过，阶段 seed 权限失败，已逆序回滚

授权仍有效，备份改用指定本机 migration-admin 的 root（临时0600 defaults，不在参数/日志放密码；用完删除）。统一库、Console、Workflow 三库转储均含 single-transaction/routines/events/triggers，AES-256-CBC+PBKDF2 加密，逐份解密摘要及 gzip 完整性通过；Runtime binary/config/plist 和 PM2 定义加密打包解密摘要通过。目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T104624Z`；key.pass0600，数据库转储仅保留 .enc。

Runtime及六个PM2应用停止后，使用原已获批非root安装账号，七段 plan/apply/verify 均通过；reviewHash前缀：

- people-private: `4fc687755af2`，后已 rollback PASS
- people-facts: `3a6e5b63439d`，后已 rollback PASS
- finance-B3: `15f2b0239a29`，后已 rollback PASS
- finance-13a: `9f6abd876c4e`，后已 rollback PASS
- finance-13b: `9c3b748fc34d`，后已 rollback PASS
- altoc-sales-B2: `e4691376948d`，后已 rollback PASS
- finance-cost: `42ebc8f475f6`，后已 rollback PASS

Console：data-runtime/tenant-runtime各9项 verify PASS；保留原workflow:proxy；新增精确workflow callback及4项directory通道。新增grant行ID：13227460, 13227461, 13227462, 13227463, 13227464, 13227465, 13227466, 13227467, 13227468, 13227475, 13227476, 13227477, 13227478, 13227479。精确ID停用候选在私有 grant-rollback.sql，**尚未执行停用**。Workflow七个元组人工定义成功：test审批，zhouguangying installer/seed actor；preflight回读一元组一active默认route/schema，节点approve且assignee=test。定义ID清单在 workflow-seed-ids.tsv，**定义保留，不删除/覆盖**。签发探测尚未运行，不宣称完整授权验收。

中止点：按方案§3执行Altoc B2阶段配置候选时，安装账号只有安装权限，没有INSERT权限，`ERROR 1142: INSERT command denied ... altoc_opportunity_stage`。seed前0行，整条INSERT失败；未换账号继续。Runtime候选配置和二进制尚未激活，候选SHA `3c702feca89f1c4a6c3cab6557d568ebcededaf662c7c5d393105c5f669d8f24` 仅制品。

已按finance-cost→altoc-sales-B2→finance-13b→finance-13a→finance-B3→people-facts→people-private逆序调用原receipt rollback，七段全部PASS；原mapping verify-views PASS。随后enable/bootstrap原Runtime，restart原六个PM2，全部online；本机/公网health三轮均200、原0.3.294-test.apf-m1.1。配置/binary/plist/候选路径保持原值，统一库增量已回滚。**Console新增grant和Workflow七个定义仍保留，这不是全库状态恢复**；下一次需verify复用，不重复seed、不把已有候选当意外冲突覆盖。新表无业务写入，未做全库备份恢复。

继续前需指定Altoc阶段配置seed的可写本机账号（运行账号DML或获准管理员），并处理上述已存在seed的续行核验。受保护状态/回滚/健康日志见同目录。APF14b改动仍保留且暂停，没有提交/推送，没有云端/生产/Platform写入。


### 2026-10-03 APF 续行：精确表授权顺序阻断（未改状态）

按批准使用本机管理员，原安装账号GRANTS已保存到私有目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T104624Z` 的 migration-grants-original.txt。尝试仅给 altoc_opportunity_stage 授予INSERT，MySQL返回1146：该表已在上轮B2 rollback中删除，尚不存在，表级INSERT授权被拒绝。临时defaults已删除；未补任何权限、未停服、未重跑安装、未重复seed、未切换Runtime。原0.3.294及旧PM2候选保持运行；上轮保留14条grant/7个Workflow定义未改变。

执行顺序须改为七段串联创建B2表后，再授予该精确表INSERT、保存撤销SQL，再阶段seed；不能先向不存在的表授权，也不能以CREATE/库级权限绕过。状态未改变，无需本轮回滚。上轮Console/Workflow seed与原备份不同，恢复续行时仍须刷新相应备份并verify复用。未提交/推送。


### 2026-10-03 APF 启用续行：新Runtime启动阻断，恢复旧服务

固定干净候选3dc87ed9，新Runtime制品0.3.295-test.apf-enable.1，SHA `30c31ae5b4e73a9006a5891e330f4e73c7ad5b66526bba83995d503855db9be8`。当前Console/Workflow已与前次备份不同，三库重新按single-transaction/routines/events/triggers转储、加密，解密/gzip/摘要通过；Runtime和PM2快照加密解密通过。私有目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T122525Z`，管理员临时0600 defaults用完删除。

七段plan/apply/verify通过，reviewHash前缀：

- people-private: `4fc687755af2`
- people-facts: `3a6e5b63439d`
- finance-B3: `15f2b0239a29`
- finance-13a: `9f6abd876c4e`
- finance-13b: `9c3b748fc34d`
- altoc-sales-B2: `e4691376948d`
- finance-cost: `42ebc8f475f6`

建表后只补迁移账号在altoc_opportunity_stage上的INSERT/SELECT；原/新GRANTS与精确REVOKE候选在私有目录，无库级/全局授权。阶段seed27行，全部code与候选一致，win_rate/赢输标志不变量PASS。复用双audience各9项grant、4个directory、workflow proxy及callback均verify PASS，无重复seed。保留新增grant ID：13227460, 13227461, 13227462, 13227463, 13227464, 13227465, 13227466, 13227467, 13227468, 13227475, 13227476, 13227477, 13227478, 13227479；七个Workflow定义active默认route/schema，test人工assignee，verify PASS。

累计mapping verify-views PASS；新Runtime启动失败：`initialize enterprise Altoc reads: enterprise: binding context mismatch: table mapping missing`。只读定位：候选data-runtime/internal/server/server.go的enterpriseAltocReads及SalesReads初始化条件包含Tables["altoc_lead"]，B2安装后误触发旧BasicReadService；旧service要求customer/contract等未前缀logical mapping，APF只有前缀mapping。未加旧映射或改代码绕过。候选PM2 startup命令执行后也已恢复原候选。签发探测/新族readiness未完成，不宣称启用。

已停新Runtime、复制runtime.before/config.before.json恢复、保留plist原env、enable/bootstrap原Runtime；delete新PM2并从原c04b323c用原gateway环境token重新up。六进程均online且cwd原候选，本机与公网health连续三轮200/0.3.294-test.apf-m1.1。匿名Aims GET /v1/aims/projects返回401；匿名hzy0/enterprise入口302认证跳转。

**保留七段新增表、27行阶段配置、14条grant、七个Workflow定义和精确表权限；原active mapping不启用新增族。** 非空阶段表不强删、不绕过installer保护，不恢复全库。下一步需修复新候选旧Altoc读初始化判断，固定审查提交后verify复用安装/mapping/seed，不能重跑已有七段apply。数据库或权限回滚另按已存精确回滚候选和非空数据方案审查。APF14b改动仍保留暂停；未提交/推送，没有云端/生产/Platform操作。


### 2026-10-03 固定394b0119续行：启动修复通过，egress签发阻断，已恢复原服务

本地固定提交 `394b0119f24f3a9f6f17d8d9973a8dc7c683bb32`，干净候选 `/Users/gavinzhou/orca/hzy-candidates/394b0119`；Go全量44个测试包PASS，11模块Nuxt prepare PASS，离线冻结依赖和私有0600凭据复制。Runtime `0.3.295-test.apf-enable.2`，SHA `50d98f3e5169663537892e2d8ecdc644e3e5d8cf3b6a1ede7db6f179105216a4`。本轮私有备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T130815Z`，三库（含已装七段、阶段和seed）重新加密转储/解密/gzip摘要核验PASS，binary/config/plist/PM2快照加密解密PASS；临时管理员defaults删除。

未重装或改表/seed/grant/Workflow定义。复用七段累计mapping，三域读写unified、scheduler disabled，其它字段保持原值。候选verify-views PASS。B5投标/服务/工单11张表不存在；按live binding调用对应owning只读列表方法分别503 `altoc_tenders_not_installed`、`altoc_services_not_installed`、`altoc_tickets_not_installed`（不是浏览器/已授权HTTP请求）。新Runtime实际启动正常；本机/公网health三轮200且版本/commit正确，匿名Aims GET401。六个PM2都曾切到394b0119并online，匿名hzy0入口302认证跳转，工作树clean。初始化缺陷已解决，缺B5没有阻断启动。

Console grant双audience各9项、4个Directory写通道、workflow proxy/callback与七个Workflow定义verify复用PASS；保留新增grant IDs：13227460, 13227461, 13227462, 13227463, 13227464, 13227465, 13227466, 13227467, 13227468, 13227475, 13227476, 13227477, 13227478, 13227479。签发探测最初本地脚本误按RS256，已对照Console实现修正为EdDSA/Ed25519且核对JWKS；未更改服务签名配置。`enterprise.runtime`/data-runtime/people:enterprise-host:execute实际签发、EdDSA签名、issuer/audience/client/tenant/deployment/token_use/scope/expiry均通过；下一项people:scheduler:execute实际403，诊断复核同为403（未保存令牌，只保存状态/布尔）。因此中止，整组签发与负例矩阵未完成，不能宣称APF启用。

只读根因：候选deploy/test-env/local-enterprise/console-egress.mjs的allowedServiceScope未放行APF scheduler/notification-detail；internalHostRuntimeScopes仅data-runtime。allowedConsoleRequest的Enterprise caller audience排除tenant-runtime，Workflow caller排除enterprise/callback；Console写入scope也不满足通用view/read正则。组合Host scope字符串也没有对应白名单。故这是本机egress入口闭集缺口，SQL grant不是无效，不能以启scheduler或扩宽前缀绕过。下一次需审查精确caller/audience/scope集合与测试的新候选，再续行。

安全恢复完成：停新Runtime，恢复runtime.before/config.before.json与原LaunchAgent环境，重启原0.3.294-test.apf-m1.1；delete新PM2并由原c04b323c候选up。六个原应用online且cwd原候选；本机/公网health三轮200/旧版本。已装七段表、27阶段行、14grant、七Workflow定义和精确表权限保持，不强删、不全库恢复。签发成功产生正常usage/audit，未改变grant绑定/状态。无本轮安装reviewHash；前轮七段receipt/hash保留在previous-attempt.txt指向目录。回滚文件及过程日志同私有目录。

未提交/推送、未操作云端/生产/Platform；14b文件未动，仍暂停保留。浏览器未验收，由Claude后续安排。


### 2026-10-03 固定0a572e85 APF启用完成 / Runtime .3（待浏览器验收）

固定提交：0a572e8528d22aa3a4a36ccee5f144a6289faba6；干净候选：/Users/gavinzhou/orca/hzy-candidates/0a572e85。
Runtime：0.3.295-test.apf-enable.3；SHA256：a1ae46eba42825271a7bf590e3ab44271d9ab996a1396ab86e22ee4ccffb1456。
私有加密备份：/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-enable-20261003T135419Z。三库转储及 Runtime/config/plist/PM2 快照全部解密、摘要、gzip 核验通过；临时管理员 defaults 删除。

Go 全量通过（44 个测试包）；11 模块 Nuxt prepare；候选 egress 34/34 与漂移检查通过。PM2 六个进程最终 online，全部 cwd 新候选。Console egress 与 Gateway 已重新启动加载新白名单。
verify-views PASS；七段 binding readiness PASS；Finance 七个 owning 列表与 People 两个 owning 列表 PASS。这些是 owning 只读探测，不代表浏览器用户权限验收。
缺失 B5 tender/services/tickets 三个 owning 读取分别 503 altoc_tenders_not_installed / altoc_services_not_installed / altoc_tickets_not_installed，未阻断启动；未安装 B5。

签发 26 个正例通过（18 双 audience 单 scope、2 Host 组合、4 Console 精确写通道、Workflow proxy 与 callback）。每项 EdDSA/Ed25519 验签、issuer/audience/client/source_app/tenant/deployment/token_use/scope/expiry 核验。7 个反例拒绝；外部 tenant/deployment 字段反例验证的是闭集请求拒绝，未更改服务配置。令牌未落盘或输出，仅保存布尔与状态。
本机/公网 health 三轮成对 200，version/commit 正确；匿名业务本机/公网 401；hzy0 Enterprise 匿名 302 认证跳转。

未重复安装/seed/grant。已装七段、27阶段、14 grant 和7 Workflow 定义保留并 verify 复用。People/Finance/Altoc read/write unified；scheduler disabled，其他配置不变。
无提交/推送、无云端/生产/Platform写入。14b 未完成改动保持暂停，未修改。

回滚：停止新 Runtime，私有 runtime.before/config.before.json 恢复至运行目录（binary 0750/config0600），沿用备份原 plist 环境 enable/bootstrap；pm2 delete 六个应用后，从 c04b323c 以同一 profile/mode dev up，gateway 内部 token 从私有原 PM2 环境读入，不输出。复核旧0.3.294和三轮健康；保留新增表与seed，不强删或全库覆盖。参考 /tmp/hzy-apf-restore-switch.py。安装回滚需审查数据现状再调用原 receipt；本轮无新安装 reviewHash。

地址：https://hzy0.isme.dev/enterprise/（同源 /people、/altoc、/finance）。浏览器验收由 Claude 安排。

沿用已装七段原 reviewHash 前缀：people-private 4fc687755af2、people-facts 3a6e5b63439d、finance-B3 15f2b0239a29、finance-13a 9f6abd876c4e、finance-13b 9c3b748fc34d、altoc-sales-B2 e4691376948d、finance-cost 42ebc8f475f6。grant行ID：13227460,13227461,13227462,13227463,13227464,13227465,13227466,13227467,13227468,13227475,13227476,13227477,13227478,13227479。前次receipt目录可沿私有previous-attempt.txt追溯。

准备阶段凭据路径先误查候选根目录，实际 deploy/test-env/.cloudflare-workers 已私有复制；People owning探测首次遗漏输入 CostScope=none 被校验拒绝，补齐合法只读输入后通过。这两项是执行者前置/探测输入错误，未修改环境配置或授权绕过。


### 2026-10-03 固定 2271f417 候选切换 / Runtime .4（待验收）

固定提交 `2271f41785e063b82e7ec663930eb3cdfbe62835`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/2271f417`。Runtime `0.3.295-test.apf-enable.4`，SHA256 `f594c556dcb2a4fba1236f08441859e8e187644906ea5fd74b93e835a7f4d077`。

切换前 binary/config/plist/六个 PM2 定义备份在 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch4-20261003T171147Z`，0600 私有快照与加密归档解密摘要核验通过。未备份或修改数据库（本次无数据库操作授权需求）；未安装 14/16e 或 B5 新表，未修改 grant、Workflow 定义、配置开关或 plist。原 config/plist 字节一致性切换后通过。

候选 Go 全量、11 模块 Nuxt prepare、切换前后 verify-views 通过；离线冻结依赖，Cloudflare 凭据私有0600复制。Runtime LaunchAgent 切换到新制品，六个 PM2 应用均 online/cwd 新候选，Gateway 与 Console egress 重启加载该提交拓扑/白名单。Enterprise/Console 私有 worker health 通过。

本机/公网 health 连续三轮成对200、版本 .4/commit2271f417；匿名业务本机/公网401。首次 Python urllib 公网探测403，改用现有运行手册 curl 后200/正确版本，三轮均通过（探测客户端差异，未放宽鉴权或修改环境）。缺少模块表的业务入口保留已审核的失败关闭，未尝试安装或业务写入；浏览器由 Claude 验收。

回滚：停止/禁用新 Runtime，恢复该目录 runtime.before 至运行目录（0750），config/plist保持原值或与0600快照核对；enable/bootstrap原 LaunchAgent。pm2 delete六进程后从 `/Users/gavinzhou/orca/hzy-candidates/0a572e85` 以原profile/mode dev up，内部token仅从私有原PM2定义读入；复核原 .3 和三轮健康。不执行数据库/授权回滚。

无提交/推送，无云端/生产/Platform写入。访问：<https://hzy0.isme.dev/enterprise/>。


### 2026-10-03 固定 8ee33d32 候选切换 / Runtime .5（待验收）

固定提交 `8ee33d323157f7a44b9d051c64b4bd758116dd0a`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/8ee33d32`。Runtime `0.3.295-test.apf-enable.5`，SHA256 `27dcff36a4dece8b70bcb9eb4c2ac2a44da4b5699722f4ae06ace44384abb29e`。

切换前 binary/config/plist/六个 PM2 定义私有备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch5-20261003T190939Z`，0600 快照及加密归档解密摘要验证通过。本轮无数据库、grant、Workflow 定义、配置开关变更；未安装新表，未执行 Platform 迁移/发布/重签。主工作区 Codex-sol 的 16f 文件未触碰。

候选 Go 全量、离线冻结依赖、11 模块 Nuxt prepare、切换前后 verify-views 均通过，候选 git status 干净。Cloudflare 凭据从前候选私有复制并设为0600。Runtime LaunchAgent 和六个应用已切换；六进程 online 且 cwd 新候选，Gateway/Console egress 重新启动加载固定提交的拓扑及白名单。Enterprise/Console 私有 worker health 通过。运行 binary SHA 回读正确，config/plist 与备份字节一致。

本机与公网 Runtime health 连续三轮成对200，版本 .5/commit8ee33d32；匿名业务本机/公网401。浏览器 People列表/Altoc线索复验由Claude安排。Finance默认范围仍需后续批准Platform迁移、发布、测试重签与策略同步，本轮未绕过 scope 判定。

回滚：停止/禁用新Runtime，恢复本目录 runtime.before 至运行目录（0750），核对原config/plist后 enable/bootstrap原LaunchAgent；pm2 delete六进程后，从 `/Users/gavinzhou/orca/hzy-candidates/2271f417` 用原profile/mode dev up，内部token仅从私有原PM2定义取入，不输出。回读原 .4/2271f417 与三轮健康。不执行数据库或授权回滚。

未提交或推送，未操作云端/生产/Platform。访问：<https://hzy0.isme.dev/enterprise/>。


### 2026-10-03 固定 545560cf 验收修复候选切换 / Runtime .6（待验收）

固定提交 `545560cfd2812eb42a766117205d2044119ff08c`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/545560cf`。Runtime `0.3.295-test.apf-enable.6`，SHA256 `86a4b5b963b1da29188b1c767c5bb115a1cb200ea3d0098d3194593544a85d37`。误给的 4f0c3960 仅创建 worktree/备份，未构建、停服或切换。

切换前私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch6-20261003T223230Z`：binary/config/plist/六个 PM2 定义 0600，归档加密并解密摘要核验通过。候选 Go 全量、构建、11模块 Nuxt prepare、切换前后 verify-views 通过；离线冻结依赖，Cloudflare 凭据私有复制为0600；候选 git status 干净，不含主工作区 17a/17b WIP。

Runtime LaunchAgent 和六个 PM2 应用已切换，全部 online/cwd 新候选；Console egress/Gateway 已加载新候选。运行 binary SHA 正确，config/plist 与原备份字节一致。未改数据库、grant、Workflow 定义、配置开关，未安装任何增量表。

本机/公网 Runtime health 连续三轮成对200，版本 .6/commit545560cf；匿名业务本机/公网均401。Enterprise/Console 私有 worker health 通过。浏览器及原键审批恢复验收由协调者执行，本次未发业务写请求。

回滚：停新 LaunchAgent，恢复本目录 runtime.before（0750），核对原 config/plist 后 enable/bootstrap；pm2 delete 六进程后从 `/Users/gavinzhou/orca/hzy-candidates/8ee33d32` 按原 profile/mode dev up，内部 token 仅从私有 PM2 定义读入；回读原 .5/8ee33d32 和三轮健康。不做数据库/授权回滚。

未提交/推送、未操作云端/生产/Platform。访问：https://hzy0.isme.dev/enterprise/ 。完成后恢复本地 APF-17b，环境不再操作。


### 2026-10-04 固定 479e48ee 审批链候选切换 / Runtime .7（回调验收阻塞）

固定提交 479e48ee3d7c7e743a8f6d40c0bb16bdcacb8d69；干净候选 /Users/gavinzhou/orca/hzy-candidates/479e48ee。Runtime 0.3.295-test.apf-enable.7，SHA256 e71a39a9f8f26727caa722b550451eb59c1e11d8919a32b44a4e9aa5b23d6921。

切换前私有备份 /Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch7-20261003T235918Z：binary/config/plist/六个 PM2 定义 0600，加密归档解密摘要验证通过。Go 全量、构建、11模块 Nuxt prepare、切换前后 verify-views 均通过。离线冻结依赖；Cloudflare 凭据私有复制0600；候选干净，不含17a/17b/18 WIP。未修改数据库结构、grant、Workflow 定义、配置开关或 plist，未安装新表。

Runtime 和六个应用已切换，全部 online/cwd 新候选；Gateway 从已审代码按本机 Enterprise listener 配置 HZY_ENTERPRISE_ORIGIN 并加载 Enterprise 精确可信目录，Console egress重新加载新候选。binary SHA回读一致，config/plist字节未变。本机/公网三轮health均200且 .7/479e48ee，匿名业务401。Enterprise首次私有worker健康探测5秒超时，启动就绪只读复核后 Enterprise/Console均通过；未为此重启进程或放宽健康检查。

原 outbox drain：首次调用遗漏必需 --profile，在readProfile前置核验退出，没有发出HTTP。补齐原profile后只发出一次正式drain，HTTP200，但原回调投递失败；状态回读仅记录：实例34 approved、回调32 failed、报销 pending_approval。未创建新回调或新实例，未改原键，未手工改业务状态。其内部标准投递/失败checkpoint是本次批准的正式drain行为，没有直接SQL写入。

只读复现剩余根因：manual-workflow-outbox-drain.mjs 中 schedulerRequestHeaders 返回 Headers，对 headers['x-hzy-local-runtime-dial-url'] 赋值不会序列化到请求；真实Request缺dial头，strict verifier返回 local_callback_gateway_context_invalid。已在主工作区补最小 Headers.set 修复及真实请求头回归（仅代码，未部署/提交），gateway transport23+manual drain3=26项通过。没有再次drain，等待审查/续行批准；.7与六应用保持健康，没有回滚数据库或关闭严格校验。

回滚：停止新Runtime，恢复该备份 runtime.before（0750），核对config/plist原字节后沿原LaunchAgent enable/bootstrap；pm2 delete六进程后从 /Users/gavinzhou/orca/hzy-candidates/545560cf 按原profile/mode dev up，内部token仅从私有PM2定义读入；回读 .6/545560cf及三轮健康。不进行数据库/授权/业务结果回滚。

未提交/推送、未操作云端/生产/Platform。访问：https://hzy0.isme.dev/enterprise/ 。候选切换已完成，但回调验收尚未通过；17b保持暂停，等待处理。


### 2026-10-04 原 outbox 续投成功（候选工具单行补丁）

按批准将 269ebeb3 中 manual-workflow-outbox-drain.mjs 的 Headers.set 单行修复原样应用至 /Users/gavinzhou/orca/hzy-candidates/479e48ee。候选只有 deploy/test-env/local-enterprise/manual-workflow-outbox-drain.mjs 与 479e48ee 不同，文件与 269ebeb3 字节一致，git diff 269ebeb3 对该文件为空；没有其他 tracked/untracked 改动。服务代码、Runtime binary/config/plist、授权、Workflow定义与配置开关不变，未重启进程。

从候选根目录带原 profile 调用一次正式 Workflow outbox drain，HTTP200，沿用原 outbox/回调键；未新建实例或回调、未直接SQL写入、未重复触发。只读回读结果：实例34 approved；callback32 success；报销 CLM-9ede18e1… approved。此前验收阻塞已解除。未提交/推送。

### 2026-10-04 APF 报销全链浏览器验收（hzy0 479e48ee/.7，test 策略 rev 42）

zhouguangying 新建并提交报销 CLM-9ede18e1…（CLAUDE-FIXTURE，88.00 CNY）→ Workflow 实例 34，任务分配 test → test 在 /enterprise/approvals/34 同意 → 回调（outbox 32 原键续投）→ 报销已批准 → Platform 为 test 角色 132 增加 finance:cashier 及 4 条精确范围、重签 test rev 42 → test 确认实际付款 200 → 报销已付款，生成支出台账 id=1。审批与付款确认均由 test 执行，制单/经办为 zhouguangying，未出现同人越权。待办审批下拉已列全八类。遗留：报销 CLM-1b1fceba…（pending 未绑定）待用新恢复入口验收；报价明细、开票、到账核销、People 任职审批链尚未浏览器验收；测试夹具（客户 CU-2d2d…、报价 QT-CLAUDEFIX、线索 LE-84e5…、岗位 CLAUDEFIX01、两张报销）待用户批准后清理。

### 2026-10-04 固定 ce133bfa 合同提交修复切换 / Runtime .8

固定提交 ce133bfae6904fd8e26848d738b78be31e3ac486；干净候选 /Users/gavinzhou/orca/hzy-candidates/ce133bfa。Runtime 0.3.295-test.apf-enable.8，SHA256 1bbfc089517a23ad4b6e54eaa588fbff027c90d3db1f53d374eb25725a9187ef。

切换前私有备份 /Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch8-20261004T022328Z：binary/config/plist/六个 PM2 定义 0600；加密归档解密摘要核验通过。Go 全量、构建、离线冻结依赖、11 模块 Nuxt prepare、切换前后 verify-views 全部通过。候选不含主工作区 17a/17b/18B WIP；manual-workflow-outbox-drain.mjs 与 269ebeb3 字节一致，无需候选补丁，本次不触发 drain。

六个应用 online/cwd 均为新候选；Gateway/Console egress 随候选重新加载，Enterprise/Console 私有 worker 健康通过。本机/公网三轮 health 均 200 且版本/提交正确，匿名业务均 401。Runtime binary SHA 一致；config/plist 字节未变。未改数据库、grant、Workflow 定义或任何配置开关，未安装新增子集。

回滚：使用私有 runtime.before 恢复 binary（保持原 config/plist），重载 cn.wiztek.hzy-test-runtime；删除本次六个 PM2 应用后，从备份 pm2-before.json 所记 479e48ee 候选按原 profile dev 启动，私有 Gateway 环境令牌仅进程内传递；再做版本/健康及匿名回读。未执行回滚，未提交。

### 2026-10-04 APF 经营收款链浏览器验收（hzy0 ce133bfa/.8，test 策略 rev 43）

zhouguangying：线索→客户→报价（明细服务端计价 2000.00/1886.79）提交 → test 批准（实例 35，回调自动成功）→ 由报价转合同（金额承接）提交 → test 批准（实例 37）→ zhouguangying 签署生效，履约义务未开始→进行中→已完成，结算计划 BS-2106… 变可开票 → 开票申请 IR-7078…（2000.00）提交 → test 批准（实例 38）。test（cashier）登记并确认到账 RC-89c5…；zhouguangying（临时角色 133 finance:reconciliation_operator，分配 36，至 2026-10-11）核销 RL-ba3b…，到账已核销、未核销 0.00，Altoc 结算计划回写 status=received/received_amount=2000.00。报销两张（含经恢复入口续交的 CLM-1b1f…）均经 test 审批与付款确认为已付款。反例：zhouguangying 直接审批 test 的任务 403。

阻塞/缺陷（已交 Codex-sol2）：开票员上传发票附件需 invoices:edit 致 test 403，正式开票未完成；开票缺附件误报“保存结果未确认”；到账 dueAt 必填未标注且 400 无字段；多表单编码手填；结算计划 received 显示未知状态。

Platform（测试租户 C000001，已获批准）：角色 132（test，阶段 1+cashier，33 条 manual 范围，分配 35 至 2026-10-10）；角色 133（zhouguangying 核销，6 条范围，分配 36 至 2026-10-11）；test bundle rev 40→43，生产未重签。撤销：删除分配 35/36，清空 132/133 范围并停用，再重签 test。


### 2026-10-04 固定 b8c8474b Finance 验收修复切换 / Runtime .9

固定提交 `b8c8474b896fb970e0275ecdb75f961ccbc9cad0`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/b8c8474b`。Runtime `0.3.295-test.apf-enable.9`，SHA256 `d57d28d13db03b88c6cd1f2e3595052f6526dda90277168db3cc9c19ff8a8932`。

切换前私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch9-20261004T052805Z`：binary/config/plist/六个 PM2 定义 0600，加密归档及解密摘要核验通过。候选 Go 全量、构建、离线冻结依赖、11 模块 Nuxt prepare、切换前后 verify-views 均通过。未带入主工作区 UI/WIP，候选最终 git status 干净。

Runtime LaunchAgent 与六个应用已切换，全部 online/cwd 新候选；Gateway/Console egress 重启加载新拓扑、可信目录与白名单。Gateway 的 HZY_ENTERPRISE_ORIGIN 由 transport 内从原本机 profile 的 Enterprise listener 派生，并非 PM2 顶层环境字段；候选 Gateway transport 23 项通过。binary SHA 回读一致，config/plist 字节未变。未修改数据库、grant、Workflow 定义或配置开关，未安装17/18新表，未触发 outbox drain 或业务写请求。

只读前后核对：HR源1表、离职事项2表、三域到期通知9表共12张物理表均不存在，配置映射未新增；临时0600 MySQL defaults文件用完删除，仅执行information_schema聚合SELECT。对实际binding/config做 owning core 门禁回读（无数据库调用）：HR状态/离职事项503；六个due owner与三域dead-letter owner保持disabled并返回503。临时门禁测试文件运行后删除，不进入Runtime制品。17c恢复读取使用已安装People facts，本轮未新增其表或启用写任务，不将其误报为全模块关闭。

本机/公网Runtime health三轮成对200且版本/提交正确，匿名业务均401；Enterprise/Console私有worker健康通过。公网hzy0匿名页面302至Cloudflare Access登录门禁，未读取或填写凭据、未绕过门禁，登录浏览器验收由协调者安排。

回滚：停止本次Runtime，恢复私有runtime.before（0750），核对原config/plist后沿原LaunchAgent enable/bootstrap；pm2 delete六进程后从备份pm2-before.json所记 `/Users/gavinzhou/orca/hzy-candidates/ce133bfa` 按原profile/mode dev启动，私有Gateway token仅进程内传递。回读原 .8/ce133bfa与三轮健康；不执行数据库、授权或Workflow回滚。本次未回滚、未提交或推送。

访问：https://hzy0.isme.dev/enterprise/ 。候选切换完成，等待浏览器验收；之后待命。

### 2026-10-04 APF 正式开票验收完成（hzy0 b8c8474b/.9 + 热同步 1b6f9ad3 单文件）

候选 /Users/gavinzhou/orca/hzy-candidates/b8c8474b 仅 enterprise/server/utils/enterpriseFinanceFiles.ts 与 b8c8474b 不同，内容等同 1b6f9ad3（Finance 附件改用 ali-oss 原生 OSS endpoint）；Nuxt dev 热加载，未重启进程。test（finance:invoice_issuer）先“指派开票”给自己（责任人 test，截止 2026-10-10 18:00），再上传 CLAUDE-FIXTURE-invoice-20261004.pdf（附件 FA-318e…，写入共享 bucket wiz-rs，Finance 发票路径下的 CLAUDE-FIXTURE 对象）并开具正式发票 INV-36b3…（号码 CLAUDEFIX20261004，issued_by=test，申请人 zhouguangying）。开票申请变为已开票；Altoc 结算计划 BS-2106… invoiced_amount=2000.00、received_amount=2000.00、status=received。经营收款链（报价→合同→结算计划→开票申请→审批→开票→到账→核销→回写）在 hzy0 浏览器端全部走通。


### 2026-10-04 固定 ab7a604e People Workflow reader 切换 / Runtime .10

固定提交 `ab7a604e`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/ab7a604e`，包含 Finance 附件与 People permit 修复。Runtime `0.3.295-test.apf-enable.10`，SHA256 `07643274b492c7519da89f215378027d7ec967fa727ca9bec51093446c40fc68`。主工作区 APF UI 一致性 WIP 未进入候选。

私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch10-20261004T114345Z`：原 binary/config/plist/六个 PM2 定义，文件 0600、目录 0700；加密归档解密摘要核验通过。Go 全量、两个工具构建、离线冻结依赖、11 模块 Nuxt prepare、Codocs Worker 构建及 Wrangler output 装配、切换前后 verify-views 均通过。受保护本机配置沿用原候选字节与权限。

首次入口探针直接访问 Enterprise 未带 Gateway 上下文，返回 403；脚本按门槛恢复原 .9/b8c8474b，受信探针复核 200。修正探针后再次切换成功，原失败日志保存在 cutover-first-gate.log。未放宽鉴权。

六个 PM2 应用 online/cwd 均为新候选，PM2 save 通过；config/plist 原字节不变、Runtime binary SHA 一致。Enterprise（受信回环）、Aims、Codocs 入口与 Enterprise chunk 连续 3×200；Codocs 匿名 Service API 401；Enterprise/Aims 60 秒无 full reload。本机/公网 Runtime 三轮成对 200、版本/提交一致，匿名业务 401；Enterprise/Console 私有 worker health 通过。APF 可选子集与禁用 owner 只读前后核验不变，没有安装、授权或开关变化。

回滚：停止本次 Runtime，恢复该备份 runtime.before（0750），保留并核对原 config/plist，重新 enable/bootstrap `cn.wiztek.hzy-test-runtime`；删除本次六个 PM2 应用后从备份所记 b8c8474b 按原 profile/dev 启动，Gateway 凭据仅从私有备份进入进程环境，再保存 PM2 并复核健康。本次最终未回滚；不执行数据库或业务结果回滚。

没有 DB schema/grant/Console/Platform 配置写入，没有 drain、Workflow #39 或其它业务操作；未提交、未推送。访问：https://hzy0.isme.dev/enterprise/ 。切换完成，等待浏览器验收。


### 2026-10-04 固定 c31786b1 People 任职恢复入口切换 / Runtime .11

固定提交 `c31786b1`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/c31786b1`。Runtime `0.3.295-test.apf-enable.11`，SHA256 `fc0033a932b9959fd5bec0f5ba4f80b8688d9f13361008604ac237980b3bff9f`。仅包含已提交的 People 恢复入口及此前修复，主工作区 APF UI 一致性 WIP 未进入候选。

切换前私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch11-20261004T121145Z`：原 binary/config/plist/六个 PM2 定义，文件 0600、目录 0700；加密归档解密摘要核验通过。Go 全量、Runtime/verify-views 构建、离线冻结依赖、11 模块 Nuxt prepare、Codocs Worker 构建及 Wrangler output 装配、切换前后 verify-views 全部通过。六份受保护候选配置与原候选字节相同，0600/属主核对通过。

Runtime 与六个 PM2 应用切换成功，全部 online/cwd 为新候选，PM2 save 通过；config/plist 原字节不变、运行 binary SHA 一致。Enterprise（受信回环）、Aims、Codocs 入口与 Enterprise chunk 连续 3×200；Codocs 匿名 Service API 401；Enterprise/Aims 60 秒无 full reload。本机/公网 Runtime 三轮成对 200 且版本/提交一致，匿名业务 401；Enterprise/Console 私有 worker health 通过。APF 子集只读前后回读不变：12 张可选物理表仍不存在，无新增映射；HR/offboarding 门槛、六个 due owner 与三个 dead-letter owner保持原禁用状态。未安装新增子集或启用机器投递。

回滚：停止本次 Runtime，恢复该备份 runtime.before（0750），保留并核对 config/plist 后重新 enable/bootstrap `cn.wiztek.hzy-test-runtime`；删除本次六个 PM2 应用，从备份所记 `/Users/gavinzhou/orca/hzy-candidates/ab7a604e` 按原 profile/dev 启动，Gateway 凭据仅从私有备份进入进程环境，再保存 PM2、回读 .10/ab7a604e 与健康。本次未回滚。

没有 DB schema/grant/Console/Platform 配置写入，没有 drain、任职恢复、Workflow #39 或其它业务操作；未提交、未推送。访问：https://hzy0.isme.dev/enterprise/ 。切换完成，等待浏览器验收。


### 2026-10-04 固定 9945b09e Workflow People 重放切换 / Runtime .12

固定提交 `9945b09e`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/9945b09e`。Runtime `0.3.295-test.apf-enable.12`，SHA256 `128b887060194d59a72d8bda6c3395be22e010133f6cce19b967af9d9686e14f`。包含 People reader、原键恢复及 Workflow 冻结请求重放，主工作区 APF UI 一致性 WIP 未进入候选。

私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch12-20261004T122708Z`：原 binary/config/plist/六个 PM2 定义，文件 0600、目录 0700；加密归档解密摘要核验通过。Go 全量、Runtime/verify-views 构建、离线冻结依赖、11 模块 Nuxt prepare、Codocs Worker 构建及 Wrangler output 装配、切换前后 verify-views 均通过；六份受保护候选配置与原候选字节相同，0600/属主核对通过。

Runtime 与六个 PM2 应用切换成功，全部 online/cwd 新候选，PM2 save 通过。config/plist 原字节不变、运行 binary SHA 一致；Enterprise（受信回环）/Aims/Codocs 入口与 Enterprise chunk 连续 3×200，Codocs 匿名 Service API 401，Enterprise/Aims 60 秒无 full reload。本机/公网 Runtime 三轮成对 200 且版本/提交一致，匿名业务 401；Enterprise/Console 私有 worker health 通过。APF 子集只读前后不回退：12 张可选物理表仍不存在、无新增映射；HR/offboarding 门槛与六个 due/三个 dead-letter owner保持原禁用状态。

回滚：停止本次 Runtime，恢复该备份 runtime.before（0750），核对原 config/plist 后 enable/bootstrap `cn.wiztek.hzy-test-runtime`；删除本次六个 PM2 应用，从备份所记 `/Users/gavinzhou/orca/hzy-candidates/c31786b1` 按原 profile/dev 启动，Gateway 凭据仅从私有备份进入进程环境，再保存 PM2并回读 .11/c31786b1 与健康。本次未回滚。

没有 DB schema/grant/Console/Platform 配置写入，没有 drain、任职恢复、Workflow #39 或其它业务操作；未提交或推送。访问：https://hzy0.isme.dev/enterprise/ 。切换完成，等待浏览器验收。


### 2026-10-04 固定 631e81cc UI/People 代理与 DOC-01 切换 / Runtime .13

固定提交 `631e81cc`；干净候选 `/Users/gavinzhou/orca/hzy-candidates/631e81cc`。Runtime `0.3.295-test.apf-enable.13`，SHA256 `ddc0b7b4bf344cac491081236dccd714e322fe077d6fee2938eec0bfae060d68`。包含 129765d5、ab8a280e 和 DOC-01 GitLab 只读收口，不包含主工作区未提交内容。

私有备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch13-20261004T130308Z`：原 binary/config/plist/六个 PM2 定义，文件 0600、目录 0700；加密归档解密摘要核验通过。Go 全量、Runtime/verify-views 构建、离线冻结依赖、11 模块 Nuxt prepare、Codocs Worker 构建及 Wrangler output 装配、切换前后 verify-views 全部通过；六份受保护配置与原候选字节相同，0600/属主核对通过。

Runtime 与六个 PM2 应用切换成功，全部 online/cwd 为新候选；config/plist 原字节不变，运行 binary SHA 一致。Enterprise（受信回环）/Aims/Codocs 入口与 Enterprise chunk 连续 3×200，Codocs 匿名 Service API 401；Enterprise/Aims 60 秒无 full reload。本机/公网 Runtime 三轮成对 200、版本/提交一致、匿名业务 401；Enterprise/Console 私有 worker health 通过。PM2 save 通过。

APF readiness 和 People 代理定向 10/10 通过；Codocs 敏感路由/只读定向 48/48 通过。APF 可选表与禁用 owner 前后回查不变：12 张可选物理表仍不存在、无新增映射，HR/offboarding 门槛与六个 due/三个 dead-letter owner保持原禁用状态。

独立 Codocs editor 仍运行，并与其余应用同候选；Worker output 已装配且 23130 入口正常。当前候选页面源码不再含“提交到 GitLab”按钮及提交调用，保留“从 GitLab 同步”只读链路，相关定向测试通过；登录浏览器确认由协调者安排。

回滚：停止本次 Runtime，恢复本备份 runtime.before（0750），核对原 config/plist 后 enable/bootstrap `cn.wiztek.hzy-test-runtime`；删除本次六个 PM2 应用，从备份所记 `/Users/gavinzhou/orca/hzy-candidates/9945b09e` 按原 profile/dev 启动（保留其已热同步的 People 代理文件），Gateway 凭据仅进程内传递；保存 PM2、回读 .12/9945b09e 与健康。本次未回滚。

未执行 v2.35，未改 DB schema/grant/配置开关，没有 drain、审批、恢复或其它业务写操作；未提交/推送，未操作云端/生产/GitHub。访问：https://hzy0.isme.dev/enterprise/ 。切换完成，等待验收。

### 2026-10-04 v2.35 本地授权核验（零目标）与 DOC-03 部分盘点

仅 `hzy_console_test_local_20260910`：先 Verify，备份 service_client_grants 全表并解密字节比较，再执行 v2.35 seed 一次，最后 Verify/逐行比较。599 行全部原字节字段不变、status/行数不变、两项旧 GitLab 写操作目标0行；qualified/semanticScope 补查也无 integration_operations:execute。本地没有受影响客户端或 GitLab 集成，未新授权或借生产身份探测。

加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/v235-20261004T133816Z/grants.sql.enc`（目录0700、文件0600），可解密；临时 defaults 与明文 dump 已删。无实际变化，无需回滚；必要时仅用原加密行备份恢复，不改 schema。

DOC-03 本地存量与旧生产 Console 只读元数据见 `.git/report-doc-03-20261004.md`。Reporter 调整尚未执行：缺受控 GitLab API 通道，不能确认账号及继承权限，按先盘点门槛停止。生产无写入，未读/打印/解密生产凭据；没有进程或配置变更，没有 GitHub 操作，未提交。


### 2026-10-04 hzy0：990cad60 / Runtime .14 与 aims-portfolio-members

授权来源：`.git/brief-hzy0-switch-and-portfolio-install.md`，仅 hzy0 本机；未执行 Codocs 6a 迁移，未改 grant、Console、Platform 或云端。

候选 `/Users/gavinzhou/orca/hzy-candidates/990cad60`（干净 990cad609），Runtime `0.3.295-test.apf-enable.14`。六个 PM2 进程均 online 且 cwd 为同一候选。原 LaunchAgent/plist 不变；Runtime 配置仅增加 Aims 的 `aims_portfolio_members`、`aims_portfolio_doc_repos` 两个同名物理映射，generation=1、原有域模式与映射保留。

备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch14-20261004T142733Z`（0700、文件0600）：Runtime binary/config/plist/PM2 加密归档，以及统一库、Console、Workflow 全库加密备份；均解密摘要与 gzip 完整性核验通过。正式 apply 前再次停六个应用与 Runtime 并重做备份。六份受保护配置沿用原字节，SHA256/0600/属主核对通过。

完整统一库备份恢复到一次性隔离 MySQL 后，执行 table-only installer apply→verify→rollback，通过并确认存量 baseline 一致（`portfolio-rehearsal.log`）。演练临时测试文件已删除，候选干净。第一次正式 plan 后，外部执行脚本误读计划封装层（`Tables` 实际在 `Installation` 内），检查中止、未执行 DDL，原配置/进程恢复；修正读取后使用新目录重新 plan。

正式计划/回执在 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch14-20261004T142733Z/portfolio-install/`；reviewHash `cff097e831bf727f66aa568bf334b7739c5e1555c2e2fda583c0041bce4a382b`。人工核对恰为两张指定表、0视图、配置仅两项映射增量，然后 apply→verify 成功；工具全程 migration lock、停止检查与 generation 栅栏。安装后 Registry 整行（含 mapping_hash）摘要不变，存量表/视图名称保留，仅新增两张表。verify-views：142/142、0失败，mapping_hash `cd2c4649cff1a6a9a5525c5b0fb81d97a2b5b1b6f4c5bfaafbe1a00706c2b217`。

构建/核验：Go全量通过；离线冻结依赖、11模块Nuxt prepare、Codocs Worker output装配、Runtime/installer/verifier构建通过。安装后本地/公网Runtime健康3轮200、版本/提交一致，匿名业务401；Enterprise/Console私有health通过。HR/offboarding未安装仍503，六个due owner与三域dead-letter仍关闭；12个可选表仍缺失，未误启用后台owner。

回滚：停六个PM2写进程，bootout并disable `gui/$UID/cn.wiztek.hzy-test-runtime`；使用本批 `hzy-enterprise-add-apf --subset aims-portfolio-members --mode rollback --config config.before.json --migration-db-config installer-migration.json --proposed-config portfolio-install/proposed.json --plan portfolio-install/plan.json --receipt portfolio-install/receipt.json --review-hash cff097e831bf727f66aa568bf334b7739c5e1555c2e2fda583c0041bce4a382b`（路径均以本备份目录为根）。工具只允许无业务数据、定义匹配的自建对象删除；拒绝时停止报告，不绕过。恢复config.before.json（0600），若回退候选同时恢复runtime.before与631e81cc启动方式；enable/bootstrap原LaunchAgent并恢复六应用、健康与视图再核验。进入业务验收后不再假定表为空，不自动删除数据。

项目集成员登录态GET留给协调者浏览器验收：未伪造用户会话或actor，也未以服务客户端代替用户。表安装及固定映射已就绪，现有Go/隔离安装演练通过；不宣称已完成用户HTTP正例。本次未提交、未推送。

最终入口门槛：安装后 Aims/Enterprise（含入口chunk）/Codocs各连续3×200；匿名Codocs Service API 401；Enterprise/Aims连续60秒无full reload。六应用PM2 save已完成。


### 2026-10-04 ce785898 / Runtime .15 尝试：Codocs 迁移失败，停止并回滚

授权：`.git/brief-hzy0-switch-ce785898.md`，仅本机。新候选 `/Users/gavinzhou/orca/hzy-candidates/ce785898` 与 Runtime `0.3.295-test.apf-enable.15` 曾完成切换：Go全量、11模块Nuxt prepare、Codocs Worker output装配、Codocs331/331测试通过；三入口3×200、匿名Service API401、60秒无reload、Runtime本地/公网3轮健康200；六PM2同候选、142/142视图通过。新增probe-listeners全部期望端口监听，公网302。执行脚本部分进度文案仍写“.14”，以保存health中的真实“.15/ce785898”事实为准。

私有备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch14-20261004T150937Z`（沿用外部脚本的apf-switch14目录前缀，但这是本次独立UTC目录，不覆盖上批备份）：原Runtime/config/plist/PM2加密归档及Codocs `codocs.sql.gz.enc`、`key.pass`；0600/0700，加密后解密SHA256与gzip完整性核验通过。实际Codocs库为127.0.0.1:3306/hzy_codocs，数据库默认utf8mb4/utf8mb4_0900_ai_ci。六份候选受保护配置与原候选摘要、0600与属主匹配。

失败：六应用及Runtime停写后执行首份 `20261005_document_storage_dimension.sql`，外部临时执行脚本简单按`;`切分，误截断`storage_locator`的COMMENT字符串`存储定位信息; NULL...`；MySQL1064。SQL文件本身未修改。立即停止，未执行第二/第三迁移或任何catalog/portfolio对账，未继续重试。

Codocs按全库备份恢复：停止窗口内解密`codocs.sql.gz.enc`，gzip展开输入mysql；先DROP/CREATE本机`hzy_codocs`（保留原utf8mb4_0900_ai_ci），再导入完整dump，解密临时文件删除。回读仍138文档：private88、department17、project14、git-project13、company6；六新增列与三catalog对象均不存在，doc_type计数与备份前一致。运行候选回退至990cad60、Runtime .14；原config/plist保留，上批portfolio两表/映射不受影响。无grant/Console/Platform/云端写入；未提交推送。

下一次修正执行方式：不手工按分号拆SQL；逐份直接将完整已批准SQL文件通过mysql batch输入，带`--show-warnings`且非零立即停止，逐份verify后再进入下一份。需要协调者重新下达续行后执行，当前按失败即停保持回滚状态。登录态项目集文档与对账尚未验收。

最终回滚核验通过：990cad60/.14、六进程同候选、入口/chunk 3×200、匿名Service API401、Enterprise/Aims60秒无reload、本地/公网Runtime健康200、142/142视图；PM2 save完成。


### 2026-10-04 ce785898 第二次：整文件演练通过，策略对象预期不符后停止回滚

续行授权：重新备份、一次性隔离MySQL整文件演练、每份SQL由mysql2 `createConnection({multipleStatements:true})` 整文件query，绝不客户端拆分号。本次备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch15-retry-20261004T151931Z`（0700/0600）；Runtime/config/plist/PM2和统一库/Console/Workflow/Codocs加密备份均解密核验；正式停写后又重新备份Codocs全库。一次性 `/tmp/hzy-test-mysql-*` 从本机Codocs备份恢复，三份SQL原字节依次query通过；六列/回填/只读目录视图、文档计数类型逐份检查通过，证据`codocs-whole-file-rehearsal.json`。

干净ce785898/.15构建和切换通过（含Go全量、Nuxt prepare、Worker装配、142视图、同候选、实际监听/公网302、3×200和60秒稳定）。正式三份迁移全部成功，documents仍138行、doc_type不变；目录视图IS_UPDATABLE=NO。catalog dry-run共2项，apply后dry-run零差异（私有JSON已保存）。

停止点：portfolio-policy-owners dry-run为desired=1、noPolicy=1、changes=0，与任务书“2份”预期不符。未执行该阶段apply，未新增policy或audit。只读复核Aims权威行：id8为codocs目录（is_folder=1），id9为codocs文档（is_folder=0）；均只挂项目集且portfolio存在。对账源码只取is_folder=0，所以实际合法集合仅id9；该文档当前没有策略行，工具按合同跳过，不创建新策略（因此没有policy_update审计新增）。这解释了数量差异，需要协调者确认验收口径：排除目录后desired1/noPolicy1/0审计是否可接受，不能擅自造策略。

遵守失败即停：完整恢复Codocs备份，目录登记本轮2项也随恢复撤销；回读138文档和各类型计数一致、六新增列/三catalog对象全0。Runtime和应用回退990cad60/.14；源config/plist及已有portfolio成员安装不变。回滚命令沿上条：停写、解密全库、按原utf8mb4_0900_ai_ci重建hzy_codocs并导入，恢复原binary、enable/bootstrap与原候选六进程；私有`codocs-migrations.log`/`rollback.log`留存。不改grant/Console/Platform/云端，不提交推送。待协调者裁定后再重新续行，不在此轮重试。

第二次最终回滚健康核验通过：990cad60/.14、六应用同候选、入口/chunk3×200、匿名Service API401、60秒无reload、本地/公网Runtime200、142/142视图，PM2 save完成。


### 2026-10-04 hzy0：100c52b9 / Runtime .15 与 Codocs三迁移、对账成功

授权：续行裁定将目标改为100c52b9，portfolio正确口径desired1/noPolicy1/changes0与零新增审计；仅本机，不改grant/Console/Platform或云端，不提交推送。

干净候选 `/Users/gavinzhou/orca/hzy-candidates/100c52b9`，提交`100c52b9a78c5480a7fabeb60153db37fa919d5c`，Runtime `0.3.295-test.apf-enable.15`。Runtime先ready后启动六应用，同一候选cwd；原config/plist不变，保留已安装portfolio两表映射。进度脚本沿用旧“.14”显示文案，实际健康JSON严格断言“.15/100c52b9”。

新备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch15-100c52b9-20261004T152919Z`（0700、文件0600）：原Runtime/config/plist/PM2加密归档，统一库/Console/Workflow/Codocs全库加密备份，均解密SHA256与gzip完整性核验通过；正式迁移前停六PM2写进程与Runtime后再次全备Codocs。六份受保护候选配置SHA/0600/属主与原候选一致。源库只读核实为`127.0.0.1:3306/hzy_codocs`，默认utf8mb4/utf8mb4_0900_ai_ci。

一次性隔离MySQL从本机Codocs备份恢复，mysql2`createConnection({multipleStatements:true})`按三份原文件整文件query，未拆分号；逐份文档计数/type不变，新增六列/locator回填/目录不可更新视图通过，`codocs-whole-file-rehearsal.json`留存。隔离服务和datadir由harness销毁。

正式执行（六写应用与Runtime停止窗口）：检查目标列/表均未存在，依次整文件执行`20261005_document_storage_dimension.sql`→`20261006_document_catalog.sql`→`20261007_document_access_policy_owner.sql`，均成功。每步documents计数/type不变，最终138行（private88、department17、project14、git-project13、company6）；storage_locator NULL为0、六新增列齐全、document_catalog IS_UPDATABLE=NO。既有统一库142/142视图及mapping_hash`cd2c4649cff1a6a9a5525c5b0fb81d97a2b5b1b6f4c5bfaafbe1a00706c2b217`不变。

正式对账工具为本候选构建的`hzy-document-catalog-reconcile`，受保护`HZY_DATA_RUNTIME_CONFIG`指向现用config，先dry-run保存私有JSON，再apply，再dry-run：catalog共2项登记，之后零差异，document_catalog_entries=2；portfolio每轮desired=1/noPolicy=1/unchanged=0/changes=0，零新增policy_update审计（最终该reason计数0）。id8为目录按合同排除，id9无策略保持默认限制，不创建策略/审计。JSON证据为`catalog-dry-before.json`、`catalog-apply.json`、`catalog-dry-after.json`与对应`portfolio-owner-*`，只含元数据，不输出正文或令牌。

验证：Go全量通过、11模块Nuxt prepare、Codocs Worker构建/output装配通过；Codocs331/331、Enterprise项目集文档10/10测试通过。安装后Runtime本地/公网三轮健康200、匿名业务401；六PM2同候选、private Enterprise/Console health、原config/plist/binary SHA、候选干净、142视图均通过。APF HR/offboarding仍未安装/503，六due和三域dead-letter仍disabled，12可选表未新增。登录态项目集文档列表GET留给协调者验收，未伪造用户会话或服务身份代用户；代码定向测试与数据库依赖就绪，不宣称已做用户HTTP正例。

回滚（仅本批窗口、验收前）：停六PM2应用，bootout并disable`gui/$UID/cn.wiztek.hzy-test-runtime`；`openssl enc -d -aes-256-cbc -pbkdf2 -in codocs.sql.gz.enc -out codocs.restore.gz -pass file:key.pass`（均本备份目录路径）；用受保护本机admin defaults执行`DROP DATABASE hzy_codocs; CREATE DATABASE hzy_codocs CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;`，将`gzip -dc codocs.restore.gz`输入`mysql --defaults-extra-file=<0600临时defaults> --database=hzy_codocs`，非零立即停止，删除解密临时文件；恢复runtime.before与config.before.json权限，enable/bootstrap原LaunchAgent，六应用从990cad60恢复，健康/入口/视图复核后PM2 save。恢复会撤销本批目录与审计变更，进入业务验收后不能自动以旧备份覆盖新业务数据，需另行协调。本次未触发回滚。

最终入口门槛：Aims/Enterprise（含chunk）/Codocs连续3×200，匿名Codocs Service API401，Enterprise/Aims连续60秒无reload；probe-listeners所有启用端口监听且公网302，PM2 save完成。


### 2026-10-04 hzy0：8ffecbe4 / Runtime .16 切换通过

按任务书切换干净候选 `/Users/gavinzhou/orca/hzy-candidates/8ffecbe4`，Runtime `0.3.295-test.apf-enable.16`。加密备份并解密SHA核对目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch16-8ffecbe4-20261004T155449Z`；受保护配置原字节装配。Runtime先ready，六PM2应用同候选，七监听端口/公网302、入口与chunk3×200、Codocs匿名Service API401、60秒无reload、本地/公网Runtime3×200、142/142视图及配置/plist不变全部通过；PM2 save完成。无新迁移、grant或业务数据写入；原.15/100c52b9备份保留可回滚。

test-env七个既有失败修复留主工作区未提交：P1退役Aims HTTP transport后readiness改核typed U桥；退役Assets服务manifest断言改固定U登记；completion-kind隔离夹具补真实adapter floor。引入提交分别56bf0d1ea/e87bf1e7d/e3a598eb0。根级121/121全过，生产校验未放宽。精确清单与证据见 `.git/report-hzy0-switch-8ffecbe4.md`；登录态验收交协调者。未提交推送、未碰云端或GitHub。


### 2026-10-04 hzy0：3e98a6bc / Runtime .17 切换通过

按任务书切换干净候选 `/Users/gavinzhou/orca/hzy-candidates/3e98a6bc`，Runtime `0.3.295-test.apf-enable.17`，含e63687c7/3e98a6bc/7e5b803c。加密备份并解密SHA核对目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-switch17-3e98a6bc-20261004T161752Z`；受保护配置原字节装配。Go全量与两构建、11模块Nuxt prepare、Codocs Worker装配通过。Runtime先ready，六PM2应用同候选；七实际监听端口/公网302、入口与chunk3×200、Codocs匿名Service API401、Enterprise/Aims60秒无reload、本地/公网Runtime3×200、142/142视图全部通过；config/plist原字节不变，PM2 save完成。Runtime binary SHA256 `182bedace3e6c04c89d8e1fcb03e7b85daa2784c0c97540aa3af91daf1567a79`。

无新迁移、grant或业务数据写入，未提交推送、未碰云端/GitHub；.16/8ffecbe4备份保留可回滚。关闭门槛与12可选缺表保持原状。详细回执 `.git/report-hzy0-switch-3e98a6bc.md`，私有证据在备份目录；登录态浏览器验收交协调者。


### 2026-10-04 hzy0：WizBiz 首次演练恢复失败，已回滚

仅 hzy0 本机。目标候选 `6874866ff54c69fe11e86a5778eb4a2eaf4d61f6`、Runtime `0.3.295-test.apf-enable.18`。未提交、未推送，未做云端/生产写入、OSS 或 Platform 调用；OA 仅读取封存加密文件和在内存中解密的流。银行账号 synthetic 的迁移尚未开始。

当前已恢复 `3e98a6bc` / `0.3.295-test.apf-enable.17`，六应用恢复原候选；Runtime 二进制与备份一致，config/plist 原字节不变。

## 备份与候选验证

备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T005446Z`，0700，敏感文件0600。Runtime/config/LaunchAgent/PM2 加密归档和统一库/Console/Workflow/Codocs 四库加密备份均通过解密 SHA-256 与 gzip 完整性核验。

干净 worktree `/Users/gavinzhou/orca/hzy-candidates/6874866f`；Go 全量、Runtime/verify-views/安装器/迁移工具构建、11 模块 Nuxt prepare、Codocs Worker 装配通过。受保护配置按原字节复制。曾成功切到 .18：Runtime先ready，六进程同候选、入口/chunk连续3×200、匿名Codocs Service API401、60秒无reload、七监听端口/公网302、本地/公网Runtime健康3轮200、142/142兼容视图通过。

## 停止原因与写入残留

1. 现用 MySQL bind_address 不符合仅本机监听要求。导入前检查拒绝，未向该实例创建暂存库，也未改其监听配置。
2. 为暂存库创建独立 MySQL：受保护目录 `/Users/gavinzhou/.local/state/huizhi-yun/w2-stage18`，回环 `127.0.0.1:3318`，root随机密码仅0600文件；mysqld使用`--no-defaults`、mysqlx关闭、无二进制日志，不使用现用Runtime配置。
3. 首次流导入失败。**本轮操作脚本漏了 W0 的 PBKDF2 `-iter 200000`**，错误解密流使客户端提前退出，表现为 BrokenPipe；未再次导入。按失败即停执行运行栈回滚。
4. 只读定位后，使用W0正确参数重算流，58,037,313字节、SHA-256 `f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`完全符合封存记录；没有写明文SQL文件，也没有输出账号/人员信息/凭据。
5. 本轮新建暂存库 `wizbiz_stage_20261004t173356z` 实际表数0；source/metadata账号创建步骤未执行。独立暂存mysqld已正常shutdown，数据目录、受保护配置与空库证据暂留，责任人协调者。没有 mig_batch 或 Vault 写入。

**W1 全部子集均未执行；未到 stage-verify/plan/apply/verify，无 reviewHash/批次号，不称为plan阻断。** 统一库、Registry、generation、grant、Vault均未改动。期初应收未执行。

## 回滚复核

恢复原Runtime .17、原config/plist，先Runtime ready再启动原六进程。原候选入口/chunk3×200、Codocs匿名Service API401、Enterprise/Aims60秒无reload、七实际监听端口、公网302、Runtime本地/公网三轮健康200/匿名业务401、Enterprise/Console私有健康、142视图全部通过，PM2 save完成。

原运行候选有协调者的三处未提交页面/测试热修：`aims/layer/pages/enterprise-portfolio-detail.vue`、`aims/layer/pages/enterprise-portfolio-document-open.vue`、`enterprise/test/aims-portfolio-page.test.mjs`；全部保留，未覆盖或回退。因此不宣称原候选工作树干净。证据`rollback-source-status.txt`。回滚健康脚本只将原候选清洁性断言改为记录差异，其余健康/二进制/配置/视图断言保留。

## 下次最小修正

先用`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`执行**只读全流哈希校验**，核对成功后才开始第二次流导入；流内只替换CREATE DATABASE/USE的精确源库标识，导入期间再核对同一原始流哈希。同时可靠回收子进程，捕获双方退出码与脱敏MySQL错误数字，不输出驱动文本或SQL值。须从新备份和原始步骤重新演练；本轮未重试，也未自行放宽任何工具门禁。


### 2026-10-04 hzy0：WizBiz第二次续行W1列增量失败，逆序回滚

备份目录 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T010620Z`（0700/敏感文件0600），Runtime/config/LaunchAgent/PM2 与统一库/Console/Workflow/Codocs 四库重新加密备份，解密哈希及 gzip 完整性均通过。新 .18 binary SHA-256 `e37b5e48dff4582c32df6f01f836f40eb9fffcad97982f72e82f56c1f309ffd2`。

### 候选切换

干净候选6874866f，Runtime .18先ready后启动六应用，同候选、入口/chunk3×200、匿名Codocs API401、60秒稳定、七监听端口/公网302、Runtime本地/公网健康三轮200与142/142视图全部通过。随后按W1维护窗口停六进程、bootout+disable Runtime。

### W1 实施和失败即停

逐段核对固定嵌入的表声明、无视图、原配置/拟配置hash，既有域字段与generation不变；列子集核对精确表名、固定ALTER步骤、INPLACE/NONE或COPY/SHARED。

- `w1-finance-legal-entity`：plan/apply/verify通过，reviewHash `d91848216d986c87834f1c2e3695db06fa6e5f2715060ac6f7a356d6a13ae781`，耗时1.913s。
- `w1-finance-balance-entry`：plan/apply/verify通过，reviewHash `630747303cc6c0b52cf1e42ef550dd2a20c94660e5e940c603fdd100750a87c9`，耗时1.518s。
- `w1-finance-balance-columns`：plan三个步骤（entry_count/latest_tie_count/distinct_amounts），MySQL 8.0.34、INPLACE/NONE、reviewHash `3e1cc53db3802e02d71ddaefe6ef812e964a2a975d19dc63ab026466b58ee82d`；apply失败。现有 `hzy_apf_migration` 安装账号没有ALTER权限，运行前未检查到这一前置条件。没有实际新增列，receipt Created=0、ColumnTimings=0；无COPY步骤实际执行。

立即停止，没有执行后续七个子集，也没有再次导入快照。列子集（零DDL）→balance-entry→legal-entity依次用原plan/proposed/receipt/hash执行rollback，全部成功。回读新表0、新列0，config始终未激活；原Registry/generation不变。安装计划与receipt保留，不改hash或扩大工具护栏。

### 当前阶段与下一步

未到stage-verify/plan/apply/verify，无迁移批次、无Vault/业务数据写入；期初应收未执行。前一轮独立暂存实例仍停止，空库/数据目录留存，责任人协调者；本轮没有启动/写暂存库，没有读取或输出个人信息/账号。

恢复 .17/3e98a6bc 的原运行栈后核对同样入口/稳定/健康/视图门槛，最终结果另记。原候选协调者三处热修保留，不回退。

续行所需最小前置：为现有安装账号的**实际host记录**补足统一库下五表的ALTER权限：finance_account_balance_snapshot、finance_bank_account、altoc_customer、altoc_contact、altoc_contract；不授全局ALTER或GRANT OPTION，不改服务grant/人员权限。此权限更改本轮**没有执行**，交协调者裁定。下次先验证全部DDL必要权限再停机。

快照导入助手现已改为W0精确参数 `-aes-256-cbc -salt -pbkdf2 -iter 200000 -d`；导入前只读完整流SHA/字节校验，导入中重新计算同一原始流SHA。source/target stderr并行在内存收集，只落双方退出码和MySQL错误数字；管道失败停止并回收子进程。因本轮止于W1，此助手没有执行，不能称已完成快照导入。


第二次续行最终恢复核验：原 .17/3e98a6bc 六应用、入口/chunk3×200、匿名Codocs Service API401、Enterprise/Aims60秒无reload、七监听端口/公网302、Runtime本地/公网三轮健康200及匿名业务401、Enterprise/Console私有健康、原binary SHA/config/plist、142/142视图均通过；PM2 save完成。原候选三处协调者热修保持不变，清洁性改为记录差异而非回退他人文件。证据在本轮备份目录 rollback-*；未提交或推送。


## WizBiz 第三次本机演练：plan 前置失败并回滚（2026-10-04 授权）

- 目标 `.18/6874866f`；预检脚本/测试/README提交 `488d75b8`，仅推GitLab origin。
- 已批准安装账号 `hzy_apf_migration@127.0.0.1` 五表ALTER，新增恰五项，原权限不变，无全局ALTER/GRANT OPTION/FLUSH。授权加密备份：`domain-backups/w1-alter-grants-20261005T023851Z`，解密核验通过；此独立批准项保留。
- 新运行栈/四库加密备份：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T023902Z`，解密hash/gzip核验通过；受保护配置/原候选协调者热修保留。
- `.18` 切换全部硬门槛通过；W1十子集 plan/apply/verify通过，generation不变。各reviewHash/耗时如下：

| 子集 | reviewHash | 秒 |
| --- | --- | --- |
| `w1-finance-legal-entity` | `d91848216d986c87834f1c2e3695db06fa6e5f2715060ac6f7a356d6a13ae781` | 1.609 |
| `w1-finance-balance-entry` | `630747303cc6c0b52cf1e42ef550dd2a20c94660e5e940c603fdd100750a87c9` | 1.254 |
| `w1-finance-balance-columns` | `3e1cc53db3802e02d71ddaefe6ef812e964a2a975d19dc63ab026466b58ee82d` | 1.173 |
| `finance-bank-account-columns` | `5efe50fc7b4ba5ee22e38134cbb0a3803bc27ff1e461880d9755308981ba3cb5` | 1.057 |
| `w1-altoc-customer-columns` | `e7fc0d4b9e4906e95f89266af4c88a55cf6f91a6560a88cb25137e7648a62c85` | 1.111 |
| `w1-altoc-contact-columns` | `b38948bda3b15cac5e44ec91290bcf0a2d448b5b2a495839581b055305483347` | 0.906 |
| `w1-altoc-customer-snapshot` | `36a37b21522696307d8db10bedc4a98279d31f1e39bbde7c82dee00933b961fd` | 2.228 |
| `w1-altoc-contract-columns` | `13d5f641995da32d0209cd6adae7045ebcafc35dc457aa4410b7a5b1fefdce17` | 4.732 |
| `w1-altoc-contract-snapshot` | `f64daf59467eae10aaf4a26c69350b864eaa445dc600e7604277bc6167d432b1` | 3.392 |
| `w1-migration-ledger` | `d19ca49619345ac23ad48c9bd1cd3fa7c0179826cf6ab121209344e82f5e9579` | 3.764 |

- MySQL 8.0.34，各ALTER算法和实际毫秒数在各receipt `Installation.ColumnTimings`；COPY步骤：
  - `w1-altoc-customer-columns/foreign-key:fk_altoc_customer_primary_contact`：COPY，34 ms。
  - `w1-altoc-contract-columns/check:ck_altoc_contract_origin`：COPY，69 ms。
- 快照解密参数与W0一致（AES-256-CBC/salt/PBKDF2/iter200000）；导入前及导入流均核对58,037,313字节和SQL SHA `f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`，管道双方exit0。明文SQL未落盘。
- 暂存独立实例仅监听 `127.0.0.1:3318`，库 `wizbiz_stage_20261004t173356z_r2`；`stage-verify` 76表/122,600行通过，source列级SELECT不读银行账号列，metadata同库SELECT-only。
- 首次plan失败：`migration_profile_invalid`，没有plan/reviewHash/blockers产物；严格Runtime config解码不接受现有 `apps.console.vaultMasterKeyFile`（config字段json忽略），需受审工具读取兼容修复。另有目标迁移账号最小权限缺口：运行账号含schema/他库权限，安装账号含DDL，都不能替代专用数据迁移账号；未新增目标账号/grant或放宽护栏。
- 失败即停，无迁移apply/verify、无业务批次/Vault写入，期初应收未执行，未调用OSS/Platform。
- W1按原plan/receipt/hash十段逆序回滚全部通过；恢复 `.17/3e98a6bc`、原binary/config/plist与六应用。入口3×200、Codocs匿名401、Enterprise/Aims60秒稳定、七监听/公网302、本地/公网Runtime健康、私有健康与142视图全部通过，PM2 save。新W1表0，抽样新增列0，其余回滚工具摘要核验通过。
- 暂存快照/只读账号/stage receipt与所有演练证据暂留本机受保护目录，仅回环可达，无调度；责任人Claude协调者，用于后续复核。
- 完整报告 `.git/report-hzy0-wizbiz-rehearsal-1.md`。记录未提交，由协调者审后提交。

## WizBiz 第四次本机演练：目标账号授权通过，plan 的 Directory 只读门禁失败（2026-10-05）

### 批准与备份

用户明确批准仅 hzy0 创建 `hzy_wizbiz_migrate@127.0.0.1` 并执行受审候选248项逐表授权。新备份目录：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T030433Z`，0700；Runtime/config/plist/PM2及统一库、Console、Workflow、Codocs四库加密备份均解密hash/gzip核验通过。未碰云端/生产写、OSS、Platform或GitHub。

运行候选仍为受审 `.18/6874866f`，迁移工具与离线grant工具从干净 `b2f6c761` 构建，含 `aac08a5c` RuntimeBinding兼容修复。候选切换入口/chunk 3×200、Codocs匿名Service API 401、Enterprise/Aims60秒无reload、健康/监听/142视图通过；W1后再次预热/稳定通过。

### W1 安装与账号授权

十子集依序plan/apply/verify通过，Registry generation不变，migration只读/禁写/禁调度。reviewHash与耗时：

| 子集 | reviewHash | 秒 |
| --- | --- | --- |
| `w1-finance-legal-entity` | `d91848216d986c87834f1c2e3695db06fa6e5f2715060ac6f7a356d6a13ae781` | 1.542 |
| `w1-finance-balance-entry` | `630747303cc6c0b52cf1e42ef550dd2a20c94660e5e940c603fdd100750a87c9` | 0.854 |
| `w1-finance-balance-columns` | `3e1cc53db3802e02d71ddaefe6ef812e964a2a975d19dc63ab026466b58ee82d` | 0.903 |
| `finance-bank-account-columns` | `5efe50fc7b4ba5ee22e38134cbb0a3803bc27ff1e461880d9755308981ba3cb5` | 1.131 |
| `w1-altoc-customer-columns` | `e7fc0d4b9e4906e95f89266af4c88a55cf6f91a6560a88cb25137e7648a62c85` | 1.047 |
| `w1-altoc-contact-columns` | `b38948bda3b15cac5e44ec91290bcf0a2d448b5b2a495839581b055305483347` | 0.794 |
| `w1-altoc-customer-snapshot` | `36a37b21522696307d8db10bedc4a98279d31f1e39bbde7c82dee00933b961fd` | 0.835 |
| `w1-altoc-contract-columns` | `13d5f641995da32d0209cd6adae7045ebcafc35dc457aa4410b7a5b1fefdce17` | 1.416 |
| `w1-altoc-contract-snapshot` | `f64daf59467eae10aaf4a26c69350b864eaa445dc600e7604277bc6167d432b1` | 0.848 |
| `w1-migration-ledger` | `d19ca49619345ac23ad48c9bd1cd3fa7c0179826cf6ab121209344e82f5e9579` | 1.037 |

MySQL 8.0.34，ALTER实际算法/耗时：

  - `w1-finance-balance-columns/column:entry_count`：INPLACE，11 ms。
  - `w1-finance-balance-columns/column:latest_tie_count`：INPLACE，7 ms。
  - `w1-finance-balance-columns/column:distinct_amounts`：INPLACE，7 ms。
  - `finance-bank-account-columns/column:short_name`：INPLACE，13 ms。
  - `finance-bank-account-columns/column:bank_branch_code`：INPLACE，11 ms。
  - `finance-bank-account-columns/column:legal_entity_code`：INPLACE，11 ms。
  - `finance-bank-account-columns/column:sort_no`：INPLACE，12 ms。
  - `finance-bank-account-columns/column:account_subtype`：INPLACE，12 ms。
  - `finance-bank-account-columns/index:uk_finance_bank_account_short_name`：INPLACE，10 ms。
  - `finance-bank-account-columns/index:idx_finance_bank_account_entity`：INPLACE，10 ms。
  - `w1-altoc-customer-columns/column:primary_contact_id`：INPLACE，33 ms。
  - `w1-altoc-customer-columns/column:contact_name_text`：INPLACE，33 ms。
  - `w1-altoc-customer-columns/column:sort_no`：INPLACE，41 ms。
  - `w1-altoc-customer-columns/index:idx_altoc_customer_primary_contact`：INPLACE，22 ms。
  - `w1-altoc-customer-columns/foreign-key:fk_altoc_customer_primary_contact`：COPY，36 ms。
  - `w1-altoc-contact-columns/column:star_level`：INPLACE，15 ms。
  - `w1-altoc-contract-columns/column:origin_type`：INPLACE，38 ms。
  - `w1-altoc-contract-columns/column:signed_amount`：INPLACE，31 ms。
  - `w1-altoc-contract-columns/column:effective_amount`：INPLACE，33 ms。
  - `w1-altoc-contract-columns/column:contract_category`：INPLACE，32 ms。
  - `w1-altoc-contract-columns/column:amount_basis`：INPLACE，41 ms。
  - `w1-altoc-contract-columns/column:receiving_bank_account_code`：INPLACE，34 ms。
  - `w1-altoc-contract-columns/column:signed_at`：INPLACE，31 ms。
  - `w1-altoc-contract-columns/column:imported_batch_code`：INPLACE，36 ms。
  - `w1-altoc-contract-columns/column:imported_at`：INPLACE，33 ms。
  - `w1-altoc-contract-columns/nullable:tax_rate`：INPLACE，33 ms。
  - `w1-altoc-contract-columns/index:idx_altoc_contract_origin`：INPLACE，24 ms。
  - `w1-altoc-contract-columns/check:ck_altoc_contract_origin`：COPY，38 ms。

- 安装后重新生成grant候选，与已批SQL逐条相等；reviewHash `9759afb07e3fc6bd8c6237ee978c47c1786c82a178bce8c1237ebd8593f924cb`，全部248目标对象已存在。
- 执行前全部账号SHOW GRANTS加密备份并解密字节核验：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T030433Z/target-account/grants.before.json.enc`；执行后快照同目录 `grants.after.json.enc`。随机口令只在0700子目录0600文件及执行进程中存在，未回显/放入argv/env/日志；无FLUSH。
- CURRENT_USER精确匹配；17表DML+231表SELECT合计248项，与候选完整集合相等；仅另有USAGE，无DDL/schema/global/GRANT OPTION。非目标账号权限前后完全相同。离线SHOW GRANTS预检和原始`CheckTargetPrivileges`均PASS。

### 暂存与失败定位

导入前完整解密流与导入流均校验58,037,313字节和SQL SHA `f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`；参数精确为AES-256-CBC/salt/PBKDF2/iter200000，管道双方exit0，明文SQL不落盘、远端密钥不复制到本机。

暂存库 `wizbiz_stage_20261004t173356z_r4` 仅独立本机127.0.0.1:3318可达；源账号列级SELECT拒读银行账号列，元数据账号同库SELECT-only。stage-verify **76表/122,600行PASS**。

plan首次调用exit1，固定码 `migration_target_identity_invalid`，**无migration-plan.json/reviewHash/数据阻断清单**；批次意图 `W2-hzy0-20261005-r4` 尚未写入。不能把这次前置失败称为已经跑出全部数据blocker。

仅只读诊断（未重跑plan）：RuntimeBinding、目标Registry/权限、依赖定义均PASS；`ReadDirectory`失败。Console库名/instance均匹配；该连接使用Console运行账号，7行SHOW GRANTS中6行为非SELECT/非USAGE权限，违反`ReadDirectory`调用的`ValidateSourceGrants` SELECT-only护栏。因此真实失败不在新目标迁移账号，也不是Runtime配置兼容回归。错误来自`plan.go/ReadDirectory`权限检查，不能改宽授权校验绕过。

下一步建议：先只读核对是否已有可用的Console同库SELECT-only连接；若没有，由协调者另请用户批准专用Directory只读账号，仅SELECT `directory_users`、`directory_user_departments`（同实例、精确Console库，无写/DDL/GRANT OPTION），替换profile.directory。此次批准不包含该新账号或权限，未创建/授予。

### 失败即停与处置

没有迁移apply/verify、没有目标业务/Vault写入，期初应收未执行。`mig_batch`回读0。

本轮账号选择 **DROP**：按精确User/Host删除本轮新建账号，回读同用户名全host为0；全部原账号SHOW GRANTS与执行前加密备份完全相同。删除target-account.json和target-gate-profile.json，profile移除target.password；已批准安装账号五表ALTER保持原状（独立成功批准项）。加密授权/创建/删除证据保留。

W1十段按原plan/receipt/hash逆序rollback全部通过；运行栈恢复核验见下面收尾记录。暂存快照、两个暂存SELECT-only账号、stage receipt及本机受保护证据保留，无自动迁移/调度，责任人Claude协调者。未提交文档，由协调者审后提交。

### 第四次演练收尾核验

已恢复原 `.17/3e98a6bc` Runtime及六应用原候选，原binary/config/plist与新备份一致，协调者三处原候选热修保留。入口/chunk 3×200、匿名Codocs Service API 401、Enterprise/Aims60秒无reload、七监听/公网入口302、本地与公网Runtime三轮200及匿名业务401、Console/Enterprise私有健康、142视图全部PASS，PM2 save完成。W1新增10表回读0，balance三列及contract origin_type抽样新增列回读0；其余逐子集回滚摘要核验通过。

状态：**停在plan前置Directory SELECT-only门禁，未生成迁移计划，不是数据质量blocker结论**。本轮目标迁移账号已DROP并删除明文口令文件；暂存库r4、只读暂存账号与证据保留供协调者审查。LOCAL_RUNTIME与报告未提交，没有推送。

## 第五次演练：分阶段门禁与共享 Vault 解析（2026-10-05）

代码提交 `8de975c3b` 已推 GitLab origin，未推 GitHub。新增 Runtime/工具共享 Vault 路径解析；仅复用已运行 Runtime 的受保护 FILE/CONFIG_DIR 配置，不读取现网密钥内容、不生成主密钥。单测、定向隔离 MySQL、Node 预检与源码边界检查均通过（完整测试范围见上一节）。

本轮按裁定顺序执行：W1 前 DDL/source/metadata/profile/绑定 PASS → 新备份 → `.18/6874866f` 与六应用候选切换 → W1 十子集 apply/verify → 重建两账号 → 迁移阶段全身份九项 PASS。尚未进入数据迁移维护窗口。

加密备份根：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T032825Z`。四库/Runtime/config/plist/PM2 备份解密校验通过；授权备份分别位于 `target-account/grants.before.json.enc` 与 `directory-account/grants.before.json.enc`，加密及解密字节核验通过。

目标迁移账号精确 248 项（17 表 DML + 231 表 SELECT），Directory 账号精确两表 SELECT；CURRENT_USER、DB/instance、SHOW GRANTS 集合和实际读取门禁均通过，无 schema/global/DDL/GRANT OPTION，无 FLUSH。其余账号授权完全不变。迁移阶段 DDL 与 profile/runtime_binding/runtime_build/source/source_metadata/target/dependencies/directory/vault 全部 PASS。

### W1 安装记录

| 子集 | reviewHash | 安装秒数 |
| --- | --- | ---: |
| `w1-finance-legal-entity` | `d91848216d986c87834f1c2e3695db06fa6e5f2715060ac6f7a356d6a13ae781` | 1.391 |
| `w1-finance-balance-entry` | `630747303cc6c0b52cf1e42ef550dd2a20c94660e5e940c603fdd100750a87c9` | 1.033 |
| `w1-finance-balance-columns` | `3e1cc53db3802e02d71ddaefe6ef812e964a2a975d19dc63ab026466b58ee82d` | 1.715 |
| `finance-bank-account-columns` | `5efe50fc7b4ba5ee22e38134cbb0a3803bc27ff1e461880d9755308981ba3cb5` | 2.077 |
| `w1-altoc-customer-columns` | `e7fc0d4b9e4906e95f89266af4c88a55cf6f91a6560a88cb25137e7648a62c85` | 2.509 |
| `w1-altoc-contact-columns` | `b38948bda3b15cac5e44ec91290bcf0a2d448b5b2a495839581b055305483347` | 2.014 |
| `w1-altoc-customer-snapshot` | `36a37b21522696307d8db10bedc4a98279d31f1e39bbde7c82dee00933b961fd` | 2.538 |
| `w1-altoc-contract-columns` | `13d5f641995da32d0209cd6adae7045ebcafc35dc457aa4410b7a5b1fefdce17` | 2.916 |
| `w1-altoc-contract-snapshot` | `f64daf59467eae10aaf4a26c69350b864eaa445dc600e7604277bc6167d432b1` | 2.5 |
| `w1-migration-ledger` | `d19ca49619345ac23ad48c9bd1cd3fa7c0179826cf6ab121209344e82f5e9579` | 2.859 |

MySQL 8.0.34；ALTER 实际算法与耗时：

- `w1-finance-balance-columns/column:entry_count`：INPLACE，15 ms。
- `w1-finance-balance-columns/column:latest_tie_count`：INPLACE，17 ms。
- `w1-finance-balance-columns/column:distinct_amounts`：INPLACE，14 ms。
- `finance-bank-account-columns/column:short_name`：INPLACE，24 ms。
- `finance-bank-account-columns/column:bank_branch_code`：INPLACE，17 ms。
- `finance-bank-account-columns/column:legal_entity_code`：INPLACE，25 ms。
- `finance-bank-account-columns/column:sort_no`：INPLACE，31 ms。
- `finance-bank-account-columns/column:account_subtype`：INPLACE，27 ms。
- `finance-bank-account-columns/index:uk_finance_bank_account_short_name`：INPLACE，11 ms。
- `finance-bank-account-columns/index:idx_finance_bank_account_entity`：INPLACE，18 ms。
- `w1-altoc-customer-columns/column:primary_contact_id`：INPLACE，56 ms。
- `w1-altoc-customer-columns/column:contact_name_text`：INPLACE，61 ms。
- `w1-altoc-customer-columns/column:sort_no`：INPLACE，44 ms。
- `w1-altoc-customer-columns/index:idx_altoc_customer_primary_contact`：INPLACE，38 ms。
- `w1-altoc-customer-columns/foreign-key:fk_altoc_customer_primary_contact`：COPY，54 ms。
- `w1-altoc-contact-columns/column:star_level`：INPLACE，33 ms。
- `w1-altoc-contract-columns/column:origin_type`：INPLACE，63 ms。
- `w1-altoc-contract-columns/column:signed_amount`：INPLACE，40 ms。
- `w1-altoc-contract-columns/column:effective_amount`：INPLACE，42 ms。
- `w1-altoc-contract-columns/column:contract_category`：INPLACE，42 ms。
- `w1-altoc-contract-columns/column:amount_basis`：INPLACE，61 ms。
- `w1-altoc-contract-columns/column:receiving_bank_account_code`：INPLACE，54 ms。
- `w1-altoc-contract-columns/column:signed_at`：INPLACE，53 ms。
- `w1-altoc-contract-columns/column:imported_batch_code`：INPLACE，72 ms。
- `w1-altoc-contract-columns/column:imported_at`：INPLACE，41 ms。
- `w1-altoc-contract-columns/nullable:tax_rate`：INPLACE，54 ms。
- `w1-altoc-contract-columns/index:idx_altoc_contract_origin`：INPLACE，51 ms。
- `w1-altoc-contract-columns/check:ck_altoc_contract_origin`：COPY，50 ms。

### 暂存导入与停止原因

导入前全流与导入流均为 58,037,313 字节，SHA-256 `f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`；openssl 参数为 `-aes-256-cbc -salt -pbkdf2 -iter 200000 -d`，源与目标管道均 exit0。仅库名两条声明重绑定；明文 SQL 未落盘，远端密钥未复制。新本机暂存库 `wizbiz_stage_20261004t173356z_r5`：76 表/122,600 条 INSERT 行证据，仅 127.0.0.1:3318。

导入完成后，暂存只读账号创建前的存在性断言失败：私有脚本仍写死先前 r4 使用的账号名。它正确拒绝覆盖既有账号，但账号名未随 r5 批次变化，这是本机编排脚本缺口，不是迁移权限/Vault 门禁缺陷。未创建该轮源账号，未执行 stage-verify、plan、apply、verify；无迁移 reviewHash、无数据质量 blocker 结论、无目标业务/Vault 写入，期初应收未执行。后续须在停机前检查新暂存库及两个暂存用户名全 host 不存在，并按新批次派生唯一名；本轮不重试。

### 回滚与保留

本轮两个目标/Directory 账号均按精确 User/Host DROP，原账号 SHOW GRANTS 与授权备份一致，`mig_batch=0`；删除两个本轮明文口令文件，profile 移除两处密码。已独立批准的安装账号五表 ALTER 保留。W1 十段按原 plan/receipt/hash 逆序 rollback 全部通过。暂存 r5 快照与哈希证据保留；原暂存 r4 和其只读账号不动。保留责任人 Claude 协调者，用途为排障/后续续行；无自动迁移。

### 第五次演练收尾核验

原 `.17/3e98a6bc` Runtime 与六应用候选全部恢复；binary/config/plist 与本轮备份一致，旧候选三处协调者热修保留。Enterprise/Aims/Codocs 入口及 chunk 连续 3×200、匿名 Codocs Service API 401、Enterprise/Aims 60 秒无 reload、七监听、本地/公网 Runtime 三轮健康及匿名业务 401、Console/Enterprise 私有健康、142 视图、PM2 save 全部 PASS。W1 新增十表回读 0，balance 三列和 contract origin_type 抽样新增列回读 0；全部子集原摘要回滚核验通过。

状态：**失败即停并已完整恢复服务，停在暂存只读账号建立前，尚未 plan**。没有数据迁移写入；没有生成新 Vault 主密钥或手动读取现网主密钥内容。代码 `8de975c3b` 已推 GitLab origin，本轮 LOCAL_RUNTIME 未提交，供协调者审后提交。

## 第六次演练：停机前完成暂存准备，plan 源星级阻断（2026-10-05）

上一轮回滚记录已提交 `1264d960`；准备顺序已固化到 README，提交 `92542e09`，仅推 GitLab origin。私有编排脚本源/元数据用户名改为由本次批次 SHA-256 派生，创建前全 host 不存在断言通过；脚本及修订证据保存于本轮受保护备份，不含秘密回显。

本轮备份：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T034056Z`。Runtime/config/plist/六应用 PM2 与四库加密备份均已解密校验。批次 `W2-hzy0-20261005-r6`，银行账号 synthetic，期初应收不执行。

### 停机前门禁

复用暂存库 `wizbiz_stage_20261004t173356z_r5`，重新只读计算封存解密全流 SHA-256：`f3edc77ee322bf5a6ce169acaa28f21cc3cdb98070957a50fc5fdb7dc61e36da`，58,037,313 字节；与 W0/上一轮成功导入管道及清单一致。openssl 精确 `-aes-256-cbc -salt -pbkdf2 -iter 200000 -d`，明文 SQL 不落盘。创建本次唯一列级源只读账号（拒读银行账号列）及同库元数据 SELECT-only 账号；授权备份已加密并核验可解密。

**stage-verify 已在 hzy0 停机前 PASS：76 表/122,600 行，结构/主键/行数/受管字段摘要通过。** 受保护 `stage-reuse-evidence.json` / `stage-receipt.json` 保存复用与本轮证据。W1 阶段 DDL/source/metadata/profile/绑定全部 PASS 才开始切换。

### 维护窗口

`.18/6874866f` 与六应用同候选切换通过，入口/chunk 3×200、匿名 Codocs Service API 401、60 秒无 reload、七监听、健康、142 视图 PASS。W1 十段 plan/apply/verify 通过，generation 不变；W1 完成后保持 Runtime/应用停止，不再中途启停。两账号创建前授权加密备份与解密核验通过：目标迁移账号恰 248 项、Directory 恰两表 SELECT，均无 schema/global/DDL/GRANT OPTION，其余账号授权不变。

在 Runtime/应用仍停止时，迁移阶段 DDL 与 profile/runtime_binding/runtime_build/source/source_metadata/target/dependencies/directory/vault 九项全部 PASS；Vault 仅复用 Runtime 原解析路径，预检不读取密钥内容、不生成主密钥。

| W1 子集 | reviewHash | 秒数 |
| --- | --- | ---: |
| `w1-finance-legal-entity` | `d91848216d986c87834f1c2e3695db06fa6e5f2715060ac6f7a356d6a13ae781` | 1.121 |
| `w1-finance-balance-entry` | `630747303cc6c0b52cf1e42ef550dd2a20c94660e5e940c603fdd100750a87c9` | 0.802 |
| `w1-finance-balance-columns` | `3e1cc53db3802e02d71ddaefe6ef812e964a2a975d19dc63ab026466b58ee82d` | 0.827 |
| `finance-bank-account-columns` | `5efe50fc7b4ba5ee22e38134cbb0a3803bc27ff1e461880d9755308981ba3cb5` | 0.954 |
| `w1-altoc-customer-columns` | `e7fc0d4b9e4906e95f89266af4c88a55cf6f91a6560a88cb25137e7648a62c85` | 0.977 |
| `w1-altoc-contact-columns` | `b38948bda3b15cac5e44ec91290bcf0a2d448b5b2a495839581b055305483347` | 1.043 |
| `w1-altoc-customer-snapshot` | `36a37b21522696307d8db10bedc4a98279d31f1e39bbde7c82dee00933b961fd` | 0.779 |
| `w1-altoc-contract-columns` | `13d5f641995da32d0209cd6adae7045ebcafc35dc457aa4410b7a5b1fefdce17` | 1.374 |
| `w1-altoc-contract-snapshot` | `f64daf59467eae10aaf4a26c69350b864eaa445dc600e7604277bc6167d432b1` | 0.795 |
| `w1-migration-ledger` | `d19ca49619345ac23ad48c9bd1cd3fa7c0179826cf6ab121209344e82f5e9579` | 0.955 |

MySQL 8.0.34；实际 ALTER 算法与耗时：

- `w1-finance-balance-columns/column:entry_count`：INPLACE，5 ms。
- `w1-finance-balance-columns/column:latest_tie_count`：INPLACE，6 ms。
- `w1-finance-balance-columns/column:distinct_amounts`：INPLACE，5 ms。
- `finance-bank-account-columns/column:short_name`：INPLACE，9 ms。
- `finance-bank-account-columns/column:bank_branch_code`：INPLACE，10 ms。
- `finance-bank-account-columns/column:legal_entity_code`：INPLACE，10 ms。
- `finance-bank-account-columns/column:sort_no`：INPLACE，10 ms。
- `finance-bank-account-columns/column:account_subtype`：INPLACE，11 ms。
- `finance-bank-account-columns/index:uk_finance_bank_account_short_name`：INPLACE，8 ms。
- `finance-bank-account-columns/index:idx_finance_bank_account_entity`：INPLACE，9 ms。
- `w1-altoc-customer-columns/column:primary_contact_id`：INPLACE，31 ms。
- `w1-altoc-customer-columns/column:contact_name_text`：INPLACE，29 ms。
- `w1-altoc-customer-columns/column:sort_no`：INPLACE，33 ms。
- `w1-altoc-customer-columns/index:idx_altoc_customer_primary_contact`：INPLACE，20 ms。
- `w1-altoc-customer-columns/foreign-key:fk_altoc_customer_primary_contact`：COPY，27 ms。
- `w1-altoc-contact-columns/column:star_level`：INPLACE，31 ms。
- `w1-altoc-contract-columns/column:origin_type`：INPLACE，34 ms。
- `w1-altoc-contract-columns/column:signed_amount`：INPLACE，34 ms。
- `w1-altoc-contract-columns/column:effective_amount`：INPLACE，35 ms。
- `w1-altoc-contract-columns/column:contract_category`：INPLACE，32 ms。
- `w1-altoc-contract-columns/column:amount_basis`：INPLACE，31 ms。
- `w1-altoc-contract-columns/column:receiving_bank_account_code`：INPLACE，33 ms。
- `w1-altoc-contract-columns/column:signed_at`：INPLACE，32 ms。
- `w1-altoc-contract-columns/column:imported_batch_code`：INPLACE，32 ms。
- `w1-altoc-contract-columns/column:imported_at`：INPLACE，34 ms。
- `w1-altoc-contract-columns/nullable:tax_rate`：INPLACE，32 ms。
- `w1-altoc-contract-columns/index:idx_altoc_contract_origin`：INPLACE，22 ms。
- `w1-altoc-contract-columns/check:ck_altoc_contract_origin`：COPY，38 ms。

### plan 阻断与只读诊断

plan 首次执行 exit1，固定码 `migration_source_value_invalid`。未生成 `migration-plan.json` / reviewHash；未 apply/verify，无迁移业务/Vault写入，`mig_batch=0`。不能声称已产出全部数据 blocker 或可执行计划。

只读诊断确认覆盖字段读取、非空/日期/小数格式及已检查的名称长度没有违规计数；业务转换首个拒绝点为 `data-runtime/internal/migrations/wizbiztool/transform.go:356–359`，联系人 stars 必须 1..6 或 NULL。统计仅输出计数：有非零客户归属的联系人 **873**；stars=0 **829**；1..6 **44**；NULL **0**；其它范围外 **0**。不输出联系人、客户名、源主键或账号值。

依据 `docs/WizBiz-Migration-W2-Verify-Test-Spec.md:105`：1..6 原值映射、NULL 保留、范围外阻断。当前代码符合已审合同，不能自行把0映射为NULL、删除源行或扩大目标枚举。本轮停止，不重跑 plan。该结论是首个已确认阻断，后续尚有可能出现其它阻断，不能宣称已列尽。协调者/用户需先裁定旧0值的明确语义及无损保留方式，再修改合同与工具并隔离回归；不能只改真实暂存数据放行。

诊断仅在工具隔离候选中临时执行 SELECT-only 测试；临时源定位标签/测试文件已删除，原源码字节恢复，候选 git status 干净；未改主线或授权语义。证据 `source-value-diagnostic.log` / `source-stars-count.json`。

### 失败即停与完整回滚

两本轮迁移账号精确 DROP，原 SHOW GRANTS 与备份一致，本轮口令文件删除，profile 两处密码移除；安装账号已独立批准的五表 ALTER 保留。W1 十段按原 plan/receipt/hash 逆序 rollback PASS。回滚脚本补已停止状态处理：LaunchAgent 不存在时先确认 Runtime 端口关闭，再跳过重复 bootout；未忽略未知停止失败。

原 `.17/3e98a6bc` Runtime 与六应用候选已恢复；binary/config/plist 与本轮新备份一致，原协调者三处热修保留。入口/chunk 3×200、匿名 Codocs 401、Enterprise/Aims 60 秒无 reload、七监听、本地/公网 Runtime 三轮健康/匿名业务401、私有健康、142视图及 PM2 save 全部 PASS。W1 十新增表回读0，balance三列及contract origin_type抽样新增列回读0；各子集摘要回滚核验通过。

暂存 r5、本轮批次派生的源/元数据 SELECT-only 账号及受保护证据保留供后续审查；原 r4 暂存和账号未改。保留责任人 Claude 协调者，无自动迁移。最终状态：**停在 plan 源值校验，服务恢复，无数据迁移写入**。未写远端/云/OSS/Platform，未推 GitHub。

## 2026-10-05：WizBiz r7 全转换审计通过，plan 目标读取失败后恢复

用户裁定已由工具提交 `8e81eb78` 落实：stars=0→NULL；合同联系人客户错配16条关联置NULL、原ID留台账并生成contract_contact_mismatch；is_third_party只读取值N=1593/Y=2（源码字典明确否/是），映射0/1、原值保全。W2/Go/队列隔离与Host/Finance测试通过；仅推GitLab。

新加密备份并解密核验：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T042150Z`。批次W2-hzy0-20261005-r7，封存SQL58037313字节与原SHA一致；r5暂存复用，新只读源账号按批次派生，stage-verify与全转换审计ready=true/blockers=[]在停机前完成。

按原批准切.18/6874866f并通过入口/健康/142视图，W1十子集安装/verify/generation保持通过；目标248项与Directory两表SELECT账号先备份/后核对、无额外授权，全身份预检PASS。plan一次失败：migration_target_identity_invalid，无plan/reviewHash，未apply/verify、无迁移批次/业务/台账/Vault写入、未做期初应收。

失败即停并回滚：两账号DROP、原grants一致、口令文件删除；W1十子集逆序rollback，新增表0、新列抽查0；.17/3e98a6bc与原六进程恢复，config/plist/binary与备份一致，3×200/匿名401/60秒稳定/七监听/142视图/本地公网健康/PM2save PASS。暂存与r7源只读账号保留给Claude；无自动续行。完整reviewHash/耗时与授权证据在上述备份目录，诊断记录见私有演练报告。本轮Runtime/Host仍为既定候选，新异常标签待后续代码候选同步。


## 2026-10-05：WizBiz r9 plan 通过，apply 失败后恢复原运行栈

用户批准本机真实执行一次，失败即停回滚；Vault synthetic，不执行期初应收。工具从干净 `9da05b4b` 构建，Runtime/app 候选 `.18/6874866f`。新备份目录：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T140345Z`。统一库、Console、Workflow、Codocs 与 Runtime/PM2 配置包均加密并验证可解密，权限 0600/0700。

### 执行结果

停机前封存 SQL 全流 SHA-256 与 58037313 字节一致；复用 3318 暂存，stage-verify 与全转换审计通过，blockers=[]。切 .18 预热/健康通过；W1 十子集安装及 verify 通过、generation 不变。MySQL 8.0.34，列/约束执行方式与耗时逐项保存在各子集 receipt：本轮记录 INPLACE 19 项、COPY 2 项。目标账号精确 248 项、Directory 账号两表 SELECT，非目标授权不变，全身份预检通过。

批次 `W2-hzy0-20261005-r9`，reviewHash `e292da90de1fe6d499d605c3a7bdf3ac0a322219e2d499276cef48d4a40d70a5`。plan 12 步、13603 对象；8 类 ID 目标、9737 显式 ID、32 个外部引用列、160 条迁移前引用快照（含 Aims contract_id）。本轮只执行一次 apply：exit 1，未执行 migration verify。失败时 8 步完成、1 步运行；磁盘仅余约 112 MiB，临时脚本写入出现 ENOSPC，apply 日志/回执为 0 字节，不能据此确定工具内部的具体错误码。该进度不是独立 verify 结果，不能视为迁移成功。

### 失败即停与恢复

未重试 apply。确认并停止本轮已验证的独立 3320 副本，仅删除其可恢复 data 目录（约 2.7 GiB）及自建干净工具 worktree（约 174 MiB）；封存源、3318 暂存、加密备份和副本成功证据均保留。未删除无关文件或清理 MySQL binlog。

正式工具 rollback：status=rolled_back、retained=0。随后用本轮备份的解密→gzip→mysql 流恢复统一库与 Console 库，三个进程退出码均 0，未落地明文 SQL；恢复后对象数分别 386、71。Workflow/Codocs 未受迁移写入，未恢复改写它们。两本轮新建账号按创建标记精确 DROP，原 SHOW GRANTS 与加密备份一致；本轮账号口令文件删除，主 profile 的目标/Directory 密码移除；此前独立批准的安装账号五表 ALTER 保留。W1 十新增表回读 0，抽查新增列回读 0。

原 `.17/3e98a6bc` Runtime 与六应用候选恢复；binary/config/plist 与备份一致。入口/chunk 连续 3×200、匿名 Codocs Service API 401、Enterprise/Aims 60 秒无 reload、七监听、本地/公网三轮健康与匿名业务 401、私有健康、142 视图及 PM2 save 全部通过。

最终状态：**真实迁移未完成，迁移结果已回滚，hzy0 保持 .17 在线**。migration verify 计数不存在，不填为 0；无期初应收、无真实 Vault 写入、无生产/OSS/Platform 写入。生产 Aims 四行合同引用本轮未处理。保留责任人为 Claude 协调者；没有自动续行，下次维护前需先确认磁盘容量充足。本轮仅向 GitLab origin 提交运行记录，未推 GitHub。


## 2026-10-05：WizBiz r10 磁盘门禁通过，账号制品遗漏后恢复

用户清理磁盘后批准一次新窗口。磁盘门禁提交 `62d1ad57` 已仅推GitLab，12项测试通过：20GiB最低下限，按备份/暂存/日志/回滚预算提高，读取用户可用空间、失败关闭、二次耗尽及身份失败汇总均覆盖。预检两种模式集成下限；编排在停机前与apply紧邻前调用独立预算检查。README同步。

清理只在独立3318暂存实例执行：过期r2/r4库与10个旧源/元数据只读账号删除，授权先加密备份可解密；保留最新r5暂存、最新真实加密备份和成功/失败证据。3318仍供本轮复用。上一轮3320已停止、data删除，证据保留；未删真实库、封存源或数据库日志。

新备份：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T143101Z`。四库和Runtime/PM2加密备份均验证可解密，0600/0700保护；工具复用干净9da05b4b产物且逐件SHA一致，磁盘检查源码62d1ad57。批次`W2-hzy0-20261005-r10`。停机前封存全流SHA/58037313字节一致，stage-verify与全转换审计零blocker PASS。保守待增长预算：备份4GiB、暂存4GiB、DB/日志16GiB、回滚8GiB，总32GiB；真实库/暂存/备份路径分别检查，约63GiB可用，满足门槛。

`.18/6874866f`切换、入口3×200、60秒稳定、健康、142视图通过；W1十子集plan/apply/verify通过，generation不变。随后目标账号脚本在任何CREATE USER之前读取`target-grants-current.json`报ENOENT，本轮同时遗漏`grant-profile.json`。**这是编排准备遗漏，非授权不足或工具闭集变化。**停止续行：Directory账号步骤未执行，迁移plan/apply/verify均未执行，migration reviewHash/verify计数不存在；未触发apply前容量检查，因为未到达apply。

W1依原plan/receipt/hash逆序rollback全部PASS；新表回读0、抽查新列0，两迁移账号回读0。原`.17/3e98a6bc`与六应用候选恢复，binary/config/plist与备份一致，入口/chunk3×200、匿名Codocs401、Enterprise/Aims60秒无reload、七监听、本地/公网三轮健康与匿名业务401、私有健康、142视图及PM2save全PASS。

恢复后只读补齐授权清单：从本轮原配置生成grant-profile/target-grants-current，逐行与已审SQL核对恰为248项，无账号/授权写入；编排停机前新增文件存在、0600/属主、目标身份及精确集合断言，通过后才能停止Runtime。未再开新窗口。没有业务/Vault/期初应收/生产/OSS/Platform写入，生产Aims四行未处理。最终hzy0保持`.17`在线，最新暂存及证据由Claude协调者保留，无自动重试；只推GitLab。


## 2026-10-05：WizBiz r11 同制品副本彩排与真实迁移成功

### 同 SHA 全链彩排门禁

用户要求真实窗口前使用完全相同的编排脚本与制品，仅目标参数指向隔离副本。提交 `fdab5703` 交付公共 runner、严格的本机隔离安装 profile 与测试，已仅推 GitLab origin。installer 默认本机与生产护栏不变；副本仅接受固定 C000001/test、3320、登记 UUID/非零 generation、独立 Runtime 18184 的停止证明，无测试注入。

副本 `3320` 从加密统一库与 Console 备份恢复，执行同一 runner 的 W1 十子集 → 两账号 → 全身份预检 → plan → apply → verify → 正式 rollback；verify 检查 49731 项，差异 0，孤儿 Vault 0；rollback retained=0，再恢复原 schema，全部原表行数与 SHOW GRANTS 集合相等。证据：`/Users/gavinzhou/Library/Application Support/HuizhiYun/wizbiz-rehearsal-shared-20261005/trial1`。副本与真实参数均使用同一批次 `W2-hzy0-20261005-r11`、同一源快照与同一组工具路径。

公共 runner SHA-256：`441b309fcc232653b7fa41a4d940e2299248b53c641fa16c153ec0efb9407b97`。11 件脚本/工具制品逐件冻结，彩排后、真实执行前及执行后均核对一致；精确清单保存在副本与真实目录的 `artifact-sha.json`、`same-artifact-proof.json`。Runtime .18 二进制 SHA 为 `eb354cfbf4cf665f564a820fcb53df504cd41587d015c470274071dba28a0328`。公共 runner 执行 W1/账号/迁移全链；进程切换只负责受保护配置装配、停启与健康检查，没有另外一套 W1/账号逻辑。

### 真实窗口与备份

新加密备份：`/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-rehearsal18-6874866f-20261005T145222Z`。统一库、Console、Workflow、Codocs、Runtime/PM2 配置均验证可解密，权限 0600/0700；源 SQL 只流式解密核对，不落地明文。封存快照 `20261004T173356Z` 全流 58037313 字节与 W0 SHA 一致，3318 暂存复用前 stage-verify 和全部转换值审计通过、blockers=[]。停机前与 apply 紧邻前分别通过容量门禁：最低 20GiB，按本轮备份/暂存/日志/回滚预算要求 32GiB，用户可用空间满足。

窗口开始/结束均通过 Orca 通知 Claude，send 返回 accepted=true。Runtime `.18/6874866f` 与六应用同候选切换；受保护配置、入口/chunk 连续 3×200、Codocs 匿名 Service API 401、Enterprise/Aims 60 秒无 full reload 通过，再停止进程执行公共 runner。W1 十子集 plan/apply/verify 全部通过，generation=1 保持不变。两新账号分别恰为已审 248 项目标授权与两表 SELECT，无 schema 通配/DDL/GRANT OPTION，非目标授权集合不变；全身份预检通过。账号口令只存于受保护 0600 文件，本次成功后保留账号用于迁移核对。

### 迁移结果

批次 `W2-hzy0-20261005-r11`，reviewHash `2730305d1f4cee22d33668063f73ca2a2c12b146a70837fdb37029c2f7911377`。plan 12 步、13603 个对象；8 类目标显式 ID 分配与外部引用快照纳入 reviewHash，apply 前复核。仅执行一次 apply，status=applied；独立 verify **checked=49731、differences=[]、orphanVaultCount=0**。只使用 synthetic Vault，不执行期初应收，不写生产、OSS 或 Platform。生产 Aims 四行合同引用本轮未处理，仍待生产 APF plan 冻结判定。

已审迁移事项按闭集登记，属于需人工处理的事实，不是 plan blocker：`{"balance_without_account": 57, "contact_orphan": 29, "contact_without_customer": 721, "contract_balance_mismatch": 20, "contract_contact_mismatch": 16, "effective_amount_exceeds_total": 6, "identity_source_missing": 1, "owner_unmatched": 2323, "primary_contact_mismatch": 63}`。不输出客户名、个人信息、完整银行账号或凭据。

### 最终运行状态与保留

成功后保留迁移结果及 Runtime `0.3.295-test.apf-enable.18 /6874866f`，不回滚。六应用同候选、入口/chunk 3×200、Codocs 匿名401、60秒无reload、七监听、142/142视图、本地/公网三轮健康200及匿名业务401、私有健康与 PM2 save 全部通过。最终证据：`success-final-health.json`、`shared-run/success.json`、独立 apply/verify 回执、十子集 reviewHash 和逐件制品 SHA。

备份、3318源暂存、副本成功/回滚证据与迁移台账由 Claude 协调者保留；没有自动清理真实迁移结果。此前已清理的过期暂存与旧候选不重新恢复。后续业务浏览器验收由协调者安排。仅向 GitLab origin 提交记录，未推 GitHub。

### 2026-10-05 APF UI B4 迁移事项与只读事实

本机 Runtime 已更新为 `0.3.295-test.apf-ui-b4.25`（`7c5a9c807081ca43e0d008df69dfd94424410eeb`），SHA-256 `0fde02c3deb377c9a52526b963b1bd0548726ea74e78f41819ac7a13aa03c385`。七应用运行于同一干净候选 `/Users/gavinzhou/orca/hzy-wt-apf-ui-b4`。加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-ui-b4-20261005T231247Z/runtime-config-profile-pm2.tar.enc` 已验证可解密；十模块 prepare、十二动态入口切换前连续三轮 200、切换后 smoke 12/12 与八个业务模块 JavaScript 检查通过。完整八项 LaunchAgent 环境启动探测、兼容视图前后 142/142、本机及公网三轮新版本 health、60 秒 PID 稳定且 Enterprise/Aims 无 full reload 均通过。HMR 关闭、手动刷新保持；六份受保护配置与 profile/plist 原字节保持，Collab 配置、已批 DDL、精确绑定、迁移数据与 grant 未改。

此记录不代表用户业务页面验收通过；Altoc/Finance 迁移事项页 1440/390 复验待有效登录。失败回退二进制 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-ui-b4-20261005T231247Z/runtime.before` 并启动旧七进程候选 `/Users/gavinzhou/orca/hzy-apf-ui-b2-27e86ff2`（`.24/27e86ff2`），不回退业务数据库。详见私有 `.git/report-apf-ui-b4.md`。

### 2026-10-05 APF UI B3 Finance 基础工作台

七应用已切到干净候选 `/Users/gavinzhou/orca/hzy-apf-ui-b3-f5c31cff`（`f5c31cffcab125296ec74b00911329bd6ffcb589`，含 B4）。本批仅 Finance UI/工具/测试变化，Runtime 保持 `0.3.295-test.apf-ui-b4.25/7c5a9c80` 原进程与原二进制（SHA-256 `0fde02c3deb377c9a52526b963b1bd0548726ea74e78f41819ac7a13aa03c385`），没有 Runtime/BFF/schema/grant 变化。加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-ui-b3-20261005T234013Z/runtime-config-profile-pm2.tar.enc` 已验证解密摘要；六份受保护配置原字节/0600/属主保持，Collab 配置、已批 DDL、精确绑定与迁移数据保持。

十模块 prepare、新候选 Finance 197/197、切前 24 个动态入口连续三轮 200（HMR 关闭）、切后动态 smoke 12/12 与 B3+B4 业务模块 JavaScript 14/14、兼容视图前后 142/142、本机/公网三轮 health、60 秒七进程 PID 稳定及 Enterprise/Aims 无 reload 全通过。真实 1440/390 用户业务验收仍待登录，不计为已通过。回滚仅恢复七应用到 `/Users/gavinzhou/orca/hzy-wt-apf-ui-b4`，Runtime/业务数据库不回退；详见私有 `.git/report-apf-ui-b3.md`。


### 2026-10-06：WizBiz 期初应收与真实 Vault 补充迁移完成

用户逐环境批准本机真实 Vault、快照派生期初确认、仅首尾 TrimSpace 与 Runtime 密钥 HMAC 冻结。原迁移 reviewHash `2730305d1f4cee22d33668063f73ca2a2c12b146a70837fdb37029c2f7911377` 保持；迁移后两次正式 Finance 用户编辑已逐项归因到回执/审计，冻结当前状态作为独立基线，未覆盖用户编辑。

先在独立3320副本以同SHA runner/tool完成 Vault plan/apply/verify、opening plan/apply/verify、两段逆序回滚及回滚后Vault verify，全PASS。runner SHA `e39d4cfc027703b35ae2ba2acb75ec19eb2217e864100e37bddf907af2415d46`，工具SHA `0751cb808f73d39ebc7e45918130fe8c802db3392d99c768ccd45e2c7523092e`。副本证据 `~/Library/Application Support/HuizhiYun/wizbiz-rehearsal-shared-20261005/followup-20261006T054227052Z/trial1`。

真实窗口停止七应用与Runtime，新备份两库至 `~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-followup-backup-20261006T055032Z`，加密及全流解密摘要通过，0600/0700；每步≥20GiB容量门禁通过。相同制品执行一次，成功结果保留、不回滚：

- 21个账户真实Vault升级 done=21、retained=0，`trim_count=1`，verify通过；内部字符不改，原值仅保留在封存加密源，计划/台账不记录明文或无盐真实账号摘要。补充reviewHash `9a189fb5dac4f86c5e8afd6f7359c3433c1d61a6a3a49821fcf281f3e811cdad`。
- 期初批次 `W2-hzy0-opening-20261006`，reviewHash `b0166e92a28f3242a848d2f06af28e0bc94518469e441ba15da5dee96fcffbfb`；139合同、103源客户、19,989,184.22，checked=139、differences=[]、orphanVaultCount=0。来源为W0封存快照与用户裁定，未提供或伪造财务签字。
- 执行证据 `~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/wizbiz-followup-real-20261006T055050Z`。

3318源只读账号临时account_number列SELECT已撤销，最终SHOW GRANTS与授权前逐项完全相同。原Runtime `.25/7c5a9c80`及七应用 `/Users/gavinzhou/orca/hzy-host-spacing-d76e2a49`恢复；配置/profile/plist/binary原字节保持。Enterprise/Codocs入口3×200、匿名CodocsServiceAPI401、动态smoke12/12与18业务模块JavaScript、Aims受信GET3×200、60秒PID稳定及无full reload、142/142视图、本机/公网三轮健康通过，PM2save。Collab配置/已批DDL/绑定与服务grant未改，未写OSS/Platform。B5-A安装切换为后续独立窗口，不能据本记录视为已执行。


### 2026-10-06：APF B5-A 应收工作台配套切换

在期初应收/真实Vault窗口结束后独立开窗，已审`c9e5a32b`随集成`cbf94143`干净候选 `/Users/gavinzhou/orca/hzy-apf-b5a-cbf94143` 上线；Runtime `0.3.295-test.apf-b5a.26`与七应用配套。十模块prepare、Codocs Worker装配及六受保护配置原字节核验、30动态入口切前连续3×200通过。新配置/进程加密备份 `~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-b5a-20261006T060146Z/runtime-config-profile-pm2.tar.enc`；停写两库加密备份 `wizbiz-followup-backup-20261006T060304Z`，均全流解密验证。

停止Runtime后经批准安装`altoc-receivables`一表，plan/reviewHash/apply/verify通过：`857ee06064b8ef7cf4428a58f227149a53a705d2353fbe3602b0eebfe961162f`，generation=1不变，配置唯一变化为altoc_collection_event映射。证据位于apf-b5a备份目录的altoc-receivables子目录。scheduler/grant未改；Altoc manifest/test重签仍待用户批准，不将新人员动作视为已授权。

切后入口3×200、匿名Codocs401、动态smoke12/12与9业务模块、Aims受信GET3×200、142/142视图、本机/公网三轮健康及60秒PID稳定无reload通过，PM2save，最终候选git干净、十模块生成物完整。Aims/Workflow启动阶段各一次依赖准备失败后重启，随后稳定门禁通过。只读核对原批次/期初批次及reviewHash保持、139笔期初合计19,989,184.22、新催收事件0；Collab/迁移/真实Vault结果保持，未操作Platform/服务grant。真实1440/390业务验收待协调者安排。

失败回滚限本安装receipt证明的新空表及映射，恢复source.json、runtime.before与旧七应用`hzy-host-spacing-d76e2a49/.25`；不恢复旧业务数据库、不回退期初或Vault。本次成功结果保持。

### 2026-10-06 共享远程选择器与导航候选切换


324b6c4a 已快进合入并推送 GitLab 集成分支。七应用同一干净候选 `/Users/gavinzhou/orca/hzy-shared-selectors-324b6c4a`；Runtime 保持 `0.3.295-test.apf-b5a.26` 原二进制。加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/shared-selectors-20261006T111031Z/runtime-config-profile-pm2.tar.enc` 全流解密摘要校验通过。

十模块 prepare、Codocs Worker 重建/装配、六受保护配置逐字节/0600/属主核验通过；切前30动态入口连续3轮200、手动刷新/HMR关闭验证通过。切后入口3×200、匿名Codocs Service API401、动态smoke、21业务SFC JavaScript、142/142视图前后、本机/公网三轮Runtime健康、60秒七进程PID稳定和Enterprise/Aims无reload、Aims受信只读探针均PASS。PM2 save完成。重点导航与选择器测试11/11通过，复用交付全量测试证据。

profile/plist/Runtime二进制摘要不变；未执行DB/grant/Platform/scheduler写入，Collab配置/DDL/绑定与迁移/opening/real Vault结果保持。失败回滚只恢复旧七应用候选 `/Users/gavinzhou/orca/hzy-apf-b5a-cbf94143`，不回退业务数据。实际1440/390业务验收待协调者安排，不计为已通过。证据 `.git/shared-selectors-*` 与备份目录。

### 2026-10-06 Aims管理员项目Runtime/Host配套切换


`60e8e09b87cde618416e39b9f16b1feab9dc027a` 已核对并快进合入 GitLab 集成分支。Runtime 从 `.26` 升为 `0.3.295-test.aims-admin.27 /60e8e09b8`，二进制 SHA256 `480dc981ef161890d8d3c257c72e439e0914ec8f1e16dea0ca76508313c21ccf`；七应用同一干净候选 `/Users/gavinzhou/orca/hzy-aims-admin-60e8e09b`。

加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/aims-admin-20261006T162550Z/runtime-config-profile-pm2.tar.enc` 解密摘要核验PASS；停机前磁盘门禁最初不足20GiB，仅清理可再生成Go缓存后恢复22GiB，切换前再次PASS。未删运行/回滚候选或备份证据。十模块prepare、六份受保护配置原字节/0600/属主、Codocs Worker重建装配通过；38动态入口切前连续3轮200，HMR关闭与手动刷新保持。切后入口3×200、Codocs匿名Service API401、新routine-batch匿名401、动态smoke、21原业务SFC加4个Aims页面、142/142视图前后、60秒七进程PID稳定及Enterprise/Aims无reload、本机/公网三轮Runtime健康、受信Aims只读探针、PM2 save均PASS。新增管理员路由重点Go测试与Host契约2/2通过，其余交付全量回归证据复用。

profile/plist与六配置摘要保持；无schema/grant/manifest/Platform写入，Collab/迁移/opening/real Vault/scheduler不变。回滚为备份runtime.before + 原七应用候选 `/Users/gavinzhou/orca/hzy-shared-selectors-324b6c4a`（.26），不回退业务数据。真实1440/390用户业务验收待协调者安排，不能视为本次已通过；不执行批量业务写入作为smoke。详细证据 `.git/aims-admin-*` 及备份目录。

### 2026-10-06 项目管理树Runtime/Host配套切换


418b235a 已快进合入并推送 GitLab 集成分支。Runtime 升至 `0.3.295-test.aims-tree.28 /418b235a3`，二进制 SHA256 `673c5620d0c49d27a2cb5588fda050d0641d321c431d41012d8519c9c3ebd52d`；七应用同一干净候选 `/Users/gavinzhou/orca/hzy-aims-tree-418b235a`。

加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/aims-tree-20261006T170844Z/runtime-config-profile-pm2.tar.enc` 解密摘要核验通过。磁盘20GiB门禁最初不足，只清理两份已退役干净候选可再生成依赖/生成物，以及Go/pnpm/node-gyp缓存后通过；保留源码/受保护配置/运行及直接回滚候选/备份证据。十模块prepare、六配置原字节/0600/属主、Codocs Worker重建装配、38动态入口切前连续3轮200和HMR关闭均PASS。切后入口3×200、Codocs匿名Service API401、精确Runtime匿名401、动态smoke、21原业务SFC与4Aims页、142/142视图前后、本机/公网三轮健康、60秒七进程PID稳定和Enterprise/Aims无reload、受信Aims只读探针、PM2 save全部PASS。Host重点测试1/1通过，交付全量回归证据复用。

无DB/schema/grant/manifest/Platform写入，profile/plist/六受保护配置摘要保持；Collab/迁移/opening/real Vault/scheduler不变。回滚为备份runtime.before和原七应用 `/Users/gavinzhou/orca/hzy-aims-admin-60e8e09b`（.27），不回退业务库。真实1440/390树展开、父子分页与编辑验收待协调者安排，不计为已通过。证据 `.git/aims-tree-*` 与备份目录。

### 2026-10-06 项目树编辑与页面边距配套切换


a4a4c00d989602140e017274940d4bc375fd4438 已核对并快进合入、推送 GitLab 集成分支。Runtime 更新为 `0.3.295-test.aims-tree-edit.29 /a4a4c00d9`，二进制SHA256 `f02f590ecafc9826515bff95a004c33d4743be9de248a982390531ba85dcd7af`；七应用同一干净候选 `/Users/gavinzhou/orca/hzy-aims-tree-edit-a4a4c00d`。

加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/aims-tree-edit-20261006T174011Z/runtime-config-profile-pm2.tar.enc` 全流解密摘要PASS。空间不足时未停服；仅清理早期R2a/R3/tab/brand独立Go缓存，恢复20GiB门禁。十模块prepare、六份受保护配置原字节/0600/属主、Codocs Worker装配、38动态入口连续3轮200与HMR关闭通过；Host重点22/22测试通过，交付全量回归证据复用。切后入口3×200、匿名Codocs与Runtime精确入口401、动态smoke、21业务SFC与4Aims页、142/142视图前后、60秒七进程PID稳定/Enterprise+Aims无reload、本机公网三轮健康、受信Aims只读探针和PM2 save均PASS。

无schema/grant/manifest/Platform/业务库写入；profile/plist/六配置摘要保持，Collab/迁移/opening/real Vault/scheduler保持。回滚为本轮runtime.before + 原七应用 `/Users/gavinzhou/orca/hzy-aims-tree-418b235a`（.28），不回退数据。真实1440/390项目集编辑、计数与页面边距验收待协调者安排，不计为部署smoke已验。证据 `.git/aims-tree-edit-*` 与备份目录。

### 2026-10-06 Host滚动标题与临时浮动侧栏切换


6066a78ffbe416b3aa14823fff0a98527545373f 已审查并快进合入、推送GitLab集成分支。七应用同一干净候选 `/Users/gavinzhou/orca/hzy-host-scroll-title-6066a78f`，Runtime `0.3.295-test.aims-tree-edit.29` 原进程与二进制保持，未重启Runtime。

加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/host-scroll-title-20261006T183647Z/runtime-config-profile-pm2.tar.enc` 全流解密摘要PASS；磁盘20GiB门禁通过。十模块prepare、六受保护配置原字节/0600/属主、Codocs Worker重建装配、42动态入口切前连续3轮200（包括布局/共享页头）与HMR关闭通过。重点行为/页头测试10/10通过，复用提交后全量回归证据。切后入口3×200、匿名Codocs401、动态smoke、21业务SFC+布局/共享页头、142/142视图前后、60秒七进程PID稳定/Enterprise+Aims无reload、本机/公网三轮Runtime健康、受信Aims只读探针与PM2 save全部PASS。

Runtime二进制/profile/plist与六配置摘要保持，无DB/schema/grant/Platform写入；Collab/迁移/opening/real Vault/scheduler保持。失败回滚仅恢复旧七应用候选 `/Users/gavinzhou/orca/hzy-aims-tree-edit-a4a4c00d`，不回退业务库或Runtime。真实1440/390滚动/悬停/键盘业务验收待协调者安排，不计为本次已通过。证据 `.git/host-scroll-title-*` 与备份目录。


### 2026-10-06 B5-B finance-receivables 与配套候选切换

B5-B经审查rebase（range-diff补丁不变）并ff合入GitLab集成 `6a23162b318f5c6fae44f475d8a7ee1c95a79618`。Runtime更新至 `0.3.295-test.apf-b5b.30`，七应用统一候选 `/Users/gavinzhou/orca/hzy-b5b-review`。首轮遗漏verify-views，已按原receipt/hash回滚三表并恢复旧栈；第二轮在安装前遇到bootout异步退出间隙，零安装并恢复。补同HEAD全部工具、停机前30项可执行/语法预检与30秒端口关闭等待后，第三轮成功。

新加密配置备份 `.../test-runtime/domain-backups/apf-b5b-20261006T210305Z/`，数据库备份路径见 `.git/b5b-database-backup-result.json`，均解密核验PASS。finance-receivables三表plan/apply/verify通过，reviewHash `739853665b107adef106d34b5939c5b16abc1d1350dbda7e8e3467d20c6f20a5`；Runtime配置仅新增三表映射、generation不变。

十模块prepare、Codocs Worker装配/匿名ServiceAPI401/编辑器200、动态模块、入口3×200、Aims受信GET3×200、142/142视图、60秒PID稳定且无reload、三轮本机/公网健康通过。Collab/迁移/opening/real Vault/grant/scheduler保持；opening139条、金额19989184.22与两批reviewHash不变，未激活历史合同或创建分配/调整。窗口结束并通知协调者/sol2。

Finance新六动作仅获发布和test签发批准，尚待Platform管理员登录后执行，未签prod；未同步前人员授权失败关闭。原Runtime `.29` /七应用6066a78f保留作回退候选；新子集已有数据后不得直接DROP，应保全并另行裁定。证据见 `.git/report-apf-b5b.md` 和受保护备份目录。


### 2026-10-06 B5-B Finance manifest/test策略同步完成

按用户逐项批准与已登录Chrome正式API：Finance固定GitLab `6a23162b` manifest导入HTTP200（manifest60/seq4、release45），版本 `v0.3.4-test.b5b.20261006`，核对16资源/52动作与受审合同后正式发布。仅新增批准六动作及manager+5/admin+3推荐权限，零删除/降权。

仅签C000001/test：bundle48、revision47、`pv_test_20261006215741_0040`、7目标。hzy0正常同步到47，无进程重启。验签Console快照后，Foundation唯一scoped helper确认zhouguangying六动作均allowed=true；未改角色分配/对象范围，Runtime异人确认/撤销等领域门槛保持。未操作激活/分配/调整业务数据。prod8条与非Finance应用10/manifest49/人员权限186逐行技术摘要不变，未签prod，未读取浏览器cookie/token。

Platform加密备份与发布/权限回执见 `.git/report-apf-b5b.md`；Runtime仍`.30`，七应用仍6a23162b候选，Collab/迁移/opening/real Vault/grant/scheduler保持。用户退出Platform并重新登录hzy0后复验，真实1440/390业务验收待协调。


### 2026-10-06 历史财务接续配套切换

- 审查通过并快进合入 GitLab 集成：`5c09618a35a08352ff17aeeb42710a80e58290f0`，未向 GitHub 推送。

Runtime `0.3.295-test.finance-continuation.31`，七应用统一候选 `/Users/gavinzhou/orca/hzy-finance-continuation-5c09618a`。旧 `.30` / `hzy-b5b-review` 保留作回退。加密配置备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-continuation-20261006T224104Z/runtime-config-profile-pm2.tar.enc`，数据库备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/apf-continuation-database-20261006T224105Z`，均解密核验。

停机前全部工具29项、十模块prepare、Codocs Worker装配、动态模块连续3×32 HTTP200；切后入口3×200、匿名Codocs401、动态smoke、60秒PID稳定且无reload、Aims受信GET3×200、142/142视图、本机/公网Runtime三轮健康、PM2 save均通过。

无表安装、配置内容/grant/Platform变更；六受保护配置/profile/plist字节保持。Collab/opening/真实Vault/迁移/scheduler保留，opening139条/19989184.22及两批reviewHash不变。真实业务1440/390验收待协调。完整回执见 `.git/report-finance-historical-continuation.md`。

### 2026-10-06 Directory 停用账号与登录拒绝提示切换

七应用统一干净候选 `/Users/gavinzhou/orca/hzy-directory-inactive-996a2a1b`（`996a2a1b3847b098a04204e718421d7b9fae0663`）。Runtime保持 `0.3.295-test.finance-continuation.31` 原二进制；profile、plist、六项受保护配置哈希不变。原七应用候选 `hzy-finance-continuation-5c09618a` 保留回滚。

加密配置/进程/原二进制备份 `.../test-runtime/domain-backups/directory-inactive-20261007T012027Z/runtime-config-profile-pm2.tar.enc` 解密核验通过。十模块prepare、Codocs Worker重建/装配、入口预热3×200、匿名Service401、动态模块smoke、60秒PID稳定且无reload、142视图及三轮本机/公网健康通过。未写DB/grant/开关，不执行目录状态同步，Collab/opening/Vault/迁移/scheduler保持。

共享Platform另按用户批准切至 `/wiztek/hzy-test/platform-release-996a2a1b/platform`，加密代码/构建/配置/DB备份核验后部署。health/diagnostics/login200，签名key可用；只读prod rev39/test rev47，未签任何包、未改manifest/grant。bundle与主体摘要未变。目录同步预检将新增69主体、改15条状态和8条父级关系，超出仅状态门禁，已停止未执行。停用成员浏览器展示验收待C000001企业管理员登录。完整回执 `.git/report-directory-inactive-login.md`。

### 2026-10-06 hzy0 Console 目录同步精确入口

七应用切换至干净候选 `/Users/gavinzhou/orca/hzy-console-sync-7352e88e`，实际HEAD `877acf1a`（含7352e88e）；Runtime仍`0.3.295-test.finance-continuation.31`原二进制。十模块prepare、Codocs装配、动态模块smoke、入口3×200、60秒PID稳定且无reload、142视图及本机/公网健康通过。profile/plist/六项配置哈希不变，无DB/grant/开关写入，Collab/opening/Vault/迁移/scheduler保持。

新备份 `.../domain-backups/directory-sync-20261007T014341Z/runtime-config-profile-pm2.tar.enc` 解密核验通过；原候选 `hzy-directory-inactive-996a2a1b` 保留回滚。第一次新增回环探针漏Host而失败，已恢复后修正探针并重新备份续行，未触发同步。

正式URL `https://hzy0.isme.dev/console/directory/sync`，按钮「同步到 Platform」。匿名sync-jobs GET401、跨源POST403；保留Console会话、双权限、幂等键及Runtime签名用户委托。等待zhouguangying本人登录点击，之后按预检核对69新增/15状态/8父级与角色表不变；同步尚未执行，未签任何策略包。回执 `.git/report-hzy0-console-directory-sync-entry.md`。

### 2026-10-07 hzy0 Aims 退役 R1 执行者切换（待协调者验收）

- 固定 GitLab 功能分支 SHA：`afe595a9ada9d31332449bf0d9bf665638a0a138`，候选目录 `/Users/gavinzhou/orca/hzy-aims-r1-c47133a5`（干净 detached；目录沿用初始名，HEAD 为上述 SHA）。Runtime `0.3.295-test.aims-retirement-r1.32`，七应用同候选，Aims 进程仍保留，未执行最终退役停进程。
- 加密备份与受保护证据：`~/Library/Application Support/HuizhiYun/test-runtime/domain-backups/aims-r1-20261007T193933Z`。完整 Console dump、binary/config/plist/profile/PM2 已全流解密核验；临时0600 defaults已删除。未打印凭据/令牌。
- 精确11tuple：复用既有notifications及原7008449（v2.28收敛被获批R1物理执行者合同取代）；新增原行13227483–13227491，不新增重复tuple。11项真实签发200/claim逐项通过；7008449 resource原字节保留，data-runtime真实rollover200证明枚举别名可用。生产未修改。
- 单一owner：仅Runtime `enterprise.aimsDeliveryWorker=enterprise.runtime/C000001-test-enterprise` 和profile `scheduler.aimsExecutor=enterprise`；其余配置结构一致，三个调度开关仍false。停写时outbox34 succeeded/0非终态，无需原键补投；未新建fixture或改迁移/opening/Vault/Collab。
- verify-views142/142、完整环境启动探测、Host signed wake200、三能力200/错误generation409、旧aims身份403、无token401/错能力403/错aud401、action-defs回读11、三轮本机公网健康及60秒稳定门禁。due关闭不变，rollover无到期项；有任务回执/死信正反例由隔离MySQL证明，不宣称真实业务投递验收。
- 启动器迭代：c47133a5禁自动依赖重整；f7c4e731补精确执行者profile枚举；afe595a9补Host系统投递本机服务地址。失败窗口均恢复原.31/profile/七应用，最终相关启动器164/164及候选冷启动通过。
- 回滚：先停Gateway及六应用，bootout Runtime，恢复备份runtime.before/runtime-config.before/profile.before，bootstrap原plist，按pm2-before-stage.json原cwd逐个恢复，Gateway最后；三轮健康与稳定确认单一aims.runtime owner。grant撤销仅按精确原行和使用审计处理，不全库覆盖、不删除重复审计；目前已真实签发使用，不按“未使用新增授权”盲目撤回。完整计划见Aims-Process-Retirement-Plan §11.3。

### 2026-10-07 hzy0 S1 收款与结算 UI

S1 无冲突 rebase 到 R1 集成00b7e604，已ff合入GitLab `afb114b35a68b217f16428620c90dddfb2486109`。七应用同一干净候选 `/Users/gavinzhou/orca/hzy-s1-review`；与原R1候选的data-runtime零差异，Runtime `0.3.295-test.aims-retirement-r1.32`原二进制、profile/config哈希不变，enterprise.runtime单owner/11tuple/scheduler.aimsExecutor=enterprise保留，Aims进程仍在。未写DB/grant/schema或真实财务，Collab/迁移/opening/Vault/调度状态不变。

新备份 `.../domain-backups/settlement-s1-20261007T200312Z/runtime-config-profile-pm2.tar.enc` 全流解密hash核验。十模块prepare、Codocs Worker与资产装配、动态模块及编辑器连续3×200、匿名Service API401、正式smoke及60秒七PID稳定/Enterprise无reload通过；Console全表grant授权事实摘要不变（忽略使用时间）。第一次新增公网/health探针误把入口302作200要求，自动恢复原R1；修为正式Runtime健康路径后重备份续行通过。

回归：Enterprise700PASS+1既有skip，Foundation871+27，Finance210，Altoc196，四模块typecheck PASS，lint无新增错误（全量有既有基线错误）。真实1440/390数据只读验收待用户；协调者与sol2通知交还窗口。详细回执 `.git/report-astra-settlement-workspace-s1.md`。

## 2026-10-07 Console 系统公告 hzy0 技术部署

Platform Console `console/v0.2.3` / `e0174ff4` 已由用户正式发布，仅生成 C000001/test rev49；公告默认登录基线view、Console管理员view/admin生效，prod仍rev39不变。hzy0 Console新增四张公告表及一条不推送的使用说明种子；Runtime `0.3.295-test.announcements.39` 与六应用同干净 `/Users/gavinzhou/orca/hzy-wt-announcements-review`，物理Aims仍stopped。未新增grant或修改profile/config/Collab/单owner/scheduler，迁移/opening/Vault保持。

备份 `.../test-runtime/domain-backups/announcements-20261008T003704Z`（加密与全流解密核验）；入口/动态模块/匿名Service401、公网Runtime同SHA、12smoke、60秒六PID稳定PASS。前三次编排探针/资产装配问题均已恢复旧.38后修正，第四窗PASS。详情 `.git/report-announcements-hzy0-review.md`，执行脚本与证据`.git/announcement-*`。

真实管理员发布、范围/已读/铃铛验收待用户；hzy0原notificationsInAppOnly=true保持，企业微信未测试/未启用，不得宣称通过。回滚先停六应用与Runtime，仅撤回本轮四表（若用户已产生公告须另备份，不直接删除），恢复冻结.38二进制、原0dddf801六应用并核健康；不得复活Aims或覆盖其它业务库。


## 2026-10-08 共享通知与员工 QA 热更新

Runtime `0.3.295-test.share503.41`、六应用统一干净候选 `/Users/gavinzhou/orca/hzy-wt-share503`（`ede3303832c6b2a03df704a2ca732e057d4e40f8`）。物理 Aims 保持 stopped。完整合入员工 QA 两提交、presence、自共享禁止和外部缺身份跳过语义。

新加密备份 `/Users/gavinzhou/Library/Application Support/HuizhiYun/test-runtime/domain-backups/share503-20261008T161758Z`：配置与六库全流解密/hash 核验通过。十模块 prepare、Enterprise 动态13路径×3轮、Codocs Worker冷入口3×200/匿名401、142视图、本机与公网健康三轮、60秒六PID稳定通过。切换脚本两次停服前拒绝旧目标参数，未停服务；参数校正后实际窗口一次通过。profile/Runtime配置字节保持，Collab/单owner/legacy关闭、opening/真实Vault/迁移/grant/scheduler均保留，无额外DB/grant/开关写入。

生产已同SHA更新 Runtime `0.3.231` 与六应用；142视图、1040动态资源、三轮入口/公网健康、60秒PID/NRestarts稳定及全部配置hash一致通过。生产加密备份 `/home/hzy/backups/share503-20261008T163135Z` 全流解密核验通过。真实共享与presence双用户验收由协调者安排。旧自共享3行不删除，公告只在hzy0保持现状，生产仍关。回执 `.git/report-prod-share-503-self-20261008.md`。


## 2026-10-08 生产 OIDC 431 热更新

生产六应用同 SHA `17811f3177be1acfc9ab729c788a14ad974568f3`（`oidc431-17811f31`）；Runtime `0.3.231` 原进程/二进制保持，Aims inactive/disabled。hzy0 运行候选 `.41/ede33038` 不变，独立回环 Enterprise 13动态模块×3轮验证通过。

OIDC临时Cookie限制两个并发状态，应用Path、600秒TTL、1024字节返回地址；成功/失败/退出均清理相应临时Cookie。用户批准的独立生产配置：六Node应用64KiB头上限、Gateway `maxHeaderBytes=65536`、aidcp nginx单头32KiB与友好431页（仅该vhost）。原unit通过独立drop-in保留，Gateway保留preserve-symlinks-main；Runtime/config/env字节、Collab/单owner/legacy/迁移/opening/Vault/grant/scheduler保持，公告关闭。

加密备份 `/home/hzy/backups/oidc431-20261008T173821Z` 全流解密hash核验，nginx独立备份定位 `/root/hzy-oidc431-preflight/backup-path`。同SHA六件构建、全部停机前plan-only/工具与空间、1040资源、60秒稳定PASS；正式authorize100/7000/24000字节Cookie均302，公网入口3×200，40000字节友好431。实际OIDC四临时Cookie，应用Path/TTL600，单个最大205字节。用户登录复验待反馈。回执 `.git/report-prod-oidc-cookie431-20261008.md`。


## 2026-10-08 用户生产复测通过

用户确认共享给 test、自共享拒绝、共享列表、presence 与 OIDC 431 登录恢复全部复测通过。本轮生产验收已完成；旧自共享行未清理，生产公告保持关闭。

## 2026-10-08 全局反馈 G0/G1 技术部署

hzy0 Runtime `0.3.295-test.feedback.42` 与六应用同候选 `e148e5e73bb0ea532aeae3155d6f19e779c911dd`（`hzy-wt-feedback-review`），Aims保持stopped。Console新增反馈四表和13条精确grant，连同原Enterprise U行14tuple Verify/双audience真实签发PASS。三轮入口/公网健康、17动态路径×3、142视图及60秒PID稳定PASS。

配置/六库新加密备份全流核验PASS；回滚目标share503/.41。前两轮失败均先恢复旧栈并撤本轮新增项，第三轮正式facade装配空wake200/claimed=false。profile仅启用feedbackDeliveryEnabled，通知仍in-app-only；不登记GitLab、不发送企业微信，R1单owner/Collab/S1/迁移/opening/realVault保留。

Platform test50已同步，prod39/hash不变。员工feedback基线仍0，管理员正式反馈配置及真实登录验收尚待完成；技术部署通过不等于用户验收通过。回执 `.git/report-astra-global-feedback-g0-g1.md`。

## 2026-10-08 反馈列表与铃铛收口

用户已确认G1真实hzy0验收通过（含铃铛）。test策略已升至53，prod39保持；反馈Gateway唯一owner每30秒交替处理issue/notification，原通知详情只读revision gate修复保留。hzy0不登记GitLab，外部通知仍in-app-only，缺集成失败保持可恢复，不宣称企业微信成功。

反馈列表精确移植cde01357，不引入G2图片/附件表或操作。Runtime `0.3.295-test.feedback.43`、六应用同干净候选 `e18db2119b91cb3394b14fb73a9270a010815c81`（`hzy-wt-feedback-list-hotfix`）；Aims仍stopped。原配置/profile字节不变，无DB/grant/开关写入，R1单owner/Collab/S1/迁移/opening/realVault保留。

新加密备份见 `.git/feedback-list-backup.json`，全流解密hash通过；全部工具存在可运行、23GiB空间门禁、逐模块prepare/Worker装配、17动态模块×3、三轮本机公网入口/Runtime身份、匿名Service401、142视图和60秒六PID稳定PASS。Go全量、隔离feedback MySQL、Console641全量+2项BFF专项、Foundation889+27、Enterprise736PASS+1既有skip、三模块typecheck/lint及1440/390合成通过。回执 `.git/report-astra-feedback-list-polish.md`。生产不更新，随公告+反馈批次等待pin3–5。

## 2026-10-09 G2/G3 图片反馈技术窗口

Runtime `0.3.295-test.feedback-media.44` 与六应用同干净候选 `db5bdf7d3164cb1149002115a2dae5803b308e3e`（`hzy-wt-feedback-media`）；Aims 保持 stopped。Console 新增 v2.42 单表 `console_feedback_attachments`（13 列、私有 MEDIUMBLOB）。LaunchAgent 仅追加 Runtime 媒体 enabled/verified_at 两键；profile、Runtime JSON、grant、Collab、R1 单 owner、迁移/opening/real Vault 不变。

首次候选漏 Gateway 受保护配置，入口门禁失败后恢复 .43；补齐原配置字节并加强逐文件停机前检查，重新加密备份后第二窗口通过。23 动态模块×3、142 视图、三轮健康、匿名 Service/私有附件 401、60 秒 PID 稳定 PASS。hzy0 无 GitLab 集成，未创建真实 Issue/发送企业微信；图片 UI、失败保留及 UTC 留存由隔离回归核验，生产登录验收另记。回执 `.git/report-feedback-g2-g3-rollout.md`。
