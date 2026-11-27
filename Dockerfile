# Voice Bill - Tamil/Tanglish voice billing prototype.
# Zero npm dependencies: the image needs no install step and no secret keys.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY server/ server/
COPY index.html style.css app.js parser.js seed.js billing-core.js summary-core.js ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
# BIND_ALL=1: the container port mapping controls exposure, so no app token is needed (see server.js).
ENV PORT=8787 BIND_ALL=1 DATA_DIR=/app/data
EXPOSE 8787
CMD ["node", "server/server.js"]
