<script setup lang="ts">
import type { AimsProject, ProjectPortfolio } from '~/types/aims'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目文档',
  layoutHeaderProjectSwitcher: false
})

interface AccessibleDocument {
  id: number
  uuid: string
  title: string
  projectId: number | null
  projectCode: string | null
  milestoneId: number | null
  workItemId: number | null
  parentId: number | null
  docCategory: string | null
  isFolder: boolean
  codocsUuid: string | null
  documentSource: 'codocs' | 'repo'
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  ossPath: string | null
  contentSize: number
  createdBy: string
  createdAt: string
  updatedAt: string
  sortOrder: number
  accessLifecycleStage: 'draft' | 'formal' | 'archived'
  accessConfidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  accessSummary: string
  accessReadonly: boolean
  accessReason: string | null
  accessPermission: string | null
  virtual?: boolean
  virtualSource?: 'deliverable'
  children?: AccessibleDocument[]
}

interface CabinetPreviewInfo {
  previewable: boolean
  previewType?: string
  previewUrl?: string
  content?: string
  encoding?: string
  truncated?: boolean
  originalName?: string
  fileExt?: string
  fileSize?: number
}

interface ProjectGroup {
  key: string
  label: string
  portfolio: ProjectPortfolio | null
  projects: AimsProject[]
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const runtimeConfig = useRuntimeConfig()
const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()

const selectedProjectId = ref<number | null>(Number(route.query.projectId) || null)
const documents = ref<AccessibleDocument[]>([])
const documentsLoading = ref(false)
const projectDocumentCountOverrides = ref(new Map<number, number>())
const previewDoc = ref<AccessibleDocument | null>(null)
const showPreviewModal = ref(false)
const otherPreviewInfo = ref<CabinetPreviewInfo | null>(null)
const otherPreviewLoading = ref(false)
const otherPreviewError = ref('')

const categoryLabel: Record<string, string> = {
  general: '通用',
  project_proposal: '立项书',
  requirement_spec: '需求规格',
  design_doc: '设计文档',
  test_doc: '测试文档',
  delivery_doc: '交付文档',
  other_word: 'Word',
  other_excel: 'Excel',
  other_powerpoint: 'PPT',
  other_pdf: 'PDF',
  other_file: '其他文件'
}

const levelLabel: Record<string, string> = {
  L0: '公开',
  L1: '内部',
  L2: '受限',
  L3: '机密'
}

onMounted(async () => {
  await Promise.all([
    projectStore.fetchProjects({ pageSize: 500 }),
    portfolioStore.fetchPortfolios()
  ])

  if (selectedProjectId.value && !accessibleProjects.value.some(project => project.id === selectedProjectId.value)) {
    selectedProjectId.value = null
  }

  if (!selectedProjectId.value && accessibleProjects.value.length > 0) {
    selectedProjectId.value = accessibleProjects.value[0]?.id || null
  } else if (selectedProjectId.value) {
    await loadDocuments(selectedProjectId.value)
  }
})

const accessibleProjects = computed(() => projectStore.projects
  .filter(project => project.canAccess !== false && project.lifecycleStatus !== 'archived')
  .sort((left, right) => {
    if ((left.portfolioId || 0) !== (right.portfolioId || 0)) {
      return (left.portfolioId || 0) - (right.portfolioId || 0)
    }
    return left.name.localeCompare(right.name, 'zh-CN')
  }))

const projectGroups = computed<ProjectGroup[]>(() => {
  const portfolioMap = new Map(portfolioStore.portfolios.map(portfolio => [portfolio.id, portfolio]))
  const groups = new Map<string, ProjectGroup>()

  for (const project of accessibleProjects.value) {
    const portfolio = project.portfolioId ? portfolioMap.get(project.portfolioId) || null : null
    const key = portfolio ? String(portfolio.id) : 'none'
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: portfolio?.name || '未归属项目集',
        portfolio,
        projects: []
      })
    }
    groups.get(key)!.projects.push(project)
  }

  return [...groups.values()]
})

const selectedProject = computed(() => accessibleProjects.value.find(project => project.id === selectedProjectId.value) || null)

const visibleDocumentCount = computed(() => documents.value.filter(doc => !doc.isFolder).length)

const documentTree = computed(() => buildDocumentTree(documents.value))

watch(selectedProjectId, async (projectId) => {
  documents.value = []
  if (!projectId) return
  await router.replace({ query: { ...route.query, projectId: String(projectId) } })
  await loadDocuments(projectId)
})

function selectProject(projectId: number) {
  selectedProjectId.value = projectId
}

function projectDocumentCount(project: AimsProject) {
  return projectDocumentCountOverrides.value.get(project.id)
    ?? Math.max(0, Number(project.documentCount || 0))
}

function buildDocumentTree(items: AccessibleDocument[]) {
  const clones = items.map(item => ({ ...item, children: [] as AccessibleDocument[] }))
  const map = new Map<number, AccessibleDocument>()
  const roots: AccessibleDocument[] = []

  for (const item of clones) {
    map.set(item.id, item)
  }

  for (const item of clones) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(item)
    } else {
      roots.push(item)
    }
  }

  return roots
}

async function loadDocuments(projectId: number) {
  documentsLoading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: {
        items: AccessibleDocument[]
        total: number
      }
    }>('/api/v1/project-documents/accessible', {
      params: { projectId }
    })

    if (res.code === 0) {
      documents.value = res.data.items || []
      projectDocumentCountOverrides.value.set(projectId, documents.value.filter(doc => !doc.isFolder).length)
    }
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '加载项目文档失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    documentsLoading.value = false
  }
}

function formatFileSize(size: number | null | undefined) {
  const value = Number(size || 0)
  if (value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function isOtherDocument(doc: AccessibleDocument | null) {
  return Boolean(doc?.docCategory?.startsWith('other_') || doc?.ossPath)
}

function documentIcon(doc: AccessibleDocument) {
  if (doc.isFolder) return 'i-lucide-folder'
  if (doc.docCategory === 'other_pdf') return 'i-lucide-file-text'
  if (doc.docCategory === 'other_excel') return 'i-lucide-file-spreadsheet'
  if (doc.docCategory === 'other_powerpoint') return 'i-lucide-presentation'
  if (doc.docCategory === 'other_word') return 'i-lucide-file-type'
  return 'i-lucide-file-text'
}

function resetOtherPreview() {
  otherPreviewInfo.value = null
  otherPreviewError.value = ''
  otherPreviewLoading.value = false
}

function cabinetPreviewUrl(info: CabinetPreviewInfo | null) {
  const url = String(info?.previewUrl || '').trim()
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return withAppBase(url)
}

function isTextCabinetPreview(info: CabinetPreviewInfo | null) {
  return info?.previewType === 'text' && typeof info.content === 'string'
}

function canRenderCabinetPreview(info: CabinetPreviewInfo | null) {
  return Boolean(info?.previewable && (isTextCabinetPreview(info) || cabinetPreviewUrl(info)))
}

async function loadOtherDocumentPreview(doc: AccessibleDocument) {
  const contextProjectId = doc.projectId || selectedProjectId.value
  resetOtherPreview()
  if (!contextProjectId) {
    otherPreviewError.value = '缺少项目上下文，无法预览'
    otherPreviewInfo.value = { previewable: false }
    return
  }

  otherPreviewLoading.value = true
  try {
    const response = await $fetch<{ code: number, data: CabinetPreviewInfo }>(
      `/api/v1/projects/${contextProjectId}/documents/${doc.id}/preview`
    )
    otherPreviewInfo.value = response.data
  } catch (error: unknown) {
    otherPreviewError.value = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '无法获取在线预览地址'
    otherPreviewInfo.value = { previewable: false }
  } finally {
    otherPreviewLoading.value = false
  }
}

async function openDocument(doc: { id: number, isFolder?: boolean }) {
  if (doc.isFolder) return
  const fullDocument = documents.value.find(item => item.id === doc.id)
  if (!fullDocument || fullDocument.isFolder) return
  resetOtherPreview()
  previewDoc.value = fullDocument
  showPreviewModal.value = true
  if (isOtherDocument(fullDocument)) {
    await loadOtherDocumentPreview(fullDocument)
  }
}

function closePreviewModal() {
  showPreviewModal.value = false
  previewDoc.value = null
  resetOtherPreview()
}

function withAppBase(path: string) {
  const base = String(runtimeConfig.app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}${path.replace(/^\/+/, '')}`
}

function downloadUrl(doc: AccessibleDocument | null) {
  const contextProjectId = doc?.projectId || selectedProjectId.value
  if (!doc || !contextProjectId) return ''
  return withAppBase(`/api/v1/projects/${contextProjectId}/documents/${doc.id}/download`)
}

watch(showPreviewModal, (open) => {
  if (!open) {
    previewDoc.value = null
    resetOtherPreview()
  }
})
</script>

<template>
  <UDashboardPanel id="global-project-documents" :ui="{ root: 'relative flex min-w-0 shrink-0 flex-col h-full', body: 'flex min-h-0 flex-1 flex-col p-0 overflow-hidden' }">
    <template #body>
      <div class="project-documents-shell">
        <aside class="project-documents-sidebar border-b border-default bg-default/30 lg:border-r lg:border-b-0">
          <div class="flex h-full min-h-0 flex-col">
            <div class="px-4 py-2">
              <div class="text-sm font-semibold text-highlighted">
                项目列表
              </div>
              <div class="mt-1 text-xs text-muted">
                {{ accessibleProjects.length }} 个项目
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div v-if="projectStore.loading" class="flex justify-center py-8">
                <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
              </div>
              <div v-else-if="projectGroups.length === 0" class="py-8 text-center text-sm text-muted">
                暂无可访问项目
              </div>
              <div v-else class="space-y-4">
                <section v-for="group in projectGroups" :key="group.key" class="space-y-1.5">
                  <div class="flex items-center gap-2 px-2 text-xs font-medium text-secondary">
                    <UIcon name="i-lucide-folder-kanban" class="size-3.5" />
                    <span class="truncate">{{ group.label }}</span>
                  </div>
                  <button
                    v-for="project in group.projects"
                    :key="project.id"
                    class="flex w-full items-center gap-2 rounded-md pl-6 py-1 text-left text-sm transition-colors"
                    :class="project.id === selectedProjectId ? 'bg-primary/10 text-primary' : 'text-default hover:bg-elevated'"
                    @click="selectProject(project.id)"
                  >
                    <UIcon name="i-lucide-calendar-check" class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{{ project.shortName || project.name }}</span>
                    <UBadge
                      v-if="project.currentUserRole"
                      color="neutral"
                      variant="subtle"
                      size="xs"
                    >
                      {{ project.currentUserRole === 'manager' ? '管理' : project.currentUserRole === 'member' ? '成员'
                        : '查看' }}
                    </UBadge>
                    <span
                      class="inline-flex shrink-0 items-center gap-1 text-xs text-muted"
                      :title="`${projectDocumentCount(project)} 个项目文档`"
                      :aria-label="`${projectDocumentCount(project)} 个项目文档`"
                    >
                      <UIcon name="i-lucide-files" class="size-3.5" />
                      <span>{{ projectDocumentCount(project) }}</span>
                    </span>
                  </button>
                </section>
              </div>
            </div>
          </div>
        </aside>

        <main class="project-documents-main">
          <div class="flex h-full min-h-0 flex-col">
            <div class="flex items-center justify-between gap-4 border-b border-default px-5 py-4">
              <div class="min-w-0">
                <h1 class="truncate text-base font-semibold text-highlighted">
                  {{ selectedProject?.name || '项目文档' }}
                </h1>
                <p class="mt-1 truncate text-xs text-muted">
                  {{ selectedProject ? `${selectedProject.projectCode} · ${visibleDocumentCount} 个可访问文档` : '选择左侧项目查看文档' }}
                </p>
              </div>
              <UButton
                v-if="selectedProject"
                icon="i-lucide-external-link"
                label="进入项目文档"
                color="neutral"
                variant="soft"
                size="sm"
                :to="`/projects/${selectedProject.id}/documents`"
              />
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              <div v-if="documentsLoading" class="flex justify-center py-16">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>
              <div v-else-if="!selectedProject" class="flex h-full min-h-80 items-center justify-center text-sm text-muted">
                请选择一个项目
              </div>
              <div v-else-if="documentTree.length === 0" class="flex h-full min-h-80 items-center justify-center text-sm text-muted">
                当前没有可访问的项目文档
              </div>
              <div v-else class="w-full max-w-5xl divide-y divide-default">
                <ProjectDocumentReadonlyNode
                  v-for="doc in documentTree"
                  :key="doc.id"
                  :document="doc"
                  :level="0"
                  @open="openDocument"
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showPreviewModal" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span class="truncate text-base font-medium">{{ previewDoc?.title || '文档预览' }}</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          aria-label="关闭预览弹窗"
          @click="closePreviewModal"
        />
      </div>
    </template>
    <template #body>
      <div class="h-[72vh] min-h-72 p-4">
        <div
          v-if="previewDoc && isOtherDocument(previewDoc)"
          class="h-full min-h-0"
        >
          <div v-if="otherPreviewLoading" class="flex h-full items-center justify-center gap-2 text-muted">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
            <span class="text-sm">正在准备预览</span>
          </div>
          <div
            v-else-if="canRenderCabinetPreview(otherPreviewInfo)"
            class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-default bg-default"
          >
            <div class="flex shrink-0 items-center gap-3 border-b border-default px-3 py-2 text-sm">
              <UIcon :name="documentIcon(previewDoc)" class="size-4 text-primary" />
              <span class="min-w-0 flex-1 truncate text-highlighted">
                {{ otherPreviewInfo?.originalName || previewDoc.title }}
              </span>
              <span class="shrink-0 text-muted">
                {{ (otherPreviewInfo?.fileExt || '').toUpperCase() }}
              </span>
              <UButton
                icon="i-lucide-download"
                label="下载"
                color="neutral"
                variant="soft"
                size="sm"
                :to="downloadUrl(previewDoc)"
                target="_blank"
              />
            </div>
            <div
              v-if="isTextCabinetPreview(otherPreviewInfo)"
              class="min-h-0 flex-1 overflow-auto bg-elevated"
            >
              <div
                v-if="otherPreviewInfo?.truncated"
                class="border-b border-default px-4 py-2 text-xs text-muted"
              >
                文件较大，仅显示前 2 MB 内容。
              </div>
              <pre class="m-0 whitespace-pre-wrap break-words p-4 font-mono text-sm leading-6 text-highlighted">{{ otherPreviewInfo?.content }}</pre>
            </div>
            <iframe
              v-else
              class="min-h-0 flex-1 border-0 bg-default"
              :src="cabinetPreviewUrl(otherPreviewInfo)"
              :title="previewDoc.title"
            />
          </div>
          <div
            v-else
            class="flex h-full flex-col items-center justify-center rounded-lg border border-default bg-muted/20 p-6 text-center"
          >
            <UIcon :name="documentIcon(previewDoc)" class="mb-4 size-12 text-primary" />
            <h3 class="max-w-full truncate text-base font-semibold text-highlighted">
              {{ previewDoc.title }}
            </h3>
            <div class="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
              <div>类型：{{ categoryLabel[previewDoc.docCategory || ''] || '其他文件' }}</div>
              <div>大小：{{ formatFileSize(previewDoc.contentSize) }}</div>
              <div>生命周期：{{ previewDoc.accessLifecycleStage }}</div>
              <div>密级：{{ levelLabel[previewDoc.accessConfidentialityLevel] || previewDoc.accessConfidentialityLevel }}</div>
            </div>
            <p class="mt-4 max-w-xl text-sm text-muted">
              {{ otherPreviewError || '当前文件类型暂不支持在线预览，请下载后查看。' }}
            </p>
            <div class="mt-5 flex items-center justify-center gap-2">
              <UButton
                icon="i-lucide-download"
                label="下载文件"
                color="primary"
                :to="downloadUrl(previewDoc)"
                target="_blank"
              />
            </div>
          </div>
        </div>
        <AimsDocumentPreview
          v-else-if="previewDoc && showPreviewModal"
          :source="previewDoc.documentSource"
          :codocs-uuid="previewDoc.codocsUuid"
          :project-id="previewDoc.projectId || selectedProjectId"
          :repo-project-code="previewDoc.repoProjectCode"
          :repo-file-path="previewDoc.repoFilePath"
          :repo-commit-id="previewDoc.repoCommitId"
          :title="previewDoc.title"
        />
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.project-documents-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.project-documents-sidebar {
  min-height: 0;
  overflow: hidden;
}

.project-documents-main {
  min-height: 0;
  overflow: hidden;
}

@media (min-width: 1024px) {
  .project-documents-shell {
    grid-template-columns: 320px minmax(0, 1fr);
  }
}
</style>
