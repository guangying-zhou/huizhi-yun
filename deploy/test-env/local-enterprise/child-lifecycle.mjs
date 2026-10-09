// A supervisor must terminate even if imports left active handles behind.
export function superviseChild(child, { app, parent = process } = {}) {
  const forward = signal => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  }
  const onInt = () => forward('SIGINT')
  const onTerm = () => forward('SIGTERM')
  parent.on('SIGINT', onInt)
  parent.on('SIGTERM', onTerm)
  const detach = () => {
    parent.removeListener('SIGINT', onInt)
    parent.removeListener('SIGTERM', onTerm)
  }
  child.once('error', error => {
    console.error(`${app} failed to start: ${error.message}`)
    detach()
    parent.exit(1)
  })
  child.once('close', (code, signal) => {
    detach()
    if (signal) parent.kill(parent.pid, signal)
    else parent.exit(code ?? 1)
  })
}
