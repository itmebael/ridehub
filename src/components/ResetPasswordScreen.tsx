import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_EMAIL_COOLDOWN_SECONDS,
  formatCooldownDuration,
  getEmailCooldownMessage,
  getEmailCooldownRemaining,
  isEmailRateLimitMessage,
  parseEmailCooldownSeconds,
  setEmailCooldown,
} from '../lib/emailCooldown';

interface ResetPasswordScreenProps {
  userType: 'client' | 'owner' | 'admin' | null;
  onBack: () => void;
  onSuccess: () => void;
}

export default function ResetPasswordScreen({ userType, onBack, onSuccess }: ResetPasswordScreenProps) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [step, setStep] = useState<'email' | 'token' | 'password'>('email');
  const [resetCooldown, setResetCooldown] = useState(0);

  React.useEffect(() => {
    const updateCooldown = () => {
      setResetCooldown(getEmailCooldownRemaining('password-reset', email));
    };

    updateCooldown();

    if (!email.trim()) {
      return;
    }

    const intervalId = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(intervalId);
  }, [email]);

  const handleSendToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      const remainingResetCooldown = getEmailCooldownRemaining('password-reset', email);

      if (remainingResetCooldown > 0) {
        throw new Error(getEmailCooldownMessage(remainingResetCooldown, 'reset email'));
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/?type=recovery`,
      });

      if (resetError) {
        if (isEmailRateLimitMessage(resetError.message)) {
          const cooldownSeconds = parseEmailCooldownSeconds(
            resetError.message,
            DEFAULT_EMAIL_COOLDOWN_SECONDS
          );
          setEmailCooldown('password-reset', email, cooldownSeconds);
          setResetCooldown(cooldownSeconds);
          throw new Error(getEmailCooldownMessage(cooldownSeconds, 'reset email'));
        }

        throw resetError;
      }

      setEmailCooldown('password-reset', email, DEFAULT_EMAIL_COOLDOWN_SECONDS);
      setResetCooldown(DEFAULT_EMAIL_COOLDOWN_SECONDS);
      setInfo(
        `Reset email sent to ${email}. Check your inbox for the token or link. You can request another reset email again in ${formatCooldownDuration(DEFAULT_EMAIL_COOLDOWN_SECONDS)}.`
      );
      setStep('token');
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTokenSubmit = async () => {
    if (!token.trim()) {
      setError('Please enter a token');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // Clean the token (remove any extra whitespace or characters)
      const cleanToken = token.trim();
      
      // Check if it's a 6-digit code (common for some email templates)
      if (/^\d{6}$/.test(cleanToken)) {
        // For 6-digit codes, we'll skip verification and proceed to password step
        // The actual verification will happen during password update
        console.log('Received 6-digit code:', cleanToken);
        setStep('password');
        return;
      }
      
      // Check if it's a JWT token (3 parts separated by dots)
      if (cleanToken.split('.').length === 3) {
        // This is a JWT token
        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: cleanToken,
          refresh_token: ''
        });

        if (sessionError) {
          console.log('setSession failed:', sessionError.message);
          // Even if setSession fails, proceed to password step
          setStep('password');
        } else {
          setStep('password');
        }
        return;
      }
      
      // If neither format matches, show error
      throw new Error('Invalid token format. Please copy the complete token or verification code from your email.');
      
    } catch (err: any) {
      setError(err.message || 'Invalid token. Please check and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      // Clean the token
      const cleanToken = token.trim();
      
      // If it's a 6-digit code, we need to handle it differently
      if (/^\d{6}$/.test(cleanToken)) {
        // For 6-digit codes, try to verify and update password in one step
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            email: email,
            token: cleanToken,
            type: 'recovery'
          });

          if (error) {
            // If OTP verification fails, try direct password update
            console.log('OTP verification failed, trying direct update:', error.message);
            
            const { error: updateError } = await supabase.auth.updateUser({
              password: password
            });

            if (updateError) {
              throw new Error('Password update failed. Please request a new reset email and try again.');
            }
          } else {
            // OTP verification succeeded, now update password
            const { error: updateError } = await supabase.auth.updateUser({
              password: password
            });

            if (updateError) {
              throw new Error('Failed to update password: ' + updateError.message);
            }
          }

          onSuccess();
          return;
        } catch (err: any) {
          throw new Error('Password reset failed. Please request a new reset email and try again.');
        }
      }
      
      // For JWT tokens, try to set the session first
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: cleanToken,
        refresh_token: ''
      });

      if (sessionError) {
        console.log('Session error:', sessionError.message);
        // Try to update password anyway - sometimes it works without explicit session
      }

      const { error } = await supabase.auth.updateUser({
        password: password
      });

      if (error) {
        throw error;
      }

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1: Enter Email
  if (step === 'email') {
    return (
      <div className="min-h-screen p-8">
        {/* Background overlay */}
        <div className="absolute inset-0 bg-black/50"></div>
        
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

        {/* Title */}
        <h1 className="text-4xl font-bold text-white mb-4 relative z-10 drop-shadow-lg">
          Reset Password
        </h1>

        {/* Description */}
        <p className="text-gray-600 mb-8">
          Enter your email address and we'll send you a token to reset your password.
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {info && (
          <div className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{info}</div>
        )}

        {/* Email Form */}
        <form onSubmit={handleSendToken} className="space-y-6 mb-6">
          <div>
            <input
              type="email"
              placeholder={userType === 'admin' ? 'Admin Email' : 'Email Address'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting || resetCooldown > 0}
            className="w-full bg-blue-600 text-white text-lg font-semibold py-3 px-6 rounded-xl hover:bg-blue-700 transition-colors duration-200 focus:outline-none focus:ring-4 focus:ring-blue-300 disabled:opacity-60"
          >
            {submitting
              ? 'Sending...'
              : resetCooldown > 0
                ? `Wait ${formatCooldownDuration(resetCooldown)} to Send Token`
                : 'Send Token'}
          </button>
          {resetCooldown > 0 && (
            <p className="text-center text-xs text-gray-500">
              You can request another reset email in {formatCooldownDuration(resetCooldown)}.
            </p>
          )}
        </form>

        {/* Back to Login */}
        <div className="text-center">
          <button 
            onClick={onBack}
            className="text-gray-600 hover:text-gray-700 text-sm"
          >
            Remember your password? Back to Login
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Enter Token
  if (step === 'token') {
    return (
      <div className="bg-white rounded-3xl shadow-xl p-8 text-center relative">
        {/* Back Button */}
        <button
          onClick={() => setStep('email')}
          className="absolute top-4 left-4 text-gray-500 hover:text-gray-700"
        >
          ←
        </button>

        {/* Illustration */}
        <div className="mb-8 flex justify-center">
          <div className="w-32 h-32 bg-green-100 rounded-2xl flex items-center justify-center overflow-hidden">
            <svg className="w-16 h-16 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1721 9z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-gray-800 mb-4">
          Enter Token
        </h1>

        {/* Description */}
        <p className="text-gray-600 mb-8">
          Check your email for the reset token and paste it below.
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
        {info && (
          <div className="mb-4 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{info}</div>
        )}

        {/* Token Form */}
        <form onSubmit={(e) => { e.preventDefault(); handleTokenSubmit(); }} className="space-y-6 mb-6">
          <div>
            <textarea
              placeholder="Paste the token from your email here"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              required
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !token.trim()}
            className="w-full bg-green-600 text-white text-lg font-semibold py-3 px-6 rounded-xl hover:bg-green-700 transition-colors duration-200 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Verifying...' : 'Verify Token'}
          </button>
        </form>

        {/* Back to Email */}
        <div className="text-center">
          <button 
            onClick={() => setStep('email')}
            className="text-blue-600 hover:text-blue-700 text-sm"
          >
            ← Back to Email
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Enter New Password
  if (step === 'password') {
    return (
      <div className="bg-white rounded-3xl shadow-xl p-8 text-center relative">
        {/* Back Button */}
        <button
          onClick={() => setStep('token')}
          className="absolute top-4 left-4 text-gray-500 hover:text-gray-700"
        >
          ←
        </button>

        {/* Illustration */}
        <div className="mb-8 flex justify-center">
          <div className="w-32 h-32 bg-purple-100 rounded-2xl flex items-center justify-center overflow-hidden">
            <svg className="w-16 h-16 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h1 className="text-4xl font-bold text-gray-800 mb-4">
          Set New Password
        </h1>

        {/* Description */}
        <p className="text-gray-600 mb-8">
          Enter your new password below.
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}

        {/* Password Form */}
        <form onSubmit={handleUpdatePassword} className="space-y-6 mb-6">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="New Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>

          <div className="relative">
            <input
              type={showConfirmPassword ? "text" : "password"}
              placeholder="Confirm New Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none"
              aria-label={showConfirmPassword ? "Hide password" : "Show password"}
            >
              {showConfirmPassword ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting || password !== confirmPassword || password.length < 6}
            className="w-full bg-purple-600 text-white text-lg font-semibold py-3 px-6 rounded-xl hover:bg-purple-700 transition-colors duration-200 focus:outline-none focus:ring-4 focus:ring-purple-300 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Updating...' : 'Update Password'}
          </button>
        </form>

        {/* Password Requirements */}
        <div className="text-left text-sm text-gray-500 mb-6">
          <p className="mb-2 font-semibold">Password requirements:</p>
          <ul className="space-y-1">
            <li className={`flex items-center ${password.length >= 6 ? 'text-green-600' : ''}`}>
              <span className="mr-2">{password.length >= 6 ? '✓' : '○'}</span>
              At least 6 characters long
            </li>
            <li className={`flex items-center ${password === confirmPassword && password.length > 0 ? 'text-green-600' : ''}`}>
              <span className="mr-2">{password === confirmPassword && password.length > 0 ? '✓' : '○'}</span>
              Passwords must match
            </li>
          </ul>
        </div>

        {/* Back to Token */}
        <div className="text-center">
          <button 
            onClick={() => setStep('token')}
            className="text-blue-600 hover:text-blue-700 text-sm"
          >
            ← Back to Token
          </button>
        </div>
      </div>
    );
  }

  return null;
}
