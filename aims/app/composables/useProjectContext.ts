/**
 * 项目上下文管理
 * 通过 Cookie 持久化当前选中的项目，控制主菜单/项目菜单切换
 */
export function useProjectContext() {
  const projectStore = useProjectStore()
  const currentProjectId = useCookie<string | null>('aims_current_project_id', {
    default: () => null,
    maxAge: 60 * 60 * 24 * 365 // 1 年
  })

  // 是否处于项目上下文中
  const hasProjectContext = computed(() => !!currentProjectId.value)

  // 当前项目信息
  const currentProject = computed(() => {
    if (!currentProjectId.value) return null
    return projectStore.currentProject?.id === Number(currentProjectId.value)
      ? projectStore.currentProject
      : null
  })

  // 进入项目
  async function enterProject(projectId: number) {
    const project = await projectStore.fetchProject(projectId)
    if (!project) return false
    currentProjectId.value = String(projectId)
    await navigateTo(`/projects/${projectId}`)
    return true
  }

  // 退出项目（返回项目总览）
  function exitProject() {
    currentProjectId.value = null
    navigateTo('/projects')
  }

  // 切换项目
  async function switchProject(projectId: number) {
    const project = await projectStore.fetchProject(projectId)
    if (!project) return false
    currentProjectId.value = String(projectId)
    await navigateTo(`/projects/${projectId}`)
    return true
  }

  // 加载当前项目数据（页面初始化时调用）
  async function loadCurrentProject() {
    if (currentProjectId.value && !currentProject.value) {
      const project = await projectStore.fetchProject(Number(currentProjectId.value))
      if (!project) currentProjectId.value = null
    }
  }

  return {
    currentProjectId,
    hasProjectContext,
    currentProject,
    enterProject,
    exitProject,
    switchProject,
    loadCurrentProject
  }
}
