FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80

COPY index.html 404.html app.js styles.css marketplace.json server.mjs ./
COPY assets ./assets
COPY registry ./registry
COPY marketplace ./marketplace
COPY .agents ./.agents
COPY about ./about
COPY install ./install
COPY submit ./submit
COPY perspective ./perspective

RUN chmod -R a+rX /app

EXPOSE 80
CMD ["node", "server.mjs"]
