"use strict";
/**
 * LinkedIn Search-Only Worker - CAPTCHA-Resistant Edition
 *
 * This worker ONLY searches and saves post links - NO auto-commenting.
 * Designed to minimize CAPTCHA triggers through:
 * - Advanced stealth configuration
 * - Human-like behavior patterns
 * - Slower, randomized timing
 * - CAPTCHA detection and pause
 *
 * Flow:
 * 1. Search LinkedIn for keywords
 * 2. Extract posts with engagement metrics
 * 3. Filter by reach criteria
 * 4. Save filtered post links to database
 * 5. User manually opens links from dashboard
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWorker = startWorker;
require("dotenv/config");
const playwright_1 = require("playwright");
const client_1 = require("@prisma/client");
const worker_broadcast_1 = require("./lib/worker-broadcast");
const prisma = new client_1.PrismaClient();
// ============================================================================
// WORKER STATE
// ============================================================================
let browser = null;
let context = null;
let page = null;
let isRunning = false;
let currentUserId = null;
let currentSessionCookie = null;
let isAuthenticated = false;
let lastBrowserRestart = Date.now();
// ============================================================================
// DASHBOARD LOG MIRRORING (console -> SSE)
// ============================================================================
let dashboardLoggingEnabled = false;
const logBuffer = [];
const MAX_BUFFERED_LOGS = 200;
function bufferLog(level, message) {
    if (logBuffer.length >= MAX_BUFFERED_LOGS)
        logBuffer.shift();
    logBuffer.push({ level, message });
}
async function flushBufferedLogsToDashboard() {
    if (!dashboardLoggingEnabled)
        return;
    while (logBuffer.length > 0) {
        const item = logBuffer.shift();
        if (!item)
            break;
        await (0, worker_broadcast_1.broadcastLog)(item.message, item.level).catch(() => { });
    }
}
function enableDashboardConsoleMirroring() {
    if (dashboardLoggingEnabled)
        return;
    dashboardLoggingEnabled = true;
    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);
    console.log = (...args) => {
        originalLog(...args);
        try {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            bufferLog('info', msg);
            // Fire-and-forget; do not await inside console methods
            void flushBufferedLogsToDashboard();
        }
        catch { }
    };
    console.warn = (...args) => {
        originalWarn(...args);
        try {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            bufferLog('warn', msg);
            void flushBufferedLogsToDashboard();
        }
        catch { }
    };
    console.error = (...args) => {
        originalError(...args);
        try {
            const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
            bufferLog('error', msg);
            void flushBufferedLogsToDashboard();
        }
        catch { }
    };
}
// ============================================================================
// MAIN WORKER LOOP
// ============================================================================
// Helper for heartbeat sleeps
const heartbeatSleep = async (totalMs) => {
    const heartBeatInterval = 2 * 60 * 1000; // 2 minutes
    let remaining = totalMs;
    while (remaining > 0) {
        const chunk = Math.min(remaining, heartBeatInterval);
        await new Promise(resolve => setTimeout(resolve, chunk));
        const mem = Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(`[WORKER_HEARTBEAT] Still alive | Mem: ${mem}MB`);
        remaining -= chunk;
    }
};
async function workerLoop() {
    console.log('\n🔍 LinkedIn Search-Only Worker - Starting...\n');
    console.log('📋 Mode: Search and save links ONLY (no auto-commenting)\n');
    await (0, worker_broadcast_1.broadcastStatus)('Starting search-only worker...');
    while (true) {
        console.log('[WORKER_HEARTBEAT] New cycle starting...');
        // Phase 5: Self-healing periodic browser restart (every 4-6 hours)
        const browserAgeHours = (Date.now() - lastBrowserRestart) / (1000 * 60 * 60);
        if (browserAgeHours > 6) {
            console.log('\n🔄 Phase 5: Proactive browser restart to maintain stability (Age: ' + Math.round(browserAgeHours) + 'h)...\n');
            await cleanup().catch(() => { });
            lastBrowserRestart = Date.now();
        }
        try {
            const settings = await getActiveUserSettings();
            if (!settings) {
                const totalUsers = await prisma.user.count().catch(() => 0);
                console.log(`\n⏸️  [STATUS] Idle: No active users. (DB Total: ${totalUsers})`);
                console.log(`   Arabic: لا يوجد مستخدم مفعّل حالياً.\n`);
                await heartbeatSleep(60000);
                continue;
            }
            if (!settings.systemActive) {
                console.log(`⏸️ [DIAGNOSTIC] System is INACTIVE for user ${settings.userId}. Toggle "System Active" in dashboard.\n`);
                if (isRunning)
                    await cleanup();
                await heartbeatSleep(60000);
                continue;
            }
            // Check if search-only mode is enabled
            if (!settings.searchOnlyMode) {
                console.log('⚠️ [DIAGNOSTIC] Search-only mode is DISABLED in dashboard. Waiting...\n');
                await (0, worker_broadcast_1.broadcastError)('Search-only mode is disabled. Enable it in dashboard settings.');
                await heartbeatSleep(60000);
                continue;
            }
            // Check work hours (skip if outside working hours)
            if (settings.workHoursOnly && !isWithinWorkHours(settings)) {
                const msg = `⏰ [DIAGNOSTIC] Outside work hours (${settings.workHoursStart}:00-${settings.workHoursEnd}:00). Sleeping...`;
                console.log(`${msg}\n`);
                await (0, worker_broadcast_1.broadcastStatus)(msg);
                await heartbeatSleep(300000); // Check again in 5 minutes
                continue;
            }
            // Check daily search limit
            const searchesToday = await getSearchCountInPeriod(settings.userId, 'day');
            if (searchesToday >= settings.maxSearchesPerDay) {
                const msg = `⏹️ [DIAGNOSTIC] Daily search limit reached (${searchesToday}/${settings.maxSearchesPerDay}).`;
                console.log(`${msg}\n`);
                await (0, worker_broadcast_1.broadcastStatus)(msg);
                await heartbeatSleep(3600000); // 1 hour
                continue;
            }
            // Check hourly search limit
            const searchesThisHour = await getSearchCountInPeriod(settings.userId, 'hour');
            if (searchesThisHour >= settings.maxSearchesPerHour) {
                const msg = `Hourly limit reached (${searchesThisHour}/${settings.maxSearchesPerHour}). Waiting...`;
                console.log(`⏳ ${msg}\n`);
                await (0, worker_broadcast_1.broadcastStatus)(msg);
                await heartbeatSleep(600000); // Wait 10 minutes before retry
                continue;
            }
            // Set user context for broadcasts
            (0, worker_broadcast_1.setUserContext)(settings.userId);
            // Ensure broadcasts go to the correct deployed dashboard URL (prevents 404s)
            if (settings.platformUrl && settings.platformUrl.trim()) {
                (0, worker_broadcast_1.setApiBaseUrl)(settings.platformUrl.trim());
            }
            else if (process.env.NEXT_PUBLIC_APP_URL) {
                (0, worker_broadcast_1.setApiBaseUrl)(process.env.NEXT_PUBLIC_APP_URL);
            }
            // Initialize browser if needed
            if (!browser || currentUserId !== settings.userId || currentSessionCookie !== settings.linkedinSessionCookie) {
                console.log('🔄 User/session changed. Reinitializing browser...\n');
                if (browser)
                    await cleanup();
                currentUserId = settings.userId;
                currentSessionCookie = settings.linkedinSessionCookie;
                await initializeBrowser();
                const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
                if (!authenticated) {
                    await (0, worker_broadcast_1.broadcastError)('LinkedIn authentication failed. Please update your session cookie.');
                    await heartbeatSleep(30000);
                    continue;
                }
                isAuthenticated = true;
                await (0, worker_broadcast_1.broadcastStatus)('✅ Authenticated - Ready to search');
            }
            // Fetch active keywords (limit to maxKeywordsPerCycle for safety)
            let keywords = await getActiveKeywords(settings.userId);
            keywords = keywords.slice(0, 10); // Phase 4: Overridden to 10 keywords
            if (keywords.length === 0) {
                console.log('⚠️  No active keywords. Waiting...\n');
                await (0, worker_broadcast_1.broadcastLog)('No active keywords configured. Add keywords in dashboard.');
                await heartbeatSleep(30000);
                continue;
            }
            console.log(`📊 Processing ${keywords.length} keyword(s) (max ${settings.maxKeywordsPerCycle} per cycle)...\n`);
            await (0, worker_broadcast_1.broadcastStatus)(`Searching ${keywords.length} keyword(s)...`);
            // Process each keyword
            for (const keyword of keywords) {
                // Re-check limits before each search
                if (await getSearchCountInPeriod(settings.userId, 'hour') >= settings.maxSearchesPerHour) {
                    console.log('⏹️  Hourly limit reached. Stopping cycle.\n');
                    break;
                }
                if (await getSearchCountInPeriod(settings.userId, 'day') >= settings.maxSearchesPerDay) {
                    console.log('⏹️  Daily limit reached. Stopping cycle.\n');
                    break;
                }
                // Check if system is still active
                const stillActive = await isSystemStillActive(settings.userId);
                if (!stillActive) {
                    console.log('⏹️  System deactivated by user. Stopping...\n');
                    break;
                }
                console.log('[WORKER_HEARTBEAT] Starting keyword processing...');
                await processKeyword(keyword, settings);
                // Conservative delay between searches (5-10 minutes)
                const delayMinutes = settings.minDelayBetweenSearchesMinutes;
                const delaySeconds = randomBetween(delayMinutes * 60, (delayMinutes + 5) * 60);
                console.log(`⏱️  Waiting ${Math.round(delaySeconds / 60)} min before next search (conservative mode)...\n`);
                await heartbeatSleep(delaySeconds * 1000);
            }
            // Longer delay between cycles (10-15 minutes in conservative mode)
            const cycleDelayMinutes = randomBetween(10, 15);
            console.log(`\n✅ Cycle complete. Next cycle in ${cycleDelayMinutes} minutes.\n`);
            await (0, worker_broadcast_1.broadcastStatus)(`Cycle complete. Next run in ${cycleDelayMinutes}m`);
            await heartbeatSleep(cycleDelayMinutes * 60 * 1000);
        }
        catch (error) {
            console.error('❌ Worker error:', error.message);
            await (0, worker_broadcast_1.broadcastError)(`Worker error: ${error.message}`);
            // Check for CAPTCHA / anti-bot signals
            const detection = await detectCaptcha();
            if (detection.level === 'hard') {
                await handleCaptcha(detection);
            }
            else if (detection.level === 'soft') {
                console.log('⚠️ Soft anti-bot signal after error:', detection.reason);
                await heartbeatSleep(180000); // 3 minute cool-down
            }
            else {
                await heartbeatSleep(60000); // 1 minute cool-down
            }
        }
    }
}
// ============================================================================
// KEYWORD PROCESSING
// ============================================================================
async function processKeyword(keyword, settings) {
    try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔍 Keyword: "${keyword.keyword}"`);
        console.log(`${'='.repeat(80)}\n`);
        await (0, worker_broadcast_1.broadcastLog)(`Searching for: "${keyword.keyword}"`);
        // Search LinkedIn
        const postsRaw = await searchLinkedInPosts(keyword.keyword);
        // Sort by engagement descending (High Reach Priority)
        const posts = postsRaw.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));
        // Log this search for rate limit tracking
        await logSearch(settings.userId, keyword.keyword);
        if (posts.length === 0) {
            console.log('❌ No posts found\n');
            await (0, worker_broadcast_1.broadcastLog)(`No posts found for "${keyword.keyword}"`);
            return;
        }
        console.log(`📊 Found ${posts.length} posts\n`);
        // Filter by reach criteria (strict matches)
        const strictMatches = posts.filter(post => post.likes >= settings.minLikes &&
            post.likes <= settings.maxLikes &&
            post.comments >= settings.minComments &&
            post.comments <= settings.maxComments);
        // Double-check: how many posts actually have engagement data?
        const withEngagement = posts.filter(p => p.likes > 0 || p.comments > 0);
        console.log(`📈 Engagement data: ${withEngagement.length}/${posts.length} posts have likes/comments`);
        console.log(`✅ ${strictMatches.length} posts match reach criteria\n`);
        await (0, worker_broadcast_1.broadcastLog)(`Found ${strictMatches.length} matching posts for "${keyword.keyword}" (${withEngagement.length} with engagement data)`);
        let postsToSave = [...strictMatches];
        // Phase 4: Supplement strict matches with top engagement results if volume is low (target 15)
        if (postsToSave.length < 15 && withEngagement.length > 0) {
            const remainingTarget = 15 - postsToSave.length;
            const potentialSupplements = withEngagement
                .filter(p => !postsToSave.some(s => s.url === p.url))
                .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
                .slice(0, remainingTarget);
            if (potentialSupplements.length > 0) {
                console.log(`➕ Supplementing with ${potentialSupplements.length} high-reach posts to hit target volume.`);
                postsToSave = [...postsToSave, ...potentialSupplements];
            }
        }
        let usedFallback = postsToSave.length > strictMatches.length;
        if (postsToSave.length === 0) {
            console.log('⚠️  No posts matching criteria or with engagement found. Skipping.\n');
            await (0, worker_broadcast_1.broadcastLog)(`No quality matches found for "${keyword.keyword}". Skipping.`, 'warn');
            return;
        }
        const saveResults = await Promise.allSettled(postsToSave.map(post => savePostToDatabase(post, keyword.keyword, settings.userId)));
        const savedCount = saveResults.filter(r => r.status === 'fulfilled' && r.value === true).length;
        console.log(`💾 Saved ${savedCount} new posts to dashboard\n`);
        await (0, worker_broadcast_1.broadcastLog)(`${usedFallback ? '✅ Saved fallback posts' : '✅ Saved strict matches'} for "${keyword.keyword}" (${savedCount}/${postsToSave.length} saved)`);
    }
    catch (error) {
        console.error(`❌ Error processing keyword "${keyword.keyword}":`, error.message);
        await (0, worker_broadcast_1.broadcastError)(`Failed to process "${keyword.keyword}": ${error.message}`);
    }
}
// ============================================================================
// LINKEDIN SEARCH
// ============================================================================
const MAX_POSTS_PER_SEARCH = 150;
/**
 * Human-like search via LinkedIn's search box (bypasses datacenter IP block).
 * Instead of navigating directly to the search URL, we type into the search box.
 */
async function navigateToSearchViaUI(keyword) {
    if (!page)
        throw new Error('Browser not initialized');
    console.log(`🔍 [UI] Navigating to LinkedIn feed first...`);
    await page.goto('https://www.linkedin.com/feed', {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    });
    await humanDelay(2000, 3500);
    // Try to find the search input box
    const searchBoxSelectors = [
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]',
        '.search-global-typeahead__input',
        'input[data-artdeco-is-focused]',
        '#global-nav-search input'
    ];
    let searchBox = null;
    for (const sel of searchBoxSelectors) {
        searchBox = await page.$(sel).catch(() => null);
        if (searchBox) {
            console.log(`🔍 [UI] Found search box with: ${sel}`);
            break;
        }
    }
    if (!searchBox) {
        // Fallback: use direct URL if search box not found
        console.log(`⚠️ [UI] Search box not found, falling back to direct URL...`);
        const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return;
    }
    // Click the search box and type (character by character like a human)
    await searchBox.click();
    await humanDelay(500, 1000);
    await searchBox.triple_click?.() || await searchBox.click({ clickCount: 3 });
    await humanDelay(200, 400);
    await page.keyboard.type(keyword, { delay: 80 + Math.random() * 120 });
    await humanDelay(800, 1500);
    console.log(`🔍 [UI] Typed keyword: "${keyword}" — pressing Enter...`);
    await page.keyboard.press('Enter');
    // Wait for search results to load
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    await humanDelay(2000, 3500);
    // Click "Posts" tab if visible (to filter content search results)
    const postsTabSelectors = [
        'button[aria-label="Posts"]',
        'a[href*="search/results/content"]',
        '[data-control-name="filter_content"]',
    ];
    for (const sel of postsTabSelectors) {
        const tab = await page.$(sel).catch(() => null);
        if (tab) {
            console.log(`🔍 [UI] Clicking Posts tab...`);
            await tab.click().catch(() => { });
            await humanDelay(2000, 3000);
            break;
        }
    }
    console.log(`✅ [UI] Search results page loaded for: "${keyword}"`);
}
async function searchLinkedInPosts(keyword) {
    if (!page)
        throw new Error('Browser not initialized');
    try {
        // Navigate using human-like UI (bypasses datacenter IP block on direct search URL)
        await navigateToSearchViaUI(keyword);
        // Wait for first batch of results
        await page.waitForSelector('.reusable-search__result-container, [data-urn*="activity"], [data-urn*="ugcPost"], [data-chameleon-result-urn]', { timeout: 12000 }).catch(() => console.log('⚠️  Initial result containers slow — proceeding anyway...'));
        console.log('📜 Scrolling to load more posts...');
        for (let round = 0; round < 15; round++) {
            await page.evaluate(() => {
                const cards = document.querySelectorAll('[role="listitem"], [data-view-name="feed-full-update"], .reusable-search__result-container, li.artdeco-card');
                const last = cards[cards.length - 1];
                if (last) {
                    last.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }
                else {
                    window.scrollBy(0, 900);
                }
            });
            await Promise.race([
                page.waitForSelector('[data-chameleon-result-urn], .reusable-search__result-container', {
                    timeout: 3000
                }).catch(() => { }),
                sleep(1000)
            ]);
            await humanDelay(800, 1500);
            const moreBtn = await page.$('button.search-results-bottom-pagination__button, button[aria-label="See more results"]').catch(() => null);
            if (moreBtn) {
                await moreBtn.click().catch(() => { });
                await humanDelay(1500, 2500);
            }
        }
        const detection = await detectCaptcha();
        if (detection.level === 'hard') {
            console.log('🚨 Hard CAPTCHA / checkpoint detected during search:', detection.reason);
            await (0, worker_broadcast_1.broadcastError)(`Hard CAPTCHA detected during search: ${detection.reason}`);
            throw new Error('HARD_CAPTCHA_DETECTED_DURING_SEARCH');
        }
        else if (detection.level === 'soft') {
            console.log('⚠️ Soft anti-bot signal during search:', detection.reason);
            await (0, worker_broadcast_1.broadcastLog)('Soft anti-bot signal during search. Backing off but continuing.', 'warn');
            await humanDelay(60000, 120000);
        }
        console.log(`📊 Extracting post data...`);
        const postsRaw = await Promise.race([
            page.evaluate(`(function() {
        var MAX = ${MAX_POSTS_PER_SEARCH};
        var results = [];
        var seen = {}; var staleCount = 0;

        function parseNum(t) {
          if (!t) return 0;
          var c = String(t).toLowerCase().replace(/,/g,'').trim();
          var m = c.match(/(\\d+(?:\\.\\d+)?)/);
          if (!m) return 0;
          var n = parseFloat(m[1]);
          if (c.indexOf('k') !== -1) n *= 1000;
          if (c.indexOf('m') !== -1) n *= 1000000;
          return Math.round(n);
        }

        function decodeTrackingScope(el) {
          try {
            var raw = el.getAttribute('data-view-tracking-scope');
            if (!raw) return null;
            var arr = JSON.parse(raw);
            var items = Array.isArray(arr) ? arr : [arr];
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              var data = item && item.breadcrumb && item.breadcrumb.content && item.breadcrumb.content.data;
              if (data && Array.isArray(data)) {
                var str = data.map(function(b) { return String.fromCharCode(b); }).join('');
                var inner = JSON.parse(str);
                var urn = inner.updateUrn || (inner.controlledUpdateRegion && inner.controlledUpdateRegion.updateUrn) || null;
                if (urn) return urn;
              }
              var value = item && item.value;
              if (value && Array.isArray(value)) {
                var str2 = value.map(function(b) { return String.fromCharCode(b); }).join('');
                var inner2 = JSON.parse(str2);
                var urn2 = inner2.updateUrn || (inner2.controlledUpdateRegion && inner2.controlledUpdateRegion.updateUrn) || null;
                if (urn2) return urn2;
              }
            }
            return null;
            } catch(e) { return null; }
        }

        var containers = Array.from(document.querySelectorAll('[role="listitem"], [data-view-name="feed-full-update"]'));
        if (containers.length === 0) {
          containers = Array.from(document.querySelectorAll('li.artdeco-card, .feed-shared-update-v2[data-urn], .entity-result, .reusable-search__result-container'));
        }

        containers.forEach(function(container) {
          if (results.length >= MAX) return;
          var url = null;
          var scopeEls = [container].concat(Array.from(container.querySelectorAll('[data-view-tracking-scope]')));
          for (var i = 0; i < scopeEls.length; i++) {
            var urn = decodeTrackingScope(scopeEls[i]);
            if (urn && (urn.indexOf('urn:li:activity:') !== -1 || urn.indexOf('urn:li:ugcPost:') !== -1 || urn.indexOf('urn:li:share:') !== -1)) {
              url = 'https://www.linkedin.com/feed/update/' + urn;
              break;
            }
          }
          if (!url) {
            var urnEl = container.querySelector('[data-urn*="activity:"], [data-urn*="ugcPost:"]');
            if (urnEl) url = 'https://www.linkedin.com/feed/update/' + urnEl.getAttribute('data-urn');
          }
          if (!url || seen[url]) return;
          seen[url] = true;

          var like = 0, comm = 0;
          try {
            var text = (container.innerText || '').replace(/[\\n\\r]/g, ' ');
            var mLike = text.match(/(\\d[\\d,]*)\\s*(reactions?|likes?)/i);
            if (mLike) like = parseNum(mLike[1]);
            var mComm = text.match(/(\\d[\\d,]*)\\s*comments?/i);
            if (mComm) comm = parseNum(mComm[1]);

            if (!like || !comm) {
              var allLabels = Array.from(container.querySelectorAll('[aria-label]'));
              for (var l = 0; l < allLabels.length; l++) {
                var label = (allLabels[l].getAttribute('aria-label') || '').toLowerCase();
                if (!like && (label.indexOf('reaction') !== -1 || label.indexOf('like') !== -1)) {
                  var ml = label.match(/(\\d[\\d,]*)/);
                  if (ml) like = parseNum(ml[1]);
                }
                if (!comm && label.indexOf('comment') !== -1) {
                  var mc = label.match(/(\\d[\\d,]*)/);
                  if (mc) comm = parseNum(mc[1]);
                }
              }
            }
          } catch(e) {}
          var dateText = '';
          try {
            var dateEl = container.querySelector('.update-components-actor__sub-description, .entity-result__simple-insight, .entity-result__caption');
            dateText = (dateEl ? dateEl.innerText : '').toLowerCase();
            if (dateText.match(/(\\d+mo|[\\d.]+y)/)) {
              var m = dateText.match(/(\\d+)mo/);
              if (m && parseInt(m[1]) > 6) { staleCount++; return; }
              if (dateText.indexOf('y') !== -1) { staleCount++; return; }
            }
          } catch(e) {}
          results.push({ url: url, likes: like, comments: comm });
        });

        if (results.length < 5) {
          Array.from(document.querySelectorAll('a[href*="/feed/update/urn:li:"]')).forEach(function(a) {
            if (results.length >= MAX) return;
            var url = a.href.split('?')[0].split('#')[0];
            if (!seen[url]) {
              seen[url] = true;
              results.push({ url: url, likes: 0, comments: 0 });
            }
          });
        }
        return results;
      })()`),
            (async () => {
                await sleep(25000);
                throw new Error('EXTRACTION_TIMEOUT');
            })()
        ]).catch(async (err) => {
            console.log(`⚠️  Extraction script failed: ${err?.message || err}`);
            await (0, worker_broadcast_1.broadcastScreenshot)(page, `Extraction failed: ${err?.message || err}`).catch(() => { });
            return [];
        });
        const posts = (Array.isArray(postsRaw) ? postsRaw : []).map((p) => ({
            url: p.url,
            author: 'Unknown',
            preview: '',
            likes: typeof p.likes === 'number' ? p.likes : 0,
            comments: typeof p.comments === 'number' ? p.comments : 0
        }));
        console.log('⏳ Waiting for engagement counts to render...');
        await sleep(15000);
        console.log(`✅ Extracted ${posts.length} posts\n`);
        return posts;
    }
    catch (error) {
        console.error('❌ Search error:', error.message);
        throw error;
    }
}
// ============================================================================
// RATE LIMITING & WORK HOURS
// ============================================================================
function isWithinWorkHours(settings) {
    const now = new Date();
    if (settings.skipWeekends) {
        const day = now.getDay(); // 0=Sun, 6=Sat
        if (day === 0 || day === 6)
            return false;
    }
    if (!settings.workHoursOnly)
        return true;
    const hour = now.getHours();
    return hour >= settings.workHoursStart && hour < settings.workHoursEnd;
}
async function getSearchCountInPeriod(userId, period) {
    return withRetry(async () => {
        const since = new Date();
        if (period === 'hour') {
            since.setHours(since.getHours() - 1);
        }
        else {
            since.setDate(since.getDate() - 1);
        }
        const count = await prisma.log.count({
            where: {
                userId,
                action: 'SEARCH',
                timestamp: { gte: since }
            }
        });
        return count;
    });
}
async function logSearch(userId, keyword) {
    await withRetry(async () => {
        await prisma.log.create({
            data: {
                userId,
                action: 'SEARCH',
                postUrl: `search:${keyword}`
            }
        });
    }).catch(err => console.error('Failed to log search after retries:', err));
}
// ============================================================================
// DATABASE OPERATIONS
// ============================================================================
async function savePostToDatabase(post, keyword, userId) {
    return withRetry(async () => {
        const existing = await prisma.savedPost.findFirst({
            where: {
                userId,
                postUrl: post.url
            }
        });
        if (existing) {
            return false;
        }
        await prisma.savedPost.create({
            data: {
                userId,
                postUrl: post.url,
                postAuthor: post.author,
                postPreview: post.preview,
                likes: post.likes,
                comments: post.comments,
                keyword,
                visited: false
            }
        });
        return true;
    }).catch(error => {
        console.error('❌ Database save error after retries:', error.message);
        return false;
    });
}
// ============================================================================
// BROWSER MANAGEMENT WITH STEALTH
// ============================================================================
async function initializeBrowser() {
    console.log('🌐 Initializing stealth browser...\n');
    const headlessEnv = (process.env.HEADLESS || '').toLowerCase();
    const isHeadless = headlessEnv !== 'false';
    browser = await playwright_1.chromium.launch({
        headless: isHeadless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            '--window-size=1920,1080',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });
    context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        permissions: [],
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        colorScheme: 'light'
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false
        });
        window.chrome = {
            runtime: {}
        };
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (parameters.name === 'notifications'
            ? Promise.resolve({ state: 'denied' })
            : originalQuery(parameters));
        Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
        });
    });
    page = await context.newPage();
    page.on('dialog', dialog => dialog.dismiss().catch(() => { }));
    isRunning = true;
    console.log('✅ Stealth browser initialized\n');
}
async function authenticateLinkedIn(sessionCookie) {
    if (!page || !context)
        throw new Error('Browser not initialized');
    try {
        console.log('🔐 Authenticating LinkedIn session...');
        await context.addCookies([{
                name: 'li_at',
                value: sessionCookie,
                domain: '.linkedin.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'None'
            }]);
        console.log('   Set LinkedIn session cookie');
        await humanDelay(2000, 4000);
        await page.goto('https://www.linkedin.com/feed', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
        await humanDelay(3000, 5000);
        const isAuthenticated = await page.evaluate(() => {
            if (!window.location.hostname.includes('linkedin.com'))
                return false;
            if (window.location.pathname.includes('/login'))
                return false;
            if (window.location.pathname.includes('/checkpoint'))
                return false;
            const hasNav = document.querySelector('nav[aria-label="Primary Navigation"], .global-nav');
            return !!hasNav;
        });
        if (isAuthenticated) {
            console.log('✅ LinkedIn authentication successful\n');
            await (0, worker_broadcast_1.broadcastScreenshot)(page, 'Authenticated on LinkedIn');
            await warmUpSession();
            return true;
        }
        else {
            console.log('❌ LinkedIn authentication failed\n');
            await (0, worker_broadcast_1.broadcastScreenshot)(page, 'Authentication failed');
            return false;
        }
    }
    catch (error) {
        console.error('❌ Authentication error:', error.message);
        return false;
    }
}
async function detectCaptcha() {
    if (!page) {
        return { level: 'none', reason: 'no-page' };
    }
    try {
        const info = await page.evaluate(() => {
            const url = window.location.href;
            const path = window.location.pathname;
            const title = document.title || '';
            const rawText = (document.body?.innerText || '').toLowerCase();
            const textSnippet = rawText.slice(0, 800);
            const isCheckpoint = path.includes('/checkpoint') ||
                path.includes('/authwall') ||
                url.includes('checkpoint') ||
                url.includes('authwall');
            const hasCaptchaElement = !!document.querySelector('iframe[src*=\"captcha\"], iframe[src*=\"recaptcha\"], div[id*=\"captcha\"], div[class*=\"captcha\"]');
            const strongPhrases = [
                "let's do a quick security check",
                'unusual activity on your account',
                'to help keep your account safe',
                'we detected suspicious activity',
                'we’ve detected suspicious activity',
                'to continue, please verify your identity'
            ];
            const hasStrongPhrase = strongPhrases.some((phrase) => rawText.includes(phrase.toLowerCase()));
            return {
                url,
                path,
                title,
                textSnippet,
                isCheckpoint,
                hasCaptchaElement,
                hasStrongPhrase
            };
        });
        let level = 'none';
        let reason = 'no captcha indicators';
        if (info.isCheckpoint || info.hasCaptchaElement) {
            level = 'hard';
            reason = 'checkpoint or captcha element detected';
        }
        else if (info.hasStrongPhrase) {
            level = 'soft';
            reason = 'strong anti-bot phrase detected';
        }
        if (level !== 'none') {
            console.log('\n🚨 CAPTCHA / anti-bot signal detected');
            console.log(`   URL: ${info.url}`);
            console.log(`   Title: ${info.title}`);
            console.log(`   Reason: ${reason}`);
            await (0, worker_broadcast_1.broadcastScreenshot)(page, 'CAPTCHA / anti-bot signal detected').catch(() => { });
        }
        return {
            level,
            reason,
            url: info.url,
            title: info.title,
            snippet: info.textSnippet
        };
    }
    catch (err) {
        console.error('detectCaptcha error:', err?.message || err);
        return { level: 'none', reason: 'detection-error' };
    }
}
async function handleCaptcha(detection) {
    console.log('\n🚨 HARD CAPTCHA / CHECKPOINT DETECTED\n');
    console.log('   The system has paused to avoid further detection.');
    await (0, worker_broadcast_1.broadcastError)(`⚠️ Hard CAPTCHA detected (${detection.reason}). Worker entering extended cool-down.`);
    const cooldownMinutes = 20;
    await (0, worker_broadcast_1.broadcastStatus)(`Hard CAPTCHA cool-down for ${cooldownMinutes} minutes`);
    await sleep(cooldownMinutes * 60 * 1000);
    console.log('⏰ Exiting hard CAPTCHA cool-down. Worker will cautiously resume.\n');
    await (0, worker_broadcast_1.broadcastStatus)('Exiting hard CAPTCHA cool-down. Worker will cautiously resume.');
}
// ============================================================================
// HUMAN-LIKE BEHAVIOR UTILITIES
// ============================================================================
async function humanDelay(minMs, maxMs) {
    const delay = randomBetween(minMs, maxMs);
    await sleep(delay);
}
async function humanScroll(page) {
    try {
        const scrollCount = randomBetween(2, 5);
        for (let i = 0; i < scrollCount; i++) {
            const scrollAmount = randomBetween(200, 600);
            await page.evaluate((amount) => {
                window.scrollBy({
                    top: amount,
                    behavior: 'smooth'
                });
            }, scrollAmount);
            await humanDelay(500, 1500);
        }
        await page.evaluate(() => {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
    catch {
    }
}
async function warmUpSession() {
    if (!page)
        return;
    try {
        console.log('🧊 Warming up LinkedIn session on feed...');
        await humanScroll(page);
        await humanDelay(3000, 6000);
        const candidateLinks = await page.$$('a[href*="/feed/update/"], a[href*="/in/"]:not([href*="miniProfileUrn"])');
        const maxToOpen = Math.min(2, candidateLinks.length);
        for (let i = 0; i < maxToOpen; i++) {
            const link = candidateLinks[i];
            try {
                await link.click({ button: 'left' });
                await humanDelay(3000, 6000);
                await humanScroll(page);
                await humanDelay(2000, 4000);
                await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
                await humanDelay(2000, 4000);
            }
            catch {
            }
        }
        console.log('✅ Warm-up sequence complete.\n');
    }
    catch (err) {
        console.log('Warm-up sequence error (non-fatal):', err?.message || err);
    }
}
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function cleanup() {
    console.log('\n🧹 Cleaning up...');
    if (page) {
        await page.close().catch(() => { });
        page = null;
    }
    if (context) {
        await context.close().catch(() => { });
        context = null;
    }
    if (browser) {
        await browser.close().catch(() => { });
        browser = null;
    }
    await prisma.$disconnect();
    isRunning = false;
    isAuthenticated = false;
    console.log('✅ Cleanup complete\n');
}
// ============================================================================
// DATABASE RESILIENCE WRAPPER
// ============================================================================
/**
 * Executes a Prisma operation with retries.
 * Critical for handling Neon DB "sleep" cycles or connection pool timeouts.
 */
async function withRetry(operation, retries = 3, delay = 5000) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            // Ensure connection is active
            await prisma.$connect().catch(() => { });
            return await operation();
        }
        catch (error) {
            lastError = error;
            const isConnectionError = error.message?.includes('Prisma') ||
                error.code === 'P1001' ||
                error.code === 'P2024';
            if (isConnectionError && i < retries - 1) {
                console.warn(`⚠️ [DB_RETRY] Connection issue (Attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`);
                await sleep(delay);
                continue;
            }
            throw error;
        }
    }
    throw lastError;
}
// ============================================================================
// DATABASE OPERATIONS
// ============================================================================
async function isSystemStillActive(userId) {
    return withRetry(async () => {
        const settings = await prisma.settings.findUnique({
            where: { userId }
        });
        return settings?.systemActive ?? false;
    });
}
async function getActiveUserSettings() {
    return withRetry(async () => {
        const settings = await prisma.settings.findFirst({
            where: { systemActive: true },
            include: { user: true }
        });
        if (!settings)
            return null;
        return {
            userId: settings.userId,
            linkedinSessionCookie: settings.linkedinSessionCookie,
            platformUrl: settings.platformUrl,
            minLikes: settings.minLikes,
            maxLikes: settings.maxLikes,
            minComments: settings.minComments,
            maxComments: settings.maxComments,
            systemActive: settings.systemActive,
            searchOnlyMode: settings.searchOnlyMode,
            workHoursOnly: settings.workHoursOnly ?? true,
            workHoursStart: settings.workHoursStart ?? 9,
            workHoursEnd: settings.workHoursEnd ?? 18,
            skipWeekends: settings.skipWeekends ?? true,
            maxSearchesPerHour: settings.maxSearchesPerHour ?? 6,
            maxSearchesPerDay: settings.maxSearchesPerDay ?? 20,
            minDelayBetweenSearchesMinutes: settings.minDelayBetweenSearchesMinutes ?? 5,
            maxKeywordsPerCycle: settings.maxKeywordsPerCycle ?? 3
        };
    });
}
async function getActiveKeywords(userId) {
    return withRetry(async () => {
        const keywords = await prisma.keyword.findMany({
            where: {
                userId,
                active: true
            }
        });
        return keywords.map(k => ({
            id: k.id,
            keyword: k.keyword
        }));
    });
}
/**
 * Main entry point for the LinkedIn Worker logic.
 * This is exported so server.ts can run it in a managed background loop.
 */
async function startWorker() {
    console.log('\n🚀 LinkedIn Search-Only Worker logic - Running...\n');
    while (true) {
        try {
            await workerLoop();
        }
        catch (error) {
            const errorMsg = error?.message || String(error);
            console.error('\n💥 CRITICAL: Supervisor caught unhandled error in workerLoop:', errorMsg);
            try {
                await (0, worker_broadcast_1.broadcastError)(`Supervisor Restoring Worker: ${errorMsg}`);
            }
            catch { }
            console.log('🔄 Supervisor: Performing full cleanup and restarting in 30 seconds...\n');
            await cleanup().catch(() => { });
            await sleep(30000); // Backoff before restart
        }
    }
}
// Global process handlers for clean shutdown
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
});
process.on('uncaughtException', async (error) => {
    console.error('🚨 UNCAUGHT EXCEPTION:', error);
    if (error.message && error.message.includes('Prisma')) {
        console.log('Database connection error. Supervisor will attempt reconnect.');
    }
});
process.on("SIGINT", async () => {
    console.log('\n\n⏹️ Shutdown signal received...');
    await cleanup();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\n\n⏹️ Shutdown signal received...');
    await cleanup();
    process.exit(0);
});
// Guarded auto-start if run directly
if (require.main === module) {
    Promise.resolve().then(() => __importStar(require('dotenv/config'))).then(() => {
        startWorker().catch(err => {
            console.error('Fatal startup error:', err);
            process.exit(1);
        });
    });
}
