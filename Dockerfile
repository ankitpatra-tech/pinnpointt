# ═════════════════════════════════════════════════════════════════
# PinnPointt Full-Stack Container (Signaling Server + Static Frontend)
# Multi-stage Docker build for 1-click zero-config deployment on Render
# ═════════════════════════════════════════════════════════════════

# Stage 1: Build the Vite production bundle
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json vite.config.ts index.html about.html ./
COPY public/ ./public/
COPY src/ ./src/

RUN npm install && npm run build

# Stage 2: Ephemeral Relay Server + Production Dist
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm install -g tsx

COPY --from=builder /app/dist ./dist
COPY server/ ./server/
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

CMD ["tsx", "server/signaling.ts"]
