<script setup lang="ts">
definePageMeta({ layout: 'platform' })
usePageTitle('企业全量技术开通')
const tenantCode = ref(String(useRoute().query.tenantCode || ''))
const environment = ref('prod')
const pending = ref(false), error = ref('')
const result = ref<{ tenant: { onboardingStage: string }, deployment: { deploymentCode: string }, license: { licenseCode: string }, consoleEnv: string | null, runtimeToken: string | null, subjectReady: boolean } | null>(null)
async function provision() {
  pending.value = true
  error.value = ''
  result.value = null
  try {
    const response = await platformFetchJson<{ success: true, data: NonNullable<typeof result.value> }>('/api/platform/ops/onboarding/start', { method: 'POST', body: { tenantCode: tenantCode.value.trim(), planCode: 'enterprise-full', environment: environment.value, generateBundle: true } })
    result.value = response.data
  } catch (caught) {
    error.value = (caught as { data?: { message?: string } }).data?.message || '技术开通未完成，请核对企业资格、站点与应用登记。'
  } finally { pending.value = false }
}
function downloadEnv() {
  if (!result.value?.consoleEnv) return
  const url = URL.createObjectURL(new Blob([result.value.consoleEnv], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${tenantCode.value}-${environment.value}-console.env`
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div>
      <h1 class="text-xl font-semibold">
        企业全量技术开通
      </h1><p class="mt-1 text-sm text-muted">
        使用已批准并生效的企业资格准备部署与交付材料。
      </p>
    </div>
    <UAlert
      color="info"
      variant="soft"
      title="开通前提"
      description="企业站点须已配置为 Enterprise 根应用，Host 与逻辑模块清单已登记。服务期间直接取企业资格，暂停或撤销状态不会由开通恢复。"
    />
    <UCard>
      <form
        class="space-y-4"
        @submit.prevent="provision"
      >
        <UFormField
          label="企业编码"
          required
        >
          <UInput
            v-model="tenantCode"
            required
            class="w-full"
          />
        </UFormField><UFormField
          label="环境"
          required
        >
          <USelect
            v-model="environment"
            :items="[{ label: '生产', value: 'prod' }, { label: '测试', value: 'test' }]"
            class="w-full"
          />
        </UFormField><UButton
          type="submit"
          label="准备技术开通"
          :loading="pending"
        />
      </form>
    </UCard>
    <UAlert
      v-if="error"
      color="error"
      title="开通未完成"
      :description="error"
    />
    <UCard v-if="result">
      <div class="space-y-3">
        <h2 class="font-semibold">
          技术材料已准备
        </h2><p class="text-sm">
          部署：{{ result.deployment.deploymentCode }} · License：{{ result.license.licenseCode }}
        </p><UAlert
          :color="result.subjectReady ? 'success' : 'warning'"
          :title="result.subjectReady ? '已完成主体同步' : '等待企业主体同步'"
          description="实际环境部署、连接检查及业务验收完成后才能交付使用。"
        /><p
          v-if="!result.runtimeToken"
          class="text-sm text-muted"
        >
          已复用现有运行凭据；下载文件中的凭据占位符需使用原交付值，不会自动旋转。
        </p><UButton
          v-if="result.consoleEnv"
          label="下载 Console 环境材料"
          icon="i-lucide-download"
          variant="soft"
          @click="downloadEnv"
        /><UButton
          to="/admin/deployments"
          label="查看部署"
          variant="ghost"
        />
      </div>
    </UCard>
  </div>
</template>
