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
import { handleAdminCommand } from './services/adminService.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

function generateShortOrderCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'up', message: "Esthy's Spicy Kitchen Backend is running smoothly!" });
});

// WhatsApp Redirect Route
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
          window.location.href = "whatsapp://send?phone=${botPhone}";
          setTimeout(() => { window.location.href = "https://wa.me/${botPhone}"; }, 2000);
        </script>
      </body>
    </html>
  `);
});

// WhatsApp Webhook
app.post('/webhook/whatsapp', async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  const { event, data } = req.body;

  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key?.remoteJid;
    const isFromMe = messageData.key?.fromMe;
    
    // Extract text from either normal message OR an Interactive List reply
    let textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text;

    // EVOLUTION API LIST RESPONSE EXTRACTION
    if (messageData.message?.listResponseMessage) {
      textMessage = messageData.message.listResponseMessage.singleSelectReply.selectedRowId;
    }

    if (!isFromMe && textMessage && senderNumber !== 'status@broadcast') {
      
      // 1. Check if it's an Admin Command FIRST
      const isAdminHandled = await handleAdminCommand(senderNumber, textMessage, messageData);
      
      // If the admin service handled it, stop execution here. Do not trigger AI.
      if (isAdminHandled) return; 

      // NORMAL CUSTOMER AI FLOW BEGINS HERE
      console.log(`💬 Received customer message from ${senderNumber}:${textMessage}`);
      
      try {
        // 2. CHECK IF KITCHEN IS OPEN
        const { data: storeStatus, error: storeErr } = await supabase
          .from('store_status')
          .select('is_open')
          .eq('id', 1)
          .single();

        if (storeErr) throw new Error(`Supabase Store Check Error: ${storeErr.message}`);

        if (storeStatus && storeStatus.is_open === false) {
          const closedMessage = "So sorry, but Esthy's Spicy Kitchen is currently closed! 🛑 We aren't taking orders right now.";
          await sendWhatsAppMessage(senderNumber, closedMessage);
          return;
        }

        // 3. CHECK IF USER IS IN HUMAN MODE
        const { data: userState, error: userErr } = await supabase
          .from('user_states')
          .select('mode')
          .eq('phone', senderNumber.replace(/\D/g, ''))
          .single();

        if (userErr && userErr.code !== 'PGRST116') { 
          // Ignore PGRST116 (no rows found for new users)
          console.error('Supabase User State Error:', userErr.message);
        }

        if (userState && userState.mode === 'human') {
          return;
        }

        await saveChatMessage(senderNumber, 'user', textMessage);

        const { data: menuItems, error: menuErr } = await supabase
          .from('menu_items') 
          .select('*')
          .eq('is_available', true);

        if (menuErr) throw new Error(`Supabase Menu Fetch Error: ${menuErr.message}`);

        const formattedMenu = (menuItems || []).map(item => 
          `- ${item.name} (${item.category || 'Menu'}): ₦${Number(item.price).toLocaleString()}`
        ).join('\n');

        const history = await getChatHistory(senderNumber, 8);
        const historyText = history.map(msg => 
          `${msg.role === 'user' ? 'Customer' : 'Assistant'}:${msg.content}`
        ).join('\n');

        const fullUserPrompt = `
Customer Phone: ${senderNumber}

Recent Chat History:
${historyText || 'No previous history.'}

Customer's New Message: "${textMessage}"

Today's Live Menu:
${formattedMenu || 'EMPTY'}

CRITICAL INSTRUCTION: If you are finalizing the order and generating a [GENERATE_LINK: <amount>] or [BANK_TRANSFER_CLAIMED] tag in this response, you MUST also output the customer's delivery address (extracted from the chat history) using the format [ADDRESS: <Full Delivery Address>]. If it is a pickup order, output [ADDRESS: Self-Pickup].
        `;

        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        // Call AI Provider with safety check
        let aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          throw new Error('Groq AI returned an empty response');
        }

        if (aiResponse.trim() === 'IGNORE_MESSAGE') return;

        aiResponse = aiResponse.replace(/\[.*?\]\(https?:\/\/[^\s)]+\)/g, '').trim();

        // 1. Extract JSON cart data
        let parsedCartData = null;
        const cartDataMatch = aiResponse.match(/\[CART_DATA:\s*(\[.*?\])\]/s);
        
        if (cartDataMatch) {
          parsedCartData = parseCartData(cartDataMatch[1]);
          aiResponse = aiResponse.replace(cartDataMatch[0], '').trim();
        }

        // 2. Extract Delivery Address
        let deliveryAddress = "";
        const addressMatch = aiResponse.match(/\[ADDRESS:\s*(.*?)\]/);
        
        if (addressMatch) {
          deliveryAddress = addressMatch[1].trim();
          aiResponse = aiResponse.replace(addressMatch[0], '').trim();
        }

        // 3. Handle Paystack Online Link
        const paymentMatch = aiResponse.match(/\[GENERATE_LINK:\s*(\d+)\]/);

        if (paymentMatch) {
          const amount = parseInt(paymentMatch[1], 10);
          const paymentUrl = await generatePaymentLink(amount, senderNumber, parsedCartData, deliveryAddress);
          
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

        // 4. Handle Direct Bank Transfer Claimed
        if (aiResponse.includes('[BANK_TRANSFER_CLAIMED]')) {
          const cleanResponse = aiResponse.replace('[BANK_TRANSFER_CLAIMED]', '').trim();
          await sendWhatsAppMessage(senderNumber, cleanResponse);
          await saveChatMessage(senderNumber, 'model', cleanResponse);

          const orderCode = generateShortOrderCode();
          const cartSummary = parsedCartData || [];
          const totalAmount = cartSummary.reduce(
            (sum, item) => sum + (item.unit_price * item.quantity),
            0
          );

          const { error: pendingOrderError } = await supabase.from('pending_orders').insert([{
            order_code: orderCode,
            customer_phone: senderNumber,
            amount: totalAmount,
            cart_data: cartSummary,
            delivery_address: deliveryAddress
          }]);

          if (pendingOrderError) {
            console.error('❌ Error saving pending order:', pendingOrderError);
            return;
          }

          const kitchenPhone = process.env.KITCHEN_PHONE_NUMBER;
          if (kitchenPhone) {
            const foodItems = cartSummary.map(item => `• *${item.quantity}x* ${item.item_name}`).join('\n');
            const managerAlert = 
`🔔 *NEW BANK TRANSFER TO VERIFY!*
-----------------------------------
*Order Ref:* \`${orderCode}\`
*Customer:* wa.me/${senderNumber.replace(/\D/g, '')} (${senderNumber})
*Amount:* ₦${totalAmount.toLocaleString()}
📍 *Address:* ${deliveryAddress || 'Not specified'}

🍲 *ITEMS TO PREPARE:*
${foodItems}

-----------------------------------
👉 *To confirm payment & dispatch order, reply:*
\`!confirm ${orderCode}\``;

            await sendWhatsAppMessage(kitchenPhone, managerAlert);
          }
          return;
        }

        await sendWhatsAppMessage(senderNumber, aiResponse);
        await saveChatMessage(senderNumber, 'model', aiResponse);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error.message);
        
        // GRACEFUL FALLBACK TO CUSTOMER
        const fallbackMessage = "We are experiencing a brief network delay with our system. ⏳ A staff member has been notified and will be right with you!";
        
        try {
          await sendWhatsAppMessage(senderNumber, fallbackMessage);
        } catch (sendErr) {
          console.error('❌ Failed to send fallback message:', sendErr.message);
        }
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
    
    const cartSummary = data.metadata?.cart_data || []; 
    
    // We now solely rely on the metadata address attached during link generation
    let deliveryAddress = data.metadata?.delivery_address;

    if (!deliveryAddress || deliveryAddress.toLowerCase() === 'none') {
       deliveryAddress = 'Not provided';
    }

    const isPickup = data.metadata?.is_pickup || 
                     (!deliveryAddress && !cartSummary.some(i => i.item_name.toLowerCase().includes('delivery'))) ||
                     deliveryAddress.toLowerCase().includes('pickup');

    console.log(`🎉 Successful payment confirmed: ₦${amount} (Ref: ${reference})`);

    const orderData = { reference, customerPhone, amount, customerEmail };

    const result = await createCompleteOrder(orderData, cartSummary);
    if (!result.success) return;

    if (customerPhone) {
      const receiptMessage = `✅ *SYSTEM ALERT: Payment Confirmed!*\n\nAmount: ₦${amount.toLocaleString()}\nReference: ${reference}\n\nThank you! Your payment has been securely verified. Your order is now being processed and sent to the kitchen. 🍲🔥`;
      
      try {
        await sendWhatsAppMessage(customerPhone, receiptMessage);
        await saveChatMessage(customerPhone, 'model', receiptMessage);
      } catch (err) {
        console.error('❌ Error sending WhatsApp receipt:', err);
      }
    }

    const kitchenPhone = process.env.KITCHEN_PHONE_NUMBER;
    if (kitchenPhone) {
      const foodItemsToPrepare = cartSummary
        .filter(item => !item.item_name.toLowerCase().includes('delivery'))
        .map(item => `• *${item.quantity}x* ${item.item_name}`)
        .join('\n');

      const fulfillmentTypeHeader = isPickup ? '🛍️ *SELF-PICKUP*' : '🚚 *DELIVERY ORDER*';
      const addressDisplay = isPickup 
        ? '📍 *Fulfillment:* Customer will pick up at restaurant' 
        : `📍 *Delivery Address:* ${deliveryAddress}`;

      const kitchenAlert = 
`👨‍🍳 *NEW PAID ORDER RECEIVED!*
-----------------------------------
${fulfillmentTypeHeader}
*Ref:* ${reference}
*Customer Phone:* wa.me/${customerPhone?.replace(/[^0-9]/g, '')} (${customerPhone})

${addressDisplay}

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