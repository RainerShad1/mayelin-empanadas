-- Menú real de Mayelin Empanadas (reemplaza el menú de ejemplo).
-- Los pedidos guardan nombre y precio de cada producto, así que borrar
-- los productos de ejemplo no afecta el historial.
begin;

delete from public.products;
delete from public.categories;

insert into public.categories (id, name, position) values
  ('empanadas',  'Empanadas',  1),
  ('mariscos',   'Mariscos',   2),
  ('bocadillos', 'Bocadillos', 3),
  ('bebidas',    'Bebidas',    4);

-- units: cuántas empanadas cuenta para el pedido mínimo (0 = no cuenta).
insert into public.products (id, category_id, name, price, units, position) values
  ('pollo',              'empanadas', 'Pollo',                    70, 1,  1),
  ('pollo-queso-maiz',   'empanadas', 'Pollo con queso y maíz',   75, 1,  2),
  ('pollo-queso',        'empanadas', 'Pollo con queso',          70, 1,  3),
  ('jamon-queso',        'empanadas', 'Jamón con queso',          75, 1,  4),
  ('peperone-queso',     'empanadas', 'Peperone con queso',       75, 1,  5),
  ('tocineta-queso',     'empanadas', 'Tocineta con queso',       75, 1,  6),
  ('res-queso',          'empanadas', 'Res con queso',            80, 1,  7),
  ('queso',              'empanadas', 'Queso',                    80, 1,  8),
  ('res',                'empanadas', 'Res',                      75, 1,  9),
  ('huevo',              'empanadas', 'Huevo',                    70, 1, 10),
  ('vegetales-pollo',    'empanadas', 'Vegetales y pollo',        75, 1, 11),
  ('vegetales-queso',    'empanadas', 'Vegetales y queso',        75, 1, 12),
  ('guayaba-queso',      'empanadas', 'Guayaba con queso',        75, 1, 13),
  ('berenjenas-queso',   'empanadas', 'Berenjenas con queso',     75, 1, 14),
  ('lambi',              'mariscos',  'Lambí',                   150, 1,  1),
  ('camarones',          'mariscos',  'Camarones',               150, 1,  2),
  ('cangrejo',           'mariscos',  'Cangrejo',                150, 1,  3),
  ('kipes',              'bocadillos','Kipes',                    45, 0,  1),
  ('croquetas-pollo',    'bocadillos','Croquetas de pollo',       45, 0,  2),
  ('bollitos-yuca',      'bocadillos','Bollitos de yuca',         45, 0,  3),
  ('agua',               'bebidas',   'Agua',                     20, 0,  1),
  ('refresco',           'bebidas',   'Refresco',                 35, 0,  2),
  ('jugo-natural',       'bebidas',   'Jugos naturales',         100, 0,  3);

commit;
