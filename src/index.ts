import { Hono } from "hono";
import { bad, type Env, type HonoEnv } from "./env";
import { pub as locksPub } from "./locks";
import { pub as settingsPub } from "./settings";
import { pub as homePub } from "./home";
import { pub as sharePub } from "./share";
import { pub as authPub, admin as authAdmin, requireLogin } from "./auth";
import { pub as musicPub, admin as musicAdmin } from "./music";
import { admin as adminEntries } from "./admin-entries";
import { admin as locksAdmin } from "./locks";
import { admin as settingsAdmin } from "./settings";
import { admin as aiAdmin } from "./ai";
import { admin as draftsAdmin, composeToday, ComposeSkip } from "./drafts";
import { admin as lookupAdmin } from "./lookup";
import { admin as weatherAdmin } from "./weather";

/* The Worker: each part of the site is a module with its routes in a sub-app (`pub` for what a reader can reach,
   `admin` for what needs the login), mounted here. The order is the order the routes were once written in. */
const app = new Hono<HonoEnv>();

// what a reader reaches
app.route("/", locksPub);      // /api/entries, /api/unlock
app.route("/", settingsPub);   // /api/settings
app.route("/", homePub);       // the book's page
app.route("/", sharePub);      // /p/<id>, /card/, /img/
app.route("/", authPub);       // GitHub login
app.route("/", musicPub);      // /api/meting

// the admin: everything under /api/admin/ needs the login
app.use("/api/admin/*", requireLogin);
app.route("/", authAdmin);     // me, logout
app.route("/", adminEntries);  // pages, photos
app.route("/", locksAdmin);    // passwords
app.route("/", settingsAdmin); // settings
app.route("/", aiAdmin);       // the AI: test, suggest
app.route("/", draftsAdmin);   // jots, the draft page
app.route("/", lookupAdmin);   // NeoDB, covers
app.route("/", musicAdmin);    // 网易云
app.route("/", weatherAdmin);  // the day's weather

app.all("/api/*", (c) => bad(c, 404, "没有这个接口"));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "服务器出错了，稍后再试" }, 500);
});

// Anything else falls through to static assets.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // nightly fallback (wrangler.jsonc triggers): if the desktop task hasn't written today's page, write it from the jots
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      composeToday(env).then(
        (e) => console.log("nightly draft written:", e.date, e.title),
        (err) => (err instanceof ComposeSkip ? console.log("nightly skipped:", err.message) : console.error("nightly failed:", err)),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
