FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  libsodium-dev \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN pnpm build

# ---- runtime ----
FROM node:20-slim AS runtime

RUN apt-get update && apt-get install -y libsodium-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./

EXPOSE 3000 3001

CMD ["node", "dist/index.js"]
