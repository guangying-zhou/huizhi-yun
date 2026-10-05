#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE_ROOT = resolve(WORKSPACE_ROOT, 'scripts/fixtures/authorization-boundaries')
const ACTIVE_MODULES = ['aims', 'altoc', 'assets', 'codocs', 'finance', 'people', 'workflow', 'webdev']
const LEGACY_REPORT_ONLY_MODULES = ['align']
const SOURCE_DIRECTORIES = ['app', 'server']
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.mjs', '.ts', '.vue'])
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.nuxt',
  '.output',
  'coverage',
  'dist',
  'node_modules',
  'test',
  'tests',
  '__tests__'
])

const POLICY_BUNDLE_AUTH_FIELDS = [
  'assignmentScopes',
  'baselineGrants',
  'baselinePermissions',
  'roleAssignments',
  'roleDefaultScopes',
  'rolePermissionGrants',
  'rolePermissions',
  'roleScopes',
  'subjectMemberships',
  'subjectRoleScopes',
  'subjectRoles',
  'templateBindings',
  'templateOverrides'
]
const POLICY_FIELD_PATTERN = POLICY_BUNDLE_AUTH_FIELDS.join('|')

function usage() {
  return `
Usage:
  node scripts/validate-authorization-boundaries.mjs
  node scripts/validate-authorization-boundaries.mjs --self-test

Scans active Foundation-based business modules for high-signal copies of
authorization infrastructure that belongs in Foundation:

  - direct parsing of Policy Bundle authorization projection fields;
  - direct role-mode / effective-role selection through @hzy/authz-core;
  - hand-written view/edit/admin action implication logic.

Aims, Altoc, Assets, Codocs, Finance, People, Workflow, and WebDev violations
fail the check. Align is deferred and reports the same findings as non-blocking
legacy warnings. Tests, generated output, dependency directories, manifests,
and permission catalogs are not scanned.
`
}

function parseArguments(argv) {
  let selfTest = false
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') {
      console.info(usage().trim())
      process.exit(0)
    }
    if (argument === '--self-test') {
      selfTest = true
      continue
    }
    throw new Error(`unknown argument: ${argument}`)
  }
  return { selfTest }
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return []

  const files = []
  const pending = [directory]
  while (pending.length > 0) {
    const current = pending.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(resolve(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue
      if (/\.(?:spec|test)\.[^.]+$/.test(entry.name)) continue
      const file = resolve(current, entry.name)
      if (/[\\/]app[\\/]config[\\/]permissions\.[^.]+$/.test(file)) continue
      files.push(file)
    }
  }
  return files.sort()
}

function firstMatch(content, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(content)
    if (match) return { index: match.index, text: match[0] }
  }
  return null
}

function policyBundleParserMatch(content) {
  return firstMatch(content, [
    new RegExp(`\\b(?:bundle|bundlePayload|payload|policyPayload)\\s*(?:\\?\\.|\\.)\\s*(?:${POLICY_FIELD_PATTERN})\\b`),
    new RegExp(`\\b(?:bundle|bundlePayload|payload|policyPayload)\\s*\\[\\s*['\"](?:${POLICY_FIELD_PATTERN})['\"]\\s*\\]`),
    new RegExp(`\\bpreferredRecords\\s*\\([^,]+,\\s*['\"](?:${POLICY_FIELD_PATTERN})['\"]`),
    new RegExp(`\\{[^}]{0,240}\\b(?:${POLICY_FIELD_PATTERN})\\b[^}]{0,240}\\}\\s*=\\s*(?:bundle|bundlePayload|payload|policyPayload)\\b`, 's')
  ])
}

function roleSelectionMatch(content) {
  return firstMatch(content, [
    /import\s*\{[^}]*\b(?:resolveAuthorizationMode|selectEffectiveRoleCodes)\b[^}]*\}\s*from\s*['"]@hzy\/authz-core['"]/s,
    /\b(?:resolveAuthorizationMode|selectEffectiveRoleCodes)\s*\(/
  ])
}

function manualActionImplicationMatch(content) {
  return firstMatch(content, [
    /\b\w+\.includes\(\s*['"]edit['"]\s*\)\s*\|\|\s*\w+\.includes\(\s*['"]admin['"]\s*\)/,
    /\b(?:action|required|requiredAction)\s*===\s*['"]view['"][\s\S]{0,360}\b\w+\.includes\(\s*['"]admin['"]\s*\)/,
    /\b(?:granted|permission\.action)\s*===\s*(?:required|requiredAction)[\s\S]{0,240}\b(?:granted|permission\.action)\s*===\s*['"]admin['"][\s\S]{0,240}\b(?:required|requiredAction)\s*===\s*['"]view['"][\s\S]{0,160}\b(?:granted|permission\.action)\s*===\s*['"]edit['"]/
  ])
}

const RULES = [
  {
    id: 'policy-bundle-parser',
    message: 'business modules must not parse Policy Bundle authorization fields; use Foundation authorization adapters',
    match: policyBundleParserMatch
  },
  {
    id: 'role-selection',
    message: 'business modules must not select effective roles or authorization mode; delegate to Foundation',
    match: roleSelectionMatch
  },
  {
    id: 'manual-action-implication',
    message: 'business modules must not hand-code view/edit/admin implications; use the Foundation authorization result',
    match: manualActionImplicationMatch
  }
]

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r?\n/).length
}

function excerpt(content, index) {
  const lineStart = content.lastIndexOf('\n', index - 1) + 1
  const lineEnd = content.indexOf('\n', index)
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().replace(/\s+/g, ' ')
}

function scanModule(workspaceRoot, moduleName, severity) {
  const moduleRoot = resolve(workspaceRoot, moduleName)
  if (!existsSync(moduleRoot)) {
    return [{
      module: moduleName,
      file: moduleName,
      line: 1,
      rule: 'module-missing',
      message: `expected module directory is missing: ${moduleName}`,
      excerpt: '',
      severity
    }]
  }

  const files = SOURCE_DIRECTORIES.flatMap(sourceDirectory => sourceFiles(resolve(moduleRoot, sourceDirectory)))
  const findings = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const rule of RULES) {
      const match = rule.match(content)
      if (!match) continue
      findings.push({
        module: moduleName,
        file: relative(workspaceRoot, file).split(sep).join('/'),
        line: lineNumber(content, match.index),
        rule: rule.id,
        message: rule.message,
        excerpt: excerpt(content, match.index),
        severity
      })
    }
  }
  return findings
}

function scanWorkspace(workspaceRoot, options = {}) {
  const activeModules = options.activeModules || ACTIVE_MODULES
  const legacyModules = options.legacyModules || LEGACY_REPORT_ONLY_MODULES
  const findings = [
    ...activeModules.flatMap(moduleName => scanModule(workspaceRoot, moduleName, 'error')),
    ...legacyModules.flatMap(moduleName => scanModule(workspaceRoot, moduleName, 'warning'))
  ]
  return {
    errors: findings.filter(finding => finding.severity === 'error'),
    warnings: findings.filter(finding => finding.severity === 'warning')
  }
}

function findingText(finding) {
  const snippet = finding.excerpt ? ` :: ${finding.excerpt}` : ''
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}${snippet}`
}

function report(result, sourceLabel) {
  console.info(`[authorization-boundaries] source: ${sourceLabel}`)
  console.info(`[authorization-boundaries] active modules: ${ACTIVE_MODULES.join(', ')}`)
  console.info(`[authorization-boundaries] legacy report-only modules: ${LEGACY_REPORT_ONLY_MODULES.join(', ')}`)

  if (result.warnings.length > 0) {
    console.warn('[authorization-boundaries] legacy warnings (non-blocking):')
    for (const warning of result.warnings) console.warn(`  - ${findingText(warning)}`)
  }

  if (result.errors.length > 0) {
    console.error('[authorization-boundaries] failed:')
    for (const error of result.errors) console.error(`  - ${findingText(error)}`)
    return false
  }

  console.info(`[authorization-boundaries] passed (${result.warnings.length} legacy warning${result.warnings.length === 1 ? '' : 's'})`)
  return true
}

function runSelfTest() {
  const scenarios = [
    { name: 'pass-foundation-helper', module: 'aims', errors: 0, warnings: 0 },
    { name: 'fail-policy-bundle-parser', module: 'finance', errors: 1, warnings: 0, rule: 'policy-bundle-parser' },
    { name: 'fail-role-selection', module: 'altoc', errors: 1, warnings: 0, rule: 'role-selection' },
    { name: 'fail-action-implication', module: 'assets', errors: 1, warnings: 0, rule: 'manual-action-implication' },
    { name: 'pass-align-legacy', legacyModule: 'align', errors: 0, warnings: 1, rule: 'manual-action-implication' }
  ]

  const failures = []
  for (const scenario of scenarios) {
    const scenarioRoot = resolve(FIXTURE_ROOT, scenario.name)
    if (!existsSync(scenarioRoot)) {
      failures.push(`${scenario.name}: fixture directory is missing`)
      continue
    }
    const result = scanWorkspace(scenarioRoot, {
      activeModules: scenario.module ? [scenario.module] : [],
      legacyModules: scenario.legacyModule ? [scenario.legacyModule] : []
    })
    const ruleFindings = [...result.errors, ...result.warnings]
    const matchesExpectation = result.errors.length === scenario.errors
      && result.warnings.length === scenario.warnings
      && (!scenario.rule || ruleFindings.some(finding => finding.rule === scenario.rule))
    console.info(`[authorization-boundaries:self-test] ${scenario.name}: errors=${result.errors.length}, warnings=${result.warnings.length} (${matchesExpectation ? 'ok' : 'mismatch'})`)
    if (!matchesExpectation) {
      failures.push(`${scenario.name}: expected errors=${scenario.errors}, warnings=${scenario.warnings}${scenario.rule ? `, rule=${scenario.rule}` : ''}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`fixture expectations failed:\n  - ${failures.join('\n  - ')}`)
  }
  console.info(`[authorization-boundaries:self-test] passed (${scenarios.length} scenarios)`)
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.selfTest) {
    runSelfTest()
    return
  }

  const result = scanWorkspace(WORKSPACE_ROOT)
  if (!report(result, WORKSPACE_ROOT)) process.exitCode = 1
}

try {
  main()
} catch (error) {
  console.error(`[authorization-boundaries] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
