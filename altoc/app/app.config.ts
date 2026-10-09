export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      secondary: 'blue',
      info: 'gray',
      neutral: 'zinc'
    },
    dashboardGroup: {
      base: 'fixed inset-0 flex overflow-hidden bg-default'
    },
    dashboardResizeHandle: {
      base: 'hidden lg:block touch-none select-none cursor-ew-resize relative before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:z-1 bg-default'
    },
    table: {
      slots: {
        th: 'px-4 py-2',
        td: 'px-2 py-2 font-mono'
      }
    },
    card: {
      slots: {
        header: 'px-4 sm:py-2',
        footer: 'px-4 py-2',
        body: 'px-4 sm:py-3',
        root: 'px-2',
        title: 'py-2'
      }
    }
  }
})
