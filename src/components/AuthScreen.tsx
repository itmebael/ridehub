import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeAuthErrorMessage } from '../lib/authTokens';
import {
  DEFAULT_EMAIL_COOLDOWN_SECONDS,
  formatCooldownDuration,
  getEmailCooldownMessage,
  getEmailCooldownRemaining,
  isEmailRateLimitMessage,
  parseEmailCooldownSeconds,
  setEmailCooldown,
} from '../lib/emailCooldown';
import {
  REGISTER_ID_DOCUMENT_BUCKETS,
  REGISTER_PROFILE_IMAGE_BUCKETS,
  uploadFileWithBucketFallback,
} from '../lib/storageBuckets';

interface AuthScreenProps {
  userType: 'client' | 'owner' | 'admin' | null;
  onLoginSuccess: () => void;
  onResetPassword: () => void;
  onBack: () => void;
}

function TermsAcceptanceBlock({
  variant,
  accepted,
  onAcceptedChange,
  checkboxDisabled,
}: {
  variant: 'login' | 'register';
  accepted: boolean;
  onAcceptedChange: (next: boolean) => void;
  checkboxDisabled?: boolean;
}) {
  const intro =
    variant === 'login'
      ? 'By signing in, you agree to the following:'
      : 'By creating an account, you agree to the following:';

  return (
    <div className="rounded-[22px] border border-[#e8d5c8] bg-[#fff9f4] p-4">
      <h2 className="text-sm font-bold text-[#2a1c16]">Terms &amp; Conditions</h2>
      <p className="mt-1 text-xs text-[#6f5d51]">{intro}</p>
      <div className="mt-3 max-h-36 overflow-y-auto rounded-xl border border-[#f0e0d4] bg-white/90 p-3 text-xs leading-relaxed text-[#4f3b30] space-y-2">
        <p>
          <strong>Service.</strong> RIDEHUB connects renters, vehicle owners, and city operators. Listings, bookings, and
          payments are facilitated through the platform; rental relationships are between users and owners unless stated
          otherwise.
        </p>
        <p>
          <strong>Account &amp; accuracy.</strong> You must provide accurate information, keep credentials secure, and
          use one account per role as intended. We may suspend access for misuse, fraud, or violations of these terms or
          applicable law.
        </p>
        <p>
          <strong>Risk &amp; liability.</strong> Vehicle condition, insurance, traffic rules, and damages are your
          responsibility as renter or owner. The platform does not insure vehicles or cover losses from rentals.
        </p>
        <p>
          <strong>Data &amp; communications.</strong> You consent to operational emails, notifications, and processing
          of data needed to run the service, subject to our privacy practices and local rules.
        </p>
        <p>
          <strong>Changes.</strong> We may update these terms; continued use after notice means you accept the updated
          terms where allowed by law.
        </p>
      </div>
      <label
        className={`mt-3 flex cursor-pointer items-start gap-3 select-none ${
          checkboxDisabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#c9b8a8] text-[#f56b2d] focus:ring-[#f56b2d] disabled:cursor-not-allowed"
          checked={accepted}
          disabled={checkboxDisabled}
          onChange={(e) => onAcceptedChange(e.target.checked)}
        />
        <span className="text-sm font-medium text-[#4f3b30]">
          I have read and agree to the Terms &amp; Conditions above.
        </span>
      </label>
    </div>
  );
}

export default function AuthScreen({
  userType,
  onLoginSuccess,
  onResetPassword,
  onBack,
}: AuthScreenProps) {
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginTermsAccepted, setLoginTermsAccepted] = useState(false);
  const [registerTermsAccepted, setRegisterTermsAccepted] = useState(false);

  const [registerData, setRegisterData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    token: '',
    phone: '',
    address: '',
    barangay: '',
    city: '',
  });
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerInfo, setRegisterInfo] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [signupCooldown, setSignupCooldown] = useState(0);

  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);

  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);

  const canRegister = userType !== 'admin';
  const accessLabel =
    userType === 'owner'
      ? 'Owner Access'
      : userType === 'admin'
        ? 'Administrator Access'
        : userType === 'client'
          ? 'Renter Access'
          : 'Rental Access';

  const introCopy =
    userType === 'owner'
      ? 'Sign in to manage your vehicles, Rentals, and rental availability.'
      : userType === 'admin'
        ? 'Use the admin portal to review users, listings, and city operations.'
        : 'Sign in or create an account to start rental trusted rides in Catbalogan.';

  const inputClassName = (disabled = false) =>
    `entry-input w-full ${disabled ? 'cursor-not-allowed opacity-60' : ''}`;

  React.useEffect(() => {
    const updateCooldown = () => {
      setSignupCooldown(getEmailCooldownRemaining('signup', registerData.email));
    };

    updateCooldown();

    if (!registerData.email.trim()) {
      return;
    }

    const intervalId = window.setInterval(updateCooldown, 1000);
    return () => window.clearInterval(intervalId);
  }, [registerData.email]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!loginTermsAccepted) {
      setLoginError('Please read and accept the Terms and Conditions to continue.');
      return;
    }
    setLoginSubmitting(true);

    try {
      if (userType === 'admin') {
        const adminEmail = 'catbalogancity@gmail.com';
        const adminPass = 'catbalogancitytourism2026';
        if (loginEmail === adminEmail && loginPassword === adminPass) {
          onLoginSuccess();
          return;
        }
        throw new Error('Invalid admin credentials');
      }

      if (loginEmail === 'catbalogancity@gmail.com' && loginPassword === 'catbalogancitytourism2026') {
        try {
          window.localStorage.setItem('loginAs', 'admin');
          window.localStorage.setItem('adminEmailOverride', loginEmail);

          const adminUserId = 'admin-catbalogan-city';
          const { error: upsertError } = await supabase.from('app_users').upsert(
            {
              user_id: adminUserId,
              email: loginEmail,
              full_name: 'Catbalogan City Admin',
              role: 'admin',
            },
            {
              onConflict: 'user_id',
              ignoreDuplicates: false,
            }
          );

          if (upsertError) {
            console.warn('Failed to create admin user in app_users:', upsertError);
          }
        } catch {}

        onLoginSuccess();
        return;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });
      if (signInError) throw signInError;

      const authUser = signInData.user;
      if (!authUser) throw new Error('Login failed.');

      let effectiveRole: 'client' | 'owner' | 'admin' | undefined;

      try {
        let profile = null;
        let profileError = null;
        let status = null;

        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const result = await supabase
              .from('app_users')
              .select('role')
              .eq('user_id', authUser.id)
              .maybeSingle();

            profile = result.data;
            profileError = result.error;
            status = result.status;

            if (profile) {
              break;
            }

            if (profileError && (status === 406 || profileError.code === 'PGRST116')) {
              const meta = (authUser.user_metadata || {}) as any;
              const metaRole = (meta.role === 'owner' ? 'owner' : 'client') as 'client' | 'owner';
              const fullName = meta.full_name || authUser.email?.split('@')[0] || 'User';

              const { error: upsertErr } = await supabase.from('app_users').upsert(
                {
                  user_id: authUser.id,
                  email: authUser.email,
                  full_name: fullName,
                  role: metaRole,
                  updated_at: new Date().toISOString(),
                },
                {
                  onConflict: 'user_id',
                  ignoreDuplicates: false,
                }
              );

              if (upsertErr) {
                console.warn('Upsert failed, trying insert:', upsertErr);
                const { error: insertErr } = await supabase.from('app_users').insert({
                  user_id: authUser.id,
                  email: authUser.email,
                  full_name: fullName,
                  role: metaRole,
                });

                if (insertErr) {
                  console.warn('Insert also failed:', insertErr);
                  await new Promise((resolve) => setTimeout(resolve, 200));
                  continue;
                }
              }

              continue;
            }

            break;
          } catch (innerErr: any) {
            console.warn('Profile fetch attempt failed:', attempt, innerErr);
            if (attempt === 2) {
              profileError = innerErr;
            }
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        if (profile) {
          effectiveRole = profile.role;
        } else if (profileError) {
          console.warn('Failed to fetch or create profile:', profileError);
          const meta = (authUser.user_metadata || {}) as any;
          effectiveRole = meta.role === 'owner' ? 'owner' : 'client';
        } else {
          effectiveRole = 'client';
        }
      } catch (err: any) {
        console.warn('Profile handling failed:', err);
        const meta = (authUser.user_metadata || {}) as any;
        effectiveRole = meta.role === 'owner' ? 'owner' : 'client';
      }

      if (userType && effectiveRole !== userType) {
        await supabase.auth.signOut();
        throw new Error(`Access denied: ${userType} role required, but you are ${effectiveRole || 'unknown'}.`);
      }

      if (effectiveRole !== 'admin') {
        try {
          window.localStorage.removeItem('loginAs');
          window.localStorage.removeItem('adminEmailOverride');
        } catch {}
      }

      onLoginSuccess();
    } catch (err: any) {
      setLoginError(err.message || 'Login failed.');
    } finally {
      setLoginSubmitting(false);
    }
  };

  const handleRegisterInputChange = (field: string, value: string) => {
    setRegisterData((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(null);
    setRegisterInfo(null);

    if (!registerTermsAccepted) {
      setRegisterError('Please read and accept the Terms and Conditions to create your account.');
      return;
    }

    if (!registerData.email || !registerData.password || registerData.password !== registerData.confirmPassword) {
      setRegisterError('Please enter a valid email and matching passwords.');
      return;
    }

    const role: 'client' | 'owner' = userType === 'owner' ? 'owner' : 'client';

    if (role === 'client' && !idFile) {
      setRegisterError('Please upload a valid ID document.');
      return;
    }

    try {
      setRegisterSubmitting(true);
      let nextPendingUser = pendingUser;

      const { data: existingUser, error: checkError } = await supabase
        .from('app_users')
        .select('email')
        .eq('email', registerData.email)
        .single();

      if (existingUser && !checkError) {
        throw new Error('An account with this email already exists. Please try logging in instead.');
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: registerData.email,
        password: registerData.password,
        options: {
          data: { full_name: registerData.name, role },
        },
      });

      if (signUpError) {
        throw signUpError;
      }

      if (!signUpData.user) {
        throw new Error('Failed to create your account. Please try again.');
      }

      if (!signUpData.session) {
        throw new Error(
          'Email confirmation is still enabled in Supabase. Disable email confirmation in Authentication settings to allow direct registration without a token.'
        );
      }

      nextPendingUser = signUpData.user;
      setPendingUser(nextPendingUser);

      if (nextPendingUser) {
        const userId = nextPendingUser.id;

        let idDocumentUrl = null;
        if (idFile && role === 'client') {
          const fileExt = idFile.name.split('.').pop();
          const filePath = `id-documents/${userId}_id.${fileExt}`;
          const uploadResult = await uploadFileWithBucketFallback({
            buckets: REGISTER_ID_DOCUMENT_BUCKETS,
            path: filePath,
            file: idFile,
            upsert: true,
          });

          idDocumentUrl = uploadResult.publicUrl;
        }

        let profileImageUrl = null;
        if (profileFile && role === 'client') {
          const fileExt = profileFile.name.split('.').pop();
          const filePath = `profile-images/${userId}_profile.${fileExt}`;
          const uploadResult = await uploadFileWithBucketFallback({
            buckets: REGISTER_PROFILE_IMAGE_BUCKETS,
            path: filePath,
            file: profileFile,
            upsert: true,
          });

          profileImageUrl = uploadResult.publicUrl;
        }

        const { error: profileError } = await supabase.from('app_users').insert({
          user_id: userId,
          email: registerData.email,
          full_name: registerData.name,
          role,
          is_verified: false,
          phone: registerData.phone || null,
          address: registerData.address || null,
          barangay: registerData.barangay || null,
          city: registerData.city || null,
          id_document_url: idDocumentUrl,
          profile_image_url: profileImageUrl,
        });

        if (profileError) throw profileError;

        try {
          await supabase.auth.signOut();
        } catch {}

        setRegisterInfo(
          role === 'client'
            ? 'Account created successfully. You can log in, but you must wait for admin approval before you can submit rental requests.'
            : 'Account created successfully. You can now log in.'
        );
        setActiveTab('login');
        setRegisterData({
          name: '',
          email: '',
          password: '',
          confirmPassword: '',
          token: '',
          phone: '',
          address: '',
          barangay: '',
          city: '',
        });
        setIdFile(null);
        setIdPreview(null);
        setProfileFile(null);
        setProfilePreview(null);
        setPendingUser(null);
        setRegisterTermsAccepted(false);
      }
    } catch (err: any) {
      setRegisterError(normalizeAuthErrorMessage(err.message || 'Registration failed.'));
    } finally {
      setRegisterSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    if (!pendingUser || !registerData.email) return;

    try {
      setRegisterSubmitting(true);
      setRegisterError(null);
      setRegisterInfo(null);

      const remainingSignupCooldown = getEmailCooldownRemaining('signup', registerData.email);

      if (remainingSignupCooldown > 0) {
        throw new Error(getEmailCooldownMessage(remainingSignupCooldown, 'verification email'));
      }

      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: registerData.email,
        options: {
          emailRedirectTo: `${window.location.origin}/?type=signup`,
        },
      });

      if (resendError) {
        if (isEmailRateLimitMessage(resendError.message)) {
          const cooldownSeconds = parseEmailCooldownSeconds(
            resendError.message,
            DEFAULT_EMAIL_COOLDOWN_SECONDS
          );
          setEmailCooldown('signup', registerData.email, cooldownSeconds);
          setSignupCooldown(cooldownSeconds);
          throw new Error(getEmailCooldownMessage(cooldownSeconds, 'verification email'));
        }
        throw resendError;
      }

      setEmailCooldown('signup', registerData.email, DEFAULT_EMAIL_COOLDOWN_SECONDS);
      setSignupCooldown(DEFAULT_EMAIL_COOLDOWN_SECONDS);
      setRegisterInfo(
        `A new verification email has been sent to ${registerData.email}. Paste the token or the full confirmation link from that email below to finish your registration. You can request another email again in ${formatCooldownDuration(DEFAULT_EMAIL_COOLDOWN_SECONDS)}.`
      );
    } catch (err: any) {
      console.error('Resend email error:', err);
      setRegisterError(
        err.message ||
          'Failed to resend email. Make sure email confirmation is enabled in Supabase Dashboard > Authentication > Settings.'
      );
    } finally {
      setRegisterSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <button
            onClick={onBack}
            className="entry-link-button inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-[#fff7f0]"
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
              <p className="text-lg font-black tracking-tight text-white">RIDEHUB</p>
              <p className="text-sm text-white/85">City of Catbalogan, Samar</p>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-3xl">
          <div className="relative overflow-hidden rounded-[34px] px-4 pt-6 sm:px-6">
            <div className="absolute inset-x-[18%] top-[8%] h-[56%] rounded-full bg-[radial-gradient(circle,rgba(255,208,102,0.78)_0%,rgba(255,208,102,0.26)_46%,rgba(255,208,102,0)_76%)] blur-3xl" />
            <div className="absolute right-[10%] top-[16%] h-28 w-28 rounded-full bg-[#ffb37b]/40 blur-3xl" />
            <div className="absolute bottom-[16%] left-[24%] h-10 w-[48%] rounded-full bg-[rgba(76,37,17,0.18)] blur-2xl" />

            <img
              src="/car.png"
              alt="RIDEHUB vehicle"
              className="relative z-10 mx-auto w-full max-w-[520px] drop-shadow-[0_26px_34px_rgba(74,38,18,0.28)]"
            />
          </div>

          <section className="entry-panel mt-4 rounded-[34px] p-5 sm:p-8">
            <div className="text-center">
              <span className="entry-chip">{accessLabel}</span>
              <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-[#241813] sm:text-4xl">
                {activeTab === 'login' ? 'Login to your account' : 'Create your account'}
              </h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[#6f5d51] sm:text-base">
                {introCopy}
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <div className="inline-flex rounded-full bg-[#fff3e8]/90 p-1 shadow-[0_16px_30px_rgba(145,68,27,0.12)]">
                <button
                  onClick={() => {
                    setActiveTab('login');
                    setRegisterTermsAccepted(false);
                  }}
                  className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                    activeTab === 'login'
                      ? 'bg-gradient-to-r from-[#ff9448] to-[#f56b2d] text-white shadow-[0_14px_32px_rgba(245,107,45,0.28)]'
                      : 'text-[#7a4f33]'
                  }`}
                >
                  Login
                </button>
                {canRegister && (
                  <button
                    onClick={() => {
                      setActiveTab('register');
                      setLoginTermsAccepted(false);
                      setRegisterTermsAccepted(false);
                    }}
                    className={`rounded-full px-5 py-2.5 text-sm font-semibold transition-all ${
                      activeTab === 'register'
                        ? 'bg-gradient-to-r from-[#ff9448] to-[#f56b2d] text-white shadow-[0_14px_32px_rgba(245,107,45,0.28)]'
                        : 'text-[#7a4f33]'
                    }`}
                  >
                    Register
                  </button>
                )}
              </div>
            </div>

            {activeTab === 'login' ? (
              <div className="mt-7">
                {loginError && (
                  <div className="mb-5 rounded-[22px] border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleLogin} className="space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">
                      {userType === 'admin' ? 'Admin email' : 'Email address'}
                    </label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className={inputClassName()}
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">
                      {userType === 'admin' ? 'Admin password' : 'Password'}
                    </label>
                    <div className="relative">
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        placeholder="Enter your password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className={`${inputClassName()} pr-12`}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b675a] transition-colors hover:text-[#2a1c16]"
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                      >
                        {showLoginPassword ? (
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3l18 18M10.58 10.58a3 3 0 104.24 4.24M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 4.5 9 7 0 1.36-1.18 3.12-3.1 4.57M6.23 6.23C3.96 7.82 2.5 9.93 2.5 12c0 2.5 4 7 9.5 7 1.72 0 3.28-.44 4.63-1.12" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.5 12S6.5 5 12 5s9.5 7 9.5 7-4 7-9.5 7S2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <TermsAcceptanceBlock
                    variant="login"
                    accepted={loginTermsAccepted}
                    onAcceptedChange={setLoginTermsAccepted}
                  />

                  <button
                    type="submit"
                    disabled={loginSubmitting || !loginTermsAccepted}
                    className="entry-cta w-full rounded-[22px] px-6 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loginSubmitting ? 'Signing in...' : 'Login'}
                  </button>
                </form>

                {userType !== 'admin' && (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-sm">
                    <button
                      type="button"
                      onClick={onResetPassword}
                      className="entry-link-button rounded-full px-4 py-2 font-semibold text-white"
                    >
                      Forgot Password?
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('register');
                        setLoginTermsAccepted(false);
                        setRegisterTermsAccepted(false);
                      }}
                      className="entry-orange-outline rounded-full px-4 py-2 font-semibold"
                    >
                      Create Account
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-7">
                {registerError && (
                  <div className="mb-5 rounded-[22px] border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
                    {registerError}
                  </div>
                )}
                {registerInfo && (
                  <div className="mb-5 rounded-[22px] border border-blue-200/70 bg-blue-50/80 px-4 py-3 text-sm text-blue-700">
                    {registerInfo}
                  </div>
                )}

                <form onSubmit={handleRegister} className="space-y-6">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Full name</label>
                      <input
                        type="text"
                        placeholder="Your full name"
                        value={registerData.name}
                        onChange={(e) => handleRegisterInputChange('name', e.target.value)}
                        disabled={emailSent}
                        className={inputClassName(emailSent)}
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Email address</label>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={registerData.email}
                        onChange={(e) => handleRegisterInputChange('email', e.target.value)}
                        disabled={emailSent}
                        className={inputClassName(emailSent)}
                        required
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Password</label>
                      <div className="relative">
                        <input
                          type={showRegisterPassword ? 'text' : 'password'}
                          placeholder="Create a password"
                          value={registerData.password}
                          onChange={(e) => handleRegisterInputChange('password', e.target.value)}
                          disabled={emailSent}
                          className={`${inputClassName(emailSent)} pr-12`}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                          disabled={emailSent}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b675a] transition-colors hover:text-[#2a1c16] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={showRegisterPassword ? 'Hide password' : 'Show password'}
                        >
                          {showRegisterPassword ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3l18 18M10.58 10.58a3 3 0 104.24 4.24M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 4.5 9 7 0 1.36-1.18 3.12-3.1 4.57M6.23 6.23C3.96 7.82 2.5 9.93 2.5 12c0 2.5 4 7 9.5 7 1.72 0 3.28-.44 4.63-1.12" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.5 12S6.5 5 12 5s9.5 7 9.5 7-4 7-9.5 7S2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Confirm password</label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? 'text' : 'password'}
                          placeholder="Repeat your password"
                          value={registerData.confirmPassword}
                          onChange={(e) => handleRegisterInputChange('confirmPassword', e.target.value)}
                          disabled={emailSent}
                          className={`${inputClassName(emailSent)} pr-12`}
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          disabled={emailSent}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7b675a] transition-colors hover:text-[#2a1c16] disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                          {showConfirmPassword ? (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3l18 18M10.58 10.58a3 3 0 104.24 4.24M9.88 5.09A9.77 9.77 0 0112 5c5 0 9 4.5 9 7 0 1.36-1.18 3.12-3.1 4.57M6.23 6.23C3.96 7.82 2.5 9.93 2.5 12c0 2.5 4 7 9.5 7 1.72 0 3.28-.44 4.63-1.12" />
                            </svg>
                          ) : (
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.5 12S6.5 5 12 5s9.5 7 9.5 7-4 7-9.5 7S2.5 12 2.5 12zm9.5 3a3 3 0 100-6 3 3 0 000 6z" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {userType === 'client' && (
                      <>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Phone number</label>
                          <input
                            type="tel"
                            placeholder="09XXXXXXXXX"
                            value={registerData.phone}
                            onChange={(e) => handleRegisterInputChange('phone', e.target.value)}
                            disabled={emailSent}
                            className={inputClassName(emailSent)}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Address</label>
                          <input
                            type="text"
                            placeholder="Street or landmark"
                            value={registerData.address}
                            onChange={(e) => handleRegisterInputChange('address', e.target.value)}
                            disabled={emailSent}
                            className={inputClassName(emailSent)}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">Barangay</label>
                          <input
                            type="text"
                            placeholder="Barangay"
                            value={registerData.barangay}
                            onChange={(e) => handleRegisterInputChange('barangay', e.target.value)}
                            disabled={emailSent}
                            className={inputClassName(emailSent)}
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-[#4f3b30]">City</label>
                          <input
                            type="text"
                            placeholder="City"
                            value={registerData.city}
                            onChange={(e) => handleRegisterInputChange('city', e.target.value)}
                            disabled={emailSent}
                            className={inputClassName(emailSent)}
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {userType === 'client' && (
                    <div className="grid gap-5 md:grid-cols-2">
                      <div>
                        <p className="mb-2 text-sm font-semibold text-[#4f3b30]">Valid ID</p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 5 * 1024 * 1024) {
                                alert('Image size must be less than 5MB');
                                return;
                              }
                              setIdFile(file);
                              const reader = new FileReader();
                              reader.onloadend = () => setIdPreview(reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden"
                          id="id-document-upload"
                        />
                        <label
                          htmlFor="id-document-upload"
                          className="entry-soft-panel block cursor-pointer rounded-[24px] border border-dashed border-white/70 p-4 text-center transition-colors hover:border-[#ffae72]"
                        >
                          {idPreview ? (
                            <div className="space-y-3">
                              <img src={idPreview} alt="ID Preview" className="mx-auto h-28 w-40 rounded-[18px] object-cover" />
                              <p className="text-sm font-semibold text-[#4d3a2f]">Change uploaded ID</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1e5] text-[#f56b2d]">
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
                                </svg>
                              </div>
                              <p className="text-sm font-semibold text-[#4d3a2f]">Upload valid ID</p>
                              <p className="text-xs text-[#7c675a]">Required for renter verification</p>
                            </div>
                          )}
                        </label>
                      </div>

                      <div>
                        <p className="mb-2 text-sm font-semibold text-[#4f3b30]">Profile photo</p>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 5 * 1024 * 1024) {
                                alert('Image size must be less than 5MB');
                                return;
                              }
                              setProfileFile(file);
                              const reader = new FileReader();
                              reader.onloadend = () => setProfilePreview(reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden"
                          id="profile-image-upload"
                        />
                        <label
                          htmlFor="profile-image-upload"
                          className="entry-soft-panel block cursor-pointer rounded-[24px] border border-dashed border-white/70 p-4 text-center transition-colors hover:border-[#ffae72]"
                        >
                          {profilePreview ? (
                            <div className="space-y-3">
                              <img src={profilePreview} alt="Profile Preview" className="mx-auto h-28 w-28 rounded-full object-cover" />
                              <p className="text-sm font-semibold text-[#4d3a2f]">Change profile photo</p>
                            </div>
                          ) : (
                            <div className="space-y-3">
                              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fff1e5] text-[#f56b2d]">
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 1114 0H5z" />
                                </svg>
                              </div>
                              <p className="text-sm font-semibold text-[#4d3a2f]">Add profile photo</p>
                              <p className="text-xs text-[#7c675a]">Optional but recommended</p>
                            </div>
                          )}
                        </label>
                      </div>
                    </div>
                  )}

                  <TermsAcceptanceBlock
                    variant="register"
                    accepted={registerTermsAccepted}
                    onAcceptedChange={setRegisterTermsAccepted}
                    checkboxDisabled={emailSent}
                  />

                  <button
                    type="submit"
                    disabled={registerSubmitting || !registerTermsAccepted || emailSent}
                    className="entry-cta w-full rounded-[22px] px-6 py-4 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {registerSubmitting ? 'Creating account...' : 'Create Account'}
                  </button>
                </form>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

