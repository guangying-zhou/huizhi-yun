<template>
  <UModal v-model:open="isOpen" title="发布审批与执行过程" :ui="{ content: 'sm:max-w-xl' }">
    <template #body>
      <div class="p-4">
        <div v-if="loading" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
        </div>

        <div v-else-if="!record" class="text-center py-8 text-gray-500">
          暂无发布记录
        </div>

        <div v-else class="space-y-4">
          <!-- 基本信息 -->
          <div class="space-y-2 text-sm">
            <div class="flex justify-between">
              <span class="text-gray-500">源文档</span>
              <span class="font-medium">{{ record.source_title }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">审阅类型</span>
              <span>{{ record.review_type }}{{ record.sub_type ? ` / ${record.sub_type}` : '' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">发起人</span>
              <span>{{ getInitiatorDisplayName(record) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">提交时间</span>
              <span>{{ formatDate(record.created_at) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-gray-500">归档时间</span>
              <span>{{ formatDate(record.updated_at) }}</span>
            </div>
            <div v-if="record.execution_status" class="flex justify-between">
              <span class="text-gray-500">执行状态</span>
              <span>{{ getExecutionStatusLabel(record.execution_status) }}</span>
            </div>
          </div>

          <USeparator />

          <!-- 审批流程 -->
          <div>
            <h4 class="text-sm font-medium mb-2">
              审批流程
            </h4>
            <div class="space-y-2">
              <div
                v-for="(node, index) in record.flow_snapshot"
                :key="index"
                class="flex items-center gap-2 text-sm"
              >
                <UIcon name="i-lucide-check-circle" class="text-green-500 shrink-0" />
                <span class="font-medium">{{ node.name }}</span>
                <span class="text-gray-400">—</span>
                <span class="text-gray-500">
                  {{ node.reviewers?.map(getUserDisplayName).join('、') }}
                </span>
              </div>
            </div>
          </div>

          <!-- 操作记录 -->
          <template v-if="record.actions?.length">
            <USeparator />
            <div>
              <h4 class="text-sm font-medium mb-2">
                操作记录
              </h4>
              <div class="space-y-2">
                <div v-for="(action, i) in record.actions" :key="i" class="text-sm flex items-start gap-2">
                  <UIcon
                    :name="action.action === 'approve' ? 'i-lucide-check' : action.action === 'reject' ? 'i-lucide-x' : 'i-lucide-bell'"
                    :class="action.action === 'approve' ? 'text-green-500' : action.action === 'reject' ? 'text-red-500' : 'text-blue-500'"
                    class="shrink-0 mt-0.5"
                  />
                  <div>
                    <span class="font-medium">{{ getUserDisplayName(action.actor_uid) }}</span>
                    <span class="text-gray-500 mx-1">{{ getActionLabel(action.action) }}</span>
                    <span v-if="action.comment" class="text-gray-600">「{{ action.comment }}」</span>
                    <div class="text-xs text-gray-400">
                      {{ formatDate(action.created_at) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="record.seal_records?.length">
            <USeparator />
            <div>
              <h4 class="text-sm font-medium mb-2">
                盖章记录
              </h4>
              <div class="space-y-3">
                <div
                  v-for="item in record.seal_records"
                  :key="item.id"
                  class="rounded-lg border border-default bg-elevated/40 p-3 text-sm space-y-1"
                >
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">盖章人</span>
                    <span class="font-medium">{{ getUserDisplayName(item.operator_uid) }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">盖章类型</span>
                    <span>{{ item.seal_types.map(getSealTypeLabel).join('、') }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">文档页数</span>
                    <span>{{ item.page_count }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">确认时间</span>
                    <span>{{ formatDate(item.confirmed_at) }}</span>
                  </div>
                  <div v-if="item.remark" class="text-gray-600">
                    备注：{{ item.remark }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="record.send_records?.length">
            <USeparator />
            <div>
              <h4 class="text-sm font-medium mb-2">
                发送记录
              </h4>
              <div class="space-y-3">
                <div
                  v-for="item in record.send_records"
                  :key="item.id"
                  class="rounded-lg border border-default bg-elevated/40 p-3 text-sm space-y-1"
                >
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">发送人</span>
                    <span class="font-medium">{{ getUserDisplayName(item.sender_uid) }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">接收人</span>
                    <span>{{ item.receiver_name }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">联系电话</span>
                    <span>{{ item.receiver_phone }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">发送途径</span>
                    <span>{{ getSendChannelLabel(item.channel) }}</span>
                  </div>
                  <div v-if="item.sent_date" class="flex justify-between gap-4">
                    <span class="text-gray-500">发送日期</span>
                    <span>{{ formatDateOnly(item.sent_date) }}</span>
                  </div>
                  <div v-if="item.receive_date" class="flex justify-between gap-4">
                    <span class="text-gray-500">接收日期</span>
                    <span>{{ formatDateOnly(item.receive_date) }}</span>
                  </div>
                  <div v-if="item.target_account" class="flex justify-between gap-4">
                    <span class="text-gray-500">对方账号</span>
                    <span>{{ item.target_account }}</span>
                  </div>
                  <div class="flex justify-between gap-4">
                    <span class="text-gray-500">确认时间</span>
                    <span>{{ formatDate(item.confirmed_at) }}</span>
                  </div>
                  <div v-if="item.received_confirmed_at" class="flex justify-between gap-4">
                    <span class="text-gray-500">接收确认时间</span>
                    <span>{{ formatDate(item.received_confirmed_at) }}</span>
                  </div>
                  <div v-if="item.remark" class="text-gray-600">
                    备注：{{ item.remark }}
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface ReviewFlowNode {
  name: string
  reviewers?: string[]
}

interface ReviewActionRecord {
  actor_uid: string
  action: string
  comment?: string | null
  created_at: string
}

interface SealRecord {
  id: number
  seal_types: string[]
  page_count: number
  operator_uid: string
  remark?: string | null
  confirmed_at: string
}

interface SendRecord {
  id: number
  sender_uid: string
  receiver_name: string
  receiver_phone: string
  channel: string
  sent_date?: string | null
  receive_date?: string | null
  target_account?: string | null
  remark?: string | null
  confirmed_at: string
  received_confirmed_at?: string | null
}

interface PublishRecord {
  id: number
  source_title: string
  review_type: string
  sub_type?: string | null
  execution_status?: string | null
  initiator_uid: string
  initiator_real_name?: string | null
  created_at: string
  updated_at: string
  flow_snapshot: ReviewFlowNode[]
  actions?: ReviewActionRecord[]
  seal_records?: SealRecord[]
  send_records?: SendRecord[]
}

interface PublishRecordResponse {
  code: number
  data: PublishRecord | null
}

const props = defineProps<{
  open: boolean
  ossPath: string
  documentUuid?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const accountStore = useAccountStore()
const loading = ref(false)
const record = ref<PublishRecord | null>(null)

const getUserDisplayName = (uid?: string | null) => {
  const normalized = String(uid || '').trim()
  if (!normalized) return ''
  return accountStore.getUserByUid(normalized)?.realName || normalized
}

const loadUserProfiles = async (data: PublishRecord) => {
  const uidSet = new Set<string>()

  if (data.initiator_uid) uidSet.add(data.initiator_uid)
  data.flow_snapshot.forEach(node => (node.reviewers || []).forEach(uid => uid && uidSet.add(uid)))
  data.actions?.forEach(action => action.actor_uid && uidSet.add(action.actor_uid))
  data.seal_records?.forEach(item => item.operator_uid && uidSet.add(item.operator_uid))
  data.send_records?.forEach(item => item.sender_uid && uidSet.add(item.sender_uid))

  if (uidSet.size > 0) {
    await accountStore.fetchUsersBatch(Array.from(uidSet))
  }
}

const loadRecord = async () => {
  loading.value = true
  try {
    record.value = null

    if (props.ossPath) {
      const res = await $fetch<PublishRecordResponse>('/api/reviews/by-oss-path', {
        params: { path: props.ossPath }
      })
      if (res.data) {
        record.value = res.data
        await loadUserProfiles(res.data)
        return
      }
    }

    if (props.documentUuid) {
      const res = await $fetch<PublishRecordResponse>(`/api/reviews/by-document/${props.documentUuid}`)
      record.value = res.data
      if (res.data) {
        await loadUserProfiles(res.data)
      }
    }
  } catch (e) {
    console.error('Failed to load publish record:', e)
    record.value = null
  } finally {
    loading.value = false
  }
}

const formatDate = (date: string) => {
  if (!date) return ''
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

const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    approve: '通过',
    reject: '驳回',
    remind: '发送提醒'
  }
  return labels[action] || action
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

const getInitiatorDisplayName = (item: Pick<PublishRecord, 'initiator_uid' | 'initiator_real_name'>) => {
  return item.initiator_real_name || item.initiator_uid
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

watch(isOpen, (val) => {
  if (val) loadRecord()
})
</script>
