import express from 'express';
import { generateAIResponse } from './services/aiService.js';
// Import your sendWhatsAppMessage or other helpers here if located in another file

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/webhook', async (req, res) => {
  const { event, data } = req.body;

  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key?.remoteJid;
    const isFromMe = messageData.key?.fromMe;

    const textMessage =
      messageData.message?.conversation ||
      messageData.message?.extendedTextMessage?.text;

    if (!isFromMe && textMessage) {
      try {
        console.log(`Received message from ${senderNumber}: ${textMessage}`);

        // 1. Live Menu context
        const formattedMenu = ""; // Replace with your menu fetching/formatting logic if dynamic

        const fullUserPrompt = `Customer message: ${textMessage}\n\nToday's Live Menu:\n${formattedMenu || 'EMPTY'}`;

        // 2. Inline System Prompt Definition
        const SYSTEM_PROMPT = `You are the friendly AI assistant for Esthy's Spicy Kitchen.
Help customers with menu inquiries and taking orders based ONLY on today's live menu.

CRITICAL GUARDRAIL:
If the user message is a personal chat, off-topic statement, or not related to ordering/inquiring about food, reply ONLY with the text: IGNORE_MESSAGE`;

        // 3. Combine prompts
        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        // 4. Send to Gemini
        const aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          console.log('⚠️ Received empty response from Gemini.');
          res.status(200).send('EVENT_RECEIVED');
          return;
        }

        // 5. Guardrail check
        if (aiResponse.trim() === 'IGNORE_MESSAGE') {
          console.log(`🤐 Personal message from ${senderNumber} classified as non-business. Ignored.`);
          res.status(200).send('EVENT_RECEIVED');
          return;
        }

        // 6. Send reply back to customer
        if (typeof sendWhatsAppMessage === 'function') {
          await sendWhatsAppMessage(senderNumber, aiResponse);
        }
        console.log(`✅ AI Response processed for ${senderNumber}`);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error);
      }
    }
  }

  // Always return 200 OK to Evolution API
  res.status(200).send('EVENT_RECEIVED');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});