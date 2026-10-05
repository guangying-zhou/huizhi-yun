// 避免 workspace hoist 的 @types/ali-oss 解析问题
// 提供最小化声明满足 typecheck；运行时行为不受影响
declare module 'ali-oss' {
  interface OssGetResult {
    content: unknown
    res: {
      headers: Record<string, string>
    }
  }

  class OSS {
    constructor(options: Record<string, unknown>)
    get(path: string): Promise<OssGetResult>
  }

  export = OSS
}
