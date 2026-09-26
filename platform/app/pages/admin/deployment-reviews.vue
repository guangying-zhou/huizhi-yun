<script setup lang="ts">
usePageTitle('部署审阅')

definePageMeta({ layout: 'console' })

type ReviewKind = 'external-drain' | 'drain-activity'
type ReviewInput = Record<string, unknown> & { mode?: string }
type ApiError = { data?: { message?: string, statusMessage?: string }, message?: string }

const permission = usePlatformPermission()
const kind = ref<ReviewKind>('external-drain')
const input = ref<ReviewInput | null>(null)
const inputName = ref('')
const inputFingerprint = ref('')
const plannedFingerprint = ref('')
const planResult = ref<unknown>(null)
const notice = ref<{ color: 'success' | 'error', message: string } | null>(null)
const pending = ref(false)
const pastedJson = ref('')

const authorizationLoaded = permission.loaded
const canOperate = computed(() => authorizationLoaded.value && permission.hasPermission('ops.deployments', 'admin'))
const planPassed = computed(() => !!plannedFingerprint.value && plannedFingerprint.value === inputFingerprint.value)
const endpoint = computed(() => `/api/platform/ops/deployments/${kind.value}`)
const kindLabel = computed(() => kind.value === 'external-drain' ? '外部排空审阅' : '在途活动审阅')
const requestContext = computed(() => {
  const value = input.value
  if (!value) return { tenant: '', environment: '' }
  try {
    const envelope = kind.value === 'external-drain' ? value.seal : value.snapshot
    const payload = envelope && typeof envelope === 'object' && typeof (envelope as Record<string, unknown>).payload === 'string'
      ? JSON.parse(String((envelope as Record<string, unknown>).payload))
      : null
    return {
      tenant: String(payload?.tenant || value.tenant || value.tenantCode || ''),
      environment: String(payload?.environment || value.environment || '')
    }
  } catch {
    return { tenant: '', environment: '' }
  }
})

function errorMessage(error: unknown) {
  const value = error as ApiError
  return value.data?.message || value.data?.statusMessage || value.message || '请求失败，请检查输入和运维权限。'
}

function resetReview() {
  input.value = null
  inputName.value = ''
  inputFingerprint.value = ''
  plannedFingerprint.value = ''
  planResult.value = null
  notice.value = null
  pastedJson.value = ''
}

async function fingerprint(value: ReviewInput) {
  const bytes = new TextEncoder().encode(JSON.stringify({ kind: kind.value, endpoint: endpoint.value, input: value }))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function requiredFields() {
  return kind.value === 'external-drain'
    ? ['report', 'seal', 'decisions', 'requestId', 'approvalReference']
    : ['snapshot', 'activityId', 'requestId', 'decision']
}

function parseRequest(raw: string) {
  if (new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024) throw new Error('请求 JSON 不能超过 2MB。')
  const parsed = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 根节点必须是对象。')
  const value = parsed as ReviewInput
  if (requiredFields().some(key => !(key in value))) throw new Error(`缺少${kindLabel.value}请求字段。`)
  return value
}

async function loadRequest(raw: string, name: string) {
  const value = parseRequest(raw)
  input.value = value
  inputName.value = name
  inputFingerprint.value = await fingerprint(value)
  plannedFingerprint.value = ''
  planResult.value = null
}

function invalidatePastedPlan() {
  input.value = null
  inputName.value = ''
  inputFingerprint.value = ''
  plannedFingerprint.value = ''
  planResult.value = null
}

async function importRequest(event: Event) {
  if (!canOperate.value || pending.value) return
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  pending.value = true
  notice.value = null
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('请求 JSON 不能超过 2MB。')
    await loadRequest(await file.text(), file.name)
    pastedJson.value = ''
  } catch (error) {
    resetReview()
    notice.value = { color: 'error', message: errorMessage(error) }
  } finally {
    pending.value = false
    target.value = ''
  }
}

async function importPastedRequest() {
  if (!canOperate.value || pending.value || !pastedJson.value.trim()) return
  pending.value = true
  notice.value = null
  try {
    await loadRequest(pastedJson.value, '粘贴请求 JSON')
  } catch (error) {
    resetReview()
    notice.value = { color: 'error', message: errorMessage(error) }
  } finally {
    pending.value = false
  }
}

async function submit(mode: 'plan' | 'approve') {
  if (!canOperate.value || pending.value || !input.value) return
  if (mode === 'approve' && !planPassed.value) return
  pending.value = true
  notice.value = null
  if (mode === 'plan') {
    plannedFingerprint.value = ''
    planResult.value = null
  }
  try {
    const current = await fingerprint(input.value)
    if (current !== inputFingerprint.value || (mode === 'approve' && current !== plannedFingerprint.value)) {
      throw new Error('请求内容已变化，请重新导入并重新检查请求。')
    }
    const response = await platformFetchJson<Record<string, unknown>>(endpoint.value, {
      method: 'POST',
      body: { ...input.value, mode }
    })
    if (!response || typeof response !== 'object' || (mode === 'plan' && response.applied !== false)) {
      throw new Error('服务端未返回通过 plan 的结果。')
    }
    planResult.value = response
    if (mode === 'plan') plannedFingerprint.value = current
    notice.value = { color: 'success', message: mode === 'plan' ? '请求检查通过；确认内容未变化后才可批准。' : '审批请求已提交。' }
  } catch (error) {
    notice.value = { color: 'error', message: errorMessage(error) }
    if (mode === 'approve') plannedFingerprint.value = ''
  } finally {
    pending.value = false
  }
}

onMounted(() => permission.loadAuthorization())
watch(kind, resetReview)
</script>

<template>
  <UDashboardPanel id="platform-deployment-reviews" :ui="{ body: 'gap-4 sm:p-4' }">
    <template #body>
      <UCard>
        <template #header>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.24em] text-primary">Deployment Operations</p>
              <h1 class="text-xl font-semibold text-highlighted">部署审阅</h1>
              <p class="mt-1 text-sm text-muted">导入已准备的非密钥 JSON，请先检查请求；审批只允许使用同一份未变化的请求。</p>
            </div>
            <UButton to="/admin/deployments" color="neutral" variant="ghost" icon="i-lucide-arrow-left">返回部署</UButton>
          </div>
        </template>

        <UAlert v-if="!authorizationLoaded" color="neutral" variant="subtle" title="正在检查运维权限…" />
        <UAlert v-else-if="!canOperate" color="error" variant="subtle" title="没有部署审阅权限" description="需要 ops.deployments:admin。" />

        <div v-else class="space-y-5">
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="审阅类型">
              <USelect v-model="kind" :disabled="pending" :items="[{ label: '外部排空审阅', value: 'external-drain' }, { label: '在途活动审阅', value: 'drain-activity' }]" />
            </UFormField>
            <UFormField label="请求文件（JSON）" hint="仅导入 report/seal/review 或 snapshot/decision 等非密钥内容">
              <UInput type="file" accept="application/json,.json" :disabled="pending" @change="importRequest" />
            </UFormField>
          </div>

          <UFormField label="粘贴请求 JSON" hint="最多 2MB；编辑草稿会立即撤销之前的检查结果，载入后与文件导入共用同一校验。">
            <div class="space-y-2">
              <UTextarea v-model="pastedJson" class="w-full" :rows="5" :disabled="pending" placeholder="粘贴已准备的非密钥 JSON" @input="invalidatePastedPlan" />
              <UButton color="neutral" variant="soft" icon="i-lucide-clipboard-paste" :loading="pending" :disabled="!pastedJson.trim()" @click="importPastedRequest">载入粘贴内容</UButton>
            </div>
          </UFormField>

          <UAlert v-if="input" color="info" variant="subtle" :title="`${inputName} · ${kindLabel}`" :description="`tenant=${requestContext.tenant || '未识别'} · environment=${requestContext.environment || '未识别'}。服务端将继续校验证据和审批字段；浏览器不会读取或展示凭据。`" />
          <UAlert v-if="notice" :color="notice.color" variant="subtle" :title="notice.message" />

          <div class="flex flex-wrap gap-2">
            <UButton color="primary" icon="i-lucide-scan-search" :loading="pending" :disabled="!input" @click="submit('plan')">检查请求</UButton>
            <UButton color="error" icon="i-lucide-shield-check" :loading="pending" :disabled="!planPassed" @click="submit('approve')">批准</UButton>
            <UButton color="neutral" variant="ghost" :disabled="pending" @click="resetReview">清空</UButton>
          </div>

          <div v-if="planResult" class="rounded-lg border border-muted bg-elevated p-3">
            <p class="mb-2 text-sm font-medium text-highlighted">服务端结果</p>
            <pre class="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-muted">{{ JSON.stringify(planResult, null, 2) }}</pre>
          </div>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
