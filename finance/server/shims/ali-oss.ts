export default class OSS {
  constructor() {
    throw new Error('ali-oss native provider is not available in Cloudflare builds; set HZY_OBJECT_STORAGE_PROVIDER=aliyun-oss-s3')
  }

  get() {
    throw new Error('ali-oss native provider is not available in Cloudflare builds')
  }
}
