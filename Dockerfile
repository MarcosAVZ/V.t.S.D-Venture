# Build stage — install deps + build client
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace root
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# Install all workspace dependencies
RUN npm ci

# Copy source
COPY client/ ./client/
COPY server/ ./server/

# Build client
RUN npm run build -w client

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy server package.json and install production deps
COPY server/package.json ./
RUN npm install --omit=dev

# Copy server source
COPY server/src/ ./src/

# Copy built client into public directory
COPY --from=builder /app/client/dist/ ./public/

# Fly.io sets PORT automatically
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/index.js"]
