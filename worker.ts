/**
 * LinkedIn Automation Worker - Complete Rebuild
 * 
 * Architecture:
 * - Strict keyword-comment matching (no cross-contamination)
 * - Transparent post selection (closest to minimum reach)
 * - Verified success only (comment must appear in DOM)
 * - Real-time dashboard updates (live SSE streaming)
 * - Headed browser mode (visible automation)
 * 
 * Flow:
 * 1. Fetch active keywords with their comments
 * 2. For each keyword:
 *    - Search LinkedIn
 *    - Collect posts with engagement metrics
 *    - Filter by reach (min/max likes & comments)
 *    - Select closest to minimum reach
 *    - Post comment (type, submit, verify)
 *    - Broadcast success/failure in real-time
 * 3. Wait 2 seconds between keywords
 * 4. Repeat cycle
 */

import 'dotenv/config'; // MUST be first — loads DATABASE_URL before PrismaClient initializes
import { chromium, Browser, Page } from 'playwright';
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
}

interface KeywordData {
  id: string;
  keyword: string;
  comments: CommentData[];
}

interface CommentData {
  id: string;
  text: string;
}

interface PostCandidate {
  url: string;
  likes: number;
  comments: number;
  distance: number; // Distance from minimum reach
}

interface ProcessingResult {
  success: boolean;
  keyword: string;
  commentText?: string;
  postUrl?: string;
  commentUrl?: string;
  reason?: string;
  selectedPost?: {
    likes: number;
    comments: number;
  };
}

// ============================================================================
// WORKER STATE
// ============================================================================

let browser: Browser | null = null;
let page: Page | null = null;
let isRunning = false;
let currentUserId: string | null = null;
let currentSessionCookie: string | null = null; // Track current session
let isAuthenticated = false; // Global auth state

// ============================================================================
// MAIN WORKER LOOP
// ============================================================================

async function main() {
  console.log('\n🚀 LinkedIn Automation Worker - Starting...\n');

  try {
    // Initialize browser
    await initializeBrowser();

    // Main loop
    while (isRunning) {
      try {
        // Fetch active user settings
        const settings = await getActiveUserSettings();

        if (!settings) {
          console.log('⏸️  No active user found. Waiting...');
          isAuthenticated = false;
          await sleep(10000); // Wait 10 seconds
          continue;
        }

        // Check if user or session changed - recreate browser context if needed
        const sessionChanged = currentUserId !== settings.userId ||
          currentSessionCookie !== settings.linkedinSessionCookie;

        if (sessionChanged && currentUserId !== null) {
          console.log('🔄 User or session changed. Recreating browser context...');
          await recreateBrowserContext();
          isAuthenticated = false; // Force re-auth on session change
        }

        // Set user context for broadcasts
        currentUserId = settings.userId;
        currentSessionCookie = settings.linkedinSessionCookie;
        setUserContext(settings.userId);
        if (settings.platformUrl) {
          setApiBaseUrl(settings.platformUrl);
        }

        // Authenticate only once per session (not every cycle)
        if (!isAuthenticated) {
          const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
          if (!authenticated) {
            await broadcastError('LinkedIn authentication failed. Please update your session cookie.');
            await sleep(60000); // Wait 1 minute before retry
            continue;
          }
          isAuthenticated = true;
        }

        await broadcastStatus('RUNNING', { message: 'Worker is active and processing keywords' });

        // Fetch active keywords with their comments
        const keywords = await getActiveKeywords(settings.userId);

        if (keywords.length === 0) {
          console.log('⏸️  No active keywords found. Waiting...');
          await broadcastLog('No active keywords found. Add keywords to start automation.');
          await sleep(5000); // Wait 5 seconds
          continue;
        }

        console.log(`\n📋 Found ${keywords.length} active keyword(s) to process\n`);

        // Process each keyword
        for (const keyword of keywords) {
          // Safety check: Ensure page is still valid
          if (!page || page.isClosed()) {
            console.log('   ⚠️ Browser page closed during cycle. Recreating context...');
            await recreateBrowserContext();
            isAuthenticated = false; // Need re-auth
            await authenticateLinkedIn(settings.linkedinSessionCookie);
            isAuthenticated = true;
          }

          // Check if still active
          const stillActive = await isSystemStillActive(settings.userId);
          if (!stillActive) {
            console.log('⏸️  System deactivated by user. Stopping...');
            await broadcastStatus('STOPPED', { message: 'Worker stopped by user' });
            isRunning = false;
            break;
          }

          // Process single keyword
          let result: ProcessingResult;
          try {
            result = await processKeyword(keyword, settings);
          } catch (error: any) {
            // Other errors - log and continue
            result = {
              success: false,
              keyword: keyword.keyword,
              reason: error.message
            };
          }

          // Log result to database
          await logResult(result, settings.userId);

          // Broadcast result
          if (result.success) {
            await broadcastAction('COMMENT_POSTED', {
              keyword: result.keyword,
              postUrl: result.postUrl,
              commentUrl: result.commentUrl,
              commentText: result.commentText,
              selectedPost: result.selectedPost
            });
          } else {
            await broadcastError(`Failed to process keyword "${result.keyword}": ${result.reason}`);
          }

          // Wait 2 seconds before next keyword
          await sleep(2000);
        }

        console.log('\n✅ Cycle complete. Starting next cycle...\n');
        await sleep(2000); // Max 2 seconds between cycles

      } catch (error: any) {
        console.error('❌ Error in worker loop:', error);
        await broadcastError(`Worker error: ${error.message}`);
        await sleep(5000); // Wait 5 seconds on error
      }
    }

  } catch (error: any) {
    console.error('❌ Fatal worker error:', error);
    await broadcastError(`Fatal error: ${error.message}`);
  } finally {
    await cleanup();
  }
}

// ============================================================================
// KEYWORD PROCESSING
// ============================================================================

async function processKeyword(
  keywordData: KeywordData,
  settings: WorkerSettings
): Promise<ProcessingResult> {
  const { keyword, comments } = keywordData;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📍 Processing Keyword: "${keyword}"`);
  console.log(`${'='.repeat(80)}\n`);

  try {
    // Validate keyword has comments
    if (comments.length === 0) {
      console.log(`⚠️  No comments found for keyword "${keyword}". Skipping.`);
      return {
        success: false,
        keyword,
        reason: 'No comments associated with this keyword'
      };
    }

    // Broadcast action
    await broadcastAction('PROCESSING_KEYWORD', { keyword, commentCount: comments.length });

    // Step 1: Search LinkedIn for keyword
    console.log(`🔍 Searching LinkedIn for: "${keyword}"`);
    await broadcastLog(`Searching LinkedIn for keyword: "${keyword}"`);

    const posts = await searchLinkedInPosts(keyword);

    if (posts.length === 0) {
      console.log(`⚠️  No posts found for keyword "${keyword}". Skipping.`);
      await broadcastLog(`No posts found for keyword "${keyword}"`, 'warn');
      return {
        success: false,
        keyword,
        reason: 'No posts found on LinkedIn for this keyword'
      };
    }

    console.log(`✅ Found ${posts.length} posts`);

    // Step 2: Filter posts by reach criteria
    console.log(`\n📊 Filtering posts by reach criteria:`);
    console.log(`   Min Likes: ${settings.minLikes} | Max Likes: ${settings.maxLikes}`);
    console.log(`   Min Comments: ${settings.minComments} | Max Comments: ${settings.maxComments}`);

    const filteredPosts = filterPostsByReach(posts, settings);

    // Filter out invalid posts (0 engagement)
    const validPosts = posts.filter(p => p.likes > 0 || p.comments > 0);
    const validFilteredPosts = filteredPosts.filter(p => p.likes > 0 || p.comments > 0);

    // Determine which posts to use
    let postsToCommentOn: PostCandidate[] = [];
    if (validFilteredPosts.length > 0) {
      postsToCommentOn = validFilteredPosts;
      console.log(`   ✅ Found ${validFilteredPosts.length} posts matching criteria`);
    } else if (validPosts.length > 0) {
      postsToCommentOn = validPosts;
      console.log(`   ⚠️  No posts matched strict criteria. Using ${validPosts.length} available posts.`);
    } else {
      console.log(`   ❌ No valid posts found (all had 0 engagement).`);
      await broadcastLog(`No valid posts found for "${keyword}"`, 'warn');
      return {
        success: false,
        keyword,
        reason: 'No valid posts found (all had 0 engagement)'
      };
    }

    // Sort posts by distance from target (closest first)
    const targetLikes = settings.minLikes;
    const targetComments = settings.minComments;
    postsToCommentOn = postsToCommentOn.map(post => ({
      ...post,
      distance: Math.abs(post.likes - targetLikes) + Math.abs(post.comments - targetComments)
    })).sort((a, b) => a.distance - b.distance);

    console.log(`\n📝 Will post comments on ${postsToCommentOn.length} posts:\n`);
    postsToCommentOn.forEach((post, i) => {
      console.log(`   [${i + 1}] 👍 ${post.likes} | 💬 ${post.comments} | Distance: ${post.distance}`);
    });

    // Step 3: Post comment on EACH found post
    let successCount = 0;
    let failCount = 0;
    const results: Array<{ success: boolean; postUrl: string; reason?: string; commentUrl?: string }> = [];

    for (let i = 0; i < postsToCommentOn.length; i++) {
      const post = postsToCommentOn[i];
      
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`📍 Post ${i + 1} of ${postsToCommentOn.length}`);
      console.log(`${'─'.repeat(60)}`);

      // Select random comment from keyword's comments
      const randomComment = comments[Math.floor(Math.random() * comments.length)];
      console.log(`💬 Selected Comment: "${randomComment.text.substring(0, 50)}..."`);

      // Post comment and verify
      await broadcastLog(`Posting comment on post ${i + 1}/${postsToCommentOn.length}...`);
      const commentResult = await postAndVerifyComment(post.url, randomComment.text);

      if (commentResult.success) {
        successCount++;
        console.log(`   ✅ SUCCESS! Comment posted and verified`);
        
        // Update comment usage count
        await prisma.comment.update({
          where: { id: randomComment.id },
          data: { timesUsed: { increment: 1 } }
        });

        results.push({
          success: true,
          postUrl: post.url,
          commentUrl: commentResult.commentUrl
        });

        // Broadcast individual success
        await broadcastAction('COMMENT_POSTED', {
          keyword,
          postUrl: post.url,
          commentUrl: commentResult.commentUrl,
          commentText: randomComment.text,
          selectedPost: { likes: post.likes, comments: post.comments }
        });
      } else {
        failCount++;
        console.log(`   ❌ FAILED: ${commentResult.reason}`);
        results.push({
          success: false,
          postUrl: post.url,
          reason: commentResult.reason
        });
      }

      // Wait 3 seconds between posts to avoid rate limiting
      if (i < postsToCommentOn.length - 1) {
        console.log(`   ⏳ Waiting 3 seconds before next post...`);
        await sleep(3000);
      }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SUMMARY for keyword "${keyword}":`);
    console.log(`   ✅ Successful: ${successCount}/${postsToCommentOn.length}`);
    console.log(`   ❌ Failed: ${failCount}/${postsToCommentOn.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Return overall success if at least one comment was posted
    if (successCount > 0) {
      const firstSuccess = results.find(r => r.success);
      return {
        success: true,
        keyword,
        commentText: `Posted on ${successCount} posts`,
        postUrl: firstSuccess!.postUrl,
        commentUrl: firstSuccess!.commentUrl,
        selectedPost: {
          likes: postsToCommentOn[0].likes,
          comments: postsToCommentOn[0].comments
        }
      };
    } else {
      return {
        success: false,
        keyword,
        reason: `Failed to post on all ${postsToCommentOn.length} posts`
      };
    }

  } catch (error: any) {
    console.error(`❌ Error processing keyword "${keyword}":`, error);
    return {
      success: false,
      keyword,
      reason: error.message
    };
  }
}

// ============================================================================
// CAPTCHA HANDLING - PAUSE AND RESUME
// ============================================================================

async function waitForCaptchaResolution(): Promise<void> {
  if (!page) return;

  console.log('\n' + '='.repeat(80));
  console.log('⏸️  WORKER PAUSED - CAPTCHA DETECTED');
  console.log('='.repeat(80));
  console.log('\n🚨 LinkedIn has shown a CAPTCHA challenge.\n');
  console.log('📋 INSTRUCTIONS:');
  console.log('   1. The browser window is still open');
  console.log('   2. Solve the CAPTCHA manually in the browser');
  console.log('   3. Wait for LinkedIn to load normally');
  console.log('   4. The worker will automatically detect when CAPTCHA is resolved');
  console.log('   5. Automation will resume from where it stopped\n');
  console.log('⏳ Checking every 10 seconds for CAPTCHA resolution...\n');

  // Broadcast paused status
  await broadcastStatus('PAUSED', { 
    message: 'CAPTCHA detected - Waiting for manual resolution',
    action: 'Solve CAPTCHA in the browser window'
  });
  await broadcastError('CAPTCHA detected! Please solve it manually in the browser. Worker is paused and will resume automatically.');

  let checkCount = 0;
  const maxWaitTime = 30 * 60 * 1000; // Wait up to 30 minutes
  const checkInterval = 10000; // Check every 10 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    checkCount++;
    await sleep(checkInterval);

    try {
      // Check if CAPTCHA is still present
      const stillHasCaptcha = await page.evaluate(() => {
        return document.body.innerText.includes('CAPTCHA') || 
               document.body.innerText.includes('security verification') ||
               document.body.innerText.includes('Let\'s do a quick security check') ||
               !!document.querySelector('iframe[src*="captcha"]');
      }).catch(() => true); // If error, assume CAPTCHA still there

      if (!stillHasCaptcha) {
        // CAPTCHA resolved! Verify session is still valid
        console.log('\n✅ CAPTCHA appears to be resolved!');
        console.log('   Verifying LinkedIn session...');

        const sessionValid = await verifyLinkedInSession();
        
        if (sessionValid) {
          console.log('   ✅ LinkedIn session is valid');
          console.log('\n' + '='.repeat(80));
          console.log('▶️  WORKER RESUMING - CAPTCHA RESOLVED');
          console.log('='.repeat(80) + '\n');
          
          await broadcastStatus('RUNNING', { message: 'CAPTCHA resolved - Worker resumed' });
          await broadcastLog('CAPTCHA resolved! Worker is resuming automation.');
          
          return; // Resume normal operation
        } else {
          console.log('   ⚠️  Session appears invalid, waiting...');
        }
      } else {
        const elapsed = Math.round((Date.now() - startTime) / 1000 / 60);
        console.log(`   ⏳ Check #${checkCount}: CAPTCHA still present (${elapsed} min elapsed)`);
      }
    } catch (error: any) {
      console.log(`   ⚠️  Error checking CAPTCHA status: ${error.message}`);
    }
  }

  // Timeout reached
  console.log('\n⚠️  CAPTCHA resolution timeout (30 minutes)');
  console.log('   Please restart the worker after solving CAPTCHA\n');
  
  await broadcastError('CAPTCHA resolution timeout. Please restart the worker.');
  await broadcastStatus('STOPPED', { message: 'CAPTCHA timeout - manual restart required' });
  
  throw new Error('CAPTCHA resolution timeout');
}

async function verifyLinkedInSession(): Promise<boolean> {
  if (!page) return false;

  try {
    // Check if we're on LinkedIn and logged in
    const isValid = await page.evaluate(() => {
      // Check for LinkedIn domain
      if (!window.location.hostname.includes('linkedin.com')) return false;
      
      // Check for logged-in indicators
      const loggedInIndicators = [
        '.global-nav__me',
        '[data-control-name="identity_profile_photo"]',
        'button[aria-label*="View profile"]',
        '.feed-identity-module'
      ];
      
      for (const selector of loggedInIndicators) {
        if (document.querySelector(selector)) return true;
      }
      
      return false;
    }).catch(() => false);

    return isValid;
  } catch (error) {
    return false;
  }
}

// ============================================================================
// LINKEDIN AUTOMATION FUNCTIONS
// ============================================================================

async function searchLinkedInPosts(keyword: string): Promise<PostCandidate[]> {
  // Stability check: Ensure browser and page are healthy
  if (!browser || !page || page.isClosed()) {
    console.log('   ⚠️ Browser or page invalid for search. Re-initializing...');
    await recreateBrowserContext().catch(() => { });
    if (!page) throw new Error('Could not initialize page for search');
  }

  try {
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=date_posted`;
    console.log(`\n🔍 Searching LinkedIn for: "${keyword}"`);
    console.log(`   Navigating to: ${searchUrl}`);

    // Navigate - 'commit' fires immediately when HTTP headers arrive, avoids hanging on slow pages
    await page.goto(searchUrl, { waitUntil: 'commit', timeout: 30000 }).catch(err => {
      if (err.message.includes('closed') || err.message.includes('context')) {
        throw new Error('BROWSER_CLOSED');
      }
      // Timeout or other nav error — page may still have partially loaded, continue anyway
      console.log(`   ⚠️ Navigation note: ${err.message.split('\n')[0]}`);
    });

    // Wait for the main results container to appear
    await page.waitForSelector('.reusable-search__result-container, .entity-result, [data-chameleon-result-urn]', { timeout: 20000 })
      .catch(() => console.log('   ⚠️ Result containers not found in 20s, attempting extraction anyway...'));

    await sleep(1000);

    // Scroll down to trigger lazy-loading of results
    console.log(`   Scrolling to load more results...`);
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 1000)').catch(() => { });
      await sleep(1200);

      // Click "More results" button if present
      const moreBtn = await page.$('button.search-results-bottom-pagination__button, button[aria-label="See more results"]').catch(() => null);
      if (moreBtn) {
        console.log(`   [Scroll] Clicking "See more results"...`);
        await moreBtn.click().catch(() => { });
        await sleep(2000);
      }
    }

    // Capture state for diagnostics
    await broadcastScreenshot(page, `Search: ${keyword}`);

    // SUPER SCRAPER SCRIPT - Ultra-resilient extraction with multiple fallback strategies
    const superScraper = String.raw`
      (function() {
        var results = [];
        var seenUrls = {};
        
        // Initialize diagnostics FIRST
        window.__scraperDiagnostics = {
          containerCount: 0,
          totalExtracted: 0,
          pageTitle: document.title,
          noResultsFound: false,
          methods: {},
          phase1Details: {
            containersFound: 0,
            containersWithLinks: 0,
            linksRejectedByValidation: 0,
            linksDuplicate: 0,
            linksAccepted: 0
          },
          phase2Details: {
            linksFound: 0,
            linksRejectedByValidation: 0,
            linksDuplicate: 0,
            linksAccepted: 0
          },
          rejectionReasons: [],
          sampleRejectedUrls: []
        };
        
        // URL validation - accept LinkedIn post URLs, reject invalid pages
        function isValidPostUrl(url) {
          // Reject known invalid pages
          var invalidPatterns = [
            '/premium/products',
            '/premium/?',
            '/feed/?',
            '/feed?',
            '/search/',
            '/mynetwork/',
            '/messaging/',
            '/notifications/',
            '/jobs/view/',
            '/jobs/',
            '/company/[^/]+/?$', // Company root (no post ID)
            '/learning/'
          ];
          
          // Check invalid patterns
          for (var i = 0; i < invalidPatterns.length; i++) {
            if (url.indexOf(invalidPatterns[i]) !== -1 || new RegExp(invalidPatterns[i]).test(url)) {
              console.log('[Validation] REJECTED (invalid): ' + url.substring(0, 80));
              return false;
            }
          }
          
          // Accept if URL contains post indicators
          var validPatterns = [
            '/posts/',
            '/feed/update/urn:li:activity:',
            '/feed/update/urn:li:ugcPost:',
            'activity-',
            'ugcPost-'
          ];
          
          for (var i = 0; i < validPatterns.length; i++) {
            if (url.indexOf(validPatterns[i]) !== -1) {
              console.log('[Validation] ACCEPTED: ' + url.substring(0, 80));
              return true;
            }
          }
          
          console.log('[Validation] REJECTED (no post indicator): ' + url.substring(0, 80));
          return false;
        }
        
        function parseNum(t) {
          if (!t) return 0;
          var c = t.toLowerCase().replace(/,/g, '').trim();
          var match = c.match(/([\\d\\.\\,]+)/);
          if (!match) return 0;
          var n = parseFloat(match[1].replace(/,/g, ''));
          if (c.indexOf('k') !== -1) n *= 1000;
          if (c.indexOf('m') !== -1) n *= 1000000;
          return Math.round(n);
        }

        // --- PHASE 1: Container-based extraction (Primary Method) ---
        // UPDATED: Based on actual LinkedIn HTML structure (from link.txt analysis)
        var containers = Array.from(document.querySelectorAll(
          'li.artdeco-card, ' +                                    // NEW: Primary container (from link.txt)
          '.feed-shared-update-v2[data-urn], ' +                   // NEW: Direct feed updates with URN
          '.reusable-search__result-container, ' +
          '.entity-result, ' +
          '[data-chameleon-result-urn], ' +
          'li.reusable-search__result-container, ' +
          'div.search-results__cluster-content > div, ' +
          'div[class*="search-result"], ' +
          '.scaffold-finite-scroll__content > div > div'
        ));
        
        console.log('[Scraper] Found ' + containers.length + ' containers');
        
        containers.forEach(function(container, idx) {
          // CRITICAL: Skip job posts - they have specific markers
          var isJobPost = container.querySelector('.job-card-container, [data-job-id], a[href*="/jobs/view/"]') !== null;
          if (isJobPost) {
            console.log('[Scraper] Container ' + idx + ' is a job post, skipping');
            return;
          }
          
          // BREAKTHROUGH FIX: LinkedIn uses data-urn attributes, NOT href links!
          // Look for: <div data-urn="urn:li:activity:123456789">
          var urnElement = container.querySelector('[data-urn*="activity"], [data-urn*="ugcPost"]');
          
          if (!urnElement) {
            console.log('[Scraper] No data-urn found in container ' + idx);
            return;
          }
          
          // Extract URN from data-urn attribute
          var urn = urnElement.getAttribute('data-urn');
          if (!urn || (urn.indexOf('urn:li:activity:') === -1 && urn.indexOf('urn:li:ugcPost:') === -1)) {
            console.log('[Scraper] Invalid URN in container ' + idx + ': ' + urn);
            return;
          }
          
          // Build post URL from URN
          var href = 'https://www.linkedin.com/feed/update/' + urn;
          console.log('[Scraper] Extracted post via URN in container ' + idx + ': ' + href.substring(0, 80));
          
          window.__scraperDiagnostics.phase1Details.containersWithLinks++;
          
          // STRICT VALIDATION: Only accept real post URLs in Phase 1 too
          if (!isValidPostUrl(href)) {
            window.__scraperDiagnostics.phase1Details.linksRejectedByValidation++;
            if (window.__scraperDiagnostics.sampleRejectedUrls.length < 5) {
              window.__scraperDiagnostics.sampleRejectedUrls.push(href);
              window.__scraperDiagnostics.rejectionReasons.push('Phase1: URL validation failed for ' + href.substring(0, 80));
            }
            return;
          }
          
          if (seenUrls[href]) {
            window.__scraperDiagnostics.phase1Details.linksDuplicate++;
            return;
          }
          seenUrls[href] = true;
          window.__scraperDiagnostics.phase1Details.linksAccepted++;

          var likes = 0, comments = 0;
          
          // Enhanced engagement extraction - try multiple selectors
          var socialElements = Array.from(container.querySelectorAll('button, span[aria-label], .social-details-social-counts__item, .entity-result__content-summary, .social-details-social-counts__reactions, .social-details-social-counts__comments, [class*="social-counts"]'));
          
          socialElements.forEach(function(el) {
            var label = (el.getAttribute('aria-label') || '').toLowerCase();
            var text = (el.textContent || '').toLowerCase();
            
            // Look for reactions/likes
            if (label.indexOf('reaction') !== -1 || label.indexOf('like') !== -1 || text.indexOf('reaction') !== -1 || text.indexOf('like') !== -1) {
              var extracted = parseNum(label) || parseNum(text);
              if (extracted > likes) likes = extracted;
            }
            
            // Look for comments
            if (label.indexOf('comment') !== -1 || text.indexOf('comment') !== -1) {
              var extracted = parseNum(label) || parseNum(text);
              if (extracted > comments) comments = extracted;
            }
          });
          
          results.push({ url: href, likes: likes, comments: comments, method: 'container' });
        });

        // --- PHASE 2: Link-based Fallback (If containers fail) ---
        if (results.length === 0) {
          console.log('[Scraper] Phase 1 found 0 posts, trying Phase 2 fallback...');
          
          // UPDATED: Look for ANY links on the page that might be posts
          var allLinks = Array.from(document.querySelectorAll('a[href]'));
          var postLinks = allLinks.filter(function(a) {
            var href = a.getAttribute('href') || '';
            return href.includes('/posts/') || 
                   href.includes('/feed/update/') || 
                   href.includes('activity-') ||
                   href.includes('ugcPost-');
          });
          
          console.log('[Scraper] Phase 2: Found ' + postLinks.length + ' potential post links');
          window.__scraperDiagnostics.phase2Details.linksFound = postLinks.length;
          
          postLinks.forEach(function(link) {
            var href = link.getAttribute('href') || '';
            if (href.indexOf('http') !== 0) href = 'https://www.linkedin.com' + href;
            href = href.split('?')[0].split('#')[0];
            href = href.replace(/\/$/, ''); // Remove trailing slash
            
            // STRICT VALIDATION: Only accept real post URLs
            if (!isValidPostUrl(href)) {
              window.__scraperDiagnostics.phase2Details.linksRejectedByValidation++;
              if (window.__scraperDiagnostics.sampleRejectedUrls.length < 10) {
                window.__scraperDiagnostics.sampleRejectedUrls.push(href);
                window.__scraperDiagnostics.rejectionReasons.push('Phase2: URL validation failed for ' + href.substring(0, 80));
              }
              return;
            }
            
            if (seenUrls[href]) {
              window.__scraperDiagnostics.phase2Details.linksDuplicate++;
              return;
            }
            seenUrls[href] = true;
            window.__scraperDiagnostics.phase2Details.linksAccepted++;

            // Try to find engagement by going up to a common parent
            var parent = link;
            for (var i = 0; i < 10; i++) {
              if (!parent.parentElement) break;
              parent = parent.parentElement;
              if (parent.tagName === 'LI' || parent.tagName === 'ARTICLE' || parent.classList.contains('entity-result') || parent.classList.contains('reusable-search__result-container')) break;
            }
            
            var l = 0, c = 0;
            var text = parent.innerText || '';
            
            // Multiple regex patterns for reactions
            var rMatch = text.match(/([\\d\\.\\,km]+)\\s*(reaction|like)/i);
            if (rMatch) l = parseNum(rMatch[1]);
            if (l === 0) {
              rMatch = text.match(/(\\d+[\\.,]?\\d*)\\s*👍/);
              if (rMatch) l = parseNum(rMatch[1]);
            }
            
            // Multiple regex patterns for comments
            var cMatch = text.match(/([\\d\\.\\,km]+)\\s*comment/i);
            if (cMatch) c = parseNum(cMatch[1]);
            if (c === 0) {
              cMatch = text.match(/(\\d+[\\.,]?\\d*)\\s*💬/);
              if (cMatch) c = parseNum(cMatch[1]);
            }
            
            results.push({ url: href, likes: l, comments: c, method: 'link-fallback' });
          });
        }
        
        // --- PHASE 3: Strict URL-based scraping (NO desperate fallback) ---
        // REMOVED: Desperate fallback was too aggressive and grabbed non-post pages
        // If Phase 1 and 2 fail, it means LinkedIn truly has no posts for this keyword

        // Update final metrics
        window.__scraperDiagnostics.containerCount = containers.length;
        window.__scraperDiagnostics.totalExtracted = results.length;
        window.__scraperDiagnostics.noResultsFound = !!document.querySelector('.search-relevance-no-results, .artdeco-empty-state');
        window.__scraperDiagnostics.methods = results.reduce(function(acc, r) {
          acc[r.method] = (acc[r.method] || 0) + 1;
          return acc;
        }, {});
        window.__scraperDiagnostics.phase1Details.containersFound = containers.length;

        return results;
      })()
    `;

    // SAFE EXECUTION: Wrap in try/catch with guaranteed return structure
    let rawPosts: any[] = [];
    let diag: any = {
      containerCount: 0,
      totalExtracted: 0,
      phase1Details: { containersFound: 0, containersWithLinks: 0, linksAccepted: 0, linksRejectedByValidation: 0, linksDuplicate: 0 },
      phase2Details: { linksFound: 0, linksAccepted: 0, linksRejectedByValidation: 0, linksDuplicate: 0 },
      sampleRejectedUrls: [],
      methods: {},
      noResultsFound: false
    };

    try {
      rawPosts = await page.evaluate(superScraper) || [];
    } catch (err: any) {
      console.log(`   ❌ Scraper script error: ${err.message}`);
      rawPosts = [];
    }

    try {
      diag = await page.evaluate('window.__scraperDiagnostics') || diag;
    } catch (err: any) {
      console.log(`   ⚠️  Diagnostics not available: ${err.message}`);
    }

    console.log(`\n📊 Scraper Metrics:`);
    console.log(`   Containers detected: ${diag.containerCount || 0}`);
    console.log(`   Posts extracted: ${diag.totalExtracted || 0}`);
    
    // DETAILED DIAGNOSTICS
    if (diag.phase1Details) {
      console.log(`\n   🔍 Phase 1 (Container-based) Diagnostics:`);
      console.log(`      Containers found: ${diag.phase1Details.containersFound}`);
      console.log(`      Containers with links: ${diag.phase1Details.containersWithLinks}`);
      console.log(`      Links rejected by validation: ${diag.phase1Details.linksRejectedByValidation}`);
      console.log(`      Duplicate links: ${diag.phase1Details.linksDuplicate}`);
      console.log(`      Links accepted: ${diag.phase1Details.linksAccepted}`);
    }
    
    if (diag.phase2Details && diag.phase2Details.linksFound > 0) {
      console.log(`\n   🔍 Phase 2 (Link-based) Diagnostics:`);
      console.log(`      Links found: ${diag.phase2Details.linksFound}`);
      console.log(`      Links rejected by validation: ${diag.phase2Details.linksRejectedByValidation}`);
      console.log(`      Duplicate links: ${diag.phase2Details.linksDuplicate}`);
      console.log(`      Links accepted: ${diag.phase2Details.linksAccepted}`);
    }
    
    if (diag.sampleRejectedUrls && diag.sampleRejectedUrls.length > 0) {
      console.log(`\n   ⚠️  Sample Rejected URLs:`);
      diag.sampleRejectedUrls.forEach((url: string, i: number) => {
        console.log(`      [${i + 1}] ${url}`);
      });
    }
    
    if (diag.methods) {
      console.log(`\n   Extraction methods used:`);
      Object.keys(diag.methods).forEach(method => {
        console.log(`      ${method}: ${diag.methods[method]} posts`);
      });
    }
    if (diag.noResultsFound) console.log(`   ⚠️ LinkedIn reports: "No results found"`);

    if (rawPosts.length > 0) {
      console.log(`\n   ✅ Sample posts found:`);
      rawPosts.slice(0, 5).forEach((p, i) => {
        console.log(`      [${i + 1}] 👍 ${p.likes} | 💬 ${p.comments} | Method: ${p.method}`);
        console.log(`          URL: ${p.url.substring(0, 80)}...`);
      });
    } else {
      console.log(`\n   ❌ No posts found for this keyword.`);
      // Check for CAPTCHA
      const hasCaptcha = await page.evaluate('document.body.innerText.includes("CAPTCHA") || !!document.querySelector("iframe[src*=\'captcha\']")');
      if (hasCaptcha) {
        console.log(`   🚨 CAPTCHA detected! Automation blocked.`);
        console.log(`   ⏸️  PAUSING worker - waiting for manual CAPTCHA resolution...`);
        await waitForCaptchaResolution();
      }
      
      // Additional diagnostics
      const pageUrl = page.url();
      const pageTitle = await page.title();
      console.log(`   📄 Current page: ${pageTitle}`);
      console.log(`   🔗 URL: ${pageUrl}`);
    }

    return rawPosts.map(p => ({ ...p, distance: 0 }));

  } catch (error: any) {
    if (error.message === 'BROWSER_CLOSED' || error.message.includes('Target closed') || error.message.includes('context was destroyed')) {
      console.error(`   ❌ Browser context failed. Attempting recovery...`);
      await recreateBrowserContext().catch(() => { });
      return [];
    }
    console.error(`   ❌ Search error:`, error.message);
    return [];
  }
}

async function postAndVerifyComment(postUrl: string, commentText: string): Promise<{ success: boolean; commentUrl?: string; reason?: string }> {
  if (!page) throw new Error('Browser page not initialized');

  try {
    console.log(`\n📝 Posting comment to: ${postUrl}`);

    // Navigate to post
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // Give page time to fully load

    await broadcastScreenshot(page, 'Navigated to post');

    // CRITICAL: Check for CAPTCHA before attempting to post
    console.log(`   🔍 Checking for CAPTCHA...`);
    const hasCaptcha = await page.evaluate(() => {
      return document.body.innerText.includes('CAPTCHA') || 
             document.body.innerText.includes('security verification') ||
             !!document.querySelector('iframe[src*="captcha"]');
    }).catch(() => false);
    
    if (hasCaptcha) {
      console.log(`   🚨 CAPTCHA detected on post page!`);
      await broadcastScreenshot(page, 'CAPTCHA detected on post page');
      console.log(`   ⏸️  PAUSING worker - waiting for manual CAPTCHA resolution...`);
      await waitForCaptchaResolution();
      // After resolution, re-check the page
      console.log(`   ✅ CAPTCHA resolved, re-checking page...`);
    }
    console.log(`   ✅ No CAPTCHA detected`);

    // CRITICAL: Verify this is actually a post page
    console.log(`   🔍 Verifying this is a valid post page...`);
    const isValidPost = await page.evaluate(() => {
      // Check for post indicators
      const postSelectors = [
        '.feed-shared-update-v2',
        '[data-urn*="activity"]',
        '[data-urn*="ugcPost"]',
        'article.feed-shared-update',
        '[data-id*="urn:li:activity"]'
      ];
      
      for (const selector of postSelectors) {
        if (document.querySelector(selector)) return true;
      }
      
      return false;
    }).catch(() => false);
    
    if (!isValidPost) {
      console.log(`   ❌ Not a valid post page - missing post indicators`);
      await broadcastScreenshot(page, 'Not a valid post page');
      return { success: false, reason: 'Not a valid LinkedIn post page' };
    }
    console.log(`   ✅ Confirmed valid post page`);

    // Try multiple comment button selectors
    const commentButtonSelectors = [
      'button[aria-label*="Comment"]',
      'button.comment-button',
      'button[data-control-name="comment"]',
      '.social-actions-button--comment'
    ];

    let commentButton = null;
    for (const selector of commentButtonSelectors) {
      commentButton = await page.$(selector).catch(() => null);
      if (commentButton) {
        console.log(`   ✅ Found comment button using: ${selector}`);
        break;
      }
    }

    if (!commentButton) {
      await broadcastScreenshot(page, 'Comment button not found');
      return { success: false, reason: 'Comment button not found (tried multiple selectors)' };
    }

    await commentButton.click();
    await sleep(2000); // Wait for comment box to expand

    // Wait for comment editor - try multiple selectors
    const editorSelectors = [
      'div.ql-editor[contenteditable="true"]',
      '.comments-comment-texteditor',
      'div[contenteditable="true"][role="textbox"]',
      '.comments-comment-box__form textarea',
      'div[data-placeholder*="comment"]'
    ];

    let editor = null;
    for (const selector of editorSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        editor = await page.$(selector);
        if (editor) {
          console.log(`   ✅ Found comment editor using: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!editor) {
      await broadcastScreenshot(page, 'Comment editor not found');
      return { success: false, reason: 'Comment editor not found (tried multiple selectors)' };
    }

    // Type comment - ensure proper focus
    console.log(`   ⌨️  Typing comment (${commentText.length} characters)...`);
    
    // Triple-click to select any placeholder text, then clear
    await editor.click({ clickCount: 3 });
    await sleep(300);
    await page.keyboard.press('Backspace');
    await sleep(300);
    
    // Focus the editor properly
    await editor.focus();
    await sleep(500);
    
    // Type the comment character by character
    await page.keyboard.type(commentText, { delay: 30 });
    await sleep(1500);
    
    // Verify text was actually typed
    const typedText = await editor.evaluate((el: any) => el.innerText || el.textContent || '').catch(() => '');
    if (!typedText || !typedText.includes(commentText.substring(0, 20))) {
      console.log(`   ❌ Text verification failed - comment box appears empty`);
      await broadcastScreenshot(page, 'Comment text not in editor');
      return { success: false, reason: 'Comment text was not typed into editor' };
    }
    console.log(`   ✅ Comment text verified in editor`);

    await broadcastScreenshot(page, 'Comment typed');

    // ============================================================================
    // MANUAL SUBMIT MODE - PAUSE HERE AND WAIT FOR USER TO CLICK SUBMIT
    // ============================================================================
    
    // Find submit button but DON'T click it - just verify it exists
    const submitSelectors = [
      'button.comments-comment-box__submit-button:not([disabled])',
      'button[type="submit"]:not([disabled])',
      '.comments-comment-box__submit-button--cr',
      'button.comments-comment-box-comment__submit-button'
    ];

    let submitButton = null;
    for (const selector of submitSelectors) {
      submitButton = await page.$(selector).catch(() => null);
      if (submitButton) {
        const isDisabled = await submitButton.evaluate(el => el.hasAttribute('disabled'));
        if (!isDisabled) {
          console.log(`   ✅ Found enabled submit button using: ${selector}`);
          break;
        }
      }
      submitButton = null;
    }

    if (!submitButton) {
      await broadcastScreenshot(page, 'Submit button not found or disabled');
      return { success: false, reason: 'Submit button not found or disabled' };
    }

    // PAUSE: Wait for manual submit
    console.log('\n' + '='.repeat(80));
    console.log('⏸️  WAITING FOR MANUAL SUBMIT');
    console.log('='.repeat(80));
    console.log('\n🎯 READY FOR YOU TO CLICK SUBMIT!\n');
    console.log('📋 INSTRUCTIONS:');
    console.log('   1. The comment has been typed in the comment box');
    console.log('   2. The submit button is ready and enabled');
    console.log('   3. CLICK THE "POST" BUTTON MANUALLY in the browser window');
    console.log('   4. The worker will detect when you submit and verify the comment');
    console.log('   5. Then it will continue to the next post automatically\n');
    console.log(`📍 Post URL: ${postUrl}`);
    console.log(`💬 Comment: "${commentText.substring(0, 100)}${commentText.length > 100 ? '...' : ''}"`);
    console.log('\n⏳ Waiting for you to click submit...\n');

    // Broadcast to dashboard
    await broadcastStatus('WAITING_FOR_MANUAL_SUBMIT', {
      message: 'Waiting for manual submit - Click the POST button in the browser',
      postUrl: postUrl,
      commentText: commentText.substring(0, 100)
    });
    await broadcastAction('WAITING_FOR_MANUAL_SUBMIT', {
      postUrl: postUrl,
      commentPreview: commentText.substring(0, 100) + (commentText.length > 100 ? '...' : ''),
      instruction: 'Click the POST button in the browser window to submit the comment'
    });

    // Poll every 2 seconds to detect if comment has been submitted
    console.log('   🔍 Monitoring for submit action...');
    const maxWaitTime = 5 * 60 * 1000; // Wait up to 5 minutes for user to submit
    const checkInterval = 2000; // Check every 2 seconds
    const startTime = Date.now();
    let checkCount = 0;

    while (Date.now() - startTime < maxWaitTime) {
      checkCount++;
      await sleep(checkInterval);

      // Check if comment appears in DOM (means user clicked submit)
      const verificationResult = await verifyCommentInDOM(commentText);
      
      if (verificationResult.found) {
        console.log(`\n✅ SUBMIT DETECTED! Comment found in DOM after ${checkCount * 2} seconds`);
        console.log('   Comment has been successfully posted!\n');
        console.log('='.repeat(80));
        console.log('▶️  RESUMING AUTOMATION');
        console.log('='.repeat(80) + '\n');
        
        await broadcastStatus('RUNNING', { message: 'Manual submit completed - Worker resumed' });
        await broadcastLog('Comment submitted successfully! Continuing automation...');
        
        // Extract comment URL
        const commentUrl = await extractCommentUrl(commentText);
        
        return {
          success: true,
          commentUrl: commentUrl || postUrl
        };
      }

      // Also check if submit button disappeared (another indicator of submission)
      const submitStillExists = await page.$(submitSelectors[0]).catch(() => null);
      const editorStillExists = await page.$('div.ql-editor[contenteditable="true"]').catch(() => null);
      
      if (!submitStillExists && !editorStillExists) {
        console.log(`\n✅ SUBMIT DETECTED! Comment box closed (submission detected)`);
        await sleep(3000); // Give it time to appear in DOM
        
        const finalCheck = await verifyCommentInDOM(commentText);
        if (finalCheck.found) {
          console.log('   ✅ Comment verified in DOM!\n');
          console.log('='.repeat(80));
          console.log('▶️  RESUMING AUTOMATION');
          console.log('='.repeat(80) + '\n');
          
          await broadcastStatus('RUNNING', { message: 'Manual submit completed - Worker resumed' });
          
          const commentUrl = await extractCommentUrl(commentText);
          return {
            success: true,
            commentUrl: commentUrl || postUrl
          };
        }
      }

      // Progress indicator
      if (checkCount % 5 === 0) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`   ⏳ Still waiting... (${elapsed}s elapsed, checking every 2s)`);
      }
    }

    // Timeout reached - user didn't submit in 5 minutes
    console.log('\n⚠️  Manual submit timeout (5 minutes)');
    console.log('   Moving to next post...\n');
    
    await broadcastError('Manual submit timeout - User did not click submit within 5 minutes');
    await broadcastStatus('RUNNING', { message: 'Timeout on manual submit - Continuing to next post' });
    
    return { success: false, reason: 'User did not click submit within 5 minutes' };

  } catch (error: any) {
    console.error(`   ❌ Error posting comment:`, error.message);
    await broadcastScreenshot(page, `Error: ${error.message}`).catch(() => {});
    return { success: false, reason: error.message };
  }
}

async function verifyCommentInDOM(commentText: string): Promise<{ found: boolean }> {
  if (!page) return { found: false };

  try {
    console.log(`   🔍 Verifying comment appears in DOM...`);
    const startTime = Date.now();
    const maxWaitTime = 25000; // Wait up to 25 seconds for comment to appear (LinkedIn can be slow)

    // Use a snippet of the comment for matching (first 50 chars) to be more flexible
    const commentSnippet = commentText.substring(0, 50).toLowerCase().trim();
    console.log(`   Looking for snippet: "${commentSnippet}"`);

    let attemptCount = 0;
    while (Date.now() - startTime < maxWaitTime) {
      attemptCount++;
      await sleep(2000); // Check every 2 seconds

      // Try multiple selectors for comment items
      const commentSelectors = [
        'div.comments-comment-item',
        '.comments-comment-item-content-body',
        'article.comments-comment-item',
        '[data-id*="comment"]',
        '.comments-comment-item__main-content'
      ];

      for (const selector of commentSelectors) {
        const commentElements = await page.$$(selector).catch(() => []);
        
        if (commentElements.length > 0) {
          console.log(`   📊 Attempt ${attemptCount}: Found ${commentElements.length} comment elements using selector "${selector}"`);
          
          // Check last 10 comments (should include ours if recently posted)
          const recentComments = commentElements.slice(-10);
          
          for (const commentElement of recentComments) {
            const text = await commentElement.textContent().catch(() => '') || '';
            const textLower = text.toLowerCase().trim();
            
            // Match using snippet OR full text
            if (textLower.includes(commentSnippet) || text.includes(commentText)) {
              console.log(`   ✅ VERIFIED! Comment found in DOM after ${Math.round((Date.now() - startTime) / 1000)}s`);
              return { found: true };
            }
          }
        }
      }
      
      console.log(`   ⏳ Not found yet, waiting... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    }

    console.log(`   ❌ Comment not found in DOM after ${maxWaitTime / 1000}s`);
    return { found: false };
  } catch (error: any) {
    console.log(`   ❌ Verification error: ${error.message}`);
    return { found: false };
  }
}

async function extractCommentUrl(commentText: string): Promise<string | null> {
  if (!page) return null;

  try {
    // Find comment element
    const commentElements = await page.$$('div.comments-comment-item');

    for (const commentElement of commentElements) {
      const text = await commentElement.textContent();
      if (text && text.includes(commentText)) {
        // Look for permalink button
        const permalinkButton = await commentElement.$('button[aria-label*="permalink"]');
        if (permalinkButton) {
          const href = await permalinkButton.getAttribute('data-link');
          if (href) return href;
        }
      }
    }

    return null;

  } catch (error) {
    return null;
  }
}

// ============================================================================
// POST FILTERING & SELECTION
// ============================================================================

function filterPostsByReach(posts: PostCandidate[], settings: WorkerSettings): PostCandidate[] {
  return posts.filter(post => {
    const likesMatch = post.likes >= settings.minLikes && post.likes <= settings.maxLikes;
    const commentsMatch = post.comments >= settings.minComments && post.comments <= settings.maxComments;
    return likesMatch && commentsMatch;
  });
}

function selectBestPost(
  filteredPosts: PostCandidate[],
  allPosts: PostCandidate[],
  settings: WorkerSettings
): PostCandidate | null {
  // IMPROVED LOGIC: If we have filtered posts that match criteria, use them.
  // If NO posts match strict criteria, use the best available post anyway (don't skip posting!)
  // BUT: Reject posts with 0 likes AND 0 comments (likely invalid pages)
  
  // Filter out invalid posts (0 engagement = likely not a real post)
  const validPosts = allPosts.filter(p => p.likes > 0 || p.comments > 0);
  const validFilteredPosts = filteredPosts.filter(p => p.likes > 0 || p.comments > 0);
  
  let postsToConsider: PostCandidate[] = [];
  let selectionMode = '';
  
  if (validFilteredPosts.length > 0) {
    // We have posts that match criteria perfectly
    postsToConsider = validFilteredPosts;
    selectionMode = 'EXACT MATCH';
    console.log(`   ✅ Found ${validFilteredPosts.length} posts matching criteria (${settings.minLikes}-${settings.maxLikes} likes, ${settings.minComments}-${settings.maxComments} comments)`);
  } else if (validPosts.length > 0) {
    // No posts match strict criteria, but we have SOME valid posts - use them anyway!
    postsToConsider = validPosts;
    selectionMode = 'BEST AVAILABLE (relaxed criteria)';
    console.log(`   ⚠️  No posts matched strict criteria. Using best available from ${validPosts.length} valid posts.`);
    console.log(`   📊 Criteria was: ${settings.minLikes}-${settings.maxLikes} likes, ${settings.minComments}-${settings.maxComments} comments`);
  } else {
    // No valid posts found (all had 0 engagement)
    console.log(`   ❌ No valid posts found (all had 0 likes and 0 comments - likely invalid URLs).`);
    if (allPosts.length > 0) {
      console.log(`   ⚠️  Found ${allPosts.length} URLs but they appear to be non-post pages.`);
    }
    return null;
  }

  const targetLikes = settings.minLikes;
  const targetComments = settings.minComments;

  // Calculate distance from target engagement
  const scoredPosts = postsToConsider.map(post => {
    // Distance calculation: how far from our ideal target
    const diffLikes = Math.abs(post.likes - targetLikes);
    const diffComments = Math.abs(post.comments - targetComments);
    const distanceScore = diffLikes + diffComments;
    return { ...post, distance: distanceScore };
  });

  // Sort by lowest distance score (closest to our target)
  scoredPosts.sort((a, b) => a.distance - b.distance);

  const bestPost = scoredPosts[0];

  console.log(`   ✅ Selected post (${selectionMode}):`);
  console.log(`      👍 ${bestPost.likes} likes | 💬 ${bestPost.comments} comments`);
  console.log(`      📏 Distance from target: ${bestPost.distance}`);
  console.log(`      🔗 URL: ${bestPost.url}`);
  
  return bestPost;
}

// ============================================================================
// BROWSER MANAGEMENT
// ============================================================================

async function initializeBrowser() {
  console.log('🌐 Initializing browser (headed mode)...');

  browser = await chromium.launch({
    headless: false, // VISIBLE BROWSER
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Create fresh browser context with isolated storage
  await createFreshContext();

  isRunning = true;
  console.log('✅ Browser initialized\n');
}

/**
 * Create a completely fresh browser context
 * Each context has isolated cookies, localStorage, sessionStorage
 * IMPORTANT: closes previous context first to avoid tab leaks
 */
async function createFreshContext() {
  if (!browser) throw new Error('Browser not initialized');

  // Close ALL existing contexts first to prevent tab leaks
  const existingContexts = browser.contexts();
  for (const ctx of existingContexts) {
    await ctx.close().catch(() => { });
  }
  page = null;

  console.log('🆕 Creating fresh browser context (isolated session)...');

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    storageState: undefined,
    permissions: [],
  });

  // Remove automation flags
  await context.addInitScript('Object.defineProperty(navigator, "webdriver", { get: () => false })');

  // Dismiss any dialog popups automatically
  context.on('page', newPage => {
    newPage.on('dialog', dialog => dialog.dismiss().catch(() => { }));
  });

  page = await context.newPage();

  // Dismiss dialogs on main page too
  page.on('dialog', dialog => dialog.dismiss().catch(() => { }));

  console.log('✅ Fresh context created (clean cookies, storage, and session)\n');
}

/**
 * Recreate browser context when user/session changes or recovery is needed
 * This ensures complete isolation between different users
 */
async function recreateBrowserContext() {
  console.log('🔄 Recreating browser context for isolation or recovery...');

  // Reset authentication state
  isAuthenticated = false;

  // Safely close old resources
  try {
    if (page) {
      const oldContext = page.context();
      await page.close().catch(() => { });
      await oldContext.close().catch(() => { });
      page = null;
    }
  } catch (e) {
    // Ignore context closure errors
  }

  // Use a short delay to let browser settle
  await sleep(1000);

  // Create completely fresh context
  await createFreshContext();

  console.log('✅ Browser context recreated successfully\n');
}

async function authenticateLinkedIn(sessionCookie: string): Promise<boolean> {
  if (!page) return false;

  try {
    console.log('🔐 Authenticating LinkedIn session...');
    console.log(`   Cookie: ${sessionCookie.slice(0, 20)}...${sessionCookie.slice(-10)}`);

    // Validate cookie format
    if (!sessionCookie || sessionCookie.trim() === '') {
      console.log('❌ Invalid cookie: empty or missing\n');
      return false;
    }

    // Clear any existing cookies first (ensure clean state)
    await page.context().clearCookies();
    console.log('   Cleared existing cookies');

    // Set fresh session cookie
    await page.context().addCookies([{
      name: 'li_at',
      value: sessionCookie,
      domain: '.linkedin.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    }]);
    console.log('   Set new LinkedIn session cookie');

    // Navigate to LinkedIn to verify session
    console.log('   Navigating to LinkedIn feed...');
    try {
      await page.goto('https://www.linkedin.com/feed', {
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('   Waiting for page elements to stabilize...');
      // Wait for either the global nav (logged in) or the login form (failed)
      await Promise.race([
        page.waitForSelector('#global-nav', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('.global-nav', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('[aria-label="Primary Navigation"]', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('input[name="session_key"]', { timeout: 10000 }).catch(() => null),
        page.waitForSelector('div.feed-shared-update-v2', { timeout: 10000 }).catch(() => null)
      ]);

      // Explicit short sleep to allow dynamic content (like session fragments) to settle
      await sleep(3000);
    } catch (e: any) {
      console.log(`   ⚠️  Navigation warning: ${e.message}`);
    }

    // Check current state
    const currentUrl = page.url();
    const hasGlobalNav = await page.$('#global-nav') !== null || await page.$('.global-nav') !== null;
    const hasPrimaryNav = await page.$('[aria-label="Primary Navigation"]') !== null;
    const hasFeedPosts = await page.$('div.feed-shared-update-v2') !== null;
    const hasStartPost = await page.$('button[aria-label*="Start a post"]') !== null;
    const isFeedUrl = currentUrl.includes('/feed');
    const onLoginPage = await page.$('input[name="session_key"]') !== null || currentUrl.includes('/login');

    // Robust login determination: 
    // 1. If we are on /feed and NOT on a login page, we are very likely logged in regardless of specific selectors
    // 2. OR if any major logged-in selectors are present
    const isLoggedIn = (isFeedUrl && !onLoginPage) || hasGlobalNav || hasPrimaryNav || hasFeedPosts || hasStartPost;

    if (isLoggedIn) {
      console.log('✅ LinkedIn authentication successful\n');
      console.log(`   Detected via: ${isFeedUrl ? 'Feed URL' : ''} ${hasGlobalNav ? '+ Global Nav' : ''} ${hasPrimaryNav ? '+ Primary Nav' : ''}`);
      await broadcastScreenshot(page, 'Authenticated on LinkedIn');
      return true;
    } else {
      console.log('❌ LinkedIn authentication failed (not logged in)\n');
      console.log(`   Current URL: ${currentUrl}`);

      // Take screenshot for debugging
      await broadcastScreenshot(page, 'Authentication failed');

      // Detailed failure reason
      if (onLoginPage) {
        console.log('   Reason: Redirected to login page (invalid/expired cookie)');
      } else if (currentUrl.includes('/checkpoint')) {
        console.log('   Reason: Security checkpoint detected (e.g. Email/SMS verification needed)');
      } else {
        console.log('   Reason: Unknown navigation state (check the diagnostic screenshot)');
      }

      return false;
    }

  } catch (error: any) {
    console.error('❌ Authentication error:', error.message);

    // Provide helpful error messages
    if (error.message.includes('ERR_TOO_MANY_REDIRECTS')) {
      console.log('   Reason: Too many redirects (likely invalid/expired cookie)');
    } else if (error.message.includes('Timeout')) {
      console.log('   Reason: LinkedIn took too long to respond');
    }

    return false;
  }
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...');

  if (page) {
    await page.close().catch(() => { });
    page = null;
  }

  if (browser) {
    await browser.close().catch(() => { });
    browser = null;
  }

  await prisma.$disconnect();

  console.log('✅ Cleanup complete\n');
}

// ============================================================================
// DATABASE FUNCTIONS
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
    systemActive: settings.systemActive
  };
}

async function getActiveKeywords(userId: string): Promise<KeywordData[]> {
  const keywords = await prisma.keyword.findMany({
    where: {
      userId,
      active: true
    },
    include: {
      comments: {
        where: {
          userId // Only get comments belonging to same user
        }
      }
    }
  });

  return keywords.map(k => ({
    id: k.id,
    keyword: k.keyword,
    comments: k.comments.map(c => ({
      id: c.id,
      text: c.text
    }))
  }));
}

async function isSystemStillActive(userId: string): Promise<boolean> {
  const settings = await prisma.settings.findUnique({
    where: { userId }
  });

  return settings?.systemActive || false;
}

async function logResult(result: ProcessingResult, userId: string) {
  try {
    await prisma.log.create({
      data: {
        userId,
        action: result.success ? 'COMMENT_POSTED' : 'FAILED',
        postUrl: result.postUrl || 'N/A',
        comment: result.commentText || null,
        commentUrl: result.commentUrl || null
      }
    });
  } catch (error) {
    console.error('Failed to log result:', error);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseEngagementNumber(text: string): number {
  const cleaned = text.replace(/,/g, '').trim();
  const match = cleaned.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

process.on('SIGTERM', async () => {
  console.log('\n⚠️  SIGTERM received. Shutting down gracefully...');
  isRunning = false;
  await cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️  SIGINT received. Shutting down gracefully...');
  isRunning = false;
  await cleanup();
  process.exit(0);
});

// ============================================================================
// START WORKER
// ============================================================================

main().catch(async (error) => {
  console.error('❌ Fatal error:', error);
  await cleanup();
  process.exit(1);
});
