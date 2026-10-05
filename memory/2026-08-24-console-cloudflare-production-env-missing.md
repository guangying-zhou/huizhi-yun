# DEBUG REPORT — Console Cloudflare 生产配置缺失

- 日期：2026-08-24
- 现象：Console 测试完成后，`render-cloudflare-config.mjs` 拒绝生成配置，提示必须设置 `HZY_CONSOLE_ROUTE_PATTERN=console.huizhi.yun`、`HZY_CONSOLE_ZONE_NAME=huizhi.yun`、`HZY_CONSOLE_WORKERS_DEV=false`。
- 状态：DONE

## Root cause

部署工作区没有 `console/.env.cloudflare` 或 `.env.cloudflare.local`。生成脚本只读取这两个生产部署文件；缺失时 route/zone 为空、`workers_dev` 回退为 true，生产隔离门禁按设计失败。仓库样例本身已包含正确固定值，属于部署主机配置缺失，不是应用代码回归。

## Fix

- 从 `console/.env.cloudflare.example` 生成本机、被 `.gitignore` 排除的 `console/.env.cloudflare`。
- 固定生产路由、zone 和 `workers_dev=false`，以及其他仓库要求的 managed-cloud 安全参数。
- 通过已登录 Wrangler 只读取现网 `hzy-console-prod` 当前版本的三个 plain-text 公开信任材料：Platform signing kid/public key 与 Connector Runtime release public key；没有读取或写入 Worker secret。
- 将已经 dotenv-escaped 的 Platform PEM 保持为单层 `\n` 转义，避免双重转义导致 PEM 解析失败。

## Evidence

- Node `24.18.0` 下严格生产配置校验通过。
- `cloudflare:config` 成功生成 `.wrangler.generated.jsonc`。
- `verify:cloudflare-deploy` 完整通过：lint、typecheck、Console 404/404 测试、Cloudflare 构建、Wrangler dry-run 均成功。
- dry-run 确认目标为 `https://console.huizhi.yun`、managed-cloud prod、memory cache、`workers_dev=false`，并未发布线上版本。

## Regression test

仓库的 `scripts/validate-console-cloudflare-config.mjs --strict-env` 与 `console/scripts/render-cloudflare-config.mjs` 共同锁定生产路由、运行模式、公钥格式和禁止变量；本次未放宽任何门禁。

## Related

`console/.env.cloudflare` 按设计不得提交。若换部署主机或干净检出目录，必须从样例建立该主机的生产配置并填入当前公开信任材料。
