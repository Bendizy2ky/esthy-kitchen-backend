import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js';

const ADMIN_PHONE = (process.env.KITCHEN_PHONE_NUMBER || '').replace(/\D/g, '');

export async function handleAdminCommand(senderNumber, incomingText, rawMessageData) {
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');

  if (cleanSender !== ADMIN_PHONE) {
    return false;
  }

  const text = incomingText.trim();
  const lowerText = text.toLowerCase();

  // 1. HELP MENU
  if (lowerText === '!admin') {
    const menuMessage = 
`🛠️ *ESTHY'S KITCHEN ADMIN* 🛠️

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
• \`!bot <Phone>\` - Resume AI for customer

_Example:_ \`!price Jollof Rice | 4000\``;

    await sendWhatsAppMessage(senderNumber, menuMessage);
    return true;
  }

  // 2. STORE CONTROL
  if (lowerText === '!openkitchen' || lowerText === '!open') {
    await supabase.from('store_status').upsert({ id: 1, is_open: true });
    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen is now OPEN*. AI customer ordering enabled.');
    return true;
  }

  if (lowerText === '!closekitchen' || lowerText === '!close') {
    await supabase.from('store_status').upsert({ id: 1, is_open: false });
    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen is now CLOSED*. AI ordering paused.');
    return true;
  }

  // 3. CHANGE ITEM PRICE (Preserves past order history)
  if (lowerText.startsWith('!price ')) {
    const payload = text.substring(7).trim();
    const parts = payload.split('|').map(p => p.trim());

    if (parts.length < 2) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Format*\nUse: `!price Item Name | New Price`\n\n_Example:_ `!price Jollof Rice | 4500`');
      return true;
    }

    const [itemName, priceStr] = parts;
    const newPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ''));

    if (isNaN(newPrice)) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Amount*. Please provide a valid numeric price.');
      return true;
    }

    const { data, error } = await supabase
      .from('menu_items')
      .update({ price: newPrice })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching "*${itemName}*" in database.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ Price for *${data[0].name}* updated to ₦${newPrice.toLocaleString()}!`);
    }
    return true;
  }

  // 4. ADD NEW MENU ITEM
  if (lowerText.startsWith('!additem ')) {
    const payload = text.substring(9).trim();
    const parts = payload.split('|').map(p => p.trim());

    if (parts.length < 3) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Format*\nUse: `!additem Item Name | Category | Price`\n\n_Example:_ `!additem Grilled Catfish | Seafood | 6000`');
      return true;
    }

    const [name, category, priceStr] = parts;
    const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));

    if (isNaN(price)) {
      await sendWhatsAppMessage(senderNumber, '❌ *Invalid Amount*. Please provide a valid numeric price.');
      return true;
    }

    const { error } = await supabase
      .from('menu_items')
      .insert([{ name, category, price, is_available: true }]);

    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Error adding item: ${error.message}`);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ Added *${name}* (${category}) at ₦${price.toLocaleString()} to live menu!`);
    }
    return true;
  }

  // 5. TOGGLE SOLDOUT (is_available = false)
  if (lowerText.startsWith('!soldout ')) {
    const itemName = text.substring(9).trim();
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: false })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Item "*${itemName}*" not found.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `🚫 *${data[0].name}* is now marked as Sold Out.`);
    }
    return true;
  }

  // 6. TOGGLE AVAILABLE (is_available = true)
  if (lowerText.startsWith('!available ')) {
    const itemName = text.substring(11).trim();
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: true })
      .ilike('name', `%${itemName}%`)
      .select();

    if (error || !data || data.length === 0) {
      await sendWhatsAppMessage(senderNumber, `❌ Item "*${itemName}*" not found.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `✅ *${data[0].name}* is back on the live menu.`);
    }
    return true;
  }

  return false;
}