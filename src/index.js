// index.js
import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { supabase } from './config/supabase.js';
import { generateAIResponse, SYSTEM_PROMPT, transcribeAudioWithGroq } from './services/aiService.js'; 
import { sendWhatsAppMessage, downloadWhatsAppMedia } from './services/whatsappService.js';
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

  // Extract 'instance' dynamically from the webhook payload
  const { event, data, instance } = req.body;

  if (event === 'messages.upsert') {
    const messageData = data;
    const senderNumber = messageData.key?.remoteJid;
    const isFromMe = messageData.key?.fromMe;
    
    let textMessage = 
      messageData.message?.conversation || 
      messageData.message?.extendedTextMessage?.text;

    if (messageData.message?.listResponseMessage) {
      textMessage = messageData.message.listResponseMessage.singleSelectReply.selectedRowId;
    }

    // 🎤 Check for Voice Notes / Audio Messages
    const isAudio = messageData.message?.audioMessage;

    if (isAudio && !isFromMe && senderNumber !== 'status@broadcast') {
      try {
        console.log(`🎵 Audio message detected via [${instance}] from${senderNumber}, downloading...`);
        
        // Pass the dynamic instance to the download function
        const audioBuffer = await downloadWhatsAppMedia(messageData.key, instance); 
        
        // Transcribe using Groq Whisper
        textMessage = await transcribeAudioWithGroq(audioBuffer);
        console.log(`🎤 Transcribed Voice Note: "${textMessage}"`);
        
      } catch (audioErr) {
        console.error("❌ Audio processing failed:", audioErr);
        await sendWhatsAppMessage(senderNumber, "I couldn't quite hear that. Could you please type your order instead?", instance);
        return;
      }
    }

    if (!isFromMe && textMessage && senderNumber !== 'status@broadcast') {
      
      const isAdminHandled = await handleAdminCommand(senderNumber, textMessage, messageData, instance);
      
      if (isAdminHandled) return; 

      console.log(`💬 Received customer message from ${senderNumber}:${textMessage}`);
      
      try {
        const { data: storeStatus, error: storeErr } = await supabase
          .from('store_status')
          .select('is_open')
          .eq('id', 1)
          .single();

        if (storeErr) throw new Error(`Supabase Store Check Error: ${storeErr.message}`);

        if (storeStatus && storeStatus.is_open === false) {
          const closedMessage = "So sorry, but Esthy's Spicy Kitchen is currently closed! 🛑 We aren't taking orders right now.";
          await sendWhatsAppMessage(senderNumber, closedMessage, instance);
          return;
        }

        const { data: userState, error: userErr } = await supabase
          .from('user_states')
          .select('mode')
          .eq('phone', senderNumber.replace(/\D/g, ''))
          .single();

        if (userErr && userErr.code !== 'PGRST116') { 
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

        const formattedMenu = (menuItems || []).map(item => {
          const timeTag = item.ready_time ? ` [SCHEDULED FOR: ${item.ready_time}]` : '';
          return `- ${item.name} (${item.category || 'Menu'}): ₦${Number(item.price).toLocaleString()}${timeTag}`;
        }).join('\n');

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

If a customer orders an item that has a [SCHEDULED FOR: <Time>] tag next to it in the menu, you MUST explicitly tell them the wait time and ask if they are okay with waiting BEFORE you generate a [GENERATE_LINK] or [BANK_TRANSFER_CLAIMED] tag.
        `;

        const combinedPrompt = `${SYSTEM_PROMPT}\n\n${fullUserPrompt}`;

        let aiResponse = await generateAIResponse(combinedPrompt);

        if (!aiResponse) {
          throw new Error('Groq AI returned an empty response');
        }

        if (aiResponse.trim() === 'IGNORE_MESSAGE') return;

        aiResponse = aiResponse.replace(/\[.*?\]\(https?:\/\/[^\s)]+\)/g, '').trim();

        // 1. Extract JSON cart data and enforce Server-Side Price Verification
        let parsedCartData = null;
        let secureTotalAmount = 0; 
        
        const cartDataMatch = aiResponse.match(/\[CART_DATA:\s*(\[.*?\])\]/s);
        
        if (cartDataMatch) {
          parsedCartData = parseCartData(cartDataMatch[1]);
          aiResponse = aiResponse.replace(cartDataMatch[0], '').trim();

          if (parsedCartData && parsedCartData.length > 0) {
            parsedCartData = parsedCartData.map(item => {
              if (item.item_name.toLowerCase().includes('delivery')) {
                const safeFee = Math.max(0, Number(item.unit_price) || 0);
                secureTotalAmount += (safeFee * item.quantity);
                return { ...item, unit_price: safeFee };
              }
              
              const dbItem = (menuItems || []).find(mi => mi.name.toLowerCase().trim() === item.item_name.toLowerCase().trim());
              
              if (dbItem) {
                const truePrice = Number(dbItem.price);
                const safeQty = Math.max(1, Number(item.quantity) || 1); 
                secureTotalAmount += (truePrice * safeQty);
                return { ...item, unit_price: truePrice, quantity: safeQty, line_total: truePrice * safeQty, ready_time: dbItem.ready_time };
              } else {
                console.warn(`🚨 SECURITY ALERT: Discarding invalid/fake cart item: ${item.item_name}`);
                return { ...item, unit_price: 0, quantity: 0, line_total: 0 }; 
              }
            });
            
            parsedCartData = parsedCartData.filter(item => item.quantity > 0 || item.item_name.toLowerCase().includes('delivery'));
          }
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
          const finalAmount = secureTotalAmount > 0 ? secureTotalAmount : parseInt(paymentMatch[1], 10);
          const paymentUrl = await generatePaymentLink(finalAmount, senderNumber, parsedCartData, deliveryAddress, instance);
          
          if (paymentUrl) {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nHere is your secure payment link: ${paymentUrl}\n\n*Note:* You do not need to send a receipt here. Our system will automatically process your order and send a confirmation the exact moment your payment is successful.`
            );
          } else {
            aiResponse = aiResponse.replace(
              paymentMatch[0], 
              `\nI'm currently unable to generate a payment link. Please manually transfer ₦${finalAmount} to our bank account.`
            );
          }
        }

        // 4. Handle Direct Bank Transfer Claimed
        if (aiResponse.includes('[BANK_TRANSFER_CLAIMED]')) {
          const cleanResponse = aiResponse.replace('[BANK_TRANSFER_CLAIMED]', '').trim();
          await sendWhatsAppMessage(senderNumber, cleanResponse, instance);
          await saveChatMessage(senderNumber, 'model', cleanResponse);

          const orderCode = generateShortOrderCode();
          const cartSummary = parsedCartData || [];
          
          const finalAmount = secureTotalAmount > 0 
            ? secureTotalAmount 
            : cartSummary.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);

          const { error: pendingOrderError } = await supabase.from('pending_orders').insert([{
            order_code: orderCode,
            customer_phone: senderNumber,
            amount: finalAmount,
            cart_data: cartSummary,
            delivery_address: deliveryAddress
          }]);

          if (pendingOrderError) {
            console.error('❌ Error saving pending order:', pendingOrderError);
            return;
          }

          // Loop through all kitchen numbers for Bank Transfer alerts
          const kitchenPhones = process.env.KITCHEN_PHONE_NUMBERS ? process.env.KITCHEN_PHONE_NUMBERS.split(',') : [];
          
          if (kitchenPhones.length > 0) {
            const foodItems = cartSummary
              .filter(item => !item.item_name.toLowerCase().includes('delivery'))
              .map(item => {
                const timeWarning = item.ready_time ? ` ⚠️ [WAIT FOR: ${item.ready_time}]` : '';
                return `• *${item.quantity}x* ${item.item_name}${timeWarning}`;
              })
              .join('\n');
            const managerAlert = 
`🔔 *NEW BANK TRANSFER TO VERIFY!*
-----------------------------------
*Order Ref:* \`${orderCode}\`
*Customer:* wa.me/${senderNumber.replace(/\D/g, '')} (${senderNumber})
*Amount:* ₦${finalAmount.toLocaleString()}
📍 *Address:* ${deliveryAddress || 'Not specified'}

🍲 *ITEMS TO PREPARE:*
${foodItems}

-----------------------------------
👉 *To confirm payment & dispatch order, reply:*
\`!confirm ${orderCode}\``;

            for (const phone of kitchenPhones) {
              if (phone.trim()) await sendWhatsAppMessage(phone.trim(), managerAlert, instance);
            }
          }
          return;
        }

        await sendWhatsAppMessage(senderNumber, aiResponse, instance);
        await saveChatMessage(senderNumber, 'model', aiResponse);

      } catch (error) {
        console.error('❌ Error processing AI workflow:', error.message);
        
        const fallbackMessage = "We are experiencing a brief network delay with our system. ⏳ A staff member has been notified and will be right with you!";
        
        try {
          await sendWhatsAppMessage(senderNumber, fallbackMessage, instance);
        } catch (sendErr) {
          console.error('❌ Failed to send customer fallback message:', sendErr.message);
        }

        // Loop through all kitchen numbers for Error alerts
        const kitchenPhones = process.env.KITCHEN_PHONE_NUMBERS ? process.env.KITCHEN_PHONE_NUMBERS.split(',') : [];
        if (kitchenPhones.length > 0) {
          const cleanCustomer = senderNumber.replace(/\D/g, '');
          const managerErrorAlert = 
`⚠️ *SYSTEM ERROR ALERT!*
-----------------------------------
An issue occurred while processing a message for customer:
📱 *Customer:* wa.me/${cleanCustomer} (${senderNumber})

*Error:* \`${error.message}\`

👉 *Action Needed:* Please check in with the customer manually or reply \`!human ${cleanCustomer}\` to take over.`;

          for (const phone of kitchenPhones) {
             if (phone.trim()) await sendWhatsAppMessage(phone.trim(), managerErrorAlert, instance);
          }
        }
      }
    }
  }
});

// Paystack Webhook
app.post('/webhook/paystack', async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const paystackSignature = req.headers['x-paystack-signature'];

  const hash = crypto.createHmac('sha512', secret)
                     .update(JSON.stringify(req.body))
                     .digest('hex');

  if (hash !== paystackSignature) {
    console.warn('🚨 SECURITY ALERT: Blocked an unauthorized webhook attempt!');
    return res.status(401).send('Unauthorized Request');
  }

  res.status(200).send('Webhook received');

  const event = req.body;

  if (event && event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    const amount = data.amount / 100;
    const customerEmail = data.customer?.email;
    const customerPhone = data.metadata?.customer_phone;
    const cartSummary = data.metadata?.cart_data || []; 
    
    // 👈 NEW: Extract the exact bot instance that generated this link
    const activeInstance = data.metadata?.instance_name || process.env.EVOLUTION_INSTANCE_NAME;
    
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
        // 👈 NEW: Pass activeInstance to send the receipt from the correct bot
        await sendWhatsAppMessage(customerPhone, receiptMessage, activeInstance);
        await saveChatMessage(customerPhone, 'model', receiptMessage);
      } catch (err) {
        console.error('❌ Error sending WhatsApp receipt:', err);
      }
    }

    // Loop through all kitchen numbers for Paystack alerts
    const kitchenPhones = process.env.KITCHEN_PHONE_NUMBERS ? process.env.KITCHEN_PHONE_NUMBERS.split(',') : [];
    if (kitchenPhones.length > 0) {
      const foodItemsToPrepare = cartSummary
        .filter(item => !item.item_name.toLowerCase().includes('delivery'))
        .map(item => {
          const timeWarning = item.ready_time ? ` ⚠️ [WAIT FOR: ${item.ready_time}]` : '';
          return `• *${item.quantity}x* ${item.item_name}${timeWarning}`;
        })
        .join('\n');

      const fulfillmentTypeHeader = isPickup ? '🛍️ *SELF-PICKUP*' : '🚚 *DELIVERY ORDER*';
      const addressDisplay = isPickup 
        ? '📍 *Fulfillment:* Customer will pick up at restaurant' 
        : `📍 *Delivery Address:* ${deliveryAddress}`;

      const kitchenAlert = `👨‍🍳 *NEW PAID ORDER RECEIVED!*\n-----------------------------------\n${fulfillmentTypeHeader}\n*Ref:* ${reference}\n*Customer Phone:* wa.me/${customerPhone?.replace(/[^0-9]/g, '')} (${customerPhone})\n\n${addressDisplay}\n\n🍲 *ITEMS TO PREPARE:*\n${foodItemsToPrepare || '• See order reference in DB'}\n\n💰 *Total Paid:* ₦${amount.toLocaleString()}\n-----------------------------------\n🔥 *Status:* Payment Verified. Start preparation!`;

      for (const phone of kitchenPhones) {
         // 👈 NEW: Pass activeInstance to send alerts from the correct bot
         if (phone.trim()) await sendWhatsAppMessage(phone.trim(), kitchenAlert, activeInstance);
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