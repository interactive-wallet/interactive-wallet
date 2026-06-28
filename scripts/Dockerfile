# Build stage
FROM node:26.4.0-trixie-slim AS base

RUN npm install -g pnpm@11.3.0 --no-update-notifier

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

WORKDIR /app
COPY package*.json pnpm*yaml tsconfig.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY ./src ./src
RUN pnpm run build

# Runtime stage
FROM node:26.4.0-trixie-slim
WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./

CMD ["node", "dist/index.js"]
