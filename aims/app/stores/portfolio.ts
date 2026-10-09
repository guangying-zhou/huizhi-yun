import { useAimsModule } from '../../layer/useAimsModule'
import { defineStore } from 'pinia'
import type {
  ProjectPortfolio,
  ProjectCategory,
  CreatePortfolioRequest,
  UpdatePortfolioRequest,
  PaginatedList
} from '../types/aims'

export const usePortfolioStore = defineStore('portfolio', () => {
  // 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
  const { moduleUrl, hosted } = useAimsModule()
  const updateIntents = new Map<number, { signature: string, key: string }>()
  type RawProjectPortfolio = Partial<ProjectPortfolio> & {
    domain_code?: string | null
    owner_uid?: string | null
    dept_code?: string | null
    git_group?: string | null
    is_product_line?: boolean | number
    default_category?: string | null
    is_system?: boolean | number
    display_order?: number | string | null
    created_by?: string
    created_at?: string
    updated_at?: string
    project_count?: number
    owner_name?: string
  }

  const portfolios = ref<ProjectPortfolio[]>([])
  const total = ref(0)
  const loading = ref(false)

  function booleanValue(value: unknown, fallback = false) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
    return fallback
  }

  function displayOrderValue(value: unknown) {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
  }

  function comparePortfolio(a: ProjectPortfolio, b: ProjectPortfolio) {
    return a.displayOrder - b.displayOrder
      || a.id - b.id
  }

  function normalizePortfolio(raw: RawProjectPortfolio): ProjectPortfolio {
    return {
      ...raw,
      id: Number(raw.id),
      code: raw.code ?? '',
      name: raw.name ?? '',
      description: raw.description ?? null,
      domainCode: raw.domainCode ?? raw.domain_code ?? null,
      ownerUid: raw.ownerUid ?? raw.owner_uid ?? null,
      deptCode: raw.deptCode ?? raw.dept_code ?? null,
      gitGroup: raw.gitGroup ?? raw.git_group ?? null,
      isProductLine: raw.isProductLine ?? booleanValue(raw.is_product_line),
      defaultCategory: (raw.defaultCategory ?? raw.default_category ?? null) as ProjectCategory | null,
      isSystem: raw.isSystem ?? booleanValue(raw.is_system),
      displayOrder: displayOrderValue(raw.displayOrder ?? raw.display_order),
      status: raw.status ?? 'active',
      createdBy: raw.createdBy ?? raw.created_by ?? '',
      createdAt: raw.createdAt ?? raw.created_at ?? '',
      updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
      projectCount: raw.projectCount ?? raw.project_count,
      ownerName: raw.ownerName ?? raw.owner_name
    }
  }

  async function fetchPortfolios(query?: { status?: string, domainCode?: string, search?: string }) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (query?.status) params.set('status', query.status)
      if (query?.domainCode) params.set('domain_code', query.domainCode)
      if (query?.search) params.set('search', query.search)
      params.set('pageSize', '100')

      const res = await $fetch<{ code: number, data: PaginatedList<RawProjectPortfolio> }>(
        moduleUrl(`/api/v1/portfolios?${params.toString()}`)
      )
      if (res.code === 0) {
        portfolios.value = res.data.items.map(normalizePortfolio).sort(comparePortfolio)
        total.value = res.data.total
      }
    } catch (err) {
      console.error('[PortfolioStore] fetchPortfolios failed:', err)
      portfolios.value = []
    } finally {
      loading.value = false
    }
  }

  async function createPortfolio(data: CreatePortfolioRequest) {
    const res = await $fetch<{ code: number, data: { id: number } }>(moduleUrl('/api/v1/portfolios'), {
      method: 'POST',
      body: data
    })
    if (res.code === 0) {
      await fetchPortfolios()
    }
    return res.data
  }

  async function updatePortfolio(id: number, data: UpdatePortfolioRequest, expectedVersion?: string) {
    if (hosted && !expectedVersion) throw Error('项目集版本未加载，请刷新后重试')
    const body = hosted ? { ...data, expectedVersion } : data
    const signature = JSON.stringify(body)
    let intent = updateIntents.get(id)
    if (!intent || intent.signature !== signature) {
      intent = { signature, key: crypto.randomUUID() }
      updateIntents.set(id, intent)
    }
    const res = await $fetch<{ code: number, data: null }>(moduleUrl(`/api/v1/portfolios/${id}`), {
      method: 'PUT',
      ...(hosted ? { headers: { 'Idempotency-Key': intent.key } } : {}),
      body
    })
    if (res.code === 0) {
      updateIntents.delete(id)
      await fetchPortfolios()
    }
  }

  async function deletePortfolio(id: number) {
    await $fetch(moduleUrl(`/api/v1/portfolios/${id}`), { method: 'DELETE' })
    await fetchPortfolios()
  }

  return {
    portfolios,
    total,
    loading,
    fetchPortfolios,
    normalizePortfolio,
    createPortfolio,
    updatePortfolio,
    deletePortfolio
  }
})
