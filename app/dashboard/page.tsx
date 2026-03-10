'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, Search, MessageSquareText, Settings, Activity, Users,
  TrendingUp, AlertCircle, Play, Pause, Plus, Trash2, Bot, PenTool, Sparkles, Shield
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import Sidebar from '@/components/dashboard/Sidebar';
import Header from '@/components/dashboard/Header';
import StatCard from '@/components/dashboard/StatCard';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import Chart from '@/components/dashboard/Chart';
import { SavedPostsPanel } from '@/components/dashboard/SavedPostsPanel';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input, { TextArea } from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';

export default function Dashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('dashboard');

  // State
  const [systemActive, setSystemActive] = useState(false);
  const [stats, setStats] = useState({ commentsToday: 0, postsScanned: 0, profileViews: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const [keywords, setKeywords] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [autoPosts, setAutoPosts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});

  // Form states
  const [newKeyword, setNewKeyword] = useState('');
  const [newKeywordReach, setNewKeywordReach] = useState(1000);
  const [newCommentText, setNewCommentText] = useState('');
  const [newCommentCat, setNewCommentCat] = useState('General');
  const [newCommentKeywordId, setNewCommentKeywordId] = useState<string>('');
  const [newTopic, setNewTopic] = useState('');

  const fetchData = async () => {
    // Fetch Settings
    const setRes = await fetch('/api/settings');

    if (setRes.status === 401) {
      router.push('/login');
      return;
    }

    if (setRes.ok) {
      const data = await setRes.json();
      setSettings(data);
      setSystemActive(data.systemActive);
    }

    // Fetch Stats & Logs for Dashboard
    if (activeTab === 'dashboard') {
      const stRes = await fetch('/api/stats');
      if (stRes.ok) setStats(await stRes.json());
      const lgRes = await fetch('/api/logs');
      if (lgRes.ok) setLogs(await lgRes.json());
    }

    // Fetch Keywords
    if (activeTab === 'keywords') {
      const kwRes = await fetch('/api/keywords');
      if (kwRes.ok) setKeywords(await kwRes.json());
    }

    // Fetch Comments
    if (activeTab === 'comments') {
      const cmRes = await fetch('/api/comments');
      if (cmRes.ok) setComments(await cmRes.json());
    }

    // Fetch AutoPosts
    if (activeTab === 'autoposts') {
      const apRes = await fetch('/api/autoposts');
      if (apRes.ok) setAutoPosts(await apRes.json());
    }
  };

  useEffect(() => {
    // Small delay on first load to ensure cookie is set
    const initialTimeout = setTimeout(fetchData, 100);
    
    // Then poll every 5 seconds
    const interval = setInterval(fetchData, 5000);
    
    // ❌ REMOVED AUTO-START: Worker should only start when user clicks "Start" button
    // The worker must NEVER auto-start - it should only run based on explicit user action
    
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [activeTab]);

  const toggleSystem = async () => {
    const newState = !systemActive;
    setSystemActive(newState);
    
    // ✅ Update settings to toggle systemActive flag
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemActive: newState })
    });
    
    // ✅ USER ACTION: Start worker only when user clicks "Start"
    if (newState) {
      console.log('🚀 User clicked START - Initiating worker for CURRENT session...');
      console.log('🧹 This will clear any old sessions and use ONLY your current data');
      try {
        const response = await fetch('/api/worker/start', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          console.log('✅ Worker started successfully for YOUR account:', result);
          console.log(`   • Worker PID: ${result.pid}`);
          console.log(`   • User ID: ${result.userId}`);
          console.log(`   • Started at: ${result.startedAt}`);
          console.log('✅ Worker will ONLY process YOUR keywords and settings');
        } else {
          console.error('❌ Failed to start worker:', result);
          if (result.error) {
            alert(`Failed to start worker: ${result.error}`);
          }
        }
      } catch (error) {
        console.error('❌ Error starting worker:', error);
        alert('Failed to start worker. Please try again.');
      }
    } else {
      console.log('⏸️ User clicked PAUSE - Worker will stop after current cycle');
    }
  };

  const addKeyword = async () => {
    if (!newKeyword) return;
    await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword: newKeyword, targetReach: newKeywordReach })
    });
    setNewKeyword('');
    setNewKeywordReach(1000);
    fetchData();
  };

  const deleteKeyword = async (id: string) => {
    await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const addComment = async () => {
    if (!newCommentText) return;
    await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        text: newCommentText, 
        category: newCommentCat,
        keywordId: newCommentKeywordId || null
      })
    });
    setNewCommentText('');
    setNewCommentCat('General');
    setNewCommentKeywordId('');
    fetchData();
  };

  const deleteComment = async (id: string) => {
    await fetch(`/api/comments/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const generateAutoPost = async () => {
    if (!newTopic) return;
    await fetch('/api/autoposts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: newTopic })
    });
    setNewTopic('');
    fetchData();
  };

  const deleteAutoPost = async (id: string) => {
    await fetch(`/api/autoposts/${id}`, { method: 'DELETE' });
    fetchData();
  };

  const saveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      maxCommentsPerDay: Number(formData.get('maxCommentsPerDay')),
      maxProfileViewsPerDay: Number(formData.get('maxProfileViewsPerDay')),
      minLikes: Number(formData.get('minLikes')),
      maxLikes: Number(formData.get('maxLikes')),
      minComments: Number(formData.get('minComments')),
      maxComments: Number(formData.get('maxComments')),
      minDelayMins: Number(formData.get('minDelayMins')),
      maxDelayMins: Number(formData.get('maxDelayMins')),
      linkedinSessionCookie: formData.get('linkedinSessionCookie') as string,
      searchOnlyMode: formData.get('searchOnlyMode') === 'on',
      workHoursOnly: formData.get('workHoursOnly') === 'on',
      workHoursStart: Number(formData.get('workHoursStart') ?? 9),
      workHoursEnd: Number(formData.get('workHoursEnd') ?? 18),
      skipWeekends: formData.get('skipWeekends') === 'on',
      maxSearchesPerHour: Number(formData.get('maxSearchesPerHour') ?? 6),
      maxSearchesPerDay: Number(formData.get('maxSearchesPerDay') ?? 20),
      minDelayBetweenSearchesMinutes: Number(formData.get('minDelayBetweenSearchesMinutes') ?? 5),
      maxKeywordsPerCycle: Number(formData.get('maxKeywordsPerCycle') ?? 3)
    };
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    alert('✅ Settings Saved Successfully!');
    fetchData();
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'saved-posts':
        return <SavedPostsPanel />;
      
      case 'dashboard':
        // Mock chart data
        const chartData = [
          { name: 'Mon', value: 12 },
          { name: 'Tue', value: 19 },
          { name: 'Wed', value: 15 },
          { name: 'Thu', value: 25 },
          { name: 'Fri', value: 22 },
          { name: 'Sat', value: 18 },
          { name: 'Sun', value: 20 },
        ];

        return (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Comments Today"
                value={stats.commentsToday}
                maxValue={settings.maxCommentsPerDay || 50}
                icon={<MessageSquareText className="w-5 h-5" />}
                iconColor="primary"
                showProgress
                trend="+12%"
                trendUp
                delay={0}
              />

              <StatCard
                title="Posts Scanned"
                value={stats.postsScanned}
                icon={<Search className="w-5 h-5" />}
                iconColor="secondary"
                delay={0.1}
              />

              <StatCard
                title="Profile Views"
                value={stats.profileViews || 0}
                icon={<Users className="w-5 h-5" />}
                iconColor="accent"
                trend="+8%"
                trendUp
                delay={0.2}
              />

              <div className="md:col-span-1">
                <Card hover>
                  <div className="flex items-center justify-between h-full">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-2">
                        System Status
                      </p>
                      <h3 className="text-xl font-extrabold text-gray-900">
                        {systemActive ? 'Autopilot Active' : 'Standby Mode'}
                      </h3>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      {systemActive && (
                        <span className="relative flex h-4 w-4">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-4 w-4 bg-success-500"></span>
                        </span>
                      )}
                      <Button
                        onClick={toggleSystem}
                        variant={systemActive ? 'secondary' : 'primary'}
                        size="sm"
                        leftIcon={systemActive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      >
                        {systemActive ? 'Pause' : 'Start'}
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            {/* Chart */}
            <Chart data={chartData} />

            {/* Activity Feed */}
            <ActivityFeed logs={logs.map((log: any) => ({
              id: log.id,
              action: log.action,
              status: log.action.includes('✅') ? 'Success' : log.action.includes('❌') ? 'Failed' : 'Pending',
              time: log.timestamp,
              postUrl: log.postUrl,
              commentUrl: log.commentUrl,
              comment: log.comment
            }))} />
          </div>
        );
      case 'keywords':
        return (
          <Card>
            <div className="p-6 md:p-8 border-b border-gray-100">
              <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Search className="w-5 h-5 text-primary-500" />
                    Target Keywords
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage the phrases your AI agent scans for on LinkedIn
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="text"
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="E.g. #growthhacking"
                    className="min-w-[200px]"
                  />
                  <select
                    value={newKeywordReach}
                    onChange={e => setNewKeywordReach(parseInt(e.target.value))}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value={100}>100-500 (Small)</option>
                    <option value={500}>500-1K (Medium)</option>
                    <option value={1000}>1K-5K (Large)</option>
                    <option value={5000}>5K-10K (Viral)</option>
                    <option value={10000}>10K+ (Mega)</option>
                  </select>
                  <Button onClick={addKeyword} leftIcon={<Plus className="w-4 h-4" />}>
                    Add
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Keyword
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Target Reach
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Matches
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {keywords.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                            <Search className="w-8 h-8 text-gray-400" />
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            No keywords yet
                          </p>
                          <p className="text-sm text-gray-500">
                            Add your first keyword above to start targeting posts
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : keywords.map((kw: any) => (
                    <tr key={kw.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-gray-900">
                          {kw.keyword}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="primary" size="sm">
                          {kw.targetReach >= 10000 ? '10K+' : 
                           kw.targetReach >= 5000 ? '5K-10K' :
                           kw.targetReach >= 1000 ? '1K-5K' :
                           kw.targetReach >= 500 ? '500-1K' : '100-500'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="neutral" size="sm">
                          {kw.matches || 0} hits
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteKeyword(kw.id)}
                          className="text-gray-400 hover:text-error-600 hover:bg-error-50 p-2 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      case 'comments':
        return (
          <Card>
            <div className="p-6 md:p-8 border-b border-gray-100">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <MessageSquareText className="w-5 h-5 text-primary-500" />
                    Comment Bank
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Pre-written thoughts your agent will deploy on LinkedIn
                  </p>
                </div>

                {/* Add Comment Form */}
                <div className="flex flex-col gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                  <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
                    <Input
                      label="Category"
                      type="text"
                      value={newCommentCat}
                      onChange={e => setNewCommentCat(e.target.value)}
                      placeholder="General"
                      className="lg:w-40"
                    />
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Link to Keyword (Optional)
                      </label>
                      <select
                        value={newCommentKeywordId}
                        onChange={e => setNewCommentKeywordId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        <option value="">-- No keyword --</option>
                        {keywords.map((kw: any) => (
                          <option key={kw.id} value={kw.id}>
                            {kw.keyword}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
                    <TextArea
                      label="Comment Text"
                      value={newCommentText}
                      onChange={e => setNewCommentText(e.target.value)}
                      placeholder="Type a thoughtful comment..."
                      rows={2}
                      className="flex-1 min-w-[250px]"
                      showCharCount
                      maxLength={280}
                    />
                    <Button onClick={addComment} leftIcon={<Plus className="w-4 h-4" />} className="lg:mb-0">
                      Add Comment
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Comments Grid */}
            <div className="p-6 md:p-8">
              {comments.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
                    <MessageSquareText className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mb-1">
                    No comments yet
                  </p>
                  <p className="text-sm text-gray-500">
                    Add your first comment template above
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {comments.map((comment: any) => (
                    <Card key={comment.id} variant="default" hover className="group relative">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="primary" size="sm">
                            {comment.category}
                          </Badge>
                          {comment.keyword && (
                            <Badge variant="secondary" size="sm">
                              🔗 {comment.keyword.keyword}
                            </Badge>
                          )}
                        </div>
                        <button
                          onClick={() => deleteComment(comment.id)}
                          className="text-gray-400 opacity-0 group-hover:opacity-100 hover:text-error-600 hover:bg-error-50 p-1.5 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        "{comment.text}"
                      </p>
                      {!comment.keyword && (
                        <p className="text-xs text-gray-400 mt-2 italic">
                          Not linked to any keyword
                        </p>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </Card>
        );
      case 'cookie-helper':
        return (
          <div className="max-w-5xl mx-auto">
            {/* Cookie Helper - Integrated Version */}
            <Card className="overflow-hidden">
              <div className="p-6 md:p-8 border-b border-gray-100 bg-gradient-to-r from-primary-50 to-secondary-50">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-4xl">🍪</span>
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900">
                      LinkedIn Cookie Helper
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      Get your LinkedIn session cookie in 6 simple steps
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 md:p-8">
                {/* Why Section */}
                <div className="mb-8 bg-blue-50 rounded-xl p-6 border-2 border-blue-200">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">💡</span>
                    <div>
                      <h4 className="text-lg font-bold text-blue-900 mb-2">Why do we need your cookie?</h4>
                      <p className="text-gray-800 text-sm leading-relaxed font-medium">
                        The LinkedIn cookie allows our automation to act on your behalf. It's like giving the 
                        automation a temporary "key" to access LinkedIn as you.
                      </p>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <Badge variant="success">✓ Safe</Badge>
                        <Badge variant="success">✓ Encrypted</Badge>
                        <Badge variant="success">✓ Never Shared</Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step-by-Step Instructions */}
                <div className="space-y-3 mb-8">
                  {[
                    { icon: '🌐', title: 'Open LinkedIn', desc: 'Go to linkedin.com and log in' },
                    { icon: '🔧', title: 'Press F12', desc: 'Open Developer Tools (F12 or Ctrl+Shift+I)' },
                    { icon: '📱', title: 'Application Tab', desc: 'Click "Application" tab in DevTools' },
                    { icon: '🍪', title: 'Find Cookies', desc: 'Expand "Cookies" → Click "https://www.linkedin.com"' },
                    { icon: '📋', title: 'Copy li_at', desc: 'Find "li_at" cookie and copy its VALUE' },
                    { icon: '✅', title: 'Paste Below', desc: 'Paste the cookie in the settings form above' },
                  ].map((step, idx) => (
                    <div key={idx} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-primary-500 text-white flex items-center justify-center text-sm font-bold shadow-md">
                          {idx + 1}
                        </div>
                      </div>
                      <div className="flex-1 flex items-center gap-3">
                        <span className="text-2xl">{step.icon}</span>
                        <div>
                          <h5 className="text-base font-bold text-gray-900">{step.title}</h5>
                          <p className="text-sm text-gray-600 font-medium">{step.desc}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Direct to Settings */}
                <div className="bg-gradient-to-r from-primary-500 to-secondary-500 rounded-xl p-6 text-center">
                  <h4 className="text-xl font-bold text-white mb-3">Ready to add your cookie?</h4>
                  <p className="text-white/90 text-sm mb-4">
                    Once you've copied the li_at value, go to Settings and paste it in the LinkedIn Session Cookie field
                  </p>
                  <Button
                    onClick={() => setActiveTab('settings')}
                    variant="secondary"
                    size="lg"
                    className="bg-white hover:bg-gray-100 text-primary-600"
                  >
                    <Settings className="w-5 h-5 mr-2" />
                    Go to Settings
                  </Button>
                </div>

                {/* Security Notice */}
                <div className="mt-6 bg-amber-50 rounded-xl p-6 border-2 border-amber-300">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">🔒</span>
                    <div>
                      <h4 className="text-lg font-bold text-amber-900 mb-2">Security Notice</h4>
                      <ul className="text-gray-800 space-y-1.5 text-sm font-medium">
                        <li className="flex items-start gap-2">
                          <span className="text-amber-600 font-bold">•</span>
                          <span>Your cookie is encrypted before being stored</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-amber-600 font-bold">•</span>
                          <span>Never share your cookie with anyone else</span>
                        </li>
                        <li className="flex items-start gap-2">
                          <span className="text-amber-600 font-bold">•</span>
                          <span>Update if automation stops working</span>
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        );
      case 'autoposts':
        return (
          <Card>
            <div className="p-6 md:p-8 border-b border-gray-100 bg-gradient-to-r from-secondary-50 via-accent-50 to-transparent">
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-secondary-600" />
                    AI Auto-Posts
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Generate thought leadership content on autopilot using Gemini
                  </p>
                </div>

                {/* Generate Form */}
                <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                  <Input
                    label="Topic or Idea"
                    type="text"
                    value={newTopic}
                    onChange={e => setNewTopic(e.target.value)}
                    placeholder="E.g. The future of SaaS pricing..."
                    className="flex-1 min-w-[300px]"
                    leftIcon={<PenTool className="w-4 h-4" />}
                  />
                  <Button
                    onClick={generateAutoPost}
                    variant="secondary"
                    leftIcon={<Bot className="w-4 h-4" />}
                  >
                    Generate Post
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Topic
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Status
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500">
                      Content Preview
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-gray-500 text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {autoPosts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center">
                          <div className="w-16 h-16 mb-4 rounded-full bg-gradient-to-br from-secondary-100 to-accent-100 flex items-center justify-center">
                            <Sparkles className="w-8 h-8 text-secondary-600" />
                          </div>
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            No posts generated yet
                          </p>
                          <p className="text-sm text-gray-500">
                            Enter a topic above to let AI create your first post
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : autoPosts.map((post) => (
                    <tr key={post.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 max-w-[200px]">
                        <span className="text-sm font-semibold text-gray-900 line-clamp-2">
                          {post.topic}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <Badge
                          variant={post.status === 'Published' ? 'success' : 'info'}
                          size="sm"
                        >
                          {post.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 max-w-md">
                        <p className="text-sm text-gray-600 line-clamp-2 italic">
                          "{post.content}"
                        </p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteAutoPost(post.id)}
                          className="text-gray-400 hover:text-error-600 hover:bg-error-50 p-2 rounded-lg transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      case 'settings':
        return (
          <div className="max-w-4xl mx-auto">
            <Card>
              <div className="p-6 md:p-8 border-b border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-primary-500" />
                  Agent Configuration
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  Fine-tune your autopilot's parameters and safety thresholds
                </p>
              </div>
              <form onSubmit={saveSettings} className="p-6 md:p-8 space-y-8">

                {/* Search-Only Mode Toggle */}
                <div className="bg-gradient-to-br from-blue-600 to-purple-600 rounded-2xl p-6 shadow-xl">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="text-sm font-extrabold text-white mb-2 flex items-center gap-2">
                        <Search size={16} className="text-white" />
                        Search-Only Mode (Recommended)
                      </h4>
                      <p className="text-xs text-blue-100 mb-3">
                        Enable this mode to search and save posts WITHOUT auto-commenting. Safer and avoids CAPTCHA triggers.
                      </p>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          name="searchOnlyMode"
                          defaultChecked={settings.searchOnlyMode ?? true}
                          className="w-5 h-5 rounded border-2 border-white/30 bg-white/10 text-primary-600 focus:ring-2 focus:ring-white/50"
                        />
                        <span className="text-sm font-semibold text-white">
                          Enable Search-Only Mode
                        </span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Conservative Search Limits (Search-Only Mode) */}
                <div className="bg-gradient-to-br from-green-600 to-emerald-700 rounded-2xl p-6 shadow-xl">
                  <h4 className="text-sm font-extrabold text-white mb-2 flex items-center gap-2">
                    <Shield size={16} className="text-white" />
                    Conservative Search Limits (Safest)
                  </h4>
                  <p className="text-xs text-green-100 mb-4">
                    Limits to minimize CAPTCHA and detection. Recommended for first tests.
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-green-100 mb-1">Max Searches/Hour</label>
                      <input type="number" name="maxSearchesPerHour" defaultValue={settings.maxSearchesPerHour ?? 6} min="1" max="12"
                        className="w-full px-3 py-2 rounded-lg bg-white/20 border border-white/30 text-white font-bold text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-green-100 mb-1">Max Searches/Day</label>
                      <input type="number" name="maxSearchesPerDay" defaultValue={settings.maxSearchesPerDay ?? 20} min="1" max="60"
                        className="w-full px-3 py-2 rounded-lg bg-white/20 border border-white/30 text-white font-bold text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-green-100 mb-1">Min Delay (min)</label>
                      <input type="number" name="minDelayBetweenSearchesMinutes" defaultValue={settings.minDelayBetweenSearchesMinutes ?? 5} min="5" max="30"
                        className="w-full px-3 py-2 rounded-lg bg-white/20 border border-white/30 text-white font-bold text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-green-100 mb-1">Keywords/Cycle</label>
                      <input type="number" name="maxKeywordsPerCycle" defaultValue={settings.maxKeywordsPerCycle ?? 3} min="1" max="10"
                        className="w-full px-3 py-2 rounded-lg bg-white/20 border border-white/30 text-white font-bold text-sm" />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" name="workHoursOnly" defaultChecked={settings.workHoursOnly ?? true}
                        className="w-4 h-4 rounded border-2 border-white/50" />
                      <span className="text-sm font-semibold text-white">Work hours only (09:00–18:00)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" name="skipWeekends" defaultChecked={settings.skipWeekends ?? true}
                        className="w-4 h-4 rounded border-2 border-white/50" />
                      <span className="text-sm font-semibold text-white">Skip weekends</span>
                    </label>
                  </div>
                  <div className="mt-3 flex gap-4">
                    <div>
                      <label className="block text-xs text-green-100 mb-1">Start hour</label>
                      <input type="number" name="workHoursStart" defaultValue={settings.workHoursStart ?? 9} min="0" max="23"
                        className="w-20 px-2 py-1 rounded bg-white/20 border border-white/30 text-white text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-green-100 mb-1">End hour</label>
                      <input type="number" name="workHoursEnd" defaultValue={settings.workHoursEnd ?? 18} min="0" max="23"
                        className="w-20 px-2 py-1 rounded bg-white/20 border border-white/30 text-white text-sm" />
                    </div>
                  </div>
                </div>

                {/* LinkedIn Cookie Section */}
                <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                  <div className="absolute right-0 top-0 text-white/5 opacity-50 scale-150 -translate-y-1/4 translate-x-1/4">
                    <Bot size={200} />
                  </div>
                  <div className="relative z-10">
                    <h4 className="text-sm font-extrabold text-white mb-3 flex items-center gap-2">
                      <AlertCircle size={16} className="text-primary-500" />
                      LinkedIn Session Cookie
                    </h4>
                    <input
                      type="password"
                      name="linkedinSessionCookie"
                      defaultValue={settings.linkedinSessionCookie}
                      className="w-full px-4 py-3 bg-gray-800 border border-gray-700 text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 font-mono text-sm placeholder:text-gray-500"
                      placeholder="AQEDATX..."
                    />
                    <p className="text-xs text-gray-400 mt-2">
                      The <code className="px-1.5 py-0.5 bg-gray-800 rounded text-primary-400">li_at</code> cookie required for authentication
                    </p>
                  </div>
                </div>

                {/* Rate Limits & Engagement Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Rate Limits */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 mb-4 uppercase tracking-wide flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary-500" />
                      Rate Limits
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                          Max Comments / Day
                        </label>
                        <input
                          type="number"
                          name="maxCommentsPerDay"
                          defaultValue={settings.maxCommentsPerDay ?? 50}
                          className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                          Max Profile Views / Day
                        </label>
                        <input
                          type="number"
                          name="maxProfileViewsPerDay"
                          defaultValue={settings.maxProfileViewsPerDay ?? 100}
                          className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Engagement Thresholds */}
                  <div>
                    <h4 className="text-xs font-bold text-gray-900 mb-4 uppercase tracking-wide flex items-center gap-2">
                      <Users className="w-4 h-4 text-secondary-500" />
                      Engagement Thresholds
                    </h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">
                          Minimum Likes to Comment
                        </label>
                        <input
                          type="number"
                          name="minLikes"
                          defaultValue={settings.minLikes ?? 10}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm font-medium"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wide">
                          Minimum Existing Comments
                        </label>
                        <input
                          type="number"
                          name="minComments"
                          defaultValue={settings.minComments ?? 2}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm font-medium"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Post Targeting Criteria Section */}
                <div className="bg-gradient-to-br from-primary-50 to-secondary-50 rounded-2xl p-6 border-2 border-primary-200">
                  <h4 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wide flex items-center gap-2">
                    <Search className="w-5 h-5 text-primary-600" />
                    🎯 Post Targeting Criteria
                  </h4>
                  <p className="text-xs text-gray-700 mb-6 font-medium">
                    Define the exact reach range for posts you want to target during searches
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Likes Range */}
                    <div className="space-y-4">
                      <h5 className="text-xs font-bold text-primary-900 uppercase tracking-wide flex items-center gap-2">
                        👍 Likes Range
                      </h5>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">
                          Minimum Likes
                        </label>
                        <input
                          type="number"
                          name="minLikes"
                          defaultValue={settings.minLikes ?? 10}
                          min="0"
                          className="w-full px-4 py-3 bg-white border-2 border-primary-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                          placeholder="e.g., 100"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">
                          Maximum Likes (Optional)
                        </label>
                        <input
                          type="number"
                          name="maxLikes"
                          defaultValue={settings.maxLikes ?? 10000}
                          min="0"
                          className="w-full px-4 py-3 bg-white border-2 border-primary-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                          placeholder="e.g., 5000"
                        />
                        <p className="text-xs text-gray-600 mt-1 font-medium">Leave high to target viral posts</p>
                      </div>
                    </div>

                    {/* Comments Range */}
                    <div className="space-y-4">
                      <h5 className="text-xs font-bold text-secondary-900 uppercase tracking-wide flex items-center gap-2">
                        💬 Comments Range
                      </h5>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">
                          Minimum Comments
                        </label>
                        <input
                          type="number"
                          name="minComments"
                          defaultValue={settings.minComments ?? 2}
                          min="0"
                          className="w-full px-4 py-3 bg-white border-2 border-secondary-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-secondary-500 transition-all text-sm font-bold text-gray-900"
                          placeholder="e.g., 5"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">
                          Maximum Comments (Optional)
                        </label>
                        <input
                          type="number"
                          name="maxComments"
                          defaultValue={settings.maxComments ?? 1000}
                          min="0"
                          className="w-full px-4 py-3 bg-white border-2 border-secondary-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-secondary-500 focus:border-secondary-500 transition-all text-sm font-bold text-gray-900"
                          placeholder="e.g., 500"
                        />
                        <p className="text-xs text-gray-600 mt-1 font-medium">Leave high for active discussions</p>
                      </div>
                    </div>
                  </div>

                  {/* Helper Info */}
                  <div className="mt-6 bg-white/70 rounded-lg p-4 border border-primary-200">
                    <p className="text-xs font-bold text-gray-800 mb-2">💡 How This Works:</p>
                    <ul className="text-xs text-gray-700 space-y-1 font-medium">
                      <li>• <strong>Min Likes:</strong> Only target posts with at least this many likes</li>
                      <li>• <strong>Max Likes:</strong> Skip posts that are too viral (set high for no limit)</li>
                      <li>• <strong>Min Comments:</strong> Ensure posts have active engagement</li>
                      <li>• <strong>Max Comments:</strong> Avoid overly saturated discussions</li>
                    </ul>
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-gray-100"></div>

                {/* Human Emulation */}
                <div>
                  <h4 className="text-xs font-bold text-gray-900 mb-4 uppercase tracking-wide flex items-center gap-2">
                    <Bot className="w-4 h-4 text-accent-500" />
                    Human Emulation (Delays)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                        Min Delay (Minutes)
                      </label>
                      <input
                        type="number"
                        name="minDelayMins"
                        defaultValue={settings.minDelayMins ?? 15}
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-2 uppercase tracking-wide">
                        Max Delay (Minutes)
                      </label>
                      <input
                        type="number"
                        name="maxDelayMins"
                        defaultValue={settings.maxDelayMins ?? 45}
                        className="w-full px-4 py-3 bg-white border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all text-sm font-bold text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="pt-4 flex justify-end border-t border-gray-100">
                  <Button type="submit" variant="primary" size="lg">
                    Save Changes
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={setActiveTab} 
        systemActive={systemActive} 
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <Header 
          title={activeTab} 
          sessionConnected={!!settings.linkedinSessionCookie} 
        />

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6 md:p-8 bg-gray-50 relative">
          {/* Background pattern for depth */}
          <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none -z-10"></div>

          <div className="max-w-[1400px] mx-auto pb-20">
            {renderContent()}
          </div>
        </main>
      </div>
    </>
  );
}


