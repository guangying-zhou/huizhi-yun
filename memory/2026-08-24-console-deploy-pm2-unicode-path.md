# DEBUG REPORT — Console 部署前 PM2 中文路径失败

- 日期：2026-08-24
- 现象：Console 部署前测试加载 `ecosystem.config.cjs` 时，将中文工作区路径转换为 `%E4...`，随后 `require()` 报 `MODULE_NOT_FOUND`。
- 状态：DONE

## Root cause

`console/test/pm2EnvParsing.test.ts` 使用 `new URL(...).pathname` 作为 CommonJS `require()` 的文件参数。URL pathname 会保留中文字符的百分号编码，而 `require()` 接收的是本地文件系统路径，不会替调用方解码，因此查找了不存在的 `%E4...` 目录。PM2 配置文件及实际中文路径都存在，失败发生在部署 preflight 测试的 URL→路径边界。

## Fix

- 使用 Node 标准 `fileURLToPath()` 将 `import.meta.url` 派生的文件 URL 转为原生文件路径。
- 保留原测试对 PM2 env JSON、换行和普通值解析的覆盖。

## Evidence

- 修复前：`ecosystemFile.pathname` 对应路径不存在，`fileURLToPath(ecosystemFile)` 对应路径存在；聚焦测试稳定复现 `MODULE_NOT_FOUND`。
- 修复后：Node `24.18.0` 下 Console 全量测试 404/404。
- Node `24.18.0` 下 `pnpm preflight:cloudflare` 完整通过：lint、typecheck、404 项测试全部通过。
- `git diff --check` 通过。

## Regression test

`console/test/pm2EnvParsing.test.ts` 本身即为回归用例；当前工作区名称包含中文，可直接覆盖原故障路径。

## Related

该问题此前在审批 403 修复验证中已被记录为环境例外；本次确认它会阻塞真实部署，因此已在同一分支修复，不再排除该用例。
