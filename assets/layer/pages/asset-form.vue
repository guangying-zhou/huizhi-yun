<script setup lang="ts">
import CommonEmptyState from '../../../foundation/app/components/common/EmptyState.vue'
import DigitalAssetCreateModal from '../../app/components/assets/DigitalAssetCreateModal.vue'
import DigitalAssetEditModal from '../../app/components/assets/DigitalAssetEditModal.vue'
import IpAssetCreateModal from '../../app/components/assets/IpAssetCreateModal.vue'
import IpAssetEditModal from '../../app/components/assets/IpAssetEditModal.vue'
import type { ApiResponse, DigitalAssetItem, IpAssetItem } from '../../app/types'
import { useAssetsModule } from '../useAssetsModule'

definePageMeta({ hostContentInset: false })
const route = useRoute()
const { moduleUrl, cacheKey } = useAssetsModule()
const digital = route.path.startsWith(moduleUrl('/digital-assets'))
const collection = digital ? 'digital-assets' : 'ip-assets'
const assetId = String(route.params.id || '')
const editing = Boolean(assetId)
const fallback = moduleUrl(editing ? `/${collection}/${encodeURIComponent(assetId)}` : `/${collection}`)
const returnPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  return value.split(/[?#]/)[0] === fallback ? value : fallback
})
const { data: writeAccess, error: accessError, refresh: refreshAccess } = await useFetch<ApiResponse<{ digital_assets: boolean, ip_assets: boolean }>>(moduleUrl('/api/v1/write-access'), { key: cacheKey('assets-write-access') })
const canEdit = computed(() => digital ? writeAccess.value?.data?.digital_assets === true : writeAccess.value?.data?.ip_assets === true)
const { data, pending, error, refresh } = await useFetch<ApiResponse<DigitalAssetItem | IpAssetItem>>(
  moduleUrl(`/api/v1/${collection}/${encodeURIComponent(assetId)}`),
  { key: cacheKey(`${collection}-form:${assetId}`), immediate: editing && canEdit.value, watch: false }
)
const digitalAsset = computed(() => digital ? data.value?.data as DigitalAssetItem | undefined : undefined)
const ipAsset = computed(() => !digital ? data.value?.data as IpAssetItem | undefined : undefined)
const leave = () => navigateTo(returnPath.value)
async function retry() {
  await refreshAccess()
  if (editing && canEdit.value) await refresh()
}
</script>

<template>
  <UDashboardPanel id="asset-form" :ui="{ body: 'p-0 sm:p-0' }">
    <template #body>
      <CommonEmptyState
        v-if="!canEdit || accessError"
        icon="i-lucide-lock-keyhole"
        :title="accessError ? '无法确认编辑权限' : '无编辑权限'"
        description="请返回列表，或联系管理员确认访问权限。"
      >
        <UButton color="neutral" variant="outline" @click="leave">
          返回
        </UButton>
        <UButton v-if="accessError" @click="retry">
          重试
        </UButton>
      </CommonEmptyState>
      <div v-else-if="editing && pending" class="p-4 sm:p-6">
        <USkeleton class="h-48 w-full" />
      </div>
      <CommonEmptyState
        v-else-if="editing && (error || !data?.data)"
        icon="i-lucide-circle-alert"
        title="无法加载资产"
        description="请检查访问权限或稍后重试。"
      >
        <UButton color="neutral" variant="outline" @click="leave">
          返回
        </UButton>
        <UButton @click="retry">
          重试
        </UButton>
      </CommonEmptyState>
      <DigitalAssetEditModal
        v-else-if="digital && editing"
        :open="true"
        :asset="digitalAsset || null"
        page
        @update:open="leave"
        @updated="leave"
      />
      <DigitalAssetCreateModal
        v-else-if="digital"
        :open="true"
        page
        @update:open="leave"
        @created="leave"
      />
      <IpAssetEditModal
        v-else-if="editing"
        :open="true"
        :asset="ipAsset || null"
        page
        @update:open="leave"
        @updated="leave"
      />
      <IpAssetCreateModal
        v-else
        :open="true"
        page
        @update:open="leave"
        @created="leave"
      />
    </template>
  </UDashboardPanel>
</template>
