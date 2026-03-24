import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    const { status, message, cycles, isPaused } = await req.json();

    // Find user's settings profile
    const settings = await prisma.settings.findUnique({
      where: { userId }
    });

    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }

    // Format the status string for the dashboard
    let fullStatus = status || 'Online';
    if (message) fullStatus += ` - ${message}`;
    if (cycles !== undefined) fullStatus += ` (Cycles: ${cycles})`;
    
    // Update heartbeat and status
    await prisma.settings.update({
      where: { userId },
      data: {
        lastHeartbeat: new Date(),
        extensionStatus: fullStatus
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Heartbeat Route Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
