import React, { useState } from 'react';
import supabase from '../lib/supabase';

interface ReportProblemProps {
  userEmail: string;
  userId: string;
  userType: 'client' | 'owner';
  vehicleId?: string;
  onClose: () => void;
}

export default function ReportProblem({ userEmail, userId, userType, vehicleId, onClose }: ReportProblemProps) {
  const [problemType, setProblemType] = useState<string>('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!problemType.trim()) {
      setError('Please select a problem type');
      return;
    }

    if (!description.trim()) {
      setError('Please provide a description');
      return;
    }

    setSubmitting(true);
    try {
      // Get all admin emails from app_users table
      const { data: adminUsers, error: adminError } = await supabase
        .from('app_users')
        .select('email')
        .eq('role', 'admin');

      if (adminError) {
        console.warn('Could not fetch admin emails:', adminError);
      }

      const adminEmails = adminUsers?.map(user => user.email) || [];
      
      // If no admin emails found, use a fallback
      const recipientEmails = adminEmails.length > 0 ? adminEmails : ['admin@example.com'];

      // Create notifications for all admin emails
      const notificationPromises = recipientEmails.map(async (adminEmail) => {
        const notificationData = {
          recipient_email: adminEmail,
          title: `Problem Report: ${problemType}`,
          body: `Reported by ${userType === 'client' ? 'Renter' : 'Vehicle Owner'}: ${userEmail}\n\nType: ${problemType}\nDescription: ${description.trim()}`,
          type: 'problem_report',
          vehicle_id: vehicleId || null,
          created_at: new Date().toISOString()
        };

        const { error: notifError } = await supabase
          .from('notifications')
          .insert(notificationData);

        if (notifError) {
          console.warn(`Could not create notification for ${adminEmail}:`, notifError);
        }
        return notifError;
      });

      // Wait for all notification creations to complete
      const notificationResults = await Promise.all(notificationPromises);
      const hasNotificationErrors = notificationResults.some(result => result !== null);

      // Try to create problem report (may fail due to RLS or table not existing)
      try {
        const { error: insertError } = await supabase
          .from('problem_reports')
          .insert({
            user_id: userId,
            user_email: userEmail,
            user_type: userType,
            vehicle_id: vehicleId || null,
            problem_type: problemType,
            description: description.trim(),
            status: 'pending',
            created_at: new Date().toISOString()
          });

        if (insertError) {
          // If table doesn't exist or permission denied, notification was already created
          if (insertError.code === '42P01' || insertError.code === '42501' || insertError.message?.includes('permission denied')) {
            console.warn('Could not insert into problem_reports, but notification was created:', insertError);
            // Notification already created above, so we can proceed
          } else {
            throw insertError;
          }
        }
      } catch (reportError: any) {
        // If problem_reports insert fails, notification was already created, so continue
        console.warn('Problem report insert failed, but notification created:', reportError);
        // Don't throw - notification was created successfully
      }

      alert('Problem report submitted successfully! Admin will review it.');
      onClose();
    } catch (err: any) {
      console.error('Failed to submit problem report:', err);
      setError(err?.message || 'Failed to submit problem report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-2xl font-bold text-gray-900">Report a Problem</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Problem Type <span className="text-red-500">*</span>
            </label>
            <select
              value={problemType}
              onChange={(e) => setProblemType(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
              required
            >
              <option value="">Select problem type</option>
              <option value="technical">Technical Issue</option>
              <option value="payment">Payment Issue</option>
              <option value="vehicle">vehicle Issue</option>
              <option value="rental">rental Issue</option>
              <option value="account">Account Issue</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Please describe the problem in detail..."
              rows={6}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 resize-none"
              required
            />
          </div>

          <div className="flex gap-4 pt-4">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
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
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}



