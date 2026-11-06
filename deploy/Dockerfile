FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS wasmtime
ARG WASMTIME=v50.0.0
ARG WASMTIME_SHA256=77c19ee0437991f9ac7837b9c269d9c7076744f85dad263fea5214cc2723c7ff
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
 && curl -fsSLo /tmp/wasmtime.tar.xz https://github.com/bytecodealliance/wasmtime/releases/download/$WASMTIME/wasmtime-$WASMTIME-x86_64-linux.tar.xz \
 && echo "$WASMTIME_SHA256  /tmp/wasmtime.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/wasmtime.tar.xz --strip-components=1 -C /usr/local/bin --wildcards '*/wasmtime'

FROM node:24.22.1-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS deps
COPY --from=wasmtime /usr/local/bin/wasmtime /usr/local/bin/wasmtime
RUN npm install -g pnpm@12.11.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN chmod -R a+rX /app && pnpm install --frozen-lockfile --filter '!@endline/docs' --filter '!@endline/web'

FROM deps AS app
COPY deploy/*.json deploy/
RUN mkdir /data && chown node:node /data
# else pnpm reinstalls into root-owned node_modules before every start
ENV pnpm_config_verify_deps_before_run=false
USER node

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
