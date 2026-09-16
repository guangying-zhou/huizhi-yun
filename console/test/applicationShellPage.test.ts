import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  resolveIssueReporterEndpointPath,
  resolveIssueReporterPageUrl
} from '../../foundation/app/composables/useIssueReporter.ts'

const page = readFileSync(new URL('../app/pages/shell/[appCode].vue', import.meta.url), 'utf8')
const app = readFileSync(new URL('../app/app.vue', import.meta.url), 'utf8')

describe('Console enterprise application shell', () => {
  test('keeps two recent business applications alive and validates frame messages', () => {
    assert.match(page, /MAX_RETAINED_FRAMES\s*=\s*2/)
    assert.match(page, /applicationShellTargetUrl/)
    assert.match(page, /prewarmApplication/)
    assert.match(page, /event\.origin\s*!==\s*window\.location\.origin/)
    assert.match(page, /event\.source\s*!==\s*frameElement\?\.contentWindow/)
    assert.match(page, /isSameOriginApplicationUrl\(activeApplication\.value\.homeUrl/)
    assert.match(page, /isApplicationShellApplication\(routeAppCode\.value\)/)
    assert.match(page, /hzy:shell:navigation/)
    assert.match(page, /logoURL\.origin\s*===\s*window\.location\.origin/)
    assert.match(page, /application\.basePath/)
  })

  test('keeps the shell route internal while exposing the canonical business URL', () => {
    assert.match(page, /SHELL_HISTORY_STATE_KEY\s*=\s*'hzyApplicationShell'/)
    assert.match(page, /window\.history\.replaceState/)
    assert.match(page, /stripApplicationShellEmbedParam\(target,\s*window\.location\.origin\)/)
    assert.match(
      page,
      /else if \(existing\.loaded\) \{\s*replaceVisibleTargetUrl\(existing\.target,\s*application\.appCode\)/
    )
    assert.match(page, /window\.addEventListener\('popstate',\s*onShellHistoryPopState\)/)
    assert.match(page, /window\.location\.replace\(shellEntry\)/)
  })

  test('owns the global navigation while embedded applications own business navigation', () => {
    assert.match(page, /<AppRail/)
    assert.match(page, /<AppLauncher/)
    assert.match(page, /<NotificationBell/)
    assert.match(page, /<UserMenu/)
    assert.match(page, /withApplicationShellEmbedParam/)
    assert.match(page, /v-if="activeBrandLogo"/)
    assert.match(page, /class="truncate text-lg font-semibold"/)
    assert.match(page, /activeFrame\?\.appName\s*\|\|\s*activeApplication\?\.appName/)
    assert.match(page, /workspace:\s*\{[\s\S]*?restoreLastRoute:\s*false/)
    assert.match(page, /console:\s*\{[\s\S]*?restoreLastRoute:\s*false/)
  })

  test('does not expose a duplicate standalone launcher in the shell header', () => {
    assert.doesNotMatch(page, /standaloneTarget/)
    assert.doesNotMatch(page, /aria-label="在新窗口打开"/)
    assert.doesNotMatch(page, /i-lucide-external-link/)
  })

  test('does not present the trusted same-origin application iframe as a sandbox boundary', () => {
    assert.doesNotMatch(page, /<iframe[\s\S]*?\ssandbox=/)
    assert.match(page, /allow="clipboard-read; clipboard-write; fullscreen"/)
  })

  test('refreshes the current iframe from the shell header while preserving embed mode', () => {
    assert.match(page, /function refreshActiveFrame\(\)/)
    assert.match(page, /withApplicationShellEmbedParam\(frame\.target,\s*window\.location\.origin\)/)
    assert.match(page, /frameElement\.src\s*=\s*src/)
    assert.match(page, /aria-label="刷新当前应用"/)
  })

  test('uses a stable page key while switching shell applications', () => {
    assert.match(app, /applicationShellPageKey/)
    assert.match(app, /route\.path\.startsWith\('\/shell\/'\)/)
  })

  test('routes feedback through the active business app instead of Console', () => {
    assert.equal(
      resolveIssueReporterEndpointPath('/aims/', '/api/webdev-report/issues'),
      '/aims/api/webdev-report/issues'
    )
    assert.equal(resolveIssueReporterEndpointPath('/', '/api/webdev-report/issues'), '')
    assert.equal(resolveIssueReporterEndpointPath('https://attacker.example/aims', '/api/webdev-report/issues'), '')
    assert.equal(
      resolveIssueReporterPageUrl(
        'https://wiztek.huizhi.yun/aims/projects/42?tab=tasks#active',
        'https://wiztek.huizhi.yun',
        '/shell/aims'
      ),
      'https://wiztek.huizhi.yun/aims/projects/42'
    )
    assert.match(page, /const activeFeedbackTarget = computed<ShellFeedbackTarget \| null>/)
    assert.match(page, /target\.origin !== origin/)
    assert.match(page, /:target-base-path="activeFeedbackTarget\.basePath"/)
    assert.match(page, /:target-page-url="activeFeedbackTarget\.pageUrl"/)
    assert.match(page, /:target-route-pattern="activeFeedbackTarget\.routePattern"/)
    assert.doesNotMatch(page, /sourceApp(Code)?=/)
  })
})
