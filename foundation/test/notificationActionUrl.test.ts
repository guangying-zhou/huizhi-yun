import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveAppNotificationActionUrl as resolveNotificationActionUrl } from '../app/utils/notificationActionUrl.ts'

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
})
