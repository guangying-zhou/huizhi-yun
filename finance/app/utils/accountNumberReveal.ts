export interface AccountNumberRevealState {
  accountNo: string
  pending: boolean
  remainingSeconds: number
  error: string
}
export function accountNumberRevealError(error: unknown) {
  const e = error as {
    statusCode?: number
    status?: number
    response?: {
      status?: number
    }
  }
  switch (e?.statusCode || e?.status || e?.response?.status) {
    case 403: return '没有查看完整账号的权限'
    case 404: return '该账户没有保存完整账号'
    case 429: return '查看次数过多，请稍后再试'
    default: return '保险箱暂不可用，请稍后重试'
  }
}
export function createAccountNumberReveal(state: AccountNumberRevealState, read: (reason: string) => Promise<string>, clock = { now: () => Date.now(), every: (fn: () => void) => setInterval(fn, 250), stop: (id: ReturnType<typeof setInterval>) => clearInterval(id) }) {
  let epoch = 0
  let expiresAt = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const clear = () => {
    epoch++
    if (timer !== undefined)
      clock.stop(timer)
    timer = undefined
    expiresAt = 0
    Object.assign(state, { accountNo: '', pending: false, remainingSeconds: 0, error: '' })
  }
  const tick = () => {
    if (!expiresAt)
      return
    const remaining = Math.ceil((expiresAt - clock.now()) / 1000)
    if (remaining <= 0)
      clear()
    else
      state.remainingSeconds = remaining
  }
  return {
    clear, tick,
    value() {
      tick()
      return state.accountNo
    },
    async reveal(reason: string) {
      if (state.pending)
        return
      const trimmed = reason.trim()
      // eslint-disable-next-line no-control-regex
      if ([...trimmed].length < 4 || [...trimmed].length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
        state.error = '查看原因须为 4 至 200 字'
        return
      }
      clear()
      const current = epoch
      state.pending = true
      try {
        const value = await read(trimmed)
        if (current !== epoch)
          return
        if (!value)
          throw new Error('Unavailable')
        state.accountNo = value
        expiresAt = clock.now() + 60000
        tick()
        timer = clock.every(tick)
      } catch (failure) {
        if (current === epoch)
          state.error = accountNumberRevealError(failure)
      } finally {
        if (current === epoch)
          state.pending = false
      }
    }
  }
}
