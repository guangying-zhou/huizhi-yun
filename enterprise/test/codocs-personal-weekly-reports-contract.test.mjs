import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Enterprise personal weekly reports use the generic personal-document contract', () => {
  const source = read('../server/utils/enterpriseCodocsPersonalWeeklyReports.ts')
  assert.match(source, /codocs\.personal-document-list/)
  assert.match(source, /codocs\.personal-document-create/)
  assert.match(source, /\['private', 'weekly-report'\]/)
  assert.match(source, /search: `\$\{query\.year\}-W`/)
  assert.match(source, /listAllPersonalDocuments\(event, user, /)
  const pages = read('../server/utils/enterpriseCodocsPersonalDocumentPages.ts')
  assert.match(pages, /actorUid: user\.uid/)
  assert.match(pages, /personalDocumentPageSize = 100/)
  assert.doesNotMatch(source, /pageSize: '200'/)
  assert.match(source, /owner_uid.*user\.uid/)
  assert.match(source, /createEnterpriseCodocsDocument/)
  assert.match(read('../server/routes/codocs/api/personal-weekly-reports/list.get.ts'), /enterpriseCodocsPersonalWeeklyReportsList/)
  assert.match(read('../server/routes/codocs/api/personal-weekly-reports/create.post.ts'), /enterpriseCodocsPersonalWeeklyReportsCreate/)
})
