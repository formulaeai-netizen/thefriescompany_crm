ALTER TABLE public.inventory_stock DROP COLUMN IF EXISTS closing_packs;
ALTER TABLE public.inventory_stock ADD COLUMN closing_packs numeric
  GENERATED ALWAYS AS (GREATEST(0, COALESCE(opening_packs,0) + COALESCE(packs_produced,0) - COALESCE(packs_delivered,0))) STORED;