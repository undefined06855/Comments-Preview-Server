# Comments Preview Server

A server for the Comments Preview mod.

Either use the docker-compose file or run `bun i && bun main` to start.

This requires the following environment variables (set either through a `.env` file or manually set):
```
PORT=8080
DEVELOPMENT=true
BOOMLINGS_ENDPOINT=https://www.boomlings.com
BOOMLINGS_AUTH=whatever # optional
```

This project was created using `bun init` in bun v1.3.12. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
