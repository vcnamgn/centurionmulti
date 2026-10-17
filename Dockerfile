FROM cloudron/node-base:24-20260920@sha256:d984683ec59bf2379130bf41cf3c2b6bc0453f327297d7183525cb05424e7b34
WORKDIR /app/code/partage/relay
COPY partage/relay/package.json partage/relay/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app/code
COPY partage/relay/server.js partage/relay/server.js
COPY partage/relay/public partage/relay/public
COPY simulateur simulateur
COPY docs docs
COPY support/README.html support/README.html
COPY README.html README.html
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["/usr/local/bin/gosu", "cloudron:cloudron", "node", "partage/relay/server.js"]
