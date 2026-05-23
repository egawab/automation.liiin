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

    // ── Repair broken postUrls from the normalizeUrl bug ─────────────────────
    // Before the fix, ugcPost URLs were stored as /posts/{number} (invalid LinkedIn URL).
    // Remap them here on-the-fly so enrich works immediately without a DB migration.
    function repairUrl(postUrl: string | null, canonicalUrn: string | null): string {
      if (!postUrl) {
        // Build from URN if postUrl missing
        const m = (canonicalUrn || '').match(/urn:li:(activity|ugcPost|share):(\d{10,25})/);
        if (m) return `https://www.linkedin.com/feed/update/urn:li:${m[1]}:${m[2]}`;
        return '';
      }
      // Detect /posts/{bare_number} pattern (no username = broken ugcPost URL)
      const brokenMatch = postUrl.match(/\/posts\/(\d{10,25})\s*$/);
      if (brokenMatch) {
        // Try to reconstruct from canonicalUrn first
        const urnMatch = (canonicalUrn || '').match(/urn:li:(ugcPost|share):(\d{10,25})/);
        if (urnMatch) return `https://www.linkedin.com/feed/update/urn:li:${urnMatch[1]}:${urnMatch[2]}`;
        return `https://www.linkedin.com/feed/update/urn:li:ugcPost:${brokenMatch[1]}`;
      }
      return postUrl;
    }

    const repairedPosts = posts.map(p => ({
      ...p,
      postUrl: repairUrl(p.postUrl, p.canonicalUrn),
    })).filter(p => p.postUrl); // only return posts with a usable URL

    return setCorsHeaders(NextResponse.json(repairedPosts));
  } catch (error: any) {
    console.error('[API/extension/posts] Error:', error.message);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
