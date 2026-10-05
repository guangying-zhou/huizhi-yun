export function directoryActiveStatusData(expectedUids: string[], response: { code?: unknown, data?: unknown }): Array<{ uid: string, active: boolean }> | null {
  const rows = response.data
  if (response.code !== 0 || !Array.isArray(rows) || rows.length !== expectedUids.length
    || new Set(rows.map(row => row?.uid)).size !== expectedUids.length
    || rows.some(row => !expectedUids.includes(row?.uid) || typeof row?.active !== 'boolean')) return null
  return rows.map(row => ({ uid: row.uid, active: row.active }))
}
