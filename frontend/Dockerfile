FROM node:18-alpine

WORKDIR /app

# Install dependencies first for caching
COPY package.json .
RUN npm install --legacy-peer-deps

# Copy frontend source
COPY . .

EXPOSE 3000

# Start dev server
CMD ["npm", "run", "dev"]
