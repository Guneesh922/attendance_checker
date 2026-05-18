-- Run this once in: Supabase Dashboard → SQL Editor → New Query
-- Fixes the handle_new_user trigger to also create a default settings row on signup,
-- so .single() calls on the settings table never error for new users.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_owner_id UUID;
BEGIN
  INSERT INTO owners (user_id, email, org_name)
  VALUES (NEW.id, NEW.email, 'My Organization')
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO new_owner_id;

  -- Seed a default settings row so .single() never errors for new users
  IF new_owner_id IS NOT NULL THEN
    INSERT INTO settings (owner_id)
    VALUES (new_owner_id)
    ON CONFLICT (owner_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
