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

# Install dependencies and build
RUN npm install
RUN npx prisma generate
RUN npm run build

# Start Next.js (which should handle the worker launch or keep-alive)
CMD ["npm", "start"]
