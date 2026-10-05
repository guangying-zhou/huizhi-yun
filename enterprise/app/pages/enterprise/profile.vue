<script setup lang="ts">
import type { ConsoleDirectorySelfProfile } from '@hzy/foundation/app/types/consoleDirectory'

definePageMeta({ hostContentInset: false })

usePageTitle('个人资料')
const { data, pending, error, refresh } = await useFetch<{ code: number, data: ConsoleDirectorySelfProfile }>(sharedApiPath('/api/directory/me'))
const profile = computed(() => data.value?.data)
const avatarSrc = computed(() => resolveAvatarSrc(profile.value?.avatar) || undefined)
</script>

<template>
  <UDashboardPanel id="enterprise-profile">
    <template #body>
      <ContentPageHeader
        hosted
        title="个人资料"
        description="查看本人的企业目录资料。"
      >
        <template #actions>
          <UButton
            to="/console/profile"
            external
            color="neutral"
            variant="outline"
            label="在控制台修改头像和密码"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            aria-label="刷新个人资料"
            :loading="pending"
            @click="refresh()"
          />
        </template>
      </ContentPageHeader>

      <CommonEmptyState
        v-if="error?.statusCode === 403"
        title="无权限"
        description="你没有查看本人目录资料的权限。"
      />
      <CommonEmptyState
        v-else-if="error?.statusCode === 401"
        title="请登录"
        description="登录后可查看本人目录资料。"
      />
      <UAlert
        v-else-if="error"
        color="error"
        title="个人资料加载失败"
        description="请稍后重试。"
      />
      <USkeleton
        v-else-if="pending"
        class="h-48"
      />
      <UCard v-else-if="profile?.uid">
        <UAvatar
          :src="avatarSrc"
          :alt="profile.realName || profile.displayName || profile.uid"
          size="xl"
          class="mb-4"
        />
        <DirectorySelfProfileDetails :profile="profile" />
      </UCard>
      <CommonEmptyState
        v-else
        title="暂无个人资料"
        description="本人目录资料暂时不可用。"
      />
    </template>
  </UDashboardPanel>
</template>
