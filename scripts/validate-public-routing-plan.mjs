#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const PROBE_SCRIPT = 'scripts/probe-public-routing.mjs'
const PRINT_PLAN_SCRIPT = 'scripts/print-public-routing-plan.mjs'

function runScript(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${output}`)
  }
  return output
}

function runProbePlan(args) {
  return runScript(PROBE_SCRIPT, ['--print-plan', ...args])
}

function runPrintablePlan(args) {
  return runScript(PRINT_PLAN_SCRIPT, args)
}

function runExpectedFailure(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status === 0) {
    throw new Error(`${script} was expected to fail but exited 0:\n${output}`)
  }
  return output
}

function runProcess(script, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...options.env
      }
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (status) => {
      resolve({
        status,
        output: `${stdout}${stderr}`
      })
    })
  })
}

async function runExpectedFailureAsync(script, args, options = {}) {
  const result = await runProcess(script, args, options)
  if (result.status === 0) {
    throw new Error(`${script} was expected to fail but exited 0:\n${result.output}`)
  }
  return result.output
}

function lineFor(output, label) {
  return output
    .split(/\r?\n/)
    .find(line => line.includes(`[public-routing-plan] ${label}:`)) || ''
}

function lineStartingWith(output, prefix) {
  return output
    .split(/\r?\n/)
    .find(line => line.startsWith(prefix)) || ''
}

function isARecordLine(line) {
  return /^\S+\s+A\s+\d{1,3}(?:\.\d{1,3}){3}\b/.test(line)
}

function requireIncludes(value, needle, label) {
  if (!value.includes(needle)) {
    throw new Error(`${label} must include ${JSON.stringify(needle)}\n${value}`)
  }
}

function forbidIncludes(value, needle, label) {
  if (value.includes(needle)) {
    throw new Error(`${label} must not include ${JSON.stringify(needle)}\n${value}`)
  }
}

function assertExpectedServerIpPlan() {
  const output = runProbePlan(['--expected-server-ip', '8.130.81.31'])
  const platformProd = lineFor(output, 'platform-prod')
  const platformDev = lineFor(output, 'platform-dev')
  const consoleProd = lineFor(output, 'console-prod')
  const consoleTest = lineFor(output, 'console-test')

  requireIncludes(platformProd, 'expectedIps=8.130.81.31', 'platform-prod expected-server-ip plan')
  requireIncludes(platformDev, 'expectedIps=8.130.81.31', 'platform-dev expected-server-ip plan')
  requireIncludes(consoleTest, 'expectedIps=8.130.81.31', 'console-test expected-server-ip plan')
  requireIncludes(consoleProd, 'expectedIps=<none>', 'console-prod expected-server-ip plan')
  requireIncludes(platformProd, 'forbidCloudflare=true', 'platform-prod expected-server-ip plan')
  requireIncludes(platformDev, 'forbidCloudflare=true', 'platform-dev expected-server-ip plan')
  requireIncludes(consoleProd, 'forbidCloudflare=false', 'console-prod expected-server-ip plan')
  forbidIncludes(consoleProd, 'expectedIps=8.130.81.31', 'console-prod expected-server-ip plan')

  console.info('[public-routing-plan] expected-server-ip domestic-only plan passed')
}

function assertExpectedIpPlan() {
  const output = runProbePlan(['--expected-ip', '8.130.81.31'])
  for (const label of ['platform-prod', 'platform-dev', 'console-prod', 'console-test']) {
    requireIncludes(lineFor(output, label), 'expectedIps=8.130.81.31', `${label} expected-ip plan`)
  }

  console.info('[public-routing-plan] expected-ip all-target plan passed')
}

function assertPrintableCloudflarePlan() {
  const output = runPrintablePlan(['--server-ip', '8.130.81.31', '--console-prod-cloudflare'])
  const consoleProdLine = lineStartingWith(output, 'console.huizhi.yun')

  requireIncludes(output, 'console.huizhi.yun', 'printable Cloudflare plan')
  requireIncludes(output, 'platform.wiztek.cn', 'printable Cloudflare plan')
  requireIncludes(output, 'platform-dev.wiztek.cn', 'printable Cloudflare plan')
  requireIncludes(output, 'hzy-test.wiztek.cn', 'printable Cloudflare plan')
  requireIncludes(output, 'A     8.130.81.31', 'printable Cloudflare plan')
  requireIncludes(consoleProdLine, 'managed by Cloudflare Worker route/custom domain', 'printable Cloudflare plan console-prod line')
  requireIncludes(output, 'console-test-only.conf', 'printable Cloudflare plan')
  requireIncludes(output, 'pnpm run probe:public-routing -- --expected-server-ip-env HZY_SERVER_PUBLIC_IP --console-prod-cloudflare', 'printable Cloudflare plan')
  requireIncludes(output, 'Server upstream checks', 'printable Cloudflare plan')
  requireIncludes(output, 'pnpm run probe:server-upstreams -- --console-prod-cloudflare', 'printable Cloudflare plan')
  requireIncludes(output, 'pm2 describe hzy-platform-prod', 'printable Cloudflare plan')
  requireIncludes(output, "ss -ltnp | grep ':3010 '", 'printable Cloudflare plan')
  requireIncludes(output, 'pm2 describe hzy-platform-dev', 'printable Cloudflare plan')
  requireIncludes(output, 'pm2 describe hzy-console-test', 'printable Cloudflare plan')
  forbidIncludes(output, 'pm2 describe hzy-console-prod', 'printable Cloudflare plan')
  requireIncludes(output, 'TLS certificate checks', 'printable Cloudflare plan')
  requireIncludes(output, 'subjectAltName containing the matching hostname', 'printable Cloudflare plan')
  requireIncludes(output, 'openssl s_client -connect platform.wiztek.cn:443 -servername platform.wiztek.cn', 'printable Cloudflare plan')
  requireIncludes(output, 'openssl s_client -connect platform-dev.wiztek.cn:443 -servername platform-dev.wiztek.cn', 'printable Cloudflare plan')
  requireIncludes(output, 'openssl s_client -connect hzy-test.wiztek.cn:443 -servername hzy-test.wiztek.cn', 'printable Cloudflare plan')
  forbidIncludes(output, 'openssl s_client -connect console.huizhi.yun:443 -servername console.huizhi.yun', 'printable Cloudflare plan')
  if (isARecordLine(consoleProdLine)) {
    throw new Error(`printable Cloudflare plan console-prod line must not be a DNS A record\n${consoleProdLine}`)
  }

  console.info('[public-routing-plan] printable Cloudflare DNS/Nginx plan passed')
}

function assertPrintablePm2Plan() {
  const output = runPrintablePlan(['--server-ip', '8.130.81.31'])
  const consoleProdLine = lineStartingWith(output, 'hzy.wiztek.cn')

  if (!isARecordLine(consoleProdLine)) {
    throw new Error(`printable PM2 plan console-prod line must be a DNS A record\n${consoleProdLine}`)
  }
  requireIncludes(consoleProdLine, '8.130.81.31', 'printable PM2 plan console-prod line')
  requireIncludes(output, 'console-wiztek.conf', 'printable PM2 plan')
  requireIncludes(output, 'pnpm run probe:public-routing -- --expected-ip-env HZY_SERVER_PUBLIC_IP', 'printable PM2 plan')
  requireIncludes(output, 'Server upstream checks', 'printable PM2 plan')
  requireIncludes(output, 'pnpm run probe:server-upstreams', 'printable PM2 plan')
  forbidIncludes(output, 'pnpm run probe:server-upstreams -- --console-prod-cloudflare', 'printable PM2 plan')
  requireIncludes(output, 'pm2 describe hzy-console-prod', 'printable PM2 plan')
  requireIncludes(output, "ss -ltnp | grep ':3030 '", 'printable PM2 plan')
  requireIncludes(output, 'TLS certificate checks', 'printable PM2 plan')
  requireIncludes(output, 'openssl s_client -connect hzy.wiztek.cn:443 -servername hzy.wiztek.cn', 'printable PM2 plan')

  console.info('[public-routing-plan] printable PM2 DNS/Nginx plan passed')
}

function generateWrongHostnameCertificate(tempDir) {
  const configPath = join(tempDir, 'openssl-san.cnf')
  const keyPath = join(tempDir, 'wrong-host.key')
  const certPath = join(tempDir, 'wrong-host.crt')
  writeFileSync(configPath, [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3_req',
    'prompt = no',
    '',
    '[dn]',
    'CN = wrong.localhost',
    '',
    '[v3_req]',
    'subjectAltName = DNS:wrong.localhost',
    'basicConstraints = critical,CA:true',
    'keyUsage = digitalSignature,keyEncipherment,keyCertSign',
    'extendedKeyUsage = serverAuth',
    ''
  ].join('\n'), 'utf8')

  const result = spawnSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-config',
    configPath
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.error) {
    throw new Error(`openssl failed to start for TLS fixture certificate generation: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`openssl failed to generate TLS fixture certificate:\n${result.stdout || ''}${result.stderr || ''}`)
  }

  return { certPath, keyPath }
}

function startHttpsFixture({ certPath, keyPath }) {
  const server = createHttpsServer({
    cert: readFileSync(certPath),
    key: readFileSync(keyPath)
  }, (_request, response) => {
    response.writeHead(200, {
      server: 'hzy-public-routing-tls-fixture'
    })
    response.end('ok')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('TLS fixture server did not return a TCP address'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

function startHttpStatusFixture(statusCode) {
  const server = createHttpServer((_request, response) => {
    response.writeHead(statusCode, {
      server: 'hzy-public-routing-http-fixture'
    })
    response.end(`status ${statusCode}`)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('HTTP fixture server did not return a TCP address'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function assertProbeTlsRepairHints() {
  const tempDir = mkdtempSync(join(tmpdir(), 'hzy-public-routing-tls-'))
  let fixtureServer
  try {
    const certificate = generateWrongHostnameCertificate(tempDir)
    const fixture = await startHttpsFixture(certificate)
    fixtureServer = fixture.server
    const fixtureUrl = `https://127.0.0.1:${fixture.port}`
    const output = await runExpectedFailureAsync(PROBE_SCRIPT, [
      '--platform-prod-url',
      fixtureUrl,
      '--platform-dev-url',
      fixtureUrl,
      '--console-prod-url',
      fixtureUrl,
      '--console-test-url',
      fixtureUrl,
      '--timeout-ms',
      '1000'
    ], {
      env: {
        NODE_EXTRA_CA_CERTS: certificate.certPath
      }
    })

    requireIncludes(output, 'ERR_TLS_CERT_ALTNAME_INVALID', 'public routing probe TLS repair hint')
    requireIncludes(output, 'hint=issue/install a TLS certificate whose subjectAltName covers 127.0.0.1, then reload Nginx', 'public routing probe TLS repair hint')
  } finally {
    if (fixtureServer) await closeServer(fixtureServer)
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.info('[public-routing-plan] public routing probe TLS repair hints passed')
}

async function assertProbeHttpStatusRepairHints() {
  const fixture = await startHttpStatusFixture(502)
  try {
    const fixtureUrl = `http://127.0.0.1:${fixture.port}`
    const output = await runExpectedFailureAsync(PROBE_SCRIPT, [
      '--platform-prod-url',
      fixtureUrl,
      '--platform-dev-url',
      fixtureUrl,
      '--console-prod-url',
      fixtureUrl,
      '--console-test-url',
      fixtureUrl,
      '--timeout-ms',
      '1000'
    ])

    requireIncludes(output, 'platform-prod returned HTTP 502', 'public routing probe HTTP status repair hint')
    requireIncludes(output, 'check PM2 process hzy-platform-prod is online, listening on 127.0.0.1:3010', 'public routing probe HTTP status repair hint')
    requireIncludes(output, 'next=on the PM2/Nginx server run pnpm run probe:server-upstreams', 'public routing probe HTTP status repair hint')
    requireIncludes(output, 'console-test returned HTTP 502', 'public routing probe HTTP status repair hint')
    requireIncludes(output, 'check PM2 process hzy-console-test is online, listening on 127.0.0.1:3031', 'public routing probe HTTP status repair hint')

    const cloudflareOutput = await runExpectedFailureAsync(PROBE_SCRIPT, [
      '--console-prod-cloudflare',
      '--platform-prod-url',
      fixtureUrl,
      '--platform-dev-url',
      fixtureUrl,
      '--console-prod-url',
      fixtureUrl,
      '--console-test-url',
      fixtureUrl,
      '--timeout-ms',
      '1000'
    ])
    requireIncludes(cloudflareOutput, 'next=on the PM2/Nginx server run pnpm run probe:server-upstreams -- --console-prod-cloudflare', 'public routing probe HTTP status Cloudflare repair hint')
  } finally {
    await closeServer(fixture.server)
  }

  console.info('[public-routing-plan] public routing probe HTTP status repair hints passed')
}

function assertProbeDnsRepairHints() {
  const tempDir = mkdtempSync(join(tmpdir(), 'hzy-public-routing-plan-'))
  try {
    const missingFixture = join(tempDir, 'dns-missing.json')
    writeFileSync(missingFixture, JSON.stringify({
      'platform.wiztek.cn': [],
      'platform-dev.wiztek.cn': ['8.130.81.31'],
      'hzy-test.wiztek.cn': ['8.130.81.31'],
      'hzy.wiztek.cn': ['203.0.113.10']
    }), 'utf8')

    const missingOutput = runExpectedFailure(PROBE_SCRIPT, [
      '--expected-server-ip',
      '8.130.81.31',
      '--dns-fixture-file',
      missingFixture,
      '--skip-http'
    ])
    requireIncludes(missingOutput, 'DNS has no A/AAAA records for platform.wiztek.cn', 'public routing probe missing DNS repair hint')
    requireIncludes(missingOutput, 'add DNS A record platform.wiztek.cn -> 8.130.81.31 for platform-prod', 'public routing probe missing DNS repair hint')

    const mismatchFixture = join(tempDir, 'dns-mismatch.json')
    writeFileSync(mismatchFixture, JSON.stringify({
      'platform.wiztek.cn': ['203.0.113.10'],
      'platform-dev.wiztek.cn': ['8.130.81.31'],
      'hzy-test.wiztek.cn': ['8.130.81.31'],
      'hzy.wiztek.cn': ['203.0.113.10']
    }), 'utf8')

    const mismatchOutput = runExpectedFailure(PROBE_SCRIPT, [
      '--expected-server-ip',
      '8.130.81.31',
      '--dns-fixture-file',
      mismatchFixture,
      '--skip-http'
    ])
    requireIncludes(mismatchOutput, 'DNS does not include expected IP 8.130.81.31; got 203.0.113.10', 'public routing probe DNS mismatch repair hint')
    requireIncludes(mismatchOutput, 'add DNS A record platform.wiztek.cn -> 8.130.81.31 for platform-prod', 'public routing probe DNS mismatch repair hint')

    const unsafeFixtureOutput = runExpectedFailure(PROBE_SCRIPT, [
      '--expected-server-ip',
      '8.130.81.31',
      '--dns-fixture-file',
      mismatchFixture
    ])
    requireIncludes(unsafeFixtureOutput, '--dns-fixture-file is only for offline verifier tests and must be combined with --skip-http', 'public routing probe DNS fixture safety')

    const refusedOutput = runExpectedFailure(PROBE_SCRIPT, [
      '--platform-prod-url',
      'http://127.0.0.1:1',
      '--platform-dev-url',
      'http://127.0.0.1:1',
      '--console-prod-url',
      'http://127.0.0.1:1',
      '--console-test-url',
      'http://127.0.0.1:1',
      '--timeout-ms',
      '1000'
    ])
    requireIncludes(refusedOutput, 'platform-prod HTTP probe failed for http://127.0.0.1:1 (dns=127.0.0.1): fetch failed', 'public routing probe HTTP failure labels')
    requireIncludes(refusedOutput, 'console-test HTTP probe failed for http://127.0.0.1:1 (dns=127.0.0.1): fetch failed', 'public routing probe HTTP failure labels')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  console.info('[public-routing-plan] public routing probe DNS repair hints passed')
}

async function main() {
  assertExpectedServerIpPlan()
  assertExpectedIpPlan()
  assertPrintableCloudflarePlan()
  assertPrintablePm2Plan()
  assertProbeDnsRepairHints()
  await assertProbeTlsRepairHints()
  await assertProbeHttpStatusRepairHints()
  console.info('[public-routing-plan] passed')
}

main().catch((error) => {
  console.error(`[public-routing-plan] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
