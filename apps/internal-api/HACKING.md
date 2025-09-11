# Hacking

Notes:
- Hono RPC still utilizes the return type of `c.json`, not `describeRoute`.
- Throwing HTTPException won't populate RPC error response. You must return `r.json()`. Use
  the helper functions in `src/utils/http-exception.ts`.
- For query, param, and JSON input, it uses the validator Typebox schema.
- PUT/PATCH/DELETE 2xx status codes returns a null body, conforming to the type system of Hono
