FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# Install server dependencies
RUN cd server && npm install --production

# Install client dependencies and build
RUN cd client && npm install && npm run build

# Copy source
COPY server/ ./server/
COPY client/src/ ./client/src/
COPY client/public/ ./client/public/

# Copy build (already built above, but we need source for build)
# Re-copy everything and rebuild
COPY . .
RUN cd client && npm run build

# Remove client node_modules and src to save space
RUN rm -rf client/node_modules client/src

ENV NODE_ENV=production
ENV BROWSER_PASSWORD=admin123

EXPOSE 7799

CMD ["node", "server/index.js"]
