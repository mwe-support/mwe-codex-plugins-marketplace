# Cloudflare Tunnel

The local web container listens on `127.0.0.1:8787` on the host and on port `80` inside the compose network.

Create a persistent Cloudflare Tunnel in the Cloudflare dashboard and route the public hostname to the compose service:

```text
http://mwe-codex-marketplace:80
```

Start the optional tunnel service with a token without committing the token:

```bash
export CLOUDFLARE_TUNNEL_TOKEN='...'
docker compose --profile tunnel up -d --build
```

To run a prebuilt GHCR image instead of building locally:

```bash
docker pull ghcr.io/mwe-support/mwe-codex-plugins-marketplace:latest
MARKETPLACE_IMAGE=ghcr.io/mwe-support/mwe-codex-plugins-marketplace:latest \
  docker compose --profile tunnel up -d --no-build
```

The Cloudflare token, admin password, production database password, and GitHub/GHCR tokens are intentionally not stored in this repository.
