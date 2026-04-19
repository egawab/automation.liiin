'use client';

import React, { useState } from 'react';
import { CreditCard, Zap, Check, AlertCircle, Clock, Shield, Star, Crown } from 'lucide-react';
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Current Status Card */}
          <div style={{ background: bgGradient, border: '1px solid rgba(255,255,255,0.06)', borderRadius: '24px', padding: '32px', position: 'relative', overflow: 'hidden' }}>
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center bg-black/20 border border-white/5">
                {icon}
              </div>
              <div>
                <h3 className="text-2xl font-bold text-white mb-1">{title}</h3>
                {subscriptionStatus === 'ACTIVE' && <Badge variant="success">Pro Plan</Badge>}
              </div>
            </div>
            <p className="text-[15px] font-medium text-white/80 leading-relaxed mb-6">
              {desc}
            </p>

            <div className="pt-6 border-t border-white/10">
              <h4 className="text-caption-bold text-white/90 mb-2">Need Help?</h4>
              <p className="text-[13px] text-white/60 mb-4">
                You can reach out to our admin team directly from the Support tab for any account issues.
              </p>
            </div>
          </div>

          {/* Activation Card */}
          <Card variant="dashboard" className="p-8 rounded-[24px]">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-apple-blue/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-apple-blue" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-primary">Activate Code</h3>
                <p className="text-xs text-secondary mt-1">Upgrade account via promo or activation string.</p>
              </div>
            </div>
            
            <div className="space-y-4 max-w-sm">
              <label className="text-[11px] font-bold uppercase tracking-wider text-tertiary">
                Activation Code
              </label>
              <input
                type="text"
                value={activationCode}
                onChange={e => setActivationCode(e.target.value.toUpperCase())}
                placeholder="e.g. NEXORA2025"
                className="w-full px-5 py-4 rounded-xl bg-page border border-border-subtle focus:border-apple-blue focus:ring-1 focus:ring-apple-blue outline-none text-primary font-mono tracking-widest uppercase transition-all"
              />
              {message && (
                <p className={`text-[13px] font-medium mt-2 ${message.type === 'success' ? 'text-success' : 'text-error'}`}>
                  {message.text}
                </p>
              )}
              
              <Button
                variant="primary"
                fullWidth
                onClick={handleActivation}
                disabled={loading || !activationCode.trim()}
                isLoading={loading}
                className="py-3.5 mt-2 rounded-xl"
              >
                {loading ? 'Activating...' : 'Redeem Code'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Pro Plan Feature Card */}
        <div className="lg:col-span-1">
          <div className="relative h-full flex flex-col rounded-[24px] p-8 bg-surface apple-shadow-lg ring-1 ring-apple-blue/40 border border-apple-blue/20">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <div className="bg-gradient-to-r from-apple-blue to-purple-500 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" /> Yearly Pro Plan
              </div>
            </div>

            <div className="mb-8 mt-4 text-center">
              <div className="flex items-baseline justify-center gap-1 mb-2">
                <span className="text-5xl font-extrabold tracking-tight text-primary">$150</span>
                <span className="text-secondary font-medium">/ year</span>
              </div>
              <p className="text-[13px] font-medium text-tertiary">Cancel anytime.</p>
            </div>

            <div className="space-y-4 flex-1">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-apple-blue mb-4">Pro Plan Benefits</h4>
              {[
                'Unlimited automated comments',
                'Unlimited keyword targeting',
                'Advanced A.I. Persona tracking',
                'Secure Identity Lock protocol',
                'Priority execution in the cloud queue',
                'Lifetime access to dashboard metrics',
                'Direct 24/7 technical support'
              ].map((feature, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 w-5 h-5 rounded-full bg-apple-blue/10 flex items-center justify-center flex-shrink-0">
                    <Check className="w-3.5 h-3.5 text-apple-blue" />
                  </div>
                  <span className="text-[14px] font-medium text-primary leading-tight">{feature}</span>
                </div>
              ))}
            </div>

            <div className="mt-8 pt-6 border-t border-border-subtle">
              <p className="text-[13px] text-secondary text-center mb-4">
                To upgrade to Pro, simply purchase via our merchant portal or contact the support team.
              </p>
              <a href="mailto:sddeeoossa@gmail.com?subject=Nexora%20Account%20Upgrade"
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-apple-blue hover:opacity-90 text-white font-semibold transition-all shadow-md shadow-apple-blue/20">
                <Star className="w-4 h-4" /> Contact to Upgrade
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
