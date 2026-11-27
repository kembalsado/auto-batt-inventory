-- Auto Batt Inventory — seed car_makes and car_models with PH market data
-- Populates the two lookup tables (0016_car_makes.sql, 0025_car_models.sql)
-- with the makes and models most common in the Philippine market, so the
-- Model-suggestion <datalist> in the item fitment editor (and the new
-- /models page) aren't empty on a fresh install.
--
-- Both inserts are idempotent so this migration is safe to have run
-- already applied against a database that already has some of this data
-- (e.g. a make a user added by hand before this migration shipped).
--
-- The car_makes insert can't use `on conflict (name) do nothing`: that
-- only catches an EXACT-case match, so a pre-existing make spelled e.g.
-- "TOYOTA" wouldn't conflict and this would insert a second, differently
-- cased "Toyota" row — with every seeded Toyota model then attaching to
-- that NEW row while any existing item fitments keep pointing at the
-- old one. Instead it skips a name that already exists case-insensitively
-- via `where not exists (select 1 ... lower(...) = lower(...))`.
--
-- The car_models join is case-insensitive for the same reason: it has to
-- resolve each seeded model to whichever car_makes row actually exists
-- for that make, which — per the paragraph above — may be cased
-- differently than this file's literal ('Toyota', ...) values. The
-- car_models insert's own `on conflict (make_id, name) do nothing` stays
-- exact-case, since every row this migration inserts shares the exact
-- casing below with no pre-existing data to diverge from.

insert into car_makes (name)
select v.name
from (values
  ('Toyota'), ('Mitsubishi'), ('Honda'), ('Nissan'), ('Suzuki'),
  ('Ford'), ('Hyundai'), ('Kia'), ('Mazda'), ('Isuzu'),
  ('Chevrolet'), ('Subaru'), ('Geely'), ('MG'), ('Chery'), ('BYD')
) as v(name)
where not exists (
  select 1 from car_makes c where lower(c.name) = lower(v.name)
);

insert into car_models (make_id, name)
select m.id, v.name
from car_makes m
join (values
  ('Toyota', 'Vios'), ('Toyota', 'Wigo'), ('Toyota', 'Avanza'),
  ('Toyota', 'Veloz'), ('Toyota', 'Rush'), ('Toyota', 'Raize'),
  ('Toyota', 'Innova'), ('Toyota', 'Fortuner'), ('Toyota', 'Hilux'),
  ('Toyota', 'Corolla Altis'), ('Toyota', 'Camry'), ('Toyota', 'RAV4'),
  ('Toyota', 'Land Cruiser'), ('Toyota', 'Hiace'),

  ('Mitsubishi', 'Mirage'), ('Mitsubishi', 'Mirage G4'),
  ('Mitsubishi', 'Xpander'), ('Mitsubishi', 'Xpander Cross'),
  ('Mitsubishi', 'Montero Sport'), ('Mitsubishi', 'Strada'),
  ('Mitsubishi', 'Outlander'), ('Mitsubishi', 'Adventure'),
  ('Mitsubishi', 'L300'),

  ('Honda', 'Brio'), ('Honda', 'City'), ('Honda', 'Civic'),
  ('Honda', 'BR-V'), ('Honda', 'HR-V'), ('Honda', 'CR-V'),
  ('Honda', 'Accord'),

  ('Nissan', 'Almera'), ('Nissan', 'Navara'), ('Nissan', 'Terra'),
  ('Nissan', 'X-Trail'), ('Nissan', 'Patrol'), ('Nissan', 'Urvan'),

  ('Suzuki', 'Alto'), ('Suzuki', 'Celerio'), ('Suzuki', 'Swift'),
  ('Suzuki', 'Ertiga'), ('Suzuki', 'XL7'), ('Suzuki', 'Jimny'),
  ('Suzuki', 'APV'),

  ('Ford', 'EcoSport'), ('Ford', 'Everest'), ('Ford', 'Ranger'),
  ('Ford', 'Territory'), ('Ford', 'Explorer'),

  ('Hyundai', 'Accent'), ('Hyundai', 'Eon'), ('Hyundai', 'Reina'),
  ('Hyundai', 'Venue'), ('Hyundai', 'Creta'), ('Hyundai', 'Tucson'),
  ('Hyundai', 'Santa Fe'), ('Hyundai', 'Starex'),

  ('Kia', 'Picanto'), ('Kia', 'Soluto'), ('Kia', 'Seltos'),
  ('Kia', 'Sportage'), ('Kia', 'Carnival'),

  ('Mazda', 'Mazda2'), ('Mazda', 'Mazda3'), ('Mazda', 'CX-3'),
  ('Mazda', 'CX-5'), ('Mazda', 'BT-50'),

  ('Isuzu', 'D-Max'), ('Isuzu', 'mu-X'), ('Isuzu', 'Traviz'),

  ('Chevrolet', 'Spark'), ('Chevrolet', 'Trailblazer'),

  ('Subaru', 'XV'), ('Subaru', 'Forester'), ('Subaru', 'Outback'),

  ('Geely', 'Coolray'), ('Geely', 'Okavango'), ('Geely', 'Azkarra'),

  ('MG', 'MG5'), ('MG', 'ZS'), ('MG', 'RX5'), ('MG', 'One'),

  ('Chery', 'Tiggo 2'), ('Chery', 'Tiggo 5X'), ('Chery', 'Tiggo 7 Pro'),
  ('Chery', 'Tiggo 8 Pro'),

  ('BYD', 'Atto 3'), ('BYD', 'Dolphin'), ('BYD', 'Seal'), ('BYD', 'Song Plus')
) as v(make_name, name) on lower(v.make_name) = lower(m.name)
on conflict (make_id, name) do nothing;
