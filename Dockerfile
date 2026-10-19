FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
RUN bun install --production || true
COPY . .
ENV PORT=3000 DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["bun", "run", "server.ts"]