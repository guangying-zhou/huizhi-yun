# Wiztek Keycloak 生产配置与运维手册

状态：生产现状留存 / 运维 Runbook

适用租户：Wiztek（`C000001`）

最后只读核对：2026-07-21

配置宿主机：`root@8.130.81.31`

> 本文记录 `sso.wiztek.cn` 当前生产 Keycloak 的**脱敏配置**、部署方式、验证步骤、已知故障与回滚方法。
> 本文不是汇智云身份平面的目标架构定义。长期身份边界仍以
> [`Identity-Plane-Design.md`](./Identity-Plane-Design.md) 和
> [`console/docs/Console-Auth-Runtime-IdP-Implementation-Plan.md`](../console/docs/Console-Auth-Runtime-IdP-Implementation-Plan.md)
> 为准。

## 1. 安全边界

本文允许留存：

- 域名、端口、镜像版本、Realm 名称、Client ID、Redirect URI；
- LDAP URL、Bind DN、Users DN、属性映射和非秘密运行参数；
- 脱敏 Compose/Nginx 结构、验证命令、回滚步骤；
- 不含用户身份、密码或 Token 的稳定错误码和故障特征。

本文和 Git **不得**留存：

- Keycloak 管理员密码；
- PostgreSQL 用户密码；
- OIDC Client Secret；
- LDAP Bind Credential；
- Access Token、Refresh Token、授权码、Cookie、私钥或完整环境变量输出；
- 未脱敏的 Realm、Client 或 LDAP Provider 全量导出。

上述秘密只允许保存在服务器受控环境或凭证库中。执行 `docker compose config` 时必须将输出重定向到
`/dev/null`，禁止把展开后的配置粘贴到工单、日志或本文。

## 2. 当前登录链路

```text
浏览器
  -> https://wiztek.huizhi.yun
  -> Console 上游 OIDC 登录
  -> https://sso.wiztek.cn/realms/wiztek
  -> Keycloak LDAP User Federation
  -> ldaps://ldap.wiztek.cn:636
  -> OpenLDAP

Keycloak 登录成功
  -> https://wiztek.huizhi.yun/api/auth/oidc-callback
  -> Console 本地会话
  -> Console OIDC
  -> Aims / Codocs / Assets / Finance / People 等业务应用
```

Keycloak 是 Wiztek 当前的**上游企业身份提供方**。业务应用不直接接入 Keycloak 或 LDAP，而是继续消费
Console OIDC。

## 3. 部署快照

### 3.1 Keycloak 与数据库

| 项目 | 当前值 |
| --- | --- |
| 公网入口 | `https://sso.wiztek.cn` |
| 宿主机 | `8.130.81.31` |
| Compose 目录 | `/opt/keycloak` |
| Compose 文件 | `/opt/keycloak/docker-compose.yml` |
| Keycloak 容器 | `keycloak` |
| Keycloak 镜像 | `quay.io/keycloak/keycloak:26.3.3` |
| PostgreSQL 容器 | `keycloak-postgres` |
| PostgreSQL 镜像 | `postgres:16` |
| 容器重启策略 | `unless-stopped` |
| 宿主机监听 | `127.0.0.1:18080 -> keycloak:8080` |
| TLS 终止 | 宿主机 Nginx |
| 容器启动方式 | `kc.sh start` |
| 代理头 | `xforwarded` |
| Keycloak hostname | `sso.wiztek.cn` |
| HTTP | 容器内启用，仅经本机 Nginx 反向代理 |
| Hostname strict | 启用 |

2026-07-21 只读核对时：

- `keycloak` 和 `keycloak-postgres` 均为 `running`；
- Realm discovery 返回 HTTP `200`；
- Keycloak 容器启动时间为 `2026-07-21T14:21:44Z`；
- LDAP TLS 证书主体为 `CN=*.wiztek.cn`，有效期至 `2027-01-06T23:59:59Z`。

证书有效期属于观察值，不是长期配置锚点；续期后应更新本节核对日期。

### 3.2 脱敏 Compose 结构

以下内容用于说明结构，不得替代服务器上的真实 Compose 文件：

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - <postgres-data-volume>:/var/lib/postgresql/data

  keycloak:
    image: quay.io/keycloak/keycloak:26.3.3
    restart: unless-stopped
    depends_on:
      - postgres
    command:
      - start
      - --http-enabled=true
      - --proxy-headers=xforwarded
      - --hostname=sso.wiztek.cn
    environment:
      KC_DB: postgres
      KC_DB_URL_HOST: postgres
      KC_DB_URL_DATABASE: ${POSTGRES_DB}
      KC_DB_USERNAME: ${POSTGRES_USER}
      KC_DB_PASSWORD: ${POSTGRES_PASSWORD}
      KC_HTTP_ENABLED: "true"
      KC_HOSTNAME: sso.wiztek.cn
      KC_HOSTNAME_STRICT: "true"
      KEYCLOAK_ADMIN: ${KEYCLOAK_ADMIN}
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD}
      JAVA_OPTS_APPEND: >-
        -Dcom.sun.jndi.ldap.connect.pool.timeout=60000
    ports:
      - 127.0.0.1:18080:8080
```

服务器当前使用的敏感环境变量名包括：

- `KC_DB_USERNAME`
- `KC_DB_PASSWORD`
- `KEYCLOAK_ADMIN`
- `KEYCLOAK_ADMIN_PASSWORD`

只记录变量名，不记录变量值。

### 3.3 Nginx 反向代理

配置文件：`/etc/nginx/vhost/sso.wiztek.cn.conf`

脱敏后的关键结构：

```nginx
server {
    listen 80;
    server_name sso.wiztek.cn;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        try_files $uri =404;
    }
}

server {
    listen 443 ssl;
    server_name sso.wiztek.cn;

    ssl_certificate /etc/letsencrypt/live/sso.wiztek.cn/fullchain.pem;
    ssl_certificate_key <redacted>;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header Connection "";
    }
}
```

Keycloak 依赖这些 `X-Forwarded-*` 头生成正确的 HTTPS issuer、redirect URI 和 Cookie。修改代理配置后必须同时
验证 discovery 中的 `issuer` 与 `authorization_endpoint`。

## 4. Realm 配置

Realm：`wiztek`

| 配置项 | 当前值 |
| --- | --- |
| Enabled | `true` |
| SSL Required | `external` |
| User registration | `false` |
| Login with email | `true` |
| Duplicate emails | `false` |
| Reset password | `false` |
| Remember me | `false` |
| Access Token Lifespan | `300` 秒 |
| SSO Session Idle | `1800` 秒 |
| SSO Session Max | `36000` 秒 |
| Default signature algorithm | `RS256` |
| Revoke refresh token | `false` |
| Refresh token max reuse | `0` |

当前认证 Flow 绑定：

| 用途 | Flow alias |
| --- | --- |
| Browser | `browser` |
| Registration | `registration` |
| Direct grant | `direct grant` |
| Reset credentials | `reset credentials` |
| Client authentication | `clients` |
| Docker authentication | `docker auth` |

Realm 内部 UUID、组件 UUID 等由 Keycloak 生成，不作为部署或自动化的稳定锚点。自动化应使用 Realm 名、
Client ID 和 Provider 名定位对象。

## 5. Console 上游 OIDC Client

Client ID：`hzy_wiztek_cn`

| 配置项 | 当前值 |
| --- | --- |
| Enabled | `true` |
| Protocol | `openid-connect` |
| Client authentication | 启用（`publicClient=false`） |
| Standard flow | `true` |
| Direct access grants | `false` |
| Service accounts | `false` |
| Root URL | `https://wiztek.huizhi.yun` |
| Home/Base URL | `https://wiztek.huizhi.yun` |
| Web Origins | `https://wiztek.huizhi.yun` |
| 主 Redirect URI | `https://wiztek.huizhi.yun/api/auth/oidc-callback` |
| 兼容 Redirect URI | `https://hzy.wiztek.cn/api/auth/oidc-callback` |

Client 默认 scopes：`web-origins`、`acr`、`roles`、`profile`、`basic`、`email`。

Client 可选 scopes：`address`、`phone`、`offline_access`、`organization`、`microprofile-jwt`。

Client 当前没有专属 protocol mapper，claims 由 Realm 默认 client scopes 提供。

`https://hzy.wiztek.cn/api/auth/oidc-callback` 是当前仍存在的兼容项。如果该旧域名已经正式退役，应在独立
维护窗口确认无调用后删除；本文不把“已存在”解释为“必须永久保留”。

Client Secret 不进入本文。轮换 Secret 时应先在 Keycloak 生成新值，再通过 Console 受控凭证配置更新，完成
真实登录验收后撤销旧值。

## 6. LDAP User Federation

Provider 名：`Wiztek LDAP`

| 配置项 | 当前值 |
| --- | --- |
| Provider | `ldap` |
| Enabled | `true` |
| Connection URL | `ldaps://ldap.wiztek.cn:636` |
| Bind DN | `cn=Manager,dc=wiztek,dc=cn` |
| Users DN | `dc=wiztek,dc=cn` |
| Username LDAP attribute | `uid` |
| UUID LDAP attribute | `entryUUID` |
| RDN LDAP attribute | `sAMAccountName` |
| User object classes | `inetOrgPerson` |
| Search scope | `2`（Subtree） |
| Edit mode | `READ_ONLY` |
| Import users | `true` |
| Sync registrations | `true` |
| Pagination | `true` |
| Connection pooling | `true` |
| Connection timeout | `10000` ms |
| Read timeout | `20000` ms |
| StartTLS | `false`（使用 LDAPS） |
| Use Truststore SPI | `never` |
| Cache policy | `DEFAULT` |
| Full sync period | `-1` |
| Changed sync period | `-1` |
| Remove invalid users | `true` |
| Trust email | `false` |
| Password Modify Extended Operation | `false` |
| Kerberos | `false` |

LDAP Bind Credential 只存在 Keycloak 受控配置中。禁止使用未脱敏的 Admin API 全量导出，因为全量 Provider
对象可能包含 `bindCredential`。

### 6.1 LDAP 属性 Mapper

| Mapper | LDAP 属性 | Keycloak 用户属性 | 必需 | 只读 | 每次从 LDAP 读取 |
| --- | --- | --- | --- | --- | --- |
| `username` | `uid` | `username` | 是 | 是 | 否 |
| `email` | `mail` | `email` | 否 | 是 | 否 |
| `first name` | `cn` | `firstName` | 是 | 是 | 是 |
| `last name` | `sn` | `lastName` | 是 | 是 | 是 |
| `creation date` | `createTimestamp` | `createTimestamp` | 否 | 是 | 是 |
| `modify date` | `modifyTimestamp` | `modifyTimestamp` | 否 | 是 | 是 |
| `Kerberos principal attribute mapper` | 未配置 | 未配置 | — | — | — |

Kerberos 当前关闭；保留的空 Kerberos mapper 不表示 Kerberos 登录已经启用。

### 6.2 需要后续复核的两项现状

1. 当前目录是 OpenLDAP 风格（`inetOrgPerson`、`uid`、`entryUUID`），但 RDN 属性为
   `sAMAccountName`。这是 Active Directory 常见属性。不要直接修改；应先核对真实条目 DN 和 Mapper，
   再用测试账号完成查找、首次导入、重复登录和目录同步回归。
2. 当前 `Use Truststore SPI=never`。Keycloak 最新管理文档已将该配置标记为 deprecated，并建议通常使用
   `Always`。当前 LDAP 使用公共 CA 且连接正常，因此本次不冒险变更；后续应在维护窗口验证 JVM/Keycloak
   truststore 后再收敛。

## 7. 2026-07-21 LDAP 首次登录失败修复

### 7.1 现象

- 用户会话过期后重新登录，偶发第一次失败、第二次成功；
- Console 登录审计将第一次记录为失败，用户为空；
- Keycloak 页面显示通用“认证提供方未知错误”；
- Keycloak 日志实际错误为：

```text
javax.naming.CommunicationException: LDAP connection has been closed
```

Keycloak 将该 LDAP 通信异常表面化为 `LOGIN_ERROR` / `invalid_user_credentials`，但实际不是用户密码错误。

### 7.2 根因

LDAP connection pooling 开启后，长时间空闲的连接可能已被 LDAP 服务端关闭。下一次登录复用失效连接时
第一次认证失败；随后连接池新建连接，所以第二次登录成功。

### 7.3 已实施修复

在 Keycloak 服务的 `JAVA_OPTS_APPEND` 中加入：

```text
-Dcom.sun.jndi.ldap.connect.pool.timeout=60000
```

该值表示池中空闲连接保留 `60000` 毫秒，随后由 JNDI 连接池关闭并移除，避免长期复用服务端已经回收的连接。
修改连接池 JVM 属性后必须重新创建或重启 Keycloak 容器，才能重新初始化 LDAP Provider。

变更前 Compose 备份：

```text
/opt/keycloak/docker-compose.yml.before-ldap-pool-timeout-20260721
```

本次只重新创建了 `keycloak`，没有重建 PostgreSQL。

### 7.4 修复验证

确认 JVM 属性已经生效：

```bash
docker exec keycloak sh -lc \
  'jcmd 1 VM.system_properties | grep ^com.sun.jndi.ldap.connect.pool.timeout='
```

期望输出：

```text
com.sun.jndi.ldap.connect.pool.timeout=60000
```

确认修复后未继续出现相同错误：

```bash
docker logs --since 24h keycloak 2>&1 \
  | grep -F 'LDAP connection has been closed'
```

无输出表示该观察窗口内未出现同类错误。最终验收仍应使用真实测试账号执行：

1. 保持登录链路空闲超过历史复现周期；
2. 第一次输入正确密码即成功；
3. 回到 `https://wiztek.huizhi.yun/` 并建立 Console 会话；
4. Keycloak 与 Console 登录审计均无相邻的失败/成功双记录；
5. Keycloak 日志无 LDAP closed、timeout 或 bind 异常。

## 8. 日常检查

### 8.1 容器与公开入口

```bash
ssh root@8.130.81.31
cd /opt/keycloak

docker compose ps
docker inspect keycloak --format '{{.State.Status}} {{.State.StartedAt}}'
docker inspect keycloak-postgres --format '{{.State.Status}} {{.State.StartedAt}}'

curl -fsS -o /dev/null \
  https://sso.wiztek.cn/realms/wiztek/.well-known/openid-configuration
```

当前没有启用独立 Keycloak health endpoint，因此以容器状态、Realm discovery 和真实登录链路共同判断健康，
不能只用“容器正在运行”代替认证验收。

### 8.2 检查 issuer 与端点域名

```bash
curl -fsS \
  https://sso.wiztek.cn/realms/wiztek/.well-known/openid-configuration \
  | jq '{issuer,authorization_endpoint,token_endpoint,jwks_uri}'
```

所有公开端点应使用 `https://sso.wiztek.cn`，不得出现 `http://127.0.0.1:18080` 或容器内部主机名。

### 8.3 检查 LDAP TLS

```bash
openssl s_client \
  -connect ldap.wiztek.cn:636 \
  -servername ldap.wiztek.cn </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates
```

### 8.4 安全读取日志

```bash
docker logs --since 30m keycloak 2>&1 \
  | grep -E 'LOGIN_ERROR|LDAP|CommunicationException|ERROR|WARN'
```

不要使用会输出请求参数、Cookie、授权码或 Token 的全量 debug 日志作为常态配置。只有在受控维护窗口排障时才
临时提高日志级别，完成后立即恢复。

## 9. 变更流程

### 9.1 变更前

```bash
ssh root@8.130.81.31
cd /opt/keycloak

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
install -m 600 docker-compose.yml "docker-compose.yml.before-${stamp}"

# 只校验，不把展开后的秘密输出到终端或文件。
docker compose config >/dev/null
```

同时确认：

- PostgreSQL 有可恢复备份；
- 当前 Keycloak 镜像 tag 和 Compose 备份文件名已经记录；
- 至少保留一个 Keycloak 本地 break-glass 管理员，凭证在受控凭证库中；
- 有可用于真实 OIDC + LDAP 登录的测试账号；
- 变更窗口内可以回滚 Nginx、Compose 与 Client/Realm 配置。

### 9.2 只重新创建 Keycloak

```bash
cd /opt/keycloak
docker compose up -d --no-deps --force-recreate keycloak

docker compose ps
docker logs --since 5m keycloak
curl -fsS -o /dev/null \
  http://127.0.0.1:18080/realms/wiztek/.well-known/openid-configuration
curl -fsS -o /dev/null \
  https://sso.wiztek.cn/realms/wiztek/.well-known/openid-configuration
```

### 9.3 变更后验收

- 容器与 PostgreSQL 均为 `running`；
- 本机和公网 discovery 均返回 `200`；
- discovery issuer 与端点使用 `https://sso.wiztek.cn`；
- Nginx 配置 `nginx -t` 通过；
- 正确密码第一次登录成功；
- Console callback 成功且业务应用能复用 Console 会话；
- 错误密码仍失败，且不会创建 Console 会话；
- Keycloak 日志没有新的 LDAP、数据库或代理头错误。

## 10. 回滚

以 2026-07-21 连接池变更为例：

```bash
ssh root@8.130.81.31
cd /opt/keycloak

install -m 600 \
  docker-compose.yml.before-ldap-pool-timeout-20260721 \
  docker-compose.yml

docker compose config >/dev/null
docker compose up -d --no-deps --force-recreate keycloak

docker compose ps
curl -fsS -o /dev/null \
  https://sso.wiztek.cn/realms/wiztek/.well-known/openid-configuration
```

回滚后仍必须执行真实 OIDC + LDAP 登录验证。若数据库 schema 已随 Keycloak 升级发生变化，不能只回滚镜像；
必须使用对应版本的数据库备份和 Keycloak 官方升级/降级指南制定独立恢复方案。

## 11. 备份与恢复要求

至少保留：

- `/opt/keycloak/docker-compose.yml` 的 `0600` 变更前副本；
- Keycloak PostgreSQL 的定期逻辑备份或卷快照；
- Nginx vhost 与证书续期配置；
- 不含 Secret 的 Realm、Client、Mapper 和 LDAP Provider 脱敏清单；
- 每次真实登录验收的时间、结果和稳定错误码。

禁止把未脱敏的 Keycloak 全量导出直接提交到仓库。恢复演练应验证：Realm、Client、LDAP Mapper、用户导入、
Console callback、下游应用 OIDC 和管理员 break-glass 登录。

## 12. 后续维护项

| 优先级 | 项目 | 当前处理 |
| --- | --- | --- |
| P1 | 观察连接池修复经过一个历史空闲周期后的首次登录 | 待真实账号持续验收 |
| P1 | 为 Keycloak/PostgreSQL 建立可验证的备份恢复演练 | 待维护窗口执行 |
| P2 | 核对 OpenLDAP 的 `RDN=sAMAccountName` 是否符合真实条目 | 先验证，不直接修改 |
| P2 | 评估 `Use Truststore SPI` 从 `never` 收敛到推荐配置 | 先验证 truststore |
| P2 | 评估删除旧 `hzy.wiztek.cn` Redirect URI | 确认域名退役后处理 |
| P2 | 补充 Keycloak readiness/metrics 并纳入监控 | 当前以 discovery + 登录验收为准 |
| P3 | Keycloak 版本升级 | 独立评估 release notes、数据库迁移和回滚 |

## 13. 官方参考

- [Keycloak Server Administration Guide：LDAP 与连接池](https://www.keycloak.org/docs/latest/server_admin/)
- [Running Keycloak in a container](https://www.keycloak.org/server/containers)
- [Configuring the hostname](https://www.keycloak.org/server/hostname)
- [Configuring a reverse proxy](https://www.keycloak.org/server/reverseproxy)
- [Keycloak Upgrading Guide](https://www.keycloak.org/docs/latest/upgrading/)

## 14. 变更记录

| 日期 | 变更 | 验证 |
| --- | --- | --- |
| 2026-07-21 | 为 JNDI LDAP 连接池增加 `timeout=60000`，只重建 Keycloak 容器 | JVM 属性生效；Realm discovery `200`；未再观察到 `LDAP connection has been closed` |
| 2026-07-21 | 形成本文并只读复核生产 Keycloak、Realm、OIDC Client、LDAP Provider、Nginx 与 TLS | 所有记录均为脱敏投影；未读取或落盘任何 Credential |
