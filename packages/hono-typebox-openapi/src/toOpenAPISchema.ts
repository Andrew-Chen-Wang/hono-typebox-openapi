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
}

export type OpenApiTarget = "swift-openapi-generator"
type ExtendedJSONSchema = addPrefixToObject & JSONSchema
export type SchemaType = ExtendedJSONSchema
export type SchemaTypeKeys = keyof SchemaType

// OpenAPI 3.1 Schema Objects are a superset of JSON Schema 2020-12, so the
// allowed keywords are the 2020-12 vocabulary plus the OAS-specific annotations.
// Anything outside this list is rewritten into an `x-` extension.
const allowedKeywords = [
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
]

class InvalidTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidTypeError"
    this.message = message
  }
}

const oasExtensionPrefix = "x-"

const handleDefinition = async <T extends JSONSchema4 = JSONSchema4>(
  def: JSONSchema7Definition | JSONSchema6Definition | JSONSchema4,
  schema: T,
  swiftGenerator: boolean,
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
        // biome-ignore lint/suspicious/noExplicitAny: <explanation>
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
    await walker.walk(makeConvertSchema(swiftGenerator), walker.vocabularies.DRAFT_07)
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
  await walker.walk(makeConvertSchema(swiftGenerator), walker.vocabularies.DRAFT_07)
  // if we want to convert unreferenced definitions, we need to do it iteratively here
  const rootSchema = walker.rootSchema as unknown as JSONSchema
  if (convertDefs && rootSchema.definitions) {
    for (const defName in rootSchema.definitions) {
      const def = rootSchema.definitions[defName]
      rootSchema.definitions[defName] = await handleDefinition(def, schema, swiftGenerator)
    }
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
// enables the swift-openapi-generator normalization passes (see `collapseNullable` /
// `unrequireNullableProps`).
const makeConvertSchema = (swiftGenerator: boolean) => (schema?: SchemaType) => {
  let _schema = schema

  if (!_schema) {
    return _schema
  }

  _schema = stripIllegalKeywords(_schema)
  // Runs before child unions are collapsed, while each property still carries its raw
  // `anyOf:[...,{type:null}]`, so it can detect which properties are nullable.
  if (swiftGenerator) {
    _schema = unrequireNullableProps(_schema)
    _schema = collapseLargeConstUnion(_schema)
    _schema = openTypeNullSchema(_schema)
  }
  _schema = convertTypes(_schema)
  _schema = collapseNullable(_schema, swiftGenerator)

  if (_schema.type === "array" && typeof _schema.items === "undefined") {
    _schema.items = {}
  }

  // should be called last
  _schema = convertIllegalKeywordsAsExtensions(_schema)
  return _schema
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

  for (const type of types) {
    if (type && !validTypes.has(type))
      throw new InvalidTypeError(`Type "${type}" is not a valid type`)
  }
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
      continue
    }

    // General fallback (swiftGenerator): any other single non-null member — a nested
    // `anyOf`/`oneOf`, a `const`/`enum`, an empty `{}`, etc. swift-openapi-generator still
    // cannot tolerate the `{type:"null"}` sibling, so inline the lone member in place of
    // the whole union. (`unrequireNullableProps` has already marked the property optional.)
    inlineSoleMember(schema, key, member)
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
    }
  }

  return schema
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
  return (
    typeof item === "object" && item !== null && item.type === "string" && item.const !== undefined
  )
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
  if (typeof item !== "object" || item === null || !item.$ref) return false
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

// True when a property schema is effectively nullable and should be dropped from a parent
// `required` array: either an `anyOf`/`oneOf` containing a bare `{ type: "null" }` member,
// or a standalone `{ type: "null" }` (a null-only field — always absent in practice).
function isNullableUnion(prop: unknown): boolean {
  if (typeof prop !== "object" || prop === null) return false
  if (isBareType(prop as JSONSchema4, "null")) return true
  for (const key of ["anyOf", "oneOf"] as const) {
    const arr = (prop as Record<string, unknown>)[key]
    if (Array.isArray(arr) && arr.some((m) => isBareType(m, "null"))) return true
  }
  return false
}

// A standalone `{ type: "null" }` schema (e.g. from `Type.Null()`) is unrepresentable in
// Swift — swift-openapi-generator skips the whole property. Replace it with an empty schema
// `{}`, which the generator models as an optional `OpenAPIValueContainer?` that decodes
// JSON `null` to `nil`. swiftGenerator-only; the parent `required` entry is removed by
// `unrequireNullableProps` (which also treats standalone null as nullable).
function openTypeNullSchema(schema: SchemaType) {
  if (isBareType(schema as unknown as JSONSchema4, "null")) {
    schema.type = undefined
  }
  return schema
}

// In the swiftGenerator target, a nullable property must also be absent from the parent object's
// `required` array for swift-openapi-generator to treat it as a Swift optional (this is
// the only mechanism for the bare-`$ref` case, which can't carry a type array). Runs on
// the object node before its child unions are collapsed, while properties still carry
// their raw `anyOf:[...,{type:null}]`.
function unrequireNullableProps(schema: SchemaType) {
  if (typeof schema !== "object" || schema === null) return schema
  const { required, properties } = schema
  if (!Array.isArray(required) || typeof properties !== "object" || properties === null) {
    return schema
  }
  const filtered = required.filter(
    (name) => !isNullableUnion((properties as Record<string, unknown>)[name as string]),
  )
  schema.required = (filtered.length === 0 ? undefined : filtered) as SchemaType["required"]
  return schema
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
    if (!keyword.startsWith(oasExtensionPrefix) && !allowedKeywords.includes(keyword)) {
      const key = `${oasExtensionPrefix}${keyword}` as keyof SchemaType
      schema[key] = schema[keyword]
      schema[keyword] = undefined
    }
  }

  return schema
}

export default convert
