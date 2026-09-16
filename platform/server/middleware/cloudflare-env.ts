type CloudflareHyperdrive = {
  host: string
  port: number
  user: string
  password: string
  database: string
}

type CloudflareRuntimeEnv = {
  HYPERDRIVE?: CloudflareHyperdrive
  [key: string]: unknown
}

type CloudflareRuntimeEvent = {
  context?: {
    cloudflare?: {
      env?: CloudflareRuntimeEnv
    }
    _platform?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
    nitro?: {
      env?: CloudflareRuntimeEnv
    }
  }
  req?: {
    runtime?: {
      cloudflare?: {
        env?: CloudflareRuntimeEnv
      }
    }
  }
}

declare global {
  var __hzyCloudflareEnv: CloudflareRuntimeEnv | undefined
}

export default defineEventHandler((event) => {
  const runtimeEvent = event as unknown as CloudflareRuntimeEvent

  const env = runtimeEvent.context?.cloudflare?.env
    || runtimeEvent.context?._platform?.cloudflare?.env
    || runtimeEvent.context?.nitro?.env
    || runtimeEvent.req?.runtime?.cloudflare?.env

  if (env) {
    globalThis.__hzyCloudflareEnv = env
  }
})
