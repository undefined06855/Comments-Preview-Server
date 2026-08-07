import { Database } from "bun:sqlite"
import { RateLimiter } from "@rabbit-company/rate-limiter";

const db = new Database(":memory:");
db.run(`
CREATE TABLE IF NOT EXISTS LevelComments (
    id                      INTEGER,

    comment                 TEXT NOT NULL,
    likes                   INTEGER NOT NULL,

    player_name             TEXT NOT NULL,
    icon_main_color         INTEGER NOT NULL,
    icon_secondary_color    INTEGER NOT NULL,
    icon_glow_color         INTEGER NOT NULL,
    icon_frame              INTEGER NOT NULL,
    icon_type               INTEGER NOT NULL,

    updated_at              INTEGER NOT NULL
)
`);

// 4 requests per 5 seconds
const limiter = new RateLimiter({
    window: 5000,
    max: 4,
    enableCleanup: false
});

/**
 * https://boomlings.dev/resources/server/comment
 * @param {number} id
 * @param {string} boomlings
 */
function boomlingsToSQL(id, boomlings) {
    let [ commentRaw, userRaw ] = boomlings.split(":");

    let commentSplit = commentRaw.split("~");
    let commentData = {};
    for (let i = 0; i < commentSplit.length; i += 2) {
        commentData[parseInt(commentSplit[i])] = commentSplit[i + 1];
    }

    let userSplit = userRaw.split("~");
    let userData = {};
    for (let i = 0; i < userSplit.length; i += 2) {
        userData[parseInt(userSplit[i])] = userSplit[i + 1];
    }

    let comment = atob(commentData[2].replaceAll("-", "+").replaceAll("_", "/"));

    // try {
    //     comment = atob(commentData[2].replaceAll("-", "+").replaceAll("_", "/"))
    // } catch(err) {
    //     console.log(commentData);
    //     console.log(comment);
    //     console.log(boomlings);
    //     console.log(id);
    //     throw err;
    // }

    function fallbackForNaN(value) {
        if (isNaN(value)) return 1;
        else return value;
    }

    return {
        id,
        comment,
        likes: fallbackForNaN(parseInt(commentData[4])),
        player_name: userData[1] ?? "Unknown",
        icon_main_color: fallbackForNaN(parseInt(userData[10])),
        icon_secondary_color: fallbackForNaN(parseInt(userData[11])),
        icon_glow_color: fallbackForNaN(parseInt(userData[51])),
        icon_frame: fallbackForNaN(parseInt(userData[9])),
        icon_type: fallbackForNaN(parseInt(userData[14])),
        updated_at: Date.now(),
    }
}

let server = Bun.serve({
    routes: {
        "/": Response.redirect("https://github.com/undefined06855/Comments-Preview-Server"),

        "/v1/comments": async req => {
            return new Response(JSON.stringify(await (async () => {
                let ip = req.headers.get("cf-connecting-ip") ?? server.requestIP(req).address;
                let res = limiter.check("/comments", ip);
                if (res.limited) {
                    return { error: "You are being rate limited!" };
                }

                let url = new URL(req.url);
                if (!url.searchParams.has("levelIDs")) {
                    return { error: "URL parameters must include `levelIDs` param!" };
                }

                let ids = [];
                for (let [i, id] of Object.entries(url.searchParams.get("levelIDs").split(","))) {
                    let int = parseInt(id);
                    if (isNaN(int)) {
                        return { error: `ID at index ${i} is invalid!` };
                    }

                    ids.push(int);
                }

                ids = ids.slice(0, 30);

                let levels = {};
                let dbComments = [];
                let gdComments = [];

                function collect(comments) {
                    for (let comment of comments) {
                        if (!(comment.id in levels)) {
                            levels[comment.id] = [];
                        }

                        levels[comment.id].push(comment);
                    }
                }

                // get the comments from the db
                dbComments = db.prepare(`SELECT * FROM LevelComments WHERE id IN (${ids.join(", ")})`).all();
                collect(dbComments);

                // ...and for all of the ids we dont already have in the db, fetch them from gd
                let outdatedIDs = ids.filter(id => !Object.keys(levels).includes(id.toString()));
                let promises = [];
                for (let id of outdatedIDs) {
                    promises.push(new Promise(async (resolve, reject) => {
                        // await (async () => { return new Promise(resolve => setTimeout(resolve, i*150))})();

                        // https://boomlings.dev/endpoints/comments/getGJComments21
                        let params = new URLSearchParams();
                        params.append("levelID", id);
                        params.append("page", "0");
                        params.append("secret", "Wmfd2893gb7");
                        params.append("mode", "1"); // most liked
                        params.append("count", "5");

                        let headers = {};
                        headers["User-Agent"] = "";
                        headers["Authorization"] = process.env.BOOMLINGS_AUTH ?? "";

                        let res = await fetch(
                            process.env.BOOMLINGS_ENDPOINT ?? "https://www.boomlings.com/database/getGJComments21.php", {
                                headers,
                                body: params,
                                method: "POST"
                            }
                        );

                        let rawText = await res.text();
                        if (rawText == "-1") { reject(rawText); return; }
                        if (rawText == "too many requests") { reject(rawText); return; }
                        if (rawText.length < 8) { reject(rawText); return; }
                        if (rawText.indexOf(":") == -1) { reject("no user data"); return; }

                        let boomlingsComments = rawText.split("|");
                        resolve(boomlingsComments.map(boom => boomlingsToSQL(id, boom)));
                    }));
                }

                gdComments = (await Promise.allSettled(promises))
                    .filter(res => res.status == "fulfilled")
                    .map(res => res.value)
                    .flat()

                collect(gdComments);

                // and put the gd comments in the db
                for (let comment of gdComments) {
                    let keys = Object.keys(comment).join(", ");
                    let values = "?, ".repeat(Object.keys(comment).length).slice(0, -2);
                    db.run(`INSERT INTO LevelComments (${keys}) VALUES (${values})`, ...Object.values(comment));
                }

                return { levels };
            })()), { headers: { "Content-Type": "application/json" } });
        }
    },

    port: process.env.PORT ?? 80,
    development: process.env.DEVELOPMENT == "true"
});

// every minute, clear old comments
Bun.cron("* * * * *", () => {
    db.run("DELETE FROM LevelComments WHERE updated_at < ?", Date.now() - 1200000 /* 20 mins */);
});

console.log(`Comments Preview server on port ${server.port}`);
