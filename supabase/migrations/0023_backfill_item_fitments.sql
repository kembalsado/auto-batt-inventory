insert into item_fitments (item_id, make_id, model, variant, year_from, year_to)
select id, make_id, model, variant, year, year
from items
where make_id is not null or model is not null or variant is not null or year is not null;

alter table items
  drop column make_id,
  drop column model,
  drop column variant,
  drop column year;
