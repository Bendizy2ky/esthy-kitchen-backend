// src/utils/cartParser.js

/**
 * Safely parses and validates the cart data from the AI's JSON output.
 * @param {string} cartString - The raw JSON string from the AI tag [CART_DATA: ...]
 * @returns {Array|null} - Returns a validated array of items or null if parsing fails
 */
export function parseCartData(cartString) {
  try {
    const parsed = JSON.parse(cartString);
    
    // Ensure it's an array
    if (!Array.isArray(parsed)) {
      console.warn("⚠️ Parsed cart data is not an array:", parsed);
      return null;
    }

    // Filter and validate that each item has the required Supabase columns
    const validItems = parsed.filter(item => 
      item.item_name && 
      typeof item.quantity === 'number' && 
      typeof item.unit_price === 'number'
    );

    return validItems.length > 0 ? validItems : null;
  } catch (error) {
    console.error("❌ Failed to parse CART_DATA JSON:", error.message);
    return null;
  }
}