<script setup lang="ts">
import type { ServiceRole } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

usePageTitle('从 GitLab 导入应用')

const router = useRouter()
const toast = useToast()
const pending = ref(false)

interface FetchLikeError extends Error {
  statusCode?: number
  status?: number
  data?: {
    code?: string
    appCode?: string
    message?: string
    statusMessage?: string
    statusCode?: number
  }
}

const form = reactive({
  repoUrl: '',
  version: '',
  ref: '',
  manifestPath: 'app.manifest.json',
  appCode: '',
  appName: '',
  serviceRole: 'business_app' as ServiceRole
})

const roleItems = [
  { label: '业务应用 (business_app)', value: 'business_app' },
  { label: '目录运行时 (directory_runtime)', value: 'directory_runtime' },
  { label: '工作流运行时 (workflow_runtime)', value: 'workflow_runtime' },
  { label: '平台服务 (supporting_service)', value: 'supporting_service' }
]

function importErrorMessage(error: unknown) {
  const fetchError = error as FetchLikeError
  const statusCode = fetchError.statusCode || fetchError.status || fetchError.data?.statusCode
  if (statusCode === 409 || fetchError.data?.code === 'APPLICATION_ALREADY_EXISTS') {
    const appCode = fetchError.data?.appCode || form.appCode || '该应用'
    return `${appCode} 已存在，不能重复导入。请进入应用详情页，通过“从 GitLab 拉取新版本”更新 release。`
  }

  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '请检查 GitLab 地址、版本和 manifest 路径。'
}

async function submit() {
  pending.value = true
  try {
    const response = await platformFetchJson<{
      success: true
      data: { application: { appCode: string } }
    }>('/api/platform/ops/applications/from-manifest', {
      method: 'POST',
      body: {
        repoUrl: form.repoUrl,
        version: form.version,
        ref: form.ref || undefined,
        manifestPath: form.manifestPath || undefined,
        appCode: form.appCode || undefined,
        appName: form.appName || undefined,
        serviceRole: form.serviceRole
      }
    })

    toast.add({
      title: '应用已导入',
      description: response.data.application.appCode,
      color: 'success'
    })
    await router.push(`/admin/applications/${response.data.application.appCode}`)
  } catch (error) {
    toast.add({
      title: '导入失败',
      description: importErrorMessage(error),
      color: 'error'
    })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="max-w-[760px]">
    <UBreadcrumb
      :items="[
        { label: '工作台', to: '/admin' },
        { label: '应用', to: '/admin/applications' },
        { label: '从 GitLab 导入' }
      ]"
      class="mb-3.5"
    />

    <div class="page-h">
      <div>
        <h1>从 GitLab 导入应用</h1>
        <p>读取仓库中的 app.manifest.json，创建应用、manifest 和初始 release。</p>
      </div>
    </div>

    <UCard>
      <div class="col gap-4">
        <UFormField
          label="GitLab 仓库 URL"
          required
        >
          <UInput
            v-model="form.repoUrl"
            placeholder="https://gitlab.example.com/group/app"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField
            label="Release / Tag"
            required
          >
            <UInput
              v-model="form.version"
              placeholder="v1.0.0"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
          <UFormField label="Git ref">
            <UInput
              v-model="form.ref"
              placeholder="默认等于 release/tag"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
        </div>

        <UFormField label="Manifest 路径">
          <UInput
            v-model="form.manifestPath"
            class="w-full"
            :ui="{ base: 'font-mono' }"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="覆盖 App Code">
            <UInput
              v-model="form.appCode"
              placeholder="默认读取 manifest.appCode"
              class="w-full"
              :ui="{ base: 'font-mono' }"
            />
          </UFormField>
          <UFormField label="覆盖应用名称">
            <UInput
              v-model="form.appName"
              placeholder="默认读取 manifest.appName"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="服务定位">
          <USelect
            v-model="form.serviceRole"
            :items="roleItems"
            class="w-full"
          />
        </UFormField>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            to="/admin/applications"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-download-cloud"
            :loading="pending"
            :disabled="!form.repoUrl || !form.version"
            @click="submit"
          >
            导入
          </UButton>
        </div>
      </template>
    </UCard>
  </div>
</template>
