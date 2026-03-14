# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Set working directory as root
WORKDIR /app

# Grant ownership of /app to UID 1000 (standard for Hugging Face)
RUN chown -R 1000:1000 /app

# Hugging Face uses UID 1000. Use it for the following steps.
USER 1000

# Set home environment
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Copy package files (ensure they are owned by 1000)
COPY --chown=1000:1000 package*.json ./
COPY --chown=1000:1000 prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy the rest of the application
COPY --chown=1000:1000 . .

# Hugging Face Spaces port
EXPOSE 7860

# Start command
CMD npx tsx -e "require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(7860); require('./worker.ts')"
