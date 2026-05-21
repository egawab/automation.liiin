'use client';

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  ExternalLink, Trash2, Search, Target,
  Clock, RefreshCw, Copy, Check, AlertCircle, Zap,
} from 'lucide-react';

function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1)  return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffH = Math.floor(diffMins / 60);
  if (diffH < 24)    return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

// ─── Types ──────────────────────────────────────────────────────────────────────────────
interface SavedPost {
  id:               string;
  postUrl:          string;
  keyword:          string;
  savedAt:          string;
  visited:          boolean;
  engagementScore?: number | null;  // null = unscored (always shown)
  postAuthor?:      string | null;
  postPreview?:     string | null;
  canonicalUrn?:    string | null;
}

// ─── Single URL row ───────────────────────────────────────────────────────────
const UrlRow = memo(function UrlRow({
  post,
  onOpen,
  onDelete,
}: {
  post:     SavedPost;
  onOpen:   (post: SavedPost) => void;
  onDelete: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(post.postUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const displayUrl = post.postUrl || '(no URL)';
  const isValidUrl = post.postUrl?.startsWith('http');
  const score      = post.engagementScore;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg group transition-colors ${
        post.visited ? 'opacity-60' : ''
      }`}
      style={{ background: 'var(--dash-surface-2)' }}
    >
      {/* New dot */}
      {!post.visited && (
        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse" />
      )}

      {/* Relative time */}
      <span className="shrink-0 text-[10px] text-tertiary hidden sm:flex items-center gap-1 min-w-[52px]">
        <Clock className="w-3 h-3" />
        {relativeTime(post.savedAt)}
      </span>

      {/* Engagement score badge */}
      {score !== null && score !== undefined && (
        <span
          className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
            score >= 10 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700/60 text-zinc-400'
          }`}
          title={`Engagement score: ${score}`}
        >
          {score >= 1000 ? `${(score / 1000).toFixed(1)}k` : score}
        </span>
      )}

      {/* URL */}
      <span
        className="flex-1 text-xs font-mono text-secondary truncate"
        title={displayUrl}
      >
        {displayUrl}
      </span>

      {/* Actions — visible on hover */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md text-tertiary hover:text-primary transition-colors"
          title="Copy URL"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
        {isValidUrl && (
          <button
            onClick={() => onOpen(post)}
            className="p-1.5 rounded-md text-tertiary hover:text-apple-blue transition-colors"
            title="Open in LinkedIn"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
          className="p-1.5 rounded-md text-tertiary hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
});

// ─── Main panel ───────────────────────────────────────────────────────────────
export function SavedPostsPanel() {
  const [posts, setPosts]           = useState<SavedPost[]>([]);
  const [status, setStatus]         = useState<'loading' | 'ok' | 'error'>('loading');
  const [errorMsg, setErrorMsg]     = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [engagementFilter, setEngagementFilter] = useState<'all' | 'scored' | 'high'>('all');
  const [copiedKw, setCopiedKw]     = useState<string | null>(null);

  // ── Enrich state ─────────────────────────────────────────────────────────────
  type EnrichState = { running: boolean; done: number; total: number; enriched: number; failed: number; deleted: number; nullCount: number; currentKeyword: string };
  const [enrich, setEnrich] = useState<EnrichState>({ running: false, done: 0, total: 0, enriched: 0, failed: 0, deleted: 0, nullCount: 0, currentKeyword: '' });
  const enrichRunningRef = useRef(false); // track previous running state to detect finish

  const [enrichKeyword, setEnrichKeyword] = useState<string>('all');

  // autoEnrich → localStorage (reliable, synchronous) + chrome.storage.sync as secondary
  const [autoEnrich, setAutoEnrich] = useState<boolean>(() => localStorage.getItem('nexora_autoenrich') === 'true');

  // autoDelete + deleteThreshold → persisted in localStorage directly (reliable, no bridge timing)
  const [autoDelete, setAutoDelete]         = useState<boolean>(() => localStorage.getItem('nexora_autodel') === 'true');
  const [deleteThreshold, setDeleteThreshold] = useState<number>(() => parseInt(localStorage.getItem('nexora_threshold') || '10', 10));
  const [showDeleteWarning, setShowDeleteWarning] = useState(false);

  // Save autoEnrich to localStorage + DB + chrome.storage.sync via bridge
  const saveAutoEnrichFlag = useCallback((val: boolean) => {
    localStorage.setItem('nexora_autoenrich', String(val));
    // Persist to DB directly (bulletproof)
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoEnrich: val })
    }).catch(() => {});

    window.postMessage({
      source: 'NEXORA_DASHBOARD',
      action: 'SAVE_AUTO_ENRICH',
      autoEnrich: val,
      autoDelete,
      deleteThreshold,
    }, '*');
  }, [autoDelete, deleteThreshold]);

  // ── Fetch posts ─────────────────────────────────────────────────────────────
  const fetchPosts = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);

    let incoming: SavedPost[] = [];
    let fetchOk = false;

    try {
      const res = await fetch('/api/saved-posts', { credentials: 'include' });

      if (res.ok) {
        const data = await res.json();
        incoming = Array.isArray(data) ? data : [];
        fetchOk = true;
        setErrorMsg('');
      } else {
        const body = await res.text().catch(() => '');
        const msg = `API error ${res.status}: ${body.substring(0, 100)}`;
        console.error('[SavedPostsPanel]', msg);
        setErrorMsg(msg);
      }
    } catch (err: any) {
      const msg = err?.message || 'Network error';
      console.error('[SavedPostsPanel] fetch failed:', msg);
      setErrorMsg(msg);
    }

    // Always update state regardless of success/failure
    if (fetchOk) {
      // Sort newest first
      incoming.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
      setPosts(incoming);
      setStatus('ok');
    } else if (status === 'loading') {
      // First load failed — show error instead of spinner
      setStatus('error');
    }

    if (isManual) setRefreshing(false);
  }, [status]);

  // Initial load
  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Auto-refresh every 20s (shorter so new URLs appear quickly after a run)
  useEffect(() => {
    const id = setInterval(() => fetchPosts(false), 20_000);
    return () => clearInterval(id);
  }, [fetchPosts]);

  // autoEnrich is now in localStorage — no need to fetch from chrome.storage.sync on mount
  // (The old GET_AUTO_ENRICH was overwriting localStorage state with stale storage values)

  // ── Polling: GET_ENRICH_STATUS every 1.5s while enrichment is running ──────────────
  // This is the primary progress mechanism. Push-based messages are unreliable in MV3.
  useEffect(() => {
    if (!enrich.running) return;
    const id = setInterval(() => {
      window.postMessage({ source: 'NEXORA_DASHBOARD', action: 'GET_ENRICH_STATUS' }, '*');
    }, 1500);
    return () => clearInterval(id);
  }, [enrich.running]);

  // ── Listen for enrichment status / config from bridge ────────────────────────────
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (!e.data || e.data.source !== 'NEXORA_EXTENSION') return;

      // autoEnrich is now in localStorage — ignore AUTO_ENRICH_CFG to avoid overwriting local state
      // if (e.data.action === 'AUTO_ENRICH_CFG') { setAutoEnrich(!!e.data.autoEnrich); }

      // Polled progress response — primary mechanism for live updates
      if (e.data.action === 'ENRICH_STATUS') {
        const wasRunning = enrichRunningRef.current;
        enrichRunningRef.current = !!e.data.running;
        setEnrich(prev => ({
          ...prev,
          running:        !!e.data.running,
          done:           e.data.done           ?? prev.done,
          total:          e.data.total          ?? prev.total,
          enriched:       e.data.enriched       ?? prev.enriched,
          failed:         e.data.failed         ?? prev.failed,
          deleted:        e.data.deleted        ?? prev.deleted,
          nullCount:      e.data.nullCount      ?? prev.nullCount,
          currentKeyword: e.data.currentKeyword ?? prev.currentKeyword,
        }));
        // When enrichment transitions from running → done, refresh post list
        if (wasRunning && !e.data.running) fetchPosts(true);
      }

      // Final push broadcast from background — backup for ENRICH_STATUS
      if (e.data.action === 'ENRICH_DONE') {
        enrichRunningRef.current = false;
        setEnrich(prev => ({
          ...prev,
          running: false,
          done: e.data.total ?? prev.total, total: e.data.total ?? prev.total,
          enriched: e.data.enriched ?? prev.enriched, failed: e.data.failed ?? prev.failed,
          deleted: e.data.deleted ?? prev.deleted, nullCount: e.data.nullCount ?? prev.nullCount,
        }));
        fetchPosts(true);
      }

      // Handle bridge errors (like extension context invalidated)
      if (e.data.action === 'ENGINE_ERROR') {
        alert(e.data.error || 'Extension communication error.');
        setEnrich(prev => ({ ...prev, running: false }));
        enrichRunningRef.current = false;
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [fetchPosts]);

  // ── Mark visited ────────────────────────────────────────────────────────────
  const markVisited = useCallback(async (postId: string) => {
    // Optimistic update
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, visited: true } : p));
    try {
      await fetch('/api/saved-posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, visited: true }),
      });
    } catch {}
  }, []);

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deletePost = useCallback(async (postId: string) => {
    // Optimistic update
    setPosts(prev => prev.filter(p => p.id !== postId));
    try {
      await fetch(`/api/saved-posts?id=${postId}`, { method: 'DELETE', credentials: 'include' });
    } catch {}
  }, []);

  // ── Open ────────────────────────────────────────────────────────────────────
  const openPost = useCallback((post: SavedPost) => {
    if (post.postUrl?.startsWith('http')) {
      window.open(post.postUrl, '_blank', 'noopener,noreferrer');
      markVisited(post.id);
    }
  }, [markVisited]);

  // ── Copy all for keyword ────────────────────────────────────────────────────
  const copyAllForKeyword = useCallback((keyword: string, kwPosts: SavedPost[]) => {
    const urls = kwPosts.map(p => p.postUrl).filter(u => u?.startsWith('http')).join('\n');
    if (!urls) return;
    navigator.clipboard.writeText(urls).then(() => {
      setCopiedKw(keyword);
      setTimeout(() => setCopiedKw(null), 2000);
    });
  }, []);

  // ── Start enrichment ─────────────────────────────────────────────────────────
  const startEnrich = useCallback(async () => {
    if (enrich.running) return;
    
    // Fetch unscored posts from the API, optionally filtered by keyword
    const url = enrichKeyword === 'all' 
      ? '/api/saved-posts?unscored=true' 
      : `/api/saved-posts?unscored=true&keyword=${encodeURIComponent(enrichKeyword)}`;
      
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const unscored: SavedPost[] = await res.json();
    if (!unscored.length) {
      alert(`All ${enrichKeyword !== 'all' ? `"${enrichKeyword}" ` : ''}posts are already scored — nothing to enrich!`);
      return;
    }
    const queue = unscored
      .filter(p => p.canonicalUrn && p.postUrl)
      .map(p => ({ urn: p.canonicalUrn!, url: p.postUrl }));
    if (!queue.length) return;

    setEnrich({ running: true, done: 0, total: queue.length, enriched: 0, failed: 0, deleted: 0, nullCount: 0, currentKeyword: enrichKeyword === 'all' ? 'Multiple' : enrichKeyword });

    // Send to background.js via the existing dashboard-bridge postMessage channel
    window.postMessage({
      source: 'NEXORA_DASHBOARD',
      action: 'RE_ENRICH',
      posts:  queue,
      autoDelete,
      deleteThreshold,
      currentKeyword: enrichKeyword === 'all' ? 'Multiple' : enrichKeyword
    }, '*');
  }, [enrich.running, enrichKeyword, autoDelete, deleteThreshold]);

  // ── Filter & group ──────────────────────────────────────────────────────────
  const engFiltered = posts.filter(p => {
    if (engagementFilter === 'all')    return true;
    if (engagementFilter === 'scored') return p.engagementScore != null;
    if (engagementFilter === 'high')   return (p.engagementScore ?? 0) >= 10;
    return true;
  });

  const filtered = searchTerm
    ? engFiltered.filter(p => {
        const s = searchTerm.toLowerCase();
        return p.keyword?.toLowerCase().includes(s) || p.postUrl?.toLowerCase().includes(s);
      })
    : engFiltered;

  const grouped = filtered.reduce<Record<string, SavedPost[]>>((acc, p) => {
    const kw = p.keyword || 'Uncategorized';
    (acc[kw] ??= []).push(p);
    return acc;
  }, {});

  // Sort keyword groups by their most-recently saved URL (newest first).
  // This ensures a freshly completed run always floats to the top.
  const keywords = Object.keys(grouped).sort((a, b) => {
    const latestA = Math.max(...grouped[a].map(p => new Date(p.savedAt).getTime()));
    const latestB = Math.max(...grouped[b].map(p => new Date(p.savedAt).getTime()));
    return latestB - latestA;
  });

  const unscoredCountByKw = (kw: string) => {
    if (kw === 'all') return posts.filter(p => p.engagementScore == null).length;
    return grouped[kw]?.filter(p => p.engagementScore == null).length || 0;
  };
  const enrichTargetCount = unscoredCountByKw(enrichKeyword);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalUrls    = posts.length;
  const freshCount   = posts.filter(p => !p.visited).length;
  const kwCount      = new Set(posts.map(p => p.keyword || '')).size;
  const highEngCount = posts.filter(p => (p.engagementScore ?? 0) >= 10).length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-tile-heading text-primary">Saved Post Links</h2>
          <p className="text-caption text-secondary mt-1">
            Direct LinkedIn post URLs — grouped by keyword.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex flex-col gap-1.5 items-end">
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer text-secondary hover:text-primary transition-colors">
                <input 
                  type="checkbox" 
                  className="rounded border-subtle bg-surface-elevated text-apple-blue focus:ring-0 focus:ring-offset-0"
                  checked={autoEnrich}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setAutoEnrich(v);
                    saveAutoEnrichFlag(v);
                  }}
                />
                Auto-Enrich after Scrape
              </label>
              <div className="w-px h-3 bg-subtle"></div>
              <label className="flex items-center gap-1.5 cursor-pointer text-secondary hover:text-primary transition-colors" title="Automatically delete enriched posts with score below threshold">
                <input 
                  type="checkbox" 
                  className="rounded border-subtle bg-surface-elevated text-red-500 focus:ring-0 focus:ring-offset-0"
                  checked={autoDelete}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setAutoDelete(v);
                    localStorage.setItem('nexora_autodel', String(v));
                    // Persist to DB directly
                    fetch('/api/settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ autoDelete: v })
                    }).catch(() => {});
                    saveAutoEnrichFlag(autoEnrich); // sync chrome.storage too
                  }}
                />
                Auto-Delete if score &lt;
              </label>
              <input 
                type="number"
                className="w-12 h-6 px-1.5 text-xs rounded border border-subtle bg-surface-elevated text-primary focus:border-apple-blue focus:ring-0"
                value={deleteThreshold}
                min={1}
                max={9999}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 10;
                  setDeleteThreshold(val);
                  localStorage.setItem('nexora_threshold', String(val));
                  // Persist to DB directly
                  fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deleteThreshold: val })
                  }).catch(() => {});
                }}
                disabled={!autoDelete}
              />
            </div>
            
            <div className="flex items-center gap-2 mt-1">
              <select
                className="text-xs h-8 px-2 rounded-md border border-subtle bg-surface-elevated text-primary focus:border-apple-blue focus:ring-0"
                value={enrichKeyword}
                onChange={(e) => setEnrichKeyword(e.target.value)}
                disabled={enrich.running}
              >
                <option value="all">All Keywords ({unscoredCountByKw('all')} unscored)</option>
                {keywords.map(kw => {
                  const u = unscoredCountByKw(kw);
                  return (
                    <option key={kw} value={kw}>{kw} ({u} unscored)</option>
                  );
                })}
              </select>
              
              <Button
                onClick={() => fetchPosts(true)}
                variant="secondary"
                size="sm"
                className="h-8"
                disabled={refreshing || status === 'loading' || enrich.running}
              >
                <RefreshCw className={`w-3 h-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Syncing…' : 'Refresh'}
              </Button>
              <Button
                onClick={startEnrich}
                variant="secondary"
                size="sm"
                className="h-8"
                disabled={enrich.running || enrichTargetCount === 0}
                title={`Enrich ${enrichTargetCount} unscored posts`}
              >
                <Zap className={`w-3 h-3 mr-1.5 ${enrich.running ? 'animate-pulse text-amber-400' : ''}`} />
                {enrich.running ? `Enriching ${enrich.done}/${enrich.total}…` : 'Enrich'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Enrichment progress bar */}
      {(enrich.running || enrich.total > 0) && (
        <div className="bg-surface-elevated rounded-lg p-4 border border-amber-500/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-amber-400 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              {enrich.running 
                ? `Enriching engagement scores${enrich.currentKeyword ? ` for "${enrich.currentKeyword}"` : ''}…` 
                : 'Enrichment complete'}
            </span>
            <span className="text-xs text-tertiary">
              {enrich.enriched} scored · {enrich.deleted} deleted · {enrich.nullCount + enrich.failed} unavailable · {enrich.done}/{enrich.total}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-amber-400 transition-all duration-500"
              style={{ width: enrich.total > 0 ? `${Math.round((enrich.done / enrich.total) * 100)}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">Total Links</div>
          <div className="text-4xl font-bold text-primary leading-none">{totalUrls}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-apple-blue/30 text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-apple-blue mb-1 flex items-center justify-center gap-1">
            New <span className="w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse inline-block" />
          </div>
          <div className="text-4xl font-bold text-primary leading-none">{freshCount}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">Keywords</div>
          <div className="text-4xl font-bold text-primary leading-none">{kwCount}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-emerald-500/30 text-center">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">High Engagement</div>
          <div className="text-4xl font-bold text-emerald-400 leading-none">{highEngCount}</div>
        </div>
      </div>

      {/* Engagement filter toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-tertiary font-medium">Engagement:</span>
        {(['all', 'scored', 'high'] as const).map(f => (
          <button
            key={f}
            onClick={() => setEngagementFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              engagementFilter === f
                ? 'bg-apple-blue text-white border-apple-blue'
                : 'border-subtle text-secondary hover:border-apple-blue/50'
            }`}
          >
            {f === 'all'    && 'All posts'}
            {f === 'scored' && 'Scored only'}
            {f === 'high'   && '10+ interactions'}
          </button>
        ))}
        {engagementFilter !== 'all' && (
          <span className="text-xs text-tertiary ml-1">— showing {filtered.length} of {totalUrls}</span>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary w-4 h-4" />
        <input
          type="text"
          placeholder="Filter by keyword or URL…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 bg-surface-elevated border border-subtle rounded-lg text-sm text-primary placeholder-tertiary focus:ring-1 focus:ring-apple-blue outline-none transition-all"
        />
      </div>

      {/* Content */}
      {status === 'loading' ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-subtle border-t-apple-blue animate-spin mx-auto mb-4" />
          <p className="text-sm text-secondary">Loading…</p>
        </div>

      ) : status === 'error' ? (
        <div className="py-16 text-center">
          <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-sm font-semibold text-primary mb-2">Could not load posts</h3>
          <p className="text-xs text-red-400 max-w-sm mx-auto mb-4">{errorMsg}</p>
          <Button onClick={() => { setStatus('loading'); fetchPosts(true); }} variant="secondary" size="sm">
            Retry
          </Button>
        </div>

      ) : keywords.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-tertiary" />
          </div>
          <h3 className="text-sm font-semibold text-primary mb-2">No Links Yet</h3>
          <p className="text-xs text-secondary max-w-sm mx-auto">
            {searchTerm
              ? 'No results match your search. Try a different keyword.'
              : 'Start the extension on a LinkedIn content search page to collect post URLs.'}
          </p>
        </div>

      ) : (
        <div className="space-y-4 pb-12">
          {keywords.map((keyword, idx) => {
            const kwPosts = grouped[keyword];
            const latestSavedAt = kwPosts.reduce((mx, p) => {
              const t = new Date(p.savedAt).getTime();
              return t > mx ? t : mx;
            }, 0);
            const isNewest = idx === 0;
            return (
              <div
                key={keyword}
                className={`rounded-xl overflow-hidden ${
                  isNewest ? 'border border-apple-blue/40' : 'border border-subtle'
                }`}
                style={{ background: 'var(--dash-surface-1)' }}
              >
                {/* Keyword header */}
                <div
                  className="px-5 py-3 flex items-center gap-3"
                  style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}
                >
                  <Target className="w-4 h-4 text-apple-blue shrink-0" />
                  <span className="text-sm font-bold text-primary">{keyword}</span>
                  <Badge variant="info" size="sm">{kwPosts.length} links</Badge>
                  {isNewest && (
                    <Badge variant="primary" size="sm">Latest</Badge>
                  )}
                  {kwPosts.some(p => !p.visited) && (
                    <Badge variant="error" size="sm" dot>
                      {kwPosts.filter(p => !p.visited).length} new
                    </Badge>
                  )}
                  {/* Recency label */}
                  <span className="text-[10px] text-tertiary flex items-center gap-1 ml-1">
                    <Clock className="w-3 h-3" />
                    {relativeTime(new Date(latestSavedAt).toISOString())}
                  </span>
                  <div className="ml-auto">
                    <button
                      onClick={() => copyAllForKeyword(keyword, kwPosts)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-semibold transition-colors"
                      style={{ background: 'var(--dash-surface-3)', color: 'var(--text-secondary)' }}
                      title="Copy all URLs for this keyword"
                    >
                      {copiedKw === keyword
                        ? <><Check className="w-3.5 h-3.5 text-green-400" /> Copied!</>
                        : <><Copy className="w-3.5 h-3.5" /> Copy All</>
                      }
                    </button>
                  </div>
                </div>

                {/* URL list */}
                <div className="px-4 py-3 space-y-1">
                  {kwPosts.map(post => (
                    <UrlRow
                      key={post.id}
                      post={post}
                      onOpen={openPost}
                      onDelete={deletePost}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
