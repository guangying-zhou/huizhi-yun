#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const ACCEPT_SCRIPT = 'scripts/accept-runtime-isolation.mjs'

const CASES = [
  {
    label: 'strict requires live URLs, DB checks, public routing, PM2 live and server Nginx configs',
    args: ['--strict'],
    expected: [
      '--platform-prod-env platform/.env.prod',
      '--platform-dev-env platform/.env.dev',
      '--console-prod-env console/.env.prod',
      '--console-test-env console/.env.test',
      '--console-dev-env console/.env.dev',
      '--platform-prod-url',
      '--platform-dev-url',
      '--console-prod-url',
      '--console-test-url',
      '--console-db',
      '--platform-dev-db',
      '--pm2-live',
      '--public-routing',
      '--nginx-platform-conf',
      '--nginx-console-conf'
    ]
  },
  {
    label: 'strict Cloudflare prod requires real Cloudflare env and test-only Nginx config',
    args: ['--strict', '--console-prod-cloudflare'],
    expected: [
      '--console-prod-env console/.env.cloudflare',
      '--nginx-console-test-only-conf'
    ]
  },
  {
    label: 'strict rejects tracked example env files',
    args: [
      '--strict',
      '--platform-prod-env',
      'platform/.env.prod.example',
      '--platform-dev-env',
      'platform/.env.dev.example',
      '--console-prod-env',
      'console/.env.prod.example',
      '--console-test-env',
      'console/.env.test.example',
      '--console-dev-env',
      'console/.env.dev.example'
    ],
    expected: [
      'replace --platform-prod-env platform/.env.prod.example with a real env file',
      'replace --console-test-env console/.env.test.example with a real env file',
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'strict cannot be combined with static-only precheck mode',
    args: [
      '--strict',
      '--static-only'
    ],
    expected: [
      '--strict and --static-only cannot be combined',
      'final live acceptance',
      'env/template precheck'
    ]
  },
  {
    label: 'strict Cloudflare prod rejects server-side console-prod Nginx config',
    fixture: 'cloudflare',
    args: [
      '--strict',
      '--console-prod-cloudflare',
      '--nginx-console-conf',
      '/etc/nginx/conf.d/console-wiztek.conf',
      '--nginx-console-test-only-conf',
      '/etc/nginx/conf.d/console-wiztek.conf'
    ],
    expected: [
      'remove --nginx-console-conf when --console-prod-cloudflare is used',
      '--nginx-console-test-only-conf'
    ],
    forbidden: [
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'strict Cloudflare prod requires DB runtime cache rows',
    fixture: 'cloudflare',
    args: [
      '--strict',
      '--console-prod-cloudflare'
    ],
    expected: [
      '--console-db-require-prod-cache because console-prod uses DB runtime cache'
    ],
    forbidden: [
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'Nginx test-only validation rejects full console prod/test config',
    script: 'scripts/validate-nginx-routing.mjs',
    args: [
      '--console-test-only-conf',
      'console/deploy/nginx/console-wiztek.conf'
    ],
    expected: [
      'must not contain server_name for hzy.wiztek.cn'
    ]
  },
  {
    label: 'strict rejects fixture PM2 and shared workdir shortcuts',
    fixture: 'pm2',
    args: [
      '--strict',
      '--pm2-live',
      '--pm2-jlist-file',
      'scripts/fixtures/pm2-jlist-runtime-isolation.json',
      '--allow-shared-pm2-cwd'
    ],
    expected: [
      'remove --pm2-jlist-file',
      'remove --allow-shared-pm2-cwd'
    ],
    forbidden: [
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'live PM2 rejects stale console-prod process when prod runs on Cloudflare',
    script: 'scripts/verify-pm2-live.mjs',
    fixture: 'pm2Live',
    args: [
      '--console-prod-cloudflare',
      '--pm2-jlist-file',
      'scripts/fixtures/pm2-jlist-runtime-isolation.json'
    ],
    expected: [
      'console-prod PM2 process must not exist when --console-prod-cloudflare is used',
      'hzy-console-prod'
    ]
  },
  {
    label: 'live PM2 rejects renamed console-prod process when prod runs on Cloudflare',
    script: 'scripts/verify-pm2-live.mjs',
    fixture: 'renamedPm2Live',
    args: [
      '--console-prod-cloudflare'
    ],
    expected: [
      'console-prod PM2 process must not exist when --console-prod-cloudflare is used',
      'legacy-console-prod',
      'deployment=huizhi-console'
    ]
  },
  {
    label: 'strict rejects public routing and cache bypass shortcuts',
    fixture: 'pm2',
    args: [
      '--strict',
      '--public-routing',
      '--public-routing-skip-http',
      '--allow-platform-cloudflare',
      '--console-db-allow-legacy-unscoped',
      '--console-db-cache-rows-file',
      'scripts/fixtures/console-runtime-cache-happy.json'
    ],
    expected: [
      'remove --public-routing-skip-http',
      'remove --allow-platform-cloudflare',
      'remove --console-db-allow-legacy-unscoped',
      'remove --console-db-cache-rows-file'
    ],
    forbidden: [
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'strict requires fixed public routing IP expectation',
    fixture: 'pm2',
    args: [
      '--strict',
      '--public-routing'
    ],
    expected: [
      '--public-routing-expected-server-ip',
      '--public-routing-expected-platform-ip',
      'or an -env variant'
    ],
    forbidden: [
      '--strict must not use tracked *.example env files'
    ]
  },
  {
    label: 'static-only rejects runtime verification options',
    args: [
      '--static-only',
      '--pm2-live',
      '--public-routing',
      '--platform-prod-url',
      'http://127.0.0.1:3010'
    ],
    expected: [
      '--static-only cannot be combined with runtime verification options',
      '--pm2-live',
      '--public-routing',
      '--platform-*-url'
    ]
  },
  {
    label: 'scoped DB option parser rejects unknown Console DB suboptions',
    args: [
      '--console-db-typo',
      'value'
    ],
    expected: [
      'unknown option: --console-db-typo'
    ]
  },
  {
    label: 'scoped DB option parser rejects unknown Platform dev DB suboptions',
    args: [
      '--platform-dev-db-allow-target-without-dev-suffix',
      'true'
    ],
    expected: [
      'unknown option: --platform-dev-db-allow-target-without-dev-suffix'
    ]
  },
  {
    label: 'strict acceptance rejects public routing DNS fixtures',
    args: [
      '--strict',
      '--dns-fixture-file',
      'dns-fixture.json'
    ],
    expected: [
      'unknown option: --dns-fixture-file'
    ]
  }
]

function copyFixtureEnv(dir, targetName, sourcePath) {
  const targetPath = join(dir, targetName)
  writeFileSync(targetPath, readFileSync(sourcePath, 'utf8'), 'utf8')
  return targetPath
}

function createRenamedPm2Fixture(dir) {
  const targetPath = join(dir, 'pm2-renamed-console-prod.json')
  const list = JSON.parse(readFileSync('scripts/fixtures/pm2-jlist-runtime-isolation.json', 'utf8'))
  for (const item of list) {
    if (item?.name === 'hzy-console-prod') {
      item.name = 'legacy-console-prod'
      item.pm2_env.pm_cwd = '/srv/hzy/legacy-console-prod'
      item.pm2_env.pm_exec_path = '/srv/hzy/legacy-console-prod/.output/server/index.mjs'
      item.pm2_env.HZY_DEPLOYMENT_PUBLIC_URL = 'https://console.huizhi.yun'
      item.pm2_env.HZY_PLATFORM_URL = 'https://huizhi.yun'
      item.pm2_env.HZY_PLATFORM_DEPLOYMENT_CODE = 'huizhi-console'
      item.pm2_env.HZY_PLATFORM_BUNDLE_CACHE_SCOPE = 'huizhi-console'
    }
  }
  writeFileSync(targetPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  return targetPath
}

function createFakeNode(dir) {
  const nodePath = join(dir, 'node')
  const logPath = join(dir, 'fake-node-args.log')
  writeFileSync(nodePath, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logPath)}\nexit 0\n`, 'utf8')
  chmodSync(nodePath, 0o755)
  return { nodePath, logPath }
}

function createFixtureEnvs() {
  const dir = mkdtempSync(join(tmpdir(), 'hzy-runtime-acceptance-strict-'))
  const files = {
    platformProd: copyFixtureEnv(dir, 'platform-prod.env', 'platform/.env.prod.example'),
    platformDev: copyFixtureEnv(dir, 'platform-dev.env', 'platform/.env.dev.example'),
    consoleProd: copyFixtureEnv(dir, 'console-prod.env', 'console/.env.prod.example'),
    consoleCloudflare: copyFixtureEnv(dir, 'console-cloudflare.env', 'console/.env.cloudflare.example'),
    consoleTest: copyFixtureEnv(dir, 'console-test.env', 'console/.env.test.example'),
    consoleDev: copyFixtureEnv(dir, 'console-dev.env', 'console/.env.dev.example')
  }

  const sharedArgs = [
    '--platform-prod-env', files.platformProd,
    '--platform-dev-env', files.platformDev,
    '--console-test-env', files.consoleTest,
    '--console-dev-env', files.consoleDev
  ]

  return {
    dir,
    fakeNode: createFakeNode(dir),
    renamedPm2JlistFile: createRenamedPm2Fixture(dir),
    pm2Args: [
      ...sharedArgs,
      '--console-prod-env', files.consoleProd
    ],
    pm2LiveArgs: [
      '--platform-prod-env', files.platformProd,
      '--platform-dev-env', files.platformDev,
      '--console-prod-env', files.consoleProd,
      '--console-test-env', files.consoleTest
    ],
    cloudflareArgs: [
      ...sharedArgs,
      '--console-prod-env', files.consoleCloudflare
    ]
  }
}

function fixtureArgs(testCase, fixtures) {
  if (testCase.fixture === 'pm2') return fixtures.pm2Args
  if (testCase.fixture === 'pm2Live') return fixtures.pm2LiveArgs
  if (testCase.fixture === 'renamedPm2Live') return [
    ...fixtures.pm2LiveArgs,
    '--pm2-jlist-file', fixtures.renamedPm2JlistFile
  ]
  if (testCase.fixture === 'cloudflare') return fixtures.cloudflareArgs
  return []
}

function runCase(testCase, fixtures) {
  const args = [
    ...testCase.args,
    ...fixtureArgs(testCase, fixtures)
  ]
  const result = spawnSync(process.execPath, [testCase.script || ACCEPT_SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`

  if (result.status === 0) {
    throw new Error(`${testCase.label}: expected failure, command exited 0`)
  }

  for (const expected of testCase.expected) {
    if (!output.includes(expected)) {
      throw new Error(`${testCase.label}: expected output to include ${JSON.stringify(expected)}\n${output}`)
    }
  }
  for (const forbidden of testCase.forbidden || []) {
    if (output.includes(forbidden)) {
      throw new Error(`${testCase.label}: output unexpectedly included ${JSON.stringify(forbidden)}\n${output}`)
    }
  }

  console.info(`[runtime-acceptance-strict] ${testCase.label} passed`)
}

function runForwardingCase(fixtures) {
  const args = [
    '--strict',
    ...fixtures.pm2Args,
    '--platform-prod-url',
    'http://127.0.0.1:3010',
    '--platform-dev-url',
    'http://127.0.0.1:3011',
    '--console-prod-url',
    'http://127.0.0.1:3030',
    '--console-test-url',
    'http://127.0.0.1:3031',
    '--console-db',
    'hzy_console',
    '--console-db-host',
    '127.0.0.1',
    '--console-db-user',
    'root',
    '--platform-dev-db',
    'hzy_platform_dev',
    '--platform-dev-db-host',
    '127.0.0.1',
    '--platform-dev-db-user',
    'root',
    '--platform-dev-db-password',
    'platform-secret',
    '--expected-test-deployment-code',
    'wiztek-test-console',
    '--platform-dev-db-expected-test-public-url',
    'https://hzy-test.wiztek.cn',
    '--pm2-live',
    '--public-routing',
    '--public-routing-expected-server-ip',
    '8.130.81.31',
    '--nginx-platform-conf',
    'platform/deploy/nginx/platform-wiztek.conf',
    '--nginx-console-conf',
    'console/deploy/nginx/console-wiztek.conf'
  ]
  const result = spawnSync(process.execPath, [ACCEPT_SCRIPT, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fixtures.dir}:${process.env.PATH || ''}`
    }
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`

  if (result.status !== 0) {
    throw new Error(`strict forwards platform dev DB direct password: expected success, command failed\n${output}`)
  }
  const fakeNodeLog = readFileSync(fixtures.fakeNode.logPath, 'utf8')
  if (!fakeNodeLog.includes('platform/scripts/verify-platform-dev-db.mjs')) {
    throw new Error(`strict forwards platform dev DB direct password: platform dev DB verifier was not invoked\n${fakeNodeLog}`)
  }
  if (!fakeNodeLog.includes('scripts/probe-server-upstreams.mjs')) {
    throw new Error(`strict forwards platform dev DB direct password: server upstream probe was not invoked\n${fakeNodeLog}`)
  }
  if (!fakeNodeLog.includes('--password platform-secret')) {
    throw new Error(`strict forwards platform dev DB direct password: expected actual verifier args to include raw secret value\n${fakeNodeLog}`)
  }
  if (!output.includes('--password <redacted>')) {
    throw new Error(`strict forwards platform dev DB direct password: expected displayed verifier command to redact password\n${output}`)
  }
  if (output.includes('platform-secret')) {
    throw new Error(`strict forwards platform dev DB direct password: displayed output leaked the password\n${output}`)
  }

  console.info('[runtime-acceptance-strict] strict forwards platform dev DB direct password passed')
}

function main() {
  const fixtures = createFixtureEnvs()
  try {
    for (const testCase of CASES) {
      runCase(testCase, fixtures)
    }
    runForwardingCase(fixtures)
  } finally {
    rmSync(fixtures.dir, { recursive: true, force: true })
  }
  console.info('[runtime-acceptance-strict] passed')
}

try {
  main()
} catch (error) {
  console.error(`[runtime-acceptance-strict] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
