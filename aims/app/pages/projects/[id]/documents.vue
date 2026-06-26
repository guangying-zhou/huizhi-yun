<script setup lang="ts">
import type { DocumentNode } from '~/components/document/DocumentTree.vue'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目文档',
  layoutHeaderProjectSwitcher: true
})

type DocumentSource = 'codocs' | 'repo'
type DocumentLibrary = 'standard' | 'other'

interface RawProjectDocument {
  id?: number
  uuid?: string
  portfolio_id?: number | null
  portfolioId?: number | null
  project_id?: number | null
  projectId?: number | null
  project_code?: string | null
  projectCode?: string | null
  milestone_id?: number | null
  milestoneId?: number | null
  work_item_id?: number | null
  workItemId?: number | null
  parent_id?: number | null
  parentId?: number | null
  title?: string
  doc_category?: string | null
  docCategory?: string | null
  is_folder?: number | boolean
  isFolder?: boolean
  codocs_uuid?: string | null
  codocsUuid?: string | null
  document_source?: DocumentSource
  documentSource?: DocumentSource
  repo_project_code?: string | null
  repoProjectCode?: string | null
  repo_file_path?: string | null
  repoFilePath?: string | null
  repo_commit_id?: string | null
  repoCommitId?: string | null
  oss_path?: string | null
  ossPath?: string | null
  content_size?: number
  contentSize?: number
  created_by?: string
  createdBy?: string
  created_at?: string
  createdAt?: string
  updated_at?: string
  updatedAt?: string
  access_lifecycle_stage?: 'draft' | 'formal' | 'archived' | null
  accessLifecycleStage?: 'draft' | 'formal' | 'archived' | null
  access_confidentiality_level?: 'L0' | 'L1' | 'L2' | 'L3' | null
  accessConfidentialityLevel?: 'L0' | 'L1' | 'L2' | 'L3' | null
  access_summary?: string | null
  accessSummary?: string | null
  virtual?: boolean
  virtualSource?: 'deliverable'
  children?: RawProjectDocument[]
}

interface ProjectDocument extends DocumentNode {
  projectId: number | null
  projectCode: string | null
  milestoneId: number | null
  workItemId: number | null
  documentSource: DocumentSource
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  ossPath: string | null
  contentSize: number
  createdBy: string
  createdAt: string
  accessLifecycleStage: 'draft' | 'formal' | 'archived'
  accessConfidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
  accessSummary: string
  virtual: boolean
  virtualSource: 'deliverable' | null
}

type AccessLifecycleStage = 'draft' | 'formal' | 'archived'
type AccessConfidentialityLevel = 'L0' | 'L1' | 'L2' | 'L3'
type AccessDefaultPermission = 'none' | 'view' | 'download'
type AccessGrantSubjectType = 'project' | 'dept' | 'user' | 'role'
type AccessGrantPermission = 'view' | 'download' | 'edit'

interface AccessGrantForm {
  subjectType: AccessGrantSubjectType
  subjectCode: string
  permission: AccessGrantPermission
  expiresAt: string | null
}

interface AccessPolicyForm {
  lifecycleStage: AccessLifecycleStage
  confidentialityLevel: AccessConfidentialityLevel
  defaultPermission: AccessDefaultPermission
  allowInternalAccess: boolean
  allowCrossProject: boolean
  readonly: boolean
  grants: AccessGrantForm[]
}

interface AccessAuditItem {
  id: number
  actorUid: string | null
  action: string
  decision: 'allow' | 'deny'
  reason: string
  createdAt: string
}

interface DocumentTarget {
  key: string
  label: string
  icon: string
  milestoneId: number | null
  pivrStage?: string | null
}

const route = useRoute()
const toast = useToast()
const projectStore = useProjectStore()
const milestoneStore = useMilestoneStore()
const { user: authUser } = useAuth()

const projectId = computed(() => Number(route.params.id))
const project = computed(() => projectStore.currentProject)
const projectCode = computed(() => project.value?.projectCode || '')
const currentUid = computed(() => authUser.value || '')
const canWriteDocuments = computed(() => {
  const currentProject = project.value
  const uid = currentUid.value
  if (!currentProject || !uid) return false
  return currentProject.leaderUid === uid
    || currentProject.currentUserRole === 'manager'
    || currentProject.currentUserRole === 'member'
})

function ensureCanWriteDocuments() {
  if (canWriteDocuments.value) return true
  toast.add({ title: '非项目成员仅可查看文档', color: 'warning' })
  return false
}

const documents = ref<ProjectDocument[]>([])
const documentsLoading = ref(false)
const selectedLibrary = ref<DocumentLibrary>('standard')
const selectedTargetKey = ref('project')
const search = ref('')

const showCreateModal = ref(false)
const createKind = ref<'document' | 'folder'>('document')
const createParentId = ref<number | null>(null)
const createTargetKey = ref('project')
const createTitle = ref('')
const createCategory = ref('general')
const createContent = ref('')
const creating = ref(false)
const uploadingMarkdown = ref(false)
const uploadingOther = ref(false)

const markdownFileInput = ref<HTMLInputElement | null>(null)
const otherFileInput = ref<HTMLInputElement | null>(null)
const showDeleteModal = ref(false)
const deleteTarget = ref<ProjectDocument | null>(null)
const deleting = ref(false)

const showEditorModal = ref(false)
const editorDoc = ref<ProjectDocument | null>(null)
const showPreviewModal = ref(false)
const previewDoc = ref<ProjectDocument | null>(null)
const showAccessModal = ref(false)
const accessDoc = ref<ProjectDocument | null>(null)
const accessLoading = ref(false)
const accessSaving = ref(false)
const accessAuditLoading = ref(false)
const accessAuditPage = ref(1)
const accessAuditPageSize = 10
const accessAuditTotal = ref(0)
const accessAuditLogs = ref<AccessAuditItem[]>([])
const accessPolicy = reactive<AccessPolicyForm>({
  lifecycleStage: 'draft',
  confidentialityLevel: 'L2',
  defaultPermission: 'none',
  allowInternalAccess: false,
  allowCrossProject: false,
  readonly: false,
  grants: []
})
const newGrant = reactive<AccessGrantForm>({
  subjectType: 'user',
  subjectCode: '',
  permission: 'view',
  expiresAt: null
})

const categoryOptions = [
  { label: '通用', value: 'general' },
  { label: '立项书', value: 'project_proposal' },
  { label: '需求规格', value: 'requirement_spec' },
  { label: '设计文档', value: 'design' },
  { label: '测试报告', value: 'test_report' },
  { label: '会议纪要', value: 'meeting_notes' }
]

const otherCategoryOptions = [
  { label: 'Word', value: 'other_word' },
  { label: 'Excel', value: 'other_excel' },
  { label: 'PowerPoint', value: 'other_powerpoint' },
  { label: 'PDF', value: 'other_pdf' },
  { label: '其他文件', value: 'other_file' }
]

const categoryLabel = Object.fromEntries([...categoryOptions, ...otherCategoryOptions].map(item => [item.value, item.label]))
const pivrStageLabel: Record<string, string> = {
  P: '规划',
  I: '实施',
  V: '验证',
  R: '发布'
}
const pivrStageOrder: Record<string, number> = { P: 1, I: 2, V: 3, R: 4 }
const accessDecisionLabel: Record<'allow' | 'deny', string> = {
  allow: '允许',
  deny: '拒绝'
}
const accessReasonLabel: Record<string, string> = {
  source_project_member: '源项目成员',
  draft_requires_project_member: '草稿仅项目成员可访问',
  internal_access: '企业内放行',
  readonly: '文档只读/归档',
  no_matching_grant: '无匹配授权',
  policy_updated: '策略已更新'
}
const accessLifecycleOptions = [
  { label: '草稿', value: 'draft' },
  { label: '正式', value: 'formal' },
  { label: '归档', value: 'archived' }
]
const accessConfidentialityOptions = [
  { label: 'L0（公开）', value: 'L0' },
  { label: 'L1（企业内）', value: 'L1' },
  { label: 'L2（受控）', value: 'L2' },
  { label: 'L3（机密）', value: 'L3' }
]
const accessDefaultPermissionOptions = [
  { label: '默认拒绝', value: 'none' },
  { label: '默认可查看', value: 'view' },
  { label: '默认可下载', value: 'download' }
]
const accessGrantSubjectTypeOptions = [
  { label: '用户', value: 'user' },
  { label: '项目', value: 'project' },
  { label: '部门', value: 'dept' },
  { label: '角色', value: 'role' }
]
const accessGrantPermissionOptions = [
  { label: '查看', value: 'view' },
  { label: '下载', value: 'download' },
  { label: '编辑', value: 'edit' }
]
const otherDocumentExtensions = new Set([
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'pdf',
  'txt',
  'csv',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz'
])

const sortedMilestones = computed(() =>
  [...milestoneStore.milestones].sort((a, b) => {
    const stageCompare = (pivrStageOrder[a.pivrStage || ''] || 99) - (pivrStageOrder[b.pivrStage || ''] || 99)
    if (stageCompare !== 0) return stageCompare
    return (a.sortOrder || 0) - (b.sortOrder || 0) || a.id - b.id
  })
)

const targets = computed<DocumentTarget[]>(() => [
  {
    key: 'project',
    label: '项目级文档',
    icon: 'i-lucide-folder-kanban',
    milestoneId: null
  },
  ...sortedMilestones.value.map(milestone => ({
    key: `milestone:${milestone.id}`,
    label: milestone.name,
    icon: 'i-lucide-flag',
    milestoneId: milestone.id,
    pivrStage: milestone.pivrStage
  }))
])

const activeTarget = computed(() =>
  targets.value.find(target => target.key === selectedTargetKey.value) || targets.value[0]!
)

const createTarget = computed(() =>
  targets.value.find(target => target.key === createTargetKey.value) || activeTarget.value
)

const documentMap = computed(() => {
  const map = new Map<number, ProjectDocument>()
  for (const doc of documents.value) map.set(doc.id, doc)
  return map
})

const documentStats = computed(() => {
  const nonFolders = documents.value.filter(doc => doc.type === 'document')
  const standard = nonFolders.filter(isStandardDocument)
  const other = nonFolders.filter(isOtherDocument)
  return {
    total: nonFolders.length,
    standard: standard.length,
    other: other.length,
    project: standard.filter(doc => !doc.milestoneId).length,
    milestone: standard.filter(doc => Boolean(doc.milestoneId)).length,
    linked: standard.filter(doc => Boolean(doc.workItemId)).length
  }
})

function targetCount(target: DocumentTarget) {
  return documents.value.filter((doc) => {
    if (doc.type === 'folder') return false
    if (!isStandardDocument(doc)) return false
    if (target.milestoneId) return doc.milestoneId === target.milestoneId
    return !doc.milestoneId
  }).length
}

function fileExtension(name: string | null | undefined) {
  const normalized = String(name || '').trim().toLowerCase()
  const index = normalized.lastIndexOf('.')
  return index >= 0 ? normalized.slice(index + 1) : ''
}

function isOtherDocument(doc: ProjectDocument) {
  if (doc.type === 'folder') return false
  if (doc.category?.startsWith('other_')) return true
  const extension = fileExtension(doc.repoFilePath || doc.ossPath || doc.title)
  return Boolean(extension && extension !== 'md' && extension !== 'markdown')
}

function isStandardDocument(doc: ProjectDocument) {
  if (doc.type === 'folder') return true
  return !isOtherDocument(doc)
}

function flattenDocuments(nodes: RawProjectDocument[]): RawProjectDocument[] {
  const result: RawProjectDocument[] = []
  for (const node of nodes) {
    const { children, ...rest } = node
    result.push(rest)
    if (children?.length) result.push(...flattenDocuments(children))
  }
  return result
}

function normalizeListPayload(data: unknown): RawProjectDocument[] {
  if (Array.isArray(data)) return flattenDocuments(data)
  if (data && typeof data === 'object') {
    const value = data as { items?: RawProjectDocument[], documents?: RawProjectDocument[] }
    if (Array.isArray(value.items)) return flattenDocuments(value.items)
    if (Array.isArray(value.documents)) return flattenDocuments(value.documents)
  }
  return []
}

function normalizeDocument(raw: RawProjectDocument): ProjectDocument {
  const isFolder = Boolean(raw.isFolder ?? raw.is_folder)
  const lifecycle = raw.accessLifecycleStage ?? raw.access_lifecycle_stage ?? 'draft'
  const level = raw.accessConfidentialityLevel ?? raw.access_confidentiality_level ?? 'L2'
  const summary = raw.accessSummary ?? raw.access_summary ?? '仅项目成员'
  return {
    id: Number(raw.id),
    uuid: raw.uuid || '',
    title: raw.title || '',
    type: isFolder ? 'folder' : 'document',
    parentId: Number(raw.parentId ?? raw.parent_id) || null,
    category: raw.docCategory ?? raw.doc_category ?? undefined,
    codocsUuid: raw.codocsUuid ?? raw.codocs_uuid ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
    children: [],
    projectId: Number(raw.projectId ?? raw.project_id) || null,
    projectCode: raw.projectCode ?? raw.project_code ?? null,
    milestoneId: Number(raw.milestoneId ?? raw.milestone_id) || null,
    workItemId: Number(raw.workItemId ?? raw.work_item_id) || null,
    documentSource: raw.documentSource ?? raw.document_source ?? 'codocs',
    repoProjectCode: raw.repoProjectCode ?? raw.repo_project_code ?? null,
    repoFilePath: raw.repoFilePath ?? raw.repo_file_path ?? null,
    repoCommitId: raw.repoCommitId ?? raw.repo_commit_id ?? null,
    ossPath: raw.ossPath ?? raw.oss_path ?? null,
    contentSize: Number(raw.contentSize ?? raw.content_size) || 0,
    createdBy: raw.createdBy ?? raw.created_by ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    accessLifecycleStage: lifecycle,
    accessConfidentialityLevel: level,
    accessSummary: summary,
    virtual: Boolean(raw.virtual),
    virtualSource: raw.virtualSource ?? null
  }
}

function accessDeniedMessage(reason: string) {
  if (reason === 'draft_requires_project_member') return '草稿文档仅项目成员可访问'
  if (reason === 'readonly') return '归档或只读文档不可编辑'
  if (reason === 'no_matching_grant') return '当前项目组未被授权访问该文档'
  if (reason.startsWith('granted_by_')) return ''
  return '你没有权限访问该文档'
}

async function checkDocumentAccess(doc: ProjectDocument, action: 'view' | 'download' | 'edit') {
  const result = await $fetch<{
    code: number
    data: {
      allowed: boolean
      readonly: boolean
      reason: string
      lifecycleStage: 'draft' | 'formal' | 'archived'
      confidentialityLevel: 'L0' | 'L1' | 'L2' | 'L3'
    }
  }>(`/api/v1/projects/${projectId.value}/documents/${doc.id}/access-check`, {
    method: 'POST',
    body: { action }
  })

  const denied = !result.data.allowed
  if (denied) {
    const message = accessDeniedMessage(result.data.reason)
    if (message) toast.add({ title: message, color: 'warning' })
  }

  doc.accessLifecycleStage = result.data.lifecycleStage
  doc.accessConfidentialityLevel = result.data.confidentialityLevel

  return result.data
}

function buildTree(items: ProjectDocument[]): DocumentNode[] {
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

const activeDocuments = computed(() => {
  if (selectedLibrary.value === 'other') {
    return documents.value.filter(isOtherDocument)
  }

  const target = activeTarget.value
  return documents.value.filter((doc) => {
    if (!isStandardDocument(doc)) return false
    if (target.milestoneId) return doc.milestoneId === target.milestoneId
    return !doc.milestoneId
  })
})

const activeDocumentTree = computed(() => buildTree(activeDocuments.value))

const searchResults = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return []
  return documents.value
    .filter(doc => doc.type === 'document')
    .filter(doc =>
      doc.title.toLowerCase().includes(keyword)
      || (categoryLabel[doc.category || ''] || doc.category || '').toLowerCase().includes(keyword)
    )
})

function documentTargetKey(doc: ProjectDocument) {
  return doc.milestoneId ? `milestone:${doc.milestoneId}` : 'project'
}

function targetLabelForDoc(doc: ProjectDocument) {
  if (isOtherDocument(doc)) return '其他文档'
  if (doc.milestoneId) {
    return sortedMilestones.value.find(m => m.id === doc.milestoneId)?.name || '里程碑'
  }
  if (doc.workItemId) return '工作项'
  return '项目级'
}

function formatDate(date: string | undefined) {
  if (!date) return '-'
  return date.slice(0, 16).replace('T', ' ')
}

function resetAccessForm() {
  accessPolicy.lifecycleStage = 'draft'
  accessPolicy.confidentialityLevel = 'L2'
  accessPolicy.defaultPermission = 'none'
  accessPolicy.allowInternalAccess = false
  accessPolicy.allowCrossProject = false
  accessPolicy.readonly = false
  accessPolicy.grants = []
  accessAuditLogs.value = []
  accessAuditPage.value = 1
  accessAuditTotal.value = 0
}

function accessReasonText(reason: string) {
  if (reason.startsWith('granted_by_')) {
    const source = reason.replace('granted_by_', '')
    return `命中${source}授权`
  }
  return accessReasonLabel[reason] || reason
}

async function loadAccessPolicy() {
  if (!accessDoc.value) return
  accessLoading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: {
        lifecycleStage: AccessLifecycleStage
        confidentialityLevel: AccessConfidentialityLevel
        defaultPermission: AccessDefaultPermission
        allowInternalAccess: boolean
        allowCrossProject: boolean
        readonly: boolean
        grants: Array<{
          subjectType: AccessGrantSubjectType
          subjectCode: string
          permission: AccessGrantPermission
          expiresAt: string | null
        }>
      }
    }>(`/api/v1/projects/${projectId.value}/documents/${accessDoc.value.id}/access-policy`)

    accessPolicy.lifecycleStage = res.data.lifecycleStage
    accessPolicy.confidentialityLevel = res.data.confidentialityLevel
    accessPolicy.defaultPermission = res.data.defaultPermission
    accessPolicy.allowInternalAccess = Boolean(res.data.allowInternalAccess)
    accessPolicy.allowCrossProject = Boolean(res.data.allowCrossProject)
    accessPolicy.readonly = Boolean(res.data.readonly)
    accessPolicy.grants = Array.isArray(res.data.grants)
      ? res.data.grants.map(item => ({
          subjectType: item.subjectType,
          subjectCode: item.subjectCode,
          permission: item.permission,
          expiresAt: item.expiresAt
        }))
      : []
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '加载访问策略失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    accessLoading.value = false
  }
}

async function loadAccessAuditLogs(page = 1) {
  if (!accessDoc.value) return
  accessAuditLoading.value = true
  try {
    const res = await $fetch<{
      code: number
      data: {
        items: AccessAuditItem[]
        total: number
        page: number
        pageSize: number
      }
    }>(`/api/v1/projects/${projectId.value}/documents/${accessDoc.value.id}/access-audit`, {
      params: { page, pageSize: accessAuditPageSize }
    })
    accessAuditLogs.value = Array.isArray(res.data.items) ? res.data.items : []
    accessAuditTotal.value = Number(res.data.total) || 0
    accessAuditPage.value = Number(res.data.page) || 1
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '加载访问审计失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    accessAuditLoading.value = false
  }
}

async function openAccessModal(doc: ProjectDocument) {
  if (!ensureCanWriteDocuments()) return
  accessDoc.value = doc
  showAccessModal.value = true
  resetAccessForm()
  await Promise.allSettled([loadAccessPolicy(), loadAccessAuditLogs(1)])
}

function closeAccessModal() {
  showAccessModal.value = false
  accessDoc.value = null
  resetAccessForm()
}

function openAccessModalForPreview() {
  if (!previewDoc.value) return
  if (previewDoc.value.virtual) {
    toast.add({ title: '任务交付文档沿用原文档访问控制', color: 'info' })
    return
  }
  openAccessModal(previewDoc.value)
}

function addAccessGrant() {
  if (!ensureCanWriteDocuments()) return
  const subjectCode = newGrant.subjectCode.trim()
  if (!subjectCode) {
    toast.add({ title: '请输入授权主体编码', color: 'warning' })
    return
  }
  accessPolicy.grants.push({
    subjectType: newGrant.subjectType,
    subjectCode,
    permission: newGrant.permission,
    expiresAt: newGrant.expiresAt || null
  })
  newGrant.subjectCode = ''
  newGrant.expiresAt = null
}

function removeAccessGrant(index: number) {
  if (!ensureCanWriteDocuments()) return
  accessPolicy.grants.splice(index, 1)
}

async function saveAccessPolicy() {
  if (!ensureCanWriteDocuments()) return
  if (!accessDoc.value) return
  accessSaving.value = true
  try {
    await $fetch<{
      code: number
      data: {
        lifecycleStage: AccessLifecycleStage
        confidentialityLevel: AccessConfidentialityLevel
      }
    }>(`/api/v1/projects/${projectId.value}/documents/${accessDoc.value.id}/access-policy`, {
      method: 'PUT',
      body: {
        lifecycleStage: accessPolicy.lifecycleStage,
        confidentialityLevel: accessPolicy.confidentialityLevel,
        defaultPermission: accessPolicy.defaultPermission,
        allowInternalAccess: accessPolicy.allowInternalAccess,
        allowCrossProject: accessPolicy.allowCrossProject,
        grants: accessPolicy.grants
      }
    })

    accessDoc.value.accessLifecycleStage = accessPolicy.lifecycleStage
    accessDoc.value.accessConfidentialityLevel = accessPolicy.confidentialityLevel
    toast.add({ title: '访问控制策略已更新', color: 'success' })
    await Promise.all([loadAccessPolicy(), loadAccessAuditLogs(1)])
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '保存访问策略失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    accessSaving.value = false
  }
}

function randomUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = Math.random() * 16 | 0
    const value = char === 'x' ? rand : (rand & 0x3 | 0x8)
    return value.toString(16)
  })
}

async function loadDocuments() {
  if (!projectId.value) return
  documentsLoading.value = true
  try {
    const res = await $fetch<{ code: number, data: { items?: RawProjectDocument[] } }>('/api/v1/project-documents/accessible', {
      params: {
        projectId: projectId.value
      }
    })
    if (res.code === 0) {
      documents.value = normalizeListPayload(res.data)
        .map(normalizeDocument)
        .filter(doc => Boolean(doc.id))
    }
  } catch (error) {
    console.error('[ProjectDocuments] Failed to load documents:', error)
    toast.add({ title: '加载项目文档失败', color: 'error' })
  } finally {
    documentsLoading.value = false
  }
}

function openCreateModal(kind: 'document' | 'folder', parentId: number | null = null) {
  if (!ensureCanWriteDocuments()) return
  const parent = parentId ? documentMap.value.get(parentId) : null
  createKind.value = kind
  createParentId.value = parentId
  createTargetKey.value = parent ? documentTargetKey(parent) : activeTarget.value.key
  createTitle.value = ''
  createCategory.value = 'general'
  createContent.value = ''
  showCreateModal.value = true
}

function folderPath(parentId: number | null) {
  if (!parentId) return ''
  const names: string[] = []
  let currentId: number | null = parentId
  const visited = new Set<number>()
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const current = documentMap.value.get(currentId)
    if (!current) break
    names.unshift(current.title)
    currentId = current.parentId
  }
  return names.join('/')
}

function initialMarkdown(title: string, content?: string) {
  if (content !== undefined) return content
  return `# ${title}\n\n`
}

function formatFileSize(size: number) {
  if (!size) return '-'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function otherDocumentCategory(fileName: string) {
  const extension = fileExtension(fileName)
  if (extension === 'doc' || extension === 'docx') return 'other_word'
  if (extension === 'xls' || extension === 'xlsx') return 'other_excel'
  if (extension === 'ppt' || extension === 'pptx') return 'other_powerpoint'
  if (extension === 'pdf') return 'other_pdf'
  return 'other_file'
}

function otherDocumentIcon(doc: ProjectDocument | null) {
  const category = doc?.category || ''
  if (category === 'other_word') return 'i-lucide-file-type'
  if (category === 'other_excel') return 'i-lucide-table-2'
  if (category === 'other_powerpoint') return 'i-lucide-presentation'
  if (category === 'other_pdf') return 'i-lucide-file-text'
  return 'i-lucide-file'
}

function cabinetDownloadUrl(doc: ProjectDocument | null) {
  if (!doc?.id) return ''
  return `/api/v1/projects/${projectId.value}/documents/${doc.id}/download`
}

async function downloadOtherDocument(doc: ProjectDocument | null) {
  if (!doc) return
  const url = cabinetDownloadUrl(doc)
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function createFolder() {
  if (!ensureCanWriteDocuments()) return
  const target = createTarget.value
  await $fetch('/api/v1/documents', {
    method: 'POST',
    body: {
      uuid: randomUuid(),
      ...(target.milestoneId ? { milestoneId: target.milestoneId } : { projectId: projectId.value }),
      projectCode: projectCode.value,
      parentId: createParentId.value,
      title: createTitle.value.trim(),
      isFolder: true
    }
  })
}

async function createMarkdownDocument(content?: string) {
  if (!ensureCanWriteDocuments()) return
  const target = createTarget.value
  await $fetch(`/api/v1/projects/${projectId.value}/markdown-documents`, {
    method: 'POST',
    body: {
      title: createTitle.value.trim(),
      docCategory: createCategory.value,
      milestoneId: target.milestoneId,
      parentId: createParentId.value,
      folderPath: folderPath(createParentId.value),
      content: initialMarkdown(createTitle.value.trim(), content)
    }
  })
}

async function submitCreate() {
  if (!ensureCanWriteDocuments()) return
  if (!createTitle.value.trim()) return
  creating.value = true
  try {
    if (createKind.value === 'folder') {
      await createFolder()
      toast.add({ title: '文件夹已创建', color: 'success' })
    } else {
      await createMarkdownDocument(createContent.value || undefined)
      toast.add({ title: 'Markdown 文档已创建', color: 'success' })
    }
    showCreateModal.value = false
    await loadDocuments()
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '创建失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    creating.value = false
  }
}

function triggerMarkdownUpload() {
  if (!ensureCanWriteDocuments()) return
  if (uploadingMarkdown.value || uploadingOther.value) return
  markdownFileInput.value?.click()
}

function triggerOtherUpload() {
  if (!ensureCanWriteDocuments()) return
  if (uploadingMarkdown.value || uploadingOther.value) return
  otherFileInput.value?.click()
}

async function handleMarkdownUpload(event: Event) {
  if (!ensureCanWriteDocuments()) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  if (!file.name.toLowerCase().endsWith('.md')) {
    toast.add({ title: '仅支持上传 .md 文件', color: 'warning' })
    return
  }

  uploadingMarkdown.value = true
  toast.add({ title: '正在上传 Markdown 文档，请稍候', color: 'info' })
  try {
    createKind.value = 'document'
    createParentId.value = null
    createTargetKey.value = activeTarget.value.key
    createTitle.value = file.name.replace(/\.md$/i, '')
    createCategory.value = 'general'
    createContent.value = await file.text()
    await submitCreate()
  } finally {
    uploadingMarkdown.value = false
  }
}

async function handleOtherUpload(event: Event) {
  if (!ensureCanWriteDocuments()) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const extension = fileExtension(file.name)
  if (!otherDocumentExtensions.has(extension)) {
    toast.add({ title: '支持上传 Word、Excel、PowerPoint、PDF、TXT、CSV、压缩包等文件', color: 'warning' })
    return
  }

  uploadingOther.value = true
  toast.add({ title: '正在上传其他文档到文件柜，请稍候', color: 'info' })
  try {
    const formData = new FormData()
    formData.append('file', file, file.name)
    formData.append('docCategory', otherDocumentCategory(file.name))

    await $fetch(`/api/v1/projects/${projectId.value}/other-documents`, {
      method: 'POST',
      body: formData
    })
    toast.add({ title: '其他文档已上传到文件柜并纳入统一管理', color: 'success' })
    selectedLibrary.value = 'other'
    await loadDocuments()
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '上传失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    uploadingOther.value = false
  }
}

async function openDocument(docNode: DocumentNode) {
  const doc = documentMap.value.get(docNode.id)
  if (!doc || doc.type === 'folder') return

  if (doc.virtual) {
    previewDoc.value = doc
    showPreviewModal.value = true
    return
  }

  if (doc.documentSource === 'repo') {
    const viewAccess = await checkDocumentAccess(doc, 'view')
    if (!viewAccess.allowed) return
    previewDoc.value = doc
    showPreviewModal.value = true
    return
  }

  if (canWriteDocuments.value) {
    const editAccess = await checkDocumentAccess(doc, 'edit')
    if (editAccess.allowed && !editAccess.readonly) {
      editorDoc.value = doc
      showEditorModal.value = true
      return
    }
  }

  const viewAccess = await checkDocumentAccess(doc, 'view')
  if (!viewAccess.allowed) return
  previewDoc.value = doc
  showPreviewModal.value = true
}

function libraryLabel(doc: ProjectDocument) {
  return isOtherDocument(doc) ? '其他文档' : 'Markdown'
}

function closeEditorModal() {
  showEditorModal.value = false
  editorDoc.value = null
}

function closePreviewModal() {
  showPreviewModal.value = false
  previewDoc.value = null
}

function confirmDelete(id: number) {
  if (!ensureCanWriteDocuments()) return
  deleteTarget.value = documentMap.value.get(id) || null
  if (deleteTarget.value?.virtual) {
    toast.add({ title: '任务交付文档来自交付记录，请在任务交付中调整', color: 'warning' })
    deleteTarget.value = null
    return
  }
  if (!deleteTarget.value) return
  showDeleteModal.value = true
}

function openAccessById(id: number) {
  const doc = documentMap.value.get(id)
  if (!doc || doc.type === 'folder') return
  if (doc.virtual) {
    toast.add({ title: '任务交付文档沿用原文档访问控制', color: 'info' })
    return
  }
  openAccessModal(doc)
}

async function deleteDocument() {
  if (!ensureCanWriteDocuments()) return
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await $fetch(`/api/v1/documents/${deleteTarget.value.id}`, { method: 'DELETE' })
    toast.add({ title: '文档索引已删除', color: 'success' })
    showDeleteModal.value = false
    await loadDocuments()
  } catch (error: unknown) {
    const message = (error as { data?: { message?: string }, message?: string })?.data?.message
      || (error as { message?: string })?.message
      || '删除失败'
    toast.add({ title: message, color: 'error' })
  } finally {
    deleting.value = false
  }
}

watch(projectCode, () => {
  loadDocuments()
})

watch(showEditorModal, (open) => {
  if (!open) editorDoc.value = null
})

watch(showPreviewModal, (open) => {
  if (!open) previewDoc.value = null
})

onMounted(async () => {
  if (!project.value || project.value.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await milestoneStore.fetchMilestones(projectId.value)
  await loadDocuments()
})
</script>

<template>
  <UDashboardPanel id="project-documents" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar />

        <div class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[18rem_1fr]">
          <aside class="flex min-h-0 flex-col border-b border-default bg-default lg:border-b-0 lg:border-r">
            <div class="space-y-3 border-b border-default p-4">
              <UInput
                v-model="search"
                icon="i-lucide-search"
                placeholder="搜索文档"
              />

              <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="rounded-lg border border-default px-2 py-2">
                  <div class="font-semibold text-highlighted">
                    {{ documentStats.total }}
                  </div>
                  <div class="text-muted">
                    全部
                  </div>
                </div>
                <div class="rounded-lg border border-default px-2 py-2">
                  <div class="font-semibold text-highlighted">
                    {{ documentStats.standard }}
                  </div>
                  <div class="text-muted">
                    Markdown
                  </div>
                </div>
                <div class="rounded-lg border border-default px-2 py-2">
                  <div class="font-semibold text-highlighted">
                    {{ documentStats.other }}
                  </div>
                  <div class="text-muted">
                    其他
                  </div>
                </div>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div class="space-y-2">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
                  :class="selectedLibrary === 'standard' ? 'bg-primary/10 text-primary' : 'text-default hover:bg-elevated'"
                  @click="selectedLibrary = 'standard'"
                >
                  <UIcon name="i-lucide-book-marked" class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">规范文档（Markdown）</span>
                  <span class="text-xs text-muted">{{ documentStats.standard }}</span>
                </button>

                <div v-if="selectedLibrary === 'standard'" class="space-y-1 pl-3">
                  <button
                    v-for="target in targets"
                    :key="target.key"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                    :class="selectedTargetKey === target.key ? 'bg-primary/10 text-primary' : 'text-default hover:bg-elevated'"
                    @click="selectedTargetKey = target.key"
                  >
                    <UIcon :name="target.icon" class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1 truncate">{{ target.label }}</span>
                    <UBadge
                      v-if="target.pivrStage"
                      color="info"
                      variant="subtle"
                      size="xs"
                    >
                      {{ target.pivrStage }}
                    </UBadge>
                    <span class="text-xs text-muted">{{ targetCount(target) }}</span>
                  </button>
                </div>

                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
                  :class="selectedLibrary === 'other' ? 'bg-primary/10 text-primary' : 'text-default hover:bg-elevated'"
                  @click="selectedLibrary = 'other'"
                >
                  <UIcon name="i-lucide-files" class="size-4 shrink-0" />
                  <span class="min-w-0 flex-1 truncate">其他文档</span>
                  <span class="text-xs text-muted">{{ documentStats.other }}</span>
                </button>
              </div>
            </div>
          </aside>

          <main class="flex min-h-0 flex-col overflow-hidden">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-5 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="selectedLibrary === 'other' ? 'i-lucide-files' : activeTarget.icon"
                    class="size-5 text-primary"
                  />
                  <h2 class="truncate text-base font-semibold text-highlighted">
                    {{ search ? '搜索结果' : (selectedLibrary === 'other' ? '其他文档' : activeTarget.label) }}
                  </h2>
                  <UBadge
                    v-if="selectedLibrary === 'standard' && activeTarget.pivrStage"
                    color="info"
                    variant="subtle"
                    size="sm"
                  >
                    {{ pivrStageLabel[activeTarget.pivrStage] || activeTarget.pivrStage }}
                  </UBadge>
                </div>
                <div v-if="projectCode" class="mt-1 text-xs text-muted">
                  {{ projectCode }}
                </div>
              </div>

              <div class="flex items-center gap-2">
                <input
                  ref="markdownFileInput"
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  class="hidden"
                  @change="handleMarkdownUpload"
                >
                <input
                  ref="otherFileInput"
                  type="file"
                  accept=".doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.txt,.csv,.zip,.rar,.7z,.tar,.gz"
                  class="hidden"
                  @change="handleOtherUpload"
                >
                <UButton
                  v-if="canWriteDocuments && selectedLibrary === 'standard'"
                  icon="i-lucide-upload"
                  :label="uploadingMarkdown ? '上传中' : '上传 .md'"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :loading="uploadingMarkdown"
                  :disabled="Boolean(search) || uploadingOther"
                  @click="triggerMarkdownUpload"
                />
                <UButton
                  v-if="canWriteDocuments && selectedLibrary === 'standard'"
                  icon="i-lucide-folder-plus"
                  label="文件夹"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  :disabled="Boolean(search) || uploadingMarkdown || uploadingOther"
                  @click="openCreateModal('folder')"
                />
                <UButton
                  v-if="canWriteDocuments && selectedLibrary === 'standard'"
                  icon="i-lucide-file-plus-2"
                  label="Markdown"
                  color="primary"
                  size="sm"
                  :disabled="Boolean(search) || uploadingMarkdown || uploadingOther"
                  @click="openCreateModal('document')"
                />
                <UButton
                  v-if="canWriteDocuments && selectedLibrary === 'other'"
                  icon="i-lucide-upload-cloud"
                  :label="uploadingOther ? '上传中' : '上传其他文档'"
                  color="primary"
                  size="sm"
                  :loading="uploadingOther"
                  :disabled="Boolean(search) || uploadingMarkdown"
                  @click="triggerOtherUpload"
                />
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-5">
              <UAlert
                v-if="uploadingMarkdown || uploadingOther"
                icon="i-lucide-loader-2"
                color="info"
                variant="soft"
                class="mb-4"
                :title="uploadingMarkdown ? 'Markdown 文档正在上传' : '其他文档正在上传到文件柜'"
                description="请保持当前页面打开，上传完成后列表会自动刷新。"
                :ui="{ icon: 'animate-spin' }"
              />

              <div v-if="documentsLoading" class="flex justify-center py-12">
                <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
              </div>

              <div v-else-if="search" class="space-y-2">
                <div v-if="searchResults.length === 0" class="py-12 text-center text-sm text-muted">
                  未找到匹配文档
                </div>
                <button
                  v-for="doc in searchResults"
                  :key="doc.id"
                  type="button"
                  class="flex w-full items-center gap-3 rounded-lg border border-default px-3 py-2.5 text-left transition-colors hover:bg-elevated"
                  @click="openDocument(doc)"
                >
                  <UIcon
                    :name="isOtherDocument(doc) ? otherDocumentIcon(doc) : 'i-lucide-file-text'"
                    class="size-4 shrink-0 text-primary"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-highlighted">
                      {{ doc.title }}
                    </div>
                    <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{{ targetLabelForDoc(doc) }}</span>
                      <span v-if="doc.category">{{ categoryLabel[doc.category] || doc.category }}</span>
                      <span>{{ formatDate(doc.updatedAt) }}</span>
                    </div>
                  </div>
                  <UBadge color="neutral" variant="subtle" size="xs">
                    {{ libraryLabel(doc) }}
                  </UBadge>
                  <UButton
                    v-if="canWriteDocuments && !doc.virtual"
                    icon="i-lucide-shield-check"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="访问控制"
                    @click.stop="openAccessModal(doc)"
                  />
                </button>
              </div>

              <div v-else class="rounded-lg border border-default">
                <div class="flex items-center justify-between border-b border-default px-3 py-2 text-xs text-muted">
                  <span>名称</span>
                  <span class="hidden sm:inline">更新时间</span>
                </div>
                <DocumentTree
                  :documents="activeDocumentTree"
                  :loading="false"
                  :readonly="!canWriteDocuments"
                  @create-folder="openCreateModal('folder', $event)"
                  @create-doc="openCreateModal('document', $event)"
                  @delete="confirmDelete"
                  @click-doc="openDocument"
                  @access-control="openAccessById"
                />
              </div>
            </div>
          </main>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showCreateModal" :ui="{ content: 'sm:max-w-lg' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon :name="createKind === 'folder' ? 'i-lucide-folder-plus' : 'i-lucide-file-plus-2'" class="size-5 text-primary" />
        <h3 class="text-base font-semibold">
          {{ createKind === 'folder' ? '新建文件夹' : '新建 Markdown 文档' }}
        </h3>
      </div>
    </template>

    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="所属范围">
          <USelect
            v-model="createTargetKey"
            :items="targets.map(target => ({ label: target.label, value: target.key }))"
            value-key="value"
            class="w-full"
            :disabled="Boolean(createParentId)"
          />
        </UFormField>

        <UFormField :label="createKind === 'folder' ? '文件夹名称' : '文档标题'" required>
          <UInput
            v-model="createTitle"
            class="w-full"
            :placeholder="createKind === 'folder' ? '如：评审材料' : '如：接口设计说明'"
            autofocus
            @keydown.enter.prevent="submitCreate"
          />
        </UFormField>

        <UFormField v-if="createKind === 'document'" label="文档分类">
          <USelect
            v-model="createCategory"
            :items="categoryOptions"
            value-key="value"
            class="w-full"
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
          @click="showCreateModal = false"
        />
        <UButton
          label="创建"
          color="primary"
          :loading="creating"
          :disabled="!createTitle.trim()"
          @click="submitCreate"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showDeleteModal" :ui="{ content: 'sm:max-w-md' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-trash-2" class="size-5 text-error" />
        <h3 class="text-base font-semibold">
          删除文档索引
        </h3>
      </div>
    </template>
    <template #body>
      <div class="p-4 text-sm text-muted">
        {{ deleteTarget?.title || '该文档' }}
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showDeleteModal = false"
        />
        <UButton
          label="删除"
          color="error"
          :loading="deleting"
          @click="deleteDocument"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showEditorModal" :ui="{ content: 'sm:max-w-6xl max-h-[90vh]', body: 'overflow-hidden p-0' }">
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span class="truncate text-base font-medium">{{ editorDoc?.title || '编辑文档' }}</span>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          aria-label="关闭编辑弹窗"
          @click="closeEditorModal"
        />
      </div>
    </template>
    <template #body>
      <div class="h-[76vh] min-h-80">
        <CodocsEditor
          v-if="editorDoc && showEditorModal"
          :uuid="editorDoc.codocsUuid || editorDoc.uuid || ''"
          :show-title="false"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showPreviewModal" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <span class="truncate text-base font-medium">{{ previewDoc?.title || '文档预览' }}</span>
        <div class="flex items-center gap-1">
          <UButton
            v-if="canWriteDocuments && previewDoc && !previewDoc.virtual"
            icon="i-lucide-shield-check"
            label="访问控制"
            color="neutral"
            variant="soft"
            size="sm"
            @click="openAccessModalForPreview"
          />
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
      </div>
    </template>
    <template #body>
      <div class="h-[72vh] min-h-72 p-4">
        <div
          v-if="previewDoc && isOtherDocument(previewDoc)"
          class="flex h-full flex-col items-center justify-center rounded-lg border border-default bg-muted/20 p-6 text-center"
        >
          <UIcon :name="otherDocumentIcon(previewDoc)" class="mb-4 size-12 text-primary" />
          <h3 class="max-w-full truncate text-base font-semibold text-highlighted">
            {{ previewDoc.title }}
          </h3>
          <div class="mt-3 grid gap-2 text-sm text-muted sm:grid-cols-2">
            <div>类型：{{ categoryLabel[previewDoc.category || ''] || '其他文件' }}</div>
            <div>大小：{{ formatFileSize(previewDoc.contentSize) }}</div>
            <div>生命周期：{{ previewDoc.accessLifecycleStage }}</div>
            <div>密级：{{ previewDoc.accessConfidentialityLevel }}</div>
            <div class="sm:col-span-2">
              OSS：{{ previewDoc.ossPath || previewDoc.repoFilePath || '-' }}
            </div>
          </div>
          <p class="mt-4 max-w-xl text-sm text-muted">
            文件已存入 Codocs 文件柜并纳入项目文档统一管理。在线预览和下载将复用文件柜能力。
          </p>
          <div class="mt-5 flex items-center justify-center gap-2">
            <UButton
              icon="i-lucide-download"
              label="下载文件"
              color="primary"
              @click="downloadOtherDocument(previewDoc)"
            />
          </div>
        </div>
        <AimsDocumentPreview
          v-else-if="previewDoc && showPreviewModal"
          :source="previewDoc.documentSource"
          :codocs-uuid="previewDoc.codocsUuid"
          :project-id="projectId"
          :repo-project-code="previewDoc.repoProjectCode"
          :repo-file-path="previewDoc.repoFilePath"
          :repo-commit-id="previewDoc.repoCommitId"
          :title="previewDoc.title"
        />
      </div>
    </template>
  </UModal>

  <UModal v-model:open="showAccessModal" :ui="{ content: 'sm:max-w-4xl', body: 'overflow-hidden p-0' }">
    <template #header>
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="truncate text-base font-semibold text-highlighted">
            文档访问控制
          </div>
          <div class="truncate text-xs text-muted">
            {{ accessDoc?.title || '-' }}
          </div>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          aria-label="关闭访问控制弹窗"
          @click="closeAccessModal"
        />
      </div>
    </template>

    <template #body>
      <div class="grid max-h-[78vh] grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[1.1fr_1fr]">
        <div class="overflow-y-auto border-b border-default p-4 lg:border-b-0 lg:border-r">
          <div class="mb-3 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-highlighted">
              策略编辑
            </h4>
            <UBadge color="neutral" variant="subtle" size="xs">
              只读：{{ accessPolicy.readonly ? '是' : '否' }}
            </UBadge>
          </div>

          <div v-if="accessLoading" class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>

          <div v-else class="space-y-4">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField label="生命周期">
                <USelect
                  v-model="accessPolicy.lifecycleStage"
                  :items="accessLifecycleOptions"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="密级">
                <USelect
                  v-model="accessPolicy.confidentialityLevel"
                  :items="accessConfidentialityOptions"
                  value-key="value"
                  class="w-full"
                />
              </UFormField>
            </div>

            <UFormField label="默认权限">
              <USelect
                v-model="accessPolicy.defaultPermission"
                :items="accessDefaultPermissionOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2">
                <span class="text-sm text-muted">允许企业内访问</span>
                <USwitch v-model="accessPolicy.allowInternalAccess" />
              </label>
              <label class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2">
                <span class="text-sm text-muted">允许跨项目授权</span>
                <USwitch v-model="accessPolicy.allowCrossProject" />
              </label>
            </div>

            <div class="space-y-3 rounded-md border border-default p-3">
              <div class="text-sm font-medium text-highlighted">
                授权白名单
              </div>

              <div class="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <USelect
                  v-model="newGrant.subjectType"
                  :items="accessGrantSubjectTypeOptions"
                  value-key="value"
                  class="w-full"
                />
                <UInput
                  v-model="newGrant.subjectCode"
                  placeholder="主体编码"
                  class="w-full sm:col-span-2"
                />
                <USelect
                  v-model="newGrant.permission"
                  :items="accessGrantPermissionOptions"
                  value-key="value"
                  class="w-full"
                />
              </div>

              <div class="flex justify-end">
                <UButton
                  icon="i-lucide-plus"
                  label="添加授权"
                  color="neutral"
                  variant="soft"
                  size="sm"
                  @click="addAccessGrant"
                />
              </div>

              <div v-if="accessPolicy.grants.length === 0" class="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted">
                暂无白名单授权
              </div>

              <div v-else class="space-y-2">
                <div
                  v-for="(grant, idx) in accessPolicy.grants"
                  :key="`${grant.subjectType}-${grant.subjectCode}-${idx}`"
                  class="flex items-center gap-2 rounded-md border border-default px-3 py-2"
                >
                  <UBadge color="neutral" variant="subtle" size="xs">
                    {{ grant.subjectType }}
                  </UBadge>
                  <span class="min-w-0 flex-1 truncate text-sm">{{ grant.subjectCode }}</span>
                  <UBadge color="primary" variant="subtle" size="xs">
                    {{ grant.permission }}
                  </UBadge>
                  <UButton
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="ghost"
                    size="xs"
                    aria-label="删除授权"
                    @click="removeAccessGrant(idx)"
                  />
                </div>
              </div>
            </div>

            <div class="flex justify-end">
              <UButton
                icon="i-lucide-save"
                label="保存策略"
                color="primary"
                :loading="accessSaving"
                @click="saveAccessPolicy"
              />
            </div>
          </div>
        </div>

        <div class="overflow-y-auto p-4">
          <div class="mb-3 flex items-center justify-between">
            <h4 class="text-sm font-semibold text-highlighted">
              最近访问审计
            </h4>
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="xs"
              :loading="accessAuditLoading"
              @click="loadAccessAuditLogs(accessAuditPage)"
            />
          </div>

          <div v-if="accessAuditLoading" class="flex items-center justify-center py-8">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
          </div>

          <div v-else-if="accessAuditLogs.length === 0" class="rounded-md bg-muted/30 px-3 py-8 text-center text-sm text-muted">
            暂无审计记录
          </div>

          <div v-else class="space-y-2">
            <div
              v-for="item in accessAuditLogs"
              :key="item.id"
              class="rounded-md border border-default px-3 py-2"
            >
              <div class="flex items-center gap-2 text-xs text-muted">
                <span>{{ formatDate(item.createdAt) }}</span>
                <UBadge :color="item.decision === 'allow' ? 'success' : 'error'" variant="subtle" size="xs">
                  {{ accessDecisionLabel[item.decision] }}
                </UBadge>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ item.action }}
                </UBadge>
              </div>
              <div class="mt-1 text-sm text-highlighted">
                {{ accessReasonText(item.reason) }}
              </div>
              <div class="mt-0.5 text-xs text-muted">
                操作人：{{ item.actorUid || 'system' }}
              </div>
            </div>
          </div>

          <div class="mt-3 flex items-center justify-between text-xs text-muted">
            <span>共 {{ accessAuditTotal }} 条</span>
            <div class="flex items-center gap-1">
              <UButton
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="accessAuditPage <= 1"
                @click="loadAccessAuditLogs(accessAuditPage - 1)"
              />
              <span>第 {{ accessAuditPage }} 页</span>
              <UButton
                icon="i-lucide-chevron-right"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="accessAuditPage * accessAuditPageSize >= accessAuditTotal"
                @click="loadAccessAuditLogs(accessAuditPage + 1)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
