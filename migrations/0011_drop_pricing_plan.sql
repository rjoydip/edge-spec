-- Pricing was dropped from the product. 0010 introduced the Better Auth user
-- table with a `plan` column; remove it in a forward migration so applied
-- history stays append-only. Fresh installs create the column in 0010 and drop
-- it here, which is cheaper than rewriting an applied file.
ALTER TABLE "user" DROP COLUMN plan;
