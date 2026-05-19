import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'PATCH, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

// PATCH /api/extension/enrich
// Called by background.js after enrichSinglePost() captures a score.
// Only updates rows where engagementScore IS NULL (never overwrites existing scores).
export async function PATCH(req: NextRequest) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const body = await req.json();
    const { urn, score } = body;

    if (!urn || typeof urn !== 'string') {
      return setCorsHeaders(NextResponse.json({ error: 'Invalid urn' }, { status: 400 }));
    }

    // Validate score: must be a non-negative integer, or null
    let safeScore: number | null = null;
    if (score !== null && score !== undefined) {
      const n = Math.round(Number(score));
      if (Number.isFinite(n) && n >= 0 && n <= 10_000_000) safeScore = n;
    }

    // Only update rows that are currently unscored — never overwrite existing data
    const result = await prisma.savedPost.updateMany({
      where: {
        userId,
        canonicalUrn: urn,
        engagementScore: null,
      },
      data: {
        engagementScore: safeScore,
      },
    });

    return setCorsHeaders(NextResponse.json({
      ok: true,
      updated: result.count,
      urn,
      score: safeScore,
    }));

  } catch (error: any) {
    console.error('[API/enrich] Error:', error.message);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
