# Comments Preview Server

A server for the Comments Preview mod.

Either make a `docker-compose.yml` file (based on the example) or run `bun i && bun main` to start.

This requires the following environment variables (set either through a `.env` file or manually set):
```env
PORT=8080 # defaults to 80
DEVELOPMENT=true # defaults to false
BOOMLINGS_ENDPOINT=https://www.boomlings.com/database/getGJComments21.php
BOOMLINGS_AUTH=whatever # optional
```
(though these are written out in the example `docker-compose.yml` file.)

This project was created using `bun init` in bun v1.3.12. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
