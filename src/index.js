import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
// import { processIncomingMessage } from './controllers/whatsappController.js'; // Commented out as logic is now handled directly in the route below

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
  const { event, data } = req.body;

  // Listen for new incoming messages
  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key.remoteJid;
    const isFromMe = messageData.key.fromMe;
    
    // Extract text content from raw or extended text format
    const textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text;

    // Ignore self-sent messages and status updates
    if (!isFromMe && textMessage && senderNumber !== 'status@broadcast') {
      console.log(`💬 Received message from ${senderNumber}: ${textMessage}`);
      
      // Handle command logic (e.g., !menu, !soldout, orders) directly here
    }
  }

  // Always return a 200 OK fast so Evolution API knows the webhook succeeded
  res.status(200).send('EVENT_RECEIVED');
});

// Paystack Webhook (Receives payment success notifications)
app.post('/webhook/paystack', async (req, res) => {
  res.status(200).send('Webhook received');
  console.log('💳 Incoming Paystack Event:', JSON.stringify(req.body, null, 2));
});

app.listen(port, () => {
  console.log(`🚀 Server is awake and listening on port ${port}`);
});