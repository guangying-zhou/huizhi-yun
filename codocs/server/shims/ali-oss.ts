export default class OSS {
  readonly unavailable = true

  constructor() {
    throw new Error('ali-oss native provider is not available in Cloudflare builds; set HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3')
  }
}
