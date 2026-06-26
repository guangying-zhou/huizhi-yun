# Notification Runtime 租户操作手册

本文面向租户管理员和服务器运维人员，说明如何在客户侧服务器安装
`notification-runtime`，配置域名、SSL、Nginx 反向代理，并在 Console 中启用企业微信通知。

`notification-runtime` 的职责是提供一个固定出口 IP 的通知代发服务。Cloudflare 上的业务应用
不直接访问企业微信 API，而是通过 Foundation `sendNotification()` 调用该运行时。

## 1. 调用链路

```text
业务应用 / Foundation sendNotification()
  -> https://<notification-runtime-domain>/v1/notifications/send
  -> notification-runtime
  -> Console OAuth2 + Integration/Vault
  -> 企业微信 API
```

## 2. 前置条件

准备以下信息：

- 一台可访问企业微信 API 的 Linux 服务器，建议在企业微信可信 IP / 固定出口 IP 环境内。
- 一个通知运行时域名，例如 `wecom-api.example.com`。
- 域名 A 记录指向该服务器公网 IP。
- 服务器开放 80 / 443 端口给公网访问。
- Console 租户入口可访问，例如 `https://<tenant>.huizhi.yun/`。
- 企业微信应用信息：`corpid`、`agentid`、`corpsecret`。

如果企业微信后台启用了 API IP 白名单，需要把该服务器的公网出口 IP 加入白名单。

## 3. Console 企业微信集成配置

在 Console 中配置 `wecom.default`：

1. 进入 Console `集成中心`。
2. 创建或编辑企业微信集成，集成编码使用：

   ```text
   wecom.default
   ```

3. 非密钥配置填写：

   ```text
   corpid=<企业微信 CorpID>
   agentid=<企业微信应用 AgentID>
   baseUrl=https://qyapi.weixin.qq.com
   ```

4. `corpsecret` 放入 Console 凭证库，并绑定到该集成当前凭证。

推荐使用 `db_encrypted` 保存 `corpsecret`。如果仍使用 `env_ref=WECOM_CORPSECRET`，则
Console 运行环境必须配置同名 secret；Cloudflare Console Worker 场景也必须用 Worker secret
配置该值。为减少环境变量依赖，生产建议迁移到 `db_encrypted`。

5. 在集成中心执行连通性检查，确认 `wecom_gettoken` 成功。

## 4. 企业微信可信 IP 配置

企业微信自建应用通常需要配置企业可信 IP。`notification-runtime` 代发消息时，请求企业微信 API 的来源
不是 Cloudflare Worker，而是安装 `notification-runtime` 的客户侧服务器公网出口 IP。

### 4.1 确认服务器公网出口 IP

在安装 `notification-runtime` 的服务器上执行：

```bash
curl -4 https://ifconfig.me
```

或：

```bash
curl -4 https://ipinfo.io/ip
```

记录返回的 IPv4 地址。若服务器通过 NAT、代理、堡垒机出口或云厂商 EIP 出网，应以实际访问公网时的
出口 IP 为准。

也可以用企业微信 `gettoken` 接口反查。如果未加入可信 IP，企业微信通常会返回类似 `60020` 的错误，
错误信息中可能包含当前请求来源 IP：

```bash
curl "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=<CORPID>&corpsecret=<CORPSECRET>"
```

期望成功结果包含：

```json
{
  "errcode": 0,
  "access_token": "..."
}
```

如果返回 `60020` 或 `not allow to access from your ip`，把错误信息中的来源 IP 加入企业可信 IP。

### 4.2 在企业微信后台添加可信 IP

登录企业微信管理后台：

```text
https://work.weixin.qq.com/wework_admin/
```

进入：

```text
应用管理 -> 自建应用 / 对应应用 -> 企业可信 IP
```

不同企业微信版本的入口名称可能显示为 `企业可信IP`、`可信来源IP` 或位于 `开发者接口 / 安全配置`
区域。进入后添加第 4.1 节确认的服务器公网出口 IP。

### 4.3 如需先配置可信域名

部分企业微信后台会要求先完成可信域名校验，之后才能配置企业可信 IP。此时域名建议使用
notification-runtime 的公网域名，例如：

```text
wecom-api.example.com
```

在企业微信后台申请域名校验后，会下载一个 `.txt` 校验文件。把该文件上传到服务器，例如：

```bash
sudo mkdir -p /var/www/wecom-verify
sudo cp WW_verify_xxx.txt /var/www/wecom-verify/WW_verify_xxx.txt
sudo chown -R nginx:nginx /var/www/wecom-verify
```

在 `wecom-api.example.com` 的 Nginx `server` block 中，将校验文件的精确匹配放在 `location /` 前面：

```nginx
location = /WW_verify_xxx.txt {
    alias /var/www/wecom-verify/WW_verify_xxx.txt;
    default_type text/plain;
}

location / {
    proxy_pass http://127.0.0.1:18081;
    proxy_http_version 1.1;
    proxy_intercept_errors off;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

重新加载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

确认公网能访问校验文件：

```bash
curl https://wecom-api.example.com/WW_verify_xxx.txt
```

企业微信后台域名校验通过后，再回到应用的企业可信 IP 页面添加服务器公网出口 IP。

### 4.4 企业微信端验证

在 `notification-runtime` 服务器上再次执行：

```bash
curl "https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=<CORPID>&corpsecret=<CORPSECRET>"
```

若返回 `errcode=0`，说明 `corpsecret` 和可信 IP 配置可用。若仍返回 `60020`，说明当前服务器实际出口 IP
未加入白名单，或出口 IP 发生了变化。

## 5. 生成安装指令

在 Console 中进入：

```text
通知运行时
```

点击 `生成指令`。Console 会完成以下动作：

- 创建或复用 `notification-runtime` service client。
- 创建或复用运行时 client secret。
- 自动确保 `notification-runtime` 拥有：

  ```text
  integration_config:view
  credential_vault:resolve
  ```

- 生成带有租户、deployment、Console OAuth 参数和 client secret 的安装命令。

安装命令包含敏感 client secret。不要公开粘贴到工单、聊天记录或代码仓库。如果泄露，回到该页面点击
`轮换并生成`，重新安装或更新服务器配置。

## 6. 安装 notification-runtime

登录客户侧服务器，执行 Console 页面复制的一键安装命令。命令形态类似：

```bash
curl -fsSL 'https://downloads.huizhi.yun/packages/hzy-notification-runtime/install.sh' | \
  sudo env \
    HZY_NOTIFICATION_RUNTIME_PACKAGE_BASE_URL='https://downloads.huizhi.yun/packages/hzy-notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_PORT='18081' \
    HZY_NOTIFICATION_RUNTIME_TENANT='<tenant-code>' \
    HZY_NOTIFICATION_RUNTIME_DEPLOYMENT='<deployment-code>' \
    HZY_CONSOLE_API_URL='https://console.huizhi.yun' \
    HZY_CONSOLE_TOKEN_URL='https://console.huizhi.yun/oauth/token' \
    HZY_NOTIFICATION_RUNTIME_AUTH_MODE='jwt' \
    HZY_NOTIFICATION_RUNTIME_AUDIENCE='notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_JWT_ISSUER='https://console.huizhi.yun' \
    HZY_NOTIFICATION_RUNTIME_JWKS_URL='https://console.huizhi.yun/.well-known/jwks.json' \
    HZY_NOTIFICATION_RUNTIME_CLIENT_ID='notification-runtime' \
    HZY_NOTIFICATION_RUNTIME_CLIENT_SECRET='<console-generated-secret>' \
    bash
```

安装完成后会创建：

- `/usr/local/bin/hzy-notification-runtime`
- `/opt/hzy/notification-runtime/.env`
- `hzy-notification-runtime.service`
- `hzy-notification-runtime-update.timer`

确认本机运行正常：

```bash
curl http://127.0.0.1:18081/runtime/health
systemctl status hzy-notification-runtime --no-pager
ss -lntp | grep 18081
```

期望返回类似：

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "tenant": "C000001",
    "deployment": "C000001-console",
    "authMode": "jwt",
    "providers": ["wecom"]
  }
}
```

## 7. 域名与 SSL

以 `wecom-api.example.com` 为例：

1. DNS 添加 A 记录：

   ```text
   wecom-api.example.com -> <服务器公网 IP>
   ```

2. 确认 80 / 443 端口开放。

3. 安装 Certbot。

Ubuntu / Debian：

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
```

AlmaLinux / CentOS / RHEL：

```bash
sudo dnf install -y certbot python3-certbot-nginx
```

4. 申请证书：

```bash
sudo certbot --nginx -d wecom-api.example.com
```

如果服务器 80 端口不能公网访问，需要改用 DNS-01 验证；此时按 DNS 服务商选择对应插件或手工添加
TXT 记录。

5. 验证自动续期：

```bash
sudo certbot renew --dry-run
```

## 8. Nginx 反向代理

建议为通知运行时使用独立配置文件，不要复用旧业务站点的 `server` block。

创建：

```bash
sudo vi /etc/nginx/conf.d/wecom-api.example.com.conf
```

配置：

```nginx
server {
    listen 80;
    server_name wecom-api.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name wecom-api.example.com;

    ssl_certificate /etc/letsencrypt/live/wecom-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/wecom-api.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:18081;
        proxy_http_version 1.1;
        proxy_intercept_errors off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

加载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

公网验证：

```bash
curl -i https://wecom-api.example.com/runtime/health
curl -i https://wecom-api.example.com/runtime/capabilities
```

`/runtime/health` 和 `/runtime/capabilities` 不需要业务 token；`POST /v1/notifications/send`
需要业务应用签发的 Bearer token。

## 9. 避免旧站点配置接管域名

不要把通知运行时域名加入已有旧站点的 `server_name`，尤其是带有下面配置的站点：

```nginx
listen 443 default_server ssl;

location / {
    proxy_pass https://legacy-upstream.example.com/;
}
```

否则 `https://wecom-api.example.com/runtime/health` 会被旧 `location /` 接管，返回旧系统页面或
Nginx 404。

排查命令：

```bash
sudo nginx -T 2>&1 | awk '
  /^# configuration file / { file=$0 }
  /wecom-api\.example\.com|proxy_pass|server_name/ {
    print file
    print NR ":" $0
  }
'

sudo grep -RIn "wecom-api.example.com" /etc/nginx
```

理想状态是 `wecom-api.example.com` 只出现在独立的通知运行时配置文件中。

## 10. Console 系统参数

公网 health 验证通过后，回到 Console：

```text
通知运行时 -> Runtime 地址
```

填写服务根地址，不要带接口路径：

```text
https://wecom-api.example.com
```

保存后，Console 会写入系统参数：

```text
notification.runtimeApiUrl=https://wecom-api.example.com
```

Foundation `sendNotification()` 会优先读取该参数，并自动调用：

```text
https://wecom-api.example.com/v1/notifications/send
```

系统参数有短缓存，通常 60 秒内生效。

## 11. 业务应用授权

调用通知运行时的业务应用 service client 必须拥有：

```text
notification-runtime:send
```

如果业务应用缺少该授权，Foundation 获取或使用 service token 时会失败，通知不会发出。可在 Console
`服务凭证` 页面检查对应业务应用的授权。

## 12. 业务调用方式

业务应用不需要直接配置企业微信 secret，也不直接请求企业微信 API。服务端调用 Foundation：

```ts
await sendNotification({
  touser: 'zhangsan',
  title: '审批待处理',
  description: '你有一个新的审批任务',
  url: 'https://example.huizhi.yun/workflow/tasks/1',
  btntxt: '查看详情',
  event
})
```

`touser` 必须是企业微信 UserID。多个用户可使用数组或 `|` 分隔。若业务侧只有汇智云 `uid`，需要先通过
Console Directory identity 映射到企业微信 UserID。

## 13. 验收清单

服务器本机：

```bash
curl http://127.0.0.1:18081/runtime/health
systemctl status hzy-notification-runtime --no-pager
systemctl status hzy-notification-runtime-update.timer --no-pager
```

公网：

```bash
curl -i https://wecom-api.example.com/runtime/health
curl -i https://wecom-api.example.com/runtime/capabilities
```

Console：

- `wecom.default` 连通性检查成功。
- 企业微信后台已为对应自建应用添加 notification-runtime 服务器公网出口 IP。
- `通知运行时` 页面 Runtime 地址已保存为 `https://wecom-api.example.com`。
- `通知运行时` 页面企业微信配置检测通过，并可向指定企业微信 UserID 发送测试消息。
- 测试发送后，Console 顶栏通知铃铛打开的统一消息中心能看到“企业微信测试消息发送成功/失败”记录。
- `notification-runtime` service client 存在，并拥有 `integration_config:view`、`credential_vault:resolve`。
- 业务应用 service client 拥有 `notification-runtime:send`。

业务侧：

- 触发一个真实待办、审批或测试通知。
- 企业微信收到 textcard。
- notification-runtime 日志出现成功发送记录。

查看日志：

```bash
journalctl -u hzy-notification-runtime -n 100 --no-pager
journalctl -u hzy-notification-runtime -f
```

## 14. 常见问题

### 公网 health 返回 Nginx 404

说明请求没有到 notification-runtime。检查：

```bash
curl http://127.0.0.1:18081/runtime/health
sudo nginx -T | grep -n -A40 -B10 "server_name wecom-api.example.com"
```

确认 `server_name` 所在的 `server` block 中有反向代理到 `127.0.0.1:18081`。

### HTTPS 证书域名不匹配

说明当前 443 虚拟主机使用了其它域名证书。检查：

```bash
echo | openssl s_client -connect wecom-api.example.com:443 -servername wecom-api.example.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName
```

重新用 Certbot 为正确域名签发证书，并确保 Nginx 当前 `server` block 引用了正确路径。

### POST 返回 401

`POST /v1/notifications/send` 需要业务应用 Bearer token。未带 token 直接 curl 返回 401 是正常的。

### POST 返回 502 且提示 WeCom 配置不完整

检查 `wecom.default`：

- `corpid` 是否存在。
- `agentid` 是否为数字。
- 当前 credential 是否绑定 `corpsecret`。
- Console 能否 resolve 该 secret。

### 企业微信返回 invalid ip

检查企业微信后台是否启用了企业可信 IP / API 白名单。把 notification-runtime 服务器公网出口 IP 加入白名单。
如果不确定出口 IP，从 notification-runtime 服务器直接调用 `gettoken`，按企业微信返回的错误信息确认来源 IP。

### 修改 Runtime 地址后业务应用仍调用旧地址

Foundation 对系统参数有短缓存，等待约 60 秒后重试。必要时重启业务应用或触发 Worker 冷启动。
