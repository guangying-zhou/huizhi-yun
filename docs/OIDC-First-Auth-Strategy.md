# OIDC 优先、CAS 兼容的认证协议策略

状态：Draft，已按 Console auth-runtime 目标边界更新  
日期：2026-04-29  
定位：认证协议策略 ADR，作为 `Huizhi-yun-Platform-Target-Architecture.md`、`Identity-Plane-Design.md` 与 `Console-Auth-Runtime-IdP-Implementation-Plan.md` 的补充说明

---

## 1. 结论

汇智云应用侧认证协议策略明确为：

- **对上游身份源：兼容多种协议与产品**
- **对下游业务应用：由 Console 统一优先输出 OIDC**

也就是：

`上游身份源 -> Console auth-runtime -> OIDC -> 下游业务应用`

Platform Identity Plane 仍然存在，但它的目标边界收敛为：控制面账号、平台 session、policy bundle / license / revocation 签名、runtime token 与授权治理。它不再作为企业应用用户的下游 IdP。

---

## 2. 适用范围

本策略适用于：

- `aims`
- `codocs`
- 后续平台自带应用
- 未来第三方应用
- `foundation` / `Foundation SDK` 的鉴权实现

---

## 3. 对上游的策略

Console auth-runtime 作为企业侧 federation / IdP 层，可兼容接入以下上游身份源：

- `CAS`
- `企业微信`
- `GitLab OIDC`
- 通用 `OIDC`
- `SAML`
- `LDAP`（通过 connector / 委托认证）

这些身份源的差异，不应继续泄漏到业务应用。

---

## 4. 对下游的策略

Console 对下游业务应用统一提供：

- OIDC 登录流程
- JWT access token
- JWKS / 公钥体系
- 标准 claims
- refresh / session 管理能力

Platform 对业务应用仍提供 signed policy bundle、license、revocation 与应用治理数据，但不直接承载应用用户登录会话。

业务应用和 SDK 不应再直接理解：

- CAS ticket
- 企业微信 OAuth 回调细节
- GitLab 特有登录语义
- LDAP 认证过程

---

## 5. 为什么 OIDC 优先

选择 OIDC 作为 Console 对下游业务应用的标准协议，原因如下：

1. 更适合现代分布式架构  
   适合 JWT、本地验签、SDK、本地缓存 bundle 的模型。

2. 生态成熟  
   Web、移动端、API 网关、第三方应用、各类语言框架对 OIDC 支持更完整。

3. 更利于标准化  
   OIDC 自带 `claims`、`JWKS`、`userinfo`、`refresh` 等现代身份要素。

4. 更适合 app 市场和第三方接入  
   比 CAS 更容易成为应用侧统一协议。

---

## 6. CAS 的定位

CAS 不是禁用，而是重新定位为：

- **兼容已有企业认证中心的上游协议**

它不再应该是：

- Console 对下游业务应用的主协议
- 新 app 直接接入的平台协议

一句话：

**CAS 是上游连接器，不是下游应用协议。**

---

## 7. GitLab OIDC 的定位

对于研发型客户，若满足：

- GitLab 已与 LDAP/AD 打通
- GitLab 是研发主入口
- 平台主要服务研发场景

则 GitLab OIDC 可以作为优先上游身份源。

但即便如此，也应保持：

- GitLab 是**上游身份源**
- Platform 仍使用自己的 `subject / role / template / scope` 授权治理模型
- Console 对下游应用仍统一输出 OIDC

---

## 8. 架构表达

正确的抽象应为：

```text
LDAP/AD
   └─> GitLab OIDC / CAS / 企业微信 / 通用 OIDC
           └─> Console auth-runtime
                   └─> OIDC
                           └─> aims / codocs / other apps

Platform
   └─> signed policy bundle / license / revocation
           └─> aims / codocs / other apps
```

这意味着：

- 上游可以替换
- 下游应用不受影响
- `foundation` / SDK 的实现边界清晰

---

## 9. 对现状的指导意义

结合当前现状，建议的演进顺序是：

1. Console auth-runtime 先明确 `OIDC-first`
2. CAS、企业微信先作为 Console 的上游 connector
3. 如果研发客户占主流，优先补 `GitLab OIDC` connector
4. 新 app 一律不要再直接接 CAS

---

## 10. ADR

| ID | 决策 |
|---|---|
| ADR-AUTH-001 | Console 对下游业务应用统一提供 OIDC |
| ADR-AUTH-002 | CAS 作为上游兼容协议保留，不再作为下游业务应用协议 |
| ADR-AUTH-003 | GitLab OIDC 可作为研发型客户的优先上游身份源之一 |
| ADR-AUTH-004 | Platform Identity Plane 不保存应用用户 session、refresh token 或 OIDC client secret |
