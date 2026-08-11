// let umamiToken = "";

// async function authenticate() {
//     if (!process.env.UMAMI_ENDPOINT) {
//         console.log("Not authenticating with Umami!");
//         return;
//     }

//     let res = await fetch(
//         `${process.env.UMAMI_ENDPOINT}/auth/login`, {
//             method: "POST",
//             body: JSON.stringify({
//                 username: process.env.UMAMI_USERNAME,
//                 password: process.env.UMAMI_PASSWORD
//             })
//         }
//     );

//     let json = await res.json();

//     if ("error" in json) {
//         console.warn(`Error authenticating with Umami: ${res.error}`);
//         return;
//     }

//     umamiToken = json.token;

//     console.log(`Authenticated with Umami, token ${umamiToken.slice(0, 5)}...!`);
// }

/**
 *
 * @param {string} name
 * @param {*} data
 * @returns
 */
async function log(name, data={}) {
    let res = await fetch(
        `${process.env.UMAMI_ENDPOINT}/send`, {
            method: "POST",
            body: JSON.stringify({
                type: "event",
                payload: {
                    hostname: process.env.UMAMI_HOSTNAME,
                    // screen: "0x0",
                    // language: "en-US",
                    // url: "/",
                    // referrer: "",
                    // title: "",
                    // tag: "",
                    // id: Date.now().toString(),
                    website: process.env.UMAMI_WEBSITE_ID,
                    name,
                    data
                }
            }),
            headers: {
                "User-Agent": "Comments Preview Server"
            }
        }
    );

    let json = await res.json();

    if ("error" in json) {
        console.warn(`Error when logging Umami event: ${JSON.stringify(json.error)}`);
    }
}

export default {
    log
};
