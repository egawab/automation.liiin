import Navigation from '@/components/landing/Navigation';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';
import Footer from '@/components/layout/Footer';
import SocialProof from '@/components/landing/SocialProof';
import Pricing from '@/components/landing/Pricing';
import CTA from '@/components/landing/CTA';
import Subtle3DBackground from '@/components/landing/Subtle3DBackground';

export default function LandingPage() {
  return (
    <div className="min-h-screen relative bg-gray-900">
      {/* Subtle 3D Animated Background */}
      <Subtle3DBackground />
      
      {/* Clean, Minimal SaaS Structure */}
      <Navigation />
      <Hero />
      <SocialProof />
      <Features />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  );
}
