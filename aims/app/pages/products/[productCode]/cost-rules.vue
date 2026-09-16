<script setup lang="ts">
definePageMeta({ layoutHeaderTitle: '产品成本分摊规则' })
interface Rules { revision: number, evidenceRef: string, shares: Array<{ productCode: string, basisPoints: number }> }
interface Submission { requestId: string, projectCode: string, periodMonth: string, expectedRevision: number, evidenceRef: string, shares: Rules['shares'] }
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const project = ref<{ id: number, project_code: string, name: string } | null>(null)
const period = ref(new Date().toISOString().slice(0, 7))
const baseline = ref<Rules | null>(null)
const rows = ref<Array<{ productCode: string, percent: string }>>([])
const evidence = ref('')
const busy = ref(false)
const error = shallowRef<unknown>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '分摊规则操作失败' })
const submission = ref<Submission | null>(null)
const recovered = ref<{ requestId: string, projectCode: string } | null>(null)
const activeRequest = computed(() => submission.value || recovered.value)
const storageKey = computed(() => `aims:cost-rule-request:${code.value}`)
const state = ref('')
const { confirm } = useConfirm()
const terminal = computed(() => ['succeeded', 'cancelled', 'failed_permanent', 'dead_letter'].includes(state.value))
const locked = computed(() => busy.value || activeRequest.value !== null)
const shares = computed(() => rows.value.map(row => ({
  productCode: row.productCode.trim(),
  basisPoints: /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(row.percent) ? Math.round(Number(row.percent) * 100) : NaN
})))
const total = computed(() => shares.value.reduce((sum, row) => sum + row.basisPoints, 0))
const valid = computed(() => !!baseline.value && !!evidence.value.trim() && shares.value.every(row => row.productCode && Number.isSafeInteger(row.basisPoints) && row.basisPoints > 0 && row.basisPoints <= 10000) && total.value <= 10000 && new Set(shares.value.map(row => row.productCode)).size === shares.value.length)
const stateText = computed(() => ({ pending: '已排队，等待处理', processing: '正在处理', retry_wait: '暂未成功，后台将重试', partial_unknown: '正在核实执行结果', succeeded: '规则已生效', cancelled: '提交已取消', failed_permanent: '提交失败，请重新读取规则后修改', dead_letter: '多次重试未成功，请联系管理员检查任务', unknown: '提交结果尚未确认，请查询状态或重试原请求' }[state.value] || ''))
watch([() => project.value?.id, period], () => {
  baseline.value = null
  rows.value = []
  evidence.value = ''
  error.value = null
})
const path = () => `/api/v1/projects/${project.value!.id}/product-cost-rules`
async function load() {
  if (!project.value || busy.value || (activeRequest.value && !terminal.value)) return
  busy.value = true
  error.value = null
  baseline.value = null
  try {
    const response = await $fetch<{ code: number, data: Rules }>(path(), { query: { projectCode: project.value.project_code, periodMonth: period.value } })
    if (response.code !== 0) throw new Error('规则读取失败')
    baseline.value = response.data
    rows.value = response.data.shares.map(row => ({ productCode: row.productCode, percent: (row.basisPoints / 100).toFixed(2) }))
    evidence.value = response.data.evidenceRef
    submission.value = null
    recovered.value = null
    try {
      sessionStorage.removeItem(storageKey.value)
    } catch { /* Storage is optional. */ }
    state.value = ''
  } catch (cause) {
    error.value = cause
  } finally {
    busy.value = false
  }
}
async function save() {
  if (busy.value || !project.value || recovered.value) return
  if (!submission.value) {
    if (!valid.value || !baseline.value) return
    if (!await confirm({ title: '保存完整分摊规则', message: `将替换“${project.value.name}”${period.value}的全部产品分摊，合计 ${(total.value / 100).toFixed(2)}%。${rows.value.length ? '' : '当前明细为空，将清空该月份分摊。'}`, tone: 'warning', confirmLabel: '确认提交' })) return
    submission.value = { requestId: crypto.randomUUID(), projectCode: project.value.project_code, periodMonth: period.value, expectedRevision: baseline.value.revision, evidenceRef: evidence.value, shares: shares.value }
  }
  busy.value = true
  error.value = null
  state.value = 'unknown'
  try {
    sessionStorage.setItem(storageKey.value, JSON.stringify({ requestId: submission.value.requestId, projectId: project.value.id, projectCode: project.value.project_code, periodMonth: period.value }))
  } catch { /* Saving rules does not depend on browser storage. */ }
  try {
    const response = await $fetch<{ code: number, data: { synced: boolean } }>(path(), { method: 'POST', body: submission.value, timeout: 30000 })
    if (response.code !== 0) throw new Error('提交未确认')
    state.value = response.data.synced ? 'succeeded' : 'pending'
  } catch (cause) {
    error.value = cause
    const status = Number((cause as { statusCode?: number })?.statusCode)
    if ([400, 401, 403, 404, 409, 422].includes(status)) state.value = 'failed_permanent'
  } finally {
    busy.value = false
  }
}
async function checkStatus() {
  if (!activeRequest.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    const response = await $fetch<{ code: number, data: { status: string } }>(`${path()}/${activeRequest.value.requestId}`, { query: { projectCode: activeRequest.value.projectCode } })
    if (response.code !== 0) throw new Error('状态读取失败')
    state.value = response.data.status
  } catch (cause) {
    error.value = cause
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  try {
    const raw = sessionStorage.getItem(storageKey.value)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (!saved || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saved.requestId)
      || !Number.isSafeInteger(saved.projectId) || saved.projectId <= 0 || typeof saved.projectCode !== 'string'
      || !saved.projectCode || saved.projectCode.length > 100 || typeof saved.periodMonth !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(saved.periodMonth)) return
    project.value = { id: saved.projectId, project_code: saved.projectCode, name: saved.projectCode }
    period.value = saved.periodMonth
    recovered.value = { requestId: saved.requestId, projectCode: saved.projectCode }
    state.value = 'unknown'
    await nextTick()
    await checkStatus()
  } catch { /* Invalid or unavailable browser storage is not an authorization source. */ }
})
async function forgetRecovery() {
  if (!recovered.value || busy.value) return
  if (!await confirm({ title: '停止跟踪此请求', message: '这只移除当前标签页的恢复记录，不会取消后台任务。请先记录请求编号，必要时联系管理员核实执行结果。', tone: 'warning', confirmLabel: '停止跟踪' })) return
  try {
    sessionStorage.removeItem(storageKey.value)
  } catch { /* Optional storage. */ }
  recovered.value = null
  state.value = ''
  error.value = null
}
onBeforeRouteLeave(async () => {
  if (!activeRequest.value || terminal.value) return true
  return await confirm({ title: '离开规则编辑', message: `提交结果尚未确认。离开不会取消后台任务，请记录请求编号：${activeRequest.value.requestId}。`, tone: 'warning', confirmLabel: '离开页面' })
})
</script>

<template>
  <div class="min-w-0 space-y-5 p-4 sm:p-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">
        产品成本分摊规则
      </h1>
      <UButton :to="`/products/${encodeURIComponent(code)}/cost`" color="neutral" variant="outline">
        返回经营结果
      </UButton>
    </div>
    <UAlert color="info" title="按项目和月份维护完整规则" description="此处会影响同一项目下的所有分摊产品。需要 AIMS 项目编辑及 Finance 项目核算编辑权限；未分配的比例保留为未归属成本。" />
    <ProductsCostProjectPicker v-model="project" :product-code="code" :disabled="locked" />
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="分摊月份" required>
        <UInput v-model="period" type="month" :disabled="locked" />
      </UFormField>
      <UButton :loading="busy" :disabled="!project || (!!activeRequest && !terminal)" @click="load">
        {{ terminal ? '重新读取并编辑' : '读取完整规则' }}
      </UButton>
    </div>
    <UAlert v-if="error" v-bind="alert" />
    <UAlert
      v-if="recovered"
      color="info"
      title="已恢复上次提交的查询"
      description="恢复记录仅保存请求标识。当前状态和访问权限由服务端重新核验；规则生效后请重新读取。"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="forgetRecovery"
        >
          停止跟踪
        </UButton>
      </template>
    </UAlert>
    <UAlert v-if="state" :color="state === 'succeeded' ? 'success' : terminal ? 'error' : 'warning'" :title="stateText">
      <template #description>
        <p class="break-all">
          请求编号：{{ activeRequest?.requestId }}
        </p>
        <div v-if="!terminal" class="mt-2 flex flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="busy"
            @click="checkStatus"
          >
            查询状态
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="busy"
            @click="save"
          >
            重试原请求
          </UButton>
        </div>
      </template>
    </UAlert>
    <section v-if="baseline" class="min-w-0 space-y-4 rounded-lg border border-default p-4">
      <p class="text-sm text-muted">
        当前修订：{{ baseline.revision }} · 比例最多保留两位小数
      </p>
      <div v-for="(row, index) in rows" :key="index" class="grid min-w-0 gap-3 sm:grid-cols-[1fr_150px_auto]">
        <UFormField :label="`产品编码 ${index + 1}`" required>
          <UInput v-model="row.productCode" class="w-full" :disabled="locked" />
        </UFormField>
        <UFormField label="分摊比例（%）" required>
          <UInput
            v-model="row.percent"
            inputmode="decimal"
            class="w-full"
            :disabled="locked"
          />
        </UFormField>
        <UButton
          color="neutral"
          variant="ghost"
          class="self-end"
          :disabled="locked"
          @click="rows.splice(index, 1)"
        >
          移除
        </UButton>
      </div>
      <p v-if="!rows.length" class="text-sm text-muted">
        尚无分摊明细。保存空明细将清空当前月份规则。
      </p>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="locked"
        @click="rows.push({ productCode: '', percent: '' })"
      >
        添加产品
      </UButton>
      <p :class="total > 10000 ? 'text-error' : 'text-muted'" class="text-sm">
        已分配：{{ Number.isFinite(total) ? (total / 100).toFixed(2) : '—' }}% · 未分配：{{ Number.isFinite(total) && total <= 10000 ? ((10000 - total) / 100).toFixed(2) : '—' }}%
      </p>
      <UFormField label="分摊依据" required>
        <UTextarea
          v-model="evidence"
          class="w-full"
          :disabled="locked"
          placeholder="说明分摊依据或填写审批记录标识"
        />
      </UFormField>
      <UButton :loading="busy" :disabled="locked || !valid" @click="save">
        保存完整规则
      </UButton>
    </section>
  </div>
</template>
