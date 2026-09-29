import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js';
import { createCompleteOrder } from './orderService.js';
import { saveChatMessage } from './chatService.js';

export async function handleAdminCommand(senderNumber, incomingText, rawMessageData, instanceName) {
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');
  
  const adminPhonesStr = process.env.ADMIN_PHONE_NUMBERS || process.env.KITCHEN_PHONE_NUMBERS || '';
  
  const adminPhones = adminPhonesStr
    .split(',')
    .map(phone => phone.trim().replace(/\D/g, ''))
    .filter(Boolean);

  if (!adminPhones.includes(cleanSender)) {
    return false;
  }

  const text = incomingText.trim();
  const lowerText = text.toLowerCase();

  if (lowerText === '!admin') {
    const menuMessage = 
`🛠️ *ESTHY'S KITCHEN ADMIN* 🛠️

*Payment Verifications*
• \`!pending\` - View unverified bank transfers
• \`!confirm <OrderCode>\` - Approve bank transfer

*Store Control*
• \`!openkitchen\` - Enable AI customer ordering
• \`!closekitchen\` - Pause AI customer ordering

*Stock & Price Management*
• \`!soldout <Item Name>\` - Hide item from live menu
• \`!available <Item Name>\` - Unhide item on live menu
• \`!price <Item Name> | <New Price>\` - Change item price
• \`!additem <Name> | <Category> | <Price>\` - Add new dish

*Live Chat Takeover*
• \`!human <Phone>\` - Pause AI for customer
• \`!bot <Phone>\` - Resume AI for customer`;

    await sendWhatsAppMessage(senderNumber, menuMessage, instanceName);
    return true;
  }

  if (lowerText.startsWith('!confirm ')) {
    const orderCode = text.substring(9).trim().toUpperCase();

    const { data: pending, error } = await supabase
      .from('pending_orders')
      .select('*')
      .eq('order_code', orderCode)
      .single();

    if (error || !pending) {
      await sendWhatsAppMessage(senderNumber, `❌ No pending order found with ref *${orderCode}*.`, instanceName);
      return true;
    }

    const orderPayload = {
      reference: `BANK_${pending.order_code}`,
      customerPhone: pending.customer_phone,
      amount: pending.amount,
      payment_method: 'bank_transfer'
    };

    const dbResult = await createCompleteOrder(orderPayload, pending.cart_data);

    if (!dbResult.success) {
      await sendWhatsAppMessage(senderNumber, `❌ Failed to save order to main DB: ${dbResult.error}`, instanceName);
      return true;
    }

    await supabase.from('pending_orders').delete().eq('order_code', orderCode);

    const customerSuccessMsg = 
`✅ *PAYMENT CONFIRMED & ORDER PLACED!*

*Order Ref:* ${pending.order_code}
*Amount Paid:* ₦${pending.amount.toLocaleString()}

Thank you! Your bank transfer has been manually verified by the kitchen manager. Your meal is now being prepared! 🍲🔥`;

    await sendWhatsAppMessage(pending.customer_phone, customerSuccessMsg, instanceName);
    await saveChatMessage(pending.customer_phone, 'model', customerSuccessMsg);

    await sendWhatsAppMessage(senderNumber, `✅ Payment verified for *${pending.order_code}*! Order moved to main DB and customer notified.`, instanceName);
    return true;
  }

  if (lowerText === '!pending') {
    const { data: list } = await supabase.from('pending_orders').select('*');

    if (!list || list.length === 0) {
      await sendWhatsAppMessage(senderNumber, '👌 No pending bank transfers awaiting verification.', instanceName);
      return true;
    }

    const itemsList = list.map(p => `• *${p.order_code}* | ₦${p.amount.toLocaleString()} \vert{}${p.customer_phone}`).join('\n');
    await sendWhatsAppMessage(senderNumber, `📋 *PENDING BANK TRANSFERS:* \n\n${itemsList}\n\n_Reply \`!confirm <code\` to approve._`, instanceName);
    return true;
  }

  if (lowerText === '!openkitchen' || lowerText === '!open') {
    await supabase.from('store_status').upsert({ id: 1, is_open: true });
    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen is now OPEN*. AI customer ordering enabled.', instanceName);
    return true;
  }

  if (lowerText === '!closekitchen' || lowerText === '!close') {
    await supabase.from('store_status').upsert({ id: 1, is_open: false });
    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen is now CLOSED*. AI ordering paused.', instanceName);
    return true;
  }

  if (lowerText.startsWith('!price ')) {
    const payload = text.substring(7).trim();
    const parts = payload.split('|').map(p => p.trim());

    if (parts.length < 2) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Format*\nUse: `!price Item Name | New Price`', instanceName);
      return true;
    }

    const [itemName, priceStr] = parts;
    const newPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ''));

    if (isNaN(newPrice)) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Amount*. Please provide a valid numeric price.', instanceName);
      return true;
    }

    const { data, error } = await supabase
      .from('menu_items')
      .update({ price: newPrice })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching "*${itemName}*" in database.`, instanceName);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ Price for *${data[0].name}* updated to ₦${newPrice.toLocaleString()}!`, instanceName);
    }
    return true;
  }

  if (lowerText.startsWith('!additem ')) {
    const payload = text.substring(9).trim();
    const parts = payload.split('|').map(p => p.trim());

    if (parts.length < 3) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Format*\nUse: `!additem Item Name | Category | Price`', instanceName);
      return true;
    }

    const [name, category, priceStr] = parts;
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));

    if (isNaN(price)) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Amount*.', instanceName);
      return true;
    }

    const { error } = await supabase
      .from('menu_items')
      .insert([{ name, category, price, is_available: true }]);

    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Error adding item: ${error.message}`, instanceName);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ Added *${name}* (${category}) at ₦${price.toLocaleString()} to live menu!`, instanceName);
    }
    return true;
  }

  if (lowerText.startsWith('!soldout ')) {
    const itemName = text.substring(9).trim();
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: false })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Item "*${itemName}*" not found.`, instanceName);
    } else {
      await sendWhatsAppMessage(senderNumber, `🚫 *${data[0].name}* is now marked as Sold Out.`, instanceName);
    }
    return true;
  }

  if (lowerText.startsWith('!available ')) {
    const itemName = text.substring(11).trim();
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: true })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Item "*${itemName}*" not found.`, instanceName);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ *${data[0].name}* is back on the live menu.`, instanceName);
    }
    return true;
  }

  if (lowerText.startsWith('!human ')) {
    const targetPhone = text.substring(7).trim().replace(/\D/g, '');
    await supabase.from('user_states').upsert({ phone: targetPhone, mode: 'human' });
    await sendWhatsAppMessage(senderNumber, `👤 AI paused for user *${targetPhone}*. You can now chat directly.`, instanceName);
    return true;
  }

  if (lowerText.startsWith('!bot ')) {
    const targetPhone = text.substring(5).trim().replace(/\D/g, '');
    await supabase.from('user_states').upsert({ phone: targetPhone, mode: 'bot' });
    await sendWhatsAppMessage(senderNumber, `🤖 AI resumed for user *${targetPhone}*.`, instanceName);
    return true;
  }

  return false;
}