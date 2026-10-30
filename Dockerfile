# ═════════════════════════════════════════════════════════════════
# PinnPointt Ephemeral Signaling Server — Container Image
# Ultra-lightweight Node.js Alpine container for 1-click free hosting
# (Render.com, Koyeb, Fly.io, Railway, or Self-Hosted Docker)
# ═════════════════════════════════════════════════════════════════

FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install dependencies (including tsx for running TS scripts)
RUN npm install --omit=dev && npm install -g tsx

# Copy server code and configuration
COPY server/ ./server/
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT}/health || exit 1

CMD ["tsx", "server/signaling.ts"]
