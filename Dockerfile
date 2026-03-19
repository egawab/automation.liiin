# Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Root for setup
USER root
RUN mkdir -p /home/user/app && chown -R 1000:1000 /home/user

# Switch to UID 1000
USER 1000
WORKDIR /home/user/app
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    npm_config_cache=/home/user/.npm

# Copy everything
COPY --chown=1000:1000 . .

# Install dependencies and build the worker
RUN npm install
RUN npm run build:worker
RUN npx prisma generate

# Start the supervisor server directly (PID 1) for signal resilience
CMD ["node", "dist/server.js"]
