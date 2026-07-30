# Multi-stage Dockerfile para Next.js app (sin Puppeteer).
#
# Sprint 1.5: usa el output `standalone` (ver app/next.config.ts) para
# generar `.next/standalone` con sus propias dependencias y minimizar el
# tamaño de la imagen final.

# ─────────────────────────────────────────────────────────────────
# Stage 1: deps (pnpm install)
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────
# Stage 2: builder
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build with the same env vars CI uses so the standalone bundle
# doesn't fail on missing schema/db references at build time.
ENV NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV BETTER_AUTH_URL=http://localhost:3000
RUN pnpm build

# ─────────────────────────────────────────────────────────────────
# Stage 3: production runner
# ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone output (includes a pruned node_modules), static
# assets, and the public folder.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "server.js"]