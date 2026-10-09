// Business pages supply the page name; only Foundation appends the brand.
export default defineNuxtPlugin({
  name: 'hzy:browser-title',
  dependsOn: ['nuxt:head'],
  setup() {
    const route = useRoute()
    useHead(() => ({ title: typeof route.meta.layoutHeaderTitle === 'string' ? route.meta.layoutHeaderTitle : '' }), { tagPriority: 'low' })
    useHead({ titleTemplate: (title?: string) => title?.trim() ? `${title.trim()} - 汇智云` : '汇智云' }, { tagPriority: 'critical' })
  }
})
