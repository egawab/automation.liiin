import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

// GET /api/extension/posts
// Allows background.js to fetch unscored posts using x-extension-token auth
// (since it cannot send cookies easily for /api/saved-posts)
export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const { searchParams } = new URL(req.url);
    const keywordsParam = searchParams.get('keywords'); // comma-separated

    const whereClause: any = { userId };
    
    // FIX: include -1 sentinel (uncertain) posts alongside null (never-attempted) posts
    // so background.js auto-enrich re-attempts them instead of leaving them permanently stuck.
    const unscored = searchParams.get('unscored') === 'true';
    const includeUncertain = searchParams.get('includeUncertain') === 'true';
    if (unscored) {
      if (includeUncertain) {
        whereClause.OR = [
          { engagementScore: null },
          { engagementScore: -1 },
        ];
      } else {
        whereClause.engagementScore = null;
      }
    }

    if (keywordsParam) {
      const kws = keywordsParam.split(',').map(k => k.trim()).filter(Boolean);
      if (kws.length > 0) {
        whereClause.keyword = { in: kws };
      }
    }

    const posts = await prisma.savedPost.findMany({
      where: whereClause,
      select: {
        id: true,
        canonicalUrn: true,
        postUrl: true,
        keyword: true,
      }
    });

    return setCorsHeaders(NextResponse.json(posts));
  } catch (error: any) {
    console.error('[API/extension/posts] Error:', error.message);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
