FROM node:lts AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN corepack prepare pnpm@latest --activate

FROM base AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ENV NODE_ENV=production
RUN pnpm build:voice

FROM base AS deploy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app

WORKDIR /app/apps/voice
EXPOSE 3030 3478/tcp 3478/udp 5349/tcp 40000-49999/udp 40000-49999/tcp
CMD ["pnpm", "start"]
