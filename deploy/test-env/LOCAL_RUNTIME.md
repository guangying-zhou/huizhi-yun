# C000001 本机测试 Runtime

2026-09-10 已将原国内测试 Runtime 和全部 5 个测试数据库迁到当前 Mac。测试网页仍在 Cloudflare，入口不变：<https://hzy-test.huizhi.yun/>。

## 当前拓扑

浏览器 → CF 测试 Gateway / Console / AIMS / Assets / Finance → `https://hzy-test-runtime.isme.dev` → 独立 Cloudflare Tunnel → `127.0.0.1:18084` → 本机 MySQL `127.0.0.1:3306`。

- Runtime：`0.3.219-test.product-line-label.1`（`bd15fff9-dirty`，含产品线名称读取修复），Darwin arm64 原生构建。更新记录见下文“版本更新”。
- 租户：`C000001`，Runtime 身份：`c000001-test-tenant-runtime`。Console 及应用 deployment/client 绑定、JWT 信任、登录状态、签名密钥和 Vault 密钥保持迁移前身份。
- Tunnel：`hzy-test-local-runtime` / `71750282-1608-4903-8bb8-349072e955ab`。沿用已有账户授权的 isme.dev DNS，独立连接，不调整其他 Tunnel。
- Runtime 仅监听本机回环地址，Tunnel 以 HTTPS 对外提供同样的 JWT 保护接口；匿名和伪造 Bearer 请求均实测返回 401。
- SSO 和平台控制面仍位于原服务器，因此首次登录、策略冷加载仍可能涉及国内链路。迁移没有改变生产环境。
- 本机须开机、联网且不休眠。两个 LaunchAgent 在当前用户登录后启动、异常后自动重启；没有修改系统电源设置。

## 数据与验证

以下表数为 9-10 迁移时快照；后续增量迁移见版本更新及测试部署记录。

| 原服务器数据库 | 本机数据库 | 表数 |
| --- | --- | ---: |
| hzy_console_test_20260905 | hzy_console_test_local_20260910 | 68 |
| hzy_people_test_20260905 | hzy_people_test_local_20260910 | 22 |
| hzy_aims_test_product_20260909 | hzy_aims_test_local_20260910 | 108 |
| hzy_assets_test_product_20260909 | hzy_assets_test_local_20260910 | 34 |
| hzy_finance_test_product_20260909 | hzy_finance_test_local_20260910 | 39 |

导出前暂停国内测试 Runtime；逐库校验压缩 SQL 的 SHA256，导入新数据库，271 张表逐表比对记录数全部一致。未覆盖本机原有数据库。专用 MySQL 用户 `hzy_test_local_runtime` 仅获上述 5 个库的权限，应用未使用 root。

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

测试 Runtime 在本机，**不要**更新或启动 `gitlab.wiztek.cn` 上的 `hzy-test-data-runtime`（已 stop + disable，库为 9-10 旧快照），也不要用 `./update_dr.sh`（会推送生产 `latest`）。步骤：`go test ./...` → 以 `-ldflags` 注入 `internal/version.Version/Commit/BuiltAt` 构建 `GOOS=darwin GOARCH=arm64` → 备份运行目录内 `hzy-data-runtime` 为 `hzy-data-runtime.backup-<时间>` → 替换（权限 750）→ `launchctl kickstart -k gui/$(id -u)/cn.wiztek.hzy-test-runtime` → 本地与公网 health、匿名 401。依赖新表的版本须先确认本机测试库已执行对应 migration。回滚即把备份文件复制回原名并 kickstart。

| 日期 | 版本 | SHA-256（darwin/arm64） | 备份 | 验证 |
| --- | --- | --- | --- | --- |
| 2026-09-11 | `0.3.219-test.product-line.1`（`bd15fff9-dirty`） | `e8a5cca4a8644fdde99583c9e207bc8f8bc0b2a7372b6c4a77580320e88d60e1` | `hzy-data-runtime.backup-20260911152009`（原 `0.3.215-test.local-runtime.2`） | 全部 Go 测试通过；本机 AIMS 库已有 v5.37 `product_line_workspaces` / `product_component_sources`；本地及公网 health ok、匿名/伪造 Bearer 401；重启后 Gateway service-token 签发 200 |
| 2026-09-12 | `0.3.219-test.lightweight-plan.1`（`bd15fff9-dirty`） | `394622ce30e0d05a5986e09fbabfdac3c77e8bbbc1853fff851c30ea1fd18776` | `deployments/lightweight-plan-1789246041797/hzy-data-runtime.before`（原 product-line.4） | 全量 Go 22 包通过；测试 Aims 库 v5.38 迁移后原数据计数保持；本地／公网 health 新版本正常，匿名／伪造 Bearer 401 |
| 2026-09-13 | `0.3.219-test.product-line-label.1`（`bd15fff9-dirty`） | `69a948c2bfcd2b59187d822c98ca30734ec5225e16cfde03dc9f23eff63e2d31` | `deployments/product-line-label-20260913T125218Z/hzy-data-runtime.before`（原 lightweight-plan.1） | 全量 Go 22 包通过；本地／公网 health、匿名／伪造 Bearer 401；目录已通过登录态入口同步 53 个产品，名称／下拉筛选／统一标题复验通过 |

Platform 控制面自 9-10 起持续要求更新到 `0.3.215`（`update-journal.json` 残留 queued 操作），旧版本报 `runtime_update_in_progress`，新版本报 `runtime_update_downgrade_not_allowed`；两者都不会执行更新。需要消除该日志时应调整测试控制面的目标版本，不要改动 journal 或放宽降级保护。

## Gateway 与回退

本次只更新 `hzy-test-gateway` 的 `HZY_TENANT_GATEWAY_REGISTRY_JSON` 中 Runtime endpoint，保留租户、应用、SSO 和内部凭据。源码 `prepare-cloudflare-gateway.mjs` 同步指向本机 Tunnel；不要为了重启而重新运行该准备脚本，它会重新生成其他 Worker 的 secrets 文件。

国内源目录 `/wiztek/hzy-test/backups/local-runtime-20260910/` 保留完整 SQL 快照、表计数和哈希。原数据库未删除；`hzy-test-data-runtime` 已 stop + disable，防止双实例写入。

运行目录的 `gateway-secrets-before-local.json` 保存切换前配置，仅用于受控回退。**切换后已产生新的本机写入，不能直接启动旧库并改回 Gateway**。回退应先暂停测试访问、停止本机 Runtime、备份并同步本机新增数据到服务器，核对一致后恢复服务器 Runtime，再更新 Gateway 路由，最后验证登录与业务。避免丢失本次切换后的产品编辑和同步记录。

Cloudflare Tunnel 的 DNS 与本机运行方式参考：[Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/advanced/local-management/create-local-tunnel/)。
