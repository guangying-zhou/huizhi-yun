import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// data-runtime 的员工相关路由用 requireEmployeeGlobalAccess 校验数据范围，
// 依据 query 里的 current_user_employee_access。走 /api/v1/** 代理的请求由
// tenant-runtime 中间件注入；直接调用 maybeCallTenantRuntime 的
// /api/admin/** 端点必须自己携带，否则运行时一律 403。
//
// 这条守卫防止新增 admin 端点时再次漏带——该错误只在部署后手工调用时才暴露。
test('admin endpoints calling the runtime must carry the employee data scope', () => {
  const roots = [
    'server/api/admin/onboarding-cases/[code]',
    'server/api/admin/subject-merge'
  ]
  const checked: string[] = []

  for (const root of roots) {
    for (const name of readdirSync(new URL(`../${root}`, import.meta.url))) {
      if (!name.endsWith('.ts')) continue
      const path = `${root}/${name}`
      const content = source(path)
      if (!content.includes('maybeCallTenantRuntime')) continue
      checked.push(path)

      assert.match(
        content,
        /requirePeopleGlobalEmployeeScope/,
        `${path} 调用了 tenant-runtime，必须先解析全局员工数据范围`
      )
      // 每一处 runtime query 都要带上作用域，漏一处就是一个 403。
      const queries = content.match(/query: \{[^}]*\}/g) || []
      for (const query of queries) {
        assert.ok(
          query.includes('...scopeQuery'),
          `${path} 有一处 runtime query 没有带 scopeQuery：${query}`
        )
      }
    }
  }

  assert.ok(checked.length >= 5, `应至少覆盖 5 个 admin 端点，实际 ${checked.length}`)
})

// 跨应用绑定必须从 service token claims 与受信转发头推导，不能读 process.env：
// 托管云 Worker 上 HZY_CONSOLE_TARGET_DEPLOYMENT 往往未设，读 env 会 503。
test('console command binding comes from token claims, not process env', () => {
  const helper = source('server/utils/onboardingProvisioning.ts')

  assert.match(helper, /function resolveConsoleCommandBinding/)
  assert.match(helper, /claims\.tenant \|\| claims\.tenant_code/)
  assert.match(helper, /claims\.deployment \|\| claims\.deployment_code/)
  // 受信 route helper 必须带目标应用，否则不会改写 x-hzy-deployment，
  // 目标侧的精确绑定校验会拒绝。
  assert.match(helper, /trustedServiceRequestHeaders\(event, 'console'\)/)
  assert.doesNotMatch(helper, /trustedServiceRequestHeaders\(event\)(?!,)/)
  assert.doesNotMatch(helper, /process\.env\.HZY_CONSOLE_TARGET_DEPLOYMENT/)
  assert.match(helper, /function deterministicOnboardingOperationId/)
  assert.match(helper, /-4\$\{hex\.slice\(13, 16\)\}-8\$\{hex\.slice\(17, 20\)\}/)
  assert.doesNotMatch(helper, /const operationId = await sha256Hex/)

  // 每一次跨应用调用都要先解析绑定。
  const requests = helper.match(/async request\(token\) \{/g) || []
  const bindings = helper.match(/const binding = resolveConsoleCommandBinding\(event, token\)/g) || []
  assert.equal(
    bindings.length,
    requests.length,
    `每个 request(token) 都必须解析绑定：${requests.length} 处调用，${bindings.length} 处解析`
  )

  // BFF 端点不得再从 env 拼租户或部署上下文。
  for (const path of [
    'server/api/admin/subject-merge/preview.get.ts',
    'server/api/admin/subject-merge/index.post.ts',
    'server/api/admin/onboarding-cases/[code]/provision.post.ts',
    'server/api/admin/onboarding-cases/[code]/activate.post.ts',
    'server/api/admin/onboarding-cases/[code]/refresh-status.post.ts'
  ]) {
    assert.doesNotMatch(
      source(path),
      /process\.env\.HZY_(TENANT_CODE|DEPLOYMENT_CODE|CONSOLE_TARGET_DEPLOYMENT)/,
      `${path} 不得从 env 推导跨应用上下文`
    )
  }
})
