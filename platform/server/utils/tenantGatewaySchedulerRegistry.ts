import type { RowDataPacket } from 'mysql2/promise'

// Tenant Gateway 定时 drain 唤醒的应用清单。必须与网关 src/index.js 的
// SCHEDULER_APPS 保持一致：网关取的是「本表上报的 appCodes ∩ SCHEDULER_APPS」，
// 任何一侧漏掉某个应用，它就永远不会被唤醒。
//
// 走查 ISSUE-B-025：finance 加进网关 SCHEDULER_APPS 后仍然零唤醒，就是因为本表
// 没有上报 finance，交集把它过滤掉了。
const SCHEDULER_APP_CODES = new Set(['aims', 'altoc', 'assets', 'console', 'finance', 'people', 'workflow'])
type SchedulerAppCode = 'aims' | 'altoc' | 'assets' | 'console' | 'finance' | 'people' | 'workflow'

// 下面两处 SQL 的 IN 列表由上面的常量派生，避免同一清单在本文件里维护三份。
const SCHEDULER_APP_CODE_SQL_LIST = [...SCHEDULER_APP_CODES]
  .map(appCode => `'${appCode}'`)
  .join(', ')

interface SchedulerCountRow extends RowDataPacket {
  total: number | string
}

interface SchedulerSiteRow extends RowDataPacket {
  id: number | string
  tenant_code: string
  environment: string
  public_url: string
  app_codes: string
}

interface SchedulerCursor {
  v: 1
  slot: number
  shardIndex: number
  shardCount: number
  windowSize: number
  processed: number
}

export interface TenantGatewaySchedulerRegistryInput {
  slot: number
  shardIndex: number
  shardCount: number
  limit: number
  windowSize: number
  cursor?: string
}

export interface TenantGatewaySchedulerRegistryItem {
  host: string
  tenantCode: string
  environment: string
  appCodes: SchedulerAppCode[]
}

interface SchedulerQueries {
  queryRows: <T extends RowDataPacket[]>(sql: string, params?: unknown[]) => Promise<T>
}

function schedulerHostFromUrl(value: unknown) {
  try {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'https:') return ''
    return url.hostname.trim().toLowerCase()
  } catch {
    return ''
  }
}

function encodeCursor(cursor: SchedulerCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string, input: TenantGatewaySchedulerRegistryInput): SchedulerCursor {
  let cursor: SchedulerCursor
  try {
    cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SchedulerCursor
  } catch {
    throw new TypeError('invalid scheduler cursor')
  }
  if (
    cursor.v !== 1
    || cursor.slot !== input.slot
    || cursor.shardIndex !== input.shardIndex
    || cursor.shardCount !== input.shardCount
    || cursor.windowSize !== input.windowSize
    || !Number.isSafeInteger(cursor.processed)
    || cursor.processed < 0
    || cursor.processed >= input.windowSize
  ) {
    throw new TypeError('scheduler cursor does not match the requested window')
  }
  return cursor
}

function schedulerCursor(input: TenantGatewaySchedulerRegistryInput) {
  if (!input.cursor) {
    return {
      v: 1,
      slot: input.slot,
      shardIndex: input.shardIndex,
      shardCount: input.shardCount,
      windowSize: input.windowSize,
      processed: 0
    } satisfies SchedulerCursor
  }
  return decodeCursor(input.cursor, input)
}

const ELIGIBLE_SITE_WHERE = `
  ds.status = 'active'
  AND t.status = 'active'
  AND MOD(CRC32(CONCAT(ds.tenant_code, '|', ds.environment)), ?) = ?
  AND EXISTS (
    SELECT 1
    FROM deployments eligible
    WHERE eligible.tenant_code = ds.tenant_code
      AND eligible.environment = ds.environment
      AND eligible.status = 'active'
      AND eligible.app_code IN (${SCHEDULER_APP_CODE_SQL_LIST})
  )`

async function countEligibleSites(queries: SchedulerQueries, input: TenantGatewaySchedulerRegistryInput) {
  const rows = await queries.queryRows<SchedulerCountRow[]>(`
    SELECT COUNT(*) AS total
    FROM deployment_sites ds
    INNER JOIN tenants t ON t.tenant_code = ds.tenant_code
    WHERE ${ELIGIBLE_SITE_WHERE}
  `, [input.shardCount, input.shardIndex])
  const total = Number(rows[0]?.total || 0)
  return Number.isSafeInteger(total) && total > 0 ? total : 0
}

async function selectEligibleSites(
  queries: SchedulerQueries,
  input: TenantGatewaySchedulerRegistryInput,
  limit: number,
  offset: number
) {
  if (limit <= 0) return []
  return await queries.queryRows<SchedulerSiteRow[]>(`
    SELECT ds.id, ds.tenant_code, ds.environment, ds.public_url,
           (
             SELECT GROUP_CONCAT(DISTINCT app.app_code ORDER BY app.app_code SEPARATOR ',')
             FROM deployments app
             WHERE app.tenant_code = ds.tenant_code
               AND app.environment = ds.environment
               AND app.status = 'active'
               AND app.app_code IN (${SCHEDULER_APP_CODE_SQL_LIST})
           ) AS app_codes
    FROM deployment_sites ds
    INNER JOIN tenants t ON t.tenant_code = ds.tenant_code
    WHERE ${ELIGIBLE_SITE_WHERE}
    ORDER BY ds.id ASC
    LIMIT ? OFFSET ?
  `, [input.shardCount, input.shardIndex, limit, offset])
}

function normalizeItem(row: SchedulerSiteRow): TenantGatewaySchedulerRegistryItem | null {
  const host = schedulerHostFromUrl(row.public_url)
  const tenantCode = String(row.tenant_code || '').trim()
  const environment = String(row.environment || '').trim()
  const appCodes = [...new Set(String(row.app_codes || '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => SCHEDULER_APP_CODES.has(value)))] as SchedulerAppCode[]
  if (!host || !tenantCode || !environment || appCodes.length === 0) return null
  return { host, tenantCode, environment, appCodes }
}

export async function listTenantGatewaySchedulerPageWithQueries(
  queries: SchedulerQueries,
  input: TenantGatewaySchedulerRegistryInput
) {
  const cursor = schedulerCursor(input)
  const total = await countEligibleSites(queries, input)
  if (total === 0) return { items: [], nextCursor: null }

  const windowBound = Math.min(input.windowSize, total)
  if (cursor.processed >= windowBound) return { items: [], nextCursor: null }
  const pageSize = Math.min(input.limit, windowBound - cursor.processed)
  const round = Math.floor(input.slot / input.shardCount)
  const startOffset = (round * input.windowSize) % total
  const offset = (startOffset + cursor.processed) % total
  const tailSize = Math.min(pageSize, total - offset)
  const tail = await selectEligibleSites(queries, input, tailSize, offset)
  const head = tail.length < pageSize
    ? await selectEligibleSites(queries, input, pageSize - tail.length, 0)
    : []
  const rows = [...tail, ...head]
  const processed = cursor.processed + rows.length
  const items = rows.map(normalizeItem).filter((item): item is TenantGatewaySchedulerRegistryItem => Boolean(item))
  const nextCursor = rows.length > 0 && processed < windowBound
    ? encodeCursor({ ...cursor, processed })
    : null
  return { items, nextCursor }
}
