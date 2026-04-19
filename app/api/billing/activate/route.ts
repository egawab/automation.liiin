import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const userId = await getUserFromToken();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Activation code is required' }, { status: 400 });
    }

    const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });

    if (!promo) {
      return NextResponse.json({ error: 'Invalid activation code. Please check your code and try again.' }, { status: 404 });
    }

    // Check expiration
    if (promo.expiresAt && new Date() > promo.expiresAt) {
      return NextResponse.json({ error: 'This activation code has expired.' }, { status: 410 });
    }

    // Check usage limit
    if (promo.currentUses >= promo.maxUses) {
      return NextResponse.json({ error: 'This activation code has reached its maximum number of uses.' }, { status: 410 });
    }

    // Calculate subscription period (1 year from now)
    const subscriptionEndsAt = new Date();
    subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);

    // Activate the user
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: 'ACTIVE',
        subscriptionEndsAt
      }
    });

    // Increment promo code usage
    await prisma.promoCode.update({
      where: { id: promo.id },
      data: { currentUses: promo.currentUses + 1 }
    });

    return NextResponse.json({
      success: true,
      message: 'Your account has been activated! Enjoy your 1-year subscription.',
      subscriptionEndsAt
    });

  } catch (error: any) {
    console.error('Activation API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
