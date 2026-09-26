import { handleAdminCommand } from '../services/adminCommands.js'; // Updated to match ES module imports
import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { supabase } from '../config/supabase.js';
// import { generateAIResponse } from '../services/aiService.js'; // We will build this next

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
    // --- ADMIN COMMAND CHECK ---
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
    // 5. STANDARD CUSTOMER FLOW
    // ---------------------------------------------------------
    // --- NORMAL AI CUSTOMER LOGIC BELOW ---
    // await aiService.processMessage(...);

    // Temporary echo reply until we hook up Gemini
    const replyText = `I received your message: "${text}". We will connect the Gemini AI shortly!`;
    
    await sendWhatsAppMessage(cleanSender, replyText);

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
  }
};