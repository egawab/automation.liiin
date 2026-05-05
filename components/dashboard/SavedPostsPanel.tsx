'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import {
  ExternalLink, Trash2, Eye, Filter, Search,
  ThumbsUp, MessageCircle, BarChart2, Target,
  Calendar, ChevronDown, ChevronRight, X
} from 'lucide-react';

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

export function SavedPostsPanel() {
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVisited, setFilterVisited] = useState<string>('all');
  // manual filter — OFF by default (show everything first)
  const [likesFilterActive, setLikesFilterActive] = useState(false);
  // which keyword groups are expanded
  const [expandedKeywords, setExpandedKeywords] = useState<Set<string>>(new Set());

  useEffect(() => { fetchPosts(); }, [filterVisited]);
  useEffect(() => {
    const interval = setInterval(() => fetchPosts(), 30000);
    return () => clearInterval(interval);
  }, [filterVisited]);

  async function fetchPosts() {
    try {
      setLoading(true);
      let url = '/api/saved-posts?';
      if (filterVisited !== 'all') url += `visited=${filterVisited}&`;
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data: SavedPost[] = await response.json();
        setPosts(data);
        // Auto-expand all keyword groups on first load
        const kws = new Set(data.map(p => p.keyword));
        setExpandedKeywords(kws);
      }
    } catch (error) {
      console.error('Error fetching saved posts:', error);
    } finally {
      setLoading(false);
    }
  }

  async function markAsVisited(postId: string) {
    try {
      await fetch('/api/saved-posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, visited: true })
      });
      setPosts(posts.map(p => p.id === postId ? { ...p, visited: true } : p));
    } catch (error) {}
  }

  async function deletePost(postId: string) {
    try {
      await fetch(`/api/saved-posts?id=${postId}`, { method: 'DELETE', credentials: 'include' });
      setPosts(posts.filter(p => p.id !== postId));
    } catch (error) {}
  }

  function getValidUrl(post: SavedPost) {
    let finalUrl = post.postUrl;
    if (finalUrl.startsWith('discovered:') || finalUrl.startsWith('synthetic:')) {
      return `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(post.keyword)}&origin=GLOBAL_SEARCH_HEADER`;
    }
    if (!finalUrl.startsWith('http')) {
      return 'https://' + finalUrl.replace(/^\/*/, '');
    }
    return finalUrl;
  }

  function openPost(e: React.MouseEvent, post: SavedPost) {
    e.preventDefault();
    e.stopPropagation();
    window.open(getValidUrl(post), '_blank', 'noopener,noreferrer');
    markAsVisited(post.id);
  }

  function toggleKeyword(kw: string) {
    setExpandedKeywords(prev => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  }

  function getEngagementRating(likes: number | null, comments: number | null) {
    if (likes == null) return { label: 'Unknown', color: 'neutral' };
    const score = likes + (comments ?? 0) * 2;
    if (score > 1000) return { label: 'Viral', color: 'error' };
    if (score > 200)  return { label: 'High',   color: 'warning' };
    if (score > 50)   return { label: 'Medium', color: 'info' };
    return { label: 'Normal', color: 'neutral' };
  }

  // ── Derive visible posts ─────────────────────────────────────────────────
  const allFiltered = posts.filter(post => {
    if (filterVisited === 'true'  && !post.visited) return false;
    if (filterVisited === 'false' &&  post.visited) return false;
    if (likesFilterActive && (post.likes == null || post.likes < 10)) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      if (
        !post.keyword.toLowerCase().includes(s) &&
        !(post.postAuthor?.toLowerCase().includes(s)) &&
        !(post.postPreview?.toLowerCase().includes(s))
      ) return false;
    }
    return true;
  });

  // Group by keyword, preserving insertion order
  const grouped = allFiltered.reduce<Record<string, SavedPost[]>>((acc, post) => {
    if (!acc[post.keyword]) acc[post.keyword] = [];
    acc[post.keyword].push(post);
    return acc;
  }, {});

  const uniqueKeywords = Object.keys(grouped);
  const totalVisible  = allFiltered.length;
  const freshLeads    = allFiltered.filter(p => !p.visited).length;

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
        <Button onClick={fetchPosts} variant="secondary" size="sm">
          Run Manual Sync
        </Button>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-micro-bold uppercase tracking-wider text-secondary mb-1">Total Saved</div>
          <div className="text-display-hero text-primary leading-none">{posts.length}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-apple-blue/30 relative">
          <div className="text-micro-bold uppercase tracking-wider text-apple-blue mb-1 flex justify-between items-center">
            Showing <span className="w-1.5 h-1.5 rounded-full bg-apple-blue animate-pulse"></span>
          </div>
          <div className="text-display-hero text-primary leading-none">{totalVisible}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-micro-bold uppercase tracking-wider text-secondary mb-1">Fresh Leads</div>
          <div className="text-display-hero text-primary leading-none">{freshLeads}</div>
        </div>
        <div className="bg-surface-elevated rounded-lg p-5 border border-subtle">
          <div className="text-micro-bold uppercase tracking-wider text-secondary mb-1">Keywords</div>
          <div className="text-display-hero text-primary leading-none">
            {Array.from(new Set(posts.map(p => p.keyword))).length}
          </div>
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
              placeholder="Search content or authors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-surface-hover border-none rounded-md text-sm text-primary placeholder-tertiary focus:ring-1 focus:ring-apple-blue transition-all outline-none"
            />
          </div>
          {/* Status filter */}
          <div className="md:col-span-3 relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary w-4 h-4 pointer-events-none" />
            <select
              value={filterVisited}
              onChange={(e) => setFilterVisited(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-surface-hover border-none rounded-md text-sm text-primary appearance-none focus:ring-1 focus:ring-apple-blue transition-all outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="false">Unvisited (Hot)</option>
              <option value="true">Visited</option>
            </select>
          </div>
          {/* Manual 10+ Likes filter toggle */}
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
              <button
                onClick={() => setLikesFilterActive(false)}
                className="p-2 text-tertiary hover:text-primary transition-colors"
                title="Remove filter"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Posts — Grouped by Keyword */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-subtle border-t-apple-blue animate-spin mx-auto mb-4" />
          <p className="text-caption text-secondary">Synchronizing feed...</p>
        </div>
      ) : totalVisible === 0 ? (
        <div className="py-20 text-center">
          <div className="w-12 h-12 bg-surface-elevated rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-tertiary" />
          </div>
          <h3 className="text-caption-bold text-primary mb-2">No Posts Found</h3>
          <p className="text-micro text-secondary max-w-sm mx-auto">
            {likesFilterActive
              ? 'No posts match the 10+ likes filter. Try turning it off to see all results.'
              : 'Your AI worker is currently scouting the network. Posts will appear here once extracted.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6 pb-12">
          {uniqueKeywords.map(keyword => {
            const kPosts = grouped[keyword];
            const isOpen = expandedKeywords.has(keyword);
            const freshCount = kPosts.filter(p => !p.visited).length;
            return (
              <div key={keyword} className="bg-surface-elevated rounded-xl border border-subtle overflow-hidden">
                {/* Keyword Header — clickable to expand/collapse */}
                <button
                  id={`kw-group-${keyword.replace(/\s+/g, '-')}`}
                  onClick={() => toggleKeyword(keyword)}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-hover transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isOpen
                      ? <ChevronDown className="w-4 h-4 text-apple-blue" />
                      : <ChevronRight className="w-4 h-4 text-tertiary" />
                    }
                    <Target className="w-4 h-4 text-apple-blue" />
                    <span className="text-caption-bold text-primary">{keyword}</span>
                    <Badge variant="info" size="sm">{kPosts.length} posts</Badge>
                    {freshCount > 0 && (
                      <Badge variant="error" size="sm" dot>{freshCount} new</Badge>
                    )}
                  </div>
                  <span className="text-micro text-tertiary">
                    {isOpen ? 'collapse' : 'expand'}
                  </span>
                </button>

                {/* Posts Grid */}
                {isOpen && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-subtle">
                    {kPosts.map(post => {
                      const rating = getEngagementRating(post.likes, post.comments);
                      return (
                        <div
                          key={post.id}
                          className={`relative group bg-surface rounded-lg border flex flex-col transition-all duration-200 ${
                            post.visited ? 'border-subtle opacity-70' : 'border-apple-blue/30 apple-shadow'
                          }`}
                        >
                          {/* Card Header */}
                          <div className="px-4 py-3 border-b border-subtle flex justify-between items-center">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-surface-hover flex items-center justify-center text-primary text-xs font-semibold">
                                {post.postAuthor ? post.postAuthor.substring(0, 1).toUpperCase() : '?'}
                              </div>
                              <div>
                                <h4 className="text-caption-bold text-primary leading-tight text-sm">
                                  {post.postAuthor || 'Unknown'}
                                </h4>
                                <div className="flex items-center gap-1 text-micro text-secondary">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(post.savedAt).toLocaleDateString(undefined, {
                                    month: 'short', day: 'numeric',
                                    hour: '2-digit', minute: '2-digit'
                                  })}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge variant={rating.color as any} size="sm">{rating.label}</Badge>
                              {!post.visited
                                ? <Badge variant="error" size="sm" dot>New</Badge>
                                : <Badge variant="neutral" size="sm" icon={<Eye className="w-3 h-3" />}>Seen</Badge>
                              }
                            </div>
                          </div>

                          {/* Full Post Text */}
                          <div className="px-4 py-3 flex-1">
                            {post.postPreview ? (
                              <p className="text-sm text-primary leading-relaxed whitespace-pre-line">
                                {post.postPreview}
                              </p>
                            ) : (
                              <p className="text-micro italic text-secondary">No preview available.</p>
                            )}
                          </div>

                          {/* Metrics Row */}
                          <div className="px-4 py-2 bg-surface-hover border-t border-b border-subtle flex items-center gap-5">
                            <div className="flex items-center gap-1.5 text-micro-bold text-primary">
                              <ThumbsUp className="w-3.5 h-3.5 text-apple-blue" />
                              {post.likes != null ? post.likes.toLocaleString() : '—'}
                            </div>
                            <div className="flex items-center gap-1.5 text-micro-bold text-primary">
                              <MessageCircle className="w-3.5 h-3.5 text-apple-blue" />
                              {post.comments != null ? post.comments.toLocaleString() : '—'}
                            </div>
                            <div className="flex items-center gap-1.5 text-micro text-secondary ml-auto">
                              <BarChart2 className="w-3 h-3" />
                              {rating.label} Reach
                            </div>
                          </div>

                          {/* Footer Actions */}
                          <div className="p-3 grid grid-cols-3 gap-2">
                            <Button
                              onClick={(e) => openPost(e, post)}
                              variant="primary"
                              size="sm"
                              className="col-span-2 text-micro"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              Engage
                            </Button>
                            <Button
                              onClick={(e) => openPost(e, post)}
                              variant="secondary"
                              size="sm"
                              disabled={post.visited}
                              className="col-span-1"
                              title="View on LinkedIn"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </div>

                          {/* Delete Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); deletePost(post.id); }}
                            className="absolute top-2 right-2 text-[rgba(255,255,255,0.32)] hover:text-[#ff3b30] p-1.5 transition-all opacity-0 group-hover:opacity-100"
                            aria-label="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
