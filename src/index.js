import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import { generateAIResponse } from './services/aiService.js'; 
import { sendWhatsAppMessage } from './services/whatsappService.js';
import { getChatHistory, saveChatMessage } from './services/chatService.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', message: "Esthy's Spicy Kitchen Backend is running smoothly!" });
});

// WhatsApp Webhook (Receives messages from Evolution API)
app.post('/webhook/whatsapp', async (req, res) => {
  // 1. Immediately acknowledge receipt to prevent Evolution API from retrying
  res.status(200).send('EVENT_RECEIVED');

  const { event, data } = req.body;

  // Listen for new incoming messages
  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key?.remoteJid;
    const isFromMe = messageData.key?.fromMe;
    
    // Extract text content from raw or extended text format
    const textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text;

    // Ignore self-sent messages and status updates
    if (!isFromMe && textMessage && senderNumber !== 'status@broadcast') {
      console.log(`💬 Received message from ${senderNumber}: ${textMessage}`);
      
      try {
        // 2. Fetch live menu from Supabase
        const { data: menuItems, error } = await supabase
          .from('menu_items') 
          .select('*')
          .eq('is_available', true);

        if (error) {
          console.error('Error fetching menu from Supabase:', error);
        }

        // 3. Format the menu for the AI Prompt
        const formattedMenu = (menuItems || []).map(item => 
          `- ${item.name} (${item.category || 'Menu'}): ₦${Number(item.price).toLocaleString()}`
        ).join('\n');

        // 4. Construct the contextual prompt payload for Gemini
        const fullUserPrompt = `
Customer Phone: ${senderNumber}
Customer Message: "${textMessage}"

Today's Live Menu:
${formattedMenu || 'EMPTY'}
        `;

        // Define the AI System Instructions directly
        const SYSTEM_PROMPT = `You are the polite AI Restaurant Assistant for Esthy's Spicy Kitchen.
Help customers with menu inquiries and taking orders based ONLY on today's live menu.

CRITICAL GUARDRAIL:
If the user message is a personal chat, off-topic statement, or not related to ordering/inquiring about food, reply ONLY with the text: IGNORE_MESSAGE`;

        // Combine system prompt and user prompt into a single string for generateAIResponse
        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        // 5. Send to Gemini
        const aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          console.log('⚠️ Received empty response from Gemini.');
          return;
        }

        // 6. Check the Guardrail: If it's a personal chat, stay silent
        if (aiResponse.trim() === 'IGNORE_MESSAGE') {
          console.log(`🤐 Personal message from ${senderNumber} classified as non-business. Ignored.`);
          return;
        }

        // 7. Send the business reply back to the customer
        await sendWhatsAppMessage(senderNumber, aiResponse);
        console.log(`✅ AI Response sent to ${senderNumber}`);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error);
      }
    }
  }
});

// Paystack Webhook (Receives payment success notifications)
app.post('/webhook/paystack', async (req, res) => {
  res.status(200).send('Webhook received');
  console.log('💳 Incoming Paystack Event:', JSON.stringify(req.body, null, 2));
});

// Health check route for UptimeRobot
app.get('/', (req, res) => {
  res.status(200).send('Esthy Kitchen Backend is online!');
});

app.listen(port, () => {
  console.log(`🚀 Server is awake and listening on port ${port}`);
});