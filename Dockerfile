FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./
COPY public/ ./public/
COPY stremgate.js ./
COPY stremio.js ./
COPY navidrome.js ./

RUN mkdir -p /data
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
