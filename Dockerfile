# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Switch to root for setup
USER root

# Setup user and app directory
RUN id -u user > /dev/null 2>&1 || useradd -m -u 1000 user
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Use UID 1000 (standard for Hugging Face)
USER 1000
WORKDIR /home/user/app

# Set environment variables
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm

# Copy everything at once to be as robust as possible
# This solves the "prisma not found" errors on some environments.
COPY --chown=1000:1000 . .

# Install dependencies and generate clients
RUN npm install
RUN npx prisma generate

# Hugging Face Spaces port
EXPOSE 7860

# Start command
CMD npx tsx -e "const port = process.env.PORT || 7860; require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(port); console.log('Worker listening on port', port); require('./worker.ts')"
