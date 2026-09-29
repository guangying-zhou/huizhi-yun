<script setup lang="ts">
type OrgProfile = {
  tenantCode: string
  orgName: string
  orgShortName: string | null
  displayName: string | null
  legalName: string | null
  unifiedSocialCreditCode: string | null
  logoPath: string | null
  websiteUrl: string | null
  industryCode: string | null
  countryCode: string
  timezone: string
  locale: string
  currencyCode: string
  contactName: string | null
  contactEmail: string | null
  contactMobile: string | null
  addressText: string | null
  status: string
  revision: number
  updatedAt: string
}

const props = defineProps<{ profile: OrgProfile | null }>()
const profile = computed(() => props.profile)

const identityFields = computed(() => [
  { label: '企业编码', value: profile.value?.tenantCode },
  { label: '企业全称', value: profile.value?.orgName },
  { label: '企业简称', value: profile.value?.orgShortName },
  { label: '显示名称', value: profile.value?.displayName },
  { label: '法定名称', value: profile.value?.legalName },
  { label: '统一社会信用代码', value: profile.value?.unifiedSocialCreditCode }
])

const localeFields = computed(() => [
  { label: '国家或地区', value: profile.value?.countryCode },
  { label: '时区', value: profile.value?.timezone },
  { label: '语言', value: profile.value?.locale },
  { label: '币种', value: profile.value?.currencyCode },
  { label: '行业编码', value: profile.value?.industryCode },
  { label: '状态', value: profile.value?.status === 'active' ? '正常' : profile.value?.status }
])

const contactFields = computed(() => [
  { label: '联系人', value: profile.value?.contactName },
  { label: '联系邮箱', value: profile.value?.contactEmail },
  { label: '联系电话', value: profile.value?.contactMobile },
  { label: '网站', value: profile.value?.websiteUrl },
  { label: '地址', value: profile.value?.addressText }
])
</script>

<template>
  <div v-if="profile" class="org-profile-details">
    <UCard>
      <template #header>
        <span class="font-semibold">基础资料</span>
      </template>
      <dl class="space-y-3">
        <div v-for="field in identityFields" :key="field.label" class="profile-field">
          <dt class="text-muted">
            {{ field.label }}
          </dt>
          <dd class="min-w-0 break-words text-default">
            {{ field.value || '—' }}
          </dd>
        </div>
      </dl>
    </UCard>

    <UCard>
      <template #header>
        <span class="font-semibold">区域与本地化</span>
      </template>
      <dl class="space-y-3">
        <div v-for="field in localeFields" :key="field.label" class="profile-field">
          <dt class="text-muted">
            {{ field.label }}
          </dt>
          <dd class="min-w-0 break-words text-default">
            {{ field.value || '—' }}
          </dd>
        </div>
      </dl>
    </UCard>

    <UCard>
      <template #header>
        <span class="font-semibold">联系信息</span>
      </template>
      <dl class="space-y-3">
        <div v-for="field in contactFields" :key="field.label" class="profile-field">
          <dt class="text-muted">
            {{ field.label }}
          </dt>
          <dd class="min-w-0 break-words text-default">
            {{ field.value || '—' }}
          </dd>
        </div>
      </dl>
    </UCard>
  </div>
</template>

<style scoped>
.org-profile-details { display: grid; gap: 1rem; container-type: inline-size; }
.profile-field { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: 0.75rem; font-size: 0.875rem; }
@media (min-width: 1024px) { .org-profile-details { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
