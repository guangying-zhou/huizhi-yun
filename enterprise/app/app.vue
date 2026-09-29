<script setup lang="ts">
import { enterprisePageKey } from './utils/enterprise-page-key.mjs'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
// Page identity follows verified sessions only: the cache scope drops to ''
// synchronously during invalidation for key isolation, and keying pages on it
// would remount every page twice per token rotation.
const verifiedScope = useState<string>('enterprise-verified-scope', () => '')
// Nuxt watches the pageKey prop by reference. An inline template callback is
// recreated on render and can start loading without a matching navigation end.
const pageKey = (route: RouteLocationNormalizedLoaded) => enterprisePageKey(verifiedScope.value, route)
</script>
<template>
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout><NuxtPage :page-key="pageKey" /></NuxtLayout>
  </UApp>
</template>
