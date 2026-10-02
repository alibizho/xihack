FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY server ./server
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "server/index.ts"]
