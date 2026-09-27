import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import { generateAIResponse, SYSTEM_PROMPT } from './services/aiService.js'; 
import { sendWhatsAppMessage } from './services/whatsappService.js';
import { getChatHistory, saveChatMessage } from './services/chatService.js';
import { generatePaymentLink } from './services/paystackService.js';

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
        // ---> MEMORY ADDITION 1: Save incoming message to database
        await saveChatMessage(senderNumber, 'user', textMessage);

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

        // ---> MEMORY ADDITION 2: Fetch the chat history
        const history = await getChatHistory(senderNumber, 8);
        const historyText = history.map(msg => 
          `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        // 4. Construct the contextual prompt payload for Gemini
        const fullUserPrompt = `
Customer Phone: ${senderNumber}

Recent Chat History:
${historyText || 'No previous history.'}

Customer's New Message: "${textMessage}"

Today's Live Menu:
${formattedMenu || 'EMPTY'}
        `;

        // 5. Combine the master system prompt with the user context
        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        // 6. Send to Gemini (changed to let so we can modify it)
        let aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          console.log('⚠️ Received empty response from Groq.');
          return;
        }

        // 7. Check the Guardrail: If it's a personal chat, stay silent
        if (aiResponse.trim() === 'IGNORE_MESSAGE') {
          console.log(`🤐 Personal message from ${senderNumber} classified as non-business. Ignored.`);
          return;
        }

        // ---> PAYSTACK ADDITION: Intercept and replace the payment tag
        const paymentMatch = aiResponse.match(/\[GENERATE_LINK:\s*(\d+)\]/);

        if (paymentMatch) {
          const amount = parseInt(paymentMatch[1], 10);
          console.log(`💳 Triggering Paystack link generation for ₦${amount}`);
          const paymentUrl = await generatePaymentLink(amount);
          
          if (paymentUrl) {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nHere is your secure payment link: ${paymentUrl}\n\nPlease let me know once you have completed the transfer!`
            );
          } else {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nI'm currently unable to generate a payment link. Please manually transfer ₦${amount} to our bank account and send the receipt.`
            );
          }
        }

        // 8. Send the business reply back to the customer
        await sendWhatsAppMessage(senderNumber, aiResponse);
        console.log(`✅ AI Response sent to ${senderNumber}`);

        // ---> MEMORY ADDITION 3: Save AI's response to database
        await saveChatMessage(senderNumber, 'model', aiResponse);

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