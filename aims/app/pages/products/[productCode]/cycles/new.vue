<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '新增规划周期', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/planning-cycles/permissions`, {
  server: false,
  transform: (response: { code: number, data: { product_code: string, status: string, revision: number, edit: boolean } }) => {
    if (response.code !== 0 || response.data?.product_code !== code.value || !Number.isSafeInteger(response.data.revision) || response.data.revision < 1 || typeof response.data.edit !== 'boolean') throw new Error('周期权限响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '周期创建权限加载失败' })
const toast = useToast()
async function back() {
  await navigateTo(`/products/${encodeURIComponent(code.value)}/cycles`)
}
async function saved() {
  toast.add({ title: '周期草案已保存', color: 'success' })
  await back()
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在读取产品状态与权限…
    </p>
    <ProductsPlanningCycleForm
      v-else-if="status === 'success' && data?.edit && data.status === 'active'"
      :key="`${code}:${data.revision}`"
      :product-code="code"
      :workspace-revision="data.revision"
      @saved="saved"
      @cancel="back"
    />
    <template v-else>
      <p v-if="status === 'success'" class="text-sm text-muted">
        当前产品已归档或您没有创建周期的权限。
      </p>
      <UButton color="neutral" variant="outline" @click="refresh()">
        重新读取
      </UButton>
      <UButton color="neutral" variant="ghost" @click="back">
        返回周期列表
      </UButton>
    </template>
  </div>
</template>
