# Build/run the standalone API server, independent of the frontend build.
# Build from the repo root: docker build -f server/Dockerfile -t crossword-server .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.server.json ./
COPY server ./server
COPY src/types.ts ./src/types.ts
RUN npm run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist-server ./dist-server
EXPOSE 8787
CMD ["node", "dist-server/server/index.js"]
