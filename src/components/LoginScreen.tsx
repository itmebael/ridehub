import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface LoginScreenProps {
  userType: 'client' | 'owner' | 'admin' | null;
  onCreateAccount: () => void;
  onLoginSuccess: () => void;
  onResetPassword: () => void;
  onBack: () => void;
}

export default function LoginScreen({ userType, onCreateAccount, onLoginSuccess, onResetPassword, onBack }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Hardcoded admin login (no registration for admin)
      if (userType === 'admin') {
        const adminEmail = 'catbalogancity@gmail.com';
        const adminPass = 'catbalogancitytourism2026';
        if (email === adminEmail && password === adminPass) {
          onLoginSuccess();
          return;
        } else {
          throw new Error('Invalid admin credentials');
        }
      }

      // Client/Owner via Supabase Auth
      // If admin demo credentials are used, always go to admin dashboard
      if (email === 'catbalogancity@gmail.com' && password === 'catbalogancitytourism2026') {
        try { 
          window.localStorage.setItem('loginAs', 'admin');
          window.localStorage.setItem('adminEmailOverride', email);
          
          // Create or ensure admin user exists in app_users table
          const adminUserId = 'admin-catbalogan-city';
          const { error: upsertError } = await supabase
            .from('app_users')
            .upsert({
              user_id: adminUserId,
              email: email,
              full_name: 'Catbalogan City Admin',
              role: 'admin'
            }, {
              onConflict: 'user_id',
              ignoreDuplicates: false
            });
          
          if (upsertError) {
            console.warn('Failed to create admin user in app_users:', upsertError);
          }
        } catch {}
        onLoginSuccess();
        return;
      }

      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      if (signInError) throw signInError;
      const authUser = signInData.user;
      if (!authUser) throw new Error('Login failed.');

      // Ensure a profile exists in app_users; create if missing using metadata
      let effectiveRole: 'client' | 'owner' | 'admin' | undefined;
      
      try {
        // First try to get the user from app_users with multiple fallbacks
        let profile = null;
        let profileError = null;
        let status = null;
        
        // Try multiple times in case of race conditions
        for (let attempt = 0; attempt < 3; attempt++) {
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
              // User found, break out of loop
              break;
            }
            
            // If user not found, try to create them
            if (profileError && (status === 406 || profileError.code === 'PGRST116')) {
              const meta = (authUser.user_metadata || {}) as any;
              const metaRole = (meta.role === 'owner' ? 'owner' : 'client') as 'client' | 'owner';
              const fullName = meta.full_name || authUser.email?.split('@')[0] || 'User';
              
              // Use upsert instead of insert to handle duplicates gracefully
              const { error: upsertErr } = await supabase
                .from('app_users')
                .upsert({
                  user_id: authUser.id,
                  email: authUser.email,
                  full_name: fullName,
                  role: metaRole,
                  updated_at: new Date().toISOString()
                }, {
                  onConflict: 'user_id',
                  ignoreDuplicates: false
                });
              
              if (upsertErr) {
                console.warn('Upsert failed, trying insert:', upsertErr);
                // If upsert fails, try regular insert
                const { error: insertErr } = await supabase.from('app_users').insert({
                  user_id: authUser.id,
                  email: authUser.email,
                  full_name: fullName,
                  role: metaRole
                });
                
                if (insertErr) {
                  console.warn('Insert also failed:', insertErr);
                  // If both fail, wait a bit and try again
                  await new Promise(resolve => setTimeout(resolve, 200));
                  continue;
                }
              }
              
              // After creating user, try to fetch again
              continue;
            }
            
            // If we get here, break and handle the error
            break;
            
          } catch (innerErr: any) {
            console.warn('Profile fetch attempt failed:', attempt, innerErr);
            if (attempt === 2) {
              profileError = innerErr;
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }

        // If we have a profile, use it
        if (profile) {
          effectiveRole = profile.role as 'client' | 'owner' | 'admin';
        } else {
          // If no profile after all attempts, create with default values
          const meta = (authUser.user_metadata || {}) as any;
          const defaultRole = (meta.role === 'owner' ? 'owner' : 'client') as 'client' | 'owner';
          const defaultName = meta.full_name || authUser.email?.split('@')[0] || 'User';
          
          // Final attempt to create user
          try {
            const { error: finalErr } = await supabase.from('app_users').insert({
              user_id: authUser.id,
              email: authUser.email,
              full_name: defaultName,
              role: defaultRole
            });
            
            if (!finalErr) {
              effectiveRole = defaultRole;
            } else {
              // If final insert fails, use metadata role
              effectiveRole = defaultRole;
              console.warn('Final user creation failed, using metadata role:', finalErr);
            }
          } catch (finalErr: any) {
            effectiveRole = defaultRole;
            console.warn('User creation completely failed, using default role:', finalErr);
          }
        }
        
      } catch (err: any) {
        // Ultimate fallback - use metadata or default to client
        const meta = (authUser.user_metadata || {}) as any;
        effectiveRole = (meta.role === 'owner' ? 'owner' : 'client') as 'client' | 'owner';
        console.warn('Complete failure, using fallback role from metadata:', effectiveRole, err);
      }

      // Direct role validation without RPC
      if (userType === 'owner' || userType === 'client' || userType === 'admin') {
        if (effectiveRole !== userType) {
          await supabase.auth.signOut();
          setError(`Access denied: ${userType} role required, but you are ${effectiveRole || 'unknown'}`);
          return; // Do not proceed to dashboard
        }
      }

      // If not admin, ensure any previous admin override flags are cleared
      if (effectiveRole !== 'admin') {
        try {
          window.localStorage.removeItem('loginAs');
          window.localStorage.removeItem('adminEmailOverride');
        } catch {}
      }

      onLoginSuccess();
    } catch (err: any) {
      setError(err.message || 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen p-8">
      {/* Background overlay */}
      <div className="absolute inset-0 bg-black/20"></div>
      
      {/* Glassmorphism shine effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary-50/50 via-primary-100/50 to-primary-200/50 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-t from-transparent via-white/25 to-white/35 pointer-events-none"></div>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary-200/20 to-transparent pointer-events-none"></div>
      
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
      <h1 className="text-4xl font-bold text-white mb-8 relative z-10 drop-shadow-lg">
        Login
      </h1>
      
      {error && (
        <div className="mb-4 text-sm text-red-800 glass-card rounded-lg px-3 py-2 border-red-300/50 relative z-10">{error}</div>
      )}
      
      {/* Login Form */}
      <form onSubmit={handleLogin} className="space-y-6 mb-6 relative z-10">
        <div>
          <input
            type="email"
            placeholder={userType === 'admin' ? 'Admin Email' : 'Email'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 glass-card rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 border-white/30 text-gray-900 placeholder-gray-500 transition-all"
            required
          />
        </div>
        
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            placeholder={userType === 'admin' ? 'Admin Password' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 pr-12 glass-card rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/50 border-white/30 text-gray-900 placeholder-gray-500 transition-all"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-600 hover:text-gray-900 focus:outline-none transition-colors"
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
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full glass-button text-gray-900 text-lg font-semibold py-3 px-6 rounded-xl disabled:opacity-60 relative z-10 hover:scale-105 active:scale-95"
        >
          {submitting ? 'Signing in…' : 'Login'}
        </button>
      </form>
      
      {/* Links */}
      {userType !== 'admin' && (
        <div className="space-y-4 mb-6 relative z-10">
          <button 
            onClick={onResetPassword}
            className="text-gray-700 hover:text-gray-900 text-sm font-medium transition-colors"
          >
            Forgot Password?
          </button>
          <br />
          <button 
            onClick={onCreateAccount}
            className="text-gray-700 hover:text-gray-900 text-sm font-medium transition-colors"
          >
            Create Account?
          </button>
        </div>
      )}
    </div>
  );
}
