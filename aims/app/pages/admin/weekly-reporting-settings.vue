<script setup lang="ts">
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '../../../../foundation/app/components/common/EmptyState.vue'
import { useAimsModule } from '../../../layer/useAimsModule'
import { aimsApiErrorStatus, weeklyReportingErrorMessage } from '../../utils/weeklyReportingError'

// 周报设置：公司级单行配置（时区、填报截止、汇总目标、启用范围）。
// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
// 服务端逐次校验 weekly_reports:configure；本页的权限只用于展示。
definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '周报设置',
  layoutHeaderProjectSwitcher: false
})

type RolloutMode = 'disabled' | 'pilot' | 'company'

interface WeeklyReportingSettings {
  timezone: string
  deadlineWeekday: number
  deadlineTime: string
  summaryTargetWeekday: number
  summaryTargetTime: string
  reminderOffsets: unknown
  ragConfig: unknown
  rolloutMode: RolloutMode
  configVersion: number
  updatedBy: string
  updatedAt: string
}

interface SettingsDraft {
  timezone: string
  deadlineWeekday: number
  deadlineTime: string
  summaryTargetWeekday: number
  summaryTargetTime: string
  rolloutMode: RolloutMode | ''
}

const { moduleUrl, hosted } = useAimsModule()
const { confirm } = useConfirm()
const toast = useToast()

const weekdayOptions = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => ({ label, value: index + 1 }))
const commonTimezones = ['Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore', 'Asia/Tokyo', 'UTC']
const rolloutItems = [
  { label: '停用', value: 'disabled', description: '不生成应报清单，项目周报与整周工时提交均不开放。' },
  { label: '试点项目', value: 'pilot', description: '仅已登记且在有效期内的试点项目进入应报清单。' },
  { label: '全公司', value: 'company', description: '本周内曾处于进行中的项目都进入应报清单。' }
]
const rolloutLabel = (mode: string) => rolloutItems.find(item => item.value === mode)?.label || mode

const loading = ref(false)
const loaded = ref(false)
const loadError = ref('')
const forbidden = ref(false)
const configured = ref(false)
const current = ref<WeeklyReportingSettings | null>(null)
const draft = ref<SettingsDraft>(defaultDraft())
const saving = ref(false)
const saveError = ref('')
// 一次保存意图固定一个操作标识：结果未确认时重试沿用同一标识与内容，
// 成功或明确失败后清空；待确认期间表单只读，保证重试内容不变。
const pendingWrite = ref<{ key: string, body: Record<string, unknown> } | null>(null)
let loadRequest = 0

const timezoneOptions = computed(() => {
  const zones = new Set(commonTimezones)
  if (draft.value.timezone) zones.add(draft.value.timezone)
  return [...zones].map(zone => ({ label: zone, value: zone }))
})

function defaultDraft(): SettingsDraft {
  // 未配置时的建议值；启用范围必须由管理员显式选择，不隐式开启。
  return { timezone: 'Asia/Shanghai', deadlineWeekday: 5, deadlineTime: '18:00', summaryTargetWeekday: 1, summaryTargetTime: '12:00', rolloutMode: '' }
}

function toDraft(settings: WeeklyReportingSettings): SettingsDraft {
  return {
    timezone: settings.timezone,
    deadlineWeekday: settings.deadlineWeekday,
    deadlineTime: settings.deadlineTime.slice(0, 5),
    summaryTargetWeekday: settings.summaryTargetWeekday,
    summaryTargetTime: settings.summaryTargetTime.slice(0, 5),
    rolloutMode: settings.rolloutMode
  }
}

const clockPattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const validationError = computed(() => {
  const value = draft.value
  if (!value.timezone) return '请选择时区'
  if (!clockPattern.test(value.deadlineTime)) return '请填写有效的填报截止时间'
  if (!clockPattern.test(value.summaryTargetTime)) return '请填写有效的汇总目标时间'
  if (!value.rolloutMode) return '请选择启用范围'
  return ''
})
const dirty = computed(() => {
  const base = current.value ? toDraft(current.value) : defaultDraft()
  return !configured.value || (Object.keys(base) as (keyof SettingsDraft)[]).some(field => base[field] !== draft.value[field])
})
const canSave = computed(() => loaded.value && !forbidden.value && !loading.value && !loadError.value && (Boolean(pendingWrite.value) || (dirty.value && !validationError.value)))
const updatedAtLabel = computed(() => {
  const raw = current.value?.updatedAt
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString('zh-CN', { hour12: false })
})

function isSettingsResponse(value: unknown): value is { code: number, data: { configured: boolean, settings: WeeklyReportingSettings | null } } {
  const data = (value as { data?: { configured?: unknown, settings?: unknown } })?.data
  return (value as { code?: unknown })?.code === 0 && typeof data?.configured === 'boolean'
    && (data.configured ? Boolean(data.settings && typeof data.settings === 'object') : data.settings === null)
}

function applySettings(data: { configured: boolean, settings: WeeklyReportingSettings | null }) {
  configured.value = data.configured
  current.value = data.settings
  draft.value = data.settings ? toDraft(data.settings) : defaultDraft()
}

async function loadSettings() {
  const request = ++loadRequest
  loading.value = true
  loadError.value = ''
  forbidden.value = false
  saveError.value = ''
  try {
    const response = await $fetch<unknown>(moduleUrl('/api/v1/admin/weekly-reporting-settings'))
    if (request !== loadRequest) return
    if (!isSettingsResponse(response)) throw Error('周报设置响应无效')
    pendingWrite.value = null
    applySettings(response.data)
    loaded.value = true
  } catch (cause) {
    if (request !== loadRequest) return
    forbidden.value = aimsApiErrorStatus(cause) === 403
    loadError.value = forbidden.value ? '' : weeklyReportingErrorMessage(cause, '周报设置暂不可用，请稍后重试')
  } finally {
    if (request === loadRequest) loading.value = false
  }
}

async function saveSettings() {
  if (!canSave.value || saving.value) return
  if (!pendingWrite.value) {
    const value = draft.value
    const previousMode = current.value?.rolloutMode
    if (configured.value && previousMode && previousMode !== value.rolloutMode && !(await confirm({
      title: '确认调整启用范围',
      message: `周报启用范围将从「${rolloutLabel(previousMode)}」调整为「${rolloutLabel(value.rolloutMode)}」。之后新生成的应报清单按新范围确定应报项目，已生成周期保留原配置快照。`,
      confirmLabel: '确认调整',
      tone: 'warning'
    }))) return
    pendingWrite.value = {
      key: crypto.randomUUID(),
      body: {
        timezone: value.timezone,
        deadlineWeekday: value.deadlineWeekday,
        deadlineTime: value.deadlineTime,
        summaryTargetWeekday: value.summaryTargetWeekday,
        summaryTargetTime: value.summaryTargetTime,
        rolloutMode: value.rolloutMode,
        // 提醒与 RAG 参数本页不编辑，保存时原样沿用当前值。
        ...(current.value?.reminderOffsets !== undefined && current.value?.reminderOffsets !== null ? { reminderOffsets: current.value.reminderOffsets } : {}),
        ...(current.value?.ragConfig !== undefined && current.value?.ragConfig !== null ? { ragConfig: current.value.ragConfig } : {})
      }
    }
  }
  saving.value = true
  saveError.value = ''
  const operation = pendingWrite.value
  try {
    const response = await $fetch<unknown>(moduleUrl('/api/v1/admin/weekly-reporting-settings'), {
      method: 'PUT',
      headers: { 'Idempotency-Key': operation.key },
      body: operation.body
    })
    if (!isSettingsResponse(response) || !response.data.configured) throw Error('周报设置保存响应无效')
    pendingWrite.value = null
    applySettings(response.data)
    toast.add({ title: '周报设置已保存', color: 'success' })
  } catch (cause) {
    const status = aimsApiErrorStatus(cause)
    if (!status || status >= 500 || status === 429) {
      saveError.value = '保存结果未确认，可能已生效。可直接重试（沿用同一请求），或刷新查看当前配置。'
    } else {
      pendingWrite.value = null
      forbidden.value = status === 403
      saveError.value = forbidden.value ? '' : weeklyReportingErrorMessage(cause, '保存失败，请检查填写内容')
    }
  } finally {
    saving.value = false
  }
}

onMounted(loadSettings)
</script>

<template>
  <UDashboardPanel id="aims-weekly-reporting-settings" :ui="{ body: 'min-h-0 overflow-y-auto p-4 sm:p-6' }">
    <template #body>
      <div class="mx-auto w-full max-w-3xl space-y-5">
        <ContentPageHeader
          :hosted="hosted"
          title="周报设置"
          description="配置项目周报的时区、填报截止、公司汇总目标时间和启用范围。"
          breadcrumb="控制台 / 业务配置"
        >
          <template #actions>
            <UButton
              label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              :loading="loading"
              :disabled="saving"
              @click="loadSettings"
            />
          </template>
        </ContentPageHeader>

        <CommonEmptyState
          v-if="forbidden"
          icon="i-lucide-lock"
          title="无权限"
          description="当前账号没有项目周报配置权限，请联系管理员授予「项目周报 · 配置」。"
        />
        <UAlert
          v-else-if="loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="周报设置加载失败"
          :description="loadError"
        >
          <template #actions>
            <UButton
              label="重试"
              color="error"
              variant="soft"
              @click="loadSettings"
            />
          </template>
        </UAlert>
        <USkeleton v-else-if="!loaded" class="h-80 w-full" />
        <template v-else>
          <UAlert
            v-if="!configured"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="周报设置尚未配置"
            description="保存后，项目总监才能在「周报汇总」中生成应报清单，项目经理才能提交周报与整周工时。"
          />
          <div v-else-if="current" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            <span>配置版本 v{{ current.configVersion }}</span>
            <span>当前范围：{{ rolloutLabel(current.rolloutMode) }}</span>
            <span v-if="updatedAtLabel">最近更新：{{ current.updatedBy }} · {{ updatedAtLabel }}</span>
          </div>

          <UCard>
            <div class="space-y-5">
              <UFormField label="时区" required description="自然周按该时区的周一 00:00 至周日 24:00 计算。">
                <USelect
                  v-model="draft.timezone"
                  :items="timezoneOptions"
                  value-key="value"
                  :disabled="!!pendingWrite || loading"
                  class="w-full sm:w-72"
                />
              </UFormField>

              <div class="grid gap-5 md:grid-cols-2">
                <UFormField label="填报截止" required description="超过截止时间未提交的周报记为迟交。">
                  <div class="flex gap-2">
                    <USelect
                      v-model="draft.deadlineWeekday"
                      :items="weekdayOptions"
                      value-key="value"
                      aria-label="填报截止星期"
                      :disabled="!!pendingWrite || loading"
                      class="w-28"
                    />
                    <UInput
                      v-model="draft.deadlineTime"
                      type="time"
                      aria-label="填报截止时间"
                      :disabled="!!pendingWrite || loading"
                      class="w-32"
                    />
                  </div>
                </UFormField>
                <UFormField label="公司汇总目标" required description="项目总监完成公司周报汇总的目标时间（次周）。">
                  <div class="flex gap-2">
                    <USelect
                      v-model="draft.summaryTargetWeekday"
                      :items="weekdayOptions"
                      value-key="value"
                      aria-label="汇总目标星期"
                      :disabled="!!pendingWrite || loading"
                      class="w-28"
                    />
                    <UInput
                      v-model="draft.summaryTargetTime"
                      type="time"
                      aria-label="汇总目标时间"
                      :disabled="!!pendingWrite || loading"
                      class="w-32"
                    />
                  </div>
                </UFormField>
              </div>

              <UFormField label="启用范围" required>
                <URadioGroup
                  v-model="draft.rolloutMode"
                  :items="rolloutItems"
                  value-key="value"
                  :disabled="!!pendingWrite || loading"
                />
              </UFormField>

              <p class="text-xs text-muted">
                修改只影响之后新生成的应报清单；已生成的周期保留生成时的配置快照。提醒与 RAG 参数本页暂不编辑，保存时沿用当前值。
              </p>

              <UAlert
                v-if="saveError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :description="saveError"
              />

              <div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                <span v-if="validationError && !pendingWrite && dirty" class="text-sm text-muted sm:mr-auto">{{ validationError }}</span>
                <UButton
                  :label="pendingWrite ? '重试保存' : '保存设置'"
                  icon="i-lucide-save"
                  color="primary"
                  :loading="saving"
                  :disabled="!canSave"
                  class="justify-center"
                  @click="saveSettings"
                />
              </div>
            </div>
          </UCard>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
