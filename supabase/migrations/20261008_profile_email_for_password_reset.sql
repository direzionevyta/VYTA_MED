-- Keep account email in the admin-visible profile so admins can send recovery links.
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

create index if not exists profiles_email_idx on public.profiles (lower(email));
