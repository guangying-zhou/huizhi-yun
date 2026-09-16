#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '..')
const MANIFEST_PATH = resolve(ROOT, 'docs/demo/p3-p4/manifest.json')
const EXPECTED_APPS = ['people', 'codocs', 'assets', 'altoc', 'aims', 'finance']
const SCHEMAS = {
  people: 'people/docs/people_schema.sql',
  codocs: 'codocs/docs/codocs_schema.sql',
  assets: 'assets/docs/assets_schema.sql',
  altoc: 'altoc/docs/altoc_schema.sql',
  aims: 'aims/docs/aims_schema.sql',
  finance: 'finance/docs/finance_schema.sql'
}
const DERIVED_SEED_TABLES = {
  people: ['people_contribution_snapshots'],
  aims: ['milestones', 'work_items', 'work_item_service_ext', 'project_cost_summary'],
  finance: ['employee_cost_snapshot', 'project_cost_allocation', 'project_finance_summary'],
  codocs: ['document_relations'],
  assets: ['asset_documents'],
  altoc: []
}

function allowedDerivedSourceFixture(appCode, table, statement) {
  if (appCode !== 'aims') return false
  if (table === 'milestones') return statement.includes('DEMO-P3P4-202607-G23-MILESTONE')
  if (table === 'work_items') return statement.includes('DEMO-P3P4-202607-G23-TASK')
  return false
}

const errors = []

function error(message) {
  errors.push(message)
}

function read(path) {
  return readFileSync(path, 'utf8')
}

function normalizedSet(values) {
  return [...new Set(values)].sort()
}

function sameMembers(left, right) {
  return JSON.stringify(normalizedSet(left)) === JSON.stringify(normalizedSet(right))
}

function verifierCheckCodes(content) {
  const selectPattern = /\bSELECT\s+'(?:[^']|'')*'(?:\s+AS\s+`?phase`?)?\s*,\s*'((?:[^']|'')*)'(?:\s+AS\s+`?check_code`?)?\s*,/gi
  return [...content.matchAll(selectPattern)].map(match => match[1].replaceAll("''", "'"))
}

function validateExpectedCheckCodes(appCode, moduleConfig, manifestDir) {
  const expected = moduleConfig.expectedCheckCodes
  if (!Array.isArray(expected) || expected.length === 0) {
    error(`modules.${appCode}.expectedCheckCodes must be a non-empty array`)
    return
  }
  if (expected.some(checkCode => typeof checkCode !== 'string' || !new RegExp(`^${appCode}\\.[a-z0-9_]+$`).test(checkCode))) {
    error(`modules.${appCode}.expectedCheckCodes must contain only ${appCode}.* check codes`)
  }
  if (new Set(expected).size !== expected.length) {
    error(`modules.${appCode}.expectedCheckCodes contains duplicates`)
  }

  const verifyPath = resolve(manifestDir, moduleConfig.verify || '')
  if (!moduleConfig.verify || !verifyPath.startsWith(`${manifestDir}/`) || !existsSync(verifyPath)) return
  const declared = verifierCheckCodes(read(verifyPath))
  if (new Set(declared).size !== declared.length) {
    error(`${moduleConfig.verify}: verifier declares duplicate check_code values`)
  }
  if (!sameMembers(declared, expected)) {
    error(`${moduleConfig.verify}: declared check_code values must exactly match modules.${appCode}.expectedCheckCodes (declared: ${declared.join(', ') || 'none'})`)
  }
}

function tableBlock(schema, table) {
  const pattern = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+\\x60?${table}\\x60?\\s*\\(([\\s\\S]*?)\\n\\)\\s*(?:ENGINE|;)`, 'i')
  return pattern.exec(schema)?.[1] || ''
}

function validateInsertColumns(appCode, content, sqlPath) {
  const schema = read(resolve(ROOT, SCHEMAS[appCode]))
  const insertPattern = /INSERT\s+INTO\s+`?([a-z][a-z0-9_]*)`?\s*\(([^;]*?)\)\s*(?:VALUES|SELECT)/gi
  for (const match of content.matchAll(insertPattern)) {
    const table = match[1]
    const block = tableBlock(schema, table)
    if (!block) {
      error(`${sqlPath}: INSERT references table not found in ${SCHEMAS[appCode]}: ${table}`)
      continue
    }
    const columns = match[2].split(',').map(column => column.replaceAll('`', '').trim()).filter(Boolean)
    for (const column of columns) {
      if (!/^[a-z][a-z0-9_]*$/i.test(column)) {
        error(`${sqlPath}: could not parse INSERT column ${JSON.stringify(column)} for ${table}`)
        continue
      }
      const columnPattern = new RegExp(`(?:^|\\n)\\s*\\x60?${column}\\x60?\\s+[A-Z]`, 'i')
      if (!columnPattern.test(block)) error(`${sqlPath}: ${table}.${column} is not declared in ${SCHEMAS[appCode]}`)
    }
  }
}

function validateSql(appCode, action, relativePath, manifestDir, keyPrefix) {
  const absolutePath = resolve(manifestDir, relativePath)
  if (!absolutePath.startsWith(`${manifestDir}/`)) {
    error(`${appCode}.${action} escapes the demo package: ${relativePath}`)
    return
  }
  if (!existsSync(absolutePath)) {
    error(`missing ${appCode}.${action}: ${relativePath}`)
    return
  }
  const content = read(absolutePath)
  const label = absolutePath.slice(ROOT.length + 1)
  if (!content.includes(keyPrefix) && appCode !== 'codocs') error(`${label}: missing key prefix ${keyPrefix}`)
  for (const [pattern, description] of [
    [/\bUSE\s+`?[a-z0-9_]+`?/i, 'USE database'],
    [/\bSET\s+FOREIGN_KEY_CHECKS\b/i, 'FOREIGN_KEY_CHECKS override'],
    [/\bTRUNCATE\b/i, 'TRUNCATE'],
    [/\b(?:DROP|CREATE)\s+(?:DATABASE|SCHEMA)\b/i, 'database DDL'],
    [/\bDROP\s+TABLE\b/i, 'DROP TABLE'],
    [/^\s*SOURCE\s+/im, 'SOURCE command']
  ]) {
    if (pattern.test(content)) error(`${label}: forbidden ${description}`)
  }

  if (action === 'seed' || action === 'cleanup') {
    if (!/\bSTART\s+TRANSACTION\s*;/i.test(content)) error(`${label}: missing START TRANSACTION`)
    if (!/\bCOMMIT\s*;/i.test(content)) error(`${label}: missing COMMIT`)
  }
  if (action === 'seed') {
    validateInsertColumns(appCode, content, label)
    for (const table of DERIVED_SEED_TABLES[appCode]) {
      const pattern = new RegExp(`\\b(?:INSERT\\s+INTO|REPLACE\\s+INTO|UPDATE)\\s+\\x60?${table}\\x60?\\b`, 'i')
      for (const statement of content.split(';').filter(part => pattern.test(part))) {
        if (!allowedDerivedSourceFixture(appCode, table, statement)) {
          error(`${label}: seed must not pre-create API-derived table ${table}`)
        }
      }
    }
  }
  if (action === 'verify') {
    for (const field of ['phase', 'check_code', 'status', 'expected', 'actual', 'evidence']) {
      if (!new RegExp(`\\bAS\\s+\\x60?${field}\\x60?\\b`, 'i').test(content)) error(`${label}: verifier does not expose ${field}`)
    }
    if (/\b(?:DELETE|UPDATE|REPLACE)\b/i.test(content)) error(`${label}: verifier contains write DML`)
  }
  if (action === 'cleanup') {
    if (/\b(?:INSERT|REPLACE|UPDATE)\b/i.test(content)) error(`${label}: cleanup contains non-delete write DML`)
    for (const statement of content.split(';')) {
      if (/\bDELETE\s+FROM\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) {
        error(`${label}: cleanup DELETE is missing WHERE`)
      }
    }
  }
}

if (!existsSync(MANIFEST_PATH)) {
  error(`missing demo manifest: ${MANIFEST_PATH}`)
} else {
  let manifest
  try {
    manifest = JSON.parse(read(MANIFEST_PATH))
  } catch (cause) {
    error(`invalid demo manifest JSON: ${cause.message}`)
  }
  if (manifest) {
    const manifestDir = dirname(MANIFEST_PATH)
    if (manifest.schemaVersion !== 1) error(`unsupported manifest schemaVersion: ${manifest.schemaVersion}`)
    if (!manifest.packageId) error('manifest packageId is required')
    if (!/^DEMO-P3P4-[0-9]{6}-/.test(manifest.keyPrefix || '')) error(`invalid keyPrefix: ${manifest.keyPrefix}`)
    for (const orderName of ['seedOrder', 'verifyOrder', 'cleanupOrder']) {
      const order = manifest[orderName]
      if (!Array.isArray(order) || !sameMembers(order, EXPECTED_APPS)) {
        error(`${orderName} must contain each required app exactly once: ${EXPECTED_APPS.join(', ')}`)
      }
      if (Array.isArray(order) && new Set(order).size !== order.length) error(`${orderName} contains duplicates`)
    }
    for (const appCode of EXPECTED_APPS) {
      const moduleConfig = manifest.modules?.[appCode]
      if (!moduleConfig) {
        error(`manifest is missing modules.${appCode}`)
        continue
      }
      const expectedDatabaseEnv = `HZY_DEMO_${appCode.toUpperCase()}_MYSQL_DATABASE`
      if (moduleConfig.databaseEnv !== expectedDatabaseEnv) {
        error(`modules.${appCode}.databaseEnv must be ${expectedDatabaseEnv}`)
      }
      validateExpectedCheckCodes(appCode, moduleConfig, manifestDir)
      for (const action of ['seed', 'verify', 'cleanup']) {
        validateSql(appCode, action, moduleConfig[action] || '', manifestDir, manifest.keyPrefix)
      }
    }
  }
}

for (const indexFile of ['seed.sql', 'verify.sql', 'cleanup.sql']) {
  const path = resolve(ROOT, 'docs/demo/p3-p4', indexFile)
  if (!existsSync(path)) error(`missing fail-fast index: ${path}`)
  else if (!/SIGNAL\s+SQLSTATE\s+'45000'/i.test(read(path))) error(`${indexFile} must fail fast instead of acting as a cross-database script`)
}

for (const message of errors) console.error(`[p3-p4-demo] ERROR ${message}`)
if (errors.length > 0) {
  console.error(`[p3-p4-demo] failed with ${errors.length} error(s)`)
  process.exit(1)
}
console.info('[p3-p4-demo] passed static package validation for 6 isolated module databases')
