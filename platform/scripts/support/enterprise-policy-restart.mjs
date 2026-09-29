import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import mysql from 'mysql2/promise'
import { storePolicyBundle } from '../../../console/server/utils/persistentPolicyBundle.ts'

// Isolated test-process reader: no Console isolate memory is inherited.
const input = JSON.parse(readFileSync(0, 'utf8'))
const pool = mysql.createPool(input.connection)
try {
  const store = {
    async get(key) {
      const [rows] = await pool.execute('SELECT body, CAST(etag AS CHAR) AS etag FROM enterprise_e2e_policy_store WHERE object_key=?', [key])
      return rows[0] ? { etag: rows[0].etag, text: async () => rows[0].body } : null
    },
    async put() { throw Error('Rollback must be rejected before any write') }
  }
  await assert.rejects(storePolicyBundle(store, input.scope, input.secret, input.oldBundle, Date.now()), /durable revision rollback/)
  console.log('Fresh Node process rejected old enterprise revision from persisted MySQL policy record.')
} finally { await pool.end() }
