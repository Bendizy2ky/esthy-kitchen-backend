// src/services/orderService.js
import { supabase } from '../config/supabase.js';

/**
 * Creates an order in the database and links the individual cart items to it.
 */
export async function createCompleteOrder(orderData, cartItems) {
  try {
    // 1. Insert the main order record
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert([{
          reference: orderData.reference,
          customer_phone: orderData.customerPhone || 'Unknown',
          amount: orderData.amount,
          email: orderData.customerEmail,
          cart_summary: cartItems 
      }])
      .select('id')
      .single();

    if (orderError) {
      console.error('❌ Supabase Orders Insert Error:', orderError.message);
      return { success: false, error: orderError };
    }

    const orderId = newOrder.id;

    // 2. Insert the individual line items if the cart is not empty
    if (cartItems && cartItems.length > 0) {
      const orderItemsToInsert = cartItems.map(item => ({
        order_id: orderId,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: item.unit_price
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemsToInsert);

      if (itemsError) {
        console.error('❌ Supabase Order Items Insert Error:', itemsError.message);
        // We still return success for the main order, as the customer paid
      }
    }

    return { success: true, orderId };
  } catch (err) {
    console.error('❌ Unexpected error in createCompleteOrder:', err);
    return { success: false, error: err };
  }
}