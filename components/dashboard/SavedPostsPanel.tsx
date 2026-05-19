'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  ExternalLink, Trash2, Search, Target,
  Calendar, ChevronDown, ChevronRight, RefreshCw, Copy, Check,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SavedPost {
  id:        string;
  postUrl:   string;
  keyword:   string;
  savedAt:   string;
  visited:   boolean;
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

      {/* URL */}
      <span
        className="flex-1 text-xs font-mono text-secondary truncate"
        title={post.postUrl}
      >
        {post.postUrl}
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
        <button
          onClick={() => onOpen(post)}
          className="p-1.5 rounded-md text-tertiary hover:text-apple-blue transition-colors"
          title="Open in LinkedIn"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
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

// ─── Keyword group ────────────────────────────────────────────────────────────
const KeywordGroup = memo(function KeywordGroup({
  keyword,
  posts,
  onOpen,
  onDelete,
}: {
  keyword:  string;
  posts:    SavedPost[];
  onOpen:   (post: SavedPost) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const freshCount = posts.filter(p => !p.visited).length;

  // Sort newest first
  const sorted = [...posts].sort(
    (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
  );

  return (
    <div className="rounded-xl border border-subtle overflow-hidden" style={{ background: 'var(--dash-surface-1)' }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          {open
            ? <ChevronDown  className="w-4 h-4 text-apple-blue" />
            : <ChevronRight className="w-4 h-4 text-tertiary" />
          }
          <Target className="w-4 h-4 text-apple-blue" />
          <span className="text-sm font-semibold text-primary">{keyword}</span>
          <Badge variant="info"  size="sm">{posts.length} links</Badge>
          {freshCount > 0 && <Badge variant="error" size="sm" dot>{freshCount} new</Badge>}
        </div>
        <span className="text-xs text-tertiary">{open ? 'collapse' : 'expand'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 space-y-1 border-t border-subtle">
          {sorted.map(post => (
            <UrlRow key={post.id} post={post} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Main panel ───────────────────────────────────────────────────────────────
export function SavedPostsPanel() {
  const [posts, setPosts]         = useState<SavedPost[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const postsRef = useRef<SavedPost[]>([]);

  const fetchPosts = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const res = await fetch('/api/saved-posts', { credentials: 'include' });
      if (!res.ok) return;
      const incoming: SavedPost[] = await res.json();

      const prev = postsRef.current;
      const changed =
        incoming.length !== prev.length ||
        incoming.some((p, i) => p.id !== prev[i]?.id || p.visited !== prev[i]?.visited);

      if (changed) {
        postsRef.current = incoming;
        setPosts(incoming);
      }
    } catch (err) {
      console.error('[SavedPostsPanel] fetch error:', err);
    } finally {
      setLoading(false);
      if (isManual) setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => fetchPosts(false), 30_000);
    return () => clearInterval(id);
  }, [fetchPosts]);

  const markVisited = useCallback(async (postId: string) => {
    try {
      await fetch('/api/saved-posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, visited: true }),
      });
      setPosts(prev => {
        const next = prev.map(p => p.id === postId ? { ...p, visited: true } : p);
        postsRef.current = next;
        return next;
      });
    } catch {}
  }, []);

  const deletePost = useCallback(async (postId: string) => {
    try {
      await fetch(`/api/saved-posts?id=${postId}`, { method: 'DELETE', credentials: 'include' });
      setPosts(prev => {
        const next = prev.filter(p => p.id !== postId);
        postsRef.current = next;
        return next;
      });
    } catch {}
  }, []);

  const openPost = useCallback((post: SavedPost) => {
    if (post.postUrl) {
      window.open(post.postUrl, '_blank', 'noopener,noreferrer');
      markVisited(post.id);
    }
  }, [markVisited]);

  // ── Copy all URLs for a keyword ──────────────────────────────────────────────
  const [copiedKw, setCopiedKw] = useState<string | null>(null);
  const copyAllForKeyword = useCallback((keyword: string, kwPosts: SavedPost[]) => {
    const urls = kwPosts.map(p => p.postUrl).filter(Boolean).join('\n');
    navigator.clipboard.writeText(urls).then(() => {
      setCopiedKw(keyword);
      setTimeout(() => setCopiedKw(null), 2000);
    });
  }, []);

  // ── Filter ────────────────────────────────────────────────────────────────────
  const filtered = posts.filter(post => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return post.keyword.toLowerCase().includes(s) || post.postUrl.toLowerCase().includes(s);
  });

  // Group by keyword
  const grouped = filtered.reduce<Record<string, SavedPost[]>>((acc, post) => {
    (acc[post.keyword] ??= []).push(post);
    return acc;
  }, {});
  const keywords = Object.keys(grouped).sort();

  const totalUrls  = posts.length;
  const freshCount = posts.filter(p => !p.visited).length;
  const kwCount    = new Set(posts.map(p => p.keyword)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-tile-heading text-primary">Saved Post Links</h2>
          <p className="text-caption text-secondary mt-1">
            Direct LinkedIn post URLs — grouped by keyword. Click any link to open it.
          </p>
        </div>
        <Button onClick={() => fetchPosts(true)} variant="secondary" size="sm" disabled={refreshing}>
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
          <div className="text-xs font-bold uppercase tracking-wider text-apple-blue mb-1">New</div>
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
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-subtle border-t-apple-blue animate-spin mx-auto mb-4" />
          <p className="text-sm text-secondary">Loading…</p>
        </div>
      ) : keywords.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-tertiary" />
          </div>
          <h3 className="text-sm font-semibold text-primary mb-2">No Links Yet</h3>
          <p className="text-xs text-secondary max-w-sm mx-auto">
            {searchTerm
              ? 'No results match your search.'
              : 'Start the extension on a LinkedIn content search page to collect post URLs.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4 pb-12">
          {keywords.map(keyword => (
            <div key={keyword} className="rounded-xl border border-subtle overflow-hidden" style={{ background: 'var(--dash-surface-1)' }}>
              {/* Keyword header */}
              <div className="px-5 py-3 flex items-center gap-3" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                <Target className="w-4 h-4 text-apple-blue shrink-0" />
                <span className="text-sm font-bold text-primary">{keyword}</span>
                <Badge variant="info" size="sm">{grouped[keyword].length} links</Badge>
                <div className="ml-auto">
                  <button
                    onClick={() => copyAllForKeyword(keyword, grouped[keyword])}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-semibold transition-colors"
                    style={{ background: 'var(--dash-surface-3)', color: 'var(--text-secondary)' }}
                    title="Copy all URLs"
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
                {[...grouped[keyword]]
                  .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
                  .map(post => (
                    <UrlRow key={post.id} post={post} onOpen={openPost} onDelete={deletePost} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
