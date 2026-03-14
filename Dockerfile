# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Set working directory
WORKDIR /app

# Set working directory
WORKDIR /app

# Hugging Face uses UID 1000. In this image, UID 1000 already exists (usually named 'ubuntu' or 'pwuser').
# We will find the existing user with UID 1000 and use it.
RUN USR=$(getent passwd 1000 | cut -d: -f1) && \
    echo "Using existing user: $USR" && \
    mkdir -p /home/$USR && chown 1000:1000 /home/$USR

# Use the user with UID 1000
USER 1000
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Copy package files
COPY --chown=user package*.json ./
COPY --chown=user prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy the rest of the application
COPY --chown=user . .

# Hugging Face Spaces port
EXPOSE 7860

# Start command: 
# 1. Start a mini health-check server on port 7860 (Hugging Face default)
# 2. Start the actual LinkedIn worker
CMD npx tsx -e "require('http').createServer((q,res)=>{res.writeHead(200);res.end('ok')}).listen(7860); require('./worker.ts')"
