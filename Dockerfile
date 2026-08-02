# Single-image build: compiles the web app + server, then serves both.
FROM node:22-slim AS build
WORKDIR /app

# Install dependencies for all workspaces (better-sqlite3 needs build tools).
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install

# Build the frontend and server.
COPY . .
RUN npm run build

# ---- Runtime image ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Only what's needed to run: built output + production dependencies.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/web/package.json web/
RUN apt-get update && apt-get install -y python3 make g++ && \
    npm install --omit=dev && \
    apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# Persist the SQLite database outside the image.
ENV DATABASE_PATH=/data/family.sqlite
VOLUME /data
EXPOSE 4000

CMD ["node", "server/dist/index.js"]
