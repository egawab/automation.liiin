'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { ExternalLink, Trash2, Eye, Filter, Search } from 'lucide-react';

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

  // Simple polling to keep dashboard updated in near real-time while open
  useEffect(() => {
    const interval = setInterval(() => {
      fetchPosts();
    }, 30000); // every 30 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKeyword, filterVisited]);

  async function fetchPosts() {
    try {
      setLoading(true);
      let url = '/api/saved-posts?';
      if (filterKeyword) url += `keyword=${encodeURIComponent(filterKeyword)}&`;
      if (filterVisited !== 'all') url += `visited=${filterVisited}&`;

      const response = await fetch(url, {
        // cookies (auth_token) are sent automatically for same-origin requests
        credentials: 'include'
      });

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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ postId, visited: true })
      });

      // Update local state
      setPosts(posts.map(p => p.id === postId ? { ...p, visited: true } : p));
    } catch (error) {
      console.error('Error marking post as visited:', error);
    }
  }

  async function deletePost(postId: string) {
    try {
      await fetch(`/api/saved-posts?id=${postId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      // Remove from local state
      setPosts(posts.filter(p => p.id !== postId));
    } catch (error) {
      console.error('Error deleting post:', error);
    }
  }

  function openPost(post: SavedPost) {
    markAsVisited(post.id);
    window.open(post.postUrl, '_blank');
  }

  // Get unique keywords for filter
  const uniqueKeywords = Array.from(new Set(posts.map(p => p.keyword)));

  // Filter posts by search term
  const filteredPosts = posts.filter(post => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      post.keyword.toLowerCase().includes(search) ||
      post.postAuthor?.toLowerCase().includes(search) ||
      post.postPreview?.toLowerCase().includes(search)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Saved Posts</h2>
          <p className="text-gray-600 mt-1">
            Posts found by the search worker - ready for manual engagement
          </p>
        </div>
        <Button onClick={fetchPosts} variant="outline">
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search posts..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Keyword Filter */}
          <div>
            <select
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="">All Keywords</option>
              {uniqueKeywords.map(keyword => (
                <option key={keyword} value={keyword}>{keyword}</option>
              ))}
            </select>
          </div>

          {/* Visited Filter */}
          <div>
            <select
              value={filterVisited}
              onChange={(e) => setFilterVisited(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="all">All Posts</option>
              <option value="false">Unvisited</option>
              <option value="true">Visited</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-600">Total Posts</div>
          <div className="text-2xl font-bold text-purple-600 mt-1">{posts.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Unvisited</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {posts.filter(p => !p.visited).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Visited</div>
          <div className="text-2xl font-bold text-green-600 mt-1">
            {posts.filter(p => p.visited).length}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600">Keywords</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">{uniqueKeywords.length}</div>
        </Card>
      </div>

      {/* Posts List */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <p className="mt-4 text-gray-600">Loading saved posts...</p>
        </div>
      ) : filteredPosts.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="text-gray-400 text-5xl mb-4">🔍</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No Posts Found</h3>
          <p className="text-gray-600">
            {posts.length === 0 
              ? 'The search worker hasn\'t found any posts yet. Make sure it\'s running and you have active keywords.'
              : 'No posts match your current filters.'
            }
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredPosts.map(post => (
            <Card
              key={post.id}
              className={`p-4 sm:p-5 hover:shadow-lg transition-shadow ${
                post.visited ? 'bg-gray-50 opacity-80' : 'bg-white border-l-4 border-l-purple-500'
              }`}
            >
              {/* Post Content Preview — PRIMARY focus */}
              {post.postPreview ? (
                <p className="text-gray-800 text-sm sm:text-base leading-relaxed mb-3 line-clamp-3 font-medium">
                  {post.postPreview}
                </p>
              ) : (
                <p className="text-gray-400 text-sm italic mb-3">No preview available</p>
              )}

              {/* Metadata row: Author + Engagement + Badges */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs sm:text-sm text-gray-500 mb-3">
                {post.postAuthor && (
                  <span className="font-semibold text-gray-700 truncate max-w-[200px]">
                    {post.postAuthor}
                  </span>
                )}
                <span>👍 {post.likes}</span>
                <span>💬 {post.comments}</span>
                <Badge variant={post.visited ? 'secondary' : 'primary'} size="sm">
                  {post.keyword}
                </Badge>
                {!post.visited && <Badge variant="success" size="sm">New</Badge>}
                <span className="text-gray-400 ml-auto">
                  {new Date(post.savedAt).toLocaleDateString()}
                </span>
              </div>

              {/* Actions — responsive row */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => openPost(post)}
                  variant="primary"
                  size="sm"
                  className="whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Open
                </Button>
                {!post.visited && (
                  <Button
                    onClick={() => markAsVisited(post.id)}
                    variant="outline"
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5 mr-1.5" />
                    Visited
                  </Button>
                )}
                <Button
                  onClick={() => deletePost(post.id)}
                  variant="outline"
                  size="sm"
                  className="whitespace-nowrap text-red-500 hover:text-red-700"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
