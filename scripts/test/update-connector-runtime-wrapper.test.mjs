import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
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
const SOURCE_SCRIPT = join(ROOT, 'update_cr.sh')

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  chmodSync(path, 0o755)
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function runDryRun({ localVersion = '0.4.25', remoteVersion = '0.4.24', occupied = [], args = [] } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), 'update-cr-'))
  const script = join(fixture, 'update_cr.sh')
  const runtime = join(fixture, 'connector-runtime')
  const sourceRuntime = join(fixture, 'notification-runtime')
  const packageRoot = join(runtime, 'build/packages/hzy-connector-runtime')
  const fakeBin = join(fixture, 'bin')

  try {
    copyFileSync(SOURCE_SCRIPT, script)
    chmodSync(script, 0o755)
    mkdirSync(runtime, { recursive: true })
    mkdirSync(sourceRuntime, { recursive: true })
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

test('advances past an occupied immutable local Connector release', () => {
  const result = runDryRun({ occupied: ['0.4.25'] })

  assert.match(result.output, /immutable local package exists: 0\.4\.25; advancing target to 0\.4\.26/)
  assert.match(result.output, /connector-runtime release target: 0\.4\.26/)
  assert.equal(result.version, '0.4.25')
})

test('keeps an unoccupied local Connector version that is ahead of remote', () => {
  const result = runDryRun()

  assert.match(result.output, /connector-runtime release target: 0\.4\.25/)
  assert.doesNotMatch(result.output, /immutable local package exists/)
})

test('--resume explicitly reuses an occupied local Connector version', () => {
  const result = runDryRun({ occupied: ['0.4.25'], args: ['--resume'] })

  assert.match(result.output, /connector-runtime release target: 0\.4\.25/)
  assert.doesNotMatch(result.output, /advancing target/)
})

test('--resume accepts the shared signing key, confirms the preview digest and stops after a failed stage', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'update-cr-resume-'))
  const script = join(fixture, 'update_cr.sh')
  const runtime = join(fixture, 'connector-runtime')
  const sourceRuntime = join(fixture, 'notification-runtime')
  const version = '0.4.25'
  const versionDir = join(runtime, 'build/packages/hzy-connector-runtime', version)
  const fakeBin = join(fixture, 'bin')
  const signingKey = join(fixture, 'shared-release-signing-private.pem')
  const executeMarker = join(fixture, 'stage-execute-args')
  const promoteMarker = join(fixture, 'unexpected-promote')

  try {
    copyFileSync(SOURCE_SCRIPT, script)
    chmodSync(script, 0o755)
    mkdirSync(join(runtime, 'scripts'), { recursive: true })
    mkdirSync(sourceRuntime, { recursive: true })
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(join(runtime, 'VERSION'), `${version}\n`)

    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    writeFileSync(signingKey, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    const keyId = createHash('sha256')
      .update(publicKey.export({ type: 'spki', format: 'der' }))
      .digest('hex')

    const manifest = join(versionDir, 'manifest.json')
    const versionFile = join(versionDir, 'version.txt')
    writeFileSync(manifest, `${JSON.stringify({ version, signature: { algorithm: 'Ed25519', keyId } })}\n`)
    writeFileSync(versionFile, `${version}\n`)
    writeFileSync(
      join(versionDir, 'release.sha256'),
      `${sha256(manifest)}  manifest.json\n${sha256(versionFile)}  version.txt\n`
    )

    writeExecutable(join(runtime, 'scripts/package-release.sh'), '#!/usr/bin/env bash\nexit 0\n')
    writeExecutable(join(runtime, 'scripts/upload-r2.sh'), `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" --promote "* ]]; then
  touch "$FAKE_PROMOTE_MARKER"
  exit 98
fi
if [[ " $* " == *" --execute "* ]]; then
  printf '%s\\n' "$@" > "$FAKE_EXECUTE_MARKER"
  printf '%s\\n' 'fixture: stage upload failed' >&2
  exit 99
fi
printf '%s\\n' '[connector-runtime-r2] confirmationSha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
printf '%s\\n' '[connector-runtime-r2] PREVIEW ONLY; no network write was made'
`)
    writeExecutable(join(fakeBin, 'curl'), '#!/usr/bin/env bash\nprintf "0.4.24\\n"\n')
    writeExecutable(join(fakeBin, 'git'), `#!/usr/bin/env bash
if [[ " $* " == *" rev-parse "* ]]; then printf 'fixture\\n'; fi
exit 0
`)

    const env = {
      ...process.env,
      FAKE_EXECUTE_MARKER: executeMarker,
      FAKE_PROMOTE_MARKER: promoteMarker,
      HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE: signingKey,
      HZY_CONNECTOR_RUNTIME_STAGE_CONFIRMATION: 'not-the-preview-digest',
      PATH: `${fakeBin}:${process.env.PATH}`
    }
    delete env.HZY_CONNECTOR_RUNTIME_RELEASE_SIGNING_KEY_FILE

    const result = spawnSync(script, ['--resume', '--skip-tests'], {
      encoding: 'utf8',
      env
    })
    const output = `${result.stdout || ''}${result.stderr || ''}`

    assert.equal(result.status, 99, output)
    assert.match(output, /Using the shared Data Runtime release signing key/)
    assert.match(output, /Resuming immutable hzy-connector-runtime 0\.4\.25/)
    assert.match(output, /PREVIEW ONLY; no network write was made/)
    assert.match(output, /fixture: stage upload failed/)
    assert.equal(readFileSync(join(runtime, 'VERSION'), 'utf8').trim(), version)
    assert.deepEqual(readFileSync(executeMarker, 'utf8').trim().split('\n'), [
      version, '--stage', '--execute', '--confirm', 'a'.repeat(64)
    ])
    assert.equal(existsSync(promoteMarker), false)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
