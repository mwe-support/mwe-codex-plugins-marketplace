# Cloudflare Tunnel

The local web container listens on `127.0.0.1:8787`.

Create a persistent Cloudflare Tunnel in the Cloudflare dashboard and route the public hostname to:

```text
http://mwe-codex-marketplace:80
```

Then start the optional tunnel service with a token without committing the token:

```bash
export CLOUDFLARE_TUNNEL_TOKEN='...'
docker compose --profile tunnel up -d --build
```

The token is intentionally not stored in this repository.
