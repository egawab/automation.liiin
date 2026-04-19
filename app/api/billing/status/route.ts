import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const userId = await getUserFromToken();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isAdmin: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        subscriptionEndsAt: true,
        linkedInProfileId: true,
        createdAt: true
      }
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const now = new Date();
    let effectiveStatus = user.subscriptionStatus || 'TRIAL';
    let daysRemaining = 0;
    const isAdmin = user.isAdmin === true;

    // Admins never expire
    if (isAdmin) {
      effectiveStatus = 'ACTIVE';
      daysRemaining = 999;
    } else if (effectiveStatus === 'TRIAL' && user.trialEndsAt) {
      const diff = user.trialEndsAt.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      if (daysRemaining === 0) {
        effectiveStatus = 'EXPIRED';
      }
    } else if (effectiveStatus === 'ACTIVE' && user.subscriptionEndsAt) {
      const diff = user.subscriptionEndsAt.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
      if (daysRemaining === 0) {
        effectiveStatus = 'EXPIRED';
      }
    }

    return NextResponse.json({
      status: effectiveStatus,
      daysRemaining,
      isAdmin,
      trialEndsAt: user.trialEndsAt,
      subscriptionEndsAt: user.subscriptionEndsAt,
      linkedInProfileId: user.linkedInProfileId,
      createdAt: user.createdAt
    });

  } catch (error: any) {
    console.error('Subscription Status API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
