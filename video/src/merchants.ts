import type { MerchantProps } from "./templates/Merchant";

// تجّار لهم فيديو تعريفي — كل واحد يطلع له Composition باسم Merchant-<id>-9x16 / -16x9
// الصور تنحط في public/merchants/<id>/
export const merchants: Record<string, MerchantProps> = {
  example: {
    name: "مطبخ أم فهد",
    category: "🍲 أسرة منتجة",
    area: "حي النرجس",
    photos: [],
    offer: "🎁 توصيل مجاني لأول طلب",
  },
};
