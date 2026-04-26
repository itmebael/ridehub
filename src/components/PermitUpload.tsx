import React, { useState, useRef, useEffect } from 'react';
import supabase from '../lib/supabase';
import { VEHICLE_ASSET_BUCKETS, uploadFileWithBucketFallback } from '../lib/storageBuckets';

interface PermitFile {
  file: File;
  type: 'business_permit' | 'owner_car_permit';
  preview?: string;
  uploaded?: boolean;
  url?: string;
}

interface SubmittedPermit {
  id: string;
  permit_type: 'business_permit' | 'owner_car_permit';
  permit_file_url: string;
  permit_number?: string;
  verification_status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiry_date?: string;
  created_at: string;
  admin_notes?: string;
}

interface PermitUploadProps {
  ownerId?: string;
  vehicleId?: string;
  onUploadComplete?: () => void;
}

export default function PermitUpload({ ownerId, vehicleId, onUploadComplete }: PermitUploadProps) {
  const [permits, setPermits] = useState<PermitFile[]>([]);
  const [submittedPermits, setSubmittedPermits] = useState<SubmittedPermit[]>([]);
  const [loadingPermits, setLoadingPermits] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newPermits: PermitFile[] = files.map(file => ({
      file,
      type: 'business_permit', // Default
      preview: URL.createObjectURL(file)
    }));

    setPermits([...permits, ...newPermits]);
  };

  const removePermit = (index: number) => {
    const updated = permits.filter((_, i) => i !== index);
    setPermits(updated);
  };

  const updateType = (index: number, type: PermitFile['type']) => {
    const updated = permits.map((p, i) => i === index ? { ...p, type } : p);
    setPermits(updated);
  };

  // Fetch submitted permits
  const loadSubmittedPermits = async (resolvedOwnerId: string) => {
    try {
      setLoadingPermits(true);
      const { data, error } = await supabase
        .from('owner_permits')
        .select('*')
        .eq('owner_id', resolvedOwnerId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error loading submitted permits:', error);
      } else {
        setSubmittedPermits(data || []);
      }
    } catch (err) {
      console.error('Exception loading submitted permits:', err);
    } finally {
      setLoadingPermits(false);
    }
  };

  // Load permits when component mounts or ownerId changes
  useEffect(() => {
    const fetchPermits = async () => {
      let resolvedOwnerId = ownerId;
      
      if (!resolvedOwnerId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.email) return;

          const userEmail = user.email.trim().toLowerCase();
          
          // Try to find owner profile
          const { data: profile } = await supabase
            .from('vehicle_owner_profiles')
            .select('id')
            .or(`email.eq.${userEmail},user_id.eq.${user.id}`)
            .maybeSingle();

          if (profile?.id) {
            resolvedOwnerId = profile.id;
          }
        } catch (err) {
          console.error('Error fetching owner ID:', err);
        }
      }

      if (resolvedOwnerId) {
        await loadSubmittedPermits(resolvedOwnerId);
      }
    };

    fetchPermits();
  }, [ownerId]);

  const handleUpload = async () => {
    if (permits.length === 0) {
      setError('Please select at least one permit file');
      return;
    }

    // Fetch owner ID if not provided
    let resolvedOwnerId = ownerId;
    
    if (!resolvedOwnerId) {
      try {
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) {
          setError('Please log in to upload permits');
          return;
        }

        // Try to find owner profile - match OwnerDashboard logic
        let ownerProfile = null;
        const userEmail = user.email?.trim().toLowerCase();

        console.log('Looking for owner profile for user:', {
          user_id: user.id,
          email: userEmail
        });

        // First try by email (trimmed and lowercased) - matches OwnerDashboard
        if (userEmail) {
          const { data: emailProfile, error: emailError } = await supabase
            .from('vehicle_owner_profiles')
            .select('id, email, user_id')
            .eq('email', userEmail)
            .maybeSingle();
          
          console.log('Owner profile by email:', { data: emailProfile, error: emailError });
          
          if (!emailError && emailProfile && emailProfile.id) {
            ownerProfile = emailProfile;
          }
        }

        // If not found by email, try by user_id
        if (!ownerProfile && user.id) {
          const { data: userIdProfile, error: userIdError } = await supabase
            .from('vehicle_owner_profiles')
            .select('id, email, user_id')
            .eq('user_id', user.id)
            .maybeSingle();
          
          console.log('Owner profile by user_id:', { data: userIdProfile, error: userIdError });
          
          if (!userIdError && userIdProfile && userIdProfile.id) {
            ownerProfile = userIdProfile;
          }
        }

        // If still not found, check user_profiles and auto-create if needed (like OwnerDashboard)
        if (!ownerProfile && userEmail && user.id) {
          const { data: userProfile, error: userProfileError } = await supabase
            .from('user_profiles')
            .select('id, user_email, full_name, phone, address, bio')
            .eq('user_email', userEmail)
            .maybeSingle();
          
          console.log('User profile check:', { data: userProfile, error: userProfileError });
          
          if (!userProfileError && userProfile && userProfile.id) {
            // Auto-create owner profile from user_profiles
            try {
              const { data: createdProfile, error: createError } = await supabase
                .from('vehicle_owner_profiles')
                .upsert({
                  user_id: user.id,
                  email: userEmail,
                  full_name: userProfile.full_name || '',
                  phone: userProfile.phone || null,
                  address: userProfile.address || null,
                  bio: userProfile.bio || null,
                  verification_status: 'pending'
                }, {
                  onConflict: 'email'
                })
                .select('id')
                .single();
              
              console.log('Auto-create landlord profile result:', { data: createdProfile, error: createError });
              
              if (!createError && createdProfile && createdProfile.id) {
                ownerProfile = { id: createdProfile.id };
                console.log('✅ Auto-created owner profile from user_profiles');
              } else if (createError && createError.code === '23505') {
                // Duplicate key - profile already exists, try to fetch it
                const { data: existingProfile } = await supabase
                  .from('vehicle_owner_profiles')
                  .select('id')
                  .eq('email', userEmail)
                  .maybeSingle();
                
                if (existingProfile && existingProfile.id) {
                  ownerProfile = existingProfile;
                  console.log('✅ Found existing owner profile after duplicate key error');
                }
              }
            } catch (err) {
              console.warn('Error auto-creating owner profile:', err);
            }
          }
        }

        // If still not found, create a basic owner profile automatically
        if (!ownerProfile || !ownerProfile.id) {
          console.log('No owner profile found, creating one automatically...');
          
          if (!user.id || !userEmail) {
            console.error('Cannot create owner profile: missing user ID or email');
            setError('Unable to create owner profile. Please ensure you are logged in with a valid email address.');
            return;
          }

          try {
            // Create a basic owner profile
            const { data: newProfile, error: createError } = await supabase
              .from('vehicle_owner_profiles')
              .insert({
                user_id: user.id,
                email: userEmail,
                full_name: user.user_metadata?.full_name || user.user_metadata?.name || userEmail.split('@')[0] || 'Owner',
                phone: null,
                address: null,
                bio: null,
                verification_status: 'pending'
              })
              .select('id')
              .single();
            
              if (createError) {
                // If it's a duplicate key error, try to fetch the existing profile
                if (createError.code === '23505') {
                console.log('Profile already exists (duplicate key), fetching it...');
                const { data: existingProfile } = await supabase
                  .from('vehicle_owner_profiles')
                  .select('id')
                  .eq('email', userEmail)
                  .maybeSingle();
                
                if (existingProfile && existingProfile.id) {
                  ownerProfile = existingProfile;
                  console.log('✅ Found existing owner profile after duplicate key error');
                } else {
                  console.error('Duplicate key error but could not fetch existing profile:', createError);
                  setError('Owner profile exists but could not be retrieved. Please try again or contact support.');
                  return;
                }
              } else {
                console.error('Error creating owner profile:', createError);
                setError(`Failed to create owner profile: ${createError.message}. Please try creating your profile in the Owner Dashboard first.`);
                return;
              }
            } else if (newProfile && newProfile.id) {
              ownerProfile = newProfile;
              console.log('✅ Auto-created owner profile:', newProfile.id);
            } else {
              console.error('Created profile but no ID returned:', newProfile);
              setError('Failed to create owner profile. Please try creating your profile in the Owner Dashboard first.');
              return;
            }
          } catch (err: any) {
            console.error('Exception creating owner profile:', err);
            setError(`Error creating owner profile: ${err?.message || err}. Please try creating your profile in the Owner Dashboard first.`);
            return;
          }
        }

        if (!ownerProfile || !ownerProfile.id) {
          console.error('Owner profile still not found after all attempts:', {
            user_id: user.id,
            email: userEmail,
            searched_profiles: ownerProfile
          });
          setError('Owner profile not found. Please create your owner profile first. Go to the Owner Dashboard and complete your profile.');
          return;
        }

        resolvedOwnerId = ownerProfile.id;
        console.log('✅ Using owner profile ID:', resolvedOwnerId);
      } catch (err: any) {
        console.error('Error fetching owner ID:', err);
        setError('Failed to fetch owner profile. Please try again.');
        return;
      }
    }

    if (!resolvedOwnerId) {
      setError('Owner ID is required');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const uploadedPermits = [];

      for (const permit of permits) {
        // Upload file to storage
        const fileExt = permit.file.name.split('.').pop();
        const filePath = `permits/${resolvedOwnerId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const uploadResult = await uploadFileWithBucketFallback({
          buckets: VEHICLE_ASSET_BUCKETS,
          path: filePath,
          file: permit.file,
          upsert: true,
        });

        // Save permit record to database
        const permitData: any = {
          owner_id: resolvedOwnerId,
          permit_type: permit.type,
          permit_file_url: uploadResult.publicUrl,
          verification_status: 'pending'
        };

        if (vehicleId) {
          permitData.vehicle_id = vehicleId;
        }

        const { error: insertError } = await supabase
          .from('owner_permits')
          .insert([permitData]);

        if (insertError) {
          console.warn('Permit insert failed, file uploaded but record not saved:', insertError);
        }

        uploadedPermits.push({
          ...permit,
          uploaded: true,
          url: uploadResult.publicUrl
        });
      }

      setPermits(uploadedPermits);
      
      // Reload submitted permits
      if (resolvedOwnerId) {
        await loadSubmittedPermits(resolvedOwnerId);
      }
      
      alert('Permits uploaded successfully! They will be reviewed by administrators.');
      onUploadComplete?.();
    } catch (err: any) {
      console.error('Failed to upload permits:', err);
      setError(err?.message || 'Failed to upload permits. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h4 className="text-lg font-semibold text-gray-900">Business & Owner Car Permits</h4>
          <p className="text-sm text-gray-600">Upload valid permits for verification</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Add Permit
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {permits.map((permit, index) => (
          <div
            key={index}
            className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl bg-gray-50"
          >
            <div className="flex-1 flex items-center gap-4">
              {permit.preview && permit.file.type.startsWith('image/') && (
                <img
                  src={permit.preview}
                  alt={`Permit ${index + 1}`}
                  className="w-16 h-16 object-cover rounded-lg"
                />
              )}
              <div className="flex-1">
                <p className="font-medium text-gray-900">{permit.file.name}</p>
                <p className="text-sm text-gray-600">
                  {(permit.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <select
                value={permit.type}
                onChange={(e) => updateType(index, e.target.value as PermitFile['type'])}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="business_permit">Business Permit</option>
                <option value="owner_car_permit">Owner Car Permit</option>
              </select>
              {permit.uploaded ? (
                <span className="px-3 py-1 bg-green-100 text-green-800 rounded-lg text-sm font-medium">
                  ✓ Uploaded
                </span>
              ) : (
                <button
                  onClick={() => removePermit(index)}
                  className="px-3 py-1 bg-red-100 text-red-800 rounded-lg text-sm hover:bg-red-200"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {permits.length > 0 && (
        <div className="flex gap-4 pt-4">
          <button
            onClick={handleUpload}
            disabled={uploading || permits.every(p => p.uploaded)}
            className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Upload Permits for Verification'}
          </button>
        </div>
      )}

      {permits.length === 0 && submittedPermits.length === 0 && !loadingPermits && (
        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-600">No permits uploaded yet</p>
          <p className="text-sm text-gray-500 mt-1">Click "Add Permit" to upload business or owner car permits</p>
        </div>
      )}

      {/* Submitted Permits Section */}
      {submittedPermits.length > 0 && (
        <div className="mt-8">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Submitted Permits</h4>
          <div className="space-y-3">
            {submittedPermits.map((permit) => (
              <div
                key={permit.id}
                className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl bg-white hover:shadow-md transition-shadow"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                      {permit.permit_type === 'business_permit' ? 'Business Permit' : 'Owner Car Permit'}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      permit.verification_status === 'approved' 
                        ? 'bg-green-100 text-green-800'
                        : permit.verification_status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : permit.verification_status === 'expired'
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {permit.verification_status.charAt(0).toUpperCase() + permit.verification_status.slice(1)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Submitted: {new Date(permit.created_at).toLocaleDateString()}</p>
                    {permit.permit_number && (
                      <p>Permit Number: {permit.permit_number}</p>
                    )}
                    {permit.expiry_date && (
                      <p>Expiry Date: {new Date(permit.expiry_date).toLocaleDateString()}</p>
                    )}
                    {permit.admin_notes && (
                      <p className="text-gray-500 italic">Note: {permit.admin_notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={permit.permit_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    View
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loadingPermits && (
        <div className="text-center py-4">
          <p className="text-gray-600">Loading submitted permits...</p>
        </div>
      )}
    </div>
  );
}


