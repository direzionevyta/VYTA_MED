# VYTA MED demo environment

The public demo screen is enabled only when the separate Vercel build has
`VITE_DEMO_MODE=true`. Production remains on the normal login screen when the
variable is unset or false.

## Required separation

Use a dedicated Supabase project and a separate Vercel project or deployment
environment for the demo. Do not place production Supabase credentials in the
demo project's environment variables. Do not copy production rows, backups,
profiles, attachments, or offline exports into the demo.

The current beta is deployed from the `codex/vyta-med-beta` branch as a
protected Preview deployment of the existing `vyta-med` Vercel project. Vercel
applies branch-specific Preview variables on that branch only; production
variables and deployments remain unchanged. A separate Vercel project can be
created when the Vercel integration is authorized to create projects under the
`direzionevytas-projects` team.

The isolated demo project was created as `VYTA MED Demo` (`yaxrifuumpkklmvzwbdz`)
in the `VYTA_MED` organization, in the `eu-west-1` region on the Nano compute
tier. The production project remains `gybbaaszywwktkjblpfj`.

For a fresh demo database, apply `supabase/demo/0001_full_setup.sql` first. It
contains a schema-only baseline followed by the checked-in migrations in order.
The demo copy disables the production-specific email bootstrap; demo roles are
assigned only by `0003_assign_demo_accounts.sql` after the invited accounts are
confirmed.
Then apply `supabase/demo/0002_synthetic_seed.sql` for a fictional organization,
venue, event, crew, and two fictional training scenarios. Both scripts have
been applied to the isolated project and the resulting schema and seed data
were verified. After both users accept their individual invitations, apply
`supabase/demo/0003_assign_demo_accounts.sql` after replacing its two example
email addresses with the accepted invite addresses. It attaches the admin and
operator roles to the demo organization and trial event. Never run these scripts
against production.

## Vercel variables

Set these only in the dedicated demo project/environment or the beta branch's
Preview environment:

- `VITE_SUPABASE_URL`: URL of the demo Supabase project.
- `VITE_SUPABASE_ANON_KEY`: publishable/anon key of the demo Supabase project.
- `VITE_DEMO_MODE`: `true`.
- `VITE_DEMO_CONTACT_EMAIL`: optional address for demo presentation requests.
- `VITE_DEMO_SUPABASE_REF`: project reference of the demo project.
- `VITE_PRODUCTION_SUPABASE_REF`: project reference of the production project.

The build and app both check that the URL matches the demo project reference
and that the demo and production references differ. A misconfigured demo build
fails closed before it can initialize Supabase. Never put a Supabase
`service_role` key or database password in a `VITE_` variable.
Configure the demo app's Auth redirect URLs for its own demo domain.

The active Vercel account is currently on Hobby. Vercel documents Hobby as a
free plan for personal, non-commercial use; verify that this demo's intended
use is allowed by the current plan terms before publishing. Do not upgrade or
enable paid usage because the deployment budget is €0.

## Demo content and accounts

- Use invented people, event names, timestamps, crew labels, and intervention
  details. Do not use real patient or staff data, even if names are changed.
- Create a distinct organization and individual user accounts for each invited
  association; do not send a shared administrator login.
- Restrict account access to invited testers and disable public account
  registration unless a separate reviewed onboarding flow is implemented.
- Explain that changes are temporary demonstration data and schedule a reset of
  the demo tenant between sessions.
- Do not connect the demo deployment to production email, storage, analytics, or
  database services.

## Before sharing the URL

1. Confirm the Vercel demo project's or beta branch's build has the demo-only environment values.
2. Confirm the demo Supabase project has no production records and the expected
   RLS policies are enabled.
3. Create test accounts and synthetic event data, then try the main workflows.
4. Check that the persistent demo banner is visible after login and that the
   landing page warns visitors to use only fictitious data.
5. Give each association its own login and reset its demo data after the trial.

The current demo page does not create accounts or store contact requests.
The optional contact link opens the visitor's email app; it sends nothing until
the visitor chooses to send it.
