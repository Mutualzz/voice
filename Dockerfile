FROM node:lts AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# Prune the monorepo to only voice + its workspace deps
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @mutualzz/voice --docker

# Install only pruned deps
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm build --filter=@mutualzz/voice

# Final image
FROM node:lts-slim AS runner
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/apps/voice
COPY --from=builder /app/apps/voice/dist ./dist
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/apps/voice/package.json .
CMD ["node", "-r", "dotenv/config", "./dist/index.mjs"]
