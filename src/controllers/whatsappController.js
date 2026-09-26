import { handleAdminCommand } from '../services/adminCommands.js';
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { supabase } from '../config/supabase.js';
import { generateAIResponse } from '../services/aiService.js';

export const processIncomingMessage = async (req, res) => {
  // 1. Acknowledge receipt immediately so Evolution API doesn't timeout and retry
  res.status(200).json({ status: 'received' });

  try {
    const payload = req.body;

    // 2. Evolution API sends many event types. We only care about new messages.
    if (payload.event !== 'messages.upsert') return;

    // Handle both single objects and arrays depending on Evolution API version
    const messageData = payload.data?.messages?.[0] || payload.data;
    if (!messageData) return;

    // 3. Ignore messages sent by the bot itself
    if (messageData.key.fromMe) return;
    
    // Ignore group messages and status broadcasts
    const remoteJid = messageData.key.remoteJid;
    if (remoteJid.includes('@g.us') || remoteJid.includes('@broadcast')) return; 

    // Extract text and clean sender phone number
    const text = (messageData.message?.conversation || messageData.message?.extendedTextMessage?.text || '').trim();
    const cleanSender = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');

    if (!text) return; // Ignore pure images/audio for now

    console.log(`💬 New message from ${cleanSender}: ${text}`);

    // ---------------------------------------------------------
    // 4. COMMAND ROUTING (Admin / System commands)
    // ---------------------------------------------------------
    if (text.startsWith('!')) {
      // Test Command
      if (text.startsWith('!ping')) {
         await sendWhatsAppMessage(cleanSender, 'Pong! 🏓 The backend is working perfectly.');
         return;
      }
      
      const isHandled = await handleAdminCommand(cleanSender, text);
      if (isHandled) {
        return; // Command was executed, stop execution so AI doesn't process it
      }
    }

    // ---------------------------------------------------------
    // 5. STANDARD CUSTOMER FLOW (Gemini AI Pipeline)
    // ---------------------------------------------------------

    // A. Fetch recent chat history from Supabase (Last 10 messages for memory)
    const { data: chatHistory, error: historyError } = await supabase
      .from('chat_history')
      .select('sender, content')
      .eq('phone_number', cleanSender)
      .order('created_at', { ascending: true })
      .limit(10);

    if (historyError) {
      console.error('⚠️ Error fetching chat history from Supabase:', historyError);
    }

    // B. Fetch live menu items from Supabase
    const { data: menuItems, error: menuError } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_available', true);

    let liveMenuContext = '';
    if (menuError || !menuItems || menuItems.length === 0) {
      console.error('⚠️ Error or no live menu items found:', menuError);
    } else {
      liveMenuContext = menuItems
        .map(item => `- ${item.name}: ₦${item.price}`)
        .join('\n');
    }

    // C. Generate AI Response with full chat history & menu context
    const aiResponse = await generateAIResponse(
      cleanSender,
      text,
      chatHistory || [],
      liveMenuContext
    );

    // D. If classified as personal/non-business, ignore and exit silently
    if (!aiResponse || aiResponse.trim() === 'IGNORE_MESSAGE') {
      console.log(`🤫 Personal/Non-business message from ${cleanSender}. Ignoring.`);
      return;
    }

    // E. Save both incoming message and AI reply to Supabase chat history
    const { error: saveError } = await supabase.from('chat_history').insert([
      { phone_number: cleanSender, sender: 'user', content: text },
      { phone_number: cleanSender, sender: 'model', content: aiResponse }
    ]);

    if (saveError) {
      console.error('⚠️ Error saving messages to chat_history:', saveError);
    }

    // F. Send WhatsApp message back to customer
    await sendWhatsAppMessage(cleanSender, aiResponse);

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
  }
};