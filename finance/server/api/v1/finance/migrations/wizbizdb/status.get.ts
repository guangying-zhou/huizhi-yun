import type { RowDataPacket } from '~~/server/utils/db'
import { defineEventHandler } from 'h3'
import { missingSchemaWarning, type ApiDataResult } from '../../../../../utils/financeApi'
import { queryRows } from '../../../../../utils/db'
import { maybeCallCurrentFinanceDataRuntime } from '../../../../../utils/dataRuntime'

interface MigrationStatus {
  sourceSystem: string
  batches: Array<{
    batchCode: string
    sourceTable: string
    targetTable: string
    count: number
    latestMigratedAt: string | null
  }>
}

type MigrationStatusRow = RowDataPacket & {
  batch_code: string
  source_table: string
  target_table: string
  count: number
  latest_migrated_at: string | null
}

export default defineEventHandler(async (event): Promise<ApiDataResult<MigrationStatus>> => {
  const runtime = await maybeCallCurrentFinanceDataRuntime<ApiDataResult<MigrationStatus>>(event)
  if (runtime.handled) return runtime.data

  try {
    const rows = await queryRows<MigrationStatusRow[]>(`
      SELECT
        batch_code,
        source_table,
        target_table,
        COUNT(*) AS count,
        MAX(migrated_at) AS latest_migrated_at
      FROM finance_migration_map
      WHERE source_system = 'wizbizdb'
      GROUP BY batch_code, source_table, target_table
      ORDER BY latest_migrated_at DESC, batch_code DESC
    `)

    return {
      data: {
        sourceSystem: 'wizbizdb',
        batches: rows.map(row => ({
          batchCode: row.batch_code,
          sourceTable: row.source_table,
          targetTable: row.target_table,
          count: Number(row.count || 0),
          latestMigratedAt: row.latest_migrated_at
        }))
      }
    }
  } catch (error) {
    const warning = missingSchemaWarning(error)
    if (!warning) throw error
    return {
      warning,
      data: {
        sourceSystem: 'wizbizdb',
        batches: []
      }
    }
  }
})
