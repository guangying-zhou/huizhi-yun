import type { RowDataPacket } from 'mysql2/promise'
import { ok } from '~~/server/utils/api'
import { queryRows } from '~~/server/utils/db'

interface CapabilityRow extends RowDataPacket {
  id: number
  capability_code: string
  capability_name: string
  capability_type: string
  description: string | null
  status: string
}

export default defineEventHandler(async () => {
  const rows = await queryRows<CapabilityRow[]>(
    `SELECT id, capability_code, capability_name, capability_type, description, status
     FROM platform_capabilities
     WHERE status = 'active'
     ORDER BY capability_type ASC, capability_code ASC`
  )

  return ok({
    items: rows.map(row => ({
      id: row.id,
      capabilityCode: row.capability_code,
      capabilityName: row.capability_name,
      capabilityType: row.capability_type,
      description: row.description,
      status: row.status
    }))
  })
})
