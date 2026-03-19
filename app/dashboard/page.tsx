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
    
    // ✅ Update settings to toggle systemActive flag for the Extension
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemActive: newState })
    });

    console.log(`🤖 Extension Pilot: ${newState ? 'ACTIVE' : 'PAUSED'}`);
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

              <div className="lg:col-span-1">
                <Card className="h-full bg-gradient-to-br from-primary-600 to-primary-700 border-none shadow-xl shadow-primary-500/20">
                  <div className="p-6 text-white h-full flex flex-col">
                    <div className="flex justify-between items-start mb-6">
                      <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                        <Shield className="w-6 h-6 text-white" />
                      </div>
                      <Badge variant="success" size="sm" className="bg-white/20 text-white border-white/30 backdrop-blur-md">
                        Extension Active
                      </Badge>
                    </div>

                    <div className="flex flex-col flex-1 justify-between">
                      <div className="mb-6">
                        <h3 className="text-lg font-extrabold mb-1 truncate">Browser Active</h3>
                        <p className="text-[11px] text-primary-100 font-medium leading-tight">
                          Integrated with Chrome for maximum safety.
                        </p>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-white/10">
                        {/* Agent Pilot Row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-primary-200 uppercase tracking-widest">Pilot</p>
                            <p className="text-xs font-black truncate">{systemActive ? 'ACTIVE' : 'PAUSED'}</p>
                          </div>
                          <button
                            onClick={toggleSystem}
                            type="button"
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                              systemActive 
                                ? 'bg-success-400 text-white shadow-md shadow-success-500/30' 
                                : 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
                            }`}
                          >
                            {systemActive ? '⏸️ PAUSE' : '🚀 START'}
                          </button>
                        </div>

                        {/* Manage Row */}
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold text-primary-200 uppercase tracking-widest">Extension</p>
                          <button
                            onClick={() => setActiveTab('extension-connect')}
                            type="button"
                            className="bg-white/10 hover:bg-white/20 text-white border border-white/30 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                          >
                            Manage
                          </button>
                        </div>
                      </div>
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
      case 'extension-connect':
        return (
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Professional Setup Card */}
            <Card className="overflow-hidden border-2 border-primary-100 shadow-2xl">
              <div className="p-8 md:p-12 border-b border-gray-100 bg-gradient-to-br from-gray-900 to-gray-800 text-white relative">
                <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none">
                  <Shield className="w-48 h-48" />
                </div>
                
                <div className="relative z-10">
                  <Badge variant="primary" className="mb-4 bg-primary-500 text-white border-none">Step-by-Step Guide</Badge>
                  <h3 className="text-4xl font-black mb-4">Connect Nexora <span className="text-primary-400">Pro</span></h3>
                  <p className="text-lg text-gray-300 max-w-2xl leading-relaxed">
                    Transform your browser into a high-powered LinkedIn automation hub. 
                    Simple, safe, and 100% automated.
                  </p>
                </div>
              </div>

              <div className="p-8 md:p-12 space-y-12">
                {/* Credentials Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">1. Your Connection Keys</h4>
                      <div className="space-y-4">
                        <div className="group">
                          <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Dashboard URL</label>
                          <div className="flex gap-2">
                            <input 
                              readOnly 
                              value={typeof window !== 'undefined' ? window.location.origin : ''} 
                              className="flex-1 px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-mono font-bold text-gray-700 outline-none"
                            />
                            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(window.location.origin)}>Copy</Button>
                          </div>
                        </div>
                        <div className="group">
                          <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Your Private API Key (User ID)</label>
                          <div className="flex gap-2">
                            <input 
                              readOnly 
                              value={settings.userId || 'Loading...'} 
                              className="flex-1 px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-mono font-bold text-primary-700 outline-none"
                            />
                            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(settings.userId)}>Copy</Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-primary-50 rounded-3xl p-8 border-2 border-primary-100 flex flex-col justify-center">
                    <h4 className="text-xl font-bold text-primary-900 mb-4 flex items-center gap-2">
                       <Sparkles className="w-6 h-6" /> Install Extension
                    </h4>
                    <p className="text-primary-800 mb-8 text-sm leading-relaxed font-medium">
                      Download the Nexora Industrial-Strength extension and load it into your Chrome browser to begin automated extraction.
                    </p>
                    <a href="/LinkedInExtension.zip" download className="w-full">
                      <Button variant="primary" size="lg" className="w-full shadow-xl shadow-primary-500/30 py-6 text-lg">
                        Download Extension (.ZIP)
                      </Button>
                    </a>
                  </div>
                </div>

                {/* Installation Steps */}
                <div className="pt-8 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-8">2. Quick Installation</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[
                      { step: '01', title: 'Extract ZIP', desc: 'Unzip the downloaded file onto your desktop.' },
                      { step: '02', title: 'Load Unpacked', desc: 'Go to chrome://extensions, enable Developer Mode, and click "Load Unpacked".' },
                      { step: '03', title: 'Sync & Run', desc: `Open extension, paste keys, and click Sync. (Agent Pilot: ${systemActive ? '✅ ON' : '❌ PAUSED'})` }
                    ].map((s) => (
                      <div key={s.step} className="p-6 bg-white border-2 border-gray-100 rounded-3xl hover:border-primary-300 transition-all group">
                         <span className="text-3xl font-black text-gray-100 group-hover:text-primary-100 transition-colors block mb-4">{s.step}</span>
                         <h5 className="font-bold text-gray-900 mb-2">{s.title}</h5>
                         <p className="text-sm text-gray-500 leading-relaxed font-medium">{s.desc}</p>
                      </div>
                    ))}
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
            {/* Chrome Extension Integration */}
            <Card className="mb-8 border-2 border-indigo-100 overflow-hidden shadow-sm">
              <div className="p-6 md:p-8 border-b border-indigo-50 bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500 text-white flex items-center justify-center shadow-md">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-gray-900">
                      Chrome Extension Connection
                    </h3>
                    <p className="text-sm text-gray-600 font-medium mt-1">
                      Link your local browser extension to this dashboard
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 md:p-8 bg-white">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                  <div className="flex-1 text-center md:text-left">
                    <p className="text-sm font-extrabold text-gray-800 uppercase tracking-wide">
                      Your Dashboard API Key (User ID)
                    </p>
                    <p className="text-xs text-gray-500 mb-3 mt-1 font-medium">
                      Copy and paste this exact key into the Chrome Extension popup window to authenticate it.
                    </p>
                    <code className="bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2 rounded-lg font-mono text-base font-bold select-all block break-all">
                      {settings.userId || 'Loading...'}
                    </code>
                  </div>
                  <Button 
                    onClick={() => {
                      if (settings.userId) {
                        navigator.clipboard.writeText(settings.userId);
                        alert('✅ API Key copied to clipboard!');
                      }
                    }}
                    variant="primary"
                    className="shrink-0 w-full md:w-auto shadow-md"
                  >
                    Copy API Key
                  </Button>
                </div>
              </div>
            </Card>

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

                {/* API & Connection Profile Section */}
                <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 shadow-2xl relative overflow-hidden">
                  <div className="absolute right-0 top-0 text-white/5 opacity-50 scale-150 -translate-y-1/4 translate-x-1/4">
                    <Shield size={200} />
                  </div>
                  
                  <div className="relative z-10 space-y-8">
                    <h4 className="text-sm font-extrabold text-white mb-6 uppercase tracking-widest flex items-center gap-3">
                       <Shield className="w-5 h-5 text-primary-500" />
                       Connection Profile
                    </h4>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Your API License Key (User ID)
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            readOnly
                            value={settings.userId || ''}
                            className="flex-1 px-4 py-3 bg-gray-800 border-2 border-gray-700 rounded-xl text-sm font-mono font-bold text-primary-400 outline-none"
                          />
                        </div>
                        <p className="text-[10px] text-gray-500 font-medium">Use this key inside your Chrome Extension to connect this dashboard.</p>
                      </div>
                      
                      <div className="space-y-3">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Network Status
                        </label>
                        <div className="px-5 py-3 bg-success-500/10 border-2 border-success-500/20 rounded-xl text-sm font-bold text-success-400 flex items-center gap-3">
                           <div className="w-2.5 h-2.5 rounded-full bg-success-500 animate-pulse shadow-[0_0_10px_rgba(34,197,94,0.6)]" />
                           Browser Integrated Mode active
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Post Targeting & Human Emulation Grid */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                  {/* Targeting Criteria */}
                  <div className="bg-white border-2 border-gray-100 rounded-3xl p-8 hover:border-primary-200 transition-all shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900 mb-6 uppercase tracking-widest flex items-center gap-2">
                      <Search className="w-5 h-5 text-primary-600" />
                      Targeting Criteria
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Min Likes</label>
                        <input type="number" name="minLikes" defaultValue={settings.minLikes ?? 10} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Max Likes</label>
                        <input type="number" name="maxLikes" defaultValue={settings.maxLikes ?? 10000} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Min Comm.</label>
                        <input type="number" name="minComments" defaultValue={settings.minComments ?? 2} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Max Comm.</label>
                        <input type="number" name="maxComments" defaultValue={settings.maxComments ?? 1000} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                      </div>
                    </div>
                  </div>

                  {/* Safety Delays */}
                  <div className="bg-white border-2 border-gray-100 rounded-3xl p-8 hover:border-accent-200 transition-all shadow-sm">
                    <h4 className="text-sm font-bold text-gray-900 mb-6 uppercase tracking-widest flex items-center gap-2">
                      <Bot className="w-5 h-5 text-accent-500" />
                      Safety Delays
                    </h4>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Min (Mins)</label>
                          <input type="number" name="minDelayMins" defaultValue={settings.minDelayMins ?? 15} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Max (Mins)</label>
                          <input type="number" name="maxDelayMins" defaultValue={settings.maxDelayMins ?? 45} className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl text-sm font-bold" />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 italic">Randomized delays emulate human behavior to prevent detection.</p>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <div className="pt-8 flex justify-end">
                  <Button type="submit" variant="primary" size="lg" className="px-16 py-6 text-lg shadow-2xl shadow-primary-500/30">
                    Apply Global Settings
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
          sessionConnected={true} 
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


