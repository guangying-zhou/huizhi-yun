import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Enterprise worklogs bind owner to the signed actor and validate real dates', () => {
  const source = read('../server/utils/enterpriseCodocsWorklogs.ts')
  assert.match(source, /codocs\.personal-document-list/)
  assert.match(source, /codocs\.personal-document-create/)
  assert.match(source, /actorUid: user\.uid/)
  assert.match(source, /type: 'worklog'/)
  assert.match(source, /type: 'private', search: `工作日志_\$\{prefix\}`/)
  assert.match(source, /\^工作日志_\(\\d\{4\}\)/)
  assert.match(source, /createEnterpriseCodocsDocument/)
  assert.match(source, /getUTCFullYear\(\) === year/)
  assert.match(source, /doc_type: 'worklog'/)
  assert.doesNotMatch(source, /owner_uid.*body/)
  assert.match(read('../server/routes/codocs/api/worklogs/list.get.ts'), /enterpriseCodocsWorklogsList/)
  assert.match(read('../server/routes/codocs/api/worklogs/create.post.ts'), /enterpriseCodocsWorklogsCreate/)
})

test('worklog callers use only date and a stable retry key', () => {
  for (const path of ['../../codocs/app/pages/mydocs/worklogs.vue', '../../codocs/app/pages/mydocs/journal.vue']) {
    const source = read(path)
    assert.match(source, /worklogCreationAttempt\.keyFor\(cacheKey\('worklog-create'\), \{ date: dateKey \}\)/)
    assert.match(source, /headers: \{ 'Idempotency-Key': attemptKey \}/)
    assert.match(source, /worklogCreationAttempt\.complete\(attemptKey\)/)
    assert.match(source, /body: \{ date: dateKey \}/)
    assert.doesNotMatch(source.slice(0, source.indexOf("const fetchReports")), /query: \{ owner:/)
  }
})
