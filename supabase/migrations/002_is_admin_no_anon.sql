-- is_admin solo lo necesitan usuarios con sesión (las políticas de RLS)
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
