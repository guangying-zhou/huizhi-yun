<script setup lang="ts">
import type {
  ProjectPortfolio,
  UpdatePortfolioRequest,
  AimsProject,
  PaginatedList
} from '~/types/aims'
import type { DocumentNode } from '~/components/document/DocumentTree.vue'
import { projectStatusConfig, projectCategoryConfig } from '~/config/project'

definePageMeta({
  layoutHeader: true
})

const route = useRoute()
const router = useRouter()
const portfolioId = computed(() => Number(route.params.id))
const portfolioStore = usePortfolioStore()

const { users: accountUsers } = useAccountUsers()
const { domains: businessDomains } = useBusinessDomains()
const { flat: deptFlat } = useAccountDepartments()
const { tree: gitGroupTree } = useAccountGitGroups()

// ========================
// Name resolution helpers
// ========================
const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    map.set(u.uid, u.realName?.trim() || u.uid)
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

const deptNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const d of deptFlat.value) {
    if (d.deptCode) map.set(d.deptCode, d.name)
  }
  return map
})

function getDeptName(code: string | null | undefined) {
  if (!code) return '-'
  return deptNameMap.value.get(code) || code
}

const domainNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const d of businessDomains.value) {
    map.set(d.domainCode, d.domainName)
  }
  return map
})

function getDomainName(code: string | null | undefined) {
  if (!code) return '-'
  return domainNameMap.value.get(code) || code
}

// ========================
// Portfolio detail
// ========================
const portfolio = ref<ProjectPortfolio | null>(null)
const portfolioLoading = ref(false)

async function fetchPortfolioDetail() {
  portfolioLoading.value = true
  try {
    const res = await $fetch<{ code: number, data: ProjectPortfolio }>(
      `/api/v1/portfolios/${portfolioId.value}`
    )
    if (res.code === 0) {
      portfolio.value = res.data
    }
  } catch (err) {
    console.error('[PortfolioDetail] Failed to fetch portfolio:', err)
  } finally {
    portfolioLoading.value = false
  }
}

// ========================
// Projects under portfolio
// ========================
const projects = ref<AimsProject[]>([])
const projectsLoading = ref(false)

async function fetchProjects() {
  projectsLoading.value = true
  try {
    const res = await $fetch<{ code: number, data: PaginatedList<AimsProject> }>(
      '/api/v1/projects',
      { params: { portfolioId: portfolioId.value, pageSize: 100 } }
    )
    if (res.code === 0) {
      projects.value = res.data.items
    }
  } catch (err) {
    console.error('[PortfolioDetail] Failed to fetch projects:', err)
  } finally {
    projectsLoading.value = false
  }
}

// ========================
// Documents
// ========================
interface RawDocument {
  id: number
  uuid?: string
  title: string
  type: 'folder' | 'document'
  parentId: number | null
  category?: string
  codocsUuid?: string | null
  updatedAt?: string
}

const rawDocuments = ref<RawDocument[]>([])
const documentsLoading = ref(false)

// API 返回树形结构，需要展平为 flat list 再由前端 buildTree
interface RawDocNode {
  id: number
  uuid?: string
  title: string
  isFolder?: boolean
  is_folder?: boolean | number
  parentId?: number | null
  parent_id?: number | null
  docCategory?: string
  doc_category?: string | null
  codocsUuid?: string | null
  codocs_uuid?: string | null
  updatedAt?: string
  updated_at?: string
  children?: RawDocNode[]
}

interface DocumentListResponse {
  code: number
  data: RawDocNode[] | { items?: RawDocNode[] }
}

function flattenDocs(nodes: RawDocNode[]): RawDocNode[] {
  const result: RawDocNode[] = []
  for (const node of nodes) {
    const { children, ...rest } = node
    result.push(rest)
    if (children?.length) {
      result.push(...flattenDocs(children))
    }
  }
  return result
}

async function fetchDocuments() {
  documentsLoading.value = true
  try {
    const res = await $fetch<DocumentListResponse>(
      '/api/v1/documents',
      { params: { portfolio_id: portfolioId.value } }
    )
    if (res.code === 0) {
      const nodes = Array.isArray(res.data) ? res.data : (res.data.items || [])
      rawDocuments.value = flattenDocs(nodes).map(d => ({
        id: d.id,
        uuid: d.uuid,
        title: d.title,
        type: (d.isFolder ?? Boolean(d.is_folder)) ? 'folder' as const : 'document' as const,
        parentId: d.parentId ?? d.parent_id ?? null,
        category: d.docCategory ?? d.doc_category ?? undefined,
        codocsUuid: d.codocsUuid ?? d.codocs_uuid ?? null,
        updatedAt: d.updatedAt ?? d.updated_at
      }))
    }
  } catch (err) {
    console.error('[PortfolioDetail] Failed to fetch documents:', err)
  } finally {
    documentsLoading.value = false
  }
}

// Build tree from flat list
function buildTree(items: RawDocument[]): DocumentNode[] {
  const map = new Map<number, DocumentNode>()
  const roots: DocumentNode[] = []

  for (const item of items) {
    map.set(item.id, { ...item, children: [] })
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

const documentTree = computed(() => buildTree(rawDocuments.value))

// ========================
// 新建文件夹/文档弹窗
// ========================
const showCreateDocModal = ref(false)
const createDocIsFolder = ref(false)
const createDocParentId = ref<number | null>(null)
const createDocTitle = ref('')
const creatingDoc = ref(false)

function handleCreateFolder(parentId: number | null) {
  createDocIsFolder.value = true
  createDocParentId.value = parentId
  createDocTitle.value = ''
  showCreateDocModal.value = true
}

function handleCreateDoc(parentId: number | null) {
  createDocIsFolder.value = false
  createDocParentId.value = parentId
  createDocTitle.value = ''
  showCreateDocModal.value = true
}

async function submitCreateDoc() {
  if (!createDocTitle.value.trim()) return
  creatingDoc.value = true
  try {
    await $fetch('/api/v1/documents', {
      method: 'POST',
      body: {
        title: createDocTitle.value.trim(),
        isFolder: createDocIsFolder.value,
        parentId: createDocParentId.value,
        portfolioId: portfolioId.value
      }
    })
    showCreateDocModal.value = false
    await fetchDocuments()
  } catch (err) {
    console.error('[PortfolioDetail] Failed to create:', err)
  } finally {
    creatingDoc.value = false
  }
}

// ========================
// 删除确认弹窗
// ========================
const showDeleteDocModal = ref(false)
const deleteDocId = ref<number | null>(null)
const deleteDocTitle = ref('')
const deletingDoc = ref(false)

function handleDeleteDocument(id: number) {
  const doc = rawDocuments.value.find(d => d.id === id)
  deleteDocTitle.value = doc?.title || ''
  deleteDocId.value = id
  showDeleteDocModal.value = true
}

async function confirmDeleteDocument() {
  if (!deleteDocId.value) return
  deletingDoc.value = true
  try {
    await $fetch(`/api/v1/documents/${deleteDocId.value}`, { method: 'DELETE' })
    showDeleteDocModal.value = false
    await fetchDocuments()
  } catch (err) {
    console.error('[PortfolioDetail] Failed to delete document:', err)
  } finally {
    deletingDoc.value = false
  }
}

// ========================
// Codocs 嵌入式编辑器
// ========================
const showEditorModal = ref(false)
const editorDoc = ref<DocumentNode | null>(null)
const editorCodocsUuid = ref('')

function handleClickDoc(doc: DocumentNode) {
  if (doc.type === 'folder') return
  if (!doc.uuid) return
  editorDoc.value = doc
  editorCodocsUuid.value = doc.uuid
  showEditorModal.value = true
}

const codocsEditorRef = ref<{ save: () => void } | null>(null)

// ========================
// 创建项目
// ========================
function handleCreateProject() {
  navigateTo(`/projects/new?portfolioId=${portfolioId.value}`)
}

async function closeEditor() {
  // 关闭前触发保存
  codocsEditorRef.value?.save()
  // 等待一小段时间让保存请求发出
  await new Promise(r => setTimeout(r, 500))
  showEditorModal.value = false
  editorCodocsUuid.value = ''
  editorDoc.value = null
  fetchDocuments()
}

// ========================
// Edit portfolio modal
// ========================
const showEditModal = ref(false)
const editSaving = ref(false)
const editForm = ref<UpdatePortfolioRequest>({
  name: '',
  description: '',
  domainCode: '',
  ownerUid: '',
  deptCode: '',
  gitGroup: '',
  isProductLine: false,
  displayOrder: 0
})

function normalizeDisplayOrder(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

function openEditModal() {
  if (!portfolio.value) return
  editForm.value = {
    name: portfolio.value.name,
    description: portfolio.value.description || '',
    domainCode: portfolio.value.domainCode || '',
    ownerUid: portfolio.value.ownerUid || '',
    deptCode: portfolio.value.deptCode || '',
    gitGroup: portfolio.value.gitGroup || '',
    isProductLine: portfolio.value.isProductLine,
    displayOrder: normalizeDisplayOrder(portfolio.value.displayOrder)
  }
  showEditModal.value = true
}

const userOptions = computed(() => {
  return accountUsers.value.map(u => ({
    label: u.realName?.trim() || u.uid,
    value: u.uid
  }))
})

const deptOptions = computed(() => {
  return deptFlat.value
    .filter(d => d.deptCode)
    .map(d => ({
      label: d.name,
      value: d.deptCode!
    }))
})

const domainOptions = computed(() => {
  return businessDomains.value.map(d => ({
    label: d.domainName,
    value: d.domainCode
  }))
})

const userMap = computed(() => {
  const map = new Map<string, typeof accountUsers.value[0]>()
  for (const u of accountUsers.value) {
    if (!map.has(u.uid)) map.set(u.uid, u)
  }
  return map
})

function onEditOwnerChange(uid: string | null) {
  editForm.value.ownerUid = uid
  if (uid) {
    const user = userMap.value.get(uid)
    if (user?.deptCode) {
      editForm.value.deptCode = user.deptCode
    }
  }
}

async function handleSaveEdit() {
  editSaving.value = true
  try {
    editForm.value.displayOrder = normalizeDisplayOrder(editForm.value.displayOrder)
    await portfolioStore.updatePortfolio(portfolioId.value, editForm.value)
    showEditModal.value = false
    await fetchPortfolioDetail()
  } catch (err) {
    console.error('[PortfolioDetail] Failed to update portfolio:', err)
  } finally {
    editSaving.value = false
  }
}

// ========================
// Status config
// ========================
const portfolioStatusMap: Record<string, { label: string, color: string }> = {
  active: { label: '活跃', color: 'success' },
  archived: { label: '已归档', color: 'neutral' }
}

function getStatusConfig(status: string) {
  return portfolioStatusMap[status] || { label: status, color: 'neutral' }
}

// ========================
// Initialize
// ========================
onMounted(async () => {
  await Promise.all([
    fetchPortfolioDetail(),
    fetchProjects(),
    fetchDocuments()
  ])
})
</script>

<template>
  <UDashboardPanel
    id="portfolio-detail"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <!-- Header (non-scrolling) -->
        <div class="shrink-0 border-b border-default px-6 py-4">
          <div v-if="portfolioLoading" class="flex items-center gap-3">
            <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-muted" />
            <span class="text-sm text-muted">加载中...</span>
          </div>
          <div v-else-if="portfolio" class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <h1 class="text-xl font-bold truncate">
                {{ portfolio.name }}
              </h1>
              <UButton
                icon="i-lucide-pencil"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                title="编辑项目集"
                @click="openEditModal"
              />
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ portfolio.code }}
              </UBadge>
              <UBadge
                :color="getStatusConfig(portfolio.status).color as any"
                variant="subtle"
                size="sm"
              >
                {{ getStatusConfig(portfolio.status).label }}
              </UBadge>
              <UBadge
                v-if="portfolio.isProductLine"
                color="primary"
                variant="soft"
                size="sm"
              >
                产品线
              </UBadge>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <UButton
                icon="i-lucide-plus"
                label="创建项目"
                color="primary"
                size="sm"
                @click="handleCreateProject"
              />
              <UButton
                icon="i-lucide-arrow-left"
                label="返回项目总览"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="router.push('/projects')"
              />
            </div>
          </div>

          <!-- Portfolio meta info -->
          <div v-if="portfolio" class="flex items-center gap-6 mt-2 text-sm text-muted">
            <span v-if="portfolio.ownerUid">
              <span class="text-dimmed">负责人:</span> {{ getUserName(portfolio.ownerUid) }}
            </span>
            <span v-if="portfolio.deptCode">
              <span class="text-dimmed">部门:</span> {{ getDeptName(portfolio.deptCode) }}
            </span>
            <span v-if="portfolio.domainCode">
              <span class="text-dimmed">业务领域:</span> {{ getDomainName(portfolio.domainCode) }}
            </span>
            <span v-if="portfolio.gitGroup">
              <span class="text-dimmed">Git群组:</span> {{ portfolio.gitGroup }}
            </span>
            <span v-if="portfolio.description" class="truncate max-w-md">
              <span class="text-dimmed">描述:</span> {{ portfolio.description }}
            </span>
          </div>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-12 space-y-6">
          <!-- Project cards -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-folder-kanban" class="w-4 h-4 text-primary" />
                <span class="font-semibold">项目集项目</span>
                <UBadge
                  v-if="projects.length > 0"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                >
                  {{ projects.length }}
                </UBadge>
              </div>
            </template>

            <div v-if="projectsLoading" class="flex justify-center py-8">
              <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
            </div>

            <div v-else-if="projects.length === 0" class="text-center py-8 text-sm text-muted">
              此项目集暂无项目
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <UCard
                v-for="project in projects"
                :key="project.id"
                class="cursor-pointer hover:ring-1 hover:ring-primary/50 transition-all"
                @click="router.push(`/projects/${project.id}`)"
              >
                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <h3 class="font-semibold text-sm truncate flex-1">
                      {{ project.shortName || project.name }}
                    </h3>
                    <UBadge
                      :color="(projectStatusConfig[project.lifecycleStatus]?.color || 'neutral') as any"
                      variant="subtle"
                      size="xs"
                    >
                      {{ projectStatusConfig[project.lifecycleStatus]?.label || project.lifecycleStatus }}
                    </UBadge>
                  </div>

                  <div class="text-xs text-muted font-mono">
                    {{ project.projectCode }}
                  </div>

                  <div class="flex items-center gap-3 text-xs text-muted">
                    <span v-if="project.category">
                      {{ projectCategoryConfig[project.category]?.label || project.category }}
                    </span>
                    <span v-if="project.leaderUid">
                      {{ getUserName(project.leaderUid) }}
                    </span>
                  </div>
                </div>
              </UCard>
            </div>
          </UCard>

          <!-- Document management -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-file-text" class="w-4 h-4 text-info" />
                  <span class="font-semibold">项目集文档</span>
                  <UBadge
                    v-if="rawDocuments.length > 0"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ rawDocuments.length }}
                  </UBadge>
                </div>
                <div class="flex items-center gap-2">
                  <UButton
                    icon="i-lucide-folder-plus"
                    label="新建文件夹"
                    color="neutral"
                    variant="soft"
                    size="sm"
                    @click="handleCreateFolder(null)"
                  />
                  <UButton
                    icon="i-lucide-file-plus"
                    label="新建文档"
                    color="primary"
                    variant="soft"
                    size="sm"
                    @click="handleCreateDoc(null)"
                  />
                </div>
              </div>
            </template>

            <DocumentTree
              :documents="documentTree"
              :loading="documentsLoading"
              @create-folder="handleCreateFolder"
              @create-doc="handleCreateDoc"
              @delete="handleDeleteDocument"
              @click-doc="handleClickDoc"
            />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Edit portfolio modal -->
  <UModal v-model:open="showEditModal" :ui="{ content: 'sm:max-w-lg' }">
    <template #header>
      <h3 class="text-lg font-semibold">
        编辑项目集
      </h3>
    </template>
    <template #body>
      <div class="p-4 space-y-4">
        <UFormField label="项目集名称">
          <UInput v-model="editForm.name" placeholder="请输入项目集名称" class="w-full" />
        </UFormField>

        <UFormField label="项目集编码">
          <UInput :model-value="portfolio?.code" disabled class="w-full" />
        </UFormField>

        <UFormField label="显示顺序" description="数字越小越靠前">
          <UInput
            :model-value="String(editForm.displayOrder ?? 0)"
            type="number"
            min="0"
            step="1"
            placeholder="0"
            class="w-full"
            @update:model-value="value => editForm.displayOrder = normalizeDisplayOrder(value)"
          />
        </UFormField>

        <UFormField label="描述">
          <UInput v-model="editForm.description as string" placeholder="请输入描述" class="w-full" />
        </UFormField>

        <UFormField label="负责人">
          <USelectMenu
            :model-value="editForm.ownerUid ?? undefined"
            :items="userOptions"
            value-key="value"
            placeholder="选择负责人"
            searchable
            class="w-full"
            @update:model-value="onEditOwnerChange"
          />
        </UFormField>

        <UFormField label="部门">
          <USelectMenu
            :model-value="editForm.deptCode ?? undefined"
            :items="deptOptions"
            value-key="value"
            placeholder="选择部门"
            searchable
            class="w-full"
            @update:model-value="(v: string) => editForm.deptCode = v"
          />
        </UFormField>

        <UFormField label="业务领域">
          <USelectMenu
            :model-value="editForm.domainCode ?? undefined"
            :items="domainOptions"
            value-key="value"
            placeholder="选择业务领域"
            searchable
            class="w-full"
            @update:model-value="(v: string) => editForm.domainCode = v"
          />
        </UFormField>

        <UFormField label="Git群组">
          <GitGroupTreeSelector
            :model-value="editForm.gitGroup"
            :tree="gitGroupTree"
            placeholder="选择 GitLab 群组"
            @update:model-value="(v: string) => editForm.gitGroup = v"
          />
        </UFormField>

        <UFormField>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="editForm.isProductLine"
              type="checkbox"
              class="rounded border-default text-primary focus:ring-primary"
            >
            <span class="text-sm">标记为产品线</span>
          </label>
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showEditModal = false"
        />
        <UButton
          label="保存"
          color="primary"
          :loading="editSaving"
          @click="handleSaveEdit"
        />
      </div>
    </template>
  </UModal>

  <!-- Codocs 嵌入式编辑器弹窗 -->
  <UModal
    v-model:open="showEditorModal"
    :ui="{ content: 'sm:max-w-6xl max-h-[90vh]' }"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-file-edit" class="size-5 text-primary" />
          <h3 class="text-lg font-semibold">
            {{ editorDoc?.title || '编辑文档' }}
          </h3>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          @click="closeEditor"
        />
      </div>
    </template>
    <template #body>
      <div class="p-0" style="height: calc(90vh - 80px);">
        <CodocsEditor
          v-if="editorCodocsUuid"
          ref="codocsEditorRef"
          :uuid="editorCodocsUuid"
          :show-title="false"
        />
      </div>
    </template>
  </UModal>

  <!-- 新建文件夹/文档弹窗 -->
  <UModal v-model:open="showCreateDocModal">
    <template #header>
      <h3 class="text-lg font-semibold">
        {{ createDocIsFolder ? '新建文件夹' : '新建文档' }}
      </h3>
    </template>
    <template #body>
      <div class="p-4">
        <UFormField :label="createDocIsFolder ? '文件夹名称' : '文档名称'" required>
          <UInput
            v-model="createDocTitle"
            :placeholder="createDocIsFolder ? '如：需求文档' : '如：产品规划书'"
            class="w-full"
            autofocus
            @keydown.enter.prevent="submitCreateDoc"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showCreateDocModal = false"
        />
        <UButton
          label="创建"
          color="primary"
          :loading="creatingDoc"
          :disabled="!createDocTitle.trim()"
          @click="submitCreateDoc"
        />
      </div>
    </template>
  </UModal>

  <!-- 删除确认弹窗 -->
  <UModal v-model:open="showDeleteDocModal">
    <template #header>
      <h3 class="text-lg font-semibold">
        确认删除
      </h3>
    </template>
    <template #body>
      <div class="p-4">
        <p class="text-sm">
          确定删除 <strong>{{ deleteDocTitle }}</strong> 吗？文件夹下的所有内容也会被删除，此操作不可撤销。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showDeleteDocModal = false"
        />
        <UButton
          label="确认删除"
          color="error"
          :loading="deletingDoc"
          @click="confirmDeleteDocument"
        />
      </div>
    </template>
  </UModal>
</template>
