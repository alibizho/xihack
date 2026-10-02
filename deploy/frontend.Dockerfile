FROM node:24-alpine
WORKDIR /app
COPY server ./server
COPY src ./src
COPY dist ./dist
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "server/index.ts"]
