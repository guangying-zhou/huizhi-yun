<script setup lang="ts">
// Default tab redirect: /admin/applications/:code → /admin/applications/:code/overview
// Use page middleware (runs before render) so client-side navigation works reliably.
definePageMeta({
  layout: 'platform',
  middleware: [
    function (to) {
      return navigateTo(`/admin/applications/${to.params.code}/overview`, { replace: true })
    }
  ]
})
</script>

<template>
  <div />
</template>
