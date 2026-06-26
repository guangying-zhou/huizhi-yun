import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows, withTransaction } from '~~/server/utils/db'

interface OrgProfileRow extends RowDataPacket {
  id: number
  tenant_code: string
  org_name: string
  org_short_name: string | null
  logo_path: string | null
  industry_code: string | null
  address_text: string | null
  contact_name: string | null
  contact_mobile: string | null
  contact_email: string | null
  website_url: string | null
  display_name: string | null
  status: string
  created_at: string
  updated_at: string
}

interface RegionRow extends RowDataPacket {
  id: number
  region_code: string
  region_name: string
  description: string | null
  sort_order: number
  status: string
  created_at: string
  updated_at: string
  division_count?: number
}

interface RegionDivisionRow extends RowDataPacket {
  id: number
  division_code: string
  division_name: string | null
}

export interface CompanyInput {
  companyName?: string
  shortName?: string
  logo?: string
  industry?: string
  province?: string
  city?: string
  address?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  website?: string
  description?: string
  status?: number | string
}

export interface RegionInput {
  regionCode?: string
  regionName?: string
  description?: string
  sortOrder?: number
  status?: number | string
  divisions?: { divisionCode: string, divisionName?: string, includeChildren?: boolean }[]
}

const standardRegionTemplate: Array<{
  regionCode: string
  regionName: string
  sortOrder: number
  divisions: string[]
}> = [
  { regionCode: 'NORTH_CHINA', regionName: '华北', sortOrder: 1, divisions: ['110000', '120000', '130000', '140000', '150000'] },
  { regionCode: 'NORTHEAST_CHINA', regionName: '东北', sortOrder: 2, divisions: ['210000', '220000', '230000'] },
  { regionCode: 'EAST_CHINA', regionName: '华东', sortOrder: 3, divisions: ['310000', '320000', '330000', '340000', '350000', '360000', '370000'] },
  { regionCode: 'SOUTH_CENTRAL_CHINA', regionName: '中南', sortOrder: 4, divisions: ['410000', '420000', '430000', '440000', '450000', '460000'] },
  { regionCode: 'SOUTHWEST_CHINA', regionName: '西南', sortOrder: 5, divisions: ['500000', '510000', '520000', '530000', '540000'] },
  { regionCode: 'NORTHWEST_CHINA', regionName: '西北', sortOrder: 6, divisions: ['610000', '620000', '630000', '640000', '650000'] },
  { regionCode: 'HK_MACAO_TAIWAN', regionName: '港澳台', sortOrder: 7, divisions: ['710000', '810000', '820000'] }
]

function nullableString(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function statusToAccount(status: string) {
  return status === 'active' ? 1 : 0
}

function statusFromAccount(status: unknown) {
  if (status === undefined) return undefined
  return status === 1 || status === '1' || status === 'active' ? 'active' : 'inactive'
}

function normalizeCompany(row: OrgProfileRow) {
  return {
    id: row.id,
    companyCode: row.tenant_code,
    companyName: row.org_name,
    shortName: row.org_short_name,
    logo: row.logo_path,
    industry: row.industry_code,
    scale: null,
    province: null,
    city: null,
    address: row.address_text,
    contactName: row.contact_name,
    contactPhone: row.contact_mobile,
    contactEmail: row.contact_email,
    website: row.website_url,
    description: row.display_name,
    status: statusToAccount(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizeRegion(row: RegionRow) {
  return {
    id: row.id,
    companyCode: null,
    regionCode: row.region_code,
    regionName: row.region_name,
    description: row.description,
    sortOrder: row.sort_order,
    divisionCount: Number(row.division_count || 0)
  }
}

export async function listCompanies(query: Record<string, unknown> = {}) {
  const search = String(query.search || '').trim()
  const status = String(query.status ?? '').trim()
  const params: unknown[] = []
  let sql = 'SELECT * FROM org_profiles WHERE 1=1'

  if (search) {
    sql += ' AND (org_name LIKE ? OR org_short_name LIKE ? OR tenant_code LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  if (status !== '') {
    sql += ' AND status = ?'
    params.push(statusFromAccount(status))
  }

  sql += ' ORDER BY id ASC'
  const rows = await queryRows<OrgProfileRow[]>(sql, params)
  return rows.map(normalizeCompany)
}

export async function getCompany(companyCode: string) {
  const row = await queryRow<OrgProfileRow>(
    'SELECT * FROM org_profiles WHERE tenant_code = ? LIMIT 1',
    [companyCode]
  )
  return row ? normalizeCompany(row) : null
}

export async function createCompany(input: CompanyInput) {
  const companyName = nullableString(input.companyName)
  if (!companyName) throw createError({ statusCode: 400, message: '公司名称不能为空' })

  const existing = await queryRow<OrgProfileRow>('SELECT * FROM org_profiles WHERE singleton_key = 1 LIMIT 1')
  if (existing) {
    await updateCompany(existing.tenant_code, input)
    return { id: existing.id, companyCode: existing.tenant_code }
  }

  const maxRow = await queryRow<RowDataPacket & { max_code: string | null }>(
    'SELECT MAX(tenant_code) AS max_code FROM org_profiles WHERE tenant_code REGEXP \'^C[0-9]{6}$\''
  )
  const nextNum = maxRow?.max_code ? Number(maxRow.max_code.slice(1)) + 1 : 1
  const companyCode = `C${String(nextNum).padStart(6, '0')}`

  const result = await execute<ResultSetHeader>(
    `INSERT INTO org_profiles (
       singleton_key, tenant_code, org_name, org_short_name, display_name, logo_path,
       industry_code, website_url, contact_name, contact_email, contact_mobile,
       address_text, status, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
     ON DUPLICATE KEY UPDATE updated_at = NOW()`,
    [
      companyCode,
      companyName,
      nullableString(input.shortName),
      nullableString(input.description) || companyName,
      nullableString(input.logo),
      nullableString(input.industry),
      nullableString(input.website),
      nullableString(input.contactName),
      nullableString(input.contactEmail),
      nullableString(input.contactPhone),
      nullableString(input.address) || [input.province, input.city].map(nullableString).filter(Boolean).join(' ') || null
    ]
  )

  return { id: result.insertId, companyCode }
}

export async function updateCompany(companyCode: string, input: CompanyInput) {
  const existing = await getCompany(companyCode)
  if (!existing) throw createError({ statusCode: 404, message: '公司不存在' })

  const sets: string[] = []
  const params: unknown[] = []
  const mappings: [keyof CompanyInput, string][] = [
    ['companyName', 'org_name'],
    ['shortName', 'org_short_name'],
    ['description', 'display_name'],
    ['logo', 'logo_path'],
    ['industry', 'industry_code'],
    ['website', 'website_url'],
    ['contactName', 'contact_name'],
    ['contactEmail', 'contact_email'],
    ['contactPhone', 'contact_mobile'],
    ['address', 'address_text']
  ]

  for (const [key, column] of mappings) {
    if (input[key] !== undefined) {
      sets.push(`${column} = ?`)
      params.push(nullableString(input[key]))
    }
  }
  const status = statusFromAccount(input.status)
  if (status !== undefined) {
    sets.push('status = ?')
    params.push(status)
  }

  if (sets.length === 0) return false
  params.push(companyCode)
  await execute(`UPDATE org_profiles SET ${sets.join(', ')}, updated_at = NOW() WHERE tenant_code = ?`, params)
  return true
}

export async function listRegions() {
  const rows = await queryRows<RegionRow[]>(
    `SELECT r.*, COUNT(rd.id) AS division_count
       FROM regions r
       LEFT JOIN region_divisions rd ON rd.region_id = r.id
      WHERE r.status = 'active'
      GROUP BY r.id
      ORDER BY r.sort_order ASC, r.id ASC`
  )
  return rows.map(normalizeRegion)
}

export async function createRegion(input: RegionInput) {
  const regionCode = nullableString(input.regionCode)
  const regionName = nullableString(input.regionName)
  if (!regionCode || !regionName) {
    throw createError({ statusCode: 400, message: '区域编码和名称不能为空' })
  }

  await withTransaction(async (tx) => {
    const result = await tx.execute<ResultSetHeader>(
      `INSERT INTO regions (region_code, region_name, description, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', NOW(), NOW())`,
      [regionCode, regionName, nullableString(input.description), input.sortOrder ?? 100]
    )

    for (const division of input.divisions || []) {
      if (!nullableString(division.divisionCode)) continue
      await tx.execute(
        'INSERT INTO region_divisions (region_id, division_code, division_name, created_at) VALUES (?, ?, ?, NOW())',
        [result.insertId, division.divisionCode, nullableString(division.divisionName)]
      )
    }
  })
}

export async function initRegionsFromStandardTemplate() {
  await withTransaction(async (tx) => {
    for (const region of standardRegionTemplate) {
      await tx.execute(
        `INSERT INTO regions (region_code, region_name, region_type, description, sort_order, status, created_at, updated_at)
         VALUES (?, ?, 'template', NULL, ?, 'active', NOW(), NOW())
         ON DUPLICATE KEY UPDATE updated_at = updated_at`,
        [region.regionCode, region.regionName, region.sortOrder]
      )

      const row = await tx.queryRow<RegionRow>(
        'SELECT * FROM regions WHERE region_code = ? LIMIT 1',
        [region.regionCode]
      )
      if (!row) continue

      for (const divisionCode of region.divisions) {
        await tx.execute(
          `INSERT IGNORE INTO region_divisions (region_id, division_code, division_name, created_at)
           VALUES (?, ?, NULL, NOW())`,
          [row.id, divisionCode]
        )
      }
    }
  })
}

export async function updateRegion(regionCode: string, input: RegionInput) {
  const sets: string[] = []
  const params: unknown[] = []
  if (input.regionName !== undefined) {
    sets.push('region_name = ?')
    params.push(nullableString(input.regionName))
  }
  if (input.description !== undefined) {
    sets.push('description = ?')
    params.push(nullableString(input.description))
  }
  if (input.sortOrder !== undefined) {
    sets.push('sort_order = ?')
    params.push(input.sortOrder)
  }
  const status = statusFromAccount(input.status)
  if (status !== undefined) {
    sets.push('status = ?')
    params.push(status)
  }
  if (sets.length === 0) return false

  params.push(regionCode)
  const result = await execute<ResultSetHeader>(
    `UPDATE regions SET ${sets.join(', ')}, updated_at = NOW() WHERE region_code = ?`,
    params
  )
  if (result.affectedRows === 0) throw createError({ statusCode: 404, message: '区域不存在' })
  return true
}

export async function deleteRegion(regionCode: string) {
  const region = await queryRow<RegionRow>('SELECT * FROM regions WHERE region_code = ? LIMIT 1', [regionCode])
  if (!region) throw createError({ statusCode: 404, message: '区域不存在' })

  await withTransaction(async (tx) => {
    await tx.execute('DELETE FROM region_divisions WHERE region_id = ?', [region.id])
    await tx.execute('DELETE FROM regions WHERE id = ?', [region.id])
  })
}

export async function listRegionDivisions(regionCode: string) {
  const rows = await queryRows<RegionDivisionRow[]>(
    `SELECT rd.id, rd.division_code, rd.division_name
       FROM region_divisions rd
       INNER JOIN regions r ON r.id = rd.region_id
      WHERE r.region_code = ?
      ORDER BY rd.division_code ASC`,
    [regionCode]
  )

  return rows.map(row => ({
    id: row.id,
    divisionCode: row.division_code,
    divisionName: row.division_name,
    includeChildren: true
  }))
}

export async function replaceRegionDivisions(regionCode: string, divisions: RegionInput['divisions']) {
  if (!Array.isArray(divisions)) throw createError({ statusCode: 400, message: 'divisions 必须是数组' })

  const region = await queryRow<RegionRow>('SELECT * FROM regions WHERE region_code = ? LIMIT 1', [regionCode])
  if (!region) throw createError({ statusCode: 404, message: '区域不存在' })

  await withTransaction(async (tx) => {
    await tx.execute('DELETE FROM region_divisions WHERE region_id = ?', [region.id])
    for (const division of divisions) {
      const divisionCode = nullableString(division.divisionCode)
      if (!divisionCode) continue
      await tx.execute(
        'INSERT INTO region_divisions (region_id, division_code, division_name, created_at) VALUES (?, ?, ?, NOW())',
        [region.id, divisionCode, nullableString(division.divisionName)]
      )
    }
  })
}
