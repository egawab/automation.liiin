# Use official Playwright image for cloud-stable scraping
FROM mcr.microsoft.com/playwright:v1.54.0-noble

# Root for setup
USER root
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Switch to UID 1000
USER 1000
WORKDIR /home/user/app
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm \
    PORT=7860

# Copy everything
COPY --chown=1000:1000 . .

# Stage 1: Build & Generate
RUN npm install
RUN npx prisma generate

# Stage 2: Runtime
# We do NOT run "npm run build" here because DATABASE_URL is a runtime secret!
# Instead, we run the database push and the worker directly at start.

EXPOSE 7860

# Start command: Sync DB + Start Health Check + Start Worker
CMD npx prisma db push --accept-data-loss && \
    npx tsx -e "const port = process.env.PORT || 7860; require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(port); console.log('Worker listening on port', port); require('./worker.ts')"
