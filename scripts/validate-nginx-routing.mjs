#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const PLATFORM_MAPPINGS = [
  ['platform.wiztek.cn', '3010'],
  ['platform-dev.wiztek.cn', '3011']
]
const CONSOLE_MAPPINGS = [
  ['hzy.wiztek.cn', '3030'],
  ['hzy-test.wiztek.cn', '3031']
]
const CONSOLE_TEST_ONLY_MAPPINGS = [
  ['hzy-test.wiztek.cn', '3031']
]

const TEMPLATE_FILES = [
  {
    path: 'platform/deploy/nginx/platform-wiztek.conf',
    ssl: false,
    requireCertbotCommands: true,
    mappings: PLATFORM_MAPPINGS
  },
  {
    path: 'platform/deploy/nginx/platform-wiztek.ssl.conf',
    ssl: true,
    mappings: PLATFORM_MAPPINGS
  },
  {
    path: 'console/deploy/nginx/console-wiztek.conf',
    ssl: false,
    requireCertbotCommands: true,
    mappings: CONSOLE_MAPPINGS
  },
  {
    path: 'console/deploy/nginx/console-wiztek.ssl.conf',
    ssl: true,
    mappings: CONSOLE_MAPPINGS
  },
  {
    path: 'console/deploy/nginx/console-test-only.conf',
    ssl: false,
    requireCertbotCommands: true,
    mappings: CONSOLE_TEST_ONLY_MAPPINGS,
    forbiddenDomains: ['hzy.wiztek.cn']
  },
  {
    path: 'console/deploy/nginx/console-test-only.ssl.conf',
    ssl: true,
    mappings: CONSOLE_TEST_ONLY_MAPPINGS,
    forbiddenDomains: ['hzy.wiztek.cn']
  }
]

function usage() {
  return `
Usage:
  pnpm run validate:nginx-routing
  pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf --console-conf /etc/nginx/conf.d/console-wiztek.conf
  pnpm run validate:nginx-routing -- --platform-conf /etc/nginx/conf.d/platform-wiztek.conf --console-test-only-conf /etc/nginx/conf.d/console-wiztek.conf

Checks tracked Nginx templates for the expected Platform/Console prod-dev-test domain to PM2 port mappings.
For Console, it validates both the full PM2 prod/test template and the test-only template used when console-prod runs on Cloudflare.
When --platform-conf / --console-conf / --console-test-only-conf is provided, it also checks the copied server config file paths without requiring template-only certbot comments. Run nginx -t on the target server after copying configs.
`
}

function parseArgs(argv) {
  const args = {
    files: [...TEMPLATE_FILES]
  }

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--') continue
    if (item === '--help' || item === '-h') {
      args.help = true
      continue
    }
    if (!item.startsWith('--')) continue

    const raw = item.slice(2)
    const equalsIndex = raw.indexOf('=')
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw
    const value = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`missing value for --${name}`)
    }

    if (name === 'platform-conf') {
      args.files.push({
        path: value,
        label: 'server platform config',
        mappings: PLATFORM_MAPPINGS
      })
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-conf') {
      args.files.push({
        path: value,
        label: 'server console prod/test config',
        mappings: CONSOLE_MAPPINGS
      })
      if (equalsIndex < 0) index += 1
      continue
    }

    if (name === 'console-test-only-conf') {
      args.files.push({
        path: value,
        label: 'server console test-only config',
        mappings: CONSOLE_TEST_ONLY_MAPPINGS,
        forbiddenDomains: ['hzy.wiztek.cn']
      })
      if (equalsIndex < 0) index += 1
      continue
    }

    throw new Error(`unknown option: --${name}`)
  }

  return args
}

function extractServerBlocks(content) {
  const blocks = []
  let searchFrom = 0

  while (searchFrom < content.length) {
    const match = /(^|\n)\s*server\s*\{/g.exec(content.slice(searchFrom))
    if (!match) break

    const start = searchFrom + match.index + match[0].lastIndexOf('{')
    let depth = 0
    let end = start

    for (; end < content.length; end += 1) {
      const char = content[end]
      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end += 1
          break
        }
      }
    }

    if (depth !== 0) {
      throw new Error('unbalanced server block braces')
    }

    blocks.push(content.slice(start, end))
    searchFrom = end
  }

  return blocks
}

function hasServerName(block, domain) {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\bserver_name\\b[^;]*\\b${escaped}\\b[^;]*;`).test(block)
}

function proxyPassPort(block) {
  const match = block.match(/\bproxy_pass\s+http:\/\/127\.0\.0\.1:(\d+);/)
  return match?.[1] || ''
}

function assertCertificateCommands(content, file) {
  const commands = content.match(/certbot\s+certonly[^\n]*/g) || []
  if (commands.length === 0) {
    throw new Error(`${file.path} missing certificate bootstrap commands`)
  }

  const configuredDomains = new Set()
  for (const command of commands) {
    const domains = [...command.matchAll(/\s-d\s+([^\s\\]+)/g)]
      .map((match) => match[1])
    if (domains.length > 1) {
      throw new Error(`${file.path} certbot command must create one certificate directory per domain: ${command}`)
    }
    for (const domain of domains) {
      configuredDomains.add(domain)
    }
  }

  for (const [domain] of file.mappings) {
    if (!configuredDomains.has(domain)) {
      throw new Error(`${file.path} missing certbot command for ${domain}`)
    }
  }
}

function assertTemplate(file) {
  const absolute = resolve(process.cwd(), file.path)
  if (!existsSync(absolute)) {
    throw new Error(`${file.path} does not exist`)
  }

  const content = readFileSync(absolute, 'utf8')
  const blocks = extractServerBlocks(content)
  if (blocks.length === 0) {
    throw new Error(`${file.path} has no server blocks`)
  }

  if (file.requireCertbotCommands) {
    assertCertificateCommands(content, file)
  }

  for (const domain of file.forbiddenDomains || []) {
    if (blocks.some((block) => hasServerName(block, domain))) {
      throw new Error(`${file.path} must not contain server_name for ${domain}`)
    }
  }

  for (const [domain, port] of file.mappings) {
    const matchingBlocks = blocks.filter((block) => hasServerName(block, domain))
    if (matchingBlocks.length === 0) {
      throw new Error(`${file.path} missing server_name for ${domain}`)
    }

    const proxiedBlock = matchingBlocks.find((block) => proxyPassPort(block))
    if (!proxiedBlock) {
      throw new Error(`${file.path} missing proxy_pass block for ${domain}`)
    }

    const actualPort = proxyPassPort(proxiedBlock)
    if (actualPort !== port) {
      throw new Error(`${file.path} routes ${domain} to 127.0.0.1:${actualPort}, expected 127.0.0.1:${port}`)
    }

    const unexpectedPorts = matchingBlocks
      .map(proxyPassPort)
      .filter((actual) => actual && actual !== port)
    if (unexpectedPorts.length > 0) {
      throw new Error(`${file.path} has conflicting proxy_pass for ${domain}: ${unexpectedPorts.join(', ')}`)
    }

    if (file.ssl === true) {
      const livePath = `/etc/letsencrypt/live/${domain}/`
      if (!proxiedBlock.includes(`${livePath}fullchain.pem`) || !proxiedBlock.includes(`${livePath}privkey.pem`)) {
        throw new Error(`${file.path} missing expected certificate paths for ${domain}`)
      }
    }
  }

  console.info(`[nginx-routing] ${file.label || file.path} passed (${file.path})`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.info(usage().trim())
    return
  }

  for (const file of args.files) {
    assertTemplate(file)
  }

  console.info('[nginx-routing] passed')
}

try {
  main()
} catch (error) {
  console.error(`[nginx-routing] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
