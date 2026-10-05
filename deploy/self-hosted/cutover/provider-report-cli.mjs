#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'
import { collectProviderReceipts } from '../../../platform/server/utils/enterpriseProviderReceipts.mjs'
import { canonicalJson, parseCanonicalJson } from './evidence.mjs'
import { localName, readProtectedFile, writeProtectedNew } from './protected-files.mjs'

export async function runProviderReportCli(argv, options = {}) {
  if (argv.length !== 5 || argv[0] !== 'collect' || argv[1] !== '--config' || argv[3] !== '--out') throw Error('EVIDENCE_USAGE')
  const configPath = resolve(argv[2]), config = parseCanonicalJson(readProtectedFile(configPath))
  if (config?.schemaVersion !== 'enterprise-offline-provider-collection.v1' || !config.db || !config.binding) throw Error('EVIDENCE_PROVIDER_CONFIG')
  const connection = await (options.connect || mysql.createConnection)({ ...config.db, multipleStatements: false })
  try {
    await connection.query('SET TRANSACTION READ ONLY')
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT')
    const report = await collectProviderReceipts(connection, config.binding)
    const bytes = Buffer.from(canonicalJson(report))
    writeProtectedNew(join(dirname(configPath), localName(argv[4])), bytes)
    await connection.rollback()
    return { status: 'collected', sha256: createHash('sha256').update(bytes).digest('hex'),
      probes: report.probes.length, manual: report.manualCount, blocked: report.blockedCount }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { await connection.end() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProviderReportCli(process.argv.slice(2)).then(value => process.stdout.write(`${JSON.stringify(value)}\n`)).catch(error => {
    process.stderr.write(`${/^EVIDENCE_[A-Z_]+$/.test(error?.message || '') ? error.message : 'EVIDENCE_PROVIDER_UNAVAILABLE'}\n`)
    process.exitCode = 1
  })
}
