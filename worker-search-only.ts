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

import 'dotenv/config';
import { chromium, Browser, Page, BrowserContext } from 'playwright';
import { PrismaClient } from '@prisma/client';
import {
  setUserContext,
  setApiBaseUrl,
  broadcastStatus,
  broadcastAction,
  broadcastLog,
  broadcastError,
  broadcastScreenshot
} from './lib/worker-broadcast';

const prisma = new PrismaClient();

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface WorkerSettings {
  userId: string;
  linkedinSessionCookie: string;
  platformUrl: string;
  minLikes: number;
  maxLikes: number;
  minComments: number;
  maxComments: number;
  systemActive: boolean;
  searchOnlyMode: boolean;
  workHoursOnly: boolean;
  workHoursStart: number;
  workHoursEnd: number;
  skipWeekends: boolean;
  maxSearchesPerHour: number;
  maxSearchesPerDay: number;
  minDelayBetweenSearchesMinutes: number;
  maxKeywordsPerCycle: number;
}

interface KeywordData {
  id: string;
  keyword: string;
}

interface PostCandidate {
  url: string;
  author?: string;
  preview?: string;
  likes: number;
  comments: number;
}

// ============================================================================
// WORKER STATE
// ============================================================================

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let isRunning = false;
let currentUserId: string | null = null;
let currentSessionCookie: string | null = null;
let isAuthenticated = false;
let lastBrowserRestart = Date.now();

// ============================================================================
// DASHBOARD LOG MIRRORING (console -> SSE)
// ============================================================================

let dashboardLoggingEnabled = false;
const logBuffer: Array<{ level: 'info' | 'warn' | 'error'; message: string }> = [];
const MAX_BUFFERED_LOGS = 200;

function bufferLog(level: 'info' | 'warn' | 'error', message: string) {
  if (logBuffer.length >= MAX_BUFFERED_LOGS) logBuffer.shift();
  logBuffer.push({ level, message });
}

async function flushBufferedLogsToDashboard() {
  if (!dashboardLoggingEnabled) return;
  while (logBuffer.length > 0) {
    const item = logBuffer.shift();
    if (!item) break;
    await broadcastLog(item.message, item.level).catch(() => {});
  }
}

function enableDashboardConsoleMirroring() {
  if (dashboardLoggingEnabled) return;
  dashboardLoggingEnabled = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: any[]) => {
    originalLog(...args);
    try {
      const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      bufferLog('info', msg);
      // Fire-and-forget; do not await inside console methods
      void flushBufferedLogsToDashboard();
    } catch {}
  };

  console.warn = (...args: any[]) => {
    originalWarn(...args);
    try {
      const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      bufferLog('warn', msg);
      void flushBufferedLogsToDashboard();
    } catch {}
  };

  console.error = (...args: any[]) => {
    originalError(...args);
    try {
      const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      bufferLog('error', msg);
      void flushBufferedLogsToDashboard();
    } catch {}
  };
}

// ============================================================================
// MAIN WORKER LOOP
// ============================================================================

async function workerLoop() {
  console.log('\n🔍 LinkedIn Search-Only Worker - Starting...\n');
  console.log('📋 Mode: Search and save links ONLY (no auto-commenting)\n');

  await broadcastStatus('Starting search-only worker...');

  while (true) {
      // Phase 5: Self-healing periodic browser restart (every 4-6 hours)
      const browserAgeHours = (Date.now() - lastBrowserRestart) / (1000 * 60 * 60);
      if (browserAgeHours > 6) {
        console.log('\n🔄 Phase 5: Proactive browser restart to maintain stability (Age: ' + Math.round(browserAgeHours) + 'h)...\n');
        await cleanup().catch(() => {});
        lastBrowserRestart = Date.now();
      }
    try {
      // Fetch settings
      const settings = await getActiveUserSettings();

      if (!settings || !settings.systemActive) {
        if (isRunning) {
          console.log('⏸️  No active users. Pausing worker...\n');
          await cleanup();
        }
        await sleep(5000);
        continue;
      }

      // Check if search-only mode is enabled
      if (!settings.searchOnlyMode) {
        console.log('⚠️  Search-only mode is disabled. Please enable it in settings.\n');
        await broadcastError('Search-only mode is disabled. Enable it in dashboard settings.');
        await sleep(10000);
        continue;
      }

      // Check work hours (skip if outside working hours)
      if (settings.workHoursOnly && !isWithinWorkHours(settings)) {
        const msg = 'Outside work hours. Waiting until next work period...';
        console.log(`⏰ ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(300000); // Check again in 5 minutes
        continue;
      }

      // Check daily search limit
      const searchesToday = await getSearchCountInPeriod(settings.userId, 'day');
      if (searchesToday >= settings.maxSearchesPerDay) {
        const msg = `Daily limit reached (${searchesToday}/${settings.maxSearchesPerDay}). Resuming tomorrow.`;
        console.log(`⏹️  ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(3600000); // Check again in 1 hour
        continue;
      }

      // Check hourly search limit
      const searchesThisHour = await getSearchCountInPeriod(settings.userId, 'hour');
      if (searchesThisHour >= settings.maxSearchesPerHour) {
        const msg = `Hourly limit reached (${searchesThisHour}/${settings.maxSearchesPerHour}). Waiting...`;
        console.log(`⏳ ${msg}\n`);
        await broadcastStatus(msg);
        await sleep(600000); // Wait 10 minutes before retry
        continue;
      }

      // Set user context for broadcasts
      setUserContext(settings.userId);
      // Ensure broadcasts go to the correct deployed dashboard URL (prevents 404s)
      if (settings.platformUrl && settings.platformUrl.trim()) {
        setApiBaseUrl(settings.platformUrl.trim());
      } else if (process.env.NEXT_PUBLIC_APP_URL) {
        setApiBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
      }
      // Mirror worker terminal logs into the dashboard for this user/session
      // DISABLED to prevent broadcast flooding on Hugging Face
      // enableDashboardConsoleMirroring();

      // Initialize browser if needed
      if (!browser || currentUserId !== settings.userId || currentSessionCookie !== settings.linkedinSessionCookie) {
        console.log('🔄 User/session changed. Reinitializing browser...\n');
        
        if (browser) await cleanup();
        
        currentUserId = settings.userId;
        currentSessionCookie = settings.linkedinSessionCookie;
        
        await initializeBrowser();
        
        const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
        if (!authenticated) {
          await broadcastError('LinkedIn authentication failed. Please update your session cookie.');
          await sleep(30000);
          continue;
        }
        
        isAuthenticated = true;
        await broadcastStatus('✅ Authenticated - Ready to search');
      }

      // Fetch active keywords and shuffle them to ensure organic cycling over large lists
      let keywords = await getActiveKeywords(settings.userId);
      keywords = keywords.sort(() => Math.random() - 0.5); // Shuffle array
      
      if (keywords.length === 0) {
        console.log('⚠️  No active keywords. Waiting...\n');
        await broadcastLog('No active keywords configured. Add keywords in dashboard.');
        await sleep(10000);
        continue;
      }

      console.log(`📊 Processing ${keywords.length} keyword(s) (max ${settings.maxKeywordsPerCycle} per cycle)...\n`);
      await broadcastStatus(`Searching ${keywords.length} keyword(s)...`);

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

        await processKeyword(keyword, settings);
        
        // Conservative delay between searches (5-10 minutes)
        const delayMinutes = settings.minDelayBetweenSearchesMinutes;
        const delaySeconds = randomBetween(delayMinutes * 60, (delayMinutes + 5) * 60);
        console.log(`⏱️  Waiting ${Math.round(delaySeconds / 60)} min before next search (conservative mode)...\n`);
        await sleep(delaySeconds * 1000);
      }

      // Longer delay between cycles (10-15 minutes in conservative mode)
      const cycleDelayMinutes = randomBetween(10, 15);
      console.log(`\n✅ Cycle complete. Next cycle in ${cycleDelayMinutes} minutes.\n`);
      await broadcastStatus(`Cycle complete. Next run in ${cycleDelayMinutes}m`);
      await sleep(cycleDelayMinutes * 60 * 1000);

    } catch (error: any) {
      console.error('❌ Worker error:', error.message);
      await broadcastError(`Worker error: ${error.message}`);
      
      // Check for CAPTCHA / anti-bot signals and respond based on severity
      const detection = await detectCaptcha();
      if (detection.level === 'hard') {
        await handleCaptcha(detection);
      } else if (detection.level === 'soft') {
        console.log('⚠️ Soft anti-bot signal after error:', detection.reason);
        await broadcastLog('Soft anti-bot signal after error. Cooling down briefly.', 'warn');
        await sleep(180000); // 3 minute cool-down on soft signal
      } else {
        await sleep(60000); // Wait 1 minute on generic error
      }
    }
  }
}

// ============================================================================
// KEYWORD PROCESSING
// ============================================================================

async function processKeyword(keyword: KeywordData, settings: WorkerSettings) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Keyword: "${keyword.keyword}"`);
    console.log(`${'='.repeat(80)}\n`);

    await broadcastLog(`Searching for: "${keyword.keyword}"`);

    // =========================================================================
    // CONSTRAINT-DRIVEN EXTRACTION WITH INTELLIGENT FALLBACK
    // =========================================================================
    const SETTINGS_MIN_LIKES = settings.minLikes || 0;
    const SETTINGS_MAX_LIKES = settings.maxLikes || Infinity;
    const SETTINGS_MIN_COMMENTS = settings.minComments || 0;
    const SETTINGS_MAX_COMMENTS = settings.maxComments || Infinity;
    console.log(`\n[Constraints] Likes [${SETTINGS_MIN_LIKES}, ${SETTINGS_MAX_LIKES}] | Comments [${SETTINGS_MIN_COMMENTS}, ${SETTINGS_MAX_COMMENTS}]`);

    let allAggregatedPosts: PostCandidate[] = [];
    const seenUrls = new Set<string>();
    let totalSavedCount = 0;

    console.log(`\n🔄 Searching "${keyword.keyword}" (Top/Relevant)...`);
    await broadcastLog(`Starting search for "${keyword.keyword}"`);
    
    try {
      const postsRaw = await searchLinkedInPosts(keyword.keyword, null);
      
      for (const p of postsRaw) {
        if (!seenUrls.has(p.url)) {
          seenUrls.add(p.url);
          allAggregatedPosts.push(p);
        }
      }
      
      console.log(`✅ Discovered ${allAggregatedPosts.length} unique posts.\n`);
    } catch(err) {
      console.error(`❌ Search failed:`, err);
    }

    if (allAggregatedPosts.length > 0) {
      // Step 1: Exact constraint matches
      const exactMatches = allAggregatedPosts.filter(p =>
        p.likes >= SETTINGS_MIN_LIKES && p.likes <= SETTINGS_MAX_LIKES &&
        p.comments >= SETTINGS_MIN_COMMENTS && p.comments <= SETTINGS_MAX_COMMENTS
      );

      let postsToSave: PostCandidate[];

      if (exactMatches.length > 0) {
        postsToSave = [...exactMatches];
        console.log(`✅ ${exactMatches.length} posts EXACTLY match constraints.`);

        // Supplement with closest-match if sparse
        if (exactMatches.length < 10) {
          const exactUrls = new Set(exactMatches.map(p => p.url));
          const remaining = allAggregatedPosts.filter(p => !exactUrls.has(p.url));
          const scored = remaining.map(p => {
            let dev = 0;
            if (p.likes < SETTINGS_MIN_LIKES) dev += SETTINGS_MIN_LIKES - p.likes;
            else if (p.likes > SETTINGS_MAX_LIKES && isFinite(SETTINGS_MAX_LIKES)) dev += p.likes - SETTINGS_MAX_LIKES;
            if (p.comments < SETTINGS_MIN_COMMENTS) dev += SETTINGS_MIN_COMMENTS - p.comments;
            else if (p.comments > SETTINGS_MAX_COMMENTS && isFinite(SETTINGS_MAX_COMMENTS)) dev += p.comments - SETTINGS_MAX_COMMENTS;
            return { ...p, _dev: dev };
          }).sort((a, b) => a._dev - b._dev);

          const maxDev = Math.max(SETTINGS_MIN_LIKES, SETTINGS_MIN_COMMENTS, 5) * 0.5;
          const fallbacks = scored.filter(p => p._dev <= maxDev).slice(0, 10 - exactMatches.length);
          if (fallbacks.length > 0) {
            postsToSave.push(...fallbacks);
            console.log(`🔄 Added ${fallbacks.length} closest-match fallback posts.`);
          }
        }
      } else {
        // Zero exact matches — intelligent fallback
        console.log(`⚠️ 0 exact matches. Applying closest-match approximation...`);
        const scored = allAggregatedPosts.map(p => {
          let dev = 0;
          if (p.likes < SETTINGS_MIN_LIKES) dev += SETTINGS_MIN_LIKES - p.likes;
          else if (p.likes > SETTINGS_MAX_LIKES && isFinite(SETTINGS_MAX_LIKES)) dev += p.likes - SETTINGS_MAX_LIKES;
          if (p.comments < SETTINGS_MIN_COMMENTS) dev += SETTINGS_MIN_COMMENTS - p.comments;
          else if (p.comments > SETTINGS_MAX_COMMENTS && isFinite(SETTINGS_MAX_COMMENTS)) dev += p.comments - SETTINGS_MAX_COMMENTS;
          return { ...p, _dev: dev };
        }).sort((a, b) => a._dev - b._dev);

        const maxDev = Math.max(SETTINGS_MIN_LIKES, SETTINGS_MIN_COMMENTS, 10);
        postsToSave = scored.filter(p => p._dev <= maxDev);
        if (postsToSave.length === 0) {
          postsToSave = scored.slice(0, 10);
          console.log(`⚠️ No posts within fallback tolerance. Taking top ${postsToSave.length} closest.`);
        } else {
          console.log(`🔄 Selected ${postsToSave.length} via closest-match fallback.`);
        }
      }

      // Sort final batch by engagement (highest first)
      postsToSave.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments));

      const saveResults = await Promise.allSettled(
        postsToSave.map(post => savePostToDatabase(post, keyword.keyword, settings.userId))
      );
      totalSavedCount = saveResults.filter(
        r => r.status === 'fulfilled' && r.value === true
      ).length;

      console.log(`💾 Saved ${totalSavedCount} posts to dashboard\n`);
    }

    // Log this search for rate limit tracking
    await logSearch(settings.userId, keyword.keyword);

    console.log(`🎯 Secured ${totalSavedCount} posts for "${keyword.keyword}".\n`);
    await broadcastLog(`Secured ${totalSavedCount} posts for "${keyword.keyword}"`);

  } catch (error: any) {
    console.error(`❌ Error processing keyword "${keyword.keyword}":`, error.message);
    await broadcastError(`Failed to process "${keyword.keyword}": ${error.message}`);
  }
}

// ============================================================================
// LINKEDIN SEA// Maximum number of posts to collect per keyword search
const MAX_POSTS_PER_SEARCH = 100;

async function searchLinkedInPosts(keyword: string, filterParam: string | null = null): Promise<PostCandidate[]> {
  if (!page) throw new Error('Browser not initialized');

  try {
    let searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}`;
    if (filterParam === 'latest') {
      searchUrl += `&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted`;
    } else if (filterParam) {
      searchUrl += `&origin=GLOBAL_SEARCH_HEADER&sortBy=date_posted&f_TPR=${filterParam}`;
    } else {
      searchUrl += `&origin=GLOBAL_SEARCH_HEADER`;
    }

    console.log(`🔍 Navigating to search page...`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for first batch of results (exit early if they load fast)
    await page.waitForSelector(
      '.reusable-search__result-container, [data-urn*="activity"], [data-urn*="ugcPost"], [data-chameleon-result-urn]',
      { timeout: 12000 }
    ).catch(() => console.log('⚠️  Initial result containers slow — proceeding anyway...'));

    // ── Scroll loop: 7 rounds to load as many posts as possible ──────────────
    // After each scroll we wait for NEW content rather than a fixed delay,
    // so fast-loading pages don't waste time.
    console.log('📜 Scrolling deep to load maximum posts...');
    for (let round = 0; round < 25; round++) {
      // Scroll to bottom of the last visible result card (triggers infinite scroll)
      await page.evaluate(() => {
        const cards = document.querySelectorAll(
          '[role="listitem"], [data-view-name="feed-full-update"], .reusable-search__result-container, li.artdeco-card'
        );
        const last = cards[cards.length - 1];
        if (last) {
          last.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          window.scrollBy(0, 900);
        }
      });

      // Wait up to 3 s for new cards, then continue regardless
      await Promise.race([
        page.waitForSelector('[data-chameleon-result-urn], .reusable-search__result-container', {
          timeout: 3000
        }).catch(() => {}),
        sleep(1000)
      ]);
      await humanDelay(800, 1500);  // shorter than before but still human-like

      // Click "See more results" if visible
      const moreBtn = await page.$(
        'button.search-results-bottom-pagination__button, button[aria-label="See more results"]'
      ).catch(() => null);
      if (moreBtn) {
        await moreBtn.click().catch(() => {});
        await humanDelay(1500, 2500);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Check for CAPTCHA / anti-bot signals
    const detection = await detectCaptcha();
    if (detection.level === 'hard') {
      console.log('🚨 Hard CAPTCHA / checkpoint detected during search:', detection.reason);
      await broadcastError(`Hard CAPTCHA detected during search: ${detection.reason}`);
      throw new Error('HARD_CAPTCHA_DETECTED_DURING_SEARCH');
    } else if (detection.level === 'soft') {
      console.log('⚠️ Soft anti-bot signal during search:', detection.reason);
      await broadcastLog('Soft anti-bot signal during search. Backing off but continuing.', 'warn');
      await humanDelay(60000, 120000);
    }


    console.log(`📊 Extracting post data...`);

    // ── Extraction: plain JS string so esbuild never transforms it ────────────
    const postsRaw = await Promise.race([
      page.evaluate(`(function() {
        var MAX = ${MAX_POSTS_PER_SEARCH};
        var results = [];
        var seen = {}; var staleCount = 0;

        // ── Helpers ──────────────────────────────────────────────────────────
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
                    // Extract date for 6-month filtering
          var dateText = '';
          try {
            var dateEl = container.querySelector('.update-components-actor__sub-description, .entity-result__simple-insight, .entity-result__caption');
            dateText = (dateEl ? dateEl.innerText : '').toLowerCase();
            // Filter out posts older than 6 months (7mo, 8mo, 9mo, 10mo, 11mo, 12mo, 1y, 2y, etc.)
            if (dateText.match(/(\d+mo|[\d.]+y)/)) {
              var m = dateText.match(/(\d+)mo/);
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
      })()`) as Promise<any[]>,



      (async () => {
        await sleep(25000);
        throw new Error('EXTRACTION_TIMEOUT');
      })()
    ]).catch(async (err: any) => {
      console.log(`⚠️  Extraction script failed: ${err?.message || err}`);
      await broadcastScreenshot(page!, `Extraction failed: ${err?.message || err}`).catch(() => {});
      return [];
    });
    // ─────────────────────────────────────────────────────────────────────────

    const posts = (Array.isArray(postsRaw) ? postsRaw : []).map((p: any): PostCandidate => ({
      url: p.url,
      author: 'Unknown',
      preview: '',
      likes: typeof p.likes === 'number' ? p.likes : 0,
      comments: typeof p.comments === 'number' ? p.comments : 0
    }));

    // Phase 4: Extra wait for engagement counts to render fully before final extraction
    console.log('⏳ Waiting for engagement counts to render...');
    await sleep(15000);
    console.log('✅ Extracted ${posts.length} posts\n');
    if (posts.length > 0) {
      console.log(`📋 Sample: ${posts[0].url}`);
      console.log(`   Likes: ${posts[0].likes} | Comments: ${posts[0].comments}\n`);
    }

    return posts;

  } catch (error: any) {
    console.error('❌ Search error:', error.message);
    throw error;
  }
}

// ============================================================================
// RATE LIMITING & WORK HOURS
// ============================================================================

function isWithinWorkHours(settings: WorkerSettings): boolean {
  const now = new Date();
  
  if (settings.skipWeekends) {
    const day = now.getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) return false;
  }

  if (!settings.workHoursOnly) return true;

  const hour = now.getHours();
  return hour >= settings.workHoursStart && hour < settings.workHoursEnd;
}

async function getSearchCountInPeriod(userId: string, period: 'hour' | 'day'): Promise<number> {
  const since = new Date();
  if (period === 'hour') {
    since.setHours(since.getHours() - 1);
  } else {
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
}

async function logSearch(userId: string, keyword: string): Promise<void> {
  try {
    await prisma.log.create({
      data: {
        userId,
        action: 'SEARCH',
        postUrl: `search:${keyword}`
      }
    });
  } catch (err) {
    console.error('Failed to log search:', err);
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function savePostToDatabase(post: PostCandidate, keyword: string, userId: string): Promise<boolean> {
  try {
    // Robust URL validation and sanitization
    let cleanUrl = post.url;
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = `https://www.linkedin.com${cleanUrl.startsWith('/') ? '' : '/'}${cleanUrl}`;
    }
    try {
      new URL(cleanUrl); // Throws if completely invalid
    } catch {
      console.log(`⚠️ Invalid URL detected and discarded: ${cleanUrl}`);
      return false;
    }

    // Check if post already exists
    const existing = await prisma.savedPost.findFirst({
      where: {
        userId,
        postUrl: cleanUrl
      }
    });

    if (existing) {
      return false; // Already saved
    }

    // Save new post
    await prisma.savedPost.create({
      data: {
        userId,
        postUrl: cleanUrl,
        postAuthor: post.author,
        postPreview: post.preview,
        likes: post.likes,
        comments: post.comments,
        keyword,
        visited: false
      }
    });

    return true;

  } catch (error: any) {
    console.error('❌ Database save error:', error.message);
    return false;
  }
}

// Return ALL posts with engagement sorted by closeness to target reach.
// No arbitrary cap — the caller decides how many to use.
function getClosestByReach(
  posts: PostCandidate[],
  settings: WorkerSettings
): PostCandidate[] {
  const targetLikes = settings.minLikes;
  const targetComments = settings.minComments;

  return posts
    // Exclude posts with zero engagement (likely no data, not genuine zeros)
    .filter(p => p.likes > 0 || p.comments > 0)
    .map(p => {
      const likeDiff = Math.abs(p.likes - targetLikes);
      const commentDiff = Math.abs(p.comments - targetComments);
      return { post: p, distance: likeDiff + commentDiff };
    })
    .sort((a, b) => a.distance - b.distance)
    .map(x => x.post);
}

// ============================================================================
// BROWSER MANAGEMENT WITH STEALTH
// ============================================================================

async function initializeBrowser() {
  console.log('🌐 Initializing stealth browser...\n');

  // Determine headless mode from environment:
  // - HEADLESS="true"  -> run headless
  // - HEADLESS="false" -> run headed (visible)
  // - not set          -> default to headless (safe for demos / local runs)
  const headlessEnv = (process.env.HEADLESS || '').toLowerCase();
  const isHeadless = headlessEnv !== 'false';

  browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion',
      '--disable-site-isolation-trials',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Appear more human-like
      '--window-size=1920,1080',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ]
  });

  // Create stealth context
  context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: [],
    // Add realistic browser properties
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light'
  });

  // Advanced stealth scripts
  await context.addInitScript(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });

    // Fix Chrome detection
    (window as any).chrome = {
      runtime: {}
    };

    // Add realistic plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Fix permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) => (
      parameters.name === 'notifications' 
        ? Promise.resolve({ state: 'denied' } as PermissionStatus)
        : originalQuery(parameters)
    );

    // Add realistic language
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });

  page = await context.newPage();

  // Dismiss any dialogs
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));

  isRunning = true;
  console.log('✅ Stealth browser initialized\n');
}

async function authenticateLinkedIn(sessionCookie: string): Promise<boolean> {
  if (!page || !context) throw new Error('Browser not initialized');

  try {
    console.log('🔐 Authenticating LinkedIn session...');

    // Set LinkedIn cookie
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

    // Navigate to feed with human-like delay
    await humanDelay(2000, 4000);
    
    await page.goto('https://www.linkedin.com/feed', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await humanDelay(3000, 5000);

    // Check authentication
    const currentUrl = page.url();
    const isAuthenticated = await page.evaluate(() => {
      if (!window.location.hostname.includes('linkedin.com')) return false;
      if (window.location.pathname.includes('/login')) return false;
      if (window.location.pathname.includes('/checkpoint')) return false;
      
      // Check for navigation elements
      const hasNav = document.querySelector('nav[aria-label="Primary Navigation"], .global-nav');
      return !!hasNav;
    });

    if (isAuthenticated) {
      console.log('✅ LinkedIn authentication successful\n');
      await broadcastScreenshot(page, 'Authenticated on LinkedIn');

      // Warm up session with human-like browsing before searches
      await warmUpSession();

      return true;
    } else {
      console.log('❌ LinkedIn authentication failed\n');
      await broadcastScreenshot(page, 'Authentication failed');
      return false;
    }

  } catch (error: any) {
    console.error('❌ Authentication error:', error.message);
    return false;
  }
}

// ============================================================================
// CAPTCHA DETECTION & HANDLING
// ============================================================================

type CaptchaLevel = 'none' | 'soft' | 'hard';

interface CaptchaDetection {
  level: CaptchaLevel;
  reason: string;
  url?: string;
  title?: string;
  snippet?: string;
}

async function detectCaptcha(): Promise<CaptchaDetection> {
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

      const isCheckpoint =
        path.includes('/checkpoint') ||
        path.includes('/authwall') ||
        url.includes('checkpoint') ||
        url.includes('authwall');

      const hasCaptchaElement = !!document.querySelector(
        'iframe[src*=\"captcha\"], iframe[src*=\"recaptcha\"], div[id*=\"captcha\"], div[class*=\"captcha\"]'
      );

      const strongPhrases = [
        "let's do a quick security check",
        'unusual activity on your account',
        'to help keep your account safe',
        'we detected suspicious activity',
        'we’ve detected suspicious activity',
        'to continue, please verify your identity'
      ];

      const hasStrongPhrase = strongPhrases.some((phrase) =>
        rawText.includes(phrase.toLowerCase())
      );

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

    let level: CaptchaLevel = 'none';
    let reason = 'no captcha indicators';

    if (info.isCheckpoint || info.hasCaptchaElement) {
      level = 'hard';
      reason = 'checkpoint or captcha element detected';
    } else if (info.hasStrongPhrase) {
      level = 'soft';
      reason = 'strong anti-bot phrase detected';
    }

    if (level !== 'none') {
      console.log('\\n🚨 CAPTCHA / anti-bot signal detected');
      console.log(`   URL: ${info.url}`);
      console.log(`   Title: ${info.title}`);
      console.log(`   Reason: ${reason}`);
      console.log('   Snippet:', info.textSnippet?.slice(0, 200), '\\n');

      await broadcastScreenshot(page, 'CAPTCHA / anti-bot signal detected').catch(() => {});
      await broadcastLog(
        `CAPTCHA / anti-bot signal (${level}): ${reason} at ${info.url}`,
        level === 'hard' ? 'error' : 'warn'
      ).catch(() => {});
    }

    return {
      level,
      reason,
      url: info.url,
      title: info.title,
      snippet: info.textSnippet
    };
  } catch (err: any) {
    console.error('detectCaptcha error:', err?.message || err);
    return { level: 'none', reason: 'detection-error' };
  }
}

async function handleCaptcha(detection: CaptchaDetection) {
  console.log('\\n🚨 HARD CAPTCHA / CHECKPOINT DETECTED\\n');
  console.log('   The system has paused to avoid further detection.');
  console.log('   Please check the browser window for any security prompts or challenges.');
  console.log('   A longer cool-down will be applied before resuming.\\n');

  await broadcastError(
    `⚠️ Hard CAPTCHA detected (${detection.reason}). Worker entering extended cool-down.`
  );

  // Longer cool-down for hard blocks (e.g. 20 minutes)
  const cooldownMinutes = 20;
  await broadcastStatus(`Hard CAPTCHA cool-down for ${cooldownMinutes} minutes`);
  await sleep(cooldownMinutes * 60 * 1000);

  console.log('⏰ Exiting hard CAPTCHA cool-down. Worker will cautiously resume.\n');
  await broadcastStatus('Exiting hard CAPTCHA cool-down. Worker will cautiously resume.');
}

// ============================================================================
// HUMAN-LIKE BEHAVIOR UTILITIES
// ============================================================================

async function humanDelay(minMs: number, maxMs: number) {
  const delay = randomBetween(minMs, maxMs);
  await sleep(delay);
}

async function humanScroll(page: Page) {
  try {
    // Random scroll patterns
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
    
    // Scroll back up
    await page.evaluate(() => {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    });
    
  } catch {
    // Ignore scroll errors
  }
}

async function warmUpSession() {
  if (!page) return;

  try {
    console.log('🧊 Warming up LinkedIn session on feed...');

    // Scroll the feed a bit to look like a real user
    await humanScroll(page);
    await humanDelay(3000, 6000);

    // Optionally open 1–2 posts or profiles in the same tab
    const candidateLinks = await page.$$(
      'a[href*="/feed/update/"], a[href*="/in/"]:not([href*="miniProfileUrn"])'
    );

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
      } catch {
        // Ignore single-link failures and continue
      }
    }

    console.log('✅ Warm-up sequence complete.\n');
  } catch (err: any) {
    console.log('Warm-up sequence error (non-fatal):', err?.message || err);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');

  if (page) {
    await page.close().catch(() => {});
    page = null;
  }

  if (context) {
    await context.close().catch(() => {});
    context = null;
  }

  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }

  await prisma.$disconnect();

  isRunning = false;
  isAuthenticated = false;
  
  console.log('✅ Cleanup complete\n');
}

// ============================================================================
// DATABASE QUERIES
// ============================================================================

async function getActiveUserSettings(): Promise<WorkerSettings | null> {
  const settings = await prisma.settings.findFirst({
    where: { systemActive: true },
    include: { user: true }
  });

  if (!settings) return null;

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
}

async function getActiveKeywords(userId: string): Promise<KeywordData[]> {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  if (!settings || !settings.searchConfigJson) return [];
  
  try {
    const parsed = JSON.parse(settings.searchConfigJson);
    let rawList: string[] = [];
    if (Array.isArray(parsed)) {
      rawList = parsed.flat(Infinity);
    }
    const cleanList = rawList.filter(k => typeof k === 'string' && k.trim().length > 0);
    return cleanList.map((k, i) => ({ id: `kw-${i}`, keyword: k.trim() }));
  } catch(e) {
    return [];
  }
}

async function isSystemStillActive(userId: string): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { userId }
  });

  return settings?.systemActive ?? false;
}

// ============================================================================
// STARTUP
// ============================================================================


// ============================================================================
// SUPERVISOR & ERROR HANDLING (Phase 5)
// ============================================================================

async function main() {
  console.log('\n🚀 LinkedIn Search-Only Worker Supervisor - Starting...\n');
  
  while (true) {
    try {
      await workerLoop();
    } catch (error: any) {
      const errorMsg = error?.message || String(error);
      console.error('\n💥 CRITICAL: Supervisor caught unhandled error in workerLoop:', errorMsg);
      try {
        await broadcastError(`Supervisor Restoring Worker: ${errorMsg}`);
      } catch {}
      
      console.log('🔄 Supervisor: Performing full cleanup and restarting in 30 seconds...\n');
      await cleanup().catch(() => {});
      await sleep(30000); // Backoff before restart
    }
  }
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  // Log and keep process alive - Supervisor or next cycle will handle it
});

process.on('uncaughtException', async (error) => {
  console.error('🚨 UNCAUGHT EXCEPTION:', error);
  // Controlled shutdown and let Supervisor-level or OS-level restarts handle it if possible
  // For now, we try to cleanup and let the while(true) in main carry on if it's a non-fatal process error
  if (error.message && error.message.includes('Prisma')) {
    console.log('Database connection error. Supervisor will attempt reconnect.');
  }
});

process.on("SIGINT", async () => {
  console.log('\n\n⏹️  Shutdown signal received...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⏹️  Shutdown signal received...');
  await cleanup();
  process.exit(0);
});

main().catch(async (error) => {
  console.error('💥 Fatal error:', error);
  await cleanup();
  process.exit(1);
});