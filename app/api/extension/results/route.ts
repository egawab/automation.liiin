import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Enable CORS for the Chrome extension
function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

export async function POST(req: Request) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized: Missing User ID' }, { status: 401 }));
    }

    const body = await req.json();
    const { keyword, posts, linkedInProfileId, debugInfo } = body;

    // ── LinkedIn Identity Auto-Binding ──
    if (linkedInProfileId && linkedInProfileId !== 'Unknown') {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { linkedInProfileId: true } });
        if (user && !user.linkedInProfileId) {
          // First time: bind this LinkedIn identity to this account
          const existingBinding = await prisma.user.findUnique({ where: { linkedInProfileId } });
          if (existingBinding && existingBinding.id !== userId) {
            // Another account already uses this LinkedIn profile
            return setCorsHeaders(NextResponse.json({
              error: 'DUPLICATE_IDENTITY',
              message: 'This LinkedIn profile is already linked to another account.'
            }, { status: 403 }));
          }
          await prisma.user.update({ where: { id: userId }, data: { linkedInProfileId } });
          console.log(`[Identity] 🔗 Bound LinkedIn "${linkedInProfileId}" to user ${userId}`);
        } else if (user && user.linkedInProfileId && user.linkedInProfileId !== linkedInProfileId) {
          // Mismatch: this user is bound to a different LinkedIn profile
          return setCorsHeaders(NextResponse.json({
            error: 'IDENTITY_MISMATCH',
            message: 'Your account is bound to a different LinkedIn profile. Contact support.'
          }, { status: 403 }));
        }
      } catch(e) { console.error('[Identity] Binding error:', e); }
    }

    if (debugInfo) {
      console.log(`[Ext-Diagnostic] User ${userId} reported empty page for ${keyword}. Snippet:`, debugInfo);
    }

    if (!posts || !Array.isArray(posts)) {
      return setCorsHeaders(NextResponse.json({ error: 'Invalid payload: posts array required' }, { status: 400 }));
    }

    // 1. Log the action for dashboard metrics (First, to ensure we track the attempt)
    try {
        await prisma.log.create({
          data: {
            userId,
            action: 'SEARCH',
            postUrl: posts.length === 0 && debugInfo ? `ext-search:DEBUG_EMPTY_PAGE` : `ext-search:CONTENT`,
            comment: debugInfo || (posts.length > 0 ? `KEYWORD: ${keyword} | FOUND: ${posts.length}` : `KEYWORD: ${keyword}`)
          }
        });
    } catch(e) { console.error("Log creation failed:", e); }

    let savedCount = 0;
    let updatedCount = 0;
    let errors: string[] = [];
    
    // Process posts in parallel for maximum performance
    if (posts && posts.length > 0) {
        const results = await Promise.allSettled(posts.map(async (post) => {
            // Quality Gate: Relaxed to allow all real extracted posts through.
            const postLikes = Number(post.likes || 0);
            const postComments = Number(post.comments || 0);

            // Check for existing post for THIS user
            const existing = await prisma.savedPost.findFirst({
              where: { userId, postUrl: post.url }
            });
    
            if (!existing) {
              await prisma.savedPost.create({
                data: {
                  userId,
                  postUrl: post.url,
                  postAuthor: String(post.author || 'Unknown').substring(0, 100),
                  postPreview: String(post.preview || '').substring(0, 1000),
                  likes: postLikes,
                  comments: postComments,
                  keyword: String(keyword || 'auto').substring(0, 50),
                  visited: false
                }
              });
              return 'saved';
            } else {
              // OPTIMIZATION: Update reach metrics for existing post to show "Action"
              await prisma.savedPost.update({
                where: { id: existing.id },
                data: {
                  likes: postLikes,
                  comments: postComments,
                  postPreview: post.preview ? String(post.preview).substring(0, 1000) : undefined,
                  savedAt: new Date() // Refresh timestamp to show it was recently seen
                }
              });
              return 'updated';
            }
        }));

        // Analyze results
        const rejected = results.filter(r => r.status === 'rejected');
        if (rejected.length > 0) {
            rejected.forEach((r: any) => {
                const errStr = r.reason?.message || String(r.reason);
                console.error(`[API] Prisma Error:`, errStr);
                errors.push(errStr);
            });

            // STRICT REQUIREMENT: If ALL posts failed to save, the API MUST throw a 500 error
            // so the extension knows it failed and doesn't log a "fake success".
            if (rejected.length === posts.length) {
                throw new Error(`CRITICAL PRISMA FAILURE: All ${posts.length} posts failed to save. First error: ${errors[0]}`);
            }
        }

        savedCount = results.filter(r => r.status === 'fulfilled' && r.value === 'saved').length;
        updatedCount = results.filter(r => r.status === 'fulfilled' && r.value === 'updated').length;
    }

    return setCorsHeaders(NextResponse.json({ 
      success: true, 
      savedCount, 
      updatedCount, 
      errors,
      message: `Processed ${posts.length} posts. ${savedCount} New, ${updatedCount} Refreshed.` 
    }, { status: 200 }));

  } catch (error: any) {
    console.error('Extension Results API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
