import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SOURCE_SCRIPT = join(ROOT, 'update_dr.sh')

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  chmodSync(path, 0o755)
}

function runDryRun({ localVersion = '0.3.114', remoteVersion = '0.3.113', occupied = [], args = [] } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'update-dr-'))
  const script = join(fixture, 'update_dr.sh')
  const runtime = join(fixture, 'data-runtime')
  const packageRoot = join(runtime, 'build/packages/hzy-data-runtime')
  const fakeBin = join(fixture, 'bin')

  try {
    copyFileSync(SOURCE_SCRIPT, script)
    chmodSync(script, 0o755)
    mkdirSync(runtime, { recursive: true })
    writeFileSync(join(runtime, 'VERSION'), `${localVersion}\n`)
    writeExecutable(join(runtime, 'scripts/package-release.sh'), '#!/usr/bin/env bash\nexit 0\n')
    writeExecutable(join(runtime, 'scripts/upload-r2.sh'), '#!/usr/bin/env bash\nexit 0\n')
    writeExecutable(join(fakeBin, 'curl'), '#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_REMOTE_VERSION"\n')

    for (const version of occupied) {
      mkdirSync(join(packageRoot, version), { recursive: true })
    }

    const output = execFileSync(script, ['--dry-run', ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FAKE_REMOTE_VERSION: remoteVersion,
        PATH: `${fakeBin}:${process.env.PATH}`
      }
    })

    return {
      output,
      version: readFileSync(join(runtime, 'VERSION'), 'utf8').trim()
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

test('advances past an occupied immutable local release', () => {
  const result = runDryRun({ occupied: ['0.3.114'] })

  assert.match(result.output, /immutable local package exists: 0\.3\.114; advancing target to 0\.3\.115/)
  assert.match(result.output, /data-runtime release target: 0\.3\.115/)
  assert.equal(result.version, '0.3.114')
})

test('keeps an unoccupied local version that is ahead of remote', () => {
  const result = runDryRun()

  assert.match(result.output, /data-runtime release target: 0\.3\.114/)
  assert.match(result.output, /data-runtime linux\/arm64:\s+false/)
  assert.doesNotMatch(result.output, /immutable local package exists/)
})

test('--linux-arm64 enables the optional arm64 artifact', () => {
  const result = runDryRun({ args: ['--linux-arm64'] })

  assert.match(result.output, /data-runtime linux\/arm64:\s+true/)
})

test('automatically reuses preview confirmation digests for stage and promote', () => {
  const source = readFileSync(SOURCE_SCRIPT, 'utf8')

  assert.doesNotMatch(source, /Type .*confirmationSha256/)
  assert.doesNotMatch(source, /confirm_release_action/)
  assert.match(source, /--stage --execute --confirm "\$stage_confirmation"/)
  assert.match(source, /--promote --execute --confirm "\$promote_confirmation"/)
})

test('--resume explicitly reuses an occupied local version', () => {
  const result = runDryRun({ occupied: ['0.3.114'], args: ['--resume'] })

  assert.match(result.output, /data-runtime release target: 0\.3\.114/)
  assert.doesNotMatch(result.output, /advancing target/)
})
