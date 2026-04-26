-- OPTIONAL: Run in Supabase SQL editor only if the browser console shows RLS errors when
-- loading notifications (e.g. "new row violates row-level security policy").
-- Lets renters/owners read and mark-read rows where recipient_email matches their JWT email
-- (case-insensitive). Admins can still list all notifications if their app_users.role is 'admin'.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own_or_admin" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;

CREATE POLICY "notifications_select_own_or_admin"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    lower(trim(coalesce(recipient_email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE lower(coalesce(u.role::text, '')) = 'admin'
        AND (
          u.user_id = auth.uid()
          OR lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  );

CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    lower(trim(coalesce(recipient_email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
  WITH CHECK (
    lower(trim(coalesce(recipient_email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );

-- Allow admins to mark any notification read (e.g. header bell on admin dashboard).
DROP POLICY IF EXISTS "notifications_update_admin" ON public.notifications;
CREATE POLICY "notifications_update_admin"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE lower(coalesce(u.role::text, '')) = 'admin'
        AND (
          u.user_id = auth.uid()
          OR lower(trim(coalesce(u.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
        )
    )
  )
  WITH CHECK (true);
