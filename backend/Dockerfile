# syntax=docker/dockerfile:1.7

FROM node:slim AS build
WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts

FROM node:slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system nodejs \
    && adduser --system --ingroup nodejs nestjs \
    && mkdir -p /app/data \
    && chown -R nestjs:nodejs /app

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main"]
