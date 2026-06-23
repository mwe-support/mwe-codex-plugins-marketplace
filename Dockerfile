FROM nginx:1.27-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
WORKDIR /usr/share/nginx/html

COPY index.html 404.html app.js styles.css marketplace.json ./
COPY assets ./assets
COPY registry ./registry
COPY marketplace ./marketplace
COPY .agents ./.agents
COPY about ./about
COPY install ./install
COPY submit ./submit
COPY perspective ./perspective

RUN chmod -R a+rX /usr/share/nginx/html
