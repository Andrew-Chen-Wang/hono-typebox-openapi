import type { DB } from "@template-nextjs/db"
import { isValidPositiveInteger } from "@utils/numbers"
import type { ComparisonOperatorExpression, SelectQueryBuilder } from "kysely"

// biome-ignore lint/suspicious/noExplicitAny: any is expected
export function isValidDate(date: any): boolean {
  return !!date && Object.prototype.toString.call(date) === "[object Date]" && !Number.isNaN(date)
}

type ValidPositionTypes = string | number
type ValidCursorType = "date" | "string"
type Cursor = { o: number; p: ValidPositionTypes; t: ValidCursorType }
type UnknownCursor = { o: number; p: ValidPositionTypes; t: string }

type ConvertedPositionT = Date | string
interface DecodedCursor {
  offset: number
  position: ConvertedPositionT | null
  serializedPosition: ValidPositionTypes | null
  cursorType: ValidCursorType | null
}

export function decodeCursor(cursor: string | null): DecodedCursor {
  let position: ConvertedPositionT | null = null
  let offset = 0
  let cursorType: ValidCursorType | null = null
  let serializedPosition: ValidPositionTypes | null = null
  if (cursor) {
    let tokens: Cursor | UnknownCursor
    try {
      tokens = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as
        | Cursor
        | UnknownCursor
    } catch (e) {
      throw new Error("Invalid cursor")
    }
    if (!isValidPositiveInteger(tokens.o, true)) {
      throw new Error("Invalid offset")
    }
    if (!tokens.p) {
      throw new Error("Invalid position")
    }
    if (tokens.t === "date") {
      const convertedDate = new Date(tokens.p)
      if (!isValidDate(new Date(tokens.p))) {
        throw new Error("Invalid position")
      }
      position = convertedDate
    } else if (tokens.t === "string") {
      if (typeof tokens.p !== "string") {
        throw new Error("Invalid position")
      }
      position = tokens.p
    } else {
      throw new Error("Invalid cursor type")
    }
    cursorType = tokens.t
    offset = tokens.o
    serializedPosition = tokens.p
  }
  return { offset, position, cursorType, serializedPosition }
}

type KeysWithToString<T> = {
  [K in keyof T]: T[K] extends ConvertedPositionT ? K : never
}[keyof T]

interface CreateNextCursorProps<ResultType> {
  results: ResultType[]
  pageSize: number
  ordering: KeysWithToString<ResultType>
  cursor: string | null
}

export function createNextCursor<ResultType>({
  results,
  ordering,
  pageSize,
  cursor,
}: CreateNextCursorProps<ResultType>): string | null {
  // We always fetch pageSize + 1 to determine if there's a next page
  if (results.length <= pageSize) {
    return null
  }

  const firstResult = results[0][ordering]
  // Always generate a position; otherwise, if a new record comes in, the offset
  // will include the new record and the next pagination will be shifted by 1
  let position: ValidPositionTypes
  let type: ValidCursorType
  if (isValidDate(firstResult)) {
    position = (firstResult as Date).getTime()
    type = "date"
  } else {
    position = (firstResult as unknown as { toString: () => string }).toString()
    type = "string"
  }

  let nextCursor: Cursor
  if (!cursor) {
    nextCursor = { o: pageSize, p: position, t: type }
  } else {
    const tokens = decodeCursor(cursor)
    nextCursor = {
      o: tokens.serializedPosition ? tokens.offset + pageSize : pageSize,
      p: tokens.serializedPosition ?? position,
      t: tokens.cursorType ?? type,
    }
  }
  return Buffer.from(JSON.stringify(nextCursor)).toString("base64url")
}

export function createNextOffsetCursor<ResultType>({
  results,
  pageSize,
  cursor,
}: CreateNextCursorProps<ResultType>): string | null {
  // We always fetch pageSize + 1 to determine if there's a next page
  if (results.length <= pageSize) {
    return null
  }

  let nextCursor: Cursor
  if (!cursor) {
    nextCursor = { o: pageSize, p: "limit/offset", t: "string" }
  } else {
    const tokens = decodeCursor(cursor)
    nextCursor = {
      o: tokens.serializedPosition ? tokens.offset + pageSize : pageSize,
      p: "limit/offset",
      t: "string",
    }
  }
  return Buffer.from(JSON.stringify(nextCursor)).toString("base64url")
}

// biome-ignore lint/suspicious/noExplicitAny: Can't figure out how to infer for this
type ExtractRowType<Q> = Q extends SelectQueryBuilder<DB, any, infer R> ? R : never
type QualifiedColumn<T extends keyof DB> = `${T}.${Extract<keyof DB[T], string>}`
type ValidPositionColumn<TB extends keyof DB> = keyof DB[TB] | QualifiedColumn<TB>

interface CursorPaginateProps<
  // biome-ignore lint/suspicious/noExplicitAny: Can't figure out how to infer for this
  Q extends SelectQueryBuilder<DB, any, any>,
  R = ExtractRowType<Q>,
  O extends KeysWithToString<R> = KeysWithToString<R>,
  TB extends keyof DB = keyof DB,
> {
  query: Q
  cursor: string | null
  ordering: O
  positionColumn: ValidPositionColumn<TB>
  pageSize?: number
  positionOperator?: ComparisonOperatorExpression
}

export async function cursorPaginate<
  // biome-ignore lint/suspicious/noExplicitAny: Can't figure out how to infer for this
  Q extends SelectQueryBuilder<DB, any, any>,
  R = ExtractRowType<Q>,
  O extends KeysWithToString<R> = KeysWithToString<R>,
  TB extends keyof DB = keyof DB,
>({
  query,
  cursor,
  ordering,
  positionColumn,
  pageSize = 25,
  positionOperator = "<",
}: CursorPaginateProps<Q, R, O, TB>): Promise<{
  results: ExtractRowType<Q>[]
  nextCursor: string | null
}> {
  // https://chatgpt.com/share/677da4ad-b820-8010-b56e-c5b37d44034b
  const { offset, position } = decodeCursor(cursor)

  try {
    const rawResults = await query
      .$if(!!position, (query) =>
        // biome-ignore lint/style/noNonNullAssertion: We've validated the position
        query.where((qb) => qb.ref(positionColumn as string), positionOperator, position!),
      )
      .$if(!!offset, (query) => query.offset(offset))
      // Fetch one more than the page size to determine if there's a next page
      .limit(pageSize + 1)
      .execute()

    const results = rawResults as ExtractRowType<Q>[]

    const nextCursor = createNextCursor<(typeof results)[number]>({
      results,
      ordering,
      pageSize,
      cursor,
    })

    return { results: results.slice(0, Math.min(pageSize, results.length)), nextCursor }
  } catch (e) {
    console.warn(e)
    return { results: [], nextCursor: null }
  }
}

export async function cursorOffsetPaginate<
  // biome-ignore lint/suspicious/noExplicitAny: Can't figure out how to infer for this
  Q extends SelectQueryBuilder<DB, any, any>,
  R = ExtractRowType<Q>,
  O extends KeysWithToString<R> = KeysWithToString<R>,
  TB extends keyof DB = keyof DB,
>({
  query,
  cursor,
  ordering,
  pageSize = 25,
}: CursorPaginateProps<Q, R, O, TB>): Promise<{
  results: ExtractRowType<Q>[]
  nextCursor: string | null
}> {
  const { offset } = decodeCursor(cursor)

  try {
    const rawResults = await query
      .$if(!!offset, (query) => query.offset(offset))
      // Fetch one more than the page size to determine if there's a next page
      .limit(pageSize + 1)
      .execute()

    const results = rawResults as ExtractRowType<Q>[]

    const nextCursor = createNextOffsetCursor<(typeof results)[number]>({
      results,
      ordering,
      pageSize,
      cursor,
    })

    return { results: results.slice(0, Math.min(pageSize, results.length)), nextCursor }
  } catch (e) {
    console.warn(e)
    return { results: [], nextCursor: null }
  }
}
