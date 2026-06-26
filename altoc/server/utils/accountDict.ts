/**
 * Console 字典代理。
 *
 * 行业和区域由 Console/Directory Runtime 统一提供，altoc 保持本地接口形态。
 */
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'

interface ConsoleApiResponse<T> {
  code: number
  message?: string
  data: T
}

export interface AccountBusinessDomain {
  id: number
  companyCode?: string
  domainCode: string
  domainName: string
  category: '2G' | '2B' | '2C' | string
  aliasName?: string | null
  displayName?: string
  source?: 'preset' | 'custom' | string
  sortOrder?: number
}

export interface AccountRegion {
  id: number
  companyCode: string
  regionCode: string
  regionName: string
  sortOrder?: number
}

function getDefaultCompanyCode() {
  const config = useRuntimeConfig()
  const hzy = (config.hzy || {}) as {
    defaultCompanyCode?: string
  }
  return hzy.defaultCompanyCode || process.env.HZY_DEFAULT_COMPANY_CODE || 'C000001'
}

/**
 * 拉取公司已选业务领域（可用作 altoc 的"行业"下拉）。
 * 若公司无自选领域则降级为全局预置领域字典。
 */
export async function fetchIndustries(
  companyCode?: string
): Promise<AccountBusinessDomain[]> {
  const code = companyCode || getDefaultCompanyCode()

  try {
    const res = await fetchDirectoryApi<ConsoleApiResponse<AccountBusinessDomain[]>>(
      `/api/v1/companies/${encodeURIComponent(code)}/business-domains`
    )
    if (res?.code === 0 && Array.isArray(res.data) && res.data.length > 0) {
      return res.data
    }
  } catch (err) {
    console.warn('[accountDict] fetchIndustries company-scope fallback failed:', err)
  }

  try {
    const res = await fetchDirectoryApi<ConsoleApiResponse<AccountBusinessDomain[]>>('/api/v1/business-domains')
    return Array.isArray(res?.data) ? res.data : []
  } catch (err) {
    console.error('[accountDict] fetchIndustries fallback failed:', err)
    return []
  }
}

/**
 * 拉取公司区域列表（可用作 altoc 的"区域"下拉）。
 */
export async function fetchRegions(
  companyCode?: string
): Promise<AccountRegion[]> {
  const code = companyCode || getDefaultCompanyCode()

  try {
    const res = await fetchDirectoryApi<ConsoleApiResponse<AccountRegion[]>>(
      `/api/v1/companies/${encodeURIComponent(code)}/regions`
    )
    return Array.isArray(res?.data) ? res.data : []
  } catch (err) {
    console.error('[accountDict] fetchRegions failed:', err)
    return []
  }
}
