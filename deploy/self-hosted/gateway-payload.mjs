import { cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const GATEWAY_PAYLOAD_PATHS = Object.freeze([
  'deploy/self-hosted/gateway', 'deploy/cloudflare/tenant-gateway/src', 'foundation/shared',
  'deploy/test-env/enterprise-host-routes.mjs', 'deploy/test-env/enterprise-topology.mjs',
  'enterprise/composition/business-api-routes.generated.mjs',
  'deploy/self-hosted/collab-deployment.mjs'
])

export async function copyGatewayPayload(repo, out) {
  for (const path of GATEWAY_PAYLOAD_PATHS) {
    await mkdir(dirname(join(out, path)), { recursive: true })
    await cp(join(repo, path), join(out, path), { recursive: true, filter: source => !source.includes('/test/') })
  }
  await writeFile(join(out, 'package.json'), '{"private":true,"type":"module"}\n')
}
