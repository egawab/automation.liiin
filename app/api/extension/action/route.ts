import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

export async function POST(req: Request) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const { action, postUrl, comment, keyword } = await req.json();

    if (!action) {
      return setCorsHeaders(NextResponse.json({ error: 'Action required' }, { status: 400 }));
    }

    await prisma.log.create({
      data: {
        userId,
        action,
        postUrl: postUrl || 'system',
        comment: comment || null,
      }
    });

    return setCorsHeaders(NextResponse.json({ success: true }));

  } catch (error: any) {
    console.error('Extension Action API Error:', error);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
