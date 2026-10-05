import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('People dashboard error alert', () => {
  test('does not report every data page load failure as schema or adapter unavailable', () => {
    const dashboardPage = source('../app/pages/index.vue')
    const employeesPage = source('../app/pages/employees/index.vue')
    const errorHelper = source('../app/composables/usePeopleApiError.ts')

    assert.match(dashboardPage, /resolvePeopleApiErrorAlert\(error\.value/)
    assert.match(employeesPage, /resolvePeopleApiErrorAlert\(error\.value/)
    assert.match(errorHelper, /Console 权限服务暂不可用/)
    assert.match(errorHelper, /People data-runtime 暂不可用/)
    assert.match(errorHelper, /sanitizeApiErrorMessage/)
    assert.doesNotMatch(dashboardPage, /页面已按 data-runtime 模式接入/)
    assert.doesNotMatch(employeesPage, /请确认 People schema 已执行，data-runtime 已启用 people adapter。/)
  })

  test('People Cloudflare docs require gateway internal token secret', () => {
    const readme = source('../deploy/cloudflare/README.md')
    const envExample = source('../.env.cloudflare.example')

    assert.match(readme, /HZY_CLOUDFLARE_INTERNAL_TOKEN/)
    assert.match(readme, /Gateway-injected/)
    assert.match(readme, /People tenant-runtime is\s+required for \/api\/v1 data access/)
    assert.match(envExample, /HZY_CLOUDFLARE_INTERNAL_TOKEN/)
  })
})
