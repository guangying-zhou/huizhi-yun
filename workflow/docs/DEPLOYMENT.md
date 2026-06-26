# Workflow 模块部署文档

> 端口：3020 | 域名：workflow.wiztek.cn | 数据库：tenant-runtime 托管 `hzy_workflow` | PM2 进程名：hzy-workflow

本文档描述 Workflow 模块首次上线到生产环境的完整步骤。假设服务器已经部署过 Console/tenant-runtime（或 data-runtime）、Node.js、pnpm、PM2、nginx，且 runtime 侧可访问 MySQL。

---

## 一、前置检查

在部署服务器上确认以下组件已安装：

```bash
node -v         # 建议 v20+
pnpm --version  # 建议 v10+
pm2 --version
nginx -v
mysql --version   # runtime 数据库初始化时使用
```

当前不再通过 CI/CD 自动部署，部署和更新由服务器上的 PM2 与手工脚本维护。

---

## 二、runtime 数据库初始化

Workflow 应用自身不直连 MySQL。先在 tenant-runtime/data-runtime 使用的 MySQL 上创建 workflow 专用数据库：

```sql
CREATE DATABASE IF NOT EXISTS hzy_workflow
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

然后在 runtime 侧执行 schema 与迁移脚本（在仓库根目录）：

```bash
# 主表结构
mysql -u root -p hzy_workflow < workflow/docs/workflow_schema.sql

# 按顺序执行 migrations 下的增量迁移
ls workflow/docs/migrations/
for f in workflow/docs/migrations/*.sql; do
  echo "Running $f"
  mysql -u root -p hzy_workflow < "$f"
done
```

---

## 三、准备生产 .env

密钥统一放在 `/opt/huizhi-yun/secrets/` 目录下（与 account/codocs 的约定一致）。

```bash
sudo mkdir -p /opt/huizhi-yun/secrets/workflow
sudo vim /opt/huizhi-yun/secrets/workflow/.env
```

参考 `.env.dev` 配置以下变量：

```bash
# 公开访问 URL
NUXT_PUBLIC_SITE_URL=http://workflow.wiztek.cn
CAS_SERVICE_URL=http://workflow.wiztek.cn

# CAS SSO
CAS_ENABLE=true
CAS_BASE_URL=https://cas.wiztek.cn:8443

# tenant-runtime/data-runtime
HZY_TENANT_RUNTIME_URL=http://127.0.0.1:18080
HZY_WORKFLOW_DATA_ACCESS_MODE=tenant-runtime

# Console OIDC / Directory
HZY_CONSOLE_URL=https://console.wiztek.cn
HZY_CONSOLE_API_URL=https://console.wiztek.cn

# Workflow 对外地址与 Console service client grants 由 Console/Platform 管理。
# 业务应用本地 env 不新增 HZY_WORKFLOW_API_URL 或 service client secret。

# 企业微信 OAuth
WECOM_CORPID=wwxxxxxxxx
WECOM_CORPSECRET=xxxxxxxx
WECOM_AGENTID=1000007

# 通知重定向（留空则正常发送；上线初期可先填一个内部账号用于灰度）
NOTIFY_REDIRECT_TO=
```

设置权限：

```bash
sudo chmod 600 /opt/huizhi-yun/secrets/workflow/.env
```

---

## 四、Nginx 反向代理

### 4.1 先配 80 端口

```bash
sudo cp /opt/huizhi-yun/workflow/deploy/nginx.conf \
        /etc/nginx/conf.d/workflow.wiztek.cn.conf
sudo nginx -t && sudo systemctl reload nginx
```

> 首次部署时 `/opt/huizhi-yun/workflow/deploy/nginx.conf` 尚不存在，可直接把仓库里的 `workflow/deploy/nginx.conf` 手动 `scp` 过去，或等 CI 部署后再 copy。

### 4.2 验证 DNS

在任意一台机器执行：

```bash
dig workflow.wiztek.cn +short     # 应返回生产服务器 IP
curl -I http://workflow.wiztek.cn # 应能代理到 3020（此时 PM2 未启可能 502，正常）
```

### 4.3 申请 HTTPS 证书（Let's Encrypt）

```bash
sudo certbot --nginx -d workflow.wiztek.cn
```

certbot 会自动：
- 通过 80 端口完成 HTTP-01 挑战验证
- 把 443 SSL server block 追加到 `workflow.wiztek.cn.conf`
- 添加 HTTP → HTTPS 301 跳转
- 注册 systemd 定时任务自动续期

验证续期：

```bash
sudo certbot renew --dry-run
```

拿到证书后把 `.env` 里的 URL 改成 `https://`：

```bash
NUXT_PUBLIC_SITE_URL=https://workflow.wiztek.cn
CAS_SERVICE_URL=https://workflow.wiztek.cn
```

然后 `pm2 restart hzy-workflow` 生效。

---

## 五、手工部署

当前不再通过 GitLab CI/CD 部署 Workflow。手工部署的基本流程如下：

```bash
cd /opt/huizhi-yun/workflow
pnpm install
test -f /opt/huizhi-yun/secrets/workflow/.env && cp /opt/huizhi-yun/secrets/workflow/.env .env
pnpm build
pm2 delete hzy-workflow 2>/dev/null || true
pm2 start /opt/huizhi-yun/workflow/deploy/ecosystem.config.cjs --only hzy-workflow
pm2 save
```

观察服务器日志：

```bash
pm2 status
pm2 logs hzy-workflow --lines 100
tail -f /var/log/nginx/workflow.error.log
```

访问 `http://workflow.wiztek.cn`（或 https，证书配好后）应可看到登录页。

---

## 六、业务模块配置更新

workflow 上线后，所有依赖它的业务模块通过 Console 运行时参数 `workflow.apiUrl` 读取 Workflow 地址，不在各自生产 `.env` 里新增 `HZY_WORKFLOW_API_URL`。

目前需要更新的模块：

- `account/.env` — 如需审批相关管理端
- `codocs/.env` — **必须**，解决之前 `/api/workflow-proxy/*` 502 的问题
- `aims/.env` — 项目立项/结项审批
- `altoc/.env` — 后续接入时

修改后 `pm2 restart <name>` 重载。

---

## 七、回滚

生产出问题时快速回滚：

```bash
pm2 stop hzy-workflow
# 手动从备份恢复 .output
pm2 start /opt/huizhi-yun/workflow/deploy/ecosystem.config.cjs --only hzy-workflow
```

建议手工部署前先备份当前 `.output` 到 `.output.bak/` 以便快速回滚。

---

## 八、日常运维命令

```bash
# 查看进程
pm2 status
pm2 describe hzy-workflow

# 查看日志
pm2 logs hzy-workflow --lines 200
tail -f /var/log/pm2/hzy-workflow-out.log
tail -f /var/log/pm2/hzy-workflow-error.log

# 重启
pm2 restart hzy-workflow

# 重载 .env（修改 .env 后）
pm2 restart hzy-workflow --update-env

# 下线
pm2 stop hzy-workflow
pm2 delete hzy-workflow
```

---

## 九、健康检查

部署完成后逐项确认：

- [ ] `curl http://workflow.wiztek.cn` 返回 200
- [ ] 浏览器访问能触发 CAS 登录并跳回 workflow
- [ ] Codocs 发起审批不再报 502（`/api/workflow-proxy/tasks/pending`）
- [ ] Aims/Altoc 等业务模块的审批流程端到端可用
- [ ] `hzy_workflow.flow_action_defs` 表随业务模块启动被写入
- [ ] HTTPS 证书自动续期脚本已生效（`certbot renew --dry-run` 通过）
- [ ] PM2 已 `pm2 save` 持久化，服务器重启后进程自动拉起
