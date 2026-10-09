import type { Server as HttpServer } from 'node:http'

/** Hocuspocus passes `address`, which Node ignores. Pin this instance's host. */
export function bindLoopbackListener(server: HttpServer, address: string) {
  if (!['127.0.0.1', '::1'].includes(address)) throw new Error('collab_loopback_address_required')
  const listen = server.listen
  server.listen = ((options: unknown, ...args: unknown[]) => {
    // Fail closed if the provider changes its listen signature. Never fall back
    // to Node's wildcard binding or alter unrelated servers in this process.
    if (!options || typeof options !== 'object' || !('port' in options)) throw new Error('collab_listen_options_invalid')
    return Reflect.apply(listen, server, [{ ...options, host: address }, ...args])
  }) as HttpServer['listen']
}
