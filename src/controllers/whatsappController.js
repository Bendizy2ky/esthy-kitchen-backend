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

    // Extract the raw phone number (e.g., 2348138412871)
    const phoneNumber = remoteJid.split('@')[0];

    // Extract the text content (Evolution API handles normal and quoted replies slightly differently)
    const textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text || 
      "";

    if (!textMessage) return; // Ignore pure images/audio for now

    console.log(`💬 New message from ${phoneNumber}: ${textMessage}`);

    // ---------------------------------------------------------
    // 4. COMMAND ROUTING (Admin / System commands)
    // ---------------------------------------------------------
    if (textMessage.startsWith('!')) {
      // Test Command
      if (textMessage.startsWith('!ping')) {
         await sendWhatsAppMessage(phoneNumber, 'Pong! 🏓 The backend is working perfectly.');
      }
      
      // We will add the !addcustomer logic here soon!
      return;
    }

    // ---------------------------------------------------------
    // 5. STANDARD CUSTOMER FLOW
    // ---------------------------------------------------------
    // Temporary echo reply until we hook up Gemini
    const replyText = `I received your message: "${textMessage}". We will connect the Gemini AI shortly!`;
    
    await sendWhatsAppMessage(phoneNumber, replyText);

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
  }
};