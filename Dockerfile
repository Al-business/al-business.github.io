FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY backend/server.js ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
