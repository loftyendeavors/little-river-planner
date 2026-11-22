# Grower accounts beta

After a grower signs in or creates a farm, the same tab opens the planner with their saved gardens, beds and plantings. Farm settings opens the field form and the account backup controls. Returning to the planner or signing out finishes pending saves first.

The beta builds the planner from the repository’s regular entry point. Account edits and attached files are saved to the authenticated owner’s Supabase row with revision checks. A rejected save stays in the editor with retry or recovery actions. The downloaded account backup can be restored in Farm settings and also contains the portable plan for the standalone planner. Other growers’ device storage, folder sync, and snapshots are outside this account workspace.

## Set up a beta

1. Use a dedicated Supabase project. Enable email/password and email confirmation. Set the Site URL to the account site and allow its return URL. The standard confirmation and recovery links work. Code-based templates are also supported.
2. Apply the SQL migration in `supabase/migrations`. The project must expose the public schema through the Data API. Set `ACCOUNT_SITE_ORIGIN` to the exact HTTPS origin of the static site and deploy the `username-login` function with the function settings from `supabase/config.toml`. A grower supplies credentials to this endpoint before they have a session. Authentication and password checks run in Supabase Auth.
3. Run `npm ci` in this directory, then `npm test`. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` to the project origin and browser publishable key, then run `npm run build`. Publish the contents of `dist` on an HTTPS static host. Keep service and secret keys in the backend.
4. Set up a verified transactional sender in Supabase Auth before inviting addresses outside the project team. Test signup and password recovery with a recipient on the intended service.
5. Run `test/hosted-isolation.sql` on the beta database to check two owners and two revisions in a transaction that rolls back. Test account switching, fresh-device sign-in and reopening a saved field before sharing.

Database tests run the actual migration with PostgreSQL in PGlite under the anonymous, authenticated and service roles. The account tests exercise starter farms, backup format and username sign-in behavior.

The first-farm browser check runs the built planner in independent desktop and phone profiles against a loopback account fixture. It creates four 20-foot beds and three weekly lettuce sowings, checks the first task, and verifies the account backup. After a loopback build, run `python test/first_farm_check.py` with Playwright installed and `CHROMIUM_BIN` pointing to Chromium.

The optional email browser check uses a local Supabase stack and a test SMTP server that writes the most recent RFC822 message to a file. Build the site with that stack’s URL and publishable key, serve it locally, and deploy the function and migration to the test stack first. With Python Playwright and Chromium installed, set `GROWER_TEST_URL` and `GROWER_TEST_MAIL_FILE` and run `python test/browser_flow.py`. The check creates a synthetic local account, adds four beds on a phone viewport, opens Map and Timeline in a separate desktop browser, renames a garden on the map, signs out and back in, downloads its backup and follows a recovery email. Both the app and email verification links must use loopback addresses.
