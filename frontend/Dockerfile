FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /opt/render/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/40-render-envsubst.sh /docker-entrypoint.d/40-render-envsubst.sh
# Quita CRLF (copias de trabajo en Windows) para que el script y la config funcionen igual en cualquier build.
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-render-envsubst.sh /opt/render/default.conf.template /etc/nginx/snippets/security-headers.conf \
    && chmod +x /docker-entrypoint.d/40-render-envsubst.sh

EXPOSE 10000
