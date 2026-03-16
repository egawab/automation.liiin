# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Root for setup
USER root

# In this base image, UID 1000 already exists (usually user 'ubuntu').
# We just need to ensure the app directory is ready and owned by that UID.
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Switch to UID 1000 (Standard for Hugging Face)
USER 1000
WORKDIR /home/user/app

# Set environment variables
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm

# Copy everything (Safest approach for Prisma)
COPY --chown=1000:1000 . .

# Install and build
# Prisma client will be generated during install if 'postinstall' exists, 
# but we call it explicitly for safety.
RUN npm install
RUN npx prisma generate

# Port for Hugging Face
EXPOSE 7860

# Start command with simple health check on port 7860
CMD npx tsx -e "const port = process.env.PORT || 7860; require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(port); console.log('Worker listening on port', port); require('./worker.ts')"
