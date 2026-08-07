# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build -- --configuration production

FROM node:22-alpine AS backend-build
WORKDIR /app/backend

RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY backend/package*.json ./
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY backend/nest-cli.json backend/tsconfig*.json ./
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine AS backend-prod-deps
WORKDIR /app/backend

RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY backend/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts \
    && npm rebuild better-sqlite3 --build-from-source --no-audit --no-fund \
    && npm cache clean --force \
    && apk del .build-deps

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache nginx supervisor poppler-utils \
    && mkdir -p /app/backend /app/data /run/nginx /var/log/nginx /usr/share/nginx/html

COPY --from=backend-build /app/backend/dist /app/backend/dist
COPY --from=backend-prod-deps /app/backend/node_modules /app/backend/node_modules
COPY backend/package*.json /app/backend/

COPY --from=frontend-build /app/frontend/dist/mealer/browser /usr/share/nginx/html

COPY deploy/nginx.unified.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf

EXPOSE 8080
STOPSIGNAL SIGTERM

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]