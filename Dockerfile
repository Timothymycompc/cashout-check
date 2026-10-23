FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run bundle
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
