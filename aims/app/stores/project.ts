import { defineStore } from 'pinia'
import type {
  AimsProject,
  AimsProjectDetail,
  ProjectMember,
  ProjectRepo,
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectListQuery,
  PaginatedList,
  LifecycleStatus,
  ApprovalStatus,
  ModuleConfig,
  ProjectRole,
  ProjectSecurityLevel
} from '~/types/aims'

export const useProjectStore = defineStore('project', () => {
  type RawAimsProject = Partial<AimsProject> & {
    project_code?: string
    short_name?: string
    internal_code?: string | null
    lifecycle_status?: LifecycleStatus
    portfolio_id?: number | null
    domain_code?: string | null
    dept_code?: string | null
    leader_uid?: string | null
    security_level?: ProjectSecurityLevel
    access_whitelist?: string[] | string | null
    start_date?: string | null
    end_date?: string | null
    opp_id?: number | null
    contract_id?: number | null
    customer_code?: string | null
    customer_name?: string | null
    contract_code?: string | null
    template_set_id?: number | null
    template_set_name?: string | null
    template_version_id?: number | null
    template_version_label?: string | null
    approval_status?: ApprovalStatus
    workflow_instance_id?: string | null
    module_config?: ModuleConfig | string | null
    board_config?: Record<string, unknown> | string | null
    workflow_config?: Record<string, unknown> | string | null
    notification_config?: Record<string, unknown> | string | null
    created_by?: string
    created_at?: string
    updated_at?: string
    can_access?: boolean | number
    current_user_role?: ProjectRole | null
    document_count?: number | string | null
  }

  type FavoriteProject = {
    projectId: number
    name: string
    projectCode: string
    lifecycleStatus: string
  }

  type FavoriteProjectResponse = {
    code: number
    data: FavoriteProject[] | {
      items?: Array<Partial<FavoriteProject> & {
        project_id?: number
        project_code?: string
        lifecycle_status?: string
      }>
    }
  }

  type RawProjectMember = Partial<ProjectMember> & {
    project_id?: number
    joined_at?: string
    real_name?: string
  }

  type RawProjectRepo = Partial<ProjectRepo> & {
    project_id?: number
    repo_project_code?: string
    last_commit_sha?: string | null
    last_synced_at?: string | null
    created_at?: string
  }

  type ListPayload<T> = T[] | {
    items?: T[]
  }

  function normalizeListPayload<T>(data: ListPayload<T> | null | undefined) {
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.items)) return data.items
    return []
  }

  function parseObjectConfig(value: unknown) {
    if (!value) return null
    if (typeof value === 'object') return value as Record<string, unknown>
    if (typeof value !== 'string') return null

    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }

  function parseStringArray(value: unknown) {
    if (!value) return []
    if (Array.isArray(value)) {
      return value
        .map(item => String(item || '').trim())
        .filter(Boolean)
    }
    if (typeof value !== 'string') return []

    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.map(item => String(item || '').trim()).filter(Boolean)
        : []
    } catch {
      return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    }
  }

  function booleanValue(value: unknown, fallback = true) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
    return fallback
  }

  function normalizeProject(raw: RawAimsProject): AimsProject {
    return {
      ...raw,
      id: Number(raw.id),
      projectCode: raw.projectCode ?? raw.project_code ?? '',
      name: raw.name ?? '',
      shortName: raw.shortName ?? raw.short_name ?? raw.name ?? '',
      internalCode: raw.internalCode ?? raw.internal_code ?? null,
      description: raw.description ?? null,
      category: raw.category ?? 'custom_dev',
      methodology: raw.methodology ?? 'PIVR',
      lifecycleStatus: raw.lifecycleStatus ?? raw.lifecycle_status ?? 'draft',
      portfolioId: raw.portfolioId ?? raw.portfolio_id ?? null,
      domainCode: raw.domainCode ?? raw.domain_code ?? null,
      deptCode: raw.deptCode ?? raw.dept_code ?? null,
      leaderUid: raw.leaderUid ?? raw.leader_uid ?? null,
      securityLevel: raw.securityLevel ?? raw.security_level ?? 'company',
      accessWhitelist: parseStringArray(raw.accessWhitelist ?? raw.access_whitelist),
      startDate: raw.startDate ?? raw.start_date ?? null,
      endDate: raw.endDate ?? raw.end_date ?? null,
      oppId: raw.oppId ?? raw.opp_id ?? null,
      contractId: raw.contractId ?? raw.contract_id ?? null,
      customerCode: raw.customerCode ?? raw.customer_code ?? null,
      customerName: raw.customerName ?? raw.customer_name ?? null,
      contractCode: raw.contractCode ?? raw.contract_code ?? null,
      templateSetId: raw.templateSetId ?? raw.template_set_id ?? null,
      templateSetName: raw.templateSetName ?? raw.template_set_name ?? null,
      templateVersionId: raw.templateVersionId ?? raw.template_version_id ?? null,
      templateVersionLabel: raw.templateVersionLabel ?? raw.template_version_label ?? null,
      approvalStatus: raw.approvalStatus ?? raw.approval_status ?? 'not_required',
      workflowInstanceId: raw.workflowInstanceId ?? raw.workflow_instance_id ?? null,
      moduleConfig: parseObjectConfig(raw.moduleConfig ?? raw.module_config) as ModuleConfig | null,
      boardConfig: parseObjectConfig(raw.boardConfig ?? raw.board_config),
      workflowConfig: parseObjectConfig(raw.workflowConfig ?? raw.workflow_config),
      notificationConfig: parseObjectConfig(raw.notificationConfig ?? raw.notification_config),
      createdBy: raw.createdBy ?? raw.created_by ?? '',
      createdAt: raw.createdAt ?? raw.created_at ?? '',
      updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
      canAccess: raw.canAccess ?? booleanValue(raw.can_access),
      currentUserRole: raw.currentUserRole ?? raw.current_user_role ?? null,
      documentCount: Math.max(0, Number(raw.documentCount ?? raw.document_count ?? 0) || 0)
    }
  }

  function normalizeProjectMember(raw: RawProjectMember): ProjectMember {
    return {
      id: Number(raw.id),
      projectId: Number(raw.projectId ?? raw.project_id),
      uid: raw.uid ?? '',
      role: raw.role ?? 'member',
      status: raw.status ?? 'active',
      joinedAt: raw.joinedAt ?? raw.joined_at ?? '',
      realName: raw.realName ?? raw.real_name,
      avatar: raw.avatar ?? null
    }
  }

  function normalizeProjectRepo(raw: RawProjectRepo): ProjectRepo {
    return {
      id: Number(raw.id),
      projectId: Number(raw.projectId ?? raw.project_id),
      repoProjectCode: raw.repoProjectCode ?? raw.repo_project_code ?? '',
      lastCommitSha: raw.lastCommitSha ?? raw.last_commit_sha ?? null,
      lastSyncedAt: raw.lastSyncedAt ?? raw.last_synced_at ?? null,
      createdAt: raw.createdAt ?? raw.created_at ?? ''
    }
  }

  // ---- State ----
  const projects = ref<AimsProject[]>([])
  const total = ref(0)
  const currentProject = ref<AimsProjectDetail | null>(null)
  const loading = ref(false)

  // 常用项目
  const favoriteProjectIds = ref<Set<number>>(new Set())
  const favoriteProjects = ref<FavoriteProject[]>([])

  function toFavoriteProject(item: Partial<FavoriteProject> & {
    project_id?: number
    project_code?: string
    lifecycle_status?: string
  }): FavoriteProject | null {
    const projectId = Number(item.projectId ?? item.project_id)
    if (!projectId) return null

    const project = projects.value.find(p => p.id === projectId)
      || (currentProject.value?.id === projectId ? currentProject.value : null)

    return {
      projectId,
      name: item.name || project?.name || '',
      projectCode: item.projectCode || item.project_code || project?.projectCode || '',
      lifecycleStatus: item.lifecycleStatus || item.lifecycle_status || project?.lifecycleStatus || ''
    }
  }

  function normalizeFavoriteProjects(data: FavoriteProjectResponse['data']) {
    const items = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : []
    return items.map(toFavoriteProject).filter((item): item is FavoriteProject => item !== null)
  }

  // ---- Actions ----
  async function fetchProjects(query?: ProjectListQuery) {
    loading.value = true
    try {
      const requestedPageSize = query?.pageSize
      const runtimePageSize = requestedPageSize ? Math.min(requestedPageSize, 100) : undefined
      const firstPage = await fetchProjectPage({ ...query, pageSize: runtimePageSize })

      if (firstPage.code === 0) {
        const items = [...firstPage.data.items]
        const requestedLimit = requestedPageSize || firstPage.data.pageSize
        const shouldFetchMore = !query?.page && requestedPageSize && items.length < firstPage.data.total && items.length < requestedLimit
        let nextPage = Number(firstPage.data.page || 1) + 1

        while (shouldFetchMore && items.length < firstPage.data.total && items.length < requestedLimit) {
          const res = await fetchProjectPage({ ...query, page: nextPage, pageSize: runtimePageSize })
          if (res.code !== 0 || res.data.items.length === 0) break
          items.push(...res.data.items)
          nextPage += 1
        }

        projects.value = items.slice(0, requestedLimit).map(normalizeProject)
        total.value = firstPage.data.total
      }
    } catch (err) {
      console.error('[ProjectStore] fetchProjects failed:', err)
      projects.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  async function fetchProjectPage(query?: ProjectListQuery) {
    const params = new URLSearchParams()
    if (query?.category) params.set('category', query.category)
    if (query?.lifecycleStatus) params.set('lifecycle_status', query.lifecycleStatus)
    if (query?.search) params.set('search', query.search)
    if (query?.portfolioId !== undefined) params.set('portfolio_id', String(query.portfolioId))
    if (query?.domainCode) params.set('domain_code', query.domainCode)
    if (query?.deptCode) params.set('dept_code', query.deptCode)
    if (query?.leaderUid) params.set('leader_uid', query.leaderUid)
    if (query?.page) params.set('page', String(query.page))
    if (query?.pageSize) params.set('pageSize', String(query.pageSize))

    return await $fetch<{ code: number, data: PaginatedList<RawAimsProject> }>(
      `/api/v1/projects?${params.toString()}`
    )
  }

  async function fetchProject(id: number) {
    loading.value = true
    try {
      const res = await $fetch<{ code: number, data: RawAimsProject & Partial<AimsProjectDetail> }>(
        `/api/v1/projects/${id}`
      )
      if (res.code === 0) {
        const project = {
          ...normalizeProject(res.data),
          members: normalizeListPayload(res.data.members as ListPayload<RawProjectMember> | undefined)
            .map(normalizeProjectMember),
          repos: normalizeListPayload(res.data.repos as ListPayload<RawProjectRepo> | undefined)
            .map(normalizeProjectRepo)
        } as AimsProjectDetail
        currentProject.value = project
        return project
      }
    } catch (err: unknown) {
      console.error('[ProjectStore] fetchProject failed:', err)
      currentProject.value = null
    } finally {
      loading.value = false
    }
    return null
  }

  async function createProject(data: CreateProjectRequest) {
    const res = await $fetch<{ code: number, data: RawAimsProject }>('/api/v1/projects', {
      method: 'POST',
      body: data
    })
    if (res.code === 0) {
      projects.value.unshift(normalizeProject(res.data))
      total.value++
    }
    return normalizeProject(res.data)
  }

  async function updateProject(id: number, data: UpdateProjectRequest) {
    const res = await $fetch<{ code: number, data: AimsProject | null }>(`/api/v1/projects/${id}`, {
      method: 'PUT',
      body: data
    })
    if (res.code === 0) {
      // PUT 返回 null，用传入的 data 局部更新本地状态
      if (currentProject.value?.id === id) {
        currentProject.value = { ...currentProject.value, ...data } as typeof currentProject.value
      }
      const idx = projects.value.findIndex(p => p.id === id)
      if (idx !== -1) {
        projects.value[idx] = { ...projects.value[idx], ...data } as typeof projects.value[0]
      }
    }
    return res.data
  }

  async function deleteProject(id: number) {
    await $fetch(`/api/v1/projects/${id}`, { method: 'DELETE' })
    projects.value = projects.value.filter(p => p.id !== id)
    total.value--
    if (currentProject.value?.id === id) {
      currentProject.value = null
    }
  }

  // ---- Favorites ----
  async function fetchFavorites() {
    try {
      const res = await $fetch<FavoriteProjectResponse>(
        '/api/v1/favorites'
      )
      if (res.code === 0) {
        const favorites = normalizeFavoriteProjects(res.data)
        favoriteProjects.value = favorites
        favoriteProjectIds.value = new Set(favorites.map(f => f.projectId))
      }
    } catch (err) {
      console.error('[ProjectStore] fetchFavorites failed:', err)
    }
  }

  function isFavorite(projectId: number) {
    return favoriteProjectIds.value.has(projectId)
  }

  async function toggleFavorite(projectId: number) {
    if (isFavorite(projectId)) {
      await $fetch('/api/v1/favorites', {
        method: 'DELETE',
        params: { projectId }
      })
      favoriteProjectIds.value.delete(projectId)
      favoriteProjects.value = favoriteProjects.value.filter(f => f.projectId !== projectId)
    } else {
      await $fetch('/api/v1/favorites', {
        method: 'POST',
        body: { projectId }
      })
      favoriteProjectIds.value.add(projectId)
      // 从已有项目列表补充信息
      const p = projects.value.find(proj => proj.id === projectId) || currentProject.value
      if (p) {
        favoriteProjects.value.unshift({
          projectId: p.id,
          name: p.name,
          projectCode: p.projectCode,
          lifecycleStatus: p.lifecycleStatus
        })
      }
    }
  }

  // ---- Members ----
  async function fetchMembers(projectId: number) {
    const res = await $fetch<{ code: number, data: ListPayload<RawProjectMember> }>(
      `/api/v1/projects/${projectId}/members`
    )
    const members = res.code === 0
      ? normalizeListPayload(res.data).map(normalizeProjectMember)
      : []
    if (res.code === 0 && currentProject.value?.id === projectId) {
      currentProject.value.members = members
    }
    return members
  }

  async function addMember(projectId: number, uid: string, role: string = 'member') {
    await $fetch<{ code: number }>(
      `/api/v1/projects/${projectId}/members`,
      { method: 'POST', body: { uid, role } }
    )
    // 刷新成员列表
    await fetchMembers(projectId)
  }

  async function removeMember(projectId: number, targetUid: string, action: 'remove' | 'suspend' = 'remove') {
    const res = await $fetch<{ code: number, message?: string, data: { action?: string, workItemCount?: number } }>(
      `/api/v1/projects/${projectId}/members?uid=${targetUid}&action=${action}`,
      { method: 'DELETE' }
    )
    if (res.code === 1) {
      // 有工作项，不允许移除
      return { blocked: true, workItemCount: res.data.workItemCount || 0 }
    }
    // 成功：刷新成员列表
    await fetchMembers(projectId)
    return { blocked: false }
  }

  // ---- Repos ----
  async function fetchRepos(projectId: number) {
    const res = await $fetch<{ code: number, data: ListPayload<RawProjectRepo> }>(
      `/api/v1/projects/${projectId}/repos`
    )
    const repos = res.code === 0
      ? normalizeListPayload(res.data).map(normalizeProjectRepo)
      : []
    if (res.code === 0 && currentProject.value?.id === projectId) {
      currentProject.value.repos = repos
    }
    return repos
  }

  async function linkRepo(projectId: number, repoProjectCode: string) {
    const res = await $fetch<{ code: number, data: unknown }>(
      `/api/v1/projects/${projectId}/repos`,
      { method: 'POST', body: { repoProjectCode } }
    )
    if (res.code === 0) {
      await fetchRepos(projectId)
    }
  }

  async function unlinkRepo(projectId: number, repoProjectCode: string) {
    await $fetch(
      `/api/v1/projects/${projectId}/repos?repoProjectCode=${encodeURIComponent(repoProjectCode)}`,
      { method: 'DELETE' }
    )
    if (currentProject.value?.id === projectId) {
      currentProject.value.repos = (currentProject.value.repos || []).filter(
        r => r.repoProjectCode !== repoProjectCode
      )
    }
  }

  /**
   * 项目是否已完成立项（active / paused / completed）。
   * 用于门控"立项后才能进行的操作"：需求规格书导入、需求项创建、任务分配、工作项状态流转等。
   */
  const isPostInitiation = computed(() => {
    const s = currentProject.value?.lifecycleStatus
    return s === 'active' || s === 'paused' || s === 'completed'
  })

  /**
   * 是否允许编辑 target 层工作目标骨架结构（立项书 WBS 的 target 新增/编辑/删除）。
   * 允许 draft（立项前可调整 WBS 供评审）与 active（正式执行期）；其他状态禁止。
   * 与后端 assertProjectStructureEditable 对齐。
   */
  const canEditTargetStructure = computed(() => {
    const s = currentProject.value?.lifecycleStatus
    return s === 'draft' || s === 'active'
  })

  /**
   * 工作项是否可编辑（仅在立项后的 active 状态允许；draft/approval_pending/paused/completed/archived 均不可编辑）。
   * draft 不可编辑是因为项目尚未立项，业务阶段的工作项操作禁止。
   */
  const isWorkItemEditable = computed(() => {
    const s = currentProject.value?.lifecycleStatus
    return s === 'active'
  })

  /** 不可编辑时的原因提示 */
  const workItemReadonlyReason = computed(() => {
    const s = currentProject.value?.lifecycleStatus
    if (s === 'draft') return '项目尚未立项，需完成项目立项审批后方可操作'
    if (s === 'approval_pending') return '项目立项审批中，审批通过后方可操作'
    if (s === 'paused') return '项目已暂停，恢复后可继续操作'
    if (s === 'completed') return '项目已完成'
    if (s === 'archived') return '项目已归档'
    return null
  })

  return {
    projects,
    total,
    currentProject,
    loading,
    isPostInitiation,
    canEditTargetStructure,
    isWorkItemEditable,
    workItemReadonlyReason,
    favoriteProjectIds,
    favoriteProjects,
    fetchProjects,
    fetchProject,
    createProject,
    updateProject,
    deleteProject,
    fetchFavorites,
    isFavorite,
    toggleFavorite,
    fetchMembers,
    addMember,
    removeMember,
    fetchRepos,
    linkRepo,
    unlinkRepo
  }
})
