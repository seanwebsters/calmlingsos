# Production image (Railway, Fly, any Docker host). Mount a volume at /data.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
