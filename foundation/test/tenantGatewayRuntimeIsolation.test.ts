import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { H3Event } from 'h3'
import { resolveTrustedTenantGatewayContext } from '../server/utils/tenantGatewayTrust.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

function event(headers: Record<string, string>) {
  return {
    node: { req: { headers } },
    context: {}
  } as unknown as H3Event
}

describe('trusted tenant gateway runtime isolation', () => {
  test('accepts tenant context only with the configured gateway token', () => {
    const headers = {
      'x-hzy-gateway': 'tenant-gateway',
      'x-hzy-gateway-token': 'trusted-token',
      'x-hzy-tenant': 'tenant-a',
      'x-hzy-deployment': 'deployment-a',
      'x-hzy-environment': 'prod',
      'x-hzy-app-code': 'aims',
      'x-forwarded-host': 'tenant-a.huizhi.yun'
    }
    const config = { security: { cloudflareInternalToken: 'trusted-token' } }
    assert.deepEqual(resolveTrustedTenantGatewayContext(event(headers), config), {
      tenant: 'tenant-a',
      deployment: 'deployment-a',
      environment: 'prod',
      appCode: 'aims',
      forwardedHost: 'tenant-a.huizhi.yun'
    })
    assert.equal(resolveTrustedTenantGatewayContext(event({ ...headers, 'x-hzy-gateway-token': 'wrong' }), config), null)
  })

  test('service and Console caches bind trusted tenant, deployment, environment and app', () => {
    const serviceOidc = readFileSync(`${root}/server/utils/serviceOidc.ts`, 'utf8')
    const consoleRuntime = readFileSync(`${root}/server/utils/consoleRuntime.ts`, 'utf8')
    for (const field of ['tenant', 'deployment', 'environment', 'appCode']) {
      assert.match(serviceOidc, new RegExp(`gatewayContext\\?\\.${field}`))
      assert.match(consoleRuntime, new RegExp(`context\\?\\.${field}`))
    }
    assert.match(serviceOidc, /resolveTrustedTenantGatewayContext/)
    assert.match(consoleRuntime, /resolveTrustedTenantGatewayContext/)
    assert.doesNotMatch(consoleRuntime, /for \(const entry of runtimeCache\.values\(\)\)/)
  })

  test('managed Workflow proxy uses the tenant-neutral service origin', () => {
    const serviceAppUrl = readFileSync(`${root}/server/utils/serviceAppUrl.ts`, 'utf8')
    const workflowRuntime = readFileSync(`${root}/server/utils/workflowRuntime.ts`, 'utf8')
    assert.match(serviceAppUrl, /trustedTenantGatewayServiceBaseUrl/)
    assert.match(serviceAppUrl, /context\.forwardedHost/)
    assert.match(serviceAppUrl, /if \(isManagedCloudRuntime\(event, config\)\)/)
    assert.match(workflowRuntime, /resolveTenantGatewayServiceAppBaseUrl\(event, 'workflow'\)/)
    assert.match(workflowRuntime, /resolveServiceAppBaseUrl\(event, 'workflow', \{ directTarget: true \}\)/)
    assert.doesNotMatch(workflowRuntime, /resolveServiceAppBaseUrl\(null, 'workflow'\)/)
    assert.ok(workflowRuntime.indexOf('resolveServiceAppBaseUrl(event, \'workflow\', { directTarget: true })') < workflowRuntime.indexOf('\'hzy.workflowApiUrl\''))

    const workflowProxy = readFileSync(`${root}/server/api/workflow-proxy/[...path].ts`, 'utf8')
    assert.doesNotMatch(workflowProxy, /OPTIONAL_TASK_LIST_PATHS/)
    assert.doesNotMatch(workflowProxy, /emptyTaskList/)
    assert.match(workflowProxy, /trustedServiceRequestHeaders\(event, 'workflow'\)/)
    assert.match(workflowProxy, /headers\.set\(name, value\)/)
  })

  test('WebDev report proxy uses the tenant-neutral service origin', () => {
    const webdevReport = readFileSync(`${root}/server/utils/webdevReport.ts`, 'utf8')
    assert.match(
      webdevReport,
      /resolveServiceAppBaseUrl\(event, WEBDEV_APP_CODE, \{ directTarget: true \}\)/
    )
    assert.match(webdevReport, /trustedServiceRequestHeaders\(event, WEBDEV_APP_CODE\)/)
    assert.doesNotMatch(webdevReport, /delete headers\['x-hzy-data-runtime-token'\]/)
  })

  test('approval entry is immediate and task failures are not masked as empty data', () => {
    const sidebar = readFileSync(`${root}/app/components/LayoutSidebar.vue`, 'utf8')
    const approvalPage = readFileSync(`${root}/app/pages/approval/tasks/index.vue`, 'utf8')
    assert.match(sidebar, /showApprovalEntry = ref\(Boolean\(workflowEnabled && currentAppCode && currentAppCode !== 'workflow'\)\)/)
    assert.doesNotMatch(sidebar, /showApprovalEntry\.value = true/)
    assert.match(approvalPage, /title="审批任务加载失败"/)
    assert.match(approvalPage, /boardError\.value/)
  })
})
