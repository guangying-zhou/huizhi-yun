export function createDebouncedRefresh(options: {
  run: () => unknown | Promise<unknown>
  delay?: number
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
}): { schedule: () => void, dispose: () => void }
