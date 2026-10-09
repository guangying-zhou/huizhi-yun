<script setup lang="ts">
import { projectPageFailure } from '../../app/utils/projectPageFailure'
import { useAccountUsers } from '@hzy/foundation/app/composables/useAccount'
import { useAimsModule } from '../useAimsModule'

// 项目集详情（Host 原生页，文档资产设计 DOC-05 5c-1）：成员、文档仓库登记、项目集文档。
// 所有权限与关系都由服务端判定；这里的 canManage / canLink / canManagePolicy 只决定是否显示入口。

type Relation = 'manager' | 'contributor' | 'viewer'
type Member = { uid: string, relationType: Relation, status: string, validFrom: string, validUntil: string | null, revision: number, effective: boolean }
type DocRepo = { integrationCode: string, repoPath: string, rowVersion: number } | null
type MembersData = {
  portfolio?: { id: number, code: string, name: string }
  ownerUid: string | null
  ownerInactive: boolean
  members: Member[]
  truncated?: boolean
  docRepo: DocRepo
  canManage: boolean
  canBootstrap: boolean
}
type PolicyState = { exists: boolean, ownedElsewhere: boolean, etag: string, defaultPermission: string, inheritToMemberProjects: boolean }
type PortfolioDocument = {
  id: number
  uuid: string
  title: string
  parentId: number | null
  isFolder: boolean
  documentSource: string
  codocsUuid?: string | null
  repoFilePath?: string | null
  createdBy: string
  updatedAt: string
  accessAllowed: boolean
  accessLifecycleStage: string
  accessConfidentialityLevel: string
  policy: PolicyState | null
  missingSource?: boolean
}
type DocumentsData = {
  items: PortfolioDocument[]
  total: number
  documentTotal: number
  relation: Relation | 'inherited'
  ownerInactive: boolean
  canLink: boolean
  canManagePolicy: boolean
}

const route = useRoute()
const { moduleUrl } = useAimsModule()
const { users: accountUsers } = useAccountUsers()
const { confirm } = useConfirm()
const toast = useToast()
const { user: currentUid } = useAuth()

const portfolioId = computed(() => String(route.params.id || ''))
const userNames = computed(() => new Map(accountUsers.value.map(user => [user.uid, user.realName || user.uid])))
const userName = (uid: string | null | undefined) => uid ? userNames.value.get(uid) || uid : '-'

const tab = ref<'documents' | 'members' | 'repo'>('documents')
const tabs = [
  { label: '项目集文档', value: 'documents', icon: 'i-lucide-files' },
  { label: '成员', value: 'members', icon: 'i-lucide-users' },
  { label: '文档仓库', value: 'repo', icon: 'i-lucide-git-branch' }
]

const relationLabels: Record<string, string> = { manager: '管理者', contributor: '参与者', viewer: '查看者', inherited: '组内项目成员' }
const relationOptions = [
  { label: '管理者（可管理成员与文档策略）', value: 'manager' },
  { label: '参与者（可挂入与移除自己挂入的文档）', value: 'contributor' },
  { label: '查看者（只读）', value: 'viewer' }
]
const levelLabels: Record<string, string> = { L0: 'L0 公开', L1: 'L1 内部', L2: 'L2 机密', L3: 'L3 绝密' }
const stageLabels: Record<string, string> = { draft: '草稿', formal: '正式', archived: '已归档' }
const permissionOptions = [
  { label: '不开放默认权限', value: 'none' },
  { label: '可查看', value: 'view' },
  { label: '可查看并下载', value: 'download' }
]

// 窄屏下表头与单元格不逐字折行，由外层容器横向滚动。
const tableUi = { th: 'whitespace-nowrap', td: 'whitespace-nowrap' }

function failure(cause: unknown, fallback: string) {
  return projectPageFailure(cause, fallback)
}

// ---- 成员与文档仓库 ----
const membersData = ref<MembersData | null>(null)
const membersLoading = ref(false)
const membersError = ref('')
const saving = ref(false)

async function loadMembers() {
  membersLoading.value = true
  membersError.value = ''
  try {
    const response = await $fetch<{ code?: number, data?: MembersData }>(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/members`))
    if (response.code !== 0 || !response.data) throw Error('项目集成员暂不可用')
    membersData.value = response.data
  } catch (cause) {
    membersData.value = null
    membersError.value = failure(cause, '项目集成员暂不可用')
  } finally {
    membersLoading.value = false
  }
}

const members = computed(() => membersData.value?.members || [])
const canManage = computed(() => membersData.value?.canManage === true)
const canBootstrap = computed(() => membersData.value?.canBootstrap === true)

const showMember = ref(false)
const memberForm = ref<{ uid: string, relationType: Relation, validUntil: string, expectedRevision: number, editing: boolean }>({ uid: '', relationType: 'viewer', validUntil: '', expectedRevision: 0, editing: false })
const memberKey = ref('')
const selectedUids = computed({
  get: () => memberForm.value.uid ? [memberForm.value.uid] : [],
  set: (values: string[]) => {
    memberForm.value.uid = values[0] || ''
  }
})

function openMember(member?: Member) {
  memberKey.value = crypto.randomUUID()
  memberForm.value = member
    ? { uid: member.uid, relationType: member.relationType, validUntil: member.validUntil ? member.validUntil.slice(0, 10) : '', expectedRevision: member.revision, editing: true }
    : { uid: '', relationType: canManage.value ? 'viewer' : 'manager', validUntil: '', expectedRevision: 0, editing: false }
  showMember.value = true
}

async function saveMember() {
  saving.value = true
  try {
    const form = memberForm.value
    await $fetch(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/members`), {
      method: 'PUT',
      headers: { 'Idempotency-Key': `portfolio-member:${memberKey.value}` },
      body: {
        action: 'upsert', uid: form.uid, relationType: form.relationType,
        ...(form.validUntil ? { validUntil: `${form.validUntil}T23:59:59Z` } : {}),
        ...(form.expectedRevision ? { expectedRevision: form.expectedRevision } : {})
      }
    })
    showMember.value = false
    toast.add({ title: form.editing ? '成员已更新' : '成员已添加', color: 'success' })
    await Promise.all([loadMembers(), loadDocuments()])
  } catch (cause) {
    toast.add({ title: '成员保存失败', description: failure(cause, '请刷新后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function removeMember(member: Member) {
  if (!(await confirm({ title: '移除项目集成员', message: `确定移除「${userName(member.uid)}（${member.uid}）」？该成员将立即失去对项目集文档的${relationLabels[member.relationType]}权限，之后可以重新添加。`, confirmLabel: '移除', tone: 'warning' }))) return
  saving.value = true
  try {
    await $fetch(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/members`), {
      method: 'PUT',
      headers: { 'Idempotency-Key': `portfolio-member-remove:${member.uid}:${member.revision}` },
      body: { action: 'remove', uid: member.uid, expectedRevision: member.revision }
    })
    toast.add({ title: '成员已移除', color: 'success' })
    await Promise.all([loadMembers(), loadDocuments()])
  } catch (cause) {
    toast.add({ title: '移除失败', description: failure(cause, '请刷新后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

const showRepo = ref(false)
const repoPath = ref('')
const repoKey = ref('')
function openRepo() {
  repoKey.value = crypto.randomUUID()
  repoPath.value = membersData.value?.docRepo?.repoPath || ''
  showRepo.value = true
}
async function saveRepo() {
  saving.value = true
  try {
    const current = membersData.value?.docRepo
    await $fetch(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/doc-repo`), {
      method: 'PUT',
      headers: { 'Idempotency-Key': `portfolio-doc-repo:${repoKey.value}` },
      body: { repoPath: repoPath.value.trim(), ...(current ? { expectedRowVersion: current.rowVersion } : {}) }
    })
    showRepo.value = false
    toast.add({ title: '文档仓库登记已保存', color: 'success' })
    await loadMembers()
  } catch (cause) {
    toast.add({ title: '保存失败', description: failure(cause, '请刷新后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

// ---- 项目集文档 ----
const documentsData = ref<DocumentsData | null>(null)
const documentsLoading = ref(false)
const documentsError = ref('')
const noRelation = ref(false)

async function loadDocuments() {
  documentsLoading.value = true
  documentsError.value = ''
  noRelation.value = false
  try {
    const response = await $fetch<{ code?: number, data?: DocumentsData }>(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/documents`))
    if (response.code !== 0 || !response.data) throw Error('项目集文档暂不可用')
    documentsData.value = response.data
  } catch (cause) {
    documentsData.value = null
    if ((cause as { statusCode?: number })?.statusCode === 403) noRelation.value = true
    else documentsError.value = failure(cause, '项目集文档暂不可用')
  } finally {
    documentsLoading.value = false
  }
}

const canLink = computed(() => documentsData.value?.canLink === true)
const canManagePolicy = computed(() => documentsData.value?.canManagePolicy === true)
const inherited = computed(() => documentsData.value?.relation === 'inherited')
const folders = computed(() => (documentsData.value?.items || []).filter(item => item.isFolder))

// 服务端返回扁平列表；这里按父子关系排成带缩进的树序。
const rows = computed(() => {
  const items = documentsData.value?.items || []
  const ids = new Set(items.map(item => item.id))
  const children = new Map<number, PortfolioDocument[]>()
  for (const item of items) {
    const parent = item.parentId && ids.has(item.parentId) ? item.parentId : 0
    children.set(parent, [...(children.get(parent) || []), item])
  }
  const out: Array<PortfolioDocument & { depth: number }> = []
  const walk = (parent: number, depth: number) => {
    for (const item of children.get(parent) || []) {
      out.push({ ...item, depth })
      if (depth < 20) walk(item.id, depth + 1)
    }
  }
  walk(0, 0)
  return out
})

const showLink = ref(false)
const linkKey = ref('')
const linkForm = ref<{ kind: 'codocs' | 'repo' | 'folder', reference: string, title: string, parentId: number | undefined, uuid: string }>({ kind: 'codocs', reference: '', title: '', parentId: undefined, uuid: '' })
const linkKinds = computed(() => [
  { label: '已有文档', value: 'codocs' },
  ...(membersData.value?.docRepo ? [{ label: '文档仓库中的文件', value: 'repo' }] : []),
  { label: '文件夹', value: 'folder' }
])
const uuidInText = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const linkedUuid = computed(() => linkForm.value.reference.match(uuidInText)?.[0]?.toLowerCase() || '')
const linkValid = computed(() => {
  const form = linkForm.value
  if (!form.title.trim()) return false
  if (form.kind === 'codocs') return !!linkedUuid.value
  if (form.kind === 'repo') return !!form.reference.trim() && !form.reference.includes('..')
  return true
})
const folderOptions = computed(() => [{ label: '项目集根目录', value: 0 }, ...folders.value.map(folder => ({ label: folder.title, value: folder.id }))])
const linkParent = computed({
  get: () => linkForm.value.parentId || 0,
  set: (value: number) => {
    linkForm.value.parentId = value || undefined
  }
})

function openLink(kind: 'codocs' | 'repo' | 'folder' = 'codocs') {
  linkKey.value = crypto.randomUUID()
  // uuid 是这次挂入的身份：同一次提交的重试落到同一行。
  linkForm.value = { kind, reference: '', title: '', parentId: undefined, uuid: crypto.randomUUID() }
  showLink.value = true
}

async function saveLink() {
  saving.value = true
  try {
    const form = linkForm.value
    const response = await $fetch<{ code?: number, data?: { policyOwnedElsewhere?: boolean } }>(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/documents`), {
      method: 'POST',
      headers: { 'Idempotency-Key': `portfolio-document:${linkKey.value}` },
      body: {
        uuid: form.uuid, title: form.title.trim(),
        ...(form.parentId ? { parentId: form.parentId } : {}),
        ...(form.kind === 'folder' ? { isFolder: true } : {}),
        ...(form.kind === 'codocs' ? { codocsUuid: linkedUuid.value } : {}),
        ...(form.kind === 'repo' ? { documentSource: 'repo', repoFilePath: form.reference.trim() } : {})
      }
    })
    showLink.value = false
    toast.add(response.data?.policyOwnedElsewhere
      ? { title: '文档已挂入项目集', description: '该文档的访问策略属于其它项目或项目集：组内项目成员暂不可见，且不能在这里调整策略。', color: 'warning' }
      : { title: form.kind === 'folder' ? '文件夹已创建' : '文档已挂入项目集', color: 'success' })
    await loadDocuments()
  } catch (cause) {
    toast.add({ title: '保存失败', description: failure(cause, '请检查后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

async function removeDocument(document: PortfolioDocument) {
  const message = document.isFolder
    ? `确定移除文件夹「${document.title}」？只能移除不含文档的文件夹，其下的空子文件夹会一并移除。`
    : `确定把「${document.title}」移出项目集？只移除项目集中的引用，文档正文及其在原空间的权限不受影响；项目集成员将不能再从这里看到它。`
  if (!(await confirm({ title: document.isFolder ? '移除文件夹' : '移出项目集', message, confirmLabel: '移除', tone: 'danger' }))) return
  saving.value = true
  try {
    await $fetch(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/documents/${document.id}`), { method: 'DELETE' })
    toast.add({ title: '已移除', color: 'success' })
    await loadDocuments()
  } catch (cause) {
    toast.add({ title: '移除失败', description: failure(cause, '请刷新后重试'), color: 'error' })
  } finally {
    saving.value = false
  }
}

const showPolicy = ref(false)
const policyKey = ref('')
const policyTarget = ref<PortfolioDocument | null>(null)
const policyForm = ref({ lifecycleStage: 'draft', confidentialityLevel: 'L2', defaultPermission: 'none', inheritToMemberProjects: false })
const inheritEffective = computed(() => policyForm.value.inheritToMemberProjects && ['L0', 'L1'].includes(policyForm.value.confidentialityLevel))

function openPolicy(document: PortfolioDocument) {
  policyKey.value = crypto.randomUUID()
  policyTarget.value = document
  policyForm.value = {
    lifecycleStage: document.accessLifecycleStage || 'draft',
    confidentialityLevel: document.accessConfidentialityLevel || 'L2',
    defaultPermission: document.policy?.defaultPermission || 'none',
    // 尚无策略行时默认不继承：必须由管理者明确开启。
    inheritToMemberProjects: document.policy?.exists ? document.policy.inheritToMemberProjects : false
  }
  showPolicy.value = true
}

async function savePolicy() {
  const target = policyTarget.value
  if (!target) return
  saving.value = true
  try {
    await $fetch(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/documents/${target.id}/policy`), {
      method: 'PUT',
      headers: { 'Idempotency-Key': `portfolio-document-policy:${policyKey.value}` },
      body: { ...policyForm.value, expectedEtag: target.policy?.etag || '' }
    })
    showPolicy.value = false
    toast.add({ title: '访问策略已保存', color: 'success' })
    await loadDocuments()
  } catch (cause) {
    toast.add({ title: '保存失败', description: failure(cause, '策略可能已被他人修改，请刷新后重试'), color: 'error' })
    await loadDocuments()
  } finally {
    saving.value = false
  }
}

function canRemove(document: PortfolioDocument) {
  if (!canLink.value) return false
  return canManagePolicy.value || (!document.isFolder && document.createdBy === currentUid.value)
}

function refresh() {
  void loadMembers()
  void loadDocuments()
}
watch(portfolioId, refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-portfolio-detail" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div class="border-b border-default px-4 py-3 sm:px-6">
          <UButton
            :to="moduleUrl('/projects')"
            variant="link"
            color="neutral"
            size="sm"
            icon="i-lucide-arrow-left"
            class="-ml-2"
          >
            返回项目总览
          </UButton>
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 class="min-w-0 truncate text-xl font-semibold text-highlighted">
              {{ membersData?.portfolio?.name || '项目集' }}
            </h1>
            <UBadge v-if="membersData?.portfolio?.code" color="neutral" variant="subtle">
              {{ membersData.portfolio.code }}
            </UBadge>
            <span v-if="membersData" class="text-sm text-muted">负责人：{{ userName(membersData.ownerUid) }}</span>
            <UBadge
              v-if="membersData?.ownerInactive"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
            >
              负责人已失效
            </UBadge>
            <UBadge v-if="documentsData" color="primary" variant="subtle">
              我的关系：{{ relationLabels[documentsData.relation] || documentsData.relation }}
            </UBadge>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              class="ml-auto"
              :loading="membersLoading || documentsLoading"
              @click="refresh"
            />
          </div>
          <UTabs
            v-model="tab"
            :items="tabs"
            :content="false"
            variant="link"
            size="sm"
            class="mt-2"
          />
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <!-- 项目集文档 -->
          <section v-if="tab === 'documents'" class="space-y-4">
            <UAlert
              color="info"
              variant="subtle"
              icon="i-lucide-info"
              title="项目集下不能直接新建文档"
              description="请先在个人或部门文档空间创建文档，再把它挂入项目集。只有文档的所有者可以挂入；挂入后项目集成员可以查看，密级为 L0/L1 且开启继承的文档对组内项目的成员也可见。"
            />
            <UAlert
              v-if="documentsError"
              color="error"
              icon="i-lucide-circle-alert"
              title="无法读取项目集文档"
              :description="documentsError"
            />
            <CommonEmptyState
              v-else-if="noRelation"
              icon="i-lucide-lock"
              title="你不是该项目集的成员"
              description="项目集文档只对项目集成员和组内项目的成员开放。请联系项目集管理者添加。"
            />
            <template v-else>
              <div v-if="canLink" class="flex flex-wrap gap-2">
                <UButton icon="i-lucide-link" size="sm" @click="openLink('codocs')">
                  挂入已有文档
                </UButton>
                <UButton
                  icon="i-lucide-folder-plus"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  @click="openLink('folder')"
                >
                  新建文件夹
                </UButton>
              </div>
              <div class="overflow-x-auto">
                <UTable
                  :data="rows"
                  :loading="documentsLoading"
                  :ui="tableUi"
                  :columns="[
                    { accessorKey: 'title', header: '名称' },
                    { accessorKey: 'documentSource', header: '来源' },
                    { accessorKey: 'accessConfidentialityLevel', header: '密级' },
                    { accessorKey: 'accessLifecycleStage', header: '状态' },
                    ...(inherited ? [] : [{ id: 'inherit', header: '组内项目成员' }]),
                    { accessorKey: 'updatedAt', header: '更新时间' },
                    ...(canLink ? [{ id: 'actions', header: '操作' }] : [])
                  ]"
                >
                  <template #title-cell="{ row }">
                    <div class="flex min-w-48 items-center gap-2" :style="{ paddingLeft: `${row.original.depth * 20}px` }">
                      <UIcon :name="row.original.isFolder ? 'i-lucide-folder' : row.original.documentSource === 'repo' ? 'i-lucide-file-code' : 'i-lucide-file-text'" class="size-4 shrink-0 text-muted" />
                      <NuxtLink
                        v-if="!row.original.isFolder && !row.original.missingSource && row.original.documentSource !== 'repo'"
                        :to="moduleUrl(`/portfolios/${portfolioId}/documents/${row.original.id}`)"
                        class="truncate font-medium transition-colors hover:text-primary"
                      >
                        {{ row.original.title }}
                      </NuxtLink>
                      <span v-else class="truncate font-medium">{{ row.original.title }}</span>
                      <UBadge
                        v-if="row.original.documentSource === 'repo'"
                        color="neutral"
                        variant="subtle"
                        title="仓库文件暂不支持在线查看"
                      >
                        暂不支持在线查看
                      </UBadge>
                      <UBadge
                        v-if="row.original.missingSource"
                        color="error"
                        variant="subtle"
                        title="引用指向的文档已不存在。管理者可以移除这条引用。"
                      >
                        引用缺失
                      </UBadge>
                    </div>
                  </template>
                  <template #documentSource-cell="{ row }">
                    <span v-if="row.original.isFolder" class="text-muted">文件夹</span>
                    <span v-else-if="row.original.missingSource" class="text-muted">—</span>
                    <span v-else>{{ row.original.documentSource === 'repo' ? '文档仓库' : '平台文档' }}</span>
                  </template>
                  <template #accessConfidentialityLevel-cell="{ row }">
                    <UBadge
                      v-if="!row.original.isFolder && !row.original.missingSource"
                      :color="['L2', 'L3'].includes(row.original.accessConfidentialityLevel) ? 'warning' : 'neutral'"
                      variant="subtle"
                    >
                      {{ levelLabels[row.original.accessConfidentialityLevel] || row.original.accessConfidentialityLevel }}
                    </UBadge>
                    <span v-else class="text-muted">—</span>
                  </template>
                  <template #accessLifecycleStage-cell="{ row }">
                    <span v-if="!row.original.isFolder && !row.original.missingSource">{{ stageLabels[row.original.accessLifecycleStage] || row.original.accessLifecycleStage }}</span>
                    <span v-else class="text-muted">—</span>
                  </template>
                  <template #inherit-cell="{ row }">
                    <template v-if="!row.original.isFolder && !row.original.missingSource">
                      <UBadge v-if="row.original.policy?.ownedElsewhere" color="warning" variant="subtle">
                        策略属于别处
                      </UBadge>
                      <UBadge
                        v-else-if="row.original.documentSource !== 'repo' && row.original.policy?.exists && row.original.policy.inheritToMemberProjects && ['L0', 'L1'].includes(row.original.accessConfidentialityLevel)"
                        color="success"
                        variant="subtle"
                      >
                        可见
                      </UBadge>
                      <span v-else class="text-muted">不可见</span>
                    </template>
                    <span v-else class="text-muted">—</span>
                  </template>
                  <template #actions-cell="{ row }">
                    <div class="flex flex-wrap items-center gap-2">
                      <UButton
                        v-if="canManagePolicy && !row.original.isFolder && !row.original.missingSource && row.original.documentSource !== 'repo'"
                        size="xs"
                        variant="soft"
                        :disabled="saving || row.original.policy?.ownedElsewhere"
                        :title="row.original.policy?.ownedElsewhere ? '该文档的访问策略属于其它项目或项目集，不能在这里修改' : undefined"
                        @click="openPolicy(row.original)"
                      >
                        访问策略
                      </UButton>
                      <UButton
                        v-if="canRemove(row.original)"
                        size="xs"
                        color="error"
                        variant="soft"
                        :disabled="saving"
                        @click="removeDocument(row.original)"
                      >
                        移除
                      </UButton>
                      <span v-if="!canRemove(row.original) && !(canManagePolicy && !row.original.isFolder && !row.original.missingSource && row.original.documentSource !== 'repo')" class="text-muted">—</span>
                    </div>
                  </template>
                  <template #empty>
                    <div class="whitespace-normal">
                      <CommonEmptyState
                        icon="i-lucide-files"
                        :title="inherited ? '暂无对组内项目成员开放的文档' : '项目集还没有文档'"
                        :description="inherited ? '项目集管理者把文档设为 L0/L1 并开启继承后，会显示在这里。' : '把个人或部门空间中已有的文档挂入项目集，供成员查阅。'"
                      >
                        <UButton
                          v-if="canLink"
                          icon="i-lucide-link"
                          size="sm"
                          @click="openLink('codocs')"
                        >
                          挂入已有文档
                        </UButton>
                      </CommonEmptyState>
                    </div>
                  </template>
                </UTable>
              </div>
              <p v-if="documentsData" class="text-sm text-muted">
                共 {{ documentsData.total }} 项，其中 {{ documentsData.documentTotal }} 份文档
              </p>
            </template>
          </section>

          <!-- 成员 -->
          <section v-else-if="tab === 'members'" class="space-y-4">
            <UAlert
              v-if="membersError"
              color="error"
              icon="i-lucide-circle-alert"
              title="无法读取项目集成员"
              :description="membersError"
            />
            <template v-else>
              <UAlert
                v-if="membersData?.ownerInactive"
                color="warning"
                variant="subtle"
                icon="i-lucide-triangle-alert"
                title="负责人已不是在职员工"
                description="该负责人不再被视为项目集管理者。请指定其他管理者，或在项目总览中更换负责人。"
              />
              <UAlert
                v-if="canBootstrap"
                color="info"
                variant="subtle"
                icon="i-lucide-user-cog"
                title="项目集还没有管理者"
                description="你拥有项目集管理权限，可以指定第一名管理者；之后的成员由管理者维护。"
              />
              <UAlert
                v-if="membersData?.truncated"
                color="warning"
                variant="subtle"
                icon="i-lucide-list-end"
                title="成员过多，仅显示前 500 名"
              />
              <div v-if="canManage || canBootstrap" class="flex">
                <UButton icon="i-lucide-user-plus" size="sm" @click="openMember()">
                  {{ canManage ? '添加成员' : '指定管理者' }}
                </UButton>
              </div>
              <div class="overflow-x-auto">
                <UTable
                  :data="members"
                  :loading="membersLoading"
                  :ui="tableUi"
                  :columns="[
                    { accessorKey: 'uid', header: '成员' },
                    { accessorKey: 'relationType', header: '关系' },
                    { accessorKey: 'effective', header: '状态' },
                    { accessorKey: 'validUntil', header: '有效期至' },
                    ...(canManage ? [{ id: 'actions', header: '操作' }] : [])
                  ]"
                >
                  <template #uid-cell="{ row }">
                    <div class="min-w-40">
                      <span class="font-medium">{{ userName(row.original.uid) }}</span><span class="ml-2 text-xs text-muted">{{ row.original.uid }}</span>
                    </div>
                  </template>
                  <template #relationType-cell="{ row }">
                    {{ relationLabels[row.original.relationType] || row.original.relationType }}
                  </template>
                  <template #effective-cell="{ row }">
                    <UBadge :color="row.original.effective ? 'success' : 'neutral'" variant="subtle">
                      {{ row.original.effective ? '有效' : row.original.status === 'active' ? '已过期' : '已移除' }}
                    </UBadge>
                  </template>
                  <template #validUntil-cell="{ row }">
                    {{ row.original.validUntil ? row.original.validUntil.slice(0, 10) : '长期' }}
                  </template>
                  <template #actions-cell="{ row }">
                    <div class="flex flex-wrap items-center gap-2">
                      <UButton
                        size="xs"
                        variant="soft"
                        :disabled="saving"
                        @click="openMember(row.original)"
                      >
                        {{ row.original.effective ? '调整' : '重新启用' }}
                      </UButton>
                      <UButton
                        v-if="row.original.effective"
                        size="xs"
                        color="error"
                        variant="soft"
                        :disabled="saving"
                        @click="removeMember(row.original)"
                      >
                        移除
                      </UButton>
                    </div>
                  </template>
                  <template #empty>
                    <div class="whitespace-normal">
                      <CommonEmptyState icon="i-lucide-users" title="暂无项目集成员" description="负责人默认是管理者。添加成员后，他们可以查看项目集文档。">
                        <UButton
                          v-if="canManage || canBootstrap"
                          icon="i-lucide-user-plus"
                          size="sm"
                          @click="openMember()"
                        >
                          {{ canManage ? '添加成员' : '指定管理者' }}
                        </UButton>
                      </CommonEmptyState>
                    </div>
                  </template>
                </UTable>
              </div>
              <p class="text-sm text-muted">
                共 {{ members.length }} 名成员
              </p>
            </template>
          </section>

          <!-- 文档仓库 -->
          <section v-else class="max-w-2xl space-y-4">
            <UAlert
              v-if="membersError"
              color="error"
              icon="i-lucide-circle-alert"
              title="无法读取文档仓库登记"
              :description="membersError"
            />
            <UCard v-else>
              <div class="space-y-3">
                <div>
                  <p class="text-sm text-muted">
                    登记的文档仓库
                  </p>
                  <p class="mt-1 break-all font-medium">
                    {{ membersData?.docRepo?.repoPath || '尚未登记' }}
                  </p>
                </div>
                <p class="text-sm text-muted">
                  登记后，项目集的管理者和参与者可以把该仓库中的文件按提交版本引用到项目集文档中。平台只读取仓库内容，不会向仓库提交。
                </p>
                <UButton
                  v-if="canManage"
                  size="sm"
                  icon="i-lucide-pencil"
                  @click="openRepo"
                >
                  {{ membersData?.docRepo ? '修改登记' : '登记文档仓库' }}
                </UButton>
              </div>
            </UCard>
          </section>
        </div>

        <UModal v-model:open="showMember" :title="memberForm.editing ? '调整项目集成员' : canManage ? '添加项目集成员' : '指定第一名管理者'" description="成员关系决定其对项目集文档的权限，保存后立即生效。">
          <template #body>
            <div class="space-y-4">
              <UFormField label="成员" required>
                <p v-if="memberForm.editing" class="font-medium">
                  {{ userName(memberForm.uid) }}<span class="ml-2 text-xs text-muted">{{ memberForm.uid }}</span>
                </p>
                <UserTreeSelector
                  v-else
                  v-model="selectedUids"
                  selection-mode="single"
                  :exclude-uids="members.filter(member => member.effective).map(member => member.uid)"
                />
              </UFormField>
              <UFormField label="关系" required>
                <USelect
                  v-model="memberForm.relationType"
                  :items="canManage ? relationOptions : relationOptions.slice(0, 1)"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="有效期至" hint="留空表示长期有效">
                <UInput v-model="memberForm.validUntil" type="date" class="w-full" />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="showMember = false"
            >
              取消
            </UButton>
            <UButton :loading="saving" :disabled="!memberForm.uid" @click="saveMember">
              保存
            </UButton>
          </template>
        </UModal>

        <UModal v-model:open="showRepo" title="登记文档仓库" description="填写 GitLab 仓库的完整路径，例如 group/subgroup/docs。留空并保存表示取消登记。">
          <template #body>
            <UFormField label="仓库路径">
              <UInput v-model="repoPath" placeholder="group/docs" class="w-full" />
            </UFormField>
          </template>
          <template #footer>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="showRepo = false"
            >
              取消
            </UButton>
            <UButton :loading="saving" @click="saveRepo">
              保存
            </UButton>
          </template>
        </UModal>

        <USlideover
          v-model:open="showLink"
          :title="linkForm.kind === 'folder' ? '新建文件夹' : '挂入文档'"
          description="挂入只在项目集中建立引用，不复制、不移动文档正文。"
          :ui="{ content: 'w-full sm:max-w-lg' }"
        >
          <template #body>
            <div class="space-y-4">
              <UFormField label="类型" required>
                <USelect v-model="linkForm.kind" :items="linkKinds" class="w-full" />
              </UFormField>
              <UFormField
                v-if="linkForm.kind === 'codocs'"
                label="文档链接或标识"
                required
                :error="linkForm.reference && !linkedUuid ? '未识别到文档标识，请粘贴文档页面的完整链接' : undefined"
                help="在文档页面复制地址栏链接后粘贴到这里。只有文档的所有者可以挂入。"
              >
                <UInput v-model="linkForm.reference" placeholder="粘贴文档链接" class="w-full" />
              </UFormField>
              <UFormField
                v-else-if="linkForm.kind === 'repo'"
                label="仓库内文件路径"
                required
                :help="`来自已登记的文档仓库 ${membersData?.docRepo?.repoPath || ''}，按当前提交版本引用。`"
              >
                <UInput v-model="linkForm.reference" placeholder="docs/design.md" class="w-full" />
              </UFormField>
              <UFormField :label="linkForm.kind === 'folder' ? '文件夹名称' : '在项目集中显示的标题'" required>
                <UInput v-model="linkForm.title" maxlength="255" class="w-full" />
              </UFormField>
              <UFormField label="放入">
                <USelect v-model="linkParent" :items="folderOptions" class="w-full" />
              </UFormField>
            </div>
          </template>
          <template #footer>
            <div class="flex w-full justify-end gap-2">
              <UButton
                color="neutral"
                variant="outline"
                :disabled="saving"
                @click="showLink = false"
              >
                取消
              </UButton>
              <UButton :loading="saving" :disabled="!linkValid" @click="saveLink">
                {{ linkForm.kind === 'folder' ? '创建' : '挂入项目集' }}
              </UButton>
            </div>
          </template>
        </USlideover>

        <UModal v-model:open="showPolicy" title="文档访问策略" :description="policyTarget ? `「${policyTarget.title}」在项目集中的访问范围。项目集成员始终可以查看。` : ''">
          <template #body>
            <div class="space-y-4">
              <UFormField label="密级" required>
                <USelect v-model="policyForm.confidentialityLevel" :items="Object.entries(levelLabels).map(([value, label]) => ({ label, value }))" class="w-full" />
              </UFormField>
              <UFormField label="状态" required>
                <USelect v-model="policyForm.lifecycleStage" :items="Object.entries(stageLabels).map(([value, label]) => ({ label, value }))" class="w-full" />
              </UFormField>
              <UFormField label="下载" required>
                <USelect v-model="policyForm.defaultPermission" :items="permissionOptions" class="w-full" />
              </UFormField>
              <UFormField label="对组内项目成员开放">
                <div class="flex items-center gap-3">
                  <USwitch v-model="policyForm.inheritToMemberProjects" />
                  <span class="text-sm" :class="inheritEffective ? 'text-success' : 'text-muted'">
                    {{ inheritEffective ? '组内项目的成员可以查看' : policyForm.inheritToMemberProjects ? 'L2、L3 文档不会对组内项目成员开放' : '仅项目集成员可见' }}
                  </span>
                </div>
              </UFormField>
            </div>
          </template>
          <template #footer>
            <UButton
              color="neutral"
              variant="outline"
              :disabled="saving"
              @click="showPolicy = false"
            >
              取消
            </UButton>
            <UButton :loading="saving" @click="savePolicy">
              保存
            </UButton>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
