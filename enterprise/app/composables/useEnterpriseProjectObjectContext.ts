import type { AimsProject, PaginatedList } from '../../../aims/app/types/aims'
import { filterObjectGroups, isUsableProject, numericProjectId, projectReturnTarget, projectAllowsCreate } from '../utils/object-navigation.mjs'
import { enterpriseNavigation } from '../utils/enterprise-navigation'

interface NavItem { id: string, label: string, path: string, permission?: { resource: string, action: string } }
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
  const route = useRoute()
  const scope = useState<string>('enterprise-cache-scope', () => '')
  const workspace = computed(() => toValue(options.workspace) || null)
  const id = computed(() => numericProjectId(route, workspace.value))
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
    detailGeneration++; listGeneration++
    detailAbort?.abort(); listAbort?.abort()
    project.value = null; projects.value = []; projectsTotal.value = 0
    loading.value = false; projectsLoading.value = false; error.value = ''
    projectsPage.value = 1; projectsSearch.value = ''
  }

  async function refresh() {
    detailAbort?.abort()
    const generation = ++detailGeneration
    project.value = null
    if (!active.value) return null
    detailAbort = new AbortController()
    const expectedId = id.value
    loading.value = true; error.value = ''
    try {
      const response = await $fetch<{ code?: number, data?: AimsProject }>(`/aims/api/v1/projects/${expectedId}`, { signal: detailAbort.signal, cache: 'no-store' })
      if (generation !== detailGeneration) return null
      if (response.code !== 0 || !isUsableProject(response.data) || String(response.data?.id) !== expectedId) throw new Error('项目详情暂不可用')
      project.value = response.data!
      void refreshProjects()
      return response.data!
    } catch {
      if (generation === detailGeneration) { project.value = null; error.value = '项目不可访问或暂不可用' }
      return null
    } finally { if (generation === detailGeneration) loading.value = false }
  }

  async function refreshProjects(page = 1, search = '') {
    listAbort?.abort()
    const generation = ++listGeneration
    if (!active.value || !project.value) return
    listAbort = new AbortController()
    projectsPage.value = Math.max(1, Math.floor(page)); projectsSearch.value = search
    projects.value = []; projectsLoading.value = true
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
      if (generation === listGeneration) { projects.value = []; projectsTotal.value = 0 }
    } finally { if (generation === listGeneration) projectsLoading.value = false }
  }

  watch(() => `${scope.value}:${active.value ? id.value : ''}`, () => { clear(); if (active.value) void refresh() }, { immediate: true, flush: 'sync' })
  onScopeDispose(clear)
  const model = computed<EnterpriseProjectObjectModel | null>(() => {
    if (!active.value || !isUsableProject(project.value) || !workspace.value) return null
    const backTo = projectReturnTarget(route.query as Record<string, unknown>, enterpriseNavigation.registeredPages)
    return {
      objectPath: `/aims/projects/${id.value}`, label: project.value!.name,
      backTo, backLabel: backTo.startsWith('/aims/projects') ? '返回项目总览' : '返回产品上下文',
      groups: filterObjectGroups(workspace.value, null, project.value),
      projects: projects.value, projectsTotal: projectsTotal.value, projectsPage: projectsPage.value,
      projectsPageSize, projectsSearch: projectsSearch.value, projectsLoading: projectsLoading.value
    }
  })
  const canCreateWorkItem = computed(() => Boolean(model.value && projectAllowsCreate(project.value) && workspace.value?.actions?.some(item => item.id === 'aims.project.create-work-item')))
  return { active, id, project, loading, error, model, canCreateWorkItem, refresh, refreshProjects }
}

export function provideEnterpriseProjectObjectContext(context: ReturnType<typeof useEnterpriseProjectObjectContext>) {
  provide(enterpriseProjectObjectContextKey, context)
  return context
}
export function useProvidedEnterpriseProjectObjectContext() {
  return inject<ReturnType<typeof useEnterpriseProjectObjectContext>>(enterpriseProjectObjectContextKey)
}
