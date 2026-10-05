# Python Ingestion Service

该目录提供基于 FastAPI 的轻量服务，用于远程触发仓库扫描与提交同步任务。

## 安装依赖

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r server/python_service/requirements.txt
```

## 启动服务

```bash
uvicorn server.python_service.app:app --host 0.0.0.0 --port 8080
```

服务会读取与原始脚本相同的环境变量（如 `GITLAB_URL`、`GITLAB_TOKEN`、`DB_HOST` 等），也支持通过请求体覆盖。  
新增的 `SVN_MAX_DIFF_BYTES`（默认 `524288`）用于限制单个文件保留的 diff 文本长度，防止 SVN 同步时占用过多内存。

## 可用端点

- `POST /gitlab/scan`：触发 GitLab 仓库扫描，返回处理汇总。
- `POST /gitlab/sync`：同步 GitLab 提交记录，响应包含 `has_failures` 标记，支持 `repo_catalog_ids` 仅同步指定仓库。
- `POST /gitlab/repair`：回填 GitLab 提交与文件变更缺失的统计数据，可指定仓库或提交 ID。
- `POST /svn/scan`：扫描本地 SVN 仓库元数据。
- `POST /svn/sync`：同步 SVN 提交记录，可选 `repo_catalog_ids` 仅同步指定仓库。
- `GET /healthz`：健康检查。

> 注意：长时间运行的任务目前同步执行，建议配合前端轮询 `ingestion_runs` 表查看进度。若需异步化，可在 FastAPI 层接入消息队列或后台任务管理器。

GitLab / SVN 同步端点均支持可选的 `year` 字段（整数）和 `repo_catalog_ids`（整型数组）。未显式提供年份时默认使用后端当前年份，实现“按年度”过滤提交。

## 生产部署记录

- 目录位置：服务器 `/root/ci_server/server/python_service` 与 `/root/ci_server/server/scripts`。
- 虚拟环境：`python3 -m venv /root/ci_server/.venv` 并通过 `pip install -r server/python_service/requirements.txt` 安装依赖。
- 环境变量集中在 `/root/ci_server/.env`，启动前 `set -a && source .env && set +a` 载入。
- 运行命令：  
  ```bash
  cd /root/ci_server
  source .venv/bin/activate
  uvicorn server.python_service.app:app --host 0.0.0.0 --port 8090
  ```
- 健康检查：`http://svn.wiztek.cn:8090/healthz` 返回 `{"status":"ok"}`。
- 功能验证：POST `http://svn.wiztek.cn:8090/svn/scan`（需使用 POST）成功触发 SVN 仓库扫描。
