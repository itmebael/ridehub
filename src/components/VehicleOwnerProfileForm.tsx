import React, { useState } from 'react';
import supabase from '../lib/supabase';

interface VehicleOwnerProfileFormProps {
  userEmail: string;
  userId: string;
  onComplete: () => void;
  onCancel?: () => void;
  initialData?: {
    fullName?: string;
    phone?: string;
    address?: string;
    bio?: string;
  };
}

export default function VehicleOwnerProfileForm({ userEmail, userId, onComplete, onCancel, initialData }: VehicleOwnerProfileFormProps) {
  const [formData, setFormData] = useState({
    fullName: initialData?.fullName || '',
    phone: initialData?.phone || '',
    address: initialData?.address || '',
    bio: initialData?.bio || ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.fullName.trim()) {
      setError('Full name is required');
      return;
    }

    setSubmitting(true);
    try {
      // First check if vehicle owner profile already exists
      const { data: existingProfile } = await supabase
        .from('vehicle_owner_profiles')
        .select('id')
        .eq('email', userEmail)
        .maybeSingle();

      if (existingProfile) {
        // Profile already exists, just update it
        const { error: updateError } = await supabase
          .from('vehicle_owner_profiles')
          .update({
            full_name: formData.fullName.trim(),
            phone: formData.phone.trim() || null,
            address: formData.address.trim() || null,
            bio: formData.bio.trim() || null
          })
          .eq('email', userEmail);

        if (updateError) throw updateError;
      } else {
        // Create new vehicle owner profile using upsert to handle duplicates gracefully
        const { data, error: insertError } = await supabase
          .from('vehicle_owner_profiles')
          .upsert({
            user_id: userId,
            email: userEmail,
            full_name: formData.fullName.trim(),
            phone: formData.phone.trim() || null,
            address: formData.address.trim() || null,
            bio: formData.bio.trim() || null,
            verification_status: 'pending'
          }, {
            onConflict: 'email'
          })
          .select()
          .single();

        if (insertError) {
          // If it's a duplicate key error, try to update instead
          if (insertError.code === '23505' || insertError.message?.includes('duplicate')) {
            const { error: updateError } = await supabase
              .from('vehicle_owner_profiles')
              .update({
                full_name: formData.fullName.trim(),
                phone: formData.phone.trim() || null,
                address: formData.address.trim() || null,
                bio: formData.bio.trim() || null
              })
              .eq('email', userEmail);

            if (updateError) throw updateError;
          } else {
            // Try fallback to user_profiles if vehicle_owner_profiles doesn't exist
            console.warn('Owner profile insert failed, trying user_profiles:', insertError);
            const { error: fallbackError } = await supabase
              .from('user_profiles')
              .upsert({
                user_email: userEmail,
                full_name: formData.fullName.trim(),
                phone: formData.phone.trim() || null,
                address: formData.address.trim() || null,
                bio: formData.bio.trim() || null
              }, {
                onConflict: 'user_email'
              });
            
            if (fallbackError) throw fallbackError;
          }
        }
      }

      // Update user role
      const { error: roleError } = await supabase
        .from('user_roles')
        .upsert({
          user_id: userId,
          email: userEmail,
          role: 'owner',
          is_active: true
        }, { onConflict: 'user_id,role' });

      if (roleError) {
        console.warn('Role update failed:', roleError);
      }

      onComplete();
    } catch (err: any) {
      console.error('Failed to create owner profile:', err);
      setError(err?.message || 'Failed to create profile. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">{initialData ? 'Edit' : 'Create'} Owner Profile</h3>
          <p className="text-gray-600">{initialData ? 'Update your profile information' : 'Complete your profile to start listing vehicles'}</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="Juan Dela Cruz"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="+63-912-345-6789"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Your address"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Bio</label>
            <textarea
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Tell us about yourself..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 resize-none"
            />
          </div>

          <div className="flex gap-4 pt-4">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl hover:bg-gray-200 transition-colors duration-200 font-semibold"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 text-white py-3 rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Creating...' : 'Create Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
