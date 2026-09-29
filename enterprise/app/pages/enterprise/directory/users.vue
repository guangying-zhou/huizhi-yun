<script setup lang="ts">
definePageMeta({ hostContentInset: false, name: 'console-host-directory-users', navigationOwner: 'console' })
</script>

<template>
  <DirectoryUsersReadPage
    api-path="/enterprise/api/directory/users"
    console-path="/console/directory/users"
  />
</template>
