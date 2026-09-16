import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function assertRecordHomePrecedesDeploymentFallback(source: string, recordExpression: string, deploymentExpression: string) {
  const recordIndex = source.indexOf(recordExpression)
  const deploymentIndex = source.indexOf(deploymentExpression, recordIndex)
  assert.ok(recordIndex >= 0, `missing record home expression: ${recordExpression}`)
  assert.ok(deploymentIndex > recordIndex, `deployment fallback must follow record home: ${deploymentExpression}`)
}

test('Console and Foundation preserve Platform-resolved per-application home URLs', () => {
  const consoleApplications = readFileSync(new URL('../server/utils/userApplications.ts', import.meta.url), 'utf8')
  assertRecordHomePrecedesDeploymentFallback(
    consoleApplications,
    'nullableString(recordHomeUrl)',
    'buildAppHomeUrl(bundleDeploymentPublicUrl, basePath)'
  )

  const consoleRuntime = readFileSync(new URL('../server/api/v1/console/runtime/apps/[appCode]/config.get.ts', import.meta.url), 'utf8')
  assertRecordHomePrecedesDeploymentFallback(
    consoleRuntime,
    'nullableString(recordHomeUrl)',
    'buildHomeUrl(bundleDeploymentPublicUrl, basePath)'
  )

  const foundationApplications = readFileSync(new URL('../../foundation/server/api/user/applications.get.ts', import.meta.url), 'utf8')
  assertRecordHomePrecedesDeploymentFallback(
    foundationApplications,
    'nullableString(record.homeUrl)',
    'buildAppHomeUrl(deploymentPublicUrl, basePath)'
  )
})
