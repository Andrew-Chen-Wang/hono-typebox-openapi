# Template NextJS

Stack: NextJS, ShadCN, Kysely, Vitest, Tailwind, HonoJS, PostgreSQL

Includes authentication via Google, database migrations, CI pipeline, a basic structure
for a monorepo, SSR via NextJS, end-to-end type safe API with Hono RPC, linting,
and pre-commit hooks.

The easiest deployment method is via Vercel.

The API for Hono is connected via Next, but it can be refactored into a separately
deployed app on a different domain.

Think of `lib` as a place to put custom, shared cook. Think of `packages` as
a place to put shared clients. Think of `apps` as actually deployed applications.

## Usage

- [ ] Replace all mentions of `template-nextjs` with your own project
- [ ] Delete the LICENSE file. Optionally, replace with a proprietary license.
- [ ] Rename .template.env to .env and fill out the remaining values

There is a setup script in bin/setup.sh that simply installs mise if you want
an multilingual alternative to nvm.

## TODO

- [ ] The components need to be refactored into lib
