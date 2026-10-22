
CREATE OR REPLACE FUNCTION public.products_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare inv boolean; pr boolean;
begin
  if tg_op = 'INSERT' and new.merchant_id is null then new.merchant_id := auth.uid(); end if;
  if auth.uid() is not null and not (auth.uid() = new.merchant_id or public.is_admin()) then
    inv := public.staff_has(new.merchant_id, 'inventory');
    pr  := public.staff_has(new.merchant_id, 'prices');
    if tg_op = 'UPDATE' then
      new.merchant_id := old.merchant_id;
      if not inv then
        new.name := old.name; new.description := old.description; new.category := old.category;
        new.barcode := old.barcode; new.quantity := old.quantity; new.image_path := old.image_path;
        new.is_active := old.is_active; new.expires_on := old.expires_on; new.preorder_hours := old.preorder_hours;
      end if;
      if not pr then
        new.price := old.price; new.sale_price := old.sale_price;
        new.offer_ends_at := old.offer_ends_at; new.offer_reason := old.offer_reason;
      end if;
    end if;
  end if;
  if new.sale_price is null then new.offer_ends_at := null; new.offer_reason := null; end if;
  return new;
end $function$;
