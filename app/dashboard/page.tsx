'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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

  // Campaign Builder states
  const [newKeyword, setNewKeyword] = useState('');
  const [newKeywordReach, setNewKeywordReach] = useState(1000);
  const [newTargetCycles, setNewTargetCycles] = useState(1);
  // Flattened array of comments. Cycle 1 gets index 0 and 1. Cycle 2 gets 2 and 3, etc.
  const [newComments, setNewComments] = useState<string[]>(['', '']);
  const [newTopic, setNewTopic] = useState('');

  // Search-Only Config UI State
  const [searchConfig, setSearchConfig] = useState<string[][]>([['', '']]);
  const [searchTargetCycles, setSearchTargetCycles] = useState<number>(1);
  const [isSearchOnly, setIsSearchOnly] = useState<boolean>(true);
  const hasLoadedSettings = useRef(false);

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);

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

      // Initialize search config state exactly once to not overwrite user edits during polling
      if (!hasLoadedSettings.current) {
        setIsSearchOnly(settingsData.searchOnlyMode ?? true);
        try {
          const parsed = JSON.parse(settingsData.searchConfigJson || "[]");
          if (Array.isArray(parsed) && parsed.length > 0) {
            setSearchConfig(parsed);
            setSearchTargetCycles(parsed.length);
          }
        } catch (e) {}
        hasLoadedSettings.current = true;
      }
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
    if (settingsData && kwRes.ok) {
      // Use localStorage to permanently suppress the wizard once shown/dismissed
      const hasSeenWizard = typeof window !== 'undefined' ? localStorage.getItem('nexora_wizard_seen') === 'true' : false;
      
      if (!hasSeenWizard && !settingsData.lastHeartbeat && currentKeywords.length === 0) {
        setShowWizard(true);
        if (typeof window !== 'undefined') {
          localStorage.setItem('nexora_wizard_seen', 'true');
        }
      }
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
    // START VALIDATION
    if (!systemActive) {
      if (isSearchOnly) {
        // Search-Only Mode Validation
        // Fetch fresh settings first because React state might not reflect what's saved in DB if they didn't click Save Search Configuration
        const setRes = await fetch('/api/settings');
        if (setRes.ok) {
          const freshSettings = await setRes.json();
          let parsedSearch = [];
          try {
            parsedSearch = JSON.parse(freshSettings.searchConfigJson || "[]");
          } catch(e) {}
          
          if (!parsedSearch || parsedSearch.length === 0) {
            alert("No Search Configuration found!\n\nPlease scroll down to 'Agent Configuration' -> 'Operating Mode', build your search cycles, and click 'Save Search Configuration' before starting.");
            return;
          }
          
          const validKeywords = parsedSearch.flat().filter((kw: string) => typeof kw === 'string' && kw.trim().length > 0);
          if (validKeywords.length === 0) {
            alert("Your saved Search Configuration has 0 valid keywords.\n\nPlease define your keywords per cycle and click 'Save Search Configuration' before starting.");
            return;
          }
        }
      } else {
        // Comment Mode Validation
        if (keywords.length === 0) {
          alert("You must define at least one keyword campaign before starting.");
          return;
        }
        
        const invalidKeywords: string[] = [];
        for (const kw of keywords) {
          const required = (kw.targetCycles || 1) * 2;
          const kwComments = kw.comments || [];
          if (kwComments.length !== required) {
            invalidKeywords.push(kw.keyword);
          }
        }

        if (invalidKeywords.length > 0) {
          alert(`Cannot start. The following campaigns have missing or invalid comment configurations:\n\n${invalidKeywords.join(', ')}\n\nPlease recreate them with exact comments for each cycle.`);
          return;
        }
      }
    }

    const newState = !systemActive;
    
    // Optimistic UI update
    setSystemActive(newState);
    
    // ✅ Persist to DB first. This takes ~50ms but prevents a fatal Race Condition
    // where the extension polls the API before the database finishes saving systemActive=true!
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemActive: newState, searchOnlyMode: isSearchOnly })
    });

    console.log(`🤖 Extension Pilot: ${newState ? 'ACTIVE' : 'PAUSED'}`);
    
    // 🚀 Send direct push to the extension IMMEDIATELY (via injected dashboard-bridge.js)
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
    if (!newKeyword) {
      alert("Missing Keyword.");
      return;
    }
    
    // Validate comments
    const requiredCommentsCount = newTargetCycles * 2;
    const commentsToSubmit = newComments.slice(0, requiredCommentsCount);
    if (commentsToSubmit.some(c => !c.trim())) {
      alert(`Missing comments. You must provide exactly ${requiredCommentsCount} comments.`);
      return;
    }

    const formattedComments = commentsToSubmit.map((text, i) => ({
      text,
      cycleIndex: Math.floor(i / 2) + 1 // 0,1 -> 1. 2,3 -> 2. 4,5 -> 3
    }));

    await fetch('/api/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        keyword: newKeyword, 
        targetReach: newKeywordReach,
        targetCycles: newTargetCycles,
        comments: formattedComments
      })
    });
    setNewKeyword('');
    setNewKeywordReach(1000);
    setNewTargetCycles(1);
    setNewComments(['', '']);
    fetchData();
  };

  const deleteKeyword = async (id: string) => {
    await fetch(`/api/keywords/${id}`, { method: 'DELETE' });
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
      proxyPass: formData.get('proxyPass') as string || null,
      
      // Search UI
      searchConfigJson: JSON.stringify(searchConfig)
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
          { name: 'Mon', value: 12 }, { name: 'Tue', value: 19 }, { name: 'Wed', value: 15 },
          { name: 'Thu', value: 25 }, { name: 'Fri', value: 22 }, { name: 'Sat', value: 18 }, { name: 'Sun', value: 20 },
        ];

        return (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <div className="lg:col-span-2">
                <DailySummaryCard stats={stats} settings={settings} />
              </div>

              <div className="lg:col-span-1">
                <Card variant="dashboard" accent="extension" className="h-full">
                  <div className="p-6 h-full flex flex-col">
                    <div className="flex justify-between items-start mb-6">
                      <div className="p-3 rounded-xl" style={{ background: 'var(--dash-surface-2)' }}>
                        <Shield className="w-6 h-6" style={{ color: 'var(--section-extension)' }} />
                      </div>
                      
                      {(() => {
                        const isOnline = settings.lastHeartbeat && (new Date().getTime() - new Date(settings.lastHeartbeat).getTime()) < 10 * 60 * 1000;
                        const statusColor = isOnline ? 'bg-success' : 'bg-[#ff3b30]';
                        
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
                            <Badge variant={isOnline ? "success" : "error"} size="sm" dot>
                              {isOnline ? 'Online' : 'Offline'}
                            </Badge>
                            <span className="text-[10px] text-secondary mt-1">Last seen: {seenText}</span>
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex flex-col flex-1 justify-between">
                      <div className="mb-6">
                        <h3 className="text-tile-heading text-primary mb-1">Browser Active</h3>
                        <p className="text-caption text-secondary">
                          {settings.extensionStatus || "Integrated with Chrome for maximum safety."}
                        </p>
                      </div>

                      <div className="space-y-4 pt-4" style={{ borderTop: '1px solid var(--dash-border)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-micro-bold text-secondary uppercase mb-0.5">Pilot</p>
                            <p className="text-caption-bold text-primary">{systemActive ? 'ACTIVE' : 'PAUSED'}</p>
                          </div>
                          <button
                            onClick={toggleSystem}
                            type="button"
                            className={`px-3 py-1.5 rounded-md text-micro-bold transition-premium ${
                              systemActive 
                                ? 'bg-success/12 text-success' 
                                : 'text-primary'
                            }`}
                            style={!systemActive ? { background: 'var(--dash-surface-3)' } : {}}
                          >
                            {systemActive ? '⏸️ PAUSE' : '🚀 START'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <p className="text-micro-bold text-secondary uppercase">Extension</p>
                          <button
                            onClick={() => setActiveTab('extension-connect')}
                            type="button"
                            className="text-primary px-3 py-1.5 rounded-md text-micro-bold transition-premium"
                            style={{ background: 'var(--dash-surface-3)' }}
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

            <Chart data={chartData} />

            <ActivityFeed logs={logs.map((log: any) => ({
              id: log.id, action: log.action,
              status: log.action.includes('✅') ? 'Success' : log.action.includes('❌') ? 'Failed' : 'Pending',
              time: log.timestamp, postUrl: log.postUrl, commentUrl: log.commentUrl, comment: log.comment
            }))} />
          </div>
        );
      case 'keywords':
        return (
          <Card variant="dashboard" accent="campaigns">
            <div className="p-6 md:p-8 flex flex-col gap-6" style={{ borderBottom: '1px solid var(--dash-border)', background: 'var(--dash-surface-2)' }}>
                <div>
                  <h3 className="text-xl font-bold text-primary flex items-center gap-2">
                    <Search className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--section-campaigns)' }} />
                    New Campaign Builder
                  </h3>
                  <p className="text-sm text-secondary mt-1">
                    Setup a keyword and strictly map exact comments for each of its cycles.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Input
                    label="Keyword or Topic"
                    type="text"
                    value={newKeyword}
                    onChange={e => setNewKeyword(e.target.value)}
                    placeholder="E.g. SaaS growth"
                  />
                  <div>
                    <label className="block text-sm font-bold text-secondary mb-2">Target Reach</label>
                    <select
                      value={newKeywordReach}
                      onChange={e => setNewKeywordReach(parseInt(e.target.value))}
                      className="w-full px-3 py-2 border border-border-subtle rounded-lg text-sm text-primary bg-surface-hover focus:ring-2 focus:ring-apple-blue/30"
                    >
                      <option value={100}>100-500 (Small)</option>
                      <option value={500}>500-1K (Medium)</option>
                      <option value={1000}>1K-5K (Large)</option>
                      <option value={5000}>5K-10K (Viral)</option>
                      <option value={10000}>10K+ (Mega)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-secondary mb-2">Cycles to Run</label>
                    <select
                      value={newTargetCycles}
                      onChange={e => {
                        const val = parseInt(e.target.value);
                        setNewTargetCycles(val);
                        setNewComments(prev => {
                          const newArr = [...prev];
                          while(newArr.length < val * 2) newArr.push('');
                          return newArr;
                        });
                      }}
                      className="w-full px-3 py-2 border border-border-subtle rounded-lg text-sm text-primary bg-surface-hover focus:ring-2 focus:ring-apple-blue/30"
                    >
                      <option value={1}>1 Cycle (2 actions)</option>
                      <option value={2}>2 Cycles (4 actions)</option>
                      <option value={3}>3 Cycles (6 actions)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4 pt-2">
                  {Array.from({ length: newTargetCycles }).map((_, cycleIndex) => (
                    <div key={cycleIndex} className="dash-recessed p-5">
                      <h4 className="text-sm font-bold text-primary mb-3 uppercase tracking-wider">Cycle {cycleIndex + 1} Comments</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <TextArea
                          label="Comment 1"
                          value={newComments[cycleIndex * 2] || ''}
                          onChange={e => {
                             const arr = [...newComments];
                             arr[cycleIndex*2] = e.target.value;
                             setNewComments(arr);
                          }}
                          placeholder="Your exact comment here..."
                          rows={2}
                        />
                        <TextArea
                          label="Comment 2"
                          value={newComments[cycleIndex * 2 + 1] || ''}
                          onChange={e => {
                             const arr = [...newComments];
                             arr[cycleIndex*2+1] = e.target.value;
                             setNewComments(arr);
                          }}
                          placeholder="Your exact comment here..."
                          rows={2}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                   <Button onClick={addKeyword} leftIcon={<Plus className="w-4 h-4" />}>
                     Save Campaign
                   </Button>
                </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-secondary">
                      Keyword
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-secondary">
                      Target Reach
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-secondary">
                      Matches
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wide text-secondary text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {keywords.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-0">
                        <div className="p-8 md:p-12 text-center" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl dash-elevated flex items-center justify-center transform -rotate-6">
                            <Zap className="w-10 h-10" style={{ color: 'var(--section-campaigns)' }} />
                          </div>
                          <h4 className="text-2xl font-black text-primary mb-3 tracking-tight">Zero to Hero in 1-Click</h4>
                          <p className="text-base text-secondary max-w-lg mx-auto mb-10 leading-relaxed">
                            Don't know what to target? Load a curated Starter Pack. 
                            We'll instantly set up high-converting <strong className="text-apple-blue">keywords</strong> and AI-crafted <strong className="text-apple-blue">comments</strong> for you.
                          </p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                            <button 
                              onClick={() => loadStarterPack('marketing')}
                              disabled={isDeployingPack}
                              className={`group dash-recessed p-6 rounded-2xl text-left border-2 transition-premium ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-transparent' : 'border-transparent dash-glow-hover'}`}
                              style={isDeployingPack ? {} : { border: '2px solid transparent' }}
                              onMouseEnter={(e) => { if(!isDeployingPack) (e.currentTarget as HTMLElement).style.borderColor = 'var(--section-campaigns)'; }}
                              onMouseLeave={(e) => { if(!isDeployingPack) (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
                            >
                              <div className="flex justify-between items-start mb-4">
                                <Badge variant="primary">B2B Marketing</Badge>
                                {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                              </div>
                              <h5 className="text-lg font-extrabold text-primary mb-2 transition-colors"
                                  style={{ ...(isDeployingPack ? {} : { color: 'var(--text-primary)' }) }}>Growth & Marketing Pack</h5>
                              <p className="text-sm font-bold text-tertiary">+3 Keywords • +9 Comments</p>
                            </button>

                            {/* Pack 2 */}
                            <button 
                              onClick={() => loadStarterPack('tech')}
                              disabled={isDeployingPack}
                              className={`group dash-recessed p-6 rounded-2xl text-left border-2 transition-premium ${isDeployingPack ? 'opacity-50 cursor-not-allowed border-transparent' : 'border-transparent dash-glow-hover'}`}
                              style={isDeployingPack ? {} : { border: '2px solid transparent' }}
                              onMouseEnter={(e) => { if(!isDeployingPack) (e.currentTarget as HTMLElement).style.borderColor = 'var(--section-campaigns)'; }}
                              onMouseLeave={(e) => { if(!isDeployingPack) (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
                            >
                              <div className="flex justify-between items-start mb-4">
                                <Badge variant="secondary">Tech & SaaS</Badge>
                                {isDeployingPack && <span className="animate-spin text-xl">⏳</span>}
                              </div>
                              <h5 className="text-lg font-extrabold text-primary mb-2 transition-colors"
                                  style={{ ...(isDeployingPack ? {} : { color: 'var(--text-primary)' }) }}>Software Engineering Pack</h5>
                              <p className="text-sm font-bold text-tertiary">+3 Keywords • +9 Comments</p>
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                      ) : keywords.map((kw: any) => (
                    <tr key={kw.id} className="transition-colors"
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--dash-surface-hover)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <td className="px-6 py-4">
                        <span className="text-sm font-semibold text-primary">
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
                          className="text-tertiary hover:text-error p-2 rounded-lg transition-premium"
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


      case 'extension-connect':
        return (
          <div className="max-w-5xl mx-auto space-y-8">
            {/* Professional Setup Card */}
            <Card variant="dashboard" accent="extension" className="overflow-hidden shadow-2xl dash-card">
              <div className="p-8 md:p-12 border-b relative" style={{ background: 'var(--dash-surface-1)', borderColor: 'var(--dash-border)' }}>
                <div className="absolute top-0 right-0 p-12 opacity-[0.03] pointer-events-none">
                  <Shield className="w-48 h-48" style={{ color: 'var(--text-primary)' }} />
                </div>
                
                <div className="relative z-10">
                  <Badge variant="primary" className="mb-4 text-xs font-bold px-3 py-1 bg-apple-blue/10 text-apple-blue border-none dark:bg-apple-blue/20">Step-by-Step Guide</Badge>
                  <h3 className="text-4xl font-black mb-4 text-primary tracking-tight">Connect Nexora <span className="text-apple-blue">Pro</span></h3>
                  <p className="text-lg text-secondary max-w-2xl leading-relaxed">
                    Transform your browser into a high-powered LinkedIn automation hub. 
                    Simple, safe, and 100% automated.
                  </p>
                </div>
              </div>

              <div className="p-8 md:p-12 space-y-12" style={{ background: 'var(--dash-surface-2)' }}>
                {/* Credentials Section */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-bold text-tertiary uppercase tracking-widest mb-4">1. Your Connection Keys</h4>
                      <div className="space-y-4">
                        <div className="group">
                          <label className="block text-xs font-bold text-secondary mb-2 uppercase">Dashboard URL</label>
                          <div className="flex gap-2">
                            <input 
                              readOnly 
                              value={typeof window !== 'undefined' ? window.location.origin : ''} 
                              className="flex-1 px-4 py-3 dash-input font-mono font-bold outline-none"
                            />
                            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(window.location.origin)}>Copy</Button>
                          </div>
                        </div>
                        <div className="group">
                          <label className="block text-xs font-bold text-secondary mb-2 uppercase">Your Private API Key (User ID)</label>
                          <div className="flex gap-2">
                            <input 
                              readOnly 
                              value={settings.userId || 'Loading...'} 
                              className="flex-1 px-4 py-3 dash-input font-mono font-bold outline-none"
                            />
                            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(settings.userId)}>Copy</Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl p-8 dash-recessed flex flex-col justify-center">
                    <h4 className="text-xl font-bold text-primary mb-4 flex items-center gap-2">
                       <Sparkles className="w-6 h-6 text-apple-blue" /> Install Extension
                    </h4>
                    <p className="text-secondary mb-8 text-sm leading-relaxed font-medium">
                      Download the Nexora Industrial-Strength extension and load it into your Chrome browser to begin automated extraction.
                    </p>
                    <a href="/LinkedInExtension.zip" download className="w-full">
                      <Button variant="primary" size="lg" className="w-full shadow-xl shadow-apple-blue/20 py-6 text-lg">
                        Download Extension (.ZIP)
                      </Button>
                    </a>
                  </div>
                </div>

                   {/* Comprehensive Installation Masterclass */}
                <div className="pt-12 border-t border-border-subtle">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-12">
                    <div>
                      <h4 className="text-sm font-bold text-tertiary uppercase tracking-widest mb-2">2. Visual Setup Masterclass</h4>
                      <h3 className="text-3xl font-black text-primary">Step-by-Step Implementation</h3>
                    </div>
                    <p className="text-sm text-secondary font-medium max-w-xs md:text-right">
                      Follow these 4 steps to activate your industrial-scale automation.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    {/* Step 1 */}
                    <div className="dash-recessed overflow-hidden transition-all shadow-sm group hover-lift border border-border-subtle hover:border-section-extension">
                      <div className="aspect-video relative overflow-hidden" style={{ background: 'var(--dash-surface-1)' }}>
                        <img src="/img/step1.png" alt="Extracting ZIP" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 rounded-full flex items-center justify-center font-black text-lg w-10 h-10" style={{ background: 'var(--text-primary)', color: 'var(--dash-bg)' }}>01</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-primary mb-2">فك الضغط عن الملف (Extract ZIP)</h5>
                        <p className="text-sm text-secondary leading-relaxed font-medium">
                          بعد تحميل الملف، قم بالضغط عليه بزر الفأرة الأيمن واختر <strong>Extract All</strong>. تأكد من فكه في مجلد واضح على سطح المكتب.
                          <br /><span className="text-xs text-tertiary mt-2 block italic">Right-click the ZIP and extract it to your desktop.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="dash-recessed overflow-hidden transition-all shadow-sm group hover-lift border border-border-subtle hover:border-section-extension">
                      <div className="aspect-video relative overflow-hidden" style={{ background: 'var(--dash-surface-1)' }}>
                        <img src="/img/step2.png" alt="Developer Mode" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 rounded-full flex items-center justify-center font-black text-lg w-10 h-10" style={{ background: 'var(--text-primary)', color: 'var(--dash-bg)' }}>02</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-primary mb-2">تفعيل وضع المطور (Developer Mode)</h5>
                        <p className="text-sm text-secondary leading-relaxed font-medium">
                          اذهب إلى <strong>chrome://extensions</strong> في متصفحك. قم بتفعيل زر <strong>Developer Mode</strong> الموجود في أعلى يمين الصفحة.
                          <br /><span className="text-xs text-tertiary mt-2 block italic">Go to extensions settings and toggle the Developer Mode switch ON.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="dash-recessed overflow-hidden transition-all shadow-sm group hover-lift border border-border-subtle hover:border-section-extension">
                      <div className="aspect-video relative overflow-hidden" style={{ background: 'var(--dash-surface-1)' }}>
                        <img src="/img/step3.png" alt="Load Unpacked" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 rounded-full flex items-center justify-center font-black text-lg w-10 h-10" style={{ background: 'var(--text-primary)', color: 'var(--dash-bg)' }}>03</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-primary mb-2">تحميل الإضافة (Load Unpacked)</h5>
                        <p className="text-sm text-secondary leading-relaxed font-medium">
                          اضغط على زر <strong>Load Unpacked</strong> واختر المجلد الذي قمت بفك ضغطه في الخطوة الأولى. ستظهر لك إضافة Nexora فوراً.
                          <br /><span className="text-xs text-tertiary mt-2 block italic">Click "Load Unpacked" and select the extracted folder.</span>
                        </p>
                      </div>
                    </div>

                    {/* Step 4 */}
                    <div className="dash-recessed overflow-hidden transition-all shadow-sm group hover-lift border-2" style={{ borderColor: 'var(--section-extension)' }}>
                      <div className="aspect-video bg-apple-blue/10 relative overflow-hidden">
                        <img src="/img/step4.png" alt="Sync and Run" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute top-4 left-4 bg-apple-blue text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-lg">04</div>
                      </div>
                      <div className="p-8">
                        <h5 className="text-xl font-black text-primary mb-2">المزامنة والتشغيل (Sync & Run)</h5>
                        <div className="space-y-3">
                          <p className="text-sm text-secondary leading-relaxed font-bold">
                            افتح الإضافة، الصق مفاتيح الربط (Keys) المذكورة أعلاه، واضغط على <strong>Sync & Run Now</strong>.
                          </p>
                          <div className={`px-4 py-2 rounded-xl text-[10px] font-black inline-flex items-center gap-2 ${systemActive ? 'bg-success/20 text-success' : 'bg-surface-elevated text-tertiary border border-subtle'}`}>
                             <div className={`w-2 h-2 rounded-full ${systemActive ? 'bg-success animate-pulse' : 'bg-tertiary'}`} />
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
          <Card variant="dashboard" accent="campaigns">
            <div className="p-6 md:p-8 flex flex-col gap-4" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-tile-heading text-primary flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-apple-blue" />
                    AI Auto-Posts
                  </h3>
                  <p className="text-caption text-secondary mt-1">
                    Generate thought leadership content on autopilot using Gemini
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-end gap-3">
                  <Input
                    label="Topic or Idea"
                    type="text"
                    value={newTopic}
                    onChange={e => setNewTopic(e.target.value)}
                    placeholder="E.g. The future of SaaS pricing..."
                    className="flex-1 min-w-[300px]"
                  />
                  <Button
                    onClick={generateAutoPost}
                    variant="secondary"
                  >
                    <Bot className="w-4 h-4 mr-2" /> Generate Post
                  </Button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                  <tr>
                    <th className="px-6 py-4 text-micro-bold uppercase text-secondary">Topic</th>
                    <th className="px-6 py-4 text-micro-bold uppercase text-secondary">Status</th>
                    <th className="px-6 py-4 text-micro-bold uppercase text-secondary">Content Preview</th>
                    <th className="px-6 py-4 text-micro-bold uppercase text-secondary text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(255,255,255,0.05)]">
                  {autoPosts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-secondary">
                        <Bot className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--section-campaigns)' }} />
                        <p className="text-caption-bold text-primary mb-1">No posts generated yet</p>
                        <p className="text-micro">Enter a topic above to let AI create your first post</p>
                      </td>
                    </tr>
                  ) : autoPosts.map((post) => (
                    <tr key={post.id} className="transition-colors" onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--dash-surface-hover)'; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <td className="px-6 py-4 max-w-[200px]">
                        <span className="text-caption-bold text-primary line-clamp-2">{post.topic}</span>
                      </td>
                      <td className="px-6 py-4">
                         <Badge variant={post.status === 'Published' ? 'success' : 'neutral'} size="sm">{post.status}</Badge>
                      </td>
                      <td className="px-6 py-4 max-w-md">
                        <p className="text-caption text-secondary line-clamp-2 italic">"{post.content}"</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => deleteAutoPost(post.id)}
                          className="text-tertiary hover:text-error p-2 rounded-lg transition-all"
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
          <div className="max-w-4xl mx-auto space-y-6">

            {/* Page Header */}
            <div>
              <h2 className="text-tile-heading text-primary flex items-center gap-2">
                <Settings className="w-5 h-5 text-apple-blue" />
                Agent Configuration
              </h2>
              <p className="text-caption text-secondary mt-1">Fine-tune your autopilot&apos;s parameters and safety thresholds</p>
            </div>

            <form onSubmit={saveSettings} className="space-y-6">

              {/* Section 1: Mode Selection & Search Config */}
              <Card variant="dashboard" accent="settings" className="overflow-hidden">
                <div className="px-6 py-4" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                  <h3 className="text-micro-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Search size={14} style={{ color: 'var(--section-settings)' }} /> Operating Mode
                  </h3>
                </div>
                <div className="p-6">
                  <label className="flex items-start gap-4 cursor-pointer group">
                    <input
                      type="checkbox"
                      name="searchOnlyMode"
                      checked={isSearchOnly}
                      onChange={async (e) => {
                        const val = e.target.checked;
                        setIsSearchOnly(val);
                        // Instant persist to prevent background worker desynchronization
                        await fetch('/api/settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ searchOnlyMode: val })
                        });
                      }}
                      className="w-5 h-5 mt-0.5 rounded border-2 border-border-default bg-surface-elevated text-apple-blue focus:ring-1 focus:ring-apple-blue focus:ring-offset-0 transition-all cursor-pointer"
                    />
                    <div>
                      <span className="text-caption-bold text-primary group-hover:text-apple-blue transition-colors">Search-Only Mode (Recommended)</span>
                      <p className="text-micro text-secondary mt-1">Search and save posts WITHOUT auto-commenting. Safer and avoids CAPTCHA triggers.</p>
                    </div>
                  </label>
                  
                  {isSearchOnly && (
                    <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--dash-border)' }}>
                      <div className="flex justify-between items-end mb-4">
                        <div>
                          <h4 className="text-caption-bold text-primary flex items-center gap-2">
                            <Shield className="w-4 h-4 text-apple-blue" />
                            Search Cycles & Keywords
                          </h4>
                          <p className="text-micro text-secondary mt-1">Configure your discovery loops. We recommend 2 cycles to maximize daily safety limits.</p>
                        </div>
                        <div className="flex gap-3 items-center">
                          <Button 
                            type="button" 
                            variant="secondary" 
                            size="sm"
                            onClick={() => {
                              setSearchTargetCycles(2);
                              setSearchConfig([['saas', 'sales'], ['b2b', 'startups']]);
                            }}
                          >
                            Apply Safe Defaults
                          </Button>
                          <div className="flex items-center gap-2">
                            <label className="text-micro-bold text-secondary uppercase">Cycles</label>
                            <select
                              value={searchTargetCycles}
                              onChange={(e) => {
                                const val = parseInt(e.target.value);
                                setSearchTargetCycles(val);
                                setSearchConfig(prev => {
                                  let newArr = [...prev];
                                  if (val > newArr.length) {
                                    while (newArr.length < val) newArr.push(['', '']);
                                  } else {
                                    newArr = newArr.slice(0, val);
                                  }
                                  return newArr;
                                });
                              }}
                              className="px-3 py-1.5 dash-input outline-none rounded-md w-24"
                            >
                              <option value={1}>1 Cycle</option>
                              <option value={2}>2 Cycles</option>
                              <option value={3}>3 Cycles</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Timing Transparency Panel */}
                      <div className="bg-surface-elevated border border-border-subtle rounded-lg p-4 mb-6 flex gap-6 text-sm text-secondary">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">⏱️</span> 
                          <span><strong>3-5 mins</strong> between keywords</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">💤</span> 
                          <span><strong>15 mins</strong> between cycles</span>
                        </div>
                      </div>

                      {/* Keyword Blocks */}
                      <div className="space-y-6">
                        {Array.from({ length: searchTargetCycles }).map((_, cycleIndex) => {
                          const cycleKeywords = searchConfig[cycleIndex] || [''];
                          const maxKeywords = 3;
                          return (
                            <div key={`search-cycle-${cycleIndex}`} className="dash-recessed p-5 rounded-2xl border-2 border-border-default hover:border-apple-blue/50 transition-colors">
                              <div className="flex justify-between items-center mb-4">
                                <div className="flex items-center gap-3">
                                  <h4 className="text-base font-black text-primary uppercase tracking-widest flex items-center gap-2">
                                    <span className="bg-apple-blue/20 text-apple-blue w-6 h-6 rounded-full flex items-center justify-center text-xs">
                                      {cycleIndex + 1}
                                    </span>
                                    Cycle {cycleIndex + 1}
                                  </h4>
                                  <Badge variant={cycleKeywords.length >= maxKeywords ? "error" : "success"} size="sm">
                                    {cycleKeywords.length} / {maxKeywords} Keywords
                                  </Badge>
                                </div>
                                <Button 
                                  type="button" 
                                  variant="secondary" 
                                  size="sm" 
                                  disabled={cycleKeywords.length >= maxKeywords}
                                  onClick={() => {
                                    if (cycleKeywords.length >= maxKeywords) return;
                                    const newConfig = [...searchConfig];
                                    newConfig[cycleIndex] = [...cycleKeywords, ''];
                                    setSearchConfig(newConfig);
                                  }}
                                  leftIcon={<Plus className="w-3 h-3" />}
                                >
                                  Add Keyword
                                </Button>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {cycleKeywords.map((kw, kwIndex) => (
                                  <div key={`cycle-${cycleIndex}-kw-${kwIndex}`} className="flex items-center gap-2 relative bg-surface-elevated rounded-lg p-1 border border-border-default/50 focus-within:border-apple-blue">
                                    <span className="text-xs font-bold text-secondary pl-3 uppercase tracking-wider">
                                       KW {kwIndex + 1}:
                                    </span>
                                    <input 
                                      value={kw}
                                      onChange={(e) => {
                                        const newConfig = [...searchConfig];
                                        const newCyc = [...newConfig[cycleIndex]];
                                        newCyc[kwIndex] = e.target.value;
                                        newConfig[cycleIndex] = newCyc;
                                        setSearchConfig(newConfig);
                                      }}
                                      placeholder="e.g. b2b outbound"
                                      className="flex-1 px-3 py-2 bg-transparent text-sm text-primary outline-none" 
                                    />
                                    {cycleKeywords.length > 1 && (
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          const newConfig = [...searchConfig];
                                          const newCyc = [...newConfig[cycleIndex]];
                                          newCyc.splice(kwIndex, 1);
                                          newConfig[cycleIndex] = newCyc;
                                          setSearchConfig(newConfig);
                                        }}
                                        className="text-tertiary hover:text-error transition-colors p-2 rounded-md hover:bg-error/10 mr-1"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Dedicated Save Flow Button */}
                      <div className="mt-8 pt-6 flex justify-end" style={{ borderTop: '1px solid var(--dash-border)' }}>
                        <Button 
                          type="button"
                          onClick={async () => {
                            const validSearchConfig = searchConfig.map(arr => arr.filter(k => k.trim().length > 0));
                            if (validSearchConfig.some(arr => arr.length === 0)) {
                              alert("Validation Error: All search cycles must have at least 1 keyword populated.");
                              return;
                            }
                            await fetch('/api/settings', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ 
                                searchConfigJson: JSON.stringify(validSearchConfig),
                                searchOnlyMode: isSearchOnly
                              })
                            });
                            alert('✅ Search Configuration correctly bound to cycles and saved!');
                            fetchData();
                          }}
                          leftIcon={<Shield className="w-4 h-4" />}
                        >
                          Save Search Configuration
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Section 2: Search Limits */}
              <Card variant="dashboard" accent="settings" className="overflow-hidden">
                <div className="px-6 py-4" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                  <h3 className="text-micro-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Shield size={14} style={{ color: 'var(--section-settings)' }} /> Search Limits
                  </h3>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Searches / Hour</label>
                      <input type="number" name="maxSearchesPerHour" defaultValue={settings.maxSearchesPerHour ?? 6} min="1" max="12"
                        className="w-full px-3 py-2.5 dash-input outline-none" />
                    </div>
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Searches / Day</label>
                      <input type="number" name="maxSearchesPerDay" defaultValue={settings.maxSearchesPerDay ?? 20} min="1" max="60"
                        className="w-full px-3 py-2.5 dash-input outline-none" />
                    </div>
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Min Delay (min)</label>
                      <input type="number" name="minDelayBetweenSearchesMinutes" defaultValue={settings.minDelayBetweenSearchesMinutes ?? 5} min="1" max="30"
                        className="w-full px-3 py-2.5 dash-input outline-none" />
                    </div>
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Keywords / Cycle</label>
                      <input type="number" name="maxKeywordsPerCycle" defaultValue={settings.maxKeywordsPerCycle ?? 3} min="1" max="10"
                        className="w-full px-3 py-2.5 dash-input outline-none" />
                    </div>
                  </div>

                  {/* Schedule Controls */}
                  <div className="pt-5 space-y-4" style={{ borderTop: '1px solid var(--dash-border)' }}>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" name="workHoursOnly" defaultChecked={settings.workHoursOnly ?? true}
                          className="w-4 h-4 rounded border-2 border-border-default bg-surface-elevated text-success focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                        <span className="text-caption text-primary">Work hours only</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" name="skipWeekends" defaultChecked={settings.skipWeekends ?? true}
                          className="w-4 h-4 rounded border-2 border-border-default bg-surface-elevated text-success focus:ring-0 focus:ring-offset-0 cursor-pointer" />
                        <span className="text-caption text-primary">Skip weekends</span>
                      </label>
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <label className="block text-micro-bold text-secondary mb-1">Start hour</label>
                        <input type="number" name="workHoursStart" defaultValue={settings.workHoursStart ?? 9} min="0" max="23"
                          className="w-20 px-3 py-2 dash-input outline-none" />
                      </div>
                      <span className="text-tertiary mt-4">&rarr;</span>
                      <div>
                        <label className="block text-micro-bold text-secondary mb-1">End hour</label>
                        <input type="number" name="workHoursEnd" defaultValue={settings.workHoursEnd ?? 18} min="0" max="23"
                          className="w-20 px-3 py-2 dash-input outline-none" />
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Section 3: Targeting + Delays (side-by-side on desktop) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Targeting Criteria */}
                <Card variant="dashboard" accent="settings" className="overflow-hidden">
                  <div className="px-6 py-4" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                    <h3 className="text-micro-bold text-primary uppercase tracking-widest flex items-center gap-2">
                      <Search size={14} style={{ color: 'var(--section-settings)' }} /> Targeting Criteria
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Min Likes</label>
                        <input type="number" name="minLikes" defaultValue={settings.minLikes ?? 10}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Max Likes</label>
                        <input type="number" name="maxLikes" defaultValue={settings.maxLikes ?? 10000}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Min Comments</label>
                        <input type="number" name="minComments" defaultValue={settings.minComments ?? 2}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Max Comments</label>
                        <input type="number" name="maxComments" defaultValue={settings.maxComments ?? 1000}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Safety Delays */}
                <Card variant="dashboard" accent="settings" className="overflow-hidden">
                  <div className="px-6 py-4" style={{ background: 'var(--dash-surface-2)', borderBottom: '1px solid var(--dash-border)' }}>
                    <h3 className="text-micro-bold text-primary uppercase tracking-widest flex items-center gap-2">
                      <Bot size={14} style={{ color: 'var(--section-settings)' }} /> Safety Delays
                    </h3>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Min Delay (Mins)</label>
                        <input type="number" name="minDelayMins" defaultValue={settings.minDelayMins ?? 15}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                      <div>
                        <label className="block text-micro-bold text-secondary uppercase mb-1.5">Max Delay (Mins)</label>
                        <input type="number" name="maxDelayMins" defaultValue={settings.maxDelayMins ?? 45}
                          className="w-full px-3 py-2.5 dash-input outline-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Max Comments / Day</label>
                      <input type="number" name="maxCommentsPerDay" defaultValue={settings.maxCommentsPerDay ?? 20}
                        className="w-full px-3 py-2.5 dash-input outline-none" />
                    </div>
                    <p className="text-micro text-tertiary">Randomized delays emulate human behavior.</p>
                  </div>
                </Card>
              </div>

              {/* Section 4: Connection Profile */}
              <Card className="overflow-hidden bg-surface border border-border-subtle">
                <div className="px-6 py-4 border-b border-border-subtle bg-surface-hover">
                  <h3 className="text-micro-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Shield size={14} className="text-apple-blue" /> Connection Profile
                  </h3>
                </div>
                <div className="p-6 space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">LinkedIn Session (li_at)</label>
                      <input
                        type="text"
                        name="linkedinSessionCookie"
                        defaultValue={settings.linkedinSessionCookie || ''}
                        placeholder="Paste your li_at cookie"
                        className="w-full px-3 py-2.5 bg-surface-elevated border border-border-subtle rounded-md text-sm font-mono text-primary outline-none focus:border-apple-blue"
                      />
                    </div>
                    <div>
                      <label className="block text-micro-bold text-secondary uppercase mb-1.5">Max Profile Views / Day</label>
                      <input type="number" name="maxProfileViewsPerDay" defaultValue={settings.maxProfileViewsPerDay ?? 100}
                        className="w-full px-3 py-2.5 bg-surface-elevated border border-border-subtle rounded-md text-sm text-primary outline-none focus:border-apple-blue" />
                    </div>
                  </div>
                  <p className="text-micro text-tertiary">Session cookie is used for server-side auth. Do not share.</p>
                </div>
              </Card>

              {/* Submit */}
              <div className="flex justify-end">
                <Button type="submit" variant="primary">
                  Save Settings
                </Button>
              </div>
            </form>
          </div>
        );

      case 'extension-connect':
        return (
          <div className="space-y-6">
            <Card className="bg-surface border border-border-subtle">
              <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-surface-hover rounded-lg flex items-center justify-center">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-tile-heading text-primary">Connect Extension</h3>
                    <p className="text-caption text-secondary">Link your Chrome extension</p>
                  </div>
                </div>

                <div className="bg-surface-elevated border border-border-subtle rounded-lg p-5 mb-4">
                  <h4 className="text-caption-bold text-primary mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 bg-surface-elevated text-primary rounded-full flex items-center justify-center text-micro-bold">1</span>
                    Install Extension
                  </h4>
                  <p className="text-micro text-secondary mb-3">Download and install the Chrome extension.</p>
                  <a href="/LinkedInExtension.zip" download className="inline-flex items-center gap-2 px-3 py-2 bg-surface-hover hover:bg-surface-elevated text-primary rounded-md text-micro-bold transition-all">
                    Download Extension ZIP
                  </a>
                </div>

                <div className="bg-apple-blue/8 border border-apple-blue/16 rounded-lg p-5 mb-4">
                  <h4 className="text-caption-bold text-apple-blue mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 bg-apple-blue text-primary rounded-full flex items-center justify-center text-micro-bold">2</span>
                    One-Click Connect
                  </h4>
                  <p className="text-micro text-secondary mb-3">Open the extension popup while on this page, then click Auto-Connect.</p>
                  <div className="bg-surface rounded-lg p-3 border border-border-subtle">
                    <p className="text-[10px] font-bold text-tertiary uppercase mb-1">Your Connection Code</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface-hover text-micro font-mono text-primary p-2 rounded-md">{settings.userId || 'Loading...'}</code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(settings.userId || '');
                          const btn = document.getElementById('copy-uid-btn');
                          if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Code'; }, 2000); }
                        }}
                        id="copy-uid-btn"
                        className="px-3 py-2 bg-surface-hover hover:bg-surface-elevated rounded-md text-micro-bold text-primary transition-all"
                      >
                        Copy Code
                      </button>
                    </div>
                  </div>
                </div>

                <div className="bg-success/8 border border-success/16 rounded-lg p-5">
                  <h4 className="text-caption-bold text-success mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 bg-success text-primary rounded-full flex items-center justify-center text-micro-bold">3</span>
                    Activate
                  </h4>
                  <p className="text-micro text-secondary">Once connected, click START on the Dashboard to begin automated engagement!</p>
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
    <div className="dashboard-scope flex h-screen">
      <div id="nexora-connect-data" data-user-id={settings.userId || ''} data-dashboard-url={typeof window !== 'undefined' ? window.location.origin : ''} style={{ display: 'none' }} />
      <OnboardingWizard isOpen={showWizard} onClose={() => setShowWizard(false)} loadStarterPack={loadStarterPack} isDeployingPack={isDeployingPack} />

      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} systemActive={systemActive} />

      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--dash-bg)' }}>
        <Header title={activeTab} sessionConnected={true} />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 relative scrollbar-thin">
          <div className="max-w-[1400px] mx-auto pb-20">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, scale: 0.985, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.985, y: -6 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                {renderContent()}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}


