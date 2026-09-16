<script setup lang="ts">
interface SummaryObligation {
  obligationId: number
  projectId: number
  projectCode: string
  projectName: string
  responsibleUid: string
  dueStatus: string
  late: boolean
  reportId: number | null
  reportStatus: string | null
  reviewedVersionId: number | null
  eligible: boolean
}

interface RecipientSelection {
  id?: number
  subjectType: 'user' | 'department'
  subjectCode: string
  subjectName: string
}

interface SummaryProjection {
  periodKey: string
  generated: boolean
  id?: number
  status?: 'draft' | 'publishing' | 'published' | 'cancelled' | 'correction_draft' | null
  currentRevisionNo?: number
  currentVersionId?: number | null
  codocsDocumentUuid?: string | null
  draft?: {
    title?: string
    opening?: string
    closing?: string
    correctionReason?: string
    includedObligationIds?: number[]
  } | null
  recipientSelections?: RecipientSelection[]
  obligations?: SummaryObligation[]
}

interface SummaryVersion {
  id: number
  revisionNo: number
  correctionOfVersionId?: number | null
  correctionReason?: string | null
  publishStatus: 'prepared' | 'pending' | 'published' | 'failed' | 'cancelled'
  codocsDocumentUuid?: string | null
  codocsDocumentVersionId?: number | null
  publishedBy?: string | null
  publishedAt?: string | null
  createdAt: string
}

const props = defineProps<{
  periodKey: string
  active: boolean
}>()

const toast = useToast()
const { users } = useAccountUsers({ pageSize: 1000 })
const { departments } = useAccountDepartments()
const loading = ref(false)
const saving = ref(false)
const publishing = ref(false)
const openingCorrection = ref(false)
const summary = ref<SummaryProjection | null>(null)
const versions = ref<SummaryVersion[]>([])
const title = ref('')
const opening = ref('')
const closing = ref('')
const correctionReason = ref('')
const includedObligationIds = ref<number[]>([])
const recipientKeys = ref<string[]>([])

const obligations = computed(() => summary.value?.obligations || [])
const eligibleCount = computed(() => obligations.value.filter(item => item.eligible).length)
const selectedCount = computed(() => includedObligationIds.value.length)
const missingCount = computed(() => obligations.value.filter(item => !item.eligible).length)
const isEditable = computed(() => summary.value?.status === 'draft' || summary.value?.status === 'correction_draft')
const canPublish = computed(() => isEditable.value && selectedCount.value > 0 && !saving.value && !publishing.value)
const latestVersion = computed(() => versions.value[0] || null)
const canRetry = computed(() =>
  summary.value?.status === 'publishing'
  && latestVersion.value?.publishStatus === 'failed'
  && !publishing.value
)
const canCancelPublish = computed(() => summary.value?.status === 'publishing' && !publishing.value)

const recipientOptions = computed(() => {
  const userOptions = users.value.map(user => ({
    label: `${user.realName || user.uid}（人员）`,
    value: `user:${user.uid}`
  }))
  const departmentOptions = (departments.value?.flat || []).map(department => ({
    label: `${department.name}（部门）`,
    value: `department:${department.deptCode}`
  }))
  return [...userOptions, ...departmentOptions]
})

function statusLabel(status: SummaryProjection['status']) {
  if (status === 'draft') return '汇总草稿'
  if (status === 'correction_draft') return '更正草稿'
  if (status === 'publishing') return '发布中'
  if (status === 'published') return '已发布'
  if (status === 'cancelled') return '已取消'
  return '未生成'
}

function statusColor(status: SummaryProjection['status']): 'neutral' | 'warning' | 'success' | 'info' | 'error' {
  if (status === 'published') return 'success'
  if (status === 'publishing') return 'info'
  if (status === 'correction_draft') return 'warning'
  if (status === 'cancelled') return 'error'
  return 'neutral'
}

function recipientSelectionForKey(key: string): RecipientSelection | null {
  const [subjectType, ...codeParts] = key.split(':')
  const subjectCode = codeParts.join(':')
  if ((subjectType !== 'user' && subjectType !== 'department') || !subjectCode) return null
  if (subjectType === 'user') {
    const user = users.value.find(item => item.uid === subjectCode)
    return {
      subjectType,
      subjectCode,
      subjectName: user?.realName || subjectCode
    }
  }
  const department = (departments.value?.flat || []).find(item => item.deptCode === subjectCode)
  return {
    subjectType,
    subjectCode,
    subjectName: department?.name || subjectCode
  }
}

function applyProjection(value: SummaryProjection) {
  summary.value = value
  title.value = value.draft?.title || `${props.periodKey} 公司项目周报汇总`
  opening.value = value.draft?.opening || ''
  closing.value = value.draft?.closing || ''
  correctionReason.value = value.draft?.correctionReason || ''
  includedObligationIds.value = [...(value.draft?.includedObligationIds || [])]
  recipientKeys.value = (value.recipientSelections || []).map(
    item => `${item.subjectType}:${item.subjectCode}`
  )
}

async function load() {
  if (!props.active) return
  loading.value = true
  try {
    const [summaryResponse, versionResponse] = await Promise.all([
      $fetch<{ code: number, data: SummaryProjection }>(
        `/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}`
      ),
      $fetch<{ code: number, data: { items?: SummaryVersion[] } }>(
        `/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}/versions`
      ).catch(() => ({ code: 0, data: { items: [] } }))
    ])
    applyProjection(summaryResponse.data)
    versions.value = versionResponse.data.items || []
  } catch (error: unknown) {
    console.error('[CompanyWeeklySummary] load failed:', error)
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '加载公司项目周报汇总失败',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function generate() {
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: SummaryProjection }>(
      `/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}:generate`,
      { method: 'POST' }
    )
    applyProjection(response.data)
    toast.add({ title: '汇总草稿已生成，并已继承上次抄送清单', color: 'success' })
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '生成汇总草稿失败',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function saveDraft() {
  if (!isEditable.value) return
  saving.value = true
  try {
    const recipientSelections = recipientKeys.value
      .map(recipientSelectionForKey)
      .filter((item): item is RecipientSelection => Boolean(item))
    const response = await $fetch<{ code: number, data: SummaryProjection }>(
      `/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}/draft`,
      {
        method: 'PUT',
        body: {
          title: title.value.trim(),
          opening: opening.value.trim(),
          closing: closing.value.trim(),
          includedObligationIds: includedObligationIds.value,
          recipientSelections
        }
      }
    )
    applyProjection(response.data)
    toast.add({ title: '公司项目周报汇总草稿已保存', color: 'success' })
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '保存汇总草稿失败',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

async function publish() {
  if (!canPublish.value) return
  if (summary.value?.status === 'correction_draft' && !correctionReason.value.trim()) {
    toast.add({ title: '发布更正版前必须填写更正原因', color: 'warning' })
    return
  }
  publishing.value = true
  try {
    await saveDraft()
    const response = await $fetch<{
      code: number
      data: { status: string, delivery?: { synced?: boolean, pending?: boolean } }
    }>(`/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}:publish`, {
      method: 'POST',
      body: { correctionReason: correctionReason.value.trim() || undefined }
    })
    toast.add({
      title: response.data.delivery?.synced
        ? '公司项目周报汇总已发布并存档到 Codocs'
        : '发布任务已提交，系统将在后台可靠重试',
      color: response.data.delivery?.synced ? 'success' : 'info'
    })
    await load()
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '发布公司项目周报汇总失败',
      color: 'error'
    })
  } finally {
    publishing.value = false
  }
}

async function retryPublish() {
  if (!canRetry.value) return
  publishing.value = true
  try {
    const response = await $fetch<{
      code: number
      data: { delivery?: { synced?: boolean } }
    }>(`/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}:retry`, {
      method: 'POST'
    })
    toast.add({
      title: response.data.delivery?.synced ? '汇总已重新发布成功' : '重试任务已提交',
      color: response.data.delivery?.synced ? 'success' : 'info'
    })
    await load()
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '重试发布失败',
      color: 'error'
    })
  } finally {
    publishing.value = false
  }
}

async function cancelPublish() {
  if (!canCancelPublish.value) return
  publishing.value = true
  try {
    await $fetch(`/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}:cancel-publish`, {
      method: 'POST'
    })
    toast.add({ title: '发布已取消，项目周报已解冻并恢复为汇总草稿', color: 'success' })
    await load()
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '当前发布阶段已不可取消',
      color: 'error'
    })
  } finally {
    publishing.value = false
  }
}

async function openCorrection() {
  if (summary.value?.status !== 'published' || !correctionReason.value.trim()) return
  openingCorrection.value = true
  try {
    const response = await $fetch<{ code: number, data: SummaryProjection }>(
      `/api/v1/company-weekly-summaries/${encodeURIComponent(props.periodKey)}:open-correction`,
      {
        method: 'POST',
        body: { reason: correctionReason.value.trim() }
      }
    )
    applyProjection(response.data)
    toast.add({ title: '已创建公司项目周报汇总更正草稿', color: 'success' })
  } catch (error: unknown) {
    toast.add({
      title: (error as { data?: { message?: string } })?.data?.message || '创建更正草稿失败',
      color: 'error'
    })
  } finally {
    openingCorrection.value = false
  }
}

watch(
  () => [props.active, props.periodKey] as const,
  ([active]) => {
    if (active) void load()
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="border-b border-default px-5 py-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-base font-semibold text-highlighted">
              {{ periodKey }} 公司项目周报汇总
            </h2>
            <UBadge :color="statusColor(summary?.status)" variant="soft">
              {{ statusLabel(summary?.status) }}
            </UBadge>
          </div>
          <p class="mt-1 text-sm text-muted">
            项目总监选择已审阅版本，发布后冻结项目周报并一并确认项目经理本人工时。
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="loading"
            @click="load"
          />
          <UButton
            v-if="summary?.generated && isEditable"
            label="保存草稿"
            color="neutral"
            variant="outline"
            :loading="saving"
            @click="saveDraft"
          />
          <UButton
            v-if="summary?.generated && isEditable"
            icon="i-lucide-send"
            label="发布并存档"
            :disabled="!canPublish"
            :loading="publishing"
            @click="publish"
          />
          <UButton
            v-if="canRetry"
            icon="i-lucide-rotate-ccw"
            label="重试发布"
            color="warning"
            :loading="publishing"
            @click="retryPublish"
          />
          <UButton
            v-if="canCancelPublish"
            icon="i-lucide-x"
            label="取消发布"
            color="neutral"
            variant="outline"
            :loading="publishing"
            @click="cancelPublish"
          />
        </div>
      </div>
    </div>

    <div v-if="loading && !summary" class="space-y-3 p-5">
      <USkeleton class="h-24 rounded-lg" />
      <USkeleton class="h-72 rounded-lg" />
    </div>

    <div v-else-if="!summary?.generated" class="flex flex-1 items-center justify-center p-8">
      <div class="max-w-md rounded-xl border border-dashed border-default p-8 text-center">
        <UIcon name="i-lucide-files" class="mx-auto size-10 text-muted" />
        <h3 class="mt-3 font-medium text-highlighted">
          尚未生成汇总草稿
        </h3>
        <p class="mt-1 text-sm text-muted">
          生成时会载入本周期应报项目，并预填上一次发布使用的抄送清单。
        </p>
        <UButton
          class="mt-5"
          icon="i-lucide-wand-sparkles"
          label="生成汇总草稿"
          :loading="loading"
          @click="generate"
        />
      </div>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto p-5">
      <div class="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.8fr)]">
        <section class="space-y-4">
          <UFormField label="汇总标题" required>
            <UInput v-model="title" class="w-full" :disabled="!isEditable" />
          </UFormField>
          <UFormField label="开篇说明">
            <UTextarea
              v-model="opening"
              :rows="3"
              class="w-full"
              :disabled="!isEditable"
            />
          </UFormField>

          <div class="rounded-xl border border-default">
            <div class="flex items-center justify-between border-b border-default px-4 py-3">
              <div>
                <h3 class="text-sm font-medium text-highlighted">
                  纳入项目周报
                </h3>
                <p class="text-xs text-muted">
                  已选 {{ selectedCount }} / 可纳入 {{ eligibleCount }}，缺报 {{ missingCount }}
                </p>
              </div>
            </div>
            <div class="divide-y divide-default">
              <label
                v-for="item in obligations"
                :key="item.obligationId"
                class="flex items-start gap-3 px-4 py-3"
                :class="item.eligible ? 'cursor-pointer' : 'bg-elevated/40'"
              >
                <UCheckbox
                  v-model="includedObligationIds"
                  :value="item.obligationId"
                  :disabled="!isEditable || !item.eligible"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="font-medium text-highlighted">{{ item.projectName }}</span>
                    <span class="text-xs text-muted">{{ item.projectCode }}</span>
                    <UBadge
                      size="xs"
                      :color="item.eligible ? 'success' : 'warning'"
                      variant="soft"
                    >
                      {{ item.eligible ? '已审阅' : '不可纳入' }}
                    </UBadge>
                    <UBadge
                      v-if="item.late"
                      size="xs"
                      color="error"
                      variant="soft"
                    >
                      迟交
                    </UBadge>
                  </span>
                  <span class="mt-1 block text-xs text-muted">
                    责任人 {{ item.responsibleUid }} · {{ item.reportStatus || item.dueStatus }}
                  </span>
                </span>
              </label>
            </div>
          </div>

          <UFormField label="补充说明">
            <UTextarea
              v-model="closing"
              :rows="3"
              class="w-full"
              :disabled="!isEditable"
            />
          </UFormField>
        </section>

        <aside class="space-y-4">
          <div class="rounded-xl border border-default p-4">
            <h3 class="text-sm font-medium text-highlighted">
              抄送范围
            </h3>
            <p class="mt-1 text-xs text-muted">
              部门会在发布时展开为当时的在职人员，并保存实际收件人快照。
            </p>
            <USelectMenu
              v-model="recipientKeys"
              multiple
              :items="recipientOptions"
              value-key="value"
              label-key="label"
              searchable
              class="mt-3 w-full"
              placeholder="选择人员或部门"
              :disabled="!isEditable"
            />
          </div>

          <div v-if="summary.status === 'correction_draft' || summary.status === 'published'" class="rounded-xl border border-default p-4">
            <UFormField :label="summary.status === 'published' ? '发起更正原因' : '本次更正原因'" required>
              <UTextarea
                v-model="correctionReason"
                :rows="4"
                class="w-full"
                placeholder="说明需要更正的事实或内容"
              />
            </UFormField>
            <UButton
              v-if="summary.status === 'published'"
              class="mt-3"
              label="创建更正草稿"
              color="warning"
              variant="soft"
              :disabled="!correctionReason.trim()"
              :loading="openingCorrection"
              @click="openCorrection"
            />
          </div>

          <div class="rounded-xl border border-default p-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-medium text-highlighted">
                发布版本
              </h3>
              <span class="text-xs text-muted">{{ versions.length }} 个版本</span>
            </div>
            <div v-if="versions.length" class="mt-3 space-y-2">
              <div
                v-for="version in versions"
                :key="version.id"
                class="rounded-lg border border-default px-3 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium text-highlighted">
                    R{{ version.revisionNo }}
                  </span>
                  <UBadge
                    size="xs"
                    :color="version.publishStatus === 'published' ? 'success' : version.publishStatus === 'failed' ? 'error' : 'info'"
                    variant="soft"
                  >
                    {{ version.publishStatus }}
                  </UBadge>
                </div>
                <p class="mt-1 text-xs text-muted">
                  {{ version.publishedAt || version.createdAt }}
                </p>
                <p v-if="version.correctionReason" class="mt-1 text-xs text-muted">
                  更正：{{ version.correctionReason }}
                </p>
              </div>
            </div>
            <p v-else class="mt-3 text-sm text-muted">
              尚无发布版本
            </p>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
