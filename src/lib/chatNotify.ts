import supabase from './supabase';

/**
 * Fire-and-forget: creates an in-app notification for the other chat participant.
 * Pass `senderEmail` so renters still notify owners when JWT/session email differs from `chat_session_email_norm()`.
 * Requires `notify_chat_message_recipient` in Supabase (see chat_conversations_messages.sql).
 */
export function notifyChatRecipientNonBlocking(
  conversationId: string,
  content: string,
  senderEmail?: string | null
) {
  const id = conversationId?.trim();
  if (!id) return;
  const preview = (content || '').slice(0, 500);
  const trimmedSender = senderEmail?.trim() || null;
  void supabase
    .rpc('notify_chat_message_recipient', {
      p_conversation_id: id,
      p_content: preview,
      p_sender_email: trimmedSender,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('Chat message notification failed (run latest chat_conversations_messages.sql):', error.message);
      }
    });
}
