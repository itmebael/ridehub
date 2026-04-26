import React, { useEffect, useState } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import RoleSelectionScreen from './components/RoleSelectionScreen';
import AuthScreen from './components/AuthScreen';
import ResetPasswordScreen from './components/ResetPasswordScreen';
import EmailVerificationScreen from './components/EmailVerificationScreen';
import ClientDashboard from './components/ClientDashboard';
import OwnerDashboard from './components/OwnerDashboard';
import AdminDashboard from './components/AdminDashboard';
import { type AuthCallbackPayload, extractAuthPayloadFromLocation } from './lib/authTokens';
import type { CSSProperties } from 'react';

type Screen =
  | 'welcome'
  | 'roleSelection'
  | 'auth'
  | 'resetPassword'
  | 'emailVerification'
  | 'clientDashboard'
  | 'ownerDashboard'
  | 'adminDashboard';

type UserType = 'client' | 'owner' | 'admin' | null;

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('welcome');
  const [selectedUserType, setSelectedUserType] = useState<UserType>(null);
  const [verificationCallback, setVerificationCallback] = useState<AuthCallbackPayload | null>(null);

  useEffect(() => {
    const authPayload = extractAuthPayloadFromLocation(window.location);
    const isSignupVerification = authPayload.type === 'signup' || authPayload.type === 'email';
    const hasVerificationCallback =
      !!authPayload.token || !!authPayload.code || !!authPayload.errorDescription || authPayload.isPathToken;

    if (hasVerificationCallback && (isSignupVerification || authPayload.isPathToken)) {
      setVerificationCallback(authPayload);
      setCurrentScreen('emailVerification');
      window.history.replaceState({}, document.title, authPayload.isPathToken ? '/' : window.location.pathname);
    }
  }, []);

  const handleStart = () => {
    setCurrentScreen('roleSelection');
  };

  const handleOpenLogin = () => {
    setCurrentScreen('auth');
  };

  const handleOpenSignup = () => {
    setSelectedUserType(null);
    setCurrentScreen('roleSelection');
  };

  const handleRoleSelection = (userType: UserType) => {
    setSelectedUserType(userType);
    setCurrentScreen('auth');
  };

  const handleBackToAuth = () => {
    setVerificationCallback(null);
    setCurrentScreen('auth');
  };

  const handleBackFromAuth = () => {
    if (selectedUserType) {
      setCurrentScreen('roleSelection');
      return;
    }

    setCurrentScreen('welcome');
  };

  const handleLoginSuccess = () => {
    const override = typeof window !== 'undefined' ? window.localStorage.getItem('loginAs') : null;
    if (override === 'admin') {
      try {
        window.localStorage.removeItem('loginAs');
      } catch {}
      setCurrentScreen('adminDashboard');
      return;
    }

    switch (selectedUserType) {
      case 'client':
        setCurrentScreen('clientDashboard');
        break;
      case 'owner':
        setCurrentScreen('ownerDashboard');
        break;
      case 'admin':
        setCurrentScreen('adminDashboard');
        break;
      default:
        setCurrentScreen('clientDashboard');
    }
  };

  const handleBackToWelcome = () => {
    setCurrentScreen('welcome');
    setSelectedUserType(null);
  };

  const handleResetPassword = () => {
    setCurrentScreen('resetPassword');
  };

  const handleResetSuccess = () => {
    setCurrentScreen('auth');
  };

  const handleVerificationSuccess = () => {
    setVerificationCallback(null);
    setCurrentScreen('auth');
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'welcome':
        return (
          <WelcomeScreen onStart={handleStart} onLogin={handleOpenLogin} onSignUp={handleOpenSignup} />
        );
      case 'roleSelection':
        return <RoleSelectionScreen onRoleSelect={handleRoleSelection} onBack={handleBackToWelcome} />;
      case 'auth':
        return (
          <AuthScreen
            userType={selectedUserType}
            onLoginSuccess={handleLoginSuccess}
            onResetPassword={handleResetPassword}
            onBack={handleBackFromAuth}
          />
        );
      case 'resetPassword':
        return (
          <ResetPasswordScreen
            userType={selectedUserType}
            onBack={handleBackToAuth}
            onSuccess={handleResetSuccess}
          />
        );
      case 'emailVerification':
        return (
          <EmailVerificationScreen
            token={verificationCallback?.token || undefined}
            refreshToken={verificationCallback?.refreshToken || undefined}
            authCode={verificationCallback?.code || undefined}
            initialError={verificationCallback?.errorDescription || undefined}
            onVerificationSuccess={handleVerificationSuccess}
            onBack={handleBackToAuth}
          />
        );
      case 'clientDashboard':
        return <ClientDashboard onBack={handleBackToWelcome} />;
      case 'ownerDashboard':
        return <OwnerDashboard onBack={handleBackToWelcome} />;
      case 'adminDashboard':
        return <AdminDashboard onBack={handleBackToWelcome} />;
      default:
        return (
          <WelcomeScreen onStart={handleStart} onLogin={handleOpenLogin} onSignUp={handleOpenSignup} />
        );
    }
  };

  const isDashboard =
    currentScreen === 'clientDashboard' ||
    currentScreen === 'ownerDashboard' ||
    currentScreen === 'adminDashboard';
  const hasEntryShell = ['welcome', 'roleSelection', 'auth', 'resetPassword', 'emailVerification'].includes(currentScreen);
  const entryShellStyle: CSSProperties | undefined = hasEntryShell
    ? ({
        '--entry-city-photo': "url('/catbalogan-city.jpg')",
      } as CSSProperties & { '--entry-city-photo': string })
    : undefined;

  return (
    <div
      className={`min-h-screen ${hasEntryShell ? 'entry-hero-shell relative overflow-hidden' : 'bg-white'}`}
      style={entryShellStyle}
    >
      {hasEntryShell && (
        <>
          <div className="entry-cityline pointer-events-none" />
          <div className="entry-light-path pointer-events-none" />
          <div className="entry-sunflare pointer-events-none" />
        </>
      )}

      <div className={isDashboard ? 'relative z-10 w-full' : 'relative z-10 w-full'}>{renderScreen()}</div>
    </div>
  );
}
