'use client';

import React, { useState } from 'react';
import { Mail, MessageSquare, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

export default function SupportPanel() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    try {
      setIsSubmitting(true);
      setError('');
      
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message })
      });

      if (!res.ok) {
        throw new Error('Failed to send message');
      }

      setSuccess(true);
      setSubject('');
      setMessage('');
      
      // Reset success message after 5 seconds
      setTimeout(() => setSuccess(false), 5000);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-display font-medium text-primary mb-2">Support & Contact</h1>
        <p className="text-body text-secondary">
          Need help or have a question? Send a message directly to our admin team.
        </p>
      </div>

      <Card hover={false} className="p-8">
        <div className="flex items-center gap-4 mb-8 pb-6 border-b border-border-subtle">
          <div className="w-12 h-12 bg-apple-blue/10 rounded-2xl flex items-center justify-center">
            <Mail className="w-6 h-6 text-apple-blue" />
          </div>
          <div>
            <h2 className="text-card-title text-primary">Direct Message</h2>
            <p className="text-caption text-secondary">We typically respond within 24 hours.</p>
          </div>
        </div>

        {success && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
            <p className="text-sm text-green-600 dark:text-green-400 font-medium">
              Your message has been sent successfully. We will get back to you soon.
            </p>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">
              {error}
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-caption-bold text-primary mb-2">
              Topic / Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-surface-elevated border border-border-default rounded-xl px-4 py-3 text-body-emphasis focus:outline-none focus:ring-2 focus:ring-apple-blue/50 transition-all"
              placeholder="e.g. Question about Pro upgrade, Bug report..."
              required
            />
          </div>

          <div>
            <label className="block text-caption-bold text-primary mb-2">
              Your Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isSubmitting}
              rows={6}
              className="w-full bg-surface-elevated border border-border-default rounded-xl px-4 py-3 text-body-emphasis focus:outline-none focus:ring-2 focus:ring-apple-blue/50 transition-all resize-none"
              placeholder="Please describe your issue or question in detail..."
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={isSubmitting || !subject.trim() || !message.trim()}
              className="px-8 py-3 text-[15px]"
            >
              {isSubmitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Message
                </>
              )}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
