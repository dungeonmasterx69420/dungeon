# GRIDIO
# NOTE: this image uses selective COPY. If you add a new JS module or folder,
# add a COPY line for it below or it will not ship in the image.
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js db.js espn.js ./
COPY snapshot ./snapshot
COPY public ./public

ENV PORT=8791
ENV DATA_DIR=/app/data
EXPOSE 8791
VOLUME /app/data

CMD ["node", "server.js"]
