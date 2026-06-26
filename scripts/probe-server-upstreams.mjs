#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const TARGETS = {
  platformProd: {
    label: 'platform-prod',
    pm2Name: 'hzy-platform-prod',
    host: '127.0.0.1',
    port: '3010'
  },
  platformDev: {
    label: 'platform-dev',
    pm2Name: 'hzy-platform-dev',
    host: '127.0.0.1',
    port: '3011'
  },
  consoleProd: {
    label: 'console-prod',
    pm2Name: 'hzy-console-prod',
    host: '127.0.0.1',
    port: '3030'
  },
  consoleTest: {
    label: 'console-test',
    pm2Name: 'hzy-console-test',
    host: '127.0.0.1',
    port: '3031'
  }
}

function usage() {
  return `
Usage:
  pnpm run probe:server-upstreams

  # If console-prod runs on Cloudflare and is not a PM2 process on this server:
  pnpm run probe:server-upstreams -- --console-prod-cloudflare

Checks the PM2 processes and loopback upstream URLs that Nginx should proxy to.
Run this on the PM2/Nginx server when public routing returns 502/503/504.

Offline verifier maintenance only:
  pnpm run probe:server-upstreams -- --console-prod-cloudflare \\
    --pm2-jlist-file scripts/fixtures/pm2-jlist-runtime-isolation.json --skip-http
`
}

function parseArgs(argv) {
  const args = {
    consoleProdCloudflare: false,
    skipHttp: false,
    timeoutMs: 5000
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (item === '--console-prod-cloudflare') {
      args.consoleProdCloudflare = true
      continue
    }
    if (item === '--skip-http') {
      args.skipHttp = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (name === 'pm2-jlist-file') {
      args.pm2JlistFile = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'timeout-ms') {
      const parsed = Number.parseInt(requiredValue(name, value), 10)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--timeout-ms must be a positive integer')
      args.timeoutMs = parsed
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function requiredValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for --${name}`)
  }
  return value
}

function readPm2List(path) {
  if (path) {
    if (!existsSync(path)) throw new Error(`pm2 jlist fixture not found: ${path}`)
    return JSON.parse(readFileSync(path, 'utf8'))
  }

  const result = spawnSync('pm2', ['jlist'], {
    cwd: process.cwd(),
    encoding: 'utf8'
  })
  if (result.error) {
    throw new Error(`pm2 jlist failed to start: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`pm2 jlist failed:\n${result.stdout || ''}${result.stderr || ''}`)
  }
  return JSON.parse(result.stdout || '[]')
}

function targetList(args) {
  return [
    TARGETS.platformProd,
    TARGETS.platformDev,
    ...(args.consoleProdCloudflare ? [] : [TARGETS.consoleProd]),
    TARGETS.consoleTest
  ]
}

function printNextSteps(args) {
  console.info('[server-upstreams] upstreams are reachable from this server')
  console.info('[server-upstreams] next if public routing still returns 502/503/504:')
  if (args.consoleProdCloudflare) {
    console.info('  pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf --console-test-only-conf /etc/nginx/conf.d/console-wiztek.conf')
  } else {
    console.info('  pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf --console-conf /etc/nginx/conf.d/console-wiztek.conf')
  }
  console.info('  sudo nginx -t')
  console.info('  sudo systemctl reload nginx')
  console.info('  pnpm run probe:public-routing -- --expected-ip 8.130.81.31')
}

function pm2EnvValue(processInfo, ...keys) {
  const env = processInfo?.pm2_env || {}
  for (const key of keys) {
    const value = String(env[key] || '').trim()
    if (value) return value
  }
  return ''
}

function expectedUrl(target) {
  return `http://${target.host}:${target.port}`
}

async function fetchReachability(url, timeoutMs) {
  const head = await fetchHttp(url, 'HEAD', timeoutMs)
  if (![405, 501].includes(head.status)) return head

  return fetchHttp(url, 'GET', timeoutMs)
}

async function fetchHttp(url, method, timeoutMs) {
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs)
  })
  await response.body?.cancel().catch(() => {})

  return {
    method,
    status: response.status,
    server: response.headers.get('server') || '',
    location: response.headers.get('location') || ''
  }
}

async function probeTarget(target, pm2List, args) {
  const failures = []
  const processInfo = pm2List.find(item => item?.name === target.pm2Name)
  if (!processInfo) {
    failures.push(`${target.label} missing PM2 process ${target.pm2Name}`)
  } else {
    const status = pm2EnvValue(processInfo, 'status') || '<unknown>'
    if (status !== 'online') {
      failures.push(`${target.label} PM2 process ${target.pm2Name} is ${status}, expected online`)
    }
    const host = pm2EnvValue(processInfo, 'HOST', 'NITRO_HOST')
    const port = pm2EnvValue(processInfo, 'PORT', 'NITRO_PORT')
    if (host && host !== target.host) {
      failures.push(`${target.label} PM2 ${target.pm2Name} host is ${host}, expected ${target.host}`)
    }
    if (port && port !== target.port) {
      failures.push(`${target.label} PM2 ${target.pm2Name} port is ${port}, expected ${target.port}`)
    }
  }

  if (args.skipHttp) {
    if (failures.length) throw new Error(failures.join('\n  - '))
    console.info(`[server-upstreams] ${target.label}: pm2=${target.pm2Name}, upstream=${expectedUrl(target)}, http=skipped`)
    return
  }

  let http
  try {
    http = await fetchReachability(expectedUrl(target), args.timeoutMs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${target.label} upstream ${expectedUrl(target)} is not reachable: ${message}`)
  }

  if (http && (http.status === 404 || http.status >= 500)) {
    failures.push(`${target.label} upstream ${expectedUrl(target)} returned HTTP ${http.status}`)
  }

  if (failures.length) throw new Error(failures.join('\n  - '))

  console.info(`[server-upstreams] ${target.label}: pm2=${target.pm2Name}, upstream=${expectedUrl(target)}, http=${http.status}/${http.method}, server=${http.server || '<none>'}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  const pm2List = readPm2List(args.pm2JlistFile)
  const failures = []
  for (const target of targetList(args)) {
    try {
      await probeTarget(target, pm2List, args)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (failures.length) {
    throw new Error(failures.join('\n  - '))
  }

  console.info('[server-upstreams] passed')
  printNextSteps(args)
}

main().catch((error) => {
  console.error(`[server-upstreams] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
