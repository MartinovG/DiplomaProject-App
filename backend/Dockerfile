FROM node:18-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate

RUN npm run build

EXPOSE 4000
CMD ["sh", "-c", "npx prisma db push && npm start"]