export default defineAppConfig({
  ui: {
    colors: {
      primary: 'sky',
      secondary: 'lime',
      info: 'gray',
      neutral: 'slate'
    },
    dashboardGroup: {
      base: 'fixed inset-0 flex overflow-hidden bg-default'
    },
    dashboardResizeHandle: {
      base: 'hidden lg:block touch-none select-none cursor-ew-resize relative before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:z-1 bg-default'
    },
    card: {
      slots: {
        header: 'px-5 py-4',
        body: 'px-5 py-4',
        footer: 'px-5 py-4'
      }
    }
  }
})
