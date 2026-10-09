import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatDate, formatMoney } from '../app/utils/format'
import { selectableTableUi } from '../app/utils/listPage'
import { classifyApplicationAccessIssue, resolveApiErrorAlert } from '../app/composables/useApiErrorAlert'

describe('shared UI list helpers', () => {
  test('format helpers use stable placeholders and localized money', () => {
    assert.equal(formatDate(null), '-')
    assert.equal(formatDate('invalid'), '-')
    assert.match(formatMoney(1234.5), /1,234\.50/)
    assert.equal(formatMoney(undefined), '-')
  })

  test('selectable rows expose click affordance and page titles clear on unmount', () => {
    assert.match(selectableTableUi.tbody, /cursor-pointer/)
    const pageTitleSource = readFileSync(new URL('../app/composables/usePageTitle.ts', import.meta.url), 'utf8')
    assert.match(pageTitleSource, /onUnmounted/)
    assert.match(pageTitleSource, /pageTitle\.value = ''/)
  })

  test('API error alerts distinguish authorization and sanitize URLs', () => {
    const alert = resolveApiErrorAlert({ statusCode: 403, message: 'denied at https://internal.example/token' }, { appName: 'Console' })

    assert.equal(alert?.color, 'error')
    assert.equal(alert?.title, 'Console 访问权限不足')
    assert.match(alert?.description || '', /\[已隐藏URL\]/)
    assert.doesNotMatch(alert?.description || '', /internal\.example/)
  })

  test('API error alerts separate person permissions from configuration, deployment and service faults', () => {
    const cases = [
      [{ statusCode: 403, data: { code: 'person_permission_denied' } }, 'person_permission_denied', '访问权限不足'],
      [{ statusCode: 503, data: { code: 'module_not_configured' } }, 'module_not_configured', '尚未配置'],
      [{ statusCode: 503, data: { code: 'module_not_deployed' } }, 'module_not_deployed', '尚未部署'],
      [{ statusCode: 503, message: 'Enterprise runtime unavailable' }, 'service_unavailable', '服务暂不可用']
    ] as const
    for (const [error, issue, title] of cases) {
      assert.equal(classifyApplicationAccessIssue(error), issue)
      assert.match(resolveApiErrorAlert(error, { appName: 'Assets' })?.title || '', new RegExp(title))
    }
    assert.match(resolveApiErrorAlert({ statusCode: 403, data: { code: 'enterprise_entitlement_inactive' } })?.description || '', /不是单应用购买限制/)
  })
})
