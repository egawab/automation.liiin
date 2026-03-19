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
    const { keyword, posts, debugInfo } = body;

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
    
    // Process posts in parallel for maximum performance
    if (posts && posts.length > 0) {
        await Promise.all(posts.map(async (post) => {
          try {
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
                  likes: Number(post.likes || 0),
                  comments: Number(post.comments || 0),
                  keyword: String(keyword || 'auto').substring(0, 50),
                  visited: false
                }
              });
              savedCount++;
            } else {
              // OPTIMIZATION: Update reach metrics for existing post to show "Action"
              await prisma.savedPost.update({
                where: { id: existing.id },
                data: {
                  likes: Number(post.likes || 0),
                  comments: Number(post.comments || 0),
                  savedAt: new Date() // Refresh timestamp to show it was recently seen
                }
              });
              updatedCount++;
            }
          } catch (err) {
            console.warn(`[API] Failed to process post ${post.url}:`, err);
          }
        }));
    }

    return setCorsHeaders(NextResponse.json({ 
      success: true, 
      savedCount, 
      updatedCount, 
      message: `Processed ${posts.length} posts. ${savedCount} New, ${updatedCount} Refreshed.` 
    }, { status: 200 }));

  } catch (error: any) {
    console.error('Extension Results API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
