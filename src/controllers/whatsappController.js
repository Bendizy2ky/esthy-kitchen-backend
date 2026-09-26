import { sendWhatsAppMessage } from '../services/whatsappService.js';
import { supabase } from '../config/supabase.js';
import { generateAIResponse, SYSTEM_PROMPT } from '../services/aiService.js';
import { getChatHistory, saveChatMessage } from '../services/chatService.js';

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
    const senderNumber = remoteJid.split('@')[0];

    // Extract the text content
    const textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text || 
      "";

    if (!textMessage) return; // Ignore pure images/audio for now

    console.log(`💬 New message from ${senderNumber}: ${textMessage}`);

    // ---------------------------------------------------------
    // 4. COMMAND ROUTING (Admin / System commands)
    // ---------------------------------------------------------
    if (textMessage.startsWith('!')) {
      if (textMessage.startsWith('!ping')) {
         await sendWhatsAppMessage(senderNumber, 'Pong! 🏓 The backend is working perfectly.');
      }
      return;
    }

    // ---------------------------------------------------------
    // 5. STANDARD CUSTOMER FLOW WITH MEMORY & AI
    // ---------------------------------------------------------
    // 1. Immediately save the incoming user message to memory
    await saveChatMessage(senderNumber, 'user', textMessage);

    // 2. Fetch live menu from Supabase
    const { data: menuItems, error } = await supabase
      .from('menu') 
      .select('*')
      .eq('is_available', true);

    if (error) console.error('Error fetching menu from Supabase:', error);

    const formattedMenu = (menuItems || []).map(item => 
      `- ${item.name} (${item.category || 'Menu'}): ₦${Number(item.price).toLocaleString()}`
    ).join('\n');

    // 3. Fetch the last 8 messages to give the AI context
    const history = await getChatHistory(senderNumber, 8);
    const historyText = history.map(msg => 
      `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`
    ).join('\n');

    // 4. Construct the contextual prompt payload for Gemini
    const fullUserPrompt = `
Customer Phone: ${senderNumber}

Recent Chat History:
${historyText || 'No previous history.'}

Today's Live Menu:
${formattedMenu || 'EMPTY'}
    `;

    const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

    // 5. Send to Gemini
    const aiResponse = await generateAIResponse(combinedPrompt);

    if (!aiResponse) return;

    // 6. Check Guardrail
    if (aiResponse.trim() === 'IGNORE_MESSAGE') {
      console.log(`🤐 Message from ${senderNumber} ignored (Non-business/Chit-chat).`);
      return; 
    }

    // 7. Send reply to WhatsApp
    await sendWhatsAppMessage(senderNumber, aiResponse);
    console.log(`✅ AI Response sent to ${senderNumber}`);

    // 8. Save the AI's response to memory so it remembers what it just said
    await saveChatMessage(senderNumber, 'model', aiResponse);

  } catch (error) {
    console.error('❌ Error processing AI workflow:', error);
  }
};