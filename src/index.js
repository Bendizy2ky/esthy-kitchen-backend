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
        // 1. Save incoming message to database
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

        // 4. Fetch the chat history
        const history = await getChatHistory(senderNumber, 8);
        const historyText = history.map(msg => 
          `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        // 5. Construct the contextual prompt payload for Groq
        const fullUserPrompt = `
Customer Phone: ${senderNumber}

Recent Chat History:
${historyText || 'No previous history.'}

Customer's New Message: "${textMessage}"

Today's Live Menu:
${formattedMenu || 'EMPTY'}
        `;

        // 6. Combine the master system prompt with the user context
        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        // 7. Send to Groq AI
        let aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          console.log('⚠️ Received empty response from Groq.');
          return;
        }

        // 8. Personal Chat Guardrail: Stay silent if non-business
        if (aiResponse.trim() === 'IGNORE_MESSAGE') {
          console.log(`🤐 Personal message from ${senderNumber} classified as non-business. Ignored.`);
          return;
        }

        // 9. Intercept and replace the payment trigger tag
        const paymentMatch = aiResponse.match(/\[GENERATE_LINK:\s*(\d+)\]/);

        if (paymentMatch) {
          const amount = parseInt(paymentMatch[1], 10);
          console.log(`💳 Triggering Paystack link generation for ₦${amount}`);
          
          // Pass senderNumber so Paystack metadata captures the customer's phone
          const paymentUrl = await generatePaymentLink(amount, senderNumber);
          
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

        // 10. Send the business reply back to WhatsApp
        await sendWhatsAppMessage(senderNumber, aiResponse);
        console.log(`✅ AI Response sent to ${senderNumber}`);

        // 11. Save AI's response to database
        await saveChatMessage(senderNumber, 'model', aiResponse);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error);
      }
    }
  }
});

// Paystack Webhook (Receives payment success notifications)
app.post('/webhook/paystack', async (req, res) => {
  // Acknowledge Paystack immediately to prevent retry loops
  res.status(200).send('Webhook received');

  const event = req.body;

  if (event && event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    const amount = data.amount / 100; // Convert kobo back to Naira
    const customerEmail = data.customer?.email;
    const customerPhone = data.metadata?.customer_phone;

    console.log(`🎉 Successful payment confirmed: ₦${amount} (Ref: ${reference})`);

    try {
      // 1. Save paid order directly into Supabase
      const { error } = await supabase
        .from('orders')
        .insert([
          {
            reference: reference,
            customer_phone: customerPhone || 'Unknown',
            amount: amount,
            email: customerEmail
          }
        ]);

      if (error) {
        console.error('❌ Error saving paid order to Supabase:', error.message);
      } else {
        console.log('✅ Paid order successfully logged in Supabase!');
      }

      // 2. Send instant WhatsApp receipt if customer phone exists
      if (customerPhone) {
        const receiptMessage = `🎉 *Payment Received!* \n\nThank you for your payment of *₦${amount.toLocaleString()}*. Your order has been confirmed and is being prepared right away! 🍲✨`;
        
        await sendWhatsAppMessage(customerPhone, receiptMessage);
        await saveChatMessage(customerPhone, 'model', receiptMessage);
      }

    } catch (err) {
      console.error('❌ Error in Paystack webhook processing:', err);
    }
  }
});

// Health check route for UptimeRobot
app.get('/', (req, res) => {
  res.status(200).send('Esthy Kitchen Backend is online!');
});

app.listen(port, () => {
  console.log(`🚀 Server is awake and listening on port ${port}`);
});