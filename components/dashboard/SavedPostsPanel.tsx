'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  ExternalLink, Trash2, Search, Target,
  Clock, RefreshCw, Copy, Check, AlertCircle,
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

// ─── Types ────────────────────────────────────────────────────────────────────
interface SavedPost {
  id:        string;
  postUrl:   string;
  keyword:   string;
  savedAt:   string;
  visited:   boolean;
  // optional fields that may be present but are not displayed
  postAuthor?:  string | null;
  postPreview?: string | null;
  canonicalUrn?: string | null;
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
  const [copiedKw, setCopiedKw]     = useState<string | null>(null);

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
  }, []); // no deps — never recreated

  // Initial load
  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Auto-refresh every 20s (shorter so new URLs appear quickly after a run)
  useEffect(() => {
    const id = setInterval(() => fetchPosts(false), 20_000);
    return () => clearInterval(id);
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

  // ── Filter & group ──────────────────────────────────────────────────────────
  const filtered = searchTerm
    ? posts.filter(p => {
        const s = searchTerm.toLowerCase();
        return p.keyword?.toLowerCase().includes(s) || p.postUrl?.toLowerCase().includes(s);
      })
    : posts;

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

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalUrls  = posts.length;
  const freshCount = posts.filter(p => !p.visited).length;
  const kwCount    = new Set(posts.map(p => p.keyword || '')).size;

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
        <Button
          onClick={() => fetchPosts(true)}
          variant="secondary"
          size="sm"
          disabled={refreshing || status === 'loading'}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Syncing…' : 'Refresh'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
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
