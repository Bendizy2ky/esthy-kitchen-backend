import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js';

// Target kitchen/admin phone number
const ADMIN_PHONE = (process.env.KITCHEN_PHONE_NUMBER || '').replace(/\D/g, '');

export async function handleAdminCommand(senderNumber, incomingText, rawMessageData) {
  // Clean incoming sender number (e.g. "2348138412871@s.whatsapp.net" or "2348138412871:12@s.whatsapp.net")
  const cleanSender = senderNumber.split('@')[0].split(':')[0].replace(/\D/g, '');

  // If message is not from the authorized admin phone, pass it to customer AI
  if (cleanSender !== ADMIN_PHONE) {
    return false; 
  }

  console.log(`🔑 Admin command received from ${cleanSender}: "${incomingText}"`);

  // 1. Trigger Main Admin Menu
  if (incomingText.toLowerCase() === '!admin') {
    await sendAdminMainMenu(senderNumber);
    return true; 
  }

  // 2. Handle Interactive List Clicks
  if (incomingText === 'CMD_OPEN_KITCHEN') {
    await supabase.from('store_status').upsert({ id: 1, is_open: true });
    await sendWhatsAppMessage(senderNumber, '🟢 *Kitchen is now OPEN*. AI customer ordering is enabled.');
    return true;
  }

  if (incomingText === 'CMD_CLOSE_KITCHEN') {
    await supabase.from('store_status').upsert({ id: 1, is_open: false });
    await sendWhatsAppMessage(senderNumber, '🔴 *Kitchen is now CLOSED*. AI ordering is paused.');
    return true;
  }

  if (incomingText === 'CMD_SHOW_SOLDOUT_LIST') {
    await sendSoldOutSelectionList(senderNumber);
    return true;
  }

  if (incomingText.startsWith('SOLDOUT_ITEM_')) {
    const itemId = incomingText.replace('SOLDOUT_ITEM_', '').trim();
    const { error } = await supabase.from('menu_items').update({ is_available: false }).eq('id', itemId);
    
    if (error) {
      await sendWhatsAppMessage(senderNumber, `❌ Error updating item: ${error.message}`);
    } else {
      await sendWhatsAppMessage(senderNumber, '🚫 Item has been marked as *Sold Out*.');
    }
    return true;
  }

  return false;
}

// Helper: Send Main Menu via Evolution API
async function sendAdminMainMenu(to) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME; // Matches Render key EVOLUTION_INSTANCE_NAME
  const apiKey = process.env.EVOLUTION_API_KEY;

  const listPayload = {
    number: to,
    title: "🛠️ ESTHY'S KITCHEN ADMIN",
    description: "Select an operation below. No typing required.",
    buttonText: "Admin Menu",
    sections: [
      {
        title: "Store Control",
        rows: [
          { title: "Open Kitchen", rowId: "CMD_OPEN_KITCHEN", description: "Enable AI customer ordering" },
          { title: "Close Kitchen", rowId: "CMD_CLOSE_KITCHEN", description: "Disable AI customer ordering" }
        ]
      },
      {
        title: "Menu & Inventory",
        rows: [
          { title: "Mark Item Sold Out", rowId: "CMD_SHOW_SOLDOUT_LIST", description: "Remove item from live menu" }
        ]
      }
    ]
  };

  try {
    const res = await fetch(`${evolutionApiUrl}/message/sendList/${instanceName}`, {
      method: 'POST',
      headers: { 
        'apikey': apiKey, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify(listPayload)
    });
    
    const responseData = await res.json();
    console.log('📲 Admin List API response:', responseData);
  } catch (err) {
    console.error('❌ Failed to send Admin List Menu:', err);
  }
}

// Helper: Send List of Available Items to Mark Sold Out
async function sendSoldOutSelectionList(to) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME; 
  const apiKey = process.env.EVOLUTION_API_KEY;

  const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true);
  
  if (!menuItems || menuItems.length === 0) {
    return sendWhatsAppMessage(to, 'All items are currently marked as sold out.');
  }

  const rows = menuItems.map(item => ({
    title: item.name,
    rowId: `SOLDOUT_ITEM_${item.id}`,
    description: `Current Price: ₦${Number(item.price).toLocaleString()}`
  }));

  const listPayload = {
    number: to,
    title: "🚫 Mark as Sold Out",
    description: "Select an item to remove from the live menu:",
    buttonText: "Select Item",
    sections: [{ title: "Available Items", rows }]
  };

  try {
    await fetch(`${evolutionApiUrl}/message/sendList/${instanceName}`, {
      method: 'POST',
      headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(listPayload)
    });
  } catch (err) {
    console.error('❌ Failed to send Sold Out List:', err);
  }
}