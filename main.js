import { Database } from "bun:sqlite"
import { RateLimiter } from "@rabbit-company/rate-limiter";

const db = new Database("levels.sqlite", { create: true });
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
    if (boomlings == "-1") {
        return { id, invalid: true }
    }

    let [ comment, user ] = boomlings.split(":");

    let commentSplit = comment.split("~");
    let commentData = {};
    for (let i = 0; i < commentSplit.length; i += 2) {
        commentData[parseInt(commentSplit[i])] = commentSplit[i + 1];
    }

    let userSplit = user.split("~");
    let userData = {};
    for (let i = 0; i < userSplit.length; i += 2) {
        userData[parseInt(userSplit[i])] = userSplit[i + 1];
    }

    try {
        atob(commentData[2].replaceAll("-", "+").replaceAll("_", "/"))
    } catch(err) {
        console.log(commentData);
        console.log(comment);
        console.log(boomlings);
        console.log(id);
        throw err;
    }

    return {
        id,
        comment: atob(commentData[2].replaceAll("-", "+").replaceAll("_", "/")),
        likes: parseInt(commentData[4]),
        player_name: userData[1],
        icon_main_color: parseInt(userData[10]),
        icon_secondary_color: parseInt(userData[11]),
        icon_glow_color: parseInt(userData[51]),
        icon_frame: parseInt(userData[9]),
        icon_type: parseInt(userData[14]),
        updated_at: Date.now(),
    }
}

let server = Bun.serve({
    routes: {
        "/": Response.redirect("https://github.com/undefined06855/Comments-Preview-Server"),

        "/v1/comments": async req => {
            return new Response(JSON.stringify(await (async () => {
                let ip = server.requestIP(req);
                if (!limiter.check("/comments", ip.address)) {
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

                let levels = {};
                let dbComments = [];
                let gdComments = [];

                function collect(comments) {
                    for (let comment of comments) {
                        if (!(comment.id in levels)) {
                            levels[comment.id] = [];
                        }

                        if ("invalid" in comment) continue;
                        levels[comment.id].push(comment);
                    }
                }

                // get the comments from the db
                dbComments = db.prepare(`SELECT * FROM LevelComments WHERE id IN (${ids.join(", ")})`).all();
                collect(dbComments);

                // ...and for all of the ids we dont already have in the db, fetch them from gd
                let outdatedIDs = ids.filter(id => !Object.keys(levels).includes(id.toString()));
                for (let id of outdatedIDs) {
                    // https://boomlings.dev/endpoints/comments/getGJComments21
                    let params = new URLSearchParams();
                    params.append("levelID", id);
                    params.append("page", "0");
                    params.append("secret", "Wmfd2893gb7");
                    params.append("mode", "1"); // most liked
                    params.append("count", "5");

                    let res = await fetch(
                        "https://www.boomlings.com/database/getGJComments21.php", {
                            headers: { "User-Agent": " " },
                            body: params,
                            method: "POST"
                        }
                    );

                    let rawText = await res.text();
                    if (rawText == "-1") continue;
                    if (rawText.length < 8) continue;

                    let boomlingsComments = rawText.split("|");
                    gdComments.push(...boomlingsComments.map(boom => boomlingsToSQL(id, boom)));
                }

                collect(gdComments);

                // and put the gd comments in the db
                for (let comment of gdComments) {
                    if ("invalid" in comment) continue;

                    let keys = Object.keys(comment).join(", ");
                    let values = "?, ".repeat(Object.keys(comment).length).slice(0, -2);
                    db.run(`INSERT INTO LevelComments (${keys}) VALUES (${values})`, ...Object.values(comment));
                }

                return { levels };
            })()), { headers: { "Content-Type": "application/json" } });
        }
    },

    port: process.env.PORT,
    development: process.env.DEVELOPMENT == "true"
});

// every minute, clear old comments
Bun.cron("* * * * *", () => {
    db.run("DELETE FROM LevelComments WHERE updated_at < ?", Date.now() - 600000 /* 10 mins */);
});

console.log(`Comments Preview server on port ${process.env.PORT}`);
