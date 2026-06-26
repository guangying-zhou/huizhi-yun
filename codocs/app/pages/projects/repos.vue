<script setup lang="ts">
import { useAccountStore } from '~/stores/account'
import ConflictResolveModal from '~/components/project/ConflictResolveModal.vue'
import type { Project, ConflictDoc, GitlabFileInfo } from '~/types/account'
import type { ProjectFileItem } from '~/types/index'

usePageTitle('代码库文档')

definePageMeta({
  layout: 'default'
})

const accountStore = useAccountStore()
const toast = useToast()
const { user } = useAuth()
const { setPayload: setDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const projectTree = ref<Project[]>([])
const projectTreeLoading = ref(false)
const refreshingProjectTree = ref(false)

// Tree state
const selectedNodeId = ref<string>('root') // 'root', 'project-{id}', 'folder-{path}', 'doc-{uuid}'
const selectedNodeType = ref<'root' | 'project' | 'folder' | 'document'>('root')

// Preview state
const previewContent = ref('')
const previewDoc = ref<ProjectFileItem | null>(null)
const previewLoading = ref(false)

// Modal states
const showConflictModal = ref(false)
const initialConflictPath = ref<string | undefined>(undefined)

const docsLoading = computed(() => {
  if (!currentProject.value) return false
  return currentProject.value.docsLoading
})

const collectLeaderProjectCodes = (projects: Project[], currentUid: string, ids: Set<string>) => {
  projects.forEach((project) => {
    if (project.leaderUid === currentUid) {
      ids.add(project.projectCode)
    }
    if (project.subProjects?.length) {
      collectLeaderProjectCodes(project.subProjects, currentUid, ids)
    }
  })
}

const managedProjectCodes = computed(() => {
  const currentUid = user.value
  const ids = new Set<string>()
  if (!currentUid) return ids

  const userProjects = accountStore.getUserProjects(currentUid)
  ;(userProjects?.managed || []).forEach(project => ids.add(project.projectCode))
  collectLeaderProjectCodes(projectTree.value, currentUid, ids)

  return ids
})

const managedProjectCodeList = computed(() => Array.from(managedProjectCodes.value))

const isManagedProjectNode = (project: Project) => managedProjectCodes.value.has(project.projectCode)

const canLoadRepoDocuments = (project: Project) => {
  return !!(project.repoUrl && !project.isGroup)
}

const countRepositories = (projects: Project[]): number => {
  return projects.reduce((total, project) => {
    const childCount = project.subProjects?.length ? countRepositories(project.subProjects) : 0
    return total + (canLoadRepoDocuments(project) ? 1 : 0) + childCount
  }, 0)
}

const projectRepoCount = computed(() => countRepositories(projectTree.value))

const loadProjectTree = async (force = false) => {
  if (!force && projectTree.value.length > 0) return

  projectTreeLoading.value = true
  try {
    const response = await accountStore.fetchProjects({
      include_template: 'false'
    })
    projectTree.value = response?.items || []
  } finally {
    projectTreeLoading.value = false
  }
}

// 当前选中的项目
const currentProject = computed(() => accountStore.getSelectedProject())
// const currentParentProjectCode = computed(() => accountStore.selectedParentProjectCode)

const isExpanded = ref(currentProject.value?.isExpanded || false)
watch(currentProject, () => {
  isExpanded.value = currentProject.value?.isExpanded || false
})

// 当前项目是否为管理的项目（包括子项目）
const isManagedProject = computed(() => {
  if (!currentProject.value) {
    return false
  }

  // 最直接的判断：当前用户是否是项目负责人
  if (currentProject.value.leaderUid === user.value) {
    return true
  }

  // 备用判断：递归检查项目是否在管理项目树中
  const checkInTree = (projects: Project[]): boolean => {
    for (const p of projects) {
      if (p.projectCode === currentProject.value?.projectCode) return true
      if (p.subProjects?.length && checkInTree(p.subProjects)) return true
    }
    return false
  }

  const userProjects = user.value ? accountStore.getUserProjects(user.value) : null
  const inTree = checkInTree(userProjects?.managed || [])
  return inTree
})

// Toggle project expansion
const toggleProject = async (project: Project) => {
  project.isExpanded = !project.isExpanded
  if (project.isExpanded && canLoadRepoDocuments(project) && !project.documents) {
    project.docsLoading = true
    try {
      await accountStore.loadDocuments(project)
    } finally {
      project.docsLoading = false
    }
  }
}

// 选择项目
const selectProject = async (project: Project) => {
  accountStore.selectedProject = project
  if (canLoadRepoDocuments(project) && !project.documents) {
    project.docsLoading = true
    try {
      await accountStore.loadDocuments(project)
    } finally {
      project.docsLoading = false
    }
  }
}

// Select node
const selectNode = async (nodeId: string, nodeType: 'root' | 'project' | 'folder' | 'document', data?: Project | ProjectFileItem) => {
  selectedNodeId.value = nodeId
  selectedNodeType.value = nodeType
  if (nodeType === 'project') {
    const project = data as Project
    await selectProject(project)
    const hasChildren = (project.subProjects?.length || 0) > 0
    if (!project.isExpanded && (hasChildren || canLoadRepoDocuments(project))) {
      await toggleProject(project)
    }
  } else if (nodeType === 'document' && data) {
    await loadDocumentPreview(data as ProjectFileItem)
    accountStore.selectDocument(data as ProjectFileItem)
  } else {
    previewContent.value = ''
    previewDoc.value = null
  }
}

// Load document preview
const loadDocumentPreview = async (docData: ProjectFileItem) => {
  previewDoc.value = docData
  previewLoading.value = true
  previewContent.value = ''

  // 检查是否有冲突
  if (docData.conflictStatus) {
    initialConflictPath.value = docData.path
    showConflictModal.value = true
    previewLoading.value = false
    return
  }

  try {
    if (docData.uuid) {
      const response = await $fetch<{ success: boolean, data: { content?: string } }>(`/api/documents/${docData.uuid}`)
      if (response.success && response.data) {
        previewContent.value = response.data.content || ''
      }
    } else if (docData.path) {
      const response = await $fetch<{ success: boolean, content?: string }>('/api/documents/download-content', {
        method: 'POST',
        body: {
          oss_path: docData.path,
          doc_type: 'git-project'
        }
      })
      if (response.success) {
        previewContent.value = response.content || ''
      }
    }
  } catch {
    toast.add({
      title: '加载失败',
      description: '无法加载文档内容',
      color: 'error'
    })
  } finally {
    previewLoading.value = false
  }
}

// 同步文档
const syncDocs = async () => {
  if (!currentProject.value) return

  try {
    const result = await accountStore.syncDocuments()

    const newFiles = result.new || []
    const updatedFiles = result.updated || []
    const conflictFiles = result.conflict || []
    const deleteFiles = result.deleted || []

    if (conflictFiles.length > 0 || deleteFiles.length > 0) {
      showConflictModal.value = true
      toast.add({
        title: '同步完成，但有冲突',
        description: `新增 ${newFiles.length} 个，更新 ${updatedFiles.length} 个，冲突 ${conflictFiles.length} 个`,
        color: 'warning'
      })
    } else {
      toast.add({
        title: '同步成功',
        description: `新增 ${newFiles.length} 个，更新 ${updatedFiles.length} 个`,
        color: 'success'
      })
    }
  } catch (err: unknown) {
    toast.add({
      title: '同步失败',
      description: err instanceof Error ? err.message : '同步项目文档失败',
      color: 'error'
    })
  }
}

// 提交文档
const submitDocs = async () => {
  if (!currentProject.value) return
  const uid = user.value
  if (!uid) {
    toast.add({
      title: '提交失败',
      description: '未获取到当前用户信息',
      color: 'error'
    })
    return
  }

  try {
    await accountStore.submitDocuments(uid)
    toast.add({
      title: '提交成功',
      description: '已提交到 GitLab',
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: '提交失败',
      description: err instanceof Error ? err.message : '提交项目文档失败',
      color: 'error'
    })
  }
}

// 解决冲突
const resolveConflicts = async (docs: ConflictDoc[]) => {
  const uid = user.value
  if (!uid) {
    toast.add({
      title: '操作失败',
      description: '未获取到当前用户信息',
      color: 'error'
    })
    return
  }

  try {
    await accountStore.resolveConflicts(uid, docs)
    showConflictModal.value = false
    toast.add({
      title: '冲突已解决',
      description: `已处理 ${docs.length} 个文件`,
      color: 'success'
    })
    if (currentProject.value) {
      await accountStore.loadDocuments(currentProject.value)
    }
  } catch (err: unknown) {
    toast.add({
      title: '解决冲突失败',
      description: err instanceof Error ? err.message : '操作失败',
      color: 'error'
    })
  }
}

// 打开冲突解决弹窗
const openConflictModal = () => {
  const collectConflicts = (items: ProjectFileItem[]): GitlabFileInfo[] => {
    const conflicts: GitlabFileInfo[] = []
    for (const item of items) {
      if (!item.isDirectory && item.conflictStatus === true) {
        const ossPath = item.ossPath || item.path
        const pathParts = ossPath.split('/')
        const projectIndex = pathParts.indexOf('git_projects')
        const docPath = projectIndex >= 0 ? pathParts.slice(projectIndex + 2).join('/') : item.name

        conflicts.push({
          doc_path: docPath,
          oss_path: ossPath,
          gitlab_commit_id: item.gitlabLatestCommitId || '',
          gitlab_commit_time: item.lastModified || '',
          content_size: item.gitlabLatestSize ? parseInt(item.gitlabLatestSize) : 0,
          diff: ''
        })
      }
      if (item.children) {
        conflicts.push(...collectConflicts(item.children))
      }
    }
    return conflicts
  }

  const conflicts = collectConflicts(currentProject.value?.documents || [])
  accountStore.syncResult = {
    new: [],
    updated: [],
    nochange: [],
    conflict: conflicts,
    deleted: []
  }

  showConflictModal.value = true
}

// 导航到编辑页面
const navigateToEdit = (uuid: string) => {
  if (previewDoc.value?.uuid === uuid && previewContent.value) {
    setDocumentPreviewBootstrap(uuid, {
      content: previewContent.value
    })
  }

  navigateTo(`/documents/${uuid}`)
}

// 检查是否有冲突（从文档列表或同步结果中判断）
const hasConflicts = computed(() => {
  // 检查同步结果中的未解决冲突
  const syncResult = accountStore.syncResult
  if (syncResult) {
    if ((syncResult.conflict && syncResult.conflict.length > 0)
      || (syncResult.deleted && syncResult.deleted.length > 0)) {
      return true
    }
  }
  // 检查文档列表中的冲突状态
  const checkConflicts = (items: ProjectFileItem[]): boolean => {
    for (const item of items) {
      if (!item.isDirectory && item.conflictStatus === true) {
        return true
      }
      if (item.children && checkConflicts(item.children)) {
        return true
      }
    }
    return false
  }
  return checkConflicts(currentProject.value?.documents || [])
})

// 页面加载时获取项目列表
onMounted(async () => {
  const uid = user.value
  if (!uid) {
    toast.add({
      title: '未登录',
      description: '请先登录后再访问',
      color: 'warning'
    })
    return
  }

  try {
    await Promise.all([
      loadProjectTree(true),
      accountStore.fetchUserProjects(uid, true)
    ])
  } catch {
    toast.add({
      title: '加载失败',
      description: '获取项目列表失败',
      color: 'error'
    })
  }

  // if (currentParentProjectCode.value) {
  //   selectedNodeId.value = `project-${currentParentProjectCode.value}`
  //   selectedNodeType.value = 'project'
  // }
  // Restore selection if project is already selected
  if (accountStore.getSelectedProject() && accountStore.getSelectedProject()!.projectCode) {
    const projectCode = accountStore.getSelectedProject()!.projectCode
    selectedNodeId.value = `project-${projectCode}`
    selectedNodeType.value = 'project'
  }
  if (accountStore.getSelectedDocument() && accountStore.getSelectedDocument()!.uuid) {
    const doc = accountStore.getSelectedDocument()!
    // 仅定位到文档所在目录，不恢复文档预览
    const parentPath = doc.path ? doc.path.split('/').slice(0, -1).join('/') : ''
    if (parentPath) {
      selectedNodeId.value = `folder-${parentPath}`
      selectedNodeType.value = 'folder'
    }
    accountStore.$patch({ selectedProjectDoc: null })
  }
})

const refreshProjectTree = async () => {
  const currentUid = user.value
  if (!currentUid || refreshingProjectTree.value) return

  refreshingProjectTree.value = true
  try {
    await Promise.all([
      loadProjectTree(true),
      accountStore.fetchUserProjects(currentUid, true)
    ])
    toast.add({
      title: '项目列表已刷新',
      color: 'success'
    })
  } catch {
    toast.add({
      title: '刷新失败',
      description: '获取项目列表失败',
      color: 'error'
    })
  } finally {
    refreshingProjectTree.value = false
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <!-- 两列布局 -->
    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：项目和文档树 -->
      <aside class="w-64 border-r border-default bg-default flex flex-col overflow-y-auto">
        <div class="flex-1 p-2">
          <!-- 加载状态 -->
          <div v-if="projectTreeLoading || accountStore.projectsLoading" class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-primary" />
          </div>

          <!-- 项目树 -->
          <div v-else class="space-y-0.5">
            <div class="flex items-center justify-between px-2 py-1">
              <span class="text-xs font-semibold text-muted uppercase tracking-wider">
                GitLab 代码库 ({{ projectRepoCount }})
              </span>
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-refresh-cw"
                :loading="refreshingProjectTree"
                aria-label="刷新代码库列表"
                @click="refreshProjectTree"
              />
            </div>

            <template v-if="projectTree.length > 0">
              <ProjectTreeItem
                v-for="project in projectTree"
                :key="project.projectCode"
                :project="project"
                :is-selected="selectedNodeId === `project-${project.projectCode}`"
                :is-managed="isManagedProjectNode(project)"
                :managed-project-codes="managedProjectCodeList"
                :selected-node-id="selectedNodeId"
                :is-expanded="project.isExpanded"
                :only-group="false"
                :docs-loading="docsLoading"
                @select="(id: string, type: 'root' | 'project' | 'folder' | 'document', data?: unknown) => selectNode(id, type, data as Project | ProjectFileItem | undefined)"
                @toggle="(project) => toggleProject(project)"
              />
            </template>

            <!-- 无项目 -->
            <div
              v-else
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <UIcon name="i-lucide-folder-open" class="w-12 h-12 text-muted mb-3" />
              <p class="text-sm text-muted">
                暂无代码库
              </p>
            </div>
          </div>
        </div>
      </aside>

      <!-- 右侧：预览区域 -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- 未选择 -->
        <div v-if="selectedNodeType === 'root'" class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <UIcon name="i-lucide-folder-git-2" class="w-16 h-16 text-muted mb-4 mx-auto" />
            <p class="text-lg font-medium text-muted">
              请选择一个项目
            </p>
          </div>
        </div>

        <!-- 选中项目 -->
        <template v-else-if="selectedNodeType === 'project' && currentProject">
          <!-- Toolbar -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-default bg-default">
            <div class="flex items-center gap-2">
              <UIcon
                :name="currentProject.isGroup ? 'i-lucide-folder-tree' : 'i-lucide-folder-git-2'"
                class="w-5 h-5 text-gray-500"
              />
              <span class="font-medium">{{ currentProject.name }}</span>
            </div>
          </div>

          <!-- Project Info -->
          <div class="flex-1 overflow-auto p-8">
            <div class="max-w-3xl mx-auto space-y-6">
              <!-- 项目基本信息 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h3 class="text-lg font-semibold">
                      项目信息
                    </h3>

                    <div v-if="isManagedProject" class="flex items-center gap-1">
                      <!-- GitLab 操作：非模版项目且配置了仓库地址 -->
                      <template v-if="!currentProject.isTemplate && !currentProject.isGroup && currentProject.repoUrl">
                        <UButton
                          v-if="hasConflicts"
                          icon="i-lucide-git-merge"
                          size="sm"
                          color="warning"
                          @click="openConflictModal"
                        >
                          解决冲突
                        </UButton>
                        <UButton
                          icon="i-lucide-refresh-cw"
                          size="sm"
                          color="secondary"
                          :loading="accountStore.syncing"
                          @click="syncDocs"
                        >
                          从 GitLab 同步
                        </UButton>
                        <UButton
                          icon="i-lucide-upload"
                          size="sm"
                          color="primary"
                          :loading="accountStore.submitting"
                          :disabled="currentProject.filesModifiedCount === 0"
                          @click="submitDocs"
                        >
                          提交到 GitLab
                          <template v-if="currentProject.filesModifiedCount && currentProject.filesModifiedCount > 0">
                            ({{ currentProject.filesModifiedCount }})
                          </template>
                        </UButton>
                      </template>
                    </div>
                  </div>
                </template>

                <div class="space-y-4">
                  <div>
                    <label class="text-sm font-medium text-muted">项目名称</label>
                    <p class="mt-1">
                      {{ currentProject.name }}
                    </p>
                  </div>
                  <div>
                    <label class="text-sm font-medium text-muted">项目ID</label>
                    <p class="mt-1 font-mono text-sm">
                      {{ currentProject.projectCode }}
                    </p>
                  </div>
                  <div v-if="currentProject.repoUrl">
                    <label class="text-sm font-medium text-muted">{{ currentProject.isGroup ? '群组地址' : '代码库地址' }}</label>
                    <p class="mt-1 text-sm break-all">
                      <a
                        :href="currentProject.repoUrl"
                        target="_blank"
                        class="text-primary hover:underline flex items-center gap-1"
                      >
                        {{ currentProject.repoUrl }}
                        <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                      </a>
                    </p>
                  </div>
                  <div v-if="currentProject.docsSyncedAt">
                    <label class="text-sm font-medium text-muted">最后同步时间</label>
                    <p class="mt-1 text-sm">
                      {{ new Date(currentProject.docsSyncedAt).toLocaleString() }}
                    </p>
                  </div>
                  <div v-if="currentProject.docsCommittedAt">
                    <label class="text-sm font-medium text-muted">最后提交时间</label>
                    <p class="mt-1 text-sm">
                      {{ new Date(currentProject.docsCommittedAt).toLocaleString() }}
                    </p>
                  </div>
                </div>
              </UCard>

              <!-- 统计信息 -->
              <div v-if="!currentProject.isGroup && !currentProject.isTemplate" class="grid grid-cols-3 gap-4">
                <UCard>
                  <div class="text-center">
                    <div class="text-3xl font-bold text-primary">
                      {{ currentProject.documents?.length || 0 }}
                    </div>
                    <div class="text-sm text-muted mt-1">
                      文档数量
                    </div>
                  </div>
                </UCard>
                <UCard>
                  <div class="text-center">
                    <div class="text-3xl font-bold text-warning">
                      {{ currentProject.filesModifiedCount || 0 }}
                    </div>
                    <div class="text-sm text-muted mt-1">
                      待提交
                    </div>
                  </div>
                </UCard>
                <UCard>
                  <div class="text-center">
                    <div class="text-3xl font-bold" :class="hasConflicts ? 'text-red-500' : 'text-green-500'">
                      {{ hasConflicts ? '有冲突' : '正常' }}
                    </div>
                    <div class="text-sm text-muted mt-1">
                      状态
                    </div>
                  </div>
                </UCard>
              </div>
            </div>
          </div>
        </template>

        <!-- 选中文档 -->
        <template v-else-if="selectedNodeType === 'document' && previewDoc">
          <!-- Toolbar -->
          <div class="flex items-center justify-between px-4 py-3 border-b border-default bg-default">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500" />
              <span class="font-medium">{{ previewDoc.name }}</span>
              <UBadge
                v-if="previewDoc.isModified"
                color="warning"
                variant="subtle"
                size="sm"
              >
                已修改
              </UBadge>
              <UBadge
                v-if="previewDoc.conflictStatus"
                color="error"
                variant="subtle"
                size="sm"
              >
                冲突
              </UBadge>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                v-if="previewDoc.conflictStatus"
                icon="i-lucide-git-merge"
                size="sm"
                color="warning"
                @click="() => { initialConflictPath = previewDoc!.path; openConflictModal() }"
              >
                解决冲突
              </UButton>
              <UButton
                v-if="previewDoc.uuid"
                icon="i-lucide-edit"
                size="sm"
                color="primary"
                @click="navigateToEdit(previewDoc.uuid)"
              >
                编辑
              </UButton>
            </div>
          </div>

          <!-- Preview Content -->
          <div class="flex-1 overflow-auto p-4">
            <div class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full p-0 relative">
              <!-- Loading -->
              <div
                v-if="previewLoading"
                class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10"
              >
                <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
              </div>

              <!-- Content -->
              <EditorMilkdownEditor
                v-if="previewContent && !previewLoading"
                :model-value="previewContent"
                :show-sidebar="false"
                readonly
                container-height="100%"
              />
            </div>
          </div>
        </template>
      </main>
    </div>

    <!-- Conflict Resolve Modal -->
    <ConflictResolveModal
      v-if="showConflictModal"
      :project-code="currentProject?.projectCode || ''"
      :conflicts="accountStore.syncResult?.conflict || []"
      :deletes="accountStore.syncResult?.deleted || []"
      :initial-path="initialConflictPath"
      @resolve="resolveConflicts"
      @close="showConflictModal = false"
    />
  </UDashboardPanel>
</template>
