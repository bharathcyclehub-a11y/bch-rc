-- Supports bounded historical sales/profile reports. Run with the existing
-- manual migration runner during a quiet period; CREATE INDEX takes a write lock.
CREATE INDEX IF NOT EXISTS orders_site_placed_idx ON orders (site_id, placed_at);
CREATE INDEX IF NOT EXISTS customers_firstsite_created_idx ON customers (first_site_id, created_at);
