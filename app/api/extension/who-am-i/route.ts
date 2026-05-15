import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Enable CORS for the scraper (runs locally)
function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, x-linkedin-cookie');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

/**
 * GET /api/extension/who-am-i
 *
 * Dynamically resolves which dashboard userId owns the currently active
 * LinkedIn session. This replaces the old hardcoded userId in config.json.
 *
 * The scraper reads the `li_at` cookie from the live browser session and
 * sends it here. We look up which user has stored that cookie in their
 * Settings.linkedinSessionCookie and return their userId.
 *
 * Headers:
 *   x-linkedin-cookie: <value of the li_at cookie from the browser>
 */
export async function GET(req: Request) {
  try {
    const liAt = req.headers.get('x-linkedin-cookie');
    if (!liAt || liAt.length < 10) {
      return setCorsHeaders(
        NextResponse.json({ error: 'x-linkedin-cookie header is required' }, { status: 400 })
      );
    }

    // Look up the user whose stored LinkedIn session cookie matches the active one
    const settings = await prisma.settings.findFirst({
      where: { linkedinSessionCookie: liAt },
      select: { userId: true },
    });

    if (!settings) {
      return setCorsHeaders(
        NextResponse.json({
          found: false,
          error: 'No dashboard account linked to this LinkedIn session. Go to Settings → LinkedIn Session in the dashboard and save your session cookie.',
        }, { status: 404 })
      );
    }

    // Verify the user is active (not expired/banned)
    const user = await prisma.user.findUnique({
      where: { id: settings.userId },
      select: { id: true, subscriptionStatus: true, isAdmin: true, isBanned: true },
    });

    if (!user || user.isBanned) {
      return setCorsHeaders(
        NextResponse.json({ found: false, error: 'Account is inactive or banned.' }, { status: 403 })
      );
    }

    return setCorsHeaders(
      NextResponse.json({ found: true, userId: settings.userId })
    );

  } catch (error: any) {
    console.error('who-am-i error:', error);
    return setCorsHeaders(
      NextResponse.json({ error: error.message }, { status: 500 })
    );
  }
}
