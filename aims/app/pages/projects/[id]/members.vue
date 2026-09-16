<script setup lang="ts">
const route = useRoute()

await navigateTo(`/projects/${route.params.id}/settings`, { replace: true })
</script>
