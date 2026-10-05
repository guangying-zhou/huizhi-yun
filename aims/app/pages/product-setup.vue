<script setup lang="ts">
definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品接入与目录管理', layoutHeaderProjectSwitcher: false })
const { data, status, error, refresh } = await useFetch('/api/v1/product-permissions', {
  server: false,
  transform: (response: { code: number, data: { onboard: boolean } }) => {
    if (response.code !== 0 || typeof response.data?.onboard !== 'boolean') throw new Error('产品接入权限响应不完整')
    return response.data
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '产品接入权限加载失败' })
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(() => refresh()))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 space-y-4 p-4 sm:p-6">
    <p class="text-sm text-muted">
      接入 Assets 产品并维护目录。产品空间的日常访问按各产品授权管理。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-else-if="status === 'pending'" role="status" class="text-sm text-muted">
      正在核验产品接入权限…
    </p>
    <template v-else-if="status === 'success' && data?.onboard">
      <ProductsOnboardForm />
      <ProductsCatalogRefresh />
    </template>
    <UAlert
      v-else-if="status === 'success'"
      color="warning"
      title="缺少产品接入权限"
      description="需要明确的全租户产品接入授权，请联系企业授权管理员。"
    />
  </div>
</template>
