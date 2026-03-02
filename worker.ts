/**
 * NEXORA LinkedIn Automation Worker - REBUILT FOR RELIABILITY v6.0
 * 
 * COMPLETELY REBUILT WITH:
 * ✅ Reliable LinkedIn navigation (no networkidle timeout)
 * ✅ Simple, working post selectors
 * ✅ Real comment verification (checks if comment appears)
 * ✅ Accurate reach matching (exact or closest)
 * ✅ Multi-keyword support (correct comment for each keyword)
 * ✅ No false logs (only logs real actions)
 * ✅ Graceful error handling (skips failures without breaking)
 * 
 * WORKFLOW:
 * 1. User clicks "Start" button
 * 2. Worker loads keywords and comments
 * 3. For EACH keyword:
 *    - Search LinkedIn for keyword
 *    - Load posts and extract reach data
 *    - Filter by exact reach OR select closest
 *    - Post comment with verification
 *    - Log only if comment actually posted
 * 4. Complete and wait for next user action
 */

import { chromium, Browser, Page } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { setApiBaseUrl, setUserContext } from './lib/worker-broadcast';

const prisma = new PrismaClient();

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log action to database - ONLY call when action actually happened
 */
async function logAction(userId: string, action: string, postUrl: string, comment?: string, commentUrl?: string) {
    try {
        await prisma.log.create({
            data: { 
                userId, 
                action, 
                postUrl,
                comment: comment || null,
                commentUrl: commentUrl || null
            }
        });
        console.log(`   ✅ LOGGED: ${action}`);
        if (commentUrl) {
            console.log(`   🔗 Comment URL: ${commentUrl}`);
        }
    } catch (error) {
        console.error('   ❌ Failed to log action:', error);
    }
}

interface PostData {
    element: any;
    likes: number;
    comments: number;
    postUrl: string;
}

/**
 * Extract post metrics - SIMPLIFIED AND RELIABLE
 */
async function extractPostData(postElement: any): Promise<PostData | null> {
    try {
        // Get likes count
        let likes = 0;
        try {
            const likesEl = await postElement.$('.social-details-social-counts__reactions-count');
            if (likesEl) {
                const text = await likesEl.textContent();
                likes = parseInt(text?.replace(/[^0-9]/g, '') || '0') || 0;
            }
        } catch (e) {
            // Likes not found, default to 0
        }

        // Get comments count
        let comments = 0;
        try {
            const commentsEl = await postElement.$('.social-details-social-counts__comments');
            if (commentsEl) {
                const text = await commentsEl.textContent();
                comments = parseInt(text?.replace(/[^0-9]/g, '') || '0') || 0;
            }
        } catch (e) {
            // Comments not found, default to 0
        }

        // Get post URL
        let postUrl = 'unknown';
        try {
            const linkEl = await postElement.$('a[href*="/feed/update/"], a[href*="activity"]');
            if (linkEl) {
                const href = await linkEl.getAttribute('href');
                if (href) {
                    postUrl = href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
                    postUrl = postUrl.split('?')[0]; // Clean URL
                }
            }
        } catch (e) {
            // URL not found
        }

        return { element: postElement, likes, comments, postUrl };
    } catch (error) {
        return null;
    }
}

/**
 * Scroll and collect posts - SIMPLIFIED
 */
async function collectPosts(page: Page): Promise<PostData[]> {
    const allPosts: PostData[] = [];
    const seenUrls = new Set<string>();

    console.log(`   📜 Scrolling to collect posts...`);

    for (let i = 0; i < 5; i++) {
        // Get posts
        const postElements = await page.$$('.feed-shared-update-v2');
        
        // Extract data
        for (const postEl of postElements) {
            const data = await extractPostData(postEl);
            if (data && data.postUrl !== 'unknown' && !seenUrls.has(data.postUrl)) {
                seenUrls.add(data.postUrl);
                allPosts.push(data);
                console.log(`      • Post: ${data.likes} likes, ${data.comments} comments`);
            }
        }

        // Scroll
        if (i < 4) {
            await page.mouse.wheel(0, 1000);
            await sleep(1500);
        }
    }

    console.log(`   ✅ Collected ${allPosts.length} posts`);
    return allPosts;
}

/**
 * Post comment and VERIFY it appears - COMPLETELY REBUILT
 */
async function postCommentWithVerification(
    postElement: any, 
    commentText: string, 
    page: Page
): Promise<{ success: boolean, commentUrl?: string }> {
    try {
        console.log(`   💬 Attempting to post comment...`);

        // Step 1: Click comment button
        const commentBtn = await postElement.$('button[aria-label*="Comment"]');
        if (!commentBtn) {
            console.log(`   ❌ Comment button not found`);
            return { success: false };
        }

        await commentBtn.scrollIntoViewIfNeeded();
        await sleep(500);
        await commentBtn.click();
        await sleep(1500);

        // Step 2: Find editor and type
        const editor = await postElement.$('.ql-editor[contenteditable="true"]');
        if (!editor) {
            console.log(`   ❌ Comment editor not found`);
            return { success: false };
        }

        await editor.click();
        await sleep(300);
        await editor.type(commentText, { delay: 60 });
        await sleep(1000);

        // Step 3: Click submit
        const submitBtn = await postElement.$('.comments-comment-box__submit-button--cr, .comments-comment-box__submit-button');
        if (!submitBtn) {
            console.log(`   ❌ Submit button not found`);
            return { success: false };
        }

        const isEnabled = await submitBtn.isEnabled();
        if (!isEnabled) {
            console.log(`   ❌ Submit button is disabled`);
            return { success: false };
        }

        console.log(`   📤 Submitting comment...`);
        await submitBtn.click();
        
        // Step 4: WAIT and VERIFY
        console.log(`   ⏳ Waiting 4 seconds for LinkedIn to process...`);
        await sleep(4000);

        console.log(`   🔍 Verifying comment appears...`);
        
        // Check if our comment text appears in the page
        const pageText = await page.textContent('body');
        const snippet = commentText.substring(0, 30).toLowerCase();
        
        if (pageText && pageText.toLowerCase().includes(snippet)) {
            console.log(`   ✅ VERIFIED: Comment text found on page!`);
            return { success: true };
        } else {
            console.log(`   ❌ VERIFICATION FAILED: Comment text NOT found on page`);
            return { success: false };
        }

    } catch (error: any) {
        console.log(`   ❌ Error posting comment: ${error.message}`);
        return { success: false };
    }
}

/**
 * Process one keyword - SIMPLIFIED AND RELIABLE
 */
async function processKeyword(
    page: Page,
    keyword: any,
    generalComments: any[],
    settings: any,
    userId: string
): Promise<boolean> {
    const keywordText = keyword.keyword;
    const targetReach = keyword.targetReach || 1000;

    console.log(`\n   ╔══════════════════════════════════════════════════╗`);
    console.log(`   ║ Processing: "${keywordText}"`);
    console.log(`   ╚══════════════════════════════════════════════════╝`);
    console.log(`   🎯 Target reach: ${targetReach} likes`);

    // Step 1: Search LinkedIn
    const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keywordText)}`;
    console.log(`   🔎 Searching LinkedIn...`);

    try {
        // FIXED: Use 'load' instead of 'networkidle' to avoid timeout
        await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });
        await sleep(2000); // Wait for content to load
        console.log(`   ✅ Page loaded`);
    } catch (error: any) {
        console.log(`   ❌ Navigation failed: ${error.message}`);
        await logAction(userId, `❌ Failed to search for "${keywordText}": Navigation error`, searchUrl);
        return false;
    }

    // Step 2: Wait for posts
    try {
        await page.waitForSelector('.feed-shared-update-v2', { timeout: 10000 });
    } catch (error) {
        console.log(`   ❌ No posts found`);
        await logAction(userId, `❌ No posts found for "${keywordText}"`, searchUrl);
        return false;
    }

    // Step 3: Collect posts
    const posts = await collectPosts(page);
    if (posts.length === 0) {
        console.log(`   ❌ No posts collected`);
        await logAction(userId, `❌ No posts collected for "${keywordText}"`, searchUrl);
        return false;
    }

    // Step 4: Filter by reach
    const minLikes = settings.minLikes || 0;
    const maxLikes = settings.maxLikes || 999999;
    const minComments = settings.minComments || 0;
    const maxComments = settings.maxComments || 999999;

    console.log(`   🔍 Filtering: ${minLikes}-${maxLikes} likes, ${minComments}-${maxComments} comments`);

    const matchingPosts = posts.filter(p => 
        p.likes >= minLikes && p.likes <= maxLikes &&
        p.comments >= minComments && p.comments <= maxComments
    );

    console.log(`   ✅ ${matchingPosts.length}/${posts.length} posts match criteria`);

    // Step 5: Select best post (exact match or closest)
    let bestPost: PostData | null = null;
    let bestDiff = Infinity;
    const postsToConsider = matchingPosts.length > 0 ? matchingPosts : posts;

    for (const post of postsToConsider) {
        const diff = Math.abs(post.likes - targetReach);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestPost = post;
        }
    }

    if (!bestPost) {
        console.log(`   ❌ No post selected (this should never happen)`);
        return false;
    }

    console.log(`   ✅ Selected post: ${bestPost.likes} likes, ${bestPost.comments} comments`);
    console.log(`   📏 Distance from target: ${bestDiff} likes`);

    // Step 6: Select comment
    const availableComments = keyword.comments.length > 0 ? keyword.comments : generalComments;
    if (availableComments.length === 0) {
        console.log(`   ❌ No comments available for "${keywordText}"`);
        await logAction(userId, `❌ No comments configured for "${keywordText}"`, bestPost.postUrl);
        return false;
    }

    const selectedComment = availableComments[Math.floor(Math.random() * availableComments.length)];
    const commentSource = keyword.comments.length > 0 ? 'Keyword-specific' : 'General pool';
    
    console.log(`   💬 Comment source: ${commentSource}`);
    console.log(`   💬 Comment: "${selectedComment.text.substring(0, 60)}..."`);

    // Step 7: Post comment with verification
    const result = await postCommentWithVerification(bestPost.element, selectedComment.text, page);

    if (result.success) {
        console.log(`\n   ╔══════════════════════════════════════════════════╗`);
        console.log(`   ║ ✅ COMMENT POSTED AND VERIFIED!`);
        console.log(`   ╚══════════════════════════════════════════════════╝`);

        // Log success
        await logAction(
            userId,
            `✅ Commented on post for "${keywordText}" (${bestPost.likes} likes)`,
            bestPost.postUrl,
            selectedComment.text,
            result.commentUrl
        );

        // Update counters
        await prisma.keyword.update({
            where: { id: keyword.id },
            data: { matches: { increment: 1 } }
        });

        await prisma.comment.update({
            where: { id: selectedComment.id },
            data: { timesUsed: { increment: 1 } }
        });

        return true;
    } else {
        console.log(`\n   ╔══════════════════════════════════════════════════╗`);
        console.log(`   ║ ❌ COMMENT POSTING FAILED`);
        console.log(`   ╚══════════════════════════════════════════════════╝`);

        // Log failure
        await logAction(
            userId,
            `❌ Failed to comment on post for "${keywordText}" (${bestPost.likes} likes)`,
            bestPost.postUrl,
            selectedComment.text
        );

        return false;
    }
}

/**
 * Main worker function
 */
async function runWorker(userId: string, sessionCookie: string, settings: any) {
    console.log(`\n════════════════════════════════════════════════════`);
    console.log(`👤 User: ${userId.slice(0, 8)}...`);
    console.log(`════════════════════════════════════════════════════`);

    // Set user context
    const sessionId = `session-${Date.now()}`;
    setUserContext(userId, sessionId);

    // Load keywords and comments
    const keywords = await prisma.keyword.findMany({
        where: { userId, active: true },
        include: { comments: true }
    });

    const generalComments = await prisma.comment.findMany({
        where: { userId, keywordId: null }
    });

    console.log(`   📋 Keywords: ${keywords.length}`);
    console.log(`   💬 General comments: ${generalComments.length}`);

    if (keywords.length === 0) {
        console.log(`   ❌ No keywords configured`);
        await logAction(userId, '❌ No keywords configured', 'N/A');
        return;
    }

    // Launch browser
    console.log(`\n   🚀 Launching browser...`);
    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
    console.log(`   ✅ Browser ready`);

    let successCount = 0;

    try {
        // Process each keyword
        for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            const success = await processKeyword(page, keyword, generalComments, settings, userId);
            
            if (success) {
                successCount++;
            }

            // Wait between keywords
            if (i < keywords.length - 1) {
                console.log(`\n   ⏳ Waiting 3 seconds before next keyword...`);
                await sleep(3000);
            }
        }

        // Summary
        console.log(`\n   ╔══════════════════════════════════════════════════╗`);
        console.log(`   ║ COMPLETE`);
        console.log(`   ╚══════════════════════════════════════════════════╝`);
        console.log(`   📊 Keywords processed: ${keywords.length}`);
        console.log(`   ✅ Comments posted: ${successCount}`);
        console.log(`   📈 Success rate: ${((successCount / keywords.length) * 100).toFixed(0)}%`);

        await logAction(userId, `Cycle complete: ${successCount}/${keywords.length} comments posted`, 'COMPLETE');

    } finally {
        await browser.close();
        console.log(`   🔒 Browser closed\n`);
    }
}

/**
 * Main orchestrator
 */
async function runOrchestrator() {
    console.log('\n════════════════════════════════════════════════════');
    console.log('  🚀 NEXORA Worker v6.0 - REBUILT FOR RELIABILITY');
    console.log('  📅 ' + new Date().toLocaleString());
    console.log('════════════════════════════════════════════════════\n');

    // Reset all systemActive flags on startup
    console.log('🧹 Resetting active sessions...');
    const resetResult = await prisma.settings.updateMany({
        where: { systemActive: true },
        data: { systemActive: false }
    });
    console.log(`✅ Reset ${resetResult.count} active sessions\n`);

    while (true) {
        try {
            // Check for active users
            const activeSettings = await prisma.settings.findMany({
                where: {
                    systemActive: true,
                    NOT: { linkedinSessionCookie: '' }
                }
            });

            if (activeSettings.length === 0) {
                console.log('⏸️  Standby - waiting for user to press Start...');
                await sleep(10000);
                continue;
            }

            console.log(`\n✅ User action detected - ${activeSettings.length} user(s)\n`);

            // Configure platform URL
            if (activeSettings[0].platformUrl) {
                setApiBaseUrl(activeSettings[0].platformUrl.trim());
            }

            // Process each user
            for (const userSettings of activeSettings) {
                if (!userSettings.userId) continue;

                try {
                    await runWorker(
                        userSettings.userId,
                        userSettings.linkedinSessionCookie,
                        userSettings
                    );
                } catch (error: any) {
                    console.error(`❌ Error processing user: ${error.message}`);
                    await logAction(userSettings.userId, `❌ Worker error: ${error.message}`, 'ERROR');
                }
            }

            // Wait before next cycle
            console.log(`\n⏳ Cycle complete. Waiting for next user action...\n`);
            await sleep(60000);

        } catch (error: any) {
            console.error('❌ Orchestrator error:', error.message);
            await sleep(60000);
        }
    }
}

// Start
runOrchestrator().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
