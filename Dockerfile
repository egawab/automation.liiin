# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Switch to root to fix directory structure
USER root

# Hugging Face expect UID 1000.
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Switch to UID 1000 (Standard for Hugging Face)
USER 1000

# Set up the environment
WORKDIR /home/user/app
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm

# Copy everything first (this includes package.json and prisma folder)
# This is more robust for Hugging Face builds to avoid "not found" errors.
COPY --chown=1000:1000 . .

# Install dependencies (Prisma client will be generated if schema is present)
RUN npm install

# Explicitly generate Prisma client just in case
RUN npx prisma generate

# Hugging Face Spaces default port
EXPOSE 7860

# Start command:
# 1. Start a simple health-check server on port 7860
# 2. Start the actual worker
CMD npx tsx -e "require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(7860); require('./worker.ts')"
