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
    const { keyword, posts } = body;

    if (!posts || !Array.isArray(posts)) {
      return setCorsHeaders(NextResponse.json({ error: 'Invalid payload: posts array required' }, { status: 400 }));
    }

    let savedCount = 0;
    
    // Process and save posts that meet criteria and don't exist yet
    for (const post of posts) {
      const existing = await prisma.savedPost.findFirst({
        where: { userId, postUrl: post.url }
      });

      if (!existing) {
        await prisma.savedPost.create({
          data: {
            userId,
            postUrl: post.url,
            postAuthor: post.author || 'Unknown',
            postPreview: post.preview || '',
            likes: post.likes || 0,
            comments: post.comments || 0,
            keyword: keyword || 'auto',
            visited: false
          }
        });
        savedCount++;
      }
    }

    // Log the action for dashboard metrics
    await prisma.log.create({
      data: {
        userId,
        action: 'SEARCH',
        postUrl: `ext-search:${keyword}`
      }
    });

    return setCorsHeaders(NextResponse.json({ success: true, savedCount, message: `Saved ${savedCount} new posts.` }, { status: 200 }));

  } catch (error: any) {
    console.error('Extension Results API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
