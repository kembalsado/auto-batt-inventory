insert into car_makes (name) values
  ('Toyota'), ('Mitsubishi'), ('Honda'), ('Nissan'), ('Suzuki'),
  ('Ford'), ('Hyundai'), ('Kia'), ('Mazda'), ('Isuzu'),
  ('Chevrolet'), ('Subaru'), ('Geely'), ('MG'), ('Chery'), ('BYD')
on conflict (name) do nothing;

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
) as v(make_name, name) on v.make_name = m.name
on conflict (make_id, name) do nothing;
