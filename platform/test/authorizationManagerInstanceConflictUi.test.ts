import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('AuthorizationsManager instance conflict explanation UI', () => {
  test('keeps the tenant-admin request and action wiring in the manager', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')

    assert.match(manager, /instanceConflictForm = reactive<InstanceConflictExplainForm>/)
    assert.match(manager, /\/api\/platform\/tenant-admin\/instance-conflict-explain/)
    assert.match(manager, /function runInstanceConflictExplain\(\)/)
    assert.match(manager, /<AuthorizationInstanceConflictDiagnostics/)
    assert.match(manager, /:form="instanceConflictForm"/)
    assert.match(manager, /:result="instanceConflictExplainResult"/)
    assert.match(manager, /:pending="pending\.instanceConflictExplain"/)
    assert.match(manager, /@run="runInstanceConflictExplain"/)
    assert.match(manager, /@use-selected-subject="useFirstSelectedSubjectForInstanceConflict"/)
  })

  test('keeps optional inputs normalized before the delegated diagnostic runs', () => {
    const manager = source('app/components/console/AuthorizationsManager.vue')

    assert.match(manager, /ownerUid: instanceConflictForm\.ownerUid\.trim\(\) \|\| undefined/)
    assert.match(manager, /applicantUid: instanceConflictForm\.applicantUid\.trim\(\) \|\| undefined/)
    assert.match(manager, /handlerUid: instanceConflictForm\.handlerUid\.trim\(\) \|\| undefined/)
    assert.match(manager, /makerUid: instanceConflictForm\.makerUid\.trim\(\) \|\| undefined/)
  })

  test('binds diagnostic inputs and represents warning and blocking results inside the extracted component', () => {
    const component = source('app/components/console/AuthorizationInstanceConflictDiagnostics.vue')

    assert.match(component, /v-model="form\.applicantUid"/)
    assert.match(component, /v-model="form\.handlerUid"/)
    assert.match(component, /v-model="form\.makerUid"/)
    assert.match(component, /@click="emit\('run'\)"/)
    assert.match(component, /@click="emit\('useSelectedSubject'\)"/)
    assert.match(component, /if \(props\.result\.hasBlockingViolation\) return 'error'/)
    assert.match(component, /if \(props\.result\.hasWarningViolation \|\| props\.result\.hasViolation\) return 'warning'/)
    assert.match(component, /if \(props\.result\.hasBlockingViolation\) return '已拦截'/)
    assert.match(component, /if \(props\.result\.hasWarningViolation \|\| props\.result\.hasViolation\) return '需关注'/)
    assert.match(component, /principal\.matchesActor/)
    assert.match(component, /instanceConflictStatusLabel\(rule\.status\)/)
  })
})
