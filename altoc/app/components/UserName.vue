<script setup lang="ts">
import { useAccountStore } from '@hzy/foundation/app/stores/account'

/**
 * 根据 uid 显示用户真实姓名
 * 先从目录缓存查找，未命中则按 uid 从 Console Directory 精确加载。
 */
const props = defineProps<{
  uid: string | null | undefined
}>()

const nuxtApp = useNuxtApp()
const store = useAccountStore(nuxtApp.$pinia)

type DirectoryUserName = {
  uid: string
  realName?: string | null
  displayName?: string | null
  nickname?: string | null
  username?: string | null
}

async function ensureUserName(uid: string | null | undefined) {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid || store.getUserByUid(normalizedUid)) return

  try {
    await store.fetchUser(normalizedUid)
  } catch {
    // 保持 uid 回退显示，避免名单接口异常阻断列表渲染。
  }
}

onMounted(() => {
  ensureUserName(props.uid)
})

watch(() => props.uid, (uid) => {
  ensureUserName(uid)
})

const displayName = computed(() => {
  if (!props.uid) return '-'
  const user = store.getUserByUid(props.uid) as DirectoryUserName | undefined
  if (user) {
    return user.realName || user.displayName || user.nickname || user.username || user.uid
  }
  return props.uid
})
</script>

<template>
  <span>{{ displayName }}</span>
</template>
