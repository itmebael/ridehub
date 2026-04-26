-- Owner ↔ renter chat tables + RLS + Realtime (run in Supabase SQL Editor if chat fails to open).
-- Requires public.vehicles to exist. After this, enable Realtime for "messages" in Dashboard → Database → Replication if inserts do not stream live.

CREATE TABLE IF NOT EXISTS public.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    owner_email VARCHAR(255) NOT NULL,
    client_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_vehicle ON public.conversations(vehicle_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_vehicle_owner_client_unique
    ON public.conversations (vehicle_id, LOWER(TRIM(owner_email)), LOWER(TRIM(client_email)));

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_email VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON public.messages(conversation_id, created_at);

-- Normalized session email for chat RLS: JWT claim first, then app_users (some tokens omit email),
-- then auth user_metadata. SECURITY DEFINER reads app_users without being blocked by other RLS.
CREATE OR REPLACE FUNCTION public.chat_session_email_norm()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(LOWER(TRIM(COALESCE(auth.jwt() ->> 'email', ''))), ''),
    (SELECT NULLIF(LOWER(TRIM(u.email)), '') FROM public.app_users u WHERE u.user_id = auth.uid() LIMIT 1),
    NULLIF(LOWER(TRIM(COALESCE(auth.jwt() -> 'user_metadata' ->> 'email', ''))), ''),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.chat_session_email_norm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_session_email_norm() TO authenticated;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view conversations" ON public.conversations;
CREATE POLICY "Participants can view conversations" ON public.conversations
    FOR SELECT TO authenticated
    USING (
        public.chat_session_email_norm() = LOWER(TRIM(owner_email))
        OR public.chat_session_email_norm() = LOWER(TRIM(client_email))
    );

DROP POLICY IF EXISTS "Participants can create conversations" ON public.conversations;
CREATE POLICY "Participants can create conversations" ON public.conversations
    FOR INSERT TO authenticated
    WITH CHECK (
        public.chat_session_email_norm() = LOWER(TRIM(owner_email))
        OR public.chat_session_email_norm() = LOWER(TRIM(client_email))
    );

DROP POLICY IF EXISTS "Participants can read messages" ON public.messages;
CREATE POLICY "Participants can read messages" ON public.messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND (
                public.chat_session_email_norm() = LOWER(TRIM(c.owner_email))
                OR public.chat_session_email_norm() = LOWER(TRIM(c.client_email))
            )
        )
    );

DROP POLICY IF EXISTS "Participants can send messages" ON public.messages;
CREATE POLICY "Participants can send messages" ON public.messages
    FOR INSERT TO authenticated
    WITH CHECK (
        public.chat_session_email_norm() = LOWER(TRIM(sender_email))
        AND public.chat_session_email_norm() <> ''
        AND EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
            AND (
                public.chat_session_email_norm() = LOWER(TRIM(c.owner_email))
                OR public.chat_session_email_norm() = LOWER(TRIM(c.client_email))
            )
        )
    );
-- App should set sender_email to the same email the user signed in with (auth.getUser().email).

GRANT SELECT, INSERT ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM IS NOT NULL AND (SQLERRM ILIKE '%already%' OR SQLERRM ILIKE '%member%') THEN
            NULL;
        ELSE
            RAISE;
        END IF;
END $$;

-- Notify the other chat participant when a message is sent (in-app notifications row).
-- Called from the app after a successful insert into messages. Uses SECURITY DEFINER so
-- it can insert into notifications even when RLS has no INSERT policy for clients.
DROP FUNCTION IF EXISTS public.notify_chat_message_recipient(uuid, text);
DROP FUNCTION IF EXISTS public.notify_chat_message_recipient(uuid, text, text);
CREATE OR REPLACE FUNCTION public.notify_chat_message_recipient(
    p_conversation_id uuid,
    p_content text,
    p_sender_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    me text;
    conv record;
    recipient text;
    v_vehicle_title text;
    preview text;
    v_title text;
BEGIN
    me := COALESCE(
        NULLIF(LOWER(TRIM(p_sender_email)), ''),
        public.chat_session_email_norm()
    );

    IF me IS NULL OR me = '' OR p_conversation_id IS NULL THEN
        RETURN;
    END IF;

    SELECT c.owner_email, c.client_email, c.vehicle_id
    INTO conv
    FROM public.conversations c
    WHERE c.id = p_conversation_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF me <> lower(trim(conv.owner_email)) AND me <> lower(trim(conv.client_email)) THEN
        RETURN;
    END IF;

    IF me = lower(trim(conv.owner_email)) THEN
        recipient := trim(conv.client_email);
    ELSE
        recipient := trim(conv.owner_email);
    END IF;

    IF recipient IS NULL OR recipient = '' THEN
        RETURN;
    END IF;

    SELECT v.title INTO v_vehicle_title
    FROM public.vehicles v
    WHERE v.id = conv.vehicle_id
    LIMIT 1;

    preview := left(coalesce(p_content, ''), 500);
    IF preview IS NULL OR preview = '' THEN
        preview := '(New message)';
    END IF;

    v_title := 'New message';
    IF v_vehicle_title IS NOT NULL AND length(trim(v_vehicle_title)) > 0 THEN
        v_title := v_title || ' · ' || trim(v_vehicle_title);
    END IF;
    v_title := left(v_title, 255);

    INSERT INTO public.notifications (
        recipient_email,
        title,
        body,
        type,
        vehicle_id,
        created_at,
        is_read
    ) VALUES (
        recipient,
        v_title,
        preview,
        'chat_message',
        conv.vehicle_id,
        now(),
        false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.notify_chat_message_recipient(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_chat_message_recipient(uuid, text, text) TO authenticated;
