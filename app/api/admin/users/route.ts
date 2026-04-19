import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserFromToken } from '@/lib/auth';

async function requireAdmin() {
  const userId = await getUserFromToken();
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (!user?.isAdmin) return null;
  return userId;
}

// GET /api/admin/users — List all users with subscription info
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      isAdmin: true,
      linkedInProfileId: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      subscriptionEndsAt: true,
      createdAt: true,
      _count: { select: { savedPosts: true, logs: true, keywords: true, comments: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  return NextResponse.json(users);
}

// POST /api/admin/users — Update a user's subscription or admin status
export async function POST(req: Request) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { userId, action, value } = await req.json();

  if (!userId || !action) {
    return NextResponse.json({ error: 'userId and action are required' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'ACTIVATE': {
        const subscriptionEndsAt = new Date();
        subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt }
        });
        return NextResponse.json({ success: true, message: 'User activated for 1 year.' });
      }
      case 'DEACTIVATE': {
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'EXPIRED', subscriptionEndsAt: new Date() }
        });
        return NextResponse.json({ success: true, message: 'User deactivated.' });
      }
      case 'EXTEND_TRIAL': {
        const days = Number(value) || 30;
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + days);
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'TRIAL', trialEndsAt }
        });
        return NextResponse.json({ success: true, message: `Trial extended for ${days} days.` });
      }
      case 'SET_ADMIN': {
        await prisma.user.update({
          where: { id: userId },
          data: { isAdmin: value === true }
        });
        return NextResponse.json({ success: true, message: `Admin status set to ${value}.` });
      }
      case 'DELETE': {
        await prisma.user.delete({ where: { id: userId } });
        return NextResponse.json({ success: true, message: 'User deleted.' });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
