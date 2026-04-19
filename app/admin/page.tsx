'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useRouter } from 'next/navigation';
import {
  Users, Key, Shield, ArrowLeft, Trash2, UserCheck, UserX,
  Clock, Plus, Copy, RefreshCw, Crown, MessageSquare
} from 'lucide-react';

type User = {
  id: string;
  email: string;
  isAdmin: boolean;
  linkedInProfileId: string | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  createdAt: string;
  _count: { savedPosts: number; logs: number; keywords: number; comments: number };
};

type PromoCode = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number;
  currentUses: number;
  expiresAt: string | null;
  createdAt: string;
};

export default function AdminDashboard() {
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<'users' | 'promos' | 'messages'>('users');
  const [users, setUsers] = useState<User[]>([]);
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Promo creation
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoMaxUses, setNewPromoMaxUses] = useState(1);
  const [newPromoExpiry, setNewPromoExpiry] = useState('');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchData = async () => {
    try {
      const [usersRes, promosRes, msgsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/promos'),
        fetch('/api/admin/messages')
      ]);
      if (usersRes.status === 403) {
        router.push('/dashboard');
        return;
      }
      if (usersRes.ok) setUsers(await usersRes.json());
      if (promosRes.ok) setPromos(await promosRes.json());
      if (msgsRes.ok) setMessages(await msgsRes.json());
    } catch (e) {
      showToast('Failed to load data', 'error');
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const userAction = async (userId: string, action: string, value?: any) => {
    setActionLoading(userId + action);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, value })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message);
        fetchData();
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast('Action failed', 'error'); }
    setActionLoading(null);
  };

  const createPromo = async () => {
    if (!newPromoCode.trim()) return;
    setActionLoading('create-promo');
    try {
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'CREATE',
          code: newPromoCode,
          maxUses: newPromoMaxUses,
          expiresAt: newPromoExpiry || null
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Promo code created!');
        setNewPromoCode('');
        setNewPromoMaxUses(1);
        setNewPromoExpiry('');
        fetchData();
      } else {
        showToast(data.error, 'error');
      }
    } catch (e) { showToast('Failed to create promo', 'error'); }
    setActionLoading(null);
  };

  const deletePromo = async (promoId: string) => {
    setActionLoading('del-' + promoId);
    try {
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'DELETE', promoId })
      });
      if (res.ok) { showToast('Deleted'); fetchData(); }
    } catch (e) {}
    setActionLoading(null);
  };

  const deleteMessage = async (msgId: string) => {
    if (!confirm('Delete this message?')) return;
    try {
      const res = await fetch(`/api/admin/messages?id=${msgId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Message deleted');
        fetchData();
      }
    } catch (e) {}
  };

  const statusColor = (s: string) => {
    if (s === 'ACTIVE') return '#30d158';
    if (s === 'TRIAL') return '#ff9f0a';
    return '#ff3b30';
  };

  const formatDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const daysLeft = (d: string | null) => {
    if (!d) return null;
    const diff = new Date(d).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
        <div style={{ width: 40, height: 40, border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #0a84ff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f5f5f7', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ y: -40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -40, opacity: 0 }}
            style={{
              position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 9999,
              padding: '12px 24px', borderRadius: 12,
              background: toast.type === 'success' ? 'rgba(48,209,88,0.15)' : 'rgba(255,59,48,0.15)',
              border: `1px solid ${toast.type === 'success' ? 'rgba(48,209,88,0.3)' : 'rgba(255,59,48,0.3)'}`,
              color: toast.type === 'success' ? '#30d158' : '#ff3b30',
              fontSize: 14, fontWeight: 500, backdropFilter: 'blur(20px)'
            }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div style={{
        padding: '16px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 16, background: 'rgba(255,255,255,0.02)'
      }}>
        <button onClick={() => router.push('/dashboard')} style={{
          background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 10, padding: '8px 12px',
          color: '#f5f5f7', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13
        }}>
          <ArrowLeft size={16} /> Dashboard
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #ff6b35, #5e5ce6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Crown size={18} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Admin Control Panel</h1>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: 0 }}>{users.length} users registered</p>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setActiveSection('users')} style={{
            padding: '8px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: activeSection === 'users' ? 'rgba(10,132,255,0.15)' : 'rgba(255,255,255,0.06)',
            color: activeSection === 'users' ? '#0a84ff' : 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Users size={15} /> Users
          </button>
          <button onClick={() => setActiveSection('promos')} style={{
            padding: '8px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: activeSection === 'promos' ? 'rgba(10,132,255,0.15)' : 'rgba(255,255,255,0.06)',
            color: activeSection === 'promos' ? '#0a84ff' : 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Key size={15} /> Promo Codes
          </button>
          <button onClick={() => setActiveSection('messages')} style={{
            padding: '8px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: activeSection === 'messages' ? 'rgba(10,132,255,0.15)' : 'rgba(255,255,255,0.06)',
            color: activeSection === 'messages' ? '#0a84ff' : 'rgba(255,255,255,0.6)',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <MessageSquare size={15} /> Messages
            {messages.length > 0 && (
              <span style={{ background: '#ff3b30', color: '#fff', fontSize: 10, padding: '2px 6px', borderRadius: 10 }}>{messages.length}</span>
            )}
          </button>
          <button onClick={fetchData} style={{
            padding: '8px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)'
          }}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
        <AnimatePresence mode="wait">
          {activeSection === 'users' ? (
            <motion.div key="users" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* Stats Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                {[
                  { label: 'Total Users', value: users.length, color: '#0a84ff' },
                  { label: 'Active', value: users.filter(u => u.subscriptionStatus === 'ACTIVE').length, color: '#30d158' },
                  { label: 'Trial', value: users.filter(u => u.subscriptionStatus === 'TRIAL').length, color: '#ff9f0a' },
                  { label: 'Expired', value: users.filter(u => u.subscriptionStatus === 'EXPIRED').length, color: '#ff3b30' },
                ].map((s, i) => (
                  <div key={i} style={{
                    background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: '20px 24px',
                    border: '1px solid rgba(255,255,255,0.06)'
                  }}>
                    <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '0 0 8px' }}>{s.label}</p>
                    <p style={{ fontSize: 28, fontWeight: 700, color: s.color, margin: 0 }}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Users Table */}
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden'
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 180px',
                  padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1
                }}>
                  <span>User</span>
                  <span>Status</span>
                  <span>LinkedIn ID</span>
                  <span>Expires</span>
                  <span>Activity</span>
                  <span style={{ textAlign: 'right' }}>Actions</span>
                </div>
                {users.map(u => (
                  <div key={u.id} style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 180px',
                    padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    alignItems: 'center', fontSize: 13, transition: 'background 0.15s',
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{u.email}</span>
                        {u.isAdmin && (
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 6,
                            background: 'rgba(94,92,230,0.2)', color: '#5e5ce6', fontWeight: 700
                          }}>ADMIN</span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                        Joined {formatDate(u.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: `${statusColor(u.subscriptionStatus)}15`,
                        color: statusColor(u.subscriptionStatus)
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor(u.subscriptionStatus) }} />
                        {u.subscriptionStatus}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: u.linkedInProfileId ? '#f5f5f7' : 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                      {u.linkedInProfileId || '—'}
                    </div>
                    <div style={{ fontSize: 12 }}>
                      {u.subscriptionStatus === 'TRIAL' && u.trialEndsAt ? (
                        <span style={{ color: (daysLeft(u.trialEndsAt) || 0) <= 5 ? '#ff3b30' : '#ff9f0a' }}>
                          {daysLeft(u.trialEndsAt)}d left
                        </span>
                      ) : u.subscriptionStatus === 'ACTIVE' && u.subscriptionEndsAt ? (
                        <span style={{ color: '#30d158' }}>{formatDate(u.subscriptionEndsAt)}</span>
                      ) : (
                        <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                      {u._count.savedPosts} posts · {u._count.logs} logs
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {u.subscriptionStatus !== 'ACTIVE' && !u.isAdmin && (
                        <button onClick={() => userAction(u.id, 'ACTIVATE')}
                          disabled={actionLoading === u.id + 'ACTIVATE'}
                          title="Activate (1 year)"
                          style={{
                            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            background: 'rgba(48,209,88,0.12)', color: '#30d158'
                          }}>
                          <UserCheck size={13} />
                        </button>
                      )}
                      {u.subscriptionStatus === 'ACTIVE' && !u.isAdmin && (
                        <button onClick={() => userAction(u.id, 'DEACTIVATE')}
                          disabled={actionLoading === u.id + 'DEACTIVATE'}
                          title="Deactivate"
                          style={{
                            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            background: 'rgba(255,59,48,0.12)', color: '#ff3b30'
                          }}>
                          <UserX size={13} />
                        </button>
                      )}
                      {!u.isAdmin && (
                        <button onClick={() => userAction(u.id, 'EXTEND_TRIAL', 30)}
                          disabled={actionLoading === u.id + 'EXTEND_TRIAL'}
                          title="Extend trial +30 days"
                          style={{
                            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            background: 'rgba(255,159,10,0.12)', color: '#ff9f0a'
                          }}>
                          <Clock size={13} />
                        </button>
                      )}
                      {!u.isAdmin && (
                        <button onClick={() => { if (confirm(`Delete ${u.email}? This cannot be undone.`)) userAction(u.id, 'DELETE'); }}
                          title="Delete user"
                          style={{
                            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
                            background: 'rgba(255,59,48,0.08)', color: '#ff3b30'
                          }}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {users.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                    No users found
                  </div>
                )}
              </div>
            </motion.div>
          ) : activeSection === 'promos' ? (
            <motion.div key="promos" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              {/* Create Promo Card */}
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 16, padding: 24, marginBottom: 24,
                border: '1px solid rgba(255,255,255,0.06)'
              }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Plus size={18} /> Create New Activation Code
                </h3>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, fontWeight: 600 }}>CODE</label>
                    <input
                      value={newPromoCode}
                      onChange={e => setNewPromoCode(e.target.value.toUpperCase())}
                      placeholder="e.g. NEXORA2025"
                      style={{
                        padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: '#f5f5f7', fontSize: 14,
                        fontFamily: 'monospace', letterSpacing: 2, width: 240, outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, fontWeight: 600 }}>MAX USES</label>
                    <input
                      type="number" min={1} value={newPromoMaxUses}
                      onChange={e => setNewPromoMaxUses(Number(e.target.value))}
                      style={{
                        padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: '#f5f5f7', fontSize: 14, width: 100, outline: 'none'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 6, fontWeight: 600 }}>EXPIRES (optional)</label>
                    <input
                      type="date" value={newPromoExpiry}
                      onChange={e => setNewPromoExpiry(e.target.value)}
                      style={{
                        padding: '10px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: '#f5f5f7', fontSize: 14, width: 180, outline: 'none'
                      }}
                    />
                  </div>
                  <button
                    onClick={createPromo}
                    disabled={actionLoading === 'create-promo' || !newPromoCode.trim()}
                    style={{
                      padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg, #0a84ff, #5e5ce6)', color: '#fff',
                      fontSize: 14, fontWeight: 600, opacity: actionLoading === 'create-promo' || !newPromoCode.trim() ? 0.5 : 1
                    }}
                  >
                    {actionLoading === 'create-promo' ? '...' : 'Create Code'}
                  </button>
                </div>
              </div>

              {/* Promos List */}
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden'
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px',
                  padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1
                }}>
                  <span>Code</span>
                  <span>Uses</span>
                  <span>Expires</span>
                  <span>Created</span>
                  <span style={{ textAlign: 'right' }}>Actions</span>
                </div>
                {promos.map(p => (
                  <div key={p.id} style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px',
                    padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    alignItems: 'center', fontSize: 13
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: 2, color: '#0a84ff' }}>{p.code}</span>
                      <button onClick={() => { navigator.clipboard.writeText(p.code); showToast('Copied!'); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: 4 }}>
                        <Copy size={12} />
                      </button>
                    </div>
                    <div>
                      <span style={{
                        color: p.currentUses >= p.maxUses ? '#ff3b30' : '#30d158'
                      }}>
                        {p.currentUses}/{p.maxUses}
                      </span>
                      {p.currentUses >= p.maxUses && (
                        <span style={{ fontSize: 10, color: '#ff3b30', marginLeft: 6 }}>EXHAUSTED</span>
                      )}
                    </div>
                    <div style={{ color: p.expiresAt ? (new Date(p.expiresAt) < new Date() ? '#ff3b30' : '#f5f5f7') : 'rgba(255,255,255,0.3)' }}>
                      {p.expiresAt ? formatDate(p.expiresAt) : 'Never'}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)' }}>{formatDate(p.createdAt)}</div>
                    <div style={{ textAlign: 'right' }}>
                      <button onClick={() => deletePromo(p.id)}
                        style={{
                          padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'rgba(255,59,48,0.1)', color: '#ff3b30', fontSize: 11
                        }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {promos.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                    No promo codes yet. Create one above.
                  </div>
                )}
              </div>
            </motion.div>
          ) : activeSection === 'messages' ? (
            <motion.div key="messages" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div style={{
                background: 'rgba(255,255,255,0.03)', borderRadius: 16,
                border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden'
              }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 2fr 3fr 150px 80px',
                  padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1
                }}>
                  <span>User</span>
                  <span>Subject</span>
                  <span>Message</span>
                  <span>Date</span>
                  <span style={{ textAlign: 'right' }}>Actions</span>
                </div>
                {messages.map(m => (
                  <div key={m.id} style={{
                    display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 2fr 3fr 150px 80px',
                    padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                    alignItems: 'start', fontSize: 13, gap: 12
                  }}>
                    <div style={{ color: '#0a84ff', fontWeight: 600 }}>{m.user?.email || 'Unknown'}</div>
                    <div style={{ fontWeight: 600, color: '#f5f5f7' }}>{m.subject}</div>
                    <div style={{ color: 'rgba(255,255,255,0.7)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.message}</div>
                    <div style={{ color: 'rgba(255,255,255,0.4)' }}>{new Date(m.createdAt).toLocaleString()}</div>
                    <div style={{ textAlign: 'right' }}>
                      <button onClick={() => deleteMessage(m.id)}
                        style={{
                          padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                          background: 'rgba(255,59,48,0.1)', color: '#ff3b30', fontSize: 11
                        }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
                    No support messages found.
                  </div>
                )}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
