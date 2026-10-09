import { projectPageFailure } from '../../../aims/app/utils/projectPageFailure'
import type { AimsProject, PaginatedList } from '../../../aims/app/types/aims'
import { filterObjectGroups, isUsableProject, numericProjectId, projectReturnTarget, projectAllowsCreate, projectWorkspaceWithWriteAccess, projectRouteTab, projectTabAllows } from '../utils/object-navigation.mjs'
import { enterpriseNavigation } from '../utils/enterprise-navigation'

interface NavItem { id: string, label: string, icon?: string, path: string, permission?: { resource: string, action: string } }
interface NavGroup { id: string, label: string, items: NavItem[] }
interface Workspace { base: string, backTo?: string, backLabel?: string, groups: NavGroup[], actions?: { id: string }[] }
export interface EnterpriseProjectObjectModel {
  objectPath: string
  label: string
  backTo: string
  backLabel: string
  groups: NavGroup[]
  projects: Array<{ id: number, name: string, projectCode: string }>
  projectsTotal: number
  projectsPage: number
  projectsPageSize: number
  projectsSearch: string
  projectsLoading: boolean
}
export const enterpriseProjectObjectContextKey = Symbol('enterprise-project-object-context')

// Created once by the Host layout, injected by pages. No global object cache or
// independently-running consumer can refill an old user's project summary.
export function useEnterpriseProjectObjectContext(options: { workspace: MaybeRefOrGetter<Workspace | null | undefined> }) {
  const route = useRouter().currentRoute
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const workspace = computed(() => toValue(options.workspace) || null)
  const id = computed(() => numericProjectId(route.value, workspace.value))
  // The summary is read through projects:view (the overview entry). Other
  // object actions may survive its revocation; they cannot retain this cached
  // project identity merely because some workspace group is still visible.
  const active = computed(() => Boolean(scope.value && id.value
    && workspace.value?.groups.some(group => group.items.some(item => item.path === ''))))
  const project = ref<AimsProject | null>(null)
  const loading = ref(false)
  const error = ref('')
  const projects = ref<EnterpriseProjectObjectModel['projects']>([])
  const projectsTotal = ref(0), projectsPage = ref(1), projectsSearch = ref(''), projectsLoading = ref(false)
  const projectsPageSize = 20
  let detailGeneration = 0, listGeneration = 0
  let detailAbort: AbortController | undefined, listAbort: AbortController | undefined

  function clear() {
    detailGeneration++
    listGeneration++
    detailAbort?.abort()
    listAbort?.abort()
    project.value = null
    projects.value = []
    projectsTotal.value = 0
    loading.value = false
    projectsLoading.value = false
    error.value = ''
    projectsPage.value = 1
    projectsSearch.value = ''
  }

  async function refresh() {
    detailAbort?.abort()
    const generation = ++detailGeneration
    if (!active.value) {
      project.value = null
      return null
    }
    detailAbort = new AbortController()
    const expectedId = id.value
    // Periodic/focus re-reads keep the current project (same id; clear() already
    // ran on any scope or id change) so the sidebar does not fall back to the
    // main menu while revalidating. A failed re-read still drops it below.
    const revalidating = String(project.value?.id ?? '') === expectedId
    if (!revalidating) {
      project.value = null
      loading.value = true
    }
    error.value = ''
    try {
      const response = await $fetch<{ code?: number, data?: AimsProject }>(`/aims/api/v1/projects/${expectedId}`, { signal: detailAbort.signal, cache: 'no-store' })
      if (generation !== detailGeneration) return null
      if (response.code !== 0 || !isUsableProject(response.data) || String(response.data?.id) !== expectedId) throw new Error('项目详情暂不可用')
      project.value = response.data!
      if (!revalidating || !projects.value.length) void refreshProjects()
      return response.data!
    } catch (cause) {
      if (generation === detailGeneration) {
        project.value = null
        error.value = projectPageFailure(cause)
      }
      return null
    } finally { if (generation === detailGeneration) loading.value = false }
  }

  async function refreshProjects(page = 1, search = '') {
    listAbort?.abort()
    const generation = ++listGeneration
    if (!active.value || !project.value) return
    listAbort = new AbortController()
    projectsPage.value = Math.max(1, Math.floor(page))
    projectsSearch.value = search
    projects.value = []
    projectsLoading.value = true
    try {
      const response = await $fetch<{ code?: number, data?: PaginatedList<Partial<AimsProject> & { project_code?: string }> }>('/aims/api/v1/projects', {
        signal: listAbort.signal, cache: 'no-store', query: { page: projectsPage.value, pageSize: projectsPageSize, search: search || undefined }
      })
      if (generation !== listGeneration) return
      if (response.code !== 0 || !response.data) throw new Error('项目列表暂不可用')
      projects.value = response.data.items.map(item => ({ id: Number(item.id), name: String(item.name || item.projectCode || ''), projectCode: String(item.projectCode || item.project_code || '') }))
        .filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.name)
      projectsTotal.value = Number(response.data.total || 0)
    } catch {
      if (generation === listGeneration) {
        projects.value = []
        projectsTotal.value = 0
      }
    } finally { if (generation === listGeneration) projectsLoading.value = false }
  }

  watch(() => `${scope.value}:${active.value ? id.value : ''}`, () => {
    clear()
    if (active.value) void refresh()
  }, { immediate: true, flush: 'sync' })
  // Object relationships do not change global navigation IDs. Refresh their
  // discovery verdict independently so a removed manager cannot retain an
  // edit entry indefinitely in an otherwise unchanged workspace.
  let relationshipTimer: ReturnType<typeof setInterval> | undefined
  const refreshRelationships = () => {
    if (active.value) void refresh()
  }
  if (import.meta.client && useRuntimeConfig().public.manualRefresh !== true) {
    onMounted(() => {
      window.addEventListener('focus', refreshRelationships)
      relationshipTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refreshRelationships()
      }, 120_000)
    })
  }
  onScopeDispose(() => {
    clear()
    if (relationshipTimer) clearInterval(relationshipTimer)
    if (import.meta.client) window.removeEventListener('focus', refreshRelationships)
  })
  const model = computed<EnterpriseProjectObjectModel | null>(() => {
    if (!active.value || !isUsableProject(project.value) || !workspace.value) return null
    const backTo = projectReturnTarget(route.value.query as Record<string, unknown>, enterpriseNavigation.registeredPages)
    return {
      objectPath: `/aims/projects/${id.value}`, label: project.value!.name,
      backTo, backLabel: backTo.startsWith('/aims/projects') ? '返回项目总览' : '返回产品上下文',
      groups: filterObjectGroups(projectWorkspaceWithWriteAccess(workspace.value, enterpriseNavigation.objectWorkspaces.find(item => item.code === 'aims-project'), project.value), null, project.value),
      projects: projects.value, projectsTotal: projectsTotal.value, projectsPage: projectsPage.value,
      projectsPageSize, projectsSearch: projectsSearch.value, projectsLoading: projectsLoading.value
    }
  })
  const canCreateWorkItem = computed(() => Boolean(model.value && projectAllowsCreate(project.value) && workspace.value?.actions?.some(item => item.id === 'aims.project.create-work-item')))
  const restrictedTab = computed(() => projectRouteTab(route.value.path))
  const tabDenied = computed(() => Boolean(active.value && project.value && restrictedTab.value && !projectTabAllows(project.value, restrictedTab.value)))
  const tabPending = computed(() => Boolean(restrictedTab.value && (!active.value || !project.value) && !error.value))
  return { tabDenied, tabPending, active, id, project, loading, error, model, canCreateWorkItem, refresh, refreshProjects }
}

export function provideEnterpriseProjectObjectContext(context: ReturnType<typeof useEnterpriseProjectObjectContext>) {
  provide(enterpriseProjectObjectContextKey, context)
  return context
}
export function useProvidedEnterpriseProjectObjectContext() {
  return inject<ReturnType<typeof useEnterpriseProjectObjectContext>>(enterpriseProjectObjectContextKey)
}
