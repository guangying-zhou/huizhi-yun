<script setup lang="ts">
import {
  appIconFallback,
  isAppIconName,
  statusTone,
  type ApiEnvelope,
  type OpsOverview
} from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

usePageTitle('平台运营工作台')

const data = ref<ApiEnvelope<OpsOverview> | null>(null)
const pending = ref(false)

async function refresh() {
  pending.value = true
  try {
    data.value = await $fetch('/api/platform/ops/overview') as ApiEnvelope<OpsOverview>
  } finally {
    pending.value = false
  }
}

await refresh()

const overview = computed<OpsOverview | undefined>(() => data.value?.data)
const tenants = computed<OpsOverview['tenants']>(() => overview.value?.tenants || [])
const apps = computed<OpsOverview['apps']>(() => overview.value?.apps || [])
const timeline = computed<OpsOverview['timeline']>(() => overview.value?.timeline || [])

interface DashboardStat {
  label: string
  value: string
  delta: string
  tone: 'flat' | 'up'
  hint?: string
}

const stats = computed<DashboardStat[]>(() => [
  { label: '活跃租户', value: String(overview.value?.stats.activeTenantCount || 0), delta: '当前', tone: 'flat' },
  {
    label: '已上架应用',
    value: String(overview.value?.stats.appCount || 0),
    delta: `${overview.value?.stats.releasedAppCount || 0} 已发布 / ${overview.value?.stats.draftReleaseCount || 0} 待发布`,
    tone: 'flat'
  },
  { label: '本月新增订阅', value: String(overview.value?.stats.monthSubscriptionCount || 0), delta: '本月', tone: 'up' },
  {
    label: '部署连通率',
    value: overview.value?.stats.healthyDeploymentRate === null || overview.value?.stats.healthyDeploymentRate === undefined
      ? '—'
      : `${overview.value.stats.healthyDeploymentRate}%`,
    delta: `${overview.value?.stats.healthyDeploymentCount || 0} / ${overview.value?.stats.deploymentCount || 0}`,
    tone: 'flat',
    hint: 'active'
  }
])

function tenantStatusLabel(s: string) {
  if (s === 'active') return 'Active'
  if (s === 'pending') return 'Pending'
  if (s === 'suspended') return 'Suspended'
  return s
}
</script>

<template>
  <div class="col gap-5">
    <div class="page-h">
      <div>
        <h1>工作台</h1>
        <p>平台总览。监控租户健康、应用生命周期与最近运营事件。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="() => refresh()"
        >
          刷新
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-plus"
        >
          新建租户
        </UButton>
      </div>
    </div>

    <div class="grid-4">
      <UCard
        v-for="stat in stats"
        :key="stat.label"
        :ui="{ body: 'p-4 sm:p-4' }"
      >
        <div class="stat-label">
          {{ stat.label }}
        </div>
        <div class="stat-value">
          {{ stat.value }}
        </div>
        <div
          v-if="stat.delta"
          :class="['stat-delta', stat.tone]"
        >
          {{ stat.delta }}
          <span
            v-if="stat.hint"
            class="text-dimmed"
          >
            · {{ stat.hint }}
          </span>
        </div>
      </UCard>
    </div>

    <div class="grid grid-cols-[1.4fr_1fr] gap-4">
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <div class="row-between">
            <div>
              <h3 class="text-sm font-semibold text-highlighted">
                租户健康
              </h3>
              <p class="mt-1 text-xs text-muted">
                {{ tenants.length }} 户
              </p>
            </div>
            <UButton
              to="/admin/tenants"
              color="neutral"
              variant="ghost"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
            >
              查看全部
            </UButton>
          </div>
        </template>

        <table class="tbl">
          <thead>
            <tr>
              <th>
                租户
              </th>
              <th>
                计划
              </th>
              <th>
                状态
              </th>
              <th style="text-align: right">
                应用
              </th>
              <th>
                最近活跃
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="t in tenants"
              :key="t.tenantCode"
            >
              <td>
                <div class="row">
                  <UAvatar
                    :text="t.tenantName.slice(0, 1)"
                    size="xs"
                    :ui="{ fallback: 'font-semibold' }"
                  />
                  <div>
                    <div class="font-medium text-highlighted">
                      {{ t.tenantName }}
                    </div>
                    <div class="mono text-dimmed text-xs">
                      {{ t.tenantCode }}
                    </div>
                  </div>
                </div>
              </td>
              <td>{{ t.planCode || '—' }}</td>
              <td>
                <UBadge
                  :color="statusTone(t.status)"
                  variant="soft"
                  size="sm"
                >
                  <template #leading>
                    <span class="size-1.5 rounded-full bg-current" />
                  </template>
                  {{ tenantStatusLabel(t.status) }}
                </UBadge>
                <UBadge
                  v-if="t.warnCount"
                  color="warning"
                  variant="soft"
                  size="sm"
                  class="ml-1.5"
                >
                  {{ t.warnCount }} 告警
                </UBadge>
              </td>
              <td
                class="num"
                style="text-align: right"
              >
                {{ t.appCount }}
              </td>
              <td class="muted">
                {{ t.lastSeen }}
              </td>
            </tr>
          </tbody>
        </table>
      </UCard>

      <UCard>
        <template #header>
          <div>
            <h3 class="text-sm font-semibold text-highlighted">
              最近事件
            </h3>
            <p class="mt-1 text-xs text-muted">
              平台范围
            </p>
          </div>
        </template>

        <div class="timeline">
          <div
            v-for="(event, index) in timeline"
            :key="index"
            class="tl-item"
          >
            <div :class="['tl-dot', event.tone]" />
            <div class="tl-body">
              <div class="tl-time">
                {{ event.time }}
                <template v-if="event.who">
                  · <span class="mono">{{ event.who }}</span>
                </template>
              </div>
              <div class="tl-msg">
                {{ event.message }}
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <UCard>
      <template #header>
        <div class="row-between">
          <div>
            <h3 class="text-sm font-semibold text-highlighted">
              应用生命周期
            </h3>
            <p class="mt-1 text-xs text-muted">
              {{ overview?.stats.appCount || 0 }} 个应用 · {{ overview?.stats.releasedAppCount || 0 }} 已发布 / {{ overview?.stats.draftReleaseCount || 0 }} 待发布
            </p>
          </div>
          <UButton
            to="/admin/applications"
            color="neutral"
            variant="ghost"
            size="sm"
            trailing-icon="i-lucide-arrow-right"
          >
            管理应用
          </UButton>
        </div>
      </template>

      <div class="grid-3 gap-2.5">
        <NuxtLink
          v-for="a in apps"
          :key="a.appCode"
          :to="`/admin/applications/${a.appCode}`"
          class="app-card"
        >
          <div class="row-between mb-1.5">
            <div class="row">
              <span class="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-sm">
                <UIcon
                  v-if="isAppIconName(a.icon)"
                  :name="a.icon"
                  class="size-4 text-muted"
                />
                <img
                  v-else-if="a.icon"
                  :src="a.icon"
                  class="size-4 rounded object-contain"
                  :alt="a.appName"
                >
                <span v-else>{{ appIconFallback(a) }}</span>
              </span>
              <div class="font-medium text-highlighted">
                {{ a.appName }}
              </div>
            </div>
            <UBadge
              :color="statusTone(a.latestReleaseStatus)"
              variant="soft"
              size="sm"
            >
              {{ a.latestReleaseStatus || 'no release' }}
            </UBadge>
          </div>
          <div class="row-between text-xs text-muted">
            <span class="mono">{{ a.latestReleaseVersion || '—' }}</span>
            <span>{{ a.subscriberCount }} 订阅</span>
          </div>
        </NuxtLink>
      </div>
    </UCard>
  </div>
</template>

<style scoped>
.app-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px 14px;
  background: var(--bg);
  cursor: pointer;
  transition: border-color 100ms, background 100ms;
  text-decoration: none;
  display: block;
}
.app-card:hover {
  border-color: var(--line-strong);
  background: var(--bg-subtle);
}
</style>
