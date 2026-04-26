import React, { useState, useEffect } from 'react';
import {
  cleanAuthToken,
  extractAuthPayloadFromInput,
  extractAuthPayloadFromLocation,
  isJwtLikeToken,
  isOtpCode,
  normalizeAuthErrorMessage,
} from '../lib/authTokens';
import { supabase } from '../lib/supabase';

interface EmailVerificationScreenProps {
  token?: string;
  refreshToken?: string;
  authCode?: string;
  initialError?: string;
  onVerificationSuccess: () => void;
  onBack: () => void;
}

export default function EmailVerificationScreen({ 
  token, 
  refreshToken,
  authCode,
  initialError,
  onVerificationSuccess, 
  onBack 
}: EmailVerificationScreenProps) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [manualToken, setManualToken] = useState('');

  useEffect(() => {
    const authPayload = extractAuthPayloadFromLocation(window.location);
    const callbackToken = token || authPayload.token;
    const callbackRefreshToken = refreshToken || authPayload.refreshToken;
    const callbackCode = authCode || authPayload.code;
    const callbackError = initialError || authPayload.errorDescription;

    if (callbackToken) {
      setManualToken(callbackToken);
    }

    const initializeVerification = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user) {
        await completeVerification(session.user);
        return;
      }

      if (callbackCode) {
        setVerifying(true);

        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(callbackCode);

          if (exchangeError || !data?.user) {
            throw new Error(exchangeError?.message || 'Unable to complete email verification.');
          }

          await completeVerification(data.user);
          return;
        } catch (err: any) {
          setError(normalizeAuthErrorMessage(err.message));
        } finally {
          setVerifying(false);
        }

        return;
      }

      if (callbackToken && !isOtpCode(cleanAuthToken(callbackToken))) {
        await handleVerification(callbackToken, callbackRefreshToken);
        return;
      }

      if (callbackError) {
        setError(normalizeAuthErrorMessage(callbackError));
      }
    };

    initializeVerification();
  }, [token, refreshToken, authCode, initialError]);

  const completeVerification = async (user: any) => {
    const userMetadata = user.user_metadata || {};
    const role = userMetadata.role || 'client';
    const fullName = userMetadata.full_name || '';

    const { error: insertError } = await supabase
      .from('app_users')
      .insert({
        user_id: user.id,
        email: user.email,
        full_name: fullName,
        role,
      })
      .select()
      .single();

    if (insertError && insertError.code !== '23505') {
      console.warn('Failed to create app_users entry:', insertError);
    }

    setSuccess(true);
    setTimeout(() => {
      onVerificationSuccess();
    }, 2000);
  };

  const handleVerification = async (verificationToken: string, providedRefreshToken?: string | null) => {
    if (!verificationToken) {
      setError('No verification token provided');
      return;
    }

    const inputPayload = extractAuthPayloadFromInput(verificationToken);
    const cleanToken = cleanAuthToken(inputPayload.token || verificationToken);
    const refreshTokenFromInput = inputPayload.refreshToken || providedRefreshToken || null;

    setVerifying(true);
    setError(null);

    try {
      if (isOtpCode(cleanToken)) {
        throw new Error('This verification code needs your email address. Please return to the registration form and enter the code there.');
      }

      if (refreshTokenFromInput) {
        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: cleanToken,
          refresh_token: refreshTokenFromInput,
        });

        if (!sessionError && sessionData?.user) {
          await completeVerification(sessionData.user);
          return;
        }
      }

      // Method 1: Try verifyOtp (for OTP tokens)
      const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: cleanToken,
        type: 'signup'
      });

      if (!verifyError && verifyData?.user) {
        await completeVerification(verifyData.user);
        return;
      }

      // Method 2: Try setSession (for JWT access tokens)
      if (!isJwtLikeToken(cleanToken)) {
        throw new Error(verifyError?.message || 'Invalid or expired verification token');
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: cleanToken,
        refresh_token: ''
      });

      if (!sessionError && sessionData?.user) {
        await completeVerification(sessionData.user);
        return;
      }

      // If both methods failed, throw error
      throw new Error(sessionError?.message || verifyError?.message || 'Invalid or expired verification token');
      
    } catch (err: any) {
      console.error('Verification error:', err);
      setError(normalizeAuthErrorMessage(err.message));
    } finally {
      setVerifying(false);
    }
  };

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualToken.trim()) {
      setError('Please enter a verification token');
      return;
    }
    handleVerification(manualToken.trim());
  };

  if (success) {
    return (
      <div className="min-h-screen p-8">
        {/* Background overlay */}
        <div className="absolute inset-0 bg-black/20"></div>
        
        {/* Glassmorphism shine effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-primary-100/50 to-primary-200/50 pointer-events-none"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/25 to-white/35 pointer-events-none"></div>
        
        {/* Logo and City Seal */}
        <div className="mb-6 flex justify-center items-center space-x-4 relative z-10">
          <div className="glass rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl p-2">
            <img src="/logo.png" alt="RIDEHUB Logo" className="max-w-full max-h-12 object-contain" />
          </div>
          <div className="glass rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl p-2">
            <img src="/Catbalogan_City_Seal.png" alt="Catbalogan City Seal" className="max-w-full max-h-12 object-contain" />
          </div>
        </div>
        
        <div className="mb-8 flex justify-center relative z-10">
          <div className="w-32 h-32 glass rounded-2xl flex items-center justify-center">
            <svg className="w-16 h-16 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-4 mb-4 relative z-10 shadow-lg">
          <h1 className="text-4xl font-bold text-gray-900 text-center">Email Verified!</h1>
        </div>
        <p className="text-white mb-6 relative z-10 drop-shadow-md">Your account has been successfully verified. Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8">
      {/* Background overlay */}
      <div className="absolute inset-0 bg-black/20"></div>
      
      {/* Glassmorphism shine effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-primary-100/50 to-primary-200/50 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/25 to-white/35 pointer-events-none"></div>
      
      {/* Back Button */}
      <button
        onClick={onBack}
        className="absolute top-4 left-4 text-white/80 hover:text-white glass-button rounded-full w-10 h-10 flex items-center justify-center z-10"
      >
        ←
      </button>

      {/* Logo and City Seal */}
      <div className="mb-6 flex justify-center items-center space-x-4 relative z-10">
        <div className="glass rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl p-2">
          <img src="/logo.png" alt="RIDEHUB Logo" className="max-w-full max-h-12 object-contain" />
        </div>
        <div className="glass rounded-2xl flex items-center justify-center overflow-hidden shadow-2xl p-2">
          <img src="/Catbalogan_City_Seal.png" alt="Catbalogan City Seal" className="max-w-full max-h-12 object-contain" />
        </div>
      </div>

      {/* Illustration */}
      <div className="mb-8 flex justify-center relative z-10">
        <div className="w-32 h-32 glass rounded-2xl flex items-center justify-center overflow-hidden">
          <svg className="w-16 h-16 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      </div>

      {/* Title */}
      <h1 className="text-4xl font-bold text-gray-800 mb-4">
        Verify Your Email
      </h1>
      <p className="text-gray-600 mb-8">
        Please verify your email address to complete your registration
      </p>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* Manual Token Entry */}
      <form onSubmit={handleManualTokenSubmit} className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2 text-left">
            Enter Verification Token or Link
          </label>
          <textarea
            rows={4}
            placeholder="Paste your verification token or full verification link here"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            disabled={verifying}
          />
          <p className="text-xs text-gray-500 mt-2 text-left">
            Copy the token from the email, or paste the full confirmation link and we will extract the token for you.
          </p>
        </div>

        <button
          type="submit"
          disabled={verifying || !manualToken.trim()}
          className="w-full bg-blue-600 text-white text-lg font-semibold py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors duration-200 focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-60"
        >
          {verifying ? 'Verifying...' : 'Verify Email'}
        </button>
      </form>

      {/* Instructions */}
      <div className="text-left bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <h3 className="font-semibold text-blue-900 mb-2">How to verify:</h3>
        <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
          <li>Check your email inbox for the confirmation email</li>
          <li>Click the confirmation link in the email, or copy the token from it</li>
          <li>Paste the token or full confirmation link in the field above</li>
          <li>Click "Verify Email" to complete your registration</li>
        </ol>
      </div>

      {/* Resend Email */}
      <div className="text-center">
        <button
          onClick={onBack}
          className="text-gray-600 hover:text-gray-700 text-sm"
        >
          Back to Login
        </button>
      </div>
    </div>
  );
}
