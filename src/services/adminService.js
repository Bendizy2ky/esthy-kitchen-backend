// src/services/adminService.js
import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js'; 

const ADMIN_PHONE = (process.env.KITCHEN_PHONE_NUMBER || '').replace(/\D/g, '');

export async function handleAdminCommand(senderNumber, incomingText) {
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');

  if (cleanSender !== ADMIN_PHONE) return false; 
  if (!incomingText.startsWith('!')) return false;

  const args = incomingText.trim().split(' ');
  const command = args[0].toLowerCase();
  const payload = args.slice(1).join(' ');

  // STORE CONTROL
  if (command === '!openkitchen') {
    const { error } = await supabase
      .from('store_status')
      .upsert({ id: 1, is_open: true });

    if (error) {
      console.error('❌ Supabase Open Kitchen Error:', error.message);
      await sendWhatsAppMessage(senderNumber, `❌ Failed to open kitchen: ${error.message}`);
      return true;
    }

    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen OPEN*. AI ordering enabled.');
    return true;
  }

  if (command === '!closekitchen') {
    const { error } = await supabase
      .from('store_status')
      .upsert({ id: 1, is_open: false });

    if (error) {
      console.error('❌ Supabase Close Kitchen Error:', error.message);
      await sendWhatsAppMessage(senderNumber, `❌ Failed to close kitchen: ${error.message}`);
      return true;
    }

    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen CLOSED*. AI ordering paused.');
    return true;
  }

  // MENU & STOCK
  if (command === '!soldout' && payload) {
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: false })
      .ilike('name', payload)
      .select();
    
    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Database Error: ${error.message}`);
      return true;
    }

    if (data && data.length > 0) {
      await sendWhatsAppMessage(senderNumber, `🚫 Marked *${data[0].name}* as sold out.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching: ${payload}`);
    }
    return true;
  }

  if (command === '!available' && payload) {
    const { data, error } = await supabase
      .from('menu_items')
      .update({ is_available: true })
      .ilike('name', payload)
      .select();

    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Database Error: ${error.message}`);
      return true;
    }
    
    if (data && data.length > 0) {
      await sendWhatsAppMessage(senderNumber, `✅ Restored *${data[0].name}* to available.`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Could not find item matching: ${payload}`);
    }
    return true;
  }

  if (['!deleteitem', '!delete_item', '!deletemenu', '!delete_menu'].includes(command) && payload) {
    const { error, count } = await supabase
      .from('menu_items')
      .delete({ count: 'exact' })
      .eq('name', payload);
      
    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Database Error: ${error.message}`);
      return true;
    }

    if (count > 0) {
      await sendWhatsAppMessage(senderNumber, `🗑️ Permanently deleted exact match: ${payload}`);
    } else {
      await sendWhatsAppMessage(senderNumber, `❌ Exact match not found for deletion: ${payload}`);
    }
    return true;
  }

  // AGENT CONTROL
  if (['!human', '!pause'].includes(command) && payload) {
    const cleanCustomer = payload.replace(/\D/g, '');
    const { error } = await supabase
      .from('user_states')
      .upsert({ phone: cleanCustomer, mode: 'human' });

    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Database Error: ${error.message}`);
      return true;
    }

    await sendWhatsAppMessage(senderNumber, `⏸️ AI paused for customer ${cleanCustomer}. You are now in manual control.`);
    return true;
  }

  if (['!bot', '!reset'].includes(command) && payload) {
    const cleanCustomer = payload.replace(/\D/g, '');
    const { error } = await supabase
      .from('user_states')
      .upsert({ phone: cleanCustomer, mode: 'ai' });

    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Database Error: ${error.message}`);
      return true;
    }

    await sendWhatsAppMessage(senderNumber, `▶️ AI resumed for customer ${cleanCustomer}.`);
    return true;
  }

  // HELPER MENU
  if (command === '!admin') {
    const menuMessage = `🛠️ *ESTHY'S KITCHEN ADMIN* 🛠️\n\n` +
      `*Store Control*\n` +
      `!openkitchen\n!closekitchen\n\n` +
      `*Menu & Stock*\n` +
      `!soldout <Item>\n!available <Item>\n!deleteitem <Item>\n\n` +
      `*Agent Control*\n` +
      `!human <Phone>\n!bot <Phone>`;
    await sendWhatsAppMessage(senderNumber, menuMessage);
    return true;
  }

  return false;
}