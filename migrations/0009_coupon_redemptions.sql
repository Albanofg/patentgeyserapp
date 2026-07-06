-- Coupon redemption ledger for the /purchase page's private discount code.
--
-- Purpose: the coupon code itself and its discount percent are configured via
-- env vars (PURCHASE_COUPON_CODE / PURCHASE_COUPON_PERCENT_OFF) — there is
-- exactly one active code. This table only records who has already redeemed
-- it, so /api/checkout/epd can enforce one use per email. The unique index
-- is the actual enforcement (race-safe at the DB level); the app checks it
-- first for a fast, friendly error before ever charging the card.
--
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS inventor_geyser.coupon_redemptions (
  id             VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL,
  coupon_code    TEXT NOT NULL,
  pack_id        TEXT NOT NULL,
  percent_off    INTEGER NOT NULL,
  transaction_id TEXT,
  redeemed_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS coupon_redemptions_email_code_idx
  ON inventor_geyser.coupon_redemptions (email, coupon_code);
