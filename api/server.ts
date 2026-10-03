// Entry for both `bun start` locally and the Vercel Bun function. Elysia's listen() calls Bun.serve().
import { app } from '../server/index'

app.listen(Number(process.env.PORT ?? 3000))
