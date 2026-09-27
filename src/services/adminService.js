import { supabase } from '../config/supabase.js';
import { sendWhatsAppMessage } from './whatsappService.js'; // Assuming this exists to send normal text
// Note: You will need to add a function in whatsappService to send List Messages based on Evolution API docs.

const ADMIN_PHONE = process.env.KITCHEN_PHONE_NUMBER?.replace(/[^0-9]/g, '');

export async function handleAdminCommand(senderNumber, incomingText, rawMessageData) {
  const phone = senderNumber.replace(/[^0-9]/g, '');
  if (phone !== ADMIN_PHONE) return false; // Not an admin, let AI handle it

  // 1. Trigger Main Menu
  if (incomingText.toLowerCase() === '!admin') {
    await sendAdminMainMenu(senderNumber);
    return true; 
  }

  // 2. Handle Interactive List/Button Clicks
  // Evolution API sends interactive responses in specific objects. 
  // We check if the incoming text matches our predefined admin exact commands.
  
  if (incomingText === 'CMD_OPEN_KITCHEN') {
    // Update store status in Supabase (assuming you have a store_status table)
    await supabase.from('store_status').update({ is_open: true }).eq('id', 1);
    await sendWhatsAppMessage(senderNumber, '✅ *Kitchen is now OPEN*. AI ordering is enabled.');
    return true;
  }

  if (incomingText === 'CMD_CLOSE_KITCHEN') {
    await supabase.from('store_status').update({ is_open: false }).eq('id', 1);
    await sendWhatsAppMessage(senderNumber, '🛑 *Kitchen is now CLOSED*. AI ordering is paused.');
    return true;
  }

  if (incomingText === 'CMD_SHOW_SOLDOUT_LIST') {
    await sendSoldOutSelectionList(senderNumber);
    return true;
  }

  // 3. Handle Dynamic Item Selection (e.g., Admin clicked "Spicy Jollof Rice" to sell out)
  if (incomingText.startsWith('SOLDOUT_ITEM_')) {
    const itemId = incomingText.split('_')[2];
    await supabase.from('menu_items').update({ is_available: false }).eq('id', itemId);
    await sendWhatsAppMessage(senderNumber, '🚫 Item marked as *Sold Out*.');
    return true;
  }

  return false; // Not an admin command, return false so the AI workflow continues
}

// Helper to send the Main Menu List via Evolution API
async function sendAdminMainMenu(to) {
  const evolutionApiUrl = process.env.EVOLUTION_API_URL;
  const instanceName = process.env.EVOLUTION_INSTANCE;
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
          { title: "Mark Item Sold Out", rowId: "CMD_SHOW_SOLDOUT_LIST", description: "Remove item from live menu" },
          { title: "Restore Item", rowId: "CMD_SHOW_AVAILABLE_LIST", description: "Bring sold out item back" }
        ]
      }
    ]
  };

  await fetch(`${evolutionApiUrl}/message/sendList/${instanceName}`, {
    method: 'POST',
    headers: { 'apikey': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(listPayload)
  });
}

// Helper to dynamically generate a list of items to mark as sold out
async function sendSoldOutSelectionList(to) {
  const { data: menuItems } = await supabase.from('menu_items').select('*').eq('is_available', true);
  
  if (!menuItems || menuItems.length === 0) {
    return sendWhatsAppMessage(to, 'All items are currently sold out.');
  }

  const rows = menuItems.map(item => ({
    title: item.name,
    rowId: `SOLDOUT_ITEM_${item.id}`,
    description: `Current Price: ₦${item.price}`
  }));

  const listPayload = {
    number: to,
    title: "🚫 Mark as Sold Out",
    description: "Select the exact item to remove from the live menu:",
    buttonText: "Select Item",
    sections: [{ title: "Available Items", rows: rows }]
  };

  await fetch(`${process.env.EVOLUTION_API_URL}/message/sendList/${process.env.EVOLUTION_INSTANCE}`, {
    method: 'POST',
    headers: { 'apikey': process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(listPayload)
  });
}