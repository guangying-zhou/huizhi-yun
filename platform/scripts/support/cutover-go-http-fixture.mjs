import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
export async function startCutoverGoHttpFixture(rootDir, socket, token, evidenceHash) {
  const directory = await mkdtemp('/tmp/hzy-cutover-http-')
  const originalCA = getCACertificates('default')
  let output = ''
  const child = spawn('go', ['test', './internal/server', '-run', '^TestCutoverActivationHTTPFixture$', '-count=1'], { cwd: resolve(rootDir, 'data-runtime'), env: { ...process.env, HZY_CUTOVER_HTTP_SOCKET: socket, HZY_CUTOVER_HTTP_DIR: directory, HZY_CUTOVER_HTTP_TOKEN: token, HZY_CUTOVER_EVIDENCE_HASH: evidenceHash }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Go HTTP fixture failed: ${output}`))) }); done.catch(() => {})
  async function stop() { await writeFile(resolve(directory, 'stop'), 'stop'); try { await done } finally { setDefaultCACertificates(originalCA); await rm(directory, { recursive: true, force: true }) } }
  try {
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) await done
      try {
        const ready = JSON.parse(await readFile(resolve(directory, 'ready.json'), 'utf8'))
        setDefaultCACertificates([...originalCA, await readFile(resolve(directory, 'ca.pem'), 'utf8')])
        return { ...ready, stop }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      await new Promise(resolve => setTimeout(resolve, 30))
    }
    throw Error('Go HTTP fixture readiness timeout')
  } catch (error) { child.kill('SIGTERM'); await done.catch(() => {}); await rm(directory, { recursive: true, force: true }); throw error }
}
