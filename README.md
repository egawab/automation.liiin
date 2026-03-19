---
title: Nexora Sovereign Scraper
emoji: 🏗️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 🤖 Nexora Sovereign: LinkedIn Industrial Scraper (Cloud Edition)

An automated LinkedIn engagement tool that helps you comment on relevant posts based on keywords.

## ⚠️ IMPORTANT DISCLAIMER

**This tool automates interactions with LinkedIn, which violates LinkedIn's Terms of Service (Section 8.2).**

### Risks:
- ✅ Account suspension or permanent ban
- ✅ Loss of access to your LinkedIn network
- ✅ Potential legal consequences for commercial use

**Use at your own risk.** This project is for educational purposes only. The authors are not responsible for any consequences resulting from use of this software.

### Strong Recommendations:
- ❌ **DO NOT use your primary professional LinkedIn account**
- ✅ Use a test/burner account
- ✅ Start with very low frequency (1-2 comments per day)
- ✅ Monitor your account closely for warnings
- ✅ Stop immediately if you notice unusual behavior or restrictions

### Legal Alternatives:
- LinkedIn's official API
- Manual networking and engagement
- Authorized marketing tools (LinkedIn Sales Navigator, Campaign Manager, etc.)

---

## 🌟 Features

- **Keyword-Based Search**: Find posts matching your specified keywords
- **Smart Filtering**: Comment only on posts with minimum likes/comments
- **Multiple Comments**: Random selection from your comment pool
- **Activity Logs**: Track all automation activity with post URLs
- **Work Hours**: Set specific times for automation to run
- **Safety Limits**: Daily and weekly comment limits
- **Human-Like Behavior**: 
  - ✅ Random delays between actions
  - ✅ Mouse hover before clicks
  - ✅ Scroll simulation
  - ✅ Variable typing speed
- **Dashboard**: Web UI to manage settings, keywords, and view logs

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A LinkedIn account (burner account recommended)

### Installation

\\\ash
# Clone the repository
git clone <your-repo-url>
cd clonelink

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your settings

# Initialize database
npx prisma generate
npx prisma migrate dev

# Start the dashboard
npm run dev

# In a separate terminal, start the worker
npm run worker
\\\

### Initial Setup

1. Open the dashboard at \http://localhost:3000\
2. Log in / create account
3. Go to Settings:
   - Add your LinkedIn session cookie (li_at)
   - Set min/max delays (recommended: 30-90 minutes)
   - Set daily limit (start with 2-3)
   - Configure work hours if desired
4. Add Keywords:
   - Add relevant keywords for posts you want to comment on
   - Set minimum likes/comments thresholds
5. Add Comments:
   - Create 10+ varied comment templates
   - Make them contextual and professional
6. Activate the system in Settings

---

## 📝 Getting Your LinkedIn Cookie

1. Open LinkedIn in your browser and log in
2. Open Developer Tools (F12)
3. Go to "Application" or "Storage" tab
4. Click "Cookies" → "https://www.linkedin.com"
5. Find the cookie named \li_at\
6. Copy its value
7. Paste into Settings → LinkedIn Session Cookie in the dashboard

**Security Note:** Never share your \li_at\ cookie. It provides full access to your LinkedIn account.

---

## ⚙️ Configuration

### Environment Variables

Create a \.env\ file in the root directory:

\\\env
# Database
DATABASE_URL="file:./dev.db"

# NextAuth (for dashboard authentication)
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:3000"
\\\

### Settings (via Dashboard)

- **Min/Max Delay**: Time between automation runs (recommended: 30-90 min)
- **Daily Comment Limit**: Maximum comments per day (start with 2-3)
- **Weekly Comment Limit**: Maximum per week
- **Work Hours**: Optional time restrictions
- **Minimum Likes/Comments**: Only comment on posts with sufficient engagement

---

## 🛡️ Safety Features

This tool includes several anti-detection measures:

1. **Random Delays**: All timing is randomized (no fixed patterns)
2. **Mouse Hover**: Hovers over elements before clicking
3. **Scroll Simulation**: Scrolls to "read" posts before commenting
4. **Variable Typing Speed**: Types comments at human-like speeds
5. **Non-Headless Browser**: Runs in visible mode (harder to detect)
6. **Frequency Limits**: Built-in daily/weekly limits

### Recommended Usage Pattern

**Week 1:**
- 1-2 comments per day
- Monitor account closely
- Check for any warnings

**Week 2-3:**
- Gradually increase to 3-5 per day
- Continue monitoring

**Month 2+:**
- Max 8-10 comments per day
- Never exceed 15 per day

**If you see warnings or unusual behavior: STOP for 7-14 days**

---

## 📊 Architecture

\\\
┌─────────────────┐
│   Dashboard     │  ← Next.js web UI
│   (Port 3000)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Database     │  ← SQLite (dev) / PostgreSQL (prod)
│    (Prisma)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Worker (tsx)   │  ← Automation engine (Playwright)
│  worker.ts      │
└─────────────────┘
\\\

---

## 🚢 Deployment

### Dashboard (Vercel)

The Next.js dashboard can be deployed to Vercel:

\\\ash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
\\\

**Note:** You'll need to use PostgreSQL for production (SQLite doesn't work on Vercel).

### Worker (Railway/Render/VPS)

The worker automation **cannot** run on Vercel (requires Playwright/browsers).

Deploy to:
- **Railway.app** (easiest)
- **Render.com**
- **DigitalOcean/AWS/GCP** (VPS)

See \DEPLOYMENT.md\ for detailed instructions.

---

## 🧪 Development

\\\ash
# Start dashboard in dev mode
npm run dev

# Start worker
npm run worker

# Run linter
npm run lint

# Generate Prisma client
npx prisma generate

# Create database migration
npx prisma migrate dev

# Open Prisma Studio (database GUI)
npx prisma studio
\\\

---

## 📁 Project Structure

\\\
clonelink/
├── app/                  # Next.js app directory
│   ├── api/             # API routes
│   ├── (auth)/          # Authentication pages
│   └── (dashboard)/     # Dashboard pages
├── prisma/              # Database schema and migrations
│   └── schema.prisma
├── worker.ts            # Automation worker script
├── .env                 # Environment variables (not committed)
├── .env.example         # Example environment variables
└── package.json
\\\

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📄 License

MIT License - see LICENSE file for details

---

## ❓ FAQ

### Q: Is this safe to use?
**A:** No automation tool is completely safe. LinkedIn actively fights automation. Use at your own risk, preferably with a burner account.

### Q: Can I use my main LinkedIn account?
**A:** We **strongly recommend against this**. Use a test account instead.

### Q: How many comments per day is safe?
**A:** Start with 1-2 per day. Even with all safety measures, high volume increases risk.

### Q: Will this work on Vercel?
**A:** The dashboard will work on Vercel, but the worker needs a separate server (Railway, Render, VPS, etc.).

### Q: What if my account gets banned?
**A:** We are not responsible for account bans. This is the risk of using automation that violates LinkedIn's ToS.

### Q: Are there legal alternatives?
**A:** Yes - use LinkedIn's official API, Sales Navigator, or manual engagement.

---

## 📞 Support

For issues and questions:
- Open a GitHub issue
- Check existing issues for solutions
- Review the SAFETY_AND_DEPLOYMENT.md guide

---

## 🙏 Acknowledgments

Built with:
- [Next.js](https://nextjs.org/)
- [Playwright](https://playwright.dev/)
- [Prisma](https://www.prisma.io/)
- [NextAuth.js](https://next-auth.js.org/)

---

**Remember: Use responsibly and at your own risk. This tool violates LinkedIn's Terms of Service.**
