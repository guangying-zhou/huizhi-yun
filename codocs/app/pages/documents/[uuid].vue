<script setup lang="ts">
/**
 * 文档编辑页面
 *
 * 集成 Milkdown 编辑器和实时协同功能
 */

definePageMeta({
  layout: 'default'
})

usePageTitle('文档编辑')

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { getPayload: getDocumentPreviewBootstrap, consumePayload: consumeDocumentPreviewBootstrap, clearPayload: clearDocumentPreviewBootstrap } = useDocumentPreviewBootstrap()
const { user: authUser, userRealname: authRealName } = useAuth()
const { watermarkText } = useViewerWatermark()
const authUserId = computed(() => authUser.value || '')
const disableShareTab = computed(() => route.query.fromShare === '1')

type EditorSidebarTab = 'outline' | 'history' | 'share' | 'annotations' | 'ai'

interface ApiSuccessResponse<T> {
  success: boolean
  data: T
}

interface ApiCodeResponse<T = undefined> {
  code: number
  message: string
  data?: T
}

interface DocumentConflictInfo {
  [key: string]: unknown
}

interface DocumentState {
  id: string
  title: string
  content: string
  doc_type: string
  owner_uid: string
  project_code: string
  updated_at: string
  readonly_flag: number
  hasConflict: boolean
  conflictInfo: DocumentConflictInfo | null
  oss_path: string
  publish_info: string
  ai_abstract: string
}

interface AnnotationItem {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  [key: string]: unknown
}

interface MilkdownEditorExpose {
  setMarkdown: (value: string) => void
  getMarkdown: () => string
  switchToTab: (tab: EditorSidebarTab) => void
}

interface DocumentResponseData {
  id: string
  title?: string
  content?: string
  doc_type?: string
  owner_uid?: string
  project_code?: string
  updated_at?: string
  readonly_flag?: number
  hasConflict?: boolean
  conflictInfo?: DocumentConflictInfo | null
  oss_path?: string
  publish_info?: string
  ai_abstract?: string
}

interface PublishReviewRecord {
  id: number
  review_type?: string | null
  extra?: {
    sendTo?: string
  } | null
  send_records?: Array<{
    receiver_name?: string | null
    sent_date?: string | null
    confirmed_at?: string | null
  }>
}

interface ProjectAccountData {
  repoUrl?: string
}

interface VersionSummary {
  id: number
  versionNum: number
  editorUid: string
  editorName?: string
  createdAt: string
  contentSize?: number
}

interface VersionDetail extends VersionSummary {
  content: string
}

interface DiffVersionData extends VersionDetail {
  id: number
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string' && error.message) {
      return error.message
    }

    if ('data' in error && typeof error.data === 'object' && error.data !== null && 'message' in error.data) {
      const message = error.data.message
      if (typeof message === 'string' && message) {
        return message
      }
    }
  }

  return fallback
}

const formatPublishDateText = (dateStr?: string | null) => {
  if (!dateStr) return ''
  const value = new Date(dateStr)
  if (Number.isNaN(value.getTime())) return String(dateStr)
  return `${value.getFullYear()}年${String(value.getMonth() + 1).padStart(2, '0')}月${String(value.getDate()).padStart(2, '0')}日`
}

const getPublishedInfoText = (publishInfo: string, record: PublishReviewRecord | null) => {
  const latestSend = record?.send_records?.length
    ? record.send_records[record.send_records.length - 1]
    : null
  const receiverName = String(
    latestSend?.receiver_name
    || record?.extra?.sendTo
    || ''
  ).trim()
  const sentAt = latestSend?.sent_date || latestSend?.confirmed_at || null

  if (record?.review_type === '对外发文' && receiverName) {
    const dateLabel = formatPublishDateText(sentAt)
    return dateLabel
      ? `已于${dateLabel}发送给${receiverName}`
      : `已发送给${receiverName}`
  }

  try {
    const parsed = JSON.parse(publishInfo) as { label?: string, date?: string }
    if (parsed?.label) {
      const dateLabel = formatPublishDateText(parsed.date)
      return dateLabel
        ? `已于${dateLabel}发布至"${parsed.label}"`
        : `已发布至"${parsed.label}"`
    }
  } catch {
    return publishInfo
  }

  return publishInfo
}

// ────── 未保存变更离开拦截 ──────
const unsavedGuardOpen = ref(false)
let unsavedGuardResolve: ((action: 'save' | 'discard' | 'cancel') => void) | null = null
let pendingNavigationPath: string | null = null

const needsUnsavedGuard = computed(() => {
  if (isLeavingDocumentPage.value) return false
  if (docState.value.readonly_flag) return false
  if (isEditingLockedByCollaborationFallback.value) return false
  if (isRealtimeCollaboration.value) return false
  if (!isPageReady.value) return false
  return hasUnsavedChanges.value || hasPendingContentFlush.value
})

function promptUnsavedGuard(): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    unsavedGuardResolve = resolve
    unsavedGuardOpen.value = true
  })
}

async function handleUnsavedGuardAction(action: 'save' | 'discard' | 'cancel') {
  unsavedGuardOpen.value = false
  if (action === 'save') {
    await saveDocument({ forceContent: true })
  }
  if (unsavedGuardResolve) {
    unsavedGuardResolve(action)
    unsavedGuardResolve = null
  }
  if (action !== 'cancel' && pendingNavigationPath) {
    const path = pendingNavigationPath
    pendingNavigationPath = null
    isLeavingDocumentPage.value = true
    router.push(path)
  }
  pendingNavigationPath = null
}

onBeforeRouteLeave(async (to) => {
  if (!needsUnsavedGuard.value) return true
  pendingNavigationPath = to.fullPath
  const action = await promptUnsavedGuard()
  return action !== 'cancel'
})

// 返回上一页
const goBack = () => {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/mydocs')
  }
}

// 文档 ID
const documentId = computed(() => route.params.uuid as string)

// 是否是新建的工作日志（通过 ?new=1 标记，且文档类型为 private/工作日志）
const isNewWorklog = computed(() => route.query.new === '1' && docState.value.doc_type === 'private' && (docState.value.title.startsWith('工作日志_') || docState.value.title.endsWith('工作日志')))
// 用户是否做过编辑
const userEdited = ref(false)

const getWorklogDate = (title: string) => {
  const newMatch = title.match(/^(\d{4})(\d{2})(\d{2})-/)
  const oldMatch = title.match(/工作日志_(\d{4})(\d{2})(\d{2})/)
  const dateMatch = newMatch || oldMatch

  if (!dateMatch) {
    return null
  }

  return `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
}

// 文档数据
const docState = ref<DocumentState>({
  id: '',
  title: '未命名文档',
  content: '',
  doc_type: 'private',
  owner_uid: '',
  project_code: '',
  updated_at: '',
  readonly_flag: 0,
  hasConflict: false,
  conflictInfo: null,
  oss_path: '',
  publish_info: '',
  ai_abstract: ''
})

// 项目元数据（用于项目文档）
const projectMetadata = ref({
  repoUrl: '',
  docPath: ''
})

// 状态
const loading = ref(true)
const saving = ref(false)
const lastSaved = ref<Date | null>(null)
const isPageReady = ref(false)

// 版本历史
const showVersionHistory = ref(false)
// 共享面板
const showSharePanel = ref(false)
const versionsLoading = ref(false)
const versions = ref<VersionSummary[]>([])
const showPublishRecord = ref(false)
const publishReviewRecord = ref<PublishReviewRecord | null>(null)

// 标注数据
const annotations = ref<AnnotationItem[]>([])
const fetchAnnotations = async () => {
  try {
    const response = await $fetch<ApiSuccessResponse<AnnotationItem[]>>(`/api/documents/${documentId.value}/annotations`)
    if (response.success) {
      annotations.value = response.data
    }
  } catch (error) {
    console.error('Failed to fetch annotations:', error)
  }
}

// 标注操作
const handleCreateAnnotation = async (data: { selectedText: string, contextBefore: string, contextAfter: string, positionHint: number, content: string }) => {
  try {
    const response = await $fetch<{ success: boolean, data: { id: number } }>(`/api/documents/${documentId.value}/annotations`, {
      method: 'POST',
      body: {
        selected_text: data.selectedText,
        context_before: data.contextBefore,
        context_after: data.contextAfter,
        position_hint: data.positionHint,
        content: data.content,
        mentioned_users: [], // TODO: implement mentions
        author_id: authUserId.value || docState.value.owner_uid || '0',
        author_name: authRealName.value || '我' // TODO: get real name
      }
    })
    if (response.success) {
      await fetchAnnotations()
      toast.add({ title: '标注已创建', color: 'success' })
    }
  } catch (error) {
    console.error('Failed to create annotation:', error)
    toast.add({ title: '创建失败', color: 'error' })
  }
}

const handleReplyAnnotation = async (id: number, content: string) => {
  try {
    const response = await $fetch(`/api/documents/${documentId.value}/annotations/${id}/replies`, {
      method: 'POST',
      body: {
        content,
        mentioned_users: [],
        author_id: authUserId.value || docState.value.owner_uid || '0',
        author_name: authRealName.value || '我'
      }
    })
    if (response?.success) {
      await fetchAnnotations()
    }
  } catch (error) {
    console.error('Failed to reply:', error)
    toast.add({ title: '回复失败', color: 'error' })
  }
}

const handleResolveAnnotation = async (id: number) => {
  try {
    const response = await $fetch(`/api/documents/${documentId.value}/annotations/${id}`, {
      method: 'PATCH',
      body: {
        status: 'resolved',
        resolved_by: authUserId.value
      }
    })
    if (response?.success) {
      await fetchAnnotations()
    }
  } catch (error) {
    console.error('Failed to resolve:', error)
  }
}

const handleDeleteAnnotation = async (id: number) => {
  try {
    const response = await $fetch(`/api/documents/${documentId.value}/annotations/${id}`, {
      method: 'PATCH',
      body: {
        status: 'deleted',
        deleted_by: authUserId.value
      }
    })
    if (response?.success) {
      await fetchAnnotations()
      toast.add({ title: '标注已删除', color: 'success' })
    }
  } catch (error) {
    console.error('Failed to delete:', error)
  }
}

const handleDeleteReply = async (annotationId: number, replyId: number) => {
  try {
    const response = await $fetch(`/api/documents/${documentId.value}/annotations/${annotationId}/replies/${replyId}`, {
      method: 'DELETE'
    })
    if (response?.success) {
      await fetchAnnotations()
    }
  } catch (error) {
    console.error('Failed to delete reply:', error)
  }
}

const handleClickAnnotation = (annotationId: number) => {
  // Find the annotation and scroll to it in the sidebar
  const annotation = annotations.value.find(annotationItem => annotationItem.id === annotationId)
  if (annotation) {
    // The sidebar should automatically scroll to and highlight this annotation
    // For now, we can trigger a scroll by using DOM or just log
    console.log('Annotation clicked:', annotationId)
    // TODO: Implement sidebar scroll if needed
  }
}

// 保存的文档状态（用于比较变更）
const savedState = ref({
  title: '',
  content: ''
})

// 是否有未保存的变更
const hasUnsavedChanges = computed(() => {
  return docState.value.title !== savedState.value.title
    || (shouldPersistContentViaHttp.value && editorContent.value !== savedState.value.content)
})
const hasPendingTitleChange = computed(() => docState.value.title !== savedState.value.title)
const hasPendingContentFlush = computed(() => editorContent.value !== savedState.value.content)

const shouldShowReadonlyWatermark = computed(() => {
  if (!docState.value.readonly_flag && !viewingVersion.value) return false

  return Boolean(docState.value.publish_info)
    || ['company', 'knowledge', 'product'].includes(docState.value.doc_type)
    || String(docState.value.oss_path || '').startsWith('codocs/company/')
})

// 协同状态
// 编辑器内容和主题
const editorContent = ref('')
const viewMode = ref<'edit' | 'source'>('edit')
const { editorTheme } = useEditorTheme()
const milkdownEditorRef = ref<MilkdownEditorExpose | null>(null)
const collaboration = useCollaboration({
  documentId,
  user: computed(() => ({
    id: authUserId.value || 'anonymous',
    name: authRealName.value || authUserId.value || '匿名用户'
  }))
})
const isDocumentOwner = computed(() => Boolean(authUserId.value) && authUserId.value === docState.value.owner_uid)
const isRepositorySyncDoc = computed(() => docState.value.doc_type === 'git-project')
const supportsCollaboration = computed(() => !isRepositorySyncDoc.value)
const isRealtimeCollaboration = computed(() => collaboration.isConnected.value && !viewingVersion.value)
const isCollaborationConnecting = computed(() => collaboration.isConnecting.value)
const isPrivateUnsharedDoc = computed(() => docState.value.doc_type === 'private' && !isSharedDoc.value && shareMembers.value.length === 0)
const shouldLoadFromCollaboration = computed(() => supportsCollaboration.value && Boolean(authUserId.value) && !viewingVersion.value && !isPrivateUnsharedDoc.value)
const isLeavingDocumentPage = ref(false)
const collaborationFallbackMode = ref<'none' | 'owner-edit' | 'viewer-readonly'>('none')
const collaborationFallbackLoaded = ref(false)
const isOwnerHttpFallbackMode = computed(() => collaborationFallbackMode.value === 'owner-edit')
const isViewerReadonlyFallbackMode = computed(() => collaborationFallbackMode.value === 'viewer-readonly')
const isWaitingForCollaborationSync = computed(() =>
  shouldLoadFromCollaboration.value
  && !collaboration.synced.value
  && !collaboration.error.value
  && !collaborationFallbackLoaded.value
)
const hasRemoteCollaborators = computed(() => collaboration.collaborators.value.length > 0)
const isCollaborationReadonlyScope = computed(() => collaboration.scope.value === 'readonly')
const isEditingLockedByCollaborationFallback = computed(() => isViewerReadonlyFallbackMode.value)
const isEditingDisabled = computed(() =>
  !!docState.value.readonly_flag
  || !!viewingVersion.value
  || isWaitingForCollaborationSync.value
  || isEditingLockedByCollaborationFallback.value
)
const canViewShares = computed(() => supportsCollaboration.value && !disableShareTab.value)
const canManageShares = computed(() => canViewShares.value && !docState.value.readonly_flag && isDocumentOwner.value)
const collaborationEditorEnabled = computed(() => !isLeavingDocumentPage.value && collaboration.synced.value && !viewingVersion.value)
const editorInstanceKey = computed(() => {
  // Crepe 的 BlockEdit/Toolbar 等 feature 只在 create() 时决定。
  // 文档页会先经历一次“协同未同步完成”的临时只读态，因此这里必须在
  // 编辑能力切换后强制 remount，否则编辑器会停留在首次初始化的只读 feature 集里。
  return [
    documentId.value,
    Number(isEditingDisabled.value),
    Number(collaborationEditorEnabled.value)
  ].join(':')
})

// 共享成员信息（用于协同状态栏展示）
interface ShareMemberInfo {
  uid: string
  realName: string
  permission: 'read' | 'write'
}
const shareMembers = ref<ShareMemberInfo[]>([])
const isSharedDoc = computed(() => authUserId.value !== docState.value.owner_uid && authUserId.value !== '')
const ownerName = ref('')
const documentSourceDisplayName = computed(() => {
  const ownerUid = String(docState.value.owner_uid || '').trim()
  if (!ownerUid) return ''
  if (ownerUid === authUserId.value) return '我'
  return ownerName.value || ownerUid
})

const onlineCollaborationMembers = computed(() => {
  if (!collaboration.isConnected.value) {
    return []
  }

  const members = new Map<string, { uid: string, name: string }>()
  const selfUid = String(authUserId.value || '').trim()
  if (selfUid) {
    members.set(selfUid, {
      uid: selfUid,
      name: authRealName.value || selfUid
    })
  }

  for (const collaborator of collaboration.collaborators.value) {
    if (!collaborator.id || members.has(collaborator.id)) continue
    members.set(collaborator.id, {
      uid: collaborator.id,
      name: collaborator.name || collaborator.id
    })
  }

  return [...members.values()]
})

const fetchShareMembers = async () => {
  if (!documentId.value) return
  try {
    const res = await $fetch<{ code: number, data?: Array<{ shared_to_uid: string, real_name: string, permission: string }> }>(
      `/api/documents/${documentId.value}/shares`
    )
    if (res.code === 0 && res.data) {
      // 收集所有需要查询姓名的 uid（共享成员 + 文档所有者）
      const uidsToResolve = new Set<string>()
      for (const s of res.data) uidsToResolve.add(s.shared_to_uid)
      if (docState.value.owner_uid) uidsToResolve.add(docState.value.owner_uid)
      // 排除当前用户（已知姓名）
      uidsToResolve.delete(authUserId.value)

      // 批量查询真实姓名
      const nameMap = new Map<string, string>()
      if (uidsToResolve.size > 0) {
        try {
          const userRes = await $fetch<{ code: number, data?: Array<{ uid: string, realName?: string }> }>(
            '/api/account/users/batch',
            { method: 'POST', body: { uids: [...uidsToResolve] } }
          )
          if (userRes.data) {
            for (const u of userRes.data) {
              if (u.realName) nameMap.set(u.uid, u.realName)
            }
          }
        } catch { /* ignore */ }
      }

      shareMembers.value = res.data.map(s => ({
        uid: s.shared_to_uid,
        realName: nameMap.get(s.shared_to_uid) || s.real_name || s.shared_to_uid,
        permission: s.permission as 'read' | 'write'
      }))

      // 设置文档所有者姓名
      if (docState.value.owner_uid && docState.value.owner_uid !== authUserId.value) {
        ownerName.value = nameMap.get(docState.value.owner_uid) || docState.value.owner_uid
      }
    }
  } catch { /* ignore */ }
}

const shouldShowCollaborationStatusBar = computed(() => (
  supportsCollaboration.value && (
    isCollaborationReadonlyScope.value
    || isCollaborationConnecting.value
    || Boolean(collaboration.error.value)
    || hasRemoteCollaborators.value
    || isSharedDoc.value
    || shareMembers.value.length > 0
    || collaboration.isConnected.value
  )
))
const collaborationStatus = computed(() => {
  if (docState.value.readonly_flag) {
    return {
      tone: 'neutral' as const,
      label: '只读文档',
      description: '当前文档不可编辑'
    }
  }

  if (collaboration.error.value) {
    return {
      tone: 'warning' as const,
      label: '协同异常',
      description: isOwnerHttpFallbackMode.value
        ? '已回退为直接编辑 OSS，可继续编辑；重连成功后会恢复共享编辑'
        : '实时连接异常，当前仅可查看，可点击重连继续尝试'
    }
  }

  if (collaboration.isConnecting.value) {
    if (isOwnerHttpFallbackMode.value) {
      return {
        tone: 'info' as const,
        label: '协同重连中',
        description: '当前仍可直接编辑 OSS，恢复后会自动切回共享编辑'
      }
    }

    if (isViewerReadonlyFallbackMode.value) {
      return {
        tone: 'info' as const,
        label: '协同重连中',
        description: '当前仅可查看，连接恢复后会自动切回共享编辑'
      }
    }

    return {
      tone: 'info' as const,
      label: '协同连接中',
      description: '正在建立实时连接'
    }
  }

  if (!collaboration.synced.value && isOwnerHttpFallbackMode.value) {
    return {
      tone: 'warning' as const,
      label: '协同恢复中',
      description: '当前仍可直接编辑 OSS，恢复后将把当前内容同步到协同服务器'
    }
  }

  if (!collaboration.synced.value && isViewerReadonlyFallbackMode.value) {
    return {
      tone: 'warning' as const,
      label: '协同恢复中',
      description: '当前仅可查看，连接恢复后可重新进入共享编辑'
    }
  }

  if (isWaitingForCollaborationSync.value || (isRealtimeCollaboration.value && !collaboration.synced.value)) {
    return {
      tone: 'warning' as const,
      label: '同步中',
      description: '等待协同内容完成同步'
    }
  }

  if (isRealtimeCollaboration.value) {
    return {
      tone: 'success' as const,
      label: '协同中',
      description: '实时修改会自动同步保存，编辑完毕直接关闭文档即可'
    }
  }

  return {
    tone: 'neutral' as const,
    label: '本地保存',
    description: '当前使用页面保存作为兜底'
  }
})
const hasShownCollaborationConnectedToast = ref(false)
const hasShownCollaborationErrorToast = ref(false)
const shouldPersistContentViaHttp = computed(() => !shouldLoadFromCollaboration.value || isOwnerHttpFallbackMode.value)
const shouldMirrorMarkdownToCollaboration = computed(() =>
  supportsCollaboration.value
  && collaboration.synced.value
  && !viewingVersion.value
  && !docState.value.readonly_flag
  && (viewMode.value === 'source' || isOwnerHttpFallbackMode.value)
)
let collaborationMirrorTimer: ReturnType<typeof setTimeout> | null = null

const clearCollaborationMirrorTimer = () => {
  if (!collaborationMirrorTimer) return
  clearTimeout(collaborationMirrorTimer)
  collaborationMirrorTimer = null
}

const flushCollaborationMarkdownMirror = (content = editorContent.value) => {
  clearCollaborationMirrorTimer()
  if (!shouldMirrorMarkdownToCollaboration.value) return
  collaboration.setTextContent(content)
}

const mirrorCollaborationMarkdown = (content: string) => {
  clearCollaborationMirrorTimer()
  if (!shouldMirrorMarkdownToCollaboration.value) return

  const nextContent = String(content || '')
  collaborationMirrorTimer = setTimeout(() => {
    collaborationMirrorTimer = null
    collaboration.setTextContent(nextContent)
  }, 800)
}

const loadPublishReviewRecord = async () => {
  publishReviewRecord.value = null

  if (!docState.value.oss_path) return

  try {
    if (docState.value.publish_info) {
      const response = await $fetch<ApiCodeResponse<PublishReviewRecord | null>>(`/api/reviews/by-document/${documentId.value}`)
      publishReviewRecord.value = response.data || null
      return
    }

    if (docState.value.readonly_flag) {
      const response = await $fetch<ApiCodeResponse<PublishReviewRecord | null>>('/api/reviews/by-oss-path', {
        params: { path: docState.value.oss_path }
      })
      publishReviewRecord.value = response.data || null
    }
  } catch (error) {
    console.warn('[Document] Failed to load publish review record:', error)
    publishReviewRecord.value = null
  }
}

// 防抖保存定时器
let saveTimer: ReturnType<typeof setTimeout> | null = null

// 加载文档
const fetchDocument = async (options?: { forceContent?: boolean }) => {
  loading.value = true
  try {
    const previewBootstrap = !options?.forceContent ? getDocumentPreviewBootstrap(documentId.value) : undefined
    const query = previewBootstrap ? { skip_content: '1' } : undefined
    const response = await $fetch<ApiSuccessResponse<DocumentResponseData>>(`/api/documents/${documentId.value}`, { query })

    if (response.success && response.data) {
      const bootstrapContent = previewBootstrap?.content || ''
      const responseContent = response.data.content || ''
      const baseContent = bootstrapContent || responseContent
      const resolvedContent = shouldLoadFromCollaboration.value && collaboration.synced.value && !options?.forceContent
        ? (collaboration.getTextContent() || baseContent)
        : baseContent

      docState.value = {
        id: response.data.id,
        title: response.data.title || '未命名文档',
        content: resolvedContent,
        doc_type: response.data.doc_type || 'private',
        owner_uid: response.data.owner_uid || '',
        project_code: response.data.project_code || '',
        updated_at: response.data.updated_at || '',
        readonly_flag: response.data.readonly_flag || 0,
        hasConflict: response.data.hasConflict || false,
        conflictInfo: response.data.conflictInfo || null,
        oss_path: response.data.oss_path || '',
        publish_info: response.data.publish_info || '',
        ai_abstract: response.data.ai_abstract || previewBootstrap?.aiAbstract || ''
      }
      if (!supportsCollaboration.value && (collaboration.isConnected.value || collaboration.isConnecting.value)) {
        collaboration.disconnect()
      }
      await loadPublishReviewRecord()
      // 需要协同的文档：先不设置编辑器内容，等协同同步完成后再填充，避免抖动
      // 仅将 OSS 内容存入 docState.content 作为协同失败时的兜底
      // forceContent 为 true 时（如协同失败回退）必须立即填充
      if (!options?.forceContent && shouldLoadFromCollaboration.value && !collaboration.synced.value) {
        // 不设置 editorContent，编辑器会等待协同同步
      } else {
        editorContent.value = resolvedContent
      }
      if (previewBootstrap) {
        consumeDocumentPreviewBootstrap(documentId.value)
      }

      // 如果是项目文档，获取项目信息
      if (docState.value.doc_type === 'project' && docState.value.project_code) {
        try {
          const config = useRuntimeConfig()
          const projectResponse = await $fetch<ApiSuccessResponse<ProjectAccountData>>(
            `/api/account/projects/${docState.value.project_code}`
          )
          if (projectResponse.success && projectResponse.data?.repoUrl) {
            projectMetadata.value.repoUrl = projectResponse.data.repoUrl
            // 从 oss_path 提取文档相对路径
            if (docState.value.oss_path && !docState.value.oss_path.startsWith('codocs/projects/')) {
              const gitlabBaseUrl = (config.public.gitlabBaseUrl || 'https://gitlab.wiztek.cn').replace(/\/$/, '')
              const repoPath = projectResponse.data.repoUrl
                .replace(gitlabBaseUrl, '')
                .replace(/^\/+/, '')
                .replace(/\.git$/, '')
              const prefix = `${repoPath}/`
              if (docState.value.oss_path.startsWith(prefix)) {
                projectMetadata.value.docPath = docState.value.oss_path.substring(prefix.length)
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch project metadata:', error)
        }
      }

      // 如果有未处理的冲突，显示警告
      if (docState.value.hasConflict) {
        toast.add({
          title: '发现同步冲突',
          description: '此文档在 GitLab 有更新，请先前往项目文档页面解决冲突',
          color: 'warning',
          duration: 10000
        })
      }

      // 只读文档使用编辑模式（readonly 属性控制只读状态）

      // 初始化保存状态
      savedState.value = {
        title: docState.value.title,
        content: resolvedContent
      }

      // 初始化最后保存时间
      if (docState.value.updated_at) {
        lastSaved.value = new Date(docState.value.updated_at)
      }

      // Fallback: mark shared doc as read when opened from any entry.
      if (authUserId.value && authUserId.value !== docState.value.owner_uid) {
        try {
          await $fetch(`/api/documents/${documentId.value}/read`, {
            method: 'POST',
            body: { uid: authUserId.value }
          })
        } catch (error) {
          console.error('Failed to mark document as read on open:', error)
        }
      }
    }
  } catch (error: unknown) {
    clearDocumentPreviewBootstrap(documentId.value)
    console.error('Failed to fetch document:', error)
    toast.add({
      title: '加载失败',
      description: getErrorMessage(error, '无法加载文档，请稍后重试'),
      color: 'error'
    })
  } finally {
    loading.value = false
    // 注意：这里不设为 ready，等待编辑器 Ready 事件
  }
}

// 保存文档
const saveDocument = async (options?: {
  contentOverride?: string
  saveMode?: 'metadata' | 'overwrite' | 'recovery' | 'import'
  forceContent?: boolean
}) => {
  // 如果页面还没准备好（加载中或编辑器初始化中），不保存
  if (!isPageReady.value || saving.value) return
  if (isEditingLockedByCollaborationFallback.value) return

  const contentToSave = options?.contentOverride ?? editorContent.value
  const shouldSaveContent = options?.forceContent || shouldPersistContentViaHttp.value

  // 安全检查：防止意外清空文档
  // 如果当前编辑器内容为空，但之前保存的内容不为空，则拒绝保存并警告
  if (shouldSaveContent && !contentToSave && savedState.value.content) {
    console.warn('检测到可能的初始化异常：试图将非空文档保存为空。已拦截。')
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/documents/${documentId.value}`, {
      method: 'PUT',
      body: {
        title: docState.value.title,
        ...(shouldSaveContent ? { content: contentToSave, saveMode: options?.saveMode || 'overwrite' } : {})
      }
    })

    lastSaved.value = new Date()

    // 更新保存状态
    savedState.value = {
      title: docState.value.title,
      content: contentToSave
    }
  } catch (error: unknown) {
    console.error('Failed to save document:', error)
    toast.add({
      title: '保存失败',
      description: getErrorMessage(error, '无法保存文档，请稍后重试'),
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

const flushDocumentOnExit = () => {
  if (!import.meta.client || !documentId.value || !isPageReady.value) return
  if (viewingVersion.value || docState.value.readonly_flag || isEditingLockedByCollaborationFallback.value) return
  if (isNewWorklog.value && !userEdited.value) return

  const titleToSave = docState.value.title
  const contentToSave = editorContent.value
  const shouldSaveTitle = hasPendingTitleChange.value
  const shouldSaveContent = hasPendingContentFlush.value

  flushCollaborationMarkdownMirror(contentToSave)

  if (!shouldSaveTitle && !shouldSaveContent) return

  if (shouldSaveContent && !contentToSave && savedState.value.content) {
    console.warn('检测到离页 flush 试图将非空文档保存为空，已拦截。')
    return
  }

  const payload = {
    title: titleToSave,
    ...(shouldSaveContent ? { content: contentToSave, saveMode: 'overwrite' as const } : {})
  }
  const body = JSON.stringify(payload)
  const url = `/api/documents/${documentId.value}`

  try {
    let sent = false

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      sent = navigator.sendBeacon(url, blob)
    }

    if (!sent) {
      void fetch(url, {
        method: 'PUT',
        body,
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        keepalive: true
      })
    }

    savedState.value = {
      title: titleToSave,
      content: shouldSaveContent ? contentToSave : savedState.value.content
    }
  } catch (error) {
    console.error('Failed to flush document on exit:', error)
  }
}

const handlePageHide = () => {
  flushDocumentOnExit()
}

const handleBeforeUnload = (e: BeforeUnloadEvent) => {
  if (needsUnsavedGuard.value) {
    e.preventDefault()
  }
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    flushDocumentOnExit()
  }
}

// 内容变化处理（防抖 5 秒自动保存）
const handleContentChange = (content: string) => {
  if (isEditingLockedByCollaborationFallback.value) {
    return
  }

  editorContent.value = content
  mirrorCollaborationMarkdown(content)

  // 标记用户已编辑（用于新建工作日志的空白删除逻辑）
  if (isNewWorklog.value && !userEdited.value && isPageReady.value) {
    // 只有内容真正与初始模板不同时才标记
    if (content !== savedState.value.content) {
      userEdited.value = true
    }
  }

  // 如果是只读文档，不仅不自动保存，理论上也不应该触发这里（除非代码更改）
  // 但为了安全起见，直接返回，不启动定时器
  if (docState.value.readonly_flag) {
    return
  }

  // 源码模式下强制启用 HTTP 保存（协同可能未连接）
  const shouldSaveViaHttp = shouldPersistContentViaHttp.value || viewMode.value === 'source'

  if (!shouldSaveViaHttp) {
    return
  }

  // 清除之前的定时器
  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  // 30 秒后自动保存
  saveTimer = setTimeout(() => {
    // 只有真正有变更时才保存
    if (editorContent.value !== savedState.value.content || hasPendingTitleChange.value) {
      saveDocument({ forceContent: viewMode.value === 'source' })
    }
  }, 30000)
}

// 标题编辑
const handleTitleChange = (event: Event) => {
  if (isEditingLockedByCollaborationFallback.value) {
    return
  }

  const target = event.target as HTMLInputElement
  docState.value.title = target.value
  // hasUnsavedChanges is now computed
}

// 格式化时间
const formatSaveTime = (date: Date | null) => {
  if (!date) return ''
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

// 获取版本历史
const fetchVersionHistory = async () => {
  versionsLoading.value = true
  try {
    const response = await $fetch<ApiSuccessResponse<VersionSummary[]>>(`/api/documents/${documentId.value}/versions`)
    if (response.success) {
      versions.value = response.data
    }
  } catch (error: unknown) {
    console.error('Failed to fetch version history:', error)
    toast.add({ title: '获取版本历史失败', color: 'error' })
  } finally {
    versionsLoading.value = false
  }
}

// 切换版本历史显示
const toggleVersionHistory = async () => {
  showVersionHistory.value = !showVersionHistory.value
  if (showVersionHistory.value && versions.value.length === 0) {
    await fetchVersionHistory()
  }
}

// 查看历史版本
const viewingVersion = ref<VersionDetail | null>(null)
const originalContent = ref('')

const handleViewVersion = async (versionId: number) => {
  if (isEditingDisabled.value) {
    toast.add({
      title: '当前文档为只读',
      description: '只读状态下不可查看历史版本内容',
      color: 'warning'
    })
    return
  }

  try {
    const response = await $fetch<ApiSuccessResponse<VersionDetail>>(`/api/documents/${documentId.value}/versions/${versionId}`)
    if (response.success && response.data) {
      // 首次进入版本预览时保存当前内容
      if (!viewingVersion.value) {
        originalContent.value = editorContent.value
      }
      viewingVersion.value = response.data
      editorContent.value = response.data.content
      milkdownEditorRef.value?.setMarkdown(response.data.content)
    }
  } catch (error: unknown) {
    console.error('Failed to view version:', error)
    toast.add({ title: '获取版本内容失败', color: 'error' })
  }
}

const exitVersionPreview = () => {
  if (!viewingVersion.value) return
  editorContent.value = originalContent.value
  milkdownEditorRef.value?.setMarkdown(originalContent.value)
  viewingVersion.value = null
  originalContent.value = ''
}

// 差异对比弹窗
const showDiffModal = ref(false)
const diffVersionData = ref<DiffVersionData | null>(null)

const handleDiffVersion = async (versionId: number) => {
  if (isEditingDisabled.value) {
    toast.add({
      title: '当前文档为只读',
      description: '只读状态下不可查看历史版本差异',
      color: 'warning'
    })
    return
  }

  try {
    const response = await $fetch<ApiSuccessResponse<VersionDetail>>(`/api/documents/${documentId.value}/versions/${versionId}`)
    if (response.success && response.data) {
      diffVersionData.value = { ...response.data }
      showDiffModal.value = true
    }
  } catch (error: unknown) {
    console.error('Failed to fetch version for diff:', error)
    toast.add({ title: '获取版本内容失败', color: 'error' })
  }
}

const handleRestoreFromDiff = async () => {
  if (isEditingDisabled.value) {
    toast.add({
      title: '当前文档为只读',
      description: '只读状态下不可恢复历史版本',
      color: 'warning'
    })
    return
  }

  if (!diffVersionData.value) return
  const versionId = diffVersionData.value.id
  const content = diffVersionData.value.content
  editorContent.value = content
  milkdownEditorRef.value?.setMarkdown(content)
  // 如果在版本预览中，退出预览
  viewingVersion.value = null
  originalContent.value = ''
  showDiffModal.value = false
  mirrorCollaborationMarkdown(content)

  if (!isRealtimeCollaboration.value) {
    await saveDocument({
      contentOverride: content,
      saveMode: 'recovery'
    })
  }

  // 删除已恢复的历史版本
  try {
    await $fetch(`/api/documents/${documentId.value}/versions/${versionId}`, {
      method: 'DELETE'
    })
  } catch (error) {
    console.error('Failed to delete version:', error)
  }

  // 刷新版本列表
  await fetchVersionHistory()
  toast.add({ title: '已恢复到该版本', color: 'success' })
}

// ============ 共享功能 ============

// 添加共享
const handleShare = async (data: { uid: string, permission: 'read' | 'write' }) => {
  if (!canManageShares.value) {
    toast.add({
      title: '无权限管理共享',
      description: '仅文档创建者可以新增或调整共享设置',
      color: 'warning'
    })
    return
  }

  try {
    const response = await $fetch<ApiCodeResponse<{ notifiedOnly?: boolean }>>(`/api/documents/${documentId.value}/shares`, {
      method: 'POST',
      body: data
    })

    if (response.code === 0) {
      if (response.data?.notifiedOnly) {
        toast.add({
          title: '已发送协同提醒',
          description: `${data.uid} 属于本部门，未新增共享记录`,
          color: 'info'
        })
      } else {
        toast.add({
          title: '共享成功',
          description: `已将文档共享给 ${data.uid}`,
          color: 'success'
        })
      }
    } else {
      throw new Error(response.message)
    }
  } catch (error: unknown) {
    console.error('Share failed:', error)
    toast.add({
      title: '共享失败',
      description: getErrorMessage(error, '请稍后重试'),
      color: 'error'
    })
  }
}

// 移除共享
const handleRemoveShare = async (shareId: number) => {
  if (!canManageShares.value) {
    toast.add({
      title: '无权限管理共享',
      description: '仅文档创建者可以新增或调整共享设置',
      color: 'warning'
    })
    return
  }

  try {
    const response = await $fetch<ApiCodeResponse>(`/api/documents/${documentId.value}/shares/${shareId}`, {
      method: 'DELETE'
    })

    if (response.code === 0) {
      toast.add({
        title: '已移除共享',
        color: 'success'
      })
    } else {
      throw new Error(response.message)
    }
  } catch (error: unknown) {
    console.error('Remove share failed:', error)
    toast.add({
      title: '移除失败',
      description: getErrorMessage(error, '请稍后重试'),
      color: 'error'
    })
  }
}

// 更新共享权限
const handleUpdatePermission = async (data: { shareId: number, permission: 'read' | 'write' }) => {
  if (!canManageShares.value) {
    toast.add({
      title: '无权限管理共享',
      description: '仅文档创建者可以新增或调整共享设置',
      color: 'warning'
    })
    return
  }

  try {
    const response = await $fetch<ApiCodeResponse>(`/api/documents/${documentId.value}/shares/${data.shareId}`, {
      method: 'PATCH',
      body: { permission: data.permission }
    })

    if (response.code === 0) {
      toast.add({
        title: '权限已更新',
        color: 'success'
      })
    } else {
      throw new Error(response.message)
    }
  } catch (error: unknown) {
    console.error('Update permission failed:', error)
    toast.add({
      title: '更新失败',
      description: getErrorMessage(error, '请稍后重试'),
      color: 'error'
    })
  }
}

// 格式化版本时间
const formatVersionTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins}分钟前`
  if (diffHours < 24) return `${diffHours}小时前`
  if (diffDays < 7) return `${diffDays}天前`

  return date.toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 编辑器就绪
const handleEditorReady = () => {
  if (isLeavingDocumentPage.value) return
  console.log('Editor ready, setting page to ready state')
  isPageReady.value = true
}

// 监听视图模式切换，同步编辑器内容
// 监听视图模式切换，同步编辑器内容
// watch(viewMode, (newMode, oldMode) => {
//     内部组件现在处理同步
// })

// 键盘按键处理
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (isEditingLockedByCollaborationFallback.value) return
    // 源码模式下强制保存内容（协同可能未连接）
    if (viewMode.value === 'source') {
      saveDocument({ forceContent: true })
    } else {
      saveDocument()
    }
  }
}

const handleManualSave = () => {
  if (viewMode.value === 'source') {
    saveDocument({ forceContent: true })
  } else {
    saveDocument()
  }
}

// 初始化
onMounted(async () => {
  isLeavingDocumentPage.value = false
  await fetchDocument()
  await fetchShareMembers()
  fetchAnnotations()
  // 私人且未共享的文档不启动协同，直接走 HTTP 保存
  if (supportsCollaboration.value && authUserId.value && !isPrivateUnsharedDoc.value) {
    collaboration.connect()
  }
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

watch(authUserId, (uid) => {
  if (isLeavingDocumentPage.value) return
  if (!supportsCollaboration.value) return
  // 私人且未共享的文档不启动协同（与 onMounted 保持一致）
  if (isPrivateUnsharedDoc.value) return
  if (uid && !collaboration.isConnected.value && !collaboration.isConnecting.value) {
    collaboration.connect()
  }
})

// 分享状态变化时：未共享→已共享 要补连协同；已共享→未共享 要断开
watch(isPrivateUnsharedDoc, (isPrivateUnshared) => {
  if (isLeavingDocumentPage.value) return
  if (!supportsCollaboration.value) return
  if (!authUserId.value) return
  if (isPrivateUnshared) {
    if (collaboration.isConnected.value || collaboration.isConnecting.value) {
      collaboration.disconnect()
    }
  } else {
    if (!collaboration.isConnected.value && !collaboration.isConnecting.value) {
      collaboration.connect()
    }
  }
})

watch(
  () => docState.value.readonly_flag,
  (readonlyFlag) => {
    if (readonlyFlag) {
      showSharePanel.value = false
    }
  }
)

watch(
  () => collaboration.synced.value,
  (synced) => {
    if (isLeavingDocumentPage.value) return
    if (!supportsCollaboration.value) return
    if (!synced || viewingVersion.value) return

    if (isOwnerHttpFallbackMode.value) {
      const localContent = editorContent.value
      collaboration.setTextContent(localContent)
      docState.value.content = localContent
      collaborationFallbackMode.value = 'none'
      collaborationFallbackLoaded.value = false
      return
    }

    collaborationFallbackMode.value = 'none'
    collaborationFallbackLoaded.value = false
    const syncedContent = collaboration.getTextContent()
    if (!syncedContent && savedState.value.content) {
      // 新的协同房间可能还没有 Y.Doc 内容；先把 HTTP/OSS 正文交给编辑器，
      // 由 Milkdown 的协同 bootstrap 写入 ProseMirror fragment。
      editorContent.value = savedState.value.content
      docState.value.content = savedState.value.content
      return
    }
    editorContent.value = syncedContent
    docState.value.content = syncedContent
    savedState.value = {
      ...savedState.value,
      content: syncedContent
    }
  }
)

watch(
  () => shouldMirrorMarkdownToCollaboration.value,
  (enabled) => {
    if (!enabled) {
      clearCollaborationMirrorTimer()
      return
    }

    mirrorCollaborationMarkdown(editorContent.value)
  }
)

watch(
  () => collaboration.isConnected.value,
  (connected, wasConnected) => {
    if (isLeavingDocumentPage.value) return
    if (!supportsCollaboration.value) return
    if (connected && hasRemoteCollaborators.value && !hasShownCollaborationConnectedToast.value) {
      hasShownCollaborationConnectedToast.value = true
      toast.add({
        title: '实时协同已连接',
        description: '后续内容将通过协同通道自动持久化',
        color: 'success'
      })
    }

    if (!connected && wasConnected && hasShownCollaborationConnectedToast.value) {
      toast.add({
        title: '协同连接已断开',
        description: '系统会自动重连，当前可继续本地编辑',
        color: 'warning'
      })
    }
  }
)

watch(
  () => collaboration.error.value?.message || '',
  async (message) => {
    if (isLeavingDocumentPage.value) return
    if (!supportsCollaboration.value) return
    if (!message) {
      hasShownCollaborationErrorToast.value = false
      return
    }

    if (!hasShownCollaborationErrorToast.value) {
      hasShownCollaborationErrorToast.value = true
      toast.add({
        title: '协同不可用',
        description: message,
        color: 'warning'
      })
    }

    if (!collaboration.synced.value && !collaborationFallbackLoaded.value) {
      collaborationFallbackMode.value = isDocumentOwner.value ? 'owner-edit' : 'viewer-readonly'
      collaborationFallbackLoaded.value = true
      await fetchDocument({ forceContent: true })
    }
  }
)

// 清理
onUnmounted(() => {
  isLeavingDocumentPage.value = true
  collaboration.disconnect()
  clearCollaborationMirrorTimer()
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('pagehide', handlePageHide)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

// 导出 Markdown
const handleExportMarkdown = () => {
  const blob = new Blob([editorContent.value], { type: 'text/markdown;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  link.setAttribute('href', url)
  const filename = docState.value.title.endsWith('.md') ? docState.value.title : `${docState.value.title}.md`
  console.log('Exporting Markdown:', filename)
  link.setAttribute('download', filename)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()

  setTimeout(() => {
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }, 100)
}

// 导出 PDF（直接从当前模式打印，编辑模式即所见即所得）
const handleExportPdf = () => {
  window.print()
}

// 设置页面元数据
useHead({
  title: () => docState.value.title
})

// 离开页面前确认
onBeforeUnmount(async () => {
  isLeavingDocumentPage.value = true
  // 不在此处调用 collaboration.disconnect()
  // 因为父组件的 onBeforeUnmount 在子组件之前执行，
  // 此时 MilkdownEditor 的 collab 插件仍活跃，
  // 过早销毁 provider 会导致 collab 插件 dispatch 时找不到 editorState 上下文
  // 实际断开在 onUnmounted 中进行（子组件先销毁编辑器，父组件再断开连接）

  // 新建的工作日志，如果用户未做任何编辑，则删除
  if (isNewWorklog.value && !userEdited.value) {
    const deletedDate = getWorklogDate(docState.value.title)
    try {
      if (import.meta.client) {
        sessionStorage.setItem('worklog_deleted', JSON.stringify({
          uuid: documentId.value,
          date: deletedDate
        }))
      }
      await $fetch(`/api/documents/${documentId.value}`, { method: 'DELETE' })
      console.log('已自动删除未编辑的空白工作日志')
    } catch (e) {
      if (import.meta.client) {
        sessionStorage.removeItem('worklog_deleted')
      }
      console.error('删除空白工作日志失败:', e)
    }
    return
  }
  // 只有在页面已经 ready 的情况下才在离开前尝试保存
  if (isPageReady.value && (hasUnsavedChanges.value || hasPendingContentFlush.value || hasPendingTitleChange.value)) {
    flushDocumentOnExit()
  }
})
</script>

<template>
  <UDashboardPanel grow>
    <!-- 顶部工具栏 -->
    <div class="flex items-center gap-1.5 px-4 py-2 border-b border-default bg-default">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div class="flex-1 min-w-0 flex flex-col gap-1">
          <input
            :value="docState.title"
            type="text"
            class="flex-1 min-w-0 text-base sm:text-lg font-semibold bg-transparent border-none outline-none text-highlighted placeholder:text-muted focus:ring-0 px-0 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="输入文档标题..."
            :disabled="isEditingDisabled"
            @input="handleTitleChange"
          >
          <div
            v-if="docState.publish_info || publishReviewRecord"
            class="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400"
          >
            <UIcon name="i-lucide-archive" class="w-3 h-3" />
            <span>{{ getPublishedInfoText(docState.publish_info, publishReviewRecord) }}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1.5">
        <!-- 保存状态 -->
        <div class="hidden lg:flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mr-1">
          <template v-if="docState.readonly_flag || isEditingLockedByCollaborationFallback">
            <UIcon name="i-lucide-lock" class="w-4 h-4 text-gray-500" />
            <span class="hidden xl:inline">只读</span>
          </template>
          <template v-else-if="isRealtimeCollaboration">
            <UIcon name="i-lucide-cloud" class="w-4 h-4 text-green-500" />
            <span class="hidden xl:inline">自动同步保存</span>
          </template>
          <template v-else-if="saving">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
            <span class="hidden xl:inline">保存中...</span>
          </template>
          <template v-else-if="hasUnsavedChanges">
            <UIcon name="i-lucide-circle" class="w-2 h-2 text-yellow-500" />
            <span class="hidden xl:inline">未保存</span>
          </template>
          <template v-else>
            <UIcon name="i-lucide-check" class="w-4 h-4 text-green-500" />
            <span class="hidden xl:inline">已保存 {{ formatSaveTime(lastSaved) }}</span>
          </template>
        </div>

        <!-- 视图切换 -->
        <div class="hidden sm:flex items-center bg-elevated rounded-lg p-0.5 mr-1 gap-0.5">
          <UButton
            size="xs"
            :variant="viewMode === 'edit' ? 'solid' : 'ghost'"
            color="neutral"
            class="rounded-md"
            @click="viewMode = 'edit'"
          >
            <UIcon :name="isEditingDisabled ? 'i-lucide-eye' : 'i-lucide-pencil'" class="w-4 h-4" />{{ isEditingDisabled ? '查看' : '图文' }}
          </UButton>
          <UButton
            size="xs"
            :variant="viewMode === 'source' ? 'solid' : 'ghost'"
            color="neutral"
            class="rounded-md"
            :disabled="isEditingDisabled"
            @click="viewMode = 'source'"
          >
            <UIcon name="i-lucide-code" class="w-4 h-4" />源码
          </UButton>
        </div>

        <!-- AI 助手入口 -->
        <UButton
          v-if="!isEditingDisabled"
          icon="i-lucide-sparkles"
          variant="ghost"
          size="xs"
          title="AI 助手"
          @click="milkdownEditorRef?.switchToTab('ai')"
        />

        <UButton
          v-if="publishReviewRecord"
          icon="i-lucide-list-checks"
          variant="ghost"
          size="xs"
          title="发布审批与执行过程"
          @click="showPublishRecord = true"
        >
          <span class="hidden xl:inline">发布流程</span>
        </UButton>

        <!-- 操作按钮（协同模式下内容自动同步，无需手动保存；源码模式始终显示） -->
        <UButton
          v-if="!isEditingDisabled && (!isRealtimeCollaboration || viewMode === 'source')"
          icon="i-lucide-save"
          :loading="saving"
          :disabled="editorContent === savedState.content"
          size="xs"
          @click="handleManualSave"
        >
          <span class="hidden xl:inline">保存</span>
        </UButton>

        <UDropdownMenu
          :items="[
            { label: '下载', icon: 'i-lucide-download', onSelect: handleExportMarkdown },
            { label: '导出 PDF', icon: 'i-lucide-printer', onSelect: handleExportPdf },
            ...(canManageShares ? [{ label: '共享', icon: 'i-lucide-share-2', onSelect: () => { showSharePanel = !showSharePanel } }] : []),
            { label: '历史版本', icon: 'i-lucide-history', onSelect: toggleVersionHistory }
          ]"
        >
          <UButton icon="i-lucide-more-vertical" variant="ghost" class="pr-0" />
          <UButton
            icon="i-lucide-x"
            variant="ghost"
            class="pl-0"
            @click="goBack"
          />
        </UDropdownMenu>
      </div>
    </div>

    <div
      v-if="!loading && !viewingVersion && shouldShowCollaborationStatusBar"
      class="border-b border-default/60 bg-default/70 px-4 py-2 backdrop-blur"
    >
      <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
        <!-- 左侧：协同状态 -->
        <div class="flex items-center gap-2">
          <UBadge :color="collaborationStatus.tone" variant="soft">
            {{ collaborationStatus.label }}
          </UBadge>
          <span class="text-muted">{{ collaborationStatus.description }}</span>
          <span
            v-if="isCollaborationReadonlyScope"
            class="text-warning-600 dark:text-warning-400"
          >
            当前账号仅可查看
          </span>
          <UButton
            v-if="!isRealtimeCollaboration && !isCollaborationConnecting && !docState.readonly_flag"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="collaboration.connect()"
          >
            重连协同
          </UButton>
        </div>

        <!-- 右侧：共享信息 + 在线成员 -->
        <div class="flex items-center gap-3">
          <span v-if="documentSourceDisplayName" class="text-xs text-muted">
            由 <strong class="text-default">{{ documentSourceDisplayName }}</strong> 创建/共享
          </span>
          <span v-if="!isSharedDoc && shareMembers.length > 0" class="text-xs text-muted">
            已共享给 {{ shareMembers.length }} 人
          </span>
          <template v-if="onlineCollaborationMembers.length > 0">
            <span v-if="documentSourceDisplayName || shareMembers.length > 0" class="text-gray-300 dark:text-gray-600">|</span>
            <div class="flex items-center gap-3">
              <span class="text-xs text-muted whitespace-nowrap">在线成员</span>
              <div
                v-for="member in onlineCollaborationMembers"
                :key="member.uid"
                class="flex items-center gap-1.5"
                :title="`${member.uid === authUserId ? '我' : member.name} · 在线`"
              >
                <span class="inline-block h-2 w-2 rounded-full shrink-0 bg-green-500" />
                <span
                  class="text-xs whitespace-nowrap"
                  :class="member.uid === authUserId ? 'text-primary font-medium' : 'text-default'"
                >
                  {{ member.uid === authUserId ? '我' : member.name }}
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 版本预览提示栏 -->
    <div
      v-if="viewingVersion"
      class="flex items-center justify-between px-4 py-2 bg-warning-50 dark:bg-warning-900/20 border-b border-warning-200 dark:border-warning-800 shrink-0"
    >
      <div class="flex items-center gap-2 text-sm text-warning-700 dark:text-warning-300">
        <UIcon name="i-lucide-history" class="w-4 h-4" />
        <span>正在查看历史版本 <strong>v{{ viewingVersion.versionNum }}</strong></span>
        <span class="text-warning-500">·</span>
        <span>{{ viewingVersion.editorUid }}</span>
        <span class="text-warning-500">·</span>
        <span>{{ formatVersionTime(viewingVersion.createdAt) }}</span>
      </div>
      <UButton
        icon="i-lucide-x"
        size="xs"
        color="warning"
        variant="soft"
        @click="exitVersionPreview"
      >
        退出预览
      </UButton>
    </div>

    <!-- 源码模式提示栏 -->
    <div
      v-if="viewMode === 'source' && isRealtimeCollaboration"
      class="flex items-center justify-between px-4 py-2 bg-warning-50 dark:bg-warning-900/20 border-b border-warning-200 dark:border-warning-800 shrink-0"
    >
      <div class="flex items-center gap-2 text-sm text-warning-700 dark:text-warning-300">
        <UIcon name="i-lucide-triangle-alert" class="w-4 h-4" />
        <span>源码模式下保存会直接覆盖文档内容，可能影响其他正在协同编辑的用户</span>
      </div>
      <UButton
        size="xs"
        color="warning"
        variant="soft"
        @click="viewMode = 'edit'"
      >
        返回编辑模式
      </UButton>
    </div>

    <!-- 编辑器主体 -->
    <main class="flex min-h-0 w-full flex-1 overflow-hidden bg-gray-50 dark:bg-gray-950">
      <!-- 加载中 -->
      <div v-if="loading" class="flex min-h-0 flex-1 items-center justify-center">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <!-- 编辑器区域 -->
      <div v-else class="flex min-h-0 w-full flex-1 overflow-hidden px-0 sm:px-4">
        <div v-show="true" class="min-h-0 flex-1 w-full sm:w-a4 sm:max-w-full overflow-auto pt-4 pb-4">
          <EditorMilkdownEditor
            :key="editorInstanceKey"
            ref="milkdownEditorRef"
            v-model="editorContent"
            :readonly="isEditingDisabled"
            :watermark-text="shouldShowReadonlyWatermark ? watermarkText : ''"
            :theme="editorTheme"
            :view-mode="viewMode"
            :document-id="documentId"
            :versions="versions"
            :versions-loading="versionsLoading"
            :show-version-history="showVersionHistory"
            :show-share-panel="showSharePanel"
            :doc-type="docState.doc_type"
            :project-repo-url="projectMetadata.repoUrl"
            :doc-path="projectMetadata.docPath"
            :annotations="annotations"
            :current-user-id="authUserId || undefined"
            :allow-share="canViewShares"
            :can-manage-shares="canManageShares"
            :active-version-num="viewingVersion?.versionNum ?? null"
            :ai-abstract="docState.ai_abstract"
            :collaboration-doc="collaboration.getYDoc()"
            :collaboration-awareness="collaboration.getAwareness() || null"
            :collaboration-enabled="collaborationEditorEnabled"
            container-height="100%"
            @change="handleContentChange"
            @ready="handleEditorReady"
            @close-sidebar="showVersionHistory = false; showSharePanel = false"
            @load-versions="fetchVersionHistory"
            @view-version="handleViewVersion"
            @diff-version="handleDiffVersion"
            @share="handleShare"
            @remove-share="handleRemoveShare"
            @update-permission="handleUpdatePermission"
            @create-annotation="handleCreateAnnotation"
            @reply-annotation="handleReplyAnnotation"
            @resolve-annotation="handleResolveAnnotation"
            @delete-annotation="handleDeleteAnnotation"
            @delete-reply="handleDeleteReply"
            @click-annotation="handleClickAnnotation"
            @update-abstract="(text: string) => { docState.ai_abstract = text }"
          />
        </div>
      </div>
    </main>

    <!-- 版本差异对比弹窗 -->
    <DocumentVersionDiffModal
      v-if="diffVersionData"
      :open="showDiffModal"
      :version-num="diffVersionData.versionNum"
      :editor-uid="diffVersionData.editorUid"
      :created-at="diffVersionData.createdAt"
      :history-content="diffVersionData.content"
      :current-content="originalContent || savedState.content"
      @update:open="showDiffModal = $event"
      @restore="handleRestoreFromDiff"
    />
    <ReviewPublishRecordModal
      v-model:open="showPublishRecord"
      :oss-path="docState.oss_path"
      :document-uuid="documentId"
    />
    <!-- 未保存变更提示 -->
    <UModal v-model:open="unsavedGuardOpen" :ui="{ content: 'sm:w-lg h-auto' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center gap-2 pt-4">
              <UIcon name="i-lucide-alert-triangle" class="w-5 h-5 text-warning" />
              <h3 class="text-base font-semibold">
                文档尚未保存
              </h3>
            </div>
          </template>
          <p class="text-sm text-muted py-8">
            当前文档有未保存的修改，离开后修改将会丢失。
          </p>
          <template #footer>
            <div class="flex justify-end gap-2 py-2">
              <UButton
                label="放弃修改"
                color="error"
                variant="ghost"
                @click="handleUnsavedGuardAction('discard')"
              />
              <UButton
                label="继续编辑"
                color="neutral"
                variant="soft"
                @click="handleUnsavedGuardAction('cancel')"
              />
              <UButton
                label="保存并离开"
                color="primary"
                :loading="saving"
                @click="handleUnsavedGuardAction('save')"
              />
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </UDashboardPanel>
</template>

<style>
@media print {

  /* Hide all non-content UI: sidebar, toolbar, buttons, handles */
  header,
  nav,
  aside,
  .ud-dashboard-navbar,
  .ud-dashboard-sidebar,
  .ud-sidebar,
  [id^="dashboard-sidebar-"],
  .sidebar-preview-shell,
  button,
  .ud-icon,
  .hidden.md\:flex,
  input[type="text"],
  .rounded-full,
  .milkdown-block-handle,
  hr,
  .border-b,
  .border-t {
    display: none !important;
  }

  /* Reset layout constraints */
  body,
  html,
  main,
  .ud-dashboard-panel,
  .ud-dashboard-layout,
  #__nuxt {
    display: block !important;
    width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    position: static !important;
  }

  /* Main container adjustments */
  main {
    padding-top: 0 !important;
  }

  /* Target specific editor content */
  .w-a4 {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
  }

  /* Ensure all content containers are visible and auto-height */
  .crepe-container,
  .crepe-wrapper,
  .crepe-editor,
  .crepe-editor .milkdown,
  .crepe-editor .PbronzeMirror,
  .crepe-editor .ProseMirror,
  .crepe-editor .editor {
    display: block !important;
    width: 100% !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }

  /* Reset editor padding for print: remove the large 120px "paper" padding */
  .crepe-editor .ProseMirror,
  .crepe-editor .editor {
    padding: 0 !important;
    margin: 0 !important;
  }

  /* Ensure all paragraphs, headings, lists are visible */
  .crepe-editor p,
  .crepe-editor h1,
  .crepe-editor h2,
  .crepe-editor h3,
  .crepe-editor h4,
  .crepe-editor h5,
  .crepe-editor h6,
  .crepe-editor blockquote,
  .crepe-editor pre,
  .crepe-editor code,
  .crepe-editor table {
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* Lists: preserve Milkdown's flex layout for correct indentation */
  .crepe-editor ul,
  .crepe-editor ol {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  .crepe-editor li,
  .crepe-editor .milkdown-list-item-block {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  .crepe-editor .milkdown-list-item-block > .list-item {
    display: flex !important;
    align-items: flex-start !important;
  }

  .crepe-editor .milkdown-list-item-block > .list-item > .children {
    min-width: 0 !important;
    flex: 1 !important;
  }

  /* Adjust page margins */
  @page {
    margin: 20mm;
    size: A4;
  }

  /* Remove browser default header/footer */
  @page {
    margin-top: 10mm;
    margin-bottom: 10mm;
  }

  /* Hide page title in header */
  body::before {
    content: none !important;
  }

  /* Better page breaks */
  h1,
  h2,
  h3 {
    page-break-after: avoid;
  }

  pre,
  blockquote,
  table {
    page-break-inside: avoid;
  }
}
</style>
