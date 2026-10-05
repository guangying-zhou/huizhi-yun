export default defineAppConfig({
  ui: {
    colors: {
      primary: 'orange',
      secondary: 'blue',
      info: 'slate',
      neutral: 'zinc'
    },
    dashboardGroup: {
      base: 'fixed inset-0 flex overflow-hidden bg-default'
    },
    dashboardResizeHandle: {
      base: 'hidden lg:block touch-none select-none cursor-ew-resize relative before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:z-1 bg-default'
    },
    card: {
      slots: {
        header: 'px-4 py-3',
        footer: 'px-4 py-3',
        body: 'px-4 py-4',
        root: 'rounded-lg'
      }
    },
    table: {
      slots: {
        th: 'px-4 py-2 whitespace-nowrap',
        td: 'px-4 py-2 whitespace-nowrap'
      }
    }
  }
})
