import React, { useEffect, useState, useCallback } from 'react';
import supabase from '../lib/supabase';

interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: string;
  priority: 'low' | 'medium' | 'high';
  is_read: boolean;
  action_url?: string;
  created_at: string;
  expires_at?: string;
}

interface NotificationSystemProps {
  userEmail: string;
  userRole: 'admin' | 'owner' | 'client';
}

const recipientEmailVariants = (email: string) => {
  const t = email.trim();
  if (!t) return [];
  return Array.from(new Set([t, t.toLowerCase(), t.toUpperCase()]));
};

const mapRowToNotification = (row: Record<string, unknown>): Notification => {
  const hasReadAt = row.read_at != null && String(row.read_at).length > 0;
  const read = hasReadAt || row.is_read === true;
  const priorityRaw = String(row.priority || 'normal').toLowerCase();
  const priority: Notification['priority'] =
    priorityRaw === 'high' || priorityRaw === 'medium' || priorityRaw === 'low'
      ? priorityRaw
      : 'low';

  return {
    id: String(row.id),
    title: String(row.title || ''),
    message: String(row.body || row.message || ''),
    notification_type: String(row.notification_type || row.type || 'general'),
    priority,
    is_read: read,
    action_url: row.action_url ? String(row.action_url) : undefined,
    created_at: String(row.created_at || ''),
    expires_at: row.expires_at ? String(row.expires_at) : undefined,
  };
};

export default function NotificationSystem({ userEmail, userRole }: NotificationSystemProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loading, setLoading] = useState(false);

  const applyRows = useCallback((rows: Record<string, unknown>[]) => {
    const mapped = (rows || []).map(mapRowToNotification);
    setNotifications(mapped);
    setUnreadCount(mapped.filter((n) => !n.is_read).length);
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true);

      if (userRole === 'admin') {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) throw error;
        applyRows((data || []) as Record<string, unknown>[]);
        return;
      }

      const variants = recipientEmailVariants(userEmail);
      if (variants.length === 0) {
        applyRows([]);
        return;
      }

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .in('recipient_email', variants)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      applyRows((data || []) as Record<string, unknown>[]);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  }, [userEmail, userRole, applyRows]);

  useEffect(() => {
    if (userRole !== 'admin' && !userEmail.trim()) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    void loadNotifications();

    const channels: ReturnType<typeof supabase.channel>[] = [];

    if (userRole === 'admin') {
      const ch = supabase
        .channel('notifications-admin-all')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications' },
          (payload) => {
            const n = mapRowToNotification(payload.new as Record<string, unknown>);
            setNotifications((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
            if (!n.is_read) setUnreadCount((c) => c + 1);
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              try {
                new Notification(n.title, { body: n.message, icon: '/favicon.ico' });
              } catch {
                /* ignore */
              }
            }
          }
        )
        .subscribe();
      channels.push(ch);
    } else {
      const variants = recipientEmailVariants(userEmail);
      variants.forEach((em, idx) => {
        const ch = supabase
          .channel(`notifications-recipient-${idx}-${encodeURIComponent(em).slice(0, 40)}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'notifications',
              filter: `recipient_email=eq.${em}`,
            },
            (payload) => {
              const n = mapRowToNotification(payload.new as Record<string, unknown>);
              setNotifications((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
              if (!n.is_read) setUnreadCount((c) => c + 1);
              if (
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
              ) {
                try {
                  new Notification(n.title, { body: n.message, icon: '/favicon.ico' });
                } catch {
                  /* ignore */
                }
              }
            }
          )
          .subscribe();
        channels.push(ch);
      });
    }

    return () => {
      channels.forEach((c) => {
        void supabase.removeChannel(c);
      });
    };
  }, [userEmail, userRole, loadNotifications]);

  const markAsRead = async (notificationId: string) => {
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (unreadIds.length === 0) return;

      const now = new Date().toISOString();
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: now })
        .in('id', unreadIds);

      if (error) throw error;

      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      const { error } = await supabase.from('notifications').delete().eq('id', notificationId);

      if (error) throw error;

      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      setUnreadCount((prev) => {
        const deletedNotification = notifications.find((n) => n.id === notificationId);
        return deletedNotification && !deletedNotification.is_read ? Math.max(0, prev - 1) : prev;
      });
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const requestNotificationPermission = async () => {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'vehicle_deactivated':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        );
      case 'rental_request':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
        );
      case 'review_received':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
        );
      default:
        return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" />;
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowNotifications(!showNotifications)}
        className="relative rounded-full p-2 text-gray-600 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-800"
        onMouseEnter={requestNotificationPermission}
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2 2 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-100 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800"
                >
                  Mark all as read
                </button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-gray-500">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-4 text-center text-gray-500">No notifications</div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`border-b border-gray-100 p-4 transition-colors duration-200 hover:bg-gray-50 ${
                    !notification.is_read ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <div className={`rounded-lg p-2 ${getPriorityColor(notification.priority)}`}>
                      {getTypeIcon(notification.notification_type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between">
                        <h4 className="text-sm font-medium text-gray-900">{notification.title}</h4>
                        <button
                          type="button"
                          onClick={() => deleteNotification(notification.id)}
                          className="ml-2 text-gray-400 hover:text-gray-600"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-gray-600">{notification.message}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                          {notification.created_at
                            ? new Date(notification.created_at).toLocaleString()
                            : ''}
                        </span>
                        {!notification.is_read && (
                          <button
                            type="button"
                            onClick={() => markAsRead(notification.id)}
                            className="text-xs font-medium text-blue-600 hover:text-blue-800"
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
