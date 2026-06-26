import { createError } from 'h3'
import { cleanString, generateFinanceCode } from './financeWrite'

export type WizbizMigrationTable = {
  sourceTable: string
  targetTable: string
  sourceCount: number
  inserted: number
  skipped: number
  mode: 'dry-run' | 'imported' | 'missing-source' | 'missing-target'
}

export type WizbizMigrationCleanup = {
  target: 'finance' | 'altoc' | 'aims'
  table: string
  deleted: number
}

export type WizbizMigrationResult = {
  batchCode: string
  dryRun: boolean
  sourceSystem: 'wizbizdb'
  tables: WizbizMigrationTable[]
  cleanup: WizbizMigrationCleanup[]
  warning?: string
}

export async function runWizbizMigration(input: {
  batchCode?: string | null
  dryRun?: boolean
  limit?: number | null
  targets?: unknown
  cleanTargetData?: boolean
  cleanOnly?: boolean
} = {}): Promise<WizbizMigrationResult> {
  const batchCode = cleanString(input.batchCode) || generateFinanceCode('MIG')
  throw createError({
    statusCode: 501,
    message: `Finance direct DB migration is disabled. Run Wizbiz migration through tenant-runtime/data-runtime. batchCode=${batchCode}`
  })
}
