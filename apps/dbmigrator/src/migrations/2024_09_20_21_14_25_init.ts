import { type Kysely, sql } from "kysely"

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("user")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("name", "text")
    .addColumn("email", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("is_admin", "boolean", (col) => col.notNull().defaultTo(sql`false`))
    .addColumn("image", "text")
    .addUniqueConstraint("user_email_key", ["email"])
    .execute()

  await db.schema.createIndex("user_email_idx").on("user").column("email").execute()

  await db.schema
    .createTable("account")
    .addColumn("id", "uuid", (col) => col.primaryKey())
    .addColumn("user_id", "uuid", (col) => col.references("user.id").onDelete("cascade").notNull())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("provider_account_id", "text", (col) => col.notNull())
    .addColumn("refresh_token", "text")
    .addColumn("access_token", "text")
    .addColumn("expires_at", "bigint")
    .addColumn("token_type", "text")
    .addColumn("scope", "text")
    .addColumn("id_token", "text")
    .addColumn("session_state", "text")
    .execute()

  await db.schema.createIndex("account_user_id_index").on("account").column("user_id").execute()

  await db.schema
    .createTable("session")
    .addColumn("session_key", "text", (col) => col.primaryKey().notNull())
    .addColumn("user_id", "uuid", (col) => col.references("user.id").onDelete("cascade").notNull())
    .addColumn("expires", "timestamptz", (col) => col.notNull())
    .addUniqueConstraint("session_session_key_key", ["session_key"])
    .execute()

  await db.schema.createIndex("session_user_id_index").on("session").column("user_id").execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("session").ifExists().execute()
  await db.schema.dropTable("account").ifExists().execute()
  await db.schema.dropTable("user").ifExists().execute()
}
