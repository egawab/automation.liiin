'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { ExternalLink, Trash2, Eye, Filter, Search, ThumbsUp, MessageCircle, BarChart2, Target, Calendar } from 'lucide-react';

interface SavedPost {
  id: string;
  postUrl: string;
  postAuthor: string | null;
  postPreview: string | null;
  likes: number;
  comments: number;
  keyword: string;
  savedAt: string;
  visited: boolean;
}

export function SavedPostsPanel() {
  const [posts, setPosts] = useState<SavedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterKeyword, setFilterKeyword] = useState<string>('');
  const [filterVisited, setFilterVisited] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => { fetchPosts(); }, [filterKeyword, filterVisited]);
  useEffect(() => {
    const interval = setInterval(() => { fetchPosts(); }, 30000);
    return () => clearInterval(interval);
  }, [filterKeyword, filterVisited]);

  async function fetchPosts() {
    try {
      setLoading(true);
      let url = '/api/saved-posts?';
      if (filterKeyword) url += `keyword=${encodeURIComponent(filterKeyword)}&`;
      if (filterVisited !== 'all') url += `visited=${filterVisited}&`;
      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) setPosts(await response.json());
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

  function openPost(post: SavedPost) {
    markAsVisited(post.id);
    window.open(post.postUrl, '_blank');
  }

  const uniqueKeywords = Array.from(new Set(posts.map(p => p.keyword)));
  const filteredPosts = posts.filter(post => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      post.keyword.toLowerCase().includes(search) ||
      post.postAuthor?.toLowerCase().includes(search) ||
      post.postPreview?.toLowerCase().includes(search)
    );
  });

  const getEngagementRating = (likes: number, comments: number) => {
    const score = (likes * 1) + (comments * 2);
    if (score > 100) return { label: 'Viral', color: 'error' };
    if (score > 50) return { label: 'High', color: 'warning' };
    if (score > 20) return { label: 'Medium', color: 'info' };
    return { label: 'Normal', color: 'neutral' };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-tile-heading text-white">Lead Intelligence Hub</h2>
          <p className="text-caption text-[rgba(255,255,255,0.48)] mt-1">
            High-value targeted posts intercepted by your AI worker.
          </p>
        </div>
        <Button onClick={fetchPosts} variant="secondary" size="sm">
          Run Manual Sync
        </Button>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#1d1d1f] rounded-lg p-5 border border-[rgba(255,255,255,0.04)]">
          <div className="text-micro-bold uppercase tracking-wider text-[rgba(255,255,255,0.48)] mb-1">Total Intercepts</div>
          <div className="text-display-hero text-white leading-none">{posts.length}</div>
        </div>
        <div className="bg-[#1d1d1f] rounded-lg p-5 border border-[#0071e3]/30 relative">
          <div className="text-micro-bold uppercase tracking-wider text-[#0071e3] mb-1 flex justify-between items-center">
            Fresh Leads <span className="w-1.5 h-1.5 rounded-full bg-[#0071e3] animate-pulse"></span>
          </div>
          <div className="text-display-hero text-white leading-none">{posts.filter(p => !p.visited).length}</div>
        </div>
        <div className="bg-[#1d1d1f] rounded-lg p-5 border border-[rgba(255,255,255,0.04)]">
          <div className="text-micro-bold uppercase tracking-wider text-[rgba(255,255,255,0.48)] mb-1">Engaged</div>
          <div className="text-display-hero text-white leading-none">{posts.filter(p => p.visited).length}</div>
        </div>
        <div className="bg-[#1d1d1f] rounded-lg p-5 border border-[rgba(255,255,255,0.04)]">
          <div className="text-micro-bold uppercase tracking-wider text-[rgba(255,255,255,0.48)] mb-1">Active Targets</div>
          <div className="text-display-hero text-white leading-none">{uniqueKeywords.length}</div>
        </div>
      </div>

      {/* Filters Base */}
      <div className="bg-[#1d1d1f] rounded-lg border border-[rgba(255,255,255,0.04)] p-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.32)] w-4 h-4" />
            <input
              type="text"
              placeholder="Search content or authors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-[#272729] border-none rounded-md text-sm text-white placeholder-[rgba(255,255,255,0.24)] focus:ring-1 focus:ring-[#0071e3] transition-all outline-none"
            />
          </div>
          <div className="md:col-span-4 relative">
            <Target className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.32)] w-4 h-4 pointer-events-none" />
            <select
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-[#272729] border-none rounded-md text-sm text-white appearance-none focus:ring-1 focus:ring-[#0071e3] transition-all outline-none"
            >
              <option value="">All Campaigns</option>
              {uniqueKeywords.map(keyword => <option key={keyword} value={keyword}>{keyword}</option>)}
            </select>
          </div>
          <div className="md:col-span-3 relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.32)] w-4 h-4 pointer-events-none" />
            <select
              value={filterVisited}
              onChange={(e) => setFilterVisited(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-[#272729] border-none rounded-md text-sm text-white appearance-none focus:ring-1 focus:ring-[#0071e3] transition-all outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="false">Unvisited (Hot)</option>
              <option value="true">Visited</option>
            </select>
          </div>
        </div>
      </div>

      {/* Posts List */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-8 h-8 rounded-full border-2 border-[rgba(255,255,255,0.16)] border-t-[#0071e3] animate-spin mx-auto mb-4" />
          <p className="text-caption text-[rgba(255,255,255,0.48)]">Synchronizing feed...</p>
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="py-20 text-center">
          <div className="w-12 h-12 bg-[#1d1d1f] rounded-full flex items-center justify-center mx-auto mb-4">
            <Search className="w-6 h-6 text-[rgba(255,255,255,0.32)]" />
          </div>
          <h3 className="text-caption-bold text-white mb-2">No Leads Found</h3>
          <p className="text-micro text-[rgba(255,255,255,0.48)] max-w-sm mx-auto">
            Your AI worker is currently scouting the network. Leave it running, and high-value posts will appear here shortly.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-12">
          {filteredPosts.map(post => {
            const rating = getEngagementRating(post.likes, post.comments);
            return (
              <div
                key={post.id}
                className={`relative group bg-[#1d1d1f] rounded-lg border flex flex-col transition-all duration-200 ${
                  post.visited ? 'border-[rgba(255,255,255,0.04)] opacity-70' : 'border-[#0071e3]/30 apple-shadow'
                }`}
              >
                {/* Header */}
                <div className="px-5 py-4 border-b border-[rgba(255,255,255,0.04)] flex justify-between items-center bg-[rgba(255,255,255,0.02)] rounded-t-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#272729] flex items-center justify-center text-white text-sm font-semibold">
                      {post.postAuthor ? post.postAuthor.substring(0, 1).toUpperCase() : '?'}
                    </div>
                    <div>
                      <h4 className="text-caption-bold text-white leading-tight">{post.postAuthor || 'Unknown Target'}</h4>
                      <div className="flex items-center gap-1 text-micro text-[rgba(255,255,255,0.48)]">
                        <Calendar className="w-3 h-3" />
                        {new Date(post.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div>
                    {!post.visited ? (
                      <Badge variant="error" size="sm" dot>Action Req</Badge>
                    ) : (
                      <Badge variant="neutral" size="sm" icon={<Eye className="w-3 h-3" />}>Checked</Badge>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div className="px-5 py-4 flex-1 relative">
                  <div className="absolute top-4 right-4">
                    <Badge variant={rating.color as any} size="sm">{rating.label} Reach</Badge>
                  </div>
                  
                  <div className="inline-flex items-center mb-3 px-2 py-1 rounded bg-[#272729] text-micro-bold text-[rgba(255,255,255,0.56)]">
                    <Target className="w-3 h-3 mr-1" /> {post.keyword}
                  </div>

                  {post.postPreview ? (
                    <p className="text-caption text-[rgba(255,255,255,0.8)] leading-relaxed line-clamp-4">
                      {post.postPreview}
                    </p>
                  ) : (
                    <div className="bg-[#272729] p-3 rounded-md border border-[rgba(255,255,255,0.04)] text-center">
                      <p className="text-micro italic text-[rgba(255,255,255,0.48)]">Preview restricted.</p>
                    </div>
                  )}
                </div>

                {/* Metrics */}
                <div className="px-5 py-3 bg-[rgba(255,255,255,0.02)] border-t border-b border-[rgba(255,255,255,0.04)] flex items-center gap-5">
                  <div className="flex items-center gap-1.5 text-micro-bold text-white">
                    <ThumbsUp className="w-3.5 h-3.5 text-[#0071e3]" /> {post.likes.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1.5 text-micro-bold text-white">
                    <MessageCircle className="w-3.5 h-3.5 text-[#0071e3]" /> {post.comments.toLocaleString()}
                  </div>
                  <div className="flex items-center gap-1.5 text-micro text-[rgba(255,255,255,0.48)] ml-auto">
                    <BarChart2 className="w-3.5 h-3.5" /> High Insight
                  </div>
                </div>

                {/* Footer */}
                <div className="p-3 grid grid-cols-3 gap-2">
                  <Button onClick={() => openPost(post)} variant="primary" size="sm" className="col-span-2 text-micro">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Engage Target
                  </Button>
                  <Button onClick={() => markAsVisited(post.id)} variant="secondary" size="sm" disabled={post.visited} className="col-span-1">
                    <Eye className="w-3.5 h-3.5" />
                  </Button>
                </div>
                
                {/* Delete */}
                <button 
                  onClick={(e) => { e.stopPropagation(); deletePost(post.id); }}
                  className="absolute top-2 right-2 text-[rgba(255,255,255,0.32)] hover:text-[#ff3b30] p-2 transition-all opacity-0 group-hover:opacity-100"
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
}
