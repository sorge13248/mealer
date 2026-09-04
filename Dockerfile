# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build -- --configuration production

FROM node:slim AS backend-build
WORKDIR /app/backend

COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

COPY backend/nest-cli.json backend/tsconfig*.json ./
COPY backend/src ./src
RUN npm run build \
    && npm prune --omit=dev --ignore-scripts

FROM node:slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx supervisor poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/backend /app/data /run/nginx /var/log/nginx /usr/share/nginx/html

COPY --from=backend-build /app/backend/dist /app/backend/dist
COPY --from=backend-build /app/backend/node_modules /app/backend/node_modules
COPY backend/package*.json /app/backend/

COPY --from=frontend-build /app/frontend/dist/mealer/browser /usr/share/nginx/html

COPY deploy/nginx.unified.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisord.conf

EXPOSE 8080
STOPSIGNAL SIGTERM

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]