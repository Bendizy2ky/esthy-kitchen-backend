// index.js
import express from 'express';
import dotenv from 'dotenv';
import { supabase } from './config/supabase.js';
import { generateAIResponse, SYSTEM_PROMPT } from './services/aiService.js'; 
import { sendWhatsAppMessage } from './services/whatsappService.js';
import { getChatHistory, saveChatMessage } from './services/chatService.js';
import { generatePaymentLink } from './services/paystackService.js';
import { createCompleteOrder } from './services/orderService.js';
import { parseCartData } from './utils/cartParser.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', message: "Esthy's Spicy Kitchen Backend is running smoothly!" });
});

// WhatsApp Redirect Route (Brings users back to the native app after paying)
app.get('/payment-success', (req, res) => {
  const botPhone = req.query.phone || '2349117590168';
  res.send(`
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Payment Successful</title>
        <style>
          body { font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #f0fdf4; color: #166534; }
          .loader { border: 4px solid #dcfce7; border-top: 4px solid #22c55e; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <h2>Payment Successful! 🎉</h2>
        <p>Redirecting you back to your WhatsApp chat...</p>
        <div class="loader"></div>
        <script>
          // Attempt native app deep link first
          window.location.href = "whatsapp://send?phone=${botPhone}";
          // Fallback to standard web router if native fails
          setTimeout(() => { window.location.href = "https://wa.me/${botPhone}"; }, 2000);
        </script>
      </body>
    </html>
  `);
});

// WhatsApp Webhook (Receives messages from Evolution API)
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  const { event, data } = req.body;

  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key?.remoteJid;
    const isFromMe = messageData.key?.fromMe;
    
    const textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text;

    if (!isFromMe && textMessage && senderNumber !== 'status@broadcast') {
      console.log(`💬 Received message from ${senderNumber}: ${textMessage}`);
      
      try {
        await saveChatMessage(senderNumber, 'user', textMessage);

        const { data: menuItems, error } = await supabase
          .from('menu_items') 
          .select('*')
          .eq('is_available', true);

        if (error) console.error('Error fetching menu from Supabase:', error);

        const formattedMenu = (menuItems || []).map(item => 
          `- ${item.name} (${item.category || 'Menu'}): ₦${Number(item.price).toLocaleString()}`
        ).join('\n');

        const history = await getChatHistory(senderNumber, 8);
        const historyText = history.map(msg => 
          `${msg.role === 'user' ? 'Customer' : 'Assistant'}: ${msg.content}`
        ).join('\n');

        const fullUserPrompt = `
Customer Phone: ${senderNumber}

Recent Chat History:
${historyText || 'No previous history.'}

Customer's New Message: "${textMessage}"

Today's Live Menu:
${formattedMenu || 'EMPTY'}
        `;

        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        let aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) return;

        if (aiResponse.trim() === 'IGNORE_MESSAGE') return;

        // Strip out hallucinated markdown links (e.g. [Payment Link](https://checkout...))
        aiResponse = aiResponse.replace(/\[.*?\]\(https?:\/\/[^\s)]+\)/g, '').trim();

        // 1. Extract JSON cart data if present (Cleaned up using cartParser)
        let parsedCartData = null;
        const cartDataMatch = aiResponse.match(/\[CART_DATA:\s*(\[.*?\])\]/s);
        
        if (cartDataMatch) {
          parsedCartData = parseCartData(cartDataMatch[1]);
          // Remove the hidden tag from the final message sent to the user
          aiResponse = aiResponse.replace(cartDataMatch[0], '').trim();
        }

        // 2. Extract payment link intent
        const paymentMatch = aiResponse.match(/\[GENERATE_LINK:\s*(\d+)\]/);

        if (paymentMatch) {
          const amount = parseInt(paymentMatch[1], 10);
          
          // Passing parsedCartData to your Paystack service so it can attach it to metadata
          const paymentUrl = await generatePaymentLink(amount, senderNumber, parsedCartData);
          
          if (paymentUrl) {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nHere is your secure payment link: ${paymentUrl}\n\n*Note:* You do not need to send a receipt here. Our system will automatically process your order and send a confirmation the exact moment your payment is successful.`
            );
          } else {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nI'm currently unable to generate a payment link. Please manually transfer ₦${amount} to our bank account.`
            );
          }
        }

        await sendWhatsAppMessage(senderNumber, aiResponse);
        await saveChatMessage(senderNumber, 'model', aiResponse);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error);
      }
    }
  }
});

// Paystack Webhook (The absolute Source of Truth for Payments)
app.post('/webhook/paystack', async (req, res) => {
  res.status(200).send('Webhook received');

  const event = req.body;

  if (event && event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    const amount = data.amount / 100;
    const customerEmail = data.customer?.email;
    const customerPhone = data.metadata?.customer_phone;
    
    // Extract cart summary & optional metadata passed during payment link creation
    const cartSummary = data.metadata?.cart_data || []; 
    const deliveryAddress = data.metadata?.delivery_address;
    const isPickup = data.metadata?.is_pickup || (!deliveryAddress && !cartSummary.some(i => i.item_name.toLowerCase().includes('delivery')));

    console.log(`🎉 Successful payment confirmed: ₦${amount} (Ref: ${reference})`);

    const orderData = {
      reference,
      customerPhone,
      amount,
      customerEmail
    };

    // 1. Save cleaned order to Supabase
    const result = await createCompleteOrder(orderData, cartSummary);

    if (!result.success) {
      console.error('❌ Database insertion failed, halting receipt dispatch.');
      return;
    }

    // 2. Send Receipt to Customer
    if (customerPhone) {
      const receiptMessage = `✅ *SYSTEM ALERT: Payment Confirmed!*\n\nAmount: ₦${amount.toLocaleString()}\nReference: ${reference}\n\nThank you! Your payment has been securely verified. Your order is now being processed and sent to the kitchen. 🍲🔥`;
      
      try {
        await sendWhatsAppMessage(customerPhone, receiptMessage);
        await saveChatMessage(customerPhone, 'model', receiptMessage);
      } catch (err) {
        console.error('❌ Error sending WhatsApp receipt:', err);
      }
    }

    // 3. Send Instant Order Alert to Kitchen / Manager
    const kitchenPhone = process.env.KITCHEN_PHONE_NUMBER;
    if (kitchenPhone) {
      // Filter out delivery fee line so kitchen only sees food to cook
      const foodItemsToPrepare = cartSummary
        .filter(item => !item.item_name.toLowerCase().includes('delivery'))
        .map(item => `• *${item.quantity}x* ${item.item_name}`)
        .join('\n');

      const fulfillmentTypeHeader = isPickup ? '🛍️ *SELF-PICKUP*' : '🚚 *DELIVERY ORDER*';
      const addressSection = isPickup 
        ? '📍 *Fulfillment:* Customer will pick up at restaurant' 
        : `📍 *Delivery Address:* ${deliveryAddress || 'Address provided in chat'}`;

      const kitchenAlert = 
`👨‍🍳 *NEW PAID ORDER RECEIVED!*
-----------------------------------
${fulfillmentTypeHeader}
*Ref:* ${reference}
*Customer Phone:* wa.me/${customerPhone?.replace(/[^0-9]/g, '')} (${customerPhone})

${addressSection}

🍲 *ITEMS TO PREPARE:*
${foodItemsToPrepare || '• See order reference in DB'}

💰 *Total Paid:* ₦${amount.toLocaleString()}
-----------------------------------
🔥 *Status:* Payment Verified. Start preparation!`;

      try {
        await sendWhatsAppMessage(kitchenPhone, kitchenAlert);
        console.log(`📲 Kitchen notification sent to ${kitchenPhone}`);
      } catch (err) {
        console.error('❌ Error sending kitchen notification:', err);
      }
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send('Esthy Kitchen Backend is online!');
});

app.listen(port, () => {
  console.log(`🚀 Server is awake and listening on port ${port}`);
});