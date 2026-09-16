<script setup lang="ts">
import type { ApiEnvelope, OpsResource } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const code = computed(() => String(route.params.code))
const q = ref('')
const grantFilter = ref('all')

const data = ref<ApiEnvelope<{ items: OpsResource[], manifestSeq: number | null }> | null>(null)
const pending = ref(false)

async function refresh() {
  pending.value = true
  try {
    data.value = await $fetch(`/api/platform/ops/applications/${code.value}/resources`, {
      query: {
        requiresGrant: grantFilter.value === 'all' ? undefined : grantFilter.value
      }
    }) as ApiEnvelope<{ items: OpsResource[], manifestSeq: number | null }>
  } finally {
    pending.value = false
  }
}

watch([code, grantFilter], () => {
  void refresh()
})

await refresh()

const resources = computed<OpsResource[]>(() => {
  const term = q.value.trim().toLowerCase()
  const items = (data.value?.data.items || []) as OpsResource[]
  if (!term) return items

  return items
    .map(resource => ({
      ...resource,
      actions: resource.actions.filter(action => (
        action.actionCode.toLowerCase().includes(term)
        || action.action.toLowerCase().includes(term)
        || (action.actionName || '').toLowerCase().includes(term)
      ))
    }))
    .filter(resource => (
      resource.resourceCode.toLowerCase().includes(term)
      || resource.resourceName.toLowerCase().includes(term)
      || resource.actions.length > 0
    ))
})

const grantItems = [
  { label: '授权要求：全部', value: 'all' },
  { label: 'requires_grant = true', value: 'true' },
  { label: 'requires_grant = false', value: 'false' }
]
</script>

<template>
  <div style="margin-top: 16px">
    <UCard
      class="resources-tree"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索 resource / action…"
          size="sm"
          class="w-full max-w-[280px]"
        />
        <USelect
          v-model="grantFilter"
          :items="grantItems"
          size="sm"
          class="w-52"
        />
        <span class="grow" />
        <span class="text-xs text-muted">
          来自 manifest <span class="code-chip">seq #{{ data?.data.manifestSeq || '—' }}</span>
        </span>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="() => refresh()"
        >
          刷新
        </UButton>
      </div>
      <div
        class="tree-row"
        style="background: var(--bg-subtle); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; color: var(--fg-muted); padding: 10px 14px"
      >
        <div>Resource / Action</div>
        <div>说明</div>
        <div>Action Code</div>
        <div style="text-align: right">
          需要授权
        </div>
      </div>
      <template
        v-for="r in resources"
        :key="r.id"
      >
        <div class="tree-row is-resource">
          <div class="tree-resource-name">
            <UIcon
              name="i-lucide-box"
              class="size-3.5 text-muted"
            />
            <span>{{ r.resourceName }}</span>
            <span
              class="code-chip"
              style="margin-left: 4px"
            >
              {{ r.resourceCode }}
            </span>
          </div>
          <div
            class="muted tree-desc"
            :title="r.description || ''"
          >
            {{ r.description || '—' }}
          </div>
          <div />
          <div class="text-right text-xs text-muted">
            {{ r.actions.length }} actions
          </div>
        </div>
        <div
          v-for="a in r.actions"
          :key="a.id"
          class="tree-row is-action"
        >
          <div class="tree-action-name">
            <span style="color: var(--fg-subtle)">└</span>
            <span>{{ a.actionName || a.action }}</span>
          </div>
          <div
            class="muted tree-desc"
            :title="a.description || ''"
          >
            {{ a.description || '—' }}
          </div>
          <div
            class="mono tree-action-code"
            :title="a.actionCode"
          >
            {{ a.actionCode }}
          </div>
          <div style="text-align: right">
            <USwitch
              :model-value="a.requiresGrant"
              size="sm"
              disabled
            />
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>

<style scoped>
.resources-tree .tree-row {
  grid-template-columns: minmax(260px, 1.1fr) minmax(140px, 220px) minmax(360px, 1fr) 96px;
}

.resources-tree .tree-desc {
  min-width: 0;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}

.resources-tree .tree-action-code {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-muted);
  font-size: 12px;
}

@media (max-width: 960px) {
  .resources-tree .tree-row {
    grid-template-columns: minmax(220px, 1fr) minmax(120px, 180px) minmax(260px, 1fr) 84px;
  }

  .resources-tree .tree-desc {
    max-width: 180px;
  }
}
</style>
