import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface CreateAccountScreenProps {
  userType: 'client' | 'owner' | 'admin' | null;
  onBackToLogin: () => void;
  onRegistrationSuccess: () => void;
  onBack: () => void;
}

export default function CreateAccountScreen({ 
  userType, 
  onBackToLogin, 
  onRegistrationSuccess, 
  onBack 
}: CreateAccountScreenProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    token: '',
    phone: '',
    address: '',
    barangay: '',
    city: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [pendingUser, setPendingUser] = useState<any>(null);
  
  // ID upload states (only for renters)
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idPreview, setIdPreview] = useState<string | null>(null);
  
  // Profile image upload states (only for renters)
  const [profileFile, setProfileFile] = useState<File | null>(null);
  const [profilePreview, setProfilePreview] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!formData.email || !formData.password || formData.password !== formData.confirmPassword) {
      setError('Please enter a valid email and matching passwords.');
      return;
    }

    // Determine role: default to client unless explicitly owner; admin not allowed here
    const role: 'client' | 'owner' = userType === 'owner' ? 'owner' : 'client';
    
    // Validate ID for renters
    if (role === 'client') {
      if (!idFile) {
        setError('Please upload a valid ID document.');
        return;
      }
    }

    try {
      setSubmitting(true);

      // Step 1: If email not sent yet, send confirmation email
      if (!emailSent) {
        // Check if email already exists in app_users table
        const { data: existingUser, error: checkError } = await supabase
          .from('app_users')
          .select('email')
          .eq('email', formData.email)
          .single();
        
        if (existingUser && !checkError) {
          throw new Error('An account with this email already exists. Please try logging in instead.');
        }
        
        // Sign up user in auth (store role/name in metadata)
        const redirectUrl = `${window.location.origin}/?type=signup`;
        
        console.log('=== SIGNUP DEBUG ===');
        console.log('Email:', formData.email);
        console.log('Redirect URL:', redirectUrl);
        console.log('Email confirmation should be enabled in Supabase settings');
        
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: { 
            data: { full_name: formData.name, role },
            emailRedirectTo: redirectUrl
          }
        });
        
        console.log('Signup response:', {
          user: signUpData?.user?.id || 'null',
          session: signUpData?.session ? 'EXISTS (email confirmation DISABLED)' : 'null (email confirmation ENABLED)',
          emailConfirmed: signUpData?.user?.email_confirmed_at || 'not confirmed',
          error: signUpError?.message || 'none'
        });
        
        if (signUpError) {
          console.error('Signup error:', signUpError);
          throw signUpError;
        }

        if (!signUpData.user) {
          throw new Error('Failed to create user account. No user was created.');
        }

        // Check if email confirmation is enabled
        // If session exists, email confirmation is DISABLED - emails won't be sent
        if (signUpData.session) {
          console.error('❌ EMAIL CONFIRMATION IS DISABLED!');
          console.error('Session exists = emails are NOT being sent');
          throw new Error('Email confirmation is DISABLED in Supabase settings. Emails will NOT be sent. Please enable it: Go to Supabase Dashboard → Authentication → Settings → Enable email confirmations → Save. Then try registering again.');
        }

        // If no session, email should be sent
        console.log('✅ Email confirmation is ENABLED');
        console.log('✅ Confirmation email should be sent to:', formData.email);
        console.log('✅ Check email inbox and spam folder');

        // Check if user email is already confirmed (shouldn't happen but check)
        if (signUpData.user.email_confirmed_at) {
          console.warn('User email already confirmed during signup');
          // If already confirmed, proceed to create app_users entry
          const { error: insertError } = await supabase.from('app_users').insert({
            user_id: signUpData.user.id,
            email: formData.email,
            full_name: formData.name,
            role
          });
          
          if (insertError && insertError.code !== '23505') {
            throw insertError;
          }
          
          alert('Account created successfully! You can now log in.');
          onRegistrationSuccess();
          return;
        }

        // Email should be sent - store pending user data
        setPendingUser({ user: signUpData.user, role, name: formData.name, email: formData.email });
        setEmailSent(true);
        setInfo('✓ A verification email has been sent to ' + formData.email + '. Please check your email inbox and spam folder. The email contains a token that you need to paste below to complete registration. If you don\'t receive the email within 2 minutes, click "Resend Email" or check that email confirmation is enabled in Supabase settings.');
        setSubmitting(false);
        return;
      }

      // Step 2: If email sent, verify token and complete registration
      if (emailSent && formData.token.trim()) {
        if (!pendingUser) {
          throw new Error('Registration session expired. Please start over.');
        }

        console.log('Verifying token:', formData.token.substring(0, 20) + '...');

        // Clean the token
        let cleanToken = formData.token.trim();
        
        // If token looks like a URL, extract just the token part
        if (cleanToken.startsWith('http://') || cleanToken.startsWith('https://')) {
          try {
            const url = new URL(cleanToken);
            const hashParams = new URLSearchParams(url.hash.substring(1));
            cleanToken = hashParams.get('access_token') || hashParams.get('token') || 
                         url.searchParams.get('token') || 
                         url.searchParams.get('access_token') ||
                         url.pathname.split('/').pop() ||
                         cleanToken;
          } catch (e) {
            // If URL parsing fails, use token as-is
          }
        }

        // Verify the token
        let verifiedUser = null;

        console.log('=== TOKEN VERIFICATION DEBUG ===');
        console.log('Token length:', cleanToken.length);
        console.log('Token preview:', cleanToken.substring(0, 20) + '...');
        console.log('Email:', formData.email);

        // Method 1: Try verifyOtp with email and token (for OTP tokens)
        // Check if token looks like a 6-digit code
        if (/^\d{6}$/.test(cleanToken)) {
          console.log('Token appears to be 6-digit OTP');
          const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
            email: formData.email,
            token: cleanToken,
            type: 'signup'
          });

          if (!verifyError && verifyData?.user) {
            console.log('✅ OTP verification successful');
            verifiedUser = verifyData.user;
          } else {
            console.error('OTP verification failed:', verifyError?.message);
            throw new Error(verifyError?.message || 'Invalid verification code. Please check your email and try again.');
          }
        } else {
          // Method 2: Try setSession (for JWT tokens)
          console.log('Token appears to be JWT, trying setSession');
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: cleanToken,
            refresh_token: ''
          });

          if (!sessionError && sessionData?.user) {
            console.log('✅ JWT token verification successful');
            verifiedUser = sessionData.user;
          } else {
            // Method 3: Try verifyOtp with token_hash as fallback
            console.log('setSession failed, trying verifyOtp with token_hash');
            const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
              token_hash: cleanToken,
              type: 'signup'
            });

            if (!verifyError && verifyData?.user) {
              console.log('✅ Token hash verification successful');
              verifiedUser = verifyData.user;
            } else {
              console.error('All verification methods failed');
              console.error('Session error:', sessionError?.message);
              console.error('Verify error:', verifyError?.message);
              throw new Error(sessionError?.message || verifyError?.message || 'Invalid or expired verification token. Please check your email and try again. Make sure you copied the entire token.');
            }
          }
        }

        if (!verifiedUser) {
          throw new Error('Token verification failed. Please check your token and try again.');
        }

        // Verify the email matches
        if (verifiedUser.email !== formData.email) {
          throw new Error('Token email does not match registration email. Please use the token sent to ' + formData.email);
        }

        console.log('✅ Token verified successfully');
        console.log('User ID:', verifiedUser.id);
        console.log('User email:', verifiedUser.email);

        // Check if we have a session (should have one after verification)
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          console.warn('⚠️ No session after token verification, but continuing...');
        } else {
          console.log('✅ Session exists after verification');
        }

        // Upload ID and Profile for renters
        let idUrl: string | null = null;
        let profileUrl: string | null = null;
        
        if (pendingUser.role === 'client') {
          try {
            console.log('Uploading ID document...');
            
            // Upload ID
            if (idFile) {
              idUrl = await uploadFile(idFile, 'id-documents', `id-${verifiedUser.id}`);
              console.log('✅ ID uploaded:', idUrl);
            }
            
            // Upload Profile Image
            if (profileFile) {
              console.log('Uploading profile image...');
              profileUrl = await uploadFile(profileFile, 'profile-images', `profile-${verifiedUser.id}`);
              console.log('✅ Profile image uploaded:', profileUrl);
            }
          } catch (uploadErr: any) {
            console.error('Upload error:', uploadErr);
            throw new Error('Failed to upload files: ' + (uploadErr.message || 'Unknown error'));
          }
        }

        // Create app_users entry
        console.log('Creating app_users entry...');
        const { error: insertError } = await supabase.from('app_users').insert({
          user_id: verifiedUser.id,
          email: formData.email,
          full_name: formData.name,
          role: pendingUser.role
        });
        
        if (insertError) {
          console.error('Insert error:', insertError);
          if (insertError.code === '23505' && insertError.message.includes('app_users_email_key')) {
            throw new Error('An account with this email already exists. Please try logging in instead.');
          }
          if (insertError.message.includes('session') || insertError.message.includes('auth')) {
            throw new Error('Authentication error: ' + insertError.message + '. Please try logging in - your account may already be created.');
          }
          throw insertError;
        }

        // Create user_profile entry with ID, phone, and profile image for renters
        if (pendingUser.role === 'client' && idUrl) {
          console.log('Creating user_profile with ID document, phone, and profile image...');
          const profileData: any = {
            user_email: formData.email,
            full_name: formData.name,
            id_document_url: idUrl,
            is_verified: false,
            updated_at: new Date().toISOString()
          };
          
          // Add phone if provided
          if (formData.phone) {
            profileData.phone = formData.phone;
          }
          
          // Add address fields if provided
          if (formData.address) {
            profileData.address = formData.address;
          }
          if (formData.barangay) {
            profileData.barangay = formData.barangay;
          }
          if (formData.city) {
            profileData.city = formData.city;
          }
          
          // Add profile image URL if uploaded
          if (profileUrl) {
            profileData.profile_image_url = profileUrl;
          }
          
          const { error: profileError } = await supabase.from('user_profiles').upsert(profileData, {
            onConflict: 'user_email'
          });
          
          if (profileError) {
            console.error('Profile insert error:', profileError);
            // Don't throw - profile is optional
          } else {
            console.log('✅ User profile created with ID document, phone, and profile image');
          }
        }

        console.log('✅ app_users entry created successfully');

        // Registration complete!
        alert('Account created successfully! You can now log in.');
        onRegistrationSuccess();
      } else if (emailSent && !formData.token.trim()) {
        setError('Please enter the verification token from your email to complete registration.');
        setSubmitting(false);
        return;
      }
    } catch (err: any) {
      console.error('Registration error:', err);
      setError(err.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Handle ID file upload
  const handleIdUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please upload an image file for ID.');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('ID image must be less than 5MB.');
        return;
      }
      setIdFile(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setIdPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProfileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        setError('Please upload an image file for profile picture.');
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError('Profile image must be less than 5MB.');
        return;
      }
      setProfileFile(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };


  // Upload file to Supabase Storage
  const uploadFile = async (file: File, folder: string, fileName: string): Promise<string | null> => {
    try {
      // Check if storage is available
      if (!supabase.storage) {
        throw new Error('Storage service is not available. Please check your Supabase configuration.');
      }

      const fileExt = file.name.split('.').pop();
      const filePath = `${folder}/${fileName}.${fileExt}`;
      
      console.log('Uploading file to:', filePath);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tenant-verification')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        
        // Handle specific storage errors
        if (uploadError.message.includes('Bucket not found')) {
          throw new Error('Storage bucket "tenant-verification" not found. Please create it in Supabase Dashboard → Storage.');
        }
        if (uploadError.message.includes('new row violates row-level security')) {
          throw new Error('Storage access denied. Please check storage bucket policies in Supabase.');
        }
        if (uploadError.message.includes('JWT')) {
          throw new Error('Authentication error. Please log in and try again.');
        }
        
        throw uploadError;
      }

      // Get public URL (or signed URL for private buckets)
      const { data: urlData } = supabase.storage
        .from('tenant-verification')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (err: any) {
      console.error('Error uploading file:', err);
      
      // Handle browser tracking prevention
      if (err.message && err.message.includes('Tracking Prevention')) {
        throw new Error('Browser privacy settings are blocking file upload. Please disable tracking prevention for this site or use a different browser.');
      }
      
      throw err;
    }
  };


  const handleResendEmail = async () => {
    if (!formData.email) {
      setError('Email address is required to resend verification email.');
      return;
    }

    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      console.log('Resending confirmation email to:', formData.email);
      
      // Resend confirmation email
      const { data: resendData, error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: formData.email,
        options: {
          emailRedirectTo: `${window.location.origin}/?type=signup`
        }
      });

      console.log('Resend response:', resendData);

      if (resendError) {
        console.error('Resend error:', resendError);
        if (resendError.message.includes('email rate limit')) {
          throw new Error('Too many emails sent. Please wait a few minutes before requesting another email.');
        }
        throw resendError;
      }

      setInfo('✓ Verification email has been resent to ' + formData.email + '. Please check your email (including spam folder). If you still don\'t receive it, check that email confirmation is enabled in Supabase settings.');
    } catch (err: any) {
      console.error('Resend email error:', err);
      setError(err.message || 'Failed to resend email. Make sure email confirmation is enabled in Supabase Dashboard → Authentication → Settings.');
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
      <div className="bg-white/90 backdrop-blur-sm rounded-2xl p-4 mb-8 relative z-10 shadow-lg">
        <h1 className="text-4xl font-bold text-gray-900 text-center">
          Create Account
        </h1>
      </div>
      
      {error && (
        <div className="mb-4 text-sm text-red-800 glass-card rounded-lg px-3 py-2 border-red-300/50 relative z-10">{error}</div>
      )}
      {info && (
        <div className="mb-4 text-sm text-blue-800 glass-card rounded-lg px-3 py-2 border-blue-300/50 relative z-10">{info}</div>
      )}
      
      {/* Registration Form */}
      <form onSubmit={handleSubmit} className="space-y-6 mb-6">
        <div>
          <input
            type="text"
            placeholder="Name"
            value={formData.name}
            onChange={(e) => handleInputChange('name', e.target.value)}
            disabled={emailSent}
            className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
            required
          />
        </div>
        
        <div>
          <input
            type="email"
            placeholder="Email Address"
            value={formData.email}
            onChange={(e) => handleInputChange('email', e.target.value)}
            disabled={emailSent}
            className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
            required
          />
        </div>
        
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={formData.password}
            onChange={(e) => handleInputChange('password', e.target.value)}
            disabled={emailSent}
            className={`w-full px-4 py-3 pr-12 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            disabled={emailSent}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
            placeholder="Confirm Password"
            value={formData.confirmPassword}
            onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
            disabled={emailSent}
            className={`w-full px-4 py-3 pr-12 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
            required
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            disabled={emailSent}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
        
        {/* Phone Number and Profile - Only for Renters */}
        {userType === 'client' && !emailSent && (
          <>
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Additional Information</h3>
              
              {/* Phone Number */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  placeholder="Enter your phone number"
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  disabled={emailSent}
                  className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              
              {/* Address Fields */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="Street address"
                  value={formData.address}
                  onChange={(e) => handleInputChange('address', e.target.value)}
                  disabled={emailSent}
                  className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
                />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    Barangay
                  </label>
                  <input
                    type="text"
                    placeholder="Barangay"
                    value={formData.barangay}
                    onChange={(e) => handleInputChange('barangay', e.target.value)}
                    disabled={emailSent}
                    className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    placeholder="City"
                    value={formData.city}
                    onChange={(e) => handleInputChange('city', e.target.value)}
                    disabled={emailSent}
                    className={`w-full px-4 py-3 glass-input rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-900 ${emailSent ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                </div>
              </div>
              
              {/* Profile Image Upload */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Profile Picture
                </label>
                <div className="flex items-center space-x-4">
                  <label className="flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleProfileUpload}
                      className="hidden"
                      disabled={emailSent}
                    />
                    <div className={`w-full px-4 py-3 glass-card border-2 border-dashed border-white/50 rounded-xl text-center hover:border-primary-400 transition-colors ${emailSent ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {profilePreview ? (
                        <div className="space-y-2">
                          <img src={profilePreview} alt="Profile Preview" className="max-h-32 mx-auto rounded-full object-cover w-32 h-32" />
                          <p className="text-sm text-gray-900">Click to change</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <p className="text-sm text-gray-900">Click to upload profile picture</p>
                          <p className="text-xs text-gray-900">Max 5MB, Image files only</p>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </div>
            
            <div className="border-t border-gray-200 pt-6 mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Verification Documents</h3>
              
              {/* ID Upload */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Upload ID Document <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center space-x-4">
                  <label className="flex-1 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleIdUpload}
                      className="hidden"
                      disabled={emailSent}
                    />
                    <div className={`w-full px-4 py-3 glass-card border-2 border-dashed border-white/50 rounded-xl text-center hover:border-primary-400 transition-colors ${emailSent ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                      {idPreview ? (
                        <div className="space-y-2">
                          <img src={idPreview} alt="ID Preview" className="max-h-32 mx-auto rounded-lg" />
                          <p className="text-sm text-gray-900">Click to change</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <svg className="w-8 h-8 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <p className="text-sm text-gray-900">Click to upload ID</p>
                          <p className="text-xs text-gray-900">Max 5MB, Image files only</p>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </>
        )}
        
        {emailSent && (
          <div>
            <input
              type="text"
              placeholder="Enter Verification Token from Email"
              value={formData.token}
              onChange={(e) => handleInputChange('token', e.target.value)}
              className="w-full px-4 py-3 border-2 border-blue-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm bg-blue-50"
              required
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs text-blue-600 text-left font-medium">
                ✓ Check your email for the verification token and paste it above
              </p>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={submitting}
                className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
              >
                Resend Email
              </button>
            </div>
          </div>
        )}
        
        {/* Terms and Privacy */}
        <p className="text-sm text-gray-900">
          By registering, you are agreeing with our{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700">Terms of Use</a>
          {' '}and{' '}
          <a href="#" className="text-blue-600 hover:text-blue-700">Privacy Policy</a>
        </p>
        
        <button
          type="submit"
          disabled={submitting}
          className="w-full glass-button text-gray-900 text-lg font-semibold py-3 px-6 rounded-xl hover:scale-105 active:scale-95 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-primary-300 disabled:opacity-60 relative z-10"
        >
          {submitting 
            ? (emailSent ? 'Verifying Token…' : 'Sending Email…') 
            : (emailSent ? 'Verify Token & Complete Registration' : 'Register & Send Verification Email')
          }
        </button>
      </form>
      
      {/* Login Link */}
      <div className="text-center">
        <button 
          onClick={onBackToLogin}
          className="text-gray-900 hover:text-gray-700 text-sm"
        >
          Already have an account?
        </button>
      </div>
    </div>
  );
}
