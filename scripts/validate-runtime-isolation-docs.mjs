#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

function read(path) {
  if (!existsSync(path)) {
    throw new Error(`required file is missing: ${path}`)
  }
  return readFileSync(path, 'utf8')
}

function requireIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} must include ${JSON.stringify(needle)}`)
  }
}

function forbidIncludes(content, needle, label) {
  if (content.includes(needle)) {
    throw new Error(`${label} must not include stale text ${JSON.stringify(needle)}`)
  }
}

function requirePackageScript(packageJson, name) {
  if (!packageJson.scripts?.[name]) {
    throw new Error(`package.json must define script ${name}`)
  }
}

function main() {
  const rootPackage = JSON.parse(read('package.json'))
  const platformPackage = JSON.parse(read('platform/package.json'))
  const consoleLocalExample = read('console/.env.example')
  const consoleDevExample = read('console/.env.dev.example')
  const consoleReadme = read('console/README.md')
  const consoleClaude = read('console/CLAUDE.md')
  const platformReadme = read('platform/README.md')
  const platformInitDevScript = read('platform/deploy/mysql/init-hzy-platform-dev.sh')
  const plan = read('docs/Platform-Console-Prod-Dev-Isolation-Plan.md')
  const acceptScript = read('scripts/accept-runtime-isolation.mjs')
  const keyFixtureScript = read('scripts/validate-runtime-isolation-key-fixture.mjs')

  requirePackageScript(rootPackage, 'validate:runtime-isolation-docs')
  requirePackageScript(rootPackage, 'accept:runtime-isolation')
  requirePackageScript(rootPackage, 'smoke:console-dev-runtime-disabled')
  requirePackageScript(rootPackage, 'validate:console-runtime-cache-guardrails')
  requirePackageScript(rootPackage, 'validate:runtime-probe-guardrails')
  requirePackageScript(rootPackage, 'validate:public-routing-plan')
  requirePackageScript(rootPackage, 'probe:server-upstreams')
  requirePackageScript(platformPackage, 'db:init-dev:wiztek')
  requireIncludes(platformInitDevScript, 'TARGET_DB="${PLATFORM_DEV_DB_NAME:-hzy_platform_dev}"', 'platform init dev DB script')
  requireIncludes(platformInitDevScript, 'SOURCE_DEPLOYMENT_CODE="${PLATFORM_DEV_SOURCE_DEPLOYMENT_CODE:-C000001-console}"', 'platform init dev DB script')
  requireIncludes(platformInitDevScript, 'pnpm --dir "${PLATFORM_DIR}" run db:init-dev', 'platform init dev DB script')
  requireIncludes(platformInitDevScript, 'pnpm --dir "${PLATFORM_DIR}" run db:verify-dev', 'platform init dev DB script')

  requireIncludes(consoleReadme, '默认端口 `3000`', 'console/README.md')
  forbidIncludes(consoleReadme, '默认端口 `3008`', 'console/README.md')
  requireIncludes(consoleReadme, '共享集成环境统一叫 `console-test`', 'console/README.md')
  requireIncludes(consoleReadme, '开发人员本地实例统一叫 `console-dev`', 'console/README.md')
  requireIncludes(consoleReadme, 'pnpm run smoke:console-dev-runtime-disabled', 'console/README.md')
  requireIncludes(consoleReadme, '多个开发人员可以各自运行 `console-dev`', 'console/README.md')
  requireIncludes(consoleReadme, 'Console prod on Cloudflare 时改用 `--console-test-only-conf`', 'console/README.md')
  requireIncludes(consoleReadme, '拒绝遗留的本机 `hzy-console-prod` 或指向 `huizhi-console` 的 prod PM2 进程', 'console/README.md')
  requireIncludes(consoleReadme, 'pnpm run validate:public-routing-plan', 'console/README.md')
  requireIncludes(consoleReadme, '可打印 DNS / Nginx 切换计划', 'console/README.md')
  requireIncludes(consoleReadme, 'PM2 / 监听端口 upstream 检查', 'console/README.md')
  requireIncludes(consoleReadme, '证书 SAN 检查命令', 'console/README.md')
  requireIncludes(consoleReadme, '本地 TLS / HTTP fixture 回归证书 SAN 错误和 502 upstream 错误提示', 'console/README.md')
  requireIncludes(consoleReadme, 'ERR_TLS_CERT_ALTNAME_INVALID', 'console/README.md')
  requireIncludes(consoleReadme, 'Nginx upstream', 'console/README.md')
  requireIncludes(consoleReadme, '下一步 `probe:server-upstreams` 命令', 'console/README.md')
  requireIncludes(consoleReadme, 'pnpm run probe:server-upstreams`', 'console/README.md')
  requireIncludes(consoleReadme, '追加 `--console-prod-cloudflare`，跳过不存在的本机 `hzy-console-prod`', 'console/README.md')
  requireIncludes(consoleReadme, '脚本会打印服务器实际 Nginx 配置校验', 'console/README.md')
  requireIncludes(consoleReadme, '拒绝 prod/test scoped cache rows 复用同一个 bundle hash', 'console/README.md')
  requireIncludes(consoleReadme, 'pnpm run validate:console-runtime-cache-guardrails', 'console/README.md')
  requireIncludes(consoleReadme, '覆盖 `console-dev` runtime-disabled probe', 'console/README.md')

  requireIncludes(consoleLocalExample, 'SSO_OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/api/auth/oidc-post-logout', 'console/.env.example')
  forbidIncludes(consoleLocalExample, 'localhost:3080', 'console/.env.example')
  requireIncludes(consoleDevExample, 'SSO_OIDC_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/api/auth/oidc-post-logout', 'console/.env.dev.example')
  forbidIncludes(consoleDevExample, 'localhost:3080', 'console/.env.dev.example')

  requireIncludes(consoleClaude, '稳定共享集成环境使用 `console-test`', 'console/CLAUDE.md')
  requireIncludes(consoleClaude, '开发人员本地实例使用 `console-dev`', 'console/CLAUDE.md')
  requireIncludes(consoleClaude, '默认开发端口为 `3000`', 'console/CLAUDE.md')
  forbidIncludes(consoleClaude, '默认开发端口为 `3008`', 'console/CLAUDE.md')

  requireIncludes(platformReadme, '--nginx-platform-conf', 'platform/README.md')
  requireIncludes(platformReadme, '--nginx-console-test-only-conf', 'platform/README.md')
  requireIncludes(platformReadme, 'pnpm run smoke:console-dev-runtime-disabled', 'platform/README.md')
  requireIncludes(platformReadme, '实际 HTTP 200 且 Platform runtime 副作用关闭', 'platform/README.md')
  requireIncludes(platformReadme, 'tenant-admin 与 ops 两个 Policy Bundle 生成入口都会显式传递当前 environment', 'platform/README.md')
  requireIncludes(platformReadme, '拒绝 tracked `*.example` env 文件', 'platform/README.md')
  requireIncludes(platformReadme, '`--strict` 会要求显式传入真实 env 文件', 'platform/README.md')
  requireIncludes(platformReadme, '`--strict` 与 `--static-only` 互斥', 'platform/README.md')
  requireIncludes(platformReadme, 'live PM2 校验会拒绝遗留的本机 `hzy-console-prod` 或指向 `huizhi-console` 的 prod PM2 进程', 'platform/README.md')
  requireIncludes(platformReadme, '覆盖 `console-dev` runtime-disabled probe', 'platform/README.md')
  requireIncludes(platformReadme, 'pnpm --dir platform run db:init-dev:wiztek', 'platform/README.md')
  requireIncludes(platformReadme, '默认从 `hzy_platform` 创建 / 迁移到 `hzy_platform_dev`', 'platform/README.md')
  requireIncludes(platformReadme, '生产 `C000001-console` deployment', 'platform/README.md')
  requireIncludes(platformReadme, 'pnpm run validate:public-routing-plan', 'platform/README.md')
  requireIncludes(platformReadme, '可打印 DNS / Nginx 切换计划', 'platform/README.md')
  requireIncludes(platformReadme, 'PM2 / 监听端口 upstream 检查', 'platform/README.md')
  requireIncludes(platformReadme, '证书 SAN 检查命令', 'platform/README.md')
  requireIncludes(platformReadme, '本地 TLS / HTTP fixture 回归证书 SAN 错误和 502 upstream 错误提示', 'platform/README.md')
  requireIncludes(platformReadme, 'ERR_TLS_CERT_ALTNAME_INVALID', 'platform/README.md')
  requireIncludes(platformReadme, 'Nginx upstream', 'platform/README.md')
  requireIncludes(platformReadme, '下一步 `probe:server-upstreams` 命令', 'platform/README.md')
  requireIncludes(platformReadme, 'pnpm run probe:server-upstreams`', 'platform/README.md')
  requireIncludes(platformReadme, '追加 `--console-prod-cloudflare`，跳过不存在的本机 `hzy-console-prod`', 'platform/README.md')
  requireIncludes(platformReadme, '脚本会打印服务器实际 Nginx 配置校验', 'platform/README.md')

  requireIncludes(plan, '原方案里用于共享集成环境的 `console-dev` 统一改名为 `console-test`', 'isolation plan')
  requireIncludes(plan, '`local-dev` 不再作为正式实例名', 'isolation plan')
  requireIncludes(plan, '| `local-dev` | `console-dev` | 开发人员电脑上的本地 Console 实例 |', 'isolation plan')
  requireIncludes(plan, '多人各自运行 `console-dev` 是可行的', 'isolation plan')
  requireIncludes(plan, '`console-test` 作为唯一共享端到端测试 runtime', 'isolation plan')
  requireIncludes(plan, 'pnpm --dir platform run db:init-dev:wiztek', 'isolation plan')
  requireIncludes(plan, '创建 / 重建 `hzy_platform_dev`', 'isolation plan')
  requireIncludes(plan, '生产库当前的 `C000001-console`', 'isolation plan')
  requireIncludes(plan, 'pnpm run smoke:console-dev-runtime-disabled', 'isolation plan')
  requireIncludes(plan, 'tenant-admin 与 ops 两个 Policy Bundle 生成入口都会显式传递当前 environment', 'isolation plan')
  requireIncludes(plan, '拒绝 tracked `*.example` env 文件', 'isolation plan')
  requireIncludes(plan, '`--strict` 与 `--static-only` 互斥', 'isolation plan')
  requireIncludes(plan, '--platform-prod-env platform/.env.prod', 'isolation plan')
  requireIncludes(plan, '--console-dev-env console/.env.dev', 'isolation plan')
  forbidIncludes(plan, '--platform-prod platform/.env.prod', 'isolation plan')
  forbidIncludes(plan, '--platform-dev platform/.env.dev', 'isolation plan')
  forbidIncludes(plan, '--console-prod console/.env.prod', 'isolation plan')
  forbidIncludes(plan, '--console-test console/.env.test', 'isolation plan')
  forbidIncludes(plan, '--console-dev console/.env.dev', 'isolation plan')
  requireIncludes(plan, 'Console prod on Cloudflare', 'isolation plan')
  requireIncludes(plan, 'pnpm run validate:runtime-isolation-docs', 'isolation plan')
  requireIncludes(plan, 'pnpm run validate:runtime-probe-guardrails', 'isolation plan')
  requireIncludes(plan, 'pnpm run validate:public-routing-plan', 'isolation plan')
  requireIncludes(plan, 'probe 会直接输出需要补的 A 记录', 'isolation plan')
  requireIncludes(plan, '回归 `plan:public-routing` 输出的 DNS / Nginx 切换计划', 'isolation plan')
  requireIncludes(plan, 'PM2 / 监听端口 upstream 检查', 'isolation plan')
  requireIncludes(plan, 'pnpm run probe:server-upstreams', 'isolation plan')
  requireIncludes(plan, '追加 `--console-prod-cloudflare`，跳过不存在的本机 `hzy-console-prod`', 'isolation plan')
  requireIncludes(plan, '脚本会继续打印服务器实际 Nginx 配置校验', 'isolation plan')
  requireIncludes(plan, '根目录提供 `pnpm run probe:server-upstreams`', 'isolation plan')
  requireIncludes(plan, 'server upstream loopback probe', 'isolation plan')
  requireIncludes(plan, '证书 SAN 检查命令', 'isolation plan')
  requireIncludes(plan, '本地 TLS / HTTP fixture 回归证书 SAN 错误和 502 upstream 错误提示', 'isolation plan')
  requireIncludes(plan, 'ERR_TLS_CERT_ALTNAME_INVALID', 'isolation plan')
  requireIncludes(plan, 'Nginx upstream', 'isolation plan')
  requireIncludes(plan, '下一步 `probe:server-upstreams` 命令', 'isolation plan')
  requireIncludes(plan, '拒绝遗留的本机 `hzy-console-prod` 或指向 `huizhi-console` 的 prod PM2 进程', 'isolation plan')
  requireIncludes(plan, 'prod/test cache rows 不复用同一个 bundle hash', 'isolation plan')
  requireIncludes(plan, 'pnpm run validate:console-runtime-cache-guardrails', 'isolation plan')
  requireIncludes(plan, '覆盖 `console-dev` runtime-disabled probe', 'isolation plan')

  requireIncludes(acceptScript, 'scripts/validate-runtime-isolation-docs.mjs', 'accept-runtime-isolation.mjs')
  requireIncludes(acceptScript, 'scripts/validate-console-runtime-cache-guardrails.mjs', 'accept-runtime-isolation.mjs')
  requireIncludes(acceptScript, 'scripts/validate-runtime-probe-guardrails.mjs', 'accept-runtime-isolation.mjs')
  requireIncludes(acceptScript, 'scripts/validate-public-routing-plan.mjs', 'accept-runtime-isolation.mjs')
  requireIncludes(acceptScript, 'scripts/probe-server-upstreams.mjs', 'accept-runtime-isolation.mjs')
  const validateRuntimeIsolationScript = read('scripts/validate-runtime-isolation.mjs')
  requireIncludes(validateRuntimeIsolationScript, '--platform-prod-env platform/.env.prod', 'validate-runtime-isolation.mjs')
  requireIncludes(validateRuntimeIsolationScript, "'platform-prod-env': 'platformProd'", 'validate-runtime-isolation.mjs')
  forbidIncludes(validateRuntimeIsolationScript, '--platform-prod platform/.env.prod', 'validate-runtime-isolation.mjs')
  forbidIncludes(validateRuntimeIsolationScript, '--console-dev console/.env.dev', 'validate-runtime-isolation.mjs')

  requireIncludes(keyFixtureScript, "'--console-test-env'", 'validate-runtime-isolation-key-fixture.mjs')
  requireIncludes(keyFixtureScript, "'--console-dev-env'", 'validate-runtime-isolation-key-fixture.mjs')
  forbidIncludes(keyFixtureScript, "'--console-test'", 'validate-runtime-isolation-key-fixture.mjs')
  forbidIncludes(keyFixtureScript, "'--console-dev'", 'validate-runtime-isolation-key-fixture.mjs')

  console.info('[runtime-isolation-docs] passed')
}

try {
  main()
} catch (error) {
  console.error(`[runtime-isolation-docs] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
