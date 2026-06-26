<script setup lang="ts">
import { pinyin } from 'pinyin-pro'
import type {
  CreateProjectRequest,
  ProjectCategory,
  PivrStage,
  ProjectTemplateVersionDetail,
  ProjectTemplateVersionSummary
} from '~/types/aims'
import { pivrPhases } from '~/config/milestone'
import {
  normalizeListPayload,
  normalizeProjectTemplateVersion,
  type RawProjectTemplateVersion
} from '~/utils/projectTemplateVersions'
import { projectSecurityLevelConfig, projectSecurityLevelOptions } from '~/config/project'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '创建项目'
})

const route = useRoute()
const projectStore = useProjectStore()
const portfolioStore = usePortfolioStore()
const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const canCreateProjects = computed(() => hasPermission('projects', 'admin'))

// Account 用户列表（用于负责人选择）
const { users: accountUsers } = useAccountUsers()

// 业务领域字典
const { domains: businessDomains } = useBusinessDomains()

// 业务领域分类单选
const domainCategoryItems = [
  { label: '政务', value: '2G' },
  { label: '企业', value: '2B' },
  { label: '个人', value: '2C' }
]

const projectDomainCategory = ref<'2G' | '2B' | '2C'>('2G')

// 按分类过滤的领域子级选项
const projectDomainOptions = computed(() => {
  return businessDomains.value
    .filter(d => d.category === projectDomainCategory.value)
    .map(d => ({ label: d.domainName, value: d.domainCode }))
})

// 切换分类时清空已选的领域
watch(projectDomainCategory, () => {
  form.value.domainCode = ''
})

// 部门列表（仅当前用户有权限的部门）
const { accessibleDepartments, departmentOptions } = useAccessibleDepartments()
const departmentFlat = computed(() => accessibleDepartments.value)

// 用户选项（按部门过滤，含部门负责人/管理者）
const userOptions = computed(() => {
  const deptCode = form.value.deptCode
  const dept = deptCode ? departmentFlat.value.find(d => d.deptCode === deptCode) : null
  const deptHeadUids = new Set<string>()
  if (dept?.managerId) deptHeadUids.add(dept.managerId)
  const seen = new Set<string>()
  return accountUsers.value
    .filter((u) => {
      if (seen.has(u.uid)) return false
      seen.add(u.uid)
      if (deptCode) return u.deptCode === deptCode || deptHeadUids.has(u.uid)
      return true
    })
    .map(u => ({
      label: u.realName?.trim() || u.uid,
      uid: u.realName?.trim() && u.realName !== u.uid ? u.uid : undefined,
      value: u.uid
    }))
})

// ========================
// 表单
// ========================
const form = ref<CreateProjectRequest>({
  projectCode: '',
  name: '',
  shortName: '',
  internalCode: '',
  description: '',
  category: 'product_dev',
  methodology: 'PIVR',
  deptCode: '',
  leaderUid: '',
  securityLevel: 'company',
  accessWhitelist: [],
  startDate: '',
  endDate: ''
})

const projectNameError = ref('')
const projectShortNameError = ref('')
const projectCodeError = ref('')
const projectCodeManuallyEdited = ref(false)
let duplicateCheckTimer: ReturnType<typeof setTimeout> | null = null
const creating = ref(false)
const selectedSecurityLevelConfig = computed(() => projectSecurityLevelConfig[form.value.securityLevel || 'company'])
const accessWhitelist = computed({
  get: () => form.value.accessWhitelist || [],
  set: (value: string[]) => {
    form.value.accessWhitelist = value
  }
})

// 是否从 URL query 锁定了项目集
const portfolioLocked = ref(false)

const categoryOptions = [
  { label: '产品研发', value: 'product_dev' },
  { label: '定制开发', value: 'custom_dev' },
  { label: '交付实施', value: 'delivery' },
  { label: '运维保障', value: 'maintenance' },
  { label: '销售', value: 'sales' },
  { label: '售前', value: 'presales' },
  { label: '改进', value: 'improvement' },
  { label: '合规', value: 'compliance' }
]

// 项目集选择选项
const portfolioAssignOptions = computed(() => {
  const opts: { label: string, value: number | null }[] = [
    { label: '不归属任何项目集', value: null }
  ]
  for (const pf of portfolioStore.portfolios) {
    opts.push({ label: pf.isProductLine ? `${pf.name} · 产品线` : pf.name, value: pf.id })
  }
  return opts
})

const selectedPortfolio = computed(() => {
  if (form.value.portfolioId == null) return null
  return portfolioStore.portfolios.find(pf => pf.id === form.value.portfolioId) || null
})

const isPortfolioProductLine = computed(() => selectedPortfolio.value?.isProductLine === true)

watch(selectedPortfolio, (portfolio) => {
  if (portfolio?.isProductLine) {
    form.value.category = 'product_dev'
  }
})

// ========================
// 项目立项书
// ========================
interface ProposalDocumentListItem {
  uuid: string
  title: string
  ownerUid: string
  deptCode: string | null
  folderId: number | null
  folderName: string | null
  aiAbstract: string | null
  updatedAt: string
  contentSize: number
}

interface ProposalFolderListItem {
  id: number
  name: string
  parentId: number | null
  updatedAt: string
}

interface ProposalDocumentSummary {
  uuid: string
  title: string
  ownerUid: string
  ownerName: string
  deptCode: string | null
  aiAbstract: string | null
  updatedAt: string
  readonlyFlag: number
}

const showProposalDocumentModal = ref(false)
const showProposalPreviewModal = ref(false)
const proposalDocumentLoading = ref(false)
const proposalDocumentPreviewLoading = ref(false)
const proposalDocumentLoadError = ref('')
const proposalDocumentPreviewError = ref('')
const proposalDocumentError = ref('')
const proposalDocumentDeptCodeLoaded = ref('')
const proposalDepartmentDocuments = ref<ProposalDocumentListItem[]>([])
const proposalDepartmentFolders = ref<ProposalFolderListItem[]>([])
const selectedProposalDocument = ref<ProposalDocumentSummary | null>(null)
const draftProposalDocumentUuid = ref('')
const draftProposalDocumentSummary = ref<ProposalDocumentSummary | null>(null)
const proposalDocumentEmbedLoading = ref(false)

const proposalDocumentOptions = computed(() => {
  const folderMap = new Map<number, ProposalFolderListItem>()
  for (const folder of proposalDepartmentFolders.value) {
    folderMap.set(folder.id, folder)
  }

  const resolveFolderPath = (folderId: number | null) => {
    if (!folderId) return ''

    const parts: string[] = []
    const visited = new Set<number>()
    let currentFolderId: number | null = folderId

    while (currentFolderId && !visited.has(currentFolderId)) {
      visited.add(currentFolderId)
      const folder = folderMap.get(currentFolderId)
      if (!folder) break
      parts.unshift(folder.name)
      currentFolderId = folder.parentId
    }

    return parts.join(' / ')
  }

  const folderItems = proposalDepartmentFolders.value.map(folder => ({
    label: `目录 / ${resolveFolderPath(folder.id) || folder.name}`,
    value: `folder:${folder.id}`,
    description: `更新于 ${formatDateTime(folder.updatedAt)}`,
    disabled: true
  }))

  const documentItems = proposalDepartmentDocuments.value.map((doc) => {
    const folderPath = resolveFolderPath(doc.folderId)
    return {
      label: doc.title,
      value: doc.uuid,
      description: folderPath
        ? `${folderPath} · 更新于 ${formatDateTime(doc.updatedAt)}`
        : `更新于 ${formatDateTime(doc.updatedAt)}`
    }
  })

  return [...folderItems, ...documentItems]
})

function formatDateTime(date: string | null | undefined) {
  if (!date) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date))
  } catch {
    return date
  }
}

function resetProposalDocumentSelection() {
  selectedProposalDocument.value = null
  draftProposalDocumentUuid.value = ''
  draftProposalDocumentSummary.value = null
  proposalDocumentEmbedLoading.value = false
  proposalDocumentError.value = ''
  proposalDocumentDeptCodeLoaded.value = ''
  proposalDepartmentDocuments.value = []
  proposalDepartmentFolders.value = []
}

async function loadProposalDepartmentDocuments() {
  if (!form.value.deptCode) return

  proposalDocumentLoading.value = true
  proposalDocumentLoadError.value = ''
  try {
    const res = await $fetch<{ code: number, data: { folders: ProposalFolderListItem[], items: ProposalDocumentListItem[] } }>('/api/v1/codocs/department-documents', {
      params: { deptCode: form.value.deptCode }
    })
    if (res.code === 0) {
      proposalDepartmentFolders.value = res.data.folders || []
      proposalDepartmentDocuments.value = res.data.items || []
      proposalDocumentDeptCodeLoaded.value = form.value.deptCode || ''
    }
  } catch (err: unknown) {
    proposalDepartmentFolders.value = []
    proposalDepartmentDocuments.value = []
    proposalDocumentLoadError.value = getErrorMessage(err, '加载部门文档失败')
  } finally {
    proposalDocumentLoading.value = false
  }
}

async function loadProposalDocumentSummary(uuid: string) {
  proposalDocumentPreviewLoading.value = true
  proposalDocumentEmbedLoading.value = false
  proposalDocumentPreviewError.value = ''
  draftProposalDocumentSummary.value = null
  try {
    const res = await $fetch<{ code: number, data: ProposalDocumentSummary }>(`/api/v1/codocs/documents/${uuid}/summary`)
    if (res.code === 0) {
      draftProposalDocumentSummary.value = res.data
      proposalDocumentEmbedLoading.value = true
    }
  } catch (err: unknown) {
    proposalDocumentPreviewError.value = getErrorMessage(err, '加载立项书预览失败')
  } finally {
    proposalDocumentPreviewLoading.value = false
  }
}

async function onProposalDocumentChange(uuid: string | null) {
  draftProposalDocumentUuid.value = uuid || ''
  if (!draftProposalDocumentUuid.value) {
    draftProposalDocumentSummary.value = null
    proposalDocumentEmbedLoading.value = false
    proposalDocumentPreviewError.value = ''
    return
  }
  await loadProposalDocumentSummary(draftProposalDocumentUuid.value)
}

async function openProposalDocumentModal() {
  if (!form.value.leaderUid) {
    leaderError.value = '请选择负责人'
    proposalDocumentError.value = '请先选择负责人后再关联立项书'
    return
  }

  if (!form.value.deptCode) {
    proposalDocumentError.value = '当前负责人未关联所属部门，无法加载部门文档'
    toast.add({ title: proposalDocumentError.value, color: 'warning' })
    return
  }

  showProposalDocumentModal.value = true
  proposalDocumentError.value = ''
  draftProposalDocumentUuid.value = selectedProposalDocument.value?.uuid || ''
  draftProposalDocumentSummary.value = selectedProposalDocument.value ? { ...selectedProposalDocument.value } : null

  if (proposalDocumentDeptCodeLoaded.value !== form.value.deptCode) {
    await loadProposalDepartmentDocuments()
  }

  if (draftProposalDocumentUuid.value && !draftProposalDocumentSummary.value) {
    await loadProposalDocumentSummary(draftProposalDocumentUuid.value)
  }
}

function confirmProposalDocumentSelection() {
  if (!draftProposalDocumentUuid.value || !draftProposalDocumentSummary.value) {
    proposalDocumentPreviewError.value = '请选择立项书'
    return
  }

  selectedProposalDocument.value = {
    ...draftProposalDocumentSummary.value,
    updatedAt: draftProposalDocumentSummary.value.updatedAt
      || proposalDepartmentDocuments.value.find(doc => doc.uuid === draftProposalDocumentUuid.value)?.updatedAt
      || ''
  }
  proposalDocumentError.value = ''
  showProposalDocumentModal.value = false
}

// ========================
// 项目模板版本
// ========================
const templateVersions = ref<ProjectTemplateVersionSummary[]>([])
const selectedTemplateVersionId = ref<number | null>(null)
const selectedTemplateVersionDetail = ref<ProjectTemplateVersionDetail | null>(null)
const templateVersionLoading = ref(false)
const templateVersionError = ref('')
const excludedWorkItemKeys = ref<Set<string>>(new Set())
const stages: PivrStage[] = ['P', 'I', 'V', 'R']

async function loadTemplateVersionDetail(id: number | null) {
  selectedTemplateVersionDetail.value = null
  excludedWorkItemKeys.value = new Set()
  if (!id) return

  try {
    const res = await $fetch<{ code: number, data: RawProjectTemplateVersion }>(`/api/v1/project-template-versions/${id}`)
    if (res.code === 0) {
      selectedTemplateVersionDetail.value = normalizeProjectTemplateVersion(res.data)
    }
  } catch (err: unknown) {
    templateVersionError.value = getErrorMessage(err, '加载模板版本详情失败')
  }
}

async function loadTemplateVersions(category: ProjectCategory) {
  templateVersionLoading.value = true
  templateVersionError.value = ''
  try {
    const res = await $fetch<{ code: number, data: ProjectTemplateVersionSummary[] | { items?: RawProjectTemplateVersion[] } }>('/api/v1/project-template-versions', {
      params: { category, status: 'published' }
    })
    if (res.code === 0) {
      templateVersions.value = normalizeListPayload<RawProjectTemplateVersion>(res.data)
        .map(normalizeProjectTemplateVersion)
      const preferredId = templateVersions.value.find(item => item.id === selectedTemplateVersionId.value)?.id
      selectedTemplateVersionId.value = preferredId || templateVersions.value[0]?.id || null
      await loadTemplateVersionDetail(selectedTemplateVersionId.value)
    }
  } catch (err: unknown) {
    templateVersions.value = []
    selectedTemplateVersionId.value = null
    selectedTemplateVersionDetail.value = null
    templateVersionError.value = getErrorMessage(err, '加载模板版本列表失败')
  } finally {
    templateVersionLoading.value = false
  }
}

watch(() => form.value.category, async (cat) => {
  if (cat) {
    await loadTemplateVersions(cat)
  } else {
    templateVersions.value = []
    selectedTemplateVersionId.value = null
    selectedTemplateVersionDetail.value = null
  }
}, { immediate: true })

watch(selectedTemplateVersionId, async (id) => {
  if (!id) {
    selectedTemplateVersionDetail.value = null
    return
  }
  await loadTemplateVersionDetail(id)
})

function isWorkItemSelected(key: string) {
  return !excludedWorkItemKeys.value.has(key)
}

function toggleWorkItemSelection(key: string, required: boolean) {
  if (required) return
  const next = new Set(excludedWorkItemKeys.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  excludedWorkItemKeys.value = next
}

function getTemplateMilestonesForStage(stage: PivrStage) {
  return selectedTemplateVersionDetail.value?.definition.milestones.filter(milestone => milestone.pivrStage === stage) || []
}

const deliverableTypeLabel: Record<string, string> = {
  document: '文档',
  code: '代码',
  artifact: '制品',
  task: '事务'
}

// ========================
// 校验与自动生成编码
// ========================
function validateAndGenerateCode(name: string) {
  projectNameError.value = ''

  if (!name) return

  const namePattern = /^[\u4e00-\u9fa5a-zA-Z0-9]+(?:[vV]\d+)?$/
  if (!namePattern.test(name)) {
    projectNameError.value = '只能包含汉字、英文和数字，不允许空格和特殊字符，可选尾部版本号如V2'
    return
  }

  if (/v\d+$/.test(name)) {
    form.value.name = name.replace(/v(\d+)$/, 'V$1')
    return
  }

  const vMatch = name.match(/V(\D+)$/)
  if (vMatch) {
    projectNameError.value = 'V后面只能带整数，如V2、V12'
  }

  if (duplicateCheckTimer) clearTimeout(duplicateCheckTimer)
  duplicateCheckTimer = setTimeout(() => checkDuplicate(), 500)
}

function validateProjectShortName(shortName: string) {
  projectShortNameError.value = ''
  if (!shortName) return

  const chineseCharCount = (shortName.match(/[\u4e00-\u9fa5]/g) || []).length
  if (chineseCharCount > 6) {
    projectShortNameError.value = '项目简称不能超过6个汉字'
  }
}

function getErrorMessage(err: unknown, fallback: string) {
  if (err instanceof Error && err.message) return err.message
  if (!err || typeof err !== 'object') return fallback

  const objectError = err as { data?: unknown, message?: unknown }
  const dataMessage = objectError.data && typeof objectError.data === 'object'
    ? (objectError.data as { message?: unknown }).message
    : undefined

  if (typeof dataMessage === 'string' && dataMessage) return dataMessage
  if (typeof objectError.message === 'string' && objectError.message) return objectError.message
  return fallback
}

function generateProjectCode(name: string): string {
  const versionMatch = name.match(/V(\d+)$/)
  const version = versionMatch ? versionMatch[1] : ''
  const baseName = versionMatch ? name.slice(0, -versionMatch[0].length) : name

  const initials = pinyin(baseName, { pattern: 'first', toneType: 'none', type: 'array' })
    .map(s => s.replace(/[^a-zA-Z]/g, '').toUpperCase())
    .filter(Boolean)
    .join('')

  return version ? `${initials}${version}` : initials
}

function onProjectCodeInput(value: string) {
  projectCodeManuallyEdited.value = true

  if (/[^a-zA-Z0-9]/.test(value)) {
    projectCodeError.value = '只能包含英文字母和数字，不允许特殊字符'
  } else {
    projectCodeError.value = ''
  }

  form.value.projectCode = value.toUpperCase()

  if (duplicateCheckTimer) clearTimeout(duplicateCheckTimer)
  duplicateCheckTimer = setTimeout(() => checkDuplicate(), 500)
}

async function checkDuplicate() {
  if (projectNameError.value === '该项目名称已存在') projectNameError.value = ''
  if (projectCodeError.value === '该项目编码已存在') projectCodeError.value = ''

  const { name, projectCode } = form.value
  if (!name && !projectCode) return

  try {
    const res = await $fetch<{ code: number, data: { nameExists: boolean, codeExists: boolean } }>(
      '/api/v1/projects/check-duplicate',
      { params: { name: name || undefined, projectCode: projectCode || undefined } }
    )
    if (res.code === 0) {
      if (res.data.nameExists && !projectNameError.value) projectNameError.value = '该项目名称已存在'
      if (res.data.codeExists && !projectCodeError.value) projectCodeError.value = '该项目编码已存在'
    }
  } catch {
    // 静默失败
  }
}

// 项目名称变化时校验（不再自动生成编码）
watch(() => form.value.name, (val) => {
  validateAndGenerateCode(val)
})

// 项目简称变化时自动生成编码
watch(() => form.value.shortName, (val) => {
  validateProjectShortName(val)
  if (val && !projectCodeManuallyEdited.value) {
    form.value.projectCode = generateProjectCode(val)
  }
})

// ========================
// 联动逻辑
// ========================
function onPortfolioSelect(portfolioId: number | null) {
  form.value.portfolioId = portfolioId
  if (portfolioId) {
    const pf = portfolioStore.portfolios.find(p => p.id === portfolioId)
    if (pf?.domainCode) {
      form.value.domainCode = pf.domainCode
      const domain = businessDomains.value.find(d => d.domainCode === pf.domainCode)
      if (domain) {
        projectDomainCategory.value = domain.category as '2G' | '2B' | '2C'
      }
    }
  }
}

function onDeptChange(deptCode: string | null) {
  form.value.deptCode = deptCode || ''
  deptError.value = ''
  // 部门变更时，如果当前负责人不在新部门中则清空
  if (deptCode && form.value.leaderUid) {
    const inDept = accountUsers.value.some(u => u.uid === form.value.leaderUid && u.deptCode === deptCode)
    if (!inDept) {
      form.value.leaderUid = ''
      resetProposalDocumentSelection()
    }
  }
}

function onLeaderChange(uid: string | null) {
  form.value.leaderUid = uid
  leaderError.value = ''
  resetProposalDocumentSelection()
}

// ========================
const deptError = ref('')
const leaderError = ref('')
const dateError = ref('')

// 提交
// ========================
async function handleSubmit() {
  if (!canCreateProjects.value) {
    toast.add({ title: '需要 AIMS 项目管理权限才可以创建项目', color: 'warning' })
    return
  }

  const { name, shortName, projectCode } = form.value
  if (!name || !shortName || !projectCode) return

  validateProjectShortName(shortName)
  if (projectShortNameError.value) return

  if (!selectedProposalDocument.value) {
    proposalDocumentError.value = '请先关联项目立项书'
    return
  }

  if (!form.value.deptCode) {
    deptError.value = '请选择所属部门'
    return
  }
  if (!form.value.leaderUid) {
    leaderError.value = '请选择负责人'
    return
  }
  if (!form.value.startDate) {
    dateError.value = '请选择开始日期'
    return
  }
  if (!form.value.endDate) {
    dateError.value = '请选择结束日期'
    return
  }

  const namePattern = /^[\u4e00-\u9fa5a-zA-Z0-9]+(?:V\d+)?$/
  if (!namePattern.test(name)) {
    projectNameError.value = '只能包含汉字、英文和数字，不允许空格和特殊字符'
    return
  }
  if (/[^A-Z0-9]/i.test(projectCode)) {
    projectCodeError.value = '只能包含英文字母和数字，不允许特殊字符'
    return
  }

  if (projectNameError.value || projectCodeError.value) return

  await checkDuplicate()
  if (projectNameError.value || projectCodeError.value) return

  creating.value = true
  try {
    const payload: CreateProjectRequest = {
      ...form.value,
      category: isPortfolioProductLine.value ? 'product_dev' : form.value.category,
      templateVersionId: selectedTemplateVersionId.value || undefined,
      excludedWorkItemKeys: excludedWorkItemKeys.value.size > 0 ? [...excludedWorkItemKeys.value] : undefined
    }
    const project = await projectStore.createProject(payload)

    // 绑定项目立项书
    await $fetch(`/api/v1/projects/${project.id}/documents`, {
      method: 'POST',
      body: {
        documentId: selectedProposalDocument.value.uuid,
        title: selectedProposalDocument.value.title
      }
    })

    // 跳转到项目设置页，可直接发起立项审批
    await navigateTo(`/projects/${project.id}/settings`)
  } finally {
    creating.value = false
  }
}

// ========================
// 初始化：读取 query 参数
// ========================
onMounted(async () => {
  if (!permissionsLoaded.value) {
    await loadPermissions()
  }
  if (!canCreateProjects.value) {
    toast.add({ title: '需要 AIMS 项目管理权限才可以创建项目', color: 'warning' })
    await navigateTo('/projects', { replace: true })
    return
  }

  // 确保项目集列表已加载
  if (portfolioStore.portfolios.length === 0) {
    await portfolioStore.fetchPortfolios()
  }

  const queryPortfolioId = route.query.portfolioId
  if (queryPortfolioId) {
    const id = Number(queryPortfolioId)
    if (!isNaN(id)) {
      form.value.portfolioId = id
      portfolioLocked.value = true
      // 联动业务领域
      const pf = portfolioStore.portfolios.find(p => p.id === id)
      if (pf?.domainCode) {
        form.value.domainCode = pf.domainCode
        const domain = businessDomains.value.find(d => d.domainCode === pf.domainCode)
        if (domain) projectDomainCategory.value = domain.category as '2G' | '2B' | '2C'
      }
    }
  }
})
</script>

<template>
  <UDashboardPanel
    id="project-new"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <!-- Top bar -->
        <div class="shrink-0 border-b border-default px-6 py-3 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-semibold">
              项目立项
            </h1>
            <p class="text-sm text-muted mt-1 max-w-xl">
              填写项目的基本信息和交付标准，创建后可在设置页发起立项审批
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              label="创建项目"
              color="primary"
              icon="i-lucide-send"
              :loading="creating"
              :disabled="!canCreateProjects || !form.name || !form.projectCode"
              @click="handleSubmit"
            />
            <UButton
              icon="i-lucide-arrow-left"
              label="返回项目总览"
              color="neutral"
              variant="ghost"
              @click="navigateTo('/projects')"
            />
          </div>
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-12">
          <div class="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6">
            <!-- Left: Basic info -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-file-text" class="w-4 h-4 text-primary" />
                  <span class="font-semibold">基本信息</span>
                </div>
              </template>

              <div class="space-y-5">
                <UFormField label="项目名称" required :error="projectNameError">
                  <UInput
                    v-model="form.name"
                    placeholder="汉字+英文+数字，可选版本号如V2"
                    class="w-full"
                  />
                </UFormField>

                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="项目简称" required :error="projectShortNameError">
                    <UInput
                      v-model="form.shortName"
                      placeholder="如：汇智云(不超过6个汉字)"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField label="内部代号">
                    <UInput
                      v-model="(form.internalCode as string)"
                      placeholder="如：Project-X（可选）"
                      class="w-full"
                    />
                  </UFormField>
                </div>

                <UFormField
                  label="项目编码"
                  required
                  :error="projectCodeError"
                  description="根据项目简称自动生成，可手动修改"
                >
                  <UInput
                    :model-value="form.projectCode"
                    placeholder="自动生成"
                    class="w-full font-mono"
                    @update:model-value="onProjectCodeInput"
                  />
                </UFormField>

                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="所属项目集">
                    <USelect
                      :model-value="form.portfolioId ?? null"
                      :items="portfolioAssignOptions"
                      value-key="value"
                      placeholder="选择项目集（可选）"
                      class="w-full"
                      :disabled="portfolioLocked"
                      @update:model-value="onPortfolioSelect($event)"
                    />
                  </UFormField>
                  <UFormField label="项目类别">
                    <div class="space-y-2">
                      <USelect
                        v-model="(form.category as ProjectCategory)"
                        :items="categoryOptions"
                        value-key="value"
                        placeholder="选择项目类别"
                        class="w-full"
                        :disabled="isPortfolioProductLine"
                      />
                      <p
                        v-if="isPortfolioProductLine"
                        class="text-xs text-primary"
                      >
                        当前项目集已设为产品线，项目类别自动固定为"产品研发"。
                      </p>
                    </div>
                  </UFormField>
                </div>

                <UFormField label="业务领域">
                  <div class="space-y-2">
                    <URadioGroup
                      v-model="projectDomainCategory"
                      :items="domainCategoryItems"
                      orientation="horizontal"
                      size="sm"
                    />
                    <USelectMenu
                      v-model="(form.domainCode as string)"
                      :items="projectDomainOptions"
                      value-key="value"
                      label-key="label"
                      placeholder="选择业务领域"
                      class="w-full"
                      searchable
                    />
                  </div>
                </UFormField>

                <UFormField label="项目描述">
                  <UTextarea
                    v-model="(form.description as string)"
                    placeholder="输入项目描述"
                    class="w-full"
                    :rows="3"
                  />
                </UFormField>

                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="所属部门" required :error="deptError">
                    <USelectMenu
                      :model-value="form.deptCode || undefined"
                      :items="departmentOptions"
                      value-key="value"
                      label-key="label"
                      placeholder="选择部门"
                      class="w-full"
                      searchable
                      @update:model-value="onDeptChange"
                    />
                  </UFormField>
                  <UFormField label="负责人" required :error="leaderError">
                    <USelectMenu
                      :model-value="form.leaderUid ?? undefined"
                      :items="userOptions"
                      :filter-fields="['label', 'uid']"
                      value-key="value"
                      label-key="label"
                      placeholder="请先选择部门"
                      class="w-full"
                      searchable
                      :disabled="!form.deptCode"
                      @update:model-value="onLeaderChange"
                    >
                      <template #item-label="{ item }">
                        {{ item.label }}
                        <span
                          v-if="item.uid"
                          class="text-muted text-xs"
                        >({{ item.uid }})</span>
                      </template>
                    </USelectMenu>
                  </UFormField>
                </div>

                <UFormField label="可见范围">
                  <div class="space-y-3 rounded-lg border border-default px-3 py-3">
                    <USelect
                      v-model="form.securityLevel"
                      :items="projectSecurityLevelOptions"
                      value-key="value"
                      class="w-full"
                    />
                    <p class="text-xs text-muted">
                      {{ selectedSecurityLevelConfig.description }}
                    </p>
                    <UserTreeSelector
                      v-if="form.securityLevel === 'whitelist'"
                      v-model="accessWhitelist"
                      placeholder="选择白名单用户"
                      width-class="w-full"
                    />
                  </div>
                </UFormField>

                <div class="grid grid-cols-2 gap-4">
                  <UFormField label="开始日期" required :error="dateError && !form.startDate ? '请选择开始日期' : ''">
                    <UInput
                      v-model="(form.startDate as string)"
                      type="date"
                      class="w-full"
                      @update:model-value="dateError = ''"
                    />
                  </UFormField>
                  <UFormField label="结束日期" required :error="dateError && !form.endDate ? '请选择结束日期' : ''">
                    <UInput
                      v-model="(form.endDate as string)"
                      type="date"
                      class="w-full"
                      @update:model-value="dateError = ''"
                    />
                  </UFormField>
                </div>

                <UFormField
                  label="关联项目立项书"
                  required
                  description="必须从项目负责人所在部门的文档列表中选择"
                  :error="proposalDocumentError"
                >
                  <div class="space-y-3">
                    <div v-if="selectedProposalDocument" class="rounded-lg border border-default bg-elevated/40 p-3 space-y-2">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <button
                            type="button"
                            class="text-sm font-medium text-primary hover:underline break-all text-left cursor-pointer"
                            @click="showProposalPreviewModal = true"
                          >
                            {{ selectedProposalDocument.title }}
                          </button>
                          <p class="mt-1 text-xs text-muted">
                            所属部门：{{ selectedProposalDocument.deptCode || '未标记' }} · 更新于 {{ formatDateTime(selectedProposalDocument.updatedAt) }}
                          </p>
                        </div>
                        <div class="flex items-center gap-2 shrink-0">
                          <UButton
                            label="查看"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            @click="showProposalPreviewModal = true"
                          />
                          <UButton
                            label="更换"
                            color="primary"
                            variant="soft"
                            size="xs"
                            @click="openProposalDocumentModal"
                          />
                        </div>
                      </div>
                      <p v-if="selectedProposalDocument.aiAbstract" class="text-xs text-muted leading-6">
                        {{ selectedProposalDocument.aiAbstract }}
                      </p>
                    </div>

                    <UButton
                      v-else
                      label="关联项目立项书"
                      icon="i-lucide-file-search"
                      color="primary"
                      variant="soft"
                      @click="openProposalDocumentModal"
                    />
                  </div>
                </UFormField>
              </div>
            </UCard>

            <!-- Right: Template preview -->
            <UCard>
              <template #header>
                <div class="flex items-center justify-between gap-3">
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-layers-3" class="w-4 h-4 text-warning" />
                    <span class="font-semibold">项目模板</span>
                  </div>
                  <USelect
                    :model-value="selectedTemplateVersionId ?? undefined"
                    :items="templateVersions.map(item => ({ label: `${item.templateSetName} / ${item.versionLabel}`, value: item.id }))"
                    value-key="value"
                    placeholder="选择模板版本"
                    class="w-64"
                    :loading="templateVersionLoading"
                    @update:model-value="selectedTemplateVersionId = $event ?? null"
                  />
                </div>
              </template>

              <div v-if="templateVersionError" class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                {{ templateVersionError }}
              </div>

              <div v-else-if="templateVersionLoading" class="flex justify-center py-8">
                <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
              </div>

              <div v-else-if="!selectedTemplateVersionDetail" class="text-center py-8 text-sm text-muted">
                当前项目类别没有可用的已发布模板版本
              </div>

              <div v-else class="space-y-6">
                <div class="rounded-lg border border-default bg-elevated/40 p-3 text-sm">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="font-medium">
                        {{ selectedTemplateVersionDetail.templateSetName }}
                      </div>
                      <div class="text-xs text-muted">
                        版本 {{ selectedTemplateVersionDetail.versionLabel }}
                      </div>
                    </div>
                    <UBadge color="success" variant="subtle" size="xs">
                      已发布
                    </UBadge>
                  </div>
                  <p v-if="selectedTemplateVersionDetail.notes" class="mt-2 text-xs text-muted leading-6">
                    {{ selectedTemplateVersionDetail.notes }}
                  </p>
                </div>

                <div
                  v-for="stage in stages"
                  :key="stage"
                >
                  <div
                    v-if="getTemplateMilestonesForStage(stage).length > 0"
                    class="space-y-3"
                  >
                    <div class="flex items-center gap-2">
                      <UBadge
                        :color="(pivrPhases[stage].color as any)"
                        variant="subtle"
                        size="sm"
                      >
                        {{ stage }}
                      </UBadge>
                      <span class="text-sm font-medium">{{ pivrPhases[stage].label }}</span>
                      <span class="text-xs text-muted">{{ pivrPhases[stage].description }}</span>
                    </div>

                    <div class="space-y-3 ml-2">
                      <div
                        v-for="milestone in getTemplateMilestonesForStage(stage)"
                        :key="milestone.key"
                        class="rounded-lg border border-default p-3 space-y-3"
                      >
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-sm">{{ milestone.name }}</span>
                          <UBadge color="neutral" variant="subtle" size="xs">
                            {{ milestone.mode }}
                          </UBadge>
                        </div>

                        <div v-if="milestone.workItems.length === 0" class="text-xs text-muted">
                          当前阶段未配置工作项模板
                        </div>

                        <div v-else class="space-y-2">
                          <div class="flex items-center gap-2">
                            <span class="text-xs text-muted">工作项 {{ milestone.workItems.length }} 个</span>
                          </div>
                          <div
                            v-for="workItem in milestone.workItems"
                            :key="workItem.key"
                            class="rounded-lg border px-3 py-2 space-y-2"
                            :class="isWorkItemSelected(workItem.key) ? 'border-default/70' : 'border-default/40 opacity-50'"
                          >
                            <div class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                class="rounded border-default text-primary focus:ring-primary"
                                :checked="isWorkItemSelected(workItem.key)"
                                :disabled="workItem.required"
                                @change="toggleWorkItemSelection(workItem.key, workItem.required)"
                              >
                              <span class="text-sm font-medium">{{ workItem.title }}</span>
                              <UBadge color="neutral" variant="subtle" size="xs">
                                {{ workItem.type }}
                              </UBadge>
                              <UBadge
                                v-if="workItem.required"
                                color="error"
                                variant="subtle"
                                size="xs"
                              >
                                必选
                              </UBadge>
                            </div>
                            <p v-if="workItem.description" class="text-xs text-muted">
                              {{ workItem.description }}
                            </p>
                            <div class="space-y-1">
                              <div
                                v-for="deliverable in workItem.deliverables"
                                :key="deliverable.key"
                                class="flex items-start gap-2 text-xs"
                              >
                                <span class="font-medium text-default">{{ deliverable.name }}</span>
                                <UBadge color="neutral" variant="subtle" size="xs">
                                  {{ deliverableTypeLabel[deliverable.deliverableType] || deliverable.deliverableType }}
                                </UBadge>
                                <UBadge
                                  :color="deliverable.required ? 'error' : 'neutral'"
                                  variant="subtle"
                                  size="xs"
                                >
                                  {{ deliverable.required ? '必交' : '可交' }}
                                </UBadge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="selectedTemplateVersionDetail.definition.milestones.length === 0"
                  class="text-center py-4 text-sm text-muted"
                >
                  当前模板版本尚未配置任何里程碑
                </div>
              </div>
            </UCard>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="showProposalDocumentModal" :ui="{ content: 'sm:max-w-5xl' }">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-file-search" class="size-5 text-primary" />
        <h3 class="text-lg font-semibold">
          关联项目立项书
        </h3>
      </div>
    </template>
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField
          label="部门文档"
          description="显示项目负责人所属部门下的目录和文档，目录仅用于定位"
        >
          <USelectMenu
            :model-value="draftProposalDocumentUuid || undefined"
            :items="proposalDocumentOptions"
            value-key="value"
            label-key="label"
            placeholder="选择项目立项书"
            class="w-full"
            searchable
            :loading="proposalDocumentLoading"
            @update:model-value="onProposalDocumentChange"
          />
        </UFormField>

        <p v-if="proposalDocumentLoadError" class="text-sm text-error">
          {{ proposalDocumentLoadError }}
        </p>
        <p v-else-if="!proposalDocumentLoading && proposalDepartmentDocuments.length === 0" class="text-sm text-muted">
          当前负责人所属部门暂无可选文档。
        </p>

        <div class="rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
          <div v-if="proposalDocumentPreviewLoading" class="flex items-center justify-center py-10 text-muted">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
          </div>
          <div v-else-if="proposalDocumentPreviewError" class="text-sm text-error">
            {{ proposalDocumentPreviewError }}
          </div>
          <div v-else-if="draftProposalDocumentSummary" class="h-96">
            <div v-if="proposalDocumentEmbedLoading" class="flex items-center justify-center h-full text-muted bg-elevated/20">
              <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
            </div>
            <CodocsPreview
              v-if="draftProposalDocumentSummary?.uuid"
              :key="draftProposalDocumentSummary.uuid"
              :uuid="draftProposalDocumentSummary.uuid"
              @vue:mounted="proposalDocumentEmbedLoading = false"
            />
          </div>
          <div v-else class="flex items-center justify-center py-10 text-sm text-muted">
            选择文档后将在这里显示预览摘要。
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="showProposalDocumentModal = false"
        />
        <UButton
          label="确定绑定"
          color="primary"
          :disabled="!draftProposalDocumentUuid"
          @click="confirmProposalDocumentSelection"
        />
      </div>
    </template>
  </UModal>

  <!-- 立项书预览弹窗 -->
  <UModal v-model:open="showProposalPreviewModal" :ui="{ content: 'sm:max-w-5xl', body: 'overflow-hidden p-0' }">
    <template #header>
      <span class="text-base font-medium">{{ selectedProposalDocument?.title || '立项书预览' }}</span>
    </template>
    <template #body>
      <div class="h-[70vh]">
        <CodocsPreview
          v-if="selectedProposalDocument?.uuid && showProposalPreviewModal"
          :key="selectedProposalDocument.uuid"
          :uuid="selectedProposalDocument.uuid"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton
          label="关闭"
          color="neutral"
          variant="soft"
          @click="showProposalPreviewModal = false"
        />
      </div>
    </template>
  </UModal>
</template>
