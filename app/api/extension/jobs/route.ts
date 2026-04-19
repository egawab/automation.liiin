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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subscriptionStatus: true, trialEndsAt: true, subscriptionEndsAt: true }
    });

    if (!user) {
      return setCorsHeaders(NextResponse.json({ error: 'User not found' }, { status: 404 }));
    }

    // ── Subscription Gatekeeper ──
    const now = new Date();
    if (user.subscriptionStatus === 'TRIAL' && user.trialEndsAt && now > user.trialEndsAt) {
      return setCorsHeaders(NextResponse.json({
        active: false,
        subscriptionExpired: true,
        message: 'Your 30-day free trial has ended. Please contact sddeeoossa@gmail.com to activate your account.'
      }, { status: 200 }));
    }
    if (user.subscriptionStatus === 'EXPIRED') {
      return setCorsHeaders(NextResponse.json({
        active: false,
        subscriptionExpired: true,
        message: 'Your subscription has expired. Please contact sddeeoossa@gmail.com to renew.'
      }, { status: 200 }));
    }
    if (user.subscriptionStatus === 'ACTIVE' && user.subscriptionEndsAt && now > user.subscriptionEndsAt) {
      // Auto-expire
      await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'EXPIRED' } });
      return setCorsHeaders(NextResponse.json({
        active: false,
        subscriptionExpired: true,
        message: 'Your subscription has expired. Please contact sddeeoossa@gmail.com to renew.'
      }, { status: 200 }));
    }

    const settings = await prisma.settings.findUnique({
      where: { userId }
    });

    if (!settings || !settings.systemActive) {
      return setCorsHeaders(NextResponse.json({ active: false, message: 'System inactive or user not found' }, { status: 200 }));
    }

    // Get active comment campaign keywords
    const keywords = await prisma.keyword.findMany({
      where: { userId, active: true },
    });

    let hasValidSearchConfig = false;
    if (settings.searchOnlyMode && settings.searchConfigJson) {
      try {
         const parsed = JSON.parse(settings.searchConfigJson);
         if (Array.isArray(parsed) && parsed.length > 0) {
           const validKeywords = parsed.flat().filter(kw => typeof kw === 'string' && kw.trim().length > 0);
           if (validKeywords.length > 0) hasValidSearchConfig = true;
         }
      } catch(e) {}
    }

    if (keywords.length === 0 && !hasValidSearchConfig) {
      return setCorsHeaders(NextResponse.json({ active: true, hasJobs: false, message: 'No active campaigns or search configs found' }, { status: 200 }));
    }

    // Get active comments
    const comments = await prisma.comment.findMany({
      where: { userId },
      select: { id: true, text: true, keywordId: true, cycleIndex: true }
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
        searchOnlyMode: settings.searchOnlyMode ?? true, // Default to true for safety
        searchConfigJson: settings.searchConfigJson || "[]"
      },
      keywords: keywords.map(k => ({ id: k.id, keyword: k.keyword, targetCycles: k.targetCycles || 1 })),
      comments: comments.map(c => ({ id: c.id, text: c.text, keywordId: c.keywordId, cycleIndex: c.cycleIndex || 1 }))
    }, { status: 200 }));

  } catch (error: any) {
    console.error('Extension Jobs API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
