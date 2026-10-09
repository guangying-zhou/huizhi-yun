import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const schema = readFileSync(new URL('../docs/aims_schema.sql', import.meta.url), 'utf8')

function splitSqlStatements(sql: string) {
  const statements: string[] = []
  let buffer = ''
  let quote = ''
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1] || ''

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
        buffer += char
      }
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      buffer += char
      if (char === quote) {
        if (next === quote) {
          buffer += next
          index += 1
        } else if (sql[index - 1] !== '\\') {
          quote = ''
        }
      }
      continue
    }
    if (char === '-' && next === '-') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      buffer += char
      continue
    }
    if (char === ';') {
      const statement = buffer.trim()
      if (statement) statements.push(statement)
      buffer = ''
      continue
    }
    buffer += char
  }

  const trailing = buffer.trim()
  if (trailing) statements.push(trailing)
  return statements
}

function tableName(statement: string, operation: 'CREATE' | 'ALTER') {
  const pattern = operation === 'CREATE'
    ? /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+`?([a-zA-Z0-9_]+)`?/i
    : /^ALTER\s+TABLE\s+`?([a-zA-Z0-9_]+)`?/i
  return statement.match(pattern)?.[1] || ''
}

function referencedTables(statement: string) {
  return [...statement.matchAll(/REFERENCES\s+`?([a-zA-Z0-9_]+)`?/gi)].map(match => match[1])
}

function assertFreshSchemaTopology(sql: string) {
  const definedTables = new Set<string>()
  const createCounts = new Map<string, number>()

  for (const statement of splitSqlStatements(sql)) {
    const createdTable = tableName(statement, 'CREATE')
    if (createdTable) {
      const count = (createCounts.get(createdTable) || 0) + 1
      createCounts.set(createdTable, count)
      assert.equal(count, 1, `table ${createdTable} must be defined exactly once`)

      for (const referencedTable of referencedTables(statement)) {
        assert.ok(
          referencedTable === createdTable || definedTables.has(referencedTable),
          `table ${createdTable} references ${referencedTable} before it is defined`
        )
      }
      definedTables.add(createdTable)
      continue
    }

    const alteredTable = tableName(statement, 'ALTER')
    if (!alteredTable) continue
    assert.ok(definedTables.has(alteredTable), `ALTER TABLE ${alteredTable} appears before its definition`)
    for (const referencedTable of referencedTables(statement)) {
      assert.ok(
        definedTables.has(referencedTable),
        `ALTER TABLE ${alteredTable} references ${referencedTable} before it is defined`
      )
    }
  }

  return createCounts
}

function workflowCatalogKeys(sql: string) {
  const keys: string[] = []
  for (const statement of splitSqlStatements(sql)) {
    if (!/^INSERT\s+INTO\s+`?workflow_status_catalog`?/i.test(statement)) continue
    for (const match of statement.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*[01]\s*,\s*[01]\s*,\s*\d+\s*\)/g)) {
      keys.push(`${match[1]}:${match[2]}`)
    }
  }
  return keys
}

function workflowTransitionParentKeys(sql: string) {
  const keys: string[] = []
  for (const statement of splitSqlStatements(sql)) {
    if (!/^INSERT\s+INTO\s+`?workflow_transitions`?/i.test(statement)) continue
    for (const match of statement.matchAll(/\(\s*NULL\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,/g)) {
      keys.push(`${match[1]}:${match[2]}`, `${match[1]}:${match[3]}`)
    }
  }
  return keys
}

function missingWorkflowTransitionParents(sql: string) {
  const catalog = new Set(workflowCatalogKeys(sql))
  return [...new Set(workflowTransitionParentKeys(sql).filter(key => !catalog.has(key)))].sort()
}

describe('Aims fresh schema topology', () => {
  test('defines referenced tables before inline foreign keys and defines every table once', () => {
    const createCounts = assertFreshSchemaTopology(schema)
    assert.equal(createCounts.get('work_items'), 1)
    assert.equal(createCounts.get('project_weekly_report_work_items'), 1)

    const statements = splitSqlStatements(schema)
    const workItemsIndex = statements.findIndex(statement => tableName(statement, 'CREATE') === 'work_items')
    const weeklyItemsIndex = statements.findIndex(statement => tableName(statement, 'CREATE') === 'project_weekly_report_work_items')
    const requirementsIndex = statements.findIndex(statement => tableName(statement, 'CREATE') === 'requirement_items')
    const deferredRequirementFkIndex = statements.findIndex(statement => (
      tableName(statement, 'ALTER') === 'work_items'
      && /CONSTRAINT\s+`?fk_work_item_requirement`?/i.test(statement)
    ))

    assert.ok(workItemsIndex >= 0 && weeklyItemsIndex > workItemsIndex)
    assert.ok(requirementsIndex >= 0 && deferredRequirementFkIndex > requirementsIndex)
    assert.equal((schema.match(/CONSTRAINT\s+`?fk_work_item_requirement`?/gi) || []).length, 1)
  })

  test('rejects duplicate definitions and forward inline foreign keys', () => {
    assert.throws(
      () => assertFreshSchemaTopology(`
        CREATE TABLE IF NOT EXISTS child (
          id BIGINT PRIMARY KEY,
          parent_id BIGINT,
          CONSTRAINT fk_child_parent FOREIGN KEY (parent_id) REFERENCES parent (id)
        ) ENGINE=InnoDB;
        CREATE TABLE IF NOT EXISTS parent (id BIGINT PRIMARY KEY) ENGINE=InnoDB;
      `),
      /references parent before it is defined/
    )
    assert.throws(
      () => assertFreshSchemaTopology(`
        CREATE TABLE IF NOT EXISTS repeated (id BIGINT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE IF NOT EXISTS repeated (id BIGINT PRIMARY KEY) ENGINE=InnoDB;
      `),
      /must be defined exactly once/
    )
  })

  test('seeds every workflow transition parent status before transition rows', () => {
    const statements = splitSqlStatements(schema)
    const catalogSeedIndex = statements.findIndex(statement => /^INSERT\s+INTO\s+`?workflow_status_catalog`?/i.test(statement))
    const firstTransitionIndex = statements.findIndex(statement => /^INSERT\s+INTO\s+`?workflow_transitions`?/i.test(statement))
    const catalogSeed = statements[catalogSeedIndex] || ''
    const catalogKeys = workflowCatalogKeys(schema)

    assert.ok(catalogSeedIndex >= 0 && firstTransitionIndex > catalogSeedIndex)
    assert.match(catalogSeed, /ON\s+DUPLICATE\s+KEY\s+UPDATE/i)
    assert.equal(new Set(catalogKeys).size, catalogKeys.length, 'workflow catalog seed keys must be unique')
    assert.deepEqual(missingWorkflowTransitionParents(schema), [])
  })

  test('detects a transition whose parent status is absent from the catalog seed', () => {
    const incompleteSeed = `
      INSERT INTO workflow_status_catalog (entity_type, status, is_initial, is_terminal, sort_order) VALUES
      ('project', 'draft', 1, 0, 10)
      ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);
      INSERT INTO workflow_transitions (project_id, entity_type, from_status, to_status, transition_key) VALUES
      (NULL, 'project', 'draft', 'active', 'start');
    `

    assert.deepEqual(missingWorkflowTransitionParents(incompleteSeed), ['project:active'])
  })
})
