export default defineAppConfig({
  ui: {
    colors: {
      // The Host carries the same brand accent as the standalone business
      // applications it composes; without this it fell back to Nuxt UI's
      // default green and read as a different product.
      primary: 'orange'
    }
  }
})
