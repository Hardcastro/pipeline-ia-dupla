FROM node:22-alpine

WORKDIR /app

# Camada de dependencias separada: so reinstala quando o package.json muda.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "src/index.js"]
