# [CI/CD: Docker] Multi-stage build, specific version tag, non-root user (from the W3Schools article)

# ---- Stage 1: install production dependencies only ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Stage 2: small runtime image ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY scripts ./scripts

# The database and logs live in folders the non-root "node" user may write to
RUN mkdir -p /app/data /app/logs && chown -R node:node /app
USER node

EXPOSE 3000
# Start in cluster mode: one worker per CPU core
CMD ["node", "src/cluster.js"]
