# DBMigrator

This service runs database migrations.

## Commands

To run kysely commands, you'll need to `cd src` first. Alternatively,
each kysely command accepts `--cwd src` as an argument.

To make a migration file, run:

```shell
kysely migrate:make init
```

For more commands, run `kysely migrate --help`
