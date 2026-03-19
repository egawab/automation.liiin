"use strict";
/**
 * Worker Broadcasting Utilities
 * Sends live updates and screenshots to the dashboard
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.setApiBaseUrl = setApiBaseUrl;
exports.setUserContext = setUserContext;
exports.broadcastUpdate = broadcastUpdate;
exports.broadcastScreenshot = broadcastScreenshot;
exports.broadcastAction = broadcastAction;
exports.broadcastLog = broadcastLog;
exports.broadcastStatus = broadcastStatus;
exports.broadcastError = broadcastError;
// Auto-detect API URL based on environment
function getApiBaseUrl() {
    // 1. Check if explicitly set (for production deployments)
    if (process.env.NEXT_PUBLIC_APP_URL) {
        console.log(`   📡 Using NEXT_PUBLIC_APP_URL: ${process.env.NEXT_PUBLIC_APP_URL}`);
        return process.env.NEXT_PUBLIC_APP_URL;
    }
    // 2. Check if VERCEL_URL is set (automatic in Vercel deployments)
    if (process.env.VERCEL_URL) {
        const url = `https://${process.env.VERCEL_URL}`;
        console.log(`   📡 Using VERCEL_URL: ${url}`);
        return url;
    }
    // 3. Check if running on Render (RENDER_EXTERNAL_URL)
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`   📡 Using RENDER_EXTERNAL_URL: ${process.env.RENDER_EXTERNAL_URL}`);
        return process.env.RENDER_EXTERNAL_URL;
    }
    // 4. Check if running on Railway (RAILWAY_STATIC_URL)
    if (process.env.RAILWAY_STATIC_URL) {
        console.log(`   📡 Using RAILWAY_STATIC_URL: ${process.env.RAILWAY_STATIC_URL}`);
        return process.env.RAILWAY_STATIC_URL;
    }
    // 5. Check if DATABASE_URL indicates production (Neon)
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')) {
        // Production database detected, but platform URL must be explicit.
        // Do NOT hardcode a Vercel URL here — it easily gets out of sync and causes 404s for worker broadcasts.
        console.log(`   📡 Production database detected (Neon). Set NEXT_PUBLIC_APP_URL to enable live worker broadcasts.`);
    }
    // 6. Default to localhost for local development ONLY
    console.log(`   📡 Using localhost (local development mode)`);
    return 'http://localhost:3000';
}
let API_BASE_URL = getApiBaseUrl();
/**
 * Update API URL from user settings (called from worker)
 */
function setApiBaseUrl(url) {
    if (url && url.trim()) {
        // Normalize to avoid double slashes and accidental trailing slash issues
        API_BASE_URL = url.trim().replace(/\/+$/, '');
        console.log(`   📡 Platform URL set to: ${API_BASE_URL}`);
    }
}
// Store current user context
let currentUserId;
let currentSessionId;
/**
 * Set user context for broadcasts (called from worker)
 */
function setUserContext(userId, sessionId) {
    currentUserId = userId;
    currentSessionId = sessionId || `session-${Date.now()}`;
    console.log(`   📡 User context set: ${userId.slice(0, 8)}... / ${currentSessionId}`);
}
let pendingBroadcasts = 0;
const MAX_PENDING_BROADCASTS = 50;
let consecutiveFailures = 0;
let lastFailureCooldownUntil = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const COOLDOWN_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Send live update to dashboard
 * Non-blocking - runs in background, won't interrupt worker
 */
async function broadcastUpdate(options) {
    // Circuit breaker: Skip if in cooldown
    if (Date.now() < lastFailureCooldownUntil) {
        return;
    }
    // Queue limit: Skip if too many requests are already pending
    if (pendingBroadcasts >= MAX_PENDING_BROADCASTS) {
        return;
    }
    pendingBroadcasts++;
    // Run broadcast in background - don't await
    setImmediate(async () => {
        try {
            const payload = {
                type: options.type,
                userId: options.userId || currentUserId,
                sessionId: options.sessionId || currentSessionId,
                data: {
                    message: options.message,
                    screenshot: options.screenshot,
                    metadata: options.metadata,
                },
            };
            const response = await fetch(`${API_BASE_URL}/api/worker-events`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) {
                consecutiveFailures++;
                if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    console.warn(`🛑 Broadcast circuit breaker active. Silencing broadcasts for 5 minutes due to repeated failures.`);
                    lastFailureCooldownUntil = Date.now() + COOLDOWN_PERIOD_MS;
                    consecutiveFailures = 0; // Reset for after cooldown
                    return;
                }
            }
            else {
                // Reset failures on successful broadcast
                consecutiveFailures = 0;
                lastFailureCooldownUntil = 0;
            }
        }
        catch (error) {
            consecutiveFailures++;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                lastFailureCooldownUntil = Date.now() + COOLDOWN_PERIOD_MS;
                consecutiveFailures = 0;
            }
        }
        finally {
            pendingBroadcasts--;
        }
    });
}
/**
 * Capture and broadcast page screenshot
 */
async function broadcastScreenshot(page, message, metadata) {
    try {
        // Wait a moment for any animations to complete
        await page.waitForTimeout(500);
        // Capture screenshot with better quality for live viewer
        const screenshot = await page.screenshot({
            type: 'jpeg',
            quality: 85, // Higher quality for clearer live view (was 70)
            fullPage: false, // Only visible viewport
            animations: 'disabled', // Disable animations for cleaner screenshot
        });
        // Convert to base64
        const base64Screenshot = screenshot.toString('base64');
        // Broadcast
        await broadcastUpdate({
            type: 'screenshot',
            message,
            screenshot: base64Screenshot,
            metadata,
        });
    }
    catch (error) {
        console.warn('Screenshot broadcast failed:', error?.message || error);
    }
}
/**
 * Broadcast worker action
 */
async function broadcastAction(action, details) {
    await broadcastUpdate({
        type: 'action',
        message: action,
        metadata: details,
    });
}
/**
 * Broadcast worker log
 */
async function broadcastLog(message, level = 'info') {
    await broadcastUpdate({
        type: 'log',
        message,
        metadata: { level },
    });
}
/**
 * Broadcast worker status
 */
async function broadcastStatus(status, metadata) {
    await broadcastUpdate({
        type: 'status',
        message: status,
        metadata,
    });
}
/**
 * Broadcast worker error
 */
async function broadcastError(error, metadata) {
    await broadcastUpdate({
        type: 'error',
        message: error,
        metadata,
    });
}
