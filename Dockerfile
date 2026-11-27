FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && install -d -o node -g node /data
COPY --chown=node:node . .
USER node
ENV HOST=0.0.0.0 PORT=3000 NAKA_PENDING_FILE=/data/naka-pending.json
EXPOSE 3000
CMD ["node","server.mjs"]
