<script setup lang="ts">
import type { AcceptanceInput, ProductVersionAcceptancePreview, AcceptanceCheck, AcceptanceException, VersionExecutionItem } from '~/types/productVersionAcceptance'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本整体验收', layoutHeaderProjectSwitcher: false })

const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.versionId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(id.value)}`)

const { data, status, error, refresh } = await useFetch<{ code: number, data: ProductVersionAcceptancePreview }>(() => `${base.value}/acceptance-preview`, { server: false })
const alert = useApiErrorAlert(error, { fallbackTitle: '版本验收信息加载失败' })

const { data: permission, error: permissionError, refresh: refreshPermission } = await useFetch<{ code: number, data: { product_code: string, status: string, accept: boolean, actor_uid: string } }>(() => `/api/v1/products/${encodeURIComponent(code.value)}/versions/permissions`, { server: false })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '版本权限加载失败' })

const canAccept = computed(() => status.value === 'success' && data.value?.code === 0 && data.value.data.version.product_code === code.value && String(data.value.data.version.id) === id.value && data.value.data.product_status === 'active' && ['planning', 'developing'].includes(data.value.data.version.status) && permission.value?.code === 0 && permission.value.data.product_code === code.value && permission.value.data.status === 'active' && permission.value.data.accept === true && (!!data.value.data.version.business_owner_uid && data.value.data.version.business_owner_uid === permission.value.data.actor_uid))

const checks = ref<AcceptanceCheck[]>([
  { code: 'execution-review', evidence: '' },
  { code: 'blocking-defects-review', evidence: '' },
  { code: 'release-readiness', evidence: '' }
])

const exceptions = ref<AcceptanceException[]>([])
const manualRisks = ref<string[]>([])
const newManualRisk = ref('')
const busy = ref(false)
const reloading = ref(false)
const reviewed = ref(false)
const receipt = ref<number | null>(null)
const canSubmit = computed(() => canAccept.value && !data.value?.data.execution.restricted_item_count && !busy.value && !reloading.value && reviewed.value && data.value?.data.unresolved_scope_count === 0 && exceptions.value.length <= 50 && checks.value.every(c => c.evidence.trim()) && exceptions.value.every(e => e.reason.trim() && e.impact.trim() && e.responsibleUid.trim()))
const submitError = ref<Error | null>(null)
const submitAlert = useApiErrorAlert(submitError, { fallbackTitle: '版本验收提交失败' })

const toast = useToast()
const { confirm } = useConfirm()

let submitRetry: { payload: string, key: string } | undefined

function getExecutionLabel(item: VersionExecutionItem) {
  return `${item.item_key} - ${item.title}`
}

function getIncompleteTargets(): VersionExecutionItem[] {
  if (!data.value?.data.execution.targets) return []
  return data.value.data.execution.targets.filter(t => t.status !== 'completed')
}

function getOpenDefects(): VersionExecutionItem[] {
  if (!data.value?.data.execution.open_defects) return []
  return data.value.data.execution.open_defects
}

function getRequiredExceptionCodes(): string[] {
  const required: string[] = []
  for (const target of getIncompleteTargets()) {
    required.push(`incomplete-target:${target.id}`)
  }
  for (const defect of getOpenDefects()) {
    required.push(`open-defect:${defect.id}`)
  }
  return required
}

function ensureExceptionExists(code: string) {
  if (!exceptions.value.some(e => e.code === code)) {
    exceptions.value.push({ code, reason: '', responsibleUid: '', impact: '' })
  }
}

function addManualRisk() {
  if (!newManualRisk.value.trim() || exceptions.value.length >= 50 || manualRisks.value.length >= 50) return
  const uuid = crypto.randomUUID()
  const code = `manual:${uuid}`
  manualRisks.value.push(uuid)
  exceptions.value.push({ code, reason: newManualRisk.value.trim(), responsibleUid: '', impact: '' })
  newManualRisk.value = ''
}

function removeManualRisk(uuid: string) {
  const idx = manualRisks.value.indexOf(uuid)
  if (idx >= 0) {
    manualRisks.value.splice(idx, 1)
    exceptions.value = exceptions.value.filter(e => e.code !== `manual:${uuid}`)
  }
}

async function submit() {
  if (!canSubmit.value || !data.value) return

  const allRequired = getRequiredExceptionCodes()
  for (const code of allRequired) {
    ensureExceptionExists(code)
  }

  const hasInvalidException = exceptions.value.some(
    e => !e.reason.trim() || !e.responsibleUid.trim() || !e.impact.trim()
  )

  if (!checks.value.every(c => c.evidence.trim()) || hasInvalidException) return

  busy.value = true
  submitError.value = null

  const body: AcceptanceInput = {
    expectedRevision: data.value.data.workspace_revision,
    expectedVersionRevision: data.value.data.version.revision,
    expectedScopeRevision: data.value.data.version.scope_revision,
    expectedReviewHash: data.value.data.review_hash,
    checks: checks.value.map(c => ({ code: c.code, evidence: c.evidence })),
    exceptions: exceptions.value.map(e => ({ ...e }))
  }

  const payload = JSON.stringify(body)
  if (submitRetry?.payload !== payload) {
    submitRetry = { payload, key: crypto.randomUUID() }
  }

  let completed = false
  try {
    const message = `版本：${data.value.data.version.version_code}
名称：${data.value.data.version.name || '无'}
范围计数：${data.value.data.scope_count} 项
已交付：${data.value.data.delivered_scope_count} 项
已顺延：${data.value.data.deferred_scope_count} 项
执行目标：${data.value.data.execution.targets.length} 项
未完成目标：${getIncompleteTargets().length} 项
已关联未关闭缺陷：${data.value.data.execution.open_defects.length} 项

确认后将保存当前范围和执行事实的验收记录；发布需单独执行。`

    if (!await confirm({ title: '确认版本整体验收', message, confirmLabel: '确认验收', tone: 'warning' })) {
      return
    }

    interface AcceptanceResponse {
      code: number
      data: { value: { acceptance_id: number, version_id: number } }
    }

    const response = await $fetch<AcceptanceResponse>(`${base.value}/acceptances`, {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': submitRetry.key }
    })

    if (response.code !== 0 || !Number.isSafeInteger(response.data?.value?.acceptance_id) || response.data.value.acceptance_id < 1 || String(response.data.value.version_id) !== id.value) throw new Error('验收结果不完整，请使用原请求重试')
    receipt.value = response.data.value.acceptance_id
    reviewed.value = false
    completed = true

    submitRetry = undefined
    checks.value = [
      { code: 'execution-review', evidence: '' },
      { code: 'blocking-defects-review', evidence: '' },
      { code: 'release-readiness', evidence: '' }
    ]
    exceptions.value = []
    for (const required of getRequiredExceptionCodes()) ensureExceptionExists(required)
    manualRisks.value = []

    toast.add({ title: '版本已确认验收', color: 'success' })
  } catch (cause) {
    submitError.value = cause instanceof Error ? cause : new Error('验收提交失败')
  } finally {
    busy.value = false
  }

  if (completed) {
    await reload()
  }
}

async function reload() {
  if (busy.value || reloading.value) return
  reloading.value = true
  reviewed.value = false
  try {
    await Promise.all([refresh(), refreshPermission()])
  } finally {
    reloading.value = false
  }
}

onBeforeRouteLeave(() => !busy.value && !reloading.value)
onBeforeRouteUpdate(() => !busy.value && !reloading.value)

watch(() => data.value?.data.review_hash, () => {
  reviewed.value = false
  const required = getRequiredExceptionCodes()
  exceptions.value = exceptions.value.filter(e => e.code.startsWith('manual:') || required.includes(e.code))
  for (const requiredCode of required) ensureExceptionExists(requiredCode)
}, { immediate: true, flush: 'sync' })

watch([code, id], () => {
  reviewed.value = false
  receipt.value = null
  checks.value = [
    { code: 'execution-review', evidence: '' },
    { code: 'blocking-defects-review', evidence: '' },
    { code: 'release-readiness', evidence: '' }
  ]
  exceptions.value = []
  manualRisks.value = []
  submitRetry = undefined
  submitError.value = null
})
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <h1 class="text-lg font-semibold">
      验收与发布
    </h1>
    <p class="text-sm text-muted">
      汇总版本范围交付、执行目标完成和关联缺陷状态，记录验收依据和未完成事项处理方案。
    </p>
    <UAlert
      v-if="receipt"
      color="success"
      :title="`验收记录 #${receipt} 已保存`"
      description="验收已保存，下一步进入本次验收记录核验并发布。"
    />
    <UButton v-if="receipt" :to="{ path: `/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/acceptances/${receipt}`, query: versionPerspectiveQuery }" trailing-icon="i-lucide-arrow-right">
      下一步：核验并发布
    </UButton>
    <UButton :to="{ path: `/products/${encodeURIComponent(code)}/versions/${encodeURIComponent(id)}/acceptances`, query: versionPerspectiveQuery }" color="neutral" variant="outline">
      验收记录与发布
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <UAlert
      v-if="data?.data.execution.restricted_item_count"
      color="warning"
      title="部分项目明细不可见"
      description="汇总包含未授权项目，目标和缺陷明细已隐藏。请由具备相关项目查看权限的版本负责人完成验收。"
    />
    <UAlert
      v-if="status === 'success' && data?.data && !data.data.version.business_owner_uid"
      color="warning"
      title="请先指定版本业务负责人"
      description="在版本详情中编辑并指定负责人后，再由负责人提交验收。"
    />
    <UAlert
      v-if="data?.data.version.business_owner_uid && permission?.data.actor_uid && data.data.version.business_owner_uid !== permission.data.actor_uid"
      color="info"
      title="由版本业务负责人提交验收"
      :description="`负责人 UID：${data.data.version.business_owner_uid}。查看验收依据不代表可以代为提交。`"
    />
    <p v-if="status === 'pending'" role="status">
      正在加载版本验收信息…
    </p>
    <template v-if="status === 'success' && data?.data">
      <article class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <h2 class="font-medium">
          版本 {{ data.data.version.version_code }}
        </h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <p class="text-sm text-muted">
              版本名称
            </p>
            <p class="font-medium">
              {{ data.data.version.name || '无' }}
            </p>
          </div>
          <div>
            <p class="text-sm text-muted">
              版本状态
            </p>
            <p class="font-medium">
              {{ data.data.version.status === 'planning' ? '规划中' : data.data.version.status === 'developing' ? '开发中' : '已发布' }}
            </p>
          </div>
          <div>
            <p class="text-sm text-muted">
              范围计数
            </p>
            <p class="font-medium">
              共 {{ data.data.scope_count }} 项
            </p>
          </div>
          <div>
            <p class="text-sm text-muted">
              范围状态
            </p>
            <p class="font-medium">
              已交付 {{ data.data.delivered_scope_count }} 项，已顺延 {{ data.data.deferred_scope_count }} 项
            </p>
          </div>
        </div>
      </article>

      <article class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <h3 class="font-medium">
          执行现状
        </h3>
        <div v-if="data.data.execution.no_execution_plan" class="flex items-start gap-2">
          <UIcon name="i-lucide-alert-circle" class="mt-0.5 shrink-0 text-warning" />
          <p class="text-sm">
            暂无执行计划关联
          </p>
        </div>
        <div v-else class="space-y-2">
          <p class="text-sm">
            执行目标共 {{ data.data.execution.target_count ?? data.data.execution.targets.length }} 项，明细可见 {{ data.data.execution.targets.length }} 项
            <span v-if="data.data.execution.total_weight > 0" class="text-muted">
              （完成度 {{ Math.round(data.data.execution.completed_weight / data.data.execution.total_weight * 100) }}%）
            </span>
          </p>
          <p v-if="(data.data.execution.open_defect_count ?? getOpenDefects().length) > 0" class="text-sm">
            <UIcon name="i-lucide-alert-triangle" class="mr-1 inline text-warning" />
            已关联未关闭缺陷共 {{ data.data.execution.open_defect_count ?? data.data.execution.open_defects.length }} 项，明细可见 {{ data.data.execution.open_defects.length }} 项
          </p>
        </div>
      </article>

      <UAlert
        v-if="data.data.unresolved_scope_count > 0"
        color="warning"
        title="范围尚未全部处理"
        :description="`还有 ${data.data.unresolved_scope_count} 项范围未交付或顺延，请先处理版本范围。`"
      />
      <form class="space-y-4" @submit.prevent="submit">
        <UAlert v-if="submitAlert" v-bind="submitAlert" />

        <article class="min-w-0 space-y-4 rounded-lg border border-default p-4">
          <h3 class="font-medium">
            验收核验项
          </h3>
          <p class="text-sm text-muted">
            记录版本在三个维度的验收依据。自动缺陷检查仅覆盖关联执行目标下的缺陷，其他阻塞问题须人工核查。
          </p>

          <div v-for="check in checks" :key="check.code" class="space-y-2">
            <UFormField :label="check.code === 'execution-review' ? '执行目标评审' : check.code === 'blocking-defects-review' ? '阻塞缺陷评审' : '发布就绪评审'" required>
              <UTextarea
                v-model="check.evidence"
                required
                :maxlength="10000"
                :disabled="busy || reloading"
                class="w-full"
                placeholder="评审意见、会议记录或签核单编号等"
              />
            </UFormField>
          </div>
        </article>

        <article v-if="getIncompleteTargets().length || getOpenDefects().length" class="min-w-0 space-y-4 rounded-lg border border-default p-4">
          <h3 class="font-medium">
            未完成项处理
          </h3>
          <p class="text-sm text-muted">
            每项未完成执行目标和已关联未关闭缺陷都必须明确处理方案或记录例外。
          </p>

          <div v-if="getIncompleteTargets().length" class="space-y-3">
            <p class="text-sm font-medium">
              未完成执行目标
            </p>
            <div
              v-for="target in getIncompleteTargets()"
              :key="`target-${target.id}`"
              class="space-y-3 rounded border border-default p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-medium">
                  {{ getExecutionLabel(target) }}
                </p>
              </div>

              <UFormField label="处理原因" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `incomplete-target:${target.id}`)!.reason"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                  @update:model-value="ensureExceptionExists(`incomplete-target:${target.id}`)"
                />
              </UFormField>

              <UFormField label="影响评估" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `incomplete-target:${target.id}`)!.impact"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="责任人" required>
                <UserTreeSelector
                  :model-value="exceptions.find(e => e.code === `incomplete-target:${target.id}`)?.responsibleUid ? [exceptions.find(e => e.code === `incomplete-target:${target.id}`)!.responsibleUid] : []"
                  selection-mode="single"
                  :disabled="busy || reloading"
                  @update:model-value="(uids) => { ensureExceptionExists(`incomplete-target:${target.id}`); exceptions.find(e => e.code === `incomplete-target:${target.id}`)!.responsibleUid = uids[0] || '' }"
                />
              </UFormField>
            </div>
          </div>

          <div v-if="getOpenDefects().length" class="space-y-3">
            <p class="text-sm font-medium">
              已关联未关闭缺陷
            </p>
            <div
              v-for="defect in getOpenDefects()"
              :key="`defect-${defect.id}`"
              class="space-y-3 rounded border border-default p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm font-medium">
                  {{ getExecutionLabel(defect) }}
                </p>
                <UBadge color="warning" variant="subtle">
                  缺陷
                </UBadge>
              </div>

              <UFormField label="处理原因" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `open-defect:${defect.id}`)!.reason"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                  @update:model-value="ensureExceptionExists(`open-defect:${defect.id}`)"
                />
              </UFormField>

              <UFormField label="影响评估" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `open-defect:${defect.id}`)!.impact"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="责任人" required>
                <UserTreeSelector
                  :model-value="exceptions.find(e => e.code === `open-defect:${defect.id}`)?.responsibleUid ? [exceptions.find(e => e.code === `open-defect:${defect.id}`)!.responsibleUid] : []"
                  selection-mode="single"
                  :disabled="busy || reloading"
                  @update:model-value="(uids) => { ensureExceptionExists(`open-defect:${defect.id}`); exceptions.find(e => e.code === `open-defect:${defect.id}`)!.responsibleUid = uids[0] || '' }"
                />
              </UFormField>
            </div>
          </div>
        </article>

        <article class="min-w-0 space-y-4 rounded-lg border border-default p-4">
          <div class="flex items-center justify-between">
            <h3 class="font-medium">
              额外风险
            </h3>
            <p class="text-sm text-muted">
              {{ exceptions.length }} / 50
            </p>
          </div>
          <p class="text-sm text-muted">
            记录其他已识别但未包含在执行计划中的风险项。
          </p>

          <div v-if="manualRisks.length" class="space-y-2">
            <div
              v-for="uuid in manualRisks"
              :key="`manual-${uuid}`"
              class="space-y-3 rounded border border-default p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <p class="text-sm text-muted">
                  额外风险 {{ manualRisks.indexOf(uuid) + 1 }}
                </p>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :disabled="busy || reloading"
                  @click="removeManualRisk(uuid)"
                >
                  删除
                </UButton>
              </div>

              <UFormField label="风险描述" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `manual:${uuid}`)!.reason"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                  @update:model-value="ensureExceptionExists(`manual:${uuid}`)"
                />
              </UFormField>

              <UFormField label="影响评估" required>
                <UTextarea
                  v-model="exceptions.find(e => e.code === `manual:${uuid}`)!.impact"
                  required
                  :maxlength="2000"
                  :disabled="busy || reloading"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="责任人" required>
                <UserTreeSelector
                  :model-value="exceptions.find(e => e.code === `manual:${uuid}`)?.responsibleUid ? [exceptions.find(e => e.code === `manual:${uuid}`)!.responsibleUid] : []"
                  selection-mode="single"
                  :disabled="busy || reloading"
                  @update:model-value="(uids) => { ensureExceptionExists(`manual:${uuid}`); exceptions.find(e => e.code === `manual:${uuid}`)!.responsibleUid = uids[0] || '' }"
                />
              </UFormField>
            </div>
          </div>

          <div v-if="exceptions.length < 50" class="space-y-2">
            <UFormField label="新增风险">
              <div class="flex gap-2">
                <UInput
                  v-model="newManualRisk"
                  :disabled="busy || reloading"
                  placeholder="风险项简述"
                  class="flex-1"
                />
                <UButton
                  type="button"
                  color="neutral"
                  variant="outline"
                  :disabled="busy || !newManualRisk.trim()"
                  @click="addManualRisk"
                >
                  添加
                </UButton>
              </div>
            </UFormField>
          </div>
        </article>

        <UCheckbox v-model="reviewed" label="我已核验当前范围、执行事实及全部例外，并确认上述依据有效" :disabled="busy || reloading" />
        <UAlert v-if="exceptions.length > 50" color="warning" title="待处理事项超过 50 项，请先完成目标或关闭缺陷，再重新读取。" />
        <div class="flex flex-wrap gap-2">
          <UButton
            type="submit"
            :loading="busy"
            :disabled="!canSubmit"
          >
            确认版本验收
          </UButton>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="busy || reloading"
            @click="reload"
          >
            重新读取
          </UButton>
        </div>

        <p v-if="submitError && !busy" class="text-sm text-muted">
          输入已保留。如信息已变化，请复制内容后重新读取当前数据再提交。
        </p>
      </form>
    </template>
  </div>
</template>
