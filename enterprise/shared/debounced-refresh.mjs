// Debounced, non-overlapping re-read. A burst of change signals becomes one
// run after `delay`; a signal arriving while a run is in flight queues exactly
// one trailing run, so neither a request storm nor a stale final read occurs.
export function createDebouncedRefresh({ run, delay = 300, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer
  let running = null
  let trailing = false
  let disposed = false

  async function execute() {
    if (disposed) return
    if (running) {
      trailing = true
      return running
    }
    running = Promise.resolve().then(run).catch(() => {}).finally(() => {
      running = null
      if (trailing && !disposed) {
        trailing = false
        void execute()
      }
    })
    return running
  }

  return {
    schedule() {
      if (disposed) return
      if (timer !== undefined) clearTimer(timer)
      timer = setTimer(() => {
        timer = undefined
        void execute()
      }, delay)
    },
    dispose() {
      disposed = true
      trailing = false
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
    }
  }
}
