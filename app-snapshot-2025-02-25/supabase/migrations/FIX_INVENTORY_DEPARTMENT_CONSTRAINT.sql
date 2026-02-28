-- Fix inventory_items department check constraint
-- Run this in Supabase SQL Editor if you see error code 23514 on inventory imports.
-- Drops the existing constraint (regardless of its current values) and recreates it
-- with the correct uppercase set that the app uses.

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_department_check;

ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_department_check
  CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY'));
