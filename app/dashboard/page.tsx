'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard, Search, MessageSquareText, Settings, Activity, Users,
  TrendingUp, AlertCircle, Play, Pause, Plus, Trash2, Bot, PenTool, Sparkles, Shield, Zap
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
import DailySummaryCard from '@/components/dashboard/DailySummaryCard';
import { SavedPostsPanel } from '@/components/dashboard/SavedPostsPanel';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input, { TextArea } from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import Badge from '@/components/ui/Badge';
import OnboardingWizard from '@/components/dashboard/OnboardingWizard';

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

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);
  const [wizardHasTriggered, setWizardHasTriggered] = useState(false);

  const fetchData = async () => {
    // Fetch Settings
    const setRes = await fetch('/api/settings');

    if (setRes.status === 401) {
      router.push('/login');
      return;
    }

    let settingsData: any = null;
    if (setRes.ok) {
      settingsData = await setRes.json();
      setSettings(settingsData);
      setSystemActive(settingsData.systemActive);
    }

    // Fetch Stats & Logs for Dashboard
    if (activeTab === 'dashboard') {
      const stRes = await fetch('/api/stats');
      if (stRes.ok) setStats(await stRes.json());
      const lgRes = await fetch('/api/logs');
      if (lgRes.ok) setLogs(await lgRes.json());
    }

    // Always fetch keywords (needed for Wizard logic and global tabs)
    let currentKeywords = [];
    const kwRes = await fetch('/api/keywords');
    if (kwRes.ok) {
      currentKeywords = await kwRes.json();
      setKeywords(currentKeywords);
    }

    // Trigger Wizard for brand new accounts (0 keywords and never connected extension)
    if (!wizardHasTriggered && settingsData && kwRes.ok) {
      if (!settingsData.lastHeartbeat && currentKeywords.length === 0) {
        setShowWizard(true);
        setWizardHasTriggered(true);
      }
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
    // Listen for extension bridge messages
    const handleBridgeMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || event.data.source !== 'NEXORA_EXTENSION') return;
      
      if (event.data.action === 'EXTENSION_READY') {
        console.log('🔗 Extension Bridge connected');
      } else if (event.data.action === 'ENGINE_STARTED_ACK') {
        console.log('🚀 Extension acknowledged START command');
        // Force an immediate fetch to sync UI
        fetchData();
      }
    };
    
    window.addEventListener('message', handleBridgeMessage);

    // Small delay on first load to ensure cookie is set
    const initialTimeout = setTimeout(fetchData, 100);
    
    // Then poll every 5 seconds
    const interval = setInterval(fetchData, 5000);
    
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
      window.removeEventListener('message', handleBridgeMessage);
    };
  }, [activeTab]);

  const toggleSystem = async () => {
    const newState = !systemActive;
    
    // Optimistic UI update
    setSystemActive(newState);
    
    // ✅ Update settings to toggle systemActive flag for the Extension
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemActive: newState })
    });

    console.log(`🤖 Extension Pilot: ${newState ? 'ACTIVE' : 'PAUSED'}`);
    
    // 🚀 Send direct push to the extension (via injected dashboard-bridge.js)
    if (newState) {
      window.postMessage({ source: 'NEXORA_DASHBOARD', action: 'START_ENGINE' }, '*');
    }
  };

  const [isDeployingPack, setIsDeployingPack] = useState(false);
  const loadStarterPack = async (packType: string) => {
    setIsDeployingPack(true);
    try {
      const res = await fetch('/api/starter-packs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: packType })
      });
      if (res.ok) {
        await fetchData(); // Reactively updates UI with the new keywords and comments
      }
    } catch (e) {
      console.error('Error loading starter pack:', e);
    } finally {
      setIsDeployingPack(false);
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
      maxKeywordsPerCycle: Number(formData.get('maxKeywordsPerCycle') ?? 3),
      // Proxy Configuration
      proxyHost: formData.get('proxyHost') as string || null,
      proxyPort: formData.get('proxyPort') ? Number(formData.get('proxyPort')) : null,
      proxyUser: formData.get('proxyUser') as string || null,
      proxyPass: formData.get('proxyPass') as string || null
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
            {/* Top Stats & Browser Status */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2">
                <DailySummaryCard stats={stats} settings={settings} />
              </div>

              <div className="lg:col-span-1">
                <Card className="h-full bg-gradient-to-br from-primary-600 to-primary-700 border-none shadow-xl shadow-primary-500/20">
                  <div className="p-6 text-white h-full flex flex-col">
                    <div className="flex justify-between items-start mb-6">
                      <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-md">
                        <Shield className="w-6 h-6 text-white" />
                      </div>
                      
                      {/* Dynamic Heartbeat Indicator */}
                      {(() => {
                        const isOnline = settings.lastHeartbeat && 
                          (new Date().getTime() - new Date(settings.lastHeartbeat).getTime()) < 10 * 60 * 1000;
                        const statusColor = isOnline ? 'bg-success-500' : 'bg-error-500';
                        const statusText = isOnline ? 'Online' : 'Offline';
                        
                        let seenText = 'Never connected';
                        if (settings.lastHeartbeat) {
                          const mins = Math.floor((new Date().getTime() - new Date(settings.lastHeartbeat).getTime()) / 60000);
                          if (mins < 1) seenText = 'Just now';
                          else if (mins < 60) seenText = `${mins}m ago`;
                          else if (mins < 1440) seenText = `${Math.floor(mins/60)}h ago`;
                          else seenText = `${Math.floor(mins/1440)}d ago`;
                        }

                        return (
                          <div className="flex flex-col items-end">
                            <Badge variant={isOnline ? "success" : "error"} size="sm" className="bg-white/20 text-white border-white/30 backdrop-blur-md mb-1">
                              <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${statusColor} ${isOnline ? 'animate-pulse' : ''}`}></span>
                              {statusText}
                            </Badge>
                            <span className="text-[10px] text-white/70 font-medium">Last seen: {seenText}</span>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex flex-col flex-1 justify-between">
                      <div className="mb-6">
                        <h3 className="text-lg font-extrabold mb-1 truncate">Browser Active</h3>
                        <p className="text-[11px] text-primary-100 font-medium leading-tight">
                          {settings.extensionStatus || "Integrated with Chrome for maximum safety."}
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
                      <td colSpan={4} className="p-0">
                        <div className="bg-gradient-to-br from-primary-50 to-primary-100/30 p-8 md:p-12 text-center border-b border-gray-100">
                          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-white shadow-xl shadow-primary-500/10 flex items-center justify-center transform -rotate-6">
                            <Zap className="w-10 h-10 text-primary-500" />
                          </div>
                          <h4 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Zero to Hero in 1-Click</h4>
                          <p className="text-base text-gray-600 max-w-lg mx-auto mb-10 leading-relaxed">
                            Don't know what to target? Load a curated Starter Pack. 
                            We'll instantly set up high-converting <strong className="text-primary-700">keywords</strong> and AI-crafted <strong className="text-primary-700">comments</strong> for you.
                          </p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                            {/* Pack 1 */}
                            <button 
                              onClick={() => loadStarterPack('marketing')}
                              disabled={isDeployingPack}
                              className={`group bg-white p-6 rounded-2xl text-left border-2 transition-all ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-gray-100 hover:border-primary-400 hover:shadow-2xl hover:shadow-primary-500/20 hover:-translate-y-1'}`}
                            >
                              <div className="flex justify-between items-start mb-4">
                                <Badge variant="primary" className="bg-primary-100 text-primary-700">B2B Marketing</Badge>
                                {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                              </div>
                              <h5 className="text-lg font-extrabold text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">Growth & Marketing Pack</h5>
                              <p className="text-sm font-bold text-gray-400">+3 Keywords • +9 Comments</p>
                            </button>

                            {/* Pack 2 */}
                            <button 
                              onClick={() => loadStarterPack('tech')}
                              disabled={isDeployingPack}
                              className={`group bg-white p-6 rounded-2xl text-left border-2 transition-all ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-gray-100 hover:border-blue-400 hover:shadow-2xl hover:shadow-blue-500/20 hover:-translate-y-1'}`}
                            >
                              <div className="flex justify-between items-start mb-4">
                                <Badge variant="secondary" className="bg-blue-100 text-blue-700">Tech & SaaS</Badge>
                                {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                              </div>
                              <h5 className="text-lg font-extrabold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">Software Engineering Pack</h5>
                              <p className="text-sm font-bold text-gray-400">+3 Keywords • +9 Comments</p>
                            </button>
                          </div>
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
                <div className="bg-gradient-to-br from-primary-50 to-primary-100/30 p-8 md:p-12 text-center rounded-3xl border border-gray-100">
                  <div className="w-20 h-20 mx-auto mb-6 rounded-3xl bg-white shadow-xl shadow-primary-500/10 flex items-center justify-center transform rotate-6">
                    <Zap className="w-10 h-10 text-primary-500" />
                  </div>
                  <h4 className="text-2xl font-black text-gray-900 mb-3 tracking-tight">Zero to Hero in 1-Click</h4>
                  <p className="text-base text-gray-600 max-w-lg mx-auto mb-10 leading-relaxed">
                    Don't know what to write? Load a curated Starter Pack. 
                    We'll instantly set up high-converting <strong className="text-primary-700">keywords</strong> and AI-crafted <strong className="text-primary-700">comments</strong> for you.
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                    {/* Pack 1 */}
                    <button 
                      onClick={() => loadStarterPack('marketing')}
                      disabled={isDeployingPack}
                      className={`group bg-white p-6 rounded-2xl text-left border-2 transition-all ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-gray-100 hover:border-primary-400 hover:shadow-2xl hover:shadow-primary-500/20 hover:-translate-y-1'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <Badge variant="primary" className="bg-primary-100 text-primary-700">B2B Marketing</Badge>
                        {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                      </div>
                      <h5 className="text-lg font-extrabold text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">Growth & Marketing Pack</h5>
                      <p className="text-sm font-bold text-gray-400">+3 Keywords • +9 Comments</p>
                    </button>

                    {/* Pack 2 */}
                    <button 
                      onClick={() => loadStarterPack('tech')}
                      disabled={isDeployingPack}
                      className={`group bg-white p-6 rounded-2xl text-left border-2 transition-all ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-gray-100 hover:border-blue-400 hover:shadow-2xl hover:shadow-blue-500/20 hover:-translate-y-1'}`}
                    >
                      <div className="flex justify-between items-start mb-4">
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">Tech & SaaS</Badge>
                        {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                      </div>
                      <h5 className="text-lg font-extrabold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">Software Engineering Pack</h5>
                      <p className="text-sm font-bold text-gray-400">+3 Keywords • +9 Comments</p>
                    </button>
                  </div>
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

                   {/* Comprehensive Installation Masterclass */}
                <div className="pt-12 border-t border-gray-100">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-12">
                    <div>
                      <h4 className="text-sm font-bold text-primary-500 uppercase tracking-widest mb-2">2. Visual Setup Masterclass</h4>
                      <h3 className="text-3xl font-black text-gray-900">Step-by-Step Implementation</h3>
                    </div>
                    <p className="text-sm text-gray-500 font-medium max-w-xs md:text-right">
                      Follow these 4 steps to activate your industrial-scale automation.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {/* Step 1 */}
                    <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] overflow-hidden hover:border-primary-300 transition-all shadow-sm hover:shadow-xl group">
                      <div className="aspect-video bg-gray-50 relative overflow-hidden">
                        <img src="/img/step1.png" alt="Extracting ZIP" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 bg-gray-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-lg">01</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-gray-900 mb-2">فك الضغط عن الملف (Extract ZIP)</h5>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium">
                          بعد تحميل الملف، قم بالضغط عليه بزر الفأرة الأيمن واختر <strong>Extract All</strong>. تأكد من فكه في مجلد واضح على سطح المكتب.
                          <br /><span className="text-xs text-gray-400 mt-2 block italic">Right-click the ZIP and extract it to your desktop.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] overflow-hidden hover:border-primary-300 transition-all shadow-sm hover:shadow-xl group">
                      <div className="aspect-video bg-gray-50 relative overflow-hidden">
                        <img src="/img/step2.png" alt="Developer Mode" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 bg-gray-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-lg">02</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-gray-900 mb-2">تفعيل وضع المطور (Developer Mode)</h5>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium">
                          اذهب إلى <strong>chrome://extensions</strong> في متصفحك. قم بتفعيل زر <strong>Developer Mode</strong> الموجود في أعلى يمين الصفحة.
                          <br /><span className="text-xs text-gray-400 mt-2 block italic">Go to extensions settings and toggle the Developer Mode switch ON.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="bg-white border-2 border-gray-100 rounded-[2.5rem] overflow-hidden hover:border-primary-300 transition-all shadow-sm hover:shadow-xl group">
                      <div className="aspect-video bg-gray-50 relative overflow-hidden">
                        <img src="/img/step3.png" alt="Load Unpacked" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 bg-gray-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-lg">03</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-gray-900 mb-2">تحميل الإضافة (Load Unpacked)</h5>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium">
                          اضغط على زر <strong>Load Unpacked</strong> واختر المجلد الذي قمت بفك ضغطه في الخطوة الأولى. ستظهر لك إضافة Nexora فوراً.
                          <br /><span className="text-xs text-gray-400 mt-2 block italic">Click "Load Unpacked" and select the extracted folder.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="bg-white border-2 border-primary-100 rounded-[2.5rem] overflow-hidden hover:border-primary-300 transition-all shadow-sm hover:shadow-xl group ring-4 ring-primary-50">
                      <div className="aspect-video bg-primary-50 relative overflow-hidden">
                        <img src="/img/step4.png" alt="Sync and Run" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 bg-primary-600 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-lg">04</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-primary-900 mb-2">المزامنة والتشغيل (Sync & Run)</h5>
                        <div className="space-y-3">
                          <p className="text-sm text-gray-700 leading-relaxed font-bold">
                            افتح الإضافة، الصق مفاتيح الربط (Keys) المذكورة أعلاه، واضغط على <strong>Sync & Run Now</strong>.
                          </p>
                          <div className={`px-4 py-2 rounded-xl text-[10px] font-black inline-flex items-center gap-2 ${systemActive ? 'bg-success-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                             <div className={`w-2 h-2 rounded-full ${systemActive ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
                             AGENT STATUS: {systemActive ? 'READY TO WORK' : 'PAUSED (START PILOT FIRST)'}
                          </div>
                        </div>
                      </div>
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
                          LinkedIn Session Cookie (li_at)
                        </label>
                        <input
                          type="text"
                          name="linkedinSessionCookie"
                          defaultValue={settings.linkedinSessionCookie || ''}
                          placeholder="Paste your li_at cookie here"
                          className="w-full px-4 py-3 bg-gray-800 border-2 border-gray-700 rounded-xl text-sm font-mono font-bold text-primary-400 outline-none focus:border-primary-500 transition-all"
                        />
                        <p className="text-[10px] text-gray-500 font-medium italic">Crucial for server-side authentication. Do not share.</p>
                      </div>
                      
                      <div className="space-y-3">
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest">
                          Network Status
                        </label>
                        <div className="px-5 py-3 bg-primary-500/10 border-2 border-primary-500/20 rounded-xl text-sm font-bold text-primary-400 flex items-center gap-3">
                           <div className="w-2.5 h-2.5 rounded-full bg-primary-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
                           Cloud Scraper Mode Active
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

      case 'extension-connect':
        return (
          <div className="space-y-6">
            <Card>
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-primary-100 rounded-2xl flex items-center justify-center">
                    <Bot className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-extrabold text-gray-900">Connect Extension</h3>
                    <p className="text-xs text-gray-500 font-medium">Link your Chrome extension in one click</p>
                  </div>
                </div>

                {/* Step 1: Install */}
                <div className="bg-gray-50 border-2 border-gray-100 rounded-2xl p-6 mb-4">
                  <h4 className="text-sm font-extrabold text-gray-800 mb-2 flex items-center gap-2">
                    <span className="w-6 h-6 bg-primary-500 text-white rounded-full flex items-center justify-center text-xs font-black">1</span>
                    Install Extension
                  </h4>
                  <p className="text-xs text-gray-500 mb-3">Download and install the Chrome extension first.</p>
                  <a href="/LinkedInExtension.zip" download className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-xs font-bold hover:bg-primary-600 transition-all">
                    ⬇️ Download Extension ZIP
                  </a>
                </div>

                {/* Step 2: Auto-Connect */}
                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-6 mb-4">
                  <h4 className="text-sm font-extrabold text-gray-800 mb-2 flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-black">2</span>
                    One-Click Connect
                  </h4>
                  <p className="text-xs text-gray-500 mb-3">Open the extension popup while on this page, then click <strong>"🔗 Auto-Connect"</strong>. It will link automatically!</p>
                  <div className="bg-white rounded-xl p-4 border border-blue-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Your Connection Code</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-50 text-sm font-mono font-bold text-gray-800 p-2 rounded-lg border">{settings.userId || 'Loading...'}</code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(settings.userId || '');
                          const btn = document.getElementById('copy-uid-btn');
                          if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000); }
                        }}
                        id="copy-uid-btn"
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-bold transition-all"
                      >
                        📋 Copy
                      </button>
                    </div>
                  </div>
                </div>

                {/* Hidden DOM element for extension auto-detection */}
                <div
                  id="nexora-connect-data"
                  data-user-id={settings.userId || ''}
                  data-dashboard-url={typeof window !== 'undefined' ? window.location.origin : ''}
                  style={{ display: 'none' }}
                />

                {/* Step 3: Activate */}
                <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
                  <h4 className="text-sm font-extrabold text-gray-800 mb-2 flex items-center gap-2">
                    <span className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-black">3</span>
                    Activate
                  </h4>
                  <p className="text-xs text-gray-500">Once connected, go back to the Dashboard and click <strong>🚀 START</strong> to begin automated engagement!</p>
                </div>
              </div>
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Onboarding Wizard Modal */}
      <OnboardingWizard 
        isOpen={showWizard} 
        onClose={() => setShowWizard(false)} 
        loadStarterPack={loadStarterPack}
        isDeployingPack={isDeployingPack}
      />

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


