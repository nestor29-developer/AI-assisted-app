FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Amazon RDS certificates are not in Node's trust store; CI checks weekly that this copy is current.
COPY docker/rds-global-bundle.pem /usr/local/share/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# `next build` needs no runtime secrets: config is read lazily at request time.
FROM deps AS builder
COPY . .
RUN npm run build

# The one-off tasks are bundled to plain JavaScript: tsx needs a writable temp directory, node does not.
FROM deps AS tasks
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build:tasks

# Migrations and the retention purge, locally via compose and in AWS as ECS tasks. No node_modules, no TypeScript.
FROM base AS migrator
COPY --from=tasks /app/dist/tasks ./dist/tasks
COPY drizzle ./drizzle
USER node
CMD ["node", "--enable-source-maps", "dist/tasks/migrate.cjs"]

FROM base AS runner
ARG APP_VERSION=dev
# KEEP_ALIVE_TIMEOUT must exceed the load balancer idle timeout (120s) or streams get random 502s.
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    KEEP_ALIVE_TIMEOUT=125000
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
