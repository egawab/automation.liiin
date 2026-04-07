'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { ExternalLink, Trash2, Eye, Filter, Search, ThumbsUp, MessageCircle, BarChart2, Share2, Target, Calendar } from 'lucide-react';

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

  useEffect(() => {
    fetchPosts();
  }, [filterKeyword, filterVisited]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchPosts();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKeyword, filterVisited]);

  async function fetchPosts() {
    try {
      setLoading(true);
      let url = '/api/saved-posts?';
      if (filterKeyword) url += `keyword=${encodeURIComponent(filterKeyword)}&`;
      if (filterVisited !== 'all') url += `visited=${filterVisited}&`;

      const response = await fetch(url, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setPosts(data);
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
      await fetch(`/api/saved-posts?id=${postId}`, {
        method: 'DELETE',
        credentials: 'include'
      });
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
    if (score > 100) return { label: 'Viral', color: 'bg-red-500 text-white border-red-500' };
    if (score > 50) return { label: 'High', color: 'bg-orange-500 text-white border-orange-500' };
    if (score > 20) return { label: 'Medium', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
    return { label: 'Normal', color: 'bg-gray-100 text-gray-600 border-gray-200' };
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">Lead Intelligence Hub</h2>
          <p className="text-gray-500 mt-2 font-medium">
            High-value targeted posts intercepted by your AI worker.
          </p>
        </div>
        <Button onClick={fetchPosts} variant="outline" className="shadow-sm font-semibold">
          🔄 Run Manual Sync
        </Button>
      </div>

      {/* Stats Board (Premium Glassmorphism Style) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl p-6 shadow-lg shadow-indigo-500/20 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-xl"></div>
          <div className="text-indigo-100 text-sm font-semibold tracking-wide uppercase mb-1">Total Intercepts</div>
          <div className="text-4xl font-black">{posts.length}</div>
        </div>
        <div className="bg-white border-2 border-primary-50 rounded-2xl p-6 shadow-sm relative">
          <div className="text-gray-500 text-sm font-semibold tracking-wide uppercase mb-1 flex justify-between">
            Fresh Leads <span className="w-2 h-2 rounded-full bg-primary-500 animate-pulse mt-1"></span>
          </div>
          <div className="text-4xl font-black text-gray-900">{posts.filter(p => !p.visited).length}</div>
        </div>
        <div className="bg-white border text-gray-800 rounded-2xl p-6 shadow-sm">
          <div className="text-gray-500 text-sm font-semibold tracking-wide uppercase mb-1">Engaged</div>
          <div className="text-4xl font-black text-gray-900">{posts.filter(p => p.visited).length}</div>
        </div>
        <div className="bg-white border text-gray-800 rounded-2xl p-6 shadow-sm">
          <div className="text-gray-500 text-sm font-semibold tracking-wide uppercase mb-1">Active Targets</div>
          <div className="text-4xl font-black text-gray-900">{uniqueKeywords.length}</div>
        </div>
      </div>

      {/* Filters Base */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-2 md:p-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="relative md:col-span-5">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search content, authors, or insights..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-primary-500 text-gray-900 font-medium"
            />
          </div>
          <div className="md:col-span-4">
            <div className="relative">
              <Target className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
              <select
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-primary-500 text-gray-800 font-medium appearance-none"
              >
                <option value="">All Market Channels</option>
                {uniqueKeywords.map(keyword => (
                  <option key={keyword} value={keyword}>Topic: {keyword}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="md:col-span-3">
            <div className="relative">
              <Filter className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 pointer-events-none" />
              <select
                value={filterVisited}
                onChange={(e) => setFilterVisited(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-0 rounded-xl focus:ring-2 focus:ring-primary-500 text-gray-800 font-medium appearance-none"
              >
                <option value="all">All Statuses</option>
                <option value="false">Unvisited (Hot)</option>
                <option value="true">Visited</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Posts List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 border-4 border-primary-200 rounded-full animate-pulse"></div>
            <div className="absolute inset-0 border-4 border-primary-600 rounded-full animate-spin border-t-transparent"></div>
          </div>
          <p className="mt-6 text-gray-500 font-semibold text-lg animate-pulse">Synchronizing Intelligence Feed...</p>
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-gray-100 shadow-sm text-center px-4">
          <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-6">
            <Search className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">No Leads Found</h3>
          <p className="text-gray-500 max-w-md text-lg">
            {posts.length === 0 
              ? 'Your AI worker is currently scouting the network. Leave it running, and high-value posts will appear here shortly.'
              : 'Adjust your filters or search terms to uncover hidden opportunities.'
            }
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          {filteredPosts.map(post => {
            const rating = getEngagementRating(post.likes, post.comments);
            return (
              <div
                key={post.id}
                className={`flex flex-col bg-white rounded-2xl border transition-all duration-300 shadow-sm hover:shadow-xl hover:-translate-y-1 ${
                  post.visited ? 'border-gray-200 opacity-75' : 'border-primary-100 ring-1 ring-primary-50'
                }`}
              >
                {/* Post Header */}
                <div className="px-6 py-5 border-b border-gray-50 flex items-center justify-between bg-gray-50/30 rounded-t-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-sm">
                      {post.postAuthor ? post.postAuthor.substring(0, 1).toUpperCase() : '?'}
                    </div>
                    <div>
                      <h4 className="font-bold text-gray-900 text-[15px]">{post.postAuthor || 'Unknown Target'}</h4>
                      <div className="flex items-center text-xs text-gray-500 font-medium">
                        <Calendar className="w-3 h-3 mr-1" />
                        {new Date(post.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <div>
                    {!post.visited ? (
                      <span className="px-3 py-1 bg-red-50 text-red-600 text-xs font-bold uppercase tracking-wider rounded-full border border-red-100 flex items-center">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full mr-2 animate-pulse"></span>
                        Action Req
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-gray-100 text-gray-500 text-xs font-bold uppercase tracking-wider rounded-full flex items-center">
                        <Eye className="w-3 h-3 mr-1.5" /> Checked
                      </span>
                    )}
                  </div>
                </div>

                {/* Content Body */}
                <div className="px-6 py-5 flex-1 relative">
                  <div className="absolute top-4 right-4 z-10">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold tracking-wide border ${rating.color}`}>
                      {rating.label} Reach
                    </span>
                  </div>
                  
                  <div className="inline-flex items-center mb-4 px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 text-xs font-semibold">
                    <Target className="w-3.5 h-3.5 mr-1" />
                    {post.keyword}
                  </div>

                  {post.postPreview ? (
                    <p className="text-gray-800 text-[15px] leading-relaxed line-clamp-4 font-medium mb-2">
                      {post.postPreview}
                    </p>
                  ) : (
                    <div className="bg-gray-100/50 rounded-xl p-4 border border-dashed border-gray-200">
                      <p className="text-gray-400 text-sm italic text-center">Rich content preview restricted.</p>
                    </div>
                  )}
                </div>

                {/* Metrics Bar */}
                <div className="px-6 py-4 bg-gray-50 flex items-center gap-6 border-t border-gray-100">
                  <div className="flex items-center text-gray-700 font-bold">
                    <ThumbsUp className="w-4 h-4 mr-2 text-primary-500" />
                    {post.likes.toLocaleString()}
                  </div>
                  <div className="flex items-center text-gray-700 font-bold">
                    <MessageCircle className="w-4 h-4 mr-2 text-primary-500" />
                    {post.comments.toLocaleString()}
                  </div>
                  <div className="flex items-center text-gray-400 font-medium text-sm ml-auto">
                    <BarChart2 className="w-4 h-4 mr-1.5" />
                    High Insight
                  </div>
                </div>

                {/* Footers / Actions */}
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Button
                    onClick={() => openPost(post)}
                    variant="primary"
                    className="w-full shadow-sm hover:shadow font-semibold sm:col-span-2"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Engage Target
                  </Button>
                  <Button
                    onClick={() => markAsVisited(post.id)}
                    variant="outline"
                    className="w-full bg-white text-gray-700 font-semibold sm:col-span-1 border-gray-200"
                    disabled={post.visited}
                  >
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
                
                {/* Subtle Delete */}
                <button 
                  onClick={(e) => { e.stopPropagation(); deletePost(post.id); }}
                  className="absolute top-4 right-4 text-gray-300 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50 opacity-0 group-hover:opacity-100"
                  title="Remove from Hub"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
