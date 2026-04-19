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

// GET /api/admin/promos — List all promo codes
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(promos);
}

// POST /api/admin/promos — Create or delete a promo code
export async function POST(req: Request) {
  const adminId = await requireAdmin();
  if (!adminId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { action, code, maxUses, expiresAt, promoId } = await req.json();

  try {
    if (action === 'CREATE') {
      if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 });
      
      const promo = await prisma.promoCode.create({
        data: {
          code: code.trim().toUpperCase(),
          discountType: 'ACTIVATION',
          discountValue: 100,
          maxUses: maxUses || 1,
          currentUses: 0,
          expiresAt: expiresAt ? new Date(expiresAt) : null
        }
      });
      return NextResponse.json({ success: true, promo });
    }

    if (action === 'DELETE') {
      if (!promoId) return NextResponse.json({ error: 'promoId required' }, { status: 400 });
      await prisma.promoCode.delete({ where: { id: promoId } });
      return NextResponse.json({ success: true, message: 'Promo code deleted.' });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A promo code with that name already exists.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
