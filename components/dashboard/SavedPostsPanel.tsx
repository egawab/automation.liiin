'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  ExternalLink, Trash2, Eye, Filter, Search,
  ThumbsUp, MessageCircle, BarChart2, Target,
  Calendar, ChevronDown, ChevronRight, X, RefreshCw
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SavedPost {
  id: string;
  postUrl: string;
  postAuthor: string | null;
  postPreview: string | null;
  likes: number | null;
  comments: number | null;
  keyword: string;
  savedAt: string;
  visited: boolean;
}

interface SplitGroup {
  fresh: SavedPost[];
  older: SavedPost[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function splitByRecency(posts: SavedPost[]): SplitGroup {
  if (posts.length === 0) return { fresh: [], older: [] };
  const maxTime = Math.max(...posts.map(p => new Date(p.savedAt).getTime()));
  return {
    fresh: posts.filter(p => maxTime - new Date(p.savedAt).getTime() < TWO_HOURS_MS),
    older: posts.filter(p => maxTime - new Date(p.savedAt).getTime() >= TWO_HOURS_MS),
  };
}

function getValidUrl(post: SavedPost): string {
  let url = post.postUrl;
  if (url.startsWith('discovered:') || url.startsWith('synthetic:')) {
    return `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(post.keyword)}&origin=GLOBAL_SEARCH_HEADER`;
  }
  if (!url.startsWith('http')) return 'https://' + url.replace(/^\/*/, '');
  return url;
}

function getEngagementRating(likes: number | null, comments: number | null) {
  if (likes == null) return { label: 'Unknown', color: 'neutral' as const };
  const score = likes + (comments ?? 0) * 2;
  if (score > 1000) return { label: 'Viral',  color: 'error'   as const };
  if (score > 200)  return { label: 'High',   color: 'warning' as const };
  if (score > 50)   return { label: 'Medium', color: 'info'    as const };
  return               { label: 'Normal', color: 'neutral' as const };
}

// ─── Memoized Post Card ───────────────────────────────────────────────────────
// Wrapped in memo so it only re-renders when its own props change.
// content-visibility: auto is set via inline style for browser-native virtualization.
const PostCard = memo(function PostCard({
  post,
  onOpen,
  onDelete,
}: {
  post: SavedPost;
  onOpen: (e: React.MouseEvent, post: SavedPost) => void;
  onDelete: (id: string) => void;
}) {
  const rating = getEngagementRating(post.likes, post.comments);

  return (
    <div
      className={`relative group bg-surface rounded-lg border flex flex-col transition-colors duration-150 ${
        post.visited ? 'border-subtle opacity-70' : 'border-apple-blue/30 apple-shadow'
      }`}
      // Browser-native virtualization: skip layout+paint for off-screen cards
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 320px' } as React.CSSProperties}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-subtle flex justify-between items-center">
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 w-7 h-7 rounded-full bg-surface-hover flex items-center justify-center text-primary text-xs font-semibold">
            {post.postAuthor ? post.postAuthor[0].toUpperCase() : '?'}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-primary truncate leading-tight">
              {post.postAuthor || 'Unknown'}
            </h4>
            <div className="flex items-center gap-1 text-xs text-secondary">
              <Calendar className="w-3 h-3 shrink-0" />
              {new Date(post.savedAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <Badge variant={rating.color} size="sm">{rating.label}</Badge>
          {!post.visited
            ? <Badge variant="error"   size="sm" dot>New</Badge>
            : <Badge variant="neutral" size="sm" icon={<Eye className="w-3 h-3" />}>Seen</Badge>
          }
        </div>
      </div>

      {/* Full post text */}
      <div className="px-4 py-3 flex-1">
        {post.postPreview ? (
          <p className="text-sm text-primary leading-relaxed whitespace-pre-line">{post.postPreview}</p>
        ) : (
          <p className="text-xs italic text-secondary">No preview available.</p>
        )}
      </div>

      {/* Metrics */}
      <div className="px-4 py-2 bg-surface-hover border-t border-b border-subtle flex items-center gap-5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <ThumbsUp className="w-3.5 h-3.5 text-apple-blue" />
          {post.likes    != null ? post.likes.toLocaleString()    : '—'}
        </span>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <MessageCircle className="w-3.5 h-3.5 text-apple-blue" />
          {post.comments != null ? post.comments.toLocaleString() : '—'}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-secondary ml-auto">
          <BarChart2 className="w-3 h-3" /> {rating.label} Reach
        </span>
      </div>

      {/* Actions */}
      <div className="p-3 grid grid-cols-3 gap-2">
        <Button onClick={(e) => onOpen(e, post)} variant="primary"    size="sm" className="col-span-2 text-xs">
          <ExternalLink className="w-3.5 h-3.5" /> Engage
        </Button>
        <Button onClick={(e) => onOpen(e, post)} variant="secondary"  size="sm" disabled={post.visited} title="View on LinkedIn">
          <Eye className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Delete */}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
        className="absolute top-2 right-2 text-[rgba(255,255,255,0.3)] hover:text-[#ff3b30] p-1.5 transition-colors opacity-0 group-hover:opacity-100"
        aria-label="Delete post"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});

// ─── Post section (fresh or older) inside a keyword group ────────────────────
const PostSection = memo(function PostSection({
  label,
  posts,
  defaultCollapsed,
  onOpen,
  onDelete,
}: {
  label: string;
  posts: SavedPost[];
  defaultCollapsed?: boolean;
  onOpen: (e: React.MouseEvent, post: SavedPost) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(!defaultCollapsed);
  if (posts.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 mb-2 text-xs font-semibold text-secondary hover:text-primary transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {label}
        <span className="ml-1 px-1.5 py-0.5 rounded bg-surface-hover text-tertiary">{posts.length}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {posts.map(post => (
            <PostCard key={post.id} post={post} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </div>
      )}
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
  keyword: string;
  posts: SavedPost[];
  onOpen: (e: React.MouseEvent, post: SavedPost) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const { fresh, older } = splitByRecency(posts);
  const freshCount = posts.filter(p => !p.visited).length;

  return (
    <div className="bg-surface-elevated rounded-xl border border-subtle overflow-hidden">
      {/* Keyword header */}
      <button
        id={`kw-group-${keyword.replace(/\s+/g, '-')}`}
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
          <Badge variant="info"  size="sm">{posts.length} posts</Badge>
          {freshCount > 0 && <Badge variant="error" size="sm" dot>{freshCount} new</Badge>}
        </div>
        <span className="text-xs text-tertiary">{open ? 'collapse' : 'expand'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-subtle">
          <PostSection
            label="Latest Results"
            posts={fresh}
            defaultCollapsed={false}
            onOpen={onOpen}
            onDelete={onDelete}
          />
          <PostSection
            label="Previous Results"
            posts={older}
            defaultCollapsed={true}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
});

// ─── Main panel ───────────────────────────────────────────────────────────────
export function SavedPostsPanel() {
  const [posts, setPosts]                       = useState<SavedPost[]>([]);
  const [initialLoading, setInitialLoading]     = useState(true);
  const [refreshing, setRefreshing]             = useState(false);
  const [searchTerm, setSearchTerm]             = useState('');
  const [filterVisited, setFilterVisited]       = useState<string>('all');
  const [likesFilterActive, setLikesFilterActive] = useState(false);

  // Track whether this is the very first fetch (show spinner) or a background refresh (no spinner)
  const isFirstFetch = useRef(true);
  // Stable reference to the latest posts so interval callback doesn't capture stale data
  const postsRef = useRef<SavedPost[]>([]);

  const fetchPosts = useCallback(async (isManual = false) => {
    const showSpinner = isFirstFetch.current || isManual;
    if (showSpinner) {
      if (isFirstFetch.current) setInitialLoading(true);
      else setRefreshing(true);
    }

    try {
      let url = '/api/saved-posts?';
      if (filterVisited !== 'all') url += `visited=${filterVisited}&`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;

      const incoming: SavedPost[] = await res.json();

      // Only call setPosts if data actually changed — prevents scroll-resetting re-renders
      const prev = postsRef.current;
      const changed =
        incoming.length !== prev.length ||
        incoming.some((p, i) => p.id !== prev[i]?.id || p.visited !== prev[i]?.visited || p.likes !== prev[i]?.likes);

      if (changed) {
        postsRef.current = incoming;
        setPosts(incoming);
      }
    } catch (err) {
      console.error('[SavedPostsPanel] fetch error:', err);
    } finally {
      if (isFirstFetch.current) {
        setInitialLoading(false);
        isFirstFetch.current = false;
      }
      if (isManual) setRefreshing(false);
    }
  }, [filterVisited]);

  // Initial + filter-change fetch
  useEffect(() => {
    isFirstFetch.current = true;
    fetchPosts();
  }, [fetchPosts]);

  // Background refresh every 30s — no spinner, no scroll jump
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

  const openPost = useCallback((e: React.MouseEvent, post: SavedPost) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(getValidUrl(post), '_blank', 'noopener,noreferrer');
    markVisited(post.id);
  }, [markVisited]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = posts.filter(post => {
    if (filterVisited === 'true'  && !post.visited) return false;
    if (filterVisited === 'false' &&  post.visited) return false;
    if (likesFilterActive && (post.likes == null || post.likes < 10)) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        post.keyword.toLowerCase().includes(s) ||
        !!post.postAuthor?.toLowerCase().includes(s) ||
        !!post.postPreview?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  // Group by keyword (preserving insertion order)
  const grouped = filtered.reduce<Record<string, SavedPost[]>>((acc, post) => {
    (acc[post.keyword] ??= []).push(post);
    return acc;
  }, {});
  const keywords = Object.keys(grouped);

  // Stats
  const totalSaved  = posts.length;
  const totalShown  = filtered.length;
  const freshLeads  = filtered.filter(p => !p.visited).length;
  const kwCount     = new Set(posts.map(p => p.keyword)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-tile-heading text-primary">Lead Intelligence Hub</h2>
          <p className="text-caption text-secondary mt-1">
            All extracted posts — grouped by keyword. Filter when ready.
          </p>
        </div>
        <Button
          onClick={() => fetchPosts(true)}
          variant="secondary"
          size="sm"
          disabled={refreshing}
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Syncing…' : 'Manual Sync'}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">Total Saved</div>
          <div className="text-4xl font-bold text-primary leading-none">{totalSaved}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-apple-blue/30">
          <div className="text-xs font-bold uppercase tracking-wider text-apple-blue mb-1 flex justify-between">
            Showing <span className="w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse" />
          </div>
          <div className="text-4xl font-bold text-primary leading-none">{totalShown}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">Fresh Leads</div>
          <div className="text-4xl font-bold text-primary leading-none">{freshLeads}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-xs font-bold uppercase tracking-wider text-secondary mb-1">Keywords</div>
          <div className="text-4xl font-bold text-primary leading-none">{kwCount}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-surface-elevated rounded-lg border border-subtle p-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search */}
          <div className="relative md:col-span-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary w-4 h-4" />
            <input
              type="text"
              placeholder="Search content or authors…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-surface-hover border-none rounded-md text-sm text-primary placeholder-tertiary focus:ring-1 focus:ring-apple-blue transition-all outline-none"
            />
          </div>
          {/* Status */}
          <div className="md:col-span-3 relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary w-4 h-4 pointer-events-none" />
            <select
              value={filterVisited}
              onChange={e => setFilterVisited(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-surface-hover border-none rounded-md text-sm text-primary appearance-none focus:ring-1 focus:ring-apple-blue transition-all outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="false">Unvisited (Hot)</option>
              <option value="true">Visited</option>
            </select>
          </div>
          {/* Manual 10+ likes toggle */}
          <div className="md:col-span-4 flex items-center gap-2">
            <button
              id="btn-filter-10-likes"
              onClick={() => setLikesFilterActive(v => !v)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all border ${
                likesFilterActive
                  ? 'bg-apple-blue text-white border-apple-blue'
                  : 'bg-surface-hover text-primary border-subtle hover:border-apple-blue/50'
              }`}
            >
              <ThumbsUp className="w-3.5 h-3.5" />
              {likesFilterActive ? '10+ Likes (ON)' : 'Filter 10+ Likes'}
            </button>
            {likesFilterActive && (
              <button onClick={() => setLikesFilterActive(false)} className="p-2 text-tertiary hover:text-primary transition-colors" title="Clear filter">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      {initialLoading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-subtle border-t-apple-blue animate-spin mx-auto mb-4" />
          <p className="text-sm text-secondary">Loading posts…</p>
        </div>
      ) : keywords.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-tertiary" />
          </div>
          <h3 className="text-sm font-semibold text-primary mb-2">No Posts Found</h3>
          <p className="text-xs text-secondary max-w-sm mx-auto">
            {likesFilterActive
              ? 'No posts match the 10+ likes filter. Try turning it off to see all results.'
              : 'Your AI worker is currently scouting the network. Posts will appear here once extracted.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4 pb-12">
          {keywords.map(keyword => (
            <KeywordGroup
              key={keyword}
              keyword={keyword}
              posts={grouped[keyword]}
              onOpen={openPost}
              onDelete={deletePost}
            />
          ))}
        </div>
      )}
    </div>
  );
}
