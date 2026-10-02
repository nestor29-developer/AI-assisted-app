# syntax=docker/dockerfile:1
FROM node:22-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Amazon RDS certificates are not in Node's trust store. The checksum makes a changed bundle fail the build.
ADD --checksum=sha256:fe45bbebf92ad3e27a583bbb2ddd1553c521ed4d49af5514dc0a40372ea5395c --chmod=0644 \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /usr/local/share/rds-global-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/rds-global-bundle.pem

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# `next build` needs no runtime secrets: config is read lazily at request time.
FROM deps AS builder
COPY . .
RUN npm run build

# One-off task that applies SQL migrations (locally via compose, in AWS as a task before deploy).
FROM deps AS migrator
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY drizzle ./drizzle
USER node
CMD ["npx", "tsx", "--conditions=react-server", "scripts/migrate.ts"]

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
