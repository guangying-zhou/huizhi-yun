<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => String(route.params.id || ''))

const TENDER_STATUS: Record<string, { label: string, color: string }> = {
  info_gathering: { label: '信息收集', color: 'neutral' },
  qualification: { label: '资格审查', color: 'info' },
  bid_preparation: { label: '标书编制', color: 'primary' },
  bid_submitted: { label: '投标提交', color: 'warning' },
  bid_opening: { label: '开标评标', color: 'warning' },
  won: { label: '中标', color: 'success' },
  lost: { label: '落标', color: 'error' },
  review_done: { label: '已复盘', color: 'neutral' },
  abandoned: { label: '已放弃', color: 'neutral' }
}

const STATUS_FLOW = ['info_gathering', 'qualification', 'bid_preparation', 'bid_submitted', 'bid_opening']

const MEMBER_ROLE: Record<string, string> = {
  pm: '项目经理', business: '商务', presales: '售前', technical: '技术', finance: '财务', member: '成员'
}

const TENDER_TYPE: Record<string, string> = {
  open: '公开招标', invited: '邀请招标', negotiation: '竞争性谈判', single_source: '单一来源', inquiry: '询价'
}

const MILESTONE_STATUS: Record<string, { label: string, color: string }> = {
  todo: { label: '待办', color: 'neutral' },
  in_progress: { label: '进行中', color: 'primary' },
  done: { label: '已完成', color: 'success' },
  overdue: { label: '已逾期', color: 'error' }
}

const LOST_REASON_TYPE: Record<string, string> = {
  price: '价格', technical: '技术方案', qualification: '资质不足', relationship: '客户关系', other: '其他'
}

interface TenderDetail {
  id: number
  code: string
  name: string
  status: string
  customer_id?: number | null
  customer_name?: string | null
  opportunity_id?: number | null
  opportunity_name?: string | null
  budget_amount?: number | null
  bid_amount?: number | null
  bid_bond_amount?: number | null
  bid_submission_deadline?: string | null
  bid_opening_date?: string | null
  owner_user_id?: string | null
  presales_user_id?: string | null
  tenderer_name?: string | null
  project_code?: string | null
  tender_type?: string | null
  lost_to?: string | null
  lost_to_amount?: number | null
  lost_reason_type?: string | null
  lost_reason_detail?: string | null
  review_by?: string | null
  publish_date?: string | null
  milestones?: Array<{ id: number, name: string, status: string, due_date?: string | null, assignee_user_id?: string | null }>
  members?: Array<{ id: number, user_id: string, role: string }>
  [key: string]: unknown
}

function apiErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

const { data: tender, status, refresh } = useFetch(() => `/api/v1/tenders/${id.value}`, {
  transform: (res: { data: TenderDetail }) => res.data
})

function tenderApiPath() {
  return `/api/v1/tenders/${id.value}`
}

const activeTab = ref('milestones')
const tabs = [
  { label: '关键节点', value: 'milestones', icon: 'i-lucide-list-checks' },
  { label: '团队', value: 'team', icon: 'i-lucide-users' },
  { label: '基本信息', value: 'info', icon: 'i-lucide-info' },
  { label: '文档', value: 'documents', icon: 'i-lucide-file-text' }
]

function formatMoney(val: number | null | undefined) {
  if (val == null) return '--'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0 }).format(val)
}

// 状态流转
const currentStatusIndex = computed(() => STATUS_FLOW.indexOf(tender.value?.status || ''))
const isActive = computed(() => !['won', 'lost', 'review_done', 'abandoned'].includes(tender.value?.status || ''))

async function changeStatus(newStatus: string) {
  try {
    await $fetch(tenderApiPath(), { method: 'PUT', body: { status: newStatus } })
    toast.add({ title: '状态已更新', color: 'success' })
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// 中标
async function markWon() {
  const amount = prompt('请输入中标金额')
  if (amount === null) return
  try {
    await $fetch(tenderApiPath(), {
      method: 'PUT',
      body: { status: 'won', winning_amount: Number(amount) || null }
    })
    toast.add({ title: '已标记中标，商机需继续推进到待签合同或赢单', color: 'success' })
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// 落标复盘弹窗
const showReviewModal = ref(false)
const reviewForm = reactive({
  lost_to: '',
  lost_to_amount: null as number | null,
  lost_reason_type: undefined as string | undefined,
  lost_reason_detail: '',
  improvement_suggestion: ''
})

const lostReasonOptions = Object.entries(LOST_REASON_TYPE).map(([v, l]) => ({ label: l, value: v }))

async function submitReview() {
  if (!reviewForm.lost_reason_type) {
    toast.add({ title: '请选择落标原因', color: 'error' })
    return
  }
  try {
    await $fetch(tenderApiPath(), {
      method: 'PUT',
      body: {
        status: 'review_done',
        ...reviewForm,
        review_by: useAuth().user.value
      }
    })
    toast.add({ title: '复盘已提交；如需关闭商机，请在商机页执行输单流转', color: 'success' })
    showReviewModal.value = false
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// 添加节点弹窗
const showMilestoneModal = ref(false)
const milestoneForm = reactive({ name: '', due_date: '', assignee_user_id: '', remark: '' })

async function addMilestone() {
  if (!milestoneForm.name.trim()) {
    toast.add({ title: '请输入节点名称', color: 'error' })
    return
  }
  try {
    await $fetch(`/api/v1/tenders/${id.value}/milestones`, { method: 'POST', body: milestoneForm })
    toast.add({ title: '节点添加成功', color: 'success' })
    showMilestoneModal.value = false
    milestoneForm.name = ''
    milestoneForm.due_date = ''
    milestoneForm.assignee_user_id = ''
    milestoneForm.remark = ''
    refresh()
  } catch {
    toast.add({ title: '添加失败', color: 'error' })
  }
}

async function updateMilestoneStatus(msId: number, newStatus: string) {
  try {
    await $fetch(`/api/v1/tenders/${id.value}/milestones`, { method: 'PUT', body: { milestone_id: msId, status: newStatus } })
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}

// 添加成员弹窗
const showMemberModal = ref(false)
const memberForm = reactive({ user_id: '', role: 'member' })
const roleOptions = Object.entries(MEMBER_ROLE).map(([v, l]) => ({ label: l, value: v }))

async function addMember() {
  if (!memberForm.user_id.trim()) {
    toast.add({ title: '请选择用户', color: 'error' })
    return
  }
  try {
    await $fetch(`/api/v1/tenders/${id.value}/members`, { method: 'POST', body: memberForm })
    toast.add({ title: '添加成功', color: 'success' })
    showMemberModal.value = false
    memberForm.user_id = ''
    memberForm.role = 'member'
    refresh()
  } catch (err: unknown) {
    toast.add({ title: apiErrorMessage(err, '添加失败'), color: 'error' })
  }
}

async function removeMember(memberId: number) {
  if (!confirm('确定移除？')) return
  try {
    await $fetch(`/api/v1/tenders/${id.value}/members`, { method: 'DELETE', body: { member_id: memberId } })
    refresh()
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="tender-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/tenders')"
        />
        <div v-if="tender" class="flex items-center gap-2">
          <span class="font-semibold">{{ tender.name }}</span>
          <UBadge :color="(TENDER_STATUS[tender.status]?.color || 'neutral') as any" variant="subtle" size="sm">
            {{ TENDER_STATUS[tender.status]?.label || tender.status }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ tender.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <template v-if="tender && isActive">
          <UButton
            v-if="tender.status === 'bid_opening'"
            label="中标"
            icon="i-lucide-trophy"
            color="success"
            @click="markWon"
          />
          <UButton
            v-if="tender.status === 'bid_opening'"
            label="落标"
            icon="i-lucide-x-circle"
            variant="soft"
            color="error"
            @click="changeStatus('lost')"
          />
          <UButton
            v-if="currentStatusIndex >= 0 && currentStatusIndex < STATUS_FLOW.length - 1"
            :label="'推进到' + TENDER_STATUS[STATUS_FLOW[currentStatusIndex + 1]!]?.label"
            variant="soft"
            color="primary"
            @click="changeStatus(STATUS_FLOW[currentStatusIndex + 1]!)"
          />
          <UButton
            label="放弃"
            variant="ghost"
            color="neutral"
            size="sm"
            @click="changeStatus('abandoned')"
          />
        </template>
        <UButton
          v-if="tender?.status === 'lost'"
          label="提交复盘"
          icon="i-lucide-clipboard-check"
          color="warning"
          @click="showReviewModal = true"
        />
        <UButton
          v-if="tender?.status === 'won'"
          label="转为合同"
          icon="i-lucide-file-signature"
          color="primary"
          @click="router.push(`/contracts/new?customer_id=${tender.customer_id}&opportunity_id=${tender.opportunity_id || ''}`)"
        />
      </Teleport>

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="tender" class="p-4 space-y-4">
        <!-- 阶段进度条 -->
        <UCard v-if="isActive || tender.status === 'won'">
          <div class="flex items-center gap-1">
            <div
              v-for="(s, idx) in STATUS_FLOW"
              :key="s"
              class="flex-1 text-center py-2 px-2 text-xs rounded transition-colors"
              :class="{
                'bg-primary text-white': idx === currentStatusIndex,
                'bg-primary/20 text-primary': idx < currentStatusIndex,
                'bg-success text-white': tender.status === 'won',
                'bg-elevated text-muted': idx > currentStatusIndex && tender.status !== 'won'
              }"
            >
              {{ TENDER_STATUS[s]?.label }}
            </div>
            <div
              class="flex-1 text-center py-2 px-2 text-xs rounded"
              :class="tender.status === 'won' ? 'bg-success text-white' : tender.status === 'lost' || tender.status === 'review_done' ? 'bg-error/20 text-error' : 'bg-elevated text-muted'"
            >
              {{ tender.status === 'won' ? '中标' : tender.status === 'lost' || tender.status === 'review_done' ? '落标' : '结果' }}
            </div>
          </div>
        </UCard>

        <!-- 摘要卡片 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold font-mono">
                {{ formatMoney(tender.budget_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                项目预算
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold font-mono">
                {{ formatMoney(tender.bid_amount) }}
              </div>
              <div class="text-xs text-muted mt-1">
                投标金额
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold text-sm">
                {{ tender.bid_submission_deadline || '--' }}
              </div>
              <div class="text-xs text-muted mt-1">
                投标截止
              </div>
            </div>
          </UCard>
          <UCard>
            <div class="text-center">
              <div class="text-xl font-bold text-sm">
                {{ tender.bid_opening_date || '--' }}
              </div>
              <div class="text-xs text-muted mt-1">
                开标日期
              </div>
            </div>
          </UCard>
        </div>

        <!-- 落标复盘结果展示 -->
        <UCard v-if="tender.status === 'review_done'" class="border-error/20">
          <template #header>
            <span class="font-semibold text-sm text-error">落标复盘</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
            <div class="flex">
              <span class="text-muted w-24 shrink-0">中标方</span><span>{{ tender.lost_to || '-' }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">中标金额</span><span class="font-mono">{{ formatMoney(tender.lost_to_amount) }}</span>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">落标原因</span><UBadge color="error" variant="subtle" size="xs">
                {{ LOST_REASON_TYPE[tender.lost_reason_type || ''] || tender.lost_reason_type || '-' }}
              </UBadge>
            </div>
            <div class="flex">
              <span class="text-muted w-24 shrink-0">复盘人</span><UserName :uid="tender.review_by" />
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-24 shrink-0">详细分析</span><span>{{ tender.lost_reason_detail || '-' }}</span>
            </div>
            <div class="flex md:col-span-2">
              <span class="text-muted w-24 shrink-0">改进建议</span><span>{{ tender.improvement_suggestion || '-' }}</span>
            </div>
          </div>
        </UCard>

        <UTabs v-model="activeTab" :items="tabs" class="w-full" />

        <!-- 关键节点 -->
        <UCard v-if="activeTab === 'milestones'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">关键节点 ({{ tender.milestones?.length || 0 }})</span>
              <UButton
                v-if="isActive"
                label="添加节点"
                icon="i-lucide-plus"
                size="sm"
                variant="soft"
                @click="showMilestoneModal = true"
              />
            </div>
          </template>
          <div v-if="tender.milestones?.length" class="space-y-2">
            <div v-for="ms in tender.milestones" :key="ms.id" class="flex items-center justify-between p-3 rounded-lg border border-default">
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <button
                  v-if="isActive"
                  class="w-5 h-5 rounded-full border-2 shrink-0 transition-colors"
                  :class="ms.status === 'done' ? 'bg-success border-success' : 'border-default hover:border-primary'"
                  @click="updateMilestoneStatus(ms.id, ms.status === 'done' ? 'todo' : 'done')"
                />
                <UIcon v-else :name="ms.status === 'done' ? 'i-lucide-check-circle' : 'i-lucide-circle'" :class="ms.status === 'done' ? 'text-success' : 'text-muted'" />
                <div class="min-w-0">
                  <div class="text-sm font-medium" :class="ms.status === 'done' ? 'line-through text-muted' : ''">
                    {{ ms.name }}
                  </div>
                  <div class="flex items-center gap-2 text-xs text-muted">
                    <span v-if="ms.due_date">截止：{{ ms.due_date }}</span>
                    <span v-if="ms.assignee_user_id">负责：<UserName :uid="ms.assignee_user_id" /></span>
                  </div>
                </div>
              </div>
              <UBadge :color="(MILESTONE_STATUS[ms.status]?.color || 'neutral') as any" variant="subtle" size="xs">
                {{ MILESTONE_STATUS[ms.status]?.label || ms.status }}
              </UBadge>
            </div>
          </div>
          <div v-else class="text-center py-6 text-muted text-sm">
            暂无关键节点
          </div>
        </UCard>

        <!-- 团队 -->
        <UCard v-if="activeTab === 'team'">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold text-sm">投标团队 ({{ tender.members?.length || 0 }})</span>
              <UButton
                label="添加成员"
                icon="i-lucide-user-plus"
                size="sm"
                variant="soft"
                @click="showMemberModal = true"
              />
            </div>
          </template>
          <div v-if="tender.members?.length" class="space-y-2">
            <div v-for="m in tender.members" :key="m.id" class="flex items-center justify-between p-2 rounded hover:bg-elevated">
              <div class="flex items-center gap-2">
                <UserName :uid="m.user_id" />
                <UBadge :color="m.role === 'pm' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                  {{ MEMBER_ROLE[m.role] || m.role }}
                </UBadge>
              </div>
              <UButton
                icon="i-lucide-user-minus"
                variant="ghost"
                color="error"
                size="xs"
                @click="removeMember(m.id)"
              />
            </div>
          </div>
          <div v-else class="text-center py-6 text-muted text-sm">
            暂无团队成员
          </div>
        </UCard>

        <!-- 基本信息 -->
        <div v-if="activeTab === 'info'" class="space-y-4">
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">基本信息</span>
            </template>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
              <div class="flex">
                <span class="text-muted w-28 shrink-0">客户</span>
                <NuxtLink v-if="tender.customer_id" :to="`/customers/${tender.customer_id}`" class="text-primary hover:underline">{{ tender.customer_name }}</NuxtLink>
                <span v-else>-</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">关联商机</span>
                <NuxtLink v-if="tender.opportunity_id" :to="`/opportunities/${tender.opportunity_id}`" class="text-primary hover:underline">{{ tender.opportunity_name }}</NuxtLink>
                <span v-else>-</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">招标人</span><span>{{ tender.tenderer_name || tender.customer_name || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">项目编号(甲方)</span><span>{{ tender.project_code || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">招标类型</span><span>{{ TENDER_TYPE[tender.tender_type || ''] || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">投标保证金</span><span class="font-mono">{{ formatMoney(tender.bid_bond_amount) }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">负责人</span><UserName :uid="tender.owner_user_id" />
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">售前负责人</span><UserName :uid="tender.presales_user_id" />
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">招标公告日期</span><span>{{ tender.publish_date || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">报名截止</span><span>{{ tender.registration_deadline || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-28 shrink-0">中标通知日期</span><span>{{ tender.winning_notice_date || '-' }}</span>
              </div>
              <div class="flex md:col-span-2">
                <span class="text-muted w-28 shrink-0">关键要求</span><span>{{ tender.key_requirements || '-' }}</span>
              </div>
              <div class="flex md:col-span-2">
                <span class="text-muted w-28 shrink-0">竞争对手</span><span>{{ tender.competitors || '-' }}</span>
              </div>
            </div>
          </UCard>

          <!-- 客户联系人 -->
          <UCard v-if="tender.contact_name_val || tender.contact_phone || tender.contact_email">
            <template #header>
              <span class="font-semibold text-sm">客户联系人</span>
            </template>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-y-3 gap-x-8 text-sm">
              <div class="flex">
                <span class="text-muted w-20 shrink-0">联系人</span><span>{{ tender.contact_name_val || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">电话</span><span>{{ tender.contact_phone || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">邮箱</span><span>{{ tender.contact_email || '-' }}</span>
              </div>
            </div>
          </UCard>

          <!-- 招标代理机构 -->
          <UCard v-if="tender.agency_name">
            <template #header>
              <span class="font-semibold text-sm">招标代理机构</span>
            </template>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-8 text-sm">
              <div class="flex">
                <span class="text-muted w-20 shrink-0">机构名称</span><span>{{ tender.agency_name }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">代理类型</span><span>{{ tender.agency_type_val === 'government' ? '政府采购' : tender.agency_type_val === 'group' ? '集团采购' : tender.agency_type_val === 'third_party' ? '第三方代理' : '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">地址</span><span>{{ tender.agency_address || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">联系人</span><span>{{ tender.agency_contact_name || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">电话</span><span>{{ tender.agency_contact_phone || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-20 shrink-0">邮箱</span><span>{{ tender.agency_contact_email || '-' }}</span>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 文档 -->
        <DocumentsPanel v-if="activeTab === 'documents'" entity-type="tender" :entity-id="Number(id)" />
      </div>
    </template>
  </UDashboardPanel>

  <!-- 添加节点弹窗 -->
  <UModal v-model:open="showMilestoneModal" title="添加关键节点">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">添加关键节点</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showMilestoneModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="节点名称" required>
            <UInput v-model="milestoneForm.name" placeholder="如：购买标书、递交资质" class="w-full" />
          </UFormField>
          <UFormField label="截止日期">
            <UInput v-model="milestoneForm.due_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="责任人">
            <UserPicker v-model="milestoneForm.assignee_user_id" />
          </UFormField>
          <UFormField label="备注">
            <UInput v-model="milestoneForm.remark" class="w-full" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showMilestoneModal = false"
            />
            <UButton label="添加" color="primary" @click="addMilestone" />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- 添加成员弹窗 -->
  <UModal v-model:open="showMemberModal" title="添加团队成员">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">添加团队成员</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showMemberModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="用户" required>
            <UserPicker v-model="memberForm.user_id" />
          </UFormField>
          <UFormField label="角色">
            <USelect v-model="memberForm.role" :items="roleOptions" class="w-full" />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showMemberModal = false"
            />
            <UButton label="添加" color="primary" @click="addMember" />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <!-- 落标复盘弹窗 -->
  <UModal v-model:open="showReviewModal" title="落标复盘">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">落标复盘</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="showReviewModal = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="中标方名称">
            <UInput v-model="reviewForm.lost_to" placeholder="中标单位" class="w-full" />
          </UFormField>
          <UFormField label="中标金额(元)">
            <UInput v-model.number="reviewForm.lost_to_amount" type="number" class="w-full" />
          </UFormField>
          <UFormField label="落标原因" required>
            <USelect
              v-model="reviewForm.lost_reason_type"
              :items="lostReasonOptions"
              placeholder="请选择"
              class="w-full"
            />
          </UFormField>
          <UFormField label="详细分析">
            <UTextarea
              v-model="reviewForm.lost_reason_detail"
              placeholder="从哪些方面输了？对手优势是什么？"
              :rows="3"
              class="w-full"
            />
          </UFormField>
          <UFormField label="改进建议">
            <UTextarea
              v-model="reviewForm.improvement_suggestion"
              placeholder="下次遇到类似项目如何改进？"
              :rows="3"
              class="w-full"
            />
          </UFormField>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="showReviewModal = false"
            />
            <UButton label="提交复盘" color="warning" @click="submitReview" />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
