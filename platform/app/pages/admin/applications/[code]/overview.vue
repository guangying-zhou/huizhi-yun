<script setup lang="ts">
import {
  ROLE_TONE,
  formatDateTime,
  roleLabel,
  statusTone,
  type ApiEnvelope,
  type OpsApplication,
  type OpsApplicationList,
  type OpsRelease,
  type OpsResource
} from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const code = computed(() => String(route.params.code))

const appData = ref<ApiEnvelope<OpsApplicationList> | null>(null)
const releaseData = ref<ApiEnvelope<{ items: OpsRelease[] }> | null>(null)
const resourceData = ref<ApiEnvelope<{ items: OpsResource[], manifestSeq: number | null }> | null>(null)

async function refreshOverview() {
  const [appResponse, releaseResponse, resourceResponse] = await Promise.all([
    $fetch('/api/platform/ops/applications', {
      query: {
        appCode: code.value,
        pageSize: 1
      }
    }) as Promise<ApiEnvelope<OpsApplicationList>>,
    $fetch(`/api/platform/ops/applications/${code.value}/releases`) as Promise<ApiEnvelope<{ items: OpsRelease[] }>>,
    $fetch(`/api/platform/ops/applications/${code.value}/resources`) as Promise<ApiEnvelope<{ items: OpsResource[], manifestSeq: number | null }>>
  ])
  appData.value = appResponse
  releaseData.value = releaseResponse
  resourceData.value = resourceResponse
}

watch(code, () => {
  void refreshOverview()
})

await refreshOverview()

const app = computed<OpsApplication | null>(() => appData.value?.data.items[0] || null)
const releases = computed<OpsRelease[]>(() => releaseData.value?.data.items || [])
const resources = computed<OpsResource[]>(() => resourceData.value?.data.items || [])
const actionCount = computed(() => resources.value.reduce((sum, resource) => sum + resource.actions.length, 0))
const latestRelease = computed(() => releases.value.find(item => item.isLatestReleased) || releases.value[0] || null)
const nextRelease = computed(() => releases.value.find(item => item.status !== 'released' && item.status !== 'deprecated'))
</script>

<template>
  <div
    v-if="app"
    class="mt-4 grid grid-cols-[1.6fr_1fr] gap-4"
  >
    <div class="col gap-4">
      <UCard>
        <template #header>
          <div class="row-between">
            <h3 class="text-sm font-semibold text-highlighted">
              基本信息
            </h3>
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-pencil"
              :to="`/admin/applications/${code}/settings`"
            >
              编辑
            </UButton>
          </div>
        </template>

        <dl class="dl">
          <dt>应用名称</dt>
          <dd class="font-medium text-highlighted">
            {{ app.appName }}
          </dd>
          <dt>应用 Code</dt>
          <dd>
            <span class="code-chip">{{ app.appCode }}</span>
          </dd>
          <dt>服务定位</dt>
          <dd>
            <UBadge
              :color="ROLE_TONE[app.serviceRole]"
              variant="soft"
              size="sm"
            >
              {{ roleLabel(app.serviceRole) }}
            </UBadge>
          </dd>
          <dt>描述</dt>
          <dd>{{ app.description || '—' }}</dd>
          <dt>主页 URL</dt>
          <dd>
            <a
              v-if="app.homeUrl"
              class="row text-info"
              :href="app.homeUrl"
              target="_blank"
            >
              <span class="mono">{{ app.homeUrl }}</span>
              <UIcon
                name="i-lucide-external-link"
                class="size-3"
              />
            </a>
            <span v-else>—</span>
          </dd>
          <dt>仓库</dt>
          <dd>
            <a
              v-if="app.repoUrl"
              class="row text-info"
              :href="app.repoUrl"
              target="_blank"
            >
              <span class="mono">{{ app.repoUrl }}</span>
              <UIcon
                name="i-lucide-external-link"
                class="size-3"
              />
            </a>
            <span v-else>—</span>
          </dd>
        </dl>
      </UCard>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <template #header>
          <div>
            <h3 class="text-sm font-semibold text-highlighted">
              最近 Release
            </h3>
            <p class="mt-1 text-xs text-muted">
              来自 platform_app_releases
            </p>
          </div>
        </template>

        <table class="tbl">
          <tbody>
            <tr
              v-for="release in releases.slice(0, 5)"
              :key="release.id"
            >
              <td>
                <span class="mono text-highlighted">{{ release.releaseVersion }}</span>
              </td>
              <td>
                <UBadge
                  :color="statusTone(release.status)"
                  variant="soft"
                  size="sm"
                >
                  {{ release.status }}
                </UBadge>
              </td>
              <td class="muted">
                seq #{{ release.manifestSeq }}
              </td>
              <td class="muted">
                {{ formatDateTime(release.createdAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </UCard>
    </div>

    <div class="col gap-4">
      <UCard>
        <template #header>
          <h3 class="text-sm font-semibold text-highlighted">
            当前 Release
          </h3>
        </template>

        <div class="row-between mb-3">
          <div class="row gap-2.5">
            <UIcon
              name="i-lucide-tag"
              class="size-4 text-muted"
            />
            <div>
              <div class="mono text-[15px] font-semibold text-highlighted">
                {{ latestRelease?.releaseVersion || app.latestReleaseVersion || '—' }}
              </div>
              <div class="mt-0.5 text-xs text-muted">
                {{ formatDateTime(latestRelease?.releasedAt || app.lastReleasedAt || app.lastManifestRegisteredAt) }} · seq #{{ latestRelease?.manifestSeq || app.latestManifestSeq || '—' }}
              </div>
            </div>
          </div>
          <UBadge
            :color="statusTone(latestRelease?.status || app.latestReleaseStatus)"
            variant="soft"
            size="sm"
          >
            {{ latestRelease?.status || app.latestReleaseStatus || 'no release' }}
          </UBadge>
        </div>
        <div class="grid grid-cols-2 overflow-hidden rounded-md border border-default bg-default">
          <div class="border-r border-default bg-muted/40 p-3">
            <div class="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
              Resources
            </div>
            <div class="mt-0.5 text-lg font-semibold tabular-nums text-highlighted">
              {{ resources.length }}
            </div>
          </div>
          <div class="bg-muted/40 p-3">
            <div class="text-[11px] font-medium uppercase tracking-[0.05em] text-muted">
              Actions
            </div>
            <div class="mt-0.5 text-lg font-semibold tabular-nums text-highlighted">
              {{ actionCount }}
            </div>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h3 class="text-sm font-semibold text-highlighted">
            健康指标
          </h3>
        </template>

        <div class="col gap-3">
          <div class="row-between">
            <span class="text-sm text-muted">订阅租户</span>
            <span class="num font-medium text-highlighted">{{ app.subscriberCount }}</span>
          </div>
          <div class="row-between">
            <span class="text-sm text-muted">活跃 deployment</span>
            <span class="num font-medium text-highlighted">{{ app.activeDeploymentCount }}</span>
          </div>
          <div class="row-between">
            <span class="text-sm text-muted">Manifest 资源</span>
            <span class="num font-medium text-highlighted">{{ resources.length }} / {{ actionCount }}</span>
          </div>
          <div class="row-between">
            <span class="text-sm text-muted">权限覆盖告警</span>
            <UBadge
              :color="latestRelease?.missingGrantActionCount || app.warningDeploymentCount ? 'warning' : 'neutral'"
              variant="soft"
              size="sm"
            >
              {{ (latestRelease?.missingGrantActionCount || 0) + app.warningDeploymentCount }}
            </UBadge>
          </div>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h3 class="text-sm font-semibold text-highlighted">
            升级建议
          </h3>
        </template>

        <div class="text-sm leading-6 text-muted">
          <template v-if="nextRelease">
            下一版本 <span class="mono text-highlighted">{{ nextRelease.releaseVersion }}</span> 当前状态为 {{ nextRelease.status }}。验收通过后可发布给 {{ app.subscriberCount }} 个订阅租户。
          </template>
          <template v-else>
            当前没有待发布版本。可从 GitLab 拉取新 release 后继续审核。
          </template>
        </div>
        <div class="mt-3">
          <UButton
            size="sm"
            icon="i-lucide-arrow-up-right"
            :to="`/admin/applications/${app.appCode}/releases`"
          >
            查看 Release 列表
          </UButton>
        </div>
      </UCard>
    </div>
  </div>
</template>
