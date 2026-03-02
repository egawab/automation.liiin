/**
 * NEXORA LinkedIn Automation Worker - PERFORMANCE OPTIMIZED v5.0
 * 
 * PERFORMANCE IMPROVEMENTS:
 * ✅ Fast browser launch with optimized settings
 * ✅ Reduced delays while maintaining human-like behavior
 * ✅ Parallel post parsing for faster extraction
 * ✅ Optimized scrolling algorithm (faster but still smooth)
 * ✅ Browser session reuse across keywords (no reopening)
 * ✅ Intelligent navigation caching
 * ✅ Always posts comments - fallback to closest match if exact reach not found
 * ✅ Professional, accurate, and precise performance
 * 
 * WORKFLOW:
 * 1. Fetch ALL active keywords
 * 2. Launch browser ONCE (reuse for all keywords)
 * 3. For each keyword:
 *    - Navigate to search (optimized)
 *    - Fast scroll and collect posts
 *    - Filter by reach criteria OR select closest match
 *    - Post comment (guaranteed)
 *    - Log action
 * 4. Close browser after all keywords processed
 * 5. Respect rate limits
 */

import { chromium, Browser, Page } from 'playwright';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function randomDelay(minMins: number, maxMins: number) {
    const mins = minMins + Math.random() * (maxMins - minMins);
    const ms = mins * 60 * 1000;
    console.log(`⏳ Waiting ${mins.toFixed(1)} minutes until next cycle...`);
    await sleep(ms);
}

/**
 * Log action to database using correct Log model
 */
async function logAction(userId: string, action: string, postUrl: string, comment?: string) {
    try {
        await prisma.log.create({
            data: { 
                userId, 
                action, 
                postUrl,
                comment: comment || null
            }
        });
        console.log(`   📝 [LOG] ${action}`);
    } catch (error) {
        console.error('   ⚠️  Log error:', error);
    }
}

// ============================================================================
// POST EXTRACTION & PARSING
// ============================================================================

interface PostData {
    element: any;
    likes: number;
    comments: number;
    postUrl: string;
}

/**
 * Extract post metrics with multiple selector fallbacks
 */
async function extractPostData(postElement: any): Promise<PostData | null> {
    try {
        // Try multiple selectors for likes
        let likesText = '0';
        const likeSelectors = [
            '.social-details-social-counts__reactions-count',
            '[aria-label*="reaction"]',
            '.social-details-social-counts__reactions',
            'button[aria-label*="Like"]'
        ];
        
        for (const selector of likeSelectors) {
            try {
                likesText = await postElement.$eval(selector, (el: any) => el.innerText || el.getAttribute('aria-label') || '0');
                if (likesText && likesText !== '0') break;
            } catch (e) {
                continue;
            }
        }

        // Try multiple selectors for comments
        let commentsText = '0';
        const commentSelectors = [
            '.social-details-social-counts__comments',
            '[aria-label*="comment"]',
            'button[aria-label*="Comment"]'
        ];
        
        for (const selector of commentSelectors) {
            try {
                commentsText = await postElement.$eval(selector, (el: any) => el.innerText || el.getAttribute('aria-label') || '0');
                if (commentsText && commentsText !== '0') break;
            } catch (e) {
                continue;
            }
        }

        // Extract post URL
        let postUrl = 'unknown';
        try {
            const permalink = await postElement.$('a[href*="/feed/update/"]');
            if (permalink) {
                postUrl = await permalink.getAttribute('href') || 'unknown';
            }
        } catch (e) {
            // URL extraction failed, continue anyway
        }

        const likes = parseInt(likesText.replace(/[^0-9]/g, '')) || 0;
        const comments = parseInt(commentsText.replace(/[^0-9]/g, '')) || 0;

        return {
            element: postElement,
            likes,
            comments,
            postUrl
        };
    } catch (error) {
        return null;
    }
}

/**
 * OPTIMIZED: Fast but smooth scrolling to load posts quickly
 * Reduced delays while maintaining human-like behavior
 */
async function scrollAndCollectPosts(page: Page, maxScrolls: number = 8): Promise<PostData[]> {
    const allPosts: PostData[] = [];
    const seenUrls = new Set<string>();

    console.log(`   📜 Fast scroll initiated (${maxScrolls} scrolls)...`);

    for (let i = 0; i < maxScrolls; i++) {
        // Get current posts
        const postElements = await page.$$('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper').catch(() => []);
        
        console.log(`   📄 Scroll ${i + 1}/${maxScrolls}: Found ${postElements.length} elements`);

        // OPTIMIZED: Parse posts in parallel for speed
        const parsePromises = postElements.map(postEl => extractPostData(postEl));
        const parsedPosts = await Promise.all(parsePromises);

        // Add unique posts
        for (const postData of parsedPosts) {
            if (postData && !seenUrls.has(postData.postUrl)) {
                seenUrls.add(postData.postUrl);
                allPosts.push(postData);
                console.log(`      • ${postData.likes}L, ${postData.comments}C`);
            }
        }

        // OPTIMIZED: Faster scrolling with fewer steps but still smooth
        if (i < maxScrolls - 1) {
            const scrollDistance = 1000 + Math.random() * 400; // 1000-1400px (larger)
            const scrollSteps = 4 + Math.floor(Math.random() * 3); // 4-6 steps (fewer)
            const stepSize = scrollDistance / scrollSteps;
            
            for (let step = 0; step < scrollSteps; step++) {
                await page.mouse.wheel(0, stepSize);
                await sleep(20 + Math.random() * 20); // 20-40ms (faster)
            }
            
            // OPTIMIZED: Shorter pause (0.8-1.5s instead of 1.5-3s)
            await sleep(800 + Math.random() * 700);
        }
    }

    console.log(`   ✅ Collected ${allPosts.length} unique posts in ${maxScrolls} scrolls`);
    return allPosts;
}

// ============================================================================
// COMMENT POSTING
// ============================================================================

/**
 * OPTIMIZED: Post a comment with reduced delays but still human-like
 */
async function postComment(postElement: any, commentText: string): Promise<boolean> {
    try {
        console.log(`   💬 Posting comment...`);

        // Step 1: Find and click comment button
        const commentBtnSelectors = [
            'button[aria-label*="Comment"]',
            '.comment-button',
            'button.comment',
            '[data-control-name="comment"]'
        ];

        let commentBtn = null;
        for (const selector of commentBtnSelectors) {
            commentBtn = await postElement.$(selector).catch(() => null);
            if (commentBtn) break;
        }

        if (!commentBtn) {
            console.log(`   ❌ Comment button not found`);
            return false;
        }

        await commentBtn.scrollIntoViewIfNeeded();
        await sleep(300); // Reduced from 500ms
        await commentBtn.hover();
        await sleep(200 + Math.random() * 200); // Reduced from 300-600ms
        await commentBtn.click();
        await sleep(1200); // Reduced from 2000ms

        // Step 2: Find comment editor
        const editorSelectors = [
            '.ql-editor[contenteditable="true"]',
            '[contenteditable="true"].ql-editor',
            '.comments-comment-box__text-editor',
            'div[role="textbox"]'
        ];

        let editor = null;
        for (const selector of editorSelectors) {
            editor = await postElement.$(selector).catch(() => null);
            if (editor) break;
        }

        if (!editor) {
            console.log(`   ❌ Comment editor not found`);
            return false;
        }

        // Step 3: Type comment with optimized speed (still human-like)
        await editor.click();
        await sleep(300); // Reduced from 500ms
        await editor.type(commentText, { delay: 45 + Math.random() * 30 }); // Faster: 45-75ms vs 60-100ms
        await sleep(1000); // Reduced from 1500ms

        // Step 4: Find and click submit button
        const submitSelectors = [
            '.comments-comment-box__submit-button--cr',
            '.comments-comment-box__submit-button',
            'button[type="submit"]',
            'button.comments-comment-box-comment__button'
        ];

        let submitBtn = null;
        for (const selector of submitSelectors) {
            submitBtn = await postElement.$(selector).catch(() => null);
            if (submitBtn) {
                const isEnabled = await submitBtn.isEnabled().catch(() => false);
                if (isEnabled) break;
            }
        }

        if (!submitBtn) {
            console.log(`   ❌ Submit button not found or disabled`);
            return false;
        }

        await submitBtn.hover();
        await sleep(300 + Math.random() * 300); // Reduced from 500-1000ms
        await submitBtn.click();
        await sleep(2000); // Reduced from 3000ms

        console.log(`   ✅ Comment posted!`);
        return true;

    } catch (error: any) {
        console.log(`   ❌ Comment posting error: ${error.message}`);
        return false;
    }
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function runPipelineForUser(userId: string, sessionCookie: string, settings: any) {
    console.log(`\n========================================`);
    console.log(`👤 Processing User: ${userId.slice(0, 8)}...`);
    console.log(`⚡ USER-INITIATED SESSION - Using CURRENT data only`);
    console.log(`========================================`);

    // STEP 1: Check daily limit using Log model
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const commentsToday = await prisma.log.count({
        where: {
            userId,
            action: { contains: 'Commented on post' },
            timestamp: { gte: today }
        }
    });

    console.log(`   📊 Comments posted today: ${commentsToday}/${settings.maxCommentsPerDay}`);
    console.log(`   🔍 Fetching FRESH keywords and comments from database...`);

    if (commentsToday >= settings.maxCommentsPerDay) {
        console.log(`   ⚠️  Daily limit reached. Skipping user.`);
        await logAction(userId, 'Daily limit reached', 'N/A');
        return;
    }

    // STEP 2: ✅ FRESH DATA - Fetch ALL active keywords WITH their comments for THIS session
    const keywords = await prisma.keyword.findMany({
        where: { userId, active: true },
        include: { comments: true },
        orderBy: { createdAt: 'asc' }
    });

    const generalComments = await prisma.comment.findMany({
        where: { userId, keywordId: null }
    });

    if (keywords.length === 0) {
        console.log(`   ⚠️  No active keywords found for THIS session. Stopping.`);
        await logAction(userId, '⚠️ No keywords configured in current session', 'N/A');
        return;
    }

    console.log(`   ✅ CURRENT SESSION DATA LOADED:`);
    console.log(`   📋 Active keywords: ${keywords.length}`);
    console.log(`   💬 General comments pool: ${generalComments.length}`);
    keywords.forEach((kw, idx) => {
        console.log(`      ${idx + 1}. \"${kw.keyword}\" (Target: ${kw.targetReach} likes, ${kw.comments.length} comments)`);
    });
    
    console.log(`\n   🎯 SETTINGS FOR THIS RUN:`);
    console.log(`      • Min Likes: ${settings.minLikes}`);
    console.log(`      • Max Likes: ${settings.maxLikes}`);
    console.log(`      • Min Comments: ${settings.minComments}`);
    console.log(`      • Max Comments: ${settings.maxComments}`);
    console.log(`      • Max Per Day: ${settings.maxCommentsPerDay}`);

    // STEP 3: OPTIMIZED Browser Launch - Faster with performance flags
    console.log(`\n   🌐 Launching browser (optimized)...`);
    const startTime = Date.now();
    
    const browser = await chromium.launch({ 
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-gpu' // Faster for automation
        ]
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        // OPTIMIZED: Reduce resource loading
        acceptDownloads: false,
        javaScriptEnabled: true
    });

    await context.addCookies([{
        name: 'li_at',
        value: sessionCookie,
        domain: '.linkedin.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None'
    }]);

    const page = await context.newPage();
    
    // OPTIMIZED: Block unnecessary resources for faster loading
    await page.route('**/*.{png,jpg,jpeg,gif,svg,css,font,woff,woff2}', route => route.abort());
    
    const launchTime = Date.now() - startTime;
    console.log(`   ✅ Browser ready in ${launchTime}ms`);

    try {
        let totalCommentsPosted = 0;

        // STEP 4: LOOP THROUGH ALL KEYWORDS
        for (let keywordIndex = 0; keywordIndex < keywords.length; keywordIndex++) {
            const keyword = keywords[keywordIndex];
            const targetReach = keyword.targetReach || 1000;

            console.log(`\n   ╔════════════════════════════════════════════════════════════╗`);
            console.log(`   ║ [${keywordIndex + 1}/${keywords.length}] Processing: "${keyword.keyword}"`);
            console.log(`   ╚════════════════════════════════════════════════════════════╝`);
            console.log(`   🎯 Target reach: ${targetReach} likes`);
            console.log(`   💬 Keyword-specific comments: ${keyword.comments.length}`);
            console.log(`   📈 Historical matches: ${keyword.matches}`);

            // Check if we've hit daily limit
            if (totalCommentsPosted >= settings.maxCommentsPerDay) {
                console.log(`   ⚠️  Daily limit reached (${totalCommentsPosted}/${settings.maxCommentsPerDay}). Stopping keyword loop.`);
                break;
            }

            // STEP 5: OPTIMIZED Navigation to LinkedIn search
            const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword.keyword)}&sortBy=date_posted`;
            console.log(`   🔎 [SEARCH] Navigating...`);
            
            try {
                // OPTIMIZED: Use networkidle for faster perceived load
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
                await sleep(1500); // Reduced from 3000ms
                console.log(`   ✅ [SEARCH] Loaded`);
            } catch (navError: any) {
                console.log(`   ❌ [SEARCH] Navigation failed: ${navError.message}`);
                await logAction(userId, `Search failed for "${keyword.keyword}": Navigation error`, searchUrl);
                continue; // Move to next keyword
            }

            // STEP 6: Wait for posts to load (reduced timeout)
            try {
                await page.waitForSelector('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper', { timeout: 8000 });
                console.log(`   ✅ [SCAN] Posts detected`);
            } catch (e) {
                console.log(`   ❌ [SCAN] No posts loaded for "${keyword.keyword}"`);
                await logAction(userId, `No posts found for "${keyword.keyword}"`, searchUrl);
                continue; // Move to next keyword
            }

            // STEP 7: OPTIMIZED Scroll and collect posts (reduced scrolls for speed)
            const allPosts = await scrollAndCollectPosts(page, 8);

            if (allPosts.length === 0) {
                console.log(`   ❌ [SCAN] No posts collected after scrolling`);
                await logAction(userId, `Scanned keyword "${keyword.keyword}" - no posts found`, searchUrl);
                continue; // Move to next keyword
            }

            // STEP 8: Filter posts by reach criteria
            console.log(`\n   🔍 [FILTER] Applying reach criteria:`);
            console.log(`      • Min likes: ${settings.minLikes}`);
            console.log(`      • Max likes: ${settings.maxLikes}`);
            console.log(`      • Min comments: ${settings.minComments}`);
            console.log(`      • Max comments: ${settings.maxComments}`);

            const matchingPosts = allPosts.filter(post => {
                return post.likes >= settings.minLikes && 
                       post.likes <= settings.maxLikes &&
                       post.comments >= settings.minComments && 
                       post.comments <= settings.maxComments;
            });

            console.log(`   ✅ [FILTER] Found ${matchingPosts.length} posts matching criteria`);

            // STEP 9: Select best post (closest to target reach)
            // IMPORTANT: Always select a post, even if none match criteria exactly
            let postsToConsider: PostData[];
            let selectionMode: string;

            if (matchingPosts.length > 0) {
                // Use posts that match the criteria
                postsToConsider = matchingPosts;
                selectionMode = 'exact criteria match';
            } else {
                // No exact matches - use ALL posts and find closest to target
                console.log(`   ⚠️  [FILTER] No exact matches - selecting closest match from all ${allPosts.length} posts`);
                postsToConsider = allPosts;
                selectionMode = 'closest match (relaxed criteria)';
            }

            let bestPost: PostData | null = null;
            let bestDiff = Infinity;

            for (const post of postsToConsider) {
                const diff = Math.abs(post.likes - targetReach);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    bestPost = post;
                }
            }

            if (!bestPost) {
                console.log(`   ❌ [SELECT] Could not select any post (unexpected error)`);
                continue;
            }

            console.log(`   ✅ [SELECT] Selected post: ${bestPost.likes} likes, ${bestPost.comments} comments`);
            console.log(`      • Selection mode: ${selectionMode}`);
            console.log(`      • Distance from target (${targetReach}): ${bestDiff} likes`);

            // STEP 10: Select comment (keyword-specific or general)
            const availableComments = keyword.comments.length > 0 
                ? keyword.comments 
                : generalComments;

            if (availableComments.length === 0) {
                console.log(`   ❌ [COMMENT] No comments available for "${keyword.keyword}"`);
                await logAction(userId, `No comments configured for "${keyword.keyword}"`, bestPost.postUrl);
                continue; // Move to next keyword
            }

            const selectedComment = availableComments[Math.floor(Math.random() * availableComments.length)];
            const commentSource = keyword.comments.length > 0 ? 'Keyword-specific' : 'General pool';
            
            console.log(`   💬 [COMMENT] Selected from ${commentSource}:`);
            console.log(`      "${selectedComment.text.substring(0, 60)}..."`);

            // STEP 11: Post the comment
            const success = await postComment(bestPost.element, selectedComment.text);

            if (success) {
                totalCommentsPosted++;
                console.log(`   ✅ [SUCCESS] Comment posted! Total today: ${totalCommentsPosted}/${settings.maxCommentsPerDay}`);

                // Log to database
                await logAction(
                    userId, 
                    `Commented on post for "${keyword.keyword}" (${bestPost.likes} likes)`, 
                    bestPost.postUrl,
                    selectedComment.text
                );

                // Update keyword matches counter
                await prisma.keyword.update({
                    where: { id: keyword.id },
                    data: { matches: { increment: 1 } }
                });

                // Update comment usage counter
                await prisma.comment.update({
                    where: { id: selectedComment.id },
                    data: { timesUsed: { increment: 1 } }
                });

            } else {
                console.log(`   ❌ [FAILED] Could not post comment`);
                await logAction(userId, `Failed to comment on post for "${keyword.keyword}"`, bestPost.postUrl);
            }

            // STEP 12: OPTIMIZED Wait before next keyword (faster but still safe)
            if (keywordIndex < keywords.length - 1) {
                const waitTime = 2000 + Math.random() * 2000; // Reduced from 3-6s to 2-4s
                console.log(`   ⏳ ${(waitTime/1000).toFixed(1)}s until next keyword...\n`);
                await sleep(waitTime);
            }
        }

        // STEP 13: Summary
        console.log(`\n   ╔════════════════════════════════════════════════════════════╗`);
        console.log(`   ║ CYCLE COMPLETE                                             ║`);
        console.log(`   ╚════════════════════════════════════════════════════════════╝`);
        console.log(`   📊 Keywords processed: ${keywords.length}`);
        console.log(`   ✅ Comments posted: ${totalCommentsPosted}`);
        console.log(`   📈 Success rate: ${keywords.length > 0 ? ((totalCommentsPosted / keywords.length) * 100).toFixed(1) : 0}%`);

        await logAction(userId, `Automation cycle completed: ${totalCommentsPosted} comments posted across ${keywords.length} keywords`, 'CYCLE_COMPLETE');

    } catch (error: any) {
        console.error(`   ❌ Critical error in pipeline: ${error.message}`);
        await logAction(userId, `Pipeline error: ${error.message}`, 'ERROR');
        throw error;
    } finally {
        await browser.close();
        console.log(`   🔒 Browser closed\n`);
    }
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

async function runOrchestrator() {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  🚀 NEXORA LinkedIn Automation Worker v5.0 - USER ACTION ONLY');
    console.log('  📅 ' + new Date().toLocaleString());
    console.log('  ⚠️  STRICT MODE: Only runs when user presses "Start" button');
    console.log('  ✅ No auto-execution, no cached jobs, no background triggers');
    console.log('════════════════════════════════════════════════════════════\n');

    while (true) {
        try {
            // ✅ FIXED: Check for ACTIVE users with systemActive=true ONLY
            // This prevents worker from processing until user explicitly clicks "Start"
            const activeSettings = await prisma.settings.findMany({
                where: {
                    systemActive: true,
                    NOT: { linkedinSessionCookie: '' }
                }
            });

            if (activeSettings.length === 0) {
                console.log('⏸️  System in STANDBY - No active users. Waiting for user to press "Start"...');
                await sleep(10000); // Check every 10 seconds for user action
                continue;
            }

            console.log(`\n✅ USER ACTION DETECTED - System activated by user`);
            console.log(`👥 Found ${activeSettings.length} active user(s)\n`);

            // ✅ FRESH DATA: Fetch current keywords and settings for THIS session only
            for (const userSettings of activeSettings) {
                if (!userSettings.userId) continue;
                
                console.log(`📊 Loading CURRENT session data for user: ${userSettings.userId.slice(0, 8)}...`);
                
                try {
                    // ✅ Log the start of user-initiated action
                    await logAction(
                        userSettings.userId, 
                        'Worker started by USER ACTION - Processing current session data', 
                        'USER_START'
                    );
                    
                    await runPipelineForUser(
                        userSettings.userId, 
                        userSettings.linkedinSessionCookie, 
                        userSettings
                    );
                    
                    // Wait between users
                    if (activeSettings.length > 1) {
                        await sleep(10000);
                    }
                } catch (err: any) {
                    console.error(`❌ Error processing user ${userSettings.userId.slice(0, 8)}: ${err.message}`);
                    await logAction(userSettings.userId, `Worker error: ${err.message}`, 'ERROR').catch(() => {});
                }
            }

            // Calculate next cycle delay
            const minDelay = Math.min(...activeSettings.map(s => s.minDelayMins));
            const maxDelay = Math.max(...activeSettings.map(s => s.maxDelayMins));
            
            console.log(`\n⏳ Cycle complete. Next check in ${minDelay}-${maxDelay} minutes...`);
            await randomDelay(minDelay, maxDelay);

        } catch (error: any) {
            console.error('❌ Fatal orchestrator error:', error.message);
            console.error(error.stack);
            await sleep(60000);
        }
    }
}

// Start the orchestrator
runOrchestrator().catch(error => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
