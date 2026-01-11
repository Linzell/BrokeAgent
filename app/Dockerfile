FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies from root (monorepo)
FROM base AS deps
COPY package.json bun.lock* ./
COPY app/package.json ./app/
COPY frontend/package.json ./frontend/
COPY shared/package.json ./shared/
RUN bun install --frozen-lockfile

# Build stage
FROM base AS builder
COPY --from=deps /app ./
COPY shared ./shared
COPY app ./app
RUN cd app && bun build ./src/main.ts --outdir ./dist --target bun

# Production stage
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app/app/dist ./dist
COPY --from=builder /app/app/package.json ./
COPY --from=deps /app/node_modules ./node_modules

EXPOSE 3000

CMD ["bun", "run", "dist/main.js"]
