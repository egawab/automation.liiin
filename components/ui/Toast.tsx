'use client';

import toast, { Toaster, ToastOptions } from 'react-hot-toast';
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';

const ToastContent = ({ icon, title, message, onClose, accentColor }: {
  icon: React.ReactNode; title: string; message: string; onClose: () => void; accentColor: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="flex-shrink-0" style={{ color: accentColor }}>{icon}</div>
    <div className="flex-1 min-w-0">
      <h4 className="text-caption-bold text-primary">{title}</h4>
      <p className="text-micro text-secondary mt-0.5">{message}</p>
    </div>
    <button onClick={onClose} className="text-tertiary hover:text-primary transition-colors flex-shrink-0">
      <X className="w-4 h-4" />
    </button>
  </div>
);

const toastBase = 'bg-surface rounded-xl apple-shadow-lg p-4 max-w-sm pointer-events-auto border border-border-subtle';

export const showToast = {
  success: (message: string, options?: ToastOptions) => {
    return toast.custom((t) => (
      <div className={`${t.visible ? 'animate-in slide-in-from-right' : 'animate-out slide-out-to-right'} ${toastBase}`}>
        <ToastContent icon={<CheckCircle className="w-5 h-5" />} title="Success" message={message} onClose={() => toast.dismiss(t.id)} accentColor="#34c759" />
      </div>
    ), options);
  },

  error: (message: string, options?: ToastOptions) => {
    return toast.custom((t) => (
      <div className={`${t.visible ? 'animate-in slide-in-from-right' : 'animate-out slide-out-to-right'} ${toastBase}`}>
        <ToastContent icon={<AlertCircle className="w-5 h-5" />} title="Error" message={message} onClose={() => toast.dismiss(t.id)} accentColor="#ff3b30" />
      </div>
    ), options);
  },

  warning: (message: string, options?: ToastOptions) => {
    return toast.custom((t) => (
      <div className={`${t.visible ? 'animate-in slide-in-from-right' : 'animate-out slide-out-to-right'} ${toastBase}`}>
        <ToastContent icon={<AlertTriangle className="w-5 h-5" />} title="Warning" message={message} onClose={() => toast.dismiss(t.id)} accentColor="#ff9f0a" />
      </div>
    ), options);
  },

  info: (message: string, options?: ToastOptions) => {
    return toast.custom((t) => (
      <div className={`${t.visible ? 'animate-in slide-in-from-right' : 'animate-out slide-out-to-right'} ${toastBase}`}>
        <ToastContent icon={<Info className="w-5 h-5" />} title="Info" message={message} onClose={() => toast.dismiss(t.id)} accentColor="#0071e3" />
      </div>
    ), options);
  },

  promise: toast.promise
};

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: { background: 'transparent', boxShadow: 'none', padding: 0 },
      }}
    />
  );
}

export default showToast;
