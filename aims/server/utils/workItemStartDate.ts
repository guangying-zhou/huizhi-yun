import type { RowDataPacket } from '~~/server/utils/db'
import { queryRow } from '~~/server/utils/db'

interface ColumnRow extends RowDataPacket {
  cnt: number
}

let hasColumnCache: boolean | null = null

export async function hasWorkItemStartDateColumn() {
  if (hasColumnCache !== null) return hasColumnCache

  const row = await queryRow<ColumnRow>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'work_items'
       AND COLUMN_NAME = 'start_date'`
  )

  hasColumnCache = (row?.cnt || 0) > 0
  return hasColumnCache
}
