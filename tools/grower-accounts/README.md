# Grower accounts beta

The account site lets a grower verify an email, choose a username, name a farm, and start with an empty farm or their own copy of the planner’s fictional sample. A grower can add fields and beds, return from another device, recover a password, or download a JSON backup for the existing planner. Edits made after importing that file in the full planner are a separate copy.

The static beta uses Supabase Auth and one database row per grower. The browser retains its account session in tab storage. The server selects the farm using the authenticated user ID. A revision check prevents a stale device from replacing a newer save. Only the username-login Edge Function can resolve a username to an email address. The beta imports the shared sample and backup format without opening the existing planner’s storage, sync service, or photo database.

## Set up a beta

1. Use a dedicated Supabase project. Enable email/password and email confirmation. Set the Site URL to the account site and allow its return URL. The standard confirmation and recovery links work. Code-based templates are also supported.
2. Apply the SQL migration in `supabase/migrations`. The project must expose the public schema through the Data API. Set `ACCOUNT_SITE_ORIGIN` to the exact HTTPS origin of the static site and deploy the `username-login` function with the function settings from `supabase/config.toml`. A grower supplies credentials to this endpoint before they have a session. Authentication and password checks run in Supabase Auth.
3. Run `npm ci` in this directory, then `npm test`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the project origin and browser publishable key, then run `npm run build`. Publish the contents of `dist` on an HTTPS static host. Keep service and secret keys in the backend.
4. Set up a verified transactional sender in Supabase Auth before inviting addresses outside the project team. Test signup and password recovery with a recipient on the intended service.
5. Run `test/hosted-isolation.sql` on the beta database to check two owners and two revisions in a transaction that rolls back. Test account switching, fresh-device sign-in and reopening a saved field before sharing.

Database tests run the actual migration with PostgreSQL in PGlite under the anonymous, authenticated and service roles. The account tests exercise starter farms, backup format and username sign-in behavior.
