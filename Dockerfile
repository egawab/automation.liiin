# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Switch to root to fix directory structure
USER root

# Hugging Face expect UID 1000.
RUN id -u user > /dev/null 2>&1 || useradd -m -u 1000 user
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Switch to UID 1000 (Standard for Hugging Face)
USER 1000

# Set up the environment
WORKDIR /home/user/app
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm

# Copy package files separately for better caching
COPY --chown=1000:1000 package*.json ./
COPY --chown=1000:1000 prisma ./prisma/

# Install dependencies (will now have correct permissions in /home/user)
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy the rest of the application
COPY --chown=1000:1000 . .

# Hugging Face Spaces default port
EXPOSE 7860

# Start command:
# 1. Start a simple health-check server on port 7860 (using process.env.PORT)
# 2. Start the actual worker
CMD npx tsx -e "const port = process.env.PORT || 7860; require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(port); console.log('Health check server live on port', port); require('./worker.ts')"
