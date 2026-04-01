FROM node:18-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY . .

# Expose nothing (Telegram bots use long polling by default in this setup)
# If using webhooks, you would EXPOSE a port, but long polling is safer for Koyeb/Northflank free tiers.

# Start the application
CMD ["node", "src/index.js"]
# Expose port for the Health Check
EXPOSE 8080

# Start the application
CMD ["node", "src/index.js"]
