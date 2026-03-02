# 🔧 Vercel Environment Variables - Complete Setup

## ✅ What You Have (Already Set):

```
✅ JWT_SECRET - For authentication
✅ NEXTAUTH_URL - Your Vercel deployment URL
✅ DATABASE_URL - Neon PostgreSQL connection
✅ NEXTAUTH_SECRET - NextAuth authentication
```

**Status:** Your basic setup is complete and working! ✅

---

## 🎯 Additional Variables Needed (Optional but Recommended):

### **1. NEXT_PUBLIC_APP_URL** ⭐ IMPORTANT for Live Viewer

**Purpose:** Tells the worker where to send live screenshots

**Value:** Same as your NEXTAUTH_URL
```
NEXT_PUBLIC_APP_URL=https://automation-liiin-nfum.vercel.app
```

**Why you need it:**
- Ensures live viewer works correctly
- Worker sends screenshots to correct platform URL
- Already auto-detects from VERCEL_URL, but explicit is better

**How to add in Vercel:**
1. Go to your project on Vercel
2. Settings → Environment Variables
3. Add:
   - **Key**: `NEXT_PUBLIC_APP_URL`
   - **Value**: `https://automation-liiin-nfum.vercel.app`
   - **Environments**: Production, Preview, Development (all)

---

### **2. NODE_ENV** (Optional - Auto-set by Vercel)

**Status:** ✅ Automatically set by Vercel to `production`

**No action needed** - Vercel handles this automatically

---

### **3. GEMINI_API_KEY** (Optional - For AI Features)

**Purpose:** Powers AI-generated content (AutoPosts feature)

**Status:** ⚠️ Only needed if you want to use the AI AutoPost feature

**Where to get it:**
1. Go to: https://makersuite.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key

**How to add in Vercel:**
- **Key**: `GEMINI_API_KEY`
- **Value**: `your-api-key-here`
- **Environments**: Production, Preview, Development

**Note:** This is optional. If not set, AI features won't work, but everything else will.

---

## 📋 Complete Vercel Setup Checklist:

### **Required (You Have These ✅):**
- [x] `DATABASE_URL` - PostgreSQL connection
- [x] `JWT_SECRET` - Authentication secret
- [x] `NEXTAUTH_SECRET` - NextAuth secret
- [x] `NEXTAUTH_URL` - Your Vercel URL

### **Highly Recommended:**
- [ ] `NEXT_PUBLIC_APP_URL` - Same as NEXTAUTH_URL (for live viewer)

### **Optional:**
- [ ] `GEMINI_API_KEY` - For AI features (AutoPosts)
- [x] `NODE_ENV` - Auto-set by Vercel ✅

---

## 🚀 For Worker Deployment (Render/Railway):

When you deploy the worker to Render or Railway, you'll need:

### **Render.com Environment Variables:**
```
DATABASE_URL=postgresql://neondb_owner:npg_mDXqdhVn2Mj1@ep-fragrant-haze-aijuhuz0-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

NEXT_PUBLIC_APP_URL=https://automation-liiin-nfum.vercel.app

NODE_ENV=production
```

### **Railway.app Environment Variables:**
```
DATABASE_URL=postgresql://neondb_owner:npg_mDXqdhVn2Mj1@ep-fragrant-haze-aijuhuz0-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require

NEXT_PUBLIC_APP_URL=https://automation-liiin-nfum.vercel.app

NODE_ENV=production
```

**Note:** Worker only needs these 3 variables. It doesn't need JWT or NEXTAUTH secrets.

---

## 🎯 Quick Action Items:

### **1. Add to Vercel Right Now:**

Go to: https://vercel.com/your-project/settings/environment-variables

Add this one variable:

```
Name: NEXT_PUBLIC_APP_URL
Value: https://automation-liiin-nfum.vercel.app
Environments: ✓ Production ✓ Preview ✓ Development
```

Click "Save"

**Why:** This ensures the live viewer works perfectly when worker runs remotely.

---

### **2. Optional - Add AI Features:**

If you want AI-powered AutoPosts:

```
Name: GEMINI_API_KEY
Value: [Get from https://makersuite.google.com/app/apikey]
Environments: ✓ Production ✓ Preview ✓ Development
```

**Skip this if you don't need AI features.**

---

### **3. Redeploy (After Adding Variables):**

After adding environment variables, trigger a new deployment:

**Option A: Git Push**
```bash
git commit --allow-empty -m "Trigger redeploy"
git push origin main
```

**Option B: Vercel Dashboard**
- Go to Deployments tab
- Click "..." on latest deployment
- Click "Redeploy"

**This ensures new variables are loaded.**

---

## ✅ Verification Checklist:

After adding `NEXT_PUBLIC_APP_URL` and redeploying:

### **Test 1: Platform Loads**
```
Visit: https://automation-liiin-nfum.vercel.app
Should: Show login/dashboard ✓
```

### **Test 2: Authentication Works**
```
Try: Login with test account
Should: Successfully login ✓
```

### **Test 3: Database Connection**
```
Check: Dashboard shows your keywords/comments
Should: Data loads from Neon ✓
```

### **Test 4: Live Viewer Page Loads**
```
Visit: https://automation-liiin-nfum.vercel.app/dashboard/live-viewer
Should: Show live viewer interface ✓
```

### **Test 5: Worker Connection (After Worker Deployment)**
```
Start: Worker on Render/Railway
Check: Live viewer shows screenshots ✓
```

---

## 🔍 How to Check Current Variables:

**Vercel Dashboard:**
1. Go to your project
2. Settings → Environment Variables
3. See all set variables

**You should see:**
- `DATABASE_URL` (hidden value)
- `JWT_SECRET` (hidden value)
- `NEXTAUTH_SECRET` (hidden value)
- `NEXTAUTH_URL` (visible)
- `NEXT_PUBLIC_APP_URL` (visible) ⭐ ADD THIS
- `GEMINI_API_KEY` (hidden) - optional

---

## 🚨 Security Notes:

### **Variables to NEVER Share:**
- ❌ `DATABASE_URL` - Contains database password
- ❌ `JWT_SECRET` - Compromises authentication
- ❌ `NEXTAUTH_SECRET` - Compromises sessions
- ❌ `GEMINI_API_KEY` - Costs you money if leaked

### **Variables Safe to Share:**
- ✅ `NEXTAUTH_URL` - Public URL anyway
- ✅ `NEXT_PUBLIC_APP_URL` - Public URL anyway
- ✅ `NODE_ENV` - Just "production"

**Rule:** Never commit `.env` files to Git!

---

## 📊 Summary:

### **Current Status:**
- ✅ You have all REQUIRED variables set
- ⚠️ Missing RECOMMENDED: `NEXT_PUBLIC_APP_URL`
- ⚠️ Missing OPTIONAL: `GEMINI_API_KEY`

### **Action Needed:**
1. Add `NEXT_PUBLIC_APP_URL` to Vercel (2 minutes)
2. Redeploy (automatic or manual)
3. Test platform still works
4. Done! ✓

### **For Worker Deployment Later:**
1. Deploy worker to Render/Railway
2. Add 3 environment variables there
3. Worker auto-connects to Vercel
4. Live viewer works automatically

---

## 🎯 Quick Copy-Paste for Vercel:

```
# Add this to Vercel Environment Variables:

NEXT_PUBLIC_APP_URL=https://automation-liiin-nfum.vercel.app
```

**That's the only one you need to add right now!** ✅

---

## 📞 Need Help?

If anything doesn't work after adding variables:

1. Check Vercel build logs
2. Check browser console for errors
3. Verify DATABASE_URL is correct
4. Ensure you redeployed after adding variables

---

**You're 95% there! Just add `NEXT_PUBLIC_APP_URL` and you're done!** 🎉
