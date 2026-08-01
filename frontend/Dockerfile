# syntax=docker/dockerfile:1.7

FROM node:alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -- --configuration production

FROM nginx:alpine AS runtime

RUN addgroup -S app \
    && adduser -S -G app -h /home/app app \
    && mkdir -p /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html \
    && chown -R app:app /var/cache/nginx /var/run /var/log/nginx /usr/share/nginx/html

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist/mealer/browser /usr/share/nginx/html
RUN chown -R app:app /usr/share/nginx/html /etc/nginx

USER app

EXPOSE 8080
STOPSIGNAL SIGQUIT

CMD ["nginx", "-g", "daemon off;"]
