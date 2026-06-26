<template>
  <UDashboardPanel grow>
    <div class="flex items-center justify-between px-4 py-2 border-b border-default">
      <UButton
        v-if="!isApprovalMode"
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        @click="navigateTo('/approval/tasks')"
      >
        返回审批中心
      </UButton>
      <div class="flex items-center gap-3">
        <h1 class="text-lg font-semibold truncate">
          {{ review?.document_title }}
        </h1>
        <WorkflowBadge
          v-if="review?.workflow_instance_id"
          :status="workflowBadgeStatus"
        />
        <UBadge v-else :color="getStatusColor(review?.status)">
          {{ getStatusLabel(review?.status) }}
        </UBadge>
        <UBadge color="info" variant="subtle">
          {{ review?.review_type }}
        </UBadge>
      </div>
      <div />
    </div>

    <div class="flex-1 overflow-hidden p-4">
      <div v-if="loading" class="flex items-center justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-3xl" />
      </div>

      <div v-else-if="review" class="h-full overflow-y-auto">
        <div class="mx-auto max-w-6xl space-y-4 pb-4">
          <!-- 审阅信息 -->
          <UCard>
            <template #header>
              <h3 class="font-semibold flex items-center gap-2">
                <UIcon name="i-lucide-info" />
                审阅信息
              </h3>
            </template>
            <div class="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
              <div>
                <span class="text-gray-600">发起人</span>
                <div class="mt-1 font-medium">
                  {{ getInitiatorDisplayName(review) }}
                </div>
              </div>
              <div>
                <span class="text-gray-600">提交时间</span>
                <div class="mt-1 font-medium">
                  {{ formatDate(review.created_at) }}
                </div>
              </div>
              <div>
                <span class="text-gray-600">归档目标</span>
                <div class="mt-1 font-medium">
                  {{ getCategoryLabel(review.target_category) }}
                </div>
              </div>
              <div v-if="review.execution_status">
                <span class="text-gray-600">执行状态</span>
                <div class="mt-1 font-medium">
                  {{ getExecutionStatusLabel(review.execution_status) }}
                </div>
              </div>
              <template v-if="reviewExtra">
                <div>
                  <span class="text-gray-600">发送给</span>
                  <div class="mt-1 font-medium">
                    {{ reviewExtra.sendTo }}
                  </div>
                </div>
                <div v-if="reviewExtra.outsideFileLevel">
                  <span class="text-gray-600">文件级别</span>
                  <div class="mt-1 font-medium">
                    {{ getOutsideFileLevelLabel(reviewExtra.outsideFileLevel) }}
                  </div>
                </div>
                <div>
                  <span class="text-gray-600">是否盖章</span>
                  <div class="mt-1 font-medium">
                    {{ reviewExtra.needsOfficialSeal ? '需要' : '不需要' }}
                  </div>
                </div>
                <div v-if="reviewExtra.businessDeptName">
                  <span class="text-gray-600">业务部门</span>
                  <div class="mt-1 font-medium">
                    {{ reviewExtra.businessDeptName }}
                  </div>
                </div>
                <div v-if="reviewExtra.committeeDeptName">
                  <span class="text-gray-600">审批委员会</span>
                  <div class="mt-1 font-medium">
                    {{ reviewExtra.committeeDeptName }}
                  </div>
                </div>
                <div v-if="reviewExtra.sendReason" class="md:col-span-3">
                  <span class="text-gray-600">发文事由</span>
                  <p class="mt-1 text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {{ reviewExtra.sendReason }}
                  </p>
                </div>
              </template>
            </div>
          </UCard>

          <!-- 文档内容 -->
          <UCard :ui="{ header: 'py-0', body: 'py-0' }">
            <template #header>
              <h3 class="font-semibold">
                文档内容
              </h3>
            </template>

            <div class="prose dark:prose-invert max-w-none">
              <ClientOnly>
                <div>
                  <EditorMilkdownEditor
                    v-if="documentContent"
                    :model-value="documentContent"
                    :show-sidebar="false"
                    readonly
                  />
                  <div v-else class="text-center py-8 text-gray-500">
                    加载文档内容...
                  </div>
                </div>
              </ClientOnly>
            </div>
          </UCard>

          <!-- 审批详情 -->
          <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <UCard v-if="review.workflow_instance_id && !isApprovalMode">
              <template #header>
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-git-branch" />
                  Workflow 审批
                </h3>
              </template>
              <WorkflowPanel :instance-id="review.workflow_instance_id" />
            </UCard>

            <!-- 旧链路流程图 -->
            <UCard v-else-if="!review.workflow_instance_id">
              <template #header>
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-git-branch" />
                  审批流程
                </h3>
              </template>

              <ReviewFlowChart
                :flow-snapshot="review.flow_snapshot"
                :current-node="review.current_node"
                :status="review.status"
                :actions="review.actions"
              />
            </UCard>

            <!-- 旧链路操作记录 -->
            <UCard v-if="!review.workflow_instance_id">
              <template #header>
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-history" />
                  操作记录
                </h3>
              </template>

              <ReviewTimeline :actions="review.actions" :flow-snapshot="review.flow_snapshot" />
            </UCard>

            <UCard v-if="review.seal_records?.length">
              <template #header>
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-stamp" />
                  盖章记录
                </h3>
              </template>

              <div class="space-y-3 text-sm">
                <div
                  v-for="item in review.seal_records"
                  :key="item.id"
                  class="rounded-lg border border-default bg-elevated/40 p-3 space-y-1.5"
                >
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">盖章人</span>
                    <span class="font-medium">{{ (item.operator_real_name && item.operator_real_name.trim()) || item.operator_uid }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">盖章类型</span>
                    <span>{{ item.seal_types.map(getSealTypeLabel).join('、') }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">文档页数</span>
                    <span>{{ item.page_count }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">确认时间</span>
                    <span>{{ formatDate(item.confirmed_at) }}</span>
                  </div>
                  <div v-if="item.remark" class="text-gray-700 dark:text-gray-300">
                    备注：{{ item.remark }}
                  </div>
                </div>
              </div>
            </UCard>

            <UCard v-if="review.send_records?.length">
              <template #header>
                <h3 class="font-semibold flex items-center gap-2">
                  <UIcon name="i-lucide-send" />
                  发送记录
                </h3>
              </template>

              <div class="space-y-3 text-sm">
                <div
                  v-for="item in review.send_records"
                  :key="item.id"
                  class="rounded-lg border border-default bg-elevated/40 p-3 space-y-1.5"
                >
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">发送人</span>
                    <span class="font-medium">{{ (item.sender_real_name && item.sender_real_name.trim()) || item.sender_uid }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">接收人</span>
                    <span>{{ item.receiver_name }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">联系电话</span>
                    <span>{{ item.receiver_phone }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">发送途径</span>
                    <span>{{ getSendChannelLabel(item.channel) }}</span>
                  </div>
                  <div v-if="item.sent_date" class="flex justify-between gap-4">
                    <span class="text-gray-600">发送日期</span>
                    <span>{{ formatDateOnly(item.sent_date) }}</span>
                  </div>
                  <div v-if="item.receive_date" class="flex justify-between gap-4">
                    <span class="text-gray-600">接收日期</span>
                    <span>{{ formatDateOnly(item.receive_date) }}</span>
                  </div>
                  <div v-if="item.target_account" class="flex justify-between gap-4">
                    <span class="text-gray-600">对方账号</span>
                    <span>{{ item.target_account }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-600">确认时间</span>
                    <span>{{ formatDate(item.confirmed_at) }}</span>
                  </div>
                  <div v-if="item.received_confirmed_at" class="flex justify-between gap-4">
                    <span class="text-gray-600">接收确认时间</span>
                    <span>{{ formatDate(item.received_confirmed_at) }}</span>
                  </div>
                  <div v-if="item.remark" class="text-gray-700 dark:text-gray-300">
                    备注：{{ item.remark }}
                  </div>
                </div>
              </div>
            </UCard>

            <!-- 操作按钮 -->
            <UCard v-if="showActions && review.status !== 'archived'">
              <template #header>
                <h3 class="font-semibold">
                  操作
                </h3>
              </template>

              <div class="space-y-2">
                <!-- 审阅人操作 -->
                <template v-if="isReviewer && review.status === 'in_progress'">
                  <UButton
                    block
                    color="success"
                    icon="i-lucide-check"
                    @click="showApproveModal = true"
                  >
                    通过
                  </UButton>
                  <UButton
                    block
                    color="error"
                    variant="outline"
                    icon="i-lucide-x"
                    @click="showRejectModal = true"
                  >
                    驳回
                  </UButton>
                </template>

                <!-- 发起人操作 -->
                <template v-if="isInitiator">
                  <!-- 发送提醒 -->
                  <UButton
                    v-if="review.status === 'in_progress'"
                    block
                    color="info"
                    variant="outline"
                    icon="i-lucide-bell"
                    :loading="reminding"
                    @click="handleRemind"
                  >
                    发送提醒
                  </UButton>

                  <!-- 重新提交 -->
                  <UButton
                    v-if="review.status === 'rejected'"
                    block
                    color="primary"
                    icon="i-lucide-refresh-cw"
                    :loading="resubmitting"
                    @click="handleResubmit"
                  >
                    重新提交
                  </UButton>

                  <!-- 确认发布 -->
                  <UButton
                    v-if="review.status === 'approved'"
                    block
                    color="primary"
                    icon="i-lucide-archive"
                    @click="showArchiveModal = true"
                  >
                    确认发布
                  </UButton>
                </template>
              </div>
            </UCard>
          </div>
        </div>
      </div>
    </div>

    <!-- 通过弹窗 -->
    <UModal v-model:open="showApproveModal" title="审阅通过" description="确认通过该文档的审阅">
      <template #body>
        <div class="space-y-4 p-4">
          <p class="text-sm text-gray-600">
            确认通过该文档的审阅吗？
          </p>
          <UTextarea
            v-model="approveComment"
            placeholder="填写审阅意见（可选）"
            :rows="3"
            class="w-full"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="showApproveModal = false">
            取消
          </UButton>
          <UButton color="success" :loading="approving" @click="handleApprove">
            确认通过
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 驳回弹窗 -->
    <UModal v-model:open="showRejectModal" title="审阅驳回" description="请填写驳回原因">
      <template #body>
        <div class="space-y-4 p-4">
          <p class="text-sm text-gray-600">
            请填写驳回原因：
          </p>
          <UTextarea
            v-model="rejectReason"
            placeholder="请详细说明驳回原因"
            :rows="4"
            required
          />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="outline" @click="showRejectModal = false">
            取消
          </UButton>
          <UButton
            color="error"
            :disabled="!rejectReason"
            :loading="rejecting"
            @click="handleReject"
          >
            确认驳回
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- 归档弹窗 -->
    <ReviewArchiveConfirmModal
      v-if="review"
      v-model:open="showArchiveModal"
      :review-id="review.id"
      @success="handleArchiveSuccess"
    />
  </UDashboardPanel>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'default'
})

usePageTitle('审阅详情')

interface ReviewAction {
  node_index: number
  actor_uid: string
  action: string
  created_at: string
  comment?: string | null
  [key: string]: unknown
}

interface FlowNode {
  index: number
  name: string
  reviewers: string[]
  [key: string]: unknown
}

interface ReviewDetail {
  id: number
  document_uuid: string
  document_title: string
  review_type: string
  status: string
  workflow_status?: string
  workflow_instance_id?: number | null
  workflow_instance_no?: string | null
  execution_status?: string | null
  published_document_uuid?: string | null
  initiator_uid: string
  initiator_real_name?: string | null
  target_category: string
  current_node: number
  flow_snapshot: FlowNode[]
  actions: ReviewAction[]
  seal_records?: Array<{
    id: number
    seal_types: string[]
    page_count: number
    operator_uid: string
    operator_real_name?: string | null
    remark?: string | null
    confirmed_at: string
  }>
  send_records?: Array<{
    id: number
    sender_uid: string
    sender_real_name?: string | null
    receiver_name: string
    receiver_phone: string
    channel: string
    sent_date?: string | null
    receive_date?: string | null
    target_account?: string | null
    remark?: string | null
    confirmed_at: string
    received_confirmed_at?: string | null
  }>
  extra?: string | Record<string, unknown>
  created_at: string
}

const route = useRoute()
const toast = useToast()
const { user } = useAuth()
const { isApprovalMode } = useApprovalMode()

const reviewId = computed(() => route.params.id as string)

const loading = ref(true)
const review = ref<ReviewDetail | null>(null)
const documentContent = ref('')
const workflowBadgeStatus = computed(() => {
  return (review.value?.workflow_status || review.value?.status || null) as 'running' | 'approved' | 'rejected' | 'cancelled' | 'suspended' | null
})

const showApproveModal = ref(false)
const showRejectModal = ref(false)
const showArchiveModal = ref(false)

const approveComment = ref('')
const rejectReason = ref('')

const approving = ref(false)
const rejecting = ref(false)
const reminding = ref(false)
const resubmitting = ref(false)

// 解析 extra JSON
const reviewExtra = computed(() => {
  if (!review.value?.extra) return null
  const e = typeof review.value.extra === 'string' ? JSON.parse(review.value.extra) : review.value.extra
  return e?.sendTo
    ? e as {
      sendTo: string
      sendReason?: string
      needsOfficialSeal?: boolean
      outsideFileLevel?: string
      businessDeptName?: string | null
      committeeDeptName?: string | null
    }
    : null
})

const getOutsideFileLevelLabel = (level?: string | null) => {
  const labels: Record<string, string> = {
    general: '一般文件',
    important: '重要文件',
    critical: '关键文件'
  }
  return level ? (labels[level] || level) : '-'
}

const getInitiatorDisplayName = (detail: Pick<ReviewDetail, 'initiator_uid' | 'initiator_real_name'>) => {
  return detail.initiator_real_name || detail.initiator_uid
}

// 是否是审阅人
const isReviewer = computed(() => {
  if (!review.value || !user.value) return false
  if (review.value.status !== 'in_progress') return false

  const currentNode = review.value.flow_snapshot[review.value.current_node]
  return currentNode?.reviewers?.includes(user.value)
})

// 是否是发起人
const isInitiator = computed(() => {
  if (!review.value || !user.value) return false
  return review.value.initiator_uid === user.value
})

// 是否显示操作区
const showActions = computed(() => {
  if (review.value?.workflow_instance_id) {
    return isInitiator.value && review.value.status === 'approved'
  }
  return isReviewer.value || isInitiator.value
})

// 加载审阅详情
const loadReview = async () => {
  loading.value = true
  try {
    const { data } = await $fetch<{ data: ReviewDetail }>(`/api/reviews/${reviewId.value}`)
    review.value = data

    // 加载文档内容
    if (data.document_uuid) {
      try {
        const docRes = await $fetch<{ success: boolean, data: { content: string } }>(`/api/documents/${data.document_uuid}`)
        if (docRes.success && docRes.data) {
          documentContent.value = docRes.data.content || ''
        }
      } catch (error) {
        console.error('Failed to load document content:', error)
      }
    }
  } catch (error) {
    console.error('Failed to load review:', error)
    toast.add({
      title: '加载失败',
      description: '无法加载审阅详情',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

// 通过
const handleApprove = async () => {
  approving.value = true
  try {
    await $fetch(`/api/reviews/${reviewId.value}/approve`, {
      method: 'POST',
      body: {
        comment: approveComment.value || null
      }
    })

    toast.add({
      title: '操作成功',
      description: '审阅通过',
      color: 'success'
    })

    showApproveModal.value = false
    approveComment.value = ''
    await loadReview()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '操作失败',
      description: error.data?.message || '审阅通过失败',
      color: 'error'
    })
  } finally {
    approving.value = false
  }
}

// 驳回
const handleReject = async () => {
  if (!rejectReason.value) return

  rejecting.value = true
  try {
    await $fetch(`/api/reviews/${reviewId.value}/reject`, {
      method: 'POST',
      body: {
        comment: rejectReason.value
      }
    })

    toast.add({
      title: '操作成功',
      description: '审阅已驳回',
      color: 'success'
    })

    showRejectModal.value = false
    rejectReason.value = ''
    await loadReview()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '操作失败',
      description: error.data?.message || '驳回失败',
      color: 'error'
    })
  } finally {
    rejecting.value = false
  }
}

// 发送提醒
const handleRemind = async () => {
  reminding.value = true
  try {
    await $fetch(`/api/reviews/${reviewId.value}/remind`, {
      method: 'POST'
    })

    toast.add({
      title: '提醒已发送',
      description: '已向审阅人发送提醒消息',
      color: 'success'
    })
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '发送失败',
      description: error.data?.message || '发送提醒失败',
      color: 'error'
    })
  } finally {
    reminding.value = false
  }
}

// 重新提交
const handleResubmit = async () => {
  resubmitting.value = true
  try {
    await $fetch(`/api/reviews/${reviewId.value}/resubmit`, {
      method: 'POST'
    })

    toast.add({
      title: '重新提交成功',
      description: '文档已重新提交审阅',
      color: 'success'
    })

    await loadReview()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string } }
    toast.add({
      title: '提交失败',
      description: error.data?.message || '重新提交失败',
      color: 'error'
    })
  } finally {
    resubmitting.value = false
  }
}

// 归档成功
const handleArchiveSuccess = () => {
  toast.add({
    title: '归档成功',
    description: '文档已归档到目标栏目',
    color: 'success'
  })
  loadReview()
}

// 辅助函数
const getStatusColor = (status?: string): 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | undefined => {
  if (!status) return 'neutral'
  const colors: Record<string, 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'> = {
    pending: 'neutral',
    in_progress: 'info',
    draft: 'neutral',
    running: 'info',
    approved: 'success',
    rejected: 'error',
    archived: 'primary'
  }
  return colors[status] || 'neutral'
}

const getStatusLabel = (status?: string) => {
  if (!status) return '未知'
  const labels: Record<string, string> = {
    pending: '待处理',
    in_progress: '审阅中',
    draft: '草稿',
    running: '审批中',
    approved: '已通过',
    rejected: '已驳回',
    archived: '已发布'
  }
  return labels[status] || status
}

const getCategoryLabel = (category?: string) => {
  if (!category) return '未知'
  const labels: Record<string, string> = {
    company: '公司文档',
    department: '部门文档',
    product: '产品资料',
    knowledge: '知识库',
    template: '文档模板'
  }
  return labels[category] || category
}

const getExecutionStatusLabel = (status?: string | null) => {
  const labels: Record<string, string> = {
    pending_seal: '待盖章',
    pending_send: '待发送',
    pending_receive: '待接收',
    sent: '已发送',
    received: '已接收'
  }
  return status ? (labels[status] || status) : '-'
}

const getSealTypeLabel = (type: string) => {
  const labels: Record<string, string> = {
    official: '公章',
    legal: '法人章',
    finance: '财务章',
    contract: '合同章'
  }
  return labels[type] || type
}

const getSendChannelLabel = (channel: string) => {
  const labels: Record<string, string> = {
    email: '邮件',
    wecom: '企业微信',
    wechat_qq: '微信/QQ',
    web_upload: '网页上传',
    sf_express: '顺丰快递',
    other_courier: '其他快递',
    other_method: '其他方式',
    usb: 'U盘'
  }
  return labels[channel] || channel
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDateOnly = (date: string) => {
  if (!date) return ''
  const value = new Date(`${date}T00:00:00`)
  if (Number.isNaN(value.getTime())) return date
  return value.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

// 初始加载
onMounted(() => {
  loadReview()
})
</script>
