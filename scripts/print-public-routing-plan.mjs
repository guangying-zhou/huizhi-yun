#!/usr/bin/env node
import process from 'node:process'

const DOMAINS = {
  platformProd: 'platform.wiztek.cn',
  platformDev: 'platform-dev.wiztek.cn',
  consoleProdPm2: 'hzy.wiztek.cn',
  consoleProdCloudflare: 'console.huizhi.yun',
  consoleTest: 'hzy-test.wiztek.cn'
}

const UPSTREAMS = {
  platformProd: {
    label: 'platform-prod',
    pm2Name: 'hzy-platform-prod',
    port: '3010'
  },
  platformDev: {
    label: 'platform-dev',
    pm2Name: 'hzy-platform-dev',
    port: '3011'
  },
  consoleProd: {
    label: 'console-prod',
    pm2Name: 'hzy-console-prod',
    port: '3030'
  },
  consoleTest: {
    label: 'console-test',
    pm2Name: 'hzy-console-test',
    port: '3031'
  }
}

function usage() {
  return `
Usage:
  pnpm run plan:public-routing -- --server-ip 8.130.81.31
  pnpm run plan:public-routing -- --server-ip-env HZY_SERVER_PUBLIC_IP

  # If console-prod stays on Cloudflare Worker and only console-test runs on PM2:
  pnpm run plan:public-routing -- --server-ip 8.130.81.31 --console-prod-cloudflare

Prints the DNS, Nginx, certificate and verification commands for the current
Platform / Console prod-test isolation rollout. It does not mutate anything.
`
}

function parseArgs(argv) {
  const args = {
    consoleProdCloudflare: false,
    ttl: '600'
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
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]

    if (name === 'server-ip') {
      args.serverIp = requiredValue(name, value)
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'server-ip-env') {
      const envName = requiredValue(name, value)
      args.serverIp = String(process.env[envName] || '').trim()
      if (!args.serverIp) {
        throw new Error(`environment variable is empty: ${envName}`)
      }
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'ttl') {
      args.ttl = requiredValue(name, value)
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

function assertIp(value) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    throw new Error(`--server-ip must be an IPv4 address for DNS A records, got ${value || '<empty>'}`)
  }
  const parts = value.split('.').map(Number)
  if (parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`--server-ip has an invalid octet: ${value}`)
  }
}

function printRecord(domain, ip, ttl) {
  console.info(`${domain.padEnd(24)} A     ${ip.padEnd(15)} TTL ${ttl}`)
}

function certbotCommand(domain) {
  return `sudo certbot certonly --webroot -w /var/www/certbot -d ${domain}`
}

function tlsCheckCommand(domain) {
  return `echo | openssl s_client -connect ${domain}:443 -servername ${domain} 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName`
}

function consoleProdDomain(args) {
  return args.consoleProdCloudflare ? DOMAINS.consoleProdCloudflare : DOMAINS.consoleProdPm2
}

function certificateDomains(args) {
  return [
    DOMAINS.platformProd,
    DOMAINS.platformDev,
    DOMAINS.consoleTest,
    ...(args.consoleProdCloudflare ? [] : [consoleProdDomain(args)])
  ]
}

function upstreamTargets(args) {
  return [
    UPSTREAMS.platformProd,
    UPSTREAMS.platformDev,
    UPSTREAMS.consoleTest,
    ...(args.consoleProdCloudflare ? [] : [UPSTREAMS.consoleProd])
  ]
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }
  if (!args.serverIp) {
    throw new Error('--server-ip or --server-ip-env is required')
  }
  assertIp(args.serverIp)

  console.info('[public-routing-plan] DNS A records')
  console.info('Use DNS-only records for the PM2/Nginx targets; do not proxy these records through Cloudflare.')
  printRecord(DOMAINS.platformProd, args.serverIp, args.ttl)
  printRecord(DOMAINS.platformDev, args.serverIp, args.ttl)
  printRecord(DOMAINS.consoleTest, args.serverIp, args.ttl)
  if (args.consoleProdCloudflare) {
    console.info(`${consoleProdDomain(args).padEnd(24)} managed by Cloudflare Worker route/custom domain; do not add this PM2-server A record unless switching console-prod to PM2.`)
  } else {
    printRecord(consoleProdDomain(args), args.serverIp, args.ttl)
  }

  console.info('\n[public-routing-plan] Nginx templates')
  console.info('Platform: platform/deploy/nginx/platform-wiztek.conf before certs, platform-wiztek.ssl.conf after certs')
  if (args.consoleProdCloudflare) {
    console.info('Console: console/deploy/nginx/console-test-only.conf before certs, console-test-only.ssl.conf after certs')
  } else {
    console.info('Console: console/deploy/nginx/console-wiztek.conf before certs, console-wiztek.ssl.conf after certs')
  }

  console.info('\n[public-routing-plan] Server upstream checks')
  console.info('Run these on the PM2/Nginx server before public-routing strict verification.')
  console.info(`pnpm run probe:server-upstreams${args.consoleProdCloudflare ? ' -- --console-prod-cloudflare' : ''}`)
  for (const target of upstreamTargets(args)) {
    console.info(`pm2 describe ${target.pm2Name}`)
    console.info(`ss -ltnp | grep ':${target.port} '`)
  }

  console.info('\n[public-routing-plan] Certificate commands')
  for (const domain of certificateDomains(args)) {
    console.info(certbotCommand(domain))
  }

  console.info('\n[public-routing-plan] TLS certificate checks')
  console.info('Each command must show subjectAltName containing the matching hostname before strict public-routing can pass.')
  for (const domain of certificateDomains(args)) {
    console.info(tlsCheckCommand(domain))
  }

  console.info('\n[public-routing-plan] Verification')
  console.info(`HZY_SERVER_PUBLIC_IP=${args.serverIp} pnpm run probe:public-routing -- --expected-server-ip-env HZY_SERVER_PUBLIC_IP${args.consoleProdCloudflare ? ' --console-prod-cloudflare' : ''}`)
  if (!args.consoleProdCloudflare) {
    console.info(`# If console-prod is also PM2 on this server, use strict all-domain IP validation:`)
    console.info(`HZY_SERVER_PUBLIC_IP=${args.serverIp} pnpm run probe:public-routing -- --expected-ip-env HZY_SERVER_PUBLIC_IP`)
  }
}

main()
