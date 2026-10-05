import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { hostNotificationTarget, resolveAppNotificationActionUrl as resolveNotificationActionUrl } from '../app/utils/notificationActionUrl.ts'
import { ENTERPRISE_HOST_NOTIFICATION_TARGET } from '../shared/utils/notificationActionUrl.ts'

const apps = [{ appCode: 'finance', homeUrl: 'https://finance.example.test/finance/' }]

describe('notification action URL resolution', () => {
  test('joins app-relative paths to a cross-origin application home', () => {
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/invoices/INV-1', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), 'https://finance.example.test/finance/invoices/INV-1')
  })

  test('does not duplicate an existing application base path', () => {
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/finance/invoices/INV-1?tab=history', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), 'https://finance.example.test/finance/invoices/INV-1?tab=history')
  })

  test('accepts only absolute URLs inside the registered target application', () => {
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://finance.example.test/finance/invoices/INV-1', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), 'https://finance.example.test/finance/invoices/INV-1')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://evil.example.test/finance/invoices/INV-1', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://finance.example.test/outside', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
  })

  test('uses the resolved independent-domain home path instead of a stale shared basePath', () => {
    const independent = [{
      appCode: 'aims',
      homeUrl: 'https://aims.customer.example/',
      basePath: '/aims/',
      status: 'active'
    }]
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/projects/1', actionTargetAppCode: 'aims' }, independent, 'https://console.example.test'), 'https://aims.customer.example/projects/1')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/aims/projects/1', actionTargetAppCode: 'aims' }, independent, 'https://console.example.test'), 'https://aims.customer.example/projects/1')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://aims.customer.example/projects/1', actionTargetAppCode: 'aims' }, independent, 'https://console.example.test'), 'https://aims.customer.example/projects/1')
  })

  test('keeps same-origin applications inside their own base paths', () => {
    const shared = [
      { appCode: 'aims', homeUrl: 'https://tenant.example.test/aims/' },
      { appCode: 'finance', homeUrl: 'https://tenant.example.test/finance/' }
    ]
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/projects/1', actionTargetAppCode: 'aims' }, shared, 'https://tenant.example.test'), 'https://tenant.example.test/aims/projects/1')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://tenant.example.test/finance/invoices/1', actionTargetAppCode: 'aims' }, shared, 'https://tenant.example.test'), '')
  })

  test('keeps Console root configuration routes outside the /admin entry path', () => {
    const consoleApps = [{
      appCode: 'console',
      homeUrl: 'https://tenant.example.test/admin',
      basePath: '/',
      status: 'active'
    }]
    assert.equal(resolveNotificationActionUrl({
      actionUrl: '/notification-runtime',
      actionTargetAppCode: 'console'
    }, consoleApps, 'https://tenant.example.test'), 'https://tenant.example.test/notification-runtime')
    assert.equal(resolveNotificationActionUrl({
      actionUrl: '/admin/logs?level=error',
      actionTargetAppCode: 'console'
    }, consoleApps, 'https://tenant.example.test'), 'https://tenant.example.test/admin/logs?level=error')
    assert.equal(resolveNotificationActionUrl({
      actionUrl: '/notifications/notif-42',
      actionTargetAppCode: 'console'
    }, consoleApps, 'https://tenant.example.test'), 'https://tenant.example.test/notifications/notif-42')
  })

  test('rejects unknown applications and unsafe URL forms', () => {
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/invoices/1', actionTargetAppCode: 'missing' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '//evil.example.test/x', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'javascript:alert(1)', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://user:pass@finance.example.test/finance/invoices/1', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/finance/%2e%2e/outside', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/finance/%2foutside', actionTargetAppCode: 'finance' }, apps, 'https://console.example.test'), '')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/invoices/1', actionTargetAppCode: 'finance' }, [{ ...apps[0], status: 'inactive' }], 'https://console.example.test'), '')
  })

  test('inside the Host, a Host target resolves to a same-origin Host path regardless of catalog origin', () => {
    const host = hostNotificationTarget({ appCode: 'enterprise', sharedApiBase: '/enterprise/api/foundation' })
    assert.equal(host, ENTERPRISE_HOST_NOTIFICATION_TARGET)
    // hzy0 mirrors the test deployment: the signed catalog homeUrl (and so the
    // stored absolute URL) names the cloud site, and enterprise is absent from
    // the user's application list.
    const hostApps: typeof apps = []
    const origin = 'https://hzy0.isme.dev'
    assert.equal(resolveNotificationActionUrl({ actionUrl: 'https://hzy-test.huizhi.yun/enterprise/approvals/31', actionTargetAppCode: 'enterprise' }, hostApps, origin, host), '/enterprise/approvals/31')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/enterprise/approvals/31?returnPage=2#top', actionTargetAppCode: 'enterprise' }, hostApps, origin, host), '/enterprise/approvals/31?returnPage=2#top')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/enterprise/approvals', actionTargetAppCode: 'enterprise' }, hostApps, origin, host), '/enterprise/approvals')
    // Stays inside the Host base and never reaches API/asset/framework paths.
    for (const actionUrl of [
      '/aims/projects/1', '/workflow/tasks/5', 'https://evil.example.test/other', '/enterprisex/approvals',
      '/enterprise/api/auth/logout', '/enterprise/_nuxt/app.js', '/enterprise/__hzy0/x', '/enterprise/%2e%2e/api/auth/logout',
      '/enterprise/%61pi/auth/logout', '/enterprise/%5fnuxt/app.js', '/enterprise/%255f%255fhzy0/x',
      '/enterprise/%2fapi', '/enterprise//api/auth/logout', '//evil.example.test/enterprise/approvals', 'javascript:alert(1)',
      'https://user:pass@hzy-test.huizhi.yun/enterprise/approvals/1', '/enterprise/approvals\\..\\api'
    ]) {
      assert.equal(resolveNotificationActionUrl({ actionUrl, actionTargetAppCode: 'enterprise' }, hostApps, origin, host), '', actionUrl)
    }
    // Other targets keep catalog validation inside the Host.
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/invoices/1', actionTargetAppCode: 'finance' }, apps, origin, host), 'https://finance.example.test/finance/invoices/1')
    assert.equal(resolveNotificationActionUrl({ actionUrl: '/workflow/tasks/5', actionTargetAppCode: 'workflow' }, hostApps, origin, host), '')
  })

  test('outside the Host a Host target still requires the catalog', () => {
    for (const config of [null, {}, { appCode: 'console', sharedApiBase: '/enterprise/api/foundation' }, { appCode: 'enterprise', sharedApiBase: '/api' }]) {
      assert.equal(hostNotificationTarget(config), null)
    }
    assert.equal(hostNotificationTarget(undefined), null)
    const target = { actionUrl: 'https://hzy-test.huizhi.yun/enterprise/approvals/31', actionTargetAppCode: 'enterprise' }
    assert.equal(resolveNotificationActionUrl(target, [], 'https://tenant.example.test', null), '')
    assert.equal(resolveNotificationActionUrl(target, [{ appCode: 'enterprise', homeUrl: 'https://hzy-test.huizhi.yun/enterprise/' }], 'https://tenant.example.test'), 'https://hzy-test.huizhi.yun/enterprise/approvals/31')
    // A look-alike context object is not accepted as the Host.
    assert.equal(resolveNotificationActionUrl(target, [], 'https://tenant.example.test', { appCode: 'enterprise', basePath: '/enterprise/' } as never), '')
  })
})
