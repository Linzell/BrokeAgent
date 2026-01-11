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
COPY frontend ./frontend
RUN cd frontend && bun run build

# Production stage with nginx
FROM nginx:alpine AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
