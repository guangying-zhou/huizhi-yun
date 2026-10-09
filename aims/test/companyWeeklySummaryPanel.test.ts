import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { codocsDocumentHref, summaryVersionTimeLabel } from '../app/utils/companyWeeklySummaryPresentation'
import { weeklyReportingErrorMessage } from '../app/utils/weeklyReportingError'
import { defaultTimesheetRange } from '../app/utils/timeEntryPresentation'

const uuid = '3f2c9a1e-8b7d-4c5a-9e11-0a1b2c3d4e5f'
const hostError = (statusCode: number, code: string) => ({ statusCode, data: { message: 'Service temporarily unavailable', data: { code } } })
const gatewayError = (statusCode: number, code: string) => ({ statusCode, data: { code, message: 'Document storage is temporarily unavailable' } })

test('503 session and storage codes map to Chinese for both envelopes', () => {
  for (const make of [hostError, gatewayError]) {
    assert.equal(weeklyReportingErrorMessage(make(503, 'console_session_verification_unavailable'), '失败'), '登录状态暂时无法核验，请稍后重试')
    assert.equal(weeklyReportingErrorMessage(make(503, 'enterprise_document_storage_unavailable'), '失败'), '文档存储服务暂时不可用，请稍后重试')
    assert.equal(weeklyReportingErrorMessage(make(503, 'other_unavailable'), '失败'), '服务暂时不可用，请稍后重试')
  }
})

test('version time is formatted in local time, never a raw ISO string', () => {
  const label = summaryVersionTimeLabel({ publishedAt: '2026-09-29T02:03:04.000Z', createdAt: '2026-09-28T00:00:00.000Z' })
  assert.doesNotMatch(label, /T\d{2}:|Z$/)
  assert.match(label, /2026/)
  assert.equal(summaryVersionTimeLabel({ publishedAt: null, createdAt: 'bad' }), '-')
})

test('archived document link only exists in the Host with a valid uuid', () => {
  assert.equal(codocsDocumentHref(uuid, true), `/codocs/documents/${uuid}`)
  assert.equal(codocsDocumentHref(uuid, false), null)
  assert.equal(codocsDocumentHref(null, true), null)
  assert.equal(codocsDocumentHref('../x', true), null)
})

test('timesheet defaults to the current ISO week in the reporting timezone', () => {
  assert.deepEqual(defaultTimesheetRange(new Date('2026-09-29T04:00:00Z')), { startDate: '2026-09-28', endDate: '2026-10-04' })
  assert.deepEqual(defaultTimesheetRange(new Date('2026-09-27T20:00:00Z')), { startDate: '2026-09-28', endDate: '2026-10-04' })
})

test('panel and timesheet sources use the shared helpers', () => {
  const panel = readFileSync(new URL('../app/components/CompanyWeeklySummaryPanel.vue', import.meta.url), 'utf8')
  assert.match(panel, /summaryVersionTimeLabel\(version\)/)
  assert.match(panel, /codocsDocumentHref\(version\.codocsDocumentUuid, hosted\)/)
  assert.doesNotMatch(panel, /data\?\.message \|\|/)
  const sheet = readFileSync(new URL('../app/pages/projects/[id]/timesheet.vue', import.meta.url), 'utf8')
  assert.match(sheet, /accessorKey: 'reviewStatus', header: '状态'/)
  assert.match(sheet, /#reviewStatus-cell/)
  assert.match(sheet, /defaultTimesheetRange\(/)
})
