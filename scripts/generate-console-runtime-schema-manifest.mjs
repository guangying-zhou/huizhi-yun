#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const sourcePath = resolve(root, 'console/docs/hzy_console_schema.sql')
const outputPath = resolve(root, 'data-runtime/internal/apps/console/schema_manifest.json')
const source = readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n')
const checkOnly = process.argv.slice(2).includes('--check')
// Envelope and assertion stores are opt-in and must not make existing
// deployments fail the mandatory gate before their separate migrations.
const excludedTables = ['console_runtime_cache', 'console_service_assertion_replay', 'gateway_service_assertion_replay', 'verified_policy_snapshots']

function fail(message) {
  throw new Error(message)
}

function splitDefinitions(body) {
  const definitions = []
  let start = 0
  let depth = 0
  let quote = ''

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    const previous = body[index - 1]
    if (quote) {
      if (char === quote && previous !== '\\') quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      definitions.push(body.slice(start, index).trim())
      start = index + 1
    }
  }
  definitions.push(body.slice(start).trim())
  return definitions.filter(Boolean)
}

function statementEnd(openingIndex) {
  let depth = 0
  let quote = ''
  for (let index = openingIndex; index < source.length; index += 1) {
    const char = source[index]
    const previous = source[index - 1]
    if (quote) {
      if (char === quote && previous !== '\\') quote = ''
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ';' && depth === 0) return index
  }
  return -1
}

const tables = {}
const header = /CREATE TABLE IF NOT EXISTS\s+`([^`]+)`\s*\(/g
for (const match of source.matchAll(header)) {
  const table = match[1]
  if (excludedTables.includes(table)) continue

  const openingIndex = match.index + match[0].length - 1
  const end = statementEnd(openingIndex)
  if (end < 0) fail(`unterminated CREATE TABLE statement: ${table}`)
  const statement = source.slice(openingIndex + 1, end)
  const bodyEnd = statement.lastIndexOf(')')
  if (bodyEnd < 0) fail(`missing table body terminator: ${table}`)

  const columns = []
  const indexes = []
  const constraints = []
  for (const definition of splitDefinitions(statement.slice(0, bodyEnd))) {
    const column = definition.match(/^`([^`]+)`\s+/)
    if (column) {
      columns.push(column[1])
      if (/\bPRIMARY KEY\b/i.test(definition)) indexes.push('PRIMARY')
      continue
    }
    if (/^PRIMARY KEY\b/i.test(definition)) {
      indexes.push('PRIMARY')
      continue
    }
    const index = definition.match(/^(?:UNIQUE\s+)?KEY\s+`([^`]+)`/i)
    if (index) {
      indexes.push(index[1])
      continue
    }
    const constraint = definition.match(/^CONSTRAINT\s+`([^`]+)`/i)
    if (constraint) constraints.push(constraint[1])
  }
  if (columns.length === 0) fail(`no columns parsed for ${table}`)
  tables[table] = {
    columns: [...new Set(columns)].sort(),
    indexes: [...new Set(indexes)].sort(),
    constraints: [...new Set(constraints)].sort()
  }
}

if (Object.keys(tables).length < 50) {
  fail(`expected at least 50 Console Runtime tables, parsed ${Object.keys(tables).length}`)
}

const alterConstraint = /ALTER TABLE\s+`([^`]+)`[\s\S]*?ADD CONSTRAINT\s+`([^`]+)`/g
for (const match of source.matchAll(alterConstraint)) {
  const [, table, constraint] = match
  if (!tables[table]) continue
  tables[table].constraints = [...new Set([...tables[table].constraints, constraint])].sort()
}

const manifest = {
  schemaRevision: `sha256:${createHash('sha256').update(source).digest('hex')}`,
  source: 'console/docs/hzy_console_schema.sql',
  excludedTables,
  tables: Object.fromEntries(Object.entries(tables).sort(([left], [right]) => left.localeCompare(right)))
}

const generated = `${JSON.stringify(manifest, null, 2)}\n`
if (checkOnly) {
  const current = readFileSync(outputPath, 'utf8')
  if (current !== generated) fail('Console Runtime schema manifest is stale; regenerate it before release')
  console.info(`[console-schema-manifest] current (${Object.keys(tables).length} tables)`)
} else {
  writeFileSync(outputPath, generated)
  console.info(`[console-schema-manifest] wrote ${Object.keys(tables).length} tables to ${outputPath}`)
}
