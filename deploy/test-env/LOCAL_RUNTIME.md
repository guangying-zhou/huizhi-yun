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

