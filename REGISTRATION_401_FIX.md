# Registration 401 Error - Root Cause Analysis & Fix

## Summary

The intermittent 401 error during registration is caused by **two separate issues**. Both must be addressed for a permanent fix.

---

## Root Cause 1: JWT_SECRET Mismatch (Code Bug) ✅ FIXED

### The Problem

The app had **inconsistent JWT_SECRET defaults** across files:

| File | Default when JWT_SECRET not set |
|------|--------------------------------|
| `app/api/auth/register/route.ts` | `'change-this-to-a-very-long-random-string-in-production-min-32-chars'` |
| `app/api/auth/login/route.ts` | `'change-this-to-a-very-long-random-string-in-production-min-32-chars'` |
| `lib/auth.ts` | `'super-secret-default-key-change-in-production'` |

**What happens:**
1. User registers → token is **signed** with Secret A (from register route)
2. User is redirected to `/dashboard`
3. Dashboard fetches `/api/settings` → token is **verified** with Secret B (from lib/auth)
4. Verification fails → `getUserFromToken()` returns null → **401 Unauthorized**
5. Browser console shows: `Failed to load resource: the server responded with a status of 401`

**Why it seemed intermittent:**
- If `JWT_SECRET` **is set** in Vercel env → works
- If `JWT_SECRET` is **not set** → fails (deployment docs mentioned `NEXTAUTH_SECRET` but app uses `JWT_SECRET`)
- Preview vs Production env scope differences could cause inconsistent behavior

### The Fix (Applied)

All auth routes now import `JWT_SECRET` from the single source of truth (`lib/auth.ts`):
- `app/api/auth/register/route.ts` → imports from `@/lib/auth`
- `app/api/auth/login/route.ts` → imports from `@/lib/auth`

---

## Root Cause 2: Vercel Deployment Protection (Configuration)

### The Problem

**Vercel Deployment Protection** (Vercel Authentication) may be enabled for your project. When enabled:
- Preview deployments require users to **log in with a Vercel account** to view the site
- Unauthenticated requests receive **401 Unauthorized** before the request reaches your app
- This affects the entire site, including `/login` and `/api/auth/register`

**Why it seemed intermittent:**
- Works when you're logged into Vercel in the same browser
- Fails in incognito, different browsers, or when sharing links with others

Your URL `automation-liiin-yb5j-cdwjvinmc-ffgghhj779-cells-projects.vercel.app` appears to be a **preview deployment** (has hash in subdomain).

### The Fix (Manual - Vercel Dashboard)

1. Go to [Vercel Dashboard](https://vercel.com) → Your Project
2. **Settings** → **Deployment Protection**
3. Under "Vercel Authentication" or "Preview Deployments":
   - Set to **"None"** for Preview deployments, OR
   - Add your production domain to bypass list
4. Save and redeploy if needed

**For production domain** (e.g., `your-app.vercel.app`): Ensure Production deployments are not protected, or use Protection Bypass for your API.

---

## Root Cause 3: Missing JWT_SECRET in Vercel (Environment)

### The Problem

The deployment guides reference `NEXTAUTH_SECRET` and `NEXTAUTH_URL`, but **this app uses custom JWT auth** and requires `JWT_SECRET`. If only NEXTAUTH vars are set, `JWT_SECRET` may be missing.

### The Fix (Vercel Dashboard)

1. Go to Vercel → Project → **Settings** → **Environment Variables**
2. Add:
   - **Name:** `JWT_SECRET`
   - **Value:** Generate with `openssl rand -base64 32` (or use a 32+ char random string)
   - **Scope:** Production, Preview, Development (all three)
3. **Redeploy** the project for changes to take effect

---

## Checklist for Permanent Fix

- [x] **Code fix applied:** JWT_SECRET single source of truth
- [ ] **Vercel:** Add `JWT_SECRET` to Environment Variables (all scopes)
- [ ] **Vercel:** Disable Deployment Protection for Preview, or set to "None"
- [ ] **Vercel:** Update `NEXTAUTH_URL` to your actual production URL (if using)
- [ ] **Redeploy** after env changes

---

## Verification

After applying fixes:
1. Open site in **incognito/private window** (to simulate new user)
2. Go to `/login`, switch to "Get started" (registration)
3. Register with new email
4. Should redirect to dashboard without 401
5. Check browser DevTools → Network tab: no 401 on `/api/settings` or other APIs
