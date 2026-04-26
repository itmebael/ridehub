import React from 'react';

interface RoleSelectionScreenProps {
  onRoleSelect: (userType: 'client' | 'owner' | 'admin') => void;
  onBack: () => void;
}

function RoleCard({
  title,
  description,
  accentClass,
  buttonLabel,
  bullets,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  accentClass: string;
  buttonLabel: string;
  bullets: string[];
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="entry-panel group flex h-full flex-col rounded-[30px] p-6 text-left transition-transform duration-300 hover:-translate-y-1"
    >
      <div className={`flex h-14 w-14 items-center justify-center rounded-[18px] ${accentClass} text-white shadow-lg`}>
        {icon}
      </div>

      <h3 className="mt-6 text-2xl font-black tracking-tight text-[#241813]">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-[#6f5d51]">{description}</p>

      <div className="mt-5 space-y-3">
        {bullets.map((bullet) => (
          <div key={bullet} className="flex items-start gap-3 text-sm text-[#4d3a2f]">
            <span className="mt-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#fff0e3] text-[#f56b2d]">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 12l5 5L20 7" />
              </svg>
            </span>
            <span>{bullet}</span>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <span className="entry-cta inline-flex rounded-full px-5 py-3 text-sm font-semibold text-white">
          {buttonLabel}
        </span>
      </div>
    </button>
  );
}

export default function RoleSelectionScreen({ onRoleSelect, onBack }: RoleSelectionScreenProps) {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="entry-link-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[#412d24]"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white/85 p-2 shadow-[0_16px_35px_rgba(77,38,17,0.14)]">
                <img src="/logo.png" alt="RIDEHUB Logo" className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white/88 p-2 shadow-[0_16px_35px_rgba(77,38,17,0.14)]">
                <img
                  src="/Catbalogan_City_Seal.png"
                  alt="Catbalogan City Seal"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-[#251813]">RIDEHUB</p>
              <p className="text-sm text-[#7a685b]">City of Catbalogan, Samar</p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div className="max-w-xl">
            <span className="entry-chip">Get started</span>
            <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight text-[#241813] sm:text-5xl lg:text-[4.5rem]">
              Pick the role
              <span className="block text-[#ff7a2f]">that fits your trip</span>
            </h1>
            <p className="mt-5 text-base leading-8 text-[#6f5d51] sm:text-lg">
              Rent a ride, manage your vehicles, or step into the city dashboard. This screen now carries
              the same warm landing-page look so the flow feels connected from the first click.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-[700px]">
            <div className="absolute inset-x-[20%] top-[12%] h-[55%] rounded-full bg-[radial-gradient(circle,rgba(255,198,89,0.68)_0%,rgba(255,198,89,0.16)_46%,rgba(255,198,89,0)_78%)] blur-3xl" />
            <img
              src="/car.png"
              alt="Rental car preview"
              className="relative z-10 ml-auto w-full max-w-[620px] drop-shadow-[0_28px_36px_rgba(74,38,18,0.28)]"
            />
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <RoleCard
            title="Renter"
            description="Book verified vehicles, compare options quickly, and lock in a smooth pickup process."
            accentClass="bg-[#ff8b3d]"
            buttonLabel="Continue as renter"
            bullets={['Browse trusted listings', 'Track Rentals clearly', 'Fast access to support']}
            onClick={() => onRoleSelect('client')}
            icon={
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            }
          />

          <RoleCard
            title="Vehicle Owner"
            description="Showcase your fleet, respond to renters faster, and keep your rental business organized."
            accentClass="bg-[#0f8a83]"
            buttonLabel="Continue as owner"
            bullets={['Manage listings and Rentals', 'Monitor performance', 'Work with verified renters']}
            onClick={() => onRoleSelect('owner')}
            icon={
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 13l2-5a2 2 0 011.86-1.25h10.28A2 2 0 0119 8l2 5m-2 0v5a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H8v1a1 1 0 01-1 1H6a1 1 0 01-1-1v-5m0 0h14M7 13h.01M17 13h.01" />
              </svg>
            }
          />

          <RoleCard
            title="Administrator"
            description="Access the operations side of the platform to review users, listings, and service quality."
            accentClass="bg-[#46342a]"
            buttonLabel="Continue as admin"
            bullets={['Oversee platform activity', 'Review data in one place', 'Keep service standards high']}
            onClick={() => onRoleSelect('admin')}
            icon={
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3l7 4v5c0 4.2-2.9 8.1-7 9-4.1-.9-7-4.8-7-9V7l7-4zm-1 11l2 2 4-4" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}

