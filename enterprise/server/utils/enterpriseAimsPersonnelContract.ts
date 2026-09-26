export function activeEnterprisePersonnelUID(row: unknown, expected: string): string {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('人员不存在或已停用')
  const user = row as Record<string, unknown>
  if (user.uid !== expected || user.active !== true) throw new Error('人员不存在或已停用')
  return expected
}

export async function lookupActiveEnterprisePersonnelUID(uid: string, fetchRows: (uids: string[]) => Promise<Array<{ uid: string, active: boolean }>>): Promise<string> {
  let rows: Array<{ uid: string, active: boolean }>
  try { rows = await fetchRows([uid]) } catch { throw Object.assign(new Error('人员目录暂不可用，请稍后重试'), { statusCode: 503 }) }
  try { return activeEnterprisePersonnelUID(rows.find(row => row.uid === uid), uid) } catch { throw Object.assign(new Error('人员不存在或已停用'), { statusCode: 403 }) }
}
