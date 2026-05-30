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
}
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
    await walker.walk(convertSchema, walker.vocabularies.DRAFT_07)
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
  await walker.loadSchema(schema, options)
  await walker.walk(convertSchema, walker.vocabularies.DRAFT_07)
  // if we want to convert unreferenced definitions, we need to do it iteratively here
  const rootSchema = walker.rootSchema as unknown as JSONSchema
  if (convertDefs && rootSchema.definitions) {
    for (const defName in rootSchema.definitions) {
      const def = rootSchema.definitions[defName]
      rootSchema.definitions[defName] = await handleDefinition(def, schema)
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

function convertSchema(schema?: SchemaType) {
  let _schema = schema

  if (!_schema) {
    return _schema
  }

  _schema = stripIllegalKeywords(_schema)
  _schema = convertTypes(_schema)
  _schema = collapseNullable(_schema)

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
// into an idiomatic OpenAPI 3.1 nullable type. Two shapes are handled:
//
//   1. Every non-null member is a bare `{ type: <string> }` → fold the whole union
//      into a type array, e.g. `string | null` → `{ type: ["string", "null"] }`.
//   2. Exactly one non-null member, and it is a *scalar* (string/number/integer/
//      boolean) with no `const`/`enum` → lift its keywords onto the parent and make
//      the type nullable, e.g. `{ type: ["string", "null"], format: "date-time" }`.
//      This is safe because scalar constraints (format, pattern, minLength, minimum,
//      …) only apply to their own type and are ignored for `null`.
//
// Anything else — `const`/`enum` members (which would forbid `null`), object/array/
// `$ref` members, or unions with several non-null members — is left as `anyOf`,
// which is already valid, idiomatic 3.1.
function collapseNullable(schema: SchemaType) {
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

    // Shape 2: a single constrained scalar member.
    if (others.length === 1 && isMergeableScalar(others[0])) {
      const member = others[0]
      for (const [k, value] of Object.entries(member)) {
        if (k === "type" || value === undefined || k.startsWith("~")) continue
        // Preserve any union-level annotations already on the parent.
        if (schema[k as keyof SchemaType] === undefined) {
          schema[k as keyof SchemaType] = value
        }
      }
      schema[key] = undefined
      schema.type = [member.type as string, "null"] as SchemaType["type"]
    }
  }

  return schema
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
