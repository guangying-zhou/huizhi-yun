# Legacy Auth Bridge

本文档用于明确 Foundation 中仍然保留的旧认证桥接路径，避免后续继续把新平台逻辑堆进旧链路。

## 目标

- 标记现网仍依赖的 `CAS / account` 相关入口
- 明确这些入口只负责兼容，不再承担新平台主协议职责
- 给后续 `hzy_platform` Identity Plane / platform client 提供替代方向

## 当前属于 Legacy Bridge 的文件

- `foundation/server/utils/casAuth.ts`
- `foundation/server/api/auth/cas-login.get.ts`
- `foundation/server/api/auth/cas-callback.get.ts`
- `foundation/server/utils/accountApi.ts`
- `foundation/app/composables/useLegacyAuthBridge.ts`

## 边界

- 可以保留：现网 CAS 登录、回调、旧 Account API 依赖、兼容登出行为
- 不应新增：`hzy_platform` token、OIDC、bundle、revocation、deployment heartbeat 等新平台能力

## 替代路线

未来新平台链路应逐步收敛到：

1. `hzy_platform` Identity Plane
2. `platform-sdk`
3. `platform-adapter-nuxt`
4. `foundation` facade / bridge 缩小

## 迁移原则

- 旧入口先保留，不做破坏性修改
- 新应用不得新增对该桥的直接依赖
- 旧应用迁移完成后，再考虑真正下线对应入口
