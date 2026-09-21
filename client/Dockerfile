FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV VITE_API_URL=/api
ENV VITE_LOG_LEVEL=debug
ENV VITE_SEND_LOGS_TO_BACKEND=true
ENV VITE_APP_VERSION=2.2.0

RUN npm run build

FROM nginx:alpine

ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]