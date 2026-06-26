<script setup lang="ts">
import type { Ref } from 'vue'
import type { Lead } from '~/types/altoc'
import { INVALID_REASON_OPTIONS, LEAD_STATUS_OPTIONS, SOURCE_TYPE_OPTIONS } from '~/types/altoc'
import { unwrapApiData } from '~/utils/apiResponse'
import { getLeadRuleScore, getLeadScoreColor, getLeadScoreSignals } from '~/utils/leadScore'
import { getLeadRisks } from '~/utils/leadRisk'

interface LeadActivity {
  id: number
  activity_type: string
  subject: string
  content: string | null
  result_summary: string | null
  next_action: string | null
  next_action_due_at: string | null
  activity_at: string
}

type LeadDetail = Lead & {
  activities?: LeadActivity[]
}

const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => String(route.params.id))

const leadFetch = useFetch(() => `/api/v1/leads/${id.value}`, {
  transform: (res: unknown) => unwrapApiData<LeadDetail>(res)
})
const lead = leadFetch.data as Ref<LeadDetail | null | undefined>
const status = leadFetch.status
const refresh = leadFetch.refresh
const closeModalOpen = ref(false)
const closeLoading = ref(false)
const closeForm = reactive({
  invalid_reason_code: 'other',
  invalid_reason: ''
})
const invalidReasonOptions = INVALID_REASON_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const activityTypeLabels: Record<string, string> = {
  visit: '拜访',
  call: '电话',
  demo: '演示',
  meeting: '会议',
  tender: '投标',
  memo: '纪要'
}
const activityTypeOptions = Object.entries(activityTypeLabels).map(([value, label]) => ({ label, value }))
const activityModalOpen = ref(false)
const activityLoading = ref(false)
const activityForm = reactive({
  activity_type: 'memo',
  subject: '',
  content: '',
  result_summary: '',
  next_action: '',
  next_action_due_at: '',
  activity_at: new Date().toISOString().slice(0, 16)
})
const assignModalOpen = ref(false)
const assignLoading = ref(false)
const assignForm = reactive({
  owner_user_id: ''
})
const convertModalOpen = ref(false)
const leadRuleScore = computed(() => lead.value ? getLeadRuleScore(lead.value) : 0)
const leadScoreSignals = computed(() => lead.value ? getLeadScoreSignals(lead.value) : [])
const leadRisks = computed(() => lead.value ? getLeadRisks(lead.value) : [])

function getStatusColor(s: string) {
  return LEAD_STATUS_OPTIONS.find(o => o.value === s)?.color || 'neutral'
}
function getStatusLabel(s: string) {
  return LEAD_STATUS_OPTIONS.find(o => o.value === s)?.label || s
}
function getSourceLabel(s: string | null | undefined) {
  return SOURCE_TYPE_OPTIONS.find(o => o.value === s)?.label || s || '-'
}
function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

function openCloseLead() {
  closeForm.invalid_reason_code = 'other'
  closeForm.invalid_reason = ''
  closeModalOpen.value = true
}

function resetActivityForm() {
  activityForm.activity_type = 'memo'
  activityForm.subject = ''
  activityForm.content = ''
  activityForm.result_summary = ''
  activityForm.next_action = ''
  activityForm.next_action_due_at = ''
  activityForm.activity_at = new Date().toISOString().slice(0, 16)
}

function openActivityModal() {
  resetActivityForm()
  activityModalOpen.value = true
}

async function createActivity() {
  if (!activityForm.subject.trim()) {
    toast.add({ title: '请输入活动主题', color: 'error' })
    return
  }
  if (activityForm.next_action.trim() && !activityForm.next_action_due_at) {
    toast.add({ title: '请填写下一步截止日期', color: 'error' })
    return
  }
  activityLoading.value = true
  try {
    await $fetch(`/api/v1/leads/${id.value}/activities` as string, {
      method: 'POST',
      body: activityForm
    })
    toast.add({ title: '跟进记录已添加', color: 'success' })
    activityModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '添加失败'), color: 'error' })
  } finally {
    activityLoading.value = false
  }
}

async function closeLead() {
  if (!closeForm.invalid_reason_code) {
    toast.add({ title: '请选择无效原因', color: 'error' })
    return
  }
  if (!closeForm.invalid_reason.trim()) {
    toast.add({ title: '请输入关闭原因', color: 'error' })
    return
  }
  closeLoading.value = true
  try {
    await $fetch(`/api/v1/leads/${id.value}/disqualify` as string, {
      method: 'POST',
      body: {
        invalid_reason_code: closeForm.invalid_reason_code,
        invalid_reason: closeForm.invalid_reason
      }
    })
    toast.add({ title: '线索已关闭', color: 'success' })
    closeModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '操作失败'), color: 'error' })
  } finally {
    closeLoading.value = false
  }
}

function openConvertLead() {
  convertModalOpen.value = true
}

function handleLeadConverted(converted: { opportunity_id: number | string }) {
  convertModalOpen.value = false
  refresh()
  router.push(`/opportunities/${converted.opportunity_id}`)
}

// 分配
function openAssignLead() {
  assignForm.owner_user_id = lead.value?.owner_user_id || ''
  assignModalOpen.value = true
}

async function assignLead() {
  if (!assignForm.owner_user_id?.trim()) {
    toast.add({ title: '请选择负责人', color: 'error' })
    return
  }
  assignLoading.value = true
  try {
    await $fetch(`/api/v1/leads/${id.value}/assign` as string, {
      method: 'POST',
      body: { owner_user_id: assignForm.owner_user_id.trim() }
    })
    toast.add({ title: '分配成功', color: 'success' })
    assignModalOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '分配失败'), color: 'error' })
  } finally {
    assignLoading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="lead-detail">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push('/leads')"
        />
        <div v-if="lead" class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">{{ lead.name }}</span>
          <UBadge :color="getStatusColor(lead.status)" variant="subtle" size="sm">
            {{ getStatusLabel(lead.status) }}
          </UBadge>
          <UBadge
            v-for="risk in leadRisks"
            :key="risk.key"
            :color="risk.color"
            :icon="risk.icon"
            variant="subtle"
            size="xs"
          >
            {{ risk.label }}
          </UBadge>
          <span class="text-xs text-muted font-mono">{{ lead.code }}</span>
        </div>
        <USkeleton v-else class="h-6 w-48" />
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <template v-if="lead && lead.status !== 'converted' && lead.status !== 'closed_invalid'">
          <UButton
            label="转商机"
            icon="i-lucide-arrow-right-circle"
            color="primary"
            @click="openConvertLead"
          />
          <UButton
            label="记录跟进"
            icon="i-lucide-activity"
            variant="soft"
            color="primary"
            @click="openActivityModal"
          />
          <UButton
            label="分配"
            icon="i-lucide-user-plus"
            variant="soft"
            color="neutral"
            @click="openAssignLead"
          />
          <UButton
            label="关闭"
            icon="i-lucide-x-circle"
            variant="soft"
            color="error"
            @click="openCloseLead"
          />
        </template>
        <UButton
          v-if="lead?.converted_opportunity_id"
          label="查看商机"
          icon="i-lucide-external-link"
          variant="soft"
          color="primary"
          @click="router.push(`/opportunities/${lead.converted_opportunity_id}`)"
        />
      </Teleport>

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else-if="lead" class="p-4 space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- 基本信息 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">线索信息</span>
            </template>
            <div class="space-y-3 text-sm">
              <div class="flex">
                <span class="text-muted w-24 shrink-0">组织名称</span><span>{{ lead.org_name || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">来源渠道</span><span>{{ getSourceLabel(lead.source_type) }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">来源详情</span><span>{{ lead.source_detail || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">负责人</span><UserName :uid="lead.owner_user_id" />
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">规则评分</span>
                <UBadge
                  :color="getLeadScoreColor(leadRuleScore)"
                  variant="subtle"
                  size="sm"
                >
                  {{ leadRuleScore }}
                </UBadge>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">评分依据</span>
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="signal in leadScoreSignals"
                    :key="signal.key"
                    :color="signal.ok ? 'success' : 'neutral'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ signal.label }}
                  </UBadge>
                </div>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">创建时间</span><span class="text-xs">{{ lead.created_at }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">最近跟进</span><span class="text-xs">{{ lead.last_follow_up_at || '-' }}</span>
              </div>
            </div>
          </UCard>

          <!-- 联系人信息 -->
          <UCard>
            <template #header>
              <span class="font-semibold text-sm">联系人</span>
            </template>
            <div class="space-y-3 text-sm">
              <div class="flex">
                <span class="text-muted w-24 shrink-0">姓名</span><span>{{ lead.contact_name || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">手机</span><span>{{ lead.contact_mobile || '-' }}</span>
              </div>
              <div class="flex">
                <span class="text-muted w-24 shrink-0">邮箱</span><span>{{ lead.contact_email || '-' }}</span>
              </div>
            </div>
          </UCard>
        </div>

        <!-- 跟进 / 无效原因 -->
        <UCard v-if="lead.next_action || lead.invalid_reason">
          <template #header>
            <span class="font-semibold text-sm">{{ lead.status === 'closed_invalid' ? '关闭原因' : '下一步动作' }}</span>
          </template>
          <div class="text-sm">
            <p v-if="lead.invalid_reason" class="text-error">
              {{ lead.invalid_reason }}
            </p>
            <p v-if="lead.next_action">
              {{ lead.next_action }}
            </p>
            <p v-if="lead.next_action_due_at" class="text-xs text-muted mt-1">
              截止：{{ lead.next_action_due_at }}
            </p>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold text-sm">跟进记录</span>
          </template>
          <div v-if="lead.activities?.length" class="space-y-3">
            <div
              v-for="activity in lead.activities"
              :key="activity.id"
              class="border-l-2 border-primary pl-3"
            >
              <div class="flex items-center gap-2">
                <UBadge size="xs" color="primary" variant="subtle">
                  {{ activityTypeLabels[activity.activity_type] || activity.activity_type }}
                </UBadge>
                <span class="text-sm font-medium">{{ activity.subject }}</span>
                <span class="text-xs text-muted">{{ activity.activity_at }}</span>
              </div>
              <p v-if="activity.result_summary" class="text-sm text-muted mt-1">
                {{ activity.result_summary }}
              </p>
              <p v-if="activity.next_action" class="text-sm mt-1">
                下一步：{{ activity.next_action }}
              </p>
            </div>
          </div>
          <p v-else class="text-sm text-muted">
            暂无跟进记录
          </p>
        </UCard>

        <!-- 备注 -->
        <UCard v-if="lead.remark">
          <template #header>
            <span class="font-semibold text-sm">备注</span>
          </template>
          <p class="text-sm">
            {{ lead.remark }}
          </p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <LeadConvertModal
    v-model:open="convertModalOpen"
    :lead="lead || null"
    @converted="handleLeadConverted"
  />

  <UModal v-model:open="closeModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">关闭线索</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="closeModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <UFormField label="无效原因" required>
            <USelect
              v-model="closeForm.invalid_reason_code"
              :items="invalidReasonOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="说明" required>
            <UTextarea
              v-model="closeForm.invalid_reason"
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
              @click="closeModalOpen = false"
            />
            <UButton
              label="确认关闭"
              color="error"
              :loading="closeLoading"
              @click="closeLead"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="assignModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">分配负责人</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="assignModalOpen = false"
            />
          </div>
        </template>
        <UFormField label="负责人" required>
          <UserPicker v-model="assignForm.owner_user_id" />
        </UFormField>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="assignModalOpen = false"
            />
            <UButton
              label="确认分配"
              color="primary"
              :loading="assignLoading"
              @click="assignLead"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>

  <UModal v-model:open="activityModalOpen">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">记录跟进</span>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              @click="activityModalOpen = false"
            />
          </div>
        </template>
        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="活动类型">
              <USelect v-model="activityForm.activity_type" :items="activityTypeOptions" class="w-full" />
            </UFormField>
            <UFormField label="活动时间">
              <UInput v-model="activityForm.activity_at" type="datetime-local" class="w-full" />
            </UFormField>
          </div>
          <UFormField label="活动主题" required>
            <UInput v-model="activityForm.subject" class="w-full" />
          </UFormField>
          <UFormField label="活动内容">
            <UTextarea v-model="activityForm.content" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="结果摘要">
            <UInput v-model="activityForm.result_summary" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="下一步动作">
              <UInput v-model="activityForm.next_action" class="w-full" />
            </UFormField>
            <UFormField label="截止日期">
              <UInput v-model="activityForm.next_action_due_at" type="date" class="w-full" />
            </UFormField>
          </div>
        </div>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="取消"
              variant="ghost"
              color="neutral"
              @click="activityModalOpen = false"
            />
            <UButton
              label="保存"
              color="primary"
              :loading="activityLoading"
              @click="createActivity"
            />
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
