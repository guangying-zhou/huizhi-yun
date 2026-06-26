<script setup lang="ts">
import type { ApiEnvelope, OpsApplication, OpsApplicationList } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const code = computed(() => String(route.params.code))
const pending = ref(false)
const deletePending = ref(false)
const deleteModalOpen = ref(false)

interface FetchLikeError extends Error {
  data?: {
    message?: string
    statusMessage?: string
  }
}

const data = ref<ApiEnvelope<OpsApplicationList> | null>(null)

async function refresh() {
  data.value = await $fetch('/api/platform/ops/applications', {
    query: {
      appCode: code.value,
      pageSize: 1
    }
  }) as ApiEnvelope<OpsApplicationList>
}

watch(code, () => {
  void refresh()
})

await refresh()
const app = computed<OpsApplication | null>(() => data.value?.data.items[0] || null)
const form = reactive({
  appName: '',
  description: '',
  serviceRole: 'business_app',
  homeUrl: '',
  callbackUrl: '',
  logoutUrl: '',
  repoUrl: ''
})

function deriveOidcCallbackUrl(homeUrl: string) {
  const normalized = homeUrl.trim()
  if (!normalized) return ''

  try {
    const url = new URL(normalized)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return ''
    }

    url.search = ''
    url.hash = ''

    return `${url.toString().replace(/\/+$/, '')}/api/auth/oidc-callback`
  } catch {
    return ''
  }
}

const defaultCallbackUrl = computed(() => form.callbackUrl.trim() ? '' : deriveOidcCallbackUrl(form.homeUrl))

const roleItems = [
  { label: '业务应用 (business_app)', value: 'business_app' },
  { label: '目录运行时 (directory_runtime)', value: 'directory_runtime' },
  { label: '工作流运行时 (workflow_runtime)', value: 'workflow_runtime' },
  { label: '平台服务 (supporting_service)', value: 'supporting_service' }
]

function resetForm() {
  if (!app.value) return
  form.appName = app.value.appName
  form.description = app.value.description || ''
  form.serviceRole = app.value.serviceRole
  form.homeUrl = app.value.homeUrl || ''
  form.callbackUrl = app.value.callbackUrl || ''
  form.logoutUrl = app.value.logoutUrl || ''
  form.repoUrl = app.value.repoUrl || ''
}

watch(app, resetForm, { immediate: true })

function errorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || fallback
}

async function save() {
  if (!app.value) return
  pending.value = true
  try {
    await $fetch(`/api/platform/ops/applications/${app.value.id}`, {
      method: 'PATCH',
      body: {
        appName: form.appName,
        description: form.description,
        serviceRole: form.serviceRole,
        homeUrl: form.homeUrl.trim() || null,
        callbackUrl: form.callbackUrl.trim() || null,
        logoutUrl: form.logoutUrl.trim() || null,
        repoUrl: form.repoUrl
      }
    })
    await refresh()
    toast.add({ title: '应用设置已保存', color: 'success' })
  } catch (error) {
    toast.add({
      title: '保存失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}

async function updateStatus(status: 'active' | 'suspended') {
  if (!app.value) return
  pending.value = true
  try {
    await $fetch(`/api/platform/ops/applications/${app.value.id}`, {
      method: 'PATCH',
      body: { status }
    })
    await refresh()
    toast.add({ title: status === 'active' ? '应用已恢复' : '应用已暂停', color: 'success' })
  } catch (error) {
    toast.add({
      title: '状态更新失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}

async function deleteApplication() {
  if (!app.value) return

  deletePending.value = true
  try {
    await $fetch(`/api/platform/ops/applications/${app.value.id}`, {
      method: 'DELETE'
    })
    toast.add({ title: '应用已删除', color: 'success' })
    await router.push('/admin/applications')
  } catch (error) {
    toast.add({
      title: '删除失败',
      description: errorMessage(error, '该应用可能仍有关联 release、manifest、订阅或部署。'),
      color: 'error'
    })
  } finally {
    deletePending.value = false
    deleteModalOpen.value = false
  }
}
</script>

<template>
  <div
    v-if="app"
    class="mt-4 grid max-w-[720px] grid-cols-1 gap-4"
  >
    <UCard>
      <template #header>
        <div class="row-between">
          <h3 class="text-sm font-semibold text-highlighted">
            基本信息
          </h3>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="resetForm"
          >
            取消
          </UButton>
        </div>
      </template>

      <div class="col gap-3.5">
        <UFormField
          label="应用 Code"
          help="唯一标识，创建后不可修改"
        >
          <UInput
            :model-value="app.appCode"
            disabled
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="应用名称">
          <UInput
            v-model="form.appName"
            class="w-full"
          />
        </UFormField>
        <UFormField label="描述">
          <UInput
            v-model="form.description"
            class="w-full"
          />
        </UFormField>
        <UFormField label="服务定位">
          <USelect
            v-model="form.serviceRole"
            :items="roleItems"
            class="w-full"
          />
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h3 class="text-sm font-semibold text-highlighted">
          集成与回调
        </h3>
      </template>

      <div class="col gap-3.5">
        <UFormField
          label="主页 URL"
          help="应用默认访问地址；租户 deployment runtimeEndpoint 会优先覆盖。"
        >
          <UInput
            v-model="form.homeUrl"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField
          label="OIDC 回调 URL 覆盖"
          :help="defaultCallbackUrl ? `留空将使用 ${defaultCallbackUrl}` : '默认按主页 URL + /api/auth/oidc-callback 生成；特殊应用才需要覆盖。'"
        >
          <UInput
            v-model="form.callbackUrl"
            class="w-full"
            placeholder="默认由主页 URL 自动生成"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="Logout 回调">
          <UInput
            v-model="form.logoutUrl"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="GitLab 仓库">
          <UInput
            v-model="form.repoUrl"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
        <UFormField label="Manifest 拉取分支">
          <UInput
            model-value="main"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="resetForm"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            :loading="pending"
            :disabled="!form.appName"
            @click="save"
          >
            保存
          </UButton>
        </div>
      </template>
    </UCard>

    <UCard>
      <template #header>
        <h3 class="text-sm font-semibold text-highlighted">
          危险操作
        </h3>
      </template>

      <div class="col gap-3">
        <div class="row-between items-start gap-4">
          <div>
            <div class="font-medium text-highlighted">
              暂停应用
            </div>
            <div class="mt-0.5 max-w-[460px] text-sm text-muted">
              所有租户暂时无法访问该应用，部署保留。可随时恢复。
            </div>
          </div>
          <UButton
            color="neutral"
            variant="outline"
            :loading="pending"
            @click="updateStatus(app.status === 'active' ? 'suspended' : 'active')"
          >
            {{ app.status === 'active' ? '暂停' : '恢复' }}
          </UButton>
        </div>
        <USeparator />
        <div class="row-between items-start gap-4">
          <div>
            <div class="font-medium text-highlighted">
              删除应用
            </div>
            <div class="mt-0.5 max-w-[460px] text-sm text-muted">
              永久删除应用、所有 release 与 manifest。订阅该应用的租户将解除关联。
            </div>
          </div>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            :loading="deletePending"
            @click="deleteModalOpen = true"
          >
            删除...
          </UButton>
        </div>
      </div>
    </UCard>

    <UModal
      v-model:open="deleteModalOpen"
      title="删除应用"
      :description="`确定删除 ${app.appCode} 吗？该操作会清理未被业务绑定的 release、manifest 与资源快照。`"
    >
      <template #body>
        <UAlert
          color="error"
          variant="soft"
          icon="i-lucide-triangle-alert"
          title="该操作不可撤销"
          description="如果应用仍被套餐、订阅或部署引用，系统会拒绝删除并提示需要先解除的关联。"
        />
      </template>

      <template #footer="{ close }">
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="deletePending"
            @click="close"
          >
            取消
          </UButton>
          <UButton
            color="error"
            icon="i-lucide-trash-2"
            :loading="deletePending"
            @click="deleteApplication"
          >
            确认删除
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
