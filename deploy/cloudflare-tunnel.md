# Cloudflare Tunnel

默认 Docker Compose 文件是仓库根目录的 `docker-compose.yml`。Web 服务容器在宿主机监听 `127.0.0.1:8787`，在 compose 网络内部监听 `mwe-codex-marketplace:80`。

## 1. 创建 Tunnel

在 Cloudflare Zero Trust 控制台创建一个 persistent Tunnel，并在 Public Hostname 中配置：

```text
Service: http://mwe-codex-marketplace:80
```

这里使用的是 compose 服务名，不是宿主机的 `127.0.0.1:8787`。

## 2. 配置 token

把 Cloudflare tunnel token 放到本地未提交的 `.env` 文件：

```dotenv
CLOUDFLARE_TUNNEL_TOKEN=...
```

也可以只在当前 shell 临时导出：

```bash
export CLOUDFLARE_TUNNEL_TOKEN='...'
```

## 3. 启动服务

默认不启动 tunnel；需要显式启用 `tunnel` profile：

```bash
docker compose --profile tunnel up -d
```

如果只想先拉取预构建镜像：

```bash
docker compose pull
docker compose --profile tunnel up -d
```

## 4. 检查状态

```bash
docker compose ps
docker logs marvel-local-server-mwe-codex-marketplace-tunnel
```

日志中应能看到 cloudflared 注册连接并开始转发。

## 5. 常见问题

- 不加 `--profile tunnel` 时，只会启动 PostgreSQL 和 Web 服务，不会启动 `cloudflare-tunnel`。
- Public Hostname 的 Service 要填 `http://mwe-codex-marketplace:80`，不要填宿主机 localhost。
- 不要提交 `.env`、Cloudflare token、管理员密码、生产数据库密码或 GitHub/GHCR token。
