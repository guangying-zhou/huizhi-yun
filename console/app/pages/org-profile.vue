<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('企业资料')

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

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

const { data, pending, error, refresh } = await useFetch<ApiResponse<OrgProfile>>(
  '/api/v1/console/profile',
  { server: false }
)
const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const editOpen = ref(false)
const saving = ref(false)
const editDraft = reactive({
  expectedRevision: 0,
  orgName: '',
  orgShortName: '',
  displayName: '',
  legalName: '',
  unifiedSocialCreditCode: '',
  logoPath: '',
  websiteUrl: '',
  industryCode: '',
  countryCode: 'CN',
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  currencyCode: 'CNY',
  contactName: '',
  contactEmail: '',
  contactMobile: '',
  addressText: ''
})

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const profile = computed(() => data.value?.data || null)
const canEdit = computed(() => permissionsLoaded.value && hasPermission('org_profile', 'edit'))
const errorMessage = computed(() => {
  const detail = error.value?.data as { message?: string } | undefined
  return detail?.message || error.value?.message || '企业资料暂时不可用'
})

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

function formatUpdatedAt(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function openEditor() {
  const current = profile.value
  if (!current) return
  Object.assign(editDraft, {
    expectedRevision: current.revision,
    orgName: current.orgName,
    orgShortName: current.orgShortName || '',
    displayName: current.displayName || '',
    legalName: current.legalName || '',
    unifiedSocialCreditCode: current.unifiedSocialCreditCode || '',
    logoPath: current.logoPath || '',
    websiteUrl: current.websiteUrl || '',
    industryCode: current.industryCode || '',
    countryCode: current.countryCode,
    timezone: current.timezone,
    locale: current.locale,
    currencyCode: current.currencyCode,
    contactName: current.contactName || '',
    contactEmail: current.contactEmail || '',
    contactMobile: current.contactMobile || '',
    addressText: current.addressText || ''
  })
  editOpen.value = true
}

function mutationIdempotencyKey() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `console:org-profile:${random}`
}

async function saveProfile() {
  if (!editDraft.orgName.trim()) {
    toast.add({ color: 'warning', title: '企业全称不能为空' })
    return
  }
  saving.value = true
  try {
    await $fetch<ApiResponse<OrgProfile> & { replayed: boolean }>('/api/v1/console/profile', {
      method: 'PUT',
      headers: { 'idempotency-key': mutationIdempotencyKey() },
      body: editDraft
    })
    editOpen.value = false
    await refresh()
    toast.add({ color: 'success', title: '企业资料已保存' })
  } catch (saveError: unknown) {
    const candidate = saveError as { data?: { error?: { code?: string, message?: string }, message?: string }, message?: string }
    const code = candidate.data?.error?.code
    if (code === 'profile_revision_conflict') {
      await refresh()
    }
    toast.add({
      color: 'error',
      title: code === 'profile_revision_conflict' ? '资料已被其他人更新' : '保存失败',
      description: candidate.data?.error?.message || candidate.data?.message || candidate.message || '请稍后重试'
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="org-profile" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="企业资料">
        <template #right>
          <span v-if="profile?.updatedAt" class="text-xs text-muted">
            更新于 {{ formatUpdatedAt(profile.updatedAt) }}
          </span>
          <UButton
            v-if="canEdit"
            icon="i-lucide-pencil"
            label="编辑"
            color="neutral"
            variant="outline"
            :disabled="!profile"
            @click="openEditor"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="pending"
            aria-label="刷新企业资料"
            @click="refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="企业资料加载失败"
        :description="errorMessage"
      />

      <div v-else-if="pending" class="grid gap-3 lg:grid-cols-3">
        <UCard v-for="index in 3" :key="index">
          <div class="space-y-3">
            <USkeleton class="h-5 w-24" />
            <USkeleton v-for="row in 5" :key="row" class="h-4 w-full" />
          </div>
        </UCard>
      </div>

      <div v-else-if="profile" class="grid gap-3 lg:grid-cols-3">
        <UCard>
          <template #header>
            <span class="font-semibold">基础资料</span>
          </template>
          <dl class="space-y-3">
            <div v-for="field in identityFields" :key="field.label" class="grid grid-cols-[8rem_1fr] gap-3 text-sm">
              <dt class="text-muted">
                {{ field.label }}
              </dt>
              <dd class="break-words text-default">
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
            <div v-for="field in localeFields" :key="field.label" class="grid grid-cols-[7rem_1fr] gap-3 text-sm">
              <dt class="text-muted">
                {{ field.label }}
              </dt>
              <dd class="break-words text-default">
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
            <div v-for="field in contactFields" :key="field.label" class="grid grid-cols-[6rem_1fr] gap-3 text-sm">
              <dt class="text-muted">
                {{ field.label }}
              </dt>
              <dd class="break-words text-default">
                {{ field.value || '—' }}
              </dd>
            </div>
          </dl>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="editOpen" title="编辑企业资料" :ui="{ content: 'sm:max-w-4xl' }">
    <template #body>
      <div class="grid gap-4 md:grid-cols-2">
        <UFormField label="企业全称" required>
          <UInput v-model="editDraft.orgName" class="w-full" maxlength="255" />
        </UFormField>
        <UFormField label="企业简称">
          <UInput v-model="editDraft.orgShortName" class="w-full" maxlength="128" />
        </UFormField>
        <UFormField label="显示名称">
          <UInput v-model="editDraft.displayName" class="w-full" maxlength="255" />
        </UFormField>
        <UFormField label="法定名称">
          <UInput v-model="editDraft.legalName" class="w-full" maxlength="255" />
        </UFormField>
        <UFormField label="统一社会信用代码">
          <UInput v-model="editDraft.unifiedSocialCreditCode" class="w-full" maxlength="64" />
        </UFormField>
        <UFormField label="行业编码">
          <UInput v-model="editDraft.industryCode" class="w-full" maxlength="64" />
        </UFormField>
        <UFormField label="国家或地区" required>
          <UInput v-model="editDraft.countryCode" class="w-full" maxlength="8" />
        </UFormField>
        <UFormField label="时区" required>
          <UInput v-model="editDraft.timezone" class="w-full" maxlength="64" />
        </UFormField>
        <UFormField label="语言" required>
          <UInput v-model="editDraft.locale" class="w-full" maxlength="32" />
        </UFormField>
        <UFormField label="币种" required>
          <UInput v-model="editDraft.currencyCode" class="w-full" maxlength="16" />
        </UFormField>
        <UFormField label="联系人">
          <UInput v-model="editDraft.contactName" class="w-full" maxlength="128" />
        </UFormField>
        <UFormField label="联系邮箱">
          <UInput
            v-model="editDraft.contactEmail"
            type="email"
            class="w-full"
            maxlength="255"
          />
        </UFormField>
        <UFormField label="联系电话">
          <UInput v-model="editDraft.contactMobile" class="w-full" maxlength="64" />
        </UFormField>
        <UFormField label="网站">
          <UInput
            v-model="editDraft.websiteUrl"
            type="url"
            class="w-full"
            maxlength="255"
          />
        </UFormField>
        <UFormField label="Logo 路径" class="md:col-span-2">
          <UInput v-model="editDraft.logoPath" class="w-full" maxlength="500" />
        </UFormField>
        <UFormField label="地址" class="md:col-span-2">
          <UTextarea
            v-model="editDraft.addressText"
            class="w-full"
            :rows="3"
            maxlength="500"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="取消"
          :disabled="saving"
          @click="editOpen = false"
        />
        <UButton
          label="保存"
          icon="i-lucide-save"
          :loading="saving"
          @click="saveProfile"
        />
      </div>
    </template>
  </UModal>
</template>
