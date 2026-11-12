FROM node:22-alpine AS frontend

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
ENV PORT=30073
ENV REQUIRE_HTTPS=true
ENV TRUST_PROXY=true

EXPOSE 30073
VOLUME ["/app/backend/data"]

CMD ["node", "server.js"]
