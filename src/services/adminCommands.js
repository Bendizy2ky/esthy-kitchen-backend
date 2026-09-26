const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const ADMIN_NUMBERS = (process.env.ADMIN_PHONE_NUMBERS || '').split(',').map(n => n.trim());

/**
 * Sends a WhatsApp reply back through Evolution API
 */
async function sendWhatsAppReply(to, text) {
  try {
    await axios.post(
      `${process.env.EVOLUTION_API_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE_NAME}`,
      {
        number: to,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text }
      },
      {
        headers: { apikey: process.env.EVOLUTION_API_KEY }
      }
    );
  } catch (error) {
    console.error('Error sending WhatsApp reply:', error?.response?.data || error.message);
  }
}

/**
 * Process admin command if sender is authorized
 */
async function handleAdminCommand(cleanSender, text) {
  // Check if sender is an authorized admin
  if (!ADMIN_NUMBERS.includes(cleanSender)) {
    await sendWhatsAppReply(cleanSender, '⚠️ *Unauthorized:* You are not registered as an Admin.');
    return true;
  }

  const lower = text.toLowerCase().trim();

  // 1. Kitchen Open/Close (!openkitchen / !closekitchen)
  if (lower === '!openkitchen' || lower === '!closekitchen') {
    const isOpen = lower === '!openkitchen';
    await supabase.from('store_status').upsert({ id: 1, is_open: isOpen });
    
    const msg = isOpen 
      ? `🟢 *Esthy's Kitchen is now OPEN for orders!*` 
      : `🔴 *Esthy's Kitchen is now CLOSED.* AI ordering is disabled.`;
    await sendWhatsAppReply(cleanSender, msg);
    return true;
  }

  // 2. Item Availability (!soldout <Item> / !available <Item>)
  if (lower.startsWith('!soldout') || lower.startsWith('!available')) {
    const isSoldOut = lower.startsWith('!soldout');
    const itemName = text.replace(/^!(soldout|available)\s+/i, '').trim();

    if (!itemName) {
      await sendWhatsAppReply(cleanSender, '⚠️ Please specify an item name.');
      return true;
    }

    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: !isSoldOut })
      .ilike('name', itemName);

    if (error) {
      await sendWhatsAppReply(cleanSender, `❌ Error updating database: ${error.message}`);
    } else {
      const msg = isSoldOut 
        ? `🔴 *${itemName}* marked as **SOLD OUT**.` 
        : `🟢 *${itemName}* marked as **AVAILABLE**.`;
      await sendWhatsAppReply(cleanSender, msg);
    }
    return true;
  }

  // 3. Toggle Human Agent Mode (!human <Phone> / !reset <Phone>)
  if (lower.startsWith('!human') || lower.startsWith('!pause') || lower.startsWith('!bot') || lower.startsWith('!reset')) {
    const isHuman = lower.startsWith('!human') || lower.startsWith('!pause');
    const targetPhone = text.replace(/^!(human|pause|bot|reset)\s*/i, '').replace(/\D/g, '').trim();

    if (!targetPhone) {
      await sendWhatsAppReply(cleanSender, '⚠️ Please specify a valid customer phone number.');
      return true;
    }

    const { error } = await supabase
      .from('customers')
      .update({ is_human_agent: isHuman })
      .eq('phone', targetPhone);

    if (error) {
      await sendWhatsAppReply(cleanSender, `❌ Database error: ${error.message}`);
    } else {
      const msg = isHuman 
        ? `⏸️ AI Agent paused for *${targetPhone}*. Switched to Human Agent mode.` 
        : `✅ AI Agent re-enabled for *${targetPhone}*!`;
      await sendWhatsAppReply(cleanSender, msg);
    }
    return true;
  }

  // 4. Delete Menu Item (!deleteitem <Item> / !deletemenu <Item>)
  if (lower.startsWith('!deleteitem') || lower.startsWith('!deletemenu')) {
    const itemName = text.replace(/^!(deleteitem|deletemenu)\s+/i, '').trim();

    if (!itemName) {
      await sendWhatsAppReply(cleanSender, '⚠️ Please specify an item name to delete.');
      return true;
    }

    const { error } = await supabase
      .from('menu_items')
      .delete()
      .ilike('name', itemName);

    if (error) {
      await sendWhatsAppReply(cleanSender, `❌ Error deleting item: ${error.message}`);
    } else {
      await sendWhatsAppReply(cleanSender, `🗑️ *${itemName}* permanently deleted from menu.`);
    }
    return true;
  }

  return false; // Not an admin command
}

module.exports = { handleAdminCommand };