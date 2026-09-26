import { supabase } from '../config/supabase.js';

/**
 * Fetch the recent chat history for a specific phone number
 */
export async function getChatHistory(phoneNumber, limit = 8) {
  const { data, error } = await supabase
    .from('chat_history')
    .select('role, content')
    .eq('phone_number', phoneNumber)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('❌ Error fetching chat history:', error);
    return [];
  }

  // Supabase returns newest first, but the AI needs to read it chronologically (oldest to newest)
  return data.reverse();
}

/**
 * Save a single message to the database
 */
export async function saveChatMessage(phoneNumber, role, content) {
  const { error } = await supabase
    .from('chat_history')
    .insert([{ phone_number: phoneNumber, role, content }]);

  if (error) {
    console.error(`❌ Error saving ${role} message:`, error);
  }
}