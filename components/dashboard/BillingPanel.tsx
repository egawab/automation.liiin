'use client';

import React, { useState } from 'react';
import { CreditCard, Zap, Check, AlertCircle, Clock, Shield } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

interface BillingPanelProps {
  isAdmin: boolean;
  subscriptionStatus: string;
  trialDaysRemaining: number;
}

export default function BillingPanel({ isAdmin, subscriptionStatus, trialDaysRemaining }: BillingPanelProps) {
  const [activationCode, setActivationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

  const handleActivation = async () => {
    if (!activationCode.trim()) return;
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/billing/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: activationCode })
      });
      const data = await res.json();
      
      if (res.ok) {
        setMessage({ text: '✅ ' + data.message, type: 'success' });
        setTimeout(() => window.location.reload(), 2000); // Reload to reflect status
      } else {
        setMessage({ text: '❌ ' + data.error, type: 'error' });
      }
    } catch (e) {
      setMessage({ text: '❌ Failed to activate code. Please try again or contact support.', type: 'error' });
    }
    
    setLoading(false);
  };

  // Status computation
  let bgGradient = 'linear-gradient(135deg, #1c1c1e, #2c2c2e)';
  let title = 'Unknown Status';
  let desc = 'Cannot fetch your current status.';
  let icon = <AlertCircle size={28} className="text-secondary" />;

  if (isAdmin) {
    bgGradient = 'linear-gradient(135deg, rgba(10,132,255,0.1), rgba(94,92,230,0.1))';
    title = 'Admin Account';
    desc = 'You have unlimited access to all platform features permanently.';
    icon = <Shield size={28} style={{ color: '#0a84ff' }} />;
  } else if (subscriptionStatus === 'ACTIVE') {
    bgGradient = 'linear-gradient(135deg, rgba(48,209,88,0.1), rgba(52,199,89,0.1))';
    title = 'Active Subscription';
    desc = 'You are on a yearly subscription. Your AI agent is fully operational.';
    icon = <Check size={28} style={{ color: '#30d158' }} />;
  } else if (subscriptionStatus === 'TRIAL') {
    bgGradient = 'linear-gradient(135deg, rgba(255,159,10,0.1), rgba(255,214,10,0.1))';
    title = 'Free Trial';
    desc = `You have ${trialDaysRemaining} day${trialDaysRemaining !== 1 ? 's' : ''} remaining in your trial. All features are unlocked.`;
    icon = <Clock size={28} style={{ color: '#ff9f0a' }} />;
  } else if (subscriptionStatus === 'EXPIRED') {
    bgGradient = 'linear-gradient(135deg, rgba(255,59,48,0.1), rgba(255,107,53,0.1))';
    title = 'Expired';
    desc = 'Your access has expired. Please upgrade to continue using the platform.';
    icon = <AlertCircle size={28} style={{ color: '#ff3b30' }} />;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-section-heading text-primary mb-2">Billing & Plan</h2>
        <p className="text-body text-secondary">Manage your subscription, view your status, and activate codes.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Current Status Card */}
        <div style={{ background: bgGradient, border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '32px', position: 'relative', overflow: 'hidden' }}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-black/20 border border-white/5">
              {icon}
            </div>
            <div>
              <h3 className="text-xl font-bold text-white mb-1">{title}</h3>
              {subscriptionStatus === 'ACTIVE' && <Badge variant="success">Pro Plan</Badge>}
            </div>
          </div>
          <p className="text-[15px] font-medium text-white/80 leading-relaxed mb-6">
            {desc}
          </p>

          <div className="pt-6 border-t border-white/10">
            <h4 className="text-caption-bold text-white/90 mb-2">How to upgrade?</h4>
            <p className="text-[13px] text-white/60 mb-4">
              To purchase a yearly subscription and secure permanent access to your AI Agent without interruptions, please contact us directly.
            </p>
            <a href="mailto:sddeeoossa@gmail.com?subject=Nexora%20Account%20Activation"
              className="inline-block px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all font-semibold text-white text-[13px]">
              Contact: sddeeoossa@gmail.com
            </a>
          </div>
        </div>

        {/* Activation Card */}
        <Card variant="dashboard" className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-apple-blue/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-apple-blue" />
            </div>
            <h3 className="text-lg font-bold text-primary">Activate Code</h3>
          </div>
          
          <p className="text-[14px] text-secondary mb-6 leading-relaxed">
            If you already have purchased an activation code, enter it below to instantly unlock your account to the Pro Plan.
          </p>

          <div className="space-y-3">
            <label className="text-[11px] font-bold uppercase tracking-wider text-tertiary">
              Activation Code
            </label>
            <input
              type="text"
              value={activationCode}
              onChange={e => setActivationCode(e.target.value.toUpperCase())}
              placeholder="e.g. NEXORA2025"
              className="w-full px-4 py-3 rounded-xl bg-page border border-border-subtle focus:border-apple-blue focus:ring-1 focus:ring-apple-blue outline-none text-primary font-mono tracking-widest uppercase transition-all"
            />
            {message && (
              <p className={`text-[13px] font-medium mt-2 ${message.type === 'success' ? 'text-success' : 'text-error'}`}>
                {message.text}
              </p>
            )}
          </div>

          <div className="mt-6 pt-6 border-t border-border-subtle">
            <Button
              variant="primary"
              fullWidth
              onClick={handleActivation}
              disabled={loading || !activationCode.trim()}
              isLoading={loading}
              className="py-3"
            >
              {loading ? 'Activating...' : 'Redeem Code'}
            </Button>
          </div>
        </Card>
      </div>

      {/* Features Overview */}
      <div className="mt-12 bg-surface-hover border border-border-subtle rounded-2xl p-8">
        <h3 className="text-group-heading text-primary mb-6">Pro Plan Benefits</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {[
            { tag: 'Unlimited', desc: 'No daily interaction limits' },
            { tag: 'AI Engine', desc: 'Full access to auto-commenting tech' },
            { tag: 'Identity Lock', desc: 'Securely bound to your LinkedIn profile' },
            { tag: 'Dashboard', desc: 'Lifetime access to analytics metrics' },
            { tag: 'Priority', desc: 'Priority execution in the cloud queue' },
            { tag: 'Support', desc: 'Direct 24/7 technical support' },
          ].map((f, i) => (
            <div key={i} className="flex flex-col gap-2">
              <span className="text-[12px] font-bold text-apple-blue">{f.tag}</span>
              <span className="text-[14px] text-primary">{f.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
