'use client';

import React, { useEffect, useState } from 'react';
import { Tractor, Shield, Clock, MapPin, Search, ChevronRight, Zap } from 'lucide-react';

export default function Home() {
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check connection to the FastAPI backend
    fetch(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000')
      .then(res => res.json())
      .then(data => {
        setHealthStatus(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Backend connection failed:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg text-white">
              <Tractor className="w-6 h-6" />
            </div>
            <span className="font-extrabold text-xl tracking-tight text-gray-900">
              Farm<span className="text-emerald-600">Rent</span>
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-gray-600">
            <a href="#" className="hover:text-emerald-600 transition-colors">Browse Equipment</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">How It Works</a>
            <a href="#" className="hover:text-emerald-600 transition-colors">List Your Equipment</a>
          </nav>
          <div className="flex items-center gap-4">
            <button className="text-sm font-semibold text-gray-700 hover:text-emerald-600 transition-colors">Sign In</button>
            <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm">Get Started</button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-emerald-800 to-emerald-950 text-white py-24 px-4 sm:px-6 lg:px-8">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"></div>
          <div className="max-w-5xl mx-auto text-center relative z-10">
            <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider mb-6">
              <Zap className="w-3.5 h-3.5" /> High-Performance Scaffolding Phase 1 Live
            </span>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-none mb-6">
              Rent Premium Farming Equipment <br />
              <span className="bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">On Demand</span>
            </h1>
            <p className="text-gray-300 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
              Connect directly with equipment owners across India. Pay securely, schedule easily, and maximize your farm's productivity.
            </p>

            {/* Mock Search Bar */}
            <div className="max-w-3xl mx-auto bg-white rounded-2xl p-2 shadow-2xl flex flex-col md:flex-row gap-2 text-gray-800">
              <div className="flex-1 flex items-center gap-2 px-3 py-2 border-b md:border-b-0 md:border-r border-gray-100">
                <Search className="w-5 h-5 text-gray-400 shrink-0" />
                <input type="text" placeholder="What machinery do you need? (Tractor, Harvester...)" className="w-full text-sm outline-none placeholder:text-gray-400 bg-transparent" />
              </div>
              <div className="flex items-center gap-2 px-3 py-2 shrink-0">
                <MapPin className="w-5 h-5 text-gray-400 shrink-0" />
                <input type="text" placeholder="Your Location" className="w-32 text-sm outline-none placeholder:text-gray-400 bg-transparent" />
              </div>
              <button className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all shrink-0 flex items-center justify-center gap-2">
                Find Machinery <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Feature Highlights */}
        <section className="max-w-7xl mx-auto py-20 px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-4">
              <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 mb-1">Secure Payments</h4>
                <p className="text-gray-500 text-sm">PCI-compliant transactions and instant security validation powered by Stripe.</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-4">
              <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
                <Tractor className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 mb-1">Wide Catalog</h4>
                <p className="text-gray-500 text-sm">Browse verified listings ranging from heavy tractors to special harvesters.</p>
              </div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-4">
              <div className="bg-emerald-50 text-emerald-600 p-3 rounded-xl">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-gray-900 mb-1">Time-Bound Scheduling</h4>
                <p className="text-gray-500 text-sm">Manage bookings with real-time availability updates and reminder notifications.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Tech Stack Connection Test */}
        <section className="bg-emerald-50 py-12 px-4">
          <div className="max-w-xl mx-auto bg-white rounded-2xl p-6 border border-emerald-100 shadow-md">
            <h3 className="font-bold text-gray-900 text-lg mb-4 text-center">📡 System Connection Test</h3>
            {loading ? (
              <div className="text-center text-sm text-gray-500 py-4 animate-pulse">Checking API connections...</div>
            ) : healthStatus ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm border-b pb-2 border-gray-50">
                  <span className="text-gray-600">FastAPI Server</span>
                  <span className="bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded text-xs">ONLINE</span>
                </div>
                <div className="flex justify-between items-center text-sm border-b pb-2 border-gray-50">
                  <span className="text-gray-600">Database (PostgreSQL)</span>
                  <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-xs">PENDING_CONFIG</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">Cache (Redis)</span>
                  <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-xs">PENDING_CONFIG</span>
                </div>
              </div>
            ) : (
              <div className="text-center text-sm text-red-600 py-4">
                ❌ Could not reach FastAPI server at <code>http://localhost:8000</code>. Verify it is running.
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8 border-t border-gray-800 text-center text-xs">
        <p>© 2026 FarmRent. Built with FastAPI, Next.js, and Docker Compose.</p>
      </footer>
    </div>
  );
}
