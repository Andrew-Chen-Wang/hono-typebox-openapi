import type { JSONSchema, ParserOptions } from "@apidevtools/json-schema-ref-parser"
import type { JSONSchema4, JSONSchema6Definition, JSONSchema7Definition } from "json-schema"
import { Walker } from "json-schema-walker"
import type { OpenAPIV3_1 } from "openapi-types"

export type addPrefixToObject = {
  [K in keyof JSONSchema as `x-${K}`]: JSONSchema[K]
}

export interface Options {
  cloneSchema?: boolean
  dereference?: boolean
  convertUnreferencedDefinitions?: boolean
  dereferenceOptions?: ParserOptions | undefined
  /**
   * Downstream consumer to normalize the document for. See `OpenApiSpecsOptions.target`.
   * Unset = idiomatic OpenAPI 3.1 (default). See {@link OpenApiTarget}.
   */
  target?: OpenApiTarget
  /**
   * Called with the schema-local JSON pointers of every property this conversion removed from a
   * `required` array (e.g. `/properties/matchData`), when there are any.
   *
   * Some nullable shapes cannot survive normalization with their `null` branch intact — a bare
   * `$ref`, a `const`/`enum` union, a multi-member union. For those, un-requiring the property is
   * the only remaining way to signal nullability to the target generator, so the emitted document
   * says "may be omitted" while the server, validating against the untransformed TypeBox schema,
   * still requires it. Each reported field needs a matching `Type.Optional(...)` server-side for
   * the advertised contract to be honest.
   */
  onUnrequiredNullable?: (pointers: string[]) => void
}

export type OpenApiTarget = "swift-openapi-generator"
// `prefixItems` is JSON Schema 2020-12 (and so OpenAPI 3.1), but `@types/json-schema` only models
// draft-04/06/07, where a tuple is an array-form `items`. Declare it so the tuple lift is typed.
type Draft2020Keywords = { prefixItems?: JSONSchema[] }
type ExtendedJSONSchema = addPrefixToObject & JSONSchema & Draft2020Keywords
export type SchemaType = ExtendedJSONSchema
export type SchemaTypeKeys = keyof SchemaType

// OpenAPI 3.1 Schema Objects are a superset of JSON Schema 2020-12, so the
// allowed keywords are the 2020-12 vocabulary plus the OAS-specific annotations.
// Anything outside this list is rewritten into an `x-` extension.
const allowedKeywords = new Set([
  "$ref",
  "$defs",
  "definitions",
  "$comment",
  // Core / metadata
  "title",
  "description",
  "default",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  // Numbers
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  // Strings
  "maxLength",
  "minLength",
  "pattern",
  "format",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  // Arrays
  "items",
  "prefixItems",
  "maxItems",
  "minItems",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "unevaluatedItems",
  // Objects
  "properties",
  "patternProperties",
  "additionalProperties",
  "propertyNames",
  "maxProperties",
  "minProperties",
  "required",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  // Generic / applicators
  "type",
  "enum",
  "const",
  "not",
  "allOf",
  "oneOf",
  "anyOf",
  "if",
  "then",
  "else",
  // OAS-specific
  "discriminator",
  "externalDocs",
  "xml",
])

class InvalidTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidTypeError"
    this.message = message
  }
}

const oasExtensionPrefix = "x-"

// DRAFT_07 is the newest vocabulary json-schema-walker@2 ships (it is literally `{...DRAFT_06}`),
// and it has no `prefixItems` handler. Once `liftTupleToPrefixItems` renames a tuple's array-form
// `items`, the walker would stop there and never visit the tuple's members — no nullable collapse,
// no extension rewriting. `allOf`'s processor is `processArrayOfSchemas`, which is exactly the
// right shape for `prefixItems`, and it is already bound to the walker instance.
const tupleAwareVocabulary = <T extends JSONSchema>(walker: Walker<T>) => ({
  ...walker.vocabularies.DRAFT_07,
  prefixItems: walker.vocabularies.DRAFT_07.allOf,
})

// Marks a schema whose `null` branch was erased during normalization (see `unrequireDroppedNulls`).
// A symbol key is invisible to `Object.keys` and `JSON.stringify`, so it never reaches
// `convertIllegalKeywordsAsExtensions` or the emitted document.
const NULL_DROPPED = Symbol("nullDropped")

const handleDefinition = async <T extends JSONSchema4 = JSONSchema4>(
  def: JSONSchema7Definition | JSONSchema6Definition | JSONSchema4,
  schema: T,
  swiftGenerator: boolean,
  // Accumulates the JSON pointers reported through `Options.onUnrequiredNullable`, prefixed with
  // this definition's location so the caller sees document-relative paths.
  unrequired: string[] = [],
  pointerPrefix = "",
) => {
  if (typeof def !== "object") {
    return def
  }

  const type = def.type
  if (type) {
    // Walk just the definitions types
    const walker = new Walker<T>()
    await walker.loadSchema(
      {
        definitions: schema.definitions || [],
        ...def,
        $schema: schema.$schema,
      } as any,
      {
        dereference: true,
        cloneSchema: true,
        dereferenceOptions: {
          dereference: {
            circular: "ignore",
          },
        },
      },
    )
    await walker.walk(makeConvertSchema(swiftGenerator), tupleAwareVocabulary(walker))
    if (swiftGenerator) {
      unrequired.push(...unrequireDroppedNulls(walker.rootSchema as SchemaType, pointerPrefix))
    }
    if ("definitions" in walker.rootSchema) {
      walker.rootSchema.definitions = undefined
    }
    return walker.rootSchema
  }
  if (Array.isArray(def)) {
    // A bare type array (e.g. ["string", "null"]) is already valid in OpenAPI 3.1,
    // so keep it as-is.
    return { type: def } as JSONSchema7Definition | JSONSchema6Definition | JSONSchema4
  }

  return def
}

const convert = async <T extends object = JSONSchema4>(
  schema: T,
  options?: Options,
): Promise<OpenAPIV3_1.Document> => {
  const walker = new Walker<T>()
  const convertDefs = options?.convertUnreferencedDefinitions ?? true
  // Internal flag: the swift-openapi-generator target needs the extra normalization passes.
  // (Future targets like an Android generator would get their own flag/passes here.)
  const swiftGenerator = options?.target === "swift-openapi-generator"
  await walker.loadSchema(schema, options)
  await walker.walk(makeConvertSchema(swiftGenerator), tupleAwareVocabulary(walker))
  // Un-requiring has to happen after the walk, not during it: the walker is pre-order, so an
  // object node is fully processed before any of its property schemas is visited. Anything the
  // parent inferred about a child mid-walk would be a prediction about passes that have not run
  // yet. Here every schema is final, and each one that lost its `null` branch says so.
  const unrequired = swiftGenerator ? unrequireDroppedNulls(walker.rootSchema as SchemaType) : []
  // if we want to convert unreferenced definitions, we need to do it iteratively here
  const rootSchema = walker.rootSchema as unknown as JSONSchema
  if (convertDefs && rootSchema.definitions) {
    for (const defName in rootSchema.definitions) {
      const def = rootSchema.definitions[defName]
      rootSchema.definitions[defName] = await handleDefinition(
        def,
        schema,
        swiftGenerator,
        unrequired,
        `/definitions/${defName}`,
      )
    }
  }
  if (unrequired.length > 0) {
    options?.onUnrequiredNullable?.(unrequired)
  }
  return rootSchema as OpenAPIV3_1.Document
}

function stripIllegalKeywords(schema: SchemaType) {
  if (typeof schema !== "object") {
    return schema
  }
  schema.$schema = undefined
  schema.$id = undefined
  if ("id" in schema) {
    schema.id = undefined
  }
  return schema
}

// The walker visits each schema node pre-order (top-down), invoking this callback
// before descending into `anyOf`/`oneOf` members. The closed-over `swiftGenerator` flag
// enables the swift-openapi-generator normalization passes (see `collapseNullable`).
// Whether a nullable property stays in its parent's `required` is decided *after* the whole
// walk, by `unrequireDroppedNulls` — not here, where child schemas are still unprocessed.
const makeConvertSchema = (swiftGenerator: boolean) => (schema?: SchemaType) => {
  let draft = schema

  if (!draft) {
    return draft
  }

  draft = stripIllegalKeywords(draft)
  if (swiftGenerator) {
    draft = collapseLargeConstUnion(draft)
    draft = openTypeNullSchema(draft)
  }
  draft = convertTypes(draft)
  draft = collapseNullable(draft, swiftGenerator)
  // After `collapseNullable`, so a nullable tuple folded onto this node by `liftMemberAsNullable`
  // (`type: ["array","null"]` + the member's array-form `items`) is caught in the same visit.
  draft = liftTupleToPrefixItems(draft)

  if (
    draft.type === "array" &&
    typeof draft.items === "undefined" &&
    typeof draft.prefixItems === "undefined"
  ) {
    draft.items = {}
  }

  // should be called last
  draft = convertIllegalKeywordsAsExtensions(draft)
  return draft
}

const validTypes = new Set(["null", "boolean", "object", "array", "number", "string", "integer"])

function validateType(type: unknown) {
  if (typeof type === "object" && !Array.isArray(type)) {
    // Refs are allowed because they fix circular references
    if (type && "$ref" in type && type.$ref) {
      return
    }
    // this is a de-referenced circular ref
    if (type && "properties" in type && type.properties) {
      return
    }
  }
  const types = Array.isArray(type) ? type : [type]

  for (const t of types) {
    if (t && !validTypes.has(t)) throw new InvalidTypeError(`Type "${t}" is not a valid type`)
  }
}

// TypeBox 1.x still emits tuples in draft-07 form — `items: [...]` plus `additionalItems` — which
// is invalid under JSON Schema 2020-12, and so under OpenAPI 3.1: array-form `items` is not a
// tuple there, it is a parse error for strict readers (OpenAPIKit) and an unreadable schema for
// lenient ones (hey-api degrades it to `Array<unknown>`). Re-express as `prefixItems`.
function liftTupleToPrefixItems(schema: SchemaType) {
  const items = schema.items
  if (!Array.isArray(items)) {
    return schema
  }

  const additionalItems = (schema as { additionalItems?: unknown }).additionalItems
  schema.items = undefined
  // 2020-12 requires `prefixItems` to be a non-empty array. `Type.Tuple([])` emits `items: []`,
  // which just means "an array with no elements" — `maxItems: 0` says that on its own.
  if (items.length > 0) {
    schema.prefixItems = items as JSONSchema[]
  }

  if (additionalItems === false) {
    // `maxItems` is how 2020-12 closes a tuple. Never widen a `maxItems` the author set.
    if (schema.maxItems === undefined) {
      schema.maxItems = items.length
    }
  } else if (additionalItems && typeof additionalItems === "object") {
    // In 2020-12 the schema for elements *past* the prefix is `items`.
    schema.items = additionalItems as SchemaType["items"]
  }
  // `additionalItems: true` needs no equivalent — it is the 2020-12 default. Clearing the keyword
  // either way keeps it away from the `x-` rename in `convertIllegalKeywordsAsExtensions`.
  ;(schema as { additionalItems?: unknown }).additionalItems = undefined

  return schema
}

const scalarTypes = new Set(["string", "number", "integer", "boolean"])

// Collapse a `{ anyOf | oneOf }` union that contains a bare `{ type: "null" }` member
// into an idiomatic OpenAPI 3.1 nullable type. The shapes handled depend on `swiftGenerator`.
//
// Always (both targets):
//   1. Every non-null member is a bare `{ type: <string> }` → fold the whole union
//      into a type array, e.g. `string | null` → `{ type: ["string", "null"] }`.
//   2. Exactly one non-null member, and it is a *scalar* (string/number/integer/
//      boolean) with no `const`/`enum` → lift its keywords onto the parent and make
//      the type nullable, e.g. `{ type: ["string", "null"], format: "date-time" }`.
//      This is safe because scalar constraints (format, pattern, minLength, minimum,
//      …) only apply to their own type and are ignored for `null`.
//
// Additionally when `swiftGenerator` (for swift-openapi-generator, which cannot consume a
// standalone `{ type: "null" }` member and otherwise drops the property):
//   A. A single inline object member → `{ type: ["object", "null"], properties, … }`.
//   B. A single inline array member  → `{ type: ["array", "null"], items, … }`.
//   C. A single bare `$ref` member   → the bare `{ $ref }` (the `{type:null}` branch is
//      dropped; nullability is instead carried by the property being absent from the
//      parent `required`, handled in `unrequireNullableProps`).
//   D. Any other single non-null member (nested `anyOf`/`oneOf`, `const`/`enum`, empty
//      `{}`, …) → inline that member in place of the whole union (`inlineSoleMember`).
//   E. Several non-null members → just drop the `{type:null}` member, leaving a valid
//      multi-member union.
//   In every swiftGenerator case the standalone `{type:null}` is eliminated, because
//   swift-openapi-generator cannot represent it and would drop the whole property.
//
// In the default (non-swiftGenerator) target, only shapes 1 & 2 apply; anything else is
// left as the original `anyOf`, which is already valid, idiomatic 3.1.
function collapseNullable(schema: SchemaType, swiftGenerator: boolean) {
  for (const key of ["oneOf", "anyOf"] as const) {
    const schemas = schema[key] as JSONSchema4[] | undefined
    if (!Array.isArray(schemas)) continue

    const hasNull = schemas.some((item) => isBareType(item, "null"))
    if (!hasNull) continue

    const others = schemas.filter((item) => !isBareType(item, "null"))

    // Shape 1: every non-null member is a bare type.
    if (others.every((item) => isBareType(item))) {
      const types: string[] = []
      for (const item of schemas) {
        const t = item.type
        for (const value of Array.isArray(t) ? t : [t]) {
          if (typeof value === "string" && !types.includes(value)) {
            types.push(value)
          }
        }
      }
      schema[key] = undefined
      schema.type = (types.length === 1 ? types[0] : types) as SchemaType["type"]
      continue
    }

    if (others.length !== 1) continue
    const member = others[0]

    // Shape 2: a single constrained scalar member (both modes).
    if (isMergeableScalar(member)) {
      liftMemberAsNullable(schema, key, member, member.type as string)
      continue
    }

    if (!swiftGenerator) continue

    // Shape A: a single inline object member.
    if (isMergeableObject(member)) {
      liftMemberAsNullable(schema, key, member, "object")
      continue
    }

    // Shape B: a single inline array member.
    if (isMergeableArray(member)) {
      liftMemberAsNullable(schema, key, member, "array")
      continue
    }

    // Shape C: a single bare `$ref` member → drop the union, keep the bare ref.
    if (isBareRef(member)) {
      schema[key] = undefined
      schema.$ref = member.$ref
      markNullDropped(schema)
      continue
    }

    // General fallback (swiftGenerator): any other single non-null member — a nested
    // `anyOf`/`oneOf`, a `const`/`enum`, an empty `{}`, etc. swift-openapi-generator still
    // cannot tolerate the `{type:"null"}` sibling, so inline the lone member in place of
    // the whole union. The lost nullability is carried by `unrequireDroppedNulls` instead.
    inlineSoleMember(schema, key, member)
    markNullDropped(schema)
  }

  // The single-member branches above all `continue`. Multi-member nullable unions
  // (e.g. `anyOf[array, scalar, scalar, null]`) fall through to here in the swiftGenerator
  // target: drop just the `{type:"null"}` member, leaving a valid multi-member union.
  if (swiftGenerator) {
    for (const key of ["oneOf", "anyOf"] as const) {
      const schemas = schema[key] as JSONSchema4[] | undefined
      if (!Array.isArray(schemas)) continue
      if (!schemas.some((item) => isBareType(item, "null"))) continue
      schema[key] = schemas.filter(
        (item) => !isBareType(item, "null"),
      ) as SchemaType[keyof SchemaType]
      markNullDropped(schema)
    }
  }

  return schema
}

// Record that this schema can no longer represent `null`, so `unrequireDroppedNulls` can drop it
// from its parent's `required` after the walk. Called only from the branches that actually erase
// the null branch — the type-array and lifted-member shapes still say `"null"` and must stay
// required, which is what the server enforces.
function markNullDropped(schema: SchemaType) {
  ;(schema as Record<symbol, unknown>)[NULL_DROPPED] = true
}

// Replace a nullable combiner with its sole non-null member: drop the combiner key and
// copy the member's keywords onto the parent (member wins on overlap, since the member is
// the intended schema). Parent-only keys — e.g. a `description` annotating the union — are
// preserved. Mirrors the Python normalizer's single-member `strip_null` collapse.
function inlineSoleMember(schema: SchemaType, key: "oneOf" | "anyOf", member: JSONSchema4) {
  schema[key] = undefined
  for (const [k, value] of Object.entries(member)) {
    if (value === undefined || k.startsWith("~")) continue
    schema[k as keyof SchemaType] = value
  }
}

const LARGE_CONST_UNION_MIN = 20

// True for a `{ type: "string", const: <value> }` member (the shape TypeBox emits for
// each literal in a large string union, e.g. every country / timezone name).
function isConstString(item: JSONSchema4) {
  return typeof item === "object" && item?.type === "string" && item.const !== undefined
}

// Collapse a large `anyOf`/`oneOf` of `{type:"string", const:…}` members (>= 20, e.g.
// country ~248, timezone ~418) into a plain `{ type: "string" }`. swift-openapi-generator
// otherwise explodes each into hundreds of single-case `value1…valueN` enums, which are
// unusable in a form. Small const unions (forum `_type`, moderation enums, …) are left
// untouched. swiftGenerator-only, so the default target (web client) is unaffected.
function collapseLargeConstUnion(schema: SchemaType) {
  for (const key of ["anyOf", "oneOf"] as const) {
    const members = schema[key] as JSONSchema4[] | undefined
    if (!Array.isArray(members) || members.length < LARGE_CONST_UNION_MIN) continue
    if (members.every(isConstString)) {
      schema[key] = undefined
      schema.type = "string"
    }
  }
  return schema
}

// Copy a union member's keywords onto the parent and make the parent's type nullable
// (`[baseType, "null"]`). Skips `type`, `undefined` leftovers, and `~`-prefixed TypeBox
// internals; never clobbers a keyword already present on the parent so union-level
// annotations (title/description) win.
function liftMemberAsNullable(
  schema: SchemaType,
  key: "oneOf" | "anyOf",
  member: JSONSchema4,
  baseType: string,
) {
  for (const [k, value] of Object.entries(member)) {
    if (k === "type" || value === undefined || k.startsWith("~")) continue
    if (schema[k as keyof SchemaType] === undefined) {
      schema[k as keyof SchemaType] = value
    }
  }
  schema[key] = undefined
  schema.type = [baseType, "null"] as SchemaType["type"]
}

// A scalar schema whose keywords are safe to fold onto a nullable parent: a single
// scalar `type` with no value-restricting `const`/`enum` (those would reject `null`)
// and no `$ref`.
function isMergeableScalar(item: JSONSchema4) {
  if (typeof item !== "object" || item === null) return false
  if (typeof item.type !== "string" || !scalarTypes.has(item.type)) return false
  if (item.const !== undefined || item.enum !== undefined) return false
  if ("$ref" in item && item.$ref) return false
  return true
}

// An inline object member that is safe to fold onto a nullable parent: `type: "object"`
// (a single string, not a type array) with no value-restricting `const`/`enum` and no
// `$ref`. Object keywords (properties, required, additionalProperties, …) apply only to
// the object branch and are ignored for `null`, so lifting them is safe.
function isMergeableObject(item: JSONSchema4) {
  if (typeof item !== "object" || item === null) return false
  if (item.type !== "object") return false
  if (item.const !== undefined || item.enum !== undefined) return false
  if ("$ref" in item && item.$ref) return false
  return true
}

// An inline array member that is safe to fold onto a nullable parent: `type: "array"`
// with no `const`/`enum` and no `$ref`.
function isMergeableArray(item: JSONSchema4) {
  if (typeof item !== "object" || item === null) return false
  if (item.type !== "array") return false
  if (item.const !== undefined || item.enum !== undefined) return false
  if ("$ref" in item && item.$ref) return false
  return true
}

// True when `item` is a bare `$ref` — only a `$ref` keyword, ignoring `undefined`
// leftovers, `x-` extensions, and `~`-prefixed TypeBox internals. A `$ref` cannot carry
// a type array, so a nullable ref is rendered as the bare ref (the `{type:null}` branch
// is dropped) and made optional via `unrequireNullableProps`.
function isBareRef(item: JSONSchema4) {
  if (typeof item !== "object" || item === null) return false
  const keys = Object.keys(item).filter(
    (k) => item[k as keyof JSONSchema4] !== undefined && !k.startsWith("x-") && !k.startsWith("~"),
  )
  return keys.length === 1 && keys[0] === "$ref"
}

// True when `item` constrains only its `type` (a single string). Validation-
// affecting keywords (const, pattern, enum, format, …) block this so we never
// fold them onto the implicit `null` branch — but non-validation noise is ignored:
// `undefined` leftovers from earlier passes, `x-` extensions, and TypeBox internals
// like `~kind` (leaked by `Clone`), all of which are dropped on collapse anyway.
// When `expected` is given, the type must also equal it.
function isBareType(item: JSONSchema4, expected?: string) {
  if (typeof item !== "object" || item === null) return false
  const keys = Object.keys(item).filter(
    (k) => item[k as keyof JSONSchema4] !== undefined && !k.startsWith("x-") && !k.startsWith("~"),
  )
  if (keys.length !== 1 || keys[0] !== "type") return false
  if (Array.isArray(item.type)) return false
  return expected === undefined || item.type === expected
}

// A standalone `{ type: "null" }` schema (e.g. from `Type.Null()`) is unrepresentable in
// Swift — swift-openapi-generator skips the whole property. Replace it with an empty schema
// `{}`, which the generator models as an `OpenAPIValueContainer` that accepts JSON `null`.
// swiftGenerator-only.
//
// Deliberately NOT marked via `markNullDropped`: an empty schema still accepts `null`, so a
// required `Type.Null()` property stays required. Un-requiring it would recreate the very
// mismatch `unrequireDroppedNulls` exists to avoid — the server requires the field, and a client
// that believed the spec and omitted it would get a 400.
function openTypeNullSchema(schema: SchemaType) {
  if (isBareType(schema as unknown as JSONSchema4, "null")) {
    schema.type = undefined
  }
  return schema
}

// swiftGenerator-only post-walk pass. Some nullable shapes cannot survive normalization with
// their `null` branch intact — a bare `$ref` (which can't carry a type array), a `const`/`enum`
// or nested union that gets inlined, a multi-member union, a standalone `{type:"null"}`. For
// those, absence from the parent's `required` is the only nullability signal left, so
// swift-openapi-generator needs it or it drops the property outright.
//
// A nullable property whose emitted schema still says `"null"` — `["boolean","null"]`,
// `["object","null"]`, … — keeps its `required` entry. Un-requiring those was pure loss: the
// document advertised "you may omit this" while the server, validating the untransformed TypeBox
// schema, still demanded it, and answered 400.
//
// This runs after the walk rather than during it because the walker is pre-order: an object node
// is fully processed before any of its properties is visited, so nothing a parent could observe
// mid-walk reflects what its children will actually emit. Each pass that erases a null branch
// marks the schema it erased (`markNullDropped`); this one only reads those marks. There is no
// predicate here to fall out of sync with the passes above.
//
// Returns the JSON pointers it un-required, so callers can report which server-side schemas need
// a matching `Type.Optional(...)` — see `Options.onUnrequiredNullable`.
function unrequireDroppedNulls(
  schema: SchemaType,
  pointer = "",
  seen = new Set<object>(),
): string[] {
  if (typeof schema !== "object" || schema === null || seen.has(schema)) return []
  seen.add(schema)

  const dropped: string[] = []
  const { required, properties } = schema

  if (Array.isArray(required) && typeof properties === "object" && properties !== null) {
    const props = properties as Record<string, Record<symbol, unknown> | undefined>
    const filtered = required.filter((name) => {
      if (!props[name]?.[NULL_DROPPED]) return true
      dropped.push(`${pointer}/properties/${name}`)
      return false
    })
    if (filtered.length !== required.length) {
      schema.required = (filtered.length === 0 ? undefined : filtered) as SchemaType["required"]
    }
  }

  for (const [key, value] of Object.entries(schema)) {
    if (!value || typeof value !== "object") continue
    if (Array.isArray(value)) {
      value.forEach((entry, i) => {
        dropped.push(...unrequireDroppedNulls(entry as SchemaType, `${pointer}/${key}/${i}`, seen))
      })
      continue
    }
    dropped.push(...unrequireDroppedNulls(value as SchemaType, `${pointer}/${key}`, seen))
  }

  delete (schema as Record<symbol, unknown>)[NULL_DROPPED]

  return dropped
}

function convertTypes(schema: SchemaType) {
  if (typeof schema !== "object") {
    return schema
  }
  if (schema.type === undefined) {
    return schema
  }

  // OpenAPI 3.1 accepts both single types and type arrays (including "null"),
  // so there is nothing to rewrite — we only validate the values.
  validateType(schema.type)

  return schema
}

// keywords (or property names) that are not recognized within OAS 3.1 are rewritten into extensions.
function convertIllegalKeywordsAsExtensions(schema: SchemaType) {
  const keys = Object.keys(schema) as SchemaTypeKeys[]

  for (const keyword of keys) {
    if (!keyword.startsWith(oasExtensionPrefix) && !allowedKeywords.has(keyword)) {
      const key = `${oasExtensionPrefix}${keyword}` as keyof SchemaType
      schema[key] = schema[keyword]
      schema[keyword] = undefined
    }
  }

  return schema
}

export default convert
