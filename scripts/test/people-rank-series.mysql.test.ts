import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import mysql from 'mysql2/promise'
import {
  buildTemporaryMySqlPlan,
  TemporaryMySqlExecutionError,
  withTemporaryMySql
} from './support/temporary-mysql-harness.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const RUN = process.env.HZY_RUN_PEOPLE_RANK_MIGRATION === '1'
const migration = { appCode: 'people', path: 'people/docs/migrations/20260829_rank_series.sql' }

async function plan(fixture: string, verify = false) {
  return await buildTemporaryMySqlPlan({
    rootDir: ROOT,
    sqlFiles: [
      { appCode: 'people', path: fixture },
      migration,
      ...(verify ? [{ appCode: 'people', path: 'people/docs/migrations/20260829_rank_series_verify.sql' }] : [])
    ]
  })
}

test('People rank-series migration finalizes valid legacy ranks and verify SQL executes', { skip: !RUN, timeout: 90_000 }, async () => {
  const mysqlPlan = await plan('scripts/test/fixtures/people-rank-series-before.sql', true)
  await withTemporaryMySql(mysqlPlan, async (context) => {
    const verifyResult = context.sqlFileResults.find(
      item => item.path === 'people/docs/migrations/20260829_rank_series_verify.sql'
    )
    assert.ok(verifyResult, 'rank-series verify SQL result was not captured')
    const verifyLines = verifyResult.stdout.trim().split(/\r?\n/).filter(Boolean)
    assert.deepEqual(verifyLines, ['PASS', 'PASS', 'PASS', 'PASS'])
    assert.doesNotMatch(verifyResult.stdout, /FAIL:/)

    const connection = await mysql.createConnection(context.connection('people'))
    try {
      const [columns] = await connection.query<any[]>(`
        SELECT column_type,is_nullable,column_default
        FROM information_schema.columns
        WHERE table_schema=DATABASE() AND table_name='people_ranks' AND column_name='rank_series'
      `)
      assert.deepEqual(columns.map(row => [row.COLUMN_TYPE, row.IS_NULLABLE, row.COLUMN_DEFAULT]), [["enum('M','P')", 'NO', 'P']])
      const [ranks] = await connection.query<any[]>('SELECT rank_code,rank_series FROM people_ranks ORDER BY rank_code')
      assert.deepEqual(ranks.map(row => [row.rank_code, row.rank_series]), [['M1', 'M'], ['P6', 'P']])
      const [indexes] = await connection.query<any[]>(`
        SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') columns_list
        FROM information_schema.statistics
        WHERE table_schema=DATABASE() AND table_name='people_ranks' AND index_name='idx_people_rank_series_level'
      `)
      assert.equal(indexes[0].columns_list, 'rank_series,rank_level,enabled,sort_order')
      const [constraints] = await connection.query<any[]>(`
        SELECT tc.constraint_name,cc.check_clause
        FROM information_schema.table_constraints tc
        JOIN information_schema.check_constraints cc
          ON cc.constraint_schema=tc.constraint_schema
         AND cc.constraint_name=tc.constraint_name
        WHERE tc.constraint_schema=DATABASE()
          AND tc.table_name='people_ranks'
          AND tc.constraint_name IN ('ck_people_rank_numeric','ck_people_rank_enabled')
        ORDER BY tc.constraint_name
      `)
      assert.deepEqual(constraints.map(row => row.CONSTRAINT_NAME), [
        'ck_people_rank_enabled',
        'ck_people_rank_numeric'
      ])
      const clauses = Object.fromEntries(
        constraints.map(row => [row.CONSTRAINT_NAME, String(row.CHECK_CLAUSE).replaceAll('`', '').toLowerCase()])
      )
      assert.match(clauses.ck_people_rank_enabled, /enabled\s+in\s*\(0,1\)/)
      assert.match(clauses.ck_people_rank_numeric, /rank_level\s*>=\s*0.*sort_order\s*>=\s*0/)
    } finally {
      await connection.end()
    }
  }, { execute: true, confirm: mysqlPlan.confirmationSha256, startupTimeoutMs: 30_000 })
})

for (const [name, fixture] of [
  ['unresolved custom rank', 'scripts/test/fixtures/people-rank-series-unresolved.sql'],
  ['invalid numeric and enabled values', 'scripts/test/fixtures/people-rank-series-invalid.sql']
] as const) {
  test(`People rank-series migration fails closed for ${name}`, { skip: !RUN, timeout: 90_000 }, async () => {
    const mysqlPlan = await plan(fixture)
    await assert.rejects(
      withTemporaryMySql(mysqlPlan, async () => undefined, {
        execute: true,
        confirm: mysqlPlan.confirmationSha256,
        startupTimeoutMs: 30_000
      }),
      error => error instanceof TemporaryMySqlExecutionError
    )
  })
}
