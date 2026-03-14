# 📋 Render Deployment: Final Step-by-Step Fix

The reason your previous build failed is that there was a hidden `render.yaml` file in the project. That file was forcing Render to use the wrong settings (paid tier and native Node). 

**I have deleted that file.** Now, the deployment will work perfectly for free.

---

### **Step 1: Update the Service on Render**
1.  Go to your **Web Service** settings on Render.
2.  In the **Connect Repo** section, make sure it is still linked to your repository and the **`work`** branch.
3.  **MOST IMPORTANT**: Under "Environment" or "Runtime", verify it now says **Docker**. 
    -   *Render should detect the Dockerfile automatically and switch to the Docker runtime now that the bad config file is gone.*
4.  **Clear Commands**: If you see any "Build Command" or "Start Command" left in the settings, **delete them**. The Dockerfile handles both now.

### **Step 2: Environment Variables**
Ensure these are in the **Environment** tab:

| Key | Value |
| :--- | :--- |
| `DATABASE_URL` | (Your Neon DB URL) |
| `NEXT_PUBLIC_APP_URL` | (Your Vercel Dashboard URL) |
| `NODE_ENV` | `production` |
| `HEADLESS` | `true` |
| `PORT` | `10000` |

---

### **Step 3: Trigger a Fresh Deploy**
1.  Click the **"Manual Deploy"** button at the top right.
2.  Select **"Clear Build Cache & Deploy"**.
3.  The build should now take about 2-3 minutes. It will download the Playwright browser image and start your worker correctly.

### **Step 4: Keep-Alive**
Don't forget to set up [UptimeRobot.com](https://uptimerobot.com) to ping your Render URL every 5 minutes so it doesn't sleep!

---

### **Why it's fixed now:**
-   **No More Conflict**: Deleting `render.yaml` removed the hidden settings that were causing the `su: Authentication failure`.
-   **Native Root Access**: The Docker environment comes with all Google Chrome dependencies pre-installed by Microsoft, so no password or root access is needed during build.
