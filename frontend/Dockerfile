FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx/default.conf.template /opt/render/default.conf.template
COPY nginx/40-render-envsubst.sh /docker-entrypoint.d/40-render-envsubst.sh
RUN chmod +x /docker-entrypoint.d/40-render-envsubst.sh

EXPOSE 10000
