<script setup lang="ts">
interface Pin { appCode: string, releaseId: number | null }
interface Selection { sourcePolicyRevision?: number, revision: number, sourceBundleId: number | null, sourceBundleHash: string | null, pins: Pin[], releases: Array<{ appCode: string, sourceTag: string, releaseKind?: string, releaseVersion?: string }> }
interface State { selection: Selection | null, releases: Array<{ id: number, appCode: string, sourceTag: string, releaseKind?: string, releaseVersion?: string }>, audits: Array<{ id: number, actorUid: string, reason: string, createdAt: string }> }
interface Change { field: string, origin?: 'governance' | 'release', added?: unknown[], removed?: unknown[], before?: unknown, after?: unknown }
interface PolicyReview { equivalent: Array<{ field: string, before: unknown, after: unknown, behaviorChanges: number }>, real: Change[], provenance: Change[] }
interface Preview { review: PolicyReview, sensitiveConfigurationChanged: boolean, expectedRevision: number, selection: Selection, comparedBundleId: number | null, reviewHash: string, diff: Array<{ field: string, added?: unknown[], removed?: unknown[], before?: unknown, after?: unknown }> }
const request = $fetch as import('ofetch').$Fetch
const props = defineProps<{ tenantCode: string }>()
const environment = ref('prod')
const state = ref<State | null>(null)
const pins = ref<Pin[]>([])
const sourceBundleId = ref<number | undefined>()
const reason = ref('')
const error = ref('')
const busy = ref(false)
const preview = ref<Preview | null>(null)
const confirmed = ref(false)
const addApp = ref('')
const base = computed(() => `/api/platform/ops/tenants/${encodeURIComponent(props.tenantCode)}/app-releases`)
const apps = computed(() => [...new Set(state.value?.releases.map(r => r.appCode) || [])].filter(code => !pins.value.some(p => p.appCode === code)))
const displayError = (e: unknown) => {
  const v = e as { statusCode?: number, data?: { message?: string } }
  return v.statusCode === 403 ? '没有此操作的运维权限。' : v.data?.message || '版本服务暂不可用，请重试。'
}
async function load() {
  busy.value = true
  error.value = ''
  preview.value = null
  state.value = null
  try {
    const r = await request<{ data: State }>(base.value, { query: { environment: environment.value } })
    state.value = r.data
    pins.value = r.data.selection?.pins.map(p => ({ ...p })) || []
    sourceBundleId.value = r.data.selection?.sourceBundleId || undefined
  } catch (e) {
    error.value = displayError(e)
  } finally {
    busy.value = false
  }
}
function body() {
  return { environment: environment.value, expectedRevision: state.value?.selection?.revision || 0, ...(sourceBundleId.value ? { sourceBundleId: Number(sourceBundleId.value) } : {}), ...(pins.value.length || state.value?.selection ? { pins: pins.value } : {}) }
}
async function inspect() {
  busy.value = true
  error.value = ''
  preview.value = null
  confirmed.value = false
  try {
    preview.value = (await request<{ data: Preview }>(`${base.value}/preview`, { method: 'POST', body: body() })).data
  } catch (e) {
    error.value = displayError(e)
  } finally {
    busy.value = false
  }
}
async function save() {
  if (!preview.value || !confirmed.value || !reason.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    await request(base.value, { method: 'PUT', body: { ...body(), reviewHash: preview.value.reviewHash, reason: reason.value } })
    reason.value = ''
    await load()
  } catch (e) {
    error.value = displayError(e)
    preview.value = null
  } finally { busy.value = false }
}
function append() {
  if (addApp.value) pins.value.push({ appCode: addApp.value, releaseId: null })
  addApp.value = ''
}
watch([pins, sourceBundleId], () => {
  preview.value = null
  confirmed.value = false
}, { deep: true })
watch([environment, () => props.tenantCode], load, { immediate: true })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-semibold">
          环境应用版本
        </h2><USelect
          v-model="environment"
          :disabled="busy"
          :items="['prod', 'test', 'dev']"
          aria-label="环境"
        />
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-muted">
        这里只保存 manifest 版本选择，不部署应用、不签策略包。先查看完整差异，再保存；签包仍需单独操作。
      </p>
      <UAlert
        v-if="error"
        color="error"
        :description="error"
      />
      <p
        v-if="state?.selection"
        class="text-sm"
      >
        选择修订 {{ state.selection.revision }} · 来源包 {{ state.selection.sourceBundleId || '无' }}
      </p>
      <UAlert
        v-else-if="state"
        color="warning"
        description="尚未初始化。prod 签包被阻止，已有环境须先从已签基线包初始化；test/dev 保持原版本策略。"
      />
      <UFormField
        v-if="state && !state.selection"
        label="已签基线包编号"
        help="prod39 的现场记录为 bundle 40；请核对租户、环境和摘要。首次保存只初始化原版本，升级需下一次单独预览。"
      >
        <UInput
          v-model="sourceBundleId"
          type="number"
          :disabled="busy"
          placeholder="例如 40"
        />
      </UFormField>
      <div
        v-for="(pin, index) in pins"
        :key="pin.appCode"
        class="flex flex-wrap items-center gap-2"
      >
        <span class="w-24 font-medium">{{ pin.appCode }}</span>
        <USelect
          :model-value="pin.releaseId === null ? 'latest' : String(pin.releaseId)"
          :items="[{ label: '跟随 latest（released）', value: 'latest' }, ...(state?.releases.filter(r => r.appCode === pin.appCode).map(r => ({ label: r.releaseKind === 'baseline' ? `迁移基线 · ${r.releaseVersion}` : r.sourceTag, value: String(r.id) })) || [])]"
          class="min-w-0 flex-1"
          :disabled="busy"
          :aria-label="`${pin.appCode} 版本`"
          @update:model-value="pin.releaseId = $event === 'latest' ? null : Number($event)"
        />
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="busy"
          :aria-label="`移除 ${pin.appCode}`"
          @click="pins.splice(index, 1)"
        >
          移除
        </UButton>
      </div>
      <div
        v-if="state"
        class="flex flex-wrap gap-2"
      >
        <USelect
          v-model="addApp"
          :items="apps"
          placeholder="选择应用"
          :disabled="busy"
          aria-label="添加应用"
        /><UButton
          variant="outline"
          :disabled="!addApp || busy"
          @click="append"
        >
          添加
        </UButton><UButton
          :loading="busy"
          @click="inspect"
        >
          只读预览差异
        </UButton><UButton
          variant="ghost"
          :disabled="busy"
          @click="load"
        >
          刷新
        </UButton>
      </div>
      <div
        v-if="preview"
        class="space-y-3"
      >
        <p class="font-medium">
          相对包 {{ preview.comparedBundleId || '空基线' }}：{{ preview.review.real.length }} 类真实变化；{{ preview.review.equivalent.length }} 项编号等价变化
        </p>
        <p class="text-sm break-all">
          预览摘要：{{ preview.reviewHash }}
        </p>
        <p class="break-all text-xs text-muted">
          来源修订 {{ preview.selection.sourcePolicyRevision || '未知' }} · 基线摘要：{{ preview.selection.sourceBundleHash || '无' }}
        </p>
        <ul class="text-sm">
          <li
            v-for="r in preview.selection.releases"
            :key="r.appCode"
          >
            {{ r.appCode }} → {{ r.releaseKind === 'baseline' ? `迁移基线 · ${r.releaseVersion}` : r.sourceTag }}
          </li>
        </ul>
        <div
          v-for="change in preview.review.real"
          :key="`${change.origin}:${change.field}`"
          class="rounded border border-default p-3"
        >
          <h3 class="font-medium">
            {{ change.origin === 'governance' ? '治理事实变化（非本次版本选择引入）' : '发布影响 / 待审变化' }} · {{ change.field }} <span v-if="change.added">+{{ change.added.length }} / −{{ change.removed?.length }}</span>
          </h3><pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(change, null, 2) }}</pre>
        </div>
        <details
          v-if="preview.review.equivalent.length"
          class="rounded border border-default p-3"
        >
          <summary class="cursor-pointer font-medium">
            语义等价：本项行为变化 0；来源编号仍保留
          </summary>
          <p class="text-sm text-muted">
            仅同一权限及范围上下文的来源 ID 变更。整包的其他授权、动作蕴含和治理变化仍需逐项审阅。
          </p>
          <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(preview.review.equivalent, null, 2) }}</pre>
        </details>
        <details
          v-if="preview.review.provenance.length"
          class="rounded border border-default p-3"
        >
          <summary class="cursor-pointer font-medium">
            版本选择来源记录
          </summary>
          <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(preview.review.provenance, null, 2) }}</pre>
        </details>
        <details class="rounded border border-default p-3">
          <summary class="cursor-pointer font-medium">
            完整策略差异（{{ preview.diff.length }} 类，参与摘要与审计）
          </summary>
          <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(preview.diff, null, 2) }}</pre>
        </details>
        <UFormField label="变更理由">
          <UInput
            v-model="reason"
            class="w-full"
            :maxlength="500"
            :disabled="busy"
          />
        </UFormField>
        <UCheckbox
          v-model="confirmed"
          label="已核对全部增删及权限/范围变化；本次只保存选择，不签包"
        />
        <UButton
          :disabled="!confirmed || !reason.trim() || busy"
          :loading="busy"
          @click="save"
        >
          保存环境版本选择
        </UButton>
      </div>
      <details v-if="state?.audits.length">
        <summary class="cursor-pointer text-sm">
          最近变更审计
        </summary><ul class="space-y-2 pt-2 text-sm">
          <li
            v-for="audit in state.audits"
            :key="audit.id"
          >
            {{ audit.createdAt }} · {{ audit.actorUid }} · {{ audit.reason }}
          </li>
        </ul>
      </details>
    </div>
  </UCard>
</template>
