<template>
  <UModal
    v-model:open="isOpen"
    title="发布文档"
    description="发布前须进行审阅审批，选择审阅类型并提交文档进行审批"
    :ui="{ content: 'sm:max-w-2xl min-h-150', footer: 'justify-end' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <!-- 审阅类型选择 -->
        <UFormField label="发布类型" required>
          <USelectMenu
            v-model="selectedType"
            :items="reviewTypes"
            placeholder="请选择发布类型"
            class="w-full"
            @update:model-value="onTypeChange"
          />
        </UFormField>

        <!-- 子类型选择（仅内部公文） -->
        <UFormField v-if="selectedType === '公司发文'" label="公文类型" required>
          <USelectMenu
            v-model="selectedSubType"
            :items="companySubTypes"
            placeholder="请选择公文类型"
            class="w-full"
            @update:model-value="loadTemplate"
          />
        </UFormField>

        <UFormField v-if="selectedType === '部门发文'" label="文档类型" required>
          <USelectMenu
            v-model="selectedSubType"
            :items="departmentSubTypes"
            placeholder="请选择文档类型"
            class="w-full"
            @update:model-value="loadTemplate"
          />
        </UFormField>

        <!-- 对外发文额外字段 -->
        <template v-if="selectedType === '对外发文'">
          <UFormField label="发送给" required>
            <UInput v-model="sendTo" placeholder="请输入收文单位或个人" class="w-full" />
          </UFormField>
          <UFormField label="发文事由" required>
            <UTextarea
              v-model="sendReason"
              placeholder="请简要说明发文事由"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="是否需要加盖公章">
            <UCheckbox
              v-model="needsOfficialSeal"
              label="需要加盖公章"
              description="仅重要文件或关键文件可申请加盖公章；确认发布后将通过企业微信通知总经理办公室成员"
            />
          </UFormField>

          <template v-if="isDynamicOutsideReview">
            <UFormField label="文件级别" required>
              <URadioGroup
                v-model="outsideFileLevel"
                :items="outsideFileLevelOptions"
                orientation="horizontal"
              />
            </UFormField>

            <UAlert
              v-if="needsBusinessDepartment && eligibleBusinessDepartments.length === 0"
              color="warning"
              icon="i-lucide-triangle-alert"
              title="缺少可选业务部门"
              description="当前没有可用的业务部门（deptCategory=3），暂时无法发起对外发文。"
            />

            <UFormField v-else-if="needsBusinessDepartment" label="业务部门" required>
              <template v-if="eligibleBusinessDepartments.length > 1">
                <USelectMenu
                  v-model="selectedBusinessDeptCode"
                  :items="eligibleBusinessDepartments"
                  value-key="deptCode"
                  label-key="name"
                  placeholder="请选择业务部门"
                  class="w-full"
                />
              </template>
              <template v-else>
                <div class="rounded-lg border border-default bg-elevated px-3 py-2 text-sm">
                  {{ selectedBusinessDept?.name || '暂无可用业务部门' }}
                </div>
              </template>
            </UFormField>

            <UFormField v-if="outsideFileLevel === 'critical'" label="审批委员会" required>
              <USelectMenu
                v-model="selectedCommitteeDeptCode"
                :items="committeeDepartments"
                value-key="deptCode"
                label-key="name"
                placeholder="请选择委员会"
                class="w-full"
              />
            </UFormField>
          </template>
        </template>

        <!-- 委员会内审模式 -->
        <template v-if="showCommitteeMode">
          <UFormField label="内审模式" required>
            <USelectMenu
              v-model="committeeMode"
              :items="committeeModeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <!-- 协助审查：设置审阅人数 -->
          <UFormField v-if="committeeMode === 'assist'" label="审阅人数">
            <div class="flex items-center gap-3">
              <UInput
                v-model.number="assistReviewerCount"
                type="number"
                :min="1"
                :max="maxAssistCount"
                class="w-24"
              />
              <span class="text-sm text-gray-500">
                人（最多 {{ maxAssistCount }} 人，由系统随机分配）
              </span>
            </div>
          </UFormField>

          <!-- 会签：选择表决方式 -->
          <UFormField v-if="committeeMode === 'vote'" label="表决方式">
            <USelectMenu
              v-model="voteType"
              :items="voteTypeOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <!-- 内审说明 -->
          <div class="border rounded-lg p-3 bg-blue-50 dark:bg-blue-900/20 text-sm text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-info" class="inline mr-1" />
            <template v-if="committeeMode === 'assist'">
              将从委员会 {{ memberCount }} 名成员中随机选取 {{ assistReviewerCount }} 人进行协助审查，全部通过后进入下一环节。
            </template>
            <template v-else>
              委员会全部 {{ memberCount }} 名成员参与投票表决，需
              {{ voteType === 'majority' ? '半数以上' : '三分之二以上' }}
              （{{ votePassCount }}/{{ memberCount }}）通过后进入下一环节。
            </template>
          </div>
        </template>

        <!-- 流程预览 -->
        <div v-if="isDynamicOutsideReview" class="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
          <h4 class="text-sm font-medium mb-3">
            审批流程预览
          </h4>
          <div class="space-y-2">
            <div v-for="(node, index) in outsideFlowNodes" :key="index" class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-circle" class="text-gray-400" />
              <span class="font-medium">{{ node }}</span>
            </div>
          </div>
          <div class="mt-3 text-sm text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-info" class="inline" />
            归档目标：部门文档 / 对外发文
          </div>
        </div>

        <div v-else-if="template" class="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
          <h4 class="text-sm font-medium mb-3">
            审批流程预览
          </h4>
          <div class="space-y-2">
            <div v-for="(node, index) in template.nodes" :key="index" class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-circle" class="text-gray-400" />
              <span class="font-medium">{{ node.name }}</span>
              <span class="text-gray-500">
                ({{ getRoleLabel(node.role) }} - {{ getPassTypeLabel(node) }})
              </span>
            </div>
          </div>
          <div class="mt-3 text-sm text-gray-600 dark:text-gray-400">
            <UIcon name="i-lucide-info" class="inline" />
            归档目标：{{ getCategoryLabel(template.target_category) }}
          </div>
        </div>

        <!-- 无预设模板时显示默认流程提示 -->
        <UAlert
          v-if="!loading && !template && selectedType && (!requiresSubType || selectedSubType) && !isDynamicOutsideReview"
          color="info"
          icon="i-lucide-info"
          title="将使用默认审批流程"
          :description="isCommittee
            ? '提交后将先进行委员会内审，通过后进入逐级领导审批'
            : '该审阅类型未配置专用流程，提交后将按逐级领导审批模式处理（部门经理 → 分管领导 → 上级部门）'"
        />

        <!-- 加载状态 -->
        <div v-if="loading" class="flex items-center justify-center py-4">
          <UIcon name="i-lucide-loader-2" class="animate-spin" />
          <span class="ml-2 text-sm text-gray-500">加载中...</span>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton
          color="primary"
          :disabled="!canSubmit || submitting"
          :loading="submitting"
          @click="handleSubmit"
        >
          确认提交
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
type OutsideFileLevel = 'general' | 'important' | 'critical'

const props = defineProps<{
  open: boolean
  documentUuid: string
  deptCode?: string
  docSource?: 'project' | 'department'
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const { user } = useAuth()

const allReviewTypes = [
  '对外发文',
  '部门发文',
  '公司发文'
]

interface DeptOption {
  deptCode: string
  name: string
  orgType?: string
  deptCategory?: number | null
  managerId?: string | null
  leaderId?: string | null
  parentId?: string | null
}

interface DeptInfoResponse {
  code: number
  data: {
    orgType: string | null
    deptCategory: number | null
    memberCount: number
    managerId?: string | null
    leaderId?: string | null
    parentId?: string | null
  }
}

interface DeptListResponse {
  code: number
  data?: {
    flat?: DeptOption[]
  }
}

const currentDeptInfo = ref<DeptInfoResponse['data'] | null>(null)
const allDepartments = ref<DeptOption[]>([])

const supportsOutsideReview = computed(() => {
  if (isCommittee.value) return true
  return currentDeptInfo.value?.orgType === 'department' && (currentDeptInfo.value?.deptCategory ?? 0) >= 2
})

const reviewTypes = computed(() => {
  return supportsOutsideReview.value ? allReviewTypes : allReviewTypes.filter(t => t !== '对外发文')
})

const companySubTypes = ['通知公告', '公司制度', '法务合规', '企业文化', '技术规范', '产品资料', '公司知识库', '文档模板']
const departmentSubTypes = ['会议记录', '部门规章']

interface Node {
  name: string
  role: string
  pass_type: string
  pass_count: number
  pass_total?: number
}

interface ReviewTemplate {
  id: number
  name: string
  review_type: string
  sub_type?: string
  target_category: string
  nodes: Node[]
  status: number
}

interface WorkflowLaunchPayloadResponse {
  appCode: string
  resourceCode: string
  actionCode: string
  bizId: string
  bizTitle: string
  bizUrl?: string
  bizContext?: Record<string, unknown>
  formData?: Record<string, unknown>
  callbackUrl?: string
}

interface PublishRequestResponse {
  data: {
    publish_request: {
      id: number
      workflow_status: string
    }
    workflowLaunchPayload: WorkflowLaunchPayloadResponse
  }
}

interface WorkflowCreateInstanceData {
  id?: number | string | null
  instance_id?: number | string | null
  instanceId?: number | string | null
  workflow_instance_id?: number | string | null
  instance_no?: string | null
  instanceNo?: string | null
  workflow_instance_no?: string | null
  status?: string | null
  data?: WorkflowCreateInstanceData | null
}

const selectedType = ref<string>('')
const selectedSubType = ref<string>('')
const sendTo = ref('')
const sendReason = ref('')
const needsOfficialSeal = ref(false)
const outsideFileLevel = ref<OutsideFileLevel>('general')
const selectedBusinessDeptCode = ref<string>('')
const selectedCommitteeDeptCode = ref<string>('')
const template = ref<ReviewTemplate | null>(null)
const loading = ref(false)
const submitting = ref(false)

const resolveWorkflowCreateData = (response: unknown): WorkflowCreateInstanceData => {
  const root = response as { data?: WorkflowCreateInstanceData | null } | null
  const data = root?.data || {}
  return data.data || data
}

const normalizePositiveNumber = (value: unknown) => {
  const numeric = Number(value || 0)
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0
}

// 委员会相关
const isCommittee = ref(false)
const memberCount = ref(0)

const committeeModeOptions = [
  { label: '协助审查', value: 'assist' },
  { label: '会签', value: 'vote' }
]
const committeeMode = ref<'assist' | 'vote'>('assist')

const assistReviewerCount = ref(2)
const maxAssistCount = computed(() => Math.max(1, Math.floor(memberCount.value / 2)))

const voteTypeOptions = [
  { label: '一般表决（半数以上通过）', value: 'majority' },
  { label: '2/3表决（三分之二以上通过）', value: 'supermajority' }
]
const voteType = ref<'majority' | 'supermajority'>('majority')

const votePassCount = computed(() => {
  if (voteType.value === 'supermajority') {
    return Math.ceil(memberCount.value * 2 / 3)
  }
  return Math.ceil(memberCount.value / 2)
})

const requiresSubType = computed(() => selectedType.value === '公司发文' || selectedType.value === '部门发文')
const isDynamicOutsideReview = computed(() => selectedType.value === '对外发文' && currentDeptInfo.value?.orgType === 'department' && (currentDeptInfo.value?.deptCategory ?? 0) >= 2)
const showCommitteeMode = computed(() => isCommittee.value && selectedType.value && (!requiresSubType.value || !!selectedSubType.value))
const needsBusinessDepartment = computed(() => isDynamicOutsideReview.value && currentDeptInfo.value?.deptCategory === 2)

const eligibleBusinessDepartments = computed(() =>
  allDepartments.value.filter(d => d.orgType === 'department' && d.deptCategory === 3)
)

const committeeDepartments = computed(() =>
  allDepartments.value.filter(d => d.orgType === 'committee')
)

const selectedBusinessDept = computed(() =>
  eligibleBusinessDepartments.value.find(d => d.deptCode === selectedBusinessDeptCode.value) || null
)

const selectedCommitteeDept = computed(() =>
  committeeDepartments.value.find(d => d.deptCode === selectedCommitteeDeptCode.value) || null
)

const outsideFileLevelOptions = [
  { label: '一般文件', value: 'general' },
  { label: '重要文件', value: 'important' },
  { label: '关键文件', value: 'critical' }
]

const outsideFlowNodes = computed(() => {
  if (!isDynamicOutsideReview.value) return []

  const nodes: string[] = []
  const currentDept = currentDeptInfo.value
  const currentUser = user.value || ''
  const parentDept = currentDept?.parentId
    ? allDepartments.value.find(d => d.deptCode === currentDept.parentId) || null
    : null
  const hasSupervisor = Boolean(currentDept?.leaderId)
  const hasUpperLeader = Boolean(parentDept?.leaderId || parentDept?.managerId)

  if (currentDept?.managerId) {
    nodes.push(currentDept.managerId === currentUser ? '部门经理审核（本人发文跳过）' : '部门经理审核')
  }

  if (needsBusinessDepartment.value) {
    nodes.push(`${selectedBusinessDept.value?.name || '业务部门'}经理审核`)
  }

  if (outsideFileLevel.value === 'critical') {
    nodes.push(`${selectedCommitteeDept.value?.name || '委员会'}审批（过半通过）`)
  }

  if (hasSupervisor) {
    nodes.push('分管领导审核')
  }

  if ((outsideFileLevel.value === 'important' || outsideFileLevel.value === 'critical') && hasUpperLeader) {
    nodes.push('上级领导审批')
  }

  nodes.push('审批结束')

  if (outsideFileLevel.value === 'general') {
    nodes.push('企业微信通知上级部门领导')
  }

  return nodes
})

// 查询部门信息，判断是否委员会
const loadDeptInfo = async () => {
  if (!props.deptCode) {
    isCommittee.value = false
    currentDeptInfo.value = null
    return
  }
  try {
    const res = await $fetch<DeptInfoResponse>('/api/account/department-info', {
      params: { deptCode: props.deptCode }
    })
    if (res.code === 0 && res.data) {
      currentDeptInfo.value = res.data
      isCommittee.value = res.data.orgType === 'committee'
      memberCount.value = res.data.memberCount || 0
      // 限制默认值不超过上限
      if (assistReviewerCount.value > maxAssistCount.value) {
        assistReviewerCount.value = Math.max(1, maxAssistCount.value)
      }
    }
  } catch (e) {
    console.warn('Failed to load department info:', e)
    isCommittee.value = false
    currentDeptInfo.value = null
  }
}

const loadDepartments = async () => {
  try {
    const res = await $fetch<DeptListResponse>('/api/account/departments')
    allDepartments.value = res.data?.flat || []
  } catch (e) {
    console.warn('Failed to load departments:', e)
    allDepartments.value = []
  }
}

// 允许提交的条件
const canSubmit = computed(() => {
  if (!selectedType.value) return false
  if (requiresSubType.value && !selectedSubType.value) return false
  if (selectedType.value === '对外发文' && (!sendTo.value.trim() || !sendReason.value.trim())) return false
  if (selectedType.value === '对外发文' && needsOfficialSeal.value && outsideFileLevel.value === 'general') return false
  if (needsBusinessDepartment.value && !selectedBusinessDeptCode.value) return false
  if (outsideFileLevel.value === 'critical' && isDynamicOutsideReview.value && !selectedCommitteeDeptCode.value) return false
  if (loading.value) return false
  return true
})

watch([needsOfficialSeal, outsideFileLevel], ([needsSeal, fileLevel]) => {
  if (needsSeal && fileLevel === 'general') {
    outsideFileLevel.value = 'important'
  }
})

const onTypeChange = () => {
  selectedSubType.value = ''
  if (selectedType.value === '对外发文') {
    template.value = null
  } else {
    loadTemplate()
  }
}

const loadTemplate = async () => {
  if (!selectedType.value) return
  if (selectedType.value === '对外发文') {
    template.value = null
    return
  }
  if (requiresSubType.value && !selectedSubType.value) return

  loading.value = true
  try {
    const { data } = await $fetch<{ data: ReviewTemplate[] }>('/api/reviews/templates', {
      query: { review_type: selectedType.value }
    })

    template.value = null
    if (data && data.length > 0) {
      if (requiresSubType.value) {
        template.value = data.find(
          (t: ReviewTemplate) => t.sub_type === selectedSubType.value && t.status === 1
        ) || null
      } else {
        template.value = data.find((t: ReviewTemplate) => !t.sub_type && t.status === 1) || null
      }

      if (template.value && typeof template.value.nodes === 'string') {
        template.value.nodes = JSON.parse(template.value.nodes)
      }
    }
  } catch (error) {
    console.error('Failed to load template:', error)
  } finally {
    loading.value = false
  }
}

const handleSubmit = async () => {
  if (!canSubmit.value || !props.documentUuid) return

  submitting.value = true
  try {
    if (selectedType.value === '对外发文' && needsOfficialSeal.value && outsideFileLevel.value === 'general') {
      toast.add({
        title: '提交失败',
        description: '加盖公章的对外发文，文件级别至少应为重要文件',
        color: 'error'
      })
      return
    }

    const body: Record<string, unknown> = {
      document_uuid: props.documentUuid,
      review_type: selectedType.value,
      sub_type: selectedSubType.value || null,
      target_category: template.value?.target_category || null
    }

    // 对外发文额外信息
    if (selectedType.value === '对外发文') {
      body.extra = {
        sendTo: sendTo.value.trim(),
        sendReason: sendReason.value.trim(),
        needsOfficialSeal: needsOfficialSeal.value,
        outsideFileLevel: outsideFileLevel.value,
        businessDeptCode: selectedBusinessDeptCode.value || null,
        businessDeptName: selectedBusinessDept.value?.name || null,
        committeeDeptCode: selectedCommitteeDeptCode.value || null,
        committeeDeptName: selectedCommitteeDept.value?.name || null
      }
    }

    // 委员会内审参数
    if (showCommitteeMode.value) {
      body.committee_mode = committeeMode.value
      if (committeeMode.value === 'assist') {
        body.committee_pass_count = assistReviewerCount.value
      } else {
        body.committee_vote_type = voteType.value
      }
    }

    const createRequestRes = await $fetch<PublishRequestResponse>('/api/reviews/publish-requests', {
      method: 'POST',
      body
    })

    const launchPayload = createRequestRes.data.workflowLaunchPayload
    const prepareRes = await prepareInstance({
      app_code: launchPayload.appCode,
      resource_code: launchPayload.resourceCode,
      action_code: launchPayload.actionCode,
      biz_id: launchPayload.bizId,
      biz_title: launchPayload.bizTitle,
      biz_url: launchPayload.bizUrl,
      biz_context: launchPayload.bizContext,
      form_data: launchPayload.formData
    })

    const prepareData = prepareRes.data as { action_def?: { id: number }, matched_routes?: Array<{ id: number }> } | null
    if (prepareRes.code !== 0 || !prepareData?.action_def?.id || !prepareData.matched_routes?.length) {
      throw new Error('发布申请已创建，但未找到匹配的审批流程，请联系管理员配置 Workflow 路由。')
    }

    const createInstanceRes = await createInstance({
      action_def_id: prepareData.action_def.id,
      route_id: prepareData.matched_routes[0]!.id,
      biz_id: launchPayload.bizId,
      biz_title: launchPayload.bizTitle,
      biz_url: launchPayload.bizUrl,
      biz_context: launchPayload.bizContext,
      form_data: launchPayload.formData,
      callback_url: launchPayload.callbackUrl
    })

    if (createInstanceRes.code !== 0) {
      throw new Error(createInstanceRes.message || '发起 Workflow 审批失败')
    }

    const workflowInstance = resolveWorkflowCreateData(createInstanceRes)
    const workflowInstanceId = normalizePositiveNumber(
      workflowInstance.instance_id || workflowInstance.instanceId || workflowInstance.workflow_instance_id || workflowInstance.id
    )
    if (!workflowInstanceId) {
      console.error('[PublishRequest] Workflow create response missing instance id:', createInstanceRes)
      throw new Error('Workflow 已返回成功，但缺少实例ID，无法回写发布申请')
    }
    const workflowInstanceNo = workflowInstance.instance_no || workflowInstance.instanceNo || workflowInstance.workflow_instance_no || ''

    await $fetch(`/api/reviews/publish-requests/${createRequestRes.data.publish_request.id}/workflow-instance`, {
      method: 'POST',
      body: {
        instanceId: workflowInstanceId,
        instanceNo: workflowInstanceNo,
        status: workflowInstance.status || 'running'
      }
    })

    toast.add({
      title: '提交成功',
      description: '文档已提交审批，审批人将在审批中心处理',
      color: 'success'
    })

    isOpen.value = false
    emit('success')
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '提交失败',
      description: error.data?.message || error.message || '提交审批失败',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}

const getRoleLabel = (role: string) => {
  const labels: Record<string, string> = {
    dept_manager: '部门经理',
    supervisor: '分管领导',
    admin: '管理员'
  }
  if (role.startsWith('committee:')) return '委员会成员'
  return labels[role] || role
}

const getPassTypeLabel = (node: Node) => {
  if (node.pass_type === 'all') return `需${node.pass_count}人通过`
  if (node.pass_type === 'any') return '任一人通过'
  if (node.pass_type === 'ratio') return `需${node.pass_count}/${node.pass_total}通过`
  return ''
}

const getCategoryLabel = (category: string) => {
  const labels: Record<string, string> = {
    company: '公司文档',
    department: '部门文档',
    product: '产品资料',
    knowledge: '公司知识库',
    template: '文档模板'
  }
  return labels[category] || category
}

// 校正审阅人数不超上限
watch(maxAssistCount, (max) => {
  if (assistReviewerCount.value > max) {
    assistReviewerCount.value = Math.max(1, max)
  }
})

watch([needsBusinessDepartment, eligibleBusinessDepartments], ([needsBusiness]) => {
  if (!needsBusiness) {
    selectedBusinessDeptCode.value = ''
    return
  }

  if (eligibleBusinessDepartments.value.length === 1) {
    selectedBusinessDeptCode.value = eligibleBusinessDepartments.value[0]!.deptCode
  } else if (!eligibleBusinessDepartments.value.find(d => d.deptCode === selectedBusinessDeptCode.value)) {
    selectedBusinessDeptCode.value = ''
  }
}, { immediate: true })

watch([outsideFileLevel, committeeDepartments], () => {
  if (outsideFileLevel.value !== 'critical') {
    selectedCommitteeDeptCode.value = ''
    return
  }

  if (committeeDepartments.value.length === 1) {
    selectedCommitteeDeptCode.value = committeeDepartments.value[0]!.deptCode
  } else if (!committeeDepartments.value.find(d => d.deptCode === selectedCommitteeDeptCode.value)) {
    selectedCommitteeDeptCode.value = ''
  }
}, { immediate: true })

watch(isOpen, (val) => {
  if (val) {
    selectedType.value = ''
    selectedSubType.value = ''
    sendTo.value = ''
    sendReason.value = ''
    needsOfficialSeal.value = false
    outsideFileLevel.value = 'general'
    selectedBusinessDeptCode.value = ''
    selectedCommitteeDeptCode.value = ''
    template.value = null
    committeeMode.value = 'assist'
    assistReviewerCount.value = 2
    voteType.value = 'majority'
    loadDeptInfo()
    loadDepartments()
  }
})
</script>
