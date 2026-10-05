import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const apiV1Dir = resolve(rootDir, 'server/api/v1')
const serverUtilsDir = resolve(rootDir, 'server/utils')
const middlewarePath = resolve(rootDir, 'server/middleware/tenant-runtime.ts')
const middleware = readFileSync(middlewarePath, 'utf8')
const failures = []

const requiredForwardingSnippets = [
  ['dashboard reads', 'context.method === \'GET\' && context.suffix.startsWith(\'/dashboard\')'],
  ['tender resource', '\'/tenders\''],
  ['lead disqualify command', '^\\/leads\\/[^/]+\\/disqualify$'],
  ['lead convert command', '^\\/leads\\/[^/]+\\/convert$'],
  ['lead conversion preview', '^\\/leads\\/[^/]+\\/conversion-preview$'],
  ['lead conversion candidates', '^\\/leads\\/[^/]+\\/conversion-candidates$'],
  ['lead activity command', '^\\/leads\\/[^/]+\\/activities$'],
  ['opportunity transition command', '^\\/opportunities\\/[^/]+\\/transition$'],
  ['opportunity close-won command', '^\\/opportunities\\/[^/]+\\/close-won$'],
  ['opportunity close-lost command', '^\\/opportunities\\/[^/]+\\/close-lost$'],
  ['opportunity pause command', '^\\/opportunities\\/[^/]+\\/pause$'],
  ['opportunity reopen command', '^\\/opportunities\\/[^/]+\\/reopen$'],
  ['opportunity activity resource', '^\\/opportunities\\/[^/]+\\/activities$'],
  ['opportunity contact-role resource', '^\\/opportunities\\/[^/]+\\/contact-roles$'],
  ['opportunity contact-role record', '^\\/opportunities\\/[^/]+\\/contact-roles\\/[^/]+$'],
  ['config dict command', 'context.suffix === \'/config/dict\''],
  ['document collection read', 'context.suffix === \'/documents\''],
  ['document record read/delete', '^\\/documents\\/[^/]+$'],
  ['tender agency resource', 'context.suffix === \'/tenders/agencies\''],
  ['tender milestone resource', '^\\/tenders\\/[^/]+\\/milestones$'],
  ['tender member resource', '^\\/tenders\\/[^/]+\\/members$'],
  ['quotation approval command', '^\\/quotes\\/[^/]+\\/approve$'],
  ['quotation status command', '^\\/quotes\\/[^/]+\\/status$'],
  ['contract approval command', '^\\/contracts\\/[^/]+\\/approve$'],
  ['contract status command', '^\\/contracts\\/[^/]+\\/status$'],
  ['contract stage command', '^\\/contracts\\/[^/]+\\/stages$']
]

const requiredScopeSnippets = [
  ['config dict settings scope', '{ prefix: \'/config/dict\', resource: \'settings\' }'],
  ['dashboard view scope', '{ prefix: \'/dashboard\', resource: \'dashboard\' }'],
  ['tender quotation scope', '{ prefix: \'/tenders\', resource: \'quotation\' }'],
  ['document dynamic scope resolver', 'function documentRuntimeResource'],
  ['document tender quotation scope', 'entityType === \'quotation\' || entityType === \'tender\''],
  ['opportunity close-won transition scope', 'if (/^\\/opportunities\\/[^/]+\\/close-won$/.test(context.suffix)) return \'transition\''],
  ['opportunity close-lost transition scope', 'if (/^\\/opportunities\\/[^/]+\\/close-lost$/.test(context.suffix)) return \'transition\''],
  ['opportunity pause transition scope', 'if (/^\\/opportunities\\/[^/]+\\/pause$/.test(context.suffix)) return \'transition\''],
  ['opportunity reopen transition scope', 'if (/^\\/opportunities\\/[^/]+\\/reopen$/.test(context.suffix)) return \'transition\'']
]

const requiredLocalOrchestrationSnippets = [
  ['lead create local orchestration', 'apiPath === \'/api/v1/leads\''],
  ['opportunity create local orchestration', 'apiPath === \'/api/v1/opportunities\''],
  ['lead assign local orchestration', '^\\/api\\/v1\\/leads\\/[^/]+\\/assign$'],
  ['opportunity assign local orchestration', '^\\/api\\/v1\\/opportunities\\/[^/]+\\/assign$'],
  ['opportunity stale scan local orchestration', 'apiPath === \'/api/v1/opportunities/scan-stale\''],
  ['payment overdue scan local orchestration', 'apiPath === \'/api/v1/payments/scan-overdue\'']
]

const forbiddenForwardingSnippets = [
  ['lead assign direct runtime proxy', 'if (/^\\/leads\\/[^/]+\\/assign$/.test(context.suffix)) return context.method === \'POST\''],
  ['opportunity assign direct runtime proxy', 'if (/^\\/opportunities\\/[^/]+\\/assign$/.test(context.suffix)) return context.method === \'POST\'']
]

const forbiddenLocalWhitelistSnippets = [
  ['lead convert local fallback', '\\/api\\/v1\\/leads\\/[^/]+\\/convert'],
  ['lead conversion preview local fallback', '\\/api\\/v1\\/leads\\/[^/]+\\/conversion-preview'],
  ['lead conversion candidates local fallback', '\\/api\\/v1\\/leads\\/[^/]+\\/conversion-candidates'],
  ['lead activity local fallback', '\\/api\\/v1\\/leads\\/[^/]+\\/activities'],
  ['opportunity transition local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/transition'],
  ['opportunity close-won local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/close-won'],
  ['opportunity close-lost local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/close-lost'],
  ['opportunity pause local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/pause'],
  ['opportunity reopen local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/reopen'],
  ['opportunity activity local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/activities'],
  ['opportunity contact-role local fallback', '\\/api\\/v1\\/opportunities\\/[^/]+\\/contact-roles'],
  ['config dict local fallback', '\\/api\\/v1\\/config\\/dict'],
  ['tender agency local fallback', '\\/api\\/v1\\/tenders\\/agencies'],
  ['tender milestone local fallback', '\\/api\\/v1\\/tenders\\/[^/]+\\/milestones'],
  ['tender member local fallback', '\\/api\\/v1\\/tenders\\/[^/]+\\/members'],
  ['quotation approval local fallback', '\\/api\\/v1\\/quotes\\/[^/]+\\/approve'],
  ['quotation status local fallback', '\\/api\\/v1\\/quotes\\/[^/]+\\/status'],
  ['contract approval local fallback', '\\/api\\/v1\\/contracts\\/[^/]+\\/approve'],
  ['contract status local fallback', '\\/api\\/v1\\/contracts\\/[^/]+\\/status'],
  ['contract stage local fallback', '\\/api\\/v1\\/contracts\\/[^/]+\\/stages']
]

const allowedLocalApiFiles = [
  'server/api/v1/service/contracts/[contractCode]/activate-delivery.post.ts',
  'server/api/v1/teams/users.get.ts',
  'server/api/v1/customers/[customerCode]/maintenance-summary.get.ts',
  'server/api/v1/customers/[customerCode]/delivery-package.get.ts',
  'server/api/v1/customers/[customerCode]/maintenance-financial-summary.get.ts',
  'server/api/v1/service-tickets/[ticketCode]/aims-work-item.post.ts',
  'server/api/v1/receivable-plans/[code]/invoice-request.post.ts',
  'server/api/v1/contracts/[id]/invoice-request.post.ts',
  'server/api/v1/contracts/invoice-files/view.get.ts',
  'server/api/v1/contracts/[id]/management.post.ts',
  'server/api/v1/documents/index.post.ts',
  'server/api/v1/leads/index.post.ts',
  'server/api/v1/leads/[id]/assign.post.ts',
  'server/api/v1/opportunities/index.post.ts',
  'server/api/v1/opportunities/[id]/assign.post.ts',
  'server/api/v1/opportunities/scan-stale.post.ts',
  'server/api/v1/payments/scan-overdue.post.ts',
  'server/api/v1/config/industries.get.ts',
  'server/api/v1/config/regions.get.ts',
  'server/api/v1/documents/preview.get.ts'
]

const forbiddenSourceSnippets = [
  ['contract creation attachment upload', 'app/pages/contracts/new.vue', '/api/v1/attachments'],
  ['overdue scheduled local DB scan', 'server/tasks/overdue/scan.ts', 'scanAndMarkOverdue'],
  ['stale scheduled local DB scan', 'server/tasks/stale/scan.ts', 'scanAndNotifyStaleOpportunities']
]

const runtimeMigratedApiFiles = [
  'server/api/v1/attachments/index.get.ts',
  'server/api/v1/attachments/index.post.ts',
  'server/api/v1/audit-logs/index.get.ts',
  'server/api/v1/config/customer-levels.get.ts',
  'server/api/v1/config/customer-types.get.ts',
  'server/api/v1/config/dict.delete.ts',
  'server/api/v1/config/dict.post.ts',
  'server/api/v1/config/dict.put.ts',
  'server/api/v1/config/opportunity-stages.get.ts',
  'server/api/v1/config/payment-term-templates.get.ts',
  'server/api/v1/contracts/index.get.ts',
  'server/api/v1/contracts/index.post.ts',
  'server/api/v1/contracts/[id].get.ts',
  'server/api/v1/contracts/[id].put.ts',
  'server/api/v1/contracts/[id]/invoices.get.ts',
  'server/api/v1/contracts/[id]/stages.get.ts',
  'server/api/v1/contracts/[id]/stages.post.ts',
  'server/api/v1/customers/index.get.ts',
  'server/api/v1/customers/index.post.ts',
  'server/api/v1/customers/[id].delete.ts',
  'server/api/v1/customers/[id].get.ts',
  'server/api/v1/customers/[id].put.ts',
  'server/api/v1/customers/[id]/contacts.get.ts',
  'server/api/v1/customers/[id]/contacts.post.ts',
  'server/api/v1/dashboard/forecast.get.ts',
  'server/api/v1/dashboard/funnel.get.ts',
  'server/api/v1/dashboard/kpis.get.ts',
  'server/api/v1/dashboard/receivables.get.ts',
  'server/api/v1/dashboard/summary.get.ts',
  'server/api/v1/documents/index.get.ts',
  'server/api/v1/documents/[id].delete.ts',
  'server/api/v1/leads/index.get.ts',
  'server/api/v1/leads/[id].get.ts',
  'server/api/v1/leads/[id].put.ts',
  'server/api/v1/leads/[id]/convert.post.ts',
  'server/api/v1/opportunities/index.get.ts',
  'server/api/v1/opportunities/[id].get.ts',
  'server/api/v1/opportunities/[id].put.ts',
  'server/api/v1/opportunities/[id]/activities.post.ts',
  'server/api/v1/payments/index.get.ts',
  'server/api/v1/payments/[id].get.ts',
  'server/api/v1/payments/[id].put.ts',
  'server/api/v1/payments/[id]/confirm.post.ts',
  'server/api/v1/quotes/index.get.ts',
  'server/api/v1/quotes/index.post.ts',
  'server/api/v1/quotes/[id].get.ts',
  'server/api/v1/quotes/[id].put.ts',
  'server/api/v1/quotes/[id]/approve.post.ts',
  'server/api/v1/tenders/index.get.ts',
  'server/api/v1/tenders/index.post.ts',
  'server/api/v1/tenders/[id].get.ts',
  'server/api/v1/tenders/[id].put.ts',
  'server/api/v1/tenders/[id]/members.delete.ts',
  'server/api/v1/tenders/[id]/members.post.ts',
  'server/api/v1/tenders/[id]/milestones.post.ts',
  'server/api/v1/tenders/[id]/milestones.put.ts',
  'server/api/v1/tenders/agencies.get.ts',
  'server/api/v1/tenders/agencies.post.ts',
  'server/api/v1/teams/index.get.ts',
  'server/api/v1/teams/index.post.ts',
  'server/api/v1/teams/[id].get.ts',
  'server/api/v1/teams/[id].put.ts',
  'server/api/v1/teams/[id]/members.delete.ts',
  'server/api/v1/teams/[id]/members.post.ts'
]

const forbiddenDbPattern = /server\/utils\/db|\bqueryRow\s*(?:<|\()|\bqueryRows\s*(?:<|\()|\bexecute\s*(?:<|\()/

function listTypeScriptFiles(dir) {
  if (!existsSync(dir)) return []

  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path)
    }
  }
  return files
}

for (const [label, snippet] of requiredForwardingSnippets) {
  if (!middleware.includes(snippet)) {
    failures.push(`Missing tenant-runtime forwarding rule for ${label}: ${snippet}`)
  }
}

for (const [label, snippet] of requiredScopeSnippets) {
  if (!middleware.includes(snippet)) {
    failures.push(`Missing tenant-runtime resource scope mapping for ${label}: ${snippet}`)
  }
}

for (const [label, snippet] of requiredLocalOrchestrationSnippets) {
  if (!middleware.includes(snippet)) {
    failures.push(`Missing Nuxt local orchestration whitelist for ${label}: ${snippet}`)
  }
}

for (const [label, snippet] of forbiddenForwardingSnippets) {
  if (middleware.includes(snippet)) {
    failures.push(`Forbidden direct tenant-runtime forwarding would bypass Nuxt orchestration for ${label}: ${snippet}`)
  }
}

for (const [label, snippet] of forbiddenLocalWhitelistSnippets) {
  if (middleware.includes(snippet)) {
    failures.push(`Forbidden Nuxt local whitelist would re-enable ${label}: ${snippet}`)
  }
}

for (const file of allowedLocalApiFiles) {
  const path = resolve(rootDir, file)
  if (!existsSync(path)) {
    failures.push(`Allowed local API handler is missing: ${file}`)
    continue
  }

  const source = readFileSync(path, 'utf8')
  if (forbiddenDbPattern.test(source)) {
    failures.push(`Allowed local API handler must not import or call Altoc DB utils: ${relative(rootDir, path)}`)
  }
}

for (const [label, file, snippet] of forbiddenSourceSnippets) {
  const path = resolve(rootDir, file)
  if (!existsSync(path)) continue

  const source = readFileSync(path, 'utf8')
  if (source.includes(snippet)) {
    failures.push(`Forbidden source reference would hit blocked local runtime path for ${label}: ${relative(rootDir, path)} -> ${snippet}`)
  }
}

for (const file of runtimeMigratedApiFiles) {
  const path = resolve(rootDir, file)
  if (!existsSync(path)) continue

  const source = readFileSync(path, 'utf8')
  if (forbiddenDbPattern.test(source)) {
    failures.push(`Runtime-migrated API handler must not contain local Altoc DB access: ${relative(rootDir, path)}`)
  }
}

for (const path of listTypeScriptFiles(apiV1Dir)) {
  const source = readFileSync(path, 'utf8')
  if (forbiddenDbPattern.test(source)) {
    failures.push(`API v1 handler must not contain local Altoc DB access: ${relative(rootDir, path)}`)
  }
}

for (const path of listTypeScriptFiles(serverUtilsDir)) {
  if (relative(rootDir, path) === 'server/utils/db.ts') continue

  const source = readFileSync(path, 'utf8')
  if (forbiddenDbPattern.test(source)) {
    failures.push(`Server utility must not contain local Altoc DB access: ${relative(rootDir, path)}`)
  }
}

if (failures.length > 0) {
  console.error('Altoc runtime boundary audit failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Altoc runtime boundary audit passed.')
