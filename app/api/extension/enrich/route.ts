import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

function setCorsHeaders(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'PATCH, DELETE, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Extension-Token');
  return res;
}

export async function OPTIONS() {
  return setCorsHeaders(NextResponse.json({}, { status: 200 }));
}

// ── Audit log helper ──────────────────────────────────────────────────────────
// Writes a human-readable log entry to the Log table for every score change.
async function writeAuditLog(userId: string, urn: string, oldScore: number | null, newScore: number | null, reason: string) {
  try {
    await prisma.log.create({
      data: {
        userId,
        action: 'ENRICH_SCORE_CHANGE',
        postUrl: urn,
        comment: `SCORE: ${oldScore ?? 'null'} → ${newScore ?? 'null'} | REASON: ${reason}`,
      },
    });
  } catch (_) {
    // Audit log failures must never crash the main flow
    console.warn('[API/enrich] Audit log write failed for urn=' + urn);
  }
}

// ── PATCH /api/extension/enrich ───────────────────────────────────────────────
// Smart overwrite rules:
//   1. force=true   → always overwrite (no conditions)
//   2. old=null     → always write (first-time score)
//   3. old=-1       → always overwrite (was uncertain sentinel)
//   4. old=0        → always overwrite (likely detection failure)
//   5. new > old    → overwrite (better/higher score wins)
//   6. otherwise    → skip (don't downgrade a known-good score)
export async function PATCH(req: NextRequest) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const body = await req.json();
    const { urn, score, force } = body;

    if (!urn || typeof urn !== 'string') {
      return setCorsHeaders(NextResponse.json({ error: 'Invalid urn' }, { status: 400 }));
    }

    // Validate score: integer in [-1, 10_000_000], or null
    // -1 is the "uncertain" sentinel — stored as-is
    let safeScore: number | null = null;
    if (score !== null && score !== undefined) {
      const n = Math.round(Number(score));
      if (Number.isFinite(n) && n >= -1 && n <= 10_000_000) safeScore = n;
    }

    // Fetch the current row so we can apply smart overwrite logic
    const existing = await prisma.savedPost.findFirst({
      where: { userId, canonicalUrn: urn },
      select: { id: true, engagementScore: true },
    });

    if (!existing) {
      console.warn('[API/enrich] PATCH: row not found for urn=' + urn);
      return setCorsHeaders(NextResponse.json({ ok: false, reason: 'not_found', urn }));
    }

    const oldScore = existing.engagementScore !== undefined ? existing.engagementScore : null;

    // ── Overwrite decision ────────────────────────────────────────────────────
    let shouldWrite = false;
    let reason = '';

    if (force === true) {
      shouldWrite = true;
      reason = 'force=true';
    } else if (oldScore === null) {
      shouldWrite = true;
      reason = 'first-time score (was null)';
    } else if (oldScore === -1) {
      shouldWrite = true;
      reason = 'overwriting uncertain sentinel (-1)';
    } else if (oldScore === 0) {
      shouldWrite = true;
      reason = 'overwriting likely-wrong zero score';
    } else if (safeScore !== null && safeScore > oldScore) {
      shouldWrite = true;
      reason = 'new score (' + safeScore + ') > old score (' + oldScore + ')';
    } else {
      shouldWrite = false;
      reason = 'skipped — old score (' + oldScore + ') >= new score (' + safeScore + ') and not forced';
    }

    console.log('[API/enrich] PATCH urn=' + urn + ' old=' + oldScore + ' new=' + safeScore + ' force=' + force + ' → ' + (shouldWrite ? 'WRITE' : 'SKIP') + ' | ' + reason);

    if (!shouldWrite) {
      return setCorsHeaders(NextResponse.json({
        ok: true,
        updated: 0,
        skipped: true,
        reason,
        urn,
        oldScore,
        newScore: safeScore,
      }));
    }

    // Write the new score
    const result = await prisma.savedPost.updateMany({
      where: { userId, canonicalUrn: urn },
      data: { engagementScore: safeScore },
    });

    // Write audit log for every actual change
    await writeAuditLog(userId, urn, oldScore, safeScore, reason);

    return setCorsHeaders(NextResponse.json({
      ok: true,
      updated: result.count,
      urn,
      oldScore,
      newScore: safeScore,
      reason,
    }));

  } catch (error: any) {
    console.error('[API/enrich] PATCH Error:', error.message);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}

// ── DELETE /api/extension/enrich?urn=... ──────────────────────────────────────
// Deletes a post that fell below the engagement threshold.
// Returns the pre-deletion score in the response for audit traceability.
export async function DELETE(req: NextRequest) {
  try {
    const userId = req.headers.get('x-extension-token');
    if (!userId) {
      return setCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    }

    const { searchParams } = new URL(req.url);
    const urn = searchParams.get('urn');
    const scoreParam = searchParams.get('score'); // optional — for audit log

    if (!urn) {
      return setCorsHeaders(NextResponse.json({ error: 'Missing urn' }, { status: 400 }));
    }

    // Fetch the score before deletion for the audit log
    const existing = await prisma.savedPost.findFirst({
      where: { userId, canonicalUrn: urn },
      select: { engagementScore: true },
    });
    const scoreAtDeletion = existing?.engagementScore ?? null;

    const result = await prisma.savedPost.deleteMany({
      where: { userId, canonicalUrn: urn },
    });

    // Audit log: record the deletion and score at time of delete
    await writeAuditLog(
      userId, urn,
      scoreAtDeletion,
      null,
      'AUTO-DELETE: score=' + scoreAtDeletion + ' (confirmed by re-check)'
    );

    console.log('[API/enrich] DELETE urn=' + urn + ' score-at-deletion=' + scoreAtDeletion + ' deleted=' + result.count);

    return setCorsHeaders(NextResponse.json({
      ok: true,
      deleted: result.count,
      urn,
      scoreAtDeletion,
    }));
  } catch (error: any) {
    console.error('[API/enrich/delete] Error:', error.message);
    return setCorsHeaders(NextResponse.json({ error: error.message }, { status: 500 }));
  }
}
