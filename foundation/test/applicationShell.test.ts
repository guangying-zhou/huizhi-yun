import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  applicationShellEntryUrl,
  applicationShellStandaloneEnabled,
  applicationShellTargetUrl,
  isApplicationShellApplication,
  isSameOriginApplicationUrl,
  stripApplicationShellEmbedParam,
  withApplicationShellEmbedParam,
  withApplicationShellStandaloneParam
} from '../app/utils/applicationShell'

const origin = 'https://wiztek.huizhi.yun'

describe('enterprise application shell URL contract', () => {
  test('all catalog business applications can enter the shell except native Console entries', () => {
    assert.equal(isApplicationShellApplication('aims'), true)
    assert.equal(isApplicationShellApplication('assets'), true)
    assert.equal(isApplicationShellApplication('finance'), true)
    assert.equal(isApplicationShellApplication('codocs'), true)
    assert.equal(isApplicationShellApplication('console'), false)
    assert.equal(isApplicationShellApplication('workspace'), false)
    assert.equal(isApplicationShellApplication('enterprise'), false)
    assert.equal(isApplicationShellApplication('../aims'), false)
  })

  test('wraps a same-origin business deep link in a Console shell route', () => {
    assert.equal(
      applicationShellEntryUrl(
        'aims',
        'https://wiztek.huizhi.yun/aims/projects/33?tab=tasks#active',
        origin
      ),
      '/shell/aims?target=%2Faims%2Fprojects%2F33%3Ftab%3Dtasks%23active'
    )
  })

  test('keeps Console routes and cross-origin applications on direct navigation', () => {
    assert.equal(applicationShellEntryUrl('console', '/admin', origin), '/admin')
    assert.equal(applicationShellEntryUrl('enterprise', '/aims/projects/33?tab=tasks', origin), '/aims/projects/33?tab=tasks')
    assert.equal(
      applicationShellEntryUrl('aims', 'https://another.example.test/aims/', origin),
      'https://another.example.test/aims/'
    )
    assert.equal(isSameOriginApplicationUrl('/aims/', origin), true)
    assert.equal(
      isSameOriginApplicationUrl('https://another.example.test/aims/', origin),
      false
    )
  })

  test('accepts only targets inside the authorized application home path', () => {
    assert.equal(
      applicationShellTargetUrl(
        '/aims/projects/33',
        'https://wiztek.huizhi.yun/aims/',
        origin
      ),
      'https://wiztek.huizhi.yun/aims/projects/33'
    )
    assert.equal(
      applicationShellTargetUrl(
        '/assets/products',
        'https://wiztek.huizhi.yun/aims/',
        origin
      ),
      'https://wiztek.huizhi.yun/aims/'
    )
    assert.equal(
      applicationShellTargetUrl(
        'https://malicious.example.test/aims/',
        'https://wiztek.huizhi.yun/aims/',
        origin
      ),
      'https://wiztek.huizhi.yun/aims/'
    )
  })

  test('does not place the Console Shell on a separately hosted business application', () => {
    const people = 'http://127.0.0.1:3007/people/'
    assert.equal(applicationShellEntryUrl('people', people, 'http://127.0.0.1:3007',
      'http://127.0.0.1:3000/console/'), people)
    assert.equal(applicationShellEntryUrl('people', people, 'http://127.0.0.1:3000',
      'http://127.0.0.1:3000/console/'), people)
    assert.equal(applicationShellEntryUrl('people', '/people/', origin, '/'),
      '/shell/people?target=%2Fpeople%2F')
    assert.equal(applicationShellEntryUrl('people', '/people/', origin, `${origin}/console/`),
      '/shell/people?target=%2Fpeople%2F')
  })

  test('uses the catalog base path when the application home is a nested route', () => {
    assert.equal(
      applicationShellTargetUrl(
        '/assets/physical',
        'https://wiztek.huizhi.yun/assets/products',
        origin,
        '/assets/'
      ),
      'https://wiztek.huizhi.yun/assets/physical'
    )
    assert.equal(
      applicationShellTargetUrl(
        '/aims/projects',
        'https://wiztek.huizhi.yun/assets/products',
        origin,
        '/assets/'
      ),
      'https://wiztek.huizhi.yun/assets/products'
    )
  })

  test('rejects embedded routes as an application landing target', () => {
    assert.equal(
      applicationShellTargetUrl(
        '/codocs/embed/editor/document-uuid?readonly=1&title=0',
        '/codocs',
        origin,
        '/codocs/'
      ),
      'https://wiztek.huizhi.yun/codocs'
    )
  })

  test('adds and strips the private embed marker without losing other URL state', () => {
    const embedded = withApplicationShellEmbedParam(
      'https://wiztek.huizhi.yun/assets/products?status=active#list',
      origin
    )
    assert.equal(
      embedded,
      'https://wiztek.huizhi.yun/assets/products?status=active&hzy_embed=1#list'
    )
    assert.equal(
      stripApplicationShellEmbedParam(embedded, origin),
      '/assets/products?status=active#list'
    )
  })

  test('uses standalone=1 as the only explicit direct-application mode', () => {
    const standalone = withApplicationShellStandaloneParam(
      'https://wiztek.huizhi.yun/aims/projects/33?hzy_embed=1&tab=tasks#active',
      origin
    )
    assert.equal(
      standalone,
      'https://wiztek.huizhi.yun/aims/projects/33?tab=tasks&standalone=1#active'
    )
    assert.equal(applicationShellStandaloneEnabled(standalone, origin), true)
    assert.equal(applicationShellStandaloneEnabled('/aims/projects/33?standalone=0', origin), false)
    assert.equal(
      withApplicationShellEmbedParam(standalone, origin),
      'https://wiztek.huizhi.yun/aims/projects/33?tab=tasks&hzy_embed=1#active'
    )
    assert.equal(
      stripApplicationShellEmbedParam(standalone, origin),
      '/aims/projects/33?tab=tasks#active'
    )
  })
})

test('shared layout suppresses duplicated global controls inside the shell frame', () => {
  const layout = readFileSync(new URL('../app/components/LayoutSidebar.vue', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../app/plugins/application-shell-bridge.client.ts', import.meta.url), 'utf8')

  assert.match(layout, /useApplicationShell\(\)/)
  assert.match(layout, /!applicationShellEmbedded\.value/)
  assert.match(layout, /v-if="!applicationShellEmbedded"/)
  assert.match(
    layout,
    /<!-- Sidebar Header: Logo -->\s*<div\s+v-if="!applicationShellEmbedded"[\s\S]*?<NuxtLink\s+to="\/"/
  )
  assert.doesNotMatch(layout, /<NuxtLink\s+v-if="!applicationShellEmbedded"/)
  assert.match(bridge, /hzy:shell:navigation/)
  assert.match(bridge, /window\.parent\.postMessage/)
  assert.match(bridge, /appDisplayName/)
  assert.match(bridge, /appLogo/)
  assert.match(bridge, /logo:\s*appLogo/)
})

test('application navigation warms both the shell and the business target', () => {
  const rail = readFileSync(new URL('../app/components/AppRail.vue', import.meta.url), 'utf8')
  const launcher = readFileSync(new URL('../app/components/AppLauncher.vue', import.meta.url), 'utf8')

  for (const source of [rail, launcher]) {
    assert.match(source, /prefetchApplicationEntry\(directAppEntryUrl\(app\)\)/)
    assert.match(source, /prefetchApplicationEntry\(appEntryUrl\(app\)\)/)
    assert.match(source, /emit\('intent', app\.appCode\)/)
  }
})

test('top-level same-origin business pages return to the Console shell by default', () => {
  const entry = readFileSync(
    new URL('../app/plugins/application-shell-entry.client.ts', import.meta.url),
    'utf8'
  )

  assert.match(entry, /window\.parent\s*!==\s*window/)
  assert.match(entry, /applicationShellStandaloneEnabled/)
  assert.match(entry, /isApplicationShellApplication\(appCode\)/)
  assert.match(entry, /isSameOriginApplicationUrl\(application\.homeUrl/)
  assert.match(entry, /applicationShellTargetUrl/)
  assert.match(entry, /window\.location\.replace\(shellEntry\)/)
  assert.match(entry, /withApplicationShellStandaloneParam/)
  assert.match(entry, /router\.afterEach/)
})

test('approval center preserves the enterprise shell when opening business details', () => {
  const approvalCenter = readFileSync(
    new URL('../app/pages/approval/tasks/index.vue', import.meta.url),
    'utf8'
  )

  assert.match(approvalCenter, /const \{ embedded: applicationShellEmbedded \} = useApplicationShell\(\)/)
  assert.match(approvalCenter, /targetAppCode !== runtimeAppCode/)
  assert.match(approvalCenter, /const routeBasePath = configuredBasePath\.startsWith\('\/'\)/)
  assert.match(approvalCenter, /stripAppBasePath\(targetUrl\.pathname, routeBasePath\)/)
  assert.match(approvalCenter, /if \(import\.meta\.client && applicationShellEmbedded\.value\)/)
  assert.match(approvalCenter, /applicationShellEntryUrl\(targetAppCode, target, window\.location\.origin\)/)
  assert.match(approvalCenter, /window\.parent\.location\.assign/)
  assert.match(approvalCenter, /getApprovalTarget\(item, 'task'\), item\.app_code/)
  assert.match(approvalCenter, /getApprovalTarget\(item, 'instance'\), item\.app_code/)
  assert.match(approvalCenter, /getInitiatedTarget\(item\), item\.app_code/)
})
