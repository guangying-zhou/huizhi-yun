<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useCodocsModule } from '../useCodocsModule'
import PendingDeptShares from '../../app/components/department/PendingDeptShares.vue'
import { departmentDocumentWriteErrorMessage } from '../../app/utils/departmentDocumentWriteError'

// Enterprise Host page for department documents (B1).
// The standalone page (app/pages/departments/index.vue) keeps its own legacy
// data path; this page only talks to the Host `departments/*` routes and never
// sends owner/viewer/actor fields. The server decides access on every call.
definePageMeta({ hostContentInset: false })

interface DepartmentOption { deptCode: string, name: string }
interface DepartmentDocument { uuid: string, title: string, folder_id?: number | null, folder_name?: string | null, updated_at?: string, last_editor_uid?: string | null, owner_uid?: string, readonly_flag?: boolean }
interface DepartmentFolder { id: number, name: string, parent_id: number | null, is_open?: boolean }
interface DepartmentAccess { role: string, canRead: boolean, canWrite: boolean, canManage: boolean }
interface Paged<T> { data: { items: T[], total: number, page: number, pageSize: number } }
interface FetchErrorLike { statusCode?: number, data?: { message?: string }, message?: string }

const { moduleUrl, documentUrl, hosted } = useCodocsModule()
const toast = useToast()
const { confirm } = useConfirm()
const pageSize = 20
const folderPageSize = 50

usePageTitle('部门文档')

const departments = ref<DepartmentOption[]>([])
const deptCode = ref('')
const departmentsLoading = ref(true)
const departmentsError = ref('')
const access = ref<DepartmentAccess | null>(null)

const showPublished = ref(false)
const folderStack = ref<DepartmentFolder[]>([])
const currentFolderId = computed(() => folderStack.value.at(-1)?.id ?? null)

const documents = ref<DepartmentDocument[]>([])
const documentsLoading = ref(false)
const documentsError = ref('')
const documentsPage = ref(1)
const documentsTotal = ref(0)

const folders = ref<DepartmentFolder[]>([])
const foldersLoading = ref(false)
const foldersError = ref('')
const foldersPage = ref(1)
const foldersTotal = ref(0)

const { search, debounced, flush } = useDebouncedSearch({
  onChange: () => {
    documentsPage.value = 1
  }
})

const departmentItems = computed(() => departments.value.map(item => ({ label: item.name, value: item.deptCode })))
const canManage = computed(() => access.value?.canManage === true)
const canWrite = computed(() => access.value?.canWrite === true)
const { user: authUser } = useAuth()
// Rename is allowed to the manager, the owner or a member with share-write; move only
// to the manager or the owner. The list cannot see share grants, so it offers the entry
// to the manager and the owner; the server stays the enforcer for everyone else.
const canEditDocumentMetadata = (doc: DepartmentDocument) => canWrite.value
  && (canManage.value || (Boolean(authUser.value) && doc.owner_uid === authUser.value))
const { hasPermission } = usePermissions()
// UI hint only: the download route requires departments:export on the server.
const canExport = computed(() => hasPermission('departments', 'export'))
const roleLabel = computed(() => ({ manager: '部门经理', member: '成员', leader: '分管负责人', parent: '上级部门' }[access.value?.role || ''] || ''))

const columns: TableColumn<DepartmentDocument>[] = [
  { accessorKey: 'title', header: '标题' },
  { accessorKey: 'folder_name', header: '目录' },
  { accessorKey: 'updated_at', header: '更新时间' },
  { id: 'actions', header: '操作' }
]

function errorMessage(error: unknown, fallback: string) {
  const e = error as FetchErrorLike
  if (e.statusCode === 403) return '当前没有该部门对象的操作权限'
  if (e.statusCode === 503) return '部门文档服务暂不可用，请稍后重试'
  return e.data?.message || fallback
}

let generation = 0
const controllers: Record<'documents' | 'folders' | 'access', AbortController | undefined> = { documents: undefined, folders: undefined, access: undefined }
function begin(kind: keyof typeof controllers) {
  controllers[kind]?.abort()
  controllers[kind] = new AbortController()
  return { signal: controllers[kind]!.signal, epoch: generation }
}
onScopeDispose(() => {
  generation++
  Object.values(controllers).forEach(controller => controller?.abort())
})

async function loadAccess() {
  access.value = null
  if (!deptCode.value) return
  const { signal, epoch } = begin('access')
  try {
    const response = await $fetch<{ data: DepartmentAccess }>(moduleUrl('/api/departments/access'), { query: { dept_code: deptCode.value }, signal })
    if (epoch === generation) access.value = response.data
  } catch {
    // The hint is optional; write entry points simply stay hidden.
    if (epoch === generation) access.value = null
  }
}

async function loadFolders() {
  folders.value = []
  foldersError.value = ''
  if (!deptCode.value) return
  const { signal, epoch } = begin('folders')
  foldersLoading.value = true
  try {
    const response = await $fetch<Paged<DepartmentFolder>>(moduleUrl('/api/departments/folders'), {
      query: { dept_code: deptCode.value, parent_id: currentFolderId.value === null ? 'null' : String(currentFolderId.value), page: foldersPage.value, pageSize: folderPageSize },
      signal
    })
    if (epoch !== generation) return
    folders.value = response.data.items
    foldersTotal.value = response.data.total
  } catch (error) {
    if (epoch === generation && !signal.aborted) foldersError.value = errorMessage(error, '目录加载失败')
  } finally {
    if (epoch === generation && !signal.aborted) foldersLoading.value = false
  }
}

async function loadDocuments() {
  documents.value = []
  documentsError.value = ''
  if (!deptCode.value) return
  const { signal, epoch } = begin('documents')
  documentsLoading.value = true
  try {
    const response = await $fetch<Paged<DepartmentDocument>>(moduleUrl('/api/departments/documents'), {
      query: {
        dept_code: deptCode.value, page: documentsPage.value, pageSize,
        published_mode: showPublished.value ? 'published' : 'unpublished', exclude_weekly_reports: 'true',
        folder_id: currentFolderId.value === null ? 'null' : String(currentFolderId.value),
        ...(debounced.value ? { search: debounced.value } : {})
      },
      signal
    })
    if (epoch !== generation) return
    documentsTotal.value = response.data.total
    const last = Math.max(1, Math.ceil(documentsTotal.value / pageSize))
    if (documentsPage.value > last) {
      documentsPage.value = last
      return
    }
    documents.value = response.data.items
  } catch (error) {
    if (epoch === generation && !signal.aborted) {
      documentsTotal.value = 0
      documentsError.value = errorMessage(error, '文档加载失败')
    }
  } finally {
    if (epoch === generation && !signal.aborted) documentsLoading.value = false
  }
}

async function loadDepartments() {
  departmentsLoading.value = true
  departmentsError.value = ''
  try {
    const response = await $fetch<{ data: { departments: DepartmentOption[], primaryDeptCode: string | null } }>(moduleUrl('/api/departments/mine'))
    departments.value = response.data.departments
    if (!departments.value.some(item => item.deptCode === deptCode.value)) deptCode.value = response.data.primaryDeptCode || departments.value[0]?.deptCode || ''
  } catch (error) {
    departmentsError.value = errorMessage(error, '部门列表加载失败')
  } finally {
    departmentsLoading.value = false
  }
}

function resetAndReload() {
  folderStack.value = []
  foldersPage.value = 1
  documentsPage.value = 1
  void loadAccess()
  void loadFolders()
  void loadDocuments()
}
watch(deptCode, resetAndReload)
watch(showPublished, () => {
  if (documentsPage.value !== 1) documentsPage.value = 1
  else void loadDocuments()
})
watch(documentsPage, loadDocuments)
watch(foldersPage, loadFolders)
watch(debounced, () => {
  if (documentsPage.value === 1) void loadDocuments()
})
onMounted(loadDepartments)

function enterFolder(folder: DepartmentFolder) {
  folderStack.value = [...folderStack.value, folder]
  foldersPage.value = 1
  documentsPage.value = 1
  void loadFolders()
  void loadDocuments()
}
function goToLevel(index: number) {
  folderStack.value = folderStack.value.slice(0, index)
  foldersPage.value = 1
  documentsPage.value = 1
  void loadFolders()
  void loadDocuments()
}
// Folder creation: the intent key is stable across retries of the same request
// and changes only when the request content changes or after success.
const showFolderModal = ref(false)
const folderName = ref('')
const folderSubmitting = ref(false)
const folderError = ref('')
const intentKey = ref('')
const newIntent = () => {
  intentKey.value = `codocs:department-folder:${crypto.randomUUID()}`
}
watch([folderName, deptCode, currentFolderId], newIntent)
function openFolderModal() {
  folderName.value = ''
  folderError.value = ''
  newIntent()
  showFolderModal.value = true
}
async function createFolder() {
  const name = folderName.value.trim()
  if (!name || name.length > 100) {
    folderError.value = '请输入 1-100 个字符的目录名称'
    return
  }
  folderSubmitting.value = true
  folderError.value = ''
  try {
    await $fetch(moduleUrl('/api/departments/folders'), {
      method: 'POST', headers: { 'Idempotency-Key': intentKey.value },
      body: { folder_type: 'department', dept_code: deptCode.value, name, parent_id: currentFolderId.value }
    })
    showFolderModal.value = false
    toast.add({ title: '目录已创建', color: 'success' })
    newIntent()
    await loadFolders()
  } catch (error) {
    // Keep the same intent key so a network retry cannot create a duplicate.
    folderError.value = departmentDocumentWriteErrorMessage(error, '目录创建失败，可再次提交重试')
    toast.add({ title: folderError.value, color: 'error' })
  } finally {
    folderSubmitting.value = false
  }
}

// Session-scoped intent keys survive a network retry with the same payload.
// A changed form payload gets a fresh key; successful operations clear it.
async function intent(action: string, payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify([deptCode.value, action, payload]))
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
  const slot = `codocs:department:intent:${action}`
  if (import.meta.client) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(slot) || 'null') as { digest?: string, key?: string } | null
      if (saved?.digest === digest && saved.key) return saved.key
      const key = `codocs:department:${crypto.randomUUID()}`
      sessionStorage.setItem(slot, JSON.stringify({ digest, key }))
      return key
    } catch { /* Storage unavailable: retain the in-memory key below. */ }
  }
  const saved = memoryIntent.get(slot)
  if (saved?.digest === digest) return saved.key
  const key = `codocs:department:${crypto.randomUUID()}`
  memoryIntent.set(slot, { digest, key })
  return key
}
const memoryIntent = new Map<string, { digest: string, key: string }>()
function clearIntent(action: string) {
  const slot = `codocs:department:intent:${action}`
  memoryIntent.delete(slot)
  if (!import.meta.client) return
  try {
    sessionStorage.removeItem(slot)
  } catch {
    /* no storage */
  }
}
const actionError = ref('')
const actionBusy = ref(false)
const showActionModal = ref(false)
const actionKind = ref<'new' | 'edit' | 'folder-edit' | 'copy' | 'upload' | null>(null)
const selectedDocument = ref<DepartmentDocument | null>(null)
const selectedFolder = ref<DepartmentFolder | null>(null)
const actionTitle = ref('')
const targetFolderId = ref<number | null>(null)
const uploadFile = ref<File | null>(null)
const modalTitle = computed(() => ({ 'new': '新建文档', 'edit': '改名或移动文档', 'folder-edit': '改名或移动目录', 'copy': '复制文档', 'upload': '上传 Markdown' }[actionKind.value || 'new']))
const folderOptions = computed(() => {
  const choices = [{ label: '部门根目录', value: 'root' }]
  for (const folder of [...folderStack.value, ...folders.value]) {
    if (!choices.some(item => item.value === String(folder.id))) choices.push({ label: folder.name, value: String(folder.id) })
  }
  return choices
})
const selectedFolderValue = computed({
  get: () => targetFolderId.value === null ? 'root' : String(targetFolderId.value),
  set: (value: string) => { targetFolderId.value = value === 'root' ? null : Number(value) }
})
function openAction(kind: NonNullable<typeof actionKind.value>, document?: DepartmentDocument, folder?: DepartmentFolder) {
  actionKind.value = kind
  selectedDocument.value = document || null
  selectedFolder.value = folder || null
  actionTitle.value = kind === 'copy' ? `${document?.title || '文档'} 副本` : kind === 'new' || kind === 'upload' ? '' : document?.title || folder?.name || ''
  targetFolderId.value = kind === 'edit' ? document?.folder_id ?? null : kind === 'folder-edit' ? folder?.parent_id ?? null : currentFolderId.value
  uploadFile.value = null
  actionError.value = ''
  showActionModal.value = true
}
function actionSuccessTitle(kind: NonNullable<typeof actionKind.value>, title: string): string {
  if (kind === 'new') return '文档已创建'
  if (kind === 'upload') return '文档已上传'
  if (kind === 'copy') return '文档已复制'
  const originalName = kind === 'edit' ? selectedDocument.value?.title : selectedFolder.value?.name
  const renamed = originalName !== title
  const previousFolderId = kind === 'edit' ? selectedDocument.value?.folder_id : selectedFolder.value?.parent_id
  const moved = (previousFolderId ?? null) !== targetFolderId.value
  const subject = kind === 'edit' ? '文档' : '目录'
  if (renamed && moved) return `${subject}已改名并移动`
  if (moved) return `${subject}已移动`
  if (renamed) return `${subject}已改名`
  return `${subject}信息已更新`
}
async function writeRequest(action: string, path: string, method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>) {
  const response = await $fetch(moduleUrl(path), { method, headers: { 'Idempotency-Key': await intent(action, body) }, body })
  clearIntent(action)
  return response
}
async function submitAction() {
  if (!actionKind.value || actionBusy.value) return
  const kind = actionKind.value
  actionBusy.value = true
  actionError.value = ''
  try {
    const title = actionTitle.value.trim()
    if (kind === 'upload') {
      const file = uploadFile.value
      if (!file || !file.name.toLowerCase().endsWith('.md') || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过 10 MiB 的 .md 文件')
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      } catch {
        throw new Error('文件必须使用 UTF-8 编码')
      }
      const body = { dept_code: deptCode.value, title: file.name.replace(/\.md$/i, ''), folder_id: targetFolderId.value, content }
      await writeRequest(`upload:${file.name}`, '/api/departments/documents', 'POST', body)
    } else {
      if (!title) throw new Error('请输入名称')
      if (kind === 'new') await writeRequest('create', '/api/departments/documents', 'POST', { dept_code: deptCode.value, title, folder_id: targetFolderId.value, content: '' })
      if (kind === 'edit' && selectedDocument.value) await writeRequest(`edit:${selectedDocument.value.uuid}`, `/api/departments/documents/${selectedDocument.value.uuid}`, 'PATCH', { dept_code: deptCode.value, title, folder_id: targetFolderId.value })
      if (kind === 'folder-edit' && selectedFolder.value) await writeRequest(`folder-edit:${selectedFolder.value.id}`, `/api/departments/folders/${selectedFolder.value.id}`, 'PATCH', { dept_code: deptCode.value, name: title, parent_id: targetFolderId.value })
      if (kind === 'copy' && selectedDocument.value) await writeRequest(`copy:${selectedDocument.value.uuid}`, `/api/departments/documents/${selectedDocument.value.uuid}/copy`, 'POST', { source_dept_code: deptCode.value, dept_code: deptCode.value, title, folder_id: targetFolderId.value })
    }
    showActionModal.value = false
    toast.add({ title: actionSuccessTitle(kind, title), color: 'success' })
    await Promise.all([loadDocuments(), loadFolders()])
  } catch (error) {
    actionError.value = departmentDocumentWriteErrorMessage(error, '操作未完成，可使用相同请求重试')
    toast.add({ title: actionError.value, color: 'error' })
  } finally { actionBusy.value = false }
}
async function applyDocumentAction(row: DepartmentDocument, action: 'readonly' | 'recycle') {
  const desired = action === 'readonly' ? !row.readonly_flag : true
  if (!await confirm({ title: action === 'recycle' ? '回收文档' : desired ? '设为只读' : '取消只读', message: action === 'recycle' ? `确定回收「${row.title}」？可在回收站恢复。` : `确定更改「${row.title}」的只读状态？`, confirmLabel: '确认', tone: action === 'recycle' ? 'danger' : 'warning' })) return
  try {
    await writeRequest(`${action}:${row.uuid}`, `/api/departments/documents/${row.uuid}${action === 'readonly' ? '/readonly' : ''}`, action === 'readonly' ? 'PATCH' : 'DELETE', { dept_code: deptCode.value, ...(action === 'readonly' ? { readonly_flag: desired } : {}) })
    toast.add({ title: action === 'recycle' ? '文档已回收' : desired ? '已设为只读' : '已取消只读', color: 'success' })
    await loadDocuments()
  } catch (error) { toast.add({ title: departmentDocumentWriteErrorMessage(error, '操作失败，可再次尝试'), color: 'error' }) }
}
async function applyFolderAction(row: DepartmentFolder, action: 'delete' | 'open') {
  if (!await confirm({ title: action === 'delete' ? '删除目录' : row.is_open ? '关闭目录开放' : '开放目录', message: action === 'delete' ? `确定删除「${row.name}」？目录必须为空。` : `确定更改「${row.name}」的开放状态？`, confirmLabel: '确认', tone: action === 'delete' ? 'danger' : 'warning' })) return
  try {
    await writeRequest(`${action}:${row.id}`, `/api/departments/folders/${row.id}${action === 'open' ? '/open' : ''}`, action === 'open' ? 'PATCH' : 'DELETE', { dept_code: deptCode.value, ...(action === 'open' ? { is_open: !row.is_open } : {}) })
    toast.add({ title: action === 'delete' ? '目录已删除' : row.is_open ? '已关闭目录开放' : '已开放目录', color: 'success' })
    await loadFolders()
  } catch (error) { toast.add({ title: departmentDocumentWriteErrorMessage(error, '操作失败，可再次尝试'), color: 'error' }) }
}
const showTrash = ref(false)
const trash = ref<DepartmentDocument[]>([])
const trashError = ref('')
const trashPage = ref(1)
const trashTotal = ref(0)
async function loadTrash() {
  trashError.value = ''
  try {
    const response = await $fetch<Paged<DepartmentDocument>>(moduleUrl('/api/departments/documents/trash'), { query: { dept_code: deptCode.value, page: trashPage.value, pageSize: 20 } })
    trash.value = response.data.items
    trashTotal.value = response.data.total
  } catch (error) { trashError.value = errorMessage(error, '回收站加载失败') }
}
watch(trashPage, () => {
  if (showTrash.value) void loadTrash()
})
async function openTrash() {
  trashPage.value = 1
  showTrash.value = true
  await loadTrash()
}
async function restoreDocument(row: DepartmentDocument) {
  if (!await confirm({ title: '恢复文档', message: `确定恢复「${row.title}」？`, confirmLabel: '恢复' })) return
  try {
    await writeRequest(`restore:${row.uuid}`, `/api/departments/documents/${row.uuid}/restore`, 'POST', { dept_code: deptCode.value })
    toast.add({ title: '文档已恢复', color: 'success' })
    await Promise.all([loadTrash(), loadDocuments()])
  } catch (error) { toast.add({ title: departmentDocumentWriteErrorMessage(error, '恢复失败，可再次尝试'), color: 'error' }) }
}
function downloadDocument(row: DepartmentDocument) {
  if (import.meta.client) window.location.href = moduleUrl(`/api/departments/documents/${row.uuid}/download?dept_code=${encodeURIComponent(deptCode.value)}`)
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex flex-col gap-4 overflow-auto p-4 sm:p-6">
      <ContentPageHeader
        :hosted="hosted"
        title="部门文档"
        description="浏览和管理所属部门的文档与目录。"
        breadcrumb="文档 / 文档空间"
      />

      <UAlert
        v-if="departmentsError"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="departmentsError"
      >
        <template #actions>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            @click="loadDepartments"
          >
            重试
          </UButton>
        </template>
      </UAlert>

      <CommonEmptyState
        v-else-if="!departmentsLoading && !departments.length"
        icon="i-lucide-building-2"
        title="暂无可访问的部门"
        description="你当前不属于任何部门，无法查看部门文档。"
      />

      <template v-else>
        <div class="flex flex-wrap items-center gap-2">
          <USelectMenu
            v-model="deptCode"
            :items="departmentItems"
            value-key="value"
            :loading="departmentsLoading"
            :search-input="false"
            placeholder="选择部门"
            class="w-full sm:w-60"
          />
          <UBadge v-if="roleLabel" color="neutral" variant="subtle">
            {{ roleLabel }}
          </UBadge>
          <div class="flex-1" />
          <PendingDeptShares
            v-if="deptCode && canManage"
            :dept-code="deptCode"
            @accepted="loadDocuments()"
          />
          <UButton
            v-if="canWrite"
            icon="i-lucide-file-plus"
            color="primary"
            @click="openAction('new')"
          >
            新建文档
          </UButton>
          <UButton
            v-if="canWrite"
            icon="i-lucide-upload"
            color="neutral"
            variant="outline"
            @click="openAction('upload')"
          >
            上传
          </UButton>
          <UButton
            v-if="canManage"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="outline"
            @click="openTrash"
          >
            回收站
          </UButton>
          <UButton
            v-if="canManage"
            icon="i-lucide-folder-plus"
            color="primary"
            @click="openFolderModal"
          >
            新建文件夹
          </UButton>
        </div>

        <UAlert
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          title="发布暂未开放"
          description="部门文档的发布流程将在后续开放。"
        />

        <div class="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <section class="flex min-w-0 flex-col gap-2 rounded-lg border border-default p-3" aria-label="目录">
            <div class="flex flex-wrap items-center gap-1 text-sm">
              <UButton
                size="xs"
                variant="ghost"
                color="neutral"
                icon="i-lucide-folder-tree"
                @click="goToLevel(0)"
              >
                全部文档
              </UButton>
              <template v-for="(item, index) in folderStack" :key="item.id">
                <UIcon name="i-lucide-chevron-right" class="size-3 text-muted" />
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  @click="goToLevel(index + 1)"
                >
                  {{ item.name }}
                </UButton>
              </template>
            </div>
            <UAlert
              v-if="foldersError"
              color="error"
              variant="subtle"
              :title="foldersError"
            />
            <p v-else-if="foldersLoading" class="py-4 text-center text-sm text-muted">
              加载中...
            </p>
            <CommonEmptyState v-else-if="!folders.length" icon="i-lucide-folder" title="当前层级暂无子目录" />
            <ul v-else class="space-y-0.5">
              <li v-for="folder in folders" :key="folder.id">
                <UButton
                  block
                  variant="ghost"
                  color="neutral"
                  class="justify-start"
                  icon="i-lucide-folder"
                  @click="enterFolder(folder)"
                >
                  <span class="truncate">{{ folder.name }}</span>
                </UButton>
                <div v-if="canManage" class="flex flex-wrap gap-1 pl-2">
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="openAction('folder-edit', undefined, folder)"
                  >
                    改名/移动
                  </UButton>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    @click="applyFolderAction(folder, 'open')"
                  >
                    {{ folder.is_open ? '关闭开放' : '开放' }}
                  </UButton>
                  <UButton
                    size="xs"
                    color="error"
                    variant="ghost"
                    @click="applyFolderAction(folder, 'delete')"
                  >
                    删除
                  </UButton>
                </div>
              </li>
            </ul>
            <div v-if="foldersTotal > folderPageSize" class="space-y-1 border-t border-default pt-2">
              <p class="text-xs text-muted">
                共 {{ foldersTotal }} 条
              </p>
              <UPagination
                v-model:page="foldersPage"
                :items-per-page="folderPageSize"
                :total="foldersTotal"
                :sibling-count="0"
                size="xs"
              />
            </div>
          </section>

          <section class="flex min-w-0 flex-col gap-3" aria-label="文档">
            <div class="flex flex-wrap items-center gap-2">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索文档标题"
                class="w-full sm:w-72"
                @keyup.enter="flush"
              />
              <UButtonGroup>
                <UButton
                  :variant="showPublished ? 'outline' : 'solid'"
                  color="primary"
                  size="sm"
                  @click="showPublished = false"
                >
                  未发布
                </UButton>
                <UButton
                  :variant="showPublished ? 'solid' : 'outline'"
                  color="primary"
                  size="sm"
                  @click="showPublished = true"
                >
                  已发布
                </UButton>
              </UButtonGroup>
            </div>

            <UAlert
              v-if="documentsError"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="documentsError"
            >
              <template #actions>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="outline"
                  @click="loadDocuments"
                >
                  重试
                </UButton>
              </template>
            </UAlert>
            <UTable
              v-else
              :data="documents"
              :columns="columns"
              :loading="documentsLoading"
              class="rounded-lg border border-default"
            >
              <template #title-cell="{ row }">
                <NuxtLink
                  :to="`${documentUrl(row.original.uuid)}?dept_code=${encodeURIComponent(deptCode)}`"
                  class="font-medium text-primary hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {{ row.original.title || '未命名文档' }}
                </NuxtLink>
              </template>
              <template #folder_name-cell="{ row }">
                {{ row.original.folder_name || '—' }}
              </template>
              <template #updated_at-cell="{ row }">
                {{ row.original.updated_at ? formatDateTime(row.original.updated_at) : '—' }}
              </template>
              <template #actions-cell="{ row }">
                <div class="flex flex-wrap gap-1" @click.stop>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :disabled="!canExport"
                    :title="canExport ? undefined : '缺少部门文档下载（导出）权限'"
                    @click="downloadDocument(row.original)"
                  >
                    下载
                  </UButton>
                  <UButton
                    v-if="canWrite"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="openAction('copy', row.original)"
                  >
                    复制
                  </UButton>
                  <UButton
                    v-if="canEditDocumentMetadata(row.original)"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="openAction('edit', row.original)"
                  >
                    改名/移动
                  </UButton>
                  <UButton
                    v-if="canManage"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    @click="applyDocumentAction(row.original, 'readonly')"
                  >
                    {{ row.original.readonly_flag ? '取消只读' : '设为只读' }}
                  </UButton>
                  <UButton
                    v-if="canManage"
                    size="xs"
                    variant="ghost"
                    color="error"
                    @click="applyDocumentAction(row.original, 'recycle')"
                  >
                    回收
                  </UButton>
                </div>
              </template>
              <template #empty>
                <CommonEmptyState icon="i-lucide-file-text" :title="debounced ? '没有匹配的文档' : '当前目录暂无文档'" :description="debounced ? '换个关键字试试。' : '可在上方新建或上传文档。'" />
              </template>
            </UTable>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm text-muted">
                共 {{ documentsTotal }} 条
              </p>
              <UPagination
                v-model:page="documentsPage"
                :items-per-page="pageSize"
                :total="documentsTotal"
                :sibling-count="1"
              />
            </div>
          </section>
        </div>
      </template>
    </div>

    <UModal v-model:open="showFolderModal" title="新建文件夹" :description="folderStack.length ? `将创建在「${folderStack.at(-1)?.name}」下` : '将创建在部门根目录下'">
      <template #body>
        <UFormField label="目录名称" :error="folderError" required>
          <UInput
            v-model="folderName"
            maxlength="100"
            class="w-full"
            autofocus
            @keyup.enter="createFolder"
          />
        </UFormField>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="showFolderModal = false">
          取消
        </UButton>
        <UButton color="primary" :loading="folderSubmitting" @click="createFolder">
          创建
        </UButton>
      </template>
    </UModal>

    <UModal v-model:open="showActionModal" :title="modalTitle">
      <template #body>
        <div class="space-y-3">
          <UAlert
            v-if="actionError"
            color="error"
            variant="subtle"
            :title="actionError"
          />
          <UFormField v-if="actionKind !== 'upload'" :label="actionKind === 'folder-edit' ? '目录名称' : '文档标题'" required>
            <UInput v-model="actionTitle" class="w-full" :maxlength="actionKind === 'folder-edit' ? 100 : 255" />
          </UFormField>
          <UFormField v-if="actionKind === 'upload'" label="Markdown 文件" required>
            <input
              type="file"
              accept=".md,text/markdown"
              class="block w-full text-sm"
              @change="uploadFile = ($event.target as HTMLInputElement).files?.[0] || null"
            >
          </UFormField>
          <UFormField label="目标目录">
            <USelectMenu
              v-model="selectedFolderValue"
              :items="folderOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="outline" @click="showActionModal = false">
          取消
        </UButton>
        <UButton color="primary" :loading="actionBusy" @click="submitAction">
          保存
        </UButton>
      </template>
    </UModal>

    <UModal v-model:open="showTrash" title="部门文档回收站">
      <template #body>
        <div class="space-y-2">
          <UAlert
            v-if="trashError"
            color="error"
            variant="subtle"
            :title="trashError"
          />
          <p v-else-if="!trash.length" class="text-sm text-muted">
            回收站为空
          </p>
          <div v-for="item in trash" :key="item.uuid" class="flex items-center justify-between gap-2 border-b border-default py-2">
            <span class="min-w-0 truncate text-sm">{{ item.title }}</span>
            <UButton size="xs" variant="outline" @click="restoreDocument(item)">
              恢复
            </UButton>
          </div>
          <UPagination
            v-if="trashTotal > 20"
            v-model:page="trashPage"
            :total="trashTotal"
            :items-per-page="20"
            size="sm"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
