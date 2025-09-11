import { Hono } from "hono"
import { RegExpRouter } from "hono/router/reg-exp-router"
import user from "./user"

const app = new Hono({
  router: new RegExpRouter(),
})
  .basePath("/v1")
  .route("/user", user)

export default app
