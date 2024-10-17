FROM node:latest

WORKDIR /opt/hocket

COPY package*.json ./

RUN npm install -g pm2

RUN npm install

COPY . .

EXPOSE 3332

CMD ["pm2-runtime", "app.js"]

