import React, { useState, useEffect } from 'react';
import { Bot, CheckCircle2, Download, Link2, Sparkles } from 'lucide-react';
import Badge from '@/components/ui/Badge';

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  loadStarterPack: (packType: string) => Promise<void>;
  isDeployingPack: boolean;
}

export default function OnboardingWizard({ isOpen, onClose, loadStarterPack, isDeployingPack }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [isExtensionConnected, setIsExtensionConnected] = useState(false);

  useEffect(() => {
    // Listen for extension connection signal from dashboard-bridge.js
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || event.data.source !== 'NEXORA_EXTENSION') return;
      if (event.data.action === 'EXTENSION_READY' || event.data.action === 'ENGINE_STARTED_ACK') {
        setIsExtensionConnected(true);
        if (step === 2) {
          setTimeout(() => setStep(3), 1000); // Auto advance to step 3!
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [step]);

  if (!isOpen) return null;

  const handleApplyPack = async (packType: string) => {
    await loadStarterPack(packType);
    onClose(); // Close wizard immediately after loading the pack
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-hidden">
      <div className="w-full max-w-2xl max-h-[90vh] bg-surface-elevated shadow-2xl overflow-y-auto rounded-xl border border-subtle apple-shadow flex flex-col">
        
        {/* Header */}
        <div className="p-8 md:p-10 border-b border-subtle bg-surface text-primary relative">
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
            <Bot className="w-40 h-40" />
          </div>
          <div className="relative z-10">
            <Badge variant="info" size="sm" className="mb-4">Quick Start Guide</Badge>
            <h3 className="text-display-hero mb-2">Welcome to Nexora <span className="text-apple-blue">Pro</span></h3>
            <p className="text-caption text-secondary max-w-lg leading-relaxed">
              Let's set up your automated LinkedIn engine in 3 simple steps. No coding or complex configuration required.
            </p>
          </div>
        </div>

        <div className="p-8 md:p-10">
          {/* Progress Indicators */}
          <div className="flex items-center gap-4 mb-10">
            {[1, 2, 3].map(num => (
              <div key={num} className="flex items-center gap-4 flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300 ${
                  step > num || (step === 3 && num === 3 && isExtensionConnected) ? 'bg-success text-white' : 
                  step === num ? 'bg-apple-blue text-white' : 'bg-surface-hover text-tertiary border border-subtle'
                }`}>
                  {step > num ? <CheckCircle2 className="w-5 h-5" /> : num}
                </div>
                {num < 3 && <div className={`h-[2px] flex-1 ${step > num ? 'bg-success' : 'bg-surface-hover'}`}></div>}
              </div>
            ))}
          </div>

          {/* Step Content */}
          <div className="min-h-[250px] flex flex-col justify-center">
            
            {step === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-surface-hover rounded-xl flex items-center justify-center">
                    <Download className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-primary">Install the Agent</h4>
                    <p className="text-micro text-secondary">Add the Nexora extension to Google Chrome</p>
                  </div>
                </div>
                
                <div className="bg-surface-hover rounded-xl p-6 border border-subtle mb-6">
                  <ol className="list-decimal list-inside space-y-3 text-caption text-primary">
                    <li>Download the extension file below</li>
                    <li>Extract it to a folder on your computer</li>
                    <li>Go to <code className="bg-surface px-2 py-1 rounded text-primary border border-subtle">chrome://extensions</code></li>
                    <li>Enable <strong>Developer mode</strong> (top right)</li>
                    <li>Click <strong>Load unpacked</strong> and select the extracted folder</li>
                  </ol>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <a href="/LinkedInExtension_updated.zip" download="LinkedInExtension_updated" className="w-full sm:w-auto px-6 py-2.5 bg-apple-blue text-white rounded-md text-caption-bold hover:bg-apple-blue/90 transition-all flex items-center justify-center gap-2">
                    <Download className="w-4 h-4" /> Download Extension
                  </a>
                  <button onClick={() => setStep(2)} className="w-full sm:w-auto px-6 py-2.5 bg-surface-hover text-primary rounded-md text-caption-bold hover:bg-surface-elevated transition-all border border-subtle">
                    I've installed it
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-apple-blue/10 text-apple-blue rounded-xl flex items-center justify-center">
                    <Link2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-primary">Connect to Dashboard</h4>
                    <p className="text-micro text-secondary">Link your browser strictly via 1-Click mapping</p>
                  </div>
                </div>
                
                <div className="bg-apple-blue/5 rounded-xl p-8 border border-apple-blue/20 mb-6 text-center">
                  {!isExtensionConnected ? (
                    <>
                      <div className="w-16 h-16 bg-surface-elevated rounded-full mx-auto mb-4 border border-subtle flex items-center justify-center">
                        <span className="relative flex h-5 w-5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-apple-blue opacity-40"></span>
                          <span className="relative inline-flex rounded-full h-5 w-5 bg-apple-blue"></span>
                        </span>
                      </div>
                      <h5 className="font-semibold text-primary mb-2">Waiting for connection...</h5>
                      <p className="text-caption text-secondary max-w-sm mx-auto">Open the Nexora Extension from your browser toolbar and click <strong>Auto-Connect</strong>.</p>
                    </>
                  ) : (
                    <div className="animate-in zoom-in duration-300">
                      <div className="w-16 h-16 bg-success/10 text-success rounded-full mx-auto mb-4 border border-success/20 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <h5 className="font-semibold text-success mb-2">Connected Successfully!</h5>
                      <p className="text-caption text-success/70">Your extension is now linked to this dashboard.</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(1)} className="px-6 py-2.5 text-secondary text-caption-bold hover:bg-surface-hover rounded-md transition-all">
                    Back
                  </button>
                  <button onClick={() => setStep(3)} className="px-6 py-2.5 bg-surface-hover border border-subtle text-primary rounded-md text-caption-bold hover:bg-surface-elevated transition-all">
                    Skip / Next
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-warning/10 text-warning rounded-xl flex items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-primary">Load a Starter Pack</h4>
                    <p className="text-micro text-secondary">Instantly seed your account with AI-crafted targets</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <button 
                    onClick={() => handleApplyPack('marketing')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-surface-hover border border-subtle rounded-xl hover:border-apple-blue transition-all disabled:opacity-50 group"
                  >
                    <Badge variant="info" size="sm" className="mb-3">Marketing</Badge>
                    <h5 className="font-semibold text-primary mb-1 group-hover:text-apple-blue transition-colors">Growth & Marketing</h5>
                    <p className="text-micro text-tertiary">+3 Keywords • +9 Comments</p>
                  </button>
                  <button 
                    onClick={() => handleApplyPack('tech')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-surface-hover border border-subtle rounded-xl hover:border-apple-blue transition-all disabled:opacity-50 group"
                  >
                    <Badge variant="neutral" size="sm" className="mb-3">Tech</Badge>
                    <h5 className="font-semibold text-primary mb-1 group-hover:text-apple-blue transition-colors">Software Engineering</h5>
                    <p className="text-micro text-tertiary">+3 Keywords • +9 Comments</p>
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(2)} className="px-6 py-2.5 text-secondary text-caption-bold hover:bg-surface-hover rounded-md transition-all">
                    Back
                  </button>
                  <button onClick={onClose} className="px-6 py-2.5 bg-apple-blue text-white rounded-md text-caption-bold hover:bg-apple-blue/90 transition-all">
                    I'll add manually
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
