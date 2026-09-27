// src/services/orderService.js
import { supabase } from '../config/supabase.js';

/**
 * Creates an order in the database and links only food items to order_items.
 */
export async function createCompleteOrder(orderData, cartItems) {
  try {
    const rawItems = cartItems || [];

    // 1. Separate food items from the delivery fee
    const foodItems = rawItems.filter(
      item => !item.item_name.toLowerCase().includes('delivery')
    );

    const deliveryItem = rawItems.find(
      item => item.item_name.toLowerCase().includes('delivery')
    );

    const deliveryFee = deliveryItem 
      ? Number(deliveryItem.unit_price) * Number(deliveryItem.quantity) 
      : 0;

    // 2. Insert main order record with the standalone delivery_fee
    const { data: newOrder, error: orderError } = await supabase
      .from('orders')
      .insert([{
          reference: orderData.reference,
          customer_phone: orderData.customerPhone || 'Unknown',
          amount: orderData.amount,
          delivery_fee: deliveryFee,
          email: orderData.customerEmail,
          cart_summary: rawItems 
      }])
      .select('id')
      .single();

    if (orderError) {
      console.error('❌ Supabase Orders Insert Error:', orderError.message);
      return { success: false, error: orderError };
    }

    const orderId = newOrder.id;

    // 3. Insert ONLY food/drink items into order_items
    if (foodItems.length > 0) {
      const orderItemsToInsert = foodItems.map(item => ({
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
      }
    }

    return { success: true, orderId };
  } catch (err) {
    console.error('❌ Unexpected error in createCompleteOrder:', err);
    return { success: false, error: err };
  }
}