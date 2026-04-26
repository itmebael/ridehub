import React from 'react';

interface WelcomeScreenProps {
  onStart: () => void;
  onLogin: () => void;
  onSignUp: () => void;
}

function SearchItem({
  icon,
  label,
  value,
  bordered = true,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bordered?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-3 ${
        bordered ? 'border-b border-white/60 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4' : ''
      }`}
    >
      <div className="mt-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff3e8] text-[#f56b2d] shadow-[0_10px_25px_rgba(245,107,45,0.14)]">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9c8372]">{label}</p>
        <p className="mt-2 text-base font-semibold text-[#2a1c16]">{value}</p>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="entry-soft-panel rounded-[24px] px-5 py-4">
      <p className="text-2xl font-black text-[#2a1c16]">{value}</p>
      <p className="mt-1 text-sm text-[#7c675a]">{label}</p>
    </div>
  );
}

export default function WelcomeScreen({ onStart, onLogin, onSignUp }: WelcomeScreenProps) {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
        <header className="entry-panel mt-1 flex flex-wrap items-center justify-between gap-4 rounded-[30px] px-4 py-4 sm:mt-4 sm:px-7">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/85 p-2 shadow-[0_18px_40px_rgba(77,38,17,0.14)]">
                <img src="/logo.png" alt="RIDEHUB Logo" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/88 p-2 shadow-[0_18px_40px_rgba(77,38,17,0.14)]">
                <img
                  src="/Catbalogan_City_Seal.png"
                  alt="Catbalogan City Seal"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
            <div>
              <p className="text-xl font-black tracking-tight text-[#2a1c16] sm:text-2xl">RIDEHUB</p>
              <p className="text-sm text-[#7d6a5d]">City of Catbalogan, Samar rental portal</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => {
                document.getElementById('about-us')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="entry-orange-outline rounded-full px-4 py-2 text-sm font-semibold sm:px-5"
            >
              About Us
            </button>
            <button
              onClick={onSignUp}
              className="entry-ghost-button rounded-full px-4 py-2 text-sm font-semibold sm:px-5"
            >
              Sign Up
            </button>
          </div>
        </header>

        <main className="flex flex-1 items-center py-8 lg:py-12">
          <div className="grid w-full gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-6">
            <div className="max-w-xl">
              <span className="entry-chip">Catbalogan ready rentals</span>
              <h1 className="mt-5 text-5xl font-black leading-[0.94] tracking-tight text-[#241813] sm:text-6xl lg:text-[5.35rem]">
                <span className="block text-[#ff7a2f]">Best Vehicle</span>
                <span className="block">Rental Deals</span>
                <span className="block">Today</span>
              </h1>

              <p className="mt-5 max-w-lg text-base leading-8 text-[#6e5d51] sm:text-lg">
                Browse trusted rides, faster pickups, and a smoother welcome screen built around your
                yellow car hero. The whole entry experience now feels brighter and more premium.
              </p>

              <div className="mt-8">
                <button
                  onClick={() => {
                    document.getElementById('about-us')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="entry-ghost-button rounded-full px-7 py-3 text-base font-semibold"
                >
                  About Us
                </button>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <StatCard value="150+" label="Verified rides" />
                <StatCard value="24/7" label="rental support" />
                <StatCard value="Same day" label="Pickup options" />
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[760px] pb-4 lg:pb-16">
              <div className="absolute inset-x-[16%] top-[8%] h-[62%] rounded-full bg-[radial-gradient(circle,rgba(255,203,90,0.72)_0%,rgba(255,203,90,0.22)_46%,rgba(255,203,90,0)_76%)] blur-3xl" />
              <div className="absolute right-[6%] top-[12%] h-48 w-48 rounded-full bg-[#ffb079]/55 blur-3xl" />
              <div className="absolute bottom-[18%] left-[12%] h-16 w-[60%] rounded-full bg-[rgba(103,52,21,0.22)] blur-2xl" />

              <img
                src="/car.png"
                alt="Featured rental car"
                className="relative z-10 mx-auto w-full max-w-[680px] drop-shadow-[0_30px_35px_rgba(74,38,18,0.28)]"
              />

              <div className="entry-soft-panel mt-6 grid gap-4 rounded-[30px] p-4 sm:grid-cols-2 lg:absolute lg:-bottom-2 lg:left-4 lg:right-4 lg:mt-0 lg:grid-cols-[1.05fr_1.1fr_1fr_auto] lg:items-center lg:p-5">
                <SearchItem
                  label="Select Your Car"
                  value="City Ride Automatic"
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M8 17h8m-9 3h10a2 2 0 001.789-1.106l1.5-3A2 2 0 0022 15v-3a2 2 0 00-1.553-1.946L18.8 6.76A2 2 0 0016.858 5H7.142A2 2 0 005.2 6.76L3.553 10.054A2 2 0 002 12v3a2 2 0 00.211.894l1.5 3A2 2 0 005.5 20H7m0-3a1 1 0 11-2 0 1 1 0 012 0zm14 0a1 1 0 11-2 0 1 1 0 012 0z"
                      />
                    </svg>
                  }
                />
                <SearchItem
                  label="Where to Pick Up"
                  value="Catbalogan City Center"
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M12 21s6-5.2 6-11a6 6 0 10-12 0c0 5.8 6 11 6 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
                      />
                    </svg>
                  }
                />
                <SearchItem
                  label="Date of Pick Up"
                  value="Today to next weekend"
                  bordered={false}
                  icon={
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.8}
                        d="M8 2v3m8-3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zm3 8h3m2 0h3m-8 4h3m2 0h3"
                      />
                    </svg>
                  }
                />
                <button
                  onClick={onStart}
                  className="entry-cta w-full rounded-[22px] px-6 py-4 text-base font-semibold text-white lg:w-auto"
                >
                  Search Now
                </button>
              </div>
            </div>
          </div>
        </main>

        <section id="about-us" className="pb-8 lg:pb-12">
          <div className="entry-panel rounded-[32px] p-6 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <div>
                <span className="entry-chip">About us</span>
                <h2 className="mt-4 text-3xl font-black tracking-tight text-[#241813] sm:text-4xl">
                  Built for Catbalogan rentals and local mobility.
                </h2>
                <p className="mt-4 text-base leading-8 text-[#6f5d51]">
                  RIDEHUB helps renters, vehicle owners, and city staff use one simple platform
                  for trusted Rentals, verified accounts, and smoother travel around Catbalogan, Samar.
                </p>
                <p className="mt-3 text-base leading-8 text-[#6f5d51]">
                  The goal is to make local transportation feel safer, easier, and more organized while
                  keeping the city identity visible through the official seal, local imagery, and your
                  own system branding.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard value="Safe" label="Verified users" />
                <StatCard value="Local" label="City-focused design" />
                <StatCard value="Fast" label="Simple rental flow" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

