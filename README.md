# Comments Preview Server

A server for the Comments Preview mod.

Either make a `docker-compose.yml` file (based on the example):
```sh
cp docker-compose.example.yml docker-compose.yml
nano docker-compose.yml # or your text editor of choice
docker compose up # or with --build to update

# to stop run
docker compose down
# and if anyone can figure out why docker can't stop it within 10s let me know please
```

...or create a docker container using your Docker UI of choice (Portainer, Pelican, Docker Desktop, etc.), and point
it to the image at `ghcr.io/undefined06855/comments-preview-server:latest`, providing the environment variables below

...or run `bun i && bun main` to start, which requires the following environment variables (set either through a `.env`
file or manually set):
```env
PORT=8080 # defaults to 80
DEVELOPMENT=true # defaults to false
BOOMLINGS_ENDPOINT=https://www.boomlings.com/database/getGJComments21.php # defaults to boomlings
BOOMLINGS_AUTH=whatever # optional, gets passed as the Authorization header to the endpoint
```

This project was created using `bun init` in bun v1.3.12. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
