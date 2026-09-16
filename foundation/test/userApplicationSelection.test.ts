import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { shouldUseConsoleUserApplications } from '../server/utils/userApplicationSelection.ts'

describe('Console user application selection', () => {
  test('accepts an authorized business-app subset without comparing it to the full runtime catalog', () => {
    assert.equal(shouldUseConsoleUserApplications([
      { appCode: 'workspace' },
      { appCode: 'codocs' },
      { appCode: 'aims' },
      { appCode: 'workflow' }
    ]), true)
  })

  test('does not treat portal-only or empty results as an authorized business application list', () => {
    assert.equal(shouldUseConsoleUserApplications([]), false)
    assert.equal(shouldUseConsoleUserApplications([
      { appCode: 'workspace' },
      { appCode: 'console' }
    ]), false)
  })

  test('accepts an authoritative empty result so a simulated role cannot inherit stale applications', () => {
    assert.equal(shouldUseConsoleUserApplications([], { authorizationEvaluated: true }), true)
    assert.equal(shouldUseConsoleUserApplications([
      { appCode: 'workspace' }
    ], { authorizationEvaluated: true }), true)
  })

  test('always asks Console for the user-filtered list even when the runtime catalog is populated', () => {
    const endpoint = readFileSync(new URL('../server/api/user/applications.get.ts', import.meta.url), 'utf8')

    assert.match(endpoint, /const consoleUserApplications = await fetchConsoleUserApplications\(event, runtime\)/)
    assert.match(endpoint, /authorizationEvaluated: consoleUserApplications\.authorizationEvaluated/)
    assert.doesNotMatch(endpoint, /if \(hasConsoleUserApplicationsAuthorization\(event\) \|\| !runtimeApps\.length\)/)
  })

  test('loads the Console user application list through the Console Service Binding client', () => {
    const endpoint = readFileSync(new URL('../server/api/user/applications.get.ts', import.meta.url), 'utf8')

    assert.match(endpoint, /import \{ fetchConsoleServiceJson \} from '\.\.\/\.\.\/utils\/serviceOidc'/)
    assert.match(endpoint, /fetchConsoleServiceJson<ConsoleUserApplicationsEnvelope>\(event, url,/)
    assert.doesNotMatch(endpoint, /fetchExternal<ConsoleUserApplicationsEnvelope>/)
  })

  test('only merges current application metadata when Console authorized that application', () => {
    const endpoint = readFileSync(new URL('../server/api/user/applications.get.ts', import.meta.url), 'utf8')
    const guard = endpoint.slice(
      endpoint.indexOf('function mergeAuthorizedCurrentApplication'),
      endpoint.indexOf('function portalApplicationsForAuthorization')
    )

    assert.match(guard, /apps\.some\(app => app\.appCode === currentApp\.appCode\)/)
    assert.match(guard, /return apps/)
    assert.match(endpoint, /data: sortApplications\(mergeAuthorizedCurrentApplication\(/)
  })
})
