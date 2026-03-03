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
          await sleep(10000); // Wait 10 seconds
          continue;
        }

        // Check if user or session changed - recreate browser context if needed
        const sessionChanged = currentUserId !== settings.userId || 
                              currentSessionCookie !== settings.linkedinSessionCookie;

        if (sessionChanged && currentUserId !== null) {
          console.log('🔄 User or session changed. Recreating browser context...');
          await recreateBrowserContext();
        }

        // Set user context for broadcasts
        currentUserId = settings.userId;
        currentSessionCookie = settings.linkedinSessionCookie;
        setUserContext(settings.userId);
        if (settings.platformUrl) {
          setApiBaseUrl(settings.platformUrl);
        }

        // Authenticate LinkedIn session
        const authenticated = await authenticateLinkedIn(settings.linkedinSessionCookie);
        if (!authenticated) {
          await broadcastError('LinkedIn authentication failed. Please update your session cookie.');
          await sleep(60000); // Wait 1 minute before retry
          continue;
        }

        await broadcastStatus('RUNNING', { message: 'Worker is active and processing keywords' });

        // Fetch active keywords with their comments
        const keywords = await getActiveKeywords(settings.userId);

        if (keywords.length === 0) {
          console.log('⏸️  No active keywords found. Waiting...');
          await broadcastLog('No active keywords found. Add keywords to start automation.');
          await sleep(30000); // Wait 30 seconds
          continue;
        }

        console.log(`\n📋 Found ${keywords.length} active keyword(s) to process\n`);

        // Process each keyword
        for (const keyword of keywords) {
          // Check if still active
          const stillActive = await isSystemStillActive(settings.userId);
          if (!stillActive) {
            console.log('⏸️  System deactivated by user. Stopping...');
            await broadcastStatus('STOPPED', { message: 'Worker stopped by user' });
            isRunning = false;
            break;
          }

          // Process single keyword
          const result = await processKeyword(keyword, settings);

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
        await sleep(5000); // 5 seconds between cycles

      } catch (error: any) {
        console.error('❌ Error in worker loop:', error);
        await broadcastError(`Worker error: ${error.message}`);
        await sleep(30000); // Wait 30 seconds on error
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

    // Step 3: Select best post (closest to minimum reach)
    const selectedPost = selectBestPost(filteredPosts, posts, settings);

    if (!selectedPost) {
      console.log(`⚠️  No suitable post found after filtering. Skipping.`);
      await broadcastLog(`No posts matched reach criteria for "${keyword}"`, 'warn');
      return {
        success: false,
        keyword,
        reason: 'No posts matched the reach criteria'
      };
    }

    console.log(`\n✅ Selected Post:`);
    console.log(`   URL: ${selectedPost.url}`);
    console.log(`   Likes: ${selectedPost.likes} | Comments: ${selectedPost.comments}`);
    console.log(`   Distance from minimum: ${selectedPost.distance.toFixed(2)}`);

    // Step 4: Select random comment from keyword's comments
    const randomComment = comments[Math.floor(Math.random() * comments.length)];
    console.log(`\n💬 Selected Comment: "${randomComment.text.substring(0, 50)}..."`);

    // Step 5: Post comment and verify
    await broadcastLog(`Posting comment on selected post...`);
    const commentResult = await postAndVerifyComment(selectedPost.url, randomComment.text);

    if (!commentResult.success) {
      console.log(`❌ Failed to post comment: ${commentResult.reason}`);
      return {
        success: false,
        keyword,
        commentText: randomComment.text,
        postUrl: selectedPost.url,
        reason: commentResult.reason
      };
    }

    console.log(`\n✅ SUCCESS! Comment posted and verified`);
    console.log(`   Post URL: ${selectedPost.url}`);
    console.log(`   Comment URL: ${commentResult.commentUrl}`);

    // Update comment usage count
    await prisma.comment.update({
      where: { id: randomComment.id },
      data: { timesUsed: { increment: 1 } }
    });

    return {
      success: true,
      keyword,
      commentText: randomComment.text,
      postUrl: selectedPost.url,
      commentUrl: commentResult.commentUrl,
      selectedPost: {
        likes: selectedPost.likes,
        comments: selectedPost.comments
      }
    };

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
// LINKEDIN AUTOMATION FUNCTIONS
// ============================================================================

async function searchLinkedInPosts(keyword: string): Promise<PostCandidate[]> {
  if (!page) throw new Error('Browser page not initialized');

  const posts: PostCandidate[] = [];

  try {
    // Navigate to LinkedIn search
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&sortBy=date_posted`;
    console.log(`   Navigating to: ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000); // Wait for dynamic content

    // Take screenshot
    await broadcastScreenshot(page, `Searching for: ${keyword}`);

    // Extract posts from search results
    const postElements = await page.$$('div.feed-shared-update-v2');
    console.log(`   Found ${postElements.length} post elements on page`);

    for (const postElement of postElements) {
      try {
        // Extract post URL
        const linkElement = await postElement.$('a.app-aware-link[href*="/feed/update/"]');
        if (!linkElement) continue;

        const href = await linkElement.getAttribute('href');
        if (!href) continue;

        const postUrl = href.includes('http') ? href : `https://www.linkedin.com${href}`;

        // Extract engagement metrics
        const socialCountsElement = await postElement.$('ul.social-details-social-counts');
        
        let likes = 0;
        let comments = 0;

        if (socialCountsElement) {
          const likesText = await socialCountsElement.$eval(
            'button[aria-label*="reaction"]',
            (el) => el.textContent?.trim() || '0'
          ).catch(() => '0');

          const commentsText = await socialCountsElement.$eval(
            'button[aria-label*="comment"]',
            (el) => el.textContent?.trim() || '0'
          ).catch(() => '0');

          likes = parseEngagementNumber(likesText);
          comments = parseEngagementNumber(commentsText);
        }

        posts.push({
          url: postUrl,
          likes,
          comments,
          distance: 0 // Will be calculated later
        });

      } catch (error) {
        // Skip invalid posts
        continue;
      }
    }

    console.log(`   Extracted ${posts.length} valid posts with engagement data`);

  } catch (error: any) {
    console.error(`   ❌ Error searching LinkedIn:`, error.message);
  }

  return posts;
}

async function postAndVerifyComment(postUrl: string, commentText: string): Promise<{ success: boolean; commentUrl?: string; reason?: string }> {
  if (!page) throw new Error('Browser page not initialized');

  try {
    console.log(`\n📝 Posting comment to: ${postUrl}`);

    // Navigate to post
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2000);

    await broadcastScreenshot(page, 'Navigated to post');

    // Click comment button
    const commentButton = await page.$('button[aria-label*="Comment"]');
    if (!commentButton) {
      return { success: false, reason: 'Comment button not found' };
    }

    await commentButton.click();
    await sleep(1000);

    // Wait for comment editor
    const editorSelector = 'div.ql-editor[contenteditable="true"]';
    await page.waitForSelector(editorSelector, { timeout: 10000 });

    const editor = await page.$(editorSelector);
    if (!editor) {
      return { success: false, reason: 'Comment editor not found' };
    }

    // Type comment (character by character for visibility)
    console.log(`   Typing comment...`);
    await editor.click();
    await page.keyboard.type(commentText, { delay: 50 }); // 50ms delay between characters
    await sleep(1000);

    await broadcastScreenshot(page, 'Comment typed');

    // Submit comment
    const submitButton = await page.$('button.comments-comment-box__submit-button:not([disabled])');
    if (!submitButton) {
      return { success: false, reason: 'Submit button not found or disabled' };
    }

    console.log(`   Submitting comment...`);
    await submitButton.click();
    await sleep(3000); // Wait for LinkedIn to process

    await broadcastScreenshot(page, 'Comment submitted');

    // Verify comment appears in DOM
    console.log(`   Verifying comment in DOM...`);
    const verificationResult = await verifyCommentInDOM(commentText);

    if (!verificationResult.found) {
      return { success: false, reason: 'Comment not found in DOM after submission' };
    }

    console.log(`   ✅ Comment verified in DOM!`);

    // Extract comment URL (permalink)
    const commentUrl = await extractCommentUrl(commentText);

    return {
      success: true,
      commentUrl: commentUrl || postUrl // Fallback to post URL if permalink not found
    };

  } catch (error: any) {
    console.error(`   ❌ Error posting comment:`, error.message);
    return { success: false, reason: error.message };
  }
}

async function verifyCommentInDOM(commentText: string): Promise<{ found: boolean }> {
  if (!page) return { found: false };

  try {
    // Wait a bit for DOM to update
    await sleep(2000);

    // Look for comment text in the comments section
    const commentElements = await page.$$('div.comments-comment-item');

    for (const commentElement of commentElements) {
      const text = await commentElement.textContent();
      if (text && text.includes(commentText)) {
        return { found: true };
      }
    }

    return { found: false };

  } catch (error) {
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
  // If we have exact matches, pick randomly
  if (filteredPosts.length > 0) {
    console.log(`   ✅ Found ${filteredPosts.length} posts matching exact reach criteria`);
    const randomPost = filteredPosts[Math.floor(Math.random() * filteredPosts.length)];
    randomPost.distance = 0;
    return randomPost;
  }

  // No exact matches - find closest to minimum reach
  console.log(`   ⚠️  No exact matches. Finding closest to minimum reach...`);

  const targetLikes = settings.minLikes;
  const targetComments = settings.minComments;

  // Calculate distance from minimum reach for all posts
  const postsWithDistance = allPosts.map(post => {
    const likesDistance = Math.abs(post.likes - targetLikes);
    const commentsDistance = Math.abs(post.comments - targetComments);
    
    // Euclidean distance
    const distance = Math.sqrt(likesDistance ** 2 + commentsDistance ** 2);

    return { ...post, distance };
  });

  // Sort by distance (closest first)
  postsWithDistance.sort((a, b) => a.distance - b.distance);

  // Prefer posts slightly above minimum over posts below minimum
  const closestPost = postsWithDistance.find(post => 
    post.likes >= targetLikes && post.comments >= targetComments
  ) || postsWithDistance[0];

  if (closestPost) {
    console.log(`   ✅ Selected closest post (distance: ${closestPost.distance.toFixed(2)})`);
  }

  return closestPost || null;
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
 */
async function createFreshContext() {
  if (!browser) throw new Error('Browser not initialized');

  console.log('🆕 Creating fresh browser context (isolated session)...');

  // Create new context with clean state
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Ensure no data is persisted
    storageState: undefined,
    // Clear all permissions
    permissions: [],
  });

  // Remove automation flags
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  page = await context.newPage();

  console.log('✅ Fresh context created (clean cookies, storage, and session)\n');
}

/**
 * Recreate browser context when user/session changes
 * This ensures complete isolation between different users
 */
async function recreateBrowserContext() {
  console.log('🔄 Session change detected. Recreating browser context...');
  console.log(`   Old user: ${currentUserId?.slice(0, 8)}`);
  console.log(`   Old cookie: ${currentSessionCookie?.slice(0, 20)}...`);

  // Close old page and context
  if (page) {
    const oldContext = page.context();
    await page.close().catch(() => {});
    await oldContext.close().catch(() => {});
    page = null;
  }

  // Create completely fresh context
  await createFreshContext();

  console.log('✅ Browser context recreated with clean state\n');
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
    await page.goto('https://www.linkedin.com/feed', { 
      waitUntil: 'networkidle', 
      timeout: 60000 
    });
    await sleep(5000); // Wait for page to fully load

    // Check if logged in (look for feed or profile element)
    const isLoggedIn = await page.$('div.feed-shared-update-v2') !== null ||
                       await page.$('button[aria-label*="Start a post"]') !== null ||
                       await page.$('button.share-box-feed-entry__trigger') !== null;

    if (isLoggedIn) {
      console.log('✅ LinkedIn authentication successful\n');
      await broadcastScreenshot(page, 'Authenticated on LinkedIn');
      return true;
    } else {
      console.log('❌ LinkedIn authentication failed (not logged in)\n');
      
      // Take screenshot for debugging
      await broadcastScreenshot(page, 'Authentication failed');
      
      // Check if we're on login page
      const onLoginPage = await page.$('input[name="session_key"]') !== null;
      if (onLoginPage) {
        console.log('   Reason: Redirected to login page (invalid cookie)');
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
    await page.close().catch(() => {});
    page = null;
  }

  if (browser) {
    await browser.close().catch(() => {});
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
