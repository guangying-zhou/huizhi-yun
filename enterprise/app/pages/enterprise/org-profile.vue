<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-org-profile', navigationOwner: 'console' })

usePageTitle('企业资料')
const { data, pending, error, refresh } = await useFetch('/enterprise/api/org-profile')
const forbidden = computed(() => error.value?.statusCode === 403)
</script>

<template>
  <UDashboardPanel id="enterprise-org-profile">
    <template #body>
      <ContentPageHeader
        hosted
        title="企业资料"
        description="查看企业基础资料、区域和联系信息。"
      >
        <template #actions>
          <UButton
            to="/console/org-profile"
            external
            color="neutral"
            variant="outline"
            label="在控制台编辑"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            aria-label="刷新企业资料"
            :loading="pending"
            @click="refresh()"
          />
        </template>
      </ContentPageHeader>

      <CommonEmptyState
        v-if="forbidden"
        icon="i-lucide-lock-keyhole"
        title="无权限"
        description="你没有查看企业资料的权限。"
      />
      <UAlert
        v-else-if="error"
        color="error"
        title="企业资料加载失败"
        description="请稍后重试。"
      />
      <USkeleton
        v-else-if="pending"
        class="h-48"
      />
      <OrgProfileDetails
        v-else-if="data?.data"
        :profile="data.data"
      />
      <CommonEmptyState
        v-else
        title="暂无企业资料"
        description="企业资料暂时不可用。"
      />
    </template>
  </UDashboardPanel>
</template>
