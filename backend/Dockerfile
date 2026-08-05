# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package*.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app

RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
    && npm rebuild better-sqlite3 --build-from-source --no-audit --no-fund \
    && npm cache clean --force \
    && apk del .build-deps

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache poppler-utils \
    && addgroup -S nodejs \
    && adduser -S nestjs -G nodejs \
    && mkdir -p /app/data \
    && chown -R nestjs:nodejs /app

COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER nestjs

EXPOSE 3000

CMD ["node", "dist/main"]
