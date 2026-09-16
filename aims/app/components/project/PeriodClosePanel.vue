<script setup lang="ts">
interface PeriodicMilestone {
  id: number
  name: string
  mode: string
  status: string
  recurrenceRule?: string | null
}

interface GateCheck {
  key: string
  label: string
  passed: boolean
  waived?: boolean
  detail: string
  link?: string
}

interface GateResult {
  passed: boolean
  checks: GateCheck[]
}

interface GatePreview {
  recurrence: string
  gate: GateResult
}

const props = defineProps<{ projectId: number, milestones: PeriodicMilestone[], canManage: boolean }>()
const emit = defineEmits<{ closed: [] }>()
const toast = useToast()
const selectedMilestoneId = ref<number | undefined>()
const gate = ref<GateResult | null>(null)
const recurrence = ref('monthly')
const loading = ref(false)
const submitting = ref(false)
const showException = ref(false)
const controls = reactive({
  overdueReviewed: false,
  costConfirmed: false,
  slaReviewed: false,
  reviewCompleted: false,
  reviewExempted: false
})
const exception = reactive({ reason: '', ownerUid: '', dueDate: '' })

function errorMessage(error: unknown, fallback: string) {
  const value = error as { data?: { message?: string }, message?: string }
  return value?.data?.message || value?.message || fallback
}

const periodicMilestones = computed(() => props.milestones.filter(item => item.mode === 'periodic' && item.status !== 'completed'))
const milestoneOptions = computed(() => periodicMilestones.value.map(item => ({ label: item.name, value: item.id })))
const failedCheckKeys = computed(() => new Set(gate.value?.checks.filter(item => !item.passed).map(item => item.key) || []))
const hasActionableChecks = computed(() => ['overdue_remediation', 'time_and_cost', 'sla_review', 'period_review'].some(key => failedCheckKeys.value.has(key)))
const monthlyRecurrence = computed(() => {
  const value = recurrence.value.toLowerCase()
  return !value.includes('week') && !value.includes('quarter') && !value.includes('year') && !value.includes('annual')
})

watch(periodicMilestones, (items) => {
  if (!selectedMilestoneId.value && items[0]) selectedMilestoneId.value = items[0].id
}, { immediate: true })

let previewTimer: ReturnType<typeof setTimeout> | undefined
watch([selectedMilestoneId, () => ({ ...controls })], () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(loadGate, 180)
}, { deep: true, immediate: true })

async function loadGate() {
  if (!selectedMilestoneId.value) return
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: GatePreview }>(
      `/api/v1/projects/${props.projectId}/milestones/${selectedMilestoneId.value}/close-gate`,
      { params: controls }
    )
    if (response.code === 0) {
      gate.value = response.data.gate
      recurrence.value = response.data.recurrence || 'monthly'
    } else {
      gate.value = null
    }
  } catch {
    gate.value = null
  } finally {
    loading.value = false
  }
}

async function closePeriod() {
  if (!selectedMilestoneId.value) return
  if (!gate.value?.passed && showException.value && (!exception.reason.trim() || !exception.ownerUid.trim() || !exception.dueDate)) {
    toast.add({ title: '请完整填写例外原因、责任人与计划关闭时间', color: 'warning' })
    return
  }
  submitting.value = true
  try {
    await $fetch(`/api/v1/projects/${props.projectId}/milestones/${selectedMilestoneId.value}:close`, {
      method: 'POST',
      body: {
        carryover: 'auto',
        manualConfirmed: true,
        ...controls,
        exceptionReason: showException.value ? exception.reason : undefined,
        exceptionOwnerUid: showException.value ? exception.ownerUid : undefined,
        exceptionDueDate: showException.value ? exception.dueDate : undefined
      }
    })
    toast.add({ title: '关期完成，已生成下一周期', color: 'success' })
    emit('closed')
  } catch (error) {
    toast.add({ title: '关期未完成', description: errorMessage(error, '请处理未通过项或登记完整例外'), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UCard v-if="periodicMilestones.length">
    <template #header>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-shield-check" class="size-4 text-primary" />
          <span class="font-semibold">关期确认</span>
        </div>
        <USelect
          v-model="selectedMilestoneId"
          :items="milestoneOptions"
          value-key="value"
          class="w-full sm:w-64"
        />
      </div>
    </template>

    <div v-if="loading" class="flex justify-center py-6">
      <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-muted" />
    </div>
    <div v-else-if="gate" class="space-y-4">
      <div class="grid grid-cols-1 gap-2 lg:grid-cols-5">
        <NuxtLink
          v-for="check in gate.checks"
          :key="check.key"
          :to="check.link || '#'"
          class="rounded-lg border p-3 transition-colors hover:border-primary"
          :class="check.passed ? 'border-success/40 bg-success/5' : 'border-error/40 bg-error/5'"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="text-sm font-medium">{{ check.label }}</p>
            <UIcon :name="check.passed ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" :class="check.passed ? 'text-success' : 'text-error'" class="size-4 shrink-0" />
          </div>
          <p class="mt-2 text-xs text-muted">{{ check.detail }}</p>
        </NuxtLink>
      </div>

      <div v-if="hasActionableChecks" class="space-y-2 rounded-lg bg-elevated/40 p-3">
        <p class="text-xs font-medium text-muted">
          仅需人工确认当前异常项
        </p>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UCheckbox v-if="failedCheckKeys.has('overdue_remediation')" v-model="controls.overdueReviewed" label="超时项已逐条解释并有补救动作" />
          <UCheckbox v-if="failedCheckKeys.has('time_and_cost')" v-model="controls.costConfirmed" label="成本已归集" />
          <UCheckbox v-if="failedCheckKeys.has('sla_review')" v-model="controls.slaReviewed" label="SLA 已复核且差异已记录" />
          <div v-if="failedCheckKeys.has('period_review')" class="space-y-2">
            <UCheckbox v-model="controls.reviewCompleted" label="复盘/客户确认完成" />
            <UCheckbox v-if="monthlyRecurrence" v-model="controls.reviewExempted" label="登记月度复盘豁免" />
          </div>
        </div>
      </div>

      <div v-if="!gate.passed" class="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
        <UCheckbox v-model="showException" label="登记例外后关期" />
        <div v-if="showException" class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <UFormField label="例外原因" required>
            <UInput v-model="exception.reason" class="w-full" />
          </UFormField>
          <UFormField label="责任人 UID" required>
            <UInput v-model="exception.ownerUid" class="w-full" />
          </UFormField>
          <UFormField label="计划关闭时间" required>
            <UInput v-model="exception.dueDate" type="date" class="w-full" />
          </UFormField>
        </div>
      </div>

      <div v-if="canManage" class="flex justify-end">
        <UButton
          label="确认关期并生成下一周期"
          icon="i-lucide-calendar-check"
          :loading="submitting"
          :disabled="!gate.passed && !showException"
          @click="closePeriod"
        />
      </div>
    </div>
  </UCard>
</template>
