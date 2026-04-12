'use client';

import Navigation from '@/components/landing/Navigation';
import Hero from '@/components/landing/Hero';
import Features from '@/components/landing/Features';
import Footer from '@/components/layout/Footer';
import SocialProof from '@/components/landing/SocialProof';
import Pricing from '@/components/landing/Pricing';
import CTA from '@/components/landing/CTA';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-hero">
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
