# Self-hosted Supabase replaces Firebase

Firebase is removed entirely, not wrapped or kept alongside: it's a Google service, and this fork has a firm rule to stay off it and keep the stack open. The backend is Supabase (Postgres with live updates, storage, sign-in), self-hosted with Docker from the start; Docker Compose is the main way to deploy, not an afterthought. Supabase won because it replaces each Firebase piece one for one (live listeners, access rules, storage buckets, sign-in) on plain Postgres, so the app's listener-driven design survives the move.

## Considered Options

- **PocketBase**: one program on SQLite, easier to host for a single private game. Rejected because SQLite and a pre-1.0 project are a weaker base if the app grows past one group.
- **A custom SQL server and API**: rejected because live updates, sign-in and file storage would all have to be built by hand.

## Consequences

- The fork no longer syncs with upstream (scottbenton/Iron-Fellowship_and_Crew-Link). Changes from upstream have to be ported by hand, if at all.
- Firebase Hosting and its GitHub deploy workflows go too; the site ships in the Docker deployment.
- Each game system (Ironsworn, Starforged) runs as its own fully separate stack, with its own Supabase, data and accounts, started from the same Compose template. The two player groups don't overlap, so a shared backend would buy nothing; keeping them apart keeps each stack light and the template written once.
- Only features of the self-hosted Supabase are allowed, never ones exclusive to Supabase's hosted service.
