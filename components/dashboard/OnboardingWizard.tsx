import React, { useState, useEffect } from 'react';
import { Bot, CheckCircle2, Download, Link2, Sparkles, ShieldCheck } from 'lucide-react';
import Card from '@/components/ui/Card';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="w-full max-w-2xl bg-[#1d1d1f] shadow-2xl overflow-hidden rounded-xl border border-[rgba(255,255,255,0.05)] apple-shadow">
        
        {/* Header */}
        <div className="p-8 md:p-10 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] text-white relative">
          <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
            <Bot className="w-40 h-40" />
          </div>
          <div className="relative z-10">
            <Badge variant="info" size="sm" className="mb-4">Quick Start Guide</Badge>
            <h3 className="text-display-hero mb-2">Welcome to Nexora <span className="text-[#0071e3]">Pro</span></h3>
            <p className="text-caption text-[rgba(255,255,255,0.48)] max-w-lg leading-relaxed">
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
                  step > num || (step === 3 && num === 3 && isExtensionConnected) ? 'bg-[#34c759] text-white' : 
                  step === num ? 'bg-[#0071e3] text-white' : 'bg-[#272729] text-[rgba(255,255,255,0.48)] border border-[rgba(255,255,255,0.05)]'
                }`}>
                  {step > num ? <CheckCircle2 className="w-5 h-5" /> : num}
                </div>
                {num < 3 && <div className={`h-[2px] flex-1 ${step > num ? 'bg-[#34c759]' : 'bg-[rgba(255,255,255,0.05)]'}`}></div>}
              </div>
            ))}
          </div>

          {/* Step Content */}
          <div className="min-h-[250px] flex flex-col justify-center">
            
            {step === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-[rgba(255,255,255,0.06)] rounded-xl flex items-center justify-center">
                    <Download className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-white">Install the Agent</h4>
                    <p className="text-micro text-[rgba(255,255,255,0.48)]">Add the Nexora extension to Google Chrome</p>
                  </div>
                </div>
                
                <div className="bg-[#272729] rounded-xl p-6 border border-[rgba(255,255,255,0.05)] mb-6">
                  <ol className="list-decimal list-inside space-y-3 text-caption text-[rgba(255,255,255,0.8)]">
                    <li>Download the extension ZIP file below</li>
                    <li>Extract it to a folder on your computer</li>
                    <li>Go to <code className="bg-[#1d1d1f] px-2 py-1 rounded text-white border border-[rgba(255,255,255,0.05)]">chrome://extensions</code></li>
                    <li>Enable <strong>Developer mode</strong> (top right)</li>
                    <li>Click <strong>Load unpacked</strong> and select the folder</li>
                  </ol>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <a href="/LinkedInExtension.zip" download className="w-full sm:w-auto px-6 py-2.5 bg-[#0071e3] text-white rounded-md text-caption-bold hover:bg-[#0071e3]/90 transition-all flex items-center justify-center gap-2">
                    <Download className="w-4 h-4" /> Download Extension
                  </a>
                  <button onClick={() => setStep(2)} className="w-full sm:w-auto px-6 py-2.5 bg-[rgba(255,255,255,0.06)] text-white rounded-md text-caption-bold hover:bg-[rgba(255,255,255,0.12)] transition-all">
                    I've installed it
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-[rgba(0,113,227,0.1)] text-[#0071e3] rounded-xl flex items-center justify-center">
                    <Link2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-white">Connect to Dashboard</h4>
                    <p className="text-micro text-[rgba(255,255,255,0.48)]">Link your browser strictly via 1-Click mapping</p>
                  </div>
                </div>
                
                <div className="bg-[rgba(0,113,227,0.04)] rounded-xl p-8 border border-[rgba(0,113,227,0.16)] mb-6 text-center">
                  {!isExtensionConnected ? (
                    <>
                      <div className="w-16 h-16 bg-[#1d1d1f] rounded-full mx-auto mb-4 border border-[rgba(255,255,255,0.05)] flex items-center justify-center">
                        <span className="relative flex h-5 w-5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0071e3] opacity-40"></span>
                          <span className="relative inline-flex rounded-full h-5 w-5 bg-[#0071e3]"></span>
                        </span>
                      </div>
                      <h5 className="font-semibold text-white mb-2">Waiting for connection...</h5>
                      <p className="text-caption text-[rgba(255,255,255,0.64)] max-w-sm mx-auto">Open the Nexora Extension from your browser toolbar and click <strong>Auto-Connect</strong>.</p>
                    </>
                  ) : (
                    <div className="animate-in zoom-in duration-300">
                      <div className="w-16 h-16 bg-[rgba(52,199,89,0.1)] text-[#34c759] rounded-full mx-auto mb-4 border border-[rgba(52,199,89,0.2)] flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <h5 className="font-semibold text-[#34c759] mb-2">Connected Successfully!</h5>
                      <p className="text-caption text-[#34c759]/70">Your extension is now linked to this dashboard.</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(1)} className="px-6 py-2.5 text-[rgba(255,255,255,0.64)] text-caption-bold hover:bg-[rgba(255,255,255,0.06)] rounded-md transition-all">
                    Back
                  </button>
                  <button onClick={() => setStep(3)} className="px-6 py-2.5 bg-[rgba(255,255,255,0.06)] text-white rounded-md text-caption-bold hover:bg-[rgba(255,255,255,0.12)] transition-all">
                    Skip / Next
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 bg-[rgba(255,159,10,0.1)] text-[#ff9f0a] rounded-xl flex items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-tile-heading text-white">Load a Starter Pack</h4>
                    <p className="text-micro text-[rgba(255,255,255,0.48)]">Instantly seed your account with AI-crafted targets</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <button 
                    onClick={() => handleApplyPack('marketing')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-[#272729] border border-[rgba(255,255,255,0.05)] rounded-xl hover:border-[#0071e3] transition-all disabled:opacity-50 group"
                  >
                    <Badge variant="info" size="sm" className="mb-3">Marketing</Badge>
                    <h5 className="font-semibold text-white mb-1 group-hover:text-[#0071e3] transition-colors">Growth & Marketing</h5>
                    <p className="text-micro text-[rgba(255,255,255,0.48)]">+3 Keywords • +9 Comments</p>
                  </button>
                  <button 
                    onClick={() => handleApplyPack('tech')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-[#272729] border border-[rgba(255,255,255,0.05)] rounded-xl hover:border-[#0071e3] transition-all disabled:opacity-50 group"
                  >
                    <Badge variant="neutral" size="sm" className="mb-3">Tech</Badge>
                    <h5 className="font-semibold text-white mb-1 group-hover:text-[#0071e3] transition-colors">Software Engineering</h5>
                    <p className="text-micro text-[rgba(255,255,255,0.48)]">+3 Keywords • +9 Comments</p>
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <button onClick={() => setStep(2)} className="px-6 py-2.5 text-[rgba(255,255,255,0.64)] text-caption-bold hover:bg-[rgba(255,255,255,0.06)] rounded-md transition-all">
                    Back
                  </button>
                  <button onClick={onClose} className="px-6 py-2.5 bg-[#0071e3] text-white rounded-md text-caption-bold hover:bg-[#0071e3]/90 transition-all">
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
