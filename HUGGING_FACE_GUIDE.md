# 🚀 The 100% NO-CARD Solution: Hugging Face Spaces

I am very sorry for the trouble with cards. I have found the absolute best way to run your worker for **free** with **ZERO credit card required**.

We will use **Hugging Face Spaces**. It is a platform for AI developers, and it allows you to run Docker projects entirely for free without even asking for a card.

---

### **Step 1: Create a Hugging Face Account**
1.  Go to [huggingface.co](https://huggingface.co/join) and sign up.
2.  It will **not** ask for a credit card.

### **Step 2: Create a New Space**
1.  Click on your profile picture (top right) and select **"New Space"**.
2.  **Name**: `linkedin-worker`
3.  **License**: `apache-2.0` (or any).
4.  **Select the Space SDK**: Choose **Docker**.
5.  **Choose a template**: Choose **Blank**.
6.  **Space Hardware**: Choose **"CPU basic • 2 vCPU • 16 GB • Free"**.
7.  Click **"Create Space"**.

### **Step 3: Fix the "Config Error" (Crucial)**
If you see a "Config Error", it is because your `README.md` is missing the required instructions for Hugging Face.
1. Go to the **"Files"** tab and click on **`README.md`**.
2. Click the **"Edit"** (pencil icon).
3. Paste this **EXACT** block at the very top of the file (above everything else):

```yaml
---
title: Liiiinnll
emoji: 🤖
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
---
```
4. Scroll down and click **"Commit changes to main"**.

### **Step 4: Upload Your Files**
Once the metadata is fixed, ensure these files are present:
1.  `Dockerfile` (I have updated this for you below)
2.  `worker.ts`
3.  `package.json`
4.  `package-lock.json`
5.  `tsconfig.json`
6.  The `prisma/` folder and `lib/` folder.

*(Tip: You can also use the "Add file" -> "Upload files" button to drag and drop everything).*

### **Step 4: Settings (Environment Variables)**
1.  Go to the **"Settings"** tab of your Space.
2.  Scroll down to **"Variables and secrets"**.
3.  Add these as **Secrets** (so they are hidden):
    -   `DATABASE_URL`: (Your Neon URL)
    -   `NEXT_PUBLIC_APP_URL`: (Your Vercel URL)
    -   `NODE_ENV`: `production`
    -   `HEADLESS`: `true`

---

### **Why this is the best solution:**
-   **No Card EVER**: Hugging Face does not require a card for Free CPU spaces.
-   **Huge RAM**: You get **16GB of RAM** for free, which is 30x more than Render!
-   **Stability**: It uses the same Docker technology we already set up.

---

### **Updated Dockerfile (Copy this exactly)**
```dockerfile
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
```
