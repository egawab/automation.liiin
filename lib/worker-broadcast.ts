/**
 * Worker Broadcasting Utilities
 * Sends live updates and screenshots to the dashboard
 */

import { Page } from 'playwright';

// Auto-detect API URL based on environment
function getApiBaseUrl(): string {
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
export function setApiBaseUrl(url: string) {
  if (url && url.trim()) {
    // Normalize to avoid double slashes and accidental trailing slash issues
    API_BASE_URL = url.trim().replace(/\/+$/, '');
    console.log(`   📡 Platform URL set to: ${API_BASE_URL}`);
  }
}

export interface BroadcastOptions {
  type: 'screenshot' | 'action' | 'log' | 'status' | 'error';
  message: string;
  screenshot?: string; // base64 encoded
  metadata?: Record<string, any>;
  userId?: string;
  sessionId?: string;
}

// Store current user context
let currentUserId: string | undefined;
let currentSessionId: string | undefined;

/**
 * Set user context for broadcasts (called from worker)
 */
export function setUserContext(userId: string, sessionId?: string) {
  currentUserId = userId;
  currentSessionId = sessionId || `session-${Date.now()}`;
  console.log(`   📡 User context set: ${userId.slice(0, 8)}... / ${currentSessionId}`);
}

/**
 * Send live update to dashboard
 * Non-blocking - runs in background, won't interrupt worker
 */
export async function broadcastUpdate(options: BroadcastOptions): Promise<void> {
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
        // Add timeout to prevent hanging
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        // Only log on first failure or every 10th failure to reduce noise
        if (response.status === 405) {
          // 405 = Method Not Allowed - likely CORS or routing issue
          // This is expected when worker runs locally but tries to hit production
          // Silently skip - worker will still function
        } else {
          const errorText = await response.text().catch(() => response.statusText);
          console.warn(`⚠️  Broadcast failed: ${response.status} ${errorText}`);
        }
      }
    } catch (error: any) {
      // Silently fail - broadcasts are optional, worker must continue
      // Only log if it's not a timeout or network error
      if (!error.message?.includes('aborted') && !error.message?.includes('fetch')) {
        console.warn('⚠️  Broadcast error (non-fatal):', error.message);
      }
    }
  });
}

/**
 * Capture and broadcast page screenshot
 */
export async function broadcastScreenshot(page: Page, message: string, metadata?: Record<string, any>): Promise<void> {
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
  } catch (error) {
    console.warn('Screenshot broadcast failed:', error);
  }
}

/**
 * Broadcast worker action
 */
export async function broadcastAction(action: string, details?: Record<string, any>): Promise<void> {
  await broadcastUpdate({
    type: 'action',
    message: action,
    metadata: details,
  });
}

/**
 * Broadcast worker log
 */
export async function broadcastLog(message: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
  await broadcastUpdate({
    type: 'log',
    message,
    metadata: { level },
  });
}

/**
 * Broadcast worker status
 */
export async function broadcastStatus(status: string, metadata?: Record<string, any>): Promise<void> {
  await broadcastUpdate({
    type: 'status',
    message: status,
    metadata,
  });
}

/**
 * Broadcast worker error
 */
export async function broadcastError(error: string, metadata?: Record<string, any>): Promise<void> {
  await broadcastUpdate({
    type: 'error',
    message: error,
    metadata,
  });
}
