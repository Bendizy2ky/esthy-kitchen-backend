import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js'; 

const ADMIN_PHONE = (process.env.KITCHEN_PHONE_NUMBER || '').replace(/\D/g, '');

export async function handleAdminCommand(senderNumber, incomingText, rawMessageData) {
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');

  if (cleanSender !== ADMIN_PHONE) {
    return false; 
  }

  const text = incomingText.trim().toLowerCase();

  // 1. MAIN MENU
  if (text === '!admin') {
    const menuMessage = `🛠️ *ESTHY'S KITCHEN ADMIN* 🛠️\n\n` +
      `Reply with any of these exact commands:\n\n` +
      `🟢 *!open* - Enable AI ordering\n` +
      `🔴 *!close* - Disable AI ordering\n` +
      `🚫 *!soldout* - Hide items from the menu\n` +
      `✅ *!restore* - Bring hidden items back`;
      
    await sendWhatsAppMessage(senderNumber, menuMessage);
    return true; 
  }

  // 2. STORE TOGGLES
  if (text === '!open') {
    await supabase.from('store_status').upsert({ id: 1, is_open: true });
    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen is now OPEN*. AI customer ordering is enabled.');
    return true;
  }

  if (text === '!close') {
    await supabase.from('store_status').upsert({ id: 1, is_open: false });
    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen is now CLOSED*. AI ordering is paused.');
    return true;
  }

  // 3. SHOW ACTIVE ITEMS (TO MARK SOLD OUT)
  if (text === '!soldout') {
    const { data: menuItems } = await supabase.from('menu_items')
      .select('*').eq('is_available', true).order('name');
    
    if (!menuItems || menuItems.length === 0) {
      await sendWhatsAppMessage(senderNumber, 'All items are currently marked as sold out.');
      return true;
    }

    let listText = `🚫 *MARK AS SOLD OUT*\nReply with the command to hide an item:\n\n`;
    menuItems.forEach((item, index) => {
      listText += `*!hide ${index + 1}* - ${item.name}\n`;
    });

    await sendWhatsAppMessage(senderNumber, listText);
    return true;
  }

  // 4. EXECUTE HIDE ITEM
  if (text.startsWith('!hide ')) {
    const itemNum = parseInt(text.replace('!hide ', '').trim(), 10);
    if (isNaN(itemNum)) return true;

    const { data: menuItems } = await supabase.from('menu_items')
      .select('*').eq('is_available', true).order('name');
    
    if (!menuItems || itemNum < 1 || itemNum > menuItems.length) return true;

    const itemToHide = menuItems[itemNum - 1];
    const { error } = await supabase.from('menu_items').update({ is_available: false }).eq('id', itemToHide.id);
    
    if (!error) {
      await sendWhatsAppMessage(senderNumber, `🚫 *${itemToHide.name}* has been marked as Sold Out.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Error: ${error.message}`);
    }
    return true;
  }

  // 5. SHOW HIDDEN ITEMS (TO RESTORE)
  if (text === '!restore') {
    const { data: menuItems } = await supabase.from('menu_items')
      .select('*').eq('is_available', false).order('name');
    
    if (!menuItems || menuItems.length === 0) {
      await sendWhatsAppMessage(senderNumber, '✅ All items are currently available on the menu.');
      return true;
    }

    let listText = `✅ *RESTORE ITEM*\nReply with the command to make an item available again:\n\n`;
    menuItems.forEach((item, index) => {
      listText += `*!add ${index + 1}* - ${item.name}\n`;
    });

    await sendWhatsAppMessage(senderNumber, listText);
    return true;
  }

  // 6. EXECUTE RESTORE ITEM
  if (text.startsWith('!add ')) {
    const itemNum = parseInt(text.replace('!add ', '').trim(), 10);
    if (isNaN(itemNum)) return true;

    const { data: menuItems } = await supabase.from('menu_items')
      .select('*').eq('is_available', false).order('name');
      
    if (!menuItems || itemNum < 1 || itemNum > menuItems.length) return true;

    const itemToAdd = menuItems[itemNum - 1];
    const { error } = await supabase.from('menu_items').update({ is_available: true }).eq('id', itemToAdd.id);
    
    if (!error) {
      await sendWhatsAppMessage(senderNumber, `✅ *${itemToAdd.name}* is now back on the live menu!`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Error: ${error.message}`);
    }
    return true;
  }

  return false;
}