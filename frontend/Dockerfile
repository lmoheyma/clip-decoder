FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# ─── dev ───────────────────────────────────────────────────────
# Used by docker-compose.dev.yml. Source is bind-mounted at run
# time, so we only bake node_modules and run `next dev` with HMR.
FROM node:22-alpine AS dev
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
ENV NODE_ENV=development NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "dev"]

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["pnpm", "start"]
