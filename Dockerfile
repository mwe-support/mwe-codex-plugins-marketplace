FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80

RUN apk add --no-cache git

COPY package*.json tsconfig.json ./
RUN npm ci --include=dev

COPY src ./src
COPY index.html 404.html styles.css server.mjs db.mjs ./
COPY assets ./assets
COPY migrations ./migrations
RUN mkdir -p scripts
COPY scripts/db-migrate.mjs ./scripts/db-migrate.mjs

RUN npm run build && npm prune --omit=dev && chmod -R a+rX /app

EXPOSE 80
CMD ["sh", "-c", "node scripts/db-migrate.mjs && node server.mjs"]
