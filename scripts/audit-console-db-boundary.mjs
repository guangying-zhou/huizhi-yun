#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const consoleRoot = resolve(root, 'console')
const serverRoot = resolve(consoleRoot, 'server')

const excludedSegments = new Set([
  '.git',
  '.nuxt',
  '.output',
  'coverage',
  'node_modules',
  'test',
  'tests'
])

const dbImportPattern = /from\s+['"](?:~~\/server\/utils\/db|@\/server\/utils\/db|(?:\.\.\/)*utils\/db|\.\/db)['"]/u
const dbHelperPattern = /\b(useDbPool|queryRows|queryRow|execute|withTransaction)\b/u

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (excludedSegments.has(entry.name)) continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile() && /\.(?:ts|mts|cts)$/u.test(entry.name)) files.push(path)
  }
  return files
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function classifyDomain(path) {
  const normalized = path.toLowerCase()
  const rules = [
    ['auth-session-oidc', /auth|oidc|session|token|login/u],
    ['vault-service-identity', /vault|credential|service-client|service_client/u],
    ['directory-connector', /directory|connector/u],
    ['notification-operation', /notification|operation|actionable/u],
    ['integration', /integration/u],
    ['org-settings-calendar', /org|company|businessdomain|region|setting|calendar|dictionar/u],
    ['runtime-bootstrap', /runtime|bootstrap|activation/u],
    ['audit', /audit|log/u]
  ]
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0] || 'other-console'
}

function classifyRisk(domain) {
  if (['auth-session-oidc', 'vault-service-identity', 'directory-connector'].includes(domain)) return 'critical'
  if (['notification-operation', 'integration', 'audit'].includes(domain)) return 'high'
  return 'medium'
}

function analyze(path, source) {
  const reads = count(source, /\b(?:queryRows|queryRow)\s*(?:<[\s\S]*?>)?\s*\(/gu)
  const writes = count(source, /(?<!\.)\bexecute\s*(?:<[\s\S]*?>)?\s*\(|\.\s*execute\s*(?:<[\s\S]*?>)?\s*\(/gu)
  const transactions = count(source, /\bwithTransaction\s*\(/gu)
  const pools = count(source, /\buseDbPool\s*\(/gu)
  const domain = classifyDomain(path)
  return {
    file: relative(root, path),
    domain,
    risk: classifyRisk(domain),
    mode: writes > 0 || transactions > 0 ? (reads > 0 ? 'read-write' : 'write') : 'read',
    reads,
    writes,
    transactions,
    pools,
    callSites: reads + writes + transactions + pools
  }
}

const files = await walk(serverRoot)
const findings = []
for (const path of files) {
  if (path === resolve(serverRoot, 'utils/db.ts')) continue
  const source = await readFile(path, 'utf8')
  if (!dbImportPattern.test(source) && !dbHelperPattern.test(source)) continue
  if (!dbImportPattern.test(source)) continue
  findings.push(analyze(path, source))
}
findings.sort((left, right) => left.file.localeCompare(right.file))

const summary = findings.reduce((value, finding) => {
  value.files += 1
  value.callSites += finding.callSites
  value.reads += finding.reads
  value.writes += finding.writes
  value.transactions += finding.transactions
  value.pools += finding.pools
  value.domains[finding.domain] = (value.domains[finding.domain] || 0) + 1
  return value
}, { files: 0, callSites: 0, reads: 0, writes: 0, transactions: 0, pools: 0, domains: {} })

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), summary, findings }, null, 2)}\n`)
  process.exit(0)
}

console.log('# Console direct database boundary audit')
console.log('')
console.log(`- Production files importing the DB helper: ${summary.files}`)
console.log(`- Static DB helper call sites: ${summary.callSites}`)
console.log(`- Reads: ${summary.reads}; writes: ${summary.writes}; transactions: ${summary.transactions}; direct pool access: ${summary.pools}`)
console.log('')
console.log('| File | Domain | Mode | Calls | Risk |')
console.log('| --- | --- | --- | ---: | --- |')
for (const finding of findings) {
  console.log(`| \`${finding.file}\` | ${finding.domain} | ${finding.mode} | ${finding.callSites} | ${finding.risk} |`)
}
