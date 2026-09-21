import { onRequestPost as __api_generate_image_js_onRequestPost } from "/Users/federico.diterlizzi/Desktop/Personali/Eyes4Beat/functions/api/generate-image.js"
import { onRequest as __api_generate_image_js_onRequest } from "/Users/federico.diterlizzi/Desktop/Personali/Eyes4Beat/functions/api/generate-image.js"
import { onRequest as ___middleware_js_onRequest } from "/Users/federico.diterlizzi/Desktop/Personali/Eyes4Beat/functions/_middleware.js"

export const routes = [
    {
      routePath: "/api/generate-image",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_generate_image_js_onRequestPost],
    },
  {
      routePath: "/api/generate-image",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_generate_image_js_onRequest],
    },
  {
      routePath: "/",
      mountPath: "/",
      method: "",
      middlewares: [___middleware_js_onRequest],
      modules: [],
    },
  ]