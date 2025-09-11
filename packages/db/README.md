# @template-nextjs/db

This package provides a database client for the project. This is also where code generation occurs.

## Commands

To generate types for Kysely, run

`npm run db-codegen`

## .env

```.env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/main?schema=public"
```
