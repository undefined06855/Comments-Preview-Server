import { Database } from "bun:sqlite"
import { RateLimiter } from "@rabbit-company/rate-limiter";
import umami from "./umami";

const db = new Database(":memory:");
db.run(`
CREATE TABLE IF NOT EXISTS LevelComments (
    id                      INTEGER NOT NULL,

    comment                 TEXT NOT NULL,
    likes                   INTEGER NOT NULL,
    age                     TEXT NOT NULL,

    player_name             TEXT NOT NULL,
    icon_main_color         INTEGER NOT NULL,
    icon_secondary_color    INTEGER NOT NULL,
    icon_glow_color         INTEGER NOT NULL,
    icon_frame              INTEGER NOT NULL,
    icon_type               INTEGER NOT NULL,

    expires_at              INTEGER NOT NULL
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS LevelsWithZeroComments (
    id                      INTEGER PRIMARY KEY,
    expires_at              INTEGER NOT NULL
)
`);

/**
 * @typedef {Object} LevelComment
 * @property {number} id
 * @property {string} comment
 * @property {number} likes
 * @property {string} age
 * @property {string} player_name
 * @property {number} icon_main_color
 * @property {number} icon_secondary_color
 * @property {number} icon_glow_color
 * @property {number} icon_frame
 * @property {number} icon_type
 * @property {number | undefined} expires_at
 */

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
 * @returns {false | LevelComment}
 */
function boomlingsToSQL(id, boomlings) {
    if (boomlings.indexOf(":") == -1) return false;
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

    // only required key
    if (!(2 in commentData)) {
        return false;
    }

    function fallbackForNaN(value, fallback) {
        if (isNaN(value)) return fallback;
        else return value;
    }

    let comment = atob(commentData[2].replaceAll("-", "+").replaceAll("_", "/"));

    // glow is disabled ("2" is enabled)
    if (userData[15] == "0") {
        userData[51] = -1;
    }

    return {
        id,
        comment,
        likes: fallbackForNaN(parseInt(commentData[4]), 0),
        age: commentData[9] == "" ? "Unknown" : commentData[9],

        player_name: userData[1] == "" ? "Unknown" : userData[1],
        icon_main_color: fallbackForNaN(parseInt(userData[10]), 0),
        icon_secondary_color: fallbackForNaN(parseInt(userData[11]), 3),
        icon_glow_color: fallbackForNaN(parseInt(userData[51]), -1),
        icon_frame: fallbackForNaN(parseInt(userData[9]), 1),
        icon_type: fallbackForNaN(parseInt(userData[14]), 0),

        // filled in by calculateCacheability
        expires_at: undefined
    }
}

/**
 * Returns how long to cache these comments, in minutes.
 * (it's spelt Cacheability and not Cachability?)
 * @param {Array<LevelComment>} comments
 */
function calculateCacheability(comments) {
    if (comments.length == 0) return 0;

    // force 20 mins if any of the top comments are not recent
    if (comments.slice(0, 10).some(comment => comment.age.includes("second"))) {
        return 20;
    }

    let ret = 5;

    // add a day if any of the top 20 comments have "year" in their age
    ret += comments.slice(0, 20).some(comment => comment.age.includes("year")) ? 1440 : 0;

    // add an hour for any of the top 5 comments which differ by more than 40 likes each
    ret += comments.slice(0, 5).filter((comment, i) => i == 0 ? false : comments[i - 1].likes - comment.likes > 40).length * 60;

    // add 30 mins if we have a full 40 comments (see count param)
    ret += comments.length == 40 ? 30 : 0;

    return ret;
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

                    // certainly invalid (probably id zero)
                    if (int < 128) {
                        continue;
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

                        if (levels[comment.id].length >= 5) continue;

                        levels[comment.id].push(comment);
                    }
                }

                // get the comments from the db
                dbComments = db.prepare(`SELECT * FROM LevelComments WHERE id IN (${ids.join(", ")})`).all();
                collect(dbComments);

                // ...and for all of the ids we dont already have in the db, fetch them from gd, skipping over levels
                // with zero comments
                let outdatedIDs = ids.filter(id => !Object.keys(levels).includes(id.toString()));
                let zeroCommentLevelIDs = db.prepare(`SELECT id FROM LevelsWithZeroComments WHERE id IN (${outdatedIDs.join(", ")})`).all().map(row => row.id);
                outdatedIDs = outdatedIDs.filter(id => !zeroCommentLevelIDs.includes(id));

                let promises = outdatedIDs.map(async id => {
                    // https://boomlings.dev/endpoints/comments/getGJComments21
                    let params = new URLSearchParams();
                    params.append("levelID", id);
                    params.append("page", "0");
                    params.append("secret", "Wmfd2893gb7");
                    params.append("mode", "1"); // most liked
                    params.append("count", "40"); // if this is updated make sure to update calculateCacheability

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
                    if (rawText == "-1") {
                        umami.log("server error", { levelID: id, reason: "-1" });
                        return false;
                    }

                    if (rawText == "too many requests") {
                        umami.log("server error", { levelID: id, reason: "proxy ratelimit" });
                        return false;
                    }

                    let [ commentsData, suffix ] = rawText.split("#");
                    let [ total, from, perPage ] = suffix.split(":");

                    if (parseInt(total) == 0) {
                        // this level has zero comments, cache that for 20 mins
                        db.run("INSERT INTO LevelsWithZeroComments (id, expires_at) VALUES (?, ?)", id, Date.now() + 1200000);
                        return false;
                    }

                    return commentsData.split("|")
                        .map(boom => boomlingsToSQL(id, boom))
                        .filter(boom => boom != false)
                });

                gdComments = (await Promise.allSettled(promises))
                    .filter(res => {
                        return res.status == "fulfilled";
                    })
                    .map(res => res.value)
                    .filter(value => value != false)
                    .map(comments => {
                        // calculate cacheability and cache length for all of the comments
                        // one point of cacheability = one extra minute of caching
                        let cacheability = calculateCacheability(comments);
                        comments.forEach(comment => comment.expires_at = Date.now() + cacheability * 60000);

                        // just to pass to the umami log
                        // comments["raw_cacheability"] = cacheability;

                        return comments;
                    })
                    // .map(comments => {
                    //     for (let comment of comments) {
                    //         umami.log("single comment", {
                    //             comment: comment
                    //         });
                    //     }

                    //     umami.log("single level", {
                    //         cacheability: `${comments["raw_cacheability"]} mins`
                    //     });

                    //     delete comments["raw_cacheability"];

                    //     return comments;
                    // })
                    .flat();

                collect(gdComments);

                umami.log("request", {
                    outdatedIDs: outdatedIDs.length,
                    zeroCommentLevelIDs: zeroCommentLevelIDs.length,
                    gdComments: gdComments.length,
                    dbComments: dbComments.length,
                    totalComments: gdComments.length + dbComments.length,
                    levelCount: Object.keys(levels).length,
                    inputLevelCount: ids.length,
                    modVersion: url.searchParams.get("modVersion") ?? "unknown",
                    platform: url.searchParams.get("platform") ?? "unknown",
                    geodeVersion: url.searchParams.get("geodeVersion") ?? "unknown",
                    gdVersion: url.searchParams.get("gdVersion") ?? "unknown"
                });

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

// every minute, clear old comments where they expired in the past
Bun.cron("* * * * *", () => {
    db.run("DELETE FROM LevelComments WHERE expires_at < ?", Date.now());
    db.run("DELETE FROM LevelsWithZeroComments WHERE expires_at < ?", Date.now());
});

process.on("SIGTERM", async () => {
    await server.stop(true);
    process.exit(0);
});

// for docker?
process.on("SIGINT", async () => {
    await server.stop(true);
    process.exit(0);
});

console.log(`Comments Preview server on port ${server.port}`);
