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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
      <Card className="w-full max-w-2xl bg-white shadow-2xl overflow-hidden border-0">
        <div className="p-8 md:p-10 border-b border-gray-100 bg-gradient-to-br from-gray-900 to-gray-800 text-white relative">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Bot className="w-40 h-40" />
          </div>
          <div className="relative z-10">
            <Badge variant="primary" className="mb-4 bg-primary-500 text-white border-none">Quick Start Guide</Badge>
            <h3 className="text-3xl font-black mb-2">Welcome to Nexora <span className="text-primary-400">Pro</span></h3>
            <p className="text-gray-300 max-w-lg leading-relaxed">
              Let's set up your automated LinkedIn engine in 3 simple steps. No coding or complex configuration required.
            </p>
          </div>
        </div>

        <div className="p-8 md:p-10">
          {/* Progress Indicators */}
          <div className="flex items-center gap-4 mb-10">
            {[1, 2, 3].map(num => (
              <div key={num} className="flex items-center gap-4 flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                  step > num || (step === 3 && num === 3 && isExtensionConnected) ? 'bg-success-500 text-white' : 
                  step === num ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-400'
                }`}>
                  {step > num ? <CheckCircle2 className="w-5 h-5" /> : num}
                </div>
                {num < 3 && <div className={`h-1 flex-1 rounded-full ${step > num ? 'bg-success-500' : 'bg-gray-100'}`}></div>}
              </div>
            ))}
          </div>

          {/* Step Content */}
          <div className="min-h-[250px] flex flex-col justify-center">
            
            {step === 1 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-primary-50 text-primary-600 rounded-2xl flex items-center justify-center">
                    <Download className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900">Install the Agent</h4>
                    <p className="text-sm text-gray-500">Add the Nexora extension to Google Chrome</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 mb-6">
                  <ol className="list-decimal list-inside space-y-3 text-sm font-medium text-gray-700">
                    <li>Download the extension ZIP file below</li>
                    <li>Extract it to a folder on your computer</li>
                    <li>Go to <code className="bg-white px-2 py-1 rounded text-primary-600 font-bold border border-gray-200">chrome://extensions</code></li>
                    <li>Enable <strong>Developer mode</strong> (top right)</li>
                    <li>Click <strong>Load unpacked</strong> and select the folder</li>
                  </ol>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-4">
                  <a href="/LinkedInExtension.zip" download className="w-full sm:w-auto px-6 py-3 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition flex items-center justify-center gap-2 shadow-lg shadow-primary-500/20">
                    <Download className="w-4 h-4" /> Download Extension
                  </a>
                  <button onClick={() => setStep(2)} className="w-full sm:w-auto px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition">
                    I've installed it →
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center">
                    <Link2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900">Connect to Dashboard</h4>
                    <p className="text-sm text-gray-500">Link your browser strictly via 1-Click mapping</p>
                  </div>
                </div>
                
                <div className="bg-blue-50/50 rounded-2xl p-8 border border-blue-100 mb-6 text-center">
                  {!isExtensionConnected ? (
                    <>
                      <div className="w-16 h-16 bg-white rounded-full mx-auto mb-4 border border-blue-100 shadow-sm flex items-center justify-center">
                        <span className="relative flex h-5 w-5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-5 w-5 bg-blue-500"></span>
                        </span>
                      </div>
                      <h5 className="font-bold text-gray-900 mb-2">Waiting for connection...</h5>
                      <p className="text-sm text-gray-600">Open the Nexora Extension from your browser toolbar and click the blue <strong>"🔗 Auto-Connect"</strong> button.</p>
                    </>
                  ) : (
                    <div className="animate-in zoom-in duration-300">
                      <div className="w-16 h-16 bg-success-100 text-success-600 rounded-full mx-auto mb-4 border border-success-200 flex items-center justify-center">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <h5 className="font-bold text-success-700 mb-2">Connected Successfully!</h5>
                      <p className="text-sm text-success-600">Your extension is now linked to this dashboard.</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <button onClick={() => setStep(1)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl transition">
                    ← Back
                  </button>
                  <button onClick={() => setStep(3)} className="ml-auto px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition">
                    Skip / Next →
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xl font-bold text-gray-900">Load a Starter Pack</h4>
                    <p className="text-sm text-gray-500">Instantly seed your account with AI-crafted targets</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <button 
                    onClick={() => handleApplyPack('marketing')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-white border-2 border-gray-100 rounded-2xl hover:border-primary-500 hover:shadow-lg hover:shadow-primary-500/10 transition-all text-gray-900 disabled:opacity-50"
                  >
                    <Badge variant="primary" className="mb-2">Marketing</Badge>
                    <h5 className="font-bold mb-1">Growth & Marketing</h5>
                    <p className="text-xs text-gray-500">+3 Keywords • +9 Comments</p>
                  </button>
                  <button 
                    onClick={() => handleApplyPack('tech')}
                    disabled={isDeployingPack}
                    className="p-5 text-left bg-white border-2 border-gray-100 rounded-2xl hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10 transition-all text-gray-900 disabled:opacity-50"
                  >
                    <Badge variant="secondary" className="mb-2 bg-blue-100 text-blue-700">Tech</Badge>
                    <h5 className="font-bold mb-1">Software Engineering</h5>
                    <p className="text-xs text-gray-500">+3 Keywords • +9 Comments</p>
                  </button>
                </div>

                <div className="flex items-center gap-4">
                  <button onClick={() => setStep(2)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-50 rounded-xl transition">
                    ← Back
                  </button>
                  <button onClick={onClose} className="ml-auto px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold hover:bg-gray-200 transition">
                    I'll add manually
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </Card>
    </div>
  );
}
