import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Enable CORS for the Chrome Extension
function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

export async function GET(req: Request) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized: Missing User ID header (x-extension-token)' }, { status: 401 }));
    }

    const settings = await prisma.settings.findUnique({
      where: { userId }
    });

    if (!settings || !settings.systemActive) {
      return setCorsHeaders(NextResponse.json({ active: false, message: 'System inactive or user not found' }, { status: 200 }));
    }

    // Get active keywords
    const keywords = await prisma.keyword.findMany({
      where: { userId, active: true },
    });

    if (keywords.length === 0) {
      return setCorsHeaders(NextResponse.json({ active: true, hasJobs: false, message: 'No active keywords found' }, { status: 200 }));
    }

    // Get active comments
    const comments = await prisma.comment.findMany({
      where: { userId },
      select: { id: true, text: true, keywordId: true }
    });

    // Return the settings required for the extension to operate
    return setCorsHeaders(NextResponse.json({
      active: true,
      hasJobs: true,
      settings: {
        minLikes: settings.minLikes || 0,
        minComments: settings.minComments || 0,
        maxLikes: settings.maxLikes || 100000,
        maxComments: settings.maxComments || 100000,
        maxKeywordsPerCycle: 3,
        searchOnlyMode: settings.searchOnlyMode ?? true // Default to true for safety
      },
      keywords: keywords.map(k => ({ id: k.id, keyword: k.keyword })),
      comments: comments // Send available comments to the extension
    }, { status: 200 }));

  } catch (error: any) {
    console.error('Extension Jobs API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
