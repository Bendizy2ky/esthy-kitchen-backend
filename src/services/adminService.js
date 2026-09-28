import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js'; 

const ADMIN_PHONE = (process.env.KITCHEN_PHONE_NUMBER || '').replace(/\D/g, '');

export async function handleAdminCommand(senderNumber, incomingText) {
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');

  if (cleanSender !== ADMIN_PHONE) return false; 
  if (!incomingText.startsWith('!')) return false;

  const args = incomingText.trim().split(' ');
  const command = args[0].toLowerCase();
  const payload = args.slice(1).join(' '); // Everything after the command

  // STORE CONTROL
  if (command === '!openkitchen') {
    await supabase.from('store_status').upsert({ id: 1, is_open: true });
    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen OPEN*. AI ordering enabled.');
    return true;
  }

  if (command === '!closekitchen') {
    await supabase.from('store_status').upsert({ id: 1, is_open: false });
    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen CLOSED*. AI ordering paused.');
    return true;
  }

  // MENU & STOCK
  if (command === '!soldout' && payload) {
    const { data, error } = await supabase.from('menu_items')
      .update({ is_available: false }).ilike('name', payload).select();
    
    if (data && data.length > 0) {
      await sendWhatsAppMessage(senderNumber, `🚫 Marked *${data[0].name}* as sold out.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching: ${payload}`);
    }
    return true;
  }

  if (command === '!available' && payload) {
    const { data, error } = await supabase.from('menu_items')
      .update({ is_available: true }).ilike('name', payload).select();
    
    if (data && data.length > 0) {
      await sendWhatsAppMessage(senderNumber, `✅ Restored *${data[0].name}* to available.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching: ${payload}`);
    }
    return true;
  }

  if (['!deleteitem', '!delete_item', '!deletemenu', '!delete_menu'].includes(command) && payload) {
    // Exact case match required for deletion as per operational rules
    const { error, count } = await supabase.from('menu_items')
      .delete({ count: 'exact' }).eq('name', payload);
      
    if (!error && count > 0) {
      await sendWhatsAppMessage(senderNumber, `🗑️ Permanently deleted exact match: ${payload}`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Exact match not found for deletion: ${payload}`);
    }
    return true;
  }

  if (command === '!menu' && payload) {
    await sendWhatsAppMessage(senderNumber, `⚙️ Bulk menu updates for [${payload}] triggered (Database sync pending integration).`);
    return true;
  }

  // AGENT CONTROL
  if (['!human', '!pause'].includes(command) && payload) {
    const cleanCustomer = payload.replace(/\D/g, '');
    await supabase.from('user_states').upsert({ phone: cleanCustomer, mode: 'human' });
    await sendWhatsAppMessage(senderNumber, `⏸️ AI paused for customer ${cleanCustomer}. You are now in manual control.`);
    return true;
  }

  if (['!bot', '!reset'].includes(command) && payload) {
    const cleanCustomer = payload.replace(/\D/g, '');
    await supabase.from('user_states').upsert({ phone: cleanCustomer, mode: 'ai' });
    await sendWhatsAppMessage(senderNumber, `▶️ AI resumed for customer ${cleanCustomer}.`);
    return true;
  }

  // FULFILLMENT
  if (command === '!approve' && payload) {
    const cleanId = payload.replace('-', '').toUpperCase();
    await sendWhatsAppMessage(senderNumber, `✅ Order ${cleanId} approved. Generating receipt...`);
    return true;
  }

  // HELPER MENU
  if (command === '!admin') {
    const menuMessage = `🛠️ *ESTHY'S KITCHEN ADMIN* 🛠️\n\n` +
      `*Store Control*\n` +
      `!openkitchen\n!closekitchen\n\n` +
      `*Menu & Stock*\n` +
      `!soldout <Item>\n!available <Item>\n!deleteitem <Item>\n!menu <Items>\n\n` +
      `*Agent Control*\n` +
      `!human <Phone>\n!bot <Phone>\n\n` +
      `*Fulfillment*\n` +
      `!approve <ID>`;
    await sendWhatsAppMessage(senderNumber, menuMessage);
    return true;
  }

  return false;
}