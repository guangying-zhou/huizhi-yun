# C000001 本机测试 Runtime

2026-09-10 已将原国内测试 Runtime 和全部 5 个测试数据库迁到当前 Mac。测试网页仍在 Cloudflare，入口不变：<https://hzy-test.huizhi.yun/>。

## 当前拓扑

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

测试 Runtime 在本机，**不要**更新或启动 `gitlab.wiztek.cn` 上的 `hzy-test-data-runtime`（已 stop + disable，库为 9-10 旧快照），也不要用 `./update_dr.sh`（会推送生产 `latest`）。步骤：`go test ./...` → 以 `-ldflags` 注入 `internal/version.Version/Commit/BuiltAt` 构建 `GOOS=darwin GOARCH=arm64` → **启动探测**（直接运行新二进制，**必须带齐 LaunchAgent 里的全部环境变量**——当前 6 个：`HZY_DATA_RUNTIME_CONFIG`、`HZY_DATA_RUNTIME_CONFIG_DIR`、`HZY_CONSOLE_VAULT_MASTER_KEY_FILE`、`HZY_FINANCE_AGENT_ENABLED`、`GOMAXPROCS`、`GOMEMLIMIT`；只传 `HZY_DATA_RUNTIME_CONFIG_DIR` 会让进程回落到默认配置（8080、无库）并“正常”启动，等于没验证；日志出现 `listening on 127.0.0.1:18084` 才说明 `server.New(cfg)` 已通过存储与兼容视图校验，随后因端口被占用而退出是预期的，不影响结论）→ 备份运行目录内 `hzy-data-runtime` 为 `hzy-data-runtime.backup-<时间>` → 替换（权限 750）→ `launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-runtime` → 本地与公网 health、匿名 401。依赖新表的版本须先确认本机测试库已执行对应 migration。回滚即把备份文件复制回原名并 kickstart。

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

2026-09-16～17 回填说明：上表标注“回填说明”的 13 行，其版本、commit、构建时间、SHA-256 与备份路径为 2026-09-17 事后从运行目录 `deployments/` 备份链逐个 `--version` 与 `shasum` 实测补录，链路自洽（每个目录的 `hzy-data-runtime.before` 等于上一行的二进制）。这些部署发生在其他会话，**当时的验证记录未转录到本文档**，因此“验证”列不填写未经本文档核实的结论；需要追溯时以对应会话记录为准。回滚所需的备份与哈希已完整可用。

Platform 控制面自 9-10 起持续要求更新到 `0.3.215`（`update-journal.json` 残留 queued 操作），旧版本报 `runtime_update_in_progress`，新版本报 `runtime_update_downgrade_not_allowed`；两者都不会执行更新。需要消除该日志时应调整测试控制面的目标版本，不要改动 journal 或放宽降级保护。

## Gateway 与回退

本次只更新 `hzy-test-gateway` 的 `HZY_TENANT_GATEWAY_REGISTRY_JSON` 中 Runtime endpoint，保留租户、应用、SSO 和内部凭据。源码 `prepare-cloudflare-gateway.mjs` 同步指向本机 Tunnel；不要为了重启而重新运行该准备脚本，它会重新生成其他 Worker 的 secrets 文件。

国内源目录 `/wiztek/hzy-test/backups/local-runtime-20260910/` 保留完整 SQL 快照、表计数和哈希。原数据库未删除；`hzy-test-data-runtime` 已 stop + disable，防止双实例写入。

运行目录的 `gateway-secrets-before-local.json` 保存切换前配置，仅用于受控回退。**切换后已产生新的本机写入，不能直接启动旧库并改回 Gateway**。回退应先暂停测试访问、停止本机 Runtime、备份并同步本机新增数据到服务器，核对一致后恢复服务器 Runtime，再更新 Gateway 路由，最后验证登录与业务。避免丢失本次切换后的产品编辑和同步记录。

Cloudflare Tunnel 的 DNS 与本机运行方式参考：[Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/)。
