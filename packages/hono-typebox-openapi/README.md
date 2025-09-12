# 📜 Hono Typebox OpenAPI

[![npm version](https://img.shields.io/npm/v/hono-typebox-openapi.svg)](https://npmjs.org/package/hono-typebox-openapi "View this project on NPM")
[![npm downloads](https://img.shields.io/npm/dm/hono-typebox-openapi)](https://www.npmjs.com/package/hono-typebox-openapi)
[![license](https://img.shields.io/npm/l/hono-typebox-openapi)](LICENSE)

This can automatically generate the OpenAPI specification for the Hono API using your validation schema, which can be used to generate client libraries, documentation, and more.

Unlike Hono-OpenAPI, this package only supports [TypeBox](https://github.com/sinclairzx81/typebox) but treats it as a first-class citizen. If you are mixing multiple schema validation libraries, use the main hono-openapi package and use TypeMap.

> [!Note]
> This package is still in development and your feedback is highly appreciated. If you have any suggestions or issues, please let us know by creating an issue on GitHub.

## Usage

### Installation

You can install the package using favorite package manager.

```bash
npm add hono-typebox-openapi typebox
```

### Basic Usage

#### Setting up your application

First, define your schemas, here is an example using Zod:

```ts
import { Type } from "typebox"

export const UserPostSchemaRequest = Type.Object({
  id: Type.Number(),
})

export const UserPostSchemaResponse = Type.Object({
  id: Type.String({ format: "uuid" }),
  failureCount: Type.Number(),
})
```

Next, create your route -

```ts
import { Hono } from "hono"
import { describeRoute } from "hono-typebox-openapi"
import { resolver, validator } from "hono-typebox-openapi/typebox"
import { Type } from "typebox"
import { ErrorSchemaResponse } from "../utils/common.serializer.ts"
import { throwInternalServerError } from "../utils/http-exception.ts"
import { UserPostSchemaRequest, UserPostSchemaResponse } from "./user.serialier.ts"

const app = new Hono().post(
  "/:id",
  describeRoute({
    responses: {
      200: {
        description: "Example Response",
        content: {
          "application/json": {
            schema: resolver(UserPostSchemaResponse),
          },
        },
      },
      500: {
        description: "Internal Server Error",
        content: {
          "application/json": {
            schema: ErrorSchemaResponse,
          },
        },
      },
    },
  }),
  validator("param", Type.Object({ id: Type.Number() })),
  validator("json", UserPostSchemaRequest),
  (c) => {
    const { id } = c.req.valid("param")
    if (Number.isNaN(id)) {
      return throwInternalServerError(c, "Example error")
    }
    const body = c.req.valid("json")
    console.log(body)

    return c.json({ id: crypto.randomUUID(), failureCount: id % 2 === 0 ? 0 : null })
  },
)
```

You might be wondering why are we importing `validator` from `hono-typebox-openapi/typebox` instead of `@hono/typebox-validator` and as `tbValidator`? This is because `hono-typebox-openapi` provides a wrapper around the `@hono/typebox-validator` with better updates and to make it easier to use. The idea is if you are already using `@hono/typebox-validator` to validate your schemas, you can easily switch to `hono-typebox-openapi` without changing much of your code.

Finally, generate the OpenAPI specification -

```ts
app.get(
  "/openapi",
  openAPISpecs(app, {
    documentation: {
      info: {
        title: "Hono",
        version: "1.0.0",
        description: "API for greeting users",
      },
      servers: [
        {
          url: "http://localhost:3000",
          description: "Local server",
        },
      ],
    },
  })
);
```

Now, you can access the OpenAPI specification by visiting `http://localhost:3000/openapi`, and you can use this specification to generate client libraries, documentation, and more. Some tools that I used to generate documentation are -

- [Swagger UI](https://github.com/honojs/middleware/tree/main/packages/swagger-ui)
- [Scalar](https://www.npmjs.com/package/@scalar/hono-api-reference)

See a full Hono example [here](./apps/internal-api/README.md).

##### Scalar Example

```ts
app.get(
  "/docs",
  Scalar({
    theme: "saturn",
    url: "/openapi",
  })
);
```

And that's it! You have successfully generated the OpenAPI specification for your Hono API.

### Advanced Usage

#### Adding Security Definitions

You can add security definitions to your OpenAPI specification by using the `security` property in the `openAPISpecs` function.

```ts
app.get(
  "/openapi",
  openAPISpecs(appRouter, {
    documentation: {
      info: {
        title: "Andrew-Chen-Wang Cloud",
        version: "1.0.0",
        description: "API Documentation",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [
        {
          bearerAuth: [],
        },
      ],
      servers: [
        {
          url: "http://localhost:3004",
          description: "Local server",
        },
      ],
    },
  })
);
```

#### Conditionaly Hiding Routes

You can conditionally hide routes from the OpenAPI specification by using the `hide` property in the `describeRoute` function.

```ts
app.get(
  "/",
  describeRoute({
    // ...
    hide: process.env.NODE_ENV === "production",
  }),
  (c) => {
    return c.text("Private Route");
  }
);
```

#### Validating Responses

> [!Warning]
> Experimental

You can validate the responses using the `validateResponse` property in the `describeRoute` function. This will validate the response against the schema and return an error if the response is invalid.

```ts
app.get(
  "/",
  describeRoute({
    // ...
    validateResponse: true,
  }),
  (c) => {
    return c.json({ message: "This response will be validated" });
  }
);
```

#### Persisting OpenAPI Spec to a file

You can save the spec to a file for cache or any other external use.

```ts
import fs from 'node:fs';
import { openAPISpecs, generateSpecs } from 'hono-typebox-openapi';

const options = {/* ... */};
const app = new Hono()
  .get(
    "/openapi",
    openAPISpecs(app, options),
  );

generateSpecs(app, options)
  .then(spec => {
    const pathToSpec = "openapi.json"
    fs.writeFileSync(pathToSpec, JSON.stringify(spec, null, 2));
  })
```

## Contributing

We would love to have more contributors involved!

To get started, please read our [Contributing Guide](https://github.com/Andrew-Chen-Wang/hono-typebox-openapi/blob/main/CONTRIBUTING.md).

## Credits

- The idea for this project was inspired by [ElysiaJS](https://elysiajs.com/) and their amazing work on generating [OpenAPI](https://elysiajs.com/recipe/openapi.html) specifications.
- This project would not have been possible without the work of [Sam Chung](https://github.com/samchungy) and his [Zod OpenAPI](https://github.com/samchungy/zod-openapi) package.
- Thanks to [MathurAditya724](https://github.com/MathurAditya724) for the original hono-openapi!
